"use client";

import { useEffect, useRef, useState } from "react";
import { Settings2, Minus, Plus, Loader2, Check, Camera } from "lucide-react";
import { cn } from "@/lib/utils";
import { guardarVentanaFicha, useVentanaFicha, type VentanaFicha } from "@/lib/clip-evento";
import { ALERTA_ANTES_MAX, ALERTA_DESPUES_MAX } from "@/lib/clips";

/**
 * El ajuste del video que arranca solo al abrir una ficha, desde la ficha misma (21/10, Nico:
 * «debo poder indicarle cuántos segundos antes y después del evento se reproduce; agregale un ícono
 * de settings en la píldora vertical del evento… recordá que tenemos varias ventanas: LPR,
 * intrusión, etc.»). Hasta ahora vivía sólo en Ajustes → Video del evento, lejos de donde se nota.
 *
 * Es UNA pieza para todas las ventanas: la del evento LPR (VisorCuadro), la de intrusión y
 * OmniVision (FichaDeteccion), Buscar parecidos, el panel del Monitor de Intrusión y Gestión de
 * alarmas. Guarda el mismo ajuste de siempre (FICHA_CLIP_ANTES/DESPUES) y las fichas abiertas
 * vuelven a pedir su clip con la ventana nueva (lib/clip-evento, useVentanaFicha).
 *
 * El popover vive encima de una ventana que se cierra con Escape y con un clic afuera: los dos
 * se frenan acá mientras está abierto, si no, ajustar el video cerraba la ficha.
 */
const PRESETS: { nombre: string; v: VentanaFicha }[] = [
    { nombre: "Corto", v: { antes: 3, despues: 1 } },
    { nombre: "Normal", v: { antes: 6, despues: 2 } },
    { nombre: "Largo", v: { antes: 12, despues: 4 } },
];

export function AjusteVideoFicha({ lado = "izquierda", className, chico }: {
    /** Hacia dónde se abre: a la izquierda de la píldora vertical, o abajo de un chip sobre la foto. */
    lado?: "izquierda" | "abajo";
    className?: string;
    /** El botón de 28 px (chips sobre la foto) en vez del de 36 (la píldora). */
    chico?: boolean;
}) {
    const guardada = useVentanaFicha();
    const [abierto, setAbierto] = useState(false);
    const [v, setV] = useState<VentanaFicha>(guardada);
    const [guardando, setGuardando] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [listo, setListo] = useState(false);
    const caja = useRef<HTMLDivElement>(null);
    useEffect(() => { if (abierto) { setV(guardada); setError(null); setListo(false); } }, [abierto]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        if (!abierto) return;
        const tecla = (e: KeyboardEvent) => {
            if (e.key === "Escape") { e.stopImmediatePropagation(); e.preventDefault(); setAbierto(false); }
            // Las teclas de la ficha (C, H, flechas…) no corren mientras se ajusta.
            else e.stopImmediatePropagation();
        };
        const fuera = (e: PointerEvent) => { if (caja.current && !caja.current.contains(e.target as Node)) setAbierto(false); };
        window.addEventListener("keydown", tecla, true);
        window.addEventListener("pointerdown", fuera, true);
        return () => { window.removeEventListener("keydown", tecla, true); window.removeEventListener("pointerdown", fuera, true); };
    }, [abierto]);

    const cambia = v.antes !== guardada.antes || v.despues !== guardada.despues;
    const guardar = async () => {
        setGuardando(true); setError(null);
        try { await guardarVentanaFicha(v); setListo(true); setTimeout(() => setAbierto(false), 700); }
        catch (e: any) { setError(e?.message || "No se pudo guardar"); }
        finally { setGuardando(false); }
    };
    const total = v.antes + v.despues;

    return (
        <div ref={caja} className={cn("relative", className)} onClick={(e) => e.stopPropagation()}>
            <button type="button" onClick={() => setAbierto((x) => !x)} aria-expanded={abierto} aria-haspopup="dialog"
                title={`Video de la ficha: ${guardada.antes} s antes y ${guardada.despues} s después. Tocá para cambiarlo`}
                aria-label="Ajustar el video de la ficha"
                className={cn("rounded-full flex items-center justify-center transition-colors",
                    chico ? "w-7 h-7 bg-black/55 hover:bg-black/75 text-white/90" : "visor-vidrio w-9 h-9 text-white/85 hover:text-white",
                    abierto && "!bg-[var(--accion)] !text-white")}>
                <Settings2 size={chico ? 13 : 15} className={cn("transition-transform duration-300", abierto && "rotate-90")} />
            </button>

            {abierto && (
                <div role="dialog" aria-label="Video de la ficha"
                    className={cn("absolute z-[60] w-[292px] rounded-[14px] bg-[#0d1117]/95 backdrop-blur-xl border border-white/12 text-white p-3.5 shadow-[0_18px_40px_rgba(0,0,0,0.55)] oa-ajuste-entra",
                        lado === "izquierda" ? "right-[calc(100%+14px)] top-1/2 -translate-y-1/2" : "right-0 top-[calc(100%+8px)] oa-ajuste-abajo")}>
                    <div className="text-[13px] font-bold">Video al abrir la ficha</div>
                    <div className="text-[11px] text-white/55 leading-snug mt-0.5">El que arranca solo, en loop sobre la foto. Vale para todas las fichas: LPR, intrusión, OmniVision y alarmas.</div>

                    {/* La línea de tiempo del clip: cuánto de antes, el instante, cuánto de después. */}
                    <div className="mt-3.5 mb-1">
                        <div className="relative h-7 flex items-center">
                            <div className="h-2 rounded-l-full bg-[var(--accion-en-oscuro)]/70 transition-[width] duration-300" style={{ width: `${(v.antes / total) * 100}%` }} />
                            <div className="h-2 rounded-r-full bg-white/35 transition-[width] duration-300" style={{ width: `${(v.despues / total) * 100}%` }} />
                            <span className="absolute -translate-x-1/2 grid place-items-center w-6 h-6 rounded-full bg-white text-black ring-4 ring-[#0d1117] transition-[left] duration-300" style={{ left: `${(v.antes / total) * 100}%` }}>
                                <Camera size={12} />
                            </span>
                            {/* Un cabezal que recorre el clip: se ve cuánto dura de verdad el loop. */}
                            <span key={`${v.antes}-${v.despues}`} className="absolute top-0 bottom-0 w-px bg-white/80 oa-ajuste-cabezal" style={{ animationDuration: `${Math.max(2, total)}s` }} />
                        </div>
                        <div className="flex justify-between text-[10.5px] text-white/55 tabular-nums mt-0.5">
                            <span>−{v.antes} s</span><span>el evento</span><span>+{v.despues} s</span>
                        </div>
                    </div>

                    <Paso rotulo="Antes" ayuda="Cómo llegó" valor={v.antes} min={0} max={ALERTA_ANTES_MAX} alCambiar={(n) => setV((x) => ({ ...x, antes: n }))} />
                    <Paso rotulo="Después" ayuda="Qué hizo" valor={v.despues} min={1} max={ALERTA_DESPUES_MAX} alCambiar={(n) => setV((x) => ({ ...x, despues: n }))} />

                    <div className="flex gap-1.5 mt-2.5">
                        {PRESETS.map((p) => {
                            const on = p.v.antes === v.antes && p.v.despues === v.despues;
                            return (
                                <button key={p.nombre} type="button" onClick={() => setV(p.v)} aria-pressed={on}
                                    className={cn("flex-1 h-7 rounded-full text-[11px] font-semibold border transition-colors",
                                        on ? "bg-white text-black border-white" : "border-white/15 text-white/70 hover:text-white hover:border-white/35")}>
                                    {p.nombre} <span className="opacity-60 tabular-nums">{p.v.antes}/{p.v.despues}</span>
                                </button>
                            );
                        })}
                    </div>
                    <div className="text-[10.5px] text-white/45 mt-2.5 leading-snug">Cada segundo es espera: el grabador entrega el video a tiempo real. {total} s de clip.</div>
                    {error && <div className="text-[11.5px] text-[var(--mal)] mt-2">{error}</div>}
                    <div className="flex items-center justify-end gap-2 mt-3">
                        <button type="button" onClick={() => setAbierto(false)} className="h-8 px-3 rounded-[6px] text-[12px] font-semibold text-white/70 hover:text-white">Cancelar</button>
                        <button type="button" onClick={guardar} disabled={!cambia || guardando || listo}
                            className="h-8 px-3.5 rounded-[6px] text-[12px] font-semibold bg-[var(--accion)] text-white inline-flex items-center gap-1.5 disabled:opacity-45 hover:brightness-110">
                            {guardando ? <Loader2 size={13} className="animate-spin" /> : listo ? <Check size={13} /> : null}
                            {listo ? "Guardado" : "Guardar"}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}

function Paso({ rotulo, ayuda, valor, min, max, alCambiar }: { rotulo: string; ayuda: string; valor: number; min: number; max: number; alCambiar: (n: number) => void }) {
    return (
        <div className="flex items-center gap-3 py-1.5">
            <div className="flex-1 min-w-0 leading-tight">
                <div className="text-[12.5px] font-semibold">{rotulo}</div>
                <div className="text-[10.5px] text-white/50">{ayuda}</div>
            </div>
            <div className="flex items-center gap-1">
                <button type="button" onClick={() => alCambiar(Math.max(min, valor - 1))} disabled={valor <= min} aria-label={`Menos segundos ${rotulo.toLowerCase()}`}
                    className="w-7 h-7 rounded-full grid place-items-center bg-white/10 hover:bg-white/20 disabled:opacity-30"><Minus size={13} /></button>
                <span className="w-12 text-center text-[15px] font-bold tabular-nums">{valor} s</span>
                <button type="button" onClick={() => alCambiar(Math.min(max, valor + 1))} disabled={valor >= max} aria-label={`Más segundos ${rotulo.toLowerCase()}`}
                    className="w-7 h-7 rounded-full grid place-items-center bg-white/10 hover:bg-white/20 disabled:opacity-30"><Plus size={13} /></button>
            </div>
        </div>
    );
}
