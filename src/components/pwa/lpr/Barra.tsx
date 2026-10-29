"use client";
/**
 * La barra de abajo de «LPR en vivo», con cinco botones (29/10, Nico: «5 botones en el menú, más
 * menú de Apple»). Flota sobre el contenido como la barra de pestañas de iOS: una cápsula de vidrio
 * esmerilado, despegada de los bordes, y la pestaña activa marcada por una pastilla que se desliza
 * de un botón al otro en vez de saltar.
 *
 * Es de lo poco de la app que de verdad flota (va encima de la lista que pasa por debajo), por eso
 * lleva la sombra flotante; lo demás no lleva sombra.
 */
import { motion } from "framer-motion";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type BotonBarra<K extends string> = { clave: K; rotulo: string; icono: LucideIcon; aviso?: number };

export function Barra<K extends string>({ botones, activa, alElegir }: { botones: BotonBarra<K>[]; activa: K; alElegir: (k: K) => void }) {
    return (
        <nav className="absolute inset-x-3 z-30 bottom-[max(0.6rem,env(safe-area-inset-bottom))]">
            <div className="relative flex items-stretch h-[62px] p-1 rounded-[31px] border border-border/70 bg-background/72 backdrop-blur-2xl backdrop-saturate-150 shadow-[var(--sombra-flotante)]">
                {botones.map(({ clave, rotulo, icono: Ico, aviso }) => {
                    const es = clave === activa;
                    return (
                        <button key={clave} type="button" onClick={() => { if (!es) { navigator.vibrate?.(8); alElegir(clave); } }} aria-current={es ? "page" : undefined}
                            className={cn("relative flex-1 min-w-0 flex flex-col items-center justify-center gap-[3px] rounded-[27px] text-[10px] font-semibold transition-colors duration-200",
                                es ? "tono-accion" : "text-muted-foreground active:text-foreground")}>
                            {es && (
                                <motion.span layoutId="barra-activa" className="absolute inset-0 rounded-[27px] bg-[color-mix(in_oklab,var(--accion)_13%,transparent)]"
                                    transition={{ type: "spring", stiffness: 520, damping: 38, mass: 0.8 }} />
                            )}
                            <motion.span className="relative" animate={{ scale: es ? 1.08 : 1, y: es ? -1 : 0 }} transition={{ type: "spring", stiffness: 600, damping: 30 }}>
                                <Ico size={21} strokeWidth={es ? 2.3 : 1.8} />
                                {!!aviso && (
                                    <span className="absolute -top-1.5 -right-2.5 min-w-[17px] h-[17px] px-1 rounded-full pleno-mal text-[9.5px] font-bold leading-[17px] text-center tabular-nums border-2 border-background">
                                        {aviso > 99 ? "99+" : aviso}
                                    </span>
                                )}
                            </motion.span>
                            <span className="relative truncate max-w-full px-0.5">{rotulo}</span>
                        </button>
                    );
                })}
            </div>
        </nav>
    );
}
