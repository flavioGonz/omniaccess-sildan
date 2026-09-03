"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { X, Bell, Volume2, VolumeX } from "lucide-react";
import io from "socket.io-client";
import { cn } from "@/lib/utils";
import { getQueueDevices, getQueueAlerts, getLatestQueueCounts } from "@/app/actions/queue";

const OCC = ["Aforo", "Occupancy", "Ocupación", "Ocupacion"];
function streamName(ip: string) { return `bosch_${(ip || "").replace(/\./g, "_")}`; }

function AlertVideo({ ip, deviceId, className }: { ip: string; deviceId: string; className?: string }) {
    const ref = useRef<HTMLVideoElement>(null);
    const [failed, setFailed] = useState(false);
    const retry = useRef(0);
    useEffect(() => {
        const sn = ip ? streamName(ip) : "";
        if (!sn) { setFailed(true); return; }
        setFailed(false); retry.current = 0;
        const v = ref.current; if (!v) return;
        let dead = false; let timer: any = null;
        const src = `/go2rtc/api/stream.mp4?src=${encodeURIComponent(sn)}`;
        const play = () => { if (dead || !v) return; v.src = src; v.play().catch(() => {}); };
        const onErr = () => { if (dead) return; retry.current++; if (retry.current > 5) { setFailed(true); return; } timer = setTimeout(play, Math.min(1000 * retry.current, 4000)); };
        v.addEventListener("error", onErr); play();
        return () => { dead = true; if (timer) clearTimeout(timer); v.removeEventListener("error", onErr); try { v.pause(); v.removeAttribute("src"); v.load(); } catch {} };
    }, [ip]);
    if (failed) return <img src={`/api/snapshot/${deviceId}?t=${Date.now()}`} alt="" className={cn("object-cover", className)} onError={(e) => ((e.target as HTMLImageElement).style.opacity = "0.25")} />;
    return <video ref={ref} className={cn("object-cover bg-black", className)} autoPlay muted playsInline />;
}

export default function AforoAlertOverlay() {
    const [devs, setDevs] = useState<Record<string, { name: string; ip: string }>>({});
    const [limit, setLimit] = useState(0);
    const [aforo, setAforo] = useState<Record<string, number>>({});
    const [dismissed, setDismissed] = useState<Set<string>>(new Set());
    const [focus, setFocus] = useState<string | null>(null);
    const [muted, setMuted] = useState(false);
    const audioRef = useRef<HTMLAudioElement | null>(null);

    // initial load + periodic refresh of devices/limit/aforo
    const refresh = async () => {
        try {
            const [devList, alerts, counts] = await Promise.all([getQueueDevices(), getQueueAlerts(), getLatestQueueCounts()]);
            const m: Record<string, { name: string; ip: string }> = {};
            for (const d of (devList as any[]) || []) m[d.id] = { name: d.name || "Fila", ip: d.ip || "" };
            setDevs(m);
            const ths = (alerts as any[]).map((a) => a.threshold).filter((n: number) => n > 0);
            if (ths.length) setLimit(Math.max(...ths));
            const af: Record<string, number> = {};
            for (const x of (counts as any[]) || []) { const ch = (x.channels || []).find((y: any) => OCC.includes(y.channelName)); if (x.device?.id) af[x.device.id] = ch ? ch.peopleCount : 0; }
            setAforo((p) => ({ ...p, ...af }));
        } catch { /* ignore */ }
    };

    useEffect(() => { refresh(); const r = setInterval(refresh, 20000); return () => clearInterval(r); }, []);

    useEffect(() => {
        const socket = io(window.location.origin, { path: "/io/socket.io", transports: ["websocket", "polling"] });
        socket.on("queue_update", (d: any) => { if (OCC.includes(d.channelName) && d.deviceId) setAforo((p) => ({ ...p, [d.deviceId]: d.peopleCount })); });
        return () => { socket.disconnect(); };
    }, []);

    const alertIds = useMemo(() => Object.keys(aforo).filter((id) => limit > 0 && (aforo[id] ?? 0) >= limit), [aforo, limit]);

    // prune dismissed when a device leaves alert (so it can re-pop next time)
    useEffect(() => {
        setDismissed((prev) => { const n = new Set([...prev].filter((id) => alertIds.includes(id))); return n.size === prev.size ? prev : n; });
    }, [alertIds]);

    const visible = alertIds.filter((id) => !dismissed.has(id) && devs[id]);
    const focusId = focus && visible.includes(focus) ? focus : visible[0];

    // play a short chime when a new alert becomes visible
    const prevVisible = useRef(0);
    useEffect(() => {
        if (visible.length > prevVisible.current && !muted) {
            try {
                const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
                if (Ctx) { const ctx = new Ctx(); const o = ctx.createOscillator(); const g = ctx.createGain(); o.connect(g); g.connect(ctx.destination); o.type = "sine"; o.frequency.value = 880; g.gain.setValueAtTime(0.0001, ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.5); o.start(); o.stop(ctx.currentTime + 0.5); }
            } catch { /* ignore */ }
        }
        prevVisible.current = visible.length;
    }, [visible.length, muted]);

    if (!focusId) return null;
    const fd = devs[focusId];

    return (
        <div className="fixed bottom-4 right-4 z-[3000] w-[360px] max-w-[92vw] rounded-2xl overflow-hidden bg-card/95 backdrop-blur-xl border-2 border-red-500/60 animate-in slide-in-from-bottom-4 fade-in duration-300" style={{ boxShadow: "0 0 46px rgba(239,68,68,0.4)" }}>
            <div className="flex items-center justify-between px-3.5 py-2.5 bg-red-500/15 border-b border-red-500/30">
                <div className="flex items-center gap-2">
                    <span className="relative flex h-2.5 w-2.5"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" /><span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500" /></span>
                    <Bell size={15} className="text-red-400" />
                    <span className="text-sm font-bold text-red-400 uppercase tracking-wide">Alerta de aforo</span>
                    {visible.length > 1 && <span className="text-[10px] font-bold text-red-300 bg-red-500/20 px-1.5 py-0.5 rounded-full">{visible.length}</span>}
                </div>
                <div className="flex items-center gap-1">
                    <button onClick={() => setMuted((m) => !m)} className="p-1.5 rounded-lg hover:bg-red-500/20 text-red-300/80" title={muted ? "Activar sonido" : "Silenciar"}>{muted ? <VolumeX size={14} /> : <Volume2 size={14} />}</button>
                    <button onClick={() => focusId && setDismissed((p) => new Set([...p, focusId]))} className="p-1.5 rounded-lg hover:bg-red-500/20 text-red-300" title="Descartar"><X size={15} /></button>
                </div>
            </div>

            <div className="relative bg-black aspect-video">
                <AlertVideo ip={fd.ip} deviceId={focusId} className="absolute inset-0 w-full h-full" />
                <div className="absolute inset-0 ring-4 ring-inset ring-red-500/70 animate-pulse pointer-events-none" />
                <div className="absolute top-2 left-2 px-2 py-0.5 rounded bg-black/60 text-[10px] font-semibold text-white max-w-[60%] truncate">{fd.name}</div>
                <div className="absolute top-2 right-2 px-2 py-0.5 rounded bg-red-600 text-[9px] font-bold text-white uppercase tracking-wide animate-pulse">Excede umbral</div>
                <div className="absolute bottom-2 right-2 flex items-baseline gap-1.5 px-2.5 py-1 rounded-lg bg-black/70 backdrop-blur">
                    <span className="text-[10px] uppercase text-white/60 font-bold">Aforo</span>
                    <span className="text-3xl font-bold tabular-nums text-red-400 leading-none animate-pulse">{aforo[focusId] ?? 0}</span>
                    <span className="text-sm text-white/50">/ {limit}</span>
                </div>
            </div>

            <div className="px-3.5 py-2.5 text-[11px] text-muted-foreground bg-red-500/[0.04]">
                <span className="text-red-300 font-semibold">Acción requerida:</span> la fila superó el umbral. Verificá en vivo y abrí otra caja o despejá la zona.
            </div>

            {visible.length > 1 && (
                <div className="flex items-center gap-1.5 px-2.5 pb-2.5 flex-wrap">
                    {visible.map((id) => (
                        <button key={id} onClick={() => setFocus(id)} className={cn("flex items-center gap-1.5 px-2 py-1 rounded-lg text-[10px] font-bold transition", id === focusId ? "bg-red-500/20 border border-red-500/40 text-red-300" : "bg-muted/50 border border-transparent text-muted-foreground hover:bg-accent")}>
                            <span className="w-4 h-4 rounded bg-red-500 text-white flex items-center justify-center tabular-nums">{aforo[id] ?? 0}</span>
                            <span className="truncate max-w-[90px]">{devs[id]?.name}</span>
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}
