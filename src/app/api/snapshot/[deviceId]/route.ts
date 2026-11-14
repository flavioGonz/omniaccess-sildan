import { NextRequest, NextResponse } from "next/server";
import { hostHttp } from "@/lib/host-http";
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
            if (!buf) return new NextResponse(null, { status: 204, headers: { "X-Sin-Foto": "1" } });
            return new NextResponse(buf as any, {
                status: 200,
                headers: {
                    "Content-Type": "image/jpeg",
                    "Cache-Control": "no-cache, no-store, must-revalidate",
                },
            });
        }

        /*
         * Otras marcas (Dahua detrás del NVR de Nicolás, 12/11): la foto sale primero del vivo que
         * go2rtc ya tiene abierto (instantáneo), después del NVR y por último de la cámara. Una
         * cámara que no da foto se recuerda FALLA_MS: antes cada pedido de la grilla esperaba ~20 s
         * a la cámara, al NVR y a go2rtc, y terminaba igual en 502.
         */
        const falla = fallas.get(deviceId);
        if (falla && Date.now() - falla < FALLA_MS) return new NextResponse(null, { status: 204, headers: { "X-Sin-Foto": "1", "Retry-After": "30" } });
        const claveOtra = `${deviceId}:otra`;
        // Miniaturas (listas de dispositivos, áreas): una foto de hasta 30 s alcanza y evita que 40
        // miniaturas a la vez saquen 40 cuadros del video (un ffmpeg cada uno en este servidor sin GPU).
        const wPedido = Number(req.nextUrl.searchParams.get("w") || 0);
        const miniatura = wPedido > 0 && wPedido <= 320;
        const vigencia = miniatura ? 30_000 : FOTO_VIGENTE_MS;
        const responder = async (buf: Buffer) => {
            let out = buf;
            if (wPedido >= 80 && wPedido <= 1920) {
                try { const sharp = (await import("sharp")).default; out = await sharp(buf).resize({ width: wPedido, withoutEnlargement: true }).jpeg({ quality: 75 }).toBuffer(); } catch { }
            }
            return new NextResponse(new Uint8Array(out), { status: 200, headers: { "Content-Type": "image/jpeg", "Cache-Control": miniatura ? "private, max-age=20" : "no-cache, no-store, must-revalidate" } });
        };
        const yaOtra = fotos.get(claveOtra);
        if (yaOtra && Date.now() - yaOtra.t < vigencia) return responder(yaOtra.buf);
        let pOtra = enCurso.get(claveOtra);
        if (!pOtra) {
            pOtra = (async () => {
                await turno();
                let b: Buffer | null = null;
                try {
                    b = await go2rtcFrame(deviceId);
                    if (!b) b = await nvrSnapshot(deviceId);
                    if (!b) b = await fotoDirecta(device);
                } finally { soltarTurno(); }
                if (b) { fotos.set(claveOtra, { buf: b, t: Date.now() }); fallas.delete(deviceId); } else fallas.set(deviceId, Date.now());
                return b;
            })().finally(() => enCurso.delete(claveOtra));
            enCurso.set(claveOtra, pOtra);
        }
        const bOtra = await pOtra;
        if (!bOtra) return new NextResponse(null, { status: 204, headers: { "X-Sin-Foto": "1", "Retry-After": "30" } });
        return responder(bOtra);
    } catch (err: any) {
        console.error(`[Snapshot] Error for device ${deviceId}:`, err.message);
        return new NextResponse("Error fetching snapshot", { status: 500 });
    }
}

/*
 * Sin foto por ningún camino se contesta 204 y no 502 (12/11): una cámara que no manda video
 * (canales 4, 11, 24 de Nicolás) llenaba la consola de errores cada 8 s. Para el <img> es lo
 * mismo (dispara onError y la baldosa dice «Sin foto del canal»), pero no es un error del servidor.
 */
/*
 * A lo sumo FOTOS_A_LA_VEZ fotos sacándose al mismo tiempo (cada una puede ser un ffmpeg de go2rtc o
 * un pedido al NVR por internet). Antes una lista con 40 miniaturas lanzaba 40 a la vez: la CPU se
 * iba al techo y el navegador cortaba pedidos (net::ERR_FAILED).
 */
const FOTOS_A_LA_VEZ = 3;
let enUso = 0;
const espera: Array<() => void> = [];
function turno(): Promise<void> { if (enUso < FOTOS_A_LA_VEZ) { enUso++; return Promise.resolve(); } return new Promise((r) => espera.push(() => { enUso++; r(); })); }
function soltarTurno() { enUso = Math.max(0, enUso - 1); const sig = espera.shift(); if (sig) sig(); }

/** Una cámara que no dio foto por ningún camino: se vuelve a intentar pasado este tiempo. */
const FALLA_MS = 30_000;
const fallas = new Map<string, number>();

/** La foto pedida a la cámara misma (lo de siempre para marcas que no son Hikvision). */
async function fotoDirecta(device: { ip: string; username: string | null; password: string | null; brand: any }): Promise<Buffer | null> {
    try {
        const headers: Record<string, string> = {};
        if (device.username && device.password) {
            headers["Authorization"] = `Basic ${Buffer.from(`${device.username}:${device.password}`).toString("base64")}`;
        }
        let snapshotUrl: string;
        switch (device.brand) {
            case "BOSCH":
                snapshotUrl = `https://${device.ip}/snap.jpg?JpegSize=L`; break;
            case "DAHUA":
                snapshotUrl = `http://${await hostHttp(device.ip)}/cgi-bin/snapshot.cgi?channel=1`; break;
            default:
                snapshotUrl = `http://${await hostHttp(device.ip)}/snap.jpg`;
        }
        return await fetchSnapshot(snapshotUrl, headers);
    } catch { return null; }
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
