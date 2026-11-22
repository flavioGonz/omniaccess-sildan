"use client";

import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { diasConMovimientoGps } from "@/app/actions/gps";
import { paraInput } from "@/lib/fechas";
import { cn } from "@/lib/utils";

/**
 * Elegir un día del recorrido sin escribir fechas, y viendo de antemano cuáles tienen algo que
 * mirar: debajo de cada día en que el vehículo anduvo hay un punto, más grande cuanto más anduvo.
 *
 * La semana empieza en lunes, como se la piensa acá. Los días por venir no se pueden elegir.
 */
const DIAS = ["L", "M", "M", "J", "V", "S", "D"];
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "setiembre", "octubre", "noviembre", "diciembre"];
/** Menos reportes en movimiento que esto es acomodar el auto en el garage, no un día con viajes. */
const ANDUVO = 6;
const ANDUVO_MUCHO = 180;

/** El mes que se muestra al abrir: el de hoy, en el sitio. Fuera del componente porque mira el reloj. */
const mesDeHoy = () => paraInput(new Date()).slice(0, 7);
const hoyDelSitio = () => paraInput(new Date());

export function CalendarioGps({ imei, elegido, alElegir, className }: { imei: string; elegido: string | null; alElegir: (dia: string) => void; className?: string }) {
    const [mes, setMes] = useState(() => (elegido ? elegido.slice(0, 7) : mesDeHoy()));
    /* La respuesta guarda de qué mes es: al pasar de mes no se ven los puntos del anterior. */
    const [traido, setTraido] = useState<{ de: string; dias: Record<string, number> } | null>(null);
    useEffect(() => {
        let vivo = true;
        diasConMovimientoGps(imei, mes).then((dias) => { if (vivo) setTraido({ de: `${imei}|${mes}`, dias }); }).catch(() => { if (vivo) setTraido({ de: `${imei}|${mes}`, dias: {} }); });
        return () => { vivo = false; };
    }, [imei, mes]);
    const dias = traido?.de === `${imei}|${mes}` ? traido.dias : null;
    const [a, m] = mes.split("-").map(Number);
    const hoy = hoyDelSitio();
    /* Cuántos días tiene el mes y en qué día de la semana cae el 1 (0 = lunes). Con UTC a propósito:
       es aritmética de calendario, no un instante. */
    const cuantos = new Date(Date.UTC(a, m, 0)).getUTCDate(), corrido = (new Date(Date.UTC(a, m - 1, 1)).getUTCDay() + 6) % 7;
    const mover = (d: number) => { const x = new Date(Date.UTC(a, m - 1 + d, 1)); setMes(`${x.getUTCFullYear()}-${String(x.getUTCMonth() + 1).padStart(2, "0")}`); };

    return (
        <div className={cn("w-[212px] shrink-0", className)}>
            <div className="flex items-center gap-1">
                <button type="button" onClick={() => mover(-1)} aria-label="Mes anterior" className="grid h-6 w-6 place-items-center rounded-[6px] text-muted-foreground hover:bg-accent"><ChevronLeft size={13} /></button>
                <p className="flex-1 text-center text-[12px] font-bold capitalize">{MESES[m - 1]} {a}</p>
                <button type="button" onClick={() => mover(1)} disabled={mes >= hoy.slice(0, 7)} aria-label="Mes siguiente" className="grid h-6 w-6 place-items-center rounded-[6px] text-muted-foreground hover:bg-accent disabled:opacity-30"><ChevronRight size={13} /></button>
            </div>
            <div className="mt-1 grid grid-cols-7 gap-y-0.5 text-center" role="grid" aria-label={`${MESES[m - 1]} ${a}`}>
                {DIAS.map((d, i) => <span key={i} className="text-[9px] font-bold text-muted-foreground" aria-hidden>{d}</span>)}
                {Array.from({ length: corrido }, (_, i) => <span key={`v${i}`} />)}
                {Array.from({ length: cuantos }, (_, i) => {
                    const dia = `${mes}-${String(i + 1).padStart(2, "0")}`, n = dias?.[dia] || 0, futuro = dia > hoy, es = dia === elegido;
                    return (
                        <button key={dia} type="button" disabled={futuro} onClick={() => alElegir(dia)} aria-pressed={es}
                            title={futuro ? undefined : n >= ANDUVO ? "Ese día anduvo" : dias ? "Ese día no anduvo" : undefined}
                            className={cn("relative mx-auto grid h-7 w-7 place-items-center rounded-full text-[11.5px] tabular-nums", es ? "bg-foreground font-bold text-background" : futuro ? "text-muted-foreground/40" : "hover:bg-accent", dia === hoy && !es && "font-bold text-[var(--accion)]")}>
                            {i + 1}
                            {n >= ANDUVO && <span className={cn("absolute bottom-[2px] rounded-full", n >= ANDUVO_MUCHO ? "h-[5px] w-[5px]" : "h-[3px] w-[3px]", es ? "bg-background" : "bg-[var(--bien)]")} />}
                        </button>
                    );
                })}
            </div>
        </div>
    );
}
