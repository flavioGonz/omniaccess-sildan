"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";
import { getSocketUrl } from "@/lib/socket-config";
import { getIntrusionCameras, getRecentDetections, getDevicesWithAnalytics, getAnalyticsGeometryBatch, getDetectionHistory, getActiveAlarms, ackAlarms, getAttendingIds, setAttending, reclasificarComoFalsa, getVisualTrackLinks, setVisualTrackLinks, type TrackLink, type DetItem, type IntrusionCam, type DetHistItem } from "@/app/actions/detections";
import { Radar, ShieldAlert, Activity, LogIn, LogOut, Camera, Circle, BellRing, Loader2, Check, PencilRuler, X, Server, Wifi, Search, RefreshCcw, History, ImageOff, ChevronLeft, ChevronRight, FileText, Video, Film, MoreVertical, Clock, Download, ChevronUp, ChevronDown, ZoomIn, ZoomOut, Home, Gauge, Move, Joystick, Rewind, FastForward, Gauge as GaugeIco, Calendar as CalIco, Crosshair, Plus, Save, Pencil, Trash2, Car, User, Eye } from "lucide-react";
import { cn } from "@/lib/utils";
import { LineZoneCalibrator } from "@/components/LineZoneCalibrator";
import { PtzControls, ptzAngleToDir } from "@/components/PtzControls";
import { PlaybackTimeline } from "@/components/PlaybackTimeline";
import { Scrub } from "@/components/Scrub";
import { motion, AnimatePresence } from "framer-motion";
import { Tooltip as RTooltip } from "react-tooltip";
import { CanalEnAlarma } from "@/components/intrusion/CanalEnAlarma";
import { META_DETECCION, GeomOverlay } from "@/components/intrusion/comun";
import "react-tooltip/dist/react-tooltip.css";
import { LiveModal } from "@/components/intrusion/LiveModal";
import { FichaDeteccion as DetailDialog } from "@/components/intrusion/FichaDeteccion";
import { HorarioArmadoDialog, ResumenArmado, type HorariosCamara } from "@/components/intrusion/HorarioArmado";

type Geom = { line: { x: number; y: number }[]; field: { x: number; y: number }[] };
type AlarmChip = { id: string; type: string; label: string; ts: string };

/**
 * La miniatura en bucle de cada detección NO usa la ventana configurable de Ajustes: se
 * transcodifica una por cada tarjeta de la grilla, y con "60 s después" cada una pasaría
 * a ser un minuto de ffmpeg. Corta y fija a propósito; la ventana larga es la del clip
 * que se abre al tocar la detección.
 */
const MINIATURA_ANTES_SEG = 3;
const MINIATURA_DUR_SEG = 14;

const META = META_DETECCION;

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

function Dots() {
    return (
        <span className="inline-flex ml-0.5">
            <span className="inline-block animate-bounce" style={{ animationDelay: "0ms" }}>.</span>
            <span className="inline-block animate-bounce" style={{ animationDelay: "150ms" }}>.</span>
            <span className="inline-block animate-bounce" style={{ animationDelay: "300ms" }}>.</span>
        </span>
    );
}

function CamTile({ cam, alarms, last, geom, hasAnalytics, alarmActive, attending, onCalibrate, onAlarm, onAck, onResolve, onFicha, onLive, onClip, horarios, onHorario }: {
    cam: IntrusionCam; alarms?: AlarmChip[]; last?: DetItem; geom?: Geom; hasAnalytics: boolean; alarmActive?: boolean; attending?: boolean;
    onCalibrate: (c: IntrusionCam) => void; onAlarm: (c: IntrusionCam) => void; onAck: (c: IntrusionCam) => void; onResolve?: (id: string) => void;
    onFicha: (c: IntrusionCam) => void; onLive: (c: IntrusionCam) => void; onClip: (c: IntrusionCam) => void;
    /** El horario de armado de cada regla, leído de la cámara; se muestra debajo del nombre. */
    horarios?: HorariosCamara | null; onHorario?: (c: IntrusionCam) => void;
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
                (active || attending) ? "" : "ring-1 ring-white/[0.06] hover:ring-white/25")}>
            {/* El overlay de alarma es la misma pieza que usa la pantalla del centro de monitoreo
                (components/intrusion/CanalEnAlarma): acá va con el botón "Ver evento". */}
            {(active || attending) && (
                <CanalEnAlarma
                    estado={active ? "pendiente" : "confirmada"}
                    tipo={active ? alarms![0].label : m ? m.label : "Intrusión"}
                    desde={active ? alarms![0].ts : last ? last.timestamp : null}
                    eventos={active ? alarms!.length : 1}
                    camara={`${cam.name}${cam.nvrName ? ` · ${cam.nvrName}` : ""}${cam.ch != null ? ` · CH ${cam.ch}` : ""}`}
                    accion={
                        <button onClick={(e) => { e.stopPropagation(); onAck(cam); }} data-tooltip-id="mi-tip"
                            data-tooltip-content={active ? "Abre la ficha del evento: desde ahí se confirma como real o se marca como falsa alarma" : "Abre la ficha del evento: desde ahí se acepta como resuelta o se marca como falsa alarma"}
                            className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white text-red-700 text-[12px] font-extrabold uppercase tracking-wide shadow-[0_8px_24px_rgba(0,0,0,.45)] hover:bg-red-50 active:scale-95 transition">
                            <Eye size={15} /> Ver evento
                        </button>
                    } />
            )}
            {!loaded && <div className="absolute inset-0 sk" />}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src} alt={cam.name} loading="lazy" decoding="async" onLoad={() => setLoaded(true)}
                onError={(e) => { (e.currentTarget as HTMLImageElement).style.opacity = "0.12"; setLoaded(true); }}
                className={cn("absolute inset-0 w-full h-full object-cover transition-opacity duration-300", loaded ? "opacity-100" : "opacity-0")} />
            <GeomOverlay geom={geom} />

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
                    {/* El horario de armado de CADA regla, siempre a la vista: una perimetral "activa"
                        que está desarmada a esta hora no avisa, y eso antes no se veía desde acá. */}
                    {hasAnalytics && horarios !== undefined && (
                        <button type="button" onClick={(e) => { e.stopPropagation(); onHorario?.(cam); }} className="mt-1 block text-left pointer-events-auto hover:underline decoration-white/40" data-tooltip-id="mi-tip" data-tooltip-content="Horario de armado de cada regla · clic para cambiarlo">
                            <ResumenArmado h={horarios} compacto />
                        </button>
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
                            { Icon: Clock, label: "Horario de armado", fn: () => onHorario?.(cam), hl: false },
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

function EvidencePlayModal({ d, onClose }: { d: DetHistItem; onClose: () => void }) {
    const [nvr, setNvr] = useState<string | null | undefined>(undefined);
    useEffect(() => { let on = true; if (!d.deviceId) { setNvr(null); return; } fetch(`/api/nvr/channel?deviceId=${d.deviceId}`, { cache: "no-store" }).then((r) => r.json()).then((j) => { if (on) setNvr(j && j.nvr ? String(j.nvr) : null); }).catch(() => { if (on) setNvr(null); }); return () => { on = false; }; }, [d.deviceId]);
    const ms = Math.floor(new Date(d.timestamp).getTime());
    // Sin pre/dur: la ventana la decide Ajustes → Video del evento (lib/ventana-playback).
    const url = nvr && d.ch != null ? `/api/nvr/playback?ch=${d.ch}&t=${ms}&nvr=${nvr}` : null;
    const snap = d.snapshotPath || (d.deviceId ? `/api/snapshot/${d.deviceId}?t=${d.id}` : undefined);
    const when = new Date(d.timestamp).toLocaleString("es-UY", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    const m = META[d.type] || META.OTHER;
    return (
        <div className="fixed inset-0 z-[2300] bg-black/92 backdrop-blur-sm grid place-items-center p-4 sm:p-8" onClick={onClose}>
            <div className="relative w-full max-w-5xl aspect-video rounded-2xl overflow-hidden bg-black shadow-2xl" onClick={(e) => e.stopPropagation()}>
                {url ? (
                    // eslint-disable-next-line jsx-a11y/media-has-caption
                    <video src={url} autoPlay controls playsInline poster={snap} className="absolute inset-0 w-full h-full object-contain" />
                ) : nvr === undefined ? (
                    <div className="absolute inset-0 grid place-items-center text-white/60"><Loader2 className="animate-spin" size={26} /></div>
                ) : (
                    <div className="absolute inset-0 grid place-items-center text-center text-white/50 text-sm px-6">Sin grabación disponible para este evento<br />(la cámara no tiene NVR/canal mapeado).</div>
                )}
                <div className="absolute top-0 inset-x-0 p-4 flex items-start gap-3 bg-gradient-to-b from-black/70 to-transparent pointer-events-none">
                    <span className={cn("grid h-10 w-10 place-items-center rounded-xl backdrop-blur-md ring-1 ring-white/10 shrink-0", m.cls)}><m.Icon size={19} /></span>
                    <div className="min-w-0">
                        <div className="text-[15px] font-extrabold text-white truncate drop-shadow">{d.deviceName || "Cámara"} · {m.label}</div>
                        <div className="text-[12px] text-white/70 truncate">{(d.nvrName ? d.nvrName + (d.ch != null ? ` · CH ${d.ch}` : "") + " · " : "") + when}</div>
                    </div>
                    <button onClick={onClose} className="pointer-events-auto ml-auto w-10 h-10 grid place-items-center rounded-full bg-black/40 hover:bg-black/70 text-white/80 hover:text-white backdrop-blur-sm shrink-0"><X size={20} /></button>
                </div>
            </div>
        </div>
    );
}

function EvidenceGallery({ cams, onClose, onOpen, onPlay }: { cams: IntrusionCam[]; onClose: () => void; onOpen: (d: DetHistItem) => void; onPlay?: (d: DetHistItem) => void }) {
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
    const [qApplied, setQApplied] = useState("");
    const size = 48;
    useEffect(() => { setPage(0); setItems([]); setMore(true); }, [type, dev, from, to, ack]);
    useEffect(() => { const t = setTimeout(() => setQApplied(q), 220); return () => clearTimeout(t); }, [q]);
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
    const shown = useMemo(() => { const term = qApplied.trim().toLowerCase(); return term ? items.filter((d) => (d.deviceName || "").toLowerCase().includes(term) || (d.nvrName || "").toLowerCase().includes(term)) : items; }, [items, qApplied]);
    const TF = [
        { k: "ANALYTIC", label: "Intrusión+", Icon: ShieldAlert }, { k: "INTRUSION", label: "Intrusión", Icon: ShieldAlert }, { k: "LINECROSS", label: "Línea", Icon: Radar }, { k: "MOTION", label: "Movimiento", Icon: Activity }, { k: "ALL", label: "Todo", Icon: Camera },
    ] as const;
    const nActive = (q ? 1 : 0) + (dev ? 1 : 0) + (type !== "ANALYTIC" ? 1 : 0) + (ack !== "all" ? 1 : 0) + ((from || to) ? 1 : 0);
    const clearAll = () => { setQ(""); setDev(""); setType("ANALYTIC"); setAck("all"); setFrom(""); setTo(""); };
    const stats = useMemo(() => { const by: Record<string, number> = {}; let pend = 0, done = 0; for (const d of items) { by[d.type] = (by[d.type] || 0) + 1; if (d.acknowledged) done++; else pend++; } return { by, pend, done }; }, [items]);
    const [hoverId, setHoverId] = useState<string | null>(null);
    const [playId, setPlayId] = useState<string | null>(null);
    const [ready, setReady] = useState(false);
    const [camOpen, setCamOpen] = useState(false);
    const hoverTimer = useRef<any>(null);
    const nvrRef = useRef<Record<string, string | null>>({});
    const [, setNvrTick] = useState(0);
    const resolveNvr = (deviceId: string) => { if (deviceId in nvrRef.current) return; fetch(`/api/nvr/channel?deviceId=${deviceId}`, { cache: "no-store" }).then((r) => r.json()).then((j) => { nvrRef.current[deviceId] = j && j.nvr ? String(j.nvr) : null; setNvrTick((t) => t + 1); }).catch(() => { nvrRef.current[deviceId] = null; setNvrTick((t) => t + 1); }); };
    const onCardEnter = (d: DetHistItem) => { clearTimeout(hoverTimer.current); setHoverId(d.id); setReady(false); if (d.deviceId) resolveNvr(d.deviceId); hoverTimer.current = setTimeout(() => setPlayId(d.id), 3000); };
    const onCardLeave = () => { clearTimeout(hoverTimer.current); setHoverId(null); setPlayId(null); setReady(false); };
    const geomRef = useRef<Record<string, Geom>>({});
    const [, setGeomTick] = useState(0);
    useEffect(() => { const ids = [...new Set(items.map((d) => d.deviceId).filter(Boolean))] as string[]; const missing = ids.filter((id) => !(id in geomRef.current)); if (!missing.length) return; getAnalyticsGeometryBatch(missing).then((g) => { geomRef.current = { ...geomRef.current, ...g }; setGeomTick((t) => t + 1); }).catch(() => { }); }, [items]);
    const inp = "w-full h-10 px-3 rounded-xl bg-white/5 ring-1 ring-white/10 text-[13px] text-white placeholder:text-white/35 focus:outline-none focus:ring-red-400/60 [color-scheme:dark]";
    const Block = ({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) => (
        <div className="rounded-2xl bg-white/[0.04] ring-1 ring-white/10 p-3.5">
            <div className="flex items-center gap-2 mb-2.5"><span className="grid h-7 w-7 place-items-center rounded-lg bg-red-500/15 text-red-400">{icon}</span><span className="text-[11px] font-extrabold uppercase tracking-wide text-white/45">{title}</span></div>
            {children}
        </div>
    );
    return (
        <div className="fixed inset-0 z-[2090] bg-neutral-950/96 backdrop-blur-sm flex" onClick={onClose}>
            {/* SIDEBAR IZQUIERDA — filtros */}
            <aside onClick={(e) => e.stopPropagation()} className="hidden md:flex w-60 shrink-0 h-full bg-neutral-900/95 text-white border-r border-white/10 flex-col">
                <div className="px-4 py-4 flex items-center gap-2 border-b border-white/10">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="text-red-400"><path d="M3 5h18M6 12h12M10 19h4" /></svg>
                    <span className="text-[15px] font-extrabold">Filtros</span>
                    {nActive > 0 && <span className="grid place-items-center min-w-[20px] h-5 px-1.5 rounded-full bg-red-500 text-white text-[11px] font-extrabold">{nActive}</span>}
                </div>
                <div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-3">
                    <Block icon={<Search size={15} />} title="Buscar"><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cámara o NVR…" className={inp} /></Block>
                    <Block icon={<ShieldAlert size={15} />} title="Tipo de evento"><div className="grid grid-cols-2 gap-1.5">{TF.map((f) => (<button key={f.k} onClick={() => setType(f.k)} className={cn("inline-flex items-center gap-1.5 px-2.5 py-2 rounded-xl text-[12px] font-bold transition-colors", type === f.k ? "bg-red-500/20 text-red-300 ring-1 ring-red-500/40" : "bg-white/5 text-white/55 hover:bg-white/10")}><f.Icon size={13} /> {f.label}</button>))}</div></Block>
                    <Block icon={<Camera size={15} />} title="Cámara">
                        <button type="button" onClick={() => setCamOpen((v) => !v)} className="w-full h-10 px-3 rounded-xl bg-white/5 ring-1 ring-white/10 text-[13px] text-white flex items-center justify-between hover:bg-white/10 transition">
                            <span className="truncate">{dev ? (cams.find((c) => c.id === dev)?.name || "Cámara") : "Todas las cámaras"}</span>
                            <ChevronDown size={15} className={cn("text-white/50 transition-transform shrink-0", camOpen && "rotate-180")} />
                        </button>
                        {camOpen && (
                            <div className="mt-1.5 max-h-56 overflow-y-auto custom-scrollbar rounded-xl bg-neutral-800 ring-1 ring-white/15 shadow-xl divide-y divide-white/5">
                                <button onClick={() => { setDev(""); setCamOpen(false); }} className={cn("w-full text-left px-3 py-2 text-[13px] transition hover:bg-white/10", dev === "" ? "text-red-300 font-bold" : "text-white/80")}>Todas las cámaras</button>
                                {cams.map((cc) => (<button key={cc.id} onClick={() => { setDev(cc.id); setCamOpen(false); }} className={cn("w-full text-left px-3 py-2 text-[13px] truncate transition hover:bg-white/10", dev === cc.id ? "text-red-300 font-bold" : "text-white/80")}>{cc.name}</button>))}
                            </div>
                        )}
                    </Block>
                    <Block icon={<Check size={15} />} title="Estado"><div className="flex gap-1.5">{([["all", "Todas"], ["pending", "Pendientes"], ["done", "Revisadas"]] as const).map(([k, lbl]) => (<button key={k} onClick={() => setAck(k)} className={cn("flex-1 px-1.5 py-2 rounded-xl text-[11px] font-bold transition-colors", ack === k ? "bg-red-500/20 text-red-300 ring-1 ring-red-500/40" : "bg-white/5 text-white/55 hover:bg-white/10")}>{lbl}</button>))}</div></Block>
                    <Block icon={<CalIco size={15} />} title="Rango de fechas"><div className="space-y-2"><label className="block"><span className="text-[11px] font-bold text-white/40">Desde</span><input type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} className={cn(inp, "px-2.5 text-[12px]")} /></label><label className="block"><span className="text-[11px] font-bold text-white/40">Hasta</span><input type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} className={cn(inp, "px-2.5 text-[12px]")} /></label></div></Block>
                </div>
                <div className="px-4 py-3 border-t border-white/10 flex items-center gap-2"><span className="text-[12px] font-bold text-white/50 tabular-nums">{total} eventos</span>{nActive > 0 && <button onClick={clearAll} className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-[12px] font-bold text-white/70 transition">Limpiar</button>}</div>
            </aside>

            {/* CENTRO — grilla */}
            <div onClick={(e) => e.stopPropagation()} className="flex-1 min-w-0 h-full flex flex-col">
                <div className="px-5 py-3.5 flex items-center gap-3 border-b border-white/10">
                    <span className="grid h-8 w-8 place-items-center rounded-lg bg-red-500/15"><Camera size={16} className="text-red-400" /></span>
                    <span className="text-sm font-bold text-white">Evidencia</span>
                    <span className="text-[12px] text-white/45 tabular-nums">· {shown.length} / {total}</span>
                    {loading && <Loader2 size={15} className="animate-spin text-white/50" />}
                    <button onClick={onClose} className="ml-auto w-9 h-9 grid place-items-center rounded-full bg-white/5 hover:bg-white/15 text-white/70 hover:text-white transition"><X size={18} /></button>
                </div>
                <div className="flex-1 overflow-y-auto custom-scrollbar p-4" onScroll={onScroll}>
                    {shown.length === 0 && !loading ? (
                        <div className="h-full grid place-items-center text-white/40 text-sm">Sin evidencia para este filtro.</div>
                    ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                            {shown.map((d) => {
                                const m = META[d.type] || META.OTHER;
                                const href = d.snapshotPath || (d.deviceId ? `/api/snapshot/${d.deviceId}?t=${d.id}` : null);
                                const when = new Date(d.timestamp).toLocaleString("es-UY", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
                                return (
                                    <button key={d.id} onClick={() => onOpen(d)} onMouseEnter={() => onCardEnter(d)} onMouseLeave={onCardLeave} className="group relative aspect-video rounded-2xl overflow-hidden ring-1 ring-white/10 hover:ring-2 hover:ring-red-400/60 hover:z-10 hover:scale-[1.02] transition-all duration-150 bg-neutral-900 text-left shadow-lg">
                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                        {href ? <img src={href} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover" /> : <div className="absolute inset-0 grid place-items-center text-white/20"><Camera size={22} /></div>}
                                        {playId === d.id && d.deviceId && nvrRef.current[d.deviceId] && d.ch != null && (
                                            // eslint-disable-next-line jsx-a11y/media-has-caption
                                            <video autoPlay muted loop playsInline onPlaying={() => setReady(true)} onLoadedData={() => setReady(true)} src={`/api/nvr/playback?ch=${d.ch}&t=${Math.floor(new Date(d.timestamp).getTime())}&pre=${MINIATURA_ANTES_SEG}&dur=${MINIATURA_DUR_SEG}&nvr=${nvrRef.current[d.deviceId]}`} className="absolute inset-0 w-full h-full object-cover z-[1] bg-black" />
                                        )}
                                        <div className="absolute inset-x-0 top-0 h-16 bg-gradient-to-b from-black/70 to-transparent pointer-events-none" />
                                        <div className="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/85 via-black/25 to-transparent pointer-events-none" />
                                        {d.deviceId && geomRef.current[d.deviceId] && <div className="absolute inset-0 z-[1] pointer-events-none"><GeomOverlay geom={geomRef.current[d.deviceId]} /></div>}
                                        {playId === d.id && !ready && (
                                            <div className="absolute inset-0 z-[2] grid place-items-center pointer-events-none">
                                                <div className="absolute inset-0 sk opacity-50" />
                                                <span className="relative inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-black/55 backdrop-blur-sm text-white text-[12px] font-bold shadow"><Loader2 size={14} className="animate-spin" /> Cargando evento<Dots /></span>
                                            </div>
                                        )}
                                        {(() => { const st = !d.acknowledged ? { t: "Pendiente", c: "bg-amber-500/90" } : d.ackKind === "false" ? { t: "Falsa", c: "bg-slate-500/90" } : { t: "Real", c: "bg-red-600/90" }; return <span className={cn("absolute top-2.5 right-2.5 z-[1] inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-extrabold uppercase tracking-wide text-white shadow backdrop-blur-sm", st.c)}>{st.t}</span>; })()}
                                        <div className="absolute top-2.5 left-3 right-14"><div className="text-[13px] font-extrabold text-white leading-tight truncate drop-shadow">{d.deviceName || "Cámara"}</div><div className="text-[11px] font-semibold text-white/80 tabular-nums drop-shadow truncate">{(d.nvrName ? d.nvrName + (d.ch != null ? " · CH " + d.ch : "") + " · " : "") + when}</div></div>
                                        <div className="absolute bottom-2.5 left-3 flex items-center gap-1.5">
                                            <span className={cn("inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-extrabold uppercase tracking-wide backdrop-blur-sm shadow", m.cls)}><m.Icon size={13} /> {m.label}</span>
                                            {d.label && <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-extrabold uppercase tracking-wide bg-black/55 backdrop-blur-sm text-white shadow ring-1 ring-white/15">{d.label === "vehicle" ? <><Car size={13} /> Auto</> : <><User size={13} /> Persona</>}</span>}
                                        </div>
                                        <span className="absolute bottom-2.5 right-3 inline-flex items-center px-2 py-1 rounded-lg bg-black/55 backdrop-blur-sm text-[11px] font-bold text-white/90 tabular-nums">hace {ago(d.timestamp)}</span>
                                    </button>
                                );
                            })}
                        </div>
                    )}
                    {loading && items.length > 0 && <div className="flex items-center justify-center gap-2 py-5 text-[12px] text-white/45"><Loader2 size={14} className="animate-spin" /> Cargando más…</div>}
                </div>
            </div>

            {/* SIDEBAR DERECHA — resumen */}
            <aside onClick={(e) => e.stopPropagation()} className="hidden lg:flex w-60 shrink-0 h-full bg-neutral-900/95 text-white border-l border-white/10 flex-col">
                <div className="px-4 py-4 flex items-center gap-2 border-b border-white/10"><span className="grid h-7 w-7 place-items-center rounded-lg bg-red-500/15 text-red-400"><Activity size={15} /></span><span className="text-[15px] font-extrabold">Resumen</span></div>
                <div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-3">
                    <div className="grid grid-cols-3 gap-2">
                        <div className="rounded-2xl bg-white/[0.04] ring-1 ring-white/10 p-2.5 text-center"><div className="text-[20px] font-extrabold tabular-nums text-white">{total}</div><div className="text-[10px] font-bold uppercase tracking-wide text-white/40">Total</div></div>
                        <div className="rounded-2xl bg-amber-500/10 ring-1 ring-amber-500/30 p-2.5 text-center"><div className="text-[20px] font-extrabold tabular-nums text-amber-300">{stats.pend}</div><div className="text-[10px] font-bold uppercase tracking-wide text-amber-400/70">Pend.</div></div>
                        <div className="rounded-2xl bg-white/[0.04] ring-1 ring-white/10 p-2.5 text-center"><div className="text-[20px] font-extrabold tabular-nums text-white">{stats.done}</div><div className="text-[10px] font-bold uppercase tracking-wide text-white/40">Revis.</div></div>
                    </div>
                    <Block icon={<Radar size={15} />} title="Por tipo (en vista)">
                        <div className="space-y-1.5">
                            {Object.keys(stats.by).length === 0 ? <div className="text-[12px] text-white/40">Sin datos</div> : Object.entries(stats.by).sort((a, b) => b[1] - a[1]).map(([t, n]) => { const mm = META[t] || META.OTHER; return (<button key={t} onClick={() => setType(t === "MOTION" ? "MOTION" : t === "LINECROSS" ? "LINECROSS" : t === "INTRUSION" ? "INTRUSION" : "ALL")} className="w-full flex items-center gap-2 px-2.5 py-2 rounded-xl bg-white/5 hover:bg-white/10 transition text-left"><span className={cn("grid h-7 w-7 place-items-center rounded-lg", mm.cls)}><mm.Icon size={13} /></span><span className="text-[12px] font-bold text-white/75 truncate flex-1">{mm.label}</span><span className="text-[13px] font-extrabold tabular-nums text-white">{n}</span></button>); })}
                        </div>
                    </Block>
                    <div className="text-[11px] text-white/35 px-1 leading-snug">El desglose por tipo y estado es sobre los eventos cargados en pantalla; el total es global.</div>
                </div>
            </aside>
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
                                        <td className="px-4 py-2.5"><span className={cn("inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border text-[11px] font-bold", m.cls)}><m.Icon size={12} /> {m.label}</span>{d.label && <span className="ml-1.5 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border border-white/15 text-[11px] font-bold text-white/80">{d.label === "vehicle" ? <><Car size={11} /> Auto</> : <><User size={11} /> Persona</>}</span>}</td>
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
    // Horarios de armado leídos de las cámaras (una llamada para todas), y el cajón para cambiarlos.
    const [horarios, setHorarios] = useState<Record<string, HorariosCamara>>({});
    const [horarioGeneral, setHorarioGeneral] = useState<any>(null);
    const [horarioDev, setHorarioDev] = useState<{ cam: IntrusionCam | null; todas: boolean } | null>(null);
    const cargarHorarios = useCallback(() => {
        fetch("/api/intrusion/horarios?todas=1", { cache: "no-store" }).then((r) => r.json()).then((d) => { if (d?.camaras) setHorarios(d.camaras); setHorarioGeneral(d?.general || null); }).catch(() => { });
    }, []);
    useEffect(() => { cargarHorarios(); const iv = setInterval(cargarHorarios, 5 * 60 * 1000); return () => clearInterval(iv); }, [cargarHorarios]);
    const [detail, setDetail] = useState<any>(null);
    const [showHistory, setShowHistory] = useState(false);
    const [showEvidence, setShowEvidence] = useState(false);
    const [playDet, setPlayDet] = useState<DetHistItem | null>(null);

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
            s = io(window.location.origin, { path: "/io/socket.io", transports: ["polling"], upgrade: false, reconnection: true, reconnectionAttempts: Infinity, reconnectionDelay: 1000, reconnectionDelayMax: 8000 });
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
    /** Cerrar una intrusión confirmada desde su ficha: resuelta deja el registro como está; falsa lo corrige. */
    const cerrarAtencion = (id: string, como: "resuelta" | "falsa") => {
        resolveAttending(id);
        if (como === "falsa") reclasificarComoFalsa(id).then(() => getRecentDetections(60, filter !== "ANALYTIC").then(setDets).catch(() => { })).catch(() => { });
    };
    const ackAlarm = (id: string, kind: "real" | "false" = "real") => {
        ackAlarms(id, kind).catch(() => { });
        setAlarms((a) => { const n = { ...a }; delete n[id]; return n; });
        if (kind === "real") { setAttendingIds((s) => new Set(s).add(id)); setAttending(id, true).catch(() => { }); }
    };
    const [liveTab, setLiveTab] = useState<"live" | "rec" | "evi">("live");
    const [prevCam, setPrevCam] = useState<IntrusionCam | null>(null);
    const [playMs, setPlayMs] = useState<number | null>(null);
    const openFicha = (c: IntrusionCam) => setDetail(lastByDev[c.id] ?? { id: `live-${c.id}`, deviceId: c.id, deviceName: c.name, type: "OTHER", eventType: null, snapshotPath: null, timestamp: new Date().toISOString() });
    const trackStatus = useMemo(() => { const now = Date.now(); const o: Record<string, { recent: boolean; alarm: boolean }> = {}; cams.forEach((c) => { const l = lastByDev[c.id]; o[c.id] = { recent: !!(l && now - new Date(l.timestamp).getTime() < 15 * 60 * 1000), alarm: !!(alarms[c.id]?.length) }; }); return o; }, [cams, lastByDev, alarms]);
    // Aceptar alarma abre la MISMA ficha del sidebar (con los botones real/falsa adentro).
    const openAlarmFicha = (c: IntrusionCam) => {
        const a = alarms[c.id]?.[0];
        setDetail(a ? { id: a.id, deviceId: c.id, deviceName: c.name, type: a.type, eventType: null, snapshotPath: null, timestamp: a.ts }
                    : (lastByDev[c.id] ?? { id: `live-${c.id}`, deviceId: c.id, deviceName: c.name, type: "OTHER", eventType: null, snapshotPath: null, timestamp: new Date().toISOString() }));
    };
    const openLive = (c: IntrusionCam) => { setLiveTab("live"); setPrevCam(null); setPlayMs(null); setLiveDev(c); };
    const openClip = (c: IntrusionCam) => { setLiveTab("rec"); setPlayMs(null); setLiveDev(c); };
    // Deep-link desde el mapa: ?cam=<deviceId>&tab=rec&t=<ms> abre el modal de esa cámara.
    const deepLinkedRef = useRef(false);
    useEffect(() => {
        if (deepLinkedRef.current || !cams.length) return;
        try {
            const sp = new URLSearchParams(window.location.search);
            const camId = sp.get("cam"); if (!camId) return;
            const c = cams.find((x) => x.id === camId); if (!c) return;
            deepLinkedRef.current = true;
            const tb = sp.get("tab"); const tms = parseInt(sp.get("t") || "0");
            setLiveTab(tb === "live" || tb === "evi" ? tb : "rec");
            if (tms) setPlayMs(tms);
            setLiveDev(c);
        } catch { }
    }, [cams]);

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
                    <button onClick={() => setHorarioDev({ cam: null, todas: true })} data-tooltip-id="mi-tip" data-tooltip-content={horarioGeneral ? `Criterio general: ${horarioGeneral.texto}` : "Un mismo horario de armado para todas las cámaras (opcional)"} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-[11px] font-bold text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"><Clock size={13} /> Horario general{horarioGeneral ? <span className="text-foreground/80 font-semibold">· {horarioGeneral.texto}</span> : null}</button>
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
                                                onCalibrate={setCalibrateDev} onAlarm={setAlarmDev} onAck={(c) => openAlarmFicha(c)} attending={attendingIds.has(cam.id)} onResolve={resolveAttending} horarios={horarios[cam.id] ?? null} onHorario={(c) => setHorarioDev({ cam: c, todas: false })} />
                                        ))}
                                    </div>
                                </div>
                            )}
                            {restRow.length > 0 && (
                                <div className="grid grid-cols-2 xl:grid-cols-3 gap-4">
                                    {restRow.map((cam) => (
                                        <CamTile key={cam.id} cam={cam} alarms={alarms[cam.id]} last={lastByDev[cam.id]} geom={geom[cam.id]} hasAnalytics={analyticsIds.has(cam.id)} alarmActive={cam.alarmOk || alarmIds.has(cam.id)} onFicha={openFicha} onLive={openLive} onClip={openClip}
                                            onCalibrate={setCalibrateDev} onAlarm={setAlarmDev} onAck={(c) => openAlarmFicha(c)} attending={attendingIds.has(cam.id)} onResolve={resolveAttending} horarios={horarios[cam.id] ?? null} onHorario={(c) => setHorarioDev({ cam: c, todas: false })} />
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
            {horarioDev && <HorarioArmadoDialog cam={horarioDev.cam} todasLasCamaras={horarioDev.todas} actual={horarioDev.cam ? horarios[horarioDev.cam.id] ?? null : null} general={horarioGeneral} camaras={horarios} onClose={() => setHorarioDev(null)} onAplicado={cargarHorarios} />}
            {alarmDev && <AlarmDialog cam={alarmDev} onClose={() => setAlarmDev(null)} onStatus={(id, ok) => setAlarmIds((prev) => { const s = new Set(prev); if (ok) s.add(id); else s.delete(id); return s; })} />}
            {detail && <DetailDialog det={detail} cam={detail?.deviceId ? camById[detail.deviceId] : undefined} geom={detail?.deviceId ? geom[detail.deviceId] : undefined} onClose={() => setDetail(null)}
                hasAlarm={!!(detail?.deviceId && alarms[detail.deviceId]?.length)} onResolveAlarm={(id, k) => { ackAlarm(id, k); const nx = Object.keys(alarms).find((d) => d !== id && alarms[d]?.length); if (nx && camById[nx]) openAlarmFicha(camById[nx]); else setDetail(null); }}
                enAtencion={!!(detail?.deviceId && attendingIds.has(detail.deviceId))} onCerrarAtencion={(id, como) => { cerrarAtencion(id, como); setDetail(null); }} />}
            {showHistory && <HistoryModal onClose={() => setShowHistory(false)} onOpen={(d) => setDetail(d)} />}
            {showEvidence && <EvidenceGallery cams={cams} onClose={() => setShowEvidence(false)} onOpen={(d) => setDetail(d)} onPlay={(d) => { const c = d.deviceId ? camById[d.deviceId] : null; if (c) { setPlayMs(Math.floor(new Date(d.timestamp).getTime())); setLiveTab("rec"); setLiveDev(c); } }} />}
            {liveDev && <LiveModal key={`${liveDev.id}:${playMs ?? "l"}`} cam={liveDev} cams={cams} camStatus={trackStatus} initialTab={liveTab} initialRecMs={playMs ?? undefined} fromCam={prevCam} geom={geom[liveDev.id]} onClose={() => { setLiveDev(null); setPrevCam(null); setPlayMs(null); }} onOpenEvent={(d) => setDetail(d)} onSwitchCam={(c) => { setLiveTab("live"); setPrevCam(liveDev); setPlayMs(null); setLiveDev(c); }} onDismissFrom={() => setPrevCam(null)} />}
            <RTooltip id="mi-tip" place="top" delayShow={100} className="!z-[9999] !rounded-md !bg-zinc-900 !text-white !text-[11px] !font-semibold !px-2 !py-1 !border !border-white/10 !shadow-xl !opacity-100" />
        </div>
    );
}
