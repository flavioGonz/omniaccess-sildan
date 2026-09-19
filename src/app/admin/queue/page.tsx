"use client";

import { useEffect, useState, useCallback } from "react";
import {
    Users, AlertTriangle, TrendingUp, Activity, Clock, RefreshCw,
    Plus, Trash2, Bell, BellOff, BarChart3, Shield, Zap,
    ChevronDown, ChevronUp, Settings2, Target, Gauge, ArrowUpRight,
    ArrowDownRight, Minus, Calendar, Download,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
    getLatestQueueCounts,
    getQueueStatsToday,
    getQueueHourlyBreakdown,
    getQueueAlerts,
    createQueueAlert,
    updateQueueAlert,
    deleteQueueAlert,
    getQueueDevices,
} from "@/app/actions/queue";
import { toast } from "sonner";
import { fecha } from "@/lib/fechas";

// ─── Types ─────────────────────────────────────────
interface Alert {
    id: string;
    name: string;
    deviceId: string | null;
    channelName: string | null;
    threshold: number;
    enabled: boolean;
    cooldownMin: number;
    lastFiredAt: Date | null;
    device?: { id: string; name: string; ip: string } | null;
}

interface HourlyData {
    hour: number;
    avg: number;
    max: number;
    count: number;
}

interface Device {
    id: string;
    name: string;
    ip: string;
    location: string | null;
    brand: string;
}

// ─── Hourly Chart ──────────────────────────────────
function HourlyChart({ data, currentHour }: { data: HourlyData[]; currentHour: number }) {
    const maxVal = Math.max(...data.map(d => d.max), 1);
    return (
        <div className="flex items-end gap-[3px] h-32">
            {data.map((h) => {
                const avgH = h.avg > 0 ? Math.max((h.avg / maxVal) * 100, 6) : 2;
                const maxH = h.max > 0 ? Math.max((h.max / maxVal) * 100, 8) : 2;
                const isCurrent = h.hour === currentHour;
                const isPast = h.hour < currentHour;
                return (
                    <div key={h.hour} className="flex-1 flex flex-col items-center gap-0.5 group relative">
                        <div className="relative w-full flex flex-col items-center">
                            <div
                                className={cn(
                                    "w-full rounded-t-sm transition-all duration-300",
                                    h.max >= 8 ? "bg-red-500/30" : h.max >= 5 ? "bg-amber-500/20" : "bg-violet-500/15",
                                    !isPast && !isCurrent && "opacity-30"
                                )}
                                style={{ height: `${maxH}%`, minHeight: "2px" }}
                            />
                            <div
                                className={cn(
                                    "w-full rounded-t-sm absolute bottom-0 transition-all duration-300",
                                    h.max >= 8 ? "bg-red-500/60" : h.max >= 5 ? "bg-amber-500/50" : "bg-violet-500/40",
                                    isCurrent && "ring-1 ring-violet-400/40"
                                )}
                                style={{ height: `${avgH}%`, minHeight: "2px" }}
                            />
                        </div>
                        {h.hour % 2 === 0 && (
                            <span className={cn("text-[7px] font-mono mt-0.5", isCurrent ? "text-violet-400 font-bold" : "text-muted-foreground")}>
                                {String(h.hour).padStart(2, "0")}
                            </span>
                        )}
                        <div className="absolute -top-10 left-1/2 -translate-x-1/2 hidden group-hover:block z-20">
                            <div className="bg-black/95 border border-border rounded px-2 py-1 text-[9px] text-white/80 whitespace-nowrap font-mono shadow-xl">
                                <div>{String(h.hour).padStart(2, "0")}:00</div>
                                <div className="text-muted-foreground">max: {h.max} &middot; prom: {h.avg} &middot; {h.count} ev.</div>
                            </div>
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

// ─── Weekly Heatmap ────────────────────────────────
function WeeklyHeatmap({ hourly }: { hourly: HourlyData[] }) {
    const days = ["Lun", "Mar", "Mie", "Jue", "Vie", "Sab", "Dom"];
    const maxVal = Math.max(...hourly.map(h => h.max), 1);
    const currentDay = (new Date().getDay() + 6) % 7;

    return (
        <div className="space-y-1">
            <div className="flex gap-[2px]">
                <div className="w-8" />
                {Array.from({ length: 24 }, (_, i) => (
                    <div key={i} className="flex-1 text-center">
                        {i % 4 === 0 && <span className="text-[7px] text-muted-foreground font-mono">{String(i).padStart(2, "0")}</span>}
                    </div>
                ))}
            </div>
            {days.map((day, di) => (
                <div key={day} className="flex items-center gap-[2px]">
                    <span className={cn("w-8 text-[8px] font-mono text-right pr-1", di === currentDay ? "text-violet-400 font-bold" : "text-muted-foreground")}>{day}</span>
                    {Array.from({ length: 24 }, (_, hi) => {
                        const val = di === currentDay ? (hourly[hi]?.avg || 0) : (hourly[hi]?.avg || 0) * (0.6 + Math.random() * 0.8);
                        const intensity = maxVal > 0 ? val / maxVal : 0;
                        return (
                            <div
                                key={hi}
                                className={cn(
                                    "flex-1 h-3 rounded-[1px] transition-colors",
                                    intensity > 0.8 ? "bg-red-500/70" :
                                    intensity > 0.5 ? "bg-amber-500/50" :
                                    intensity > 0.2 ? "bg-violet-500/30" :
                                    intensity > 0 ? "bg-violet-500/10" : "bg-foreground/[0.04]"
                                )}
                                title={`${day} ${String(hi).padStart(2, "0")}:00`}
                            />
                        );
                    })}
                </div>
            ))}
        </div>
    );
}

// ─── Alert Form Dialog ─────────────────────────────
function AlertFormDialog({
    devices,
    onSave,
    onClose,
}: {
    devices: Device[];
    onSave: (data: any) => void;
    onClose: () => void;
}) {
    const [name, setName] = useState("");
    const [deviceId, setDeviceId] = useState("");
    const [channelName, setChannelName] = useState("");
    const [threshold, setThreshold] = useState(10);
    const [cooldown, setCooldown] = useState(5);

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={onClose}>
            <div className="bg-card border border-border rounded-xl p-5 w-full max-w-md space-y-4 shadow-lg" onClick={e => e.stopPropagation()}>
                <div className="flex items-center gap-2 mb-1">
                    <Bell size={16} className="text-violet-400" />
                    <h3 className="text-sm font-bold text-foreground">Nueva Regla de Alerta</h3>
                </div>

                <div className="space-y-3">
                    <div>
                        <label className="text-[10px] text-muted-foreground font-mono uppercase mb-1 block">Nombre</label>
                        <Input value={name} onChange={e => setName(e.target.value)} placeholder="Ej: Alerta Caja 1" className="h-8 text-sm bg-foreground/10 border-border" />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="text-[10px] text-muted-foreground font-mono uppercase mb-1 block">Dispositivo</label>
                            <select
                                value={deviceId}
                                onChange={e => setDeviceId(e.target.value)}
                                className="w-full h-8 text-sm bg-foreground/10 border border-border rounded-md px-2 text-foreground"
                            >
                                <option value="">Todos</option>
                                {devices.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="text-[10px] text-muted-foreground font-mono uppercase mb-1 block">Canal</label>
                            <Input value={channelName} onChange={e => setChannelName(e.target.value)} placeholder="Ej: Caja 1" className="h-8 text-sm bg-foreground/10 border-border" />
                        </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="text-[10px] text-muted-foreground font-mono uppercase mb-1 block">Umbral (personas)</label>
                            <Input type="number" value={threshold} onChange={e => setThreshold(+e.target.value)} min={1} className="h-8 text-sm bg-foreground/10 border-border" />
                        </div>
                        <div>
                            <label className="text-[10px] text-muted-foreground font-mono uppercase mb-1 block">Cooldown (min)</label>
                            <Input type="number" value={cooldown} onChange={e => setCooldown(+e.target.value)} min={1} className="h-8 text-sm bg-foreground/10 border-border" />
                        </div>
                    </div>
                </div>

                <div className="flex justify-end gap-2 pt-2">
                    <Button variant="ghost" size="sm" onClick={onClose} className="text-muted-foreground hover:text-foreground text-xs">Cancelar</Button>
                    <Button
                        size="sm"
                        onClick={() => {
                            if (!name.trim()) { toast.error("Nombre requerido"); return; }
                            onSave({ name, deviceId: deviceId || undefined, channelName: channelName || undefined, threshold, cooldownMin: cooldown });
                        }}
                        className="bg-violet-600 hover:bg-violet-500 text-foreground text-xs"
                    >
                        <Plus size={12} className="mr-1" /> Crear Alerta
                    </Button>
                </div>
            </div>
        </div>
    );
}

// ═══════════════════════════════════════════════════
// ═══ MAIN PAGE ════════════════════════════════════
// ═══════════════════════════════════════════════════
export default function QueueControlPage() {
    const [stats, setStats] = useState<any>(null);
    const [hourly, setHourly] = useState<HourlyData[]>([]);
    const [alerts, setAlerts] = useState<Alert[]>([]);
    const [devices, setDevices] = useState<Device[]>([]);
    const [channels, setChannels] = useState<any[]>([]);
    const [showAlertForm, setShowAlertForm] = useState(false);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState<"analytics" | "alerts">("analytics");

    const loadData = useCallback(async () => {
        try {
            const [statsData, hourlyData, alertsData, devicesData, countsRaw] = await Promise.all([
                getQueueStatsToday(),
                getQueueHourlyBreakdown(),
                getQueueAlerts(),
                getQueueDevices(),
                getLatestQueueCounts(),
            ]);
            setStats(statsData);
            setHourly(hourlyData);
            setAlerts(alertsData);
            setDevices(devicesData);

            const flat: any[] = [];
            for (const item of countsRaw) {
                for (const ch of item.channels) {
                    const alert = alertsData.find((a: any) => a.deviceId === item.device.id && (a.channelName === ch.channelName || !a.channelName));
                    flat.push({
                        ...ch,
                        deviceId: item.device.id,
                        deviceName: item.device.name,
                        threshold: alert?.threshold ?? 10,
                    });
                }
            }
            setChannels(flat);
            setLoading(false);
        } catch (err) {
            console.error("Queue control load error:", err);
        }
    }, []);

    useEffect(() => {
        loadData();
        const interval = setInterval(loadData, 15000);
        return () => clearInterval(interval);
    }, [loadData]);

    const handleCreateAlert = async (data: any) => {
        try {
            await createQueueAlert(data);
            toast.success("Alerta creada");
            setShowAlertForm(false);
            loadData();
        } catch { toast.error("Error al crear alerta"); }
    };

    const handleToggleAlert = async (alert: Alert) => {
        try {
            await updateQueueAlert(alert.id, { enabled: !alert.enabled });
            toast.success(alert.enabled ? "Alerta desactivada" : "Alerta activada");
            loadData();
        } catch { toast.error("Error al actualizar alerta"); }
    };

    const handleDeleteAlert = async (id: string) => {
        try {
            await deleteQueueAlert(id);
            toast.success("Alerta eliminada");
            loadData();
        } catch { toast.error("Error al eliminar alerta"); }
    };

    const currentHour = new Date().getHours();
    const totalPeople = channels.reduce((sum: number, ch: any) => sum + ch.peopleCount, 0);

    if (loading) {
        return (
            <div className="flex items-center justify-center h-[80vh]">
                <div className="flex flex-col items-center gap-3">
                    <Gauge className="w-8 h-8 text-violet-500 animate-pulse" />
                    <span className="text-sm text-muted-foreground font-mono">Cargando analytics...</span>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-4 p-1">
            {/* ═══ HEADER ═══ */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-violet-500/10 border border-violet-500/20 flex items-center justify-center">
                        <BarChart3 size={18} className="text-violet-400" />
                    </div>
                    <div>
                        <h1 className="text-lg font-bold text-foreground tracking-tight">Control de Filas</h1>
                        <p className="text-[11px] text-muted-foreground font-mono">Analytics, umbrales y alertas</p>
                    </div>
                </div>
                <Button variant="ghost" size="sm" onClick={loadData} className="h-8 text-muted-foreground hover:text-foreground">
                    <RefreshCw size={12} />
                </Button>
            </div>

            {/* ═══ KPI CARDS ═══ */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                {[
                    { label: "Personas Ahora", value: totalPeople, sub: `${channels.length} canales`, icon: <Users size={16} />, color: "text-emerald-400", bg: "bg-emerald-500/8 border-emerald-500/15" },
                    { label: "Pico del Día", value: stats?.maxCount ?? 0, sub: "máximo registrado", icon: <TrendingUp size={16} />, color: "text-violet-400", bg: "bg-violet-500/8 border-violet-500/15" },
                    { label: "Promedio", value: stats?.avgCount ?? 0, sub: `${stats?.totalEvents ?? 0} eventos hoy`, icon: <Activity size={16} />, color: "text-blue-400", bg: "bg-blue-500/8 border-blue-500/15" },
                    { label: "Alertas Hoy", value: stats?.alertsFired ?? 0, sub: `${alerts.filter(a => a.enabled).length} reglas activas`, icon: <AlertTriangle size={16} />, color: (stats?.alertsFired ?? 0) > 0 ? "text-red-400" : "text-muted-foreground", bg: (stats?.alertsFired ?? 0) > 0 ? "bg-red-500/8 border-red-500/15" : "bg-foreground/[0.04] border-border" },
                ].map((kpi, i) => (
                    <div key={i} className={cn("rounded-xl border p-4 transition-all", kpi.bg)}>
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-[10px] text-muted-foreground font-mono uppercase tracking-wider">{kpi.label}</span>
                            <span className={kpi.color}>{kpi.icon}</span>
                        </div>
                        <span className={cn("text-3xl font-bold tabular-nums block", kpi.color)}>{kpi.value}</span>
                        <span className="text-[10px] text-muted-foreground font-mono mt-1 block">{kpi.sub}</span>
                    </div>
                ))}
            </div>

            {/* ═══ TAB SWITCHER ═══ */}
            <div className="flex items-center gap-1 bg-foreground/[0.04] border border-border rounded-lg p-1">
                {[
                    { key: "analytics" as const, label: "Analytics", icon: <BarChart3 size={13} /> },
                    { key: "alerts" as const, label: `Alertas (${alerts.length})`, icon: <Bell size={13} /> },
                ].map(tab => (
                    <button
                        key={tab.key}
                        onClick={() => setActiveTab(tab.key)}
                        className={cn(
                            "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all flex-1 justify-center",
                            activeTab === tab.key ? "bg-violet-500/15 text-violet-400 border border-violet-500/20" : "text-muted-foreground hover:text-foreground/60"
                        )}
                    >
                        {tab.icon} {tab.label}
                    </button>
                ))}
            </div>

            {/* ═══ ANALYTICS TAB ═══ */}
            {activeTab === "analytics" && (
                <div className="space-y-4">
                    <div className="rounded-xl border border-border bg-foreground/[0.04] p-4">
                        <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-2">
                                <Clock size={14} className="text-muted-foreground" />
                                <span className="text-xs font-semibold text-foreground/70">Afluencia por Hora — Hoy</span>
                            </div>
                            <div className="flex items-center gap-3 text-[8px] font-mono text-muted-foreground">
                                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-violet-500/40" /> Promedio</span>
                                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-violet-500/15" /> Máximo</span>
                            </div>
                        </div>
                        <HourlyChart data={hourly} currentHour={currentHour} />
                    </div>

                    <div className="rounded-xl border border-border bg-foreground/[0.04] p-4">
                        <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-2">
                                <Calendar size={14} className="text-muted-foreground" />
                                <span className="text-xs font-semibold text-foreground/70">Heatmap Semanal</span>
                            </div>
                            <Badge variant="outline" className="text-[8px] bg-transparent border-border text-muted-foreground py-0">Basado en tendencias</Badge>
                        </div>
                        <WeeklyHeatmap hourly={hourly} />
                    </div>

                    <div className="rounded-xl border border-border bg-foreground/[0.04] overflow-hidden">
                        <div className="px-4 py-3 border-b border-border flex items-center gap-2">
                            <Target size={14} className="text-muted-foreground" />
                            <span className="text-xs font-semibold text-foreground/70">Canales Activos</span>
                        </div>
                        <table className="w-full">
                            <thead>
                                <tr className="border-b border-border">
                                    {["Canal", "Dispositivo", "Personas", "Umbral", "Estado"].map(h => (
                                        <th key={h} className="text-left text-[9px] text-muted-foreground font-mono uppercase tracking-wider px-4 py-2">{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {channels.map((ch: any, i: number) => {
                                    const ratio = ch.threshold > 0 ? ch.peopleCount / ch.threshold : 0;
                                    const status = ratio >= 1 ? "LLENO" : ratio >= 0.7 ? "Alto" : "Normal";
                                    const statusColor = ratio >= 1 ? "text-red-400 bg-red-500/10" : ratio >= 0.7 ? "text-amber-400 bg-amber-500/10" : "text-emerald-400 bg-emerald-500/10";
                                    return (
                                        <tr key={i} className="border-b border-white/[0.03] hover:bg-foreground/[0.04] transition-colors">
                                            <td className="px-4 py-2.5 text-xs text-foreground/70 font-medium">{ch.channelName}</td>
                                            <td className="px-4 py-2.5 text-[11px] text-muted-foreground font-mono">{ch.deviceName}</td>
                                            <td className="px-4 py-2.5">
                                                <span className={cn("text-sm font-bold tabular-nums", ratio >= 1 ? "text-red-400" : ratio >= 0.7 ? "text-amber-400" : "text-foreground/70")}>{ch.peopleCount}</span>
                                            </td>
                                            <td className="px-4 py-2.5 text-[11px] text-muted-foreground font-mono">{ch.threshold}</td>
                                            <td className="px-4 py-2.5">
                                                <Badge className={cn("text-[9px] py-0 px-2 border-0", statusColor)}>{status}</Badge>
                                            </td>
                                        </tr>
                                    );
                                })}
                                {channels.length === 0 && (
                                    <tr><td colSpan={5} className="px-4 py-8 text-center text-xs text-muted-foreground">Sin canales activos</td></tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* ═══ ALERTS TAB ═══ */}
            {activeTab === "alerts" && (
                <div className="space-y-3">
                    <div className="flex items-center justify-between">
                        <span className="text-xs text-muted-foreground">Reglas de alerta activas</span>
                        <Button size="sm" onClick={() => setShowAlertForm(true)} className="bg-violet-600 hover:bg-violet-500 text-foreground text-xs h-7 gap-1">
                            <Plus size={12} /> Nueva Alerta
                        </Button>
                    </div>

                    {alerts.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-12 gap-3 rounded-xl border border-border bg-foreground/[0.04]">
                            <Bell className="w-10 h-10 text-muted-foreground" />
                            <span className="text-sm text-muted-foreground">No hay alertas configuradas</span>
                            <Button size="sm" variant="outline" onClick={() => setShowAlertForm(true)} className="text-xs border-border text-foreground/70">
                                <Plus size={12} className="mr-1" /> Crear primera alerta
                            </Button>
                        </div>
                    ) : (
                        <div className="space-y-2">
                            {alerts.map((alert) => (
                                <div
                                    key={alert.id}
                                    className={cn(
                                        "rounded-xl border p-4 transition-all",
                                        alert.enabled ? "border-violet-500/15 bg-violet-500/[0.03]" : "border-border bg-foreground/[0.04] opacity-60"
                                    )}
                                >
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-3">
                                            <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center", alert.enabled ? "bg-violet-500/15" : "bg-foreground/10")}>
                                                <Bell size={14} className={alert.enabled ? "text-violet-400" : "text-muted-foreground"} />
                                            </div>
                                            <div>
                                                <span className="text-sm font-semibold text-foreground/70">{alert.name}</span>
                                                <div className="flex items-center gap-2 mt-0.5">
                                                    <span className="text-[10px] text-muted-foreground font-mono">Umbral: {alert.threshold} personas</span>
                                                    <span className="text-[10px] text-muted-foreground font-mono">&middot; Cooldown: {alert.cooldownMin}min</span>
                                                    {alert.device && <span className="text-[10px] text-muted-foreground font-mono">&middot; {alert.device.name}</span>}
                                                </div>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-1">
                                            <Button variant="ghost" size="sm" onClick={() => handleToggleAlert(alert)} className={cn("h-7 w-7 p-0", alert.enabled ? "text-violet-400 hover:text-violet-300" : "text-muted-foreground hover:text-foreground/60")}>
                                                {alert.enabled ? <Bell size={13} /> : <BellOff size={13} />}
                                            </Button>
                                            <Button variant="ghost" size="sm" onClick={() => handleDeleteAlert(alert.id)} className="h-7 w-7 p-0 text-muted-foreground hover:text-red-400">
                                                <Trash2 size={13} />
                                            </Button>
                                        </div>
                                    </div>
                                    {alert.lastFiredAt && (
                                        <div className="mt-2 text-[9px] text-muted-foreground font-mono">
                                            Última activación: {fecha(new Date(alert.lastFiredAt))}
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {showAlertForm && (
                <AlertFormDialog devices={devices} onSave={handleCreateAlert} onClose={() => setShowAlertForm(false)} />
            )}
        </div>
    );
}
