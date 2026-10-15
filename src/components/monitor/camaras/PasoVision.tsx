"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Check, ScanEye, TriangleAlert, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Lo que pasa mientras un canal entra o sale de OmniVision, dibujado EN el canal (15/10, Nico:
 * «no con ese mensaje arriba tipo chip; debe ser el contenido del canal, cambiar el video en vivo
 * por un loader»). Un aviso arriba de la pared no dice cuál de 25 cámaras cambió, y se iba solo
 * aunque nadie lo hubiera leído. Acá el canal mismo cuenta: se está mandando, quedó adentro, o no
 * se pudo y por qué.
 *
 * Fases: enviando / retirando (el pedido en curso) → listo / retirado (confirmación corta) o error
 * (queda hasta que se cierra o vence). Sobre la foto de la cámara, desenfocada: se sigue sabiendo
 * qué canal es.
 */
export type FaseVision = "enviando" | "retirando" | "listo" | "retirado" | "error";
export type PasoVision = { fase: FaseVision; texto?: string };

const TITULO: Record<FaseVision, string> = {
    enviando: "Enviando canal al motor OmniVision",
    retirando: "Retirando el canal de OmniVision",
    listo: "Canal en OmniVision",
    retirado: "Fuera de OmniVision",
    error: "No se pudo",
};
const BAJADA: Record<FaseVision, string> = {
    enviando: "Registrando el canal y reservando su cupo de análisis",
    retirando: "Liberando su cupo; lo ya registrado se conserva",
    listo: "Siluetas, búsqueda, reglas y verificación. El primer análisis llega en menos de un minuto.",
    retirado: "Deja de analizarse. Lo que ya registró sigue en Buscar.",
    error: "",
};

export function PasoVisionCanal({ paso, nombre, foto, grande, alCerrar, capa = "z-20" }: {
    paso: PasoVision | null; nombre: string; foto: string | null;
    /** En la ficha va debajo de los controles (que siguen a la vista): ahí se pasa un z menor. */
    capa?: string;
    /** Ficha a pantalla completa o casilla grande: más aire y la bajada siempre. */
    grande?: boolean;
    alCerrar?: () => void;
}) {
    return (
        <AnimatePresence>
            {paso && (
                <motion.div key="paso" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.35 } }} transition={{ duration: 0.22 }}
                    className={cn("@container absolute inset-0 overflow-hidden bg-neutral-950 text-white", capa)} role="status" aria-live="polite"
                    onClick={(e) => e.stopPropagation()}>
                    {/* La cámara sigue ahí, de fondo: desenfocada y oscura. */}
                    {foto && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={foto} alt="" draggable={false} className="absolute inset-0 w-full h-full object-cover scale-110 blur-[14px] brightness-[0.35] saturate-[0.6]" />
                    )}
                    {/* El barrido: una línea que recorre el cuadro mientras el pedido está en vuelo. */}
                    {(paso.fase === "enviando" || paso.fase === "retirando") && (
                        <motion.span aria-hidden className="absolute inset-x-0 h-24 bg-gradient-to-b from-transparent via-[color-mix(in_oklab,var(--accion-en-oscuro)_28%,transparent)] to-transparent"
                            initial={{ top: "-25%" }} animate={{ top: "105%" }} transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }} />
                    )}
                    <div className="relative h-full w-full flex flex-col items-center justify-center gap-2 @[260px]:gap-3 px-4 text-center">
                        <Insignia fase={paso.fase} grande={grande} />
                        <div className="min-w-0 max-w-[460px]">
                            <div className={cn("font-bold leading-tight tracking-[-0.01em]", grande ? "text-[22px]" : "text-[13px] @[260px]:text-[15px] @[420px]:text-[18px]")}>{TITULO[paso.fase]}</div>
                            <div className={cn("mt-0.5 text-white/60 truncate", grande ? "text-[14px]" : "text-[11.5px] @[260px]:text-[12.5px]")}>{nombre}</div>
                            {(paso.fase === "error" ? paso.texto : BAJADA[paso.fase]) && (
                                <div className={cn("mt-1.5 leading-snug", paso.fase === "error" ? "text-[color-mix(in_oklab,var(--mal)_55%,white)]" : "text-white/70",
                                    grande ? "text-[14px]" : "hidden @[260px]:block text-[12px] @[420px]:text-[13px]")}>
                                    {paso.fase === "error" ? paso.texto : BAJADA[paso.fase]}
                                </div>
                            )}
                        </div>
                        {paso.fase === "error" && alCerrar && (
                            <button type="button" onClick={(e) => { e.stopPropagation(); alCerrar(); }}
                                className="mt-1 h-8 px-3.5 rounded-full bg-white/15 hover:bg-white/25 text-[12.5px] font-semibold inline-flex items-center gap-1.5">
                                <X size={13} /> Entendido
                            </button>
                        )}
                    </div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}

/** El ícono del centro: un anillo que gira mientras se espera; tilde o alerta al terminar. */
function Insignia({ fase, grande }: { fase: FaseVision; grande?: boolean }) {
    const enVuelo = fase === "enviando" || fase === "retirando";
    const tam = grande ? "w-20 h-20" : "w-12 h-12 @[260px]:w-16 @[260px]:h-16";
    const icono = grande ? 34 : 22;
    return (
        <span className={cn("relative grid place-items-center shrink-0", tam)}>
            {enVuelo && (
                <motion.span aria-hidden className="absolute inset-0 rounded-full"
                    style={{ background: "conic-gradient(from 0deg, transparent 0 55%, var(--accion-en-oscuro) 100%)", WebkitMask: "radial-gradient(farthest-side, transparent calc(100% - 3px), #000 calc(100% - 3px))", mask: "radial-gradient(farthest-side, transparent calc(100% - 3px), #000 calc(100% - 3px))" }}
                    animate={{ rotate: 360 }} transition={{ duration: 1.1, repeat: Infinity, ease: "linear" }} />
            )}
            <motion.span key={fase} initial={{ scale: enVuelo ? 1 : 0.4, opacity: enVuelo ? 1 : 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 420, damping: 22 }}
                className={cn("absolute inset-[5px] rounded-full grid place-items-center ring-1",
                    fase === "listo" ? "bg-[var(--bien)] ring-white/30" : fase === "error" ? "bg-[var(--mal)] ring-white/30" : fase === "retirado" ? "bg-white/15 ring-white/25" : "bg-black/45 ring-white/15")}>
                {fase === "listo" || fase === "retirado" ? <Check size={icono} strokeWidth={2.6} />
                    : fase === "error" ? <TriangleAlert size={icono} />
                        : <motion.span animate={{ opacity: [0.55, 1, 0.55] }} transition={{ duration: 1.4, repeat: Infinity }}><ScanEye size={icono} /></motion.span>}
            </motion.span>
        </span>
    );
}
