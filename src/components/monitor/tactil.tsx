"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Lo táctil que comparten las vistas de pantalla (Control LPR, Intrusión): cómo responde un
 * toque, cuánto dura una transición, qué se cierra solo y cómo se abre una ficha.
 *
 * Nació adentro de la vista LPR; cuando Intrusión tuvo que volverse táctil se sacó acá para
 * que las dos pantallas respondan igual al dedo. Una tablet en el puesto no puede tener una
 * vista que se hunde al tocar y otra que no.
 */

/** Las transiciones: cortas y con la misma curva en todas las vistas. Informan, no adornan. */
export const SUAVE = { duration: 0.22, ease: [0.32, 0.72, 0, 1] as const };
export const RESORTE = { type: "spring" as const, stiffness: 420, damping: 40 };

/** Se hunde un poco al tocar: la respuesta inmediata que un dedo necesita para saber que tocó. */
export const tocable = "transition-transform duration-150 ease-out active:scale-[0.97] touch-manipulation";

/** Vence `ms` después del último toque en cualquier parte de la pantalla, mientras `activo`. */
export function usarInactividad(activo: boolean, ms: number, alVencer: () => void) {
    const [vuelta, setVuelta] = useState(0);
    const vencer = useRef(alVencer); vencer.current = alVencer;
    useEffect(() => {
        if (!activo) return;
        let t = setTimeout(() => vencer.current(), ms);
        const tocar = () => { clearTimeout(t); t = setTimeout(() => vencer.current(), ms); setVuelta((v) => v + 1); };
        window.addEventListener("pointerdown", tocar);
        return () => { clearTimeout(t); window.removeEventListener("pointerdown", tocar); };
    }, [activo, ms]);
    return vuelta; // cambia en cada toque: sirve de `key` para reiniciar la barra de cuenta atrás
}

/** La barra que se vacía hasta que algo vuelve solo. */
export function CuentaAtras({ ms, vuelta, className }: { ms: number; vuelta: number; className?: string }) {
    return (
        <span className={cn("block h-[3px] w-full overflow-hidden rounded-full bg-white/15", className)}>
            <motion.span key={vuelta} className="block h-full origin-left bg-white/70" initial={{ scaleX: 1 }} animate={{ scaleX: 0 }} transition={{ duration: ms / 1000, ease: "linear" }} />
        </span>
    );
}

/** Una captura a pantalla completa. Se cierra tocando en cualquier lado. */
export function Ampliada({ src, alCerrar }: { src: string | null; alCerrar: () => void }) {
    return (
        <AnimatePresence>
            {src && (
                <motion.button key="ampliada" type="button" onClick={alCerrar} aria-label="Cerrar la captura"
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={SUAVE}
                    className="fixed inset-0 z-[60] bg-black grid place-items-center">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <motion.img src={src} alt="" draggable={false} initial={{ scale: 0.96 }} animate={{ scale: 1 }} exit={{ scale: 0.96 }} transition={SUAVE} className="max-w-full max-h-full object-contain" />
                    <span className="absolute top-4 right-4 grid h-14 w-14 place-items-center rounded-full bg-white/10 text-white"><X size={28} /></span>
                </motion.button>
            )}
        </AnimatePresence>
    );
}

/**
 * El cajón de una ficha, desde la derecha: fondo que cierra al tocar, botón de cerrar de
 * 56 px y la cuenta atrás de cierre solo. Lo de adentro es de cada vista.
 */
export function CajonPared({ abierto, titulo, alCerrar, cierraSoloMs, ancho = 560, children }: {
    abierto: boolean; titulo: string; alCerrar: () => void; cierraSoloMs?: number; ancho?: number; children: React.ReactNode;
}) {
    const vuelta = usarInactividad(abierto && !!cierraSoloMs, cierraSoloMs || 0, alCerrar);
    return (
        <AnimatePresence>
            {abierto && (
                <>
                    <motion.button key="fondo" type="button" aria-label="Cerrar" onClick={alCerrar}
                        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={SUAVE}
                        className="fixed inset-0 z-40 bg-black/55" />
                    <motion.aside key="cajon" role="dialog" aria-label={titulo}
                        initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }} transition={RESORTE}
                        style={{ width: `min(${ancho}px, 100vw)` }}
                        className="fixed inset-y-0 right-0 z-50 bg-background border-l border-border flex flex-col">
                        <div className="shrink-0 px-5 pt-4 pb-3 border-b border-border">
                            <div className="flex items-center gap-3">
                                <div className="min-w-0 flex-1">
                                    <div className="text-[13px] font-bold uppercase tracking-[0.14em] text-muted-foreground">{titulo}</div>
                                    {cierraSoloMs ? <div className="text-[15px] text-muted-foreground">Se cierra sola al minuto sin tocar</div> : null}
                                </div>
                                <button type="button" onClick={alCerrar} aria-label="Cerrar" className={cn("grid h-14 w-14 place-items-center rounded-2xl bg-muted text-foreground shrink-0", tocable)}><X size={26} /></button>
                            </div>
                            {cierraSoloMs ? <CuentaAtras ms={cierraSoloMs} vuelta={vuelta} className="mt-3 bg-muted [&>span]:bg-muted-foreground/60" /> : null}
                        </div>
                        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">{children}</div>
                    </motion.aside>
                </>
            )}
        </AnimatePresence>
    );
}
