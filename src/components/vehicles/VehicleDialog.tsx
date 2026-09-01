"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { createVehicle, updateVehicle } from "@/app/actions/vehicles";
import { Loader2, Car, User as UserIcon, Palette, FileText, Plus, ChevronDown, Bike, Truck, Bus, Hash, IdCard, Check, HelpCircle, Tag } from "lucide-react";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { sileo as toast } from "sileo";
import Image from "next/image";
import { getCarLogo, VEHICLE_BRANDS } from "@/lib/car-logos";
import { User } from "@prisma/client";

const PRESET_COLORS = [
    { name: "Blanco", value: "#F8FAFC" },
    { name: "Negro", value: "#0A0A0A" },
    { name: "Gris", value: "#6B7280" },
    { name: "Plata", value: "#C0C0C0" },
    { name: "Rojo", value: "#DC2626" },
    { name: "Azul", value: "#2563EB" },
    { name: "Verde", value: "#16A34A" },
    { name: "Bordó", value: "#7F1D1D" },
    { name: "Beige", value: "#E7DCC3" },
    { name: "Amarillo", value: "#EAB308" },
];

const VEHICLE_TYPES = [
    { value: "SEDAN", label: "Sedán", icon: Car },
    { value: "SUV", label: "SUV", icon: Car },
    { value: "PICKUP", label: "Pickup", icon: Truck },
    { value: "MOTORCYCLE", label: "Moto", icon: Bike },
    { value: "TRUCK", label: "Camión", icon: Truck },
    { value: "BUS", label: "Bus", icon: Bus },
];

interface VehicleDialogProps {
    users: User[];
    vehicle?: any;
    trigger?: React.ReactNode;
    onSuccess?: () => void;
}

function colorHexFromName(name: string): string {
    const p = PRESET_COLORS.find(c => c.name.toLowerCase() === (name || "").toLowerCase());
    if (p) return p.value;
    if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(name || "")) return name;
    return "#3F3F46";
}

export function VehicleDialog({ users, vehicle, trigger, onSuccess }: VehicleDialogProps) {
    const [open, setOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [formData, setFormData] = useState({
        plate: vehicle?.plate || "",
        brand: vehicle?.brand || "",
        model: vehicle?.model || "",
        color: vehicle?.color || "",
        notes: vehicle?.notes || "",
        userId: vehicle?.userId || "",
        type: vehicle?.type || "SEDAN",
    });
    const [openBrand, setOpenBrand] = useState(false);

    const isEdit = !!vehicle;
    const logoUrl = getCarLogo(formData.brand);
    const swatch = colorHexFromName(formData.color);
    const owner = users.find(u => u.id === formData.userId);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        try {
            if (isEdit) {
                const res = await updateVehicle(vehicle.id, formData);
                if (res.success) toast.success({ title: "Vehículo actualizado" });
            } else {
                const res = await createVehicle(formData);
                if (res.success) toast.success({ title: "Vehículo registrado" });
            }
            setOpen(false);
            if (onSuccess) onSuccess();
        } catch (error) {
            toast.error({ title: "Error al guardar" });
        } finally {
            setLoading(false);
        }
    };

    const labelCls = "flex items-center gap-1.5 text-[10px] font-bold uppercase text-muted-foreground tracking-widest";

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                {trigger || (
                    <Button className="gap-2 bg-emerald-600 hover:bg-emerald-700">
                        <Plus size={18} /> Registrar Vehículo
                    </Button>
                )}
            </DialogTrigger>
            <DialogContent className="max-w-3xl p-0 bg-background border-border overflow-hidden rounded-2xl">
                <TooltipProvider delayDuration={200}>
                    <DialogHeader className="p-6 bg-gradient-to-br from-emerald-500/10 via-card/50 to-card/50 border-b border-border flex flex-row items-center gap-4 space-y-0">
                        <div className="w-12 h-12 rounded-xl bg-emerald-500/15 border border-emerald-500/25 flex items-center justify-center text-emerald-400 shrink-0">
                            <Car size={24} />
                        </div>
                        <div className="min-w-0">
                            <DialogTitle className="text-xl font-bold text-foreground tracking-tight">
                                {isEdit ? "Editar vehículo" : "Nuevo vehículo"}
                            </DialogTitle>
                            <DialogDescription className="text-muted-foreground text-xs">
                                Datos del vehículo y su propietario
                            </DialogDescription>
                        </div>
                    </DialogHeader>

                    <form onSubmit={handleSubmit} className="max-h-[72vh] overflow-y-auto custom-scrollbar">
                        {/* Live preview */}
                        <div className="px-6 pt-5">
                            <div className="rounded-xl border border-border bg-card/60 p-4 flex items-center gap-4">
                                <div className="w-12 h-12 rounded-lg bg-muted border border-border flex items-center justify-center p-1.5 shrink-0">
                                    {logoUrl ? (
                                        <Image src={logoUrl} alt="" width={32} height={32} className="object-contain filter brightness-0 invert opacity-70" />
                                    ) : <Car size={20} className="text-muted-foreground" />}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-md bg-white shadow-sm border-b-2 border-blue-600">
                                        <span className="font-mono text-lg font-bold tracking-[0.2em] text-black">{formData.plate || "———"}</span>
                                    </div>
                                    <p className="text-[11px] text-muted-foreground mt-1 truncate">
                                        {[formData.brand, formData.model].filter(Boolean).join(" · ") || "Marca / modelo"} {owner ? `— ${owner.name}` : ""}
                                    </p>
                                </div>
                                <div className="flex flex-col items-center gap-1 shrink-0">
                                    <div className="w-7 h-7 rounded-full border-2 border-border shadow-inner" style={{ backgroundColor: swatch }} />
                                    <span className="text-[9px] text-muted-foreground">{formData.color || "color"}</span>
                                </div>
                            </div>
                        </div>

                        {/* Section: Identificación */}
                        <div className="px-6 pt-5">
                            <div className="flex items-center gap-2 mb-3">
                                <IdCard size={14} className="text-emerald-400" />
                                <span className="text-[11px] font-bold uppercase tracking-widest text-foreground">Identificación</span>
                                <div className="flex-1 h-px bg-border" />
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                <div className="space-y-1.5">
                                    <div className="flex items-center justify-between">
                                        <Label className={labelCls}><Hash size={11} /> Matrícula</Label>
                                        <Tooltip><TooltipTrigger asChild><HelpCircle size={12} className="text-muted-foreground/50" /></TooltipTrigger><TooltipContent>Se guarda en mayúsculas y sin espacios</TooltipContent></Tooltip>
                                    </div>
                                    <Input
                                        value={formData.plate}
                                        onChange={(e) => setFormData({ ...formData, plate: e.target.value.toUpperCase().replace(/\s/g, "") })}
                                        className="bg-card border-border h-11 font-mono text-base font-bold tracking-wider"
                                        placeholder="ABC1234"
                                        required
                                    />
                                </div>
                                <div className="space-y-1.5">
                                    <Label className={labelCls}><UserIcon size={11} /> Titular</Label>
                                    <Select value={formData.userId} onValueChange={(val) => setFormData({ ...formData, userId: val })}>
                                        <SelectTrigger className="bg-card border-border h-11"><SelectValue placeholder="Seleccionar..." /></SelectTrigger>
                                        <SelectContent>
                                            {users.map(u => (<SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>))}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-1.5">
                                    <Label className={labelCls}><Tag size={11} /> Tipo</Label>
                                    <Select value={formData.type} onValueChange={(v) => setFormData({ ...formData, type: v })}>
                                        <SelectTrigger className="bg-card border-border h-11"><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            {VEHICLE_TYPES.map(t => (
                                                <SelectItem key={t.value} value={t.value}>
                                                    <span className="flex items-center gap-2"><t.icon size={14} className="text-muted-foreground" /> {t.label}</span>
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>
                        </div>

                        {/* Section: Vehículo */}
                        <div className="px-6 pt-6">
                            <div className="flex items-center gap-2 mb-3">
                                <Car size={14} className="text-emerald-400" />
                                <span className="text-[11px] font-bold uppercase tracking-widest text-foreground">Vehículo</span>
                                <div className="flex-1 h-px bg-border" />
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="space-y-1.5">
                                    <Label className={labelCls}><Palette size={11} /> Marca</Label>
                                    <Popover open={openBrand} onOpenChange={setOpenBrand}>
                                        <PopoverTrigger asChild>
                                            <Button type="button" variant="outline" className="w-full justify-between bg-card border-border h-11 font-normal">
                                                <span className="flex items-center gap-2 min-w-0">
                                                    {logoUrl && <Image src={logoUrl} alt="" width={18} height={18} className="object-contain shrink-0" />}
                                                    <span className="truncate">{formData.brand || "Elegir marca..."}</span>
                                                </span>
                                                <ChevronDown size={14} className="opacity-50 shrink-0" />
                                            </Button>
                                        </PopoverTrigger>
                                        <PopoverContent className="w-[260px] p-0 bg-card border-border" align="start">
                                            <Command>
                                                <CommandInput placeholder="Buscar marca..." />
                                                <CommandList>
                                                    <CommandEmpty>Sin resultados</CommandEmpty>
                                                    <CommandGroup>
                                                        {VEHICLE_BRANDS.map(b => {
                                                            const bl = getCarLogo(b.label);
                                                            return (
                                                                <CommandItem key={b.label} onSelect={() => { setFormData({ ...formData, brand: b.label }); setOpenBrand(false); }}>
                                                                    <span className="flex items-center gap-2">
                                                                        {bl ? <Image src={bl} alt="" width={16} height={16} className="object-contain" /> : <Car size={14} className="text-muted-foreground" />}
                                                                        {b.label}
                                                                    </span>
                                                                    {formData.brand === b.label && <Check size={14} className="ml-auto text-emerald-400" />}
                                                                </CommandItem>
                                                            );
                                                        })}
                                                    </CommandGroup>
                                                </CommandList>
                                            </Command>
                                        </PopoverContent>
                                    </Popover>
                                </div>
                                <div className="space-y-1.5">
                                    <Label className={labelCls}><FileText size={11} /> Modelo</Label>
                                    <Input value={formData.model} onChange={(e) => setFormData({ ...formData, model: e.target.value })} className="bg-card border-border h-11" placeholder="Corolla, Hilux..." />
                                </div>
                            </div>

                            {/* Color picker */}
                            <div className="space-y-2 mt-4">
                                <Label className={labelCls}><Palette size={11} /> Color</Label>
                                <div className="flex items-center gap-2 flex-wrap">
                                    {PRESET_COLORS.map(c => (
                                        <Tooltip key={c.name}>
                                            <TooltipTrigger asChild>
                                                <button type="button" onClick={() => setFormData({ ...formData, color: c.name })}
                                                    className={cn("relative w-8 h-8 rounded-full border transition-all hover:scale-110",
                                                        formData.color === c.name ? "ring-2 ring-emerald-500 ring-offset-2 ring-offset-background border-transparent" : "border-border")}
                                                    style={{ backgroundColor: c.value }}>
                                                    {formData.color === c.name && <Check size={13} className={cn("absolute inset-0 m-auto", (c.name === "Blanco" || c.name === "Beige" || c.name === "Amarillo" || c.name === "Plata") ? "text-black" : "text-white")} />}
                                                </button>
                                            </TooltipTrigger>
                                            <TooltipContent>{c.name}</TooltipContent>
                                        </Tooltip>
                                    ))}
                                    <label className="relative w-8 h-8 rounded-full border border-dashed border-border flex items-center justify-center cursor-pointer hover:border-emerald-500 overflow-hidden" title="Color personalizado">
                                        <Plus size={13} className="text-muted-foreground pointer-events-none" />
                                        <input type="color" value={swatch} onChange={(e) => setFormData({ ...formData, color: e.target.value })} className="absolute inset-0 opacity-0 cursor-pointer" />
                                    </label>
                                    <Input value={formData.color} onChange={(e) => setFormData({ ...formData, color: e.target.value })} placeholder="Nombre o #hex" className="bg-card border-border h-9 w-40 text-xs ml-1" />
                                </div>
                            </div>

                            {/* Notes */}
                            <div className="space-y-1.5 mt-4">
                                <Label className={labelCls}><FileText size={11} /> Observaciones</Label>
                                <Textarea value={formData.notes} onChange={(e) => setFormData({ ...formData, notes: e.target.value })} className="bg-card border-border h-20 resize-none" placeholder="Notas internas (opcional)" />
                            </div>
                        </div>

                        <DialogFooter className="px-6 py-4 mt-5 border-t border-border bg-card/30">
                            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
                            <Button type="submit" disabled={loading} className="bg-emerald-600 hover:bg-emerald-500 min-w-[150px]">
                                {loading ? <Loader2 className="animate-spin" size={16} /> : (isEdit ? "Guardar cambios" : "Registrar vehículo")}
                            </Button>
                        </DialogFooter>
                    </form>
                </TooltipProvider>
            </DialogContent>
        </Dialog>
    );
}
