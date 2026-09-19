"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import LiveEdgeKeeper from "@/components/LiveEdgeKeeper";
import PwaSplash from "@/components/PwaSplash";
import { ScanFace, RefreshCw, Bell, BellOff, Settings, Camera, Video, Rows3, UserPlus, WifiOff, Maximize2, Sun, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { getDevices } from "@/app/actions/devices";
import { getAccessEvents } from "@/app/actions/history";
import { registerFace } from "@/app/actions/users";
import io from "socket.io-client";
import { horaSeg } from "@/lib/fechas";

function urlB64ToUint8(base64: string) {
    const padding = "=".repeat((4 - (base64.length % 4)) % 4);
    const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
    const raw = atob(b64); const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
}
function getImg(p?: string | null) { if (!p) return null; const s = String(p); if (s.startsWith("http") || s.startsWith("/")) return s; return `/api/files/face/${s}`; }
function parseMeta(details?: string | null): Record<string, string> {
    const meta: Record<string, string> = {};
    try { const o = JSON.parse(details || "{}"); if (o && typeof o === "object") return o; } catch {}
    (details || "").split(",").forEach(p => { const [k, v] = p.split(":").map(s => s.trim()); if (k && v) meta[k] = v; });
    return meta;
}
function faceOf(e: any) { const m = parseMeta(e.details); return { img: getImg(m.FaceImage) || getImg(e.user?.cara) || getImg(e.snapshotPath), name: e.user?.name || m.Rostro || null, sim: m.Similitud ? parseInt(m.Similitud) : null }; }
function tfmt(t: any) { return horaSeg(new Date(t)); }

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
        const lowQ = typeof navigator !== "undefined" && (/Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (typeof window !== "undefined" && window.innerWidth <= 820));
        const src = `/go2rtc/api/stream.mp4?src=face_${deviceId}${lowQ ? "_low" : ""}&video=h264`;
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

export default function FacePwa() {
    const [devices, setDevices] = useState<any[]>([]);
    const [events, setEvents] = useState<any[]>([]);
    const [lastFace, setLastFace] = useState<Record<string, any>>({});
    const [tab, setTab] = useState<"vivo" | "recon" | "registrar">("vivo");
    const [connected, setConnected] = useState(false);
    const [online, setOnline] = useState(true);
    const [menu, setMenu] = useState(false);
    const [pushState, setPushState] = useState<"idle" | "on" | "denied" | "loading">("idle");
    const [refreshing, setRefreshing] = useState(false);
    const [splash, setSplash] = useState(true);
    const [awake, setAwake] = useState(false);
    const wakeRef = useRef<any>(null);
    const [regName, setRegName] = useState("");
    const [regFile, setRegFile] = useState<File | null>(null);
    const [regPreview, setRegPreview] = useState("");
    const [regBusy, setRegBusy] = useState(false);
    const fileRef = useRef<HTMLInputElement>(null);

    const load = useCallback(async () => {
        try {
            const all = await getDevices();
            setDevices((all as any[]).filter(d => d.deviceType === "FACE_TERMINAL"));
            const from = new Date(Date.now() - 24 * 3600 * 1000);
            const evs: any = await getAccessEvents({ take: 60, from, type: "FACE" });
            const list = (evs?.events || []) as any[];
            setEvents(list);
            const lf: Record<string, any> = {};
            for (const e of list) { if (e.device?.id && !lf[e.device.id]) lf[e.device.id] = e; }
            setLastFace(lf);
        } catch (e) { console.error(e); }
    }, []);

    useEffect(() => { load(); const r = setInterval(load, 20000); return () => clearInterval(r); }, [load]);
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
            if (ev.accessType && ev.accessType !== "FACE") return;
            setEvents(prev => [ev, ...prev].slice(0, 150));
            if (ev.device?.id) setLastFace(p => ({ ...p, [ev.device.id]: ev }));
        });
        return () => { socket.disconnect(); };
    }, []);

    const enablePush = async () => {
        setMenu(false);
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
    const doRefresh = async () => { setMenu(false); setRefreshing(true); await load(); setTimeout(() => setRefreshing(false), 500); };
    const goFs = () => { setMenu(false); const el: any = document.documentElement; if (document.fullscreenElement) document.exitFullscreen?.(); else el.requestFullscreen?.().catch(() => {}); };
    const toggleWake = async () => { setMenu(false); try { if (awake) { wakeRef.current?.release?.(); wakeRef.current = null; setAwake(false); } else { wakeRef.current = await (navigator as any).wakeLock?.request("screen"); setAwake(true); } } catch {} };

    const onPick = (f?: File) => { if (!f) return; setRegFile(f); setRegPreview(URL.createObjectURL(f)); };
    const doRegister = async () => {
        if (!regName.trim() || !regFile) return;
        setRegBusy(true);
        try {
            const fd = new FormData(); fd.append("name", regName.trim()); fd.append("photo", regFile); fd.append("creator", "PWA Facial");
            await registerFace(fd);
            setRegName(""); setRegFile(null); setRegPreview(""); load();
            alert("Rostro registrado correctamente ✅");
        } catch (e) { console.error(e); alert("No se pudo registrar el rostro."); } finally { setRegBusy(false); }
    };

    const stats = { total: events.length, ok: events.filter(e => e.decision === "GRANT").length, deny: events.filter(e => e.decision !== "GRANT").length };

    return (
        <div className="fixed inset-0 flex flex-col bg-card overflow-hidden text-white">
            <PwaSplash target="face" />
            <LiveEdgeKeeper />
            {!online && <div className="absolute top-0 inset-x-0 z-[90] bg-red-600 text-white text-[11px] font-bold text-center py-1 flex items-center justify-center gap-1.5"><WifiOff size={12} /> Sin conexión</div>}

            <header className="px-4 pt-[max(0.9rem,env(safe-area-inset-top))] pb-2 shrink-0 relative z-30">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 pl-1 pr-3 py-1.5 rounded-full bg-white/[0.06] border border-border">
                        <span className="w-7 h-7 rounded-full bg-emerald-500/20 flex items-center justify-center"><ScanFace size={15} className="text-emerald-400" /></span>
                        <span className="text-[15px] font-bold tracking-tight">Control Facial</span>
                        <span className={cn("w-1.5 h-1.5 rounded-full", connected ? "bg-emerald-400" : "bg-white/30")} />
                    </div>
                    <div className="flex items-center gap-2">
                        {pushState === "on" && <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]" />}
                        <button onClick={() => setMenu(!menu)} className="w-10 h-10 rounded-full bg-white/[0.06] border border-border flex items-center justify-center text-white/70 active:scale-95"><Settings size={18} /></button>
                    </div>
                </div>
                {menu && (
                    <div className="absolute right-4 top-[calc(100%-0.25rem)] w-60 rounded-2xl bg-zinc-900 border border-border shadow-lg overflow-hidden py-1 z-40 animate-in fade-in slide-in-from-top-2 zoom-in-95 duration-200">
                        <button onClick={doRefresh} className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/5 text-sm"><RefreshCw size={16} className="text-white/60" /> Actualizar</button>
                        <button onClick={goFs} className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/5 text-sm"><Maximize2 size={16} className="text-white/60" /> Pantalla completa</button>
                        <button onClick={enablePush} disabled={pushState === "loading"} className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/5 text-sm">
                            {pushState === "loading" ? <RefreshCw size={16} className="text-white/60 animate-spin" /> : pushState === "on" ? <Bell size={16} className="text-emerald-400" /> : <BellOff size={16} className="text-white/60" />}
                            <span className="flex-1 text-left">Notificaciones push{pushState === "denied" && <span className="block text-[10px] text-red-400/80">Bloqueadas</span>}</span>
                            <span className={cn("relative w-9 h-5 rounded-full transition-colors", pushState === "on" ? "bg-emerald-500" : "bg-white/15")}><span className={cn("absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform", pushState === "on" && "translate-x-4")} /></span>
                        </button>
                        <button onClick={toggleWake} className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/5 text-sm"><Sun size={16} className={awake ? "text-amber-400" : "text-white/60"} /> Pantalla siempre encendida {awake ? "· ON" : ""}</button>
                    </div>
                )}
            </header>
            {menu && <div className="absolute inset-0 z-20" onClick={() => setMenu(false)} />}

            <div className="shrink-0 px-4 pb-2 flex gap-2">
                <div className="flex-1 rounded-xl bg-white/[0.05] border border-border px-3 py-2"><div className="text-[9px] text-white/40 uppercase font-mono">Eventos 24h</div><div className="text-lg font-bold tabular-nums">{stats.total}</div></div>
                <div className="flex-1 rounded-xl bg-emerald-500/[0.08] border border-emerald-500/20 px-3 py-2"><div className="text-[9px] text-emerald-300/60 uppercase font-mono">Reconocidos</div><div className="text-lg font-bold tabular-nums text-emerald-400">{stats.ok}</div></div>
                <div className="flex-1 rounded-xl bg-rose-500/[0.08] border border-rose-500/20 px-3 py-2"><div className="text-[9px] text-rose-300/60 uppercase font-mono">Denegados</div><div className="text-lg font-bold tabular-nums text-rose-400">{stats.deny}</div></div>
            </div>

            {tab === "vivo" && (
                <div className="flex-1 overflow-y-auto [&::-webkit-scrollbar]:hidden pb-24 animate-in fade-in duration-300">
                    {devices.length === 0 ? (
                        <div className="h-full flex flex-col items-center justify-center text-white/40 gap-2"><Camera size={28} /><span className="text-sm">Sin terminales faciales</span></div>
                    ) : devices.map(d => {
                        const lf = lastFace[d.id]; const f = lf ? faceOf(lf) : null; const grant = lf?.decision === "GRANT";
                        return (
                            <div key={d.id} className="relative w-full aspect-video border-b border-border bg-black">
                                <LiveVideo deviceId={d.id} className="absolute inset-0 w-full h-full" />
                                <div className="absolute top-2 left-3 text-[11px] font-mono text-white/90" style={{ textShadow: "0 1px 3px rgba(0,0,0,0.9)" }}>{d.name}</div>
                                <div className="absolute top-2 right-3 flex items-center gap-1 px-1.5 py-0.5 rounded bg-black/55 text-[9px] font-bold uppercase"><span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />Live</div>
                                {f && (
                                    <div className="absolute inset-x-0 bottom-0 px-3 pb-2.5 pt-10 bg-gradient-to-t from-black/90 to-transparent flex items-end gap-3">
                                        <div className="w-14 h-14 rounded-xl overflow-hidden border-2 shrink-0" style={{ borderColor: grant ? "#10b981" : "#ef4444" }}>{f.img ? <img src={f.img} alt="" className="w-full h-full object-cover" /> : <div className="w-full h-full bg-zinc-800 flex items-center justify-center"><ScanFace size={20} className="text-white/40" /></div>}</div>
                                        <div className="flex-1 min-w-0">
                                            <div className="font-bold text-white truncate text-lg">{f.name || "Desconocido"}</div>
                                            <div className={cn("text-xs font-bold", grant ? "text-emerald-400" : "text-rose-400")}>{grant ? "ACCESO PERMITIDO" : "DENEGADO"}{f.sim != null ? ` · ${f.sim}%` : ""}</div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}

            {tab === "recon" && (
                <div className="flex-1 overflow-y-auto [&::-webkit-scrollbar]:hidden pb-24 px-3 pt-1 space-y-1.5 animate-in fade-in duration-300">
                    {events.length === 0 ? (
                        <div className="flex-1 flex flex-col items-center justify-center text-white/40 gap-2 pt-20"><ScanFace size={28} /><span className="text-sm">Sin reconocimientos</span></div>
                    ) : events.map((e, i) => {
                        const f = faceOf(e); const grant = e.decision === "GRANT";
                        return (
                            <div key={e.id || i} className="flex items-center gap-3 rounded-2xl bg-white/[0.05] border border-border p-2.5">
                                <div className="w-12 h-12 rounded-xl overflow-hidden bg-black shrink-0 flex items-center justify-center" style={{ border: `1px solid ${grant ? "#10b98155" : "#ef444455"}` }}>{f.img ? <img src={f.img} alt="" className="w-full h-full object-cover" /> : <ScanFace size={18} className={grant ? "text-emerald-400" : "text-rose-400"} />}</div>
                                <div className="min-w-0 flex-1">
                                    <div className="font-bold text-white truncate">{f.name || "Desconocido"}</div>
                                    <div className="text-[11px] text-white/50 flex items-center gap-2 mt-0.5"><span className="font-mono">{tfmt(e.timestamp)}</span>{e.device?.name && <span className="truncate">· {e.device.name}</span>}{f.sim != null && <span>· {f.sim}%</span>}</div>
                                </div>
                                <span className={cn("text-[10px] font-bold px-2 py-1 rounded-full shrink-0", grant ? "bg-emerald-500/15 text-emerald-400" : "bg-rose-500/15 text-rose-400")}>{grant ? "OK" : "DENY"}</span>
                            </div>
                        );
                    })}
                </div>
            )}

            {tab === "registrar" && (
                <div className="flex-1 overflow-y-auto [&::-webkit-scrollbar]:hidden pb-24 px-4 pt-3 animate-in fade-in duration-300">
                    <div className="max-w-sm mx-auto space-y-4">
                        <div className="text-center"><UserPlus size={28} className="text-emerald-400 mx-auto mb-1.5" /><div className="font-bold">Registrar rostro</div><div className="text-[11px] text-white/40">Tomá o subí una foto del rostro y asigná un nombre.</div></div>
                        <button onClick={() => fileRef.current?.click()} className="w-full aspect-square max-h-64 rounded-2xl border-2 border-dashed border-border bg-white/[0.04] flex flex-col items-center justify-center overflow-hidden">
                            {regPreview ? <img src={regPreview} alt="" className="w-full h-full object-cover" /> : <><Camera size={32} className="text-white/40 mb-2" /><span className="text-sm text-white/50">Tocá para tomar/elegir foto</span></>}
                        </button>
                        <input ref={fileRef} type="file" accept="image/*" capture="user" className="hidden" onChange={e => onPick(e.target.files?.[0] || undefined)} />
                        <input value={regName} onChange={e => setRegName(e.target.value)} placeholder="Nombre de la persona" className="w-full bg-white/[0.06] border border-border rounded-xl px-4 py-3 text-sm text-white outline-none focus:border-emerald-500" />
                        <button onClick={doRegister} disabled={regBusy || !regName.trim() || !regFile} className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold flex items-center justify-center gap-2">{regBusy ? <RefreshCw size={18} className="animate-spin" /> : <Check size={18} />} Registrar rostro</button>
                    </div>
                </div>
            )}

            {refreshing && <div className="absolute left-1/2 -translate-x-1/2 z-40" style={{ top: "calc(env(safe-area-inset-top) + 60px)" }}><div className="w-9 h-9 rounded-full bg-zinc-800/90 border border-border flex items-center justify-center"><RefreshCw size={16} className="text-emerald-400 animate-spin" /></div></div>}

            <nav className="absolute bottom-0 inset-x-0 pb-[max(0.6rem,env(safe-area-inset-bottom))] pt-2 px-6 flex justify-center pointer-events-none z-30">
                <div className="pointer-events-auto flex items-center gap-1 px-2 py-1.5 rounded-full bg-zinc-900/85 backdrop-blur-xl border border-border shadow-lg">
                    <button onClick={() => setTab("vivo")} className={cn("w-12 h-11 rounded-full flex items-center justify-center transition-all duration-300", tab === "vivo" ? "bg-emerald-500/90 text-white scale-105" : "text-white/60")}><Video size={19} /></button>
                    <button onClick={() => setTab("recon")} className={cn("w-12 h-11 rounded-full flex items-center justify-center transition-all duration-300", tab === "recon" ? "bg-emerald-500/90 text-white scale-105" : "text-white/60")}><Rows3 size={19} /></button>
                    <button onClick={() => setTab("registrar")} className={cn("w-12 h-11 rounded-full flex items-center justify-center transition-all duration-300", tab === "registrar" ? "bg-emerald-500/90 text-white scale-105" : "text-white/60")}><UserPlus size={19} /></button>
                    <button onClick={() => setMenu(!menu)} className="w-12 h-11 rounded-full text-white/60 flex items-center justify-center"><Settings size={19} /></button>
                </div>
            </nav>
        </div>
    );
}
