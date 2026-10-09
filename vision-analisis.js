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
/** La foto puede llegar a MinIO unos segundos después del evento. */
const FOTO_ESPERA_MS = 90_000;
const PAUSA_MS = 400;
const OCIOSO_MS = 3000;
/** Más puntos por silueta no se ven y pesan en la base (el mismo tope que src/lib/vision-capa.ts). */
const PUNTOS_SILUETA_MAX = 80;
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
function iniciar({ prisma, log, vision, estado }) {
    const contadores = { verificadas: 0, lecturas: 0, sinFoto: 0, errores: 0, ultimoError: null, msUltima: null };

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
            orderBy: { timestamp: "desc" }, select: { id: true, snapshotPath: true, timestamp: true },
        });
        if (!d) return false;
        const t0 = Date.now();
        const f = await foto(d.snapshotPath);
        if (!f) return false;
        if (f.falta) {
            if (Date.now() - d.timestamp.getTime() < FOTO_ESPERA_MS) return false;
            await prisma.detection.update({ where: { id: d.id }, data: { verifEstado: "SIN_FOTO", verifAt: new Date() } });
            contadores.sinFoto++;
            return true;
        }
        try {
            const a = await analizar(f.jpeg, false);
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

    let corriendo = true;
    (async function bucle() {
        log(`análisis de fotos: intrusión (${TIPOS_INTRUSION.join(", ")}) y lecturas LPR`);
        while (corriendo) {
            let hizo = false;
            try {
                const e = estado();
                if (e.detectar) {
                    // La intrusión primero: es la que un guardia está mirando para decidir.
                    if (e.verificar) hizo = await unaIntrusion();
                    if (!hizo && e.lpr) hizo = await unaLectura();
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
