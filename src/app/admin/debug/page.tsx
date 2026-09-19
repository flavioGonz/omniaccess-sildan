"use client";

import { useEffect, useState, useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Activity, Trash2, Camera, Smartphone, Circle, CheckCircle2, Car, CreditCard, AlertTriangle, Video, Layers } from "lucide-react";
import { getMapDevices } from "@/app/actions/maps";
import { getEnabledModules } from "@/app/actions/modules";
import { cn } from "@/lib/utils";
import { io } from "socket.io-client";
import { hora } from "@/lib/fechas";

type WebhookLog = {
    id: string;
    timestamp: Date;
    source: 'hikvision' | 'akuvox' | 'raw';
    method: string;
    url: string;
    params: Record<string, any>;
    body?: any;
    status?: number;
    deviceName?: string;
    deviceMac?: string;
    credentialValue?: string;
};

export default function WebhookDebugPage() {
    const [logs, setLogs] = useState<WebhookLog[]>([]);
    const [filter, setFilter] = useState<'all' | 'hikvision' | 'akuvox' | 'face' | 'plate' | 'tag' | 'bosch'>('all');
    const [isConnected, setIsConnected] = useState(false);
    const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
    const [devices, setDevices] = useState<any[]>([]);
    const [modules, setModules] = useState<Record<string, boolean>>({});

    useEffect(() => {
        let alive = true;
        (async () => {
            try {
                const [d, m] = await Promise.all([getMapDevices(), getEnabledModules()]);
                if (alive) { setDevices(d as any); setModules(m as any); }
            } catch (e) { console.error(e); }
        })();
        const t = setInterval(async () => {
            try { const d = await getMapDevices(); if (alive) setDevices(d as any); } catch {}
        }, 30000);
        return () => { alive = false; clearInterval(t); };
    }, []);

    useEffect(() => {
        // Connect to Socket.IO on port 10000
        const socket = io(window.location.origin, {
            path: '/io/socket.io',
            transports: ['polling'],
            reconnection: true,
            reconnectionDelay: 1000
        });

        socket.on('connect', () => {
            console.log('[DEBUG] Socket.IO connected for webhook debugging');
            setIsConnected(true);
        });

        socket.on('disconnect', () => {
            console.log('[DEBUG] Socket.IO disconnected');
            setIsConnected(false);
        });

        socket.on('webhook_history', (history: any[]) => {
            console.log('[DEBUG] Webhook history received:', history.length);
            const formattedHistory = history.map(data => ({
                id: data.id,
                timestamp: new Date(data.timestamp),
                source: data.source,
                method: data.method,
                url: data.url,
                params: data.params || {},
                body: data.body,
                status: data.status,
                deviceName: data.deviceName,
                deviceMac: data.deviceMac,
                credentialValue: data.credentialValue
            }));
            setLogs(formattedHistory);
        });

        socket.on('webhook_debug', (data: any) => {
            console.log('[DEBUG] Webhook debug event received:', data);
            const log: WebhookLog = {
                id: data.id || Date.now().toString(),
                timestamp: new Date(data.timestamp),
                source: data.source,
                method: data.method,
                url: data.url,
                params: data.params || {},
                body: data.body,
                status: data.status,
                deviceName: data.deviceName,
                deviceMac: data.deviceMac,
                credentialValue: data.credentialValue
            };
            setLogs(prev => {
                // Evitamos duplicados si el historial y el tiempo real se cruzan
                if (prev.some(l => l.id === log.id)) return prev;
                const newLogs = [log, ...prev].slice(0, 300);
                return newLogs;
            });
        });

        return () => {
            socket.disconnect();
        };
    }, []);

    const clearLogs = () => {
        setLogs([]);
    };

    // Time filter state
    const [timeFilter, setTimeFilter] = useState<'all' | '1min' | '5min' | '30min'>('all');

    // Filter by source, type and time
    const filteredLogs = logs.filter(log => {
        // Source/Type filter
        let matchesType = true;
        if (filter === 'hikvision') matchesType = log.source === 'hikvision';
        else if (filter === 'akuvox') matchesType = log.source === 'akuvox';
        else if (filter === 'face') {
            matchesType = log.url.toLowerCase().includes('face') ||
                log.params?.event?.includes('face') ||
                log.credentialValue?.toLowerCase().includes('face') ||
                (log.source === 'akuvox' && log.params?.user);
        }
        else if (filter === 'plate') {
            matchesType = log.source === 'hikvision' && !!log.credentialValue && log.credentialValue !== 'NON-ANPR' && log.credentialValue !== 'INCOMING POLLING';
        }
        else if (filter === 'tag') {
            matchesType = log.url.toLowerCase().includes('card') ||
                log.params?.event?.includes('card') ||
                log.params?.card ||
                log.credentialValue?.toLowerCase().includes('card') ||
                log.credentialValue?.toLowerCase().includes('tag');
        }

        else if (filter === 'bosch') {
            matchesType = log.source === 'bosch' || /onvif|bosch|queue|aforo/i.test(log.url || '');
        }

        if (!matchesType) return false;

        // Time filter
        if (timeFilter === 'all') return true;

        const now = new Date();
        const logTime = new Date(log.timestamp);
        const diffMinutes = (now.getTime() - logTime.getTime()) / (1000 * 60);

        return timeFilter === '1min' ? diffMinutes <= 1 :
            timeFilter === '5min' ? diffMinutes <= 5 :
                timeFilter === '30min' ? diffMinutes <= 30 :
                    true;
    });

    const hikvisionCount = useMemo(() => logs.filter(l => l.source === 'hikvision').length, [logs]);
    const akuvoxCount = useMemo(() => logs.filter(l => l.source === 'akuvox').length, [logs]);
    const boschCount = useMemo(() => logs.filter(l => l.source === 'bosch' || /onvif|bosch|queue|aforo/i.test(l.url || '')).length, [logs]);
    const activeMode = modules.MODULE_QUEUE ? 'queue' : modules.MODULE_FACE ? 'face' : modules.MODULE_LPR ? 'lpr' : 'all';
    const deviceTypes = useMemo(() => {
        const m: Record<string, { count: number; brands: Set<string>; online: number }> = {};
        for (const d of devices) { const t = d.type || 'OTROS'; if (!m[t]) m[t] = { count: 0, brands: new Set<string>(), online: 0 }; m[t].count++; if (d.brand) m[t].brands.add(d.brand); if (d.online) m[t].online++; }
        return Object.entries(m).map(([type, v]) => ({ type, count: v.count, brands: [...v.brands], online: v.online }));
    }, [devices]);

    return (
        <div className="p-6 space-y-6 animate-in fade-in duration-500">
            {/* Header */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-card p-6 rounded-xl border border-border">
                <div className="flex items-center gap-4">
                    <div className="p-3 bg-blue-500/10 rounded-lg border border-blue-500/20">
                        <Activity size={24} className="text-blue-400" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold text-foreground tracking-tight uppercase">
                            Monitor de Webhooks
                        </h1>
                        <p className="text-sm text-muted-foreground font-medium mt-1">
                            Eventos en tiempo real desde dispositivos
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-3">
                    <div className={cn(
                        "flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider border",
                        isConnected
                            ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                            : "bg-red-500/10 text-red-400 border-red-500/20"
                    )}>
                        <Circle className={cn("w-2 h-2 fill-current", isConnected && "animate-pulse")} />
                        {isConnected ? 'Conectado' : 'Desconectado'}
                    </div>
                    <Button
                        variant="outline"
                        onClick={clearLogs}
                        size="sm"
                        className="border-border hover:bg-muted"
                    >
                        <Trash2 size={14} className="mr-2" />
                        Limpiar
                    </Button>
                </div>
            </div>

            {/* Tipos de dispositivo del modo activo */}
            <div className="bg-card border border-border rounded-xl p-4">
                <div className="flex items-center gap-2 mb-3">
                    <Layers size={15} className="text-violet-400" />
                    <span className="text-xs font-bold uppercase tracking-wider text-foreground/70">Dispositivos del modo</span>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-violet-500/15 text-violet-300 font-bold uppercase tracking-wider">
                        {activeMode === 'queue' ? 'Control de Fila' : activeMode === 'face' ? 'Facial' : activeMode === 'lpr' ? 'LPR' : 'Todos'}
                    </span>
                    <span className="ml-auto text-[10px] text-muted-foreground font-mono">{devices.length} dispositivos</span>
                </div>
                {deviceTypes.length === 0 ? (
                    <div className="text-xs text-muted-foreground py-2">Sin dispositivos registrados.</div>
                ) : (
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                        {deviceTypes.map((dt) => (
                            <div key={dt.type} className="flex items-center gap-2.5 rounded-lg border border-border bg-muted/30 px-3 py-2">
                                <div className="w-8 h-8 rounded-lg bg-violet-500/10 text-violet-400 flex items-center justify-center shrink-0"><Camera size={15} /></div>
                                <div className="min-w-0">
                                    <div className="text-sm font-bold text-foreground truncate">{dt.type}</div>
                                    <div className="text-[10px] text-muted-foreground truncate">
                                        {dt.count} disp · {dt.brands.join(", ") || "s/marca"} · <span className="text-emerald-400">{dt.online} online</span>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Quick Filters */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-7 gap-3">
                <Button
                    variant={filter === 'all' ? 'default' : 'outline'}
                    onClick={() => setFilter('all')}
                    className="h-20 flex-col gap-1 border-2"
                >
                    <Activity size={18} />
                    <span className="text-[10px] font-bold uppercase">Todos</span>
                    <span className="text-lg font-bold">{logs.length}</span>
                </Button>

                <Button
                    variant={filter === 'hikvision' ? 'default' : 'outline'}
                    onClick={() => setFilter('hikvision')}
                    className="h-20 flex-col gap-1 border-2 border-purple-500/30"
                >
                    <Camera size={18} className="text-purple-400" />
                    <span className="text-[10px] font-bold uppercase">LPR Hik</span>
                    <span className="text-lg font-bold text-purple-400">{hikvisionCount}</span>
                </Button>

                <Button
                    variant={filter === 'akuvox' ? 'default' : 'outline'}
                    onClick={() => setFilter('akuvox')}
                    className="h-20 flex-col gap-1 border-2 border-blue-500/30"
                >
                    <Smartphone size={18} className="text-blue-400" />
                    <span className="text-[10px] font-bold uppercase">Akuvox</span>
                    <span className="text-lg font-bold text-blue-400">{akuvoxCount}</span>
                </Button>

                <Button
                    variant={filter === 'face' ? 'default' : 'outline'}
                    onClick={() => setFilter('face')}
                    className="h-20 flex-col gap-1 border-2 border-emerald-500/30"
                >
                    <CheckCircle2 size={18} className="text-emerald-400" />
                    <span className="text-[10px] font-bold uppercase">Facial</span>
                </Button>

                <Button
                    variant={filter === 'plate' ? 'default' : 'outline'}
                    onClick={() => setFilter('plate')}
                    className="h-20 flex-col gap-1 border-2 border-orange-500/30"
                >
                    <Car size={18} className="text-orange-400" />
                    <span className="text-[10px] font-bold uppercase">Matrículas</span>
                </Button>

                <Button
                    variant={filter === 'tag' ? 'default' : 'outline'}
                    onClick={() => setFilter('tag')}
                    className="h-20 flex-col gap-1 border-2 border-cyan-500/30"
                >
                    <CreditCard size={18} className="text-cyan-400" />
                    <span className="text-[10px] font-bold uppercase">TAG / RFID</span>
                </Button>

                <Button
                    variant={filter === 'bosch' ? 'default' : 'outline'}
                    onClick={() => setFilter('bosch')}
                    className="h-20 flex-col gap-1 border-2 border-green-500/30"
                >
                    <Video size={18} className="text-green-400" />
                    <span className="text-[10px] font-bold uppercase">Cola / Bosch</span>
                    <span className="text-lg font-bold text-green-400">{boschCount}</span>
                </Button>
            </div>

            {/* Time Filters */}
            <div className="flex items-center gap-2 overflow-x-auto pb-2">
                <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider mr-2 shrink-0">Período:</span>
                {['all', '1min', '5min', '30min'].map((t) => (
                    <button
                        key={t}
                        onClick={() => setTimeFilter(t as any)}
                        className={cn(
                            "px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all shrink-0",
                            timeFilter === t
                                ? "bg-blue-500 text-foreground"
                                : "bg-muted text-muted-foreground hover:bg-muted"
                        )}
                    >
                        {t === 'all' ? 'Todo' : t.replace('min', ' Min')}
                    </button>
                ))}
            </div>

            {/* Two Tables Side by Side */}
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                {/* Processed Events Table */}
                <div className="bg-card border border-border rounded-xl overflow-hidden">
                    <div className="p-4 border-b border-border flex justify-between items-center">
                        <h3 className="text-sm font-bold text-foreground uppercase tracking-wider">
                            Eventos Procesados
                            <span className="ml-2 text-muted-foreground">({filteredLogs.length})</span>
                        </h3>
                    </div>

                    <div className="max-h-[600px] overflow-y-auto custom-scrollbar">
                        {filteredLogs.length === 0 ? (
                            <div className="p-12 text-center">
                                <Activity size={48} className="mx-auto text-muted-foreground mb-4 animate-pulse" />
                                <h3 className="text-lg font-bold text-foreground mb-2 animate-pulse">
                                    Esperando webhooks...
                                </h3>
                                <p className="text-sm text-muted-foreground">
                                    Los eventos aparecerán aquí cuando los dispositivos envíen datos.
                                </p>
                            </div>
                        ) : (
                            <table className="w-full border-collapse">
                                <thead className="sticky top-0 bg-card border-b border-border z-10">
                                    <tr>
                                        <th className="text-left p-3 text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Hora</th>
                                        <th className="text-left p-3 text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Fuente</th>
                                        <th className="text-left p-3 text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Acceso?</th>
                                        <th className="text-left p-3 text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Dispositivo</th>
                                        <th className="text-center p-3 text-[10px] font-bold text-muted-foreground uppercase tracking-widest text-right">Status</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-neutral-800/50">
                                    {filteredLogs.map((log) => (
                                        <tr
                                            key={log.id}
                                            className={cn(
                                                "transition-colors cursor-pointer group",
                                                selectedEventId === log.id
                                                    ? "bg-blue-500/10"
                                                    : "hover:bg-muted/30"
                                            )}
                                            onClick={() => {
                                                setSelectedEventId(log.id);
                                                const rawElement = document.getElementById(`raw-${log.id}`);
                                                if (rawElement) {
                                                    rawElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                                }
                                            }}
                                        >
                                            <td className="p-3">
                                                <span className="text-xs font-mono text-muted-foreground whitespace-nowrap">
                                                    {hora(log.timestamp)}
                                                </span>
                                            </td>
                                            <td className="p-3">
                                                <Badge
                                                    variant="outline"
                                                    className={cn(
                                                        "text-[9px] font-bold px-1.5 py-0",
                                                        log.source === 'hikvision' && "bg-purple-500/10 text-purple-400 border-purple-500/20",
                                                        log.source === 'akuvox' && "bg-blue-500/10 text-blue-400 border-blue-500/20"
                                                    )}
                                                >
                                                    {log.source.toUpperCase()}
                                                </Badge>
                                            </td>
                                            <td className="p-3">
                                                <span className={cn(
                                                    "text-sm font-bold font-mono tracking-tighter flex items-center gap-1",
                                                    log.credentialValue === 'NO_LEIDA' ? "text-red-500 animate-pulse" :
                                                        log.credentialValue?.includes('DENY') ? "text-red-400" : "text-emerald-400"
                                                )}>
                                                    {log.credentialValue === 'NO_LEIDA' ? <><AlertTriangle size={14} /> NO LEIDA</> : (log.credentialValue || '---')}
                                                </span>
                                            </td>
                                            <td className="p-3">
                                                <div className="max-w-[120px]">
                                                    <p className="text-[11px] font-bold text-foreground truncate leading-tight">
                                                        {log.deviceName || 'Desconocido'}
                                                    </p>
                                                    <p className="text-[9px] text-muted-foreground font-mono truncate">
                                                        {log.deviceMac || '-'}
                                                    </p>
                                                </div>
                                            </td>
                                            <td className="p-3 text-right">
                                                {log.status === 200 ? (
                                                    <div className="w-2 h-2 rounded-full bg-emerald-500 ml-auto shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
                                                ) : (
                                                    <span className="text-[10px] font-bold text-red-500">{log.status}</span>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </div>
                </div>

                {/* Raw Data Table */}
                <div className="bg-card border border-border rounded-xl overflow-hidden">
                    <div className="p-4 border-b border-border">
                        <h3 className="text-sm font-bold text-foreground uppercase tracking-wider">
                            Datos RAW (Crudo)
                        </h3>
                    </div>

                    <div className="max-h-[600px] overflow-y-auto custom-scrollbar p-4 space-y-3">
                        {filteredLogs.length === 0 ? (
                            <div className="p-12 text-center opacity-30">
                                <Activity size={32} className="mx-auto mb-2" />
                                <p className="text-xs font-bold uppercase tracking-widest">Sin datos RAW</p>
                            </div>
                        ) : (
                            filteredLogs.map((log) => (
                                <div
                                    key={log.id}
                                    id={`raw-${log.id}`}
                                    className={cn(
                                        "rounded-lg p-3 transition-all border",
                                        selectedEventId === log.id
                                            ? "bg-muted border-blue-500/50 shadow-lg shadow-blue-500/5 scale-[1.01]"
                                            : "bg-black/20 border-neutral-800"
                                    )}
                                >
                                    <div className="flex items-center justify-between mb-2">
                                        <div className="flex items-center gap-2">
                                            <div className={cn(
                                                "w-1.5 h-1.5 rounded-full",
                                                log.source === 'hikvision' ? "bg-purple-500" : "bg-blue-500"
                                            )} />
                                            <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                                                {log.source} • {hora(log.timestamp)}
                                            </span>
                                        </div>
                                        <button
                                            onClick={() => {
                                                navigator.clipboard.writeText(JSON.stringify(log, null, 2));
                                            }}
                                            className="text-[9px] font-bold text-blue-500 hover:text-blue-400 uppercase tracking-widest"
                                        >
                                            Copiar
                                        </button>
                                    </div>
                                    <pre className="text-[10px] text-emerald-400 font-mono overflow-x-auto whitespace-pre-wrap leading-relaxed opacity-80">
                                        {JSON.stringify({
                                            url: log.url,
                                            params: log.params,
                                            device: log.deviceName,
                                            mac: log.deviceMac,
                                            value: log.credentialValue
                                        }, null, 2)}
                                    </pre>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

