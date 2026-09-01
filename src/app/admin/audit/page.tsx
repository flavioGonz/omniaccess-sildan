"use client";

import { useEffect, useState } from "react";
import {
    getDevices,
} from "@/app/actions/devices";
import {
    syncHardwareLogs,
    syncHardwareCallLogs,
    getDeviceAccessEvents,
    previewHardwareLogs,
    previewHardwareCallLogs,
    getDeviceDoorlogs,
    getDeviceCalllogs
} from "@/app/actions/deviceMemory";
import { Button } from "@/components/ui/button";
import {
    ShieldCheck,
    RefreshCw,
    HardDrive,
    Database,
    Zap,
    DownloadCloud,
    Search,
    History,
    CheckCircle2,
    XCircle,
    Clock,
    User as UserIcon,
    ArrowRightLeft,
    Network,
    Globe,
    Activity,
    Lock,
    Unlock,
    Eye,
    ChevronRight,
    AlertCircle,
    Camera,
    ChevronDown,
    PhoneCall,
    DoorClosed,
    Calendar,
    ScanFace,
    Filter,
    Wifi,
    WifiOff
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter
} from "@/components/ui/dialog";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import { Input } from "@/components/ui/input";

const TYPE_META: Record<string, { l: string; c: string; icon: any }> = {
    LPR_CAMERA: { l: "LPR", c: "#3b82f6", icon: Camera },
    FACE_TERMINAL: { l: "Facial", c: "#a855f7", icon: ScanFace },
    QUEUE_COUNTER: { l: "Fila", c: "#f59e0b", icon: Activity },
    DEFAULT: { l: "Otro", c: "#64748b", icon: Network },
};

export default function AuditPage() {
    const [devices, setDevices] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [syncing, setSyncing] = useState<string | null>(null);

    // DB Logs Inspector State
    const [selectedDeviceLogs, setSelectedDeviceLogs] = useState<any | null>(null);
    const [dbLogs, setDbLogs] = useState<any[]>([]);
    const [dbLogsLimit, setDbLogsLimit] = useState(50);
    const [hardwareDoorLogs, setHardwareDoorLogs] = useState<any[]>([]);
    const [doorLogsOffset, setDoorLogsOffset] = useState(0);
    const [hardwareCallLogs, setHardwareCallLogs] = useState<any[]>([]);
    const [callLogsOffset, setCallLogsOffset] = useState(0);
    const [loadingDbLogs, setLoadingDbLogs] = useState(false);
    const [loadingHardwareLogs, setLoadingHardwareLogs] = useState(false);
    const [logsDialogOpen, setLogsDialogOpen] = useState(false);

    // Filter State
    const [searchQuery, setSearchQuery] = useState("");
    const [filterDecision, setFilterDecision] = useState<string>("ALL");
    const [filterType, setFilterType] = useState<string>("ALL");

    // Device-list filter state (table)
    const [showFilters, setShowFilters] = useState(false);
    const [searchDev, setSearchDev] = useState("");
    const [filterBrand, setFilterBrand] = useState("");
    const [filterTypeDev, setFilterTypeDev] = useState("");
    const [filterStatus, setFilterStatus] = useState("");

    // Sync Preview State
    const [previewDevice, setPreviewDevice] = useState<any | null>(null);
    const [hardwarePreview, setHardwarePreview] = useState<any[]>([]);
    const [hardwareCallPreview, setHardwareCallPreview] = useState<any[]>([]);
    const [loadingPreview, setLoadingPreview] = useState(false);
    const [previewDialogOpen, setPreviewDialogOpen] = useState(false);

    const loadData = async () => {
        setLoading(true);
        try {
            const devs = await getDevices();
            setDevices(devs);
        } catch (error) {
            console.error("Error loading audit data:", error);
            toast.error("Error al cargar datos de auditoría");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadData();
    }, []);

    const handleOpenDbLogs = async (device: any) => {
        setSelectedDeviceLogs(device);
        setLogsDialogOpen(true);
        setLoadingDbLogs(true);
        setDbLogsLimit(50);
        setDoorLogsOffset(0);
        setCallLogsOffset(0);
        try {
            const logs = await getDeviceAccessEvents(device.id, 50);
            setDbLogs(logs);

            // Fetch hardware logs too for Akuvox
            if (device.brand === 'AKUVOX') {
                const hDoor = await getDeviceDoorlogs(device.id, 50, 0);
                const hCall = await getDeviceCalllogs(device.id, 50, 0);
                setHardwareDoorLogs(hDoor);
                setHardwareCallLogs(hCall);
            }
        } catch (error) {
            console.error(error);
            toast.error("Error al obtener logs");
        } finally {
            setLoadingDbLogs(false);
        }
    };

    const handleLoadMoreLogs = async () => {
        if (!selectedDeviceLogs) return;
        setLoadingDbLogs(true);
        try {
            const newLimit = dbLogsLimit + 50;
            const newLogs = await getDeviceAccessEvents(selectedDeviceLogs.id, newLimit);
            setDbLogs(newLogs);
            setDbLogsLimit(newLimit);
        } catch (error) {
            console.error(error);
            toast.error("Error al cargar más registros");
        } finally {
            setLoadingDbLogs(false);
        }
    };

    const handleLoadMoreHardwareDoorLogs = async () => {
        if (!selectedDeviceLogs) return;
        setLoadingHardwareLogs(true);
        try {
            const nextOffset = doorLogsOffset + 50;
            const moreLogs = await getDeviceDoorlogs(selectedDeviceLogs.id, 50, nextOffset);
            setHardwareDoorLogs(prev => [...prev, ...moreLogs]);
            setDoorLogsOffset(nextOffset);
        } catch (error) {
            console.error(error);
        } finally {
            setLoadingHardwareLogs(false);
        }
    };

    const handleLoadMoreHardwareCallLogs = async () => {
        if (!selectedDeviceLogs) return;
        setLoadingHardwareLogs(true);
        try {
            const nextOffset = callLogsOffset + 50;
            const moreLogs = await getDeviceCalllogs(selectedDeviceLogs.id, 50, nextOffset);
            setHardwareCallLogs(prev => [...prev, ...moreLogs]);
            setCallLogsOffset(nextOffset);
        } catch (error) {
            console.error(error);
        } finally {
            setLoadingHardwareLogs(false);
        }
    };

    const handleOpenPreview = async (device: any) => {
        setPreviewDevice(device);
        setPreviewDialogOpen(true);
        setLoadingPreview(true);
        try {
            const [doorPreview, callPreview] = await Promise.all([
                previewHardwareLogs(device.id),
                previewHardwareCallLogs(device.id)
            ]);
            setHardwarePreview(doorPreview);
            setHardwareCallPreview(callPreview);
        } catch (error) {
            console.error(error);
            toast.error("Error al consultar memoria del hardware");
            setPreviewDialogOpen(false);
        } finally {
            setLoadingPreview(false);
        }
    };

    const handleSync = async (deviceId: string) => {
        setSyncing(deviceId);
        try {
            const [resDoor, resCall] = await Promise.all([
                syncHardwareLogs(deviceId),
                syncHardwareCallLogs(deviceId)
            ]);

            if (resDoor.success || resCall.success) {
                const total = (resDoor.count || 0) + (resCall.count || 0);
                toast.success(`Sincronizados ${total} eventos (Door: ${resDoor.count || 0}, Call: ${resCall.count || 0})`);
                if (selectedDeviceLogs) handleOpenDbLogs(selectedDeviceLogs);
                setPreviewDialogOpen(false);
            } else {
                toast.error("Error al sincronizar");
            }
        } catch (error) {
            console.error(error);
            toast.error("Error al sincronizar con el dispositivo");
        } finally {
            setSyncing(null);
        }
    };

    const filteredDbLogs = dbLogs.filter(log => {
        const matchesSearch =
            (log.user?.name || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
            (log.plateDetected || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
            (log.details || "").toLowerCase().includes(searchQuery.toLowerCase());

        const matchesDecision = filterDecision === "ALL" || log.decision === filterDecision;
        const matchesType = filterType === "ALL" || log.accessType === filterType;

        return matchesSearch && matchesDecision && matchesType;
    });

    const filteredDoorLogs = hardwareDoorLogs.filter(log => {
        const matchesSearch =
            (log.Name || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
            (log.Card || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
            (log.Event || "").toLowerCase().includes(searchQuery.toLowerCase());

        const matchesDecision = filterDecision === "ALL" ||
            (filterDecision === "GRANT" && log.Status === "1") ||
            (filterDecision === "DENY" && log.Status === "0");

        return matchesSearch && matchesDecision;
    });

    const exportToCSV = (data: any[], filename: string) => {
        if (data.length === 0) {
            toast.error("No hay datos para exportar");
            return;
        }

        const headers = Object.keys(data[0]);
        const csvContent = [
            headers.join(","),
            ...data.map(row =>
                headers.map(header => {
                    const value = row[header] ?? "";
                    return typeof value === 'string' ? `"${value.replace(/"/g, '""')}"` : value;
                }).join(",")
            )
        ].join("\n");

        const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
        const link = document.createElement("a");
        const url = URL.createObjectURL(blob);
        link.setAttribute("href", url);
        link.setAttribute("download", `${filename}_${new Date().toISOString().split('T')[0]}.csv`);
        link.style.visibility = "hidden";
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const handleDownloadDoorlogs = async () => {
        if (!selectedDeviceLogs) return;
        setLoadingHardwareLogs(true);
        try {
            // Fetch a larger set for export (e.g., last 500)
            const allLogs = await getDeviceDoorlogs(selectedDeviceLogs.id, 500, 0);
            exportToCSV(allLogs, `Doorlog_${selectedDeviceLogs.name}`);
            toast.success("Doorlog exportado correctamente");
        } catch (error) {
            console.error(error);
            toast.error("Error al exportar doorlog");
        } finally {
            setLoadingHardwareLogs(false);
        }
    };

    const handleDownloadCalllogs = async () => {
        if (!selectedDeviceLogs) return;
        setLoadingHardwareLogs(true);
        try {
            const allLogs = await getDeviceCalllogs(selectedDeviceLogs.id, 500, 0);
            exportToCSV(allLogs, `Calllog_${selectedDeviceLogs.name}`);
            toast.success("Calllog exportado correctamente");
        } catch (error) {
            console.error(error);
            toast.error("Error al exportar calllog");
        } finally {
            setLoadingHardwareLogs(false);
        }
    };

    const filteredCallLogs = hardwareCallLogs.filter(log => {
        const matchesSearch =
            (log.CallerName || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
            (log.CallerID || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
            (log.CalleeName || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
            (log.CalleeID || "").toLowerCase().includes(searchQuery.toLowerCase());

        return matchesSearch;
    });

    const isDevOnline = (d: any) => (Date.now() - new Date(d.lastOnlinePull || 0).getTime()) < 300000;
    const onlineCount = devices.filter(isDevOnline).length;
    const syncableCount = devices.filter(d => d.brand === 'AKUVOX').length;
    const brands = Array.from(new Set(devices.map(d => d.brand).filter(Boolean)));
    const filteredDevices = devices.filter(d => {
        const q = searchDev.toLowerCase();
        const matchesSearch = !q || (d.name || "").toLowerCase().includes(q) || (d.ip || "").toLowerCase().includes(q);
        const matchesBrand = !filterBrand || d.brand === filterBrand;
        const matchesType = !filterTypeDev || d.deviceType === filterTypeDev;
        const matchesStatus = !filterStatus || (filterStatus === "online" ? isDevOnline(d) : !isDevOnline(d));
        return matchesSearch && matchesBrand && matchesType && matchesStatus;
    });

    return (
        <TooltipProvider>
            <div className="p-6 space-y-4 animate-in fade-in duration-500">
                {/* HEADER */}
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
                            <ShieldCheck size={18} className="text-blue-400" />
                        </div>
                        <div>
                            <h1 className="text-2xl font-bold text-foreground">Auditoria de Hardware</h1>
                            <p className="text-[11px] text-muted-foreground font-mono">{devices.length} dispositivos - registros locales y sincronizacion</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                        <Button variant="ghost" size="sm" onClick={() => setShowFilters(x => !x)}
                            className={cn("h-8 gap-1.5 text-xs", showFilters ? "text-blue-400" : "text-muted-foreground hover:text-foreground")}>
                            <Filter size={12} /> Filtros
                        </Button>
                        <Button variant="ghost" size="sm" onClick={loadData} disabled={loading} className="h-8 text-muted-foreground hover:text-foreground">
                            <RefreshCw size={12} className={cn(loading && "animate-spin")} />
                        </Button>
                    </div>
                </div>

                {/* KPIs */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                    <div className="rounded-xl border border-border bg-foreground/[0.04] p-4"><div className="flex items-center gap-1.5 text-[9px] text-muted-foreground font-mono uppercase mb-1"><HardDrive size={11} /> Dispositivos</div><div className="text-2xl font-bold text-foreground/80 tabular-nums">{devices.length}</div></div>
                    <div className="rounded-xl border border-emerald-500/10 bg-emerald-500/[0.03] p-4"><div className="flex items-center gap-1.5 text-[9px] text-emerald-400/60 font-mono uppercase mb-1"><Wifi size={11} /> En linea</div><div className="text-2xl font-bold text-emerald-400 tabular-nums">{onlineCount}</div></div>
                    <div className="rounded-xl border border-rose-500/10 bg-rose-500/[0.03] p-4"><div className="flex items-center gap-1.5 text-[9px] text-rose-400/60 font-mono uppercase mb-1"><WifiOff size={11} /> Sin link</div><div className="text-2xl font-bold text-rose-400 tabular-nums">{devices.length - onlineCount}</div></div>
                    <div className="rounded-xl border border-blue-500/10 bg-blue-500/[0.03] p-4"><div className="flex items-center gap-1.5 text-[9px] text-blue-400/60 font-mono uppercase mb-1"><DownloadCloud size={11} /> Sincronizables</div><div className="text-2xl font-bold text-blue-400 tabular-nums">{syncableCount}</div></div>
                </div>

                {/* FILTERS */}
                {showFilters && (
                    <div className="rounded-xl border border-blue-500/10 bg-blue-500/[0.02] p-4 space-y-3 animate-in fade-in slide-in-from-top-1 duration-200">
                        <div className="flex items-center gap-2 mb-1"><Filter size={12} className="text-blue-400" /><span className="text-[10px] text-blue-400/70 font-mono uppercase tracking-wider">Filtros</span></div>
                        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                            <div>
                                <label className="text-[9px] text-muted-foreground font-mono uppercase block mb-1">Buscar</label>
                                <div className="relative">
                                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" size={12} />
                                    <Input value={searchDev} onChange={e => setSearchDev(e.target.value)} placeholder="Nombre o IP..." className="h-8 text-xs bg-foreground/10 border-border pl-8" />
                                </div>
                            </div>
                            <div>
                                <label className="text-[9px] text-muted-foreground font-mono uppercase block mb-1">Marca</label>
                                <select value={filterBrand} onChange={e => setFilterBrand(e.target.value)} className="w-full h-8 text-xs bg-foreground/10 border border-border rounded-md px-2 text-foreground">
                                    <option value="">Todas</option>
                                    {brands.map(b => <option key={b} value={b}>{b}</option>)}
                                </select>
                            </div>
                            <div>
                                <label className="text-[9px] text-muted-foreground font-mono uppercase block mb-1">Tipo</label>
                                <select value={filterTypeDev} onChange={e => setFilterTypeDev(e.target.value)} className="w-full h-8 text-xs bg-foreground/10 border border-border rounded-md px-2 text-foreground">
                                    <option value="">Todos</option>
                                    <option value="LPR_CAMERA">LPR</option>
                                    <option value="FACE_TERMINAL">Facial</option>
                                    <option value="QUEUE_COUNTER">Fila</option>
                                </select>
                            </div>
                            <div>
                                <label className="text-[9px] text-muted-foreground font-mono uppercase block mb-1">Estado</label>
                                <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="w-full h-8 text-xs bg-foreground/10 border border-border rounded-md px-2 text-foreground">
                                    <option value="">Todos</option>
                                    <option value="online">En linea</option>
                                    <option value="offline">Sin link</option>
                                </select>
                            </div>
                        </div>
                        {(searchDev || filterBrand || filterTypeDev || filterStatus) && (
                            <Button variant="ghost" size="sm" onClick={() => { setSearchDev(""); setFilterBrand(""); setFilterTypeDev(""); setFilterStatus(""); }} className="text-[10px] text-muted-foreground hover:text-foreground h-6"><XCircle size={10} className="mr-1" /> Limpiar filtros</Button>
                        )}
                    </div>
                )}

                {/* DEVICE TABLE */}
                <div className="rounded-xl border border-border bg-foreground/[0.04] overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead>
                                <tr className="border-b border-border bg-foreground/[0.04]">
                                    <th className="text-left text-[9px] text-muted-foreground font-mono uppercase tracking-wider px-3 py-2.5">Dispositivo</th>
                                    <th className="text-left text-[9px] text-muted-foreground font-mono uppercase tracking-wider px-3 py-2.5">Tipo</th>
                                    <th className="text-left text-[9px] text-muted-foreground font-mono uppercase tracking-wider px-3 py-2.5">IP</th>
                                    <th className="text-left text-[9px] text-muted-foreground font-mono uppercase tracking-wider px-3 py-2.5">Ubicacion</th>
                                    <th className="text-left text-[9px] text-muted-foreground font-mono uppercase tracking-wider px-3 py-2.5">Estado</th>
                                    <th className="text-left text-[9px] text-muted-foreground font-mono uppercase tracking-wider px-3 py-2.5">Ultima sincro</th>
                                    <th className="text-right text-[9px] text-muted-foreground font-mono uppercase tracking-wider px-3 py-2.5">Acciones</th>
                                </tr>
                            </thead>
                            <tbody>
                                {loading ? (
                                    <tr><td colSpan={7} className="px-4 py-12 text-center"><div className="flex flex-col items-center gap-2"><RefreshCw className="w-6 h-6 text-muted-foreground animate-spin" /><span className="text-sm text-muted-foreground">Cargando...</span></div></td></tr>
                                ) : filteredDevices.length === 0 ? (
                                    <tr><td colSpan={7} className="px-4 py-12 text-center"><div className="flex flex-col items-center gap-2"><HardDrive className="w-8 h-8 text-muted-foreground" /><span className="text-sm text-muted-foreground">No hay dispositivos{searchDev || filterBrand || filterTypeDev || filterStatus ? " con esos filtros" : ""}</span></div></td></tr>
                                ) : filteredDevices.map(dev => {
                                    const isOnline = isDevOnline(dev);
                                    const canSync = dev.brand === 'AKUVOX';
                                    const t = TYPE_META[dev.deviceType] || TYPE_META.DEFAULT;
                                    const TIcon = t.icon;
                                    return (
                                        <tr key={dev.id} className="border-b border-border last:border-0 hover:bg-foreground/[0.03] transition-colors">
                                            <td className="px-3 py-2">
                                                <div className="flex items-center gap-2.5">
                                                    <div className="w-9 h-9 rounded-lg bg-background border border-border flex items-center justify-center overflow-hidden shrink-0">
                                                        {dev.modelPhoto ? <img src={dev.modelPhoto} className="w-full h-full object-cover" alt="" /> : dev.brandLogo ? <img src={dev.brandLogo} className="w-full h-full object-contain p-1.5 opacity-70" alt="" /> : <Network className="text-muted-foreground" size={16} />}
                                                    </div>
                                                    <div className="min-w-0">
                                                        <p className="text-[12px] font-semibold text-foreground truncate leading-tight">{dev.name}</p>
                                                        <span className="text-[10px] font-mono text-muted-foreground">{dev.brand}</span>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="px-3 py-2"><span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-md" style={{ background: `${t.c}14`, color: t.c }}><TIcon size={11} /> {t.l}</span></td>
                                            <td className="px-3 py-2"><span className="text-[11px] font-mono text-muted-foreground">{dev.ip}</span></td>
                                            <td className="px-3 py-2"><span className="inline-flex items-center gap-1 text-[11px] text-foreground/80"><Globe size={11} className="text-muted-foreground" /> {dev.location || "-"}</span></td>
                                            <td className="px-3 py-2">
                                                <span className={cn("inline-flex items-center gap-1.5 text-[10px] font-medium px-2 py-0.5 rounded-full", isOnline ? "bg-emerald-500/10 text-emerald-400" : "bg-rose-500/10 text-rose-400")}>
                                                    <span className={cn("w-1.5 h-1.5 rounded-full", isOnline ? "bg-emerald-400 animate-pulse" : "bg-rose-500")} /> {isOnline ? "En linea" : "Sin link"}
                                                </span>
                                            </td>
                                            <td className="px-3 py-2"><span className="text-[10px] font-mono text-muted-foreground">{dev.lastOnlinePull ? new Date(dev.lastOnlinePull).toLocaleString() : "-"}</span></td>
                                            <td className="px-3 py-2">
                                                <div className="flex items-center justify-end gap-1.5">
                                                    <Tooltip><TooltipTrigger asChild>
                                                        <button onClick={() => handleOpenDbLogs(dev)} className="w-8 h-8 rounded-lg bg-card border border-border flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition"><Eye size={15} /></button>
                                                    </TooltipTrigger><TooltipContent className="text-[10px]">Ver logs en DB</TooltipContent></Tooltip>
                                                    <Tooltip><TooltipTrigger asChild>
                                                        <button onClick={() => handleOpenPreview(dev)} disabled={!canSync || syncing === dev.id} className={cn("w-8 h-8 rounded-lg flex items-center justify-center transition", canSync ? "bg-blue-600 text-white hover:bg-blue-500" : "bg-card text-muted-foreground/40 border border-border cursor-not-allowed")}>{syncing === dev.id ? <RefreshCw size={15} className="animate-spin" /> : <DownloadCloud size={15} />}</button>
                                                    </TooltipTrigger><TooltipContent className="text-[10px]">{canSync ? "Sincronizar memoria" : "No disponible"}</TooltipContent></Tooltip>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* Dialog: DB Logs Viewer */}
                <Dialog open={logsDialogOpen} onOpenChange={setLogsDialogOpen}>
                    <DialogContent className="max-w-5xl h-[85vh] flex flex-col bg-background border border-border p-0 overflow-hidden shadow-[0_0_50px_rgba(0,0,0,0.5)] rounded-3xl">
                        <DialogHeader className="p-6 pb-4 border-b border-border bg-card/40 shrink-0">
                            <div className="flex items-center justify-between gap-4">
                                <div className="flex items-center gap-4">
                                    <div className="p-3 bg-blue-500/10 rounded-2xl border border-blue-500/20">
                                        <Database className="text-blue-400" size={20} />
                                    </div>
                                    <div className="flex-1">
                                        <DialogTitle className="text-xl font-bold text-foreground uppercase tracking-tight">Inspector de Eventos</DialogTitle>
                                        <DialogDescription className="text-muted-foreground text-[10px] font-bold uppercase tracking-widest">
                                            Historial para {selectedDeviceLogs?.name} • Registros en Tiempo Real
                                        </DialogDescription>
                                    </div>
                                </div>

                                <Tabs defaultValue="db" className="h-10">
                                    <TabsList className="bg-card border border-border p-1 h-10">
                                        <TabsTrigger value="db" className="text-[10px] px-5 font-bold uppercase tracking-widest data-[state=active]:bg-blue-600 data-[state=active]:text-foreground rounded-lg transition-all">
                                            Base de Datos
                                        </TabsTrigger>
                                        {selectedDeviceLogs?.brand === 'AKUVOX' && (
                                            <div className="flex items-center gap-2">
                                                <TabsTrigger value="door" className="text-[10px] px-5 font-bold uppercase tracking-widest data-[state=active]:bg-blue-600 data-[state=active]:text-foreground rounded-lg transition-all">
                                                    Doorlog
                                                </TabsTrigger>
                                                <TabsTrigger value="call" className="text-[10px] px-5 font-bold uppercase tracking-widest data-[state=active]:bg-blue-600 data-[state=active]:text-foreground rounded-lg transition-all">
                                                    Calllog
                                                </TabsTrigger>
                                            </div>
                                        )}
                                    </TabsList>
                                </Tabs>

                                {selectedDeviceLogs?.brand === 'AKUVOX' && (
                                    <div className="flex items-center gap-2">
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={handleDownloadDoorlogs}
                                            disabled={loadingHardwareLogs}
                                            className="h-8 bg-emerald-600/10 border-emerald-500/20 text-emerald-500 hover:bg-emerald-600 hover:text-foreground text-[9px] font-bold uppercase rounded-lg"
                                        >
                                            <DownloadCloud size={12} className="mr-1.5" />
                                            Exportar CSV
                                        </Button>
                                    </div>
                                )}
                            </div>
                        </DialogHeader>

                        <div className="flex-1 flex flex-col min-h-0">
                            {/* Search and Filters Strip */}
                            <div className="px-6 py-3 border-b border-border bg-black/40 flex flex-wrap items-center gap-4 shrink-0">
                                <div className="relative flex-1 min-w-[200px]">
                                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={14} />
                                    <Input
                                        placeholder="Buscar por usuario, patente o detalle..."
                                        className="pl-10 h-10 bg-card border-border text-[11px] font-bold uppercase"
                                        value={searchQuery}
                                        onChange={(e) => setSearchQuery(e.target.value)}
                                    />
                                </div>
                                <div className="flex items-center gap-2">
                                    <select
                                        className="h-10 bg-card border border-border rounded-xl px-3 text-[10px] font-bold uppercase text-muted-foreground focus:outline-none"
                                        value={filterDecision}
                                        onChange={(e) => setFilterDecision(e.target.value)}
                                    >
                                        <option value="ALL">Todas las Decisiones</option>
                                        <option value="GRANT">Éxito</option>
                                        <option value="DENY">Denegado</option>
                                    </select>
                                    <select
                                        className="h-10 bg-card border border-border rounded-xl px-3 text-[10px] font-bold uppercase text-muted-foreground focus:outline-none"
                                        value={filterType}
                                        onChange={(e) => setFilterType(e.target.value)}
                                    >
                                        <option value="ALL">Todos los Tipos</option>
                                        <option value="FACE">Facial</option>
                                        <option value="TAG">RFID / Tag</option>
                                        <option value="PLATE">Patente</option>
                                        <option value="PIN">Código PIN</option>
                                    </select>
                                </div>
                                <div className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest px-2">
                                    {filteredDbLogs.length} Resultados
                                </div>
                            </div>

                            <Tabs defaultValue="db" className="flex-1 flex flex-col min-h-0">
                                <TabsContent value="db" className="flex-1 h-full m-0 outline-none overflow-hidden">
                                    <div className="h-full overflow-auto custom-scrollbar">
                                        {loadingDbLogs ? (
                                            <div className="h-full flex flex-col items-center justify-center gap-4 opacity-50">
                                                <RefreshCw className="animate-spin text-blue-500" size={32} />
                                                <p className="text-[10px] font-bold uppercase text-muted-foreground tracking-widest">Consultando DB...</p>
                                            </div>
                                        ) : filteredDbLogs.length === 0 ? (
                                            <div className="h-full flex flex-col items-center justify-center gap-4 opacity-30">
                                                <History size={48} />
                                                <p className="text-[10px] font-bold uppercase tracking-widest">Sin registros encontrados con estos filtros</p>
                                            </div>
                                        ) : (
                                            <Table>
                                                <TableHeader className="bg-card/50 sticky top-0 z-10 border-b border-border backdrop-blur-md">
                                                    <TableRow className="hover:bg-transparent border-none">
                                                        <th className="text-[9px] font-bold text-muted-foreground uppercase p-4">Captura</th>
                                                        <th className="text-[9px] font-bold text-muted-foreground uppercase p-4 text-left">Sujeto / Identidad</th>
                                                        <th className="text-[9px] font-bold text-muted-foreground uppercase p-4 text-center">Tipo</th>
                                                        <th className="text-[9px] font-bold text-muted-foreground uppercase p-4">Fecha / Hora</th>
                                                        <th className="text-[9px] font-bold text-muted-foreground uppercase p-4 text-right">Resultado</th>
                                                    </TableRow>
                                                </TableHeader>
                                                <TableBody>
                                                    {filteredDbLogs.map((log) => (
                                                        <TableRow key={log.id} className="group/log border-b border-white/[0.03] hover:bg-blue-600/[0.02] transition-colors">
                                                            <TableCell className="p-4">
                                                                <div className="relative w-16 h-16 rounded-2xl bg-card border border-border overflow-hidden mx-auto cursor-pointer group/thumb hover:ring-2 hover:ring-blue-500/50 shadow-lg transition-all duration-500">
                                                                    {log.snapshotPath || log.imagePath ? (
                                                                        <>
                                                                            <img
                                                                                src={log.snapshotPath || log.imagePath}
                                                                                alt=""
                                                                                className="w-full h-full object-cover transition-transform duration-500 group-hover/thumb:scale-125"
                                                                            />
                                                                            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover/thumb:opacity-100 flex items-center justify-center transition-opacity">
                                                                                <Eye size={16} className="text-foreground" />
                                                                            </div>
                                                                        </>
                                                                    ) : (
                                                                        <div className="w-full h-full flex items-center justify-center text-muted-foreground bg-background/50">
                                                                            <Camera size={20} className="opacity-20" />
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            </TableCell>
                                                            <TableCell className="p-4">
                                                                <div className="flex flex-col gap-1.5">
                                                                    <span className="font-bold text-foreground uppercase text-sm tracking-tight group-hover/log:text-blue-400 transition-colors">
                                                                        {log.userName || log.plateNumber || 'Evento Sin Identificar'}
                                                                    </span>
                                                                    <div className="flex items-center gap-2">
                                                                        <Badge className="bg-card text-muted-foreground border-border text-[9px] font-bold p-0 px-2 h-4 rounded-md">ID: {log.userId || log.id.slice(0, 8)}</Badge>
                                                                        {log.confidence && (
                                                                            <span className="text-[9px] font-bold text-blue-500 uppercase tracking-widest">{log.confidence}% SIMIL.</span>
                                                                        )}
                                                                    </div>
                                                                </div>
                                                            </TableCell>
                                                            <TableCell className="p-4 text-center">
                                                                <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-card border border-border rounded-lg">
                                                                    {log.authMethod === 'FACE' ? <ScanFace size={12} className="text-blue-400" /> :
                                                                        log.authMethod === 'PLATE' ? <Camera size={12} className="text-emerald-400" /> :
                                                                            <Lock size={12} className="text-muted-foreground" />}
                                                                    <span className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest">{log.authMethod || 'MÉTODO'}</span>
                                                                </div>
                                                            </TableCell>
                                                            <TableCell className="p-4 text-center">
                                                                <div className="flex flex-col gap-1">
                                                                    <div className="flex items-center gap-2 justify-center">
                                                                        <Calendar size={12} className="text-muted-foreground" />
                                                                        <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-tighter">{new Date(log.timestamp).toLocaleDateString()}</span>
                                                                    </div>
                                                                    <div className="flex items-center gap-2 justify-center">
                                                                        <Clock size={12} className="text-blue-500/40" />
                                                                        <span className="text-sm font-mono font-bold text-foreground">{new Date(log.timestamp).toLocaleTimeString()}</span>
                                                                    </div>
                                                                </div>
                                                            </TableCell>
                                                            <TableCell className="p-4 text-right">
                                                                <div className={cn(
                                                                    "inline-flex flex-col items-center gap-1 px-4 py-1.5 rounded-xl border transition-all",
                                                                    log.decision === "GRANT"
                                                                        ? "bg-emerald-600/10 text-emerald-400 border-emerald-500/20 shadow-[0_0_15px_rgba(16,185,129,0.05)]"
                                                                        : "bg-rose-600/10 text-rose-400 border-rose-500/20"
                                                                )}>
                                                                    <div className={cn("w-1 h-1 rounded-full", log.decision === 'GRANT' ? "bg-emerald-400 animate-pulse" : "bg-rose-400")} />
                                                                    <span className="text-[10px] font-bold uppercase tracking-widest">{log.decision === 'GRANT' ? 'Paso Concedido' : 'Bloqueado'}</span>
                                                                </div>
                                                            </TableCell>
                                                        </TableRow>
                                                    ))}
                                                </TableBody>
                                            </Table>
                                        )}
                                    </div>
                                </TabsContent>

                                <TabsContent value="door" className="flex-1 h-full m-0 outline-none overflow-hidden">
                                    <div className="h-full overflow-auto custom-scrollbar">
                                        {filteredDoorLogs.length === 0 ? (
                                            <div className="h-full flex flex-col items-center justify-center gap-4 opacity-30">
                                                <DoorClosed size={48} />
                                                <p className="text-[10px] font-bold uppercase tracking-widest">Sin coincidencias en el hardware</p>
                                            </div>
                                        ) : (
                                            <Table>
                                                <TableHeader className="bg-card/50 sticky top-0 z-10 border-b border-border backdrop-blur-md">
                                                    <TableRow className="border-none">
                                                        <th className="text-[9px] font-bold text-muted-foreground uppercase p-4 text-left">Sujeto / Identidad</th>
                                                        <th className="text-[9px] font-bold text-muted-foreground uppercase p-4 text-center">Modo / Evento</th>
                                                        <th className="text-[9px] font-bold text-muted-foreground uppercase p-4 text-right">Hora</th>
                                                    </TableRow>
                                                </TableHeader>
                                                <TableBody>
                                                    {filteredDoorLogs.map((log, idx) => (
                                                        <TableRow key={idx} className="border-border hover:bg-foreground/[0.04]">
                                                            <TableCell className="p-4">
                                                                <div className="flex items-center gap-4">
                                                                    <div className="w-12 h-12 rounded-xl bg-background border border-border flex items-center justify-center overflow-hidden shrink-0">
                                                                        {(log.PicUrl || log.PicPath) ? (
                                                                            <img
                                                                                src={`/api/proxy/device-image?deviceId=${selectedDeviceLogs?.id}&path=${encodeURIComponent(log.PicUrl || log.PicPath)}`}
                                                                                alt=""
                                                                                className="w-full h-full object-cover"
                                                                                onError={(e) => {
                                                                                    const target = e.target as HTMLImageElement;
                                                                                    target.style.display = 'none';
                                                                                    target.parentElement?.querySelector('.fallback')?.classList.remove('hidden');
                                                                                }}
                                                                            />
                                                                        ) : null}
                                                                        <div className={cn("fallback flex items-center justify-center", (log.PicUrl || log.PicPath) ? "hidden" : "")}>
                                                                            <Camera size={18} className="text-muted-foreground" />
                                                                        </div>
                                                                    </div>
                                                                    <div>
                                                                        <p className="text-[13px] font-bold text-foreground uppercase tracking-tight">{log.Name || "Desconocido"}</p>
                                                                        <p className="text-[9px] font-bold text-muted-foreground uppercase mt-0.5">{log.Card || 'Sin ID'}</p>
                                                                    </div>
                                                                </div>
                                                            </TableCell>
                                                            <TableCell className="p-4 text-center">
                                                                <div className="flex flex-col items-center gap-1">
                                                                    <Badge variant="outline" className={cn(
                                                                        "text-[8px] font-bold uppercase px-2 py-0.5",
                                                                        log.Status === "1" ? "text-emerald-500 border-emerald-500/20 bg-emerald-500/5" : "text-rose-500 border-rose-500/20 bg-rose-500/5"
                                                                    )}>
                                                                        {log.Event || 'ACCESO'}
                                                                    </Badge>
                                                                    <p className="text-[8px] font-bold text-muted-foreground uppercase tracking-widest">{log.Mode || 'BIO'}</p>
                                                                </div>
                                                            </TableCell>
                                                            <TableCell className="p-4 text-right text-[10px] font-mono text-muted-foreground">{log.Time}</TableCell>
                                                        </TableRow>
                                                    ))}
                                                </TableBody>
                                            </Table>
                                        )}
                                        {hardwareDoorLogs.length > 0 && hardwareDoorLogs.length % 50 === 0 && (
                                            <div className="p-8 flex justify-center border-t border-border bg-black/20">
                                                <Button
                                                    onClick={handleLoadMoreHardwareDoorLogs}
                                                    disabled={loadingHardwareLogs}
                                                    variant="outline"
                                                    className="bg-card border-border text-muted-foreground hover:text-foreground font-bold uppercase tracking-widest text-[9px] h-10 px-8 rounded-xl"
                                                >
                                                    {loadingHardwareLogs ? <RefreshCw size={12} className="animate-spin mr-2" /> : <ChevronDown size={14} className="mr-2" />}
                                                    Cargar más logs de Hardware
                                                </Button>
                                            </div>
                                        )}
                                    </div>
                                </TabsContent>

                                <TabsContent value="call" className="flex-1 h-full m-0 outline-none overflow-hidden">
                                    <div className="h-full overflow-auto custom-scrollbar">
                                        {filteredCallLogs.length === 0 ? (
                                            <div className="h-full flex flex-col items-center justify-center gap-4 opacity-30">
                                                <PhoneCall size={48} />
                                                <p className="text-[10px] font-bold uppercase tracking-widest">Sin coincidencias de llamadas</p>
                                            </div>
                                        ) : (
                                            <Table>
                                                <TableHeader className="bg-card/50 sticky top-0 z-10 border-b border-border backdrop-blur-md">
                                                    <TableRow className="border-none">
                                                        <th className="text-[9px] font-bold text-muted-foreground uppercase p-4">De</th>
                                                        <th className="text-[9px] font-bold text-muted-foreground uppercase p-4">Hacia</th>
                                                        <th className="text-[9px] font-bold text-muted-foreground uppercase p-4 text-center">Estado</th>
                                                        <th className="text-[9px] font-bold text-muted-foreground uppercase p-4 text-right">Hora / Duración</th>
                                                    </TableRow>
                                                </TableHeader>
                                                <TableBody>
                                                    {filteredCallLogs.map((log, idx) => (
                                                        <TableRow key={idx} className="border-border hover:bg-foreground/[0.04]">
                                                            <TableCell className="p-4">
                                                                <p className="text-[13px] font-bold text-foreground uppercase tracking-tight">{log.CallerName || "EXTERNO"}</p>
                                                                <p className="text-[8px] font-bold text-muted-foreground uppercase">{log.CallerID}</p>
                                                            </TableCell>
                                                            <TableCell className="p-4">
                                                                <p className="text-[13px] font-bold text-foreground uppercase tracking-tight">{log.CalleeName || "CONSERJERÍA"}</p>
                                                                <p className="text-[8px] font-bold text-muted-foreground uppercase">{log.CalleeID}</p>
                                                            </TableCell>
                                                            <TableCell className="p-4 text-center">
                                                                <Badge className="bg-background border border-border text-[8px] font-bold uppercase tracking-widest text-blue-400 px-3 py-1.5 rounded-xl">
                                                                    {log.Result}
                                                                </Badge>
                                                            </TableCell>
                                                            <TableCell className="p-4 text-right">
                                                                <p className="text-[10px] font-mono text-muted-foreground">{log.Time}</p>
                                                                <p className="text-[12px] font-mono font-bold text-foreground">{log.TalkTime}s</p>
                                                            </TableCell>
                                                        </TableRow>
                                                    ))}
                                                </TableBody>
                                            </Table>
                                        )}
                                        {hardwareCallLogs.length > 0 && hardwareCallLogs.length % 50 === 0 && (
                                            <div className="p-8 flex justify-center border-t border-border bg-black/20">
                                                <Button
                                                    onClick={handleLoadMoreHardwareCallLogs}
                                                    disabled={loadingHardwareLogs}
                                                    variant="outline"
                                                    className="bg-card border-border text-muted-foreground hover:text-foreground font-bold uppercase tracking-widest text-[9px] h-10 px-8 rounded-xl"
                                                >
                                                    {loadingHardwareLogs ? <RefreshCw size={12} className="animate-spin mr-2" /> : <ChevronDown size={14} className="mr-2" />}
                                                    Cargar más llamadas de Hardware
                                                </Button>
                                            </div>
                                        )}
                                    </div>
                                </TabsContent>
                            </Tabs>
                        </div>

                        <DialogFooter className="p-5 bg-black/40 border-t border-border shrink-0">
                            <Button onClick={() => setLogsDialogOpen(false)} className="bg-card hover:bg-white hover:text-black border border-border text-foreground font-bold uppercase text-[10px] tracking-widest px-10 h-11 rounded-2xl transition-all">Cerrar Inspector</Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>

                {/* Dialog: Sync Preview Comparison */}
                <Dialog open={previewDialogOpen} onOpenChange={setPreviewDialogOpen}>
                    <DialogContent className="max-w-5xl bg-background border-border p-0 overflow-hidden shadow-lg rounded-3xl">
                        <DialogHeader className="p-8 pb-4 border-b border-border bg-card/20">
                            <div className="flex items-center gap-4">
                                <div className="p-3 bg-orange-500/10 rounded-2xl border border-orange-500/20">
                                    <ArrowRightLeft className="text-orange-400" size={24} />
                                </div>
                                <div className="flex-1">
                                    <DialogTitle className="text-2xl font-bold text-foreground uppercase tracking-tight">Sincronización de Memoria</DialogTitle>
                                    <DialogDescription className="text-muted-foreground text-[10px] font-bold uppercase tracking-widest mt-1">
                                        Comparando hardware físico con base de datos local • {previewDevice?.name}
                                    </DialogDescription>
                                </div>
                            </div>
                        </DialogHeader>
                        <div className="h-[450px] overflow-auto custom-scrollbar p-6">
                            {loadingPreview ? (
                                <div className="h-full flex flex-col items-center justify-center gap-6">
                                    <div className="w-16 h-16 border-4 border-blue-500/20 border-t-blue-500 rounded-full animate-spin" />
                                    <p className="text-[10px] font-bold uppercase text-muted-foreground tracking-[0.3em] animate-pulse">Escaneando memoria física...</p>
                                </div>
                            ) : (
                                <div className="space-y-6">
                                    <Tabs defaultValue="door" className="h-full flex flex-col">
                                        <TabsList className="flex gap-2 p-1 bg-foreground/10 rounded-xl mb-6 w-fit h-auto">
                                            <TabsTrigger value="door" className="text-[10px] font-bold uppercase px-4 py-2 data-[state=active]:bg-orange-500 data-[state=active]:text-foreground rounded-lg transition-all">Accesos ({hardwarePreview.length})</TabsTrigger>
                                            <TabsTrigger value="call" className="text-[10px] font-bold uppercase px-4 py-2 data-[state=active]:bg-blue-500 data-[state=active]:text-foreground rounded-lg transition-all">Llamadas ({hardwareCallPreview.length})</TabsTrigger>
                                        </TabsList>

                                        <TabsContent value="door" className="flex-1 overflow-auto custom-scrollbar">
                                            <div className="grid grid-cols-3 gap-4 mb-8">
                                                <div className="bg-card border border-border p-5 rounded-2xl shadow-inner">
                                                    <p className="text-[9px] font-bold text-muted-foreground uppercase mb-2 tracking-widest">Memoria Física</p>
                                                    <p className="text-3xl font-bold text-foreground leading-none">{hardwarePreview.length}</p>
                                                </div>
                                                <div className="bg-emerald-500/5 border border-emerald-500/10 p-5 rounded-2xl">
                                                    <p className="text-[9px] font-bold text-emerald-600 uppercase mb-2 tracking-widest">Ya registrados</p>
                                                    <p className="text-3xl font-bold text-emerald-400 leading-none">{hardwarePreview.filter(p => p.exists).length}</p>
                                                </div>
                                                <div className="bg-blue-500/5 border border-blue-500/10 p-5 rounded-2xl">
                                                    <p className="text-[9px] font-bold text-blue-600 uppercase mb-2 tracking-widest">Pendientes</p>
                                                    <div className="flex items-center gap-3">
                                                        <p className="text-3xl font-bold text-blue-400 leading-none">{hardwarePreview.filter(p => !p.exists).length}</p>
                                                        {hardwarePreview.filter(p => !p.exists).length > 0 && <div className="w-2 h-2 rounded-full bg-blue-500 animate-ping" />}
                                                    </div>
                                                </div>
                                            </div>

                                            <Table>
                                                <TableHeader className="bg-card/30 sticky top-0">
                                                    <TableRow className="border-border hover:bg-transparent">
                                                        <th className="text-[9px] font-bold text-muted-foreground uppercase p-4">Fecha / Hora (Hardware)</th>
                                                        <th className="text-[9px] font-bold text-muted-foreground uppercase p-4">Individuo</th>
                                                        <th className="text-[9px] font-bold text-muted-foreground uppercase p-4">Estado</th>
                                                        <th className="text-[9px] font-bold text-muted-foreground uppercase p-4 text-right">Situación</th>
                                                    </TableRow>
                                                </TableHeader>
                                                <TableBody>
                                                    {hardwarePreview.map((log, idx) => (
                                                        <TableRow key={idx} className="border-border">
                                                            <TableCell className="p-4 text-xs font-mono font-bold text-muted-foreground">{log.Time}</TableCell>
                                                            <TableCell className="p-4">
                                                                <p className="text-xs font-bold text-foreground uppercase">{log.Name || log.Card || "DESCONOCIDO"}</p>
                                                                <p className="text-[9px] font-bold text-muted-foreground uppercase">{log.Mode || "BIO"}</p>
                                                            </TableCell>
                                                            <TableCell className="p-4">
                                                                <Badge variant="outline" className={cn(
                                                                    "text-[8px] font-bold",
                                                                    log.Status === "1" ? "border-emerald-500/20 text-emerald-500" : "border-rose-500/20 text-rose-500"
                                                                )}>
                                                                    {log.Status === "1" ? "ADMITIDO" : "DENEGADO"}
                                                                </Badge>
                                                            </TableCell>
                                                            <TableCell className="p-4 text-right">
                                                                {log.exists ? (
                                                                    <div className="flex items-center justify-end gap-2 text-emerald-500 text-[9px] font-bold uppercase">
                                                                        <CheckCircle2 size={12} /> Persistido
                                                                    </div>
                                                                ) : (
                                                                    <div className="flex items-center justify-end gap-2 text-blue-400 text-[9px] font-bold uppercase animate-pulse">
                                                                        <AlertCircle size={12} /> Pendiente
                                                                    </div>
                                                                )}
                                                            </TableCell>
                                                        </TableRow>
                                                    ))}
                                                </TableBody>
                                            </Table>
                                        </TabsContent>

                                        <TabsContent value="call" className="flex-1 overflow-auto custom-scrollbar">
                                            <div className="grid grid-cols-2 gap-6 mb-8">
                                                <div className="bg-card/50 p-6 rounded-2xl border border-border">
                                                    <p className="text-[9px] font-bold text-muted-foreground uppercase mb-2">Total Llamadas</p>
                                                    <p className="text-3xl font-bold text-foreground">{hardwareCallPreview.length}</p>
                                                </div>
                                                <div className="bg-blue-500/5 p-6 rounded-2xl border border-blue-500/10">
                                                    <p className="text-[9px] font-bold text-blue-600 uppercase mb-2">Pendientes de Sincr.</p>
                                                    <p className="text-3xl font-bold text-blue-400">{hardwareCallPreview.filter(p => !p.exists).length}</p>
                                                </div>
                                            </div>

                                            <Table>
                                                <TableHeader className="bg-card/30 sticky top-0">
                                                    <TableRow className="border-border hover:bg-transparent">
                                                        <th className="text-[9px] font-bold text-muted-foreground uppercase p-4 text-left">Origen / Destino</th>
                                                        <th className="text-[9px] font-bold text-muted-foreground uppercase p-4 text-center">Duración / Resultado</th>
                                                        <th className="text-[9px] font-bold text-muted-foreground uppercase p-4 text-right">Estado</th>
                                                    </TableRow>
                                                </TableHeader>
                                                <TableBody>
                                                    {hardwareCallPreview.map((log, idx) => (
                                                        <TableRow key={idx} className="border-border">
                                                            <TableCell className="p-4">
                                                                <p className="text-xs font-bold text-foreground uppercase">{log.CallerID} → {log.CalleeID}</p>
                                                                <p className="text-[9px] font-bold text-muted-foreground uppercase">{log.Time}</p>
                                                            </TableCell>
                                                            <TableCell className="p-4 text-center">
                                                                <p className="text-xs font-bold text-foreground">{log.TalkTime}s</p>
                                                                <p className="text-[9px] font-bold text-muted-foreground uppercase">{log.Result}</p>
                                                            </TableCell>
                                                            <TableCell className="p-4 text-right">
                                                                {log.exists ? (
                                                                    <div className="flex items-center justify-end gap-2 text-emerald-500 text-[9px] font-bold uppercase">
                                                                        <CheckCircle2 size={12} /> Persistido
                                                                    </div>
                                                                ) : (
                                                                    <div className="flex items-center justify-end gap-2 text-blue-400 text-[9px] font-bold uppercase animate-pulse">
                                                                        <AlertCircle size={12} /> Pendiente
                                                                    </div>
                                                                )}
                                                            </TableCell>
                                                        </TableRow>
                                                    ))}
                                                </TableBody>
                                            </Table>
                                        </TabsContent>
                                    </Tabs>
                                </div>
                            )}
                        </div>
                        <DialogFooter className="p-8 bg-card border-t border-border gap-3 shrink-0 rounded-b-3xl">
                            <Button variant="ghost" onClick={() => setPreviewDialogOpen(false)} className="text-muted-foreground font-bold uppercase text-[10px] tracking-[0.2em] px-8 h-12 hover:bg-card rounded-xl transition-all">Cancelar</Button>
                            <Button
                                disabled={loadingPreview || syncing === previewDevice?.id || (hardwarePreview.filter(p => !p.exists).length === 0 && hardwareCallPreview.filter(p => !p.exists).length === 0)}
                                onClick={() => handleSync(previewDevice?.id)}
                                className="bg-blue-600 hover:bg-blue-500 text-foreground font-bold uppercase text-[11px] tracking-widest px-12 h-14 rounded-2xl shadow-lg shadow-blue-500/20 transition-all hover:scale-105 active:scale-95"
                            >
                                {syncing === previewDevice?.id ? <RefreshCw className="animate-spin mr-3" size={18} /> : <Zap size={18} className="mr-3 fill-current" />}
                                {syncing === previewDevice?.id ? "PROCESANDO..." : `IMPORTAR ${hardwarePreview.filter(p => !p.exists).length + hardwareCallPreview.filter(p => !p.exists).length} REGISTROS`}
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>

                <style jsx global>{`
                    .custom-scrollbar::-webkit-scrollbar {
                        width: 4px;
                    }
                    .custom-scrollbar::-webkit-scrollbar-track {
                        background: transparent;
                    }
                    .custom-scrollbar::-webkit-scrollbar-thumb {
                        background: #262626;
                        border-radius: 10px;
                    }
                `}</style>
            </div>
        </TooltipProvider >
    );
}
