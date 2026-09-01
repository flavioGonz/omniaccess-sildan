"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import {
    Bell, BellRing, X, Calendar, MonitorSmartphone, Wifi, Cpu,
    RefreshCw, Send, AlertTriangle, Image as ImageIcon, Gauge, Eye,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getQueueNotifications, getDispatchHistory } from "@/app/actions/queue";
import { toast } from "sonner";
import io from "socket.io-client";

const BRAND_CONFIG: Record<string, { label: string; color: string; logoUrl?: string }> = {
    BOSCH: { label: "Bosch", color: "#E20015", logoUrl: "/bosch.png" },
};

interface Notif {
    id: string;
    alertId: string;
    alertName: string;
    threshold: number;
    cooldownMin: number;
    channelName: string | null;
    peopleCount: number;
    timestamp: string | Date;
    snapshotPath: string | null;
    device: { id: string; name: string; ip: string; location: string | null; brand: string } | null;
    dispatch: "SENT" | "NONE";
}

function snapUrl(path: string | null): string | null {
    if (!path) return null;
    return path.startsWith("/") ? path : `/api/files/lpr-prod/${path}`;
}

function severityOf(count: number, threshold: number) {
    const ratio = threshold > 0 ? count / threshold : 0;
    if (ratio >= 1.5) return { color: "text-red-400", bg: "bg-red-500/10", border: "border-red-500/25", label: "Crítico" };
    if (ratio >= 1) return { color: "text-amber-400", bg: "bg-amber-500/10", border: "border-amber-500/25", label: "Superado" };
    return { color: "text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/25", label: "En umbral" };
}

function DispatchDetail({ d, onClose }: { d: any; onClose: () => void }) {
    const chC = d.recipientChannel === "whatsapp" ? "#25D366" : d.recipientChannel === "telegram" ? "#0ea5e9" : d.recipientChannel === "email" ? "#f59e0b" : "#a855f7";
    const img = d.snapshotPath ? (d.snapshotPath.startsWith("/") ? d.snapshotPath : `/api/files/lpr-prod/${d.snapshotPath}`) : null;
    const t = new Date(d.sentAt || d.createdAt);
    const st = d.status === "SENT" ? { c: "#10b981", l: "Enviada" } : d.status === "FAILED" ? { c: "#ef4444", l: "Fallida" } : d.status === "PROCESSING" ? { c: "#0ea5e9", l: "Procesando" } : { c: "#f59e0b", l: "En cola" };
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-in fade-in duration-200" onClick={onClose}>
            <div className="bg-card border border-border rounded-2xl w-full max-w-lg overflow-hidden shadow-lg animate-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
                <div className="px-5 py-4 border-b border-border flex items-center justify-between">
                    <div className="flex items-center gap-3 min-w-0">
                        <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ background: `${chC}1a`, color: chC }}><Bell size={16} /></div>
                        <div className="min-w-0">
                            <div className="text-sm font-bold text-foreground truncate">{d.ruleName}</div>
                            <div className="text-[11px] text-muted-foreground">{t.toLocaleString("es-UY")}</div>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 text-muted-foreground hover:text-foreground rounded-lg hover:bg-accent"><X size={16} /></button>
                </div>
                {img && <div className="bg-black flex items-center justify-center"><img src={img} alt="" className="w-full max-h-72 object-contain" /></div>}
                <div className="p-5 space-y-4">
                    <div className="grid grid-cols-2 gap-3">
                        <div className="flex items-start gap-2 p-3 rounded-lg bg-foreground/[0.04] border border-border">
                            <Send size={13} className="text-muted-foreground mt-0.5 shrink-0" />
                            <div className="min-w-0"><span className="text-[9px] text-muted-foreground font-mono uppercase block mb-0.5">Destinatario</span><span className="text-xs text-foreground/80 font-medium break-words">{d.recipient || "\u2014"}</span></div>
                        </div>
                        <div className="flex items-start gap-2 p-3 rounded-lg bg-foreground/[0.04] border border-border">
                            <Cpu size={13} className="text-muted-foreground mt-0.5 shrink-0" />
                            <div className="min-w-0"><span className="text-[9px] text-muted-foreground font-mono uppercase block mb-0.5">Canal</span><span className="text-xs text-foreground/80 font-medium uppercase">{d.recipientChannel}</span></div>
                        </div>
                        {d.deviceName && <div className="flex items-start gap-2 p-3 rounded-lg bg-foreground/[0.04] border border-border"><MonitorSmartphone size={13} className="text-muted-foreground mt-0.5 shrink-0" /><div className="min-w-0"><span className="text-[9px] text-muted-foreground font-mono uppercase block mb-0.5">Dispositivo</span><span className="text-xs text-foreground/80 font-medium truncate">{d.deviceName}</span></div></div>}
                        {d.count != null && <div className="flex items-start gap-2 p-3 rounded-lg bg-foreground/[0.04] border border-border"><Gauge size={13} className="text-muted-foreground mt-0.5 shrink-0" /><div><span className="text-[9px] text-muted-foreground font-mono uppercase block mb-0.5">Aforo / Umbral</span><span className="text-xs text-foreground/80 font-medium">{d.count} / {d.threshold ?? "\u2014"}</span></div></div>}
                    </div>
                    {d.message && (
                        <div>
                            <span className="text-[9px] text-muted-foreground font-mono uppercase block mb-1.5">Mensaje enviado</span>
                            <div className="text-[13px] text-foreground/90 whitespace-pre-wrap break-words rounded-lg bg-foreground/[0.04] border border-border p-3 max-h-52 overflow-y-auto custom-scrollbar">{d.message}</div>
                        </div>
                    )}
                    {d.lastError && d.status === "FAILED" && (
                        <div className="text-[11px] text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-lg p-2.5 break-words">{d.lastError}</div>
                    )}
                    <div className="flex items-center justify-between pt-1">
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded border" style={{ color: st.c, borderColor: `${st.c}40`, background: `${st.c}18` }}>{st.l}</span>
                        {d.attempts != null && <span className="text-[10px] text-muted-foreground font-mono">Intentos {d.attempts}/{d.maxAttempts}</span>}
                    </div>
                </div>
            </div>
        </div>
    );
}

function NotifDetail({ n, onClose }: { n: Notif; onClose: () => void }) {
    const time = new Date(n.timestamp);
    const sev = severityOf(n.peopleCount, n.threshold);
    const brand = n.device ? BRAND_CONFIG[n.device.brand] : null;
    const imgSrc = snapUrl(n.snapshotPath);

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={onClose}>
            <div className="bg-card border border-border rounded-2xl w-full max-w-3xl overflow-hidden shadow-lg" onClick={e => e.stopPropagation()}>
                {imgSrc ? (
                    <div className="relative aspect-video bg-black">
                        <img src={imgSrc} alt="" className="w-full h-full object-contain" />
                        <button onClick={onClose} className="absolute top-3 right-3 p-2 rounded-xl bg-black/60 text-white/60 hover:text-white hover:bg-black/80 transition-colors backdrop-blur-sm">
                            <X size={16} />
                        </button>
                        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent px-6 py-5">
                            <div className="flex items-end justify-between">
                                <div>
                                    <div className="flex items-center gap-2 mb-1">
                                        <BellRing size={18} className={sev.color} />
                                        <span className={cn("text-2xl font-bold", sev.color)}>{n.peopleCount}</span>
                                        <span className="text-foreground/70 text-sm">/ umbral {n.threshold}</span>
                                    </div>
                                    <span className="text-muted-foreground text-xs">{n.alertName} · {n.channelName || "General"}</span>
                                </div>
                                <Badge className={cn("text-xs py-0.5 px-3 border", sev.color, sev.bg, sev.border)}>{sev.label}</Badge>
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="px-6 py-5 border-b border-border flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <BellRing size={18} className={sev.color} />
                            <span className={cn("text-2xl font-bold", sev.color)}>{n.peopleCount}</span>
                            <span className="text-foreground/70 font-medium">/ umbral {n.threshold} — {n.alertName}</span>
                        </div>
                        <button onClick={onClose} className="p-2 text-muted-foreground hover:text-foreground rounded-lg hover:bg-accent"><X size={16} /></button>
                    </div>
                )}
                <div className="p-6">
                    <div className="grid grid-cols-3 gap-4">
                        {[
                            { label: "Fecha / Hora", value: time.toLocaleString("es-UY"), icon: Calendar },
                            { label: "Alerta", value: n.alertName, icon: Bell },
                            { label: "Canal / Regla", value: n.channelName || "General", icon: Cpu },
                            { label: "Dispositivo", value: n.device?.name || "—", icon: MonitorSmartphone },
                            { label: "Direccion IP", value: n.device?.ip || "—", icon: Wifi },
                            { label: "Umbral · Cooldown", value: `${n.threshold} · ${n.cooldownMin} min`, icon: Gauge },
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
                    <div className="mt-4 pt-4 border-t border-border flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <span className="text-[9px] text-muted-foreground font-mono uppercase">Despacho</span>
                            {n.dispatch === "SENT" ? (
                                <Badge className="text-[10px] py-0 px-2 border bg-emerald-500/10 text-emerald-400 border-emerald-500/25"><Send size={9} className="mr-1" /> Enviada</Badge>
                            ) : (
                                <Badge className="text-[10px] py-0 px-2 border bg-foreground/10 text-muted-foreground border-border">Sin canal</Badge>
                            )}
                        </div>
                        {brand?.logoUrl && (
                            <div className="flex items-center gap-2">
                                <span className="text-[9px] text-muted-foreground font-mono uppercase">Procesado por</span>
                                <img src={brand.logoUrl} alt={brand.label} className="h-5 w-auto max-w-[80px] object-contain opacity-50" />
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

function showThresholdToast(data: { alertName: string; deviceName: string; channelName: string; peopleCount: number; threshold: number; snapshotPath: string | null }) {
    const imgSrc = snapUrl(data.snapshotPath);
    toast.custom(() => (
        <div className="bg-card border border-red-500/40 rounded-xl overflow-hidden shadow-lg shadow-red-500/20 w-[380px] animate-in slide-in-from-right-5 duration-300">
            {imgSrc && (
                <div className="relative h-32 overflow-hidden">
                    <img src={imgSrc} alt="" className="w-full h-full object-cover" />
                    <div className="absolute inset-0 bg-gradient-to-t from-zinc-900 via-zinc-900/40 to-transparent" />
                    <div className="absolute bottom-2 left-3">
                        <div className="bg-red-500 text-foreground text-[10px] font-bold px-2 py-0.5 rounded-md uppercase tracking-wider animate-pulse">Umbral alcanzado</div>
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
                    <span className="text-[10px] text-muted-foreground">{data.deviceName} · {data.channelName}</span>
                    <span className="text-[10px] text-muted-foreground font-mono">{new Date().toLocaleTimeString("es-UY")}</span>
                </div>
            </div>
        </div>
    ), { duration: 8000, position: "top-right" });
}

import DispatchQueuePanel from "./DispatchQueuePanel";

export default function DespachosPage() {
    const [notifs, setNotifs] = useState<Notif[]>([]);
    const [loading, setLoading] = useState(true);
    const [selected, setSelected] = useState<Notif | null>(null);
    const [selDisp, setSelDisp] = useState<any | null>(null);
    const [filter, setFilter] = useState<"all" | "Crítico" | "Superado" | "En umbral">("all");
    const [dispatches, setDispatches] = useState<any[]>([]);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const [data, disp] = await Promise.all([getQueueNotifications({ take: 100 }), getDispatchHistory({ take: 80 })]);
            setNotifs(data as any); setDispatches(disp as any);
        } catch {
            setNotifs([]); setDispatches([]);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    // Live toast (with photo) when an aforo threshold is reached
    const socketRef = useRef<any>(null);
    useEffect(() => {
        const socket = io(window.location.origin, { path: "/io/socket.io", transports: ["polling"] });
        socketRef.current = socket;
        socket.on("queue_alert", (data: any) => {
            showThresholdToast(data);
            load();
        });
        return () => { socket.disconnect(); };
    }, [load]);

    const sentCount = notifs.filter(n => n.dispatch === "SENT").length;
    const criticalCount = notifs.filter(n => n.peopleCount >= n.threshold * 1.5).length;

    const filtered = filter === "all" ? notifs : notifs.filter(n => severityOf(n.peopleCount, n.threshold).label === filter);
    const FILTERS: { key: typeof filter; label: string }[] = [
        { key: "all", label: "Todas" },
        { key: "Crítico", label: "Críticas" },
        { key: "Superado", label: "Superado" },
        { key: "En umbral", label: "En umbral" },
    ];

    return (
        <div className="max-w-[1700px] mx-auto space-y-5 p-6">
            {/* Hero header */}
            <div className="relative overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-amber-500/10 via-orange-500/5 to-transparent p-5">
                <div className="absolute -right-8 -top-8 w-40 h-40 rounded-full bg-amber-500/10 blur-3xl pointer-events-none" />
                <div className="relative flex items-center justify-between gap-4 flex-wrap">
                    <div className="flex items-center gap-3.5">
                        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center shadow-lg shadow-amber-900/30">
                            <Bell size={22} className="text-white" />
                        </div>
                        <div>
                            <h1 className="text-xl font-bold tracking-tight flex items-center gap-2">
                                Despachos
                                <span className="inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider text-emerald-400">
                                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /> En vivo
                                </span>
                            </h1>
                            <p className="text-xs text-muted-foreground">Alertas emitidas al superar los umbrales configurados</p>
                        </div>
                    </div>
                    <Button variant="ghost" size="sm" onClick={load} className="h-8 text-muted-foreground hover:text-foreground">
                        <RefreshCw size={13} className={cn("mr-1.5", loading && "animate-spin")} /> Recargar
                    </Button>
                </div>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-5 items-start">
            {/* IZQUIERDA: encolamiento + envío manual de reportes */}
            <div className="space-y-4 min-w-0">
              <DispatchQueuePanel />
            </div>
            {/* DERECHA: notificaciones disparadas */}
            <div className="space-y-4 min-w-0">
            {/* KPIs */}
            <div className="grid grid-cols-3 gap-3">
                {[
                    { label: "Despachos", value: dispatches.length, icon: BellRing, color: "#a855f7" },
                    { label: "Enviadas", value: dispatches.filter((d: any) => d.status === "SENT").length, icon: Send, color: "#10b981" },
                    { label: "Fallidas", value: dispatches.filter((d: any) => d.status === "FAILED").length, icon: AlertTriangle, color: "#ef4444" },
                ].map(({ label, value, icon: Icon, color }) => (
                    <div key={label} className="relative overflow-hidden rounded-xl border border-border bg-card p-4 flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0" style={{ background: `${color}1a`, color }}>
                            <Icon size={18} />
                        </div>
                        <div>
                            <div className="text-2xl font-bold tabular-nums" style={{ color }}>{value}</div>
                            <div className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</div>
                        </div>
                    </div>
                ))}
            </div>


            {/* Notificaciones enviadas (cola de despacho) */}
            {loading ? (
                <div className="flex items-center justify-center py-16 text-muted-foreground text-sm gap-2">
                    <RefreshCw size={16} className="animate-spin" /> Cargando notificaciones…
                </div>
            ) : dispatches.length === 0 ? (
                <div className="rounded-2xl border border-border bg-card text-center py-16 text-muted-foreground text-sm">
                    <Bell size={28} className="mx-auto mb-3 text-muted-foreground" />
                    No hay notificaciones enviadas todavía.
                    <div className="text-[11px] text-muted-foreground mt-1">Se registran cuando una alerta de aforo dispara un despacho a un destinatario.</div>
                </div>
            ) : (
                <div className="space-y-1.5 max-h-[calc(100vh-300px)] overflow-y-auto pr-1 custom-scrollbar">
                    {dispatches.map((d: any) => {
                        const st = d.status === "SENT" ? { c: "#10b981", l: "Enviada" } : d.status === "FAILED" ? { c: "#ef4444", l: "Fallida" } : d.status === "PROCESSING" ? { c: "#0ea5e9", l: "Procesando" } : { c: "#f59e0b", l: "En cola" };
                        const chC = d.recipientChannel === "whatsapp" ? "#25D366" : d.recipientChannel === "telegram" ? "#0ea5e9" : d.recipientChannel === "email" ? "#f59e0b" : "#a855f7";
                        const img = d.snapshotPath ? (d.snapshotPath.startsWith("/") ? d.snapshotPath : `/api/files/lpr-prod/${d.snapshotPath}`) : null;
                        const t = new Date(d.sentAt || d.createdAt);
                        return (
                            <div key={d.id} onClick={() => setSelDisp(d)} className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-2.5 cursor-pointer hover:border-foreground/20 hover:bg-accent/40 transition-colors">
                                <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: `${chC}1a`, color: chC }}>
                                    <Bell size={15} />
                                </div>
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-2">
                                        <span className="text-sm font-semibold text-foreground truncate">{d.ruleName}</span>
                                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-mono uppercase shrink-0">{d.recipientChannel}</span>
                                    </div>
                                    <div className="text-[11px] text-muted-foreground flex flex-wrap items-center gap-x-2.5 gap-y-0.5 mt-0.5">
                                        <span>{t.toLocaleString("es-UY", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
                                        {d.deviceName && <span className="truncate">· {d.deviceName}</span>}
                                        {d.recipient && <span className="inline-flex items-center gap-1 text-foreground/70 truncate max-w-[160px]">· <Send size={10} /> {d.recipient}</span>}
                                        {d.count != null && <span>· aforo {d.count}/{d.threshold ?? "—"}</span>}
                                    </div>
                                    {d.message && <p className="text-[11px] text-foreground/80 mt-1 line-clamp-2 whitespace-pre-wrap break-words" title={d.message}>{d.message}</p>}
                                </div>
                                <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded border shrink-0" style={{ color: st.c, borderColor: `${st.c}40`, background: `${st.c}18` }}>{st.l}</span>
                            </div>
                        );
                    })}
                </div>
            )}

            </div>{/* /derecha */}
            </div>{/* /grid 2col */}

            {selected && <NotifDetail n={selected} onClose={() => setSelected(null)} />}
            {selDisp && <DispatchDetail d={selDisp} onClose={() => setSelDisp(null)} />}
        </div>
    );
}
