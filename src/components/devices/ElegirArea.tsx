"use client";

import { useMemo, useState } from "react";
import { Check, ChevronDown, FolderTree, Camera } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { SIN_AREA } from "@/lib/filtro-areas";
import { TODAS_LAS_AREAS } from "@/lib/use-filtro-area";
import type { AreaElegible } from "@/components/devices/ElegirCamara";
import { cn } from "@/lib/utils";

/**
 * El filtro de ÁREA de los monitores (LPR, Intrusión): una píldora de la barra que abre el árbol
 * de áreas de Dispositivos, con buscador, sangría por nivel, su color y cuántos equipos de la
 * pantalla caen en cada una. Hermana de ElegirCamara (mismo Popover + Command, mismo aspecto),
 * para elegir un grupo en vez de una cámara. Va con useFiltroArea, que hace el filtrado.
 */
export function ElegirArea({ areas, valor, alElegir, cuenta, sinArea, className, ancho = 280, alinear = "end", compacto, vacio = "Todas las áreas" }: {
    areas: AreaElegible[];
    valor: string;
    alElegir: (v: string) => void;
    /** Cuántos equipos de ESTA pantalla hay en el área (con las de adentro). Sin esto no se muestran números. */
    cuenta?: (area: string) => number;
    /** Si hay equipos sin área en la pantalla: sólo entonces se ofrece «Sin área». */
    sinArea?: boolean;
    className?: string; ancho?: number; alinear?: "start" | "end";
    /** Sólo el ícono hasta que se elige un área (barras apretadas). */
    compacto?: boolean;
    /** Cómo se llama la opción de no elegir ninguna: «Todas las áreas» en un filtro, «Sin área» al asignar una. */
    vacio?: string;
}) {
    const [abierto, setAbierto] = useState(false);
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
    const filtrando = valor !== TODAS_LAS_AREAS;
    const rotulo = !filtrando ? vacio : valor === SIN_AREA ? "Sin área" : areas.find((a) => a.id === valor)?.nombre || "Área";
    const elegir = (v: string) => { alElegir(v); setAbierto(false); };

    return (
        <Popover open={abierto} onOpenChange={setAbierto}>
            <PopoverTrigger asChild>
                <button type="button" aria-label="Filtrar por área" title={filtrando ? `Área: ${valor === SIN_AREA ? "Sin área" : camino.get(valor) || rotulo}` : "Mostrar sólo los equipos de un área de Dispositivos"}
                    className={cn("inline-flex items-center gap-1.5 h-[34px] pl-2.5 pr-2 rounded-lg text-[12px] font-semibold min-w-0 transition-colors",
                        filtrando ? "bg-[var(--accion)] text-white" : "bg-muted/60 text-muted-foreground hover:text-foreground hover:bg-muted", className)}>
                    <FolderTree size={14} className="shrink-0" />
                    {(!compacto || filtrando) && <span className="truncate max-w-[160px]">{rotulo}</span>}
                    <ChevronDown size={13} className="ml-auto opacity-60 shrink-0" />
                </button>
            </PopoverTrigger>
            <PopoverContent align={alinear} className="p-0" style={{ width: ancho }}>
                <Command filter={(v, b) => (v.toLowerCase().includes(b.trim().toLowerCase()) ? 1 : 0)}>
                    {areas.length > 6 && <CommandInput placeholder="Buscar área…" />}
                    <CommandList className="max-h-[360px]">
                        <CommandEmpty>Ningún área se llama así.</CommandEmpty>
                        <CommandGroup>
                            <CommandItem value="__todas todas las areas" onSelect={() => elegir(TODAS_LAS_AREAS)} className="gap-2">
                                <FolderTree size={14} className="text-muted-foreground shrink-0" />
                                <span className="flex-1">{vacio}</span>
                                {!filtrando && <Check size={14} className="text-[var(--accion)] shrink-0" />}
                            </CommandItem>
                        </CommandGroup>
                        <CommandGroup heading="Áreas">
                            {areas.map((a) => {
                                const n = cuenta?.(a.id);
                                return (
                                    <CommandItem key={a.id} value={`${camino.get(a.id)} ${a.id}`} onSelect={() => elegir(a.id)} className="gap-2" style={{ paddingLeft: 8 + a.nivel * 14 }}>
                                        <span className="h-2.5 w-2.5 rounded-[3px] shrink-0" style={{ background: a.color }} />
                                        <span className={cn("min-w-0 flex-1 truncate", n === 0 && "text-muted-foreground")}>{a.nombre}</span>
                                        {n != null && <span className="text-[11px] text-muted-foreground tabular-nums shrink-0">{n}</span>}
                                        {valor === a.id && <Check size={14} className="text-[var(--accion)] shrink-0" />}
                                    </CommandItem>
                                );
                            })}
                            {sinArea && (
                                <CommandItem value="sin area __sin" onSelect={() => elegir(SIN_AREA)} className="gap-2">
                                    <Camera size={13} className="text-muted-foreground shrink-0" />
                                    <span className="flex-1">Sin área</span>
                                    {cuenta && <span className="text-[11px] text-muted-foreground tabular-nums shrink-0">{cuenta(SIN_AREA)}</span>}
                                    {valor === SIN_AREA && <Check size={14} className="text-[var(--accion)] shrink-0" />}
                                </CommandItem>
                            )}
                        </CommandGroup>
                    </CommandList>
                </Command>
            </PopoverContent>
        </Popover>
    );
}
