"use client";

import { Check, ChevronDown, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * «Cómo dibujar bien», con dibujos. Un recuadro mal hecho enseña mal y no hay medición que lo
 * avise: el modelo aprende exactamente lo que se le marcó. Los tres errores que más arruinan un
 * conjunto (mucho fondo, cortado, uno para varios) se entienden mejor viéndolos que leyéndolos,
 * así que cada regla va con su ilustración: verde lo que va, rojo lo que no.
 *
 * Las ilustraciones son SVG propios (un contenedor y conos genéricos), con los colores del tema:
 * se ven igual de claras en modo claro y oscuro.
 */

type Rect = [number, number, number, number]; // x, y, ancho, alto en el viewBox 160×100

/** El objeto de ejemplo: un contenedor de basura con tapa y ruedas. */
function Contenedor({ x, y, e = 1, tono = "var(--muted-foreground)" }: { x: number; y: number; e?: number; tono?: string }) {
    const w = 46 * e, h = 34 * e;
    return (
        <g>
            <path d={`M${x} ${y + 6 * e} L${x + w} ${y + 6 * e} L${x + w - 3 * e} ${y + h} L${x + 3 * e} ${y + h} Z`} fill={tono} opacity={0.9} />
            <path d={`M${x - 2 * e} ${y + 6 * e} L${x + 4 * e} ${y} L${x + w + 2 * e} ${y + 2 * e} L${x + w + 2 * e} ${y + 6 * e} Z`} fill={tono} />
            <circle cx={x + 8 * e} cy={y + h + 2.5 * e} r={2.6 * e} fill={tono} />
            <circle cx={x + w - 8 * e} cy={y + h + 2.5 * e} r={2.6 * e} fill={tono} />
        </g>
    );
}
function Cono({ x, y, tono = "var(--muted-foreground)" }: { x: number; y: number; tono?: string }) {
    return (
        <g>
            <path d={`M${x} ${y} L${x + 7} ${y + 26} L${x - 7} ${y + 26} Z`} fill={tono} />
            <rect x={x - 10} y={y + 26} width={20} height={3} rx={1} fill={tono} />
        </g>
    );
}
function Recuadro({ r, ok }: { r: Rect; ok: boolean }) {
    return <rect x={r[0]} y={r[1]} width={r[2]} height={r[3]} rx={1.5} fill="none" stroke={ok ? "var(--bien)" : "var(--mal)"} strokeWidth={2} strokeDasharray={ok ? undefined : "4 3"} />;
}
function Escena({ children, noche }: { children: React.ReactNode; noche?: boolean }) {
    return (
        <svg viewBox="0 0 160 100" className="w-full h-auto block" role="img">
            <rect width={160} height={100} fill={noche ? "#0b0f19" : "var(--muted)"} />
            <line x1={0} y1={82} x2={160} y2={82} stroke={noche ? "#1f2937" : "var(--border)"} strokeWidth={2} />
            {children}
        </svg>
    );
}

const EJEMPLOS: { ok: boolean; titulo: string; texto: string; dibujo: React.ReactNode }[] = [
    {
        ok: true, titulo: "Ajustado", texto: "El recuadro toca los bordes del objeto, sin dejar aire.",
        dibujo: <Escena><Contenedor x={56} y={42} /><Recuadro r={[52, 40, 54, 44]} ok /></Escena>,
    },
    {
        ok: false, titulo: "Con mucho fondo", texto: "Aprende el piso y la pared, no el objeto.",
        dibujo: <Escena><Contenedor x={56} y={42} /><Recuadro r={[22, 14, 116, 76]} ok={false} /></Escena>,
    },
    {
        ok: false, titulo: "Cortado", texto: "Aprende medio objeto: después no reconoce el entero.",
        dibujo: <Escena><Contenedor x={56} y={42} /><Recuadro r={[52, 40, 28, 44]} ok={false} /></Escena>,
    },
    {
        ok: true, titulo: "Tapado: lo que se ve", texto: "Si algo lo tapa, el recuadro va sobre la parte visible.",
        dibujo: (
            <Escena>
                <Contenedor x={50} y={42} />
                <rect x={78} y={50} width={52} height={32} rx={6} fill="var(--foreground)" opacity={0.75} />
                <Recuadro r={[46, 40, 33, 44]} ok />
            </Escena>
        ),
    },
    {
        ok: true, titulo: "Uno por objeto", texto: "Tres conos son tres recuadros.",
        dibujo: <Escena><Cono x={45} y={53} /><Cono x={80} y={53} /><Cono x={115} y={53} />{[35, 70, 105].map((x) => <Recuadro key={x} r={[x, 51, 20, 31]} ok />)}</Escena>,
    },
    {
        ok: false, titulo: "Uno para todos", texto: "Un recuadro sobre varios le enseña que «cono» son tres juntos.",
        dibujo: <Escena><Cono x={45} y={53} /><Cono x={80} y={53} /><Cono x={115} y={53} /><Recuadro r={[33, 49, 94, 35]} ok={false} /></Escena>,
    },
];

const VARIEDAD: { titulo: string; dibujo: React.ReactNode }[] = [
    { titulo: "De día", dibujo: <Escena><Contenedor x={56} y={42} /></Escena> },
    { titulo: "De noche (infrarrojo)", dibujo: <Escena noche><Contenedor x={56} y={42} tono="#6b7280" /></Escena> },
    { titulo: "Lejos y chico", dibujo: <Escena><Contenedor x={110} y={66} e={0.4} /></Escena> },
    { titulo: "Cerca y grande", dibujo: <Escena><Contenedor x={14} y={8} e={2.4} /></Escena> },
    { titulo: "Sin el objeto → «No hay ninguno»", dibujo: <Escena><rect x={20} y={58} width={30} height={24} fill="var(--muted-foreground)" opacity={0.35} /></Escena> },
];

export function GuiaDibujo({ abierta, alCambiar }: { abierta: boolean; alCambiar: (v: boolean) => void }) {
    return (
        <section className="rounded-[10px] border border-border bg-card">
            <button type="button" onClick={() => alCambiar(!abierta)} className="w-full flex items-center gap-2 px-4 py-3 text-left" aria-expanded={abierta}>
                <span className="text-[14px] font-bold">Cómo dibujar bien</span>
                <span className="text-[12px] text-muted-foreground">El modelo aprende exactamente lo que se le marca: un recuadro mal hecho enseña mal.</span>
                <ChevronDown size={16} className={cn("ml-auto text-muted-foreground transition-transform", abierta && "rotate-180")} />
            </button>
            {abierta && (
                <div className="px-4 pb-4 space-y-4">
                    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2.5">
                        {EJEMPLOS.map((e) => (
                            <figure key={e.titulo} className="rounded-[10px] border border-border overflow-hidden">
                                {e.dibujo}
                                <figcaption className="px-2.5 py-2">
                                    <span className={cn("inline-flex items-center gap-1 text-[12.5px] font-bold", e.ok ? "tono-bien" : "tono-mal")}>
                                        {e.ok ? <Check size={14} strokeWidth={3} /> : <X size={14} strokeWidth={3} />} {e.titulo}
                                    </span>
                                    <span className="block text-[11.5px] text-muted-foreground leading-snug mt-0.5">{e.texto}</span>
                                </figcaption>
                            </figure>
                        ))}
                    </div>
                    <div>
                        <div className="text-[13px] font-bold">Fotos variadas</div>
                        <p className="text-[12px] text-muted-foreground leading-snug mb-2">El modelo sólo reconoce lo que vio parecido. Si todas las fotos son de día y de cerca, de noche y lejos no lo va a encontrar. Y hacen falta fotos del mismo lugar sin el objeto: le enseñan qué NO marcar.</p>
                        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
                            {VARIEDAD.map((v) => (
                                <figure key={v.titulo} className="rounded-[10px] border border-border overflow-hidden">
                                    {v.dibujo}
                                    <figcaption className="px-2.5 py-1.5 text-[11.5px] font-semibold">{v.titulo}</figcaption>
                                </figure>
                            ))}
                        </div>
                    </div>
                </div>
            )}
        </section>
    );
}
