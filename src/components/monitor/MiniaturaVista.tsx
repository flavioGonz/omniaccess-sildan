"use client";

import { motion, useReducedMotion, type Transition } from "framer-motion";
import type { ClaveVista } from "@/lib/monitor/vistas";

/**
 * El dibujo de cada vista de pantalla: un monitor chico con lo que esa vista muestra, animado
 * (23/10, Nico: «un monitor para cada cosa, con esa iconografía estilizada SVG… una tabla con
 * imagen de monitor de intrusión mini, LPR, etc.»).
 *
 * No es una captura: es un esquema, y por eso no envejece ni muestra datos de nadie. Cada uno
 * cuenta en dos segundos lo que hace su vista — el canal que se pone rojo, la chapa que entra, el
 * auto que se mueve en el mapa, la alarma que llega con su video.
 *
 * Colores: la pantalla del monitor es siempre oscura (como la de la pared) y los acentos son los
 * tonos de estado de globals.css, así en tema claro y oscuro dicen lo mismo.
 */

const W = 160, H = 112;
/** La pantalla dentro del marco. */
const P = { x: 9, y: 7, w: 142, h: 82 };
const FONDO = "#0b1220";
const TEJA = "#1c2a40";
const TEJA2 = "#243552";
const LINEA = "rgba(255,255,255,0.14)";

function rep(dur: number, delay = 0): Transition { return { duration: dur, repeat: Infinity, ease: "easeInOut", delay }; }
const caja = { transformBox: "fill-box" as const, transformOrigin: "50% 50%" };

function Intrusion({ q }: { q: boolean }) {
    const tw = 44, th = 34;
    const tejas = [[13, 11], [60, 11], [13, 49], [60, 49]];
    return (
        <g>
            {tejas.map(([x, y], i) => <rect key={i} x={x} y={y} width={tw} height={th} rx={2.5} fill={TEJA} />)}
            {/* El canal en alarma: rojo que late y su zona dibujada. */}
            <motion.rect x={60} y={11} width={tw} height={th} rx={2.5} fill="var(--mal)" animate={q ? undefined : { opacity: [0.25, 0.75, 0.25] }} transition={rep(1.4)} opacity={0.5} />
            <polygon points="66,38 76,18 98,22 96,40" fill="rgba(239,68,68,0.25)" stroke="var(--mal)" strokeWidth={1} />
            <motion.circle cx={70} cy={40} r={2.6} fill="#fff" animate={q ? { x: 14, y: -10 } : { x: [0, 20, 14], y: [0, -14, -10] }} transition={rep(2.6)} />
            <line x1={16} y1={38} x2={54} y2={30} stroke="#38bdf8" strokeWidth={1.4} strokeLinecap="round" />
            {/* La franja de detecciones. */}
            {[11, 30, 49, 68].map((y, i) => (
                <motion.rect key={y} x={109} y={y} width={38} height={16} rx={2} fill={i === 0 ? "rgba(239,68,68,0.55)" : TEJA2}
                    animate={q ? undefined : { x: [9, 0], opacity: [0, 1] }} transition={{ duration: 0.6, delay: i * 0.15, repeat: Infinity, repeatDelay: 3 }} />
            ))}
        </g>
    );
}

function Alarmas({ q }: { q: boolean }) {
    return (
        <g>
            {/* La franja de la alarma, del color de su prioridad, latiendo. */}
            <motion.rect x={13} y={11} width={92} height={14} rx={2.5} fill="var(--mal)" animate={q ? undefined : { opacity: [0.55, 1, 0.55] }} transition={rep(1.2)} />
            <motion.circle cx={21} cy={18} r={4} fill="#fff" animate={q ? undefined : { scale: [1, 1.25, 1] }} transition={rep(1.2)} style={caja} />
            <rect x={29} y={15} width={40} height={3} rx={1.5} fill="rgba(255,255,255,0.9)" />
            <rect x={29} y={20} width={26} height={2} rx={1} fill="rgba(255,255,255,0.55)" />
            <rect x={84} y={14} width={17} height={8} rx={2} fill="rgba(0,0,0,0.35)" />
            {/* El video en vivo de la zona: una persona que cruza. */}
            <rect x={13} y={28} width={92} height={57} rx={2.5} fill="#111c2e" />
            <path d="M13 70 L105 62 L105 85 L13 85 Z" fill="#17263c" />
            <rect x={60} y={40} width={30} height={26} rx={1} fill="#1d2e47" />
            <motion.g animate={q ? undefined : { x: [-30, 34] }} transition={{ duration: 4, repeat: Infinity, ease: "linear" }}>
                <circle cx={40} cy={50} r={3.2} fill="#e2e8f0" />
                <path d="M36 56 h8 l1 12 h-3 l-1 9 h-3 l-1 -9 h-3 Z" fill="#e2e8f0" />
            </motion.g>
            <motion.rect x={17} y={32} width={16} height={6} rx={3} fill="var(--mal)" animate={q ? undefined : { opacity: [1, 0.4, 1] }} transition={rep(1)} />
            {/* La fila en espera y lo que va llegando. */}
            {[11, 25, 39, 53, 67].map((y, i) => (
                <motion.g key={y} animate={q ? undefined : { x: [10, 0], opacity: [0, 1] }} transition={{ duration: 0.5, delay: i * 0.2, repeat: Infinity, repeatDelay: 3.2 }}>
                    <rect x={109} y={y} width={38} height={11} rx={2} fill={TEJA} />
                    <rect x={109} y={y} width={2.5} height={11} rx={1} fill={["var(--mal)", "var(--aviso)", "var(--info)", "var(--bien)", "var(--quieto)"][i]} />
                    <rect x={114} y={y + 3.5} width={22} height={2} rx={1} fill="rgba(255,255,255,0.6)" />
                    <rect x={114} y={y + 7} width={14} height={1.6} rx={0.8} fill="rgba(255,255,255,0.3)" />
                </motion.g>
            ))}
            <rect x={109} y={81} width={38} height={4} rx={1.5} fill={TEJA2} />
        </g>
    );
}

function Lpr({ q }: { q: boolean }) {
    return (
        <g>
            <rect x={13} y={11} width={86} height={52} rx={2.5} fill="#111c2e" />
            {/* El auto que entra y su chapa. */}
            <motion.g animate={q ? undefined : { y: [10, 0], opacity: [0, 1] }} transition={{ duration: 0.8, repeat: Infinity, repeatDelay: 2.6 }}>
                <path d="M30 52 L36 38 H76 L82 52 Z" fill="#334a6b" />
                <rect x={26} y={50} width={60} height={9} rx={2} fill="#3d5a82" />
                <rect x={44} y={51.5} width={24} height={6} rx={1} fill="#f8fafc" />
                <rect x={47} y={53.5} width={18} height={2} rx={0.6} fill="#0f172a" />
            </motion.g>
            {/* Permitido: el visto bueno. */}
            <motion.g animate={q ? undefined : { scale: [0.6, 1.1, 1], opacity: [0, 1, 1] }} transition={{ duration: 0.6, delay: 0.5, repeat: Infinity, repeatDelay: 2.8 }} style={caja}>
                <circle cx={124} cy={30} r={15} fill="var(--bien)" />
                <path d="M117 30 l5 5 l9 -10" fill="none" stroke="#fff" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
            </motion.g>
            <rect x={105} y={51} width={40} height={4} rx={2} fill="rgba(255,255,255,0.55)" />
            <rect x={110} y={58} width={30} height={3} rx={1.5} fill="rgba(255,255,255,0.3)" />
            {/* La tira de las últimas. */}
            {[13, 35, 57, 79, 101, 123].map((x, i) => (
                <g key={x}>
                    <rect x={x} y={68} width={20} height={17} rx={2} fill={TEJA} />
                    <rect x={x + 3} y={77} width={14} height={4} rx={0.8} fill={i === 2 ? "var(--mal)" : "#e2e8f0"} opacity={0.85} />
                </g>
            ))}
        </g>
    );
}

/** Monitor Face: la foto tomada y la del padrón, lado a lado, y la línea de lectura que baja. */
function Face({ q }: { q: boolean }) {
    const cara = (x: number) => (
        <g>
            <rect x={x} y={11} width={36} height={48} rx={3} fill="#111c2e" />
            <circle cx={x + 18} cy={29} r={8} fill="#cbd5e1" />
            <path d={`M${x + 6} 55 q12 -16 24 0`} fill="#94a3b8" />
        </g>
    );
    return (
        <g>
            {cara(13)}
            {cara(53)}
            {/* La línea que baja sobre la tomada, como la terminal mirando. */}
            <motion.rect x={13} y={11} width={36} height={1.6} fill="#38bdf8" animate={q ? { y: 30 } : { y: [0, 46, 0] }} transition={rep(2.4)} />
            {/* El permitido. */}
            <motion.g animate={q ? undefined : { scale: [0.6, 1.1, 1], opacity: [0, 1, 1] }} transition={{ duration: 0.6, delay: 0.6, repeat: Infinity, repeatDelay: 2.6 }} style={caja}>
                <circle cx={122} cy={26} r={13} fill="var(--bien)" />
                <path d="M116 26 l4 4 l8 -9" fill="none" stroke="#fff" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" />
            </motion.g>
            <rect x={97} y={46} width={46} height={4} rx={2} fill="rgba(255,255,255,0.6)" />
            <rect x={103} y={53} width={34} height={3} rx={1.5} fill="rgba(255,255,255,0.3)" />
            {/* La tira de los anteriores. */}
            {[13, 35, 57, 79, 101, 123].map((x, i) => (
                <g key={x}>
                    <rect x={x} y={66} width={20} height={19} rx={2} fill={TEJA} />
                    <circle cx={x + 10} cy={73} r={3.5} fill="#94a3b8" opacity={0.8} />
                    <rect x={x + 4} y={80} width={12} height={2.4} rx={1} fill={i === 1 ? "var(--mal)" : "var(--bien)"} opacity={0.85} />
                </g>
            ))}
        </g>
    );
}

function Mapa({ q }: { q: boolean }) {
    // La calle y el recorrido son los mismos puntos. El auto se mueve con transform (x/y), no con
    // cx/cy: framer dejaba los atributos SVG en «undefined» al volver a dibujar la fila de la tabla.
    const pts = [[18, 76], [38, 66], [52, 46], [70, 40], [90, 46], [110, 48], [128, 34], [140, 22]];
    const camino = `M${pts.map((p) => p.join(" ")).join(" L")}`;
    return (
        <g>
            <rect x={13} y={11} width={134} height={74} rx={2.5} fill="#10213a" />
            {[[20, 16, 26, 18], [52, 50, 22, 26], [92, 14, 30, 20], [110, 52, 32, 26], [20, 44, 22, 18]].map(([x, y, w, h], i) => <rect key={i} x={x} y={y} width={w} height={h} rx={2} fill="#17304f" />)}
            <path d={camino} fill="none" stroke="rgba(148,163,184,0.45)" strokeWidth={5} strokeLinecap="round" strokeLinejoin="round" />
            <path d="M13 34 H147 M80 11 V85" stroke="rgba(148,163,184,0.25)" strokeWidth={3} />
            {/* Las cámaras, una en alarma. */}
            {[[30, 26], [96, 66], [128, 36]].map(([x, y], i) => (
                <motion.circle key={i} cx={x} cy={y} r={3.4} fill={i === 1 ? "var(--mal)" : "#38bdf8"} style={caja} animate={i === 1 && !q ? { scale: [1, 1.8, 1], opacity: [1, 0.5, 1] } : undefined} transition={rep(1.2)} />
            ))}
            {/* El vehículo en seguimiento, recorriendo la calle. */}
            <motion.circle r={3.6} fill="var(--aviso)" stroke="#fff" strokeWidth={1.2} cx={pts[0][0]} cy={pts[0][1]}
                animate={q ? { x: pts[3][0] - pts[0][0], y: pts[3][1] - pts[0][1] } : { x: pts.map((p) => p[0] - pts[0][0]), y: pts.map((p) => p[1] - pts[0][1]) }} transition={{ duration: 5, repeat: Infinity, ease: "linear" }} />
            <rect x={13} y={78} width={134} height={7} fill="rgba(0,0,0,0.45)" />
            <rect x={17} y={80.5} width={50} height={2} rx={1} fill="rgba(255,255,255,0.6)" />
        </g>
    );
}

function Resumen({ q }: { q: boolean }) {
    const barras = [20, 34, 26, 44, 38, 52, 30, 46, 58, 40, 50, 36];
    return (
        <g>
            {[13, 48, 83, 118].map((x, i) => (
                <g key={x}>
                    <rect x={x} y={11} width={30} height={20} rx={2.5} fill={TEJA} />
                    <rect x={x + 4} y={15} width={12} height={5} rx={1} fill={["#e2e8f0", "var(--bien)", "var(--mal)", "var(--info)"][i]} />
                    <rect x={x + 4} y={24} width={18} height={2} rx={1} fill="rgba(255,255,255,0.35)" />
                </g>
            ))}
            <rect x={13} y={35} width={88} height={50} rx={2.5} fill="#111c2e" />
            {barras.map((h, i) => (
                <motion.rect key={i} x={17 + i * 7} width={4.5} rx={1} fill="var(--info)" y={81 - h * 0.75} height={h * 0.75} style={{ transformBox: "fill-box", transformOrigin: "50% 100%" }}
                    animate={q ? undefined : { scaleY: [0.4, 1] }} transition={{ duration: 1.1, delay: i * 0.06, repeat: Infinity, repeatDelay: 2.5, ease: "easeOut" }} />
            ))}
            {[35, 48, 61, 74].map((y) => (
                <g key={y}><rect x={105} y={y} width={42} height={10} rx={2} fill={TEJA} /><rect x={109} y={y + 4} width={26} height={2} rx={1} fill="rgba(255,255,255,0.45)" /></g>
            ))}
        </g>
    );
}

function Salud({ q }: { q: boolean }) {
    const filas: { t: string; parpadea?: boolean }[] = [{ t: "var(--bien)" }, { t: "var(--bien)" }, { t: "var(--aviso)", parpadea: true }, { t: "var(--bien)" }, { t: "var(--mal)", parpadea: true }, { t: "var(--bien)" }];
    return (
        <g>
            {filas.map((f, i) => (
                <g key={i}>
                    <rect x={13} y={11 + i * 12.4} width={134} height={10} rx={2} fill={TEJA} />
                    <motion.circle cx={20} cy={16 + i * 12.4} r={2.8} fill={f.t} animate={f.parpadea && !q ? { opacity: [1, 0.25, 1] } : undefined} transition={rep(f.t === "var(--mal)" ? 0.8 : 1.6)} />
                    <rect x={27} y={14.5 + i * 12.4} width={[46, 38, 52, 30, 44, 36][i]} height={3} rx={1.5} fill="rgba(255,255,255,0.6)" />
                    <rect x={118} y={14.5 + i * 12.4} width={24} height={3} rx={1.5} fill="rgba(255,255,255,0.28)" />
                </g>
            ))}
            {/* El latido. */}
            <motion.path d="M90 16 h8 l3 -4 l4 8 l3 -4 h8" fill="none" stroke="var(--bien)" strokeWidth={1.4} strokeLinejoin="round"
                initial={{ pathLength: 0 }} animate={q ? { pathLength: 1 } : { pathLength: [0, 1] }} transition={{ duration: 1.4, repeat: Infinity }} />
        </g>
    );
}

function Camaras({ q }: { q: boolean }) {
    const cols = 4, filas = 3, g = 2.5, cw = (134 - g * (cols - 1)) / cols, ch = (74 - g * (filas - 1)) / filas;
    const tejas = Array.from({ length: cols * filas }, (_, i) => ({ x: 13 + (i % cols) * (cw + g), y: 11 + Math.floor(i / cols) * (ch + g) }));
    return (
        <g>
            {tejas.map((t, i) => (
                <g key={i}>
                    <rect x={t.x} y={t.y} width={cw} height={ch} rx={2} fill={i % 3 === 0 ? TEJA2 : TEJA} />
                    <path d={`M${t.x} ${t.y + ch} L${t.x + cw * 0.4} ${t.y + ch * 0.55} L${t.x + cw * 0.7} ${t.y + ch * 0.75} L${t.x + cw} ${t.y + ch * 0.5} V${t.y + ch} Z`} fill="rgba(255,255,255,0.05)" />
                    <rect x={t.x + 2} y={t.y + 2} width={10} height={2} rx={1} fill="rgba(255,255,255,0.45)" />
                </g>
            ))}
            {/* El canal que detecta: se pone rojo y pasa adelante. */}
            <motion.rect width={cw} height={ch} rx={2} fill="none" stroke="var(--mal)" strokeWidth={1.8}
                animate={q ? { x: tejas[5].x, y: tejas[5].y } : { x: [tejas[5].x, tejas[5].x, tejas[0].x], y: [tejas[5].y, tejas[5].y, tejas[0].y] }} transition={{ duration: 3, repeat: Infinity, times: [0, 0.6, 1] }} />
        </g>
    );
}

function Rotacion({ q }: { q: boolean }) {
    return (
        <g>
            {/* Tres vistas que se pasan la pantalla. */}
            {[0, 1, 2].map((i) => (
                <motion.g key={i} initial={{ opacity: i === 0 ? 1 : 0 }} animate={q ? undefined : { opacity: [0, 1, 1, 0] }} transition={{ duration: 4.5, repeat: Infinity, delay: i * 1.5, times: [0, 0.1, 0.33, 0.43] }}>
                    {i === 0 && <><rect x={13} y={11} width={64} height={36} rx={2} fill={TEJA} /><rect x={81} y={11} width={64} height={36} rx={2} fill="rgba(239,68,68,0.5)" /><rect x={13} y={51} width={64} height={34} rx={2} fill={TEJA} /><rect x={81} y={51} width={64} height={34} rx={2} fill={TEJA2} /></>}
                    {i === 1 && <><rect x={13} y={11} width={134} height={74} rx={2} fill="#10213a" /><path d="M20 76 C50 60 70 30 140 24" fill="none" stroke="rgba(148,163,184,0.5)" strokeWidth={5} /><circle cx={92} cy={44} r={4} fill="var(--aviso)" /></>}
                    {i === 2 && <><rect x={13} y={11} width={134} height={74} rx={2} fill="#111c2e" /><rect x={50} y={36} width={60} height={20} rx={2} fill="#f8fafc" /><rect x={58} y={43} width={44} height={6} rx={1} fill="#0f172a" /></>}
                </motion.g>
            ))}
            <motion.g animate={q ? undefined : { rotate: 360 }} transition={{ duration: 4.5, repeat: Infinity, ease: "linear" }} style={caja}>
                <circle cx={80} cy={48} r={13} fill="rgba(0,0,0,0.55)" />
                <path d="M72 46 a8 8 0 0 1 14 -4 M88 50 a8 8 0 0 1 -14 4" fill="none" stroke="#fff" strokeWidth={2} strokeLinecap="round" />
                <path d="M86 38 v5 h-5 M74 58 v-5 h5" fill="none" stroke="#fff" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
            </motion.g>
        </g>
    );
}

const DIBUJOS: Record<ClaveVista, (p: { q: boolean }) => React.ReactNode> = {
    intrusion: Intrusion, alarmas: Alarmas, lpr: Lpr, face: Face, mapa: Mapa, resumen: Resumen, salud: Salud, camaras: Camaras, rotacion: Rotacion,
};

/**
 * `quieta`: sin animación (la fila de la tabla que no se está mirando, o quien pidió menos
 * movimiento en el sistema). `ancho` en px; el alto sale de la proporción del monitor.
 */
export function MiniaturaVista({ clave, ancho = 120, quieta = false, className }: { clave: ClaveVista; ancho?: number; quieta?: boolean; className?: string }) {
    const reducir = useReducedMotion();
    const q = quieta || !!reducir;
    const Dibujo = DIBUJOS[clave];
    return (
        <svg viewBox={`0 0 ${W} ${H}`} width={ancho} height={(ancho * H) / W} className={className} role="img" aria-label={`Vista ${clave}`}>
            <defs>
                <clipPath id={`pantalla-${clave}`}><rect x={P.x} y={P.y} width={P.w} height={P.h} rx={3} /></clipPath>
                <linearGradient id={`brillo-${clave}`} x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0" stopColor="#fff" stopOpacity={0.09} /><stop offset="0.5" stopColor="#fff" stopOpacity={0} />
                </linearGradient>
            </defs>
            {/* El pie y el marco. */}
            <path d={`M70 ${P.y + P.h + 4} h20 l3 10 h-26 Z`} fill="#475569" />
            <rect x={56} y={H - 6} width={48} height={4} rx={2} fill="#64748b" />
            <rect x={3} y={1} width={W - 6} height={P.h + 12} rx={7} fill="#1e293b" stroke="#334155" strokeWidth={1} />
            <rect x={P.x} y={P.y} width={P.w} height={P.h} rx={3} fill={FONDO} />
            <g clipPath={`url(#pantalla-${clave})`}>
                {Dibujo && <Dibujo q={q} />}
                <rect x={P.x} y={P.y} width={P.w} height={P.h} fill={`url(#brillo-${clave})`} pointerEvents="none" />
            </g>
            <rect x={P.x} y={P.y} width={P.w} height={P.h} rx={3} fill="none" stroke={LINEA} strokeWidth={0.6} />
            <circle cx={W / 2} cy={P.y + P.h + 2.5} r={1} fill="#22c55e" />
        </svg>
    );
}
