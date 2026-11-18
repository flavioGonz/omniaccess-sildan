"use client";

import { CornerDownRight } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { Funcion } from "@/lib/funciones";
import { cn } from "@/lib/utils";

/**
 * Las dos piezas que comparten «Modos» y «Características»: el interruptor y la fila de una
 * función.
 *
 * Vivían dentro de ModosSection, que era el único lugar donde se prendía algo. El 18/11 las
 * características se mudaron a su propia pantalla (Nico: «que estén todas las built-in features
 * juntas, así las sacamos de Modo de la instalación, que no dependen del modo») y quedaron dos
 * pantallas prendiendo cosas. Copiar el interruptor hubiera sido la forma estándar de que en seis
 * meses haya dos interruptores distintos.
 */

/* ── El interruptor ───────────────────────────────────────────────────────────── */
export function Interruptor({ encendido, ocupado, deshabilitado, onClick, etiqueta }: {
    encendido: boolean; ocupado?: boolean; deshabilitado?: boolean; onClick: () => void; etiqueta: string;
}) {
    return (
        <button
            type="button"
            role="switch"
            aria-checked={encendido}
            aria-label={etiqueta}
            disabled={ocupado || deshabilitado}
            onClick={onClick}
            className={cn(
                "relative h-6 w-11 shrink-0 rounded-full transition-colors duration-200",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accion-foco)] focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                encendido ? "bg-[var(--accion)]" : "bg-muted border border-border",
                (ocupado || deshabilitado) && "opacity-50 cursor-not-allowed",
            )}
        >
            <span className={cn(
                "absolute top-0.5 h-5 w-5 rounded-full bg-background transition-all duration-200",
                encendido ? "left-[22px]" : "left-0.5",
            )} />
        </button>
    );
}


/* ── Una función ──────────────────────────────────────────────────────────────── */
export function FilaFuncion({ f, encendida, ocupada, bloqueada, padre, onToggle, icono: Icono }: {
    f: Funcion; encendida: boolean; ocupada: boolean; bloqueada: boolean; padre?: string; onToggle: () => void;
    /** Las funciones de la instalación llevan su ícono, como las capas. */
    icono?: LucideIcon;
}) {
    return (
        <div className={cn(
            "flex items-start gap-3 px-4 py-3.5",
            // La función que cuelga de otra se indenta y lleva la flechita. Es la única
            // forma de que se vea que no son hermanas sin escribir "depende de" al lado.
            f.requiere && "pl-9",
        )}>
            {f.requiere && <CornerDownRight size={13} className="mt-0.5 shrink-0 text-muted-foreground/60" />}
            {Icono && <Icono size={16} className={cn("mt-0.5 shrink-0", encendida && !bloqueada ? "text-foreground" : "text-muted-foreground")} />}
            <div className="min-w-0 flex-1">
                <div className="text-[13px] font-semibold leading-snug text-foreground">{f.nombre}</div>
                <p className="mt-1 text-[11px] leading-[1.45] text-muted-foreground">{f.que}</p>

                {/* Lo que deja de pasar se dice ANTES de apagar, no después. */}
                {!bloqueada && (
                    <p className="mt-1.5 text-[11px] leading-[1.45] text-muted-foreground">
                        <span className="font-semibold text-foreground/75">Si se apaga:</span> {f.siSeApaga}
                    </p>
                )}

                {/* Y si está bloqueada por su padre, se dice POR QUÉ — no se deja un
                    interruptor gris sin explicación, que es lo que obliga a adivinar. */}
                {bloqueada && (
                    <p className="mt-1.5 text-[11px] leading-[1.45] text-[var(--aviso-texto)]">
                        Necesita «{padre}» prendida{f.id === "LPR_OCUPACION" ? ": sin estadías no hay ocupación que medir" : f.id === "FUNC_ALARMAS_GESTION" ? ": sin recepción no llega ninguna alarma para tratar" : ""}.
                    </p>
                )}
            </div>
            <Interruptor
                encendido={encendida && !bloqueada}
                ocupado={ocupada}
                deshabilitado={bloqueada}
                onClick={onToggle}
                etiqueta={`${encendida ? "Apagar" : "Prender"} ${f.nombre}`}
            />
        </div>
    );
}

