"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * La barra de pasos, arriba y fija.
 *
 * Antes eran tres rayitas que sólo decían "vas por la segunda de tres". Eso contesta
 * cuánto falta, que es la pregunta menos interesante. Las que importan son QUÉ viene
 * después —para saber si conviene tener el equipo a mano antes de empezar— y CUÁNTO SE
 * PUEDE VOLVER, porque en un alta técnica uno se equivoca y quiere corregir sin perder lo
 * demás.
 *
 * Por eso cada paso lleva su nombre y los ya hechos se pueden tocar para volver. Hacia
 * adelante no: un paso que todavía no se llenó no tiene nada que mostrar, y dejar saltar
 * ahí es ofrecer una pantalla vacía.
 */
export function BarraDePasos({ pasos, actual, alIr }: {
    pasos: { clave: string; rotulo: string }[];
    actual: number;
    alIr: (i: number) => void;
}) {
    return (
        <div className="flex items-center gap-1 px-6 py-3.5 overflow-x-auto">
            {pasos.map((p, i) => {
                const hecho = i < actual;
                const aqui = i === actual;
                return (
                    <button key={p.clave} type="button"
                        onClick={() => hecho && alIr(i)}
                        disabled={!hecho}
                        className={cn(
                            "group flex items-center gap-1.5 shrink-0 rounded-full pl-1.5 pr-3 py-1 transition-colors",
                            hecho && "hover:bg-accent cursor-pointer",
                            !hecho && !aqui && "cursor-default",
                        )}>
                        <span className={cn(
                            "w-[19px] h-[19px] rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 transition-colors",
                            aqui ? "bg-[var(--accion)] text-white"
                                : hecho ? "bg-[var(--bien-suave)] text-[var(--bien-texto)]"
                                    : "bg-muted text-muted-foreground",
                        )}>
                            {hecho ? <Check size={11} /> : i + 1}
                        </span>
                        <span className={cn("text-[12px] whitespace-nowrap transition-colors",
                            aqui ? "font-semibold text-foreground"
                                : hecho ? "text-muted-foreground group-hover:text-foreground"
                                    : "text-muted-foreground/50")}>
                            {p.rotulo}
                        </span>
                        {i < pasos.length - 1 && <span className="w-3 h-px bg-border ml-1.5 shrink-0" />}
                    </button>
                );
            })}
        </div>
    );
}

/**
 * El contenido de un paso, que entra y sale por el costado.
 *
 * La dirección importa: si entra siempre por el mismo lado, avanzar y retroceder se ven
 * igual, y el movimiento deja de decir nada. Entrando del lado contrario al que se va, el
 * gesto solo ya dice si se avanzó o se volvió, antes de leer ningún título.
 *
 * `mode="wait"` porque los dos pasos ocupan la misma columna: sin eso se superponen a
 * mitad de camino y se lee un revoltijo de campos de los dos.
 */
export function PasoAnimado({ clave, hacia, children }: {
    clave: string;
    /** 1 avanzando, -1 volviendo. */
    hacia: number;
    children: React.ReactNode;
}) {
    return (
        <AnimatePresence mode="wait" initial={false} custom={hacia}>
            <motion.div
                key={clave}
                custom={hacia}
                initial={{ opacity: 0, x: hacia * 24 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: hacia * -24 }}
                transition={{ duration: 0.22, ease: [0.32, 0.72, 0, 1] }}>
                {children}
            </motion.div>
        </AnimatePresence>
    );
}
