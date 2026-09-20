"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { HelpCircle, X } from "lucide-react";
import { Pista } from "@/components/ui/pista";
import { cn } from "@/lib/utils";

/**
 * El cajón: un panel que entra desde el costado.
 *
 * Existe porque un diálogo centrado y un cajón lateral no son lo mismo aunque los dos
 * tapen la pantalla. Un diálogo es para una pregunta corta que se contesta y se cierra —
 * "¿seguro que querés borrar esto?" —; un cajón es para TRABAJAR sobre algo sin perder de
 * vista de dónde salió. La lista queda del otro lado, a la izquierda, y eso importa: se
 * edita una unidad, se cierra, se abre la siguiente, y en el medio uno sigue viendo dónde
 * está parado.
 *
 * El caso que lo pidió lo muestra bien. La edición de una propiedad era un diálogo
 * centrado de 6xl con pestañas adentro: tan grande que tapaba todo, pero sin llegar a ser
 * una pantalla. Lo peor de los dos mundos — perdía el contexto como una pantalla y no daba
 * el lugar de una.
 *
 * Se apoya en el diálogo de Radix y no en un `div` con `position: fixed` porque lo difícil
 * de un panel así no es que se vea: es que atrape el foco, que Escape lo cierre, que el
 * lector de pantalla anuncie que se abrió algo y que el fondo deje de recibir el tabulador.
 * Eso ya está resuelto ahí y resolverlo de nuevo sería resolverlo peor.
 *
 * Tres anchos, y ninguno llega al borde: la franja que queda a la izquierda es lo que hace
 * que esto se lea como un cajón sobre la pantalla y no como otra pantalla.
 */

/**
 * Los anchos.
 *
 * Ninguno llega al borde: la franja que queda a la izquierda es lo que hace que esto se
 * lea como un cajón sobre la pantalla y no como otra pantalla.
 *
 * `angosto` es el que corresponde a un formulario de una columna, que es casi siempre. La
 * tentación es agrandar el panel cuando el formulario tiene muchos campos, y es al revés:
 * un cajón ancho con una sola columna deja una banda de aire muerto a la derecha, y con
 * dos columnas obliga a barrer la vista en zigzag para leer lo que es una sola lista de
 * preguntas.
 */
/**
 * Los anchos del cajón, por lo que entra en ellos.
 *
 * `chico` era un segundo nombre para el mismo valor que `angosto` y no lo usaba nadie: un
 * escalón que no existía. En su lugar hay uno que sí hacía falta — entre una columna de
 * campos y dos columnas cómodas hay un caso intermedio: campos más algo para MIRAR, como
 * un plano o una foto, que en 448 px queda apretado y en 672 sobra.
 */
const ANCHOS = {
    /** Una sola columna de campos. */
    angosto: "sm:max-w-md",
    /** Campos y algo para mirar: un plano, una foto. */
    intermedio: "sm:max-w-xl",
    /** Dos columnas de campos. */
    medio: "sm:max-w-2xl",
    /** Una tabla o una grilla adentro. */
    ancho: "sm:max-w-5xl",
} as const;

function Cajon({ ...props }: React.ComponentProps<typeof DialogPrimitive.Root>) {
    return <DialogPrimitive.Root data-slot="cajon" {...props} />;
}

function CajonDisparador({ ...props }: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
    return <DialogPrimitive.Trigger data-slot="cajon-trigger" {...props} />;
}

function CajonCerrar({ ...props }: React.ComponentProps<typeof DialogPrimitive.Close>) {
    return <DialogPrimitive.Close data-slot="cajon-close" {...props} />;
}

/**
 * El cuerpo del cajón.
 *
 * `titulo` no es decorativo: Radix exige un título accesible, y sin él la consola se llena
 * de advertencias y el lector de pantalla no sabe qué se abrió. Si no se quiere mostrar,
 * `tituloOculto` lo deja sólo para quien lo necesita.
 */
function CajonContenido({
    className, children, ancho = "medio", titulo, descripcion, tituloOculto, pie, encabezado,
    ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
    ancho?: keyof typeof ANCHOS;
    titulo: string;
    descripcion?: string;
    tituloOculto?: boolean;
    /** Lo que queda fijo abajo — casi siempre guardar y cancelar. No hace scroll. */
    pie?: React.ReactNode;
    /** Lo que queda fijo arriba, debajo del título. Filtros, pestañas, lo que sea. */
    encabezado?: React.ReactNode;
}) {
    return (
        <DialogPrimitive.Portal>
            <DialogPrimitive.Overlay
                className="fixed inset-0 z-[var(--capa-panel)] bg-black/55 backdrop-blur-[2px]
                    data-[state=open]:animate-in data-[state=closed]:animate-out
                    data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
            <DialogPrimitive.Content
                data-slot="cajon-content"
                className={cn(
                    "fixed inset-y-0 right-0 z-[calc(var(--capa-panel)+1)] w-full flex flex-col bg-background border-l border-border",
                    "shadow-[-24px_0_48px_-24px_rgba(0,0,0,0.45)]",
                    "data-[state=open]:animate-in data-[state=closed]:animate-out",
                    "data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right",
                    "duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]",
                    ANCHOS[ancho], className,
                )}
                {...props}>

                <div className="shrink-0 flex items-start gap-3 px-6 pt-5 pb-4 border-b border-border">
                    <div className="min-w-0 flex-1">
                        <DialogPrimitive.Title className={cn("text-[17px] font-bold text-foreground truncate",
                            tituloOculto && "sr-only")}>
                            {titulo}
                        </DialogPrimitive.Title>
                        {descripcion && (
                            <DialogPrimitive.Description className={cn("text-[12.5px] text-muted-foreground mt-0.5",
                                tituloOculto && "sr-only")}>
                                {descripcion}
                            </DialogPrimitive.Description>
                        )}
                    </div>
                    <DialogPrimitive.Close
                        className="w-8 h-8 shrink-0 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                        aria-label="Cerrar">
                        <X size={17} />
                    </DialogPrimitive.Close>
                </div>

                {encabezado && <div className="shrink-0 border-b border-border">{encabezado}</div>}

                {/* Lo único que hace scroll. El título y el pie quedan quietos: en un panel
                    alto, perder de vista el botón de guardar es perder de vista la salida. */}
                <div className="flex-1 min-h-0 overflow-y-auto">{children}</div>

                {pie && (
                    <div className="shrink-0 flex items-center justify-end gap-2 px-6 py-4 border-t border-border bg-card/40">
                        {pie}
                    </div>
                )}
            </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
    );
}

/**
 * Un bloque del cajón: su título, su porqué, y sus campos.
 *
 * El ícono no es adorno. En un panel largo, lo que se hace al volver no es leer los
 * títulos: es barrerlos buscando el que se estaba mirando, y una silueta se reconoce de
 * un vistazo mucho antes que un renglón de mayúsculas espaciadas. Va apagado —el ícono
 * ubica, el título dice— y del tamaño del texto, no más grande.
 *
 * El aire entre secciones es de 32px y no de 20: con menos, dos bloques distintos se leen
 * como uno solo largo y hay que apoyarse en la línea divisoria para separarlos. La línea
 * ayuda; el aire es lo que hace el trabajo.
 */
function CajonSeccion({ titulo, ayuda, icono: Icono, children, className }: {
    titulo: string;
    /** Para qué sirve esto. Una línea, y sólo cuando no es obvio. */
    ayuda?: string;
    icono?: React.ComponentType<{ size?: number; className?: string }>;
    children: React.ReactNode;
    className?: string;
}) {
    return (
        <section className={cn("px-6 py-8 border-b border-border last:border-0", className)}>
            {/* Título vacío = no hay rótulo. Pasa cuando el encabezado del cajón ya dice de
                qué es la hoja: repetirlo abajo con otras palabras hace leer dos veces lo
                mismo antes de llegar a lo único que hay para hacer. */}
            {titulo && (
                <h3 className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                    {Icono && <Icono size={13} className="text-muted-foreground/70" />}
                    {titulo}
                </h3>
            )}
            {ayuda && <p className="text-[12px] text-muted-foreground/80 mt-1.5 max-w-prose">{ayuda}</p>}
            <div className={cn("space-y-4", (titulo || ayuda) && "mt-4")}>{children}</div>
        </section>
    );
}

/**
 * Un campo con su etiqueta arriba y, si hace falta, dos clases distintas de ayuda.
 *
 * `ayuda` va SIEMPRE visible, debajo del campo, y es para lo que hay que saber antes de
 * escribir: el formato, que es opcional, de dónde sale el dato.
 *
 * `pista` se esconde detrás de un signo de pregunta y es para lo que explica POR QUÉ
 * existe el campo y qué pasa con lo que se escriba. Eso no puede ir siempre a la vista: un
 * formulario con una frase abajo de cada casilla se vuelve un texto con casillas
 * intercaladas, y entonces no se lee ninguna. Pero tampoco puede faltar — quien carga a
 * alguien por primera vez necesita saber qué está prometiendo cada campo.
 *
 * El signo de pregunta sólo aparece cuando hay algo que contar. Un ícono de ayuda que no
 * ayuda enseña a ignorar los íconos de ayuda.
 */
function CajonCampo({ etiqueta, ayuda, pista, pistaTitulo, children, className }: {
    etiqueta: string;
    ayuda?: string;
    /** Lo que se cuenta al pasar el mouse por el signo de pregunta. */
    pista?: React.ReactNode;
    pistaTitulo?: string;
    children: React.ReactNode;
    className?: string;
}) {
    return (
        <label className={cn("block", className)}>
            <span className="flex items-center gap-1.5 text-[12px] font-medium text-foreground/85 mb-1.5">
                {etiqueta}
                {pista && (
                    <Pista titulo={pistaTitulo || etiqueta} texto={pista} lado="arriba" ancho={270}>
                        <HelpCircle size={12.5}
                            className="text-muted-foreground/50 hover:text-[var(--accion)] transition-colors cursor-help" />
                    </Pista>
                )}
            </span>
            {children}
            {ayuda && <span className="block text-[11.5px] text-muted-foreground mt-1.5">{ayuda}</span>}
        </label>
    );
}

export { Cajon, CajonDisparador, CajonCerrar, CajonContenido, CajonSeccion, CajonCampo };
