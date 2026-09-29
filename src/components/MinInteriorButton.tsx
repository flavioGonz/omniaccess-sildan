"use client";

import { useState } from "react";
import { ShieldAlert, Check } from "lucide-react";
import { cn } from "@/lib/utils";

export const MIN_INTERIOR_URL = "https://matriculas-requeridas.minterior.gub.uy/index.php";
const normPlate = (p?: string | null) => String(p || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

/** Abre la consulta oficial de "Matrículas Requeridas" del Min. del Interior en una pestaña
 * nueva y copia la matrícula al portapapeles para pegarla. El guardia resuelve el CAPTCHA
 * (consulta pública, humano en el medio). No automatiza ni evade nada. */
export async function consultarMinInterior(plate?: string | null): Promise<string> {
    const p = normPlate(plate);
    try { if (p && navigator?.clipboard?.writeText) await navigator.clipboard.writeText(p); } catch { }
    try { window.open(MIN_INTERIOR_URL, "_blank", "noopener,noreferrer"); } catch { }
    return p;
}

export function MinInteriorButton({ plate, label = false, className }: { plate?: string | null; label?: boolean; className?: string }) {
    const [ok, setOk] = useState(false);
    const p = normPlate(plate);
    const onClick = async (e: React.MouseEvent) => {
        e.stopPropagation(); e.preventDefault();
        await consultarMinInterior(p);
        setOk(true); setTimeout(() => setOk(false), 1600);
    };
    return (
        <button
            onClick={onClick}
            disabled={!p}
            title={p ? `Consultar ${p} en Matrículas Requeridas (Min. Interior). Se copia al portapapeles para pegarla.` : "Sin matrícula"}
            className={cn(
                "inline-flex items-center gap-1.5 rounded-md text-[11px] font-semibold transition-colors disabled:opacity-40",
                label ? "px-2 py-1 bg-indigo-600/15 text-indigo-500 hover:bg-indigo-600/25" : "p-1 text-indigo-500 hover:text-indigo-400 hover:bg-indigo-500/10",
                className
            )}
        >
            {ok ? <Check size={14} /> : <ShieldAlert size={14} />}
            {label && <span>{ok ? "Copiada · abrí la pestaña" : "Min. Interior"}</span>}
        </button>
    );
}
