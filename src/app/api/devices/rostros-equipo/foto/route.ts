import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/app/actions/auth";
import { permisosDeSesion } from "@/lib/permisos";
import { prisma } from "@/lib/prisma";
import { bajarFoto } from "@/lib/rostros-equipo";

export const dynamic = "force-dynamic";

/**
 * GET ?deviceId=&fpid= → la foto de un rostro cargado en el equipo.
 *
 * Va por acá y no derecho desde el navegador porque la foto vive dentro del equipo, detrás de su
 * digest, y porque así la cara de un vecino nunca sale del servidor hacia una URL con credencial.
 */
export async function GET(req: NextRequest) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- la sesión es el JWT crudo
    const s: any = await getSession().catch(() => null);
    if (!s || !permisosDeSesion(s).includes("dispositivos")) return new NextResponse(null, { status: 403 });

    const deviceId = String(req.nextUrl.searchParams.get("deviceId") || "");
    const fpid = String(req.nextUrl.searchParams.get("fpid") || "");
    if (!deviceId || !fpid) return new NextResponse(null, { status: 400 });

    const d = await prisma.device.findUnique({ where: { id: deviceId }, select: { ip: true, username: true, password: true, authType: true, httpPort: true } });
    if (!d) return new NextResponse(null, { status: 404 });

    const jpeg = await bajarFoto(d, { fpid, nombre: null, fotoUrl: null, modelo: null });
    if (!jpeg) return new NextResponse(null, { status: 404 });
    return new NextResponse(new Uint8Array(jpeg), {
        status: 200,
        headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=120" },
    });
}
