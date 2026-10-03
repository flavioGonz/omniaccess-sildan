"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";
import { getSocketUrl } from "@/lib/socket-config";
import { getIntrusionCameras, getRecentDetections, getDevicesWithAnalytics, getAnalyticsGeometryBatch, getDetectionHistory, getActiveAlarms, ackAlarms, getAttendingIds, setAttending, getVisualTrackLinks, setVisualTrackLinks, type TrackLink, type DetItem, type IntrusionCam, type DetHistItem } from "@/app/actions/detections";
import { Radar, ShieldAlert, Activity, LogIn, LogOut, Camera, Circle, BellRing, Loader2, Check, PencilRuler, X, Server, Wifi, Search, RefreshCcw, History, ImageOff, ChevronLeft, ChevronRight, FileText, Video, Film, MoreVertical, Clock, Download, ChevronUp, ChevronDown, ZoomIn, ZoomOut, Home, Gauge, Move, Joystick, Rewind, FastForward, Gauge as GaugeIco, Calendar as CalIco, Crosshair, Plus, Save, Pencil, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { LineZoneCalibrator } from "@/components/LineZoneCalibrator";
import { PtzControls, ptzAngleToDir } from "@/components/PtzControls";
import { PlaybackTimeline } from "@/components/PlaybackTimeline";
import { Scrub } from "@/components/Scrub";
import { motion, AnimatePresence } from "framer-motion";
import { Tooltip as RTooltip } from "react-tooltip";
import "react-tooltip/dist/react-tooltip.css";

type Geom = { line: { x: number; y: number }[]; field: { x: number; y: number }[] };
type AlarmChip = { id: string; type: string; label: string; ts: string };

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

function Tip({ label, children, side = "top" }: { label: string; children: any; side?: "top" | "bottom" }) {
    const [on, setOn] = useState(false);
    return (
        <span className="relative inline-flex" onMouseEnter={() => setOn(true)} onMouseLeave={() => setOn(false)} onFocus={() => setOn(true)} onBlur={() => setOn(false)}>
            {children}
            <AnimatePresence>
                {on && (
                    <motion.span initial={{ opacity: 0, y: side === "bottom" ? -4 : 4, scale: 0.9 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: side === "bottom" ? -4 : 4, scale: 0.9 }} transition={{ type: "spring", stiffness: 500, damping: 28 }}
                        className={cn("pointer-events-none absolute left-1/2 -translate-x-1/2 z-[70] whitespace-nowrap rounded-md bg-zinc-900 text-white text-[10.5px] font-semibold px-2 py-1 shadow-xl border border-white/10", side === "bottom" ? "top-full mt-1.5" : "bottom-full mb-1.5")}>
                        {label}
                        <span className={cn("absolute left-1/2 -translate-x-1/2 w-2 h-2 rotate-45 bg-zinc-900 border-white/10", side === "bottom" ? "-top-1 border-l border-t" : "-bottom-1 border-r border-b")} />
                    </motion.span>
                )}
            </AnimatePresence>
        </span>
    );
}

function GeomOverlay({ geom, alert }: { geom?: Geom; alert?: boolean }) {
    if (!geom || ((!geom.line || geom.line.length < 2) && (!geom.field || geom.field.length < 3))) return null;
    const lineC = alert ? "#f87171" : "#38bdf8";
    const zoneStroke = alert ? "#ef4444" : "#f43f5e";
    const zoneFill = alert ? "rgba(239,68,68,0.30)" : "rgba(244,63,94,0.16)";
    return (
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className={cn("absolute inset-0 w-full h-full pointer-events-none", alert && "animate-pulse")}>
            {alert && (
                <defs><filter id="detglow" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="1.1" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter></defs>
            )}
            {geom.field && geom.field.length >= 3 && (
                <polygon points={geom.field.map((p) => `${p.x},${p.y}`).join(" ")} fill={zoneFill} stroke={zoneStroke} strokeWidth={alert ? 2.2 : 1.4} strokeLinejoin="round" vectorEffect="non-scaling-stroke" filter={alert ? "url(#detglow)" : undefined} />
            )}
            {geom.line && geom.line.length === 2 && (
                <line x1={geom.line[0].x} y1={geom.line[0].y} x2={geom.line[1].x} y2={geom.line[1].y} stroke={lineC} strokeWidth={alert ? 3 : 2} strokeLinecap="round" vectorEffect="non-scaling-stroke" filter={alert ? "url(#detglow)" : undefined} />
            )}
        </svg>
    );
}

function Dots() {
    return (
        <span className="inline-flex ml-0.5">
            <span className="inline-block animate-bounce" style={{ animationDelay: "0ms" }}>.</span>
            <span className="inline-block animate-bounce" style={{ animationDelay: "150ms" }}>.</span>
            <span className="inline-block animate-bounce" style={{ animationDelay: "300ms" }}>.</span>
        </span>
    );
}

function CamTile({ cam, alarms, last, geom, hasAnalytics, alarmActive, attending, onCalibrate, onAlarm, onAck, onResolve, onFicha, onLive, onClip }: {
    cam: IntrusionCam; alarms?: AlarmChip[]; last?: DetItem; geom?: Geom; hasAnalytics: boolean; alarmActive?: boolean; attending?: boolean;
    onCalibrate: (c: IntrusionCam) => void; onAlarm: (c: IntrusionCam) => void; onAck: (c: IntrusionCam) => void; onResolve?: (id: string) => void;
    onFicha: (c: IntrusionCam) => void; onLive: (c: IntrusionCam) => void; onClip: (c: IntrusionCam) => void;
}) {
    const active = !!(alarms && alarms.length);
    const [rk, setRk] = useState(0);
    const [loaded, setLoaded] = useState(false);
    const [menu, setMenu] = useState(false);
    const boxRef = useRef<HTMLDivElement | null>(null);
    const visRef = useRef(false);
    useEffect(() => {
        const el = boxRef.current; if (!el) return;
        const iob = new IntersectionObserver((ents) => { visRef.current = ents[0]?.isIntersecting ?? false; }, { rootMargin: "200px" });
        iob.observe(el);
        // refrescar snapshot sólo cuando el tile está a la vista (alivia 79 canales)
        const iv = setInterval(() => { if (visRef.current) setRk((x) => x + 1); }, 4000);
        return () => { iob.disconnect(); clearInterval(iv); };
    }, []);
    const [, tick] = useState(0);
    useEffect(() => { if (!last) return; const iv = setInterval(() => tick((x) => x + 1), 1000); return () => clearInterval(iv); }, [last]);
    const src = `/api/snapshot/${cam.id}?t=${rk}`;
    const m = last ? (META[last.type] || META.OTHER) : null;
    const tc = m ? m.cls.split(" ")[0] : "text-white/60";
    const isPtzCam = /ptz/i.test(cam.name || "");
    return (
        <div ref={boxRef} onContextMenu={(e) => { e.preventDefault(); setMenu(true); }}
            className={cn("relative rounded-2xl overflow-hidden aspect-video bg-neutral-900 group/tile transition-all duration-300",
                active ? "ring-2 ring-red-500 shadow-[0_0_30px_rgba(239,68,68,0.65)]" : attending ? "" : "ring-1 ring-white/[0.06] hover:ring-white/25")}>
            {/* borde animado: evento REAL confirmado, en atención hasta resolver */}
            {attending && !active && <div className="absolute inset-0 z-40 rounded-2xl pointer-events-none ptl-attend" />}
            {attending && !active && (
                <div className="absolute top-2 left-1/2 -translate-x-1/2 z-[41] flex items-center gap-1.5">
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-600/90 text-white text-[9px] font-extrabold uppercase tracking-wide shadow-lg animate-pulse"><ShieldAlert size={10} /> En atención</span>
                    <button onClick={(e) => { e.stopPropagation(); onResolve?.(cam.id); }} data-tooltip-id="mi-tip" data-tooltip-content="Marcar evento como resuelto"
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-white text-emerald-700 text-[9px] font-extrabold uppercase tracking-wide shadow-lg hover:bg-emerald-50 active:scale-95"><Check size={10} /> Resolver</button>
                </div>
            )}
            {!loaded && <div className="absolute inset-0 sk" />}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src} alt={cam.name} loading="lazy" decoding="async" onLoad={() => setLoaded(true)}
                onError={(e) => { (e.currentTarget as HTMLImageElement).style.opacity = "0.12"; setLoaded(true); }}
                className={cn("absolute inset-0 w-full h-full object-cover transition-opacity duration-300", loaded ? "opacity-100" : "opacity-0")} />
            <GeomOverlay geom={geom} />

            {/* Overlay de alarma: eventos apilados sobre el canal (fijos hasta aceptar) */}
            {active && (
                <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-2 p-2 pointer-events-none">
                    <div className="absolute inset-0 bg-red-600/30 animate-pulse" />
                    <div className="absolute inset-0 ring-4 ring-inset ring-red-500/80 rounded-2xl animate-pulse" />
                    <div className="relative flex flex-col items-center gap-1 max-w-[94%]">
                        {alarms!.slice(0, 3).map((a, i) => (
                            <div key={a.id} className={cn("flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-red-600/95 border border-red-200/50 shadow-[0_0_18px_rgba(239,68,68,0.8)]", i === 0 && "animate-pulse")}>
                                <span className="text-white text-[10.5px] font-extrabold uppercase tracking-wide truncate">{a.label} detectada</span>
                                <span className="text-white/75 text-[9px] tabular-nums shrink-0">{ago(a.ts)}</span>
                            </div>
                        ))}
                        {alarms!.length > 3 && <span className="text-white/90 text-[9px] font-bold uppercase tracking-wide">+{alarms!.length - 3} evento(s) más</span>}
                    </div>
                </div>
            )}

            {/* Top: nombre + NVR·canal */}
            <div className="absolute top-0 inset-x-0 px-2.5 pt-2 pb-6 bg-gradient-to-b from-black/75 via-black/30 to-transparent">
                <div className="min-w-0 pr-24">
                    <div className="flex items-center gap-1.5">
                        {isPtzCam && <span data-tooltip-id="mi-tip" data-tooltip-content="PTZ controlable por el sistema" className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md bg-red-500/25 ring-1 ring-red-400/40 text-red-200 text-[7.5px] font-extrabold uppercase tracking-wide shrink-0"><Joystick size={9} /> PTZ</span>}
                        <div className="text-[11.5px] font-bold text-white leading-tight truncate drop-shadow">{cam.name}</div>
                    </div>
                    {(cam.nvrName || cam.ch) && (
                        <div className="flex items-center gap-1.5 mt-0.5">
                            {cam.nvrName && <span className="inline-flex items-center gap-1 text-[8.5px] font-bold uppercase tracking-wider text-white/70"><Server size={8} /> {cam.nvrName}</span>}
                            {cam.ch != null && <span className="text-[8.5px] font-bold text-white/55">CH {cam.ch}</span>}
                        </div>
                    )}
                </div>
            </div>

            {/* Controles overlay (z-40: por ENCIMA del overlay de alarma, siempre clickables) */}
            <div className="absolute inset-0 z-40 opacity-0 group-hover/tile:opacity-100 transition-opacity pointer-events-none">
                <div className="absolute top-2 right-2 flex items-center gap-1 pointer-events-auto">
                    <button data-tooltip-id="mi-tip" data-tooltip-content="Calibrar líneas y zonas" onClick={(e) => { e.stopPropagation(); onCalibrate(cam); }}
                        className={cn("grid h-8 w-8 place-items-center rounded-full bg-black/45 backdrop-blur-sm text-white/85 hover:text-white hover:bg-white/20 active:scale-90 transition-all ring-1 ring-white/10", hasAnalytics && "text-emerald-400 hover:text-emerald-300")}><PencilRuler size={15} /></button>
                    <button data-tooltip-id="mi-tip" data-tooltip-content={alarmActive ? "Servidor de alarma activo (recibiendo OK)" : "Servidor de alarma"} onClick={(e) => { e.stopPropagation(); onAlarm(cam); }}
                        className={cn("grid h-8 w-8 place-items-center rounded-full bg-black/45 backdrop-blur-sm hover:text-white hover:bg-white/20 active:scale-90 transition-all ring-1 ring-white/10", alarmActive ? "text-emerald-400 ring-emerald-400/40" : "text-white/85")}><BellRing size={15} /></button>
                    <button data-tooltip-id="mi-tip" data-tooltip-content="Más opciones" onClick={(e) => { e.stopPropagation(); setMenu((v) => !v); }}
                        className={cn("grid h-8 w-8 place-items-center rounded-full bg-black/45 backdrop-blur-sm text-white/85 hover:text-white hover:bg-white/20 active:scale-90 transition-all ring-1 ring-white/10", menu && "bg-white/20 text-white")}><MoreVertical size={15} /></button>
                </div>
                <div className="absolute inset-0 grid place-items-center">
                    <div className="flex items-center gap-2.5 pointer-events-auto">
                        <button data-tooltip-id="mi-tip" data-tooltip-content="Ver en vivo (incluye grabación y evidencia)" onClick={(e) => { e.stopPropagation(); onLive(cam); }}
                            className="h-12 w-12 grid place-items-center rounded-full bg-red-600/90 backdrop-blur-md text-white hover:bg-red-500 active:scale-90 transition-all ring-1 ring-red-300/30 shadow-lg"><Video size={20} /></button>
                    </div>
                </div>
                {active && (
                    <div className="absolute bottom-10 inset-x-0 grid place-items-center pointer-events-auto">
                        <button onClick={(e) => { e.stopPropagation(); onAck(cam); }}
                            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-white text-red-700 text-[11px] font-extrabold uppercase tracking-wide shadow-xl hover:bg-red-50 active:scale-95">
                            <Check size={14} /> Aceptar {alarms!.length > 1 ? `${alarms!.length} alarmas` : "alarma"}
                        </button>
                    </div>
                )}
            </div>

            {/* Menú contextual del canal (adicional a los iconos) */}
            {menu && (
                <>
                    <div className="fixed inset-0 z-[45]" onClick={(e) => { e.stopPropagation(); setMenu(false); }} />
                    <div className="absolute z-50 top-11 right-2 w-44 rounded-xl bg-neutral-900/97 backdrop-blur-md ring-1 ring-white/10 shadow-2xl overflow-hidden py-1" onClick={(e) => e.stopPropagation()}>
                        {([
                            { Icon: Video, label: "Video en vivo", fn: () => onLive(cam), hl: false },
                            { Icon: Film, label: "Grabaciones", fn: () => onClip(cam), hl: false },
                            { Icon: FileText, label: "Eventos", fn: () => onFicha(cam), hl: false },
                            { Icon: PencilRuler, label: "Calibrar", fn: () => onCalibrate(cam), hl: hasAnalytics },
                            { Icon: BellRing, label: "Alertas", fn: () => onAlarm(cam), hl: false },
                        ] as const).map(({ Icon, label, fn, hl }) => (
                            <button key={label} onClick={() => { setMenu(false); fn(); }}
                                className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-[12px] font-semibold text-white/85 hover:bg-white/10 transition-colors">
                                <Icon size={14} className={cn("shrink-0", hl ? "text-emerald-400" : "text-white/60")} /> {label}
                            </button>
                        ))}
                    </div>
                </>
            )}

            {/* Analítica (texto con iconografía, sin chip) */}
            {hasAnalytics && !m && (
                <span className="absolute bottom-8 right-2.5 z-10 inline-flex items-center gap-1 text-emerald-400 drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]">
                    <Radar size={10} /><span className="text-[8.5px] font-bold uppercase tracking-wide">Analítica</span>
                </span>
            )}

            {/* Info inferior: tipo de última detección + contador live (texto, sin chip) */}
            <div className="absolute bottom-2 left-2.5 right-2.5 z-10 flex items-center gap-1.5 pointer-events-none">
                {m ? <m.Icon size={13} className={cn("shrink-0 drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]", tc)} /> : <Clock size={12} className="shrink-0 text-white/55 drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]" />}
                <span className={cn("text-[11px] font-extrabold truncate drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]", tc)}>{m ? m.label : "Sin detecciones"}</span>
                {m && <span className="ml-auto inline-flex items-center gap-1 text-[10px] font-bold tabular-nums text-white/90 drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]"><Clock size={9} className="opacity-70" />{ago(last!.timestamp)}</span>}
            </div>
        </div>
    );
}

function AlarmDialog({ cam, onClose, onStatus }: { cam: IntrusionCam; onClose: () => void; onStatus?: (camId: string, ok: boolean) => void }) {
    const [phase, setPhase] = useState<"loading" | "ready" | "applying" | "testing">("loading");
    const [hosts, setHosts] = useState<any[]>([]);
    const [hasOmni, setHasOmni] = useState(false);
    const [msg, setMsg] = useState("");
    const [test, setTest] = useState<{ ok: boolean; text: string } | null>(null);
    const [dahua, setDahua] = useState(false);
    const [nvr, setNvr] = useState<{ ip: string; name: string; reachable: boolean } | null>(null);
    const [info, setInfo] = useState("");

    const load = () => {
        setPhase("loading"); setTest(null);
        fetch(`/api/devices/alarm-host?deviceId=${cam.id}`, { cache: "no-store" }).then((r) => r.json()).then((d) => {
            setHosts(Array.isArray(d.hosts) ? d.hosts : []); setHasOmni(!!d.hasOmni);
            setDahua(!!d.dahua); setNvr(d.nvr || null); setInfo(d.info || "");
            if (!d.ok && d.error) setMsg(d.error); else setMsg("");
            onStatus?.(cam.id, !!d.hasOmni);
            setPhase("ready");
        }).catch(() => { setMsg("No se pudo leer la configuración del equipo"); setPhase("ready"); });
    };
    useEffect(load, [cam.id]);

    const apply = async () => {
        setPhase("applying"); setMsg("");
        try {
            const d = await fetch(`/api/devices/alarm-host?deviceId=${cam.id}`, { method: "POST" }).then((r) => r.json());
            setMsg(d.ok ? (d.already ? "Ya estaba configurado ✓" : "Configurado en el equipo ✓") : (d.error || "No se pudo configurar"));
            if (d.ok) onStatus?.(cam.id, true);
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
                            {dahua ? (
                                /* ── DAHUA: suscripción por eventManager (pull), no hay push por equipo ── */
                                <>
                                    <div className="rounded-xl border border-border bg-background/50 p-3.5">
                                        <div className="flex items-center gap-2 mb-2">
                                            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Recepción de eventos (Dahua)</span>
                                            {nvr?.reachable
                                                ? <span className="ml-auto inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"><Check size={11} /> Suscripción activa</span>
                                                : <span className="ml-auto inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-500/15 text-red-400 border border-red-500/30"><ShieldAlert size={11} /> NVR no accesible</span>}
                                        </div>
                                        <p className="text-[12px] text-muted-foreground">{info || "OmniAccess recibe los eventos de este NVR Dahua por suscripción directa (eventManager). No requiere configurar un servidor de alarma en el equipo."}</p>
                                        {nvr && <p className="text-[11px] text-muted-foreground mt-2 flex items-center gap-1.5"><Server size={12} /> NVR: <span className="font-mono">{nvr.name} · {nvr.ip}</span></p>}
                                        <p className="text-[10px] text-muted-foreground mt-1">Ingesta OmniAccess: <span className="font-mono">eventManager.cgi (pull)</span></p>
                                    </div>

                                    {msg && !nvr?.reachable && <p className="text-sm font-semibold text-red-500">{msg}</p>}
                                    {test && <p className={cn("text-sm font-semibold flex items-center gap-1.5", test.ok ? "text-emerald-500" : "text-amber-500")}><Wifi size={15} /> {test.text}</p>}

                                    <div className="flex items-center gap-2">
                                        <button onClick={doTest} disabled={phase === "testing"} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-sm font-bold active:scale-95 transition-all disabled:opacity-60">
                                            {phase === "testing" ? <Loader2 size={15} className="animate-spin" /> : <Wifi size={15} />} Verificar suscripción
                                        </button>
                                        <button onClick={onClose} className="ml-auto px-4 py-2.5 rounded-xl text-sm font-bold text-muted-foreground hover:bg-accent">Cerrar</button>
                                    </div>
                                </>
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
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}

function DetThumb({ d, fill }: { d: DetItem | DetHistItem; fill?: boolean }) {
    const [ok, setOk] = useState(true);
    const [loaded, setLoaded] = useState(false);
    const src = (d as any).snapshotPath ? (d as any).snapshotPath : (d.deviceId ? `/api/snapshot/${d.deviceId}?t=${d.id}` : null);
    useEffect(() => { setOk(true); setLoaded(false); }, [src]);
    const img = (
        <>
            {!loaded && ok && src && <div className="absolute inset-0 sk" />}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {src && ok ? <img src={src} alt="" loading="lazy" decoding="async" onLoad={() => setLoaded(true)}
                className={cn("absolute inset-0 w-full h-full object-cover transition-opacity duration-300", loaded ? "opacity-100" : "opacity-0")} onError={() => setOk(false)} />
                : <div className="absolute inset-0 grid place-items-center text-white/20"><Camera size={18} /></div>}
        </>
    );
    if (fill) return img;
    return <div className="relative w-16 h-11 rounded-lg overflow-hidden bg-black shrink-0 ring-1 ring-white/10">{img}</div>;
}

function Field({ label, value }: { label: string; value: string }) {
    return <div className="min-w-0"><div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{label}</div><div className="text-sm font-semibold text-foreground truncate">{value}</div></div>;
}

function InfoChip({ Icon, children, mono }: { Icon?: any; children: React.ReactNode; mono?: boolean }) {
    return (
        <span className={cn("inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-black/45 backdrop-blur-md ring-1 ring-white/10 text-white/85 text-[11px] font-semibold", mono && "font-mono text-[10px] select-all")}>
            {Icon && <Icon size={12} className="shrink-0 text-white/55" />}{children}
        </span>
    );
}

function AlarmAckModal({ cam, alarms, onResolve, onClose }: { cam: IntrusionCam; alarms: AlarmChip[]; onResolve: (kind: "real" | "false") => void; onClose: () => void }) {
    const [left, setLeft] = useState(20);
    useEffect(() => { const iv = setInterval(() => setLeft((l) => l - 1), 1000); return () => clearInterval(iv); }, []);
    useEffect(() => { if (left <= 0) onResolve("real"); }, [left]); // eslint-disable-line react-hooks/exhaustive-deps
    const first = alarms[0]; const m = first ? (META[first.type] || META.OTHER) : META.OTHER;
    const snap = `/api/snapshot/${cam.id}?t=${Date.now()}`;
    return (
        <div className="fixed inset-0 z-[2300] bg-black/90 backdrop-blur-sm flex items-center justify-center p-4 sm:p-8" onClick={onClose}>
            {/* ventana grande, sin bordes, controles overlay sobre la captura */}
            <div className="relative w-full max-w-6xl max-h-[85vh] aspect-video rounded-2xl overflow-hidden bg-black shadow-2xl" onClick={(e) => e.stopPropagation()}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={snap} alt="" className="absolute inset-0 w-full h-full object-contain" />
                <div className="absolute inset-0 pointer-events-none ring-4 ring-inset ring-red-500/70 rounded-2xl animate-pulse" />
                <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/10 to-black/55 pointer-events-none" />

                {/* top: título + cerrar (overlay) */}
                <div className="absolute top-0 inset-x-0 p-4 flex items-start gap-3 z-10">
                    <span className="w-10 h-10 rounded-xl bg-red-500/25 grid place-items-center ring-1 ring-red-400/40 backdrop-blur-sm shrink-0"><ShieldAlert size={20} className="text-red-300" /></span>
                    <div className="min-w-0">
                        <div className="text-lg font-extrabold text-white leading-tight drop-shadow">Confirmar alarma</div>
                        <div className="text-[12px] text-white/70 truncate drop-shadow">{cam.name}{cam.nvrName ? ` · ${cam.nvrName}` : ""}{cam.ch != null ? ` · CH ${cam.ch}` : ""}</div>
                    </div>
                    <button onClick={onClose} className="ml-auto w-10 h-10 grid place-items-center rounded-full bg-black/40 hover:bg-black/70 text-white/80 hover:text-white backdrop-blur-sm shrink-0"><X size={20} /></button>
                </div>

                {/* chips de eventos (overlay) */}
                <div className="absolute top-20 left-4 z-10 flex flex-col gap-1.5 max-w-[60%]">
                    {alarms.slice(0, 5).map((al) => { const mm = META[al.type] || META.OTHER; return (
                        <span key={al.id} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-black/55 backdrop-blur-md ring-1 ring-white/10 text-[11px] font-extrabold uppercase tracking-wide text-red-200 w-fit"><mm.Icon size={12} /> {mm.label} · hace {ago(al.ts)}</span>
                    ); })}
                </div>

                {/* bottom: mensaje + acciones (overlay, sin bordes) */}
                <div className="absolute bottom-0 inset-x-0 p-5 z-10 flex items-end gap-4">
                    <div className="min-w-0">
                        <p className="text-[13px] text-white/85 leading-snug drop-shadow max-w-xl">Se detectó <span className="font-bold text-white">{m.label.toLowerCase()}</span> en <span className="font-bold text-white">{cam.name}</span>{alarms.length > 1 ? ` · ${alarms.length} eventos` : ""}.</p>
                        <p className="text-[10.5px] text-white/45 font-mono mt-1">Se confirma como real automáticamente en {Math.max(0, left)} s</p>
                    </div>
                    <div className="ml-auto flex items-center gap-2.5 shrink-0">
                        <button onClick={() => onResolve("false")} className="inline-flex items-center gap-1.5 px-5 py-3 rounded-2xl bg-white/10 hover:bg-white/20 backdrop-blur-md text-amber-300 text-[13px] font-extrabold ring-1 ring-white/10 active:scale-95 transition"><X size={16} /> Falsa alarma</button>
                        <button onClick={() => onResolve("real")} className="inline-flex items-center gap-2 px-6 py-3 rounded-2xl bg-red-600 hover:bg-red-500 text-white text-[14px] font-extrabold shadow-xl shadow-red-900/40 active:scale-95 transition"><Check size={18} /> Confirmar real</button>
                    </div>
                </div>
            </div>
        </div>
    );
}

function DetailDialog({ det, cam, geom, onClose, onResolveAlarm, hasAlarm }: { det: any; cam?: IntrusionCam; geom?: Geom; onClose: () => void; onResolveAlarm?: (deviceId: string, kind: "real" | "false") => void; hasAlarm?: boolean }) {
    const [cur, setCur] = useState<any>(det);
    const [sibs, setSibs] = useState<DetHistItem[]>([]);
    useEffect(() => { setCur(det); }, [det]);
    useEffect(() => { if (!det.deviceId) { setSibs([]); return; } getDetectionHistory({ deviceId: det.deviceId, pageSize: 60 }).then((r) => setSibs(r.items)).catch(() => setSibs([])); }, [det.deviceId]);
    const idx = sibs.findIndex((x) => x.id === cur.id);
    const go = (d: number) => { if (idx < 0) return; const n = idx + d; if (n >= 0 && n < sibs.length) setCur(sibs[n]); };
    const m = META[cur.type] || META.OTHER;
    const [rk] = useState(Date.now());
    const nvr = cur.nvrName || cam?.nvrName; const ch = cur.ch ?? cam?.ch;
    const snap = cur.snapshotPath ? cur.snapshotPath : (cur.deviceId ? `/api/snapshot/${cur.deviceId}?t=${rk}_${cur.id}` : null);
    const fecha = new Date(cur.timestamp).toLocaleString("es-UY", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    const hasGeom = !!(geom && ((geom.line && geom.line.length === 2) || (geom.field && geom.field.length >= 3)));
    const hasPrev = idx >= 0 && idx < sibs.length - 1; // más viejo
    const hasNext = idx > 0;                            // más nuevo
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            const t = e.target as HTMLElement | null;
            if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
            if (e.key === "ArrowLeft") { e.preventDefault(); go(1); }
            else if (e.key === "ArrowRight") { e.preventDefault(); go(-1); }
            else if (e.key === "Escape") { e.preventDefault(); onClose(); }
            else if (hasAlarm && cur.deviceId && onResolveAlarm) {
                const k = e.key.toLowerCase();
                if (k === "a" || e.key === "Enter") { e.preventDefault(); onResolveAlarm(cur.deviceId, "real"); }
                else if (k === "f" || k === "r") { e.preventDefault(); onResolveAlarm(cur.deviceId, "false"); }
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [cur, idx, sibs, hasAlarm, onResolveAlarm, onClose]);
    return (
        <div className="fixed inset-0 z-[2100] bg-black/90 backdrop-blur-sm flex items-center justify-center p-4 sm:p-10" onClick={onClose}>
            {/* flechas AFUERA del modal, para pasar eventos del canal */}
            {hasPrev && <button onClick={(e) => { e.stopPropagation(); go(1); }} data-tooltip-id="mi-tip" data-tooltip-content="Evento anterior (más viejo)"
                className="absolute left-2 sm:left-8 top-1/2 -translate-y-1/2 z-[5] w-12 h-12 grid place-items-center rounded-full bg-white/10 hover:bg-white/20 text-white ring-1 ring-white/10 backdrop-blur-md transition active:scale-90"><ChevronLeft size={24} /></button>}
            {hasNext && <button onClick={(e) => { e.stopPropagation(); go(-1); }} data-tooltip-id="mi-tip" data-tooltip-content="Evento siguiente (más nuevo)"
                className="absolute right-2 sm:right-8 top-1/2 -translate-y-1/2 z-[5] w-12 h-12 grid place-items-center rounded-full bg-white/10 hover:bg-white/20 text-white ring-1 ring-white/10 backdrop-blur-md transition active:scale-90"><ChevronRight size={24} /></button>}
            {/* cerrar AFUERA del modal, arriba a la derecha */}
            <button onClick={(e) => { e.stopPropagation(); onClose(); }} data-tooltip-id="mi-tip" data-tooltip-content="Cerrar"
                className="absolute right-3 top-3 sm:right-6 sm:top-6 z-[6] w-11 h-11 grid place-items-center rounded-full bg-white/10 hover:bg-white/25 text-white ring-1 ring-white/15 backdrop-blur-md transition active:scale-90"><X size={22} /></button>
            <div className="relative w-full max-w-6xl aspect-video rounded-2xl overflow-hidden bg-black shadow-2xl" onClick={(e) => e.stopPropagation()}>
                <div className="absolute bottom-2 left-1/2 -translate-x-1/2 z-[7] flex items-center gap-2.5 px-3 py-1.5 rounded-full bg-black/65 backdrop-blur-md ring-1 ring-white/10 text-[10px] font-bold text-white/70 pointer-events-none">
                    <span className="inline-flex items-center gap-1"><kbd className="px-1 rounded bg-white/15">←</kbd><kbd className="px-1 rounded bg-white/15">→</kbd> eventos</span>
                    {hasAlarm && cur.deviceId && onResolveAlarm && (<><span className="inline-flex items-center gap-1"><kbd className="px-1 rounded bg-red-500/40 text-red-100">A</kbd> aceptar</span><span className="inline-flex items-center gap-1"><kbd className="px-1 rounded bg-amber-500/40 text-amber-100">F</kbd> falsa</span></>)}
                    <span className="inline-flex items-center gap-1"><kbd className="px-1 rounded bg-white/15">Esc</kbd> cerrar</span>
                </div>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {snap ? <img src={snap} alt="" className="absolute inset-0 w-full h-full object-cover" /> : <div className="absolute inset-0 grid place-items-center text-white/30"><ImageOff size={32} /></div>}
                <GeomOverlay geom={geom} alert />
                {hasGeom && (
                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none">
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-red-600/90 ring-1 ring-red-200/40 shadow-[0_0_20px_rgba(239,68,68,0.8)] text-white text-[10px] font-extrabold uppercase tracking-wide animate-pulse"><m.Icon size={11} /> Detección en esta área</span>
                    </div>
                )}
                <div className="absolute top-0 inset-x-0 p-4 pr-16 flex items-start gap-3 bg-gradient-to-b from-black/75 to-transparent">
                    <span className={cn("grid h-11 w-11 place-items-center rounded-xl backdrop-blur-md ring-1 ring-white/10 shrink-0", m.cls)}><m.Icon size={21} /></span>
                    <div className="min-w-0">
                        <div className="text-lg font-extrabold text-white leading-tight truncate drop-shadow">{m.label}</div>
                        <div className="text-[12px] text-white/65 truncate">{cur.deviceName || cam?.name || "Cámara"}</div>
                    </div>
                    {idx >= 0 && sibs.length > 1 && <span className="ml-auto mt-1 text-[11px] font-bold text-white/60 tabular-nums self-start">{idx + 1} / {sibs.length}</span>}
                </div>
                <div className="absolute bottom-0 inset-x-0 p-4 pt-14 flex items-end justify-between gap-4 bg-gradient-to-t from-black/90 via-black/35 to-transparent">
                    {/* Resolver alarma desde la MISMA ficha del sidebar */}
                    {hasAlarm && cur.deviceId && onResolveAlarm ? (
                        <div className="flex items-center gap-2">
                            <button onClick={(e) => { e.stopPropagation(); onResolveAlarm(cur.deviceId, "false"); }}
                                className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-amber-300 text-[13px] font-extrabold ring-1 ring-white/10 active:scale-95 transition"><X size={16} /> Falsa alarma <kbd className="ml-1 px-1 rounded bg-black/30 text-[10px]">F</kbd></button>
                            <button onClick={(e) => { e.stopPropagation(); onResolveAlarm(cur.deviceId, "real"); }}
                                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-red-600 hover:bg-red-500 text-white text-[13px] font-extrabold shadow-xl active:scale-95 transition"><Check size={16} /> Confirmar real <kbd className="ml-1 px-1 rounded bg-black/25 text-[10px]">A</kbd></button>
                        </div>
                    ) : <span />}
                    {/* datos apilados a la derecha, sin chips */}
                    <div className="flex flex-col items-end gap-0.5 text-right drop-shadow-[0_1px_3px_rgba(0,0,0,0.95)]">
                        <span className="inline-flex items-center gap-1.5 text-[13px] font-extrabold text-white"><Server size={12} className="text-white/55" />{nvr || "—"}{ch != null ? ` · CH ${ch}` : ""}</span>
                        <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-white/85"><Clock size={11} className="text-white/45" />{fecha}</span>
                        <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-white/60"><Activity size={11} className="text-white/40" />hace {ago(cur.timestamp)}</span>
                        {cur.eventType && <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-white/55"><Radar size={11} className="text-white/40" />{cur.eventType}</span>}
                        <span className="text-[9.5px] font-mono text-white/35 select-all">{cur.id}</span>
                    </div>
                </div>
            </div>
        </div>
    );
}

function EvidenceGallery({ cams, onClose, onOpen }: { cams: IntrusionCam[]; onClose: () => void; onOpen: (d: DetHistItem) => void }) {
    const [items, setItems] = useState<DetHistItem[]>([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(0);
    const [type, setType] = useState<"ANALYTIC" | "ALL" | "MOTION" | "INTRUSION" | "LINECROSS">("ANALYTIC");
    const [dev, setDev] = useState<string>("");
    const [q, setQ] = useState("");
    const [loading, setLoading] = useState(true);
    const [more, setMore] = useState(true);
    const [from, setFrom] = useState("");
    const [to, setTo] = useState("");
    const [ack, setAck] = useState<"all" | "pending" | "done">("all");
    const size = 48;
    useEffect(() => { setPage(0); setItems([]); setMore(true); }, [type, dev, from, to, ack]);
    useEffect(() => {
        let on = true; setLoading(true);
        getDetectionHistory({ page, pageSize: size, type, deviceId: dev || undefined, from: from || undefined, to: to || undefined, ack }).then((r) => {
            if (!on) return;
            setTotal(r.total);
            setItems((prev) => (page === 0 ? r.items : [...prev, ...r.items]));
            setMore((page + 1) * size < r.total);
        }).catch(() => { }).finally(() => { if (on) setLoading(false); });
        return () => { on = false; };
    }, [page, type, dev, from, to, ack]);
    const onScroll = (e: React.UIEvent<HTMLDivElement>) => { const el = e.currentTarget; if (!loading && more && el.scrollTop + el.clientHeight >= el.scrollHeight - 400) setPage((p) => p + 1); };
    const shown = q.trim() ? items.filter((d) => (d.deviceName || "").toLowerCase().includes(q.trim().toLowerCase()) || (d.nvrName || "").toLowerCase().includes(q.trim().toLowerCase())) : items;
    const TF = [
        { k: "ANALYTIC", label: "Intrusión+" }, { k: "INTRUSION", label: "Intrusión" }, { k: "LINECROSS", label: "Línea" }, { k: "MOTION", label: "Movimiento" }, { k: "ALL", label: "Todo" },
    ] as const;
    return (
        <div className="fixed inset-0 z-[2090] bg-neutral-950/95 backdrop-blur-sm flex" onClick={onClose}>
            <div className="w-64 shrink-0 h-full bg-neutral-900/80 border-r border-white/10 flex flex-col" onClick={(e) => e.stopPropagation()}>
                <div className="px-4 py-4 flex items-center gap-2 border-b border-white/10">
                    <span className="grid h-8 w-8 place-items-center rounded-lg bg-red-500/15"><Camera size={16} className="text-red-400" /></span>
                    <span className="text-sm font-bold text-white">Evidencia</span>
                </div>
                <div className="p-3 space-y-4 overflow-y-auto custom-scrollbar">
                    <div className="relative">
                        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-white/40" />
                        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar cámara…" className="w-full h-9 pl-8 pr-2 rounded-lg bg-white/5 ring-1 ring-white/10 text-[13px] text-white placeholder:text-white/35 focus:outline-none focus:ring-white/25" />
                    </div>
                    <div>
                        <div className="text-[10px] font-bold uppercase tracking-widest text-white/40 mb-1.5">Tipo de evento</div>
                        <div className="flex flex-col gap-1">
                            {TF.map((f) => (
                                <button key={f.k} onClick={() => setType(f.k)} className={cn("text-left px-2.5 py-1.5 rounded-lg text-[12px] font-bold transition-colors", type === f.k ? "bg-red-500/20 text-red-300" : "text-white/60 hover:text-white hover:bg-white/5")}>{f.label}</button>
                            ))}
                        </div>
                    </div>
                    <div>
                        <div className="text-[10px] font-bold uppercase tracking-widest text-white/40 mb-1.5">Cámara</div>
                        <select value={dev} onChange={(e) => setDev(e.target.value)} className="w-full h-9 px-2 rounded-lg bg-white/5 ring-1 ring-white/10 text-[13px] text-white focus:outline-none [color-scheme:dark]">
                            <option value="">Todas</option>
                            {cams.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                    </div>
                    <div>
                        <div className="text-[10px] font-bold uppercase tracking-widest text-white/40 mb-1.5">Estado</div>
                        <div className="flex gap-1">
                            {([["all", "Todas"], ["pending", "Pendientes"], ["done", "Revisadas"]] as const).map(([k, lbl]) => (
                                <button key={k} onClick={() => setAck(k)} className={cn("flex-1 px-1.5 py-1.5 rounded-lg text-[11px] font-bold transition-colors", ack === k ? "bg-red-500/20 text-red-300" : "text-white/55 hover:text-white hover:bg-white/5")}>{lbl}</button>
                            ))}
                        </div>
                    </div>
                    <div>
                        <div className="text-[10px] font-bold uppercase tracking-widest text-white/40 mb-1.5">Rango de fechas</div>
                        <div className="space-y-1.5">
                            <input type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} className="w-full h-9 px-2 rounded-lg bg-white/5 ring-1 ring-white/10 text-[12px] text-white focus:outline-none [color-scheme:dark]" />
                            <input type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} className="w-full h-9 px-2 rounded-lg bg-white/5 ring-1 ring-white/10 text-[12px] text-white focus:outline-none [color-scheme:dark]" />
                            {(from || to) && <button onClick={() => { setFrom(""); setTo(""); }} className="text-[11px] font-bold text-white/50 hover:text-white">Limpiar fechas</button>}
                        </div>
                    </div>
                </div>
                <div className="mt-auto px-4 py-3 border-t border-white/10 text-[11px] text-white/45">{total} eventos</div>
            </div>
            <div className="flex-1 h-full flex flex-col" onClick={(e) => e.stopPropagation()}>
                <div className="px-5 py-3.5 flex items-center gap-3 border-b border-white/10">
                    <span className="text-sm font-bold text-white">Evidencia · {shown.length}{(q || dev) ? ` de ${total}` : ""}</span>
                    {loading && <Loader2 size={15} className="animate-spin text-white/50" />}
                    <button onClick={onClose} className="ml-auto w-9 h-9 grid place-items-center rounded-full bg-white/5 hover:bg-white/15 text-white/70 hover:text-white transition"><X size={18} /></button>
                </div>
                <div className="flex-1 overflow-y-auto custom-scrollbar p-4" onScroll={onScroll}>
                    {shown.length === 0 && !loading ? (
                        <div className="h-full grid place-items-center text-white/40 text-sm">Sin evidencia para este filtro.</div>
                    ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-3">
                            {shown.map((d) => {
                                const m = META[d.type] || META.OTHER;
                                const href = d.snapshotPath || (d.deviceId ? `/api/snapshot/${d.deviceId}?t=${d.id}` : null);
                                const when = new Date(d.timestamp).toLocaleString("es-UY", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
                                return (
                                    <button key={d.id} onClick={() => onOpen(d)} className="group relative aspect-video rounded-2xl overflow-hidden ring-1 ring-white/10 hover:ring-2 hover:ring-red-400/60 hover:z-10 hover:scale-[1.02] transition-all duration-150 bg-neutral-900 text-left shadow-lg">
                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                        {href ? <img src={href} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover" /> : <div className="absolute inset-0 grid place-items-center text-white/20"><Camera size={22} /></div>}
                                        <div className="absolute inset-x-0 top-0 h-16 bg-gradient-to-b from-black/70 to-transparent pointer-events-none" />
                                        <div className="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/85 via-black/25 to-transparent pointer-events-none" />
                                        {(() => { const st = !d.acknowledged ? { t: "Pendiente", c: "bg-amber-500/90" } : d.ackKind === "false" ? { t: "Falsa", c: "bg-slate-500/90" } : { t: "Real", c: "bg-red-600/90" }; return <span className={cn("absolute top-2.5 right-2.5 z-[1] inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-extrabold uppercase tracking-wide text-white shadow backdrop-blur-sm", st.c)}>{st.t}</span>; })()}
                                        <div className="absolute top-2.5 left-3 right-14">
                                            <div className="text-[13px] font-extrabold text-white leading-tight truncate drop-shadow">{d.deviceName || "Cámara"}</div>
                                            <div className="text-[11px] font-semibold text-white/80 tabular-nums drop-shadow truncate">{(d.nvrName ? d.nvrName + (d.ch != null ? " · CH " + d.ch : "") + " · " : "") + when}</div>
                                        </div>
                                        <span className={cn("absolute bottom-2.5 left-3 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-extrabold uppercase tracking-wide backdrop-blur-sm shadow", m.cls)}><m.Icon size={13} /> {m.label}</span>
                                        <span className="absolute bottom-2.5 right-3 inline-flex items-center px-2 py-1 rounded-lg bg-black/55 backdrop-blur-sm text-[11px] font-bold text-white/90 tabular-nums">hace {ago(d.timestamp)}</span>
                                    </button>
                                );
                            })}
                        </div>
                    )}
                    {loading && items.length > 0 && <div className="flex items-center justify-center gap-2 py-5 text-[12px] text-white/45"><Loader2 size={14} className="animate-spin" /> Cargando más…</div>}
                </div>
            </div>
        </div>
    );
}

function HistoryModal({ onClose, onOpen }: { onClose: () => void; onOpen: (d: DetHistItem) => void }) {
    const [items, setItems] = useState<DetHistItem[]>([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(0);
    const [type, setType] = useState<"ANALYTIC" | "ALL" | "MOTION" | "INTRUSION" | "LINECROSS">("ANALYTIC");
    const [loading, setLoading] = useState(true);
    const size = 40;
    useEffect(() => { setLoading(true); getDetectionHistory({ page, pageSize: size, type }).then((r) => { setItems(r.items); setTotal(r.total); }).catch(() => { }).finally(() => setLoading(false)); }, [page, type]);
    const pages = Math.max(1, Math.ceil(total / size));
    return (
        <div className="fixed inset-0 z-[2100] bg-black/80 backdrop-blur-sm flex items-center justify-center p-6" onClick={onClose}>
            <div className="w-full max-w-4xl h-[86vh] flex flex-col rounded-2xl bg-card border border-border shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center gap-2.5 px-5 py-4 border-b border-border">
                    <span className="grid h-8 w-8 place-items-center rounded-xl bg-red-500/15"><History size={16} className="text-red-500" /></span>
                    <span className="font-bold">Historial de intrusión</span>
                    <div className="ml-3 inline-flex rounded-xl border border-border p-0.5 bg-background">
                        {(["ANALYTIC", "INTRUSION", "LINECROSS", "MOTION", "ALL"] as const).map((f) => (
                            <button key={f} onClick={() => { setPage(0); setType(f); }} className={cn("px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wide transition-colors", type === f ? "bg-red-500/20 text-red-300" : "text-muted-foreground hover:text-foreground")}>
                                {f === "ANALYTIC" ? "Intrusión+" : f === "INTRUSION" ? "Intrusión" : f === "LINECROSS" ? "Línea" : f === "MOTION" ? "Movim." : "Todo"}
                            </button>
                        ))}
                    </div>
                    <span className="ml-auto text-[11px] text-muted-foreground tabular-nums">{total} eventos</span>
                    <button onClick={onClose} className="w-8 h-8 grid place-items-center rounded-full hover:bg-accent"><X size={18} /></button>
                </div>
                <div className="flex-1 overflow-y-auto custom-scrollbar">
                    {loading ? (
                        <div className="p-10 text-center text-muted-foreground"><Loader2 className="animate-spin inline mr-2" size={16} /> Cargando…</div>
                    ) : items.length === 0 ? (
                        <div className="p-10 text-center text-muted-foreground">Sin eventos</div>
                    ) : (
                        <table className="w-full text-sm">
                            <thead className="sticky top-0 bg-card border-b border-border text-[10px] uppercase tracking-widest text-muted-foreground z-10">
                                <tr><th className="text-left px-4 py-2.5 font-bold">Evento</th><th className="text-left px-4 py-2.5 font-bold">Cámara</th><th className="text-left px-4 py-2.5 font-bold">NVR · Canal</th><th className="text-left px-4 py-2.5 font-bold">Fecha</th></tr>
                            </thead>
                            <tbody>
                                {items.map((d) => { const m = META[d.type] || META.OTHER; return (
                                    <tr key={d.id} onClick={() => onOpen(d)} className="border-b border-border/40 hover:bg-accent/50 cursor-pointer">
                                        <td className="px-4 py-2.5"><span className={cn("inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border text-[11px] font-bold", m.cls)}><m.Icon size={12} /> {m.label}</span></td>
                                        <td className="px-4 py-2.5 text-foreground truncate max-w-[220px]">{d.deviceName || "—"}</td>
                                        <td className="px-4 py-2.5 text-muted-foreground">{d.nvrName || "—"}{d.ch != null ? ` · CH ${d.ch}` : ""}</td>
                                        <td className="px-4 py-2.5 text-muted-foreground tabular-nums">{new Date(d.timestamp).toLocaleString("es-UY", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</td>
                                    </tr>); })}
                            </tbody>
                        </table>
                    )}
                </div>
                <div className="shrink-0 flex items-center justify-between px-5 py-3 border-t border-border">
                    <span className="text-[11px] text-muted-foreground">Página {page + 1} de {pages}</span>
                    <div className="flex gap-2">
                        <button disabled={page <= 0} onClick={() => setPage((x) => Math.max(0, x - 1))} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-border text-xs font-bold disabled:opacity-40 hover:bg-accent"><ChevronLeft size={14} /> Anterior</button>
                        <button disabled={page >= pages - 1} onClick={() => setPage((x) => x + 1)} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-border text-xs font-bold disabled:opacity-40 hover:bg-accent">Siguiente <ChevronRight size={14} /></button>
                    </div>
                </div>
            </div>
        </div>
    );
}

function MovablePip({ children, defaultW = 208, ring = "ring-white/15" }: { children: React.ReactNode; defaultW?: number; ring?: string }) {
    const [st, setSt] = useState<{ x: number | null; y: number | null; w: number }>({ x: null, y: null, w: defaultW });
    const d = useRef<{ mode: "move" | "resize"; sx: number; sy: number; ox: number; oy: number; ow: number } | null>(null);
    const el = useRef<HTMLDivElement>(null);
    const begin = (mode: "move" | "resize") => (e: React.PointerEvent) => {
        if (e.button !== 0) return;
        e.preventDefault(); e.stopPropagation();
        const node = el.current; if (!node) return;
        const par = node.offsetParent as HTMLElement | null;
        const pr = par?.getBoundingClientRect(); const r = node.getBoundingClientRect();
        const ox = st.x ?? (pr ? r.left - pr.left : r.left);
        const oy = st.y ?? (pr ? r.top - pr.top : r.top);
        d.current = { mode, sx: e.clientX, sy: e.clientY, ox, oy, ow: st.w };
        try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { }
    };
    const onMove = (e: React.PointerEvent) => {
        const c = d.current; if (!c) return;
        if (c.mode === "move") {
            const node = el.current; const par = node?.offsetParent as HTMLElement | null; const pr = par?.getBoundingClientRect();
            let nx = c.ox + (e.clientX - c.sx), ny = c.oy + (e.clientY - c.sy);
            if (pr && node) { nx = Math.max(0, Math.min(pr.width - node.offsetWidth, nx)); ny = Math.max(0, Math.min(pr.height - node.offsetHeight, ny)); }
            setSt((v) => ({ ...v, x: nx, y: ny }));
        } else {
            setSt((v) => ({ ...v, w: Math.max(130, Math.min(720, c.ow + (e.clientX - c.sx))) }));
        }
    };
    const end = (e: React.PointerEvent) => { d.current = null; try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { } };
    const style: React.CSSProperties = st.x == null ? { right: 16, top: 64, width: st.w } : { left: st.x, top: st.y, width: st.w };
    return (
        <div ref={el} style={style} onPointerMove={onMove} onPointerUp={end} onPointerCancel={end}
            className={cn("absolute z-30 aspect-video rounded-xl overflow-hidden shadow-2xl ring-1 bg-black/60 select-none touch-none", ring)}>
            {children}
            <div onPointerDown={begin("move")} className="absolute inset-0 z-[1] cursor-move" />
            <div onPointerDown={begin("resize")} title="Redimensionar" className="absolute bottom-0 right-0 z-[3] w-5 h-5 grid place-items-end p-1 cursor-nwse-resize">
                <span className="w-2.5 h-2.5 border-r-2 border-b-2 border-white/70" />
            </div>
        </div>
    );
}

function LiveModal({ cam, cams = [], geom, initialTab = "live", fromCam, camStatus, onClose, onOpenEvent, onSwitchCam, onDismissFrom }: { cam: IntrusionCam; cams?: IntrusionCam[]; geom?: Geom; initialTab?: "live" | "rec" | "evi"; fromCam?: IntrusionCam | null; camStatus?: Record<string, { recent: boolean; alarm: boolean }>; onClose: () => void; onOpenEvent?: (d: DetHistItem) => void; onSwitchCam?: (c: IntrusionCam) => void; onDismissFrom?: () => void }) {
    const [tab, setTab] = useState<"live" | "rec" | "evi">(initialTab);
    const isPtz = /ptz/i.test(cam.name || "");
    const [showPtz, setShowPtz] = useState(true);
    const [ptzSpeed, setPtzSpeed] = useState(5);
    const ptzSend = (action: string, opts: any = {}) => fetch(`/api/devices/ptz?deviceId=${cam.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, speed: ptzSpeed, ...opts }) }).catch(() => { });
    const dragRefP = useRef<{ active: boolean; dir: string; ox: number; oy: number }>({ active: false, dir: "", ox: 0, oy: 0 });
    const wheelTO = useRef<any>(null);
    // Teclado: flechas mueven, +/- zoom (apenas carga el modal en tab vivo)
    useEffect(() => {
        if (tab !== "live" || !isPtz) return;
        const km: Record<string, string> = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" };
        const held = new Set<string>();
        const keyToDir = (e: KeyboardEvent) => (e.key === "+" || e.key === "=") ? "zoomin" : (e.key === "-" || e.key === "_") ? "zoomout" : km[e.key];
        const down = (e: KeyboardEvent) => { const d = keyToDir(e); if (!d) return; e.preventDefault(); if (held.has(d)) return; held.add(d); ptzSend("move", { dir: d }); };
        const up = (e: KeyboardEvent) => { const d = keyToDir(e); if (!d) return; e.preventDefault(); if (held.delete(d)) ptzSend("stop", { dir: d }); };
        window.addEventListener("keydown", down); window.addEventListener("keyup", up);
        return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); held.forEach((d) => ptzSend("stop", { dir: d })); };
    }, [tab, isPtz, ptzSpeed, cam.id]);
    const [hd, setHd] = useState(false);
    const [showPip, setShowPip] = useState(true);
    const streamName = hd ? `lpr_${cam.id}_hd` : `lpr_${cam.id}`;
    // ── Visual Track: enlaces a cámaras vecinas de la misma escena ──
    const stageRef = useRef<HTMLDivElement>(null);
    const [trackEdit, setTrackEdit] = useState(false);
    const [hoverLink, setHoverLink] = useState<number | null>(null);
    const [links, setLinks] = useState<TrackLink[]>([]);
    const [trackSaving, setTrackSaving] = useState(false);
    const [addOpen, setAddOpen] = useState(false);
    const dragLink = useRef<number | null>(null);
    useEffect(() => { let on = true; setTrackEdit(false); setAddOpen(false); getVisualTrackLinks(cam.id).then((l) => { if (on) setLinks(l); }).catch(() => { }); return () => { on = false; }; }, [cam.id]);
    const saveLinks = async (next: TrackLink[]) => { setLinks(next); setTrackSaving(true); try { await setVisualTrackLinks(cam.id, next); } finally { setTrackSaving(false); } };
    const linkTargets = useMemo(() => links.map((l) => ({ l, c: cams.find((c) => c.id === l.to) })).filter((x) => x.c), [links, cams]);
    const addCandidates = useMemo(() => cams.filter((c) => c.id !== cam.id && !links.some((l) => l.to === c.id)), [cams, cam.id, links]);
    const stageXY = (clientX: number, clientY: number) => { const r = stageRef.current?.getBoundingClientRect(); if (!r) return { x: 0.5, y: 0.5 }; return { x: Math.max(0, Math.min(1, (clientX - r.left) / r.width)), y: Math.max(0, Math.min(1, (clientY - r.top) / r.height)) }; };
    const videoRef = useRef<HTMLVideoElement>(null);
    const [ready, setReady] = useState(false);
    const [stalled, setStalled] = useState(false);
    const readyRef = useRef(false);
    const setReadyV = (v: boolean) => { readyRef.current = v; setReady(v); };
    // ── Anti-verde: el decodificador VAAPI emite 1–N frames verdes al calentar.
    //    No revelamos el <video> hasta pintar un frame real (muestreo 8x8 por canvas). ──
    const sampleCanvas = useRef<HTMLCanvasElement | null>(null);
    const paintRAF = useRef<number>(0);
    const isGreenFrame = (v: HTMLVideoElement) => {
        try {
            if (!v.videoWidth || v.readyState < 2) return true;
            let c = sampleCanvas.current; if (!c) { c = document.createElement("canvas"); c.width = 8; c.height = 8; sampleCanvas.current = c; }
            const ctx = c.getContext("2d", { willReadFrequently: true } as any); if (!ctx) return false;
            ctx.drawImage(v, 0, 0, 8, 8);
            const d = ctx.getImageData(0, 0, 8, 8).data; let r = 0, g = 0, b = 0, n = 0;
            for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
            r /= n; g /= n; b /= n;
            return g > 40 && r < 28 && b < 28; // verde puro de warmup (≈0,76,0)
        } catch { return false; } // tainted u otro error → no bloquear
    };
    const waitRealFrame = (v: HTMLVideoElement | null, done: () => void, capMs = 2600) => {
        if (!v) { done(); return; }
        const t0 = performance.now();
        const step = () => {
            if (!isGreenFrame(v) || performance.now() - t0 > capMs) { done(); return; }
            paintRAF.current = requestAnimationFrame(step);
        };
        cancelAnimationFrame(paintRAF.current); paintRAF.current = requestAnimationFrame(step);
    };
    const [snap, setSnap] = useState(`/api/snapshot/${cam.id}?t=${Date.now()}`);
    const [qFlash, setQFlash] = useState(0);
    // grabación
    const [nvrId, setNvrId] = useState<string | null>(null);
    const [recT, setRecT] = useState(Date.now() - 60000);      // posición del slider (inmediata)
    const [recLoadT, setRecLoadT] = useState(Date.now() - 60000); // tiempo confirmado (debounced) que se reproduce
    const [globalEnd] = useState(() => Date.now());
    const [zoomIdx, setZoomIdx] = useState(0);
    const [anchor, setAnchor] = useState(() => Date.now() - 60000);
    const [recLoading, setRecLoading] = useState(false);
    const [recEvents, setRecEvents] = useState<DetHistItem[]>([]);
    const [scrub, setScrub] = useState<number | null>(null); // hora que se muestra grande al arrastrar
    const scrubTO = useRef<any>(null);
    const [recRetry, setRecRetry] = useState(0); // para reintentar el clip si queda colgado
    const recTriesRef = useRef(0);
    const [recSeen, setRecSeen] = useState(initialTab === "rec");
    const [recRate, setRecRate] = useState(1); // velocidad de reproducción (1/2/4/8)
    const [noRec, setNoRec] = useState(false); // no hay grabación en ese horario
    // fecha + hora: la rueda elige la hora; el date-picker elige el día
    const pad2 = (n: number) => String(n).padStart(2, "0");
    const dayStr = (ms: number) => { const d = new Date(ms); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };
    const recDateStr = dayStr(recT);
    const todayStr = dayStr(Date.now());
    const dateTimeToMs = (dateStr: string, minutes: number) => {
        const [y, mo, da] = dateStr.split("-").map(Number);
        const ms = new Date(y, (mo || 1) - 1, da || 1, Math.floor(minutes / 60), minutes % 60, 0, 0).getTime();
        return Math.min(Date.now(), ms); // nunca futuro
    };
    const recMinutesOfDay = (() => { const d = new Date(recT); return d.getHours() * 60 + d.getMinutes(); })(); // no cargar el clip hasta que se abra Grabación al menos una vez
    const seekTo = (ms: number) => { const v = Math.max(Date.now() - 30 * 24 * 3600 * 1000, Math.min(Date.now(), ms)); setRecT(v); setScrub(v); clearTimeout(scrubTO.current); scrubTO.current = setTimeout(() => setScrub(null), 1100); };
    const recVideo = useRef<HTMLVideoElement>(null);
    // evidencia
    const [evi, setEvi] = useState<DetHistItem[]>([]);
    const [eviBig, setEviBig] = useState<string | null>(null);

    useEffect(() => { fetch(`/api/devices/stream?deviceId=${cam.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "ensure" }) }).catch(() => { }); }, [cam.id]);
    useEffect(() => { fetch(`/api/nvr/channel?deviceId=${cam.id}`, { cache: "no-store" }).then((r) => r.json()).then((d) => setNvrId(d && d.nvr ? String(d.nvr) : null)).catch(() => { }); }, [cam.id]);
    useEffect(() => { if (tab !== "evi") return; getDetectionHistory({ deviceId: cam.id, pageSize: 30 }).then((r) => setEvi(r.items)).catch(() => { }); }, [tab, cam.id]);
    useEffect(() => { if (tab !== "rec") return; getDetectionHistory({ deviceId: cam.id, pageSize: 100 }).then((r) => setRecEvents(r.items)).catch(() => { }); }, [tab, cam.id]);
    useEffect(() => { if (ready || tab !== "live") return; const iv = setInterval(() => setSnap(`/api/snapshot/${cam.id}?t=${Date.now()}`), 1500); return () => clearInterval(iv); }, [ready, cam.id, tab]);

    // ── LIVE loader (paciencia > warmup del transcode HW, sin churn) ──
    // NO depende de `tab`: el vivo sigue corriendo aunque estés en Grabación/Evidencia,
    // así volver a "Vivo" es instantáneo (no recarga el stream).
    useEffect(() => {
        const video = videoRef.current; if (!video) return;
        let stopped = false, tries = 0; let wd: any = null, st: any = null;
        const base = `/go2rtc/api/stream.mp4?src=${encodeURIComponent(streamName)}&video=h264`;
        setReadyV(false); setStalled(false);
        const watchdog = () => { clearTimeout(wd); wd = setTimeout(() => { if (stopped) return; if (!readyRef.current && tries++ < 10) start(); }, 10000); };
        const start = () => { if (stopped) return; try { video.src = `${base}&t=${Date.now()}`; video.play().catch(() => { }); } catch { } watchdog(); };
        const markStall = () => { clearTimeout(st); st = setTimeout(() => { if (!stopped) setStalled(true); }, 2500); }; // sólo si el corte dura
        const onPlaying = () => { clearTimeout(wd); clearTimeout(st); tries = 0; setStalled(false); waitRealFrame(video, () => setReadyV(true)); };
        const onWaiting = () => markStall();
        const onEnded = () => { if (stopped) return; start(); }; // reconexión fluida manteniendo el último frame
        const onErr = () => { if (stopped) return; markStall(); if (tries++ < 10) setTimeout(start, 1800); };
        const onProgress = () => { try { if (video.buffered.length) { const end = video.buffered.end(video.buffered.length - 1); if (end - video.currentTime > 4) video.currentTime = end - 0.8; } } catch { } };
        video.addEventListener("playing", onPlaying); video.addEventListener("waiting", onWaiting); video.addEventListener("stalled", onWaiting); video.addEventListener("ended", onEnded); video.addEventListener("error", onErr); video.addEventListener("progress", onProgress);
        const boot = setTimeout(start, 120);
        return () => { stopped = true; cancelAnimationFrame(paintRAF.current); clearTimeout(wd); clearTimeout(st); clearTimeout(boot); video.removeEventListener("playing", onPlaying); video.removeEventListener("waiting", onWaiting); video.removeEventListener("stalled", onWaiting); video.removeEventListener("ended", onEnded); video.removeEventListener("error", onErr); video.removeEventListener("progress", onProgress); try { video.pause(); video.removeAttribute("src"); video.load(); } catch { } };
    }, [streamName, cam.id]);
    const toggleHd = () => { setHd((h) => !h); setQFlash(Date.now()); };
    useEffect(() => { if (!qFlash) return; const t = setTimeout(() => setQFlash(0), 1200); return () => clearTimeout(t); }, [qFlash]);

    useEffect(() => { if (tab === "rec") setRecSeen(true); }, [tab]);
    // ── REC: debounce del seek (evita disparar clips en cada pixel del arrastre) ──
    useEffect(() => { if (tab !== "rec") return; setRecLoading(true); const t = setTimeout(() => setRecLoadT(recT), 300); return () => clearTimeout(t); }, [recT, tab]);
    // watchdog: si el clip no empieza, reintenta; si tras los reintentos sigue sin frames, es que no hay grabación en ese horario.
    useEffect(() => {
        if (tab !== "rec") return; setNoRec(false); const v = recVideo.current;
        const wd = setTimeout(() => {
            if (v && v.readyState < 2) {
                if (recTriesRef.current < 2) { recTriesRef.current++; setRecRetry((r) => r + 1); }
                else { setRecLoading(false); setNoRec(true); }
            }
        }, 9000);
        return () => clearTimeout(wd);
    }, [recLoadT, recRetry, tab]);
    // aplicar velocidad de reproducción al clip
    useEffect(() => { const v = recVideo.current; if (v) try { v.playbackRate = recRate; } catch { } }, [recRate, recLoadT, recRetry]);

    const DAY = 24 * 3600 * 1000;
    const globalStart = globalEnd - DAY;
    const ZOOM: { scale: number; span: number }[] = [
        { scale: 3600, span: 24 * 3600 }, { scale: 1800, span: 12 * 3600 }, { scale: 600, span: 4 * 3600 },
        { scale: 300, span: 2 * 3600 }, { scale: 120, span: 3600 }, { scale: 60, span: 1800 }, { scale: 30, span: 900 }, { scale: 10, span: 300 },
    ];
    const zoom = ZOOM[Math.max(0, Math.min(ZOOM.length - 1, zoomIdx))];
    const recWin = useMemo(() => {
        const span = zoom.span * 1000;
        if (span >= DAY) return { start: globalStart, end: globalEnd };
        let start = anchor - span / 2;
        start = Math.max(globalStart, Math.min(globalEnd - span, start));
        return { start, end: start + span };
    }, [zoom.span, anchor, globalStart, globalEnd]);
    const recMin = recWin.start;
    const nowTs = recWin.end;
    // reencuadrar si el cursor sale de la ventana
    useEffect(() => { if (recT < recWin.start || recT > recWin.end) setAnchor(recT); }, [recT, recWin.start, recWin.end]);
    const playbackUrl = nvrId && cam.ch != null ? `/api/nvr/playback?ch=${cam.ch}&t=${Math.floor(recLoadT)}&pre=4&dur=90&nvr=${nvrId}` : null;

    const tabs: { k: "live" | "rec" | "evi"; Icon: any; label: string }[] = [
        { k: "live", Icon: Video, label: "Vivo" },
        { k: "rec", Icon: Film, label: "Grabación" },
        { k: "evi", Icon: Camera, label: "Evidencia" },
    ];
    // ticks cada 3h para etiquetas + cada 1h finos

    return (
        <div className="fixed inset-0 z-[2100] bg-black/90 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6">
            <div className="relative w-full max-w-6xl max-h-[85vh] aspect-video rounded-2xl overflow-hidden bg-black shadow-2xl" onClick={(e) => e.stopPropagation()}>
                {/* ── VIVO ── */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={snap} alt="" className={cn("absolute inset-0 w-full h-full object-contain transition-all duration-500", (!ready || tab !== "live") && "blur-[6px] scale-105 brightness-[0.5]")} />
                {tab === "live" && !ready && <div className="vsheen absolute inset-0 overflow-hidden pointer-events-none" />}
                {tab === "live" && (!ready || stalled) && (
                    <div className="absolute inset-0 grid place-items-center pointer-events-none z-[2]">
                        <span className="text-white text-xl sm:text-2xl font-extrabold tracking-wide drop-shadow-[0_2px_10px_rgba(0,0,0,0.85)]">
                            {!ready ? (hd ? "Cambiando a HD" : "Conectando video") : "Reconectando"}<Dots />
                        </span>
                    </div>
                )}
                <video ref={videoRef} autoPlay muted playsInline className={cn("absolute inset-0 w-full h-full object-contain transition-opacity duration-300", tab === "live" && ready ? "opacity-100" : "opacity-0 pointer-events-none")} />
                {tab === "live" && <GeomOverlay geom={geom} />}
                {/* mini de la cámara de ORIGEN del seguimiento — movible y redimensionable */}
                {tab === "live" && fromCam && (
                    <MovablePip defaultW={208} ring="ring-amber-400/40">
                        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                        <video key={`from_${fromCam.id}`} autoPlay muted playsInline src={`/go2rtc/api/stream.mp4?src=${encodeURIComponent(`lpr_${fromCam.id}`)}&video=h264`} className="absolute inset-0 w-full h-full object-cover" />
                        <span className="absolute top-1 left-1 z-[2] inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-black/60 text-[8.5px] font-extrabold uppercase tracking-wide text-amber-300 pointer-events-none"><Crosshair size={7} /> Origen · {fromCam.name}</span>
                        <button onClick={() => onSwitchCam?.(fromCam)} data-tooltip-id="mi-tip" data-tooltip-content={`Volver a ${fromCam.name}`}
                            className="absolute bottom-1 left-1 z-[2] inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/90 hover:bg-amber-500 text-white text-[9px] font-extrabold uppercase tracking-wide"><ChevronLeft size={11} /> Volver</button>
                        <button onClick={onDismissFrom} data-tooltip-id="mi-tip" data-tooltip-content="Cerrar origen"
                            className="absolute top-1 right-1 z-[2] w-6 h-6 grid place-items-center rounded-full bg-black/55 hover:bg-black/80 text-white/80 hover:text-white transition"><X size={13} /></button>
                    </MovablePip>
                )}
                {/* ── Visual Track: enlaces a cámaras vecinas ── */}
                {tab === "live" && (
                    <div ref={stageRef} className={cn("absolute inset-0 z-[6]", trackEdit ? "pointer-events-auto" : "pointer-events-none")}
                        onPointerMove={(e) => { if (!trackEdit || dragLink.current == null) return; const { x, y } = stageXY(e.clientX, e.clientY); setLinks((prev) => prev.map((l, i) => i === dragLink.current ? { ...l, x, y } : l)); }}
                        onPointerUp={() => { if (dragLink.current != null) { dragLink.current = null; saveLinks(links); } }}
                        onPointerLeave={() => { if (dragLink.current != null) { dragLink.current = null; saveLinks(links); } }}>
                        {linkTargets.map(({ l, c }, i) => { const stt = camStatus?.[c!.id]; const hasEvents = !!stt?.alarm; const hasRecent = !!stt?.recent; return (
                            <div key={c!.id} style={{ left: `${l.x * 100}%`, top: `${l.y * 100}%` }} className="absolute -translate-x-1/2 -translate-y-1/2">
                                {trackEdit ? (
                                    <div onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); dragLink.current = i; }}
                                        className="group relative flex items-center gap-1.5 pl-2 pr-2.5 h-8 rounded-full bg-amber-500/90 text-white ring-2 ring-white/70 shadow-xl cursor-move select-none touch-none">
                                        <Crosshair size={14} className="shrink-0" />
                                        <span className="text-[11px] font-extrabold truncate max-w-[120px]">{c!.name}</span>
                                        <button onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); const next = links.filter((_, j) => j !== i); saveLinks(next); }}
                                            className="ml-0.5 w-5 h-5 grid place-items-center rounded-full bg-black/40 hover:bg-red-600 text-white shrink-0"><Trash2 size={11} /></button>
                                    </div>
                                ) : (
                                    <button onClick={() => onSwitchCam?.(c!)} onMouseEnter={() => setHoverLink(i)} onMouseLeave={() => setHoverLink((h) => (h === i ? null : h))}
                                        data-tooltip-id="mi-tip" data-tooltip-content={hasEvents ? `${c!.name} · ¡eventos!` : `Seguir a ${c!.name}`}
                                        className={cn("pointer-events-auto relative grid place-items-center w-11 h-11 rounded-full text-white backdrop-blur-md ring-1 shadow-xl transition-all active:scale-90", hasEvents ? "bg-red-600/90 ring-red-300/70 animate-bounce" : "bg-black/50 hover:bg-amber-500/90 ring-white/25 hover:ring-white/80")}>
                                        <span className={cn("absolute inset-0 rounded-full animate-ping", hasEvents ? "bg-red-500/60" : "bg-amber-400/40")} />
                                        <Camera size={18} className="relative" />
                                        {hasRecent && <span className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-red-500 ring-2 ring-black/70 shadow animate-pulse" />}
                                        {hoverLink === i && (
                                            <div className={cn("absolute w-52 rounded-xl overflow-hidden bg-black/85 backdrop-blur-md ring-1 ring-white/20 shadow-2xl pointer-events-none z-10", l.y < 0.42 ? "top-full mt-2" : "bottom-full mb-2", l.x < 0.2 ? "left-0" : l.x > 0.8 ? "right-0" : "left-1/2 -translate-x-1/2")}>
                                                <div className="relative aspect-video bg-black">
                                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                                    <img src={`/api/snapshot/${c!.id}?t=hover`} alt="" className="absolute inset-0 w-full h-full object-cover" />
                                                    {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                                                    <video autoPlay muted playsInline src={`/go2rtc/api/stream.mp4?src=${encodeURIComponent(`lpr_${c!.id}`)}&video=h264`} className="absolute inset-0 w-full h-full object-cover" />
                                                    <span className="absolute top-1 left-1 inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-black/55 text-[8px] font-extrabold uppercase tracking-wide text-amber-300"><Crosshair size={7} /> Seguir</span>
                                                </div>
                                                <div className="px-2 py-1.5 flex items-center gap-1.5">
                                                    <span className="text-white text-[11px] font-bold truncate">{c!.name}</span>
                                                </div>
                                            </div>
                                        )}
                                    </button>
                                )}
                            </div>
                        ); })}
                        {/* panel de edición */}
                        {trackEdit && (
                            <div className="pointer-events-auto absolute top-16 left-1/2 -translate-x-1/2 w-[min(90%,420px)] rounded-2xl bg-black/70 backdrop-blur-xl ring-1 ring-white/15 shadow-2xl p-3">
                                <div className="flex items-center gap-2 mb-1">
                                    <Crosshair size={15} className="text-amber-400" />
                                    <span className="text-white text-[13px] font-extrabold">Seguimiento visual</span>
                                    {trackSaving && <Loader2 size={13} className="animate-spin text-white/60" />}
                                    <button onClick={() => setAddOpen((v) => !v)} className="ml-auto inline-flex items-center gap-1 h-7 px-2.5 rounded-full bg-amber-500/90 hover:bg-amber-500 text-white text-[11px] font-extrabold"><Plus size={13} /> Agregar cámara</button>
                                </div>
                                <p className="text-white/55 text-[11px] leading-snug">Arrastrá cada ícono al punto de la escena por donde se pasa a esa cámara. Al verlo en vivo, tocá el ícono para seguir al intruso.</p>
                                {addOpen && (
                                    <div className="mt-2 max-h-44 overflow-y-auto rounded-xl bg-black/40 ring-1 ring-white/10 divide-y divide-white/5">
                                        {addCandidates.length === 0 && <div className="px-3 py-2 text-white/40 text-[11px]">No hay más cámaras para enlazar.</div>}
                                        {addCandidates.map((c) => (
                                            <button key={c.id} onClick={() => { saveLinks([...links, { to: c.id, x: 0.5, y: 0.5 }]); setAddOpen(false); }}
                                                className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-white/10 transition-colors">
                                                <Crosshair size={13} className="text-amber-400 shrink-0" />
                                                <span className="text-white text-[12px] font-bold truncate">{c.name}</span>
                                                {c.nvrName && <span className="ml-auto text-white/40 text-[10px] font-semibold truncate">{c.nvrName}</span>}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                )}
                {tab === "live" && isPtz && (
                    <div className="absolute inset-0 z-[5] cursor-grab active:cursor-grabbing"
                        onWheel={(e) => { e.preventDefault(); const dir = e.deltaY < 0 ? "zoomin" : "zoomout"; ptzSend("move", { dir }); clearTimeout(wheelTO.current); wheelTO.current = setTimeout(() => ptzSend("stop", { dir }), 280); }}
                        onPointerDown={(e) => { dragRefP.current = { active: true, dir: "", ox: e.clientX, oy: e.clientY }; (e.target as Element).setPointerCapture?.(e.pointerId); }}
                        onPointerMove={(e) => { const st = dragRefP.current; if (!st.active) return; const dx = e.clientX - st.ox, dy = e.clientY - st.oy; const dist = Math.hypot(dx, dy); if (dist < 22) { if (st.dir) { ptzSend("stop", { dir: st.dir }); st.dir = ""; } return; } const dir = ptzAngleToDir(Math.atan2(dy, dx)); if (dir !== st.dir) { if (st.dir) ptzSend("stop", { dir: st.dir }); ptzSend("move", { dir }); st.dir = dir; } }}
                        onPointerUp={() => { const st = dragRefP.current; if (st.dir) ptzSend("stop", { dir: st.dir }); dragRefP.current = { active: false, dir: "", ox: 0, oy: 0 }; }}
                        onPointerLeave={() => { const st = dragRefP.current; if (st.dir) ptzSend("stop", { dir: st.dir }); dragRefP.current = { active: false, dir: "", ox: 0, oy: 0 }; }}
                    />
                )}
                {tab === "live" && isPtz && showPtz && <div className="absolute bottom-16 right-4 z-30"><PtzControls deviceId={cam.id} speed={ptzSpeed} onSpeed={setPtzSpeed} /></div>}

                {/* ── GRABACIÓN ── (se mantiene montado para no recargar el clip al cambiar de pestaña) */}
                {(
                    <div className={cn("absolute inset-0 z-10 bg-black", tab !== "rec" && "hidden")}>
                        {/* fondo: última captura del canal (evita el vacío negro mientras el NVR abre la grabación) */}
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={snap} alt="" className={cn("absolute inset-0 z-0 w-full h-full object-contain transition-opacity duration-500", recLoading ? "opacity-100 blur-[6px] scale-105 brightness-[0.4]" : "opacity-0")} />
                        {recSeen && playbackUrl ? (
                            <video key={`${playbackUrl}#${recRetry}`} ref={recVideo} src={playbackUrl} autoPlay controls playsInline poster={snap}
                                onLoadedData={() => { recTriesRef.current = 0; setRecLoading(false); setNoRec(false); try { recVideo.current!.playbackRate = recRate; } catch { } }} onPlaying={() => { recTriesRef.current = 0; setNoRec(false); waitRealFrame(recVideo.current, () => setRecLoading(false)); }} onCanPlay={() => setRecLoading(false)} onWaiting={() => setRecLoading(true)}
                                onError={() => { if (recTriesRef.current < 2) { recTriesRef.current++; setTimeout(() => setRecRetry((r) => r + 1), 800); } else { setRecLoading(false); setNoRec(true); } }}
                                className="absolute inset-0 z-[1] w-full h-full object-contain" />
                        ) : (
                            <div className="absolute inset-0 z-[1] grid place-items-center text-white/50 text-sm">Sin NVR/canal para reproducir grabación.</div>
                        )}
                        {/* mini PiP del vivo sobre la grabación — cerrable */}
                        {recSeen && showPip && (
                            <MovablePip defaultW={208} ring="ring-white/15">
                                {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                                <video key={`pip_${cam.id}`} autoPlay muted playsInline src={`/go2rtc/api/stream.mp4?src=${encodeURIComponent(`lpr_${cam.id}`)}&video=h264`} className="absolute inset-0 w-full h-full object-cover" />
                                <span className="absolute top-1 left-1 z-[2] inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-black/55 text-[8.5px] font-extrabold uppercase tracking-wide text-red-300"><Circle size={6} className="fill-red-500 text-red-500 animate-pulse" /> Vivo</span>
                                <button onClick={() => setShowPip(false)} data-tooltip-id="mi-tip" data-tooltip-content="Cerrar ventana de vivo"
                                    className="absolute top-1 right-1 z-[2] w-6 h-6 grid place-items-center rounded-full bg-black/55 hover:bg-black/80 text-white/80 hover:text-white transition"><X size={13} /></button>
                            </MovablePip>
                        )}
                        {recSeen && !showPip && (
                            <button onClick={() => setShowPip(true)} data-tooltip-id="mi-tip" data-tooltip-content="Mostrar ventana de vivo"
                                className="absolute right-4 top-16 z-30 inline-flex items-center gap-1 px-2 py-1 rounded-full bg-black/55 hover:bg-black/80 ring-1 ring-white/15 text-[9px] font-extrabold uppercase tracking-wide text-red-300 transition"><Circle size={6} className="fill-red-500 text-red-500 animate-pulse" /> Vivo</button>
                        )}
                        {/* aviso centrado mientras el NVR abre/ubica la grabación (no tapa los controles de abajo) */}
                        {recLoading && playbackUrl && scrub == null && !noRec && (
                            <div className="absolute inset-x-0 top-0 bottom-36 z-[2] grid place-items-center pointer-events-none">
                                <span className="text-white text-lg sm:text-xl font-extrabold tracking-wide drop-shadow-[0_2px_10px_rgba(0,0,0,0.85)]">Buscando grabación en el NVR<Dots /></span>
                            </div>
                        )}
                        {noRec && scrub == null && (
                            <div className="absolute inset-x-0 top-0 bottom-36 z-[2] grid place-items-center pointer-events-none">
                                <span className="inline-flex flex-col items-center gap-1 text-white/90 drop-shadow-[0_2px_10px_rgba(0,0,0,0.9)]">
                                    <span className="text-lg sm:text-xl font-extrabold">Sin grabación en este horario</span>
                                    <span className="text-[12px] text-white/55">Probá otro momento en la línea de tiempo</span>
                                </span>
                            </div>
                        )}
                        {/* hora grande mientras se arrastra la barra — abajo, sobre la línea de tiempo (no tapa el aviso de carga) */}
                        {scrub != null && (
                            <div className="absolute inset-x-0 bottom-32 z-[25] flex justify-center pointer-events-none">
                                <span className="px-4 py-1 rounded-xl bg-black/45 backdrop-blur-sm text-white text-3xl sm:text-4xl font-extrabold tabular-nums tracking-wide drop-shadow-[0_3px_14px_rgba(0,0,0,0.95)]">
                                    {new Date(scrub).toLocaleTimeString("es-UY", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                                </span>
                            </div>
                        )}
                        {/* línea de tiempo — sin recuadro, directa sobre degradado */}
                        <div className="absolute bottom-0 inset-x-0 px-5 pb-3 pt-20 bg-gradient-to-t from-black/90 via-black/40 to-transparent z-20">
                            <div>
                                <div className="flex items-center gap-2.5 mb-2">
                                    {/* fecha seleccionada — pill con icono; el input nativo va encima, invisible */}
                                    <label className="relative inline-flex items-center gap-1.5 h-8 pl-2.5 pr-3 rounded-full bg-white/10 hover:bg-white/15 ring-1 ring-white/10 cursor-pointer transition"
                                        data-tooltip-id="mi-tip" data-tooltip-content="Elegir fecha">
                                        <CalIco size={13} className="text-white/55 shrink-0" />
                                        <span className="text-white font-bold tabular-nums text-[12px] leading-none">{new Date(recT).toLocaleDateString("es-UY", { day: "2-digit", month: "2-digit", year: "numeric" })}</span>
                                        <input type="date" value={recDateStr} max={todayStr}
                                            onChange={(e) => { const v = e.target.value; if (v) seekTo(dateTimeToMs(v, recMinutesOfDay)); }}
                                            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer [color-scheme:dark]" />
                                    </label>
                                    {/* hora en curso */}
                                    <span className="inline-flex items-center gap-1.5">
                                        <Circle size={7} className="fill-red-500 text-red-500 animate-pulse shrink-0" />
                                        <span className="text-white font-extrabold tabular-nums text-[15px] leading-none drop-shadow-[0_1px_5px_rgba(0,0,0,0.95)]">{new Date(recT).toLocaleTimeString("es-UY", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
                                    </span>
                                    {/* velocidad de reproducción */}
                                    <button onClick={() => setRecRate((r) => (r >= 8 ? 1 : r * 2))} data-tooltip-id="mi-tip" data-tooltip-content="Velocidad de reproducción"
                                        className={cn("ml-auto h-8 min-w-[40px] px-2.5 grid place-items-center rounded-full text-[12px] font-extrabold tabular-nums ring-1 ring-white/10 transition", recRate > 1 ? "bg-sky-500/80 text-white ring-sky-400/40" : "bg-white/10 text-white/90 hover:bg-white/15")}>{recRate}x</button>
                                </div>
                                <Scrub step="5" momentum={30} format="24h" width={680} value={recMinutesOfDay} start={recMinutesOfDay} onChange={(mins) => seekTo(dateTimeToMs(recDateStr, mins))} />
                            </div>
                        </div>
                    </div>
                )}

                {/* ── EVIDENCIA ── */}
                {tab === "evi" && (
                    <div className="absolute inset-0 z-10 bg-black/70 backdrop-blur-sm overflow-y-auto custom-scrollbar p-4 pt-14 pl-20">
                        {evi.length === 0 ? (
                            <div className="h-full grid place-items-center text-white/50 text-sm">Sin capturas de evidencia para este canal.</div>
                        ) : (
                            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                                {evi.map((d) => {
                                    const m = META[d.type] || META.OTHER;
                                    const href = d.snapshotPath || (d.deviceId ? `/api/snapshot/${d.deviceId}?t=${d.id}` : null);
                                    const loc = d.deviceName || cam.name;
                                    const when = new Date(d.timestamp).toLocaleString("es-UY", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
                                    return (
                                        <button key={d.id} onClick={() => href && setEviBig(href)} className="group relative aspect-video rounded-2xl overflow-hidden ring-1 ring-white/10 hover:ring-2 hover:ring-red-400/60 hover:z-10 hover:scale-[1.02] transition-all duration-150 bg-neutral-900 text-left shadow-lg">
                                            {/* eslint-disable-next-line @next/next/no-img-element */}
                                            {href ? <img src={href} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover" /> : <div className="absolute inset-0 grid place-items-center text-white/20"><Camera size={22} /></div>}
                                            <div className="absolute inset-x-0 top-0 h-16 bg-gradient-to-b from-black/70 to-transparent pointer-events-none" />
                                            <div className="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/85 via-black/25 to-transparent pointer-events-none" />
                                            <div className="absolute top-2.5 left-3 right-3">
                                                <div className="text-[13px] font-extrabold text-white leading-tight truncate drop-shadow">{loc}</div>
                                                <div className="text-[11px] font-semibold text-white/80 tabular-nums drop-shadow">{when}</div>
                                            </div>
                                            <span className={cn("absolute bottom-2.5 left-3 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-extrabold uppercase tracking-wide backdrop-blur-sm shadow", m.cls)}><m.Icon size={13} /> {m.label}</span>
                                            <span className="absolute bottom-2.5 right-3 inline-flex items-center px-2 py-1 rounded-lg bg-black/55 backdrop-blur-sm text-[11px] font-bold text-white/90 tabular-nums">hace {ago(d.timestamp)}</span>
                                        </button>
                                    );
                                })}
                            </div>
                        )}
                        {eviBig && (
                            <div className="fixed inset-0 z-[2200] bg-black/90 grid place-items-center p-6" onClick={() => setEviBig(null)}>
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={eviBig} alt="" className="max-w-full max-h-full object-contain rounded-xl" />
                            </div>
                        )}
                    </div>
                )}

                {/* flash de calidad */}
                <AnimatePresence>
                    {qFlash > 0 && tab === "live" && (
                        <motion.div key={qFlash} initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 1.15 }} transition={{ type: "spring", stiffness: 400, damping: 26 }}
                            className="absolute inset-0 grid place-items-center pointer-events-none z-20">
                            <span className="px-5 py-2.5 rounded-2xl bg-black/55 backdrop-blur-md text-white text-lg font-extrabold tracking-[0.25em] ring-1 ring-white/15 shadow-2xl">{hd ? "HD · ALTA" : "SD · ESTÁNDAR"}</span>
                        </motion.div>
                    )}
                </AnimatePresence>

                {/* barra de pestañas glass (izquierda) */}
                <div className="absolute left-3 top-1/2 -translate-y-1/2 z-30 flex flex-col gap-1.5 p-1.5 rounded-2xl bg-black/45 backdrop-blur-xl ring-1 ring-white/10 shadow-xl">
                    {tabs.map(({ k, Icon, label }) => (
                        <button key={k} onClick={() => setTab(k)} data-tooltip-id="mi-tip" data-tooltip-content={label}
                            className={cn("grid h-11 w-11 place-items-center rounded-xl transition-all active:scale-90", tab === k ? "bg-red-600 text-white shadow-lg" : "text-white/70 hover:text-white hover:bg-white/10")}>
                            <Icon size={18} />
                        </button>
                    ))}
                </div>

                {/* top */}
                <div className="absolute top-0 inset-x-0 p-4 flex items-start gap-3 bg-gradient-to-b from-black/65 to-transparent z-20">
                    <div className="text-base font-extrabold text-white leading-tight truncate drop-shadow min-w-0">{cam.name}</div>
                    <div className="ml-auto flex items-center gap-2 shrink-0">
                        {tab === "live" && isPtz && (
                            <button onClick={() => setShowPtz((v) => !v)} data-tooltip-id="mi-tip" data-tooltip-content={showPtz ? "Ocultar control PTZ" : "Mostrar control PTZ"}
                                className={cn("px-2.5 h-9 grid place-items-center rounded-full text-[11px] font-extrabold uppercase tracking-wide backdrop-blur-sm transition-colors", showPtz ? "bg-red-600/90 text-white" : "bg-black/40 text-white/80 hover:bg-black/70")}><Joystick size={16} /></button>
                        )}
                        {tab === "live" && (
                            <button onClick={() => { setTrackEdit((v) => !v); setAddOpen(false); }} data-tooltip-id="mi-tip" data-tooltip-content={trackEdit ? "Terminar edición de seguimiento" : "Editar seguimiento visual (enlaces entre cámaras)"}
                                className={cn("px-2.5 h-9 grid place-items-center rounded-full text-[11px] font-extrabold uppercase tracking-wide backdrop-blur-sm transition-colors", trackEdit ? "bg-amber-500/90 text-white" : "bg-black/40 text-white/80 hover:bg-black/70")}><Pencil size={15} /></button>
                        )}
                        {tab === "live" && (
                            <button onClick={toggleHd} data-tooltip-id="mi-tip" data-tooltip-content={hd ? "Cambiar a sub-flujo (ligero)" : "Cambiar a flujo principal (HD)"}
                                className={cn("px-2.5 h-9 grid place-items-center rounded-full text-[11px] font-extrabold uppercase tracking-wide backdrop-blur-sm transition-colors", hd ? "bg-sky-500/90 text-white" : "bg-black/40 text-white/80 hover:bg-black/70")}>{hd ? "HD" : "SD"}</button>
                        )}
                        {tab === "rec" && nvrId && cam.ch != null && (
                            <a href={`/api/nvr/playback?ch=${cam.ch}&t=${Math.floor(recLoadT)}&pre=10&dur=60&download=1&nvr=${nvrId}`} download
                                data-tooltip-id="mi-tip" data-tooltip-content="Descargar clip (60s alrededor de este instante)"
                                className="w-9 h-9 grid place-items-center rounded-full bg-black/40 hover:bg-sky-500/80 text-white/80 hover:text-white transition-colors backdrop-blur-sm"><Download size={17} /></a>
                        )}
                        <button onClick={onClose} className="w-9 h-9 grid place-items-center rounded-full bg-black/40 hover:bg-black/70 text-white/80 hover:text-white transition-colors backdrop-blur-sm"><X size={18} /></button>
                    </div>
                </div>

                {/* abajo-izq (sólo vivo) */}
                {tab === "live" && (
                    <div className="absolute bottom-0 inset-x-0 p-4 pl-20 bg-gradient-to-t from-black/70 to-transparent z-20">
                        <div className="flex items-center gap-2 flex-wrap">
                            {cam.nvrName && <span className="inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider text-white/75"><Server size={11} /> {cam.nvrName}</span>}
                            {cam.ch != null && <span className="text-[11px] font-bold text-white/55">CH {cam.ch}</span>}
                            <span className="inline-flex items-center gap-1 text-[11px] font-extrabold uppercase tracking-wider text-red-300"><Circle size={7} className="fill-red-500 text-red-500 animate-pulse" /> {ready ? (stalled ? "Reconectando…" : "En vivo") : "Conectando…"}</span>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

export default function MonitorIntrusion() {
    const [cams, setCams] = useState<IntrusionCam[]>([]);
    const [loading, setLoading] = useState(true);
    const [analyticsIds, setAnalyticsIds] = useState<Set<string>>(new Set());
    const [alarmIds, setAlarmIds] = useState<Set<string>>(new Set());
    const [geom, setGeom] = useState<Record<string, Geom>>({});
    const [dets, setDets] = useState<DetItem[]>([]);
    const [filter, setFilter] = useState<"ALL" | "ANALYTIC" | "MOTION">("ANALYTIC");
    const [alarms, setAlarms] = useState<Record<string, AlarmChip[]>>({});
    const [liveDev, setLiveDev] = useState<IntrusionCam | null>(null);
    const [q, setQ] = useState("");
    const [calibrateDev, setCalibrateDev] = useState<IntrusionCam | null>(null);
    const [alarmDev, setAlarmDev] = useState<IntrusionCam | null>(null);
    const [detail, setDetail] = useState<any>(null);
    const [showHistory, setShowHistory] = useState(false);
    const [showEvidence, setShowEvidence] = useState(false);

    // Reconstruir alarmas sin aceptar al cargar la página (overlays persistentes)
    useEffect(() => {
        getActiveAlarms().then((rows) => {
            const map: Record<string, AlarmChip[]> = {};
            for (const r of rows) { (map[r.deviceId] ||= []).push({ id: r.id, type: r.type, label: (META[r.type] || META.OTHER).label, ts: r.ts }); }
            for (const k of Object.keys(map)) map[k] = map[k].slice(0, 5);
            setAlarms(map);
        }).catch(() => { });
    }, []);

    useEffect(() => {
        setLoading(true);
        Promise.all([getIntrusionCameras(), getDevicesWithAnalytics()])
            .then(([c, ids]) => {
                setCams(c || []);
                setAlarmIds(new Set((c || []).filter((x) => (x as any).alarmOk).map((x) => x.id)));
                const set = new Set(ids || []);
                setAnalyticsIds(set);
                // geometría de TODAS las cámaras para dibujarlas SIEMPRE en la grilla, en tandas
                // (prioriza las que ya sabemos con analítica) y colorea el icono según lo hallado.
                const all = (c || []).map((x) => x.id);
                const withA = all.filter((id) => set.has(id));
                const rest = all.filter((id) => !set.has(id));
                const ordered = [...withA, ...rest];
                (async () => {
                    for (let i = 0; i < ordered.length; i += 12) {
                        try {
                            const g = await getAnalyticsGeometryBatch(ordered.slice(i, i + 12));
                            if (Object.keys(g).length) {
                                setGeom((prev) => ({ ...prev, ...g }));
                                setAnalyticsIds((prev) => {
                                    const n = new Set(prev);
                                    for (const id of Object.keys(g)) {
                                        const gg = g[id];
                                        if (gg && gg.supported && ((gg.line?.length || 0) + (gg.field?.length || 0) > 0)) n.add(id);
                                    }
                                    return n;
                                });
                            }
                        } catch { }
                    }
                })();
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
                const item: DetItem = { id: d.id, deviceId: d.deviceId, deviceName: d.deviceName, type: d.type, eventType: d.eventType, snapshotPath: d.snapshotPath || null, timestamp: d.timestamp };
                setDets((prev) => [item, ...prev.filter((x) => x.id !== d.id)].slice(0, 60));
                if (d.deviceId && d.type !== "MOTION") { // alarma que se apila sobre el canal hasta que el operador la acepte
                    const chip: AlarmChip = { id: d.id, type: d.type, label: (META[d.type] || META.OTHER).label, ts: d.timestamp };
                    setAlarms((a) => ({ ...a, [d.deviceId]: [chip, ...(a[d.deviceId] || []).filter((x) => x.id !== d.id)].slice(0, 5) }));
                }
            });
            s.on("detection_snapshot", (d: any) => { setDets((prev) => prev.map((x) => x.id === d.id ? { ...x, snapshotPath: d.snapshotPath } : x)); });
        } catch { }
        return () => { try { s && s.disconnect(); } catch { } };
    }, [filter]);

    const lastByDev = useMemo(() => {
        const map: Record<string, DetItem> = {};
        for (const d of dets) { if (d.deviceId && !map[d.deviceId]) map[d.deviceId] = d; }
        return map;
    }, [dets]);
    const camById = useMemo(() => { const mp: Record<string, IntrusionCam> = {}; cams.forEach((c) => (mp[c.id] = c)); return mp; }, [cams]);
    const [attendingIds, setAttendingIds] = useState<Set<string>>(new Set());
    useEffect(() => { getAttendingIds().then((ids) => setAttendingIds(new Set(ids || []))).catch(() => { }); }, []);
    const resolveAttending = (id: string) => { setAttendingIds((s) => { const n = new Set(s); n.delete(id); return n; }); setAttending(id, false).catch(() => { }); };
    const ackAlarm = (id: string, kind: "real" | "false" = "real") => {
        ackAlarms(id, kind).catch(() => { });
        setAlarms((a) => { const n = { ...a }; delete n[id]; return n; });
        if (kind === "real") { setAttendingIds((s) => new Set(s).add(id)); setAttending(id, true).catch(() => { }); }
    };
    const [liveTab, setLiveTab] = useState<"live" | "rec" | "evi">("live");
    const [prevCam, setPrevCam] = useState<IntrusionCam | null>(null);
    const openFicha = (c: IntrusionCam) => setDetail(lastByDev[c.id] ?? { id: `live-${c.id}`, deviceId: c.id, deviceName: c.name, type: "OTHER", eventType: null, snapshotPath: null, timestamp: new Date().toISOString() });
    const trackStatus = useMemo(() => { const now = Date.now(); const o: Record<string, { recent: boolean; alarm: boolean }> = {}; cams.forEach((c) => { const l = lastByDev[c.id]; o[c.id] = { recent: !!(l && now - new Date(l.timestamp).getTime() < 15 * 60 * 1000), alarm: !!(alarms[c.id]?.length) }; }); return o; }, [cams, lastByDev, alarms]);
    // Aceptar alarma abre la MISMA ficha del sidebar (con los botones real/falsa adentro).
    const openAlarmFicha = (c: IntrusionCam) => {
        const a = alarms[c.id]?.[0];
        setDetail(a ? { id: a.id, deviceId: c.id, deviceName: c.name, type: a.type, eventType: null, snapshotPath: null, timestamp: a.ts }
                    : (lastByDev[c.id] ?? { id: `live-${c.id}`, deviceId: c.id, deviceName: c.name, type: "OTHER", eventType: null, snapshotPath: null, timestamp: new Date().toISOString() }));
    };
    const openLive = (c: IntrusionCam) => { setLiveTab("live"); setPrevCam(null); setLiveDev(c); };
    const openClip = (c: IntrusionCam) => { setLiveTab("rec"); setLiveDev(c); };

    const shown = useMemo(() => {
        const term = q.trim().toLowerCase();
        const score = (d: IntrusionCam) => {
            if (alarms[d.id]?.length) return 9_000_000 + new Date(alarms[d.id][0].ts).getTime() / 1e6; // alarma sin aceptar: siempre arriba
            const last = lastByDev[d.id];
            const recent = last ? Date.now() - new Date(last.timestamp).getTime() : Infinity;
            if (recent < 60_000) return 3_000_000 - recent / 1000;
            if (analyticsIds.has(d.id)) return 1_000;
            return 0;
        };
        let list = [...cams];
        if (term) list = list.filter((c) => c.name.toLowerCase().includes(term) || (c.nvrName || "").toLowerCase().includes(term));
        return list.sort((a, b) => score(b) - score(a) || String(a.name).localeCompare(String(b.name)));
    }, [cams, analyticsIds, lastByDev, q, alarms]);

    const shownDets = filter === "MOTION" ? dets.filter((d) => d.type === "MOTION") : filter === "ANALYTIC" ? dets.filter((d) => d.type !== "MOTION") : dets;
    const [visN, setVisN] = useState(30); // render progresivo (rendimiento con muchas detecciones)
    useEffect(() => { setVisN(30); }, [filter]);
    const onDetsScroll = (e: React.UIEvent<HTMLDivElement>) => { const el = e.currentTarget; if (el.scrollTop + el.clientHeight >= el.scrollHeight - 240) setVisN((n) => (n < shownDets.length ? n + 30 : n)); };
    // fila superior fija: los canales que suben al tope (actividad reciente) siempre visibles
    const topRow = shown.slice(0, 3);
    const restRow = shown.slice(3);

    return (
        <div className="h-full flex flex-col">
            <style jsx global>{`
                .sk { background: #171717; position: relative; overflow: hidden; }
                .vsheen::after { content: ""; position: absolute; inset: 0; transform: translateX(-100%); background: linear-gradient(90deg, transparent, rgba(255,255,255,0.10), transparent); animation: skshimmer 1.3s infinite; }
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
                    <button onClick={() => setShowHistory(true)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-[11px] font-bold text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"><History size={13} /> Historial</button>
                    <button onClick={() => setShowEvidence(true)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-[11px] font-bold text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"><Camera size={13} /> Evidencia</button>
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

                    {loading ? (
                        <div className="grid grid-cols-2 xl:grid-cols-3 gap-4">
                            {Array.from({ length: 9 }).map((_, i) => <div key={i} className="sk rounded-2xl aspect-video" />)}
                        </div>
                    ) : shown.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
                            <Camera size={28} className="opacity-30" /><span className="text-sm">Sin canales</span>
                        </div>
                    ) : (
                        <>
                            {topRow.length > 0 && (
                                <div className="sticky -top-5 z-20 -mx-5 -mt-5 px-5 pt-5 pb-4 mb-4 bg-background/95 supports-[backdrop-filter]:bg-background/80 backdrop-blur-md border-b border-border/60">
                                    <div className="flex items-center gap-1.5 mb-2 text-[10px] font-bold uppercase tracking-widest text-red-300/80"><Radar size={11} /> Actividad reciente</div>
                                    <div className="grid grid-cols-2 xl:grid-cols-3 gap-4">
                                        {topRow.map((cam) => (
                                            <CamTile key={cam.id} cam={cam} alarms={alarms[cam.id]} last={lastByDev[cam.id]} geom={geom[cam.id]} hasAnalytics={analyticsIds.has(cam.id)} alarmActive={cam.alarmOk || alarmIds.has(cam.id)} onFicha={openFicha} onLive={openLive} onClip={openClip}
                                                onCalibrate={setCalibrateDev} onAlarm={setAlarmDev} onAck={(c) => openAlarmFicha(c)} attending={attendingIds.has(cam.id)} onResolve={resolveAttending} />
                                        ))}
                                    </div>
                                </div>
                            )}
                            {restRow.length > 0 && (
                                <div className="grid grid-cols-2 xl:grid-cols-3 gap-4">
                                    {restRow.map((cam) => (
                                        <CamTile key={cam.id} cam={cam} alarms={alarms[cam.id]} last={lastByDev[cam.id]} geom={geom[cam.id]} hasAnalytics={analyticsIds.has(cam.id)} alarmActive={cam.alarmOk || alarmIds.has(cam.id)} onFicha={openFicha} onLive={openLive} onClip={openClip}
                                            onCalibrate={setCalibrateDev} onAlarm={setAlarmDev} onAck={(c) => openAlarmFicha(c)} attending={attendingIds.has(cam.id)} onResolve={resolveAttending} />
                                    ))}
                                </div>
                            )}
                        </>
                    )}
                </div>

                {/* Sidebar detecciones */}
                <div className="flex flex-col overflow-hidden bg-card/30">
                    <div className="shrink-0 px-4 py-3.5 border-b border-border flex items-center gap-2">
                        <span className="grid h-7 w-7 place-items-center rounded-lg bg-red-500/15"><Activity size={14} className="text-red-500" /></span>
                        <span className="text-xs font-bold uppercase tracking-wider">Detecciones</span>
                        <span className="ml-auto px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-500/15 text-red-300 border border-red-500/30 tabular-nums">{shownDets.length}</span>
                    </div>
                    <div className="flex-1 overflow-y-auto custom-scrollbar p-2.5" onScroll={onDetsScroll}>
                        {shownDets.length === 0 ? (
                            <div className="flex flex-col items-center justify-center h-40 text-muted-foreground gap-2">
                                <ShieldAlert size={22} className="opacity-30" /><span className="text-[12px]">Sin detecciones recientes</span>
                            </div>
                        ) : (
                            <>
                                <div className="grid grid-cols-2 xl:grid-cols-3 gap-2">
                                    {shownDets.slice(0, visN).map((d) => {
                                        const m = META[d.type] || META.OTHER;
                                        const when = new Date(d.timestamp).toLocaleString("es-UY", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
                                        return (
                                            <button key={d.id} onClick={() => setDetail(d)}
                                                data-tooltip-id="mi-tip" data-tooltip-content={`${m.label} · ${d.deviceName || "Cámara"} · ${when}`}
                                                className="group/dt relative aspect-video rounded-xl overflow-hidden bg-black ring-1 ring-white/10 hover:ring-2 hover:ring-red-400/60 hover:z-10 hover:scale-[1.03] transition-all duration-150 text-left shadow-sm">
                                                <DetThumb d={d} fill />
                                                <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/10 to-black/20 pointer-events-none" />
                                                <span className={cn("absolute top-1 left-1 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[8px] font-extrabold uppercase tracking-wide backdrop-blur-sm", m.cls)}>
                                                    <m.Icon size={8} /> {m.label}
                                                </span>
                                                {/* pie permanente */}
                                                <div className="absolute bottom-1 inset-x-1.5 pointer-events-none group-hover/dt:opacity-0 transition-opacity">
                                                    <div className="text-[9.5px] font-bold text-white leading-tight truncate drop-shadow">{d.deviceName || "Cámara"}</div>
                                                    <div className="text-[8px] font-semibold text-white/60 tabular-nums">{ago(d.timestamp)}</div>
                                                </div>
                                                {/* overlay al pasar el mouse: datos del evento */}
                                                <div className="absolute inset-0 opacity-0 group-hover/dt:opacity-100 transition-opacity bg-black/72 backdrop-blur-[2px] p-2 flex flex-col justify-end gap-0.5 pointer-events-none">
                                                    <div className="inline-flex items-center gap-1 text-[9px] font-extrabold uppercase tracking-wide text-red-300"><m.Icon size={9} /> {m.label}</div>
                                                    <div className="text-[11px] font-bold text-white leading-tight truncate">{d.deviceName || "Cámara"}</div>
                                                    <div className="text-[9px] font-semibold text-white/80 tabular-nums leading-tight">{when}</div>
                                                    <div className="text-[8.5px] text-white/55 tabular-nums">hace {ago(d.timestamp)}</div>
                                                </div>
                                            </button>
                                        );
                                    })}
                                </div>
                                {visN < shownDets.length && (
                                    <div className="flex items-center justify-center gap-2 py-3 text-[11px] text-white/45">
                                        <Loader2 size={13} className="animate-spin" /> Cargando más… ({visN}/{shownDets.length})
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                </div>
            </div>

            {calibrateDev && <LineZoneCalibrator device={calibrateDev} onClose={() => {
                const id = calibrateDev.id; setCalibrateDev(null);
                // refrescar geometría de esa cámara al cerrar
                getAnalyticsGeometryBatch([id]).then((g) => setGeom((prev) => ({ ...prev, ...g }))).catch(() => { });
                setAnalyticsIds((s) => new Set(s).add(id));
            }} />}
            {alarmDev && <AlarmDialog cam={alarmDev} onClose={() => setAlarmDev(null)} onStatus={(id, ok) => setAlarmIds((prev) => { const s = new Set(prev); if (ok) s.add(id); else s.delete(id); return s; })} />}
            {detail && <DetailDialog det={detail} cam={detail?.deviceId ? camById[detail.deviceId] : undefined} geom={detail?.deviceId ? geom[detail.deviceId] : undefined} onClose={() => setDetail(null)}
                hasAlarm={!!(detail?.deviceId && alarms[detail.deviceId]?.length)} onResolveAlarm={(id, k) => { ackAlarm(id, k); const nx = Object.keys(alarms).find((d) => d !== id && alarms[d]?.length); if (nx && camById[nx]) openAlarmFicha(camById[nx]); else setDetail(null); }} />}
            {showHistory && <HistoryModal onClose={() => setShowHistory(false)} onOpen={(d) => setDetail(d)} />}
            {showEvidence && <EvidenceGallery cams={cams} onClose={() => setShowEvidence(false)} onOpen={(d) => setDetail(d)} />}
            {liveDev && <LiveModal key={liveDev.id} cam={liveDev} cams={cams} camStatus={trackStatus} initialTab={liveTab} fromCam={prevCam} geom={geom[liveDev.id]} onClose={() => { setLiveDev(null); setPrevCam(null); }} onOpenEvent={(d) => setDetail(d)} onSwitchCam={(c) => { setLiveTab("live"); setPrevCam(liveDev); setLiveDev(c); }} onDismissFrom={() => setPrevCam(null)} />}
            <RTooltip id="mi-tip" place="top" delayShow={100} className="!z-[9999] !rounded-md !bg-zinc-900 !text-white !text-[11px] !font-semibold !px-2 !py-1 !border !border-white/10 !shadow-xl !opacity-100" />
        </div>
    );
}
