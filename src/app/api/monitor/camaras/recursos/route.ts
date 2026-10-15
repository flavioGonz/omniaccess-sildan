export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import os from "os";
import fs from "fs";
import { NextResponse } from "next/server";
import { autorizarMonitor, SIN_CACHE } from "@/lib/monitor/servidor";
import { medirAhora } from "@/lib/salud-ahora";
import { cargaVision } from "@/lib/vision-camaras";

/**
 * GET /api/monitor/camaras/recursos → lo que cuesta la pared ahora mismo en el servidor: CPU,
 * memoria, GPU y cuántos vivos está sirviendo go2rtc (directos y convertidos).
 *
 * Por qué en la pared (pedido 15/10): convertir H.265 a H.264 es lo único de la pared que le
 * cuesta CPU al servidor, y comparte esa CPU con la lectura de matrículas. Quien arma las
 * vistas tiene que ver el precio de lo que pone en pantalla mientras lo pone.
 *
 * Una sola medida compartida por el proceso (como /api/gpu/vivo): con diez pantallas abiertas
 * sigue siendo a lo sumo un nvidia-smi y una consulta a go2rtc cada VIGENCIA_MS.
 */
const GO2RTC = process.env.GO2RTC_API || "http://127.0.0.1:1984";
const VIGENCIA_MS = 2500;

/** activos: streams con alguien mirando; espectadores: navegadores conectados (sin contar al servidor sacando fotos). */
type Video = { activos: number; convertidos: number; directos: number; espectadores: number };
let cache: { t: number; r: any } | null = null;
let enCurso: Promise<any> | null = null;

/** Uso de CPU entre dos lecturas de /proc/stat (el CT ve el del host: es lo que importa acá). */
let previo: { ocupado: number; total: number } | null = null;
function usoCpu(): number | null {
    try {
        const l = fs.readFileSync("/proc/stat", "utf8").split("\n")[0].trim().split(/\s+/).slice(1).map(Number);
        const inactivo = (l[3] || 0) + (l[4] || 0);
        const total = l.reduce((a, b) => a + (b || 0), 0);
        const actual = { ocupado: total - inactivo, total };
        const p = previo; previo = actual;
        if (!p || actual.total <= p.total) return null;
        return Math.round(((actual.ocupado - p.ocupado) / (actual.total - p.total)) * 100);
    } catch { return null; }
}

/**
 * go2rtc lista cada stream con sus productores (de dónde lee) y sus consumidores (quién mira).
 * Un productor está corriendo si tiene `medias` (medido el 15/10: el `ffmpeg:` de reserva figura
 * siempre, sin medias, mientras no se usa). Si el que corre es `ffmpeg:`, es una conversión.
 */
async function video(): Promise<Video | null> {
    try {
        const c = new AbortController(); const t = setTimeout(() => c.abort(), 3000);
        const r = await fetch(`${GO2RTC}/api/streams`, { cache: "no-store", signal: c.signal });
        clearTimeout(t);
        if (!r.ok) return null;
        const streams: Record<string, any> = await r.json();
        const v: Video = { activos: 0, convertidos: 0, directos: 0, espectadores: 0 };
        for (const s of Object.values(streams)) {
            const consumidores: any[] = s?.consumers || [];
            const corriendo: any[] = (s?.producers || []).filter((p: any) => p?.medias?.length);
            if (!consumidores.length || !corriendo.length) continue;
            v.activos++;
            v.espectadores += consumidores.filter((c) => /^Mozilla/.test(String(c?.user_agent || ""))).length;
            if (corriendo.some((p) => String(p.url || "").startsWith("ffmpeg:"))) v.convertidos++; else v.directos++;
        }
        return v;
    } catch { return null; }
}

async function medir() {
    const [ahora, vid, vision] = await Promise.all([medirAhora().catch(() => null), video(), cargaVision().catch(() => null)]);
    const nucleos = os.cpus().length || 1;
    // La memoria del contenedor (lxcfs muestra la del CT en /proc/meminfo). Se usa MemAvailable y
    // no os.freemem(): ésta es MemFree, que no cuenta la caché que el sistema suelta cuando hace
    // falta (medido el 15/10 en SN: «libre» 3,5 GB, disponible 8,6 GB de 12).
    const total = os.totalmem();
    let libre = os.freemem();
    try { const m = /MemAvailable:\s+(\d+)\s*kB/.exec(fs.readFileSync("/proc/meminfo", "utf8")); if (m) libre = Number(m[1]) * 1024; } catch { }
    return {
        ts: Date.now(),
        cpu: { uso: usoCpu(), carga: Math.round(os.loadavg()[0] * 100) / 100, nucleos, temp: ahora?.cpu?.t ?? null },
        memoria: { usada: total - libre, total },
        gpu: ahora?.gpu ? { uso: ahora.gpu.uso, mem: ahora.gpu.mem, memTotal: ahora.gpu.memTotal, temp: ahora.gpu.t, w: ahora.gpu.w } : null,
        gpuFalla: ahora?.gpuFalla || null,
        video: vid,
        // Lo que hace OmniVision por segundo contra su tope (lo mide vision-worker).
        vision: vision ? { total: vision.total, tope: vision.tope, medido: vision.medido } : null,
    };
}

export async function GET() {
    const p = await autorizarMonitor("/api/monitor/camaras/recursos");
    if (p.error) return p.error;
    if (!cache || Date.now() - cache.t > VIGENCIA_MS) {
        if (!enCurso) enCurso = medir().then((r) => { cache = { t: Date.now(), r }; return r; }).finally(() => { enCurso = null; });
        await enCurso;
    }
    return NextResponse.json(cache!.r, { headers: SIN_CACHE });
}
