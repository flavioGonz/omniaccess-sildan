/**
 * SIA DC-09 (ANSI/SIA DC-09-2013 / 2021): el protocolo con el que una central de alarma le manda
 * sus eventos a un receptor por IP. Este módulo es PURO — sin base, sin red — y lo usan tres cosas:
 * el receptor (alarm-receiver.js), el simulador (scripts/simular-central.js) y las pruebas. Así lo
 * que arma el simulador es exactamente lo que el receptor espera, y lo que se prueba es lo que corre.
 *
 * La trama:
 *
 *   <LF> CRC(4 hex) 0LLL(largo, 3 hex) "ID" SEQ(4) [Rrcvr] Lline #cuenta [datos] [extendidos] _hora <CR>
 *
 *  · el CRC (CRC-16 ARC: polinomio 0x8005 reflejado, valor inicial 0) y el largo se calculan sobre
 *    lo que va desde la primera comilla del ID hasta el final de la hora, sin el CR;
 *  · ID: SIA-DCS o ADM-CID (Contact ID) con los eventos; NULL es la supervisión («sigo vivo»);
 *    con asterisco adelante (*SIA-DCS) el mensaje viene cifrado;
 *  · la hora va en GMT: _HH:MM:SS,MM-DD-YYYY. En los cifrados es obligatoria (es lo que impide
 *    reenviar un mensaje grabado).
 *
 * El cifrado: AES-CBC (128, 192 o 256) con vector en cero y sin relleno PKCS. Se cifra desde
 * después del «[» hasta el final de la hora: unos caracteres al azar de relleno, un «|», y el resto
 * («#cuenta|Nri1/BA003]_hora»). El relleno completa un múltiplo de 16. El resultado va en hex.
 *
 * Las respuestas:
 *  · ACK: mismo SEQ, receptor, línea y cuenta, datos vacíos; cifrado si el mensaje vino cifrado.
 *  · NAK: con la hora del receptor (así la central corrige su reloj), cuenta «A0», nunca cifrado.
 *  · DUH: «no entiendo este ID».
 */
"use strict";
const crypto = require("crypto");

// ── CRC-16 ARC ────────────────────────────────────────────────────────────────────────────────
const TABLA_CRC = (() => {
    const t = new Uint16Array(256);
    for (let i = 0; i < 256; i++) {
        let c = i;
        for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xa001 : c >>> 1;
        t[i] = c;
    }
    return t;
})();
function crc16(str) {
    let crc = 0;
    const b = Buffer.from(str, "latin1");
    for (const x of b) crc = (crc >>> 8) ^ TABLA_CRC[(crc ^ x) & 0xff];
    return crc & 0xffff;
}
const hex4 = (n) => n.toString(16).toUpperCase().padStart(4, "0");

// ── Hora ─────────────────────────────────────────────────────────────────────────────────────
const dos = (n) => String(n).padStart(2, "0");
/** «_HH:MM:SS,MM-DD-YYYY» en GMT. */
function horaDc09(d = new Date()) {
    return `_${dos(d.getUTCHours())}:${dos(d.getUTCMinutes())}:${dos(d.getUTCSeconds())},${dos(d.getUTCMonth() + 1)}-${dos(d.getUTCDate())}-${d.getUTCFullYear()}`;
}
function leerHora(s) {
    const m = /_(\d{2}):(\d{2}):(\d{2}),(\d{2})-(\d{2})-(\d{4})$/.exec(s || "");
    if (!m) return null;
    const t = Date.UTC(+m[6], +m[4] - 1, +m[5], +m[1], +m[2], +m[3]);
    return Number.isFinite(t) ? new Date(t) : null;
}

// ── Claves ───────────────────────────────────────────────────────────────────────────────────
/**
 * La clave como la escribe el instalador. Las centrales no se ponen de acuerdo: unas la toman como
 * texto (16/24/32 caracteres) y otras como hex (32/48/64 dígitos). Una clave hex de 32 dígitos es
 * las dos cosas a la vez (128 bits en hex o 256 en texto), así que se devuelven las dos y el
 * receptor se queda con la que descifra un mensaje con forma de mensaje.
 */
function clavesPosibles(clave) {
    const out = [];
    const c = String(clave || "").trim();
    if (/^[0-9a-f]+$/i.test(c) && [32, 48, 64].includes(c.length)) out.push({ modo: "hex", buf: Buffer.from(c, "hex") });
    if ([16, 24, 32].includes(Buffer.byteLength(c, "latin1"))) out.push({ modo: "texto", buf: Buffer.from(c, "latin1") });
    return out;
}
function claveDe(clave, modo) { return clavesPosibles(clave).find((k) => !modo || k.modo === modo) || null; }
const algoritmo = (buf) => `aes-${buf.length * 8}-cbc`;

const RELLENO = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
function cifrar(texto, buf) {
    // Relleno al azar + «|» + el texto, hasta un múltiplo de 16 (si ya lo es, igual va un bloque).
    let n = 16 - ((texto.length + 1) % 16);
    if (n === 16) n = 0;
    let pad = "";
    for (let i = 0; i < n; i++) pad += RELLENO[crypto.randomInt(RELLENO.length)];
    const c = crypto.createCipheriv(algoritmo(buf), buf, Buffer.alloc(16, 0));
    c.setAutoPadding(false);
    return Buffer.concat([c.update(Buffer.from(pad + "|" + texto, "latin1")), c.final()]).toString("hex").toUpperCase();
}
function descifrar(hex, buf) {
    if (!/^[0-9a-f]+$/i.test(hex) || hex.length % 32) return null;
    try {
        const d = crypto.createDecipheriv(algoritmo(buf), buf, Buffer.alloc(16, 0));
        d.setAutoPadding(false);
        const t = Buffer.concat([d.update(Buffer.from(hex, "hex")), d.final()]).toString("latin1");
        const i = t.indexOf("|");
        return i >= 0 ? t.slice(i + 1) : null;
    } catch { return null; }
}

// ── Armar ────────────────────────────────────────────────────────────────────────────────────
function envolver(cuerpo) {
    return `\n${hex4(crc16(cuerpo))}0${cuerpo.length.toString(16).toUpperCase().padStart(3, "0")}${cuerpo}\r`;
}
const seq4 = (s) => String(Math.max(0, Math.min(9999, Number(s) || 0))).padStart(4, "0");
/**
 * Una trama. `datos` es lo de adentro de los corchetes, SIN el «#cuenta|» (se agrega solo, salvo
 * en NULL/ACK, que van vacíos). `extendidos`: bloques [X…] ya armados, p. ej. ["XLAT-34.9"].
 */
function armar({ id, seq = 1, receptor = null, linea = "0", cuenta, datos = "", extendidos = [], clave = null, modoClave = null, hora = new Date(), conHora = true }) {
    const cifrado = !!clave;
    const idTxt = `${cifrado ? "*" : ""}${id}`;
    const cab = `"${idTxt}"${seq4(seq)}${receptor != null && receptor !== "" ? `R${receptor}` : ""}L${linea}#${cuenta}`;
    const adentro = datos ? `#${cuenta}|${datos}` : "";
    const resto = `${adentro}]${extendidos.map((x) => `[${x}]`).join("")}${conHora || cifrado ? horaDc09(hora) : ""}`;
    if (!cifrado) return envolver(`${cab}[${resto}`);
    const k = claveDe(clave, modoClave);
    if (!k) throw new Error("clave de cifrado inválida: 16, 24 o 32 caracteres, o 32, 48 o 64 dígitos hex");
    return envolver(`${cab}[${cifrar(resto, k.buf)}`);
}

/** La respuesta a un mensaje ya leído (`m` de leer()). */
function ack(m, { clave = null, modoClave = null, hora = new Date() } = {}) {
    const cab = `"${m.cifrado ? "*" : ""}ACK"${seq4(m.seq)}${m.receptor != null ? `R${m.receptor}` : ""}L${m.linea}#${m.cuenta}`;
    if (!m.cifrado) return envolver(`${cab}[]`);
    const k = claveDe(clave, modoClave || m.modoClave);
    if (!k) throw new Error("ACK cifrado sin clave");
    return envolver(`${cab}[${cifrar(`]${horaDc09(hora)}`, k.buf)}`);
}
function nak(hora = new Date()) { return envolver(`"NAK"0000R0L0A0[]${horaDc09(hora)}`); }
function duh(m) {
    const seq = m && m.seq != null ? m.seq : 0;
    const r = m && m.receptor != null ? m.receptor : "0";
    return envolver(`"DUH"${seq4(seq)}R${r}L${(m && m.linea) || "0"}#${(m && m.cuenta) || "0"}[]`);
}

// ── Leer ─────────────────────────────────────────────────────────────────────────────────────
const IDS = new Set(["SIA-DCS", "ADM-CID", "NULL", "ACK", "NAK", "DUH"]);
const LARGO_MAX = 1024;

/**
 * Separa las tramas de un búfer (TCP puede traer media o dos juntas). Devuelve las completas y lo
 * que sobra para la próxima lectura. Una trama empieza en LF y termina en CR.
 */
function separar(buf) {
    const s = typeof buf === "string" ? buf : buf.toString("latin1");
    const tramas = [];
    let i = 0;
    for (;;) {
        const ini = s.indexOf("\n", i);
        if (ini < 0) return { tramas, resto: "" };
        const fin = s.indexOf("\r", ini);
        if (fin < 0) return { tramas, resto: s.length - ini > LARGO_MAX * 2 ? "" : s.slice(ini) };
        tramas.push(s.slice(ini, fin + 1));
        i = fin + 1;
    }
}

/**
 * Lee una trama. Nunca tira: devuelve { ok:false, error, ... } con lo que se pudo leer, para que el
 * receptor decida NAK o DUH. `claveDeCuenta(cuenta)` da la clave de esa cuenta (o null).
 */
function leer(trama, claveDeCuenta = () => null) {
    const t = String(trama).replace(/^\n/, "").replace(/\r$/, "");
    if (t.length > LARGO_MAX) return { ok: false, error: "largo", respuesta: "NAK" };
    const m0 = /^([0-9A-Fa-f]{4})0([0-9A-Fa-f]{3})(".*)$/s.exec(t);
    if (!m0) return { ok: false, error: "forma", respuesta: "NAK" };
    const cuerpo = m0[3];
    if (parseInt(m0[2], 16) !== cuerpo.length) return { ok: false, error: "largo", respuesta: "NAK" };
    if (parseInt(m0[1], 16) !== crc16(cuerpo)) return { ok: false, error: "crc", respuesta: "NAK" };

    const m1 = /^"(\*?)([A-Z0-9-]+)"(\d{4})(?:R([0-9A-Fa-f]{1,6}))?L([0-9A-Fa-f]{1,6})#([0-9A-Fa-f]{3,16})\[(.*)$/s.exec(cuerpo);
    if (!m1) {
        const id = /^"\*?([^"]+)"/.exec(cuerpo);
        return { ok: false, error: id && !IDS.has(id[1]) ? "id" : "forma", respuesta: id && !IDS.has(id[1]) ? "DUH" : "NAK", id: id ? id[1] : null };
    }
    const [, ast, id, seq, receptor, linea, cuenta, despues] = m1;
    const m = { ok: true, cifrado: ast === "*", id, seq: Number(seq), receptor: receptor ?? null, linea, cuenta: cuenta.toUpperCase(), datos: "", extendidos: [], hora: null, modoClave: null };
    if (!IDS.has(id)) return { ...m, ok: false, error: "id", respuesta: "DUH" };

    let resto = despues;
    if (m.cifrado) {
        const clave = claveDeCuenta(m.cuenta);
        if (!clave) return { ...m, ok: false, error: "sin-clave", respuesta: "NAK" };
        let plano = null;
        for (const k of clavesPosibles(clave)) {
            const p = descifrar(resto, k.buf);
            // Con la clave equivocada sale basura; con la buena, algo con «]» y una hora válida.
            if (p != null && p.includes("]") && leerHora(p)) { plano = p; m.modoClave = k.modo; break; }
        }
        if (plano == null) return { ...m, ok: false, error: "descifrado", respuesta: "NAK" };
        resto = plano;
    }
    // resto = «datos]» «[X…]»* «_hora»?
    const fin = resto.indexOf("]");
    if (fin < 0) return { ...m, ok: false, error: "forma", respuesta: "NAK" };
    m.datos = resto.slice(0, fin);
    let cola = resto.slice(fin + 1);
    for (let x; (x = /^\[([^\]]*)\]/.exec(cola));) { m.extendidos.push(x[1]); cola = cola.slice(x[0].length); }
    m.hora = leerHora(cola);
    if (cola && !m.hora) return { ...m, ok: false, error: "hora", respuesta: "NAK" };
    if (m.cifrado && !m.hora) return { ...m, ok: false, error: "hora", respuesta: "NAK" };
    // Los datos empiezan con «#cuenta|»: se separa (la cuenta de adentro manda si difiere).
    // (el ejemplo de la norma trae «1234|NFA129», sin numeral: también se acepta)
    const d = /^#?([0-9A-Fa-f]{3,16})\|(.*)$/s.exec(m.datos);
    if (d) { m.cuentaDatos = d[1].toUpperCase(); m.datos = d[2]; }
    return m;
}

/** ¿La hora del mensaje está dentro de la ventana? (norma: +20/−40 s; se usa ±ventana). */
function enVentana(m, ventanaSeg = 40, ahora = Date.now()) {
    if (!m.hora) return !m.cifrado;
    return Math.abs(ahora - m.hora.getTime()) <= ventanaSeg * 1000;
}

module.exports = { crc16, horaDc09, leerHora, clavesPosibles, cifrar, descifrar, armar, ack, nak, duh, leer, separar, enVentana, LARGO_MAX };
