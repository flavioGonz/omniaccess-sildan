"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { cn } from "@/lib/utils";

type Lado = "arriba" | "abajo" | "izquierda" | "derecha";

/**
 * Pista: el globo de ayuda que aparece al pasar el mouse.
 *
 * Se hizo propio en vez de usar el del sistema de componentes por dos motivos. Uno,
 * entra y sale con una animación corta en lugar de aparecer de golpe. Dos, admite un
 * título y un cuerpo: la mitad de las columnas de una tabla necesitan una frase para
 * explicarse, no una palabra.
 *
 * Espera un cuarto de segundo antes de aparecer. Sin esa demora, recorrer una tabla
 * llena de pistas es un parpadeo constante.
 *
 * **Se dibuja fuera del documento, no al lado del disparador.** Esto arregla un error que
 * sólo se ve cuando la pista vive adentro de algo que tiene scroll: era un `absolute`
 * colgado del padre, así que cualquier contenedor con `overflow` la RECORTABA. En un cajón
 * lateral la mitad izquierda del globo quedaba cortada contra el borde, y en una tabla con
 * scroll horizontal desaparecía directamente. Un cartel de ayuda que se lee por la mitad
 * es peor que no tenerlo: se nota que hay algo escrito y no se puede leer.
 *
 * Al salir del documento hay que ubicarla a mano, y ahí aparece la segunda mitad del
 * arreglo: se la corre para que entre en la ventana. Un globo de 270px colgado de un ícono
 * pegado al borde izquierdo se sale de la pantalla, y ningún `translate` centrado lo
 * evita.
 */
export function Pista({
    children, titulo, texto, lado = "arriba", demora = 250, ancho = 240, className,
}: {
    children: React.ReactNode;
    titulo?: string;
    texto: React.ReactNode;
    lado?: Lado;
    demora?: number;
    ancho?: number;
    className?: string;
}) {
    const [abierta, setAbierta] = useState(false);
    const reloj = useRef<ReturnType<typeof setTimeout> | null>(null);

    const entrar = () => { if (reloj.current) clearTimeout(reloj.current); reloj.current = setTimeout(() => setAbierta(true), demora); };
    const salir = () => { if (reloj.current) clearTimeout(reloj.current); setAbierta(false); };

    const anclaRef = useRef<HTMLSpanElement>(null);
    const globoRef = useRef<HTMLSpanElement>(null);
    const [sitio, setSitio] = useState<{ top: number; left: number } | null>(null);

    /**
     * Dónde cae el globo, en coordenadas de la ventana.
     *
     * Se mide DESPUÉS de pintarlo y antes de que el navegador lo muestre (useLayoutEffect)
     * porque hace falta el alto real: con dos renglones o con cinco, "arriba del ícono" es
     * un número distinto, y calcularlo con un alto supuesto hace que la pista salte al
     * aparecer.
     */
    useLayoutEffect(() => {
        if (!abierta || !anclaRef.current || !globoRef.current) return;
        const a = anclaRef.current.getBoundingClientRect();
        const g = globoRef.current.getBoundingClientRect();
        const MARGEN = 8;

        let top = lado === "arriba" ? a.top - g.height - MARGEN
            : lado === "abajo" ? a.bottom + MARGEN
                : a.top + a.height / 2 - g.height / 2;
        let left = lado === "izquierda" ? a.left - g.width - MARGEN
            : lado === "derecha" ? a.right + MARGEN
                : a.left + a.width / 2 - g.width / 2;

        // Que entre en la ventana. Sin esto, un globo ancho colgado de un ícono pegado al
        // borde se sale de la pantalla y se lee la mitad.
        left = Math.min(Math.max(MARGEN, left), window.innerWidth - g.width - MARGEN);
        top = Math.min(Math.max(MARGEN, top), window.innerHeight - g.height - MARGEN);
        setSitio({ top, left });
    }, [abierta, lado, ancho, texto, titulo]);

    /* Si la página se mueve debajo del globo, el globo queda apuntando a la nada. Más
       honesto cerrarlo que dejarlo señalando otra cosa. */
    useEffect(() => {
        if (!abierta) return;
        const cerrar = () => setAbierta(false);
        window.addEventListener("scroll", cerrar, true);
        window.addEventListener("resize", cerrar);
        return () => {
            window.removeEventListener("scroll", cerrar, true);
            window.removeEventListener("resize", cerrar);
        };
    }, [abierta]);

    const desde: Record<Lado, { x?: number; y?: number }> = {
        arriba: { y: 4 }, abajo: { y: -4 }, izquierda: { x: 4 }, derecha: { x: -4 },
    };

    const globo = (
        <AnimatePresence>
            {abierta && (
                <motion.span
                    ref={globoRef}
                    initial={{ opacity: 0, scale: 0.96, ...desde[lado] }}
                    animate={{ opacity: 1, scale: 1, x: 0, y: 0 }}
                    exit={{ opacity: 0, scale: 0.96, ...desde[lado] }}
                    transition={{ type: "spring", stiffness: 420, damping: 30, mass: 0.6 }}
                    style={{
                        width: ancho,
                        top: sitio?.top ?? 0,
                        left: sitio?.left ?? 0,
                        // Hasta tener la medida se dibuja invisible: pintarlo en 0,0 y
                        // moverlo después se ve como un salto desde la esquina.
                        visibility: sitio ? "visible" : "hidden",
                    }}
                    className={cn(
                        "fixed z-[var(--capa-pista)] pointer-events-none rounded-xl border border-border/60",
                        "bg-popover/95 backdrop-blur-xl shadow-2xl px-3 py-2 text-left normal-case tracking-normal",
                    )}>
                    {titulo && <span className="block text-[11px] font-bold text-foreground leading-tight">{titulo}</span>}
                    <span className={cn("block text-[11px] text-muted-foreground leading-relaxed", titulo && "mt-1")}>{texto}</span>
                </motion.span>
            )}
        </AnimatePresence>
    );

    return (
        <span ref={anclaRef} className={cn("relative inline-flex", className)}
            onMouseEnter={entrar} onMouseLeave={salir} onFocus={entrar} onBlur={salir}>
            {children}
            {typeof document !== "undefined" && createPortal(globo, document.body)}
        </span>
    );
}

/** Encabezado de columna: ícono, nombre y la pista que explica qué hay debajo. */
export function Columna({ icono: Ic, children, ayuda, titulo, alinear = "left" }: {
    icono?: any; children: React.ReactNode; ayuda?: React.ReactNode; titulo?: string; alinear?: "left" | "center" | "right";
}) {
    const contenido = (
        <span className={cn("inline-flex items-center gap-1.5 text-[11px] text-muted-foreground uppercase tracking-wide font-semibold",
            ayuda && "cursor-help decoration-dotted underline-offset-4 hover:text-foreground transition-colors")}>
            {Ic && <Ic size={12} className="opacity-70" />}
            {children}
        </span>
    );
    return (
        <th className={cn("px-5 py-3", alinear === "right" && "text-right", alinear === "center" && "text-center")}>
            {ayuda ? <Pista titulo={titulo} texto={ayuda} lado="abajo">{contenido}</Pista> : contenido}
        </th>
    );
}
