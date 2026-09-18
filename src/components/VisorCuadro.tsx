"use client";

import { useEffect } from "react";
import { X, ChevronLeft, ChevronRight } from "lucide-react";
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
 * La foto sin marco ni recuadro, tan grande como entre, y los datos encima. Lo que uno
 * quiere ahí es poder mirar la matrícula: cualquier cosa que le robe lugar a la imagen
 * está de más. Los datos flotan en las esquinas y se pasa de un avistamiento al otro con
 * el teclado, sin volver a la lista.
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

    return (
        <div onClick={onCerrar}
            className="fixed inset-0 z-[3400] bg-black/95 backdrop-blur-sm flex items-center justify-center animate-in fade-in duration-150">

            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={fila.snapshotUrl || ""} alt={fila.plate}
                onClick={(e) => e.stopPropagation()}
                className="max-h-screen max-w-full object-contain select-none" draggable={false} />

            <div className="absolute top-5 left-5 flex items-center gap-3 pointer-events-none">
                <span className="px-3 py-1.5 rounded-lg bg-black/60 backdrop-blur border border-white/15 font-mono text-xl font-bold tracking-widest text-white">
                    {fila.plate}
                </span>
                <div className="px-3 py-1.5 rounded-lg bg-black/50 backdrop-blur border border-white/10">
                    <div className="text-[11px] font-semibold text-white/90">{fila.cameraName || fila.deviceId || "cámara desconocida"}</div>
                    <div className="text-[10px] text-white/55 tabular-nums">
                        {momento.toLocaleDateString("es-UY", { day: "2-digit", month: "short", year: "numeric" })} · {momento.toLocaleTimeString("es-UY")}
                    </div>
                </div>
            </div>

            <div className="absolute top-5 right-5 flex items-center gap-2">
                {conf != null && (
                    <div className="px-3 py-1.5 rounded-lg bg-black/50 backdrop-blur border border-white/10 text-center pointer-events-none">
                        <div className={cn("text-lg font-bold tabular-nums leading-none",
                            conf >= 85 ? "text-emerald-400" : conf >= 65 ? "text-amber-400" : "text-red-400")}>{conf}%</div>
                        <div className="text-[10px] text-white/50 mt-0.5">confianza</div>
                    </div>
                )}
                {fila.reads != null && (
                    <div className="px-3 py-1.5 rounded-lg bg-black/50 backdrop-blur border border-white/10 text-center pointer-events-none">
                        <div className="text-lg font-bold tabular-nums leading-none text-white">{fila.reads}</div>
                        <div className="text-[10px] text-white/50 mt-0.5">cuadros de acuerdo</div>
                    </div>
                )}
                <button onClick={(e) => { e.stopPropagation(); onCerrar(); }}
                    className="w-10 h-10 rounded-lg bg-black/50 backdrop-blur border border-white/10 text-white/70 hover:text-white hover:bg-black/70 flex items-center justify-center">
                    <X size={18} />
                </button>
            </div>

            {hayAnterior && (
                <button onClick={(e) => { e.stopPropagation(); onAnterior?.(); }}
                    className="absolute left-4 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-black/50 backdrop-blur border border-white/10 text-white/70 hover:text-white hover:bg-black/70 flex items-center justify-center">
                    <ChevronLeft size={20} />
                </button>
            )}
            {haySiguiente && (
                <button onClick={(e) => { e.stopPropagation(); onSiguiente?.(); }}
                    className="absolute right-4 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-black/50 backdrop-blur border border-white/10 text-white/70 hover:text-white hover:bg-black/70 flex items-center justify-center">
                    <ChevronRight size={20} />
                </button>
            )}

            {(hayAnterior || haySiguiente) && (
                <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-[10px] text-white/35 pointer-events-none">
                    ← → para moverse · Esc para cerrar
                </div>
            )}
        </div>
    );
}
