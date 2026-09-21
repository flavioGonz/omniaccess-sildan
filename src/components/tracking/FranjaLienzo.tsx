"use client";

import { useEffect, useRef } from "react";
import type { Franja, Punto } from "./useFranja";

/**
 * La franja dibujada sobre la escena. Sólo dibujo: el estado vive en `useFranja`.
 *
 * ## Por qué recibe el encuadre en vez de medirlo
 *
 * El cuadro llega encajado dentro de su caja (`object-contain`), así que entre el borde de
 * la caja y el borde de la imagen hay bandas. Dibujar sobre la caja corre la franja hacia
 * las bandas, y el corrimiento **sólo se nota cuando ya está mal calibrada** — es decir,
 * tarde. Quien sabe dónde quedó la imagen es la pantalla que la muestra, así que se lo pasa.
 *
 * ## Las celdas siguen la perspectiva
 *
 * Cuatro esquinas en orden: `a→b` un lado largo, `d→c` el opuesto. La celda *i* va de
 * `lerp(a,b)` a `lerp(d,c)`, así que **se achica sola hacia el fondo**, igual que los
 * autos. Repartir un rectángulo en partes iguales daría lugares del mismo tamaño sobre una
 * calle que se ve en diagonal, y los del fondo se comerían tres autos.
 */

export type Encuadre = { left: number; top: number; w: number; h: number };

export function FranjaLienzo({
    franja, encuadre, editable = true,
}: {
    franja: Franja;
    encuadre: Encuadre;
    editable?: boolean;
}) {
    const { esquinas, setEsquinas, celdas, estados } = franja;
    const arrastrando = useRef<number | null>(null);
    const caja = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!editable) return;
        const aFraccion = (ev: PointerEvent) => {
            const r = caja.current?.getBoundingClientRect();
            if (!r || !encuadre.w || !encuadre.h) return null;
            return {
                x: Math.min(1, Math.max(0, (ev.clientX - r.left - encuadre.left) / encuadre.w)),
                y: Math.min(1, Math.max(0, (ev.clientY - r.top - encuadre.top) / encuadre.h)),
            };
        };
        const mover = (ev: PointerEvent) => {
            const i = arrastrando.current;
            if (i == null) return;
            const p = aFraccion(ev);
            if (!p) return;
            setEsquinas((prev) => { const q = [...prev] as typeof prev; q[i] = p; return q; });
        };
        const soltar = () => { arrastrando.current = null; };
        window.addEventListener("pointermove", mover);
        window.addEventListener("pointerup", soltar);
        return () => {
            window.removeEventListener("pointermove", mover);
            window.removeEventListener("pointerup", soltar);
        };
    }, [editable, encuadre.left, encuadre.top, encuadre.w, encuadre.h, setEsquinas]);

    const px = (p: Punto) => `${encuadre.left + p.x * encuadre.w},${encuadre.top + p.y * encuadre.h}`;

    return (
        <div ref={caja} className="absolute inset-0 pointer-events-none">
            <svg className="absolute inset-0 w-full h-full" aria-hidden>
                {celdas.map((q, i) => {
                    const est = estados ? estados[i] : undefined;
                    const cx = (q[0].x + q[2].x) / 2 * encuadre.w + encuadre.left;
                    const cy = (q[0].y + q[2].y) / 2 * encuadre.h + encuadre.top;
                    return (
                        <g key={i}>
                            <polygon
                                points={q.map(px).join(" ")}
                                fill={est?.ocupado ? "color-mix(in oklab, var(--info) 42%, transparent)" : "transparent"}
                                /* Sobre imagen el azul normal desaparece; va el de oscuro. */
                                stroke="var(--accion-en-oscuro)"
                                strokeWidth={1.5}
                            />
                            <text x={cx} y={cy} textAnchor="middle" dominantBaseline="middle"
                                className="fill-white text-[11px] font-semibold"
                                style={{ paintOrder: "stroke", stroke: "rgba(0,0,0,.55)", strokeWidth: 3 }}>
                                {i + 1}
                            </text>
                        </g>
                    );
                })}
            </svg>

            {editable && esquinas.map((p, i) => (
                <button
                    key={i}
                    type="button"
                    onPointerDown={() => { arrastrando.current = i; }}
                    aria-label={`Esquina ${i + 1}`}
                    className="absolute size-4 -ml-2 -mt-2 rounded-full border-2 border-white cursor-grab active:cursor-grabbing pointer-events-auto"
                    style={{
                        left: encuadre.left + p.x * encuadre.w,
                        top: encuadre.top + p.y * encuadre.h,
                        background: "var(--accion-en-oscuro)",
                    }}
                />
            ))}
        </div>
    );
}
