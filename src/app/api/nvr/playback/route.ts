export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { spawn } from "child_process";
import { prisma } from "@/lib/prisma";

// El NVR Hikvision (DS-7732NXI, Sildan) interpreta starttime/endtime como HORA LOCAL
// del equipo aunque lleven sufijo Z (verificado: ContentMgmt/search devuelve los
// segmentos con hora local "Z"). Formateamos en la zona del NVR (America/Montevideo).
const NVR_TZ = "America/Montevideo";
function fmtNvr(ms: number): string {
    const d = new Date(ms);
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: NVR_TZ, year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
    }).formatToParts(d);
    const g = (t: string) => parts.find((p) => p.type === t)?.value || "00";
    const hh = g("hour") === "24" ? "00" : g("hour");
    return `${g("year")}${g("month")}${g("day")}T${hh}${g("minute")}${g("second")}Z`;
}

// GET /api/nvr/playback?ch=8&t=<epochMs>&pre=10&dur=40
// Streams recorded video from a Hikvision NVR (RTSP time-based playback) as fragmented MP4.
export async function GET(req: NextRequest) {
    const sp = req.nextUrl.searchParams;
    const ch = sp.get("ch");
    const t = parseInt(sp.get("t") || "0");
    const pre = Math.min(60, Math.max(0, parseInt(sp.get("pre") || "10")));
    const dur = Math.min(180, Math.max(5, parseInt(sp.get("dur") || "40")));
    if (!ch || !/^\d+$/.test(ch) || !t) return new Response("missing ch/t", { status: 400 });

    const rows = await prisma.setting.findMany({ where: { key: { in: ["NVR_HOST", "NVR_USER", "NVR_PASS", "NVR_PORT"] } } });
    const cfg: any = {}; rows.forEach((r: any) => (cfg[r.key] = r.value));
    if (!cfg.NVR_HOST) return new Response("NVR not configured", { status: 404 });

    const startMs = t - pre * 1000;
    const start = fmtNvr(startMs);
    const end = fmtNvr(startMs + dur * 1000);
    const port = cfg.NVR_PORT || "554";
    const url = `rtsp://${cfg.NVR_USER}:${cfg.NVR_PASS}@${cfg.NVR_HOST}:${port}/Streaming/tracks/${ch}01/?starttime=${start}&endtime=${end}`;

    const ff = spawn("ffmpeg", [
        "-rtsp_transport", "tcp",
        "-i", url,
        "-t", String(dur),
        "-an", "-c:v", "copy",
        "-movflags", "frag_keyframe+empty_moov+default_base_moof",
        "-f", "mp4", "pipe:1",
    ], { stdio: ["ignore", "pipe", "ignore"] });

    const stream = new ReadableStream({
        start(controller) {
            ff.stdout.on("data", (d: Buffer) => { try { controller.enqueue(d); } catch { } });
            ff.stdout.on("end", () => { try { controller.close(); } catch { } });
            ff.on("error", () => { try { controller.error(new Error("ffmpeg error")); } catch { } });
            ff.on("close", () => { try { controller.close(); } catch { } });
        },
        cancel() { try { ff.kill("SIGKILL"); } catch { } },
    });

    const headers: Record<string, string> = { "Content-Type": "video/mp4", "Cache-Control": "no-store" };
    if (sp.get("download") === "1") {
        const d = new Date(startMs);
        const p = (n: number) => String(n).padStart(2, "0");
        const fname = `clip_ch${ch}_${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.mp4`;
        headers["Content-Disposition"] = `attachment; filename="${fname}"`;
    }
    return new Response(stream as any, { headers });
}
