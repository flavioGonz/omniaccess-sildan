"use client";

import { Check, ChevronDown, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { CAJAS_MINIMO } from "@/lib/detector-propio";

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
export function Contenedor({ x, y, e = 1, tono = "var(--muted-foreground)" }: { x: number; y: number; e?: number; tono?: string }) {
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
export function Cono({ x, y, tono = "var(--muted-foreground)" }: { x: number; y: number; tono?: string }) {
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
export function Escena({ children, noche }: { children: React.ReactNode; noche?: boolean }) {
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

/**
 * «Un modelo, varias clases»: lo que no se entendía al empezar. ¿Esto es un objeto? ¿Un conjunto
 * por objeto? No: es UN detector propio que aprende todas las clases juntas. Cada clase es un
 * tipo de cosa; una misma foto puede tener recuadros de varias clases; y al entrenar sale un
 * solo modelo que las encuentra a todas. Con dibujo, porque dicho en abstracto no se entiende.
 */
const C_A = "var(--accion-en-oscuro, #60a5fa)";
const C_B = "#f59e0b";
function CajaRotulada({ r, color, texto }: { r: Rect; color: string; texto: string }) {
    return (
        <g>
            <rect x={r[0]} y={r[1]} width={r[2]} height={r[3]} rx={1.5} fill="none" stroke={color} strokeWidth={2} />
            <rect x={r[0]} y={r[1] - 9} width={texto.length * 4.6 + 6} height={9} rx={1.5} fill={color} />
            <text x={r[0] + 3} y={r[1] - 2.3} fontSize={7} fontWeight={700} fill="#0b0f19">{texto}</text>
        </g>
    );
}

export function UnModeloVariasClases() {
    return (
        <div className="rounded-[10px] border border-border bg-card p-4 grid grid-cols-1 lg:grid-cols-[minmax(0,260px)_minmax(0,1fr)_minmax(0,1fr)] gap-4 items-start">
            <figure className="rounded-[10px] border border-border overflow-hidden">
                <Escena>
                    <Contenedor x={18} y={42} />
                    <Cono x={92} y={53} /><Cono x={128} y={53} />
                    <CajaRotulada r={[14, 40, 54, 44]} color={C_A} texto="Basurero" />
                    <CajaRotulada r={[82, 51, 20, 31]} color={C_B} texto="Cono" />
                    <rect x={118} y={51} width={20} height={31} rx={1.5} fill="none" stroke={C_B} strokeWidth={2} />
                </Escena>
                <figcaption className="px-2.5 py-2 text-[11.5px] text-muted-foreground leading-snug">Una foto, tres recuadros de dos clases. Se dibujan todos los que se vean.</figcaption>
            </figure>
            <div className="space-y-2 text-[12.5px] leading-snug">
                <div className="text-[13px] font-bold">Un modelo, varias clases</div>
                <p className="text-muted-foreground">Esto no es un conjunto por objeto: es <b className="text-foreground">un solo detector propio</b> que aprende todas las clases juntas. Cada <b className="text-foreground">clase</b> es un tipo de cosa (Basurero, Cono, Carretilla).</p>
                <p className="text-muted-foreground">Las fotos son comunes: en cada una se dibuja un recuadro por objeto, eligiendo su clase. Al entrenar sale <b className="text-foreground">un modelo</b> que las encuentra a todas, y en las cámaras aparecen como objetos más, al lado de personas y autos.</p>
                <p className="text-muted-foreground">Cada clase necesita sus propios recuadros (mínimo {CAJAS_MINIMO}). Si agregás una clase después, se vuelve a entrenar y el modelo nuevo trae todas.</p>
            </div>
            <div className="space-y-1.5 text-[12px] text-muted-foreground leading-snug">
                <div className="text-[13px] font-bold text-foreground">Qué no es una clase</div>
                <p><b className="text-foreground">Algo que ya conoce:</b> personas, autos, motos, bicicletas, perros, mochilas.</p>
                <p><b className="text-foreground">El estado de un lugar:</b> «contenedor lleno», «portón abierto». Eso es una <b className="text-foreground">escena</b>: se enseña en las zonas entrenables, con ejemplos de cada estado.</p>
                <p><b className="text-foreground">Una situación:</b> una pelea, alguien saltando el cerco. Se arma con reglas sobre lo que el detector ya ve.</p>
            </div>
        </div>
    );
}
