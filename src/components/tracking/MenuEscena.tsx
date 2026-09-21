"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

/**
 * El menú del botón derecho sobre la escena.
 *
 * Existe porque la barra flotante sólo puede llevar lo que se usa siempre — cuatro
 * herramientas y dos acciones — y el resto quedaba escondido en la barra lateral, lejos
 * del lugar donde se está mirando. Con el menú, lo que uno quiere hacer **sobre la
 * imagen** se pide sobre la imagen.
 *
 * Los íconos se dibujan acá y se animan con CSS al pasar por encima. No hay un solo
 * `setInterval`, ni SVG animándose en reposo: un menú que gasta CPU mientras está cerrado
 * es exactamente lo que no se puede hacer sobre una pantalla que además está decodificando
 * video.
 */

export type ItemMenu = {
    clave: string;
    rotulo: string;
    Icono: React.ComponentType<{ className?: string }>;
    alElegir: () => void;
    apagado?: boolean;
    /** Una línea de contexto, cuando el rótulo solo no alcanza. */
    nota?: string;
};

export function MenuEscena({ items, children }: { items: ItemMenu[]; children: React.ReactNode }) {
    const [donde, setDonde] = useState<{ x: number; y: number } | null>(null);
    const caja = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!donde) return;
        const cerrar = () => setDonde(null);
        const tecla = (e: KeyboardEvent) => { if (e.key === "Escape") cerrar(); };
        window.addEventListener("pointerdown", cerrar);
        window.addEventListener("keydown", tecla);
        window.addEventListener("resize", cerrar);
        return () => {
            window.removeEventListener("pointerdown", cerrar);
            window.removeEventListener("keydown", tecla);
            window.removeEventListener("resize", cerrar);
        };
    }, [donde]);

    return (
        <div
            ref={caja}
            className="contents"
            onContextMenu={(e) => {
                e.preventDefault();
                const r = caja.current?.getBoundingClientRect();
                setDonde({ x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) });
            }}
        >
            {children}

            <AnimatePresence>
                {donde && (
                    <motion.div
                        initial={{ opacity: 0, scale: 0.96, y: -4 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.98, y: -2 }}
                        transition={{ type: "spring", stiffness: 520, damping: 34, mass: 0.5 }}
                        style={{ left: donde.x, top: donde.y, transformOrigin: "top left" }}
                        onPointerDown={(e) => e.stopPropagation()}
                        className="absolute z-[var(--capa-menu)] min-w-[232px] p-1 rounded-[10px] cristal-menu"
                    >
                        {items.map((it) => (
                            <button
                                key={it.clave}
                                type="button"
                                disabled={it.apagado}
                                onClick={() => { it.alElegir(); setDonde(null); }}
                                className="omni-item group w-full flex items-start gap-2.5 px-2.5 py-2 rounded-[6px]
                                    text-left text-[12.5px] disabled:opacity-40 disabled:cursor-not-allowed
                                    enabled:hover:bg-white/10 transition-colors"
                            >
                                <it.Icono className="omni-glifo mt-[1px] shrink-0" />
                                <span className="min-w-0">
                                    <span className="block font-medium leading-tight">{it.rotulo}</span>
                                    {it.nota && (
                                        <span className="block text-[11px] opacity-60 leading-tight mt-0.5">{it.nota}</span>
                                    )}
                                </span>
                            </button>
                        ))}
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}

/* ── Los glifos ──────────────────────────────────────────────────────────────────
 *
 * Dibujados a mano en vez de tomados de la librería de íconos porque estos tienen que
 * ANIMARSE, y cada uno anima la parte que explica qué hace: la línea se traza, la zona se
 * cierra, la franja se llena, el obturador parpadea. La animación arranca al pasar por
 * encima (`group-hover`) y no antes — ver el comentario de arriba.
 */

const marco = "w-[17px] h-[17px]";
const trazo = { fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

export const GlifoLinea = ({ className = "" }) => (
    <svg viewBox="0 0 24 24" className={`${marco} ${className}`} aria-hidden>
        <path d="M3 17 L21 7" {...trazo} className="omni-trazar" />
        <circle cx="3" cy="17" r="1.8" fill="currentColor" />
        <circle cx="21" cy="7" r="1.8" fill="currentColor" />
    </svg>
);

export const GlifoZona = ({ className = "" }) => (
    <svg viewBox="0 0 24 24" className={`${marco} ${className}`} aria-hidden>
        <rect x="4" y="5" width="16" height="14" rx="2" {...trazo} className="omni-trazar" strokeDasharray="4 3" />
    </svg>
);

export const GlifoFranja = ({ className = "" }) => (
    <svg viewBox="0 0 24 24" className={`${marco} ${className}`} aria-hidden>
        <path d="M3 15 L21 11 L21 17 L3 20 Z" {...trazo} />
        <path d="M9 13.7 L9 18.7 M15 12.4 L15 17.7" {...trazo} className="omni-latir" />
    </svg>
);

export const GlifoLeer = ({ className = "" }) => (
    <svg viewBox="0 0 24 24" className={`${marco} ${className}`} aria-hidden>
        <path d="M4 8V6a2 2 0 0 1 2-2h2M20 8V6a2 2 0 0 0-2-2h-2M4 16v2a2 2 0 0 0 2 2h2M20 16v2a2 2 0 0 1-2 2h-2" {...trazo} />
        <path d="M3 12h18" {...trazo} className="omni-barrer" />
    </svg>
);

export const GlifoCuadro = ({ className = "" }) => (
    <svg viewBox="0 0 24 24" className={`${marco} ${className}`} aria-hidden>
        <rect x="3" y="6" width="18" height="13" rx="2.5" {...trazo} />
        <path d="M9 6 L10.5 3.5 h3 L15 6" {...trazo} />
        <circle cx="12" cy="12.5" r="3.4" {...trazo} className="omni-obturar" />
    </svg>
);

export const GlifoTodo = ({ className = "" }) => (
    <svg viewBox="0 0 24 24" className={`${marco} ${className}`} aria-hidden>
        <rect x="3" y="5" width="18" height="14" rx="2" {...trazo} />
        <path d="M8 10 L6 12 L8 14 M16 10 L18 12 L16 14" {...trazo} className="omni-abrir" />
    </svg>
);

export const GlifoSentido = ({ className = "" }) => (
    <svg viewBox="0 0 24 24" className={`${marco} ${className}`} aria-hidden>
        <path d="M4 9h13M14 6l3 3-3 3" {...trazo} className="omni-correr-der" />
        <path d="M20 15H7m3 3-3-3 3-3" {...trazo} className="omni-correr-izq" />
    </svg>
);
