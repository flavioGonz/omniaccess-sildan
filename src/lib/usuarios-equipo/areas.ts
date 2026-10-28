/**
 * Qué área decide sobre las cuentas de un equipo (openspec usuarios-de-equipos, «Moderación por áreas»).
 * Puro: lo usan las rutas, el plan de sincronización y las pantallas, así hay una sola verdad.
 */
import type { Area, EstadoAreas } from "@/app/actions/areas";

export type Gestora = {
    /** El área del equipo (null: «Sin área», o un área que ya no existe). */
    area: Area | null;
    /** El área cuyo ajuste vale: la del equipo o la primera madre que tiene uno propio. */
    decide: Area | null;
    gestionada: boolean;
    roles: string[];
    heredada: boolean;
};

const NADA: Gestora = { area: null, decide: null, gestionada: false, roles: [], heredada: false };

export function areaGestora(estado: Pick<EstadoAreas, "areas" | "equipos">, deviceId: string): Gestora {
    return gestoraDeArea(estado, estado.equipos[deviceId]);
}

/** Lo mismo, desde un área: el panel de un área dice si sus equipos se gestionan y de quién lo hereda. */
export function gestoraDeArea(estado: Pick<EstadoAreas, "areas">, areaId: string | null | undefined): Gestora {
    const porId = new Map(estado.areas.map((a) => [a.id, a]));
    const area = (areaId && porId.get(areaId)) || null;
    if (!area) return NADA;
    // Se sube por el árbol hasta un área con ajuste propio. El tope evita un ciclo en datos rotos.
    for (let a: Area | undefined = area, n = 0; a && n < 50; a = a.padre ? porId.get(a.padre) : undefined, n++) {
        if (a.cuentas) return { area, decide: a, gestionada: !!a.cuentas.gestionada, roles: a.cuentas.gestionada ? [...(a.cuentas.roles || [])] : [], heredada: a.id !== area.id };
    }
    return { ...NADA, area };
}

/** El área y todas sus sub-áreas: para el panel de un área, que cuenta lo de toda su rama. */
export function ramaDe(estado: Pick<EstadoAreas, "areas">, areaId: string): Set<string> {
    const out = new Set<string>([areaId]);
    let creció = true;
    while (creció) {
        creció = false;
        for (const a of estado.areas) if (a.padre && out.has(a.padre) && !out.has(a.id)) { out.add(a.id); creció = true; }
    }
    return out;
}
