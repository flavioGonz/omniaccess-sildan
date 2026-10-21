/**
 * Cifrar datos sensibles guardados en la base (claves AES de las centrales; después, las claves de
 * los equipos — punto 5). Gemelo de src/lib/cifrado-datos.ts: MISMO formato, para que lo que cifra
 * Next lo descifre un proceso de PM2 y al revés. Si se toca uno, se toca el otro.
 *
 *   enc:v1:<base64( iv 12 B | tag 16 B | cifrado )>   AES-256-GCM, clave = SHA-256(OMNI_CLAVE_DATOS)
 *
 * Un valor sin el prefijo se devuelve tal cual (compatibilidad con lo guardado en claro antes).
 * Sin OMNI_CLAVE_DATOS no se cifra ni se descifra: cifrar() tira, para no guardar en claro creyendo
 * que se cifró.
 */
"use strict";
const crypto = require("crypto");
const PREFIJO = "enc:v1:";
const clave = () => { const s = process.env.OMNI_CLAVE_DATOS || ""; return s ? crypto.createHash("sha256").update(s, "utf8").digest() : null; };
const estaCifrado = (v) => typeof v === "string" && v.startsWith(PREFIJO);
function cifrar(texto) {
    if (texto == null || texto === "") return texto;
    if (estaCifrado(texto)) return texto;
    const k = clave(); if (!k) throw new Error("Falta OMNI_CLAVE_DATOS en el .env: no se guarda una clave en claro");
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv("aes-256-gcm", k, iv);
    const ct = Buffer.concat([c.update(String(texto), "utf8"), c.final()]);
    return PREFIJO + Buffer.concat([iv, c.getAuthTag(), ct]).toString("base64");
}
function descifrar(valor) {
    if (!estaCifrado(valor)) return valor;
    const k = clave(); if (!k) throw new Error("Falta OMNI_CLAVE_DATOS en el .env para descifrar");
    const b = Buffer.from(valor.slice(PREFIJO.length), "base64");
    const d = crypto.createDecipheriv("aes-256-gcm", k, b.subarray(0, 12));
    d.setAuthTag(b.subarray(12, 28));
    return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString("utf8");
}
module.exports = { cifrar, descifrar, estaCifrado, PREFIJO };
