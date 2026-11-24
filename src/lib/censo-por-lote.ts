/**
 * El censo, un código POR LOTE (25/11).
 *
 * Nico: «hay una lógica rara que quiero que acomodes: es un código por lote, no por cada integrante;
 * cada lote tiene un correo principal». Hasta acá la invitación era por persona (lo que había
 * resuelto la administración el 21/11: «un código por persona; los matrimonios, uno cada uno»), con
 * todos sus lotes adentro. Ahora cada lote tiene UNA invitación, con su código, que le llega a UNA
 * persona: la principal del lote. El resto de la gente del lote no recibe código: la principal carga
 * el censo del lote entero.
 *
 * Quién es la principal (lo que eligió Nico):
 *   1. La que alguien eligió a mano en el cajón del lote, mientras siga en el lote con correo.
 *   2. La que la planilla del padrón nombra primero (primer propietario con correo; si no hay, el
 *      primer inquilino).
 *   3. Sin planilla a mano: el primer propietario con correo por orden de carga; si no hay, el primer
 *      inquilino, ocupante o familiar.
 * Quien es la principal de dos lotes recibe dos correos, uno por lote (también lo eligió Nico).
 *
 * Lo que se conserva al pasar de una forma a la otra: la invitación vieja de una persona se vuelve
 * la del primero de sus lotes donde es la principal, con su MISMA clave y su estado de envío (lo que
 * ya recibió sigue sirviendo). Las de quienes no son principales de ningún lote se quitan, salvo que
 * ya se hayan usado para cargar: esas quedan, para no borrar un censo cargado.
 *
 * Acá va sólo la decisión, sin base: qué invitación crear, cuál convertir, cuál cambiar y cuál
 * quitar. Quien escribe es censo-por-lote-servidor.ts.
 */

export type Miembro = { userId: string; nombre: string; email: string | null; vinculo: string; desde: number };
export type LoteParaCenso = {
    unitId: string; nombre: string; miembros: Miembro[];
    /** El correo que la planilla nombra primero en este lote, si se sabe. */
    preferido?: string | null;
};
export type InvitacionExistente = {
    id: string; unitId: string | null; userId: string | null; email: string; nombre: string; lote: string;
    lotes: unknown; enviadoAt: Date | string | null; usadoAt: Date | string | null; aMano: boolean;
};
export type CambioInvitacion = {
    unitId: string; lote: string;
    lotes: { unitId: string; nombre: string; vinculo: string }[];
    email: string; nombre: string; userId: string;
    /** Le cambió la persona principal (otro correo): lo que se le mandó a la anterior no le llegó a ésta. */
    otraPersona: boolean;
};
export type PlanCenso = {
    crear: CambioInvitacion[];
    /** Invitaciones que se ponen al día: las viejas por persona que pasan a ser de un lote (`convertida`) y las de lote cuyo principal cambió. */
    actualizar: (CambioInvitacion & { id: string; convertida: boolean })[];
    borrar: { id: string; motivo: "no-es-principal" | "lote-sin-principal" }[];
    /** Viejas que ya se usaron para cargar y no son de ningún lote nuevo: quedan como están. */
    usadasQueQuedan: number;
    iguales: number;
    lotesSinPrincipal: string[];
};

export const correoSirve = (v: string | null | undefined) => /^[^@\s,;]+@[^@\s,;]+\.[^@\s,;]{2,}$/.test(String(v || "").trim());
const ORDEN_VINCULO: Record<string, number> = { PROPIETARIO: 0, INQUILINO: 1, OCUPANTE: 2, FAMILIA: 3 };
const correoDe = (m: Miembro) => String(m.email || "").trim().toLowerCase();
const lotesDe = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => String((x as { unitId?: unknown })?.unitId || "")).filter(Boolean) : []);

/** La persona principal de un lote (ver arriba el orden). Null si nadie del lote tiene correo. */
export function principalDeLote(miembros: Miembro[], o: { preferido?: string | null; aMano?: string | null } = {}): Miembro | null {
    const con = miembros.filter((m) => correoSirve(m.email));
    if (!con.length) return null;
    if (o.aMano) { const m = con.find((x) => x.userId === o.aMano); if (m) return m; }
    const pref = String(o.preferido || "").trim().toLowerCase();
    if (pref) { const m = con.find((x) => correoDe(x) === pref); if (m) return m; }
    return [...con].sort((a, b) => (ORDEN_VINCULO[a.vinculo] ?? 9) - (ORDEN_VINCULO[b.vinculo] ?? 9) || a.desde - b.desde)[0];
}

/** Qué hay que hacer para que quede una invitación por lote, a su principal. */
export function planDeInvitaciones(lotes: LoteParaCenso[], existentes: InvitacionExistente[]): PlanCenso {
    const plan: PlanCenso = { crear: [], actualizar: [], borrar: [], usadasQueQuedan: 0, iguales: 0, lotesSinPrincipal: [] };
    const deLote = new Map(existentes.filter((i) => i.unitId).map((i) => [i.unitId!, i]));
    const viejas = existentes.filter((i) => !i.unitId);
    const usadas = new Set<string>();       // viejas que ya pasaron a ser de un lote

    for (const l of lotes) {
        const ex = deLote.get(l.unitId);
        /* Un correo puesto a mano que no es de nadie del padrón (la planilla simple de un barrio sin
           administraciones: lote y correo): se respeta tal cual. */
        if (ex?.aMano && !ex.userId) { plan.iguales++; continue; }
        const p = principalDeLote(l.miembros, { preferido: l.preferido, aMano: ex?.aMano ? ex.userId : null });
        if (!p) {
            plan.lotesSinPrincipal.push(l.nombre);
            // Un lote que se quedó sin nadie con correo: su invitación sin usar ya no tiene a quién ir.
            if (ex && !ex.usadoAt) plan.borrar.push({ id: ex.id, motivo: "lote-sin-principal" });
            continue;
        }
        const email = correoDe(p);
        const cambio: CambioInvitacion = {
            unitId: l.unitId, lote: l.nombre, lotes: [{ unitId: l.unitId, nombre: l.nombre, vinculo: p.vinculo }],
            email, nombre: p.nombre, userId: p.userId, otraPersona: false,
        };
        if (ex) {
            const otra = ex.email.trim().toLowerCase() !== email;
            if (!otra && ex.userId === p.userId && ex.nombre === p.nombre && ex.lote === l.nombre && lotesDe(ex.lotes).join() === l.unitId) { plan.iguales++; continue; }
            plan.actualizar.push({ ...cambio, id: ex.id, convertida: false, otraPersona: otra });
            continue;
        }
        /* La vieja de esta persona que nombra este lote: pasa a ser la del lote, con su clave. */
        const vieja = viejas.find((v) => !usadas.has(v.id) && (v.userId === p.userId || v.email.trim().toLowerCase() === email) && lotesDe(v.lotes).includes(l.unitId))
            || viejas.find((v) => !usadas.has(v.id) && (v.userId === p.userId || v.email.trim().toLowerCase() === email) && !lotesDe(v.lotes).length);
        if (vieja) { usadas.add(vieja.id); plan.actualizar.push({ ...cambio, id: vieja.id, convertida: true }); continue; }
        plan.crear.push(cambio);
    }
    for (const v of viejas) {
        if (usadas.has(v.id)) continue;
        if (v.usadoAt) { plan.usadasQueQuedan++; continue; }
        plan.borrar.push({ id: v.id, motivo: "no-es-principal" });
    }
    return plan;
}
