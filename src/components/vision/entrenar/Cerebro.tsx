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

/**
 * La silueta del cerebro en vista lateral (viewBox 200×150): frontal a la izquierda, cerebelo
 * abajo a la derecha. Un solo trazo: la primera versión, armada con círculos, parecía un árbol.
 */
const SILUETA = "M44 98 C24 96 12 80 18 62 C20 40 40 22 64 20 C78 8 104 4 122 12 C142 8 164 18 172 36 C186 48 188 70 178 84 C182 98 172 112 156 113 C146 121 130 120 123 111 C114 114 106 110 102 104 C94 114 76 118 64 111 C56 110 48 106 44 98 Z";
/** El tronco: por acá entran las «fotos» que lo nutren. */
const TRONCO = "M114 106 C118 116 120 128 118 142 L131 142 C131 128 130 116 126 106 Z";
/** Surcos (las circunvoluciones) y la separación del cerebelo: dibujo, recortado a la silueta. */
const SURCOS = [
    "M102 10 C98 26 102 36 92 48 C86 56 90 64 86 72", "M60 92 C70 82 84 84 94 78 C104 72 112 76 122 70",
    "M126 96 C136 92 146 92 156 86 C164 82 170 84 176 80", "M36 52 C46 50 52 58 62 52 C70 46 72 38 82 36",
    "M128 24 C134 36 128 46 138 54 C146 60 158 54 164 62", "M28 76 C38 74 44 80 54 74",
    "M108 52 C114 58 122 54 128 60 C134 66 144 64 150 70", "M70 64 C76 70 84 66 90 72",
    "M148 30 C154 38 162 36 168 44", "M50 34 C56 40 62 36 66 42", "M150 86 C142 96 134 104 124 110",
];
/** Las sinapsis: puntos fijos adentro y sus uniones. */
const NODOS: [number, number][] = [[40, 64], [62, 36], [92, 24], [124, 30], [156, 46], [70, 96], [100, 88], [138, 78], [84, 56], [114, 62], [34, 84], [148, 102], [166, 66]];
const UNIONES: [number, number][] = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [1, 8], [8, 9], [9, 3], [8, 6], [9, 7], [0, 10], [7, 11], [4, 12], [12, 7]];

export function Cerebro({ progreso, estado, tamano = 200, className }: { progreso: number; estado: EstadoCerebro; tamano?: number; className?: string }) {
    const id = useId().replace(/:/g, "");
    const quieto = useReducedMotion();
    const p = Math.max(0, Math.min(1, progreso || 0));
    const tono = TONO[estado];
    const vivo = !quieto && (estado === "entrenando" || estado === "exportando" || estado === "preparando");
    const respira = !quieto && (estado === "cola" || estado === "reposo");
    // La silueta va de y≈6 (arriba del parietal) a y≈120 (abajo del cerebelo): el nivel se mide ahí.
    const ARRIBA = 6, ABAJO = 120;
    const nivel = ABAJO - (ABAJO - ARRIBA) * p;
    // Partículas: posiciones fijas por render (no saltan en cada actualización del progreso).
    const particulas = useMemo(() => Array.from({ length: 9 }, (_, i) => ({
        destino: NODOS[(i * 5) % NODOS.length], retraso: i * 0.42, dur: 2.6 + (i % 3) * 0.5,
    })), []);

    return (
        <svg viewBox="0 0 200 150" width={tamano} height={tamano * 0.75} className={className} role="img"
            aria-label={`Cerebro del detector: ${Math.round(p * 100)} % aprendido`}>
            <defs>
                <clipPath id={`clip-${id}`}><path d={SILUETA} /></clipPath>
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
                <motion.ellipse cx={100} cy={66} rx={98} ry={70} fill={`url(#brillo-${id})`}
                    animate={vivo ? { opacity: [0.5, 1, 0.5] } : { opacity: 0.8 }} transition={{ duration: 2.4, repeat: vivo ? Infinity : 0, ease: "easeInOut" }} />
            )}

            {/* Tronco, con las partículas que suben. */}
            <path d={TRONCO} fill="var(--muted)" stroke="var(--foreground)" strokeOpacity={0.22} strokeWidth={2} />
            {vivo && particulas.map((q, i) => (
                <motion.circle key={i} r={2.6} fill={tono}
                    initial={{ cx: 124, cy: 144, opacity: 0 }}
                    animate={{ cx: [124, 121, q.destino[0]], cy: [144, 110, q.destino[1]], opacity: [0, 1, 0] }}
                    transition={{ duration: q.dur, delay: q.retraso, repeat: Infinity, ease: "easeInOut" }} />
            ))}

            {/* Contorno: la silueta con trazo; el líquido va recortado a ella. */}
            <motion.g animate={respira ? { scale: [1, 1.012, 1] } : { scale: 1 }} transition={{ duration: 3, repeat: respira ? Infinity : 0 }} style={{ originX: "50%", originY: "50%" }}>
                <path d={SILUETA} fill="var(--muted)" stroke="var(--foreground)" strokeOpacity={0.3} strokeWidth={3} strokeLinejoin="round" />
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
                    {SURCOS.map((d, i) => <path key={i} d={d} fill="none" stroke="var(--foreground)" strokeOpacity={0.2} strokeWidth={2.4} strokeLinecap="round" />)}
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
