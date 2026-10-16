"use client";

import { cn } from "@/lib/utils";
import { Seek } from "@/components/ui/search";

/**
 * La barra de filtros. Una, para todas las pantallas.
 *
 * Cada tabla se armó la suya: `/admin/history` con chips propios, `/admin/devices` con
 * pestañas de tipo, `/admin/rfid` con un `<Select>`, `/admin/units` con tres botones dentro
 * de una cajita, `/admin/consolas` con un input y dos íconos. Cinco formas de hacer lo
 * mismo — acotar lo que se ve — y ninguna se parecía a la siguiente, así que aprender una
 * pantalla no servía de nada para la otra.
 *
 * Acá hay dos cosas y nada más:
 *
 *   **El buscador**, siempre a la izquierda, siempre igual y siempre del mismo alto.
 *
 *   **Los grupos**, que son botones en fila: una opción activa por grupo. Reemplazan a los
 *   `<Select>` de tres opciones, que cuestan dos clics y esconden las otras dos — una lista
 *   desplegable se justifica cuando hay muchas, no cuando hay tres.
 *
 * Y a la derecha, lo que la pantalla quiera poner: casi siempre el botón de alta.
 *
 * Todo el ancho es de los filtros. Los controles de la tabla — densidad, columnas, CSV —
 * los pone la tabla sola del otro lado, porque contestan otra pregunta: los filtros dicen
 * QUÉ se mira, ésos CÓMO se mira.
 */

export type OpcionFiltro = {
    valor: string;
    rotulo: string;
    cuenta?: number;
    /**
     * El tono de la opción cuando está elegida.
     *
     * Sólo para las que filtran por algo que YA tiene color en el resto de la aplicación:
     * "Permitidos" en verde y "Denegados" en rojo se reconocen antes de leerlos, porque son
     * los mismos tonos de la columna Resultado. Para todo lo demás va el gris: un filtro de
     * clase o de sentido no es bueno ni malo, y pintarlo sería inventar un significado.
     */
    tono?: "bien" | "aviso" | "mal";
    /** Ícono delante del rótulo, cuando ayuda a reconocer la opción sin leerla (personas, vehículos…). */
    icono?: React.ComponentType<{ size?: number; className?: string; strokeWidth?: number }>;
    /** Qué dice la opción cuando se muestra sólo el ícono (rótulo vacío): va como ayuda y para lectores. */
    titulo?: string;
};

export type GrupoFiltro = {
    clave: string;
    /** Qué se está acotando. Va como ayuda del grupo. */
    titulo?: string;
    /** El valor elegido, o los valores si el grupo es de varios. */
    valor: string | string[];
    alElegir: (v: string) => void;
    opciones: OpcionFiltro[];
    /**
     * Varios a la vez. El primer valor de la lista se toma como "todos": elegirlo limpia
     * los demás, y los demás lo apagan a él.
     */
    multiple?: boolean;
    oculto?: boolean;
};

const PLENO: Record<string, string> = { bien: "pleno-bien", aviso: "pleno-aviso", mal: "pleno-mal" };

export function Filtros({ busqueda, alBuscar, placeholder, grupos, acciones, children, className, solido }: {
    busqueda?: string;
    alBuscar?: (v: string) => void;
    placeholder?: string;
    grupos?: GrupoFiltro[];
    /** Lo que va a la derecha del todo: el alta, un exportar, lo que sea. */
    acciones?: React.ReactNode;
    /** Un filtro que no entra en la forma de arriba — una fecha, por ejemplo. */
    children?: React.ReactNode;
    className?: string;
    /**
     * La opción elegida en azul lleno en vez de blanco sobre gris. Para las pantallas donde los
     * filtros son el control principal (OmniVision › Buscar): ahí el gris contra gris no se
     * distinguía de un vistazo cuál estaba puesta.
     */
    solido?: boolean;
}) {
    return (
        <div className={cn("flex items-center flex-wrap gap-2 min-h-[34px]", className)}>
            {alBuscar && (
                /* Con su filo prendido (16/10, Nico: «el buscador no tiene borde y se funde con el
                   fondo»): sobre la barra de una tabla, mismo fondo que la página, el campo no se
                   distinguía. `data-stroke` es el interruptor del propio Seek (globals.css). */
                <span data-stroke="on" className="contents">
                    <Seek value={busqueda || ""} onChange={alBuscar}
                        placeholder={placeholder || "Buscar"} startOpen width={280} alto={34} />
                </span>
            )}

            {(grupos || []).filter((g) => !g.oculto).map((g) => {
                const puestos = Array.isArray(g.valor) ? g.valor : [g.valor];
                const primera = g.opciones[0]?.valor;
                return (
                    <div key={g.clave} className="flex items-center h-[34px] rounded-lg bg-muted/60 p-0.5"
                        title={g.titulo}>
                        {g.opciones.map((o) => {
                            const activa = g.multiple
                                ? (o.valor === primera ? puestos.length === 0 : puestos.includes(o.valor))
                                : o.valor === g.valor;
                            return (
                                <button key={o.valor} type="button" onClick={() => g.alElegir(o.valor)} aria-pressed={activa}
                                    title={o.titulo} aria-label={o.titulo || undefined}
                                    className={cn(
                                        "h-[30px] rounded-md text-[12px] font-semibold transition-colors whitespace-nowrap", o.rotulo ? "px-3" : "px-2.5",
                                        activa
                                            ? (o.tono ? PLENO[o.tono] : solido ? "bg-[var(--accion)] text-white" : "bg-background text-foreground shadow-sm")
                                            : "text-muted-foreground hover:text-foreground",
                                        o.icono && "inline-flex items-center gap-1.5",
                                    )}>
                                    {o.icono && <o.icono size={14} strokeWidth={2.2} />}
                                    {o.rotulo}
                                    {o.cuenta != null && (
                                        <span className={cn(o.rotulo ? "ml-1.5" : "ml-0.5", "tabular-nums", activa ? "opacity-70" : "opacity-60")}>
                                            {o.cuenta}
                                        </span>
                                    )}
                                </button>
                            );
                        })}
                    </div>
                );
            })}

            {children}

            {acciones && <div className="ml-auto flex items-center gap-2">{acciones}</div>}
        </div>
    );
}
