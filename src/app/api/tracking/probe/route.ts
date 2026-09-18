import { NextRequest, NextResponse } from "next/server";
import { verifyApiAuth, unauthorizedResponse } from "@/lib/api-auth";
import { spawn } from "child_process";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Prueba de una camara: toma un solo cuadro del RTSP con ffmpeg y lo pasa por
 * Omni-LPR. Sirve para saber, antes de dar de alta la camara, si el canal
 * elegido enfoca bien las matriculas.
 */

function capturarCuadro(rtsp: string, segundos = 20): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const ff = spawn("ffmpeg", [
            "-hide_banner", "-loglevel", "error",
            "-rtsp_transport", "tcp",
            "-i", rtsp,
            "-frames:v", "1",
            "-q:v", "3",
            "-f", "image2pipe", "-vcodec", "mjpeg", "pipe:1",
        ]);

        const trozos: Buffer[] = [];
        let err = "";
        const corte = setTimeout(() => { ff.kill("SIGKILL"); reject(new Error("La cámara no respondió a tiempo.")); }, segundos * 1000);

        ff.stdout.on("data", (d) => trozos.push(d));
        ff.stderr.on("data", (d) => { err += d.toString(); });
        ff.on("error", (e) => { clearTimeout(corte); reject(e); });
        ff.on("close", () => {
            clearTimeout(corte);
            const buf = Buffer.concat(trozos);
            if (buf.length < 1000) return reject(new Error(err.trim().split("\n").pop() || "No se pudo leer video del RTSP."));
            resolve(buf);
        });
    });
}

export async function POST(req: NextRequest) {
    const auth = await verifyApiAuth();
    if (!auth.authenticated) return unauthorizedResponse();

    let rtsp = "";
    try { rtsp = String((await req.json())?.rtsp || "").trim(); } catch { }
    if (!rtsp.startsWith("rtsp://") && !rtsp.startsWith("http")) {
        return NextResponse.json({ error: "La URL debe empezar con rtsp:// (o http:// para snapshot)." }, { status: 400 });
    }

    const t0 = Date.now();
    let jpeg: Buffer;
    try {
        jpeg = await capturarCuadro(rtsp);
    } catch (e: any) {
        return NextResponse.json({ error: `No se pudo tomar el cuadro: ${e?.message || e}` }, { status: 502 });
    }
    const msCaptura = Date.now() - t0;

    const lprUrl = (process.env.OMNI_LPR_URL || "http://127.0.0.1:8000").replace(/\/$/, "");
    const t1 = Date.now();
    let lecturas: { plate: string; confidence: number }[] = [];
    let errorLpr: string | null = null;
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
            }))
            .filter((i) => i.plate)
            .sort((a, b) => b.confidence - a.confidence);
    } catch (e: any) {
        errorLpr = e?.message || "Omni-LPR no respondió";
    }
    const msLectura = Date.now() - t1;

    return NextResponse.json({
        ok: true,
        imagen: `data:image/jpeg;base64,${jpeg.toString("base64")}`,
        bytes: jpeg.length,
        msCaptura,
        msLectura,
        lecturas,
        errorLpr,
        umbral: Number(process.env.TRACKING_MIN_CONFIDENCE || 0.6),
    });
}
