import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import https from "https";

/**
 * GET /api/queue/vca-config?deviceId=xxx
 *
 * Fetches VCA (Video Content Analytics) configuration from a Bosch camera
 * via ONVIF GetVideoAnalyticsConfigurations.
 *
 * Returns the analytics rules (polygons, lines) with their coordinates
 * so the frontend can overlay them on the live video stream.
 */

// ─── Types ─────────────────────────────────────────
export interface VCARule {
    name: string;
    type: "EnteringField" | "LeavingField" | "OccupancyCounting" | "LineCounting" | "Unknown";
    armed: boolean;
    /** Normalized ONVIF coordinates (-1 to 1), converted to percentage (0-100) for SVG overlay */
    points: { x: number; y: number }[];
    /** Original ONVIF normalized coordinates (-1 to 1) */
    rawPoints: { x: number; y: number }[];
}

export interface VCAConfig {
    deviceId: string;
    deviceName: string;
    rules: VCARule[];
    fetchedAt: string;
}

// ─── SOAP Request Helper ───────────────────────────
function onvifRequest(
    ip: string,
    username: string,
    password: string,
    soapBody: string,
    path = "/onvif/media_service"
): Promise<string> {
    return new Promise((resolve, reject) => {
        const auth = Buffer.from(`${username}:${password}`).toString("base64");
        const envelope = `<?xml version="1.0" encoding="UTF-8"?>
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"
            xmlns:trt="http://www.onvif.org/ver10/media/wsdl"
            xmlns:tan="http://www.onvif.org/ver20/analytics/wsdl"
            xmlns:tt="http://www.onvif.org/ver10/schema">
  <s:Body>
    ${soapBody}
  </s:Body>
</s:Envelope>`;

        const parsed = new URL(`https://${ip}${path}`);
        const options: https.RequestOptions = {
            hostname: parsed.hostname,
            port: parsed.port || 443,
            path: parsed.pathname,
            method: "POST",
            headers: {
                "Content-Type": "application/soap+xml; charset=utf-8",
                Authorization: `Basic ${auth}`,
                "Content-Length": Buffer.byteLength(envelope),
            },
            rejectUnauthorized: false,
            timeout: 5000,
        };

        const req = https.request(options, (res) => {
            const chunks: Buffer[] = [];
            res.on("data", (c: Buffer) => chunks.push(c));
            res.on("end", () => {
                const body = Buffer.concat(chunks).toString("utf-8");
                if (res.statusCode && res.statusCode >= 400) {
                    reject(new Error(`ONVIF HTTP ${res.statusCode}: ${body.substring(0, 200)}`));
                } else {
                    resolve(body);
                }
            });
        });
        req.on("error", reject);
        req.on("timeout", () => { req.destroy(); reject(new Error("ONVIF request timeout")); });
        req.end(envelope);
    });
}

// ─── ONVIF Coordinate Conversion ───────────────────
/**
 * Convert Bosch ONVIF normalized coordinates (-1 to 1) to percentage (0-100) for SVG overlay.
 * Bosch convention: x=-1 is left, x=1 is right, y=-1 is BOTTOM, y=1 is TOP (math coords)
 * SVG percentage: 0,0 is top-left, 100,100 is bottom-right
 * → Y axis must be INVERTED: y_pct = ((1 - y) / 2) * 100
 */
function onvifToPercent(x: number, y: number): { x: number; y: number } {
    return {
        x: ((x + 1) / 2) * 100,
        y: ((1 - y) / 2) * 100,
    };
}

// ─── Parse VCA Rules from SOAP XML ─────────────────
function parseVCARules(xml: string): VCARule[] {
    const rules: VCARule[] = [];

    // Handle both tt:Rule and tan:Rule namespaces (media vs analytics service)
    const ruleRegex = /<(?:tt|tan):Rule\s+Name=["']([^"']+)["']\s+Type=["']([^"']+)["'][^>]*>([\s\S]*?)<\/(?:tt|tan):Rule>/gi;
    let match;

    while ((match = ruleRegex.exec(xml)) !== null) {
        const name = match[1];
        const typeUri = match[2];
        const ruleBody = match[3];

        // Determine rule type from the Type URI
        let type: VCARule["type"] = "Unknown";
        if (typeUri.includes("EnteringField")) type = "EnteringField";
        else if (typeUri.includes("LeavingField")) type = "LeavingField";
        else if (typeUri.includes("OccupancyCounting")) type = "OccupancyCounting";
        else if (typeUri.includes("LineCounting")) type = "LineCounting";

        // Check if armed (Bosch-specific parameter)
        const armedMatch = ruleBody.match(/Name=["']Armed["']\s+Value=["']([^"']+)["']/i);
        const armed = armedMatch ? armedMatch[1].toLowerCase() === "true" : true;

        // Extract polygon/polyline points
        const points: { x: number; y: number }[] = [];
        const rawPoints: { x: number; y: number }[] = [];

        // Look for Polygon or Polyline with Point elements
        // Bosch uses single quotes: <tt:Point x='-0.603' y='0.223'/>
        const pointRegex = /<tt:Point\s+x=["']([^"']+)["']\s+y=["']([^"']+)["']\s*\/?>/gi;
        let pointMatch;
        while ((pointMatch = pointRegex.exec(ruleBody)) !== null) {
            const rawX = parseFloat(pointMatch[1]);
            const rawY = parseFloat(pointMatch[2]);
            rawPoints.push({ x: rawX, y: rawY });
            const pct = onvifToPercent(rawX, rawY);
            points.push(pct);
        }

        if (points.length > 0) {
            rules.push({ name, type, armed, points, rawPoints });
        }
    }

    return rules;
}

// ─── GET Handler ───────────────────────────────────
export async function GET(req: NextRequest) {
    try {
        const deviceId = req.nextUrl.searchParams.get("deviceId");

        if (!deviceId) {
            return NextResponse.json({ error: "deviceId is required" }, { status: 400 });
        }

        // Fetch device from database
        const device = await prisma.device.findUnique({
            where: { id: deviceId },
            select: { id: true, name: true, ip: true, username: true, password: true, brand: true },
        });

        if (!device) {
            return NextResponse.json({ error: "Device not found" }, { status: 404 });
        }

        if (device.brand !== "BOSCH") {
            return NextResponse.json({ error: "VCA config only supported for Bosch cameras" }, { status: 400 });
        }

        const ip = device.ip;
        const username = device.username || "admin";
        const password = device.password || "admin";

        // Call GetVideoAnalyticsConfigurations via ONVIF Media Service
        const soapBody = `<trt:GetVideoAnalyticsConfigurations/>`;
        const xml = await onvifRequest(ip, username, password, soapBody);

        // Parse rules from the response
        const rules = parseVCARules(xml);

        const config: VCAConfig = {
            deviceId: device.id,
            deviceName: device.name,
            rules,
            fetchedAt: new Date().toISOString(),
        };

        return NextResponse.json(config);
    } catch (error: any) {
        // Cámara inaccesible (offline / sin ruta / timeout): degradar con elegancia,
        // NO romper el frontend con un 500. Devolvemos reglas vacías + offline:true.
        console.warn("[VCA-Config] cámara no accesible:", error?.message);
        return NextResponse.json(
            { rules: [], offline: true, error: error?.message || "camera unreachable", fetchedAt: new Date().toISOString() },
            { status: 200 },
        );
    }
}
