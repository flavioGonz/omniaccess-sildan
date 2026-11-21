import { prisma } from "@/lib/prisma";
import { CLAVE_MAX, CLAVE_MIN, normalizarClave, nuevaClave } from "@/lib/censo-invitaciones";
import { anotarEnLote } from "@/lib/lote-auditoria";

/**
 * Cambiarle a una persona su código del censo: a mano, o pidiendo uno nuevo.
 *
 * Pedido de Nico (21/11): «poder editar los códigos de censo de cada lote manualmente».
 *
 * Lo que este cambio arrastra, y por eso no es un `update` suelto:
 *  · **Las cargas que esa persona ya mandó y esperan aprobación** quedaron anotadas con el código
 *    viejo, y al aprobarlas es por el código que se sabe de quién son. Se les cambia junto: si no,
 *    la aprobación no encontraría a la persona y le crearía una ficha repetida.
 *  · **El correo que ya recibió deja de servir.** La invitación vuelve a «sin enviar», para que no
 *    figure como enviada una clave que la persona no tiene.
 *  · **Queda en el historial de sus lotes**, con quién lo cambió. El código en sí no se anota: es
 *    una llave, y el historial lo lee más gente que la que puede ver las llaves.
 */
export type CodigoCambiado = { ok: true; clave: string; igual: boolean; habiaSalido: boolean } | { ok: false; error: string };

export async function cambiarCodigoDeInvitacion(id: string, pedido: string | null, quien: string): Promise<CodigoCambiado> {
    const inv = await prisma.invitacionCenso.findUnique({ where: { id } });
    if (!inv) return { ok: false, error: "Esa invitación ya no está." };

    let clave: string | null;
    if (pedido == null) {
        // Uno nuevo: se prueba hasta dar con uno libre (con 27^8 combinaciones, la primera).
        clave = null;
        for (let i = 0; i < 6 && !clave; i++) { const c = nuevaClave(); if (!(await prisma.invitacionCenso.findUnique({ where: { clave: c }, select: { id: true } }))) clave = c; }
        if (!clave) return { ok: false, error: "No se pudo generar un código. Probá de nuevo." };
    } else {
        clave = normalizarClave(pedido);
        if (!clave) return { ok: false, error: `Un código lleva entre ${CLAVE_MIN} y ${CLAVE_MAX} letras o números (los espacios y guiones no cuentan).` };
    }
    if (clave === inv.clave) return { ok: true, clave, igual: true, habiaSalido: false };

    const otra = await prisma.invitacionCenso.findUnique({ where: { clave }, select: { lote: true } });
    if (otra) return { ok: false, error: `Ese código ya lo tiene otra persona (${otra.lote}). Cada uno tiene que ser distinto: es lo que dice de quién es la carga.` };

    const habiaSalido = !!inv.enviadoAt;
    try {
        await prisma.$transaction([
            prisma.invitacionCenso.update({ where: { id }, data: { clave, enviadoAt: null, intentos: 0, error: null } }),
            prisma.solicitudPadron.updateMany({ where: { clave: inv.clave }, data: { clave } }),
        ]);
    } catch {
        // Dos personas guardando el mismo código a la vez: la base deja pasar a una sola.
        return { ok: false, error: "Ese código lo acaba de tomar otra persona. Elegí otro." };
    }
    const lotes = (Array.isArray(inv.lotes) ? (inv.lotes as { unitId?: unknown }[]) : []).map((l) => (typeof l?.unitId === "string" ? l.unitId : null));
    await anotarEnLote(lotes, {
        que: "CODIGO_CAMBIADO", persona: inv.nombre || inv.email, userId: inv.userId || undefined,
        detalle: `${pedido == null ? "Se le generó uno nuevo." : "Se le puso uno a mano."}${habiaSalido ? " El correo que ya tenía dejó de servir: queda para enviárselo de nuevo." : ""}`,
    }, { quien, origen: "panel" });
    return { ok: true, clave, igual: false, habiaSalido };
}
