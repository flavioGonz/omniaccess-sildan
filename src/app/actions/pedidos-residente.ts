"use server";

import { prisma } from "@/lib/prisma";
import { getSession } from "@/app/actions/auth";
import { permisosDeSesion } from "@/lib/permisos";
import { auditar } from "@/lib/centrales/sesion";
import { agregarMatriculaEnLote, quitarMatriculaEnLote } from "@/app/actions/lote-edicion";
import { anotarEnLote } from "@/lib/lote-auditoria";

/**
 * Los pedidos que hacen los residentes desde su portal (26/11): sumar o sacar una matrícula. Se ven y
 * se resuelven en la bandeja del censo. Aprobar pasa por las mismas acciones que el cajón del lote:
 * la matrícula llega a las cámaras (o sale de ellas) y el cambio queda firmado en el historial.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- la sesión es el JWT crudo
async function sesion(permiso: string): Promise<any> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s: any = await getSession().catch(() => null);
    if (!s || !permisosDeSesion(s).includes(permiso)) throw new Error("Tu rol no puede resolver pedidos de residentes.");
    return s;
}

export type PedidoParaRevisar = {
    id: string; tipo: string; chapa: string | null; createdAt: string; detalle: Record<string, string>;
    persona: { id: string; nombre: string; email: string | null; telefono: string | null };
    lote: { id: string; nombre: string } | null;
    /** Si la chapa ya es de otra persona (al pedir sumarla): aprobar no la va a pisar. */
    deOtro: string | null;
};

export async function pedidosPendientes(): Promise<PedidoParaRevisar[]> {
    await sesion("usuarios");
    const filas = await prisma.pedidoResidente.findMany({ where: { estado: "PENDIENTE" }, orderBy: { createdAt: "asc" }, take: 300 });
    if (!filas.length) return [];
    const [gente, lotes, creds] = await Promise.all([
        prisma.user.findMany({ where: { id: { in: [...new Set(filas.map((f) => f.userId))] } }, select: { id: true, name: true, email: true, phone: true } }),
        prisma.unit.findMany({ where: { id: { in: [...new Set(filas.map((f) => f.unitId).filter((x): x is string => !!x))] } }, select: { id: true, name: true } }),
        prisma.credential.findMany({ where: { type: "PLATE", value: { in: filas.map((f) => f.chapa).filter((x): x is string => !!x) } }, select: { value: true, userId: true, user: { select: { name: true } } } }),
    ]);
    const p = new Map(gente.map((g) => [g.id, g])), l = new Map(lotes.map((x) => [x.id, x]));
    return filas.map((f) => {
        const g = p.get(f.userId), otra = creds.find((c) => c.value === f.chapa && c.userId !== f.userId);
        return {
            id: f.id, tipo: f.tipo, chapa: f.chapa, createdAt: f.createdAt.toISOString(), detalle: (f.detalle || {}) as Record<string, string>,
            persona: { id: f.userId, nombre: g?.name || "Persona que ya no está", email: g?.email || null, telefono: g?.phone || null },
            lote: f.unitId && l.get(f.unitId) ? { id: f.unitId, nombre: l.get(f.unitId)!.name } : null,
            deOtro: f.tipo === "MATRICULA_ALTA" && otra ? otra.user?.name || "otra persona" : null,
        };
    });
}

export async function aprobarPedido(id: string): Promise<{ ok: boolean; error?: string }> {
    const s = await sesion("usuarios.editar");
    const f = await prisma.pedidoResidente.findUnique({ where: { id } });
    if (!f || f.estado !== "PENDIENTE") return { ok: false, error: "Ese pedido ya se resolvió." };
    if (!f.unitId || !f.chapa) return { ok: false, error: "El pedido no dice de qué lote es: sumá a la persona a su lote primero." };
    const r = f.tipo === "MATRICULA_BAJA" ? await quitarMatriculaEnLote(f.unitId, f.userId, f.chapa) : await agregarMatriculaEnLote(f.unitId, f.userId, f.chapa);
    if (!r.ok) return r;
    const quien = String(s?.name || s?.sub || "panel");
    await prisma.pedidoResidente.update({ where: { id }, data: { estado: "APROBADO", resueltoPor: quien, resueltoAt: new Date() } });
    await auditar(s, "residentes.pedido.aprobar", f.chapa, true, f.tipo);
    return { ok: true };
}

export async function rechazarPedido(id: string, motivo: string): Promise<{ ok: boolean; error?: string }> {
    const s = await sesion("usuarios.editar");
    const f = await prisma.pedidoResidente.findUnique({ where: { id } });
    if (!f || f.estado !== "PENDIENTE") return { ok: false, error: "Ese pedido ya se resolvió." };
    const quien = String(s?.name || s?.sub || "panel");
    const m = String(motivo || "").replace(/\s+/g, " ").trim().slice(0, 200) || null;
    await prisma.pedidoResidente.update({ where: { id }, data: { estado: "RECHAZADO", motivo: m, resueltoPor: quien, resueltoAt: new Date() } });
    if (f.unitId) await anotarEnLote([f.unitId], { que: "CENSO_RECHAZADA", chapa: f.chapa || undefined, userId: f.userId, detalle: `Pedido del portal rechazado (${f.tipo === "MATRICULA_BAJA" ? "sacar" : "sumar"} ${f.chapa}).${m ? ` ${m}` : ""}` }, { quien, origen: "panel" });
    await auditar(s, "residentes.pedido.rechazar", f.chapa || "", true, m || "");
    return { ok: true };
}
