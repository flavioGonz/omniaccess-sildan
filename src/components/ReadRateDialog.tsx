"use client";

import { useEffect, useState } from "react";
import { X, ScanLine, Loader2, ArrowRightCircle, ArrowLeftCircle, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";

const RANGES = [{ d: 1, l: "Hoy" }, { d: 7, l: "7 días" }, { d: 30, l: "30 días" }];
const rateColor = (r: number | null) => r == null ? "text-muted-foreground" : r >= 90 ? "text-emerald-400" : r >= 75 ? "text-amber-400" : "text-red-400";
const barColor = (r: number | null) => r == null ? "bg-border" : r >= 90 ? "bg-emerald-500" : r >= 75 ? "bg-amber-500" : "bg-red-500";

export function ReadRateDialog({ onClose }: { onClose: () => void }) {
    const [days, setDays] = useState(7);
    const [loading, setLoading] = useState(true);
    const [data, setData] = useState<any>(null);

    useEffect(() => {
        let stop = false; setLoading(true);
        fetch(`/api/lpr/read-rate?days=${days}`, { cache: "no-store" }).then((r) => r.json()).then((j) => { if (!stop && j.ok) setData(j); }).catch(() => { }).finally(() => { if (!stop) setLoading(false); });
        return () => { stop = true; };
    }, [days]);

    const overall = data?.overall;
    const perCamera: any[] = data?.perCamera || [];
    const perHour: any[] = data?.perHour || [];

    return (
        <div className="fixed inset-0 z-[3300] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-150" onClick={onClose}>
            <div className="relative w-full max-w-3xl rounded-2xl bg-card border border-border shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between px-5 py-3 border-b border-border">
                    <div className="flex items-center gap-2.5">
                        <div className="p-2 rounded-lg bg-amber-500/10 border border-amber-500/20"><ScanLine size={16} className="text-amber-400" /></div>
                        <div>
                            <h3 className="text-sm font-bold text-foreground">Tasa de lectura ANPR</h3>
                            <p className="text-[10px] text-muted-foreground">Placas leídas vs no reconocidas</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="flex items-center gap-0.5 bg-background/60 p-0.5 rounded-lg border border-border/60">
                            {RANGES.map((r) => <button key={r.d} onClick={() => setDays(r.d)} className={cn("h-6 px-2 rounded-md text-[10px] font-bold", days === r.d ? "bg-foreground/10 text-foreground" : "text-muted-foreground hover:text-foreground")}>{r.l}</button>)}
                        </div>
                        <button onClick={onClose} className="h-8 w-8 rounded-lg hover:bg-accent text-muted-foreground flex items-center justify-center"><X size={16} /></button>
                    </div>
                </div>

                {loading ? (
                    <div className="flex items-center justify-center py-16 text-muted-foreground gap-2"><Loader2 size={16} className="animate-spin" /> Calculando…</div>
                ) : (
                    <div className="p-5 space-y-5 max-h-[72vh] overflow-y-auto">
                        {/* KPIs */}
                        <div className="grid grid-cols-4 gap-3">
                            <div className="bg-background/50 border border-border/50 rounded-lg p-3 col-span-1">
                                <p className="text-[9px] uppercase font-bold text-muted-foreground tracking-wide">Tasa global</p>
                                <p className={cn("text-2xl font-bold", rateColor(overall?.ratePct))}>{overall?.ratePct != null ? overall.ratePct + "%" : "—"}</p>
                            </div>
                            <div className="bg-background/50 border border-border/50 rounded-lg p-3"><p className="text-[9px] uppercase font-bold text-muted-foreground tracking-wide">Capturas</p><p className="text-2xl font-bold text-foreground">{overall?.total ?? 0}</p></div>
                            <div className="bg-background/50 border border-border/50 rounded-lg p-3"><p className="text-[9px] uppercase font-bold text-emerald-400/80 tracking-wide">Leídas</p><p className="text-2xl font-bold text-emerald-400">{overall?.read ?? 0}</p></div>
                            <div className="bg-background/50 border border-border/50 rounded-lg p-3"><p className="text-[9px] uppercase font-bold text-red-400/80 tracking-wide">No leídas</p><p className="text-2xl font-bold text-red-400">{overall?.unread ?? 0}</p></div>
                        </div>

                        {/* Por cámara (peor primero) */}
                        <div>
                            <p className="text-[11px] font-semibold text-muted-foreground mb-2">Por cámara <span className="text-[9px] opacity-70">· peor primero</span></p>
                            <div className="space-y-1.5">
                                {perCamera.length === 0 && <p className="text-xs text-muted-foreground py-3">Sin capturas en el rango</p>}
                                {perCamera.map((c) => (
                                    <div key={c.deviceId || c.name} className="flex items-center gap-3">
                                        <span className="w-40 shrink-0 flex items-center gap-1.5 text-xs font-semibold text-foreground truncate">
                                            {c.direction === "ENTRY" ? <ArrowRightCircle size={12} className="text-emerald-400 shrink-0" /> : c.direction === "EXIT" ? <ArrowLeftCircle size={12} className="text-orange-400 shrink-0" /> : null}
                                            <span className="truncate">{c.name}</span>
                                        </span>
                                        <div className="flex-1 h-4 rounded-full bg-background/70 border border-border/50 overflow-hidden">
                                            <div className={cn("h-full rounded-full transition-all", barColor(c.ratePct))} style={{ width: `${c.ratePct ?? 0}%` }} />
                                        </div>
                                        <span className={cn("w-12 text-right text-xs font-bold font-mono", rateColor(c.ratePct))}>{c.ratePct != null ? c.ratePct + "%" : "—"}</span>
                                        <span className="w-24 text-right text-[10px] text-muted-foreground font-mono">{c.read}/{c.total} <span className="text-red-400/70">({c.unread})</span></span>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Por hora */}
                        <div>
                            <p className="text-[11px] font-semibold text-muted-foreground mb-2 flex items-center gap-1.5"><TrendingUp size={12} /> Tasa por hora del día <span className="text-[9px] opacity-70">· detecta degradación nocturna</span></p>
                            <div className="flex items-end gap-[3px] h-24 border-b border-border/50 pb-0">
                                {perHour.map((h) => (
                                    <div key={h.hour} className="flex-1 flex flex-col items-center justify-end h-full group relative">
                                        <div className={cn("w-full rounded-t transition-all", barColor(h.ratePct))} style={{ height: `${h.total ? (h.ratePct ?? 0) : 0}%`, minHeight: h.total ? 2 : 0, opacity: h.total ? 1 : 0.25 }} />
                                        <div className="absolute bottom-full mb-1 hidden group-hover:block bg-popover border border-border rounded px-1.5 py-1 text-[9px] whitespace-nowrap z-10 shadow-lg">
                                            {String(h.hour).padStart(2, "0")}h · {h.ratePct != null ? h.ratePct + "%" : "s/d"} · {h.read}/{h.total}
                                        </div>
                                    </div>
                                ))}
                            </div>
                            <div className="flex justify-between text-[8px] text-muted-foreground mt-1"><span>00h</span><span>06h</span><span>12h</span><span>18h</span><span>23h</span></div>
                        </div>

                        <p className="text-[10px] text-muted-foreground">Verde ≥90% · ámbar 75-90% · rojo &lt;90%. Las cámaras/horas en rojo son candidatas a recalibrar (obturador/anti-brillo desde el botón Calibrar).</p>
                    </div>
                )}
            </div>
        </div>
    );
}

export default ReadRateDialog;
