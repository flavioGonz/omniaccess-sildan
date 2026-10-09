"use client";

import { useId, useMemo } from "react";
import { bandasLinea, poligonos, veredicto, type Analisis, type GeomNorm, type Pt } from "@/lib/vision-capa";

/**
 * Lo que vio omni-vision, dibujado encima de la foto: las siluetas, la línea y la zona de la
 * cámara, y en otro color SÓLO la parte de la silueta que toca la línea o la zona.
 *
 * Va en la misma caja que la foto y con el mismo ajuste (`contain` u `cover`): el SVG usa el
 * tamaño real de la imagen como viewBox y `preserveAspectRatio` hace el mismo recorte o las
 * mismas franjas que el `object-fit` de la foto, así cada silueta cae sobre su persona sin
 * medir nada en pantalla.
 *
 * «La parte que toca» se dibuja recortando la silueta (clipPath) con la zona, o con una franja
 * angosta alrededor de la línea: lo que queda adentro del recorte es exactamente lo que toca.
 *
 * Colores (sobre foto, por eso no son los tonos de estado del sistema): uno por clase para que
 * persona y vehículo se distingan de un vistazo, la geometría en blanco con sombra (se lee sobre
 * pasto, asfalto y noche), y lo que toca en el rojo de alarma.
 */
const COLOR_GRUPO: Record<string, string> = { persona: "#38bdf8", vehiculo: "#a78bfa", animal: "#fbbf24" };
const COLOR_OTRO = "#e2e8f0";
const COLOR_GEOM = "#f8fafc";
const COLOR_TOCA = "#f43f5e";
const NOMBRE_GRUPO: Record<string, string> = { persona: "Persona", vehiculo: "Vehículo", animal: "Animal" };

const pts = (p: Pt[], w: number, h: number) => p.map(([x, y]) => `${(x * w).toFixed(1)},${(y * h).toFixed(1)}`).join(" ");
const ptsPx = (p: Pt[]) => p.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");

export function CapaAnalisis({ analisis, geom, ajuste = "contain", etiquetas = true, atributos = false, className }: {
    analisis: Analisis;
    geom?: GeomNorm | null;
    ajuste?: "contain" | "cover";
    /** El rótulo «Persona 92 %» sobre cada objeto. En una miniatura sobra. */
    etiquetas?: boolean;
    /** Sumar al rótulo el color o la carrocería (lecturas LPR). */
    atributos?: boolean;
    className?: string;
}) {
    const uid = useId().replace(/:/g, "");
    const { ancho: W, alto: H, objetos } = analisis;
    const { tocan } = useMemo(() => veredicto(analisis, geom || null), [analisis, geom]);
    const bandas = useMemo(() => (geom?.linea.length ? bandasLinea(geom.linea, W, H) : []), [geom, W, H]);
    if (!W || !H) return null;
    const lado = Math.min(W, H);
    const fuente = Math.max(11, lado * 0.026);
    const hayGeom = !!geom && (geom.linea.length >= 2 || geom.zona.length >= 3);

    return (
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio={ajuste === "cover" ? "xMidYMid slice" : "xMidYMid meet"}
            className={`absolute inset-0 w-full h-full pointer-events-none ${className || ""}`} aria-hidden>
            <defs>
                <filter id={`brillo-${uid}`} x="-20%" y="-20%" width="140%" height="140%">
                    <feGaussianBlur stdDeviation={lado * 0.004} result="b" />
                    <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
                </filter>
                <filter id={`sombra-${uid}`} x="-20%" y="-20%" width="140%" height="140%">
                    <feDropShadow dx="0" dy="0" stdDeviation={lado * 0.003} floodColor="#000" floodOpacity="0.85" />
                </filter>
                {Object.entries({ ...COLOR_GRUPO, otro: COLOR_OTRO, toca: COLOR_TOCA }).map(([k, c]) => (
                    <linearGradient key={k} id={`rel-${k}-${uid}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={c} stopOpacity={k === "toca" ? 0.7 : 0.42} />
                        <stop offset="100%" stopColor={c} stopOpacity={k === "toca" ? 0.5 : 0.12} />
                    </linearGradient>
                ))}
                <pattern id={`rayas-${uid}`} width={lado * 0.02} height={lado * 0.02} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                    <line x1="0" y1="0" x2="0" y2={lado * 0.02} stroke={COLOR_GEOM} strokeOpacity="0.22" strokeWidth={lado * 0.006} />
                </pattern>
                {geom && geom.zona.length >= 3 && <clipPath id={`zona-${uid}`}><polygon points={pts(geom.zona, W, H)} /></clipPath>}
                {bandas.length > 0 && <clipPath id={`banda-${uid}`}>{bandas.map((b, i) => <polygon key={i} points={ptsPx(b)} />)}</clipPath>}
            </defs>

            {/* La zona: rayada, con borde punteado. */}
            {geom && geom.zona.length >= 3 && (
                <g filter={`url(#sombra-${uid})`}>
                    <polygon points={pts(geom.zona, W, H)} fill={`url(#rayas-${uid})`} />
                    <polygon points={pts(geom.zona, W, H)} fill="none" stroke={COLOR_GEOM} strokeWidth={2} strokeDasharray="8 6" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
                </g>
            )}
            {/* La línea: una cinta (halo ancho y suave, centro firme) con sus extremos marcados. */}
            {geom && geom.linea.length >= 2 && (
                <g filter={`url(#sombra-${uid})`}>
                    <polyline points={pts(geom.linea, W, H)} fill="none" stroke={COLOR_GEOM} strokeOpacity="0.25" strokeWidth={10} vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />
                    <polyline points={pts(geom.linea, W, H)} fill="none" stroke={COLOR_GEOM} strokeWidth={2.5} vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />
                    {[geom.linea[0], geom.linea[geom.linea.length - 1]].map(([x, y], i) => (
                        <circle key={i} cx={x * W} cy={y * H} r={lado * 0.009} fill="#0f172a" stroke={COLOR_GEOM} strokeWidth={2} vectorEffect="non-scaling-stroke" />
                    ))}
                </g>
            )}

            {/* Las siluetas: relleno en degradé y borde con brillo, del color de su grupo. */}
            {objetos.map((o, i) => {
                const k = COLOR_GRUPO[o.grupo] ? o.grupo : "otro";
                const c = COLOR_GRUPO[o.grupo] || COLOR_OTRO;
                return (
                    <g key={i}>
                        {poligonos(o).map((p, j) => (
                            <polygon key={j} points={pts(p, W, H)} fill={`url(#rel-${k}-${uid})`} stroke={c} strokeWidth={2} vectorEffect="non-scaling-stroke"
                                strokeLinejoin="round" filter={`url(#brillo-${uid})`} />
                        ))}
                    </g>
                );
            })}

            {/* Sólo la parte que toca: la misma silueta, recortada por la zona y por la franja de la línea. */}
            {hayGeom && objetos.map((o, i) => tocan[i] && (
                <g key={`t${i}`}>
                    {[geom!.zona.length >= 3 ? `zona-${uid}` : null, bandas.length ? `banda-${uid}` : null].filter(Boolean).map((clip) => (
                        <g key={clip} clipPath={`url(#${clip})`}>
                            {poligonos(o).map((p, j) => (
                                <polygon key={j} points={pts(p, W, H)} fill={`url(#rel-toca-${uid})`} stroke={COLOR_TOCA} strokeWidth={3} vectorEffect="non-scaling-stroke" strokeLinejoin="round" filter={`url(#brillo-${uid})`} />
                            ))}
                        </g>
                    ))}
                </g>
            ))}

            {/* Rótulos: una pastilla oscura arriba de cada objeto. */}
            {etiquetas && objetos.map((o, i) => {
                const c = tocan[i] ? COLOR_TOCA : COLOR_GRUPO[o.grupo] || COLOR_OTRO;
                const extra = atributos ? (o.atributos || []).filter((a) => !a.dudoso && (a.id === "color" || a.id === "carroceria" || a.id === "tipo")).map((a) => a.valor).slice(0, 2) : [];
                const texto = [NOMBRE_GRUPO[o.grupo] ? (o.grupo === "persona" ? NOMBRE_GRUPO[o.grupo] : o.nombre[0]?.toUpperCase() + o.nombre.slice(1)) : o.nombre, ...extra].join(" · ") + ` ${Math.round(o.confianza * 100)} %`;
                const x = Math.max(0, o.caja[0] * W), y = Math.max(fuente * 1.6, o.caja[1] * H - fuente * 0.4);
                const ancho = texto.length * fuente * 0.56 + fuente;
                return (
                    <g key={`e${i}`} transform={`translate(${Math.min(x, W - ancho)},${y})`}>
                        <rect x={0} y={-fuente * 1.35} width={ancho} height={fuente * 1.6} rx={fuente * 0.8} fill="rgba(2,6,23,0.78)" stroke={c} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
                        <circle cx={fuente * 0.7} cy={-fuente * 0.55} r={fuente * 0.28} fill={c} />
                        <text x={fuente * 1.2} y={-fuente * 0.18} fontSize={fuente} fontWeight={600} fill="#f8fafc" fontFamily="Outfit, system-ui, sans-serif">{texto}</text>
                    </g>
                );
            })}
        </svg>
    );
}
