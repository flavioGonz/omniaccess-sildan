"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
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

const ANCHOS = {
    chico: "sm:max-w-md",
    medio: "sm:max-w-2xl",
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
                className="fixed inset-0 z-[3000] bg-black/55 backdrop-blur-[2px]
                    data-[state=open]:animate-in data-[state=closed]:animate-out
                    data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
            <DialogPrimitive.Content
                data-slot="cajon-content"
                className={cn(
                    "fixed inset-y-0 right-0 z-[3001] w-full flex flex-col bg-background border-l border-border",
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

/** Un bloque del cajón: su título, su porqué, y sus campos. */
function CajonSeccion({ titulo, ayuda, children, className }: {
    titulo: string;
    /** Para qué sirve esto. Una línea, y sólo cuando no es obvio. */
    ayuda?: string;
    children: React.ReactNode;
    className?: string;
}) {
    return (
        <section className={cn("px-6 py-5 border-b border-border last:border-0", className)}>
            <h3 className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">{titulo}</h3>
            {ayuda && <p className="text-[12px] text-muted-foreground/80 mt-1 max-w-prose">{ayuda}</p>}
            <div className="mt-3.5 space-y-3.5">{children}</div>
        </section>
    );
}

/** Un campo con su etiqueta arriba y su ayuda abajo. */
function CajonCampo({ etiqueta, ayuda, children, className }: {
    etiqueta: string;
    ayuda?: string;
    children: React.ReactNode;
    className?: string;
}) {
    return (
        <label className={cn("block", className)}>
            <span className="block text-[12px] font-medium text-foreground/85 mb-1.5">{etiqueta}</span>
            {children}
            {ayuda && <span className="block text-[11.5px] text-muted-foreground mt-1">{ayuda}</span>}
        </label>
    );
}

export { Cajon, CajonDisparador, CajonCerrar, CajonContenido, CajonSeccion, CajonCampo };
