"use client";

import { useEffect, useState, useCallback, useRef, MouseEvent as ReactMouseEvent, WheelEvent } from "react";
import {
    Clock, RefreshCw, Video, Camera, Radio, Volume2, VolumeX,
    LayoutGrid, Grid3X3, Square, Columns, Calendar, Maximize2, Image as ImageIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
    getLatestQueueCounts, getQueueHourlyBreakdown, getQueueAlerts, getQueueDevices, getQueueEvents, getCameraOutages,
} from "@/app/actions/queue";
import { toast } from "sonner";
import { io } from "socket.io-client";

interface DeviceView {
    deviceId: string; deviceName: string; deviceIp: string; location: string | null;
    peopleCount: number; avgCount: number; channelCount: number; lastUpdate: Date;
    threshold: number; channels: string[]; streamName: string;
}
interface HourlyData { hour: number; avg: number; max: number; count: number; }
interface TimelineEvent {
    id: string; timestamp: Date; channelName: string; peopleCount: number;
    deviceName: string; deviceId: string; snapshotPath: string | null;
}
type GridLayout = "auto" | "1x1" | "2x2" | "3x3";

function getStreamName(ip: string): string {
    return `bosch_${ip.replace(/\./g, "_")}`;
}

// ─── VCA Analytics (camera zones) ───────────────────
interface VCARule { name: string; type: string; armed: boolean; points: { x: number; y: number }[]; rawPoints?: { x: number; y: number }[]; }
const VCA_COLORS: Record<string, { stroke: string; fill: string }> = {
    EnteringField:     { stroke: "#10b981", fill: "rgba(16,185,129,0.08)" },
    LeavingField:      { stroke: "#3b82f6", fill: "rgba(59,130,246,0.08)" },
    OccupancyCounting: { stroke: "#a855f7", fill: "rgba(168,85,247,0.10)" },
    LineCounting:      { stroke: "#f59e0b", fill: "none" },
    Unknown:           { stroke: "#6b7280", fill: "rgba(107,114,128,0.06)" },
};

function occupancyCentroid(rules: VCARule[]): { x: number; y: number } | null {
    const occ = rules.find(r => r.type === "OccupancyCounting") || rules[0];
    if (!occ || occ.points.length === 0) return null;
    const cx = occ.points.reduce((s, p) => s + p.x, 0) / occ.points.length;
    const cy = occ.points.reduce((s, p) => s + p.y, 0) / occ.points.length;
    return { x: cx, y: cy };
}

// Renders ONLY zone shapes (polygons / lines). No text over the video.
function VCAOverlay({ rules }: { rules: VCARule[] }) {
    if (!rules || rules.length === 0) return null;
    return (
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 w-full h-full z-[8] pointer-events-none">
            <defs>
                <filter id="mqVcaGlow" x="-20%" y="-20%" width="140%" height="140%">
                    <feGaussianBlur in="SourceAlpha" stdDeviation="0.5" result="blur" />
                    <feFlood floodColor="white" floodOpacity="0.3" />
                    <feComposite in2="blur" operator="in" />
                    <feMerge><feMergeNode /><feMergeNode in="SourceGraphic" /></feMerge>
                </filter>
            </defs>
            {rules.map((rule, idx) => {
                const colors = VCA_COLORS[rule.type] || VCA_COLORS.Unknown;
                if (rule.type === "LineCounting" && rule.points.length >= 2) {
                    const p1 = rule.points[0]; const p2 = rule.points[rule.points.length - 1];
                    return (
                        <g key={idx}>
                            <line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke={colors.stroke} strokeWidth="0.5" strokeLinecap="round" opacity={0.9} filter="url(#mqVcaGlow)" />
                            <line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke={colors.stroke} strokeWidth="0.2" strokeDasharray="1.2 0.6" opacity={0.5} />
                        </g>
                    );
                }
                const pathD = rule.points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ") + " Z";
                return (
                    <g key={idx}>
                        <path d={pathD} fill={colors.fill} stroke={colors.stroke} strokeWidth="0.35" strokeLinejoin="round" opacity={0.85} filter="url(#mqVcaGlow)" />
                        <path d={pathD} fill="none" stroke={colors.stroke} strokeWidth="0.15" strokeDasharray="1 0.5" opacity={0.4} />
                        {rule.points.map((pt, pi) => (<circle key={pi} cx={pt.x} cy={pt.y} r="0.4" fill={colors.stroke} opacity={0.7} />))}
                    </g>
                );
            })}
        </svg>
    );
}

// Animated Counter
function AnimatedCounter({ value, threshold }: { value: number; threshold: number }) {
    const [display, setDisplay] = useState(value);
    const animRef = useRef<number | null>(null);
    const currentRef = useRef(value);
    useEffect(() => {
        const start = currentRef.current; const end = value;
        if (start === end) return;
        const duration = 600; const startTime = performance.now();
        const animate = (now: number) => {
            const elapsed = now - startTime;
            const progress = Math.min(elapsed / duration, 1);
            const eased = 1 - Math.pow(1 - progress, 3);
            const current = Math.round(start + (end - start) * eased);
            setDisplay(current); currentRef.current = current;
            if (progress < 1) { animRef.current = requestAnimationFrame(animate); }
            else { currentRef.current = end; }
        };
        animRef.current = requestAnimationFrame(animate);
        return () => { if (animRef.current) cancelAnimationFrame(animRef.current); };
    }, [value]);

    const ratio = threshold > 0 ? display / threshold : 0;
    const color = ratio >= 1 ? "text-red-400" : ratio >= 0.7 ? "text-amber-400" : "text-emerald-400";
    const threshColor = ratio >= 1 ? "text-red-400/40" : ratio >= 0.7 ? "text-amber-400/40" : "text-emerald-400/40";
    const glow = ratio >= 1
        ? "drop-shadow(0 0 18px rgba(239,68,68,0.7)) drop-shadow(0 0 6px rgba(239,68,68,0.5))"
        : ratio >= 0.7
        ? "drop-shadow(0 0 14px rgba(245,158,11,0.6)) drop-shadow(0 0 5px rgba(245,158,11,0.4))"
        : "drop-shadow(0 0 12px rgba(16,185,129,0.5)) drop-shadow(0 0 4px rgba(16,185,129,0.3))";

    return (
        <div className="flex items-baseline gap-1" style={{ filter: glow }}>
            <span className={cn("text-7xl font-bold tabular-nums leading-none transition-colors duration-300", color)}
                style={{ textShadow: "0 3px 12px rgba(0,0,0,0.9)" }}>
                {display}
            </span>
            <span className={cn("text-3xl font-bold tabular-nums", threshColor)}
                style={{ textShadow: "0 2px 8px rgba(0,0,0,0.9)" }}>
                /{threshold}
            </span>
        </div>
    );
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
        <div className={cn("flex flex-col items-center justify-center gap-2 bg-zinc-950", className)}>
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

// Device Video Cell
function DeviceCell({ device, selected, onSelect, vcaRules }: { device: DeviceView; selected: boolean; onSelect: () => void; vcaRules: VCARule[] }) {
    const centroid = occupancyCentroid(vcaRules);
    const ratio = device.threshold > 0 ? device.peopleCount / device.threshold : 0;
    const isAlert = ratio >= 1;
    const isWarning = ratio >= 0.7;
    const borderColor = selected ? "border-violet-500/60" : isAlert ? "border-red-500/60" : isWarning ? "border-amber-500/40" : "border-border";
    const statusLabel = isAlert ? "LLENO" : isWarning ? "ALTO" : "OK";
    const statusColor = isAlert ? "text-red-400" : isWarning ? "text-amber-400" : "text-emerald-400";

    return (
        <div className={cn(
            "relative group rounded-lg overflow-hidden border-2 transition-all duration-300 cursor-pointer",
            borderColor, isAlert && "shadow-lg shadow-red-500/20",
            selected && "shadow-lg shadow-violet-500/20 ring-1 ring-violet-500/30"
        )} onClick={onSelect}>
            <div className="relative aspect-video vid-surface">
                <LiveVideo streamName={device.streamName} fallbackDeviceId={device.deviceId} className="absolute inset-0 w-full h-full" />
                <VCAOverlay rules={vcaRules} />
                {centroid && (
                    <div className="absolute z-[9] pointer-events-none select-none"
                        style={{ left: `${centroid.x}%`, top: `${centroid.y}%`, transform: "translate(-50%, -50%)",
                            animation: `aforoBeat ${isAlert ? "0.8s" : "1.6s"} ease-in-out infinite` }}>
                        <span className="font-bold tabular-nums leading-none"
                            style={{ fontSize: "clamp(40px, 12vw, 120px)",
                                color: isAlert ? "#f87171" : isWarning ? "#fbbf24" : "#34d399",
                                opacity: 0.5, textShadow: "0 2px 18px rgba(0,0,0,0.55)" }}>
                            {device.peopleCount}
                        </span>
                    </div>
                )}
                {isAlert && <div className="absolute inset-0 bg-red-500/10 animate-pulse pointer-events-none" />}

                {/* Top Bar */}
                <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-3 py-2 bg-gradient-to-b from-black/70 to-transparent pointer-events-none">
                    <div className="flex items-center gap-1.5">
                        <div className={cn("w-1.5 h-1.5 rounded-full", isAlert ? "bg-red-500 animate-ping" : isWarning ? "bg-amber-500" : "bg-emerald-500")} />
                        <span className="text-[11px] font-semibold text-white/90 tracking-wide uppercase" style={{ textShadow: "0 1px 4px rgba(0,0,0,0.8)" }}>
                            {device.deviceName}
                        </span>
                        <span className={cn("text-[9px] font-bold uppercase ml-1", statusColor)} style={{ textShadow: "0 1px 3px rgba(0,0,0,0.8)" }}>
                            {statusLabel}
                        </span>
                    </div>
                    {selected && <Badge variant="outline" className="text-[8px] bg-violet-500/20 border-violet-500/40 text-violet-300 py-0 px-1.5">SELECCIONADA</Badge>}
                </div>

                {/* Bottom Right — BIG count inline */}
                <div className="absolute bottom-3 right-4 pointer-events-none">
                    <AnimatedCounter value={device.peopleCount} threshold={device.threshold} />
                </div>

                {/* Bottom occupancy bar */}
                <div className="absolute bottom-0 left-0 right-0 h-1.5 bg-black/40 pointer-events-none">
                    <div className={cn("h-full transition-all duration-700", isAlert ? "bg-red-500" : isWarning ? "bg-amber-500" : "bg-emerald-500")}
                        style={{ width: `${Math.min(ratio * 100, 100)}%` }} />
                </div>
            </div>
        </div>
    );
}

// Timeline — curva de aforo por ventana de tiempo, con cortes y capturas
function InteractiveTimeline({ events, hourly, deviceName, outages, onEventClick }: {
    events: TimelineEvent[]; hourly: HourlyData[]; deviceName: string; outages?: any[]; onEventClick: (e: TimelineEvent) => void;
}) {
    const [timeRange, setTimeRange] = useState<string>("today");
    const [customFrom, setCustomFrom] = useState("");
    const [customTo, setCustomTo] = useState("");
    const [hover, setHover] = useState<number | null>(null);
    const [pinned, setPinned] = useState<(TimelineEvent & { ms: number }) | null>(null);

    const [zoomWin, setZoomWin] = useState<{ s: number; e: number } | null>(null);
    const plotRef = useRef<HTMLDivElement>(null);
    useEffect(() => { setZoomWin(null); }, [timeRange, customFrom, customTo]);

    const nowMs = Date.now();
    let baseStart: number, baseEnd: number = nowMs;
    switch (timeRange) {
        case "1h": baseStart = nowMs - 60 * 60 * 1000; break;
        case "3h": baseStart = nowMs - 3 * 60 * 60 * 1000; break;
        case "6h": baseStart = nowMs - 6 * 60 * 60 * 1000; break;
        case "12h": baseStart = nowMs - 12 * 60 * 60 * 1000; break;
        case "custom":
            baseStart = customFrom ? new Date(customFrom).getTime() : nowMs - 60 * 60 * 1000;
            baseEnd = customTo ? new Date(customTo).getTime() : nowMs;
            break;
        default: { const d = new Date(); d.setHours(0, 0, 0, 0); baseStart = d.getTime(); baseEnd = nowMs; }
    }
    if (baseEnd <= baseStart) baseEnd = baseStart + 60 * 60 * 1000;
    const startMs = zoomWin ? zoomWin.s : baseStart;
    const endMs = zoomWin ? zoomWin.e : baseEnd;

    // Occupancy events within window, sorted
    const pts = events
        .filter(e => (e.channelName === "Aforo" || e.channelName === "Ocupación" || e.channelName === "Occupancy" || e.channelName === "General"))
        .map(e => ({ ...e, ms: new Date(e.timestamp).getTime() }))
        .filter(e => e.ms >= startMs && e.ms <= endMs)
        .sort((a, b) => a.ms - b.ms);

    const W = 1000, H = 210, PAD_L = 36, PAD_R = 14, PAD_T = 16, PAD_B = 26;
    const plotW = W - PAD_L - PAD_R, plotH = H - PAD_T - PAD_B;
    const maxV = Math.max(...pts.map(p => p.peopleCount), 4);
    const x = (ms: number) => PAD_L + ((ms - startMs) / (endMs - startMs)) * plotW;
    const y = (v: number) => PAD_T + (1 - v / maxV) * plotH;
    const baseY = y(0);

    const smooth = (arr: { ms: number; peopleCount: number }[]) => {
        if (arr.length === 0) return "";
        const P = arr.map(p => [x(p.ms), y(p.peopleCount)] as [number, number]);
        if (P.length === 1) return `M ${P[0][0]} ${P[0][1]}`;
        let d = `M ${P[0][0]} ${P[0][1]}`;
        for (let i = 0; i < P.length - 1; i++) {
            const p0 = P[i - 1] || P[i], p1 = P[i], p2 = P[i + 1], p3 = P[i + 2] || p2;
            const c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = p1[1] + (p2[1] - p0[1]) / 6;
            const c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = p2[1] - (p3[1] - p1[1]) / 6;
            d += ` C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p2[0]} ${p2[1]}`;
        }
        return d;
    };
    const line = smooth(pts);
    const area = line ? `${line} L ${x(pts[pts.length - 1].ms)} ${baseY} L ${x(pts[0].ms)} ${baseY} Z` : "";

    const ticks = Array.from({ length: 6 }, (_, i) => {
        const ms = startMs + (i / 5) * (endMs - startMs);
        const d = new Date(ms);
        return { x: x(ms), label: `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}` };
    });

    const outBands = (outages || [])
        .map((o: any) => ({ s: new Date(o.startedAt).getTime(), e: o.endedAt ? new Date(o.endedAt).getTime() : nowMs }))
        .map(o => ({ s: Math.max(o.s, startMs), e: Math.min(o.e, endMs) }))
        .filter(o => o.e > o.s);

    const tip = hover != null ? pts[hover] : null;

    const winRef = useRef({ startMs, endMs, n: pts.length });
    winRef.current = { startMs, endMs, n: pts.length };
    useEffect(() => {
        const el = plotRef.current; if (!el) return;
        const handler = (e: any) => {
            const { startMs, endMs, n } = winRef.current;
            if (n < 2) return;
            e.preventDefault();
            const rect = el.getBoundingClientRect();
            const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
            const cursorMs = startMs + frac * (endMs - startMs);
            if (e.ctrlKey || e.metaKey) {
                const factor = e.deltaY < 0 ? 0.82 : 1.22;
                let span = (endMs - startMs) * factor;
                span = Math.max(60000, Math.min(span, 7 * 24 * 3600 * 1000));
                const s = cursorMs - frac * span;
                setZoomWin({ s, e: s + span });
            } else {
                const span = endMs - startMs;
                const shift = (e.deltaY || e.deltaX || 0) * (span / 700);
                setZoomWin({ s: startMs + shift, e: endMs + shift });
            }
        };
        el.addEventListener("wheel", handler, { passive: false });
        return () => el.removeEventListener("wheel", handler);
    }, []);

    return (
        <div className="rounded-2xl border border-border bg-gradient-to-b from-foreground/[0.03] to-transparent overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-border flex-wrap gap-2">
                <div className="flex items-center gap-2">
                    <Clock size={13} className="text-violet-400" />
                    <span className="text-xs font-semibold text-foreground/80">Flujo de aforo · {deviceName}</span>
                    {outBands.length > 0 && <span className="text-[10px] text-rose-400 font-medium">· {outBands.length} corte{outBands.length === 1 ? "" : "s"}</span>}
                    <span className="text-[9px] text-muted-foreground hidden lg:inline">· Ctrl+rueda: zoom · rueda: desplazar</span>
                </div>
                <div className="flex items-center gap-1 p-0.5 rounded-lg bg-muted/60 border border-border">
                    {[{ k: "1h", l: "1h" }, { k: "3h", l: "3h" }, { k: "6h", l: "6h" }, { k: "12h", l: "12h" }, { k: "today", l: "Hoy" }].map(({ k, l }) => (
                        <button key={k} onClick={() => setTimeRange(k)}
                            className={cn("px-2.5 py-1 rounded-md text-[11px] font-semibold transition", timeRange === k ? "bg-violet-600 text-white" : "text-muted-foreground hover:text-foreground")}>{l}</button>
                    ))}
                    <button onClick={() => setTimeRange("custom")}
                        className={cn("px-2 py-1 rounded-md transition", timeRange === "custom" ? "bg-violet-600 text-white" : "text-muted-foreground hover:text-foreground")}><Calendar size={12} /></button>
                    {zoomWin && <button onClick={() => setZoomWin(null)} title="Restablecer zoom" className="px-2 py-1 rounded-md text-[11px] font-bold text-violet-400 hover:text-foreground">↺</button>}
                </div>
            </div>

            {timeRange === "custom" && (
                <div className="flex items-center gap-3 px-4 py-2 border-b border-border flex-wrap">
                    <span className="text-[10px] text-muted-foreground font-mono uppercase">Desde</span>
                    <input type="datetime-local" value={customFrom} onChange={e => setCustomFrom(e.target.value)} className="bg-muted/50 border border-border rounded px-2 py-1 text-[11px] text-foreground font-mono outline-none" />
                    <span className="text-[10px] text-muted-foreground font-mono uppercase">Hasta</span>
                    <input type="datetime-local" value={customTo} onChange={e => setCustomTo(e.target.value)} className="bg-muted/50 border border-border rounded px-2 py-1 text-[11px] text-foreground font-mono outline-none" />
                </div>
            )}

            <div className="relative p-4 flex flex-col lg:flex-row gap-4 items-stretch">
                <div ref={plotRef} className="relative flex-1 min-w-0" style={{ touchAction: "none" }}>
                {pts.length < 2 ? (
                    <div className="h-[210px] flex items-center justify-center text-muted-foreground text-sm">Sin lecturas de aforo en este período.</div>
                ) : (
                    <>
                        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: "auto", maxHeight: 240 }} preserveAspectRatio="none" onMouseLeave={() => setHover(null)}>
                            <defs>
                                <linearGradient id="mqFlowFill" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="0%" stopColor="#a855f7" stopOpacity="0.35" />
                                    <stop offset="100%" stopColor="#a855f7" stopOpacity="0" />
                                </linearGradient>
                            </defs>
                            {[0, 0.5, 1].map((g, i) => (
                                <g key={i}>
                                    <line x1={PAD_L} y1={PAD_T + g * plotH} x2={W - PAD_R} y2={PAD_T + g * plotH} stroke="var(--border)" strokeWidth="1" strokeDasharray={g === 1 ? "0" : "4 6"} opacity={g === 1 ? 0.8 : 0.4} />
                                    <text x={PAD_L - 6} y={PAD_T + g * plotH + 3} textAnchor="end" fontSize="10" fontFamily="var(--font-sans)" style={{ fill: "var(--muted-foreground)" }}>{Math.round(maxV * (1 - g))}</text>
                                </g>
                            ))}
                            {/* outage bands */}
                            {outBands.map((o, i) => (
                                <g key={`o${i}`}>
                                    <rect x={x(o.s)} y={PAD_T} width={Math.max(x(o.e) - x(o.s), 2)} height={plotH} fill="rgba(244,63,94,0.14)" />
                                    <line x1={x(o.s)} y1={PAD_T} x2={x(o.s)} y2={baseY} stroke="rgba(244,63,94,0.6)" strokeWidth="1" strokeDasharray="2 2" />
                                </g>
                            ))}
                            {area && <path d={area} fill="url(#mqFlowFill)" />}
                            {line && <path d={line} fill="none" stroke="#a855f7" strokeWidth="2.75" strokeLinecap="round" strokeLinejoin="round" />}
                            {/* now line */}
                            {nowMs >= startMs && nowMs <= endMs && (
                                <line x1={x(nowMs)} y1={PAD_T} x2={x(nowMs)} y2={baseY} stroke="#ef4444" strokeWidth="1.5" strokeDasharray="3 3" opacity="0.8" />
                            )}
                            {/* hover guide */}
                            {tip && <line x1={x(tip.ms)} y1={PAD_T} x2={x(tip.ms)} y2={baseY} stroke="var(--foreground)" strokeWidth="1" strokeDasharray="3 3" opacity="0.25" />}
                            {/* event dots / hit areas */}
                            {pts.map((p, i) => (
                                <g key={p.id} onMouseEnter={() => setHover(i)} onClick={() => setPinned(p)} style={{ cursor: "pointer" }}>
                                    <circle cx={x(p.ms)} cy={y(p.peopleCount)} r="8" fill="transparent" />
                                    <circle cx={x(p.ms)} cy={y(p.peopleCount)} r={hover === i ? 4 : 2.2} fill="#a855f7" stroke="var(--background)" strokeWidth="1.5" />
                                </g>
                            ))}
                            {/* x ticks */}
                            {ticks.map((t, i) => (
                                <text key={i} x={t.x} y={H - 8} textAnchor="middle" fontSize="10" fontFamily="var(--font-sans)" style={{ fill: "var(--muted-foreground)" }}>{t.label}</text>
                            ))}
                        </svg>

                        {tip && (
                            <div className="absolute -translate-x-1/2 pointer-events-none z-30" style={{ left: `${(x(tip.ms) / W) * 100}%`, top: 6 }}>
                                <div className="bg-popover/95 backdrop-blur border border-border rounded-lg shadow-xl overflow-hidden">
                                    {tip.snapshotPath && (
                                        <div className="w-32 h-20 overflow-hidden bg-black/60">
                                            <img src={tip.snapshotPath.startsWith("/") ? tip.snapshotPath : `/api/files/lpr-prod/${tip.snapshotPath}`} alt="" className="w-full h-full object-cover" draggable={false} />
                                        </div>
                                    )}
                                    <div className="px-2.5 py-1.5 text-center">
                                        <div className="text-[11px] font-bold text-foreground">Aforo {tip.peopleCount}</div>
                                        <div className="text-[9px] text-muted-foreground font-mono">{new Date(tip.ms).toLocaleTimeString("es-UY", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</div>
                                    </div>
                                </div>
                            </div>
                        )}
                    </>
                )}
                </div>

                {/* Pinned slide box — depository for clicked points */}
                <div className="lg:w-56 shrink-0 flex flex-col">
                    <div className="relative aspect-square w-full rounded-xl overflow-hidden border border-border bg-black/40">
                        {pinned ? (
                            <>
                                {pinned.snapshotPath ? (
                                    <img src={pinned.snapshotPath.startsWith("/") ? pinned.snapshotPath : `/api/files/lpr-prod/${pinned.snapshotPath}`} alt="" className="absolute inset-0 w-full h-full object-cover" draggable={false} />
                                ) : (
                                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 text-white/40 bg-black/50"><ImageIcon size={28} className="opacity-50" /><span className="text-[10px]">Sin captura</span></div>
                                )}
                                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/40 to-transparent px-3 pt-8 pb-2.5">
                                    <div className="flex items-end justify-between">
                                        <div>
                                            <div className="text-[9px] uppercase tracking-widest text-white/60 font-bold">Aforo</div>
                                            <div className="text-4xl font-bold tabular-nums text-white leading-none drop-shadow">{pinned.peopleCount}</div>
                                        </div>
                                        <div className="text-[10px] font-mono text-white/80 pb-1">{new Date(pinned.ms).toLocaleTimeString("es-UY", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</div>
                                    </div>
                                </div>
                                <button onClick={() => onEventClick(pinned)} title="Ampliar" className="absolute top-2 right-2 p-1.5 rounded-md bg-black/55 hover:bg-black/80 text-white/90 transition"><Maximize2 size={13} /></button>
                            </>
                        ) : (
                            <div className="absolute inset-0 flex flex-col items-center justify-center text-center gap-2 px-4 text-muted-foreground">
                                <ImageIcon size={26} className="opacity-40" />
                                <span className="text-[11px] leading-tight">Clic en un punto del gráfico para fijar su captura aquí</span>
                            </div>
                        )}
                    </div>
                    {pinned && (
                        <button onClick={() => setPinned(null)} className="mt-2 text-[10px] text-muted-foreground hover:text-foreground transition self-center">Limpiar</button>
                    )}
                </div>
            </div>

            {/* legend */}
            <div className="flex items-center gap-4 px-4 pb-2 text-[10px] text-muted-foreground">
                <span className="flex items-center gap-1.5"><span className="w-3 h-[3px] rounded bg-violet-500 inline-block" /> Aforo</span>
                <span className="flex items-center gap-1.5"><span className="w-3 h-2 rounded-sm inline-block" style={{ background: "rgba(244,63,94,0.4)" }} /> Corte de cámara</span>
                <span className="flex items-center gap-1.5"><span className="w-3 h-[2px] rounded bg-red-500 inline-block" /> Ahora</span>
                <span className="ml-auto font-mono">{pts.length} lecturas</span>
            </div>
        </div>
    );
}


// Event Preview Overlay
function EventPreview({ event, onClose }: { event: TimelineEvent; onClose: () => void }) {
    const imgSrc = event.snapshotPath ? (event.snapshotPath.startsWith("/") ? event.snapshotPath : `/api/files/lpr-prod/${event.snapshotPath}`) : null;
    const time = new Date(event.timestamp).toLocaleTimeString("es-UY", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={onClose}>
            <div className="relative max-w-2xl w-full mx-4 rounded-xl overflow-hidden border border-border bg-card shadow-lg" onClick={e => e.stopPropagation()}>
                {imgSrc && <img src={imgSrc} alt="" className="w-full aspect-video object-cover" />}
                <div className="p-4 flex items-center justify-between">
                    <div>
                        <div className="text-sm font-semibold text-foreground">{event.deviceName}</div>
                        <div className="text-xs text-foreground/70 font-mono">{time}</div>
                    </div>
                    <div className="text-right">
                        <div className="text-2xl font-bold text-violet-400 tabular-nums">{event.peopleCount}</div>
                        <div className="text-[9px] text-muted-foreground font-mono uppercase">personas</div>
                    </div>
                </div>
            </div>
        </div>
    );
}

// MAIN PAGE
export default function MonitorQueuePage() {
    const [devices, setDevices] = useState<DeviceView[]>([]);
    const [hourly, setHourly] = useState<HourlyData[]>([]);
    const [outages, setOutages] = useState<any[]>([]);
    const [recentEvents, setRecentEvents] = useState<TimelineEvent[]>([]);
    const [selectedDevice, setSelectedDevice] = useState<string | null>(null);
    const [gridLayout, setGridLayout] = useState<GridLayout>("auto");
    const [loading, setLoading] = useState(true);
    const [soundEnabled, setSoundEnabled] = useState(true);
    const [previewEvent, setPreviewEvent] = useState<TimelineEvent | null>(null);
    const [vcaByDevice, setVcaByDevice] = useState<Record<string, VCARule[]>>({});
    const socketRef = useRef<any>(null);
    const lastAlertRef = useRef<string>("");

    const loadData = useCallback(async () => {
        try {
            const _sod = new Date(); _sod.setHours(0,0,0,0);
            const [countsRaw, hourlyData, alertsData, eventsData, outagesData] = await Promise.all([
                getLatestQueueCounts(), getQueueHourlyBreakdown(), getQueueAlerts(), getQueueEvents({ take: 500 }), getCameraOutages({ from: _sod, includeOpen: true }),
            ]);
            const deviceMap = new Map<string, DeviceView>();
            for (const item of countsRaw) {
                const existing = deviceMap.get(item.device.id);
                const occCh = item.channels.find((c: any) => ["Aforo", "IVA Aforo", "Occupancy", "Ocupación"].includes(c.channelName));
                const maxCount = occCh ? occCh.peopleCount : Math.max(...item.channels.map((c: any) => c.peopleCount), 0);
                const avgCount = Math.round(item.channels.reduce((s: number, c: any) => s + c.peopleCount, 0) / item.channels.length * 10) / 10;
                const latestUpdate = item.channels.reduce((latest: Date, c: any) => { const d = new Date(c.lastUpdate); return d > latest ? d : latest; }, new Date(0));
                const alert = alertsData.find((a: any) => a.deviceId === item.device.id || !a.deviceId);
                if (!existing) {
                    deviceMap.set(item.device.id, {
                        deviceId: item.device.id, deviceName: item.device.name, deviceIp: item.device.ip, location: item.device.location,
                        peopleCount: maxCount, avgCount, channelCount: item.channels.length, lastUpdate: latestUpdate,
                        threshold: alert?.threshold ?? 10, channels: item.channels.map((c: any) => c.channelName), streamName: getStreamName(item.device.ip),
                    });
                } else {
                    existing.peopleCount = maxCount;
                    existing.channelCount += item.channels.length;
                    existing.channels.push(...item.channels.map((c: any) => c.channelName));
                }
            }
            setDevices(Array.from(deviceMap.values()));
            setHourly(hourlyData);
            setOutages(outagesData || []);
            setRecentEvents(eventsData.events.map((e: any) => ({
                id: e.id, timestamp: e.timestamp, channelName: e.channelName || "General", peopleCount: e.peopleCount,
                deviceName: e.device?.name || "?", deviceId: e.deviceId || "", snapshotPath: e.snapshotPath || null,
            })));
            setLoading(false);
        } catch (err) { console.error("Failed to load queue data:", err); }
    }, []);

    useEffect(() => {
        loadData();
        const interval = setInterval(loadData, 8000);
        const socket = io(window.location.origin, { path: "/io/socket.io", transports: ["polling"] });
        socket.on("webhook-event", (data: any) => {
            if (data.type === "BOSCH" || data.type === "QUEUE") {
                loadData();
                const count = data.peopleCount || data.count || 0;
                const key = `${data.deviceId}-${count}`;
                if (count >= 8 && soundEnabled && key !== lastAlertRef.current) {
                    lastAlertRef.current = key;
                    try { new Audio("/sounds/alert.mp3").play().catch(() => {}); } catch {}
                }
            }
        });
        socketRef.current = socket;
        return () => { clearInterval(interval); socket.disconnect(); };
    }, [loadData, soundEnabled]);

    // Fetch VCA zones per device (once each)
    useEffect(() => {
        devices.forEach(d => {
            if (vcaByDevice[d.deviceId]) return;
            fetch(`/api/queue/vca-config?deviceId=${encodeURIComponent(d.deviceId)}`)
                .then(r => r.ok ? r.json() : null)
                .then(cfg => { if (cfg && Array.isArray(cfg.rules)) setVcaByDevice(prev => ({ ...prev, [d.deviceId]: cfg.rules })); })
                .catch(() => {});
        });
    }, [devices, vcaByDevice]);

    const selectedDeviceData = devices.find(d => d.deviceId === selectedDevice);
    const filteredEvents = selectedDevice ? recentEvents.filter(e => e.deviceId === selectedDevice) : recentEvents;
    const gridCols = gridLayout === "1x1" ? "grid-cols-1" : gridLayout === "2x2" ? "grid-cols-2" : gridLayout === "3x3" ? "grid-cols-3"
        : devices.length <= 1 ? "grid-cols-1" : devices.length <= 4 ? "grid-cols-2" : "grid-cols-3";

    if (loading) {
        return <div className="flex items-center justify-center h-[80vh]">
            <div className="flex flex-col items-center gap-3">
                <Radio className="w-8 h-8 text-violet-500 animate-pulse" />
                <span className="text-sm text-muted-foreground font-mono">{"Conectando cámaras..."}</span>
            </div>
        </div>;
    }

    return (
        <div className="space-y-4 p-6">
            <style>{`@keyframes aforoBeat { 0%, 100% { transform: translate(-50%, -50%) scale(1); } 50% { transform: translate(-50%, -50%) scale(1.1); } }`}</style>
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-violet-500/10 border border-violet-500/20 flex items-center justify-center">
                        <Video size={18} className="text-violet-400" />
                    </div>
                    <div>
                        <h1 className="text-lg font-bold text-foreground tracking-tight">Monitor en Vivo</h1>
                        <p className="text-[11px] text-muted-foreground font-mono">
                            {devices.length}{" cámara"}{devices.length !== 1 ? "s" : ""}{" · RTSP en vivo · "}{new Date().toLocaleTimeString("es-UY", { hour: "2-digit", minute: "2-digit" })}
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-1.5">
                    <div className="flex items-center gap-0.5 bg-foreground/[0.04] border border-border rounded-md p-0.5">
                        {[
                            { layout: "auto" as GridLayout, icon: <LayoutGrid size={13} /> },
                            { layout: "1x1" as GridLayout, icon: <Square size={13} /> },
                            { layout: "2x2" as GridLayout, icon: <Columns size={13} /> },
                            { layout: "3x3" as GridLayout, icon: <Grid3X3 size={13} /> },
                        ].map(({ layout, icon }) => (
                            <button key={layout} onClick={() => setGridLayout(layout)}
                                className={cn("p-1.5 rounded transition-all", gridLayout === layout ? "bg-violet-500/20 text-violet-400" : "text-muted-foreground hover:text-foreground/60")}>{icon}</button>
                        ))}
                    </div>
                    <button onClick={() => setSoundEnabled(p => !p)}
                        className={cn("p-2 rounded-md border transition-all", soundEnabled ? "border-violet-500/30 bg-violet-500/10 text-violet-400" : "border-border bg-foreground/[0.04] text-muted-foreground")}>
                        {soundEnabled ? <Volume2 size={14} /> : <VolumeX size={14} />}
                    </button>
                    <Button variant="ghost" size="sm" onClick={loadData} className="h-8 gap-1.5 text-muted-foreground hover:text-foreground text-[11px]"><RefreshCw size={12} /></Button>
                </div>
            </div>

            {/* Video Grid — centered */}
            {devices.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 gap-3">
                    <Camera className="w-12 h-12 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">{"No hay cámaras de conteo activas"}</span>
                </div>
            ) : (
                <div className={cn("grid gap-3 mx-auto", gridCols,
                    devices.length === 1 && "max-w-4xl",
                    devices.length === 2 && "max-w-5xl"
                )}>
                    {devices.map((device) => (
                        <DeviceCell key={device.deviceId} device={device}
                            selected={selectedDevice === device.deviceId}
                            vcaRules={vcaByDevice[device.deviceId] || []}
                            onSelect={() => setSelectedDevice(prev => prev === device.deviceId ? null : device.deviceId)} />
                    ))}
                </div>
            )}

            {selectedDevice && selectedDeviceData && (
                <InteractiveTimeline events={filteredEvents} hourly={hourly} outages={outages}
                    deviceName={selectedDeviceData.deviceName} onEventClick={setPreviewEvent} />
            )}

            {!selectedDevice && devices.length > 0 && (
                <div className="flex items-center justify-center py-3">
                    <div className="flex items-center gap-2 bg-foreground/[0.04] rounded-full px-4 py-2 border border-border">
                        <Camera size={12} className="text-muted-foreground" />
                        <span className="text-[10px] text-muted-foreground font-mono">{"Selecciona una cámara para ver su timeline"}</span>
                    </div>
                </div>
            )}


            {previewEvent && <EventPreview event={previewEvent} onClose={() => setPreviewEvent(null)} />}
        </div>
    );
}
