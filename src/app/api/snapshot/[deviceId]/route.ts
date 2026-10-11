import { NextRequest, NextResponse } from "next/server";
import { resolveNvrById } from "@/lib/nvr-resolve";
import sharp from "sharp";
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
 * GET /api/snapshot/:deviceId
 * Live snapshot from the camera. HIKVISION usa el driver (Digest-aware);
 * otras marcas usan el fetch directo con Basic.
 */
// ── Velocidad (idea de san-nicolas 6e02d9c, adaptada a Olivos) ─────────────────────────
// Medido 11/10 en Olivos: foto completa de una perimetral 260-400 KB en 0,13-1,2 s, pedida
// sin caché por cada baldosa. Pedirla achicada a la cámara (como SN) tarda MÁS (0,7-0,85 s)
// y una cámara contesta 503; por eso se pide completa y se achica acá con sharp.
const FOTO_VIGENTE_MS = 1500;
const _g = globalThis as any;
const fotos: Map<string, { buf: Buffer; t: number }> = _g.__snapFotos ?? (_g.__snapFotos = new Map());
const enCurso: Map<string, Promise<Buffer | null>> = _g.__snapEnCurso ?? (_g.__snapEnCurso = new Map());
const ANCHOS = new Set([320, 480, 640, 960, 1280]);

async function achicar(buf: Buffer, ancho?: number): Promise<Buffer> {
    if (!ancho) return buf;
    try { return await sharp(buf).resize({ width: ancho, withoutEnlargement: true }).jpeg({ quality: 72 }).toBuffer(); }
    catch { return buf; }
}

async function capturarCompleta(device: any, deviceId: string): Promise<Buffer | null> {
    if (device.brand === "HIKVISION") {
        let buf = await new HikvisionDriver().captureSnapshot(device as any);
        if (!buf) buf = await nvrSnapshot(deviceId);
        if (!buf) buf = await go2rtcFrameRetry(deviceId);
        return buf;
    }
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
    return imageBuffer;
}

export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ deviceId: string }> }
) {
    const { deviceId } = await params;

    // Canal de un NVR que todavía no es un equipo (importación): nvrch-<nvrId>-<canal>
    if (deviceId.startsWith("nvrch-")) {
        const k = deviceId.lastIndexOf("-");
        const nvrId = deviceId.slice(6, k); const ch = parseInt(deviceId.slice(k + 1));
        try {
            const conn = await resolveNvrById(nvrId);
            if (!conn || !ch) return new NextResponse(null, { status: 404 });
            const path = String(conn.brand).toUpperCase() === "DAHUA" ? `/cgi-bin/snapshot.cgi?channel=${ch}` : `/ISAPI/Streaming/channels/${ch}01/picture`;
            const data = await authenticatedRequest("GET", path, { ip: conn.ip, username: conn.user, password: conn.pass, authType: "DIGEST" } as any, { responseType: "arraybuffer", timeout: 8000 });
            const w = parseInt(req.nextUrl.searchParams.get("w") || "") || 0;
            const buf = await achicar(Buffer.from(data as any), w || undefined);
            return new NextResponse(new Uint8Array(buf), { headers: { "Content-Type": "image/jpeg", "Cache-Control": "no-store" } });
        } catch { return new NextResponse(null, { status: 502 }); }
    }

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

        // Una sola captura por cámara cada FOTO_VIGENTE_MS, compartida entre pedidos (la
        // grilla, el visor y varios operadores piden la misma cámara a la vez), y achicada
        // en el servidor al ancho pedido (?w=640): 260-400 KB -> ~36 KB en 9 ms con sharp.
        const w = Number(req.nextUrl.searchParams.get("w") || 0);
        const ancho = ANCHOS.has(w) ? w : undefined;
        const guardada = fotos.get(deviceId);
        let full: Buffer | null = guardada && Date.now() - guardada.t < FOTO_VIGENTE_MS ? guardada.buf : null;
        if (!full) {
            let p = enCurso.get(deviceId);
            if (!p) {
                p = capturarCompleta(device, deviceId)
                    .then((buf) => {
                        if (buf) {
                            fotos.set(deviceId, { buf, t: Date.now() });
                            if (fotos.size > 400) { const lim = Date.now() - 60000; for (const [k, v] of fotos) if (v.t < lim) fotos.delete(k); }
                        }
                        return buf;
                    })
                    .finally(() => enCurso.delete(deviceId));
                enCurso.set(deviceId, p);
            }
            full = await p;
        }
        if (!full) return new NextResponse("No snapshot available", { status: 502 });
        const out = await achicar(full, ancho);
        return new NextResponse(out as any, {
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
