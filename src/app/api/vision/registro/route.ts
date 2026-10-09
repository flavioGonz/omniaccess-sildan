import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/app/actions/auth";
import { permisosDeSesion } from "@/lib/permisos";
import { guardarAjuste } from "@/lib/ajustes-db";

export const dynamic = "force-dynamic";

/**
 * POST /api/vision/registro  { camaras: string[] }
 *
 * Qué cámaras mira el registro de detecciones. Lista vacía = todas (y una cámara nueva entra
 * sola). Pide Ajustes, como los demás interruptores de visión. vision-worker lo relee cada 30 s.
 */
export async function POST(req: NextRequest) {
    const s: any = await getSession();
    if (!s) return NextResponse.json({ error: "Sin sesión" }, { status: 401 });
    if (!permisosDeSesion(s).includes("ajustes")) return NextResponse.json({ error: "Sólo quien tiene Ajustes puede cambiar esto." }, { status: 403 });
    const b = await req.json().catch(() => null);
    if (!Array.isArray(b?.camaras) || !b.camaras.every((x: unknown) => typeof x === "string")) return NextResponse.json({ error: "Pedido inválido" }, { status: 400 });
    const existen = await prisma.device.findMany({ where: { id: { in: b.camaras }, deviceType: { not: "NVR" as any } }, select: { id: true } });
    const total = await prisma.device.count({ where: { deviceType: { not: "NVR" as any } } });
    const ids = existen.map((d) => d.id);
    // Lista vacía quiere decir "todas": no se puede usar para "ninguna". Para eso está el interruptor.
    if (!ids.length) return NextResponse.json({ error: "Para no registrar ninguna cámara, apagá «Registro de detecciones» en el laboratorio." }, { status: 400 });
    await guardarAjuste("VISION_CAMARAS", JSON.stringify(ids.length === total ? [] : ids));
    return NextResponse.json({ ok: true, camaras: ids.length === total ? [] : ids });
}
