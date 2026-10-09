/**
 * Análisis de fotos con omni-vision — corre dentro de vision-worker. Dos colas, en este orden:
 *
 *  1. Verificación de intrusión: cada captura de un cruce de línea o una intrusión que manda una
 *     cámara (Detection) se mira con la segmentación. Se guarda lo que se vio (siluetas) en
 *     `Detection.verifAnalisis`; el veredicto —¿una persona toca la línea?— se calcula al mostrar,
 *     con la geometría vigente de la cámara (src/lib/vision-capa.ts). Nunca acepta ni descarta
 *     una alarma: decide una persona.
 *  2. Lecturas LPR: la foto de cada lectura, con las siluetas y los atributos (color, carrocería)
 *     de lo que se ve. Una fila por lectura en `AnalisisFoto`. No cambia la lectura ni la barrera.
 *  3. Huellas para la búsqueda: el vector de SigLIP 2 del recorte de cada pista del registro
 *     (HuellaObjeto), bajado de MinIO. Primero las nuevas, y en los ratos libres las viejas: así
 *     la búsqueda encuentra también lo que se vio antes de que existiera.
 *
 * Las fotos ya están en MinIO (las sirve /api/files): acá no se guarda ninguna imagen nueva,
 * sólo lo que se vio en ellas. Lo que vision-worker sí guarda (recortes del registro, fotos de
 * eventos, relecturas) va al bucket `objetos` del mismo MinIO.
 *
 * Un pedido por vez y con pausa: la GPU es de omni-lpr también.
 */

const http = require("http");

const APP = (process.env.APP_INTERNAL_URL || "http://127.0.0.1:10001").replace(/\/$/, "");
/** Las detecciones de cámara que se verifican: las que dicen «alguien cruzó / entró». */
const TIPOS_INTRUSION = ["LINECROSS", "INTRUSION", "REGION_ENTER"];
/** Lo que se busca en la foto: gente, vehículos y animales (un perro es la falsa alarma típica). */
const GRUPOS = "persona,vehiculo,animal";
/** Hasta cuándo se mira hacia atrás al arrancar. La intrusión, un día; las lecturas, lo que muestra Control LPR. */
const VENTANA_INTRUSION_MS = 24 * 3600_000;
const VENTANA_LPR_MS = 2 * 3600_000;
/**
 * Doble verificación: además de la captura de la cámara se saca un cuadro propio del canal
 * (/api/snapshot) y se mira también. La captura sale una fracción de segundo después del cruce
 * y a veces la persona ya está a medias fuera: el cuadro propio es una segunda chance. Sólo si
 * la detección es reciente (después de esto el cuadro ya no muestra ese momento).
 */
const PROPIO_MAX_MS = 20_000;
/** La foto puede llegar a MinIO unos segundos después del evento. */
const FOTO_ESPERA_MS = 90_000;
const PAUSA_MS = 400;
const OCIOSO_MS = 3000;
/** Más puntos por silueta no se ven y pesan en la base (el mismo tope que src/lib/vision-capa.ts). */
const PUNTOS_SILUETA_MAX = 80;
/** Una pista sin verse hace esto ya se cerró: su recorte es el definitivo (el registro la cierra a los 15 s). */
const PISTA_CERRADA_MS = 30_000;
/** Cuatro decimales en coordenadas 0-1: menos de un píxel en una foto de 4K. */
const r4 = (v) => Math.round(v * 10000) / 10000;
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

function aligerar(poli) {
    if (poli.length <= PUNTOS_SILUETA_MAX) return poli;
    const paso = poli.length / PUNTOS_SILUETA_MAX;
    return Array.from({ length: PUNTOS_SILUETA_MAX }, (_, i) => poli[Math.floor(i * paso)]);
}

function emitir(evento, datos) {
    try {
        const cuerpo = JSON.stringify({ __event: evento, ...datos });
        const req = http.request({ hostname: "127.0.0.1", port: Number(process.env.WEBHOOK_PORT || 10000), path: "/internal/emit", method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(cuerpo) }, timeout: 2000 });
        req.on("error", () => { }); req.on("timeout", () => req.destroy());
        req.write(cuerpo); req.end();
    } catch { }
}

/**
 * @param {object} o
 * @param o.estado  () => { verificar, lpr, atributos, segmentar, detectar } — lo que hoy está prendido
 */
/** int8 con su escala: v ≈ q × escala. Para ordenar por coseno alcanza y ocupa la cuarta parte. */
function aInt8(v) {
    const max = Math.max(...v.map((x) => Math.abs(x))) || 1;
    const q = Int8Array.from(v, (x) => Math.round((x / max) * 127));
    return { vector: Buffer.from(q.buffer), escala: max / 127 };
}

function iniciar({ prisma, log, vision, estado, bajar, subir }) {
    const contadores = { verificadas: 0, lecturas: 0, huellas: 0, sinFoto: 0, errores: 0, ultimoError: null, msUltima: null };
    /** Recortes que no se pudieron bajar (la retención los borró): no se reintentan en esta vuelta del proceso. */
    const sinRecorte = new Set();

    async function foto(ruta) {
        if (!ruta) return { falta: true };
        try {
            const r = await fetch(APP + ruta, { signal: AbortSignal.timeout(10000) });
            if (r.status === 404) return { falta: true };
            if (!r.ok) return null;
            const b = Buffer.from(await r.arrayBuffer());
            return b.length > 1000 ? { jpeg: b } : { falta: true };
        } catch { return null; }
    }

    /** Lo que omni-vision ve en la foto, compacto para guardar. */
    async function analizar(jpeg, atributos) {
        const e = estado();
        const tarea = e.segmentar ? "segmentar" : "detectar";
        const q = new URLSearchParams({ tarea, grupos: GRUPOS, ...(atributos ? { atributos: "1" } : {}) });
        const r = await fetch(`${vision}/detectar?${q}`, { method: "POST", body: jpeg, headers: { "content-type": "image/jpeg" }, signal: AbortSignal.timeout(30000) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || `omni-vision respondió ${r.status}`);
        return {
            ancho: j.ancho, alto: j.alto, tarea,
            objetos: (j.objetos || []).map((o) => ({
                clase: o.clase, nombre: o.nombre, grupo: o.grupo, confianza: Math.round(o.confianza * 1000) / 1000,
                caja: (o.caja_norm || []).map(r4),
                ...(Array.isArray(o.silueta) ? { silueta: o.silueta.map((p) => aligerar(p).map(([x, y]) => [r4(x), r4(y)])) } : {}),
                ...(Array.isArray(o.atributos) ? { atributos: o.atributos.map((a) => ({ id: a.id, nombre: a.nombre, valor: a.valor, prob: Math.round(a.prob * 100) / 100, dudoso: !!a.dudoso })) } : {}),
            })),
        };
    }

    async function unaIntrusion() {
        const d = await prisma.detection.findFirst({
            where: { verifAt: null, type: { in: TIPOS_INTRUSION }, timestamp: { gte: new Date(Date.now() - VENTANA_INTRUSION_MS) } },
            orderBy: { timestamp: "desc" }, select: { id: true, deviceId: true, snapshotPath: true, timestamp: true },
        });
        if (!d) return false;
        const t0 = Date.now();
        // El cuadro propio se pide junto con la captura: cuanto antes, más cerca del cruce.
        const reciente = d.deviceId && Date.now() - d.timestamp.getTime() < PROPIO_MAX_MS;
        const [f, propio] = await Promise.all([foto(d.snapshotPath), reciente ? foto(`/api/snapshot/${d.deviceId}?w=1280&t=${Date.now()}`) : null]);
        if (!f) return false;
        if (f.falta) {
            if (Date.now() - d.timestamp.getTime() < FOTO_ESPERA_MS) return false;
            await prisma.detection.update({ where: { id: d.id }, data: { verifEstado: "SIN_FOTO", verifAt: new Date() } });
            contadores.sinFoto++;
            return true;
        }
        try {
            const a = await analizar(f.jpeg, false);
            if (propio?.jpeg) {
                // Se guarda en MinIO (bucket de visión): la ficha lo muestra al lado de la captura.
                const clave = `verificacion/${new Date().toISOString().slice(0, 10)}/${d.id}.jpg`;
                try {
                    await subir(clave, propio.jpeg);
                    a.propio = { foto: clave, despuesMs: Date.now() - d.timestamp.getTime(), ...(await analizar(propio.jpeg, false)) };
                } catch (e) { log("verificación: cuadro propio:", e.message); }
            }
            await prisma.detection.update({ where: { id: d.id }, data: { verifEstado: "OK", verifAnalisis: a, verifAt: new Date(), verifMs: Date.now() - t0, verifError: null } });
            contadores.verificadas++; contadores.msUltima = Date.now() - t0;
            emitir("detection_verified", { id: d.id });
        } catch (e) {
            await prisma.detection.update({ where: { id: d.id }, data: { verifEstado: "ERROR", verifAt: new Date(), verifError: String(e.message).slice(0, 300) } }).catch(() => null);
            contadores.errores++; contadores.ultimoError = e.message;
        }
        return true;
    }

    async function unaLectura() {
        const filas = await prisma.$queryRaw`
            SELECT e.id, e."snapshotPath" AS foto, e.timestamp
            FROM "AccessEvent" e LEFT JOIN "AnalisisFoto" a ON a."accessEventId" = e.id
            WHERE a.id IS NULL AND e."accessType" = 'PLATE' AND e."snapshotPath" IS NOT NULL
              AND e.timestamp > ${new Date(Date.now() - VENTANA_LPR_MS)}
            ORDER BY e.timestamp DESC LIMIT 1`;
        const ev = filas[0];
        if (!ev) return false;
        const t0 = Date.now();
        const f = await foto(ev.foto);
        if (!f) return false;
        const guardar = (data) => prisma.analisisFoto.upsert({ where: { accessEventId: ev.id }, create: { accessEventId: ev.id, ...data }, update: data });
        if (f.falta) {
            if (Date.now() - new Date(ev.timestamp).getTime() < FOTO_ESPERA_MS) return false;
            await guardar({ estado: "SIN_FOTO" }); contadores.sinFoto++;
            return true;
        }
        try {
            const a = await analizar(f.jpeg, estado().atributos);
            await guardar({ estado: "OK", analisis: a, ms: Date.now() - t0 });
            contadores.lecturas++; contadores.msUltima = Date.now() - t0;
            emitir("lectura_analizada", { accessEventId: ev.id });
        } catch (e) {
            await guardar({ estado: "ERROR", error: String(e.message).slice(0, 300), ms: Date.now() - t0 }).catch(() => null);
            contadores.errores++; contadores.ultimoError = e.message;
        }
        return true;
    }

    async function unaHuella() {
        const filas = await prisma.$queryRaw`
            SELECT o.id, o.recorte FROM "ObjetoVisto" o LEFT JOIN "HuellaObjeto" h ON h."objetoId" = o.id
            WHERE h."objetoId" IS NULL AND o.recorte IS NOT NULL AND o."ultimaVez" < ${new Date(Date.now() - PISTA_CERRADA_MS)}
            ORDER BY o."primeraVez" DESC LIMIT 20`;
        const o = filas.find((f) => !sinRecorte.has(f.id));
        if (!o) return false;
        let jpeg;
        try { jpeg = await bajar(o.recorte); } catch { sinRecorte.add(o.id); return true; }
        const r = await fetch(`${vision}/vector`, { method: "POST", body: jpeg, headers: { "content-type": "image/jpeg" }, signal: AbortSignal.timeout(20000) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok || !Array.isArray(j.vector)) throw new Error(j.error || `omni-vision respondió ${r.status}`);
        await prisma.huellaObjeto.upsert({ where: { objetoId: o.id }, create: { objetoId: o.id, ...aInt8(j.vector) }, update: aInt8(j.vector) });
        contadores.huellas++;
        return true;
    }

    let corriendo = true;
    (async function bucle() {
        log(`análisis de fotos: intrusión (${TIPOS_INTRUSION.join(", ")}), lecturas LPR y huellas para la búsqueda`);
        while (corriendo) {
            let hizo = false;
            try {
                const e = estado();
                if (e.detectar) {
                    // La intrusión primero: es la que un guardia está mirando para decidir.
                    if (e.verificar) hizo = await unaIntrusion();
                    if (!hizo && e.lpr) hizo = await unaLectura();
                    if (!hizo && e.huellas) hizo = await unaHuella();
                }
            } catch (err) {
                contadores.errores++; contadores.ultimoError = err.message;
            }
            await dormir(hizo ? PAUSA_MS : OCIOSO_MS);
        }
    })();

    return { contadores, parar: () => { corriendo = false; } };
}

module.exports = { iniciar };
