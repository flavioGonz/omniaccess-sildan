"use client";

/**
 * El dibujo de la calibración de una cámara: la zona de interés y la línea de paso.
 *
 * Vivía adentro del calibrador, que era el único lugar que lo mostraba. Cuando la ficha
 * del equipo quiso dibujarlo sobre el video en vivo, la primera versión fue una copia
 * hecha al lado — y salió peor de una manera instructiva: un SVG en fracciones, estirado
 * con `preserveAspectRatio="none"`. Con eso los extremos de la línea salen elipses y la
 * flecha del sentido deja de ser perpendicular a la raya. O sea que la copia no sólo se
 * veía distinta: dibujaba mal el ángulo, que es el único dato que la línea tiene.
 *
 * Por eso está acá y en píxeles del lienzo. Quien la use tiene que decirle cuánto mide la
 * imagen; a cambio, la línea se ve igual en el calibrador y en la ficha, y el día que
 * alguien le cambie el color se le cambia en los dos.
 */

export type Zona = { x: number; y: number; w: number; h: number };
export type Linea = { x1: number; y1: number; x2: number; y2: number; sentido: string };

export const ZONA_COMPLETA: Zona = { x: 0, y: 0, w: 1, h: 1 };

/** La zona de interés: lo único del cuadro que se le manda al lector. */
export function ZonaDeInteres({ zona }: { zona: Zona }) {
    return (
        <div className="absolute border-2 border-amber-400 bg-amber-400/10 pointer-events-none"
            style={{
                left: `${zona.x * 100}%`, top: `${zona.y * 100}%`,
                width: `${zona.w * 100}%`, height: `${zona.h * 100}%`,
            }} />
    );
}

/**
 * La línea de paso.
 *
 * Lo que se ve: un resplandor por debajo para que se lea sobre cualquier fondo, la raya,
 * los dos extremos y, en el medio, la flecha del sentido en que tiene que cruzar el
 * vehículo para que la cámara avise.
 */
export function LineaDePasada({ linea, w, h }: { linea: Linea; w: number; h: number }) {
    const ax = linea.x1 * w, ay = linea.y1 * h;
    const bx = linea.x2 * w, by = linea.y2 * h;
    const largo = Math.hypot(bx - ax, by - ay) || 1;
    const mx = (ax + bx) / 2, my = (ay + by) / 2;
    // Normal unitaria: hacia dónde se cruza la raya.
    const nx = -(by - ay) / largo, ny = (bx - ax) / largo;
    const flecha = (signo: number, desde: number, hasta: number) => {
        const x0 = mx + nx * desde * signo, y0 = my + ny * desde * signo;
        const x1 = mx + nx * hasta * signo, y1 = my + ny * hasta * signo;
        const ux = (x1 - x0) / (Math.hypot(x1 - x0, y1 - y0) || 1), uy = (y1 - y0) / (Math.hypot(x1 - x0, y1 - y0) || 1);
        const px = -uy, py = ux;
        return { x0, y0, x1, y1, punta: `${x1},${y1} ${x1 - ux * 9 + px * 5},${y1 - uy * 9 + py * 5} ${x1 - ux * 9 - px * 5},${y1 - uy * 9 - py * 5}` };
    };
    const sentidos = linea.sentido === "left-right" ? [1] : linea.sentido === "right-left" ? [-1] : [1, -1];

    return (
        <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox={`0 0 ${w} ${h}`}>
            {/* resplandor: la raya se tiene que ver sobre asfalto claro y sobre sombra */}
            <line x1={ax} y1={ay} x2={bx} y2={by} stroke="#f43f5e" strokeWidth={9} strokeLinecap="round" opacity={0.22} />
            <line x1={ax} y1={ay} x2={bx} y2={by} stroke="#f43f5e" strokeWidth={2.5} strokeLinecap="round" />

            {sentidos.map((sg, i) => {
                const f = flecha(sg, 4, 30);
                return (
                    <g key={i}>
                        <line x1={f.x0} y1={f.y0} x2={f.x1} y2={f.y1} stroke="#fda4af" strokeWidth={2} strokeLinecap="round" />
                        <polygon points={f.punta} fill="#fda4af" />
                    </g>
                );
            })}

            {[[ax, ay], [bx, by]].map(([cx, cy], i) => (
                <g key={i}>
                    <circle cx={cx} cy={cy} r={7} fill="#f43f5e" />
                    <circle cx={cx} cy={cy} r={7} fill="none" stroke="#fff" strokeWidth={2} />
                </g>
            ))}
        </svg>
    );
}

/**
 * Dónde queda de verdad la imagen adentro de su recuadro, con `object-contain`.
 *
 * Hace falta porque el dibujo va sobre la IMAGEN, no sobre la caja: si la cámara no tiene
 * exactamente la proporción del recuadro quedan franjas negras a los costados, y una línea
 * dibujada sobre la caja entera aparecería corrida respecto de la calle.
 */
export function calzar(cajaW: number, cajaH: number, videoW: number, videoH: number) {
    if (!videoW || !videoH || !cajaW || !cajaH) return { left: 0, top: 0, w: cajaW, h: cajaH };
    const escala = Math.min(cajaW / videoW, cajaH / videoH);
    const w = videoW * escala, h = videoH * escala;
    return { left: (cajaW - w) / 2, top: (cajaH - h) / 2, w, h };
}
