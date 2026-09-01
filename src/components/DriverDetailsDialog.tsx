import { useState } from "react";
import {
    Dialog,
    DialogContent,
    DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Check, ShieldCheck, Server, Activity, Plus, Trash2, Save, Zap, Workflow, Code, Car, ChevronsUpDown, Loader2, Search, Pencil, X, AlertTriangle, Copy, Radio, ArrowRight, Database, Camera, Bell, Cpu, RefreshCw } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DRIVER_MODELS, type DeviceBrand } from "@/lib/driver-models";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { addDeviceModel, deleteDeviceModel } from "@/app/actions/driver-models";
import { HIKVISION_VEHICLE_BRANDS } from "@/lib/hikvision-codes";
import { getCarLogo } from "@/lib/car-logos";
import carLogos from "@/lib/car-logos.json";
import { saveHikvisionBrands } from "@/app/actions/settings";
import { toast } from "sonner";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";


// Driver metadata (version, features, etc.)
const DRIVER_INFO = {
    HIKVISION: {
        version: "2.4.1 (Stable)",
        releaseDate: "15/11/2023",
        features: ["ISAPI Core Protocol", "LPR Metadata Stream V2", "Bi-directional Audio", "Access Control Events"],
    },
    AKUVOX: {
        version: "1.2.0 (Beta)",
        releaseDate: "10/12/2023",
        features: ["HTTP API Integration", "Remote Door Relay", "Card/Tag Sync", "Face Library Management"],
    },
    DAHUA: {
        version: "3.0.5",
        releaseDate: "20/09/2023",
        features: ["CGI Interface", "ITC LPR Events", "Smart Traffic Support"],
    },
    ZKTECO: {
        version: "1.0.2",
        releaseDate: "05/05/2023",
        features: ["Push SDK Protocol", "Attendance Events", "BioPhoto Sync"],
    },
    AXIS: {
        version: "Vapix 3.0",
        releaseDate: "01/08/2023",
        features: ["ACAP Support", "Edge Analytics", "Metadata Stream"],
    },
    INTELBRAS: {
        version: "1.1.0",
        releaseDate: "12/10/2023",
        features: ["CGI Protocol", "Event Notifications", "PTZ Control"],
    },
    AVICAM: {
        version: "0.9.0 (Dev)",
        releaseDate: "N/A",
        features: ["Generic ONVIF", "Basic Events"],
    },
    MILESIGHT: {
        version: "1.0.0",
        releaseDate: "15/08/2023",
        features: ["HTTP API", "Event Stream", "Analytics"],
    },
    UNIFI: {
        version: "2.0.1",
        releaseDate: "20/11/2023",
        features: ["UniFi Protect API", "Smart Detection", "Cloud Sync"],
    },
    UNIVIEW: {
        version: "1.5.2",
        releaseDate: "05/09/2023",
        features: ["EZStation Protocol", "LPR Events", "Access Control"],
    },
    BOSCH: {
        version: "1.0.0 (Profile M)",
        releaseDate: "25/05/2026",
        features: ["ONVIF Profile M", "PullPoint Subscription", "VCA People Counting", "Occupancy Analytics", "Snapshot HTTPS", "Telegram Alerts"],
    },
} as const;

interface DriverDetailsDialogProps {
    brand: string | null;
    isOpen: boolean;
    onClose: () => void;
}


export function DriverDetailsDialog({ brand, isOpen, onClose }: DriverDetailsDialogProps) {
    const [newModel, setNewModel] = useState({ value: "", label: "", category: "", photo: "" });
    const [isAdding, setIsAdding] = useState(false);
    const [isDeleting, setIsDeleting] = useState<string | null>(null);
    const [editingModel, setEditingModel] = useState<string | null>(null);
    const [editValues, setEditValues] = useState({ value: "", label: "", category: "", photo: "" });
    const [isUpdating, setIsUpdating] = useState(false);

    if (!brand) return null;

    const brandKey = brand.toUpperCase() as DeviceBrand;
    const driverInfo = DRIVER_INFO[brandKey];
    const models = DRIVER_MODELS[brandKey] || [];

    if (!driverInfo) return null;

    const handleAddModel = async () => {
        if (!newModel.value || !newModel.label || !newModel.category) {
            alert("Por favor completa todos los campos");
            return;
        }

        setIsAdding(true);
        const result = await addDeviceModel(brand, newModel);
        setIsAdding(false);

        if (result.success) {
            setNewModel({ value: "", label: "", category: "", photo: "" });
            // Reload page to get updated models
            window.location.reload();
        } else {
            alert("Error al agregar modelo: " + result.error);
        }
    };

    const handleDeleteModel = async (modelValue: string) => {
        if (!confirm("¿Estás seguro de eliminar este modelo?")) return;

        setIsDeleting(modelValue);
        const result = await deleteDeviceModel(brand, modelValue);
        setIsDeleting(null);

        if (result.success) {
            window.location.reload();
        } else {
            alert("Error al eliminar modelo: " + result.error);
        }
    };

    const startEditing = (model: { value: string; label: string; category: string; photo: string }) => {
        setEditingModel(model.value);
        setEditValues({ ...model });
    };

    const cancelEditing = () => {
        setEditingModel(null);
        setEditValues({ value: "", label: "", category: "", photo: "" });
    };

    const handleUpdateModel = async () => {
        if (!editingModel) return;
        if (!editValues.label || !editValues.category) {
            toast.error("Nombre y categoría son requeridos");
            return;
        }

        setIsUpdating(true);
        const { updateDeviceModel } = await import("@/app/actions/driver-models");
        const result = await updateDeviceModel(brand, editingModel, editValues);
        setIsUpdating(false);

        if (result.success) {
            toast.success("Modelo actualizado exitosamente");
            setEditingModel(null);
            window.location.reload();
        } else {
            toast.error("Error al actualizar: " + result.error);
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="max-w-5xl bg-card/95 border-border backdrop-blur-xl p-0 overflow-hidden flex flex-col md:flex-row gap-0 h-[700px]">
                <DialogTitle className="sr-only">{brand} Driver Configuration</DialogTitle>
                {/* Left Side: Driver Info */}
                <div className="w-full md:w-1/3 bg-foreground/10 p-8 border-r border-border flex flex-col justify-between relative">
                    <div className="space-y-6">
                        <div>
                            <h2 className="text-2xl font-bold text-foreground tracking-tighter uppercase mb-1">{brand}</h2>
                            <div className="flex items-center gap-2">
                                <Badge variant="outline" className="border-emerald-500/30 text-emerald-400 bg-emerald-500/10 text-[10px] uppercase font-bold tracking-wider">
                                    Driver Active
                                </Badge>
                                <span className="text-[10px] text-muted-foreground font-mono">v{driverInfo.version}</span>
                            </div>
                        </div>

                        <div className="space-y-4">
                            <div className="space-y-1">
                                <label className="text-[10px] text-muted-foreground uppercase font-bold tracking-widest">Compilación</label>
                                <div className="flex items-center gap-2 text-muted-foreground font-mono text-sm">
                                    <Server size={14} className="text-blue-500" />
                                    {driverInfo.releaseDate}
                                </div>
                            </div>

                            <div className="space-y-2">
                                <label className="text-[10px] text-muted-foreground uppercase font-bold tracking-widest">Capacidades</label>
                                <div className="space-y-2">
                                    {driverInfo.features.map((feat, i) => (
                                        <div key={i} className="flex items-center gap-2 text-xs text-muted-foreground">
                                            <Check size={12} className="text-emerald-500" /> {feat}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="pt-6 mt-auto border-t border-border">
                        <div className="flex items-center gap-2 text-[10px] text-muted-foreground uppercase font-bold">
                            <Activity size={14} className="animate-pulse text-emerald-500" />
                            System Healthy
                        </div>
                    </div>
                </div>

                {/* Right Side: Models Management */}
                <div className="w-full md:w-2/3 p-8 bg-background/50 flex flex-col min-h-0 overflow-hidden">
                    <Tabs defaultValue="models" className="flex-1 flex flex-col min-h-0">
                        <TabsList className="bg-black/20 border border-border p-1 self-start mb-6">
                            <TabsTrigger value="models" className="text-[10px] font-bold uppercase tracking-widest px-6 data-[state=active]:bg-blue-600">
                                <Code size={14} className="mr-2" />
                                Modelos Certificados
                            </TabsTrigger>
                            {brandKey === 'HIKVISION' && (
                                <TabsTrigger value="brands" className="text-[10px] font-bold uppercase tracking-widest px-6 data-[state=active]:bg-blue-600">
                                    <Car size={14} className="mr-2" />
                                    Marcas de Autos
                                </TabsTrigger>
                            )}
                            {brandKey === 'AKUVOX' && (
                                <TabsTrigger value="webhooks" className="text-[10px] font-bold uppercase tracking-widest px-6 data-[state=active]:bg-blue-600">
                                    <Zap size={14} className="mr-2" />
                                    Action URLs
                                </TabsTrigger>
                            )}
                            {brandKey === 'BOSCH' && (
                                <TabsTrigger value="onvif" className="text-[10px] font-bold uppercase tracking-widest px-6 data-[state=active]:bg-violet-600">
                                    <Radio size={14} className="mr-2" />
                                    ONVIF Pipeline
                                </TabsTrigger>
                            )}
                        </TabsList>

                        <TabsContent value="models" className="flex-1 flex flex-col min-h-0 overflow-hidden m-0 focus-visible:ring-0">
                            {/* ... existing Add Model Form & Models List codes ... */}
                            {/* Add Model Form */}
                            <div className="mb-6 p-4 bg-foreground/10 rounded-2xl border border-border">
                                <h4 className="text-sm font-bold text-foreground mb-3 flex items-center gap-2">
                                    <Plus size={14} className="text-blue-500" />
                                    Agregar Nuevo Modelo
                                </h4>
                                <div className="grid grid-cols-4 gap-3 mb-3">
                                    <div>
                                        <Label className="text-[10px] text-muted-foreground uppercase font-bold tracking-widest">Código</Label>
                                        <Input
                                            value={newModel.value}
                                            onChange={(e) => setNewModel({ ...newModel, value: e.target.value })}
                                            placeholder="DS-K1T671M"
                                            className="h-9 bg-card border-border text-xs font-mono"
                                        />
                                    </div>
                                    <div>
                                        <Label className="text-[10px] text-muted-foreground uppercase font-bold tracking-widest">Nombre</Label>
                                        <Input
                                            value={newModel.label}
                                            onChange={(e) => setNewModel({ ...newModel, label: e.target.value })}
                                            placeholder="Nombre Comercial"
                                            className="h-9 bg-card border-border text-xs"
                                        />
                                    </div>
                                    <div>
                                        <Label className="text-[10px] text-muted-foreground uppercase font-bold tracking-widest">Categoría</Label>
                                        <Input
                                            value={newModel.category}
                                            onChange={(e) => setNewModel({ ...newModel, category: e.target.value })}
                                            placeholder="Face/LPR/Relay"
                                            className="h-9 bg-card border-border text-xs"
                                        />
                                    </div>
                                    <div>
                                        <Label className="text-[10px] text-muted-foreground uppercase font-bold tracking-widest">Foto URL</Label>
                                        <Input
                                            value={newModel.photo}
                                            onChange={(e) => setNewModel({ ...newModel, photo: e.target.value })}
                                            placeholder="https://..."
                                            className="h-9 bg-card border-border text-xs font-mono"
                                        />
                                    </div>
                                </div>
                                <Button
                                    onClick={handleAddModel}
                                    disabled={isAdding}
                                    className="w-full h-9 bg-blue-600 hover:bg-blue-500 text-foreground text-xs font-bold uppercase tracking-widest shadow-lg shadow-blue-500/20"
                                >
                                    {isAdding ? "Guardando..." : <><Save size={14} className="mr-2" /> Guardar Modelo en Catálogo</>}
                                </Button>
                            </div>

                            {/* Models List */}
                            <ScrollArea className="flex-1 min-h-0 pr-4">
                                <div className="space-y-2">
                                    {models.map((model, idx) => (
                                        <div key={idx} className={cn(
                                            "group relative border rounded-xl p-4 transition-all duration-300",
                                            editingModel === model.value
                                                ? "bg-blue-500/10 border-blue-500/30"
                                                : "bg-foreground/10 hover:bg-accent border-border"
                                        )}>
                                            {editingModel === model.value ? (
                                                // Edit Mode
                                                <div className="space-y-3">
                                                    <div className="grid grid-cols-2 gap-3">
                                                        <div>
                                                            <Label className="text-[9px] uppercase font-bold text-muted-foreground tracking-widest mb-1 block">Nombre</Label>
                                                            <Input
                                                                value={editValues.label}
                                                                onChange={(e) => setEditValues({ ...editValues, label: e.target.value })}
                                                                className="h-8 bg-black/40 border-border text-xs"
                                                            />
                                                        </div>
                                                        <div>
                                                            <Label className="text-[9px] uppercase font-bold text-muted-foreground tracking-widest mb-1 block">Categoría</Label>
                                                            <Input
                                                                value={editValues.category}
                                                                onChange={(e) => setEditValues({ ...editValues, category: e.target.value })}
                                                                className="h-8 bg-black/40 border-border text-xs"
                                                            />
                                                        </div>
                                                    </div>
                                                    <div>
                                                        <Label className="text-[9px] uppercase font-bold text-muted-foreground tracking-widest mb-1 block">URL de Foto (opcional)</Label>
                                                        <Input
                                                            value={editValues.photo}
                                                            onChange={(e) => setEditValues({ ...editValues, photo: e.target.value })}
                                                            placeholder="https://..."
                                                            className="h-8 bg-black/40 border-border text-xs"
                                                        />
                                                    </div>
                                                    <div className="flex gap-2 pt-2">
                                                        <Button
                                                            size="sm"
                                                            onClick={handleUpdateModel}
                                                            disabled={isUpdating}
                                                            className="h-8 bg-blue-600 hover:bg-blue-500 text-foreground text-[10px] font-bold flex-1"
                                                        >
                                                            {isUpdating ? <Loader2 size={12} className="animate-spin mr-1" /> : <Check size={12} className="mr-1" />}
                                                            Guardar
                                                        </Button>
                                                        <Button
                                                            size="sm"
                                                            variant="ghost"
                                                            onClick={cancelEditing}
                                                            className="h-8 text-muted-foreground hover:text-foreground text-[10px] font-bold"
                                                        >
                                                            <X size={12} className="mr-1" />
                                                            Cancelar
                                                        </Button>
                                                    </div>
                                                </div>
                                            ) : (
                                                // View Mode
                                                <div className="flex items-center justify-between">
                                                    <div className="flex-1">
                                                        <div className="flex items-center gap-3">
                                                            <div className="w-10 h-10 rounded-lg bg-black/40 border border-border flex items-center justify-center overflow-hidden">
                                                                {model.photo ? (
                                                                    <img src={model.photo} alt={model.label} className="w-full h-full object-cover" />
                                                                ) : (
                                                                    <Workflow size={18} className="text-muted-foreground" />
                                                                )}
                                                            </div>
                                                            <div>
                                                                <h4 className="font-bold text-foreground text-sm">{model.label}</h4>
                                                                <div className="flex items-center gap-2 mt-0.5">
                                                                    <p className="text-[10px] text-blue-400 font-bold uppercase tracking-wider">{model.category}</p>
                                                                    <span className="text-muted-foreground text-[10px]">•</span>
                                                                    <p className="text-[10px] text-muted-foreground font-mono tracking-tighter">{model.value}</p>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </div>
                                                    <div className="flex items-center gap-1">
                                                        <Button
                                                            variant="ghost"
                                                            size="sm"
                                                            onClick={() => startEditing(model)}
                                                            className="opacity-0 group-hover:opacity-100 transition-opacity h-8 w-8 p-0 text-blue-400 hover:text-blue-300 hover:bg-blue-500/10"
                                                        >
                                                            <Pencil size={14} />
                                                        </Button>
                                                        <Button
                                                            variant="ghost"
                                                            size="sm"
                                                            onClick={() => handleDeleteModel(model.value)}
                                                            disabled={isDeleting === model.value}
                                                            className="opacity-0 group-hover:opacity-100 transition-opacity h-8 w-8 p-0 text-red-500 hover:text-red-400 hover:bg-red-500/10"
                                                        >
                                                            {isDeleting === model.value ? (
                                                                <div className="h-4 w-4 border-2 border-red-500 border-t-transparent rounded-full animate-spin" />
                                                            ) : (
                                                                <Trash2 size={14} />
                                                            )}
                                                        </Button>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                    {models.length === 0 && (
                                        <div className="flex flex-col items-center justify-center border border-dashed border-border rounded-2xl p-12 text-neutral-600 bg-black/20">
                                            <Workflow size={32} className="mb-4 opacity-20" />
                                            <p className="text-sm font-bold text-center">No hay modelos definidos</p>
                                            <p className="text-[10px] text-center mt-2 uppercase tracking-widest font-bold opacity-60">Agrega el primer modelo usando el panel superior</p>
                                        </div>
                                    )}
                                </div>
                            </ScrollArea>
                        </TabsContent>

                        <TabsContent value="brands" className="flex-1 flex flex-col min-h-0 m-0 focus-visible:ring-0">
                            <BrandEditor />
                        </TabsContent>

                        {/* Akuvox Action URLs Tab */}
                        <TabsContent value="webhooks" className="flex-1 flex flex-col min-h-0 m-0 focus-visible:ring-0">
                            <AkuvoxActionUrls />
                        </TabsContent>

                        {/* Bosch ONVIF Pipeline Tab */}
                        <TabsContent value="onvif" className="flex-1 flex flex-col min-h-0 overflow-hidden m-0 focus-visible:ring-0">
                            <BoschOnvifPipeline />
                        </TabsContent>
                    </Tabs>
                </div>
            </DialogContent>
        </Dialog>
    );
}

function AkuvoxActionUrls() {
    const [serverUrl, setServerUrl] = useState(typeof window !== 'undefined' ? window.location.origin.replace(':10001', ':10000') : 'http://YOUR_SERVER_IP:10000');
    const [copied, setCopied] = useState<string | null>(null);

    const actionUrls = [
        // Access Events - Face
        {
            id: 'face_success',
            label: 'Valid Face Recognition',
            description: 'Rostro reconocido exitosamente (usuario identificado)',
            path: '/api/webhooks/akuvox?event=face_valid&mac=$mac&user=$user_name&userid=$userid&unlocktype=$unlocktype&time=$time',
            method: 'GET',
            color: 'purple',
            category: 'access'
        },
        {
            id: 'face_failed',
            label: 'Invalid Face Recognition',
            description: 'Rostro no reconocido (persona desconocida)',
            path: '/api/webhooks/akuvox?event=face_invalid&mac=$mac&unlocktype=$unlocktype&time=$time',
            method: 'GET',
            color: 'red',
            category: 'access'
        },
        // Access Events - Card
        {
            id: 'card_success',
            label: 'Valid Card Entered',
            description: 'Tarjeta RFID válida detectada',
            path: '/api/webhooks/akuvox?event=card_valid&mac=$mac&card=$card_sn&user=$user_name&userid=$userid&time=$time',
            method: 'GET',
            color: 'amber',
            category: 'access'
        },
        {
            id: 'card_failed',
            label: 'Invalid Card Entered',
            description: 'Tarjeta RFID no registrada',
            path: '/api/webhooks/akuvox?event=card_invalid&mac=$mac&card=$card_sn&time=$time',
            method: 'GET',
            color: 'orange',
            category: 'access'
        },
        // Access Events - PIN Code
        {
            id: 'code_success',
            label: 'Valid Code Entered',
            description: 'Código PIN válido ingresado',
            path: '/api/webhooks/akuvox?event=code_valid&mac=$mac&code=$code&user=$user_name&userid=$userid&time=$time',
            method: 'GET',
            color: 'emerald',
            category: 'access'
        },
        {
            id: 'code_failed',
            label: 'Invalid Code Entered',
            description: 'Código PIN incorrecto',
            path: '/api/webhooks/akuvox?event=code_invalid&mac=$mac&code=$code&time=$time',
            method: 'GET',
            color: 'rose',
            category: 'access'
        },
        // Access Events - QR Code
        {
            id: 'qr_success',
            label: 'Valid QR Code',
            description: 'Código QR válido escaneado',
            path: '/api/webhooks/akuvox?event=qr_valid&mac=$mac&unlocktype=$unlocktype&time=$time',
            method: 'GET',
            color: 'cyan',
            category: 'access'
        },
        // Relay Events
        {
            id: 'relay_a_open',
            label: 'Relay A Triggered',
            description: 'Relé A activado (puerta abierta)',
            path: '/api/webhooks/akuvox?event=relay_open&mac=$mac&relay=A&status=$relay1status&time=$time',
            method: 'GET',
            color: 'teal',
            category: 'relay'
        },
        {
            id: 'relay_a_close',
            label: 'Relay A Closed',
            description: 'Relé A desactivado (puerta cerrada)',
            path: '/api/webhooks/akuvox?event=relay_close&mac=$mac&relay=A&status=$relay1status&time=$time',
            method: 'GET',
            color: 'slate',
            category: 'relay'
        },
        // Call Events
        {
            id: 'call_start',
            label: 'Make Call',
            description: 'Llamada saliente iniciada',
            path: '/api/webhooks/akuvox?event=call_start&mac=$mac&remote=$remote&time=$time',
            method: 'GET',
            color: 'blue',
            category: 'call'
        },
        {
            id: 'call_end',
            label: 'Hang Up',
            description: 'Llamada finalizada',
            path: '/api/webhooks/akuvox?event=call_end&mac=$mac&remote=$remote&time=$time',
            method: 'GET',
            color: 'indigo',
            category: 'call'
        },
        // Alarm Events
        {
            id: 'tamper',
            label: 'Tamper Alarm',
            description: 'Alarma de manipulación del dispositivo',
            path: '/api/webhooks/akuvox?event=tamper&mac=$mac&status=$alarmstatus&time=$time',
            method: 'GET',
            color: 'red',
            category: 'alarm'
        },
        // System Events
        {
            id: 'boot',
            label: 'Setup Completed',
            description: 'Dispositivo encendido y listo',
            path: '/api/webhooks/akuvox?event=boot&mac=$mac&model=$model&firmware=$firmware&ip=$ip',
            method: 'GET',
            color: 'neutral',
            category: 'system'
        }
    ];

    const handleCopy = (id: string, url: string) => {
        navigator.clipboard.writeText(url);
        setCopied(id);
        setTimeout(() => setCopied(null), 2000);
    };

    return (
        <div className="flex flex-col h-full overflow-hidden animate-in fade-in slide-in-from-right-4 duration-500">
            {/* Header Info */}
            <div className="p-4 bg-gradient-to-r from-blue-600/10 to-purple-600/10 border border-blue-500/20 rounded-2xl mb-4 shrink-0">
                <h4 className="text-sm font-bold text-foreground uppercase tracking-widest mb-2 flex items-center gap-2">
                    <Zap size={16} className="text-blue-500" />
                    URLs de Acción para Akuvox
                </h4>
                <p className="text-[11px] text-muted-foreground leading-relaxed font-medium">
                    Configure estas URLs en la sección <span className="text-blue-400 font-bold">"Intercom → Action URL"</span> de su terminal Akuvox.
                    El servidor escucha en el puerto <span className="text-foreground font-mono bg-foreground/10 px-1.5 py-0.5 rounded">10000</span> para webhooks.
                </p>
            </div>

            {/* Warning: No Images */}
            <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl mb-4 shrink-0">
                <div className="flex items-start gap-2">
                    <AlertTriangle size={16} className="text-amber-500 shrink-0 mt-0.5" />
                    <div>
                        <p className="text-[11px] text-amber-300 font-bold uppercase tracking-wider mb-1">Importante: Sin imágenes en webhooks</p>
                        <p className="text-[10px] text-amber-200/70 leading-relaxed">
                            Los dispositivos Akuvox <strong className="text-amber-200">NO envían imágenes de rostros</strong> en los webhooks Action URL.
                            Solo envían datos de texto (nombre, tarjeta, etc). Las imágenes se obtienen vía Doorlog API.
                        </p>
                    </div>
                </div>
            </div>

            {/* Server URL Config */}
            <div className="bg-foreground/10 p-4 rounded-xl border border-border mb-4 shrink-0">
                <div className="flex items-center gap-4">
                    <div className="flex-1">
                        <label className="text-[9px] uppercase font-bold text-muted-foreground tracking-widest mb-1 block">IP del Servidor</label>
                        <input
                            type="text"
                            value={serverUrl}
                            onChange={(e) => setServerUrl(e.target.value)}
                            placeholder="http://192.168.1.100:10000"
                            className="w-full h-9 px-3 bg-black/40 border border-border rounded-lg text-xs text-white font-mono focus:outline-none focus:border-blue-500/50"
                        />
                    </div>
                    <div className="text-[10px] text-muted-foreground pt-4">
                        <span className="block">Puerto Webhook:</span>
                        <span className="text-blue-400 font-bold">10000</span>
                    </div>
                </div>
            </div>

            {/* Action URLs List - Scrollable */}
            <div className="flex-1 min-h-0 overflow-hidden">
                <ScrollArea className="h-full pr-2">
                    <div className="space-y-3 pb-4">
                        {actionUrls.map((action) => {
                            const fullUrl = `${serverUrl}${action.path}`;
                            const isCopied = copied === action.id;

                            return (
                                <div
                                    key={action.id}
                                    className={`bg-${action.color}-500/5 border border-${action.color}-500/20 rounded-xl p-4 hover:bg-${action.color}-500/10 transition-all group`}
                                >
                                    <div className="flex items-start justify-between gap-4">
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2 mb-1">
                                                <h5 className="font-bold text-foreground text-sm">{action.label}</h5>
                                                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded bg-${action.color}-500/20 text-${action.color}-400`}>
                                                    {action.method}
                                                </span>
                                            </div>
                                            <p className="text-[10px] text-muted-foreground mb-3">{action.description}</p>
                                            <div className="flex items-center gap-2">
                                                <code className="flex-1 bg-black/40 px-3 py-2 rounded-lg text-[11px] text-blue-300 font-mono truncate">
                                                    {fullUrl}
                                                </code>
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={() => handleCopy(action.id, fullUrl)}
                                                    className={`h-8 px-3 text-[10px] font-bold ${isCopied ? 'bg-emerald-500/20 text-emerald-400' : 'bg-foreground/10 text-muted-foreground hover:text-foreground hover:bg-accent'}`}
                                                >
                                                    {isCopied ? (
                                                        <><Check size={12} className="mr-1" /> Copiado</>
                                                    ) : (
                                                        'Copiar'
                                                    )}
                                                </Button>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </ScrollArea>
            </div>

            {/* Instructions Footer */}
            <div className="mt-4 p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl shrink-0">
                <div className="flex items-start gap-3">
                    <Server size={14} className="text-amber-400 shrink-0 mt-0.5" />
                    <p className="text-[10px] text-amber-200/80 leading-relaxed">
                        <span className="font-bold">Configuración en Akuvox:</span> Ingrese al panel web del terminal →
                        <span className="text-foreground font-mono"> Intercom</span> →
                        <span className="text-foreground font-mono"> Action URL</span> →
                        Pegue la URL correspondiente al tipo de evento.
                    </p>
                </div>
            </div>
        </div>
    );
}

function BoschOnvifPipeline() {
    const pipelineSteps = [
        {
            icon: <Camera size={16} />,
            title: "Cámara Bosch",
            subtitle: "ONVIF Profile M",
            description: "La cámara ejecuta analíticas VCA (Video Content Analytics) integradas en el firmware. No requiere configuración IVA externa.",
            color: "blue",
            detail: "Modelos compatibles: DINION inteox 7100i IR, FLEXIDOME, AUTODOME",
        },
        {
            icon: <Radio size={16} />,
            title: "PullPoint Subscription",
            subtitle: "CreatePullPointSubscription",
            description: "OmniAccess crea una suscripción ONVIF PullPoint en el servicio de eventos de la cámara. La suscripción se renueva automáticamente cada 5 minutos.",
            color: "violet",
            detail: "Endpoint: https://{IP}/onvif/events_service",
        },
        {
            icon: <RefreshCw size={16} />,
            title: "Polling cada 8s",
            subtitle: "PullMessages",
            description: "Cada 8 segundos se consultan los mensajes pendientes. Solo se procesan eventos con PropertyOperation=\"Changed\" para evitar duplicados.",
            color: "amber",
            detail: "PM2 process: queue-poller (cron: */30 * * * *)",
        },
        {
            icon: <Cpu size={16} />,
            title: "Parsing XML",
            subtitle: "parseCountEvents()",
            description: "Se extraen los bloques <NotificationMessage> del XML SOAP. Se filtran solo topics que contienen \"Count\" u \"Occupancy\".",
            color: "emerald",
            detail: null,
        },
        {
            icon: <Database size={16} />,
            title: "QueueEvent",
            subtitle: "Prisma → PostgreSQL",
            description: "Cada evento se persiste con: timestamp, deviceId, channelName, channelId, peopleCount, snapshotPath y metadata JSON.",
            color: "cyan",
            detail: "channelId: 1 = Occupancy, 2 = Counter",
        },
        {
            icon: <Bell size={16} />,
            title: "Alertas Telegram",
            subtitle: "checkQueueAlerts()",
            description: "Si el conteo supera el umbral de una QueueAlert activa, se envía notificación a Telegram con foto snapshot de la cámara.",
            color: "red",
            detail: "Cooldown configurable por alerta (minutos)",
        },
    ];

    const eventTopics = [
        {
            topic: "tns1:RuleEngine/CountAggregation/Counter",
            description: "Contador acumulativo de personas que cruzan una línea virtual",
            fields: "Rule (nombre regla), Count (total), PropertyOperation",
            channelId: 2,
            channelName: "Se usa el nombre de la regla configurada en la cámara",
        },
        {
            topic: "tns1:RuleEngine/CountAggregation/OccupancyCounter",
            description: "Conteo de ocupación actual en una zona (personas presentes en tiempo real)",
            fields: "Rule (nombre regla), Count (personas actuales), PropertyOperation",
            channelId: 1,
            channelName: "Se usa el nombre de la regla, o \"Occupancy\" por defecto",
        },
    ];

    return (
        <div className="flex flex-col h-full overflow-hidden animate-in fade-in slide-in-from-right-4 duration-500">
            {/* Header */}
            <div className="p-4 bg-gradient-to-r from-violet-600/10 to-blue-600/10 border border-violet-500/20 rounded-2xl mb-4 shrink-0">
                <h4 className="text-sm font-bold text-foreground uppercase tracking-widest mb-2 flex items-center gap-2">
                    <Radio size={16} className="text-violet-500" />
                    Pipeline ONVIF Profile M
                </h4>
                <p className="text-[11px] text-muted-foreground leading-relaxed font-medium">
                    Este driver obtiene analíticas VCA directamente del firmware de la cámara Bosch mediante
                    <span className="text-violet-400 font-bold"> ONVIF Profile M</span>. No requiere tareas IVA externas ni configuración manual de reglas.
                </p>
            </div>

            <ScrollArea className="flex-1 min-h-0 pr-2">
                {/* Pipeline Visual */}
                <div className="space-y-1 mb-6">
                    <h5 className="text-[9px] uppercase font-bold text-muted-foreground tracking-widest mb-3 px-1">Flujo de Datos</h5>
                    {pipelineSteps.map((step, i) => (
                        <div key={i} className="relative">
                            <div className={`flex items-start gap-3 p-3 rounded-xl border transition-all bg-${step.color}-500/5 border-${step.color}-500/15 hover:bg-${step.color}-500/10`}>
                                <div className={`w-8 h-8 rounded-lg bg-${step.color}-500/20 border border-${step.color}-500/30 flex items-center justify-center shrink-0 text-${step.color}-400`}>
                                    {step.icon}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 mb-0.5">
                                        <h6 className="text-xs font-bold text-foreground">{step.title}</h6>
                                        <span className={`text-[8px] font-mono px-1.5 py-0.5 rounded bg-${step.color}-500/20 text-${step.color}-400`}>
                                            {step.subtitle}
                                        </span>
                                    </div>
                                    <p className="text-[10px] text-muted-foreground leading-relaxed">{step.description}</p>
                                    {step.detail && (
                                        <p className="text-[9px] text-muted-foreground font-mono mt-1">{step.detail}</p>
                                    )}
                                </div>
                                <div className={`text-[9px] font-bold text-${step.color}-500/60 shrink-0 mt-1`}>
                                    {String(i + 1).padStart(2, '0')}
                                </div>
                            </div>
                            {i < pipelineSteps.length - 1 && (
                                <div className="flex justify-center py-0.5">
                                    <ArrowRight size={10} className="text-muted-foreground rotate-90" />
                                </div>
                            )}
                        </div>
                    ))}
                </div>

                {/* Event Topics Mapping */}
                <div className="mb-6">
                    <h5 className="text-[9px] uppercase font-bold text-muted-foreground tracking-widest mb-3 px-1">Mapeo de Eventos ONVIF</h5>
                    <div className="space-y-3">
                        {eventTopics.map((evt, i) => (
                            <div key={i} className="border border-border rounded-xl overflow-hidden">
                                <div className="bg-foreground/10 px-3 py-2 border-b border-border">
                                    <code className="text-[10px] text-violet-400 font-mono font-bold break-all">{evt.topic}</code>
                                </div>
                                <div className="p-3 space-y-2">
                                    <p className="text-[11px] text-muted-foreground">{evt.description}</p>
                                    <div className="grid grid-cols-2 gap-2">
                                        <div>
                                            <span className="text-[8px] uppercase font-bold text-muted-foreground tracking-widest">Campos XML</span>
                                            <p className="text-[10px] text-muted-foreground font-mono">{evt.fields}</p>
                                        </div>
                                        <div>
                                            <span className="text-[8px] uppercase font-bold text-muted-foreground tracking-widest">Channel ID</span>
                                            <p className="text-[10px] text-muted-foreground font-mono">{evt.channelId}</p>
                                        </div>
                                    </div>
                                    <div>
                                        <span className="text-[8px] uppercase font-bold text-muted-foreground tracking-widest">Channel Name</span>
                                        <p className="text-[10px] text-muted-foreground">{evt.channelName}</p>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* XML Example */}
                <div className="mb-4">
                    <h5 className="text-[9px] uppercase font-bold text-muted-foreground tracking-widest mb-3 px-1">Ejemplo de Evento XML</h5>
                    <div className="bg-black/60 border border-border rounded-xl p-3 overflow-x-auto">
                        <pre className="text-[9px] text-emerald-400/80 font-mono leading-relaxed whitespace-pre">{`<wsnt:NotificationMessage>
  <wsnt:Topic>
    tns1:RuleEngine/CountAggregation/OccupancyCounter
  </wsnt:Topic>
  <wsnt:Message>
    <tt:Message UtcTime="2026-05-25T14:30:00Z"
                PropertyOperation="Changed">
      <tt:Source>
        <tt:SimpleItem Name="Rule"
                       Value="Occupancy Personas"/>
      </tt:Source>
      <tt:Data>
        <tt:SimpleItem Name="Count" Value="3"/>
      </tt:Data>
    </tt:Message>
  </wsnt:Message>
</wsnt:NotificationMessage>`}</pre>
                    </div>
                </div>

                {/* Snapshot Capture */}
                <div className="p-3 bg-blue-500/5 border border-blue-500/15 rounded-xl mb-4">
                    <div className="flex items-start gap-2">
                        <Camera size={14} className="text-blue-400 shrink-0 mt-0.5" />
                        <div>
                            <p className="text-[10px] text-blue-300 font-bold uppercase tracking-wider mb-1">Captura de Snapshot</p>
                            <p className="text-[10px] text-blue-200/60 leading-relaxed">
                                Con cada evento de conteo mayor a 0, se captura una imagen JPEG desde
                                <code className="bg-blue-500/10 px-1 rounded mx-0.5">https://{'{IP}'}/snap.jpg?JpegSize=L</code>
                                usando Basic Auth. La imagen se sube a MinIO en
                                <code className="bg-blue-500/10 px-1 rounded mx-0.5">queue/{'{deviceId}'}/{'{timestamp}'}.jpg</code>
                            </p>
                        </div>
                    </div>
                </div>
            </ScrollArea>
        </div>
    );
}

function BrandEditor() {
    const [brands, setBrands] = useState<{ code: string; name: string }[]>(
        Object.entries(HIKVISION_VEHICLE_BRANDS)
            .map(([code, name]) => ({ code, name }))
            .sort((a, b) => parseInt(a.code) - parseInt(b.code))
    );
    const [newCode, setNewCode] = useState("");
    const [newName, setNewName] = useState("");
    const [isSaving, setIsSaving] = useState(false);
    const [logoOpen, setLogoOpen] = useState(false);
    const [filter, setFilter] = useState("");

    const filteredBrands = brands
        .filter(b => b.code.includes(filter) || b.name.toLowerCase().includes(filter.toLowerCase()))
        .sort((a, b) => parseInt(a.code) - parseInt(b.code));

    const handleDelete = (code: string) => {
        if (confirm("¿Eliminar este mapeo de marca?")) {
            setBrands(prev => prev.filter(b => b.code !== code));
        }
    };

    const handleAdd = () => {
        if (!newCode || !newName) {
            toast.error("Complete ambos campos");
            return;
        }
        if (brands.some(b => b.code === newCode)) {
            toast.error("El código ya existe");
            return;
        }
        setBrands(prev => [...prev, { code: newCode, name: newName }].sort((a, b) => parseInt(a.code) - parseInt(b.code)));
        setNewCode("");
        setNewName("");
        toast.success("Marca agregada a la lista temporal");
    };

    const handleSave = async () => {
        setIsSaving(true);
        try {
            const map: Record<string, string> = {};
            brands.forEach(b => map[b.code] = b.name);
            const result = await saveHikvisionBrands(map);

            if (result.success) {
                toast.success("Marcas guardadas correctamente. Reiniciando UI...", { duration: 3000 });
                setTimeout(() => window.location.reload(), 1500);
            } else {
                toast.error("Error al guardar: " + result.message);
            }
        } catch (e) {
            toast.error("Error inesperado al guardar");
        }
        setIsSaving(false);
    };

    return (
        <div className="flex flex-col h-full animate-in fade-in slide-in-from-right-4 duration-500">
            <div className="p-4 bg-gradient-to-r from-purple-600/10 to-transparent border border-purple-500/20 rounded-2xl mb-4 shrink-0">
                <h4 className="text-sm font-bold text-foreground uppercase tracking-widest mb-2 flex items-center gap-2">
                    <Car size={16} className="text-purple-500" />
                    Mapeo de Marcas de Vehículos
                </h4>
                <p className="text-[11px] text-muted-foreground leading-relaxed font-medium">
                    Asocie los códigos numéricos de Hikvision con sus marcas correspondientes.
                    Al seleccionar una marca conocida, el logo se asignará automáticamente.
                </p>
            </div>

            {/* Add New Brand Form */}
            <div className="bg-foreground/10 p-4 rounded-xl border border-border mb-6 flex items-end gap-4 shrink-0 shadow-lg">
                <div className="w-24 shrink-0 space-y-1.5">
                    <Label className="text-[9px] uppercase font-bold text-muted-foreground tracking-widest pl-0.5">Código</Label>
                    <Input
                        value={newCode}
                        onChange={e => setNewCode(e.target.value)}
                        placeholder="1038"
                        className="h-9 bg-black/40 border-border font-mono text-xs text-center focus-visible:ring-purple-500/50"
                    />
                </div>
                <div className="flex-1 min-w-0 space-y-1.5">
                    <Label className="text-[9px] uppercase font-bold text-muted-foreground tracking-widest pl-0.5">Marca (Nombre o Búsqueda)</Label>
                    <Popover open={logoOpen} onOpenChange={setLogoOpen}>
                        <PopoverTrigger asChild>
                            <Button
                                variant="outline"
                                role="combobox"
                                aria-expanded={logoOpen}
                                className="w-full justify-between bg-black/40 border-border h-9 text-xs focus-visible:ring-purple-500/50"
                            >
                                {newName || <span className="text-muted-foreground italic">Seleccionar marca o escribir nombre...</span>}
                                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-[400px] p-0 bg-card border-border max-h-[300px]" align="start">
                            <Command className="bg-transparent">
                                <CommandInput placeholder="Buscar marca..." className="h-9 border-none focus:ring-0" />
                                <CommandList>
                                    <CommandEmpty>No se encontró la marca.</CommandEmpty>
                                    <CommandGroup className="max-h-[200px] overflow-auto custom-scrollbar">
                                        {carLogos.map((logo: any) => (
                                            <CommandItem
                                                key={logo.slug}
                                                value={logo.name}
                                                onSelect={(currentValue) => {
                                                    setNewName(currentValue);
                                                    setLogoOpen(false);
                                                }}
                                                className="text-xs data-[selected=true]:bg-foreground/10 py-2 cursor-pointer"
                                            >
                                                <Check
                                                    className={cn("mr-2 h-3 w-3", newName === logo.name ? "opacity-100" : "opacity-0")}
                                                />
                                                <div className="flex items-center gap-3">
                                                    {logo.image?.optimized ? (
                                                        <div className="w-6 h-6 bg-white p-0.5 rounded flex items-center justify-center">
                                                            <img src={logo.image.optimized} alt="" className="max-w-full max-h-full object-contain" />
                                                        </div>
                                                    ) : null}
                                                    <span className="font-medium">{logo.name}</span>
                                                </div>
                                            </CommandItem>
                                        ))}
                                    </CommandGroup>
                                </CommandList>
                            </Command>
                        </PopoverContent>
                    </Popover>
                </div>
                <div className="shrink-0 pb-[1px]">
                    <Button onClick={handleAdd} className="h-9 px-5 bg-blue-600 hover:bg-blue-500 text-[11px] uppercase font-bold tracking-wider shadow-lg shadow-blue-900/20 transition-all hover:scale-105 active:scale-95">
                        <Plus size={16} className="mr-1.5" /> Agregar
                    </Button>
                </div>
            </div>

            {/* Table Search & List */}
            <div className="flex-1 bg-black/20 rounded-xl border border-border overflow-hidden flex flex-col min-h-0 shadow-inner">
                {/* Mini Search Toolbar */}
                <div className="bg-foreground/10 border-b border-border px-2 py-2 flex items-center justify-between gap-4 shrink-0">
                    <div className="relative flex-1 max-w-[200px]">
                        <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                        <Input
                            placeholder="Buscar código o marca..."
                            value={filter}
                            onChange={(e) => setFilter(e.target.value)}
                            className="h-7 pl-8 bg-black/20 border-border text-[10px] focus-visible:ring-0 placeholder:text-neutral-600"
                        />
                    </div>
                </div>

                <div className="grid grid-cols-12 gap-2 bg-foreground/10 border-b border-border px-4 py-3 text-[9px] font-bold uppercase tracking-widest text-muted-foreground shrink-0">
                    <div className="col-span-2">Código</div>
                    <div className="col-span-5">Marca Definida</div>
                    <div className="col-span-3">Logo Automático</div>
                    <div className="col-span-2 text-right">Acción</div>
                </div>
                <ScrollArea className="flex-1 h-full">
                    <div className="divide-y divide-white/5">
                        {filteredBrands.map((brand) => {
                            const logo = getCarLogo(brand.name);
                            return (
                                <div key={brand.code} className="grid grid-cols-12 gap-2 px-4 py-2 items-center hover:bg-foreground/[0.04] transition-colors group h-12">
                                    <div className="col-span-2 font-mono text-xs text-blue-400 font-bold tracking-wider">
                                        {brand.code}
                                    </div>
                                    <div className="col-span-5 text-xs font-bold text-foreground truncate pr-2">
                                        {brand.name}
                                    </div>
                                    <div className="col-span-3 flex items-center gap-3">
                                        {logo ? (
                                            <div className="w-8 h-8 rounded-md bg-white p-1 flex items-center justify-center border border-border shadow-sm shrink-0">
                                                <img src={logo} alt={brand.name} className="max-w-full max-h-full object-contain" />
                                            </div>
                                        ) : (
                                            <div className="w-8 h-8 rounded-md bg-foreground/10 border border-border flex items-center justify-center shrink-0">
                                                <span className="text-[9px] text-muted-foreground italic">N/A</span>
                                            </div>
                                        )}
                                        {logo ? (
                                            <span className="text-[9px] text-emerald-500 font-bold tracking-wider bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20">
                                                OK
                                            </span>
                                        ) : (
                                            <span className="text-[9px] text-muted-foreground font-bold tracking-wider opacity-50">
                                                -
                                            </span>
                                        )}
                                    </div>
                                    <div className="col-span-2 text-right">
                                        <Button
                                            size="sm"
                                            variant="ghost"
                                            onClick={() => handleDelete(brand.code)}
                                            className="h-7 w-7 p-0 text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-all opacity-0 group-hover:opacity-100"
                                        >
                                            <Trash2 size={14} />
                                        </Button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </ScrollArea>
                <div className="bg-black/40 border-t border-border px-4 py-2 text-[9px] text-neutral-500 flex items-center gap-2 truncate shrink-0">
                    <Server size={10} />
                    <span className="opacity-70">Fuente:</span>
                    <code className="bg-foreground/10 px-1.5 py-0.5 rounded text-muted-foreground font-mono tracking-tight">/filippofilip95 ... /optimized/</code>
                </div>
            </div>

            <div className="mt-4 flex justify-between items-center shrink-0">
                <p className="text-[10px] text-muted-foreground italic">
                    {brands.length} Marcas Definidas
                </p>
                <Button
                    onClick={handleSave}
                    disabled={isSaving}
                    className="bg-purple-600 hover:bg-purple-500 text-foreground text-[10px] font-bold uppercase tracking-widest h-8"
                >
                    {isSaving ? <Loader2 size={12} className="animate-spin mr-2" /> : <Save size={12} className="mr-2" />}
                    Guardar Cambios
                </Button>
            </div>
        </div>
    );
}
