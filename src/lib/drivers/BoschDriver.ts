/**
 * BoschDriver — Driver for Bosch DINION inteox 7100i IR (NBE-7604-AL-OC)
 *
 * Protocol: HTTPS + ONVIF PullPoint Events
 * Queue counting via Intelligent Video Analytics (IVA Pro)
 *
 * The camera uses HTTPS-only and supports ONVIF events for real-time
 * occupancy and counter data via PullPoint subscriptions.
 */

import https from 'https';
import type { Device, Credential } from '@prisma/client';

const BOSCH_TIMEOUT = 8000;

// Reusable HTTPS agent for self-signed camera certs
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

function httpsGet(url: string, headers: Record<string, string>, timeout = BOSCH_TIMEOUT): Promise<{ status: number; body: string | Buffer; contentType: string }> {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const req = https.request(
            {
                hostname: parsed.hostname,
                port: parsed.port || 443,
                path: parsed.pathname + parsed.search,
                method: 'GET',
                headers,
                agent: httpsAgent,
                timeout,
            },
            (res) => {
                const isImage = (res.headers['content-type'] || '').includes('image');
                const chunks: Buffer[] = [];
                res.on('data', (c: Buffer) => chunks.push(c));
                res.on('end', () => {
                    const buf = Buffer.concat(chunks);
                    resolve({
                        status: res.statusCode || 0,
                        body: isImage ? buf : buf.toString(),
                        contentType: res.headers['content-type'] || '',
                    });
                });
            }
        );
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
        req.end();
    });
}

export class BoschDriver {

    // ─── Device Info ────────────────────────────────────
    async getSystemInfo(device: Device): Promise<{ model?: string; firmware?: string; serial?: string }> {
        try {
            const res = await httpsGet(
                `https://${device.ip}/rcp.xml?command=0x0001&type=T_CHAR&direction=READ&num=1`,
                this.getAuthHeaders(device)
            );
            return { model: 'DINION inteox 7100i IR', firmware: String(res.body).substring(0, 50) };
        } catch (err) {
            console.error(`[BoschDriver] getSystemInfo failed for ${device.ip}:`, err);
            return {};
        }
    }

    // ─── Test Connection ────────────────────────────────
    async testConnection(device: Device): Promise<boolean> {
        try {
            // Use HTTPS snapshot endpoint (camera is HTTPS-only)
            const res = await httpsGet(
                `https://${device.ip}/snap.jpg?JpegSize=S`,
                this.getAuthHeaders(device),
                5000
            );
            return res.status === 200;
        } catch {
            return false;
        }
    }

    // ─── Get Live Counting Data via ONVIF ───────────────
    async getCountingData(device: Device): Promise<{ channels: Array<{ id: number; name: string; count: number }> }> {
        try {
            // Use ONVIF PullPoint for live counting data
            const eventServiceUrl = `https://${device.ip}/onvif/events_service`;

            // Create a short-lived subscription
            const createEnvelope = `<?xml version="1.0" encoding="UTF-8"?>
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"
            xmlns:tev="http://www.onvif.org/ver10/events/wsdl"
            xmlns:wsnt="http://docs.oasis-open.org/wsn/b-2">
  <s:Body>
    <tev:CreatePullPointSubscription>
      <tev:InitialTerminationTime>PT30S</tev:InitialTerminationTime>
    </tev:CreatePullPointSubscription>
  </s:Body>
</s:Envelope>`;

            const createResp = await this.soapRequest(eventServiceUrl, createEnvelope, device);

            // Extract PullPoint URL
            const addrMatch = createResp.match(/<[^>]*Address[^>]*>(https?:\/\/[^<]+)<\/[^>]*Address[^>]*>/);
            if (!addrMatch) return { channels: [] };

            const pullPointUrl = addrMatch[1];

            // Pull messages (short timeout to get current state)
            const pullEnvelope = `<?xml version="1.0" encoding="UTF-8"?>
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"
            xmlns:tev="http://www.onvif.org/ver10/events/wsdl">
  <s:Body>
    <tev:PullMessages>
      <tev:Timeout>PT3S</tev:Timeout>
      <tev:MessageLimit>50</tev:MessageLimit>
    </tev:PullMessages>
  </s:Body>
</s:Envelope>`;

            const pullResp = await this.soapRequest(pullPointUrl, pullEnvelope, device);

            // Parse counter events
            const channels: Array<{ id: number; name: string; count: number }> = [];
            const msgRegex = /<wsnt:NotificationMessage>([\s\S]*?)<\/wsnt:NotificationMessage>/g;
            let match;

            while ((match = msgRegex.exec(pullResp)) !== null) {
                const block = match[1];
                const topicMatch = block.match(/<wsnt:Topic[^>]*>([^<]+)<\/wsnt:Topic>/);
                const topic = topicMatch ? topicMatch[1] : "";

                if (!topic.includes("Count") && !topic.includes("Occupancy")) continue;

                const ruleMatch = block.match(/Name="Rule"\s+Value="([^"]+)"/);
                const countMatch = block.match(/Name="Count"\s+Value="([^"]+)"/);

                channels.push({
                    id: topic.includes("Occupancy") ? 1 : 2,
                    name: ruleMatch ? ruleMatch[1] : (topic.includes("Occupancy") ? "Occupancy" : "Counter"),
                    count: countMatch ? parseInt(countMatch[1], 10) : 0,
                });
            }

            // Best-effort cleanup: unsubscribe so we don't leak the PullPoint subscription on the camera
            try {
                const unsubEnvelope = `<?xml version="1.0" encoding="UTF-8"?>\n<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" xmlns:wsnt="http://docs.oasis-open.org/wsn/b-2"><s:Body><wsnt:Unsubscribe/></s:Body></s:Envelope>`;
                await this.soapRequest(pullPointUrl, unsubEnvelope, device, 4000);
            } catch { /* ignore cleanup errors */ }

            return { channels };
        } catch (err) {
            console.error(`[BoschDriver] getCountingData failed for ${device.ip}:`, err);
            return { channels: [] };
        }
    }

    // ─── Get Snapshot ───────────────────────────────────
    async getSnapshot(device: Device): Promise<Buffer | null> {
        try {
            const res = await httpsGet(
                `https://${device.ip}/snap.jpg?JpegSize=L`,
                this.getAuthHeaders(device)
            );
            if (res.status !== 200) return null;
            return Buffer.isBuffer(res.body) ? res.body : Buffer.from(res.body);
        } catch {
            return null;
        }
    }

    // ─── Credential Management (not supported) ─────────
    async upsertCredential(credential: Credential, device: Device): Promise<void> {
        console.log(`[BoschDriver] upsertCredential not supported for counting cameras`);
    }

    async deleteCredential(credentialValue: string, device: Device): Promise<void> {
        console.log(`[BoschDriver] deleteCredential not supported for counting cameras`);
    }

    // ─── Relay / Output Trigger ─────────────────────────
    async triggerRelay(device: Device): Promise<void> {
        try {
            await httpsGet(
                `https://${device.ip}/rcp.xml?command=0x0D04&type=T_DWORD&direction=WRITE&num=1&payload=1`,
                this.getAuthHeaders(device)
            );
        } catch (err) {
            console.error(`[BoschDriver] triggerRelay failed for ${device.ip}:`, err);
        }
    }

    // ─── SOAP Request Helper ────────────────────────────
    private soapRequest(url: string, envelope: string, device: Device, timeout = 10000): Promise<string> {
        return new Promise((resolve, reject) => {
            const parsed = new URL(url);
            const auth = Buffer.from(`${device.username}:${device.password}`).toString('base64');

            const req = https.request(
                {
                    hostname: parsed.hostname,
                    port: parsed.port || 443,
                    path: parsed.pathname + parsed.search,
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/soap+xml; charset=utf-8',
                        'Authorization': `Basic ${auth}`,
                        'Content-Length': Buffer.byteLength(envelope),
                    },
                    agent: httpsAgent,
                    timeout,
                },
                (res) => {
                    let data = '';
                    res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
                    res.on('end', () => {
                        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                            resolve(data);
                        } else {
                            reject(new Error(`SOAP ${res.statusCode}: ${data.substring(0, 200)}`));
                        }
                    });
                }
            );

            req.on('error', reject);
            req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
            req.write(envelope);
            req.end();
        });
    }

    // ─── Auth Headers ───────────────────────────────────
    private getAuthHeaders(device: Device): Record<string, string> {
        if (device.username && device.password) {
            const encoded = Buffer.from(`${device.username}:${device.password}`).toString('base64');
            return { 'Authorization': `Basic ${encoded}` };
        }
        return {};
    }
}

/**
 * Parse a Bosch IVA webhook payload.
 */
export interface BoschIVAEvent {
    eventType: string;
    ruleName?: string;
    objectCount?: number;
    regionId?: string;
    channelId?: number;
    channelName?: string;
    timestamp: Date;
    deviceIp?: string;
    deviceMac?: string;
    imageData?: Buffer;
}

export function parseBoschPayload(body: any, contentType: string): BoschIVAEvent {
    const event: BoschIVAEvent = {
        eventType: 'iva_counting',
        timestamp: new Date(),
    };

    if (typeof body === 'object' && body !== null) {
        event.eventType = body.event_type || body.eventType || body.type || 'iva_counting';
        event.ruleName = body.rule_name || body.ruleName || body.name;
        event.objectCount = parseInt(body.object_count || body.objectCount || body.count || '0', 10);
        event.regionId = body.region_id || body.regionId || body.region;
        event.channelId = parseInt(body.channel_id || body.channelId || body.channel || '0', 10);
        event.channelName = body.channel_name || body.channelName;
        event.deviceIp = body.device_ip || body.deviceIp || body.ip;
        event.deviceMac = body.device_mac || body.deviceMac || body.mac;
        if (body.timestamp) {
            event.timestamp = new Date(body.timestamp);
        }
    }

    return event;
}
