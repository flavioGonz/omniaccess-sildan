"use client";

import { useState, useMemo } from "react";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
    ArrowRight,
    Download,
    Loader2,
    Database,
    HardDrive,
    CheckCircle2,
    AlertCircle,
    Info,
    ArrowDownToLine,
    Car,
    UserPlus,
    FileSpreadsheet,
    X,
    ShieldCheck
} from "lucide-react";
import { importPlateBatch } from "@/app/actions/devices";
import { cn } from "@/lib/utils";
import { sileo as toast } from "sileo";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";

interface LprImportPreviewDialogProps {
    device: any;
    cameraPlates: string[];
    localPlates: string[];
    localVehicles: string[];
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSuccess: () => void;
}

export function LprImportPreviewDialog({
    device,
    cameraPlates,
    localPlates,
    localVehicles,
    open,
    onOpenChange,
    onSuccess
}: LprImportPreviewDialogProps) {
    const [isImporting, setIsImporting] = useState(false);
    const [importProgress, setImportProgress] = useState(0);

    // Normalize for counting
    const normalize = (s: string) => s.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");

    const uniqueCameraPlates = useMemo(() => Array.from(new Set(cameraPlates.map(p => normalize(p)))), [cameraPlates]);
    const normalizedLocalPlates = useMemo(() => localPlates.map(p => normalize(p)), [localPlates]);
    const normalizedLocalVehicles = useMemo(() => localVehicles.map(v => normalize(v)), [localVehicles]);

    // Counters logic
    // 1. New Credentials (User + Credential) - Plates not in our Credential DB
    const newCredentialsCount = useMemo(() => uniqueCameraPlates.filter(cp => !normalizedLocalPlates.includes(cp)).length, [uniqueCameraPlates, normalizedLocalPlates]);

    // 2. New Vehicles - Plates not in our Vehicle DB
    // Note: A plate could be a new credential AND a new vehicle, or just a new vehicle (if cred existed but not vehicle? unlikely in this flow but possible)
    // Basically if we import, we ensure Vehicle exists. So any plate in Camera NOT in LocalVehicles will trigger a Vehicle creation.
    const newVehiclesCount = useMemo(() => uniqueCameraPlates.filter(cp => !normalizedLocalVehicles.includes(cp)).length, [uniqueCameraPlates, normalizedLocalVehicles]);

    // Total items to process (union of missing things)
    const platesToProcess = useMemo(() => {
        return uniqueCameraPlates.filter(cp => !normalizedLocalPlates.includes(cp) || !normalizedLocalVehicles.includes(cp));
    }, [uniqueCameraPlates, normalizedLocalPlates, normalizedLocalVehicles]);

    const totalToSync = platesToProcess.length;

    const handleConfirmImport = async () => {
        setIsImporting(true);
        setImportProgress(0);

        const BATCH_SIZE = 20;
        let processedCount = 0;
        let totalCreated = 0;

        try {
            // Split into batches
            for (let i = 0; i < platesToProcess.length; i += BATCH_SIZE) {
                const batch = platesToProcess.slice(i, i + BATCH_SIZE);
                const res = await importPlateBatch(device.id, batch);

                if (!res.success) throw new Error(res.message);

                totalCreated += res.count || 0;
                processedCount += batch.length;
                setImportProgress(Math.round((processedCount / totalToSync) * 100));
            }

            toast.success({ title: `Importación finalizada correctamente.` });
            onSuccess();
            onOpenChange(false);
        } catch (error: any) {
            toast.error({ title: `Error: ${error.message}` });
        } finally {
            setIsImporting(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-2xl p-0 gap-0 border-border bg-card overflow-hidden shadow-lg rounded-lg">

                {/* Header Premium */}
                <div className="relative overflow-hidden bg-card border-b border-border p-8 pb-10">
                    <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-blue-600 via-indigo-500 to-purple-600"></div>
                    <div className="absolute top-0 right-0 p-4 opacity-10">
                        <Database size={120} className="text-foreground transform rotate-12 translate-x-8 -translate-y-8" />
                    </div>

                    <div className="relative z-10 flex items-start justify-between">
                        <div className="space-y-2">
                            <div className="inline-flex items-center gap-2 px-3 py-1 rounded bg-blue-500/10 border border-blue-500/20 text-blue-400 text-[10px] font-bold uppercase tracking-widest mb-2">
                                <ArrowDownToLine size={12} />
                                <span>Import Wizard</span>
                            </div>
                            <DialogTitle className="text-3xl font-bold text-foreground tracking-tight">Sincronización LPR</DialogTitle>
                            <DialogDescription className="text-muted-foreground font-medium max-w-sm leading-relaxed">
                                Se importarán los datos desde el dispositivo físico hacia la base de datos de la App.
                            </DialogDescription>
                        </div>
                        <div className="text-right">
                            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-1">Dispositivo Origen</p>
                            <div className="flex items-center justify-end gap-2 text-foreground font-bold">
                                <HardDrive size={16} className="text-muted-foreground" />
                                {device?.name}
                            </div>
                            <p className="text-[10px] font-mono text-muted-foreground mt-0.5">{device?.ip}</p>
                        </div>
                    </div>

                    {isImporting && (
                        <div className="mt-8 relative">
                            <div className="flex justify-between text-[10px] font-bold uppercase text-blue-400 mb-2 tracking-widest">
                                <span className="flex items-center gap-2">
                                    <Loader2 className="animate-spin" size={12} /> Procesando Lotes
                                </span>
                                <span>{importProgress}% Completado</span>
                            </div>
                            <Progress value={importProgress} className="h-1.5 bg-muted" indicatorClassName="bg-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.5)]" />
                        </div>
                    )}
                </div>

                {/* Stats Grid */}
                <div className="p-8 bg-black/20">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div className="p-5 rounded-md bg-card/50 border border-border flex flex-col items-center justify-center text-center group hover:bg-card transition-colors">
                            <div className="mb-3 p-2 rounded-full bg-muted text-muted-foreground group-hover:text-foreground transition-colors">
                                <Database size={20} />
                            </div>
                            <span className="text-2xl font-bold text-foreground font-mono tracking-tighter mb-1">{uniqueCameraPlates.length}</span>
                            <span className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest">Total en Cámara</span>
                        </div>

                        <div className="p-5 rounded-md bg-indigo-500/5 border border-indigo-500/10 flex flex-col items-center justify-center text-center group hover:bg-indigo-500/10 transition-colors">
                            <div className="mb-3 p-2 rounded-full bg-indigo-500/20 text-indigo-400">
                                <UserPlus size={20} />
                            </div>
                            <span className="text-2xl font-bold text-indigo-400 font-mono tracking-tighter mb-1">+{newCredentialsCount}</span>
                            <span className="text-[9px] font-bold text-indigo-400/70 uppercase tracking-widest">Usuarios Nuevos</span>
                        </div>

                        <div className="p-5 rounded-md bg-blue-500/5 border border-blue-500/10 flex flex-col items-center justify-center text-center group hover:bg-blue-500/10 transition-colors">
                            <div className="mb-3 p-2 rounded-full bg-blue-500/20 text-blue-400">
                                <Car size={20} />
                            </div>
                            <span className="text-2xl font-bold text-blue-400 font-mono tracking-tighter mb-1">+{newVehiclesCount}</span>
                            <span className="text-[9px] font-bold text-blue-400/70 uppercase tracking-widest">Vehículos Nuevos</span>
                        </div>

                        <div className="p-5 rounded-md bg-emerald-500/5 border border-emerald-500/10 flex flex-col items-center justify-center text-center group hover:bg-emerald-500/10 transition-colors">
                            <div className="mb-3 p-2 rounded-full bg-emerald-500/20 text-emerald-400">
                                <FileSpreadsheet size={20} />
                            </div>
                            <span className="text-2xl font-bold text-emerald-400 font-mono tracking-tighter mb-1">{totalToSync}</span>
                            <span className="text-[9px] font-bold text-emerald-400/70 uppercase tracking-widest">A Procesar</span>
                        </div>
                    </div>
                </div>

                {/* Data Preview */}
                <div className="px-8 pb-8 space-y-4">
                    <div className="flex items-center justify-between">
                        <h4 className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest flex items-center gap-2">
                            <ShieldCheck size={12} />
                            Vista Previa de Importación
                        </h4>
                        <span className="text-[9px] text-muted-foreground font-mono">Mostrando max 50</span>
                    </div>

                    <div className="bg-card/50 rounded-md border border-border p-4 min-h-[120px]">
                        {platesToProcess.length === 0 ? (
                            <div className="flex flex-col items-center justify-center h-full py-8 opacity-50 space-y-3">
                                <CheckCircle2 size={32} className="text-emerald-500" />
                                <div className="text-center">
                                    <p className="text-sm font-bold text-foreground mb-1">¡Todo Sincronizado!</p>
                                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider">No hay nuevos datos para importar</p>
                                </div>
                            </div>
                        ) : (
                            <ScrollArea className="h-40 pr-3">
                                <div className="flex flex-wrap gap-2 content-start">
                                    {platesToProcess.slice(0, 50).map(plate => {
                                        const isNewUser = !normalizedLocalPlates.includes(plate);
                                        return (
                                            <Badge
                                                key={plate}
                                                variant="outline"
                                                className={cn(
                                                    "h-7 px-2.5 text-[10px] font-mono border-0",
                                                    isNewUser
                                                        ? "bg-indigo-500/10 text-indigo-400 hover:bg-indigo-500/20"
                                                        : "bg-muted text-muted-foreground"
                                                )}
                                            >
                                                {plate}
                                                {isNewUser && <span className="ml-1.5 w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse" />}
                                            </Badge>
                                        );
                                    })}
                                    {platesToProcess.length > 50 && (
                                        <div className="h-7 px-3 flex items-center justify-center rounded-sm bg-card text-[9px] font-bold text-muted-foreground uppercase border border-border">
                                            +{platesToProcess.length - 50} más...
                                        </div>
                                    )}
                                </div>
                            </ScrollArea>
                        )}
                    </div>

                    <div className="flex items-center gap-2 p-3 rounded-md bg-card border border-border">
                        <Info size={14} className="text-muted-foreground shrink-0" />
                        <p className="text-[10px] text-muted-foreground leading-snug">
                            <span className="text-indigo-400 font-bold">Nota:</span> Por cada matrícula nueva detectada, el sistema generará automáticamente un <span className="text-foreground font-bold">Usuario</span> y una <span className="text-foreground font-bold">Ficha de Vehículo</span> correspondientes en la sección administrativa.
                        </p>
                    </div>
                </div>

                {/* Footer Controls */}
                <div className="p-6 bg-card border-t border-border flex gap-4">
                    <Button
                        variant="ghost"
                        onClick={() => onOpenChange(false)}
                        disabled={isImporting}
                        className="flex-1 text-muted-foreground hover:text-foreground hover:bg-accent font-bold text-xs uppercase tracking-wider h-12 rounded-md transition-all"
                    >
                        <X size={16} className="mr-2" />
                        Cancelar Opveración
                    </Button>
                    <Button
                        onClick={handleConfirmImport}
                        disabled={isImporting || totalToSync === 0}
                        className={cn(
                            "flex-[2] text-foreground font-bold text-xs uppercase tracking-wider h-12 rounded-md shadow-xl transition-all",
                            totalToSync === 0
                                ? "bg-muted text-muted-foreground cursor-not-allowed"
                                : "bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 hover:scale-[1.02] shadow-blue-900/20"
                        )}
                    >
                        {isImporting ? <Loader2 className="animate-spin mr-2" /> : <Download className="mr-2" />}
                        {isImporting ? "Sincronizando..." : `Confirmar e Importar (${totalToSync})`}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
