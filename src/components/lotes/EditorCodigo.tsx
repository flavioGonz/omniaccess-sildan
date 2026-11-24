"use client";

import { useState } from "react";
import { Check, Pencil, RefreshCw, X } from "lucide-react";
import { Girando as Loader2 } from "@/components/brand/CargaOmni";
import { sileo as toast } from "sileo";
import { cn } from "@/lib/utils";
import { cambiarCodigoCenso } from "@/app/actions/administraciones";

/**
 * El código del censo de una persona, y cómo cambiarlo.
 *
 * Pedido de Nico (21/11): «poder editar los códigos de censo de cada lote manualmente».
 *
 * Se ve como texto y se edita en el lugar —un lápiz, el campo, guardar—, sin abrir otra ventana:
 * es UN dato corto, y quien lo cambia suele cambiar varios seguidos.
 *
 * Dos cosas que el campo dice antes de guardar, porque después ya es tarde:
 *  · si el código tiene letras o números que se confunden al dictarlo (O y 0, I y 1, S y 5…). Se
 *    avisa y se deja: la administración puede querer justamente «LOTE-0215»;
 *  · si a esa persona ya se le mandó el correo, que el enlace que tiene deja de servir.
 *
 * `confunden` viene calculado de afuera para no traer acá la librería de claves, que usa
 * `node:crypto` y no puede entrar al navegador.
 */
const SE_CONFUNDEN = "O0I1LS5Z2";

export function EditorCodigo({ invitacionId, clave, yaEnviado, alCambiar, className }: {
    invitacionId: string; clave: string;
    /** A esta persona ya le salió el correo con el código actual. */
    yaEnviado?: boolean;
    alCambiar: (nueva: string) => void;
    className?: string;
}) {
    const [editando, setEditando] = useState(false);
    const [valor, setValor] = useState(clave);
    const [guardando, setGuardando] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const limpio = valor.toUpperCase().replace(/[^A-Z0-9]/g, "");
    const raros = [...new Set(limpio.split("").filter((c) => SE_CONFUNDEN.includes(c)))];
    const largoMal = limpio.length > 0 && (limpio.length < 6 || limpio.length > 12);

    async function guardar(nueva: string | null) {
        setGuardando(true); setError(null);
        try {
            const r = await cambiarCodigoCenso(invitacionId, nueva);
            if (!r.ok) { setError(r.error); return; }
            setEditando(false);
            if (r.igual) return;
            alCambiar(r.clave);
            toast.success({ title: "Código cambiado", description: r.habiaSalido ? "El correo que ya tenía dejó de servir: quedó para enviárselo de nuevo." : "Todavía no se le había enviado: va a salir con el nuevo." });
        } catch (e) { setError(e instanceof Error ? e.message : "No se pudo guardar."); }
        finally { setGuardando(false); }
    }

    if (!editando) return (
        <span className={cn("inline-flex items-center gap-1.5", className)}>
            <span className="text-[13px] font-bold tabular-nums tracking-[0.08em]">{clave}</span>
            <button type="button" title="Cambiar el código" onClick={() => { setValor(clave); setError(null); setEditando(true); }}
                className="grid h-6 w-6 place-items-center rounded-[6px] text-muted-foreground hover:bg-accent hover:text-foreground"><Pencil size={11} /></button>
        </span>
    );
    return (
        <span className={cn("block", className)}>
            <form className="flex flex-wrap items-center gap-1.5" onSubmit={(e) => { e.preventDefault(); if (!largoMal && limpio) guardar(valor); }}>
                <input autoFocus value={valor} onChange={(e) => { setValor(e.target.value.toUpperCase()); setError(null); }} disabled={guardando} maxLength={16} spellCheck={false} aria-label="Código del censo"
                    onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); setEditando(false); } }}
                    className="h-8 w-[150px] rounded-[6px] border border-border bg-background px-2 text-[13px] font-bold tabular-nums tracking-[0.08em] outline-none focus:border-[var(--accion)]" />
                <button type="submit" disabled={guardando || largoMal || !limpio} title="Guardar" className="grid h-8 w-8 place-items-center rounded-[6px] bg-[var(--accion)] text-white disabled:opacity-40">
                    {guardando ? <Loader2 size={13} className="animate-spin" /> : <Check size={14} strokeWidth={3} />}
                </button>
                <button type="button" disabled={guardando} title="Cancelar" onClick={() => setEditando(false)} className="grid h-8 w-8 place-items-center rounded-[6px] border border-border text-muted-foreground hover:bg-accent"><X size={13} /></button>
                <button type="button" disabled={guardando} onClick={() => guardar(null)} className="inline-flex h-8 items-center gap-1 rounded-[6px] px-2 text-[11.5px] font-semibold text-muted-foreground hover:bg-accent hover:text-foreground">
                    <RefreshCw size={11} /> Generar otro
                </button>
            </form>
            {error ? <p className="mt-1 text-[11.5px] leading-snug tono-mal">{error}</p>
                : largoMal ? <p className="mt-1 text-[11.5px] leading-snug tono-aviso">Entre 6 y 12 letras o números. Los espacios y guiones no cuentan.</p>
                    : (
                        <p className="mt-1 text-[11.5px] leading-snug text-muted-foreground">
                            {raros.length > 0 && <>Tiene {raros.join(", ")}: al dictarlo o copiarlo se {raros.length === 1 ? "confunde" : "confunden"} (O con 0, I con 1, S con 5, Z con 2). Se puede usar igual. </>}
                            {yaEnviado && <span className="tono-aviso">Ya se le envió el correo: el enlace que tiene deja de servir y queda para enviárselo de nuevo.</span>}
                        </p>
                    )}
        </span>
    );
}
