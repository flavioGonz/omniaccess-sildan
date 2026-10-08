import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";

/**
 * La identidad del guardia en la consola de la garita.
 *
 * La consola (/guard) no usa la sesión del panel: es pública y el guardia se identifica con
 * su usuario y PIN (verifyGuardCredential). Hasta ahora esa identificación vivía sólo en el
 * navegador (localStorage), así que el servidor no podía saber quién registraba algo. Al
 * identificarse se firma una cookie corta con su nombre; las acciones que cambian datos de
 * la guardia (visitas, avisos) la exigen si no hay sesión del panel.
 */

const COOKIE = "guardia";
/** Un turno largo con margen. Vencida, el guardia se vuelve a identificar ("Cambiar guardia"). */
const DURACION_H = 14;
const clave = () => new TextEncoder().encode(process.env.JWT_SECRET || "MISSING-KEY-DO-NOT-USE");

export async function firmarGuardia(nombre: string) {
    const token = await new SignJWT({ tipo: "guardia", nombre }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime(`${DURACION_H}h`).sign(clave());
    (await cookies()).set(COOKIE, token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: DURACION_H * 3600 });
}

/** El nombre del guardia identificado, o null. */
export async function leerGuardia(): Promise<string | null> {
    try {
        const t = (await cookies()).get(COOKIE)?.value;
        if (!t) return null;
        const { payload } = await jwtVerify(t, clave(), { algorithms: ["HS256"] });
        return payload.tipo === "guardia" && typeof payload.nombre === "string" ? payload.nombre : null;
    } catch { return null; }
}
