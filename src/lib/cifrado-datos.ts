import crypto from "crypto";

/**
 * Cifrar datos sensibles guardados en la base. Gemelo de lib-cifrado-datos.js (raíz, para los
 * procesos de PM2): MISMO formato, y si se toca uno se toca el otro.
 *   enc:v1:<base64( iv 12 B | tag 16 B | cifrado )>   AES-256-GCM, clave = SHA-256(OMNI_CLAVE_DATOS)
 * Un valor sin prefijo se devuelve tal cual (lo guardado en claro antes sigue andando).
 */
export const PREFIJO_CIFRADO = "enc:v1:";
const clave = () => { const s = process.env.OMNI_CLAVE_DATOS || ""; return s ? crypto.createHash("sha256").update(s, "utf8").digest() : null; };
export const estaCifrado = (v: unknown): v is string => typeof v === "string" && v.startsWith(PREFIJO_CIFRADO);
export const hayClaveDatos = () => !!clave();

export function cifrarDato(texto: string): string;
export function cifrarDato(texto: string | null | undefined): string | null | undefined;
export function cifrarDato(texto: string | null | undefined) {
    if (texto == null || texto === "" || estaCifrado(texto)) return texto;
    const k = clave();
    if (!k) throw new Error("Falta OMNI_CLAVE_DATOS en el .env: no se guarda una clave en claro");
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv("aes-256-gcm", k, iv);
    const ct = Buffer.concat([c.update(String(texto), "utf8"), c.final()]);
    return PREFIJO_CIFRADO + Buffer.concat([iv, c.getAuthTag(), ct]).toString("base64");
}

export function descifrarDato(valor: string): string;
export function descifrarDato(valor: string | null | undefined): string | null | undefined;
export function descifrarDato(valor: string | null | undefined) {
    if (!estaCifrado(valor)) return valor;
    const k = clave();
    if (!k) throw new Error("Falta OMNI_CLAVE_DATOS en el .env para descifrar");
    const b = Buffer.from(valor.slice(PREFIJO_CIFRADO.length), "base64");
    const d = crypto.createDecipheriv("aes-256-gcm", k, b.subarray(0, 12));
    d.setAuthTag(b.subarray(12, 28));
    return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString("utf8");
}
