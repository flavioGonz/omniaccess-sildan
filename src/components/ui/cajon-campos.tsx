"use client";

import { useState } from "react";
import { Info, X } from "lucide-react";
import { CajonCerrar } from "@/components/ui/cajon";
import { cn } from "@/lib/utils";

/**
 * Piezas de los cajones de alta/edición (mismo lenguaje que la ficha de Dispositivos):
 * etiqueta con ayuda en react-tooltip, campo con ícono, bloque con título e ícono y una
 * cabecera «héroe» oscura con el título adentro y el cerrar flotante.
 * El tooltip lo monta cada cajón: <Tooltip id={tt} />.
 */

export function Etiqueta({ texto, ayuda, tt = "tt-cajon" }: { texto: string; ayuda?: string; tt?: string }) {
    return (
        <span className="flex items-center gap-1.5 text-[12px] font-semibold text-foreground/85 mb-1.5">
            {texto}
            {ayuda && <span data-tooltip-id={tt} data-tooltip-content={ayuda} className="inline-grid place-items-center text-muted-foreground/60 hover:text-[var(--accion)] cursor-help"><Info size={12.5} /></span>}
        </span>
    );
}

export function Campo({ etiqueta, ayuda, icono: I, value, onChange, placeholder, tipo = "text", mono, autoFocus, className, tt, mayus }: {
    etiqueta: string; ayuda?: string; icono: any; value: string; onChange: (v: string) => void; placeholder?: string;
    tipo?: string; mono?: boolean; autoFocus?: boolean; className?: string; tt?: string; mayus?: boolean;
}) {
    return (
        <label className={cn("block", className)}>
            <Etiqueta texto={etiqueta} ayuda={ayuda} tt={tt} />
            <span className="relative block">
                <I size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                <input type={tipo} value={value} onChange={(e) => onChange(mayus ? e.target.value.toUpperCase() : e.target.value)} placeholder={placeholder} autoFocus={autoFocus}
                    className={cn("h-10 w-full rounded-lg border border-border bg-background pl-9 pr-3 text-[13px] outline-none transition-shadow placeholder:text-muted-foreground/60",
                        "focus:border-[var(--accion)] focus:ring-2 focus:ring-[color-mix(in_oklab,var(--accion)_25%,transparent)]", mono && "font-mono tracking-wide")} />
            </span>
        </label>
    );
}

export function Bloque({ titulo, icono: I, ayuda, children, accion, tt = "tt-cajon" }: { titulo: string; icono: any; ayuda?: string; children: React.ReactNode; accion?: React.ReactNode; tt?: string }) {
    return (
        <section className="px-6 py-5 border-b border-border last:border-0">
            <div className="flex items-center gap-2 mb-4">
                <span className="grid h-7 w-7 place-items-center rounded-md bg-muted/70 text-muted-foreground"><I size={14} /></span>
                <h3 className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">{titulo}</h3>
                {ayuda && <span data-tooltip-id={tt} data-tooltip-content={ayuda} className="text-muted-foreground/60 hover:text-[var(--accion)] cursor-help"><Info size={12.5} /></span>}
                {accion && <div className="ml-auto">{accion}</div>}
            </div>
            <div className="space-y-4">{children}</div>
        </section>
    );
}

/** Cabecera oscura de borde a borde, fija arriba al hacer scroll, con el título adentro. */
export function Heroe({ titulo, subtitulo, chips, children, fondo, alto = "min-h-[180px]" }: {
    titulo: string; subtitulo?: string; chips?: React.ReactNode; children?: React.ReactNode; fondo?: string; alto?: string;
}) {
    return (
        <div className="sticky top-0 z-20 pb-3 bg-background">
            <div className={cn("relative w-full overflow-hidden rounded-b-2xl shadow-[0_10px_30px_-12px_rgba(0,0,0,0.6)] text-white", alto,
                fondo || "bg-[radial-gradient(120%_120%_at_0%_0%,#1e293b_0%,#0b0f17_55%,#000_100%)]")}>
                <span className="absolute inset-0 opacity-[0.07] bg-[linear-gradient(transparent_95%,#fff_95%),linear-gradient(90deg,transparent_95%,#fff_95%)] bg-[size:22px_22px] pointer-events-none" />
                <div className="relative px-5 pt-4 pb-4 flex flex-col gap-3 h-full">
                    <div className="flex items-start gap-3">
                        <div className="min-w-0 flex-1">
                            <h2 className="text-[19px] font-bold leading-tight truncate">{titulo}</h2>
                            {subtitulo && <p className="text-[12px] text-white/70 truncate">{subtitulo}</p>}
                            {chips && <div className="flex items-center gap-1.5 mt-2 flex-wrap">{chips}</div>}
                        </div>
                        <CajonCerrar className="shrink-0 h-9 w-9 rounded-full bg-white/10 hover:bg-white/20 backdrop-blur-md grid place-items-center ring-1 ring-white/15 transition-colors" aria-label="Cerrar"><X size={17} /></CajonCerrar>
                    </div>
                    {children}
                </div>
            </div>
        </div>
    );
}

export const chipHeroe = "inline-flex items-center gap-1 h-6 px-2 rounded-md bg-white/10 backdrop-blur-md text-white text-[10.5px] font-bold ring-1 ring-white/10";

/** Lista con buscador y casillas (para elegir usuarios o equipos). */
export function ListaElegible<T extends { id: string }>({ items, elegidos, onCambiar, render, buscar, placeholder, vacio, alto = "max-h-72" }: {
    items: T[]; elegidos: Set<string>; onCambiar: (s: Set<string>) => void; render: (x: T) => React.ReactNode;
    buscar: (x: T) => string; placeholder: string; vacio?: string; alto?: string;
}) {
    const [q, setQ] = useState("");
    const [soloElegidos, setSoloElegidos] = useState(false);
    const t = q.trim().toLowerCase();
    const vis = items.filter((x) => (!t || buscar(x).toLowerCase().includes(t)) && (!soloElegidos || elegidos.has(x.id)));
    const alternar = (id: string) => { const n = new Set(elegidos); n.has(id) ? n.delete(id) : n.add(id); onCambiar(n); };
    return (
        <div className="rounded-xl border border-border overflow-hidden">
            <div className="flex items-center gap-2 p-2 border-b border-border bg-card/50">
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder}
                    className="h-8 flex-1 rounded-md border border-border bg-background px-2.5 text-[12.5px] outline-none focus:border-[var(--accion)]" />
                <button type="button" onClick={() => setSoloElegidos(!soloElegidos)}
                    className={cn("h-8 px-2.5 rounded-md text-[11px] font-bold border transition-colors", soloElegidos ? "border-[var(--accion)] bg-[color-mix(in_oklab,var(--accion)_10%,transparent)]" : "border-border hover:bg-accent")}>
                    {elegidos.size} elegidos
                </button>
                {vis.length > 0 && (
                    <button type="button" onClick={() => { const n = new Set(elegidos); const todos = vis.every((x) => n.has(x.id)); vis.forEach((x) => (todos ? n.delete(x.id) : n.add(x.id))); onCambiar(n); }}
                        className="h-8 px-2.5 rounded-md text-[11px] font-semibold border border-border hover:bg-accent">{vis.every((x) => elegidos.has(x.id)) ? "Ninguno" : "Todos"}</button>
                )}
            </div>
            <div className={cn("overflow-y-auto divide-y divide-border/50", alto)}>
                {vis.length === 0 ? <p className="p-4 text-center text-[12px] text-muted-foreground">{vacio || "Nada coincide."}</p> : vis.map((x) => (
                    <label key={x.id} className={cn("flex items-center gap-3 px-3 py-2 cursor-pointer transition-colors", elegidos.has(x.id) ? "bg-[color-mix(in_oklab,var(--accion)_6%,transparent)]" : "hover:bg-accent/50")}>
                        <input type="checkbox" checked={elegidos.has(x.id)} onChange={() => alternar(x.id)} className="h-4 w-4 accent-[var(--accion)]" />
                        <span className="min-w-0 flex-1">{render(x)}</span>
                    </label>
                ))}
            </div>
        </div>
    );
}
