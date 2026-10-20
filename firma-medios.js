/**
 * Firma de enlaces a medios (fotos, clips, grabaciones) para quien los pide SIN sesión.
 *
 * Por qué (18/10, deuda de entrega, con OK de Nico): /api/files, /api/snapshot, /api/nvr y
 * /api/clip eran públicas — cualquiera con un enlace veía las capturas del barrio y pedía
 * grabaciones al NVR. Ahora piden sesión (o ser un pedido interno, o una pantalla o guardia
 * identificados) salvo que el enlace venga FIRMADO: así siguen andando los que se mandan afuera
 * (la foto que Telegram baja de la URL, la del correo, la que WAHA baja si falla el envío en
 * base64). La firma vale para ese camino exacto y vence.
 *
 * Hay dos copias del mismo cálculo: ésta (procesos en JS: dispatch-worker, waha-handler) y
 * src/lib/firma-medios.ts (Next: el middleware y las rutas). Si cambia una, cambia la otra.
 */
const crypto = require("crypto");

const PARAM = "f";
/** 30 días: un correo se abre días después; Telegram la baja en el momento. */
const DURA_SEG = 30 * 86400;
const secreto = () => process.env.MEDIOS_SECRETO || process.env.JWT_SECRET || "";

function mac(ruta, exp) {
    return crypto.createHmac("sha256", secreto()).update(`${ruta}|${exp}`).digest("base64url").slice(0, 22);
}

/** Agrega la firma a una URL (absoluta o relativa). Sin secreto la devuelve igual (y no va a abrir). */
function firmarUrl(url, segundos = DURA_SEG) {
    if (!url || !secreto()) return url;
    try {
        const u = new URL(url, "http://x");
        const exp = Math.floor(Date.now() / 1000) + segundos;
        u.searchParams.set(PARAM, `${exp}.${mac(u.pathname, exp)}`);
        return /^https?:\/\//i.test(url) ? u.toString() : u.pathname + u.search;
    } catch { return url; }
}

module.exports = { firmarUrl, PARAM };
