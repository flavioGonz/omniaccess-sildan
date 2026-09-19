"use client";

import { useState, useEffect } from "react";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from "@/components/ui/dialog";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    Tabs,
    TabsContent,
    TabsList,
    TabsTrigger,
} from "@/components/ui/tabs";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
    Users,
    Trash2,
    RefreshCw,
    Database,
    UserPlus,
    CheckCircle2,
    AlertCircle,
    Loader2,
    DownloadCloud,
    Camera,
    Tag,
    Car,
    Server,
    ArrowRightLeft,
    UploadCloud,
    Search,
    User,
    HardDrive,
    ListChecks,
    History,
    Shield,
    Phone,
    PhoneIncoming,
    PhoneOutgoing,
    PhoneMissed,
    Image as ImageIcon,
    Calendar,
    X,
    Clock,
    Network,
    Activity,
    Eye
} from "lucide-react";
import {
    getDeviceFaces,
    deleteDeviceFace,
    syncUserToDevice,
    syncIdentityAction,
    exportAllToDevice,
    getDatabaseStats,
    getDeviceDoorlogs,
    getDeviceCalllogs
} from "@/app/actions/deviceMemory";
import { getUsers } from "@/app/actions/users";
import { getUnits } from "@/app/actions/units";
import { cn } from "@/lib/utils";
import { sileo as toast } from "sileo";
import { DeleteConfirmDialog } from "./DeleteConfirmDialog";
import { hora } from "@/lib/fechas";
import { DEVICE_MODELS, DRIVER_MODELS } from "@/lib/driver-models";

const PLACEHOLDER_DEVICE_IMG = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" fill="none"><rect width="48" height="48" rx="8" fill="%23262626"/><path d="M24 14a4 4 0 100 8 4 4 0 000-8zm-6 14c0-2 4-3.1 6-3.1S30 26 30 28v1H18v-1z" fill="%23525252"/><rect x="14" y="32" width="20" height="3" rx="1.5" fill="%23525252"/></svg>')}`;

const BRAND_LOGOS: Record<string, string> = {
    HIKVISION: "https://upload.wikimedia.org/wikipedia/commons/thumb/1/17/Hikvision_logo.svg/2560px-Hikvision_logo.svg.png",
    AKUVOX: "https://www.akuvox.com/images/logo.png",
};

interface DeviceMemoryDialogProps {
    device: any;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

export function DeviceMemoryDialog({ device, open, onOpenChange }: DeviceMemoryDialogProps) {
    // --- ESTADOS FUNDAMENTALES ---
    const [faces, setFaces] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [units, setUnits] = useState<any[]>([]);
    const [selectedUnitId, setSelectedUnitId] = useState<string>("none");
    const [doorlogs, setDoorlogs] = useState<any[]>([]);
    const [loadingLogs, setLoadingLogs] = useState(false);
    const [calllogs, setCalllogs] = useState<any[]>([]);
    const [loadingCallLogs, setLoadingCallLogs] = useState(false);
    const [selectedLogImage, setSelectedLogImage] = useState<string | null>(null);

    // --- ESTADOS DE SINCRONIZACIÓN Y FILTROS ---
    const [showSync, setShowSync] = useState(false);
    const [systemUsers, setSystemUsers] = useState<any[]>([]);
    const [syncSearch, setSyncSearch] = useState("");
    const [isSyncing, setIsSyncing] = useState<string | null>(null);
    const [isDownloading, setIsDownloading] = useState(false);
    const [faceSearch, setFaceSearch] = useState("");
    const [doorlogSearch, setDoorlogSearch] = useState("");
    const [doorlogFilter, setDoorlogFilter] = useState("ALL");
    const [calllogSearch, setCalllogSearch] = useState("");
    const [calllogFilter, setCalllogFilter] = useState("ALL");

    // --- ESTADOS DE PAGINACIÓN ---
    const [directoryPage, setDirectoryPage] = useState(1);
    const [doorlogPage, setDoorlogPage] = useState(1);
    const [calllogPage, setCalllogPage] = useState(1);
    const itemsPerPage = 6;

    // --- ESTADOS DE IMPORTACIÓN / EXPORTACIÓN MASIVA ---
    const [importStatus, setImportStatus] = useState<'idle' | 'importing' | 'completed'>('idle');
    const [analysis, setAnalysis] = useState({ total: 0, new: 0, existing: 0, tags: 0, faces: 0, doorlogs: 0, calllogs: 0 });
    const [progress, setProgress] = useState(0);
    const [processedCount, setProcessedCount] = useState(0);
    const [currentImport, setCurrentImport] = useState<any>(null);
    const [importStats, setImportStats] = useState({ success: 0, faces: 0, tags: 0, failed: 0 });
    const [syncMode, setSyncMode] = useState<'import' | 'export' | null>(null);
    const [dbStats, setDbStats] = useState({ users: 0, tags: 0, plates: 0 });

    // --- CARGA DE DATOS ---
    const loadFaces = async () => {
        setLoading(true);
        setError(null);
        try {
            const data = await getDeviceFaces(device.id);
            setFaces(data);
        } catch (err: any) {
            console.error(err);
            const errorMsg = `No se pudo conectar con el dispositivo: ${device.name}\nIP: ${device.ip || 'No configurada'}\n\nVerifique que el equipo esté encendido y en la misma red.`;
            setError(errorMsg);
        } finally {
            setLoading(false);
        }
    };

    const loadLogs = async () => {
        if (device.brand !== 'AKUVOX' && device.brand !== 'HIKVISION') return;
        setLoadingLogs(true);
        try {
            const data = await getDeviceDoorlogs(device.id);
            setDoorlogs(data);
        } catch (err) {
            console.error("Error loading logs:", err);
        } finally {
            setLoadingLogs(false);
        }
    };

    const loadCallLogs = async () => {
        if (device.brand !== 'AKUVOX') return;
        setLoadingCallLogs(true);
        try {
            const data = await getDeviceCalllogs(device.id);
            setCalllogs(data);
        } catch (err) {
            console.error("Error loading call logs:", err);
        } finally {
            setLoadingCallLogs(false);
        }
    };

    const loadSystemUsers = async () => {
        const users = await getUsers();
        setSystemUsers(users);
    };

    useEffect(() => {
        if (open) {
            loadFaces();
            loadSystemUsers();
            getUnits().then(setUnits);
            if (device.brand === 'AKUVOX' || device.brand === 'HIKVISION') {
                loadLogs();
                if (device.brand === 'AKUVOX') loadCallLogs();
            }
        }
    }, [open]);

    // --- HANDLERS DE ACCIÓN ---
    const handleSync = async (userId: string) => {
        setIsSyncing(userId);
        const promise = syncUserToDevice(device.id, userId);

        toast.promise(promise, {
            loading: { title: 'Inyectando usuario y rostro al equipo...' },
            success: (data) => {
                setTimeout(async () => {
                    await loadFaces();
                    setShowSync(false);
                }, 1000);
                return { title: "Usuario inyectado correctamente" };
            },
            error: { title: "Error al sincronizar con el equipo" }
        });

        try { await promise; } catch (err) { console.error(err); } finally { setIsSyncing(null); }
    };

    const handleDownloadAll = () => {
        const total = faces.length;
        if (total === 0 && doorlogs.length === 0 && calllogs.length === 0) {
            toast.error({ title: "No hay registros para descargar." });
            return;
        }

        let newUsers = 0, existing = 0, totalTags = 0, totalFaces = 0;
        faces.forEach(f => {
            const exists = systemUsers.some(u => u.name.toLowerCase() === f.Name?.toLowerCase());
            exists ? existing++ : newUsers++;
            if (f.HasTag) totalTags++;
            if (f.HasFace) totalFaces++;
        });

        setAnalysis({
            total,
            new: newUsers,
            existing,
            tags: totalTags,
            faces: totalFaces,
            doorlogs: doorlogs.length,
            calllogs: calllogs.length
        });
        setSyncMode('import');
    };

    const handleExportRequest = async () => {
        setLoading(true);
        try {
            const stats = await getDatabaseStats();
            setDbStats(stats);
            setSyncMode('export');
        } catch (error) {
            toast.error({ title: "Error al analizar base de datos" });
        } finally {
            setLoading(false);
        }
    };

    const startImport = async () => {
        setSyncMode(null);
        setImportStatus('importing');
        setProgress(0);
        setProcessedCount(0);
        setImportStats({ success: 0, faces: 0, tags: 0, failed: 0 });

        const total = faces.length;
        for (let i = 0; i < total; i++) {
            setProcessedCount(i + 1);
            const item = faces[i];
            setCurrentImport(item);
            try {
                const result = await syncIdentityAction(device.id, item, selectedUnitId === 'none' ? undefined : selectedUnitId);
                if (result.success) {
                    setImportStats(prev => ({
                        success: prev.success + 1,
                        faces: prev.faces + (item.HasFace ? 1 : 0),
                        tags: prev.tags + (item.HasTag ? 1 : 0),
                        failed: prev.failed
                    }));
                }
            } catch (err) {
                setImportStats(prev => ({ ...prev, failed: prev.failed + 1 }));
            }
            setProgress(((i + 1) / total) * 100);
        }
        setImportStatus('completed');
        toast.success({ title: "Sincronización finalizada" });
    };

    const startExport = async () => {
        setSyncMode(null);
        setLoading(true);
        try {
            const res = await exportAllToDevice(device.id);
            toast.success({ title: `Completado: ${res.processed} usuarios sincronizados` });
            loadFaces();
        } catch (e: any) {
            toast.error({ title: "Error: " + e.message });
        } finally {
            setLoading(false);
        }
    };

    const resetImport = () => {
        setImportStatus('idle');
        setProgress(0);
        loadSystemUsers();
    };

    // --- RENDERIZADO DE COMPONENTES DE UI ---

    const renderConfirmOverlay = () => {
        if (!syncMode) return null;
        const isExport = syncMode === 'export';
        const title = isExport ? "Volcar Base de Datos a Equipo" : "Descargar Equipo a App";
        const sourceName = isExport ? "Base de Datos (App)" : "Memoria del Equipo";
        const targetName = isExport ? device.name : "Base de Datos (App)";
        const sourceCount = isExport ? dbStats.users : analysis.total;
        const targetDiff = isExport ? `~${dbStats.users}` : `+${analysis.new}`;
        const targetLabel = isExport ? "Identidades" : "Nuevos Usuarios";

        return (
            <div className="absolute inset-0 bg-black/90 z-50 flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in duration-200">
                <div className="w-full max-w-2xl bg-card border border-border rounded-3xl shadow-lg flex flex-col max-h-[90%] overflow-hidden">
                    <div className={cn("p-6 border-b border-border", isExport ? "bg-orange-500/5" : "bg-blue-500/5")}>
                        <div className="flex items-center gap-5">
                            <div className={cn("w-14 h-14 rounded-2xl flex items-center justify-center text-foreground shadow-lg", isExport ? "bg-orange-600" : "bg-blue-600")}>
                                {isExport ? <UploadCloud size={28} /> : <DownloadCloud size={28} />}
                            </div>
                            <div>
                                <h3 className="text-xl font-bold text-foreground uppercase tracking-tight">{title}</h3>
                                <div className="flex items-center gap-2 mt-1.5">
                                    <span className={cn("px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-widest border", isExport ? "bg-orange-500/10 border-orange-500/20 text-orange-400" : "bg-blue-500/10 border-blue-500/20 text-blue-400")}>
                                        {isExport ? "Modo Sobrescritura" : "Modo Importación Inteligente"}
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="p-8 overflow-y-auto custom-scrollbar">
                        <div className="flex items-center justify-between gap-8 mb-10">
                            <div className="flex-1 flex flex-col items-center gap-3">
                                <div className="p-4 rounded-full bg-card border border-border shadow-inner">
                                    {isExport ? <Database size={24} className="text-blue-500" /> : <HardDrive size={24} className="text-orange-500" />}
                                </div>
                                <div className="text-center">
                                    <p className="text-[10px] font-bold uppercase text-muted-foreground tracking-widest mb-1">{sourceName}</p>
                                    <p className="text-4xl font-bold text-foreground">{sourceCount}</p>
                                    <p className="text-[11px] font-bold text-muted-foreground uppercase">Identidades Detectadas</p>
                                </div>
                            </div>

                            <div className="flex flex-col items-center text-muted-foreground gap-3">
                                <div className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-foreground/10 border border-border animate-pulse">
                                    <ArrowRightLeft size={16} className={isExport ? "text-orange-500" : "text-blue-500"} />
                                </div>
                            </div>

                            <div className="flex-1 flex flex-col items-center gap-3">
                                <div className="p-4 rounded-full bg-card border border-border shadow-inner">
                                    {isExport ? <HardDrive size={24} className="text-orange-500" /> : <Database size={24} className="text-blue-500" />}
                                </div>
                                <div className="text-center">
                                    <p className="text-[10px] font-bold uppercase text-muted-foreground tracking-widest mb-1">{targetName}</p>
                                    <p className={cn("text-4xl font-bold", isExport ? "text-orange-400" : "text-blue-400")}>{targetDiff}</p>
                                    <p className="text-[11px] font-bold text-muted-foreground uppercase">{targetLabel}</p>
                                </div>
                            </div>
                        </div>

                        {!isExport && (
                            <div className="space-y-6">
                                <div className="bg-blue-500/5 border border-blue-500/10 rounded-2xl p-6">
                                    <div className="flex items-center justify-between mb-4">
                                        <h4 className="text-[11px] font-bold text-blue-400 uppercase tracking-widest flex items-center gap-2">
                                            <ListChecks size={14} /> Resumen de Diferencias
                                        </h4>
                                        <Badge className="bg-blue-500/20 text-blue-400 border-none text-[9px] font-bold uppercase">{analysis.new} Novedades</Badge>
                                    </div>
                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="bg-background/50 p-4 rounded-xl border border-border">
                                            <p className="text-[9px] text-muted-foreground uppercase font-bold mb-1">Rostros a Importar</p>
                                            <p className="text-xl font-bold text-foreground">{analysis.faces}</p>
                                        </div>
                                        <div className="bg-background/50 p-4 rounded-xl border border-border">
                                            <p className="text-[9px] text-muted-foreground uppercase font-bold mb-1">Tags / RFID</p>
                                            <p className="text-xl font-bold text-foreground">{analysis.tags}</p>
                                        </div>
                                    </div>
                                </div>

                                <div className="space-y-4">
                                    <label className="text-[11px] font-bold text-muted-foreground uppercase tracking-[0.2em] px-1">Asignar a Residencia / Lote</label>
                                    <Select value={selectedUnitId} onValueChange={setSelectedUnitId}>
                                        <SelectTrigger className="w-full bg-card/50 border-border text-foreground h-14 rounded-2xl px-6 hover:bg-card transition-all">
                                            <SelectValue placeholder="Seleccionar Unidad..." />
                                        </SelectTrigger>
                                        <SelectContent className="bg-card border-border text-foreground rounded-2xl">
                                            <SelectItem value="none">Sin asignación (General / No Residente)</SelectItem>
                                            {units.map((u: any) => (
                                                <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>
                        )}

                        {isExport && (
                            <div className="bg-orange-500/5 border border-orange-500/10 rounded-2xl p-6">
                                <div className="flex items-center gap-4 text-orange-400 mb-4">
                                    <AlertCircle size={20} />
                                    <h4 className="text-xs font-bold uppercase tracking-widest">Advertencia de Sobrescritura</h4>
                                </div>
                                <p className="text-[11px] text-muted-foreground font-medium leading-relaxed uppercase">
                                    Esta acción volcará todos los usuarios de la base de datos local hacia el dispositivo.
                                    Los usuarios existentes en el equipo que no coincidan serán actualizados o mantenidos según la configuración del driver.
                                </p>
                            </div>
                        )}
                    </div>

                    <div className="p-5 bg-card border-t border-border flex gap-3">
                        <Button onClick={() => setSyncMode(null)} variant="ghost" className="flex-1 h-12 text-muted-foreground font-bold uppercase text-[10px]">Cancelar</Button>
                        <Button onClick={isExport ? startExport : startImport} className={cn("flex-[2] h-12 text-foreground font-bold uppercase text-[10px]", isExport ? "bg-orange-600" : "bg-blue-600")}>
                            {isExport ? "Iniciar Volcado" : "Iniciar Importación"}
                        </Button>
                    </div>
                </div>
            </div>
        );
    };

    const renderImportOverlay = () => {
        if (importStatus === 'idle') return null;
        return (
            <div className="absolute inset-0 bg-[#050505]/95 z-[60] flex flex-col items-center justify-center p-10 animate-in fade-in duration-500 backdrop-blur-md">
                {importStatus === 'importing' ? (
                    <div className="w-full max-w-md space-y-10 text-center">
                        <div className="relative mx-auto w-32 h-32">
                            <div className="absolute inset-0 bg-blue-500/10 rounded-full animate-ping duration-[2000ms]" />
                            <div className="absolute inset-[-4px] border-2 border-dashed border-blue-500/20 rounded-full animate-spin duration-[8000ms]" />
                            <div className="relative z-10 w-full h-full bg-card rounded-3xl border border-border flex items-center justify-center overflow-hidden shadow-lg">
                                {currentImport?.FaceUrl ? (
                                    <img src={currentImport.FaceUrl} className="w-full h-full object-cover" />
                                ) : (
                                    <div className="flex flex-col items-center">
                                        <User size={40} className="text-blue-500/50 mb-1" />
                                        <span className="text-xs font-bold text-muted-foreground uppercase tracking-tighter">Syncing</span>
                                    </div>
                                )}
                            </div>
                        </div>
                        <div className="space-y-3">
                            <h3 className="text-2xl font-bold text-foreground uppercase tracking-tight flex items-center justify-center gap-3">
                                <Loader2 className="animate-spin text-blue-500" size={24} />
                                Procesando Datos
                            </h3>
                            <p className="text-sm font-medium text-muted-foreground">
                                Sincronizando: <span className="text-foreground font-bold">{currentImport?.Name || '...'}</span>
                            </p>
                        </div>
                        <div className="space-y-4">
                            <div className="flex justify-between items-end">
                                <span className="text-[10px] font-bold uppercase text-muted-foreground tracking-[0.2em]">Sincronización en curso</span>
                                <span className="text-xl font-bold text-blue-500 italic">{Math.round(progress)}%</span>
                            </div>
                            <div className="h-2 bg-card rounded-full overflow-hidden border border-border p-0.5">
                                <div
                                    className="h-full bg-gradient-to-r from-blue-600 via-indigo-500 to-cyan-400 rounded-full transition-all duration-300 shadow-[0_0_20px_rgba(59,130,246,0.5)]"
                                    style={{ width: `${progress}%` }}
                                />
                            </div>

                            {/* Terminal Log */}
                            <div className="h-24 bg-black/40 rounded-xl border border-border p-4 overflow-y-auto custom-scrollbar text-left font-mono text-[9px]">
                                <div className="space-y-1">
                                    <p className="text-blue-500/50 flex items-center gap-2">
                                        <span className="w-1 h-1 rounded-full bg-blue-500 animate-pulse" />
                                        Iniciando túnel seguro hacia {device.brand}...
                                    </p>
                                    <p className="text-muted-foreground">[{hora(new Date())}] Analizando {analysis.total} registros hardware.</p>
                                    {processedCount > 0 && (
                                        <p className="text-emerald-500/70 border-l border-emerald-500/30 pl-2">
                                            ✓ {currentImport?.Name || 'Objeto'} procesado ({processedCount}/{analysis.total})
                                        </p>
                                    )}
                                </div>
                            </div>

                            <div className="flex justify-center gap-12 pt-4">
                                <div className="text-center group">
                                    <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest group-hover:text-muted-foreground transition-colors">Completados</p>
                                    <p className="text-2xl font-bold text-foreground">{processedCount}</p>
                                </div>
                                <div className="text-center group">
                                    <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest group-hover:text-muted-foreground transition-colors">Total Equipo</p>
                                    <p className="text-2xl font-bold text-foreground">{analysis.total}</p>
                                </div>
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="w-full max-w-md space-y-8 text-center animate-in zoom-in-95 duration-500">
                        <div className="mx-auto w-24 h-24 bg-emerald-500/10 rounded-3xl flex items-center justify-center border border-emerald-500/20 text-emerald-500 mb-6 shadow-[0_0_40px_rgba(16,185,129,0.15)]">
                            <CheckCircle2 size={48} />
                        </div>
                        <div>
                            <h3 className="text-3xl font-bold text-foreground uppercase tracking-tighter mb-2">Finalizado con Éxito</h3>
                            <p className="text-muted-foreground font-medium text-sm">La base de datos local ha sido actualizada.</p>
                        </div>
                        <div className="grid grid-cols-3 gap-4">
                            <div className="bg-card/50 p-5 rounded-2xl border border-border">
                                <p className="text-[10px] text-muted-foreground font-bold uppercase mb-1">Total</p>
                                <p className="text-2xl text-foreground font-bold">{importStats.success}</p>
                            </div>
                            <div className="bg-card/50 p-5 rounded-2xl border border-border">
                                <p className="text-[10px] text-muted-foreground font-bold uppercase mb-1">Rostros</p>
                                <p className="text-2xl text-blue-500 font-bold">{importStats.faces}</p>
                            </div>
                            <div className="bg-card/50 p-5 rounded-2xl border border-border">
                                <p className="text-[10px] text-muted-foreground font-bold uppercase mb-1">Fallos</p>
                                <p className="text-2xl text-rose-500 font-bold">{importStats.failed}</p>
                            </div>
                        </div>
                        <Button
                            onClick={resetImport}
                            className="w-full h-14 rounded-2xl bg-white hover:bg-muted text-black font-bold uppercase tracking-widest text-xs transition-all shadow-xl"
                        >
                            Finalizar y Regresar
                        </Button>
                    </div>
                )}
            </div>
        );
    };

    // --- FILTRADO DE TABLAS ---
    const filteredSystemUsers = systemUsers.filter(u =>
        u.name.toLowerCase().includes(syncSearch.toLowerCase()) ||
        u.unit?.name?.toLowerCase().includes(syncSearch.toLowerCase())
    );

    const filteredFaces = faces.filter(f => {
        const search = faceSearch.toLowerCase();
        return f.Name?.toLowerCase().includes(search) || f.UserID?.toLowerCase().includes(search) || f.CardCode?.toLowerCase().includes(search);
    });

    const filteredDoorlogs = doorlogs.filter(log =>
        (log.Name || '').toLowerCase().includes(doorlogFilter.toLowerCase())
    );

    const filteredCalllogs = calllogs.filter(log =>
        (log.Name || log.Remote || '').toLowerCase().includes(calllogFilter.toLowerCase())
    );

    // --- RENDERIZADO PRINCIPAL ---
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                className="max-w-[98vw] lg:max-w-[1300px] bg-[#080808] border-border/60 p-0 overflow-hidden shadow-lg transition-all duration-300 rounded-lg"
                aria-describedby="device-memory-description"
            >
                <DialogTitle className="sr-only">Gestión de Memoria y Sincronización - {device.name}</DialogTitle>
                <p id="device-memory-description" className="sr-only">Panel interactivo para visualizar y gestionar usuarios, rostros y registros de llamadas en el dispositivo.</p>
                {renderConfirmOverlay()}
                {renderImportOverlay()}

                <div className="flex flex-col h-[700px] max-h-[88vh] overflow-hidden">
                    {/* HEADER COMPACTO — device info + stats + actions en una franja */}
                    <div className="bg-background/80 border-b border-border/60 px-5 py-3.5 flex items-center gap-4 shrink-0">
                        {/* Device photo + name */}
                        <div className="flex items-center gap-3 min-w-0">
                            <div className="w-12 h-12 rounded-md bg-white flex items-center justify-center p-1.5 border border-border/30 overflow-hidden shrink-0">
                                <img
                                    src={
                                        device.modelPhoto ||
                                        DRIVER_MODELS[device.brand as keyof typeof DRIVER_MODELS]?.find((m: any) => m.value === device.deviceModel)?.photo ||
                                        DEVICE_MODELS[device.brand]?.[device.deviceType] ||
                                        DEVICE_MODELS[device.brand]?.DEFAULT ||
                                        BRAND_LOGOS[device.brand] ||
                                        PLACEHOLDER_DEVICE_IMG
                                    }
                                    alt={device.name}
                                    className="w-full h-full object-contain"
                                />
                            </div>
                            <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                    <h2 className="text-sm font-bold text-foreground truncate">{device.name}</h2>
                                    <Badge className="bg-indigo-500/10 text-indigo-400 border-indigo-500/20 text-[8px] font-bold uppercase tracking-wide px-1.5 shrink-0">
                                        {device.brand}
                                    </Badge>
                                </div>
                                <div className="flex items-center gap-3 mt-0.5">
                                    <span className="text-[10px] font-mono text-muted-foreground">{device.ip}</span>
                                    <span className="flex items-center gap-1 text-[9px] text-emerald-500 font-semibold">
                                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /> Online
                                    </span>
                                </div>
                            </div>
                        </div>

                        {/* Compact stats strip */}
                        <div className="flex items-center gap-2 ml-auto shrink-0">
                            <div className="flex items-center gap-3 bg-card/60 border border-border/50 rounded-md px-3 py-1.5">
                                <div className="flex items-center gap-1.5">
                                    <Users size={12} className={faces.length > 0 ? "text-blue-400" : "text-muted-foreground"} />
                                    <span className="text-xs font-bold text-foreground">{faces.length}</span>
                                    <span className="text-[9px] text-muted-foreground font-medium">IDs</span>
                                </div>
                                <div className="w-px h-4 bg-muted" />
                                <div className="w-20 bg-muted/50 h-1.5 rounded-full overflow-hidden">
                                    <div className="bg-gradient-to-r from-blue-600 to-indigo-400 h-full rounded-full transition-all duration-[1.5s]" style={{ width: `${Math.min((faces.length / (device.brand === 'HIKVISION' ? 2048 : 20000)) * 100, 100)}%` }} />
                                </div>
                                <span className="text-[8px] text-muted-foreground font-semibold">{device.brand === 'HIKVISION' ? '2K' : '20K'}</span>
                            </div>

                            {/* Action buttons */}
                            <TooltipProvider>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <Button size="icon" onClick={() => setShowSync(!showSync)} className={cn("h-8 w-8 rounded-md transition-all border", showSync ? "bg-blue-600 border-blue-500 text-foreground" : "bg-card text-muted-foreground hover:text-blue-400 hover:bg-blue-500/10 border-border hover:border-blue-500/30")}>
                                            <UserPlus size={14} />
                                        </Button>
                                    </TooltipTrigger>
                                    <TooltipContent><p>Inyectar Usuarios</p></TooltipContent>
                                </Tooltip>

                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <Button size="icon" onClick={loadFaces} disabled={loading} className="h-8 w-8 rounded-md bg-card text-muted-foreground hover:text-foreground hover:bg-muted border border-border transition-all">
                                            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
                                        </Button>
                                    </TooltipTrigger>
                                    <TooltipContent><p>Refrescar Memoria</p></TooltipContent>
                                </Tooltip>

                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <Button size="icon" onClick={handleDownloadAll} disabled={loading} className="h-8 w-8 rounded-md bg-card text-muted-foreground hover:text-emerald-400 hover:bg-emerald-500/10 border border-border hover:border-emerald-500/30 transition-all">
                                            <DownloadCloud size={14} />
                                        </Button>
                                    </TooltipTrigger>
                                    <TooltipContent><p>Importar Todo</p></TooltipContent>
                                </Tooltip>
                            </TooltipProvider>

                            <Button
                                onClick={() => onOpenChange(false)}
                                size="icon"
                                variant="ghost"
                                className="h-8 w-8 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent"
                            >
                                <X size={16} />
                            </Button>
                        </div>
                    </div>

                    {/* TABS */}
                    <Tabs defaultValue="directory" className="flex-1 flex flex-col min-w-0 overflow-hidden">
                        <div className="px-5 pt-2 flex items-center justify-between border-b border-border/60">
                            <TabsList className="bg-transparent p-0 h-auto gap-0">
                                <TabsTrigger value="directory" className="text-[10px] font-bold uppercase tracking-wide px-4 h-9 rounded-none border-b-2 border-transparent data-[state=active]:border-indigo-500 data-[state=active]:text-foreground data-[state=active]:bg-transparent text-muted-foreground hover:text-muted-foreground">
                                    <Users size={13} className="mr-1.5" /> Directorio
                                </TabsTrigger>
                                {(device.brand === 'AKUVOX' || device.brand === 'HIKVISION') && (
                                    <TabsTrigger value="doorlog" className="text-[10px] font-bold uppercase tracking-wide px-4 h-9 rounded-none border-b-2 border-transparent data-[state=active]:border-indigo-500 data-[state=active]:text-foreground data-[state=active]:bg-transparent text-muted-foreground hover:text-muted-foreground">
                                        <History size={13} className="mr-1.5" /> Doorlog
                                    </TabsTrigger>
                                )}
                                {device.brand === 'AKUVOX' && (
                                    <TabsTrigger value="calllog" className="text-[10px] font-bold uppercase tracking-wide px-4 h-9 rounded-none border-b-2 border-transparent data-[state=active]:border-indigo-500 data-[state=active]:text-foreground data-[state=active]:bg-transparent text-muted-foreground hover:text-muted-foreground">
                                        <Phone size={13} className="mr-1.5" /> Call Log
                                    </TabsTrigger>
                                )}
                            </TabsList>
                        </div>

                        {/* CONTENIDO DE DIRECTORIO */}
                        <TabsContent value="directory" className="flex-1 flex flex-col min-h-0 m-0 focus-visible:ring-0">
                            <div className="px-5 pt-3 pb-2 flex items-center gap-2">
                                {showSync ? <UserPlus className="text-blue-500" size={15} /> : <Users className="text-blue-500" size={15} />}
                                <h3 className="text-xs font-bold text-foreground uppercase tracking-tight">
                                    {showSync ? "Inyección de Rostros" : `Directorio: ${device.name}`}
                                </h3>
                                <span className="text-[9px] text-muted-foreground font-medium ml-1">
                                    {showSync ? "Sincroniza usuarios hacia el equipo" : "Identidades en memoria física"}
                                </span>
                            </div>

                            {showSync ? (
                                <div className="flex-1 flex flex-col overflow-hidden">
                                    <div className="px-5 pb-2">
                                        <div className="relative">
                                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={14} />
                                            <input
                                                type="text"
                                                placeholder="Buscar usuario o unidad..."
                                                value={syncSearch}
                                                onChange={(e) => setSyncSearch(e.target.value)}
                                                className="w-full bg-card/50 border border-border h-9 rounded-lg pl-9 text-xs text-foreground focus:border-blue-500/50 outline-none"
                                            />
                                        </div>
                                    </div>
                                    <div className="flex-1 overflow-y-auto px-5 pb-4 space-y-1.5 custom-scrollbar">
                                        {loading ? (
                                            <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-4">
                                                <div className="w-10 h-10 border-2 border-blue-500/10 border-t-blue-500 rounded-full animate-spin" />
                                                <p className="text-[9px] font-bold uppercase tracking-widest animate-pulse">Consultando Memoria...</p>
                                            </div>
                                        ) : filteredSystemUsers.map(u => (
                                            <div key={u.id} className="bg-card/40 px-3 py-2 rounded-lg border border-border flex items-center justify-between hover:bg-card hover:border-blue-500/30 transition-all group/user">
                                                <div className="flex items-center gap-3">
                                                    <div className="w-9 h-9 rounded-lg overflow-hidden border border-border shrink-0">
                                                        <img src={u.cara || "https://ui-avatars.com/api/?name=" + u.name} className="w-full h-full object-cover" />
                                                    </div>
                                                    <div>
                                                        <p className="text-xs font-bold text-foreground uppercase tracking-tight">{u.name}</p>
                                                        <div className="flex gap-1.5 mt-0.5">
                                                            <Badge className="bg-muted text-muted-foreground text-[7px] font-bold tracking-wide px-1.5 py-0">{u.unit?.name || "PERSONAL"}</Badge>
                                                            {u.credentials?.some((c: any) => c.type === 'TAG') && <Badge className="bg-amber-500/10 text-amber-500 border-amber-500/20 text-[7px] font-bold px-1.5 py-0">RFID</Badge>}
                                                        </div>
                                                    </div>
                                                </div>
                                                <Button
                                                    disabled={isSyncing === u.id}
                                                    onClick={() => handleSync(u.id)}
                                                    size="sm"
                                                    className={cn(
                                                        "h-7 px-4 rounded-md font-bold uppercase text-[9px] tracking-wide transition-all",
                                                        isSyncing === u.id ? "bg-muted text-muted-foreground" : "bg-blue-600 hover:bg-blue-500 text-foreground"
                                                    )}
                                                >
                                                    {isSyncing === u.id ? <Loader2 className="animate-spin" size={13} /> : <span>Inyectar</span>}
                                                </Button>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ) : (
                                <div className="flex-1 flex flex-col min-h-0 px-5 pb-4 space-y-2">
                                    <div className="relative group/search">
                                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground group-focus-within/search:text-blue-500 transition-colors" size={14} />
                                        <input
                                            type="text"
                                            placeholder="Filtrar por Nombre, ID o Tarjeta..."
                                            value={faceSearch}
                                            onChange={(e) => setFaceSearch(e.target.value)}
                                            className="w-full h-9 pl-9 pr-4 bg-card/50 border border-border rounded-lg text-xs font-medium text-foreground placeholder:text-muted-foreground focus:border-blue-500/30 outline-none transition-all"
                                        />
                                    </div>
                                    <div className="border border-border rounded-lg overflow-hidden flex-1 flex flex-col bg-[#050505]">
                                        <div className="overflow-auto flex-1 custom-scrollbar">
                                            <table className="w-full text-left border-separate border-spacing-0">
                                                <thead className="sticky top-0 z-10 bg-card/90 backdrop-blur-md border-b border-border">
                                                    <tr>
                                                        <th className="px-3 py-2 text-[9px] font-bold text-muted-foreground uppercase tracking-wide">#</th>
                                                        <th className="px-3 py-2 text-[9px] font-bold text-muted-foreground uppercase tracking-wide">Identidad</th>
                                                        <th className="px-3 py-2 text-[9px] font-bold text-muted-foreground uppercase tracking-wide text-center">Sincr.</th>
                                                        <th className="px-3 py-2 text-[9px] font-bold text-muted-foreground uppercase tracking-wide">Credenciales</th>
                                                        <th className="px-3 py-2 text-[9px] font-bold text-muted-foreground uppercase tracking-wide text-center">Foto</th>
                                                        <th className="px-3 py-2 text-[9px] font-bold text-muted-foreground uppercase tracking-wide text-center">Acción</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-white/[0.02]">
                                                    {filteredFaces.length === 0 ? (
                                                        <tr>
                                                            <td colSpan={6} className="py-12 text-center">
                                                                <div className="flex flex-col items-center gap-2 opacity-20">
                                                                    <Users size={32} className="text-muted-foreground" />
                                                                    <p className="text-[9px] font-bold uppercase tracking-wide">No se encontraron identidades</p>
                                                                </div>
                                                            </td>
                                                        </tr>
                                                    ) : filteredFaces.slice((directoryPage - 1) * itemsPerPage, directoryPage * itemsPerPage).map((f, idx) => (
                                                        <tr key={f.ID} className="group/row hover:bg-foreground/[0.04] transition-colors">
                                                            <td className="px-3 py-2">
                                                                <span className="text-[9px] font-mono font-bold text-muted-foreground">#{(directoryPage - 1) * itemsPerPage + idx + 1}</span>
                                                            </td>
                                                            <td className="px-3 py-2">
                                                                <p className="text-xs font-bold text-foreground uppercase tracking-tight group-hover/row:text-blue-400 transition-colors">{f.Name}</p>
                                                                <p className="text-[8px] font-medium text-muted-foreground uppercase tracking-wide">ID: {f.ID}</p>
                                                            </td>
                                                            <td className="px-3 py-2 text-center">
                                                                <Badge className={cn(
                                                                    "text-[7px] font-bold uppercase tracking-wide px-1.5 py-0",
                                                                    f.SyncStatus === 'IN_SYNC' ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20" :
                                                                        f.SyncStatus === 'ONLY_HARDWARE' ? "bg-blue-500/10 text-blue-500 border-blue-500/20 animate-pulse" :
                                                                            "bg-muted text-muted-foreground border-border"
                                                                )}>
                                                                    {f.SyncStatus === 'IN_SYNC' ? 'Sync' :
                                                                        f.SyncStatus === 'ONLY_HARDWARE' ? 'Solo HW' : '?'}
                                                                </Badge>
                                                            </td>
                                                            <td className="px-3 py-2">
                                                                <div className="flex items-center gap-1.5">
                                                                    {f.CardCode && (
                                                                        <div className="flex items-center gap-1 bg-card px-1.5 py-0.5 rounded border border-border">
                                                                            <Tag size={8} className="text-orange-500" />
                                                                            <span className="text-[9px] font-mono font-bold text-muted-foreground">{f.CardCode}</span>
                                                                        </div>
                                                                    )}
                                                                    {f.PIN && (
                                                                        <div className="flex items-center gap-1 bg-card px-1.5 py-0.5 rounded border border-border">
                                                                            <Shield size={8} className="text-blue-500" />
                                                                            <span className="text-[9px] font-mono font-bold text-muted-foreground">****</span>
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            </td>
                                                            <td className="px-3 py-2">
                                                                <div className="w-8 h-8 rounded-md bg-card border border-border mx-auto overflow-hidden">
                                                                    {f.FaceUrl ? <img src={f.FaceUrl} className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center bg-card"><User size={14} className="text-muted-foreground" /></div>}
                                                                </div>
                                                            </td>
                                                            <td className="px-3 py-2 text-center">
                                                                <DeleteConfirmDialog
                                                                    id={f.ID}
                                                                    title={`ELIMINAR ACCESO: ${f.Name}`}
                                                                    onDelete={async () => {
                                                                        const success = await deleteDeviceFace(device.id, f.ID, f.UserID);
                                                                        if (!success) throw new Error("Fallo en la eliminación");
                                                                    }}
                                                                    onSuccess={() => {
                                                                        setFaces(prev => prev.filter(item => item.ID !== f.ID));
                                                                        toast.success({ title: "Rostro eliminado correctamente" });
                                                                    }}
                                                                >
                                                                    <Button variant="ghost" size="icon" className="w-7 h-7 rounded-md text-muted-foreground hover:text-rose-500 hover:bg-rose-500/10 transition-all">
                                                                        <Trash2 size={14} />
                                                                    </Button>
                                                                </DeleteConfirmDialog>
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                        <div className="px-4 h-10 bg-card border-t border-border flex items-center justify-between shrink-0">
                                            <p className="text-[9px] font-bold text-muted-foreground">
                                                Pág. {directoryPage} / {Math.max(1, Math.ceil(filteredFaces.length / itemsPerPage))}
                                            </p>
                                            <div className="flex gap-1.5">
                                                <Button
                                                    size="sm"
                                                    variant="ghost"
                                                    disabled={directoryPage === 1}
                                                    onClick={() => setDirectoryPage(p => p - 1)}
                                                    className="h-7 px-3 bg-card border border-border rounded-md text-[9px] font-bold uppercase text-muted-foreground hover:text-foreground transition-all"
                                                >
                                                    Previo
                                                </Button>
                                                <Button
                                                    size="sm"
                                                    variant="ghost"
                                                    disabled={filteredFaces.length <= directoryPage * itemsPerPage}
                                                    onClick={() => setDirectoryPage(p => p + 1)}
                                                    className="h-7 px-3 bg-card border border-border rounded-md text-[9px] font-bold uppercase text-muted-foreground hover:text-foreground transition-all"
                                                >
                                                    Siguiente
                                                </Button>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </TabsContent>

                        {/* TABS DE LOGS (AKUVOX ONLY) */}
                        {device.brand === 'AKUVOX' && (
                            <>
                                <TabsContent value="doorlog" className="flex-1 flex flex-col min-h-0 m-0 overflow-hidden">
                                    <div className="px-5 pt-3 pb-2 flex items-center justify-between shrink-0">
                                        <div className="flex items-center gap-3 flex-1">
                                            <h3 className="text-xs font-bold text-foreground uppercase tracking-tight flex items-center gap-2">
                                                <History className="text-blue-500" size={15} /> Logs de Acceso
                                            </h3>
                                            <div className="relative max-w-xs flex-1 group/search">
                                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground group-focus-within/search:text-blue-500 transition-colors" size={13} />
                                                <input
                                                    type="text"
                                                    placeholder="Buscar por Sujeto..."
                                                    value={doorlogFilter}
                                                    onChange={(e) => {
                                                        setDoorlogFilter(e.target.value);
                                                        setDoorlogPage(1);
                                                    }}
                                                    className="w-full h-8 pl-8 pr-3 bg-card/50 border border-border rounded-lg text-[10px] font-medium text-foreground focus:border-blue-500/20 outline-none transition-all"
                                                />
                                            </div>
                                        </div>
                                        <Button size="sm" onClick={loadLogs} disabled={loadingLogs} className="bg-blue-600/10 hover:bg-blue-600 text-blue-500 hover:text-foreground h-7 px-3 rounded-md text-[9px] font-bold uppercase tracking-wide transition-all">
                                            <RefreshCw size={12} className={cn("mr-1.5", loadingLogs && "animate-spin")} />
                                            {loadingLogs ? "..." : "Actualizar"}
                                        </Button>
                                    </div>
                                    <div className="flex-1 mx-5 mb-4 border border-border rounded-lg overflow-hidden bg-black/40 flex flex-col min-h-0">
                                        <div className="overflow-auto flex-1 custom-scrollbar">
                                            <table className="w-full text-left border-separate border-spacing-0">
                                                <thead className="bg-card/80 backdrop-blur-md sticky top-0 z-10 text-[9px] font-bold text-muted-foreground uppercase tracking-wide border-b border-border">
                                                    <tr>
                                                        <th className="px-3 py-2 w-16 text-center">Bio</th>
                                                        <th className="px-3 py-2">Sujeto / Identidad</th>
                                                        <th className="px-3 py-2">Timestamp</th>
                                                        <th className="px-3 py-2 text-center">Estado</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-white/[0.02]">
                                                    {filteredDoorlogs.length === 0 ? (
                                                        <tr><td colSpan={4} className="py-16 text-center opacity-20"><div className="flex flex-col items-center gap-2"><History size={28} /><p className="text-[9px] font-bold uppercase tracking-wide">Sin registros</p></div></td></tr>
                                                    ) : filteredDoorlogs.slice((doorlogPage - 1) * itemsPerPage, doorlogPage * itemsPerPage).map((log, i) => (
                                                        <tr key={i} className="group/log hover:bg-foreground/[0.04] transition-colors">
                                                            <td className="px-3 py-2 text-center">
                                                                {(log.PicUrl || log.PicPath || log.pic_url || log.snap_path || log.PicName || log.ImageUrl) ? (
                                                                    <div
                                                                        onClick={() => {
                                                                            const path = log.PicUrl || log.PicPath || log.pic_url || log.snap_path || log.PicName || log.ImageUrl;
                                                                            setSelectedLogImage(`/io/api/proxy/device-image?deviceId=${device.id}&path=${encodeURIComponent(path)}`);
                                                                        }}
                                                                        className="relative w-9 h-9 rounded-md bg-card border border-border overflow-hidden mx-auto cursor-pointer group/thumb hover:ring-1 hover:ring-blue-500/50 transition-all"
                                                                    >
                                                                        <img
                                                                            src={`/io/api/proxy/device-image?deviceId=${device.id}&path=${encodeURIComponent(log.PicUrl || log.PicPath || log.pic_url || log.snap_path || log.PicName || log.ImageUrl)}`}
                                                                            className="w-full h-full object-cover"
                                                                            onError={(e) => { (e.target as any).src = "https://ui-avatars.com/api/?name=X&background=020202&color=444"; }}
                                                                        />
                                                                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover/thumb:opacity-100 flex items-center justify-center transition-opacity">
                                                                            <Eye size={12} className="text-foreground" />
                                                                        </div>
                                                                    </div>
                                                                ) : (
                                                                    <div className="w-9 h-9 rounded-md border border-dashed border-border flex items-center justify-center mx-auto text-[7px] font-bold text-muted-foreground uppercase bg-card/30">
                                                                        {log.Type || log.Event || 'Log'}
                                                                    </div>
                                                                )}
                                                            </td>
                                                            <td className="px-3 py-2">
                                                                <div className="flex flex-col gap-0.5">
                                                                    <div className="flex items-center gap-1.5">
                                                                        <div className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                                                                        <span className="font-bold text-foreground uppercase text-xs tracking-tight leading-none group-hover/log:text-blue-400 transition-colors">{log.Name || 'Sujeto Externo'}</span>
                                                                    </div>
                                                                    <div className="flex gap-1.5">
                                                                        <span className="text-[8px] font-bold text-blue-500/80 uppercase tracking-wide bg-blue-500/5 px-1.5 py-0 rounded border border-blue-500/10">{log.Card || log.CardSn || 'VIRTUAL'}</span>
                                                                        <span className="text-[7px] font-medium text-muted-foreground">ID: {log.LogID || 'N/A'}</span>
                                                                    </div>
                                                                </div>
                                                            </td>
                                                            <td className="px-3 py-2">
                                                                <div className="flex items-center gap-3">
                                                                    <span className="text-[10px] font-medium text-muted-foreground">{log.Date || '-'}</span>
                                                                    <span className="text-xs font-mono font-bold text-foreground">{log.Time || '-'}</span>
                                                                </div>
                                                            </td>
                                                            <td className="px-3 py-2 text-center">
                                                                <Badge className={cn(
                                                                    "text-[8px] font-bold uppercase px-2 py-0",
                                                                    log.Status === "0" || log.Status === 0
                                                                        ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                                                                        : "bg-rose-500/10 text-rose-400 border-rose-500/20"
                                                                )}>
                                                                    {log.Status === "0" || log.Status === 0 ? "Admitido" : "Rechazado"}
                                                                </Badge>
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                        <div className="h-10 bg-card border-t border-border flex items-center justify-between px-4 shrink-0">
                                            <p className="text-[9px] font-bold text-muted-foreground">Pág. {doorlogPage} / {Math.max(1, Math.ceil(filteredDoorlogs.length / itemsPerPage))}</p>
                                            <div className="flex gap-1.5">
                                                <Button size="sm" variant="ghost" disabled={doorlogPage === 1} onClick={() => setDoorlogPage(p => p - 1)} className="h-7 px-3 bg-card border border-border rounded-md text-[9px] font-bold uppercase text-muted-foreground hover:text-foreground transition-all">Anterior</Button>
                                                <Button size="sm" variant="ghost" disabled={filteredDoorlogs.length <= doorlogPage * itemsPerPage} onClick={() => setDoorlogPage(p => p + 1)} className="h-7 px-3 bg-card border border-border rounded-md text-[9px] font-bold uppercase text-muted-foreground hover:text-foreground transition-all">Siguiente</Button>
                                            </div>
                                        </div>
                                    </div>
                                </TabsContent>

                                <TabsContent value="calllog" className="flex-1 flex flex-col min-h-0 m-0 overflow-hidden">
                                    <div className="px-5 pt-3 pb-2 flex items-center justify-between shrink-0">
                                        <div className="flex items-center gap-3 flex-1">
                                            <h3 className="text-xs font-bold text-foreground uppercase tracking-tight flex items-center gap-2">
                                                <Phone className="text-blue-500" size={15} /> Historial de Llamadas
                                            </h3>
                                            <div className="relative max-w-xs flex-1 group/search">
                                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground group-focus-within/search:text-blue-500 transition-colors" size={13} />
                                                <input
                                                    type="text"
                                                    placeholder="Filtrar Llamada..."
                                                    value={calllogFilter}
                                                    onChange={(e) => {
                                                        setCalllogFilter(e.target.value);
                                                        setCalllogPage(1);
                                                    }}
                                                    className="w-full h-8 pl-8 pr-3 bg-card/50 border border-border rounded-lg text-[10px] font-medium text-foreground focus:border-blue-500/20 outline-none transition-all"
                                                />
                                            </div>
                                        </div>
                                        <Button size="sm" onClick={loadCallLogs} disabled={loadingCallLogs} className="bg-blue-600/10 hover:bg-blue-600 text-blue-500 hover:text-foreground h-7 px-3 rounded-md text-[9px] font-bold uppercase tracking-wide transition-all">
                                            <RefreshCw size={12} className={cn("mr-1.5", loadingCallLogs && "animate-spin")} />
                                            {loadingCallLogs ? "..." : "Actualizar"}
                                        </Button>
                                    </div>
                                    <div className="flex-1 mx-5 mb-4 border border-border rounded-lg overflow-hidden bg-black/40 flex flex-col min-h-0">
                                        <div className="overflow-auto flex-1 custom-scrollbar">
                                            <table className="w-full text-left border-separate border-spacing-0">
                                                <thead className="bg-card/80 backdrop-blur-md sticky top-0 z-10 text-[9px] font-bold text-muted-foreground uppercase tracking-wide border-b border-border">
                                                    <tr>
                                                        <th className="px-3 py-2">Fecha / Hora</th>
                                                        <th className="px-3 py-2">Interlocutor</th>
                                                        <th className="px-3 py-2 text-center">Tipo</th>
                                                        <th className="px-3 py-2 text-center">Estado</th>
                                                        <th className="px-3 py-2 text-center">Duración</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-white/[0.02]">
                                                    {filteredCalllogs.length === 0 ? (
                                                        <tr><td colSpan={5} className="py-16 text-center opacity-20"><div className="flex flex-col items-center gap-2"><Phone size={28} /><p className="text-[9px] font-bold uppercase tracking-wide">Sin llamadas</p></div></td></tr>
                                                    ) : filteredCalllogs.slice((calllogPage - 1) * itemsPerPage, calllogPage * itemsPerPage).map((log, i) => (
                                                        <tr key={i} className="group/call hover:bg-blue-500/[0.02] transition-colors">
                                                            <td className="px-3 py-2">
                                                                <div className="flex items-center gap-3">
                                                                    <span className="text-[10px] font-medium text-muted-foreground">{log.Date || 'Hoy'}</span>
                                                                    <span className="text-xs font-mono font-bold text-foreground">{log.Time}</span>
                                                                </div>
                                                            </td>
                                                            <td className="px-3 py-2">
                                                                <div className="flex flex-col">
                                                                    <span className="font-bold text-foreground uppercase text-xs tracking-tight group-hover/call:text-blue-400 transition-colors">
                                                                        {log.Name || log.Remote || 'Punto Remoto'}
                                                                    </span>
                                                                    <span className="text-[8px] font-medium text-muted-foreground">Destino: {log.Remote || 'Portería'}</span>
                                                                </div>
                                                            </td>
                                                            <td className="px-3 py-2 text-center">
                                                                <div className={cn(
                                                                    "w-8 h-8 rounded-md flex items-center justify-center mx-auto",
                                                                    log.Type === "0" ? "bg-blue-500/10 text-blue-500" : "bg-emerald-500/10 text-emerald-500"
                                                                )}>
                                                                    {log.Type === "0" ? <PhoneIncoming size={14} /> : <PhoneOutgoing size={14} />}
                                                                </div>
                                                            </td>
                                                            <td className="px-3 py-2 text-center">
                                                                <Badge className={cn(
                                                                    "text-[8px] font-bold uppercase px-2 py-0",
                                                                    log.Status === "1" ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" : "bg-rose-500/10 text-rose-400 border-rose-500/20"
                                                                )}>
                                                                    {log.Status === "1" ? "Exitosa" : "Perdida"}
                                                                </Badge>
                                                            </td>
                                                            <td className="px-3 py-2 text-center">
                                                                <span className="text-sm font-mono font-bold text-foreground">{log.Duration || "0"}<span className="text-[8px] text-muted-foreground ml-0.5">s</span></span>
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                        <div className="h-10 bg-card border-t border-border flex items-center justify-between px-4 shrink-0">
                                            <p className="text-[9px] font-bold text-muted-foreground">Pág. {calllogPage} / {Math.max(1, Math.ceil(filteredCalllogs.length / itemsPerPage))}</p>
                                            <div className="flex gap-1.5">
                                                <Button size="sm" variant="ghost" disabled={calllogPage === 1} onClick={() => setCalllogPage(p => p - 1)} className="h-7 px-3 bg-card border border-border rounded-md text-[9px] font-bold uppercase text-muted-foreground hover:text-foreground transition-all">Anterior</Button>
                                                <Button size="sm" variant="ghost" disabled={filteredCalllogs.length <= calllogPage * itemsPerPage} onClick={() => setCalllogPage(p => p + 1)} className="h-7 px-3 bg-card border border-border rounded-md text-[9px] font-bold uppercase text-muted-foreground hover:text-foreground transition-all">Siguiente</Button>
                                            </div>
                                        </div>
                                    </div>
                                </TabsContent>
                            </>
                        )}
                    </Tabs>
                </div>

                {/* VISOR DE IMAGEN OVERLAY */}
                {selectedLogImage && (
                    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/95 p-4" onClick={() => setSelectedLogImage(null)}>
                        <div className="relative max-w-3xl bg-card rounded-lg overflow-hidden border border-border shadow-lg">
                            <img src={selectedLogImage} className="max-w-full max-h-[80vh] object-contain" />
                            <Button
                                className="absolute top-3 right-3 bg-black/60 hover:bg-black text-white rounded-md w-8 h-8 p-0 backdrop-blur-md border border-border"
                                onClick={() => setSelectedLogImage(null)}
                            >
                                <X size={16} />
                            </Button>
                        </div>
                    </div>
                )}
            </DialogContent>
        </Dialog >
    );
}