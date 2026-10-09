import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyApiAuth, unauthorizedResponse } from "@/lib/api-auth";
import { execFile } from "child_process";
import { promisify } from "util";

const correr = promisify(execFile);
export const dynamic = "force-dynamic";

/**
 * GET /api/gpu/vivo — la GPU ahora mismo, para el indicador del sidebar.
 *
 * /api/tracking/pulso lee la muestra que la pasarela guarda por minuto; para «en vivo» un
 * minuto es mucho. Pero el sidebar está en todas las páginas de todas las sesiones, y un
 * nvidia-smi por cada una cada pocos segundos sería un comando por usuario para siempre. Por
 * eso hay UNA lectura compartida por el proceso: dura VIGENCIA_MS, y los pedidos que llegan
 * mientras tanto (o mientras se está leyendo) reciben la misma. Con cualquier cantidad de
 * sesiones abiertas, a lo sumo un nvidia-smi cada VIGENCIA_MS.
 */
const VIGENCIA_MS = 4000;
const TIEMPO_MS = 3000;

type Lectura = { uso: number; memUsada: number; memTotal: number; watts: number | null; limite: number | null; temp: number | null; t: number };
let ultima: Lectura | null = null;
let leyendo: Promise<Lectura | null> | null = null;

async function leer(): Promise<Lectura | null> {
    try {
        const { stdout } = await correr("nvidia-smi", ["--query-gpu=utilization.gpu,memory.used,memory.total,power.draw,power.limit,temperature.gpu", "--format=csv,noheader,nounits"], { timeout: TIEMPO_MS });
        const [uso, memUsada, memTotal, watts, limite, temp] = stdout.trim().split("\n")[0].split(",").map((x) => parseFloat(x.trim()));
        if (!Number.isFinite(uso)) return null;
        const n = (v: number) => (Number.isFinite(v) ? v : null);
        return { uso, memUsada, memTotal, watts: n(watts), limite: n(limite), temp: n(temp), t: Date.now() };
    } catch { return null; }
}

export async function GET() {
    const auth = await verifyApiAuth();
    if (!auth.authenticated) return unauthorizedResponse();
    if (!ultima || Date.now() - ultima.t > VIGENCIA_MS) {
        leyendo ||= leer().finally(() => { leyendo = null; });
        const l = await leyendo;
        if (l) ultima = l;
    }
    if (!ultima) return NextResponse.json({ hay: false });
    // Si el lector de matrículas cayó a CPU, no lo dice el porcentaje: lo dice la muestra de la pasarela.
    const muestra = await prisma.trackingSample.findFirst({ orderBy: { momento: "desc" }, select: { enGpu: true } }).catch(() => null);
    return NextResponse.json({ hay: true, ...ultima, edadSeg: Math.round((Date.now() - ultima.t) / 1000), enGpu: muestra?.enGpu ?? null }, { headers: { "Cache-Control": "no-store" } });
}
