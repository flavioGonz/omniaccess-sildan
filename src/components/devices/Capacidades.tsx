"use client";

import { ScanLine, Radar, SquareDashed, AlertTriangle, CircleSlash } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Capacidades } from "@/lib/capacidades-camara";

/**
 * Lo que la cámara dijo que sabe hacer (lib/capacidades-camara), en chips: ANPR, cruce de línea,
 * zona. Lo que no tiene no se muestra —salvo que no tenga nada, que también es un dato—, y si no
 * se le pudo preguntar se dice por qué en vez de callarlo.
 */
export function ChipsCapacidades({ c, chico, className }: { c: Capacidades | null | undefined; chico?: boolean; className?: string }) {
    if (!c) return null;
    const base = cn("inline-flex items-center gap-1 rounded-full border font-semibold whitespace-nowrap", chico ? "h-5 px-1.5 text-[10px]" : "h-6 px-2 text-[11px]");
    const t = chico ? 10 : 12;
    if (c.error === "clave") return <span className={cn(base, "chip-aviso", className)} title="La cámara rechaza la clave: no se le pudo preguntar qué sabe hacer"><AlertTriangle size={t} /> Clave rechazada</span>;
    if (c.error === "sin-red" && c.fuente === "nada") return <span className={cn(base, "chip-quieto", className)} title="No contestó: no se sabe qué sabe hacer"><AlertTriangle size={t} /> No contesta</span>;
    const chips: React.ReactNode[] = [];
    if (c.anpr) chips.push(<span key="anpr" className={cn(base, "chip-info")} title={c.fuente === "modelo" ? "Por el modelo: es una cámara de tránsito" : "La cámara tiene ANPR: lee matrículas sola"}><ScanLine size={t} /> ANPR</span>);
    if (c.cruceLinea) chips.push(<span key="linea" className={cn(base, "chip-quieto")} title="Tiene cruce de línea (Smart / AcuSense)"><Radar size={t} /> Cruce de línea</span>);
    if (c.zona) chips.push(<span key="zona" className={cn(base, "chip-quieto")} title="Tiene intrusión por zona (Smart / AcuSense)"><SquareDashed size={t} /> Zona</span>);
    if (!chips.length && c.anpr === false && c.cruceLinea === false && c.zona === false)
        chips.push(<span key="nada" className={cn(base, "chip-quieto")} title="No tiene ANPR ni analítica: sirve para video y para que la mire OmniVision"><CircleSlash size={t} /> Sin ANPR ni analítica</span>);
    if (!chips.length) return null;
    return <span className={cn("inline-flex flex-wrap items-center gap-1", className)}>{chips}</span>;
}
