import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/** La sesión de quien pide, con su permiso. `null` y la respuesta de error si no alcanza. */
export async function sesionCon(permiso?: "dispositivos" | "centrales"): Promise<{ s: any; no: null } | { s: null; no: NextResponse }> {
    const { verifyApiAuth } = await import("@/lib/api-auth");
    const a = await verifyApiAuth();
    if (!a.authenticated) return { s: null, no: NextResponse.json({ ok: false, error: "Sin sesión" }, { status: 401 }) };
    if (a.pantalla) return { s: null, no: NextResponse.json({ ok: false, error: "No es una vista de pantalla." }, { status: 403 }) };
    const { getSession } = await import("@/app/actions/auth");
    const { permisosDeSesion } = await import("@/lib/permisos");
    const s: any = await getSession().catch(() => null);
    if (permiso && !permisosDeSesion(s).includes(permiso)) {
        return { s: null, no: NextResponse.json({ ok: false, error: permiso === "centrales" ? "Armar y desarmar pide el permiso «Control de centrales»." : "Esto pide el permiso Dispositivos." }, { status: 403 }) };
    }
    return { s: s || { name: "panel" }, no: null };
}

export async function auditar(s: any, accion: string, objetivo: string, ok: boolean, detalle?: string) {
    await prisma.accionSistema.create({ data: { quien: String(s?.name || s?.sub || "panel"), accion, objetivo, ok, detalle: detalle ? detalle.slice(0, 500) : null } }).catch(() => { });
}
