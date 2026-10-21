/**
 * escucha-eventos — OmniAccess va a buscar los eventos de las cámaras que no pueden llamarlo.
 *
 * 21/10, Nico: «haz que Otto reporte a OmniAccess». Medido ese día en el lab:
 *  · las cámaras de Otto Villa tienen el cruce de línea prendido y avisan «al centro»;
 *  · tres ya tenían a OmniAccess (172.26.20.200:10000) como servidor de alarma, y en tres días no
 *    llegó NADA: la prueba de la cámara (httpHosts/1/test) contesta «deviceError»;
 *  · la cámara ve al lab como 10.1.10.1 (su router): el túnel hace NAT de este lado hacia allá,
 *    pero de allá hacia el lab no hay ruta. La cámara no puede llamar; OmniAccess sí puede llamarla.
 *
 * Entonces se invierte el sentido: este proceso se queda colgado del flujo de eventos de cada
 * cámara elegida (/ISAPI/Event/notification/alertStream, el mismo que usa el seguimiento) y cada
 * analítica que llega (cruce de línea, zona, entrada/salida de región) se la pasa al receptor de
 * siempre (server.js, /api/webhooks/hikvision) tal cual la habría mandado la cámara. Así entra por
 * la misma pila que todo lo demás: Detection, captura, reglas de aviso, monitor, alerta global.
 * No hace falta tocar server.js ni el router del barrio.
 *
 * Qué cámaras: el Setting ESCUCHA_EVENTOS (lista de ids de equipo). Las apagadas por área
 * (EQUIPOS_APAGADOS) no se escuchan. Se relee cada minuto: sumar o sacar una no pide reinicio.
 *
 * Cuidado con los dobles: una cámara que SÍ llega por push y además está en la lista daría cada
 * evento dos veces. Por eso la lista es explícita, y la ficha del servidor de alarma la arma sólo
 * cuando la prueba de push falla.
 */
const http = require("http");
const crypto = require("crypto");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();
const RECEPTOR = { host: "127.0.0.1", port: Number(process.env.WEBHOOK_PORT || 10000), path: process.env.EVENT_HOST_PATH || "/api/webhooks/hikvision" };
const CLAVE_LISTA = "ESCUCHA_EVENTOS";
const RELEER_MS = 60_000;
const ESPERA_MIN_MS = 5_000;
const ESPERA_MAX_MS = 120_000;
/** Un mismo evento repetido dentro de esta ventana (misma cámara, tipo y región) se manda una vez. */
const DOBLE_MS = 2_500;
/** Las analíticas que interesan. El movimiento (VMD) no: el receptor lo descarta igual y son miles. */
const TIPOS = new Set(["linedetection", "fielddetection", "regionentrance", "regionexiting"]);

const INICIO = Buffer.from("<EventNotificationAlert");
const FIN = Buffer.from("</EventNotificationAlert>");

const log = (...a) => console.log(new Date().toISOString(), "[escucha]", ...a);

function cabeceraDigest(desafio, metodo, uri, usuario, clave) {
    const c = {};
    for (const m of desafio.replace(/^Digest\s+/i, "").matchAll(/(\w+)="?([^",]*)"?/g)) c[m[1]] = m[2];
    if (!c.realm || !c.nonce) return null;
    const md5 = (s) => crypto.createHash("md5").update(s).digest("hex");
    const ha1 = md5(`${usuario}:${c.realm}:${clave}`), ha2 = md5(`${metodo}:${uri}`);
    const cnonce = crypto.randomBytes(8).toString("hex"), nc = "00000001";
    const qop = (c.qop || "").split(",")[0].trim();
    const r = qop ? md5(`${ha1}:${c.nonce}:${nc}:${cnonce}:${qop}:${ha2}`) : md5(`${ha1}:${c.nonce}:${ha2}`);
    let h = `Digest username="${usuario}", realm="${c.realm}", nonce="${c.nonce}", uri="${uri}", response="${r}"`;
    if (qop) h += `, qop=${qop}, nc=${nc}, cnonce="${cnonce}"`;
    if (c.opaque) h += `, opaque="${c.opaque}"`;
    return h;
}

/** Estado por cámara: la conexión viva, la espera del reintento y la generación (para no duplicar cadenas). */
const escuchas = new Map();
const cuentas = { recibidos: 0, enviados: 0, dobles: 0, errores: 0 };

const campo = (xml, t) => (xml.match(new RegExp(`<${t}>([^<]*)</${t}>`)) || [])[1] || "";

function reenviar(xml) {
    return new Promise((resolve) => {
        const cuerpo = Buffer.from(xml, "utf8");
        const req = http.request({ ...RECEPTOR, method: "POST", headers: { "Content-Type": "application/xml", "Content-Length": cuerpo.length, "X-Omni-Escucha": "1" }, timeout: 15000 }, (res) => {
            res.resume();
            res.on("end", () => resolve(res.statusCode));
        });
        req.on("error", () => resolve(0));
        req.on("timeout", () => { req.destroy(); resolve(0); });
        req.end(cuerpo);
    });
}

async function procesar(est, xml) {
    const tipo = campo(xml, "eventType").toLowerCase();
    const estado = campo(xml, "eventState").toLowerCase();
    if (!TIPOS.has(tipo) || estado !== "active") return;
    cuentas.recibidos++;
    const region = campo(xml, "regionID");
    const clave = `${tipo}|${region}`;
    const ahora = Date.now();
    if (ahora - (est.ultimos.get(clave) || 0) < DOBLE_MS) { cuentas.dobles++; return; }
    est.ultimos.set(clave, ahora);
    // El receptor identifica la cámara por <ipAddress> del XML: si la cámara no lo trae (algunos
    // firmwares lo dejan vacío en el alertStream), se le pone el de la ficha.
    let x = xml;
    if (!campo(x, "ipAddress")) x = x.replace(/<EventNotificationAlert([^>]*)>/, `<EventNotificationAlert$1><ipAddress>${est.cam.ip}</ipAddress>`);
    const st = await reenviar(x);
    if (st >= 200 && st < 300) { cuentas.enviados++; log(`${est.cam.name}: ${tipo} → receptor`); }
    else { cuentas.errores++; log(`${est.cam.name}: el receptor no tomó el evento (${st || "sin respuesta"})`); }
}

function abrir(est, autorizacion) {
    if (est.retirada) return;
    const uri = "/ISAPI/Event/notification/alertStream";
    const gen = est.gen;
    const req = http.request({ host: est.cam.ip, port: est.cam.puerto, path: uri, method: "GET", headers: autorizacion ? { Authorization: autorizacion } : {} }, (res) => {
        if (gen !== est.gen) { res.resume(); req.destroy(); return; }
        if (res.statusCode === 401 && !autorizacion) {
            const h = cabeceraDigest(res.headers["www-authenticate"] || "", "GET", uri, est.cam.usuario, est.cam.clave);
            res.resume();
            if (!h) return reintentar(est, "la cámara no ofrece digest");
            return abrir(est, h);
        }
        if (res.statusCode !== 200) { res.resume(); return reintentar(est, `HTTP ${res.statusCode}`); }
        if (est.fallos) log(`${est.cam.name}: escuchando otra vez (después de ${est.fallos} intentos)`); else log(`${est.cam.name}: escuchando`);
        est.fallos = 0; est.espera = ESPERA_MIN_MS; est.req = req; est.desde = Date.now();
        let cola = Buffer.alloc(0);
        res.on("data", (t) => {
            if (gen !== est.gen) return;
            cola = Buffer.concat([cola, t]);
            for (;;) {
                const i = cola.indexOf(INICIO); if (i < 0) break;
                const f = cola.indexOf(FIN, i); if (f < 0) break;
                const bloque = cola.subarray(i, f + FIN.length).toString("utf8");
                cola = cola.subarray(f + FIN.length);
                procesar(est, bloque).catch(() => { });
            }
            // Las imágenes adjuntas no interesan (el receptor saca su propia captura).
            if (cola.length > 2 * 1024 * 1024) cola = cola.subarray(cola.length - 64 * 1024);
        });
        res.on("end", () => reintentar(est, "el flujo se cerró"));
        res.on("close", () => reintentar(est, "el flujo se cerró"));
    });
    req.on("error", (e) => reintentar(est, e.code || e.message));
    req.end();
}

function reintentar(est, motivo) {
    if (est.retirada || est.timer) return;
    est.fallos = (est.fallos || 0) + 1;
    if (est.fallos === 1 || est.fallos % 20 === 0) log(`${est.cam.name}: sin flujo (${motivo}); reintento en ${Math.round(est.espera / 1000)} s`);
    est.gen++;
    try { est.req && est.req.destroy(); } catch { }
    est.timer = setTimeout(() => { est.timer = null; abrir(est, null); }, est.espera);
    est.espera = Math.min(ESPERA_MAX_MS, est.espera * 2);
}

function retirar(est) {
    est.retirada = true; est.gen++;
    if (est.timer) clearTimeout(est.timer);
    try { est.req && est.req.destroy(); } catch { }
}

async function leerLista() {
    const filas = await prisma.setting.findMany({ where: { key: { in: [CLAVE_LISTA, "EQUIPOS_APAGADOS"] } } });
    const val = (k) => { try { const v = JSON.parse(filas.find((f) => f.key === k)?.value || "[]"); return Array.isArray(v) ? v.map(String) : []; } catch { return []; } };
    const apagados = new Set(val("EQUIPOS_APAGADOS"));
    const ids = val(CLAVE_LISTA).filter((id) => !apagados.has(id));
    if (!ids.length) return [];
    const devs = await prisma.device.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, ip: true, httpPort: true, username: true, password: true } });
    return devs.filter((d) => d.ip).map((d) => ({
        id: d.id, name: d.name,
        ip: String(d.ip).replace(/^https?:\/\//, "").split("/")[0].split(":")[0],
        puerto: Number(d.httpPort) || 80, usuario: d.username || "admin", clave: d.password || "",
    }));
}

async function sincronizar() {
    let lista;
    try { lista = await leerLista(); } catch (e) { log("no se pudo leer la lista:", e.message); return; }
    const firma = (c) => `${c.ip}:${c.puerto}:${c.usuario}:${crypto.createHash("sha1").update(c.clave).digest("hex")}`;
    const vigentes = new Set(lista.map((c) => c.id));
    for (const [id, est] of escuchas) if (!vigentes.has(id)) { retirar(est); escuchas.delete(id); log(`${est.cam.name}: se deja de escuchar`); }
    for (const cam of lista) {
        const ya = escuchas.get(cam.id);
        if (ya && ya.firma === firma(cam)) { ya.cam.name = cam.name; continue; }
        if (ya) retirar(ya);
        const est = { cam, firma: firma(cam), gen: 0, espera: ESPERA_MIN_MS, fallos: 0, ultimos: new Map(), timer: null, req: null, retirada: false };
        escuchas.set(cam.id, est);
        abrir(est, null);
    }
}

/** Para la salud: cuántas se escuchan y cuántas están conectadas, cada 10 min en el log. */
setInterval(() => {
    const conectadas = [...escuchas.values()].filter((e) => e.req && !e.timer).length;
    log(`estado: ${escuchas.size} cámaras, ${conectadas} conectadas · eventos ${cuentas.recibidos}, enviados ${cuentas.enviados}, dobles ${cuentas.dobles}, errores ${cuentas.errores}`);
}, 600_000);

log("arranca");
sincronizar();
setInterval(sincronizar, RELEER_MS);
process.on("SIGINT", async () => { for (const e of escuchas.values()) retirar(e); await prisma.$disconnect(); process.exit(0); });
