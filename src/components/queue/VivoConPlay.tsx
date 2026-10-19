"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Play, Pause } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * El vivo de una cámara de filas, pausado de entrada.
 *
 * Pedido de Nico (HB, 19/10): que los videos en vivo vengan pausados y se les dé play. En el
 * Hospital Británico la salida es un LTE: cada pantalla abierta con el vivo andando se come el
 * enlace aunque nadie la mire. Hasta el play se muestra una foto de la cámara (se refresca sola)
 * y el stream ni se pide; al pausar se desmonta el reproductor, así go2rtc corta la conexión.
 */

/** Cada cuánto se renueva la foto mientras el vivo está pausado. */
const REFRESCO_FOTO_MS = 15_000;

export function VivoConPlay({ deviceId, children, className, compacto = false }: {
    deviceId: string;
    /** El reproductor del vivo: sólo se monta después del play. */
    children: ReactNode;
    className?: string;
    /** Botón chico en la esquina en vez de centrado (para editores con cosas encima del video). */
    compacto?: boolean;
}) {
    const [andando, setAndando] = useState(false);
    const [marca, setMarca] = useState(() => Date.now());
    const [sinFoto, setSinFoto] = useState(false);

    useEffect(() => {
        if (andando) return;
        const t = setInterval(() => setMarca(Date.now()), REFRESCO_FOTO_MS);
        return () => clearInterval(t);
    }, [andando]);

    const alternar = (e: React.MouseEvent) => {
        e.stopPropagation();
        setAndando((v) => !v);
        setMarca(Date.now());
    };

    return (
        <div className={cn("absolute inset-0", className)}>
            {andando ? children : (
                sinFoto
                    ? <div className="absolute inset-0 bg-muted" />
                    // eslint-disable-next-line @next/next/no-img-element
                    : <img src={`/api/snapshot/${deviceId}?t=${marca}`} alt="" onError={() => setSinFoto(true)} onLoad={() => setSinFoto(false)}
                        className="absolute inset-0 w-full h-full object-cover" />
            )}
            {!andando && !compacto ? (
                <button type="button" onClick={alternar} title="Ver en vivo" aria-label="Ver en vivo"
                    className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-20 flex items-center gap-2 rounded-full bg-background/85 backdrop-blur px-4 py-2.5 text-sm font-semibold text-foreground shadow-lg border border-border hover:bg-background transition">
                    <Play size={16} className="fill-current" /> En vivo
                </button>
            ) : (
                <button type="button" onClick={alternar} title={andando ? "Pausar el vivo" : "Ver en vivo"} aria-label={andando ? "Pausar el vivo" : "Ver en vivo"}
                    className="absolute left-2 bottom-2 z-20 flex items-center gap-1.5 rounded-full bg-background/80 backdrop-blur px-2.5 py-1 text-[11px] font-semibold text-foreground shadow border border-border hover:bg-background transition">
                    {andando ? <Pause size={12} className="fill-current" /> : <Play size={12} className="fill-current" />}
                    {andando ? "Pausar" : "En vivo"}
                </button>
            )}
        </div>
    );
}
