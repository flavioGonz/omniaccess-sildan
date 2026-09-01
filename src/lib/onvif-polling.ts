/**
 * ONVIF PullPoint Event Polling for Bosch IVA cameras.
 *
 * Uses ONVIF PullPoint subscription to receive real-time VCA events
 * (Occupancy Counter, Line Counter, Motion) from Bosch cameras.
 *
 * Flow:
 * 1. CreatePullPointSubscription on the camera's ONVIF event service
 * 2. PullMessages to get queued events (counter changes, occupancy changes)
 * 3. Parse events and create QueueEvent records in the database
 * 4. Renew subscription before it expires
 */

import https from "https";
import { prisma } from "@/lib/prisma";
import { sendQueueAlertToTelegram, sendTelegramMessage } from "@/lib/telegram";
import { uploadToS3 } from "@/lib/s3";
import { enqueueDispatch } from "@/lib/dispatch-queue";
import { sendWebPushToAll } from "@/lib/webpush";
import { isPushActive } from "@/app/api/onvif/notify/route";

// ─── Types ─────────────────────────────────────────
interface ONVIFSubscription {
    deviceId: string;
    pullPointUrl: string;
    terminationTime: Date;
    lastPull: number;
}

interface ONVIFCountEvent {
    topic: string;       // e.g. "tns1:RuleEngine/CountAggregation/OccupancyCounter"
    ruleName: string;    // e.g. "Occupancy Personas"
    count: number;
    operation: string;   // "Initialized" or "Changed"
    utcTime: string;
}

// ─── Subscription Cache ────────────────────────────
// In-memory cache of active subscriptions per device
const subscriptions = new Map<string, ONVIFSubscription>();

// Track last known count per device+rule to only record changes
const lastKnownCounts = new Map<string, number>();

// ─── IVA Occupancy Counter (in-memory) ─────────────
// For cameras without CountAggregation rules, we track occupancy
// by counting EnteringField (entering=+1) and LeavingField (leaving=-1) events.
const ivaOccupancy = new Map<string, number>(); // deviceId → current occupancy
// Cumulative per-rule entry/exit counters → exposed as their own channels ("Entrada" / "Salida")
const ivaRuleCounts = new Map<string, number>(); // `${deviceId}:Entrada|Salida` → cumulative count

// ─── Camera connectivity / outage tracking ─────────
const consecutiveFailures = new Map<string, number>();
const deviceOffline = new Map<string, boolean>();
const onlineSettled = new Set<string>();
// Suppress the spurious OccupancyCounter 0 that the Bosch interleaves with the real count.
const lastNonZeroOcc = new Map<string, number>(); // deviceId → last time occupancy was > 0
const OCC_ZERO_SUPPRESS_MS = 6000;

// ─── Alert escalation (sustained over-threshold) ───
const overThresholdSince = new Map<string, number>(); // `${deviceId}:${alertId}` → ms first over threshold
const escalatedEpisode = new Set<string>();
let _escalateMin = 5, _escalateMinAt = 0;
async function getEscalateMin(): Promise<number> {
    if (Date.now() - _escalateMinAt < 60000) return _escalateMin;
    try {
        const st = await prisma.setting.findUnique({ where: { key: "QUEUE_ESCALATE_MIN" } });
        _escalateMin = st?.value ? Math.max(1, parseInt(st.value, 10) || 5) : 5;
    } catch { _escalateMin = 5; }
    _escalateMinAt = Date.now();
    return _escalateMin;
}
const OFFLINE_THRESHOLD = 2; // ~2 failed polls (~16s) before declaring an outage

async function getLastOccupancy(deviceId: string): Promise<number> {
    const last = await prisma.queueEvent.findFirst({
        where: { deviceId, channelName: { in: ["Aforo", "Occupancy"] } },
        orderBy: { timestamp: "desc" },
    });
    return last?.peopleCount ?? 0;
}

async function markDeviceOffline(deviceId: string) {
    if (deviceOffline.get(deviceId)) return; // already flagged offline
    deviceOffline.set(deviceId, true);
    onlineSettled.delete(deviceId);
    const open = await prisma.cameraOutage.findFirst({ where: { deviceId, endedAt: null } });
    if (!open) {
        const lastValue = await getLastOccupancy(deviceId);
        await prisma.cameraOutage.create({ data: { deviceId, startedAt: new Date(), lastValue } });
        console.log(`[CameraOutage] 🔴 ${deviceId} offline — outage started (lastValue=${lastValue})`);
        emitSocket("camera_outage", { deviceId, status: "offline", at: new Date().toISOString() });
    }
}

async function markDeviceOnline(deviceId: string) {
    consecutiveFailures.set(deviceId, 0);
    // fast path: already confirmed online and settled
    if (deviceOffline.get(deviceId) === false && onlineSettled.has(deviceId)) return;
    const open = await prisma.cameraOutage.findFirst({ where: { deviceId, endedAt: null } });
    if (open) {
        const now = new Date();
        const durationSec = Math.round((now.getTime() - new Date(open.startedAt).getTime()) / 1000);
        await prisma.cameraOutage.update({ where: { id: open.id }, data: { endedAt: now, durationSec } });
        console.log(`[CameraOutage] 🟢 ${deviceId} back online — outage lasted ${durationSec}s`);
        // carry-over: restore in-memory occupancy from last known DB value
        const lastVal = await getLastOccupancy(deviceId);
        ivaOccupancy.set(deviceId, lastVal);
        emitSocket("camera_outage", { deviceId, status: "online", at: now.toISOString(), durationSec });
        console.log(`[CameraOutage] ♻️ Restored occupancy for ${deviceId}: ${lastVal}`);
    }
    deviceOffline.set(deviceId, false);
    onlineSettled.add(deviceId);
}

// ─── Emit Socket Event for Topology ──────────────
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
        req.on("error", () => {}); // silently ignore
        req.write(payload);
        req.end();
    } catch {}
}

// Emit an arbitrary socket event through the server.js bridge (/internal/emit).
function emitSocket(event: string, data: Record<string, any>) {
    try {
        const http = require("http");
        const payload = JSON.stringify({ __event: event, ...data });
        const req = http.request({
            hostname: "127.0.0.1", port: 10000, path: "/internal/emit", method: "POST",
            headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) },
            timeout: 2000,
        });
        req.on("error", () => {});
        req.write(payload);
        req.end();
    } catch {}
}

// ─── HTTPS Request Helper ──────────────────────────
function httpsRequest(
    url: string,
    body: string,
    username: string,
    password: string,
    timeoutMs = 15000
): Promise<string> {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const auth = Buffer.from(`${username}:${password}`).toString("base64");

        const options: https.RequestOptions = {
            hostname: parsed.hostname,
            port: parsed.port || 443,
            path: parsed.pathname + parsed.search,
            method: "POST",
            headers: {
                "Content-Type": "application/soap+xml; charset=utf-8",
                "Authorization": `Basic ${auth}`,
                "Content-Length": Buffer.byteLength(body),
            },
            rejectAuthorized: false,
            timeout: timeoutMs,
        } as any;

        // Force skip TLS verification for self-signed camera certs
        const agent = new https.Agent({ rejectUnauthorized: false });
        (options as any).agent = agent;

        const req = https.request(options, (res) => {
            let data = "";
            res.on("data", (chunk: Buffer) => { data += chunk.toString(); });
            res.on("end", () => {
                if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                    resolve(data);
                } else {
                    reject(new Error(`HTTPS ${res.statusCode}: ${data.substring(0, 200)}`));
                }
            });
        });

        req.on("error", reject);
        req.on("timeout", () => {
            req.destroy();
            reject(new Error(`Timeout after ${timeoutMs}ms`));
        });

        req.write(body);
        req.end();
    });
}

// ─── ONVIF SOAP Envelopes ──────────────────────────
function createPullPointEnvelope(terminationSeconds = 300): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"
            xmlns:tev="http://www.onvif.org/ver10/events/wsdl"
            xmlns:wsnt="http://docs.oasis-open.org/wsn/b-2">
  <s:Body>
    <tev:CreatePullPointSubscription>
      <tev:InitialTerminationTime>PT${terminationSeconds}S</tev:InitialTerminationTime>
    </tev:CreatePullPointSubscription>
  </s:Body>
</s:Envelope>`;
}

function pullMessagesEnvelope(timeoutSeconds = 5, messageLimit = 100): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"
            xmlns:tev="http://www.onvif.org/ver10/events/wsdl">
  <s:Body>
    <tev:PullMessages>
      <tev:Timeout>PT${timeoutSeconds}S</tev:Timeout>
      <tev:MessageLimit>${messageLimit}</tev:MessageLimit>
    </tev:PullMessages>
  </s:Body>
</s:Envelope>`;
}

function renewSubscriptionEnvelope(terminationSeconds = 300): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"
            xmlns:wsnt="http://docs.oasis-open.org/wsn/b-2">
  <s:Body>
    <wsnt:Renew>
      <wsnt:TerminationTime>PT${terminationSeconds}S</wsnt:TerminationTime>
    </wsnt:Renew>
  </s:Body>
</s:Envelope>`;
}

// ─── Parse ONVIF Events ────────────────────────────
function parseCountEvents(xml: string, deviceId?: string): ONVIFCountEvent[] {
    const events: ONVIFCountEvent[] = [];

    // Match NotificationMessage blocks
    const msgRegex = /<wsnt:NotificationMessage>([\s\S]*?)<\/wsnt:NotificationMessage>/g;
    let match: RegExpExecArray | null;

    while ((match = msgRegex.exec(xml)) !== null) {
        const block = match[1];

        // Extract topic
        const topicMatch = block.match(/<wsnt:Topic[^>]*>([^<]+)<\/wsnt:Topic>/);
        const topic = topicMatch ? topicMatch[1] : "";

        // Extract operation
        const opMatch = block.match(/PropertyOperation="([^"]+)"/);
        const operation = opMatch ? opMatch[1] : "Unknown";

        // Extract timestamp
        const timeMatch = block.match(/UtcTime="([^"]+)"/);
        const utcTime = timeMatch ? timeMatch[1] : new Date().toISOString();

        // ── CountAggregation events (have Name="Count") ──
        if (topic.includes("Count") || topic.includes("Occupancy")) {
            const ruleMatch = block.match(/Name="Rule"\s+Value="([^"]+)"/);
            const ruleName = ruleMatch ? ruleMatch[1] : "Unknown";

            const countMatch = block.match(/Name="Count"\s+Value="([^"]+)"/);
            const count = countMatch ? parseInt(countMatch[1], 10) : 0;

            events.push({ topic, ruleName, count, operation, utcTime });
            continue;
        }

        // ── Health / tamper events (camera moved/covered, image too bright/dark) ──
        if (deviceId && /GlobalSceneChange|ImageTooBright|ImageTooDark/.test(topic)) {
            const stateMatch = block.match(/Name="State"\s+Value="([^"]+)"/);
            const state = stateMatch ? stateMatch[1] : "false";
            if (state === "true" && operation !== "Initialized") {
                const kind = topic.includes("GlobalSceneChange") ? "tamper" : topic.includes("ImageTooBright") ? "bright" : "dark";
                fireHealthAlert(deviceId, kind).catch(() => {});
            }
            continue;
        }

        // ── IVA EnteringField / LeavingField events (boolean State) ──
        // These fire when someone enters or leaves a detection field.
        // We use them to maintain an in-memory occupancy counter.
        if (deviceId && (topic.includes("EnteringField") || topic.includes("LeavingField"))) {
            const stateMatch = block.match(/Name="State"\s+Value="([^"]+)"/);
            const state = stateMatch ? stateMatch[1] : "false";

            // Only process state=true (event triggered), ignore state=false (cleared)
            // Also skip "Initialized" events — those are just initial state reports
            if (state !== "true" || operation === "Initialized") continue;

            const isEntering = topic.includes("EnteringField");

            // Maintain occupancy estimate (fallback for cameras without OccupancyCounting)
            const currentOcc = ivaOccupancy.get(deviceId) || 0;
            const newOcc = isEntering ? currentOcc + 1 : Math.max(0, currentOcc - 1);
            ivaOccupancy.set(deviceId, newOcc);

            // Per-rule cumulative entry/exit counters, exposed as their own channels.
            const counterChannel = isEntering ? "Entrada" : "Salida";
            const ckey = `${deviceId}:${counterChannel}`;
            const newCount = (ivaRuleCounts.get(ckey) || 0) + 1;
            ivaRuleCounts.set(ckey, newCount);

            console.log(`[ONVIF-IVA] ${isEntering ? "➡️ Entrada" : "⬅️ Salida"} #${newCount} (ocupación≈${newOcc})`);

            // Emit the entry/exit counter as its own channel so the UI can show each value.
            events.push({
                topic,
                ruleName: counterChannel,
                count: newCount,
                operation: "Changed",
                utcTime,
            });
        }
    }

    return events;
}

const healthFiredAt = new Map<string, number>();
async function fireHealthAlert(deviceId: string, kind: string) {
    const key = `${deviceId}:${kind}`;
    const now = Date.now();
    if (now - (healthFiredAt.get(key) || 0) < 120000) return; // 2-min cooldown per device+kind
    healthFiredAt.set(key, now);
    try {
        const dev = await prisma.device.findUnique({ where: { id: deviceId }, select: { name: true, ip: true, username: true, password: true } });
        if (!dev) return;
        let snapshotPath: string | null = null;
        try { snapshotPath = await grabSnapshot(dev.ip, dev.username, dev.password, deviceId); } catch {}
        const meta: any = ({
            tamper: { title: "Cámara movida o tapada", emoji: "🚧", desc: "La escena cambió drásticamente: la cámara pudo ser movida, girada o tapada. El aforo de esta fila puede no ser confiable." },
            bright: { title: "Imagen demasiado clara", emoji: "🔆", desc: "Imagen sobreexpuesta (sol/contraluz). El conteo puede ser poco fiable." },
            dark: { title: "Imagen demasiado oscura", emoji: "🌑", desc: "Imagen subexpuesta (poca luz). El conteo puede ser poco fiable." },
        } as any)[kind] || { title: "Alerta de cámara", emoji: "⚠️", desc: "" };
        const text = `${meta.emoji} ${meta.title}\n📍 ${dev.name}\n${meta.desc}`;
        emitSocket("queue_alert", { alertName: meta.title, deviceName: dev.name, channelName: "Salud", peopleCount: 0, threshold: 0, snapshotPath: snapshotPath || null, health: kind, timestamp: new Date().toISOString() });
        sendWebPushToAll({ title: meta.title, body: dev.name + " — " + meta.desc, url: "/pwa/filas" }).catch(() => {});
        const recipients = await getDispatchRecipientsRaw();
        for (const rcp of recipients) {
            if (!rcp || !rcp.enabled || !rcp.channel || !rcp.address) continue;
            await enqueueDispatch({
                type: "ALERT", channel: rcp.channel, deviceId,
                payload: {
                    ruleName: meta.title, deviceName: dev.name, channelName: "Salud", count: 0, threshold: 0,
                    snapshotPath: snapshotPath || null, text,
                    chatId: rcp.address, to: rcp.address, email: rcp.address,
                    recipientName: rcp.name || rcp.address, recipientChannel: rcp.channel,
                    timestamp: new Date().toISOString(),
                },
            });
        }
        console.log(`[ONVIF-Health] ${kind} → ${dev.name} (${recipients.length} dest.)`);
    } catch (e: any) { console.error("[ONVIF-Health]", e.message); }
}

// ─── Create or Get Subscription ────────────────────
async function ensureSubscription(
    deviceId: string,
    ip: string,
    username: string,
    password: string
): Promise<ONVIFSubscription | null> {
    const existing = subscriptions.get(deviceId);

    // If subscription exists and not expired (with 30s buffer), reuse it
    if (existing && existing.terminationTime.getTime() > Date.now() + 30000) {
        return existing;
    }

    // If subscription exists but expiring soon, try to renew
    if (existing) {
        try {
            const renewResp = await httpsRequest(
                existing.pullPointUrl,
                renewSubscriptionEnvelope(300),
                username,
                password,
                10000
            );
            const termMatch = renewResp.match(/<wsnt:TerminationTime>([^<]+)<\/wsnt:TerminationTime>/);
            if (termMatch) {
                existing.terminationTime = new Date(termMatch[1]);
                console.log(`[ONVIF] Renewed subscription for ${ip}, expires ${existing.terminationTime.toISOString()}`);
                return existing;
            }
        } catch (e) {
            console.log(`[ONVIF] Renewal failed for ${ip}, creating new subscription`);
            subscriptions.delete(deviceId);
        }
    }

    // Create new subscription
    try {
        const eventServiceUrl = `https://${ip}/onvif/events_service`;
        const resp = await httpsRequest(
            eventServiceUrl,
            createPullPointEnvelope(300),
            username,
            password,
            10000
        );

        // Extract PullPoint URL
        const addrMatch = resp.match(/<[^>]*Address[^>]*>(https?:\/\/[^<]+)<\/[^>]*Address[^>]*>/);
        const termMatch = resp.match(/<wsnt:TerminationTime>([^<]+)<\/wsnt:TerminationTime>/);

        if (!addrMatch) {
            console.error(`[ONVIF] No PullPoint address in response from ${ip}`);
            return null;
        }

        const sub: ONVIFSubscription = {
            deviceId,
            pullPointUrl: addrMatch[1],
            terminationTime: termMatch ? new Date(termMatch[1]) : new Date(Date.now() + 300000),
            lastPull: Date.now(),
        };

        subscriptions.set(deviceId, sub);
        console.log(`[ONVIF] Created subscription for ${ip}: ${sub.pullPointUrl}`);
        return sub;
    } catch (e: any) {
        console.error(`[ONVIF] Failed to create subscription for ${ip}:`, e.message);
        return null;
    }
}

// ─── Grab Snapshot from Camera ─────────────────────
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
            const req = https.request(
                {
                    hostname: parsed.hostname,
                    port: parsed.port || 443,
                    path: parsed.pathname + parsed.search,
                    method: "GET",
                    headers: { Authorization: `Basic ${auth}` },
                    agent,
                    timeout: 5000,
                },
                (res) => {
                    if (res.statusCode !== 200) {
                        res.resume();
                        resolve(null);
                        return;
                    }
                    const chunks: Buffer[] = [];
                    res.on("data", (c: Buffer) => chunks.push(c));
                    res.on("end", async () => {
                        const buf = Buffer.concat(chunks);
                        if (buf.length < 100) { resolve(null); return; }
                        try {
                            const filename = `queue/${deviceId}/${Date.now()}.jpg`;
                            const path = await uploadToS3(buf, filename, "image/jpeg", "queue");
                            resolve(path);
                        } catch {
                            resolve(null);
                        }
                    });
                }
            );
            req.on("error", () => resolve(null));
            req.on("timeout", () => { req.destroy(); resolve(null); });
            req.end();
        } catch {
            resolve(null);
        }
    });
}

// ─── Main Poll Function ────────────────────────────
export async function pollBoschDevices(): Promise<{
    devicesPolled: number;
    eventsCreated: number;
    errors: string[];
}> {
    const logPrefix = `[${new Date().toISOString()}] [ONVIF-Poll]`;
    const result = { devicesPolled: 0, eventsCreated: 0, errors: [] as string[] };

    // Get all Bosch QUEUE_COUNTER devices
    const devices = await prisma.device.findMany({
        where: {
            brand: "BOSCH",
            deviceType: "QUEUE_COUNTER",
        },
    });

    if (devices.length === 0) {
        console.log(`${logPrefix} No Bosch QUEUE_COUNTER devices found`);
        return result;
    }

    for (const device of devices) {
        if (!device.ip || !device.username || !device.password) {
            result.errors.push(`Device ${device.name} missing IP or credentials`);
            continue;
        }

        result.devicesPolled++;

        try {
            // Ensure we have an active subscription
            const sub = await ensureSubscription(device.id, device.ip, device.username, device.password);
            if (!sub) {
                result.errors.push(`Failed to subscribe to ${device.name} (${device.ip})`);
                // Connectivity: subscription failure counts toward an outage
                const fails = (consecutiveFailures.get(device.id) || 0) + 1;
                consecutiveFailures.set(device.id, fails);
                if (fails >= OFFLINE_THRESHOLD) {
                    await markDeviceOffline(device.id).catch(() => {});
                }
                continue;
            }

            // Pull messages
            const pullResp = await httpsRequest(
                sub.pullPointUrl,
                pullMessagesEnvelope(1, 100),
                device.username,
                device.password,
                10000
            );

            sub.lastPull = Date.now();

            // Update device online status
            prisma.device.update({
                where: { id: device.id },
                data: { lastOnlinePull: new Date() },
            }).catch(() => {});

            // Connectivity: confirm online & close any open outage (carry-over restore)
            await markDeviceOnline(device.id).catch(() => {});

            // Parse counter events (including IVA enter/leave for occupancy tracking)
            const events = parseCountEvents(pullResp, device.id);

            for (const evt of events) {
                // Only process "Changed" events (skip "Initialized" to avoid duplicates on subscription creation).
                // Initialized events fire on every re-subscription and often carry a transient 0,
                // which would corrupt the live occupancy — so we only update the cache, never record.
                const cacheKey = `${device.id}:${evt.ruleName}`;
                const lastCount = lastKnownCounts.get(cacheKey);

                // Record on ANY value change (Changed OR Initialized with a new value), so the
                // occupancy resyncs with the camera after each re-subscription. Skip only when the
                // value is identical to avoid noise/flicker.
                // Si el PUSH (WS-BaseNotification) está entregando eventos en vivo, el poll
                // NO inserta (evita doble-conteo). El poll queda como fallback si el push cae.
                if (isPushActive(device.id)) { lastKnownCounts.set(cacheKey, evt.count); continue; }
                if (lastCount === evt.count) {
                    continue;
                }

                lastKnownCounts.set(cacheKey, evt.count);

                // Determine channel name from topic
                const isOccupancy = evt.topic.includes("Occupancy");
                const channelName = evt.ruleName || (isOccupancy ? "Occupancy" : "Counter");

                // Real-time: record exactly what the camera sends (incl. 0). Stability via camera rebote.

                // Capturar foto SOLO cuando el aforo alcanza/supera el umbral de alerta de esta fila.
                let snapshotPath: string | null = null;
                const isAforoCh = isOccupancy || /aforo|occupancy|ocupaci/i.test(channelName || "");
                const snapThreshold = await getMinAlertThreshold(device.id, channelName);
                if (isAforoCh && snapThreshold !== null && evt.count >= snapThreshold) {
                    snapshotPath = await grabSnapshot(device.ip, device.username, device.password, device.id);
                }

                // Create QueueEvent
                const queueEvent = await prisma.queueEvent.create({
                    data: {
                        timestamp: new Date(evt.utcTime),
                        deviceId: device.id,
                        channelName,
                        channelId: isOccupancy ? 1 : 2,
                        peopleCount: evt.count,
                        regionId: null,
                        snapshotPath,
                        metadata: JSON.stringify({
                            source: "onvif_pullpoint",
                            topic: evt.topic,
                            operation: evt.operation,
                            ruleName: evt.ruleName,
                        }),
                    },
                });

                result.eventsCreated++;
                console.log(
                    `${logPrefix} ✅ ${device.name}: ${channelName} = ${evt.count} personas (${evt.operation}) → ${queueEvent.id}`
                );

                // Emit socket event for topology animation
                emitBoschEvent(device.name, channelName, evt.count);

                // Emit queue_update so the Filas/Monitor pages can update + animate entry/exit
                emitSocket("queue_update", {
                    deviceId: device.id,
                    deviceName: device.name,
                    channelName,
                    peopleCount: evt.count,
                    isOccupancy,
                    operation: evt.operation,
                    snapshotPath,
                    timestamp: new Date(evt.utcTime).toISOString(),
                });

                // Check alerts
                await checkQueueAlerts(device.id, channelName, evt.count, snapshotPath);
                await evaluateNotificationRules(device.id, channelName, evt.count, snapshotPath).catch(() => {});
            }

            if (events.length === 0) {
                console.log(`${logPrefix} ${device.name}: no new events`);
            }
        } catch (e: any) {
            const errMsg = `Error polling ${device.name} (${device.ip}): ${e.message}`;
            console.error(`${logPrefix} ❌ ${errMsg}`);
            result.errors.push(errMsg);

            // Remove broken subscription
            subscriptions.delete(device.id);

            // Connectivity: count consecutive failures → declare outage after threshold
            const fails = (consecutiveFailures.get(device.id) || 0) + 1;
            consecutiveFailures.set(device.id, fails);
            if (fails >= OFFLINE_THRESHOLD) {
                await markDeviceOffline(device.id).catch(() => {});
            }
        }
    }

    return result;
}

// ─── Alert Check (same logic as webhook route) ─────
// ── Evaluate NotificationRules → enqueue dispatches (Notificaciones/Despachos) ──
const METRIC_CHANNELS: Record<string, string[]> = {
    aforo: ["Aforo", "Occupancy", "Ocupación", "Ocupacion"],
    entrada: ["Entrada"],
    salida: ["Salida"],
};
function _hhmm(d: Date) { return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; }
function _isoDay(d: Date) { const x = d.getDay(); return x === 0 ? 7 : x; }

async function evaluateNotificationRules(deviceId: string, channelName: string | null | undefined, count: number, snapshotPath?: string | null) {
    let rules: any[];
    try { rules = await prisma.notificationRule.findMany({ where: { enabled: true } }); }
    catch { return; }
    if (!rules.length) return;
    const now = new Date();
    const day = String(_isoDay(now));
    const hhmm = _hhmm(now);
    const ch = channelName || "";
    for (const r of rules) {
        if (r.deviceId && r.deviceId !== deviceId) continue;
        if (r.channelName && r.channelName !== ch) continue;
        const allowed = METRIC_CHANNELS[r.metric] || METRIC_CHANNELS.aforo;
        if (!allowed.includes(ch)) continue;
        if (!r.daysOfWeek.split(",").includes(day)) continue;
        if (!(r.startTime <= hhmm && hhmm <= r.endTime)) continue;
        const op = r.operator;
        const pass = op === ">=" ? count >= r.threshold : op === ">" ? count > r.threshold : op === "==" ? count === r.threshold : op === "<=" ? count <= r.threshold : false;
        if (!pass) continue;
        if (r.dedupe && r.lastFiredAt && (now.getTime() - new Date(r.lastFiredAt).getTime()) < r.cooldownSec * 1000) continue;
        try {
            await prisma.notificationRule.update({ where: { id: r.id }, data: { lastFiredAt: now } });
            const dev = await prisma.device.findUnique({ where: { id: deviceId }, select: { name: true } });
            for (const channel of r.channels.split(",").map((x: string) => x.trim()).filter(Boolean)) {
                await enqueueDispatch({
                    type: "ALERT", channel, ruleId: r.id, deviceId,
                    payload: {
                        ruleName: r.name, deviceName: dev?.name || "Fila",
                        channelName: ch || "Aforo", count, threshold: r.threshold,
                        metric: r.metric, snapshotPath: snapshotPath || null,
                        timestamp: now.toISOString(),
                    },
                });
            }
            console.log(`[NotifRule] 📨 "${r.name}" → encolado (${r.channels}) count=${count}`);
        } catch (e: any) { console.error(`[NotifRule] error enqueue ${r.name}: ${e.message}`); }
    }
}

async function getDispatchRecipientsRaw(): Promise<any[]> {
    try { const st = await prisma.setting.findUnique({ where: { key: "DISPATCH_RECIPIENTS" } }); return st?.value ? JSON.parse(st.value) : []; } catch { return []; }
}

// Umbral minimo de alerta habilitada para un dispositivo/canal (para gatear la captura de fotos).
async function getMinAlertThreshold(deviceId: string, channelName: string | null | undefined): Promise<number | null> {
    const alerts = await prisma.queueAlert.findMany({
        where: {
            enabled: true,
            OR: [
                { deviceId, channelName: channelName || undefined },
                { deviceId, channelName: null },
                { deviceId: null, channelName: channelName || undefined },
                { deviceId: null, channelName: null },
            ],
        },
        select: { threshold: true },
    });
    if (!alerts.length) {
        // Fallback: si ninguna alerta coincide con el canal exacto, usar el umbral mínimo
        // de cualquier alerta habilitada del dispositivo o global (tolerante a nombres de canal).
        const any = await prisma.queueAlert.findMany({ where: { enabled: true, OR: [{ deviceId }, { deviceId: null }] }, select: { threshold: true } });
        if (!any.length) return null;
        return Math.min(...any.map(a => a.threshold));
    }
    return Math.min(...alerts.map(a => a.threshold));
}

async function checkQueueAlerts(deviceId: string, channelName: string | null | undefined, count: number, snapshotPath?: string | null) {
    const alerts = await prisma.queueAlert.findMany({
        where: {
            enabled: true,
            OR: [
                { deviceId, channelName: channelName || undefined },
                { deviceId, channelName: null },
                { deviceId: null, channelName: channelName || undefined },
                { deviceId: null, channelName: null },
            ],
        },
    });

    const now = new Date();
    const escalateMin = await getEscalateMin();

    for (const alert of alerts) {
        const ekey = `${deviceId}:${alert.id}`;
        if (count < alert.threshold) {
            overThresholdSince.delete(ekey);
            escalatedEpisode.delete(ekey);
            continue;
        }

        // Sustained over-threshold → escalate (2nd-level notice for the supervisor)
        if (!overThresholdSince.has(ekey)) overThresholdSince.set(ekey, now.getTime());
        const sustainedMin = (now.getTime() - (overThresholdSince.get(ekey) as number)) / 60000;
        if (sustainedMin >= escalateMin && !escalatedEpisode.has(ekey)) {
            escalatedEpisode.add(ekey);
            const mins = Math.round(sustainedMin);
            console.log(`[QueueAlert] 🔴 ESCALATION "${alert.name}" sustained ${mins}min >= threshold ${alert.threshold}`);
            try {
                const dev = await prisma.device.findUnique({ where: { id: deviceId }, select: { name: true } });
                emitSocket("queue_alert", {
                    alertName: alert.name, deviceName: dev?.name || "Fila",
                    channelName: channelName || "General", peopleCount: count,
                    threshold: alert.threshold, snapshotPath: snapshotPath || null,
                    escalated: true, sustainedMin: mins, timestamp: new Date().toISOString(),
                });
                sendTelegramMessage(
                    `🔴 <b>ESCALAMIENTO — Avisar SUPERVISOR</b>\n` +
                    `📍 ${dev?.name || "Fila"} · ${channelName || "Aforo"}\n` +
                    `El aforo (<b>${count}</b>) supera el umbral (${alert.threshold}) desde hace <b>${mins} min</b>.\n` +
                    `<i>Regla: ${alert.name}</i>`
                ).catch(() => {});
                // Critical-event trigger: enqueue an episode report for dispatch
                enqueueDispatch({ type: "REPORT", channel: "telegram", deviceId, payload: { period: "daily", deviceId, reason: "escalation", ruleName: alert.name } }).catch(() => {});
            } catch (e) { console.warn(`[QueueAlert] escalation dispatch failed "${alert.name}":`, e); }
        }

        if (alert.lastFiredAt) {
            const cooldownMs = (((alert as any).cooldownSec ?? alert.cooldownMin * 60)) * 1000;
            if (now.getTime() - alert.lastFiredAt.getTime() < cooldownMs) continue;
        }

        console.log(`[QueueAlert] 🚨 Alert "${alert.name}" fired: ${count} >= ${alert.threshold} personas`);

        await prisma.queueAlert.update({
            where: { id: alert.id },
            data: { lastFiredAt: now },
        });

        // Dispatch to all configured recipients via the Redis queue (pro)
        try {
            const dev2 = await prisma.device.findUnique({ where: { id: deviceId }, select: { name: true } });
            const recipients = await getDispatchRecipientsRaw();
            for (const rcp of recipients) {
                if (!rcp || !rcp.enabled || !rcp.channel || !rcp.address) continue;
                await enqueueDispatch({
                    type: "ALERT", channel: rcp.channel, deviceId,
                    payload: {
                        ruleName: alert.name, deviceName: dev2?.name || "Fila",
                        channelName: channelName || "Aforo", count, threshold: alert.threshold,
                        snapshotPath: snapshotPath || null,
                        chatId: rcp.address, to: rcp.address, email: rcp.address,
                        recipientName: rcp.name || rcp.address, recipientChannel: rcp.channel,
                        timestamp: now.toISOString(), alertTs: now.getTime(),
                    },
                });
            }
        } catch (e) { console.error("[QueueAlert] recipients dispatch error", e); }

        // Send Telegram notification with snapshot photo + push a live toast to the UI
        try {
            const device = await prisma.device.findUnique({
                where: { id: deviceId },
                select: { name: true, ip: true, username: true, password: true },
            });
            if (device) {
                // Live toast (with photo) for all open dashboards
                emitSocket("queue_alert", {
                    alertName: alert.name,
                    deviceName: device.name,
                    channelName: channelName || "General",
                    peopleCount: count,
                    threshold: alert.threshold,
                    snapshotPath: snapshotPath || null,
                    timestamp: new Date().toISOString(),
                });
                sendQueueAlertToTelegram(
                    alert.name,
                    device.name,
                    device.ip,
                    device.username || "admin",
                    device.password || "admin",
                    channelName || "General",
                    count,
                    alert.threshold
                ).catch(err => console.error(`[Telegram] Failed to send alert: ${err.message}`));
                // Web Push to installed PWAs
                sendWebPushToAll({
                    title: `Aforo ${count} \u00b7 ${device.name}`,
                    body: `Super\u00f3 el umbral (${alert.threshold}). Regla: ${alert.name}`,
                    url: "/pwa/filas",
                }).catch(() => {});
            }
        } catch (err: any) {
            console.error(`[Telegram] Error preparing alert: ${err.message}`);
        }
    }
}

// ─── Get Active Subscriptions Info ─────────────────
export function getActiveSubscriptions(): Array<{
    deviceId: string;
    pullPointUrl: string;
    expiresAt: string;
    lastPull: string;
}> {
    return Array.from(subscriptions.entries()).map(([deviceId, sub]) => ({
        deviceId,
        pullPointUrl: sub.pullPointUrl,
        expiresAt: sub.terminationTime.toISOString(),
        lastPull: new Date(sub.lastPull).toISOString(),
    }));
}

// ─── Auto-Polling Manager ──────────────────────────
let pollInterval: ReturnType<typeof setInterval> | null = null;
let isPolling = false;

// ── ONVIF push (WS-BaseNotification): la cámara empuja eventos a /api/onvif/notify en vivo ──
const ONVIF_PUSH_URL = process.env.ONVIF_PUSH_URL || "http://192.168.99.99:10001/api/onvif/notify";
let pushRenewInterval: ReturnType<typeof setInterval> | null = null;

function subscribeEnvelope(consumerUrl: string, terminationSeconds = 120): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" xmlns:wsa="http://www.w3.org/2005/08/addressing" xmlns:wsnt="http://docs.oasis-open.org/wsn/b-2">
 <s:Body><wsnt:Subscribe>
  <wsnt:ConsumerReference><wsa:Address>${consumerUrl}</wsa:Address></wsnt:ConsumerReference>
  <wsnt:InitialTerminationTime>PT${terminationSeconds}S</wsnt:InitialTerminationTime>
 </wsnt:Subscribe></s:Body></s:Envelope>`;
}

async function subscribePushForAll() {
    try {
        const devices = await prisma.device.findMany({
            where: { deviceType: "QUEUE_COUNTER", brand: "BOSCH" },
            select: { id: true, name: true, ip: true, username: true, password: true },
        });
        for (const d of devices) {
            try {
                await httpsRequest(`https://${d.ip}/onvif/events_service`,
                    subscribeEnvelope(ONVIF_PUSH_URL, 120),
                    d.username || "admin", d.password || "admin", 10000);
                console.log(`[ONVIF-Push] Subscribed ${d.name} -> ${ONVIF_PUSH_URL}`);
            } catch (e: any) {
                console.warn(`[ONVIF-Push] Subscribe failed ${d.name}: ${e?.message || e}`);
            }
        }
    } catch { /* noop */ }
}

export async function startPushSubscriptions() {
    await subscribePushForAll();
    if (!pushRenewInterval) pushRenewInterval = setInterval(() => { subscribePushForAll().catch(() => {}); }, 90000);
}

export function startAutoPolling(intervalMs = 1000) {
    if (pollInterval) {
        console.log("[ONVIF-Poll] Auto-polling already running");
        return;
    }

    console.log(`[ONVIF-Poll] Starting auto-polling every ${intervalMs / 1000}s`);
    startPushSubscriptions().catch(() => {});
    pollInterval = setInterval(async () => {
        if (isPolling) return; // Skip if previous poll still running
        isPolling = true;
        try {
            await pollBoschDevices();
        } catch (e: any) {
            console.error("[ONVIF-Poll] Auto-poll error:", e.message);
        } finally {
            isPolling = false;
        }
    }, intervalMs);
}

export function stopAutoPolling() {
    if (pollInterval) {
        clearInterval(pollInterval);
        pollInterval = null;
        console.log("[ONVIF-Poll] Auto-polling stopped");
    }
}

// Reset in-memory queue counters for a device (called at store opening).
export function resetQueueCounters(deviceId: string) {
    ivaOccupancy.set(deviceId, 0);
    for (const key of Array.from(ivaRuleCounts.keys())) {
        if (key.startsWith(deviceId + ":")) ivaRuleCounts.set(key, 0);
    }
    for (const key of Array.from(lastKnownCounts.keys())) {
        if (key.startsWith(deviceId + ":")) lastKnownCounts.delete(key);
    }
    console.log(`[QueueReset] In-memory counters reset for device ${deviceId}`);
}

export function isAutoPollingActive(): boolean {
    return pollInterval !== null;
}
