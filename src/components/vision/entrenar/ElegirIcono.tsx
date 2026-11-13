"use client";

import { useRef, useState } from "react";
import { ChevronDown, Loader2, Upload } from "lucide-react";
import { sileo as toast } from "sileo";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ICONOS_CLASE, ICONO_MAX_BYTES } from "@/lib/detector-propio";
import { IconoClase } from "@/components/vision/iconos-clase";

/**
 * El ícono de una clase entrenada: el que se ve al lado de su nombre en el vivo (12/11, Nico:
 * «permití subirle un ícono o seleccionar uno»). Todas salían con el mismo, el de «objeto propio»,
 * y con tres clases en un cuadro no se distinguían sin leer.
 *
 * Elegir uno de la lista cambia el valor y se guarda con el resto de la clase. Subir una imagen
 * la guarda en el momento (el servidor la achica y la deja como PNG): no hay un «archivo
 * pendiente» que se pierda si después se cancela.
 */
export function ElegirIcono({ claseId, valor, alCambiar }: { claseId: string; valor: string | null; alCambiar: (v: string | null) => void }) {
    const [abierto, setAbierto] = useState(false);
    const [subiendo, setSubiendo] = useState(false);
    const archivo = useRef<HTMLInputElement>(null);

    async function subir(f: File | undefined) {
        if (!f) return;
        if (f.size > ICONO_MAX_BYTES) { toast.error({ title: "La imagen pesa más de 1 MB", description: "Para un ícono alcanza con una chica." }); return; }
        setSubiendo(true);
        try {
            const r = await fetch(`/api/vision/objetos/${claseId}/icono`, { method: "POST", headers: { "content-type": f.type || "image/png" }, body: f });
            const j = await r.json().catch(() => ({}));
            if (!r.ok) throw new Error(j?.error || `El servidor respondió ${r.status}`);
            alCambiar(j.icono); setAbierto(false);
            toast.success({ title: "Ícono subido", description: "Ya quedó puesto: se ve en el vivo en unos segundos." });
        } catch (e: any) { toast.error({ title: "No se subió", description: e?.message }); }
        finally { setSubiendo(false); }
    }

    return (
        <Popover open={abierto} onOpenChange={setAbierto}>
            <PopoverTrigger asChild>
                <button type="button" aria-label="Elegir el ícono" title="El ícono que se ve al lado del nombre en el vivo"
                    className="h-8 pl-2 pr-1.5 rounded-md border border-border inline-flex items-center gap-1 hover:bg-accent/50">
                    <IconoClase icono={valor} size={16} /><ChevronDown size={12} className="text-muted-foreground" />
                </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-[292px] p-3 space-y-3">
                <div className="grid grid-cols-6 gap-1">
                    {ICONOS_CLASE.map(([clave, nombre]) => (
                        <button key={clave} type="button" title={nombre} aria-label={nombre} aria-pressed={valor === clave} onClick={() => { alCambiar(clave); setAbierto(false); }}
                            className={cn("grid h-10 w-10 place-items-center rounded-md transition-colors", valor === clave ? "bg-[var(--accion)] text-white" : "text-muted-foreground hover:bg-accent hover:text-foreground")}>
                            <IconoClase icono={clave} size={18} />
                        </button>
                    ))}
                </div>
                <div className="flex items-center gap-2 border-t border-border pt-3">
                    <button type="button" disabled={subiendo} onClick={() => archivo.current?.click()}
                        className="h-8 px-2.5 rounded-md border border-border text-[12px] font-semibold inline-flex items-center gap-1.5 hover:bg-accent/50 disabled:opacity-50">
                        {subiendo ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />} Subir una imagen
                    </button>
                    {valor && <button type="button" onClick={() => { alCambiar(null); setAbierto(false); }} className="ml-auto text-[12px] font-semibold text-[var(--accion)] hover:underline">Volver al de siempre</button>}
                </div>
                <p className="text-[11px] text-muted-foreground leading-snug">PNG o SVG, mejor con fondo transparente y en blanco: se dibuja chico, sobre el video.</p>
                <input ref={archivo} type="file" accept="image/png,image/svg+xml,image/webp,image/jpeg" className="hidden" onChange={(e) => { subir(e.target.files?.[0]); e.target.value = ""; }} />
            </PopoverContent>
        </Popover>
    );
}
