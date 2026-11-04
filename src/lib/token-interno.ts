import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * La puerta de las rutas que llama un proceso interno (dispatch-worker, un cron del CT), no una
 * persona: piden el `x-tracking-token`, el mismo secreto que ya usan las rutas «tick» y
 * /api/notifications/event. Están en la lista pública del middleware porque no hay sesión del
 * navegador detrás; sin esta verificación quedaban abiertas a cualquiera (4/11: push/dispatch
 * mandaba notificaciones a todos los teléfonos, queue/reset ponía en cero el aforo, etc.).
 *
 *     const no = await exigirTokenInterno(req); if (no) return no;
 */
export async function exigirTokenInterno(req: Request): Promise<NextResponse | null> {
    let token = process.env.TRACKING_TOKEN || "";
    if (!token) {
        try { token = (await prisma.setting.findUnique({ where: { key: "TRACKING_TOKEN" } }))?.value || ""; } catch { /* sin base: cae a "no autorizado" */ }
    }
    const traido = req.headers.get("x-tracking-token") || "";
    // Sin token configurado, nadie pasa (mejor romper el cron que dejar la ruta abierta).
    if (!token || traido !== token) {
        return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    return null;
}
