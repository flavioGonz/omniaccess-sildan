"use client";

import { useId, useMemo } from "react";
import { Backpack, Bike, Bird, Briefcase, Bus, Car, Cat, Dog, Luggage, Motorbike, PawPrint, ScanEye, Truck, User, type LucideIcon } from "lucide-react";
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
/** El ícono dice QUÉ es antes de leer: la clase si la conocemos, si no el grupo. */
const ICONO_CLASE: Record<string, LucideIcon> = {
    person: User, car: Car, truck: Truck, bus: Bus, motorcycle: Motorbike, bicycle: Bike,
    dog: Dog, cat: Cat, bird: Bird, backpack: Backpack, handbag: Briefcase, suitcase: Luggage,
};
const ICONO_GRUPO: Record<string, LucideIcon> = { persona: User, vehiculo: Car, animal: PawPrint };

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
                {/* Texto sobre foto sin pastilla: una sombra corta y densa lo despega de cualquier fondo. */}
                <filter id={`texto-${uid}`} x="-10%" y="-40%" width="120%" height="180%">
                    {/* Dos sombras: una ceñida que recorta la letra y una ancha que oscurece apenas el fondo (cielo, pared blanca). */}
                    <feDropShadow dx="0" dy={lado * 0.0012} stdDeviation={lado * 0.0018} floodColor="#020617" floodOpacity="0.95" result="a" />
                    <feDropShadow in="a" dx="0" dy="0" stdDeviation={lado * 0.007} floodColor="#020617" floodOpacity="0.55" />
                </filter>
                <filter id={`sombra-${uid}`} x="-20%" y="-20%" width="140%" height="140%">
                    <feDropShadow dx="0" dy="0" stdDeviation={lado * 0.003} floodColor="#000" floodOpacity="0.85" />
                </filter>
                {Object.entries({ ...COLOR_GRUPO, otro: COLOR_OTRO, toca: COLOR_TOCA }).map(([k, c]) => (
                    <linearGradient key={k} id={`rel-${k}-${uid}`} x1="0" y1="0" x2="0" y2="1">
                        {/* Liviano arriba y casi transparente abajo: el auto y la persona se tienen que seguir viendo. */}
                        <stop offset="0%" stopColor={c} stopOpacity={k === "toca" ? 0.6 : 0.28} />
                        <stop offset="100%" stopColor={c} stopOpacity={k === "toca" ? 0.4 : 0.06} />
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

            {/* Rótulos: un punto anillado sobre lo más alto de la silueta, una línea guía con codo, y
                el texto sin fondo apoyado sobre la línea: arriba el ícono y qué es, abajo los atributos
                y la confianza en versalitas. Antes era una pastilla oscura encima de la caja: tapaba
                la foto y se leía como un rótulo de sistema, no como lo que vio el análisis.
                Medidas en píxeles de la IMAGEN (f = cuerpo del título), así escalan con la foto. */}
            {etiquetas && (() => { const puestos: [number, number, number, number][] = []; return objetos.map((o, i) => {
                const c = tocan[i] ? COLOR_TOCA : COLOR_GRUPO[o.grupo] || COLOR_OTRO;
                const Icono = ICONO_CLASE[o.clase] || ICONO_GRUPO[o.grupo] || ScanEye;
                const titulo = o.nombre ? o.nombre[0].toUpperCase() + o.nombre.slice(1) : o.clase;
                const extra = atributos ? (o.atributos || []).filter((a) => !a.dudoso && (a.id === "color" || a.id === "carroceria" || a.id === "tipo")).map((a) => a.valor).slice(0, 2) : [];
                const meta = extra.join(" · ").toUpperCase();
                const conf = `${Math.round(o.confianza * 100)} %`;
                const f = fuente * 1.05, fm = fuente * 0.74, icono = f * 1.15, hueco = f * 0.4;
                // Anchos estimados con margen (la letra de reemplazo, si falta Outfit, es más ancha).
                const anchoTitulo = icono + hueco + titulo.length * f * 0.56;
                const anchoMeta = (meta.length + conf.length + (meta ? 3 : 0)) * fm * 0.78;
                const largo = Math.max(anchoTitulo, anchoMeta) + f * 0.9;
                // El ancla: el punto más alto de la silueta (la cabeza, el techo), el más centrado si hay varios.
                const [x1, y1, x2, y2] = o.caja;
                const todos = poligonos(o).flat();
                const minY = Math.min(...todos.map((q) => q[1]));
                const cx = (x1 + x2) / 2;
                const arriba = todos.filter((q) => q[1] <= minY + (y2 - y1) * 0.03).sort((a, b) => Math.abs(a[0] - cx) - Math.abs(b[0] - cx))[0] || [cx, y1];
                const ax = arriba[0] * W, ay = arriba[1] * H;
                const diag = f * 2.4, margen = f * 0.3;
                // Hacia el lado con lugar; si no entra, hacia el otro.
                let dir = ax < W * 0.62 ? 1 : -1;
                if (dir === 1 && ax + diag + largo > W - margen) dir = -1;
                else if (dir === -1 && ax - diag - largo < margen) dir = 1;
                const ex = ax + dir * diag;
                let ey = Math.max(f * 1.9, ay - diag);
                // Dos rótulos que se pisarían: el segundo sube un escalón (o baja, si arriba no hay lugar).
                const caja = (y: number): [number, number, number, number] => [Math.min(ex, ex + dir * largo), y - f * 1.6, largo, f * 1.6 + fm * 1.9];
                const choca = (b: [number, number, number, number]) => puestos.some(([px, py, pw, ph]) => b[0] < px + pw && px < b[0] + b[2] && b[1] < py + ph && py < b[1] + b[3]);
                for (let k = 0; k < 6 && choca(caja(ey)); k++) ey = ey - f * 2.9 >= f * 1.9 ? ey - f * 2.9 : ey + f * 2.9;
                puestos.push(caja(ey));
                const fx = ex + dir * largo;
                const tx = ex + dir * margen;
                const anchor = dir === 1 ? "start" : "end";
                const ix = dir === 1 ? tx : tx - icono;
                const tituloX = dir === 1 ? tx + icono + hueco : tx - icono - hueco;
                return (
                    <g key={`e${i}`}>
                        <defs>
                            {/* La línea se apaga hacia la punta: termina en el texto, no en un tope. */}
                            <linearGradient id={`guia-${i}-${uid}`} gradientUnits="userSpaceOnUse" x1={ex} y1={ey} x2={fx} y2={ey}>
                                <stop offset="0%" stopColor={c} stopOpacity="1" />
                                <stop offset="100%" stopColor={c} stopOpacity="0.12" />
                            </linearGradient>
                        </defs>
                        {/* Contraste: un trazo oscuro debajo, para que la guía se lea también sobre cielo o asfalto claro. */}
                        <polyline points={`${ax},${ay} ${ex},${ey}`} fill="none" stroke="rgba(2,6,23,0.55)" strokeWidth={3.5} vectorEffect="non-scaling-stroke" strokeLinecap="round" />
                        <g filter={`url(#brillo-${uid})`}>
                            <polyline points={`${ax},${ay} ${ex},${ey}`} fill="none" stroke={c} strokeWidth={1.6} vectorEffect="non-scaling-stroke" strokeLinecap="round" />
                            <line x1={ex} y1={ey} x2={fx} y2={ey} stroke={`url(#guia-${i}-${uid})`} strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinecap="round" />
                            <circle cx={ax} cy={ay} r={f * 0.62} fill="none" stroke={c} strokeOpacity="0.55" strokeWidth={1.2} vectorEffect="non-scaling-stroke" />
                            <circle cx={ax} cy={ay} r={f * 0.3} fill={c} stroke="#020617" strokeWidth={1} vectorEffect="non-scaling-stroke" />
                            <circle cx={ex} cy={ey} r={f * 0.14} fill={c} />
                        </g>
                        <g filter={`url(#texto-${uid})`} fontFamily="Outfit, system-ui, sans-serif">
                            <Icono x={ix} y={ey - f * 0.42 - icono} width={icono} height={icono} color={c} strokeWidth={2.25} absoluteStrokeWidth={false} />
                            <text x={tituloX} y={ey - f * 0.5} textAnchor={anchor} fontSize={f} fontWeight={700} fill="#ffffff" letterSpacing={-0.01 * f}>{titulo}</text>
                            <text x={tx} y={ey + fm * 1.45} textAnchor={anchor} fontSize={fm} fontWeight={700} letterSpacing={0.12 * fm} style={{ fontVariantNumeric: "tabular-nums" }}>
                                {meta && <tspan fill="rgba(248,250,252,0.86)">{meta}</tspan>}
                                <tspan fill={c} dx={meta ? fm * 1.1 : 0}>{conf}</tspan>
                            </text>
                        </g>
                    </g>
                );
            }); })()}
        </svg>
    );
}
