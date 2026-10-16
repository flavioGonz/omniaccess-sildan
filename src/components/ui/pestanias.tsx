"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Pestañas con ícono y un indicador que se desliza a la elegida (16/10, Nico: «iconografía en
 * las tabs, leve pero premium transiciones entre tabs»).
 *
 * Es la misma superficie que los grupos de Filtros (bg-muted, 34 px), con dos agregados: el
 * ícono, que hace reconocible la pestaña sin leerla, y la píldora blanca que viaja de una a
 * otra en vez de aparecer de golpe —el ojo sigue el cambio—. La cuenta va al lado, en su tono
 * cuando dice algo (alarmas sin atender en rojo).
 */
export type Pestania<T extends string> = {
    valor: T; rotulo: string; icono: React.ComponentType<{ size?: number; className?: string }>;
    cuenta?: number; tono?: "mal" | "aviso"; ayuda?: string;
};

export function Pestanias<T extends string>({ valor, opciones, alElegir, className }: { valor: T; opciones: Pestania<T>[]; alElegir: (v: T) => void; className?: string }) {
    const caja = useRef<HTMLDivElement>(null);
    const botones = useRef<Record<string, HTMLButtonElement | null>>({});
    const [ind, setInd] = useState<{ left: number; width: number } | null>(null);
    useLayoutEffect(() => {
        const medir = () => {
            const b = botones.current[valor];
            if (b) setInd({ left: b.offsetLeft, width: b.offsetWidth });
        };
        medir();
        const ro = new ResizeObserver(medir);
        if (caja.current) ro.observe(caja.current);
        return () => ro.disconnect();
    }, [valor, opciones.map((o) => `${o.valor}${o.cuenta ?? ""}`).join("|")]); // eslint-disable-line react-hooks/exhaustive-deps

    return (
        <div ref={caja} role="tablist" className={cn("relative flex items-center h-[38px] rounded-[10px] bg-muted/60 p-[3px] w-fit max-w-full overflow-x-auto [scrollbar-width:none]", className)}>
            {ind && (
                <span aria-hidden className="absolute top-[3px] bottom-[3px] rounded-[8px] bg-background ring-1 ring-border/60 transition-[left,width] duration-300 ease-[cubic-bezier(0.2,0.8,0.2,1)]"
                    style={{ left: ind.left, width: ind.width }} />
            )}
            {opciones.map((o) => {
                const on = o.valor === valor;
                const I = o.icono;
                return (
                    <button key={o.valor} ref={(el) => { botones.current[o.valor] = el; }} type="button" role="tab" aria-selected={on} title={o.ayuda}
                        onClick={() => alElegir(o.valor)}
                        className={cn("relative z-[1] h-full px-3 rounded-[8px] inline-flex items-center gap-1.5 text-[12.5px] font-semibold whitespace-nowrap transition-colors duration-200",
                            on ? "text-foreground" : "text-muted-foreground hover:text-foreground")}>
                        <I size={14} className={cn("transition-colors duration-200", on && (o.tono === "mal" ? "tono-mal" : o.tono === "aviso" ? "tono-aviso" : "text-[var(--accion)]"))} />
                        {o.rotulo}
                        {o.cuenta != null && (
                            <span className={cn("tabular-nums text-[11.5px]", o.tono === "mal" && o.cuenta > 0 ? "tono-mal font-bold" : o.tono === "aviso" && o.cuenta > 0 ? "tono-aviso" : "opacity-60")}>{o.cuenta}</span>
                        )}
                    </button>
                );
            })}
        </div>
    );
}
