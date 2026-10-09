/**
 * vision-worker — el registro de detecciones de omni-vision.
 *
 * Mira las cámaras elegidas cada pocos segundos, le pide al detector qué hay, sigue a cada
 * objeto entre cuadros y guarda UNA fila por pista en ObjetoVisto: el mejor recorte, el cuadro
 * de ese momento, sus atributos y su recorrido. Es lo que muestra Visión → Detecciones.
 *
 * Tres cosas que lo hacen barato, porque comparte GPU con omni-lpr y CPU con la app:
 *
 *  · Compuerta de cambio de escena: antes de mandar un cuadro al detector se lo compara con el
 *    anterior en una miniatura de 64×36 en grises. Una calle vacía a la madrugada no gasta GPU.
 *    Si hay pistas abiertas en esa cámara se analiza igual, para poder cerrarlas.
 *  · Una cámara por vez y un pedido por vez: omni-vision atiende de a uno y pedirle varios a la
 *    vez sólo los encola del otro lado (y le quita turno a omni-lpr mientras tanto).
 *  · Las filas se escriben al abrir la pista, cuando mejora la foto y al cerrarla (más un
 *    refresco cada tanto para las largas), no en cada cuadro.
 *
 * Obedece a los interruptores del laboratorio: la analítica "registro" lo prende y lo apaga
 * (apagado no le pide nada a la GPU), y sólo guarda las clases prendidas. Las cámaras salen de
 * VISION_CAMARAS (lista de ids; vacío = todas las que no son grabadores).
 *
 * No toca server.js ni ninguna otra tabla. Además corre acá la relectura de las NO_LEIDA de los
 * accesos (vision-relectura.js), que sí le pide a omni-lpr, de a una y con pausa, y escribe en
 * su propia tabla `Relectura`.
 */

require("dotenv").config();
const crypto = require("crypto");
const sharp = require("sharp");
const { spawn } = require("child_process");
const { PrismaClient } = require("@prisma/client");
const { S3Client, PutObjectCommand, CreateBucketCommand, HeadBucketCommand, DeleteObjectsCommand } = require("@aws-sdk/client-s3");

const prisma = new PrismaClient();
const relecturas = require("./vision-relectura");
const reglasVision = require("./vision-reglas");

const VISION = (process.env.OMNI_VISION_URL || "http://127.0.0.1:8010").replace(/\/$/, "");
const GO2RTC = (process.env.GO2RTC_API || "http://127.0.0.1:1984").replace(/\/$/, "");
const BUCKET = process.env.VISION_BUCKET || "objetos";

/** Cada cuánto se mira cada cámara. A 2 s, una persona caminando aparece en 4-6 cuadros al cruzar. */
const INTERVALO_MS = Number(process.env.VISION_REGISTRO_INTERVALO_MS || 2000);
/**
 * Diferencia media de luminancia (0-255) en la miniatura para llamar "cambió" a la escena.
 * Valor de arranque, SIN medir todavía en estas cámaras: el estado guarda la diferencia de cada
 * cuadro por cámara (mediana y máximo) justamente para ajustarlo con números.
 */
const CAMBIO_MIN = Number(process.env.VISION_REGISTRO_CAMBIO_MIN || 3.5);
/** Aunque no cambie nada, cada tanto se analiza igual: un objeto quieto también existe. */
const ANALIZAR_IGUAL_MS = 60_000;
/** Confianza mínima para registrar. Un poco más alta que la del laboratorio: esto queda guardado. */
const UMBRAL = Number(process.env.VISION_REGISTRO_UMBRAL || 0.45);
/** Una pista que no se ve durante esto se da por terminada. */
const PISTA_CERRADA_MS = 15_000;
/** Refresco de la fila de una pista larga, para que la pantalla la vea "en curso". */
const REFRESCO_PISTA_MS = 10_000;
/** La foto se reemplaza sólo si la nueva es claramente mejor (si no, cada cuadro reescribe MinIO). */
const MEJORA_MIN = 0.05;
/** Puntos del recorrido que se guardan: a 2 s, 120 son 4 minutos. */
const RECORRIDO_MAX = 120;
/** Lado del recorte que se guarda. La grilla lo muestra a ~130 px; el doble alcanza para pantallas densas. */
const LADO_RECORTE = 256;
/** Margen alrededor de la caja al recortar. */
const MARGEN = 0.12;
/** Cada cuánto se releen los ajustes (interruptores, cámaras). */
const AJUSTES_MS = 30_000;
/** Cada cuánto se escribe el estado para la pantalla. */
const ESTADO_MS = 15_000;
/** Cada cuánto corre la limpieza por retención, y cuántas filas borra por vez. */
const LIMPIEZA_MS = 60 * 60_000;
const LIMPIEZA_LOTE = 500;
const RETENCION_DIAS_DEFECTO = 7;
/** Los cruces (conteo por línea) no llevan foto y pesan poco: se guardan más para poder comparar semanas. */
const RETENCION_CRUCES_DIAS = 90;
/**
 * Empresa por rotulado: el texto pintado en un vehículo no se lee en el substream (704×576),
 * así que al aparecer un vehículo (y cuando mejora su foto) se pide un cuadro del stream
 * principal, como mucho cada tanto por pista, y al cerrarse la pista se lee el texto de ese
 * recorte con el OCR de omni-vision. Una lectura por vehículo, no por cuadro.
 */
const HD_CADA_MS = 4000;
const MARGEN_ROTULO = 0.15;
const ANCHO_MIN_ROTULO = 80;
const CONF_TEXTO = 0.7;
/**
 * Carril rápido para las cámaras con reglas de LÍNEA (conteo, sentido contrario). Medido el
 * primer día (9/10): con la ronda de ~2-4 s por cámara, un auto en la calle de la LPR Interior
 * aparecía en UN solo cuadro (pistas de 1 cuadro): nunca se lo veía de los dos lados de la
 * línea, y el conteo daba cero. Para esas cámaras un ffmpeg lee el substream del restream de
 * go2rtc a RAPIDO_FPS y el worker analiza el último cuadro apenas termina el anterior; la
 * compuerta de cambio de escena compara contra el último cuadro ANALIZADO (a 4 c/s dos cuadros
 * seguidos casi no cambian, y una persona caminando lejos nunca pasaría el umbral).
 */
const RAPIDO_FPS = Number(process.env.VISION_REGLAS_FPS || 4);
const RTSP_GO2RTC = (process.env.GO2RTC_RTSP || "rtsp://127.0.0.1:8554").replace(/\/$/, "");
/** Atributos (SigLIP) sólo cada tantos cuadros en el carril rápido: son para la foto del registro, no para las reglas. */
const RAPIDO_ATRIBUTOS_CADA = 4;
/**
 * Lo que sobreimprime la cámara (fecha, hora, día) también aparece en el recorte de un vehículo
 * que pasa debajo, y cortado no lo reconoce el filtro de omni-vision: «26 Fri15:02.04» es la
 * punta de «10-09-2026 Fri 15:02:04» (primer día, 9/10). No es rotulado.
 */
const PARECE_SOBREIMPRESO = /(\d{1,2}[:.]\d{2}[:.]\d{2})|\b(mon|tue|wed|thu|fri|sat|sun)(?![a-z])|(\d{2}[-/.]\d{2}[-/.]\d{2,4})|camera|zona \d|puesto \d/i;

const log = (...a) => console.log(new Date().toISOString(), "[vision]", ...a);

// ─────────────────────────── ajustes ───────────────────────────

async function ajuste(clave, porDefecto = null) {
    try { const r = await prisma.setting.findUnique({ where: { key: clave } }); return r?.value ?? porDefecto; } catch { return porDefecto; }
}
function json(v, porDefecto) { try { return v ? JSON.parse(v) : porDefecto; } catch { return porDefecto; } }

// Los mismos valores por defecto que src/lib/vision-catalogo.ts: "registro" prendido, y las
// clases "poco útiles" apagadas. Se repiten acá porque este proceso no compila TypeScript; si
// cambian allá, cambian acá.
const CLASES_APAGADAS_DEFECTO = new Set([
    "train", "boat", "airplane", "bear", "elephant", "zebra", "giraffe", "tie", "laptop", "book", "scissors", "teddy bear",
    "hair drier", "toothbrush", "traffic light", "stop sign", "fire hydrant", "parking meter", "potted plant", "chair",
    "couch", "bed", "dining table", "toilet", "tv", "mouse", "remote", "keyboard", "microwave", "oven", "toaster", "sink",
    "refrigerator", "clock", "vase", "wine glass", "cup", "fork", "knife", "spoon", "bowl", "banana", "apple", "sandwich",
    "orange", "broccoli", "carrot", "hot dog", "pizza", "donut", "cake", "frisbee", "skis", "snowboard", "kite",
    "baseball bat", "baseball glove", "surfboard", "tennis racket",
]);

let ajustes = { activo: false, relectura: false, rotulado: false, clases: {}, camaras: [], dispositivos: [], retencionDias: RETENCION_DIAS_DEFECTO, leidos: 0, apagadas: new Set(), mira: true };

/**
 * Las tareas de omni-vision apagadas desde el laboratorio (Setting VISION_TAREAS, ver
 * src/lib/vision-tareas.ts). Se le mandan a omni-vision en cada lectura de ajustes: el
 * contenedor arranca con todo prendido, y así un reinicio no prende lo que alguien apagó.
 */
async function mandarTareas(apagadas) {
    try {
        await fetch(`${VISION}/tareas`, { method: "POST", body: JSON.stringify({ apagadas: [...apagadas] }), headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(20000) });
    } catch { /* omni-vision caído: se reintenta en la próxima lectura */ }
}

async function leerAjustes() {
    const [a, c, cams, ret, reglas, tareas] = await Promise.all([
        ajuste("VISION_ANALITICAS"), ajuste("VISION_CLASES"), ajuste("VISION_CAMARAS"), ajuste("VISION_RETENCION_DIAS"), ajuste("VISION_REGLAS"), ajuste("VISION_TAREAS"),
    ]);
    const apagadas = new Set((json(tareas, {}).apagadas || []).map(String));
    await mandarTareas(apagadas);
    const analiticas = json(a, {});
    const elegidas = json(cams, []);
    const dispositivos = await prisma.device.findMany({ where: { deviceType: { not: "NVR" } }, select: { id: true, name: true }, orderBy: { name: "asc" } });
    ajustes = {
        activo: analiticas.registro !== false,
        apagadas,
        // Sin detección no hay objetos, y sin seguimiento no hay pistas: ni registro ni reglas tienen
        // con qué trabajar, así que no se miran las cámaras (en vez de pedir y fallar cada cuadro).
        mira: !apagadas.has("detectar") && !apagadas.has("seguimiento"),
        // La relectura de NO_LEIDA tiene su propio interruptor (analítica «relectura», prendida por
        // defecto), y recorta el vehículo con la detección: apagada ésta, no hay relectura.
        relectura: analiticas.relectura !== false && !apagadas.has("detectar"),
        // Empresa por rotulado (analítica «rotulados», prendida por defecto): sólo en las pistas del
        // registro, y la lee el OCR (tarea «texto»).
        rotulado: analiticas.rotulados !== false && !apagadas.has("texto"),
        dispositivos,
        clases: json(c, {}),
        camaras: Array.isArray(elegidas) && elegidas.length ? dispositivos.filter((d) => elegidas.includes(d.id)) : dispositivos,
        retencionDias: Math.max(1, Number(ret) || RETENCION_DIAS_DEFECTO),
        leidos: Date.now(),
    };
    reglero?.cargar(json(reglas, []), analiticas);
}
const clasePrendida = (c) => (c in ajustes.clases ? ajustes.clases[c] === true : !CLASES_APAGADAS_DEFECTO.has(c));

// ─────────────────────────── MinIO ───────────────────────────

let s3 = null;
let preparando = null;
/** Una sola preparación aunque la pidan dos subidas a la vez (el bucket se "creaba" dos veces). */
function cliente() {
    if (s3) return Promise.resolve(s3);
    return (preparando ||= prepararCliente().finally(() => { preparando = null; }));
}
async function prepararCliente() {
    const [endpoint, accessKey, secretKey] = await Promise.all([ajuste("S3_ENDPOINT"), ajuste("S3_ACCESS_KEY"), ajuste("S3_SECRET_KEY")]);
    const c = new S3Client({
        endpoint: endpoint || process.env.S3_ENDPOINT, region: "us-east-1", forcePathStyle: true,
        credentials: { accessKeyId: accessKey || process.env.S3_ACCESS_KEY, secretAccessKey: secretKey || process.env.S3_SECRET_KEY },
    });
    try { await c.send(new HeadBucketCommand({ Bucket: BUCKET })); }
    catch { await c.send(new CreateBucketCommand({ Bucket: BUCKET })).catch(() => null); log(`bucket '${BUCKET}' creado`); }
    s3 = c;
    return s3;
}
async function subir(clave, buf) {
    await (await cliente()).send(new PutObjectCommand({ Bucket: BUCKET, Key: clave, Body: buf, ContentType: "image/jpeg" }));
}

// ─────────────────────────── cuadros ───────────────────────────

async function cuadro(deviceId) {
    for (const src of [`lpr_${deviceId}`, `lpr_${deviceId}_hd`]) {
        try {
            const r = await fetch(`${GO2RTC}/api/frame.jpeg?src=${encodeURIComponent(src)}`, { signal: AbortSignal.timeout(6000) });
            if (!r.ok) continue;
            const b = Buffer.from(await r.arrayBuffer());
            if (b.length > 1000) return b;
        } catch { }
    }
    return null;
}

/** Miniatura 64×36 en grises: la huella con la que se decide si la escena cambió. */
async function huella(jpeg) {
    return sharp(jpeg).resize(64, 36, { fit: "fill" }).greyscale().raw().toBuffer();
}
function diferencia(a, b) {
    if (!a || !b || a.length !== b.length) return Infinity;
    let s = 0;
    for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
    return s / a.length;
}

async function recortar(jpeg, cajaNorm, ancho, alto) {
    const [x1, y1, x2, y2] = cajaNorm;
    const mw = (x2 - x1) * MARGEN, mh = (y2 - y1) * MARGEN;
    const left = Math.max(0, Math.floor((x1 - mw) * ancho)), top = Math.max(0, Math.floor((y1 - mh) * alto));
    const width = Math.max(1, Math.min(ancho - left, Math.ceil((x2 - x1 + 2 * mw) * ancho)));
    const height = Math.max(1, Math.min(alto - top, Math.ceil((y2 - y1 + 2 * mh) * alto)));
    return sharp(jpeg).extract({ left, top, width, height })
        .resize(LADO_RECORTE, LADO_RECORTE, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer();
}

async function detectar(jpeg, deviceId, op = {}) {
    const q = new URLSearchParams({ umbral: String(UMBRAL), atributos: op.atributos === false || ajustes.apagadas.has("atributos") ? "0" : "1", sesion: `registro-${deviceId}`, fps: String(op.fps || 1000 / INTERVALO_MS) });
    const r = await fetch(`${VISION}/detectar?${q}`, {
        method: "POST", body: jpeg, headers: { "content-type": "image/jpeg" }, signal: AbortSignal.timeout(20000),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `omni-vision respondió ${r.status}`);
    return j;
}

// ─────────────────────────── pistas ───────────────────────────

/** Pistas abiertas: `${deviceId}:${pista}` → estado en memoria de la fila. */
const abiertas = new Map();

function dia(d) { return d.toISOString().slice(0, 10); }

async function abrir(cam, o, jpeg, r, ahora) {
    const id = crypto.randomUUID().replace(/-/g, "").slice(0, 25);
    const base = `${dia(ahora)}/${id}`;
    const [x1, , x2, y2] = o.caja_norm;
    const p = {
        id, deviceId: cam.id, camara: cam.name, clase: o.clase, grupo: o.grupo, confianza: o.confianza,
        primeraVez: ahora, ultimaVez: ahora, cuadros: 1, pista: o.pista,
        recorte: `${base}-r.jpg`, foto: `${base}-f.jpg`, caja: o.caja_norm, atributos: o.atributos || null,
        recorrido: [[round((x1 + x2) / 2), round(y2), 0]], escrita: 0,
    };
    await Promise.all([subir(p.recorte, await recortar(jpeg, o.caja_norm, r.ancho, r.alto)), subir(p.foto, jpeg)]);
    await prisma.objetoVisto.create({ data: fila(p) });
    p.escrita = Date.now();
    abiertas.set(`${cam.id}:${o.pista}`, p);
    await cuadroParaRotulo(cam, p, o);
    contadores.abiertas++;
}

async function seguir(p, o, jpeg, r, ahora) {
    p.ultimaVez = ahora;
    p.cuadros++;
    const [x1, , x2, y2] = o.caja_norm;
    if (p.recorrido.length < RECORRIDO_MAX) p.recorrido.push([round((x1 + x2) / 2), round(y2), Math.round((ahora - p.primeraVez) / 1000)]);
    let mejoro = false;
    if (o.confianza > p.confianza + MEJORA_MIN) {
        // Mejor foto: se reemplazan recorte y cuadro (mismas claves) y lo que sale de ellos.
        p.confianza = o.confianza; p.caja = o.caja_norm; p.atributos = o.atributos || p.atributos;
        await Promise.all([subir(p.recorte, await recortar(jpeg, o.caja_norm, r.ancho, r.alto)), subir(p.foto, jpeg)]);
        mejoro = true;
        await cuadroParaRotulo({ id: p.deviceId }, p, o);
    }
    if (mejoro || Date.now() - p.escrita > REFRESCO_PISTA_MS) {
        await prisma.objetoVisto.update({ where: { id: p.id }, data: fila(p) });
        p.escrita = Date.now();
    }
}

/** Guarda un cuadro del stream principal de un vehículo, para leer su rotulado al cerrar la pista. */
async function cuadroParaRotulo(cam, p, o) {
    if (!ajustes.rotulado || p.grupo !== "vehiculo" || Date.now() - (p.hdT || 0) < HD_CADA_MS) return;
    p.hdT = Date.now();
    try {
        const r = await fetch(`${GO2RTC}/api/frame.jpeg?src=${encodeURIComponent(`lpr_${cam.id}_hd`)}`, { signal: AbortSignal.timeout(6000) });
        if (!r.ok) return;
        const b = Buffer.from(await r.arrayBuffer());
        if (b.length > 1000) p.hd = { jpeg: b, caja: o.caja_norm };
    } catch { /* sin cuadro principal no hay rotulado: no es un error del registro */ }
}

/** Lee el texto del vehículo en el cuadro principal guardado (una vez por pista). */
async function leerRotulo(p) {
    const meta = await sharp(p.hd.jpeg).metadata();
    const W = meta.width || 0, H = meta.height || 0;
    const [x1, y1, x2, y2] = p.hd.caja;
    const mw = (x2 - x1) * MARGEN_ROTULO, mh = (y2 - y1) * MARGEN_ROTULO;
    const left = Math.max(0, Math.floor((x1 - mw) * W)), top = Math.max(0, Math.floor((y1 - mh) * H));
    const width = Math.min(W - left, Math.ceil((x2 - x1 + 2 * mw) * W)), height = Math.min(H - top, Math.ceil((y2 - y1 + 2 * mh) * H));
    if (width < ANCHO_MIN_ROTULO || height < 20) return null;
    const recorte = await sharp(p.hd.jpeg).extract({ left, top, width, height }).jpeg({ quality: 92 }).toBuffer();
    const r = await fetch(`${VISION}/detectar?texto=1&umbral=0.9`, { method: "POST", body: recorte, headers: { "content-type": "image/jpeg" }, signal: AbortSignal.timeout(20000) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `omni-vision respondió ${r.status}`);
    const textos = (j.textos || [])
        .filter((t) => !t.sobreimpreso && !PARECE_SOBREIMPRESO.test(String(t.texto)) && t.confianza >= CONF_TEXTO && String(t.texto).replace(/[^A-Za-z0-9]/g, "").length >= 3)
        .map((t) => ({ texto: t.texto, confianza: t.confianza, tipo: t.tipo }));
    return textos.length ? textos.slice(0, 12) : [];
}

async function cerrar(clave, p) {
    abiertas.delete(clave);
    if (p.hd && ajustes.rotulado) {
        try { p.textos = await leerRotulo(p); contadores.rotulos++; if (p.textos?.length) contadores.conTexto++; }
        catch (e) { contadores.errores++; }
        p.hd = null;
    }
    await prisma.objetoVisto.update({ where: { id: p.id }, data: fila(p) }).catch((e) => log("no se pudo cerrar", p.id, e.message));
    contadores.cerradas++;
}

const round = (v) => Math.round(v * 10000) / 10000;
function fila(p) {
    return {
        id: p.id, deviceId: p.deviceId, camara: p.camara, clase: p.clase, grupo: p.grupo, confianza: p.confianza,
        primeraVez: p.primeraVez, ultimaVez: p.ultimaVez, cuadros: p.cuadros, pista: p.pista,
        recorte: p.recorte, foto: p.foto, caja: p.caja, atributos: p.atributos, recorrido: p.recorrido,
        ...(p.textos !== undefined ? { textos: p.textos } : {}),
    };
}

// ─────────────────────────── ciclo ───────────────────────────

const porCamara = {};   // estado para la pantalla
const contadores = { ciclos: 0, analizados: 0, saltados: 0, errores: 0, abiertas: 0, cerradas: 0, rotulos: 0, conTexto: 0 };
const huellas = {};
const ultimoAnalisis = {};
let ultimoErrorLog = 0;

/** `registra`: si esta cámara es del registro de detecciones (además puede estar por una regla). */
async function mirar(cam, registra = true) {
    const est = (porCamara[cam.id] ||= { nombre: cam.name, analizados: 0, saltados: 0, errores: 0, objetos: 0, ultimo: null, ms: null, error: null });
    est.nombre = cam.name;
    const jpeg = await cuadro(cam.id);
    if (!jpeg) { est.errores++; est.error = "go2rtc no entregó cuadro"; return; }
    await analizarCuadro(cam, jpeg, registra);
}

/**
 * Un cuadro de una cámara: compuerta de cambio, detección, reglas y registro. `rapido` = viene
 * del carril rápido (ver RAPIDO_FPS).
 */
async function analizarCuadro(cam, jpeg, registra, rapido = null) {
    const est = (porCamara[cam.id] ||= { nombre: cam.name, analizados: 0, saltados: 0, errores: 0, objetos: 0, ultimo: null, ms: null, error: null });
    est.nombre = cam.name;
    est.rapido = !!rapido;
    const h = await huella(jpeg);
    const dif = diferencia(h, huellas[cam.id]);
    // En la ronda, contra el cuadro anterior; en el carril rápido, contra el último analizado.
    if (!rapido) huellas[cam.id] = h;
    if (Number.isFinite(dif)) {
        (est.difs ||= []).push(Math.round(dif * 10) / 10);
        if (est.difs.length > 60) est.difs.shift();
    }
    const ahora = new Date();
    if (rapido) {
        // Carril rápido: a 4 c/s sólo mientras algo cambia o se mueve; quieto, al ritmo de la
        // ronda (cada INTERVALO_MS). Así un auto estacionado sigue siendo UNA pista del registro
        // —con la compuerta de la ronda se cerraba y reabría cada minuto— sin gastar 4 c/s.
        const mueve = dif >= CAMBIO_MIN || !!reglero?.enCurso(cam.id);
        if (!mueve && Date.now() - (ultimoAnalisis[cam.id] || 0) < INTERVALO_MS) { est.saltados++; contadores.saltados++; return; }
    } else {
        const conPistas = [...abiertas.values()].some((p) => p.deviceId === cam.id) || !!reglero?.enCurso(cam.id);
        if (dif < CAMBIO_MIN && !conPistas && Date.now() - (ultimoAnalisis[cam.id] || 0) < ANALIZAR_IGUAL_MS) {
            est.saltados++; contadores.saltados++;
            return;
        }
    }
    if (rapido) huellas[cam.id] = h;
    const t0 = Date.now();
    const r = await detectar(jpeg, cam.id, rapido ? { fps: RAPIDO_FPS, atributos: rapido.n % RAPIDO_ATRIBUTOS_CADA === 0 } : {});
    ultimoAnalisis[cam.id] = Date.now();
    est.analizados++; contadores.analizados++;
    est.ms = Date.now() - t0; est.ultimo = ahora.toISOString(); est.error = null;
    // Las reglas miran todo lo que vio (cada una elige sus clases); el registro, sólo las clases prendidas.
    try { await reglero?.procesar(cam, r.objetos || [], jpeg, ahora); } catch (e) { est.error = `reglas: ${e.message}`; }
    const objetos = registra ? (r.objetos || []).filter((o) => clasePrendida(o.clase)) : [];
    est.objetos = (r.objetos || []).length;
    for (const o of objetos) {
        if (o.pista == null) continue;  // todavía no confirmada por el seguimiento
        const clave = `${cam.id}:${o.pista}`;
        const p = abiertas.get(clave);
        try {
            if (!p) await abrir(cam, o, jpeg, r, ahora);
            else await seguir(p, o, jpeg, r, ahora);
        } catch (e) { est.error = `guardar: ${e.message}`; contadores.errores++; }
    }
}

async function cerrarVencidas(forzar = false) {
    const ahora = Date.now();
    for (const [clave, p] of [...abiertas]) {
        if (forzar || ahora - p.ultimaVez.getTime() > PISTA_CERRADA_MS) await cerrar(clave, p);
    }
}

function resumenDifs(v) {
    if (!v || !v.length) return null;
    const o = [...v].sort((a, b) => a - b);
    return { mediana: o[Math.floor(o.length / 2)], max: o[o.length - 1], n: o.length };
}

async function escribirEstado() {
    const camaras = Object.fromEntries(Object.entries(porCamara).map(([k, v]) => [k, { ...v, difs: undefined, cambio: resumenDifs(v.difs) }]));
    const valor = JSON.stringify({
        t: new Date().toISOString(), activo: ajustes.activo, tareasApagadas: [...ajustes.apagadas], mira: ajustes.mira, intervaloMs: INTERVALO_MS, umbral: UMBRAL, cambioMin: CAMBIO_MIN,
        camaras, contadores, pistasAbiertas: abiertas.size, retencionDias: ajustes.retencionDias,
        relectura: relector ? { activa: ajustes.relectura, ...relector.contadores } : null,
        reglas: reglero ? reglero.contadores : null, rotulado: ajustes.rotulado,
    });
    await prisma.setting.upsert({ where: { key: "VISION_REGISTRO_ESTADO" }, update: { value: valor }, create: { key: "VISION_REGISTRO_ESTADO", value: valor } }).catch(() => null);
}

async function limpiar() {
    const limite = new Date(Date.now() - ajustes.retencionDias * 86_400_000);
    // Eventos de las reglas: los de foto viven lo que las detecciones; los cruces, más.
    for (;;) {
        const viejos = await prisma.eventoVision.findMany({ where: { tipo: { not: "CRUCE" }, ts: { lt: limite } }, select: { id: true, foto: true }, take: LIMPIEZA_LOTE });
        if (!viejos.length) break;
        const claves = viejos.map((v) => v.foto).filter(Boolean).map((Key) => ({ Key }));
        if (claves.length) await (await cliente()).send(new DeleteObjectsCommand({ Bucket: BUCKET, Delete: { Objects: claves, Quiet: true } })).catch((e) => log("limpieza S3 eventos:", e.message));
        await prisma.eventoVision.deleteMany({ where: { id: { in: viejos.map((v) => v.id) } } });
        if (viejos.length < LIMPIEZA_LOTE) break;
    }
    await prisma.eventoVision.deleteMany({ where: { tipo: "CRUCE", ts: { lt: new Date(Date.now() - RETENCION_CRUCES_DIAS * 86_400_000) } } }).catch(() => null);
    // Las relecturas viven lo mismo que las detecciones: son fotos de vehículos.
    for (;;) {
        const viejas = await prisma.relectura.findMany({ where: { createdAt: { lt: limite } }, select: { id: true, recorte: true, recorteChapa: true }, take: LIMPIEZA_LOTE });
        if (!viejas.length) break;
        const claves = viejas.flatMap((v) => [v.recorte, v.recorteChapa]).filter(Boolean).map((Key) => ({ Key }));
        if (claves.length) await (await cliente()).send(new DeleteObjectsCommand({ Bucket: BUCKET, Delete: { Objects: claves, Quiet: true } })).catch((e) => log("limpieza S3 relectura:", e.message));
        await prisma.relectura.deleteMany({ where: { id: { in: viejas.map((v) => v.id) } } });
        if (viejas.length < LIMPIEZA_LOTE) break;
    }
    for (;;) {
        const viejas = await prisma.objetoVisto.findMany({ where: { primeraVez: { lt: limite } }, select: { id: true, recorte: true, foto: true }, take: LIMPIEZA_LOTE });
        if (!viejas.length) return;
        const claves = viejas.flatMap((v) => [v.recorte, v.foto]).filter(Boolean).map((Key) => ({ Key }));
        for (let i = 0; i < claves.length; i += 1000) {
            await (await cliente()).send(new DeleteObjectsCommand({ Bucket: BUCKET, Delete: { Objects: claves.slice(i, i + 1000), Quiet: true } })).catch((e) => log("limpieza S3:", e.message));
        }
        await prisma.objetoVisto.deleteMany({ where: { id: { in: viejas.map((v) => v.id) } } });
        log(`retención: ${viejas.length} detecciones de más de ${ajustes.retencionDias} días borradas`);
        if (viejas.length < LIMPIEZA_LOTE) return;
    }
}

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
let corriendo = true;

let relector = null;
let reglero = null;

// ─────────────────────────── carril rápido ───────────────────────────

/** deviceId → { cam, ffmpeg, ultimo, n, retirada } */
const rapidas = new Map();

function engancharRapida(st) {
    if (st.ffmpeg || st.retirada) return;
    const args = ["-hide_banner", "-loglevel", "error", "-rtsp_transport", "tcp", "-i", `${RTSP_GO2RTC}/lpr_${st.cam.id}`,
        "-vf", `fps=${RAPIDO_FPS},scale=w='min(960\\,iw)':h=-2`, "-q:v", "4", "-f", "image2pipe", "-vcodec", "mjpeg", "-"];
    const ch = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });
    st.ffmpeg = ch;
    log(`carril rápido: ${st.cam.name} a ${RAPIDO_FPS} c/s`);
    let buf = Buffer.alloc(0);
    const SOI = Buffer.from([0xff, 0xd8]), EOI = Buffer.from([0xff, 0xd9]);
    ch.stdout.on("data", (d) => {
        buf = Buffer.concat([buf, d]);
        let i = buf.indexOf(SOI), f = buf.indexOf(EOI, i + 2);
        while (i >= 0 && f > i) {
            st.ultimo = Buffer.from(buf.subarray(i, f + 2)); // sólo el último: si el análisis va atrás, se saltean cuadros
            buf = buf.subarray(f + 2);
            i = buf.indexOf(SOI); f = buf.indexOf(EOI, i + 2);
        }
        if (buf.length > 8 * 1024 * 1024) buf = Buffer.alloc(0);
    });
    ch.stderr.on("data", (d) => { const t = String(d).trim(); if (t) log(`ffmpeg ${st.cam.name}: ${t.slice(0, 160)}`); });
    const caida = () => {
        if (st.ffmpeg !== ch) return;
        st.ffmpeg = null;
        if (!st.retirada) { log(`carril rápido: ${st.cam.name} se cortó, reintento en 15 s`); setTimeout(() => engancharRapida(st), 15_000); }
    };
    ch.on("exit", caida); ch.on("error", caida);
}

async function bucleRapido(st) {
    const paso = 1000 / RAPIDO_FPS;
    while (corriendo && !st.retirada) {
        const t0 = Date.now();
        const jpeg = st.ultimo;
        st.ultimo = null;
        if (jpeg) {
            st.n++;
            try { await analizarCuadro(st.cam, jpeg, st.registra, st); }
            catch (e) {
                contadores.errores++;
                (porCamara[st.cam.id] ||= {}).error = e.message;
                if (Date.now() - ultimoErrorLog > 60_000) { log(`error en ${st.cam.name} (rápido): ${e.message}`); ultimoErrorLog = Date.now(); }
            }
        }
        await dormir(Math.max(jpeg ? 0 : 50, paso - (Date.now() - t0)));
    }
}

/** Prende el carril rápido de las cámaras con reglas de línea y lo apaga en las que ya no tienen. */
function sincronizarRapidas(registro) {
    const quiero = ajustes.mira ? reglero.camarasRapidas() : new Set();
    for (const [id, st] of rapidas) {
        if (quiero.has(id)) { st.registra = registro.has(id); continue; }
        st.retirada = true; try { st.ffmpeg?.kill("SIGKILL"); } catch { }
        rapidas.delete(id);
        log(`carril rápido: ${st.cam.name} vuelve a la ronda`);
    }
    for (const id of quiero) {
        if (rapidas.has(id)) continue;
        const cam = ajustes.dispositivos.find((d) => d.id === id);
        if (!cam) continue;
        const st = { cam, ffmpeg: null, ultimo: null, n: 0, retirada: false, registra: registro.has(id) };
        rapidas.set(id, st);
        engancharRapida(st);
        bucleRapido(st);
    }
}

async function principal() {
    log(`arranca · ${VISION} · cada ${INTERVALO_MS} ms · umbral ${UMBRAL} · cambio ${CAMBIO_MIN}`);
    reglero = reglasVision.iniciar({ prisma, subir, log });
    await leerAjustes().catch((e) => log("ajustes:", e.message));
    relector = relecturas.iniciar({ prisma, subir, ajuste, log, vision: VISION, activa: () => ajustes.relectura });
    let ultEstado = 0, ultLimpieza = 0, hayTrabajo = false;
    while (corriendo) {
        const t0 = Date.now();
        try {
            if (Date.now() - ajustes.leidos > AJUSTES_MS) await leerAjustes();
            // Las cámaras del registro (si está prendido) más las que tienen una regla prendida.
            const porReglas = ajustes.mira ? reglero.camaras() : new Set();
            const registro = new Set(ajustes.activo && ajustes.mira ? ajustes.camaras.map((c) => c.id) : []);
            sincronizarRapidas(registro);
            // Las del carril rápido no van en la ronda: las analiza su propio bucle.
            const lista = ajustes.dispositivos.filter((d) => (registro.has(d.id) || porReglas.has(d.id)) && !rapidas.has(d.id));
            hayTrabajo = lista.length > 0 || rapidas.size > 0;
            if (hayTrabajo) {
                for (const cam of lista) {
                    if (!corriendo) break;
                    try { await mirar(cam, registro.has(cam.id)); }
                    catch (e) {
                        contadores.errores++;
                        (porCamara[cam.id] ||= {}).error = e.message;
                        if (Date.now() - ultimoErrorLog > 60_000) { log(`error en ${cam.name}: ${e.message}`); ultimoErrorLog = Date.now(); }
                    }
                }
            }
            // Con el registro apagado, las pistas abiertas por el carril rápido también se cierran.
            await cerrarVencidas(!ajustes.activo || !ajustes.mira);
            contadores.ciclos++;
            if (Date.now() - ultEstado > ESTADO_MS) { await escribirEstado(); ultEstado = Date.now(); }
            if (Date.now() - ultLimpieza > LIMPIEZA_MS) { ultLimpieza = Date.now(); await limpiar().catch((e) => log("limpieza:", e.message)); }
        } catch (e) {
            log("ciclo:", e.message);
        }
        // Apagado, se espera más: no hay nada que hacer salvo enterarse de que lo prendieron.
        await dormir(Math.max(200, (hayTrabajo ? INTERVALO_MS : AJUSTES_MS) - (Date.now() - t0)));
    }
}

async function salir() {
    corriendo = false;
    relector?.parar();
    for (const st of rapidas.values()) { st.retirada = true; try { st.ffmpeg?.kill("SIGKILL"); } catch { } }
    await reglero?.cerrarTodo().catch(() => null);
    log("cerrando pistas abiertas…");
    await cerrarVencidas(true).catch(() => null);
    await escribirEstado().catch(() => null);
    await prisma.$disconnect().catch(() => null);
    process.exit(0);
}
process.on("SIGTERM", salir);
process.on("SIGINT", salir);

principal().catch((e) => { log("fatal:", e); process.exit(1); });
