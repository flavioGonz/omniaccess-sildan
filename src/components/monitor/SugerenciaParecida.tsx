"use client";

import { useState } from "react";
import { Check, Sparkles, X } from "lucide-react";
import { sileo as toast } from "sileo";
import { cn } from "@/lib/utils";
import { setEventPlate } from "@/app/actions/history";
import type { DelPadron } from "@/app/actions/matriculas-parecidas";
import type { Parecida } from "@/lib/chapas-parecidas";

/**
 * «¿Es SDH6448?» debajo de una lectura que no es de nadie (26/11, Nico: «a veces un carácter no se
 * detecta bien: tenemos que poder buscar las más parecidas y sugerir el auto correcto»).
 *
 * La sugerencia sale del padrón (lib/chapas-parecidas pesa las confusiones del OCR: 8/B, 0/O…) y
 * sólo aparece cuando hay UNA candidata clara. Se marca qué carácter cambia, para que el guardia lo
 * compare con la foto. No corrige sola: corregir pide un segundo toque, y entonces el acceso se
 * reevalúa como con «Cargar matrícula».
 */

const ROL: Record<string, string> = { RESIDENT: "Residente", STAFF: "Personal", PROVIDER: "Proveedor", VISITOR: "Visita", TEMPORARY_VISITOR: "Visita", WHITELISTED: "Residente" };

/** La chapa con los caracteres que cambian marcados. */
export function ChapaMarcada({ plate, distintas, className }: { plate: string; distintas: number[]; className?: string }) {
    return (
        <span className={cn("font-mono font-bold tracking-wider", className)}>
            {[...plate].map((c, i) => <span key={i} className={distintas.includes(i) ? "rounded-[3px] bg-[color-mix(in_oklab,var(--aviso)_30%,transparent)] px-px" : undefined}>{c}</span>)}
        </span>
    );
}

export function SugerenciaParecida({ eventId, sug, alCorregir }: { eventId: string; sug: Parecida<DelPadron>; alCorregir: (r: { plate: string; decision: string }) => void }) {
    const [confirmar, setConfirmar] = useState(false);
    const [guardando, setGuardando] = useState(false);
    const quien = [sug.nombre, ROL[sug.rol] || null, sug.unidad].filter(Boolean).join(" · ");
    const parar = (e: React.SyntheticEvent) => e.stopPropagation();
    return (
        <span onClick={parar} onPointerDown={parar} className="mt-1 inline-flex max-w-full flex-wrap items-center gap-1.5 rounded-[6px] border border-[color-mix(in_oklab,var(--accion)_35%,transparent)] bg-[color-mix(in_oklab,var(--accion)_6%,transparent)] px-1.5 py-0.5 text-[10.5px]">
            <Sparkles size={11} className="shrink-0 text-[var(--accion)]" />
            <span className="text-muted-foreground">¿Es</span>
            <ChapaMarcada plate={sug.plate} distintas={sug.distintas} className="text-[11px] text-foreground" />
            <span className="text-muted-foreground">?</span>
            <span className="truncate text-blue-400" title={quien}>{quien}</span>
            {confirmar ? (
                <span className="inline-flex items-center gap-1">
                    <button type="button" disabled={guardando} onClick={async () => {
                        setGuardando(true);
                        try {
                            const r = await setEventPlate(eventId, sug.plate);
                            if (!r.ok) { toast.error({ title: "No se pudo corregir", description: r.error }); return; }
                            toast.success({ title: `Corregida a ${sug.plate}`, description: r.decision === "GRANT" ? "Es del padrón: el acceso quedó permitido." : "Se reevaluó el acceso." });
                            alCorregir({ plate: sug.plate, decision: r.decision });
                        } finally { setGuardando(false); setConfirmar(false); }
                    }} className="inline-flex h-5 items-center gap-0.5 rounded-[4px] bg-[var(--accion)] px-1.5 font-bold text-white disabled:opacity-60"><Check size={10} /> Corregir</button>
                    <button type="button" onClick={() => setConfirmar(false)} className="grid h-5 w-5 place-items-center rounded-[4px] text-muted-foreground hover:bg-accent" aria-label="No"><X size={10} /></button>
                </span>
            ) : (
                <button type="button" onClick={() => setConfirmar(true)} className="font-bold text-[var(--accion)] hover:underline" title="Corregir la lectura a esta matrícula del padrón">Usar esta</button>
            )}
        </span>
    );
}
