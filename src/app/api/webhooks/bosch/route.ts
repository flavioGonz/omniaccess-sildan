import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { uploadToS3 } from "@/lib/s3";
import { parseBoschPayload, BoschDriver, type BoschIVAEvent } from "@/lib/drivers/BoschDriver";

// Debounce: deviceId+channel -> timestamp
const debounceCache = new Map<string, number>();
const DEBOUNCE_TIME = 3000; // 3s between same-channel events

// ─── GET: Health check + RcpCommand event receiver ──
export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const eventType = searchParams.get("event_type") || searchParams.get("event") || searchParams.get("command");

    // If no event params, return health check
    if (!eventType) {
        return NextResponse.json({
            status: "ok",
            message: "Bosch IVA webhook endpoint is active",
            driver: "Bosch DINION inteox 7100i IR",
            timestamp: new Date().toISOString(),
        });
    }

    // Process RcpCommand-triggered GET event from Alarm Task Editor
    const logPrefix = `[${new Date().toISOString()}]`;
    console.log(`${logPrefix} === Bosch GET Event ===`, Object.fromEntries(searchParams));

    const clientIp = searchParams.get("device_ip") || searchParams.get("ip") ||
        req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
        req.headers.get("x-real-ip");

    const device = await prisma.device.findFirst({
        where: {
            OR: [
                ...(clientIp ? [{ ip: clientIp }] : []),
            ],
            brand: "BOSCH",
        },
    });

    if (!device) {
        console.log(`${logPrefix} ⚠️ Bosch GET: No device for IP=${clientIp}`);
        return NextResponse.json({ status: "device_not_found", ip: clientIp });
    }

    // Debounce
    const channel = searchParams.get("channel") || searchParams.get("rule") || "default";
    const debounceKey = `${device.id}:${channel}`;
    const now = Date.now();
    const lastEvent = debounceCache.get(debounceKey);
    if (lastEvent && now - lastEvent < DEBOUNCE_TIME) {
        return NextResponse.json({ status: "debounced" });
    }
    debounceCache.set(debounceKey, now);

    const count = parseInt(searchParams.get("count") || searchParams.get("object_count") || "0", 10);

    // Try to get snapshot from camera (Bosch is HTTPS-only with self-signed cert — use driver helper)
    let snapshotPath: string | null = null;
    try {
        const imgBuf = await new BoschDriver().getSnapshot(device);
        if (imgBuf && imgBuf.length > 100) {
            const filename = `queue/${device.id}/${Date.now()}.jpg`;
            snapshotPath = await uploadToS3(imgBuf, filename, "image/jpeg");
        }
    } catch (e) {
        console.log(`${logPrefix} Snapshot grab failed:`, e);
    }

    const queueEvent = await prisma.queueEvent.create({
        data: {
            timestamp: new Date(),
            deviceId: device.id,
            channelName: channel,
            channelId: parseInt(searchParams.get("channel_id") || "0", 10),
            peopleCount: count,
            regionId: searchParams.get("region"),
            snapshotPath,
            metadata: JSON.stringify(Object.fromEntries(searchParams)),
        },
    });

    console.log(`${logPrefix} ✅ Bosch GET event saved: ${queueEvent.id} | ${channel} = ${count}`);

    await checkQueueAlerts(device.id, channel, count);

    return NextResponse.json({
        status: "ok",
        eventId: queueEvent.id,
        peopleCount: count,
        channel,
    });
}

// ─── POST: Receive IVA events (queue counting) ─────
export async function POST(req: NextRequest) {
    const logPrefix = `[${new Date().toISOString()}]`;

    try {
        console.log(`${logPrefix} === Bosch Webhook Received ===`);

        const contentType = req.headers.get("content-type") || "";
        let body: any = {};
        let imageBuffer: Buffer | null = null;

        // Handle multipart (image + JSON/form data)
        if (contentType.includes("multipart/form-data")) {
            const formData = await req.formData();
            for (const [key, value] of formData.entries()) {
                if (value instanceof File) {
                    if (value.type.includes("image/")) {
                        imageBuffer = Buffer.from(await value.arrayBuffer());
                    } else {
                        // Try to parse as JSON
                        try {
                            const text = await value.text();
                            body = JSON.parse(text);
                        } catch { /* ignore non-JSON parts */ }
                    }
                } else {
                    body[key] = value;
                }
            }
        } else if (contentType.includes("application/json")) {
            body = await req.json();
        } else {
            // URL-encoded or plain text from Bosch alarm task
            const text = await req.text();
            try {
                body = JSON.parse(text);
            } catch {
                // Parse as query string params (Bosch alarm task format)
                const params = new URLSearchParams(text);
                for (const [k, v] of params.entries()) {
                    body[k] = v;
                }
            }
        }

        console.log(`${logPrefix} Bosch payload:`, JSON.stringify(body).substring(0, 500));

        // Parse the event
        const event = parseBoschPayload(body, contentType);

        // Resolve device by IP or MAC
        const clientIp = body.device_ip || body.deviceIp || body.ip ||
            req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
            req.headers.get("x-real-ip");

        const device = await prisma.device.findFirst({
            where: {
                OR: [
                    ...(clientIp ? [{ ip: clientIp }] : []),
                    ...(event.deviceMac ? [{ mac: event.deviceMac }] : []),
                ],
                brand: "BOSCH",
            },
        });

        if (!device) {
            console.log(`${logPrefix} ⚠️ No Bosch device found for IP=${clientIp} MAC=${event.deviceMac}`);
            return NextResponse.json({ status: "device_not_found", ip: clientIp }, { status: 200 });
        }

        // Debounce check
        const debounceKey = `${device.id}:${event.channelName || event.channelId || "default"}`;
        const now = Date.now();
        const lastEvent = debounceCache.get(debounceKey);
        if (lastEvent && now - lastEvent < DEBOUNCE_TIME) {
            return NextResponse.json({ status: "debounced" });
        }
        debounceCache.set(debounceKey, now);

        // Upload snapshot if present
        let snapshotPath: string | null = null;
        if (imageBuffer && imageBuffer.length > 100) {
            const filename = `queue/${device.id}/${Date.now()}.jpg`;
            snapshotPath = await uploadToS3(imageBuffer, filename, "image/jpeg");
        }

        // Save QueueEvent
        const queueEvent = await prisma.queueEvent.create({
            data: {
                timestamp: event.timestamp,
                deviceId: device.id,
                channelName: event.channelName || event.ruleName || `Canal ${event.channelId || 0}`,
                channelId: event.channelId || 0,
                peopleCount: event.objectCount || 0,
                regionId: event.regionId,
                snapshotPath,
                metadata: JSON.stringify(body),
            },
        });

        console.log(`${logPrefix} ✅ QueueEvent saved: ${queueEvent.id} | ${queueEvent.channelName} = ${queueEvent.peopleCount} personas`);

        // Check alerts
        await checkQueueAlerts(device.id, event.channelName, event.objectCount || 0);

        return NextResponse.json({
            status: "ok",
            eventId: queueEvent.id,
            peopleCount: queueEvent.peopleCount,
            channel: queueEvent.channelName,
        });

    } catch (err: any) {
        console.error(`${logPrefix} ❌ Bosch webhook error:`, err);
        return NextResponse.json({ status: "error", message: err.message }, { status: 500 });
    }
}

// ─── Alert Check ────────────────────────────────────
async function checkQueueAlerts(deviceId: string, channelName: string | null | undefined, count: number) {
    const alerts = await prisma.queueAlert.findMany({
        where: {
            enabled: true,
            OR: [
                { deviceId, channelName: channelName || undefined },
                { deviceId, channelName: null }, // Alerts that apply to all channels
            ],
        },
    });

    const now = new Date();

    for (const alert of alerts) {
        if (count < alert.threshold) continue;

        // Cooldown check
        if (alert.lastFiredAt) {
            const cooldownMs = alert.cooldownMin * 60 * 1000;
            if (now.getTime() - alert.lastFiredAt.getTime() < cooldownMs) continue;
        }

        console.log(`[QueueAlert] 🚨 Alert "${alert.name}" fired: ${count} >= ${alert.threshold} personas`);

        // Update lastFiredAt
        await prisma.queueAlert.update({
            where: { id: alert.id },
            data: { lastFiredAt: now },
        });

        // TODO: Send notification (WhatsApp, email, socket.io event)
    }
}
