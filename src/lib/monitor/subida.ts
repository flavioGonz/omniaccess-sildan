/**
 * La foto que un celular le manda a una pared por QR, para buscar parecidos (openspec pared-vms,
 * 23/10, Nico: «permite una forma mediante QR, subir una foto de un celular para que compare con
 * nuestro buscador de parecidos»).
 *
 * El recorrido:
 *   1. La pared pide un código (POST /api/monitor/camaras/subida) y dibuja el QR con la dirección
 *      /subir/<token>.
 *   2. El celular abre esa página SIN usuario, saca o elige la foto y la sube (POST /api/subida/<token>).
 *   3. La pared pregunta cada pocos segundos (GET /api/monitor/camaras/subida/<id>) y, cuando
 *      llegó, se la lleva una sola vez.
 *
 * Lo único que autoriza la subida es el token: de un solo uso, de 10 minutos, y que no deja leer
 * nada. Por eso no se guarda el token sino su hash, como con los enlaces de pantalla.
 *
 * Por qué consultar y no un socket: el aviso en vivo lo emite server.js, y tocarlo pide reiniciar
 * los webhooks. Dos segundos de consulta, sólo mientras el QR está abierto, alcanzan. Por qué en la
 * base y no en memoria: la subida y la consulta pueden caer en procesos distintos de Next.
 */

/** Cuánto vive un QR. */
export const SUBIDA_VIDA_MS = 10 * 60 * 1000;
/** Lo más que pesa una foto que se acepta: una de celular, ya achicada en el teléfono, pesa mucho menos. */
export const SUBIDA_MAX_BYTES = 12 * 1024 * 1024;
/** Códigos vivos a la vez: una pared abre uno por búsqueda; más que esto es un abuso o un error. */
export const SUBIDAS_VIVAS_MAX = 20;
/** Los tipos de imagen que se aceptan. */
export const TIPOS_FOTO = /^image\/(jpeg|png|webp)$/;

/** Por qué no se acepta una subida, en palabras para el celular. null = se acepta. */
export type MotivoRechazo = "no-existe" | "vencido" | "usado" | "tipo" | "pesa" | "vacia";
export const TEXTO_RECHAZO: Record<MotivoRechazo, string> = {
    "no-existe": "Este código no existe. Pedí uno nuevo en la pared.",
    vencido: "Este código venció. Pedí uno nuevo en la pared.",
    usado: "Este código ya recibió una foto. Pedí uno nuevo en la pared.",
    tipo: "Mandá una foto (JPG, PNG o WebP).",
    pesa: "La foto pesa demasiado (máximo 12 MB).",
    vacia: "No llegó la foto. Probá de nuevo.",
};

/** ¿Se acepta esta foto para este código? La lógica, sin la base, para poder probarla. */
export function motivoDeRechazo(sub: { vence: Date; llego: Date | null } | null, tipo: string, bytes: number, ahora = new Date()): MotivoRechazo | null {
    if (!sub) return "no-existe";
    if (sub.llego) return "usado";
    if (sub.vence.getTime() <= ahora.getTime()) return "vencido";
    if (!TIPOS_FOTO.test(tipo.split(";")[0].trim())) return "tipo";
    if (!bytes) return "vacia";
    if (bytes > SUBIDA_MAX_BYTES) return "pesa";
    return null;
}

/** Lo que la pared ve de un código. */
export type EstadoSubida = "esperando" | "llego" | "retirada" | "vencido";
export function estadoDe(sub: { vence: Date; llego: Date | null; retirada: Date | null }, ahora = new Date()): EstadoSubida {
    if (sub.retirada) return "retirada";
    if (sub.llego) return "llego";
    return sub.vence.getTime() <= ahora.getTime() ? "vencido" : "esperando";
}

/** Un token al azar (32 bytes, base64url) y su hash. Usa la Web Crypto: anda en Node y en el borde. */
export async function nuevoToken(): Promise<{ token: string; hash: string }> {
    const b = new Uint8Array(32);
    crypto.getRandomValues(b);
    const token = Buffer.from(b).toString("base64url");
    return { token, hash: await hashToken(token) };
}
export async function hashToken(token: string): Promise<string> {
    const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
    return Buffer.from(d).toString("hex");
}
/** El token de la dirección: lo que no tenga esta forma ni se busca en la base. */
export const FORMA_TOKEN = /^[A-Za-z0-9_-]{43}$/;
