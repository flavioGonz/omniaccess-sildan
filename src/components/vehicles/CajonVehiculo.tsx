"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import type { User } from "@prisma/client";
import {
    Bike, Bus, Car, Check, ChevronDown, FileText, Hash, Loader2, Palette,
    Plus, Save, Truck, User as UserIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Cajon, CajonDisparador, CajonContenido, CajonSeccion, CajonCampo } from "@/components/ui/cajon";
import { Pista } from "@/components/ui/pista";
import { createVehicle, updateVehicle } from "@/app/actions/vehicles";
import { getCarLogo, VEHICLE_BRANDS } from "@/lib/car-logos";
import { cn } from "@/lib/utils";
import { sileo as toast } from "sileo";

/**
 * La ficha de un vehículo, en un cajón.
 *
 * Venía de un diálogo centrado de 3xl. El mismo motivo que en el resto: un diálogo es para
 * una pregunta corta que se contesta y se cierra; esto es trabajar sobre algo, y la lista
 * de vehículos tiene que seguir del otro lado —se carga uno, se cierra, se abre el
 * siguiente.
 *
 * Lo único que se conservó tal cual es la **previsualización en vivo**, y ahora va fija en
 * el encabezado en vez de hacer scroll con el formulario. Es la regla de la casa: la
 * matrícula es el producto. Mientras se escribe, lo que hay que tener a la vista es cómo
 * va quedando la chapa, no los campos.
 */

/**
 * Colores de vehículo, con su hex.
 *
 * Estos SÍ son literales a propósito y no salen de las variables del tema: no son colores
 * de la interfaz, son el dato —de qué color es el auto—. Un bordó es un bordó en modo
 * claro y en modo oscuro.
 */
const COLORES = [
    { nombre: "Blanco", hex: "#F8FAFC", claro: true },
    { nombre: "Negro", hex: "#0A0A0A", claro: false },
    { nombre: "Gris", hex: "#6B7280", claro: false },
    { nombre: "Plata", hex: "#C0C0C0", claro: true },
    { nombre: "Rojo", hex: "#DC2626", claro: false },
    { nombre: "Azul", hex: "#2563EB", claro: false },
    { nombre: "Verde", hex: "#16A34A", claro: false },
    { nombre: "Bordó", hex: "#7F1D1D", claro: false },
    { nombre: "Beige", hex: "#E7DCC3", claro: true },
    { nombre: "Amarillo", hex: "#EAB308", claro: true },
];

const CLASES = [
    { valor: "SEDAN", rotulo: "Sedán", icono: Car },
    { valor: "SUV", rotulo: "SUV", icono: Car },
    { valor: "PICKUP", rotulo: "Pick-up", icono: Truck },
    { valor: "MOTORCYCLE", rotulo: "Moto", icono: Bike },
    { valor: "TRUCK", rotulo: "Camión", icono: Truck },
    { valor: "BUS", rotulo: "Ómnibus", icono: Bus },
];

const hexDe = (nombre: string) => {
    const p = COLORES.find((c) => c.nombre.toLowerCase() === (nombre || "").toLowerCase());
    if (p) return p.hex;
    return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(nombre || "") ? nombre : "#3F3F46";
};

export function CajonVehiculo({ users, vehicle, trigger, onSuccess }: {
    users: User[];
    vehicle?: any;
    trigger?: React.ReactNode;
    onSuccess?: () => void;
}) {
    const [abierto, setAbierto] = useState(false);
    const [guardando, setGuardando] = useState(false);
    const [abreMarcas, setAbreMarcas] = useState(false);
    const [abreTitular, setAbreTitular] = useState(false);
    const [f, setF] = useState({
        plate: "", brand: "", model: "", color: "", notes: "", userId: "", type: "SEDAN",
    });

    const esEdicion = !!vehicle;
    const logo = getCarLogo(f.brand);
    const muestra = hexDe(f.color);
    const titular = users.find((u) => u.id === f.userId);

    /* El formulario arranca en el vehículo que se abrió, y se rearma al reabrir: sin esto,
       cerrar una edición a medias dejaba los datos ahí para la siguiente. */
    useEffect(() => {
        if (!abierto) return;
        setF({
            plate: vehicle?.plate || "", brand: vehicle?.brand || "", model: vehicle?.model || "",
            color: vehicle?.color || "", notes: vehicle?.notes || "",
            userId: vehicle?.userId || "", type: vehicle?.type || "SEDAN",
        });
        setGuardando(false);
    }, [abierto, vehicle]);

    const guardar = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!f.plate.trim()) {
            toast.error({ title: "Falta la matrícula", description: "Es lo que leen las cámaras: sin eso el vehículo no es nadie." });
            return;
        }
        setGuardando(true);
        try {
            const r = esEdicion ? await updateVehicle(vehicle.id, f) : await createVehicle(f);
            /**
             * Antes esto no se miraba. Las dos acciones devuelven `{ success }` y, cuando
             * daba false —una matrícula repetida, por ejemplo—, el diálogo se cerraba igual
             * con cara de haber guardado. El vehículo no quedaba en ningún lado y nadie se
             * enteraba hasta buscarlo en la lista.
             */
            if (!r?.success) {
                toast.error({
                    title: "No se pudo guardar",
                    description: (r as any)?.error || "El servidor lo rechazó. Fijate si esa matrícula ya está cargada.",
                });
                return;
            }
            toast.success({ title: esEdicion ? "Vehículo guardado" : "Vehículo registrado" });
            setAbierto(false);
            onSuccess?.();
        } catch (err: any) {
            toast.error({ title: "No se pudo guardar", description: err?.message });
        } finally {
            setGuardando(false);
        }
    };

    return (
        <Cajon open={abierto} onOpenChange={setAbierto}>
            <CajonDisparador asChild>
                {trigger || <Button><Plus size={16} /> Registrar vehículo</Button>}
            </CajonDisparador>

            <CajonContenido
                ancho="medio"
                titulo={esEdicion ? f.plate || "Vehículo" : "Nuevo vehículo"}
                descripcion="Cuál es, qué es y de quién es."
                /* La previsualización va FIJA arriba y no hace scroll con los campos: la
                   matrícula es lo que se está creando, y lo que se está creando no se
                   pierde de vista mientras se lo escribe. */
                encabezado={
                    <div className="px-6 py-4 flex items-center gap-3.5 bg-card/40">
                        <div className="w-11 h-11 rounded-[10px] bg-muted border border-border flex items-center justify-center p-1.5 shrink-0">
                            {logo ? <Image src={logo} alt="" width={30} height={30} className="object-contain opacity-80" />
                                : <Car size={18} className="text-muted-foreground" />}
                        </div>
                        <div className="min-w-0 flex-1">
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-md bg-white border-b-2 border-[#003399]">
                                <span className="text-[17px] font-bold tracking-[0.18em] tabular-nums text-black">
                                    {f.plate || "———"}
                                </span>
                            </span>
                            <p className="text-[11.5px] text-muted-foreground mt-1 truncate">
                                {[f.brand, f.model].filter(Boolean).join(" · ") || "Sin marca ni modelo"}
                                {titular ? ` — ${titular.name}` : ""}
                            </p>
                        </div>
                        <div className="flex flex-col items-center gap-1 shrink-0">
                            <span className="w-7 h-7 rounded-full border border-border" style={{ backgroundColor: muestra }} />
                            <span className="text-[10px] text-muted-foreground">{f.color || "color"}</span>
                        </div>
                    </div>
                }
                pie={
                    <>
                        <Button type="button" variant="ghost" onClick={() => setAbierto(false)}>Cancelar</Button>
                        <Button type="submit" form="ficha-vehiculo" disabled={guardando}>
                            {guardando ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                            {guardando ? "Guardando…" : esEdicion ? "Guardar cambios" : "Registrar"}
                        </Button>
                    </>
                }>

                <form id="ficha-vehiculo" onSubmit={guardar} noValidate>
                    <CajonSeccion titulo="Cuál es" icono={Hash}>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <CajonCampo etiqueta="Matrícula"
                                pista="Se guarda en mayúsculas y sin espacios ni guiones, como la leen las cámaras. Es lo único que no se puede cambiar después sin romper el historial del vehículo.">
                                <Input value={f.plate} placeholder="ABC1234" autoFocus
                                    onChange={(e) => setF({ ...f, plate: e.target.value.toUpperCase().replace(/\s/g, "") })}
                                    className="font-bold tracking-[0.12em] tabular-nums uppercase" />
                            </CajonCampo>
                            <CajonCampo etiqueta="Qué clase de vehículo"
                                pista="No cambia si abre o no la barrera. Sirve para reconocerlo en el historial cuando la foto no ayuda, y para los informes por tipo.">
                                <Select value={f.type} onValueChange={(v) => setF({ ...f, type: v })}>
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        {CLASES.map((c) => (
                                            <SelectItem key={c.valor} value={c.valor}>
                                                <span className="flex items-center gap-2">
                                                    <c.icono size={14} className="text-muted-foreground" /> {c.rotulo}
                                                </span>
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </CajonCampo>
                        </div>
                    </CajonSeccion>

                    <CajonSeccion titulo="Cómo es" icono={Car}>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <CajonCampo etiqueta="Marca">
                                <Popover open={abreMarcas} onOpenChange={setAbreMarcas}>
                                    <PopoverTrigger asChild>
                                        <Button type="button" variant="outline" className="w-full justify-between font-normal">
                                            <span className="flex items-center gap-2 min-w-0">
                                                {logo && <Image src={logo} alt="" width={17} height={17} className="object-contain shrink-0" />}
                                                <span className="truncate">{f.brand || "Elegir marca…"}</span>
                                            </span>
                                            <ChevronDown size={14} className="opacity-50 shrink-0" />
                                        </Button>
                                    </PopoverTrigger>
                                    <PopoverContent className="w-[260px] p-0" align="start">
                                        <Command>
                                            <CommandInput placeholder="Buscar marca…" />
                                            <CommandList>
                                                <CommandEmpty>Ninguna marca se llama así.</CommandEmpty>
                                                <CommandGroup>
                                                    {VEHICLE_BRANDS.map((b) => {
                                                        const l = getCarLogo(b.label);
                                                        return (
                                                            <CommandItem key={b.label}
                                                                onSelect={() => { setF({ ...f, brand: b.label }); setAbreMarcas(false); }}>
                                                                <span className="flex items-center gap-2">
                                                                    {l ? <Image src={l} alt="" width={16} height={16} className="object-contain" />
                                                                        : <Car size={14} className="text-muted-foreground" />}
                                                                    {b.label}
                                                                </span>
                                                                {f.brand === b.label && <Check size={14} className="ml-auto text-[var(--accion)]" />}
                                                            </CommandItem>
                                                        );
                                                    })}
                                                </CommandGroup>
                                            </CommandList>
                                        </Command>
                                    </PopoverContent>
                                </Popover>
                            </CajonCampo>
                            <CajonCampo etiqueta="Modelo">
                                <Input value={f.model} placeholder="Corolla, Hilux…"
                                    onChange={(e) => setF({ ...f, model: e.target.value })} />
                            </CajonCampo>
                        </div>

                        <div>
                            <span className="flex items-center gap-1.5 text-[12px] font-medium text-foreground/85 mb-2">
                                <Palette size={13} className="text-muted-foreground/70" /> Color
                            </span>
                            <div className="flex items-center gap-1.5 flex-wrap">
                                {COLORES.map((c) => {
                                    const puesto = f.color === c.nombre;
                                    return (
                                        <Pista key={c.nombre} texto={c.nombre} lado="arriba" ancho={120} demora={120}>
                                            <button type="button" onClick={() => setF({ ...f, color: c.nombre })}
                                                aria-label={c.nombre}
                                                className={cn(
                                                    "relative w-8 h-8 rounded-full border transition-transform duration-150 hover:scale-110",
                                                    puesto ? "border-transparent ring-2 ring-[var(--accion)] ring-offset-2 ring-offset-background"
                                                        : "border-border",
                                                )}
                                                style={{ backgroundColor: c.hex }}>
                                                {puesto && <Check size={13} className={cn("absolute inset-0 m-auto", c.claro ? "text-black" : "text-white")} />}
                                            </button>
                                        </Pista>
                                    );
                                })}
                                <label className="relative w-8 h-8 rounded-full border border-dashed border-border flex items-center justify-center cursor-pointer hover:border-[var(--accion)] transition-colors overflow-hidden"
                                    title="Otro color">
                                    <Plus size={13} className="text-muted-foreground pointer-events-none" />
                                    <input type="color" value={muestra} className="absolute inset-0 opacity-0 cursor-pointer"
                                        onChange={(e) => setF({ ...f, color: e.target.value })} />
                                </label>
                                <Input value={f.color} placeholder="o escribilo" className="h-8 w-36 text-[12px] ml-1"
                                    onChange={(e) => setF({ ...f, color: e.target.value })} />
                            </div>
                        </div>
                    </CajonSeccion>

                    <CajonSeccion titulo="De quién es" icono={UserIcon}>
                        <CajonCampo etiqueta="Titular"
                            pista="Es a quien se le avisa cuando este vehículo entra o sale, y de quién cuelga el vehículo en el padrón. Se puede dejar sin titular: queda cargado igual y se le asigna después.">
                            <Popover open={abreTitular} onOpenChange={setAbreTitular}>
                                <PopoverTrigger asChild>
                                    <Button type="button" variant="outline" className="w-full justify-between font-normal">
                                        <span className="truncate">{titular?.name || "Sin titular"}</span>
                                        <ChevronDown size={14} className="opacity-50 shrink-0" />
                                    </Button>
                                </PopoverTrigger>
                                {/* Con buscador y no una lista al hilo: un barrio con doscientos
                                    residentes vuelve inusable un desplegable plano. */}
                                <PopoverContent className="w-[300px] p-0" align="start">
                                    <Command>
                                        <CommandInput placeholder="Buscar por nombre…" />
                                        <CommandList>
                                            <CommandEmpty>Nadie se llama así.</CommandEmpty>
                                            <CommandGroup>
                                                <CommandItem onSelect={() => { setF({ ...f, userId: "" }); setAbreTitular(false); }}>
                                                    <span className="text-muted-foreground">Sin titular</span>
                                                    {!f.userId && <Check size={14} className="ml-auto text-[var(--accion)]" />}
                                                </CommandItem>
                                                {users.map((u) => (
                                                    <CommandItem key={u.id} value={u.name || u.id}
                                                        onSelect={() => { setF({ ...f, userId: u.id }); setAbreTitular(false); }}>
                                                        {u.name}
                                                        {f.userId === u.id && <Check size={14} className="ml-auto text-[var(--accion)]" />}
                                                    </CommandItem>
                                                ))}
                                            </CommandGroup>
                                        </CommandList>
                                    </Command>
                                </PopoverContent>
                            </Popover>
                        </CajonCampo>
                    </CajonSeccion>

                    <CajonSeccion titulo="Algo más que anotar" icono={FileText}>
                        <CajonCampo etiqueta="Observaciones"
                            pista="Queda para adentro: lo ve el guardia y el administrador, nunca el titular. Sirve para lo que no entra en ningún campo — que el auto tiene un vidrio roto, que lo maneja el hijo, que el titular avisó que lo vende.">
                            <Textarea value={f.notes} placeholder="Opcional" className="h-20 resize-none"
                                onChange={(e) => setF({ ...f, notes: e.target.value })} />
                        </CajonCampo>
                    </CajonSeccion>
                </form>
            </CajonContenido>
        </Cajon>
    );
}
