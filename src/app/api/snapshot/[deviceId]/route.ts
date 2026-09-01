import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import https from "https";
import { HikvisionDriver } from "@/lib/drivers/HikvisionDriver";

const httpsAgent = new https.Agent({ rejectUnauthorized: false });
const GO2RTC = process.env.GO2RTC_API || "http://127.0.0.1:1984";

// Fallback robusto: si el snapshot ISAPI/HTTP de la cámara falla, sacar un
// frame por go2rtc (que ya tiene el stream RTSP). Funciona para cualquier
// marca/authType siempre que la cámara esté en go2rtc.yaml.
async function go2rtcFrame(deviceId: string): Promise<Buffer | null> {
    try {
        const ctrl = new AbortController();
        const to = setTimeout(() => ctrl.abort(), 8000);
        const res = await fetch(`${GO2RTC}/api/frame.jpeg?src=lpr_${deviceId}`, { cache: "no-store", signal: ctrl.signal });
        clearTimeout(to);
        if (!res.ok) return null;
        const ab = await res.arrayBuffer();
        const buf = Buffer.from(ab);
        return buf.length > 1000 ? buf : null;
    } catch { return null; }
}

/**
 * GET /api/snapshot/:deviceId
 * Live snapshot from the camera. HIKVISION usa el driver (Digest-aware);
 * otras marcas usan el fetch directo con Basic.
 */
export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ deviceId: string }> }
) {
    const { deviceId } = await params;

    try {
        const device = await prisma.device.findUnique({
            where: { id: deviceId },
            select: { ip: true, username: true, password: true, brand: true, authType: true },
        });

        if (!device) {
            return NextResponse.json({ error: "Device not found" }, { status: 404 });
        }

        // HIKVISION: capturar por ISAPI con Digest/Basic automatico (driver)
        if (device.brand === "HIKVISION") {
            let buf = await new HikvisionDriver().captureSnapshot(device as any);
            if (!buf) buf = await go2rtcFrame(deviceId);
            if (!buf) return new NextResponse("No snapshot available", { status: 502 });
            return new NextResponse(buf as any, {
                status: 200,
                headers: {
                    "Content-Type": "image/jpeg",
                    "Cache-Control": "no-cache, no-store, must-revalidate",
                },
            });
        }

        // Otras marcas: fetch directo
        const headers: Record<string, string> = {};
        if (device.username && device.password) {
            headers["Authorization"] = `Basic ${Buffer.from(`${device.username}:${device.password}`).toString("base64")}`;
        }
        let snapshotUrl: string;
        switch (device.brand) {
            case "BOSCH":
                snapshotUrl = `https://${device.ip}/snap.jpg?JpegSize=L`; break;
            case "DAHUA":
                snapshotUrl = `http://${device.ip}/cgi-bin/snapshot.cgi`; break;
            default:
                snapshotUrl = `http://${device.ip}/snap.jpg`;
        }
        let imageBuffer = await fetchSnapshot(snapshotUrl, headers);
        if (!imageBuffer) imageBuffer = await go2rtcFrame(deviceId);
        if (!imageBuffer) return new NextResponse("No snapshot available", { status: 502 });
        return new NextResponse(imageBuffer, {
            status: 200,
            headers: {
                "Content-Type": "image/jpeg",
                "Cache-Control": "no-cache, no-store, must-revalidate",
            },
        });
    } catch (err: any) {
        console.error(`[Snapshot] Error for device ${deviceId}:`, err.message);
        return new NextResponse("Error fetching snapshot", { status: 500 });
    }
}

function fetchSnapshot(url: string, headers: Record<string, string>): Promise<Buffer | null> {
    return new Promise((resolve) => {
        const isHttps = url.startsWith("https");
        const mod = isHttps ? https : require("http");
        const parsed = new URL(url);
        const options: any = {
            hostname: parsed.hostname,
            port: parsed.port || (isHttps ? 443 : 80),
            path: parsed.pathname + parsed.search,
            method: "GET",
            headers,
            timeout: 5000,
        };
        if (isHttps) options.agent = httpsAgent;
        const req = mod.request(options, (res: any) => {
            const chunks: Buffer[] = [];
            res.on("data", (c: Buffer) => chunks.push(c));
            res.on("end", () => resolve(res.statusCode === 200 ? Buffer.concat(chunks) : null));
        });
        req.on("error", () => resolve(null));
        req.on("timeout", () => { req.destroy(); resolve(null); });
        req.end();
    });
}
