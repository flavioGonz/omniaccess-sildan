/**
 * La salud del equipo mientras se entrena (y en reposo): GPU y CPU, medidas y guardadas.
 *
 * Por qué existe: el 11/10 el host se colgó entero, sin una línea en el log (ver el doc del
 * proyecto «caida-2026-10-11»). La sospecha es térmica: el i7-12700F está a 77-84 °C en REPOSO
 * (su «high» es 80 °C), y entrenar suma GPU y CPU durante horas. Sin números no se puede saber, y
 * después de un cuelgue no queda nada en memoria: por eso cada muestra se escribe al disco y se
 * fuerza a disco (fsync) mientras se entrena, para que lo último antes de un cuelgue quede.
 *
 * Qué mide (todo de lectura, nada se cambia en el equipo):
 *   - GPU, con nvidia-smi: temperatura, consumo y su tope, uso, VRAM, ventilador, reloj y los
 *     motivos de bajada de reloj activos (térmico de hardware, corte de energía, etc.).
 *   - CPU, del sensor coretemp que el host deja ver en /sys/class/hwmon: el paquete y el núcleo
 *     más caliente.
 *   - Carga del sistema y memoria libre.
 *
 * Dónde: un JSONL por día en ENTRENADOR_TELEMETRIA (por defecto al lado de la carpeta de trabajo:
 * /datos/telemetria en San Nicolás). Lo lee la pantalla «Salud del equipo».
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { promisify } = require("util");
const { execFile } = require("child_process");
const correr = promisify(execFile);

/**
 * Los límites. Valores de la hoja de la RTX 3050 de este equipo (nvidia-smi -q, medido el
 * 12/10): objetivo 83 °C, baja reloj a 94 °C, se apaga a 97 °C. Y del i7-12700F: «high» 80 °C,
 * crítico 100 °C.
 *
 *   ENFRIAR   el entrenamiento se CONGELA (docker pause) hasta que baje: la GPU deja de calentar
 *             en segundos y no se pierde nada.
 *   REANUDAR  se descongela por debajo de esto. La distancia evita prender y apagar cada 5 s.
 *   CORTAR    se corta del todo, aunque se pierda lo hecho: ya no es cuidar el rendimiento, es
 *             cuidar el equipo.
 *
 * La GPU se frena en 78 °C, cinco antes de su objetivo: entrenar no tiene apuro, y bajo el
 * objetivo el driver no recorta reloj. La CPU se frena recién en 92 °C porque en reposo ya está
 * en 79-84 °C: con un umbral más bajo no se entrenaría nunca — y ESO es lo que hay que arreglar
 * en el hardware (disipador/pasta/flujo de aire), no acá.
 */
const LIMITES = {
    gpu: { enfriar: 78, reanudar: 68, cortar: 86 },
    cpu: { enfriar: 92, reanudar: 86, cortar: 97 },
    /** Congelado más que esto sin bajar: no se va a enfriar solo (el ambiente, un ventilador). Se corta. */
    enfriandoMaxMin: 20,
    /** No se ARRANCA un entrenamiento si ya se está por encima de esto. */
    arrancarHasta: { gpu: 70, cpu: 88 },
};
/** Cada cuánto se mide: seguido mientras se entrena (un cuelgue deja poco), de a ratos en reposo. */
const MUESTRA_ENTRENANDO_MS = 5_000;
const MUESTRA_REPOSO_MS = 60_000;
/** Cuánto se guarda la telemetría. Un día entrenando son ~17.000 líneas (~3 MB). */
const RETENCION_DIAS = 30;

/** Los motivos de bajada de reloj de nvidia-smi (clocks_event_reasons.active, máscara de bits). */
const MOTIVOS = [
    [0x4, "tope de energía"], [0x8, "bajada por hardware"], [0x20, "térmico (driver)"],
    [0x40, "térmico (hardware)"], [0x80, "freno de energía (hardware)"],
];
/** Los graves: con cualquiera de éstos el entrenamiento se corta. */
const MOTIVOS_GRAVES = 0x40 | 0x80 | 0x8;

const num = (v) => { const n = Number(String(v ?? "").trim()); return Number.isFinite(n) ? n : null; };

async function medirGpu() {
    const campos = "temperature.gpu,power.draw,power.limit,utilization.gpu,memory.used,memory.total,fan.speed,clocks.sm,clocks_event_reasons.active";
    try {
        const { stdout } = await correr("nvidia-smi", [`--query-gpu=${campos}`, "--format=csv,noheader,nounits"], { timeout: 8000 });
        const [t, w, wMax, uso, mem, memTotal, ventilador, reloj, motivos] = stdout.trim().split("\n")[0].split(",").map((x) => x.trim());
        const mascara = parseInt(motivos, 16) || 0;
        return {
            t: num(t), w: num(w), wMax: num(wMax), uso: num(uso), mem: num(mem), memTotal: num(memTotal),
            ventilador: num(ventilador), reloj: num(reloj),
            motivos: MOTIVOS.filter(([b]) => mascara & b).map(([, n]) => n), grave: !!(mascara & MOTIVOS_GRAVES),
        };
    } catch (e) { return { error: String(e.message || e).slice(0, 120) }; }
}

/** El sensor coretemp del host: el paquete (temp1) y el núcleo más caliente. */
function medirCpu() {
    try {
        for (const h of fs.readdirSync("/sys/class/hwmon")) {
            const dir = path.join("/sys/class/hwmon", h);
            if (fs.readFileSync(path.join(dir, "name"), "utf8").trim() !== "coretemp") continue;
            let paquete = null, maxNucleo = null;
            for (const f of fs.readdirSync(dir)) {
                const m = /^temp(\d+)_input$/.exec(f); if (!m) continue;
                const c = Number(fs.readFileSync(path.join(dir, f), "utf8")) / 1000;
                const rotulo = (() => { try { return fs.readFileSync(path.join(dir, `temp${m[1]}_label`), "utf8").trim(); } catch { return ""; } })();
                if (/package/i.test(rotulo)) paquete = c; else maxNucleo = Math.max(maxNucleo ?? 0, c);
            }
            return { t: paquete ?? maxNucleo, nucleoMax: maxNucleo };
        }
    } catch { }
    return { t: null };
}

async function medir() {
    const gpu = await medirGpu();
    return {
        ts: new Date().toISOString(), gpu, cpu: medirCpu(),
        carga: Math.round(os.loadavg()[0] * 100) / 100,
        ramLibreGB: Math.round((os.freemem() / 1e9) * 10) / 10,
    };
}

function dirTelemetria(trabajo) {
    return process.env.ENTRENADOR_TELEMETRIA || path.join(path.dirname(path.resolve(trabajo)), "telemetria");
}

/** Agrega una muestra al archivo del día. `seguro`: fsync, para que sobreviva a un cuelgue. */
function registrar(dir, muestra, seguro) {
    try {
        fs.mkdirSync(dir, { recursive: true });
        const f = path.join(dir, `${muestra.ts.slice(0, 10)}.jsonl`);
        const fd = fs.openSync(f, "a");
        try { fs.writeSync(fd, JSON.stringify(muestra) + "\n"); if (seguro) fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    } catch { }
}

function podarTelemetria(dir) {
    try {
        const limite = new Date(Date.now() - RETENCION_DIAS * 86_400_000).toISOString().slice(0, 10);
        for (const n of fs.readdirSync(dir)) if (/^\d{4}-\d{2}-\d{2}\.jsonl$/.test(n) && n.slice(0, 10) < limite) fs.rmSync(path.join(dir, n), { force: true });
    } catch { }
}

/**
 * Qué hacer con una muestra mientras se entrena: «seguir», «enfriar», «reanudar» o «cortar» (con
 * el motivo, en castellano, para la fila y la pantalla).
 */
function decidir(m, congelado, congeladoDesde) {
    const g = m.gpu?.t, c = m.cpu?.t;
    if (m.gpu?.grave) return { accion: "cortar", motivo: `la GPU bajó el reloj por ${m.gpu.motivos.join(" y ")}` };
    if (g != null && g >= LIMITES.gpu.cortar) return { accion: "cortar", motivo: `la GPU llegó a ${g} °C (tope ${LIMITES.gpu.cortar} °C)` };
    if (c != null && c >= LIMITES.cpu.cortar) return { accion: "cortar", motivo: `la CPU llegó a ${c} °C (tope ${LIMITES.cpu.cortar} °C)` };
    if (congelado) {
        if (Date.now() - congeladoDesde > LIMITES.enfriandoMaxMin * 60_000) return { accion: "cortar", motivo: `no se enfrió en ${LIMITES.enfriandoMaxMin} min (GPU ${g ?? "?"} °C, CPU ${c ?? "?"} °C)` };
        if ((g == null || g <= LIMITES.gpu.reanudar) && (c == null || c <= LIMITES.cpu.reanudar)) return { accion: "reanudar" };
        return { accion: "seguir" };
    }
    if (g != null && g >= LIMITES.gpu.enfriar) return { accion: "enfriar", motivo: `GPU a ${g} °C` };
    if (c != null && c >= LIMITES.cpu.enfriar) return { accion: "enfriar", motivo: `CPU a ${c} °C` };
    return { accion: "seguir" };
}

module.exports = { LIMITES, MUESTRA_ENTRENANDO_MS, MUESTRA_REPOSO_MS, RETENCION_DIAS, medir, registrar, podarTelemetria, dirTelemetria, decidir };
