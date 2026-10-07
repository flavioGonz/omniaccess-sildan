import { createHash, randomBytes } from "crypto";
import { SignJWT, jwtVerify } from "jose";
import { prisma } from "@/lib/prisma";
import { esVista, type ClaveVista } from "@/lib/monitor/vistas";

/**
 * El enlace de pantalla, del lado del servidor (Node).
 *
 * Un monitor de pared no tiene quién escriba una contraseña: entra con una URL que lleva un
 * token. El token en claro se muestra una sola vez al crearlo; acá se guarda su sha256.
 *
 * Por qué dos piezas (token en la base + JWT en la cookie): el middleware corre en el edge
 * y no puede consultar la base en cada pedido. Entonces el token se canjea UNA vez
 * (`canjearToken`) por una cookie firmada con el mismo secreto que la sesión, con el id del
 * enlace y su vista adentro; el middleware sólo verifica la firma y el alcance, y las rutas
 * de API (que sí son Node) reconfirman contra la base que el enlace no fue revocado
 * (`enlaceVigente`, con caché corta). Así revocar surte efecto en el próximo pedido de datos
 * aunque la cookie siga en el navegador de la pared.
 */

const secreto = process.env.JWT_SECRET ? new TextEncoder().encode(process.env.JWT_SECRET) : null;
/** Un año: la PC de la pared no debería volver a pedir el enlace; revocar es el camino para cortarla. */
const VIGENCIA_COOKIE = "365d";
/** Cuánto se confía en "no está revocado" antes de volver a preguntarle a la base. */
const CACHE_VIGENCIA_MS = 30_000;
/** Cuánto se espera entre dos registros de "último uso" del mismo enlace: no vale la pena escribir en cada pedido. */
const INTERVALO_ULTIMO_USO_MS = 60_000;

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
export const nuevoToken = () => randomBytes(32).toString("base64url");

export type CredencialPantalla = { enlaceId: string; vista: ClaveVista };

/** Verifica un token en claro contra la base y devuelve el enlace vigente, o null. */
export async function enlacePorToken(token: string) {
    if (!token || token.length < 20) return null;
    const e = await prisma.enlacePantalla.findUnique({ where: { tokenHash: hashToken(token) } });
    if (!e || e.revocadoEn) return null;
    return e;
}

/** Firma la cookie de pantalla para un enlace ya verificado. */
export async function firmarCookiePantalla(enlace: { id: string; vista: string }): Promise<string> {
    if (!secreto) throw new Error("JWT_SECRET no configurado");
    return new SignJWT({ tipo: "pantalla", enlace: enlace.id, vista: enlace.vista })
        .setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime(VIGENCIA_COOKIE).sign(secreto);
}

/** Lee la cookie de pantalla (sólo firma: lo usa también el middleware por su propia copia en edge). */
export async function leerCookiePantalla(valor: string | undefined | null): Promise<CredencialPantalla | null> {
    if (!valor || !secreto) return null;
    try {
        const { payload } = await jwtVerify(valor, secreto, { algorithms: ["HS256"] });
        if (payload.tipo !== "pantalla" || typeof payload.enlace !== "string" || !esVista(payload.vista as string)) return null;
        return { enlaceId: payload.enlace, vista: payload.vista as ClaveVista };
    } catch { return null; }
}

const vigencia = new Map<string, { ok: boolean; hasta: number }>();
const ultimoUso = new Map<string, number>();

/**
 * ¿El enlace sigue vigente? Pregunta a la base como mucho cada 30 s por enlace, y de paso
 * anota el último uso (fecha e IP) como mucho una vez por minuto.
 */
export async function enlaceVigente(cred: CredencialPantalla, ip?: string | null): Promise<boolean> {
    const ahora = Date.now();
    const c = vigencia.get(cred.enlaceId);
    if (c && c.hasta > ahora) return c.ok;
    const e = await prisma.enlacePantalla.findUnique({ where: { id: cred.enlaceId }, select: { revocadoEn: true, vista: true } }).catch(() => null);
    const ok = !!e && !e.revocadoEn && e.vista === cred.vista;
    vigencia.set(cred.enlaceId, { ok, hasta: ahora + CACHE_VIGENCIA_MS });
    if (ok && (ultimoUso.get(cred.enlaceId) || 0) + INTERVALO_ULTIMO_USO_MS < ahora) {
        ultimoUso.set(cred.enlaceId, ahora);
        prisma.enlacePantalla.update({ where: { id: cred.enlaceId }, data: { ultimoUsoEn: new Date(), ultimoUsoIp: ip || null } }).catch(() => { });
    }
    return ok;
}

/** Al revocar, que el caché no siga diciendo que vale. */
export function olvidarVigencia(enlaceId: string) { vigencia.delete(enlaceId); }
