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
/**
 * Una lectura fallida sola no pinta la placa de rojo: con la GPU cargada nvidia-smi puede tardar
 * más de TIEMPO_MS una vez. La falla se informa si no hubo una lectura buena en este tiempo.
 */
const GRACIA_FALLA_MS = 20_000;

type Lectura = { uso: number; memUsada: number; memTotal: number; watts: number | null; limite: number | null; temp: number | null; t: number };
let ultima: Lectura | null = null;
let leyendo: Promise<Lectura | null> | null = null;
/**
 * Por qué no se pudo leer, la última vez. Antes la ruta contestaba sólo { hay: false } y el
 * sidebar se escondía: en el lab, con el driver sin cargar, no había nada que dijera que la
 * placa no andaba (y OmniVision y el lector corrían en CPU sin que se notara).
 *  · "sin-placa": no hay nvidia-smi — un servidor sin GPU de NVIDIA. Es un estado, no una falla.
 *  · "sin-driver": nvidia-smi está pero no habla con la placa (driver sin cargar, Secure Boot
 *    sin la llave enrolada, el CT sin acceso). Eso sí es una falla.
 */
let falla: { motivo: "sin-placa" | "sin-driver"; detalle: string; t: number } | null = null;

async function leer(): Promise<Lectura | null> {
    try {
        const { stdout } = await correr("nvidia-smi", ["--query-gpu=utilization.gpu,memory.used,memory.total,power.draw,power.limit,temperature.gpu", "--format=csv,noheader,nounits"], { timeout: TIEMPO_MS });
        const [uso, memUsada, memTotal, watts, limite, temp] = stdout.trim().split("\n")[0].split(",").map((x) => parseFloat(x.trim()));
        if (!Number.isFinite(uso)) return null;
        const n = (v: number) => (Number.isFinite(v) ? v : null);
        falla = null;
        return { uso, memUsada, memTotal, watts: n(watts), limite: n(limite), temp: n(temp), t: Date.now() };
    } catch (e: any) {
        const texto = String(e?.stdout || e?.stderr || e?.message || "").trim().split("\n")[0].slice(0, 200);
        falla = { motivo: e?.code === "ENOENT" ? "sin-placa" : "sin-driver", detalle: texto, t: Date.now() };
        return null;
    }
}

export async function GET() {
    const auth = await verifyApiAuth();
    if (!auth.authenticated) return unauthorizedResponse();
    // También la falla vale VIGENCIA_MS: sin placa no se corre nvidia-smi en cada pedido.
    const fresca = (ultima && Date.now() - ultima.t <= VIGENCIA_MS) || (falla && Date.now() - falla.t <= VIGENCIA_MS);
    if (!fresca) {
        leyendo ||= leer().finally(() => { leyendo = null; });
        const l = await leyendo;
        if (l) ultima = l;
    }
    // Sin lectura buena, o la buena ya es vieja y la última dio falla: se dice por qué.
    if (!ultima || (falla && falla.t > ultima.t && Date.now() - ultima.t > GRACIA_FALLA_MS)) return NextResponse.json({ hay: false, motivo: falla?.motivo || "sin-driver", detalle: falla?.detalle || null }, { headers: { "Cache-Control": "no-store" } });
    // Si el lector de matrículas cayó a CPU, no lo dice el porcentaje: lo dice la muestra de la pasarela.
    const muestra = await prisma.trackingSample.findFirst({ orderBy: { momento: "desc" }, select: { enGpu: true } }).catch(() => null);
    return NextResponse.json({ hay: true, ...ultima, edadSeg: Math.round((Date.now() - ultima.t) / 1000), enGpu: muestra?.enGpu ?? null }, { headers: { "Cache-Control": "no-store" } });
}
