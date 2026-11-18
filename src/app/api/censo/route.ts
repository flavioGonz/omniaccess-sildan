import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/app/actions/auth";
import { permisosDeSesion } from "@/lib/permisos";
import { auditar } from "@/lib/centrales/sesion";
import { prisma } from "@/lib/prisma";
import { aprobarSolicitud, rechazarSolicitud } from "@/lib/censo-servidor";

export const dynamic = "force-dynamic";
const SIN_CACHE = { "Cache-Control": "no-store" };
/** El censo carga residentes y matrículas: el mismo permiso que editar el padrón. */
const PERMISO = "usuarios.editar";

/**
 * La bandeja del censo (lo que llega de /registro).
 * GET  — las cargas, por estado.
 * POST { id, accion: "aprobar" | "rechazar", motivo? } — resolver una.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- la sesión es el JWT crudo
type Sesion = any;
async function permitido(): Promise<NextResponse | { sesion: Sesion; quien: string }> {
    const s: Sesion = await getSession().catch(() => null);
    if (!s) return NextResponse.json({ error: "Hace falta iniciar sesión." }, { status: 401 });
    if (!permisosDeSesion(s).includes(PERMISO)) return NextResponse.json({ error: "Tu rol no puede dar de alta residentes." }, { status: 403 });
    return { sesion: s, quien: String(s.name || s.sub || "panel") };
}

export async function GET(req: NextRequest) {
    const q = await permitido(); if (q instanceof NextResponse) return q;
    const estado = req.nextUrl.searchParams.get("estado") || "pendiente";
    const where = estado === "todas" ? {} : { estado };
    const [filas, pendientes] = await Promise.all([
        prisma.solicitudPadron.findMany({ where, orderBy: { createdAt: "desc" }, take: 300 }),
        prisma.solicitudPadron.count({ where: { estado: "pendiente" } }),
    ]);
    return NextResponse.json({
        pendientes,
        cargas: filas.map((f) => ({ ...f, createdAt: f.createdAt.toISOString(), revisadaAt: f.revisadaAt?.toISOString() || null, updatedAt: undefined })),
    }, { headers: SIN_CACHE });
}

export async function POST(req: NextRequest) {
    const q = await permitido(); if (q instanceof NextResponse) return q;
    const b = await req.json().catch(() => null);
    const id = String(b?.id || "");
    if (!id) return NextResponse.json({ error: "Falta cuál." }, { status: 400 });

    if (b?.accion === "rechazar") {
        const r = await rechazarSolicitud(id, q.quien, String(b?.motivo || ""));
        if (!r.ok) return NextResponse.json({ error: r.error }, { status: 409 });
        await auditar(q.sesion, "censo.rechazar", id, true, String(b?.motivo || "").slice(0, 200));
        return NextResponse.json({ ok: true });
    }
    const r = await aprobarSolicitud(id, q.quien);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 409 });
    await auditar(q.sesion, "censo.aprobar", `${r.unidad} · ${r.persona}`, true, `${r.matriculas} matrículas. ${r.avisos.join(" ")}`);
    return NextResponse.json(r);
}
