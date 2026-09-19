"use client";

import { useEffect, useMemo, useState } from "react";
import { X, Activity, MemoryStick, Timer, AlertTriangle, CheckCircle2, Loader2, Wifi } from "lucide-react";
import { fecha, hora } from "@/lib/fechas";

type Sample = { ts: string; reachable: boolean; latencyMs: number | null; memPct: number | null; driftSec: number | null; disksOk: boolean | null; viewers: number | null };
type Alert = { id: string; type: string; severity: string; message: string; openedAt: string; resolvedAt: string | null; active: boolean };

const RANGES = [{ h: 6, l: "6h" }, { h: 24, l: "24h" }, { h: 72, l: "3d" }, { h: 168, l: "7d" }];

/** Sparkline SVG: serie de valores (o null) mapeada al viewBox, con bandas rojas donde reachable=false */
function Sparkline({ samples, pick, color, unit, height = 60 }: { samples: Sample[]; pick: (s: Sample) => number | null; color: string; unit: string; height?: number }) {
    const W = 700, H = height, pad = 4;
    const pts = samples.map((s) => pick(s));
    const nums = pts.filter((v): v is number => v != null);
    if (nums.length === 0) return <div className="text-[11px] text-muted-foreground py-4 text-center">Sin datos en el rango</div>;
    const min = Math.min(...nums), max = Math.max(...nums);
    const range = max - min || 1;
    const n = samples.length;
    const x = (i: number) => pad + (i / Math.max(1, n - 1)) * (W - 2 * pad);
    const y = (v: number) => H - pad - ((v - min) / range) * (H - 2 * pad);
    // polyline sólo por segmentos contiguos con dato
    let d = ""; let started = false;
    pts.forEach((v, i) => { if (v == null) { started = false; return; } d += `${started ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)} `; started = true; });
    // bandas offline
    const bands: { x0: number; x1: number }[] = [];
    let bandStart = -1;
    samples.forEach((s, i) => {
        if (!s.reachable && bandStart < 0) bandStart = i;
        if (s.reachable && bandStart >= 0) { bands.push({ x0: x(bandStart), x1: x(i) }); bandStart = -1; }
    });
    if (bandStart >= 0) bands.push({ x0: x(bandStart), x1: x(n - 1) });

    return (
        <div>
            <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full" style={{ height }}>
                {bands.map((b, i) => <rect key={i} x={b.x0} y={0} width={Math.max(1, b.x1 - b.x0)} height={H} fill="rgba(239,68,68,0.14)" />)}
                <path d={d.trim()} fill="none" stroke={color} strokeWidth={1.6} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
            </svg>
            <div className="flex justify-between text-[9px] text-muted-foreground mt-0.5 px-0.5">
                <span>min {min}{unit}</span><span>max {max}{unit}</span>
            </div>
        </div>
    );
}

export function HealthHistoryDialog({ device, onClose }: { device: any; onClose: () => void }) {
    const [hours, setHours] = useState(24);
    const [loading, setLoading] = useState(true);
    const [samples, setSamples] = useState<Sample[]>([]);
    const [alerts, setAlerts] = useState<Alert[]>([]);
    const [uptime, setUptime] = useState<number | null>(null);

    useEffect(() => {
        let stop = false;
        (async () => {
            setLoading(true);
            try {
                const r = await fetch(`/api/devices/health-history?deviceId=${device.id}&hours=${hours}`, { cache: "no-store" });
                const j = await r.json();
                if (!stop && j.ok) { setSamples(j.samples || []); setAlerts(j.alerts || []); setUptime(j.uptimePct ?? null); }
            } catch { } finally { if (!stop) setLoading(false); }
        })();
        return () => { stop = true; };
    }, [device.id, hours]);

    const lastLatency = useMemo(() => { for (let i = samples.length - 1; i >= 0; i--) if (samples[i].latencyMs != null) return samples[i].latencyMs; return null; }, [samples]);
    const isNvr = device.deviceType === "NVR";

    return (
        <div className="fixed inset-0 z-[3300] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-150" onClick={onClose}>
            <div className="relative w-full max-w-3xl rounded-2xl bg-card border border-border shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
                {/* header */}
                <div className="flex items-center justify-between px-5 py-3 border-b border-border">
                    <div className="flex items-center gap-2.5">
                        <div className="p-2 rounded-lg bg-indigo-500/10 border border-indigo-500/20"><Activity size={16} className="text-indigo-400" /></div>
                        <div>
                            <h3 className="text-sm font-bold text-foreground">Salud · {device.name}</h3>
                            <p className="text-[10px] text-muted-foreground">Historial y alertas</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="flex items-center gap-0.5 bg-background/60 p-0.5 rounded-lg border border-border/60">
                            {RANGES.map((r) => (
                                <button key={r.h} onClick={() => setHours(r.h)} className={`h-6 px-2 rounded-md text-[10px] font-bold ${hours === r.h ? "bg-foreground/10 text-foreground" : "text-muted-foreground hover:text-foreground"}`}>{r.l}</button>
                            ))}
                        </div>
                        <button onClick={onClose} className="h-8 w-8 rounded-lg hover:bg-accent text-muted-foreground flex items-center justify-center"><X size={16} /></button>
                    </div>
                </div>

                <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
                    {/* KPIs */}
                    <div className="grid grid-cols-3 gap-3">
                        <div className="bg-background/50 border border-border/50 rounded-lg p-3">
                            <p className="text-[9px] uppercase font-bold text-muted-foreground tracking-wide flex items-center gap-1"><Wifi size={11} /> Disponibilidad</p>
                            <p className={`text-xl font-bold ${uptime != null && uptime >= 99 ? "text-emerald-400" : uptime != null && uptime >= 90 ? "text-amber-400" : "text-red-400"}`}>{uptime != null ? uptime + "%" : "—"}</p>
                        </div>
                        <div className="bg-background/50 border border-border/50 rounded-lg p-3">
                            <p className="text-[9px] uppercase font-bold text-muted-foreground tracking-wide flex items-center gap-1"><Timer size={11} /> Latencia (últ.)</p>
                            <p className="text-xl font-bold text-foreground">{lastLatency != null ? lastLatency + " ms" : "—"}</p>
                        </div>
                        <div className="bg-background/50 border border-border/50 rounded-lg p-3">
                            <p className="text-[9px] uppercase font-bold text-muted-foreground tracking-wide flex items-center gap-1"><AlertTriangle size={11} /> Muestras</p>
                            <p className="text-xl font-bold text-foreground">{samples.length}</p>
                        </div>
                    </div>

                    {loading ? (
                        <div className="flex items-center justify-center py-10 text-muted-foreground gap-2"><Loader2 size={16} className="animate-spin" /> Cargando historial…</div>
                    ) : (
                        <>
                            <div>
                                <p className="text-[11px] font-semibold text-muted-foreground mb-1 flex items-center gap-1.5"><Timer size={12} className="text-cyan-400" /> Latencia ISAPI (ms) · bandas rojas = sin respuesta</p>
                                <Sparkline samples={samples} pick={(s) => s.latencyMs} color="#22d3ee" unit="ms" />
                            </div>
                            {isNvr && (
                                <div>
                                    <p className="text-[11px] font-semibold text-muted-foreground mb-1 flex items-center gap-1.5"><MemoryStick size={12} className="text-fuchsia-400" /> Memoria NVR (%)</p>
                                    <Sparkline samples={samples} pick={(s) => s.memPct} color="#e879f9" unit="%" />
                                </div>
                            )}

                            {/* alertas */}
                            <div>
                                <p className="text-[11px] font-semibold text-muted-foreground mb-1.5">Alertas recientes</p>
                                {alerts.length === 0 ? (
                                    <div className="flex items-center gap-2 text-[12px] text-emerald-400 bg-emerald-500/5 border border-emerald-500/15 rounded-lg px-3 py-2"><CheckCircle2 size={14} /> Sin alertas registradas</div>
                                ) : (
                                    <div className="space-y-1.5">
                                        {alerts.map((a) => (
                                            <div key={a.id} className={`flex items-start gap-2 rounded-lg px-3 py-2 border text-[11px] ${a.active ? "bg-red-500/8 border-red-500/25" : "bg-background/50 border-border/50"}`}>
                                                <div className="mt-0.5">{a.active ? <AlertTriangle size={13} className="text-red-400" /> : <CheckCircle2 size={13} className="text-emerald-400/70" />}</div>
                                                <div className="flex-1">
                                                    <p className={`font-semibold ${a.active ? "text-red-300" : "text-muted-foreground"}`}>{a.message}</p>
                                                    <p className="text-[9px] text-muted-foreground">{fecha(new Date(a.openedAt))} {a.resolvedAt ? `· resuelta ${hora(new Date(a.resolvedAt))}` : "· ACTIVA"}</p>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}

export default HealthHistoryDialog;
