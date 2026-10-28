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
/**
 * La clave del servidor. Algunos procesos de PM2 no cargan el .env (Prisma lee su DATABASE_URL por
 * su cuenta): si no está en el entorno se busca en el .env de al lado, una sola vez.
 */
let delArchivo;
function claveTexto() {
    if (process.env.OMNI_CLAVE_DATOS) return process.env.OMNI_CLAVE_DATOS;
    if (delArchivo === undefined) {
        delArchivo = "";
        try {
            const linea = require("fs").readFileSync(require("path").join(__dirname, ".env"), "utf8").split(/\r?\n/).find((l) => /^\s*OMNI_CLAVE_DATOS\s*=/.test(l));
            if (linea) delArchivo = linea.slice(linea.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "");
        } catch { /* sin .env: sin clave */ }
    }
    return delArchivo;
}
const clave = () => { const s = claveTexto(); return s ? crypto.createHash("sha256").update(s, "utf8").digest() : null; };
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
/**
 * Las credenciales de los equipos cifradas en la base (punto 5, 21/10): Device.password y
 * Device.rtspUrl (que lleva usuario y clave adentro). Se engancha al cliente de Prisma de cada
 * proceso con enPrisma(prisma):
 *  · al LEER, cualquier campo password / rtspUrl con el prefijo enc:v1: sale descifrado, a
 *    cualquier profundidad (un include de otro modelo, un $queryRaw) — el resto del código no se
 *    entera;
 *  · al ESCRIBIR un Device, se cifran antes de guardar. Sin OMNI_CLAVE_DATOS en el .env no se cifra
 *    nada (la instalación sigue como antes, en claro).
 * Compatible hacia atrás: lo que ya estaba en claro se lee igual. Gemelo de src/lib/cifrado-datos.ts.
 */
const CAMPOS = new Set(["password", "rtspUrl", "claveEquipos", "passwordAnterior"]);
/** Qué campos se cifran al escribir cada modelo. User sólo la clave de equipos: su `password` no existe y no se toca. */
const CIFRAR_EN = { Device: ["password", "rtspUrl", "passwordAnterior"], User: ["claveEquipos"] };
function descifrarProfundo(x, n = 0) {
    if (!x || typeof x !== "object" || n > 6) return x;
    if (Array.isArray(x)) { for (const y of x) descifrarProfundo(y, n + 1); return x; }
    if (x instanceof Date || Buffer.isBuffer(x)) return x;
    for (const k of Object.keys(x)) {
        const v = x[k];
        if (typeof v === "string") { if (CAMPOS.has(k) && estaCifrado(v)) { try { x[k] = descifrar(v); } catch { /* clave del servidor distinta: queda cifrado */ } } }
        else if (v && typeof v === "object") descifrarProfundo(v, n + 1);
    }
    return x;
}
function cifrarDatos(d, campos) {
    // Una copia: el objeto del que llama no se toca (puede seguir usando la clave en claro después).
    if (!d || typeof d !== "object" || !clave()) return d;
    const c = { ...d };
    for (const k of campos) {
        if (typeof c[k] === "string" && c[k] && !estaCifrado(c[k])) c[k] = cifrar(c[k]);
        else if (c[k] && typeof c[k] === "object" && typeof c[k].set === "string" && c[k].set && !estaCifrado(c[k].set)) c[k] = { ...c[k], set: cifrar(c[k].set) };
    }
    return c;
}
function enPrisma(prisma) {
    if (!prisma || prisma.__conCifrado) return prisma;
    prisma.$use(async (params, next) => {
        // Device: las claves de los equipos. User: la clave de equipos de cada persona (usuarios-de-equipos).
        const campos = CIFRAR_EN[params.model];
        if (campos) {
            const a = params.args || {};
            const cd = (d) => cifrarDatos(d, campos);
            if (["create", "update", "updateMany"].includes(params.action)) params.args = { ...a, data: cd(a.data) };
            else if (params.action === "createMany") params.args = { ...a, data: Array.isArray(a.data) ? a.data.map(cd) : cd(a.data) };
            else if (params.action === "upsert") params.args = { ...a, create: cd(a.create), update: cd(a.update) };
        }
        return descifrarProfundo(await next(params));
    });
    Object.defineProperty(prisma, "__conCifrado", { value: true });
    return prisma;
}
module.exports = { cifrar, descifrar, estaCifrado, PREFIJO, enPrisma, descifrarProfundo };
