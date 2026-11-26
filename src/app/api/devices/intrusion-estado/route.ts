/**
 * /api/devices/intrusion-estado?deviceId=…
 *  GET  → la cadena de aviso de una cámara de intrusión, leída en vivo (lib/intrusion-estado).
 *  POST { arreglar: ["servidor" | "centro"] } → agrega OmniAccess como servidor de alarmas y/o el
 *       aviso al centro en las reglas dibujadas. Nunca borra. Devuelve el estado releído.
 */
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/app/actions/auth";
import { leerEstadoIntrusion, arreglarIntrusion } from "@/lib/intrusion-estado";

export const dynamic = "force-dynamic";
const SIN_CACHE = { "Cache-Control": "no-store" };

export async function GET(req: NextRequest) {
    if (!(await getSession())) return NextResponse.json({ ok: false, error: "Hace falta una sesión del panel." }, { status: 401 });
    const id = req.nextUrl.searchParams.get("deviceId");
    if (!id) return NextResponse.json({ ok: false, error: "deviceId requerido" }, { status: 400 });
    return NextResponse.json(await leerEstadoIntrusion(id), { headers: SIN_CACHE });
}

export async function POST(req: NextRequest) {
    const s: any = await getSession();
    if (!s) return NextResponse.json({ ok: false, error: "Hace falta una sesión del panel." }, { status: 401 });
    const { permisosDeSesion } = await import("@/lib/permisos");
    if (!permisosDeSesion(s).includes("dispositivos.editar")) return NextResponse.json({ ok: false, error: "Hace falta el permiso Editar dispositivos." }, { status: 403 });
    const id = req.nextUrl.searchParams.get("deviceId");
    if (!id) return NextResponse.json({ ok: false, error: "deviceId requerido" }, { status: 400 });
    const b = await req.json().catch(() => ({}));
    const que = (Array.isArray(b?.arreglar) ? b.arreglar : []).filter((x: unknown) => x === "servidor" || x === "centro");
    if (!que.length) return NextResponse.json({ ok: false, error: "Nada para arreglar." }, { status: 400 });
    const r = await arreglarIntrusion(id, que);
    const { prisma } = await import("@/lib/prisma");
    const d = await prisma.device.findUnique({ where: { id }, select: { name: true } });
    await prisma.accionSistema.create({ data: { quien: String(s.name || s.sub || "panel"), accion: "equipos.intrusion.arreglar", objetivo: d?.name || id, ok: r.ok, detalle: [...r.hechos, ...r.errores].join(" · ").slice(0, 500) } }).catch(() => { });
    return NextResponse.json({ ...r, estado: await leerEstadoIntrusion(id) }, { headers: SIN_CACHE });
}
