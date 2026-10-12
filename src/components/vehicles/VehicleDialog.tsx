"use client";

import { useEffect, useMemo, useState } from "react";
import { Tooltip } from "react-tooltip";
import Image from "next/image";
import { Loader2, Car, User as UserIcon, Palette, FileText, Plus, ChevronDown, Bike, Truck, Bus, Hash, IdCard, Check, Tag, Save, Home } from "lucide-react";
import { Cajon, CajonDisparador, CajonContenido } from "@/components/ui/cajon";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Campo, Etiqueta, Bloque, Heroe, chipHeroe } from "@/components/ui/cajon-campos";
import { createVehicle, updateVehicle } from "@/app/actions/vehicles";
import { getCarLogo, VEHICLE_BRANDS } from "@/lib/car-logos";
import { cn } from "@/lib/utils";
import { sileo as toast } from "sileo";

/**
 * Alta y edición de un vehículo en un cajón (como la ficha de Dispositivos): arriba la
 * «chapa» grande con marca, color y titular, fija al bajar; abajo los campos con ícono y
 * ayuda. Misma API que el diálogo anterior (users, vehicle, trigger, onSuccess).
 */
const TT = "tt-vehiculo";
const PRESET_COLORS = [
    { name: "Blanco", value: "#F8FAFC" }, { name: "Negro", value: "#0A0A0A" }, { name: "Gris", value: "#6B7280" },
    { name: "Plata", value: "#C0C0C0" }, { name: "Rojo", value: "#DC2626" }, { name: "Azul", value: "#2563EB" },
    { name: "Verde", value: "#16A34A" }, { name: "Bordó", value: "#7F1D1D" }, { name: "Beige", value: "#E7DCC3" }, { name: "Amarillo", value: "#EAB308" },
];
const CLAROS = new Set(["Blanco", "Beige", "Amarillo", "Plata"]);
const VEHICLE_TYPES = [
    { value: "SEDAN", label: "Sedán", icon: Car }, { value: "SUV", label: "SUV", icon: Car }, { value: "PICKUP", label: "Pickup", icon: Truck },
    { value: "MOTORCYCLE", label: "Moto", icon: Bike }, { value: "TRUCK", label: "Camión", icon: Truck }, { value: "BUS", label: "Bus", icon: Bus },
];
function colorHex(name: string): string {
    const p = PRESET_COLORS.find((c) => c.name.toLowerCase() === (name || "").toLowerCase());
    if (p) return p.value;
    if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(name || "")) return name;
    return "#3F3F46";
}

export function VehicleDialog({ users, vehicle, trigger, onSuccess }: { users: any[]; vehicle?: any; trigger?: React.ReactNode; onSuccess?: () => void }) {
    const [open, setOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const blanco = () => ({
        plate: vehicle?.plate || "", brand: vehicle?.brand || "", model: vehicle?.model || "", color: vehicle?.color || "",
        notes: vehicle?.notes || "", userId: vehicle?.userId || "", type: vehicle?.type || "SEDAN",
    });
    const [f, setF] = useState(blanco());
    const set = (k: keyof ReturnType<typeof blanco>, v: string) => setF((p) => ({ ...p, [k]: v }));
    const [abreMarca, setAbreMarca] = useState(false);
    const [abreTitular, setAbreTitular] = useState(false);
    useEffect(() => { if (open) setF(blanco()); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

    const isEdit = !!vehicle;
    const logo = getCarLogo(f.brand);
    const swatch = colorHex(f.color);
    const titular = users.find((u) => u.id === f.userId);
    const tipo = VEHICLE_TYPES.find((t) => t.value === f.type);
    const usuariosOrden = useMemo(() => [...users].sort((a, b) => String(a.name).localeCompare(String(b.name))), [users]);

    const guardar = async () => {
        if (!f.plate.trim()) { toast.error({ title: "Falta la matrícula" }); return; }
        setLoading(true);
        try {
            const res: any = isEdit ? await updateVehicle(vehicle.id, f) : await createVehicle(f);
            if (res?.success === false) { toast.error({ title: "No se pudo guardar", description: res?.error }); return; }
            toast.success({ title: isEdit ? "Vehículo actualizado" : "Vehículo registrado", description: f.plate });
            setOpen(false); onSuccess?.();
        } catch (e: any) { toast.error({ title: "Error al guardar", description: e?.message }); }
        finally { setLoading(false); }
    };

    return (
        <Cajon open={open} onOpenChange={setOpen}>
            <CajonDisparador asChild>
                {trigger || <Button className="gap-2 bg-emerald-600 hover:bg-emerald-700"><Plus size={18} /> Registrar Vehículo</Button>}
            </CajonDisparador>
            <CajonContenido ancho="intermedio" tituloOculto titulo={isEdit ? `Vehículo ${f.plate}` : "Nuevo vehículo"} descripcion="Datos del vehículo y su titular"
                pie={<div className="flex items-center gap-2 w-full">
                    <span className="flex-1 text-[12px] text-muted-foreground truncate">{isEdit ? "Los cambios se sincronizan a las cámaras con «Sincronizar matrículas»." : ""}</span>
                    <Button variant="outline" onClick={() => setOpen(false)} disabled={loading}>Cancelar</Button>
                    <Button onClick={guardar} disabled={loading} className="gap-1.5">{loading ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} {isEdit ? "Guardar cambios" : "Registrar"}</Button>
                </div>}>
                <Heroe titulo={isEdit ? "Editar vehículo" : "Nuevo vehículo"} subtitulo={[f.brand, f.model].filter(Boolean).join(" · ") || "Marca y modelo"}
                    chips={<>
                        {tipo && <span className={chipHeroe}><tipo.icon size={12} /> {tipo.label}</span>}
                        {titular ? <span className={chipHeroe}><UserIcon size={11} /> {titular.name}</span> : <span className={cn(chipHeroe, "!bg-amber-500/80")}>Sin titular</span>}
                    </>}>
                    {/* Chapa grande + logo + color */}
                    <div className="flex items-center gap-4 mt-1">
                        <div className="w-14 h-14 rounded-xl bg-white/10 ring-1 ring-white/15 grid place-items-center p-2 shrink-0">
                            {logo ? <Image src={logo} alt="" width={40} height={40} className="object-contain brightness-0 invert opacity-90" /> : <Car size={24} className="text-white/60" />}
                        </div>
                        <div className="flex-1 flex justify-center">
                            <div className="relative rounded-lg bg-white shadow-[0_8px_24px_rgba(0,0,0,0.5)] overflow-hidden min-w-[210px]">
                                <div className="h-3 bg-blue-700 flex items-center justify-center"><span className="text-[7px] font-bold tracking-[0.3em] text-white">URUGUAY</span></div>
                                <div className="px-5 py-1.5 text-center font-mono text-[28px] font-black tracking-[0.18em] text-neutral-900">{f.plate || "———"}</div>
                            </div>
                        </div>
                        <div className="flex flex-col items-center gap-1 shrink-0">
                            <span className="w-10 h-10 rounded-full ring-2 ring-white/30 shadow-inner" style={{ backgroundColor: swatch }} />
                            <span className="text-[10px] text-white/70">{f.color || "color"}</span>
                        </div>
                    </div>
                </Heroe>

                <Bloque titulo="Identificación" icono={IdCard} tt={TT} ayuda="La matrícula es lo que leen las cámaras: se guarda en mayúsculas y sin espacios.">
                    <Campo etiqueta="Matrícula" icono={Hash} value={f.plate} onChange={(v) => set("plate", v.replace(/[^A-Za-z0-9]/g, "").toUpperCase())} placeholder="SBV4061" mono autoFocus={!isEdit} tt={TT}
                        ayuda="Tal cual está en la chapa, sin espacios ni guiones. Ej.: SBV4061, ABC1234. Es lo que se carga en la lista de cada cámara LPR." />
                    <div>
                        <Etiqueta texto="Titular" tt={TT} ayuda="A quién pertenece. Decide el lote, el tipo (residente/proveedor) y el grupo de acceso con que pasa. Ej.: buscá «Pérez» o «G18»." />
                        <Popover open={abreTitular} onOpenChange={setAbreTitular}>
                            <PopoverTrigger asChild>
                                <button type="button" className="h-10 w-full rounded-lg border border-border bg-background px-3 text-[13px] flex items-center gap-2 hover:border-[var(--accion)] transition-colors">
                                    <UserIcon size={15} className="text-muted-foreground" />
                                    <span className={cn("flex-1 text-left truncate", !titular && "text-muted-foreground/70")}>{titular ? titular.name : "Elegir titular…"}</span>
                                    {titular?.unit?.name && <span className="text-[11px] text-muted-foreground inline-flex items-center gap-1"><Home size={11} /> {titular.unit.name}</span>}
                                    <ChevronDown size={14} className="opacity-50" />
                                </button>
                            </PopoverTrigger>
                            <PopoverContent className="w-[380px] p-0" align="start">
                                <Command>
                                    <CommandInput placeholder="Buscar por nombre…" />
                                    <CommandList>
                                        <CommandEmpty>Nadie coincide</CommandEmpty>
                                        <CommandGroup>
                                            {usuariosOrden.map((u) => (
                                                <CommandItem key={u.id} value={`${u.name} ${u.id}`} onSelect={() => { set("userId", u.id); setAbreTitular(false); }}>
                                                    <span className="flex-1 truncate">{u.name}</span>
                                                    {u.unit?.name && <span className="text-[11px] text-muted-foreground">{u.unit.name}</span>}
                                                    {f.userId === u.id && <Check size={14} className="ml-2 text-[var(--accion)]" />}
                                                </CommandItem>
                                            ))}
                                        </CommandGroup>
                                    </CommandList>
                                </Command>
                            </PopoverContent>
                        </Popover>
                    </div>
                    <div>
                        <Etiqueta texto="Tipo" tt={TT} ayuda="Para el ícono en el monitor y los reportes. No cambia el acceso." />
                        <div className="grid grid-cols-6 gap-1.5">
                            {VEHICLE_TYPES.map((t) => (
                                <button key={t.value} type="button" onClick={() => set("type", t.value)}
                                    className={cn("h-14 rounded-lg border flex flex-col items-center justify-center gap-1 text-[10.5px] font-semibold transition-all",
                                        f.type === t.value ? "border-[var(--accion)] bg-[color-mix(in_oklab,var(--accion)_8%,transparent)] ring-1 ring-[var(--accion)]" : "border-border hover:bg-accent/60 text-muted-foreground")}>
                                    <t.icon size={17} /> {t.label}
                                </button>
                            ))}
                        </div>
                    </div>
                </Bloque>

                <Bloque titulo="Vehículo" icono={Car} tt={TT}>
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <Etiqueta texto="Marca" tt={TT} ayuda="Ej.: Toyota, Volkswagen, Fiat. Muestra el logo en el monitor." />
                            <Popover open={abreMarca} onOpenChange={setAbreMarca}>
                                <PopoverTrigger asChild>
                                    <button type="button" className="h-10 w-full rounded-lg border border-border bg-background px-3 text-[13px] flex items-center gap-2 hover:border-[var(--accion)] transition-colors">
                                        {logo ? <Image src={logo} alt="" width={16} height={16} className="object-contain" /> : <Tag size={15} className="text-muted-foreground" />}
                                        <span className={cn("flex-1 text-left truncate", !f.brand && "text-muted-foreground/70")}>{f.brand || "Elegir marca…"}</span>
                                        <ChevronDown size={14} className="opacity-50" />
                                    </button>
                                </PopoverTrigger>
                                <PopoverContent className="w-[260px] p-0" align="start">
                                    <Command>
                                        <CommandInput placeholder="Buscar marca…" />
                                        <CommandList>
                                            <CommandEmpty>Sin resultados</CommandEmpty>
                                            <CommandGroup>
                                                {VEHICLE_BRANDS.map((b) => {
                                                    const bl = getCarLogo(b.label);
                                                    return (
                                                        <CommandItem key={b.label} onSelect={() => { set("brand", b.label); setAbreMarca(false); }}>
                                                            {bl ? <Image src={bl} alt="" width={16} height={16} className="object-contain mr-2" /> : <Car size={14} className="text-muted-foreground mr-2" />}
                                                            {b.label}
                                                            {f.brand === b.label && <Check size={14} className="ml-auto text-[var(--accion)]" />}
                                                        </CommandItem>
                                                    );
                                                })}
                                            </CommandGroup>
                                        </CommandList>
                                    </Command>
                                </PopoverContent>
                            </Popover>
                        </div>
                        <Campo etiqueta="Modelo" icono={FileText} value={f.model} onChange={(v) => set("model", v)} placeholder="Corolla, Hilux…" tt={TT} ayuda="Ej.: Corolla, Hilux, Gol. Opcional." />
                    </div>
                    <div>
                        <Etiqueta texto="Color" tt={TT} ayuda="Ayuda a la guardia a reconocer el auto. Elegí uno o escribí el nombre / #hex." />
                        <div className="flex items-center gap-2 flex-wrap">
                            {PRESET_COLORS.map((c) => (
                                <button key={c.name} type="button" onClick={() => set("color", c.name)} data-tooltip-id={TT} data-tooltip-content={c.name}
                                    className={cn("relative w-8 h-8 rounded-full border transition-all hover:scale-110", f.color === c.name ? "ring-2 ring-[var(--accion)] ring-offset-2 ring-offset-background border-transparent" : "border-border")}
                                    style={{ backgroundColor: c.value }}>
                                    {f.color === c.name && <Check size={13} className={cn("absolute inset-0 m-auto", CLAROS.has(c.name) ? "text-black" : "text-white")} />}
                                </button>
                            ))}
                            <label className="relative w-8 h-8 rounded-full border border-dashed border-border grid place-items-center cursor-pointer hover:border-[var(--accion)] overflow-hidden" data-tooltip-id={TT} data-tooltip-content="Color personalizado">
                                <Palette size={13} className="text-muted-foreground pointer-events-none" />
                                <input type="color" value={swatch} onChange={(e) => set("color", e.target.value)} className="absolute inset-0 opacity-0 cursor-pointer" />
                            </label>
                        </div>
                    </div>
                    <div>
                        <Etiqueta texto="Observaciones" tt={TT} ayuda="Notas internas. Ej.: «auto de la empleada», «sólo fines de semana»." />
                        <textarea value={f.notes} onChange={(e) => set("notes", e.target.value)} rows={3} placeholder="Notas internas (opcional)"
                            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-[13px] outline-none resize-none focus:border-[var(--accion)] focus:ring-2 focus:ring-[color-mix(in_oklab,var(--accion)_25%,transparent)]" />
                    </div>
                </Bloque>
                <Tooltip id={TT} place="top" className="!max-w-[280px] !text-[12px] !rounded-lg !z-[9999]" />
            </CajonContenido>
        </Cajon>
    );
}
