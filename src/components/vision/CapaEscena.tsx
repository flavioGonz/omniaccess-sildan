"use client";

import { cn } from "@/lib/utils";
import { cajaDePoligono } from "@/lib/zona-evento";

/**
 * Lo que una analítica entrenable de escena vio, marcado sobre la foto del aviso: la zona que
 * vigila (el contenedor, el portón), resaltada, con su estado y cuán segura está.
 *
 * Por qué (14/11, Nico: «debés resaltar el objeto detectado, en este caso contenedor desbordado»).
 * La foto del aviso es el cuadro entero de la cámara y la zona puede ser un rincón: sin marca hay
 * que adivinar qué fue lo que avisó. Estas analíticas no detectan un objeto con su caja: miran un
 * polígono fijo que alguien dibujó y dicen en qué estado está. Lo «detectado» es ese polígono.
 *
 * Cómo resalta: el resto de la foto se apaga un poco y la zona queda con su luz, con el borde del
 * color del aviso latiendo. Se toca (la zona o su rótulo) para abrir el menú de lo que se puede
 * hacer con ella; quién lo abre lo decide quien usa la capa.
 *
 * `escala` es el zoom de la foto: el borde y el rótulo se dibujan del mismo tamaño en pantalla
 * aunque la foto esté acercada ocho veces.
 */
export function CapaEscena({ poligono, rotulo, prob, escala = 1, elegida = false, alTocar, className }: {
    /** El polígono de la zona, en fracciones del cuadro. */
    poligono: [number, number][];
    /** El estado que avisó («Desbordado»). */
    rotulo: string;
    /** Cuán segura estaba la analítica, 0 a 1. */
    prob: number | null;
    escala?: number;
    /** El menú está abierto sobre ella. */
    elegida?: boolean;
    alTocar?: (clienteX: number, clienteY: number) => void;
    className?: string;
}) {
    const pts = poligono.map(([x, y]) => `${(x * 100).toFixed(3)},${(y * 100).toFixed(3)}`).join(" ");
    const [x1, y1, , y2] = cajaDePoligono(poligono);
    // El rótulo va arriba de la zona; si no entra (la zona toca el borde de arriba), abajo.
    const arriba = y1 > 0.09;
    const tocar = alTocar ? (e: React.MouseEvent) => { e.stopPropagation(); alTocar(e.clientX, e.clientY); } : undefined;
    const pct = prob == null ? null : Math.round(prob * 100);
    return (
        <div className={cn("absolute inset-0 pointer-events-none", className)}>
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 w-full h-full overflow-visible" aria-hidden="true">
                {/* Todo menos la zona, un poco más oscuro: la zona queda con su luz. */}
                <path d={`M0,0 H100 V100 H0 Z M${pts.replace(/ /g, " L")} Z`} fillRule="evenodd" fill="rgba(0,0,0,0.26)" />
                <polygon points={pts} fill="none" stroke="rgba(0,0,0,0.6)" strokeWidth={5 / escala} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
                <polygon points={pts} fill="var(--aviso)" fillOpacity={elegida ? 0.16 : 0.06} stroke="var(--aviso)" strokeWidth={2.5 / escala} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
                <polygon points={pts} fill="none" stroke="var(--aviso)" strokeWidth={7 / escala} strokeLinejoin="round" vectorEffect="non-scaling-stroke" className="oa-escena-late" />
                {/* Lo que se toca: la zona entera. */}
                {tocar && <polygon points={pts} fill="transparent" className="pointer-events-auto cursor-pointer" onClick={tocar}><title>{`${rotulo}: tocá para ver qué se puede hacer`}</title></polygon>}
            </svg>
            <button type="button" onClick={tocar} disabled={!tocar} aria-haspopup={tocar ? "menu" : undefined} aria-expanded={tocar ? elegida : undefined}
                title={tocar ? "Qué se puede hacer con esto" : undefined}
                className={cn("absolute h-7 pl-2 pr-2.5 rounded-[6px] bg-black/80 text-white text-[12px] font-semibold inline-flex items-center gap-1.5 whitespace-nowrap",
                    tocar ? "pointer-events-auto cursor-pointer hover:bg-black" : "", elegida && "ring-2 ring-[var(--aviso)]")}
                style={{
                    left: `${x1 * 100}%`, top: `${(arriba ? y1 : y2) * 100}%`,
                    transform: `scale(${1 / escala}) translateY(${arriba ? "calc(-100% - 8px)" : "8px"})`, transformOrigin: "left top",
                }}>
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: "var(--aviso)" }} />
                {rotulo}
                {pct != null && <span className="font-normal text-white/70 tabular-nums">{pct} %</span>}
            </button>
        </div>
    );
}
