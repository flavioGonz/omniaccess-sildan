"use client";

import { useState, useEffect, useMemo } from "react";
import { Unit, UnitType, User } from "@prisma/client";
import {
    Building2, Home, MapPin, LayoutGrid, Pencil, Trash2, Plus, Info, Server,
    Users, ChevronRight, Search, Video, ScanFace, MoreVertical, ArrowRight,
    Check, Layers, Phone, Hash, Monitor, ChevronLeft, Globe, UserCircle,
    Building, ExternalLink, Map as MapIcon, Navigation, LocateFixed, Mail,
    Contact, Clock, Activity, MapPin as MapPinIcon, X, Car, IdCard
} from "lucide-react";
import dynamic from 'next/dynamic';

const LocationPicker = dynamic(() => import('@/components/LocationPicker'), {
    ssr: false,
    loading: () => <div className="h-64 w-full bg-card animate-pulse rounded-xl" />
});

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getUnits, deleteUnit, createUnit, updateUnit, getUnitsWithDetails, bulkCreateSubUnits, getAvailableUsers, assignUserToUnit, unassignUserFromUnit } from "@/app/actions/units";
import { getUsers } from "@/app/actions/users";
import { cn } from "@/lib/utils";
import { DeleteConfirmDialog } from "@/components/DeleteConfirmDialog";
import Image from "next/image";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { sileo as toast } from "sileo";

interface ExtendedUser extends User {
    vehicles: { plate: string }[];
    credentials?: any[];
}

interface ExtendedUnit extends Unit {
    users: ExtendedUser[];
    children?: ExtendedUnit[];
}

export default function UnitsPage() {
    const [units, setUnits] = useState<ExtendedUnit[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedUnit, setSelectedUnit] = useState<ExtendedUnit | null>(null);
    const [searchTerm, setSearchTerm] = useState("");
    const [activeCategory, setActiveCategory] = useState<'all' | 'units' | 'complexes'>('units');
    const [mode, setMode] = useState<'list' | 'wizard'>('list');
    const [availableUsers, setAvailableUsers] = useState<any[]>([]);
    const [searchAvailable, setSearchAvailable] = useState("");
    const [showAssignDialog, setShowAssignDialog] = useState(false);
    const [editingUnit, setEditingUnit] = useState<ExtendedUnit | null>(null);
    const [showEditDialog, setShowEditDialog] = useState(false);
    const [activeEditTab, setActiveEditTab] = useState<'general' | 'contact' | 'location' | 'map' | 'units' | 'residents' | 'vehicles'>('general');
    const [editingSubUnit, setEditingSubUnit] = useState<ExtendedUnit | null>(null);
    const [showBulkDialog, setShowBulkDialog] = useState(false);
    const [bulkPattern, setBulkPattern] = useState("A-Z, 13");

    // Form State
    const [formData, setFormData] = useState({
        name: "",
        type: "BARRIO" as UnitType,
        floors: "",
        lot: "",
        houseNumber: "",
        address: "",
        adminPhone: "",
        contactName: "",
        contactEmail: "",
        deviceCount: "2",
        deviceType: "BOTH",
        coordinates: "-34.6037, -58.3816",
        parentId: ""
    });

    const [step, setStep] = useState(1);

    const loadUnits = async () => {
        setLoading(true);
        try {
            const data = await getUnitsWithDetails();
            setUnits(data as ExtendedUnit[]);
            if (data.length > 0) {
                if (selectedUnit) {
                    const updated = data.find(u => u.id === selectedUnit.id);
                    if (updated) setSelectedUnit(updated as ExtendedUnit);
                } else {
                    setSelectedUnit(data[0] as ExtendedUnit);
                }
            }
        } finally {
            setLoading(false);
        }
    };

    const loadAvailableUsers = async () => {
        const u = await getAvailableUsers();
        setAvailableUsers(u);
    };

    useEffect(() => {
        loadUnits();
        loadAvailableUsers();
    }, []);

    const handleCreateNew = (parentId?: string) => {
        setEditingUnit(null);
        setFormData({
            name: "",
            type: parentId ? "CASA" : "BARRIO",
            floors: "",
            lot: "",
            houseNumber: "",
            address: "",
            adminPhone: "",
            contactName: "",
            contactEmail: "",
            deviceCount: "2",
            deviceType: "BOTH",
            coordinates: "-34.6037, -58.3816",
            parentId: parentId || ""
        });
        setStep(1);
        setMode('wizard');
    };

    const handleEdit = (unit: ExtendedUnit) => {
        setEditingUnit(unit);
        setFormData({
            name: unit.name,
            type: unit.type,
            floors: unit.floors?.toString() || "",
            lot: unit.lot || "",
            houseNumber: unit.houseNumber || "",
            address: unit.address || "",
            adminPhone: unit.adminPhone || "",
            contactName: unit.contactName || "",
            contactEmail: unit.contactEmail || "",
            deviceCount: unit.deviceCount?.toString() || "2",
            deviceType: unit.deviceType || "BOTH",
            coordinates: unit.coordinates || "-34.6037, -58.3816",
            parentId: unit.parentId || ""
        });
        setActiveEditTab('general');
        setShowEditDialog(true);
    };

    const handleSave = async () => {
        const payload = new FormData();
        Object.entries(formData).forEach(([key, value]) => {
            payload.append(key, value);
        });

        try {
            if (editingUnit) {
                await updateUnit(editingUnit.id, payload);
                toast.success({ title: "Propiedad actualizada" });
            } else {
                await createUnit(payload);
                toast.success({ title: "Propiedad creada" });
            }
            setShowEditDialog(false);
            setMode('list');
            loadUnits();
        } catch (e) {
            toast.error({ title: "Error al guardar" });
        }
    };

    const handleBulkCreate = async () => {
        if (!editingUnit) return;
        try {
            await bulkCreateSubUnits(editingUnit.id, bulkPattern);
            toast.success({ title: "Generación masiva completada" });
            setShowBulkDialog(false);
            loadUnits();
        } catch (e) {
            toast.error({ title: "Error en la generación masiva" });
        }
    };

    const filteredUnits = units.filter(u => {
        const matchesSearch =
            u.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
            u.lot?.toLowerCase().includes(searchTerm.toLowerCase()) ||
            u.houseNumber?.toLowerCase().includes(searchTerm.toLowerCase()) ||
            u.contactName?.toLowerCase().includes(searchTerm.toLowerCase());

        if (!matchesSearch) return false;

        if (activeCategory === 'units') {
            return u.parentId !== null || u.type === 'CASA';
        }
        if (activeCategory === 'complexes') {
            return u.parentId === null && (u.type === 'BARRIO' || u.type === 'EDIFICIO');
        }
        return true;
    });

    const displayedResidents = useMemo(() => {
        if (!selectedUnit) return [];
        const res = [...selectedUnit.users];
        if (selectedUnit.type === 'BARRIO' && selectedUnit.children) {
            selectedUnit.children.forEach(child => {
                res.push(...(child.users || []));
            });
        }
        return res;
    }, [selectedUnit]);

    if (mode === 'wizard') {
        return (
            <div className="max-w-4xl mx-auto py-10 space-y-8 animate-in zoom-in-95 duration-500 pb-20">
                <div className="flex items-center justify-between mb-8">
                    <Button variant="ghost" onClick={() => setMode('list')} className="text-muted-foreground hover:text-foreground">
                        <ChevronLeft className="mr-2" /> Cancelar
                    </Button>
                    <div className="flex items-center gap-2">
                        {[1, 2, 3, 4].map((s) => (
                            <div key={s} className={cn("h-1.5 w-12 rounded-full transition-all duration-500", step >= s ? "bg-blue-600" : "bg-muted")} />
                        ))}
                    </div>
                    <span className="text-xs font-bold text-muted-foreground uppercase tracking-widest">PASO {step} DE 4</span>
                </div>

                {step === 1 && (
                    <div className="space-y-6">
                        <div className="text-center space-y-1">
                            <h2 className="text-2xl font-bold text-foreground uppercase tracking-tight">Tipo de Propiedad</h2>
                            <p className="text-xs text-muted-foreground">Define la categoría de la unidad.</p>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            {[
                                { id: "BARRIO", icon: MapPin, label: "Barrio / Lote", desc: "Parcelas y barrios cerrados." },
                                { id: "EDIFICIO", icon: Building2, label: "Edificio", desc: "Torres y complejos verticales." },
                                { id: "CASA", icon: Home, label: "Individual", desc: "Viviendas independientes." }
                            ].map((type) => (
                                <Card
                                    key={type.id}
                                    onClick={() => setFormData({ ...formData, type: type.id as UnitType })}
                                    className={cn(
                                        "bg-card/50 border-border cursor-pointer transition-all hover:border-blue-500/30 group relative",
                                        formData.type === type.id ? "ring-1 ring-blue-500 border-transparent" : ""
                                    )}
                                >
                                    <CardContent className="p-6 flex flex-col items-center text-center space-y-3">
                                        <div className={cn(
                                            "p-3 rounded-xl transition-all duration-300",
                                            formData.type === type.id ? "bg-blue-600 text-foreground shadow-lg" : "bg-muted text-muted-foreground"
                                        )}>
                                            <type.icon size={24} />
                                        </div>
                                        <div>
                                            <h3 className="text-xs font-bold text-foreground uppercase tracking-wider">{type.label}</h3>
                                            <p className="text-[9px] text-muted-foreground mt-1 uppercase tracking-widest">{type.desc}</p>
                                        </div>
                                    </CardContent>
                                </Card>
                            ))}
                        </div>
                    </div>
                )}

                {step === 2 && (
                    <div className="space-y-6 animate-in slide-in-from-right-4 duration-500">
                        <div className="text-center space-y-1">
                            <h2 className="text-2xl font-bold text-foreground uppercase tracking-tight">Detalles del Lugar</h2>
                            <p className="text-xs text-muted-foreground">Información básica de identificación.</p>
                        </div>
                        <div className="bg-card/30 border border-border p-6 rounded-lg space-y-6">
                            <div className="grid grid-cols-2 gap-6">
                                <div className="space-y-2 col-span-2">
                                    <Label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Nombre Completo</Label>
                                    <Input
                                        value={formData.name}
                                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                        placeholder="Ej: Loteo Los Alerces"
                                        className="bg-card border-border h-10 rounded-lg text-sm font-semibold uppercase"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Identificador Lote</Label>
                                    <Input
                                        value={formData.lot}
                                        onChange={(e) => setFormData({ ...formData, lot: e.target.value })}
                                        placeholder="Ej: A-45"
                                        className="bg-card border-border h-10 rounded-lg text-blue-500 font-bold"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Nº Casa / Puerta</Label>
                                    <Input
                                        value={formData.houseNumber}
                                        onChange={(e) => setFormData({ ...formData, houseNumber: e.target.value })}
                                        placeholder="Ej: 154"
                                        className="bg-card border-border h-10 rounded-lg"
                                    />
                                </div>
                                {formData.type === 'EDIFICIO' && (
                                    <div className="space-y-2 col-span-2">
                                        <Label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Cantidad de Pisos</Label>
                                        <Input
                                            type="number"
                                            value={formData.floors}
                                            onChange={(e) => setFormData({ ...formData, floors: e.target.value })}
                                            className="bg-card border-border h-10 rounded-lg"
                                        />
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                )}

                {step === 3 && (
                    <div className="space-y-6 animate-in slide-in-from-right-4 duration-500">
                        <div className="text-center space-y-1">
                            <h2 className="text-2xl font-bold text-foreground uppercase tracking-tight">Contacto</h2>
                            <p className="text-xs text-muted-foreground">Información del propietario o administración.</p>
                        </div>
                        <div className="bg-card/30 border border-border p-6 rounded-lg space-y-6">
                            <div className="grid grid-cols-2 gap-6">
                                <div className="space-y-2 col-span-2">
                                    <Label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Persona de Contacto</Label>
                                    <Input
                                        value={formData.contactName}
                                        onChange={(e) => setFormData({ ...formData, contactName: e.target.value })}
                                        placeholder="Nombre completo"
                                        className="bg-card border-border h-10 rounded-lg text-sm"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Teléfono / WhatsApp</Label>
                                    <Input
                                        value={formData.adminPhone}
                                        onChange={(e) => setFormData({ ...formData, adminPhone: e.target.value })}
                                        placeholder="+54 9 ..."
                                        className="bg-card border-border h-10 rounded-lg text-sm"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Email</Label>
                                    <Input
                                        value={formData.contactEmail}
                                        onChange={(e) => setFormData({ ...formData, contactEmail: e.target.value })}
                                        placeholder="email@ejemplo.com"
                                        className="bg-card border-border h-10 rounded-lg text-sm"
                                    />
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {step === 4 && (
                    <div className="space-y-6 animate-in slide-in-from-right-4 duration-500">
                        <div className="text-center space-y-1">
                            <h2 className="text-2xl font-bold text-foreground uppercase tracking-tight">Localización</h2>
                            <p className="text-xs text-muted-foreground">Coordenadas y dirección física.</p>
                        </div>
                        <div className="bg-card/30 border border-border p-6 rounded-lg space-y-4">
                            <LocationPicker
                                coords={formData.coordinates}
                                onChange={(val) => setFormData({ ...formData, coordinates: val })}
                            />
                            <div className="space-y-2">
                                <Label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Dirección Escrita</Label>
                                <Input
                                    value={formData.address}
                                    onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                                    placeholder="Calle, Ciudad, Provincia"
                                    className="bg-card border-border h-10 rounded-lg text-sm"
                                />
                            </div>
                        </div>
                    </div>
                )}

                {/* Navigation Bar */}
                <div className="fixed bottom-0 left-0 right-0 bg-background/50 backdrop-blur-xl border-t border-border p-4 z-50">
                    <div className="max-w-4xl mx-auto flex justify-between items-center">
                        <Button
                            variant="ghost"
                            disabled={step === 1}
                            onClick={() => setStep(step - 1)}
                            className="h-10 px-6 rounded-lg font-bold text-[10px] uppercase tracking-widest text-muted-foreground"
                        >
                            <ChevronLeft className="mr-2" size={14} /> Volver
                        </Button>
                        <div className="flex gap-3">
                            {step < 4 ? (
                                <Button
                                    onClick={() => setStep(step + 1)}
                                    className="h-10 px-8 rounded-lg bg-blue-600 hover:bg-blue-500 text-foreground font-bold text-[10px] uppercase tracking-widest"
                                >
                                    Siguiente <ChevronRight className="ml-2" size={14} />
                                </Button>
                            ) : (
                                <Button
                                    onClick={handleSave}
                                    className="h-10 px-8 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-foreground font-bold text-[10px] uppercase tracking-widest"
                                >
                                    Guardar Propiedad <Check className="ml-2" size={14} />
                                </Button>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="h-full flex flex-col bg-background animate-in fade-in duration-700 overflow-hidden">
            {/* Horizontal Header Menu */}
            <header className="px-8 py-6 border-b border-border bg-card/40 backdrop-blur-md flex items-center justify-between shrink-0">
                <div className="flex items-center gap-8">
                    <div>
                        <h1 className="text-2xl font-bold text-foreground">Unidades</h1>
                        <p className="text-sm text-muted-foreground mt-1">Catastro y Gestión de Propiedades</p>
                    </div>

                    <div className="h-10 w-px bg-foreground/10 mx-2 hidden md:block" />

                    <div className="relative group w-80 hidden md:block">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground group-focus-within:text-blue-500 transition-colors" size={14} />
                        <input
                            type="text"
                            placeholder="Buscar propiedad, lote o contacto..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full h-10 pl-11 pr-4 bg-foreground/[0.04] border border-border rounded-xl text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-blue-500/50 focus:bg-foreground/[0.04] transition-all"
                        />
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    <div className="flex items-center bg-card border border-border p-1 rounded-xl gap-1">
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setActiveCategory("all")}
                            className={cn("h-8 text-[9px] font-bold uppercase tracking-widest rounded-lg", activeCategory === "all" ? "bg-foreground/10 text-foreground" : "text-muted-foreground hover:text-muted-foreground")}
                        >
                            Ver Todo
                        </Button>
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setActiveCategory("units")}
                            className={cn("h-8 text-[9px] font-bold uppercase tracking-widest rounded-lg", activeCategory === "units" ? "bg-blue-600 text-foreground" : "text-muted-foreground")}
                        >
                            Lotes y Pisos
                        </Button>
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setActiveCategory("complexes")}
                            className={cn("h-8 text-[9px] font-bold uppercase tracking-widest rounded-lg", activeCategory === "complexes" ? "bg-blue-600 text-foreground" : "text-muted-foreground")}
                        >
                            Barrios/Edificios
                        </Button>
                    </div>

                    <Button onClick={() => handleCreateNew()} size="sm" className="h-10 px-6 rounded-xl bg-blue-600 hover:bg-blue-500 shadow-lg shadow-blue-600/20 font-bold text-[10px] uppercase tracking-widest">
                        <Plus className="mr-2" size={16} /> Nueva Propiedad
                    </Button>
                </div>
            </header>

            {/* Central Table Content */}
            <main className="flex-1 overflow-hidden p-8 flex flex-col gap-6">
                <div className="bg-card/40 border border-border rounded-lg flex-1 flex flex-col overflow-hidden shadow-lg">
                    <div className="flex-1 overflow-auto custom-scrollbar">
                        <Table>
                            <TableHeader className="bg-card border-b border-border sticky top-0 z-10 backdrop-blur-sm">
                                <TableRow className="hover:bg-transparent border-none">
                                    <TableHead className="text-[11px] uppercase tracking-wide font-semibold text-muted-foreground py-6 pl-8">Unidad / Identificador</TableHead>
                                    <TableHead className="text-[11px] uppercase tracking-wide font-semibold text-muted-foreground">Ubicación / Complejo</TableHead>
                                    <TableHead className="text-[11px] uppercase tracking-wide font-semibold text-muted-foreground">Estado</TableHead>
                                    <TableHead className="text-[11px] uppercase tracking-wide font-semibold text-muted-foreground">Residentes / Matrículas</TableHead>
                                    <TableHead className="text-[11px] uppercase tracking-wide font-semibold text-muted-foreground">Contacto Admin</TableHead>
                                    <TableHead className="w-[100px] text-[11px] uppercase tracking-wide font-semibold text-muted-foreground text-right pr-8">Acciones</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {filteredUnits.map((unit) => (
                                    <TableRow
                                        key={unit.id}
                                        className={cn(
                                            "border-b border-border hover:bg-accent transition-colors group cursor-pointer",
                                            selectedUnit?.id === unit.id && "bg-blue-500/5"
                                        )}
                                        onClick={() => setSelectedUnit(unit)}
                                    >
                                        <TableCell className="py-3 pl-6">
                                            <div className="flex items-center gap-3">
                                                <div className={cn(
                                                    "w-8 h-8 rounded-lg flex items-center justify-center shrink-0 border border-border",
                                                    (unit.lot || unit.houseNumber) ? "bg-blue-500/10 text-blue-500" : "bg-muted text-muted-foreground"
                                                )}>
                                                    {(unit.lot || unit.houseNumber) ? <Home size={15} /> : (unit.type === 'BARRIO' ? <MapPin size={15} /> : <Building2 size={15} />)}
                                                </div>
                                                <div className="min-w-0">
                                                    <div className="flex items-center gap-2">
                                                        <p className="font-semibold text-foreground text-sm truncate">{unit.name}</p>
                                                        {unit.parentId && <Badge variant="outline" className="border-blue-500/40 text-blue-500 text-[9px] h-4 px-1.5">Sub</Badge>}
                                                    </div>
                                                    <p className="text-[11px] text-muted-foreground truncate">
                                                        {unit.lot ? `Lote ${unit.lot}` : ""}{unit.houseNumber ? ` · N° ${unit.houseNumber}` : ""}
                                                    </p>
                                                </div>
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            {unit.parentId ? (
                                                <span className="text-xs text-muted-foreground">{units.find(u => u.id === unit.parentId)?.name}</span>
                                            ) : (
                                                <span className="text-xs font-medium text-blue-500">Principal / {unit.type}</span>
                                            )}
                                        </TableCell>
                                        <TableCell>
                                            <div className="flex items-center gap-2">
                                                <Badge className={cn(
                                                    "border-none text-[10px] px-2 py-0.5 font-semibold",
                                                    unit.users.length > 0 ? "bg-emerald-500/10 text-emerald-500" : "bg-muted text-muted-foreground"
                                                )}>
                                                    {unit.users.length > 0 ? 'Ocupado' : 'Vacante'}
                                                </Badge>
                                                <span className="text-[11px] text-muted-foreground">{unit.users.length} pers.</span>
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            {unit.users.length > 0 ? (
                                                <div className="flex flex-col gap-0.5">
                                                    {unit.users.slice(0, 2).map((user) => (
                                                        <div key={user.id} className="flex items-center gap-2">
                                                            <span className="text-xs text-foreground truncate max-w-[130px]">{user.name}</span>
                                                            {user.vehicles?.map((v, vidx) => (
                                                                <span key={vidx} className="text-[10px] font-mono text-blue-500 bg-blue-500/10 px-1 rounded">{v.plate}</span>
                                                            ))}
                                                        </div>
                                                    ))}
                                                    {unit.users.length > 2 && <span className="text-[11px] text-muted-foreground">y {unit.users.length - 2} más…</span>}
                                                </div>
                                            ) : (
                                                <span className="text-xs text-muted-foreground italic">{unit.contactName || "Sin residentes"}</span>
                                            )}
                                        </TableCell>
                                        <TableCell>
                                            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                                {unit.adminPhone && <Phone size={12} />}{unit.adminPhone || "S/D"}
                                            </div>
                                        </TableCell>
                                        <TableCell className="text-right pr-6">
                                            <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                                <Button onClick={(e) => { e.stopPropagation(); handleEdit(unit); }} variant="ghost" size="icon" className="h-8 w-8 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent"><Pencil size={14} /></Button>
                                                <div onClick={(e) => e.stopPropagation()}>
                                                    <DeleteConfirmDialog id={unit.id} title={unit.name} onDelete={deleteUnit} onSuccess={loadUnits}>
                                                        <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg text-red-500/60 hover:text-red-500 hover:bg-red-500/10"><Trash2 size={14} /></Button>
                                                    </DeleteConfirmDialog>
                                                </div>
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                ))}
                                {filteredUnits.length === 0 && (
                                    <TableRow>
                                        <TableCell colSpan={6} className="py-16 text-center text-muted-foreground">
                                            <Building2 size={32} className="mx-auto mb-3 opacity-30" />
                                            <p className="text-sm">No se encontraron unidades</p>
                                        </TableCell>
                                    </TableRow>
                                )}
                            </TableBody>
                        </Table>
                    </div>

                    {/* Bottom Detail Summary (Conditionally shown if something selected) */}
                    {selectedUnit && (
                        <div className="h-24 bg-card border-t border-border px-8 flex items-center justify-between animate-in slide-in-from-bottom-4 duration-500">
                            <div className="flex items-center gap-6">
                                <div className="space-y-1">
                                    <span className="text-[8px] font-bold text-muted-foreground uppercase tracking-widest">Unidad Seleccionada</span>
                                    <div className="flex items-center gap-3">
                                        <h3 className="text-xl font-bold text-foreground uppercase tracking-tighter">{selectedUnit.name}</h3>
                                        <Badge className="bg-blue-600 text-foreground border-none text-[8px] font-bold uppercase">{selectedUnit.type}</Badge>
                                    </div>
                                </div>
                                <div className="h-8 w-px bg-foreground/10" />
                                <div className="flex items-center gap-8">
                                    <div className="space-y-1">
                                        <span className="text-[8px] font-bold text-muted-foreground uppercase tracking-widest">Ubicación</span>
                                        <p className="text-[10px] font-bold text-muted-foreground uppercase">{selectedUnit.address || "S/D"}</p>
                                    </div>
                                    <div className="space-y-1">
                                        <span className="text-[8px] font-bold text-muted-foreground uppercase tracking-widest">Habitantes</span>
                                        <div className="flex -space-x-2">
                                            {selectedUnit.users.slice(0, 5).map((u, i) => (
                                                <div key={i} className="w-6 h-6 rounded-full border border-black bg-muted flex items-center justify-center overflow-hidden ring-1 ring-border">
                                                    {u.cara ? <Image src={u.cara} alt="" width={24} height={24} className="object-cover" /> : <UserCircle size={14} className="text-muted-foreground" />}
                                                </div>
                                            ))}
                                            {selectedUnit.users.length > 5 && (
                                                <div className="w-6 h-6 rounded-full border border-black bg-card border-border flex items-center justify-center text-[8px] font-bold text-muted-foreground">
                                                    +{selectedUnit.users.length - 5}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                    {(selectedUnit.type === 'BARRIO' || selectedUnit.type === 'EDIFICIO') && (
                                        <div className="space-y-1">
                                            <span className="text-[8px] font-bold text-muted-foreground uppercase tracking-widest">Contenido</span>
                                            <p className="text-[10px] font-bold text-blue-500 uppercase">{selectedUnit.children?.length || 0} Sub-unidades</p>
                                        </div>
                                    )}
                                    {selectedUnit.users.some(u => u.vehicles?.length > 0) && (
                                        <div className="space-y-1">
                                            <span className="text-[8px] font-bold text-muted-foreground uppercase tracking-widest">Matrículas Activas</span>
                                            <div className="flex gap-1.5">
                                                {selectedUnit.users.flatMap(u => u.vehicles || []).slice(0, 4).map((v, idx) => (
                                                    <Badge key={idx} className="bg-muted text-blue-400 border-border text-[8px] font-mono h-4 font-bold">{v.plate}</Badge>
                                                ))}
                                                {selectedUnit.users.flatMap(u => u.vehicles || []).length > 4 && (
                                                    <span className="text-[8px] text-muted-foreground font-bold">+{selectedUnit.users.flatMap(u => u.vehicles || []).length - 4}</span>
                                                )}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>

                            <div className="flex items-center gap-3">
                                <Button onClick={() => handleEdit(selectedUnit)} variant="outline" className="h-9 px-5 bg-foreground/10 border-border rounded-xl font-bold text-[9px] uppercase tracking-widest">
                                    <Pencil className="mr-2" size={14} /> Editar Propiedad
                                </Button>
                                <Button
                                    onClick={() => setSelectedUnit(null)}
                                    variant="ghost"
                                    size="icon"
                                    className="h-9 w-9 text-muted-foreground hover:text-foreground"
                                >
                                    <X size={18} />
                                </Button>
                            </div>
                        </div>
                    )}
                </div>
            </main>

            {/* Edit Dialog - Professional & Clean */}
            <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
                <DialogContent className="bg-background border border-border text-foreground max-w-6xl p-0 overflow-hidden outline-none rounded-lg shadow-lg">
                    <DialogHeader className="sr-only">
                        <DialogTitle>Editar Propiedad</DialogTitle>
                    </DialogHeader>

                    {/* Clean Professional Header */}
                    <div className="border-b border-border bg-card/50">
                        <div className="px-6 py-4 flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className="w-9 h-9 rounded-lg bg-blue-600/10 border border-blue-500/20 flex items-center justify-center">
                                    <Building2 className="text-blue-500" size={18} />
                                </div>
                                <div>
                                    <h3 className="text-sm font-bold text-foreground uppercase tracking-wide">Configuración de Unidad</h3>
                                    <p className="text-[10px] text-muted-foreground font-medium">{editingUnit?.name || 'Nueva Unidad'}</p>
                                </div>
                            </div>
                            <button
                                onClick={() => setShowEditDialog(false)}
                                className="w-8 h-8 rounded-md bg-foreground/10 hover:bg-red-500/10 border border-border hover:border-red-500/30 flex items-center justify-center transition-colors"
                            >
                                <X className="text-muted-foreground hover:text-red-400" size={16} />
                            </button>
                        </div>
                    </div>

                    <div className="flex h-[600px]">
                        {/* Compact Sidebar */}
                        <div className="w-48 bg-card/30 border-r border-border p-4 flex flex-col gap-1">
                            {[
                                { id: 'general', icon: Info, label: 'General' },
                                { id: 'location', icon: MapPinIcon, label: 'Ubicación' },
                                ...(editingUnit?.type === 'BARRIO' || editingUnit?.type === 'EDIFICIO' ? [{ id: 'units', icon: LayoutGrid, label: 'Unidades' }] : []),
                                { id: 'residents', icon: Users, label: 'Residentes' },
                                { id: 'vehicles', icon: Car, label: 'Vehículos' },
                            ].map((tab) => (
                                <button
                                    key={tab.id}
                                    onClick={() => setActiveEditTab(tab.id as any)}
                                    className={cn(
                                        "flex items-center gap-2.5 px-3 py-2 rounded-md transition-all text-[11px] font-semibold uppercase tracking-wide",
                                        activeEditTab === tab.id
                                            ? "bg-blue-600 text-foreground"
                                            : "text-muted-foreground hover:text-foreground hover:bg-accent"
                                    )}
                                >
                                    <tab.icon size={14} />
                                    {tab.label}
                                </button>
                            ))}
                        </div>

                        {/* Content Area */}
                        <div className={cn(
                            "flex-1 flex flex-col",
                            activeEditTab === 'location' ? "" : "bg-muted/40"
                        )}>
                            <div className={cn(
                                "flex-1",
                                activeEditTab === 'location' ? "relative" : "overflow-y-auto p-6 custom-scrollbar"
                            )}>
                                {activeEditTab === 'general' && (
                                    <div className="space-y-5 animate-in fade-in duration-300">
                                        <div className="mb-4">
                                            <h4 className="text-xs font-bold text-foreground uppercase tracking-wider mb-1">Información General</h4>
                                            <p className="text-[10px] text-muted-foreground">Datos básicos de identificación</p>
                                        </div>

                                        <div className="grid grid-cols-3 gap-4">
                                            <div className="col-span-3 space-y-1.5">
                                                <Label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Nombre de la Unidad</Label>
                                                <div className="relative">
                                                    <Building className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={14} />
                                                    <Input
                                                        value={formData.name}
                                                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                                        className="bg-card border-border hover:border-blue-500/30 focus:border-blue-500 h-9 rounded-md text-sm font-medium pl-9 transition-colors"
                                                        placeholder="Ej: Barrio Los Álamos"
                                                    />
                                                </div>
                                            </div>

                                            <div className="space-y-1.5">
                                                <Label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Lote / Parcela</Label>
                                                <div className="relative">
                                                    <Hash className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={14} />
                                                    <Input
                                                        value={formData.lot}
                                                        onChange={(e) => setFormData({ ...formData, lot: e.target.value })}
                                                        className="bg-card border-border hover:border-blue-500/30 focus:border-blue-500 h-9 rounded-md text-sm font-semibold pl-9 text-blue-400 transition-colors"
                                                        placeholder="A-45"
                                                    />
                                                </div>
                                            </div>

                                            <div className="space-y-1.5">
                                                <Label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Nº Casa / Puerta</Label>
                                                <div className="relative">
                                                    <Home className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={14} />
                                                    <Input
                                                        value={formData.houseNumber}
                                                        onChange={(e) => setFormData({ ...formData, houseNumber: e.target.value })}
                                                        className="bg-card border-border hover:border-blue-500/30 focus:border-blue-500 h-9 rounded-md text-sm font-medium pl-9 transition-colors"
                                                        placeholder="154"
                                                    />
                                                </div>
                                            </div>

                                            {formData.type === 'EDIFICIO' && (
                                                <div className="space-y-1.5">
                                                    <Label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Pisos</Label>
                                                    <div className="relative">
                                                        <Layers className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={14} />
                                                        <Input
                                                            type="number"
                                                            value={formData.floors}
                                                            onChange={(e) => setFormData({ ...formData, floors: e.target.value })}
                                                            className="bg-card border-border hover:border-blue-500/30 focus:border-blue-500 h-9 rounded-md text-sm font-medium pl-9 transition-colors"
                                                            placeholder="10"
                                                        />
                                                    </div>
                                                </div>
                                            )}
                                        </div>

                                        <div className="pt-4 border-t border-border">
                                            <h4 className="text-xs font-bold text-foreground uppercase tracking-wider mb-3">Contacto</h4>
                                            <div className="grid grid-cols-2 gap-4">
                                                <div className="space-y-1.5">
                                                    <Label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Persona de Contacto</Label>
                                                    <div className="relative">
                                                        <UserCircle className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={14} />
                                                        <Input
                                                            value={formData.contactName}
                                                            onChange={(e) => setFormData({ ...formData, contactName: e.target.value })}
                                                            className="bg-card border-border hover:border-blue-500/30 focus:border-blue-500 h-9 rounded-md text-sm pl-9 transition-colors"
                                                            placeholder="Nombre completo"
                                                        />
                                                    </div>
                                                </div>

                                                <div className="space-y-1.5">
                                                    <Label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Teléfono</Label>
                                                    <div className="relative">
                                                        <Phone className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={14} />
                                                        <Input
                                                            value={formData.adminPhone}
                                                            onChange={(e) => setFormData({ ...formData, adminPhone: e.target.value })}
                                                            className="bg-card border-border hover:border-blue-500/30 focus:border-blue-500 h-9 rounded-md text-sm pl-9 transition-colors"
                                                            placeholder="+54 9 ..."
                                                        />
                                                    </div>
                                                </div>

                                                <div className="col-span-2 space-y-1.5">
                                                    <Label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Email</Label>
                                                    <div className="relative">
                                                        <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={14} />
                                                        <Input
                                                            value={formData.contactEmail}
                                                            onChange={(e) => setFormData({ ...formData, contactEmail: e.target.value })}
                                                            className="bg-card border-border hover:border-blue-500/30 focus:border-blue-500 h-9 rounded-md text-sm pl-9 transition-colors"
                                                            placeholder="email@ejemplo.com"
                                                        />
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {activeEditTab === 'location' && (
                                    <>
                                        {/* Input flotante sobre el mapa - SIN bordes redondeados */}
                                        <div className="absolute top-0 left-0 right-0 z-10 bg-gradient-to-b from-black/80 via-black/50 to-transparent p-4 pb-8">
                                            <div className="relative">
                                                <MapPinIcon className="absolute left-3 top-1/2 -translate-y-1/2 text-blue-400" size={16} />
                                                <Input
                                                    value={formData.address}
                                                    onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                                                    placeholder="Dirección completa de la propiedad..."
                                                    className="bg-muted backdrop-blur-md border-border hover:border-blue-500/50 focus:border-blue-500 h-11 text-sm pl-10 shadow-lg transition-all font-medium"
                                                />
                                            </div>
                                        </div>

                                        {/* Mapa ocupando TODO el espacio - de arriba abajo */}
                                        <div className="absolute inset-0 w-full h-full">
                                            <LocationPicker
                                                coords={formData.coordinates}
                                                onChange={(val) => setFormData({ ...formData, coordinates: val })}
                                                fullScreen={true}
                                            />
                                        </div>
                                    </>
                                )}

                                {activeEditTab === 'residents' && (
                                    <div className="space-y-4 animate-in fade-in duration-300">
                                        <div className="flex items-center justify-between mb-3">
                                            <div>
                                                <h4 className="text-xs font-bold text-foreground uppercase tracking-wider mb-1">Residentes Vinculados</h4>
                                                <p className="text-[10px] text-muted-foreground">Habitantes de esta propiedad</p>
                                            </div>
                                            <Badge className="bg-blue-600/20 text-blue-400 border border-blue-500/30 text-[10px] font-bold px-2.5 py-0.5">
                                                {editingUnit?.users?.length || 0} Personas
                                            </Badge>
                                        </div>

                                        <div className="grid grid-cols-1 gap-2">
                                            {editingUnit?.users?.map(user => (
                                                <div key={user.id} className="bg-card/40 hover:bg-card/60 p-3 rounded-md flex items-center justify-between border border-border hover:border-blue-500/30 transition-colors group">
                                                    <div className="flex items-center gap-3">
                                                        <div className="w-9 h-9 rounded-md bg-foreground/10 flex items-center justify-center relative overflow-hidden border border-border">
                                                            {user.cara ? <Image src={user.cara} alt="" fill className="object-cover" /> : <UserCircle size={18} className="text-muted-foreground" />}
                                                        </div>
                                                        <div className="flex flex-col">
                                                            <div className="flex items-center gap-2">
                                                                <p className="font-semibold text-foreground text-xs">{user.name}</p>
                                                                <div className="flex items-center gap-1">
                                                                    {(user as any).credentials?.some((c: any) => c.type === 'FACE') && <ScanFace size={10} className="text-emerald-500" />}
                                                                    {(user as any).credentials?.some((c: any) => c.type === 'PLATE') && <Car size={10} className="text-blue-500" />}
                                                                    {(user as any).credentials?.some((c: any) => c.type === 'TAG') && <IdCard size={10} className="text-amber-500" />}
                                                                    {(user as any).credentials?.some((c: any) => c.type === 'PIN') && <Hash size={10} className="text-purple-500" />}
                                                                </div>
                                                            </div>
                                                            <div className="flex items-center gap-2 mt-0.5">
                                                                <span className="text-[9px] text-muted-foreground uppercase font-medium">{user.role}</span>
                                                                {user.vehicles?.length > 0 && (
                                                                    <div className="flex items-center gap-1 border-l border-border pl-2">
                                                                        {user.vehicles.map((v: any, vidx: number) => (
                                                                            <span key={vidx} className="text-[9px] font-mono font-semibold text-blue-400 bg-blue-500/10 px-1.5 py-0.5 rounded">{v.plate}</span>
                                                                        ))}
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </div>
                                                    </div>
                                                    <div className="flex items-center gap-1">
                                                        <Button
                                                            onClick={() => window.open(`/admin/users?q=${encodeURIComponent(user.name)}`, '_blank')}
                                                            variant="ghost"
                                                            size="icon"
                                                            className="h-7 w-7 text-muted-foreground hover:text-blue-400 hover:bg-blue-500/10 rounded-md transition-colors"
                                                            title="Ver Perfil"
                                                        >
                                                            <ExternalLink size={13} />
                                                        </Button>
                                                        <Button
                                                            onClick={async () => {
                                                                await unassignUserFromUnit(user.id);
                                                                toast.success({ title: `${user.name} desvinculado` });
                                                                loadUnits();
                                                                loadAvailableUsers();
                                                            }}
                                                            variant="ghost"
                                                            size="icon"
                                                            className="h-7 w-7 text-muted-foreground hover:text-red-400 hover:bg-red-500/10 rounded-md transition-colors"
                                                        >
                                                            <X size={13} />
                                                        </Button>
                                                    </div>
                                                </div>
                                            ))}

                                            <button
                                                onClick={() => setShowAssignDialog(true)}
                                                className="w-full mt-2 h-10 bg-foreground/10 hover:bg-blue-500/10 border border-dashed border-border hover:border-blue-500/30 rounded-md font-semibold text-[10px] uppercase tracking-wide text-blue-400 hover:text-blue-300 transition-colors flex items-center justify-center gap-2"
                                            >
                                                <Plus size={14} />
                                                Vincular Nuevo Residente
                                            </button>

                                            {(editingUnit?.users?.length || 0) === 0 && (
                                                <div className="py-12 text-center bg-muted/40 rounded-md border border-dashed border-border">
                                                    <Users size={32} className="mx-auto text-muted-foreground mb-3" />
                                                    <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Sin habitantes registrados</p>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}

                                {/* Inner Assign Dialog */}
                                <Dialog open={showAssignDialog} onOpenChange={setShowAssignDialog}>
                                    <DialogContent className="bg-card border-border text-foreground max-w-md p-6 rounded-lg shadow-lg">
                                        <DialogHeader>
                                            <DialogTitle className="text-lg font-bold uppercase tracking-tighter">Vincular Residente</DialogTitle>
                                            <DialogDescription className="text-xs text-muted-foreground">Selecciona un usuario de la lista global para asignarlo a {editingUnit?.name}.</DialogDescription>
                                        </DialogHeader>
                                        <div className="space-y-4 py-4">
                                            <div className="relative">
                                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={12} />
                                                <Input
                                                    placeholder="Buscar usuario..."
                                                    className="bg-card border-border pl-9 h-10 text-xs"
                                                    value={searchAvailable}
                                                    onChange={(e) => setSearchAvailable(e.target.value)}
                                                />
                                            </div>
                                            <div className="max-h-[300px] overflow-y-auto custom-scrollbar space-y-1 pr-2">
                                                {availableUsers.filter(u => u.name.toLowerCase().includes(searchAvailable.toLowerCase())).map(user => (
                                                    <button
                                                        key={user.id}
                                                        onClick={async () => {
                                                            if (editingUnit) {
                                                                await assignUserToUnit(user.id, editingUnit.id);
                                                                toast.success({ title: `${user.name} vinculado correctamente` });
                                                                setShowAssignDialog(false);
                                                                loadUnits();
                                                                loadAvailableUsers();
                                                            }
                                                        }}
                                                        className="w-full flex items-center justify-between p-3 rounded-xl hover:bg-blue-600/10 border border-transparent hover:border-blue-500/30 transition-all group"
                                                    >
                                                        <div className="flex items-center gap-3 text-left">
                                                            <div className="w-8 h-8 rounded-lg bg-foreground/10 flex items-center justify-center">
                                                                <UserCircle size={16} className="text-muted-foreground group-hover:text-blue-400" />
                                                            </div>
                                                            <div>
                                                                <p className="text-xs font-bold text-foreground uppercase">{user.name}</p>
                                                                <p className="text-[9px] text-muted-foreground uppercase font-bold">{user.email}</p>
                                                            </div>
                                                        </div>
                                                        <ChevronRight size={14} className="text-muted-foreground group-hover:text-blue-500" />
                                                    </button>
                                                ))}
                                                {availableUsers.length === 0 && (
                                                    <p className="text-center py-8 text-[10px] text-muted-foreground font-bold uppercase tracking-widest">No hay usuarios disponibles</p>
                                                )}
                                            </div>
                                        </div>
                                    </DialogContent>
                                </Dialog>
                                {activeEditTab === 'units' && (
                                    <div className="space-y-6 animate-in fade-in duration-300">
                                        <div className="flex items-center justify-between mb-4">
                                            <div className="flex items-center gap-2">
                                                <LayoutGrid className="text-blue-500" size={16} />
                                                <h4 className="text-[10px] font-bold text-foreground uppercase tracking-widest">Unidades del Complejo</h4>
                                            </div>
                                            <div className="flex gap-2">
                                                <Button
                                                    onClick={() => setShowBulkDialog(true)}
                                                    variant="outline"
                                                    size="sm"
                                                    className="h-8 bg-card border-border rounded-lg font-bold text-[8px] uppercase tracking-widest text-emerald-500 hover:bg-emerald-500/5 hover:border-emerald-500/30"
                                                >
                                                    <Layers className="mr-2" size={12} /> Generación Masiva
                                                </Button>
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={() => {
                                                        if (!editingUnit) return;
                                                        const pId = editingUnit.id;
                                                        setShowEditDialog(false);
                                                        handleCreateNew(pId);
                                                    }}
                                                    className="h-8 bg-blue-600 border-none rounded-lg font-bold text-[8px] uppercase tracking-widest text-foreground hover:bg-blue-500"
                                                >
                                                    <Plus className="mr-2" size={12} /> Nueva
                                                </Button>
                                            </div>
                                        </div>

                                        <div className="grid grid-cols-2 gap-3 max-h-[350px] overflow-y-auto custom-scrollbar pr-2">
                                            {editingUnit?.children?.map((child) => (
                                                <div key={child.id} className="bg-card/60 p-4 rounded-lg flex items-center justify-between border border-border hover:border-blue-500/30 transition-all group">
                                                    <div className="flex items-center gap-3">
                                                        <div className="w-8 h-8 rounded-lg bg-foreground/10 flex items-center justify-center text-muted-foreground group-hover:text-blue-400 group-hover:bg-blue-600/10 transition-all">
                                                            <Home size={14} />
                                                        </div>
                                                        <div>
                                                            <p className="font-bold text-foreground uppercase text-xs tracking-tight">{child.name}</p>
                                                            <div className="flex items-center gap-2">
                                                                <p className="text-[8px] font-bold text-muted-foreground uppercase tracking-widest leading-none">
                                                                    {child.lot ? `Lote ${child.lot}` : ""} {child.houseNumber ? `N° ${child.houseNumber}` : ""}
                                                                </p>
                                                                {child.users?.some(u => u.vehicles?.length > 0) && (
                                                                    <div className="flex items-center gap-1.5 border-l border-border pl-2">
                                                                        <Car size={10} className="text-blue-500" />
                                                                        <div className="flex gap-1">
                                                                            {child.users.flatMap(u => u.vehicles || []).slice(0, 2).map((v, idx) => (
                                                                                <span key={idx} className="text-[7px] font-mono font-bold text-blue-400 bg-blue-500/10 px-1 rounded">{v.plate}</span>
                                                                            ))}
                                                                            {child.users.flatMap(u => u.vehicles || []).length > 2 && <span className="text-[7px] text-muted-foreground font-bold">...</span>}
                                                                        </div>
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </div>
                                                    </div>
                                                    <div className="flex items-center gap-1">
                                                        <div className="flex -space-x-1.5 mr-2">
                                                            {child.users?.slice(0, 3).map((u, i) => (
                                                                <div key={i} className="w-5 h-5 rounded-full border border-black bg-muted flex items-center justify-center overflow-hidden ring-1 ring-border" title={u.name}>
                                                                    {u.cara ? <Image src={u.cara} alt="" width={20} height={20} className="object-cover" /> : <UserCircle size={10} className="text-muted-foreground" />}
                                                                </div>
                                                            ))}
                                                        </div>
                                                        <Badge className={cn("text-[7px] border-none font-bold h-4 px-1.5 uppercase", child.users.length > 0 ? "bg-emerald-500/10 text-emerald-500" : "bg-muted text-muted-foreground")}>
                                                            {child.users.length > 0 ? 'Ocupada' : 'Libre'}
                                                        </Badge>
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            className="h-7 w-7 text-muted-foreground hover:text-foreground rounded-md"
                                                            onClick={() => {
                                                                setEditingUnit(child);
                                                                setActiveEditTab('general');
                                                            }}
                                                        >
                                                            <Pencil size={12} />
                                                        </Button>
                                                    </div>
                                                </div>
                                            ))}
                                            {(editingUnit?.children?.length || 0) === 0 && (
                                                <div className="col-span-2 py-12 text-center bg-muted/40 rounded-lg border border-dashed border-border opacity-50">
                                                    <LayoutGrid size={32} className="mx-auto text-muted-foreground mb-3" />
                                                    <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest">No hay sub-unidades definidas</p>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}

                                {activeEditTab === 'vehicles' && (
                                    <div className="space-y-4 animate-in fade-in duration-300">
                                        <div className="flex items-center justify-between mb-3">
                                            <div>
                                                <h4 className="text-xs font-bold text-foreground uppercase tracking-wider mb-1">Vehículos Registrados</h4>
                                                <p className="text-[10px] text-muted-foreground">Matrículas con acceso LPR</p>
                                            </div>
                                            <Badge className="bg-emerald-600/20 text-emerald-400 border border-emerald-500/30 text-[10px] font-bold px-2.5 py-0.5 flex items-center gap-1.5">
                                                <Activity size={10} />
                                                LPR Activo
                                            </Badge>
                                        </div>

                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                            {editingUnit?.users?.flatMap(u => (u as any).credentials?.filter((c: any) => c.type === 'PLATE').map((c: any) => ({ ...c, userName: u.name }))).map((plate, idx) => (
                                                <div key={idx} className="bg-card hover:bg-muted p-3 rounded-md border border-border hover:border-emerald-500/30 flex items-center gap-3 transition-colors">
                                                    <div className="w-10 h-10 rounded-md bg-emerald-500/10 flex items-center justify-center text-emerald-400 border border-emerald-500/20">
                                                        <Car size={18} />
                                                    </div>
                                                    <div className="flex-1">
                                                        <p className="text-base font-bold text-foreground tracking-wider uppercase font-mono">{plate.value}</p>
                                                        <p className="text-[9px] font-medium text-muted-foreground uppercase">{plate.userName}</p>
                                                    </div>
                                                </div>
                                            ))}

                                            {(editingUnit?.users?.reduce((acc, u) => acc + (u as any).credentials?.filter((c: any) => c.type === 'PLATE').length || 0, 0) || 0) === 0 && (
                                                <div className="col-span-2 py-12 text-center bg-muted/40 rounded-md border border-dashed border-border">
                                                    <Car size={32} className="mx-auto text-muted-foreground mb-3" />
                                                    <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Sin matrículas registradas</p>
                                                    <p className="text-[9px] text-muted-foreground mt-1">Los vehículos se vinculan desde el perfil del usuario</p>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* Clean Footer */}
                            <div className="p-4 bg-card/50 border-t border-border flex justify-end items-center gap-3">
                                <button
                                    onClick={() => setShowEditDialog(false)}
                                    className="h-9 px-5 rounded-md bg-foreground/10 hover:bg-accent border border-border text-muted-foreground hover:text-foreground font-semibold text-[10px] uppercase tracking-wide transition-colors"
                                >
                                    Cancelar
                                </button>
                                <button
                                    onClick={handleSave}
                                    className="h-9 px-6 rounded-md bg-blue-600 hover:bg-blue-500 text-foreground font-semibold text-[10px] uppercase tracking-wide transition-colors flex items-center gap-1.5"
                                >
                                    <Check size={13} />
                                    Guardar
                                </button>
                            </div>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>

            {/* Bulk Creation Dialog */}
            <Dialog open={showBulkDialog} onOpenChange={setShowBulkDialog}>
                <DialogContent className="bg-card border-border text-foreground max-w-sm p-6 rounded-lg shadow-lg outline-none">
                    <DialogHeader>
                        <DialogTitle className="text-lg font-bold uppercase tracking-tighter">Generación Masiva</DialogTitle>
                        <DialogDescription className="text-xs text-muted-foreground italic">
                            Se generarán sub-unidades automáticamente siguiendo el patrón definido.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-6">
                        <div className="space-y-2">
                            <Label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest text-center block">Patrón de Nomenclatura</Label>
                            <Input
                                value={bulkPattern}
                                onChange={(e) => setBulkPattern(e.target.value)}
                                placeholder="A-Z, 13"
                                className="bg-card border-border h-12 text-lg font-bold text-blue-400 uppercase text-center rounded-xl"
                            />
                            <p className="text-[8px] text-muted-foreground uppercase font-bold text-center mt-2 px-4">
                                Ejemplo: "A-Z, 13" generará lotes desde A01 hasta Z13.
                            </p>
                        </div>

                        <Button onClick={handleBulkCreate} className="w-full h-12 bg-emerald-600 hover:bg-emerald-500 font-bold text-[10px] uppercase tracking-widest text-foreground rounded-xl shadow-lg transition-all active:scale-95">
                            <Layers className="mr-2" size={16} /> Iniciar Generación
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>

            <style jsx global>{`
                .custom-scrollbar::-webkit-scrollbar { width: 4px; }
                .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
                .custom-scrollbar::-webkit-scrollbar-thumb { background: #333; border-radius: 10px; }
                .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #444; }
                .leaflet-container { background: #0a0a0a !important; border-radius: 32px; }
            `}</style>
        </div>
    );
}

function Textarea({ value, onChange, placeholder, className }: { value: string, onChange: (e: any) => void, placeholder?: string, className?: string }) {
    return (
        <textarea
            value={value}
            onChange={onChange}
            placeholder={placeholder}
            className={cn(
                "w-full bg-card border border-border rounded-xl p-4 text-xs text-foreground placeholder:text-neutral-700 focus:outline-none focus:border-blue-500 transition-all",
                className
            )}
        />
    );
}
