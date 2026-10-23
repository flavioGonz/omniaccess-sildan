"use client";

import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";

/**
 * La ventana para trabajar sobre la escena de una cámara: dibujar los lugares de un
 * estacionamiento, la zona de una fila, mirar el mapa de calor (21/10, Nico: «debe ser más
 * profesional, premium; la cámara se ve muy grande, ocupa casi toda la pantalla; deben ser tablas
 * con las plazas definidas, al presionarlas se abrirá un modal estilizado para dibujar»).
 *
 * Las pantallas pasan a ser tablas, y la cámara grande vive acá: a la izquierda la escena, que
 * entra ENTERA en el lugar que hay (contain, por unidades de contenedor: nunca se recorta ni se
 * estira, y lo dibujado cae donde el worker lo mira); a la derecha el panel con los datos y los
 * controles, y abajo las acciones. Oscura siempre, como el visor: es una vista de cámara.
 *
 * `aspecto` es el de la cámara; `escena` es lo que se dibuja en esa caja (foto + capas), que
 * recibe la caja exacta de la imagen.
 */
export function ModalEscena({ abierto, alCerrar, titulo, subtitulo, chips, aspecto = 16 / 9, escena, sobreEscena, panel, pie, className }: {
    abierto: boolean;
    alCerrar: () => void;
    titulo: string;
    subtitulo?: React.ReactNode;
    /** Estado arriba de la escena (mirando, apagada…). */
    chips?: React.ReactNode;
    aspecto?: number;
    /** El contenido de la caja de la imagen: la foto y lo dibujado encima, en fracciones. */
    escena: React.ReactNode;
    /** Lo que va sobre la escena pero fuera de la caja de la imagen (una ayuda abajo). */
    sobreEscena?: React.ReactNode;
    panel: React.ReactNode;
    pie?: React.ReactNode;
    className?: string;
}) {
    return (
        <Dialog open={abierto} onOpenChange={(o) => { if (!o) alCerrar(); }}>
            <DialogContent showCloseButton={false}
                className={cn("p-0 gap-0 overflow-hidden border border-white/10 rounded-[14px] bg-[#0b0f16] text-white sm:max-w-[1240px] w-[96vw] h-[min(86vh,780px)]",
                    "grid grid-cols-1 grid-rows-[minmax(0,1fr)_auto] lg:grid-rows-1 lg:grid-cols-[minmax(0,1fr)_360px] shadow-[0_12px_34px_-10px_rgba(0,0,0,0.45)]", className)}>
                <DialogTitle className="sr-only">{titulo}</DialogTitle>
                <DialogDescription className="sr-only">{typeof subtitulo === "string" ? subtitulo : titulo}</DialogDescription>

                {/* ── La escena ── */}
                <div className="relative min-h-[240px] bg-[#05070b] overflow-hidden">
                    <div className="absolute inset-x-0 top-0 z-10 px-5 pt-4 pb-10 bg-gradient-to-b from-black/75 to-transparent pointer-events-none">
                        <div className="flex items-center gap-2 flex-wrap pointer-events-auto">
                            <h2 className="text-[17px] font-bold tracking-[-0.01em] leading-tight truncate max-w-[60%]">{titulo}</h2>
                            {chips}
                        </div>
                        {subtitulo && <div className="mt-0.5 text-[12px] text-white/65 truncate">{subtitulo}</div>}
                    </div>
                    {/* Cabe entera: el ancho y el alto que permite el lugar, con la forma de la cámara. */}
                    <div className="absolute inset-0 px-5 pt-16 pb-12 [container-type:size] grid place-items-center">
                        <div className="relative rounded-[10px] overflow-hidden bg-black select-none"
                            style={{ width: `min(100cqw, calc(100cqh * ${aspecto}))`, height: `min(100cqh, calc(100cqw / ${aspecto}))` }}>
                            {escena}
                        </div>
                    </div>
                    {sobreEscena && <div className="absolute inset-x-0 bottom-0 z-10 px-5 pb-3.5 pt-6 bg-gradient-to-t from-black/70 to-transparent">{sobreEscena}</div>}
                </div>

                {/* ── El panel ── */}
                <div className="relative flex flex-col min-h-0 border-t lg:border-t-0 lg:border-l border-white/10 bg-[#0f141c]">
                    <button type="button" onClick={alCerrar} aria-label="Cerrar" title="Cerrar  ( Esc )"
                        className="absolute right-3 top-3 z-10 w-8 h-8 rounded-full grid place-items-center text-white/70 hover:text-white hover:bg-white/10"><X size={16} /></button>
                    <div className="flex-1 min-h-0 overflow-y-auto px-5 pt-5 pb-4 space-y-5 [scrollbar-width:thin]">{panel}</div>
                    {pie && <div className="shrink-0 px-5 py-3.5 border-t border-white/10 flex items-center gap-2">{pie}</div>}
                </div>
            </DialogContent>
        </Dialog>
    );
}

/** Un bloque del panel: rótulo chico y su contenido. */
export function BloquePanel({ rotulo, extra, children }: { rotulo: string; extra?: React.ReactNode; children: React.ReactNode }) {
    return (
        <section>
            <div className="flex items-baseline justify-between mb-2">
                <span className="text-[9px] font-bold uppercase tracking-[0.14em] text-white/45">{rotulo}</span>
                {extra}
            </div>
            {children}
        </section>
    );
}

/** Una cifra del panel: el número grande y qué es. */
export function CifraPanel({ n, rotulo, tono }: { n: React.ReactNode; rotulo: string; tono?: string }) {
    return (
        <div className="rounded-[10px] bg-white/[0.05] px-3 py-2.5 min-w-0">
            <div className="text-[20px] font-bold tabular-nums leading-none truncate" style={tono ? { color: tono } : undefined}>{n}</div>
            <div className="mt-1 text-[11px] text-white/55 truncate">{rotulo}</div>
        </div>
    );
}

/** Los botones del pie del panel, en el idioma oscuro de la ventana. */
export function BotonPanel({ children, onClick, primario, peligro, disabled, className, type = "button" }: {
    children: React.ReactNode; onClick?: () => void; primario?: boolean; peligro?: boolean; disabled?: boolean; className?: string; type?: "button" | "submit";
}) {
    return (
        <button type={type} onClick={onClick} disabled={disabled}
            className={cn("h-9 px-3.5 rounded-[6px] text-[12.5px] font-semibold inline-flex items-center gap-1.5 whitespace-nowrap transition-colors disabled:opacity-45",
                primario ? "bg-[var(--accion)] text-white hover:brightness-110" : peligro ? "text-[var(--mal)] hover:bg-[color-mix(in_oklab,var(--mal)_14%,transparent)]" : "text-white/80 hover:text-white bg-white/[0.06] hover:bg-white/[0.12]",
                className)}>
            {children}
        </button>
    );
}
