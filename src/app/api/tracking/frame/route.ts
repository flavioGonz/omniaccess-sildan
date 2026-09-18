import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyApiAuth, unauthorizedResponse } from "@/lib/api-auth";
import { spawn } from "child_process";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Un cuadro de una cámara interior, con la lectura de Omni-LPR opcional.
 * Es lo que alimenta el calibrador: se pide una y otra vez para ver en vivo
 * cómo queda el encuadre y si el lector saca la matrícula.
 */

function capturar(rtsp: string, roi: any, segundos = 20): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const filtros: string[] = [];
        if (roi && roi.w > 0 && roi.h > 0 && (roi.w < 1 || roi.h < 1 || roi.x > 0 || roi.y > 0)) {
            // crop trabaja en pixeles; iw/ih son el ancho y alto de entrada.
            filtros.push(`crop=iw*${roi.w}:ih*${roi.h}:iw*${roi.x}:ih*${roi.y}`);
        }
        const args = [
            "-hide_banner", "-loglevel", "error", "-rtsp_transport", "tcp",
            "-i", rtsp,
            ...(filtros.length ? ["-vf", filtros.join(",")] : []),
            "-frames:v", "1", "-q:v", "3",
            "-f", "image2pipe", "-vcodec", "mjpeg", "pipe:1",
        ];
        const ff = spawn("ffmpeg", args);
        const trozos: Buffer[] = [];
        let err = "";
        const corte = setTimeout(() => { ff.kill("SIGKILL"); reject(new Error("La cámara no respondió a tiempo.")); }, segundos * 1000);
        ff.stdout.on("data", (d) => trozos.push(d));
        ff.stderr.on("data", (d) => { err += d.toString(); });
        ff.on("error", (e) => { clearTimeout(corte); reject(e); });
        ff.on("close", () => {
            clearTimeout(corte);
            const buf = Buffer.concat(trozos);
            if (buf.length < 800) return reject(new Error(err.trim().split("\n").pop() || "No llegó video del RTSP."));
            resolve(buf);
        });
    });
}

export async function POST(req: NextRequest) {
    const auth = await verifyApiAuth();
    if (!auth.authenticated) return unauthorizedResponse();

    const body = await req.json().catch(() => ({} as any));
    const deviceId = String(body?.deviceId || "");
    const leer = body?.leer !== false;
    const roi = body?.roi || null;

    const dev = await prisma.device.findUnique({
        where: { id: deviceId },
        select: { rtspUrl: true, name: true, trackMinConf: true },
    });
    if (!dev?.rtspUrl) {
        return NextResponse.json({ error: "Esa cámara no tiene URL RTSP cargada." }, { status: 400 });
    }

    const t0 = Date.now();
    let jpeg: Buffer;
    try {
        jpeg = await capturar(dev.rtspUrl, roi);
    } catch (e: any) {
        return NextResponse.json({ error: `No se pudo tomar el cuadro: ${e?.message || e}` }, { status: 502 });
    }
    const msCaptura = Date.now() - t0;

    let lecturas: any[] = [];
    let errorLpr: string | null = null;
    let msLectura = 0;
    if (leer) {
        const lprUrl = (process.env.OMNI_LPR_URL || "http://127.0.0.1:8000").replace(/\/$/, "");
        const t1 = Date.now();
        try {
            const r = await fetch(`${lprUrl}/api/v1/tools/detect_and_recognize_plate/invoke`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ image_base64: jpeg.toString("base64") }),
                signal: AbortSignal.timeout(30000),
            });
            if (!r.ok) throw new Error(`Omni-LPR respondió ${r.status}`);
            const d: any = await r.json();
            const items = d?.content?.[0]?.data || [];
            lecturas = (Array.isArray(items) ? items : [])
                .map((i: any) => ({
                    plate: String(i?.text || i?.plate || "").toUpperCase().replace(/[^A-Z0-9]/g, ""),
                    confidence: Number(i?.confidence ?? i?.score ?? 0),
                    // La caja viene en pixeles del cuadro recortado.
                    box: i?.bounding_box || i?.box || i?.bbox || null,
                }))
                .filter((i: any) => i.plate)
                .sort((a: any, b: any) => b.confidence - a.confidence);
        } catch (e: any) {
            errorLpr = e?.message || "Omni-LPR no respondió";
        }
        msLectura = Date.now() - t1;
    }

    return NextResponse.json({
        ok: true,
        camara: dev.name,
        imagen: `data:image/jpeg;base64,${jpeg.toString("base64")}`,
        bytes: jpeg.length,
        msCaptura,
        msLectura,
        lecturas,
        errorLpr,
        umbral: dev.trackMinConf ?? Number(process.env.TRACKING_MIN_CONFIDENCE || 0.6),
    });
}
