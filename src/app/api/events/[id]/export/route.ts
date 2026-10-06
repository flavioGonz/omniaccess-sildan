/** GET /api/events/[id]/export?pre=10&dur=30
 *  Exporta un evento como ZIP: captura.jpg + recorte_matricula.jpg (si hay) + clip.mp4 (NVR, si el
 *  dispositivo está mapeado a un canal) + evento.json. Streamea el zip con archiver. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { ventanaPlayback, acotarVentana, ANTES_MAX, DESPUES_MAX } from "@/lib/ventana-playback";
import { prisma } from "@/lib/prisma";
import { getChannelMap, resolveNvrById, type NvrConn } from "@/lib/nvr-resolve";
import { getS3Client } from "@/lib/s3";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { spawn } from "child_process";
import { PassThrough, Readable } from "stream";
import archiver from "archiver";

const NVR_TZ = "America/Montevideo";
function fmtNvr(ms: number): string {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: NVR_TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).formatToParts(new Date(ms));
    const g = (t: string) => parts.find((p) => p.type === t)?.value || "00";
    const hh = g("hour") === "24" ? "00" : g("hour");
    return `${g("year")}${g("month")}${g("day")}T${hh}${g("minute")}${g("second")}Z`;
}

/** Lee un objeto de MinIO a partir de un path tipo /api/files/<bucket>/<key> */
async function readS3(path: string | null | undefined): Promise<Buffer | null> {
    if (!path) return null;
    const clean = path.replace(/^\/+/, "").replace(/^api\/files\//, "");
    const parts = clean.split("/"); if (parts.length < 2) return null;
    let bucket = parts[0]; if (bucket === "lpr") bucket = process.env.S3_BUCKET || "lpr-prod";
    const key = parts.slice(1).join("/");
    try {
        const s3 = await getS3Client();
        const r = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        if (!r.Body) return null;
        const chunks: Buffer[] = [];
        for await (const ch of r.Body as any) chunks.push(Buffer.from(ch));
        return Buffer.concat(chunks);
    } catch { return null; }
}

function parseDetails(details: string | null) {
    const out: Record<string, string> = {};
    (details || "").split(",").forEach(p => { const i = p.indexOf(":"); if (i > 0) { const k = p.slice(0, i).trim(), v = p.slice(i + 1).trim(); if (k && v) out[k] = v; } });
    return out;
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
    const { id } = await ctx.params;
    // Misma ventana que el visor (Ajustes → Video del evento), salvo que se pida otra.
    const ventana = await ventanaPlayback();
    const pre = req.nextUrl.searchParams.get("pre") != null ? acotarVentana(req.nextUrl.searchParams.get("pre"), null).antes : ventana.antes;
    const dur = req.nextUrl.searchParams.get("dur") != null
        ? Math.min(ANTES_MAX + DESPUES_MAX, Math.max(5, parseInt(req.nextUrl.searchParams.get("dur") || "0", 10) || 5))
        : pre + ventana.despues;
    const ev = await prisma.accessEvent.findUnique({ where: { id }, include: { device: { select: { id: true, name: true, ip: true, location: true } }, user: { select: { name: true, role: true, unit: { select: { name: true } } } } } });
    if (!ev) return new Response("Evento no encontrado", { status: 404 });

    const meta = parseDetails(ev.details);
    const plate = (ev.plateDetected && ev.plateDetected !== "unknown") ? ev.plateDetected : "SIN_MATRICULA";
    const t = new Date(ev.timestamp);
    const p = (n: number) => String(n).padStart(2, "0");
    const stamp = `${t.getFullYear()}${p(t.getMonth() + 1)}${p(t.getDate())}_${p(t.getHours())}${p(t.getMinutes())}${p(t.getSeconds())}`;
    const base = `evento_${plate}_${stamp}`;

    // canal NVR — por el mapa multi-NVR, como el playback. Esta ruta leía el mapa viejo
    // `{ip: canal}` y los settings NVR_HOST/USER/PASS: con el formato `{ip:{nvr,ch}}` el
    // canal daba NaN y el clip iba a "ningún NVR" → todos los ZIP salían con SIN_CLIP.txt.
    let channel: number | null = null; let nvr: NvrConn | null = null;
    try {
        if (ev.device?.ip) {
            const map = await getChannelMap();
            const e = map[ev.device.ip];
            if (e) { channel = Number(e.ch); nvr = await resolveNvrById(e.nvrId); }
        }
    } catch { /* sin NVR */ }

    const zip = archiver("zip", { zlib: { level: 6 } });
    const out = new PassThrough();
    zip.on("error", () => { try { out.end(); } catch { } });
    zip.pipe(out);

    // 1) foto de captura + recorte
    const img = await readS3(ev.imagePath || ev.snapshotPath);
    if (img) zip.append(img, { name: `${base}/captura.jpg` });
    const crop = await readS3(meta.PlateCrop);
    if (crop) zip.append(crop, { name: `${base}/recorte_matricula.jpg` });

    // 2) metadata
    const info = {
        id: ev.id, matricula: plate, fechaHora: ev.timestamp, direccion: ev.direction === "EXIT" ? "Salida" : "Entrada",
        decision: ev.decision, credencial: ev.accessType, dispositivo: ev.device?.name, ubicacion: ev.device?.location, camaraIp: ev.device?.ip,
        usuario: ev.user?.name || null, unidad: ev.user?.unit?.name || null, rol: ev.user?.role || null,
        vehiculo: { marca: meta.Marca || null, color: meta.Color || null, tipo: meta.Tipo || null },
        detalles: meta, canalNvr: channel,
        clip: channel ? { desde: new Date(t.getTime() - pre * 1000).toISOString(), duracionSeg: dur } : null,
        exportadoEn: new Date().toISOString(), sistema: "OmniAccess",
    };
    zip.append(JSON.stringify(info, null, 2), { name: `${base}/evento.json` });

    // 3) clip del NVR (ffmpeg → mp4 con moov al final, apto para reproducir en cualquier player)
    if (channel && nvr) {
        const startMs = t.getTime() - pre * 1000;
        // `tracks` y no `Channels`: `Channels?starttime=` ignora el rango y manda el vivo (ver api/nvr/playback).
        const url = `rtsp://${nvr.user}:${nvr.pass}@${nvr.ip}:${nvr.rtspPort || "554"}/Streaming/tracks/${channel}01?starttime=${fmtNvr(startMs)}&endtime=${fmtNvr(startMs + dur * 1000)}`;
        const ff = spawn("ffmpeg", ["-rtsp_transport", "tcp", "-i", url, "-t", String(dur), "-an", "-c:v", "copy", "-movflags", "frag_keyframe+empty_moov+default_base_moof", "-f", "mp4", "pipe:1"], { stdio: ["ignore", "pipe", "ignore"] });
        const timer = setTimeout(() => { try { ff.kill("SIGKILL"); } catch { } }, (dur + 40) * 1000);
        ff.on("close", () => clearTimeout(timer));
        zip.append(ff.stdout as Readable, { name: `${base}/clip_${dur}s.mp4` });
    } else {
        zip.append("Este evento no tiene grabación asociada (dispositivo sin canal NVR mapeado).", { name: `${base}/SIN_CLIP.txt` });
    }
    zip.finalize();

    const web = new ReadableStream({
        start(controller) {
            out.on("data", (d: Buffer) => { try { controller.enqueue(d); } catch { } });
            out.on("end", () => { try { controller.close(); } catch { } });
            out.on("error", (e) => { try { controller.error(e); } catch { } });
        },
        cancel() { try { zip.abort(); } catch { } },
    });
    return new Response(web as any, { headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="${base}.zip"`, "Cache-Control": "no-store" } });
}
