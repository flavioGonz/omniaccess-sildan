"use client";

import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * El camino del detector propio, de un vistazo: en qué paso se está y qué falta para el
 * siguiente. La pantalla tiene cinco partes (clases, fotos, dibujo, entrenamiento, uso) y sin
 * esto no se sabía por dónde empezar ni qué se esperaba de cada una.
 *
 * Tonos: hecho = bien (es un estado), el paso actual = el azul de acción (es lo que hay que
 * hacer), lo que viene = apagado.
 */
export type PasoCamino = { titulo: string; detalle: string; hecho: boolean; ancla: string };

export function CaminoDetector({ pasos }: { pasos: PasoCamino[] }) {
    const actual = pasos.findIndex((p) => !p.hecho);
    return (
        <nav aria-label="Pasos" className="rounded-[10px] border border-border bg-card p-3">
            <ol className="grid grid-cols-1 sm:grid-cols-5 gap-2">
                {pasos.map((p, i) => {
                    const ahora = i === actual;
                    return (
                        <li key={p.titulo}>
                            <a href={`#${p.ancla}`} className={cn("h-full flex items-start gap-2.5 rounded-[8px] px-2.5 py-2 transition-colors hover:bg-accent", ahora && "bg-[color-mix(in_oklab,var(--accion)_8%,transparent)]")}>
                                <span className={cn("grid place-items-center h-7 w-7 rounded-full text-[12px] font-bold tabular-nums shrink-0",
                                    p.hecho ? "pleno-bien" : ahora ? "bg-[var(--accion)] text-white" : "bg-muted text-muted-foreground")}>
                                    {p.hecho ? <Check size={14} strokeWidth={3} /> : i + 1}
                                </span>
                                <span className="min-w-0">
                                    <span className={cn("block text-[13px] font-bold leading-tight", !p.hecho && !ahora && "text-muted-foreground")}>{p.titulo}</span>
                                    <span className="block text-[11.5px] text-muted-foreground leading-snug mt-0.5">{p.detalle}</span>
                                </span>
                            </a>
                        </li>
                    );
                })}
            </ol>
        </nav>
    );
}
