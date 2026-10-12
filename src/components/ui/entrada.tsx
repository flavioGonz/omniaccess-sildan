"use client";

import { AnimatePresence, motion } from "framer-motion";

/**
 * La transición de entrada y salida de una vista: una sola, para todas.
 *
 * Había una por pantalla y cada una distinta: `zoom-in-95 duration-500` (media página creciendo),
 * `fade-in duration-500`, `slide-in-from-bottom-1 duration-300`, `slide-in-from-top-4`… Al pasar
 * de una sección a otra de Ajustes cada una entraba a su manera, y algunas tardaban medio segundo
 * en terminar de acomodarse en una pantalla donde se viene a cambiar UNA cosa.
 *
 * Ésta es la de los sistemas de Apple: corta, sin rebote, aparece desde un poco más abajo y algo
 * desenfocada y se asienta; al irse, se apaga más rápido de lo que llegó (lo que se va importa
 * menos que lo que llega). La curva es la de `ease` de CSS de iOS/macOS.
 *
 *   <Vistas clave={seccion}> … </Vistas>   — cambia entre vistas con salida y entrada
 *   <Entrada> … </Entrada>                 — sólo la entrada, para algo que aparece
 */

/** La curva: arranca rápido y se asienta despacio, sin pasarse. */
export const CURVA_SUAVE = [0.25, 0.1, 0.25, 1] as const;
export const ENTRADA_SEG = 0.26;
export const SALIDA_SEG = 0.14;

const variantes = {
    oculto: { opacity: 0, y: 8, filter: "blur(3px)" },
    // Al terminar, `filter: none`: un filtro puesto (aunque sea blur(0)) vuelve a este div el marco
    // de todo lo `position: fixed` de adentro, y los diálogos de las secciones quedaban encerrados
    // en él. El transform no hace falta limpiarlo: con y = 0 framer escribe `transform: none`.
    visible: { opacity: 1, y: 0, filter: "blur(0px)", transition: { duration: ENTRADA_SEG, ease: CURVA_SUAVE }, transitionEnd: { filter: "none" } },
    saliendo: { opacity: 0, y: -4, filter: "blur(2px)", transition: { duration: SALIDA_SEG, ease: CURVA_SUAVE } },
};

export function Vistas({ clave, children, className }: { clave: string; children: React.ReactNode; className?: string }) {
    return (
        <AnimatePresence mode="wait" initial={false}>
            <motion.div key={clave} variants={variantes} initial="oculto" animate="visible" exit="saliendo" className={className}>
                {children}
            </motion.div>
        </AnimatePresence>
    );
}

export function Entrada({ children, className, retraso = 0 }: { children: React.ReactNode; className?: string; retraso?: number }) {
    return (
        <motion.div initial="oculto" animate="visible" variants={{ ...variantes, visible: { ...variantes.visible, transition: { ...variantes.visible.transition, delay: retraso } } }} className={className}>
            {children}
        </motion.div>
    );
}

/** Para menús y paneles chicos que se abren desde un botón: lo mismo, más corto y desde arriba. */
export const MENU_SUAVE = {
    initial: { opacity: 0, y: -4, scale: 0.98 },
    animate: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.16, ease: CURVA_SUAVE } },
    exit: { opacity: 0, y: -2, scale: 0.99, transition: { duration: 0.1, ease: CURVA_SUAVE } },
};
