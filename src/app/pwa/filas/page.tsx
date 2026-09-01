"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import LiveEdgeKeeper from "@/components/LiveEdgeKeeper";
import PwaSplash from "@/components/PwaSplash";
import {
    Zap, ChevronDown, Bell, BellOff, User, LayoutGrid, Settings, Sparkles,
    Camera, Video, Users, RefreshCw, Maximize2, X, Check, Rows3, Grid2x2, Download, WifiOff, Sun, Activity, MessageCircle, Send,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { getQueueDevices, getLatestQueueCounts, getQueueAlerts } from "@/app/actions/queue";
import io from "socket.io-client";

const OCC = ["Aforo", "Occupancy", "Ocupación", "Ocupacion"];
type Dev = { id: string; name: string; ip: string };

function getStreamName(ip: string) { return `bosch_${ip.replace(/\./g, "_")}`; }

// ─── VCA analytics overlay (zonas/líneas sobre el video) ───
const VCA_COLORS: Record<string, { stroke: string; fill: string }> = {
    EnteringField: { stroke: "#10b981", fill: "rgba(16,185,129,0.08)" },
    LeavingField: { stroke: "#3b82f6", fill: "rgba(59,130,246,0.08)" },
    OccupancyCounting: { stroke: "#a855f7", fill: "rgba(168,85,247,0.10)" },
    LineCounting: { stroke: "#f59e0b", fill: "none" },
    Unknown: { stroke: "#6b7280", fill: "rgba(107,114,128,0.06)" },
};
const VCA_ICONS: Record<string, string> = { EnteringField: "\u2192", LeavingField: "\u2190", OccupancyCounting: "\u2302", LineCounting: "\u2502", Unknown: "\u2022" };

function VCAOverlay({ rules }: { rules: any[] }) {
    if (!rules || rules.length === 0) return null;
    return (
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 w-full h-full z-[8] pointer-events-none">
            {rules.map((rule, idx) => {
                const c = VCA_COLORS[rule.type] || VCA_COLORS.Unknown;
                const pts = rule.points || [];
                if (rule.type === "LineCounting" && pts.length >= 2) {
                    const p1 = pts[0], p2 = pts[pts.length - 1];
                    return (
                        <g key={idx}>
                            <line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke={c.stroke} strokeWidth="0.6" strokeLinecap="round" opacity={0.9} />
                            <circle cx={p1.x} cy={p1.y} r="0.7" fill={c.stroke} /><circle cx={p2.x} cy={p2.y} r="0.7" fill={c.stroke} />
                        </g>
                    );
                }
                if (pts.length < 2) return null;
                const d = pts.map((p: any, i: number) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ") + " Z";
                return <path key={idx} d={d} fill={c.fill} stroke={c.stroke} strokeWidth="0.4" strokeLinejoin="round" opacity={0.85} />;
            })}
        </svg>
    );
}

function AforoOverZone({ rules, occ, color }: { rules: any[]; occ: number; color: string }) {
    const occRule = (rules || []).find((r: any) => r.type === "OccupancyCounting") || (rules || [])[0];
    const pts = occRule?.points || [];
    if (pts.length === 0) return null;
    const cx = pts.reduce((s: number, p: any) => s + p.x, 0) / pts.length;
    const cy = pts.reduce((s: number, p: any) => s + p.y, 0) / pts.length;
    return (
        <div className="absolute z-[9] pointer-events-none select-none" style={{ left: `${cx}%`, top: `${cy}%`, transform: "translate(-50%, -50%)", animation: "aforoBeat 1.6s ease-in-out infinite" }}>
            <span className="font-bold tabular-nums leading-none" style={{ fontSize: "clamp(34px, 12vw, 96px)", color, opacity: 0.6, textShadow: "0 2px 16px rgba(0,0,0,0.6)" }}>{occ}</span>
        </div>
    );
}

function statusColor(aforo: number, limit: number) { const r = limit > 0 ? aforo / limit : 0; return r >= 1 ? "#ef4444" : r >= 0.7 ? "#f59e0b" : "#10b981"; }

function LiveVideo({ streamName, deviceId, className }: { streamName: string; deviceId: string; className?: string }) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const [failed, setFailed] = useState(false);
    const [ready, setReady] = useState(false);
    const retry = useRef(0);
    useEffect(() => {
        if (!streamName) { setFailed(true); return; }
        setFailed(false); setReady(false); retry.current = 0;
        const video = videoRef.current; if (!video) return;
        let destroyed = false; let timer: any = null;
        const src = `/go2rtc/api/stream.mp4?src=${encodeURIComponent(streamName)}`;
        const load = () => { if (destroyed || !video) return; video.src = src; video.play().catch(() => {}); };
        const onPlaying = () => { if (!destroyed) setReady(true); };
        const onError = () => { if (destroyed) return; setReady(false); retry.current++; if (retry.current > 8) { setFailed(true); return; } timer = setTimeout(load, Math.min(800 * retry.current, 4000)); };
        const onProgress = () => { if (!video || video.buffered.length === 0) return; const end = video.buffered.end(video.buffered.length - 1); if (end - video.currentTime > 3) video.currentTime = end - 0.4; };
        video.addEventListener("playing", onPlaying);
        video.addEventListener("error", onError); video.addEventListener("progress", onProgress); load();
        return () => { destroyed = true; if (timer) clearTimeout(timer); video.removeEventListener("playing", onPlaying); video.removeEventListener("error", onError); video.removeEventListener("progress", onProgress); video.pause(); video.removeAttribute("src"); video.load(); };
    }, [streamName]);
    if (failed) return <SnapshotImg deviceId={deviceId} className={className} />;
    return (
        <div className={cn("relative bg-black overflow-hidden", className)}>
            {!ready && <SnapshotImg deviceId={deviceId} className="absolute inset-0 w-full h-full" />}
            <video ref={videoRef} className={cn("absolute inset-0 w-full h-full object-cover transition-opacity duration-300", ready ? "opacity-100" : "opacity-0")} autoPlay muted playsInline />
            {!ready && <div className="absolute bottom-2 left-2 flex items-center gap-1.5 px-2 py-0.5 rounded bg-black/55 text-[9px] text-white/80 pointer-events-none"><span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" /> Conectando…</div>}
        </div>
    );
}
function SnapshotImg({ deviceId, className }: { deviceId: string; className?: string }) {
    const [src, setSrc] = useState(`/api/snapshot/${deviceId}?t=${Date.now()}`);
    const [err, setErr] = useState(false);
    useEffect(() => { const iv = setInterval(() => { setSrc(`/api/snapshot/${deviceId}?t=${Date.now()}`); setErr(false); }, 5000); return () => clearInterval(iv); }, [deviceId]);
    if (err) return <div className={cn("flex flex-col items-center justify-center gap-1.5 bg-zinc-950", className)}><Camera className="w-8 h-8 text-white/30" /><span className="text-[10px] text-white/40">Sin señal · reintentando…</span></div>;
    return <img src={src} alt="" className={cn("object-cover", className)} onError={() => setErr(true)} draggable={false} />;
}

function EventsFeed({ events, onlyAlerts }: { events: any[]; onlyAlerts: boolean }) {
    const list = onlyAlerts ? events.filter((e) => e.type === "alert") : events;
    if (list.length === 0) return (
        <div className="flex-1 flex flex-col items-center justify-center text-white/40 gap-2 pb-24">
            <Bell size={28} /><span className="text-sm">{onlyAlerts ? "Sin alertas" : "Sin eventos"} todavía</span>
            <span className="text-[11px] text-white/30">Aparecen en vivo cuando ocurren</span>
        </div>
    );
    return (
        <div className="flex-1 overflow-y-auto [&::-webkit-scrollbar]:hidden pb-24 px-3 pt-2 space-y-1.5">
            {list.map((e) => {
                const t = new Date(e.time);
                const isAlert = e.type === "alert";
                const isIn = e.flow === "in";
                const col = isAlert ? "#ef4444" : isIn ? "#10b981" : "#f59e0b";
                const img = e.snapshotPath ? (String(e.snapshotPath).startsWith("/") ? e.snapshotPath : `/api/files/lpr-prod/${e.snapshotPath}`) : null;
                return (
                    <div key={e.id} className="flex items-center gap-3 rounded-2xl bg-white/[0.05] border border-border p-2.5">
                        <div className="w-12 h-12 rounded-xl overflow-hidden bg-black shrink-0 flex items-center justify-center" style={{ border: `1px solid ${col}55` }}>
                            {img ? <img src={img} alt="" className="w-full h-full object-cover" /> : (isAlert ? <Bell size={18} style={{ color: col }} /> : isIn ? <Check size={18} style={{ color: col }} /> : <X size={18} style={{ color: col }} />)}
                        </div>
                        <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                                <span className="text-sm font-bold text-white truncate">{isAlert ? (e.alertName || "Alerta de aforo") : isIn ? "Entrada" : "Salida"}</span>
                                {isAlert && e.health && <span className="text-[9px] px-1.5 py-0.5 rounded bg-red-500/20 text-red-300 font-bold uppercase">salud</span>}
                            </div>
                            <div className="text-[11px] text-white/50 flex items-center gap-2 mt-0.5">
                                <span className="font-mono">{t.toLocaleTimeString("es-UY", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
                                {e.deviceName && <span className="truncate">· {e.deviceName}</span>}
                            </div>
                        </div>
                        {!isAlert ? (
                            <span className="text-xl font-bold tabular-nums" style={{ color: col }}>{isIn ? "+1" : "−1"}</span>
                        ) : (
                            <div className="text-right shrink-0">
                                <div className="text-2xl font-bold tabular-nums leading-none" style={{ color: col }}>{e.count ?? "—"}</div>
                                {e.threshold != null && <div className="text-[9px] text-white/40">umbral {e.threshold}</div>}
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
}

export default function FilasPWA() {
    const [devices, setDevices] = useState<Dev[]>([]);
    const [aforo, setAforo] = useState<Record<string, number>>({});
    const [vcaRules, setVcaRules] = useState<Record<string, any[]>>({});
    const [showVca, setShowVca] = useState(true);
    const [chatOpen, setChatOpen] = useState(false);
    const [chatMsgs, setChatMsgs] = useState<{ role: "user" | "bot"; text: string }[]>([{ role: "bot", text: "Hola 👋 Consultá el estado de las filas. Escribí *aforo* o *ayuda*." }]);
    const [chatInput, setChatInput] = useState("");
    const [chatBusy, setChatBusy] = useState(false);
    const [iconUpdate, setIconUpdate] = useState(false);
    useEffect(() => {
        (async () => {
            try {
                const r = await fetch("/manifest-filas.json", { cache: "no-store" });
                const j = await r.json();
                const src = (j?.icons?.[0]?.src || "");
                const v = (src.split("?v=")[1] || "").trim();
                if (!v) return;
                const prev = localStorage.getItem("omni_pwa_iconv");
                if (prev && prev !== v) setIconUpdate(true);
                localStorage.setItem("omni_pwa_iconv", v);
            } catch {}
        })();
    }, []);
    const sendChat = async (preset?: string) => {
        const t = (preset ?? chatInput).trim(); if (!t || chatBusy) return;
        setChatMsgs(m => [...m, { role: "user", text: t }]); setChatInput(""); setChatBusy(true);
        try { const r = await fetch("/api/chatbot/query", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: t }) }); const j = await r.json(); setChatMsgs(m => [...m, { role: "bot", text: j.reply || "…" }]); }
        catch { setChatMsgs(m => [...m, { role: "bot", text: "Error de conexión." }]); }
        finally { setChatBusy(false); }
    };
    const [limit, setLimit] = useState(8);
    const [connected, setConnected] = useState(false);
    const [now, setNow] = useState(new Date());
    const [pushState, setPushState] = useState<"idle" | "on" | "denied" | "loading">("idle");
    const [flashId, setFlashId] = useState<string | null>(null);
    const [view, setView] = useState<"list" | "grid">("list");
    const [focusId, setFocusId] = useState<string | null>(null); // null = todas
    const [menu, setMenu] = useState<null | "device" | "profile">(null);
    const [refreshing, setRefreshing] = useState(false);
    const [tab, setTab] = useState<"vivo" | "eventos" | "alertas">("vivo");
    const pullStart = useRef<number | null>(null);
    const [pullY, setPullY] = useState(0);
    useEffect(() => {
        if ("serviceWorker" in navigator) navigator.serviceWorker.getRegistration().then((r) => r && r.update()).catch(() => {});
        let hiddenAt = 0;
        const onVis = () => {
            if (document.visibilityState === "hidden") hiddenAt = Date.now();
            else if (hiddenAt && Date.now() - hiddenAt > 20000) location.reload();
        };
        document.addEventListener("visibilitychange", onVis);
        return () => document.removeEventListener("visibilitychange", onVis);
    }, []);
    const onPullStart = (e: any) => { const el = e.currentTarget; pullStart.current = el.scrollTop <= 0 ? e.touches[0].clientY : null; };
    const onPullMove = (e: any) => { if (pullStart.current == null) return; const dy = e.touches[0].clientY - pullStart.current; if (dy > 0) setPullY(Math.min(dy * 0.5, 90)); };
    const onPullEnd = async () => { if (pullStart.current == null) return; const should = pullY > 60; pullStart.current = null; setPullY(0); if (should) { setRefreshing(true); await load(); setTimeout(() => setRefreshing(false), 500); } };
    const [events, setEvents] = useState<any[]>([]);
    const [splash, setSplash] = useState(true);
    const [online, setOnline] = useState(true);
    const [awake, setAwake] = useState(false);
    const wakeRef = useRef<any>(null);
    const feedRefs = useRef<Record<string, HTMLDivElement | null>>({});

    const load = useCallback(async () => {
        try {
            const [devs, counts, alerts] = await Promise.all([getQueueDevices(), getLatestQueueCounts(), getQueueAlerts()]);
            setDevices((devs as any[]).map((d) => ({ id: d.id, name: d.name, ip: d.ip })));
            const map: Record<string, number> = {};
            for (const c of counts as any[]) { const ch = (c.channels || []).find((x: any) => OCC.includes(x.channelName)); map[c.device.id] = ch ? ch.peopleCount : 0; }
            setAforo(map);
            const ths = (alerts as any[]).map((a) => a.threshold).filter((n: number) => n > 0);
            if (ths.length) setLimit(Math.max(...ths));
        } catch (e) { console.error(e); }
    }, []);
    useEffect(() => { load(); const t = setInterval(() => setNow(new Date()), 1000); const r = setInterval(load, 15000); return () => { clearInterval(t); clearInterval(r); }; }, [load]);
    const devKey = devices.map((d) => d.id).join(",");
    useEffect(() => {
        let cancel = false;
        (async () => {
            const out: Record<string, any[]> = {};
            await Promise.all(devices.map(async (d) => {
                try { const res = await fetch(`/api/queue/vca-config?deviceId=${d.id}`); if (res.ok) { const j = await res.json(); out[d.id] = j.rules || []; } } catch {}
            }));
            if (!cancel) setVcaRules(out);
        })();
        return () => { cancel = true; };
    }, [devKey]);

    useEffect(() => {
        const socket = io(window.location.origin, { path: "/io/socket.io", transports: ["polling"] });
        socket.on("connect", () => setConnected(true));
        socket.on("disconnect", () => setConnected(false));
        socket.on("queue_update", (data: any) => {
            if (OCC.includes(data.channelName) && data.deviceId) setAforo((p) => ({ ...p, [data.deviceId]: data.peopleCount }));
            const ch = String(data.channelName || "");
            if (/entrad|entering|salid|leaving/i.test(ch)) {
                const flow = /entrad|entering/i.test(ch) ? "in" : "out";
                setEvents((ev) => [{ id: Math.random().toString(36).slice(2), type: "flow", flow, deviceName: data.deviceName, channelName: ch, count: data.peopleCount, time: Date.now(), snapshotPath: data.snapshotPath || null }, ...ev].slice(0, 150));
            }
        });
        socket.on("queue_alert", (data: any) => {
            const id = devices.find((d) => d.name === data.deviceName)?.id || devices[0]?.id || null; setFlashId(id); setTimeout(() => setFlashId(null), 1800); if ("vibrate" in navigator) navigator.vibrate?.([120, 60, 120]);
            setEvents((ev) => [{ id: Math.random().toString(36).slice(2), type: "alert", health: data.health || null, deviceName: data.deviceName, channelName: data.channelName, count: data.peopleCount, threshold: data.threshold, time: Date.now(), snapshotPath: data.snapshotPath || null, alertName: data.alertName }, ...ev].slice(0, 150));
        });
        return () => { socket.disconnect(); };
    }, [devices]);

    useEffect(() => {
        if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
        if ("Notification" in window) { if (Notification.permission === "granted") setPushState("on"); else if (Notification.permission === "denied") setPushState("denied"); }
    }, []);

    useEffect(() => { const t = setTimeout(() => setSplash(false), 1700); return () => clearTimeout(t); }, []);
    useEffect(() => {
        setOnline(typeof navigator !== "undefined" ? navigator.onLine : true);
        const on = () => setOnline(true); const off = () => setOnline(false);
        window.addEventListener("online", on); window.addEventListener("offline", off);
        return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
    }, []);
    useEffect(() => {
        const onVis = async () => { if (awake && document.visibilityState === "visible" && "wakeLock" in navigator) { try { wakeRef.current = await (navigator as any).wakeLock.request("screen"); } catch {} } };
        document.addEventListener("visibilitychange", onVis);
        return () => document.removeEventListener("visibilitychange", onVis);
    }, [awake]);

    const toggleWake = async () => {
        setMenu(null);
        try {
            if (awake) { await wakeRef.current?.release?.(); wakeRef.current = null; setAwake(false); }
            else if ("wakeLock" in navigator) { wakeRef.current = await (navigator as any).wakeLock.request("screen"); setAwake(true); wakeRef.current?.addEventListener?.("release", () => setAwake(false)); }
            else { alert("Tu dispositivo no soporta mantener la pantalla encendida."); }
        } catch { setAwake(false); }
    };

    const enablePush = async () => {
        setMenu(null);
        if (pushState === "on") { return; }
        if (!("serviceWorker" in navigator) || !("PushManager" in window)) { alert("Tu navegador no soporta push."); return; }
        setPushState("loading");
        try {
            const perm = await Notification.requestPermission();
            if (perm !== "granted") { setPushState("denied"); return; }
            const reg = await navigator.serviceWorker.ready;
            const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || "") });
            await fetch("/api/subscribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(sub) });
            setPushState("on");
        } catch (e) { console.error(e); setPushState("idle"); }
    };
    const goFs = () => { setMenu(null); const el: any = document.documentElement; if (document.fullscreenElement) document.exitFullscreen?.(); else el.requestFullscreen?.().catch(() => {}); };
    const doRefresh = async () => { setMenu(null); setRefreshing(true); await load(); setTimeout(() => setRefreshing(false), 600); };
    const focusDevice = (id: string | null) => { setFocusId(id); setMenu(null); if (id && feedRefs.current[id]) feedRefs.current[id]!.scrollIntoView({ behavior: "smooth", block: "start" }); };

    const totalAforo = Object.values(aforo).reduce((a, b) => a + b, 0);
    const tStr = now.toLocaleString("es-UY", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" }).replace(",", "");
    const shown = focusId ? devices.filter((d) => d.id === focusId) : devices;
    const siteName = (focusId ? devices.find((d) => d.id === focusId)?.name : null) || devices[0]?.name || "Control de Filas";

    return (
        <div className="fixed inset-0 flex flex-col bg-card overflow-hidden">
            <style>{`@keyframes aforoBeat{0%,100%{transform:translate(-50%,-50%) scale(1)}50%{transform:translate(-50%,-50%) scale(1.08)}}`}</style>
            {/* Splash animada de apertura */}
            <PwaSplash target="filas" />
            <LiveEdgeKeeper />
            {!online && <div className="absolute top-0 inset-x-0 z-[90] bg-red-600 text-white text-[11px] font-bold text-center py-1 animate-in slide-in-from-top pointer-events-none flex items-center justify-center gap-1.5"><WifiOff size={12} /> Sin conexión · reintentando…</div>}
            {iconUpdate && <div className="absolute top-0 inset-x-0 z-[95] bg-violet-600 text-white text-[11px] font-semibold py-1.5 px-3 animate-in slide-in-from-top flex items-center justify-center gap-2"><Sparkles size={13} /> Icono nuevo disponible · quita y vuelve a agregar la PWA al inicio <button onClick={() => setIconUpdate(false)} className="ml-1 opacity-80 active:scale-95"><X size={14} /></button></div>}
            {(pullY > 0 || refreshing) && (
                <div className="absolute left-0 right-0 z-40 flex justify-center pointer-events-none" style={{ top: "calc(env(safe-area-inset-top) + 8px)", transform: `translateY(${refreshing ? 8 : pullY * 0.4}px)`, opacity: refreshing ? 1 : Math.min(pullY / 60, 1) }}>
                    <div className="w-9 h-9 rounded-full bg-zinc-800/90 border border-border flex items-center justify-center shadow-lg">
                        <RefreshCw size={16} className={cn("text-blue-400", refreshing && "animate-spin")} style={refreshing ? undefined : { transform: `rotate(${pullY * 4}deg)` }} />
                    </div>
                </div>
            )}
            {/* Top bar */}
            <header className="px-4 pt-[max(0.9rem,env(safe-area-inset-top))] pb-2 shrink-0 relative z-30">
                <div className="flex items-center justify-between">
                    <button onClick={() => setMenu(menu === "device" ? null : "device")} className="flex items-center gap-2 pl-1 pr-3 py-1.5 rounded-full bg-white/[0.06] border border-border active:bg-white/10">
                        <span className="w-7 h-7 rounded-full bg-emerald-500/20 flex items-center justify-center"><Zap size={14} className="text-emerald-400 fill-emerald-400" /></span>
                        <span className="text-[15px] font-bold tracking-tight max-w-[40vw] truncate">{siteName}</span>
                        <ChevronDown size={16} className={cn("text-white/50 transition", menu === "device" && "rotate-180")} />
                    </button>
                    <div className="flex items-center gap-2">
                        {pushState === "on" && <span className="flex items-center gap-1 text-[10px] text-blue-300/80"><span className="w-2 h-2 rounded-full bg-blue-400 shadow-[0_0_8px_rgba(96,165,250,0.8)]" /> push</span>}
                    </div>
                </div>

                {/* Device dropdown */}
                {menu === "device" && (
                    <div className="absolute left-4 top-[calc(100%-0.25rem)] w-64 rounded-2xl bg-zinc-900 border border-border shadow-lg overflow-hidden animate-in fade-in slide-in-from-top-2 zoom-in-95 duration-200">
                        <div className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-white/40">Cámaras</div>
                        <button onClick={() => focusDevice(null)} className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-white/5 text-sm">
                            <span className="flex items-center gap-2"><Grid2x2 size={15} className="text-blue-400" /> Todas</span>
                            {!focusId && <Check size={15} className="text-blue-400" />}
                        </button>
                        {devices.map((d) => (
                            <button key={d.id} onClick={() => focusDevice(d.id)} className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-white/5 text-sm">
                                <span className="flex items-center gap-2 min-w-0"><Camera size={15} className="text-white/60 shrink-0" /><span className="truncate">{d.name}</span></span>
                                <span className="flex items-center gap-1.5 shrink-0">
                                    <span className="text-xs font-bold tabular-nums" style={{ color: statusColor(aforo[d.id] ?? 0, limit) }}>{aforo[d.id] ?? 0}</span>
                                    {focusId === d.id && <Check size={15} className="text-blue-400" />}
                                </span>
                            </button>
                        ))}
                    </div>
                )}
                {/* Profile dropdown */}
                {menu === "profile" && (
                    <div className="absolute right-4 top-[calc(100%-0.25rem)] w-60 rounded-2xl bg-zinc-900 border border-border shadow-lg overflow-hidden py-1 animate-in fade-in slide-in-from-top-2 zoom-in-95 duration-200">
                        <button onClick={doRefresh} className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/5 text-sm"><RefreshCw size={16} className="text-white/60" /> Actualizar</button>
                        <button onClick={goFs} className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/5 text-sm"><Maximize2 size={16} className="text-white/60" /> Pantalla completa</button>
                        <button onClick={enablePush} disabled={pushState === "loading"} className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/5 text-sm transition-colors">
                            {pushState === "loading" ? <RefreshCw size={16} className="text-white/60 animate-spin" /> : pushState === "on" ? <Bell size={16} className="text-blue-400" /> : <BellOff size={16} className="text-white/60" />}
                            <span className="flex-1 text-left">Notificaciones push{pushState === "denied" && <span className="block text-[10px] text-red-400/80">Bloqueadas en el navegador</span>}</span>
                            <span className={cn("relative w-9 h-5 rounded-full transition-colors shrink-0", pushState === "on" ? "bg-blue-500" : "bg-white/15")}><span className={cn("absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform", pushState === "on" && "translate-x-4")} /></span>
                        </button>
                        <button onClick={toggleWake} className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/5 text-sm"><Sun size={16} className={awake ? "text-amber-400" : "text-white/60"} /> Pantalla siempre encendida {awake ? "· ON" : ""}</button>
                        <div className="h-px bg-white/10 my-1" />
                        <div className="px-4 py-2 text-[11px] text-white/40">Aforo total: <b className="text-white/70">{totalAforo}</b> · {connected ? "en vivo" : "sin conexión"}</div>
                    </div>
                )}
            </header>

            {/* click-away */}
            {menu && <div className="absolute inset-0 z-20" onClick={() => setMenu(null)} />}

            {tab === "vivo" && (<>
            {/* Thumbnail strip */}
            <div className="shrink-0 px-4 pb-1">
                <div className="flex gap-2 overflow-x-auto [&::-webkit-scrollbar]:hidden pb-1">
                    {devices.map((d) => (
                        <button key={d.id} onClick={() => focusDevice(focusId === d.id ? null : d.id)} className="shrink-0 w-[88px]">
                            <div className={cn("relative w-[88px] h-[60px] rounded-xl overflow-hidden border bg-black transition", focusId === d.id ? "border-blue-500 ring-2 ring-blue-500/40" : "border-border")}>
                                <SnapshotImg deviceId={d.id} className="absolute inset-0 w-full h-full" />
                                <span className="absolute bottom-1 right-1 px-1.5 py-0.5 rounded bg-black/70 text-[10px] font-bold tabular-nums" style={{ color: statusColor(aforo[d.id] ?? 0, limit) }}>{aforo[d.id] ?? 0}</span>
                            </div>
                            <div className="text-center text-[11px] text-white/45 font-mono mt-1">{now.toLocaleTimeString("es-UY", { hour: "2-digit", minute: "2-digit" })}</div>
                        </button>
                    ))}
                </div>
            </div>

            {/* Quick actions */}
            <div className="shrink-0 flex items-center gap-2 px-4 pb-2">
                <button onClick={() => setView("list")} className={cn("w-12 h-11 rounded-2xl border flex items-center justify-center transition", view === "list" ? "bg-blue-500/90 text-white border-blue-500" : "bg-white/[0.06] text-blue-400 border-border")}><Rows3 size={18} /></button>
                <button onClick={() => setView("grid")} className={cn("w-12 h-11 rounded-2xl border flex items-center justify-center transition", view === "grid" ? "bg-blue-500/90 text-white border-blue-500" : "bg-white/[0.06] text-blue-400 border-border")}><LayoutGrid size={18} /></button>
                <button onClick={() => setShowVca(v => !v)} title="Analítica VCA" className={cn("w-12 h-11 rounded-2xl border flex items-center justify-center transition", showVca ? "bg-violet-500/90 text-white border-violet-500" : "bg-white/[0.06] text-violet-400 border-border")}><Activity size={18} /></button>
                <div className="flex-1 h-11 rounded-2xl border flex items-center justify-center gap-2 font-bold text-[15px]" style={{ borderColor: statusColor(totalAforo, limit) + "55", background: statusColor(totalAforo, limit) + "14", color: statusColor(totalAforo, limit) }}>
                    <Users size={17} /> Aforo {totalAforo}{limit > 0 ? ` / ${limit}` : ""}
                </div>
            </div>

            </>)}
            {/* Feeds (vivo) */}
            {tab === "vivo" && (
            <div key="vivo-feed" onTouchStart={onPullStart} onTouchMove={onPullMove} onTouchEnd={onPullEnd} className="flex-1 overflow-y-auto [&::-webkit-scrollbar]:hidden pb-24 animate-in fade-in slide-in-from-bottom-3 duration-300">
                {devices.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-white/40 gap-2"><Camera size={28} /><span className="text-sm">Sin cámaras de fila</span></div>
                ) : (
                    <div className={cn(view === "grid" ? "grid grid-cols-2 gap-px bg-white/10" : "")}>
                        {shown.map((d) => {
                            const a = aforo[d.id] ?? 0; const col = statusColor(a, limit);
                            return (
                                <div key={d.id} ref={(el) => { feedRefs.current[d.id] = el; }} className="relative w-full aspect-video border-b border-border bg-black">
                                    <LiveVideo streamName={getStreamName(d.ip)} deviceId={d.id} className="absolute inset-0 w-full h-full" />
                                    {showVca && (<><VCAOverlay rules={vcaRules[d.id] || []} /><AforoOverZone rules={vcaRules[d.id] || []} occ={a} color={col} /></>)}
                                    <div className="absolute top-2 left-3 text-[11px] font-mono text-white/90" style={{ textShadow: "0 1px 3px rgba(0,0,0,0.9)" }}>{tStr}</div>
                                    <div className="absolute top-2 right-3 flex items-center gap-1 px-1.5 py-0.5 rounded bg-black/55 text-[9px] font-bold uppercase tracking-wider"><span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />Live</div>
                                    <div className="absolute inset-x-0 bottom-0 px-3 pb-2.5 pt-10 bg-gradient-to-t from-black/85 via-black/20 to-transparent flex items-end justify-between">
                                        <span className={cn("font-bold text-white truncate max-w-[55%]", view === "grid" ? "text-[12px]" : "text-[17px]")} style={{ textShadow: "0 1px 4px rgba(0,0,0,0.9)" }}>{d.name}</span>
                                        <span className="flex items-baseline gap-1.5">
                                            <span className="text-[10px] uppercase tracking-wide text-white/60 font-bold mb-0.5">Aforo</span>
                                            <span className={cn("font-bold tabular-nums leading-none", view === "grid" ? "text-xl" : "text-3xl")} style={{ color: col, textShadow: "0 1px 6px rgba(0,0,0,0.8)" }}>{a}</span>
                                        </span>
                                    </div>
                                    {flashId === d.id && <div className="absolute inset-0 bg-red-500/25 animate-pulse pointer-events-none" />}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
            )}
            {tab !== "vivo" && (
                <div key={tab} className="flex-1 min-h-0 flex flex-col animate-in fade-in slide-in-from-bottom-3 duration-300">
                    <EventsFeed events={events} onlyAlerts={tab === "alertas"} />
                </div>
            )}

            {/* Chat FAB */}
            {!chatOpen && (
                <button onClick={() => setChatOpen(true)} className="absolute right-4 z-30 w-12 h-12 rounded-full bg-violet-600 text-white flex items-center justify-center shadow-lg shadow-violet-900/40 active:scale-95 transition" style={{ bottom: "calc(env(safe-area-inset-bottom) + 78px)" }}>
                    <MessageCircle size={22} />
                </button>
            )}

            {/* Chat sheet */}
            {chatOpen && (
                <div className="absolute inset-0 z-[60] flex flex-col bg-card/95 backdrop-blur-md animate-in fade-in slide-in-from-bottom-4 duration-200">
                    <div className="flex items-center justify-between px-4 pt-[max(0.9rem,env(safe-area-inset-top))] pb-3 border-b border-border">
                        <div className="flex items-center gap-2">
                            <span className="w-8 h-8 rounded-lg bg-violet-500/20 flex items-center justify-center"><MessageCircle size={16} className="text-violet-400" /></span>
                            <div><div className="text-sm font-bold">Asistente OmniAccess</div><div className="text-[10px] text-white/40">Consultá el aforo y estado</div></div>
                        </div>
                        <button onClick={() => setChatOpen(false)} className="w-9 h-9 rounded-full bg-white/[0.06] flex items-center justify-center text-white/70 active:scale-95"><X size={18} /></button>
                    </div>
                    <div className="flex-1 overflow-y-auto p-4 space-y-2 [&::-webkit-scrollbar]:hidden">
                        {chatMsgs.map((m, i) => (
                            <div key={i} className={cn("max-w-[82%] px-3 py-2 rounded-2xl text-sm whitespace-pre-wrap break-words", m.role === "user" ? "ml-auto bg-violet-600 text-white rounded-br-sm" : "bg-white/[0.07] text-white/90 rounded-bl-sm")}>{m.text}</div>
                        ))}
                        {chatBusy && <div className="bg-white/[0.07] w-14 px-3 py-2.5 rounded-2xl rounded-bl-sm flex items-center"><RefreshCw size={14} className="animate-spin text-white/50" /></div>}
                    </div>
                    <div className="px-3 pt-2 flex gap-1.5 flex-wrap">
                        {["aforo", "espera", "ayuda"].map(q => (
                            <button key={q} onClick={() => sendChat(q)} className="px-3 py-1 rounded-full bg-white/[0.06] border border-border text-[11px] text-white/70 active:bg-white/10">{q}</button>
                        ))}
                    </div>
                    <div className="p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] flex items-center gap-2">
                        <input value={chatInput} onChange={e => setChatInput(e.target.value)} onKeyDown={e => { if (e.key === "Enter") sendChat(); }} placeholder="Escribí: aforo, ayuda…" className="flex-1 bg-white/[0.06] border border-border rounded-full px-4 py-2.5 text-sm text-white outline-none focus:border-violet-500" />
                        <button onClick={() => sendChat()} disabled={chatBusy} className="w-11 h-11 rounded-full bg-violet-600 text-white flex items-center justify-center disabled:opacity-50 active:scale-95 transition"><Send size={18} /></button>
                    </div>
                </div>
            )}

            {/* Bottom nav */}
            <nav className="absolute bottom-0 inset-x-0 pb-[max(0.6rem,env(safe-area-inset-bottom))] pt-2 px-6 flex justify-center pointer-events-none z-30">
                <div className="pointer-events-auto flex items-center gap-1 px-2 py-1.5 rounded-full bg-zinc-900/85 backdrop-blur-xl border border-border shadow-lg">
                    <button onClick={() => setTab("vivo")} className={cn("w-12 h-11 rounded-full flex items-center justify-center transition-all duration-300", tab === "vivo" ? "bg-blue-500/90 text-white scale-105" : "text-white/60 hover:text-white/80")}><Video size={19} /></button>
                    <button onClick={() => setTab("eventos")} className={cn("relative w-12 h-11 rounded-full flex items-center justify-center transition-all duration-300", tab === "eventos" ? "bg-blue-500/90 text-white scale-105" : "text-white/60 hover:text-white/80")}><Rows3 size={19} />{tab !== "eventos" && events.length > 0 && <span className="absolute top-1.5 right-2.5 w-2 h-2 rounded-full bg-blue-400" />}</button>
                    <button onClick={() => setTab("alertas")} className={cn("relative w-12 h-11 rounded-full flex items-center justify-center transition-all duration-300", tab === "alertas" ? "bg-blue-500/90 text-white scale-105" : "text-white/60 hover:text-white/80")}><Zap size={19} />{tab !== "alertas" && events.some((e) => e.type === "alert") && <span className="absolute top-1.5 right-2.5 w-2 h-2 rounded-full bg-red-500" />}</button>
                    <button onClick={() => setMenu(menu === "profile" ? null : "profile")} className="w-12 h-11 rounded-full text-white/60 flex items-center justify-center"><Settings size={19} /></button>
                </div>
            </nav>
        </div>
    );
}
