"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import {
    TrendingUp, Users, Activity, RefreshCw, Filter,
    BarChart3, Eye, Calendar, ChevronLeft, ChevronRight,
    Image as ImageIcon, X, Wifi, MonitorSmartphone, Cpu, Camera, ArrowLeftRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { getQueueEvents, getQueueStatsToday, getQueueHourlyBreakdown, getQueueDevices, getCameraOutages, getQueueFlowHourly, getQueueAforoSeries, getQueueFlowSeries } from "@/app/actions/queue";
import Image from "next/image";

// ─── Brand Config (logos) ────────────────────────────
const BRAND_CONFIG: Record<string, { label: string; color: string; logoUrl: string }> = {
    HIKVISION: { label: "Hikvision", color: "#E4002B", logoUrl: "/logos/hikvision.png" },
    BOSCH: { label: "Bosch", color: "#E20015", logoUrl: "/bosch.png" },
    DAHUA: { label: "Dahua", color: "#ED1C24", logoUrl: "https://upload.wikimedia.org/wikipedia/commons/b/b3/Dahua_Technology_logo.svg" },
    INTELBRAS: { label: "Intelbras", color: "#009639", logoUrl: "https://upload.wikimedia.org/wikipedia/commons/f/ff/Intelbras_logo.svg" },
    AKUVOX: { label: "Akuvox", color: "#005BA4", logoUrl: "/logos/akuvox.png" },
    ZKTECO: { label: "ZKTeco", color: "#0191D2", logoUrl: "https://www.zkteco.com/upload/201908/5d4d3c3f3f0f7.png" },
    UNIFI: { label: "UniFi", color: "#0559C9", logoUrl: "https://upload.wikimedia.org/wikipedia/commons/e/e0/Ubiquiti_Networks_logo.svg" },
    UNIVIEW: { label: "Uniview", color: "#005EB8", logoUrl: "https://www.uniview.com/etc/designs/uniview/logo.png" },
    MILESIGHT: { label: "Milesight", color: "#00AEEF", logoUrl: "" },
};

// ─── Types ───────────────────────────────────────────
interface CrowdEvent {
    id: string;
    timestamp: Date;
    channelName: string;
    channelId: number;
    peopleCount: number;
    snapshotPath: string | null;
    device: { id: string; name: string; location: string | null; ip: string; brand: string };
}

interface HourlyData {
    hour: number;
    avg: number;
    max: number;
    count: number;
}

// ─── Helpers ─────────────────────────────────────────
function snapUrl(path: string | null): string | null {
    if (!path) return null;
    return path.startsWith("/") ? path : `/api/files/lpr-prod/${path}`;
}

// ─── Live video (MP4-over-HTTP) + offline state ─────
function getStreamName(ip: string): string { return `bosch_${ip.replace(/\./g, "_")}`; }

function FallbackSnapshot({ deviceId, className }: { deviceId: string; className?: string }) {
    const [src, setSrc] = useState(`/api/snapshot/${deviceId}?t=${Date.now()}`);
    const [hasError, setHasError] = useState(false);
    useEffect(() => {
        const iv = setInterval(() => { setSrc(`/api/snapshot/${deviceId}?t=${Date.now()}`); setHasError(false); }, 5000);
        return () => clearInterval(iv);
    }, [deviceId]);
    if (hasError) return (
        <div className={cn("flex flex-col items-center justify-center gap-2 bg-zinc-950", className)}>
            <div className="relative"><Camera className="w-9 h-9 text-muted-foreground" /><span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" /></div>
            <span className="text-xs font-semibold text-foreground/70">Cámara offline</span>
            <span className="text-[10px] text-muted-foreground">Sin señal · reintentando…</span>
        </div>
    );
    return <img src={src} alt="Live" className={cn("object-cover", className)} onError={() => setHasError(true)} draggable={false} />;
}

function LiveVideo({ streamName, fallbackDeviceId, className }: { streamName: string; fallbackDeviceId: string; className?: string }) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const [failed, setFailed] = useState(false);
    const retryRef = useRef(0);
    useEffect(() => {
        if (!streamName) { setFailed(true); return; }
        setFailed(false); retryRef.current = 0;
        const video = videoRef.current; if (!video) return;
        let destroyed = false; let retryTimer: ReturnType<typeof setTimeout> | null = null;
        const src = `/go2rtc/api/stream.mp4?src=${encodeURIComponent(streamName)}`;
        function load() { if (destroyed || !video) return; video.src = src; video.play().catch(() => {}); }
        function onError() { if (destroyed) return; retryRef.current++; if (retryRef.current > 6) { setFailed(true); return; } retryTimer = setTimeout(load, Math.min(1000 * retryRef.current, 5000)); }
        function onProgress() { if (!video || video.buffered.length === 0) return; const end = video.buffered.end(video.buffered.length - 1); if (end - video.currentTime > 3) video.currentTime = end - 0.4; }
        video.addEventListener("error", onError); video.addEventListener("progress", onProgress); load();
        return () => { destroyed = true; if (retryTimer) clearTimeout(retryTimer); video.removeEventListener("error", onError); video.removeEventListener("progress", onProgress); video.pause(); video.removeAttribute("src"); video.load(); };
    }, [streamName]);
    if (failed) return <FallbackSnapshot deviceId={fallbackDeviceId} className={className} />;
    return <video ref={videoRef} className={cn("object-cover", className)} autoPlay muted playsInline />;
}

// ─── Spectacular Flow Area Chart (SVG) ──────────────
function RangeToggle({ range, onRange }: { range: string; onRange: (r: string) => void }) {
    return (
        <div className="flex items-center gap-0.5 p-0.5 rounded-lg bg-muted/60 border border-border">
            {[{ k: "24h", l: "24h" }, { k: "7d", l: "7d" }, { k: "30d", l: "30d" }].map(o => (
                <button key={o.k} onClick={() => onRange(o.k)} className={cn("px-2 py-0.5 rounded-md text-[10px] font-bold transition", range === o.k ? "bg-violet-600 text-white" : "text-muted-foreground hover:text-foreground")}>{o.l}</button>
            ))}
        </div>
    );
}

function HourlyChart({ buckets = [], unit = "hour", range, onRange, outages = [], flow, className }: { buckets?: any[]; unit?: string; range: string; onRange: (r: string) => void; outages?: any[]; flow?: any; className?: string }) {
    const [animated, setAnimated] = useState(false);
    const [mode, setMode] = useState<"aforo" | "flujo">("aforo");
    const isFlow = mode === "flujo";
    useEffect(() => {
        const t = setTimeout(() => setAnimated(true), 80);
        return () => clearTimeout(t);
    }, [buckets]);

    const hours = (buckets && buckets.length ? buckets : Array.from({ length: 24 }, () => ({}))).map((b: any, i: number) => ({ hour: i, label: b.label ?? (String(i).padStart(2, "0") + "h"), avg: b.avg ?? 0, max: b.max ?? 0, count: b.count ?? 0 }));
    const N = hours.length || 24;
    const _flowSrc = flow?.buckets || flow?.hours || [];
    const fhours = hours.map((_h: any, i: number) => ({ entradas: _flowSrc[i]?.entradas ?? 0, salidas: _flowSrc[i]?.salidas ?? 0 }));

    const W = 1000, H = 240, PAD_L = 28, PAD_B = 26, PAD_T = 18;
    const maxVal = isFlow ? Math.max(...fhours.map((h: any) => Math.max(h.entradas, h.salidas)), 4) : Math.max(...hours.map(h => h.max), 4);
    const currentHour = unit === "hour" ? new Date().getHours() : N - 1;
    const totalEvents = hours.reduce((s, h) => s + h.count, 0);
    const peak = hours.reduce((m, h) => h.max > m.max ? h : m, hours[0]);

    const x = (h: number) => PAD_L + (N > 1 ? h / (N - 1) : 0) * (W - PAD_L - 10);
    const y = (v: number) => PAD_T + (1 - v / maxVal) * (H - PAD_T - PAD_B);

    // Smooth path (Catmull-Rom → bezier) for a series
    const smooth = (vals: number[]) => {
        const pts = vals.map((v, i) => [x(i), y(v)] as [number, number]);
        if (pts.length < 2) return "";
        let d = `M ${pts[0][0]} ${pts[0][1]}`;
        for (let i = 0; i < pts.length - 1; i++) {
            const p0 = pts[i - 1] || pts[i];
            const p1 = pts[i];
            const p2 = pts[i + 1];
            const p3 = pts[i + 2] || p2;
            const c1x = p1[0] + (p2[0] - p0[0]) / 6;
            const c1y = p1[1] + (p2[1] - p0[1]) / 6;
            const c2x = p2[0] - (p3[0] - p1[0]) / 6;
            const c2y = p2[1] - (p3[1] - p1[1]) / 6;
            d += ` C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p2[0]} ${p2[1]}`;
        }
        return d;
    };

    const baseY = y(0);
    const ser1 = isFlow ? smooth(fhours.map((h: any) => h.entradas)) : smooth(hours.map(h => h.avg));
    const ser2 = isFlow ? smooth(fhours.map((h: any) => h.salidas)) : smooth(hours.map(h => h.max));
    const area1 = ser1 ? `${ser1} L ${x(N - 1)} ${baseY} L ${x(0)} ${baseY} Z` : "";
    const area2 = ser2 ? `${ser2} L ${x(N - 1)} ${baseY} L ${x(0)} ${baseY} Z` : "";
    const col1 = isFlow ? "#10b981" : "#a855f7";
    const col2 = isFlow ? "#f59e0b" : "#d946ef";
    const fill1 = isFlow ? "url(#flowInFill)" : "url(#avgFill)";
    const fill2 = isFlow ? "url(#flowOutFill)" : "url(#maxFill)";

    return (
        <div className={cn("rounded-xl border border-border bg-gradient-to-b from-foreground/[0.04] to-transparent p-5", className)}>
            <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2 flex-wrap">
                    {isFlow ? <ArrowLeftRight size={14} className="text-cyan-400" /> : <BarChart3 size={14} className="text-violet-400" />}
                    <div className="inline-flex items-center gap-0.5 p-0.5 rounded-lg bg-muted/60 border border-border">
                        <button onClick={() => setMode("aforo")} className={cn("px-2.5 py-1 rounded-md text-[11px] font-semibold transition", !isFlow ? "bg-violet-600 text-white" : "text-muted-foreground hover:text-foreground")}>Aforo</button>
                        <button onClick={() => setMode("flujo")} className={cn("px-2.5 py-1 rounded-md text-[11px] font-semibold transition", isFlow ? "bg-cyan-600 text-white" : "text-muted-foreground hover:text-foreground")}>Entradas/Salidas</button>
                    </div>
                    <RangeToggle range={range} onRange={onRange} />
                </div>
                <div className="flex items-center gap-4 text-[10px] text-muted-foreground">
                    {isFlow ? (<>
                        <span className="flex items-center gap-1.5"><span className="w-3 h-[3px] rounded bg-emerald-500 inline-block" /> Entradas <b className="tabular-nums text-emerald-400">{flow?.totalIn ?? 0}</b></span>
                        <span className="flex items-center gap-1.5"><span className="w-3 h-[3px] rounded bg-amber-500 inline-block" /> Salidas <b className="tabular-nums text-amber-400">{flow?.totalOut ?? 0}</b></span>
                        <span className="text-foreground/70">Neto <b className={cn("tabular-nums", (flow?.net ?? 0) >= 0 ? "text-emerald-400" : "text-amber-400")}>{(flow?.net ?? 0) >= 0 ? "+" : ""}{flow?.net ?? 0}</b></span>
                    </>) : (<>
                        <span className="flex items-center gap-1.5"><span className="w-3 h-[3px] rounded bg-violet-400 inline-block" /> Promedio</span>
                        <span className="flex items-center gap-1.5"><span className="w-3 h-[3px] rounded bg-fuchsia-500/40 inline-block" /> Pico</span>
                        <span className="flex items-center gap-1.5"><span className="w-3 h-2 rounded-sm inline-block" style={{ background: "rgba(244,63,94,0.4)" }} /> Corte</span>
                        <span className="text-muted-foreground font-mono">{totalEvents} eventos · pico {peak.max} @ {peak.label}</span>
                    </>)}
                </div>
            </div>
            <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: "auto" }} preserveAspectRatio="none">
                <defs>
                    <linearGradient id="avgFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#a855f7" stopOpacity="0.45" />
                        <stop offset="100%" stopColor="#a855f7" stopOpacity="0" />
                    </linearGradient>
                    <linearGradient id="maxFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#d946ef" stopOpacity="0.18" />
                        <stop offset="100%" stopColor="#d946ef" stopOpacity="0" />
                    </linearGradient>
                    <linearGradient id="flowInFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#10b981" stopOpacity="0.4" />
                        <stop offset="100%" stopColor="#10b981" stopOpacity="0" />
                    </linearGradient>
                    <linearGradient id="flowOutFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.22" />
                        <stop offset="100%" stopColor="#f59e0b" stopOpacity="0" />
                    </linearGradient>
                    <filter id="lineGlow" x="-20%" y="-20%" width="140%" height="140%">
                        <feGaussianBlur stdDeviation="3" result="b" />
                        <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
                    </filter>
                </defs>

                {/* gridlines */}
                {[0, 0.25, 0.5, 0.75, 1].map((g, i) => (
                    <g key={i}>
                        <line x1={PAD_L} y1={PAD_T + g * (H - PAD_T - PAD_B)} x2={W - 10} y2={PAD_T + g * (H - PAD_T - PAD_B)} stroke="rgba(255,255,255,0.05)" strokeWidth="1" />
                        <text x={PAD_L - 6} y={PAD_T + g * (H - PAD_T - PAD_B) + 3} fill="rgba(255,255,255,0.25)" fontSize="9" textAnchor="end" fontFamily="monospace">{Math.round(maxVal * (1 - g))}</text>
                    </g>
                ))}

                {/* current hour marker */}
                <line x1={x(currentHour)} y1={PAD_T} x2={x(currentHour)} y2={baseY} stroke="rgba(168,85,247,0.35)" strokeWidth="1" strokeDasharray="3 3" />

                {/* camera outage bands (today) */}
                {(() => {
                    const startOfDay = new Date(); startOfDay.setHours(0,0,0,0);
                    const nowMs = Date.now();
                    const frac = (ms: number) => {
                        const d = new Date(ms);
                        if (d < startOfDay) return 0;
                        return Math.min(d.getHours() + d.getMinutes()/60, 23.999);
                    };
                    return (outages || []).map((o: any, i: number) => {
                        const sMs = new Date(o.startedAt).getTime();
                        const eMs = o.endedAt ? new Date(o.endedAt).getTime() : nowMs;
                        if (eMs < startOfDay.getTime()) return null;
                        const xs = x(frac(sMs)); const xe = x(frac(eMs));
                        const w = Math.max(xe - xs, 2);
                        return (
                            <g key={o.id || i}>
                                <rect x={xs} y={PAD_T} width={w} height={baseY - PAD_T} fill="rgba(244,63,94,0.14)" />
                                <line x1={xs} y1={PAD_T} x2={xs} y2={baseY} stroke="rgba(244,63,94,0.7)" strokeWidth="1" strokeDasharray="2 2" />
                                {o.endedAt && <line x1={xe} y1={PAD_T} x2={xe} y2={baseY} stroke="rgba(244,63,94,0.5)" strokeWidth="1" strokeDasharray="2 2" />}
                            </g>
                        );
                    });
                })()}

                {/* serie 2 (Pico / Salidas) */}
                {area2 && <path d={area2} fill={fill2} style={{ opacity: animated ? 1 : 0, transition: "opacity 1s ease" }} />}
                {ser2 && <path d={ser2} fill="none" stroke={col2} strokeOpacity={isFlow ? 0.9 : 0.4} strokeWidth={isFlow ? 2 : 1.5} style={{ opacity: animated ? 1 : 0, transition: "opacity 1s ease 0.1s" }} />}

                {/* serie 1 (Promedio / Entradas) */}
                {area1 && <path d={area1} fill={fill1} style={{ opacity: animated ? 1 : 0, transition: "opacity 1.1s ease" }} />}
                {ser1 && <path d={ser1} fill="none" stroke={col1} strokeWidth="2.5" strokeLinecap="round" filter="url(#lineGlow)" style={{ opacity: animated ? 1 : 0, transition: "opacity 1.1s ease 0.2s" }} />}

                {/* dots on hours with data */}
                {hours.map((h, i) => {
                    const val = isFlow ? fhours[i].entradas : h.avg;
                    const show = isFlow ? (fhours[i].entradas > 0 || fhours[i].salidas > 0) : h.count > 0;
                    return show ? (
                        <g key={h.hour} className="group">
                            <circle cx={x(h.hour)} cy={y(val)} r="9" fill="transparent" />
                            <circle cx={x(h.hour)} cy={y(val)} r={h.hour === currentHour ? 4 : 2.5} fill={h.hour === currentHour ? (isFlow ? "#34d399" : "#c084fc") : col1} stroke="#0b0b0f" strokeWidth="1.5">
                                {h.hour === currentHour && <animate attributeName="r" values="4;6;4" dur="1.6s" repeatCount="indefinite" />}
                            </circle>
                        </g>
                    ) : null;
                })}

                {/* hour axis labels (every 3h) */}
                {hours.filter((h: any, i: number) => i % Math.max(1, Math.ceil(N / 8)) === 0).map((h: any) => (
                    <text key={h.hour} x={x(h.hour)} y={H - 8} fill={h.hour === currentHour ? "#c084fc" : "rgba(255,255,255,0.25)"} fontSize="9" textAnchor="middle" fontFamily="monospace" fontWeight={h.hour === currentHour ? "bold" : "normal"}>{h.label}</text>
                ))}
            </svg>
        </div>
    );
}

// ─── Severity helper ─────────────────────────────────
function getSeverity(count: number) {
    if (count >= 10) return { key: "critical", color: "text-red-400", bg: "bg-red-500/10", border: "border-red-500/20", label: "Crítico" };
    if (count >= 7) return { key: "high", color: "text-amber-400", bg: "bg-amber-500/10", border: "border-amber-500/20", label: "Alto" };
    if (count >= 4) return { key: "medium", color: "text-blue-400", bg: "bg-blue-500/10", border: "border-blue-500/20", label: "Medio" };
    return { key: "low", color: "text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/20", label: "Bajo" };
}

// ─── Event Row ───────────────────────────────────────
function EventRow({ event, onExpand }: { event: CrowdEvent; onExpand: () => void }) {
    const sev = getSeverity(event.peopleCount);
    const time = new Date(event.timestamp);
    const timeStr = time.toLocaleTimeString("es-UY", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    const dateStr = time.toLocaleDateString("es-UY", { day: "2-digit", month: "short" });
    const brand = BRAND_CONFIG[event.device.brand] || null;
    const imgSrc = snapUrl(event.snapshotPath);

    return (
        <tr className="border-b border-border hover:bg-foreground/[0.04] transition-colors group cursor-pointer" onClick={onExpand}>
            {/* Thumbnail */}
            <td className="px-3 py-2">
                {imgSrc ? (
                    <div className="w-14 h-10 rounded-md overflow-hidden bg-black/50 relative ring-1 ring-white/5">
                        <img src={imgSrc} alt="" className="w-full h-full object-cover" loading="lazy" />
                    </div>
                ) : (
                    <div className="w-14 h-10 rounded-md bg-foreground/[0.04] flex items-center justify-center ring-1 ring-border">
                        <ImageIcon size={14} className="text-muted-foreground" />
                    </div>
                )}
            </td>
            {/* Time */}
            <td className="px-3 py-2">
                <div className="text-xs text-foreground/70 font-mono">{timeStr}</div>
                <div className="text-[9px] text-muted-foreground font-mono">{dateStr}</div>
            </td>
            {/* Regla VCA */}
            <td className="px-3 py-2">
                <span className="text-xs text-foreground/70">{event.channelName || `Regla ${event.channelId}`}</span>
            </td>
            {/* Dispositivo */}
            <td className="px-3 py-2">
                <div className="flex items-center gap-2">
                    <MonitorSmartphone size={12} className="text-muted-foreground shrink-0" />
                    <span className="text-xs text-foreground/70 font-medium">{event.device.name}</span>
                </div>
            </td>
            {/* IP */}
            <td className="px-3 py-2">
                <span className="text-[11px] text-muted-foreground font-mono">{event.device.ip}</span>
            </td>
            {/* Driver */}
            <td className="px-3 py-2">
                {brand ? (
                    <div className="flex items-center gap-1.5" title={brand.label}>
                        {brand.logoUrl ? (
                            <img src={brand.logoUrl} alt={brand.label} className="h-4 w-auto max-w-[60px] object-contain opacity-60" />
                        ) : (
                            <span className="text-[10px] font-mono text-muted-foreground">{brand.label}</span>
                        )}
                    </div>
                ) : (
                    <span className="text-[10px] font-mono text-muted-foreground">{event.device.brand || "—"}</span>
                )}
            </td>
            {/* Count */}
            <td className="px-3 py-2 text-center">
                <span className={cn("text-lg font-bold tabular-nums", sev.color)}>{event.peopleCount}</span>
            </td>
            {/* Severity */}
            <td className="px-3 py-2">
                <Badge className={cn("text-[9px] py-0 px-2 border", sev.color, sev.bg, sev.border)}>
                    {sev.label}
                </Badge>
            </td>
            {/* Action */}
            <td className="px-3 py-2">
                <Eye size={13} className="text-muted-foreground group-hover:text-foreground/40 transition-colors" />
            </td>
        </tr>
    );
}

// ─── Event Detail Panel ──────────────────────────────
function EventDetail({ event, onClose }: { event: CrowdEvent; onClose: () => void }) {
    const time = new Date(event.timestamp);
    const sev = getSeverity(event.peopleCount);
    const brand = BRAND_CONFIG[event.device.brand] || null;
    const imgSrc = snapUrl(event.snapshotPath);

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={onClose}>
            <div className="bg-card border border-border rounded-2xl w-full max-w-3xl overflow-hidden shadow-lg" onClick={e => e.stopPropagation()}>
                {/* Image */}
                {imgSrc ? (
                    <div className="relative aspect-video vid-surface">
                        <img src={imgSrc} alt="" className="w-full h-full object-contain" />
                        <div className="absolute top-3 right-3">
                            <button onClick={onClose} className="p-2 rounded-xl bg-black/60 text-white/60 hover:text-white hover:bg-black/80 transition-colors backdrop-blur-sm">
                                <X size={16} />
                            </button>
                        </div>
                        {/* Overlay bottom */}
                        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent px-6 py-5">
                            <div className="flex items-end justify-between">
                                <div>
                                    <div className="flex items-center gap-2 mb-1">
                                        <span className={cn("text-2xl font-bold", sev.color)}>{event.peopleCount}</span>
                                        <span className="text-foreground/70 text-sm font-medium">personas detectadas</span>
                                    </div>
                                    <span className="text-muted-foreground text-xs">{event.channelName}</span>
                                </div>
                                <Badge className={cn("text-xs py-0.5 px-3 border", sev.color, sev.bg, sev.border)}>
                                    {sev.label}
                                </Badge>
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="px-6 py-5 border-b border-border flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <span className={cn("text-2xl font-bold", sev.color)}>{event.peopleCount}</span>
                            <span className="text-foreground/70 font-medium">personas — {event.channelName}</span>
                        </div>
                        <button onClick={onClose} className="p-2 text-muted-foreground hover:text-foreground rounded-lg hover:bg-accent"><X size={16} /></button>
                    </div>
                )}
                {/* Details grid */}
                <div className="p-6">
                    <div className="grid grid-cols-3 gap-4">
                        {[
                            { label: "Fecha / Hora", value: time.toLocaleString("es-UY"), icon: Calendar },
                            { label: "Dispositivo", value: event.device.name, icon: MonitorSmartphone },
                            { label: "Dirección IP", value: event.device.ip, icon: Wifi },
                            { label: "Regla VCA", value: event.channelName || `Regla ${event.channelId}`, icon: Cpu },
                            { label: "Ubicación", value: event.device.location || "—", icon: Eye },
                            { label: "Driver", value: brand?.label || event.device.brand || "—", icon: Activity },
                        ].map(({ label, value, icon: Icon }) => (
                            <div key={label} className="flex items-start gap-2.5 p-3 rounded-lg bg-foreground/[0.04] border border-border">
                                <Icon size={14} className="text-muted-foreground mt-0.5 shrink-0" />
                                <div>
                                    <span className="text-[9px] text-muted-foreground font-mono uppercase block mb-0.5">{label}</span>
                                    <span className="text-xs text-foreground/70 font-medium">{value}</span>
                                </div>
                            </div>
                        ))}
                    </div>
                    {/* Driver logo */}
                    {brand?.logoUrl && (
                        <div className="mt-4 pt-4 border-t border-border flex items-center gap-2">
                            <span className="text-[9px] text-muted-foreground font-mono uppercase">Procesado por</span>
                            <img src={brand.logoUrl} alt={brand.label} className="h-5 w-auto max-w-[80px] object-contain opacity-50" />
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

// ─── Flujo: entradas vs salidas por hora ─────────────
function FlowSection({ flow, range, onRange, className }: { flow: any; range: string; onRange: (r: string) => void; className?: string }) {
    const [animated, setAnimated] = useState(false);
    useEffect(() => { const t = setTimeout(() => setAnimated(true), 80); return () => clearTimeout(t); }, [flow]);
    const _src = flow?.buckets || flow?.hours || [];
    const hours = (_src.length ? _src : Array.from({ length: 24 }, () => ({}))).map((b: any, i: number) => ({ hour: i, label: b.label ?? (String(i).padStart(2, "0") + "h"), entradas: b.entradas ?? 0, salidas: b.salidas ?? 0 }));
    const N = hours.length || 24;
    const maxV = Math.max(...hours.map(h => Math.max(h.entradas, h.salidas)), 4);
    const W = 1000, H = 240, PAD_L = 34, PAD_R = 14, PAD_T = 14, PAD_B = 30;
    const plotW = W - PAD_L - PAD_R, plotH = H - PAD_T - PAD_B;
    const gw = plotW / N;
    const bw = Math.max(gw / 2 - 1.5, 2);
    const y = (v: number) => PAD_T + (1 - v / maxV) * plotH;
    const nowH = (!flow?.unit || flow?.unit === "hour") ? new Date().getHours() : N - 1;
    return (
        <div className={cn("rounded-xl border border-border bg-gradient-to-b from-foreground/[0.03] to-transparent p-5", className)}>
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                <div className="flex items-center gap-2">
                    <ArrowLeftRight size={14} className="text-cyan-400" />
                    <span className="text-xs font-semibold text-foreground/70">Flujo · entradas y salidas</span>
                    <RangeToggle range={range} onRange={onRange} />
                </div>
                <div className="flex items-center gap-3 text-[11px]">
                    <span className="flex items-center gap-1.5 text-emerald-400"><span className="w-2.5 h-2.5 rounded-sm bg-emerald-500 inline-block" /> Entradas <b className="tabular-nums">{flow?.totalIn ?? 0}</b></span>
                    <span className="flex items-center gap-1.5 text-amber-400"><span className="w-2.5 h-2.5 rounded-sm bg-amber-500 inline-block" /> Salidas <b className="tabular-nums">{flow?.totalOut ?? 0}</b></span>
                    <span className="flex items-center gap-1.5 text-foreground/70">Neto <b className={cn("tabular-nums", (flow?.net ?? 0) >= 0 ? "text-emerald-400" : "text-amber-400")}>{(flow?.net ?? 0) >= 0 ? "+" : ""}{flow?.net ?? 0}</b></span>
                </div>
            </div>
            <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: "auto", maxHeight: 240 }} preserveAspectRatio="none">
                {[0, 0.5, 1].map((g, i) => (
                    <g key={i}>
                        <line x1={PAD_L} y1={PAD_T + g * plotH} x2={W - PAD_R} y2={PAD_T + g * plotH} stroke="var(--border)" strokeWidth="1" strokeDasharray={g === 1 ? "0" : "4 6"} opacity={g === 1 ? 0.8 : 0.4} />
                        <text x={PAD_L - 6} y={PAD_T + g * plotH + 3} textAnchor="end" fontSize="10" fontFamily="monospace" style={{ fill: "var(--muted-foreground)" }}>{Math.round(maxV * (1 - g))}</text>
                    </g>
                ))}
                {hours.map((h: any, i: number) => {
                    const gx = PAD_L + gw * h.hour;
                    const he = (h.entradas / maxV) * plotH * (animated ? 1 : 0);
                    const hs = (h.salidas / maxV) * plotH * (animated ? 1 : 0);
                    return (
                        <g key={i}>
                            <rect x={gx + 1} y={PAD_T + plotH - he} width={bw} height={he} rx="2" fill="#10b981" opacity={h.hour === nowH ? 1 : 0.85} style={{ transition: "all .6s ease" }}>
                                <title>{`${String(h.hour).padStart(2,"0")}:00 — Entradas: ${h.entradas}`}</title>
                            </rect>
                            <rect x={gx + 1 + bw + 1} y={PAD_T + plotH - hs} width={bw} height={hs} rx="2" fill="#f59e0b" opacity={h.hour === nowH ? 1 : 0.85} style={{ transition: "all .6s ease" }}>
                                <title>{`${String(h.hour).padStart(2,"0")}:00 — Salidas: ${h.salidas}`}</title>
                            </rect>
                            {i % Math.max(1, Math.ceil(N / 8)) === 0 && (
                                <text x={gx + gw / 2} y={H - 8} textAnchor="middle" fontSize="10" fontFamily="monospace" style={{ fill: h.hour === nowH ? "var(--foreground)" : "var(--muted-foreground)" }}>{h.label}</text>
                            )}
                        </g>
                    );
                })}
            </svg>
        </div>
    );
}

// ═══════════════════════════════════════════════════════
// ═══ MAIN PAGE ════════════════════════════════════════
// ═══════════════════════════════════════════════════════
export default function FlujoFilasPage() {
    const [events, setEvents] = useState<CrowdEvent[]>([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(0);
    const [hourly, setHourly] = useState<any>(null);
    const [range, setRange] = useState("24h");
    const [outages, setOutages] = useState<any[]>([]);
    const [flow, setFlow] = useState<any>(null);
    const [devices, setDevices] = useState<any[]>([]);
    const [stats, setStats] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [selectedEvent, setSelectedEvent] = useState<CrowdEvent | null>(null);

    // Filters
    const [filterDevice, setFilterDevice] = useState("");
    const [filterMinCount, setFilterMinCount] = useState("");
    const [filterFrom, setFilterFrom] = useState("");
    const [filterTo, setFilterTo] = useState("");
    const [showFilters, setShowFilters] = useState(false);

    const PAGE_SIZE = 25;

    const loadData = useCallback(async () => {
        try {
            const options: any = { take: PAGE_SIZE, skip: page * PAGE_SIZE };
            if (filterDevice) options.deviceId = filterDevice;
            if (filterMinCount) options.minCount = parseInt(filterMinCount);
            if (filterFrom) options.from = new Date(filterFrom);
            if (filterTo) options.to = new Date(filterTo);

            const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
            const [eventsData, hourlyData, devicesData, statsData, outagesData, flowData] = await Promise.all([
                getQueueEvents(options),
                getQueueAforoSeries(filterDevice || undefined, range),
                getQueueDevices(),
                getQueueStatsToday(),
                getCameraOutages({ from: startOfDay, deviceId: filterDevice || undefined, includeOpen: true }),
                getQueueFlowSeries(filterDevice || undefined, range),
            ]);

            setEvents(eventsData.events);
            setTotal(eventsData.total);
            setHourly(hourlyData);
            setOutages(outagesData || []);
            setFlow(flowData || null);
            setDevices(devicesData);
            setStats(statsData);
            setLoading(false);
        } catch (err) {
            console.error("Error loading flujo-filas:", err);
        }
    }, [page, filterDevice, filterMinCount, filterFrom, filterTo, range]);

    useEffect(() => {
        loadData();
    }, [loadData]);

    const totalPages = Math.ceil(total / PAGE_SIZE);

    if (loading) {
        return (
            <div className="flex items-center justify-center h-[80vh]">
                <div className="flex flex-col items-center gap-3">
                    <Activity className="w-8 h-8 text-violet-500 animate-pulse" />
                    <span className="text-sm text-muted-foreground font-mono">Cargando historial...</span>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-4 p-6">
            {/* ═══ HEADER ═══ */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-violet-500/10 border border-violet-500/20 flex items-center justify-center">
                        <Activity size={18} className="text-violet-400" />
                    </div>
                    <div>
                        <h1 className="text-lg font-bold text-foreground tracking-tight">Flujo de Filas</h1>
                        <p className="text-[11px] text-muted-foreground font-mono">{total.toLocaleString()} eventos registrados</p>
                    </div>
                </div>
                <div className="flex items-center gap-1.5">
                    <Button
                        variant="ghost" size="sm"
                        onClick={() => setShowFilters(f => !f)}
                        className={cn("h-8 gap-1.5 text-xs", showFilters ? "text-violet-400" : "text-muted-foreground hover:text-foreground")}
                    >
                        <Filter size={12} /> Filtros
                    </Button>
                    <Button variant="ghost" size="sm" onClick={loadData} className="h-8 text-muted-foreground hover:text-foreground">
                        <RefreshCw size={12} />
                    </Button>
                </div>
            </div>

            {/* ═══ CHART + KPIs ═══ */}
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-3">
                <HourlyChart buckets={hourly?.buckets || []} unit={hourly?.unit} range={range} onRange={setRange} outages={outages} flow={flow} className="lg:col-span-3" />
                {(() => {
                    const vd = devices.find((d: any) => d.id === filterDevice) || devices[0] || null;
                    if (!vd) return (
                        <div className="flex flex-col gap-3">
                            <div className="rounded-xl border border-border bg-foreground/[0.04] p-4 flex-1 flex flex-col justify-center"><div className="text-[9px] text-muted-foreground font-mono uppercase mb-1">Eventos Hoy</div><div className="text-2xl font-bold text-foreground/70 tabular-nums">{stats?.totalEvents ?? 0}</div></div>
                            <div className="rounded-xl border border-amber-500/10 bg-amber-500/[0.03] p-4 flex-1 flex flex-col justify-center"><div className="text-[9px] text-amber-400/50 font-mono uppercase mb-1">Pico Máximo</div><div className="text-2xl font-bold text-amber-400 tabular-nums">{stats?.maxCount ?? 0}</div></div>
                            <div className="rounded-xl border border-blue-500/10 bg-blue-500/[0.03] p-4 flex-1 flex flex-col justify-center"><div className="text-[9px] text-blue-400/50 font-mono uppercase mb-1">Promedio</div><div className="text-2xl font-bold text-blue-400 tabular-nums">{stats?.avgCount ?? 0}</div></div>
                        </div>
                    );
                    return (
                        <div className="relative rounded-xl border border-border bg-black overflow-hidden min-h-[200px]">
                            <LiveVideo streamName={getStreamName(vd.ip)} fallbackDeviceId={vd.id} className="absolute inset-0 w-full h-full" />
                            {/* Top: EN VIVO + device */}
                            <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-3 py-2 bg-gradient-to-b from-black/70 to-transparent pointer-events-none z-10">
                                <span className="flex items-center gap-1.5 text-[10px] font-bold text-white/90" style={{ textShadow: "0 1px 3px rgba(0,0,0,0.9)" }}><span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" /> EN VIVO</span>
                                <span className="text-[9px] text-foreground/70 truncate max-w-[120px]">{vd.name}</span>
                            </div>
                            {/* Bottom: stats overlay */}
                            <div className="absolute bottom-0 left-0 right-0 px-3 py-2.5 bg-gradient-to-t from-black/90 via-black/55 to-transparent pointer-events-none z-10 flex items-end justify-between gap-2">
                                <div><div className="text-[8px] text-white/45 font-mono uppercase tracking-wider">Eventos hoy</div><div className="text-lg font-bold text-white tabular-nums leading-none" style={{ textShadow: "0 1px 4px rgba(0,0,0,0.9)" }}>{stats?.totalEvents ?? 0}</div></div>
                                <div className="text-center"><div className="text-[8px] text-amber-300/70 font-mono uppercase tracking-wider">Pico</div><div className="text-lg font-bold text-amber-400 tabular-nums leading-none" style={{ textShadow: "0 1px 4px rgba(0,0,0,0.9)" }}>{stats?.maxCount ?? 0}</div></div>
                                <div className="text-right"><div className="text-[8px] text-blue-300/70 font-mono uppercase tracking-wider">Prom.</div><div className="text-lg font-bold text-blue-400 tabular-nums leading-none" style={{ textShadow: "0 1px 4px rgba(0,0,0,0.9)" }}>{stats?.avgCount ?? 0}</div></div>
                            </div>
                        </div>
                    );
                })()}
            </div>

            {/* ═══ FLOW ═══ */}

            {/* ═══ FILTERS ═══ */}
            {showFilters && (
                <div className="rounded-xl border border-violet-500/10 bg-violet-500/[0.02] p-4 space-y-3">
                    <div className="flex items-center gap-2 mb-2">
                        <Filter size={12} className="text-violet-400" />
                        <span className="text-[10px] text-violet-400/70 font-mono uppercase tracking-wider">Filtros Activos</span>
                    </div>
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                        <div>
                            <label className="text-[9px] text-muted-foreground font-mono uppercase block mb-1">Dispositivo</label>
                            <select
                                value={filterDevice}
                                onChange={e => { setFilterDevice(e.target.value); setPage(0); }}
                                className="w-full h-8 text-xs bg-foreground/10 border border-border rounded-md px-2 text-foreground"
                            >
                                <option value="">Todos</option>
                                {devices.map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="text-[9px] text-muted-foreground font-mono uppercase block mb-1">Mín. Personas</label>
                            <Input
                                type="number"
                                value={filterMinCount}
                                onChange={e => { setFilterMinCount(e.target.value); setPage(0); }}
                                placeholder="0"
                                className="h-8 text-xs bg-foreground/10 border-border"
                            />
                        </div>
                        <div>
                            <label className="text-[9px] text-muted-foreground font-mono uppercase block mb-1">Desde</label>
                            <Input
                                type="datetime-local"
                                value={filterFrom}
                                onChange={e => { setFilterFrom(e.target.value); setPage(0); }}
                                className="h-8 text-xs bg-foreground/10 border-border"
                            />
                        </div>
                        <div>
                            <label className="text-[9px] text-muted-foreground font-mono uppercase block mb-1">Hasta</label>
                            <Input
                                type="datetime-local"
                                value={filterTo}
                                onChange={e => { setFilterTo(e.target.value); setPage(0); }}
                                className="h-8 text-xs bg-foreground/10 border-border"
                            />
                        </div>
                    </div>
                    {(filterDevice || filterMinCount || filterFrom || filterTo) && (
                        <Button
                            variant="ghost" size="sm"
                            onClick={() => { setFilterDevice(""); setFilterMinCount(""); setFilterFrom(""); setFilterTo(""); setPage(0); }}
                            className="text-[10px] text-muted-foreground hover:text-foreground h-6"
                        >
                            <X size={10} className="mr-1" /> Limpiar filtros
                        </Button>
                    )}
                </div>
            )}

            {/* ═══ EVENT TABLE ═══ */}
            <div className="rounded-xl border border-border bg-foreground/[0.04] overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full">
                        <thead>
                            <tr className="border-b border-border bg-foreground/[0.04]">
                                <th className="text-left text-[9px] text-muted-foreground font-mono uppercase tracking-wider px-3 py-2.5 w-[70px]">Foto</th>
                                <th className="text-left text-[9px] text-muted-foreground font-mono uppercase tracking-wider px-3 py-2.5">Hora</th>
                                <th className="text-left text-[9px] text-muted-foreground font-mono uppercase tracking-wider px-3 py-2.5">Regla VCA</th>
                                <th className="text-left text-[9px] text-muted-foreground font-mono uppercase tracking-wider px-3 py-2.5">Dispositivo</th>
                                <th className="text-left text-[9px] text-muted-foreground font-mono uppercase tracking-wider px-3 py-2.5">IP</th>
                                <th className="text-left text-[9px] text-muted-foreground font-mono uppercase tracking-wider px-3 py-2.5">Driver</th>
                                <th className="text-center text-[9px] text-muted-foreground font-mono uppercase tracking-wider px-3 py-2.5">Personas</th>
                                <th className="text-left text-[9px] text-muted-foreground font-mono uppercase tracking-wider px-3 py-2.5">Nivel</th>
                                <th className="w-8"></th>
                            </tr>
                        </thead>
                        <tbody>
                            {events.length === 0 ? (
                                <tr>
                                    <td colSpan={9} className="px-4 py-12 text-center">
                                        <div className="flex flex-col items-center gap-2">
                                            <Activity className="w-8 h-8 text-muted-foreground" />
                                            <span className="text-sm text-muted-foreground">No hay eventos{filterDevice || filterMinCount ? " con esos filtros" : ""}</span>
                                        </div>
                                    </td>
                                </tr>
                            ) : (
                                events.map((event) => (
                                    <EventRow
                                        key={event.id}
                                        event={event}
                                        onExpand={() => setSelectedEvent(event)}
                                    />
                                ))
                            )}
                        </tbody>
                    </table>
                </div>

                {/* Pagination */}
                {totalPages > 1 && (
                    <div className="flex items-center justify-between px-4 py-3 border-t border-border">
                        <span className="text-[10px] text-muted-foreground font-mono">
                            {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} de {total}
                        </span>
                        <div className="flex items-center gap-1">
                            <Button
                                variant="ghost" size="sm"
                                disabled={page === 0}
                                onClick={() => setPage(p => p - 1)}
                                className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground disabled:opacity-20"
                            >
                                <ChevronLeft size={14} />
                            </Button>
                            <span className="text-[10px] text-muted-foreground font-mono px-2">
                                {page + 1}/{totalPages}
                            </span>
                            <Button
                                variant="ghost" size="sm"
                                disabled={page >= totalPages - 1}
                                onClick={() => setPage(p => p + 1)}
                                className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground disabled:opacity-20"
                            >
                                <ChevronRight size={14} />
                            </Button>
                        </div>
                    </div>
                )}
            </div>

            {/* Event Detail Modal */}
            {selectedEvent && (
                <EventDetail event={selectedEvent} onClose={() => setSelectedEvent(null)} />
            )}
        </div>
    );
}
