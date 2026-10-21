import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyApiAuth, unauthorizedResponse } from "@/lib/api-auth";
import { diagnosticar, estadoImagen } from "@/lib/diagnostico-imagen";

export const dynamic = "force-dynamic";

/** GET ?deviceId= → el último diagnóstico de imagen (lib/diagnostico-imagen). POST ?deviceId= → diagnosticar ahora. */
export async function GET(req: NextRequest) {
    const a = await verifyApiAuth();
    if (!a.authenticated) return unauthorizedResponse();
    const id = req.nextUrl.searchParams.get("deviceId") || "";
    if (!/^[\w-]{1,100}$/.test(id)) return NextResponse.json({ error: "deviceId" }, { status: 400 });
    return NextResponse.json(await estadoImagen(id), { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
    const a = await verifyApiAuth();
    if (!a.authenticated || a.pantalla) return unauthorizedResponse();
    const id = req.nextUrl.searchParams.get("deviceId") || "";
    const d = /^[\w-]{1,100}$/.test(id) ? await prisma.device.findUnique({ where: { id }, select: { id: true, name: true } }) : null;
    if (!d) return NextResponse.json({ error: "No existe ese equipo." }, { status: 404 });
    const e = await diagnosticar(d).catch(() => null);
    if (!e) return NextResponse.json({ error: "No se pudo tomar un cuadro de la cámara." }, { status: 502 });
    return NextResponse.json(await estadoImagen(id));
}
