"use client";

import { useState } from "react";
import { ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { MinInteriorDialog } from "@/components/MinInteriorDialog";

export const MIN_INTERIOR_URL = "https://matriculas-requeridas.minterior.gub.uy/index.php";
const normPlate = (p?: string | null) => String(p || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

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
    const p = normPlate(plate);

    return (
        <>
            <button
                onClick={(e) => { e.stopPropagation(); e.preventDefault(); setOpen(true); }}
                disabled={!p}
                title={p ? `Consultar ${p} en Matrículas Requeridas (Min. Interior)` : "Sin matrícula"}
                className={cn(
                    "inline-flex items-center gap-1.5 rounded-md text-[11px] font-semibold transition-colors disabled:opacity-40",
                    label
                        ? "px-2 py-1 bg-indigo-600/15 text-indigo-500 hover:bg-indigo-600/25"
                        : "p-1 text-indigo-500 hover:text-indigo-400 hover:bg-indigo-500/10",
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
