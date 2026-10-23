"use client";

import { cn } from "@/lib/utils";
import { COMPORTAMIENTOS, type ClaveComportamiento, type ParamsComportamiento } from "@/lib/comportamientos";
import { EscenaComportamiento } from "@/components/vision/EscenaComportamiento";

/**
 * «Cómo lo detectó»: la escena animada del comportamiento y, debajo, cómo decide con los números
 * de la regla (lib/comportamientos). Va en la ficha del evento (oscura, sobre la foto), en Gestión
 * de alarmas y en el asistente de reglas.
 */
export function ComoFunciona({ clave, params = {}, oscuro, sinTitulo, className }: {
    clave: ClaveComportamiento; params?: ParamsComportamiento; oscuro?: boolean; sinTitulo?: boolean; className?: string;
}) {
    const c = COMPORTAMIENTOS[clave];
    return (
        <div className={cn("space-y-2", className)}>
            <EscenaComportamiento clave={clave} />
            {!sinTitulo && <div className={cn("text-[12.5px] font-semibold", oscuro ? "text-white" : "text-foreground")}>{c.que}</div>}
            <ol className="space-y-1.5">
                {c.como(params).map((t, i) => (
                    <li key={i} className={cn("flex gap-2 text-[12px] leading-snug", oscuro ? "text-white/70" : "text-muted-foreground")}>
                        <span className={cn("grid place-items-center w-4 h-4 rounded-full text-[9.5px] font-bold shrink-0 mt-px tabular-nums", oscuro ? "bg-white/12 text-white/80" : "bg-muted text-foreground/70")}>{i + 1}</span>
                        <span>{t}</span>
                    </li>
                ))}
            </ol>
        </div>
    );
}
