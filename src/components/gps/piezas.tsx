"use client";

import type { ReactNode } from "react";
import { Bike, Car, CircleDot, PersonStanding, Truck } from "lucide-react";
import type { Rastreador } from "@/app/actions/gps";
import { cn } from "@/lib/utils";

/**
 * Las piezas que comparten las pestañas de Gestión GPS (23/11).
 *
 * Pedido de Nico al encargar la pantalla: «100% usable vía celulares, súper adaptado». De ahí salen
 * las tres reglas que estas piezas llevan adentro, para no escribirlas en cada pestaña:
 *
 *  · **Lo que se toca mide 44 px en el celular** (y 34–36 en el escritorio, donde hay mouse). Es lo
 *    que entra debajo de un pulgar sin apretar lo de al lado.
 *  · **Los campos escriben a 16 px en el celular.** Con menos, el iPhone hace zoom a la página cada
 *    vez que se toca un campo y hay que volver a achicarla a mano.
 *  · **Una columna en el celular.** Las tablas pasan a ser fichas apiladas: una tabla de ocho
 *    columnas en 390 px se lee corriéndola de costado, o sea, no se lee.
 */

export const nombreDe = (r: Pick<Rastreador, "nombre" | "matricula" | "imei">) => r.nombre || r.matricula || `Rastreador ${r.imei.slice(-6)}`;

/** Más viejo que esto, lo que el equipo dijo de su velocidad ya no cuenta como «está andando». */
const FRESCO_MS = 5 * 60_000;
/** El GPS quieto «camina» un par de km/h: hasta acá se lo da por detenido (lo mismo que para el relé). */
const DETENIDO_KMH = 5;

export type ClaveEstado = "andando" | "detenido" | "sin-reportar" | "sin-alta";
export type EstadoVehiculo = { clave: ClaveEstado; rotulo: string; tono: "bien" | "info" | "quieto" | "mal" | "aviso" };

/** En qué anda un vehículo, en una palabra. Es lo que filtra la lista y lo que dice su chip. */
export function estadoDe(r: Rastreador, ahora = Date.now()): EstadoVehiculo {
    if (!r.deviceId) return { clave: "sin-alta", rotulo: "Sin dar de alta", tono: "aviso" };
    /* «Dejó de reportar» es un evento que el receptor ya avisó, no sólo un equipo callado: va en rojo. */
    if (r.sinReporteDesde) return { clave: "sin-reportar", rotulo: "Dejó de reportar", tono: "mal" };
    if (!r.enLinea) return { clave: "sin-reportar", rotulo: "Sin reportar", tono: "quieto" };
    const fresca = !!r.cuando && ahora - new Date(r.cuando).getTime() < FRESCO_MS;
    if (fresca && (r.velocidad || 0) > DETENIDO_KMH) return { clave: "andando", rotulo: "Andando", tono: "bien" };
    return { clave: "detenido", rotulo: "Detenido", tono: "info" };
}

/**
 * En línea, detenido y con una posición de hace rato: no es que se haya perdido, es que el GPS se
 * duerme cuando el vehículo queda quieto y sólo sigue el latido. La posición es donde quedó.
 */
export const quedoAhi = (r: Rastreador, ahora = Date.now()): boolean =>
    r.enLinea && !r.sinReporteDesde && !!r.cuando && ahora - new Date(r.cuando).getTime() > 10 * 60_000;

const DIBUJOS = { auto: Car, camion: Truck, moto: Bike, persona: PersonStanding, punto: CircleDot } as const;
export const ICONOS_GPS: { clave: keyof typeof DIBUJOS; rotulo: string }[] = [
    { clave: "auto", rotulo: "Auto" }, { clave: "camion", rotulo: "Camión" }, { clave: "moto", rotulo: "Moto" }, { clave: "persona", rotulo: "Persona" }, { clave: "punto", rotulo: "Punto" },
];
/** El dibujo del vehículo, del color de su estado: de un vistazo, cuál anda y cuál no reporta. */
export function Insignia({ r, tam = 40 }: { r: Rastreador; tam?: number }) {
    const Dibujo = DIBUJOS[(r.icono || "auto") as keyof typeof DIBUJOS] || Car;
    const e = estadoDe(r);
    return (
        <span className={cn("grid shrink-0 place-items-center rounded-[10px] border", `chip-${e.tono}`)} style={{ width: tam, height: tam }} aria-hidden="true">
            <Dibujo size={Math.round(tam * 0.46)} />
        </span>
    );
}

export function ChipEstado({ r, className }: { r: Rastreador; className?: string }) {
    const e = estadoDe(r);
    return (
        <span className={cn("inline-flex h-6 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2 text-[11px] font-semibold", `chip-${e.tono}`, className)}>
            <span className="h-1.5 w-1.5 rounded-full bg-current" />
            {e.clave === "andando" ? <span className="tabular-nums">{r.velocidad} km/h</span> : e.rotulo}
        </span>
    );
}

export const SENAL = ["Sin señal", "Muy baja", "Baja", "Buena", "Fuerte"];
/** Debajo de esto, la batería de un vehículo de 12 V se está descargando. */
export const VOLTAJE_BAJO = 11.8;
export const voltios = (v: number) => `${v.toFixed(1).replace(".", ",")} V`;

/* ── Lo que se toca ── */

/** Un campo: 44 px y letra de 16 en el celular, 36 y 13 con mouse. */
export const CAMPO = "h-11 w-full min-w-0 rounded-[6px] border border-border bg-background px-3 text-[16px] outline-none focus:border-[var(--accion)] disabled:opacity-50 sm:h-9 sm:text-[13px]";
/** Una píldora de elección (la píldora dice «esto se elige», no «esto dispara algo»). */
export const pildora = (on: boolean) => cn(
    "inline-flex h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 text-[13px] font-semibold sm:h-8 sm:px-3 sm:text-[12px]",
    on ? "border-foreground bg-foreground text-background" : "border-border text-muted-foreground hover:text-foreground");
export const ROTULO = "text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground";

/** Un panel: superficie y una línea, sin sombra (no flota sobre nada). */
export function Panel({ children, className }: { children: ReactNode; className?: string }) {
    return <section className={cn("rounded-[10px] border border-border bg-card/40", className)}>{children}</section>;
}

/** Un dato con su nombre arriba, para las fichas: «Batería · 12,5 V». */
export function Dato({ k, children, tono, className }: { k: string; children: ReactNode; tono?: string; className?: string }) {
    return (
        <div className={cn("min-w-0", className)}>
            <p className="text-[11px] text-muted-foreground">{k}</p>
            <p className={cn("truncate text-[13.5px] font-semibold tabular-nums", tono)}>{children}</p>
        </div>
    );
}

/** Una fila de elecciones que en el celular se corre de costado en vez de partirse en tres renglones. */
export function Tira({ children, className, label }: { children: ReactNode; className?: string; label: string }) {
    return (
        <div role="group" aria-label={label} className={cn("-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:px-0 [&::-webkit-scrollbar]:hidden", className)}>
            {children}
        </div>
    );
}
