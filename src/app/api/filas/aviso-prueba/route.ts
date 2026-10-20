export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { avisarFila } from "@/lib/filas/avisar";
import { limiteDeFila } from "@/lib/filas/demora";

/**
 * POST /api/filas/aviso-prueba?device=<id>&tipo=lleno|escalamiento → manda el aviso de fila sobre
 * el límite TAL CUAL saldría de verdad (texto, clip del anillo, grupo de Telegram y destinatarios
 * de Despachos), con los números de ahora. Para probar el canal sin esperar a que se llene una
 * fila. Sólo interno o con sesión (middleware: FILAS_INTERNAS).
 */
export async function POST(req: NextRequest) {
    const q = req.nextUrl.searchParams;
    const dev = await prisma.device.findFirst({ where: { deviceType: "QUEUE_COUNTER", ...(q.get("device") ? { id: q.get("device")! } : {}) }, select: { id: true } });
    if (!dev) return NextResponse.json({ ok: false, error: "No hay contadores de fila" }, { status: 404 });
    const ultimo = await prisma.queueEvent.findFirst({ where: { deviceId: dev.id, NOT: { channelName: { in: ["Entrada", "Salida"] } } }, orderBy: { timestamp: "desc" }, select: { peopleCount: true, snapshotPath: true } });
    const limite = await limiteDeFila(dev.id);
    const n = await avisarFila({
        deviceId: dev.id, alerta: "Prueba del aviso", personas: ultimo?.peopleCount ?? 0, limite,
        snapshotPath: ultimo?.snapshotPath || null, tipo: q.get("tipo") === "escalamiento" ? "escalamiento" : "lleno", canal: "Aforo",
    });
    return NextResponse.json({ ok: n > 0, encolados: n });
}
