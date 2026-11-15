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
 * No recibe toques: debajo están las siluetas, que sí. Arranca APAGADA y tiene su botón (15/11,
 * Nico, al verla: «las reglas de analíticas dibujan un recuadro que no debe estar»): siempre
 * encima, tapaba la escena y se confundía con las cajas de los objetos.
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

/** El rótulo, en unidades del dibujo (1600 de ancho): alto del renglón, ancho medio de una letra y largo máximo. */
const LETRA = 17, RENGLON = 25, ANCHO_LETRA = LETRA * 0.56, LARGO_MAX = 46;
const corto = (t: string) => (t.length > LARGO_MAX ? `${t.slice(0, LARGO_MAX - 1).trimEnd()}…` : t);

/**
 * Dónde va cada rótulo. Cada uno quiere ir arriba a la izquierda de su figura, pero las figuras de
 * un mismo canal suelen estar casi una encima de la otra (15/11, la primera captura de Nico: tres
 * zonas sobre el mismo contenedor y los tres nombres escritos uno arriba del otro, ilegibles). Así
 * que se ubican de a uno y el que choca con uno ya puesto sube un renglón; si no queda lugar
 * arriba, va debajo de su figura.
 */
export function ubicarRotulos(pedidos: { clave: string; texto: string; figura: Pt[] }[], W: number, H: number): { clave: string; texto: string; x: number; y: number }[] {
    const puestos: { x: number; y: number; w: number }[] = [];
    const choca = (x: number, y: number, w: number) => puestos.some((p) => x < p.x + p.w + 8 && p.x < x + w + 8 && Math.abs(p.y - y) < RENGLON - 1);
    return pedidos.map(({ clave, texto, figura }) => {
        const w = texto.length * ANCHO_LETRA;
        const x = Math.max(8, Math.min(W - w - 8, Math.min(...figura.map((q) => q[0])) * W));
        const arriba = Math.min(...figura.map((q) => q[1])) * H - 9, abajo = Math.max(...figura.map((q) => q[1])) * H + RENGLON - 4;
        const opciones: number[] = [];
        for (let k = 0; k < 8; k++) opciones.push(arriba - k * RENGLON);
        for (let k = 0; k < 8; k++) opciones.push(abajo + k * RENGLON);
        const y = opciones.find((v) => v >= RENGLON && v <= H - 6 && !choca(x, v, w)) ?? Math.max(RENGLON, Math.min(H - 6, arriba));
        puestos.push({ x, y, w });
        return { clave, texto, x, y };
    });
}

export const CapasDeAnaliticas = memo(function CapasDeAnaliticas({ capas, tam }: {
    capas: CapasCanal;
    /** El tamaño del video que se ve: las capas se ajustan igual que él (entero, sin recortar). */
    tam: { w: number; h: number } | null;
}) {
    const W = 1600, H = tam && tam.w > 0 ? Math.round((1600 * tam.h) / tam.w) : 900;
    const pts = (z: Pt[]) => z.map(([x, y]) => `${(x * W).toFixed(1)},${(y * H).toFixed(1)}`).join(" ");
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
    // Primero los que dicen un estado (las entrenables), después las reglas y la lectura: si falta lugar, los primeros quedan mejor puestos.
    const color: Record<string, string> = {};
    const pedidos: { clave: string; texto: string; figura: Pt[] }[] = [];
    const entrenables = capas.entrenables.map((z) => {
        const avisa = z.activa && z.avisa, c = !z.activa ? APAGADA : avisa ? AVISA : NEUTRO;
        const estado = !z.activa ? "apagada" : z.prob == null ? "todavía sin mirar" : `${avisa ? z.positivo : z.negativo} ${Math.round(z.prob * 100)} %`;
        color[`e${z.id}`] = c;
        pedidos.push({ clave: `e${z.id}`, texto: corto(`${z.nombre} · ${estado}`), figura: z.zona });
        return { z, c, avisa };
    });
    for (const r of capas.reglas) {
        color[`r${r.id}`] = r.activa ? NEUTRO : APAGADA;
        // El nombre es de quien la creó y suele decir ya de qué tipo es: el tipo va sólo si no hay nombre.
        pedidos.push({ clave: `r${r.id}`, texto: corto(`${r.nombre || r.tipo}${r.activa ? "" : " (apagada)"}`), figura: r.zona || r.linea! });
    }
    if (capas.lectura) { color.l = NEUTRO; pedidos.push({ clave: "l", texto: capas.lectura.zona ? "Lectura de matrículas" : "Línea de lectura", figura: capas.lectura.zona || capas.lectura.linea! }); }
    return (
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" className="absolute inset-0 w-full h-full pointer-events-none" style={{ fontFamily: "inherit" }} aria-hidden="true">
            {capas.lectura?.zona && figura("lz", capas.lectura.zona, NEUTRO, "18 8", 0)}
            {capas.lectura?.linea && raya("ll", capas.lectura.linea, NEUTRO)}
            {capas.reglas.map((r) => (
                <g key={r.id}>
                    {r.zona && figura("z", r.zona, r.activa ? NEUTRO : APAGADA, undefined, r.activa ? 0.05 : 0)}
                    {r.linea && raya("l", r.linea, r.activa ? NEUTRO : APAGADA)}
                </g>
            ))}
            {entrenables.map(({ z, c, avisa }) => figura(z.id, z.zona, c, "5 6", avisa ? 0.1 : 0.03))}
            {ubicarRotulos(pedidos, W, H).map((r) => (
                <g key={r.clave} transform={`translate(${r.x.toFixed(1)},${r.y.toFixed(1)})`}>
                    <text fontSize={LETRA} fontWeight={600} fill="#000" stroke="rgba(0,0,0,0.8)" strokeWidth={5} strokeLinejoin="round">{r.texto}</text>
                    <text fontSize={LETRA} fontWeight={600} fill={color[r.clave]}>{r.texto}</text>
                </g>
            ))}
        </svg>
    );
});
