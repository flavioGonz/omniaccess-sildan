export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { resolveForCamera } from "@/lib/nvr-resolve";
import { planDeCorte } from "@/lib/clip-nvr";

/**
 * GET /api/nvr/cuadro?deviceId=<id>&t=<epochMs>&w=640
 *
 * Un cuadro de la GRABACIÓN de una cámara en un instante: la foto de un evento que no trajo
 * captura propia. Antes, sin captura, la ficha del evento mostraba la foto EN VIVO de la
 * cámara (otro momento, a veces otra escena si es PTZ). Se cachea en disco por cámara+instante
 * y se limita a 3 extracciones a la vez para no saturar al NVR con una lista de miniaturas.
 */
const DIR = "/tmp/omni-cuadros";
const _g = globalThis as any;
const enCurso: Map<string, Promise<Buffer | null>> = _g.__cuadrosEnCurso ?? (_g.__cuadrosEnCurso = new Map());
let activos = 0; const cola: (() => void)[] = [];
const turno = () => new Promise<void>((r) => { if (activos < 3) { activos++; r(); } else cola.push(() => { activos++; r(); }); });
const liberar = () => { activos--; const n = cola.shift(); if (n) n(); };

async function extraer(deviceId: string, t: number, w: number): Promise<Buffer | null> {
    const cam = await resolveForCamera(deviceId);
    if (!cam) return null;
    const plan = await planDeCorte(cam.nvr, String(cam.ch), t, 4, { forceTx: true });
    await turno();
    try {
        return await new Promise<Buffer | null>((resolve) => {
            const args = ["-allowed_media_types", "video", "-timeout", "8000000", "-rtsp_transport", "tcp", "-i", plan.url, "-frames:v", "1", "-vf", `scale=${w}:-2`, "-q:v", "4", "-f", "image2", "-c:v", "mjpeg", "pipe:1"];
            const ff = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "ignore"] });
            const partes: Buffer[] = [];
            ff.stdout.on("data", (d) => partes.push(d));
            const tope = setTimeout(() => { try { ff.kill("SIGKILL"); } catch { } }, 15000);
            ff.on("close", () => { clearTimeout(tope); const b = Buffer.concat(partes); resolve(b.length > 1000 ? b : null); });
            ff.on("error", () => { clearTimeout(tope); resolve(null); });
        });
    } finally { liberar(); }
}

export async function GET(req: NextRequest) {
    const deviceId = req.nextUrl.searchParams.get("deviceId") || "";
    const t = parseInt(req.nextUrl.searchParams.get("t") || "");
    const w = Math.min(Math.max(parseInt(req.nextUrl.searchParams.get("w") || "640") || 640, 160), 1280);
    if (!deviceId || !/^[\w-]+$/.test(deviceId) || !t || t > Date.now() + 60000) return new Response("bad request", { status: 400 });
    const archivo = path.join(DIR, `${deviceId}_${Math.floor(t / 1000)}_${w}.jpg`);
    try { const b = await fs.promises.readFile(archivo); return new Response(new Uint8Array(b), { headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=86400" } }); } catch { }
    // Un instante del futuro inmediato todavía no está grabado: que el navegador reintente.
    if (Date.now() - t < 8000) return new Response("todavía no", { status: 425 });
    const clave = archivo;
    let p = enCurso.get(clave);
    if (!p) { p = extraer(deviceId, t, w).finally(() => setTimeout(() => enCurso.delete(clave), 1000)); enCurso.set(clave, p); }
    const buf = await p.catch(() => null);
    if (!buf) return new Response("sin grabación en ese instante", { status: 404 });
    try { await fs.promises.mkdir(DIR, { recursive: true }); await fs.promises.writeFile(archivo, buf); } catch { }
    return new Response(new Uint8Array(buf), { headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=86400" } });
}
