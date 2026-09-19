// La configuracion sale de .env, igual que la del resto del sistema.
//
// Hasta ahora este proceso NO lo leia: su entorno era el del shell desde el que se lo
// arranco a mano, capturado por pm2 y guardado ahi para siempre. Eso convertia cualquier
// ajuste en .env en una ilusion -- se editaba el archivo, se reiniciaba, y no pasaba nada,
// porque el valor efectivo estaba congelado en el volcado de pm2. Llego a haber dos
// verdades distintas sobre el mismo parametro y ninguna forma de saber cual corria.
require("dotenv").config();

/**
 * Pasarela de camaras comunes -> Omni-LPR -> avistamientos.
 *
 * Una camara comun no sabe leer matriculas, pero sirve como sensor. Esta pasarela
 * la convierte en lector apoyandose en el contenedor de Omni-LPR, y todo corre por
 * fuera del camino de la barrera: si esto se cae, el control de acceso sigue igual.
 *
 * Tres decisiones que valen la pena explicar, porque son las que hacen la diferencia
 * entre "lee a veces" y "lee siempre que pasa un auto":
 *
 * 1. RECORTAR ANTES DE ESCALAR. El canal principal de estas camaras entrega
 *    2688x1520. Si se achica el cuadro entero a 1280 antes de leerlo, la chapa
 *    pierde mas de la mitad de sus pixeles justo cuando mas se necesitan. Aca se
 *    recorta primero la zona de interes a resolucion nativa y recien despues se
 *    limita el lado largo. La imagen que ve el lector es mas chica Y tiene mas
 *    detalle donde importa: sube el acierto y baja el consumo al mismo tiempo.
 *
 * 2. QUE DISPARE LA CAMARA. El modo "escena" mira el cambio global de imagen, asi
 *    que se despierta con una sombra o una rama y se pierde un auto rapido entre
 *    dos muestras. Estas Hikvision clasifican persona/vehiculo en el propio equipo:
 *    en modo "camara" la pasarela escucha su flujo de eventos y solo lee cuadros
 *    cuando el equipo dice que paso un vehiculo. La GPU queda en reposo el resto
 *    del tiempo.
 *
 * 3. RAFAGA Y VOTACION. Una lectura suelta es una apuesta. Cada disparo toma varios
 *    cuadros -- incluidos los de justo ANTES del aviso, que suelen ser los mejores,
 *    gracias a un buffer circular -- los lee todos y los consolida: gana la matricula
 *    en la que coinciden, caracter por caracter. Asi se resuelven los 0/O y 8/B por
 *    acuerdo entre cuadros, y lo que aparece una sola vez se descarta por sospechoso.
 *    Se guarda UN avistamiento por paso, no una fila por cuadro.
 *
 * Configuracion: dispositivos de tipo LPR_INTERIOR (Dispositivos LPR) con su URL
 * RTSP, zona de interes y modo de disparo. Se mantiene el Setting TRACK_CAMERAS
 * como respaldo de instalaciones viejas.
 */
const { spawn, execFile } = require("child_process");
const http = require("http");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();
const LPR_URL = process.env.OMNI_LPR_URL || "http://127.0.0.1:8000";
const APP_URL = process.env.INTERNAL_BASE_URL || "http://127.0.0.1:10001";
const MIN_CONF = Number(process.env.TRACKING_MIN_CONFIDENCE || 0.6);
const DIR_SHOTS = process.env.TRACKING_SHOTS_DIR || "/datos/track";
const MAX_EN_VUELO = Number(process.env.TRACKING_MAX_INFLIGHT || 2);

// Ancho maximo que se le manda al lector DESPUES del recorte. No se agranda nunca:
// si el recorte ya es mas chico, va tal cual (ampliar no inventa detalle, solo gasta).
const ANCHO_MAX = Number(process.env.TRACKING_MAX_WIDTH || 1600);
// Buffer circular: cuantos cuadros recientes se guardan para poder mirar hacia atras.
const MEMORIA_CUADROS = Number(process.env.TRACKING_RING || 12);
// Ventana de la rafaga alrededor del disparo.
const RAFAGA_ANTES_MS = Number(process.env.TRACKING_BURST_BEFORE_MS || 800);
const RAFAGA_DESPUES_MS = Number(process.env.TRACKING_BURST_AFTER_MS || 1200);
const RAFAGA_MAX_CUADROS = Number(process.env.TRACKING_BURST_FRAMES || 8);
// Tiempo mudo tras resolver una rafaga, para no leer el mismo auto tres veces.
const MUDO_MS = Number(process.env.TRACKING_QUIET_MS || 4000);
// Cuantos cuadros tienen que coincidir para dar una lectura por buena...
const COINCIDENCIAS_MIN = Number(process.env.TRACKING_MIN_AGREE || 2);
// ...salvo que una sola lectura venga muy segura.
const CONF_ALTA = Number(process.env.TRACKING_HIGH_CONF || 0.85);
/** Cuantas chapas se atienden por recorte: mas que esto en una baldosa es ruido. */
const CHAPAS_POR_BALDOSA = Number(process.env.TRACKING_PLATES_PER_TILE || 3);
/**
 * Piso para releer. La segunda lectura cuesta dos inferencias y sirve para decidir
 * entre B y 8, no para rescatar un recorte de pasto que el detector creyo chapa: por
 * debajo de esto la lectura se va a descartar igual, y releerla es GPU tirada.
 */
const RELEER_MIN = Number(process.env.TRACKING_RECHECK_MIN || 0.35);
// Si la camara dejo de avisar por este tiempo, la pasarela vuelve sola al disparo
// por escena. Vale para una regla mal dibujada, un firmware que dejo de clasificar
// o un cambio en la camara hecho desde su propia web: el seguimiento sigue dando
// algo en vez de quedarse mudo sin que nadie se entere.
const RESPALDO_MS = Number(process.env.TRACKING_FALLBACK_MS || 15 * 60 * 1000);
// El lector reescala la imagen por dentro antes de buscar la matricula, asi que lo
// que decide si la ve no son los pixeles de la foto sino QUE FRACCION del encuadre
// ocupa la chapa. Mandar un cuadro panoramico es peor que mandar tres pedazos: la
// misma calle entera devuelve nada, y partida en baldosas devuelve la matricula con
// 0,9 de confianza. De ahi que el cuadro se corte antes de leerlo.
const BALDOSA_PX = Number(process.env.TRACKING_TILE_PX || 800);
const BALDOSA_SOLAPE = Number(process.env.TRACKING_TILE_OVERLAP || 0.18);
// Techo de inferencias por rafaga, para que una calle con movimiento no acapare la GPU.
const INFERENCIAS_MAX = Number(process.env.TRACKING_BURST_INFER || 24);

// Modelos del lector. El detector por defecto del contenedor es el de 384 px, el mas
// chico de los seis: achica cualquier imagen a eso antes de buscar nada, y por eso un
// cuadro panoramico no devolvia ninguna matricula. Medido sobre el mismo cuadro:
//   384 -> nada · 512 -> 0,41 · 640 -> 0,68 · s-608 -> 0,64
// y en caliente la diferencia es de 15 a 24 ms, asi que no hay motivo para el chico.
const DETECTOR = process.env.TRACKING_DETECTOR || "yolo-v9-t-640-license-plate-end2end";
const OCR = process.env.TRACKING_OCR || "cct-xs-v1-global-model";
// Segunda lectura sobre el recorte de la chapa, con el modelo grande. Es barata porque
// la imagen es diminuta, y es donde se juegan las confusiones de un solo caracter.
const OCR_FINO = process.env.TRACKING_OCR_FINE || "cct-s-v1-global-model";
const RELEER = (process.env.TRACKING_SECOND_PASS || "true") !== "false";

let token = process.env.TRACKING_TOKEN || "";
const camarasVivas = new Map();   // nombre -> estado de esa camara

const log = (...a) => console.log(new Date().toISOString(), "[track]", ...a);

/** Modos en los que es la camara la que avisa: por zona de intrusion o por cruce de linea. */
const porAviso = (m) => m === "camara" || m === "zona" || m === "linea";

// Contadores del minuto en curso. Se vuelcan a la muestra y se ponen en cero.
const contadores = { disparos: 0, lecturas: 0, descartes: 0, fueraDeLinea: 0 };

// Ancho de la banda de la linea de pasada, medido en alturas de la chapa leida.
// Se mide asi y no en fracciones fijas porque la chapa se ve mas chica cuanto mas
// lejos esta: en alturas de chapa, la banda se adapta sola a la distancia.
const BANDA_ALTURAS = Number(process.env.TRACKING_LINE_BAND_HEIGHTS || 6);
const BANDA_MIN = Number(process.env.TRACKING_LINE_BAND_MIN || 0.06);
const BANDA_MAX = Number(process.env.TRACKING_LINE_BAND_MAX || 0.35);

async function ajuste(clave, porDefecto = null) {
    try { const r = await prisma.setting.findUnique({ where: { key: clave } }); return r?.value ?? porDefecto; }
    catch { return porDefecto; }
}

/** La ubicacion sale del mapa del barrio, asi no hay que escribir coordenadas a mano. */
async function ubicacionesDelMapa() {
    try {
        const r = await prisma.setting.findUnique({ where: { key: "BARRIO_MAP" } });
        const d = JSON.parse(r?.value || "{}");
        const m = {};
        for (const c of d?.cameras || []) if (c?.deviceId) m[c.deviceId] = { lat: c.lat, lng: c.lng };
        return m;
    } catch { return {}; }
}

async function camaras() {
    // Funcion opcional: con el interruptor de Modos > LPR apagado no corre nada.
    if ((await ajuste("OMNI_LPR_ENABLED", "false")) !== "true") return [];

    const lista = [];
    try {
        const ubic = await ubicacionesDelMapa();
        const devs = await prisma.device.findMany({
            where: { deviceType: "LPR_INTERIOR", trackEnabled: true, NOT: { rtspUrl: null } },
            select: {
                id: true, name: true, rtspUrl: true, ip: true, username: true, password: true,
                trackScene: true, trackRoi: true, trackMinConf: true, trackFps: true, trackTrigger: true,
                trackLine: true,
            },
        });
        for (const d of devs) {
            if (!d.rtspUrl || !d.rtspUrl.trim()) continue;
            let roi = null;
            try { roi = d.trackRoi ? JSON.parse(d.trackRoi) : null; } catch { }
            let linea = null;
            try { linea = d.trackLine ? JSON.parse(d.trackLine) : null; } catch { }
            if (linea && !(Number.isFinite(linea.x1) && Number.isFinite(linea.y1)
                && Number.isFinite(linea.x2) && Number.isFinite(linea.y2))) linea = null;
            lista.push({
                name: d.name,
                rtsp: d.rtspUrl.trim(),
                deviceId: d.id,
                ip: d.ip || null,
                usuario: d.username || null,
                clave: d.password || null,
                lat: ubic[d.id]?.lat ?? null,
                lng: ubic[d.id]?.lng ?? null,
                escena: d.trackScene ?? undefined,
                roi,
                linea,
                confianza: d.trackMinConf ?? undefined,
                fps: d.trackFps ?? undefined,
                disparo: d.trackTrigger || "escena",
            });
        }
    } catch (e) { log("no se pudieron leer los dispositivos interiores:", e.message); }

    if (lista.length === 0) {
        const raw = await ajuste("TRACK_CAMERAS", "[]");
        try {
            const arr = JSON.parse(raw || "[]");
            if (Array.isArray(arr)) lista.push(...arr.filter((c) => c && c.rtsp && c.name && c.activa !== false));
        } catch { }
    }
    return lista;
}

// ─────────────────────────── Lectura ───────────────────────────

/**
 * Parte un cuadro en baldosas con solape. El solape importa: una matricula justo en
 * la union se perderia en las dos mitades, y con 18% siempre cae entera en alguna.
 */
async function baldosas(jpeg) {
    try {
        const meta = await sharp(jpeg).metadata();
        const an = meta.width || 0, al = meta.height || 0;
        if (!an || !al) return [{ jpeg, dx: 0, dy: 0, AN: 0, AL: 0 }];
        const cols = Math.max(1, Math.ceil(an / BALDOSA_PX));
        const filas = Math.max(1, Math.ceil(al / BALDOSA_PX));
        if (cols === 1 && filas === 1) return [{ jpeg, dx: 0, dy: 0, AN: an, AL: al }];

        const anchoUtil = an / cols, altoUtil = al / filas;
        const margenX = anchoUtil * BALDOSA_SOLAPE, margenY = altoUtil * BALDOSA_SOLAPE;
        const trozos = [];
        for (let f = 0; f < filas; f++) {
            for (let c = 0; c < cols; c++) {
                const x = Math.max(0, Math.round(c * anchoUtil - margenX));
                const y = Math.max(0, Math.round(f * altoUtil - margenY));
                const w = Math.min(an - x, Math.round(anchoUtil + 2 * margenX));
                const h = Math.min(al - y, Math.round(altoUtil + 2 * margenY));
                if (w < 60 || h < 40) continue;
                trozos.push({
                    jpeg: await sharp(jpeg).extract({ left: x, top: y, width: w, height: h }).jpeg({ quality: 88 }).toBuffer(),
                    dx: x, dy: y, AN: an, AL: al,
                });
            }
        }
        return trozos.length ? trozos : [{ jpeg, dx: 0, dy: 0, AN: an, AL: al }];
    } catch {
        return [{ jpeg, dx: 0, dy: 0, AN: 0, AL: 0 }];
    }
}

/**
 * Donde cayo la chapa dentro del CUADRO ENTERO, en fracciones {x,y,w,h}.
 *
 * El detector trabaja sobre la baldosa, asi que devuelve pixeles relativos a ella.
 * Sin esta traduccion el recuadro no sirve para nada: ni para saber si el auto se
 * movio, ni para saber si paso por la linea.
 */
function recuadroEnCuadro(caja, t) {
    if (!caja || !t || !t.AN || !t.AL) return null;
    const x1 = (t.dx + caja.x1) / t.AN, x2 = (t.dx + caja.x2) / t.AN;
    const y1 = (t.dy + caja.y1) / t.AL, y2 = (t.dy + caja.y2) / t.AL;
    const x = Math.min(x1, x2), y = Math.min(y1, y2);
    const w = Math.abs(x2 - x1), h = Math.abs(y2 - y1);
    if (!(w > 0 && h > 0) || x < -0.05 || y < -0.05 || x > 1.05 || y > 1.05) return null;
    return { x: +x.toFixed(4), y: +y.toFixed(4), w: +w.toFixed(4), h: +h.toFixed(4), ar: t.AN / t.AL };
}

/**
 * La linea de pasada, aplicada como COMPUERTA y no como alambre.
 *
 * Un alambre de verdad (cruzar de un lado al otro) necesita dos lecturas del mismo
 * auto en lados opuestos. Aca los autos no van despacio y no hay barrera que los
 * frene, asi que muchas pasadas dejan una sola lectura buena: pedir el cruce
 * perderia justo los autos que mas interesan.
 *
 * Entonces la linea define una banda: cuenta lo que pasa CERCA de ella y se descarta
 * lo demas. Un auto estacionado en otra parte del cuadro no entra nunca. Uno parado
 * justo sobre la linea si entra, y de ese se ocupa la deteccion de quieto, que lo
 * agrupa en una sola estadia en vez de repetirlo.
 *
 * Las distancias van en alturas de cuadro (la x se corrige por la relacion de
 * aspecto), que es lo que se ve derecho en la imagen.
 */
function cercaDeLaLinea(recuadro, linea) {
    const ar = recuadro.ar || 1;
    const px = (recuadro.x + recuadro.w / 2) * ar, py = recuadro.y + recuadro.h / 2;
    const x1 = linea.x1 * ar, y1 = linea.y1, x2 = linea.x2 * ar, y2 = linea.y2;
    const vx = x2 - x1, vy = y2 - y1;
    const largo2 = vx * vx + vy * vy;
    if (largo2 < 1e-9) return { pasa: true, motivo: "linea degenerada" };
    const t = Math.max(0, Math.min(1, ((px - x1) * vx + (py - y1) * vy) / largo2));
    const cx = x1 + t * vx, cy = y1 + t * vy;
    const d = Math.hypot(px - cx, py - cy);
    const banda = Math.min(BANDA_MAX, Math.max(BANDA_MIN, recuadro.h * BANDA_ALTURAS));
    const lado = Math.sign(vx * (py - y1) - vy * (px - x1));
    return {
        pasa: d <= banda, lado,
        detalle: `${d.toFixed(3)} de la linea, banda ${banda.toFixed(3)}`,
    };
}

/**
 * La zona de interes, aplicada a la chapa y no al cuadro.
 *
 * Que el recorte ya venga acotado no alcanza: la zona suele abarcar media imagen, y
 * adentro entran igual los autos estacionados contra el cordon. Se pide que el centro
 * de la chapa caiga adentro, con un poco de aire por el borde.
 */
function dentroDeLaZona(recuadro, roi) {
    const px = recuadro.x + recuadro.w / 2, py = recuadro.y + recuadro.h / 2;
    const aire = 0.02;
    const dentro = px >= roi.x - aire && px <= roi.x + roi.w + aire
        && py >= roi.y - aire && py <= roi.y + roi.h + aire;
    return { pasa: dentro, detalle: `chapa en ${px.toFixed(2)},${py.toFixed(2)}` };
}

/**
 * La compuerta, segun lo que el calibrador tenga elegido para esa camara.
 *
 * El calibrador permite cambiar entre zona y linea, asi que las dos tienen que hacer
 * algo de verdad: la que esta activa es la que filtra. Sin recuadro no se filtra nada
 * -- mejor una lectura de mas que una camara que se calla sola por un cambio del lector.
 */
function compuerta(recuadro, cam) {
    if (!recuadro) return { pasa: true, motivo: "sin recuadro" };
    if (cam.disparo === "linea" && cam.linea) {
        return { ...cercaDeLaLinea(recuadro, cam.linea), motivo: "linea" };
    }
    if (cam.roi && Number.isFinite(cam.roi.w) && Number.isFinite(cam.roi.h) && cam.roi.w > 0 && cam.roi.h > 0) {
        return { ...dentroDeLaZona(recuadro, cam.roi), motivo: "zona" };
    }
    return { pasa: true, motivo: "sin geometria" };
}

/**
 * Cuantas llamadas al lector lleva la rafaga en curso, y cuanto costaron.
 *
 * Sin esto, "la rafaga tarda 3,5 s" no se puede atacar: no hay forma de saber si se va en
 * partir el cuadro, en detectar o en la segunda lectura. Se estimo a ojo una vez y la
 * conclusion fue equivocada.
 */
const medidor = { llamadas: 0, ms: 0 };

async function invocar(herramienta, cuerpo, ms = 20000) {
    const t0 = Date.now();
    try {
        return await invocarReal(herramienta, cuerpo, ms);
    } finally {
        medidor.llamadas++;
        medidor.ms += Date.now() - t0;
    }
}

async function invocarReal(herramienta, cuerpo, ms = 20000) {
    const r = await fetch(`${LPR_URL}/api/v1/tools/${herramienta}/invoke`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cuerpo),
        signal: AbortSignal.timeout(ms),
    });
    if (!r.ok) throw new Error(`Omni-LPR ${r.status}`);
    const d = await r.json();
    return d?.content?.[0]?.data || [];
}

/** Promedio de la confianza por caracter que devuelve el OCR. */
const promedio = (c) => (Array.isArray(c) ? (c.length ? c.reduce((a, b) => a + b, 0) / c.length : 0) : (c ?? 0));

/**
 * Lee una imagen y devuelve { plate, confidence, chars } o null.
 *
 * Son dos pasos a proposito. El primero encuentra donde esta la chapa; el segundo la
 * relee sola, ya recortada, con el modelo de OCR grande. Leer una imagen de 50x25 con
 * el modelo bueno cuesta casi nada, y es justo donde se decide si dice B o D.
 */
async function leerMatriculas(jpeg) {
    const items = await invocar("detect_and_recognize_plate", {
        image_base64: jpeg.toString("base64"),
        detector_model: DETECTOR,
        ocr_model: OCR,
    });

    // Todas las chapas del recorte, no la mejor.
    //
    // Antes se devolvia una sola y eso rompia la escena tipica de una calle de barrio:
    // un auto pasando y dos estacionados contra el cordon. El quieto se lee mejor que
    // el que se mueve -- esta enfocado y no arrastra -- asi que ganaba siempre, y el
    // auto que de verdad paso se perdia. Comprobado en un cuadro real de Calle 22: el
    // Corsa estacionado quedo registrado con 0,90 y el Tiida que salia no quedo.
    const crudas = [];
    for (const it of items) {
        const texto = (it?.ocr?.text || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
        if (texto.length < 4) continue;
        const conf = Math.min(promedio(it?.ocr?.confidence) || 0, it?.detection?.confidence ?? 1);
        crudas.push({ plate: texto, confidence: conf, chars: it?.ocr?.confidence, caja: it?.detection?.bounding_box || null });
    }
    if (!crudas.length) return [];

    // Tope por recorte: mas de esto en una baldosa es ruido del detector, y cada una
    // cuesta dos inferencias mas en la segunda lectura.
    crudas.sort((a, b) => b.confidence - a.confidence);
    const elegidas = crudas.slice(0, CHAPAS_POR_BALDOSA);

    if (!RELEER) return elegidas.map((m) => ({ ...m, chars: Array.isArray(m.chars) ? m.chars : null }));

    let meta = null;
    try { meta = await sharp(jpeg).metadata(); } catch { }

    const salida = [];
    for (const m of elegidas) {
        let fin = m;
        if (meta && m.caja && m.confidence >= RELEER_MIN) {
            try {
                // Un poco de aire alrededor: el recorte justo suele comerse el borde del ultimo caracter.
                const aire = 0.12;
                const an = m.caja.x2 - m.caja.x1, al = m.caja.y2 - m.caja.y1;
                const x = Math.max(0, Math.round(m.caja.x1 - an * aire));
                const y = Math.max(0, Math.round(m.caja.y1 - al * aire));
                const w = Math.min((meta.width || 0) - x, Math.round(an * (1 + 2 * aire)));
                const h = Math.min((meta.height || 0) - y, Math.round(al * (1 + 2 * aire)));
                if (w > 20 && h > 10) {
                    const recorte = await sharp(jpeg).extract({ left: x, top: y, width: w, height: h }).jpeg({ quality: 95 }).toBuffer();
                    const [a, b] = await Promise.all([releer(recorte, OCR), releer(recorte, OCR_FINO)]);
                    // Los dos modelos sobre la chapa recortada son una SEGUNDA OPINION, no un
                    // reemplazo. Cuando coinciden, esa lectura vale mas que la del cuadro entero
                    // y se toma. Cuando no coinciden, el caracter dudoso existe de verdad: se
                    // deja la primera pero con menos confianza, para que decida la votacion de
                    // la rafaga en vez de darla por buena.
                    //
                    // No es teorico: sobre una chapa real el cuadro entero decia SBW3369 con
                    // 0,98 y el recorte decia SBV3369, que es lo que dice la chapa. La confianza
                    // alta no garantiza que este bien; el acuerdo entre dos modelos ayuda mas.
                    if (a && b && a === b) {
                        fin = { plate: a, confidence: Math.max(m.confidence, 0.9), chars: null, caja: m.caja };
                    } else if (a && b) {
                        fin = { ...m, confidence: m.confidence * 0.8 };
                    } else if (a || b) {
                        const uno = a || b;
                        fin = uno !== m.plate ? { ...m, confidence: m.confidence * 0.9 } : m;
                    }
                }
            } catch { /* si la segunda lectura falla, vale la primera */ }
        }
        salida.push({ plate: fin.plate, confidence: fin.confidence, chars: Array.isArray(fin.chars) ? fin.chars : null, caja: fin.caja || null });
    }
    return salida;
}

/**
 * Dos lecturas del mismo auto o de autos distintos.
 *
 * El OCR no devuelve siempre lo mismo para la misma chapa -- ese es justamente el
 * motivo por el que despues se vota -- asi que agrupar por texto exacto separaria en
 * dos al mismo auto. Se agrupa por parecido: mismo largo y pocos caracteres de
 * diferencia. Dos autos distintos no se parecen en seis o siete posiciones.
 */
function mismaChapa(a, b) {
    if (a.length !== b.length) return false;
    const tolera = a.length >= 6 ? 2 : 1;
    let d = 0;
    for (let k = 0; k < a.length; k++) if (a[k] !== b[k]) { d++; if (d > tolera) return false; }
    return true;
}

/** Parte las lecturas de la rafaga en un grupo por vehiculo. */
function agruparPorVehiculo(lecturas) {
    const grupos = [];
    for (const l of lecturas) {
        let g = grupos.find((x) => mismaChapa(x.patron, l.plate));
        if (!g) { g = { patron: l.plate, mejorConf: -1, lecturas: [] }; grupos.push(g); }
        g.lecturas.push(l);
        // El patron del grupo es la lectura mas segura vista hasta ahora: si la primera
        // fue mala, el grupo no queda anclado a ella.
        if (l.confidence > g.mejorConf) { g.patron = l.plate; g.mejorConf = l.confidence; }
    }
    return grupos;
}

/**
 * Relee una chapa ya recortada. Ojo: esta herramienta devuelve otra forma que la de
 * deteccion -- { plate } en vez de { ocr: { text } } -- y no trae confianza por caracter.
 * Leer mal esa forma fue lo que hizo que la segunda lectura no hiciera nada durante un rato.
 */
async function releer(recorte, modelo) {
    try {
        const d = await invocar("recognize_plate", { image_base64: recorte.toString("base64"), ocr_model: modelo }, 15000);
        const bruto = d?.[0]?.plate ?? d?.[0]?.ocr?.text ?? "";
        const texto = String(bruto).toUpperCase().replace(/[^A-Z0-9]/g, "");
        return texto.length >= 4 ? texto : null;
    } catch { return null; }
}

/**
 * Consolida las lecturas de una rafaga.
 *
 * Primero vota el largo: las matriculas del pais tienen largo fijo, asi que una
 * lectura de otro largo casi siempre es un recorte mal hecho. Despues vota caracter
 * por caracter, pesando cada voto por la confianza de esa lectura: si tres cuadros
 * dicen "SCV4478" y uno dice "SCV447B", gana el 8 sin necesidad de descartar el
 * cuadro entero. Es lo que arregla los 0/O y 8/B, que es donde falla el OCR.
 */
function votar(lecturas) {
    if (!lecturas.length) return null;

    const porLargo = new Map();
    for (const l of lecturas) {
        const k = l.plate.length;
        porLargo.set(k, (porLargo.get(k) || 0) + l.confidence);
    }
    let largo = null, mejorPeso = -1;
    for (const [k, peso] of porLargo) if (peso > mejorPeso) { mejorPeso = peso; largo = k; }

    const utiles = lecturas.filter((l) => l.plate.length === largo);
    const texto = [];
    for (let i = 0; i < largo; i++) {
        const votos = new Map();
        for (const l of utiles) {
            const c = l.plate[i];
            // El OCR da una confianza POR CARACTER. Usar el promedio de la lectura
            // desperdicia eso: si un cuadro esta segurisimo de seis letras y flojo de la
            // septima, conviene que pese mucho en las seis y poco en la septima.
            const peso = (Array.isArray(l.chars) && l.chars.length === l.plate.length ? l.chars[i] : l.confidence) || 0.01;
            votos.set(c, (votos.get(c) || 0) + peso);
        }
        let ganador = null, peso = -1;
        for (const [c, p] of votos) if (p > peso) { peso = p; ganador = c; }
        texto.push(ganador);
    }
    const plate = texto.join("");

    // Cuantas lecturas respaldan exactamente el resultado, y con que confianza.
    const iguales = utiles.filter((l) => l.plate === plate);
    const apoyo = iguales.length || utiles.length;
    const confianza = (iguales.length ? iguales : utiles)
        .reduce((a, l) => a + l.confidence, 0) / (iguales.length || utiles.length);
    const maxima = Math.max(...utiles.map((l) => l.confidence));

    return { plate, confidence: confianza, reads: apoyo, maxima, cuadros: lecturas.length };
}

function guardarCuadro(jpeg, patente) {
    try {
        fs.mkdirSync(DIR_SHOTS, { recursive: true });
        const nombre = `${patente}-${Date.now()}.jpg`;
        fs.writeFileSync(path.join(DIR_SHOTS, nombre), jpeg);
        return `/api/tracking/shot/${nombre}`;
    } catch { return null; }
}

async function avisarAvistamiento(cam, lectura, url) {
    const r = await fetch(`${APP_URL}/api/tracking/sighting`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-tracking-token": token },
        body: JSON.stringify({
            plate: lectura.plate,
            confidence: lectura.confidence,
            reads: lectura.reads,
            bbox: lectura.recuadro || null,
            enPuerta: lectura.enPuerta !== false,
            puerta: lectura.puerta || null,
            deviceId: cam.deviceId || null,
            cameraName: cam.name,
            lat: cam.lat ?? null,
            lng: cam.lng ?? null,
            eventType: "INTERNAL",
            snapshotUrl: url,
            timestamp: new Date().toISOString(),
        }),
        signal: AbortSignal.timeout(10000),
    });
    const d = await r.json().catch(() => ({}));
    return { status: r.status, estado: d?.estado || null, id: d?.id || null, nuevo: !!d?.nuevo, ignorado: d?.ignorado || null };
}

/**
 * Cierra las estadias vencidas: los vehiculos que se fueron.
 *
 * Es el unico aviso del seguimiento que no nace de algo que la camara vio, sino de algo
 * que dejo de ver. Un auto que arranca y se va no genera ninguna lectura, asi que sin
 * este barrido su estadia quedaria abierta para siempre.
 */
async function barrerEstadias() {
    try {
        const r = await fetch(`${APP_URL}/api/tracking/stays/sweep`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-tracking-token": token },
            signal: AbortSignal.timeout(15000),
        });
        const d = await r.json().catch(() => ({}));
        for (const c of d?.cerradas || []) {
            log(`se fue: ${c.plate} de ${c.camara || "una camara"} despues de ${c.minutos} min`);
        }
    } catch (e) {
        log(`no se pudieron cerrar las estadias: ${e.message}`);
    }
}

// ─────────────────────────── Rafagas ───────────────────────────

/** Abre una rafaga: junta los cuadros de antes y de despues, los lee y consolida. */
function disparar(est, motivo) {
    const ahora = Date.now();
    if (est.rafaga) return;                 // ya hay una abierta
    if (ahora < est.mudoHasta) return;      // acabamos de resolver una

    // Los cuadros de justo antes del aviso suelen ser los mejores: el vehiculo
    // todavia esta entrando en cuadro y la chapa no se fue de foco.
    const previos = est.memoria.filter((c) => ahora - c.t <= RAFAGA_ANTES_MS).map((c) => c.jpeg);
    contadores.disparos++;
    est.rafaga = { motivo, cuadros: previos.slice(-RAFAGA_MAX_CUADROS) };
    if (motivo !== "escena") log(`${est.cam.name}: rafaga abierta por ${motivo} (${previos.length} cuadros previos)`);
    est.temporizador = setTimeout(() => resolverRafaga(est), RAFAGA_DESPUES_MS);
}

async function resolverRafaga(est) {
    const r = est.rafaga;
    est.rafaga = null;
    est.temporizador = null;
    if (!r || !r.cuadros.length) return;

    est.mudoHasta = Date.now() + MUDO_MS;
    const cam = est.cam;
    const cuadros = r.cuadros.slice(0, RAFAGA_MAX_CUADROS);

    try {
        // Concurrencia acotada: el lector es uno solo y encima esta compartido.
        // Cada cuadro se parte en baldosas y cada baldosa es una inferencia. La lectura
        // recuerda de que CUADRO salio (no de que baldosa), que es lo que se guarda como
        // foto: al operador le sirve ver la escena, no el recorte.
        const tArranque = Date.now();
        medidor.llamadas = 0; medidor.ms = 0;
        const trabajo = [];
        for (let i = 0; i < cuadros.length; i++) {
            for (const trozo of await baldosas(cuadros[i])) trabajo.push({ ...trozo, cuadro: i });
        }
        // Si hay demasiado, se reparte parejo en el tiempo en vez de cortar por la mitad:
        // el final de la rafaga suele ser mejor que el principio.
        let cola = trabajo;
        if (trabajo.length > INFERENCIAS_MAX) {
            const paso = trabajo.length / INFERENCIAS_MAX;
            cola = Array.from({ length: INFERENCIAS_MAX }, (_, k) => trabajo[Math.floor(k * paso)]);
        }

        const tBaldosas = Date.now();
        const lecturas = [];
        for (let i = 0; i < cola.length; i += MAX_EN_VUELO) {
            const tanda = cola.slice(i, i + MAX_EN_VUELO);
            const res = await Promise.all(tanda.map((t) => leerMatriculas(t.jpeg).catch(() => [])));
            res.forEach((lista, k) => {
                for (const x of lista || []) {
                    lecturas.push({ ...x, cuadro: tanda[k].cuadro, recuadro: recuadroEnCuadro(x.caja, tanda[k]) });
                }
            });
        }
        if (!lecturas.length) {
            contadores.descartes++;
            if (r.motivo !== "escena") log(`${cam.name}: rafaga sin matricula (${cuadros.length} cuadros, ${cola.length} baldosas)`);
            // Se guarda un cuadro del ultimo intento fallido, siempre el mismo archivo por
            // camara. Cuando alguien pregunta "por que no lee", esto contesta en un vistazo
            // si el problema es la zona, el angulo o la distancia; sin esto hay que adivinar.
            try {
                fs.mkdirSync(DIR_SHOTS, { recursive: true });
                const medio = cuadros[Math.floor(cuadros.length / 2)];
                if (medio) fs.writeFileSync(path.join(DIR_SHOTS, `ultimo-fallo-${cam.deviceId || cam.name}.jpg`), medio);
            } catch { }
            return;
        }

        const tLectura = Date.now();
        log(`${cam.name}: rafaga en ${tLectura - tArranque} ms `
            + `(baldosear ${tBaldosas - tArranque} ms de ${cuadros.length} cuadros -> ${trabajo.length} baldosas, `
            + `leer ${tLectura - tBaldosas} ms en ${medidor.llamadas} llamadas de ${medidor.ms} ms)`);

        // Cada vehiculo del cuadro se resuelve por separado.
        //
        // Una calle de barrio casi nunca tiene un solo auto: hay uno pasando y dos
        // estacionados. Votar una sola chapa para toda la rafaga hacia que ganara el que
        // se lee mejor, que es el quieto, y el que pasaba se perdia. Ahora las lecturas
        // se agrupan por vehiculo y cada grupo vota su propia chapa.
        const grupos = agruparPorVehiculo(lecturas);
        const minima = cam.confianza ?? MIN_CONF;
        const yaVistas = new Set();
        const rozaron = [];
        let ruido = 0;

        for (const g of grupos) {
            const v = votar(g.lecturas);
            if (!v || !v.plate || yaVistas.has(v.plate)) continue;

            // Dos caminos para aceptar: varios cuadros que coinciden, o uno muy seguro.
            const respaldada = v.reads >= COINCIDENCIAS_MIN || v.maxima >= CONF_ALTA;
            if (!respaldada) {
                contadores.descartes++;
                // Solo se nombra la que estuvo cerca. Con varias matriculas por rafaga, el
                // detector propone veinte recortes por cuadro y casi todos son ruido:
                // escribir un renglon por cada uno tapaba el unico que importa.
                if (v.maxima >= CONF_ALTA - 0.15) rozaron.push(`${v.plate} ${v.maxima.toFixed(2)}`);
                else ruido++;
                continue;
            }
            if (v.confidence < minima) {
                rozaron.push(`${v.plate} ${v.confidence.toFixed(2)}<${minima}`);
                continue;
            }

            // Se guarda el cuadro de la lectura mas segura que coincide con lo votado.
            const candidatas = g.lecturas.filter((l) => l.plate === v.plate);
            const mejor = (candidatas.length ? candidatas : g.lecturas).reduce((a, b) => (b.confidence > a.confidence ? b : a));

            // Zona o linea, la que el calibrador tenga elegida. Se mira donde cayo la chapa
            // de este vehiculo, no el cuadro entero.
            const puerta = compuerta(mejor.recuadro, cam);

            const url = guardarCuadro(cuadros[mejor.cuadro] || cuadros[0], v.plate);
            const resp = await avisarAvistamiento(cam, {
                ...v,
                recuadro: mejor.recuadro || null,
                enPuerta: puerta.pasa,
                puerta: puerta.motivo,
            }, url);

            if (resp.ignorado === "fuera de la zona") {
                contadores.fueraDeLinea++;
                log(`${cam.name}: ${v.plate} fuera de ${puerta.motivo} y en movimiento (${puerta.detalle || "-"})`);
                continue;
            }

            yaVistas.add(v.plate);
            // Un auto quieto que se vuelve a leer no es una lectura nueva: no se cuenta como
            // tal, o la efectividad mediria el estacionamiento en vez del trabajo del lector.
            if (resp.estado !== "ESTACIONADO") contadores.lecturas++;
            const nota = resp.estado === "ESTACIONADO"
                ? (resp.nuevo ? " · estaciono" : " · estacionado")
                : (puerta.pasa ? "" : ` · fuera de ${puerta.motivo}`);
            log(`${cam.name}: ${v.plate} (${v.confidence.toFixed(2)} · ${v.reads}/${v.cuadros} lecturas de ${cola.length} baldosas · ${r.motivo}${nota}) -> ${resp.status}`);
        }

        if (rozaron.length || (!yaVistas.size && ruido)) {
            const detalle = rozaron.length ? ` · cerca: ${rozaron.slice(0, 4).join(", ")}` : "";
            log(`${cam.name}: ${yaVistas.size} matricula(s) de ${grupos.length} candidatas (${ruido} ruido)${detalle}`);
        }
    } catch (e) {
        log(`${cam.name}: error resolviendo la rafaga: ${e.message}`);
    }
}

// ─────────────────────── Flujo de cuadros ───────────────────────

function engancharCamara(est) {
    const cam = est.cam;
    if (est.ffmpeg) return;

    const escena = cam.escena ?? 0.08;
    // "camara" quedo de la primera version; ahora el modo dice ademas COMO avisa.
    const porCamara = porAviso(est.modoEfectivo);
    // En modo camara conviene un ritmo mas alto: el disparo ya es preciso, y lo que
    // se quiere es tener varios cuadros del auto pasando. En modo escena se muestrea
    // bajo y es ffmpeg el que decide cual vale.
    const fps = cam.fps ?? (porCamara ? 6 : 2);

    const r = cam.roi;
    const recorte = r && r.w > 0 && r.h > 0 && (r.w < 1 || r.h < 1 || r.x > 0 || r.y > 0)
        ? `crop=iw*${r.w}:ih*${r.h}:iw*${r.x}:ih*${r.y},`
        : "";
    const filtro = porCamara
        ? `${recorte}fps=${fps},scale=w='min(${ANCHO_MAX}\\,iw)':h=-2`
        : `${recorte}fps=${fps},select='gt(scene\\,${escena})',scale=w='min(${ANCHO_MAX}\\,iw)':h=-2`;

    const args = [
        "-hide_banner", "-loglevel", "error",
        // Decodificar en la placa: son 2688x1520 H.265 a 25 cuadros por segundo y por
        // camara. En CPU eso compite con el transcodificado que go2rtc hace para la
        // vista en vivo; en la GPU practicamente no se nota.
        "-hwaccel", "cuda",
        "-rtsp_transport", "tcp",
        "-i", cam.rtsp,
        "-vf", filtro,
        "-vsync", "vfr", "-q:v", "3", "-f", "image2pipe", "-vcodec", "mjpeg", "-",
    ];
    const ch = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });
    est.ffmpeg = ch;
    log(`camara enganchada: ${cam.name} (disparo: ${porCamara ? "camara" : "escena por respaldo"}, ${fps} c/s${recorte ? ", con zona de interes" : ""})`);

    let buffer = Buffer.alloc(0);
    ch.stdout.on("data", (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);
        let ini = buffer.indexOf(Buffer.from([0xff, 0xd8]));
        let fin = buffer.indexOf(Buffer.from([0xff, 0xd9]), ini + 2);
        while (ini >= 0 && fin > ini) {
            const jpeg = buffer.subarray(ini, fin + 2);
            buffer = buffer.subarray(fin + 2);
            recibirCuadro(est, Buffer.from(jpeg));
            ini = buffer.indexOf(Buffer.from([0xff, 0xd8]));
            fin = buffer.indexOf(Buffer.from([0xff, 0xd9]), ini + 2);
        }
        if (buffer.length > 8 * 1024 * 1024) buffer = Buffer.alloc(0); // guarda de seguridad
    });
    ch.stderr.on("data", (d) => {
        const t = String(d).trim();
        if (t) log(`ffmpeg ${cam.name}: ${t.slice(0, 160)}`);
    });
    const reintentar = () => {
        if (est.ffmpeg !== ch) return;
        est.ffmpeg = null;
        if (est.retirada) return;
        log(`camara caida: ${cam.name}, reintento en 15s`);
        setTimeout(() => { if (!est.retirada) engancharCamara(est); }, 15000);
    };
    ch.on("exit", reintentar);
    ch.on("error", reintentar);
}

function recibirCuadro(est, jpeg) {
    const ahora = Date.now();
    est.memoria.push({ t: ahora, jpeg });
    while (est.memoria.length > MEMORIA_CUADROS) est.memoria.shift();

    if (est.rafaga) {
        if (est.rafaga.cuadros.length < RAFAGA_MAX_CUADROS) est.rafaga.cuadros.push(jpeg);
        return;
    }
    // En modo escena, que ffmpeg emita un cuadro YA significa que algo cambio.
    if (!porAviso(est.modoEfectivo)) disparar(est, "escena");
}

// ──────────────── Aviso de la propia camara (AcuSense) ────────────────

/** Arma la cabecera Authorization de una autenticacion digest. */
const INICIO_AVISO = Buffer.from("<EventNotificationAlert");
const FIN_AVISO = Buffer.from("</EventNotificationAlert>");

function cabeceraDigest(desafio, metodo, uri, usuario, clave) {
    const campos = {};
    for (const m of desafio.replace(/^Digest\s+/i, "").matchAll(/(\w+)="?([^",]*)"?/g)) campos[m[1]] = m[2];
    if (!campos.realm || !campos.nonce) return null;
    const md5 = (s) => crypto.createHash("md5").update(s).digest("hex");
    const ha1 = md5(`${usuario}:${campos.realm}:${clave}`);
    const ha2 = md5(`${metodo}:${uri}`);
    const cnonce = crypto.randomBytes(8).toString("hex");
    const nc = "00000001";
    const qop = (campos.qop || "").split(",")[0].trim();
    const respuesta = qop
        ? md5(`${ha1}:${campos.nonce}:${nc}:${cnonce}:${qop}:${ha2}`)
        : md5(`${ha1}:${campos.nonce}:${ha2}`);
    let c = `Digest username="${usuario}", realm="${campos.realm}", nonce="${campos.nonce}", uri="${uri}", response="${respuesta}"`;
    if (qop) c += `, qop=${qop}, nc=${nc}, cnonce="${cnonce}"`;
    if (campos.opaque) c += `, opaque="${campos.opaque}"`;
    return c;
}

/**
 * Se queda colgado del flujo de eventos de la camara y avisa cuando cruza un
 * vehiculo. Es un pedido HTTP que no termina nunca: la camara va empujando bloques
 * XML a medida que pasan cosas. Si se corta, se reintenta.
 */
function escucharCamara(est) {
    const cam = est.cam;
    if (!cam.ip || !cam.usuario || !cam.clave) {
        log(`${cam.name}: sin IP o credenciales, no se puede escuchar el aviso de la camara`);
        return;
    }
    const uri = "/ISAPI/Event/notification/alertStream";
    const host = String(cam.ip).replace(/^https?:\/\//, "").split("/")[0].split(":")[0];

    const abrir = (autorizacion) => {
        if (est.retirada) return;
        const req = http.request(
            { host, port: 80, path: uri, method: "GET", headers: autorizacion ? { Authorization: autorizacion } : {} },
            (res) => {
                if (res.statusCode === 401 && !autorizacion) {
                    const desafio = res.headers["www-authenticate"] || "";
                    res.resume();
                    const cab = cabeceraDigest(desafio, "GET", uri, cam.usuario, cam.clave);
                    if (!cab) { log(`${cam.name}: la camara no ofrece digest`); return; }
                    return abrir(cab);
                }
                if (res.statusCode !== 200) {
                    res.resume();
                    log(`${cam.name}: flujo de eventos HTTP ${res.statusCode}`);
                    return reintentar();
                }
                log(`${cam.name}: escuchando avisos de la camara`);
                est.escucha = req;
                // El flujo viene en multipart y cada aviso puede traer su JPEG adjunto, asi
                // que se trabaja sobre bytes: interpretarlo como texto rompe la imagen y,
                // con ella, el limite del siguiente bloque.
                let cola = Buffer.alloc(0);
                res.on("data", (t) => {
                    cola = Buffer.concat([cola, t]);
                    for (;;) {
                        const ini = cola.indexOf(INICIO_AVISO);
                        if (ini < 0) break;
                        const fin = cola.indexOf(FIN_AVISO, ini);
                        if (fin < 0) break;
                        const bloque = cola.subarray(ini, fin + FIN_AVISO.length).toString("latin1");
                        cola = cola.subarray(fin + FIN_AVISO.length);
                        procesarAviso(est, bloque);
                    }
                    // Si se acumulo mucho sin cerrar un aviso, casi seguro es la imagen de
                    // uno que ya procesamos: se descarta todo menos la cola reciente.
                    if (cola.length > 4 * 1024 * 1024) cola = cola.subarray(cola.length - 64 * 1024);
                });
                res.on("end", reintentar);
                res.on("close", reintentar);
            }
        );
        req.on("error", (e) => { log(`${cam.name}: flujo de eventos cortado: ${e.message}`); reintentar(); });
        req.end();
    };

    let reintentando = false;
    const reintentar = () => {
        if (reintentando || est.retirada) return;
        reintentando = true;
        est.escucha = null;
        setTimeout(() => { reintentando = false; abrir(null); }, 10000);
    };

    abrir(null);
}

/**
 * Del aviso solo interesan los de analitica con objetivo vehiculo. La camara tambien
 * manda deteccion de movimiento a cada rato: si se hiciera caso a eso, estariamos de
 * vuelta en el problema que este modo vino a resolver.
 */
function procesarAviso(est, xml) {
    const tipo = (/<eventType>([^<]+)<\/eventType>/i.exec(xml) || [])[1] || "";
    // Se lleva la cuenta de TODO lo que manda la camara, no solo de lo que se usa:
    // sin esto, "no llego ningun aviso" y "llegaron y los descarte" se parecen
    // demasiado, y son problemas distintos.
    est.recuento[tipo] = (est.recuento[tipo] || 0) + 1;
    if (!/linedetection|fielddetection|regionEntrance|regionExiting/i.test(tipo)) return;
    // "duration" y "VMD" son el latido y el movimiento crudo: justo lo que este modo vino a evitar.
    const estado = (/<eventState>([^<]+)<\/eventState>/i.exec(xml) || [])[1] || "active";
    if (estado !== "active") return;
    // Si el aviso trae clasificacion y dice que es una persona, no es lo nuestro.
    if (/<detectionTarget>human<\/detectionTarget>/i.test(xml) && !/vehicle/i.test(xml)) return;
    est.ultimoAviso = Date.now();
    if (!porAviso(est.modoEfectivo) && porAviso(est.cam.disparo)) {
        log(`${est.cam.name}: la camara volvio a avisar, se deja el respaldo por escena`);
        est.modoEfectivo = est.cam.disparo;
        rearmar(est);
    }
    disparar(est, `camara:${tipo}`);
}

/** Rearma el ffmpeg de una camara (cambio de modo o de calibracion). */
function rearmar(est) {
    const viejo = est.ffmpeg;
    est.ffmpeg = null;
    if (viejo) { try { viejo.kill("SIGKILL"); } catch { } }
    est.memoria = [];
    engancharCamara(est);
}

/**
 * Vigia del disparo por camara. Que el flujo de avisos este abierto no garantiza que
 * la regla este bien puesta: la camara puede estar mandando solo movimiento y ninguna
 * analitica. Si pasa demasiado tiempo sin un aviso util, se vuelve al disparo por
 * escena y queda dicho en el log por que.
 */
function vigilarDisparo() {
    for (const [, est] of camarasVivas) {
        if (!porAviso(est.cam.disparo) || !porAviso(est.modoEfectivo)) continue;
        if (Date.now() - est.ultimoAviso < RESPALDO_MS) continue;
        log(`${est.cam.name}: la camara no avisa hace ${Math.round(RESPALDO_MS / 60000)} min; se pasa al disparo por escena. Revisar la zona y el objetivo de la regla en el calibrador.`);
        est.modoEfectivo = "escena";
        est.ultimoAviso = Date.now();
        rearmar(est);
    }
}

// ───────────────────────── Muestreo ─────────────────────────

function ejecutar(cmd, args) {
    return new Promise((res) => {
        execFile(cmd, args, { timeout: 12000, maxBuffer: 256 * 1024 }, (e, out) => res(e ? "" : String(out).trim()));
    });
}

/**
 * Una muestra por minuto de como viene trabajando el seguimiento.
 *
 * El panel mostraba solo el instante, y el instante no alcanza para decidir nada: que la
 * GPU este al 10% ahora no dice si estuvo al 90% hace media hora, ni si el lector viene
 * leyendo o hace rato que no ve un auto. Con la serie se puede mirar el dia.
 */
async function muestrear() {
    try {
        const [stats, gpu, proveedor] = await Promise.all([
            ejecutar("docker", ["stats", "omni-lpr", "--no-stream", "--format", "{{.CPUPerc}}|{{.MemUsage}}"]),
            ejecutar("nvidia-smi", ["--query-gpu=utilization.gpu,memory.used,temperature.gpu,power.draw", "--format=csv,noheader,nounits"]),
            ejecutar("bash", ["-lc", "docker logs omni-lpr 2>&1 | grep -i ExecutionProvider | tail -1"]),
        ]);

        let cpuCont = null, memCont = null;
        if (stats) {
            const [cpu, mem] = stats.split("|");
            cpuCont = parseFloat(cpu) || 0;
            const usada = (mem || "").split("/")[0].trim();
            const n = parseFloat(usada);
            if (!isNaN(n)) memCont = Math.round(/GiB|GB/i.test(usada) ? n * 1024 : /KiB|KB/i.test(usada) ? n / 1024 : n);
        }

        let gpuUso = null, gpuMem = null, gpuTemp = null, gpuWatts = null;
        if (gpu) {
            const p = gpu.split(",").map((x) => parseFloat(x.trim()));
            [gpuUso, gpuMem, gpuTemp, gpuWatts] = p.map((x) => (isNaN(x) ? null : Math.round(x)));
        }

        // Si el lector cae a CPU no lo dice en ninguna metrica: hay que preguntarselo al log.
        // Dos intentos fallidos antes de dar con esto: mirar solo las ultimas lineas no sirve
        // (el aviso queda atras al poco de arrancar) y cruzar los PID del contenedor con los
        // que reporta la placa tampoco, porque no viven en el mismo espacio de nombres.
        const enGpu = /CUDAExecutionProvider/.test(proveedor) && !/Failed to create/i.test(proveedor);

        await prisma.trackingSample.create({
            data: {
                gpuUso, gpuMem, gpuTemp, gpuWatts, cpuCont, memCont,
                camaras: camarasVivas.size,
                disparos: contadores.disparos,
                lecturas: contadores.lecturas,
                descartes: contadores.descartes,
                enGpu,
            },
        });
        contadores.disparos = 0; contadores.lecturas = 0; contadores.descartes = 0;

        // Limpieza barata: una vez por hora, y solo lo que ya no se muestra.
        if (new Date().getMinutes() === 7) {
            await prisma.trackingSample.deleteMany({
                where: { momento: { lt: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000) } },
            });
        }
    } catch (e) {
        log("no se pudo guardar la muestra:", e.message);
    }
}

// ─────────────────────────── Ciclo ───────────────────────────

async function sincronizar() {
    token = process.env.TRACKING_TOKEN || (await ajuste("TRACKING_TOKEN", "")) || "";
    if (!token) { log("falta TRACKING_TOKEN: la pasarela queda en pausa"); return; }

    const lista = await camaras();
    const nombres = new Set(lista.map((c) => c.name));

    for (const [nombre, est] of camarasVivas) {
        if (!nombres.has(nombre)) {
            est.retirada = true;
            try { est.ffmpeg && est.ffmpeg.kill("SIGKILL"); } catch { }
            try { est.escucha && est.escucha.destroy(); } catch { }
            camarasVivas.delete(nombre);
            log(`camara quitada: ${nombre}`);
        }
    }

    for (const cam of lista) {
        const previa = camarasVivas.get(cam.name);
        // Si cambio la calibracion o el modo de disparo, hay que rearmar el ffmpeg.
        const huella = JSON.stringify([cam.rtsp, cam.roi, cam.fps, cam.escena, cam.disparo]);
        if (previa && previa.huella !== huella) {
            previa.retirada = true;
            try { previa.ffmpeg && previa.ffmpeg.kill("SIGKILL"); } catch { }
            try { previa.escucha && previa.escucha.destroy(); } catch { }
            camarasVivas.delete(cam.name);
            log(`camara recalibrada: ${cam.name}`);
        }
        if (camarasVivas.has(cam.name)) { camarasVivas.get(cam.name).cam = cam; continue; }

        const est = { cam, huella, modoEfectivo: cam.disparo, ultimoAviso: Date.now(), memoria: [], recuento: {}, rafaga: null, temporizador: null, mudoHasta: 0, ffmpeg: null, escucha: null, retirada: false };
        camarasVivas.set(cam.name, est);
        engancharCamara(est);
        if (porAviso(cam.disparo)) escucharCamara(est);
    }

    if (!lista.length) log("sin camaras de seguimiento configuradas");
}

/** Que esta recibiendo cada camara, en una linea por vez. */
function resumenAvisos() {
    for (const [nombre, est] of camarasVivas) {
        const partes = Object.entries(est.recuento)
            .filter(([t]) => t !== "videoloss" && t !== "duration")
            .map(([t, n]) => `${t}=${n}`);
        est.recuento = {};
        if (partes.length) log(`${nombre}: avisos ${partes.join(" ")}`);
    }
}

(async () => {
    log(`pasarela iniciada · Omni-LPR en ${LPR_URL}`);
    /**
     * La configuracion efectiva, en el arranque.
     *
     * No es adorno: este proceso corrio meses con valores que no eran los del .env, y no
     * habia forma de saberlo sin abrir /proc. Un renglon en el log al arrancar convierte
     * "cual valor esta corriendo" en una pregunta de diez segundos.
     */
    log(`config · detector=${DETECTOR} ocr=${OCR} baldosa=${BALDOSA_PX}px inferencias<=${INFERENCIAS_MAX} `
        + `enVuelo=${MAX_EN_VUELO} minConf=${MIN_CONF} coincidencias>=${COINCIDENCIAS_MIN} `
        + `confAlta=${CONF_ALTA} releerDesde=${RELEER_MIN} chapasPorBaldosa=${CHAPAS_POR_BALDOSA}`);
    await sincronizar();
    setInterval(sincronizar, 60000);   // toma cambios de configuracion sin reiniciar
    setInterval(resumenAvisos, 120000);
    setInterval(vigilarDisparo, 60000);
    setInterval(barrerEstadias, 60000);
    muestrear();
    setInterval(muestrear, 60000);
})();

process.on("SIGTERM", () => {
    for (const [, est] of camarasVivas) {
        est.retirada = true;
        try { est.ffmpeg && est.ffmpeg.kill("SIGKILL"); } catch { }
        try { est.escucha && est.escucha.destroy(); } catch { }
    }
    process.exit(0);
});
