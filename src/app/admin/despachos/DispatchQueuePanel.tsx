"use client";

import { useEffect, useState, useCallback } from "react";
import {
    Send, FileText, Bell, RefreshCw, Clock, CheckCircle2, XCircle,
    Loader2, RotateCcw, AlertTriangle, BarChart3,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { getDispatchJobs, getDispatchStats, retryDispatchJob, enqueueReportDispatch, getDispatchSeries } from "@/app/actions/queue";
import { fechaHora } from "@/lib/fechas";

type Job = {
    id: string; type: string; channel: string; status: string;
    attempts: number; maxAttempts: number; lastError: string | null;
    createdAt: string | Date; sentAt: string | Date | null; payload: any;
};
const FILTERS = [
    { k: "", l: "Todos" }, { k: "PENDING", l: "Pendientes" },
    { k: "SENT", l: "Enviados" }, { k: "FAILED", l: "Fallidos" },
];
const STATUS: Record<string, { label: string; cls: string; icon: any }> = {
    PENDING: { label: "Pendiente", cls: "bg-amber-500/10 text-amber-400 border-amber-500/25", icon: Clock },
    PROCESSING: { label: "Procesando", cls: "bg-sky-500/10 text-sky-400 border-sky-500/25", icon: Loader2 },
    SENT: { label: "Enviado", cls: "bg-emerald-500/10 text-emerald-400 border-emerald-500/25", icon: CheckCircle2 },
    FAILED: { label: "Fallido", cls: "bg-red-500/10 text-red-400 border-red-500/25", icon: XCircle },
    CANCELLED: { label: "Cancelado", cls: "bg-muted text-muted-foreground border-border", icon: XCircle },
};

function DispatchChart({ buckets }: { buckets: any[] }) {
    const data = (buckets && buckets.length ? buckets : Array.from({ length: 24 }, () => ({ label: "", count: 0, sent: 0, failed: 0 })));
    const max = Math.max(...data.map((b: any) => b.count), 3);
    const total = data.reduce((s: number, b: any) => s + b.count, 0);
    const W = 700, H = 92, PADB = 14;
    const bw = W / data.length;
    return (
        <div className="px-4 py-3 border-b border-border bg-gradient-to-b from-violet-500/[0.04] to-transparent">
            <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold text-foreground/70">
                    <BarChart3 size={13} className="text-violet-400" /> Despachos · últimas 24 h
                </div>
                <div className="flex items-center gap-3 text-[9px] text-muted-foreground">
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-emerald-500 inline-block" /> enviados</span>
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-red-500 inline-block" /> fallidos</span>
                    <span className="font-mono text-foreground/60">{total} total</span>
                </div>
            </div>
            <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 92 }} preserveAspectRatio="none">
                {[0.5, 1].map((g, i) => (
                    <line key={i} x1={0} x2={W} y1={(H - PADB) * (1 - g)} y2={(H - PADB) * (1 - g)} stroke="currentColor" strokeOpacity="0.07" />
                ))}
                {data.map((b: any, i: number) => {
                    const h = max > 0 ? (b.count / max) * (H - PADB) : 0;
                    const sentH = b.count > 0 ? (b.sent / b.count) * h : 0;
                    const failH = h - sentH;
                    const x = i * bw + bw * 0.18;
                    const w = bw * 0.64;
                    const yTop = (H - PADB) - h;
                    return (
                        <g key={i}>
                            <title>{b.label}: {b.count} ({b.sent} ok / {b.failed} fallidos)</title>
                            {failH > 0 && <rect x={x} y={yTop} width={w} height={failH} rx={1.5} fill="#ef4444" />}
                            {sentH > 0 && <rect x={x} y={yTop + failH} width={w} height={sentH} rx={1.5} fill="#10b981" />}
                            {b.count === 0 && <rect x={x} y={(H - PADB) - 1.5} width={w} height={1.5} rx={0.75} fill="currentColor" fillOpacity="0.1" />}
                        </g>
                    );
                })}
            </svg>
        </div>
    );
}

export default function DispatchQueuePanel() {
    const [jobs, setJobs] = useState<Job[]>([]);
    const [stats, setStats] = useState({ pending: 0, sent: 0, failed: 0 });
    const [filter, setFilter] = useState("");
    const [loading, setLoading] = useState(true);
    const [period, setPeriod] = useState<"daily" | "weekly">("daily");
    const [dispatching, setDispatching] = useState(false);
    const [series, setSeries] = useState<any[]>([]);

    const load = useCallback(async () => {
        try {
            const [j, s, ser] = await Promise.all([
                getDispatchJobs({ take: 80, status: filter || undefined }),
                getDispatchStats(),
                getDispatchSeries(),
            ]);
            setJobs(j as any); setStats(s as any); setSeries(ser as any);
        } catch (e) { console.error(e); } finally { setLoading(false); }
    }, [filter]);

    useEffect(() => { load(); const t = setInterval(load, 6000); return () => clearInterval(t); }, [load]);

    const retry = async (id: string) => {
        try { await retryDispatchJob(id); toast.success("Re-encolado"); load(); }
        catch { toast.error("No se pudo re-encolar"); }
    };

    const dispatchReport = async () => {
        setDispatching(true);
        try { await enqueueReportDispatch({ period }); toast.success("Reporte encolado para despacho"); setTimeout(load, 600); }
        catch { toast.error("No se pudo encolar el reporte"); }
        finally { setDispatching(false); }
    };

    const fmt = (d: string | Date) => fechaHora(new Date(d));

    return (
        <div className="rounded-2xl border border-border bg-card overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                <div className="flex items-center gap-2">
                    <Send size={16} className="text-violet-400" />
                    <span className="text-sm font-bold text-foreground">Cola de despachos</span>
                </div>
                <div className="flex items-center gap-2">
                    <select value={period} onChange={e => setPeriod(e.target.value as "daily" | "weekly")}
                        className="bg-muted/60 border border-border rounded-lg px-2 py-1.5 text-xs text-foreground outline-none focus:border-violet-500">
                        <option value="daily">Reporte diario</option>
                        <option value="weekly">Reporte semanal</option>
                    </select>
                    <button onClick={dispatchReport} disabled={dispatching}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-60 text-white text-xs font-semibold transition">
                        {dispatching ? <RefreshCw size={13} className="animate-spin" /> : <FileText size={13} />} Despachar
                    </button>
                    <button onClick={load} className="p-2 rounded-lg bg-muted hover:bg-accent border border-border text-muted-foreground transition" title="Recargar">
                        <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
                    </button>
                </div>
            </div>

            <div className="grid grid-cols-3 divide-x divide-border border-b border-border">
                {[
                    { l: "En cola", v: stats.pending, c: "#f59e0b", I: Clock },
                    { l: "Enviados hoy", v: stats.sent, c: "#10b981", I: CheckCircle2 },
                    { l: "Fallidos", v: stats.failed, c: "#ef4444", I: AlertTriangle },
                ].map(({ l, v, c, I }) => (
                    <div key={l} className="flex items-center gap-2.5 px-4 py-3">
                        <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ background: `${c}1a`, color: c }}><I size={16} /></div>
                        <div>
                            <div className="text-xl font-bold tabular-nums" style={{ color: c }}>{v}</div>
                            <div className="text-[10px] text-muted-foreground uppercase tracking-wide">{l}</div>
                        </div>
                    </div>
                ))}
            </div>

            <DispatchChart buckets={series} />

            <div className="flex items-center gap-1.5 px-4 py-2.5 border-b border-border flex-wrap">
                {FILTERS.map(f => (
                    <button key={f.k} onClick={() => setFilter(f.k)}
                        className={cn("px-3 py-1.5 rounded-lg text-xs font-semibold border transition",
                            filter === f.k ? "bg-violet-600 border-violet-600 text-white" : "bg-muted/50 border-border text-muted-foreground hover:text-foreground")}>
                        {f.l}
                    </button>
                ))}
            </div>

            <div className="divide-y divide-border max-h-[480px] overflow-y-auto">
                {jobs.length === 0 && !loading ? (
                    <div className="px-4 py-10 text-center text-sm text-muted-foreground flex flex-col items-center gap-2">
                        <Send size={22} className="opacity-40" /> Sin despachos {filter ? "con este filtro" : "todavía"}.
                    </div>
                ) : jobs.map(j => {
                    const st = STATUS[j.status] || STATUS.PENDING;
                    const StIcon = st.icon;
                    const isReport = j.type === "REPORT";
                    const label = j.payload?.ruleName || (isReport ? "Reporte" : "Alerta");
                    return (
                        <div key={j.id} className="flex items-center gap-3 px-4 py-2.5">
                            <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center shrink-0", isReport ? "bg-sky-500/10 text-sky-400" : "bg-violet-500/10 text-violet-400")}>
                                {isReport ? <FileText size={15} /> : <Bell size={15} />}
                            </div>
                            <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                    <span className="text-sm font-semibold text-foreground truncate">{label}</span>
                                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-mono uppercase">{j.channel}</span>
                                </div>
                                <div className="text-[11px] text-muted-foreground flex flex-wrap items-center gap-x-2.5 gap-y-0.5 mt-0.5">
                                    <span>{fmt(j.createdAt)}</span>
                                    <span>· intentos {j.attempts}/{j.maxAttempts}</span>
                                    {j.lastError && <span className="text-red-400 truncate max-w-[260px]" title={j.lastError}>· {j.lastError}</span>}
                                </div>
                            </div>
                            <span className={cn("inline-flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded border shrink-0", st.cls)}>
                                <StIcon size={11} className={j.status === "PROCESSING" ? "animate-spin" : ""} /> {st.label}
                            </span>
                            {j.status === "FAILED" && (
                                <button onClick={() => retry(j.id)} title="Reintentar" className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground transition shrink-0">
                                    <RotateCcw size={14} />
                                </button>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
