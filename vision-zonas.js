/**
 * Analíticas entrenables (dentro de vision-worker): cada zona fija de una cámara se mira cada
 * `cadaSeg`, se recorta, se le pide a omni-vision el vector SigLIP del recorte y se decide la
 * probabilidad del estado que avisa (ver src/lib/zona-entrenable.ts para el porqué de todo):
 *
 *  · Sin modelo entrenado: con las frases de la zona (SigLIP texto↔imagen), la misma cuenta que
 *    los atributos: sigmoide(escala · (coseno con las frases del estado que avisa − coseno con
 *    las del normal)).
 *  · Con modelo: prototipos calibrados. LA MISMA CUENTA QUE `puntuar` en zona-entrenable.ts.
 *
 * Cada mirada queda como muestra (recorte + vector) para etiquetar y entrenar. El aviso sale
 * cuando el estado que avisa se sostiene `sostenerSeg`, dentro del horario, una sola vez hasta
 * que vuelve a lo normal.
 *
 * No usa la GPU más que lo que ya usa la búsqueda: un recorte cada 5 minutos por zona es nada
 * al lado del registro (un cuadro cada 2 s por cámara).
 */
const crypto = require("crypto");
const http = require("http");
const sharp = require("sharp");
const { enHorario } = require("./vision-reglas");

const APP = (process.env.APP_INTERNAL_URL || "http://127.0.0.1:10001").replace(/\/$/, "");
/** Cada cuánto se revisa si alguna zona toca mirar (la cadencia de cada una la pone su `cadaSeg`). */
const VUELTA_MS = 15_000;
/** Ancho del cuadro que se pide: la zona de un contenedor lejano tiene que tener píxeles. */
const ANCHO_CUADRO = 1280;
/** Margen alrededor del rectángulo de la zona (fracción de su lado): lo que la rodea ayuda a reconocerla. */
const MARGEN = 0.04;
/** Lado máximo del recorte guardado: SigLIP mira a 384, más es disco sin ganancia. */
const LADO_MUESTRA = 384;
/** Para dejar de estar en el estado que avisa hay que bajar este tanto del umbral: sin esto, una
 *  probabilidad que oscila en el umbral reinicia la cuenta del sostenido y avisa dos veces. */
const HISTERESIS = 0.15;
/** Las muestras SIN etiquetar viven esto; las etiquetadas, siempre (son el entrenamiento). */
const RETENCION_DIAS = 14;
const LIMPIEZA_MS = 6 * 3600_000;

const sigmoide = (z) => 1 / (1 + Math.exp(-Math.max(-40, Math.min(40, z))));
const producto = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };
function normalizar(v) { let n = 0; for (const x of v) n += x * x; n = Math.sqrt(n) || 1; return v.map((x) => x / n); }
function aInt8(v) {
    const max = Math.max(...v.map((x) => Math.abs(x))) || 1;
    return { vector: Buffer.from(Int8Array.from(v, (x) => Math.round((x / max) * 127)).buffer), escala: max / 127 };
}
function emitir(evento, datos) {
    try {
        const cuerpo = JSON.stringify({ __event: evento, ...datos });
        const req = http.request({ hostname: "127.0.0.1", port: Number(process.env.WEBHOOK_PORT || 10000), path: "/internal/emit", method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(cuerpo) }, timeout: 2000 });
        req.on("error", () => { }); req.on("timeout", () => req.destroy());
        req.write(cuerpo); req.end();
    } catch { }
}

function iniciar({ prisma, log, vision, subir, borrar, activa }) {
    const contadores = { muestras: 0, avisos: 0, errores: 0, ultimoError: null };
    /** Vectores de las frases por zona: `${zonaId}` → { clave, pos, neg, escala }. Las frases cambian poco. */
    const frases = new Map();
    const nombres = new Map();
    let ultimaLimpieza = 0, corriendo = true;

    async function camara(id) {
        if (!nombres.has(id)) nombres.set(id, (await prisma.device.findUnique({ where: { id }, select: { name: true } }).catch(() => null))?.name || id);
        return nombres.get(id);
    }

    async function vectoresFrases(z) {
        const clave = JSON.stringify([z.frasesPositivo, z.frasesNegativo]);
        const f = frases.get(z.id);
        if (f && f.clave === clave) return f;
        const r = await fetch(`${vision}/vector_texto`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ textos: [...z.frasesPositivo, ...z.frasesNegativo] }), signal: AbortSignal.timeout(30_000) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok || !Array.isArray(j.vectores)) throw new Error(j.error || `omni-vision (texto) respondió ${r.status}`);
        const vs = j.vectores.map(normalizar);
        const nuevo = { clave, pos: vs.slice(0, z.frasesPositivo.length), neg: vs.slice(z.frasesPositivo.length), escala: Number(j.escala) || 100 };
        frases.set(z.id, nuevo);
        return nuevo;
    }

    /** Recorte del rectángulo envolvente de la zona, con un poco de margen. */
    async function recortar(jpeg, zona) {
        const { width: W, height: H } = await sharp(jpeg).metadata();
        const xs = zona.map((p) => p[0]), ys = zona.map((p) => p[1]);
        let x1 = Math.min(...xs), x2 = Math.max(...xs), y1 = Math.min(...ys), y2 = Math.max(...ys);
        const mx = (x2 - x1) * MARGEN, my = (y2 - y1) * MARGEN;
        x1 = Math.max(0, x1 - mx); y1 = Math.max(0, y1 - my); x2 = Math.min(1, x2 + mx); y2 = Math.min(1, y2 + my);
        const left = Math.floor(x1 * W), top = Math.floor(y1 * H);
        const width = Math.max(8, Math.min(W - left, Math.ceil((x2 - x1) * W))), height = Math.max(8, Math.min(H - top, Math.ceil((y2 - y1) * H)));
        return sharp(jpeg).extract({ left, top, width, height }).resize(LADO_MUESTRA, LADO_MUESTRA, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
    }

    async function mirar(z) {
        const ahora = new Date();
        const r = await fetch(`${APP}/api/snapshot/${z.deviceId}?w=${ANCHO_CUADRO}&t=${ahora.getTime()}`, { signal: AbortSignal.timeout(15_000) });
        if (!r.ok) throw new Error(`la cámara no dio cuadro (${r.status})`);
        const cuadro = Buffer.from(await r.arrayBuffer());
        const recorte = await recortar(cuadro, z.zona);
        const rv = await fetch(`${vision}/vector`, { method: "POST", body: recorte, headers: { "content-type": "image/jpeg" }, signal: AbortSignal.timeout(20_000) });
        const jv = await rv.json().catch(() => ({}));
        if (!rv.ok || !Array.isArray(jv.vector)) throw new Error(jv.error || `omni-vision respondió ${rv.status}`);
        const v = normalizar(jv.vector);

        let prob = null, fuente = "frases";
        const m = z.modelo;
        if (m && Array.isArray(m.w) && m.w.length === v.length) {
            // La misma cuenta que `puntuar` en src/lib/zona-entrenable.ts.
            prob = sigmoide(m.a * (producto(m.w, v) + m.b) + m.c);
            fuente = "entrenado";
        } else {
            const f = await vectoresFrases(z);
            const prom = (l) => l.reduce((s, t) => s + producto(t, v), 0) / l.length;
            prob = sigmoide(f.escala * (prom(f.pos) - prom(f.neg)));
        }

        const dia = ahora.toISOString().slice(0, 10);
        const clave = `zonas/${z.id}/${dia}/${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}.jpg`;
        await subir(clave, recorte);
        const muestra = await prisma.muestraZona.create({ data: { zonaId: z.id, recorte: clave, ...aInt8(v), prob, fuente } });
        contadores.muestras++;

        // Sostenido con histéresis, y un solo aviso hasta que vuelva a lo normal.
        const antes = z.estado || {};
        let positivoDesde = antes.positivoDesde || null, avisado = !!antes.avisado, eventoId = antes.eventoId || null;
        if (prob >= z.umbral) positivoDesde = positivoDesde || ahora.toISOString();
        else if (prob < z.umbral - HISTERESIS) { positivoDesde = null; avisado = false; eventoId = null; }
        const armada = enHorario(z.horario, ahora);
        if (armada && positivoDesde && !avisado && ahora - Date.parse(positivoDesde) >= z.sostenerSeg * 1000) {
            avisado = true;
            const cam = await camara(z.deviceId);
            const claveCuadro = `eventos/${dia}/${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}.jpg`;
            await subir(claveCuadro, cuadro).catch(() => null);
            const ev = await prisma.eventoVision.create({ data: { tipo: "ZONA", reglaId: z.id, deviceId: z.deviceId, camara: cam, valor: prob, foto: claveCuadro } });
            eventoId = ev.id;
            if (z.avisar) {
                const aviso = await prisma.avisoGuardia.create({ data: { tipo: "VISION_ZONA", motivo: `${z.positivo} · ${z.nombre}`, camara: cam, datos: { zonaId: z.id, zona: z.nombre, eventoId: ev.id, foto: claveCuadro, prob } } });
                await prisma.eventoVision.update({ where: { id: ev.id }, data: { avisoId: aviso.id } }).catch(() => null);
                emitir("aviso_guardia", { accion: "nuevo", aviso });
                contadores.avisos++;
            }
            log(`zona «${z.nombre}»: ${z.positivo} sostenido ${Math.round((ahora - Date.parse(positivoDesde)) / 60000)} min (prob ${prob.toFixed(2)})${z.avisar ? " · aviso a la guardia" : ""}`);
        }
        const estado = { prob: +prob.toFixed(4), fuente, al: ahora.toISOString(), muestra: clave, muestraId: muestra.id, positivoDesde, avisado, eventoId, armada, error: null };
        await prisma.zonaEntrenable.update({ where: { id: z.id }, data: { estado } });
        emitir("zona_estado", { id: z.id, estado });
    }

    async function limpiar() {
        const limite = new Date(Date.now() - RETENCION_DIAS * 86_400_000);
        for (;;) {
            const viejas = await prisma.muestraZona.findMany({ where: { etiqueta: null, createdAt: { lt: limite } }, select: { id: true, recorte: true }, take: 500 });
            if (!viejas.length) return;
            await borrar(viejas.map((v) => v.recorte)).catch((e) => log("zonas: limpieza S3:", e.message));
            await prisma.muestraZona.deleteMany({ where: { id: { in: viejas.map((v) => v.id) } } });
            if (viejas.length < 500) return;
        }
    }

    (async function bucle() {
        log("analíticas entrenables: zonas fijas, cada una a su ritmo");
        while (corriendo) {
            try {
                if (activa()) {
                    const zonas = await prisma.zonaEntrenable.findMany({ where: { activa: true } });
                    const ahora = Date.now();
                    for (const z of zonas) {
                        const ultima = z.estado?.al ? Date.parse(z.estado.al) : 0;
                        const forzada = z.forzarAt && z.forzarAt.getTime() > ultima;
                        if (!forzada && ahora - ultima < z.cadaSeg * 1000) continue;
                        try { await mirar(z); }
                        catch (e) {
                            contadores.errores++; contadores.ultimoError = `${z.nombre}: ${e.message}`;
                            // Se anota el error y la hora: sin la hora, una cámara caída se reintentaría cada 15 s.
                            const estado = { ...(z.estado || {}), al: new Date().toISOString(), error: String(e.message).slice(0, 200) };
                            await prisma.zonaEntrenable.update({ where: { id: z.id }, data: { estado } }).catch(() => null);
                        }
                    }
                    if (ahora - ultimaLimpieza > LIMPIEZA_MS) { ultimaLimpieza = ahora; await limpiar().catch((e) => log("zonas: limpieza:", e.message)); }
                }
            } catch (e) { contadores.errores++; contadores.ultimoError = e.message; }
            await new Promise((r) => setTimeout(r, VUELTA_MS));
        }
    })();

    return { contadores, parar: () => { corriendo = false; } };
}

module.exports = { iniciar };
