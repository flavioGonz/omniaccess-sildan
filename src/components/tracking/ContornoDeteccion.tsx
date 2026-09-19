"use client";

import { leerRecuadro } from "@/lib/deteccion";

/**
 * El contorno de la detección, sobre la foto.
 *
 * Solo la matrícula, y solo porque ese rectángulo es un dato: es lo que devolvió el
 * detector, tal cual quedó guardado.
 *
 * Acá hubo también una caja estimada del vehículo, deducida de la chapa por regla de
 * tres. La idea era razonable y el resultado no: en un cuadro real de Calle 22 la caja
 * cayó sobre el auto que pasaba, no sobre el que tenía la chapa leída — porque la cuenta
 * supone que la chapa mira de frente a la cámara, y una cámara de calle mira en diagonal
 * y desde arriba. Un rectángulo plano dibujado sobre una escena en perspectiva no ubica
 * un auto: ubica mal, y con aplomo. Si en algún momento hace falta el contorno del
 * vehículo, tiene que venir de un detector de vehículos, no de una deducción.
 *
 * El SVG se estira sobre la imagen con preserveAspectRatio="none" y coordenadas de 0 a
 * 100. Así no hay que saber cuánto mide la foto en pantalla: acompaña cualquier tamaño,
 * incluso mientras se acerca con el zoom.
 */
export function ContornoDeteccion({ bbox }: { bbox: unknown }) {
    const chapa = leerRecuadro(bbox);
    if (!chapa) return null;

    const x = chapa.x * 100, y = chapa.y * 100;
    const w = chapa.w * 100, h = chapa.h * 100;

    // El tilde de esquina se dibuja hacia adentro, y nunca más largo que un tercio del
    // lado: en una chapa que ocupa el 3% del cuadro, un tilde fijo la taparía entera.
    const tx = Math.min(w / 3, 1.6);
    const ty = Math.min(h / 3, 1.6);

    return (
        <svg viewBox="0 0 100 100" preserveAspectRatio="none"
            className="absolute inset-0 w-full h-full pointer-events-none z-10">
            {/* Un halo oscuro detrás del trazo: sobre un asfalto claro o un farol, una
                línea fina de un solo color desaparece. */}
            <rect x={x} y={y} width={w} height={h}
                fill="none" stroke="rgba(0,0,0,0.65)" strokeWidth="2.2"
                vectorEffect="non-scaling-stroke" />
            <rect x={x} y={y} width={w} height={h}
                fill="none" stroke="#34d399" strokeWidth="1.1"
                vectorEffect="non-scaling-stroke">
                <animate attributeName="stroke-opacity" values="1;0.5;1" dur="2.6s" repeatCount="indefinite" />
            </rect>
            {[[x, y, 1, 1], [x + w, y, -1, 1], [x, y + h, 1, -1], [x + w, y + h, -1, -1]]
                .map(([px, py, sx, sy], i) => (
                    <path key={i}
                        d={`M ${px + sx * tx} ${py} L ${px} ${py} L ${px} ${py + sy * ty}`}
                        stroke="#a7f3d0" strokeWidth="2" fill="none" strokeLinecap="round"
                        vectorEffect="non-scaling-stroke" />
                ))}
        </svg>
    );
}
