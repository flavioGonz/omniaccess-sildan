"use client";

import { useState, useEffect, useTransition, useRef } from "react";
import {
    Activity,
    Calendar,
    Camera,
    Car,
    Check,
    Database,
    Eye,
    Info,
    RefreshCcw,
    ShieldAlert,
    ShieldCheck,
    Trash2,
    Users
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { sileo as toast } from "sileo";
import { Switch } from "@/components/ui/switch";
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
    Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { getSetting, updateSetting, getLearnedPlates, clearLearnedPlates, testFaceEngineConnection } from "@/app/actions/settings";
import { clearAllVisitorFaces } from "@/app/actions/face-admin";

export default function ModeConfiguration({ title, description, settingKey, options }: {
    title: string,
    description: string,
    settingKey: string,
    options: { id: string, label: string, desc: string, icon: any, color: string, disabled?: boolean }[]
}) {
    const [currentMode, setCurrentMode] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [showHelp, setShowHelp] = useState(false);
    const [pendingMode, setPendingMode] = useState<string | null>(null);

    const [learnedPlates, setLearnedPlates] = useState<{ id: string, plate: string, timestamp: Date, snapshot: string | null }[]>([]);
    const [loadingLearned, setLoadingLearned] = useState(false);
    const [isPending, startTransition] = useTransition();

    const isFaceMode = settingKey === 'MODE_FACE';
    const isLprMode = settingKey === 'MODE_LPR';

    useEffect(() => {
        loadSetting();
    }, [settingKey]);

    useEffect(() => {
        if (currentMode === 'LEARNING' && isLprMode) {
            fetchLearnedPlates();
        }
    }, [currentMode, isLprMode]);

    const fetchLearnedPlates = async () => {
        setLoadingLearned(true);
        try {
            const res = await getLearnedPlates();
            setLearnedPlates(res);
        } catch (err) {
            console.error("Error fetching learned plates:", err);
        } finally {
            setLoadingLearned(false);
        }
    };

    const handleClearLearned = async () => {
        if (!confirm("¿Estás seguro de que deseas borrar todas las matrículas aprendidas?")) return;
        try {
            const res = await clearLearnedPlates();
            if (res.success) {
                toast.success({ title: "Lista de aprendizaje limpiada" });
                setLearnedPlates([]);
            } else {
                toast.error({ title: res.message });
            }
        } catch (err) {
            toast.error({ title: "Error al limpiar la lista" });
        }
    };

    const loadSetting = async () => {
        setLoading(true);
        try {
            const res = await getSetting(settingKey);
            setCurrentMode(res?.value || null);
        } catch (err) {
            console.error("Error loading setting:", err);
            toast.error({ title: "Error al cargar la configuración" });
        } finally {
            setLoading(false);
        }
    };

    const handleSelect = (modeId: string) => {
        if (modeId === currentMode) return;
        setPendingMode(modeId);
    };

    const confirmModeChange = async () => {
        if (!pendingMode) return;

        setSaving(true);
        const prev = currentMode;
        setCurrentMode(pendingMode);
        setPendingMode(null);

        try {
            await updateSetting(settingKey, pendingMode);
            toast.success({ title: "Modo actualizado exitosamente" });
        } catch (err) {
            setCurrentMode(prev);
            toast.error({ title: "Error al guardar el modo" });
        } finally {
            setSaving(false);
        }
    };

    const getModeWarnings = (modeId: string) => {
        if (isFaceMode) {
            if (modeId === 'BLACKLIST') {
                return [
                    { icon: ShieldAlert, text: "Todos los rostros identificados serán DENEGADOS", color: "red" },
                    { icon: Users, text: "Ãštil para bloquear personas específicas", color: "amber" },
                    { icon: Camera, text: "La cámara aÃºn controla la apertura física", color: "blue" }
                ];
            } else if (modeId === 'WHITELIST') {
                return [
                    { icon: ShieldCheck, text: "Solo los rostros registrados serán PERMITIDOS", color: "emerald" },
                    { icon: Users, text: "Rostros desconocidos serán ignorados", color: "amber" },
                    { icon: Camera, text: "La cámara controla la apertura física", color: "blue" }
                ];
            }
        } else {
            if (modeId === 'BLACKLIST') {
                return [
                    { icon: ShieldAlert, text: "Matrículas en la lista serán DENEGADAS", color: "red" },
                    { icon: Car, text: "Matrículas desconocidas dependen de la cámara", color: "amber" },
                    { icon: Camera, text: "Apertura física controlada por la cámara", color: "blue" }
                ];
            } else if (modeId === 'WHITELIST') {
                return [
                    { icon: ShieldCheck, text: "Solo matrículas registradas serán PERMITIDAS", color: "emerald" },
                    { icon: Car, text: "Matrículas desconocidas serán DENEGADAS", color: "amber" },
                    { icon: Camera, text: "Apertura física controlada por la cámara", color: "blue" }
                ];
            } else if (modeId === 'LEARNING') {
                return [
                    { icon: Activity, text: "Nuevas matrículas se agregarán automáticamente", color: "blue" },
                    { icon: Database, text: "La base de datos crecerá con cada detección nueva", color: "purple" },
                    { icon: Camera, text: "No afecta la decisión de apertura física", color: "amber" }
                ];
            }
        }
        return [];
    };

    const getPendingOption = () => options.find(o => o.id === pendingMode);

    function loadModeExplanation(mode: string | null, isFace: boolean) {
        if (!mode) return [];
        if (isFace) {
            if (mode === 'BLACKLIST') return [
                { icon: ShieldAlert, title: "Bloqueo Activo", text: "El sistema denegará automáticamente el acceso a cualquier rostro identificado en la base de datos.", color: "red" },
                { icon: Users, title: "Gestión de Personal", text: "Ideal para bloquear ex-empleados o personas no gratas.", color: "amber" }
            ];
            if (mode === 'WHITELIST') return [
                { icon: ShieldCheck, title: "Acceso Restringido", text: "Solo los rostros registrados explícitamente tendrán acceso. El resto es ignorado.", color: "emerald" },
                { icon: Users, title: "Alta Seguridad", text: "Garantiza que nadie desconocido pueda ingresar.", color: "blue" }
            ];
        } else {
            if (mode === 'BLACKLIST') return [
                { icon: ShieldAlert, title: "Bloqueo de Vehículos", text: "Las matrículas en la lista negra activarán alertas y bloqueo de barrera.", color: "red" },
            ];
            if (mode === 'WHITELIST') return [
                { icon: ShieldCheck, title: "Acceso Residencial", text: "Solo los vehículos de residentes registrados abren la barrera.", color: "emerald" },
            ];
            if (mode === 'LEARNING') return [
                { icon: Database, title: "Auto-Aprendizaje", text: "Cada vehículo nuevo se registra automáticamente en el sistema.", color: "purple" }
            ];
        }
        return [];
    }

    return (
        <>
            <div className="bg-card/50 backdrop-blur-xl border border-border rounded-2xl p-8 space-y-8 animate-in slide-in-from-bottom-5 duration-500">
                <div className="flex items-center justify-between">
                    <div>
                        <h2 className="text-2xl font-bold text-foreground">{title}</h2>
                        <p className="text-sm text-muted-foreground mt-1">{description}</p>
                    </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                    {/* Left: Options Stack */}
                    <div className="lg:col-span-5 space-y-4">
                        {options.map((option) => {
                            const Icon = option.icon;
                            const isSelected = currentMode === option.id;
                            const isDisabled = option.disabled || loading || saving;

                            return (
                                <button
                                    key={option.id}
                                    onClick={() => !isDisabled && handleSelect(option.id)}
                                    disabled={isDisabled}
                                    className={cn(
                                        "w-full relative p-4 rounded-xl border text-left transition-all duration-300 group flex items-center gap-4",
                                        isSelected
                                            ? `bg-${option.color}-500/10 border-${option.color}-500/50 shadow-lg shadow-${option.color}-900/10`
                                            : isDisabled
                                                ? "bg-card/20 border-border opacity-50 cursor-not-allowed"
                                                : "bg-card/40 border-border hover:bg-card/60 hover:border-border"
                                    )}
                                >
                                    <div className={cn(
                                        "w-10 h-10 rounded-lg flex items-center justify-center transition-colors shrink-0",
                                        isSelected ? `bg-${option.color}-500/20 text-${option.color}-400` : "bg-foreground/10 text-muted-foreground group-hover:bg-accent group-hover:text-muted-foreground"
                                    )}>
                                        <Icon size={20} />
                                    </div>
                                    <div>
                                        <h3 className={cn(
                                            "font-bold text-sm",
                                            isSelected ? "text-foreground" : "text-muted-foreground"
                                        )}>
                                            {option.label}
                                        </h3>
                                        <p className="text-[10px] text-muted-foreground font-medium leading-tight mt-0.5">
                                            {option.desc}
                                        </p>
                                    </div>
                                    {isSelected && (
                                        <div className={`ml-auto w-2 h-2 rounded-full bg-${option.color}-500 shadow-[0_0_8px_currentColor] animate-pulse`} />
                                    )}
                                </button>
                            );
                        })}
                    </div>

                    {/* Right: Explanation */}
                    <div className="lg:col-span-7">
                        <div className="bg-background/30 border border-border rounded-xl p-6 h-full">
                            <div className="flex items-center gap-2 mb-4">
                                <Info size={16} className="text-muted-foreground" />
                                <h3 className="text-xs font-bold text-foreground uppercase tracking-widest">¿CÓMO FUNCIONA ESTE MODO?</h3>
                            </div>

                            <div className="space-y-4">
                                {loadModeExplanation(currentMode, isFaceMode).map((item, i) => (
                                    <div key={i} className={`flex items-start gap-4 p-4 rounded-lg bg-${item.color}-500/5 border border-${item.color}-500/10`}>
                                        <div className={`p-2 rounded bg-${item.color}-500/10 text-${item.color}-400 shrink-0`}>
                                            <item.icon size={16} />
                                        </div>
                                        <div>
                                            <h4 className={`text-xs font-bold text-${item.color}-400 mb-1 uppercase`}>{item.title}</h4>
                                            <p className="text-[11px] text-muted-foreground leading-relaxed">{item.text}</p>
                                        </div>
                                    </div>
                                ))}
                                {loadModeExplanation(currentMode, isFaceMode).length === 0 && (
                                    <p className="text-xs text-muted-foreground italic">Selecciona un modo para ver los detalles.</p>
                                )}
                            </div>
                        </div>
                    </div>
                </div>

                {/* Learned Plates Information */}
                {currentMode === 'LEARNING' && isLprMode && (
                    <div className="mt-8 pt-8 border-t border-border space-y-6">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className="p-2 bg-blue-500/10 rounded-lg">
                                    <Activity className="text-blue-400" size={20} />
                                </div>
                                <div>
                                    <h3 className="text-sm font-bold text-foreground uppercase tracking-tight">Matrículas Aprendidas</h3>
                                    <p className="text-[10px] text-muted-foreground uppercase font-bold">Estas matrículas se han agregado automáticamente</p>
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={fetchLearnedPlates}
                                    disabled={loadingLearned}
                                    className="h-8 group"
                                >
                                    <RefreshCcw size={14} className={cn("mr-2 group-hover:rotate-180 transition-transform duration-500", loadingLearned && "animate-spin")} />
                                    Actualizar
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={handleClearLearned}
                                    className="h-8 text-red-400 hover:text-red-300 hover:bg-red-500/10"
                                >
                                    <Trash2 size={14} className="mr-2" />
                                    Limpiar Lista
                                </Button>
                            </div>
                        </div>

                        <div className="bg-black/40 border border-border rounded-xl overflow-hidden">
                            <div className="max-h-[400px] overflow-y-auto custom-scrollbar">
                                <Table>
                                    <TableHeader className="bg-foreground/10">
                                        <TableRow className="border-border hover:bg-transparent">
                                            <TableHead className="text-[10px] font-bold text-muted-foreground uppercase">Matrícula</TableHead>
                                            <TableHead className="text-[10px] font-bold text-muted-foreground uppercase w-[100px]">Captura</TableHead>
                                            <TableHead className="text-[10px] font-bold text-muted-foreground uppercase">Fecha y Hora de Captura</TableHead>
                                            <TableHead className="text-[10px] font-bold text-muted-foreground uppercase text-right">Estado</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {loadingLearned ? (
                                            <TableRow>
                                                <TableCell colSpan={3} className="h-24 text-center">
                                                    <div className="flex flex-col items-center gap-2">
                                                        <RefreshCcw className="animate-spin text-blue-500" size={20} />
                                                        <p className="text-[10px] font-bold text-muted-foreground uppercase">Cargando datos...</p>
                                                    </div>
                                                </TableCell>
                                            </TableRow>
                                        ) : learnedPlates.length === 0 ? (
                                            <TableRow>
                                                <TableCell colSpan={3} className="h-24 text-center">
                                                    <div className="flex flex-col items-center gap-2">
                                                        <Info className="text-muted-foreground" size={20} />
                                                        <p className="text-[10px] font-bold text-muted-foreground uppercase">No hay matrículas aprendidas en esta sesión</p>
                                                    </div>
                                                </TableCell>
                                            </TableRow>
                                        ) : learnedPlates.map((item) => (
                                            <TableRow key={item.id} className="border-border hover:bg-accent group transition-colors">
                                                <TableCell>
                                                    <div className="flex items-center gap-3">
                                                        <div className="w-8 h-8 rounded bg-blue-500/10 flex items-center justify-center border border-blue-500/20">
                                                            <Car className="text-blue-400" size={14} />
                                                        </div>
                                                        <span className="font-mono font-bold text-foreground">{item.plate}</span>
                                                    </div>
                                                </TableCell>
                                                <TableCell>
                                                    {item.snapshot ? (
                                                        <div className="w-16 h-10 rounded overflow-hidden border border-border bg-card group-hover:scale-110 transition-transform cursor-pointer">
                                                            <img
                                                                src={item.snapshot}
                                                                alt={item.plate}
                                                                className="w-full h-full object-cover"
                                                                onClick={() => window.open(item.snapshot!, '_blank')}
                                                            />
                                                        </div>
                                                    ) : (
                                                        <div className="w-16 h-10 rounded bg-card border border-border flex items-center justify-center">
                                                            <Eye size={12} className="text-muted-foreground" />
                                                        </div>
                                                    )}
                                                </TableCell>
                                                <TableCell>
                                                    <div className="flex items-center gap-2 text-muted-foreground">
                                                        <Calendar size={12} className="text-muted-foreground" />
                                                        <span className="text-xs">{new Date(item.timestamp).toLocaleString('es-UY', {
                                                            day: '2-digit',
                                                            month: '2-digit',
                                                            year: 'numeric',
                                                            hour: '2-digit',
                                                            minute: '2-digit',
                                                            second: '2-digit'
                                                        })}</span>
                                                    </div>
                                                </TableCell>
                                                <TableCell className="text-right">
                                                    <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-[9px] font-bold text-emerald-400 uppercase">
                                                        Registrada
                                                    </span>
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Confirmation Modal */}
            {pendingMode && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-md animate-in fade-in duration-300" onClick={() => setPendingMode(null)}>
                    <div
                        className="bg-[#0f0f10] border border-border rounded-xl max-w-sm w-full mx-4 overflow-hidden shadow-lg animate-in zoom-in-95 duration-300"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="p-6 text-center">
                            <div className="w-16 h-16 rounded-full bg-amber-500/10 text-amber-500 flex items-center justify-center mx-auto mb-4 border border-amber-500/20">
                                <ShieldAlert size={32} />
                            </div>
                            <h3 className="text-lg font-bold text-foreground mb-2">¿Confirmar Cambio?</h3>
                            <p className="text-xs text-muted-foreground leading-relaxed mb-6">
                                Estás a punto de cambiar a
                                <span className={`font-bold text-${getPendingOption()?.color}-400 mx-1`}>
                                    {getPendingOption()?.label}
                                </span>.
                                Esta acción modificará inmediatamente como el sistema procesa los eventos.
                            </p>

                            <div className="grid grid-cols-2 gap-3">
                                <Button onClick={() => setPendingMode(null)} variant="ghost" className="h-10 text-muted-foreground hover:bg-accent hover:text-foreground font-bold rounded-lg border border-border">
                                    Cancelar
                                </Button>
                                <Button onClick={confirmModeChange} className="h-10 bg-white text-black hover:bg-muted font-bold rounded-lg">
                                    {saving ? <RefreshCcw className="animate-spin mr-2" size={14} /> : <Check size={14} className="mr-2" />}
                                    Confirmar
                                </Button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}




// Add getWahaHistory to imports first (done separately? No, I must modify the whole file or assume imports are updated. I'll invoke this tool to update the import line first, or I can try to do it all if safe. The imports are at top of file. I will just update the component logic here and assume imports need update if function not found, but I can't edit 2 places easily. I will update component and then imports).

