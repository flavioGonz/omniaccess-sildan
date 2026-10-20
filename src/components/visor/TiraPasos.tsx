"use client";

import { useEffect, useRef } from "react";
import { ChevronLeft, ChevronRight, ImageOff, LogIn, LogOut, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { fechaCorta, horaSeg } from "@/lib/fechas";

/** Un paso de la chapa: cuándo, por dónde, y la foto si la hay. */
export type PasoVisor = {
    id?: string;
    momento: string | Date;
    camara?: string | null;
    direccion?: string | null;
    decision?: string | null;
    foto?: string | null;
    /** El evento que está abierto en el visor. */
    actual?: boolean;
};

/**
 * Ancho de la miniatura pedida al servidor: el doble de lo que se dibuja, por pantallas densas.
 * /api/files la achica y la guarda; las otras rutas ignoran `w`. Una foto LPR entera pesa 1-2 MB,
 * y la tira puede tener doscientas.
 */
const MINIATURA_W = 320;
const conAncho = (u: string) => `${u}${u.includes("?") ? "&" : "?"}w=${MINIATURA_W}`;

/**
 * Los pasos anteriores, como tira de fotos.
 *
 * Eran una lista de texto (cámara · fecha · hora) metida en la ficha: decía cuándo pasó, pero lo
 * que uno quiere al mirar pasos anteriores es comparar — ¿es el mismo auto?, ¿venía con la misma
 * gente? — y eso se hace con la foto. La tira corre de lo más nuevo a lo más viejo, de izquierda
 * a derecha, y tocar un cuadro lo muestra en grande en el visor, sin perder el evento: arriba
 * queda el aviso para volver.
 *
 * Va abajo, a lo ancho, y se abre con un botón: es una consulta, no algo que haga falta ver
 * cada vez que se abre un evento.
 */
export function TiraPasos({ pasos, viendo, onElegir, onCerrar, cargando }: {
    pasos: PasoVisor[];
    /** La clave del paso que se está mostrando en grande. */
    viendo?: string | null;
    onElegir: (p: PasoVisor) => void;
    onCerrar: () => void;
    cargando?: boolean;
}) {
    const tira = useRef<HTMLDivElement | null>(null);
    // La rueda vertical corre la tira a lo ancho: con el mouse no hay otra forma cómoda.
    useEffect(() => {
        const el = tira.current;
        if (!el) return;
        const rueda = (e: WheelEvent) => {
            if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
            e.preventDefault();
            el.scrollLeft += e.deltaY;
        };
        el.addEventListener("wheel", rueda, { passive: false });
        return () => el.removeEventListener("wheel", rueda);
    }, []);
    const correr = (dir: number) => tira.current?.scrollBy({ left: dir * tira.current.clientWidth * 0.8, behavior: "smooth" });

    return (
        <div className="absolute inset-x-0 bottom-0 z-[35] pt-10 pb-3 bg-gradient-to-t from-background/95 via-background/80 to-transparent">
            <div className="flex items-center justify-between px-5 md:px-7 mb-2">
                <div className="text-[12.5px] font-semibold text-foreground">
                    Pasos anteriores <span className="text-muted-foreground font-normal tabular-nums">· {pasos.length}</span>
                </div>
                <div className="flex items-center gap-1">
                    <button type="button" onClick={() => correr(-1)} aria-label="Más nuevos" className="w-7 h-7 rounded-[6px] grid place-items-center text-foreground/80 hover:text-foreground hover:bg-muted"><ChevronLeft size={16} /></button>
                    <button type="button" onClick={() => correr(1)} aria-label="Más viejos" className="w-7 h-7 rounded-[6px] grid place-items-center text-foreground/80 hover:text-foreground hover:bg-muted"><ChevronRight size={16} /></button>
                    <button type="button" onClick={onCerrar} aria-label="Cerrar la tira" title="Cerrar  ( Esc )" className="w-7 h-7 rounded-[6px] grid place-items-center text-foreground/80 hover:text-foreground hover:bg-muted ml-1"><X size={15} /></button>
                </div>
            </div>
            {cargando ? (
                <div className="px-5 md:px-7 text-[12px] text-muted-foreground">Buscando los pasos…</div>
            ) : !pasos.length ? (
                <div className="px-5 md:px-7 text-[12px] text-muted-foreground">Es la primera vez que se ve esta matrícula en lo registrado.</div>
            ) : (
                <div ref={tira} className="flex gap-2.5 overflow-x-auto px-5 md:px-7 pb-1 [scrollbar-width:thin] snap-x">
                    {pasos.map((p, i) => {
                        const clave = claveDePaso(p, i);
                        const activo = viendo === clave;
                        const salida = p.direccion === "EXIT";
                        const negado = p.decision === "DENY";
                        return (
                            <button key={clave} type="button" onClick={() => onElegir({ ...p, id: clave })} disabled={!p.foto}
                                className={cn("snap-start shrink-0 w-[168px] text-left rounded-[8px] p-1 transition-colors disabled:cursor-default",
                                    activo ? "bg-muted ring-1 ring-foreground/50" : "hover:bg-muted")}>
                                <span className="relative block aspect-video rounded-[6px] overflow-hidden bg-muted/60">
                                    {p.foto
                                        /* eslint-disable-next-line @next/next/no-img-element */
                                        ? <img src={conAncho(p.foto)} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover" />
                                        : <span className="absolute inset-0 grid place-items-center text-muted-foreground"><ImageOff size={18} /></span>}
                                    {negado && <span className="absolute top-1 left-1 px-1.5 py-px rounded-[4px] pleno-mal text-[9.5px] font-bold">No abrió</span>}
                                </span>
                                <span className="flex items-center gap-1.5 mt-1.5 text-[11.5px] text-foreground font-semibold tabular-nums">
                                    {p.direccion ? (salida ? <LogOut size={11} className="text-muted-foreground" /> : <LogIn size={11} className="text-muted-foreground" />) : null}
                                    {fechaCorta(p.momento)} · {horaSeg(p.momento)}
                                </span>
                                <span className="block text-[11px] text-muted-foreground truncate">{p.camara || "Cámara sin nombre"}</span>
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

/** La clave de un paso para saber cuál se está mostrando (hay pasos sin id). */
export const claveDePaso = (p: PasoVisor, i: number) => p.id || `${new Date(p.momento).getTime()}-${i}`;
