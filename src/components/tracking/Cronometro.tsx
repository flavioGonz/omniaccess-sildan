"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * El cronómetro de una estadía.
 *
 * El tiempo estacionado no se estima: la estadía guarda desde cuándo, y el reloj cuenta
 * desde ahí. Por eso el número puede mostrarse al segundo sin mentir — a diferencia de
 * la velocidad entre cámaras, que dependía de posiciones puestas a mano.
 *
 * Corre en el navegador, no en el servidor. Pedirle al servidor un número que avanza
 * solo sería pedirle lo mismo cada segundo; acá alcanza con saber el instante de arranque.
 *
 * Dos estados, y se distinguen de lejos:
 *   corriendo  el vehículo sigue ahí. El anillo barre el minuto en curso y el punto late.
 *   cerrado    el vehículo se fue. El reloj queda quieto en su total, apagado.
 */

export const TRAMOS = [
    { min: 15, tono: "emerald", texto: "text-emerald-300", borde: "border-emerald-400/40", fondo: "bg-emerald-500/15", trazo: "#34d399" },
    { min: 60, tono: "sky", texto: "text-sky-300", borde: "border-sky-400/40", fondo: "bg-sky-500/15", trazo: "#38bdf8" },
    { min: 180, tono: "amber", texto: "text-amber-300", borde: "border-amber-400/40", fondo: "bg-amber-500/15", trazo: "#fbbf24" },
    { min: Infinity, tono: "rose", texto: "text-rose-300", borde: "border-rose-400/40", fondo: "bg-rose-500/15", trazo: "#fb7185" },
];

export const tramoPorMinutos = (min: number) => TRAMOS.find((t) => min < t.min) || TRAMOS[TRAMOS.length - 1];

/** "4 s" · "17 min" · "2 h 05" · "1 d 03 h" — siempre corto, siempre sin ambigüedad. */
export function leerDuracion(ms: number) {
    const s = Math.max(0, Math.floor(ms / 1000));
    if (s < 60) return `${s} s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m} min`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h} h ${String(m % 60).padStart(2, "0")}`;
    return `${Math.floor(h / 24)} d ${String(h % 24).padStart(2, "0")} h`;
}

export function useTranscurrido(desde?: string | Date | null, hasta?: string | Date | null) {
    const t0 = desde ? new Date(desde).getTime() : null;
    const tf = hasta ? new Date(hasta).getTime() : null;
    const [ahora, setAhora] = useState(() => Date.now());
    useEffect(() => {
        if (tf) return;                       // cerrado: no hay nada que actualizar
        const iv = setInterval(() => setAhora(Date.now()), 1000);
        return () => clearInterval(iv);
    }, [tf]);
    if (t0 == null) return null;
    return Math.max(0, (tf ?? ahora) - t0);
}

export function Cronometro({ desde, hasta, tamano = "normal", etiqueta, className }: {
    desde?: string | Date | null;
    /** Si viene, el reloj queda quieto ahí: la estadía se cerró. */
    hasta?: string | Date | null;
    tamano?: "chico" | "normal" | "grande";
    etiqueta?: string;
    className?: string;
}) {
    const ms = useTranscurrido(desde, hasta);
    if (ms == null) return null;

    const min = ms / 60000;
    const tramo = tramoPorMinutos(min);
    const corriendo = !hasta;
    // El anillo barre el minuto en curso: da sensación de reloj andando sin tener que
    // elegir un total arbitrario contra el cual medir el progreso.
    const vuelta = (ms % 60000) / 60000;
    const R = 9;
    const C = 2 * Math.PI * R;

    const alto = tamano === "grande" ? "text-[17px]" : tamano === "chico" ? "text-[11px]" : "text-[13px]";
    const lado = tamano === "grande" ? 26 : tamano === "chico" ? 16 : 20;

    return (
        <div className={cn(
            "inline-flex items-center gap-1.5 rounded-lg border backdrop-blur-sm px-2 py-1",
            tramo.borde, tramo.fondo, !corriendo && "opacity-70 grayscale-[0.35]", className,
        )}>
            <svg width={lado} height={lado} viewBox="0 0 24 24" className="shrink-0 -rotate-90">
                <circle cx="12" cy="12" r={R} fill="none" stroke="currentColor" strokeWidth="2.2"
                    className="text-white/15" />
                <circle cx="12" cy="12" r={R} fill="none" stroke={tramo.trazo} strokeWidth="2.2"
                    strokeLinecap="round" strokeDasharray={C}
                    strokeDashoffset={C * (1 - (corriendo ? vuelta : 1))}
                    style={{ transition: "stroke-dashoffset 900ms linear" }} />
                {corriendo && (
                    <circle cx="12" cy="12" r="2.4" fill={tramo.trazo} className="animate-pulse" />
                )}
                {!corriendo && (
                    <path d="M9 9 L15 15 M15 9 L9 15" stroke={tramo.trazo} strokeWidth="1.8"
                        strokeLinecap="round" fill="none" />
                )}
            </svg>
            <div className="leading-none">
                <div className={cn("font-bold tabular-nums", alto, tramo.texto)}>{leerDuracion(ms)}</div>
                {etiqueta && (
                    <div className="text-[8.5px] uppercase tracking-wider text-white/45 mt-0.5">{etiqueta}</div>
                )}
            </div>
        </div>
    );
}
