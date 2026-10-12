"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Check, Loader2, Trash2, Undo2, X, Ban } from "lucide-react";
import { cn } from "@/lib/utils";
import { CAJA_MIN, type Caja, type ClaseResumen, type FotoFila } from "@/lib/detector-propio";

/**
 * Dibujar recuadros con el dedo, en el celular.
 *
 * El anotador del panel está hecho para mouse y teclado (Enter, N, 1-9). Acá todo es dedo:
 *   - arrastrar sobre la foto dibuja un recuadro de la clase elegida abajo;
 *   - tocar un recuadro lo elige: se puede borrar o cambiarle la clase tocando otra;
 *   - «No hay ninguno» guarda la foto como ejemplo negativo (el lugar sin el objeto).
 *
 * Un toque sin arrastrar no dibuja nada: con el pulgar es fácil rozar la pantalla, y un recuadro
 * de dos píxeles es un dato roto que el servidor descarta (CAJA_MIN). Se exige un poco más
 * (ARRASTRE_MIN) para que el roce no cuente.
 *
 * La foto se encaja entera (contain) en el espacio que queda entre las barras: un recuadro sólo
 * se puede dibujar sobre lo que se ve, y una foto recortada esconde justo los bordes.
 */
export const COLORES_CLASE = ["#60a5fa", "#f59e0b", "#34d399", "#f472b6", "#a78bfa", "#22d3ee", "#fb7185", "#facc15", "#4ade80"];
const ARRASTRE_MIN = Math.max(CAJA_MIN * 3, 0.02);

export function DibujoMovil({ foto, clases, posicion, alGuardar, alDescartar, alCerrar }: {
    foto: FotoFila;
    clases: ClaseResumen[];
    /** «2 de 7» cuando se recorre una cola; nada si es una foto recién sacada. */
    posicion?: string;
    alGuardar: (cajas: Caja[]) => Promise<boolean>;
    alDescartar: () => Promise<boolean>;
    alCerrar: () => void;
}) {
    const [cajas, setCajas] = useState<Caja[]>(foto.cajas || []);
    const [historia, setHistoria] = useState<Caja[][]>([]);
    const [clase, setClase] = useState(clases[0]?.id || "");
    const [elegida, setElegida] = useState<number | null>(null);
    const [trazo, setTrazo] = useState<[number, number, number, number] | null>(null);
    const [ocupado, setOcupado] = useState<"" | "guardar" | "ninguno" | "descartar">("");
    const area = useRef<HTMLDivElement>(null);
    const lienzo = useRef<HTMLDivElement>(null);
    const [tam, setTam] = useState({ w: 0, h: 0 });

    useEffect(() => { setCajas(foto.cajas || []); setHistoria([]); setElegida(null); }, [foto.id]); // eslint-disable-line react-hooks/exhaustive-deps

    // El tamaño de la foto encajada en el área libre, medido (no hay CSS que haga «contain» de un div).
    useLayoutEffect(() => {
        const el = area.current;
        if (!el) return;
        const medir = () => {
            const W = el.clientWidth, H = el.clientHeight, ar = (foto.ancho || 4) / (foto.alto || 3);
            setTam(W / H > ar ? { w: H * ar, h: H } : { w: W, h: W / ar });
        };
        medir();
        const ro = new ResizeObserver(medir);
        ro.observe(el);
        return () => ro.disconnect();
    }, [foto.ancho, foto.alto]);

    const cambiar = useCallback((n: Caja[]) => { setHistoria((h) => [...h.slice(-30), cajas]); setCajas(n); }, [cajas]);
    const punto = (e: React.PointerEvent) => {
        const r = lienzo.current!.getBoundingClientRect();
        return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))] as const;
    };
    const bajar = (e: React.PointerEvent) => {
        if (!clase) return;
        (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
        const [x, y] = punto(e);
        setElegida(null);
        setTrazo([x, y, x, y]);
    };
    const mover = (e: React.PointerEvent) => { if (!trazo) return; const [x, y] = punto(e); setTrazo([trazo[0], trazo[1], x, y]); };
    const soltar = () => {
        if (!trazo) return;
        const [a, b, c, d] = trazo;
        setTrazo(null);
        const x1 = Math.min(a, c), x2 = Math.max(a, c), y1 = Math.min(b, d), y2 = Math.max(b, d);
        if (x2 - x1 < ARRASTRE_MIN || y2 - y1 < ARRASTRE_MIN) return;
        cambiar([...cajas, { clase, caja: [x1, y1, x2, y2] }]);
    };
    const elegirClase = (id: string) => {
        setClase(id);
        // Con un recuadro elegido, tocar una clase se la cambia a ese recuadro.
        if (elegida != null) cambiar(cajas.map((c, k) => (k === elegida ? { ...c, clase: id } : c)));
    };
    const colorDe = (id: string) => COLORES_CLASE[Math.max(0, clases.findIndex((c) => c.id === id)) % COLORES_CLASE.length];

    const hacer = async (que: "guardar" | "ninguno" | "descartar") => {
        setOcupado(que);
        const ok = que === "descartar" ? await alDescartar() : await alGuardar(que === "ninguno" ? [] : cajas);
        setOcupado("");
        return ok;
    };
    const rect = (k: [number, number, number, number]) => ({
        left: `${Math.min(k[0], k[2]) * 100}%`, top: `${Math.min(k[1], k[3]) * 100}%`,
        width: `${Math.abs(k[2] - k[0]) * 100}%`, height: `${Math.abs(k[3] - k[1]) * 100}%`,
    });

    return (
        <div className="fixed inset-0 z-[60] bg-black text-white flex flex-col select-none" style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}>
            <div className="shrink-0 flex items-center gap-2 px-3 h-14">
                <button type="button" onClick={alCerrar} aria-label="Cerrar" className="h-10 w-10 grid place-items-center rounded-full bg-white/10"><X size={20} /></button>
                <div className="min-w-0 flex-1">
                    <div className="text-[15px] font-bold leading-tight">Dibujar</div>
                    <div className="text-[11.5px] text-white/60 truncate">{cajas.length ? `${cajas.length} ${cajas.length === 1 ? "recuadro" : "recuadros"}` : "Arrastrá con el dedo sobre cada objeto"}{posicion ? ` · ${posicion}` : ""}</div>
                </div>
                <button type="button" onClick={() => hacer("descartar")} disabled={!!ocupado} aria-label="Descartar la foto"
                    className="h-10 px-3 rounded-full bg-white/10 text-[12.5px] font-semibold inline-flex items-center gap-1.5 disabled:opacity-50">
                    {ocupado === "descartar" ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />} Descartar
                </button>
            </div>

            <div ref={area} className="flex-1 min-h-0 grid place-items-center px-2">
                <div ref={lienzo} className="relative touch-none" style={{ width: tam.w, height: tam.h }}
                    onPointerDown={bajar} onPointerMove={mover} onPointerUp={soltar} onPointerCancel={() => setTrazo(null)}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`${foto.url}?w=1280`} alt="" draggable={false} className="absolute inset-0 w-full h-full object-fill pointer-events-none" />
                    {cajas.map((c, k) => {
                        const col = colorDe(c.clase);
                        const nombre = clases.find((x) => x.id === c.clase)?.nombre || "?";
                        return (
                            <button key={k} type="button" onPointerDown={(e) => { e.stopPropagation(); setElegida(k === elegida ? null : k); }}
                                className="absolute rounded-[3px]" style={{ ...rect(c.caja), border: `${k === elegida ? 3 : 2}px solid ${col}`, background: k === elegida ? `${col}33` : "transparent" }}>
                                <span className="absolute -top-5 left-0 px-1.5 rounded-[3px] text-[10.5px] font-bold text-black whitespace-nowrap" style={{ background: col }}>{nombre}</span>
                                {k === elegida && (
                                    <span role="button" aria-label="Borrar el recuadro"
                                        onPointerDown={(e) => { e.stopPropagation(); cambiar(cajas.filter((_, j) => j !== k)); setElegida(null); }}
                                        className="absolute -top-3 -right-3 h-7 w-7 grid place-items-center rounded-full pleno-mal"><X size={14} /></span>
                                )}
                            </button>
                        );
                    })}
                    {trazo && <span className="absolute rounded-[3px] pointer-events-none" style={{ ...rect(trazo), border: `2px dashed ${colorDe(clase)}` }} />}
                </div>
            </div>

            {/* Abajo, al alcance del pulgar: la clase, y las tres salidas. */}
            <div className="shrink-0 px-3 pt-2 pb-3 space-y-2.5">
                <div className="flex gap-1.5 overflow-x-auto [scrollbar-width:none] -mx-3 px-3">
                    {clases.map((c) => {
                        const activa = c.id === clase;
                        return (
                            <button key={c.id} type="button" onClick={() => elegirClase(c.id)} aria-pressed={activa}
                                className={cn("shrink-0 h-9 px-3.5 rounded-full text-[13px] font-semibold inline-flex items-center gap-2 border transition-colors",
                                    activa ? "bg-white text-black border-transparent" : "border-white/20 text-white/80")}>
                                <span className="h-2.5 w-2.5 rounded-full" style={{ background: colorDe(c.id) }} />{c.nombre}
                            </button>
                        );
                    })}
                </div>
                {elegida != null && <p className="text-[11.5px] text-white/60">Recuadro elegido: tocá otra clase para cambiársela, o la ✕ para borrarlo.</p>}
                <div className="grid grid-cols-[auto_1fr_1.4fr] gap-2">
                    <button type="button" onClick={() => { const h = historia[historia.length - 1]; if (h) { setCajas(h); setHistoria(historia.slice(0, -1)); setElegida(null); } }}
                        disabled={!historia.length} aria-label="Deshacer" className="h-12 w-12 grid place-items-center rounded-xl bg-white/10 disabled:opacity-30"><Undo2 size={18} /></button>
                    <button type="button" onClick={() => hacer("ninguno")} disabled={!!ocupado || cajas.length > 0}
                        className="h-12 rounded-xl bg-white/10 text-[13px] font-semibold inline-flex items-center justify-center gap-1.5 disabled:opacity-30">
                        {ocupado === "ninguno" ? <Loader2 size={16} className="animate-spin" /> : <Ban size={16} />} No hay ninguno
                    </button>
                    <button type="button" onClick={() => hacer("guardar")} disabled={!!ocupado || !cajas.length}
                        className="h-12 rounded-xl bg-[var(--accion)] text-white text-[14px] font-bold inline-flex items-center justify-center gap-1.5 disabled:opacity-40">
                        {ocupado === "guardar" ? <Loader2 size={16} className="animate-spin" /> : <Check size={17} />} Guardar
                    </button>
                </div>
            </div>
        </div>
    );
}
