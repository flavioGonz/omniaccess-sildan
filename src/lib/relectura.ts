import { prisma } from "@/lib/prisma";

/**
 * La relectura de una NO_LEIDA (vision-worker → vision-relectura.js), con lo que se sabe de la
 * chapa sugerida: de quién es y si está en la lista negra. Es una SUGERENCIA: el evento sigue
 * siendo NO_LEIDA hasta que el guardia la confirma.
 *
 * La comparten el monitor LPR (acción getAccessEvents) y Control LPR (/api/monitor/lpr). Las
 * imágenes no van acá como URL porque cada uno las sirve por su lado: el panel por
 * /api/vision/imagen (con sesión), las pantallas de pared por /api/monitor/lpr/relectura (con
 * el enlace de pantalla).
 */

/** Lo que la lectora escribe cuando no leyó la chapa (las mismas que vision-relectura.js). */
export const NO_LEIDAS = new Set(["NO_LEIDA", "UNKNOWN", "S/P"]);
export const esNoLeida = (p: string | null | undefined) => NO_LEIDAS.has(String(p || "").toUpperCase());

export type RelecturaEvento = {
    estado: string; plate: string | null; confianza: number | null; vehiculo: string | null;
    /** URLs de los recortes (vehículo y chapa); las pone quien sirve las imágenes. */
    recorte: string | null; chapa: string | null;
    otras: { plate: string; confianza: number }[];
    /** Si la chapa sugerida es de alguien del padrón. */
    quien: { id: string; name: string; role: string; vip: boolean; unidad: string | null } | null;
    /** Si la chapa sugerida está en la lista negra (alerta máxima o en búsqueda). */
    vigilancia: { category: string; label: string; motivo: string | null } | null;
};

/**
 * Las relecturas de esos eventos, por id de evento. `url(clave, eventoId, que)` arma la URL de
 * cada recorte para quien las va a mostrar.
 */
export async function relecturasDe(eventoIds: string[], url: (clave: string, eventoId: string, que: "v" | "c") => string): Promise<Map<string, RelecturaEvento>> {
    const out = new Map<string, RelecturaEvento>();
    if (!eventoIds.length) return out;
    const filas = await prisma.relectura.findMany({ where: { accessEventId: { in: eventoIds } } });
    if (!filas.length) return out;
    const plates = [...new Set(filas.map((f) => f.plate).filter(Boolean))] as string[];
    const [creds, watch] = plates.length ? await Promise.all([
        prisma.credential.findMany({ where: { type: "PLATE", value: { in: plates } }, select: { value: true, user: { select: { id: true, name: true, role: true, vip: true, unit: { select: { name: true } } } } } }),
        prisma.plateWatch.findMany({ where: { active: true, plate: { in: plates } }, select: { plate: true, category: true, label: true, motivo: true } }),
    ]) : [[], []];
    const dueno = new Map(creds.filter((c) => c.user).map((c) => [c.value, c.user!]));
    const vig = new Map(watch.map((w) => [w.plate, w]));
    for (const f of filas) {
        const u = f.plate ? dueno.get(f.plate) : undefined;
        const w = f.plate ? vig.get(f.plate) : undefined;
        const c: any = f.candidatos || {};
        out.set(f.accessEventId, {
            estado: f.estado, plate: f.plate, confianza: f.confianza, vehiculo: f.vehiculo,
            recorte: f.recorte ? url(f.recorte, f.accessEventId, "v") : null,
            chapa: f.recorteChapa ? url(f.recorteChapa, f.accessEventId, "c") : null,
            otras: Array.isArray(c.otras) ? c.otras : [],
            quien: u ? { id: u.id, name: u.name, role: String(u.role), vip: !!u.vip, unidad: u.unit?.name || null } : null,
            vigilancia: w ? { category: w.category, label: w.label, motivo: w.motivo } : null,
        });
    }
    return out;
}
