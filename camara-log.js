// Copia el registro de lecturas de cada cámara LPR (lo que la cámara dice que leyó) a la tabla
// LecturaCamara, para poder compararlo con lo que recibió OmniAccess y con lo que releyó OmniVision.
// Corre como su propio proceso de pm2 (camara-log): si una cámara no contesta, no frena a nadie.
//
// Por qué hace falta (16/10, Nico: «necesito ver el log de la cámara para ver las lecturas que
// realizó, para validar las detecciones y poder compararlas»):
//  · OmniAccess sólo sabe de las lecturas cuya alarma le llegó. Si la cámara leyó y el evento se
//    perdió (red, reinicio del receptor, cola llena), no hay rastro en ningún lado.
//  · La cámara guarda sus lecturas, pero SÓLO las últimas ~20 en memoria: las LPR de San Nicolás
//    no tienen tarjeta ni NAS (ContentMgmt/search contesta invalidMemoryCardOrNAS). Medido el
//    16/10: LPR Salida tenía las 20 de los últimos 14 minutos. Hay que copiarlas seguido.
//
// Cómo: POST /ISAPI/Traffic/channels/1/vehicleDetect/plates con un <picTime> viejo devuelve las
// lecturas que la cámara tiene (con un picTime de hoy devuelve 0: el firmware V5.8 no filtra como
// dice el manual; se pide «desde hace mucho» y se deduplica por picName, el id de la captura).
require("dotenv").config({ path: require("path").join(__dirname, ".env") });
const http = require("http");
const crypto = require("crypto");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

/** Cada cuánto se le pide a cada cámara. A ~1,5 lecturas/min, 30 s deja de sobra antes de que se pisen las 20. */
const CADA_MS = Number(process.env.CAMARA_LOG_CADA_MS || 30_000);
/** Cada cuánto se vuelve a mirar qué cámaras hay y cuáles contestan el registro. */
const RELEER_CAMARAS_MS = 10 * 60_000;
/** Una cámara que no tiene registro de lecturas (no es ANPR) se vuelve a probar recién después de esto. */
const REPROBAR_MS = 60 * 60_000;
const TIEMPO_MS = 8000;
/** Cuánto se guardan las lecturas copiadas. */
const RETENCION_DIAS = Number(process.env.CAMARA_LOG_DIAS || 30);
const LIMPIEZA_MS = 6 * 3600_000;

const log = (...a) => console.log(new Date().toISOString(), "[camara-log]", ...a);
const md5 = (s) => crypto.createHash("md5").update(s).digest("hex");
function parseWWW(h) { const o = {}; (h || "").replace(/(\w+)=(?:"([^"]*)"|([^,]*))/g, (m, k, q, v) => { o[k] = q !== undefined ? q : (v || "").trim(); return m; }); return o; }
function digestHeader(user, pass, method, uri, wa) {
    const p = parseWWW(wa); const nc = "00000001", cnonce = crypto.randomBytes(8).toString("hex");
    const ha1 = md5(`${user}:${p.realm}:${pass}`), ha2 = md5(`${method}:${uri}`);
    const qop = p.qop ? p.qop.split(",")[0] : undefined;
    const resp = qop ? md5(`${ha1}:${p.nonce}:${nc}:${cnonce}:${qop}:${ha2}`) : md5(`${ha1}:${p.nonce}:${ha2}`);
    let h = `Digest username="${user}", realm="${p.realm}", nonce="${p.nonce}", uri="${uri}", response="${resp}"`;
    if (p.opaque) h += `, opaque="${p.opaque}"`;
    if (qop) h += `, qop=${qop}, nc=${nc}, cnonce="${cnonce}"`;
    return h;
}
function pedir(ip, path, user, pass, body) {
    return new Promise((resolve) => {
        const hacer = (auth) => {
            const req = http.request({ host: ip, port: 80, path, method: "POST", timeout: TIEMPO_MS, headers: { "Content-Type": "application/xml", "Content-Length": Buffer.byteLength(body), ...(auth ? { Authorization: auth } : {}) } }, (res) => {
                if (res.statusCode === 401 && !auth) {
                    const wa = res.headers["www-authenticate"]; res.resume();
                    if (wa) hacer(digestHeader(user, pass, "POST", path, wa)); else resolve({ status: 401, texto: "" });
                    return;
                }
                const partes = []; res.on("data", (c) => partes.push(c));
                res.on("end", () => resolve({ status: res.statusCode, texto: Buffer.concat(partes).toString("utf8") }));
                res.on("error", () => resolve(null));
            });
            req.on("timeout", () => { try { req.destroy(); } catch { } resolve(null); });
            req.on("error", () => resolve(null));
            req.end(body);
        };
        hacer(null);
    });
}

/** «20261016T081535-300» → Date. El sufijo es la zona en ±HMM (-300 = -03:00). */
function hora(t) {
    const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})([+-])(\d{1,2})(\d{2})$/.exec(String(t || "").trim());
    if (!m) return null;
    const off = (m[7] === "-" ? -1 : 1) * (Number(m[8]) * 60 + Number(m[9]));
    return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) - off * 60_000);
}
const campo = (xml, k) => { const m = new RegExp(`<${k}>([^<]*)</${k}>`).exec(xml); return m ? m[1].trim() : null; };

let camaras = [];           // [{ id, name, ip, user, pass }]
const sinRegistro = new Map(); // deviceId → hasta cuándo no se prueba
const estado = {};          // deviceId → { ultimo, nuevas, error }

async function leerCamaras() {
    const devs = await prisma.device.findMany({
        where: { deviceType: { not: "NVR" }, brand: "HIKVISION", ip: { not: "" } },
        select: { id: true, name: true, ip: true, username: true, password: true },
    });
    camaras = devs.map((d) => ({ id: d.id, name: d.name, ip: d.ip, user: d.username || "admin", pass: d.password || "" }));
}

async function copiar(cam) {
    if ((sinRegistro.get(cam.id) || 0) > Date.now()) return;
    const r = await pedir(cam.ip, "/ISAPI/Traffic/channels/1/vehicleDetect/plates", cam.user, cam.pass, "<AfterTime><picTime>20200101T000000</picTime></AfterTime>");
    const est = (estado[cam.id] ||= { nombre: cam.name, ultimo: null, nuevas: 0, error: null });
    if (!r) { est.error = "no contesta"; return; }
    if (r.status !== 200 || !/<Plates[\s>]/.test(r.texto)) {
        // No es una cámara ANPR (o el firmware no tiene el registro): se deja de pedir un rato.
        sinRegistro.set(cam.id, Date.now() + REPROBAR_MS);
        est.error = `sin registro de lecturas (HTTP ${r.status})`;
        return;
    }
    const filas = [];
    for (const m of r.texto.matchAll(/<Plate>([\s\S]*?)<\/Plate>/g)) {
        const x = m[1];
        const picName = campo(x, "picName"), ts = hora(campo(x, "captureTime"));
        if (!picName || !ts) continue;
        const plate = campo(x, "plateNumber");
        filas.push({
            deviceId: cam.id, picName, ts,
            plate: plate && plate.toLowerCase() !== "unknown" ? plate.toUpperCase() : null,
            pais: campo(x, "country"), sentido: campo(x, "direction"),
            carril: Number(campo(x, "laneNo")) || null, lista: campo(x, "matchingResult"),
        });
    }
    if (filas.length) {
        const res = await prisma.lecturaCamara.createMany({ data: filas, skipDuplicates: true });
        est.nuevas += res.count;
        if (res.count >= 20) log(`${cam.name}: las ${res.count} eran nuevas — puede haberse perdido alguna entre copias (la cámara guarda ~20)`);
    }
    est.ultimo = new Date().toISOString(); est.error = null;
}

async function escribirEstado() {
    const value = JSON.stringify({ t: new Date().toISOString(), cadaMs: CADA_MS, camaras: estado });
    await prisma.setting.upsert({ where: { key: "CAMARA_LOG_ESTADO" }, update: { value }, create: { key: "CAMARA_LOG_ESTADO", value } }).catch(() => null);
}

async function principal() {
    log(`arranca · cada ${CADA_MS / 1000} s · guarda ${RETENCION_DIAS} días`);
    let leidas = 0, limpiado = 0;
    for (;;) {
        const t0 = Date.now();
        try {
            if (Date.now() - leidas > RELEER_CAMARAS_MS) { await leerCamaras(); leidas = Date.now(); }
            // En paralelo: cada cámara tarda lo suyo y una caída no demora a las demás.
            await Promise.all(camaras.map((c) => copiar(c).catch((e) => { (estado[c.id] ||= { nombre: c.name }).error = e.message; })));
            await escribirEstado();
            if (Date.now() - limpiado > LIMPIEZA_MS) {
                limpiado = Date.now();
                const n = await prisma.lecturaCamara.deleteMany({ where: { ts: { lt: new Date(Date.now() - RETENCION_DIAS * 86_400_000) } } });
                if (n.count) log(`limpieza: ${n.count} lecturas de más de ${RETENCION_DIAS} días`);
            }
        } catch (e) { log("ciclo:", e.message); }
        await new Promise((r) => setTimeout(r, Math.max(1000, CADA_MS - (Date.now() - t0))));
    }
}

process.on("SIGINT", async () => { await prisma.$disconnect().catch(() => null); process.exit(0); });
principal();
