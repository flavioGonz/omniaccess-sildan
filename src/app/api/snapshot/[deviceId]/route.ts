import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import https from "https";
import { HikvisionDriver } from "@/lib/drivers/HikvisionDriver";
import { resolveForCamera } from "@/lib/nvr-resolve";
import { authenticatedRequest } from "@/lib/digest-auth";

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

// go2rtc levanta el stream on-demand: el primer frame en frío suele fallar (502 en consola).
// Reintentamos una vez tras un respiro para convertir ese 502 transitorio en un snapshot OK.
async function go2rtcFrameRetry(deviceId: string): Promise<Buffer | null> {
    let b = await go2rtcFrame(deviceId);
    if (b) return b;
    await new Promise((r) => setTimeout(r, 1200));
    return await go2rtcFrame(deviceId);
}

/** Snapshot del canal a través del NVR (digest). Para cámaras colgadas de un NVR
 * que no son alcanzables directo. */
async function nvrSnapshot(deviceId: string): Promise<Buffer | null> {
    try {
        const r = await resolveForCamera(deviceId);
        if (!r) return null;
        const { nvr, ch } = r;
        const isDahua = String(nvr.brand).toUpperCase() === "DAHUA";
        const path = isDahua
            ? `/cgi-bin/snapshot.cgi?channel=${ch}`
            : `/ISAPI/Streaming/channels/${ch}01/picture`;
        const data = await authenticatedRequest("GET", path,
            { ip: nvr.ip, username: nvr.user, password: nvr.pass, authType: "DIGEST" } as any,
            { responseType: "arraybuffer", timeout: 6000 });
        const buf = Buffer.from(data as any);
        return buf.length > 1000 ? buf : null;
    } catch { return null; }
}

/**
 * Fotos recién sacadas, por cámara y tamaño, y los pedidos en curso.
 *
 * Una grilla de monitor pide la foto de cada canal cada pocos segundos, y varios operadores
 * miran la misma grilla: sin esto cada pedido iba a la cámara. Medido el 8/10 en el monitor
 * de intrusión: 60 fotos por minuto, 2 s de promedio cada una, 15 MB por minuto. Con la
 * foto de hace menos de FOTO_VIGENTE_MS y el pedido en curso compartido, la cámara recibe a
 * lo sumo un pedido por intervalo, lo vean uno o diez.
 */
const FOTO_VIGENTE_MS = 1500;
const fotos = new Map<string, { buf: Buffer; t: number }>();
const enCurso = new Map<string, Promise<Buffer | null>>();
/** Anchos que se aceptan: los que usan las grillas y el visor. Cualquier otro valor se ignora. */
const ANCHOS = new Set([320, 480, 640, 960, 1280]);

/**
 * GET /api/snapshot/:deviceId[?w=640]
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
            select: { ip: true, username: true, password: true, brand: true, authType: true, deviceType: true },
        });

        if (!device) {
            return NextResponse.json({ error: "Device not found" }, { status: 404 });
        }

        // NVR sin canal concreto (evento atribuido al NVR): no hay snapshot único -> 204 (evita 502 en consola)
        if ((device as any).deviceType === "NVR") {
            return new NextResponse(null, { status: 204 });
        }

        // HIKVISION: capturar por ISAPI con Digest/Basic automatico (driver)
        if (device.brand === "HIKVISION") {
            const w = Number(req.nextUrl.searchParams.get("w") || 0);
            const ancho = ANCHOS.has(w) ? w : undefined;
            const clave = `${deviceId}:${ancho || "max"}`;
            const guardada = fotos.get(clave);
            let buf: Buffer | null = guardada && Date.now() - guardada.t < FOTO_VIGENTE_MS ? guardada.buf : null;
            if (!buf) {
                let p = enCurso.get(clave);
                if (!p) {
                    p = (async () => {
                        let b = await new HikvisionDriver().captureSnapshot(device as any, 1, ancho);
                        if (!b) b = await nvrSnapshot(deviceId);
                        if (!b) b = await go2rtcFrameRetry(deviceId);
                        if (b) fotos.set(clave, { buf: b, t: Date.now() });
                        return b;
                    })().finally(() => enCurso.delete(clave));
                    enCurso.set(clave, p);
                }
                buf = await p;
            }
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
                snapshotUrl = `http://${device.ip}/cgi-bin/snapshot.cgi?channel=1`; break;
            default:
                snapshotUrl = `http://${device.ip}/snap.jpg`;
        }
        let imageBuffer = await fetchSnapshot(snapshotUrl, headers);
        if (!imageBuffer) imageBuffer = await nvrSnapshot(deviceId);
        if (!imageBuffer) imageBuffer = await go2rtcFrameRetry(deviceId);
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
