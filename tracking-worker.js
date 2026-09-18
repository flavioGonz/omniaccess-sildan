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
const { spawn } = require("child_process");
const http = require("http");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
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

let token = process.env.TRACKING_TOKEN || "";
const camarasVivas = new Map();   // nombre -> estado de esa camara

const log = (...a) => console.log(new Date().toISOString(), "[track]", ...a);

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
            },
        });
        for (const d of devs) {
            if (!d.rtspUrl || !d.rtspUrl.trim()) continue;
            let roi = null;
            try { roi = d.trackRoi ? JSON.parse(d.trackRoi) : null; } catch { }
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
            votos.set(c, (votos.get(c) || 0) + l.confidence);
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

// ─────────────────────────── Rafagas ───────────────────────────

/** Abre una rafaga: junta los cuadros de antes y de despues, los lee y consolida. */
function disparar(est, motivo) {
    const ahora = Date.now();
    if (est.rafaga) return;                 // ya hay una abierta
    if (ahora < est.mudoHasta) return;      // acabamos de resolver una

    // Los cuadros de justo antes del aviso suelen ser los mejores: el vehiculo
    // todavia esta entrando en cuadro y la chapa no se fue de foco.
    const previos = est.memoria.filter((c) => ahora - c.t <= RAFAGA_ANTES_MS).map((c) => c.jpeg);
    est.rafaga = { motivo, cuadros: previos.slice(-RAFAGA_MAX_CUADROS) };
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
        const lecturas = [];
        for (let i = 0; i < cuadros.length; i += MAX_EN_VUELO) {
            const tanda = cuadros.slice(i, i + MAX_EN_VUELO);
            const res = await Promise.all(tanda.map((j) => leerMatricula(j).catch(() => null)));
            for (const x of res) if (x) lecturas.push(x);
        }
        if (!lecturas.length) return;

        const v = votar(lecturas);
        const minima = cam.confianza ?? MIN_CONF;

        // Dos caminos para aceptar: varios cuadros que coinciden, o uno muy seguro.
        const respaldada = v.reads >= COINCIDENCIAS_MIN || v.maxima >= CONF_ALTA;
        if (!respaldada) {
            log(`${cam.name}: ${v.plate} descartada (${v.reads} de ${v.cuadros} cuadros, max ${v.maxima.toFixed(2)})`);
            return;
        }
        if (v.confidence < minima) {
            log(`${cam.name}: ${v.plate} bajo el minimo (${v.confidence.toFixed(2)} < ${minima})`);
            return;
        }

        // Se guarda el cuadro de la lectura mas segura, no uno cualquiera.
        const mejorIdx = lecturas.indexOf(lecturas.reduce((a, b) => (b.confidence > a.confidence ? b : a)));
        const url = guardarCuadro(cuadros[Math.min(mejorIdx, cuadros.length - 1)], v.plate);
        const st = await avisarAvistamiento(cam, v, url);
        log(`${cam.name}: ${v.plate} (${v.confidence.toFixed(2)} · ${v.reads}/${v.cuadros} cuadros · ${r.motivo}) -> ${st}`);
    } catch (e) {
        log(`${cam.name}: error resolviendo la rafaga: ${e.message}`);
    }
}

// ─────────────────────── Flujo de cuadros ───────────────────────

function engancharCamara(est) {
    const cam = est.cam;
    if (est.ffmpeg) return;

    const escena = cam.escena ?? 0.08;
    const porCamara = cam.disparo === "camara";
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
    log(`camara enganchada: ${cam.name} (disparo: ${porCamara ? "camara" : "escena"}, ${fps} c/s${recorte ? ", con zona de interes" : ""})`);

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
    if (est.cam.disparo !== "camara") disparar(est, "escena");
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
    if (!/linedetection|fielddetection|regionEntrance|regionExiting/i.test(tipo)) return;
    // "duration" y "VMD" son el latido y el movimiento crudo: justo lo que este modo vino a evitar.
    const estado = (/<eventState>([^<]+)<\/eventState>/i.exec(xml) || [])[1] || "active";
    if (estado !== "active") return;
    // Si el aviso trae clasificacion y dice que es una persona, no es lo nuestro.
    if (/<detectionTarget>human<\/detectionTarget>/i.test(xml) && !/vehicle/i.test(xml)) return;
    disparar(est, `camara:${tipo}`);
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

        const est = { cam, huella, memoria: [], rafaga: null, temporizador: null, mudoHasta: 0, ffmpeg: null, escucha: null, retirada: false };
        camarasVivas.set(cam.name, est);
        engancharCamara(est);
        if (cam.disparo === "camara") escucharCamara(est);
    }

    if (!lista.length) log("sin camaras de seguimiento configuradas");
}

(async () => {
    log(`pasarela iniciada · Omni-LPR en ${LPR_URL}`);
    await sincronizar();
    setInterval(sincronizar, 60000);   // toma cambios de configuracion sin reiniciar
})();

process.on("SIGTERM", () => {
    for (const [, est] of camarasVivas) {
        est.retirada = true;
        try { est.ffmpeg && est.ffmpeg.kill("SIGKILL"); } catch { }
        try { est.escucha && est.escucha.destroy(); } catch { }
    }
    process.exit(0);
});
