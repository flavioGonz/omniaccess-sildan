"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { DeleteButton } from "@/components/ui/delete-button";
import {
    Rows3, Plus, Trash2, Pencil, Save, X, Shield, Gauge, Video,
    RefreshCw, Bell, BellOff, AlertTriangle, Target, Clock,
    Users, TrendingUp, Pause, Play, Volume2, VolumeX,
    Zap, Activity, Settings2, Camera, Eye, EyeOff, Minus, ArrowRight, ArrowLeft,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
    getQueueAlerts,
    createQueueAlert,
    updateQueueAlert,
    deleteQueueAlert,
    getQueueDevices,
    getLatestQueueCounts,
    getQueueStatsToday,
} from "@/app/actions/queue";
import { getSetting, updateSetting } from "@/app/actions/settings";
import { toast } from "sonner";
import io from "socket.io-client";
import { OnvifDiscoveryPanel } from "@/components/OnvifDiscoveryPanel";

interface Alert {
    id: string;
    name: string;
    deviceId: string | null;
    channelName: string | null;
    threshold: number;
    enabled: boolean;
    cooldownMin: number;
    cooldownSec?: number | null;
    lastFiredAt: Date | null;
    device?: { id: string; name: string; ip: string } | null;
}

interface Device { id: string; name: string; ip: string; location: string | null; }

interface ChannelLive {
    channelName: string;
    peopleCount: number;
    lastUpdate: Date;
    snapshotPath: string | null;
}

interface DeviceLive {
    device: { id: string; name: string; ip: string; location: string | null };
    channels: ChannelLive[];
}

interface DayStats { totalEvents: number; avgCount: number; maxCount: number; alertsFired: number; }

function getStreamName(ip: string): string {
    return `bosch_${ip.replace(/\./g, "_")}`;
}

function playAlertSound() {
    try {
        const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain); gain.connect(ctx.destination);
        osc.frequency.value = 880; osc.type = "sine";
        gain.gain.setValueAtTime(0.3, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);
        osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.5);
        const osc2 = ctx.createOscillator();
        const gain2 = ctx.createGain();
        osc2.connect(gain2); gain2.connect(ctx.destination);
        osc2.frequency.value = 1100; osc2.type = "sine";
        gain2.gain.setValueAtTime(0.3, ctx.currentTime + 0.15);
        gain2.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.65);
        osc2.start(ctx.currentTime + 0.15); osc2.stop(ctx.currentTime + 0.65);
    } catch {}
}

function snapUrl(path: string | null): string | null {
    if (!path) return null;
    return path.startsWith("/") ? path : `/api/files/lpr-prod/${path}`;
}

// Animated Counter
function AnimatedCounter({ value, className }: { value: number; className?: string }) {
    const [display, setDisplay] = useState(value);
    const animRef = useRef<number | null>(null);
    const currentRef = useRef(value);
    useEffect(() => {
        const start = currentRef.current;
        const end = value;
        if (start === end) return;
        const duration = 600;
        const startTime = performance.now();
        const animate = (now: number) => {
            const elapsed = now - startTime;
            const progress = Math.min(elapsed / duration, 1);
            const eased = 1 - Math.pow(1 - progress, 3);
            const current = Math.round(start + (end - start) * eased);
            setDisplay(current);
            currentRef.current = current;
            if (progress < 1) { animRef.current = requestAnimationFrame(animate); }
            else { currentRef.current = end; }
        };
        animRef.current = requestAnimationFrame(animate);
        return () => { if (animRef.current) cancelAnimationFrame(animRef.current); };
    }, [value]);
    return <span className={className}>{display}</span>;
}

// Live video via go2rtc fragmented MP4 over HTTP (no WebSocket — robust through reverse proxies).
// H.264 passthrough: the browser plays the camera's stream directly, zero transcoding.
function LiveVideo({ streamName, className, fallbackDeviceId }: { streamName: string; className?: string; fallbackDeviceId: string }) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const [failed, setFailed] = useState(false);
    const retryRef = useRef(0);

    useEffect(() => {
        if (!streamName) { setFailed(true); return; }
        setFailed(false);
        retryRef.current = 0;
        const video = videoRef.current;
        if (!video) return;

        let destroyed = false;
        let retryTimer: ReturnType<typeof setTimeout> | null = null;
        const src = `/go2rtc/api/stream.mp4?src=${encodeURIComponent(streamName)}`;

        function load() {
            if (destroyed || !video) return;
            video.src = src;
            video.play().catch(() => {});
        }

        function onError() {
            if (destroyed) return;
            retryRef.current++;
            if (retryRef.current > 6) { setFailed(true); return; }
            retryTimer = setTimeout(load, Math.min(1000 * retryRef.current, 5000));
        }

        // Keep playback pinned to the live edge (avoid drift/lag build-up).
        function onProgress() {
            if (!video || video.buffered.length === 0) return;
            const end = video.buffered.end(video.buffered.length - 1);
            if (end - video.currentTime > 3) video.currentTime = end - 0.4;
        }

        video.addEventListener("error", onError);
        video.addEventListener("progress", onProgress);
        load();

        return () => {
            destroyed = true;
            if (retryTimer) clearTimeout(retryTimer);
            video.removeEventListener("error", onError);
            video.removeEventListener("progress", onProgress);
            video.pause();
            video.removeAttribute("src");
            video.load();
        };
    }, [streamName]);

    if (failed) return <FallbackSnapshot deviceId={fallbackDeviceId} className={className} />;

    return (
        <video
            ref={videoRef}
            className={cn("object-cover", className)}
            autoPlay
            muted
            playsInline
        />
    );
}

function FallbackSnapshot({ deviceId, className }: { deviceId: string; className?: string }) {
    const [src, setSrc] = useState(`/api/snapshot/${deviceId}?t=${Date.now()}`);
    const [hasError, setHasError] = useState(false);
    useEffect(() => {
        const iv = setInterval(() => { setSrc(`/api/snapshot/${deviceId}?t=${Date.now()}`); setHasError(false); }, 5000);
        return () => clearInterval(iv);
    }, [deviceId]);
    if (hasError) return (
        <div className={cn("flex flex-col items-center justify-center gap-2 bg-muted", className)}>
            <div className="relative">
                <Camera className="w-10 h-10 text-muted-foreground" />
                <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
            </div>
            <span className="text-xs font-semibold text-foreground/70">Cámara offline</span>
            <span className="text-[10px] text-muted-foreground">Sin señal · reintentando…</span>
        </div>
    );
    return <img src={src} alt="Live" className={cn("object-cover", className)} onError={() => setHasError(true)} draggable={false} />;
}

// ─── LINE DRAWING OVERLAY ─────────────────────────────
const LINE_COLORS = ["#f43f5e", "#3b82f6", "#10b981", "#f59e0b", "#a855f7", "#06b6d4"];

// ─── VCA ANALYTICS OVERLAY (Camera Zones) ─────────────
interface VCARule {
    name: string;
    type: "EnteringField" | "LeavingField" | "OccupancyCounting" | "LineCounting" | "Unknown";
    armed: boolean;
    points: { x: number; y: number }[];
    rawPoints: { x: number; y: number }[];
}

const VCA_COLORS: Record<string, { stroke: string; fill: string; label: string }> = {
    EnteringField:     { stroke: "#10b981", fill: "rgba(16,185,129,0.08)",  label: "#10b981" },
    LeavingField:      { stroke: "#3b82f6", fill: "rgba(59,130,246,0.08)",  label: "#3b82f6" },
    OccupancyCounting: { stroke: "#a855f7", fill: "rgba(168,85,247,0.10)",  label: "#a855f7" },
    LineCounting:      { stroke: "#f59e0b", fill: "none",                    label: "#f59e0b" },
    Unknown:           { stroke: "#6b7280", fill: "rgba(107,114,128,0.06)", label: "#6b7280" },
};

const VCA_ICONS: Record<string, string> = {
    EnteringField: "\u2192",      // →
    LeavingField: "\u2190",       // ←
    OccupancyCounting: "\u2302",  // ⌂
    LineCounting: "\u2502",       // │
    Unknown: "?",
};

// Maps a VCA rule to its live count by channel name (exact match first, then fallbacks by type)
function getRuleCount(rule: VCARule, liveCounts: { channelName: string; peopleCount: number }[]): number | null {
    const find = (names: string[]): number | null => {
        for (const n of names) {
            const ch = liveCounts.find(c => c.channelName === n);
            if (ch) return ch.peopleCount;
        }
        return null;
    };
    if (rule.type === "OccupancyCounting") return find([rule.name, "Aforo", "IVA Aforo", "Occupancy", "Ocupación"]);
    if (rule.type === "EnteringField")     return find([rule.name, "Entrada", "Entering"]);
    if (rule.type === "LeavingField")      return find([rule.name, "Salida", "Leaving"]);
    if (rule.type === "LineCounting")      return find([rule.name, "Contador", "Counter"]);
    return null;
}

// VCA overlay renders ONLY the zone shapes (polygons / lines). All textual
// data (names, counts, alarms) lives in the side panels, never over the video.
function VCAOverlay({ rules, showVca }: {
    rules: VCARule[];
    showVca: boolean;
}) {
    if (!showVca || rules.length === 0) return null;

    return (
        <svg
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            className="absolute inset-0 w-full h-full z-[8] pointer-events-none"
        >
            <defs>
                <filter id="vcaGlow" x="-20%" y="-20%" width="140%" height="140%">
                    <feGaussianBlur in="SourceAlpha" stdDeviation="0.5" result="blur" />
                    <feFlood floodColor="white" floodOpacity="0.3" />
                    <feComposite in2="blur" operator="in" />
                    <feMerge>
                        <feMergeNode />
                        <feMergeNode in="SourceGraphic" />
                    </feMerge>
                </filter>
            </defs>

            {rules.map((rule, idx) => {
                const colors = VCA_COLORS[rule.type] || VCA_COLORS.Unknown;
                const isLine = rule.type === "LineCounting";

                if (isLine && rule.points.length >= 2) {
                    const p1 = rule.points[0];
                    const p2 = rule.points[rule.points.length - 1];
                    return (
                        <g key={`vca-${idx}`}>
                            <line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke={colors.stroke} strokeWidth="0.5" strokeLinecap="round" opacity={0.9} filter="url(#vcaGlow)" />
                            <line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke={colors.stroke} strokeWidth="0.2" strokeDasharray="1.2 0.6" opacity={0.5} />
                            <circle cx={p1.x} cy={p1.y} r="0.6" fill={colors.stroke} opacity={0.8} />
                            <circle cx={p2.x} cy={p2.y} r="0.6" fill={colors.stroke} opacity={0.8} />
                        </g>
                    );
                }

                const pathD = rule.points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ") + " Z";
                return (
                    <g key={`vca-${idx}`}>
                        <path d={pathD} fill={colors.fill} stroke={colors.stroke} strokeWidth="0.35" strokeLinejoin="round" opacity={0.85} filter="url(#vcaGlow)" />
                        <path d={pathD} fill="none" stroke={colors.stroke} strokeWidth="0.15" strokeDasharray="1 0.5" opacity={0.4} />
                        {rule.points.map((pt, pi) => (
                            <circle key={pi} cx={pt.x} cy={pt.y} r="0.4" fill={colors.stroke} opacity={0.7} />
                        ))}
                    </g>
                );
            })}
        </svg>
    );
}

// Alert Toast with photo
function showQueueAlertToast(data: { alertName: string; deviceName: string; channelName: string; peopleCount: number; threshold: number; snapshotPath: string | null }) {
    const imgSrc = snapUrl(data.snapshotPath);
    toast.custom(
        () => (
            <div className="bg-card border border-red-500/40 rounded-xl overflow-hidden shadow-lg shadow-red-500/20 w-[380px] animate-in slide-in-from-right-5 duration-300">
                {imgSrc && (
                    <div className="relative h-32 overflow-hidden">
                        <img src={imgSrc} alt="" className="w-full h-full object-cover" />
                        <div className="absolute inset-0 bg-gradient-to-t from-zinc-900 via-zinc-900/40 to-transparent" />
                        <div className="absolute bottom-2 left-3 flex items-center gap-2">
                            <div className="bg-red-500 text-foreground text-[10px] font-bold px-2 py-0.5 rounded-md uppercase tracking-wider animate-pulse">Alerta</div>
                        </div>
                        <div className="absolute bottom-2 right-3">
                            <span className="text-3xl font-bold text-red-400 drop-shadow-lg tabular-nums">{data.peopleCount}</span>
                            <span className="text-foreground/70 text-sm font-bold">/{data.threshold}</span>
                        </div>
                    </div>
                )}
                <div className="p-3">
                    <div className="flex items-center gap-2 mb-1">
                        <AlertTriangle size={14} className="text-red-400 animate-pulse" />
                        <span className="text-sm font-bold text-foreground">{data.alertName}</span>
                    </div>
                    <div className="flex items-center justify-between">
                        <span className="text-[10px] text-muted-foreground">{data.deviceName}</span>
                        <span className="text-[10px] text-muted-foreground font-mono">{new Date().toLocaleTimeString("es-UY")}</span>
                    </div>
                </div>
                <div className="h-1 bg-foreground/10"><div className="h-full bg-red-500/60 animate-[shrink_8s_linear_forwards]" /></div>
            </div>
        ),
        { duration: 8000, position: "top-right" }
    );
}

// Alert Form Modal
function AlertFormModal({ open, editingId, formName, setFormName, formDevice, setFormDevice, formChannel, setFormChannel, formThreshold, setFormThreshold, formCooldown, setFormCooldown, devices, onSave, onClose, alerts, onToggle, onDelete, onEditAlert }: {
    open: boolean; editingId: string | null;
    formName: string; setFormName: (v: string) => void;
    formDevice: string; setFormDevice: (v: string) => void;
    formChannel: string; setFormChannel: (v: string) => void;
    formThreshold: number; setFormThreshold: (v: number) => void;
    formCooldown: number; setFormCooldown: (v: number) => void;
    devices: Device[]; onSave: () => void; onClose: () => void;
    alerts?: any[]; onToggle?: (id: string, enabled: boolean) => void; onDelete?: (id: string) => void; onEditAlert?: (a: any) => void;
}) {
    if (!open) return null;
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
            <div className="bg-card border border-border rounded-2xl w-full max-w-3xl overflow-hidden shadow-lg animate-in fade-in zoom-in-95 duration-200 max-h-[92vh] flex flex-col" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-gradient-to-r from-violet-500/10 to-transparent">
                    <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-xl bg-violet-500/20 border border-violet-500/30 flex items-center justify-center">
                            {editingId ? <Pencil size={15} className="text-violet-400" /> : <Bell size={15} className="text-violet-400" />}
                        </div>
                        <div>
                            <h3 className="text-base font-bold text-foreground tracking-tight">{editingId ? "Editar alerta de aforo" : "Nueva alerta de aforo"}</h3>
                            <p className="text-[11px] text-muted-foreground">Define cuándo el sistema avisa por ocupación de la fila</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"><X size={16} /></button>
                </div>

                {Array.isArray(alerts) && alerts.length > 0 && (
                    <div className="px-6 pt-5">
                        <div className="flex items-center gap-2 mb-2">
                            <Bell size={13} className="text-violet-400" />
                            <span className="text-xs font-bold uppercase tracking-wide text-foreground">Alertas configuradas</span>
                            <span className="text-[10px] text-muted-foreground">({alerts.length})</span>
                        </div>
                        <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                            {alerts.map((a: any) => (
                                <div key={a.id} className={`flex items-center justify-between px-3 py-2 rounded-xl border transition-colors ${editingId === a.id ? "border-violet-500/40 bg-violet-500/10" : "border-border bg-foreground/[0.03] hover:bg-foreground/[0.05]"}`}>
                                    <div className="flex items-center gap-2.5 min-w-0">
                                        <button onClick={() => onToggle && onToggle(a.id, !a.enabled)} className={`w-8 h-5 rounded-full relative transition-colors shrink-0 ${a.enabled ? "bg-emerald-500" : "bg-foreground/15"}`}>
                                            <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${a.enabled ? "left-3.5" : "left-0.5"}`} />
                                        </button>
                                        <div className="min-w-0">
                                            <p className="text-xs font-bold text-foreground truncate">{a.name}</p>
                                            <p className="text-[10px] text-muted-foreground">Umbral {a.threshold} · Cooldown {(a.cooldownSec ?? a.cooldownMin * 60)}s</p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-1 shrink-0">
                                        <button onClick={() => onEditAlert && onEditAlert(a)} title="Editar" className="p-1.5 rounded hover:bg-accent text-muted-foreground hover:text-blue-400"><Pencil size={12} /></button>
                                        <DeleteButton onConfirm={() => onDelete && onDelete(a.id)} />
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-0 overflow-y-auto">
                    {/* Columna izquierda: configuración */}
                    <div className="p-6 space-y-5 lg:border-r border-border">
                        <div className="flex items-center gap-2">
                            <Settings2 size={14} className="text-violet-400" />
                            <span className="text-xs font-bold uppercase tracking-wide text-foreground">Configuración</span>
                        </div>
                        <div>
                            <label className="text-[10px] text-muted-foreground uppercase tracking-wider font-bold mb-1.5 block">Nombre de la alerta</label>
                            <Input value={formName} onChange={e => setFormName(e.target.value)} placeholder="Ej: Aforo Caja 1" className="bg-foreground/10 border-border text-foreground text-sm h-10" autoFocus />
                            <p className="text-[10px] text-muted-foreground/70 mt-1">Un nombre claro te ayuda a identificarla en notificaciones.</p>
                        </div>
                        <div>
                            <label className="text-[10px] text-muted-foreground uppercase tracking-wider font-bold mb-1.5 block">Dispositivo</label>
                            <select value={formDevice} onChange={e => setFormDevice(e.target.value)} className="w-full rounded-md bg-foreground/10 border border-border text-foreground text-sm px-3 h-10">
                                <option value="">Todas las cámaras de fila</option>
                                {devices.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                            </select>
                            <p className="text-[10px] text-muted-foreground/70 mt-1">Vacío = aplica a todas las cámaras de conteo.</p>
                        </div>
                        <div>
                            <label className="text-[10px] text-muted-foreground uppercase tracking-wider font-bold mb-1.5 block">Canal (opcional)</label>
                            <Input value={formChannel} onChange={e => setFormChannel(e.target.value)} placeholder="Ej: Aforo" className="bg-foreground/10 border-border text-foreground text-sm h-10" />
                            <p className="text-[10px] text-muted-foreground/70 mt-1">Limita la alerta a un canal de aforo. Vacío = cualquier canal de ocupación.</p>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="text-[10px] text-muted-foreground uppercase tracking-wider font-bold mb-1.5 block flex items-center gap-1"><Target size={11} className="text-violet-400" /> Umbral (personas)</label>
                                <Input type="number" value={formThreshold} onChange={e => setFormThreshold(Number(e.target.value))} min={1} className="bg-foreground/10 border-border text-foreground text-base font-bold h-11" />
                            </div>
                            <div>
                                <label className="text-[10px] text-muted-foreground uppercase tracking-wider font-bold mb-1.5 block flex items-center gap-1"><Clock size={11} className="text-violet-400" /> Cooldown (seg)</label>
                                <Input type="number" value={formCooldown} onChange={e => setFormCooldown(Number(e.target.value))} min={0} className="bg-foreground/10 border-border text-foreground text-base font-bold h-11" />
                            </div>
                        </div>
                    </div>

                    {/* Columna derecha: explicación */}
                    <div className="p-6 space-y-4 bg-foreground/[0.03]">
                        <div className="flex items-center gap-2">
                            <AlertTriangle size={14} className="text-amber-400" />
                            <span className="text-xs font-bold uppercase tracking-wide text-foreground">Cómo funciona</span>
                        </div>

                        <div className="rounded-xl border border-violet-500/20 bg-violet-500/[0.06] p-3.5">
                            <p className="text-[12px] leading-relaxed text-foreground/90">
                                El <b>umbral</b> es la cantidad de personas a partir de la cual la fila se considera saturada.
                                Cuando el aforo en vivo <b>alcanza o supera {formThreshold || 0} {(formThreshold || 0) === 1 ? "persona" : "personas"}</b>,
                                el sistema <b className="text-violet-300">dispara la notificación</b> (WhatsApp / Telegram / push) con la foto y el video del momento.
                            </p>
                        </div>

                        <div className="space-y-2.5">
                            <div className="flex items-start gap-2.5">
                                <div className="w-5 h-5 rounded-md bg-emerald-500/15 flex items-center justify-center shrink-0 mt-0.5"><Zap size={12} className="text-emerald-400" /></div>
                                <p className="text-[11.5px] leading-snug text-muted-foreground"><b className="text-foreground">Cuándo dispara:</b> al cruzar el umbral hacia arriba (ej. pasa de {Math.max(0,(formThreshold||1)-1)} a {formThreshold || 1}).</p>
                            </div>
                            <div className="flex items-start gap-2.5">
                                <div className="w-5 h-5 rounded-md bg-red-500/15 flex items-center justify-center shrink-0 mt-0.5"><BellOff size={12} className="text-red-400" /></div>
                                <p className="text-[11.5px] leading-snug text-muted-foreground"><b className="text-foreground">Cuándo NO dispara:</b> si el aforo está por debajo del umbral, o si ya avisó hace menos de {formCooldown || 0}s (período de calma).</p>
                            </div>
                            <div className="flex items-start gap-2.5">
                                <div className="w-5 h-5 rounded-md bg-blue-500/15 flex items-center justify-center shrink-0 mt-0.5"><Clock size={12} className="text-blue-400" /></div>
                                <p className="text-[11.5px] leading-snug text-muted-foreground"><b className="text-foreground">Cooldown ({formCooldown || 0}s):</b> evita spam — tras un aviso, espera ese tiempo antes de volver a notificar aunque siga saturada.</p>
                            </div>
                        </div>

                        <div className="rounded-xl border border-amber-500/25 bg-amber-500/[0.07] p-3.5">
                            <div className="flex items-center gap-1.5 mb-1">
                                <Activity size={13} className="text-amber-400" />
                                <span className="text-[11px] font-bold uppercase tracking-wide text-amber-300">Ajustá con la calibración</span>
                            </div>
                            <p className="text-[11.5px] leading-relaxed text-foreground/85">
                                El conteo puede oscilar según iluminación, ángulo y movimiento. Usá la <b>Calibración de aforo</b> para
                                comparar el valor crudo vs. estabilizado y ajustar el <i>tiempo de rebote</i>, así el umbral refleja el aforo real del entorno y evitás falsas alertas.
                            </p>
                            <a href="/admin/calibracion-aforo" className="inline-flex items-center gap-1 mt-2 text-[11px] font-bold text-amber-300 hover:text-amber-200">
                                Abrir Calibración <ArrowRight size={12} />
                            </a>
                        </div>
                    </div>
                </div>

                <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-border bg-foreground/[0.04]">
                    <Button variant="ghost" size="sm" onClick={onClose} className="text-muted-foreground hover:text-foreground">Cancelar</Button>
                    <Button size="sm" onClick={onSave} className="bg-violet-600 hover:bg-violet-700 text-foreground gap-1.5 px-5">
                        <Save size={14} /> {editingId ? "Actualizar" : "Crear alerta"}
                    </Button>
                </div>
            </div>
        </div>
    );
}

// Main Page
// ─── ONVIF Topics Subscription Panel ────────────────
function OnvifTopicsPanel({ deviceId }: { deviceId: string }) {
    const [topics, setTopics] = useState<string[]>([]);
    const [enabled, setEnabled] = useState<string[]>([]);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const r = await fetch(`/api/queue/onvif-topics?deviceId=${encodeURIComponent(deviceId)}`);
            const d = await r.json();
            if (Array.isArray(d.topics)) setTopics(d.topics);
            if (Array.isArray(d.enabled)) setEnabled(d.enabled);
        } catch { /* ignore */ }
        finally { setLoading(false); }
    }, [deviceId]);

    useEffect(() => { load(); }, [load]);

    const toggle = async (topic: string) => {
        const next = enabled.includes(topic) ? enabled.filter(t => t !== topic) : [...enabled, topic];
        setEnabled(next);
        setSaving(true);
        try {
            await fetch(`/api/queue/onvif-topics?deviceId=${encodeURIComponent(deviceId)}`, {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ enabled: next }),
            });
            toast.success("Suscripción actualizada");
        } catch { toast.error("No se pudo guardar"); }
        finally { setSaving(false); }
    };

    return (
        <div>
            <div className="flex items-center justify-between mb-2">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">Tópicos ONVIF · suscripción</p>
                <button onClick={load} disabled={loading} className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-violet-400 disabled:opacity-40">
                    <RefreshCw size={11} className={loading ? "animate-spin" : ""} /> {loading ? "Cargando" : "Recargar"}
                </button>
            </div>
            {topics.length === 0 ? (
                <p className="text-xs text-muted-foreground py-2">{loading ? "Consultando la cámara…" : "No se obtuvieron tópicos de la cámara."}</p>
            ) : (
                <div className="space-y-1 max-h-64 overflow-y-auto pr-1">
                    {topics.map((t) => {
                        const on = enabled.includes(t);
                        const short = t.split("/").slice(-2).join("/");
                        return (
                            <button key={t} onClick={() => toggle(t)} disabled={saving}
                                className={cn("w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg border text-left transition-colors",
                                    on ? "bg-violet-500/10 border-violet-500/30" : "bg-foreground/[0.04] border-border hover:bg-foreground/[0.04]")}>
                                <div className="min-w-0">
                                    <div className="text-xs text-foreground/70 truncate">{short}</div>
                                    <div className="text-[9px] font-mono text-muted-foreground truncate">{t}</div>
                                </div>
                                <span className={cn("w-8 h-5 rounded-full relative transition-colors shrink-0", on ? "bg-violet-500" : "bg-foreground/10")}>
                                    <span className={cn("absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all", on ? "left-3.5" : "left-0.5")} />
                                </span>
                            </button>
                        );
                    })}
                </div>
            )}
            <p className="text-[9px] text-muted-foreground mt-2">Los tópicos activados se registran como eventos cuando la cámara los emite.</p>
        </div>
    );
}

export default function FilasPage() {
    const [alerts, setAlerts] = useState<Alert[]>([]);
    const [devices, setDevices] = useState<Device[]>([]);
    const [liveCounts, setLiveCounts] = useState<DeviceLive[]>([]);
    const [stats, setStats] = useState<DayStats | null>(null);
    const [loading, setLoading] = useState(true);
    const [showForm, setShowForm] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [soundEnabled, setSoundEnabled] = useState(true);
    const [alertsPaused, setAlertsPaused] = useState(false);
    const socketRef = useRef<any>(null);
    const videoContainerRef = useRef<HTMLDivElement>(null);
    const [flashEvents, setFlashEvents] = useState<{ id: number; dir: "in" | "out" }[]>([]);

    // Drawing state

    // VCA Analytics overlay state
    const [vcaRules, setVcaRules] = useState<VCARule[]>([]);
    const [showVca, setShowVca] = useState(true);
    const [showAlertsModal, setShowAlertsModal] = useState(false);
    const [showOnvifModal, setShowOnvifModal] = useState(false);
    const [vcaLoading, setVcaLoading] = useState(false);

    const [formName, setFormName] = useState("");
    const [formDevice, setFormDevice] = useState("");
    const [formChannel, setFormChannel] = useState("");
    const [formThreshold, setFormThreshold] = useState(10);
    const [formCooldown, setFormCooldown] = useState(30);

    const loadVca = useCallback(async () => {
        if (devices.length === 0) return;
        const boschDevice = devices[0]; // First queue device
        setVcaLoading(true);
        try {
            const res = await fetch(`/api/queue/vca-config?deviceId=${boschDevice.id}`);
            if (res.ok) {
                const data = await res.json();
                if (data.rules && data.rules.length > 0) {
                    setVcaRules(data.rules);
                }
            }
        } catch (err) {
            console.error("[VCA] Failed to load:", err);
        }
        setVcaLoading(false);
    }, [devices]);

    const loadData = useCallback(async () => {
        try {
            const [alertsData, devicesData, countsData, statsData] = await Promise.all([
                getQueueAlerts(), getQueueDevices(), getLatestQueueCounts(), getQueueStatsToday(),
            ]);
            setAlerts(alertsData);
            setDevices(devicesData);
            setLiveCounts(countsData);
            setStats(statsData);
            setLoading(false);
        } catch (err) { console.error(err); toast.error("Error cargando datos"); }
    }, []);

    useEffect(() => { loadData(); }, [loadData]);
    useEffect(() => { if (devices.length > 0) loadVca(); }, [devices, loadVca]);

    useEffect(() => {
        const socket = io(window.location.origin, { path: "/io/socket.io", transports: ["polling"] });
        socketRef.current = socket;
        socket.on("queue_update", (data: any) => {
            // Animate zone entry/exit crossings on the live video
            const ch = String(data.channelName || "").toLowerCase();
            const isEntry = /entrad|entering/.test(ch);
            const isExit = /salid|leaving/.test(ch);
            if (isEntry || isExit) {
                const id = Date.now() + Math.random();
                setFlashEvents(prev => [...prev, { id, dir: isEntry ? "in" : "out" }]);
                setTimeout(() => setFlashEvents(prev => prev.filter(f => f.id !== id)), 1800);
            }
            setLiveCounts(prev => {
                const updated = [...prev];
                const devIdx = updated.findIndex(d => d.device.id === data.deviceId);
                if (devIdx >= 0) {
                    const chIdx = updated[devIdx].channels.findIndex(c => c.channelName === data.channelName);
                    if (chIdx >= 0) {
                        updated[devIdx].channels[chIdx].peopleCount = data.peopleCount;
                        updated[devIdx].channels[chIdx].lastUpdate = new Date(data.timestamp);
                        if (data.snapshotPath) updated[devIdx].channels[chIdx].snapshotPath = data.snapshotPath;
                    } else {
                        updated[devIdx].channels.push({ channelName: data.channelName, peopleCount: data.peopleCount, lastUpdate: new Date(data.timestamp), snapshotPath: data.snapshotPath });
                    }
                }
                return updated;
            });
        });
        socket.on("queue_alert", (data: any) => {
            if (alertsPaused) return;
            showQueueAlertToast(data);
            if (soundEnabled) playAlertSound();
            getQueueAlerts().then(setAlerts);
        });
        return () => { socket.disconnect(); };
    }, [soundEnabled, alertsPaused]);

    const resetForm = () => { setFormName(""); setFormDevice(""); setFormChannel(""); setFormThreshold(10); setFormCooldown(30); setShowForm(false); setEditingId(null); };

    const editAlert = (a: Alert) => {
        setFormName(a.name); setFormDevice(a.deviceId || ""); setFormChannel(a.channelName || "");
        setFormThreshold(a.threshold); setFormCooldown((a.cooldownSec ?? a.cooldownMin * 60)); setEditingId(a.id); setShowForm(true);
    };

    const saveAlert = async () => {
        if (!formName.trim()) { toast.error("Nombre requerido"); return; }
        try {
            if (editingId) {
                await updateQueueAlert(editingId, { name: formName, deviceId: formDevice || null, channelName: formChannel || null, threshold: formThreshold, cooldownSec: formCooldown });
                toast.success("Umbral actualizado");
            } else {
                await createQueueAlert({ name: formName, deviceId: formDevice || undefined, channelName: formChannel || undefined, threshold: formThreshold, cooldownSec: formCooldown });
                toast.success("Umbral creado");
            }
            resetForm(); loadData();
        } catch { toast.error("Error guardando"); }
    };

    const toggleAlert = async (id: string, enabled: boolean) => { await updateQueueAlert(id, { enabled }); loadData(); };
    const removeAlert = async (id: string) => { await deleteQueueAlert(id); toast.success("Eliminado"); loadData(); };
    const quickAdjustThreshold = async (id: string, delta: number) => {
        const alert = alerts.find(a => a.id === id);
        if (!alert) return;
        await updateQueueAlert(id, { threshold: Math.max(1, alert.threshold + delta) });
        loadData();
    };

    if (loading) {
        return <div className="flex items-center justify-center h-[60vh]"><Rows3 className="w-8 h-8 text-violet-500 animate-pulse" /></div>;
    }

    // Flatten channel counts + dedupe VCA rules by name (one entry per polygon)
    const flatCounts = liveCounts.flatMap(d => d.channels.map(c => ({ channelName: c.channelName, peopleCount: c.peopleCount })));
    const uniqueRules = vcaRules.filter((r, i, arr) => arr.findIndex(x => x.name === r.name) === i);
    const aforoRules = uniqueRules.filter(r => r.type === "OccupancyCounting");
    const otherRules = uniqueRules.filter(r => r.type !== "OccupancyCounting");

    // Aforo = occupancy from the OccupancyCounting rule's own channel (NOT the max of every channel).
    const aforoCount = aforoRules.length > 0
        ? (getRuleCount(aforoRules[0], flatCounts) ?? 0)
        : (flatCounts.find(c => c.channelName === "Aforo" || c.channelName === "IVA Aforo")?.peopleCount ?? 0);

    const enabledAlerts = alerts.filter(a => a.enabled);
    const globalThreshold = enabledAlerts.length > 0 ? Math.min(...enabledAlerts.map(a => a.threshold)) : 10;
    const globalRatio = globalThreshold > 0 ? aforoCount / globalThreshold : 0;
    const globalStatus = globalRatio >= 1 ? "alert" : globalRatio >= 0.7 ? "warning" : "ok";

    const relTime = (d: Date) => {
        const ms = Date.now() - new Date(d).getTime();
        const sec = Math.floor(ms / 1000);
        if (sec < 5) return "ahora";
        if (sec < 60) return `hace ${sec}s`;
        const mn = Math.floor(sec / 60); if (mn < 60) return `hace ${mn}m`;
        const hr = Math.floor(mn / 60); return `hace ${hr}h`;
    };
    const detectedRows = liveCounts.flatMap(d => d.channels.map(c => {
        const cn0 = c.channelName || "";
        const isAforo = /aforo|occupancy|ocupaci|personas/i.test(cn0);
        const isFlow = /entrada|salida/i.test(cn0);
        const tipo = isAforo ? { label: "Aforo", cls: "bg-violet-500/15 text-violet-400" } : isFlow ? { label: "Flujo", cls: "bg-cyan-500/15 text-cyan-400" } : { label: "Contador", cls: "bg-amber-500/15 text-amber-400" };
        const al = enabledAlerts.find(a => a.deviceId === d.device.id && a.channelName === cn0) || enabledAlerts.find(a => a.deviceId === d.device.id && !a.channelName);
        const threshold = al ? al.threshold : globalThreshold;
        const ratio = isAforo && threshold > 0 ? c.peopleCount / threshold : 0;
        const estado = ratio >= 1 ? { label: "Lleno", cls: "bg-red-500/15 text-red-400" } : ratio >= 0.7 ? { label: "Alto", cls: "bg-amber-500/15 text-amber-400" } : { label: "OK", cls: "bg-emerald-500/15 text-emerald-400" };
        const valueColor = isAforo ? (ratio >= 1 ? "text-red-400" : ratio >= 0.7 ? "text-amber-400" : "text-emerald-400") : "text-foreground/80";
        return { devName: d.device.name, ip: d.device.ip, channelName: cn0, peopleCount: c.peopleCount, isAforo, tipo, threshold, estado, valueColor, rel: relTime(c.lastUpdate) };
    })).sort((a, b) => (a.devName === b.devName ? (a.isAforo === b.isAforo ? 0 : a.isAforo ? -1 : 1) : a.devName.localeCompare(b.devName)));

    return (
        <div className="space-y-5 p-6">
            <style>{`
                @keyframes shrink { from { width: 100%; } to { width: 0%; } }
                @keyframes aforoBeat { 0%, 100% { transform: translate(-50%, -50%) scale(1); } 50% { transform: translate(-50%, -50%) scale(1.1); } }
                @keyframes zoneFlash { 0% { opacity: 0; transform: translateY(14px) scale(0.85); } 15% { opacity: 1; transform: translateY(0) scale(1.05); } 35% { transform: translateY(0) scale(1); } 80% { opacity: 1; } 100% { opacity: 0; transform: translateY(-26px) scale(0.9); } }
            `}</style>

            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className={cn("w-10 h-10 rounded-lg border flex items-center justify-center transition-all",
                        globalStatus === "alert" ? "bg-red-500/10 border-red-500/30 animate-pulse" : "bg-violet-500/10 border-violet-500/20"
                    )}>
                        <Rows3 size={20} className={globalStatus === "alert" ? "text-red-400" : "text-violet-400"} />
                    </div>
                    <div>
                        <h1 className="text-xl font-bold text-foreground">Control de Filas</h1>
                        <p className="text-xs text-muted-foreground">{"Gestión en vivo · Umbrales · Alertas"}</p>
                    </div>
                </div>
                <div className="flex items-center gap-1.5">
                    <button onClick={() => setSoundEnabled(!soundEnabled)} className={cn("p-2 rounded-lg transition-colors", soundEnabled ? "bg-violet-500/20 text-violet-400" : "bg-foreground/10 text-muted-foreground")}>
                        {soundEnabled ? <Volume2 size={15} /> : <VolumeX size={15} />}
                    </button>
                    <button onClick={() => { setAlertsPaused(!alertsPaused); toast(alertsPaused ? "Alertas reanudadas" : "Alertas pausadas"); }} className={cn("p-2 rounded-lg transition-colors", alertsPaused ? "bg-amber-500/20 text-amber-400" : "bg-foreground/10 text-muted-foreground")}>
                        {alertsPaused ? <Play size={15} /> : <Pause size={15} />}
                    </button>
                    <Button variant="ghost" size="sm" onClick={loadData} className="text-muted-foreground hover:text-foreground"><RefreshCw size={14} /></Button>
                    <Button size="sm" onClick={() => { resetForm(); setShowForm(true); }} className="bg-violet-600 hover:bg-violet-700 text-foreground gap-1.5"><Plus size={14} /> Nuevo Umbral</Button>
                </div>
            </div>

            {/* KPI info moved to video overlay */}

            {/* HERO: Centered Video with Drawing Overlay */}
            {liveCounts.length > 0 && (
                <div className="flex flex-col items-center gap-3">
                    {/* VCA Analytics Toolbar */}
                    <div className="flex items-center gap-2 w-full max-w-3xl">
                        <div className="flex items-center gap-1.5 text-xs text-foreground/70">
                            <Target size={13} className="text-violet-400" />
                            <span className="font-bold">Analíticas VCA</span>
                        </div>

                        <div className="flex-1" />

                        {vcaRules.length > 0 && (
                            <button onClick={() => setShowVca(!showVca)}
                                className={cn("flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-all",
                                    showVca ? "bg-violet-500/10 border-violet-500/30 text-violet-400" : "bg-foreground/10 border-border text-muted-foreground"
                                )}>
                                {showVca ? <Eye size={12} /> : <EyeOff size={12} />}
                                {showVca ? "VCA" : "VCA Off"}
                            </button>
                        )}
                        <button onClick={() => loadVca()}
                            disabled={vcaLoading}
                            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-foreground/10 border border-border text-muted-foreground hover:text-violet-400 hover:border-violet-500/30 transition-all disabled:opacity-30">
                            <RefreshCw size={12} className={vcaLoading ? "animate-spin" : ""} />
                            {vcaLoading ? "..." : "Recargar"}
                        </button>

                        <span className="text-[9px] text-muted-foreground font-mono">
                            {vcaRules.length} zona{vcaRules.length !== 1 ? "s" : ""}
                        </span>
                    </div>

                    {/* Video Container - centered and constrained */}
                    <div
                        ref={videoContainerRef}
                        className={cn(
                            "relative rounded-xl overflow-hidden border-2 transition-all w-full max-w-3xl",
                            globalStatus === "alert" ? "border-red-500/50 shadow-lg shadow-red-500/10" :
                            globalStatus === "warning" ? "border-amber-500/40" : "border-border"
                        )}
                    >
                        <div className="relative aspect-video vid-surface">
                            <LiveVideo
                                streamName={getStreamName(liveCounts[0].device.ip)}
                                fallbackDeviceId={liveCounts[0].device.id}
                                className="absolute inset-0 w-full h-full"
                            />

                            {/* VCA Analytics Overlay (camera zones - shapes only) */}
                            <VCAOverlay rules={vcaRules} showVca={showVca} />

                            {/* Live aforo count — big, translucent, pulsing, at the centroid of the occupancy polygon */}
                            {showVca && aforoRules.length > 0 && (() => {
                                const pts = aforoRules[0].points;
                                const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
                                const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
                                const color = globalStatus === "alert" ? "#f87171" : globalStatus === "warning" ? "#fbbf24" : "#34d399";
                                return (
                                    <div
                                        className="absolute z-[9] pointer-events-none select-none"
                                        style={{
                                            left: `${cx}%`,
                                            top: `${cy}%`,
                                            transform: "translate(-50%, -50%)",
                                            animation: `aforoBeat ${globalStatus === "alert" ? "0.8s" : "1.6s"} ease-in-out infinite`,
                                        }}
                                    >
                                        <span
                                            className="font-bold tabular-nums leading-none"
                                            style={{
                                                fontSize: "clamp(48px, 14vw, 130px)",
                                                color,
                                                opacity: 0.55,
                                                textShadow: "0 2px 18px rgba(0,0,0,0.55)",
                                            }}
                                        >
                                            {aforoCount}
                                        </span>
                                    </div>
                                );
                            })()}

                            {/* Alert pulse overlay */}
                            {globalStatus === "alert" && <div className="absolute inset-0 bg-red-500/10 animate-pulse pointer-events-none z-20" />}

                            {/* Entry / Exit zone crossing flashes */}
                            {flashEvents.length > 0 && (
                                <div className="absolute inset-x-0 bottom-16 flex flex-col items-center gap-1.5 pointer-events-none z-[25]">
                                    {flashEvents.map(f => (
                                        <div
                                            key={f.id}
                                            className={cn(
                                                "flex items-center gap-1.5 px-3 py-1.5 rounded-full font-bold text-sm shadow-xl backdrop-blur-sm border",
                                                f.dir === "in"
                                                    ? "bg-emerald-500/85 border-emerald-300/60 text-white"
                                                    : "bg-rose-500/85 border-rose-300/60 text-white"
                                            )}
                                            style={{ animation: "zoneFlash 1.8s ease-out forwards", textShadow: "0 1px 4px rgba(0,0,0,0.5)" }}
                                        >
                                            {f.dir === "in" ? <ArrowRight size={16} /> : <ArrowLeft size={16} />}
                                            {f.dir === "in" ? "+1 Entró" : "-1 Salió"}
                                        </div>
                                    ))}
                                </div>
                            )}

                            {/* Top overlay - device name + status */}
                            <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-4 py-2.5 bg-gradient-to-b from-black/70 to-transparent pointer-events-none z-30">
                                <div className="flex items-center gap-2">
                                    <div className={cn("w-2 h-2 rounded-full", globalStatus === "alert" ? "bg-red-500 animate-ping" : globalStatus === "warning" ? "bg-amber-500" : "bg-emerald-500")} />
                                    <span className="text-xs font-bold text-white/90 uppercase tracking-wide" style={{ textShadow: "0 1px 4px rgba(0,0,0,0.8)" }}>
                                               {liveCounts[0]?.device?.name || "Cámara"}
                                    </span>
                                </div>
                                {/* Floating action buttons */}
                                <div className="flex items-center gap-1.5 pointer-events-auto">
                                    <button onClick={() => { resetForm(); setShowForm(true); }}
                                        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold bg-black/55 hover:bg-black/75 border border-border text-amber-300 backdrop-blur-md transition-colors">
                                        <Bell size={12} /> Alertas{alerts.length > 0 && <span className="text-[9px] bg-amber-500/30 text-amber-200 rounded-full px-1.5">{alerts.length}</span>}
                                    </button>
                                    <button onClick={() => setShowOnvifModal(true)}
                                        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold bg-black/55 hover:bg-black/75 border border-border text-violet-300 backdrop-blur-md transition-colors">
                                        <Target size={12} /> Analíticas ONVIF
                                    </button>
                                </div>
                            </div>

                            {/* Bottom-LEFT overlay: la fila = zona(s) de aforo (ocupación) */}
                            <div className="absolute bottom-3 left-3 z-20 pointer-events-none flex flex-col items-start gap-1">
                                {aforoRules.map((rule, i) => {
                                    const col = VCA_COLORS[rule.type] || VCA_COLORS.Unknown;
                                    return (
                                        <div key={`fila-${i}`} className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg backdrop-blur-md border bg-black/50 border-border">
                                            <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: col.stroke }} />
                                            <span className="text-[11px] font-bold text-foreground">{aforoRules.length > 1 ? `Fila ${i + 1}` : "Fila"}</span>
                                            <span className="text-[9px] text-muted-foreground max-w-[150px] truncate">{rule.name}</span>
                                        </div>
                                    );
                                })}
                            </div>

                            {/* Bottom-RIGHT overlay: analíticas ONVIF apiladas, Aforo abajo */}
                            <div className="absolute bottom-3 right-3 z-20 pointer-events-none flex flex-col items-end gap-1">
                                {otherRules.map((rule, i) => {
                                    const cval = getRuleCount(rule, flatCounts);
                                    const col = VCA_COLORS[rule.type] || VCA_COLORS.Unknown;
                                    return (
                                        <div key={`an-${i}`} className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg backdrop-blur-md border bg-black/50 border-border">
                                            <span style={{ color: col.label }} className="text-[11px] font-bold leading-none">{VCA_ICONS[rule.type] || "?"}</span>
                                            <span className="text-[10px] text-foreground/70 max-w-[140px] truncate">{rule.name}</span>
                                            <span className="text-xs font-bold text-foreground tabular-nums">{cval !== null ? cval : "—"}</span>
                                        </div>
                                    );
                                })}
                                {/* Aforo (ocupación) anclado abajo, coloreado por estado */}
                                <div className={cn(
                                    "flex items-center gap-1.5 px-2.5 py-1 rounded-lg backdrop-blur-md border",
                                    globalStatus === "alert" ? "bg-red-500/20 border-red-500/40" :
                                    globalStatus === "warning" ? "bg-amber-500/20 border-amber-500/30" :
                                    "bg-black/50 border-border"
                                )}>
                                    <Users size={12} className={cn(
                                        globalStatus === "alert" ? "text-red-400" :
                                        globalStatus === "warning" ? "text-amber-400" : "text-emerald-400"
                                    )} />
                                    <span className="text-[10px] text-foreground/70 font-medium">Aforo</span>
                                    <AnimatedCounter value={aforoCount} className={cn(
                                        "text-sm font-bold tabular-nums",
                                        globalStatus === "alert" ? "text-red-400" :
                                        globalStatus === "warning" ? "text-amber-400" : "text-foreground"
                                    )} />
                                    <span className="text-muted-foreground text-[10px]">/</span>
                                    <span className="text-foreground/70 text-xs font-medium">{globalThreshold || "—"}</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* ── Filas detectadas (tabla) ── */}
            <div className="rounded-xl border border-border bg-card overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                    <div className="flex items-center gap-2">
                        <Rows3 size={15} className="text-violet-400" />
                        <h3 className="text-sm font-bold text-foreground">Detección por fila (en vivo)</h3>
                        <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full">{liveCounts.length} fila{liveCounts.length !== 1 ? "s" : ""} · {detectedRows.length} analíticas</span>
                    </div>
                    <p className="text-[10px] text-muted-foreground hidden sm:block">Cada fila puede tener varias analíticas: aforo (ocupación) + flujo (entradas/salidas). Solo se muestran las que la cámara está reportando ahora.</p>
                </div>
                {detectedRows.length === 0 ? (
                    <div className="py-10 text-center text-xs text-muted-foreground"><Camera size={26} className="mx-auto mb-2 opacity-30" /> Sin lecturas todavía de las cámaras de filas.</div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead className="bg-muted/40">
                                <tr className="text-[10px] uppercase tracking-wider text-muted-foreground">
                                    <th className="text-left font-semibold px-4 py-2">Fila / Cámara</th>
                                    <th className="text-left font-semibold px-3 py-2">Zona / Canal</th>
                                    <th className="text-left font-semibold px-3 py-2">Tipo</th>
                                    <th className="text-right font-semibold px-3 py-2">Valor</th>
                                    <th className="text-center font-semibold px-3 py-2">Umbral</th>
                                    <th className="text-center font-semibold px-3 py-2">Estado</th>
                                    <th className="text-right font-semibold px-4 py-2">Última lectura</th>
                                </tr>
                            </thead>
                            <tbody>
                                {detectedRows.map((r, i) => (
                                    <tr key={i} className="border-t border-border hover:bg-muted/20 transition-colors">
                                        <td className="px-4 py-2.5">
                                            <div className="flex items-center gap-2 min-w-0">
                                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                                                <div className="min-w-0">
                                                    <p className="font-semibold text-foreground truncate">{r.devName}</p>
                                                    <p className="text-[10px] text-muted-foreground font-mono truncate">{r.ip}</p>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-3 py-2.5 text-foreground/80">{r.channelName || "—"}</td>
                                        <td className="px-3 py-2.5"><span className={cn("text-[10px] font-bold px-2 py-0.5 rounded-md", r.tipo.cls)}>{r.tipo.label}</span></td>
                                        <td className="px-3 py-2.5 text-right"><span className={cn("text-base font-bold tabular-nums", r.valueColor)}>{r.peopleCount}</span></td>
                                        <td className="px-3 py-2.5 text-center text-muted-foreground tabular-nums">{r.isAforo ? (r.threshold || "—") : "—"}</td>
                                        <td className="px-3 py-2.5 text-center">{r.isAforo ? <span className={cn("text-[10px] font-bold px-2 py-0.5 rounded-md", r.estado.cls)}>{r.estado.label}</span> : <span className="text-[10px] text-muted-foreground">—</span>}</td>
                                        <td className="px-4 py-2.5 text-right text-[11px] text-muted-foreground whitespace-nowrap">{r.rel}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* ── Analíticas ONVIF Modal ── */}
            {showOnvifModal && liveCounts.length > 0 && liveCounts[0]?.device && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={() => setShowOnvifModal(false)}>
            <div className="bg-card border border-border rounded-2xl w-full max-w-3xl shadow-lg max-h-[88vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between px-5 py-4 border-b border-border sticky top-0 bg-card z-10">
                    <h3 className="text-sm font-bold text-foreground/70 flex items-center gap-2">
                        <Target size={14} className="text-violet-400" /> Analíticas ONVIF
                    </h3>
                    <button onClick={() => setShowOnvifModal(false)} className="p-1.5 text-muted-foreground hover:text-foreground rounded-lg hover:bg-accent"><X size={16} /></button>
                </div>
                <div className="p-5 space-y-4">
                    <div className="rounded-lg bg-violet-500/10 border border-violet-500/20 px-3 py-2.5 text-[11px] text-foreground/70 leading-relaxed">
                        <span className="font-bold text-violet-400">¿Cómo funciona?</span> Las <b>Reglas VCA</b> son las analíticas que la cámara ya calcula: <b>Aforo</b> (OccupancyCounting) alimenta el conteo de tu fila, y <b>Entrando/Saliendo</b> registran cruces. Los <b>Tópicos ONVIF</b> son todos los eventos que la cámara puede emitir; al suscribirte, OmniAccess registra esos eventos cuando ocurren y los usa para el aforo, entradas y salidas que ves en Filas y Flujo de Filas. Para control de fila, lo importante es tener activo el tópico de <b>OccupancyCounter / Aforo</b>.
                    </div>
                    {/* Reglas VCA detectadas */}
                    <div>
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold mb-2">Reglas VCA detectadas</p>
                        <div className="space-y-1.5">
                            {vcaRules.length === 0 && <p className="text-xs text-muted-foreground">Sin reglas. Pulsá "Recargar".</p>}
                            {vcaRules.filter((r, i, arr) => arr.findIndex(x => x.name === r.name) === i).map((r, i) => {
                                const col = VCA_COLORS[r.type] || VCA_COLORS.Unknown;
                                return (
                                    <div key={i} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-foreground/[0.04] border border-border">
                                        <span style={{ color: col.label }} className="text-sm font-bold">{VCA_ICONS[r.type] || "?"}</span>
                                        <span className="text-xs text-foreground/70 flex-1">{r.name}</span>
                                        <span className="text-[9px] font-mono text-muted-foreground">{r.type}</span>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                    {/* Suscripción a tópicos ONVIF */}
                    <OnvifTopicsPanel deviceId={liveCounts[0].device.id} />
                    {/* Discovery panel existente */}
                    <OnvifDiscoveryPanel
                        deviceId={liveCounts[0].device.id}
                        deviceName={liveCounts[0].device.name}
                        deviceIp={liveCounts[0].device.ip}
                    />
                </div>
            </div>
            </div>
            )}

            {/* Alert Form Modal */}
            <AlertFormModal
                open={showForm}
                onClose={resetForm}
                editingId={editingId}
                devices={devices}
                formName={formName} setFormName={setFormName}
                formDevice={formDevice} setFormDevice={setFormDevice}
                formChannel={formChannel} setFormChannel={setFormChannel}
                formThreshold={formThreshold} setFormThreshold={setFormThreshold}
                formCooldown={formCooldown} setFormCooldown={setFormCooldown}
                onSave={saveAlert}
                alerts={alerts}
                onToggle={toggleAlert}
                onDelete={removeAlert}
                onEditAlert={editAlert}
            />
        </div>
    );
}
