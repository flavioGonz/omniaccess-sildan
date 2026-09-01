"use client";

import { useEffect, useState, useCallback } from "react";
import { SlidersHorizontal, RefreshCw, Activity, Waves, CheckCircle2, Info, Loader2, Timer, Camera, HelpCircle, Gauge } from "lucide-react";
import { getQueueRawVsStable, getQueueDevices } from "@/app/actions/queue";

type Pt = { t: number; v: number };
type Data = {
    raw: Pt[]; stable: Pt[]; rawChanges: number; stableChanges: number;
    changesPerMin: number; amplitude: number; suggestedReboteSec: number; samples: number; minutes: number;
};

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
                    <text x={PAD_L - 6} y={PAD_T + g * plotH + 3.5} textAnchor="end" fontSize="11" fontFamily="monospace" style={{ fill: "var(--muted-foreground)" }}>{Math.round(maxV * (1 - g))}</text>
                </g>
            ))}
            <path d={path(raw)} fill="none" stroke="#f59e0b" strokeWidth="1.6" strokeOpacity="0.55" />
            <path d={path(stable)} fill="none" stroke="#a855f7" strokeWidth="3" strokeLinejoin="round" />
        </svg>
    );
}

export default function CalibracionPage() {
    const [data, setData] = useState<Data | null>(null);
    const [loading, setLoading] = useState(true);
    const [minutes, setMinutes] = useState(10);
    const [deviceName, setDeviceName] = useState("Fila");

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const devs = await getQueueDevices();
            const dev = devs?.[0];
            if (dev) setDeviceName(dev.name || "Fila");
            const d = await getQueueRawVsStable(dev?.id, minutes);
            setData(d as any);
        } catch (e) { console.error(e); } finally { setLoading(false); }
    }, [minutes]);

    useEffect(() => { load(); }, [load]);

    const m = data;
    const noisy = (m?.changesPerMin ?? 0) > 8;
    const rebote = m?.suggestedReboteSec ?? null;

    return (
        <div className="max-w-5xl mx-auto space-y-6 p-6">
            {/* Header */}
            <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-3.5">
                    <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-violet-600 to-fuchsia-600 flex items-center justify-center shadow-lg shadow-violet-900/40">
                        <SlidersHorizontal size={20} className="text-white" />
                    </div>
                    <div>
                        <h1 className="text-xl font-bold tracking-tight">Calibración de Aforo</h1>
                        <p className="text-xs text-muted-foreground">{deviceName} · ajustá la estabilidad del conteo de personas</p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-bold mr-1 hidden sm:inline">Ventana</span>
                    <div className="inline-flex items-center gap-1 p-1 rounded-lg bg-muted/60 border border-border">
                        {[10, 30, 60].map(opt => (
                            <button key={opt} onClick={() => setMinutes(opt)}
                                className={`px-3 py-1.5 rounded-md text-xs font-semibold transition ${minutes === opt ? "bg-violet-600 text-white" : "text-muted-foreground hover:text-foreground"}`}>
                                {opt} min
                            </button>
                        ))}
                    </div>
                    <button onClick={load} className="p-2 rounded-lg bg-muted hover:bg-accent border border-border text-muted-foreground hover:text-foreground transition" title="Recargar">
                        <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
                    </button>
                </div>
            </div>

            {/* ¿Qué es esto? */}
            <div className="rounded-2xl border border-border bg-card p-5">
                <div className="flex items-center gap-2 mb-2">
                    <HelpCircle size={16} className="text-violet-400" />
                    <h2 className="text-sm font-bold text-foreground">¿Qué es la calibración de aforo?</h2>
                </div>
                <p className="text-[13px] leading-relaxed text-muted-foreground">
                    La cámara cuenta cuántas personas hay en la fila, pero ese número puede <b className="text-foreground/80">&quot;parpadear&quot;</b> (subir y bajar de golpe) por sombras, movimiento o detecciones momentáneas. Esta pantalla mide ese parpadeo y te sugiere un <b className="text-violet-400">tiempo de rebote</b>: cuántos segundos esperar y confirmar antes de aceptar un cambio como real. Con un rebote bien ajustado, el aforo se ve estable y las alertas no se disparan por ruido.
                </p>
                <div className="mt-3 flex flex-wrap gap-3 text-[12px]">
                    <div className="flex items-center gap-2 rounded-lg bg-muted/40 border border-border px-3 py-2">
                        <Timer size={14} className="text-violet-400 shrink-0" />
                        <span className="text-muted-foreground"><b className="text-foreground/80">Rebote alto</b> → más estable, pero responde más lento.</span>
                    </div>
                    <div className="flex items-center gap-2 rounded-lg bg-muted/40 border border-border px-3 py-2">
                        <Activity size={14} className="text-amber-400 shrink-0" />
                        <span className="text-muted-foreground"><b className="text-foreground/80">Rebote bajo</b> → más sensible, pero más ruidoso.</span>
                    </div>
                </div>
            </div>

            {/* Suggestion banner */}
            <div className={`rounded-2xl border p-5 flex items-start gap-4 ${noisy ? "border-amber-500/30 bg-amber-500/[0.06]" : "border-emerald-500/30 bg-emerald-500/[0.06]"}`}>
                {noisy ? <Waves size={30} className="text-amber-400 shrink-0 mt-0.5" /> : <CheckCircle2 size={30} className="text-emerald-400 shrink-0 mt-0.5" />}
                <div className="flex-1">
                    <div className="text-base font-bold text-foreground">
                        {noisy ? "El aforo fluctúa bastante — conviene calibrar" : "El aforo se ve estable"}
                    </div>
                    <div className="text-[13px] text-muted-foreground mt-1">
                        {noisy
                            ? "El conteo está cambiando con frecuencia. Aplicá el tiempo de rebote sugerido en la cámara para suavizarlo."
                            : "El conteo es consistente. Igual podés afinar el rebote sugerido si querés más o menos sensibilidad."}
                    </div>
                    <div className="mt-3 inline-flex items-center gap-2 rounded-lg bg-violet-500/10 border border-violet-500/25 px-3 py-2">
                        <Timer size={16} className="text-violet-400" />
                        <span className="text-sm text-foreground">Tiempo de rebote sugerido:</span>
                        <span className="text-lg font-bold text-violet-400 tabular-nums">{rebote ?? "—"} s</span>
                    </div>
                </div>
            </div>

            {/* Metrics con explicación */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {[
                    { label: "Cambios crudos", value: m?.rawChanges ?? 0, icon: Activity, color: "#f59e0b", desc: "Veces que el número cambió en el período, leído directo de la cámara (con su ruido)." },
                    { label: "Cambios estabilizado", value: m?.stableChanges ?? 0, icon: CheckCircle2, color: "#a855f7", desc: "Cuántos cambios quedarían aplicando el rebote sugerido. Cuanto menos, más estable." },
                    { label: "Cambios por minuto", value: m?.changesPerMin ?? 0, icon: Waves, color: "#06b6d4", desc: "Frecuencia de fluctuación. Si es alto (>8), el conteo parpadea demasiado." },
                    { label: "Amplitud (máx − mín)", value: m?.amplitude ?? 0, icon: Gauge, color: "#10b981", desc: "Diferencia entre el aforo más alto y el más bajo observado en la ventana." },
                ].map(({ label, value, icon: Icon, color, desc }) => (
                    <div key={label} className="rounded-xl border border-border bg-card p-4">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground uppercase tracking-wider font-bold">
                                <Icon size={13} style={{ color }} /> {label}
                            </div>
                            <div className="text-2xl font-bold tabular-nums" style={{ color }}>{value}</div>
                        </div>
                        <p className="text-[11px] text-muted-foreground mt-2 leading-snug">{desc}</p>
                    </div>
                ))}
            </div>

            {/* Chart */}
            <div className="rounded-2xl border border-border bg-gradient-to-b from-foreground/[0.03] to-transparent p-5">
                <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                    <span className="text-sm font-semibold text-foreground/80">Aforo · últimos {minutes} min</span>
                    <div className="flex items-center gap-4 text-[11px]">
                        <span className="flex items-center gap-1.5 text-amber-400"><span className="w-4 h-[3px] rounded bg-amber-500/60 inline-block" /> Crudo (lo que manda la cámara)</span>
                        <span className="flex items-center gap-1.5 text-violet-400"><span className="w-4 h-[3px] rounded bg-violet-500 inline-block" /> Estabilizado (con rebote sugerido)</span>
                    </div>
                </div>
                {loading ? (
                    <div className="h-[280px] flex items-center justify-center"><Loader2 size={24} className="animate-spin text-violet-400" /></div>
                ) : (
                    <Chart raw={m?.raw || []} stable={m?.stable || []} />
                )}
                <p className="text-[11px] text-muted-foreground mt-2">
                    La línea <span className="text-violet-400 font-semibold">violeta</span> simula cómo quedaría el aforo con el rebote sugerido: más plana = más estable. Si las dos líneas se parecen mucho, la cámara ya está bien calibrada.
                </p>
            </div>

            {/* Cómo aplicar */}
            <div className="rounded-2xl border border-border bg-card p-5">
                <div className="flex items-center gap-2 mb-3">
                    <Camera size={16} className="text-emerald-400" />
                    <h2 className="text-sm font-bold text-foreground">Cómo aplicar el ajuste en la cámara</h2>
                </div>
                <ol className="space-y-2.5">
                    {[
                        <>Mirá la gráfica de arriba y el <b className="text-foreground/80">tiempo de rebote sugerido</b> (<span className="text-violet-400 font-bold">{rebote ?? "—"} s</span>).</>,
                        <>Entrá a la configuración de la cámara y andá a <span className="font-mono text-foreground/80 bg-muted/50 px-1.5 py-0.5 rounded">VCA → Tareas → Aforo → Tiempo de rebote</span>.</>,
                        <>Poné el valor sugerido (o ajustalo: subilo si todavía parpadea, bajalo si responde muy lento) y guardá en la cámara.</>,
                        <>Volvé acá, tocá <RefreshCw size={11} className="inline -mt-0.5 text-muted-foreground" /> <b className="text-foreground/80">Recargar</b> y verificá que <b className="text-foreground/80">Cambios por minuto</b> haya bajado.</>,
                    ].map((step, i) => (
                        <li key={i} className="flex items-start gap-3">
                            <span className="w-6 h-6 rounded-full bg-violet-500/15 border border-violet-500/30 text-violet-400 text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">{i + 1}</span>
                            <span className="text-[13px] text-muted-foreground leading-relaxed pt-0.5">{step}</span>
                        </li>
                    ))}
                </ol>
            </div>

            <div className="flex items-start gap-2 text-[11px] text-muted-foreground">
                <Info size={13} className="shrink-0 mt-0.5 text-violet-400" />
                <span>Este panel mide el ruido residual sobre {m?.samples ?? 0} lecturas de los últimos {minutes} minutos. La cámara aplica su propio rebote antes de enviar; lo que ves acá es la recomendación para terminar de afinarlo.</span>
            </div>
        </div>
    );
}
