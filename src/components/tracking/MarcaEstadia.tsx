"use client";

import { AnimatePresence, motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { tramoPorMinutos, useTranscurrido } from "@/components/tracking/Cronometro";

/**
 * El tiempo estacionado, escrito sobre la foto en vez de adentro de una cápsula (12/11, Nico, con
 * el visor de un estacionado abierto: «está fea… cambiá la forma de mostrar el tiempo sin el pill,
 * similar a las detecciones en live; más discreto, encima de la silueta, con señal desde la
 * matrícula; el tiempo será un reloj animado, premium, muy fluido»).
 *
 * La cápsula oscura flotaba en el medio de la calle, unida al auto por un hilo: tapaba foto y se
 * leía como un cartel del sistema. Esto es lo mismo que los rótulos del vivo: un punto anillado en
 * la chapa, una guía con codo hasta arriba del auto, y el texto sin fondo apoyado en la guía.
 *
 * Dos piezas: `RelojRodante` (el tiempo, con las cifras que ruedan) y `MarcaEstadia` (el punto, la
 * guía y el reloj, ubicados sobre la foto).
 */

/** La sombra de los rótulos sobre foto: una ceñida que recorta la letra y una ancha que oscurece apenas el fondo. */
const SOMBRA = "0 1px 2px rgba(2,6,23,0.95), 0 0 14px rgba(2,6,23,0.55)";
/** El resorte de una cifra que entra: rápido y sin rebote, para que a un cambio por segundo no maree. */
const RESORTE = { type: "spring" as const, stiffness: 520, damping: 38, mass: 0.6 };

/** Una cifra: la vieja se va para arriba y la nueva entra desde abajo. No importa de cuál a cuál (9 → 0 no «rebobina»). */
function Cifra({ valor }: { valor: string }) {
    return (
        <span className="relative inline-block overflow-hidden align-baseline" style={{ width: "0.62em", height: "1.08em", verticalAlign: "-0.14em" }}>
            <AnimatePresence initial={false} mode="popLayout">
                <motion.span key={valor} className="absolute inset-0 text-center" initial={{ y: "72%", opacity: 0 }} animate={{ y: "0%", opacity: 1 }} exit={{ y: "-72%", opacity: 0 }} transition={RESORTE}>
                    {valor}
                </motion.span>
            </AnimatePresence>
        </span>
    );
}
const Numero = ({ n, dos }: { n: number; dos?: boolean }) => <>{(dos ? String(n).padStart(2, "0") : String(n)).split("").map((c, i, a) => <Cifra key={a.length - i} valor={c} />)}</>;
const Unidad = ({ children }: { children: string }) => <span className="font-semibold opacity-70" style={{ fontSize: "0.5em", marginLeft: "0.14em", marginRight: "0.36em" }}>{children}</span>;

/**
 * El tiempo que lleva, al segundo, con las cifras rodando. Sólo las partes que hacen falta:
 * «41 s», «17 min 05 s», «1 h 41 min 07 s», «2 d 03 h 15 min» (con días, los segundos sobran).
 * Cerrada la estadía (`hasta`), queda quieto en su total.
 */
export function RelojRodante({ desde, hasta, className }: { desde?: string | Date | null; hasta?: string | Date | null; className?: string }) {
    const ms = useTranscurrido(desde, hasta);
    if (ms == null) return null;
    const s = Math.floor(ms / 1000), d = Math.floor(s / 86400), h = Math.floor(s / 3600) % 24, m = Math.floor(s / 60) % 60;
    return (
        <span className={cn("inline-flex items-baseline font-bold tabular-nums leading-none whitespace-nowrap", className)} style={{ textShadow: SOMBRA, letterSpacing: "-0.01em" }}
            aria-label={`${d ? `${d} días ` : ""}${h} horas ${m} minutos`}>
            {d > 0 && <><Numero n={d} /><Unidad>d</Unidad></>}
            {(d > 0 || h > 0) && <><Numero n={h} dos={d > 0} /><Unidad>h</Unidad></>}
            {(d > 0 || h > 0 || m > 0) && <><Numero n={m} dos={d > 0 || h > 0} /><Unidad>min</Unidad></>}
            {d === 0 && <><Numero n={s % 60} dos={h > 0 || m > 0} /><Unidad>s</Unidad></>}
        </span>
    );
}

export type AnclaEstadia = {
    /** El centro de la chapa, en % de la foto: de ahí sale la guía. */
    x: number; y: number;
    /** Hasta dónde llega el auto, en % (arriba y abajo de su silueta o de su caja): el rótulo va afuera de eso. */
    techo: number; piso: number;
};

/** Cuánto se aparta el rótulo del auto, y cuánto corre el codo hacia el costado, en % de la foto. */
const APARTE = 3.2;
const CODO = 3.4;
/** Más arriba que esto, el rótulo se cortaría con el borde (o caería sobre el título): va abajo del auto. */
const MARGEN_ARRIBA = 16;

/**
 * El punto en la chapa, la guía y el reloj, sobre la foto. Va DENTRO de la caja que se acerca con
 * el zoom (posiciones en %), y el texto se achica al revés (`escala`) para no crecer con la foto.
 */
export function MarcaEstadia({ ancla, desde, hasta, etiqueta, sub, escala = 1 }: {
    ancla: AnclaEstadia; desde?: string | Date | null; hasta?: string | Date | null;
    /** «Estacionado», «Se fue»… */
    etiqueta: string;
    /** «Sin registrar», «En el padrón», la lista de vigilancia. */
    sub?: string;
    escala?: number;
}) {
    const ms = useTranscurrido(desde, hasta);
    const corriendo = !hasta;
    const color = ms == null ? "#e2e8f0" : tramoPorMinutos(ms / 60000).trazo;
    const abajo = ancla.techo - APARTE < MARGEN_ARRIBA;
    // El texto va hacia el lado con más lugar.
    const der = ancla.x < 62;
    const ey = abajo ? Math.min(92, ancla.piso + APARTE) : ancla.techo - APARTE;
    const ex = ancla.x + (der ? CODO : -CODO);
    return (
        <>
            {/* La guía, en las coordenadas de la foto: trazo fino que no engorda con el zoom. */}
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 w-full h-full z-[19] pointer-events-none overflow-visible" aria-hidden>
                {/* Aparece fundiéndose y no «dibujándose»: con el trazo que no escala, animar el largo lo deja punteado. */}
                <motion.g initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4, delay: 0.1 }}>
                    <line x1={ancla.x} y1={ancla.y} x2={ex} y2={ey} stroke="rgba(2,6,23,0.45)" strokeWidth={3} vectorEffect="non-scaling-stroke" strokeLinecap="round" />
                    <line x1={ancla.x} y1={ancla.y} x2={ex} y2={ey} stroke={color} strokeWidth={1.4} vectorEffect="non-scaling-stroke" strokeLinecap="round" />
                </motion.g>
            </svg>
            {/* El punto anillado en la chapa: late mientras el auto sigue ahí. */}
            <span className="absolute z-[19] pointer-events-none" style={{ left: `${ancla.x}%`, top: `${ancla.y}%`, transform: `translate(-50%, -50%) scale(${1 / escala})` }} aria-hidden>
                <span className="relative block h-[11px] w-[11px] rounded-full" style={{ background: color, boxShadow: "0 0 0 1.5px #020617, 0 0 10px rgba(2,6,23,0.6)" }}>
                    {corriendo && <motion.span className="absolute inset-0 rounded-full" style={{ border: `1.5px solid ${color}` }}
                        animate={{ scale: [1, 2.6], opacity: [0.7, 0] }} transition={{ duration: 2.2, repeat: Infinity, ease: "easeOut" }} />}
                </span>
            </span>
            {/* El reloj, apoyado en la guía: sin fondo, como los rótulos del vivo. */}
            <motion.div className="absolute z-20 pointer-events-none text-white"
                style={{ left: `${ex}%`, top: `${ey}%`, transform: `translate(${der ? "0" : "-100%"}, ${abajo ? "0" : "-100%"}) scale(${1 / escala})`, transformOrigin: `${der ? "left" : "right"} ${abajo ? "top" : "bottom"}` }}
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.35, delay: 0.3 }}>
                <div className={cn("flex flex-col", der ? "items-start" : "items-end", abajo && "flex-col-reverse")}>
                    <RelojRodante desde={desde} hasta={hasta} className={cn("text-[26px] px-0.5", !corriendo && "opacity-75")} />
                    {/* La línea de base: sale del codo y se apaga hacia la punta. */}
                    <span className="block h-[2px] w-full min-w-[150px] rounded-full my-[5px]"
                        style={{ background: `linear-gradient(${der ? "90deg" : "270deg"}, ${color}, transparent)`, boxShadow: "0 0 6px rgba(2,6,23,0.5)" }} />
                    <span className="px-0.5 text-[10.5px] font-bold uppercase tracking-[0.14em] whitespace-nowrap" style={{ textShadow: SOMBRA }}>
                        <span style={{ color }}>{etiqueta}</span>
                        {sub && <span className="text-white/75"> · {sub}</span>}
                    </span>
                </div>
            </motion.div>
        </>
    );
}
