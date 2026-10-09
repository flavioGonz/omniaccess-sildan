/**
 * Relectura de las NO_LEIDA — corre dentro de vision-worker.
 *
 * Cuando la lectora de un acceso (la Hikvision con su ANPR) no lee la chapa, el evento queda
 * como NO_LEIDA con su foto. Acá se toma esa foto, omni-vision encuentra el vehículo, se lo
 * recorta y omni-lpr lee el recorte. Medido el 9/10 sobre 80 capturas reales de las barreras
 * (services/omni-vision/herramientas/comparar_lpr.py): leyendo primero el vehículo, la
 * matrícula exacta pasó de 17 a 28 de 40, y en las NO_LEIDA de la cámara leyó algo en 26 de 40.
 * En la foto entera la chapa ocupa pocos píxeles del cuadro que ve el detector de chapas; en
 * el recorte ocupa muchos más.
 *
 * Es una SUGERENCIA para el guardia y nada más:
 *  · no cambia el evento (sigue siendo NO_LEIDA en el historial),
 *  · no cambia lo que decidió la barrera,
 *  · no toca server.js.
 * Se guarda una fila por evento en `Relectura`, también cuando no se pudo leer: para no
 * reintentar, y para poder medir cuánto sirve.
 *
 * Cuidado con omni-lpr: con concurrencia sobre la misma sesión de CUDA ya se cayó (ver
 * MAX_EN_VUELO en tracking-worker). Acá va un pedido por vez, un evento por vez y con pausa
 * entre eventos. Con ~230 NO_LEIDA por día (medido el 9/10: 161 en Salida, 69 en Entrada) son
 * unas diez por hora.
 */

const sharp = require("sharp");

const APP = (process.env.APP_INTERNAL_URL || "http://127.0.0.1:10001").replace(/\/$/, "");
const LPR = (process.env.OMNI_LPR_URL || "http://127.0.0.1:8000").replace(/\/$/, "");
/** Los mismos modelos que el seguimiento (tracking-worker): el chico para encontrar y leer, el fino para la segunda opinión. */
const DETECTOR = process.env.TRACKING_DETECTOR || "yolo-v9-t-640-license-plate-end2end";
const OCR = process.env.TRACKING_OCR || "cct-xs-v1-global-model";
const OCR_FINO = process.env.TRACKING_OCR_FINE || "cct-s-v1-global-model";

/** Lo que la lectora escribe cuando no leyó. */
const NO_LEIDAS = ["NO_LEIDA", "UNKNOWN", "unknown", "S/P"];
/** Clases de vehículo que se recortan. */
const VEHICULOS = new Set(["car", "truck", "bus", "motorcycle"]);
/** Margen alrededor del vehículo: el mismo con el que se midió (10 %). */
const MARGEN = 0.10;
/** Umbral del detector para encontrar el vehículo: más bajo que el del registro, acá sólo importa recortar. */
const UMBRAL_VEHICULO = 0.35;
/** Cuántos vehículos se leen por foto, de mayor a menor: el de la barrera suele ser el más grande. */
const VEHICULOS_MAX = 3;
/**
 * Desde qué confianza la relectura se muestra como lectura y no como «dudosa». Valor de
 * arranque: se revisa con la estadística de coincidencias (la misma chapa leída por otra
 * cámara ese día), que es lo único que dice si una relectura estaba bien.
 */
const CONF_SEGURA = Number(process.env.RELECTURA_CONF_SEGURA || 0.7);
/** El umbral vigente lo pone la pantalla de relecturas (Setting RELECTURA_CONF_SEGURA, ver src/lib/relectura-umbral.ts). */
const CLAVE_UMBRAL = "RELECTURA_CONF_SEGURA";
const UMBRAL_MIN = 0.5, UMBRAL_MAX = 0.99;
/** Hasta cuándo se relee hacia atrás: al arrancar se pone al día con el último día. */
const VENTANA_MS = 24 * 3600_000;
/** La foto del evento puede llegar tarde a MinIO: se espera esto antes de darla por perdida. */
const FOTO_ESPERA_MS = 90_000;
/** Pausa entre eventos con cola pendiente, y entre vueltas sin nada que hacer. */
const PAUSA_MS = 1500;
const OCIOSO_MS = 4000;
/** Lado de los recortes que se guardan para mostrar. */
const LADO_VEHICULO = 480;
const ANCHO_CHAPA = 320;

const limpia = (t) => String(t || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const parece = (p) => !!p && p.length >= 6 && p.length <= 8 && /[A-Z]/.test(p) && /[0-9]/.test(p);
const promedio = (c) => (Array.isArray(c) ? (c.length ? c.reduce((a, b) => a + b, 0) / c.length : 0) : (c ?? 0));
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

async function lpr(herramienta, cuerpo, ms = 20000) {
    const r = await fetch(`${LPR}/api/v1/tools/${herramienta}/invoke`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo), signal: AbortSignal.timeout(ms),
    });
    if (!r.ok) throw new Error(`omni-lpr respondió ${r.status}`);
    const d = await r.json();
    return d?.content?.[0]?.data || [];
}

/** Las chapas de un recorte, con la caja de cada una (en píxeles del recorte). */
async function leerChapas(jpeg) {
    const items = await lpr("detect_and_recognize_plate", { image_base64: jpeg.toString("base64"), detector_model: DETECTOR, ocr_model: OCR });
    const out = [];
    for (const it of items) {
        const plate = limpia(it?.ocr?.text);
        if (!parece(plate)) continue;
        out.push({ plate, confianza: Math.min(promedio(it?.ocr?.confidence) || 0, it?.detection?.confidence ?? 1), caja: it?.detection?.bounding_box || null });
    }
    return out.sort((a, b) => b.confianza - a.confianza);
}

/** Segunda opinión con el OCR fino sobre la chapa sola. */
async function releer(chapa) {
    try {
        const d = await lpr("recognize_plate", { image_base64: chapa.toString("base64"), ocr_model: OCR_FINO }, 15000);
        const t = limpia(d?.[0]?.plate ?? d?.[0]?.ocr?.text);
        return parece(t) ? t : null;
    } catch { return null; }
}

async function recortarChapa(jpeg, caja) {
    if (!caja) return null;
    const meta = await sharp(jpeg).metadata();
    const aire = 0.12;
    const an = caja.x2 - caja.x1, al = caja.y2 - caja.y1;
    const x = Math.max(0, Math.round(caja.x1 - an * aire)), y = Math.max(0, Math.round(caja.y1 - al * aire));
    const w = Math.min((meta.width || 0) - x, Math.round(an * (1 + 2 * aire))), h = Math.min((meta.height || 0) - y, Math.round(al * (1 + 2 * aire)));
    if (w < 20 || h < 10) return null;
    return sharp(jpeg).extract({ left: x, top: y, width: w, height: h }).jpeg({ quality: 95 }).toBuffer();
}

/**
 * Lee un recorte: la mejor chapa con su segunda opinión. Cuando los dos OCR coinciden, la
 * lectura vale más (lo mismo que hace el seguimiento); cuando no, se baja la confianza.
 */
async function leerRecorte(jpeg) {
    const chapas = await leerChapas(jpeg);
    if (!chapas.length) return { mejor: null, otras: [], chapa: null };
    const m = chapas[0];
    const chapa = await recortarChapa(jpeg, m.caja).catch(() => null);
    let mejor = { plate: m.plate, confianza: m.confianza, acuerdo: null };
    if (chapa) {
        const fina = await releer(chapa);
        if (fina && fina === m.plate) mejor = { ...mejor, confianza: Math.max(m.confianza, 0.9), acuerdo: true };
        else if (fina) mejor = { ...mejor, confianza: m.confianza * 0.8, acuerdo: false, fina };
    }
    return { mejor, otras: chapas.slice(1, 3).map((c) => ({ plate: c.plate, confianza: Math.round(c.confianza * 1000) / 1000 })), chapa };
}

function iniciar({ prisma, subir, ajuste, log, vision, activa }) {
    const contadores = { hechas: 0, leidas: 0, dudosas: 0, sinChapa: 0, sinVehiculo: 0, sinFoto: 0, errores: 0, ultimoError: null, msUltima: null };

    async function pendientes() {
        return prisma.$queryRaw`
            SELECT e.id, e."snapshotPath" AS foto, e.timestamp
            FROM "AccessEvent" e LEFT JOIN "Relectura" r ON r."accessEventId" = e.id
            WHERE r.id IS NULL AND e."accessType" = 'PLATE' AND e."plateDetected" = ANY(${NO_LEIDAS})
              AND e.timestamp > ${new Date(Date.now() - VENTANA_MS)}
            ORDER BY e.timestamp DESC LIMIT 5`;
    }

    async function guardar(id, datos) {
        await prisma.relectura.create({ data: { accessEventId: id, ...datos } }).catch((e) => {
            if (!String(e.message).includes("Unique")) throw e; // otra vuelta ya la hizo
        });
    }

    /**
     * La foto del evento: { jpeg }, { falta: true } si de verdad no existe (sin ruta, 404, vacía),
     * o null si no se pudo preguntar (la app reiniciando, un corte). Sólo lo primero se da por
     * perdido: con la app en pleno despliegue, todas las fotos «faltaban» y se habrían marcado
     * SIN_FOTO para siempre.
     */
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

    async function relectura(ev) {
        const t0 = Date.now();
        const f = await foto(ev.foto);
        if (!f) return false; // no se pudo preguntar: se reintenta en otra vuelta
        if (f.falta) {
            if (Date.now() - new Date(ev.timestamp).getTime() < FOTO_ESPERA_MS) return false; // todavía puede llegar
            await guardar(ev.id, { estado: "SIN_FOTO" }); contadores.sinFoto++;
            return true;
        }
        const jpeg = f.jpeg;
        const meta = await sharp(jpeg).metadata();
        const W = meta.width || 0, H = meta.height || 0;
        const r = await fetch(`${vision}/detectar?grupos=vehiculo&umbral=${UMBRAL_VEHICULO}`, {
            method: "POST", body: jpeg, headers: { "content-type": "image/jpeg" }, signal: AbortSignal.timeout(20000),
        });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || `omni-vision respondió ${r.status}`);
        const vehiculos = (d.objetos || []).filter((o) => VEHICULOS.has(o.clase) && !o.alternativa)
            .map((o) => ({ ...o, area: (o.caja[2] - o.caja[0]) * (o.caja[3] - o.caja[1]) }))
            .sort((a, b) => b.area - a.area).slice(0, VEHICULOS_MAX);

        let mejor = null, otras = [], vehiculo = null, recorteV = null, chapa = null;
        for (const v of vehiculos) {
            const [x1, y1, x2, y2] = v.caja;
            const mw = (x2 - x1) * MARGEN, mh = (y2 - y1) * MARGEN;
            const left = Math.max(0, Math.floor(x1 - mw)), top = Math.max(0, Math.floor(y1 - mh));
            const width = Math.max(1, Math.min(W - left, Math.ceil(x2 - x1 + 2 * mw))), height = Math.max(1, Math.min(H - top, Math.ceil(y2 - y1 + 2 * mh)));
            const rec = await sharp(jpeg).extract({ left, top, width, height }).jpeg({ quality: 92 }).toBuffer();
            const l = await leerRecorte(rec);
            if (l.mejor && (!mejor || l.mejor.confianza > mejor.confianza)) {
                if (mejor) otras.push({ plate: mejor.plate, confianza: Math.round(mejor.confianza * 1000) / 1000 });
                mejor = l.mejor; vehiculo = v.clase; recorteV = rec; chapa = l.chapa;
                otras.push(...l.otras);
            } else if (l.mejor) otras.push({ plate: l.mejor.plate, confianza: Math.round(l.mejor.confianza * 1000) / 1000 }, ...l.otras);
            if (!recorteV) recorteV = rec;
        }
        // Sin vehículo a la vista (de noche, a contraluz, la trompa cortada): la foto entera,
        // que es lo que haría la lectora. Rara vez sirve, pero cuesta una inferencia.
        if (!vehiculos.length) {
            const l = await leerRecorte(jpeg);
            if (l.mejor) { mejor = l.mejor; otras = l.otras; chapa = l.chapa; }
        }

        const dia = new Date().toISOString().slice(0, 10);
        let recorte = null, recorteChapa = null;
        // Sin recorte guardado la relectura vale igual: sólo no se ve la foto.
        if (recorteV) {
            const clave = `relectura/${dia}/${ev.id}-v.jpg`;
            try { await subir(clave, await sharp(recorteV).resize(LADO_VEHICULO, LADO_VEHICULO, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer()); recorte = clave; }
            catch (e) { log("relectura: no se pudo guardar el recorte:", e.message); }
        }
        if (chapa && mejor) {
            const clave = `relectura/${dia}/${ev.id}-c.jpg`;
            try { await subir(clave, await sharp(chapa).resize({ width: ANCHO_CHAPA, withoutEnlargement: true }).jpeg({ quality: 88 }).toBuffer()); recorteChapa = clave; }
            catch (e) { log("relectura: no se pudo guardar la chapa:", e.message); }
        }

        const u = Number(await ajuste(CLAVE_UMBRAL, null));
        const segura = Number.isFinite(u) && u >= UMBRAL_MIN && u <= UMBRAL_MAX ? u : CONF_SEGURA;
        const estado = mejor ? (mejor.confianza >= segura ? "LEIDA" : "DUDOSA") : (vehiculos.length ? "SIN_CHAPA" : "SIN_VEHICULO");
        const unicas = [...new Map(otras.filter((o) => !mejor || o.plate !== mejor.plate).map((o) => [o.plate, o])).values()].slice(0, 4);
        await guardar(ev.id, {
            estado, plate: mejor?.plate || null, confianza: mejor ? Math.round(mejor.confianza * 1000) / 1000 : null,
            candidatos: { otras: unicas, acuerdo: mejor?.acuerdo ?? null, fina: mejor?.fina || null },
            vehiculo, vehiculos: vehiculos.length, recorte, recorteChapa, ms: Date.now() - t0,
        });
        contadores.hechas++; contadores.msUltima = Date.now() - t0;
        if (estado === "LEIDA") contadores.leidas++; else if (estado === "DUDOSA") contadores.dudosas++;
        else if (estado === "SIN_CHAPA") contadores.sinChapa++; else contadores.sinVehiculo++;
        return true;
    }

    let corriendo = true;
    let ultimoLog = 0;
    (async function bucle() {
        log(`relectura de NO_LEIDA · omni-lpr ${LPR} · segura desde ${CONF_SEGURA}`);
        while (corriendo) {
            let hizo = false;
            try {
                const lectorPrendido = (await ajuste("OMNI_LPR_ENABLED", "false")) === "true";
                if (activa() && lectorPrendido) {
                    for (const ev of await pendientes()) {
                        if (!corriendo) break;
                        try { if (await relectura(ev)) { hizo = true; break; } }
                        catch (e) {
                            contadores.errores++; contadores.ultimoError = e.message;
                            // Un error de un evento no se reintenta para siempre: queda registrado.
                            await guardar(ev.id, { estado: "ERROR", error: String(e.message).slice(0, 300) }).catch(() => null);
                            if (Date.now() - ultimoLog > 60_000) { log("relectura:", e.message); ultimoLog = Date.now(); }
                            hizo = true; break;
                        }
                    }
                }
            } catch (e) { if (Date.now() - ultimoLog > 60_000) { log("relectura (vuelta):", e.message); ultimoLog = Date.now(); } }
            await dormir(hizo ? PAUSA_MS : OCIOSO_MS);
        }
    })();

    return { contadores, parar: () => { corriendo = false; } };
}

module.exports = { iniciar, NO_LEIDAS, CONF_SEGURA };
