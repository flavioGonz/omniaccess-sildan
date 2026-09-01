import { NextRequest, NextResponse } from "next/server";
import https from "https";

/**
 * GET /api/queue/onvif-discover?deviceId=xxx
 *
 * Discovers ONVIF analytics profiles/rules from a Bosch camera.
 * Returns available counter rules, occupancy rules, and their current values.
 */

function httpsRequest(
    url: string,
    method: string,
    body: string | null,
    username: string,
    password: string,
    timeoutMs = 10000
): Promise<string> {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const auth = Buffer.from(`${username}:${password}`).toString("base64");
        const agent = new https.Agent({ rejectUnauthorized: false });

        const headers: Record<string, string> = {
            Authorization: `Basic ${auth}`,
        };
        if (body) {
            headers["Content-Type"] = "application/soap+xml; charset=utf-8";
            headers["Content-Length"] = String(Buffer.byteLength(body));
        }

        const req = https.request(
            {
                hostname: parsed.hostname,
                port: parsed.port || 443,
                path: parsed.pathname + parsed.search,
                method,
                headers,
                agent,
                timeout: timeoutMs,
            } as any,
            (res) => {
                let data = "";
                res.on("data", (c: Buffer) => {
                    data += c.toString();
                });
                res.on("end", () => resolve(data));
            }
        );
        req.on("error", reject);
        req.on("timeout", () => {
            req.destroy();
            reject(new Error("Timeout"));
        });
        if (body) req.write(body);
        req.end();
    });
}

function soapEnvelope(bodyContent: string): string {
    return [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"',
        '            xmlns:tev="http://www.onvif.org/ver10/events/wsdl"',
        '            xmlns:trt="http://www.onvif.org/ver10/media/wsdl"',
        '            xmlns:wsnt="http://docs.oasis-open.org/wsn/b-2">',
        "  <s:Body>",
        bodyContent,
        "  </s:Body>",
        "</s:Envelope>",
    ].join("\n");
}

export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const deviceId = searchParams.get("deviceId");

    if (!deviceId) {
        return NextResponse.json({ error: "deviceId required" }, { status: 400 });
    }

    const { prisma } = await import("@/lib/prisma");
    const device = await prisma.device.findUnique({ where: { id: deviceId } });

    if (!device || !device.ip || !device.username || !device.password) {
        return NextResponse.json(
            { error: "Device not found or missing credentials" },
            { status: 404 }
        );
    }

    const ip = device.ip;
    const user = device.username;
    const pass = device.password;
    const results: any = {
        device: { id: device.id, name: device.name, ip },
        profiles: [],
        rules: [],
        availableTopics: [],
        currentCounts: [],
    };

    try {
        // 1. Get VideoAnalyticsConfigurations
        try {
            const analyticsBody = "    <trt:GetVideoAnalyticsConfigurations/>";
            const resp = await httpsRequest(
                `https://${ip}/onvif/media_service`,
                "POST",
                soapEnvelope(analyticsBody),
                user,
                pass,
                10000
            );

            const configRegex =
                /<[^:]*:?VideoAnalyticsConfiguration[^>]*>([\s\S]*?)<\/[^:]*:?VideoAnalyticsConfiguration>/g;
            let match;
            while ((match = configRegex.exec(resp)) !== null) {
                const block = match[1];
                const nameMatch = block.match(
                    /<[^:]*:?Name>([^<]+)<\/[^:]*:?Name>/
                );
                const tokenMatch = match[0].match(/token="([^"]+)"/);
                if (nameMatch) {
                    results.profiles.push({
                        name: nameMatch[1],
                        token: tokenMatch ? tokenMatch[1] : null,
                    });
                }
            }
        } catch (e: any) {
            results.profiles = [{ error: e.message }];
        }

        // 2. Create PullPoint subscription and pull current events
        try {
            const subBody = [
                "    <tev:CreatePullPointSubscription>",
                "      <tev:InitialTerminationTime>PT60S</tev:InitialTerminationTime>",
                "    </tev:CreatePullPointSubscription>",
            ].join("\n");

            const subResp = await httpsRequest(
                `https://${ip}/onvif/events_service`,
                "POST",
                soapEnvelope(subBody),
                user,
                pass,
                10000
            );

            const addrMatch = subResp.match(
                /<[^>]*Address[^>]*>(https?:\/\/[^<]+)<\/[^>]*Address[^>]*>/
            );

            if (addrMatch) {
                const pullUrl = addrMatch[1];

                // Pull current events
                const pullBody = [
                    "    <tev:PullMessages>",
                    "      <tev:Timeout>PT3S</tev:Timeout>",
                    "      <tev:MessageLimit>100</tev:MessageLimit>",
                    "    </tev:PullMessages>",
                ].join("\n");

                const pullResp = await httpsRequest(
                    pullUrl,
                    "POST",
                    soapEnvelope(pullBody),
                    user,
                    pass,
                    10000
                );

                // Parse events
                const msgRegex =
                    /<wsnt:NotificationMessage>([\s\S]*?)<\/wsnt:NotificationMessage>/g;
                let m;
                while ((m = msgRegex.exec(pullResp)) !== null) {
                    const block = m[1];
                    const topicMatch = block.match(
                        /<wsnt:Topic[^>]*>([^<]+)<\/wsnt:Topic>/
                    );
                    const ruleMatch = block.match(
                        /Name="Rule"\s+Value="([^"]+)"/
                    );
                    const countMatch = block.match(
                        /Name="Count"\s+Value="([^"]+)"/
                    );
                    const opMatch = block.match(
                        /PropertyOperation="([^"]+)"/
                    );

                    results.rules.push({
                        topic: topicMatch ? topicMatch[1] : "unknown",
                        ruleName: ruleMatch ? ruleMatch[1] : null,
                        count: countMatch
                            ? parseInt(countMatch[1], 10)
                            : null,
                        operation: opMatch ? opMatch[1] : null,
                    });
                }
            }
        } catch (e: any) {
            results.pullPointError = e.message;
        }

        // 3. GetEventProperties to discover ALL available topics
        try {
            const propsBody = "    <tev:GetEventProperties/>";
            const propsResp = await httpsRequest(
                `https://${ip}/onvif/events_service`,
                "POST",
                soapEnvelope(propsBody),
                user,
                pass,
                10000
            );

            const topics: string[] = [];
            const tnsRegex = /tns1:[A-Za-z/]+/g;
            let tm;
            while ((tm = tnsRegex.exec(propsResp)) !== null) {
                if (!topics.includes(tm[0])) topics.push(tm[0]);
            }
            results.availableTopics = topics;
        } catch {}

        // 4. Get latest counts from DB
        const latestCounts = await prisma.queueEvent.findMany({
            where: { deviceId },
            distinct: ["channelName"],
            orderBy: { timestamp: "desc" },
            take: 10,
            select: {
                channelName: true,
                peopleCount: true,
                timestamp: true,
            },
        });
        results.currentCounts = latestCounts;

        return NextResponse.json(results);
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
