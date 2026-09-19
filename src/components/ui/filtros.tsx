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

export function Filtros({ busqueda, alBuscar, placeholder, grupos, acciones, children, className }: {
    busqueda?: string;
    alBuscar?: (v: string) => void;
    placeholder?: string;
    grupos?: GrupoFiltro[];
    /** Lo que va a la derecha del todo: el alta, un exportar, lo que sea. */
    acciones?: React.ReactNode;
    /** Un filtro que no entra en la forma de arriba — una fecha, por ejemplo. */
    children?: React.ReactNode;
    className?: string;
}) {
    return (
        <div className={cn("flex items-center flex-wrap gap-2 min-h-[34px]", className)}>
            {alBuscar && (
                <Seek value={busqueda || ""} onChange={alBuscar}
                    placeholder={placeholder || "Buscar"} startOpen width={280} alto={34} />
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
                                <button key={o.valor} type="button" onClick={() => g.alElegir(o.valor)}
                                    className={cn(
                                        "h-[30px] px-3 rounded-md text-[12px] font-semibold transition-colors whitespace-nowrap",
                                        activa
                                            ? (o.tono ? PLENO[o.tono] : "bg-background text-foreground shadow-sm")
                                            : "text-muted-foreground hover:text-foreground",
                                    )}>
                                    {o.rotulo}
                                    {o.cuenta != null && (
                                        <span className={cn("ml-1.5 tabular-nums", activa ? "opacity-70" : "opacity-60")}>
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
