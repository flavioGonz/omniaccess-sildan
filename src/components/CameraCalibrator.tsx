"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { sileo } from "sileo";
// Adaptador estilo sonner (title, {description}) → sileo ({title, description})
const toast = {
    success: (title: string, o?: { description?: string }) => sileo.success({ title, description: o?.description }),
    error: (title: string, o?: { description?: string }) => sileo.error({ title, description: o?.description }),
    warning: (title: string, o?: { description?: string }) => sileo.warning({ title, description: o?.description }),
    info: (title: string, o?: { description?: string }) => sileo.info({ title, description: o?.description }),
};
import {
    Wand2, Timer, Signal, Layers, Sun, ShieldCheck, Moon, Focus, Car,
    X, Check, Loader2, RefreshCw, Maximize2, Volume2, AlertTriangle, Sparkles,
    SquareDashed, Save, RotateCcw, Crosshair,
} from "lucide-react";

/* ─────────────────────────── Video en vivo (go2rtc) ─────────────────────────── */
function LiveVideo({ streamName, deviceId }: { streamName: string; deviceId: string }) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const [failed, setFailed] = useState(false);
    useEffect(() => {
        const video = videoRef.current; if (!video || !streamName) { setFailed(true); return; }
        let tries = 0, stopped = false, wd: any = null;
        const src = () => `/go2rtc/api/stream.mp4?src=${encodeURIComponent(streamName)}&video=h264&t=${Date.now()}`;
        const arm = () => { clearTimeout(wd); wd = setTimeout(() => { if (stopped) return; if ((video.readyState < 3 || video.paused) && tries++ < 8) start(); else if (tries >= 8) setFailed(true); }, 3500); };
        const start = () => { if (stopped) return; setFailed(false); try { video.src = src(); video.play().catch(() => { }); } catch { } arm(); };
        const onErr = () => { if (stopped) return; if (tries++ < 8) setTimeout(start, 1300); else setFailed(true); };
        const onProgress = () => { try { if (video.buffered.length) { const end = video.buffered.end(video.buffered.length - 1); if (end - video.currentTime > 2.5) video.currentTime = end; } } catch { } };
        const onPlaying = () => { clearTimeout(wd); tries = 0; };
        video.addEventListener("error", onErr); video.addEventListener("progress", onProgress); video.addEventListener("playing", onPlaying);
        start();
        return () => { stopped = true; clearTimeout(wd); video.removeEventListener("error", onErr); video.removeEventListener("progress", onProgress); video.removeEventListener("playing", onPlaying); try { video.pause(); video.removeAttribute("src"); video.load(); } catch { } };
    }, [streamName]);
    if (failed) return <SnapFallback deviceId={deviceId} />;
    return <video ref={videoRef} autoPlay muted playsInline className="absolute inset-0 w-full h-full object-contain" />;
}
function SnapFallback({ deviceId }: { deviceId: string }) {
    const [src, setSrc] = useState(`/api/snapshot/${deviceId}?t=${Date.now()}`);
    useEffect(() => { const iv = setInterval(() => setSrc(`/api/snapshot/${deviceId}?t=${Date.now()}`), 2000); return () => clearInterval(iv); }, [deviceId]);
    return <img src={src} alt="" className="absolute inset-0 w-full h-full object-contain" />;
}

/* ─────────────────────────── SVG animados por concepto ─────────────────────────── */
function CalSvg({ kind }: { kind: string }) {
    const stroke = "currentColor";
    if (kind === "shutter" || kind === "auto") return (
        <svg viewBox="0 0 64 64" className="w-16 h-16 text-amber-300">
            <motion.g style={{ transformOrigin: "32px 32px" }} animate={{ rotate: [0, 30, 0] }} transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}>
                {[0, 60, 120, 180, 240, 300].map((a) => (
                    <polygon key={a} points="32,32 44,10 52,26" fill={stroke} opacity="0.25" transform={`rotate(${a} 32 32)`} />
                ))}
            </motion.g>
            <circle cx="32" cy="32" r="9" fill="none" stroke={stroke} strokeWidth="2" />
        </svg>
    );
    if (kind === "gain") return (
        <svg viewBox="0 0 64 64" className="w-16 h-16 text-cyan-300">
            {[8, 20, 32, 44].map((x, i) => (
                <motion.rect key={x} x={x} width="8" rx="2" fill={stroke}
                    animate={{ height: [10, 34 - i * 4, 10], y: [44, 20 + i * 4, 44] }}
                    transition={{ duration: 1.4, repeat: Infinity, delay: i * 0.15, ease: "easeInOut" }} />
            ))}
        </svg>
    );
    if (kind === "light" || kind === "hlc") return (
        <svg viewBox="0 0 64 64" className="w-16 h-16 text-yellow-300">
            <motion.circle cx="32" cy="32" r="10" fill={stroke} animate={{ opacity: [0.5, 1, 0.5] }} transition={{ duration: 1.6, repeat: Infinity }} />
            {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (
                <motion.line key={a} x1="32" y1="6" x2="32" y2="16" stroke={stroke} strokeWidth="3" strokeLinecap="round"
                    transform={`rotate(${a} 32 32)`} animate={{ opacity: [0.2, 1, 0.2] }} transition={{ duration: 1.6, repeat: Infinity, delay: a / 360 }} />
            ))}
        </svg>
    );
    if (kind === "plate") return (
        <svg viewBox="0 0 64 44" className="w-16 h-12 text-emerald-300">
            <rect x="4" y="8" width="56" height="28" rx="4" fill="none" stroke={stroke} strokeWidth="2" />
            <motion.rect x="4" y="8" width="56" height="28" rx="4" fill={stroke} animate={{ opacity: [0, 0.35, 0] }} transition={{ duration: 1.8, repeat: Infinity }} />
            <text x="32" y="29" textAnchor="middle" fontSize="13" fontWeight="700" fill={stroke}>ABC</text>
        </svg>
    );
    if (kind === "wdr") return (
        <svg viewBox="0 0 64 64" className="w-16 h-16 text-fuchsia-300">
            <rect x="8" y="16" width="48" height="32" rx="4" fill="none" stroke={stroke} strokeWidth="2" />
            <motion.rect x="8" y="16" width="24" height="32" fill={stroke} opacity="0.2" animate={{ width: [24, 40, 24] }} transition={{ duration: 2, repeat: Infinity }} />
        </svg>
    );
    if (kind === "ir" || kind === "moon") return (
        <svg viewBox="0 0 64 64" className="w-16 h-16 text-indigo-300">
            <motion.path d="M40 12a20 20 0 100 40 16 16 0 010-40z" fill={stroke} animate={{ opacity: [0.6, 1, 0.6] }} transition={{ duration: 2, repeat: Infinity }} />
        </svg>
    );
    if (kind === "focus") return (
        <svg viewBox="0 0 64 64" className="w-16 h-16 text-sky-300">
            {[20, 14, 8].map((r, i) => (
                <motion.circle key={r} cx="32" cy="32" r={r} fill="none" stroke={stroke} strokeWidth="2"
                    animate={{ opacity: [0.2, 1, 0.2], scale: [0.95, 1.05, 0.95] }} transition={{ duration: 1.6, repeat: Infinity, delay: i * 0.2 }} style={{ transformOrigin: "32px 32px" }} />
            ))}
            <circle cx="32" cy="32" r="2.5" fill={stroke} />
        </svg>
    );
    if (kind === "road") return (
        <svg viewBox="0 0 64 64" className="w-16 h-16 text-orange-300">
            <path d="M22 56 L28 8 M42 56 L36 8" stroke={stroke} strokeWidth="2" fill="none" />
            {[0, 1, 2].map((i) => (
                <motion.rect key={i} x="30" width="4" height="8" rx="2" fill={stroke}
                    animate={{ y: [-4, 60] }} transition={{ duration: 1.4, repeat: Infinity, delay: i * 0.45, ease: "linear" }} />
            ))}
        </svg>
    );
    return <Sparkles className="w-16 h-16 text-amber-300" />;
}

/* ─────────────────────────── Definición de controles ─────────────────────────── */
type Ctl = {
    key: string; label: string; icon: any; svg: string; detail: string;
    // devuelve {param,value,human} según el estado actual (toggle o ciclo)
    next: (cfg: any) => { param: string; value: any; human: string };
    active?: (cfg: any) => boolean;
    valueText?: (cfg: any) => string;
};

const SHUTTERS = ["1/250", "1/500", "1/1000"];

const CONTROLS: Ctl[] = [
    {
        key: "shutter", label: "Obturador", icon: Timer, svg: "shutter",
        detail: "Cuánto tiempo se expone el sensor. Más lento (1/250–1/500) entra más luz → mejor patente de noche a velocidad de barrio. Más rápido (1/1000) congela autos veloces pero oscurece.",
        valueText: (c) => c.shutter || "—",
        next: (c) => { const i = SHUTTERS.indexOf(c.shutter); const v = SHUTTERS[(i + 1) % SHUTTERS.length] || "1/500"; return { param: "shutter", value: v, human: `Obturador → ${v}` }; },
    },
    {
        key: "gain", label: "Ganancia", icon: Signal, svg: "gain",
        detail: "Amplificación de la señal del sensor. Sube el brillo de noche pero, si es muy alta, mete ruido que arruina el OCR de la matrícula. Tope recomendado ~40.",
        valueText: (c) => (c.gain ?? "—") + "",
        next: (c) => { const v = (c.gain ?? 40) >= 40 ? 20 : 40; return { param: "gain", value: v, human: `Ganancia → ${v}` }; },
    },
    {
        key: "overexpose", label: "Anti-brillo", icon: ShieldCheck, svg: "plate",
        detail: "OverexposeSuppress: evita que los faros 'quemen' en blanco la patente retrorreflectiva. Clave para leer de noche cuando el auto viene de frente.",
        active: (c) => !!c.overexpose,
        valueText: (c) => (c.overexpose ? "ON" : "OFF"),
        next: (c) => ({ param: "overexpose", value: !c.overexpose, human: `Anti-brillo patente → ${!c.overexpose ? "ON" : "OFF"}` }),
    },
    {
        key: "wdr", label: "WDR", icon: Layers, svg: "wdr",
        detail: "Wide Dynamic Range: equilibra zonas claras/oscuras. Para ANPR nocturno conviene APAGADO (mete artefactos en la lectura).",
        active: (c) => c.wdr === "open",
        valueText: (c) => (c.wdr === "open" ? "ON" : "OFF"),
        next: (c) => ({ param: "wdr", value: c.wdr !== "open", human: `WDR → ${c.wdr !== "open" ? "ON" : "OFF"}` }),
    },
    {
        key: "hlc", label: "HLC", icon: Sun, svg: "light",
        detail: "Highlight Compensation: apaga puntualmente los brillos muy fuertes (faros). Encender SÓLO si un carril tiene glare que tapa la patente.",
        active: (c) => !!c.hlc,
        valueText: (c) => (c.hlc ? "ON" : "OFF"),
        next: (c) => ({ param: "hlc", value: !c.hlc, human: `HLC → ${!c.hlc ? "ON" : "OFF"}` }),
    },
    {
        key: "ircut", label: "Filtro IR", icon: Moon, svg: "ir",
        detail: "IrcutFilter: en 'auto' la cámara pasa a modo noche (infrarrojo) cuando baja la luz. La patente reflecta el IR y se lee aunque la escena esté oscura.",
        valueText: (c) => c.ircut || "—",
        next: (c) => { const v = c.ircut === "auto" ? "night" : "auto"; return { param: "ircut", value: v, human: `Filtro IR → ${v}` }; },
    },
    {
        key: "focus", label: "Foco", icon: Focus, svg: "focus",
        detail: "Estilo de enfoque del lente motorizado. 'Semiautomático' reenfoca al cambiar día/noche sin 'cazar' con cada auto. 'Manual' fija el foco donde quede la patente.",
        valueText: (c) => (c.focusStyle || "—").replace("AUTOMATIC", "AUTO").replace("SEMIAUTO", "SEMI"),
        next: (c) => { const v = c.focusStyle === "SEMIAUTOMATIC" ? "MANUAL" : "SEMIAUTOMATIC"; return { param: "focus", value: v, human: `Foco → ${v}` }; },
    },
    {
        key: "anprRoad", label: "Modo vía", icon: Car, svg: "road",
        detail: "Escenario ANPR. 'entrance' asume que el auto frena en barrera. 'city' captura vehículos en movimiento continuo (mejor para barrio abierto sin barrera).",
        valueText: (c) => c.anprRoad || "—",
        next: (c) => { const v = c.anprRoad === "entrance" ? "city" : "entrance"; return { param: "anprRoad", value: v, human: `Modo vía → ${v}` }; },
    },
];

/* ─────────────────────────── Componente principal ─────────────────────────── */
export function CameraCalibrator({ device, onClose }: { device: any; onClose: () => void }) {
    const [cfg, setCfg] = useState<any>(null);
    const [loadingCfg, setLoadingCfg] = useState(true);
    const [hover, setHover] = useState<string | null>(null);
    const [confirm, setConfirm] = useState<null | { kind: "single" | "auto"; ctl?: Ctl; action?: any }>(null);
    const [busy, setBusy] = useState<string | null>(null);
    const [autoSteps, setAutoSteps] = useState<any[]>([]);
    const [autoRunning, setAutoRunning] = useState(false);
    const [videoNonce, setVideoNonce] = useState(0);
    // Editor de región ANPR (línea de captura)
    const [regionMode, setRegionMode] = useState(false);
    const [region, setRegion] = useState<any>(null);
    const [regionLoading, setRegionLoading] = useState(false);
    const [regionSaving, setRegionSaving] = useState(false);
    const [confirmRegion, setConfirmRegion] = useState(false);
    const drag = useRef<null | { type: "lane" | "calib"; li: number; pi: number }>(null);
    const svgRef = useRef<SVGSVGElement>(null);

    const streamName = `lpr_${device.id}_hd`;
    const LANE_COLORS = ["#f59e0b", "#22d3ee", "#a78bfa", "#34d399"];

    const loadCfg = useCallback(async () => {
        setLoadingCfg(true);
        try {
            const r = await fetch(`/api/devices/camera-config?deviceId=${device.id}`, { cache: "no-store" });
            const j = await r.json();
            if (j.ok) setCfg(j.config); else toast.error("No se pudo leer la config de la cámara");
        } catch { toast.error("Error leyendo la cámara"); }
        finally { setLoadingCfg(false); }
    }, [device.id]);

    useEffect(() => { loadCfg(); }, [loadCfg]);
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [onClose]);

    async function applySingle(ctl: Ctl, action: any) {
        setBusy(ctl.key); setConfirm(null);
        try {
            const r = await fetch(`/api/devices/camera-config?deviceId=${device.id}`, {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ param: action.param, value: action.value }),
            });
            const j = await r.json();
            if (j.ok) {
                toast.success(action.human, { description: "Aplicado en la cámara — mirá el efecto en el video" });
                setTimeout(() => setVideoNonce((n) => n + 1), 800);
                setTimeout(loadCfg, 1200);
            } else toast.error("No se pudo aplicar", { description: j.error });
        } catch (e: any) { toast.error("Error aplicando", { description: e?.message }); }
        finally { setBusy(null); }
    }

    // ── Región ANPR (línea de captura) ──
    async function openRegion() {
        setRegionLoading(true); setRegionMode(true);
        try {
            const r = await fetch(`/api/devices/anpr-region?deviceId=${device.id}`, { cache: "no-store" });
            const j = await r.json();
            if (j.ok) setRegion(j.region);
            else { toast.error("No se pudo leer la región ANPR", { description: j.error }); setRegionMode(false); }
        } catch (e: any) { toast.error("Error leyendo la región", { description: e?.message }); setRegionMode(false); }
        finally { setRegionLoading(false); }
    }
    function closeRegion() { setRegionMode(false); setRegion(null); drag.current = null; }

    // convierte un punto de dispositivo (0-1000, origen abajo-izq) a coords SVG (0-1000 top-left)
    const toSvg = (p: any) => ({ x: p.x, y: 1000 - p.y });
    function svgFromEvent(e: any) {
        const svg = svgRef.current; if (!svg) return null;
        const rect = svg.getBoundingClientRect();
        const cx = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
        const cy = (e.touches ? e.touches[0].clientY : e.clientY) - rect.top;
        return { sx: Math.max(0, Math.min(1000, (cx / rect.width) * 1000)), sy: Math.max(0, Math.min(1000, (cy / rect.height) * 1000)) };
    }
    function onDragMove(e: any) {
        if (!drag.current || !region) return;
        const c = svgFromEvent(e); if (!c) return;
        const devPt = { x: Math.round(c.sx), y: Math.round(1000 - c.sy) }; // invertir Y de vuelta a coords equipo
        setRegion((prev: any) => {
            const next = JSON.parse(JSON.stringify(prev));
            const d = drag.current!;
            if (d.type === "lane") next.lanes[d.li].points[d.pi] = devPt;
            else next.calib[d.pi] = devPt;
            return next;
        });
    }
    async function saveRegion() {
        setConfirmRegion(false); setRegionSaving(true);
        try {
            const r = await fetch(`/api/devices/anpr-region?deviceId=${device.id}`, {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ lanes: region.lanes, calib: region.calib }),
            });
            const j = await r.json();
            if (j.ok) { toast.success("Región de detección guardada", { description: "La cámara ya usa la nueva línea de captura" }); }
            else toast.error("No se pudo guardar la región", { description: j.error });
        } catch (e: any) { toast.error("Error guardando la región", { description: e?.message }); }
        finally { setRegionSaving(false); }
    }

    async function runAuto() {
        setConfirm(null); setAutoRunning(true);
        try {
            const stepsRes = await fetch(`/api/devices/auto-calibrate?deviceId=${device.id}`);
            const sj = await stepsRes.json();
            const steps = (sj.steps || []).map((s: any) => ({ ...s, status: "pending" }));
            setAutoSteps(steps);
            // animación optimista: marcamos "running" secuencial mientras el server aplica
            const r = await fetch(`/api/devices/auto-calibrate?deviceId=${device.id}`, { method: "POST" });
            const j = await r.json();
            const results: any[] = j.results || [];
            // revelar paso a paso
            for (let i = 0; i < results.length; i++) {
                await new Promise((res) => setTimeout(res, 420));
                setAutoSteps((prev) => prev.map((s) => s.key === results[i].key ? { ...s, status: results[i].ok ? "ok" : "fail", error: results[i].error } : s));
                setVideoNonce((n) => n + 1);
            }
            if (j.ok) toast.success(`Calibración aplicada (${j.applied}/${j.total})`, { description: "Perfil ANPR barrio-nocturno activo" });
            else toast.error("La calibración falló");
            setTimeout(loadCfg, 1200);
        } catch (e: any) { toast.error("Error en auto-calibración", { description: e?.message }); }
        finally { setAutoRunning(false); }
    }

    const active = hover ? CONTROLS.find((c) => c.key === hover) : null;

    return (
        <div className="fixed inset-0 z-[3300] flex items-center justify-center bg-black/95 backdrop-blur-sm p-3 md:p-6 animate-in fade-in duration-200">
            <div className="relative w-full max-w-6xl h-[88vh] rounded-2xl overflow-hidden shadow-2xl bg-black border border-white/10 flex flex-col">
                {/* Video */}
                <div className="relative flex-1 bg-black group">
                    <LiveVideo key={`${streamName}-${videoNonce}`} streamName={streamName} deviceId={device.id} />

                    {/* ── Editor de región ANPR (línea de captura) ── */}
                    {regionMode && (
                        <div className="absolute inset-0 z-30 bg-black/92 backdrop-blur-[2px] flex flex-col">
                            <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/10">
                                <div className="flex items-center gap-2 text-cyan-300">
                                    <SquareDashed size={16} />
                                    <span className="text-xs font-bold uppercase tracking-wide">Línea de captura ANPR</span>
                                    <span className="text-[10px] text-white/50">· arrastrá los puntos</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <button onClick={openRegion} disabled={regionLoading} className="h-8 px-3 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] text-white/80 text-[11px] font-semibold flex items-center gap-1.5"><RotateCcw size={13} /> Revertir</button>
                                    <button onClick={closeRegion} className="h-8 px-3 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] text-white/80 text-[11px] font-semibold flex items-center gap-1.5"><X size={13} /> Cerrar</button>
                                    <button onClick={() => setConfirmRegion(true)} disabled={!region || regionSaving} className="h-8 px-4 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-black text-[11px] font-bold flex items-center gap-1.5 disabled:opacity-50">
                                        {regionSaving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Guardar
                                    </button>
                                </div>
                            </div>
                            <div className="flex-1 flex items-center justify-center p-3 overflow-hidden">
                                {regionLoading ? (
                                    <div className="flex items-center gap-2 text-white/70 text-sm"><Loader2 size={16} className="animate-spin" /> Leyendo región…</div>
                                ) : region ? (
                                    <div className="relative inline-block">
                                        <img src={`/api/snapshot/${device.id}?t=${videoNonce}`} alt="" className="block max-h-[64vh] max-w-full object-contain select-none pointer-events-none rounded-lg" draggable={false} />
                                        <svg ref={svgRef} viewBox="0 0 1000 1000" preserveAspectRatio="none"
                                            className="absolute inset-0 w-full h-full touch-none"
                                            onMouseMove={onDragMove} onMouseUp={() => (drag.current = null)} onMouseLeave={() => (drag.current = null)}
                                            onTouchMove={onDragMove} onTouchEnd={() => (drag.current = null)}>
                                            {/* zona de detección entre los dos carriles */}
                                            {region.lanes.length >= 2 && (() => {
                                                const a = region.lanes[0].points.map(toSvg); const b = region.lanes[1].points.map(toSvg);
                                                if (a.length < 2 || b.length < 2) return null;
                                                return <polygon points={`${a[0].x},${a[0].y} ${a[1].x},${a[1].y} ${b[1].x},${b[1].y} ${b[0].x},${b[0].y}`} fill="rgba(34,211,238,0.10)" stroke="none" />;
                                            })()}
                                            {/* carriles */}
                                            {region.lanes.map((ln: any, li: number) => {
                                                const p = ln.points.map(toSvg); const col = LANE_COLORS[li % 4];
                                                return (
                                                    <g key={li}>
                                                        {p.length >= 2 && <line x1={p[0].x} y1={p[0].y} x2={p[1].x} y2={p[1].y} stroke={col} strokeWidth={4} vectorEffect="non-scaling-stroke" />}
                                                        {p.map((pt: any, pi: number) => (
                                                            <circle key={pi} cx={pt.x} cy={pt.y} r={11} fill={col} stroke="#000" strokeWidth={2} vectorEffect="non-scaling-stroke"
                                                                style={{ cursor: "grab" }}
                                                                onMouseDown={() => (drag.current = { type: "lane", li, pi })}
                                                                onTouchStart={() => (drag.current = { type: "lane", li, pi })} />
                                                        ))}
                                                    </g>
                                                );
                                            })}
                                            {/* línea de calibración */}
                                            {region.calib?.length >= 2 && (() => {
                                                const p = region.calib.map(toSvg);
                                                return (
                                                    <g>
                                                        <line x1={p[0].x} y1={p[0].y} x2={p[1].x} y2={p[1].y} stroke="#34d399" strokeWidth={3} strokeDasharray="14 9" vectorEffect="non-scaling-stroke" />
                                                        {p.map((pt: any, pi: number) => (
                                                            <circle key={pi} cx={pt.x} cy={pt.y} r={10} fill="#34d399" stroke="#000" strokeWidth={2} vectorEffect="non-scaling-stroke"
                                                                style={{ cursor: "grab" }}
                                                                onMouseDown={() => (drag.current = { type: "calib", li: 0, pi })}
                                                                onTouchStart={() => (drag.current = { type: "calib", li: 0, pi })} />
                                                        ))}
                                                    </g>
                                                );
                                            })()}
                                        </svg>
                                    </div>
                                ) : (
                                    <div className="text-white/60 text-sm">Sin región disponible</div>
                                )}
                            </div>
                            {/* leyenda */}
                            <div className="flex items-center justify-center gap-4 px-4 py-2 border-t border-white/10 text-[10px] text-white/60">
                                <span className="flex items-center gap-1.5"><span className="w-3 h-0.5" style={{ background: LANE_COLORS[0] }} /> Carril 1</span>
                                {region?.lanes?.length >= 2 && <span className="flex items-center gap-1.5"><span className="w-3 h-0.5" style={{ background: LANE_COLORS[1] }} /> Carril 2</span>}
                                <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 border-t border-dashed border-emerald-400" /> Línea de calibración</span>
                                <span className="flex items-center gap-1.5"><Crosshair size={11} className="text-cyan-300" /> Zona de lectura de patente</span>
                            </div>
                        </div>
                    )}

                    {/* Confirmación guardar región */}
                    <AnimatePresence>
                        {confirmRegion && (
                            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 z-40 flex items-center justify-center bg-black/70 backdrop-blur-sm">
                                <motion.div initial={{ scale: 0.92, y: 12 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.92, y: 12 }} className="w-[360px] rounded-2xl bg-neutral-900/95 border border-white/10 p-5 text-center">
                                    <div className="mx-auto mb-3 flex justify-center"><SquareDashed size={44} className="text-cyan-300" /></div>
                                    <p className="text-white font-bold text-base mb-1">Guardar línea de captura</p>
                                    <p className="text-[12px] text-white/70 mb-4">Se escribirá la nueva región de detección ANPR en <b>{device.name}</b>. Afecta qué zona de la imagen lee patentes. Reversible.</p>
                                    <div className="flex gap-2">
                                        <button onClick={() => setConfirmRegion(false)} className="flex-1 py-2.5 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] text-white text-sm font-semibold">Cancelar</button>
                                        <button onClick={saveRegion} className="flex-1 py-2.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-black text-sm font-bold flex items-center justify-center gap-1.5"><Check size={15} /> Sí, guardar</button>
                                    </div>
                                </motion.div>
                            </motion.div>
                        )}
                    </AnimatePresence>

                    {/* Top bar */}
                    <div className="absolute top-3 left-3 flex items-center gap-2 px-3 py-1.5 rounded-full bg-black/50 backdrop-blur-md">
                        <span className="flex h-2 w-2 relative"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" /><span className="relative inline-flex rounded-full h-2 w-2 bg-red-500" /></span>
                        <span className="text-[10px] font-bold text-white uppercase tracking-wide">Calibración</span>
                        <span className="text-[10px] text-white/70">· {device.name}</span>
                    </div>
                    <button onClick={onClose} className="absolute top-3 right-3 h-9 w-9 rounded-full bg-black/50 backdrop-blur-md text-white/90 hover:bg-black/70 flex items-center justify-center transition-colors z-10"><X size={18} /></button>

                    {/* Panel explicativo (hover) */}
                    <AnimatePresence>
                        {active && (
                            <motion.div
                                initial={{ opacity: 0, y: 16, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 16, scale: 0.96 }}
                                transition={{ type: "spring", stiffness: 320, damping: 26 }}
                                className="absolute left-3 bottom-24 md:bottom-28 w-[300px] rounded-xl bg-white/[0.07] backdrop-blur-2xl border border-white/10 p-4 shadow-2xl">
                                <div className="flex items-center gap-3 mb-2">
                                    <div className="shrink-0"><CalSvg kind={active.svg} /></div>
                                    <div>
                                        <p className="text-white font-bold text-sm">{active.label}</p>
                                        {cfg && <p className="text-[11px] text-white/60 font-mono">actual: {active.valueText?.(cfg)}</p>}
                                    </div>
                                </div>
                                <p className="text-[12px] text-white/80 leading-relaxed">{active.detail}</p>
                            </motion.div>
                        )}
                    </AnimatePresence>

                    {/* Auto-calibración: stepper */}
                    <AnimatePresence>
                        {(autoRunning || autoSteps.length > 0) && (
                            <motion.div initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 30 }}
                                className="absolute right-3 top-16 w-[290px] max-h-[60vh] overflow-auto rounded-xl bg-white/[0.07] backdrop-blur-2xl border border-white/10 p-3 shadow-2xl">
                                <div className="flex items-center gap-2 mb-2 text-amber-300">
                                    <Wand2 size={15} /><span className="text-xs font-bold uppercase tracking-wide">Perfil ANPR barrio-noche</span>
                                </div>
                                <div className="space-y-1.5">
                                    {autoSteps.map((s) => (
                                        <div key={s.key} className="flex items-start gap-2 rounded-lg px-2 py-1.5 bg-white/[0.03]">
                                            <div className="mt-0.5">
                                                {s.status === "ok" ? <Check size={14} className="text-emerald-400" />
                                                    : s.status === "fail" ? <AlertTriangle size={14} className="text-red-400" />
                                                        : <Loader2 size={14} className="text-white/40 animate-spin" />}
                                            </div>
                                            <div>
                                                <p className="text-[11px] font-semibold text-white/90">{s.label}</p>
                                                <p className="text-[10px] text-white/55 leading-snug">{s.detail}</p>
                                                {s.error && <p className="text-[10px] text-red-400">{s.error}</p>}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                                {!autoRunning && <button onClick={() => setAutoSteps([])} className="mt-2 w-full text-[11px] text-white/60 hover:text-white py-1.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] transition">Cerrar resumen</button>}
                            </motion.div>
                        )}
                    </AnimatePresence>

                    {/* Confirmación */}
                    <AnimatePresence>
                        {confirm && (
                            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 z-20 flex items-center justify-center bg-black/60 backdrop-blur-sm">
                                <motion.div initial={{ scale: 0.92, y: 12 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.92, y: 12 }}
                                    className="w-[360px] rounded-2xl bg-neutral-900/90 border border-white/10 p-5 shadow-2xl text-center">
                                    <div className="mx-auto mb-3 flex justify-center"><CalSvg kind={confirm.kind === "auto" ? "auto" : (confirm.ctl?.svg || "auto")} /></div>
                                    {confirm.kind === "auto" ? (
                                        <>
                                            <p className="text-white font-bold text-base mb-1">Auto-calibración ANPR</p>
                                            <p className="text-[12px] text-white/70 mb-4">Se aplicará el perfil <b>barrio abierto / nocturno</b> (obturador 1/500, anti-brillo ON, WDR off, ganancia 40, IR auto, foco semi). Es reversible. ¿Aplico en <b>{device.name}</b>?</p>
                                        </>
                                    ) : (
                                        <>
                                            <p className="text-white font-bold text-base mb-1">{confirm.action?.human}</p>
                                            <p className="text-[12px] text-white/70 mb-4">{confirm.ctl?.detail}</p>
                                        </>
                                    )}
                                    <div className="flex gap-2">
                                        <button onClick={() => setConfirm(null)} className="flex-1 py-2.5 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] text-white text-sm font-semibold transition">Cancelar</button>
                                        <button onClick={() => confirm.kind === "auto" ? runAuto() : applySingle(confirm.ctl!, confirm.action)}
                                            className="flex-1 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-black text-sm font-bold transition flex items-center justify-center gap-1.5">
                                            <Check size={15} /> Sí, aplicar
                                        </button>
                                    </div>
                                </motion.div>
                            </motion.div>
                        )}
                    </AnimatePresence>

                    {/* Loading config */}
                    {loadingCfg && (
                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                            <div className="flex items-center gap-2 px-3 py-2 rounded-full bg-black/60 text-white/80 text-xs"><Loader2 size={14} className="animate-spin" /> Leyendo cámara…</div>
                        </div>
                    )}
                </div>

                {/* Rail de controles */}
                <div className="shrink-0 bg-neutral-950/95 border-t border-white/10 px-3 py-3">
                    <div className="flex items-center gap-2 overflow-x-auto">
                        {/* Auto */}
                        <button
                            onClick={() => setConfirm({ kind: "auto" })}
                            disabled={autoRunning || loadingCfg}
                            className="shrink-0 flex items-center gap-2 px-4 h-14 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 text-black font-bold shadow-lg shadow-amber-500/20 hover:brightness-110 active:scale-95 transition disabled:opacity-50">
                            {autoRunning ? <Loader2 size={20} className="animate-spin" /> : <Wand2 size={20} />}
                            <div className="text-left leading-tight">
                                <div className="text-sm">Auto-calibración</div>
                                <div className="text-[10px] font-semibold opacity-80">Perfil ANPR barrio-noche</div>
                            </div>
                        </button>

                        <div className="w-px h-10 bg-white/10 mx-1 shrink-0" />

                        {CONTROLS.map((ctl) => {
                            const Icon = ctl.icon;
                            const on = cfg && ctl.active ? ctl.active(cfg) : undefined;
                            const isBusy = busy === ctl.key;
                            return (
                                <button
                                    key={ctl.key}
                                    onMouseEnter={() => setHover(ctl.key)} onMouseLeave={() => setHover((h) => h === ctl.key ? null : h)}
                                    onClick={() => { if (!cfg) return; const action = ctl.next(cfg); setConfirm({ kind: "single", ctl, action }); }}
                                    disabled={loadingCfg || !!busy}
                                    className={[
                                        "shrink-0 relative flex flex-col items-center justify-center gap-0.5 w-[76px] h-14 rounded-xl border transition active:scale-95",
                                        on === true ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-300"
                                            : on === false ? "bg-white/[0.03] border-white/10 text-white/50"
                                                : "bg-white/[0.05] border-white/10 text-white/80 hover:bg-white/[0.1]",
                                        (loadingCfg || busy) ? "opacity-60" : "",
                                    ].join(" ")}>
                                    {isBusy ? <Loader2 size={18} className="animate-spin" /> : <Icon size={18} />}
                                    <span className="text-[9px] font-bold uppercase tracking-wide">{ctl.label}</span>
                                    {cfg && <span className="text-[8px] font-mono text-white/50 leading-none">{ctl.valueText?.(cfg)}</span>}
                                </button>
                            );
                        })}

                        <div className="w-px h-10 bg-white/10 mx-1 shrink-0" />
                        <button
                            onClick={() => (regionMode ? closeRegion() : openRegion())}
                            className={[
                                "shrink-0 flex items-center gap-2 px-3 h-14 rounded-xl border transition active:scale-95",
                                regionMode ? "bg-cyan-500/20 border-cyan-400/50 text-cyan-200" : "bg-white/[0.05] border-white/10 text-white/80 hover:bg-white/[0.1]",
                            ].join(" ")}>
                            <SquareDashed size={20} />
                            <div className="text-left leading-tight">
                                <div className="text-xs font-bold">Línea de captura</div>
                                <div className="text-[9px] font-semibold opacity-70">Región ANPR editable</div>
                            </div>
                        </button>

                        <div className="flex-1" />
                        <button onClick={loadCfg} className="shrink-0 h-14 w-12 rounded-xl bg-white/[0.05] border border-white/10 text-white/70 hover:bg-white/[0.1] flex items-center justify-center" title="Releer cámara"><RefreshCw size={16} className={loadingCfg ? "animate-spin" : ""} /></button>
                    </div>
                    <p className="text-[10px] text-white/40 mt-2 px-1">Pasá el mouse por cada control para ver qué hace. Todo cambio pide confirmación y es reversible; el efecto se ve en el video en vivo.</p>
                </div>
            </div>
        </div>
    );
}

export default CameraCalibrator;
