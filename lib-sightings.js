/**
 * Avistamientos de matriculas (recorrido del vehiculo dentro del barrio).
 *
 * Un avistamiento es "esta patente fue vista por esta camara, en este momento,
 * en estas coordenadas". Lo alimentan dos fuentes:
 *   - las camaras LPR nativas, cuando server.js registra el evento de acceso
 *   - la pasarela de camaras comunes, que manda el frame a Omni-LPR
 *
 * Las coordenadas se copian al avistamiento en el momento de guardarlo: si
 * despues alguien mueve la camara en el mapa, el historial no se deforma.
 */
const { PrismaClient } = require("@prisma/client");
const prisma = global.__omniPrisma || new PrismaClient();
if (!global.__omniPrisma) global.__omniPrisma = prisma;

let cacheMapa = { ts: 0, camaras: new Map() };

/** Coordenadas de las camaras, del mapa del barrio. Se cachean 60s. */
async function coordenadasDeCamaras() {
    if (Date.now() - cacheMapa.ts < 60000) return cacheMapa.camaras;
    const m = new Map();
    try {
        const row = await prisma.setting.findUnique({ where: { key: "BARRIO_MAP" } });
        if (row?.value) {
            const d = JSON.parse(row.value);
            for (const c of d.cameras || []) {
                if (c.deviceId && c.lat != null && c.lng != null) m.set(c.deviceId, { lat: c.lat, lng: c.lng });
            }
        }
    } catch { }
    cacheMapa = { ts: Date.now(), camaras: m };
    return m;
}

function normalizarPatente(p) {
    return String(p || "").toUpperCase().replace(/[^A-Z0-9]/g, "").trim();
}

/** Matriculas que no son lecturas reales y no deben ensuciar el recorrido. */
const NO_VALIDAS = new Set(["", "NOLEIDA", "NO_LEIDA", "UNKNOWN", "SP", "SL", "DESCONOCIDO"]);

/**
 * Guarda un avistamiento. Nunca lanza: si falla, deja un aviso en el log y sigue,
 * porque esto corre al costado del flujo que abre la barrera.
 */
async function registrarAvistamiento({
    plate, deviceId, cameraName, timestamp, source = "LPR",
    eventType, decision, confidence, snapshotUrl, accessEventId, lat, lng,
}) {
    try {
        const patente = normalizarPatente(plate);
        if (NO_VALIDAS.has(patente) || patente.length < 4) return null;

        if ((lat == null || lng == null) && deviceId) {
            const coords = await coordenadasDeCamaras();
            const c = coords.get(deviceId);
            if (c) { lat = c.lat; lng = c.lng; }
        }

        return await prisma.plateSighting.create({
            data: {
                plate: patente,
                deviceId: deviceId || null,
                cameraName: cameraName || null,
                lat: lat ?? null,
                lng: lng ?? null,
                timestamp: timestamp ? new Date(timestamp) : new Date(),
                source,
                eventType: eventType || null,
                decision: decision || null,
                confidence: confidence ?? null,
                snapshotUrl: snapshotUrl || null,
                accessEventId: accessEventId || null,
            },
        });
    } catch (e) {
        if (e?.code === "P2002") return null; // ya estaba registrado ese evento
        console.warn("[Avistamientos] no se pudo guardar:", e?.message || e);
        return null;
    }
}

/** Recorrido de una patente en una ventana de tiempo, ordenado cronologicamente. */
async function recorridoDePatente(plate, desde, hasta, limite = 500) {
    const patente = normalizarPatente(plate);
    if (!patente) return [];
    return prisma.plateSighting.findMany({
        where: {
            plate: patente,
            timestamp: { gte: desde, lte: hasta },
        },
        orderBy: { timestamp: "asc" },
        take: limite,
    });
}

module.exports = { registrarAvistamiento, recorridoDePatente, normalizarPatente };
