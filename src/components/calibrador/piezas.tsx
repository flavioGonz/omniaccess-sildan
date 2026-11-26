"use client";

import { useState } from "react";
import { Info, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Forma, Herramienta, Pt } from "@/components/calibrador/Lienzo";

/**
 * Las piezas del panel del calibrador único (26/11): una sección con su ícono y su ayuda, una
 * elección en píldoras, un deslizador con su valor y la tarjeta de un elemento dibujado. Una sola
 * versión de cada una, para que los tres módulos se lean igual.
 *
 * El calibrador es siempre oscuro: se trabaja sobre video y una barra clara al lado encandila.
 */

/** Lo que cada módulo le entrega al calibrador. */
export type HerramientaDock = { key: string; label: string; icono: React.ComponentType<{ size?: number; className?: string; style?: React.CSSProperties }>; color: string; herramienta?: Herramienta; accion?: () => void; deshabilitado?: string | false; ayuda: string };
export type Modulo = {
    disponible: boolean; motivo?: string;
    formas: Forma[]; seleccion: string | null; setSeleccion: (id: string | null) => void;
    herramienta: string | null; setHerramienta: (k: string | null) => void;
    dock: HerramientaDock[];
    alCrear: (tipo: "poligono" | "linea" | "rect", puntos: Pt[]) => void;
    alCambiar: (id: string, c: { puntos?: Pt[]; flecha?: { a: Pt; b: Pt } | null }) => void;
    alBorrar?: (id: string) => void;
    /** Encima de la escena, debajo del lienzo: guías (los puntos de lecturas), el lente. */
    capa?: React.ReactNode;
    panel: React.ReactNode;
    sucio: boolean; guardando: boolean;
    guardar?: () => Promise<void>; revertir?: () => void;
    /** Qué dice el botón de guardar («Guardar en la cámara» tarda; que se sepa). */
    rotuloGuardar?: string;
};

export function Seccion({ titulo, icono: I, ayuda, children, accion, plegable, cerrada }: { titulo: string; icono: React.ComponentType<{ size?: number; className?: string }>; ayuda?: string; children: React.ReactNode; accion?: React.ReactNode; plegable?: boolean; cerrada?: boolean }) {
    const [abierta, setAbierta] = useState(!cerrada);
    const ver = !plegable || abierta;
    return (
        <section className="border-b border-white/[0.07] px-5 py-4 last:border-0">
            <div className={cn("flex items-center gap-2", ver && "mb-3")}>
                <span className="grid h-6 w-6 place-items-center rounded-md bg-white/[0.06] text-white/60"><I size={13} /></span>
                {plegable
                    ? <button type="button" onClick={() => setAbierta((v) => !v)} className="flex flex-1 items-center gap-2 text-left text-[10.5px] font-bold uppercase tracking-[0.14em] text-white/55 hover:text-white/80">{titulo}<ChevronDown size={13} className={cn("ml-auto transition-transform", abierta && "rotate-180")} /></button>
                    : <h3 className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-white/55">{titulo}</h3>}
                {ayuda && <span title={ayuda} className="cursor-help text-white/35 hover:text-white/70"><Info size={12} /></span>}
                {accion && !plegable && <div className="ml-auto">{accion}</div>}
            </div>
            {ver && <div className="space-y-3">{children}</div>}
        </section>
    );
}

export function Pildoras<T extends string>({ valor, opciones, cambiar, color = "#ffffff", deshabilitado }: { valor: T | null; opciones: { v: T; t: string; icono?: React.ComponentType<{ size?: number }>; ayuda?: string }[]; cambiar: (v: T) => void; color?: string; deshabilitado?: boolean }) {
    return (
        <div className={cn("grid gap-1 rounded-full bg-white/[0.05] p-1", deshabilitado && "pointer-events-none opacity-50")} style={{ gridTemplateColumns: `repeat(${opciones.length}, minmax(0, 1fr))` }}>
            {opciones.map((o) => {
                const on = o.v === valor;
                return (
                    <button key={o.v} type="button" title={o.ayuda} onClick={() => cambiar(o.v)}
                        className={cn("inline-flex h-7 items-center justify-center gap-1 truncate rounded-full px-2 text-[11.5px] font-bold transition-colors", on ? "text-black" : "text-white/70 hover:bg-white/[0.07] hover:text-white")}
                        style={on ? { background: color } : undefined}>
                        {o.icono && <o.icono size={12} />}{o.t}
                    </button>
                );
            })}
        </div>
    );
}

export function Deslizador({ etiqueta, valor, min, max, paso, formato, cambiar, ayuda, color = "#38bdf8" }: { etiqueta: string; valor: number; min: number; max: number; paso: number; formato: (v: number) => string; cambiar: (v: number) => void; ayuda?: string; color?: string }) {
    const pct = ((valor - min) / (max - min)) * 100;
    return (
        <label className="block">
            <span className="mb-1.5 flex items-center gap-1.5 text-[12px] font-semibold text-white/80">
                {etiqueta}{ayuda && <span title={ayuda} className="cursor-help text-white/35"><Info size={11} /></span>}
                <span className="ml-auto tabular-nums text-white">{formato(valor)}</span>
            </span>
            <input type="range" min={min} max={max} step={paso} value={valor} onChange={(e) => cambiar(Number(e.target.value))}
                className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-white/10 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-[0_0_0_3px_rgba(0,0,0,0.35)]"
                style={{ background: `linear-gradient(to right, ${color} ${pct}%, rgba(255,255,255,0.1) ${pct}%)` }} />
        </label>
    );
}

/** Un elemento dibujado, en la lista: color, nombre, qué es y su estado. */
export function TarjetaElemento({ color, nombre, detalle, elegido, apagado, alElegir, extra }: { color: string; nombre: string; detalle: string; elegido: boolean; apagado?: boolean; alElegir: () => void; extra?: React.ReactNode }) {
    return (
        <button type="button" onClick={alElegir}
            className={cn("group flex w-full items-center gap-2.5 rounded-[10px] border px-2.5 py-2 text-left transition-colors", elegido ? "border-white/25 bg-white/[0.09]" : "border-transparent hover:bg-white/[0.05]")}>
            <span className={cn("h-7 w-1.5 shrink-0 rounded-full", apagado && "opacity-40")} style={{ background: color }} />
            <span className="min-w-0 flex-1">
                <span className={cn("block truncate text-[12.5px] font-semibold", apagado ? "text-white/50" : "text-white")}>{nombre}</span>
                <span className="block truncate text-[11px] text-white/45">{detalle}</span>
            </span>
            {extra}
        </button>
    );
}

export function Vacio({ children }: { children: React.ReactNode }) {
    return <p className="rounded-[10px] border border-dashed border-white/12 px-3 py-3 text-[12px] leading-snug text-white/50">{children}</p>;
}

export function BotonPanel({ children, onClick, deshabilitado, peligro, primario, className, title }: { children: React.ReactNode; onClick?: () => void; deshabilitado?: boolean; peligro?: boolean; primario?: boolean; className?: string; title?: string }) {
    return (
        <button type="button" onClick={onClick} disabled={deshabilitado} title={title}
            className={cn("inline-flex h-8 items-center justify-center gap-1.5 rounded-[6px] px-3 text-[12px] font-semibold transition-colors disabled:opacity-40",
                primario ? "bg-[var(--accion)] text-white hover:brightness-110" : peligro ? "bg-red-500/12 text-red-300 hover:bg-red-500/20" : "bg-white/[0.07] text-white/85 hover:bg-white/[0.12]", className)}>
            {children}
        </button>
    );
}
