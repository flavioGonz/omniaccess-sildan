import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendQueueAlertToTelegram } from "@/lib/telegram";
import { uploadToS3 } from "@/lib/s3";
import https from "https";

/**
 * POST /api/onvif/notify
 *
 * Receives ONVIF WSBaseNotification push events from Bosch cameras.
 * The camera POSTs SOAP XML with NotificationMessage whenever a VCA event fires.
 *
 * This is the PUSH side of the hybrid ONVIF subscription model.
 * PullPoint polling runs as fallback in case push doesn't work.
 */

// Track last known counts to deduplicate
const pushLastCounts = new Map<string, number>();

// Track push activity per device to let polling know push is working
const pushActivity = new Map<string, number>();

// IVA occupancy counter for push events (enter +1, leave -1) — YA NO se usa para Aforo
const pushIvaOccupancy = new Map<string, number>();
// Contadores cumulativos de Entrada/Salida (cruces de campo) por push
const pushFlowCounts = new Map<string, number>();

export function isPushActive(deviceId: string): boolean {
    const last = pushActivity.get(deviceId);
    if (!last) return false;
    return Date.now() - last < 60000;
}

export function getPushActivity(): Map<string, number> {
    return pushActivity;
}

function emitBoschEvent(deviceName: string, channelName: string, count: number) {
    try {
        const http = require("http");
        const payload = JSON.stringify({ type: "BOSCH", deviceName, channelName, peopleCount: count });
        const req = http.request({
            hostname: "127.0.0.1",
            port: 10000,
            path: "/internal/emit",
            method: "POST",
            headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) },
            timeout: 2000,
        });
        req.on("error", () => {});
        req.write(payload);
        req.end();
    } catch {}
}

async function grabSnapshot(
    ip: string,
    username: string,
    password: string,
    deviceId: string
): Promise<string | null> {
    return new Promise((resolve) => {
        try {
            const auth = Buffer.from(`${username}:${password}`).toString("base64");
            const agent = new https.Agent({ rejectUnauthorized: false });
            const parsed = new URL(`https://${ip}/snap.jpg?JpegSize=L`);
            const req = https.request({
                hostname: parsed.hostname,
                port: parsed.port || 443,
                path: parsed.pathname + parsed.search,
                method: "GET",
                headers: { Authorization: `Basic ${auth}` },
                agent,
                timeout: 5000,
            }, (res) => {
                if (res.statusCode !== 200) { res.resume(); resolve(null); return; }
                const chunks: Buffer[] = [];
                res.on("data", (c: Buffer) => chunks.push(c));
                res.on("end", async () => {
                    const buf = Buffer.concat(chunks);
                    if (buf.length < 100) { resolve(null); return; }
                    try {
                        const filename = `queue/${deviceId}/${Date.now()}.jpg`;
                        const path = await uploadToS3(buf, filename, "image/jpeg");
                        resolve(path);
                    } catch { resolve(null); }
                });
            });
            req.on("error", () => resolve(null));
            req.on("timeout", () => { req.destroy(); resolve(null); });
            req.end();
        } catch { resolve(null); }
    });
}

async function checkQueueAlerts(deviceId: string, channelName: string, count: number) {
    const alerts = await prisma.queueAlert.findMany({
        where: {
            enabled: true,
            OR: [
                { deviceId, channelName },
                { deviceId, channelName: null },
            ],
        },
    });

    const now = new Date();
    for (const alert of alerts) {
        if (count < alert.threshold) continue;
        if (alert.lastFiredAt) {
            const cooldownMs = alert.cooldownMin * 60 * 1000;
            if (now.getTime() - alert.lastFiredAt.getTime() < cooldownMs) continue;
        }

        console.log(`[ONVIF-Push] Alert "${alert.name}" fired: ${count} >= ${alert.threshold}`);
        await prisma.queueAlert.update({ where: { id: alert.id }, data: { lastFiredAt: now } });

        try {
            const device = await prisma.device.findUnique({
                where: { id: deviceId },
                select: { name: true, ip: true, username: true, password: true },
            });
            if (device) {
                sendQueueAlertToTelegram(
                    alert.name, device.name, device.ip,
                    device.username || "admin", device.password || "admin",
                    channelName, count, alert.threshold
                ).catch(err => console.error(`[Telegram] Push alert error: ${err.message}`));
            }
        } catch {}
    }
}

export async function POST(req: NextRequest) {
    const logPrefix = `[${new Date().toISOString()}] [ONVIF-Push]`;

    try {
        const body = await req.text();

        const msgRegex = /<wsnt:NotificationMessage>([\s\S]*?)<\/wsnt:NotificationMessage>/gi;
        const msgRegex2 = /<NotificationMessage[^>]*>([\s\S]*?)<\/[^>]*NotificationMessage>/gi;

        let messages: string[] = [];
        let m;
        while ((m = msgRegex.exec(body)) !== null) messages.push(m[1]);
        while ((m = msgRegex2.exec(body)) !== null) messages.push(m[1]);

        if (messages.length === 0) {
            const notifyMatch = body.match(/<[^>]*Notify[^>]*>([\s\S]*)<\/[^>]*Notify>/i);
            if (notifyMatch) {
                const inner = notifyMatch[1];
                const innerRegex = /<[^>]*NotificationMessage[^>]*>([\s\S]*?)<\/[^>]*NotificationMessage>/gi;
                while ((m = innerRegex.exec(inner)) !== null) messages.push(m[1]);
            }
        }

        if (messages.length === 0) {
            console.log(`${logPrefix} Received notification but no parseable messages. Body length: ${body.length}`);
            return new NextResponse("OK", { status: 200 });
        }

        let eventsProcessed = 0;

        for (const block of messages) {
            const topicMatch = block.match(/<[^>]*Topic[^>]*>([^<]+)<\/[^>]*Topic>/);
            const topic = topicMatch ? topicMatch[1].trim() : "";

            const isCountEvent = topic.includes("Count") || topic.includes("Occupancy");
            const isIvaEvent = topic.includes("EnteringField") || topic.includes("LeavingField");
            if (!isCountEvent && !isIvaEvent) continue;

            const opMatch = block.match(/PropertyOperation="([^"]+)"/);
            const operation = opMatch ? opMatch[1] : "Unknown";

            let count: number;
            let ruleName: string;

            if (isIvaEvent) {
                const stateMatch = block.match(/Name="State"\s+Value="([^"]+)"/);
                const state = stateMatch ? stateMatch[1] : "false";
                if (state !== "true" || operation === "Initialized") continue;
                count = -1;
                const topicParts = topic.split("/");
                ruleName = topicParts[topicParts.length - 1] || "IVA";
            } else {
                const ruleMatch = block.match(/Name="Rule"\s+Value="([^"]+)"/);
                ruleName = ruleMatch ? ruleMatch[1] : "Unknown";
                const countMatch = block.match(/Name="Count"\s+Value="([^"]+)"/);
                count = countMatch ? parseInt(countMatch[1], 10) : 0;
            }

            const sourceMatch = block.match(/<[^>]*Source[^>]*>([\s\S]*?)<\/[^>]*Source>/);

            const timeMatch = block.match(/UtcTime="([^"]+)"/);
            const utcTime = timeMatch ? timeMatch[1] : new Date().toISOString();

            const sourceIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
                || req.headers.get("x-real-ip")
                || "unknown";

            let device = await prisma.device.findFirst({
                where: { brand: "BOSCH", ip: sourceIp },
            });

            if (!device) {
                device = await prisma.device.findFirst({
                    where: { brand: "BOSCH", deviceType: "QUEUE_COUNTER" },
                });
            }

            if (!device) {
                console.log(`${logPrefix} No Bosch device found for IP ${sourceIp}`);
                continue;
            }

            if (isIvaEvent) {
                // Entrada/Salida cumulativas. NO derivar el aforo de aquí: el aforo lo da el
                // OccupancyCounter nativo (se autocorrige a 0 cuando la fila se vacía). Derivarlo
                // de enter/leave se "pegaba" si la cámara perdía un Leave.
                const isEntering = topic.includes("EnteringField");
                const dirKey = `${device.id}:${isEntering ? "Entrada" : "Salida"}`;
                const cur = pushFlowCounts.get(dirKey) || 0;
                count = cur + 1;
                pushFlowCounts.set(dirKey, count);
                ruleName = isEntering ? "Entrada" : "Salida";
                console.log(`${logPrefix} IVA ${isEntering ? "Enter" : "Leave"} -> ${ruleName}=${count}`);
            }

            const cacheKey = `${device.id}:${ruleName}`;
            const lastCount = pushLastCounts.get(cacheKey);
            if (lastCount === count && operation !== "Initialized") continue;
            pushLastCounts.set(cacheKey, count);

            pushActivity.set(device.id, Date.now());

            if (operation === "Initialized" && lastCount !== undefined) continue;

            const isOccupancy = topic.includes("Occupancy");
            const channelName = ruleName || (isOccupancy ? "Occupancy" : "Counter");

            let snapshotPath: string | null = null;
            if (count > 0 && device.ip && device.username && device.password) {
                snapshotPath = await grabSnapshot(device.ip, device.username, device.password, device.id);
            }

            const queueEvent = await prisma.queueEvent.create({
                data: {
                    timestamp: new Date(utcTime),
                    deviceId: device.id,
                    channelName,
                    channelId: isOccupancy ? 1 : 2,
                    peopleCount: count,
                    regionId: null,
                    snapshotPath,
                    metadata: JSON.stringify({
                        source: "onvif_push",
                        topic,
                        operation,
                        ruleName,
                        sourceIp,
                    }),
                },
            });

            eventsProcessed++;
            console.log(
                `${logPrefix} ${device.name}: ${channelName} = ${count} personas (${operation}) [PUSH] -> ${queueEvent.id}`
            );

            emitBoschEvent(device.name, channelName, count);
            await checkQueueAlerts(device.id, channelName, count);
        }

        if (eventsProcessed > 0) {
            console.log(`${logPrefix} Processed ${eventsProcessed} push events`);
        }

        return new NextResponse("OK", { status: 200 });
    } catch (e: any) {
        console.error(`${logPrefix} Error processing push notification:`, e.message);
        return new NextResponse("OK", { status: 200 });
    }
}
