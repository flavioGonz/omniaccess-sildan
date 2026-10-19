import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { uploadToS3 } from "@/lib/s3";
import { filasVision } from "@/lib/filas-vision";
import { emitSocket, checkQueueAlerts, evaluateNotificationRules, getMinAlertThreshold } from "@/lib/onvif-polling";

export const dynamic = "force-dynamic";

const GO2RTC = process.env.GO2RTC_API || "http://127.0.0.1:1984";

/**
 * POST /api/queue/vision  { reglaId, deviceId, count, ts }
 *
 * Una regla «Conteo de fila» de OmniVision cambió de número (vision-reglas.js, suavizado con la
 * mediana de los últimos análisis). Entrada interna: el worker manda el x-tracking-token, como el
 * resto de lo que manda vision-worker a la app.
 *
 * Hace lo mismo que el contador de fila de una cámara (lib/onvif-polling): el renglón en
 * QueueEvent con el canal de la fila, el socket queue_update (Filas y el Monitor de filas se
 * actualizan solos), las alertas por umbral y las reglas de notificación de Filas. La foto, igual
 * que allá, sólo cuando la fila llega al umbral de alguna alerta: se saca del stream de la cámara
 * en go2rtc (no de la cámara: en el lab las cámaras son de San Nicolás y sólo se leen) y queda en
 * el bucket de Filas, que es el que saben mandar WhatsApp y Telegram.
 */
export async function POST(req: NextRequest) {
    const token = req.headers.get("x-tracking-token") || "";
    let esperado = process.env.TRACKING_TOKEN || "";
    if (!esperado) esperado = (await prisma.setting.findUnique({ where: { key: "TRACKING_TOKEN" } }).catch(() => null))?.value || "";
    if (!esperado || token !== esperado) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

    const b = await req.json().catch(() => null);
    const reglaId = typeof b?.reglaId === "string" ? b.reglaId : "";
    const deviceId = typeof b?.deviceId === "string" ? b.deviceId : "";
    const count = Math.round(Number(b?.count));
    if (!reglaId || !deviceId || !Number.isFinite(count) || count < 0 || count > 500) return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });

    // La regla manda: el canal y si está prendida salen de la regla guardada, no del pedido.
    const regla = (await filasVision()).find((r) => r.id === reglaId && r.deviceId === deviceId);
    if (!regla) return NextResponse.json({ ok: false, motivo: "La fila no existe o está apagada" });
    const equipo = await prisma.device.findUnique({ where: { id: deviceId }, select: { id: true, name: true } });
    // QueueEvent cuelga de un equipo: un canal suelto de NVR no puede ser una fila (lo dice la pantalla).
    if (!equipo) return NextResponse.json({ ok: false, motivo: "Sólo cámaras dadas de alta como equipo" });

    const canal = regla.canal;
    const ts = Number(b?.ts) > 0 && Math.abs(Date.now() - Number(b.ts)) < 10 * 60_000 ? new Date(Number(b.ts)) : new Date();

    let snapshotPath: string | null = null;
    const umbral = await getMinAlertThreshold(deviceId, canal).catch(() => null);
    if (umbral != null && count >= umbral) snapshotPath = await foto(deviceId);

    const ev = await prisma.queueEvent.create({
        data: {
            timestamp: ts, deviceId, channelName: canal, channelId: 1, peopleCount: count, regionId: regla.id, snapshotPath,
            metadata: JSON.stringify({ source: "omnivision", reglaId: regla.id, regla: regla.nombre }),
        },
    });
    emitSocket("queue_update", {
        deviceId, deviceName: equipo.name, channelName: canal, peopleCount: count, isOccupancy: true,
        operation: "Changed", snapshotPath, timestamp: ts.toISOString(),
    });
    await checkQueueAlerts(deviceId, canal, count, snapshotPath).catch(() => null);
    await evaluateNotificationRules(deviceId, canal, count, snapshotPath).catch(() => null);
    return NextResponse.json({ ok: true, id: ev.id });
}

/** El cuadro de ahora, del stream principal si está, al bucket de Filas. */
async function foto(deviceId: string): Promise<string | null> {
    for (const src of [`lpr_${deviceId}_hd`, `lpr_${deviceId}`]) {
        try {
            const r = await fetch(`${GO2RTC}/api/frame.jpeg?src=${encodeURIComponent(src)}`, { cache: "no-store", signal: AbortSignal.timeout(6000) });
            if (!r.ok) continue;
            const buf = Buffer.from(await r.arrayBuffer());
            if (buf.length < 1000) continue;
            return await uploadToS3(buf, `queue/${deviceId}/${Date.now()}.jpg`, "image/jpeg", "queue");
        } catch { /* la otra fuente */ }
    }
    return null;
}
