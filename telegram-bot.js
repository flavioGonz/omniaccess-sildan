/**
 * Bot de Telegram de OmniAccess (Los Olivos) — proceso PM2 "telegram-bot".
 *
 * Consultas con foto y video desde el grupo de alertas (o en privado, si el usuario es miembro
 * de ese grupo). Lee Telegram por long polling: no necesita exponer nada a internet.
 *
 *   /ultimo /entradas /salidas      eventos LPR con la captura
 *   /matricula ABC1234 (o la matrícula sola)  historial + foto + botones
 *   /camaras                        botonera de cámaras → foto en vivo / video de 10 s
 *   /foto N  /video N               por número de la lista de /camaras
 *   /clip                           video grabado (NVR) del último evento
 *   /hoy  /estado                   resumen del día y estado de equipos
 *   /vigilar ABC1234 motivo  /quitar ABC1234  /lista   lista de vigilancia
 *
 * Además escucha en 127.0.0.1:10010 (solo local): server.js le pasa las alertas de lista de
 * vigilancia y merodeo para mandarlas con foto y botón de clip.
 *
 * Token y grupo: Settings TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID (fallback .env). Se releen
 * cada minuto, así que un cambio en el panel se toma sin reiniciar.
 */
require("dotenv").config({ path: require("path").join(__dirname, ".env") });
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const { PrismaClient } = require("@prisma/client");
const { marcaConfig, marcarFoto, argsVideo } = require("./lib-marca");

const prisma = new PrismaClient();
const WEB = "http://127.0.0.1:10001";
const GO2RTC = "http://127.0.0.1:1984";
const PUERTO_ALERTAS = 10010;
const TZ = "America/Montevideo";

// ─── configuración ───────────────────────────────────────────────────────────
let CFG = { token: "", grupo: "", extras: [], trackingToken: "", leido: 0 };
async function setting(key) { try { const s = await prisma.setting.findUnique({ where: { key } }); return (s && s.value) || ""; } catch { return ""; } }
async function config() {
    if (Date.now() - CFG.leido < 60_000 && CFG.token) return CFG;
    const token = (await setting("TELEGRAM_BOT_TOKEN")) || process.env.TELEGRAM_BOT_TOKEN || "";
    const grupo = (await setting("TELEGRAM_CHAT_ID")) || process.env.TELEGRAM_CHAT_ID || "";
    const extras = ((await setting("TELEGRAM_BOT_CHATS")) || "").split(/[,\s]+/).filter(Boolean);
    const trackingToken = (await setting("TRACKING_TOKEN")) || process.env.TRACKING_TOKEN || "";
    if (token !== CFG.token) yo = null;
    CFG = { token, grupo, extras, trackingToken, leido: Date.now() };
    return CFG;
}

// ─── Telegram ────────────────────────────────────────────────────────────────
async function tg(metodo, params = {}, timeoutMs = 30_000) {
    const { token } = await config();
    if (!token) throw new Error("sin token");
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeoutMs);
    try {
        const r = await fetch(`https://api.telegram.org/bot${token}/${metodo}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(params), signal: ctl.signal });
        const j = await r.json();
        if (!j.ok) throw new Error(`${metodo}: ${j.description}`);
        return j.result;
    } finally { clearTimeout(t); }
}
async function tgArchivo(metodo, campos, campoArchivo, buf, nombre, mime) {
    const { token } = await config();
    const fd = new FormData();
    for (const [k, v] of Object.entries(campos)) if (v !== undefined && v !== null) fd.append(k, typeof v === "string" ? v : JSON.stringify(v));
    fd.append(campoArchivo, new Blob([buf], { type: mime }), nombre);
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 120_000);
    try {
        const r = await fetch(`https://api.telegram.org/bot${token}/${metodo}`, { method: "POST", body: fd, signal: ctl.signal });
        const j = await r.json();
        if (!j.ok) throw new Error(`${metodo}: ${j.description}`);
        return j.result;
    } finally { clearTimeout(t); }
}
const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const texto = (chat, t, extra = {}) => tg("sendMessage", { chat_id: chat, text: t, parse_mode: "HTML", disable_web_page_preview: true, ...extra });
const accion = (chat, a) => tg("sendChatAction", { chat_id: chat, action: a }).catch(() => { });
async function foto(chat, buf, caption, botones) {
    try { const sharp = require("sharp"); buf = await sharp(buf).rotate().resize({ width: 1600, withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer(); } catch { }
    buf = await marcarFoto(buf, prisma);
    return tgArchivo("sendPhoto", { chat_id: String(chat), caption: caption.slice(0, 1024), parse_mode: "HTML", reply_markup: botones ? { inline_keyboard: botones } : undefined }, "photo", buf, "captura.jpg", "image/jpeg");
}
async function video(chat, buf, caption, botones) {
    return tgArchivo("sendVideo", { chat_id: String(chat), caption: caption.slice(0, 1024), parse_mode: "HTML", supports_streaming: "true", reply_markup: botones ? { inline_keyboard: botones } : undefined }, "video", buf, "video.mp4", "video/mp4");
}

// ─── datos ───────────────────────────────────────────────────────────────────
async function local(ruta, ms = 20_000) {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), ms);
    try { const r = await fetch(ruta.startsWith("http") ? ruta : WEB + ruta, { signal: ctl.signal }); if (!r.ok) return null; return Buffer.from(await r.arrayBuffer()); }
    catch { return null; } finally { clearTimeout(t); }
}
const fecha = (d, conSeg = true) => new Date(d).toLocaleString("es-UY", { timeZone: TZ, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", ...(conSeg ? { second: "2-digit" } : {}) });
const hora = (d) => new Date(d).toLocaleTimeString("es-UY", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
const sentido = (d) => (d === "EXIT" ? "SALIDA" : d === "ENTRY" ? "ENTRADA" : "ACCESO");
const normPlaca = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const ROLES = { RESIDENT: "Residente", VISITOR: "Visita", PROVIDER: "Proveedor", STAFF: "Personal", ADMIN: "Administración", OPERATOR: "Operador", SECURITY: "Seguridad", BLACKLISTED: "Lista negra" };
function detalle(details, campo) { const m = String(details || "").match(new RegExp(campo + ":\\s*([^,]+)")); const v = m ? m[1].trim() : ""; return /unknown|desconocid/i.test(v) ? "" : v; }

async function vigilancia(placa) {
    if (!placa) return null;
    try { return await prisma.plateWatch.findFirst({ where: { plate: placa, active: true } }); } catch { return null; }
}
const CAT = (c) => { const s = String(c || "").toUpperCase(); return /WHITE|VIP/.test(s) ? "VIP / AUTORIZADO" : /SEARCH|BUSCA/.test(s) ? "EN BÚSQUEDA" : "LISTA NEGRA"; };

async function leyendaEvento(e, titulo) {
    const placa = e.plateNumber || e.plateDetected;
    const leida = placa && placa !== "NO_LEIDA";
    const marca = detalle(e.details, "Marca"), color = detalle(e.details, "Color"), tipo = detalle(e.details, "Tipo");
    const w = leida ? await vigilancia(placa) : null;
    const l = [];
    if (titulo) l.push(`<b>${esc(titulo)}</b>`);
    l.push(`<b>${sentido(e.direction)}</b> · ${esc(e.device?.name || "Cámara")}`);
    l.push(`Matrícula: ${leida ? `<code>${esc(placa)}</code>` : "<i>no leída</i>"}`);
    if (e.user) l.push(`Titular: ${esc(e.user.name)}${e.user.role ? ` (${ROLES[e.user.role] || e.user.role})` : ""}`);
    const veh = [marca, color, tipo && !/suvmpv/i.test(tipo) ? tipo : ""].filter(Boolean).join(" · ");
    if (veh) l.push(`Vehículo: ${esc(veh)}`);
    l.push(`Resultado: ${e.decision === "GRANT" ? "autorizado" : "denegado"}`);
    if (w) l.push(`<b>${CAT(w.category)}</b>${w.label ? ` · ${esc(w.label)}` : ""}${w.motivo ? `\n${esc(w.motivo)}` : ""}`);
    l.push(fecha(e.timestamp));
    return l.join("\n");
}
function botonesEvento(e) {
    const placa = normPlaca(e.plateNumber || e.plateDetected);
    const fila1 = [{ text: "Clip grabado", callback_data: `clip:${e.id}` }];
    if (e.deviceId) fila1.push({ text: "En vivo", callback_data: `vivo:${e.deviceId}` });
    const filas = [fila1];
    if (placa && placa !== "NOLEIDA") filas.push([{ text: "Historial", callback_data: `hist:${placa}` }, { text: "Vigilar", callback_data: `vig:${placa}` }]);
    return filas;
}
async function mandarEvento(chat, e, titulo) {
    const cap = await leyendaEvento(e, titulo);
    const ruta = e.snapshotPath || e.imagePath;
    const buf = ruta ? await local(ruta.startsWith("/") ? ruta : `/api/files/lpr-prod/${ruta.split("/").pop()}`) : null;
    if (buf) return foto(chat, buf, cap, botonesEvento(e));
    return texto(chat, cap, { reply_markup: { inline_keyboard: botonesEvento(e) } });
}

// cámaras con video (todas tienen stream lpr_<id> en go2rtc)
let CAMS = { lista: [], leido: 0 };
async function camaras() {
    if (Date.now() - CAMS.leido < 120_000 && CAMS.lista.length) return CAMS.lista;
    const ds = await prisma.device.findMany({ where: { deviceType: { in: ["LPR_CAMERA", "CAMERA"] } }, select: { id: true, name: true, deviceType: true }, orderBy: { name: "asc" } });
    const lista = [...ds.filter((d) => d.deviceType === "LPR_CAMERA"), ...ds.filter((d) => d.deviceType !== "LPR_CAMERA")];
    CAMS = { lista, leido: Date.now() };
    return lista;
}
async function cuadro(deviceId) {
    for (const s of [`lpr_${deviceId}_hd`, `lpr_${deviceId}`]) {
        const b = await local(`${GO2RTC}/api/frame.jpeg?src=${s}`, 15_000);
        if (b && b.length > 2000) return b;
    }
    return null;
}
async function grabarVivo(deviceId, seg = 10) {
    const marca = await marcaConfig(prisma);
    return new Promise((resolve) => {
        const dest = path.join(os.tmpdir(), `tg_${deviceId}_${Date.now()}.mp4`);
        // El logo entra como segunda entrada: tiene que ir pegado al -i del video, antes de -t.
        const args = ["-hide_banner", "-loglevel", "error", "-y", "-i", `${GO2RTC}/api/stream.mp4?src=lpr_${deviceId}`, ...argsVideo(marca, "scale='min(1280,iw)':-2"),
            "-t", String(seg), "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "27", "-pix_fmt", "yuv420p", "-movflags", "+faststart", dest];
        const p = spawn("ffmpeg", args, { stdio: "ignore" });
        const k = setTimeout(() => { try { p.kill("SIGKILL"); } catch { } }, (seg + 40) * 1000);
        p.on("close", () => { clearTimeout(k); try { const b = fs.readFileSync(dest); fs.unlinkSync(dest); resolve(b.length > 10_000 ? b : null); } catch { resolve(null); } });
        p.on("error", () => { clearTimeout(k); resolve(null); });
    });
}
async function clipGrabado(e) {
    const { trackingToken } = await config();
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 210_000);
    try {
        const r = await fetch(`${WEB}/api/clip/instante`, {
            method: "POST", signal: ctl.signal, headers: { "Content-Type": "application/json", "x-tracking-token": trackingToken },
            body: JSON.stringify({ deviceId: e.deviceId, instante: new Date(e.timestamp).getTime(), para: "envio", matricula: e.plateNumber || null, intro: false }),
        });
        const j = await r.json().catch(() => ({}));
        if (!j.ok) return { motivo: j.motivo || `respuesta ${r.status}` };
        const buf = await local(j.url, 60_000);
        return buf ? { buf } : { motivo: "no se pudo bajar el clip" };
    } catch (err) { return { motivo: err.name === "AbortError" ? "el NVR tardó demasiado" : err.message }; }
    finally { clearTimeout(t); }
}

// ─── acceso ──────────────────────────────────────────────────────────────────
let yo = null;
const miembros = new Map(); // userId -> { ok, hasta }
async function permitido(msg) {
    const { grupo, extras } = await config();
    const chat = String(msg.chat.id);
    if (chat === String(grupo) || extras.includes(chat)) return true;
    if (msg.chat.type !== "private") return false;
    const uid = msg.from && msg.from.id; if (!uid) return false;
    const c = miembros.get(uid); if (c && c.hasta > Date.now()) return c.ok;
    let ok = false;
    try { const m = await tg("getChatMember", { chat_id: grupo, user_id: uid }); ok = ["creator", "administrator", "member", "restricted"].includes(m.status); } catch { }
    miembros.set(uid, { ok, hasta: Date.now() + 10 * 60_000 });
    return ok;
}

// ─── comandos ────────────────────────────────────────────────────────────────
const AYUDA = [
    "<b>OmniAccess · Los Olivos</b>",
    "",
    "<b>Accesos</b>",
    "/ultimo · último paso con foto",
    "/entradas · /salidas · últimos 10",
    "/matricula ABC1234 · historial (o escribí la matrícula sola)",
    "/clip · video grabado del último paso",
    "/hoy · resumen del día",
    "",
    "<b>Cámaras</b>",
    "/camaras · elegir cámara: foto o video en vivo",
    "/foto 3 · /video 3 · por número de la lista",
    "",
    "<b>Vigilancia</b>",
    "/vigilar ABC1234 motivo · avisar cuando pase",
    "/quitar ABC1234 · /lista",
    "",
    "/estado · equipos en línea y alertas",
].join("\n");

async function cmdUltimo(chat, dir) {
    const where = dir ? { direction: dir } : {};
    const evs = await prisma.accessEvent.findMany({ where: { ...where, accessType: "PLATE" }, take: dir ? 10 : 1, orderBy: { timestamp: "desc" }, include: { user: true, device: true } });
    if (!evs.length) return texto(chat, "No hay eventos registrados.");
    if (dir) {
        const l = [`<b>Últimas ${evs.length} ${dir === "ENTRY" ? "entradas" : "salidas"}</b>`, ""];
        evs.forEach((e, i) => { const p = e.plateNumber || e.plateDetected; l.push(`${i + 1}. ${hora(e.timestamp)} · ${p && p !== "NO_LEIDA" ? `<code>${esc(p)}</code>` : "no leída"} · ${esc(e.device?.name || "")}${e.decision === "GRANT" ? "" : " · denegado"}`); });
        await texto(chat, l.join("\n"));
    }
    await accion(chat, "upload_photo");
    return mandarEvento(chat, evs[0], dir ? "Más reciente" : "Último paso");
}
async function cmdMatricula(chat, arg) {
    const p = normPlaca(arg);
    if (p.length < 3) return texto(chat, "Escribí la matrícula, por ejemplo: <code>/matricula ABC1234</code>");
    const evs = await prisma.accessEvent.findMany({ where: { OR: [{ plateNumber: p }, { plateDetected: p }] }, take: 15, orderBy: { timestamp: "desc" }, include: { user: true, device: true } });
    const veh = await prisma.vehicle.findFirst({ where: { plate: p }, include: { user: true } }).catch(() => null);
    const w = await vigilancia(p);
    if (!evs.length) {
        const l = [`<b><code>${esc(p)}</code></b>`, "Sin pasos registrados."];
        if (veh) l.push(`Registrada a nombre de ${esc(veh.user?.name || "")}`);
        if (w) l.push(`<b>${CAT(w.category)}</b>${w.motivo ? ` · ${esc(w.motivo)}` : ""}`);
        return texto(chat, l.join("\n"), { reply_markup: { inline_keyboard: [[{ text: w ? "Quitar de vigilancia" : "Vigilar", callback_data: `${w ? "unvig" : "vig"}:${p}` }]] } });
    }
    const l = [`<b>Historial de <code>${esc(p)}</code></b>`];
    if (veh) l.push(`Registrada: ${esc(veh.user?.name || "")}${veh.user?.role ? ` (${ROLES[veh.user.role] || veh.user.role})` : ""}`);
    else l.push("No está registrada en el barrio");
    if (w) l.push(`<b>${CAT(w.category)}</b>${w.motivo ? ` · ${esc(w.motivo)}` : ""}`);
    l.push("");
    evs.forEach((e, i) => l.push(`${i + 1}. ${fecha(e.timestamp, false)} · ${sentido(e.direction)} · ${esc(e.device?.name || "")}`));
    await texto(chat, l.join("\n"));
    await accion(chat, "upload_photo");
    return mandarEvento(chat, evs[0], "Último paso");
}
async function cmdCamaras(chat, pagina = 0, editar) {
    const lista = await camaras();
    const POR = 10, total = Math.ceil(lista.length / POR) || 1;
    pagina = Math.max(0, Math.min(total - 1, pagina));
    const trozo = lista.slice(pagina * POR, pagina * POR + POR);
    const filas = trozo.map((d, i) => [{ text: `${pagina * POR + i + 1}. ${d.name}`.slice(0, 60), callback_data: `vivo:${d.id}` }]);
    const nav = [];
    if (pagina > 0) nav.push({ text: "Anterior", callback_data: `cams:${pagina - 1}` });
    if (pagina < total - 1) nav.push({ text: "Siguiente", callback_data: `cams:${pagina + 1}` });
    if (nav.length) filas.push(nav);
    const t = `<b>Cámaras</b> · página ${pagina + 1} de ${total}\nTocá una para ver la foto en vivo.`;
    if (editar) return tg("editMessageText", { chat_id: chat, message_id: editar, text: t, parse_mode: "HTML", reply_markup: { inline_keyboard: filas } }).catch(() => { });
    return texto(chat, t, { reply_markup: { inline_keyboard: filas } });
}
async function camPorArg(arg) {
    const lista = await camaras();
    const n = parseInt(arg, 10);
    if (Number.isFinite(n) && n >= 1 && n <= lista.length) return lista[n - 1];
    const q = String(arg || "").toLowerCase().trim();
    return q ? lista.find((d) => d.name.toLowerCase().includes(q)) : null;
}
async function cmdVivo(chat, deviceId) {
    const d = (await camaras()).find((x) => x.id === deviceId) || await prisma.device.findUnique({ where: { id: deviceId }, select: { id: true, name: true } });
    if (!d) return texto(chat, "No encontré esa cámara.");
    await accion(chat, "upload_photo");
    const b = await cuadro(d.id);
    const botones = [[{ text: "Actualizar", callback_data: `vivo:${d.id}` }, { text: "Video 10 s", callback_data: `vid:${d.id}` }]];
    if (!b) return texto(chat, `No pude obtener imagen de <b>${esc(d.name)}</b> (sin video en este momento).`, { reply_markup: { inline_keyboard: botones } });
    return foto(chat, b, `<b>${esc(d.name)}</b>\nEn vivo · ${fecha(new Date())}`, botones);
}
async function cmdVideoVivo(chat, deviceId) {
    const d = (await camaras()).find((x) => x.id === deviceId);
    if (!d) return texto(chat, "No encontré esa cámara.");
    const aviso = await texto(chat, `Grabando 10 s de <b>${esc(d.name)}</b>…`);
    await accion(chat, "record_video");
    const b = await grabarVivo(d.id, 10);
    tg("deleteMessage", { chat_id: chat, message_id: aviso.message_id }).catch(() => { });
    if (!b) return texto(chat, `No pude grabar video de <b>${esc(d.name)}</b> en este momento.`);
    await accion(chat, "upload_video");
    return video(chat, b, `<b>${esc(d.name)}</b>\nEn vivo · ${fecha(new Date())}`, [[{ text: "Foto ahora", callback_data: `vivo:${d.id}` }, { text: "Otro video", callback_data: `vid:${d.id}` }]]);
}
async function cmdClip(chat, eventoId) {
    const e = eventoId
        ? await prisma.accessEvent.findUnique({ where: { id: eventoId }, include: { device: true } })
        : await prisma.accessEvent.findFirst({ where: { accessType: "PLATE" }, orderBy: { timestamp: "desc" }, include: { device: true } });
    if (!e || !e.deviceId) return texto(chat, "No encontré el evento.");
    const placa = e.plateNumber && e.plateNumber !== "NO_LEIDA" ? e.plateNumber : "sin matrícula";
    const aviso = await texto(chat, `Buscando la grabación de <code>${esc(placa)}</code> en ${esc(e.device?.name || "la cámara")} (${fecha(e.timestamp)})…`);
    await accion(chat, "upload_video");
    const r = await clipGrabado(e);
    tg("deleteMessage", { chat_id: chat, message_id: aviso.message_id }).catch(() => { });
    if (!r.buf) return texto(chat, `No pude armar el clip: ${esc(r.motivo)}.`, { reply_markup: { inline_keyboard: [[{ text: "Reintentar", callback_data: `clip:${e.id}` }]] } });
    if (r.buf.length > 49 * 1024 * 1024) return texto(chat, "El clip supera el límite de Telegram (50 MB).");
    return video(chat, r.buf, `<b>${sentido(e.direction)}</b> · ${esc(e.device?.name || "")}\n<code>${esc(placa)}</code> · ${fecha(e.timestamp)}`);
}
function inicioHoy() {
    const ahora = new Date();
    const local = new Date(ahora.toLocaleString("en-US", { timeZone: TZ }));
    const desfase = ahora.getTime() - local.getTime();
    local.setHours(0, 0, 0, 0);
    return new Date(local.getTime() + desfase);
}
async function cmdHoy(chat) {
    const desde = inicioHoy();
    const evs = await prisma.accessEvent.findMany({ where: { timestamp: { gte: desde }, accessType: "PLATE" }, select: { direction: true, decision: true, plateNumber: true, deviceId: true, timestamp: true, userId: true } });
    const ent = evs.filter((e) => e.direction === "ENTRY").length, sal = evs.filter((e) => e.direction === "EXIT").length;
    const noLeidas = evs.filter((e) => !e.plateNumber || e.plateNumber === "NO_LEIDA").length;
    const den = evs.filter((e) => e.decision !== "GRANT").length;
    const placas = new Set(evs.map((e) => e.plateNumber).filter((p) => p && p !== "NO_LEIDA"));
    const ajenas = new Set(evs.filter((e) => !e.userId && e.plateNumber && e.plateNumber !== "NO_LEIDA").map((e) => e.plateNumber));
    const porHora = new Array(24).fill(0);
    evs.forEach((e) => { porHora[Number(new Date(e.timestamp).toLocaleString("en-US", { timeZone: TZ, hour: "2-digit", hour12: false })) % 24]++; });
    const pico = porHora.indexOf(Math.max(...porHora));
    const porCam = {}; evs.forEach((e) => { porCam[e.deviceId] = (porCam[e.deviceId] || 0) + 1; });
    const top = Object.entries(porCam).sort((a, b) => b[1] - a[1])[0];
    const camTop = top ? (await prisma.device.findUnique({ where: { id: top[0] }, select: { name: true } }).catch(() => null))?.name : null;
    const l = [`<b>Resumen de hoy</b> · ${new Date().toLocaleDateString("es-UY", { timeZone: TZ, weekday: "long", day: "numeric", month: "long" })}`, "",
        `Entradas: <b>${ent}</b>`, `Salidas: <b>${sal}</b>`, `Vehículos distintos: <b>${placas.size}</b>`, `No registrados: <b>${ajenas.size}</b>`,
        `Sin leer matrícula: <b>${noLeidas}</b>`, `Denegados: <b>${den}</b>`];
    if (evs.length) l.push("", `Hora pico: ${String(pico).padStart(2, "0")}:00 (${porHora[pico]} pasos)`);
    if (camTop) l.push(`Acceso más usado: ${esc(camTop)} (${top[1]})`);
    return texto(chat, l.join("\n"));
}
async function cmdEstado(chat) {
    const ds = await prisma.device.findMany({ where: { deviceType: { in: ["LPR_CAMERA", "NVR"] } }, select: { id: true, name: true, deviceType: true }, orderBy: [{ deviceType: "asc" }, { name: "asc" }] });
    const l = ["<b>Estado de equipos</b>", ""];
    let caidos = 0;
    for (const d of ds) {
        const s = await prisma.deviceHealthSample.findFirst({ where: { deviceId: d.id }, orderBy: { ts: "desc" } }).catch(() => null);
        let extra = "";
        if (d.deviceType === "LPR_CAMERA") {
            const u = await prisma.accessEvent.findFirst({ where: { deviceId: d.id }, orderBy: { timestamp: "desc" }, select: { timestamp: true } });
            if (u) extra = ` · última lectura ${fecha(u.timestamp, false)}`;
        }
        const ok = s ? s.reachable : null;
        if (ok === false) caidos++;
        l.push(`${ok === false ? "[CAÍDO]" : ok ? "[ok]" : "[?]"} ${esc(d.name)}${s && s.latencyMs != null && ok ? ` · ${s.latencyMs} ms` : ""}${extra}`);
    }
    const alertas = await prisma.deviceAlert.findMany({ where: { active: true }, orderBy: { openedAt: "desc" }, take: 8, include: {} }).catch(() => []);
    if (alertas.length) { l.push("", "<b>Alertas abiertas</b>"); for (const a of alertas) l.push(`· ${esc(a.message)} (desde ${fecha(a.openedAt, false)})`); }
    l.unshift(caidos ? `<b>${caidos} equipo(s) sin respuesta</b>` : "Todos los equipos responden");
    return texto(chat, l.join("\n"));
}
async function cmdVigilar(chat, arg, quien) {
    const [p0, ...resto] = String(arg || "").trim().split(/\s+/);
    const p = normPlaca(p0);
    if (p.length < 3) return texto(chat, "Uso: <code>/vigilar ABC1234 motivo</code>");
    const ya = await vigilancia(p);
    if (ya) return texto(chat, `<code>${esc(p)}</code> ya está en vigilancia (${CAT(ya.category)}).`);
    await prisma.plateWatch.create({ data: { plate: p, label: resto.join(" ").slice(0, 80) || "Agregada desde Telegram", category: "SEARCH", notify: true, active: true, motivo: resto.join(" ").slice(0, 200) || null, createdBy: `telegram:${quien}` } });
    return texto(chat, `Listo: aviso en este grupo cada vez que pase <code>${esc(p)}</code>.`, { reply_markup: { inline_keyboard: [[{ text: "Quitar", callback_data: `unvig:${p}` }]] } });
}
async function cmdQuitar(chat, arg) {
    const p = normPlaca(arg);
    const n = await prisma.plateWatch.updateMany({ where: { plate: p, active: true }, data: { active: false, deactivatedAt: new Date() } });
    return texto(chat, n.count ? `<code>${esc(p)}</code> salió de la lista de vigilancia.` : `<code>${esc(p)}</code> no estaba en vigilancia.`);
}
async function cmdLista(chat) {
    const ws = await prisma.plateWatch.findMany({ where: { active: true }, orderBy: { createdAt: "desc" }, take: 40 });
    if (!ws.length) return texto(chat, "No hay matrículas en vigilancia.");
    const l = ["<b>Lista de vigilancia</b>", ""];
    ws.forEach((w) => l.push(`<code>${esc(w.plate)}</code> · ${CAT(w.category)}${w.label ? ` · ${esc(w.label)}` : ""}${w.notify ? "" : " · sin aviso"}`));
    return texto(chat, l.join("\n"));
}

const PLACA_SOLA = /^[A-Za-z]{2,4}[\s-]?\d{3,4}$/;
async function mensaje(msg) {
    const chat = msg.chat.id;
    const t = String(msg.text || "").trim();
    if (!t) return;
    const m = t.match(/^\/([a-zA-Z_]+)(?:@(\w+))?\s*([\s\S]*)$/);
    if (m && m[2] && yo && m[2].toLowerCase() !== yo.username.toLowerCase()) return; // comando para otro bot
    if (!m && !PLACA_SOLA.test(t)) return; // en grupo, el bot no contesta a la charla
    if (!(await permitido(msg))) {
        if (msg.chat.type === "private") await texto(chat, "Este bot es del barrio Los Olivos. Pedí que te agreguen al grupo de alertas para usarlo.");
        return;
    }
    const quien = msg.from ? (msg.from.username || msg.from.first_name || msg.from.id) : "?";
    if (!m) return cmdMatricula(chat, t);
    const cmd = m[1].toLowerCase(), arg = m[3] || "";
    console.log(`[tg] ${quien} en ${chat}: /${cmd} ${arg}`.trim());
    switch (cmd) {
        case "start": case "ayuda": case "help": case "menu": return texto(chat, AYUDA);
        case "ultimo": return cmdUltimo(chat, null);
        case "entradas": return cmdUltimo(chat, "ENTRY");
        case "salidas": return cmdUltimo(chat, "EXIT");
        case "matricula": case "m": case "buscar": return cmdMatricula(chat, arg);
        case "camaras": case "cams": return cmdCamaras(chat, 0);
        case "foto": case "video": {
            if (!arg.trim()) return cmdCamaras(chat, 0);
            const d = await camPorArg(arg);
            if (!d) return texto(chat, "No encontré esa cámara. Mirá los números con /camaras");
            return cmd === "foto" ? cmdVivo(chat, d.id) : cmdVideoVivo(chat, d.id);
        }
        case "clip": return cmdClip(chat, null);
        case "hoy": return cmdHoy(chat);
        case "estado": return cmdEstado(chat);
        case "vigilar": return cmdVigilar(chat, arg, quien);
        case "quitar": return cmdQuitar(chat, arg);
        case "lista": return cmdLista(chat);
        default: return texto(chat, "No conozco ese comando. Escribí /ayuda");
    }
}
async function boton(cb) {
    const msg = cb.message; if (!msg) return;
    const chat = msg.chat.id;
    if (!(await permitido({ chat: msg.chat, from: cb.from }))) return tg("answerCallbackQuery", { callback_query_id: cb.id, text: "Sin permiso" }).catch(() => { });
    const [tipo, valor] = String(cb.data || "").split(":");
    const respuestas = { clip: "Buscando la grabación…", vid: "Grabando 10 s…", vivo: "Tomando foto…", hist: "Buscando historial…" };
    tg("answerCallbackQuery", { callback_query_id: cb.id, text: respuestas[tipo] || "" }).catch(() => { });
    const quien = cb.from ? (cb.from.username || cb.from.first_name) : "?";
    console.log(`[tg] ${quien} en ${chat}: botón ${cb.data}`);
    switch (tipo) {
        case "clip": return cmdClip(chat, valor);
        case "vivo": return cmdVivo(chat, valor);
        case "vid": return cmdVideoVivo(chat, valor);
        case "hist": return cmdMatricula(chat, valor);
        case "vig": return cmdVigilar(chat, valor, quien);
        case "unvig": return cmdQuitar(chat, valor);
        case "cams": return cmdCamaras(chat, parseInt(valor, 10) || 0, msg.message_id);
    }
}

// ─── alertas desde server.js (solo local) ────────────────────────────────────
async function alerta(a) {
    const { grupo } = await config();
    if (!grupo) return false;
    const e = a.eventId ? await prisma.accessEvent.findUnique({ where: { id: a.eventId }, include: { user: true, device: true } }) : null;
    if (!e) { await texto(grupo, `<b>${esc(a.titulo || "Alerta")}</b>\n${esc(a.texto || "")}`); return true; }
    const titulo = a.tipo === "merodeo" ? `MERODEO · ${a.texto || ""}` : (a.titulo || "ALERTA");
    await mandarEvento(grupo, e, titulo);
    return true;
}
http.createServer((req, res) => {
    if (req.method !== "POST" || req.url !== "/alerta") { res.writeHead(404); return res.end(); }
    let b = ""; req.on("data", (c) => { b += c; if (b.length > 1e5) req.destroy(); });
    req.on("end", async () => {
        try { const ok = await alerta(JSON.parse(b || "{}")); res.writeHead(ok ? 200 : 503); res.end(ok ? "ok" : "sin grupo"); }
        catch (err) { console.error("[tg] alerta:", err.message); res.writeHead(500); res.end(err.message); }
    });
}).listen(PUERTO_ALERTAS, "127.0.0.1", () => console.log(`[tg] alertas locales en 127.0.0.1:${PUERTO_ALERTAS}`));

// ─── bucle principal ─────────────────────────────────────────────────────────
async function registrarComandos() {
    const lista = [
        ["ultimo", "Último paso con foto"], ["entradas", "Últimas entradas"], ["salidas", "Últimas salidas"],
        ["matricula", "Historial de una matrícula"], ["camaras", "Foto o video en vivo"], ["clip", "Video grabado del último paso"],
        ["hoy", "Resumen del día"], ["estado", "Equipos y alertas"], ["vigilar", "Avisar cuando pase una matrícula"],
        ["quitar", "Sacar de vigilancia"], ["lista", "Lista de vigilancia"], ["ayuda", "Todos los comandos"],
    ].map(([command, description]) => ({ command, description }));
    await tg("setMyCommands", { commands: lista }).catch((e) => console.error("[tg] setMyCommands:", e.message));
    await tg("setMyDescription", { description: "Consultas del control de accesos de Los Olivos: matrículas, fotos, clips y cámaras en vivo." }).catch(() => { });
}
async function main() {
    let offset = 0;
    let avisado = false;
    for (;;) {
        try {
            const { token } = await config();
            if (!token) { if (!avisado) console.error("[tg] sin TELEGRAM_BOT_TOKEN: espero configuración"); avisado = true; await new Promise((r) => setTimeout(r, 30_000)); continue; }
            if (!yo) {
                yo = await tg("getMe");
                console.log(`[tg] conectado como @${yo.username}`);
                await registrarComandos();
                // Lo pendiente de cuando el bot estaba apagado: solo los últimos 2 minutos.
                const pend = await tg("getUpdates", { timeout: 0, offset: -100 }).catch(() => []);
                if (pend.length) offset = pend[pend.length - 1].update_id + 1;
                for (const u of pend) if ((u.message?.date || 0) > Date.now() / 1000 - 120) procesar(u);
            }
            const ups = await tg("getUpdates", { timeout: 50, offset, allowed_updates: ["message", "callback_query"] }, 65_000);
            for (const u of ups) { offset = u.update_id + 1; procesar(u); }
        } catch (err) {
            console.error("[tg]", err.message);
            await new Promise((r) => setTimeout(r, 5000));
        }
    }
}
function procesar(u) {
    const tarea = u.callback_query ? boton(u.callback_query) : u.message ? mensaje(u.message) : null;
    if (tarea) tarea.catch((err) => {
        console.error("[tg] error:", err.message);
        const chat = u.message?.chat.id || u.callback_query?.message?.chat.id;
        if (chat) texto(chat, "No pude completar el pedido. Probá de nuevo en un momento.").catch(() => { });
    });
}
main();
