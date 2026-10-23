"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import type { ClaveComportamiento } from "@/lib/comportamientos";

/**
 * La escena animada de cada comportamiento de OmniVision (21/10, Nico: «animar mejor los otros
 * comportamientos, indicar cómo funcionan claramente»). Una calle en miniatura donde pasa lo que la
 * regla vigila, en loop: el auto que entra a la zona y se queda mientras corre el reloj, la persona
 * que da vueltas dejando el rastro, el bulto que queda solo… Al lado va el texto de
 * lib/comportamientos con los números de la regla; la escena es lo que se entiende de un vistazo.
 *
 * SMIL (`<animate>`, `<animateMotion>`) y no CSS: los recorridos son caminos, y todas las piezas de
 * una escena comparten el mismo reloj (DUR) sin coordinar nada a mano. Con «reducir movimiento»
 * se congela en el cuadro que explica (el del aviso).
 *
 * Los colores son los tokens pasados a hex, como en la foto marcada del worker (vision-reglas
 * COLOR_MARCA): SMIL no anima `var()`. La escena va siempre sobre su fondo oscuro, como una cámara.
 */
const DUR = 6;
const C = { accion: "#49a9ff", aviso: "#db8d0f", mal: "#e32a4e", tinta: "#e6edf5", tenue: "rgba(230,237,245,0.28)", piso: "rgba(230,237,245,0.07)" };
const anim = { dur: `${DUR}s`, repeatCount: "indefinite" } as const;
/** Los instantes del loop (0 a 1) → los atributos de un <animate> de valores discretos. */
const tiempos = (...t: number[]) => t.join(";");

export function EscenaComportamiento({ clave, className, alto = 170 }: { clave: ClaveComportamiento; className?: string; /** Tope de alto: llena el ancho con su proporción hasta acá. */ alto?: number }) {
    const svg = useRef<SVGSVGElement>(null);
    useEffect(() => {
        const s = svg.current;
        if (!s || typeof window === "undefined" || !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
        try { s.setCurrentTime(DUR * 0.9); s.pauseAnimations(); } catch { }
    }, [clave]);
    return (
        <svg ref={svg} key={clave} viewBox="0 0 200 112" role="img" aria-label={`Cómo funciona: ${clave}`}
            className={cn("block w-full rounded-[10px] bg-[#0b0f16]", className)} style={{ aspectRatio: "200 / 112", maxHeight: alto }}>
            <Piso />
            {ESCENAS[clave]()}
        </svg>
    );
}

/* ───────────── Piezas ───────────── */

function Piso() {
    return (
        <g stroke={C.piso} strokeWidth={0.6}>
            {[30, 52, 74, 96].map((y) => <line key={y} x1={0} x2={200} y1={y} y2={y} />)}
            {[20, 60, 100, 140, 180].map((x) => <line key={x} x1={x} x2={x + (x - 100) * 0.25} y1={0} y2={112} />)}
        </g>
    );
}

/** Una zona punteada que «camina» (el borde se desplaza), y que se tiñe en el tono del aviso desde `alerta` (0-1). */
function Zona({ puntos, alerta, tono = C.aviso, hasta = 0.98 }: { puntos: string; alerta?: number; tono?: string; hasta?: number }) {
    return (
        <g>
            <polygon points={puntos} fill={C.accion} fillOpacity={0.08} stroke={C.accion} strokeWidth={1.2} strokeDasharray="4 3">
                <animate attributeName="stroke-dashoffset" from="0" to="-14" dur="1.2s" repeatCount="indefinite" />
                {alerta != null && <>
                    <animate attributeName="stroke" {...anim} values={`${C.accion};${C.accion};${tono};${tono};${C.accion}`} keyTimes={tiempos(0, alerta, alerta + 0.01, hasta, 1)} />
                    <animate attributeName="fill" {...anim} values={`${C.accion};${C.accion};${tono};${tono};${C.accion}`} keyTimes={tiempos(0, alerta, alerta + 0.01, hasta, 1)} />
                    <animate attributeName="fill-opacity" {...anim} values="0.08;0.08;0.22;0.12;0.08" keyTimes={tiempos(0, alerta, alerta + 0.03, hasta, 1)} />
                </>}
            </polygon>
        </g>
    );
}

/** Un pulso que se expande en (x, y) a partir de `desde` (0-1). */
function Pulso({ x, y, desde, tono = C.aviso, r = 14 }: { x: number; y: number; desde: number; tono?: string; r?: number }) {
    return (
        <circle cx={x} cy={y} r={0} fill="none" stroke={tono} strokeWidth={1.5} opacity={0}>
            <animate attributeName="r" {...anim} values={`0;0;${r};${r * 1.6}`} keyTimes={tiempos(0, desde, Math.min(0.99, desde + 0.08), 1)} />
            <animate attributeName="opacity" {...anim} values="0;0;1;0" keyTimes={tiempos(0, desde, Math.min(0.99, desde + 0.03), 1)} />
        </circle>
    );
}

/** Un rótulo (chip) que aparece en `desde`. */
function Chip({ x, y, texto, desde, tono = C.aviso, hasta = 1 }: { x: number; y: number; texto: string; desde: number; tono?: string; hasta?: number }) {
    const ancho = texto.length * 4.3 + 12;
    return (
        <g opacity={0}>
            <animate attributeName="opacity" {...anim} values="0;0;1;1;0" keyTimes={tiempos(0, desde, Math.min(0.99, desde + 0.03), Math.max(desde + 0.04, hasta - 0.02), 1)} />
            <rect x={x - ancho / 2} y={y - 7} width={ancho} height={13} rx={4} fill="rgba(10,12,16,0.85)" />
            <rect x={x - ancho / 2 + 3} y={y - 3} width={2.5} height={5} rx={1} fill={tono} />
            <text x={x + 2} y={y + 2.6} textAnchor="middle" fontSize={7} fontWeight={600} fill={C.tinta} fontFamily="Outfit, system-ui, sans-serif">{texto}</text>
        </g>
    );
}

/** Un auto visto desde arriba en perspectiva baja: carrocería, techo y luces. Origen en su centro. */
function Auto({ color = C.tinta }: { color?: string }) {
    return (
        <g>
            <rect x={-13} y={-6} width={26} height={12} rx={4} fill={color} fillOpacity={0.9} />
            <rect x={-6} y={-4.5} width={11} height={9} rx={2} fill="#0b0f16" fillOpacity={0.55} />
            <rect x={11} y={-5} width={2} height={3} rx={1} fill="#ffd27a" />
            <rect x={11} y={2} width={2} height={3} rx={1} fill="#ffd27a" />
        </g>
    );
}
/** Una persona: cabeza y cuerpo, con el pie en el origen (como el pie de la caja del detector). */
function Persona({ color = C.tinta, brazosArriba }: { color?: string; brazosArriba?: { desde: number; hasta: number } }) {
    return (
        <g stroke={color} strokeWidth={2} strokeLinecap="round" fill="none">
            <circle cx={0} cy={-17} r={3.2} fill={color} stroke="none" />
            <line x1={0} y1={-13} x2={0} y2={-5} />
            <line x1={0} y1={-5} x2={-3} y2={0} /><line x1={0} y1={-5} x2={3} y2={0} />
            {brazosArriba ? (
                <>
                    <line x1={0} y1={-11} x2={-4} y2={-7}>
                        <animate attributeName="y2" {...anim} values="-7;-7;-21;-21;-7" keyTimes={tiempos(0, brazosArriba.desde, brazosArriba.desde + 0.05, brazosArriba.hasta, 1)} />
                    </line>
                    <line x1={0} y1={-11} x2={4} y2={-7}>
                        <animate attributeName="y2" {...anim} values="-7;-7;-21;-21;-7" keyTimes={tiempos(0, brazosArriba.desde, brazosArriba.desde + 0.05, brazosArriba.hasta, 1)} />
                    </line>
                </>
            ) : <><line x1={0} y1={-11} x2={-4} y2={-6} /><line x1={0} y1={-11} x2={4} y2={-6} /></>}
        </g>
    );
}
function Perro() {
    return (
        <g fill={C.tinta}>
            <rect x={-7} y={-6} width={13} height={5} rx={2.5} />
            <circle cx={7} cy={-7} r={2.6} />
            <line x1={-5} y1={-1} x2={-5} y2={2} stroke={C.tinta} strokeWidth={1.5} /><line x1={4} y1={-1} x2={4} y2={2} stroke={C.tinta} strokeWidth={1.5} />
            <line x1={-7} y1={-5} x2={-10} y2={-8} stroke={C.tinta} strokeWidth={1.2} />
        </g>
    );
}
function Bulto({ color = C.tinta }: { color?: string }) {
    return <g><rect x={-4} y={-8} width={8} height={8} rx={1.8} fill={color} /><path d="M-2,-8 v-2 h4 v2" stroke={color} strokeWidth={1} fill="none" /></g>;
}

/** Mueve a su contenido por `camino` siguiendo `puntos` (0-1 del camino) en los `tiempos` del loop. */
function Mover({ camino, puntos, en, children }: { camino: string; puntos: string; en: string; children: React.ReactNode }) {
    return (
        <g>
            {children}
            <animateMotion {...anim} path={camino} keyPoints={puntos} keyTimes={en} calcMode="linear" />
        </g>
    );
}

/** Un reloj que se completa entre `desde` y `hasta` (el tiempo de la regla). */
function Reloj({ x, y, desde, hasta, tono = C.aviso }: { x: number; y: number; desde: number; hasta: number; tono?: string }) {
    const L = 2 * Math.PI * 7;
    return (
        <g opacity={0}>
            <animate attributeName="opacity" {...anim} values="0;0;1;1;0" keyTimes={tiempos(0, desde - 0.02, desde, 0.97, 1)} />
            <circle cx={x} cy={y} r={9.5} fill="rgba(10,12,16,0.85)" />
            <circle cx={x} cy={y} r={7} fill="none" stroke={C.tenue} strokeWidth={2} />
            <circle cx={x} cy={y} r={7} fill="none" stroke={tono} strokeWidth={2} strokeDasharray={L} strokeDashoffset={L} transform={`rotate(-90 ${x} ${y})`} strokeLinecap="round">
                <animate attributeName="stroke-dashoffset" {...anim} values={`${L};${L};0;0`} keyTimes={tiempos(0, desde, hasta, 1)} />
            </circle>
            <line x1={x} y1={y} x2={x} y2={y - 4} stroke={C.tinta} strokeWidth={1.2} strokeLinecap="round">
                <animateTransform attributeName="transform" type="rotate" {...anim} values={`0 ${x} ${y};0 ${x} ${y};720 ${x} ${y};720 ${x} ${y}`} keyTimes={tiempos(0, desde, hasta, 1)} />
            </line>
        </g>
    );
}

/* ───────────── Escenas ───────────── */

const ESCENAS: Record<ClaveComportamiento, () => React.ReactNode> = {
    permanencia: () => (<>
        <Zona puntos="108,38 186,38 192,98 104,98" alerta={0.78} />
        {/* Llega, maniobra y queda quieto; el reloj corre desde que pisa la zona. */}
        <Mover camino="M-20,70 C40,70 90,72 128,70 C138,69 142,66 146,66" puntos="0;0.72;1;1" en={tiempos(0, 0.18, 0.3, 1)}><Auto /></Mover>
        <Reloj x={146} y={44} desde={0.24} hasta={0.78} />
        <Pulso x={146} y={66} desde={0.78} r={18} />
        <Chip x={150} y={26} texto="lleva 15 min" desde={0.8} hasta={0.98} />
    </>),
    merodeo: () => (<>
        <Zona puntos="40,30 170,30 178,100 32,100" alerta={0.8} />
        {/* El rastro: lo que caminó suma, y eso es lo que separa merodear de esperar. */}
        <path d="M30,92 C60,40 90,95 110,50 C125,20 160,90 150,60 C140,40 100,70 80,55" fill="none" stroke={C.aviso} strokeOpacity={0.55} strokeWidth={1.2} strokeDasharray="300" strokeDashoffset={300}>
            <animate attributeName="stroke-dashoffset" {...anim} values="300;0;0" keyTimes={tiempos(0, 0.8, 1)} />
        </path>
        <Mover camino="M30,92 C60,40 90,95 110,50 C125,20 160,90 150,60 C140,40 100,70 80,55" puntos="0;1;1" en={tiempos(0, 0.8, 1)}><Persona /></Mover>
        <Chip x={100} y={20} texto="caminó medio cuadro" desde={0.8} />
    </>),
    intrusion: () => (<>
        <Zona puntos="110,26 190,26 196,104 104,104" alerta={0.5} tono={C.mal} />
        <Mover camino="M20,80 L150,74" puntos="0;1;1" en={tiempos(0, 0.7, 1)}><Persona /></Mover>
        <Pulso x={112} y={70} desde={0.5} tono={C.mal} r={16} />
        <Chip x={150} y={16} texto="persona en la zona" desde={0.52} tono={C.mal} />
    </>),
    cruce: () => (<>
        <line x1={100} y1={8} x2={100} y2={104} stroke={C.accion} strokeWidth={2}>
            <animate attributeName="stroke" {...anim} values={`${C.accion};${C.accion};${C.mal};${C.mal};${C.accion}`} keyTimes={tiempos(0, 0.45, 0.46, 0.9, 1)} />
        </line>
        <Mover camino="M30,78 L170,72" puntos="0;1;1" en={tiempos(0, 0.85, 1)}><Persona /></Mover>
        <Pulso x={100} y={60} desde={0.45} tono={C.mal} r={16} />
        <Chip x={100} y={16} texto="cruzó la línea" desde={0.47} tono={C.mal} hasta={0.92} />
    </>),
    sentido: () => (<>
        <line x1={100} y1={8} x2={100} y2={104} stroke={C.accion} strokeWidth={2} />
        {/* El sentido permitido: de izquierda a derecha. */}
        {[30, 56, 82].map((y) => <path key={y} d={`M70,${y} l14,0 m-4,-3 l4,3 l-4,3`} stroke={C.accion} strokeOpacity={0.6} strokeWidth={1.4} fill="none" />)}
        <Mover camino="M185,66 L20,66" puntos="0;1;1" en={tiempos(0, 0.85, 1)}><g transform="scale(-1,1)"><Auto /></g></Mover>
        <Pulso x={100} y={66} desde={0.42} tono={C.mal} r={18} />
        <Chip x={140} y={16} texto="contramano" desde={0.44} tono={C.mal} hasta={0.92} />
    </>),
    aglomeracion: () => (<>
        <Zona puntos="60,34 140,34 146,100 54,100" alerta={0.72} />
        {[["M10,40 L88,62", 0.55], ["M190,40 L110,64", 0.6], ["M20,104 L96,84", 0.62], ["M180,104 L104,86", 0.66], ["M100,0 L100,70", 0.7]].map(([c, t], i) => (
            <Mover key={i} camino={c as string} puntos="0;1;1" en={tiempos(0, t as number, 1)}><Persona /></Mover>
        ))}
        <Pulso x={100} y={70} desde={0.72} r={26} />
        <Chip x={100} y={24} texto="5 juntas" desde={0.74} />
    </>),
    fila: () => (<>
        <Zona puntos="40,40 180,40 184,96 36,96" />
        {[0, 1, 2, 3].map((i) => (
            <Mover key={i} camino={`M-10,${70 + (i % 2) * 4} L${150 - i * 24},${70 + (i % 2) * 4}`} puntos="0;0;1;1" en={tiempos(0, i * 0.18, i * 0.18 + 0.16, 1)}><Persona /></Mover>
        ))}
        {[1, 2, 3, 4].map((n, i) => <Chip key={n} x={110} y={26} texto={`${n} en la fila`} tono={C.accion} desde={i * 0.18 + 0.14} hasta={i < 3 ? (i + 1) * 0.18 + 0.14 : 1} />)}
    </>),
    animal: () => (<>
        <Zona puntos="60,30 180,30 186,100 54,100" alerta={0.66} />
        <Mover camino="M120,80 L215,82" puntos="0;0;1;1" en={tiempos(0, 0.3, 0.55, 1)}><Persona /></Mover>
        <Mover camino="M-10,82 L110,80" puntos="0;1;1" en={tiempos(0, 0.4, 1)}><Perro /></Mover>
        <Pulso x={110} y={76} desde={0.66} r={16} />
        <Chip x={120} y={20} texto="perro sin nadie" desde={0.68} />
    </>),
    dejado: () => (<>
        <Zona puntos="50,32 170,32 176,100 44,100" alerta={0.8} tono={C.mal} />
        <Mover camino="M-10,82 L104,82 L215,84" puntos="0;0.5;0.5;1;1" en={tiempos(0, 0.3, 0.38, 0.65, 1)}><Persona /></Mover>
        {/* El bulto va en la mano hasta que lo suelta, y ahí queda solo. */}
        <Mover camino="M-4,80 L108,82" puntos="0;1;1" en={tiempos(0, 0.3, 1)}><Bulto /></Mover>
        <Reloj x={108} y={52} desde={0.4} hasta={0.8} tono={C.mal} />
        <Pulso x={108} y={78} desde={0.8} tono={C.mal} r={14} />
        <Chip x={110} y={20} texto="quedó solo" desde={0.82} tono={C.mal} />
    </>),
    retirado: () => (<>
        <Zona puntos="70,40 150,40 154,100 66,100" />
        {/* Lo aprendido: su silueta queda marcada; cuando falta, late en rojo. */}
        <rect x={102} y={66} width={16} height={14} rx={2} fill="none" stroke={C.accion} strokeDasharray="2 2">
            <animate attributeName="stroke" {...anim} values={`${C.accion};${C.accion};${C.mal};${C.mal}`} keyTimes={tiempos(0, 0.75, 0.76, 1)} />
        </rect>
        <Mover camino="M210,82 L114,82 L-20,82" puntos="0;0.5;0.5;1;1" en={tiempos(0, 0.3, 0.42, 0.75, 1)}><Persona /></Mover>
        <Mover camino="M110,80 L110,80 L-24,80" puntos="0;0;1;1" en={tiempos(0, 0.42, 0.75, 1)}><g transform="scale(1.6)"><Bulto /></g></Mover>
        <Pulso x={110} y={74} desde={0.78} tono={C.mal} r={14} />
        <Chip x={110} y={28} texto="ya no está" desde={0.8} tono={C.mal} />
    </>),
    suelo: () => (<>
        <Zona puntos="50,40 160,40 166,100 44,100" alerta={0.7} tono={C.mal} />
        <g transform="translate(104,86)">
            <g>
                <animateTransform attributeName="transform" type="rotate" {...anim} values="0;0;-88;-88" keyTimes={tiempos(0, 0.3, 0.4, 1)} />
                <Persona />
            </g>
        </g>
        <Reloj x={140} y={56} desde={0.42} hasta={0.7} tono={C.mal} />
        <Pulso x={96} y={84} desde={0.7} tono={C.mal} r={18} />
        <Chip x={100} y={26} texto="persona en el suelo" desde={0.72} tono={C.mal} />
    </>),
    trepar: () => (<>
        {/* El cerco, con la zona dibujada sobre él. */}
        <g stroke={C.tenue} strokeWidth={1.2}>{[70, 82, 94, 106, 118, 130].map((x) => <line key={x} x1={x} y1={50} x2={x} y2={98} />)}<line x1={64} y1={56} x2={136} y2={56} /></g>
        <Zona puntos="62,44 138,44 138,100 62,100" alerta={0.65} tono={C.mal} />
        <Mover camino="M20,96 L100,96" puntos="0;1;1" en={tiempos(0, 0.3, 1)}><Persona brazosArriba={{ desde: 0.35, hasta: 0.95 }} /></Mover>
        <Pulso x={100} y={78} desde={0.65} tono={C.mal} r={18} />
        <Chip x={100} y={30} texto="manos arriba en el cerco" desde={0.67} tono={C.mal} />
    </>),
    epp: () => (<>
        <Zona puntos="40,30 170,30 176,100 34,100" alerta={0.7} />
        <Mover camino="M-10,92 L100,92" puntos="0;1;1" en={tiempos(0, 0.35, 1)}><Persona /></Mover>
        {/* Lo que se busca y no está: el casco, punteado sobre la cabeza. */}
        <g opacity={0}>
            <animate attributeName="opacity" {...anim} values="0;0;1;1" keyTimes={tiempos(0, 0.4, 0.45, 1)} />
            <path d="M94,73 a6,5 0 0 1 12,0 z" fill="none" stroke={C.aviso} strokeDasharray="2 1.5" />
            <line x1={84} y1={70} x2={116} y2={70} stroke={C.aviso} strokeOpacity={0.8}>
                <animate attributeName="y1" {...anim} values="64;64;98;64" keyTimes={tiempos(0, 0.42, 0.65, 1)} />
                <animate attributeName="y2" {...anim} values="64;64;98;64" keyTimes={tiempos(0, 0.42, 0.65, 1)} />
            </line>
        </g>
        <Chip x={100} y={20} texto="sin casco" desde={0.72} />
    </>),
    conteo: () => (<>
        <line x1={100} y1={8} x2={100} y2={104} stroke={C.accion} strokeWidth={2} />
        <Mover camino="M20,60 L180,60" puntos="0;1;1" en={tiempos(0, 0.45, 1)}><Persona /></Mover>
        <Mover camino="M180,94 L20,94" puntos="0;0;1;1" en={tiempos(0, 0.45, 0.9, 1)}><Persona /></Mover>
        <Chip x={150} y={18} texto="→ 1" tono={C.accion} desde={0.24} />
        <Chip x={50} y={18} texto="← 1" tono={C.accion} desde={0.68} />
    </>),
};
