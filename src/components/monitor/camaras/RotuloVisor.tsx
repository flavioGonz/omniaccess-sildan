"use client";

import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Un aviso sobre el video, con la misma letra que los rótulos de las detecciones: ícono del color
 * de acción, texto blanco con sombra, una línea fina debajo y, si hace falta, una nota.
 *
 * Por qué (13/11, Nico): «Buscando en el NVR» iba en una píldora de vidrio y la nota de «Ver cuándo
 * llegó» salía en un cartel blanco desde abajo (el toast de la app): dos diseños ajenos al de la
 * ventana, que es todo texto sobre la imagen. Ahora los dos son este rótulo, en el centro, y los
 * puntos suspensivos se mueven mientras se espera.
 */
export function RotuloVisor({ Icono, texto, esperando = false, nota, className }: {
    Icono: LucideIcon; texto: string;
    /** Se está esperando algo: los tres puntos se animan (van aparte del texto, que no los lleva). */
    esperando?: boolean;
    /** Una o dos frases debajo, más chicas. */
    nota?: string | null; className?: string;
}) {
    return (
        <div role="status" className={cn("flex flex-col items-center text-center visor-sombra-texto", className)}>
            <span className="inline-flex items-center gap-2.5 text-white text-[20px] font-bold tracking-[-0.01em] leading-none">
                <Icono size={22} className="text-[var(--accion-en-oscuro)]" />
                <span>{texto}{esperando && <span className="puntos-espera" aria-hidden><span>.</span><span>.</span><span>.</span></span>}</span>
            </span>
            <span className="mt-2 h-px w-full min-w-[180px] bg-gradient-to-r from-transparent via-[var(--accion-en-oscuro)] to-transparent opacity-80" />
            {nota && <span className="mt-2 max-w-[460px] text-[13px] font-semibold leading-snug text-white/85">{nota}</span>}
        </div>
    );
}
