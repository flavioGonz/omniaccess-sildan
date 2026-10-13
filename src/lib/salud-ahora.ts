import fs from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";

/**
 * Una medida de AHORA de la GPU y la CPU, para la vista en vivo de Salud del equipo.
 *
 * La telemetría del entrenador (scripts/salud-equipo.js) mide cada 5 s entrenando pero cada 60 s
 * en reposo: una pantalla «en vivo» que lee esos archivos se mueve de a un minuto. Esto mide en
 * el momento, con lo mismo (nvidia-smi y el sensor coretemp del host, que el CT ve), y se guarda
 * un par de segundos para que varias pantallas abiertas no lancen un nvidia-smi cada una.
 * Es de sólo lectura: no se cambia nada del equipo.
 */
const correr = promisify(execFile);
const VIGENCIA_MS = 1_500;
const MOTIVOS: [number, string][] = [[0x4, "tope de energía"], [0x8, "bajada por hardware"], [0x20, "térmico (driver)"], [0x40, "térmico (hardware)"], [0x80, "freno de energía (hardware)"]];

export type MedidaAhora = {
    ts: number;
    gpu: { t: number | null; w: number | null; wMax: number | null; uso: number | null; mem: number | null; memTotal: number | null; ventilador: number | null; motivos: string[] } | null;
    cpu: { t: number | null } | null;
    error?: string;
    /**
     * Por qué no hay GPU, cuando no hay: «sin-placa» (no existe nvidia-smi: el servidor no tiene
     * NVIDIA) o «sin-driver» (nvidia-smi está y no habla con la placa). La pantalla lo explica en
     * vez de mostrar el comando que falló cortado a 120 caracteres, que no decía nada.
     */
    gpuFalla?: "sin-placa" | "sin-driver";
};

let cache: { t: number; m: MedidaAhora } | null = null;
let enCurso: Promise<MedidaAhora> | null = null;
const num = (v: string | undefined) => { const n = Number(String(v ?? "").trim()); return Number.isFinite(n) ? n : null; };

async function medirGpu(): Promise<MedidaAhora["gpu"]> {
    const campos = "temperature.gpu,power.draw,power.limit,utilization.gpu,memory.used,memory.total,fan.speed,clocks_event_reasons.active";
    const { stdout } = await correr("nvidia-smi", [`--query-gpu=${campos}`, "--format=csv,noheader,nounits"], { timeout: 6000 });
    const [t, w, wMax, uso, mem, memTotal, ventilador, motivos] = stdout.trim().split("\n")[0].split(",").map((x) => x.trim());
    const mascara = parseInt(motivos, 16) || 0;
    return { t: num(t), w: num(w), wMax: num(wMax), uso: num(uso), mem: num(mem), memTotal: num(memTotal), ventilador: num(ventilador), motivos: MOTIVOS.filter(([b]) => mascara & b).map(([, n]) => n) };
}

function medirCpu(): MedidaAhora["cpu"] {
    try {
        for (const h of fs.readdirSync("/sys/class/hwmon")) {
            const dir = path.join("/sys/class/hwmon", h);
            if (fs.readFileSync(path.join(dir, "name"), "utf8").trim() !== "coretemp") continue;
            let paquete: number | null = null, maxNucleo: number | null = null;
            for (const f of fs.readdirSync(dir)) {
                const m = /^temp(\d+)_input$/.exec(f); if (!m) continue;
                const c = Number(fs.readFileSync(path.join(dir, f), "utf8")) / 1000;
                let rotulo = ""; try { rotulo = fs.readFileSync(path.join(dir, `temp${m[1]}_label`), "utf8").trim(); } catch { }
                if (/package/i.test(rotulo)) paquete = c; else maxNucleo = Math.max(maxNucleo ?? 0, c);
            }
            return { t: paquete ?? maxNucleo };
        }
    } catch { }
    return null;
}

export async function medirAhora(): Promise<MedidaAhora> {
    if (cache && Date.now() - cache.t < VIGENCIA_MS) return cache.m;
    if (enCurso) return enCurso;
    enCurso = (async () => {
        let gpu: MedidaAhora["gpu"] = null, error: string | undefined, gpuFalla: MedidaAhora["gpuFalla"];
        try { gpu = await medirGpu(); } catch (e: any) {
            // Lo que explica la falla está en lo que imprime nvidia-smi («Failed to initialize
            // NVML…», «couldn't communicate with the NVIDIA driver»), no en el «Command failed».
            gpuFalla = e?.code === "ENOENT" ? "sin-placa" : "sin-driver";
            error = String(e?.stdout || e?.stderr || e?.message || e).trim().split("\n")[0].slice(0, 200);
        }
        const m: MedidaAhora = { ts: Date.now(), gpu, cpu: medirCpu(), ...(error ? { error, gpuFalla } : {}) };
        cache = { t: Date.now(), m };
        return m;
    })().finally(() => { enCurso = null; });
    return enCurso;
}
