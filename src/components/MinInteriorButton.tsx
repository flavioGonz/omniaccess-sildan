"use client";

import { useState } from "react";
import { ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { MinInteriorDialog } from "@/components/MinInteriorDialog";
import { normalizarMatricula } from "@/lib/min-interior";

export { MIN_INTERIOR_URL } from "@/lib/min-interior";

/** Botón que abre la consulta asistida de "Matrículas Requeridas" del Min. del Interior
 * dentro de OmniAccess: el guardia resuelve el captcha (humano en el medio) y el sistema
 * muestra el resultado. No automatiza ni resuelve el captcha por software. */
export function MinInteriorButton({
    plate,
    label = false,
    className,
}: {
    plate?: string | null;
    label?: boolean;
    className?: string;
}) {
    const [open, setOpen] = useState(false);
    const p = normalizarMatricula(plate);

    return (
        <>
            <button
                onClick={(e) => { e.stopPropagation(); e.preventDefault(); setOpen(true); }}
                disabled={!p}
                title={p ? `Consultar ${p} en Matrículas Requeridas (Min. Interior)` : "Sin matrícula"}
                className={cn(
                    "inline-flex items-center gap-1.5 rounded-md text-[11px] font-semibold transition-colors disabled:opacity-40",
                    // Es una acción: va en el azul de acción, no en un índigo propio (era el único índigo del sistema).
                    label
                        ? "px-2 py-1 bg-[color-mix(in_oklab,var(--accion)_14%,transparent)] tono-accion hover:bg-[color-mix(in_oklab,var(--accion)_22%,transparent)]"
                        : "p-1 tono-accion hover:bg-[color-mix(in_oklab,var(--accion)_12%,transparent)]",
                    className
                )}
            >
                <ShieldAlert size={14} />
                {label && <span>Min. Interior</span>}
            </button>
            <MinInteriorDialog plate={p} open={open} onOpenChange={setOpen} />
        </>
    );
}
