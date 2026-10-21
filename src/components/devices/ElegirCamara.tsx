"use client";

import { useMemo, useState } from "react";
import { Camera, Check, ChevronDown, FolderTree, ScanLine, Sparkles } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { cn } from "@/lib/utils";

/**
 * Elegir una cámara buscando, agrupada por las ÁREAS de Dispositivos (21/10, Nico: «la búsqueda
 * debe buscar; en el desplegable que se vean las áreas existentes»).
 *
 * Era un <Select> con todas las cámaras en una sola lista y sin buscador: con cincuenta cámaras
 * en dos barrios no se encontraba nada. Acá se escribe y filtra por el nombre de la cámara o el
 * de su área («otto» trae todas las de Otto Villa), y las cámaras van en el orden del árbol de
 * áreas, cada grupo con su color, y al final «Sin área».
 *
 * Pieza compartida: sirve para cualquier pantalla que elija una cámara de la lista.
 */
export type CamaraElegible = {
    id: string; nombre: string; tipo?: string; areaId: string | null;
    /** Un aviso corto que va a la derecha (p. ej. «no la mira OmniVision»). */
    nota?: string | null;
};
export type AreaElegible = { id: string; nombre: string; color: string; nivel: number; padre?: string | null };

const ROTULO_TIPO: Record<string, string> = { LPR_CAMERA: "LPR", LPR_INTERIOR: "LPR interior", CAMERA: "Intrusión", QUEUE_COUNTER: "Fila" };
const ICONO_TIPO: Record<string, typeof Camera> = { LPR_CAMERA: ScanLine, LPR_INTERIOR: ScanLine, CAMERA: Camera, QUEUE_COUNTER: Sparkles };

export function ElegirCamara({ camaras, areas, alElegir, valor, placeholder = "Elegir cámara…", titulo, className, ancho = 340, icono: IconoBoton = Camera }: {
    camaras: CamaraElegible[]; areas: AreaElegible[];
    alElegir: (id: string) => void;
    /** La elegida, si el botón tiene que mostrarla. Sin valor el botón muestra el placeholder. */
    valor?: string | null;
    placeholder?: string; titulo?: string; className?: string; ancho?: number; icono?: typeof Camera;
}) {
    const [abierto, setAbierto] = useState(false);
    const elegida = camaras.find((c) => c.id === valor) || null;

    // El camino de cada área («Otto Villa › Portones»): se busca también por él.
    const camino = useMemo(() => {
        const porId = new Map(areas.map((a) => [a.id, a]));
        const m = new Map<string, string>();
        for (const a of areas) {
            const partes: string[] = []; let cur: AreaElegible | undefined = a;
            for (let i = 0; cur && i < 20; i++) { partes.unshift(cur.nombre); cur = cur.padre ? porId.get(cur.padre) : undefined; }
            m.set(a.id, partes.join(" › "));
        }
        return m;
    }, [areas]);

    const grupos = useMemo(() => {
        const existe = new Set(areas.map((a) => a.id));
        const out = areas.map((a) => ({ area: a as AreaElegible | null, camaras: camaras.filter((c) => c.areaId === a.id) })).filter((g) => g.camaras.length);
        const sueltas = camaras.filter((c) => !c.areaId || !existe.has(c.areaId));
        if (sueltas.length) out.push({ area: null, camaras: sueltas });
        return out;
    }, [camaras, areas]);

    return (
        <Popover open={abierto} onOpenChange={setAbierto}>
            <PopoverTrigger asChild>
                <button type="button" aria-label={titulo || placeholder}
                    className={cn("inline-flex items-center gap-2 h-9 pl-2.5 pr-2 rounded-lg border border-border bg-background text-[12.5px] font-medium hover:bg-accent transition-colors min-w-0", className)}>
                    <IconoBoton size={14} className="text-[var(--accion)] shrink-0" />
                    <span className={cn("truncate", !elegida && "text-muted-foreground")}>{elegida ? elegida.nombre : placeholder}</span>
                    <ChevronDown size={13} className="ml-auto opacity-60 shrink-0" />
                </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="p-0" style={{ width: ancho }}>
                <Command filter={(valorItem, busqueda) => (valorItem.toLowerCase().includes(busqueda.trim().toLowerCase()) ? 1 : 0)}>
                    <CommandInput placeholder="Buscar cámara o área…" />
                    <CommandList className="max-h-[360px]">
                        <CommandEmpty>Ninguna cámara ni área se llama así.</CommandEmpty>
                        {grupos.map((g) => (
                            <CommandGroup key={g.area?.id || "_sin"} heading={
                                <span className="flex items-center gap-1.5" style={{ paddingLeft: (g.area?.nivel || 0) * 10 }}>
                                    {g.area ? <span className="h-2.5 w-2.5 rounded-[3px] shrink-0" style={{ background: g.area.color }} /> : <FolderTree size={11} />}
                                    <span className="truncate">{g.area ? camino.get(g.area.id) : "Sin área"}</span>
                                    <span className="ml-auto tabular-nums opacity-70">{g.camaras.length}</span>
                                </span>
                            }>
                                {g.camaras.map((c) => {
                                    const Ico = ICONO_TIPO[c.tipo || ""] || Camera;
                                    return (
                                        // El valor lleva el área: escribir el nombre del área trae sus cámaras.
                                        <CommandItem key={c.id} value={`${c.nombre} ${g.area ? camino.get(g.area.id) : "sin área"} ${c.id}`}
                                            onSelect={() => { alElegir(c.id); setAbierto(false); }} className="gap-2">
                                            <Ico size={14} className="text-muted-foreground shrink-0" />
                                            <span className="min-w-0 flex-1 truncate">{c.nombre}</span>
                                            {c.tipo && ROTULO_TIPO[c.tipo] && <span className="text-[10.5px] text-muted-foreground shrink-0">{ROTULO_TIPO[c.tipo]}</span>}
                                            {c.nota && <span className="text-[10.5px] tono-aviso shrink-0">{c.nota}</span>}
                                            {valor === c.id && <Check size={14} className="text-[var(--accion)] shrink-0" />}
                                        </CommandItem>
                                    );
                                })}
                            </CommandGroup>
                        ))}
                    </CommandList>
                </Command>
            </PopoverContent>
        </Popover>
    );
}
