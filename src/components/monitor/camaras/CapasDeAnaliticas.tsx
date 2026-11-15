"use client";

import { memo, useEffect, useState } from "react";
import { useTiempoReal } from "@/lib/tiempo-real";
import { estadoDeZona, hayCapas, type CapasCanal, type Pt } from "@/lib/capas-canal";

/**
 * Lo que las analíticas de un canal tienen dibujado, sobre su vivo.
 *
 * Por qué (15/11, Nico: «¿y por qué no veo las capas dibujadas en las analíticas en vivo?»). El
 * vivo dibujaba las siluetas y la línea o la zona de la PROPIA cámara. Las zonas de las reglas de
 * OmniVision, las de las analíticas entrenables y la zona y la línea de la lectura de matrículas
 * existían, trabajaban sobre ese video y no se veían: para saber qué miraba un «vigía» había que
 * ir a su pantalla de configuración.
 *
 * Tres familias, cada una con su trazo para distinguirlas de un vistazo y sin sumar colores de
 * marca: el color dice ESTADO (ámbar = está avisando, gris = apagada), no «de qué tipo es».
 *   · regla de OmniVision: zona de trazo continuo, o su línea;
 *   · analítica entrenable: zona de trazo punteado, con el estado en que la ve AHORA y su
 *     porcentaje (cambia solo cuando el servidor la vuelve a mirar);
 *   · lectura de matrículas: zona de rayas largas y la línea de pasada.
 *
 * No recibe toques: debajo están las siluetas, que sí. Se apaga con el mismo botón que la línea
 * y la zona de la cámara.
 */
/** Por si un aviso del servidor se pierde: se vuelve a preguntar cada tanto. */
const REFRESCO_MS = 120_000;

/** Las capas de un canal (null mientras no se sabe, o si no tiene ninguna). */
export function useCapasDelCanal(id: string | null): CapasCanal | null {
    const [capas, setCapas] = useState<{ id: string; capas: CapasCanal } | null>(null);
    useEffect(() => {
        if (!id) return;
        let vivo = true;
        const pedir = () => {
            if (document.hidden) return;
            fetch(`/api/monitor/camaras/capas?id=${encodeURIComponent(id)}`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null))
                .then((j: CapasCanal | null) => { if (vivo && j && Array.isArray(j.reglas)) setCapas(hayCapas(j) ? { id, capas: j } : null); })
                .catch(() => { /* sin respuesta: el vivo es el de siempre, y lo ya dibujado queda */ });
        };
        pedir();
        const t = setInterval(pedir, REFRESCO_MS);
        return () => { vivo = false; clearInterval(t); };
    }, [id]);
    // Una entrenable se vuelve a mirar cada varios minutos; cuando pasa, su worker lo avisa y el rótulo cambia solo.
    useTiempoReal("zona_estado", (x: { id?: string; estado?: unknown }) => {
        if (!x?.id) return;
        setCapas((c) => (c && c.capas.entrenables.some((z) => z.id === x.id)
            ? { ...c, capas: { ...c.capas, entrenables: c.capas.entrenables.map((z) => (z.id === x.id ? { ...z, ...estadoDeZona(x.estado) } : z)) } } : c));
    });
    // Las de OTRO canal no se muestran ni un cuadro: al cambiar de canal quedan afuera por el id.
    return capas && capas.id === id ? capas.capas : null;
}

const NEUTRO = "rgba(226,232,240,0.9)", APAGADA = "rgba(148,163,184,0.55)", AVISA = "var(--aviso)";

export const CapasDeAnaliticas = memo(function CapasDeAnaliticas({ capas, tam }: {
    capas: CapasCanal;
    /** El tamaño del video que se ve: las capas se ajustan igual que él (entero, sin recortar). */
    tam: { w: number; h: number } | null;
}) {
    const W = 1600, H = tam && tam.w > 0 ? Math.round((1600 * tam.h) / tam.w) : 900;
    const pts = (z: Pt[]) => z.map(([x, y]) => `${(x * W).toFixed(1)},${(y * H).toFixed(1)}`).join(" ");
    /** Arriba a la izquierda de la figura, corrido hacia adentro del cuadro. */
    const ancla = (z: Pt[]) => { const x = Math.min(...z.map((q) => q[0])), y = Math.min(...z.map((q) => q[1])); return { x: Math.min(W - 260, Math.max(8, x * W)), y: y * H > 34 ? y * H - 10 : Math.max(...z.map((q) => q[1])) * H + 26 }; };
    const rotulo = (k: string, a: { x: number; y: number }, texto: string, color: string) => (
        <g key={k} transform={`translate(${a.x},${a.y})`}>
            <text fontSize={19} fontWeight={600} fill="#000" stroke="rgba(0,0,0,0.75)" strokeWidth={5} strokeLinejoin="round" paintOrder="stroke">{texto}</text>
            <text fontSize={19} fontWeight={600} fill={color}>{texto}</text>
        </g>
    );
    const figura = (k: string, z: Pt[], color: string, raya: string | undefined, relleno: number) => (
        <g key={k}>
            <polygon points={pts(z)} fill="none" stroke="rgba(0,0,0,0.55)" strokeWidth={4.5} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
            <polygon points={pts(z)} fill={color} fillOpacity={relleno} stroke={color} strokeWidth={2} strokeDasharray={raya} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        </g>
    );
    const raya = (k: string, l: [Pt, Pt], color: string) => (
        <g key={k}>
            <line x1={l[0][0] * W} y1={l[0][1] * H} x2={l[1][0] * W} y2={l[1][1] * H} stroke="rgba(0,0,0,0.55)" strokeWidth={5} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
            <line x1={l[0][0] * W} y1={l[0][1] * H} x2={l[1][0] * W} y2={l[1][1] * H} stroke={color} strokeWidth={2.5} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        </g>
    );
    return (
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" className="absolute inset-0 w-full h-full pointer-events-none" style={{ fontFamily: "inherit" }} aria-hidden="true">
            {capas.lectura?.zona && figura("lz", capas.lectura.zona, NEUTRO, "18 8", 0)}
            {capas.lectura?.linea && raya("ll", capas.lectura.linea, NEUTRO)}
            {capas.lectura?.zona && rotulo("lt", ancla(capas.lectura.zona), "Lectura de matrículas", NEUTRO)}
            {capas.lectura?.linea && !capas.lectura.zona && rotulo("lt2", ancla(capas.lectura.linea), "Línea de lectura", NEUTRO)}
            {capas.reglas.map((r) => {
                const color = r.activa ? NEUTRO : APAGADA, forma = r.zona || r.linea!;
                return (
                    <g key={r.id}>
                        {r.zona && figura("z", r.zona, color, undefined, r.activa ? 0.06 : 0)}
                        {r.linea && raya("l", r.linea, color)}
                        {rotulo("t", ancla(forma), `${r.nombre && r.nombre !== r.tipo ? `${r.tipo} · ${r.nombre}` : r.tipo}${r.activa ? "" : " (apagada)"}`.slice(0, 70), color)}
                    </g>
                );
            })}
            {capas.entrenables.map((z) => {
                const avisa = z.avisa;
                const color = !z.activa ? APAGADA : avisa ? AVISA : NEUTRO;
                const estado = !z.activa ? "apagada" : z.prob == null ? "todavía sin mirar" : `${avisa ? z.positivo : z.negativo} ${Math.round(z.prob * 100)} %`;
                return (
                    <g key={z.id}>
                        {figura("z", z.zona, color, "5 6", avisa && z.activa ? 0.12 : 0.04)}
                        {rotulo("t", ancla(z.zona), `${z.nombre} · ${estado}`.slice(0, 70), color)}
                    </g>
                );
            })}
        </svg>
    );
});
