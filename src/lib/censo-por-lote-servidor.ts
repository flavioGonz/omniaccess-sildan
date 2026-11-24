import { prisma } from "@/lib/prisma";
import { nuevaClave } from "@/lib/censo-invitaciones";
import { planDeInvitaciones, type LoteParaCenso, type PlanCenso } from "@/lib/censo-por-lote";

/**
 * Deja una invitación del censo por lote, a su persona principal (ver lib/censo-por-lote). La usan
 * la importación del padrón, el botón de mandarle el censo a alguien desde su renglón, y la elección
 * del principal a mano en el cajón del lote.
 *
 * Al cambiar la persona principal de un lote, si la invitación todavía no se usó vuelve a quedar
 * pendiente: lo que se le mandó a la anterior no le llegó a la nueva. La clave no se cambia nunca.
 */
export type InformeCensoPorLote = {
    nuevas: number; convertidas: number; actualizadas: number; borradas: number; iguales: number;
    usadasQueQuedan: number; lotesSinPrincipal: number; ids: { creadas: string[]; convertidas: string[] };
};

export async function sincronizarInvitacionesPorLote(o: { simulacro: boolean; preferidos?: Map<string, string>; soloLotes?: string[] }): Promise<InformeCensoPorLote & { plan: PlanCenso }> {
    const filtro = o.soloLotes ? { id: { in: o.soloLotes } } : {};
    const [unidades, existentes] = await Promise.all([
        prisma.unit.findMany({
            where: { ...filtro, OR: [{ vinculos: { some: {} } }, { administracionId: { not: null } }] },
            select: { id: true, name: true, vinculos: { select: { vinculo: true, createdAt: true, user: { select: { id: true, name: true, email: true } } } } },
        }),
        prisma.invitacionCenso.findMany({
            where: { sitio: "", ...(o.soloLotes ? { OR: [{ unitId: { in: o.soloLotes } }, { unitId: null }] } : {}) },
            select: { id: true, unitId: true, userId: true, email: true, nombre: true, lote: true, lotes: true, enviadoAt: true, usadoAt: true, aMano: true },
        }),
    ]);
    const lotes: LoteParaCenso[] = unidades.map((u) => ({
        unitId: u.id, nombre: u.name, preferido: o.preferidos?.get(u.id) || null,
        miembros: u.vinculos.map((v) => ({ userId: v.user.id, nombre: v.user.name, email: v.user.email, vinculo: v.vinculo, desde: v.createdAt.getTime() })),
    }));
    // Con un filtro de lotes, las viejas por persona sólo cuentan si nombran alguno de esos lotes: las demás no se tocan.
    const enJuego = o.soloLotes
        ? existentes.filter((i) => i.unitId || (Array.isArray(i.lotes) && (i.lotes as { unitId?: string }[]).some((x) => o.soloLotes!.includes(String(x?.unitId)))))
        : existentes;
    const plan = planDeInvitaciones(lotes, enJuego);
    // Con filtro, una vieja que nombra otros lotes además de éstos no se borra: puede ser de otro lote.
    if (o.soloLotes) plan.borrar = plan.borrar.filter((b) => b.motivo === "lote-sin-principal");

    const inf: InformeCensoPorLote = {
        nuevas: plan.crear.length, convertidas: plan.actualizar.filter((a) => a.convertida).length, actualizadas: plan.actualizar.filter((a) => !a.convertida).length,
        borradas: plan.borrar.length, iguales: plan.iguales, usadasQueQuedan: plan.usadasQueQuedan, lotesSinPrincipal: plan.lotesSinPrincipal.length,
        ids: { creadas: [], convertidas: plan.actualizar.filter((a) => a.convertida).map((a) => a.id) },
    };
    if (o.simulacro) return { ...inf, plan };

    const usado = new Map(existentes.map((i) => [i.id, !!i.usadoAt]));
    // Primero se borra y se convierte: así un lote no choca con la invitación vieja que va a dejar de ser suya.
    for (const b of plan.borrar) await prisma.invitacionCenso.delete({ where: { id: b.id } }).catch(() => null);
    for (const a of plan.actualizar) {
        const reenviar = a.otraPersona && !usado.get(a.id);
        await prisma.invitacionCenso.update({
            where: { id: a.id },
            data: { unitId: a.unitId, lote: a.lote, lotes: a.lotes, email: a.email, nombre: a.nombre, userId: a.userId,
                ...(reenviar ? { enviadoAt: null, enviadoDesde: null, intentos: 0, error: null } : {}) },
        });
    }
    for (const c of plan.crear) {
        let creada: { id: string } | null = null;
        // La clave es única: si justo sale una repetida, la base la rechaza y se prueba con otra.
        for (let vuelta = 0; vuelta < 5 && !creada; vuelta++) {
            creada = await prisma.invitacionCenso.create({ data: { sitio: "", unitId: c.unitId, lote: c.lote, lotes: c.lotes, email: c.email, nombre: c.nombre, userId: c.userId, clave: nuevaClave() }, select: { id: true } }).catch(() => null);
        }
        if (creada) inf.ids.creadas.push(creada.id);
    }
    return { ...inf, plan };
}
