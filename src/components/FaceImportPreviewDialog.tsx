
import { useState } from "react";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import {
    Loader2,
    CheckCircle2,
    AlertTriangle,
    Save,
    ScanFace,
    ArrowRight,
    UserPlus,
    IdCard,
    X,
    Info,
    RotateCw
} from "lucide-react";
import { sileo as toast } from "sileo";
import { importFaceBatch } from "@/app/actions/devices"; // We will create this
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";

interface FaceImportPreviewDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    deviceId: string;
    faces: any[]; // Array of faces from device
    existingUsers: any[]; // System users
    onSuccess: () => void;
}

export function FaceImportPreviewDialog({
    open,
    onOpenChange,
    deviceId,
    faces,
    existingUsers,
    onSuccess
}: FaceImportPreviewDialogProps) {
    const [importing, setImporting] = useState(false);
    const [result, setResult] = useState<{ success: number; failed: number } | null>(null);

    // Filter faces that are NOT in existingUsers (by ID or Name match)
    // Assuming face object has { UserID, Name }
    const newFaces = faces.filter(f => {
        // Check by ID (dni/employeeNo) or Name
        // Adjust matching logic based on your needs.
        // Usually employeeNo (f.UserID) matches User.dni
        const existsByDni = existingUsers.some(u => u.dni === f.UserID);
        // Also check by Name if ID is not reliable or if we want to avoid duplicates by name
        // const existsByName = existingUsers.some(u => u.name.toLowerCase() === f.Name.toLowerCase());

        return !existsByDni;
    });

    const countNewUsers = newFaces.length;
    // Every new face implies a new credential (FACE type)
    const countNewCredentials = newFaces.length;

    const handleImport = async () => {
        setImporting(true);
        try {
            const result = await importFaceBatch(deviceId, newFaces);
            setResult({ success: result.count || 0, failed: result.failed || 0 });
            toast.success({ title: `Importación completada: ${result.count || 0} usuarios creados.` });
            onSuccess();
        } catch (error) {
            console.error(error);
            toast.error({ title: "Error al importar rostros." });
        } finally {
            setImporting(false);
        }
    };

    const handleClose = () => {
        setResult(null);
        onOpenChange(false);
    };

    return (
        <Dialog open={open} onOpenChange={handleClose}>
            <DialogContent className="max-w-2xl bg-card border border-border shadow-[0_0_50px_rgba(0,0,0,0.5)] p-0 gap-0 overflow-hidden rounded-md">
                <div className="p-6 bg-gradient-to-b from-[#111] to-[#09090b]">
                    <DialogHeader className="mb-6">
                        <div className="flex items-center gap-3 mb-2">
                            <div className="p-3 rounded-lg bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 shadow-[0_0_15px_rgba(99,102,241,0.15)]">
                                <ScanFace size={24} />
                            </div>
                            <div>
                                <DialogTitle className="text-xl font-bold text-foreground tracking-tight">Importar Usuarios de Rostro</DialogTitle>
                                <DialogDescription className="text-muted-foreground text-xs font-medium uppercase tracking-wider mt-1">
                                    Sincronización desde Dispositivo
                                </DialogDescription>
                            </div>
                        </div>
                    </DialogHeader>

                    {!result ? (
                        <div className="space-y-6">
                            {/* Summary Cards */}
                            <div className="grid grid-cols-3 gap-3">
                                <div className="p-4 rounded-md bg-card/50 border border-border flex flex-col items-center justify-center text-center">
                                    <span className="text-2xl font-bold text-foreground font-mono tracking-tighter mb-1">{faces.length}</span>
                                    <span className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest">Total en Equipo</span>
                                </div>

                                <div className="p-4 rounded-md bg-indigo-500/5 border border-indigo-500/10 flex flex-col items-center justify-center text-center group hover:bg-indigo-500/10 transition-colors">
                                    <div className="mb-2 p-1.5 rounded-full bg-indigo-500/20 text-indigo-400">
                                        <UserPlus size={16} />
                                    </div>
                                    <span className="text-xl font-bold text-indigo-400 font-mono tracking-tighter mb-1">+{countNewUsers}</span>
                                    <span className="text-[8px] font-bold text-indigo-400/70 uppercase tracking-widest">Usuarios Nuevos</span>
                                </div>

                                <div className="p-4 rounded-md bg-emerald-500/5 border border-emerald-500/10 flex flex-col items-center justify-center text-center group hover:bg-emerald-500/10 transition-colors">
                                    <div className="mb-2 p-1.5 rounded-full bg-emerald-500/20 text-emerald-400">
                                        <ArrowRight size={16} />
                                    </div>
                                    <span className="text-xl font-bold text-emerald-400 font-mono tracking-tighter mb-1">{countNewUsers}</span>
                                    <span className="text-[8px] font-bold text-emerald-400/70 uppercase tracking-widest">A Importar</span>
                                </div>
                            </div>

                            {/* Detailed List Preview */}
                            <div className="border border-border rounded-md overflow-hidden flex flex-col h-64 bg-black/20">
                                <div className="bg-foreground/10 px-4 py-2 border-b border-border flex justify-between items-center">
                                    <h3 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Vista Previa de Importación</h3>
                                    <span className="text-[9px] font-mono text-muted-foreground">{newFaces.length} items</span>
                                </div>
                                <ScrollArea className="flex-1">
                                    {newFaces.length === 0 ? (
                                        <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
                                            <CheckCircle2 size={24} className="opacity-20" />
                                            <p className="text-xs font-medium">Todos los usuarios ya existen en el sistema.</p>
                                        </div>
                                    ) : (
                                        <div className="divide-y divide-white/5">
                                            {newFaces.slice(0, 100).map((face, idx) => (
                                                <div key={idx} className="px-4 py-3 flex items-center justify-between group hover:bg-accent transition-colors">
                                                    <div className="flex items-center gap-3">
                                                        <div className="w-1.5 h-1.5 rounded-full bg-indigo-500 shadow-[0_0_8px_rgba(99,102,241,0.5)] animate-pulse" />
                                                        <div>
                                                            <div className="text-xs font-bold text-foreground group-hover:text-indigo-300 transition-colors">{face.Name}</div>
                                                            <div className="text-[10px] font-mono text-muted-foreground">ID: {face.UserID}</div>
                                                        </div>
                                                    </div>
                                                    <div className="flex items-center gap-2">
                                                        <span className="px-1.5 py-0.5 rounded text-[8px] font-bold uppercase bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">Nuevo Usuario</span>
                                                    </div>
                                                </div>
                                            ))}
                                            {newFaces.length > 100 && (
                                                <div className="px-4 py-2 text-center text-[10px] text-muted-foreground italic">
                                                    ... y {newFaces.length - 100} más
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </ScrollArea>
                            </div>

                            <div className="flex items-center gap-2 p-3 rounded-md bg-card border border-border">
                                <Info size={14} className="text-muted-foreground shrink-0" />
                                <p className="text-[10px] text-muted-foreground leading-snug">
                                    <span className="text-indigo-400 font-bold">Nota:</span> Se creará un <span className="text-foreground font-bold">Usuario</span> y una credencial biométrica <span className="text-foreground font-bold">FACE</span> por cada registro seleccionado.
                                </p>
                            </div>

                            <div className="flex items-center gap-3 pt-2">
                                <Button
                                    variant="outline"
                                    onClick={() => onOpenChange(false)}
                                    className="flex-1 border-border hover:bg-accent text-muted-foreground hover:text-foreground uppercase font-bold text-xs h-10 tracking-wider"
                                >
                                    <X className="mr-2 h-3.5 w-3.5" />
                                    Cancelar
                                </Button>
                                <Button
                                    onClick={handleImport}
                                    disabled={importing || newFaces.length === 0}
                                    className="flex-[2] bg-indigo-600 hover:bg-indigo-500 text-foreground border-0 shadow-[0_0_20px_rgba(79,70,229,0.2)] uppercase font-bold text-xs h-10 tracking-wider"
                                >
                                    {importing ? (
                                        <>
                                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                            Importando...
                                        </>
                                    ) : (
                                        <>
                                            <Save className="mr-2 h-4 w-4" />
                                            Confirmar e Importar ({countNewUsers})
                                        </>
                                    )}
                                </Button>
                            </div>
                        </div>
                    ) : (
                        <div className="flex flex-col items-center justify-center py-8 space-y-6 animate-in fade-in zoom-in-95 duration-300">
                            <div className="w-20 h-20 rounded-full bg-emerald-500/10 flex items-center justify-center border border-emerald-500/20 shadow-[0_0_40px_rgba(16,185,129,0.1)]">
                                <CheckCircle2 size={40} className="text-emerald-500" />
                            </div>
                            <div className="text-center space-y-2">
                                <h3 className="text-xl font-bold uppercase text-foreground tracking-tight">Importación Exitosa</h3>
                                <p className="text-sm text-muted-foreground">Se han creado {result.success} nuevos usuarios.</p>
                            </div>
                            <Button
                                onClick={handleClose}
                                className="w-full max-w-xs bg-white text-black hover:bg-muted uppercase font-bold text-xs h-10 tracking-widest shadow-xl mt-4"
                            >
                                Finalizar
                            </Button>
                        </div>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
}
