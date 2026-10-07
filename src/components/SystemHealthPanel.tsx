"use client";

import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { Server, HardDrive, Video, Clock, Activity, CheckCircle2, AlertTriangle, XCircle, RefreshCw, X, ShieldAlert, Gauge } from "lucide-react";
import { getIntrusionStats } from "@/app/actions/detections";

type Dev = { id: string; name?: string; deviceType?: string; brand?: string; reachable?: boolean; latencyMs?: number | null; disks?: any[]; localTime?: string; timeMode?: string };
type Stats = Awaited<ReturnType<typeof getIntrusionStats>>;

const fmtAgo = (ms: number | null) => {
    if (!ms) return "—";
    const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
    if (s < 60) return `hace ${s}s`;
    if (s < 3600) return `hace ${Math.round(s / 60)} min`;
    if (s < 86400) return `hace ${Math.round(s / 3600)} h`;
    return `hace ${Math.round(s / 86400)} d`;
};
const fmtDur = (s: number | null) => s == null ? "—" : s < 60 ? `${s} s` : s < 3600 ? `${(s / 60).toFixed(1)} min` : `${(s / 3600).toFixed(1)} h`;

function nvrState(d: Dev): "ok" | "warn" | "bad" {
    if (!d.reachable) return "bad";
    const disks = Array.isArray(d.disks) ? d.disks : [];
    if (disks.length && !disks.every((x) => x.status === "ok")) return "warn";
    return "ok";
}
const DOT = { ok: "bg-emerald-500", warn: "bg-amber-500", bad: "bg-red-500" } as const;
const ICO = { ok: <CheckCircle2 size={13} className="text-emerald-500" />, warn: <AlertTriangle size={13} className="text-amber-500" />, bad: <XCircle size={13} className="text-red-500" /> } as const;

export default function SystemHealthPanel({ onClose }: { onClose: () => void }) {
    const [devs, setDevs] = useState<Record<string, Dev>>({});
    const [stats, setStats] = useState<Stats | null>(null);
    const [ts, setTs] = useState<number>(0);
    const [loading, setLoading] = useState(true);

    const load = useCallback(async () => {
        try {
            const [h, s] = await Promise.all([
                fetch("/api/devices/health", { cache: "no-store" }).then((r) => r.json()).catch(() => null),
                getIntrusionStats().catch(() => null),
            ]);
            if (h?.devices) setDevs(h.devices);
            if (s) setStats(s);
            setTs(Date.now());
        } catch { } finally { setLoading(false); }
    }, []);
    useEffect(() => { load(); const iv = setInterval(load, 30000); return () => clearInterval(iv); }, [load]);

    const list = Object.values(devs);
    const nvrs = list.filter((d) => d.deviceType === "NVR");
    const cams = list.filter((d) => d.deviceType === "LPR_CAMERA");
    const camsOn = cams.filter((d) => d.reachable).length;
    const nvrOk = nvrs.filter((d) => nvrState(d) === "ok").length;
    const overall: "ok" | "warn" | "bad" = nvrs.some((d) => nvrState(d) === "bad") || (cams.length > 0 && camsOn === 0) ? "bad"
        : nvrs.some((d) => nvrState(d) === "warn") || camsOn < cams.length ? "warn" : "ok";

    const Kpi = ({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: string; tone?: "bad" | "warn" | "ok" }) => (
        <div className="rounded-xl border border-border bg-background/60 p-2.5">
            <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{icon} {label}</div>
            <div className={cn("text-xl font-extrabold tabular-nums mt-0.5", tone === "bad" ? "text-red-500" : tone === "warn" ? "text-amber-500" : "text-foreground")}>{value}</div>
        </div>
    );

    return (
        <div className="absolute top-4 right-4 bottom-4 z-[600] w-[300px] bg-card/95 backdrop-blur-xl border border-border rounded-2xl shadow-2xl flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2.5 border-b border-border shrink-0">
                <div className="text-[13px] font-bold flex items-center gap-2"><Gauge size={15} className="text-sky-500" /> Estado del sistema</div>
                <div className="flex items-center gap-1">
                    <button onClick={load} title="Actualizar" className="w-7 h-7 grid place-items-center rounded-lg hover:bg-accent text-muted-foreground"><RefreshCw size={13} className={cn(loading && "animate-spin")} /></button>
                    <button onClick={onClose} className="w-7 h-7 grid place-items-center rounded-lg hover:bg-accent text-muted-foreground"><X size={14} /></button>
                </div>
            </div>
            <div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-3">
                <div className={cn("rounded-xl px-3 py-2.5 flex items-center gap-2.5 text-white", overall === "ok" ? "bg-emerald-600" : overall === "warn" ? "bg-amber-500" : "bg-red-600")}>
                    {overall === "ok" ? <CheckCircle2 size={22} /> : overall === "warn" ? <AlertTriangle size={22} /> : <XCircle size={22} />}
                    <div>
                        <div className="text-[13px] font-extrabold leading-tight">{overall === "ok" ? "Sistema operativo" : overall === "warn" ? "Atención requerida" : "Falla detectada"}</div>
                        <div className="text-[11px] opacity-90">{nvrOk}/{nvrs.length} NVR · {camsOn}/{cams.length} cámaras en línea</div>
                    </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                    <Kpi icon={<Activity size={11} />} label="Eventos hoy" value={String(stats?.eventsToday ?? "—")} />
                    <Kpi icon={<ShieldAlert size={11} />} label="Pendientes" value={String(stats?.pending ?? "—")} tone={stats && stats.pending > 0 ? "bad" : "ok"} />
                    <Kpi icon={<AlertTriangle size={11} />} label="Falsas 24 h" value={stats?.falsePct == null ? "—" : `${stats.falsePct}%`} tone={stats && stats.falsePct != null && stats.falsePct > 50 ? "warn" : "ok"} />
                    <Kpi icon={<Clock size={11} />} label="Reacción media" value={fmtDur(stats?.avgReactionSec ?? null)} />
                </div>
                <div className="text-[10px] text-muted-foreground -mt-1">Último evento: {fmtAgo(stats?.lastEventMs ?? null)}</div>

                <div>
                    <div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground mb-1.5 flex items-center gap-1.5"><Server size={11} /> Grabadores</div>
                    <div className="space-y-1.5">
                        {nvrs.length === 0 && <div className="text-[11px] text-muted-foreground px-1">Sondeando…</div>}
                        {nvrs.map((d) => {
                            const st = nvrState(d);
                            const disks = Array.isArray(d.disks) ? d.disks : [];
                            return (
                                <div key={d.id} className="rounded-xl border border-border bg-background/60 p-2">
                                    <div className="flex items-center gap-2">
                                        <span className={cn("w-2 h-2 rounded-full shrink-0", DOT[st])} />
                                        <span className="text-[12px] font-bold truncate flex-1">{d.name || "NVR"}</span>
                                        <span className="shrink-0">{ICO[st]}</span>
                                    </div>
                                    <div className="flex items-center gap-3 mt-1 text-[10px] text-muted-foreground">
                                        <span className="inline-flex items-center gap-1"><Activity size={10} /> {d.reachable ? `${d.latencyMs ?? "?"} ms` : "sin resp."}</span>
                                        {disks.length > 0 && <span className="inline-flex items-center gap-1"><HardDrive size={10} /> {disks.every((x) => x.status === "ok") ? "SMART OK" : "degradado"}</span>}
                                        {d.localTime && <span className="inline-flex items-center gap-1"><Clock size={10} /> {d.timeMode === "NTP" ? "NTP" : "manual"}</span>}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>

                <div>
                    <div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground mb-1.5 flex items-center gap-1.5"><Video size={11} /> Cámaras LPR</div>
                    <div className="rounded-xl border border-border bg-background/60 p-2.5">
                        <div className="flex items-center justify-between text-[12px] font-bold"><span>En línea</span><span className={cn("tabular-nums", camsOn < cams.length ? "text-amber-500" : "text-emerald-500")}>{camsOn}/{cams.length}</span></div>
                        <div className="mt-1.5 h-1.5 rounded-full bg-muted overflow-hidden"><div className={cn("h-full rounded-full", camsOn < cams.length ? "bg-amber-500" : "bg-emerald-500")} style={{ width: `${cams.length ? (camsOn / cams.length) * 100 : 0}%` }} /></div>
                    </div>
                </div>

                <div className="text-[9px] text-muted-foreground text-center pt-1">Actualizado {ts ? new Date(ts).toLocaleTimeString("es-UY", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—"} · sondeo cada 30 s</div>
            </div>
        </div>
    );
}
