"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { X, ChevronLeft, ChevronRight, Camera, Clock, ZoomIn, ZoomOut, Maximize2 } from "lucide-react";
import { cn } from "@/lib/utils";

export type CuadroAvistamiento = {
    plate: string;
    cameraName?: string | null;
    deviceId?: string | null;
    timestamp: string | Date;
    confidence?: number | null;
    reads?: number | null;
    snapshotUrl?: string | null;
};

/**
 * Visor del cuadro de un avistamiento.
 *
 * Una ventana que abraza la imagen, no una foto pegada al borde de la pantalla con los
 * datos desparramados en las esquinas. Los rótulos van SOBRE la imagen, sobre una
 * sombra degradada que los hace legibles sin tapar nada, y la ventana mide lo que mide
 * la foto: así se lee como una ficha y no como una pantalla completa.
 *
 * Se puede acercar. Una matrícula chica en un cuadro de calle es justo lo que hay que
 * mirar de cerca para saber si el lector acertó, y sin acercar no se distingue una B de
 * una 8. El zoom va al puntero — no al centro — porque lo que interesa casi nunca está
 * en el medio, y con la rueda, el doble clic o el pellizco.
 */

const ESCALA_MAX = 8;
const ESCALA_DOBLE_CLIC = 3;

/** Que la imagen no se pueda arrastrar fuera de su propio marco. */
function acotar(pos: { x: number; y: number }, escala: number, caja: DOMRect | null) {
    if (!caja || escala <= 1) return { x: 0, y: 0 };
    const margenX = (caja.width * (escala - 1)) / 2;
    const margenY = (caja.height * (escala - 1)) / 2;
    return {
        x: Math.max(-margenX, Math.min(margenX, pos.x)),
        y: Math.max(-margenY, Math.min(margenY, pos.y)),
    };
}
export function VisorCuadro({ fila, hayAnterior, haySiguiente, onAnterior, onSiguiente, onCerrar }: {
    fila: CuadroAvistamiento;
    hayAnterior?: boolean;
    haySiguiente?: boolean;
    onAnterior?: () => void;
    onSiguiente?: () => void;
    onCerrar: () => void;
}) {
    const [escala, setEscala] = useState(1);
    const [pos, setPos] = useState({ x: 0, y: 0 });
    const marco = useRef<HTMLDivElement | null>(null);
    const arrastre = useRef<{ x: number; y: number; px: number; py: number; movio: boolean } | null>(null);
    const pellizco = useRef<number | null>(null);

    const acercado = escala > 1.01;

    const reiniciar = useCallback(() => { setEscala(1); setPos({ x: 0, y: 0 }); }, []);

    // Cada foto se abre sin acercar: heredar el zoom de la anterior desorienta.
    useEffect(() => { reiniciar(); }, [fila.snapshotUrl, reiniciar]);

    /**
     * Acerca manteniendo quieto el punto que está bajo el puntero.
     * Escalar sobre el centro hace que lo que se quería mirar se escape del marco.
     */
    const zoomEn = useCallback((nueva: number, clienteX?: number, clienteY?: number) => {
        const caja = marco.current?.getBoundingClientRect() || null;
        const destino = Math.max(1, Math.min(ESCALA_MAX, nueva));
        setPos((p) => {
            if (destino <= 1) return { x: 0, y: 0 };
            if (!caja || clienteX == null || clienteY == null) return acotar(p, destino, caja);
            const cx = clienteX - (caja.left + caja.width / 2);
            const cy = clienteY - (caja.top + caja.height / 2);
            const k = destino / (escala || 1);
            return acotar({ x: cx - (cx - p.x) * k, y: cy - (cy - p.y) * k }, destino, caja);
        });
        setEscala(destino);
    }, [escala]);

    useEffect(() => {
        const tecla = (e: KeyboardEvent) => {
            if (e.key === "Escape") { if (acercado) { reiniciar(); return; } onCerrar(); }
            if (e.key === "ArrowLeft" && hayAnterior && !acercado) onAnterior?.();
            if (e.key === "ArrowRight" && haySiguiente && !acercado) onSiguiente?.();
            if (e.key === "+" || e.key === "=") zoomEn(escala * 1.5);
            if (e.key === "-" || e.key === "_") zoomEn(escala / 1.5);
            if (e.key === "0") reiniciar();
        };
        window.addEventListener("keydown", tecla);
        return () => window.removeEventListener("keydown", tecla);
    }, [hayAnterior, haySiguiente, onAnterior, onSiguiente, onCerrar, acercado, escala, zoomEn, reiniciar]);

    // La rueda se escucha a mano y no con onWheel: React lo registra como pasivo y no
    // deja frenar el desplazamiento de la página detrás del visor.
    useEffect(() => {
        const el = marco.current;
        if (!el) return;
        const rueda = (e: WheelEvent) => {
            e.preventDefault();
            zoomEn(escala * (e.deltaY < 0 ? 1.18 : 1 / 1.18), e.clientX, e.clientY);
        };
        el.addEventListener("wheel", rueda, { passive: false });
        return () => el.removeEventListener("wheel", rueda);
    }, [escala, zoomEn]);

    const conf = typeof fila.confidence === "number" ? Math.round(fila.confidence * 100) : null;
    const momento = new Date(fila.timestamp);
    const tonoConf = conf == null ? "" : conf >= 85 ? "text-emerald-300" : conf >= 65 ? "text-amber-300" : "text-rose-300";

    return (
        <div onClick={onCerrar}
            className="fixed inset-0 z-[3400] bg-black/80 backdrop-blur-md flex items-center justify-center p-6 animate-in fade-in duration-150">
            {/* Arrastrar la foto acercada no debe cerrar el visor: el puntero termina
                sobre el fondo y eso contaba como clic afuera. */}

            <motion.div
                initial={{ opacity: 0, scale: 0.97, y: 8 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                transition={{ type: "spring", stiffness: 380, damping: 30, mass: 0.7 }}
                onClick={(e) => e.stopPropagation()}
                className="relative inline-block rounded-2xl overflow-hidden border border-white/[0.12] shadow-2xl shadow-black/70 bg-[#0a0d12] max-w-[min(1100px,92vw)]">

                <div
                    ref={marco}
                    className={cn("relative overflow-hidden", acercado ? (arrastre.current ? "cursor-grabbing" : "cursor-grab") : "cursor-zoom-in")}
                    onDoubleClick={(e) => zoomEn(acercado ? 1 : ESCALA_DOBLE_CLIC, e.clientX, e.clientY)}
                    onPointerDown={(e) => {
                        if (!acercado) return;
                        (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
                        arrastre.current = { x: e.clientX, y: e.clientY, px: pos.x, py: pos.y, movio: false };
                    }}
                    onPointerMove={(e) => {
                        const a = arrastre.current;
                        if (!a) return;
                        const dx = e.clientX - a.x, dy = e.clientY - a.y;
                        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) a.movio = true;
                        setPos(acotar({ x: a.px + dx, y: a.py + dy }, escala, marco.current?.getBoundingClientRect() || null));
                    }}
                    onPointerUp={() => { arrastre.current = null; }}
                    onPointerCancel={() => { arrastre.current = null; }}
                    onTouchStart={(e) => {
                        if (e.touches.length === 2) {
                            pellizco.current = Math.hypot(
                                e.touches[0].clientX - e.touches[1].clientX,
                                e.touches[0].clientY - e.touches[1].clientY,
                            );
                        }
                    }}
                    onTouchMove={(e) => {
                        if (e.touches.length !== 2 || pellizco.current == null) return;
                        const d = Math.hypot(
                            e.touches[0].clientX - e.touches[1].clientX,
                            e.touches[0].clientY - e.touches[1].clientY,
                        );
                        zoomEn(escala * (d / pellizco.current),
                            (e.touches[0].clientX + e.touches[1].clientX) / 2,
                            (e.touches[0].clientY + e.touches[1].clientY) / 2);
                        pellizco.current = d;
                    }}
                    onTouchEnd={() => { pellizco.current = null; }}
                >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={fila.snapshotUrl || ""} alt={fila.plate}
                        style={{
                            transform: `translate3d(${pos.x}px, ${pos.y}px, 0) scale(${escala})`,
                            transition: arrastre.current || pellizco.current != null ? "none" : "transform 160ms cubic-bezier(.22,1,.36,1)",
                        }}
                        className="block max-h-[76vh] max-w-full w-auto select-none origin-center"
                        draggable={false} />
                </div>

                {/* Sombra de arriba: hace legibles los rótulos sin taparle nada a la imagen */}
                <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-black/85 via-black/45 to-transparent pointer-events-none" />

                <div className="absolute inset-x-0 top-0 p-3 flex items-start gap-3">
                    <div className="flex items-center gap-2.5 min-w-0">
                        <span className="px-2.5 py-1 rounded-lg bg-white text-black font-mono text-base font-bold tracking-widest shadow-lg">
                            {fila.plate}
                        </span>
                        <div className="min-w-0">
                            <div className="text-[12px] font-semibold text-white/95 truncate flex items-center gap-1.5">
                                <Camera size={11} className="text-white/50 shrink-0" />
                                {fila.cameraName || fila.deviceId || "cámara desconocida"}
                            </div>
                            <div className="text-[10.5px] text-white/60 tabular-nums flex items-center gap-1.5">
                                <Clock size={10} className="text-white/40 shrink-0" />
                                {momento.toLocaleDateString("es-UY", { day: "2-digit", month: "short" })} · {momento.toLocaleTimeString("es-UY")}
                            </div>
                        </div>
                    </div>

                    <div className="ml-auto flex items-center gap-2 shrink-0">
                        {conf != null && (
                            <div className="px-2.5 py-1 rounded-lg bg-black/45 backdrop-blur-sm border border-white/10 text-center">
                                <div className={cn("text-sm font-bold tabular-nums leading-none", tonoConf)}>{conf}%</div>
                                <div className="text-[9px] text-white/45 mt-0.5 leading-none">confianza</div>
                            </div>
                        )}
                        {fila.reads != null && (
                            <div className="px-2.5 py-1 rounded-lg bg-black/45 backdrop-blur-sm border border-white/10 text-center">
                                <div className="text-sm font-bold tabular-nums leading-none text-white">{fila.reads}</div>
                                <div className="text-[9px] text-white/45 mt-0.5 leading-none">cuadros</div>
                            </div>
                        )}
                        <div className="flex items-center rounded-lg bg-black/45 backdrop-blur-sm border border-white/10 overflow-hidden">
                            <button onClick={() => zoomEn(escala / 1.6)} disabled={!acercado} title="Alejar  ( − )"
                                className="w-8 h-8 text-white/70 hover:text-white hover:bg-white/10 disabled:opacity-25 disabled:hover:bg-transparent flex items-center justify-center transition-colors">
                                <ZoomOut size={14} />
                            </button>
                            <span className="px-1.5 text-[10px] font-semibold tabular-nums text-white/55 select-none">
                                {escala.toFixed(1)}×
                            </span>
                            <button onClick={() => zoomEn(escala * 1.6)} disabled={escala >= ESCALA_MAX} title="Acercar  ( + )"
                                className="w-8 h-8 text-white/70 hover:text-white hover:bg-white/10 disabled:opacity-25 disabled:hover:bg-transparent flex items-center justify-center transition-colors">
                                <ZoomIn size={14} />
                            </button>
                            {acercado && (
                                <button onClick={reiniciar} title="Volver al tamaño original  ( 0 )"
                                    className="w-8 h-8 text-white/70 hover:text-white hover:bg-white/10 flex items-center justify-center transition-colors border-l border-white/10">
                                    <Maximize2 size={13} />
                                </button>
                            )}
                        </div>
                        <button onClick={onCerrar}
                            className="w-8 h-8 rounded-lg bg-black/45 backdrop-blur-sm border border-white/10 text-white/70 hover:text-white hover:bg-black/70 flex items-center justify-center transition-colors">
                            <X size={15} />
                        </button>
                    </div>
                </div>

                {/* Moverse entre avistamientos, dentro de la ventana */}
                {hayAnterior && !acercado && (
                    <button onClick={onAnterior}
                        className="absolute left-2.5 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-black/50 backdrop-blur-sm border border-white/10 text-white/70 hover:text-white hover:bg-black/75 flex items-center justify-center transition-colors">
                        <ChevronLeft size={17} />
                    </button>
                )}
                {haySiguiente && !acercado && (
                    <button onClick={onSiguiente}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-black/50 backdrop-blur-sm border border-white/10 text-white/70 hover:text-white hover:bg-black/75 flex items-center justify-center transition-colors">
                        <ChevronRight size={17} />
                    </button>
                )}

                {(hayAnterior || haySiguiente || acercado) && (
                    <>
                        <div className="absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-black/70 to-transparent pointer-events-none" />
                        <div className="absolute inset-x-0 bottom-2 text-center text-[10px] text-white/45 pointer-events-none">
                            {acercado
                                ? "arrastrá para moverte · doble clic o 0 para volver"
                                : "rueda o doble clic para acercar · ← → para moverse · Esc para cerrar"}
                        </div>
                    </>
                )}
            </motion.div>
        </div>
    );
}
