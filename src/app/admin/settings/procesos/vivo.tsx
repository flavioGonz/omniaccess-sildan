"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Las piezas de la vista en vivo de Procesos: el pulso, el tiempo arriba que corre de a un
 * segundo, y la línea chica de consumo.
 *
 * «En vivo» acá quiere decir dos cosas distintas, y las dos tienen que ser verdad:
 *   - Los DATOS se piden cada CADA_VIVO_MS (estado de PM2, Docker y systemd, con su consumo).
 *   - El RELOJ corre cada segundo en el navegador (cuánto lleva arriba), sin pedir nada.
 * Lo que no se puede mostrar segundo a segundo sin mentir —el consumo— se muestra con la última
 * medida y su historia corta, no interpolado.
 */

/** Cada cuánto se pide el estado de los servicios. Menos que esto es pedirle a pm2 y docker más de lo que cambian. */
export const CADA_VIVO_MS = 2_000;
/** Cuántas medidas guarda cada línea: 90 × 2 s = los últimos 3 minutos. */
export const PUNTOS_HISTORIA = 90;

/** «4 h 12 min 08 s», que se lee de un vistazo y cambia cada segundo. */
export function tiempoArriba(iso: string | null, ahora = Date.now()): string {
    if (!iso) return "—";
    let s = Math.max(0, Math.floor((ahora - Date.parse(iso)) / 1000));
    const d = Math.floor(s / 86400); s -= d * 86400;
    const h = Math.floor(s / 3600); s -= h * 3600;
    const m = Math.floor(s / 60); s -= m * 60;
    const ss = String(s).padStart(2, "0");
    if (d) return `${d} d ${h} h ${String(m).padStart(2, "0")} min`;
    if (h) return `${h} h ${String(m).padStart(2, "0")} min ${ss} s`;
    if (m) return `${m} min ${ss} s`;
    return `${s} s`;
}

/** Un reloj que hace redibujar cada segundo, sólo mientras la pestaña está a la vista. */
export function useSegundero() {
    const [t, setT] = useState(() => Date.now());
    useEffect(() => {
        const i = setInterval(() => { if (document.visibilityState === "visible") setT(Date.now()); }, 1000);
        return () => clearInterval(i);
    }, []);
    return t;
}

/** La historia corta de cada serie (cpu, memoria…) por clave, acumulada en el navegador. */
export function useHistorias() {
    const ref = useRef(new Map<string, number[]>());
    const sumar = (clave: string, v: number | null | undefined) => {
        if (v == null || !Number.isFinite(v)) return;
        const a = ref.current.get(clave) || [];
        a.push(v); if (a.length > PUNTOS_HISTORIA) a.splice(0, a.length - PUNTOS_HISTORIA);
        ref.current.set(clave, a);
    };
    return { de: (clave: string) => ref.current.get(clave) || [], sumar };
}

/**
 * La línea de consumo. Escala propia (de 0 al máximo visto, con un piso para que un proceso quieto
 * no dibuje ruido como si fuera una montaña). El último punto lleva un punto: es «ahora».
 */
export function Linea({ datos, ancho = 96, alto = 22, piso = 1, className }: { datos: number[]; ancho?: number; alto?: number; piso?: number; className?: string }) {
    if (datos.length < 2) return <svg width={ancho} height={alto} className={className} aria-hidden="true"><line x1="0" x2={ancho} y1={alto - 1} y2={alto - 1} stroke="currentColor" strokeOpacity="0.2" /></svg>;
    const max = Math.max(piso, ...datos);
    const paso = ancho / (PUNTOS_HISTORIA - 1);
    const x0 = ancho - (datos.length - 1) * paso;
    const pts = datos.map((v, i) => [x0 + i * paso, alto - 2 - (v / max) * (alto - 4)] as const);
    const d = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
    const [ux, uy] = pts[pts.length - 1];
    return (
        <svg width={ancho} height={alto} className={cn("overflow-visible", className)} aria-hidden="true">
            <path d={`${d} L${ux.toFixed(1)} ${alto} L${pts[0][0].toFixed(1)} ${alto} Z`} fill="currentColor" fillOpacity="0.12" />
            <path d={d} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
            <circle cx={ux} cy={uy} r="2" fill="currentColor" />
        </svg>
    );
}

/** El punto que late: prendido = los datos llegan; quieto = en pausa o sin respuesta. */
export function Pulso({ activo, tono = "bien", className }: { activo: boolean; tono?: "bien" | "mal" | "aviso" | "quieto"; className?: string }) {
    const color = { bien: "bg-[var(--bien)]", mal: "bg-[var(--mal)]", aviso: "bg-[var(--aviso)]", quieto: "bg-muted-foreground/50" }[tono];
    return (
        <span className={cn("relative inline-flex w-2 h-2 shrink-0", className)}>
            {activo && <span className={cn("absolute inset-0 rounded-full opacity-60 animate-ping", color)} />}
            <span className={cn("relative w-2 h-2 rounded-full", color)} />
        </span>
    );
}
