"use client";

import { useState } from "react";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";
import { CapaAnalisis } from "@/components/vision/CapaAnalisis";
import type { Analisis } from "@/lib/vision-capa";

/**
 * Las piezas visuales de OmniVision › Entrenar. Lo que se quiere que se vea de un vistazo: DÓNDE
 * mira (la zona sobre el cuadro de la cámara), QUÉ ve (el recorte con las siluetas de lo que
 * reconoce, con su nombre arriba, la misma capa que los monitores) y QUÉ DECIDE (el medidor).
 *
 * Colores sobre foto: los de la capa (CapaAnalisis). El medidor usa los tonos de estado del
 * sistema: aviso para el estado que avisa, quieto para el normal.
 */

/** Una muestra con lo que omni-vision vio encima. La capa aparece cuando la foto cargó: antes no hay sobre qué caer. */
export function MuestraVista({ url, analisis, ancho = 640, etiquetas = true, className, ajuste = "contain" }: {
    url: string; analisis?: Analisis | null; ancho?: number; etiquetas?: boolean; className?: string; ajuste?: "contain" | "cover";
}) {
    const [cargada, setCargada] = useState(false);
    return (
        <div className={cn("relative bg-black overflow-hidden", className)}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`${url}?w=${ancho}`} alt="" onLoad={() => setCargada(true)} draggable={false}
                className={cn("absolute inset-0 w-full h-full", ajuste === "cover" ? "object-cover" : "object-contain")} />
            {cargada && analisis?.objetos?.length ? (
                <motion.div className="absolute inset-0" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5 }}>
                    <CapaAnalisis analisis={analisis} ajuste={ajuste} etiquetas={etiquetas} />
                </motion.div>
            ) : null}
        </div>
    );
}

/** El haz que barre la imagen mientras omni-vision está mirando. */
export function Escaneo() {
    return (
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
            <motion.div className="absolute inset-x-0 h-24"
                style={{ background: "linear-gradient(to bottom, transparent, color-mix(in oklab, var(--accion-en-oscuro, #60a5fa) 35%, transparent), transparent)" }}
                initial={{ top: "-25%" }} animate={{ top: "105%" }} transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }} />
            <div className="absolute inset-0 border-2 border-[var(--accion-en-oscuro,#60a5fa)]/60 animate-pulse" />
        </div>
    );
}

/**
 * El medidor: un anillo que se llena con la probabilidad del estado que avisa, con la marca del
 * umbral. Al centro, lo que decide en palabras y con cuánta seguridad.
 */
export function Medidor({ prob, umbral, positivo, negativo, tam = 132 }: { prob: number | null; umbral: number; positivo: string; negativo: string; tam?: number }) {
    const r = 54, l = 2 * Math.PI * r;
    const avisa = prob != null && prob >= umbral;
    const color = prob == null ? "var(--muted-foreground)" : avisa ? "var(--aviso)" : "var(--quieto)";
    const ang = umbral * 360 - 90;
    return (
        <div className="relative shrink-0" style={{ width: tam, height: tam }}>
            <svg viewBox="0 0 132 132" className="w-full h-full -rotate-0">
                <circle cx="66" cy="66" r={r} fill="none" stroke="var(--muted)" strokeWidth="10" />
                <motion.circle cx="66" cy="66" r={r} fill="none" stroke={color} strokeWidth="10" strokeLinecap="round"
                    transform="rotate(-90 66 66)" strokeDasharray={l}
                    initial={{ strokeDashoffset: l }} animate={{ strokeDashoffset: l * (1 - (prob ?? 0)) }} transition={{ duration: 0.9, ease: "easeOut" }} />
                {/* La marca del umbral: desde ahí es el estado que avisa. */}
                <line x1="66" y1="4" x2="66" y2="18" stroke="var(--foreground)" strokeWidth="2.5" strokeLinecap="round" transform={`rotate(${ang + 90} 66 66)`} />
            </svg>
            <div className="absolute inset-0 grid place-items-center text-center px-4">
                <div>
                    <div className="text-[24px] font-bold tabular-nums leading-none">{prob == null ? "—" : `${Math.round(prob * 100)}`}<span className="text-[13px] font-semibold">{prob == null ? "" : " %"}</span></div>
                    {/* El número es lo del anillo (la probabilidad del estado que avisa); abajo, lo que decide.
                        Sin el «dice», «43 % Carril vacío» se leía como 43 % de carril vacío. */}
                    <div className="text-[9.5px] text-muted-foreground leading-none mt-1">{prob == null ? "" : "dice"}</div>
                    <div className="text-[10.5px] font-semibold leading-tight line-clamp-2" style={{ color }}>{prob == null ? "sin mirar" : avisa ? positivo : negativo}</div>
                </div>
            </div>
        </div>
    );
}

/**
 * Dónde mira: el cuadro de la cámara (el mismo stream que analiza el worker) con la zona encima,
 * un borde que «camina» y el resto del cuadro apagado, para que se entienda que sólo importa eso.
 */
export function ZonaSobreCuadro({ deviceId, zona, className }: { deviceId: string; zona: [number, number][]; className?: string }) {
    const [cargada, setCargada] = useState(false);
    const pts = zona.map(([x, y]) => `${x * 1000},${y * 1000}`).join(" ");
    return (
        <div className={cn("relative bg-black overflow-hidden", className)}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/vision/cuadro?camara=${encodeURIComponent(deviceId)}`} alt="" onLoad={() => setCargada(true)} className="absolute inset-0 w-full h-full object-fill" draggable={false} />
            {cargada && zona.length >= 3 && (
                <svg viewBox="0 0 1000 1000" preserveAspectRatio="none" className="absolute inset-0 w-full h-full">
                    <defs>
                        <mask id={`fuera-${deviceId}`}>
                            <rect width="1000" height="1000" fill="white" />
                            <polygon points={pts} fill="black" />
                        </mask>
                    </defs>
                    <rect width="1000" height="1000" fill="rgba(2,6,23,0.55)" mask={`url(#fuera-${deviceId})`} />
                    <polygon points={pts} fill="none" stroke="var(--accion-en-oscuro,#60a5fa)" strokeWidth="3" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeDasharray="10 7">
                        <animate attributeName="stroke-dashoffset" from="0" to="-34" dur="1.2s" repeatCount="indefinite" />
                    </polygon>
                </svg>
            )}
        </div>
    );
}
