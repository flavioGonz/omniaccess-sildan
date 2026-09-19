"use client";

import { leerRecuadro } from "@/lib/deteccion";
import { agruparChapa } from "./ChapaMercosur";

/**
 * La retícula sobre la matrícula detectada.
 *
 * Solo la chapa, y solo porque ese rectángulo es un dato: es lo que devolvió el detector,
 * tal cual quedó guardado.
 *
 * Acá hubo también una caja estimada del vehículo, deducida de la chapa por regla de tres.
 * La idea era razonable y el resultado no: en un cuadro real de Calle 22 la caja cayó
 * sobre el auto que pasaba, no sobre el que tenía la chapa leída — porque la cuenta supone
 * que la chapa mira de frente a la cámara, y una cámara de calle mira en diagonal y desde
 * arriba. Un rectángulo plano dibujado sobre una escena en perspectiva no ubica un auto:
 * ubica mal, y con aplomo. Si alguna vez hace falta el contorno del vehículo, tiene que
 * venir de un detector de vehículos, no de una deducción.
 *
 * El trazo pasó de ser un marco grueso con tildes en las esquinas a una línea de 1px con
 * el tono del estado. La razón es de escala: una chapa de calle ocupa entre el 3% y el 6%
 * del ancho del cuadro, y los tildes de esquina, por cortos que se dibujaran, se comían
 * justo los píxeles que uno vino a mirar. Una línea fina rodea sin tapar.
 *
 * El rótulo con la chapa va afuera del recuadro y **con la escala invertida**: si creciera
 * con el zoom, al acercarse a 8x para verificar una lectura dudosa el rótulo taparía la
 * lectura. Se acerca la foto, no el cartel.
 *
 * El SVG se estira con preserveAspectRatio="none" y coordenadas de 0 a 100, así no hay que
 * saber cuánto mide la foto en pantalla. Por eso el rótulo NO va adentro del SVG: ahí se
 * deformaría con la proporción de la imagen.
 */
export function ContornoDeteccion({ bbox, plate, escala = 1 }: {
    bbox: unknown;
    /** Si viene, se rotula el recuadro con lo que se leyó ahí. */
    plate?: string | null;
    /** El zoom del visor, para dibujar el rótulo y el trazo a tamaño constante. */
    escala?: number;
}) {
    const chapa = leerRecuadro(bbox);
    if (!chapa) return null;

    const x = chapa.x * 100, y = chapa.y * 100;
    const w = chapa.w * 100, h = chapa.h * 100;

    return (
        <>
            <svg viewBox="0 0 100 100" preserveAspectRatio="none"
                className="absolute inset-0 w-full h-full pointer-events-none z-10">
                {/* Un halo oscuro detrás del trazo: sobre asfalto claro o un farol, una
                    línea fina de un solo color desaparece. */}
                <rect x={x} y={y} width={w} height={h} rx="0.4"
                    fill="none" stroke="rgba(0,0,0,0.55)" strokeWidth="2.6"
                    vectorEffect="non-scaling-stroke" />
                <rect x={x} y={y} width={w} height={h} rx="0.4"
                    fill="color-mix(in oklab, var(--visor-tono) 6%, transparent)"
                    stroke="var(--visor-tono)" strokeWidth="1"
                    vectorEffect="non-scaling-stroke">
                    <animate attributeName="stroke-opacity" values="0.95;0.45;0.95"
                        dur="2.6s" repeatCount="indefinite" />
                </rect>
            </svg>

            {/* El rótulo y el punto de seguimiento, en HTML para no deformarse y para
                poder contrarrestar el zoom. */}
            <div className="absolute z-[11] pointer-events-none"
                style={{
                    left: `${x}%`,
                    top: `${y + h}%`,
                    transform: `scale(${1 / escala})`,
                    transformOrigin: "top left",
                }}>
                <div className="flex items-center gap-1 pt-1">
                    {plate && (
                        <span className="px-1.5 py-[1px] rounded bg-black/65 backdrop-blur-sm border text-[9px] font-semibold tracking-[0.14em] tabular-nums whitespace-nowrap"
                            style={{
                                borderColor: "color-mix(in oklab, var(--visor-tono) 28%, transparent)",
                                color: "color-mix(in oklab, var(--visor-tono) 62%, #fff)",
                            }}>
                            {agruparChapa(plate)}
                        </span>
                    )}
                    <span className="w-1.5 h-1.5 rounded-full animate-pulse shrink-0"
                        style={{ background: "var(--visor-tono)", boxShadow: "0 0 10px var(--visor-tono)" }} />
                </div>
            </div>
        </>
    );
}
