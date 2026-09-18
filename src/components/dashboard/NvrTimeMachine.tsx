"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    X, Play, Pause, ChevronLeft, ChevronRight, Radio, Film, ImageIcon,
    Calendar, Rewind, FastForward, Car, AlertTriangle, Loader2, Clock, Download, Hourglass,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { DurationPicker } from "@/components/ui/duration-picker";

type Tab = "grabacion" | "vivo" | "evidencia";

interface TlEvent {
    id: string;
    timestamp: string;
    plateDetected?: string | null;
    decision?: string | null;
    direction?: string | null;
    accessType?: string | null;
    snapshotPath?: string | null;
    imagePath?: string | null;
}

interface Props {
    open: boolean;
    onClose: () => void;
    deviceId: string;
    channel: number | null;
    eventTimeMs: number;
    deviceName?: string;
    evidenceUrl?: string | null;
    plate?: string;
}

const PRE_SEC = 3;
const WINDOWS = [15, 30, 60, 180, 360, 1440];
const WIN_LABEL: Record<number, string> = { 15: "15m", 30: "30m", 60: "1h", 180: "3h", 360: "6h", 1440: "24h" };
/** La ventana ya no esta limitada a los presets: puede ser cualquier duracion. */
const etiquetaVentana = (min: number) => {
    if (WIN_LABEL[min]) return WIN_LABEL[min];
    const h = Math.floor(min / 60), m = Math.round(min % 60);
    if (h && m) return `${h}h ${m}m`;
    if (h) return `${h}h`;
    return `${m}m`;
};
/** Indice del preset mas parecido, para que el slider siga teniendo sentido. */
const indicePreset = (min: number) => {
    let mejor = 0, dif = Infinity;
    WINDOWS.forEach((w, i) => { const d = Math.abs(w - min); if (d < dif) { dif = d; mejor = i; } });
    return mejor;
};
const MESES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Set", "Oct", "Nov", "Dic"];

// Glass tokens (estilo vidrio esmerilado)
const glass = "bg-white/[0.06] backdrop-blur-2xl border border-white/[0.08]";
const glassBtn = "bg-white/[0.07] hover:bg-white/[0.14] backdrop-blur-xl border border-white/[0.08] transition-colors";

function LiveMp4({ deviceId, className }: { deviceId: string; className?: string }) {
    const ref = useRef<HTMLVideoElement>(null);
    const tries = useRef(0);
    const src = `/go2rtc/api/stream.mp4?src=lpr_${deviceId}_hd&video=h264`;
    useEffect(() => {
        const v = ref.current; if (!v) return; tries.current = 0;
        v.src = src; v.play().catch(() => {});
        const onErr = () => { tries.current++; if (tries.current > 4) return; setTimeout(() => { if (ref.current) { ref.current.src = src; ref.current.play().catch(() => {}); } }, 1400); };
        v.addEventListener("error", onErr);
        return () => { v.removeEventListener("error", onErr); try { v.pause(); v.removeAttribute("src"); v.load(); } catch {} };
    }, [deviceId]);
    return <video ref={ref} className={cn("object-contain", className)} muted autoPlay playsInline controls />;
}

function MiniCalendar({ channel, valueMs, onPick }: { channel: number | null; valueMs: number; onPick: (ms: number) => void }) {
    const base = new Date(valueMs);
    const [view, setView] = useState({ y: base.getFullYear(), m: base.getMonth() }); // m: 0-11
    const [recDays, setRecDays] = useState<Set<number>>(new Set());
    const [loading, setLoading] = useState(false);
    useEffect(() => {
        if (channel == null) return;
        let alive = true; setLoading(true);
        fetch(`/api/nvr/recording-days?ch=${channel}&year=${view.y}&month=${view.m + 1}`)
            .then((r) => r.json())
            .then((d) => { if (alive) setRecDays(new Set(d.days || [])); })
            .catch(() => { if (alive) setRecDays(new Set()); })
            .finally(() => { if (alive) setLoading(false); });
        return () => { alive = false; };
    }, [channel, view.y, view.m]);

    const first = new Date(view.y, view.m, 1);
    const startDow = (first.getDay() + 6) % 7; // lunes=0
    const nDays = new Date(view.y, view.m + 1, 0).getDate();
    const today = new Date();
    const isFuture = (d: number) => new Date(view.y, view.m, d) > today;
    const sel = { y: base.getFullYear(), m: base.getMonth(), d: base.getDate() };

    return (
        <div className={cn("rounded-2xl p-2.5", glass)}>
            <div className="flex items-center justify-between mb-1.5">
                <button onClick={() => setView(v => v.m === 0 ? { y: v.y - 1, m: 11 } : { y: v.y, m: v.m - 1 })} className={cn("p-1 rounded-lg", glassBtn)}><ChevronLeft size={12} /></button>
                <span className="text-[11px] font-bold text-white/90 flex items-center gap-1.5">{loading && <Loader2 size={10} className="animate-spin text-white/40" />}{MESES[view.m]} {view.y}</span>
                <button onClick={() => setView(v => v.m === 11 ? { y: v.y + 1, m: 0 } : { y: v.y, m: v.m + 1 })} className={cn("p-1 rounded-lg", glassBtn)}><ChevronRight size={12} /></button>
            </div>
            <div className="grid grid-cols-7 gap-0.5 text-center">
                {["L", "M", "M", "J", "V", "S", "D"].map((d, i) => <span key={i} className="text-[8px] font-bold text-white/35 py-0.5">{d}</span>)}
                {Array.from({ length: startDow }, (_, i) => <span key={"e" + i} />)}
                {Array.from({ length: nDays }, (_, i) => {
                    const d = i + 1;
                    const has = recDays.has(d);
                    const selected = sel.y === view.y && sel.m === view.m && sel.d === d;
                    return (
                        <button key={d} disabled={isFuture(d)}
                            onClick={() => onPick(new Date(view.y, view.m, d, 12, 0, 0).getTime())}
                            className={cn("relative h-6 rounded-lg text-[10px] font-semibold transition-colors",
                                selected ? "bg-white text-black" : has ? "text-white hover:bg-white/15" : "text-white/30 hover:bg-white/5",
                                isFuture(d) && "opacity-20 cursor-default")}>
                            {d}
                            {has && !selected && <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-emerald-400" />}
                        </button>
                    );
                })}
            </div>
        </div>
    );
}

export function NvrTimeMachine({ open, onClose, deviceId, channel: channelProp, eventTimeMs, deviceName, evidenceUrl, plate }: Props) {
    // Fallback autosuficiente: si el prop llega null, resolvemos el canal contra la API.
    const [selfChannel, setSelfChannel] = useState<number | null>(null);
    useEffect(() => {
        if (!open || channelProp != null || !deviceId) return;
        let alive = true;
        fetch(`/api/nvr/channel?deviceId=${deviceId}`, { cache: "no-store" })
            .then((r) => r.json())
            .then((d) => { if (alive) setSelfChannel(d && d.channel != null ? Number(d.channel) : null); })
            .catch(() => { if (alive) setSelfChannel(null); });
        return () => { alive = false; };
    }, [open, channelProp, deviceId]);
    const channel = channelProp != null ? channelProp : selfChannel;

    const [tab, setTab] = useState<Tab>("grabacion");
    const [winMin, setWinMin] = useState(60);
    const [anchorMs, setAnchorMs] = useState(() => Math.max(Date.now(), eventTimeMs));
    const [playheadMs, setPlayheadMs] = useState(eventTimeMs);
    const [committedMs, setCommittedMs] = useState(eventTimeMs);
    const [events, setEvents] = useState<TlEvent[]>([]);
    const [playing, setPlaying] = useState(true);
    const [vidState, setVidState] = useState<"loading" | "ok" | "error">("loading");
    const [dragging, setDragging] = useState(false);
    const [videoCur, setVideoCur] = useState(0);
    const [openPanel, setOpenPanel] = useState<null | "calendar" | "time" | "ventana">(null);
    const panRef = useRef<{ startY: number; startAnchor: number; moved: boolean } | null>(null);
    const [panY, setPanY] = useState<number | null>(null); // % fijo del playhead durante drag-pan
    const trackRef = useRef<HTMLDivElement>(null);
    const videoRef = useRef<HTMLVideoElement>(null);

    const winMs = winMin * 60000;
    const topMs = anchorMs;
    const botMs = anchorMs - winMs;

    useEffect(() => {
        if (!open) return;
        setTab("grabacion");
        setAnchorMs(Math.max(Date.now(), eventTimeMs));
        setPlayheadMs(eventTimeMs);
        setCommittedMs(eventTimeMs);
        setVideoCur(0);
    }, [open, eventTimeMs]);

    useEffect(() => {
        if (!open) return;
        const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
        window.addEventListener("keydown", h);
        return () => window.removeEventListener("keydown", h);
    }, [open, onClose]);

    useEffect(() => {
        if (!open || !deviceId) return;
        let alive = true;
        fetch(`/api/nvr/events?deviceId=${deviceId}&from=${Math.floor(botMs)}&to=${Math.floor(topMs)}`)
            .then(r => r.json())
            .then(d => { if (alive) setEvents(d.events || []); })
            .catch(() => { if (alive) setEvents([]); });
        return () => { alive = false; };
    }, [open, deviceId, botMs, topMs]);

    useEffect(() => {
        if (!open || tab !== "vivo") return;
        const iv = setInterval(() => setAnchorMs(Date.now()), 5000);
        return () => clearInterval(iv);
    }, [open, tab]);

    const yToTime = useCallback((clientY: number): number => {
        const el = trackRef.current; if (!el) return playheadMs;
        const r = el.getBoundingClientRect();
        const frac = Math.min(1, Math.max(0, (clientY - r.top) / r.height));
        return topMs - frac * winMs;
    }, [topMs, winMs, playheadMs]);

    const timeToY = useCallback((t: number): number => ((topMs - t) / winMs) * 100, [topMs, winMs]);

    const commit = useCallback((t: number) => {
        const clamped = Math.min(Date.now(), t);
        setPlayheadMs(clamped);
        setCommittedMs(clamped);
        setVideoCur(0);
        setVidState("loading");
        setPlaying(true);
        setTab("grabacion");
    }, []);

    useEffect(() => {
        if (!dragging) return;
        const onMove = (e: PointerEvent) => setPlayheadMs(yToTime(e.clientY));
        const onUp = (e: PointerEvent) => { setDragging(false); commit(yToTime(e.clientY)); };
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
        return () => { window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); };
    }, [dragging, yToTime, commit]);

    // Scroll sobre la barra = zoom temporal (ventana), centrado en el playhead visible
    const winIdxRef = useRef(WINDOWS.indexOf(60));
    useEffect(() => { winIdxRef.current = indicePreset(winMin); }, [winMin]);
    const onWheel = useCallback((e: React.WheelEvent) => {
        e.preventDefault();
        const idx = winIdxRef.current;
        const next = e.deltaY > 0 ? Math.min(WINDOWS.length - 1, idx + 1) : Math.max(0, idx - 1);
        if (next !== idx) setWinMin(WINDOWS[next]);
    }, []);

    const sortedTs = useMemo(() => events.map(e => new Date(e.timestamp).getTime()).sort((a, b) => a - b), [events]);
    const gotoPrev = () => { const p = [...sortedTs].reverse().find(t => t < committedMs - 500); if (p) commit(p); };
    const gotoNext = () => { const n = sortedTs.find(t => t > committedMs + 500); if (n) commit(n); };

    const togglePlay = () => {
        const v = videoRef.current; if (!v) return;
        if (v.paused) { v.play().catch(() => {}); setPlaying(true); } else { v.pause(); setPlaying(false); }
    };

    const playbackSrc = channel != null ? `/api/nvr/playback?ch=${channel}&t=${Math.floor(committedMs)}&pre=${PRE_SEC}&dur=120` : "";
    const downloadHref = channel != null ? `/api/nvr/playback?ch=${channel}&t=${Math.floor(committedMs)}&pre=10&dur=60&download=1` : "";

    const startWallMs = committedMs - PRE_SEC * 1000;
    const displayMs = (dragging || tab !== "grabacion") ? playheadMs : startWallMs + videoCur * 1000;
    const clock = new Date(displayMs);
    const hh = clock.toLocaleTimeString("es-UY", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
    const dd = clock.toLocaleDateString("es-UY", { weekday: "short", day: "2-digit", month: "short" });

    const ticks = useMemo(() => {
        const n = 6;
        return Array.from({ length: n + 1 }, (_, i) => ({ t: topMs - (i / n) * winMs, yPct: (i / n) * 100 }));
    }, [topMs, winMs]);

    // Agrupar eventos muy próximos (evita amontonar iconos): bucket por 1.2% de la ventana
    const markers = useMemo(() => {
        const out: { t: number; y: number; ev: TlEvent; extra: number }[] = [];
        const minGapPct = 2.2;
        const sorted = [...events].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
        for (const ev of sorted) {
            const t = new Date(ev.timestamp).getTime();
            const y = timeToY(t);
            if (y < -2 || y > 102) continue;
            const near = out.find((m) => Math.abs(m.y - y) < minGapPct);
            if (near) { near.extra++; continue; }
            out.push({ t, y, ev, extra: 0 });
        }
        return out;
    }, [events, timeToY]);

    if (!open) return null;

    return (
        <div className="fixed inset-0 z-[3200] bg-black/85 backdrop-blur-md flex text-white select-none" onClick={onClose}>
            <div className="flex-1 flex overflow-hidden" onClick={(e) => e.stopPropagation()}>

                {/* ─── PANEL IZQUIERDO (regla estilo UniFi) ─── */}
                <div className="relative shrink-0 m-3 mr-9 flex">
                    <div className={cn("w-[120px] flex flex-col rounded-2xl", glass)}>
                        {/* Arriba: título + slider de zoom */}
                        <div className="px-2.5 pt-2.5 pb-2 border-b border-white/[0.06] shrink-0">
                            <p className="text-[10px] font-bold text-white/70 leading-tight">Últimas {etiquetaVentana(winMin)}</p>
                            <p className="text-[9px] text-white/35 leading-tight">{events.length === 0 ? "Sin eventos" : `${events.length} eventos`}</p>
                            <div className="flex items-center gap-1 mt-1.5 w-full overflow-hidden">
                                <button onClick={() => { const i = indicePreset(winMin); if (i < WINDOWS.length - 1) setWinMin(WINDOWS[i + 1]); }} className="shrink-0 w-4 text-white/50 hover:text-white text-xs leading-none font-bold">−</button>
                                <input type="range" min={0} max={WINDOWS.length - 1} value={WINDOWS.length - 1 - indicePreset(winMin)}
                                    onChange={(e) => setWinMin(WINDOWS[WINDOWS.length - 1 - Number(e.target.value)])}
                                    className="flex-1 min-w-0 h-[3px] accent-blue-500 cursor-pointer" style={{ maxWidth: "100%" }} />
                                <button onClick={() => { const i = indicePreset(winMin); if (i > 0) setWinMin(WINDOWS[i - 1]); }} className="shrink-0 w-4 text-white/50 hover:text-white text-xs leading-none font-bold">+</button>
                            </div>
                        </div>

                        {/* Regla (drag = pan temporal; click = ir a esa hora; rueda = zoom) */}
                        <div className="flex-1 relative mx-1 my-1 cursor-grab active:cursor-grabbing" ref={trackRef}
                            onWheel={onWheel}
                            onPointerDown={(e) => {
                                e.preventDefault();
                                (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
                                panRef.current = { startY: e.clientY, startAnchor: anchorMs, moved: false };
                            }}
                            onPointerMove={(e) => {
                                const p = panRef.current; if (!p) return;
                                const el = trackRef.current; if (!el) return;
                                const dy = e.clientY - p.startY;
                                if (!p.moved && Math.abs(dy) > 4) {
                                    p.moved = true;
                                    // La línea roja queda FIJA donde está; la regla se desliza por debajo.
                                    setPanY(Math.min(96, Math.max(4, timeToY(displayMs))));
                                }
                                if (p.moved) {
                                    const dt = (dy / el.getBoundingClientRect().height) * winMs;
                                    setAnchorMs(Math.min(Date.now() + winMs * 0.02, p.startAnchor + dt));
                                }
                            }}
                            onPointerUp={(e) => {
                                const p = panRef.current; panRef.current = null;
                                if (!p) return;
                                if (!p.moved) { commit(yToTime(e.clientY)); return; }
                                // aplicar la hora que quedó bajo la línea fija
                                const y = panY != null ? panY : 50;
                                setPanY(null);
                                commit(topMs - (y / 100) * winMs);
                            }}>
                            {/* badge EN VIVO (si el tope de la ventana toca el presente) */}
                            {topMs >= Date.now() - 30000 && (
                                <button onClick={(e) => { e.stopPropagation(); setTab("vivo"); setAnchorMs(Date.now()); }}
                                    onPointerDown={(e) => e.stopPropagation()}
                                    className="absolute z-30 left-0 flex items-center gap-1"
                                    style={{ top: `${Math.max(0, timeToY(Date.now()))}%`, transform: "translateY(-50%)" }}>
                                    <span className={cn("px-1.5 py-0.5 rounded-md text-[8px] font-bold tracking-wider text-white shadow", tab === "vivo" ? "bg-red-500" : "bg-blue-500")}>EN VIVO</span>
                                    <span className={cn("h-px w-8", tab === "vivo" ? "bg-red-500" : "bg-blue-500")} />
                                </button>
                            )}
                            {/* regla de ticks CENTRADA */}
                            {(() => {
                                const nMinor = 48;
                                const items = [] as any[];
                                for (let i = 0; i <= nMinor; i++) {
                                    const y = (i / nMinor) * 100;
                                    const major = i % 8 === 0;
                                    const t = topMs - (i / nMinor) * winMs;
                                    items.push(
                                        <div key={i} className="absolute left-0 right-0 pointer-events-none" style={{ top: `${y}%`, transform: "translateY(-50%)" }}>
                                            {major && <span className="absolute right-[calc(50%+12px)] top-1/2 -translate-y-1/2 text-[8px] text-white/40 font-mono tabular-nums">{new Date(t).toLocaleTimeString("es-UY", { hour: "2-digit", minute: "2-digit", hour12: false })}</span>}
                                            <span className={cn("absolute left-1/2 -translate-x-1/2 top-1/2 -translate-y-1/2 h-px", major ? "w-4 bg-white/40" : "w-2 bg-white/15")} />
                                        </div>
                                    );
                                }
                                return items;
                            })()}
                            {/* línea vertical finísima CENTRADA */}
                            <div className="absolute left-1/2 -translate-x-1/2 top-0 bottom-0 w-px bg-white/15" />
                            {/* playhead (durante el drag queda fijo y la hora corre) */}
                            {(() => {
                                const phY = panY != null ? panY : Math.min(100, Math.max(0, timeToY(displayMs)));
                                const phMs = panY != null ? (topMs - (panY / 100) * winMs) : displayMs;
                                return (
                                    <div className="absolute left-0 right-0 z-20 pointer-events-none" style={{ top: `${phY}%` }}>
                                        <div className="relative -translate-y-1/2">
                                            <div className="h-[2px] bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.9)] rounded-full" />
                                            <div className="absolute left-0 -top-4 px-1.5 py-0.5 rounded-md bg-red-500 text-white text-[9px] font-mono font-bold tabular-nums shadow-lg">
                                                {new Date(phMs).toLocaleTimeString("es-UY", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })()}
                            {/* iconos de eventos: FUERA del panel, hover bounce, click = ir al evento */}
                            {markers.map((m) => {
                                const exit = m.ev.direction === "EXIT";
                                const deny = m.ev.decision === "DENY";
                                return (
                                    <button key={m.ev.id}
                                        title={`${new Date(m.t).toLocaleTimeString("es-UY", { hour: "2-digit", minute: "2-digit", second: "2-digit" })} · ${m.ev.plateDetected || "s/l"}${m.extra ? ` (+${m.extra})` : ""}`}
                                        onClick={(e) => { e.stopPropagation(); commit(m.t); }}
                                        onPointerDown={(e) => e.stopPropagation()}
                                        className="absolute z-10 group cursor-pointer" style={{ top: `${m.y}%`, left: "calc(100% + 8px)", transform: "translateY(-50%)" }}>
                                        <span className={cn("flex items-center justify-center w-[20px] h-[20px] rounded-lg backdrop-blur-xl border shadow-lg transition-transform group-hover:animate-bounce",
                                            deny ? "bg-red-500/25 border-red-400/40 text-red-300" : exit ? "bg-orange-500/25 border-orange-400/40 text-orange-300" : "bg-emerald-500/25 border-emerald-400/40 text-emerald-300")}>
                                            <Car size={10} />
                                        </span>
                                        {m.extra > 0 && <span className="absolute -top-1 -right-1 min-w-3.5 h-3.5 px-0.5 rounded-full bg-white text-black text-[8px] font-bold flex items-center justify-center">+{m.extra}</span>}
                                    </button>
                                );
                            })}
                        </div>

                        {/* Abajo: fecha + hora JUNTOS */}
                        <div className="px-2 py-2 border-t border-white/[0.06] shrink-0 flex items-center justify-center gap-1.5">
                            <button onClick={() => setOpenPanel(p => p === "calendar" ? null : "calendar")} title="Elegir fecha"
                                className={cn("p-1.5 rounded-lg transition-all", openPanel === "calendar" ? "bg-white text-black shadow" : glassBtn + " text-white/70")}>
                                <Calendar size={13} />
                            </button>
                            <button onClick={() => setOpenPanel(p => p === "time" ? null : "time")} title="Elegir hora"
                                className={cn("p-1.5 rounded-lg transition-all", openPanel === "time" ? "bg-white text-black shadow" : glassBtn + " text-white/70")}>
                                <Clock size={13} />
                            </button>
                            <button onClick={() => setOpenPanel(p => p === "ventana" ? null : "ventana")} title="Duración de la búsqueda"
                                className={cn("p-1.5 rounded-lg transition-all", openPanel === "ventana" ? "bg-white text-black shadow" : glassBtn + " text-white/70")}>
                                <Hourglass size={13} />
                            </button>
                            <span className="text-[9px] text-white/40 font-mono ml-1">{new Date(displayMs).toLocaleDateString("es-UY", { day: "2-digit", month: "2-digit" })}</span>
                        </div>

                        {/* Popover: calendario (hacia arriba) */}
                        {openPanel === "calendar" && (
                            <div className="absolute bottom-11 left-2 z-40 w-[210px] rounded-2xl bg-black/85 shadow-2xl animate-in fade-in zoom-in-95 slide-in-from-bottom-2 duration-200">
                                <MiniCalendar channel={channel} valueMs={displayMs}
                                    onPick={(ms) => { setWinMin(1440); setAnchorMs(ms + 12 * 3600000); commit(ms); setOpenPanel(null); }} />
                            </div>
                        )}
                        {/* Popover: hora (hacia arriba) */}
                        {openPanel === "time" && (
                            <div className={cn("absolute bottom-11 left-2 z-40 rounded-2xl p-3 bg-black/85 shadow-2xl animate-in fade-in zoom-in-95 slide-in-from-bottom-2 duration-200", glass)}>
                                <p className="text-[9px] font-bold text-white/45 uppercase tracking-widest mb-1.5">Ir a hora</p>
                                <input type="time" step={60}
                                    defaultValue={new Date(displayMs).toTimeString().slice(0, 5)}
                                    onKeyDown={(e) => { if (e.key === "Enter") (e.currentTarget.nextElementSibling as HTMLButtonElement)?.click(); }}
                                    className="w-full bg-white/10 border border-white/15 rounded-lg px-2 py-1.5 text-sm text-white font-mono [color-scheme:dark] focus:outline-none focus:ring-1 focus:ring-blue-500"
                                    id="tm-time-input" />
                                <button onClick={(e) => {
                                    const inp = (e.currentTarget.parentElement as HTMLElement).querySelector("input") as HTMLInputElement;
                                    if (!inp?.value) return;
                                    const [h, m] = inp.value.split(":").map(Number);
                                    const d = new Date(displayMs); d.setHours(h, m, 0, 0);
                                    setAnchorMs(Math.min(Date.now(), d.getTime() + winMs * 0.3));
                                    commit(d.getTime());
                                    setOpenPanel(null);
                                }} className="mt-2 w-full py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-[11px] font-bold transition-colors">Ir</button>
                            </div>
                        )}
                        {/* Popover: cuanto tiempo mirar hacia atras */}
                        {openPanel === "ventana" && (
                            <div className={cn("absolute bottom-11 left-2 z-40 rounded-2xl p-3 bg-black/85 shadow-2xl animate-in fade-in zoom-in-95 slide-in-from-bottom-2 duration-200", glass)}>
                                <p className="text-[9px] font-bold text-white/45 uppercase tracking-widest mb-2">Mirar hacia atrás</p>
                                <DurationPicker
                                    value={{ hours: Math.floor(winMin / 60), minutes: Math.round(winMin % 60) }}
                                    onChange={(d) => { const t = d.hours * 60 + d.minutes; if (t >= 1) setWinMin(t); }}
                                    onConfirm={(d) => { const t = d.hours * 60 + d.minutes; setWinMin(Math.max(1, t)); setOpenPanel(null); }}
                                    maxHours={72}
                                    hoursLabel="h"
                                    minutesLabel="min"
                                />
                                <div className="flex flex-wrap gap-1 mt-2.5">
                                    {WINDOWS.map((w) => (
                                        <button key={w} onClick={() => { setWinMin(w); setOpenPanel(null); }}
                                            className={cn("px-2 py-1 rounded-lg text-[10px] font-bold transition-colors",
                                                winMin === w ? "bg-white text-black" : "bg-white/10 text-white/70 hover:bg-white/20")}>
                                            {WIN_LABEL[w]}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {/* ─── CENTRO ─── */}
                <div className="flex-1 flex flex-col min-w-0 m-3">
                    {/* Header glass: tabs + cerrar */}
                    <div className="flex items-center justify-between px-1 pb-2.5 shrink-0">
                        <div className={cn("px-3 py-1.5 rounded-xl text-[11px] text-white/70 font-bold truncate max-w-[200px]", glass)}>{deviceName || "Cámara"}</div>
                        <div className={cn("flex items-center gap-0.5 rounded-2xl p-1", glass)}>
                            {([["evidencia", "Evidencia", ImageIcon], ["vivo", "En vivo", Radio], ["grabacion", "Grabación", Film]] as [Tab, string, any][]).map(([id, lbl, Ic]) => (
                                <button key={id} onClick={() => setTab(id)}
                                    className={cn("px-3.5 py-1.5 rounded-xl text-[11px] font-bold flex items-center gap-1.5 transition-all",
                                        tab === id ? "bg-white text-black shadow" : "text-white/60 hover:text-white")}>
                                    <Ic size={12} /> {lbl}
                                </button>
                            ))}
                        </div>
                        <button onClick={onClose} className={cn("p-2 rounded-xl", glassBtn)}><X size={16} /></button>
                    </div>

                    {/* Área de video */}
                    <div className={cn("flex-1 relative flex items-center justify-center overflow-hidden min-h-0 rounded-2xl", "bg-black/60 border border-white/[0.07]")}>
                        {tab === "evidencia" && (
                            evidenceUrl
                                ? <img src={evidenceUrl} alt="Evidencia" className="max-w-full max-h-full object-contain" />
                                : <div className="flex flex-col items-center gap-2 text-white/40"><ImageIcon size={40} /><span className="text-xs">Sin evidencia</span></div>
                        )}
                        {tab === "vivo" && <LiveMp4 deviceId={deviceId} className="w-full h-full" />}
                        {tab === "grabacion" && (
                            channel == null ? (
                                <div className="flex flex-col items-center gap-2 text-amber-400/80"><AlertTriangle size={36} /><span className="text-sm font-bold">Esta cámara no está mapeada a un canal del NVR</span></div>
                            ) : (
                                <>
                                    <video
                                        key={playbackSrc}
                                        ref={videoRef}
                                        src={playbackSrc}
                                        autoPlay
                                        playsInline
                                        controls
                                        className="max-w-full max-h-full"
                                        onLoadedData={() => setVidState("ok")}
                                        onPlaying={() => { setVidState("ok"); setPlaying(true); }}
                                        onPause={() => setPlaying(false)}
                                        onPlay={() => setPlaying(true)}
                                        onTimeUpdate={(e) => setVideoCur((e.currentTarget as HTMLVideoElement).currentTime)}
                                        onError={() => setVidState("error")}
                                    />
                                    {vidState === "loading" && (
                                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-white/70 pointer-events-none">
                                            <Loader2 size={34} className="animate-spin" /><span className="text-xs">Abriendo grabación…</span>
                                        </div>
                                    )}
                                    {vidState === "error" && (
                                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-amber-400">
                                            <AlertTriangle size={38} />
                                            <span className="text-sm font-bold">No se pudo abrir la grabación</span>
                                            <span className="text-[11px] text-white/40">Sin video en el NVR para este instante</span>
                                            <button onClick={() => { setVidState("loading"); setCommittedMs(m => m + 1); }} className={cn("mt-1 px-3 py-1.5 rounded-xl text-[11px] font-bold text-white", glassBtn)}>Reintentar</button>
                                        </div>
                                    )}
                                </>
                            )
                        )}
                    </div>

                    {/* Controles glass */}
                    <div className="flex items-center justify-center gap-2 pt-2.5 shrink-0 relative">
                        <div className={cn("flex items-center gap-1.5 rounded-2xl px-2 py-1.5", glass)}>
                            <button onClick={() => commit(committedMs - 30000)} title="-30s" className={cn("flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-[11px] font-bold", glassBtn)}><Rewind size={13} /> 30</button>
                            <button onClick={gotoPrev} title="Evento anterior" className={cn("p-2 rounded-xl", glassBtn)}><ChevronLeft size={15} /></button>
                            <button onClick={togglePlay} title="Reproducir/Pausar" className="p-2.5 rounded-full bg-white text-black hover:bg-white/90 shadow-lg">{playing ? <Pause size={15} /> : <Play size={15} />}</button>
                            <button onClick={gotoNext} title="Evento siguiente" className={cn("p-2 rounded-xl", glassBtn)}><ChevronRight size={15} /></button>
                            <button onClick={() => commit(committedMs + 30000)} title="+30s" className={cn("flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-[11px] font-bold", glassBtn)}>30 <FastForward size={13} /></button>
                            <div className="w-px h-5 bg-white/15 mx-0.5" />
                            <a href={downloadHref || undefined} download title="Descargar clip (60s alrededor de este instante)"
                                className={cn("flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-[11px] font-bold", channel != null ? glassBtn : "opacity-30 pointer-events-none " + glassBtn)}>
                                <Download size={13} /> Clip
                            </a>
                        </div>
                        <div className="absolute right-1 top-1/2 -translate-y-1/2 text-right">
                            <div className="text-2xl font-bold font-mono tabular-nums leading-none drop-shadow">{hh}</div>
                            <div className="text-[10px] text-white/50 capitalize mt-0.5">{dd}</div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default NvrTimeMachine;
