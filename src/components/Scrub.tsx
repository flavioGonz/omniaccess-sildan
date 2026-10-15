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

/** Cuántos px ocupa un ícono de marca: dos eventos más cerca que esto se juntan en una sola marca con contador (9 min a 2 px/min). */
const PX_POR_MARCA = 18;

/**
 * Añadido de OmniAccess: una franja de color sobre la regla (un tramo con detección). `a` y `b`
 * en minutos como `tramos`; `tono` es el de las marcas (aviso, info, lectura…).
 */
export type BandaScrub = { a: number; b: number; tono: string; titulo?: string };

/**
 * Añadido de OmniAccess (15/10, «controlarla desde cualquier parte con el drag and drop»): el
 * mismo arrastre de la regla, manejado desde otro elemento (el cuadro entero de la grabación).
 * Mismo sentido, misma escala y misma inercia: la regla se mueve bajo el dedo aunque el dedo
 * esté sobre el video.
 */
export type ScrubMando = { empezar: (clientX: number) => void; mover: (clientX: number) => void; soltar: () => void; /** Fue un toque, no un arrastre: se suelta sin asentar ni avisar. */ cancelar: () => void };

export function Scrub({ step = "15", momentum = 50, format = "12h", corner = 20, start = 570, width = 300, value, onChange, marcas, onMarca, difuminado = 22, tramos, sinEnvolver = false, rangoTramos, bandas, pxPorMinuto = PX, mando, alArrastrar }: {
    step?: string; momentum?: number; format?: string; corner?: number; start?: number; width?: number;
    /**
     * Qué porcentaje de cada borde de la regla se esfuma. 22 es el del vivo, donde la regla es
     * angosta y el esfumado la hace leer como una rueda. A lo ancho de un reproductor grande,
     * 22 por lado deja casi la mitad borrosa y la regla parece cortada: ahí se pide menos.
     */
    difuminado?: number;
    value?: number; onChange?: (minutes: number) => void;
    marcas?: MarcaScrub[];
    /** Se tocó una marca: la regla ya está sobre ella; el padre decide qué grabación abrir. */
    onMarca?: (marca: MarcaScrub, grupo: MarcaScrub[]) => void;
    /**
     * Añadido de OmniAccess (15/10, la grabación sobre la pared de cámaras): dónde HAY
     * grabación, como [desde, hasta] en minutos del día. Se dibuja como una franja sobre los
     * ticks para que un hueco se vea antes de arrastrar hasta él. Sin esto, la regla es la de
     * siempre.
     */
    tramos?: [number, number][];
    /**
     * Añadido de OmniAccess (15/10): `onChange` recibe los minutos SIN envolver, relativos a la
     * medianoche del día de `value`. Pasar las 00:00 hacia atrás da negativos (el día anterior) y
     * pasar las 24:00, más de 1440 (el siguiente). Envueltos, volver de 00:05 a 23:55 caía en las
     * 23:55 del MISMO día: casi un día entero hacia adelante.
     */
    sinEnvolver?: boolean;
    /**
     * Añadido de OmniAccess (15/10): dentro de qué minutos se SABE si hay grabación (el día
     * consultado, hasta ahora). Ahí, lo que no es tramo se pinta en rojo: «sin grabación». Fuera
     * (el futuro, otro día) no se pinta nada: no saber no es lo mismo que no haber.
     */
    rangoTramos?: [number, number];
    /** Añadido de OmniAccess: los tramos con detección, cada uno en su color, sobre la franja. */
    bandas?: BandaScrub[];
    /** Añadido de OmniAccess: la escala (px por minuto). La grabación pide más: se busca al segundo. */
    pxPorMinuto?: number;
    mando?: React.MutableRefObject<ScrubMando | null>;
    /** Añadido de OmniAccess: mientras se arrastra, dónde está la regla (sin envolver si `sinEnvolver`); null al soltar. */
    alArrastrar?: (minutos: number | null) => void;
} = {}) {
    const PX = pxPorMinuto;
    const MINUTOS_POR_MARCA = PX_POR_MARCA / PX;
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
    const envolverRef = useRef((m: number) => (sinEnvolver ? m : wrap(m))); envolverRef.current = (m: number) => (sinEnvolver ? m : wrap(m));
    const onMarcaRef = useRef(onMarca); onMarcaRef.current = onMarca;
    const alArrastrarRef = useRef(alArrastrar); alArrastrarRef.current = alArrastrar;
    const pxRef = useRef(PX); pxRef.current = PX;

    // seguir el reloj externo cuando NO se está arrastrando ni asentándose tras un arrastre.
    // El umbral es chico a propósito: `value` llega con decimales mientras el video avanza
    // (un segundo son 0,017 min) y con 0,5 la regla quedaba quieta medio minuto y saltaba.
    useEffect(() => {
        if (value == null || dragging.current || raf.current) return;
        // Sin envolver, `value` dice también el día: comparar envuelto dejaba la regla en −5 (el día
        // anterior) con los tramos del día nuevo dibujados un día corridos.
        if ((sinEnvolver ? Math.abs(p.current.x - value) : Math.abs(wrap(p.current.x) - wrap(value))) < 0.01) return;
        p.current.x = value; p.current.to = value; p.current.v = 0; setPos(value);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [value]);

    // Con pasos de menos de un minuto (la grabación, añadido de OmniAccess) no se redondea al minuto.
    const redondear = (x: number) => (knobs.current.step >= 1 ? Math.round(x) : Math.round(x / knobs.current.step) * knobs.current.step);
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
            if (Math.abs(c.to - x) < 0.01 && Math.abs(c.v) < 0.01) { c.v = 0; set(c.to); raf.current = 0; onChangeRef.current?.(envolverRef.current(redondear(c.to))); return; }
            set(x); raf.current = requestAnimationFrame(tick);
        };
        raf.current = requestAnimationFrame(tick);
    };
    useEffect(() => () => { cancelAnimationFrame(raf.current); raf.current = 0; }, []);

    const goTo = (to: number, v = p.current.v) => { p.current.to = to; p.current.v = v; if (still) { p.current.v = 0; set(to); onChangeRef.current?.(envolverRef.current(redondear(to))); return; } run(); };

    const drag = useRef<null | { x: number; t: number; v: number; k: number }>(null);
    // El arrastre, separado del evento: lo usan la regla y, con `mando`, cualquier otro elemento.
    const empezar = (clientX: number, k = 1) => {
        cancelAnimationFrame(raf.current); raf.current = 0; dragging.current = true;
        drag.current = { x: clientX, t: performance.now(), v: 0, k }; p.current.v = 0;
    };
    const mover = (clientX: number) => {
        const g = drag.current; if (!g) return;
        const now = performance.now();
        const dm = -(clientX - g.x) / g.k / pxRef.current;
        const dt = Math.max(1, now - g.t) / 16.67;
        g.v = g.v * 0.5 + (dm / dt) * 0.5; g.x = clientX; g.t = now;
        set(p.current.x + dm);
        alArrastrarRef.current?.(envolverRef.current(p.current.x));
    };
    const soltar = () => {
        const g = drag.current; drag.current = null; dragging.current = false;
        alArrastrarRef.current?.(null);
        if (!g) return;
        const v = performance.now() - g.t > 80 ? 0 : clamp(g.v, -14, 14);
        const s = knobs.current.step;
        const carry = 6 + (clamp(knobs.current.momentum, 0, 100) / 100) * 30;
        const land = Math.round((p.current.x + v * carry) / s) * s;
        goTo(land, v * 0.6);
    };
    const cancelar = () => { drag.current = null; dragging.current = false; alArrastrarRef.current?.(null); };
    if (mando) mando.current = { empezar: (x) => empezar(x), mover, soltar, cancelar };
    const onDown = (e: React.PointerEvent<HTMLDivElement>) => {
        try { e.currentTarget.setPointerCapture(e.pointerId); } catch { }
        empezar(e.clientX, e.currentTarget.getBoundingClientRect().width / e.currentTarget.offsetWidth || 1);
    };
    const onMove = (e: React.PointerEvent) => mover(e.clientX);
    const onUp = (e: React.PointerEvent<HTMLDivElement>) => {
        try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { }
        soltar();
    };

    useEffect(() => {
        const el = ruler.current; if (!el) return; let idle = 0;
        const wheel = (e: WheelEvent) => {
            if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
            e.preventDefault(); cancelAnimationFrame(raf.current); raf.current = 0;
            set(p.current.x + e.deltaX / pxRef.current);
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
        <div className="tms" data-tramos={tramos ? "" : undefined} style={{ "--tms-r": `${Math.max(0, corner)}px`, "--tms-fade": `${clamp(difuminado, 0, 45)}%`, width } as React.CSSProperties}>
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
                {/* El esfumado de los bordes va en esta ventana y no en la regla: una máscara recorta todo
                    lo que sale de la caja, y las marcas cuelgan por ARRIBA de la regla — quedaban
                    cortadas por la mitad. La ventana sube lo que cuelgan. */}
                <div className="tms-ventana">
                <div className="tms-track">
                    {/* La franja, de abajo hacia arriba: rojo donde se sabe que NO hay grabación, verde
                        corrido donde hay, y encima cada tramo con detección en su color. Plana, sin
                        bordes redondeados: los cortes se leen como cortes y no como píldoras sueltas. */}
                    {tramos && rangoTramos && (() => {
                        const x1 = Math.max(-HALF - 40, (rangoTramos[0] - pos) * PX), x2 = Math.min(HALF + 40, (rangoTramos[1] - pos) * PX);
                        return x2 > x1 ? <span className="tms-tramo" data-tono="sin" style={{ transform: `translateX(${x1.toFixed(2)}px)`, width: x2 - x1 }} /> : null;
                    })()}
                    {tramos?.map(([a, b], i) => {
                        const x1 = Math.max(-HALF - 40, (a - pos) * PX), x2 = Math.min(HALF + 40, (b - pos) * PX);
                        if (x2 <= x1) return null;
                        return <span key={`t${i}`} className="tms-tramo" style={{ transform: `translateX(${x1.toFixed(2)}px)`, width: Math.max(1, x2 - x1) }} />;
                    })}
                    {bandas?.map((k, i) => {
                        const x1 = Math.max(-HALF - 40, (k.a - pos) * PX), x2 = Math.min(HALF + 40, (k.b - pos) * PX);
                        if (x2 < -HALF - 40 || x1 > HALF + 40) return null;
                        return <span key={`b${i}`} className="tms-tramo" data-tono={k.tono} style={{ transform: `translateX(${x1.toFixed(2)}px)`, width: Math.max(3, x2 - x1) }} />;
                    })}
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
                .tms-ruler { position: relative; height: 56px; margin-top: 10px; cursor: grab; touch-action: pan-y; outline: none; }
                .tms-ventana { position: absolute; left: 0; right: 0; top: -18px; bottom: 0; mask-image: linear-gradient(90deg, transparent, #000 var(--tms-fade, 22%), #000 calc(100% - var(--tms-fade, 22%)), transparent); }
                .tms-ruler:active { cursor: grabbing; }
                .tms-ruler:focus-visible { box-shadow: inset 0 0 0 2px rgba(56,189,248,0.6); border-radius: 10px; }
                .tms-track { position: absolute; left: 50%; top: 18px; bottom: 0; }
                .tms-tick { position: absolute; left: -1px; top: 6px; width: 2px; height: 10px; border-radius: 1px; background: #fff; transform-origin: 50% 0; }
                .tms-tick[data-kind="quarter"] { height: 17px; }
                .tms-tick[data-kind="hour"] { height: 25px; }
                .tms-hour { position: absolute; left: 0; top: 36px; font-size: 11px; font-weight: 600; white-space: nowrap; color: rgba(255,255,255,0.6); }
                .tms-mark { position: absolute; left: 50%; top: 2px; width: 3px; height: 32px; margin-left: -1.5px; border-radius: 2px; background: #ef4444; box-shadow: 0 0 8px rgba(239,68,68,0.9); }
                /* Marcas de evento: colgadas del borde superior de la regla, sobre los ticks de su hora. */
                .tms-marcas { position: absolute; left: 50%; top: 4px; height: 22px; width: 0; }
                .tms-marca { position: absolute; left: 0; top: 0; width: 22px; height: 22px; border-radius: 999px; border: 1.5px solid rgba(255,255,255,0.85); display: grid; place-items: center; color: #fff; cursor: pointer; padding: 0; transform: translateX(var(--tx, 0px)) translateX(-50%); transition: box-shadow 120ms ease; touch-action: none; }
                .tms-marca[data-tono="mal"]   { background: #dc2626; box-shadow: 0 0 10px rgba(239,68,68,0.75); }
                .tms-marca[data-tono="aviso"] { background: #d97706; box-shadow: 0 0 10px rgba(245,158,11,0.7); }
                .tms-marca[data-tono="bien"]  { background: #059669; box-shadow: 0 0 10px rgba(16,185,129,0.7); }
                /* Con franja de grabación (añadido de OmniAccess), las marcas se apoyan SOBRE la franja
                   verde: el centro del ícono cae en la línea, como en la línea de tiempo de un NVR. */
                .tms[data-tramos] .tms-marcas { top: 10px; }
                .tms[data-tramos] .tms-tramo { height: 5px; top: 0; }
                .tms-tramo { position: absolute; left: 0; top: 0; height: 4px; background: var(--bien); }
                .tms-tramo[data-tono="sin"]     { background: color-mix(in oklab, var(--mal) 85%, transparent); }
                .tms-tramo[data-tono="aviso"]   { background: var(--aviso); }
                .tms-tramo[data-tono="info"]    { background: var(--accion-en-oscuro, #38bdf8); }
                .tms-tramo[data-tono="lectura"] { background: #fff; }
                .tms-tramo[data-tono="propio"]  { background: #c084fc; }
                .tms-marca[data-tono="info"]  { background: #0284c7; box-shadow: 0 0 10px rgba(56,189,248,0.7); }
                .tms-marca[data-tono="propio"] { background: #9333ea; box-shadow: 0 0 10px rgba(192,132,252,0.7); }
                /* Contexto: otros eventos de la misma cámara. Grises y sin brillo, para no competir con el evento. */
                .tms-marca[data-tono="quieto"] { background: #3f3f46; border-color: rgba(255,255,255,0.55); box-shadow: none; }
                .tms-marca:hover { transform: translateX(var(--tx, 0px)) translateX(-50%) scale(1.18); box-shadow: 0 0 16px rgba(255,255,255,0.55); }
                .tms-marca-n { position: absolute; top: -7px; right: -7px; min-width: 15px; height: 15px; padding: 0 4px; border-radius: 999px; background: #fff; color: #991b1b; font-size: 9px; font-weight: 800; line-height: 15px; text-align: center; font-variant-numeric: tabular-nums; }
                @keyframes tms-blur-a { from { filter: blur(2px); } to { filter: blur(0); } }
                @keyframes tms-blur-b { from { filter: blur(2px); } to { filter: blur(0); } }
            `}</style>
        </div>
    );
}
