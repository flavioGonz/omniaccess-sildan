import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyApiAuth, unauthorizedResponse, forbiddenResponse } from "@/lib/api-auth";
import { saludVision, leerInterruptores } from "@/lib/vision";

export const dynamic = "force-dynamic";

/**
 * GET /api/vision/estado — lo que necesita el laboratorio de visión (/admin/vision) al abrir:
 * la salud de omni-vision, los interruptores guardados y las cámaras que se pueden probar.
 *
 * Ruta GET y no acción de servidor por lo mismo que /api/detecciones: la pantalla consulta
 * la salud cada pocos segundos y no tiene que esperar detrás de otra acción.
 */
export async function GET() {
    const auth = await verifyApiAuth();
    if (!auth.authenticated) return unauthorizedResponse();
    if (auth.pantalla) return forbiddenResponse("El laboratorio de visión no es una vista de pantalla.");
    const [vision, interruptores, camaras] = await Promise.all([
        saludVision(),
        leerInterruptores(),
        // Las que tienen video en go2rtc: todo menos los grabadores.
        prisma.device.findMany({ where: { deviceType: { not: "NVR" as any } }, select: { id: true, name: true, deviceType: true }, orderBy: { name: "asc" } }),
    ]);
    return NextResponse.json({ ...vision, ...interruptores, camaras }, { headers: { "Cache-Control": "no-store" } });
}
