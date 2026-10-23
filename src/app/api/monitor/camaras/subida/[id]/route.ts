import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { autorizarMonitor, SIN_CACHE } from "@/lib/monitor/servidor";
import { estadoDe } from "@/lib/monitor/subida";

export const dynamic = "force-dynamic";

/**
 * GET /api/monitor/camaras/subida/<id>: ¿llegó la foto del celular? Mientras no, `{ estado }`. Cuando
 * llegó, la foto misma, UNA sola vez: se marca retirada y se borran los bytes (la pared trabaja
 * desde ahí con la imagen en memoria). Así la foto de un celular no queda en el servidor.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    const p = await autorizarMonitor("/api/monitor/camaras/subida");
    if (p.error) return p.error;
    const { id } = await params;
    const s = await prisma.subidaFoto.findUnique({ where: { id }, select: { vence: true, llego: true, retirada: true, tipo: true } });
    if (!s) return NextResponse.json({ estado: "vencido" }, { headers: SIN_CACHE });
    const estado = estadoDe(s);
    if (estado !== "llego") return NextResponse.json({ estado }, { headers: SIN_CACHE });
    // Retirarla y borrarla en el mismo paso: si dos pestañas preguntan a la vez, sólo una se la lleva.
    const r = await prisma.subidaFoto.updateMany({ where: { id, retirada: null }, data: { retirada: new Date() } });
    if (!r.count) return NextResponse.json({ estado: "retirada" }, { headers: SIN_CACHE });
    const f = await prisma.subidaFoto.findUnique({ where: { id }, select: { foto: true, tipo: true } });
    await prisma.subidaFoto.update({ where: { id }, data: { foto: null } }).catch(() => null);
    if (!f?.foto) return NextResponse.json({ estado: "retirada" }, { headers: SIN_CACHE });
    return new Response(new Uint8Array(f.foto), { headers: { "Content-Type": f.tipo || "image/jpeg", ...SIN_CACHE } });
}
