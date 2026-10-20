"use strict";
/**
 * El bot de Telegram de OmniAccess (proceso pm2 `telegram-bot`).
 *
 * 20/10, Nico: «configurá el Telegram de San Nicolás, comandos iguales al de WhatsApp, pero
 * agregale los sabores modernos de Telegram; permite contenido multimedia y explotá sus
 * funciones al máximo». Lo que hace igual que el bot de WhatsApp (waha-handler.js): último,
 * entradas, salidas, accesos, matrícula, intrusión, estado, lista negra, agregar matrícula,
 * alertas e invitar. Lo que suma Telegram:
 *  · botones debajo de cada respuesta (ver fotos, la cámara ahora, un clip, lista negra…) en vez
 *    de pedir que se escriba el próximo comando;
 *  · álbumes de hasta 10 capturas con su pie, la cámara en vivo y un clip de 10 s de video;
 *  · listas que se paginan y estados que se actualizan EDITANDO el mismo mensaje;
 *  · el menú de comandos de Telegram (setMyCommands), distinto en el grupo y en privado;
 *  · pedir el número con el botón «Compartir mi número» (Telegram no lo da solo) para saber quién
 *    escribe en privado; el pase de visita con botón para abrirlo y para reenviarlo.
 *
 * Quién lo usa (decisión de Nico, 20/10): en el GRUPO configurado (TELEGRAM_CHAT_ID), todos sus
 * miembros son personal. En PRIVADO, cada uno se identifica una vez compartiendo su número: si es
 * personal (el mismo criterio que WhatsApp: rol ADMIN/STAFF/SECURITY/OPERATOR con ese celular,
 * BOT_ADMIN_PHONES o WHATSAPP_ALLOWLIST) tiene todo; si es residente, sólo invitar y sus pases;
 * si no es nadie, nada. En un grupo que no es el configurado, el bot se va.
 *
 * Por qué un proceso aparte y por long polling (getUpdates) y no un webhook: no hay que abrir una
 * ruta pública nueva ni reiniciar omniaccess-webhooks (server.js) para tocar el bot, y si el bot
 * se cae no se lleva nada más con él. Un bot lo escucha UN solo proceso a la vez: si otro lo
 * está escuchando, Telegram contesta 409 y acá se espera y se reintenta.
 *
 * Lo que manda solo (las alertas de las reglas) sigue saliendo por dispatch-worker con el mismo
 * token y grupo; los botones de esas alertas («la cámara ahora», «clip») los atiende este proceso.
 */
require("dotenv").config({ path: require("path").join(__dirname, ".env") });
const { PrismaClient } = require("@prisma/client");
const axios = require("axios");
const crypto = require("crypto");

const opcional = (m) => { try { return require(m); } catch { return null; } };
const sharp = opcional("sharp");
const QRLIB = opcional("qrcode");
const firmarUrl = opcional("./firma-medios")?.firmarUrl || ((u) => u);
const listaNegra = opcional("./lib-lista-negra");

const prisma = new PrismaClient();

const LOCAL = process.env.OMNI_LOCAL_URL || "http://127.0.0.1:10001";
const GO2RTC = (process.env.GO2RTC_API || "http://127.0.0.1:1984").replace(/\/+$/, "");
const ZONA = "America/Montevideo";
/** Cada cuánto se relee la configuración (token, grupo, interruptores de comandos). */
const RELEER_CFG_MS = 60_000;
/** Un mensaje más viejo que esto no se contesta: al arrancar, Telegram entrega lo que quedó pendiente. */
const VIEJO_SEG = 10 * 60;
/** Una conversación a medias (agregar, invitar) se olvida a los 15 min. */
const SESION_MS = 15 * 60_000;
/** Lo que se sabe de cada persona en privado (su rol) se vuelve a mirar al minuto. */
const QUIEN_MS = 60_000;
const FOTO_ANCHO = 1280;
const ALBUM_MAX = 10;
const POR_PAGINA = 10;
/** El clip en vivo: segundos del stream de go2rtc, y debajo de esto no hubo video. */
const CLIP_SEG = 10;
const CLIP_MIN_BYTES = 30_000;
const CAMARAS_MAX = 48;
const ROLES_PERSONAL = ["ADMIN", "STAFF", "SECURITY", "OPERATOR"];
const TIPOS_CAMARA = ["LPR_CAMERA", "LPR_INTERIOR", "CAMERA"];
const TIPO_EQUIPO = { LPR_CAMERA: "LPR de barrera", LPR_INTERIOR: "Cámara interior", CAMERA: "Cámara de intrusión", NVR: "Grabador", QUEUE_COUNTER: "Contador", DOOR_INTERCOM: "Portero", FACE_TERMINAL: "Terminal facial" };
/** Sin señal en 10 min = caído (el mismo criterio que «estado» por WhatsApp). */
const RECIENTE_MS = 10 * 60_000;

const log = (...a) => console.log(new Date().toISOString(), "[telegram]", ...a);
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

// ───────────────────────── configuración ─────────────────────────

let cfg = null;
let bot = null; // getMe
async function ajuste(key) { try { return ((await prisma.setting.findUnique({ where: { key } }))?.value || "").trim(); } catch { return ""; } }
async function leerCfg() {
    const [token, chat, activo, base, cmds, logo] = await Promise.all(["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID", "TELEGRAM_BOT", "BASE_URL", "WAHA_COMMANDS", "MARCA_AGUA_WHATSAPP"].map(ajuste));
    // Los interruptores del cajón «Comandos del bot» valen para los dos bots: los comandos son los mismos.
    const comandos = {};
    try { for (const c of JSON.parse(cmds || "[]")) if (c && c.id) comandos[c.id] = c.active !== false; } catch { }
    return {
        token: token || process.env.TELEGRAM_BOT_TOKEN || "",
        chat: chat || process.env.TELEGRAM_CHAT_ID || "",
        activo: activo !== "false",
        base: (base || LOCAL).replace(/\/+$/, ""),
        comandos,
        // El mismo interruptor que el logo de WhatsApp (Ajustes → Video del evento): prendido salvo que digan que no.
        logo: logo !== "false",
    };
}
const cmdActivo = (id) => cfg?.comandos?.[id] !== false;

// ───────────────────────── API de Telegram ─────────────────────────

async function tg(metodo, params = {}, archivos = null, intento = 0) {
    const url = `https://api.telegram.org/bot${cfg.token}/${metodo}`;
    const espera = metodo === "getUpdates" ? 70_000 : archivos ? 120_000 : 20_000;
    let r;
    if (archivos) {
        const fd = new FormData();
        for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) fd.append(k, typeof v === "object" ? JSON.stringify(v) : String(v));
        for (const a of archivos) fd.append(a.campo, new Blob([a.buf], { type: a.tipo }), a.nombre);
        r = await fetch(url, { method: "POST", body: fd, signal: AbortSignal.timeout(espera) });
    } else {
        r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(params), signal: AbortSignal.timeout(espera) });
    }
    const j = await r.json().catch(() => ({ ok: false, description: `HTTP ${r.status}` }));
    if (!j.ok) {
        if (j.error_code === 429 && intento < 2) { await dormir(((j.parameters && j.parameters.retry_after) || 3) * 1000); return tg(metodo, params, archivos, intento + 1); }
        const e = new Error(j.description || "error de Telegram"); e.codigo = j.error_code; e.parametros = j.parameters; throw e;
    }
    return j.result;
}

const esc = (s) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
const sinEtiquetas = (s) => String(s).replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
/** Telegram rechaza un HTML mal cerrado entero: si pasa, se manda el mismo texto sin formato. */
async function conHtml(metodo, params, archivos, campo) {
    try { return await tg(metodo, { ...params, parse_mode: "HTML" }, archivos); }
    catch (e) {
        if (!/parse entities|can't parse/i.test(e.message) || !params[campo]) throw e;
        return tg(metodo, { ...params, [campo]: sinEtiquetas(params[campo]) }, archivos);
    }
}
const corta = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
const teclado = (filas) => ({ inline_keyboard: filas.filter((f) => f && f.length) });
const boton = (text, data) => ({ text, callback_data: String(data).slice(0, 64) });

function texto(chatId, html, extra = {}) {
    return conHtml("sendMessage", { chat_id: chatId, text: corta(html, 4096), disable_web_page_preview: true, ...extra }, null, "text");
}
function editar(chatId, messageId, html, extra = {}) {
    return conHtml("editMessageText", { chat_id: chatId, message_id: messageId, text: corta(html, 4096), disable_web_page_preview: true, ...extra }, null, "text")
        .catch((e) => { if (!/not modified/i.test(e.message)) throw e; });
}
function foto(chatId, buf, caption, extra = {}) {
    return conHtml("sendPhoto", { chat_id: chatId, caption: caption ? corta(caption, 1024) : undefined, ...extra }, [{ campo: "photo", buf, nombre: "captura.jpg", tipo: "image/jpeg" }], "caption");
}
function accion(chatId, a) { tg("sendChatAction", { chat_id: chatId, action: a }).catch(() => { }); }
/** El 👀 en el mensaje: «lo vi, lo estoy buscando» mientras se arma una respuesta con fotos. */
function reaccion(chatId, messageId, emoji = "👀") { if (messageId) tg("setMessageReaction", { chat_id: chatId, message_id: messageId, reaction: [{ type: "emoji", emoji }] }).catch(() => { }); }

/** Un álbum (sendMediaGroup) de hasta 10 fotos, cada una con su pie. */
async function album(chatId, items) {
    const fotos = items.filter((x) => x && x.buf).slice(0, ALBUM_MAX);
    if (!fotos.length) return false;
    if (fotos.length === 1) { await foto(chatId, fotos[0].buf, fotos[0].pie); return true; }
    const media = fotos.map((x, i) => ({ type: "photo", media: `attach://f${i}`, caption: x.pie ? corta(x.pie, 1024) : undefined, parse_mode: "HTML" }));
    await tg("sendMediaGroup", { chat_id: chatId, media }, fotos.map((x, i) => ({ campo: `f${i}`, buf: x.buf, nombre: `f${i}.jpg`, tipo: "image/jpeg" })));
    return true;
}

// ───────────────────────── medios ─────────────────────────

async function bajar(url, ms = 15_000) {
    const r = await fetch(url, { signal: AbortSignal.timeout(ms) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return Buffer.from(await r.arrayBuffer());
}
/**
 * El logo de OmniAccess (20/10, Nico: «agregá el logo de OmniAccess»): el mismo de WhatsApp
 * (public/marca-agua-omniaccess.png, con placa oscura, abajo a la derecha, 18 % del ancho, 2 % de
 * margen: lib/clips.ts MARCA_AGUA_*), sobre toda foto y todo clip que manda el bot. La intro del
 * clip usa el logo blanco (public/logo-omniaccess-white.png) sobre el fondo de la marca.
 */
const path = require("path"), fs = require("fs");
const PUBLICO = process.env.OMNI_PUBLICO || path.join(__dirname, "public");
const ARCHIVO_MARCA = path.join(PUBLICO, "marca-agua-omniaccess.png");
const ARCHIVO_LOGO_BLANCO = path.join(PUBLICO, "logo-omniaccess-white.png");
const MARCA_ANCHO = 0.18, MARCA_MARGEN = 0.02;
/** El fondo de la marca (og-omniaccess.png) y el gris de su bajada. */
const FONDO_MARCA = "#0b1220", GRIS_MARCA = "#94a3b8";
const hayArchivo = (f) => { try { return fs.statSync(f).isFile(); } catch { return false; } };

async function conLogo(buf) {
    if (!sharp || !cfg.logo || !hayArchivo(ARCHIVO_MARCA)) return buf;
    try {
        const { width = 0, height = 0 } = await sharp(buf).metadata();
        if (!width || !height) return buf;
        const ancho = Math.max(80, Math.round(width * MARCA_ANCHO)), margen = Math.round(width * MARCA_MARGEN);
        const marca = await sharp(ARCHIVO_MARCA).resize({ width: ancho }).toBuffer();
        const alto = (await sharp(marca).metadata()).height || 0;
        return await sharp(buf).composite([{ input: marca, left: width - ancho - margen, top: Math.max(0, height - alto - margen) }]).jpeg({ quality: 84 }).toBuffer();
    } catch (e) { log("logo en la foto:", e.message); return buf; }
}
/** Las capturas de una LPR pesan ~2 MB: a 1280 px suben al instante y se ven igual en el teléfono. Llevan el logo. */
async function achicar(buf) {
    if (!sharp) return buf;
    try { return await conLogo(await sharp(buf).rotate().resize({ width: FOTO_ANCHO, withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer()); } catch { return buf; }
}
/** Lo mismo que getCleanS3Key de waha-handler: la clave plana dentro del bucket. */
const claveLimpia = (p) => (!p ? p : String(p).split("/").pop());
let buckets = null;
async function bucketDe(tipoAcceso) {
    if (!buckets || Date.now() - buckets.t > RELEER_CFG_MS) buckets = { t: Date.now(), lpr: (await ajuste("S3_BUCKET_LPR")) || "lpr", face: (await ajuste("S3_BUCKET_FACE")) || "face" };
    return tipoAcceso === "FACE" ? buckets.face : buckets.lpr;
}
async function fotoDeAcceso(ev) {
    const k = ev.snapshotPath || ev.imagePath;
    if (!k) return null;
    const ruta = String(k).startsWith("/api/") ? k : `/api/files/${await bucketDe(ev.accessType)}/${claveLimpia(k)}`;
    try { return await achicar(await bajar(firmarUrl(`${LOCAL}${ruta}`))); } catch (e) { log("foto de acceso:", e.message); return null; }
}
async function fotoDeDeteccion(d) {
    if (!d.snapshotPath) return null;
    const ruta = /^https?:\/\//i.test(d.snapshotPath) ? d.snapshotPath : `${LOCAL}${d.snapshotPath.startsWith("/") ? "" : "/"}${d.snapshotPath}`;
    try { return await achicar(await bajar(firmarUrl(ruta))); } catch (e) { log("foto de detección:", e.message); return null; }
}
async function fotoDeCamara(deviceId) {
    return achicar(await bajar(firmarUrl(`${LOCAL}/api/snapshot/${encodeURIComponent(deviceId)}`), 20_000));
}
/**
 * Un clip en vivo de la cámara: se lee el MP4 que arma go2rtc durante CLIP_SEG segundos y se
 * corta. El substream primero: es H.264 y liviano; el principal de muchas cámaras es HEVC, que
 * algunos teléfonos no reproducen dentro de Telegram.
 */
const grabando = new Set();
/**
 * El substream de las cámaras del barrio también es HEVC (medido en el lab: LPR Salida, hevc
 * 704×576), y no todos los Telegram lo reproducen. Se pasa a H.264 con ffmpeg (10 s a esa
 * resolución tardan un segundo) y con faststart, que es lo que deja verlo mientras baja. Sin
 * ffmpeg o si falla, va el original.
 */
/** Duración de la intro del clip y de sus fundidos. */
const INTRO_SEG = 1.8, FUNDIDO_SEG = 0.35, CLIP_FPS = 25;
const correr = (cmd, args, ms = 60_000) => new Promise((ok, mal) => require("child_process").execFile(cmd, args, { timeout: ms, maxBuffer: 4 * 1024 * 1024 }, (e, so) => (e ? mal(e) : ok(String(so)))));
const xml = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

/**
 * La placa de la intro: el fondo de la marca, el logo blanco y, abajo, la cámara y la hora del clip.
 * Se dibuja con sharp (SVG para el texto) y ffmpeg sólo la funde: más simple que drawtext y con la
 * misma letra que el resto de lo que dibuja el sistema.
 */
async function placaIntro(ancho, alto, camara, cuando) {
    const fondo = sharp({ create: { width: ancho, height: alto, channels: 3, background: FONDO_MARCA } });
    const capas = [];
    if (hayArchivo(ARCHIVO_LOGO_BLANCO)) {
        // El PNG tiene aire alrededor (bbox 56–982 × 153–358 de 1024×512): se recorta antes de escalar.
        const logo = await sharp(ARCHIVO_LOGO_BLANCO).trim().resize({ width: Math.round(ancho * 0.56) }).toBuffer();
        const m = await sharp(logo).metadata();
        capas.push({ input: logo, left: Math.round((ancho - m.width) / 2), top: Math.round(alto * 0.40 - m.height / 2) });
    }
    const t1 = Math.round(alto * 0.055), t2 = Math.round(alto * 0.04);
    capas.push({ input: Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${ancho}" height="${alto}">` +
        `<rect x="${Math.round(ancho / 2 - ancho * 0.05)}" y="${Math.round(alto * 0.66)}" width="${Math.round(ancho * 0.1)}" height="${Math.max(2, Math.round(alto * 0.005))}" rx="2" fill="#3b82f6"/>` +
        `<text x="50%" y="${Math.round(alto * 0.66 + t1 * 1.9)}" text-anchor="middle" font-family="Outfit, DejaVu Sans, sans-serif" font-weight="700" font-size="${t1}" fill="#ffffff">${xml(camara)}</text>` +
        `<text x="50%" y="${Math.round(alto * 0.66 + t1 * 1.9 + t2 * 1.7)}" text-anchor="middle" font-family="Outfit, DejaVu Sans, sans-serif" font-size="${t2}" fill="${GRIS_MARCA}" letter-spacing="1">${xml(cuando)}</text></svg>`) });
    return fondo.composite(capas).png().toBuffer();
}

/**
 * El clip «editado»: intro con el logo (1,8 s con fundido) + el video con el logo abajo a la
 * derecha, en H.264 con faststart.
 *
 * El substream de las cámaras del barrio es HEVC (medido en el lab: LPR Salida, hevc 704×576) y no
 * todos los Telegram lo reproducen: recodificar a H.264 hacía falta igual, así que el logo y la
 * intro no agregan una pasada más. 704×576 es D1 anamórfico de una cámara 16:9 (el principal es
 * 1920×1080): se lleva a 1024×576 para que no se vea aplastado. Con el logo apagado en Ajustes, va
 * sin intro ni logo, sólo recodificado. Si algo falla, va el original.
 */
async function aH264(buf, camara = "OmniAccess") {
    const os = require("os");
    const base = path.join(os.tmpdir(), `tg-clip-${process.pid}-${Date.now()}`);
    try {
        fs.writeFileSync(`${base}.in.mp4`, buf);
        let args;
        if (cfg.logo && sharp && hayArchivo(ARCHIVO_MARCA)) {
            const [w, h] = (await correr("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", `${base}.in.mp4`], 15_000)).trim().split(",").map(Number);
            const r = w / h;
            const alto = Math.min(720, Math.round((h || 576) / 2) * 2);
            const ancho = r > 1.15 && r < 1.45 ? Math.round(alto * 16 / 9 / 2) * 2 : Math.round(alto * (r || 16 / 9) / 2) * 2;
            fs.writeFileSync(`${base}.intro.png`, await placaIntro(ancho, alto, camara, fh(Date.now(), { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })));
            const logoAncho = Math.round(ancho * MARCA_ANCHO / 2) * 2, margen = Math.round(ancho * MARCA_MARGEN);
            args = ["-y", "-loglevel", "error",
                "-loop", "1", "-framerate", String(CLIP_FPS), "-t", String(INTRO_SEG), "-i", `${base}.intro.png`,
                "-i", `${base}.in.mp4`, "-i", ARCHIVO_MARCA,
                "-filter_complex",
                `[0:v]scale=${ancho}:${alto},setsar=1,format=yuv420p,fade=t=in:st=0:d=${FUNDIDO_SEG},fade=t=out:st=${INTRO_SEG - FUNDIDO_SEG}:d=${FUNDIDO_SEG}[intro];` +
                `[1:v]setpts=PTS-STARTPTS,scale=${ancho}:${alto},setsar=1,fps=${CLIP_FPS},format=yuv420p,fade=t=in:st=0:d=${FUNDIDO_SEG}[cam];` +
                `[2:v]scale=${logoAncho}:-1[marca];[cam][marca]overlay=x=W-w-${margen}:y=H-h-${margen},format=yuv420p[video];` +
                `[intro][video]concat=n=2:v=1:a=0[salida]`,
                "-map", "[salida]", "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "26", "-pix_fmt", "yuv420p", "-movflags", "+faststart", `${base}.mp4`];
        } else {
            args = ["-y", "-loglevel", "error", "-i", `${base}.in.mp4`, "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "27", "-pix_fmt", "yuv420p", "-movflags", "+faststart", `${base}.mp4`];
        }
        await correr("ffmpeg", args, 90_000);
        const salida = fs.readFileSync(`${base}.mp4`);
        return salida.length >= CLIP_MIN_BYTES / 3 ? salida : buf;
    } catch (e) { log("clip editado:", e.message); return buf; }
    finally { for (const f of [`${base}.in.mp4`, `${base}.intro.png`, `${base}.mp4`]) try { fs.unlinkSync(f); } catch { } }
}
async function clipEnVivo(deviceId, camara) {
    for (const src of [`lpr_${deviceId}`, `lpr_${deviceId}_hd`]) {
        const ctrl = new AbortController();
        const tope = setTimeout(() => ctrl.abort(), (CLIP_SEG + 20) * 1000);
        try {
            const r = await fetch(`${GO2RTC}/api/stream.mp4?src=${encodeURIComponent(src)}&duration=${CLIP_SEG}`, { signal: ctrl.signal });
            if (!r.ok || !r.body) continue;
            const partes = []; let total = 0; let inicio = 0;
            const lector = r.body.getReader();
            for (;;) {
                const { done, value } = await lector.read();
                if (done) break;
                if (!inicio) inicio = Date.now();
                partes.push(Buffer.from(value)); total += value.length;
                if (Date.now() - inicio > CLIP_SEG * 1000 || total > 45 * 1024 * 1024) { lector.cancel().catch(() => { }); break; }
            }
            if (total >= CLIP_MIN_BYTES) return aH264(Buffer.concat(partes), camara);
        } catch (e) { log(`clip ${src}:`, e.message); }
        finally { clearTimeout(tope); }
    }
    return null;
}

// ───────────────────────── quién escribe ─────────────────────────

const cola8 = (t) => String(t || "").replace(/\D/g, "").slice(-8);
async function listaDeSetting(key) { try { return JSON.parse((await ajuste(key)) || "[]"); } catch { return []; } }
const enLista = (arr, cola) => Array.isArray(arr) && arr.some((p) => cola8(typeof p === "string" ? p : p && p.phone) === cola);

/** Personal: el mismo criterio que isAdminSender de waha-handler. */
async function esPersonal(cola) {
    if (!cola) return false;
    try {
        const users = await prisma.user.findMany({ where: { role: { in: ROLES_PERSONAL }, phone: { not: null } }, select: { phone: true } });
        if (users.some((u) => cola8(u.phone) === cola)) return true;
    } catch { }
    return enLista(await listaDeSetting("BOT_ADMIN_PHONES"), cola) || enLista(await listaDeSetting("WHATSAPP_ALLOWLIST"), cola);
}
/** Residente: el mismo criterio que resolveHost de waha-handler (la ficha o INVITE_WA_ALLOWLIST). */
async function residente(cola) {
    if (!cola) return null;
    try {
        const users = await prisma.user.findMany({ where: { role: "RESIDENT", phone: { not: null } }, select: { id: true, name: true, unitId: true, phone: true, apartment: true } });
        const u = users.find((x) => cola8(x.phone) === cola);
        if (u) {
            let label = u.apartment || "";
            if (u.unitId) { const un = await prisma.unit.findUnique({ where: { id: u.unitId }, select: { name: true, lot: true, houseNumber: true } }).catch(() => null); if (un) label = [un.name, un.lot ? `Lote ${un.lot}` : un.houseNumber].filter(Boolean).join(" · ") || label; }
            return { userId: u.id, name: u.name, unitId: u.unitId, label };
        }
    } catch { }
    const hit = (await listaDeSetting("INVITE_WA_ALLOWLIST")).find((e) => cola8(typeof e === "string" ? e : e && e.phone) === cola);
    return hit ? { userId: hit.userId || null, name: hit.name || "Residente", unitId: hit.unitId || null, label: hit.label || "" } : null;
}

/** Los vínculos Telegram → número viven en Setting TELEGRAM_VINCULOS: { [idTelegram]: { cola, nombre, desde } }. */
async function vinculos() { try { return JSON.parse((await ajuste("TELEGRAM_VINCULOS")) || "{}") || {}; } catch { return {}; } }
async function guardarVinculo(id, datos) {
    const v = await vinculos();
    if (datos) v[id] = datos; else delete v[id];
    await prisma.setting.upsert({ where: { key: "TELEGRAM_VINCULOS" }, update: { value: JSON.stringify(v) }, create: { key: "TELEGRAM_VINCULOS", value: JSON.stringify(v) } });
    quienCache.delete(String(id));
}
const quienCache = new Map();
/** El rol se recalcula con el número guardado: si a alguien le sacan el rol, deja de poder. */
async function quienEs(idTelegram) {
    const c = quienCache.get(String(idTelegram));
    if (c && Date.now() - c.t < QUIEN_MS) return c.v;
    const vin = (await vinculos())[idTelegram];
    let v = null;
    if (vin) {
        if (await esPersonal(vin.cola)) v = { rol: "personal", ...vin };
        else { const h = await residente(vin.cola); v = h ? { rol: "residente", host: h, ...vin } : { rol: "nadie", ...vin }; }
    }
    quienCache.set(String(idTelegram), { t: Date.now(), v });
    return v;
}

/** El contexto de un mensaje o un botón. null = no se le contesta. */
async function armarCtx(chat, from) {
    if (!chat || !from || from.is_bot) return null;
    const base = { chatId: chat.id, fromId: from.id, usuario: from.username || null, nombre: [from.first_name, from.last_name].filter(Boolean).join(" ") || from.username || "" };
    if (chat.type === "group" || chat.type === "supergroup") {
        if (String(chat.id) !== String(cfg.chat)) {
            log(`grupo no configurado (${chat.id} «${chat.title || ""}»): el bot se va`);
            await tg("leaveChat", { chat_id: chat.id }).catch(() => { });
            return null;
        }
        return { ...base, privado: false, rol: "personal" };
    }
    if (chat.type !== "private") return null;
    const q = await quienEs(from.id);
    return { ...base, privado: true, rol: q ? q.rol : "sin-numero", host: q && q.host };
}

/** Historial del bot (el mismo de WhatsApp, en Ajustes): una fila por pedido, con «tg:» delante. */
async function registrar(ctx, mensaje, estado, detalle) {
    try {
        await prisma.wahaRequestLog.create({ data: { fromNumber: `tg:${ctx.usuario ? "@" + ctx.usuario : ctx.fromId}`, messageBody: String(mensaje || "").slice(0, 500), status: estado, responseDetails: detalle ? String(detalle).slice(0, 400) : null } });
    } catch { }
}

// ───────────────────────── conversaciones (agregar, invitar, lista negra) ─────────────────────────

const sesiones = new Map();
const claveSesion = (ctx) => `${ctx.chatId}:${ctx.fromId}`;
function sesion(ctx) {
    const s = sesiones.get(claveSesion(ctx));
    if (s && Date.now() - s.t > SESION_MS) { sesiones.delete(claveSesion(ctx)); return null; }
    return s || null;
}
const ponerSesion = (ctx, s) => sesiones.set(claveSesion(ctx), { ...s, t: Date.now() });
const borrarSesion = (ctx) => sesiones.delete(claveSesion(ctx));
/**
 * Pedir una respuesta con ForceReply: el teléfono abre el teclado ya respondiendo al bot. En el
 * grupo eso además es lo que hace que la respuesta le llegue al bot aunque no sea administrador
 * (con el modo privado de Telegram, un bot sólo recibe comandos y respuestas a sus mensajes). La
 * conversación es de quien la empezó (la sesión va por chat y persona): si otro responde, no la toca.
 */
function preguntar(ctx, html, placeholder, extra = {}) {
    return texto(ctx.chatId, html, { reply_markup: { force_reply: true, input_field_placeholder: placeholder || undefined }, ...extra });
}

// ───────────────────────── formatos ─────────────────────────

const fh = (x, op) => new Date(x).toLocaleString("es-UY", { timeZone: ZONA, hour12: false, ...op });
const hhmm = (x) => fh(x, { hour: "2-digit", minute: "2-digit" });
const diaHora = (x) => fh(x, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const SENTIDO = { ENTRY: "ENTRADA", EXIT: "SALIDA" };
const identidad = (ev) => (ev.accessType === "FACE" ? `👤 ${ev.user?.name || "¿?"}` : `🚘 ${ev.plateNumber || ev.plateDetected || "sin leer"}`);
const lineaAcceso = (ev) => `${ev.decision === "GRANT" ? "✅" : "🚫"} <b>${esc(identidad(ev))}</b> · ${SENTIDO[ev.direction] || "ACCESO"} · ${esc(ev.device?.name || "¿cámara?")} · ${diaHora(ev.timestamp)}`;
const pieAcceso = (ev) => `${ev.decision === "GRANT" ? "✅" : "🚫"} <b>${esc(identidad(ev))}</b> · ${SENTIDO[ev.direction] || "ACCESO"}\n📍 ${esc(ev.device?.name || "¿cámara?")} · ${diaHora(ev.timestamp)}`;
const TIPO_INTRUSION = { LINECROSS: "Cruce de línea", INTRUSION: "Intrusión en zona", REGION_ENTER: "Entrada a zona", REGION_EXIT: "Salida de zona" };
const CLASE = { human: "🚶 persona", vehicle: "🚗 vehículo" };
const matriculaDe = (t) => String(t || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

// ───────────────────────── comandos ─────────────────────────

const AYUDA_PERSONAL = [
    ["ultimo", "Último movimiento, con su foto"],
    ["accesos", "Últimos accesos (paginados, con álbum)"],
    ["entradas", "Últimas entradas"],
    ["salidas", "Últimas salidas"],
    ["matricula", "Historial de una matrícula: /matricula ABC1234"],
    ["eventos", "Intrusión: últimos cruces, con fotos"],
    ["camaras", "Ver una cámara ahora o un clip de 10 s"],
    ["estado", "Equipos en línea y sin señal"],
    ["listanegra", "Poner en lista negra: /listanegra ABC1234 motivo"],
    ["quitar", "Sacar de lista negra: /quitar ABC1234"],
    ["agregar", "Dar de alta una matrícula"],
    ["alertas", "Reglas que avisan por Telegram"],
    ["ayuda", "Este menú"],
];
const AYUDA_RESIDENTE = [["invitar", "Crear un pase de visita con QR"], ["pases", "Mis pases activos"], ["ayuda", "Ayuda"]];
const AYUDA_SIN_NUMERO = [["start", "Empezar"], ["ayuda", "Ayuda"]];

async function ayuda(ctx) {
    if (ctx.rol === "residente") {
        return texto(ctx.chatId, `🤖 <b>Asistente OmniAccess</b>\n\nHola ${esc(ctx.host?.name || ctx.nombre)}. Desde acá podés crear un <b>pase de visita</b>: tu invitado recibe un QR para mostrar en la garita.`,
            { reply_markup: teclado([[boton("🎟️ Invitar a alguien", "c:invitar")], [boton("📋 Mis pases", "c:pases")]]) });
    }
    const lineas = AYUDA_PERSONAL.map(([c, d]) => `/${c} — ${esc(d)}`).join("\n");
    return texto(ctx.chatId, `🤖 <b>Asistente OmniAccess</b>\n━━━━━━━━━━━━━━━━━━━━\n${lineas}\n\n💡 En privado también podés escribir una matrícula sola (ej. <code>ABC1234</code>) o las palabras de WhatsApp (<i>ultimo</i>, <i>entradas</i>, <i>estado</i>…). En el grupo, usá los comandos del menú <b>/</b>.`, {
        reply_markup: teclado([
            [boton("🕑 Último", "c:ultimo"), boton("📋 Accesos", "c:accesos")],
            [boton("🛡️ Intrusión", "c:eventos"), boton("📹 Cámaras", "c:camaras")],
            [boton("📡 Estado", "c:estado"), boton("🔔 Alertas", "c:alertas")],
        ]),
    });
}

/** «ultimo», «entradas», «salidas», «accesos». Las listas se paginan editando el mismo mensaje. */
async function accesos(ctx, tipo, pagina = 0, mensajeId = null) {
    const where = tipo === "entradas" ? { direction: "ENTRY" } : tipo === "salidas" ? { direction: "EXIT" } : {};
    if (tipo === "ultimo") {
        const ev = await prisma.accessEvent.findFirst({ where, orderBy: { timestamp: "desc" }, include: { user: true, device: true } });
        if (!ev) return texto(ctx.chatId, "🚫 No hay movimientos registrados todavía.");
        accion(ctx.chatId, "upload_photo");
        const plate = matriculaDe(ev.plateNumber || ev.plateDetected);
        const botones = teclado([
            plate ? [boton(`🚘 Historial de ${plate}`, `m:h:${plate}`), boton("⛔ Lista negra", `ln:p:${plate}`)] : [],
            ev.deviceId ? [boton("📷 La cámara ahora", `cam:${ev.deviceId}`), boton("🎬 Clip 10 s", `clip:${ev.deviceId}`)] : [],
        ]);
        const pie = `🚨 <b>Último movimiento</b>\n${pieAcceso(ev)}\n📊 ${ev.decision === "GRANT" ? "Permitido" : "Denegado"}${ev.user?.name && ev.accessType !== "FACE" ? `\n👤 ${esc(ev.user.name)}` : ""}`;
        const buf = await fotoDeAcceso(ev);
        return buf ? foto(ctx.chatId, buf, pie, { reply_markup: botones }) : texto(ctx.chatId, pie, { reply_markup: botones });
    }
    const evs = await prisma.accessEvent.findMany({ where, orderBy: { timestamp: "desc" }, skip: pagina * POR_PAGINA, take: POR_PAGINA + 1, include: { user: true, device: true } });
    const hay = evs.length > POR_PAGINA; const lista = evs.slice(0, POR_PAGINA);
    const titulo = tipo === "entradas" ? "Entradas" : tipo === "salidas" ? "Salidas" : "Accesos";
    const html = lista.length
        ? `📋 <b>${titulo}</b>${pagina ? ` · página ${pagina + 1}` : ""}\n\n${lista.map((e, i) => `${pagina * POR_PAGINA + i + 1}. ${lineaAcceso(e)}`).join("\n")}`
        : `📋 <b>${titulo}</b>\n\nNo hay más.`;
    const reply_markup = teclado([
        [pagina > 0 ? boton("◀️ Más nuevos", `acc:${tipo}:${pagina - 1}`) : null, hay ? boton("Más viejos ▶️", `acc:${tipo}:${pagina + 1}`) : null].filter(Boolean),
        lista.length ? [boton("🖼️ Las fotos de esta página", `accf:${tipo}:${pagina}`)] : [],
    ]);
    return mensajeId ? editar(ctx.chatId, mensajeId, html, { reply_markup }) : texto(ctx.chatId, html, { reply_markup });
}
async function albumAccesos(ctx, tipo, pagina) {
    const where = tipo === "entradas" ? { direction: "ENTRY" } : tipo === "salidas" ? { direction: "EXIT" } : {};
    accion(ctx.chatId, "upload_photo");
    const evs = await prisma.accessEvent.findMany({ where, orderBy: { timestamp: "desc" }, skip: pagina * POR_PAGINA, take: POR_PAGINA, include: { user: true, device: true } });
    const items = await Promise.all(evs.map(async (e) => ({ buf: await fotoDeAcceso(e), pie: pieAcceso(e) })));
    if (!(await album(ctx.chatId, items))) await texto(ctx.chatId, "⚠️ Esos movimientos no tienen fotos guardadas.");
}

/** Una matrícula: quién es, si está en lista negra, sus últimos pasos y la foto del más reciente. */
async function matricula(ctx, crudo) {
    const plate = matriculaDe(crudo);
    if (plate.length < 3) return preguntarMatricula(ctx, "m");
    accion(ctx.chatId, "upload_photo");
    const [evs, veh, negra] = await Promise.all([
        prisma.accessEvent.findMany({ where: { OR: [{ plateNumber: plate }, { plateDetected: plate }] }, take: 20, orderBy: { timestamp: "desc" }, include: { user: true, device: true } }),
        prisma.vehicle.findUnique({ where: { plate }, include: { user: true } }).catch(() => null),
        listaNegra ? listaNegra.estaEnListaNegra(prisma, plate).catch(() => null) : null,
    ]);
    const cab = [`🚘 <b>${plate}</b>`];
    if (veh) cab.push(`👤 ${esc(veh.user?.name || "sin dueño")}${[veh.brand, veh.model, veh.color].filter((x) => x && x !== "WhatsApp" && x !== "Bot").length ? ` · ${esc([veh.brand, veh.model, veh.color].filter(Boolean).join(" "))}` : ""}`);
    else cab.push("👤 No está en el padrón");
    if (negra?.negra) cab.push(`⛔ <b>En lista negra</b>${negra.motivo ? `: ${esc(negra.motivo)}` : ""}`);
    const lista = evs.length ? `\n\n${evs.slice(0, 12).map((e, i) => `${i + 1}. ${e.decision === "GRANT" ? "✅" : "🚫"} ${SENTIDO[e.direction] || "ACCESO"} · ${esc(e.device?.name || "¿cámara?")} · ${diaHora(e.timestamp)}`).join("\n")}${evs.length > 12 ? `\n… y ${evs.length - 12} más` : ""}` : "\n\nSin pasos registrados.";
    const ultimo = evs[0];
    const reply_markup = teclado([
        evs.length ? [boton("🖼️ Álbum de sus fotos", `m:f:${plate}`)] : [],
        [negra?.negra ? boton("✅ Sacar de lista negra", `ln:q:${plate}`) : boton("⛔ Lista negra", `ln:p:${plate}`)],
        ultimo?.deviceId ? [boton("📷 Cámara del último paso", `cam:${ultimo.deviceId}`)] : [],
    ]);
    const html = cab.join("\n") + lista;
    const conFoto = evs.find((e) => e.snapshotPath || e.imagePath);
    const buf = conFoto ? await fotoDeAcceso(conFoto) : null;
    return buf && html.length <= 1024 ? foto(ctx.chatId, buf, html, { reply_markup }) : texto(ctx.chatId, html, { reply_markup });
}
async function albumMatricula(ctx, plate) {
    accion(ctx.chatId, "upload_photo");
    const evs = await prisma.accessEvent.findMany({ where: { OR: [{ plateNumber: plate }, { plateDetected: plate }], NOT: [{ snapshotPath: null, imagePath: null }] }, take: ALBUM_MAX, orderBy: { timestamp: "desc" }, include: { user: true, device: true } });
    const items = await Promise.all(evs.map(async (e) => ({ buf: await fotoDeAcceso(e), pie: pieAcceso(e) })));
    if (!(await album(ctx.chatId, items))) await texto(ctx.chatId, `⚠️ ${plate} no tiene fotos guardadas.`);
}
function preguntarMatricula(ctx, para) {
    ponerSesion(ctx, { paso: "matricula", para });
    return preguntar(ctx, "🚘 ¿Qué matrícula?", "ABC1234");
}

/** Intrusión: la foto del más reciente con la lista de los últimos 10, y el álbum a un toque. */
async function eventos(ctx) {
    const dets = await prisma.detection.findMany({ where: { type: { in: Object.keys(TIPO_INTRUSION) } }, take: 10, orderBy: { timestamp: "desc" } });
    if (!dets.length) return texto(ctx.chatId, "🛡️ <b>Intrusión:</b> sin eventos registrados todavía.");
    accion(ctx.chatId, "upload_photo");
    const nombres = await nombresDe(dets.map((d) => d.deviceId));
    const linea = (d, i) => `${i + 1}. ${d.acknowledged ? "✅" : "🔴"} ${TIPO_INTRUSION[d.type] || d.type} · ${esc(nombres[d.deviceId] || "¿cámara?")}${CLASE[d.label] ? ` · ${CLASE[d.label]}` : ""} · ${diaHora(d.timestamp)}`;
    const html = `🛡️ <b>Últimos ${dets.length} eventos de intrusión</b>\n\n${dets.map(linea).join("\n")}`;
    const u = dets[0];
    const reply_markup = teclado([[boton("🖼️ Álbum de los 10", "ev:f")], u.deviceId ? [boton("📷 Esa cámara ahora", `cam:${u.deviceId}`), boton("🎬 Clip 10 s", `clip:${u.deviceId}`)] : []]);
    const buf = await fotoDeDeteccion(u);
    return buf && html.length <= 1024 ? foto(ctx.chatId, buf, html, { reply_markup }) : texto(ctx.chatId, html, { reply_markup });
}
async function albumEventos(ctx) {
    accion(ctx.chatId, "upload_photo");
    const dets = await prisma.detection.findMany({ where: { type: { in: Object.keys(TIPO_INTRUSION) }, snapshotPath: { not: null } }, take: ALBUM_MAX, orderBy: { timestamp: "desc" } });
    const nombres = await nombresDe(dets.map((d) => d.deviceId));
    const items = await Promise.all(dets.map(async (d) => ({ buf: await fotoDeDeteccion(d), pie: `${TIPO_INTRUSION[d.type] || d.type} · ${esc(nombres[d.deviceId] || "¿cámara?")}${CLASE[d.label] ? ` · ${CLASE[d.label]}` : ""}\n${diaHora(d.timestamp)}` })));
    if (!(await album(ctx.chatId, items))) await texto(ctx.chatId, "⚠️ Esos eventos no tienen fotos guardadas.");
}
async function nombresDe(ids) {
    const u = [...new Set(ids.filter(Boolean))];
    if (!u.length) return {};
    const devs = await prisma.device.findMany({ where: { id: { in: u } }, select: { id: true, name: true } });
    return Object.fromEntries(devs.map((d) => [d.id, d.name]));
}

/** Las cámaras como botones: tocar una manda lo que ve ahora. */
async function camaras(ctx) {
    const devs = (await prisma.device.findMany({ where: { deviceType: { in: TIPOS_CAMARA } }, select: { id: true, name: true } })).sort((a, b) => String(a.name).localeCompare(String(b.name), "es"));
    if (!devs.length) return texto(ctx.chatId, "📹 No hay cámaras cargadas.");
    const filas = [];
    for (let i = 0; i < Math.min(devs.length, CAMARAS_MAX); i += 2) filas.push(devs.slice(i, i + 2).map((d) => boton(`📷 ${corta(d.name, 28)}`, `cam:${d.id}`)));
    return texto(ctx.chatId, `📹 <b>Cámaras</b>\nTocá una para ver lo que ve ahora.${devs.length > CAMARAS_MAX ? `\n(Las primeras ${CAMARAS_MAX} de ${devs.length}.)` : ""}`, { reply_markup: teclado(filas) });
}
async function camaraAhora(ctx, deviceId) {
    const d = await prisma.device.findUnique({ where: { id: deviceId }, select: { id: true, name: true } });
    if (!d) return texto(ctx.chatId, "⚠️ Esa cámara ya no existe.");
    accion(ctx.chatId, "upload_photo");
    try {
        const buf = await fotoDeCamara(d.id);
        return foto(ctx.chatId, buf, `📷 <b>${esc(d.name)}</b> · ahora, ${fh(Date.now(), { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`,
            { reply_markup: teclado([[boton("🔄 Otra vez", `cam:${d.id}`), boton(`🎬 Clip ${CLIP_SEG} s`, `clip:${d.id}`)]]) });
    } catch (e) { return texto(ctx.chatId, `⚠️ <b>${esc(d.name)}</b> no entregó imagen (${esc(e.message)}).`); }
}
async function clip(ctx, deviceId) {
    const d = await prisma.device.findUnique({ where: { id: deviceId }, select: { id: true, name: true } });
    if (!d) return texto(ctx.chatId, "⚠️ Esa cámara ya no existe.");
    if (grabando.has(d.id)) return texto(ctx.chatId, `⏳ Ya estoy grabando <b>${esc(d.name)}</b>, un momento.`);
    grabando.add(d.id);
    const aviso = await texto(ctx.chatId, `🎬 Grabando ${CLIP_SEG} s de <b>${esc(d.name)}</b>…`).catch(() => null);
    accion(ctx.chatId, "record_video");
    try {
        const buf = await clipEnVivo(d.id, d.name);
        if (!buf) { if (aviso) await editar(ctx.chatId, aviso.message_id, `⚠️ <b>${esc(d.name)}</b> no entregó video ahora.`); return; }
        accion(ctx.chatId, "upload_video");
        await conHtml("sendVideo", { chat_id: ctx.chatId, caption: `🎬 <b>${esc(d.name)}</b> · ${fh(Date.now(), { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`, supports_streaming: true,
            reply_markup: teclado([[boton("📷 Foto ahora", `cam:${d.id}`), boton("🎬 Otro clip", `clip:${d.id}`)]]) },
            [{ campo: "video", buf, nombre: "clip.mp4", tipo: "video/mp4" }], "caption");
        if (aviso) tg("deleteMessage", { chat_id: ctx.chatId, message_id: aviso.message_id }).catch(() => { });
    } finally { grabando.delete(d.id); }
}

/** «estado»: en línea / sin señal, con un botón que actualiza el mismo mensaje. */
async function estado(ctx, mensajeId = null) {
    const devs = (await prisma.device.findMany()).sort((a, b) => String(a.name).localeCompare(String(b.name), "es"));
    const ahora = Date.now();
    const filas = devs.map((d) => {
        const vistos = [d.lastOnlinePush, d.lastOnlinePull].filter(Boolean).map((x) => new Date(x).getTime());
        const ultimo = vistos.length ? Math.max(...vistos) : null;
        return { d, ultimo, enLinea: ultimo != null && ahora - ultimo < RECIENTE_MS };
    });
    const caidos = filas.filter((f) => !f.enLinea), vivos = filas.filter((f) => f.enLinea);
    const html = devs.length
        ? `📡 <b>Estado de equipos</b>\n🟢 ${vivos.length} en línea · 🔴 ${caidos.length} sin señal\n` +
          (caidos.length ? `\n<b>Sin señal</b>\n${caidos.map((f) => `🔴 ${esc(f.d.name)} · ${esc(TIPO_EQUIPO[f.d.deviceType] || f.d.deviceType)} · ${f.ultimo ? diaHora(f.ultimo) : "nunca"}`).join("\n")}\n` : "") +
          `\n<b>En línea</b>\n${vivos.map((f) => `🟢 ${esc(f.d.name)}`).join("\n") || "—"}\n\n<i>Actualizado ${fh(ahora, { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</i>`
        : "📡 No hay equipos registrados.";
    const reply_markup = teclado([[boton("🔄 Actualizar", "est:u"), boton("📹 Cámaras", "c:camaras")]]);
    return mensajeId ? editar(ctx.chatId, mensajeId, html, { reply_markup }) : texto(ctx.chatId, html, { reply_markup });
}

/** Lista negra: por /api/vigilancia/bot, las mismas acciones que la pantalla (como WhatsApp). */
async function vigilancia(cuerpo) {
    const token = (await ajuste("TRACKING_TOKEN")) || process.env.TRACKING_TOKEN || "";
    const r = await axios.post(`${LOCAL}/api/vigilancia/bot`, cuerpo, { headers: { "x-tracking-token": token }, timeout: 40_000, validateStatus: () => true });
    if (r.status === 404) throw new Error("este servidor todavía no tiene la lista negra por bot");
    if (r.status !== 200) throw new Error((r.data && r.data.error) || `HTTP ${r.status}`);
    return r.data || {};
}
const firmaQuien = (ctx) => `Telegram ${ctx.usuario ? "@" + ctx.usuario : ctx.nombre || ctx.fromId}`;
async function ponerListaNegra(ctx, plate, motivo, force = false) {
    accion(ctx.chatId, "typing");
    try {
        const d = await vigilancia({ accion: "alta", plate, motivo: motivo || undefined, createdBy: firmaQuien(ctx), force });
        const camaras = d.resumen ? `\n📷 Lectoras: ${esc(d.resumen)}` : "";
        if (d.conflicto) {
            const cat = d.conflicto.category === "WHITELISTED" ? "VIP / autorizado" : "en búsqueda";
            ponerSesion(ctx, { paso: "ln-forzar", plate, motivo });
            return texto(ctx.chatId, `⚠️ <b>${plate}</b> ya está como <b>${cat}</b>${d.conflicto.motivo ? ` (${esc(d.conflicto.motivo)})` : ""}. ¿La paso igual a lista negra?`,
                { reply_markup: teclado([[boton("⛔ Sí, pasarla", `ln:f:${plate}`), boton("Cancelar", "x")]]) });
        }
        if (!d.ok) throw new Error(d.error || "no se pudo guardar");
        await registrar(ctx, `lista negra ${plate}`, "OK", motivo);
        return texto(ctx.chatId, `⛔ <b>${plate}</b> quedó en la <b>lista negra</b>${motivo ? `: ${esc(motivo)}` : ""}.\nToda lectura se registra DENEGADA aunque tenga credencial; el monitor la muestra en rojo y avisa.${camaras}`,
            { reply_markup: teclado([[boton("↩️ Deshacer", `ln:q:${plate}`), boton(`🚘 Ver ${plate}`, `m:h:${plate}`)]]) });
    } catch (e) { return texto(ctx.chatId, `❌ No pude actualizar la lista negra: ${esc(e.message)}`); }
}
async function quitarListaNegra(ctx, plate) {
    accion(ctx.chatId, "typing");
    try {
        const d = await vigilancia({ accion: "baja", plate, createdBy: firmaQuien(ctx) });
        if (!d.estaba) return texto(ctx.chatId, d.porRol ? `ℹ️ <b>${plate}</b> está en lista negra por el <b>rol</b> de su dueño: se saca desde la ficha de esa persona.` : `ℹ️ <b>${plate}</b> no estaba en la lista negra.`);
        await registrar(ctx, `quitar lista negra ${plate}`, "OK");
        return texto(ctx.chatId, `✅ <b>${plate}</b> salió de la lista negra.${d.resumen ? `\n📷 Lectoras: ${esc(d.resumen)}` : ""}`);
    } catch (e) { return texto(ctx.chatId, `❌ No pude actualizar la lista negra: ${esc(e.message)}`); }
}

/** Reglas que avisan por Telegram, con un botón para prender o apagar cada una. */
async function alertas(ctx, mensajeId = null) {
    const reglas = (await prisma.notificationRule.findMany({ orderBy: { name: "asc" } })).filter((r) => /telegram/i.test(String(r.channels || "")));
    const grupoOk = String(ctx.chatId) === String(cfg.chat);
    const html = `🔔 <b>Alertas por Telegram</b>\n${grupoOk ? "Llegan a este grupo." : "Llegan al grupo de la guardia."}\n\n` +
        (reglas.length ? reglas.map((r) => `${r.enabled ? "🟢" : "⚪"} ${esc(r.name)} · ${esc(r.modulo)}`).join("\n") : "Ninguna regla manda por Telegram. Se agregan en Ajustes → Notificaciones (canal Telegram).") +
        (reglas.length ? "\n\n<i>Tocá una para prenderla o apagarla.</i>" : "");
    const reply_markup = teclado(reglas.slice(0, 20).map((r) => [boton(`${r.enabled ? "🟢" : "⚪"} ${corta(r.name, 40)}`, `al:${r.id}`)]));
    return mensajeId ? editar(ctx.chatId, mensajeId, html, { reply_markup }) : texto(ctx.chatId, html, { reply_markup });
}

// ── Agregar matrícula (como WhatsApp: padrón + lista blanca de las lectoras Hikvision) ──

async function hikvision(method, url, data, device) {
    const username = device.username || "admin", password = device.password || "";
    const baseURL = `http://${String(device.ip || "").replace(/^https?:\/\//, "")}`;
    const pedir = (auth) => axios.request({ method, baseURL, url, data, timeout: 10_000, headers: { "Content-Type": "application/json", Accept: "application/json", ...(auth ? { Authorization: auth } : {}) } });
    try { return (await pedir()).data; } catch (error) {
        const h = error.response && error.response.headers && error.response.headers["www-authenticate"];
        if (!(error.response && error.response.status === 401 && h)) throw error;
        const val = (k) => { const m = h.match(new RegExp(`${k}="?([^",]+)"?`)); return m ? m[1].trim() : null; };
        const realm = val("realm"), nonce = val("nonce"), qop = val("qop"), opaque = val("opaque");
        const nc = "00000001", cnonce = crypto.randomBytes(8).toString("hex");
        const md5 = (s) => crypto.createHash("md5").update(s).digest("hex");
        const ha1 = md5(`${username}:${realm}:${password}`);
        const firma = (uri) => {
            const r2 = qop === "auth" ? md5(`${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${md5(`${method}:${uri}`)}`) : md5(`${ha1}:${nonce}:${md5(`${method}:${uri}`)}`);
            return `Digest username="${username}", realm="${realm}", nonce="${nonce}", uri="${uri}", algorithm="MD5", response="${r2}"${opaque ? `, opaque="${opaque}"` : ""}${qop ? `, qop=${qop}, nc=${nc}, cnonce="${cnonce}"` : ""}`;
        };
        // Algunos firmwares calculan el digest sin la consulta (?format=json): como en waha-handler, se prueba de las dos formas.
        try { return (await pedir(firma(url))).data; }
        catch (e2) { if (e2.response && e2.response.status === 401 && url.includes("?")) return (await pedir(firma(url.split("?")[0]))).data; throw e2; }
    }
}
async function aLectora(device, plate) {
    const negra = listaNegra ? (await listaNegra.estaEnListaNegra(prisma, plate).catch(() => ({ negra: false }))).negra : false;
    const hoy = new Date(), fin = new Date(); fin.setFullYear(fin.getFullYear() + 10);
    return hikvision("PUT", "/ISAPI/Traffic/channels/1/licensePlateAuditData/record?format=json", {
        LicensePlateInfoList: [{ LicensePlate: plate, listType: negra ? "blackList" : "whiteList", createTime: hoy.toISOString().split(".")[0], effectiveStartDate: hoy.toISOString().split("T")[0], effectiveTime: fin.toISOString().split("T")[0], id: "" }],
    }, device);
}
function tecladoLectoras(s) {
    return teclado([
        ...s.lectoras.map((d, i) => [boton(`${s.elegidas.includes(i) ? "✅" : "⬜"} ${corta(d.name, 36)}`, `ag:c:${i}`)]),
        [boton("Todas", "ag:t"), boton("Confirmar ✔️", "ag:ok"), boton("Cancelar", "x")],
    ]);
}
async function agregarPaso(ctx, s, entrada) {
    if (s.paso === "ag-matricula") {
        const plate = matriculaDe(entrada);
        if (plate.length < 3) return preguntar(ctx, "⚠️ La matrícula tiene que tener al menos 3 caracteres. ¿Cuál es?", "ABC1234");
        if (await prisma.vehicle.findUnique({ where: { plate } })) { borrarSesion(ctx); return texto(ctx.chatId, `⚠️ <b>${plate}</b> ya está en el padrón.`, { reply_markup: teclado([[boton(`🚘 Ver ${plate}`, `m:h:${plate}`)]]) }); }
        ponerSesion(ctx, { paso: "ag-nombre", plate });
        return preguntar(ctx, `👤 ¿<b>Nombre del propietario</b> de <b>${plate}</b>?`, "Nombre y apellido");
    }
    if (s.paso === "ag-nombre") {
        const nombre = String(entrada).trim();
        if (nombre.length < 2) return preguntar(ctx, "⚠️ Escribí un nombre.", "Nombre y apellido");
        const lectoras = await prisma.device.findMany({ where: { deviceType: "LPR_CAMERA" }, select: { id: true, name: true } });
        if (!lectoras.length) { borrarSesion(ctx); return texto(ctx.chatId, "❌ No hay lectoras LPR cargadas."); }
        const nueva = { paso: "ag-lectoras", plate: s.plate, nombre, lectoras, elegidas: lectoras.map((_, i) => i) };
        ponerSesion(ctx, nueva);
        return texto(ctx.chatId, `📹 <b>${s.plate}</b> · ${esc(nombre)}\n¿En qué lectoras la cargo?`, { reply_markup: tecladoLectoras(nueva) });
    }
}
async function agregarConfirmar(ctx, s, mensajeId) {
    borrarSesion(ctx);
    const elegidas = s.elegidas.map((i) => s.lectoras[i]).filter(Boolean);
    if (!elegidas.length) return editar(ctx.chatId, mensajeId, "⚠️ No elegiste ninguna lectora. Empezá de nuevo con /agregar.");
    await editar(ctx.chatId, mensajeId, `⏳ Registrando <b>${s.plate}</b> para <b>${esc(s.nombre)}</b> en ${elegidas.length} lectora(s)…`);
    try {
        const user = await prisma.user.create({ data: { name: s.nombre, role: "RESIDENT" } });
        await prisma.vehicle.create({ data: { plate: s.plate, userId: user.id, notes: `Alta por Telegram (${firmaQuien(ctx)})` } });
        await prisma.credential.create({ data: { type: "PLATE", value: s.plate, userId: user.id } });
        const devs = await prisma.device.findMany({ where: { id: { in: elegidas.map((d) => d.id) } } });
        let bien = 0; const mal = [];
        for (const d of devs) {
            try { if (d.brand !== "HIKVISION") throw new Error("marca sin carga automática"); await aLectora(d, s.plate); bien++; }
            catch (e) { mal.push(`${d.name}: ${e.message}`); }
        }
        await registrar(ctx, `agregar ${s.plate}`, "OK", `${bien} lectoras`);
        return editar(ctx.chatId, mensajeId, `✅ <b>Alta hecha</b>\n🚘 ${s.plate} · 👤 ${esc(s.nombre)}\n📹 Cargada en ${bien} de ${devs.length} lectora(s)${mal.length ? `\n❌ ${esc(mal.join(" · "))}` : ""}`,
            { reply_markup: teclado([[boton(`🚘 Ver ${s.plate}`, `m:h:${s.plate}`)]]) });
    } catch (e) { return editar(ctx.chatId, mensajeId, `❌ No pude dar el alta: ${esc(e.message)}`); }
}

// ── Invitar (residentes) ──

/** La misma lectura de «cuánto vale el pase» que WhatsApp (parseWhen de waha-handler). */
function cuando(text) {
    const t = (text || "").toLowerCase().trim(); const now = new Date(); const base = new Date(now);
    const wd = { domingo: 0, lunes: 1, martes: 2, miercoles: 3, "miércoles": 3, jueves: 4, viernes: 5, sabado: 6, "sábado": 6 };
    const WORDN = { media: 0.5, medio: 0.5, un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10 };
    const num = (w) => { if (WORDN[w] != null) return WORDN[w]; const n = parseFloat(String(w).replace(",", ".")); return isNaN(n) ? null : n; };
    const eod = (x) => { const y = new Date(x); y.setHours(23, 59, 0, 0); return y; };
    if (/pasado\s*ma(ñ|n)ana/.test(t)) base.setDate(base.getDate() + 2);
    else if (/\bma(ñ|n)ana\b/.test(t)) base.setDate(base.getDate() + 1);
    else { for (const k in wd) { if (t.includes(k)) { let d = (wd[k] - base.getDay() + 7) % 7; if (d === 0) d = 7; base.setDate(base.getDate() + d); break; } } }
    const m = t.match(/(\d{1,2})(?:[:.](\d{2}))?\s*(?:a|hasta|al|-)\s*(\d{1,2})(?:[:.](\d{2}))?/);
    if (m) { let a = new Date(base); a.setHours(+m[1], +(m[2] || 0), 0, 0); const b = new Date(base); b.setHours(+m[3], +(m[4] || 0), 0, 0); if (b <= a) b.setDate(b.getDate() + 1); if (a < new Date(now.getTime() - 60000)) a = new Date(now); return { from: a, to: b }; }
    const mh = t.match(/hasta (?:las? )?(\d{1,2})(?:[:.](\d{2}))?/);
    if (mh) { const b = new Date(base); b.setHours(+mh[1], +(mh[2] || 0), 0, 0); if (b <= now) b.setDate(b.getDate() + 1); return { from: new Date(now), to: b }; }
    if (/todo el d[ií]a/.test(t)) { const mismo = base.toDateString() === now.toDateString(); const a = mismo ? new Date(now) : (() => { const y = new Date(base); y.setHours(0, 0, 0, 0); return y; })(); return { from: a, to: eod(base) }; }
    if (/medio d[ií]a/.test(t)) return { from: new Date(now), to: new Date(now.getTime() + 6 * 3600e3) };
    const md = t.match(/(?:por\s*)?(\d+(?:[.,]\d+)?|media|medio|una?|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\s*(semanas?|sem|d[ií]as?|horas?|hs?|minutos?|mins?|h|d|m)\b/);
    if (md) { const n = num(md[1]); const u = md[2]; if (n != null) { const a = new Date(now); const b = new Date(a); b.setTime(b.getTime() + n * (/^sem/.test(u) ? 7 * 86400e3 : /^d/.test(u) ? 86400e3 : /^h/.test(u) ? 3600e3 : 60e3)); return { from: a, to: b }; } }
    const mismo = base.toDateString() === now.toDateString();
    return { from: mismo ? new Date(now) : (() => { const y = new Date(base); y.setHours(8, 0, 0, 0); return y; })(), to: eod(base) };
}
const VIGENCIAS = [["2h", "⏱️ 2 horas", "2 horas"], ["hoy", "🌙 Hoy", "hoy"], ["dia", "☀️ Todo el día", "todo el día"], ["man", "📅 Mañana", "mañana todo el día"], ["3d", "🗓️ 3 días", "3 días"], ["1s", "🗓️ 1 semana", "1 semana"]];
const tokenInv = () => { const abc = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; let x = ""; for (let i = 0; i < 6; i++) x += abc[crypto.randomInt(abc.length)]; return x; };

async function invitarPaso(ctx, s, entrada, mensajeId) {
    if (s.paso === "inv-nombre") {
        const nombre = String(entrada).trim();
        if (nombre.length < 2) return preguntar(ctx, "⚠️ Escribí el nombre del invitado.", "Nombre del invitado");
        ponerSesion(ctx, { ...s, paso: "inv-patente", invitado: nombre });
        return preguntar(ctx, `🚗 ¿<b>Matrícula</b> del auto de ${esc(nombre)}? Si viene a pie, tocá el botón.`, "ABC1234", { reply_markup: teclado([[boton("🚶 Viene a pie", "inv:pie")]]) });
    }
    if (s.paso === "inv-patente") {
        const plate = /sin\s*auto|^no$|a pie|ninguna/i.test(String(entrada)) ? "" : matriculaDe(entrada);
        ponerSesion(ctx, { ...s, paso: "inv-cuando", plate });
        const filas = []; for (let i = 0; i < VIGENCIAS.length; i += 2) filas.push(VIGENCIAS.slice(i, i + 2).map(([k, t]) => boton(t, `inv:v:${k}`)));
        return texto(ctx.chatId, `📅 ¿<b>Cuánto vale el pase</b>?\nTocá una opción o escribilo con tus palabras: <i>hasta las 18</i>, <i>mañana 10 a 14</i>, <i>viernes</i>…`, { reply_markup: { ...teclado(filas), } });
    }
    if (s.paso === "inv-cuando") return invitarCrear(ctx, s, cuando(entrada), mensajeId);
}
async function invitarCrear(ctx, s, win, mensajeId) {
    borrarSesion(ctx);
    accion(ctx.chatId, "upload_photo");
    const h = s.host || {};
    try {
        const inv = await prisma.invitation.create({ data: {
            hostUserId: h.userId || null, hostUnitId: h.unitId || null, hostName: h.name || "", hostLabel: h.label || "",
            kind: "SINGLE", title: s.invitado || "", validFrom: win.from, validTo: win.to, reentry: "MULTI",
            createdVia: "TELEGRAM", createdBy: `TG ${ctx.fromId}`, notify: true, token: tokenInv(),
        } });
        const qrToken = crypto.randomBytes(18).toString("base64url");
        await prisma.guest.create({ data: { invitationId: inv.id, name: s.invitado || "", qrToken, status: "APPROVED", plates: s.plate ? { create: [{ plate: s.plate }] } : undefined } });
        const enlace = `${cfg.base}/invitado/${qrToken}`;
        const fmt = (x) => fh(x, { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
        const pie = `✅ <b>Pase creado</b>\n👤 ${esc(s.invitado)}${s.plate ? ` (${s.plate})` : " (a pie)"}\n🕒 ${fmt(win.from)} → ${fmt(win.to)}\n🏠 Invita: ${esc(h.name || "")}${h.label ? ` · ${esc(h.label)}` : ""}\n\nMandale este QR o el enlace a tu invitado para que lo muestre en la garita.`;
        const reply_markup = teclado([
            [{ text: "📤 Mandar el pase", url: `https://t.me/share/url?url=${encodeURIComponent(enlace)}&text=${encodeURIComponent(`Tu pase para entrar al barrio, ${s.invitado}`)}` }],
            [{ text: "🔗 Abrir el pase", url: enlace }, boton("🗑️ Anular", `pase:x:${inv.id}`)],
        ]);
        let png = null;
        try { const r = await axios.get(`${LOCAL}/api/invitado/${encodeURIComponent(qrToken)}/qr.png`, { responseType: "arraybuffer", timeout: 15_000 }); if (r.status === 200 && r.data && r.data.byteLength > 500) png = Buffer.from(r.data); } catch (e) { log("qr.png de la app falló, va sin logo:", e.message); }
        if (!png && QRLIB) png = await QRLIB.toBuffer(enlace, { width: 512, margin: 1, errorCorrectionLevel: "M" });
        await registrar(ctx, `invitar ${s.invitado}`, "OK", `pase ${inv.id}`);
        if (png) return conHtml("sendPhoto", { chat_id: ctx.chatId, caption: pie, reply_markup }, [{ campo: "photo", buf: png, nombre: "pase.png", tipo: "image/png" }], "caption");
        return texto(ctx.chatId, pie, { reply_markup });
    } catch (e) {
        log("invitar:", e.message);
        return texto(ctx.chatId, `❌ No pude crear el pase: ${esc(e.message)}`);
    }
}
async function pases(ctx, mensajeId = null) {
    const h = ctx.host || {};
    const or = [{ createdBy: `TG ${ctx.fromId}` }]; if (h.userId) or.push({ hostUserId: h.userId });
    const invs = await prisma.invitation.findMany({ where: { status: "ACTIVE", validTo: { gt: new Date() }, OR: or }, orderBy: { validFrom: "asc" }, take: 10, include: { guests: { include: { plates: true } } } });
    const fmt = (x) => fh(x, { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
    const html = invs.length
        ? `📋 <b>Tus pases activos</b>\n\n${invs.map((i, n) => `${n + 1}. 👤 ${esc(i.title || i.guests[0]?.name || "invitado")}${i.guests[0]?.plates?.[0] ? ` (${i.guests[0].plates[0].plate})` : ""}\n   🕒 ${fmt(i.validFrom)} → ${fmt(i.validTo)}`).join("\n")}`
        : "📋 No tenés pases activos.";
    const reply_markup = teclado([...invs.map((i, n) => [boton(`🗑️ Anular el ${n + 1} · ${corta(i.title || "invitado", 24)}`, `pase:x:${i.id}`)]), [boton("🎟️ Nuevo pase", "c:invitar")]]);
    return mensajeId ? editar(ctx.chatId, mensajeId, html, { reply_markup }) : texto(ctx.chatId, html, { reply_markup });
}
async function anularPase(ctx, id, mensajeId) {
    const inv = await prisma.invitation.findUnique({ where: { id } });
    const h = ctx.host || {};
    const mio = inv && (inv.createdBy === `TG ${ctx.fromId}` || (h.userId && inv.hostUserId === h.userId));
    if (!mio) return texto(ctx.chatId, "⚠️ Ese pase no es tuyo o ya no existe.");
    await prisma.invitation.update({ where: { id }, data: { status: "REVOKED" } });
    await registrar(ctx, "anular pase", "OK", id);
    await texto(ctx.chatId, `🗑️ Pase de <b>${esc(inv.title || "invitado")}</b> anulado: ya no abre la barrera.`);
    if (mensajeId) pases(ctx, mensajeId).catch(() => { });
}

// ───────────────────────── vincular el número (privado) ─────────────────────────

function pedirNumero(ctx) {
    return texto(ctx.chatId, "🔐 Para usar el asistente necesito saber quién sos.\nTocá <b>Compartir mi número</b>: lo comparo con el celular cargado en tu ficha del barrio.", {
        reply_markup: { keyboard: [[{ text: "📱 Compartir mi número", request_contact: true }]], resize_keyboard: true, one_time_keyboard: true, is_persistent: false },
    });
}
async function alContacto(ctx, m) {
    const c = m.contact;
    const sacar = { reply_markup: { remove_keyboard: true } };
    if (!c || c.user_id !== ctx.fromId) return texto(ctx.chatId, "⚠️ Compartí <b>tu</b> número con el botón, no el de otro contacto.", sacar);
    const cola = cola8(c.phone_number);
    const personal = await esPersonal(cola);
    const host = personal ? null : await residente(cola);
    if (!personal && !host) {
        await registrar(ctx, "vincular", "IGNORADO", "número sin usuario");
        return texto(ctx.chatId, "🚫 Ese número no está cargado en el barrio. Pedile a la administración que lo agregue a tu ficha.", sacar);
    }
    await guardarVinculo(ctx.fromId, { cola, nombre: ctx.nombre, desde: new Date().toISOString() });
    await registrar(ctx, "vincular", "OK", personal ? "personal" : "residente");
    const rol = personal ? "personal" : "residente";
    await menuDe(ctx.fromId, rol).catch((e) => log("menú del chat:", e.message));
    await texto(ctx.chatId, `✅ Listo, ${esc(personal ? ctx.nombre : host.name)}. ${personal ? "Tenés acceso de <b>personal</b>." : "Ya podés crear <b>pases de visita</b>."}`, sacar);
    return ayuda({ ...ctx, rol, host });
}
/** El menú de comandos de Telegram de cada persona, según su rol (scope de ese chat). */
async function menuDe(chatId, rol) {
    const lista = rol === "personal" ? AYUDA_PERSONAL : rol === "residente" ? AYUDA_RESIDENTE : AYUDA_SIN_NUMERO;
    await tg("setMyCommands", { scope: { type: "chat", chat_id: chatId }, commands: lista.map(([command, description]) => ({ command, description })) });
}

// ───────────────────────── el ruteo ─────────────────────────

/** Las palabras de WhatsApp (en privado, o en el grupo si el bot lee todo) → comando. */
function palabras(txt) {
    const t = txt.toLowerCase().trim();
    let m;
    if ((m = t.match(/^(?:quitar|sacar)\s+(?:de\s+)?lista\s+negra\s+([a-z0-9]{3,10})/i)) || (m = t.match(/^desbloquear\s+([a-z0-9]{3,10})/i))) return { cmd: "quitar", args: m[1] };
    if ((m = t.match(/^(?:lista\s+negra|bloquear)\s+([a-z0-9]{3,10})\b\s*(.*)$/i))) return { cmd: "listanegra", args: `${m[1]} ${m[2] || ""}`.trim() };
    if (/^(?:agregar|añadir|nuevo|nueva)\s+(?:matr[ií]cula|veh[ií]culo)/.test(t)) return { cmd: "agregar", args: "" };
    if (/^(?:configurar alerta|activar notifica|alertas?)\b/.test(t)) return { cmd: "alertas", args: "" };
    if (/^(?:invitar|invito|invitaci[oó]n|visita|pase)\b/.test(t)) return { cmd: "invitar", args: "" };
    if (/^(?:mis pases|pases)\b/.test(t)) return { cmd: "pases", args: "" };
    if (/^(?:eventos?|intrusi[oó]n(?:es)?|cruces?|zonas?)\b/.test(t)) return { cmd: "eventos", args: "" };
    if (/^c[aá]maras?\b/.test(t)) return { cmd: "camaras", args: "" };
    if (/^(?:estado|equipos)\b/.test(t)) return { cmd: "estado", args: "" };
    if (/^(?:entradas)\b/.test(t)) return { cmd: "entradas", args: "" };
    if (/^(?:salidas)\b/.test(t)) return { cmd: "salidas", args: "" };
    if (/^(?:accesos)\b/.test(t)) return { cmd: "accesos", args: "" };
    if (/^(?:[uú]ltimo|[uú]ltima|foto)\b/.test(t)) return { cmd: "ultimo", args: "" };
    if (/^(?:ayuda|men[uú]|hola|inicio)\b/.test(t)) return { cmd: "ayuda", args: "" };
    if ((m = txt.trim().match(/^([A-Za-z0-9]{3,10})\.?$/)) && /\d/.test(m[1])) return { cmd: "matricula", args: m[1] };
    return null;
}
function comando(txt) {
    const m = txt.match(/^\/([a-z_]+)(?:@(\w+))?\s*([\s\S]*)$/i);
    if (!m) return null;
    if (m[2] && bot && m[2].toLowerCase() !== String(bot.username || "").toLowerCase()) return { ajeno: true };
    const alias = { m: "matricula", mat: "matricula", lista_negra: "listanegra", bloquear: "listanegra", desbloquear: "quitar", intrusion: "eventos", menu: "ayuda", help: "ayuda", cam: "camaras" };
    const cmd = m[1].toLowerCase();
    return { cmd: alias[cmd] || cmd, args: (m[3] || "").trim() };
}

const SOLO_RESIDENTE = new Set(["invitar", "pases"]);
const DE_TODOS = new Set(["start", "ayuda", "cancelar"]);

async function ejecutar(ctx, cmd, args, m) {
    if (!DE_TODOS.has(cmd)) {
        if (ctx.rol === "residente" && !SOLO_RESIDENTE.has(cmd)) return texto(ctx.chatId, "🎟️ Desde acá podés crear pases de visita: /invitar · tus pases: /pases");
        if (ctx.rol === "personal" && SOLO_RESIDENTE.has(cmd)) return texto(ctx.chatId, "ℹ️ Los pases de visita los crea cada residente desde su teléfono (o la guardia desde Invitados).");
    }
    const id = { ultimo: "eventos", entradas: "eventos", salidas: "eventos", accesos: "eventos", matricula: "matricula", eventos: "intrusion", estado: "estado", listanegra: "lista_negra", quitar: "lista_negra", agregar: "agregar_matricula", alertas: "notificaciones", invitar: "invitar" }[cmd];
    if (id && !cmdActivo(id)) return texto(ctx.chatId, "⏸️ Ese comando está apagado en Ajustes → WhatsApp → Comandos del bot.");
    if (m) reaccion(ctx.chatId, m.message_id);
    await registrar(ctx, m?.text || `/${cmd} ${args}`, "OK");
    switch (cmd) {
        case "start": case "ayuda":
            // El menú de comandos de esta persona se rehace: si cambió de rol, el «/» muestra lo suyo.
            if (ctx.privado && (ctx.rol === "personal" || ctx.rol === "residente")) menuDe(ctx.fromId, ctx.rol).catch(() => { });
            return ayuda(ctx);
        case "cancelar": borrarSesion(ctx); return texto(ctx.chatId, "👌 Cancelado.", { reply_markup: { remove_keyboard: true } });
        case "ultimo": case "entradas": case "salidas": case "accesos": return accesos(ctx, cmd);
        case "matricula": return args ? matricula(ctx, args) : preguntarMatricula(ctx, "m");
        case "eventos": return eventos(ctx);
        case "camaras": return camaras(ctx);
        case "estado": return estado(ctx);
        case "alertas": return alertas(ctx);
        case "listanegra": {
            const [p, ...resto] = args.split(/\s+/);
            const plate = matriculaDe(p);
            if (plate.length < 3) return preguntarMatricula(ctx, "ln");
            if (!resto.join(" ").trim()) { ponerSesion(ctx, { paso: "ln-motivo", plate }); return preguntar(ctx, `⛔ ¿<b>Motivo</b> para poner <b>${plate}</b> en lista negra? (o /saltar)`, "Motivo"); }
            return ponerListaNegra(ctx, plate, resto.join(" ").trim());
        }
        case "quitar": { const plate = matriculaDe(args); return plate.length < 3 ? preguntarMatricula(ctx, "q") : quitarListaNegra(ctx, plate); }
        case "agregar": ponerSesion(ctx, { paso: "ag-matricula" }); return preguntar(ctx, "🚗 <b>Agregar matrícula</b>\n¿Cuál es la matrícula?", "ABC1234");
        case "invitar": ponerSesion(ctx, { paso: "inv-nombre", host: ctx.host }); return preguntar(ctx, `👋 Hola ${esc(ctx.host?.name || ctx.nombre)}. Vamos a crear un <b>pase de visita</b>.\n\n¿<b>Nombre</b> del invitado?`, "Nombre del invitado");
        case "pases": return pases(ctx);
        default: return ctx.privado ? ayuda(ctx) : null;
    }
}

async function seguirSesion(ctx, s, entrada, m) {
    if (s.paso === "matricula") {
        borrarSesion(ctx);
        const plate = matriculaDe(entrada);
        if (s.para === "ln") { ponerSesion(ctx, { paso: "ln-motivo", plate }); return preguntar(ctx, `⛔ ¿<b>Motivo</b> para <b>${plate}</b>? (o /saltar)`, "Motivo"); }
        if (s.para === "q") return quitarListaNegra(ctx, plate);
        return matricula(ctx, plate);
    }
    if (s.paso === "ln-motivo") { borrarSesion(ctx); return ponerListaNegra(ctx, s.plate, /^\/saltar/i.test(entrada) ? "" : entrada.trim()); }
    if (s.paso.startsWith("ag-")) return agregarPaso(ctx, s, entrada);
    if (s.paso.startsWith("inv-")) return invitarPaso(ctx, s, entrada, m?.message_id);
}

async function alMensaje(m) {
    if (m.migrate_to_chat_id && cfg.chat && String(m.chat.id) === String(cfg.chat)) {
        // El grupo pasó a supergrupo: Telegram le cambia el id. Sin esto, las alertas dejan de llegar.
        await prisma.setting.upsert({ where: { key: "TELEGRAM_CHAT_ID" }, update: { value: String(m.migrate_to_chat_id) }, create: { key: "TELEGRAM_CHAT_ID", value: String(m.migrate_to_chat_id) } });
        log(`el grupo pasó a supergrupo: TELEGRAM_CHAT_ID ${cfg.chat} → ${m.migrate_to_chat_id}`);
        cfg.chat = String(m.migrate_to_chat_id);
        return;
    }
    if (Date.now() / 1000 - (m.date || 0) > VIEJO_SEG) return;
    const ctx = await armarCtx(m.chat, m.from);
    if (!ctx || !cfg.activo) return;
    if (m.contact && ctx.privado) return alContacto(ctx, m);
    const txt = String(m.text || "").trim();
    if (!txt) return;
    if (ctx.privado && (ctx.rol === "sin-numero" || ctx.rol === "nadie")) {
        if (ctx.rol === "nadie") { await registrar(ctx, txt, "IGNORADO", "número que ya no es de nadie"); await guardarVinculo(ctx.fromId, null); }
        return pedirNumero(ctx);
    }
    const c = txt.startsWith("/") ? comando(txt) : null;
    if (c && c.ajeno) return;
    const s = sesion(ctx);
    if (s && (!c || c.cmd === "saltar")) return seguirSesion(ctx, s, txt, m);
    if (c) return ejecutar(ctx, c.cmd, c.args, m);
    const p = palabras(txt);
    if (p) return ejecutar(ctx, p.cmd, p.args, m);
    if (ctx.privado) return ayuda(ctx);
}

async function alBoton(q) {
    const responder = (t, alerta = false) => tg("answerCallbackQuery", { callback_query_id: q.id, text: t || undefined, show_alert: alerta }).catch(() => { });
    const msg = q.message;
    const ctx = msg ? await armarCtx(msg.chat, q.from) : null;
    if (!ctx || !cfg.activo) return responder();
    const d = String(q.data || "");
    const [tipo, a, b] = d.split(":");
    const paraResidente = tipo === "inv" || tipo === "pase" || d === "c:invitar" || d === "c:pases" || d === "x";
    if (ctx.rol !== "personal" && !(ctx.rol === "residente" && paraResidente)) return responder("No tenés permiso para esto.", true);
    responder();
    switch (tipo) {
        case "x": borrarSesion(ctx); return editar(ctx.chatId, msg.message_id, "👌 Cancelado.").catch(() => { });
        case "c": return ejecutar(ctx, a, "");
        case "acc": return accesos(ctx, a, Math.max(0, Number(b) || 0), msg.message_id);
        case "accf": return albumAccesos(ctx, a, Math.max(0, Number(b) || 0));
        case "m": return a === "f" ? albumMatricula(ctx, matriculaDe(b)) : matricula(ctx, b);
        case "ev": return albumEventos(ctx);
        case "cam": return camaraAhora(ctx, a);
        case "clip": return clip(ctx, a);
        case "est": return estado(ctx, msg.message_id);
        case "ln": {
            const plate = matriculaDe(b);
            if (a === "q") return quitarListaNegra(ctx, plate);
            if (a === "f") { const s = sesion(ctx); borrarSesion(ctx); return ponerListaNegra(ctx, plate, s && s.plate === plate ? s.motivo : "", true); }
            ponerSesion(ctx, { paso: "ln-motivo", plate });
            return preguntar(ctx, `⛔ ¿<b>Motivo</b> para poner <b>${plate}</b> en lista negra? (o /saltar)`, "Motivo");
        }
        case "al": {
            const r = await prisma.notificationRule.findUnique({ where: { id: a } });
            if (!r) return alertas(ctx, msg.message_id);
            await prisma.notificationRule.update({ where: { id: a }, data: { enabled: !r.enabled } });
            await registrar(ctx, `alerta ${r.name}`, "OK", r.enabled ? "apagada" : "prendida");
            return alertas(ctx, msg.message_id);
        }
        case "ag": {
            const s = sesion(ctx);
            if (!s || s.paso !== "ag-lectoras") return editar(ctx.chatId, msg.message_id, "⌛ Esa alta ya venció. Empezá de nuevo con /agregar.");
            if (a === "c") { const i = Number(b); s.elegidas = s.elegidas.includes(i) ? s.elegidas.filter((x) => x !== i) : [...s.elegidas, i]; ponerSesion(ctx, s); return tg("editMessageReplyMarkup", { chat_id: ctx.chatId, message_id: msg.message_id, reply_markup: tecladoLectoras(s) }).catch(() => { }); }
            if (a === "t") { s.elegidas = s.elegidas.length === s.lectoras.length ? [] : s.lectoras.map((_, i) => i); ponerSesion(ctx, s); return tg("editMessageReplyMarkup", { chat_id: ctx.chatId, message_id: msg.message_id, reply_markup: tecladoLectoras(s) }).catch(() => { }); }
            if (a === "ok") return agregarConfirmar(ctx, s, msg.message_id);
            return;
        }
        case "inv": {
            const s = sesion(ctx);
            if (!s || !s.paso.startsWith("inv-")) return texto(ctx.chatId, "⌛ Ese pase ya venció. Empezá de nuevo con /invitar.");
            if (a === "pie" && s.paso === "inv-patente") return invitarPaso(ctx, s, "a pie");
            if (a === "v" && s.paso === "inv-cuando") { const v = VIGENCIAS.find(([k]) => k === b); return invitarCrear(ctx, s, cuando(v ? v[2] : "hoy"), msg.message_id); }
            return;
        }
        case "pase": return a === "x" ? anularPase(ctx, b, null) : null;
        default: return;
    }
}

async function alMiembro(u) {
    const chat = u.chat, nuevo = u.new_chat_member && u.new_chat_member.status;
    if (!chat || (chat.type !== "group" && chat.type !== "supergroup")) return;
    if (nuevo !== "member" && nuevo !== "administrator") return;
    if (String(chat.id) !== String(cfg.chat)) { log(`me agregaron a un grupo que no es el configurado (${chat.id}): me voy`); return tg("leaveChat", { chat_id: chat.id }).catch(() => { }); }
    return texto(chat.id, `👋 Hola. Soy el asistente de OmniAccess.${nuevo === "administrator" ? "" : "\nPara que también lea matrículas sueltas (sin /), haceme <b>administrador</b> del grupo."}\nEscribí /ayuda para ver lo que hago.`);
}

// ───────────────────────── arranque y escucha ─────────────────────────

async function preparar() {
    bot = await tg("getMe");
    // Si alguna vez se configuró un webhook, getUpdates da 409: se quita (las actualizaciones pendientes se conservan).
    await tg("deleteWebhook", { drop_pending_updates: false }).catch(() => { });
    const cmds = (l) => l.map(([command, description]) => ({ command, description }));
    await tg("setMyCommands", { scope: { type: "all_group_chats" }, commands: cmds(AYUDA_PERSONAL) });
    await tg("setMyCommands", { scope: { type: "all_private_chats" }, commands: cmds(AYUDA_SIN_NUMERO) });
    await tg("setMyShortDescription", { short_description: "Asistente de control de acceso OmniAccess: accesos, matrículas, cámaras y pases de visita." }).catch(() => { });
    await tg("setMyDescription", { description: "Asistente de OmniAccess.\n\n• Personal: accesos, matrículas, intrusión, cámaras en vivo, lista negra y alertas.\n• Residentes: pases de visita con QR.\n\nTocá Iniciar y compartí tu número para que sepa quién sos." }).catch(() => { });
    log(`listo como @${bot.username} · grupo ${cfg.chat || "(sin grupo)"} · lee todo el grupo: ${bot.can_read_all_group_messages ? "sí" : "no (sólo comandos, menciones y respuestas)"}`);
}

async function escuchar() {
    let offset = 0, preparado = false, tokenListo = "";
    for (;;) {
        if (!cfg || !cfg.token) { await dormir(30_000); continue; }
        if (!preparado || tokenListo !== cfg.token) {
            try { await preparar(); preparado = true; tokenListo = cfg.token; }
            catch (e) { log("no pude preparar el bot:", e.message); await dormir(30_000); continue; }
        }
        try {
            const ups = await tg("getUpdates", { offset, timeout: 50, allowed_updates: ["message", "callback_query", "my_chat_member"] });
            for (const u of ups) {
                offset = u.update_id + 1;
                // Cada pedido por su cuenta: un clip de 10 s no tiene que demorar al resto.
                const p = u.callback_query ? alBoton(u.callback_query) : u.message ? alMensaje(u.message) : u.my_chat_member ? alMiembro(u.my_chat_member) : null;
                if (p) p.catch(async (e) => {
                    log("error atendiendo:", e.stack || e.message);
                    const chat = (u.message && u.message.chat.id) || (u.callback_query && u.callback_query.message && u.callback_query.message.chat.id);
                    if (chat) texto(chat, `❌ Algo falló: ${esc(e.message)}`).catch(() => { });
                });
            }
        } catch (e) {
            if (e.codigo === 409) { log("otro proceso escucha este bot (409): espero 30 s"); await dormir(30_000); }
            else if (e.codigo === 401) { log("token inválido (401): reviso la configuración en 60 s"); preparado = false; await dormir(60_000); }
            else { log("getUpdates:", e.message); await dormir(5_000); }
        }
    }
}

if (require.main === module) (async () => {
    cfg = await leerCfg();
    if (!cfg.token) log("sin TELEGRAM_BOT_TOKEN: espero a que se configure (Ajustes → Notificaciones → Telegram)");
    setInterval(async () => { try { const n = await leerCfg(); cfg = n; } catch { } }, RELEER_CFG_MS);
    await escuchar();
})().catch((e) => { log("se cayó:", e.stack || e.message); process.exit(1); });

/** Para probarlo sin Telegram (un arnés que reemplaza fetch a api.telegram.org): no lo usa el proceso. */
module.exports = { _prueba: { palabras, comando, cuando, matriculaDe, cola8, alMensaje, alBoton, aH264, achicar, placaIntro, ponerCfg: (c) => { cfg = c; bot = { username: "prueba_bot" }; } } };
