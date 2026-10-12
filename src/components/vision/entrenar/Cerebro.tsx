"use client";

import { useId, useMemo } from "react";
import { motion, useReducedMotion } from "framer-motion";

/**
 * El cerebro del detector, llenándose mientras aprende: la barra de progreso del entrenamiento
 * dibujada como lo que es — un modelo que se nutre de las fotos dibujadas.
 *
 * Qué dice cada cosa (nada es decorado suelto):
 *  · el nivel del líquido es la fracción de épocas hechas (`progreso`, 0 a 1);
 *  · las partículas que suben por el tronco sólo corren mientras ENTRENA: si se congeló por
 *    temperatura o está en pausa, se quedan quietas, porque no está aprendiendo nada;
 *  · las sinapsis se encienden mientras entrena, y quedan prendidas fijas cuando terminó bien;
 *  · el color es el TONO del estado (info entrenando, bien listo, quieto en pausa, aviso
 *    enfriando, mal si falló), no el azul de acción: el cerebro no se aprieta.
 *
 * Es un SVG propio, con los colores del tema: se ve igual en claro y oscuro. Con «reducir
 * movimiento» del sistema, nada se mueve y el nivel igual se ve.
 */
export type EstadoCerebro = "reposo" | "cola" | "preparando" | "entrenando" | "enfriando" | "pausado" | "exportando" | "listo" | "fallo";

const TONO: Record<EstadoCerebro, string> = {
    reposo: "var(--quieto)", cola: "var(--info)", preparando: "var(--info)", entrenando: "var(--info)",
    enfriando: "var(--aviso)", pausado: "var(--quieto)", exportando: "var(--info)", listo: "var(--bien)", fallo: "var(--mal)",
};

/** Lóbulos del cerebro (vista lateral), en un viewBox de 200×170: la unión de estas formas es la silueta. */
const LOBULOS: { cx: number; cy: number; r?: number; rx?: number; ry?: number }[] = [
    { cx: 62, cy: 70, r: 40 },   // frontal
    { cx: 100, cy: 52, r: 42 },  // parietal
    { cx: 140, cy: 66, r: 38 },  // occipital
    { cx: 92, cy: 92, rx: 56, ry: 30 }, // temporal
    { cx: 50, cy: 92, r: 26 },
];
const CEREBELO = { cx: 146, cy: 108, rx: 26, ry: 17 };
/** El tronco: por acá entran las «fotos» que lo nutren. */
const TRONCO = "M112 112 C116 126 118 140 116 160 L130 160 C130 140 130 124 124 108 Z";
/** Surcos (las circunvoluciones): sólo dibujo, recortados a la silueta. */
const SURCOS = [
    "M40 64 C52 54 64 60 70 50 C76 40 92 42 96 30",
    "M58 96 C70 86 84 92 96 82 C108 72 124 80 134 70",
    "M104 40 C110 54 104 62 112 74 C118 84 132 82 140 92",
    "M30 84 C40 78 46 86 56 80",
    "M120 38 C132 44 146 40 160 54",
    "M66 112 C80 106 94 114 108 106",
    "M150 66 C162 72 168 84 172 74",
    "M76 66 C84 72 90 66 98 70",
];
/** Las sinapsis: puntos fijos adentro y sus uniones. */
const NODOS: [number, number][] = [[52, 70], [78, 48], [104, 36], [128, 50], [156, 62], [70, 96], [100, 84], [132, 92], [90, 62], [118, 68], [44, 96], [150, 104]];
const UNIONES: [number, number][] = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [1, 8], [8, 9], [9, 3], [8, 6], [9, 7], [0, 10], [7, 11], [4, 11]];

/** Silueta: lóbulos + cerebelo. Se dibuja tres veces (contorno, fondo, recorte). */
function Silueta({ grosor = 0, ...p }: React.SVGProps<SVGGElement> & { grosor?: number }) {
    return (
        <g {...p}>
            {LOBULOS.map((l, i) => l.r
                ? <circle key={i} cx={l.cx} cy={l.cy} r={l.r + grosor} />
                : <ellipse key={i} cx={l.cx} cy={l.cy} rx={(l.rx || 0) + grosor} ry={(l.ry || 0) + grosor} />)}
            <ellipse cx={CEREBELO.cx} cy={CEREBELO.cy} rx={CEREBELO.rx + grosor} ry={CEREBELO.ry + grosor} />
        </g>
    );
}

export function Cerebro({ progreso, estado, tamano = 200, className }: { progreso: number; estado: EstadoCerebro; tamano?: number; className?: string }) {
    const id = useId().replace(/:/g, "");
    const quieto = useReducedMotion();
    const p = Math.max(0, Math.min(1, progreso || 0));
    const tono = TONO[estado];
    const vivo = !quieto && (estado === "entrenando" || estado === "exportando" || estado === "preparando");
    const respira = !quieto && (estado === "cola" || estado === "reposo");
    // La silueta va de y≈10 (arriba del parietal) a y≈126 (abajo del cerebelo): el nivel se mide ahí.
    const ARRIBA = 10, ABAJO = 126;
    const nivel = ABAJO - (ABAJO - ARRIBA) * p;
    // Partículas: posiciones fijas por render (no saltan en cada actualización del progreso).
    const particulas = useMemo(() => Array.from({ length: 9 }, (_, i) => ({
        destino: NODOS[(i * 5) % NODOS.length], retraso: i * 0.42, dur: 2.6 + (i % 3) * 0.5,
    })), []);

    return (
        <svg viewBox="0 0 200 170" width={tamano} height={tamano * 0.85} className={className} role="img"
            aria-label={`Cerebro del detector: ${Math.round(p * 100)} % aprendido`}>
            <defs>
                <clipPath id={`clip-${id}`}><Silueta /></clipPath>
                <linearGradient id={`liq-${id}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={tono} stopOpacity={0.95} />
                    <stop offset="100%" stopColor={tono} stopOpacity={0.6} />
                </linearGradient>
                <radialGradient id={`brillo-${id}`} cx="50%" cy="40%" r="60%">
                    <stop offset="0%" stopColor={tono} stopOpacity={0.35} />
                    <stop offset="100%" stopColor={tono} stopOpacity={0} />
                </radialGradient>
            </defs>

            {/* Halo: sólo cuando está trabajando o terminó bien. */}
            {(vivo || estado === "listo") && (
                <motion.ellipse cx={100} cy={72} rx={98} ry={74} fill={`url(#brillo-${id})`}
                    animate={vivo ? { opacity: [0.5, 1, 0.5] } : { opacity: 0.8 }} transition={{ duration: 2.4, repeat: vivo ? Infinity : 0, ease: "easeInOut" }} />
            )}

            {/* Tronco, con las partículas que suben. */}
            <path d={TRONCO} fill="var(--muted)" stroke="var(--border)" strokeWidth={2} />
            {vivo && particulas.map((q, i) => (
                <motion.circle key={i} r={2.6} fill={tono}
                    initial={{ cx: 122, cy: 162, opacity: 0 }}
                    animate={{ cx: [122, 120, q.destino[0]], cy: [162, 118, q.destino[1]], opacity: [0, 1, 0] }}
                    transition={{ duration: q.dur, delay: q.retraso, repeat: Infinity, ease: "easeInOut" }} />
            ))}

            {/* Contorno (la silueta un poco más grande, detrás) y fondo. */}
            <Silueta grosor={2.5} fill="var(--border)" />
            <motion.g animate={respira ? { scale: [1, 1.012, 1] } : { scale: 1 }} transition={{ duration: 3, repeat: respira ? Infinity : 0 }} style={{ originX: "50%", originY: "50%" }}>
                <Silueta fill="var(--muted)" />
                <g clipPath={`url(#clip-${id})`}>
                    {/* El líquido: sube con el progreso; la ola se mueve sólo si está aprendiendo. */}
                    <motion.g initial={false} animate={{ y: nivel }} transition={{ type: "spring", stiffness: 40, damping: 14 }}>
                        <motion.path
                            d="M-200 6 Q-175 0 -150 6 T-100 6 T-50 6 T0 6 T50 6 T100 6 T150 6 T200 6 T250 6 T300 6 T350 6 T400 6 V200 H-200 Z"
                            fill={`url(#liq-${id})`}
                            animate={vivo ? { x: [0, 100] } : { x: 0 }}
                            transition={{ duration: 3.2, repeat: vivo ? Infinity : 0, ease: "linear" }} />
                        <motion.path
                            d="M-200 9 Q-170 3 -140 9 T-80 9 T-20 9 T40 9 T100 9 T160 9 T220 9 T280 9 T340 9 T400 9 V200 H-200 Z"
                            fill={tono} opacity={0.35}
                            animate={vivo ? { x: [0, -120] } : { x: 0 }}
                            transition={{ duration: 4.4, repeat: vivo ? Infinity : 0, ease: "linear" }} />
                    </motion.g>
                    {/* Surcos encima del líquido: lo que da la forma de cerebro. */}
                    {SURCOS.map((d, i) => <path key={i} d={d} fill="none" stroke="var(--foreground)" strokeOpacity={0.16} strokeWidth={2.2} strokeLinecap="round" />)}
                    {/* Sinapsis. */}
                    {UNIONES.map(([a, b], i) => (
                        <motion.line key={i} x1={NODOS[a][0]} y1={NODOS[a][1]} x2={NODOS[b][0]} y2={NODOS[b][1]} stroke={tono} strokeWidth={1.2}
                            initial={false}
                            animate={vivo ? { opacity: [0.1, 0.7, 0.1] } : { opacity: estado === "listo" ? 0.45 : 0.08 }}
                            transition={{ duration: 1.8, delay: (i % 5) * 0.35, repeat: vivo ? Infinity : 0 }} />
                    ))}
                    {NODOS.map(([x, y], i) => (
                        <motion.circle key={i} cx={x} cy={y} r={2.8} fill={y >= nivel ? "var(--background)" : tono}
                            initial={false}
                            animate={vivo ? { opacity: [0.4, 1, 0.4], scale: [1, 1.4, 1] } : { opacity: estado === "listo" ? 1 : 0.35, scale: 1 }}
                            transition={{ duration: 1.6, delay: (i % 4) * 0.4, repeat: vivo ? Infinity : 0 }}
                            style={{ originX: `${x}px`, originY: `${y}px` }} />
                    ))}
                </g>
            </motion.g>
        </svg>
    );
}
