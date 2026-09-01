"use client";

import { useState, useCallback, useEffect } from "react";
import { DeviceType, DeviceBrand, DeviceDirection, AuthType, DoorStatus } from "@prisma/client";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogTrigger
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    Server,
    Wifi,
    Shield,
    Globe,
    Lock,
    User,
    ArrowRightLeft,
    Video,
    Plus,
    Edit,
    Cpu,
    BadgeCheck,
    Network,
    HardDrive,
    Key,
    Activity,
    Loader2,
    ImagePlus,
    Camera,
    MapPin
} from "lucide-react";
import Image from "next/image";
import { BookOpen, ChevronDown, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { createDevice, updateDevice, probeDeviceInfo, getDevices } from "@/app/actions/devices";
import { getNvrChannels, getNvrChannelMap, saveNvrChannelMap } from "@/app/actions/nvr";
import { DRIVER_MODELS, type DeviceBrand as DriverDeviceBrand } from "@/lib/driver-models";
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
} from "@/components/ui/command";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";
import { Check, ChevronsUpDown } from "lucide-react";

interface DeviceFormDialogProps {
    device?: any;
    groups: any[];
    onSuccess: () => void;
    children: React.ReactNode;
}

const BRANDS = [
    { value: "HIKVISION", label: "Hikvision", color: "#E4002B", logoUrl: "https://upload.wikimedia.org/wikipedia/commons/4/4b/Hikvision_logo.svg" },
    { value: "AKUVOX", label: "Akuvox", color: "#005BA4", logoUrl: "https://shop.akuvox.it/skins/akuvox/customer/images/logo.png" },
    { value: "INTELBRAS", label: "Intelbras", color: "#009639", logoUrl: "https://upload.wikimedia.org/wikipedia/commons/f/ff/Intelbras_logo.svg" },
    { value: "DAHUA", label: "Dahua", color: "#ED1C24", logoUrl: "https://upload.wikimedia.org/wikipedia/commons/b/b3/Dahua_Technology_logo.svg" },
    { value: "ZKTECO", label: "ZKTeco", color: "#0191D2", logoUrl: "https://www.zkteco.com/upload/201908/5d4d3c3f3f0f7.png" },
    { value: "AVICAM", label: "Avicam", color: "#333333", logoUrl: "" },
    { value: "MILESIGHT", label: "Milesight", color: "#00AEEF", logoUrl: "" },
    { value: "UNIFI", label: "Ubiquiti UniFi", color: "#005EAD", logoUrl: "https://upload.wikimedia.org/wikipedia/commons/e/e0/Ubiquiti_Networks_logo.svg" },
    { value: "UNIVIEW", label: "Uniview", color: "#005EB8", logoUrl: "https://www.uniview.com/etc/designs/uniview/logo.png" },
    { value: "BOSCH", label: "Bosch", color: "#E2001A", logoUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/6/6f/Bosch-logo.svg/2560px-Bosch-logo.svg.png" },
];


const CAMERA_GUIDES: Record<string, { title: string; steps: string[]; webhookUrl: string; authNote: string; docUrl?: string }> = {
    HIKVISION: {
        title: "Configuracion Hikvision ISAPI",
        steps: [
            "Acceder a la interfaz web de la camara (http://IP_CAMARA)",
            "Ir a Configuration > Network > Advanced Settings > HTTP Listening",
            "Agregar un nuevo listener con la IP del servidor OmniAccess y puerto del webhook",
            "En Event > Smart Event, activar la deteccion necesaria (LPR / Face Detection)",
            "Configurar la notificacion HTTP para enviar al listener creado",
            "Verificar en Events que los eventos se disparan correctamente",
        ],
        webhookUrl: "/api/webhooks/hikvision",
        authNote: "Usar Digest Auth con las credenciales del dispositivo",
        docUrl: "https://www.hikvision.com/en/support/download/sdk/",
    },
    AKUVOX: {
        title: "Configuracion Akuvox Intercom",
        steps: [
            "Acceder a la interfaz web del Akuvox (http://IP_INTERCOM)",
            "Ir a Intercom > Relay > HTTP Notification",
            "Configurar la URL del webhook de OmniAccess",
            "En Access Control, configurar las tarjetas RFID o reconocimiento facial",
            "Activar el envio de eventos por HTTP POST",
            "Verificar la conectividad con un test de notificacion",
        ],
        webhookUrl: "/api/webhooks/akuvox",
        authNote: "Akuvox usa Basic Auth o API key segun modelo",
    },
    DAHUA: {
        title: "Configuracion Dahua / Intelbras",
        steps: [
            "Acceder a la interfaz web (http://IP_CAMARA)",
            "Ir a Configuracion > Red > Plataformas de acceso",
            "Habilitar HTTP y configurar la URL del webhook",
            "En Evento > Deteccion Inteligente, activar LPR o deteccion facial",
            "Configurar el envio de snapshots junto con los eventos",
            "Verificar la recepcion de eventos en OmniAccess",
        ],
        webhookUrl: "/api/webhooks/dahua",
        authNote: "Usar Digest Auth con usuario admin del dispositivo",
    },
    INTELBRAS: {
        title: "Configuracion Intelbras",
        steps: [
            "Acceder a la interfaz web (http://IP_CAMARA)",
            "Ir a Configuracao > Rede > HTTP",
            "Configurar a URL do webhook do OmniAccess",
            "Em Evento > Deteccao Inteligente, ativar LPR ou deteccao facial",
            "Configurar o envio de snapshots junto com os eventos",
            "Verificar a recepcao de eventos no OmniAccess",
        ],
        webhookUrl: "/api/webhooks/dahua",
        authNote: "Protocolo Dahua - Usar Digest Auth com credenciais do dispositivo",
    },
    BOSCH: {
        title: "Configuracion Bosch Queue Counter",
        steps: [
            "Acceder al panel web de la camara Bosch (https://IP_CAMARA) e iniciar sesion como service",
            "En General > ONVIF, habilitar ONVIF y crear un usuario ONVIF (rol Operator) — OmniAccess usa Profile M para leer las analiticas",
            "En Alarm > VCA (Intelligent Video Analytics), configurar el perfil y dibujar los campos/lineas de conteo (zona de aforo + lineas de Entrada/Salida)",
            "Activar el contador 'Occupancy' (aforo) y los contadores de cruce de linea (in/out); estos se publican como metadatos ONVIF (OccupancyCounter / CountingSensor)",
            "En la pestana Conexion del dispositivo en OmniAccess, ingresar IP, usuario y contrasena ONVIF — el servidor hace polling de los metadatos automaticamente (no requiere webhook push)",
            "El video en vivo se sirve por RTSP via go2rtc; verificar que el stream rtsp://IP_CAMARA es accesible desde el servidor",
            "Confirmar en /admin/filas y /admin/devices que llegan los eventos de aforo y los cruces Entrada/Salida",
        ],
        webhookUrl: "ONVIF Profile M (polling de metadatos) — sin webhook HTTP",
        authNote: "Usuario ONVIF (no el admin web). OccupancyCounter = aforo; CountingSensor = entradas/salidas",
    },
};

export function DeviceFormDialog({ device, groups, onSuccess, children }: DeviceFormDialogProps) {
    const [open, setOpen] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [step, setStep] = useState(1);
    const [modelComboOpen, setModelComboOpen] = useState(false);
    const [showGuide, setShowGuide] = useState(false);
    const [formData, setFormData] = useState({
        name: device?.name || "",
        deviceType: device?.deviceType || "LPR_CAMERA",
        brand: device?.brand || "HIKVISION",
        deviceModel: device?.deviceModel || "",
        ip: device?.ip || "",
        mac: device?.mac || "",
        location: device?.location || "",
        direction: device?.direction || "ENTRY",
        username: device?.username || "admin",
        password: device?.password || "",
        authType: device?.authType || "BASIC",
    });
    const [modelPhotoFile, setModelPhotoFile] = useState<File | null>(null);
    const [brandLogoFile, setBrandLogoFile] = useState<File | null>(null);

    const isEdit = !!device;

    const buildDefaults = () => ({
        name: device?.name || "",
        deviceType: device?.deviceType || "LPR_CAMERA",
        brand: device?.brand || "HIKVISION",
        deviceModel: device?.deviceModel || "",
        ip: device?.ip || "",
        mac: device?.mac || "",
        location: device?.location || "",
        direction: device?.direction || "ENTRY",
        username: device?.username || "admin",
        password: device?.password || "",
        authType: device?.authType || "BASIC",
    });
    const [detecting, setDetecting] = useState(false);
    const [detectInfo, setDetectInfo] = useState<any>(null);
    const [nvrCams, setNvrCams] = useState<any[]>([]);
    const [nvrMap, setNvrMap] = useState<Record<string, number>>({});
    const [nvrBusy, setNvrBusy] = useState(false);
    const [nvrMsg, setNvrMsg] = useState<string>("");
    const [nvrInfo, setNvrInfo] = useState<Record<string, { channel: number; name: string | null }>>({});
    const [nvrAllChannels, setNvrAllChannels] = useState<any[]>([]);
    useEffect(() => {
        if (formData.deviceType !== "NVR") return;
        (async () => {
            try {
                const [devs, map] = await Promise.all([getDevices(), getNvrChannelMap()]);
                setNvrCams((devs || []).filter((d: any) => d.deviceType === "LPR_CAMERA"));
                setNvrMap(map || {});
                if (formData.ip) {
                    try {
                        const r: any = await getNvrChannels({ ip: formData.ip, username: formData.username, password: formData.password, authType: formData.authType });
                        if (r?.ok && r.channels?.length) {
                            const info: Record<string, { channel: number; name: string | null }> = {};
                            setNvrAllChannels(r.channels);
                            setNvrMap((prev) => { const m = { ...(map || {}), ...prev }; for (const ch of r.channels) { if (ch.ip) { m[ch.ip] = m[ch.ip] ?? ch.channel; info[ch.ip] = { channel: ch.channel, name: ch.name }; } } return m; });
                            setNvrInfo(info);
                        }
                    } catch { /* noop */ }
                }
            } catch { /* noop */ }
        })();
    }, [formData.deviceType]);
    const detectNvrChannels = async () => {
        setNvrBusy(true); setNvrMsg("");
        try {
            const r: any = await getNvrChannels({ ip: formData.ip, username: formData.username, password: formData.password, authType: formData.authType });
            if (r?.ok && r.channels?.length) {
                const info: Record<string, { channel: number; name: string | null }> = {};
                setNvrMap((prev) => { const m = { ...prev }; for (const ch of r.channels) { if (ch.ip) { m[ch.ip] = ch.channel; info[ch.ip] = { channel: ch.channel, name: ch.name }; } } return m; });
                setNvrInfo(info);
                setNvrMsg(`Detectados ${r.channels.length} canales por ISAPI`);
            } else setNvrMsg(r?.error || "No se detectaron canales");
        } catch (e: any) { setNvrMsg(e?.message || "Error"); }
        finally { setNvrBusy(false); }
    };
    const saveNvrMap = async () => {
        setNvrBusy(true);
        try { const r: any = await saveNvrChannelMap(nvrMap); setNvrMsg(r?.ok ? "Mapeo guardado ✓" : "Error al guardar"); }
        catch { setNvrMsg("Error al guardar"); }
        finally { setNvrBusy(false); }
    };
    const addCameraFromChannel = async (ch: any) => {
        setNvrBusy(true);
        try {
            const fd = new FormData();
            fd.set("name", ch.name || `Cámara ${ch.ip}`);
            fd.set("ip", ch.ip);
            fd.set("brand", "HIKVISION");
            fd.set("deviceType", "LPR_CAMERA");
            fd.set("direction", /salida|egres/i.test(ch.name || "") ? "EXIT" : "ENTRY");
            fd.set("location", "");
            fd.set("username", formData.username || "admin");
            fd.set("password", formData.password || "");
            fd.set("authType", "DIGEST");
            fd.set("mac", "");
            fd.set("groupId", "none");
            await createDevice(fd);
            const devs: any = await getDevices();
            setNvrCams((devs || []).filter((d: any) => d.deviceType === "LPR_CAMERA"));
            setNvrMap((prev) => ({ ...prev, [ch.ip]: ch.channel }));
            setNvrMsg(`Cámara agregada: ${ch.name || ch.ip}`);
        } catch (e: any) { setNvrMsg("No se pudo agregar: " + (e?.message || "")); }
        finally { setNvrBusy(false); }
    };
    const resetForm = () => {
        setFormData(buildDefaults());
        setModelPhotoFile(null);
        setBrandLogoFile(null);
        setDetectInfo(null);
        setStep(1);
    };
    const handleDetect = async () => {
        setDetecting(true); setDetectInfo(null);
        try {
            const res: any = await probeDeviceInfo({ ip: formData.ip, username: formData.username, password: formData.password, authType: formData.authType, brand: formData.brand });
            setDetectInfo(res);
            if (res?.ok) {
                setFormData(prev => ({
                    ...prev,
                    mac: prev.mac || res.macAddress || "",
                    deviceModel: prev.deviceModel || res.model || "",
                    name: prev.name || res.deviceName || res.model || "",
                }));
                if (formData.deviceType === "NVR") {
                    try {
                        const r: any = await getNvrChannels({ ip: formData.ip, username: formData.username, password: formData.password, authType: formData.authType });
                        if (r?.ok && r.channels?.length) {
                            const info: Record<string, { channel: number; name: string | null }> = {};
                            setNvrAllChannels(r.channels);
                            setNvrMap((prev) => { const m = { ...prev }; for (const ch of r.channels) { if (ch.ip) { m[ch.ip] = ch.channel; info[ch.ip] = { channel: ch.channel, name: ch.name }; } } return m; });
                            setNvrInfo(info);
                        }
                    } catch { /* noop */ }
                }
            }
        } catch (e: any) {
            setDetectInfo({ ok: false, error: e?.message || "Error de conexion" });
        } finally {
            setDetecting(false);
        }
    };

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleSelectChange = useCallback((name: string, value: string) => {
        setFormData(prev => ({ ...prev, [name]: value }));
    }, []);

    const handleSubmit = async () => {
        setIsSubmitting(true);
        const finalData = new FormData();
        Object.entries(formData).forEach(([key, value]) => {
            finalData.append(key, value);
        });

        if (modelPhotoFile) finalData.append("modelPhoto", modelPhotoFile);
        if (brandLogoFile) finalData.append("brandLogo", brandLogoFile);

        try {
            if (isEdit) {
                await updateDevice(device.id, finalData);
            } else {
                await createDevice(finalData);
            }
            setOpen(false);
            onSuccess();
            if (!isEdit) resetForm();
        } catch (error) {
            console.error("Error saving device:", error);
        } finally {
            setIsSubmitting(false);
        }
    };

    const nextStep = () => setStep(prev => Math.min(prev + 1, 3));
    const prevStep = () => setStep(prev => Math.max(prev - 1, 1));

    return (
        <Dialog open={open} onOpenChange={(val) => {
            setOpen(val);
            if (val) resetForm();   // formulario limpio (o valores del device) cada vez que se abre
            else setStep(1);
        }}>
            <DialogTrigger asChild>
                {children}
            </DialogTrigger>
            <DialogContent className="max-w-6xl w-[95vw] max-h-[92vh] p-0 bg-background border-border/60 overflow-hidden sm:rounded-md gap-0 shadow-lg shadow-black/60">
                <DialogHeader className="sr-only">
                    <DialogTitle>{isEdit ? "Editar Dispositivo" : "Nuevo Dispositivo"}</DialogTitle>
                    <DialogDescription>Configuraci&#243;n t&#233;cnica del nodo de acceso</DialogDescription>
                </DialogHeader>
                <div className="flex flex-col md:flex-row h-full min-h-[520px] max-h-[92vh] bg-background overflow-hidden">
                    {/* LEFT SIDE: Active Form Content */}
                    <div className="flex-1 p-8 lg:p-10 flex flex-col justify-between border-r border-border/40 overflow-y-auto custom-scrollbar">
                        <div className="flex-1">
                            {/* Step Indicator Header */}
                            <div className="mb-8">
                                <div className="flex items-center gap-1.5 mb-5">
                                    {[1, 2, 3].map(i => (
                                        <div key={i} className={cn(
                                            "h-[3px] rounded-sm transition-all duration-500",
                                            step === i ? "w-10 bg-blue-500" :
                                                step > i ? "w-6 bg-blue-500/40" : "w-6 bg-muted"
                                        )} />
                                    ))}
                                </div>
                                <h1 className="text-2xl font-bold text-foreground uppercase tracking-tight leading-none mb-1.5">
                                    {isEdit ? "Sincronizar Nodo" : "Alta de Dispositivo"}
                                </h1>
                                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-[0.15em]">
                                    {formData.brand} &bull; {formData.deviceType.replace('_', ' ')}
                                </p>
                            </div>

                            <div className="space-y-8 animate-in fade-in slide-in-from-left-4 duration-500">
                                {step === 1 && (
                                    <div className="space-y-8">
                                        <div className="space-y-2">
                                            <Label className="text-muted-foreground text-[10px] font-bold uppercase tracking-widest flex items-center gap-2">
                                                <HardDrive size={10} /> Nombre de Identificación
                                            </Label>
                                            <Input
                                                name="name"
                                                value={formData.name}
                                                onChange={handleInputChange}
                                                placeholder="Ej: Acceso Principal LPR"
                                                className="bg-card border-border h-12 rounded-lg text-lg font-bold focus:ring-blue-500/20"
                                            />
                                        </div>
                                        <div className="grid grid-cols-2 gap-8">
                                            <div className="space-y-2">
                                                <Label className="text-muted-foreground text-[10px] font-bold uppercase tracking-widest">Tipo</Label>
                                                <Select value={formData.deviceType} onValueChange={(val) => handleSelectChange("deviceType", val)}>
                                                    <SelectTrigger className="bg-card border-border h-12 rounded-lg font-bold">
                                                        <SelectValue />
                                                    </SelectTrigger>
                                                    <SelectContent className="bg-popover border-border text-foreground rounded-md">
                                                        <SelectItem value="LPR_CAMERA" className="py-3 font-bold">Cámara LPR</SelectItem>
                                                        <SelectItem value="NVR" className="py-3 font-bold">NVR / Grabador</SelectItem>
                                                        <SelectItem value="FACE_TERMINAL" className="py-3 font-bold">Acceso Facial</SelectItem>
                                                        <SelectItem value="QUEUE_COUNTER" className="py-3 font-bold">Contador de Filas</SelectItem>
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                            <div className="space-y-2">
                                                <Label className="text-muted-foreground text-[10px] font-bold uppercase tracking-widest">Fabricante</Label>
                                                <Select value={formData.brand} onValueChange={(val) => handleSelectChange("brand", val)}>
                                                    <SelectTrigger className="bg-card border-border h-12 rounded-lg font-bold">
                                                        <SelectValue />
                                                    </SelectTrigger>
                                                    <SelectContent className="bg-popover border-border text-foreground rounded-md">
                                                        {BRANDS.map(b => (
                                                            <SelectItem key={b.value} value={b.value} className="py-3 font-bold">
                                                                {b.label}
                                                            </SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                        </div>
                                        <div className="space-y-2">
                                            <Label className="text-muted-foreground text-[10px] font-bold uppercase tracking-widest flex items-center gap-2">
                                                <Cpu size={10} /> Modelo Hardware
                                            </Label>
                                            <Popover open={modelComboOpen} onOpenChange={setModelComboOpen}>
                                                <PopoverTrigger asChild>
                                                    <Button
                                                        variant="outline"
                                                        className="w-full justify-between bg-card border-border h-12 rounded-lg text-sm font-mono font-bold"
                                                    >
                                                        {formData.deviceModel
                                                            ? (DRIVER_MODELS[formData.brand as DriverDeviceBrand]?.find((m) => m.value === formData.deviceModel)?.label || formData.deviceModel)
                                                            : "Seleccionar modelo..."}
                                                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                                    </Button>
                                                </PopoverTrigger>
                                                <PopoverContent className="w-[400px] p-0 bg-popover border-border shadow-lg">
                                                    <Command className="bg-popover">
                                                        <CommandInput placeholder="Filtrar modelos..." className="h-10" />
                                                        <CommandEmpty>No hay resultados.</CommandEmpty>
                                                        <CommandGroup className="max-h-60 overflow-y-auto custom-scrollbar">
                                                            {DRIVER_MODELS[formData.brand as DriverDeviceBrand]?.map((model) => (
                                                                <CommandItem
                                                                    key={model.value}
                                                                    value={model.value}
                                                                    onSelect={(v) => {
                                                                        handleSelectChange("deviceModel", v);
                                                                        setModelComboOpen(false);
                                                                    }}
                                                                    className="px-4 py-3 cursor-pointer hover:bg-accent transition-colors"
                                                                >
                                                                    <div className="flex flex-col gap-0.5">
                                                                        <span className="font-bold text-foreground uppercase text-[11px]">{model.label}</span>
                                                                        <span className="text-[9px] text-muted-foreground font-bold tracking-widest uppercase">{model.category}</span>
                                                                    </div>
                                                                </CommandItem>
                                                            ))}
                                                        </CommandGroup>
                                                    </Command>
                                                </PopoverContent>
                                            </Popover>
                                        </div>

                                        {/* Camera Setup Guide */}
                                        {CAMERA_GUIDES[formData.brand] && (
                                            <div className="mt-4 border border-border/50 rounded-lg overflow-hidden">
                                                <button
                                                    type="button"
                                                    onClick={() => setShowGuide(!showGuide)}
                                                    className="w-full px-4 py-3 flex items-center justify-between bg-muted/20 hover:bg-muted/40 transition-colors"
                                                >
                                                    <div className="flex items-center gap-2">
                                                        <BookOpen size={14} className="text-violet-400" />
                                                        <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wide">
                                                            {CAMERA_GUIDES[formData.brand].title}
                                                        </span>
                                                    </div>
                                                    <ChevronDown size={14} className={cn("text-muted-foreground transition-transform", showGuide && "rotate-180")} />
                                                </button>
                                                {showGuide && (
                                                    <div className="px-4 py-3 space-y-3 border-t border-border/40">
                                                        <ol className="space-y-2">
                                                            {CAMERA_GUIDES[formData.brand].steps.map((s, idx) => (
                                                                <li key={idx} className="flex gap-2.5 items-start">
                                                                    <span className="w-5 h-5 rounded-full bg-violet-500/20 text-violet-400 text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                                                                        {idx + 1}
                                                                    </span>
                                                                    <span className="text-[11px] text-muted-foreground leading-relaxed">{s}</span>
                                                                </li>
                                                            ))}
                                                        </ol>
                                                        <div className="flex flex-col gap-2 pt-2 border-t border-border/30">
                                                            <div className="flex items-center gap-2">
                                                                <span className="text-[9px] text-muted-foreground uppercase font-bold">Webhook URL:</span>
                                                                <code className="text-[10px] font-mono text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded">
                                                                    {CAMERA_GUIDES[formData.brand].webhookUrl}
                                                                </code>
                                                            </div>
                                                            <div className="flex items-center gap-2">
                                                                <span className="text-[9px] text-muted-foreground uppercase font-bold">Auth:</span>
                                                                <span className="text-[10px] text-muted-foreground">{CAMERA_GUIDES[formData.brand].authNote}</span>
                                                            </div>
                                                            {CAMERA_GUIDES[formData.brand].docUrl && (
                                                                <a href={CAMERA_GUIDES[formData.brand].docUrl} target="_blank" rel="noopener noreferrer"
                                                                    className="inline-flex items-center gap-1.5 text-[10px] text-blue-400 hover:text-blue-300 transition-colors mt-1">
                                                                    <ExternalLink size={10} /> Documentacion oficial
                                                                </a>
                                                            )}
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                )}

                                {step === 2 && (
                                    <div className="space-y-8">
                                        <div className="grid grid-cols-2 gap-8">
                                            <div className="space-y-2">
                                                <Label className="text-muted-foreground text-[10px] font-bold uppercase tracking-widest flex items-center gap-2">
                                                    <Wifi size={10} /> Host / IP
                                                </Label>
                                                <Input
                                                    name="ip"
                                                    value={formData.ip}
                                                    onChange={handleInputChange}
                                                    className="bg-card border-border h-12 rounded-lg text-lg font-mono font-bold text-blue-400"
                                                />
                                            </div>
                                            <div className="space-y-2">
                                                <Label className="text-muted-foreground text-[10px] font-bold uppercase tracking-widest flex items-center gap-2">
                                                    <Globe size={10} /> Hardware ID (MAC)
                                                </Label>
                                                <Input
                                                    name="mac"
                                                    value={formData.mac}
                                                    onChange={handleInputChange}
                                                    className="bg-card border-border h-12 rounded-lg text-lg font-mono font-bold uppercase"
                                                />
                                            </div>
                                        </div>
                                        <div className="p-5 bg-foreground/[0.04] rounded-md border border-border flex items-center gap-4">
                                            <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center text-blue-500">
                                                <Network size={18} />
                                            </div>
                                            <p className="text-[11px] text-muted-foreground font-medium leading-relaxed">
                                                Requiere visibilidad en red local o puerto mapeado para gestión remota.
                                            </p>
                                        </div>
                                    </div>
                                )}

                                {step === 3 && (
                                    <div className="space-y-8">
                                        <div className="grid grid-cols-2 gap-8">
                                            <div className="space-y-2">
                                                <Label className="text-muted-foreground text-[10px] font-bold uppercase tracking-widest flex items-center gap-2">
                                                    <User size={10} /> Usuario Manager
                                                </Label>
                                                <Input
                                                    name="username"
                                                    value={formData.username}
                                                    onChange={handleInputChange}
                                                    className="bg-card border-border h-12 rounded-lg font-bold"
                                                />
                                            </div>
                                            <div className="space-y-2">
                                                <Label className="text-muted-foreground text-[10px] font-bold uppercase tracking-widest flex items-center gap-2">
                                                    <Lock size={10} /> API Password
                                                </Label>
                                                <Input
                                                    name="password"
                                                    type="password"
                                                    value={formData.password}
                                                    onChange={handleInputChange}
                                                    className="bg-card border-border h-12 rounded-lg font-bold"
                                                />
                                            </div>
                                        </div>

                                        {formData.brand === "HIKVISION" && (
                                            <div className="space-y-3 mb-2">
                                                <Button type="button" onClick={handleDetect} disabled={detecting || !formData.ip} variant="outline" className="w-full h-11 rounded-md border-blue-500/40 text-blue-500 font-bold uppercase tracking-wider text-[10px] hover:bg-blue-500/10 transition-all flex items-center justify-center gap-2">
                                                    {detecting ? <Loader2 size={14} className="animate-spin" /> : <Cpu size={14} />}
                                                    {detecting ? "Detectando..." : "Detectar por ISAPI (MAC / firmware / salud)"}
                                                </Button>
                                                {detectInfo && (detectInfo.ok ? (
                                                    <div className="p-4 rounded-md border bg-emerald-500/5 border-emerald-500/30 text-[11px] space-y-1.5">
                                                        <div className="flex items-center gap-2 text-emerald-500 font-bold uppercase tracking-wider text-[10px]"><BadgeCheck size={13} /> Equipo en linea</div>
                                                        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-muted-foreground font-mono">
                                                            <span>Modelo: <b className="text-foreground">{detectInfo.model || "-"}</b></span>
                                                            <span>Firmware: <b className="text-foreground">{detectInfo.firmwareVersion || "-"}</b></span>
                                                            <span>MAC: <b className="text-foreground">{detectInfo.macAddress || "-"}</b></span>
                                                            <span>Serie: <b className="text-foreground">{detectInfo.serialNumber || "-"}</b></span>
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <div className="p-3 rounded-md border bg-rose-500/5 border-rose-500/30 text-[11px] text-rose-500 flex items-center gap-2">
                                                        <span className="w-1.5 h-1.5 rounded-full bg-rose-500" /> {detectInfo.error || "No se pudo conectar"}
                                                    </div>
                                                ))}
                                            </div>
                                        )}

                                        <div className="grid grid-cols-2 gap-8">
                                            {formData.deviceType !== "NVR" && (
                                            <div className="space-y-3">
                                                <Label className="text-muted-foreground text-[10px] font-bold uppercase tracking-widest flex items-center gap-2">
                                                    <ArrowRightLeft size={10} /> Sentido del Flujo
                                                </Label>
                                                <Select value={formData.direction} onValueChange={(val) => handleSelectChange("direction", val)}>
                                                    <SelectTrigger className="bg-card border-border h-12 rounded-lg font-bold">
                                                        <SelectValue />
                                                    </SelectTrigger>
                                                    <SelectContent className="bg-popover border-border text-foreground rounded-md">
                                                        <SelectItem value="ENTRY" className="py-3 font-bold">ENTRADA (Ingreso)</SelectItem>
                                                        <SelectItem value="EXIT" className="py-3 font-bold">SALIDA (Egreso)</SelectItem>
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                            )}
                                            <div className="space-y-3">
                                                <Label className="text-muted-foreground text-[10px] font-bold uppercase tracking-widest flex items-center gap-2">
                                                    <MapPin size={10} /> Ubicación Física
                                                </Label>
                                                <Input
                                                    name="location"
                                                    value={formData.location}
                                                    onChange={handleInputChange}
                                                    placeholder="Lote 1030, Entrada B..."
                                                    className="bg-card border-border h-12 rounded-lg font-bold"
                                                />
                                            </div>
                                        </div>

                                        {formData.deviceType === "NVR" && (
                                            <div className="space-y-3 mt-6">
                                                <div className="flex items-center justify-between">
                                                    <Label className="text-muted-foreground text-[10px] font-bold uppercase tracking-widest flex items-center gap-2">
                                                        <Network size={10} /> Canales del grabador {nvrAllChannels.length > 0 && <span className="text-blue-400">({nvrAllChannels.length})</span>}
                                                    </Label>
                                                    <Button type="button" onClick={detectNvrChannels} disabled={nvrBusy || !formData.ip} variant="outline" className="h-8 px-3 rounded-md border-blue-500/40 text-blue-500 font-bold uppercase tracking-wider text-[10px] hover:bg-blue-500/10 flex items-center gap-1.5">
                                                        {nvrBusy ? <Loader2 size={13} className="animate-spin" /> : <Cpu size={13} />} Escanear canales
                                                    </Button>
                                                </div>
                                                <p className="text-[11px] text-muted-foreground">Cada tarjeta es un canal del grabador con su vista en vivo. Asigná la cámara OmniAccess que corresponde (se auto-detecta por IP) y tocá <b className="text-foreground">Guardar mapeo</b> para habilitar las grabaciones.</p>
                                                {nvrAllChannels.length === 0 ? (
                                                    <div className="flex flex-col items-center justify-center py-10 rounded-xl border border-dashed border-border text-muted-foreground gap-2">
                                                        <Network size={26} className="opacity-40" />
                                                        <span className="text-xs">Tocá “Escanear canales” para leer el grabador por ISAPI</span>
                                                    </div>
                                                ) : (
                                                    <div className="grid grid-cols-2 xl:grid-cols-3 gap-3 max-h-[400px] overflow-y-auto custom-scrollbar pr-1">
                                                        {nvrAllChannels.map((ch: any) => {
                                                            const assigned = nvrCams.find((cam: any) => nvrMap[cam.ip] === ch.channel);
                                                            const ipMatch = ch.ip ? nvrCams.find((cam: any) => cam.ip === ch.ip) : null;
                                                            return (
                                                                <div key={ch.channel} className={cn("relative rounded-xl overflow-hidden border transition-all", assigned ? "border-emerald-500/60 shadow-[0_0_12px_rgba(16,185,129,0.15)]" : "border-border hover:border-blue-500/40")}>
                                                                    <div className="relative aspect-video bg-black">
                                                                        <img src={`/api/nvr/snapshot?ch=${ch.channel}`} alt="" className="absolute inset-0 w-full h-full object-cover" onError={(e) => { (e.currentTarget as HTMLImageElement).style.opacity = "0"; }} />
                                                                        <div className="absolute top-1.5 left-1.5 z-10 min-w-7 h-7 px-1.5 rounded-lg bg-black/80 border border-white/25 flex items-center justify-center text-white text-sm font-bold font-mono shadow">{ch.channel}</div>
                                                                        {assigned && (
                                                                            <div className="absolute top-1.5 right-1.5 z-10 px-1.5 py-0.5 rounded-md bg-emerald-600/95 text-white text-[9px] font-bold flex items-center gap-1 shadow"><BadgeCheck size={10} /> MAPEADA</div>
                                                                        )}
                                                                        <div className="absolute inset-x-0 bottom-0 z-[5] bg-gradient-to-t from-black/95 via-black/60 to-transparent px-2 pb-1.5 pt-6 pointer-events-none">
                                                                            <p className="text-[10px] font-bold text-white truncate leading-tight">{ch.name || `Canal ${ch.channel}`}</p>
                                                                            <p className="text-[9px] text-white/60 font-mono leading-tight">{ch.ip || "sin IP"}</p>
                                                                        </div>
                                                                    </div>
                                                                    <div className="p-2 space-y-1.5 bg-card/80">
                                                                        <select
                                                                            value={assigned ? assigned.id : ""}
                                                                            onChange={(e) => {
                                                                                const camId = e.target.value;
                                                                                setNvrMap((prev) => {
                                                                                    const m: Record<string, number> = { ...prev } as any;
                                                                                    for (const k of Object.keys(m)) { if ((m as any)[k] === ch.channel) delete (m as any)[k]; }
                                                                                    if (camId) { const cam = nvrCams.find((x: any) => x.id === camId); if (cam) (m as any)[cam.ip] = ch.channel; }
                                                                                    return m;
                                                                                });
                                                                            }}
                                                                            className="w-full bg-background border border-border rounded-md px-2 py-1.5 text-[11px] text-foreground focus:outline-none focus:ring-1 focus:ring-blue-500/50"
                                                                        >
                                                                            <option value="">— Sin asignar —</option>
                                                                            {nvrCams.map((cam: any) => (
                                                                                <option key={cam.id} value={cam.id}>{cam.name} ({cam.ip})</option>
                                                                            ))}
                                                                        </select>
                                                                        {!ipMatch && ch.ip && !assigned && (
                                                                            <Button type="button" onClick={() => addCameraFromChannel(ch)} disabled={nvrBusy} className="w-full h-7 bg-blue-600/90 hover:bg-blue-500 text-white text-[10px] font-bold rounded-md flex items-center justify-center gap-1"><Plus size={11} /> Crear cámara con esta IP</Button>
                                                                        )}
                                                                    </div>
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                )}
                                                <div className="flex items-center justify-between pt-1">
                                                    <span className="text-[11px] text-muted-foreground">{nvrMsg}</span>
                                                    <Button type="button" onClick={saveNvrMap} disabled={nvrBusy} className="h-9 px-5 bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-bold rounded-md">Guardar mapeo</Button>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Navigation Footer */}
                        <div className="flex gap-3 pt-8 border-t border-border/40">
                            {step > 1 && (
                                <Button
                                    type="button"
                                    onClick={prevStep}
                                    variant="outline"
                                    className="h-11 px-6 rounded-md border-border text-muted-foreground font-semibold uppercase tracking-wider text-[10px] hover:bg-muted hover:text-foreground transition-all"
                                >
                                    Atr&#225;s
                                </Button>
                            )}
                            {step < 3 ? (
                                <Button
                                    type="button"
                                    onClick={nextStep}
                                    className="flex-1 h-11 rounded-md bg-blue-600 hover:bg-blue-500 text-foreground font-bold uppercase tracking-wider text-[11px] transition-colors"
                                >
                                    Continuar a Fase {step + 1} <ArrowRightLeft size={14} className="ml-2 opacity-50" />
                                </Button>
                            ) : (
                                <Button
                                    onClick={handleSubmit}
                                    disabled={isSubmitting}
                                    className="flex-1 h-11 rounded-md bg-blue-600 hover:bg-blue-500 text-foreground font-bold uppercase tracking-wider text-[11px] transition-colors"
                                >
                                    {isSubmitting ? <Loader2 className="animate-spin" /> : isEdit ? "Sincronizar Nodo" : "Finalizar y Vincular"}
                                </Button>
                            )}
                        </div>
                    </div>

                    {/* RIGHT SIDE: Tech Aesthetic + Large Floating Numbers */}
                    {!(formData.deviceType === "NVR" && step === 3) && (
                    <div className="relative w-full md:w-[36%] bg-background flex flex-col items-center justify-center p-8 group overflow-hidden shrink-0">
                        <Image
                            src="/device_background.png"
                            alt="Hardware Architecture"
                            fill
                            className="object-cover opacity-[0.06] grayscale transition-all duration-700 group-hover:opacity-[0.12]"
                        />

                        {/* Subtle grid */}
                        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.02)_1px,transparent_1px)] bg-[size:40px_40px] opacity-40" />

                        {/* Floating stylized numbers */}
                        <div className="relative w-full h-full flex flex-col items-center justify-center pointer-events-none">
                            {[1, 2, 3].map(i => (
                                <div
                                    key={i}
                                    className={cn(
                                        "absolute transition-all duration-700 ease-out font-bold leading-none",
                                        step === i
                                            ? "opacity-100 scale-100 blur-0 translate-y-0"
                                            : "opacity-0 scale-75 blur-md translate-y-10"
                                    )}
                                >
                                    <span className="text-[200px] text-blue-500/80 tracking-tighter select-none" style={{ textShadow: '0 0 60px rgba(59,130,246,0.2)' }}>
                                        {i === 1 ? '01' : i === 2 ? '02' : '03'}
                                    </span>
                                </div>
                            ))}
                        </div>

                        {/* Active Step label */}
                        <div className="mt-auto relative z-10 w-full max-w-[260px] p-5 rounded-md bg-card/60 border border-border/60 backdrop-blur-sm">
                            <div className="flex items-center gap-2.5 mb-3">
                                <div className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
                                <span className="text-[10px] font-bold text-blue-400 uppercase tracking-wider">
                                    {step === 1 ? "Fase 01: Identidad" : step === 2 ? "Fase 02: Network" : "Fase 03: Protocolos"}
                                </span>
                            </div>
                            <p className="text-[11px] text-muted-foreground leading-relaxed">
                                {step === 1 ? "Defina el fabricante y el modelo específico para cargar los controladores necesarios." :
                                    step === 2 ? "Configure el direccionamiento IP y valide el enlace MAC para comunicación bidireccional." :
                                        "Ajuste los métodos de autenticación y el sentido de flujo del nodo de acceso."}
                            </p>
                        </div>
                    </div>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
}
