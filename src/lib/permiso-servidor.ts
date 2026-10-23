import { NextResponse } from "next/server";
import { getSession } from "@/app/actions/auth";
import { permisosDeSesion, permisoPorClave, tieneAlguno } from "@/lib/permisos";

/**
 * Exigir un permiso en el servidor (openspec roles-y-permisos, «permisos-aplicacion»).
 *
 * Antes cada archivo tenía su `exigirAjustes`/`exigirVideo`/`exigirGuardia` copiado, diez
 * veces, con mensajes distintos. Esto es la pieza única: la usan las acciones de servidor que
 * hacen algo peligroso (respaldo, restauración, usuarios del sistema…) además de la puerta del
 * middleware, y las rutas de API que se revisan solas.
 *
 * `claves`: una o varias; alcanza con tener una (p. ej. atender una alarma lo puede hacer quien
 * atiende alarmas o quien atiende intrusiones).
 */

/** Con OMNI_PERMISOS_SOLO_AVISAR=1 nada se rechaza: se registra lo que se habría rechazado (puesta en marcha). */
export const soloAvisar = () => process.env.OMNI_PERMISOS_SOLO_AVISAR === "1";

const rotulos = (claves: string[]) => claves.map((c) => permisoPorClave(c)?.rotulo || c).join(" o ");
export const mensajeFalta = (claves: string | readonly string[]) => `Hace falta el permiso ${rotulos(typeof claves === "string" ? [claves] : [...claves])}.`;

/** La línea del registro, la misma que escribe el middleware. */
export function registrarRechazo(s: any, que: string, claves: string | readonly string[], avisado: boolean) {
    const lista = typeof claves === "string" ? [claves] : [...claves];
    console.warn(`[permisos] ${avisado ? "habría rechazado" : "rechazado"}: ${s?.name || s?.sub || "?"} (${s?.rolApp || s?.role || "sin rol"}) ${que} sin ${lista.join("|")}`);
}

/**
 * Para acciones de servidor: devuelve la sesión si tiene el permiso; si no, tira un Error con el
 * permiso que falta (la pantalla lo muestra). Sin sesión, «tenés que iniciar sesión».
 */
export async function exigirPermiso(claves: string | readonly string[], que = "acción"): Promise<any> {
    const s: any = await getSession().catch(() => null);
    if (!s) throw new Error("Tenés que iniciar sesión.");
    if (tieneAlguno(permisosDeSesion(s), claves as any)) return s;
    registrarRechazo(s, que, claves, soloAvisar());
    if (soloAvisar()) return s;
    throw new Error(mensajeFalta(claves));
}

/** Para rutas: null si puede; si no, la respuesta (401 sin sesión, 403 con el permiso que falta). */
export async function rechazoPorPermiso(claves: string | readonly string[], que = "ruta"): Promise<NextResponse | null> {
    const s: any = await getSession().catch(() => null);
    if (!s) return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
    if (tieneAlguno(permisosDeSesion(s), claves as any)) return null;
    registrarRechazo(s, que, claves, soloAvisar());
    if (soloAvisar()) return null;
    return NextResponse.json({ ok: false, error: mensajeFalta(claves), permiso: typeof claves === "string" ? claves : [...claves] }, { status: 403 });
}
