/**
 * Pasarela de camaras comunes -> Omni-LPR -> avistamientos.
 *
 * Idea: una camara comun no sabe leer matriculas, pero sirve como sensor. Por
 * cada camara configurada se abre un ffmpeg que solo emite cuadros cuando la
 * escena cambia (auto que pasa), esos cuadros se mandan al contenedor de
 * Omni-LPR y, si aparece una matricula con confianza suficiente, se guarda un
 * avistamiento con las coordenadas de esa camara.
 *
 * Todo corre fuera del camino de la barrera: si esto se cae, el control de
 * acceso sigue igual.
 *
 * Configuracion: Setting TRACK_CAMERAS (JSON)
 *   [{ "name":"Rotonda", "rtsp":"rtsp://user:pass@ip/Streaming/Channels/101",
 *      "deviceId":"cmxxx", "lat":-34.85, "lng":-56.07, "escena":0.08 }]
 */
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();
const LPR_URL = process.env.OMNI_LPR_URL || "http://127.0.0.1:8000";
const APP_URL = process.env.INTERNAL_BASE_URL || "http://127.0.0.1:10001";
const MIN_CONF = Number(process.env.TRACKING_MIN_CONFIDENCE || 0.6);
const DIR_SHOTS = process.env.TRACKING_SHOTS_DIR || "/datos/track";
const MAX_EN_VUELO = Number(process.env.TRACKING_MAX_INFLIGHT || 2);

let token = process.env.TRACKING_TOKEN || "";
const procesos = new Map();   // nombre -> child
const enVuelo = new Map();    // nombre -> cantidad de inferencias en curso

const log = (...a) => console.log(new Date().toISOString(), "[track]", ...a);

async function ajuste(clave, porDefecto = null) {
    try { const r = await prisma.setting.findUnique({ where: { key: clave } }); return r?.value ?? porDefecto; }
    catch { return porDefecto; }
}

/**
 * Las camaras de seguimiento son dispositivos de tipo LPR_INTERIOR con su URL
 * RTSP cargada desde Dispositivos LPR. La ubicacion sale del mapa del barrio
 * (donde se arrastro esa camara), asi no hay que escribir coordenadas a mano.
 * Se mantiene el Setting TRACK_CAMERAS como respaldo de instalaciones viejas.
 */
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
    // Funcion opcional: si el interruptor de Modos > LPR esta apagado, no se
    // engancha ninguna camara.
    if ((await ajuste("OMNI_LPR_ENABLED", "false")) !== "true") return [];

    const lista = [];
    try {
        const ubic = await ubicacionesDelMapa();
        const devs = await prisma.device.findMany({
            where: { deviceType: "LPR_INTERIOR", trackEnabled: true, NOT: { rtspUrl: null } },
            select: { id: true, name: true, rtspUrl: true, trackScene: true, trackRoi: true, trackMinConf: true, trackFps: true },
        });
        for (const d of devs) {
            if (!d.rtspUrl || !d.rtspUrl.trim()) continue;
            let roi = null;
            try { roi = d.trackRoi ? JSON.parse(d.trackRoi) : null; } catch { }
            lista.push({
                name: d.name,
                rtsp: d.rtspUrl.trim(),
                deviceId: d.id,
                lat: ubic[d.id]?.lat ?? null,
                lng: ubic[d.id]?.lng ?? null,
                escena: d.trackScene ?? undefined,
                roi,
                confianza: d.trackMinConf ?? undefined,
                fps: d.trackFps ?? undefined,
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

/** Manda un cuadro a Omni-LPR y devuelve { plate, confidence } o null. */
async function leerMatricula(jpeg) {
    const cuerpo = JSON.stringify({ image_base64: jpeg.toString("base64") });
    const r = await fetch(`${LPR_URL}/api/v1/tools/detect_and_recognize_plate/invoke`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: cuerpo,
        signal: AbortSignal.timeout(20000),
    });
    if (!r.ok) throw new Error(`Omni-LPR ${r.status}`);
    const d = await r.json();
    const items = d?.content?.[0]?.data || [];
    let mejor = null;
    for (const it of items) {
        const texto = (it?.ocr?.text || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
        if (texto.length < 4) continue;
        const confOcr = Array.isArray(it?.ocr?.confidence)
            ? it.ocr.confidence.reduce((a, b) => a + b, 0) / it.ocr.confidence.length
            : (it?.ocr?.confidence ?? 0);
        const conf = Math.min(confOcr || 0, it?.detection?.confidence ?? 1);
        if (!mejor || conf > mejor.confidence) mejor = { plate: texto, confidence: conf };
    }
    return mejor;
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
    return r.status;
}

/** Lee el flujo de cuadros JPEG que escupe ffmpeg y los va despachando. */
function engancharCamara(cam) {
    if (procesos.has(cam.name)) return;
    const escena = cam.escena ?? 0.08;
    const fps = cam.fps ?? 2;
    // Zona de interes: el lector solo mira el recorte calibrado, asi ignora
    // veredas, cielo y jardines, y de paso gasta menos GPU.
    const r = cam.roi;
    const recorte = r && r.w > 0 && r.h > 0 && (r.w < 1 || r.h < 1 || r.x > 0 || r.y > 0)
        ? `crop=iw*${r.w}:ih*${r.h}:iw*${r.x}:ih*${r.y},`
        : "";
    const args = [
        "-hide_banner", "-loglevel", "error", "-rtsp_transport", "tcp",
        "-i", cam.rtsp,
        "-vf", `${recorte}fps=${fps},select='gt(scene\\,${escena})',scale=1280:-2`,
        "-vsync", "vfr", "-q:v", "4", "-f", "image2pipe", "-vcodec", "mjpeg", "-",
    ];
    const ch = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });
    procesos.set(cam.name, ch);
    enVuelo.set(cam.name, 0);
    log(`camara enganchada: ${cam.name}`);

    let buffer = Buffer.alloc(0);
    ch.stdout.on("data", (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);
        // separar imagenes completas: cada JPEG empieza con FFD8 y termina con FFD9
        let ini = buffer.indexOf(Buffer.from([0xff, 0xd8]));
        let fin = buffer.indexOf(Buffer.from([0xff, 0xd9]), ini + 2);
        while (ini >= 0 && fin > ini) {
            const jpeg = buffer.subarray(ini, fin + 2);
            buffer = buffer.subarray(fin + 2);
            despachar(cam, jpeg);
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
        procesos.delete(cam.name);
        log(`camara caida: ${cam.name}, reintento en 15s`);
        setTimeout(() => engancharCamara(cam), 15000);
    };
    ch.on("exit", reintentar);
    ch.on("error", reintentar);
}

/** Inferencia y registro; descarta cuadros si ya hay demasiados en curso. */
async function despachar(cam, jpeg) {
    const n = enVuelo.get(cam.name) || 0;
    if (n >= MAX_EN_VUELO) return; // mejor perder un cuadro que acumular atraso
    enVuelo.set(cam.name, n + 1);
    try {
        const lectura = await leerMatricula(jpeg);
        // Cada camara puede tener su propia confianza minima (calibrador).
        const minima = cam.confianza ?? MIN_CONF;
        if (lectura && lectura.confidence >= minima) {
            const url = guardarCuadro(jpeg, lectura.plate);
            const st = await avisarAvistamiento(cam, lectura, url);
            log(`${cam.name}: ${lectura.plate} (${lectura.confidence.toFixed(2)}) -> ${st}`);
        }
    } catch (e) {
        log(`${cam.name}: error de inferencia: ${e.message}`);
    } finally {
        enVuelo.set(cam.name, Math.max(0, (enVuelo.get(cam.name) || 1) - 1));
    }
}

async function sincronizar() {
    token = process.env.TRACKING_TOKEN || (await ajuste("TRACKING_TOKEN", "")) || "";
    if (!token) { log("falta TRACKING_TOKEN: la pasarela queda en pausa"); return; }

    const lista = await camaras();
    const nombres = new Set(lista.map((c) => c.name));
    for (const [nombre, ch] of procesos) {
        if (!nombres.has(nombre)) { try { ch.kill("SIGKILL"); } catch { } procesos.delete(nombre); log(`camara quitada: ${nombre}`); }
    }
    for (const cam of lista) engancharCamara(cam);
    if (!lista.length) log("sin camaras de seguimiento configuradas (Setting TRACK_CAMERAS)");
}

(async () => {
    log(`pasarela iniciada · Omni-LPR en ${LPR_URL}`);
    await sincronizar();
    setInterval(sincronizar, 60000);   // toma cambios de configuracion sin reiniciar
})();

process.on("SIGTERM", () => { for (const [, ch] of procesos) { try { ch.kill("SIGKILL"); } catch { } } process.exit(0); });
