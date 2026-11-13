"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Backpack, Bike, Bird, Briefcase, Bus, Car, Cat, Clock, Dog, Luggage, Motorbike, PawPrint, ScanEye, Truck, User, type LucideIcon, Boxes } from "lucide-react";
import { RelojRodante } from "@/components/tracking/MarcaEstadia";
import { bandasLinea, poligonos, veredicto, type Analisis, type GeomNorm, type ObjetoAnalizado, type Pt } from "@/lib/vision-capa";
import { iconoPropio, useNombresPropios } from "@/lib/nombres-propios";
import { resolverIcono } from "@/components/vision/iconos-clase";

/**
 * Tocar un objeto en el vivo (13/11, Nico: «el tiempo de permanencia sólo debe mostrarse al tocar
 * el objeto sobre el video; si no, satura toda la escena… debe animarse el tiempo, ícono de reloj
 * solo»). Con ocho autos estacionados, ocho «HACE 2 h 39» tapaban la calle.
 *
 * Los objetos llegan de nuevo varias veces por segundo y sin identidad: el elegido se recuerda por
 * su LUGAR (su caja) y en cada cuadro es el que más se le superpone. Si deja de verse un rato, se suelta.
 */
const MISMO_OBJETO_IOU = 0.3;
const SOLTAR_SIN_VER_MS = 4000;
/**
 * El foco (13/11, Nico, el mismo día: «cuando presiono clic sobre un vehículo deben desaparecer el
 * resto de analíticas para poder apreciar bien; desaparecer solas y volver a las de toda la escena.
 * Si podés, un efecto de oscuridad sobre todo menos el objeto presionado»). Con uno tocado se
 * oscurece la escena menos su silueta y se dejan de dibujar los demás objetos, la línea y la zona.
 * A los FOCO_MS vuelve sola a mostrar todo; tocar lo oscuro (o el mismo objeto) vuelve antes.
 */
const FOCO_MS = 8000;
const FOCO_OSCURO = 0.62;
/**
 * El menú del objeto en foco (13/11, Nico: «al hacerle clic, cuando muestra el tiempo, que tenga
 * menú contextual y pueda ejecutar opciones»). Va debajo del reloj, pegado al rótulo: viaja con
 * el objeto y no tapa otra parte de la escena. Qué opciones hay lo decide quien usa la capa (la
 * ficha del canal sabe si hay grabación, búsqueda o lista); acá sólo se dibujan.
 *
 * Una opción que no se puede usar no se esconde: se muestra apagada con el porqué, así no parece
 * que el menú cambia solo de un auto a otro.
 */
export type OpcionObjeto = {
    clave: string; rotulo: string; Icono: LucideIcon;
    /** Sólo para lo que ES una alerta (la lista amarilla): el ícono en ámbar. Lo demás, sin color. */
    tono?: "aviso";
    /** Por qué no se puede ahora: la opción va apagada y esto se lee debajo. */
    motivo?: string;
    alElegir: () => void;
};
/**
 * Fluidez (13/11, Nico: «necesitamos afinar más los movimientos de los puntos y los datos; más
 * fluidez en el seguimiento»). El análisis llega unas 9 veces por segundo y cada vez se dibujaba
 * todo de cero: las siluetas saltaban de un lugar al otro, el punto del rótulo bailaba sobre el
 * techo del auto (se ancla al punto más alto de la silueta, que cambia de cuadro a cuadro) y el
 * rótulo cambiaba de lado o de renglón cada vez que otro se le acercaba.
 *
 * Tres cosas, sólo en el vivo:
 *  · Cada objeto conserva su identidad entre cuadros (el que más se superpone con el de antes):
 *    con eso su silueta y su rótulo son el MISMO elemento que se mueve, y no uno nuevo.
 *  · Ese movimiento se desliza en DESLIZ_MS en vez de saltar. La silueta toma su forma nueva y
 *    viaja de la caja vieja a la nueva; el rótulo viaja con su punto.
 *  · El punto se suaviza (ANCLA_SUAVE) y el rótulo se queda donde estaba mientras entre y no pise
 *    a otro (PISA_TOLERADA): sólo se muda cuando hace falta.
 */
const DESLIZ_MS = 150;
const ANCLA_SUAVE = 0.45;
/** Cuánto de su propia superficie puede pisar un rótulo a otros antes de mudarse de lugar. */
const PISA_TOLERADA = 0.12;
/** Sin verse este tiempo, la identidad de un objeto se olvida. */
const PISTA_OLVIDO_MS = 1500;
type Pista = { id: number; grupo: string; caja: Caja; ancla: [number, number] | null; lugar: { dir: number; dy: number } | null; visto: number };
type Caja = number[];
function iou(a: Caja, b: Caja): number {
    const w = Math.min(a[2], b[2]) - Math.max(a[0], b[0]), h = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
    if (w <= 0 || h <= 0) return 0;
    const i = w * h;
    return i / ((a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - i);
}

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
/** Exportados: la ficha del visor pinta el punto de cada objeto con el mismo color que su silueta. */
export const COLOR_GRUPO: Record<string, string> = { persona: "#38bdf8", vehiculo: "#a78bfa", animal: "#fbbf24" };
export const COLOR_OTRO = "#e2e8f0";
const COLOR_GEOM = "#f8fafc";
const COLOR_TOCA = "#f43f5e";
/**
 * La chapa que leyó OmniVision (Nico, 15/10: «dentro de las siluetas, la matrícula cuadrada
 * similar»): un recuadro blanco sobre la chapa misma, y debajo la chapa dibujada como una
 * Mercosur —franja azul arriba, letras negras— para que se lea como matrícula y no como rótulo.
 */
const COLOR_CHAPA = "#f8fafc";
const AZUL_MERCOSUR = "#1d4ed8";
export type ChapaEnFoto = { plate: string; caja: [number, number, number, number] };
/** El ícono dice QUÉ es antes de leer: la clase si la conocemos, si no el grupo. */
export const ICONO_CLASE: Record<string, LucideIcon> = {
    person: User, car: Car, truck: Truck, bus: Bus, motorcycle: Motorbike, bicycle: Bike,
    dog: Dog, cat: Cat, bird: Bird, backpack: Backpack, handbag: Briefcase, suitcase: Luggage,
};
export const ICONO_GRUPO: Record<string, LucideIcon> = { persona: User, vehiculo: Car, animal: PawPrint, propio: Boxes };

/**
 * El borde de arriba de una silueta sobre una vertical: dónde la cruza su contorno, lo más alto.
 *
 * Antes se tomaba «el vértice más alto entre los que caen cerca del medio». Un techo recto no
 * tiene vértices en el medio —sólo en las puntas—, así que en una camioneta el único vértice de
 * esa franja era uno de ABAJO y el punto del rótulo caía sobre la rueda (13/11, captura de Nico).
 * Lo que se quiere es el borde, no un vértice: se cortan los lados del contorno con la vertical.
 */
function techoEn(polis: Pt[][], x: number): number | null {
    let y = Infinity;
    for (const p of polis) for (let k = 0; k < p.length; k++) {
        const a = p[k], b = p[(k + 1) % p.length];
        if (a[0] === b[0] || (a[0] - x) * (b[0] - x) > 0) continue;
        y = Math.min(y, a[1] + ((x - a[0]) / (b[0] - a[0])) * (b[1] - a[1]));
    }
    return Number.isFinite(y) ? y : null;
}

const pts = (p: Pt[], w: number, h: number) => p.map(([x, y]) => `${(x * w).toFixed(1)},${(y * h).toFixed(1)}`).join(" ");
const ptsPx = (p: Pt[]) => p.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");

export function CapaAnalisis({ analisis, geom, ajuste = "contain", etiquetas = true, atributos = false, chapa, interactiva = false, opciones, className }: {
    analisis: Analisis;
    /** La chapa que leyó OmniVision, con su caja en la foto (relectura). */
    chapa?: ChapaEnFoto | null;
    geom?: GeomNorm | null;
    ajuste?: "contain" | "cover";
    /** El rótulo «Persona 92 %» sobre cada objeto. En una miniatura sobra. */
    etiquetas?: boolean;
    /** Sumar al rótulo el color o la carrocería (lecturas LPR). */
    atributos?: boolean;
    /** El vivo: las siluetas se pueden tocar, y la que se toca muestra cuánto lleva en su lugar. */
    interactiva?: boolean;
    /** El menú del objeto tocado (sólo en el vivo): qué se puede hacer con ESE objeto. Sin esto, no hay menú. */
    opciones?: (o: ObjetoAnalizado) => OpcionObjeto[];
    className?: string;
}) {
    const uid = useId().replace(/:/g, "");
    // Los íconos elegidos para las clases entrenadas: se vuelve a dibujar cuando llega la lista.
    useNombresPropios();
    const { ancho: W, alto: H, objetos } = analisis;
    const { tocan } = useMemo(() => veredicto(analisis, geom || null), [analisis, geom]);
    const bandas = useMemo(() => (geom?.linea.length ? bandasLinea(geom.linea, W, H) : []), [geom, W, H]);
    // La identidad de cada objeto entre un cuadro y el siguiente (ver DESLIZ_MS). Fuera del vivo, su posición en la lista.
    const pistas = useRef<Pista[]>([]);
    const serie = useRef(0);
    const ids = useMemo(() => {
        if (!interactiva) return objetos.map((_, i) => i);
        const ahora = Date.now(), ps = pistas.current, out: number[] = new Array(objetos.length).fill(-1), usadas = new Set<number>();
        // De la pareja que más se superpone a la que menos: cada objeto y cada pista, una sola vez.
        const pares: [number, number, number][] = [];
        objetos.forEach((o, i) => ps.forEach((q, j) => { if (q.grupo !== o.grupo) return; const v = iou(o.caja, q.caja); if (v >= MISMO_OBJETO_IOU) pares.push([v, i, j]); }));
        pares.sort((a, b) => b[0] - a[0]);
        for (const [, i, j] of pares) { if (out[i] !== -1 || usadas.has(j)) continue; out[i] = ps[j].id; usadas.add(j); ps[j].caja = objetos[i].caja; ps[j].visto = ahora; }
        objetos.forEach((o, i) => { if (out[i] === -1) { const id = ++serie.current; ps.push({ id, grupo: o.grupo, caja: o.caja, ancla: null, lugar: null, visto: ahora }); out[i] = id; } });
        pistas.current = ps.filter((q) => ahora - q.visto < PISTA_OLVIDO_MS);
        return out;
    }, [objetos, interactiva]);
    // Siempre en el mismo orden (el más viejo primero): mover un elemento de lugar en el documento le corta el deslizamiento.
    const orden = useMemo(() => objetos.map((_, i) => i).sort((a, b) => ids[a] - ids[b]), [objetos, ids]);
    const pistaDe = (id: number) => (interactiva ? pistas.current.find((q) => q.id === id) || null : null);
    const desliz = (transform: string): React.CSSProperties | undefined => (interactiva ? { transform, transformOrigin: "0 0", transition: `transform ${DESLIZ_MS}ms linear` } : undefined);

    // El objeto tocado: su caja (se va corriendo con él) y la última vez que se lo vio.
    const [elegido, setElegido] = useState<Caja | null>(null);
    const visto = useRef(0);
    const iSel = useMemo(() => {
        if (!interactiva || !elegido) return -1;
        let mejor = -1, m = MISMO_OBJETO_IOU;
        objetos.forEach((o, i) => { const v = iou(elegido, o.caja); if (v >= m) { m = v; mejor = i; } });
        return mejor;
    }, [interactiva, elegido, objetos]);
    useEffect(() => {
        if (!elegido) return;
        if (iSel >= 0) {
            visto.current = Date.now();
            // Se sigue al objeto: la próxima vez se lo busca donde está ahora.
            const c = objetos[iSel].caja;
            if (c.some((v, k) => Math.abs(v - elegido[k]) > 0.002)) setElegido(c);
        } else if (Date.now() - visto.current > SOLTAR_SIN_VER_MS) setElegido(null);
    }, [elegido, iSel, objetos]);
    // Cuándo se tocó: de ahí corre el tiempo del foco (no de `elegido`, que cambia en cada cuadro al seguir al objeto).
    const [tocadoEn, setTocadoEn] = useState(0);
    // Dónde quedó el rótulo del objeto tocado mientras tiene el menú abierto (ver «quieto» más abajo).
    const fijo = useRef<{ dir: number; ex: number; ey: number } | null>(null);
    const tocar = (i: number) => { visto.current = Date.now(); fijo.current = null; setTocadoEn(Date.now()); setElegido(i === iSel ? null : objetos[i].caja); };
    useEffect(() => {
        if (!tocadoEn) return;
        const t = setTimeout(() => setElegido(null), FOCO_MS);
        return () => clearTimeout(t);
    }, [tocadoEn]);
    const foco = interactiva && iSel >= 0;
    if (!elegido) fijo.current = null;
    if (!W || !H) return null;
    const lado = Math.min(W, H);
    // Cuerpo de los rótulos, en píxeles de la imagen: 2,6 % del lado corto. El piso de 11 px era
    // para fotos chicas, pero en un recorte de 384×158 (analíticas entrenables) 11 px es el 7 % del
    // alto y los rótulos tapaban todo; el piso ahora también es proporcional (4,5 % como mucho).
    const fuente = Math.max(lado * 0.026, Math.min(11, lado * 0.045));
    const hayGeom = !!geom && (geom.linea.length >= 2 || geom.zona.length >= 3);

    return (
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio={ajuste === "cover" ? "xMidYMid slice" : "xMidYMid meet"}
            // `data-capa-tocable`: quien la contiene distingue un toque sobre una silueta (o su menú) de uno sobre el video pelado.
            className={`absolute inset-0 w-full h-full pointer-events-none ${className || ""}`} aria-hidden data-capa-tocable={interactiva ? "" : undefined}>
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

            {/* La zona: rayada, con borde punteado. (Con un objeto en foco, la línea y la zona no se dibujan.) */}
            {!foco && geom && geom.zona.length >= 3 && (
                <g filter={`url(#sombra-${uid})`}>
                    <polygon points={pts(geom.zona, W, H)} fill={`url(#rayas-${uid})`} />
                    <polygon points={pts(geom.zona, W, H)} fill="none" stroke={COLOR_GEOM} strokeWidth={2} strokeDasharray="8 6" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
                </g>
            )}
            {/* La línea: una cinta (halo ancho y suave, centro firme) con sus extremos marcados. */}
            {!foco && geom && geom.linea.length >= 2 && (
                <g filter={`url(#sombra-${uid})`}>
                    <polyline points={pts(geom.linea, W, H)} fill="none" stroke={COLOR_GEOM} strokeOpacity="0.25" strokeWidth={10} vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />
                    <polyline points={pts(geom.linea, W, H)} fill="none" stroke={COLOR_GEOM} strokeWidth={2.5} vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />
                    {[geom.linea[0], geom.linea[geom.linea.length - 1]].map(([x, y], i) => (
                        <circle key={i} cx={x * W} cy={y * H} r={lado * 0.009} fill="#0f172a" stroke={COLOR_GEOM} strokeWidth={2} vectorEffect="non-scaling-stroke" />
                    ))}
                </g>
            )}

            {/* Las demás líneas y zonas prendidas de la cámara (hasta 4 de cada una): más sobrias que la primera. */}
            {!foco && geom?.otras?.zonas.map((z, i) => <polygon key={`oz${i}`} points={pts(z, W, H)} fill="none" stroke={COLOR_GEOM} strokeWidth={2} strokeDasharray="8 6" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />)}
            {!foco && geom?.otras?.lineas.map((l, i) => <polyline key={`ol${i}`} points={pts(l, W, H)} fill="none" stroke={COLOR_GEOM} strokeWidth={2.5} vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />)}

            {/* El foco: todo oscuro menos la silueta tocada (un rectángulo con su forma calada). Tocar lo oscuro lo suelta. */}
            {foco && (
                <path fillRule="evenodd" fill="#020617" fillOpacity={FOCO_OSCURO} style={{ pointerEvents: "auto" }} onClick={() => setElegido(null)}
                    d={`M0,0H${W}V${H}H0Z ${poligonos(objetos[iSel]).map((p) => `M${p.map(([x, y]) => `${(x * W).toFixed(1)},${(y * H).toFixed(1)}`).join("L")}Z`).join(" ")}`}>
                    <animate attributeName="fill-opacity" from="0" to={FOCO_OSCURO} dur="0.28s" fill="freeze" />
                </path>
            )}

            {/* Las siluetas: relleno en degradé y borde con brillo, del color de su grupo. */}
            {orden.map((i) => {
                const o = objetos[i];
                const k = COLOR_GRUPO[o.grupo] ? o.grupo : "otro";
                const c = COLOR_GRUPO[o.grupo] || COLOR_OTRO;
                const sel = i === iSel;
                // Con uno en foco, los demás no se dibujan; y el del foco va sin relleno: se lo quiere VER.
                if (foco && !sel) return null;
                /*
                 * En el vivo la silueta se desliza de su caja anterior a la nueva: el grupo de afuera
                 * lleva la caja como transformación (y eso es lo que el navegador anima), y el de
                 * adentro la deshace, así los puntos se siguen escribiendo en las coordenadas de la
                 * imagen. Quieta, las dos se anulan; en movimiento, se ve la forma nueva viajando.
                 */
                const bx = o.caja[0] * W, by = o.caja[1] * H, bw = Math.max(1, (o.caja[2] - o.caja[0]) * W), bh = Math.max(1, (o.caja[3] - o.caja[1]) * H);
                return (
                    <g key={ids[i]} style={desliz(`translate(${bx.toFixed(1)}px, ${by.toFixed(1)}px) scale(${bw.toFixed(2)}, ${bh.toFixed(2)})`)}>
                        <g transform={interactiva ? `scale(${1 / bw} ${1 / bh}) translate(${-bx.toFixed(1)} ${-by.toFixed(1)})` : undefined}
                            onClick={interactiva ? () => tocar(i) : undefined} style={interactiva ? { pointerEvents: "all", cursor: "pointer" } : undefined}>
                            {poligonos(o).map((p, j) => (
                                <polygon key={j} points={pts(p, W, H)} fill={sel ? "transparent" : `url(#rel-${k}-${uid})`} stroke={c} strokeWidth={sel ? 3 : 2} vectorEffect="non-scaling-stroke"
                                    strokeLinejoin="round" filter={`url(#brillo-${uid})`} />
                            ))}
                        </g>
                    </g>
                );
            })}

            {/* Sólo la parte que toca: la misma silueta, recortada por la zona y por la franja de la línea. */}
            {hayGeom && !foco && objetos.map((o, i) => tocan[i] && (
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

            {/* La chapa: recuadro sobre la chapa y, debajo (o arriba si no entra), la matrícula dibujada. */}
            {/* Una o varias: la releída de la foto, y en el vivo la de cada auto estacionado (su estadía abierta). */}
            {(foco ? [objetos[iSel].chapa] : [chapa, ...objetos.map((o) => o.chapa)]).filter((c): c is ChapaEnFoto => !!c).map((chapa, k) => {
                const [x1, y1, x2, y2] = chapa.caja;
                const bx = x1 * W, by = y1 * H, bw = Math.max(2, (x2 - x1) * W), bh = Math.max(2, (y2 - y1) * H);
                const f = fuente * 1.15, pw = Math.max(bw, chapa.plate.length * f * 0.72 + f * 1.2), ph = f * 2.05, franja = ph * 0.26;
                const px = Math.min(W - pw - 2, Math.max(2, bx + bw / 2 - pw / 2));
                const debajo = by + bh + f * 0.5 + ph < H;
                const py = debajo ? by + bh + f * 0.5 : Math.max(2, by - f * 0.5 - ph);
                return (
                    <g key={`ch${k}`}>
                        <rect x={bx} y={by} width={bw} height={bh} rx={lado * 0.004} fill={COLOR_CHAPA} fillOpacity={0.08} stroke={COLOR_CHAPA} strokeWidth={2.25} vectorEffect="non-scaling-stroke" filter={`url(#brillo-${uid})`} />
                        <line x1={bx + bw / 2} y1={debajo ? by + bh : by} x2={bx + bw / 2} y2={debajo ? py : py + ph} stroke={COLOR_CHAPA} strokeOpacity={0.7} strokeWidth={1.4} vectorEffect="non-scaling-stroke" />
                        <g filter={`url(#sombra-${uid})`}>
                            <rect x={px} y={py} width={pw} height={ph} rx={f * 0.22} fill="#ffffff" stroke="#0f172a" strokeWidth={1} vectorEffect="non-scaling-stroke" />
                            <path d={`M${px + f * 0.22},${py} h${pw - f * 0.44} a${f * 0.22},${f * 0.22} 0 0 1 ${f * 0.22},${f * 0.22} v${franja - f * 0.22} h${-pw} v${-(franja - f * 0.22)} a${f * 0.22},${f * 0.22} 0 0 1 ${f * 0.22},${-f * 0.22} z`} fill={AZUL_MERCOSUR} />
                        </g>
                        <text x={px + pw / 2} y={py + franja + (ph - franja) * 0.74} textAnchor="middle" fontSize={f * 1.08} fontWeight={800} fill="#0b0f19"
                            fontFamily="Outfit, system-ui, sans-serif" letterSpacing={0.06 * f} style={{ fontVariantNumeric: "tabular-nums" }}>{chapa.plate}</text>
                    </g>
                );
            })}

            {/* Rótulos: un punto anillado sobre lo más alto de la silueta, una línea guía con codo, y
                el texto sin fondo apoyado sobre la línea: arriba el ícono y qué es, abajo los atributos
                y la confianza en versalitas. Antes era una pastilla oscura encima de la caja: tapaba
                la foto y se leía como un rótulo de sistema, no como lo que vio el análisis.
                Medidas en píxeles de la IMAGEN (f = cuerpo del título), así escalan con la foto. */}
            {etiquetas && (() => { const puestos: [number, number, number, number][] = []; return orden.map((i) => {
                const o = objetos[i];
                const pista = pistaDe(ids[i]);
                // Con uno en foco, sólo su rótulo.
                if (foco && i !== iSel) return null;
                const c = tocan[i] && !foco ? COLOR_TOCA : COLOR_GRUPO[o.grupo] || COLOR_OTRO;
                /*
                 * El ícono de una clase entrenada es el que se le eligió (12/11, Nico: «el ícono al
                 * lado del nombre»): viene con el objeto en el vivo, y si no, de la lista de clases.
                 * Una imagen subida se dibuja tal cual; un dibujo de la lista, en el color del grupo.
                 */
                const propio = o.grupo === "propio" ? resolverIcono(o.icono || iconoPropio(o.clase)) : null;
                const Icono = propio?.dibujo || ICONO_CLASE[o.clase] || ICONO_GRUPO[o.grupo] || ScanEye;
                const titulo = o.nombre ? o.nombre[0].toUpperCase() + o.nombre.slice(1) : o.clase;
                const extra = atributos ? (o.atributos || []).filter((a) => !a.dudoso && (a.id === "color" || a.id === "carroceria" || a.id === "tipo")).map((a) => a.valor).slice(0, 2) : [];
                // Cuánto lleva en su lugar: sólo en el objeto que se tocó (ver arriba), con el reloj andando.
                const sel = i === iSel;
                const reloj = sel && o.quietoDesde ? o.quietoDesde : null;
                const menu = sel && opciones ? opciones(o) : [];
                const meta = extra.map((x) => x.toUpperCase()).join(" · ");
                const conf = `${Math.round(o.confianza * 100)} %`;
                const f = fuente * 1.05, fm = fuente * 0.74, icono = f * 1.15, hueco = f * 0.4;
                // Anchos estimados con margen (la letra de reemplazo, si falta Outfit, es más ancha).
                const anchoTitulo = icono + hueco + titulo.length * f * 0.56;
                const anchoMeta = (meta.length + conf.length + (meta ? 3 : 0)) * fm * 0.78;
                // El reloj va en un cuerpo más grande que el renglón de datos: «2 d 03 h 15 min» es lo más largo.
                const fr = f * 1.25, anchoReloj = fr * 9.5;
                // El menú: un renglón por opción (dos si va apagada, con su porqué). Medidas en px de la imagen, como todo acá.
                // (13/11, Nico con el menú en pantalla: «achicarlo en general un 20 %, es muy grande».)
                const fo = f * 0.64, altoOpcion = fo * 2.3, altoMotivo = fo * 1.05;
                const anchoMenu = menu.length ? Math.max(...menu.map((m) => Math.max(m.rotulo.length * fo * 0.53, (m.motivo?.length || 0) * fo * 0.41))) + fo * 3.4 : 0;
                const altoMenu = menu.length ? menu.reduce((t, m) => t + altoOpcion + (m.motivo ? altoMotivo : 0), fo * 0.7) : 0;
                const altoReloj = reloj ? fr * 1.7 : 0;
                const largo = Math.max(anchoTitulo, anchoMeta, reloj ? anchoReloj : 0) + f * 0.9;
                // El ancla: el punto más alto de la silueta (la cabeza, el techo), el más centrado si hay varios.
                const [x1, y1, x2, y2] = o.caja;
                const todos = poligonos(o).flat();
                const minY = Math.min(...todos.map((q) => q[1]));
                const cx = (x1 + x2) / 2;
                /*
                 * En el vivo, el punto va al medio del objeto, sobre su borde de arriba. «El más alto»
                 * en un techo plano son muchos puntos casi iguales y cada cuadro ganaba otro: el punto
                 * saltaba de una punta a la otra del auto (medido: pasos de 11 a 31 px por cuadro de
                 * pantalla con el objeto quieto). El medio de la caja casi no se mueve.
                 */
                // Dónde corta el contorno a la vertical del medio, lo más arriba: ver `techoEn`.
                const arriba = interactiva ? [cx, techoEn(poligonos(o), cx) ?? minY]
                    : todos.filter((q) => q[1] <= minY + (y2 - y1) * 0.03).sort((a, b) => Math.abs(a[0] - cx) - Math.abs(b[0] - cx))[0] || [cx, y1];
                // En el vivo el punto no salta al nuevo «más alto»: se le acerca. Si el objeto se fue lejos, sí.
                let ax = arriba[0] * W, ay = arriba[1] * H;
                if (pista) {
                    const a = pista.ancla;
                    if (a && Math.hypot(ax - a[0], ay - a[1]) < lado * 0.12) { ax = a[0] + (ax - a[0]) * ANCLA_SUAVE; ay = a[1] + (ay - a[1]) * ANCLA_SUAVE; }
                    pista.ancla = [ax, ay];
                }
                const diag = f * 2.4, margen = f * 0.3;
                /*
                 * Con menú, el rótulo sale hasta AFUERA de la caja del objeto: si no, el menú colgaba
                 * encima del auto que se acaba de tocar para verlo bien. Si no entra de ningún lado
                 * (un ómnibus que ocupa media pantalla), queda como siempre y lo pisa.
                 */
                let alcance = diag;
                if (menu.length) {
                    const fuera = ((x2 - x1) * W) / 2 + f * 0.9, ancho = Math.max(largo, anchoMenu + margen);
                    if (ax + fuera + ancho <= W - margen || ax - fuera - ancho >= margen) alcance = Math.max(diag, fuera);
                }
                /*
                 * Dónde va el rótulo: hacia el lado con lugar, arriba del ancla, y si pisa a otro se
                 * prueban renglones alternando abajo y arriba (y después el otro lado), dentro de la
                 * foto. Se queda el primero que no pisa a nadie; si ninguno, el que menos pisa.
                 *
                 * Antes se corría un escalón «arriba si hay lugar, si no abajo» seis veces: pegado al
                 * borde de arriba eso oscilaba entre dos renglones y terminaba en el de partida, encima
                 * del otro rótulo («Camión o camioneta» tapando «Persona», 10/10).
                 */
                const preferido = ax < W * 0.62 ? 1 : -1;
                // Con el reloj y el menú colgando debajo, el rótulo sube lo necesario para que entren en la foto.
                const yMin = f * 1.9, yMax = Math.max(yMin, H - fm * 2.2 - (altoReloj + altoMenu ? altoReloj + altoMenu + fm * 0.4 : 0)), paso = f * 2.9;
                const y0 = Math.min(yMax, Math.max(yMin, ay - diag));
                const caja = (d: number, y: number): [number, number, number, number] => {
                    const e = ax + d * alcance;
                    return [Math.min(e, e + d * largo), y - f * 1.6, largo, f * 1.6 + fm * 1.9 + (reloj ? fr * 1.6 : 0)];
                };
                const pisa = (b: [number, number, number, number]) => puestos.reduce((t, [px, py, pw, ph]) =>
                    t + Math.max(0, Math.min(b[0] + b[2], px + pw) - Math.max(b[0], px)) * Math.max(0, Math.min(b[1] + b[3], py + ph) - Math.max(b[1], py)), 0);
                // (Con menú, además tiene que entrar su ancho: si no, del otro lado.)
                const entra = (d: number) => { const b = caja(d, y0), e = ax + d * alcance; return b[0] >= margen && b[0] + b[2] <= W - margen && (!menu.length || (d === 1 ? e + margen + anchoMenu <= W - margen : e - margen - anchoMenu >= margen)); };
                const lados = [preferido, -preferido].filter(entra);
                if (!lados.length) lados.push(preferido);
                let mejor = { dir: lados[0], ey: y0, pisa: Infinity };
                // Donde estaba, si todavía entra en la foto y casi no pisa a nadie: un rótulo que se muda en cada cuadro no se puede leer.
                const antes = pista?.lugar;
                if (antes) {
                    const y = ay + antes.dy, b = caja(antes.dir, y);
                    if (y >= yMin - 0.01 && y <= yMax + 0.01 && entra(antes.dir)) {
                        const solape = pisa(b);
                        if (solape <= b[2] * b[3] * PISA_TOLERADA) mejor = { dir: antes.dir, ey: y, pisa: -1 };
                    }
                }
                if (mejor.pisa !== -1) buscar: for (const d of lados) {
                    for (const k of [0, 1, -1, 2, -2, 3, -3, 4, -4]) {
                        const y = y0 + k * paso;
                        if (y < yMin - 0.01 || y > yMax + 0.01) continue;
                        const solape = pisa(caja(d, y));
                        if (solape < mejor.pisa) mejor = { dir: d, ey: y, pisa: solape };
                        if (solape < 0.5) break buscar;
                    }
                }
                let dir = mejor.dir, ey = mejor.ey, ex = ax + dir * alcance;
                /*
                 * Con el menú abierto, el rótulo se queda DONDE APARECIÓ (13/11, Nico: «el menú se
                 * mueve con la analítica, debería quedar estático para poder seleccionar»). El punto
                 * del rótulo sigue al objeto —tiembla con cada cuadro, y si el vehículo arranca, se
                 * va con él—, pero el texto, el reloj y el menú no: no se le puede apuntar a un botón
                 * que se corre. La guía se estira del punto al rótulo quieto.
                 */
                const quieto = sel && menu.length > 0;
                if (quieto) { const g = fijo.current; if (g) { dir = g.dir; ex = g.ex; ey = g.ey; } else fijo.current = { dir, ex, ey }; }
                if (pista) pista.lugar = { dir, dy: ey - ay };
                puestos.push(caja(dir, ey));
                const fx = ex + dir * largo;
                const tx = ex + dir * margen;
                const anchor = dir === 1 ? "start" : "end";
                const ix = dir === 1 ? tx : tx - icono;
                const tituloX = dir === 1 ? tx + icono + hueco : tx - icono - hueco;
                return (
                    // Igual que la silueta: afuera el lugar del punto (lo que se anima), adentro se lo deshace.
                    // (Con el menú abierto no se desliza: el rótulo está quieto y sólo el punto sigue al objeto.)
                    <g key={`e${ids[i]}`} style={quieto ? undefined : desliz(`translate(${ax.toFixed(1)}px, ${ay.toFixed(1)}px)`)}>
                    <g transform={interactiva && !quieto ? `translate(${-ax.toFixed(1)} ${-ay.toFixed(1)})` : undefined}>
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
                            {propio?.imagen
                                ? <image href={propio.imagen} x={ix} y={ey - f * 0.42 - icono} width={icono} height={icono} preserveAspectRatio="xMidYMid meet" />
                                : <Icono x={ix} y={ey - f * 0.42 - icono} width={icono} height={icono} color={c} strokeWidth={2.25} absoluteStrokeWidth={false} />}
                            <text x={tituloX} y={ey - f * 0.5} textAnchor={anchor} fontSize={f} fontWeight={700} fill="#ffffff" letterSpacing={-0.01 * f}>{titulo}</text>
                            <text x={tx} y={ey + fm * 1.45} textAnchor={anchor} fontSize={fm} fontWeight={700} letterSpacing={0.12 * fm} style={{ fontVariantNumeric: "tabular-nums" }}>
                                {meta && <tspan fill="rgba(248,250,252,0.86)">{meta}</tspan>}
                                <tspan fill={c} dx={meta ? fm * 1.1 : 0}>{conf}</tspan>
                            </text>
                        </g>
                        {/* El reloj: un ícono y el tiempo con las cifras rodando al segundo. Es HTML dentro del
                            SVG para usar el mismo reloj que el visor de un estacionado; las medidas son px de la imagen. */}
                        {reloj && (
                            <foreignObject x={dir === 1 ? tx : tx - anchoReloj} y={ey + fm * 2.1} width={anchoReloj} height={fr * 1.7} style={{ overflow: "visible", pointerEvents: "none" }}>
                                <div style={{ display: "flex", alignItems: "center", justifyContent: dir === 1 ? "flex-start" : "flex-end", gap: fr * 0.32, height: "100%", fontSize: fr, color: "#fff", fontFamily: "Outfit, system-ui, sans-serif" }}>
                                    <Clock width={fr * 0.92} height={fr * 0.92} color={c} strokeWidth={2.4} style={{ flexShrink: 0, filter: "drop-shadow(0 1px 2px rgba(2,6,23,.95))" }} />
                                    <RelojRodante desde={new Date(reloj)} />
                                </div>
                            </foreignObject>
                        )}
                        {/* El menú del objeto: debajo del reloj (o del renglón de datos, si no lleva reloj). Es lo
                            único de la capa, además de las siluetas, que recibe el toque. */}
                        {menu.length > 0 && (
                            <foreignObject x={dir === 1 ? tx : tx - anchoMenu} y={ey + fm * 2.1 + altoReloj + fm * 0.3} width={anchoMenu} height={altoMenu} style={{ overflow: "visible" }}>
                                <motion.div role="menu" aria-label={`Qué hacer con ${titulo}`}
                                    initial={{ opacity: 0, y: -fo * 0.5 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18, ease: "easeOut" }}
                                    // Mientras el cursor (o el dedo) está encima, el foco no se suelta; al salir, vuelve a contar.
                                    onPointerEnter={() => setTocadoEn(0)} onPointerLeave={() => setTocadoEn(Date.now())}
                                    style={{ pointerEvents: "auto", width: anchoMenu, padding: fo * 0.35, borderRadius: fo * 0.75, fontFamily: "Outfit, system-ui, sans-serif",
                                        background: "rgba(8,11,17,.86)", border: "1px solid rgba(248,250,252,.14)", boxShadow: "var(--sombra-flotante)" }}>
                                    {menu.map((m) => (
                                        <button key={m.clave} type="button" role="menuitem" disabled={!!m.motivo} aria-disabled={!!m.motivo}
                                            onClick={(e) => { e.stopPropagation(); if (m.motivo) return; setElegido(null); m.alElegir(); }}
                                            className={m.motivo ? "cursor-default" : "cursor-pointer hover:bg-white/[.12] active:bg-white/[.18] transition-colors"}
                                            style={{ display: "flex", alignItems: "flex-start", gap: fo * 0.6, width: "100%", minHeight: altoOpcion + (m.motivo ? altoMotivo : 0), padding: `${fo * 0.62}px ${fo * 0.7}px`,
                                                borderRadius: fo * 0.5, textAlign: "left", color: "#fff" }}>
                                            <m.Icono width={fo * 1.15} height={fo * 1.15} strokeWidth={2.2} style={{ flexShrink: 0, marginTop: fo * 0.05, color: m.motivo ? "rgba(248,250,252,.38)" : m.tono === "aviso" ? "var(--aviso)" : "rgba(248,250,252,.82)" }} />
                                            <span style={{ display: "block", minWidth: 0 }}>
                                                <span style={{ display: "block", fontSize: fo, lineHeight: 1.26, fontWeight: 600, whiteSpace: "nowrap", color: m.motivo ? "rgba(248,250,252,.5)" : undefined }}>{m.rotulo}</span>
                                                {m.motivo && <span style={{ display: "block", fontSize: fo * 0.76, lineHeight: 1.3, color: "rgba(248,250,252,.74)", whiteSpace: "nowrap" }}>{m.motivo}</span>}
                                            </span>
                                        </button>
                                    ))}
                                </motion.div>
                            </foreignObject>
                        )}
                    </g>
                    </g>
                );
            }); })()}
        </svg>
    );
}
