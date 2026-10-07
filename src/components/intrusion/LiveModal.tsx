"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";
import { getSocketUrl } from "@/lib/socket-config";
import { getIntrusionCameras, getRecentDetections, getDevicesWithAnalytics, getAnalyticsGeometryBatch, getDetectionHistory, getActiveAlarms, ackAlarms, getAttendingIds, setAttending, getVisualTrackLinks, setVisualTrackLinks, type TrackLink, type DetItem, type IntrusionCam, type DetHistItem } from "@/app/actions/detections";
import { Radar, ShieldAlert, Activity, LogIn, LogOut, Camera, Circle, BellRing, Loader2, Check, PencilRuler, X, Server, Wifi, Search, RefreshCcw, History, ImageOff, ChevronLeft, ChevronRight, FileText, Video, Film, MoreVertical, Clock, Download, ChevronUp, ChevronDown, ZoomIn, ZoomOut, Home, Gauge, Move, Joystick, Rewind, FastForward, Gauge as GaugeIco, Calendar as CalIco, Crosshair, Plus, Save, Pencil, Trash2, Car, User, Play, Pause, Settings2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { LineZoneCalibrator } from "@/components/LineZoneCalibrator";
import { PtzControls, ptzAngleToDir } from "@/components/PtzControls";
import { Scrub, type MarcaScrub } from "@/components/Scrub";
import { motion, AnimatePresence } from "framer-motion";
import { Tooltip as RTooltip } from "react-tooltip";
import "react-tooltip/dist/react-tooltip.css";

type Geom = { line: { x: number; y: number }[]; field: { x: number; y: number }[] };

/**
 * Cuánto video se pide al NVR al navegar la línea de tiempo.
 *
 * Al abrir la grabación en un instante se usaba la misma ventana que la ficha del evento
 * (10 s antes + 10 s después): el clip terminaba a los veinte segundos y el operador creía
 * que "el video no corre". Navegar no es ver un evento: acá se pide un tramo largo y, cuando
 * termina, se sigue solo desde donde quedó. Tres minutos es el tope que admite la ruta
 * (ANTES_MAX + DESPUES_MAX) sin pasarse; el proceso se corta solo al cambiar de instante.
 */
const DUR_NAVEGACION_SEG = 180;
/** Si el tramo murió antes de esto, no era el final del tramo: no había grabación. */
const MIN_SEG_PARA_ENCADENAR = 3;

type Ventana = { antes: number; despues: number; topes: { antesMax: number; despuesMax: number; despuesMin: number } };
const VENTANA_INICIAL: Ventana = { antes: 10, despues: 10, topes: { antesMax: 60, despuesMax: 170, despuesMin: 3 } };
const horaSeg = (ms: number) => new Date(ms).toLocaleTimeString("es-UY", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });

/**
 * El diálogo previo a bajar un clip.
 *
 * Antes el botón bajaba sin decir nada un clip "de 60 s" (según su tooltip) que en
 * realidad medía lo que dijera Ajustes. Ahora dice exactamente qué va a traer —cuántos
 * segundos antes y después de qué instante, de dónde sale ese valor— y deja cambiarlo
 * para ESTE clip sin tocar la configuración del barrio.
 */
function DescargaClip({ instante, ventana, href, onClose }: { instante: number; ventana: Ventana; href: (antes: number, despues: number) => string; onClose: () => void }) {
    const [antes, setAntes] = useState(ventana.antes);
    const [despues, setDespues] = useState(ventana.despues);
    const acotar = (v: number, min: number, max: number) => Math.min(max, Math.max(min, Math.round(Number.isFinite(v) ? v : min)));
    const a = acotar(antes, 0, ventana.topes.antesMax), d = acotar(despues, ventana.topes.despuesMin, ventana.topes.despuesMax);
    const cambiado = a !== ventana.antes || d !== ventana.despues;
    useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } }; window.addEventListener("keydown", k, true); return () => window.removeEventListener("keydown", k, true); }, [onClose]);
    return (
        <div className="absolute inset-0 z-[60] bg-black/70 backdrop-blur-sm grid place-items-center p-4" onClick={onClose}>
            <div className="w-full max-w-md rounded-2xl bg-neutral-900/95 ring-1 ring-white/10 shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-start gap-3 p-5 pb-4">
                    <span className="w-10 h-10 rounded-xl bg-sky-500/20 grid place-items-center ring-1 ring-sky-400/30 shrink-0"><Download size={18} className="text-sky-300" /></span>
                    <div className="min-w-0">
                        <div className="text-[15px] font-extrabold text-white leading-tight">Descargar clip</div>
                        <div className="text-[12px] text-white/60 mt-0.5">Alrededor de las <span className="text-white font-bold tabular-nums">{horaSeg(instante)}</span> del {new Date(instante).toLocaleDateString("es-UY", { day: "2-digit", month: "2-digit", year: "numeric" })}</div>
                    </div>
                    <button onClick={onClose} className="ml-auto w-8 h-8 grid place-items-center rounded-full hover:bg-white/10 text-white/60 hover:text-white"><X size={16} /></button>
                </div>
                <div className="px-5 pb-4 grid grid-cols-2 gap-3">
                    <label className="block">
                        <span className="block text-[10px] font-bold uppercase tracking-[0.14em] text-white/50 mb-1.5">Segundos antes</span>
                        <input type="number" min={0} max={ventana.topes.antesMax} value={antes} onChange={(e) => setAntes(Number(e.target.value))}
                            className="w-full h-10 rounded-xl bg-white/10 ring-1 ring-white/10 focus:ring-sky-400/60 px-3 text-[16px] font-extrabold tabular-nums text-white outline-none" />
                    </label>
                    <label className="block">
                        <span className="block text-[10px] font-bold uppercase tracking-[0.14em] text-white/50 mb-1.5">Segundos después</span>
                        <input type="number" min={ventana.topes.despuesMin} max={ventana.topes.despuesMax} value={despues} onChange={(e) => setDespues(Number(e.target.value))}
                            className="w-full h-10 rounded-xl bg-white/10 ring-1 ring-white/10 focus:ring-sky-400/60 px-3 text-[16px] font-extrabold tabular-nums text-white outline-none" />
                    </label>
                </div>
                <div className="mx-5 mb-4 rounded-xl bg-white/[0.06] ring-1 ring-white/10 px-3.5 py-3 flex items-start gap-2.5">
                    <Settings2 size={14} className="text-white/45 shrink-0 mt-0.5" />
                    <p className="text-[11.5px] text-white/65 leading-snug">
                        El clip irá de <span className="text-white font-bold tabular-nums">{horaSeg(instante - a * 1000)}</span> a <span className="text-white font-bold tabular-nums">{horaSeg(instante + d * 1000)}</span> ({a + d} s).
                        {" "}Lo configurado en <span className="text-white/85 font-semibold">Ajustes → Video del evento</span> es {ventana.antes} s antes y {ventana.despues} s después
                        {cambiado ? "; el cambio vale sólo para este clip." : "."}
                    </p>
                </div>
                <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-white/10 bg-black/30">
                    <button onClick={onClose} className="h-9 px-4 rounded-xl text-[12.5px] font-bold text-white/70 hover:text-white hover:bg-white/10 transition">Cancelar</button>
                    <a href={href(a, d)} download onClick={onClose}
                        className="h-9 px-4 inline-flex items-center gap-2 rounded-xl bg-sky-500 hover:bg-sky-400 text-white text-[12.5px] font-extrabold shadow-lg active:scale-95 transition"><Download size={15} /> Descargar {a + d} s</a>
                </div>
            </div>
        </div>
    );
}
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


export function LiveModal({ cam, cams = [], geom, initialTab = "live", fromCam, camStatus, initialRecMs, onClose, onOpenEvent, onSwitchCam, onDismissFrom }: { cam: IntrusionCam; cams?: IntrusionCam[]; geom?: Geom; initialTab?: "live" | "rec" | "evi"; fromCam?: IntrusionCam | null; camStatus?: Record<string, { recent: boolean; alarm: boolean }>; initialRecMs?: number; onClose: () => void; onOpenEvent?: (d: DetHistItem) => void; onSwitchCam?: (c: IntrusionCam) => void; onDismissFrom?: () => void }) {
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
    const [recT, setRecT] = useState(initialRecMs || (Date.now() - 60000));      // posición del slider (inmediata)
    const [recLoadT, setRecLoadT] = useState(initialRecMs || (Date.now() - 60000)); // tiempo confirmado (debounced) que se reproduce
    const [globalEnd] = useState(() => initialRecMs ? Math.max(Date.now(), initialRecMs + 60000) : Date.now());
    const [zoomIdx, setZoomIdx] = useState(0);
    const [anchor, setAnchor] = useState(() => initialRecMs || (Date.now() - 60000));
    const [recLoading, setRecLoading] = useState(false);
    const [recEvents, setRecEvents] = useState<DetHistItem[]>([]);
    const [scrub, setScrub] = useState<number | null>(null); // hora que se muestra grande al arrastrar
    const scrubTO = useRef<any>(null);
    const [recRetry, setRecRetry] = useState(0); // para reintentar el clip si queda colgado
    const recTriesRef = useRef(0);
    const recStartedRef = useRef(false);
    const [recRebuf, setRecRebuf] = useState(false);
    const [recSeen, setRecSeen] = useState(initialTab === "rec");
    const [recRate, setRecRate] = useState(1); // velocidad de reproducción (1/2/4/8)
    const [noRec, setNoRec] = useState(false); // no hay grabación en ese horario
    // La ventana de Ajustes: dónde empieza el video que se ve, y qué se le dice al operador al descargar.
    const [ventana, setVentana] = useState<Ventana>(VENTANA_INICIAL);
    useEffect(() => { fetch("/api/playback/ventana", { cache: "no-store" }).then((r) => r.json()).then((d) => { if (d && typeof d.antes === "number") setVentana(d); }).catch(() => { }); }, []);
    const [recPlaying, setRecPlaying] = useState(false);
    /** El operador pausó a propósito: no se le vuelve a arrancar el video hasta que toque play o cambie de instante. */
    const pausadoPorUsuario = useRef(false);
    /** El instante real (ms) del cuadro que se está viendo: lo que sigue el cursor de la regla. */
    const [posMs, setPosMs] = useState<number | null>(null);
    const ultimaPos = useRef(0);
    const [descarga, setDescarga] = useState(false);
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
    const seekTo = (ms: number) => { const v = Math.max(Date.now() - 30 * 24 * 3600 * 1000, Math.min(Date.now(), ms)); pausadoPorUsuario.current = false; setPosMs(null); setRecT(v); setScrub(v); clearTimeout(scrubTO.current); scrubTO.current = setTimeout(() => setScrub(null), 1100); };
    const recVideo = useRef<HTMLVideoElement>(null);
    // Arranca la grabación solo cuando hay ~2.5s de búfer por delante (el NVR entrega a 1x,
    // sin colchón el <video> se queda en buffering constante). Con cushion reproduce fluido.
    const tryPlayCushion = useCallback(() => {
        const v = recVideo.current; if (!v || recStartedRef.current || pausadoPorUsuario.current) return;
        let cushion = 0; try { if (v.buffered.length) cushion = v.buffered.end(v.buffered.length - 1) - (v.currentTime || 0); } catch { }
        if (cushion >= 2.5 || v.readyState >= 4) { v.play().catch(() => { }); }
    }, []);
    // evidencia
    const [evi, setEvi] = useState<DetHistItem[]>([]);
    const [eviBig, setEviBig] = useState<string | null>(null);

    useEffect(() => { fetch(`/api/devices/stream?deviceId=${cam.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "ensure" }) }).catch(() => { }); }, [cam.id]);
    useEffect(() => { fetch(`/api/nvr/channel?deviceId=${cam.id}`, { cache: "no-store" }).then((r) => r.json()).then((d) => setNvrId(d && d.nvr ? String(d.nvr) : null)).catch(() => { }); }, [cam.id]);
    useEffect(() => { if (tab !== "evi") return; getDetectionHistory({ deviceId: cam.id, pageSize: 30 }).then((r) => setEvi(r.items)).catch(() => { }); }, [tab, cam.id]);
    // Los eventos del DÍA que se está mirando (no los últimos 100 de siempre): son las marcas de la regla.
    useEffect(() => {
        if (tab !== "rec") return;
        const [y, mo, da] = recDateStr.split("-").map(Number);
        const d0 = new Date(y, mo - 1, da, 0, 0, 0, 0), d1 = new Date(y, mo - 1, da, 23, 59, 59, 999);
        getDetectionHistory({ deviceId: cam.id, pageSize: 100, type: "ANALYTIC", from: d0.toISOString(), to: d1.toISOString() }).then((r) => setRecEvents(r.items)).catch(() => { });
    }, [tab, cam.id, recDateStr]);
    const marcas = useMemo<MarcaScrub[]>(() => recEvents.map((e) => {
        const d = new Date(e.timestamp); const m = META[e.type] || META.OTHER;
        return { id: e.id, m: d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60, Icon: m.Icon, titulo: `${m.label} · ${horaSeg(d.getTime())}`, tono: e.type === "LINECROSS" || e.type === "INTRUSION" ? "mal" : e.type === "MOTION" ? "info" : "aviso" };
    }), [recEvents]);
    const irAMarca = (k: MarcaScrub) => { const ev = recEvents.find((x) => x.id === k.id); if (ev) seekTo(new Date(ev.timestamp).getTime()); };
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
        if (tab !== "rec") return; setNoRec(false); setRecRebuf(false); setRecPlaying(false); recStartedRef.current = false; const v = recVideo.current;
        // Si a los 1,5 s el colchón no llegó, se arranca igual: esperar más se leía como "no anda".
        const fp = setTimeout(() => { const vv = recVideo.current; if (vv && !recStartedRef.current && !pausadoPorUsuario.current) vv.play().catch(() => { }); }, 1500);
        const wd = setTimeout(() => {
            if (v && v.readyState < 2) {
                if (recTriesRef.current < 2) { recTriesRef.current++; setRecRetry((r) => r + 1); }
                else { setRecLoading(false); setNoRec(true); }
            }
        }, 9000);
        return () => { clearTimeout(wd); clearTimeout(fp); };
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
    const playbackUrl = nvrId && cam.ch != null ? `/api/nvr/playback?ch=${cam.ch}&t=${Math.floor(recLoadT)}&nvr=${nvrId}&dur=${DUR_NAVEGACION_SEG}${recRetry > 0 ? "&tx=1" : ""}` : null;
    /** Dónde empieza el video que se está viendo: el instante pedido menos los segundos "antes" de Ajustes. */
    const clipStart = recLoadT - ventana.antes * 1000;
    const minutosDe = (ms: number) => { const d = new Date(ms); return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60; };
    /** El cursor sigue al video mientras corre; si no, queda donde se lo dejó. */
    const valorRegla = posMs != null && !recLoading ? minutosDe(posMs) : recMinutesOfDay;
    const togglePlay = useCallback(() => {
        const v = recVideo.current; if (!v) return;
        if (v.paused) { pausadoPorUsuario.current = false; v.play().catch(() => { }); }
        else { pausadoPorUsuario.current = true; v.pause(); }
    }, []);
    useEffect(() => {
        if (tab !== "rec") return;
        const k = (e: KeyboardEvent) => {
            const t = e.target as HTMLElement | null;
            if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
            if (e.key === " " || e.key === "k") { e.preventDefault(); togglePlay(); }
        };
        window.addEventListener("keydown", k);
        return () => window.removeEventListener("keydown", k);
    }, [tab, togglePlay]);
    const hrefDescarga = (antes: number, despues: number) => `/api/nvr/playback?ch=${cam.ch}&t=${Math.floor(posMs ?? recT)}&pre=${antes}&dur=${antes + despues}&download=1&nvr=${nvrId}`;

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
                {(tab === "live" || tab === "rec") && <div className="pointer-events-none absolute inset-0 z-[5]"><GeomOverlay geom={geom} /></div>}
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
                        {/* Sin `controls`: los nativos quedaban DEBAJO del degradado de la línea de tiempo,
                            así que había play y pausa pero no se veían. Ahora el botón es nuestro, y el
                            video mismo se toca para pausar/seguir, como en cualquier reproductor. */}
                        {recSeen && playbackUrl ? (
                            <video key={`${playbackUrl}#${recRetry}`} ref={recVideo} src={playbackUrl} muted playsInline preload="auto" poster={snap}
                                onClick={togglePlay}
                                onPlay={() => setRecPlaying(true)} onPause={() => setRecPlaying(false)}
                                onLoadedData={() => { recTriesRef.current = 0; setNoRec(false); try { recVideo.current!.playbackRate = recRate; } catch { } tryPlayCushion(); }} onCanPlay={() => tryPlayCushion()} onProgress={() => tryPlayCushion()}
                                onPlaying={() => { recTriesRef.current = 0; recStartedRef.current = true; setNoRec(false); setRecRebuf(false); waitRealFrame(recVideo.current, () => setRecLoading(false)); }} onWaiting={() => { if (recStartedRef.current) setRecRebuf(true); else setRecLoading(true); }}
                                onTimeUpdate={(e) => {
                                    if (recRebuf) setRecRebuf(false);
                                    // Una vez por segundo alcanza para mover el cursor; a 4 Hz redibujaba todo el modal por nada.
                                    const ms = clipStart + e.currentTarget.currentTime * 1000;
                                    if (Math.abs(ms - ultimaPos.current) >= 900) { ultimaPos.current = ms; setPosMs(ms); }
                                }}
                                onEnded={() => {
                                    const v = recVideo.current; if (!v) return;
                                    // Terminó el tramo: seguir desde donde quedó, salvo que el operador haya pausado o
                                    // el tramo haya muerto enseguida (eso no es un final: es que no había grabación).
                                    if (v.currentTime < MIN_SEG_PARA_ENCADENAR) { if (clipStart < Date.now() - 30000) { setRecLoading(false); setNoRec(true); } return; }
                                    const sig = clipStart + v.currentTime * 1000 + ventana.antes * 1000 + 100;
                                    if (!pausadoPorUsuario.current && sig < Date.now() - 15000) seekTo(sig);
                                }}
                                onError={() => { if (recTriesRef.current < 2) { recTriesRef.current++; setTimeout(() => setRecRetry((r) => r + 1), 800); } else { setRecLoading(false); setNoRec(true); } }}
                                className="absolute inset-0 z-[1] w-full h-full object-contain cursor-pointer" />
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
                        {recRebuf && !recLoading && scrub == null && !noRec && (
                            <div className="absolute top-3 left-3 z-[3] inline-flex items-center gap-1 px-2 py-1 rounded-full bg-black/55 text-white/85 text-[10px] font-bold pointer-events-none">Almacenando búfer<Dots /></div>
                        )}
                        {noRec && scrub == null && (
                            <div className="absolute inset-x-0 top-0 bottom-36 z-[2] grid place-items-center pointer-events-none">
                                <span className="inline-flex flex-col items-center gap-1 text-white/90 drop-shadow-[0_2px_10px_rgba(0,0,0,0.9)]">
                                    <span className="text-lg sm:text-xl font-extrabold">Sin grabación en este horario</span>
                                    <span className="text-[12px] text-white/55">Probá otro momento en la línea de tiempo</span>
                                </span>
                            </div>
                        )}
                        {descarga && <DescargaClip instante={posMs ?? recT} ventana={ventana} href={hrefDescarga} onClose={() => setDescarga(false)} />}
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
                                    {/* play / pausa. La hora que iba acá se fue: ya está grande sobre la regla, y la cámara la quema en el cuadro. */}
                                    <button onClick={togglePlay} disabled={!playbackUrl} data-tooltip-id="mi-tip" data-tooltip-content={recPlaying ? "Pausar (espacio)" : "Reproducir (espacio)"}
                                        className={cn("h-8 w-8 grid place-items-center rounded-full ring-1 transition active:scale-90", recPlaying ? "bg-white text-black ring-white/40" : "bg-red-600 text-white ring-red-400/40 hover:bg-red-500", !playbackUrl && "opacity-40")}>
                                        {recLoading && !noRec ? <Loader2 size={14} className="animate-spin" /> : recPlaying ? <Pause size={14} /> : <Play size={14} className="ml-0.5" />}
                                    </button>
                                    {posMs != null && !recLoading && (
                                        <span className="text-[11px] font-bold tabular-nums text-white/70 drop-shadow" data-tooltip-id="mi-tip" data-tooltip-content="Instante exacto del cuadro que se ve">{horaSeg(posMs)}</span>
                                    )}
                                    {/* velocidad de reproducción */}
                                    <button onClick={() => setRecRate((r) => (r >= 8 ? 1 : r * 2))} data-tooltip-id="mi-tip" data-tooltip-content="Velocidad de reproducción"
                                        className={cn("ml-auto h-8 min-w-[40px] px-2.5 grid place-items-center rounded-full text-[12px] font-extrabold tabular-nums ring-1 ring-white/10 transition", recRate > 1 ? "bg-sky-500/80 text-white ring-sky-400/40" : "bg-white/10 text-white/90 hover:bg-white/15")}>{recRate}x</button>
                                </div>
                                <Scrub step="5" momentum={30} format="24h" width={680} value={valorRegla} start={recMinutesOfDay}
                                    onChange={(mins) => seekTo(dateTimeToMs(recDateStr, mins))}
                                    marcas={marcas} onMarca={irAMarca} />
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
                            <button onClick={() => setDescarga(true)}
                                data-tooltip-id="mi-tip" data-tooltip-content={`Descargar clip · ${ventana.antes} s antes y ${ventana.despues} s después de este instante`}
                                className="w-9 h-9 grid place-items-center rounded-full bg-black/40 hover:bg-sky-500/80 text-white/80 hover:text-white transition-colors backdrop-blur-sm"><Download size={17} /></button>
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

