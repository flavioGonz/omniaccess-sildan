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
/** Cuántas se aprueban de una vez como mucho: más que esto se vuelve a apretar (no se corta a la mitad por tiempo). */
const TODAS_MAX = 400;

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
    /* Aprobar todas las sin revisar de una (25/11, Nico: «agregar un botón para aceptar todos los sin
       revisar»). Una por una, de la más vieja a la más nueva, igual que el botón de cada carga: la
       matrícula que ya es de otra persona no se pisa, la ubicación que el lote ya tiene tampoco. */
    if (b?.accion === "aprobar-todas") {
        const pend = await prisma.solicitudPadron.findMany({ where: { estado: "pendiente" }, orderBy: { createdAt: "asc" }, select: { id: true }, take: TODAS_MAX });
        let aprobadas = 0, matriculas = 0, conAvisos = 0; const fallas: string[] = [];
        for (const p of pend) {
            const r = await aprobarSolicitud(p.id, q.quien).catch((e) => ({ ok: false, error: e instanceof Error ? e.message : "no se pudo", matriculas: 0, avisos: [] as string[], unidad: "", persona: "" }));
            if (!r.ok) { fallas.push(r.error || "no se pudo"); continue; }
            aprobadas++; matriculas += r.matriculas; if (r.avisos.some((x) => /ya es de/.test(x))) conAvisos++;
            await auditar(q.sesion, "censo.aprobar", `${r.unidad} · ${r.persona}`, true, `${r.matriculas} matrículas (aprobación de todas). ${r.avisos.join(" ")}`);
        }
        const quedan = await prisma.solicitudPadron.count({ where: { estado: "pendiente" } });
        return NextResponse.json({ ok: true, aprobadas, matriculas, chapasDeOtro: conAvisos, fallas: fallas.slice(0, 5), fallaron: fallas.length, quedan }, { headers: SIN_CACHE });
    }
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
