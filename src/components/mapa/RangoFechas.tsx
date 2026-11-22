"use client";

import { cn } from "@/lib/utils";

/**
 * Un período con fecha y hora de los dos lados: dos campos, y nada más.
 *
 * Son los campos de fecha y hora del propio navegador a propósito: en un teléfono abren el selector
 * del sistema, que es el que la persona ya sabe usar, y con teclado se escriben de corrido. Las
 * horas son las del sitio (las convierte quien recibe el valor, con `limiteDeFiltro`).
 *
 * El «hasta» vacío es «hasta ahora»: se dice en el campo, para que nadie tenga que cargar la hora
 * actual a mano y para que lo que pase mientras tanto siga entrando.
 */
export function RangoFechas({ desde, hasta, alCambiar, error, className }: {
    desde: string; hasta: string;
    alCambiar: (v: { desde: string; hasta: string }) => void;
    error?: string;
    className?: string;
}) {
    const CAMPO = "h-8 min-w-0 flex-1 rounded-[6px] border border-border bg-background px-2 text-[12px] tabular-nums outline-none focus:border-[var(--accion)]";
    return (
        <div className={className}>
            {/* En un cajón angosto los dos campos no entran lado a lado sin cortar la fecha: bajan a dos renglones. */}
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[11.5px] text-muted-foreground">
                <label className="flex min-w-[218px] flex-1 items-center gap-1.5"><span className="w-[38px] shrink-0">Desde</span>
                    <input type="datetime-local" value={desde} max={hasta || undefined} onChange={(e) => alCambiar({ desde: e.target.value, hasta })} className={cn(CAMPO, error && "border-[var(--mal)]")} />
                </label>
                <label className="flex min-w-[218px] flex-1 items-center gap-1.5"><span className="w-[38px] shrink-0">Hasta</span>
                    <input type="datetime-local" value={hasta} min={desde || undefined} onChange={(e) => alCambiar({ desde, hasta: e.target.value })} className={cn(CAMPO, error && "border-[var(--mal)]")} />
                </label>
            </div>
            <p className={cn("mt-1 text-[11px] leading-snug", error ? "tono-mal font-semibold" : "text-muted-foreground")}>
                {error || (!desde && !hasta ? "Elegí desde cuándo. Sin «hasta», llega hasta ahora." : !hasta ? "Sin «hasta»: llega hasta ahora, y lo que pase sigue entrando." : !desde ? "Sin «desde»: desde el primer evento que haya." : "")}
            </p>
        </div>
    );
}
