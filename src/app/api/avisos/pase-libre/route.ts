import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyApiAuth, unauthorizedResponse } from "@/lib/api-auth";
import { TIPO_PASE_LIBRE } from "@/lib/visitas/ajustes-base";

export const dynamic = "force-dynamic";

/**
 * GET /api/avisos/pase-libre → { matriculas: string[] }
 *
 * Las matrículas de los proveedores con pase libre (su vehículo o su credencial de matrícula,
 * igual que los encuentra lib/visitas/motor). 20/10, Nico: «proveedores con pase libre no deben
 * notificar este nuevo sistema de noti». La cuadrilla de mantenimiento entra, recorre y sale todo
 * el día: cada pasada era un merodeo o un patrón en la pila de avisos. La pila (AvisosLpr) pide
 * esta lista y no los muestra; Gestión de alarmas los sigue teniendo, y la lista negra salta
 * siempre (un proveedor en lista negra es justo lo que hay que ver).
 *
 * Con cualquier sesión, también la de un enlace de pantalla: la pared muestra la misma pila.
 */
export async function GET() {
    const auth = await verifyApiAuth();
    if (!auth.authenticated) return unauthorizedResponse();
    const donde = { role: "PROVIDER" as any, tipoVisita: TIPO_PASE_LIBRE };
    const [vehiculos, credenciales] = await Promise.all([
        prisma.vehicle.findMany({ where: { user: donde }, select: { plate: true } }).catch(() => []),
        prisma.credential.findMany({ where: { type: "PLATE" as any, user: donde }, select: { value: true } }).catch(() => []),
    ]);
    const limpiar = (p: unknown) => String(p || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    const matriculas = [...new Set([...vehiculos.map((v) => limpiar(v.plate)), ...credenciales.map((c) => limpiar(c.value))].filter(Boolean))];
    return NextResponse.json({ matriculas }, { headers: { "Cache-Control": "no-store" } });
}
