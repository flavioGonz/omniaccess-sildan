"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import LiveEdgeKeeper from "@/components/LiveEdgeKeeper";
import PwaSplash from "@/components/PwaSplash";
import { Car, RefreshCw, Bell, BellOff, Settings, X, Search, Camera, Video, Rows3, Check, ChevronDown, Zap, WifiOff, Maximize2, Sun } from "lucide-react";
import { cn } from "@/lib/utils";
import { getDevices } from "@/app/actions/devices";
import { getAccessEvents } from "@/app/actions/history";
import io from "socket.io-client";

function urlB64ToUint8(base64: string) {
    const padding = "=".repeat((4 - (base64.length % 4)) % 4);
    const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
    const raw = atob(b64);
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
}

const ANOM = ["NO_LEIDA", "UNKNOWN", "S/P", "DOOR_OPEN", "DOOR_CLOSE", ""];
const isAnom = (p?: string) => !p || ANOM.includes(String(p).toUpperCase());

function SnapImg({ deviceId, className }: { deviceId: string; className?: string }) {
    const [src, setSrc] = useState(`/api/snapshot/${deviceId}?t=${Date.now()}`);
    const [err, setErr] = useState(false);
    useEffect(() => { const iv = setInterval(() => { setSrc(`/api/snapshot/${deviceId}?t=${Date.now()}`); setErr(false); }, 4000); return () => clearInterval(iv); }, [deviceId]);
    if (err) return <div className={cn("flex flex-col items-center justify-center gap-1.5 bg-zinc-950", className)}><Camera className="w-7 h-7 text-white/30" /><span className="text-[10px] text-white/40">Sin señal</span></div>;
    return <img src={src} alt="" className={cn("object-cover", className)} onError={() => setErr(true)} draggable={false} />;
}

function LiveVideo({ deviceId, className }: { deviceId: string; className?: string }) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const [ready, setReady] = useState(false);
    const [failed, setFailed] = useState(false);
    const retry = useRef(0);
    useEffect(() => {
        const video = videoRef.current; if (!video) return;
        let destroyed = false; let timer: any;
        const src = `/go2rtc/api/stream.mp4?src=lpr_${deviceId}&video=h264`;
        const start = () => { if (destroyed || !video) return; video.src = src; video.play().catch(() => {}); };
        const onPlaying = () => { if (!destroyed) setReady(true); };
        const onError = () => { if (destroyed) return; setReady(false); retry.current++; if (retry.current > 4) { setFailed(true); return; } timer = setTimeout(start, Math.min(800 * retry.current, 4000)); };
        video.addEventListener("playing", onPlaying); video.addEventListener("error", onError); start();
        return () => { destroyed = true; if (timer) clearTimeout(timer); video.removeEventListener("playing", onPlaying); video.removeEventListener("error", onError); video.pause(); video.removeAttribute("src"); video.load(); };
    }, [deviceId]);
    if (failed) return <SnapImg deviceId={deviceId} className={className} />;
    return (
        <div className={cn("relative bg-black overflow-hidden", className)}>
            <SnapImg deviceId={deviceId} className={cn("absolute inset-0 w-full h-full transition-opacity duration-500", ready ? "opacity-0" : "opacity-100")} />
            <video ref={videoRef} className={cn("absolute inset-0 w-full h-full object-cover transition-opacity duration-500", ready ? "opacity-100" : "opacity-0")} autoPlay muted playsInline />
        </div>
    );
}

function evImg(p?: string | null) { return p ? (String(p).startsWith("/") ? p : `/api/files/lpr-prod/${p}`) : null; }
function tfmt(t: any) { return new Date(t).toLocaleTimeString("es-UY", { hour: "2-digit", minute: "2-digit", second: "2-digit" }); }

export default function LprPwa() {
    const [devices, setDevices] = useState<any[]>([]);
    const [events, setEvents] = useState<any[]>([]);
    const [lastPlate, setLastPlate] = useState<Record<string, any>>({});
    const [tab, setTab] = useState<"vivo" | "lecturas" | "buscar">("vivo");
    const [connected, setConnected] = useState(false);
    const [online, setOnline] = useState(true);
    const [menu, setMenu] = useState<null | "profile">(null);
    const [pushState, setPushState] = useState<"idle" | "on" | "denied" | "loading">("idle");
    const [refreshing, setRefreshing] = useState(false);
    const [splash, setSplash] = useState(true);
    const [now, setNow] = useState(new Date());
    const [q, setQ] = useState("");
    const [results, setResults] = useState<any[]>([]);
    const [searching, setSearching] = useState(false);
    const [awake, setAwake] = useState(false);
    const wakeRef = useRef<any>(null);

    const load = useCallback(async () => {
        try {
            const all = await getDevices();
            setDevices((all as any[]).filter(d => d.deviceType === "LPR_CAMERA"));
            const from = new Date(Date.now() - 24 * 3600 * 1000);
            const evs: any = await getAccessEvents({ take: 60, from, type: "PLATE" });
            const list = (evs?.events || []) as any[];
            setEvents(list);
            const lp: Record<string, any> = {};
            for (const e of list) { if (e.device?.id && !lp[e.device.id] && !isAnom(e.plateDetected)) lp[e.device.id] = e; }
            setLastPlate(lp);
        } catch (e) { console.error(e); }
    }, []);

    useEffect(() => { load(); const t = setInterval(() => setNow(new Date()), 1000); const r = setInterval(load, 20000); return () => { clearInterval(t); clearInterval(r); }; }, [load]);
    useEffect(() => { const x = setTimeout(() => setSplash(false), 1700); return () => clearTimeout(x); }, []);
    useEffect(() => {
        if ("Notification" in window) { if (Notification.permission === "granted") setPushState("on"); else if (Notification.permission === "denied") setPushState("denied"); }
        if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
        if ("serviceWorker" in navigator) navigator.serviceWorker.getRegistration().then(r => r && r.update()).catch(() => {});
        const onl = () => setOnline(true), off = () => setOnline(false);
        window.addEventListener("online", onl); window.addEventListener("offline", off); setOnline(navigator.onLine);
        let hiddenAt = 0;
        const onVis = () => { if (document.visibilityState === "hidden") hiddenAt = Date.now(); else if (hiddenAt && Date.now() - hiddenAt > 20000) location.reload(); };
        document.addEventListener("visibilitychange", onVis);
        return () => { window.removeEventListener("online", onl); window.removeEventListener("offline", off); document.removeEventListener("visibilitychange", onVis); };
    }, []);

    useEffect(() => {
        const socket = io(window.location.origin, { path: "/io/socket.io", transports: ["polling"] });
        socket.on("connect", () => setConnected(true));
        socket.on("disconnect", () => setConnected(false));
        socket.on("access_event", (ev: any) => {
            const plate = String(ev.plateDetected || "").toUpperCase();
            if (plate === "DOOR_OPEN" || plate === "DOOR_CLOSE") return;
            setEvents(prev => [ev, ...prev].slice(0, 150));
            if (ev.device?.id && !isAnom(ev.plateDetected)) setLastPlate(p => ({ ...p, [ev.device.id]: ev }));
        });
        return () => { socket.disconnect(); };
    }, []);

    const enablePush = async () => {
        setMenu(null);
        if (pushState === "on") return;
        if (!("serviceWorker" in navigator) || !("PushManager" in window)) { alert("Tu navegador no soporta push."); return; }
        setPushState("loading");
        try {
            const reg = await navigator.serviceWorker.ready;
            const perm = await Notification.requestPermission();
            if (perm !== "granted") { setPushState("denied"); return; }
            const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || "") });
            await fetch("/api/subscribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(sub) });
            setPushState("on");
        } catch (e) { console.error(e); setPushState("idle"); }
    };
    const doRefresh = async () => { setMenu(null); setRefreshing(true); await load(); setTimeout(() => setRefreshing(false), 500); };
    const goFs = () => { setMenu(null); const el: any = document.documentElement; if (document.fullscreenElement) document.exitFullscreen?.(); else el.requestFullscreen?.().catch(() => {}); };
    const toggleWake = async () => {
        setMenu(null);
        try { if (awake) { wakeRef.current?.release?.(); wakeRef.current = null; setAwake(false); } else { wakeRef.current = await (navigator as any).wakeLock?.request("screen"); setAwake(true); } } catch {}
    };

    const doSearch = async () => {
        const term = q.trim(); if (!term) return; setSearching(true);
        try { const r: any = await getAccessEvents({ search: term, type: "PLATE", take: 30 }); setResults((r?.events || []) as any[]); }
        catch { setResults([]); } finally { setSearching(false); }
    };

    const stats = { total: events.length, grants: events.filter(e => e.decision === "GRANT").length, denies: events.filter(e => e.decision === "DENY").length };

    return (
        <div className="fixed inset-0 flex flex-col bg-card overflow-hidden text-white">
            <PwaSplash target="lpr" />
            <LiveEdgeKeeper />
            {!online && <div className="absolute top-0 inset-x-0 z-[90] bg-red-600 text-white text-[11px] font-bold text-center py-1 flex items-center justify-center gap-1.5"><WifiOff size={12} /> Sin conexión</div>}

            {/* Header */}
            <header className="px-4 pt-[max(0.9rem,env(safe-area-inset-top))] pb-2 shrink-0 relative z-30">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 pl-1 pr-3 py-1.5 rounded-full bg-white/[0.06] border border-border">
                        <span className="w-7 h-7 rounded-full bg-blue-500/20 flex items-center justify-center"><Car size={15} className="text-blue-400" /></span>
                        <span className="text-[15px] font-bold tracking-tight">Control LPR</span>
                        <span className={cn("w-1.5 h-1.5 rounded-full", connected ? "bg-emerald-400" : "bg-white/30")} />
                    </div>
                    <div className="flex items-center gap-2">
                        {pushState === "on" && <span className="w-2 h-2 rounded-full bg-blue-400 shadow-[0_0_8px_rgba(96,165,250,0.8)]" />}
                        <button onClick={() => setMenu(menu === "profile" ? null : "profile")} className="w-10 h-10 rounded-full bg-white/[0.06] border border-border flex items-center justify-center text-white/70 active:scale-95"><Settings size={18} /></button>
                    </div>
                </div>
                {menu === "profile" && (
                    <div className="absolute right-4 top-[calc(100%-0.25rem)] w-60 rounded-2xl bg-zinc-900 border border-border shadow-lg overflow-hidden py-1 z-40 animate-in fade-in slide-in-from-top-2 zoom-in-95 duration-200">
                        <button onClick={doRefresh} className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/5 text-sm"><RefreshCw size={16} className="text-white/60" /> Actualizar</button>
                        <button onClick={goFs} className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/5 text-sm"><Maximize2 size={16} className="text-white/60" /> Pantalla completa</button>
                        <button onClick={enablePush} disabled={pushState === "loading"} className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/5 text-sm">
                            {pushState === "loading" ? <RefreshCw size={16} className="text-white/60 animate-spin" /> : pushState === "on" ? <Bell size={16} className="text-blue-400" /> : <BellOff size={16} className="text-white/60" />}
                            <span className="flex-1 text-left">Notificaciones push{pushState === "denied" && <span className="block text-[10px] text-red-400/80">Bloqueadas</span>}</span>
                            <span className={cn("relative w-9 h-5 rounded-full transition-colors", pushState === "on" ? "bg-blue-500" : "bg-white/15")}><span className={cn("absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform", pushState === "on" && "translate-x-4")} /></span>
                        </button>
                        <button onClick={toggleWake} className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/5 text-sm"><Sun size={16} className={awake ? "text-amber-400" : "text-white/60"} /> Pantalla siempre encendida {awake ? "· ON" : ""}</button>
                    </div>
                )}
            </header>
            {menu && <div className="absolute inset-0 z-20" onClick={() => setMenu(null)} />}

            {/* Stats strip */}
            <div className="shrink-0 px-4 pb-2 flex gap-2">
                <div className="flex-1 rounded-xl bg-white/[0.05] border border-border px-3 py-2"><div className="text-[9px] text-white/40 uppercase font-mono">Lecturas 24h</div><div className="text-lg font-bold tabular-nums">{stats.total}</div></div>
                <div className="flex-1 rounded-xl bg-emerald-500/[0.08] border border-emerald-500/20 px-3 py-2"><div className="text-[9px] text-emerald-300/60 uppercase font-mono">Permitidos</div><div className="text-lg font-bold tabular-nums text-emerald-400">{stats.grants}</div></div>
                <div className="flex-1 rounded-xl bg-rose-500/[0.08] border border-rose-500/20 px-3 py-2"><div className="text-[9px] text-rose-300/60 uppercase font-mono">Denegados</div><div className="text-lg font-bold tabular-nums text-rose-400">{stats.denies}</div></div>
            </div>

            {/* VIVO */}
            {tab === "vivo" && (
                <div className="flex-1 overflow-y-auto [&::-webkit-scrollbar]:hidden pb-24 animate-in fade-in duration-300">
                    {devices.length === 0 ? (
                        <div className="h-full flex flex-col items-center justify-center text-white/40 gap-2"><Camera size={28} /><span className="text-sm">Sin cámaras LPR</span></div>
                    ) : devices.map(d => {
                        const lp = lastPlate[d.id];
                        return (
                            <div key={d.id} className="relative w-full aspect-video border-b border-border bg-black">
                                <LiveVideo deviceId={d.id} className="absolute inset-0 w-full h-full" />
                                <div className="absolute top-2 left-3 text-[11px] font-mono text-white/90" style={{ textShadow: "0 1px 3px rgba(0,0,0,0.9)" }}>{d.name}</div>
                                <div className="absolute top-2 right-3 flex items-center gap-1 px-1.5 py-0.5 rounded bg-black/55 text-[9px] font-bold uppercase"><span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />Live</div>
                                {lp && (
                                    <div className="absolute inset-x-0 bottom-0 px-3 pb-2.5 pt-10 bg-gradient-to-t from-black/90 to-transparent flex items-end justify-between">
                                        <div className="px-3 py-1.5 rounded-lg bg-black/70 border-2 font-bold tracking-widest text-xl" style={{ borderColor: lp.decision === "GRANT" ? "#10b981" : "#ef4444", color: "#fff" }}>{lp.plateDetected}</div>
                                        <div className="text-right">
                                            <div className={cn("text-xs font-bold", lp.decision === "GRANT" ? "text-emerald-400" : "text-rose-400")}>{lp.decision === "GRANT" ? "PERMITIDO" : "DENEGADO"}</div>
                                            <div className="text-[10px] text-white/60">{tfmt(lp.timestamp)}</div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}

            {/* LECTURAS */}
            {tab === "lecturas" && (
                <div className="flex-1 overflow-y-auto [&::-webkit-scrollbar]:hidden pb-24 px-3 pt-1 space-y-1.5 animate-in fade-in duration-300">
                    {events.length === 0 ? (
                        <div className="flex-1 flex flex-col items-center justify-center text-white/40 gap-2 pt-20"><Car size={28} /><span className="text-sm">Sin lecturas</span></div>
                    ) : events.map((e, i) => {
                        const img = evImg(e.snapshotPath); const grant = e.decision === "GRANT";
                        return (
                            <div key={e.id || i} className="flex items-center gap-3 rounded-2xl bg-white/[0.05] border border-border p-2.5">
                                <div className="w-14 h-12 rounded-lg overflow-hidden bg-black shrink-0 flex items-center justify-center" style={{ border: `1px solid ${grant ? "#10b98155" : "#ef444455"}` }}>
                                    {img ? <img src={img} alt="" className="w-full h-full object-cover" /> : <Car size={18} className={grant ? "text-emerald-400" : "text-rose-400"} />}
                                </div>
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-2">
                                        <span className="font-bold tracking-wider text-white truncate">{isAnom(e.plateDetected) ? "No leída" : e.plateDetected}</span>
                                        {e.user?.name && <span className="text-[11px] text-white/50 truncate">· {e.user.name}</span>}
                                    </div>
                                    <div className="text-[11px] text-white/50 flex items-center gap-2 mt-0.5">
                                        <span className="font-mono">{tfmt(e.timestamp)}</span>
                                        {e.device?.name && <span className="truncate">· {e.device.name}</span>}
                                    </div>
                                </div>
                                <span className={cn("text-[10px] font-bold px-2 py-1 rounded-full shrink-0", grant ? "bg-emerald-500/15 text-emerald-400" : "bg-rose-500/15 text-rose-400")}>{grant ? "OK" : "DENY"}</span>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* BUSCAR */}
            {tab === "buscar" && (
                <div className="flex-1 overflow-y-auto [&::-webkit-scrollbar]:hidden pb-24 px-3 pt-2 animate-in fade-in duration-300">
                    <div className="flex items-center gap-2 mb-3">
                        <div className="relative flex-1">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40" size={16} />
                            <input value={q} onChange={e => setQ(e.target.value.toUpperCase())} onKeyDown={e => { if (e.key === "Enter") doSearch(); }} placeholder="Matrícula o nombre…" className="w-full bg-white/[0.06] border border-border rounded-full pl-9 pr-3 py-2.5 text-sm text-white outline-none focus:border-blue-500 font-mono tracking-wider" />
                        </div>
                        <button onClick={doSearch} disabled={searching} className="w-11 h-11 rounded-full bg-blue-600 flex items-center justify-center disabled:opacity-50">{searching ? <RefreshCw size={18} className="animate-spin" /> : <Search size={18} />}</button>
                    </div>
                    {results.length === 0 ? (
                        <div className="text-center text-white/40 text-sm py-16">{searching ? "Buscando…" : "Buscá una matrícula para ver su historial."}</div>
                    ) : results.map((e, i) => {
                        const img = evImg(e.snapshotPath); const grant = e.decision === "GRANT";
                        return (
                            <div key={e.id || i} className="flex items-center gap-3 rounded-2xl bg-white/[0.05] border border-border p-2.5 mb-1.5">
                                <div className="w-12 h-12 rounded-lg overflow-hidden bg-black shrink-0 flex items-center justify-center">{img ? <img src={img} alt="" className="w-full h-full object-cover" /> : <Car size={16} className="text-white/40" />}</div>
                                <div className="min-w-0 flex-1">
                                    <div className="font-bold tracking-wider text-white truncate">{e.plateDetected || "—"}</div>
                                    <div className="text-[11px] text-white/50">{new Date(e.timestamp).toLocaleString("es-UY")}{e.device?.name ? ` · ${e.device.name}` : ""}</div>
                                </div>
                                <span className={cn("text-[10px] font-bold px-2 py-1 rounded-full", grant ? "bg-emerald-500/15 text-emerald-400" : "bg-rose-500/15 text-rose-400")}>{grant ? "OK" : "DENY"}</span>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Pull refresh spinner */}
            {refreshing && <div className="absolute left-1/2 -translate-x-1/2 z-40" style={{ top: "calc(env(safe-area-inset-top) + 60px)" }}><div className="w-9 h-9 rounded-full bg-zinc-800/90 border border-border flex items-center justify-center"><RefreshCw size={16} className="text-blue-400 animate-spin" /></div></div>}

            {/* Bottom nav */}
            <nav className="absolute bottom-0 inset-x-0 pb-[max(0.6rem,env(safe-area-inset-bottom))] pt-2 px-6 flex justify-center pointer-events-none z-30">
                <div className="pointer-events-auto flex items-center gap-1 px-2 py-1.5 rounded-full bg-zinc-900/85 backdrop-blur-xl border border-border shadow-lg">
                    <button onClick={() => setTab("vivo")} className={cn("w-12 h-11 rounded-full flex items-center justify-center transition-all duration-300", tab === "vivo" ? "bg-blue-500/90 text-white scale-105" : "text-white/60")}><Video size={19} /></button>
                    <button onClick={() => setTab("lecturas")} className={cn("w-12 h-11 rounded-full flex items-center justify-center transition-all duration-300", tab === "lecturas" ? "bg-blue-500/90 text-white scale-105" : "text-white/60")}><Rows3 size={19} /></button>
                    <button onClick={() => setTab("buscar")} className={cn("w-12 h-11 rounded-full flex items-center justify-center transition-all duration-300", tab === "buscar" ? "bg-blue-500/90 text-white scale-105" : "text-white/60")}><Search size={19} /></button>
                    <button onClick={() => setMenu(menu === "profile" ? null : "profile")} className="w-12 h-11 rounded-full text-white/60 flex items-center justify-center"><Settings size={19} /></button>
                </div>
            </nav>
        </div>
    );
}
