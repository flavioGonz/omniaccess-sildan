#!/usr/bin/env node
/**
 * Receptor de rastreadores GPS: GT06 (Concox y clones) y Teltonika (Codec 8 y 8E).
 *
 * Los dos protocolos entran por el MISMO puerto y se distinguen por los primeros bytes: un GT06
 * empieza con 78 78, un Teltonika saluda con 00 0F y su IMEI. Lo que cambia entre uno y otro es
 * cómo se leen las tramas y cómo se acusan; qué se hace con una posición, un evento o un silencio
 * es lo mismo para los dos, y está una sola vez (alReporte, alEvento). Teltonika está escrito
 * contra la documentación del fabricante y sus tramas de ejemplo: no pasó por un equipo real.
 *
 * Proceso propio, como alarm-receiver.js, y por la misma razón: un GPS no llama a una URL, abre
 * un TCP y lo deja abierto. Escucha en GPS_PUERTO (1341) y por cada trama:
 *
 *   · login     → anota el equipo (se crea solo la primera vez) y le contesta el acuse. SIN ESE
 *                 ACUSE EL EQUIPO NO PASA DE AHÍ: medido el 20/11, el de Nico mandó el mismo
 *                 login cada 30 segundos durante horas y por SMS decía «GPRS: Link Down».
 *   · latido    → batería, señal y motor encendido; acuse.
 *   · posición  → una fila en GpsPosicion y lo último en GpsEquipo. Sólo las que traen
 *                 satélites: una posición «sin fix» es la última que el equipo supo, repetida, y
 *                 guardarla dibuja un auto quieto donde ya no está.
 *   · alarma    → lo mismo, con su código; acuse.
 *
 * El puerto está abierto a internet (el GPS sale por la red celular, con IP que cambia), así que
 * acá llega de todo, y el protocolo no tiene clave: el IMEI identifica, no autoriza. Las defensas
 * (21/11, «el puerto acepta a cualquiera»):
 *   · Lo que no es una trama válida se ignora, y quien no se presenta en 30 segundos se corta.
 *   · Un equipo desconocido se ANOTA (para que alguien lo acepte en Dispositivos) y nada más: no
 *     guarda historial, no dispara eventos, no se dibuja. Y de esos se anotan hasta
 *     GPS_PENDIENTES_MAX: el número 21 no entra, así nadie llena la base inventando IMEI.
 *   · Con la puerta cerrada (ajuste GPS_PUERTA) no se anota ninguno nuevo: sólo los aceptados.
 *   · Una IP que acumula faltas (basura, conexiones sin login, IMEI rechazados) queda castigada un
 *     rato. Castigada NO es bloqueada: detrás de la misma IP de la operadora puede haber un
 *     rastreador legítimo, así que a los equipos aceptados se los sigue atendiendo.
 *   · Topes de conexiones, y de tramas por minuto por conexión.
 *   · Una posición que exigiría 250 km/h no mueve el punto del mapa (lib-gps-eventos).
 * Lo que cierra el puerto de verdad es un APN privado con la operadora; esto es lo que se puede
 * hacer del lado del servidor.
 *
 * Las tramas de rutina (posición, latido, hora, voltaje) se anotan en crudo en el log sólo con GPS_CRUDO=1.
 * Estuvieron siempre anotadas hasta el 22/11, mientras se afinaba el decodificador con tramas
 * reales; con una semana de viajes de verdad leídos bien (19 viajes, 2.347 posiciones) ya no hace
 * falta, y el log dejaba escrito por dónde andaba cada vehículo. Lo que NO es rutina —una alarma,
 * un tipo de trama que no se conoce— se sigue anotando siempre: es justo lo que hay que poder
 * mirar después (todavía no llegó nunca un SOS real).
 */
"use strict";
require("dotenv").config({ quiet: true });
const net = require("net");
const { PrismaClient } = require("@prisma/client");
const g = require("./lib-gt06");
const tk = require("./lib-teltonika");
const evs = require("./lib-gps-eventos");

const prisma = new PrismaClient();
const PUERTO = Number(process.env.GPS_PUERTO || 1341);
const CRUDO = process.env.GPS_CRUDO === "1";
const DE_RUTINA = new Set(["posicion", "estado", "login", "hora", "info", "respuesta"]);
/** Sin presentarse en este tiempo, se corta: un escáner no manda un login (el equipo lo manda al conectar). */
const SIN_LOGIN_MS = 30_000;
/** Lo mismo para una IP castigada: tiene que presentarse enseguida, y con un IMEI aceptado. */
const SIN_LOGIN_CASTIGADA_MS = 5_000;
/** Cuántos equipos «se presentó, sin dar de alta» se anotan como mucho. */
const PENDIENTES_MAX = Number(process.env.GPS_PENDIENTES_MAX || 20);
/** Topes de conexiones: en total, sin presentarse, y sin presentarse desde una misma IP. */
const SOCKETS_MAX = 3000, SIN_LOGIN_MAX = 200, SIN_LOGIN_POR_IP = 8;
/** Más tramas que esto en un minuto por una conexión no es un rastreador (el más charlatán manda 6 a 12). */
const TRAMAS_POR_MIN_MAX = 300;
/** Cinco faltas en diez minutos castigan a la IP un cuarto de hora. */
const FALTAS_MAX = 5, FALTAS_VENTANA_MS = 10 * 60_000, CASTIGO_MS = 15 * 60_000;
const ARRANQUE = Date.now();
/** Un equipo que no dice nada en este tiempo se cayó sin avisar (túnel, sin señal). */
const MUDO_MS = 10 * 60_000;
/** Tope de lo que se junta sin encontrar una trama: lo demás es basura. */
const BASURA_MAX = 4096;

const log = (...a) => console.log(new Date().toISOString(), ...a);
const enLinea = new Map();   // imei → socket
const abiertos = new Set();  // todos los sockets
const cuenta = { tramas: 0, ultimaTrama: 0, rechazados: 0 };

/** Las faltas de cada IP. Se olvidan solas: es memoria de un rato, no una lista negra. */
const faltas = new Map();    // ip → { marcas: [ms], hasta: ms }
function falta(ip, porque) {
    const ahora = Date.now();
    const f = faltas.get(ip) || { marcas: [], hasta: 0 };
    f.marcas = f.marcas.filter((t) => ahora - t < FALTAS_VENTANA_MS); f.marcas.push(ahora);
    if (f.marcas.length >= FALTAS_MAX && f.hasta < ahora) { f.hasta = ahora + CASTIGO_MS; log(ip, `castigada ${CASTIGO_MS / 60_000} min: ${f.marcas.length} faltas (la última: ${porque})`); }
    faltas.set(ip, f);
}
const castigada = (ip) => (faltas.get(ip)?.hasta || 0) > Date.now();
setInterval(() => { const ahora = Date.now(); for (const [ip, f] of faltas) if (f.hasta < ahora && !f.marcas.some((t) => ahora - t < FALTAS_VENTANA_MS)) faltas.delete(ip); }, 60_000).unref();

/** Lo que se recuerda de cada equipo mientras el receptor está arriba (lo que importa además va a la base). */
const memoria = new Map();   // imei → { ultPos, candidato, saltando, callado, ladosTxt }
const mem = (imei) => { if (!memoria.has(imei)) memoria.set(imei, { ultPos: null, candidato: null, saltando: false, callado: false, ladosTxt: null }); return memoria.get(imei); };

/**
 * Los comandos al equipo. La aplicación web no tiene el socket del rastreador —lo tiene este
 * proceso—, así que le pide el envío por una puertita HTTP que SÓLO escucha en 127.0.0.1: desde
 * afuera del servidor no existe. Cada comando lleva una marca; el equipo la devuelve en su
 * respuesta y con eso se sabe a quién contestarle.
 */
const PUERTO_CONTROL = Number(process.env.GPS_PUERTO_CONTROL || 10013);
const ESPERA_RESPUESTA_MS = 20_000;
const esperando = new Map();   // marca → { resolver, reloj }
let marcaSig = (Date.now() & 0x7fffffff) || 1, serieSig = 1;

function mandarComando(imei, texto, conIdioma = true) {
    return new Promise((resolver) => {
        const s = enLinea.get(imei);
        if (!s) return resolver({ ok: false, error: "El rastreador no está en línea." });
        if (s.protocolo !== "GT06") return resolver({ ok: false, error: "Los comandos a este modelo de rastreador todavía no están hechos: se le mandan por SMS." });
        const marca = marcaSig = (marcaSig + 1) & 0x7fffffff;
        const reloj = setTimeout(() => { esperando.delete(marca); resolver({ ok: false, error: "El rastreador no contestó a tiempo." }); }, ESPERA_RESPUESTA_MS);
        esperando.set(marca, { resolver, reloj, imei });
        const t = g.comando(texto, serieSig = (serieSig + 1) & 0xffff, marca, conIdioma);
        log(imei, "COMANDO →", texto, t.toString("hex"));
        s.write(t);
    });
}

function alResponder(imei, m) {
    log(imei, "RESPUESTA ←", JSON.stringify(m.texto));
    /* Por la marca, y si el equipo no la devuelve bien, al único comando que ese equipo tiene
       pendiente: no perder una respuesta por un detalle del clon. */
    let e = esperando.get(m.marca);
    let clave = m.marca;
    if (!e) for (const [k, v] of esperando) if (v.imei === imei) { e = v; clave = k; break; }
    if (!e) return;
    clearTimeout(e.reloj); esperando.delete(clave);
    e.resolver({ ok: true, respuesta: m.texto });
}

require("http").createServer((req, res) => {
    const fin = (c, o) => { res.writeHead(c, { "content-type": "application/json" }); res.end(JSON.stringify(o)); };
    if (req.method === "GET" && req.url === "/enlinea") return fin(200, { imeis: [...enLinea.keys()] });
    /* Para el vigía: que el proceso figure «online» en pm2 no dice que esté escuchando. */
    if (req.method === "GET" && req.url === "/salud") {
        let sinLogin = 0; for (const x of abiertos) if (!x.imei) sinLogin++;
        return fin(200, { ok: servidor.listening, desde: new Date(ARRANQUE).toISOString(), enLinea: enLinea.size, conexiones: abiertos.size, sinLogin, tramas: cuenta.tramas, ultimaTrama: cuenta.ultimaTrama ? new Date(cuenta.ultimaTrama).toISOString() : null, rechazados: cuenta.rechazados, castigadas: [...faltas.values()].filter((f) => f.hasta > Date.now()).length, puerta });
    }
    if (req.method !== "POST" || req.url !== "/comando") return fin(404, { error: "no existe" });
    let cuerpo = "";
    req.on("data", (c) => { cuerpo += c; if (cuerpo.length > 2000) req.destroy(); });
    req.on("end", async () => {
        try {
            const { imei, texto, sinIdioma } = JSON.parse(cuerpo || "{}");
            if (!imei || !texto || !/^[\x20-\x7e]{1,80}$/.test(texto)) return fin(400, { ok: false, error: "Falta el equipo o el comando." });
            fin(200, await mandarComando(String(imei), String(texto), !sinIdioma));
        } catch { fin(400, { ok: false, error: "Pedido mal formado." }); }
    });
}).listen(PUERTO_CONTROL, "127.0.0.1", () => log(`control de comandos en 127.0.0.1:${PUERTO_CONTROL}`));

/**
 * Los eventos: se guardan en GpsEvento y se pasan al motor de reglas de la aplicación, que es el
 * que sabe a quién avisarle y por dónde (el mismo camino que usa alarm-receiver.js). Si no hay
 * ninguna regla de GPS, no sale nada: el evento queda guardado y listo.
 */
const vigia = evs.nuevoVigia();
/** Lo último que se supo del motor de cada equipo, para juzgar «se mueve con el motor apagado». */
const motor = new Map();

/** Las geocercas, releídas cada medio minuto: se editan en el mapa y el receptor es otro proceso. */
let geocercas = [];
/** «abierta»: un equipo nuevo se anota para que alguien lo acepte. «cerrada»: sólo los aceptados. */
let puerta = "abierta";
async function leerGeocercas() {
    try { geocercas = await prisma.gpsGeocerca.findMany({ where: { activa: true } }); } catch { /* sin base: quedan las últimas */ }
    try { puerta = (await prisma.setting.findUnique({ where: { key: "GPS_PUERTA" } }))?.value === "cerrada" ? "cerrada" : "abierta"; } catch { /* queda como estaba */ }
}
leerGeocercas(); setInterval(leerGeocercas, Number(process.env.GPS_RELEER_MS || 30_000)).unref();

const HUSO = process.env.TZ_AVISOS || process.env.NEXT_PUBLIC_TZ || "America/Montevideo";
const horaLocal = (d) => new Date(d).toLocaleTimeString("es-UY", { timeZone: HUSO, hour12: false, hour: "2-digit", minute: "2-digit" });
const minutosDe = (s) => (s >= 3600 ? `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min` : `${Math.max(1, Math.round(s / 60))} min`);

/**
 * Lo que pasa, empujado a las pantallas abiertas por el socket del servidor de eventos (el mismo
 * camino que usa alarm-receiver.js). Sin esto el mapa se enteraba preguntando cada 15 segundos:
 * el vehículo avanzaba a saltos y un cruce de geocerca no se veía hasta el próximo refresco.
 */
const WEBHOOKS = Number(process.env.WEBHOOK_PORT || 10000);
function emitir(evento, datos) {
    try {
        const cuerpo = JSON.stringify({ __event: evento, ...datos });
        const req = require("http").request({ hostname: "127.0.0.1", port: WEBHOOKS, path: "/internal/emit", method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(cuerpo) }, timeout: 2000 });
        req.on("error", () => {}); req.on("timeout", () => req.destroy());
        req.write(cuerpo); req.end();
    } catch { /* un aviso al panel que no sale no puede frenar la recepción */ }
}

async function avisarPorReglas(ev) {
    try {
        let token = process.env.TRACKING_TOKEN || "";
        if (!token) token = (await prisma.setting.findUnique({ where: { key: "TRACKING_TOKEN" } }))?.value || "";
        if (!token) return;
        const r = await fetch(`${process.env.INTERNAL_BASE_URL || "http://127.0.0.1:10001"}/api/notifications/event`, {
            method: "POST", headers: { "Content-Type": "application/json", "x-tracking-token": token }, body: JSON.stringify(ev), signal: AbortSignal.timeout(8000),
        });
        if (!r.ok) log(`reglas: /api/notifications/event respondió ${r.status}`);
    } catch (e) { log("reglas: no se pudo avisar:", e.message); }
}

/**
 * `cuandoEquipo` es la hora en que PASÓ según el rastreador, cuando el evento sale de una trama
 * suya. Si llegó con más de dos minutos de demora (estuvo sin señal y mandó todo junto), el
 * evento se guarda con SU hora, se marca cuánto tardó, y el aviso lo dice: «pasó a las 14:32,
 * llegó 9 min tarde». Antes un cruce de geocerca de hace diez minutos avisaba como si fuera ahora.
 */
async function alEvento(imei, tipo, p, detalle, extra, cuandoEquipo) {
    if (!tipo) return;
    log(imei, "EVENTO:", tipo, detalle || "");
    try {
        const e = await prisma.gpsEquipo.findUnique({ where: { imei } });
        /* Un equipo que se presentó solo y nadie aceptó no avisa a nadie: todavía no es de nadie. */
        if (!e || !e.deviceId || e.deviceId === evs.DEVICE_DE_PRUEBA) return;
        const lat = p && p.conFix ? p.lat : e.lat, lon = p && p.conFix ? p.lon : e.lon;
        const llego = new Date();
        const tarde = cuandoEquipo && evs.horaCreible(cuandoEquipo, llego.getTime()) ? evs.atrasoDe(cuandoEquipo, llego.getTime()) : 0;
        const cuando = tarde ? new Date(cuandoEquipo) : llego;
        const prioridad = evs.prioridadDe(tipo, extra);
        /* En un cruce de geocerca el detalle YA es el lugar: no se repite. */
        const lugar = tipo.startsWith("GPS_GEOCERCA_") ? null : evs.lugarDe(lat, lon, geocercas);
        const fila = await prisma.gpsEvento.create({ data: { imei, tipo, cuando, llego, tarde: tarde || null, lat, lon, detalle: detalle || null, prioridad, lugar } });
        if (evs.SOLO_SE_ANOTA.has(tipo)) return;
        /* A la pantalla va siempre, haya o no una regla de notificación: que no se le avise a
           nadie por Telegram no quiere decir que quien está mirando el mapa no lo tenga que ver.
           (21/11, Nico: «la geocerca no hace nada cuando el GPS entra»: lo detectaba y lo
           guardaba, pero sin regla no salía ningún aviso y el mapa no mostraba nada.) */
        const nombre = e.nombre || `Rastreador ${imei.slice(-6)}`;
        emitir("gps_evento", { id: fila.id, imei, tipo, rotulo: evs.ROTULO[tipo] || tipo, detalle: detalle || "", nombre, lat, lon, cuando: cuando.toISOString(), tarde, prioridad, lugar, ...(extra || {}) });
        const veh = e.vehicleId ? await prisma.vehicle.findUnique({ where: { id: e.vehicleId }, select: { plate: true } }).catch(() => null) : null;
        const punto = lat != null && lon != null ? `${lat.toFixed(5)}, ${lon.toFixed(5)}` : "";
        const dicho = [detalle, lugar, tarde ? `pasó a las ${horaLocal(cuando)}, llegó ${minutosDe(tarde)} tarde` : null].filter(Boolean).join(" · ");
        avisarPorReglas({
            modulo: "GPS", evento: tipo, deviceId: e.deviceId, deviceName: nombre,
            plate: veh ? veh.plate : null,
            extra: { detalle: dicho, lugar: punto, mapa: punto ? `https://maps.google.com/?q=${lat},${lon}` : "", imei, gpsEventoId: fila.id },
        });
    } catch (err) { log(imei, "error guardando el evento:", err.message); }
}

/**
 * El cruce con las cámaras de matrículas (ver lib-gps-eventos, cruzarLectura). Cada medio minuto
 * se miran las lecturas nuevas de las matrículas que llevan rastreador y se compara dónde estaba
 * la cámara con dónde estaba el rastreador.
 *
 * Se juzga una lectura recién cuando tiene un minuto y medio: un rastreador que venía sin señal
 * manda sus posiciones juntas y atrasadas (el 6 % llega con más de dos minutos de demora), y
 * opinar antes sería avisar «está en otro lado» por una posición que todavía no llegó.
 *
 * Sólo cuentan las cámaras puestas en el mapa: sin saber dónde está la cámara no hay con qué
 * comparar. Y arranca desde ahora: no revisa lo leído antes de que el receptor levantara.
 */
const CRUCE_ESPERA_MS = 90_000;
let cruceDesde = new Date(Date.now() - CRUCE_ESPERA_MS);
const cruceAvisado = new Map();      // `${imei}|${deviceId}` → cuándo se avisó: una vez cada diez minutos por cámara
async function revisarLecturas() {
    const hasta = new Date(Date.now() - CRUCE_ESPERA_MS);
    if (hasta <= cruceDesde) return;
    const equipos = await prisma.gpsEquipo.findMany({ where: { deviceId: { not: null }, vehicleId: { not: null }, NOT: { deviceId: evs.DEVICE_DE_PRUEBA } }, select: { imei: true, vehicleId: true, ultimoLatido: true, sinReporteDesde: true } });
    if (!equipos.length) { cruceDesde = hasta; return; }
    const vehiculos = await prisma.vehicle.findMany({ where: { id: { in: equipos.map((e) => e.vehicleId) } }, select: { id: true, plate: true } });
    const equipoDe = new Map(vehiculos.map((v) => [v.plate.toUpperCase().replace(/[^A-Z0-9]/g, ""), equipos.find((e) => e.vehicleId === v.id)]));
    if (!equipoDe.size) { cruceDesde = hasta; return; }
    const lecturas = await prisma.accessEvent.findMany({
        where: { timestamp: { gt: cruceDesde, lte: hasta }, plateDetected: { in: [...equipoDe.keys()] }, deviceId: { not: null } },
        select: { id: true, timestamp: true, plateDetected: true, deviceId: true, device: { select: { name: true } } }, orderBy: { timestamp: "asc" }, take: 200,
    });
    cruceDesde = hasta;
    if (!lecturas.length) return;
    let camaras = [];
    try { camaras = JSON.parse((await prisma.setting.findUnique({ where: { key: "BARRIO_MAP" } }))?.value || "{}").cameras || []; } catch { /* mapa ilegible: no hay cámaras ubicadas */ }
    for (const l of lecturas) {
        const e = equipoDe.get(l.plateDetected), cam = camaras.find((c) => c && c.deviceId === l.deviceId && Number.isFinite(c.lat) && Number.isFinite(c.lng));
        if (!e || !cam) continue;
        const p = await prisma.gpsPosicion.findFirst({ where: { imei: e.imei, cuando: { lte: l.timestamp }, satelites: { gte: evs.SATS_MIN } }, orderBy: { cuando: "desc" }, select: { lat: true, lon: true, cuando: true } });
        const vivo = !e.sinReporteDesde && !!e.ultimoLatido && l.timestamp.getTime() - e.ultimoLatido.getTime() < evs.SILENCIO_QUIETO_MS;
        const r = evs.cruzarLectura({ camara: { lat: cam.lat, lon: cam.lng }, cuando: l.timestamp.getTime(), posicion: p ? { lat: p.lat, lon: p.lon, cuando: p.cuando.getTime() } : null, vivo });
        log(e.imei, "LPR:", l.plateDetected, "en", l.device?.name || l.deviceId, "→", r.que, r.metros != null ? `${r.metros} m` : "");
        if (r.que !== "lejos") continue;
        const clave = `${e.imei}|${l.deviceId}`;
        if (Date.now() - (cruceAvisado.get(clave) || 0) < 10 * 60_000) continue;
        cruceAvisado.set(clave, Date.now());
        await alEvento(e.imei, "GPS_LPR_LEJOS", { conFix: true, lat: p.lat, lon: p.lon }, `${l.plateDetected} leída en ${l.device?.name || "una cámara"}; el rastreador estaba a ${evs.distanciaLegible(r.metros)}`, { accessEventId: l.id, camara: l.device?.name || null }, l.timestamp);
    }
}
setInterval(() => revisarLecturas().catch((e) => log("-", "cruce con LPR:", e.message)), 30_000).unref();

/**
 * El silencio (ver lib-gps-eventos, seCallo). Cada medio minuto se mira quién dejó de reportar.
 * Se avisa UNA vez —queda anotado en la base, así un reinicio no vuelve a avisar— y cuando el
 * equipo vuelve a hablar se dice cuánto estuvo callado.
 */
async function revisarSilencios() {
    let filas = [];
    try { filas = await prisma.gpsEquipo.findMany({ where: { deviceId: { not: null }, NOT: { deviceId: evs.DEVICE_DE_PRUEBA }, sinReporteDesde: null, ultimoLatido: { not: null } } }); } catch { return; }
    for (const e of filas) {
        if (!evs.seCallo(e, ARRANQUE)) continue;
        const andando = evs.veniaAndando(e);
        const r = await prisma.gpsEquipo.updateMany({ where: { imei: e.imei, sinReporteDesde: null }, data: { sinReporteDesde: e.ultimoLatido } }).catch(() => ({ count: 0 }));
        if (!r.count) continue;
        mem(e.imei).callado = true;
        await alEvento(e.imei, "GPS_SIN_REPORTE", null, `${andando ? `Iba a ${e.velocidad} km/h` : "Estaba detenido"} · último reporte ${horaLocal(e.ultimoLatido)}`, { andando });
    }
}
setInterval(() => revisarSilencios().catch(() => {}), 30_000).unref();

/** Llegó algo de un equipo: si se había avisado que estaba callado, volvió. */
async function oyo(imei) {
    const m = mem(imei);
    if (!m.callado) return;
    m.callado = false;
    const e = await prisma.gpsEquipo.findUnique({ where: { imei }, select: { sinReporteDesde: true } }).catch(() => null);
    if (!e || !e.sinReporteDesde) return;
    const callado = (Date.now() - e.sinReporteDesde.getTime()) / 1000;
    await prisma.gpsEquipo.update({ where: { imei }, data: { sinReporteDesde: null } }).catch(() => {});
    await alEvento(imei, "GPS_VOLVIO", null, `Estuvo ${minutosDe(callado)} sin reportar`);
}

/**
 * La retención. Una posición cada diez segundos son 8.640 filas por día de marcha por vehículo, y
 * guardarlas para siempre no es una decisión, es un olvido. Dos plazos:
 *  · las de pocos satélites (no mueven el mapa ni entran a los recorridos: sirven para entender
 *    una mala noche) se van a los GPS_RETENCION_POBRES_DIAS, 30 por defecto;
 *  · todas, y los eventos, a los GPS_RETENCION_DIAS, 365 por defecto.
 */
const RETENCION_DIAS = Number(process.env.GPS_RETENCION_DIAS || 365), RETENCION_POBRES_DIAS = Number(process.env.GPS_RETENCION_POBRES_DIAS || 30);
async function podar() {
    try {
        const dia = 86_400_000, ahora = Date.now();
        const a = await prisma.gpsPosicion.deleteMany({ where: { cuando: { lt: new Date(ahora - RETENCION_POBRES_DIAS * dia) }, satelites: { lt: evs.SATS_MIN } } });
        const b = await prisma.gpsPosicion.deleteMany({ where: { cuando: { lt: new Date(ahora - RETENCION_DIAS * dia) } } });
        const c = await prisma.gpsEvento.deleteMany({ where: { cuando: { lt: new Date(ahora - RETENCION_DIAS * dia) } } });
        if (a.count || b.count || c.count) log(`retención: ${a.count} posiciones pobres de más de ${RETENCION_POBRES_DIAS} días, ${b.count} posiciones y ${c.count} eventos de más de ${RETENCION_DIAS} días`);
    } catch (e) { log("retención: no se pudo podar:", e.message); }
}
setTimeout(podar, 5 * 60_000).unref(); setInterval(podar, 6 * 3600_000).unref();

/**
 * Un login. Devuelve la fila del equipo, o un motivo de rechazo («cerrada», «lleno», «castigada»).
 * Sólo se CREA una fila si la puerta está abierta, hay lugar y la IP no viene acumulando faltas.
 */
async function alPresentarse(imei, ip, protocolo = "GT06") {
    let e = await prisma.gpsEquipo.findUnique({ where: { imei } });
    if (!e) {
        if (puerta === "cerrada") return "cerrada";
        if (castigada(ip)) return "castigada";
        if ((await prisma.gpsEquipo.count({ where: { deviceId: null } })) >= PENDIENTES_MAX) return "lleno";
        e = await prisma.gpsEquipo.create({ data: { imei, protocolo, ultimaIp: ip, ultimoLatido: new Date() } });
    } else {
        if (!e.deviceId && castigada(ip)) return "castigada";
        await prisma.gpsEquipo.update({ where: { imei }, data: { ultimaIp: ip, ultimoLatido: new Date(), ...(e.protocolo !== protocolo ? { protocolo } : {}) } });
    }
    /* Se siembra lo último que se supo: reiniciar el receptor con la batería ya baja, con el motor
       ya apagado o con el vehículo ya adentro de una geocerca no es una novedad y no avisa. */
    const m = mem(imei);
    vigia.sembrar(imei, e.voltaje); vigia.sembrarLados(imei, e.lados);
    if (m.ladosTxt === null) m.ladosTxt = JSON.stringify(vigia.lados(imei));
    if (e.encendido !== null && !motor.has(imei)) motor.set(imei, e.encendido);
    if (!m.ultPos && e.cuando && e.lat !== null && e.lon !== null) m.ultPos = { lat: e.lat, lon: e.lon, cuando: e.cuando.getTime() };
    if (e.sinReporteDesde) m.callado = true;
    return e;
}

/** El motor cambió de estado: se anota desde cuándo está así (el diagnóstico del cable ACC sale de acá). */
const cambioDeMotor = (imei, encendido) => (encendido === undefined || encendido === null || motor.get(imei) === encendido ? {} : { encendidoDesde: new Date() });

async function alLatido(imei, e) {
    const cambio = cambioDeMotor(imei, e.encendido);
    motor.set(imei, e.encendido);
    await prisma.gpsEquipo.update({
        where: { imei },
        data: { encendido: e.encendido, bateria: e.bateria, senal: e.senal, cortado: e.cortado, ultimoLatido: new Date(), ...cambio },
    }).catch(() => {});
}

/**
 * Una posición. Devuelve qué se hizo con ella:
 *   «nada»   — sin satélites, o con una hora que no puede ser: no se guarda.
 *   «pobre»  — pocos satélites: queda guardada, no mueve el mapa.
 *   «vieja»  — más vieja que la última que se tiene (llegó desordenada): queda guardada.
 *   «salto»  — exigiría 250 km/h: queda guardada, no mueve el mapa (`primera` = recién empieza).
 *   «buena»  — mueve el punto y puede cruzar geocercas.
 */
async function alPosicion(imei, m, aceptado) {
    const p = m.gps;
    const tocar = () => prisma.gpsEquipo.update({ where: { imei }, data: { ultimoLatido: new Date() } }).catch(() => {});
    /* Sin satélites, o en el punto (0,0), no es una posición: es un equipo diciendo que no sabe. */
    if (!p || !p.conFix || !p.fecha || (p.lat === 0 && p.lon === 0) || !evs.horaCreible(p.fecha)) { await tocar(); return { que: "nada" }; }
    /* El historial es sólo de los aceptados: uno que se presentó solo guarda dónde está (para que
       quien lo acepte vea qué es) y nada más. */
    if (aceptado) await prisma.gpsPosicion.create({
        data: {
            imei, cuando: p.fecha, lat: p.lat, lon: p.lon, velocidad: p.velocidad, rumbo: p.rumbo,
            /* El contacto (ACC): estos equipos lo informan en el latido, no en cada posición. Se le
               pone a la posición lo último que se supo, para que al recorrer un trayecto se vea. */
            satelites: p.satelites, encendido: m.encendido ?? (motor.has(imei) ? motor.get(imei) : null), alarma: m.tipo === "alarma" ? m.alarma : null,
        },
    });
    /* Con pocos satélites la posición queda GUARDADA (es el dato crudo, y dice con cuántos
       satélites llegó) pero no mueve el punto del mapa: la noche del 20/11 el auto estacionado
       mandó 364 de éstas, saltando hasta 400 metros alrededor de su lugar. */
    if (p.satelites < evs.SATS_MIN) { await tocar(); return { que: "pobre" }; }
    const mm = mem(imei), actual = { lat: p.lat, lon: p.lon, cuando: p.fecha.getTime() };
    /* Más vieja que la que ya se tiene: antes pisaba la última posición y el auto retrocedía. */
    if (mm.ultPos && actual.cuando <= mm.ultPos.cuando) { await tocar(); return { que: "vieja" }; }
    if (evs.esSaltoImposible(mm.ultPos, actual)) {
        /* Tres seguidas que se acompañan entre sí: el que estaba mal era el punto anterior. */
        const sigue = mm.candidato && !evs.esSaltoImposible(mm.candidato, actual);
        mm.candidato = { ...actual, cuenta: sigue ? mm.candidato.cuenta + 1 : 1 };
        if (mm.candidato.cuenta < 3) { const primera = !mm.saltando; mm.saltando = true; await tocar(); return { que: "salto", primera }; }
    }
    mm.candidato = null; mm.saltando = false; mm.ultPos = actual;
    const tarde = evs.atrasoDe(p.fecha);
    const cambio = cambioDeMotor(imei, m.encendido);
    if (m.encendido !== undefined) motor.set(imei, m.encendido);
    const e = await prisma.gpsEquipo.update({
        where: { imei },
        data: {
            lat: p.lat, lon: p.lon, velocidad: p.velocidad, rumbo: p.rumbo, cuando: p.fecha, ultimoLatido: new Date(),
            ...(m.encendido !== undefined ? { encendido: m.encendido } : {}), ...cambio,
        },
    }).catch(() => null);
    /* Sólo los dados de alta viajan a las pantallas: uno que se presentó solo no es de nadie. */
    if (e && e.deviceId) emitir("gps_posicion", { imei, lat: p.lat, lon: p.lon, velocidad: p.velocidad, rumbo: p.rumbo, cuando: p.fecha.toISOString(), tarde });
    return { que: "buena" };
}

/**
 * Un reporte con posición, del protocolo que sea: se guarda, y si es buena se la mira contra las
 * geocercas y contra «se mueve con el motor apagado». `m.gps` tiene la misma forma en GT06 y en
 * Teltonika ({ fecha, lat, lon, velocidad, rumbo, satelites, conFix }).
 */
async function alReporte(imei, m, aceptado) {
    const r = await alPosicion(imei, m, aceptado);
    const hora = m.gps && m.gps.fecha ? m.gps.fecha : null;
    if (r.que === "salto" && r.primera) await alEvento(imei, "GPS_SALTO", m.gps, "Apareció a kilómetros de donde estaba hace instantes", null, hora);
    /* Las geocercas y el «se mueve con el motor apagado» sólo miran posiciones buenas: con las
       otras, un auto quieto cruza cercas y «se traslada» solo. Y se juzgan con la hora DEL
       EQUIPO: una tanda atrasada se recorre en su orden y a su tiempo, no toda «ahora». */
    if (r.que === "buena") {
        const sabido = motor.has(imei) ? motor.get(imei) : null;
        const t = vigia.alMoverse(imei, { conFix: m.gps.conFix, velocidad: m.gps.velocidad, encendido: sabido }, hora.getTime());
        if (t) await alEvento(imei, t, m.gps, `${m.gps.velocidad} km/h`, null, hora);
        /* La hora con que se lee el horario de una geocerca es la de la posición, no la de ahora:
           una tanda atrasada cruza cada cerca a la hora en que de verdad la cruzó. */
        for (const c of vigia.alUbicarse(imei, geocercas, { ...m.gps, fecha: hora })) await alEvento(imei, c.tipo, m.gps, c.geocerca.nombre, { geocercaId: c.geocerca.id }, hora);
        /* De qué lado quedó de cada geocerca, a la base si cambió. */
        const mm = mem(imei), txt = JSON.stringify(vigia.lados(imei));
        if (txt !== mm.ladosTxt) { mm.ladosTxt = txt; await prisma.gpsEquipo.update({ where: { imei }, data: { lados: JSON.parse(txt) } }).catch(() => {}); }
    }
    return r;
}

/** Un voltaje nuevo de la alimentación, del protocolo que sea. */
async function alVoltaje(imei, v) {
    await prisma.gpsEquipo.update({ where: { imei }, data: { voltaje: v } }).catch(() => {});
    const t = vigia.alVoltaje(imei, v);
    if (t) await alEvento(imei, t, null, `${v.toFixed(1).replace(".", ",")} V`);
}

/**
 * Lo que llega de un Teltonika. Devuelve `false` si hay que cortar la conexión. `c` es el estado
 * de la conexión ({ imei, aceptado, buf }), que es el mismo objeto que usa la rama de GT06.
 */
async function procesarTeltonika(s, c, ip) {
    if (!c.imei) {
        const imei = tk.imeiDeSaludo(c.buf);
        c.buf = c.buf.subarray(17);
        const e = await alPresentarse(imei, ip, "TELTONIKA");
        if (typeof e === "string") { cuenta.rechazados++; log(ip, `saludo de ${imei} rechazado (${e})`); falta(ip, `IMEI rechazado: ${e}`); s.write(tk.acuseSaludo(false)); return false; }
        c.imei = imei; s.imei = imei; c.aceptado = !!e.deviceId; c.miradoAl = Date.now();
        const viejo = enLinea.get(imei);
        if (viejo && viejo !== s) viejo.destroy();
        enLinea.set(imei, s);
        s.write(tk.acuseSaludo(true));
        log(imei, "se presentó desde", ip, "(Teltonika)");
        await oyo(imei);
    }
    const { paquetes, resto, roto } = tk.partir(c.buf);
    c.buf = resto;
    if (roto) { log(c.imei, "paquete Teltonika que no se puede leer: se corta"); return false; }
    for (const p of paquetes) {
        cuenta.tramas++; cuenta.ultimaTrama = Date.now();
        if (CRUDO) log(c.imei, "teltonika", p.toString("hex"));
        const m = tk.leer(p);
        /* Sin acuse: el equipo lo va a mandar de nuevo, que es lo que se quiere si no se pudo leer. */
        if (!m.ok) { log(c.imei, "paquete Teltonika ilegible:", m.error); continue; }
        if (!c.aceptado && Date.now() - c.miradoAl > 30_000) {
            c.miradoAl = Date.now();
            c.aceptado = !!(await prisma.gpsEquipo.findUnique({ where: { imei: c.imei }, select: { deviceId: true } }).catch(() => null))?.deviceId;
        }
        await oyo(c.imei);
        for (const r of m.registros) {
            try {
                /* Lo que en GT06 viene en el latido, acá viene en cada registro. */
                const estado = { ...(r.senal !== undefined ? { senal: r.senal } : {}), ...(r.cortado !== undefined ? { cortado: r.cortado } : {}) };
                if (Object.keys(estado).length) await prisma.gpsEquipo.update({ where: { imei: c.imei }, data: estado }).catch(() => {});
                await alReporte(c.imei, { tipo: "posicion", gps: r.gps, ...(r.encendido !== undefined ? { encendido: r.encendido } : {}) }, c.aceptado);
                if (r.voltaje !== undefined) await alVoltaje(c.imei, r.voltaje);
                const tipo = tk.eventoDe(r);
                if (tipo) await alEvento(c.imei, tipo, r.gps, tipo === "GPS_VELOCIDAD" ? `${r.gps.velocidad} km/h` : null, null, r.gps.fecha);
            } catch (e) { log(c.imei, "error guardando:", e.message); }
        }
        /* El acuse dice CUÁNTOS registros se aceptaron: con otro número el equipo repite el paquete. */
        if (!s.destroyed) s.write(tk.acusePaquete(m.registros.length));
    }
    return true;
}

const servidor = net.createServer((s) => {
    const ip = (s.remoteAddress || "?").replace(/^::ffff:/, "");
    /* Los topes: sin lugar, o demasiadas conexiones mudas desde la misma IP, no se atiende. */
    let mudos = 0, mudosDeEstaIp = 0;
    for (const x of abiertos) if (!x.imei) { mudos++; if (x.ip === ip) mudosDeEstaIp++; }
    if (abiertos.size >= SOCKETS_MAX || mudos >= SIN_LOGIN_MAX || mudosDeEstaIp >= SIN_LOGIN_POR_IP) { cuenta.rechazados++; s.destroy(); return; }
    s.ip = ip; s.imei = null; s.protocolo = "GT06"; abiertos.add(s);
    /** Si resultó ser un Teltonika: el estado de su conexión (ver procesarTeltonika). */
    let telto = null;
    let buf = Buffer.alloc(0);
    let imei = null;
    /** Dado de alta en Dispositivos. Se vuelve a mirar cada tanto: lo pueden aceptar estando conectado. */
    let aceptado = false, miradoAl = 0;
    let enElMinuto = 0, minuto = 0;
    const sinLogin = setTimeout(() => { if (!imei) { falta(ip, "no se presentó"); s.destroy(); } }, castigada(ip) ? SIN_LOGIN_CASTIGADA_MS : SIN_LOGIN_MS);
    s.setTimeout(MUDO_MS, () => s.destroy());

    /* Lo que llega por una conexión se procesa EN ORDEN, un trozo después del otro. Antes cada
       trozo arrancaba su propio proceso y dos posiciones seguidas podían terminar de guardarse al
       revés; ahora que una geocerca pide dos confirmaciones y una tanda atrasada se recorre a su
       tiempo, el orden es parte del resultado. */
    let cola = Promise.resolve(), enEspera = 0;
    s.on("data", (trozo) => {
        /* Si entra más rápido de lo que se procesa, no se acumula sin límite: se corta. */
        enEspera += trozo.length;
        if (enEspera > 256 * 1024) { falta(ip, "inundación"); s.destroy(); return; }
        cola = cola.then(() => procesar(trozo)).catch((e) => log(imei || ip, "error procesando:", e && e.message)).finally(() => { enEspera -= trozo.length; });
    });
    async function procesar(trozo) {
        if (s.destroyed) return;
        /* ¿Quién habla? Un Teltonika saluda con 00 0F y quince dígitos; todo lo demás sigue por
           GT06, que es quien sabe decir que algo no es una trama. Una vez que se sabe que es un
           Teltonika, lo suyo va a SU buffer y por su camino. */
        if (telto) telto.buf = Buffer.concat([telto.buf, trozo]);
        else {
            buf = Buffer.concat([buf, trozo]);
            if (!imei) {
                const es = tk.esSaludo(buf);
                if (es === null) return;                            // todavía no llegó el saludo entero
                if (es) { telto = { imei: null, aceptado: false, miradoAl: 0, buf }; s.protocolo = "TELTONIKA"; buf = Buffer.alloc(0); }
            }
        }
        if (telto) {
            const sigue = await procesarTeltonika(s, telto, ip);
            if (telto.imei && !imei) { imei = telto.imei; clearTimeout(sinLogin); }
            if (!sigue) s.destroy();
            return;
        }
        const { tramas, resto } = g.partir(buf);
        buf = resto;
        if (!tramas.length && buf.length > BASURA_MAX) { falta(ip, "basura"); s.destroy(); return; }
        /* Antes de presentarse, lo primero que manda un rastreador es su login. Si llegó otra
           cosa (un escáner probando HTTP, TLS, lo que sea) no hay por qué esperar los 30
           segundos: se corta y cuenta como falta. Un login que llegó partido en dos queda en
           `buf` empezando con 78 78, y a ése sí se lo espera. */
        const empezoUnaTrama = buf.length >= 2 && (buf[0] === 0x78 || buf[0] === 0x79) && buf[1] === buf[0];
        if (!imei && !tramas.length && trozo.length >= 8 && !empezoUnaTrama) { falta(ip, "no habla el protocolo"); s.destroy(); return; }
        const esteMinuto = Math.floor(Date.now() / 60_000);
        if (esteMinuto !== minuto) { minuto = esteMinuto; enElMinuto = 0; }
        enElMinuto += tramas.length;
        if (enElMinuto > TRAMAS_POR_MIN_MAX) { log(imei || ip, `más de ${TRAMAS_POR_MIN_MAX} tramas por minuto: se corta`); falta(ip, "inundación"); s.destroy(); return; }

        for (const t of tramas) {
            const m = g.leer(t);
            if (!m.ok) { log(ip, "trama con CRC roto, se ignora"); if (!imei) falta(ip, "CRC roto"); continue; }
            cuenta.tramas++; cuenta.ultimaTrama = Date.now();
            if (CRUDO || !DE_RUTINA.has(m.tipo)) log(imei || ip, m.tipo, t.toString("hex"));
            try {
                if (m.tipo === "login") {
                    if (!/^\d{15}$/.test(m.imei || "")) { falta(ip, "IMEI mal formado"); s.destroy(); return; }
                    const e = await alPresentarse(m.imei, ip);
                    if (typeof e === "string") {
                        /* Sin acuse: para el equipo es como si acá no hubiera nadie. */
                        cuenta.rechazados++; log(ip, `login de ${m.imei} rechazado (${e})`); falta(ip, `IMEI rechazado: ${e}`); s.destroy(); return;
                    }
                    imei = m.imei; s.imei = imei; aceptado = !!e.deviceId; miradoAl = Date.now();
                    clearTimeout(sinLogin);
                    const viejo = enLinea.get(imei);
                    if (viejo && viejo !== s) viejo.destroy();   // el mismo equipo reconectó: la vieja está muerta
                    enLinea.set(imei, s);
                    log(imei, "se presentó desde", ip);
                    await oyo(imei);
                } else if (!imei) {
                    continue;                                     // nadie habla antes de presentarse
                } else {
                    if (!aceptado && Date.now() - miradoAl > 30_000) {
                        miradoAl = Date.now();
                        aceptado = !!(await prisma.gpsEquipo.findUnique({ where: { imei }, select: { deviceId: true } }).catch(() => null))?.deviceId;
                    }
                    await oyo(imei);
                    if (m.tipo === "estado") {
                        await alLatido(imei, m.estado);
                        await alEvento(imei, evs.eventoDeAlarma(m.estado.alarma), null);
                    } else if (m.tipo === "posicion" || m.tipo === "alarma") {
                        const r = await alReporte(imei, m, aceptado);
                        const hora = m.gps && m.gps.fecha ? m.gps.fecha : null;
                        if (m.tipo === "alarma") { const tipoA = evs.eventoDeAlarma(m.alarma) || "GPS_OTRA"; await alEvento(imei, tipoA, m.gps, tipoA === "GPS_OTRA" ? g.nombreAlarma(m.alarma) : null, null, hora); }
                        else if (r.que === "nada") log(imei, "posición sin satélites, no se guarda");
                    } else if (m.tipo === "respuesta") {
                        alResponder(imei, m);
                        continue;
                    } else if (m.tipo === "info") {
                        if (m.iccid) await prisma.gpsEquipo.update({ where: { imei }, data: { iccid: m.iccid } }).catch(() => {});
                        if (m.voltaje !== undefined) await alVoltaje(imei, m.voltaje);
                        continue;
                    } else if (m.tipo === "hora") {
                        s.write(g.acuseHora(m.serie));
                        continue;
                    }
                }
            } catch (e) { log(imei || ip, "error guardando:", e.message); }
            /* Lo desconocido también se acusa: el acuse genérico no hace daño y evita que un
               mensaje que no entendemos tire abajo un enlace que anda. */
            if ((g.pideAcuse(m) || m.tipo === "desconocido") && !s.destroyed) s.write(g.acuse(m.proto, m.serie));
        }
    }
    s.on("close", () => { clearTimeout(sinLogin); abiertos.delete(s); if (imei && enLinea.get(imei) === s) { enLinea.delete(imei); log(imei, "se desconectó"); } });
    s.on("error", () => {});
});

servidor.listen(PUERTO, "0.0.0.0", () => log(`gps-receiver escuchando en ${PUERTO} (GT06 y Teltonika)`));
process.on("SIGTERM", async () => { servidor.close(); await prisma.$disconnect(); process.exit(0); });
