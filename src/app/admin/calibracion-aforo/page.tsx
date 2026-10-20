"use client";

import { useEffect, useState, useCallback } from "react";
import { SlidersHorizontal, RefreshCw, Activity, Waves, CheckCircle2, Info, Loader2, Timer, HelpCircle, Gauge, ScanLine, LineChart, AlertTriangle } from "lucide-react";
import { getQueueRawVsStable, getQueueDevices } from "@/app/actions/queue";
import EditorBosch from "@/components/queue/EditorBosch";
import { cn } from "@/lib/utils";

type Pt = { t: number; v: number };
type Data = {
    raw: Pt[]; stable: Pt[]; rawChanges: number; stableChanges: number;
    changesPerMin: number; amplitude: number; suggestedReboteSec: number; samples: number; minutes: number;
};

/** Ventanas de la señal, en minutos. */
const VENTANAS_MIN = [10, 30, 60] as const;
/** Cambios por minuto a partir de los cuales el aforo «parpadea» (el mismo criterio de antes). */
const CAMBIOS_RUIDOSOS_POR_MIN = 8;

/*
 * Colores: el crudo va en el tono de aviso (es lo que molesta) y el estabilizado en el de info.
 * Antes eran un ámbar y un violeta escritos a mano; el violeta ni siquiera es un color del sistema.
 */
function Chart({ raw, stable }: { raw: Pt[]; stable: Pt[] }) {
    if (raw.length < 2) {
        return <div className="h-[280px] flex flex-col items-center justify-center text-muted-foreground gap-2"><Waves size={28} className="opacity-30" /><span className="text-sm">Sin lecturas en el período seleccionado.</span><span className="text-xs">Probá con una ventana más larga o esperá a que la fila tenga actividad.</span></div>;
    }
    const W = 1000, H = 280, PAD_L = 38, PAD_R = 14, PAD_T = 16, PAD_B = 28;
    const plotW = W - PAD_L - PAD_R, plotH = H - PAD_T - PAD_B;
    const t0 = raw[0].t, t1 = raw[raw.length - 1].t || t0 + 1;
    const maxV = Math.max(...raw.map(p => p.v), ...stable.map(p => p.v), 2);
    const x = (t: number) => PAD_L + ((t - t0) / Math.max(t1 - t0, 1)) * plotW;
    const y = (v: number) => PAD_T + (1 - v / maxV) * plotH;
    const path = (pts: Pt[]) => pts.map((p, i) => `${i === 0 ? "M" : "L"} ${x(p.t).toFixed(1)} ${y(p.v).toFixed(1)}`).join(" ");
    return (
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: "auto" }} preserveAspectRatio="xMidYMid meet">
            {[0, 0.25, 0.5, 0.75, 1].map((g, i) => (
                <g key={i}>
                    <line x1={PAD_L} y1={PAD_T + g * plotH} x2={W - PAD_R} y2={PAD_T + g * plotH} stroke="var(--border)" strokeWidth="1" strokeDasharray={g === 1 ? "0" : "4 6"} opacity={g === 1 ? 0.8 : 0.35} />
                    <text x={PAD_L - 6} y={PAD_T + g * plotH + 3.5} textAnchor="end" fontSize="11" fontFamily="var(--font-sans)" style={{ fill: "var(--muted-foreground)" }}>{Math.round(maxV * (1 - g))}</text>
                </g>
            ))}
            <path d={path(raw)} fill="none" style={{ stroke: "var(--aviso)" }} strokeWidth="1.6" strokeOpacity="0.6" />
            <path d={path(stable)} fill="none" style={{ stroke: "var(--info)" }} strokeWidth="3" strokeLinejoin="round" />
        </svg>
    );
}

/**
 * La señal del aforo de UNA cámara: la elegida arriba. Antes leía siempre la primera cámara de la
 * lista (`getQueueDevices()[0]`) aunque arriba hubiera otra elegida: con dos filas, la pestaña
 * mostraba el ruido de una con el nombre de la otra en el selector.
 */
function SenalAforo({ deviceId, deviceName }: { deviceId: string; deviceName: string }) {
    const [data, setData] = useState<Data | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [minutes, setMinutes] = useState<number>(VENTANAS_MIN[0]);

    const load = useCallback(async () => {
        setLoading(true); setError(null);
        try { setData(await getQueueRawVsStable(deviceId, minutes) as any); }
        catch (e: any) { setError(e?.message || "No se pudo leer la señal del aforo"); }
        finally { setLoading(false); }
    }, [deviceId, minutes]);

    useEffect(() => { load(); }, [load]);

    const m = data;
    const noisy = (m?.changesPerMin ?? 0) > CAMBIOS_RUIDOSOS_POR_MIN;
    const rebote = m?.suggestedReboteSec ?? null;

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                    <h2 className="text-[17px] font-bold tracking-[-0.01em]">Señal del aforo</h2>
                    <p className="text-[12px] text-muted-foreground">{deviceName} · qué tan estable llega el conteo de personas</p>
                </div>
                <div className="flex items-center gap-2">
                    <div className="inline-flex items-center gap-1 p-1 rounded-full bg-muted/60 border border-border">
                        {VENTANAS_MIN.map(opt => (
                            <button key={opt} onClick={() => setMinutes(opt)}
                                className={cn("px-3 py-1 rounded-full text-xs font-semibold transition", minutes === opt ? "bg-card text-foreground border border-border" : "text-muted-foreground hover:text-foreground")}>
                                {opt} min
                            </button>
                        ))}
                    </div>
                    <button onClick={load} className="p-2 rounded-[6px] hover:bg-muted border border-border text-muted-foreground hover:text-foreground transition" title="Recargar">
                        <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
                    </button>
                </div>
            </div>

            {error && (
                <div className="flex items-start gap-2 rounded-[10px] border chip-mal p-3 text-sm">
                    <AlertTriangle size={16} className="mt-0.5 shrink-0" /><span className="flex-1">{error}</span>
                    <button onClick={load} className="text-[12px] font-semibold underline">Reintentar</button>
                </div>
            )}

            <div className="rounded-[10px] border border-border bg-card p-5">
                <div className="flex items-center gap-2 mb-2">
                    <HelpCircle size={16} className="text-muted-foreground" />
                    <h3 className="text-sm font-bold">¿Qué mide esto?</h3>
                </div>
                <p className="text-[13px] leading-relaxed text-muted-foreground">
                    La cámara cuenta cuántas personas hay en la fila, pero ese número puede <b className="text-foreground/80">parpadear</b> (subir y bajar de golpe) por sombras, movimiento o detecciones momentáneas. Esta pestaña mide ese parpadeo y sugiere un <b className="text-foreground/80">tiempo de rebote</b>: cuánto tiene que durar un cambio para que la cámara lo acepte. Con un rebote bien ajustado el aforo se ve estable y los avisos no saltan por ruido.
                </p>
                <div className="mt-3 flex flex-wrap gap-3 text-[12px]">
                    <div className="flex items-center gap-2 rounded-[6px] bg-muted/40 border border-border px-3 py-2">
                        <Timer size={14} className="text-muted-foreground shrink-0" />
                        <span className="text-muted-foreground"><b className="text-foreground/80">Rebote alto</b> → más estable, pero responde más lento.</span>
                    </div>
                    <div className="flex items-center gap-2 rounded-[6px] bg-muted/40 border border-border px-3 py-2">
                        <Activity size={14} className="text-muted-foreground shrink-0" />
                        <span className="text-muted-foreground"><b className="text-foreground/80">Rebote bajo</b> → más sensible, pero más ruidoso.</span>
                    </div>
                </div>
            </div>

            <div className={cn("rounded-[10px] border p-5 flex items-start gap-4", noisy ? "chip-aviso" : "chip-bien")}>
                {noisy ? <Waves size={28} className="shrink-0 mt-0.5" /> : <CheckCircle2 size={28} className="shrink-0 mt-0.5" />}
                <div className="flex-1">
                    <div className="text-base font-bold text-foreground">
                        {noisy ? "El aforo fluctúa bastante: conviene calibrar" : "El aforo se ve estable"}
                    </div>
                    <div className="text-[13px] text-muted-foreground mt-1">
                        {noisy
                            ? "El conteo cambia muy seguido. Aplicá el rebote sugerido en la pestaña «Zona y rebote en la cámara»."
                            : "El conteo es consistente. Igual podés afinar el rebote si querés más o menos sensibilidad."}
                    </div>
                    <div className="mt-3 inline-flex items-center gap-2 rounded-[6px] bg-card border border-border px-3 py-2">
                        <Timer size={16} className="text-muted-foreground" />
                        <span className="text-sm text-foreground">Rebote sugerido:</span>
                        <span className="text-lg font-bold tabular-nums">{rebote ?? "—"} s</span>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {[
                    { label: "Cambios crudos", value: m?.rawChanges ?? 0, icon: Activity, desc: "Veces que el número cambió en el período, leído directo de la cámara (con su ruido)." },
                    { label: "Cambios estabilizado", value: m?.stableChanges ?? 0, icon: CheckCircle2, desc: "Cuántos cambios quedarían aplicando el rebote sugerido. Cuanto menos, más estable." },
                    { label: "Cambios por minuto", value: m?.changesPerMin ?? 0, icon: Waves, desc: `Frecuencia de fluctuación. Si pasa de ${CAMBIOS_RUIDOSOS_POR_MIN}, el conteo parpadea demasiado.` },
                    { label: "Amplitud (máx − mín)", value: m?.amplitude ?? 0, icon: Gauge, desc: "Diferencia entre el aforo más alto y el más bajo observado en la ventana." },
                ].map(({ label, value, icon: Icon, desc }) => (
                    <div key={label} className="rounded-[10px] border border-border bg-card p-4">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-1.5 text-[12px] text-muted-foreground font-semibold">
                                <Icon size={13} /> {label}
                            </div>
                            <div className="text-2xl font-bold tabular-nums">{value}</div>
                        </div>
                        <p className="text-[11px] text-muted-foreground mt-2 leading-snug">{desc}</p>
                    </div>
                ))}
            </div>

            <div className="rounded-[10px] border border-border bg-card p-5">
                <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                    <span className="text-sm font-semibold text-foreground/80">Aforo · últimos {minutes} min</span>
                    <div className="flex items-center gap-4 text-[11px] text-muted-foreground">
                        <span className="flex items-center gap-1.5"><span className="w-4 h-[3px] rounded pleno-aviso inline-block opacity-70" /> Crudo (lo que manda la cámara)</span>
                        <span className="flex items-center gap-1.5"><span className="w-4 h-[3px] rounded pleno-info inline-block" /> Estabilizado (con el rebote sugerido)</span>
                    </div>
                </div>
                {loading ? (
                    <div className="h-[280px] flex items-center justify-center"><Loader2 size={24} className="animate-spin text-muted-foreground" /></div>
                ) : (
                    <Chart raw={m?.raw || []} stable={m?.stable || []} />
                )}
                <p className="text-[11px] text-muted-foreground mt-2">
                    La línea del estabilizado simula cómo quedaría el aforo con el rebote sugerido: más plana es más estable. Si las dos líneas se parecen mucho, la cámara ya está bien calibrada.
                </p>
            </div>

            {/* Antes decía «entrá a la configuración de la cámara, VCA → Tareas…»: desde que existe
                el editor de la Bosch, el rebote se cambia y se guarda desde la otra pestaña. */}
            <div className="rounded-[10px] border border-border bg-card p-5">
                <h3 className="text-sm font-bold mb-3">Cómo aplicar el ajuste</h3>
                <ol className="space-y-2.5">
                    {[
                        <>Mirá la gráfica y el <b className="text-foreground/80">rebote sugerido</b> (<b className="tabular-nums">{rebote ?? "—"} s</b>).</>,
                        <>En la pestaña <b className="text-foreground/80">Zona y rebote en la cámara</b>, mové «Rebote de la zona» a ese valor (o usá «Usar valores sugeridos»).</>,
                        <>Tocá <b className="text-foreground/80">Guardar en la cámara</b>: se guarda un backup antes de escribir.</>,
                        <>Volvé acá, tocá <RefreshCw size={11} className="inline -mt-0.5 text-muted-foreground" /> y verificá que <b className="text-foreground/80">Cambios por minuto</b> haya bajado.</>,
                    ].map((step, i) => (
                        <li key={i} className="flex items-start gap-3">
                            <span className="w-6 h-6 rounded-full bg-muted border border-border text-xs font-bold flex items-center justify-center shrink-0 mt-0.5 tabular-nums">{i + 1}</span>
                            <span className="text-[13px] text-muted-foreground leading-relaxed pt-0.5">{step}</span>
                        </li>
                    ))}
                </ol>
            </div>

            <div className="flex items-start gap-2 text-[11px] text-muted-foreground">
                <Info size={13} className="shrink-0 mt-0.5" />
                <span>Medido sobre {m?.samples ?? 0} lecturas de los últimos {minutes} minutos. La cámara aplica su propio rebote antes de enviar; esto es lo que queda de ruido después.</span>
            </div>
        </div>
    );
}


/** Calibración de la fila: zona y rebote que usa la cámara (editable) + señal medida del aforo. */
export default function CalibracionPage() {
    const [tab, setTab] = useState<"zona" | "senal">("zona");
    const [devs, setDevs] = useState<{ id: string; name: string; ip: string; brand: string }[]>([]);
    const [sel, setSel] = useState("");
    const [cargando, setCargando] = useState(true);
    useEffect(() => {
        // ?device=<id>: se llega desde la ficha del contador con esa cámara elegida.
        const pedido = new URLSearchParams(window.location.search).get("device");
        getQueueDevices().then((d: any[]) => { setDevs(d); const el = d.find((x) => x.id === pedido) || d[0]; if (el) setSel(el.id); })
            .catch(() => {}).finally(() => setCargando(false));
    }, []);
    const dev = devs.find((d) => d.id === sel);
    const tabs = [
        { id: "zona" as const, label: "Zona y rebote en la cámara", icon: ScanLine },
        { id: "senal" as const, label: "Señal del aforo", icon: LineChart },
    ];
    return (
        <div className="max-w-[1500px] mx-auto space-y-6 p-6">
            <div className="flex items-center gap-3.5 flex-wrap">
                <div className="w-11 h-11 rounded-[10px] bg-muted text-muted-foreground flex items-center justify-center"><SlidersHorizontal size={20} /></div>
                <div>
                    <h1 className="text-[22px] font-bold tracking-[-0.02em]">Calibración de la fila</h1>
                    <p className="text-[12px] text-muted-foreground">Dibujá la zona y ajustá el rebote directamente en la cámara</p>
                </div>
                {devs.length > 1 && (
                    <select value={sel} onChange={(e) => setSel(e.target.value)} className="ml-auto rounded-[6px] border border-border bg-background px-3 py-2 text-sm">
                        {devs.map((d) => <option key={d.id} value={d.id}>{d.name} · {d.ip}</option>)}
                    </select>
                )}
            </div>
            <div className="inline-flex items-center gap-1 p-1 rounded-full bg-muted/60 border border-border">
                {tabs.map((t) => {
                    const I = t.icon;
                    return (
                        <button key={t.id} onClick={() => setTab(t.id)}
                            className={cn("flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-semibold transition", tab === t.id ? "bg-card text-foreground border border-border" : "text-muted-foreground hover:text-foreground")}>
                            <I size={14} /> {t.label}
                        </button>
                    );
                })}
            </div>
            {cargando ? <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 size={14} className="animate-spin" /> Cargando cámaras…</div>
                : !dev ? <div className="text-sm text-muted-foreground">No hay cámaras de fila cargadas.</div>
                    : tab === "zona" ? (
                        dev.brand !== "BOSCH" ? <div className="text-sm text-muted-foreground">El editor de zona y rebote está disponible para cámaras Bosch. {dev.name} es {dev.brand}.</div>
                            : <EditorBosch key={dev.id} deviceId={dev.id} streamSrc={`bosch_${dev.ip.replace(/\./g, "_")}`} />
                    ) : <SenalAforo key={dev.id} deviceId={dev.id} deviceName={dev.name} />}
        </div>
    );
}
