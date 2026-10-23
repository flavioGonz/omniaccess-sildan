/**
 * Relectura de las NO_LEIDA — corre dentro de vision-worker. Y desde el 14/10, la doble
 * verificación: en las cámaras con «lprVerifica» se relee también cada lectura de la cámara,
 * con el mismo procedimiento; si coincide o no se decide al mostrar (lib/verificacion-lpr.ts).
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
const { normalizarChapa } = require("./lib-chapa");
const http = require("http");

/**
 * Avisa a las pantallas por el socket de los webhooks (/internal/emit, como vision-analisis). Un
 * disparo sin vehículo se descarta en vivo: el Monitor LPR lo mostró al llegar (todavía no se
 * sabía) y lo saca apenas OmniVision dice que en la foto no hay ningún vehículo (24/10).
 */
function emitir(evento, datos) {
    try {
        const cuerpo = JSON.stringify({ __event: evento, ...datos });
        const req = http.request({ hostname: "127.0.0.1", port: Number(process.env.WEBHOOK_PORT || 10000), path: "/internal/emit", method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(cuerpo) }, timeout: 2000 });
        req.on("error", () => { }); req.on("timeout", () => req.destroy());
        req.write(cuerpo); req.end();
    } catch { }
}

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
/**
 * Doble verificación (cámaras con «lprVerifica»): además de las NO_LEIDA se relee CADA lectura,
 * para confirmar o marcar la diferencia. Sirve mientras el auto está en la pantalla del guardia;
 * hacia atrás alcanza con dos horas — ponerse al día con un día entero de lecturas buenas sería
 * gastar GPU en algo que ya nadie mira.
 */
const VENTANA_DOBLE_MS = 2 * 3600_000;
/** La foto del evento puede llegar tarde a MinIO: se espera esto antes de darla por perdida. */
const FOTO_ESPERA_MS = 90_000;
/** Pausa entre eventos con cola pendiente, y entre vueltas sin nada que hacer. */
const PAUSA_MS = 1500;
const OCIOSO_MS = 4000;
/**
 * Una relectura que falló por un corte (omni-vision u omni-lpr reiniciando, la app en pleno
 * despliegue: «fetch failed») se reintenta después de esto, hasta INTENTOS_MAX veces. Antes
 * quedaba ERROR para siempre, y esa NO_LEIDA se quedaba sin la doble verificación que tienen
 * todas las demás (medido el 12/10: 5 en dos días, todas «fetch failed» durante un despliegue).
 */
const REINTENTO_MS = 5 * 60_000;
const INTENTOS_MAX = 3;
/** Lado de los recortes que se guardan para mostrar. */
const LADO_VEHICULO = 480;
const ANCHO_CHAPA = 320;

/**
 * La chapa con forma del Mercosur, corregida por posición (lib-chapa.js), o null. Antes alcanzaba
 * con 6–8 caracteres con letras y números: el 22 % de las relecturas de una semana en San Nicolás
 * no tenía forma de chapa (15/10).
 */
const chapaDe = (t) => normalizarChapa(t)?.plate || null;
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
        const plate = chapaDe(it?.ocr?.text);
        if (!plate) continue;
        out.push({ plate, confianza: Math.min(promedio(it?.ocr?.confidence) || 0, it?.detection?.confidence ?? 1), caja: it?.detection?.bounding_box || null });
    }
    return out.sort((a, b) => b.confianza - a.confianza);
}

/** Segunda opinión con el OCR fino sobre la chapa sola. */
async function releer(chapa) {
    try {
        const d = await lpr("recognize_plate", { image_base64: chapa.toString("base64"), ocr_model: OCR_FINO }, 15000);
        return chapaDe(d?.[0]?.plate ?? d?.[0]?.ocr?.text);
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
    // `caja`: dónde está la chapa, en píxeles del recorte; quien llama la pasa a la foto entera.
    let mejor = { plate: m.plate, confianza: m.confianza, acuerdo: null, caja: m.caja };
    if (chapa) {
        const fina = await releer(chapa);
        if (fina && fina === m.plate) mejor = { ...mejor, confianza: Math.max(m.confianza, 0.9), acuerdo: true };
        else if (fina) mejor = { ...mejor, confianza: m.confianza * 0.8, acuerdo: false, fina };
    }
    return { mejor, otras: chapas.slice(1, 3).map((c) => ({ plate: c.plate, confianza: Math.round(c.confianza * 1000) / 1000 })), chapa };
}

/** La cámara leyó una chapa: esta relectura es la doble verificación, no la de una NO_LEIDA. */
const esDoble = (ev) => !!ev.chapa && !NO_LEIDAS.includes(ev.chapa);

function iniciar({ prisma, subir, ajuste, log, vision, activa, permitidas = () => null }) {
    const contadores = { hechas: 0, leidas: 0, dudosas: 0, sinChapa: 0, sinVehiculo: 0, sinFoto: 0, errores: 0, ultimoError: null, msUltima: null };

    async function pendientes() {
        // Primero las que nunca se miraron; después las que fallaron por un corte (ver REINTENTO_MS).
        // «createdAt» es la hora UTC sin zona: se compara contra now() en UTC, no contra un Date de
        // JS (la sesión está en hora de Montevideo y lo correría tres horas).
        return prisma.$queryRaw`
            SELECT e.id, e."snapshotPath" AS foto, e.timestamp, e."plateDetected" AS chapa, r.id AS rid,
                   COALESCE((r.candidatos->>'intentos')::int, 1) AS intentos
            FROM "AccessEvent" e LEFT JOIN "Relectura" r ON r."accessEventId" = e.id
                 LEFT JOIN "Device" d ON d.id = e."deviceId"
            WHERE e."accessType" = 'PLATE'
              -- Sólo las cámaras que OmniVision puede tocar (VISION_CAMARAS, el botón de la pared).
              AND (${!!(permitidas() || { todas: true }).todas}::boolean OR e."deviceId" = ANY(${(permitidas() || { ids: [] }).ids || []}::text[]))
              AND ((e."plateDetected" = ANY(${NO_LEIDAS}) AND e.timestamp > ${new Date(Date.now() - VENTANA_MS)})
                   OR (d."lprVerifica" = true AND e.timestamp > ${new Date(Date.now() - VENTANA_DOBLE_MS)}))
              AND (r.id IS NULL OR (r.estado = 'ERROR' AND r."createdAt" < (now() AT TIME ZONE 'UTC') - make_interval(secs => ${REINTENTO_MS / 1000})
                                    AND COALESCE((r.candidatos->>'intentos')::int, 1) < ${INTENTOS_MAX}))
            ORDER BY (r.id IS NULL) DESC, e.timestamp DESC LIMIT 5`;
    }

    /**
     * `doble`: la cámara SÍ había leído (doble verificación). Queda marcado en la fila porque
     * después no se puede saber: si el guardia corrige una NO_LEIDA, el evento también pasa a
     * tener chapa, y la pantalla de relecturas contaría como «corregida» una que nunca lo fue.
     */
    async function guardar(id, datos, rid, doble = false) {
        if (doble) datos = { ...datos, candidatos: { ...(datos.candidatos || {}), doble: true } };
        // Un reintento pisa su fila de ERROR (y le corre la fecha: de ahí se cuenta el próximo).
        if (rid) await prisma.relectura.update({ where: { id: rid }, data: { error: null, ...datos, createdAt: new Date() } });
        else await prisma.relectura.create({ data: { accessEventId: id, ...datos } }).catch((e) => {
            if (!String(e.message).includes("Unique")) throw e; // otra vuelta ya la hizo
        });
        // Disparo sin vehículo (23/10): la cámara no leyó chapa y en la foto no hay ningún vehículo.
        // Se marca en el evento para que el historial lo pueda dejar afuera sin cruzar tablas. Sólo
        // en una NO_LEIDA: en la doble verificación la cámara sí leyó una chapa.
        if (datos.estado === "SIN_VEHICULO" && !doble) {
            const r = await prisma.accessEvent.updateMany({ where: { id, plateDetected: { in: NO_LEIDAS } }, data: { sinVehiculo: true } }).catch(() => ({ count: 0 }));
            if (r.count) emitir("lectura_descartada", { accessEventId: id, motivo: "sin-vehiculo" });
        }
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
            await guardar(ev.id, { estado: "SIN_FOTO" }, ev.rid, esDoble(ev)); contadores.sinFoto++;
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

        let mejor = null, otras = [], vehiculo = null, recorteV = null, chapa = null, cajaChapa = null;
        /**
         * La caja de la chapa en la foto ENTERA, normalizada 0-1: la pantalla la dibuja dentro de la
         * silueta del vehículo, como un recuadro más de lo que vio OmniVision (Nico, 15/10).
         */
        const aFoto = (c, dx, dy) => (c && W && H ? [(dx + c.x1) / W, (dy + c.y1) / H, (dx + c.x2) / W, (dy + c.y2) / H].map((n) => Math.round(Math.min(1, Math.max(0, n)) * 10000) / 10000) : null);
        for (const v of vehiculos) {
            const [x1, y1, x2, y2] = v.caja;
            const mw = (x2 - x1) * MARGEN, mh = (y2 - y1) * MARGEN;
            const left = Math.max(0, Math.floor(x1 - mw)), top = Math.max(0, Math.floor(y1 - mh));
            const width = Math.max(1, Math.min(W - left, Math.ceil(x2 - x1 + 2 * mw))), height = Math.max(1, Math.min(H - top, Math.ceil(y2 - y1 + 2 * mh)));
            const rec = await sharp(jpeg).extract({ left, top, width, height }).jpeg({ quality: 92 }).toBuffer();
            const l = await leerRecorte(rec);
            if (l.mejor && (!mejor || l.mejor.confianza > mejor.confianza)) {
                if (mejor) otras.push({ plate: mejor.plate, confianza: Math.round(mejor.confianza * 1000) / 1000 });
                mejor = l.mejor; vehiculo = v.clase; recorteV = rec; chapa = l.chapa; cajaChapa = aFoto(l.mejor.caja, left, top);
                otras.push(...l.otras);
            } else if (l.mejor) otras.push({ plate: l.mejor.plate, confianza: Math.round(l.mejor.confianza * 1000) / 1000 }, ...l.otras);
            if (!recorteV) recorteV = rec;
        }
        // Sin vehículo a la vista (de noche, a contraluz, la trompa cortada): la foto entera,
        // que es lo que haría la lectora. Rara vez sirve, pero cuesta una inferencia.
        if (!vehiculos.length) {
            const l = await leerRecorte(jpeg);
            if (l.mejor) { mejor = l.mejor; otras = l.otras; chapa = l.chapa; cajaChapa = aFoto(l.mejor.caja, 0, 0); }
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
            candidatos: { otras: unicas, acuerdo: mejor?.acuerdo ?? null, fina: mejor?.fina || null, caja: mejor ? cajaChapa : null },
            vehiculo, vehiculos: vehiculos.length, recorte, recorteChapa, ms: Date.now() - t0,
        }, ev.rid, esDoble(ev));
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
                            // Se reintenta hasta INTENTOS_MAX veces (cada REINTENTO_MS); después queda registrado.
                            await guardar(ev.id, { estado: "ERROR", error: String(e.message).slice(0, 300), candidatos: { intentos: Number(ev.intentos || 0) + (ev.rid ? 1 : 0) || 1 } }, ev.rid, esDoble(ev)).catch(() => null);
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
