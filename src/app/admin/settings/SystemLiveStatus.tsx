"use client";

import { useEffect, useRef, useState } from "react";
import { Radio, Video, CircleDot, HardDrive, Cpu, Power, RefreshCw, Cctv, Database, Trash2 } from "lucide-react";
import { getPreRecStatus, killPreRecFlow, cleanOrphanRings } from "@/app/actions/queue";
import { toast } from "sonner";

type Dev = { deviceId: string; name: string; ip: string | null; running: boolean; pid: number | null; uptimeSec: number | null; fresh: boolean; ringBytes: number; segments: number };
type Status = { instances: number; ringTotalBytes: number; disk: { totalBytes: number; usedBytes: number; freeBytes: number }; devices: Dev[] };

function fmtBytes(b: number) {
    if (!b) return "0 B";
    const u = ["B", "KB", "MB", "GB", "TB"]; let i = 0; let n = b;
    while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
    return `${n.toFixed(n >= 100 || i === 0 ? 0 : 1)} ${u[i]}`;
}
function fmtUptime(s: number | null) {
    if (s == null) return "—";
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60); if (m < 60) return `${m}m ${s % 60}s`;
    const h = Math.floor(m / 60); return `${h}h ${m % 60}m`;
}
function streamName(ip: string) { return "bosch_" + ip.replace(/\./g, "_"); }

function RtspTile({ ip }: { ip: string }) {
    const ref = useRef<HTMLVideoElement>(null);
    const [failed, setFailed] = useState(false);
    useEffect(() => {
        const v = ref.current; if (!v || !ip) { setFailed(true); return; }
        const sn = streamName(ip); let destroyed = false; let timer: any; let tries = 0;
        const load = () => { if (destroyed) return; v.src = `/go2rtc/api/stream.mp4?src=${encodeURIComponent(sn)}&t=${Date.now()}`; v.play().catch(() => {}); };
        const onErr = () => { if (destroyed) return; tries++; if (tries > 5) { setFailed(true); return; } timer = setTimeout(load, Math.min(1000 * tries, 4000)); };
        v.addEventListener("error", onErr); setFailed(false); load();
        return () => { destroyed = true; if (timer) clearTimeout(timer); v.removeEventListener("error", onErr); v.pause(); v.removeAttribute("src"); v.load(); };
    }, [ip]);
    if (failed) return <div className="absolute inset-0 flex items-center justify-center text-white/30 text-[10px]">Sin video</div>;
    return <video ref={ref} className="absolute inset-0 w-full h-full object-cover" autoPlay muted playsInline />;
}

export default function SystemLiveStatus() {
    const [data, setData] = useState<Status | null>(null);
    const [loading, setLoading] = useState(true);
    const [killing, setKilling] = useState<number | null>(null);
    const [cleaning, setCleaning] = useState(false);

    const load = async () => {
        try { const d = await getPreRecStatus(); setData(d as Status); } catch {} finally { setLoading(false); }
    };
    useEffect(() => { load(); const t = setInterval(load, 5000); return () => clearInterval(t); }, []);

    const onKill = async (pid: number | null) => {
        if (!pid) return;
        setKilling(pid);
        try { await killPreRecFlow(pid); } catch {}
        setTimeout(() => { setKilling(null); load(); }, 1200);
    };

    const onClean = async () => {
        setCleaning(true);
        try {
            const r = await cleanOrphanRings();
            if (r.removed > 0) toast.success(`Se limpiaron ${r.removed} buffer(s) huérfano(s) (${fmtBytes(r.bytes)} liberados)`);
            else toast.info("No había buffers huérfanos");
        } catch { toast.error("No se pudo limpiar"); }
        setCleaning(false); load();
    };

    if (loading && !data) return <div className="rounded-2xl border border-border bg-card/60 p-5 text-sm text-muted-foreground">Cargando estado de pre-grabación…</div>;
    if (!data) return null;

    const diskPct = data.disk.totalBytes > 0 ? (data.disk.usedBytes / data.disk.totalBytes) * 100 : 0;

    return (
        <div className="space-y-5">
            {/* Stats globales */}
            <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-2xl border border-border bg-card/70 p-4 flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-emerald-500/15 flex items-center justify-center"><Cpu size={18} className="text-emerald-400" /></div>
                    <div><div className="text-2xl font-bold text-foreground tabular-nums">{data.instances}</div><div className="text-[11px] text-muted-foreground font-semibold">Instancias ffmpeg activas</div></div>
                </div>
                <div className="rounded-2xl border border-border bg-card/70 p-4 flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-indigo-500/15 flex items-center justify-center"><Database size={18} className="text-indigo-400" /></div>
                    <div><div className="text-2xl font-bold text-foreground tabular-nums">{fmtBytes(data.ringTotalBytes)}</div><div className="text-[11px] text-muted-foreground font-semibold">Buffer pre-grabación en disco</div></div>
                </div>
                <div className="rounded-2xl border border-border bg-card/70 p-4">
                    <div className="flex items-center gap-2 mb-2"><HardDrive size={15} className="text-blue-400" /><span className="text-[11px] text-muted-foreground font-semibold">Disco · {fmtBytes(data.disk.freeBytes)} libres</span></div>
                    <div className="h-2 rounded-full bg-muted overflow-hidden"><div className={`h-full ${diskPct > 90 ? "bg-red-500" : diskPct > 75 ? "bg-amber-500" : "bg-blue-500"}`} style={{ width: `${Math.min(100, diskPct).toFixed(1)}%` }} /></div>
                    <div className="text-[10px] text-muted-foreground mt-1">{fmtBytes(data.disk.usedBytes)} usados de {fmtBytes(data.disk.totalBytes)} ({diskPct.toFixed(0)}%)</div>
                </div>
            </div>

            {/* Header lista */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2"><Radio size={16} className="text-emerald-400" /><h3 className="text-sm font-bold uppercase tracking-tight text-foreground">Flujos RTSP en vivo</h3></div>
                <div className="flex items-center gap-2">
                    <button onClick={onClean} disabled={cleaning} title="Borra carpetas de buffer que no corresponden a una cámara activa" className="flex items-center gap-1.5 text-[11px] font-bold text-amber-400 hover:text-amber-300 px-2 py-1 rounded-lg hover:bg-amber-500/10 transition-colors disabled:opacity-50">{cleaning ? <RefreshCw size={12} className="animate-spin" /> : <Trash2 size={12} />} Limpiar huérfanos</button>
                    <button onClick={load} className="flex items-center gap-1.5 text-[11px] font-bold text-muted-foreground hover:text-foreground px-2 py-1 rounded-lg hover:bg-accent transition-colors"><RefreshCw size={12} /> Actualizar</button>
                </div>
            </div>

            {data.devices.length === 0 ? (
                <div className="rounded-2xl border border-border bg-card/60 p-5 text-sm text-muted-foreground">No hay cámaras de fila (QUEUE_COUNTER) configuradas.</div>
            ) : (
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {data.devices.map((d) => (
                        <div key={d.deviceId} className="rounded-2xl border border-border bg-card/70 overflow-hidden flex flex-col">
                            <div className="relative aspect-video vid-surface">
                                {d.ip ? <RtspTile ip={d.ip} /> : <div className="absolute inset-0 flex items-center justify-center text-white/30 text-[10px]">Sin IP</div>}
                                <div className="absolute top-2 left-2 flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-black/60 backdrop-blur">
                                    <CircleDot size={9} className={d.running ? "text-emerald-400 animate-pulse" : "text-red-400"} />
                                    <span className={`text-[10px] font-bold ${d.running ? "text-emerald-300" : "text-red-300"}`}>{d.running ? "REC" : "OFF"}</span>
                                </div>
                            </div>
                            <div className="p-3 space-y-2.5">
                                <div className="flex items-center gap-2 min-w-0">
                                    <Cctv size={14} className="text-indigo-400 shrink-0" />
                                    <span className="text-sm font-bold text-foreground truncate">{d.name}</span>
                                    {d.ip && <span className="text-[9px] font-mono text-muted-foreground ml-auto shrink-0">{d.ip}</span>}
                                </div>
                                <div className="grid grid-cols-3 gap-1.5 text-center">
                                    <div className="rounded-lg bg-muted/40 py-1.5"><div className="text-[9px] text-muted-foreground uppercase font-bold">PID</div><div className="text-xs font-bold text-foreground tabular-nums">{d.pid ?? "—"}</div></div>
                                    <div className="rounded-lg bg-muted/40 py-1.5"><div className="text-[9px] text-muted-foreground uppercase font-bold">Uptime</div><div className="text-xs font-bold text-foreground tabular-nums">{fmtUptime(d.uptimeSec)}</div></div>
                                    <div className="rounded-lg bg-muted/40 py-1.5"><div className="text-[9px] text-muted-foreground uppercase font-bold">Buffer</div><div className="text-xs font-bold text-foreground tabular-nums">{fmtBytes(d.ringBytes)}</div></div>
                                </div>
                                <div className="flex items-center justify-between gap-2">
                                    <span className="text-[10px] text-muted-foreground">{d.segments} segmentos {d.fresh ? "· grabando" : d.running ? "· iniciando…" : "· detenido"}</span>
                                    <button
                                        onClick={() => onKill(d.pid)}
                                        disabled={!d.running || killing === d.pid}
                                        title="Cortar y reiniciar el flujo (se re-levanta solo)"
                                        className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold border border-red-500/30 text-red-400 hover:bg-red-500/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                                    >
                                        {killing === d.pid ? <RefreshCw size={12} className="animate-spin" /> : <Power size={12} />} {killing === d.pid ? "Cortando…" : "Reiniciar flujo"}
                                    </button>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}
            <p className="text-[11px] text-muted-foreground/80 flex items-center gap-1.5"><Video size={12} /> Cada flujo es un proceso <b>ffmpeg</b> que graba el RTSP de la cámara en segmentos cortos (buffer en anillo) para armar el clip del momento de la alerta. Si uno queda colgado, "Reiniciar flujo" lo corta y el sistema lo vuelve a levantar automáticamente.</p>
        </div>
    );
}
