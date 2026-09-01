"use client";

import { useState } from "react";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, Camera, AlertTriangle, CheckCircle2, XCircle, Server, Database, ArrowRight } from "lucide-react";
import { sileo as toast } from "sileo";
import { syncPlatesToAllDevices } from "@/app/actions/devices";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip";

interface SyncToDevicesDialogProps {
    onSuccess: () => void;
}

export function SyncToDevicesDialog({ onSuccess }: SyncToDevicesDialogProps) {
    const [open, setOpen] = useState(false);
    const [syncing, setSyncing] = useState(false);
    const [results, setResults] = useState<any>(null);
    const [confirmed, setConfirmed] = useState(false);

    const handleSync = async () => {
        setSyncing(true);
        setResults(null);

        try {
            const result = await syncPlatesToAllDevices();

            if (result.success) {
                setResults(result);
                toast.success({ title: `Sincronización completada en ${result.totalDevices} dispositivos` });
                onSuccess();
            } else {
                toast.error({ title: result.message || "Error en la sincronización" });
            }
        } catch (error: any) {
            console.error(error);
            toast.error({ title: "Error del servidor" });
        } finally {
            setSyncing(false);
        }
    };

    const handleClose = () => {
        setOpen(false);
        setConfirmed(false);
        setResults(null);
    };

    return (
        <>
            <Tooltip>
                <TooltipTrigger asChild>
                    <Button
                        variant="outline"
                        size="icon"
                        onClick={() => setOpen(true)}
                        className="bg-indigo-600/10 border-indigo-600/20 text-indigo-400 hover:bg-indigo-600/20 h-8 w-8"
                    >
                        <Camera size={16} />
                    </Button>
                </TooltipTrigger>
                <TooltipContent>
                    <p>Enviar a Dispositivos LPR</p>
                </TooltipContent>
            </Tooltip>

            <Dialog open={open} onOpenChange={handleClose}>
                <DialogContent className="max-w-3xl bg-card border border-border p-0 overflow-hidden">
                    <DialogHeader className="p-6 bg-card border-b border-border">
                        <DialogTitle className="text-xl font-bold text-foreground uppercase flex items-center gap-3">
                            <div className="p-2 bg-indigo-600/10 rounded border border-indigo-600/20">
                                <Camera className="text-indigo-400" size={24} />
                            </div>
                            Sincronización Masiva a Dispositivos
                        </DialogTitle>
                        <DialogDescription className="text-muted-foreground">
                            Este proceso enviará todas las matrículas de la base de datos a todos los dispositivos LPR compatibles.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="p-6 space-y-6">
                        {!confirmed && !results && (
                            <>
                                {/* Warning Section */}
                                <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-4 flex items-start gap-3">
                                    <AlertTriangle className="text-amber-500 flex-shrink-0 mt-0.5" size={20} />
                                    <div className="flex-1">
                                        <h3 className="text-sm font-bold text-amber-500 uppercase tracking-wide mb-1">
                                            ⚠️ Proceso Disruptivo
                                        </h3>
                                        <p className="text-xs text-muted-foreground leading-relaxed">
                                            Este proceso <span className="font-bold text-amber-400">borrará completamente</span> las listas actuales
                                            de matrículas en cada cámara y las reemplazará con todas las matrículas registradas en la base de datos.
                                        </p>
                                        <p className="text-xs text-muted-foreground mt-2">
                                            Las cámaras quedarán temporalmente sin acceso durante el proceso de sincronización.
                                        </p>
                                    </div>
                                </div>

                                {/* Process Flow */}
                                <div className="bg-card rounded-lg p-4 border border-border">
                                    <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-3">
                                        Flujo del Proceso
                                    </h4>
                                    <div className="space-y-2">
                                        <div className="flex items-center gap-3 text-xs">
                                            <div className="w-6 h-6 rounded-full bg-indigo-600/20 text-indigo-400 flex items-center justify-center font-bold">
                                                1
                                            </div>
                                            <Database size={14} className="text-muted-foreground" />
                                            <span className="text-muted-foreground">Obtener todas las matrículas de la base de datos</span>
                                        </div>
                                        <div className="flex items-center gap-3 text-xs">
                                            <div className="w-6 h-6 rounded-full bg-indigo-600/20 text-indigo-400 flex items-center justify-center font-bold">
                                                2
                                            </div>
                                            <Server size={14} className="text-muted-foreground" />
                                            <span className="text-muted-foreground">Conectar con cada dispositivo LPR</span>
                                        </div>
                                        <div className="flex items-center gap-3 text-xs">
                                            <div className="w-6 h-6 rounded-full bg-red-600/20 text-red-400 flex items-center justify-center font-bold">
                                                3
                                            </div>
                                            <XCircle size={14} className="text-red-400" />
                                            <span className="text-muted-foreground">
                                                <span className="font-bold text-red-400">Borrar lista actual</span> de cada cámara
                                            </span>
                                        </div>
                                        <div className="flex items-center gap-3 text-xs">
                                            <div className="w-6 h-6 rounded-full bg-emerald-600/20 text-emerald-400 flex items-center justify-center font-bold">
                                                4
                                            </div>
                                            <ArrowRight size={14} className="text-emerald-400" />
                                            <span className="text-muted-foreground">Enviar todas las matrículas a cada dispositivo</span>
                                        </div>
                                    </div>
                                </div>

                                {/* Confirmation */}
                                <div className="flex justify-end gap-3 pt-4 border-t border-border">
                                    <Button variant="ghost" onClick={handleClose}>
                                        Cancelar
                                    </Button>
                                    <Button
                                        onClick={() => setConfirmed(true)}
                                        className="bg-indigo-600 hover:bg-indigo-500 text-foreground"
                                    >
                                        Continuar
                                    </Button>
                                </div>
                            </>
                        )}

                        {confirmed && !results && (
                            <>
                                <div className="bg-card rounded-lg p-6 border border-border text-center">
                                    <p className="text-sm text-muted-foreground mb-4">
                                        ¿Estás seguro de que deseas sincronizar todas las matrículas a todos los dispositivos LPR?
                                    </p>
                                    <p className="text-xs text-amber-400 font-bold mb-6">
                                        Esta acción no se puede deshacer y puede tardar varios minutos.
                                    </p>
                                </div>

                                <div className="flex justify-end gap-3 pt-4 border-t border-border">
                                    <Button variant="ghost" onClick={() => setConfirmed(false)} disabled={syncing}>
                                        Volver
                                    </Button>
                                    <Button
                                        onClick={handleSync}
                                        disabled={syncing}
                                        className="bg-red-600 hover:bg-red-500 text-foreground"
                                    >
                                        {syncing ? (
                                            <>
                                                <Loader2 className="animate-spin mr-2" size={16} />
                                                Sincronizando...
                                            </>
                                        ) : (
                                            <>
                                                <Camera className="mr-2" size={16} />
                                                Confirmar Sincronización
                                            </>
                                        )}
                                    </Button>
                                </div>
                            </>
                        )}

                        {results && (
                            <>
                                <div className="space-y-4">
                                    {/* Summary */}
                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="bg-card rounded-lg p-4 border border-border">
                                            <p className="text-[10px] text-muted-foreground uppercase tracking-widest mb-1">
                                                Dispositivos Procesados
                                            </p>
                                            <p className="text-2xl font-bold text-foreground">
                                                {results.totalDevices}
                                            </p>
                                        </div>
                                        <div className="bg-card rounded-lg p-4 border border-border">
                                            <p className="text-[10px] text-muted-foreground uppercase tracking-widest mb-1">
                                                Matrículas Enviadas
                                            </p>
                                            <p className="text-2xl font-bold text-foreground">
                                                {results.totalPlates}
                                            </p>
                                        </div>
                                    </div>

                                    {/* Results List */}
                                    <div className="border border-border rounded-lg overflow-hidden bg-black/20">
                                        <div className="p-3 bg-foreground/10 border-b border-border text-[10px] font-bold uppercase text-muted-foreground tracking-widest">
                                            Resultados por Dispositivo
                                        </div>
                                        <ScrollArea className="h-64">
                                            <div className="p-2 space-y-2">
                                                {results.results.map((result: any, idx: number) => (
                                                    <div
                                                        key={idx}
                                                        className={`p-3 rounded-lg border ${result.success
                                                                ? "bg-emerald-500/5 border-emerald-500/20"
                                                                : "bg-red-500/5 border-red-500/20"
                                                            }`}
                                                    >
                                                        <div className="flex items-start justify-between mb-2">
                                                            <div className="flex items-center gap-2">
                                                                {result.success ? (
                                                                    <CheckCircle2 className="text-emerald-400" size={16} />
                                                                ) : (
                                                                    <XCircle className="text-red-400" size={16} />
                                                                )}
                                                                <div>
                                                                    <p className="text-sm font-bold text-foreground">
                                                                        {result.deviceName}
                                                                    </p>
                                                                    <p className="text-xs text-muted-foreground font-mono">
                                                                        {result.deviceIp}
                                                                    </p>
                                                                </div>
                                                            </div>
                                                            <Badge
                                                                variant="outline"
                                                                className={
                                                                    result.success
                                                                        ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                                                                        : "bg-red-500/10 text-red-400 border-red-500/20"
                                                                }
                                                            >
                                                                {result.success ? "Exitoso" : "Error"}
                                                            </Badge>
                                                        </div>

                                                        {result.success ? (
                                                            <div className="flex items-center gap-4 text-xs text-muted-foreground">
                                                                <span>
                                                                    Anterior: <span className="font-mono text-muted-foreground">{result.previousCount}</span>
                                                                </span>
                                                                <ArrowRight size={12} className="text-muted-foreground" />
                                                                <span>
                                                                    Sincronizadas: <span className="font-mono text-emerald-400">{result.syncedCount}</span>
                                                                </span>
                                                                {result.failedCount > 0 && (
                                                                    <span className="text-red-400">
                                                                        Fallidas: <span className="font-mono">{result.failedCount}</span>
                                                                    </span>
                                                                )}
                                                            </div>
                                                        ) : (
                                                            <p className="text-xs text-red-400 mt-1">
                                                                {result.error}
                                                            </p>
                                                        )}
                                                    </div>
                                                ))}
                                            </div>
                                        </ScrollArea>
                                    </div>
                                </div>

                                <div className="flex justify-end gap-3 pt-4 border-t border-border">
                                    <Button onClick={handleClose} className="bg-indigo-600 hover:bg-indigo-500 text-foreground">
                                        Cerrar
                                    </Button>
                                </div>
                            </>
                        )}
                    </div>
                </DialogContent>
            </Dialog>
        </>
    );
}
