"use client";

import { useRef, useState } from "react";
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

    const sitio: Record<Lado, string> = {
        arriba: "bottom-full left-1/2 -translate-x-1/2 mb-2",
        abajo: "top-full left-1/2 -translate-x-1/2 mt-2",
        izquierda: "right-full top-1/2 -translate-y-1/2 mr-2",
        derecha: "left-full top-1/2 -translate-y-1/2 ml-2",
    };
    const desde: Record<Lado, { x?: number; y?: number }> = {
        arriba: { y: 4 }, abajo: { y: -4 }, izquierda: { x: 4 }, derecha: { x: -4 },
    };

    return (
        <span className={cn("relative inline-flex", className)}
            onMouseEnter={entrar} onMouseLeave={salir} onFocus={entrar} onBlur={salir}>
            {children}
            <AnimatePresence>
                {abierta && (
                    <motion.span
                        initial={{ opacity: 0, scale: 0.96, ...desde[lado] }}
                        animate={{ opacity: 1, scale: 1, x: 0, y: 0 }}
                        exit={{ opacity: 0, scale: 0.96, ...desde[lado] }}
                        transition={{ type: "spring", stiffness: 420, damping: 30, mass: 0.6 }}
                        style={{ width: ancho }}
                        className={cn(
                            "absolute z-[200] pointer-events-none rounded-xl border border-border/60",
                            "bg-popover/95 backdrop-blur-xl shadow-2xl px-3 py-2 text-left normal-case tracking-normal",
                            sitio[lado],
                        )}>
                        {titulo && <span className="block text-[11px] font-bold text-foreground leading-tight">{titulo}</span>}
                        <span className={cn("block text-[11px] text-muted-foreground leading-relaxed", titulo && "mt-1")}>{texto}</span>
                    </motion.span>
                )}
            </AnimatePresence>
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
