"use client";

import { useEffect } from "react";
import { motion } from "framer-motion";
import { X, ChevronLeft, ChevronRight, Camera, Clock } from "lucide-react";
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
 */
export function VisorCuadro({ fila, hayAnterior, haySiguiente, onAnterior, onSiguiente, onCerrar }: {
    fila: CuadroAvistamiento;
    hayAnterior?: boolean;
    haySiguiente?: boolean;
    onAnterior?: () => void;
    onSiguiente?: () => void;
    onCerrar: () => void;
}) {
    useEffect(() => {
        const tecla = (e: KeyboardEvent) => {
            if (e.key === "Escape") onCerrar();
            if (e.key === "ArrowLeft" && hayAnterior) onAnterior?.();
            if (e.key === "ArrowRight" && haySiguiente) onSiguiente?.();
        };
        window.addEventListener("keydown", tecla);
        return () => window.removeEventListener("keydown", tecla);
    }, [hayAnterior, haySiguiente, onAnterior, onSiguiente, onCerrar]);

    const conf = typeof fila.confidence === "number" ? Math.round(fila.confidence * 100) : null;
    const momento = new Date(fila.timestamp);
    const tonoConf = conf == null ? "" : conf >= 85 ? "text-emerald-300" : conf >= 65 ? "text-amber-300" : "text-rose-300";

    return (
        <div onClick={onCerrar}
            className="fixed inset-0 z-[3400] bg-black/80 backdrop-blur-md flex items-center justify-center p-6 animate-in fade-in duration-150">

            <motion.div
                initial={{ opacity: 0, scale: 0.97, y: 8 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                transition={{ type: "spring", stiffness: 380, damping: 30, mass: 0.7 }}
                onClick={(e) => e.stopPropagation()}
                className="relative inline-block rounded-2xl overflow-hidden border border-white/[0.12] shadow-2xl shadow-black/70 bg-[#0a0d12] max-w-[min(1100px,92vw)]">

                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={fila.snapshotUrl || ""} alt={fila.plate}
                    className="block max-h-[76vh] max-w-full w-auto select-none" draggable={false} />

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
                        <button onClick={onCerrar}
                            className="w-8 h-8 rounded-lg bg-black/45 backdrop-blur-sm border border-white/10 text-white/70 hover:text-white hover:bg-black/70 flex items-center justify-center transition-colors">
                            <X size={15} />
                        </button>
                    </div>
                </div>

                {/* Moverse entre avistamientos, dentro de la ventana */}
                {hayAnterior && (
                    <button onClick={onAnterior}
                        className="absolute left-2.5 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-black/50 backdrop-blur-sm border border-white/10 text-white/70 hover:text-white hover:bg-black/75 flex items-center justify-center transition-colors">
                        <ChevronLeft size={17} />
                    </button>
                )}
                {haySiguiente && (
                    <button onClick={onSiguiente}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-black/50 backdrop-blur-sm border border-white/10 text-white/70 hover:text-white hover:bg-black/75 flex items-center justify-center transition-colors">
                        <ChevronRight size={17} />
                    </button>
                )}

                {(hayAnterior || haySiguiente) && (
                    <>
                        <div className="absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-black/70 to-transparent pointer-events-none" />
                        <div className="absolute inset-x-0 bottom-2 text-center text-[10px] text-white/45 pointer-events-none">
                            ← → para moverse · Esc para cerrar
                        </div>
                    </>
                )}
            </motion.div>
        </div>
    );
}
