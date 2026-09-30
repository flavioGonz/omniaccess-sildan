"use client";

import { useEffect, useMemo, useState } from "react";
import { io } from "socket.io-client";
import { getSocketUrl } from "@/lib/socket-config";
import { getIntrusionCameras, getRecentDetections, getDevicesWithAnalytics, getAnalyticsGeometryBatch, type DetItem, type IntrusionCam } from "@/app/actions/detections";
import { Radar, ShieldAlert, Activity, LogIn, LogOut, Camera, Circle, BellRing, Loader2, Check, PencilRuler, X, Server, Wifi, Search, RefreshCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { LineZoneCalibrator } from "@/components/LineZoneCalibrator";

type Geom = { line: { x: number; y: number }[]; field: { x: number; y: number }[] };

const META: Record<string, { label: string; cls: string; ring: string; dot: string; Icon: any }> = {
    LINECROSS: { label: "Cruce de línea", cls: "text-red-300 border-red-500/40 bg-red-500/10", ring: "ring-red-500", dot: "bg-red-500", Icon: Radar },
    INTRUSION: { label: "Intrusión", cls: "text-red-300 border-red-500/40 bg-red-500/10", ring: "ring-red-500", dot: "bg-red-500", Icon: ShieldAlert },
    REGION_ENTER: { label: "Entra a zona", cls: "text-amber-300 border-amber-500/40 bg-amber-500/10", ring: "ring-amber-500", dot: "bg-amber-500", Icon: LogIn },
    REGION_EXIT: { label: "Sale de zona", cls: "text-amber-300 border-amber-500/40 bg-amber-500/10", ring: "ring-amber-500", dot: "bg-amber-500", Icon: LogOut },
    MOTION: { label: "Movimiento", cls: "text-sky-300 border-sky-500/40 bg-sky-500/10", ring: "ring-sky-500", dot: "bg-sky-500", Icon: Activity },
    OTHER: { label: "Evento", cls: "text-slate-300 border-slate-500/40 bg-slate-500/10", ring: "ring-slate-500", dot: "bg-slate-500", Icon: Activity },
};

function ago(ts: string) {
    const s = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
    if (s < 60) return "hace " + s + "s";
    const m = Math.floor(s / 60); if (m < 60) return "hace " + m + "m";
    const h = Math.floor(m / 60); if (h < 24) return "hace " + h + "h";
    return new Date(ts).toLocaleDateString("es-UY", { day: "2-digit", month: "2-digit" });
}

function GeomOverlay({ geom }: { geom?: Geom }) {
    if (!geom || ((!geom.line || geom.line.length < 2) && (!geom.field || geom.field.length < 3))) return null;
    return (
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 w-full h-full pointer-events-none">
            {geom.field && geom.field.length >= 3 && (
                <polygon points={geom.field.map((p) => `${p.x},${p.y}`).join(" ")} fill="rgba(244,63,94,0.16)" stroke="#f43f5e" strokeWidth={1.4} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
            )}
            {geom.line && geom.line.length === 2 && (
                <line x1={geom.line[0].x} y1={geom.line[0].y} x2={geom.line[1].x} y2={geom.line[1].y} stroke="#38bdf8" strokeWidth={2} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
            )}
        </svg>
    );
}

function CamTile({ cam, flash, last, geom, hasAnalytics, onCalibrate, onAlarm }: {
    cam: IntrusionCam; flash: boolean; last?: DetItem; geom?: Geom; hasAnalytics: boolean;
    onCalibrate: (c: IntrusionCam) => void; onAlarm: (c: IntrusionCam) => void;
}) {
    const [rk, setRk] = useState(0);
    const [loaded, setLoaded] = useState(false);
    useEffect(() => { const iv = setInterval(() => setRk((x) => x + 1), 4000); return () => clearInterval(iv); }, []);
    const src = `/api/snapshot/${cam.id}?t=${rk}`;
    const m = last ? (META[last.type] || META.OTHER) : null;
    return (
        <div className={cn("relative rounded-2xl overflow-hidden aspect-video bg-neutral-900 group/tile transition-all duration-300",
            flash ? "ring-2 ring-red-500 shadow-[0_0_30px_rgba(239,68,68,0.65)]" : "ring-1 ring-white/[0.06] hover:ring-white/20")}>
            {!loaded && <div className="absolute inset-0 sk" />}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src} alt={cam.name} onLoad={() => setLoaded(true)}
                onError={(e) => { (e.currentTarget as HTMLImageElement).style.opacity = "0.12"; setLoaded(true); }}
                className={cn("absolute inset-0 w-full h-full object-cover transition-opacity duration-300", loaded ? "opacity-100" : "opacity-0")} />
            <GeomOverlay geom={geom} />

            {/* Top: nombre + NVR·canal + controles (sin marcos) */}
            <div className="absolute top-0 inset-x-0 px-2.5 pt-2 pb-6 bg-gradient-to-b from-black/75 via-black/30 to-transparent flex items-start gap-2">
                <div className="min-w-0 flex-1">
                    <div className="text-[11.5px] font-bold text-white leading-tight truncate drop-shadow">{cam.name}</div>
                    {(cam.nvrName || cam.ch) && (
                        <div className="flex items-center gap-1.5 mt-0.5">
                            {cam.nvrName && <span className="inline-flex items-center gap-1 text-[8.5px] font-bold uppercase tracking-wider text-white/70"><Server size={8} /> {cam.nvrName}</span>}
                            {cam.ch != null && <span className="text-[8.5px] font-bold text-white/55">CH {cam.ch}</span>}
                        </div>
                    )}
                </div>
                <div className="flex items-center gap-0.5 opacity-0 group-hover/tile:opacity-100 transition-opacity">
                    <button onClick={(e) => { e.stopPropagation(); onCalibrate(cam); }} title="Calibrar líneas y zonas"
                        className={cn("grid h-8 w-8 place-items-center rounded-full text-white/80 hover:text-white hover:bg-white/15 active:scale-90 transition-all", hasAnalytics && "text-emerald-400 hover:text-emerald-300")}>
                        <PencilRuler size={15} />
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); onAlarm(cam); }} title="Servidor de alarma"
                        className="grid h-8 w-8 place-items-center rounded-full text-white/80 hover:text-white hover:bg-white/15 active:scale-90 transition-all">
                        <BellRing size={15} />
                    </button>
                </div>
            </div>

            {/* Punto verde si tiene analíticas configuradas */}
            {hasAnalytics && !m && (
                <span className="absolute bottom-2 right-2 z-10 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-500/40">
                    <Radar size={9} className="text-emerald-400" /><span className="text-[8px] font-bold text-emerald-300 uppercase tracking-wide">Analítica</span>
                </span>
            )}

            {/* Badge de última detección */}
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

function AlarmDialog({ cam, onClose }: { cam: IntrusionCam; onClose: () => void }) {
    const [phase, setPhase] = useState<"loading" | "ready" | "applying" | "testing">("loading");
    const [hosts, setHosts] = useState<any[]>([]);
    const [hasOmni, setHasOmni] = useState(false);
    const [msg, setMsg] = useState("");
    const [test, setTest] = useState<{ ok: boolean; text: string } | null>(null);

    const load = () => {
        setPhase("loading"); setTest(null);
        fetch(`/api/devices/alarm-host?deviceId=${cam.id}`, { cache: "no-store" }).then((r) => r.json()).then((d) => {
            setHosts(Array.isArray(d.hosts) ? d.hosts : []); setHasOmni(!!d.hasOmni);
            if (!d.ok && d.error) setMsg(d.error);
            setPhase("ready");
        }).catch(() => { setMsg("No se pudo leer la configuración del equipo"); setPhase("ready"); });
    };
    useEffect(load, [cam.id]);

    const apply = async () => {
        setPhase("applying"); setMsg("");
        try {
            const d = await fetch(`/api/devices/alarm-host?deviceId=${cam.id}`, { method: "POST" }).then((r) => r.json());
            setMsg(d.ok ? (d.already ? "Ya estaba configurado ✓" : "Configurado en el equipo ✓") : (d.error || "No se pudo configurar"));
        } catch (e: any) { setMsg(e?.message || "Error"); }
        load();
    };
    const doTest = async () => {
        setPhase("testing"); setTest(null);
        try {
            const d = await fetch(`/api/devices/alarm-host?deviceId=${cam.id}&action=test`, { method: "POST" }).then((r) => r.json());
            if (d.ok) setTest({ ok: !!d.reporting, text: d.reporting ? "El equipo reporta OK a OmniAccess ✓" : "Test enviado; el equipo no confirmó explícitamente (revisá que lleguen eventos)." });
            else setTest({ ok: false, text: d.error || "El test falló" });
        } catch (e: any) { setTest({ ok: false, text: e?.message || "Error en el test" }); }
        setPhase("ready");
    };

    const EVENT_TARGET = "172.16.2.71:10000"; // informativo

    return (
        <div className="fixed inset-0 z-[2000] bg-black/80 backdrop-blur-sm flex items-center justify-center p-6" onClick={() => phase === "ready" || phase === "loading" ? onClose() : null}>
            <div className="w-full max-w-lg rounded-2xl bg-card border border-border shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center gap-2.5 px-5 py-4 border-b border-border bg-gradient-to-r from-red-500/[0.07] to-transparent">
                    <span className="w-8 h-8 rounded-xl bg-red-500/15 grid place-items-center"><BellRing size={16} className="text-red-500" /></span>
                    <div className="min-w-0">
                        <div className="font-bold leading-tight truncate">Servidor de alarma</div>
                        <div className="text-[11px] text-muted-foreground truncate">{cam.name}{cam.nvrName ? ` · ${cam.nvrName}` : ""}</div>
                    </div>
                    <button onClick={onClose} className="ml-auto w-8 h-8 grid place-items-center rounded-full hover:bg-accent text-muted-foreground"><X size={18} /></button>
                </div>

                <div className="p-5 space-y-4">
                    {phase === "loading" ? (
                        <div className="flex items-center gap-2 text-muted-foreground py-6 justify-center"><Loader2 size={16} className="animate-spin" /> Leyendo configuración del equipo…</div>
                    ) : (
                        <>
                            {/* Estado actual */}
                            <div className="rounded-xl border border-border bg-background/50 p-3.5">
                                <div className="flex items-center gap-2 mb-2">
                                    <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Servidores de alarma en el equipo</span>
                                    {hasOmni
                                        ? <span className="ml-auto inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"><Check size={11} /> OmniAccess presente</span>
                                        : <span className="ml-auto inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/15 text-amber-400 border border-amber-500/30"><ShieldAlert size={11} /> OmniAccess no configurado</span>}
                                </div>
                                {hosts.length === 0 ? (
                                    <p className="text-[12px] text-muted-foreground">El equipo no tiene servidores de alarma configurados.</p>
                                ) : (
                                    <div className="space-y-1">
                                        {hosts.map((h, i) => (
                                            <div key={i} className="flex items-center gap-2 text-[12px] font-mono">
                                                <span className="text-muted-foreground w-5">#{h.id}</span>
                                                <span className={cn("truncate", h.ip && h.ip !== "0.0.0.0" ? "text-foreground" : "text-muted-foreground/50")}>
                                                    {h.ip && h.ip !== "0.0.0.0" ? `${h.ip}:${h.port}${h.url || ""}` : "— libre —"}
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                                <p className="text-[10px] text-muted-foreground mt-2">Destino OmniAccess: <span className="font-mono">{EVENT_TARGET}</span></p>
                            </div>

                            {msg && <p className={cn("text-sm font-semibold", msg.includes("✓") ? "text-emerald-500" : "text-red-500")}>{msg}</p>}
                            {test && <p className={cn("text-sm font-semibold flex items-center gap-1.5", test.ok ? "text-emerald-500" : "text-amber-500")}><Wifi size={15} /> {test.text}</p>}

                            {/* Acciones */}
                            <div className="flex items-center gap-2">
                                {hasOmni ? (
                                    <>
                                        <button onClick={doTest} disabled={phase === "testing"} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-sm font-bold active:scale-95 transition-all disabled:opacity-60">
                                            {phase === "testing" ? <Loader2 size={15} className="animate-spin" /> : <Wifi size={15} />} Probar reporte
                                        </button>
                                        <button onClick={apply} disabled={phase === "applying"} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-border hover:bg-accent text-sm font-bold text-muted-foreground active:scale-95 transition-all">
                                            {phase === "applying" ? <Loader2 size={15} className="animate-spin" /> : <RefreshCcw size={14} />} Reescribir config
                                        </button>
                                    </>
                                ) : (
                                    <button onClick={apply} disabled={phase === "applying"} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-red-600 hover:bg-red-500 text-white text-sm font-bold active:scale-95 transition-all disabled:opacity-60">
                                        {phase === "applying" ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />} Configurar OmniAccess como alarma
                                    </button>
                                )}
                                <button onClick={onClose} className="ml-auto px-4 py-2.5 rounded-xl text-sm font-bold text-muted-foreground hover:bg-accent">Cerrar</button>
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}

export default function MonitorIntrusion() {
    const [cams, setCams] = useState<IntrusionCam[]>([]);
    const [loading, setLoading] = useState(true);
    const [analyticsIds, setAnalyticsIds] = useState<Set<string>>(new Set());
    const [geom, setGeom] = useState<Record<string, Geom>>({});
    const [dets, setDets] = useState<DetItem[]>([]);
    const [filter, setFilter] = useState<"ALL" | "ANALYTIC" | "MOTION">("ANALYTIC");
    const [flash, setFlash] = useState<Record<string, number>>({});
    const [q, setQ] = useState("");
    const [calibrateDev, setCalibrateDev] = useState<IntrusionCam | null>(null);
    const [alarmDev, setAlarmDev] = useState<IntrusionCam | null>(null);
    const [alert, setAlertItem] = useState<DetItem | null>(null);

    useEffect(() => {
        setLoading(true);
        Promise.all([getIntrusionCameras(), getDevicesWithAnalytics()])
            .then(([c, ids]) => {
                setCams(c || []);
                const set = new Set(ids || []);
                setAnalyticsIds(set);
                // geometría de las cámaras con analítica (para dibujarlas)
                const withA = (c || []).filter((x) => set.has(x.id)).map((x) => x.id);
                if (withA.length) getAnalyticsGeometryBatch(withA).then(setGeom).catch(() => { });
            })
            .catch(() => { })
            .finally(() => setLoading(false));
    }, []);

    useEffect(() => { getRecentDetections(60, filter !== "ANALYTIC").then(setDets).catch(() => { }); }, [filter]);

    useEffect(() => {
        let s: any;
        try {
            s = io(getSocketUrl(), { path: "/io/socket.io", transports: ["polling", "websocket"] });
            s.on("general_detection", (d: any) => {
                if (filter === "ANALYTIC" && d.type === "MOTION") return;
                const item: DetItem = { id: d.id, deviceId: d.deviceId, deviceName: d.deviceName, type: d.type, eventType: d.eventType, snapshotPath: null, timestamp: d.timestamp };
                setDets((prev) => [item, ...prev.filter((x) => x.id !== d.id)].slice(0, 60));
                if (d.deviceId) { setFlash((f) => ({ ...f, [d.deviceId]: Date.now() })); setTimeout(() => setFlash((f) => { const n = { ...f }; delete n[d.deviceId]; return n; }), 2200); }
                if (d.type !== "MOTION") { setAlertItem(item); setTimeout(() => setAlertItem((a) => (a && a.id === item.id ? null : a)), 8000); }
            });
        } catch { }
        return () => { try { s && s.disconnect(); } catch { } };
    }, [filter]);

    const lastByDev = useMemo(() => {
        const map: Record<string, DetItem> = {};
        for (const d of dets) { if (d.deviceId && !map[d.deviceId]) map[d.deviceId] = d; }
        return map;
    }, [dets]);

    const shown = useMemo(() => {
        const term = q.trim().toLowerCase();
        const score = (d: IntrusionCam) => {
            const last = lastByDev[d.id];
            const recent = last ? Date.now() - new Date(last.timestamp).getTime() : Infinity;
            if (recent < 60_000) return 3_000_000 - recent / 1000;
            if (analyticsIds.has(d.id)) return 1_000;
            return 0;
        };
        let list = [...cams];
        if (term) list = list.filter((c) => c.name.toLowerCase().includes(term) || (c.nvrName || "").toLowerCase().includes(term));
        return list.sort((a, b) => score(b) - score(a) || String(a.name).localeCompare(String(b.name)));
    }, [cams, analyticsIds, lastByDev, q]);

    const shownDets = filter === "MOTION" ? dets.filter((d) => d.type === "MOTION") : filter === "ANALYTIC" ? dets.filter((d) => d.type !== "MOTION") : dets;

    return (
        <div className="h-full flex flex-col">
            <style jsx global>{`
                .sk { background: #171717; position: relative; overflow: hidden; }
                .sk::after { content: ""; position: absolute; inset: 0; transform: translateX(-100%);
                    background: linear-gradient(90deg, transparent, rgba(255,255,255,0.06), transparent); animation: skshimmer 1.5s infinite; }
                @keyframes skshimmer { 100% { transform: translateX(100%); } }
            `}</style>

            {/* Header */}
            <div className="shrink-0 flex items-center justify-between gap-3 px-6 py-4 border-b border-border">
                <div className="flex items-center gap-3 min-w-0">
                    <span className="relative grid h-10 w-10 place-items-center rounded-xl bg-red-500/15 shrink-0"><Radar size={20} className="text-red-500" /></span>
                    <div className="min-w-0">
                        <h1 className="text-lg font-bold tracking-tight">Monitor de Intrusión</h1>
                        <p className="text-xs text-muted-foreground truncate">Cruce de línea, intrusión, zonas y movimiento · {cams.length} canales</p>
                    </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                    <div className="relative hidden md:block">
                        <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar canal…" className="h-8 w-40 pl-8 pr-2 rounded-lg bg-card border border-border text-xs focus:outline-none focus:ring-1 focus:ring-red-500/40" />
                    </div>
                    <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-emerald-400"><Circle size={8} className="fill-emerald-500 text-emerald-500 animate-pulse" /> En vivo</span>
                    <div className="inline-flex rounded-xl border border-border p-0.5 bg-card">
                        {(["ANALYTIC", "MOTION", "ALL"] as const).map((f) => (
                            <button key={f} onClick={() => setFilter(f)} className={cn("px-3 py-1.5 rounded-lg text-[11px] font-bold uppercase tracking-wide transition-colors", filter === f ? "bg-red-500/20 text-red-300" : "text-muted-foreground hover:text-foreground")}>
                                {f === "ANALYTIC" ? "Intrusión" : f === "MOTION" ? "Movimiento" : "Todo"}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {/* Body */}
            <div className="flex-1 grid grid-cols-[1fr_380px] divide-x divide-border overflow-hidden">
                {/* Wall */}
                <div className="overflow-y-auto custom-scrollbar p-5">
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

                    {loading ? (
                        <div className="grid grid-cols-2 xl:grid-cols-3 gap-4">
                            {Array.from({ length: 9 }).map((_, i) => <div key={i} className="sk rounded-2xl aspect-video" />)}
                        </div>
                    ) : shown.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
                            <Camera size={28} className="opacity-30" /><span className="text-sm">Sin canales</span>
                        </div>
                    ) : (
                        <div className="grid grid-cols-2 xl:grid-cols-3 gap-4">
                            {shown.map((cam) => (
                                <CamTile key={cam.id} cam={cam} flash={!!flash[cam.id]} last={lastByDev[cam.id]} geom={geom[cam.id]} hasAnalytics={analyticsIds.has(cam.id)}
                                    onCalibrate={setCalibrateDev} onAlarm={setAlarmDev} />
                            ))}
                        </div>
                    )}
                </div>

                {/* Sidebar detecciones */}
                <div className="flex flex-col overflow-hidden bg-card/30">
                    <div className="shrink-0 px-4 py-3.5 border-b border-border flex items-center gap-2">
                        <span className="grid h-7 w-7 place-items-center rounded-lg bg-red-500/15"><Activity size={14} className="text-red-500" /></span>
                        <span className="text-xs font-bold uppercase tracking-wider">Detecciones</span>
                        <span className="ml-auto px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-500/15 text-red-300 border border-red-500/30 tabular-nums">{shownDets.length}</span>
                    </div>
                    <div className="flex-1 overflow-y-auto custom-scrollbar p-2.5 space-y-2">
                        {shownDets.length === 0 ? (
                            <div className="flex flex-col items-center justify-center h-40 text-muted-foreground gap-2">
                                <ShieldAlert size={22} className="opacity-30" /><span className="text-[12px]">Sin detecciones recientes</span>
                            </div>
                        ) : shownDets.map((d) => {
                            const m = META[d.type] || META.OTHER;
                            return (
                                <div key={d.id} className={cn("flex items-center gap-3 pl-2.5 pr-3 py-2.5 rounded-xl border bg-card/60", m.cls)}>
                                    <span className={cn("grid h-9 w-9 place-items-center rounded-lg shrink-0", m.cls)}><m.Icon size={17} /></span>
                                    <div className="min-w-0 flex-1">
                                        <div className="text-[13px] font-bold leading-tight">{m.label}</div>
                                        <div className="text-[11px] text-white/55 truncate mt-0.5">{d.deviceName || "Cámara"}</div>
                                    </div>
                                    <span className="text-[10px] text-white/45 shrink-0 tabular-nums">{ago(d.timestamp)}</span>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>

            {calibrateDev && <LineZoneCalibrator device={calibrateDev} onClose={() => {
                const id = calibrateDev.id; setCalibrateDev(null);
                // refrescar geometría de esa cámara al cerrar
                getAnalyticsGeometryBatch([id]).then((g) => setGeom((prev) => ({ ...prev, ...g }))).catch(() => { });
                setAnalyticsIds((s) => new Set(s).add(id));
            }} />}
            {alarmDev && <AlarmDialog cam={alarmDev} onClose={() => setAlarmDev(null)} />}
        </div>
    );
}
