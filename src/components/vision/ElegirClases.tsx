"use client";

import { useMemo, useState } from "react";
import { Boxes, Check, ChevronDown, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Ic } from "@/components/vision/analiticas";
import { CLASES, CLASE_POR_NOMBRE, GRUPOS, type Grupo } from "@/lib/vision-catalogo";
import { NOMBRE_CLASE_REGLA } from "@/lib/vision-reglas";
import { nombrePropio } from "@/lib/nombres-propios";

/**
 * Qué cuenta una regla: todo lo que reconoce OmniVision, no siete píldoras (16/10, Nico: «acá
 * debemos poner todas las detecciones posibles; no quiero chips feos, que sea premium»).
 *
 * Antes la regla ofrecía personas, autos, camionetas, ómnibus, motos, bicis y perros como
 * píldoras —más las entrenadas acá—, aunque el detector reconoce las 80 clases COCO. Un gato que
 * dispara la perimetral o una valija en el lobby no se podían elegir.
 *
 * Ahora es un campo como los otros del cajón: muestra lo elegido con sus íconos y, al abrirlo, el
 * catálogo entero por grupos (el mismo de Analíticas › clases), con buscador. Primero lo entrenado
 * acá; en cada grupo lo que importa a un barrio, y lo raro (una banana, un secador) plegado en
 * «N más» para que no tape lo útil.
 */

export type ClasePropia = { clase: string; nombre: string };

/** El nombre de una clase, sea COCO o del detector propio. */
export function nombreClase(c: string): string {
    return CLASE_POR_NOMBRE[c]?.nombre || NOMBRE_CLASE_REGLA[c] || nombrePropio(c) || c;
}

function Icono({ clase, size = 15 }: { clase: string; size?: number }) {
    const k = CLASE_POR_NOMBRE[clase];
    return k ? <Ic n={k.icono} size={size} /> : <Boxes size={size} />;
}

export function ElegirClases({ valor, alCambiar, propias, excluir = [], vacio = "Elegí qué cuenta" }: {
    valor: string[]; alCambiar: (v: string[]) => void; propias: ClasePropia[];
    /** Grupos que no tienen sentido para la regla (en «objeto retirado», personas y animales). */
    excluir?: Grupo[]; vacio?: string;
}) {
    const [abierto, setAbierto] = useState(false);
    const [buscar, setBuscar] = useState("");
    const [abiertos, setAbiertos] = useState<Set<string>>(new Set());
    const q = buscar.trim().toLowerCase();
    const coincide = (nombre: string, clase: string) => !q || nombre.toLowerCase().includes(q) || clase.includes(q);
    const alternar = (c: string) => alCambiar(valor.includes(c) ? valor.filter((x) => x !== c) : [...valor, c]);
    const elegidas = valor;

    const secciones = useMemo(() => {
        const out: { id: string; nombre: string; icono: React.ReactNode; items: { clase: string; nombre: string; poco: boolean }[] }[] = [];
        if (propias.length) out.push({ id: "propio", nombre: "Entrenado acá", icono: <Boxes size={13} />, items: propias.map((p) => ({ clase: p.clase, nombre: p.nombre, poco: false })) });
        for (const g of GRUPOS) {
            if (excluir.includes(g.id)) continue;
            const items = CLASES.filter((c) => c.grupo === g.id)
                .sort((a, b) => ["clave", "util", "poco"].indexOf(a.relevancia) - ["clave", "util", "poco"].indexOf(b.relevancia))
                .map((c) => ({ clase: c.clase, nombre: c.nombre, poco: c.relevancia === "poco" }));
            out.push({ id: g.id, nombre: g.nombre, icono: <Ic n={g.icono} size={13} />, items });
        }
        return out;
    }, [propias, excluir]);

    const resumen = elegidas.map(nombreClase);
    return (
        <Popover open={abierto} onOpenChange={(o) => { setAbierto(o); if (!o) setBuscar(""); }}>
            <PopoverTrigger asChild>
                <button type="button" className="w-full min-h-11 rounded-[8px] border border-border bg-background px-2.5 py-1.5 flex items-center gap-2.5 text-left hover:bg-accent/40 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accion)]/40">
                    {elegidas.length > 0 && (
                        <span className="flex -space-x-1.5 shrink-0">
                            {elegidas.slice(0, 4).map((c) => (
                                <span key={c} className="grid h-7 w-7 place-items-center rounded-[7px] bg-[color-mix(in_oklab,var(--accion)_14%,var(--background))] text-[var(--accion)] ring-2 ring-background"><Icono clase={c} size={14} /></span>
                            ))}
                        </span>
                    )}
                    <span className="min-w-0 flex-1">
                        <span className={cn("block text-[13px] font-semibold truncate", !elegidas.length && "text-muted-foreground font-normal")}>
                            {elegidas.length ? resumen.slice(0, 3).join(", ") + (resumen.length > 3 ? ` y ${resumen.length - 3} más` : "") : vacio}
                        </span>
                        {elegidas.length > 0 && <span className="block text-[11px] text-muted-foreground">{elegidas.length} {elegidas.length === 1 ? "clase" : "clases"} · sólo eso dispara la regla</span>}
                    </span>
                    <ChevronDown size={15} className={cn("shrink-0 text-muted-foreground transition-transform", abierto && "rotate-180")} />
                </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="p-0 w-[min(480px,92vw)] overflow-hidden">
                <div className="flex items-center gap-2 px-3 h-11 border-b border-border">
                    <Search size={14} className="text-muted-foreground shrink-0" />
                    <input autoFocus value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder={`Buscar entre ${CLASES.length + propias.length} cosas que reconoce OmniVision`}
                        className="flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground" />
                    {elegidas.length > 0 && <button type="button" onClick={() => alCambiar([])} className="text-[11.5px] font-semibold text-muted-foreground hover:text-foreground">Limpiar</button>}
                </div>
                <div className="max-h-[min(440px,60vh)] overflow-y-auto py-1.5">
                    {secciones.map((s) => {
                        const vis = s.items.filter((i) => coincide(i.nombre, i.clase));
                        if (!vis.length) return null;
                        const desplegada = !!q || abiertos.has(s.id);
                        const mostrar = desplegada ? vis : vis.filter((i) => !i.poco || elegidas.includes(i.clase));
                        const ocultas = vis.length - mostrar.length;
                        const n = s.items.filter((i) => elegidas.includes(i.clase)).length;
                        const todas = n === s.items.length;
                        return (
                            <section key={s.id} className="px-1.5 pb-1">
                                <div className="flex items-center gap-1.5 px-2 pt-2 pb-1 text-[11px] text-muted-foreground">
                                    {s.icono}
                                    <span className="font-semibold text-foreground/80">{s.nombre}</span>
                                    {n > 0 && <span className="tabular-nums text-[var(--accion)] font-semibold">{n}</span>}
                                    {!q && (
                                        <button type="button" onClick={() => alCambiar(todas ? elegidas.filter((c) => !s.items.some((i) => i.clase === c)) : [...new Set([...elegidas, ...s.items.filter((i) => !i.poco || s.id === "propio").map((i) => i.clase)])])}
                                            className="ml-auto font-semibold hover:text-foreground">{todas ? "Ninguna" : "Las comunes"}</button>
                                    )}
                                </div>
                                <div className="grid grid-cols-2 gap-0.5">
                                    {mostrar.map((i) => {
                                        const on = elegidas.includes(i.clase);
                                        return (
                                            <button key={i.clase} type="button" onClick={() => alternar(i.clase)} aria-pressed={on}
                                                className={cn("flex items-center gap-2 rounded-[7px] px-2 h-9 text-left transition-colors", on ? "bg-[color-mix(in_oklab,var(--accion)_10%,transparent)]" : "hover:bg-accent")}>
                                                <span className={cn("grid h-6 w-6 place-items-center rounded-[6px] shrink-0 transition-colors", on ? "bg-[var(--accion)] text-white" : "bg-muted text-muted-foreground")}>
                                                    {s.id === "propio" ? <Boxes size={13} /> : <Icono clase={i.clase} size={13} />}
                                                </span>
                                                <span className={cn("min-w-0 flex-1 truncate text-[12.5px]", on ? "font-semibold" : "text-foreground/85")}>{i.nombre}</span>
                                                {on && <Check size={13} className="shrink-0 text-[var(--accion)]" />}
                                            </button>
                                        );
                                    })}
                                </div>
                                {ocultas > 0 && (
                                    <button type="button" onClick={() => setAbiertos((x) => new Set([...x, s.id]))} className="ml-2 mt-0.5 text-[11.5px] font-semibold text-muted-foreground hover:text-foreground">
                                        {ocultas} más, menos comunes
                                    </button>
                                )}
                            </section>
                        );
                    })}
                </div>
                <div className="flex items-center gap-2 px-3 h-11 border-t border-border">
                    <span className="flex-1 text-[11.5px] text-muted-foreground">{elegidas.length ? `${elegidas.length} elegida${elegidas.length === 1 ? "" : "s"}` : "Ninguna elegida"}</span>
                    <button type="button" onClick={() => setAbierto(false)} className="h-8 px-3 rounded-md bg-[var(--accion)] text-white text-[12.5px] font-semibold">Listo</button>
                </div>
            </PopoverContent>
        </Popover>
    );
}
