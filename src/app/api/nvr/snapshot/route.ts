export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { authenticatedRequest } from "@/lib/digest-auth";
import { resolveNvrById } from "@/lib/nvr-resolve";
import { rtspViaNvr } from "@/lib/go2rtc-sync";
import { spawn } from "child_process";

// GET /api/nvr/snapshot?ch=N&nvr=<id> -> JPEG del canal N del NVR (foto para identificar cámaras)
export async function GET(req: NextRequest) {
    const ch = req.nextUrl.searchParams.get("ch");
    if (!ch || !/^\d+$/.test(ch)) return new Response("bad ch", { status: 400 });
    const conn = await resolveNvrById(req.nextUrl.searchParams.get("nvr"));
    if (!conn) return new Response("no nvr", { status: 404 });
    if (conn.brand === "DAHUA") {
        for (const a of ["DIGEST", "BASIC"]) {
            try {
                const dev: any = { ip: conn.ip, username: conn.user, password: conn.pass, authType: a };
                const buf = await authenticatedRequest("GET", `/cgi-bin/snapshot.cgi?channel=${ch}`, dev, { responseType: "arraybuffer", accept: "image/jpeg", timeout: 12000 });
                return new Response(Buffer.from(buf), { headers: { "Content-Type": "image/jpeg", "Cache-Control": "no-store" } });
            } catch { /* next */ }
        }
        return new Response("err", { status: 502 });
    }
    for (const a of ["DIGEST", "BASIC"]) {
        try {
            const dev: any = { ip: conn.ip, username: conn.user, password: conn.pass, authType: a };
            const buf = await authenticatedRequest("GET", `/ISAPI/Streaming/channels/${ch}01/picture`, dev, { responseType: "arraybuffer", accept: "image/jpeg", timeout: 12000 });
            return new Response(Buffer.from(buf), { headers: { "Content-Type": "image/jpeg", "Cache-Control": "no-store" } });
        } catch { /* try next */ }
    }
    // Algunos canales no dan foto por ISAPI (el VPro de Otto Villa contesta «Invalid Operation» en los
    // de cámaras de otra marca o agregadas por otro protocolo): un cuadro de su video, por el NVR.
    const cuadro = await cuadroRtsp(rtspViaNvr(conn, Number(ch), false)) || await cuadroRtsp(rtspViaNvr(conn, Number(ch), true));
    if (cuadro) return new Response(new Uint8Array(cuadro), { headers: { "Content-Type": "image/jpeg", "Cache-Control": "no-store" } });
    return new Response("err", { status: 502 });
}

/** Un cuadro JPEG de un RTSP (ffmpeg, con tope). */
const CUADRO_MS = 9000;
function cuadroRtsp(url: string): Promise<Buffer | null> {
    return new Promise((resolve) => {
        const partes: Buffer[] = [];
        let listo = false;
        const fin = (b: Buffer | null) => { if (listo) return; listo = true; try { p.kill("SIGKILL"); } catch { } resolve(b); };
        const p = spawn("ffmpeg", ["-v", "error", "-rtsp_transport", "tcp", "-i", url, "-frames:v", "1", "-vf", "scale='min(960,iw)':-2", "-f", "image2", "-vcodec", "mjpeg", "pipe:1"], { stdio: ["ignore", "pipe", "ignore"] });
        const t = setTimeout(() => fin(null), CUADRO_MS);
        p.stdout.on("data", (d: Buffer) => partes.push(d));
        p.on("close", () => { clearTimeout(t); const b = Buffer.concat(partes); fin(b.length > 1000 ? b : null); });
        p.on("error", () => { clearTimeout(t); fin(null); });
    });
}
