import { prisma } from "@/lib/prisma";
import { normalizarMatricula } from "@/lib/lista-negra";
import { normalizeWatchCat } from "@/lib/watch-categories";
import { claseDeLectura, ESTILO_MONITOR, SIN_IDENTIFICAR, type ClaseMonitor, type NivelListaNegra } from "@/lib/padron";
import { relecturasDe, esNoLeida, type RelecturaEvento } from "@/lib/relectura";

/**
 * Quién es cada lectura en una pantalla de Control LPR, con el mismo criterio que el monitor
 * LPR del panel (lib/padron → claseDeLectura): lista negra > VIP > la pestaña del rol.
 *
 *  · `clase` y `etiqueta`: «Residente», «Proveedor», «VIP», «Lista negra», «En búsqueda».
 *  · `ficha`: si la matrícula está en la lista negra, el nombre de su ficha («Sin identificar»
 *    si no se sabe), el nivel y el motivo.
 *  · `relectura`: en una NO_LEIDA, la chapa que sugirió la relectura del vehículo. Los
 *    recortes se sirven por /api/monitor/lpr/relectura/<evento>, que abre el enlace de
 *    pantalla (/api/vision/imagen pide sesión del panel).
 *
 * Una consulta por pedido, no por lectura.
 */
export type Identidad = {
    clase: ClaseMonitor | null;
    etiqueta: string | null;
    ficha: { nombre: string; nivel: NivelListaNegra; motivo: string | null } | null;
    relectura: RelecturaEvento | null;
};

type EventoMinimo = { id: string; plateDetected?: string | null; user?: { role?: any; vip?: boolean | null } | null };

export async function identidadDeLecturas(events: EventoMinimo[]): Promise<Map<string, Identidad>> {
    const out = new Map<string, Identidad>();
    const chapas = [...new Set(events.map((e) => normalizarMatricula(e.plateDetected)).filter(Boolean))] as string[];
    const [vigiladas, relecturas] = await Promise.all([
        chapas.length ? prisma.plateWatch.findMany({ where: { active: true, plate: { in: chapas } }, select: { plate: true, category: true, label: true, motivo: true } }).catch(() => []) : [],
        relecturasDe(events.filter((e) => esNoLeida(e.plateDetected)).map((e) => e.id),
            (_clave, eventoId, que) => `/api/monitor/lpr/relectura/${encodeURIComponent(eventoId)}?que=${que}`).catch(() => new Map<string, RelecturaEvento>()),
    ]);
    const vig = new Map(vigiladas.map((v) => [normalizarMatricula(v.plate), v]));
    for (const e of events) {
        const w = vig.get(normalizarMatricula(e.plateDetected));
        const clase = claseDeLectura(e.user ? { role: String(e.user.role || ""), vip: !!e.user.vip } : null, w?.category);
        const nivel = w ? normalizeWatchCat(w.category) : null;
        out.set(e.id, {
            clase,
            etiqueta: clase ? ESTILO_MONITOR[clase].etiqueta : null,
            ficha: w && (nivel === "BLACKLISTED" || nivel === "SEARCH") ? { nombre: w.label || SIN_IDENTIFICAR, nivel, motivo: w.motivo || null } : null,
            relectura: relecturas.get(e.id) || null,
        });
    }
    return out;
}
