"use client";

import { cn } from "@/lib/utils";
import { leerDuracion, useTranscurrido } from "./Cronometro";

/**
 * La cápsula de actividad, anclada al vehículo.
 *
 * Es lo mismo que una Live Activity de iOS: un solo dato que avanza, con su anillo, en el
 * lugar donde está pasando. Reemplaza a la barra de estado que vivía arriba del visor,
 * lejos del auto del que hablaba — con tres vehículos en cuadro, "estacionado 13 min" no
 * decía cuál.
 *
 * El anillo NO es decoración y por eso puede no estar. Si se le pasa un `limiteMin`, el
 * anillo es la fracción recorrida hasta ese límite — cuánto falta para que la estadía
 * pase a ser algo que mirar. Sin límite no hay contra qué medir, y entonces el anillo
 * barre el minuto en curso, que no afirma nada: solo muestra que el reloj anda.
 *
 * La aguja gira siempre, despacio. Es lo único puramente decorativo, y está porque un
 * cronómetro quieto entre segundo y segundo parece un cronómetro colgado.
 */

const R = 14;
const C = 2 * Math.PI * R;

export function ActividadEnVivo({
    desde, hasta, limiteMin, etiqueta, sub, texto, icono: Icono, onClick, className,
}: {
    desde?: string | Date | null;
    /** Si viene, el reloj queda quieto ahí: la estadía se cerró. */
    hasta?: string | Date | null;
    /** Contra qué se mide el anillo, en minutos. Sin esto el anillo barre el minuto. */
    limiteMin?: number | null;
    etiqueta: string;
    sub?: string;
    /**
     * Qué va en lugar de la duración.
     *
     * Un vehículo que PASÓ no tiene duración: pasó. Poner "0 s" ahí sería inventar un
     * dato — y uno que además parece un error del cronómetro. Para esos eventos va la
     * hora del paso, que es lo único que hay.
     */
    texto?: string;
    icono?: React.ComponentType<{ size?: number }>;
    onClick?: () => void;
    className?: string;
}) {
    const ms = useTranscurrido(desde, hasta);
    const corriendo = !hasta;

    const avance = ms == null
        ? 0
        : limiteMin
            ? Math.min(1, ms / (limiteMin * 60000))
            : (ms % 60000) / 60000;

    const Marco = onClick ? "button" : "div";

    return (
        <Marco
            {...(onClick ? { type: "button" as const, onClick } : {})}
            className={cn(
                "visor-latido flex items-center gap-2.5 rounded-full bg-black/65 backdrop-blur-2xl border pl-2 pr-3.5 py-1.5 text-left",
                onClick && "cursor-pointer hover:bg-black/80 transition-colors",
                className,
            )}
            style={{
                borderColor: "color-mix(in oklab, var(--visor-tono) 38%, transparent)",
                boxShadow: "0 16px 36px rgba(0,0,0,0.65), 0 0 20px color-mix(in oklab, var(--visor-tono) 18%, transparent)",
            }}>

            <span className="relative w-8 h-8 flex items-center justify-center shrink-0">
                <svg className="w-8 h-8 -rotate-90" viewBox="0 0 36 36">
                    <circle cx="18" cy="18" r={R} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="2.5" />
                    <circle cx="18" cy="18" r={R} fill="none" strokeWidth="2.5" strokeLinecap="round"
                        stroke="var(--visor-tono)"
                        strokeDasharray={C}
                        strokeDashoffset={C * (1 - (corriendo ? avance : 1))}
                        style={{ transition: "stroke-dashoffset 900ms linear" }} />
                </svg>
                <span className="absolute inset-0 flex items-center justify-center">
                    {corriendo && (
                        <span className="w-0.5 h-3 bg-white/85 rounded-full origin-bottom"
                            style={{ marginBottom: 6, animation: "spin 12s linear infinite" }} />
                    )}
                    {Icono
                        ? <span className="absolute text-white/90"><Icono size={11} /></span>
                        : <span className="absolute w-1.5 h-1.5 rounded-full"
                            style={{ background: "var(--visor-tono)", boxShadow: "0 0 8px var(--visor-tono)" }} />}
                </span>
            </span>

            <span className="flex flex-col leading-none">
                <span className="flex items-center gap-2">
                    <span className="text-[13px] font-bold tabular-nums text-white">
                        {texto ?? (ms == null ? "—" : leerDuracion(ms))}
                    </span>
                    <span className={cn("w-1.5 h-1.5 rounded-full", corriendo && "animate-pulse")}
                        style={{ background: "var(--visor-tono)", boxShadow: "0 0 6px var(--visor-tono)" }} />
                </span>
                <span className="flex items-center gap-1.5 pt-1">
                    <span className="text-[9px] font-bold tracking-wider uppercase"
                        style={{ color: "color-mix(in oklab, var(--visor-tono) 70%, #fff)" }}>
                        {etiqueta}
                    </span>
                    {sub && (
                        <>
                            <span className="text-white/30 text-[9px]">•</span>
                            <span className="text-[9px] font-semibold text-white/75 tracking-tight">{sub}</span>
                        </>
                    )}
                </span>
            </span>
        </Marco>
    );
}
