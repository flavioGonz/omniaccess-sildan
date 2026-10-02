const { XMLParser } = require("fast-xml-parser");
const { uploadToS3 } = require("../lib-s3");
const { formatEventDate, sanitizeName, generateId } = require("./shared");

// Por qué un módulo aparte y no otra rama más adentro del monolito de server.js:
// un cruce de línea no es una matrícula ni un rostro, y meterlo entre medio de esa
// lógica de ~1500 líneas la haría más difícil de leer y de arreglar. Toda la
// intrusión vive acá; server.js sólo despacha hacia este handler y no crece.

// Tipos de evento AcuSense/Smart de Hikvision que nos interesan (en minúscula, como
// llegan por alertStream/httpHost). Se comparan con includes() porque el firmware a
// veces antepone un prefijo. No hardcodeamos el string suelto: viven acá con su porqué.
const EVENTO_LINEA = "linedetection";      // cruce de línea
const EVENTO_ZONA = "fielddetection";      // intrusión en zona (permanencia)
const EVENTO_ENTRA_ZONA = "regionentrance"; // entrada a zona
const EVENTO_SALE_ZONA = "regionexiting";  // salida de zona (algunos firmwares: regionexit)

// Nuestros dos tipos internos, que es lo que guarda y muestra OmniAccess.
const TIPO_LINEA = "line";
const TIPO_ZONA = "field";

/**
 * ¿Este eventType es de intrusión? Lo usa server.js para decidir si despacha acá.
 * @param {string} eventType
 */
function esEventoIntrusion(eventType) {
    const et = (eventType || "").toLowerCase();
    return et.includes(EVENTO_LINEA) || et.includes(EVENTO_ZONA) ||
        et.includes(EVENTO_ENTRA_ZONA) || et.includes(EVENTO_SALE_ZONA);
}

// Del eventType saco el tipo interno y, si la cámara lo informa, el sentido.
function clasificar(eventType) {
    const et = (eventType || "").toLowerCase();
    if (et.includes(EVENTO_LINEA)) return { tipo: TIPO_LINEA, sentido: null };
    if (et.includes(EVENTO_ENTRA_ZONA)) return { tipo: TIPO_ZONA, sentido: "in" };
    if (et.includes(EVENTO_SALE_ZONA)) return { tipo: TIPO_ZONA, sentido: "out" };
    if (et.includes(EVENTO_ZONA)) return { tipo: TIPO_ZONA, sentido: null };
    return { tipo: TIPO_ZONA, sentido: null };
}

const normalizeMac = (m) => (m ? m.replace(/[:\-\s]/g, "").toUpperCase() : null);

/**
 * Procesa un evento de intrusión ya identificado por server.js.
 * @param {Object} p
 * @param {Object} p.xmlData      XML ya parseado (por si server.js no pasó eventAlert)
 * @param {Object} p.eventAlert   El EventNotificationAlert
 * @param {string} p.eventType
 * @param {string} p.macAddress
 * @param {string} p.ipAddress
 * @param {Array}  p.images       imágenes del multipart (si vinieron)
 * @param {Object} p.req
 * @param {Object} p.res
 * @param {string} p.logPrefix
 * @param {Object} p.deps         { prisma, io, fetchCameraSnapshot }
 */
async function handleIntrusionEvent(p) {
    const { eventAlert, eventType, macAddress, ipAddress, images, req, res, logPrefix, deps } = p;
    const { prisma, io, fetchCameraSnapshot } = deps;

    try {
        // --- Ubicar la cámara. A diferencia del acceso, NO adoptamos una cámara nueva:
        // la intrusión sólo actúa sobre cámaras conocidas y habilitadas a propósito. ---
        let device = null;
        const macLimpia = normalizeMac(macAddress);
        if (macLimpia) {
            const todas = await prisma.device.findMany();
            device = todas.find((d) => normalizeMac(d.mac) === macLimpia) || null;
        }
        if (!device && ipAddress) {
            device = await prisma.device.findFirst({ where: { ip: ipAddress } });
        }
        // Último recurso: la IP de origen del socket (la cámara que POSTeó).
        if (!device && req?.socket?.remoteAddress) {
            const ipSock = req.socket.remoteAddress.replace(/^::ffff:/, "");
            device = await prisma.device.findFirst({ where: { ip: ipSock } });
        }

        // Cámara desconocida o con intrusión apagada: 200 y afuera. No ensuciamos la
        // base con ruido de cámaras que no pidieron participar (es un requisito del spec).
        if (!device || device.intrusionEnabled !== true) {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ status: "ignored", reason: device ? "intrusion disabled" : "unknown device" }));
            return;
        }

        const { tipo, sentido } = clasificar(eventType);

        // Región que disparó, si la cámara la informa (puede faltar según firmware).
        const region = eventAlert?.detectionRegionList?.detectionRegionEntry?.regionID ||
            eventAlert?.DetectionRegionList?.DetectionRegionEntry?.regionID ||
            eventAlert?.regionID ||
            eventAlert?.channelID ||
            null;

        // Hora: la de la cámara si vino, si no la de ahora.
        let cuando = new Date();
        const dt = eventAlert?.dateTime;
        if (dt) { try { cuando = new Date(dt); } catch { cuando = new Date(); } }

        // --- Foto del momento: la que mandó la cámara, o una captura por ISAPI. ---
        let snapshotPath = null;
        let buf = null;
        if (images && images.length > 0) {
            images.sort((a, b) => b.size - a.size); // la más grande = escena completa
            buf = images[0].buffer;
        } else {
            try { buf = await fetchCameraSnapshot(device); } catch (e) {
                console.warn(`${logPrefix} [Intrusión] snapshot ISAPI falló: ${e.message}`);
            }
        }
        if (buf) {
            try {
                const nombre = `hik-intrusion-${sanitizeName(device.name)}-${tipo}-${formatEventDate(cuando)}-${generateId()}.jpg`;
                // Reusa el mismo bucket que las lecturas: no inventamos infra nueva.
                snapshotPath = await uploadToS3(buf, nombre, "image/jpeg", "lpr");
            } catch (e) {
                console.error(`${logPrefix} [Intrusión] subida de snapshot falló: ${e.message}`);
            }
        }

        const detalle = `Intrusión ${tipo === TIPO_LINEA ? "cruce de línea" : "zona"}` +
            `${region != null ? ` · región ${region}` : ""}` +
            `${sentido ? ` · ${sentido === "in" ? "entrada" : sentido === "out" ? "salida" : sentido}` : ""}`;

        const evento = await prisma.intrusionEvent.create({
            data: {
                deviceId: device.id,
                type: tipo,
                regionId: region != null ? String(region) : null,
                direction: sentido,
                timestamp: cuando,
                snapshotPath,
                details: detalle,
            },
        });

        // --- Aviso en vivo. Canal propio "intrusion_alert" para que monitor-lpr lo
        // distinga de una lectura, y "webhook-event" para la animación de topología
        // (mismo patrón que acceso). ---
        if (io) {
            io.emit("intrusion_alert", {
                ...evento,
                device: { id: device.id, name: device.name, location: device.location, direction: device.direction },
                deviceName: device.name,
            });
            io.emit("webhook-event", {
                type: "INTRUSION",
                device: device.name || "Unknown",
                timestamp: new Date().toISOString(),
            });
        }

        console.log(`${logPrefix} 🚨 [Intrusión] ${device.name}: ${detalle}`);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "processed", type: "intrusion", kind: tipo }));
    } catch (error) {
        console.error(`${logPrefix} [Intrusión] Error:`, error);
        res.writeHead(500);
        res.end(JSON.stringify({ error: "Internal Server Error" }));
    }
}

module.exports = { handleIntrusionEvent, esEventoIntrusion };
