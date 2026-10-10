"use client";

import {
    ScanEye, ScanSearch, Shapes, PersonStanding, Waypoints, Tag, Sparkles, Move, User, Users, Car, PawPrint,
    Backpack, TrafficCone, Sofa, Utensils, Volleyball, Truck, Bike, Bus, TrainFront, Sailboat, Plane, Dog,
    Cat, Bird, Briefcase, Luggage, Umbrella, Smartphone, Shirt, Laptop, Book, Scissors, Baby, Fan, Brush,
    Octagon, FireExtinguisher, ParkingMeter, Armchair, Flower2, Bed, Table, Toilet, Tv, TvMinimal, Mouse,
    Keyboard, Microwave, CookingPot, Bath, Refrigerator, Clock, Flower, Milk, Wine, Coffee, UtensilsCrossed,
    Soup, Banana, Apple, Sandwich, Citrus, Salad, Carrot, Pizza, Donut, Cake, Footprints, MountainSnow, Wind,
    Trophy, Hand, Waves, ShieldCheck, ScanLine, Layers, Type, MessageSquareText, ListVideo, Spline,
    PackageMinus, ArrowLeftRight, Timer, Flame, HardHat, TriangleAlert, Gauge, Cpu, Info, GraduationCap, type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Switch } from "@/components/ui/switch";
import { Chip } from "@/components/ui/estados";
import { CajonSeccion } from "@/components/ui/cajon";
import { CAPACIDADES, CLASE_POR_NOMBRE, type Analitica, type Clase, type EstadoCapacidad, type EstadoAnalitica } from "@/lib/vision-catalogo";

/**
 * Las piezas de las analíticas de OmniVision que usan más de una pantalla: el laboratorio
 * (fichas de clase ↔ analítica) y «Analíticas» (/admin/vision/analiticas). Se movieron desde
 * el laboratorio tal cual; lo agregado es el lugar para una acción (`accion`, `pie`) y que la
 * ficha pueda mostrarse sin el cajón de clases.
 */

export const ICONOS: Record<string, LucideIcon> = {
    ScanEye, ScanSearch, Shapes, PersonStanding, Waypoints, Tag, Sparkles, Move, User, Users, Car, PawPrint, Backpack,
    TrafficCone, Sofa, Utensils, Volleyball, Truck, Bike, Bus, TrainFront, Sailboat, Plane, Dog, Cat, Bird, Briefcase,
    Luggage, Umbrella, Smartphone, Shirt, Laptop, Book, Scissors, Baby, Fan, Brush, Octagon, FireExtinguisher,
    ParkingMeter, Armchair, Flower2, Bed, Table, Toilet, Tv, TvMinimal, Mouse, Keyboard, Microwave, CookingPot, Bath,
    Refrigerator, Clock, Flower, Milk, Wine, Coffee, UtensilsCrossed, Soup, Banana, Apple, Sandwich, Citrus, Salad,
    Carrot, Pizza, Donut, Cake, Footprints, MountainSnow, Wind, Trophy, Hand, Waves, ShieldCheck, ScanLine, Layers,
    Type, MessageSquareText, ListVideo, Spline, PackageMinus, ArrowLeftRight, Timer, Flame, HardHat, TriangleAlert, Gauge, GraduationCap,
};
export function Ic({ n, size = 16, className }: { n: string; size?: number; className?: string }) {
    const C = ICONOS[n] || ScanSearch;
    return <C size={size} className={className} />;
}

export const TONO_CAPACIDAD: Record<EstadoCapacidad, { tono: "bien" | "info" | "aviso" | "quieto"; texto: string }> = {
    corre: { tono: "bien", texto: "Corre hoy" },
    libre: { tono: "info", texto: "Libre · sin instalar" },
    pesado: { tono: "aviso", texto: "Libre · pesado" },
    "no-aplica": { tono: "quieto", texto: "No aplica" },
};
export const TONO_ANALITICA: Record<EstadoAnalitica, { tono: "bien" | "info" | "quieto" | "aviso"; texto: string }> = {
    corre: { tono: "bien", texto: "Corre" },
    desarrollo: { tono: "info", texto: "En desarrollo" },
    posible: { tono: "quieto", texto: "Posible" },
    entrenar: { tono: "aviso", texto: "Hay que entrenar" },
};

export function NotaNoCorre({ a, prendida }: { a: Analitica; prendida: boolean }) {
    if (a.estado === "corre") return null;
    return (
        <span className="text-[11px] text-muted-foreground whitespace-nowrap">
            {prendida ? "prendida · todavía no corre" : "apagada"}
        </span>
    );
}

/** Una analítica en lista: abrirla, prenderla, y (opcional) una acción al lado, como «Crear regla». */
export function FilaAnalitica({ a, prendida, alCambiar, alAbrir, accion }: { a: Analitica; prendida: boolean; alCambiar: (v: boolean) => void; alAbrir: () => void; accion?: React.ReactNode }) {
    const t = TONO_ANALITICA[a.estado];
    return (
        <div className="flex items-center gap-3 px-4 py-3 hover:bg-muted/40">
            <button type="button" onClick={alAbrir} className="flex items-center gap-3 min-w-0 flex-1 text-left">
                <span className={cn("grid h-9 w-9 place-items-center rounded-full shrink-0", prendida ? "bg-[color-mix(in_oklab,var(--accion)_14%,transparent)] text-[var(--accion)]" : "bg-muted text-muted-foreground")}><Ic n={a.icono} size={17} /></span>
                <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 flex-wrap">
                        <span className="text-[13.5px] font-bold">{a.nombre}</span>
                        <span className="text-[11px] text-muted-foreground">{a.modo}</span>
                        <Chip tono={t.tono}>{t.texto}{a.fase ? ` · fase ${a.fase}` : ""}</Chip>
                    </span>
                    <span className="block text-[12px] text-muted-foreground leading-snug mt-0.5 line-clamp-2">{a.queHace}</span>
                </span>
            </button>
            <NotaNoCorre a={a} prendida={prendida} />
            {accion}
            {a.id === "prueba"
                ? <span className="text-[11px] text-muted-foreground w-8 text-center">—</span>
                : <Switch checked={prendida} onCheckedChange={alCambiar} aria-label={`${prendida ? "Apagar" : "Prender"} ${a.nombre}`} />}
        </div>
    );
}

export function FichaAnalitica({ a, prendida, prendidas, alCambiar, alAbrirClase, pie }: {
    a: Analitica; prendida: boolean; prendidas: Record<string, boolean>; alCambiar: (v: boolean) => void;
    /** Sin esto las clases se muestran sin poder abrirlas (fuera del laboratorio no hay ficha de clase). */
    alAbrirClase?: (c: Clase) => void;
    /** Lo que se puede hacer con la analítica fuera de prenderla: crear una regla, ir a su pantalla. */
    pie?: React.ReactNode;
}) {
    const t = TONO_ANALITICA[a.estado];
    const caps = CAPACIDADES.filter((c) => a.necesita.includes(c.id));
    return (
        <>
            <CajonSeccion titulo="" compacta>
                <div className="flex items-start gap-4">
                    <span className="grid h-16 w-16 place-items-center rounded-full bg-muted shrink-0"><Ic n={a.icono} size={30} /></span>
                    <div className="min-w-0 flex-1">
                        <Chip tono={t.tono}>{t.texto}{a.fase ? ` · fase ${a.fase}` : ""}</Chip>
                        <p className="text-[13px] mt-2 leading-snug">{a.queHace}</p>
                        {a.limite && <p className="text-[12px] text-muted-foreground mt-2 flex items-start gap-1.5"><Info size={13} className="mt-0.5 shrink-0" /> {a.limite}</p>}
                    </div>
                </div>
                {a.id !== "prueba" && (
                    <label className="flex items-center justify-between gap-3 rounded-md bg-muted px-3 py-2.5 cursor-pointer">
                        <span>
                            <span className="block text-[13px] font-semibold">{prendida ? "Prendida" : "Apagada"}</span>
                            <span className="block text-[11.5px] text-muted-foreground">
                                {a.estado === "corre" ? "Corre ahora." : "Todavía no corre: se guarda la decisión y se aplica el día que esta analítica exista."}
                            </span>
                        </span>
                        <Switch checked={prendida} onCheckedChange={alCambiar} />
                    </label>
                )}
            </CajonSeccion>
            <CajonSeccion titulo="Necesita" icono={Cpu} compacta>
                <div className="space-y-1.5">
                    {caps.map((c) => (
                        <div key={c.id} className="flex items-center gap-2.5">
                            <Ic n={c.icono} size={15} className="text-muted-foreground" />
                            <span className="text-[13px] font-semibold flex-1">{c.nombre}</span>
                            <Chip tono={TONO_CAPACIDAD[c.estado].tono}>{TONO_CAPACIDAD[c.estado].texto}</Chip>
                        </div>
                    ))}
                </div>
            </CajonSeccion>
            {a.clases.length > 0 && (
                <CajonSeccion titulo="Mira estas clases" icono={ScanSearch} compacta>
                    <div className="flex flex-wrap gap-1.5">
                        {a.clases.map((n) => {
                            const c = CLASE_POR_NOMBRE[n];
                            if (!c) return null;
                            return (
                                <button key={n} type="button" onClick={() => alAbrirClase?.(c)} disabled={!alAbrirClase}
                                    className={cn("inline-flex items-center gap-1.5 h-8 px-2.5 rounded-full border text-[12px] font-semibold enabled:hover:bg-muted", prendidas[n] ? "border-border" : "border-dashed border-border text-muted-foreground")}>
                                    <Ic n={c.icono} size={13} /> {c.nombre}{!prendidas[n] && " (apagada)"}
                                </button>
                            );
                        })}
                    </div>
                </CajonSeccion>
            )}
            {pie && <CajonSeccion titulo="" compacta>{pie}</CajonSeccion>}
        </>
    );
}
