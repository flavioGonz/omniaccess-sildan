"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { Camera, X } from "lucide-react";
import type { TrackLink } from "@/app/actions/detections";
import { cn } from "@/lib/utils";
import type { Canal } from "./piezas";

/**
 * El seguimiento visual en la baldosa de la pared (pedido de Nico, 15/10: «en la vista mini debe
 * recordar el visual track», y configurarlo ahí mismo arrastrando una cámara encima).
 *
 * Son los mismos enlaces que la cámara abierta (Setting VISUAL_TRACK_LINKS, por idCanal, en 0–1
 * del CUADRO de la cámara). La baldosa recorta el video con «cover», así que un punto del cuadro
 * cae en otro lugar de la baldosa que de la pantalla completa: se calcula dónde queda el cuadro
 * (con la proporción medida del video, o 16:9 si todavía no se midió) y se dibuja ahí. Un punto
 * que la baldosa recorta queda pegado al borde, para que se sepa que está.
 *
 * Mirando: un ícono chico por vecina; tocarlo abre la vecina. Si la vecina está detectando, late
 * en rojo. Editando: los íconos se arrastran para moverlos y tienen una X para quitarlos; soltar
 * otra baldosa encima crea el enlace en ese punto (eso lo resuelve la baldosa con `aCuadro`).
 */
export type Enlace = { link: TrackLink; destino: Canal; alarma: boolean };
type Rect = { left: number; top: number; width: number; height: number };

/** Dónde queda el cuadro del video dentro de una caja de w×h con object-fit: cover. */
export function cuadroCover(w: number, h: number, aspecto: number): Rect {
    if (w / h > aspecto) { const alto = w / aspecto; return { left: 0, top: (h - alto) / 2, width: w, height: alto }; }
    const ancho = h * aspecto; return { left: (w - ancho) / 2, top: 0, width: ancho, height: h };
}
/** De un punto de la baldosa (px) a 0–1 del cuadro. */
export const aCuadro = (r: Rect, x: number, y: number) => ({
    x: Math.max(0, Math.min(1, (x - r.left) / r.width)), y: Math.max(0, Math.min(1, (y - r.top) / r.height)),
});

export function EnlacesBaldosa({ enlaces, aspecto, editando, chica, alSeguir, alMover, alQuitar }: {
    enlaces: Enlace[];
    /** ancho/alto del video (medido); sin medir, 16:9. */
    aspecto: number;
    editando: boolean;
    /** Baldosa chica (cuadrícula de 16 o 25): íconos más chicos y sin nombre. */
    chica: boolean;
    alSeguir: (destino: Canal) => void;
    alMover: (i: number, x: number, y: number) => void;
    alQuitar: (i: number) => void;
}) {
    const caja = useRef<HTMLDivElement>(null);
    const [tam, setTam] = useState<{ w: number; h: number } | null>(null);
    const [arrastre, setArrastre] = useState<{ i: number; x: number; y: number } | null>(null);
    useLayoutEffect(() => {
        const el = caja.current; if (!el) return;
        const ro = new ResizeObserver(() => setTam({ w: el.clientWidth, h: el.clientHeight }));
        ro.observe(el); setTam({ w: el.clientWidth, h: el.clientHeight });
        return () => ro.disconnect();
    }, []);
    const r = tam ? cuadroCover(tam.w, tam.h, aspecto) : null;
    const lado = chica ? 22 : 30;
    const margen = lado / 2 + 2;

    return (
        // La capa no toma el puntero (debajo está la baldosa, que se arrastra y recibe lo que se
        // suelta): sólo los íconos. El ícono que se arrastra captura el puntero y se mueve solo.
        <div ref={caja} className={cn("absolute inset-0 pointer-events-none", editando ? "z-[15]" : "z-[5]")}>
            {r && enlaces.map(({ link, destino, alarma }, i) => {
                const p = arrastre?.i === i ? arrastre : link;
                // Dentro de la baldosa aunque el cover haya recortado ese punto.
                const left = Math.max(margen, Math.min(tam!.w - margen, r.left + p.x * r.width));
                const top = Math.max(margen, Math.min(tam!.h - margen, r.top + p.y * r.height));
                return (
                    <div key={link.to} className="absolute -translate-x-1/2 -translate-y-1/2 pointer-events-auto" style={{ left, top }}>
                        {editando ? (
                            <div draggable={false}
                                onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); try { e.currentTarget.setPointerCapture(e.pointerId); } catch { } setArrastre({ i, x: link.x, y: link.y }); }}
                                onPointerMove={(e) => {
                                    if (arrastre?.i !== i || !r || !caja.current) return;
                                    const b = caja.current.getBoundingClientRect();
                                    setArrastre({ i, ...aCuadro(r, e.clientX - b.left, e.clientY - b.top) });
                                }}
                                onPointerUp={() => { if (arrastre?.i === i) { alMover(i, arrastre.x, arrastre.y); setArrastre(null); } }}
                                onPointerCancel={() => setArrastre(null)}
                                onClick={(e) => e.stopPropagation()}
                                className="flex items-center gap-1 pl-1.5 pr-0.5 rounded-full visor-panel text-white ring-2 ring-[var(--accion-en-oscuro)] cursor-move select-none touch-none"
                                style={{ height: lado }}>
                                <Camera size={chica ? 11 : 13} className="shrink-0 text-[var(--accion-en-oscuro)]" />
                                {!chica && <span className="text-[11.5px] font-semibold truncate max-w-[110px]">{destino.nombre}</span>}
                                <button type="button" aria-label={`Quitar el enlace a ${destino.nombre}`}
                                    onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); alQuitar(i); }}
                                    className="grid place-items-center rounded-full hover:bg-[var(--mal)] text-white/85" style={{ width: lado - 6, height: lado - 6 }}>
                                    <X size={chica ? 10 : 12} />
                                </button>
                            </div>
                        ) : (
                            <button type="button" onClick={(e) => { e.stopPropagation(); alSeguir(destino); }} title={`${destino.nombre}${alarma ? " · está detectando algo" : ""} · tocar para seguir`}
                                aria-label={`Seguir a ${destino.nombre}`}
                                className={cn("relative grid place-items-center rounded-full text-white ring-1 transition-transform active:scale-90",
                                    alarma ? "bg-[var(--mal)] ring-white/70" : "bg-black/55 ring-white/30 hover:ring-white/80 hover:bg-black/75")}
                                style={{ width: lado, height: lado }}>
                                {alarma && <span className="absolute inset-0 rounded-full animate-ping bg-[var(--mal)]/60" />}
                                <Camera size={chica ? 11 : 14} className="relative" />
                            </button>
                        )}
                    </div>
                );
            })}
        </div>
    );
}
