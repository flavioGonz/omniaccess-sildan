"use client";

import { AlertTriangle, Inbox, Loader2, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Los cuatro estados de una vista de datos.
 *
 * Toda vista que traiga datos tiene cuatro: **cargando**, **vacío**, **error** y con datos.
 * El relevamiento encontró que acá faltaba uno entero.
 *
 * Cargando estaba resuelto 229 veces con `animate-spin` y 199 con `Loader2`, cada una a su
 * manera. Vacío no tenía ningún componente — **cero** — y aparecía escrito a mano en 27
 * lugares con tres textos distintos. Y error directamente no existía: había **259 `catch`
 * vacíos**, de los cuales unos 112 se tragan un fallo de datos sin decir nada.
 *
 * Ese último es el que importa. Cuando un `catch` vacío se come el error, una pantalla
 * vacía porque el servidor se cayó y una vacía porque no hay registros **se ven
 * exactamente igual**. Y no son lo mismo: de una se espera, de la otra se reintenta. El
 * operador que mira una tabla vacía a las tres de la mañana no tiene cómo saber si el
 * barrio está tranquilo o si el sistema dejó de mirar hace dos horas.
 *
 * Por eso `ErrorEstado` pide `alReintentar` y no lo hace opcional: un error que no se puede
 * reintentar deja al operador sin nada que hacer más que recargar la página a ciegas.
 */

/** Lo que se dibuja mientras se espera. Ocupa el lugar que van a ocupar los datos. */
export function Cargando({ texto = "Cargando…", className }: { texto?: string; className?: string }) {
    return (
        <div className={cn("flex flex-col items-center justify-center gap-2 py-12 text-muted-foreground", className)}>
            <Loader2 size={20} className="animate-spin opacity-70" />
            <span className="text-[12px]">{texto}</span>
        </div>
    );
}

/**
 * No hay nada — y se dice por qué podría no haberlo.
 *
 * Un "Sin resultados" pelado deja al operador sin saber si buscó mal, si filtró de más o si
 * de verdad no pasó nada. La ayuda es la parte útil.
 */
export function Vacio({ icono: Icono = Inbox, titulo, ayuda, accion, className }: {
    icono?: React.ComponentType<{ size?: number; className?: string }>;
    titulo: string;
    ayuda?: string;
    /** Lo que se puede hacer al respecto, si hay algo. */
    accion?: React.ReactNode;
    className?: string;
}) {
    return (
        <div className={cn("flex flex-col items-center justify-center gap-2 py-14 text-center", className)}>
            <Icono size={22} className="text-muted-foreground/50" />
            <p className="text-[13px] font-semibold text-foreground/80">{titulo}</p>
            {ayuda && <p className="text-[11.5px] text-muted-foreground max-w-sm">{ayuda}</p>}
            {accion && <div className="mt-1">{accion}</div>}
        </div>
    );
}

/**
 * No se pudo preguntar. Distinto de no haber nada, y con qué hacer al respecto.
 *
 * `alReintentar` es obligatorio a propósito. Si no hay forma de reintentar, lo que hay es
 * un problema de diseño del llamado, no un estado de error que mostrar.
 */
export function ErrorEstado({ mensaje, alReintentar, titulo = "No se pudieron traer los datos", className }: {
    mensaje?: string | null;
    alReintentar: () => void;
    titulo?: string;
    className?: string;
}) {
    return (
        <div className={cn("flex flex-col items-center justify-center gap-2 py-12 text-center", className)}>
            <AlertTriangle size={22} className="tono-aviso" />
            <p className="text-[13px] font-semibold text-foreground">{titulo}</p>
            {mensaje && <p className="text-[11.5px] text-muted-foreground max-w-sm">{mensaje}</p>}
            <button type="button" onClick={alReintentar}
                className="mt-1 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border text-[12px] font-semibold hover:bg-accent transition-colors">
                <RefreshCw size={12} /> Reintentar
            </button>
        </div>
    );
}

/**
 * Un chip.
 *
 * Absorbe los 127 `<span … rounded-full>` escritos a mano, en 54 combinaciones distintas, y
 * las 582 clases con `text-[10px]` + `uppercase` que son su firma. La variante más repetida
 * de todas era literalmente `<Badge variant="outline">` escrito a mano — tres veces, en
 * tres colores.
 *
 * El tono dice **estado**, nunca acción: el azul de acción es para lo que se aprieta, los
 * cinco tonos para cómo están las cosas.
 */
export function Chip({ children, tono = "neutro", icono: Icono, pleno, className, title }: {
    children: React.ReactNode;
    tono?: "neutro" | "bien" | "aviso" | "mal" | "info" | "quieto";
    icono?: React.ComponentType<{ size?: number }>;
    /** Fondo sólido, para lo que tiene que ganarle a todo lo demás de la pantalla. */
    pleno?: boolean;
    className?: string;
    title?: string;
}) {
    return (
        <span title={title} className={cn(
            "inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-bold uppercase tracking-wider whitespace-nowrap leading-none",
            pleno ? `pleno-${tono} border-transparent` : `chip-${tono}`,
            className,
        )}>
            {Icono && <Icono size={10} />}
            {children}
        </span>
    );
}
