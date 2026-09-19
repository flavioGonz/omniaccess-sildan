"use client";

import { Car, ImageOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { fecha, fechaCorta, horaSeg } from "@/lib/fechas";

/**
 * Las celdas que se repiten en casi todas las tablas.
 *
 * Estaban escritas de nuevo en cada pantalla, y por eso ninguna se parecía del todo a las
 * otras: el avatar medía 32 en una y 36 en la siguiente, la matrícula tenía un espaciado
 * distinto en cada tabla, y la hora aparecía en tres formatos. Nada de eso era una
 * decisión; era el resultado de escribirlo seis veces.
 */

/** Quién es: la foto (o la inicial), el nombre y una segunda línea. */
export function Identidad({ foto, nombre, sub, insignia, tam = 32 }: {
    foto?: string | null;
    nombre?: string | null;
    sub?: React.ReactNode;
    insignia?: React.ReactNode;
    tam?: number;
}) {
    const inicial = (nombre || "?").trim().charAt(0).toUpperCase();
    return (
        <div className="flex items-center gap-2.5 min-w-0">
            {foto ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={foto} alt={nombre || ""} style={{ width: tam, height: tam }}
                    className="rounded-full object-cover shrink-0 bg-muted" />
            ) : (
                <span style={{ width: tam, height: tam }}
                    className="rounded-full shrink-0 bg-muted text-muted-foreground flex items-center justify-center text-[12px] font-bold">
                    {inicial}
                </span>
            )}
            <div className="min-w-0">
                <div className="flex items-center gap-1.5 min-w-0">
                    <span className="text-[13px] font-semibold text-foreground truncate">{nombre || "—"}</span>
                    {insignia}
                </div>
                {sub != null && <div className="text-[11px] text-muted-foreground truncate">{sub}</div>}
            </div>
        </div>
    );
}

/**
 * Los tonos salen de la paleta de la aplicación, no de colores escritos acá.
 *
 * Estaban escritos como `bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 …`, que
 * es el mismo significado repetido en cuatro valores y con su excepción para el tema
 * oscuro al lado. Multiplicado por cinco tonos y por cada pantalla que los copió, es como
 * "permitido" terminó siendo emerald-400 en un archivo, emerald-600 en otro y #34d399 en
 * un tercero. Ahora el significado tiene un nombre y el color vive en `globals.css`.
 */
const TONOS = {
    neutro: "chip-neutro",
    bien: "chip-bien",
    aviso: "chip-aviso",
    mal: "chip-mal",
    info: "chip-info",
    quieto: "chip-quieto",
} as const;

export type Tono = keyof typeof TONOS;

/** El estado de una fila. Un solo juego de tonos para toda la aplicación. */
export function Estado({ children, tono = "neutro", icono: Ic, className }: {
    children: React.ReactNode;
    tono?: Tono;
    icono?: React.ComponentType<{ size?: number }>;
    className?: string;
}) {
    return (
        <span className={cn(
            "inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[10px] font-bold uppercase tracking-wider whitespace-nowrap",
            TONOS[tono], className,
        )}>
            {Ic && <Ic size={10} />}
            {children}
        </span>
    );
}

/**
 * Cuándo: la hora arriba, la fecha abajo y apagada.
 *
 * Una tabla se recorre buscando un momento del día, no una fecha — la fecha casi siempre
 * es hoy. Por eso la hora va grande y primero, y la fecha queda como referencia.
 */
export function Momento({ t, soloFecha }: { t: string | Date | null | undefined; soloFecha?: boolean }) {
    if (!t) return <span className="text-muted-foreground/50">—</span>;
    const d = new Date(t);
    if (isNaN(d.getTime())) return <span className="text-muted-foreground/50">—</span>;
    if (soloFecha) {
        return <span className="text-[12px] text-muted-foreground tabular-nums">
            {fecha(d)}
        </span>;
    }
    return (
        <div className="leading-tight">
            <div className="text-[13px] font-semibold tabular-nums text-foreground">
                {horaSeg(d)}
            </div>
            <div className="text-[10.5px] text-muted-foreground tabular-nums">
                {fechaCorta(d)}
            </div>
        </div>
    );
}

/** La chapa. Ancho fijo de dígitos y espaciado, para que se lea como una matrícula. */
export function Matricula({ p, className }: { p?: string | null; className?: string }) {
    if (!p) return <span className="text-muted-foreground/50">S/L</span>;
    return (
        <span className={cn(
            "inline-block px-2 py-0.5 rounded-md border border-border bg-muted text-[12.5px] font-bold tabular-nums tracking-[0.12em] text-foreground",
            className,
        )}>
            {p}
        </span>
    );
}

/** El cuadro guardado. Clicable cuando hay algo que abrir. */
export function Miniatura({ src, alt, alAbrir, ancho = 80, alto = 48 }: {
    src?: string | null; alt?: string; alAbrir?: () => void; ancho?: number; alto?: number;
}) {
    if (!src) {
        return (
            <span style={{ width: ancho, height: alto }}
                className="rounded-md border border-dashed border-border flex items-center justify-center text-muted-foreground/30">
                <ImageOff size={14} />
            </span>
        );
    }
    const img = (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img src={src} alt={alt || ""} style={{ width: ancho, height: alto }}
            className="rounded-md object-cover border border-border bg-black" />
    );
    if (!alAbrir) return img;
    return (
        <button type="button" onClick={(e) => { e.stopPropagation(); alAbrir(); }}
            className="rounded-md ring-offset-2 ring-offset-card focus-visible:ring-2 ring-ring hover:opacity-85 transition-opacity"
            title="Ver el cuadro">
            {img}
        </button>
    );
}

/** Nada que mostrar en esta celda. Un guión apagado, no un hueco. */
export function Nada() {
    return <span className="text-muted-foreground/40">—</span>;
}

export { Car as IconoAuto };
