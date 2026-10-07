"use client";
import { useEffect, useRef, useState } from "react";

/* Time scrubber (rueda horizontal) — adaptado para el playback de OmniAccess.
   Añadidos respecto del original: props `value` (minuto del día para seguir el reloj
   externo) y `onChange` (se llama al asentarse en un paso). */

const stillness = () =>
    typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

const PX = 2;
const DAY = 1440;
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const wrap = (m: number) => ((m % DAY) + DAY) % DAY;

function Digit({ d }: { d: string }) {
    const prev = useRef(d);
    const flip = useRef<boolean | null>(null);
    if (prev.current !== d) { prev.current = d; flip.current = !flip.current; }
    return (
        <span className="tms-col">
            <span className="tms-strip" data-flip={flip.current === null ? undefined : flip.current ? "a" : "b"}
                style={{ transform: `translateY(${-Number(d) * 1.5}em)` }}>
                {"0123456789".split("").map((n) => <span key={n}>{n}</span>)}
            </span>
        </span>
    );
}

function label(m: number, h24: boolean) {
    const t = wrap(Math.round(m));
    const h = Math.floor(t / 60);
    const mm = String(t % 60).padStart(2, "0");
    if (h24) return { time: `${String(h).padStart(2, "0")}:${mm}`, mer: "" };
    return { time: `${h % 12 || 12}:${mm}`, mer: h < 12 ? "AM" : "PM" };
}

/**
 * Una marca sobre la regla: un evento a una hora del día.
 *
 * `m` es el minuto del día con decimales (04:35:17 → 275.28). El ícono es el del tipo de
 * evento (cruce de línea, zona), para que se reconozca sin leer. Al tocarla la regla se
 * posiciona EXACTAMENTE ahí —sin redondear al paso de 5 minutos, que es para arrastrar—
 * y avisa con `onMarca`, que es lo que lleva a la grabación de ese instante.
 */
export type MarcaScrub = { id: string; m: number; Icon: React.ComponentType<{ size?: number; className?: string }>; titulo: string; tono?: string };

/** Cuántos minutos cubre un ícono de marca a 2 px/min: dos eventos más cerca que esto se juntan en una sola marca con contador. */
const MINUTOS_POR_MARCA = 9;

export function Scrub({ step = "15", momentum = 50, format = "12h", corner = 20, start = 570, width = 300, value, onChange, marcas, onMarca }: {
    step?: string; momentum?: number; format?: string; corner?: number; start?: number; width?: number;
    value?: number; onChange?: (minutes: number) => void;
    marcas?: MarcaScrub[];
    /** Se tocó una marca: la regla ya está sobre ella; el padre decide qué grabación abrir. */
    onMarca?: (marca: MarcaScrub, grupo: MarcaScrub[]) => void;
} = {}) {
    const HALF = (width - 36) / 2;
    const still = stillness();
    const [pos, setPos] = useState(start);
    const p = useRef({ x: start, v: 0, to: start });
    const raf = useRef(0);
    const knobs = useRef({ step: Number(step) || 15, momentum });
    knobs.current = { step: Number(step) || 15, momentum };
    const ruler = useRef<HTMLDivElement>(null);
    const lastStep = useRef(Math.floor(start / (Number(step) || 15)));
    const dragging = useRef(false);
    const onChangeRef = useRef(onChange); onChangeRef.current = onChange;
    const onMarcaRef = useRef(onMarca); onMarcaRef.current = onMarca;

    // seguir el reloj externo cuando NO se está arrastrando ni asentándose tras un arrastre.
    // El umbral es chico a propósito: `value` llega con decimales mientras el video avanza
    // (un segundo son 0,017 min) y con 0,5 la regla quedaba quieta medio minuto y saltaba.
    useEffect(() => {
        if (value == null || dragging.current || raf.current) return;
        if (Math.abs(wrap(p.current.x) - wrap(value)) < 0.01) return;
        p.current.x = value; p.current.to = value; p.current.v = 0; setPos(value);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [value]);

    const hear = (x: number) => { const s = knobs.current.step; const k = Math.floor(x / s); if (k === lastStep.current) return; lastStep.current = k; };
    const set = (x: number) => { p.current.x = x; hear(x); setPos(x); };

    const run = () => {
        if (raf.current) return;
        let prev = 0;
        const tick = (t: number) => {
            const dt = prev ? clamp((t - prev) / 16.67, 0, 2.5) : 1; prev = t;
            const c = p.current;
            c.v += ((c.to - c.x) * 0.022 - c.v * 0.26) * dt;
            const x = c.x + c.v * dt;
            if (Math.abs(c.to - x) < 0.01 && Math.abs(c.v) < 0.01) { c.v = 0; set(c.to); raf.current = 0; onChangeRef.current?.(wrap(Math.round(c.to))); return; }
            set(x); raf.current = requestAnimationFrame(tick);
        };
        raf.current = requestAnimationFrame(tick);
    };
    useEffect(() => () => { cancelAnimationFrame(raf.current); raf.current = 0; }, []);

    const goTo = (to: number, v = p.current.v) => { p.current.to = to; p.current.v = v; if (still) { p.current.v = 0; set(to); onChangeRef.current?.(wrap(Math.round(to))); return; } run(); };

    const drag = useRef<null | { x: number; t: number; v: number; k: number }>(null);
    const onDown = (e: React.PointerEvent<HTMLDivElement>) => {
        try { e.currentTarget.setPointerCapture(e.pointerId); } catch { }
        cancelAnimationFrame(raf.current); raf.current = 0; dragging.current = true;
        const k = e.currentTarget.getBoundingClientRect().width / e.currentTarget.offsetWidth || 1;
        drag.current = { x: e.clientX, t: performance.now(), v: 0, k }; p.current.v = 0;
    };
    const onMove = (e: React.PointerEvent) => {
        const g = drag.current; if (!g) return;
        const now = performance.now();
        const dm = -(e.clientX - g.x) / g.k / PX;
        const dt = Math.max(1, now - g.t) / 16.67;
        g.v = g.v * 0.5 + (dm / dt) * 0.5; g.x = e.clientX; g.t = now;
        set(p.current.x + dm);
    };
    const onUp = (e: React.PointerEvent<HTMLDivElement>) => {
        const g = drag.current; drag.current = null; dragging.current = false;
        try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { }
        if (!g) return;
        const v = performance.now() - g.t > 80 ? 0 : clamp(g.v, -14, 14);
        const s = knobs.current.step;
        const carry = 6 + (clamp(knobs.current.momentum, 0, 100) / 100) * 30;
        const land = Math.round((p.current.x + v * carry) / s) * s;
        goTo(land, v * 0.6);
    };

    useEffect(() => {
        const el = ruler.current; if (!el) return; let idle = 0;
        const wheel = (e: WheelEvent) => {
            if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
            e.preventDefault(); cancelAnimationFrame(raf.current); raf.current = 0;
            set(p.current.x + e.deltaX / PX);
            clearTimeout(idle);
            idle = window.setTimeout(() => { const s = knobs.current.step; goTo(Math.round(p.current.x / s) * s, 0); }, 120);
        };
        el.addEventListener("wheel", wheel, { passive: false });
        return () => { el.removeEventListener("wheel", wheel); clearTimeout(idle); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const ticks: { m: number; x: number; f: number; kind: "hour" | "quarter" | "five" }[] = [];
    const span = HALF / PX + 10;
    for (let m = Math.ceil((pos - span) / 5) * 5; m <= pos + span; m += 5) {
        const x = (m - pos) * PX;
        const f = clamp(1 - Math.pow(Math.abs(x) / HALF, 2), 0, 1);
        const w = wrap(m);
        ticks.push({ m, x, f, kind: w % 60 === 0 ? "hour" : w % 15 === 0 ? "quarter" : "five" });
    }

    const h24 = format === "24h";
    const { time, mer } = label(pos, h24);
    const s = Number(step) || 15;

    /**
     * Las marcas visibles, agrupadas. Se recorren de la más nueva a la más vieja y cada
     * una se pega al grupo anterior si cae a menos de un ícono de distancia: así un evento
     * que disparó cuatro detecciones en dos minutos es UNA marca con un "4", y no cuatro
     * íconos encimados que no se pueden tocar.
     */
    const grupos: { lider: MarcaScrub; todas: MarcaScrub[]; x: number; f: number }[] = [];
    if (marcas && marcas.length) {
        const vis = marcas.filter((k) => Math.abs(k.m - pos) <= span).sort((a, b) => b.m - a.m);
        for (const k of vis) {
            const u = grupos[grupos.length - 1];
            if (u && Math.abs(u.lider.m - k.m) < MINUTOS_POR_MARCA) { u.todas.push(k); continue; }
            const x = (k.m - pos) * PX;
            grupos.push({ lider: k, todas: [k], x, f: clamp(1 - Math.pow(Math.abs(x) / HALF, 2), 0, 1) });
        }
    }
    const irAMarca = (g: { lider: MarcaScrub; todas: MarcaScrub[] }) => {
        cancelAnimationFrame(raf.current); raf.current = 0; p.current.v = 0; p.current.to = g.lider.m; set(g.lider.m);
        onMarcaRef.current?.(g.lider, g.todas);
    };

    return (
        <div className="tms" style={{ "--tms-r": `${Math.max(0, corner)}px`, width } as React.CSSProperties}>
            <div className="tms-read" aria-live="polite" aria-label={`${time} ${mer}`}>
                <span className="tms-time">
                    {time.split("").map((c, i) => c === ":" ? <span key={`c${i}`} className="tms-colon">:</span> : <Digit key={time.length - i} d={c} />)}
                </span>
                {mer && <span className="tms-mer">{mer}</span>}
            </div>
            <div ref={ruler} className="tms-ruler" role="slider" tabIndex={0} aria-label="Time"
                aria-valuetext={`${time} ${mer}`} aria-valuenow={wrap(Math.round(pos))} aria-valuemin={0} aria-valuemax={DAY - 1}
                onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
                onKeyDown={(e) => { const d = e.key === "ArrowRight" ? s : e.key === "ArrowLeft" ? -s : 0; if (!d) return; e.preventDefault(); goTo(Math.round(p.current.to / s) * s + d, 0); }}>
                <div className="tms-track">
                    {ticks.map((t) => (
                        <span key={t.m} className="tms-tick" data-kind={t.kind}
                            style={{ transform: `translateX(${t.x.toFixed(2)}px) scaleY(${(0.55 + 0.45 * t.f).toFixed(3)})`, opacity: 0.18 + 0.82 * t.f }} />
                    ))}
                    {ticks.filter((t) => t.kind === "hour").map((t) => {
                        const h = Math.floor(wrap(t.m) / 60);
                        return (
                            <span key={`l${t.m}`} className="tms-hour" style={{ transform: `translateX(${t.x.toFixed(2)}px) translateX(-50%)`, opacity: 0.15 + 0.85 * t.f }}>
                                {h24 ? String(h).padStart(2, "0") : `${h % 12 || 12} ${h < 12 ? "AM" : "PM"}`}
                            </span>
                        );
                    })}
                </div>
                {/* Las marcas van FUERA de .tms-track para no heredar su transform, y por encima
                    de los ticks: son lo único de la regla que se toca de a uno. El pointerdown se
                    corta para que tocar una marca no empiece un arrastre. */}
                <div className="tms-marcas" aria-hidden={grupos.length === 0}>
                    {grupos.map((g) => {
                        const Ic = g.lider.Icon;
                        const n = g.todas.length;
                        const texto = n > 1 ? `${n} eventos · ${g.lider.titulo} y ${n - 1} más` : g.lider.titulo;
                        return (
                            <button key={g.lider.id} type="button" className="tms-marca" data-tono={g.lider.tono || "mal"}
                                style={{ "--tx": `${g.x.toFixed(2)}px`, opacity: 0.25 + 0.75 * g.f } as React.CSSProperties}
                                data-tooltip-id="mi-tip" data-tooltip-content={`${texto} · ir a la grabación`}
                                aria-label={`${texto}, ir a la grabación`}
                                onPointerDown={(e) => { e.stopPropagation(); }}
                                onClick={(e) => { e.stopPropagation(); irAMarca(g); }}>
                                <Ic size={11} />
                                {n > 1 && <span className="tms-marca-n">{n}</span>}
                            </button>
                        );
                    })}
                </div>
                <span className="tms-mark" aria-hidden="true" />
            </div>
            <style jsx global>{`
                .tms { padding: 14px 18px 12px; border-radius: var(--tms-r, 20px); background: transparent; color: #fff; font-family: inherit; user-select: none; -webkit-user-select: none; margin: 0 auto; max-width: 100%; }
                .tms-read { display: flex; align-items: baseline; justify-content: center; gap: 6px; }
                .tms-time { display: inline-flex; font-size: 30px; font-weight: 700; line-height: 1; letter-spacing: -0.03em; font-variant-numeric: tabular-nums; text-shadow: 0 2px 10px rgba(0,0,0,0.9); }
                .tms-col { display: inline-block; height: 1.5em; margin: -0.25em 0; overflow: hidden; mask-image: linear-gradient(transparent, #000 30%, #000 70%, transparent); }
                .tms-strip { display: flex; flex-direction: column; transition: transform 220ms cubic-bezier(0.3, 1.15, 0.4, 1); }
                .tms-strip > span { height: 1.5em; line-height: 1.5em; }
                .tms-strip[data-flip="a"] { animation: tms-blur-a 260ms ease-out; }
                .tms-strip[data-flip="b"] { animation: tms-blur-b 260ms ease-out; }
                .tms-colon { padding: 0 0.02em; }
                .tms-mer { font-size: 13px; font-weight: 600; color: rgba(255,255,255,0.55); text-shadow: 0 2px 8px rgba(0,0,0,0.9); }
                .tms-ruler { position: relative; height: 56px; margin-top: 10px; cursor: grab; touch-action: pan-y; outline: none; mask-image: linear-gradient(90deg, transparent, #000 22%, #000 78%, transparent); }
                .tms-ruler:active { cursor: grabbing; }
                .tms-ruler:focus-visible { box-shadow: inset 0 0 0 2px rgba(56,189,248,0.6); border-radius: 10px; }
                .tms-track { position: absolute; left: 50%; top: 0; bottom: 0; }
                .tms-tick { position: absolute; left: -1px; top: 6px; width: 2px; height: 10px; border-radius: 1px; background: #fff; transform-origin: 50% 0; }
                .tms-tick[data-kind="quarter"] { height: 17px; }
                .tms-tick[data-kind="hour"] { height: 25px; }
                .tms-hour { position: absolute; left: 0; top: 36px; font-size: 11px; font-weight: 600; white-space: nowrap; color: rgba(255,255,255,0.6); }
                .tms-mark { position: absolute; left: 50%; top: 2px; width: 3px; height: 32px; margin-left: -1.5px; border-radius: 2px; background: #ef4444; box-shadow: 0 0 8px rgba(239,68,68,0.9); }
                /* Marcas de evento: colgadas del borde superior de la regla, sobre los ticks de su hora. */
                .tms-marcas { position: absolute; left: 50%; top: -14px; height: 22px; width: 0; }
                .tms-marca { position: absolute; left: 0; top: 0; width: 22px; height: 22px; border-radius: 999px; border: 1.5px solid rgba(255,255,255,0.85); display: grid; place-items: center; color: #fff; cursor: pointer; padding: 0; transform: translateX(var(--tx, 0px)) translateX(-50%); transition: box-shadow 120ms ease; touch-action: none; }
                .tms-marca[data-tono="mal"]   { background: #dc2626; box-shadow: 0 0 10px rgba(239,68,68,0.75); }
                .tms-marca[data-tono="aviso"] { background: #d97706; box-shadow: 0 0 10px rgba(245,158,11,0.7); }
                .tms-marca[data-tono="info"]  { background: #0284c7; box-shadow: 0 0 10px rgba(56,189,248,0.7); }
                .tms-marca:hover { transform: translateX(var(--tx, 0px)) translateX(-50%) scale(1.18); box-shadow: 0 0 16px rgba(255,255,255,0.55); }
                .tms-marca-n { position: absolute; top: -7px; right: -7px; min-width: 15px; height: 15px; padding: 0 4px; border-radius: 999px; background: #fff; color: #991b1b; font-size: 9px; font-weight: 800; line-height: 15px; text-align: center; font-variant-numeric: tabular-nums; }
                @keyframes tms-blur-a { from { filter: blur(2px); } to { filter: blur(0); } }
                @keyframes tms-blur-b { from { filter: blur(2px); } to { filter: blur(0); } }
            `}</style>
        </div>
    );
}
