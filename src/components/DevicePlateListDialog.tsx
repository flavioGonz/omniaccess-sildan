"use client";

import React, { useState, useEffect, useMemo } from "react";
import { getDevicePlatesPage, addDevicePlate, syncPlatesToDevice, getPlatesEnrichment } from "@/app/actions/devices";
import { getCredentials } from "@/app/actions/credentials";
import { getVehicles } from "@/app/actions/vehicles";
import { getUnitsWithDetails } from "@/app/actions/units";
import { getAccessGroups } from "@/app/actions/groups";
import { getParkingSlots } from "@/app/actions/plazas";
import { getDevices } from "@/app/actions/devices";
import { UserFormDialog } from "./UserFormDialog";
import { LprImportPreviewDialog } from "./LprImportPreviewDialog";
import { cn } from "@/lib/utils";
import { sileo as toast } from "sileo";
import { motion, AnimatePresence } from "framer-motion";
import { Progress } from "@/components/ui/progress";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from "@/components/ui/dialog";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    Car,
    Search,
    Trash2,
    Database,
    Loader2,
    ArrowDownToLine,
    Circle,
    Plus,
    UploadCloud,
    ChevronLeft,
    ChevronRight,
    PlayCircle,
    Filter,
    AlertTriangle,
    Info,
    CheckCircle2,
    XCircle,
    ShieldAlert,
    Camera,
    X
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

interface DevicePlateListDialogProps {
    device: any;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

const ITEMS_PER_PAGE = 9;

export function DevicePlateListDialog({ device, open, onOpenChange }: DevicePlateListDialogProps) {
    const [plates, setPlates] = useState<string[]>([]);
    const [localDetailMap, setLocalDetailMap] = useState<Record<string, { userName: string, hasVehicle: boolean }>>({});
    const [enrichmentMap, setEnrichmentMap] = useState<Record<string, { brand: string, color: string, model: string }>>({});
    const [localPlates, setLocalPlates] = useState<string[]>([]);
    const [loading, setLoading] = useState(false);
    const [fetchProgress, setFetchProgress] = useState(0);
    const [totalMatches, setTotalMatches] = useState(0);
    const [searchTerm, setSearchTerm] = useState("");
    const [newPlate, setNewPlate] = useState("");
    const [isAdding, setIsAdding] = useState(false);
    const [isSyncingToCamera, setIsSyncingToCamera] = useState(false);
    const [syncProgress, setSyncProgress] = useState(0);
    const [showImportPreview, setShowImportPreview] = useState(false);
    const [filterOnlyMissing, setFilterOnlyMissing] = useState(false);
    const [currentPage, setCurrentPage] = useState(1);

    // ── Splash de sincronización / importación ──
    const [ov, setOv] = useState<null | { mode: "up" | "down"; phase: "confirm" | "running" | "done" | "error"; msg?: string; count?: number; err?: string }>(null);
    const ovMsgTimer = React.useRef<any>(null);

    // ── Alta de usuario (matrícula = atributo del usuario) ──
    const [showUserForm, setShowUserForm] = useState(false);
    const [userFormData, setUserFormData] = useState<{ units: any[]; groups: any[]; devices: any[]; parkingSlots: any[] } | null>(null);
    const [loadingUserForm, setLoadingUserForm] = useState(false);
    const openNewUser = async () => {
        setLoadingUserForm(true);
        try {
            if (!userFormData) {
                const [units, groups, devs, slots] = await Promise.all([
                    getUnitsWithDetails().catch(() => []),
                    getAccessGroups().catch(() => []),
                    getDevices().catch(() => []),
                    getParkingSlots().catch(() => []),
                ]);
                setUserFormData({ units: (units as any) || [], groups: (groups as any) || [], devices: (devs as any) || [], parkingSlots: (slots as any) || [] });
            }
            setShowUserForm(true);
        } catch { toast.error({ title: "No se pudieron cargar los datos" }); }
        finally { setLoadingUserForm(false); }
    };

    // RESET STATE WHEN DEVICE CHANGES
    useEffect(() => {
        if (open) {
            setPlates([]);
            setTotalMatches(0);
            setFetchProgress(0);
            setSearchTerm("");
            setCurrentPage(1);
            loadLocalData();
        }
    }, [open, device?.id]);

    const loadLocalData = async () => {
        try {
            const [localCreds, vehiclesResult, enrichment] = await Promise.all([
                getCredentials(),
                getVehicles(),
                getPlatesEnrichment()
            ]);

            const normalize = (s: string) => s.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
            const detailMap: Record<string, { userName: string, hasVehicle: boolean }> = {};
            const credPlates: string[] = [];

            // Map known vehicles
            const vehicleData: Record<string, { brand: string, color: string, model: string }> = {};
            (vehiclesResult?.vehicles || []).forEach(v => {
                const norm = normalize(v.plate);
                vehicleData[norm] = {
                    brand: v.brand || enrichment[norm]?.brand || "Unknown",
                    model: v.model || enrichment[norm]?.model || "Unknown",
                    color: v.color || enrichment[norm]?.color || "Unknown"
                };
            });

            const vehiclePlatesSet = new Set(Object.keys(vehicleData));

            if (localCreds) {
                localCreds.filter(c => c.type === 'PLATE').forEach(c => {
                    const norm = normalize(c.value);
                    credPlates.push(norm);
                    detailMap[norm] = {
                        userName: c.user?.name || "N/A",
                        hasVehicle: vehiclePlatesSet.has(norm)
                    };
                });
            }

            setLocalPlates(Array.from(new Set(credPlates)));
            setLocalDetailMap(detailMap);
            // Combine enrichment from events with known vehicles
            setEnrichmentMap({ ...enrichment, ...vehicleData });
        } catch (e) {
            console.error("Local data load failed:", e);
        }
    };

    const loadPlates = async () => {
        if (!device?.id) return;
        setLoading(true);
        setFetchProgress(0);
        setPlates([]);
        setTotalMatches(0);
        setCurrentPage(1);
        try {
            await loadLocalData();

            const searchId = Date.now().toString(16).slice(-8);
            let start = 0;
            let keepFetching = true;
            let allCamPlates: string[] = [];
            let recordsProcessed = 0;

            const normalize = (s: string) => s.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");

            while (keepFetching) {
                const res = await getDevicePlatesPage(device.id, searchId, start) as any;
                if (!res.success) throw new Error(res.message);

                const normalizedBatch = res.plates.map((p: string) => normalize(p));
                allCamPlates = [...allCamPlates, ...normalizedBatch];

                setPlates(Array.from(new Set(allCamPlates)));

                const total = res.totalMatches || 0;
                setTotalMatches(total);

                recordsProcessed += res.numOfMatches;

                if (total > 0) {
                    const progress = Math.min(Math.round((recordsProcessed / total) * 100), 100);
                    setFetchProgress(progress);
                }

                if (res.isLastPage || recordsProcessed >= total || (total > 0 && start >= total)) {
                    keepFetching = false;
                } else {
                    start = recordsProcessed;
                }

                if (start > 15000) break;
            }
        } catch (error: any) {
            console.error("Fetch error:", error);
            toast.error({ title: `Error: ${error.message || "Conexión fallida"}` });
        } finally {
            setLoading(false);
            setFetchProgress(100);
        }
    };

    const handleAddPlate = async () => {
        const clean = newPlate.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
        if (!clean || clean.length < 3) {
            toast.error({ title: "Matrícula no válida" });
            return;
        }

        setIsAdding(true);
        try {
            const result = await addDevicePlate(device.id, clean);
            if (result.success) {
                toast.success({ title: result.message });
                setNewPlate("");
                loadPlates();
            } else {
                toast.error({ title: result.message });
            }
        } catch (error: any) {
            toast.error({ title: error.message });
        } finally {
            setIsAdding(false);
        }
    };

    // Mensajes animados por etapa mientras corre el server action (que no da progreso intermedio)
    const startStagedMessages = (mode: "up" | "down") => {
        const steps = mode === "up"
            ? ["Conectando con la cámara…", "Borrando lista anterior…", "Inyectando matrículas…", "Aplicando en la cámara… (puede demorar)"]
            : ["Conectando con la cámara…", "Descargando páginas…", "Cotejando con el sistema…", "Casi listo…"];
        let i = 0;
        setOv(o => o ? { ...o, msg: steps[0] } : o);
        const setter = mode === "up" ? setSyncProgress : setFetchProgress;
        clearInterval(ovMsgTimer.current);
        ovMsgTimer.current = setInterval(() => {
            i = Math.min(i + 1, steps.length - 1);
            setOv(o => o && o.phase === "running" ? { ...o, msg: steps[i] } : o);
            setter((p: number) => (p < 90 ? p + Math.max(2, Math.round((90 - p) / 6)) : p));
        }, 1100);
    };
    const stopStaged = () => { clearInterval(ovMsgTimer.current); };

    // SYNC (App → Cámara)
    const runSyncUp = async () => {
        setOv({ mode: "up", phase: "running", msg: "Preparando…", count: localPlates.length });
        setIsSyncingToCamera(true); setSyncProgress(6);
        startStagedMessages("up");
        try {
            const result = await syncPlatesToDevice(device.id);
            stopStaged();
            if (result.success) {
                setSyncProgress(100);
                setOv({ mode: "up", phase: "done", count: localPlates.length, msg: result.message });
                loadPlates();
            } else {
                setOv({ mode: "up", phase: "error", err: result.message });
            }
        } catch (error: any) {
            stopStaged();
            setOv({ mode: "up", phase: "error", err: error?.message || "Error de conexión" });
        } finally {
            setIsSyncingToCamera(false);
        }
    };

    // BAJAR (Cámara → App)
    const runDownload = async () => {
        setOv({ mode: "down", phase: "running", msg: "Preparando…" });
        startStagedMessages("down");
        try {
            await loadPlates();
            stopStaged();
            setFetchProgress(100);
            setOv({ mode: "down", phase: "done", count: totalMatches || plates.length, msg: "Lista de la cámara actualizada" });
        } catch (error: any) {
            stopStaged();
            setOv({ mode: "down", phase: "error", err: error?.message || "No se pudo leer la cámara" });
        }
    };

    // Abre el splash de confirmación (reemplaza los confirm() del navegador)
    const handleSyncClick = () => setOv({ mode: "up", phase: "confirm" });

    const handleDelete = async (plate: string) => {
        if (!confirm(`¿Eliminar matrícula ${plate} de la cámara?`)) return;
        toast.info({ title: "Borrado individual deshabilitado por seguridad." });
    };

    const allFilteredPlates = useMemo(() => {
        const uniquePool = Array.from(new Set([...plates, ...localPlates]));
        return uniquePool
            .filter(p => p.includes(searchTerm.toUpperCase()))
            .map(plate => {
                const inCamera = plates.includes(plate);
                const localInfo = localDetailMap[plate];
                const inLocal = !!localInfo;
                const residentName = localInfo?.userName || "";
                const enrichment = enrichmentMap[plate];

                return {
                    plate,
                    inCamera,
                    inLocal,
                    residentName,
                    brand: enrichment?.brand || null,
                    color: enrichment?.color || null
                };
            })
            .filter(item => !filterOnlyMissing || !item.inLocal)
            .sort((a, b) => a.plate.localeCompare(b.plate));
    }, [plates, localPlates, localDetailMap, enrichmentMap, searchTerm, filterOnlyMissing]);

    const totalPages = Math.max(1, Math.ceil(allFilteredPlates.length / ITEMS_PER_PAGE));
    const paginatedPlates = useMemo(() => {
        const start = (currentPage - 1) * ITEMS_PER_PAGE;
        return allFilteredPlates.slice(start, start + ITEMS_PER_PAGE);
    }, [allFilteredPlates, currentPage]);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                className="max-w-3xl h-[85vh] p-0 flex flex-col border-border bg-card overflow-hidden shadow-lg rounded-xl"
                onPointerDownOutside={(e) => e.preventDefault()}
            >
                {/* Fixed Header */}
                <DialogHeader className="p-6 pb-4 border-b border-border bg-background/50 shrink-0">
                    <div className="flex items-center justify-between gap-4">
                        <div className="flex items-center gap-4">
                            <div className="p-2.5 bg-card rounded-lg border border-border shadow-inner">
                                <Car className="w-6 h-6 text-indigo-500" />
                            </div>
                            <div>
                                <DialogTitle className="text-xl font-bold text-foreground uppercase tracking-tight leading-none mb-1">Listas Internas de Hardware</DialogTitle>
                                <DialogDescription className="text-[10px] text-muted-foreground font-bold uppercase tracking-widest">
                                    {device?.name} • {device?.ip}
                                </DialogDescription>
                            </div>
                        </div>

                        {/* Comparing Counters at Top - Redesigned */}
                        <div className="flex items-center gap-0 bg-card border border-border rounded-lg overflow-hidden h-10">
                            <TooltipProvider>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <div className="flex items-center gap-3 px-4 h-full hover:bg-accent transition-colors cursor-help border-r border-border">
                                            <div className="w-2 h-2 rounded-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.5)]" />
                                            <div className="flex flex-col leading-none">
                                                <span className="text-[10px] font-bold text-muted-foreground uppercase">Cámara</span>
                                                <span className="text-xs font-bold font-mono text-foreground">{totalMatches || plates.length}</span>
                                            </div>
                                        </div>
                                    </TooltipTrigger>
                                    <TooltipContent><p>Matrículas almacenadas actualmente en el dispositivo físico</p></TooltipContent>
                                </Tooltip>
                            </TooltipProvider>

                            <TooltipProvider>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <div className="flex items-center gap-3 px-4 h-full hover:bg-accent transition-colors cursor-help">
                                            <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
                                            <div className="flex flex-col leading-none">
                                                <span className="text-[10px] font-bold text-muted-foreground uppercase">Sistema</span>
                                                <span className="text-xs font-bold font-mono text-foreground">{localPlates.length}</span>
                                            </div>
                                        </div>
                                    </TooltipTrigger>
                                    <TooltipContent><p>Matrículas registradas en la base de datos de la App</p></TooltipContent>
                                </Tooltip>
                            </TooltipProvider>
                        </div>
                    </div>

                    {(loading || isSyncingToCamera) && (
                        <div className="mt-4 space-y-2">
                            <div className="flex justify-between text-[9px] uppercase font-bold tracking-widest text-indigo-400 font-mono">
                                <span className="flex items-center gap-2">
                                    <Loader2 className="w-3 h-3 animate-spin" />
                                    {isSyncingToCamera ? "Sincronizando con cámara..." : "Capturando hardware..."}
                                </span>
                                <span>{isSyncingToCamera ? syncProgress : fetchProgress}%</span>
                            </div>
                            <Progress value={isSyncingToCamera ? syncProgress : fetchProgress} className="h-1 bg-card" indicatorClassName="bg-indigo-500 shadow-[0_0_10px_rgba(99,102,241,0.5)]" />
                        </div>
                    )}

                    {/* Hikvision Wipe Warning */}
                    {device?.brand === 'HIKVISION' && !loading && !isSyncingToCamera && (
                        <div className="mt-4 flex items-center gap-3 p-3 rounded-lg bg-orange-500/5 border border-orange-500/10 text-orange-500/80">
                            <AlertTriangle className="w-4 h-4 shrink-0" />
                            <p className="text-[10px] uppercase font-bold tracking-wide">
                                Advertencia: La sincronización BORRARÁ la lista actual de la cámara y cargará la de la App.
                            </p>
                        </div>
                    )}
                </DialogHeader>

                {/* Main Content */}
                <div className="flex-1 !flex flex-col min-h-0 overflow-hidden px-8 py-6 gap-6">

                    {/* TOP SECTION: Add Plate and Search */}
                    <div className="flex flex-col gap-3 shrink-0">
                        {/* Alta de usuario (la matrícula es un atributo del usuario) */}
                        <Button
                            onClick={openNewUser}
                            disabled={loadingUserForm}
                            className="h-11 w-full rounded-lg bg-indigo-600 hover:bg-indigo-500 text-foreground font-bold text-xs uppercase tracking-widest shadow-lg shadow-indigo-900/20 gap-2"
                        >
                            {loadingUserForm ? <Loader2 className="animate-spin w-4 h-4" /> : <Plus className="w-4 h-4" />}
                            Nuevo usuario
                        </Button>

                        <div className="flex gap-2">
                            {/* Search */}
                            <div className="relative flex-1">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground w-4 h-4" />
                                <Input
                                    placeholder="Buscar en la lista..."
                                    value={searchTerm}
                                    onChange={(e) => {
                                        setSearchTerm(e.target.value);
                                        setCurrentPage(1);
                                    }}
                                    className="pl-10 h-10 border-border bg-card/60 text-xs font-bold rounded-lg focus:ring-1 focus:ring-border"
                                />
                            </div>

                            {/* Filter and Control Buttons */}
                            <div className="flex gap-2 shrink-0">
                                <TooltipProvider>
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <Button
                                                variant={filterOnlyMissing ? "default" : "outline"}
                                                size="icon"
                                                onClick={() => {
                                                    setFilterOnlyMissing(!filterOnlyMissing);
                                                    setCurrentPage(1);
                                                }}
                                                className={cn(
                                                    "h-10 w-10 rounded-lg transition-all",
                                                    filterOnlyMissing ? "bg-orange-600 hover:bg-orange-500 text-foreground border-transparent" : "border-border bg-card text-muted-foreground hover:bg-accent"
                                                )}
                                            >
                                                <Filter className="w-4 h-4" />
                                            </Button>
                                        </TooltipTrigger>
                                        <TooltipContent><p className="text-[10px] font-bold">Ver solo matrículas que faltan en BBDD</p></TooltipContent>
                                    </Tooltip>
                                </TooltipProvider>

                                <TooltipProvider>
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <Button
                                                variant="outline"
                                                size="icon"
                                                onClick={runDownload}
                                                disabled={loading}
                                                className="h-10 w-10 rounded-lg border-border bg-card text-muted-foreground hover:text-foreground hover:bg-accent"
                                            >
                                                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <PlayCircle className="w-4 h-4" />}
                                            </Button>
                                        </TooltipTrigger>
                                        <TooltipContent><p className="text-[10px] font-bold">Recargar Lista de Cámara</p></TooltipContent>
                                    </Tooltip>
                                </TooltipProvider>

                                <Button
                                    size="sm"
                                    onClick={() => setShowImportPreview(true)}
                                    disabled={loading || plates.length === 0}
                                    className="bg-blue-600 hover:bg-blue-500 text-foreground font-bold text-[9px] uppercase tracking-widest rounded-lg h-10 px-4 shadow-lg shadow-blue-900/20"
                                >
                                    Bajar
                                </Button>
                                <Button
                                    size="sm"
                                    onClick={handleSyncClick}
                                    disabled={loading || isSyncingToCamera}
                                    className="bg-emerald-600 hover:bg-emerald-500 text-foreground font-bold text-[9px] uppercase tracking-widest rounded-lg h-10 px-4 shadow-lg shadow-emerald-900/20"
                                >
                                    {isSyncingToCamera ? <Loader2 className="w-3 h-3 animate-spin" /> : <UploadCloud className="w-3 h-3 mr-2" />}
                                    Sync
                                </Button>
                            </div>
                        </div>
                    </div>

                    {/* Matrix View - Refined */}
                    <div className="flex-1 min-h-0 overflow-hidden flex flex-col bg-card/30 rounded-lg border border-border/50">
                        <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
                            {paginatedPlates.length === 0 ? (
                                <div className="h-full flex flex-col items-center justify-center text-muted-foreground opacity-30">
                                    <Database className="w-16 h-16 mb-4" />
                                    <p className="text-xs font-bold uppercase tracking-widest">Sin registros disponibles</p>
                                </div>
                            ) : (
                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                                    {paginatedPlates.map(({ plate, inCamera, inLocal, residentName, brand, color }) => (
                                        <div key={plate} className="group p-4 rounded-lg border border-border bg-black/40 hover:bg-card hover:border-border transition-all flex flex-col h-28 justify-between relative overflow-hidden">

                                            {/* Vehicle Background Decoration */}
                                            {localDetailMap[plate]?.hasVehicle && (
                                                <div className="absolute right-[-10%] bottom-[-20%] opacity-[0.03] group-hover:opacity-[0.06] transition-opacity pointer-events-none rotate-[-10deg]">
                                                    <Car className="w-24 h-24 text-foreground" />
                                                </div>
                                            )}

                                            <div>
                                                <div className="flex items-center justify-between mb-2">
                                                    <div className="flex gap-1.5">
                                                        <TooltipProvider>
                                                            <Tooltip>
                                                                <TooltipTrigger asChild>
                                                                    <div className={cn(
                                                                        "w-2 h-2 rounded-full",
                                                                        inLocal ? "bg-emerald-500 shadow-[0_0_5px_rgba(16,185,129,0.5)]" : "bg-muted border border-border"
                                                                    )} />
                                                                </TooltipTrigger>
                                                                <TooltipContent className="text-[10px] font-bold uppercase">
                                                                    {inLocal ? "Registrado en Sistema" : "No registrado en Sistema"}
                                                                </TooltipContent>
                                                            </Tooltip>
                                                        </TooltipProvider>

                                                        <TooltipProvider>
                                                            <Tooltip>
                                                                <TooltipTrigger asChild>
                                                                    <div className={cn(
                                                                        "w-2 h-2 rounded-full",
                                                                        inCamera ? "bg-blue-500 shadow-[0_0_5px_rgba(59,130,246,0.5)]" : "bg-muted border border-border"
                                                                    )} />
                                                                </TooltipTrigger>
                                                                <TooltipContent className="text-[10px] font-bold uppercase">
                                                                    {inCamera ? "Presente en Cámara" : "Falta en Cámara"}
                                                                </TooltipContent>
                                                            </Tooltip>
                                                        </TooltipProvider>
                                                    </div>

                                                    {inCamera && (
                                                        <TooltipProvider>
                                                            <Tooltip>
                                                                <TooltipTrigger asChild>
                                                                    <button
                                                                        className="text-muted-foreground hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100"
                                                                        onClick={(e) => { e.stopPropagation(); handleDelete(plate); }}
                                                                    >
                                                                        <Trash2 className="w-3.5 h-3.5" />
                                                                    </button>
                                                                </TooltipTrigger>
                                                                <TooltipContent><p className="text-[10px] uppercase font-bold text-red-400">Eliminar de Cámara</p></TooltipContent>
                                                            </Tooltip>
                                                        </TooltipProvider>
                                                    )}
                                                </div>
                                                <div className="text-xl font-bold font-mono text-foreground tracking-wider leading-none uppercase select-all group-hover:text-foreground transition-colors">
                                                    {plate}
                                                </div>
                                            </div>

                                            <div className="relative z-10">
                                                <div className="text-[10px] font-bold text-muted-foreground group-hover:text-muted-foreground truncate uppercase tracking-tight mb-0.5">
                                                    {residentName || "NO ASIGNADO"}
                                                </div>
                                                <div className="flex gap-2 text-[9px] font-medium uppercase tracking-wide">
                                                    <span className={cn("font-bold", brand && brand !== 'Unknown' ? "text-indigo-400" : "text-muted-foreground")}>
                                                        {brand && brand !== 'Unknown' ? brand : "---"}
                                                    </span>
                                                    <span className="text-muted-foreground">|</span>
                                                    <span className={cn(color && color !== 'Unknown' ? "text-muted-foreground" : "text-muted-foreground")}>
                                                        {color && color !== 'Unknown' ? color : "---"}
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Pagination Bar */}
                        {allFilteredPlates.length > ITEMS_PER_PAGE && (
                            <div className="p-3 border-t border-border bg-card/50 flex items-center justify-center gap-6 shrink-0">
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    disabled={currentPage === 1}
                                    onClick={() => setCurrentPage(p => p - 1)}
                                    className="w-8 h-8 rounded-lg text-muted-foreground hover:text-foreground"
                                >
                                    <ChevronLeft className="w-5 h-5" />
                                </Button>
                                <div className="flex items-center gap-2">
                                    <span className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest">Pág</span>
                                    <span className="text-[10px] font-bold text-foreground bg-foreground/10 w-6 h-6 flex items-center justify-center rounded border border-border">{currentPage}</span>
                                    <span className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest">de {totalPages}</span>
                                </div>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    disabled={currentPage === totalPages}
                                    onClick={() => setCurrentPage(p => p + 1)}
                                    className="w-8 h-8 rounded-lg text-muted-foreground hover:text-foreground"
                                >
                                    <ChevronRight className="w-5 h-5" />
                                </Button>
                            </div>
                        )}
                    </div>
                </div>

                {/* Status Footer - Concise */}
                <div className="px-6 py-3 border-t border-border bg-background flex justify-between items-center shrink-0">
                    <div className="flex gap-6 text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
                        <div className="flex items-center gap-2">
                            <div className="w-2 h-2 rounded-full bg-blue-500 shadow-[0_0_6px_rgba(59,130,246,0.4)]" />
                            <span>En Cámara</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.4)]" />
                            <span>En App</span>
                        </div>
                    </div>
                    <div className="text-[9px] font-mono text-muted-foreground uppercase">
                        Total Mostrado: {allFilteredPlates.length}
                    </div>
                </div>

                {/* ══════════ SPLASH DE SINCRONIZACIÓN / IMPORTACIÓN ══════════ */}
                <AnimatePresence>
                    {ov && (() => {
                        const prog = ov.mode === "up" ? syncProgress : fetchProgress;
                        const up = ov.mode === "up";
                        return (
                            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                                className="absolute inset-0 z-50 flex items-center justify-center bg-card/95 backdrop-blur-xl">
                                <motion.div initial={{ scale: 0.94, y: 12 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.96, opacity: 0 }}
                                    className="w-full max-w-md px-8 py-10 text-center">

                                    {/* Escena animada App ⇄ Cámara (centrada) */}
                                    {(ov.phase === "confirm" || ov.phase === "running") && (
                                        <div className="mx-auto mb-8 flex items-center justify-center gap-4">
                                            <div className="flex flex-col items-center gap-1.5">
                                                <div className="w-16 h-16 rounded-full bg-emerald-500/10 border-2 border-emerald-500/40 flex items-center justify-center text-emerald-500"><Database className="w-7 h-7" /></div>
                                                <span className="text-[9px] font-bold uppercase tracking-widest text-emerald-500">App</span>
                                            </div>
                                            <div className="relative w-24 h-16 flex items-center">
                                                <div className="w-full border-t-2 border-dashed border-border" />
                                                {ov.phase === "running" && [0, 1, 2].map(i => (
                                                    <motion.span key={i} className={cn("absolute top-1/2 -mt-1.5 w-4 h-3 rounded-sm", up ? "bg-emerald-500" : "bg-blue-500")}
                                                        initial={{ left: up ? "0%" : "100%", opacity: 0 }}
                                                        animate={{ left: up ? ["0%", "100%"] : ["100%", "0%"], opacity: [0, 1, 1, 0] }}
                                                        transition={{ duration: 1.6, repeat: Infinity, delay: i * 0.5, ease: "easeInOut" }} />
                                                ))}
                                            </div>
                                            <div className="flex flex-col items-center gap-1.5">
                                                <div className="w-16 h-16 rounded-full bg-blue-500/10 border-2 border-blue-500/40 flex items-center justify-center text-blue-500"><Camera className="w-7 h-7" /></div>
                                                <span className="text-[9px] font-bold uppercase tracking-widest text-blue-500">Cámara</span>
                                            </div>
                                        </div>
                                    )}

                                    {/* ── CONFIRMACIÓN ── */}
                                    {ov.phase === "confirm" && (
                                        <>
                                            <div className="mx-auto mb-3 flex items-center justify-center gap-2 text-orange-500">
                                                <ShieldAlert className="w-5 h-5" />
                                                <h3 className="text-lg font-black uppercase tracking-tight">Sobrescribir la cámara</h3>
                                            </div>
                                            <p className="text-sm text-muted-foreground font-medium leading-relaxed">
                                                Se cargarán las <b className="text-foreground">{localPlates.length}</b> matrículas del sistema en la cámara. <br />
                                                <span className="text-orange-500 font-bold">La lista interna actual de la cámara se reemplaza</span> — lo que esté solo en la cámara se perderá.
                                            </p>
                                            <div className="mt-8 flex gap-3">
                                                <Button variant="outline" className="flex-1 h-12 rounded-xl font-bold uppercase text-xs" onClick={() => setOv(null)}>Cancelar</Button>
                                                <Button className="flex-1 h-12 rounded-xl font-bold uppercase text-xs bg-emerald-600 hover:bg-emerald-500 text-white gap-2" onClick={runSyncUp}>
                                                    <UploadCloud className="w-4 h-4" /> Sí, sincronizar
                                                </Button>
                                            </div>
                                        </>
                                    )}

                                    {/* ── EN PROCESO ── */}
                                    {ov.phase === "running" && (
                                        <>
                                            <div className="relative mx-auto mb-4 w-20 h-20">
                                                {prog < 90 ? (
                                                    <>
                                                        <svg viewBox="0 0 80 80" className="w-full h-full -rotate-90">
                                                            <circle cx="40" cy="40" r="34" className="fill-none stroke-border" strokeWidth="6" />
                                                            <circle cx="40" cy="40" r="34" className={cn("fill-none", up ? "stroke-emerald-500" : "stroke-blue-500")} strokeWidth="6" strokeLinecap="round"
                                                                strokeDasharray={2 * Math.PI * 34} strokeDashoffset={2 * Math.PI * 34 * (1 - Math.min(prog, 100) / 100)} style={{ transition: "stroke-dashoffset 0.5s ease" }} />
                                                        </svg>
                                                        <div className="absolute inset-0 flex items-center justify-center text-lg font-black tabular-nums">{Math.round(Math.min(prog, 100))}%</div>
                                                    </>
                                                ) : (
                                                    <div className="w-full h-full flex items-center justify-center"><Loader2 className={cn("w-12 h-12 animate-spin", up ? "text-emerald-500" : "text-blue-500")} /></div>
                                                )}
                                            </div>
                                            <h3 className="text-lg font-black uppercase tracking-tight">{up ? "Inyectando matrículas" : "Descargando de la cámara"}</h3>
                                            {typeof ov.count === "number" && ov.count > 0 && (
                                                <p className="mt-1 text-xs font-bold text-muted-foreground uppercase tracking-wider">{ov.count} matrículas</p>
                                            )}
                                            <AnimatePresence mode="wait">
                                                <motion.p key={ov.msg} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} className="mt-2 text-sm text-muted-foreground font-semibold h-5">
                                                    {ov.msg}
                                                </motion.p>
                                            </AnimatePresence>
                                        </>
                                    )}

                                    {/* ── LISTO ── */}
                                    {ov.phase === "done" && (
                                        <>
                                            <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", bounce: 0.5 }} className="mx-auto mb-5 w-20 h-20 rounded-full bg-emerald-500/15 flex items-center justify-center text-emerald-500">
                                                <CheckCircle2 className="w-11 h-11" />
                                            </motion.div>
                                            <h3 className="text-xl font-black uppercase tracking-tight text-emerald-500">¡Listo!</h3>
                                            <p className="mt-2 text-sm text-muted-foreground font-semibold">{ov.msg || (up ? "Matrículas cargadas en la cámara" : "Lista actualizada")}</p>
                                            {typeof ov.count === "number" && <p className="mt-1 text-3xl font-black tabular-nums">{ov.count} <span className="text-sm font-bold text-muted-foreground uppercase">matrículas</span></p>}
                                            <Button className="mt-8 w-full h-12 rounded-xl font-bold uppercase text-xs bg-emerald-600 hover:bg-emerald-500 text-white" onClick={() => setOv(null)}>Listo</Button>
                                        </>
                                    )}

                                    {/* ── ERROR ── */}
                                    {ov.phase === "error" && (
                                        <>
                                            <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", bounce: 0.5 }} className="mx-auto mb-5 w-20 h-20 rounded-full bg-red-500/15 flex items-center justify-center text-red-500">
                                                <XCircle className="w-11 h-11" />
                                            </motion.div>
                                            <h3 className="text-xl font-black uppercase tracking-tight text-red-500">No se pudo completar</h3>
                                            <p className="mt-2 text-sm text-muted-foreground font-semibold break-words">{ov.err}</p>
                                            <div className="mt-8 flex gap-3">
                                                <Button variant="outline" className="flex-1 h-12 rounded-xl font-bold uppercase text-xs" onClick={() => setOv(null)}>Cerrar</Button>
                                                <Button className="flex-1 h-12 rounded-xl font-bold uppercase text-xs bg-emerald-600 hover:bg-emerald-500 text-white" onClick={() => (up ? runSyncUp() : runDownload())}>Reintentar</Button>
                                            </div>
                                        </>
                                    )}
                                </motion.div>
                            </motion.div>
                        );
                    })()}
                </AnimatePresence>
            </DialogContent>

            {showImportPreview && (
                <LprImportPreviewDialog
                    device={device}
                    cameraPlates={plates}
                    localPlates={localPlates}
                    localVehicles={Object.keys(localDetailMap).filter(p => localDetailMap[p].hasVehicle)}
                    open={showImportPreview}
                    onOpenChange={setShowImportPreview}
                    onSuccess={loadPlates}
                />
            )}

            {showUserForm && userFormData && (
                <UserFormDialog
                    open={showUserForm}
                    onOpenChange={setShowUserForm}
                    units={userFormData.units}
                    groups={userFormData.groups}
                    devices={userFormData.devices}
                    parkingSlots={userFormData.parkingSlots}
                    onSuccess={() => { setShowUserForm(false); loadLocalData(); }}
                />
            )}
        </Dialog>
    );
}
