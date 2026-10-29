/**
 * Las cuentas del informe de lecturas (29/10, Nico: «exportar un reporte en PDF y Excel profesional…
 * así podremos comparar mejor el desempeño de las analíticas OmniVision y lo que las cámaras envían»).
 *
 * Puro: recibe las filas de lib/lecturas-camara (los pasos ya apareados) y devuelve los números que
 * dibujan el PDF y el Excel. Así los dos formatos dicen exactamente lo mismo, y se puede probar sin
 * base de datos.
 *
 * Dos preguntas, dos bloques:
 *  · ¿le llega a OmniAccess lo que lee la cámara? — por paso: coincide, otra lectura, otra chapa,
 *    no llegó, sólo OmniAccess, y la demora;
 *  · ¿qué tan bien lee OmniVision comparado con la cámara? — por evento releído: coincide con la
 *    cámara, coincide con otra de sus lecturas, leyó lo que la cámara no pudo (rescate), leyó otra
 *    chapa, o no pudo leer.
 */
import type { FilaLectura, EstadoPaso } from "@/lib/lecturas-camara";

export const ZONA_INFORME = process.env.NEXT_PUBLIC_TZ || "America/Montevideo";
/** Ya normalizadas (sin «_» ni «/»): ver lib/lecturas-camara. */
const NO_LEIDAS = new Set(["NOLEIDA", "UNKNOWN", "SP", ""]);
export const chapaNorm = (p: string | null | undefined) => { const n = String(p || "").toUpperCase().replace(/[^A-Z0-9]/g, ""); return n && !NO_LEIDAS.has(n) ? n : null; };

/** Cómo quedó la relectura de OmniVision frente a lo que leyó la cámara en ese paso. */
export type ComparacionVision = "coincide" | "variante" | "rescate" | "distinta" | "no-leyo" | "sin-camara";
export const VISION_ROTULO: Record<ComparacionVision, string> = {
    coincide: "Coincide con la cámara",
    variante: "Otra lectura de la cámara",
    rescate: "Leyó lo que la cámara no",
    distinta: "Otra chapa",
    "no-leyo": "No pudo leer",
    "sin-camara": "Sin registro de cámara",
};
export const PASO_ROTULO: Record<EstadoPaso, string> = {
    coincide: "Coincide", variante: "Otra lectura", distinta: "Otra chapa", perdida: "No llegó", solo: "Sólo OmniAccess",
};

export function compararVision(f: FilaLectura, ev: FilaLectura["eventos"][number]): ComparacionVision | null {
    const v = ev.vision;
    if (!v) return null;
    const leida = v.estado === "LEIDA" ? chapaNorm(v.plate) : null;
    if (!leida) return "no-leyo";
    if (!f.cam) return "sin-camara";
    const principal = chapaNorm(f.cam.plate);
    if (!principal) return "rescate";
    if (leida === principal) return "coincide";
    if (f.cam.variantes.some((x) => chapaNorm(x.plate) === leida)) return "variante";
    return "distinta";
}

export type Metricas = {
    pasos: number; capturas: number; sinLeerCamara: number;
    coincide: number; variante: number; distinta: number; perdida: number; solo: number;
    /** Llegaron bien: coincide + otra lectura de la misma cámara. */
    bien: number; bienPct: number | null; perdidaPct: number | null;
    demoraMs: number | null;
    vision: Record<ComparacionVision, number> & { total: number; confianzaMedia: number | null; aciertoPct: number | null };
};

const vacias = (): Metricas => ({
    pasos: 0, capturas: 0, sinLeerCamara: 0, coincide: 0, variante: 0, distinta: 0, perdida: 0, solo: 0, bien: 0, bienPct: null, perdidaPct: null, demoraMs: null,
    vision: { total: 0, coincide: 0, variante: 0, rescate: 0, distinta: 0, "no-leyo": 0, "sin-camara": 0, confianzaMedia: null, aciertoPct: null },
});
const mediana = (xs: number[]) => { if (!xs.length) return null; const o = [...xs].sort((a, b) => a - b); return o[Math.floor(o.length / 2)]; };

function medir(filas: FilaLectura[]): Metricas {
    const m = vacias();
    const demoras: number[] = [], confianzas: number[] = [];
    for (const f of filas) {
        m[f.estado]++;
        if (f.cam) {
            m.pasos++; m.capturas += f.cam.capturas;
            if (!chapaNorm(f.cam.plate)) m.sinLeerCamara++;
            for (const e of f.eventos) demoras.push(new Date(e.ts).getTime() - new Date(f.ts).getTime());
        }
        for (const e of f.eventos) {
            const c = compararVision(f, e);
            if (!c) continue;
            m.vision.total++; m.vision[c]++;
            if (e.vision?.confianza != null && c !== "no-leyo") confianzas.push(e.vision.confianza);
        }
    }
    m.bien = m.coincide + m.variante;
    m.bienPct = m.pasos ? m.bien / m.pasos : null;
    m.perdidaPct = m.pasos ? m.perdida / m.pasos : null;
    m.demoraMs = mediana(demoras);
    m.vision.confianzaMedia = confianzas.length ? confianzas.reduce((a, b) => a + b, 0) / confianzas.length : null;
    // Acierto de OmniVision: de las que se pueden comparar con la cámara (la cámara leyó y OmniVision también),
    // cuántas dieron la misma chapa o una de las otras lecturas de la cámara.
    const comparables = m.vision.coincide + m.vision.variante + m.vision.distinta;
    m.vision.aciertoPct = comparables ? (m.vision.coincide + m.vision.variante) / comparables : null;
    return m;
}

const partes = (iso: string) => {
    const p = new Intl.DateTimeFormat("en-CA", { timeZone: ZONA_INFORME, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" }).formatToParts(new Date(iso));
    const g = (t: string) => p.find((x) => x.type === t)?.value || "";
    return { dia: `${g("year")}-${g("month")}-${g("day")}`, hora: Number(g("hour")) };
};

export type Caso = { fila: FilaLectura; motivo: "perdida" | "distinta" | "vision-distinta"; vision: ComparacionVision | null };

export type InformeLecturas = {
    total: Metricas;
    camaras: { id: string; nombre: string; m: Metricas }[];
    porDia: { dia: string; m: Metricas }[];
    porHora: { hora: number; m: Metricas }[];
    casos: Caso[];
    casosTotal: number;
    hallazgos: string[];
};

/** Cuántos casos a revisar como mucho (el PDF los dibuja con foto; el Excel los lista todos). */
export const CASOS_MAX = 60;

export function armarInforme(filas: FilaLectura[], camaras: { id: string; nombre: string }[]): InformeLecturas {
    const total = medir(filas);
    const porCam = new Map<string, FilaLectura[]>(), porDia = new Map<string, FilaLectura[]>(), porHora = new Map<number, FilaLectura[]>();
    for (const f of filas) {
        const k = f.deviceId || "";
        (porCam.get(k) || porCam.set(k, []).get(k)!).push(f);
        const { dia, hora } = partes(f.ts);
        (porDia.get(dia) || porDia.set(dia, []).get(dia)!).push(f);
        (porHora.get(hora) || porHora.set(hora, []).get(hora)!).push(f);
    }
    const nombre = new Map(camaras.map((c) => [c.id, c.nombre]));
    const cams = [...porCam.entries()].map(([id, fs]) => ({ id, nombre: nombre.get(id) || fs[0]?.camara || id, m: medir(fs) })).sort((a, b) => a.nombre.localeCompare(b.nombre));
    const dias = [...porDia.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([dia, fs]) => ({ dia, m: medir(fs) }));
    const horas = Array.from({ length: 24 }, (_, h) => ({ hora: h, m: medir(porHora.get(h) || []) }));

    // Los casos para revisar: lo que no llegó, lo que llegó con otra chapa y donde OmniVision leyó otra cosa.
    const todos: Caso[] = [];
    for (const f of filas) {
        if (f.estado === "perdida" || f.estado === "distinta") todos.push({ fila: f, motivo: f.estado, vision: null });
        else {
            const vd = f.eventos.map((e) => compararVision(f, e)).find((c) => c === "distinta");
            if (vd) todos.push({ fila: f, motivo: "vision-distinta", vision: vd });
        }
    }
    todos.sort((a, b) => b.fila.ts.localeCompare(a.fila.ts));

    return { total, camaras: cams, porDia: dias, porHora: horas, casos: todos.slice(0, CASOS_MAX), casosTotal: todos.length, hallazgos: hallazgos(total, cams, horas) };
}

const n = (x: number) => x.toLocaleString("es-UY");
export const pct = (x: number | null, dec = 0) => (x == null ? "—" : `${(x * 100).toLocaleString("es-UY", { maximumFractionDigits: dec, minimumFractionDigits: dec })} %`);
export const segundos = (ms: number | null) => (ms == null ? "—" : `${(ms / 1000).toLocaleString("es-UY", { maximumFractionDigits: 1, signDisplay: "exceptZero" })} s`);

/** Lo que el informe concluye, en frases: lo primero que lee quien no va a mirar las tablas. */
function hallazgos(t: Metricas, cams: { nombre: string; m: Metricas }[], horas: { hora: number; m: Metricas }[]): string[] {
    const out: string[] = [];
    if (!t.pasos && !t.solo) return ["No hay lecturas registradas en el período elegido."];
    if (t.pasos) out.push(`Las cámaras leyeron ${n(t.pasos)} vehículos (${n(t.capturas)} capturas). A OmniAccess le llegaron bien ${n(t.bien)}: el ${pct(t.bienPct, 1)}.`);
    if (t.perdida) {
        const peor = [...cams].sort((a, b) => b.m.perdida - a.m.perdida)[0];
        out.push(`No llegaron ${n(t.perdida)} (${pct(t.perdidaPct, 1)})${peor && cams.length > 1 ? `; la mayoría en ${peor.nombre} (${n(peor.m.perdida)})` : ""}.`);
    } else if (t.pasos) out.push("No se perdió ningún vehículo: todo lo que leyeron las cámaras llegó a OmniAccess.");
    if (t.distinta) out.push(`En ${n(t.distinta)} vehículos llegó una chapa que la cámara no había leído.`);
    if (t.sinLeerCamara) out.push(`La cámara no pudo leer la chapa en ${n(t.sinLeerCamara)} vehículos.`);
    if (t.vision.total) {
        const v = t.vision;
        out.push(`OmniVision releyó ${n(v.total)} eventos. Donde la cámara también leyó, coincidió en el ${pct(v.aciertoPct, 1)}${v.distinta ? ` y dio otra chapa en ${n(v.distinta)}` : ""}.`);
        if (v.rescate) out.push(`OmniVision leyó ${n(v.rescate)} chapas que la cámara no había podido leer.`);
        if (v["no-leyo"]) out.push(`OmniVision no pudo leer ${n(v["no-leyo"])} de las fotos que recibió.`);
    }
    if (t.demoraMs != null) out.push(`La demora típica entre la captura de la cámara y el evento en OmniAccess fue de ${segundos(t.demoraMs)}.`);
    const conDatos = horas.filter((h) => h.m.pasos >= 10 && h.m.bienPct != null);
    const peorHora = [...conDatos].sort((a, b) => (a.m.bienPct! - b.m.bienPct!))[0];
    if (peorHora && peorHora.m.bienPct! < 0.97) out.push(`La franja más floja fue de ${String(peorHora.hora).padStart(2, "0")}:00 a ${String(peorHora.hora + 1).padStart(2, "0")}:00, con ${pct(peorHora.m.bienPct, 0)} de llegadas bien.`);
    return out;
}
