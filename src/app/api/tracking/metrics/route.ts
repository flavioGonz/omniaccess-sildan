import { NextResponse } from "next/server";
import { verifyApiAuth, unauthorizedResponse } from "@/lib/api-auth";
import { exec } from "child_process";
import { promisify } from "util";

const correr = promisify(exec);
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Metricas en vivo del contenedor Omni-LPR: consumo del contenedor, estado de
 * la GPU y procesos de la pasarela. Es una foto del momento; el panel la pide
 * cada pocos segundos.
 */

async function salida(cmd: string, ms = 12000) {
    try { const { stdout } = await correr(cmd, { timeout: ms, maxBuffer: 512 * 1024 }); return stdout.trim(); }
    catch { return ""; }
}

function aBytes(txt: string): number {
    const m = /^([\d.]+)\s*([KMGT]?i?B)$/i.exec(txt.trim());
    if (!m) return 0;
    const n = parseFloat(m[1]);
    const u = m[2].toUpperCase().replace("I", "");
    const mult: Record<string, number> = { B: 1, KB: 1e3, MB: 1e6, GB: 1e9, TB: 1e12 };
    return n * (mult[u] || 1);
}

export async function GET() {
    const auth = await verifyApiAuth();
    if (!auth.authenticated) return unauthorizedResponse();

    // ── Contenedor ──────────────────────────────────────────────
    const crudo = await salida(
        `docker stats omni-lpr --no-stream --format '{{.CPUPerc}}|{{.MemUsage}}|{{.MemPerc}}|{{.NetIO}}|{{.BlockIO}}|{{.PIDs}}'`
    );
    let contenedor: any = null;
    if (crudo) {
        const [cpu, mem, memPerc, net, block, pids] = crudo.replace(/'/g, "").split("|");
        const [usada, total] = (mem || "").split("/");
        contenedor = {
            cpu: parseFloat(cpu) || 0,
            memUsada: aBytes(usada || ""),
            memTotal: aBytes(total || ""),
            memPorcentaje: parseFloat(memPerc) || 0,
            red: net,
            disco: block,
            procesos: parseInt(pids) || 0,
        };
    }

    // ── GPU ─────────────────────────────────────────────────────
    const gpuCrudo = await salida(
        `nvidia-smi --query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw,power.limit --format=csv,noheader,nounits`
    );
    let gpu: any = null;
    if (gpuCrudo) {
        const p = gpuCrudo.split(",").map((x) => x.trim());
        gpu = {
            nombre: p[0],
            uso: Number(p[1]) || 0,
            memUsada: Number(p[2]) || 0,
            memTotal: Number(p[3]) || 0,
            temperatura: Number(p[4]) || 0,
            potencia: Number(p[5]) || 0,
            potenciaMax: Number(p[6]) || 0,
        };
    }

    // ¿El lector esta realmente usando la GPU o cayo a CPU?
    // El log entero, no las ultimas lineas: el aviso del proveedor lo escribe el lector al
    // cargar los modelos y queda atras enseguida, asi que con --tail el panel decia "CPU"
    // con la placa trabajando.
    const logs = await salida(`docker logs omni-lpr 2>&1 | grep -i ExecutionProvider | tail -2`);
    const enGpu = /CUDAExecutionProvider/.test(logs) && !/Failed to create CUDAExecutionProvider/.test(logs);
    const motor = enGpu ? "GPU (CUDA)" : "CPU";

    // ── Anfitrion ───────────────────────────────────────────────
    const carga = await salida(`cat /proc/loadavg`);
    const nucleos = Number(await salida(`nproc`)) || 0;

    // ── Procesos de la pasarela: un ffmpeg por camara enganchada ─
    const ff = await salida(`ps -eo pid,pcpu,pmem,etimes,args --no-headers | grep '[f]fmpeg' | head -20`);
    const camarasVivas = ff
        ? ff.split("\n").map((l) => {
            const partes = l.trim().split(/\s+/);
            const args = partes.slice(4).join(" ");
            const rtsp = /(-i\s+)(\S+)/.exec(args)?.[2] || "";
            return {
                pid: Number(partes[0]),
                cpu: Number(partes[1]),
                mem: Number(partes[2]),
                segundos: Number(partes[3]),
                destino: rtsp.replace(/:\/\/([^:/@]+):([^@]+)@/, "://$1:***@"),
            };
        })
        : [];

    return NextResponse.json({
        contenedor,
        gpu,
        motor,
        enGpu,
        anfitrion: { carga: carga.split(" ").slice(0, 3).map(Number), nucleos },
        camarasVivas,
        momento: new Date().toISOString(),
    });
}
