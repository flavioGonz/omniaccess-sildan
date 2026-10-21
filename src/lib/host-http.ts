/**
 * A qué host:puerto se le habla por HTTP (ISAPI, CGI, RPC2) a un equipo.
 *
 * Hasta el 21/10 era siempre el puerto 80: `http://${ip}`. Un NVR con la web en otro puerto
 * (publicado por NAT, o cambiado a mano) no se podía dar de alta: el asistente tiraba
 * «connect ECONNREFUSED 10.1.10.10:80» al leer los canales (Nico: «debe permitir cambiar el
 * puerto 80 por defecto»). Ahora cada equipo puede tener su `httpPort` (Device.httpPort; vacío =
 * 80) y todo lo que habla HTTP con él pasa por acá.
 *
 * La IP se sigue guardando sola, sin puerto: con ella se reconoce de qué equipo viene cada evento,
 * se arma el RTSP y se busca en qué canal del NVR graba. El puerto va aparte.
 *
 * Para no tocar las decenas de lugares que llaman con `{ ip, username, password }`, si no se pasa
 * el puerto se busca el del equipo con esa IP (cacheado). Si la IP ya trae puerto («ip:8080», lo que
 * manda el asistente antes de guardar), se respeta tal cual.
 */

/** Cada cuánto se vuelven a leer los puertos de la base. Cambian sólo al editar un equipo (y ahí se olvidan al toque). */
const CACHE_MS = 60_000;
const PUERTO_POR_DEFECTO = 80;

type Cache = { al: number; puertos: Map<string, number> };
const g = globalThis as unknown as { __puertosHttp?: Cache | null };

async function puertosConocidos(): Promise<Map<string, number>> {
    const c = g.__puertosHttp;
    if (c && Date.now() - c.al < CACHE_MS) return c.puertos;
    const puertos = new Map<string, number>();
    try {
        // Importado acá: este archivo lo usa digest-auth, que se carga en muchos lados.
        const { prisma } = await import("@/lib/prisma");
        const filas = await prisma.device.findMany({ where: { httpPort: { not: null } }, select: { ip: true, httpPort: true } });
        for (const f of filas) if (f.ip && f.httpPort) puertos.set(f.ip.trim(), f.httpPort);
    } catch { /* sin base a mano: queda el puerto por defecto */ }
    g.__puertosHttp = { al: Date.now(), puertos };
    return puertos;
}

/** Olvidar lo cacheado: después de crear o editar un equipo, para que el puerto nuevo valga ya. */
export function olvidarPuertosHttp() { g.__puertosHttp = null; }

/** «ip» o «ip:puerto» listo para `http://${…}`. El puerto 80 no se escribe. */
export async function hostHttp(ip: string, httpPort?: number | string | null): Promise<string> {
    const limpio = String(ip || "").trim().replace(/^https?:\/\//, "").replace(/\/+$/, "");
    if (!limpio || limpio.includes(":")) return limpio;
    const p = Number(httpPort) || (await puertosConocidos()).get(limpio) || PUERTO_POR_DEFECTO;
    return p === PUERTO_POR_DEFECTO ? limpio : `${limpio}:${p}`;
}
