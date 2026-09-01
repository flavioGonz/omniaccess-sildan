"use client";

import { useEffect, useState, useRef } from "react";
import { User, Unit, AccessGroup, UserRole, Credential, VehicleType } from "@prisma/client";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
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
    User as UserIcon,
    Shield,
    DoorOpen,
    Users,
    Car,
    Camera,
    Upload,
    Check,
    Briefcase,
    BadgeCheck,
    Truck,
    Bike,
    Bus,
    Phone,
    CreditCard,
    KeyRound,
    Server,
    Info,
    MapPin,
    ParkingSquare,
    Save,
    X
} from "lucide-react";
import Image from "next/image";
import { cn } from "@/lib/utils";
import { createUser, updateUser } from "@/app/actions/users";
import { addDevicePlate } from "@/app/actions/devices";
import { syncUserToDevice } from "@/app/actions/deviceMemory";
import { Loader2, AlertCircle, CheckCircle2, ScanFace } from "lucide-react";

type UserWithRelations = User & {
    unit: Unit | null;
    credentials: Credential[];
    accessGroups: AccessGroup[];
    vehicles: any[];
    accessTags?: string[];
    apartment?: string | null;
    parkingSlotId?: string | null;
};

interface UserFormDialogProps {
    user?: UserWithRelations;
    initialData?: {
        name?: string;
        dni?: string;
        plate?: string;
        cara?: string;
    };
    units: Unit[];
    groups: AccessGroup[];
    devices: any[];
    parkingSlots?: any[];
    onSuccess: () => void;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

const VEHICLE_TYPES = [
    { value: 'SEDAN', label: 'Particular / Sedán', icon: Car },
    { value: 'SUV', label: 'SUV / Camioneta', icon: Car },
    { value: 'PICKUP', label: 'Pick-up', icon: Truck },
    { value: 'VAN', label: 'Furgón / Van', icon: Bus },
    { value: 'TRUCK', label: 'Camión', icon: Truck },
    { value: 'MOTORCYCLE', label: 'Motocicleta', icon: Bike },
];

export function UserFormDialog({ user, initialData, units, groups, devices, parkingSlots = [], onSuccess, open, onOpenChange }: UserFormDialogProps) {
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [previewUrl, setPreviewUrl] = useState<string | null>(user?.cara || null);
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [plateValue, setPlateValue] = useState(user?.credentials?.find(c => c.type === 'PLATE')?.value || "");
    const [pinValue, setPinValue] = useState(user?.credentials?.find(c => c.type === 'PIN')?.value || "");
    const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);
    const [selectedDeviceIds, setSelectedDeviceIds] = useState<string[]>([]);
    const [selectedFaceDeviceIds, setSelectedFaceDeviceIds] = useState<string[]>([]);
    const [deviceSyncStatuses, setDeviceSyncStatuses] = useState<Record<string, 'pending' | 'syncing' | 'success' | 'error'>>({});
    const [selectedUnitId, setSelectedUnitId] = useState<string>("none");
    const [activeTab, setActiveTab] = useState("general");
    const [syncStatus, setSyncStatus] = useState<{ total: number, current: number, currentName: string } | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const isEdit = !!user;

    // Derived states
    const selectedUnit = units.find(u => u.id === selectedUnitId);
    const isBuilding = selectedUnit?.type === 'EDIFICIO';

    useEffect(() => {
        if (open) {
            setActiveTab("general");
            let path = user?.cara || initialData?.cara || null;
            if (path && !path.startsWith('http') && !path.startsWith('/')) {
                path = '/' + path;
            }
            setPreviewUrl(path);

            setPlateValue(
                user?.credentials?.find(c => c.type === 'PLATE')?.value ||
                user?.vehicles?.[0]?.plate ||
                initialData?.plate ||
                ""
            );

            setPinValue(user?.credentials?.find(c => c.type === 'PIN')?.value || "");
            setSelectedFile(null);
            setSelectedGroupIds(user?.accessGroups?.map(g => g.id) || []);
            setSelectedUnitId(user?.unitId || "none");
            setSelectedDeviceIds([]); // Reset on open
            setSelectedFaceDeviceIds([]); // Reset on open
            setDeviceSyncStatuses({});

            // Set initial name/dni if provided and not editing
            if (!isEdit && initialData) {
                // We'll use defaultValue in the inputs for name/dni, 
                // but for plateValue we use state because it's controlled.
            }
        }
    }, [open, user, initialData]);

    const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        if (event.target.files && event.target.files[0]) {
            const file = event.target.files[0];
            setSelectedFile(file);
            setPreviewUrl(URL.createObjectURL(file));
        }
    };

    const toggleGroup = (id: string) => {
        setSelectedGroupIds(prev =>
            prev.includes(id) ? prev.filter(g => g !== id) : [...prev, id]
        );
    };

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        const formData = new FormData(e.currentTarget);

        // Manual Validation
        const name = formData.get("name") as string;
        const phone = formData.get("phone") as string;

        if (!name || !name.trim()) {
            setActiveTab("general");
            // Small timeout to allow tab switch before alert/focus
            setTimeout(() => alert("El Nombre Completo es obligatorio."), 10);
            return;
        }

        // Ensure values from state are in formData (Select components might not always trigger native form values)
        formData.set("unitId", selectedUnitId);

        setIsSubmitting(true);

        try {
            let currentUserId = user?.id;

            if (isEdit) {
                await updateUser(user.id, formData);
            } else {
                const newUser = await createUser(formData);
                currentUserId = newUser.id;
            }

            // If there's a file and we have a user ID, upload it
            if (selectedFile && currentUserId) {
                const imgData = new FormData();
                imgData.append("faceImage", selectedFile);

                const uploadRes = await fetch(`/api/users/${currentUserId}/face`, {
                    method: 'POST',
                    body: imgData,
                });

                if (!uploadRes.ok) {
                    console.error("Face upload failed:", await uploadRes.text());
                }
            }

            // --- LPR MANUAL SYNC PROCESS ---
            const allSyncIds = formData.getAll("syncDeviceId") as string[];
            const syncDeviceIds = Array.from(new Set(allSyncIds)); // Deduplicate
            const plate = formData.get("plate") as string;

            if (plate && plate.trim() !== "" && syncDeviceIds.length > 0) {
                setActiveTab("sync");
                setSyncStatus({ total: syncDeviceIds.length, current: 0, currentName: "" });

                const initials: Record<string, 'pending'> = {};
                syncDeviceIds.forEach(id => initials[id] = 'pending');
                setDeviceSyncStatuses(initials as any);

                for (let i = 0; i < syncDeviceIds.length; i++) {
                    const devId = syncDeviceIds[i];
                    const device = devices.find(d => d.id === devId);


                    setSyncStatus({
                        total: syncDeviceIds.length,
                        current: i,
                        currentName: device?.name || "Equipo"
                    });

                    setDeviceSyncStatuses(prev => ({ ...prev, [devId]: 'syncing' }));

                    try {
                        const res = await addDevicePlate(devId, plate.toUpperCase().trim());

                        if (res.success) {
                            setDeviceSyncStatuses(prev => ({ ...prev, [devId]: 'success' }));
                        } else {
                            setDeviceSyncStatuses(prev => ({ ...prev, [devId]: 'error' }));
                        }
                        // Small pause to allow the UI to show the state and avoid saturating the server
                        await new Promise(resolve => setTimeout(resolve, 400));
                    } catch (err) {
                        console.error(`Sync error for ${device?.name}:`, err);
                        setDeviceSyncStatuses(prev => ({ ...prev, [devId]: 'error' }));
                    }
                }
                setSyncStatus({ total: syncDeviceIds.length, current: syncDeviceIds.length, currentName: "Sincronización Finalizada" });
                // Short delay to show completion
                await new Promise(resolve => setTimeout(resolve, 1000));
            }

            // --- FACE MANUAL SYNC PROCESS ---
            const allFaceSyncIds = formData.getAll("syncFaceDeviceId") as string[];
            const syncFaceDeviceIds = Array.from(new Set(allFaceSyncIds));

            if (previewUrl && syncFaceDeviceIds.length > 0 && currentUserId) {
                setActiveTab("sync");
                if (!plate) setSyncStatus({ total: syncFaceDeviceIds.length, current: 0, currentName: "" }); // Reset if plate sync didn't run

                for (let i = 0; i < syncFaceDeviceIds.length; i++) {
                    const devId = syncFaceDeviceIds[i];
                    const device = devices.find(d => d.id === devId);

                    setSyncStatus({
                        total: syncFaceDeviceIds.length,
                        current: i,
                        currentName: device?.name || "Terminal Facial"
                    });

                    setDeviceSyncStatuses(prev => ({ ...prev, [devId]: 'syncing' }));

                    try {
                        // Use syncUserToDevice which handles face sync
                        const res = await syncUserToDevice(devId, currentUserId);

                        if (res) {
                            setDeviceSyncStatuses(prev => ({ ...prev, [devId]: 'success' }));
                        } else {
                            setDeviceSyncStatuses(prev => ({ ...prev, [devId]: 'error' }));
                        }
                        await new Promise(resolve => setTimeout(resolve, 500));
                    } catch (err) {
                        console.error(`Face Sync error for ${device?.name}:`, err);
                        setDeviceSyncStatuses(prev => ({ ...prev, [devId]: 'error' }));
                    }
                }
                setSyncStatus({ total: syncFaceDeviceIds.length, current: syncFaceDeviceIds.length, currentName: "Sincronización Finalizada" });
                await new Promise(resolve => setTimeout(resolve, 1000));
            }

            onOpenChange(false);
            onSuccess();
        } catch (error) {
            console.error("Error saving user:", error);
            alert("Error al guardar el usuario. Inténtelo nuevamente.");
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-4xl p-0 bg-card border-border overflow-hidden rounded-2xl gap-0 shadow-[0_20px_60px_rgba(0,0,0,0.8)] transition-all duration-300">
                <div className="flex flex-col md:flex-row h-full min-h-[500px]">

                    {/* Left Side: Form with Tabs */}
                    <div className="flex-1 bg-card flex flex-col h-full overflow-hidden">
                        <form onSubmit={handleSubmit} noValidate className="flex flex-col h-full">
                            {initialData?.cara && !selectedFile && (
                                <input type="hidden" name="cara" value={initialData.cara} />
                            )}
                            <div className="px-6 pt-6 pb-3 border-b border-border">
                                <DialogHeader className="space-y-2">
                                    <DialogTitle className="text-xl font-bold text-foreground flex items-center gap-3 tracking-tight">
                                        <div className={cn(
                                            "p-2 rounded-lg",
                                            isEdit ? "bg-blue-500/10 border border-blue-500/20" : "bg-emerald-500/10 border border-emerald-500/20"
                                        )}>
                                            {isEdit ? <BadgeCheck className="text-blue-400" size={20} /> : <Users className="text-emerald-400" size={20} />}
                                        </div>
                                        {isEdit ? "Perfil de Usuario" : "Nuevo Registro"}
                                    </DialogTitle>
                                    <DialogDescription className="text-muted-foreground text-xs leading-relaxed pl-11">
                                        Gestión integral de identidad, residencia y credenciales de acceso
                                    </DialogDescription>
                                </DialogHeader>
                            </div>

                            <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col min-h-0">
                                <div className="px-6 pt-3 pb-2">
                                    <TabsList className="w-full grid grid-cols-3 bg-muted border border-border h-10 p-1 rounded-lg">
                                        <TabsTrigger value="general" className="text-[10px] font-bold uppercase tracking-wider data-[state=active]:bg-foreground/10 data-[state=active]:text-foreground text-muted-foreground rounded-md transition-all duration-200">
                                            General
                                        </TabsTrigger>
                                        <TabsTrigger value="credentials" className="text-[10px] font-bold uppercase tracking-wider data-[state=active]:bg-foreground/10 data-[state=active]:text-foreground text-muted-foreground rounded-md transition-all duration-200">
                                            Credenciales
                                        </TabsTrigger>
                                        <TabsTrigger value="sync" className="text-[10px] font-bold uppercase tracking-wider data-[state=active]:bg-foreground/10 data-[state=active]:text-foreground text-muted-foreground rounded-md transition-all duration-200">
                                            Sincronización
                                        </TabsTrigger>
                                    </TabsList>
                                </div>

                                <div className="flex-1 overflow-y-auto px-6 py-2 custom-scrollbar">
                                    {/* --- TAB: GENERAL --- */}
                                    <TabsContent value="general" forceMount={true} className="mt-0 space-y-4 data-[state=inactive]:hidden">
                                        <div className="space-y-3">
                                            {/* Bloque Info Personal */}
                                            <div className="flex items-center gap-2 text-[10px] font-bold text-muted-foreground uppercase tracking-widest border-b border-border pb-1">
                                                <UserIcon size={12} /> Información Básica
                                            </div>

                                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3 p-3 rounded-lg bg-card/30 border border-border/50">
                                                <div className="space-y-1.5">
                                                    <Label className="text-muted-foreground text-[10px] uppercase font-bold tracking-wider flex items-center gap-1.5">
                                                        <UserIcon size={12} /> Nombre Completo
                                                    </Label>
                                                    <Input
                                                        name="name"
                                                        defaultValue={user?.name || initialData?.name}
                                                        placeholder="Nombre Apellido"
                                                        required
                                                        className="bg-card border-border focus:border-blue-500/50 h-8 rounded-lg text-xs transition-all"
                                                    />
                                                </div>

                                                <div className="space-y-1.5">
                                                    <Label className="text-muted-foreground text-[10px] uppercase font-bold tracking-wider flex items-center gap-1.5">
                                                        <Phone size={12} /> Teléfono / Whatsapp
                                                    </Label>
                                                    <Input
                                                        name="phone"
                                                        type="tel"
                                                        defaultValue={user?.phone || ""}
                                                        placeholder="+54 9 11 ..."
                                                        className="bg-card border-border focus:border-blue-500/50 h-8 rounded-lg text-xs transition-all"
                                                    />
                                                </div>

                                                <div className="space-y-1.5">
                                                    <Label className="text-muted-foreground text-[10px] uppercase font-bold tracking-wider flex items-center gap-1.5">
                                                        <Briefcase size={12} /> Rol de Acceso
                                                    </Label>
                                                    <Select name="role" defaultValue={user?.role || "RESIDENT"}>
                                                        <SelectTrigger className="bg-card border-border h-8 rounded-lg text-xs">
                                                            <SelectValue />
                                                        </SelectTrigger>
                                                        <SelectContent className="bg-card border-border text-foreground rounded-lg">
                                                            <SelectItem value="RESIDENT">Residente</SelectItem>
                                                            <SelectItem value="VISITOR">Visita</SelectItem>
                                                            <SelectItem value="TEMPORARY_VISITOR">Visita Temporal</SelectItem>
                                                            <SelectItem value="PROVIDER">Proveedor</SelectItem>
                                                            <SelectItem value="STAFF">Staff</SelectItem>
                                                            <SelectItem value="WHITELISTED">Lista Blanca</SelectItem>
                                                            <SelectItem value="ADMIN">Administrador</SelectItem>
                                                        </SelectContent>
                                                    </Select>
                                                </div>

                                                <div className="space-y-1.5">
                                                    <Label className="text-muted-foreground text-[10px] uppercase font-bold tracking-wider flex items-center gap-1.5">
                                                        <Shield size={12} /> Identificación (DNI)
                                                    </Label>
                                                    <Input
                                                        name="dni"
                                                        defaultValue={user?.dni || initialData?.dni}
                                                        placeholder="Opcional"
                                                        className="bg-card border-border focus:border-blue-500/50 h-8 rounded-lg text-xs transition-all"
                                                    />
                                                </div>
                                            </div>

                                            {/* Bloque Residencia */}
                                            <div className="flex items-center gap-2 text-[10px] font-bold text-muted-foreground uppercase tracking-widest border-b border-border pb-1 mt-4">
                                                <DoorOpen size={12} /> Residencia & Ubicación
                                            </div>

                                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3 p-4 rounded-xl bg-muted/50 border border-border">
                                                <div className="space-y-2">
                                                    <Label className="text-muted-foreground text-[11px] font-semibold tracking-wide flex items-center gap-2">
                                                        <DoorOpen size={14} className="text-blue-400" /> Lote / Unidad
                                                    </Label>
                                                    <Select
                                                        name="unitId"
                                                        value={selectedUnitId}
                                                        onValueChange={setSelectedUnitId}
                                                    >
                                                        <SelectTrigger className="bg-muted border-border h-9 rounded-lg text-xs hover:border-border transition-colors">
                                                            <SelectValue placeholder="Seleccionar lote..." />
                                                        </SelectTrigger>
                                                        <SelectContent className="bg-card border-border text-foreground rounded-xl max-h-[200px]">
                                                            <SelectItem value="none" className="text-muted-foreground">Sin Asignación</SelectItem>
                                                            {units.map(u => (
                                                                <SelectItem key={u.id} value={u.id} className="hover:bg-accent">{u.name}</SelectItem>
                                                            ))}
                                                        </SelectContent>
                                                    </Select>
                                                </div>

                                                <div className="space-y-1.5">
                                                    <Label className="text-muted-foreground text-[10px] uppercase font-bold tracking-wider flex items-center gap-1.5">
                                                        <ParkingSquare size={12} /> Cochera / Parking Slot
                                                    </Label>
                                                    <Select name="parkingSlotId" defaultValue={user?.parkingSlotId || "none"}>
                                                        <SelectTrigger className="bg-card border-border h-8 rounded-lg text-xs">
                                                            <SelectValue placeholder="Seleccionar Cochera..." />
                                                        </SelectTrigger>
                                                        <SelectContent className="bg-card border-border text-foreground rounded-lg max-h-[200px]">
                                                            <SelectItem value="none">Sin Cochera Asignada</SelectItem>
                                                            {parkingSlots.map(slot => {
                                                                const isOccupied = slot.user && slot.user.id !== user?.id;
                                                                return (
                                                                    <SelectItem
                                                                        key={slot.id}
                                                                        value={slot.id}
                                                                        disabled={isOccupied}
                                                                        className={cn(isOccupied && "text-muted-foreground")}
                                                                    >
                                                                        {slot.label} {isOccupied ? `(Ocupado: ${slot.user.name})` : ''}
                                                                    </SelectItem>
                                                                );
                                                            })}
                                                        </SelectContent>
                                                    </Select>
                                                </div>

                                                {(isBuilding || user?.apartment) && (
                                                    <div className="space-y-1.5 col-span-1 sm:col-span-2 animate-in fade-in zoom-in duration-300">
                                                        <Label className="text-muted-foreground text-[10px] uppercase font-bold tracking-wider flex items-center gap-1.5">
                                                            <MapPin size={12} /> Depto / Unidad Funcional
                                                        </Label>
                                                        <Input
                                                            name="apartment"
                                                            defaultValue={user?.apartment || ""}
                                                            placeholder="Ej: 4B, PB-2..."
                                                            className="bg-card border-border focus:border-blue-500/50 h-8 rounded-lg text-xs transition-all"
                                                        />
                                                    </div>
                                                )}
                                            </div>

                                            {/* Bloque Grupos */}
                                            <div className="flex items-center gap-2 text-[10px] font-bold text-muted-foreground uppercase tracking-widest border-b border-border pb-1 mt-4">
                                                <KeyRound size={12} /> Grupos de Seguridad
                                            </div>

                                            <div className="flex flex-wrap gap-2 pt-1 p-3 rounded-lg bg-card/30 border border-border/50">
                                                {groups.map(group => (
                                                    <div
                                                        key={group.id}
                                                        onClick={() => toggleGroup(group.id)}
                                                        className={cn(
                                                            "px-3 py-1.5 rounded-lg border text-[10px] font-bold uppercase tracking-wider cursor-pointer transition-all select-none flex items-center gap-2",
                                                            selectedGroupIds.includes(group.id)
                                                                ? "bg-blue-500/20 border-blue-500/50 text-blue-400 hover:bg-blue-500/30"
                                                                : "bg-card border-border text-muted-foreground hover:border-border hover:text-muted-foreground"
                                                        )}
                                                    >
                                                        {selectedGroupIds.includes(group.id) && <Check size={10} />}
                                                        {group.name}
                                                    </div>
                                                ))}
                                                {groups.length === 0 && (
                                                    <span className="text-[10px] text-muted-foreground italic">No hay grupos creados.</span>
                                                )}
                                            </div>
                                            {selectedGroupIds.map(id => (
                                                <input key={id} type="hidden" name="groupId" value={id} />
                                            ))}
                                        </div>
                                    </TabsContent>

                                    {/* --- TAB: CREDENTIALS --- */}
                                    <TabsContent value="credentials" forceMount={true} className="mt-0 space-y-6 data-[state=inactive]:hidden">
                                        {/* Physical Access */}
                                        <div className="space-y-4">
                                            <div className="flex items-center gap-2 text-[10px] font-bold text-muted-foreground uppercase tracking-widest border-b border-border pb-2">
                                                <BadgeCheck size={12} /> Control de Acceso (Físico)
                                            </div>
                                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                                <div className="space-y-1.5">
                                                    <Label className="text-muted-foreground text-[10px] uppercase font-bold tracking-wider">Tags de Acceso (NFC / RFID)</Label>
                                                    <div className="relative group">
                                                        <CreditCard size={14} className="absolute left-3 top-2.5 text-muted-foreground" />
                                                        <Input
                                                            name="accessTags"
                                                            defaultValue={user?.accessTags?.join(", ") || user?.credentials?.find(c => c.type === 'TAG')?.value || ""}
                                                            placeholder="Ej: E20030040506, TAG-9921"
                                                            className="bg-card border-border focus:border-blue-500/50 pl-9 h-8 rounded-lg text-xs transition-all font-mono text-emerald-400 placeholder:text-muted-foreground pointer-events-auto"
                                                        />
                                                    </div>
                                                    <p className="text-[9px] text-muted-foreground mt-1 pl-1">Separa múltiples tags con comas.</p>
                                                </div>
                                                <div className="space-y-1.5">
                                                    <Label className="text-muted-foreground text-[10px] uppercase font-bold tracking-wider flex items-center gap-1.5">
                                                        Código PIN
                                                    </Label>
                                                    <div className="relative group">
                                                        <KeyRound size={14} className="absolute left-3 top-2.5 text-muted-foreground" />
                                                        <Input
                                                            name="pin"
                                                            value={pinValue}
                                                            onChange={(e) => setPinValue(e.target.value)}
                                                            placeholder="Ej: 1234"
                                                            className="bg-card border-border focus:border-blue-500/50 pl-9 h-8 rounded-lg text-xs transition-all font-mono text-amber-400 placeholder:text-muted-foreground"
                                                        />
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="flex gap-2 flex-wrap">
                                                {user?.accessTags?.map((tag, i) => (
                                                    <div key={i} className="px-2 py-0.5 bg-emerald-500/10 border border-emerald-500/20 rounded text-[10px] font-mono text-emerald-400">
                                                        {tag}
                                                    </div>
                                                ))}
                                            </div>
                                        </div>

                                        {/* Vehicle Access */}
                                        <div className="space-y-4">
                                            <div className="flex items-center gap-2 text-[10px] font-bold text-muted-foreground uppercase tracking-widest border-b border-border pb-2">
                                                <Car size={12} /> Credenciales LPR (Vehículo)
                                            </div>

                                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 items-end">
                                                <div className="space-y-2">
                                                    <Label className="text-muted-foreground text-[10px] uppercase font-bold tracking-wider">Matrícula</Label>
                                                    <div className="relative w-full h-16 bg-white rounded border border-border overflow-hidden shadow-sm flex flex-col group">
                                                        <div className="h-4 bg-[#003399] w-full flex items-center justify-between px-2">
                                                            <span className="text-[6px] text-foreground font-bold tracking-widest">MERCOSUR</span>
                                                            <div className="w-3 h-1.5 bg-yellow-400/20 rounded-[1px]" />
                                                        </div>
                                                        <div className="flex-1 flex items-center justify-center">
                                                            <input
                                                                name="plate"
                                                                value={plateValue}
                                                                onChange={(e) => setPlateValue(e.target.value.toUpperCase())}
                                                                placeholder="AAA000"
                                                                className="w-full text-center text-xl font-bold tracking-[0.1em] text-muted-foreground bg-transparent outline-none uppercase placeholder:text-foreground"
                                                            />
                                                        </div>
                                                    </div>
                                                </div>

                                                <div className="space-y-1.5">
                                                    <Label className="text-muted-foreground text-[10px] uppercase font-bold tracking-wider">Clase</Label>
                                                    <Select name="vehicleType" defaultValue={user?.vehicles?.[0]?.type || "SEDAN"}>
                                                        <SelectTrigger className="bg-card border-border h-8 rounded-lg text-xs">
                                                            <SelectValue />
                                                        </SelectTrigger>
                                                        <SelectContent className="bg-card border-border text-foreground rounded-lg">
                                                            {VEHICLE_TYPES.map(vt => (
                                                                <SelectItem key={vt.value} value={vt.value}>
                                                                    <div className="flex items-center gap-2">
                                                                        <vt.icon size={14} className="text-muted-foreground" />
                                                                        {vt.label}
                                                                    </div>
                                                                </SelectItem>
                                                            ))}
                                                        </SelectContent>
                                                    </Select>
                                                </div>
                                            </div>
                                        </div>
                                    </TabsContent>

                                    {/* --- TAB: SYNC --- */}
                                    <TabsContent value="sync" forceMount={true} className="mt-0 space-y-6 data-[state=inactive]:hidden">
                                        <div className="space-y-3">
                                            <div className="flex items-center gap-2 text-[10px] font-bold text-muted-foreground uppercase tracking-widest border-b border-border pb-1">
                                                <Server size={12} /> Equipos con Acceso (por Grupos)
                                            </div>
                                            <div className="bg-card/50 rounded-lg p-3 border border-border">
                                                {selectedGroupIds.length > 0 ? (
                                                    <div className="space-y-2">
                                                        <p className="text-[9px] text-muted-foreground font-bold uppercase">Dispositivos con acceso Permitido:</p>
                                                        <div className="flex flex-wrap gap-2">
                                                            {groups.filter(g => selectedGroupIds.includes(g.id)).flatMap(g => (g as any).devices || []).length > 0 ? (
                                                                groups.filter(g => selectedGroupIds.includes(g.id)).flatMap(g => (g as any).devices || []).map((dev: any, i: number) => (
                                                                    <div key={i} className="flex items-center gap-2 px-2 py-1 bg-blue-500/5 border border-blue-500/10 rounded text-[9px] text-blue-400">
                                                                        <div className="w-1 h-1 rounded-full bg-blue-500 animate-pulse" />
                                                                        {dev.name} ({dev.ip})
                                                                    </div>
                                                                ))
                                                            ) : (
                                                                <span className="text-[9px] text-muted-foreground italic">No hay equipos vinculados a los grupos seleccionados.</span>
                                                            )}
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <div className="flex items-center gap-2 text-amber-500/50">
                                                        <Info size={12} />
                                                        <span className="text-[9px] font-bold uppercase">Sin Grupos de Acceso - No se sincronizará con ningún equipo.</span>
                                                    </div>
                                                )}
                                            </div>
                                        </div>

                                        {/* Manual LPR Sync Selection */}
                                        <div className="space-y-3">
                                            <div className="flex items-center gap-2 text-[10px] font-bold text-muted-foreground uppercase tracking-widest border-b border-border pb-1">
                                                <Camera size={12} /> Sincronización Manual (Cámaras LPR)
                                            </div>
                                            <div className="grid grid-cols-1 gap-2">
                                                {devices.filter(d => d.deviceType === 'LPR_CAMERA').length > 0 ? (
                                                    devices.filter(d => d.deviceType === 'LPR_CAMERA').map(device => {
                                                        const isSelected = selectedDeviceIds.includes(device.id);
                                                        return (
                                                            <div
                                                                key={device.id}
                                                                onClick={() => setSelectedDeviceIds(prev =>
                                                                    isSelected ? prev.filter(id => id !== device.id) : [...prev, device.id]
                                                                )}
                                                                className={cn(
                                                                    "p-3 rounded-xl border flex items-center justify-between cursor-pointer transition-all",
                                                                    isSelected
                                                                        ? "bg-emerald-500/10 border-emerald-500/30 ring-1 ring-emerald-500/20"
                                                                        : "bg-card/40 border-border hover:border-border"
                                                                )}
                                                            >
                                                                <div className="flex items-center gap-3">
                                                                    <div className={cn(
                                                                        "p-2 rounded-lg",
                                                                        isSelected ? "bg-emerald-500/20 text-emerald-400" : "bg-muted text-muted-foreground"
                                                                    )}>
                                                                        {deviceSyncStatuses[device.id] === 'syncing' ? (
                                                                            <Loader2 size={14} className="animate-spin" />
                                                                        ) : deviceSyncStatuses[device.id] === 'error' ? (
                                                                            <AlertCircle size={14} className="text-red-500" />
                                                                        ) : deviceSyncStatuses[device.id] === 'success' ? (
                                                                            <CheckCircle2 size={14} className="text-emerald-500" />
                                                                        ) : (
                                                                            <Camera size={14} />
                                                                        )}
                                                                    </div>
                                                                    <div>
                                                                        <div className="flex items-center gap-2">
                                                                            <p className="text-[11px] font-bold text-foreground uppercase tracking-tight">{device.name}</p>
                                                                            {deviceSyncStatuses[device.id] === 'success' && (
                                                                                <span className="text-[7px] bg-emerald-500/10 text-emerald-500 px-1 py-0 rounded uppercase font-bold">OK</span>
                                                                            )}
                                                                            {deviceSyncStatuses[device.id] === 'error' && (
                                                                                <span className="text-[7px] bg-red-500/10 text-red-500 px-1 py-0 rounded uppercase font-bold">Error</span>
                                                                            )}
                                                                        </div>
                                                                        <p className="text-[10px] font-mono text-muted-foreground">{device.ip}</p>
                                                                    </div>
                                                                </div>
                                                                {isSelected && !deviceSyncStatuses[device.id] && <Check size={16} className="text-emerald-500" />}
                                                                {deviceSyncStatuses[device.id] === 'success' && <CheckCircle2 size={16} className="text-emerald-500" />}
                                                                {deviceSyncStatuses[device.id] === 'error' && <AlertCircle size={16} className="text-red-500" />}
                                                            </div>
                                                        );
                                                    })
                                                ) : (
                                                    <p className="text-[10px] text-muted-foreground italic p-2 text-center">No hay cámaras LPR registradas.</p>
                                                )}
                                            </div>
                                            {selectedDeviceIds.map(id => (
                                                <input key={id} type="hidden" name="syncDeviceId" value={id} />
                                            ))}
                                            {selectedDeviceIds.length > 0 && (
                                                <div className="p-2 bg-blue-500/5 border border-blue-500/10 rounded-lg">
                                                    <p className="text-[9px] text-blue-400 font-bold uppercase text-center tracking-widest">
                                                        La matrícula se enviará a {selectedDeviceIds.length} equipo(s) al guardar
                                                    </p>
                                                </div>
                                            )}

                                            {/* Manual Face Sync Selection (Only if Face available) */}
                                            {previewUrl && (
                                                <div className="space-y-3 pt-4">
                                                    <div className="flex items-center gap-2 text-[10px] font-bold text-muted-foreground uppercase tracking-widest border-b border-border pb-1">
                                                        <ScanFace size={12} /> Sincronización Biométrica (Terminales Faciales)
                                                    </div>
                                                    <div className="grid grid-cols-1 gap-2">
                                                        {devices.filter(d => d.deviceType === 'FACE_TERMINAL').length > 0 ? (
                                                            devices.filter(d => d.deviceType === 'FACE_TERMINAL').map(device => {
                                                                const isSelected = selectedFaceDeviceIds.includes(device.id);
                                                                return (
                                                                    <div
                                                                        key={device.id}
                                                                        onClick={() => setSelectedFaceDeviceIds(prev =>
                                                                            isSelected ? prev.filter(id => id !== device.id) : [...prev, device.id]
                                                                        )}
                                                                        className={cn(
                                                                            "p-3 rounded-xl border flex items-center justify-between cursor-pointer transition-all",
                                                                            isSelected
                                                                                ? "bg-purple-500/10 border-purple-500/30 ring-1 ring-purple-500/20"
                                                                                : "bg-card/40 border-border hover:border-border"
                                                                        )}
                                                                    >
                                                                        <div className="flex items-center gap-3">
                                                                            <div className={cn(
                                                                                "p-2 rounded-lg",
                                                                                isSelected ? "bg-purple-500/20 text-purple-400" : "bg-muted text-muted-foreground"
                                                                            )}>
                                                                                {deviceSyncStatuses[device.id] === 'syncing' ? (
                                                                                    <Loader2 size={14} className="animate-spin" />
                                                                                ) : deviceSyncStatuses[device.id] === 'error' ? (
                                                                                    <AlertCircle size={14} className="text-red-500" />
                                                                                ) : deviceSyncStatuses[device.id] === 'success' ? (
                                                                                    <CheckCircle2 size={14} className="text-emerald-500" />
                                                                                ) : (
                                                                                    <ScanFace size={14} />
                                                                                )}
                                                                            </div>
                                                                            <div>
                                                                                <div className="flex items-center gap-2">
                                                                                    <p className="text-[11px] font-bold text-foreground uppercase tracking-tight">{device.name}</p>
                                                                                    {deviceSyncStatuses[device.id] === 'success' && (
                                                                                        <span className="text-[7px] bg-emerald-500/10 text-emerald-500 px-1 py-0 rounded uppercase font-bold">OK</span>
                                                                                    )}
                                                                                    {deviceSyncStatuses[device.id] === 'error' && (
                                                                                        <span className="text-[7px] bg-red-500/10 text-red-500 px-1 py-0 rounded uppercase font-bold">Error</span>
                                                                                    )}
                                                                                </div>
                                                                                <p className="text-[10px] font-mono text-muted-foreground">{device.ip}</p>
                                                                            </div>
                                                                        </div>
                                                                        {isSelected && !deviceSyncStatuses[device.id] && <Check size={16} className="text-purple-500" />}
                                                                        {deviceSyncStatuses[device.id] === 'success' && <CheckCircle2 size={16} className="text-emerald-500" />}
                                                                        {deviceSyncStatuses[device.id] === 'error' && <AlertCircle size={16} className="text-red-500" />}
                                                                    </div>
                                                                );
                                                            })
                                                        ) : (
                                                            <p className="text-[10px] text-muted-foreground italic p-2 text-center">No hay terminales faciales registrados.</p>
                                                        )}
                                                    </div>
                                                    {selectedFaceDeviceIds.map(id => (
                                                        <input key={id} type="hidden" name="syncFaceDeviceId" value={id} />
                                                    ))}
                                                    {selectedFaceDeviceIds.length > 0 && (
                                                        <div className="p-2 bg-purple-500/5 border border-purple-500/10 rounded-lg">
                                                            <p className="text-[9px] text-purple-400 font-bold uppercase text-center tracking-widest">
                                                                El perfil facial se enviará a {selectedFaceDeviceIds.length} equipo(s)
                                                            </p>
                                                        </div>
                                                    )}
                                                </div>
                                            )}

                                            {syncStatus && (
                                                <div className="mt-4 p-4 bg-muted border border-emerald-500/20 rounded-xl space-y-3 animate-in zoom-in duration-300">
                                                    <div className="flex justify-between items-center">
                                                        <div className="flex items-center gap-2">
                                                            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                                                            <span className="text-[10px] font-bold text-foreground uppercase tracking-tight">Sincronizando matrícula...</span>
                                                        </div>
                                                        <span className="text-[10px] font-mono text-emerald-400">{Math.round((syncStatus.current / syncStatus.total) * 100)}%</span>
                                                    </div>
                                                    <Progress value={(syncStatus.current / syncStatus.total) * 100} indicatorClassName="bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]" />
                                                    <div className="flex items-center gap-2">
                                                        <Loader2 className="w-3 h-3 text-muted-foreground animate-spin" />
                                                        <p className="text-[9px] font-bold text-muted-foreground uppercase italic">
                                                            {syncStatus.current === syncStatus.total ? "Sincronización Finalizada" : `Enviando a: ${syncStatus.currentName}`}
                                                        </p>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </TabsContent>
                                </div>
                            </Tabs>

                            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border/50 bg-background/50">
                                <Button
                                    type="button"
                                    variant="ghost"
                                    onClick={() => onOpenChange(false)}
                                    className="h-10 px-6 rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted text-xs font-bold uppercase tracking-widest"
                                >
                                    <X size={16} className="mr-2" />
                                    Cancelar
                                </Button>
                                <Button
                                    type="submit"
                                    disabled={isSubmitting}
                                    className={cn(
                                        "h-10 px-6 rounded-xl font-bold text-xs uppercase tracking-widest shadow-lg transition-all",
                                        isEdit
                                            ? "bg-blue-600 hover:bg-blue-500"
                                            : "bg-emerald-600 hover:bg-emerald-500"
                                    )}
                                >
                                    <Save size={16} className="mr-2" />
                                    {isSubmitting ? "Procesando..." : (isEdit ? "Guardar Cambios" : "Registrar Usuario")}
                                </Button>
                            </div>
                        </form>
                    </div>

                    {/* Right Side: Photo Background Block */}
                    <div className="relative w-full md:flex-1 bg-muted overflow-hidden flex flex-col group">
                        {previewUrl ? (
                            <Image
                                src={previewUrl}
                                alt="User Face"
                                fill
                                unoptimized
                                className="object-cover transition-all duration-700 ease-out group-hover:scale-105 opacity-95 group-hover:opacity-100"
                            />
                        ) : (
                            <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground space-y-4 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-neutral-800/20 via-transparent to-transparent">
                                <div className="w-32 h-32 rounded-full border-4 border-dashed border-border flex items-center justify-center animate-spin-slow">
                                    <Camera size={48} className="opacity-20" />
                                </div>
                                <p className="text-[10px] uppercase tracking-[0.4em] font-bold opacity-30">Biometría (Cara)</p>
                            </div>
                        )}

                        {/* Scan Effect */}
                        <div className="absolute inset-0 bg-gradient-to-b from-blue-500/5 via-transparent to-blue-500/5 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />

                        {/* Overlay Gradient */}
                        <div className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-foreground/10 via-foreground/5 to-transparent pointer-events-none" />

                        <div className="absolute inset-0 p-10 flex flex-col justify-end items-center">
                            <Button
                                type="button"
                                onClick={() => fileInputRef.current?.click()}
                                className="bg-foreground text-background hover:bg-foreground/90 shadow-lg border-0 font-bold rounded-xl py-5 px-8 transform transition-all duration-200 hover:scale-105 active:scale-95 mb-6"
                            >
                                <Upload size={18} className="mr-2" />
                                {previewUrl ? "Cambiar Foto" : "Subir Foto"}
                            </Button>

                            <div className="flex items-center gap-2 px-4 py-2 bg-card/50 backdrop-blur-xl rounded-full border border-border">
                                <div className={cn("w-1.5 h-1.5 rounded-full", previewUrl ? "bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]" : "bg-red-500")} />
                                <span className="text-[10px] font-bold text-foreground/70 uppercase tracking-widest">
                                    {previewUrl ? "Identidad Verificada" : "Pendiente de Imagen"}
                                </span>
                            </div>
                        </div>

                        {/* Hidden File Input */}
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={handleFileChange}
                        />

                        {/* Top Decoration */}
                        <div className="absolute top-10 left-10 flex gap-1">
                            {[1, 2, 3].map(i => (
                                <div key={i} className="w-1.5 h-4 bg-blue-500/50 rounded-full" />
                            ))}
                        </div>
                    </div>

                </div>
            </DialogContent >
            <style jsx global>{`
                @keyframes spin-slow {
                    from { transform: rotate(0deg); }
                    to { transform: rotate(360deg); }
                }
                .animate-spin-slow {
                    animation: spin-slow 15s linear infinite;
                }
                .custom-scrollbar::-webkit-scrollbar {
                    width: 6px;
                }
                .custom-scrollbar::-webkit-scrollbar-track {
                    background: rgba(0, 0, 0, 0.2);
                }
                .custom-scrollbar::-webkit-scrollbar-thumb {
                    background: rgba(255, 255, 255, 0.1);
                    border-radius: 10px;
                }
                .custom-scrollbar::-webkit-scrollbar-thumb:hover {
                    background: rgba(255, 255, 255, 0.2);
                }
            `}</style>
        </Dialog >
    );
}
