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

/* ── Credenciales de equipos (punto 5): gemelo de enPrisma() en lib-cifrado-datos.js ── */
const CAMPOS = new Set(["password", "rtspUrl"]);
export function descifrarProfundo<T>(x: T, n = 0): T {
    if (!x || typeof x !== "object" || n > 6) return x;
    if (Array.isArray(x)) { for (const y of x) descifrarProfundo(y, n + 1); return x; }
    if (x instanceof Date || Buffer.isBuffer(x)) return x;
    const o = x as Record<string, any>;
    for (const k of Object.keys(o)) {
        const v = o[k];
        if (typeof v === "string") { if (CAMPOS.has(k) && estaCifrado(v)) { try { o[k] = descifrarDato(v); } catch { /* otra clave de servidor: queda cifrado */ } } }
        else if (v && typeof v === "object") descifrarProfundo(v, n + 1);
    }
    return x;
}
function cifrarDatos(d: any): any {
    // Una copia: el objeto del que llama no se toca (puede seguir usando la clave en claro después).
    if (!d || typeof d !== "object" || !clave()) return d;
    const c = { ...d };
    for (const k of CAMPOS) {
        if (typeof c[k] === "string" && c[k] && !estaCifrado(c[k])) c[k] = cifrarDato(c[k]);
        else if (c[k] && typeof c[k] === "object" && typeof c[k].set === "string" && c[k].set && !estaCifrado(c[k].set)) c[k] = { ...c[k], set: cifrarDato(c[k].set) };
    }
    return c;
}
/** El middleware de Prisma: cifra al escribir un Device, descifra al leer (cualquier modelo, cualquier profundidad). */
export function middlewareCifrado() {
    return async (params: any, next: (p: any) => Promise<any>) => {
        if (params.model === "Device") {
            const a = params.args || {};
            if (["create", "update", "updateMany"].includes(params.action)) params.args = { ...a, data: cifrarDatos(a.data) };
            else if (params.action === "createMany") params.args = { ...a, data: Array.isArray(a.data) ? a.data.map(cifrarDatos) : cifrarDatos(a.data) };
            else if (params.action === "upsert") params.args = { ...a, create: cifrarDatos(a.create), update: cifrarDatos(a.update) };
        }
        return descifrarProfundo(await next(params));
    };
}
