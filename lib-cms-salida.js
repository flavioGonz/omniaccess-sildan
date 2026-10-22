/**
 * La «salida a automatización» de un receptor de alarmas: lo que un receptor (un Sur-Gard, o el
 * convertidor IP de Paradox IPC10) le manda al software de monitoreo (el CMS) por TCP.
 *
 * Por qué existe (22/10, Nico: «tengo una receptora de Paradox para configurar el envío»): las
 * centrales Paradox con comunicador PCS/IP no hablan SIA DC-09; reportan a su IPC10, y el IPC10
 * le pasa los eventos al CMS en uno de tres formatos — Sur-Gard MLR2-DG (el de fábrica),
 * Ademco CID-TCP o Ademco 685. OmniAccess hace de CMS: escucha, confirma y traduce.
 *
 * Los tres son de la misma familia: una línea de texto por evento, con el Contact ID adentro, y
 * el CMS contesta ACK (0x06) a cada una. El receptor no manda la siguiente hasta recibirlo.
 *
 *   IPC10, MLR2-DG (real): RG AAAA 18 QXYZ GG xCCC                ej. «15 2989 18 E130 01 U020»
 *   Sur-Gard, Contact ID:  5 RR L s 18 AAAA Q XYZ GG CCC [DC4]     ej. «5011 181234E12101001»
 *   Sur-Gard, «sigo vivo»: 1 RR … @ … [DC4]
 *   Ademco 685:            [LF] … 18 AAAA Q XYZ GG CCC [CR]           (con o sin espacios)
 *
 * (Formato Sur-Gard: manual de integración de DSC/Sur-Gard. El de Paradox no publica la trama
 * exacta de MLR2-DG ni de los Ademco, así que el lector es TOLERANTE: busca el bloque «18 +
 * cuenta + calificador + evento + grupo + zona» donde esté, con o sin espacios, y se anota cada
 * trama cruda para ajustarlo con la primera real.)
 *
 * Q viene como letra — E (evento nuevo), R (restauración / cierre), P (anterior) — o como el dígito
 * del Contact ID original (1, 3, 6). Se devuelve en la forma que lee lib-dc09-codigos.traducirCid:
 * «1401 01 005».
 */
"use strict";

const DC4 = "\x14";
const ACK = "\x06";
const NAK = "\x15";
const LARGO_MAX = 512;
const Q_DIGITO = { E: "1", R: "3", P: "6", 1: "1", 3: "3", 6: "6" };

/** Corta lo recibido en tramas: terminan en DC4, CR o LF. Devuelve lo que quedó a medias. */
function separar(buf) {
    const tramas = [];
    let ini = 0;
    for (let i = 0; i < buf.length; i++) {
        const c = buf[i];
        if (c === DC4 || c === "\r" || c === "\n") {
            const t = buf.slice(ini, i).trim();
            if (t) tramas.push(t);
            ini = i + 1;
        }
    }
    const resto = buf.slice(ini);
    return { tramas, resto: resto.length > LARGO_MAX ? "" : resto };
}

/** El bloque Contact ID dentro de una trama: { cuenta, datos: «1401 01 005» } o null. */
function contactId(t) {
    const s = String(t).toUpperCase();
    // MLR2-DG del IPC10 de Paradox, tal como llegó la primera trama real (22/10, 172.26.20.19):
    //   «15 2989 18 E130 01 U020» = receptor+grupo · cuenta · 18 (Contact ID) · Q+evento · partición · zona
    // La cuenta va ANTES del 18 y la zona o usuario trae una letra adelante (U020). El propio
    // receptor manda sus eventos con «98» en vez de «18» («15 0076c4250f 98 R314 00 U000»).
    const dg = /^[0-9A-F]{1,4}\s+([0-9A-F]{3,16})\s+(?:18|98)\s+([ERP136])\s?(\d{3})\s+([0-9A-F]{2})\s+[A-Z]?([0-9A-F]{3})\b/.exec(s);
    if (dg) return { cuenta: dg[1], datos: `${Q_DIGITO[dg[2]]}${dg[3]} ${dg[4]} ${dg[5]}` };
    // Con espacios entre campos (Ademco 685 suele venir así): no hay ambigüedad.
    let m = /\b18\s+([0-9A-F]{3,10})\s+([ERP136])\s?(\d{3})\s+([0-9A-F]{2})\s+([0-9A-F]{3})\b/.exec(s);
    // Sur-Gard: el bloque empieza una palabra («5011 181234E…»). Buscarlo ahí primero evita
    // confundirse con un «18» del encabezado (receptor 18, línea 18).
    if (!m) m = /(?:^|\s)18([0-9A-F]{3,10}?)([ERP136])(\d{3})([0-9A-F]{2})([0-9A-F]{3})(?![0-9A-F])/.exec(s)
        || /(?:^|\s)18([0-9A-F]{3,10}?)([ERP136])(\d{3})([0-9A-F]{2})([0-9A-F]{3})/.exec(s);
    if (!m) {
        // Pegado (Sur-Gard: «181234E12101001»). Se prueba cada «18» y la cuenta más corta que
        // deje atrás calificador + 3 + 2 + 3: una cuenta no puede llevar E/R/P salvo en hexa, y
        // probando de la más corta a la más larga gana la lectura que cierra exacta.
        const sin = s.replace(/\s+/g, "");
        for (let i = sin.indexOf("18"); i >= 0; i = sin.indexOf("18", i + 1)) {
            const r = /^18([0-9A-F]{3,10}?)([ERP136])(\d{3})([0-9A-F]{2})([0-9A-F]{3})(?![0-9A-F])/.exec(sin.slice(i))
                || /^18([0-9A-F]{3,10}?)([ERP136])(\d{3})([0-9A-F]{2})([0-9A-F]{3})/.exec(sin.slice(i));
            if (r) { m = r; break; }
        }
    }
    if (!m) return null;
    return { cuenta: m[1], datos: `${Q_DIGITO[m[2]]}${m[3]} ${m[4]} ${m[5]}` };
}

/**
 * Una trama → { tipo: "vivo" } | { tipo: "evento", cuenta, datos, receptor } | { tipo: "ilegible" }.
 * `receptor` es lo que vino antes del bloque (protocolo, receptor, línea), sólo para el registro.
 */
function leer(trama) {
    const t = String(trama || "").replace(/[\x00-\x1f]/g, "").trim();
    if (!t) return { tipo: "vacia" };
    if (t.length > LARGO_MAX) return { tipo: "ilegible", error: "largo" };
    const cid = contactId(t);
    if (cid) return { tipo: "evento", ...cid };
    // Sur-Gard: «1RR…@…» es el latido. Ademco 685 manda líneas sin «18»: también se toman por latido.
    if (t.includes("@") || /^[0-9A-F\s]{1,16}$/i.test(t)) return { tipo: "vivo" };
    return { tipo: "ilegible", error: "forma" };
}

module.exports = { separar, leer, contactId, ACK, NAK, DC4, LARGO_MAX };
