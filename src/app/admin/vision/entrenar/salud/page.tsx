"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Activity, AlertTriangle, ArrowLeft, Cpu, Gauge, Loader2, RefreshCcw, Snowflake, Thermometer, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { fechaCorta, hora, horaSeg } from "@/lib/fechas";

/**
 * Salud del equipo: cómo se comporta la GPU (y la CPU) del servidor, sobre todo al entrenar.
 *
 * El 11/10 el host se colgó sin dejar rastro, y la sospecha es térmica. Esta pantalla muestra lo
 * que mide el entrenador cada 5 s mientras entrena y cada minuto en reposo (scripts/salud-equipo.js):
 * temperatura de GPU y CPU, consumo, uso y memoria de la GPU, con las rayas donde el entrenador
 * congela el entrenamiento para que se enfríe y donde lo corta. Los tramos entrenando van
 * sombreados; los congelados, más fuerte. Un hueco en las líneas es tiempo sin muestras.
 */

type Punto = { ts: number; gt: number | null; ct: number | null; w: number | null; wMax: number | null; uso: number | null; mem: number | null; memTotal: number | null; estado: string; motivos: string[] };
type Limites = { gpu: { enfriar: number; reanudar: number; cortar: number }; cpu: { enfriar: number; reanudar: number; cortar: number }; enfriandoMaxMin: number; arrancarHasta: { gpu: number; cpu: number } };
type Datos = {
    horas: number; desde: number; hasta: number; limites: Limites | null; latido: string | null;
    ahora: { ts: string; estado: string; gpu: any; cpu: any; carga: number; ramLibreGB: number } | null;
    puntos: (Punto | null)[];
    entrenamientos: { id: string; estado: string; desde: string | null; hasta: string | null; error: string | null; fotos: number | null; modelo: string | null; salud: any }[];
    resumen: { muestras: number; gpuMax: number | null; cpuMax: number | null; wMax: number | null; segEntrenando: number; segEnfriando: number };
};

const RANGOS = [{ h: 1, r: "1 h" }, { h: 6, r: "6 h" }, { h: 24, r: "24 h" }, { h: 72, r: "3 días" }, { h: 168, r: "7 días" }];
/** Cada cuánto se refresca: el entrenador mide cada 5 s entrenando y cada minuto en reposo. */
const REFRESCO_MS = 20_000;
const COLOR = { gpu: "var(--grafico-1)", cpu: "var(--grafico-2)", w: "var(--grafico-4)", mem: "var(--grafico-3)" };

/** La vista en vivo: medidas de este momento cada VIVO_MS, guardadas en el navegador (los últimos VIVO_PUNTOS). */
const VIVO_MS = 2_000;
const VIVO_PUNTOS = 150;
/** 0 = en vivo (medidas del momento); el resto, horas de telemetría guardada. */
const RANGOS_TODOS = [{ h: 0, r: "En vivo" }, ...RANGOS];

export default function SaludEquipo() {
    const [horas, setHoras] = useState(0);
    const [datos, setDatos] = useState<Datos | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [cargando, setCargando] = useState(false);
    const [cursor, setCursor] = useState<number | null>(null);
    const [vivo, setVivo] = useState<Punto[]>([]);
    const [ahoraVivo, setAhoraVivo] = useState<{ ts: number; estado: string; gpu: any; cpu: any; limites: Limites | null; error?: string; gpuFalla?: "sin-placa" | "sin-driver" } | null>(null);
    const enVivo = horas === 0;

    // La telemetría guardada (para los rangos, la tabla de entrenamientos y los límites). En vivo se pide 1 h.
    const traer = useCallback(async () => {
        setCargando(true);
        try {
            const r = await fetch(`/api/vision/entrenar/salud?horas=${horas || 24}`, { cache: "no-store" });
            const j = await r.json();
            if (!r.ok) throw new Error(j?.error || `El servidor respondió ${r.status}`);
            setDatos(j); setError(null);
        } catch (e: any) { setError(e?.message || "sin respuesta"); }
        finally { setCargando(false); }
    }, [horas]);
    useEffect(() => { traer(); const iv = setInterval(traer, REFRESCO_MS); return () => clearInterval(iv); }, [traer]);

    // Las medidas de este momento, siempre (alimentan los medidores aunque se mire un rango).
    useEffect(() => {
        let vivo_ = true, pidiendo = false;
        const medir = async () => {
            if (pidiendo || document.visibilityState !== "visible") return;
            pidiendo = true;
            try {
                const j = await fetch("/api/vision/entrenar/salud?vivo=1", { cache: "no-store" }).then((r) => r.json());
                if (!vivo_) return;
                setAhoraVivo(j);
                const p: Punto = { ts: j.ts, gt: j.gpu?.t ?? null, ct: j.cpu?.t ?? null, w: j.gpu?.w ?? null, wMax: j.gpu?.wMax ?? null, uso: j.gpu?.uso ?? null, mem: j.gpu?.mem ?? null, memTotal: j.gpu?.memTotal ?? null, estado: j.estado || "reposo", motivos: j.gpu?.motivos || [] };
                setVivo((a) => [...a, p].slice(-VIVO_PUNTOS));
            } catch { } finally { pidiendo = false; }
        };
        medir();
        const iv = setInterval(medir, VIVO_MS);
        return () => { vivo_ = false; clearInterval(iv); };
    }, []);

    const L = datos?.limites || ahoraVivo?.limites || null;
    const ahoraT = Date.now();
    // En vivo la ventana es fija (los últimos VIVO_PUNTOS × VIVO_MS) y termina en la última medida:
    // la línea entra por la derecha y corre, en vez de estirarse desde la izquierda.
    const hasta = enVivo ? (vivo[vivo.length - 1]?.ts ?? ahoraT) : datos?.hasta ?? ahoraT;
    const desde = enVivo ? hasta - VIVO_PUNTOS * VIVO_MS : datos?.desde ?? ahoraT;
    const puntos: (Punto | null)[] = enVivo ? vivo : datos?.puntos || [];
    const reales = puntos.filter((p): p is Punto => !!p);
    const enCursor = cursor != null ? reales.reduce<Punto | null>((a, p) => (!a || Math.abs(p.ts - cursor) < Math.abs(a.ts - cursor) ? p : a), null) : null;
    const memTotal = reales.find((p) => p.memTotal)?.memTotal || ahoraVivo?.gpu?.memTotal || null;
    const wTope = reales.find((p) => p.wMax)?.wMax || ahoraVivo?.gpu?.wMax || null;
    const a = ahoraVivo;
    const estado = a?.estado || datos?.ahora?.estado || "reposo";
    const serie = (f: (p: Punto) => number | null) => vivo.slice(-60).map(f).filter((v): v is number => v != null);
    const g = { puntos, desde, hasta, cursor, setCursor, vivo: enVivo };

    return (
        <div className="p-6 lg:p-8 space-y-4 max-w-[1500px] mx-auto">
            <div className="flex items-center gap-3 flex-wrap">
                <Link href="/admin/vision/entrenar/objetos" aria-label="Volver" className="h-9 w-9 grid place-items-center rounded-[10px] border border-border hover:bg-accent"><ArrowLeft size={16} /></Link>
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                        <h1 className="text-[17px] font-bold leading-tight">Salud del equipo</h1>
                        <span className={cn("h-6 px-2.5 rounded-full border text-[11.5px] font-semibold inline-flex items-center gap-1.5",
                            estado === "enfriando" ? "chip-info" : estado === "entrenando" ? "chip-aviso" : "border-border text-muted-foreground")}>
                            <span className="relative inline-flex w-2 h-2">
                                <span className={cn("absolute inset-0 rounded-full opacity-60 animate-ping", estado === "reposo" ? "bg-[var(--bien)]" : estado === "enfriando" ? "bg-[var(--info)]" : "bg-[var(--aviso)]")} />
                                <span className={cn("relative w-2 h-2 rounded-full", estado === "reposo" ? "bg-[var(--bien)]" : estado === "enfriando" ? "bg-[var(--info)]" : "bg-[var(--aviso)]")} />
                            </span>
                            {estado === "entrenando" ? "Entrenando" : estado === "enfriando" ? "Congelado para enfriar" : "En reposo"}
                        </span>
                    </div>
                    <p className="text-[12.5px] text-muted-foreground leading-snug">La GPU y la CPU del servidor: en vivo cada {VIVO_MS / 1000} s, y la historia que guarda el entrenador.</p>
                </div>
                <div className="flex items-center rounded-full border border-border p-0.5">
                    {RANGOS_TODOS.map((r) => (
                        <button key={r.h} type="button" onClick={() => { setHoras(r.h); setCursor(null); }} aria-pressed={horas === r.h}
                            className={cn("h-8 px-3 rounded-full text-[12.5px] font-semibold inline-flex items-center gap-1.5", horas === r.h ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground")}>
                            {r.h === 0 && <span className={cn("w-1.5 h-1.5 rounded-full", horas === 0 ? "bg-[var(--bien)] animate-pulse" : "bg-muted-foreground/50")} />}
                            {r.r}
                        </button>
                    ))}
                </div>
                <button type="button" onClick={traer} aria-label="Actualizar" className="h-9 w-9 grid place-items-center rounded-[8px] border border-border hover:bg-accent">
                    {cargando ? <Loader2 size={15} className="animate-spin" /> : <RefreshCcw size={15} />}
                </button>
            </div>

            {error && <div className="rounded-[10px] border border-border bg-card px-4 py-3 text-[13px] flex items-center gap-3"><AlertTriangle size={16} className="tono-mal" /> No se pudo traer la historia: {error} <button type="button" onClick={traer} className="ml-auto text-[var(--accion)] font-semibold">Reintentar</button></div>}
            {/* Sin GPU: qué pasa y qué hacer, no el comando que falló. En el lab el driver no
                cargaba (Secure Boot) y esta pantalla mostraba «nvidia-smi: Command failed: …»
                cortado, con los medidores en «—» sin decir por qué. */}
            {a?.error && (a.gpuFalla === "sin-placa" ? (
                <div className="rounded-[10px] border border-border bg-card px-4 py-3 text-[12.5px] flex items-start gap-2.5"><Cpu size={15} className="mt-0.5 text-muted-foreground" />
                    <span>Este servidor no tiene una placa NVIDIA: no hay GPU que medir. Todo el análisis corre en la CPU.</span></div>
            ) : (
                <div className="rounded-[10px] border chip-mal px-4 py-3 text-[12.5px] flex items-start gap-2.5">
                    <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                    <div className="space-y-1 min-w-0">
                        <div className="text-[13.5px] font-bold">La placa de video no responde</div>
                        <div className="text-foreground/85 leading-snug">El driver de NVIDIA no está cargado, o el servidor no deja usarlo. Mientras tanto OmniVision y el lector de matrículas analizan en la CPU — por eso la CPU trabaja y calienta más que en reposo — y no se puede entrenar.</div>
                        <div className="text-foreground/85 leading-snug"><b>Qué hacer:</b> si el equipo tiene Secure Boot, apagarlo en el BIOS, o enrolar la llave del driver en la consola al arrancar. Con la placa respondiendo, estos medidores se llenan solos.</div>
                        <div className="font-mono text-[11px] text-foreground/60 break-words">{a.error}</div>
                    </div>
                </div>
            ))}

            {/* ── Ahora: cuatro medidores ── */}
            <div className="grid grid-cols-2 xl:grid-cols-4 gap-2">
                <Medidor icono={Thermometer} rotulo="Temperatura GPU" valor={a?.gpu?.t ?? null} unidad="°C" min={20} max={100}
                    aviso={L?.gpu.enfriar} mal={L?.gpu.cortar} pie={a?.gpuFalla === "sin-driver" ? "sin datos: la placa no responde" : L ? `congela en ${L.gpu.enfriar} · corta en ${L.gpu.cortar} °C` : undefined} linea={serie((p) => p.gt)} color={COLOR.gpu} />
                <Medidor icono={Cpu} rotulo="Temperatura CPU" valor={a?.cpu?.t != null ? Math.round(a.cpu.t) : null} unidad="°C" min={20} max={105}
                    aviso={L?.cpu.enfriar} mal={L?.cpu.cortar} pie={L ? `congela en ${L.cpu.enfriar} · corta en ${L.cpu.cortar} °C` : undefined} linea={serie((p) => p.ct)} color={COLOR.cpu} />
                <Medidor icono={Zap} rotulo="Consumo GPU" valor={a?.gpu?.w != null ? Math.round(a.gpu.w) : null} unidad="W" min={0} max={a?.gpu?.wMax || 70}
                    pie={a?.gpuFalla === "sin-driver" ? "sin datos: la placa no responde" : a?.gpu?.wMax ? `tope ${Math.round(a.gpu.wMax)} W${a.gpu.ventilador != null ? ` · ventilador ${a.gpu.ventilador} %` : ""}` : undefined} linea={serie((p) => p.w)} color={COLOR.w} />
                <Medidor icono={Gauge} rotulo="Uso GPU" valor={a?.gpu?.uso ?? null} unidad="%" min={0} max={100}
                    pie={a?.gpuFalla === "sin-driver" ? "sin datos: la placa no responde" : a?.gpu?.mem != null ? `memoria ${(a.gpu.mem / 1024).toFixed(1)} de ${((a.gpu.memTotal || 0) / 1024).toFixed(1)} GB` : undefined} linea={serie((p) => p.uso)} color={COLOR.mem} />
            </div>
            {a?.gpu?.motivos?.length ? <p className="text-[12px] tono-aviso flex items-center gap-1.5"><AlertTriangle size={13} /> La GPU está bajando el reloj por {a.gpu.motivos.join(", ")}.</p> : null}

            {/* ── Las curvas, segmentadas ── */}
            <div className="flex items-center gap-4 flex-wrap text-[12px] text-muted-foreground">
                <span className="font-semibold text-foreground text-[13px]">{enVivo ? `En vivo · últimos ${Math.round((VIVO_PUNTOS * VIVO_MS) / 60_000)} min` : `Últimas ${RANGOS.find((r) => r.h === horas)?.r}`}</span>
                {!enVivo && <span>{datos?.resumen.muestras ?? 0} muestras</span>}
                {!enVivo && (datos?.resumen.segEntrenando ? <span>entrenando {duracion(datos.resumen.segEntrenando)}{datos.resumen.segEnfriando ? `, ${duracion(datos.resumen.segEnfriando)} congelado para enfriar` : ""}</span> : <span>sin entrenamientos en el rango</span>)}
                <span className="ml-auto flex items-center gap-3">
                    <Leyenda color="color-mix(in oklab, var(--accion) 14%, transparent)" cuadro>entrenando</Leyenda>
                    <Leyenda color="color-mix(in oklab, var(--info) 30%, transparent)" cuadro>congelado (enfriando)</Leyenda>
                </span>
            </div>
            {(!enVivo && !datos) ? <div className="h-[300px] rounded-[10px] bg-muted animate-pulse" />
                : !reales.length ? (
                    <div className="h-[160px] rounded-[10px] border border-border grid place-items-center text-center text-[13px] text-muted-foreground">
                        <span>{enVivo ? "Midiendo…" : <>Todavía no hay mediciones en este rango.<br />El entrenador mide cada minuto en reposo y cada 5 s entrenando.</>}</span>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-2">
                        <Grafico {...g} titulo="Temperatura" icono={Thermometer} unidad="°C"
                            series={[{ nombre: "GPU", color: COLOR.gpu, valor: (p) => p.gt }, { nombre: "CPU", color: COLOR.cpu, valor: (p) => p.ct }]}
                            dominio={[30, 100]}
                            rayas={L ? [
                                { v: L.gpu.enfriar, rotulo: `GPU congela ${L.gpu.enfriar}`, color: COLOR.gpu }, { v: L.gpu.cortar, rotulo: `GPU corta ${L.gpu.cortar}`, color: COLOR.gpu, fuerte: true },
                                { v: L.cpu.enfriar, rotulo: `CPU congela ${L.cpu.enfriar}`, color: COLOR.cpu, izq: true }, { v: L.cpu.cortar, rotulo: `CPU corta ${L.cpu.cortar}`, color: COLOR.cpu, fuerte: true, izq: true },
                            ] : []} />
                        <Grafico {...g} titulo="Consumo de la GPU" icono={Zap} unidad="W"
                            series={[{ nombre: "Consumo", color: COLOR.w, valor: (p) => p.w }]} dominio={[0, Math.max(80, wTope || 0)]}
                            rayas={wTope ? [{ v: wTope, rotulo: `tope ${wTope} W`, color: COLOR.w }] : []} />
                        <Grafico {...g} titulo="Uso de la GPU" icono={Gauge} unidad="%"
                            series={[{ nombre: "Uso", color: COLOR.mem, valor: (p) => p.uso }]} dominio={[0, 100]} rayas={[]} />
                        <Grafico {...g} titulo="Memoria de la GPU" icono={Activity} unidad="GB"
                            series={[{ nombre: "Memoria", color: COLOR.gpu, valor: (p) => (p.mem != null ? Math.round((p.mem / 1024) * 10) / 10 : null) }]}
                            dominio={[0, memTotal ? Math.ceil(memTotal / 1024) : 6]} rayas={memTotal ? [{ v: Math.round((memTotal / 1024) * 10) / 10, rotulo: "total", color: COLOR.gpu }] : []} />
                    </div>
                )}
            {enCursor && (
                <p className="text-[12px] text-muted-foreground tabular-nums">
                    <b className="text-foreground">{fechaCorta(enCursor.ts)} {horaSeg(enCursor.ts)}</b> · {enCursor.estado}
                    {enCursor.motivos.length ? <span className="tono-aviso"> · reloj bajado por {enCursor.motivos.join(", ")}</span> : null}
                </p>
            )}

            {/* ── Los entrenamientos ── */}
            <section className="rounded-[10px] border border-border bg-card">
                <div className="px-4 py-3 border-b border-border text-[13px] font-semibold flex items-center gap-2">
                    Entrenamientos {enVivo ? "de las últimas 24 h" : "en el rango"}
                    <span className="text-muted-foreground font-normal tabular-nums">{datos?.entrenamientos.length ?? ""}</span>
                </div>
                {!datos?.entrenamientos.length ? <p className="px-4 py-4 text-[12.5px] text-muted-foreground">Ninguno.</p> : (
                    <div className="overflow-x-auto">
                    <table className="w-full text-[12.5px]">
                        <thead className="text-muted-foreground text-left">
                            <tr className="border-b border-border">
                                <th className="font-semibold px-4 py-2">Cuándo</th><th className="font-semibold px-2">Cómo terminó</th><th className="font-semibold px-2">Fotos</th>
                                <th className="font-semibold px-2 text-right">GPU máx.</th><th className="font-semibold px-2 text-right">CPU máx.</th><th className="font-semibold px-2 text-right">Consumo</th>
                                <th className="font-semibold px-2">Enfriado</th><th className="font-semibold px-4">Nota</th>
                            </tr>
                        </thead>
                        <tbody>
                            {datos.entrenamientos.map((t) => {
                                const s = t.salud;
                                return (
                                    <tr key={t.id} className="border-b border-border last:border-0 align-top">
                                        <td className="px-4 py-2 tabular-nums whitespace-nowrap">{t.desde ? `${fechaCorta(t.desde)} ${hora(t.desde)}` : "—"}{t.desde && t.hasta ? ` · ${duracion((Date.parse(t.hasta) - Date.parse(t.desde)) / 1000)}` : ""}</td>
                                        <td className={cn("px-2 py-2 font-semibold", t.estado === "LISTO" ? "tono-bien" : t.estado === "FALLO" ? "tono-mal" : "")}>{ESTADOS[t.estado] || t.estado}</td>
                                        <td className="px-2 py-2 tabular-nums">{t.fotos ?? "—"}</td>
                                        <td className={cn("px-2 py-2 text-right tabular-nums", tonoTemp(s?.max?.gpu, L?.gpu))}>{s?.max?.gpu != null ? `${s.max.gpu} °C` : "—"}</td>
                                        <td className={cn("px-2 py-2 text-right tabular-nums", tonoTemp(s?.max?.cpu, L?.cpu))}>{s?.max?.cpu != null ? `${Math.round(s.max.cpu)} °C` : "—"}</td>
                                        <td className="px-2 py-2 text-right tabular-nums">{s?.wPromedio != null ? `${s.wPromedio} W prom.` : "—"}{s?.max?.w != null ? <span className="block text-muted-foreground">{Math.round(s.max.w)} máx.</span> : null}</td>
                                        <td className="px-2 py-2 tabular-nums">{s ? (s.pausas ? `${s.pausas} ${s.pausas === 1 ? "vez" : "veces"} · ${duracion(s.enfriadoSeg)}` : "no hizo falta") : "—"}</td>
                                        <td className="px-4 py-2 text-muted-foreground">{s?.corte ? <span className="tono-mal">Cortado: {s.corte}</span> : !s ? "Antes de que se midiera la salud" : ""}</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                    </div>
                )}
            </section>

            {/* ── Cómo se cuida: plegado, se abre si se quiere saber ── */}
            {L && (
                <details className="rounded-[10px] border border-border bg-card px-4 py-3 text-[12.5px] leading-relaxed group">
                    <summary className="text-[13px] font-semibold cursor-pointer select-none list-none flex items-center gap-2"><Snowflake size={14} className="text-muted-foreground" /> Cómo se cuida el equipo al entrenar <span className="ml-auto text-muted-foreground text-[11.5px] group-open:hidden">ver</span></summary>
                    <div className="mt-2 space-y-1.5">
                        <p>No se <b>arranca</b> si la GPU está sobre {L.arrancarHasta.gpu} °C o la CPU sobre {L.arrancarHasta.cpu} °C: queda en cola y espera.</p>
                        <p>Entrenando, si la GPU llega a <b>{L.gpu.enfriar} °C</b> o la CPU a <b>{L.cpu.enfriar} °C</b>, el entrenamiento se <b>congela</b> (no se pierde nada) hasta que bajen a {L.gpu.reanudar} y {L.cpu.reanudar} °C.</p>
                        <p>Se <b>corta</b> del todo si la GPU llega a {L.gpu.cortar} °C, la CPU a {L.cpu.cortar} °C, la GPU baja el reloj por temperatura o energía, o si congelado no se enfría en {L.enfriandoMaxMin} min.</p>
                        <p className="text-muted-foreground">Además: tope de 3 horas por entrenamiento, 4 núcleos y 6 GB de memoria para el contenedor. El vigilante del host (watchdog) no mira temperaturas: reinicia el equipo sólo si se cuelga del todo; las mediciones quedan escritas en disco hasta el último momento para saber qué pasó.</p>
                    </div>
                </details>
            )}
        </div>
    );
}

/**
 * Un medidor de AHORA: arco de 0 al máximo, con el tramo de aviso y el de corte marcados, el
 * número grande y la línea del último par de minutos. El color del arco es el ESTADO (bien,
 * aviso, mal según los límites del entrenador), no la identidad de la serie.
 */
function Medidor({ icono: Ico, rotulo, valor, unidad, min, max, aviso, mal, pie, linea, color }: {
    icono: any; rotulo: string; valor: number | null; unidad: string; min: number; max: number; aviso?: number; mal?: number; pie?: string; linea: number[]; color: string;
}) {
    const f = (v: number) => Math.min(1, Math.max(0, (v - min) / (max - min || 1)));
    const tono = valor == null ? "var(--muted-foreground)" : mal != null && valor >= mal ? "var(--mal)" : aviso != null && valor >= aviso ? "var(--aviso)" : "var(--bien)";
    const R = 38, C = Math.PI * R;
    const arco = (a: number, b: number) => {
        const p = (t: number) => [50 - R * Math.cos(Math.PI * t), 48 - R * Math.sin(Math.PI * t)];
        const [x1, y1] = p(a), [x2, y2] = p(b);
        return `M${x1.toFixed(2)} ${y1.toFixed(2)} A${R} ${R} 0 0 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
    };
    const lmax = Math.max(1, ...linea), lmin = Math.min(...linea, lmax);
    const pts = linea.map((v, i) => `${i === 0 ? "M" : "L"}${(i / Math.max(1, linea.length - 1)) * 100} ${22 - ((v - lmin) / (lmax - lmin || 1)) * 20}`).join(" ");
    return (
        <div className="rounded-[10px] border border-border bg-card px-4 py-3 min-w-0">
            <div className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground"><Ico size={13} /> {rotulo}</div>
            <div className="flex items-end gap-3 mt-1">
                <svg viewBox="0 0 100 54" className="w-[112px] shrink-0" aria-hidden="true">
                    <path d={arco(0, 1)} fill="none" stroke="var(--muted)" strokeWidth="7" strokeLinecap="round" />
                    {aviso != null && <path d={arco(f(aviso), mal != null ? f(mal) : 1)} fill="none" stroke="var(--aviso)" strokeOpacity="0.28" strokeWidth="7" />}
                    {mal != null && <path d={arco(f(mal), 1)} fill="none" stroke="var(--mal)" strokeOpacity="0.32" strokeWidth="7" strokeLinecap="round" />}
                    {valor != null && <path d={arco(0, Math.max(0.001, f(valor)))} fill="none" stroke={tono} strokeWidth="7" strokeLinecap="round"
                        style={{ transition: "all 600ms cubic-bezier(0.25,0.1,0.25,1)" }} strokeDasharray={`${C} ${C}`} />}
                </svg>
                <div className="min-w-0 pb-0.5">
                    <div className="text-[26px] font-bold tabular-nums tracking-[-0.02em] leading-none" style={{ color: valor == null ? undefined : tono === "var(--bien)" ? undefined : tono }}>
                        {valor == null ? "—" : valor}<span className="text-[13px] font-semibold text-muted-foreground ml-0.5">{unidad}</span>
                    </div>
                    {linea.length > 1 && (
                        <svg viewBox="0 0 100 24" preserveAspectRatio="none" className="w-[110px] h-[24px] mt-1.5" aria-hidden="true">
                            <path d={pts} fill="none" stroke={color} strokeWidth="1.6" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
                        </svg>
                    )}
                </div>
            </div>
            {pie && <div className="text-[11px] text-muted-foreground truncate mt-1" title={pie}>{pie}</div>}
        </div>
    );
}

const ESTADOS: Record<string, string> = { LISTO: "Listo", FALLO: "Falló", CANCELADO: "Cancelado", EN_COLA: "En cola", PREPARANDO: "Preparando", ENTRENANDO: "Entrenando", EXPORTANDO: "Exportando" };

function tonoTemp(t: number | null | undefined, l?: { enfriar: number; cortar: number }) {
    if (t == null || !l) return undefined;
    return t >= l.cortar ? "tono-mal" : t >= l.enfriar ? "tono-aviso" : undefined;
}
function duracion(seg: number) {
    const s = Math.round(seg);
    if (s < 60) return `${s} s`;
    const m = Math.round(s / 60);
    return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")}`;
}

function Leyenda({ color, cuadro, children }: { color: string; cuadro?: boolean; children: React.ReactNode }) {
    return <span className="inline-flex items-center gap-1.5"><span className={cuadro ? "w-3 h-3 rounded-[2px]" : "w-3 h-[2px]"} style={{ background: color }} />{children}</span>;
}

const ALTO = 104;

/**
 * Un gráfico de la serie de tiempo. Small multiples, uno por medida y cada uno con su eje: nada de
 * dos escalas en el mismo gráfico. El cursor es compartido: pasar el mouse por uno marca el mismo
 * instante en todos.
 */
function Grafico({ titulo, icono: Ico, unidad, desde, hasta, puntos, series, dominio, rayas, cursor, setCursor, vivo }: {
    titulo: string; icono: any; unidad: string; desde: number; hasta: number; puntos: (Punto | null)[];
    series: { nombre: string; color: string; valor: (p: Punto) => number | null }[];
    dominio: [number, number]; rayas: { v: number; rotulo: string; color: string; fuerte?: boolean; izq?: boolean }[];
    cursor: number | null; setCursor: (t: number | null) => void; vivo?: boolean;
}) {
    const caja = useRef<HTMLDivElement>(null);
    const reales = puntos.filter((p): p is Punto => !!p);
    const [y0, y1] = useMemo(() => {
        const vs = reales.flatMap((p) => series.map((s) => s.valor(p))).filter((v): v is number => v != null);
        return [Math.min(dominio[0], ...vs), Math.max(dominio[1], ...vs)];
    }, [reales, series, dominio]);
    const x = (ts: number) => ((ts - desde) / (hasta - desde || 1)) * 1000;
    const y = (v: number) => ALTO - ((v - y0) / (y1 - y0 || 1)) * ALTO;
    const camino = (s: (typeof series)[number]) => {
        let d = "", abierto = false;
        for (const p of puntos) {
            const v = p ? s.valor(p) : null;
            if (!p || v == null) { abierto = false; continue; }
            d += `${abierto ? "L" : "M"}${x(p.ts).toFixed(1)},${y(v).toFixed(1)}`; abierto = true;
        }
        return d;
    };
    const franjas = useMemo(() => {
        const out: { a: number; b: number; estado: string }[] = [];
        for (const p of reales) {
            if (p.estado === "reposo") continue;
            const u = out[out.length - 1];
            if (u && u.estado === p.estado && p.ts - u.b < 5 * 60_000) u.b = p.ts; else out.push({ a: p.ts, b: p.ts, estado: p.estado });
        }
        return out;
    }, [reales]);
    const enCursor = cursor != null ? reales.reduce<Punto | null>((a, p) => (!a || Math.abs(p.ts - cursor) < Math.abs(a.ts - cursor) ? p : a), null) : null;
    const ultimo = reales[reales.length - 1] || null;
    const mostrado = enCursor || ultimo;
    const ticks = [y0, (y0 + y1) / 2, y1].map((v) => Math.round(v));
    const marcasX = useMemo(() => {
        const span = hasta - desde, paso = span <= 6 * 60_000 ? 60_000 : span <= 3_600_000 ? 10 * 60_000 : span <= 6 * 3_600_000 ? 3_600_000 : span <= 86_400_000 ? 4 * 3_600_000 : 86_400_000;
        const out: number[] = []; for (let t = Math.ceil(desde / paso) * paso; t <= hasta; t += paso) out.push(t); return out;
    }, [desde, hasta]);

    return (
        <section className="rounded-[10px] border border-border bg-card px-4 pt-3 pb-2 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
                <span className="flex items-center gap-1.5 text-[13px] font-semibold"><Ico size={14} className="text-muted-foreground" /> {titulo}</span>
                <span className="ml-auto flex items-center gap-3 text-[12px] tabular-nums">
                    {series.map((s) => { const v = mostrado ? s.valor(mostrado) : null; return (
                        <span key={s.nombre} className="inline-flex items-center gap-1.5">
                            <span className="w-2.5 h-[3px] rounded-full" style={{ background: s.color }} />
                            {series.length > 1 && <span className="text-muted-foreground">{s.nombre}</span>}
                            <b>{v != null ? `${Math.round(v * 10) / 10} ${unidad}` : "—"}</b>
                        </span>); })}
                    {enCursor ? <span className="text-muted-foreground">{horaSeg(enCursor.ts)}</span> : vivo ? <span className="text-muted-foreground">ahora</span> : null}
                </span>
            </div>
            <div className="mt-2 pl-6">
                <div ref={caja} className="relative" style={{ height: ALTO }}
                    onMouseMove={(e) => { const r = caja.current!.getBoundingClientRect(); setCursor(desde + ((e.clientX - r.left) / r.width) * (hasta - desde)); }}
                    onMouseLeave={() => setCursor(null)}>
                    <svg viewBox={`0 0 1000 ${ALTO}`} preserveAspectRatio="none" className="absolute inset-0 w-full h-full overflow-visible">
                        {franjas.map((f, i) => (
                            <rect key={i} x={x(f.a)} y={0} width={Math.max(2, x(f.b) - x(f.a))} height={ALTO}
                                fill={f.estado === "enfriando" ? "color-mix(in oklab, var(--info) 30%, transparent)" : "color-mix(in oklab, var(--accion) 14%, transparent)"} />
                        ))}
                        {ticks.map((t) => <line key={t} x1={0} x2={1000} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeWidth={1} vectorEffect="non-scaling-stroke" />)}
                        {rayas.filter((r) => r.v >= y0 && r.v <= y1).map((r) => (
                            <line key={r.rotulo} x1={0} x2={1000} y1={y(r.v)} y2={y(r.v)} stroke={r.color} strokeOpacity={r.fuerte ? 0.9 : 0.55}
                                strokeWidth={1} strokeDasharray={r.fuerte ? "6 3" : "2 4"} vectorEffect="non-scaling-stroke" />
                        ))}
                        {series.map((s) => (
                            <g key={s.nombre}>
                                <path d={`${camino(s)}`} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
                            </g>
                        ))}
                        {enCursor && <line x1={x(enCursor.ts)} x2={x(enCursor.ts)} y1={0} y2={ALTO} stroke="var(--foreground)" strokeOpacity={0.35} strokeWidth={1} vectorEffect="non-scaling-stroke" />}
                    </svg>
                    {ticks.map((t) => <span key={t} className="absolute -left-1.5 -translate-x-full -translate-y-1/2 text-[10px] text-muted-foreground tabular-nums" style={{ top: `${(y(t) / ALTO) * 100}%` }}>{t}</span>)}
                    {rayas.filter((r) => r.v >= y0 && r.v <= y1).map((r) => (
                        <span key={r.rotulo} className={cn("absolute -translate-y-full text-[9.5px] tabular-nums", r.izq ? "left-1" : "right-1")} style={{ top: `${(y(r.v) / ALTO) * 100}%`, color: r.color }}>{r.rotulo}</span>
                    ))}
                    {/* El punto de «ahora» al final de cada línea, latiendo en vivo. */}
                    {!enCursor && ultimo && series.map((s) => { const v = s.valor(ultimo); return v == null ? null : (
                        <span key={s.nombre} className="absolute -translate-x-1/2 -translate-y-1/2 pointer-events-none" style={{ left: `${x(ultimo.ts) / 10}%`, top: `${(y(v) / ALTO) * 100}%` }}>
                            {vivo && <span className="absolute -inset-1 rounded-full animate-ping opacity-50" style={{ background: s.color }} />}
                            <span className="relative block w-2 h-2 rounded-full border border-card" style={{ background: s.color }} />
                        </span>); })}
                    {enCursor && series.map((s) => { const v = s.valor(enCursor); return v == null ? null : (
                        <span key={s.nombre} className="absolute w-2.5 h-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-card pointer-events-none"
                            style={{ left: `${x(enCursor.ts) / 10}%`, top: `${(y(v) / ALTO) * 100}%`, background: s.color }} />); })}
                </div>
                <div className="relative h-4 mt-1">
                    {marcasX.map((t) => <span key={t} className="absolute -translate-x-1/2 text-[10px] text-muted-foreground tabular-nums" style={{ left: `${x(t) / 10}%` }}>{hasta - desde > 86_400_000 * 1.5 ? fechaCorta(t) : hora(t)}</span>)}
                </div>
            </div>
        </section>
    );
}
