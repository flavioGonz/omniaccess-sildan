"use client";

import { useRef, useState } from "react";
import { Loader2, RefreshCw, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Punto, Sentido } from "@/lib/vision-reglas";

/**
 * Dibujar una línea o una zona sobre el cuadro de una cámara, para una regla de visión.
 *
 * El cuadro es el del MISMO stream que analiza vision-worker (/api/vision/cuadro): la
 * geometría se guarda en fracciones del cuadro y tiene que caer donde el worker la va a mirar.
 *
 *  · Línea: dos toques fijan los extremos; los extremos se arrastran. Se rotulan los dos
 *    lados, A y B (B es el de la derecha yendo de a a b; el mismo criterio que el worker), y
 *    en «sentido contrario» la flecha verde es el sentido permitido y la roja el que avisa.
 *  · Zona: cada toque agrega un vértice; se arrastran; doble clic en un vértice lo borra.
 *
 * Se mira el PIE de cada objeto: la línea y la zona se dibujan en el piso, no a la altura de
 * la cabeza.
 */
export function EditorGeometria({ deviceId, modo, linea, zona, permitido, alCambiarLinea, alCambiarZona }: {
    deviceId: string;
    modo: "linea" | "zona";
    linea: { a: Punto; b: Punto } | null;
    zona: Punto[];
    /** Sólo en sentido contrario. */
    permitido?: Sentido;
    alCambiarLinea: (l: { a: Punto; b: Punto } | null) => void;
    alCambiarZona: (z: Punto[]) => void;
}) {
    const svg = useRef<SVGSVGElement>(null);
    const [vuelta, setVuelta] = useState(0);
    const [cargando, setCargando] = useState(true);
    const [error, setError] = useState(false);
    const [primero, setPrimero] = useState<Punto | null>(null);
    const arrastre = useRef<{ tipo: "a" | "b" | number } | null>(null);

    const aPunto = (e: React.PointerEvent): Punto => {
        const r = svg.current!.getBoundingClientRect();
        return [Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), Math.max(0, Math.min(1, (e.clientY - r.top) / r.height))];
    };
    const tocar = (e: React.PointerEvent) => {
        if (arrastre.current) return;
        const p = aPunto(e);
        if (modo === "linea") {
            if (!primero) { setPrimero(p); alCambiarLinea(null); }
            else { alCambiarLinea({ a: primero, b: p }); setPrimero(null); }
        } else alCambiarZona([...zona, p]);
    };
    const tomar = (tipo: "a" | "b" | number) => (e: React.PointerEvent) => {
        e.stopPropagation();
        (e.target as Element).setPointerCapture?.(e.pointerId);
        arrastre.current = { tipo };
    };
    const mover = (e: React.PointerEvent) => {
        if (!arrastre.current) return;
        const p = aPunto(e), t = arrastre.current.tipo;
        if (t === "a" || t === "b") { if (linea) alCambiarLinea({ ...linea, [t]: p }); }
        else alCambiarZona(zona.map((q, i) => (i === t ? p : q)));
    };
    const soltar = () => { setTimeout(() => { arrastre.current = null; }, 0); };

    // Rótulos de los lados y flechas: sobre la normal a la línea, desde el medio.
    let lados: null | { A: Punto; B: Punto; mid: Punto; n: Punto } = null;
    if (linea) {
        const dx = linea.b[0] - linea.a[0], dy = linea.b[1] - linea.a[1];
        const L = Math.hypot(dx, dy) || 1;
        const n: Punto = [-dy / L, dx / L];
        const mid: Punto = [(linea.a[0] + linea.b[0]) / 2, (linea.a[1] + linea.b[1]) / 2];
        const k = 0.07;
        lados = { mid, n, B: [mid[0] + n[0] * k, mid[1] + n[1] * k], A: [mid[0] - n[0] * k, mid[1] - n[1] * k] };
    }
    const flecha = (signo: 1 | -1, color: string) => {
        if (!lados) return null;
        const { mid, n } = lados, L = 0.06;
        const fin: Punto = [mid[0] + n[0] * L * signo, mid[1] + n[1] * L * signo];
        const ini: Punto = [mid[0] - n[0] * L * signo * 0.2, mid[1] - n[1] * L * signo * 0.2];
        return <line x1={ini[0]} y1={ini[1]} x2={fin[0]} y2={fin[1]} stroke={color} strokeWidth={3} vectorEffect="non-scaling-stroke" markerEnd={`url(#punta-${color === "#22c55e" ? "v" : "r"})`} />;
    };

    return (
        <div className="space-y-2">
            <div className="relative rounded-[10px] overflow-hidden bg-black select-none">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/vision/cuadro?camara=${encodeURIComponent(deviceId)}&v=${vuelta}`} alt="Cuadro de la cámara" draggable={false}
                    onLoad={() => { setCargando(false); setError(false); }} onError={() => { setCargando(false); setError(true); }}
                    className="w-full h-auto block pointer-events-none" />
                {cargando && <div className="absolute inset-0 grid place-items-center text-white/70 text-[12px]"><span className="inline-flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Trayendo el cuadro…</span></div>}
                {error && <div className="absolute inset-0 grid place-items-center text-white/70 text-[12px]">No llegó el cuadro de la cámara.</div>}
                <svg ref={svg} viewBox="0 0 1 1" preserveAspectRatio="none" className="absolute inset-0 w-full h-full cursor-crosshair touch-none"
                    onPointerDown={tocar} onPointerMove={mover} onPointerUp={soltar} onPointerLeave={soltar}>
                    <defs>
                        <marker id="punta-v" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#22c55e" /></marker>
                        <marker id="punta-r" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#ef4444" /></marker>
                    </defs>
                    {modo === "zona" && zona.length >= 2 && (
                        <polygon points={zona.map((p) => p.join(",")).join(" ")} fill="rgba(56,189,248,0.18)" stroke="#38bdf8" strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
                    )}
                    {modo === "linea" && linea && (
                        <>
                            <line x1={linea.a[0]} y1={linea.a[1]} x2={linea.b[0]} y2={linea.b[1]} stroke="#38bdf8" strokeWidth={3} vectorEffect="non-scaling-stroke" strokeLinecap="round" />
                            {permitido && flecha(permitido === "ab" ? 1 : -1, "#22c55e")}
                            {permitido && flecha(permitido === "ab" ? -1 : 1, "#ef4444")}
                        </>
                    )}
                    {modo === "linea" && primero && <circle cx={primero[0]} cy={primero[1]} r={0.008} fill="#38bdf8" stroke="#fff" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />}
                    {modo === "linea" && linea && (["a", "b"] as const).map((t) => (
                        <circle key={t} cx={linea[t][0]} cy={linea[t][1]} r={0.012} fill="#38bdf8" stroke="#fff" strokeWidth={1.5} vectorEffect="non-scaling-stroke" className="cursor-grab" onPointerDown={tomar(t)} />
                    ))}
                    {modo === "zona" && zona.map((p, i) => (
                        <circle key={i} cx={p[0]} cy={p[1]} r={0.011} fill="#38bdf8" stroke="#fff" strokeWidth={1.5} vectorEffect="non-scaling-stroke" className="cursor-grab"
                            onPointerDown={tomar(i)} onDoubleClick={(e) => { e.stopPropagation(); alCambiarZona(zona.filter((_, k) => k !== i)); }} />
                    ))}
                </svg>
                {/* Los rótulos A y B, en HTML para que no se deformen con el cuadro. */}
                {modo === "linea" && lados && (["A", "B"] as const).map((k) => (
                    <span key={k} className="absolute -translate-x-1/2 -translate-y-1/2 grid place-items-center w-6 h-6 rounded-full bg-black/70 text-white text-[12px] font-bold pointer-events-none ring-1 ring-white/40"
                        style={{ left: `${lados![k][0] * 100}%`, top: `${lados![k][1] * 100}%` }}>{k}</span>
                ))}
            </div>
            <div className="flex items-center gap-2 text-[11.5px] text-muted-foreground">
                <span className="flex-1">
                    {modo === "linea"
                        ? (primero ? "Tocá el otro extremo." : linea ? "Arrastrá los extremos para ajustar. Tocá en otro lado para dibujarla de nuevo." : "Tocá los dos extremos de la línea, sobre el piso.")
                        : zona.length < 3 ? `Tocá los vértices de la zona, sobre el piso (${zona.length} de al menos 3).` : "Arrastrá los vértices para ajustar; doble clic en uno lo borra."}
                </span>
                <button type="button" onClick={() => { setCargando(true); setVuelta((v) => v + 1); }} className="inline-flex items-center gap-1 hover:text-foreground"><RefreshCw size={12} /> Otro cuadro</button>
                <button type="button" onClick={() => { setPrimero(null); modo === "linea" ? alCambiarLinea(null) : alCambiarZona([]); }}
                    className={cn("inline-flex items-center gap-1 hover:text-foreground")}><Trash2 size={12} /> Borrar</button>
            </div>
        </div>
    );
}
