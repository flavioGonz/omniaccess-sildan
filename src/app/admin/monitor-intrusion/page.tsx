"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";
import { getSocketUrl } from "@/lib/socket-config";
import { getDevices } from "@/app/actions/devices";
import { getRecentDetections, getDevicesWithAnalytics, type DetItem } from "@/app/actions/detections";
import { Radar, ShieldAlert, Activity, LogIn, LogOut, Camera, Circle, Filter, BellRing, Loader2, Check, PencilRuler } from "lucide-react";
import { cn } from "@/lib/utils";

const META: Record<string, { label: string; cls: string; dot: string; Icon: any }> = {
    LINECROSS: { label: "Cruce de línea", cls: "text-red-300 border-red-500/40 bg-red-500/10", dot: "bg-red-500", Icon: Radar },
    INTRUSION: { label: "Intrusión", cls: "text-red-300 border-red-500/40 bg-red-500/10", dot: "bg-red-500", Icon: ShieldAlert },
    REGION_ENTER: { label: "Entra a zona", cls: "text-amber-300 border-amber-500/40 bg-amber-500/10", dot: "bg-amber-500", Icon: LogIn },
    REGION_EXIT: { label: "Sale de zona", cls: "text-amber-300 border-amber-500/40 bg-amber-500/10", dot: "bg-amber-500", Icon: LogOut },
    MOTION: { label: "Movimiento", cls: "text-sky-300 border-sky-500/40 bg-sky-500/10", dot: "bg-sky-500", Icon: Activity },
    OTHER: { label: "Evento", cls: "text-slate-300 border-slate-500/40 bg-slate-500/10", dot: "bg-slate-500", Icon: Activity },
};

function ago(ts: string) {
    const s = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
    if (s < 60) return "hace " + s + "s";
    const m = Math.floor(s / 60); if (m < 60) return "hace " + m + "m";
    const h = Math.floor(m / 60); if (h < 24) return "hace " + h + "h";
    return new Date(ts).toLocaleDateString("es-UY", { day: "2-digit", month: "2-digit" });
}

function CamTile({ dev, flash, last, onCalibrate }: { dev: any; flash: boolean; last?: DetItem; onCalibrate: (dev: any) => void }) {
    const [rk, setRk] = useState(0);
    const [alarm, setAlarm] = useState<"idle" | "loading" | "ok" | "already" | "err">("idle");
    useEffect(() => { const iv = setInterval(() => setRk((x) => x + 1), 3000); return () => clearInterval(iv); }, []);
    const src = `/api/snapshot/${dev.id}?t=${rk}`;
    const m = last ? (META[last.type] || META.OTHER) : null;

    const configAlarm = async (e: React.MouseEvent) => {
        e.stopPropagation();
        setAlarm("loading");
        try {
            const r = await fetch(`/api/devices/alarm-host?deviceId=${dev.id}`, { method: "POST" });
            const d = await r.json();
            setAlarm(d.ok ? (d.already ? "already" : "ok") : "err");
        } catch { setAlarm("err"); }
        setTimeout(() => setAlarm("idle"), 2600);
    };

    return (
        <div className={cn("relative rounded-xl overflow-hidden border aspect-video bg-black transition-all duration-300 group/tile", flash ? "border-red-500 shadow-[0_0_28px_rgba(239,68,68,0.8)] ring-2 ring-red-500/60" : "border-neutral-800")}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src} alt={dev.name} className="absolute inset-0 w-full h-full object-cover" onError={(e) => { (e.currentTarget as HTMLImageElement).style.opacity = "0.15"; }} />
            <div className="absolute top-2 left-2 z-10 flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-black/60 backdrop-blur-sm border border-white/10">
                <Camera size={11} className="text-white/70" />
                <span className="text-[10px] font-bold text-white/90 truncate max-w-[140px]">{dev.name}</span>
            </div>
            {/* Acciones (arriba derecha) */}
            <div className="absolute top-2 right-2 z-20 flex items-center gap-1.5">
                <button onClick={(e) => { e.stopPropagation(); onCalibrate(dev); }} title="Calibrar líneas y zonas" className="grid h-7 w-7 place-items-center rounded-md bg-black/60 hover:bg-black/80 border border-white/10 text-white/80 backdrop-blur-sm active:scale-95">
                    <PencilRuler size={13} />
                </button>
                <button onClick={configAlarm} title="Configurar servidor de alarma (envío de eventos a OmniAccess)"
                    className={cn("inline-flex items-center gap-1 h-7 px-2 rounded-md border backdrop-blur-sm text-[10px] font-bold active:scale-95",
                        alarm === "ok" || alarm === "already" ? "bg-emerald-500/20 border-emerald-400/40 text-emerald-300" :
                            alarm === "err" ? "bg-red-500/20 border-red-400/40 text-red-300" : "bg-black/60 hover:bg-black/80 border-white/10 text-white/80")}>
                    {alarm === "loading" ? <Loader2 size={12} className="animate-spin" /> : (alarm === "ok" || alarm === "already") ? <Check size={12} /> : <BellRing size={12} />}
                    {alarm === "ok" ? "Listo" : alarm === "already" ? "OK" : alarm === "err" ? "Error" : "Alarma"}
                </button>
            </div>
            {m && (
                <div className={cn("absolute bottom-2 left-2 right-2 z-10 flex items-center gap-1.5 px-2 py-1 rounded-lg border backdrop-blur-sm", m.cls)}>
                    <m.Icon size={13} className="shrink-0" />
                    <span className="text-[11px] font-bold truncate">{m.label}</span>
                    <span className="ml-auto text-[10px] text-white/60 shrink-0">{ago(last!.timestamp)}</span>
                </div>
            )}
        </div>
    );
}

export default function MonitorIntrusion() {
    const [devices, setDevices] = useState<any[]>([]);
    const [analyticsIds, setAnalyticsIds] = useState<Set<string>>(new Set());
    const [dets, setDets] = useState<DetItem[]>([]);
    const [filter, setFilter] = useState<"ALL" | "ANALYTIC" | "MOTION">("ANALYTIC");
    const [flash, setFlash] = useState<Record<string, number>>({});
    const [calibrateDev, setCalibrateDev] = useState<any>(null);
    const [alert, setAlertItem] = useState<DetItem | null>(null);

    useEffect(() => {
        getDevices().then((d: any[]) => setDevices((d || []).filter((x) => x.deviceType !== "NVR"))).catch(() => { });
        getDevicesWithAnalytics().then((ids) => setAnalyticsIds(new Set(ids))).catch(() => { });
    }, []);

    useEffect(() => {
        getRecentDetections(60, filter !== "ANALYTIC").then(setDets).catch(() => { });
    }, [filter]);

    useEffect(() => {
        let s: any;
        try {
            s = io(getSocketUrl(), { transports: ["websocket", "polling"] });
            s.on("general_detection", (d: any) => {
                if (filter === "ANALYTIC" && d.type === "MOTION") return;
                const item: DetItem = { id: d.id, deviceId: d.deviceId, deviceName: d.deviceName, type: d.type, eventType: d.eventType, snapshotPath: null, timestamp: d.timestamp };
                setDets((prev) => [item, ...prev.filter((x) => x.id !== d.id)].slice(0, 60));
                if (d.deviceId) { setFlash((f) => ({ ...f, [d.deviceId]: Date.now() })); setTimeout(() => setFlash((f) => { const n = { ...f }; if (n[d.deviceId] && Date.now() - n[d.deviceId] >= 1400) delete n[d.deviceId]; return n; }), 1600); }
                // Alerta prominente para intrusión/cruce de línea/zona (no movimiento)
                if (d.type !== "MOTION") { setAlertItem(item); setTimeout(() => setAlertItem((a) => (a && a.id === item.id ? null : a)), 8000); }
            });
        } catch { /* noop */ }
        return () => { try { s && s.disconnect(); } catch { } };
    }, [filter]);

    // última detección por cámara (para el badge del tile)
    const lastByDev = useMemo(() => {
        const map: Record<string, DetItem> = {};
        for (const d of dets) { if (d.deviceId && !map[d.deviceId]) map[d.deviceId] = d; }
        return map;
    }, [dets]);

    // cámaras ordenadas DINÁMICAMENTE: las que acaban de detectar algo suben arriba,
    // luego las que tienen analíticas, luego el resto (por nombre).
    const cams = useMemo(() => {
        const score = (d: any) => {
            const last = lastByDev[d.id];
            const recent = last ? Date.now() - new Date(last.timestamp).getTime() : Infinity;
            if (recent < 60_000) return 3_000_000 - recent / 1000;       // detección en el último minuto → arriba, más reciente primero
            if (analyticsIds.has(d.id)) return 1_000;                     // con analíticas
            return 0;
        };
        return [...devices].sort((a, b) => score(b) - score(a) || String(a.name).localeCompare(String(b.name)));
    }, [devices, analyticsIds, lastByDev]);

    const shownDets = filter === "MOTION" ? dets.filter((d) => d.type === "MOTION") : filter === "ANALYTIC" ? dets.filter((d) => d.type !== "MOTION") : dets;

    return (
        <div className="h-full flex flex-col">
            {/* Header */}
            <div className="shrink-0 flex items-center justify-between px-6 py-4 border-b border-border">
                <div className="flex items-center gap-3">
                    <span className="relative grid h-10 w-10 place-items-center rounded-xl bg-red-500/15">
                        <Radar size={20} className="text-red-500" />
                    </span>
                    <div>
                        <h1 className="text-lg font-bold tracking-tight">Monitor de Intrusión</h1>
                        <p className="text-xs text-muted-foreground">Detecciones de analítica: cruce de línea, intrusión, zonas y movimiento</p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-emerald-400"><Circle size={8} className="fill-emerald-500 text-emerald-500 animate-pulse" /> En vivo</span>
                    <div className="ml-3 inline-flex rounded-xl border border-border p-0.5 bg-card">
                        {(["ANALYTIC", "MOTION", "ALL"] as const).map((f) => (
                            <button key={f} onClick={() => setFilter(f)} className={cn("px-3 py-1.5 rounded-lg text-[11px] font-bold uppercase tracking-wide transition-colors", filter === f ? "bg-red-500/20 text-red-300" : "text-muted-foreground hover:text-foreground")}>
                                {f === "ANALYTIC" ? "Intrusión" : f === "MOTION" ? "Movimiento" : "Todo"}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {/* Body */}
            <div className="flex-1 grid grid-cols-[1fr_360px] divide-x divide-border overflow-hidden">
                {/* Cámaras */}
                <div className="overflow-y-auto custom-scrollbar p-5">
                    {/* Alerta prominente: el guardia se entera al instante */}
                    {alert && (() => { const m = META[alert.type] || META.OTHER; return (
                        <div className="mb-4 flex items-center gap-3 px-5 py-4 rounded-2xl border-2 border-red-500 bg-red-500/15 animate-pulse">
                            <span className="grid h-12 w-12 place-items-center rounded-xl bg-red-500/25 shrink-0"><m.Icon size={26} className="text-red-400" /></span>
                            <div className="min-w-0">
                                <div className="text-lg font-extrabold tracking-tight text-red-400 uppercase">{m.label}</div>
                                <div className="text-sm text-white/80 truncate">{alert.deviceName || "Cámara"} · {ago(alert.timestamp)}</div>
                            </div>
                            <button onClick={() => setAlertItem(null)} className="ml-auto text-xs font-bold text-white/50 hover:text-white uppercase tracking-wide">Descartar</button>
                        </div>
                    ); })()}
                    {cams.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
                            <Camera size={28} className="opacity-30" />
                            <span className="text-sm">Sin cámaras</span>
                        </div>
                    ) : (
                        <div className="grid grid-cols-2 xl:grid-cols-3 gap-4">
                            {cams.map((dev) => (
                                <CamTile key={dev.id} dev={dev} flash={!!flash[dev.id]} last={lastByDev[dev.id]} onCalibrate={setCalibrateDev} />
                            ))}
                        </div>
                    )}
                </div>

                {/* Feed de detecciones */}
                <div className="flex flex-col overflow-hidden">
                    <div className="shrink-0 px-4 py-3 border-b border-border flex items-center gap-2">
                        <Filter size={13} className="text-muted-foreground" />
                        <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Detecciones</span>
                        <span className="ml-auto px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-red-500/15 text-red-300 border border-red-500/30">{shownDets.length}</span>
                    </div>
                    <div className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-1.5">
                        {shownDets.length === 0 ? (
                            <div className="flex items-center justify-center h-24 text-[12px] text-muted-foreground">Sin detecciones</div>
                        ) : shownDets.map((d) => {
                            const m = META[d.type] || META.OTHER;
                            return (
                                <div key={d.id} className={cn("flex items-center gap-2.5 px-3 py-2 rounded-xl border", m.cls)}>
                                    <m.Icon size={16} className="shrink-0" />
                                    <div className="min-w-0">
                                        <div className="text-sm font-bold leading-none">{m.label}</div>
                                        <div className="text-[11px] text-white/60 truncate mt-0.5">{d.deviceName || "Cámara"}</div>
                                    </div>
                                    <span className="ml-auto text-[10px] text-white/50 shrink-0">{ago(d.timestamp)}</span>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>

            {/* Calibrador de líneas y zonas (shell — el editor sobre el video se habilita en #191) */}
            {calibrateDev && (
                <div className="fixed inset-0 z-[2000] bg-black/80 backdrop-blur-sm flex items-center justify-center p-6" onClick={() => setCalibrateDev(null)}>
                    <div className="w-full max-w-lg rounded-2xl bg-card border border-border shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center gap-2 px-5 py-4 border-b border-border">
                            <PencilRuler size={18} className="text-red-500" />
                            <span className="font-bold">Calibrar líneas y zonas · {calibrateDev.name}</span>
                            <button onClick={() => setCalibrateDev(null)} className="ml-auto text-muted-foreground hover:text-foreground text-xl leading-none">×</button>
                        </div>
                        <div className="p-5 space-y-3">
                            <div className="relative rounded-lg overflow-hidden border border-border aspect-video bg-black">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={`/api/snapshot/${calibrateDev.id}?t=${Date.now()}`} alt="" className="absolute inset-0 w-full h-full object-cover" />
                            </div>
                            <p className="text-sm text-muted-foreground">
                                El editor para dibujar y ajustar la línea de cruce y las zonas de intrusión sobre el video se habilita en cámaras que soporten esas analíticas (AcuSense/DeepinView). Las cámaras ANPR actuales no las soportan.
                            </p>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
