"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Check, Undo2, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * El lienzo del calibrador: dibujar y ajustar líneas, polígonos y rectángulos sobre la escena,
 * uno solo para todos los módulos (imagen, lectura, intrusión) (26/11).
 *
 * Nico: «mejorá la usabilidad cuando dibuja carriles, líneas y zonas, más premium». Antes cada
 * calibrador tenía su manera de dibujar —uno arrastraba, otro tocaba vértices, otro abría un
 * editor aparte sobre una foto— y ninguna dejaba corregir bien. Acá, la misma para todo:
 *
 *  · Crear: un polígono se toca vértice por vértice, con la goma elástica hasta el cursor; se
 *    cierra tocando el primero (que se ilumina al acercarse), con doble clic o con Enter.
 *    Backspace saca el último, Esc cancela. Una línea: dos toques (o arrastrar). Un rectángulo:
 *    arrastrar.
 *  · Ajustar lo elegido: arrastrar un vértice, arrastrar la figura entera, el «+» de la mitad de
 *    cada lado agrega un vértice, doble clic en un vértice lo saca. Supr borra la figura.
 *  · Los bordes del cuadro imantan, y mientras se arrastra aparece una lupa con la foto ampliada:
 *    poner un vértice justo en el cordón ya no es a ojo.
 *
 * Coordenadas: fracciones 0..1 del cuadro, origen arriba-izquierda. El SVG se dibuja en píxeles
 * reales de la capa (no con viewBox estirado) para que los círculos sean círculos y el texto se lea.
 */
export type Pt = { x: number; y: number };
export type Forma = {
    id: string; tipo: "poligono" | "linea" | "rect";
    /** rect: [arriba-izquierda, abajo-derecha]. */
    puntos: Pt[];
    color: string; etiqueta?: string;
    /** Dibujada pero apagada: se ve punteada. */
    apagada?: boolean;
    /** Sólo de referencia: no se elige ni se mueve (la zona del calibrador viejo, una guía). */
    bloqueada?: boolean;
    /** Un carril: la flecha de hacia dónde va el auto, con sus dos puntas arrastrables. */
    flecha?: { a: Pt; b: Pt } | null;
    /** Una línea con sentido: «ab» cruza hacia la derecha de A→B (la flecha lo muestra). */
    sentido?: "ab" | "ba" | "ambos";
    maxPuntos?: number;
};
export type Herramienta = { tipo: "poligono" | "linea" | "rect"; color: string; nombre: string; max?: number } | null;

const IMAN = 0.012;
const iman = (v: number) => (v < IMAN ? 0 : v > 1 - IMAN ? 1 : v);
const lim = (v: number) => Math.min(1, Math.max(0, v));

type Arrastre =
    | { tipo: "vertice"; id: string; i: number }
    | { tipo: "flecha"; id: string; punta: "a" | "b" }
    | { tipo: "figura"; id: string; desde: Pt; original: Pt[]; flecha: { a: Pt; b: Pt } | null }
    | { tipo: "creando-rect"; desde: Pt }
    | { tipo: "creando-linea"; desde: Pt };

export function Lienzo({ formas, seleccion, herramienta, lupa, alSeleccionar, alCambiar, alCrear, alCancelar, alBorrar }: {
    formas: Forma[]; seleccion: string | null; herramienta: Herramienta; lupa?: string | null;
    alSeleccionar: (id: string | null) => void;
    alCambiar: (id: string, cambio: { puntos?: Pt[]; flecha?: { a: Pt; b: Pt } | null }) => void;
    alCrear: (tipo: "poligono" | "linea" | "rect", puntos: Pt[]) => void;
    alCancelar: () => void;
    alBorrar?: (id: string) => void;
}) {
    const capa = useRef<HTMLDivElement>(null);
    const [tam, setTam] = useState({ w: 0, h: 0 });
    const [borrador, setBorrador] = useState<Pt[]>([]);
    const [cursor, setCursor] = useState<Pt | null>(null);
    const [arr, setArr] = useState<Arrastre | null>(null);
    const [hover, setHover] = useState<string | null>(null);

    useLayoutEffect(() => {
        const el = capa.current; if (!el) return;
        const medir = () => { const r = el.getBoundingClientRect(); setTam({ w: r.width, h: r.height }); };
        medir();
        const ro = new ResizeObserver(medir); ro.observe(el);
        return () => ro.disconnect();
    }, []);
    // Cambiar de herramienta tira lo que se estaba dibujando.
    useEffect(() => { const t = setTimeout(() => setBorrador([]), 0); return () => clearTimeout(t); }, [herramienta?.tipo, herramienta?.nombre]);

    const W = tam.w || 1, H = tam.h || 1;
    const px = (p: Pt) => ({ x: p.x * W, y: p.y * H });
    const punto = useCallback((e: { clientX: number; clientY: number }): Pt => {
        const r = capa.current!.getBoundingClientRect();
        return { x: iman(lim((e.clientX - r.left) / r.width)), y: iman(lim((e.clientY - r.top) / r.height)) };
    }, []);
    const cercaPx = (a: Pt, b: Pt, d = 12) => Math.hypot((a.x - b.x) * W, (a.y - b.y) * H) < d;

    const terminar = useCallback((pts?: Pt[]) => {
        const p = pts || borrador;
        if (!herramienta) return;
        if (herramienta.tipo === "poligono" && p.length >= 3) { alCrear("poligono", p); setBorrador([]); }
    }, [borrador, herramienta, alCrear]);

    // Teclado: Enter cierra, Backspace saca el último punto, Esc cancela, Supr borra lo elegido.
    useEffect(() => {
        const k = (e: KeyboardEvent) => {
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
            if (herramienta) {
                if (e.key === "Escape") { e.stopImmediatePropagation(); if (borrador.length) setBorrador([]); else alCancelar(); }
                if (e.key === "Enter") { e.preventDefault(); terminar(); }
                if (e.key === "Backspace" && borrador.length) { e.preventDefault(); setBorrador((b) => b.slice(0, -1)); }
                return;
            }
            if ((e.key === "Delete" || e.key === "Backspace") && seleccion && alBorrar) {
                const f = formas.find((x) => x.id === seleccion);
                if (f && !f.bloqueada) { e.preventDefault(); alBorrar(seleccion); }
            }
            if (e.key === "Escape" && seleccion) { e.stopImmediatePropagation(); alSeleccionar(null); }
        };
        window.addEventListener("keydown", k, true);
        return () => window.removeEventListener("keydown", k, true);
    }, [herramienta, borrador, seleccion, formas, alBorrar, alCancelar, alSeleccionar, terminar]);

    // ── Puntero ──
    const bajar = (e: React.PointerEvent) => {
        if (e.button !== 0) return;
        const p = punto(e);
        if (herramienta) {
            (e.target as Element).setPointerCapture?.(e.pointerId);
            if (herramienta.tipo === "rect") { setArr({ tipo: "creando-rect", desde: p }); setBorrador([p, p]); return; }
            if (herramienta.tipo === "linea") {
                if (borrador.length === 1) { alCrear("linea", [borrador[0], p]); setBorrador([]); return; }
                setArr({ tipo: "creando-linea", desde: p }); setBorrador([p]); return;
            }
            // Polígono: tocar cerca del primero cierra.
            if (borrador.length >= 3 && cercaPx(p, borrador[0], 14)) { terminar(); return; }
            if (herramienta.max && borrador.length >= herramienta.max) return;
            setBorrador((b) => [...b, p]);
            return;
        }
        alSeleccionar(null);
    };
    const mover = (e: React.PointerEvent) => {
        const p = punto(e);
        setCursor(p);
        if (!arr) return;
        if (arr.tipo === "creando-rect") { setBorrador([arr.desde, p]); return; }
        if (arr.tipo === "creando-linea") { setBorrador([arr.desde, p]); return; }
        const f = formas.find((x) => x.id === arr.id); if (!f) return;
        if (arr.tipo === "vertice") { const pts = f.puntos.slice(); pts[arr.i] = p; alCambiar(f.id, { puntos: pts }); return; }
        if (arr.tipo === "flecha" && f.flecha) { alCambiar(f.id, { flecha: { ...f.flecha, [arr.punta]: p } }); return; }
        if (arr.tipo === "figura") {
            // Mover entera sin que se salga del cuadro.
            let dx = p.x - arr.desde.x, dy = p.y - arr.desde.y;
            const xs = arr.original.map((q) => q.x), ys = arr.original.map((q) => q.y);
            dx = Math.max(-Math.min(...xs), Math.min(1 - Math.max(...xs), dx)); dy = Math.max(-Math.min(...ys), Math.min(1 - Math.max(...ys), dy));
            const mv = (q: Pt) => ({ x: q.x + dx, y: q.y + dy });
            alCambiar(f.id, { puntos: arr.original.map(mv), ...(arr.flecha ? { flecha: { a: mv(arr.flecha.a), b: mv(arr.flecha.b) } } : {}) });
        }
    };
    const soltar = (e: React.PointerEvent) => {
        if (!arr) return;
        const p = punto(e);
        if (arr.tipo === "creando-rect") {
            const a = arr.desde;
            if (Math.abs(p.x - a.x) > 0.02 && Math.abs(p.y - a.y) > 0.02) alCrear("rect", [{ x: Math.min(a.x, p.x), y: Math.min(a.y, p.y) }, { x: Math.max(a.x, p.x), y: Math.max(a.y, p.y) }]);
            setBorrador([]);
        } else if (arr.tipo === "creando-linea") {
            // Arrastrar también crea: si se soltó lejos, la línea queda hecha; si fue un toque, espera el punto B.
            if (!cercaPx(p, arr.desde, 10)) { alCrear("linea", [arr.desde, p]); setBorrador([]); }
        }
        setArr(null);
    };
    const dobleClic = (e: React.MouseEvent) => {
        if (herramienta?.tipo === "poligono" && borrador.length >= 3) { e.preventDefault(); terminar(); }
    };

    const agarrar = (a: Arrastre) => (e: React.PointerEvent) => {
        if (herramienta || e.button !== 0) return;
        e.stopPropagation();
        (e.target as Element).setPointerCapture?.(e.pointerId);
        setArr(a);
    };
    const elegir = (f: Forma) => (e: React.PointerEvent) => {
        if (herramienta || f.bloqueada || e.button !== 0) return;
        e.stopPropagation();
        alSeleccionar(f.id);
        (e.target as Element).setPointerCapture?.(e.pointerId);
        setArr({ tipo: "figura", id: f.id, desde: punto(e), original: f.puntos.map((q) => ({ ...q })), flecha: f.flecha ? { a: { ...f.flecha.a }, b: { ...f.flecha.b } } : null });
    };

    const verticesDe = (f: Forma): Pt[] => (f.tipo === "rect" ? [f.puntos[0], { x: f.puntos[1].x, y: f.puntos[0].y }, f.puntos[1], { x: f.puntos[0].x, y: f.puntos[1].y }] : f.puntos);
    const ptsAttr = (ps: Pt[]) => ps.map(px).map((q) => `${q.x},${q.y}`).join(" ");
    const centro = (ps: Pt[]) => px({ x: ps.reduce((a, q) => a + q.x, 0) / ps.length, y: ps.reduce((a, q) => a + q.y, 0) / ps.length });

    const dibujarForma = (f: Forma) => {
        const sel = seleccion === f.id, hov = hover === f.id && !sel;
        const vs = verticesDe(f);
        const trazo = sel ? 3 : hov ? 2.6 : 2;
        const guion = f.apagada || f.bloqueada ? "7 5" : undefined;
        const c = centro(vs);
        return (
            <g key={f.id} onPointerEnter={() => setHover(f.id)} onPointerLeave={() => setHover((h) => (h === f.id ? null : h))}
                style={{ cursor: herramienta ? "crosshair" : f.bloqueada ? "default" : sel ? "move" : "pointer", pointerEvents: f.bloqueada ? "none" : undefined }}>
                {f.tipo === "linea" ? (<>
                    {/* La línea tiene un área de toque más ancha que su trazo: se agarra sin puntería. */}
                    <line x1={px(f.puntos[0]).x} y1={px(f.puntos[0]).y} x2={px(f.puntos[1]).x} y2={px(f.puntos[1]).y} stroke="transparent" strokeWidth={18} onPointerDown={elegir(f)} />
                    <line x1={px(f.puntos[0]).x} y1={px(f.puntos[0]).y} x2={px(f.puntos[1]).x} y2={px(f.puntos[1]).y} stroke={f.color} strokeWidth={trazo + 1} strokeDasharray={guion} strokeLinecap="round" style={{ filter: sel ? `drop-shadow(0 0 6px ${f.color})` : undefined, pointerEvents: "none" }} />
                    {f.sentido && <FlechaSentido a={px(f.puntos[0])} b={px(f.puntos[1])} sentido={f.sentido} color={f.color} />}
                    {(["A", "B"] as const).map((t, i) => { const q = px(f.puntos[i]); return <text key={t} x={q.x} y={q.y - 12} textAnchor="middle" fontSize={12} fontWeight={800} fill={f.color} stroke="#000" strokeWidth={3} paintOrder="stroke" style={{ pointerEvents: "none" }}>{t}</text>; })}
                </>) : (
                    <polygon points={ptsAttr(vs)} fill={f.color} fillOpacity={f.bloqueada ? 0.04 : sel ? 0.22 : hov ? 0.17 : 0.12} stroke={f.color} strokeWidth={trazo} strokeDasharray={guion} strokeLinejoin="round"
                        onPointerDown={elegir(f)} style={{ filter: sel ? `drop-shadow(0 0 6px ${f.color}aa)` : undefined }} />
                )}
                {f.flecha && <FlechaCarril a={px(f.flecha.a)} b={px(f.flecha.b)} color={f.color} />}
                {f.etiqueta && f.tipo !== "linea" && (
                    <g style={{ pointerEvents: "none" }} transform={f.tipo === "rect" ? `translate(${px(f.puntos[0]).x + f.etiqueta.length * 3.6 + 16},${px(f.puntos[0]).y + 18})` : `translate(${c.x},${c.y})`}>
                        <rect x={-(f.etiqueta.length * 3.6 + 9)} y={-10} width={f.etiqueta.length * 7.2 + 18} height={20} rx={10} fill="rgba(0,0,0,0.62)" stroke={f.color} strokeOpacity={0.6} />
                        <text textAnchor="middle" y={4} fontSize={11.5} fontWeight={700} fill="#fff">{f.etiqueta}</text>
                    </g>
                )}
                {/* El nombre de una línea, en una píldora a un cuarto del camino: en la mitad está la flecha del sentido. */}
                {f.etiqueta && f.tipo === "linea" && (() => { const m = px({ x: f.puntos[0].x * 0.72 + f.puntos[1].x * 0.28, y: f.puntos[0].y * 0.72 + f.puntos[1].y * 0.28 }); const ancho = f.etiqueta.length * 7.2 + 18; return (
                    <g style={{ pointerEvents: "none" }} transform={`translate(${m.x},${m.y - 18})`}>
                        <rect x={-ancho / 2} y={-10} width={ancho} height={20} rx={10} fill="rgba(0,0,0,0.62)" stroke={f.color} strokeOpacity={0.6} />
                        <text textAnchor="middle" y={4} fontSize={11.5} fontWeight={700} fill="#fff">{f.etiqueta}</text>
                    </g>); })()}

                {/* Lo elegido: vértices, «+» para agregar uno y las puntas de la flecha. */}
                {sel && !herramienta && (<>
                    {f.tipo === "poligono" && vs.map((a, i) => {
                        const b = vs[(i + 1) % vs.length]; const m = px({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
                        if (f.maxPuntos && vs.length >= f.maxPuntos) return null;
                        return (
                            <g key={`m${i}`} className="cursor-copy" onPointerDown={(e) => { e.stopPropagation(); const pts = f.puntos.slice(); pts.splice(i + 1, 0, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }); alCambiar(f.id, { puntos: pts }); (e.target as Element).setPointerCapture?.(e.pointerId); setArr({ tipo: "vertice", id: f.id, i: i + 1 }); }}>
                                <circle cx={m.x} cy={m.y} r={7} fill="rgba(0,0,0,0.55)" stroke={f.color} strokeWidth={1.5} />
                                <path d={`M${m.x - 3.2},${m.y} h6.4 M${m.x},${m.y - 3.2} v6.4`} stroke="#fff" strokeWidth={1.6} strokeLinecap="round" />
                            </g>
                        );
                    })}
                    {(f.tipo === "rect" ? [f.puntos[0], f.puntos[1]] : f.puntos).map((q, i) => {
                        const v = px(q);
                        return <circle key={`v${i}`} cx={v.x} cy={v.y} r={7.5} fill="#fff" stroke={f.color} strokeWidth={3} className="cursor-grab active:cursor-grabbing"
                            onPointerDown={agarrar({ tipo: "vertice", id: f.id, i })}
                            onDoubleClick={(e) => { e.stopPropagation(); if (f.tipo === "poligono" && f.puntos.length > 3) alCambiar(f.id, { puntos: f.puntos.filter((_, k) => k !== i) }); }} />;
                    })}
                    {f.flecha && (["a", "b"] as const).map((k) => { const v = px(f.flecha![k]); return <circle key={k} cx={v.x} cy={v.y} r={6} fill={f.color} stroke="#fff" strokeWidth={2.5} className="cursor-grab" onPointerDown={agarrar({ tipo: "flecha", id: f.id, punta: k })} />; })}
                </>)}
            </g>
        );
    };

    // Lo que se está dibujando: la goma elástica hasta el cursor y el primer punto que imanta.
    const cerrable = herramienta?.tipo === "poligono" && borrador.length >= 3 && cursor && cercaPx(cursor, borrador[0], 14);
    const enCurso = herramienta && borrador.length > 0 && (() => {
        const col = herramienta.color;
        if (herramienta.tipo === "rect" && borrador.length === 2) {
            const [a, b] = borrador.map(px);
            return <rect x={Math.min(a.x, b.x)} y={Math.min(a.y, b.y)} width={Math.abs(b.x - a.x)} height={Math.abs(b.y - a.y)} fill={col} fillOpacity={0.14} stroke={col} strokeWidth={2} strokeDasharray="6 4" />;
        }
        const pts = [...borrador, ...(cursor && !(herramienta.tipo === "linea" && borrador.length === 2) ? [cerrable ? borrador[0] : cursor] : [])];
        return (<g style={{ pointerEvents: "none" }}>
            {herramienta.tipo === "poligono" && borrador.length >= 2 && <polygon points={ptsAttr(pts)} fill={col} fillOpacity={0.1} stroke="none" />}
            <polyline points={ptsAttr(pts)} fill="none" stroke={col} strokeWidth={2.2} strokeDasharray="7 5" strokeLinecap="round" />
            {borrador.map((q, i) => { const v = px(q); return <circle key={i} cx={v.x} cy={v.y} r={i === 0 && herramienta.tipo === "poligono" ? (cerrable ? 10 : 7.5) : 5.5} fill={i === 0 ? (cerrable ? col : "#fff") : col} stroke={i === 0 ? col : "#fff"} strokeWidth={2} />; })}
        </g>);
    })();

    const mostrarLupa = !!lupa && !!cursor && (!!arr || (!!herramienta && herramienta.tipo !== "rect"));
    const pasos = !herramienta ? null
        : herramienta.tipo === "linea" ? (borrador.length ? "Tocá el punto B (o soltá donde termina)" : "Tocá el punto A, o arrastrá la línea entera")
            : herramienta.tipo === "rect" ? "Arrastrá el rectángulo"
                : borrador.length < 3 ? `Tocá los vértices · ${borrador.length} de 3 como mínimo` : cerrable ? "Soltá: cierra la figura" : "Tocá el primer punto, doble clic o Enter para cerrar";

    return (
        <div ref={capa} className={cn("absolute inset-0 touch-none select-none", herramienta ? "cursor-crosshair" : "cursor-default")}
            onPointerDown={bajar} onPointerMove={mover} onPointerUp={soltar} onPointerLeave={() => { setCursor(null); }} onDoubleClick={dobleClic}>
            <svg width={W} height={H} className="absolute inset-0 overflow-visible">
                <defs>
                    <filter id="lienzo-sombra" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="1" stdDeviation="1.2" floodOpacity="0.6" /></filter>
                </defs>
                {formas.filter((f) => f.id !== seleccion).map(dibujarForma)}
                {formas.filter((f) => f.id === seleccion).map(dibujarForma)}
                {enCurso}
                {/* La mira: dos líneas finas que cruzan el cuadro mientras se dibuja. */}
                {herramienta && cursor && (
                    <g style={{ pointerEvents: "none" }} opacity={0.35}>
                        <line x1={0} y1={cursor.y * H} x2={W} y2={cursor.y * H} stroke="#fff" strokeWidth={0.75} strokeDasharray="3 4" />
                        <line x1={cursor.x * W} y1={0} x2={cursor.x * W} y2={H} stroke="#fff" strokeWidth={0.75} strokeDasharray="3 4" />
                    </g>
                )}
            </svg>

            {mostrarLupa && cursor && (
                <div className="pointer-events-none absolute z-20 h-[132px] w-[132px] overflow-hidden rounded-full ring-2 ring-white/80 shadow-[0_8px_30px_rgba(0,0,0,0.6)]"
                    style={{
                        left: Math.min(W - 140, Math.max(8, cursor.x * W + 24)), top: Math.max(8, cursor.y * H - 156),
                        backgroundImage: `url("${lupa}")`, backgroundRepeat: "no-repeat",
                        backgroundSize: `${W * 3}px ${H * 3}px`, backgroundPosition: `${-(cursor.x * W * 3 - 66)}px ${-(cursor.y * H * 3 - 66)}px`,
                    }}>
                    <span className="absolute left-1/2 top-1/2 h-3 w-px -translate-x-1/2 -translate-y-1/2 bg-white" />
                    <span className="absolute left-1/2 top-1/2 h-px w-3 -translate-x-1/2 -translate-y-1/2 bg-white" />
                    <span className="absolute bottom-1.5 left-1/2 -translate-x-1/2 rounded-full bg-black/60 px-1.5 text-[9px] font-semibold tabular-nums text-white">{Math.round(cursor.x * 100)} · {Math.round(cursor.y * 100)}</span>
                </div>
            )}

            {herramienta && pasos && (
                <div className="absolute left-1/2 top-3 z-20 -translate-x-1/2" onPointerDown={(e) => e.stopPropagation()}>
                    <div className="flex items-center gap-2 whitespace-nowrap rounded-full bg-black/75 px-3 py-1.5 text-[12px] font-semibold text-white ring-1 ring-white/15 backdrop-blur-md">
                        <span className="h-2 w-2 rounded-full" style={{ background: herramienta.color }} />
                        <span className="text-white/60">{herramienta.nombre}</span>
                        <span>{pasos}</span>
                        {herramienta.tipo === "poligono" && borrador.length >= 3 && <button onClick={() => terminar()} className="inline-flex h-6 items-center gap-1 rounded-full bg-white px-2 text-[11px] font-bold text-black"><Check size={11} /> Cerrar</button>}
                        {borrador.length > 0 && herramienta.tipo === "poligono" && <button onClick={() => setBorrador((b) => b.slice(0, -1))} title="Sacar el último punto (Backspace)" className="grid h-6 w-6 place-items-center rounded-full bg-white/15 hover:bg-white/25"><Undo2 size={11} /></button>}
                        <button onClick={() => { setBorrador([]); alCancelar(); }} title="Cancelar (Esc)" className="grid h-6 w-6 place-items-center rounded-full bg-white/15 hover:bg-white/25"><X size={11} /></button>
                    </div>
                </div>
            )}
        </div>
    );
}

/** La flecha de un carril: hacia dónde va el auto. */
function FlechaCarril({ a, b, color }: { a: Pt; b: Pt; color: string }) {
    const ang = Math.atan2(b.y - a.y, b.x - a.x), L = 13;
    const p1 = { x: b.x - L * Math.cos(ang - 0.45), y: b.y - L * Math.sin(ang - 0.45) }, p2 = { x: b.x - L * Math.cos(ang + 0.45), y: b.y - L * Math.sin(ang + 0.45) };
    return (
        <g style={{ pointerEvents: "none" }} filter="url(#lienzo-sombra)">
            <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={color} strokeWidth={4} strokeLinecap="round" />
            <polygon points={`${b.x},${b.y} ${p1.x},${p1.y} ${p2.x},${p2.y}`} fill={color} />
        </g>
    );
}

/** El sentido de una línea de cruce: una flecha perpendicular por la mitad (doble si «ambos»). */
function FlechaSentido({ a, b, sentido, color }: { a: Pt; b: Pt; sentido: "ab" | "ba" | "ambos"; color: string }) {
    const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const largo = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const nx = -(b.y - a.y) / largo, ny = (b.x - a.x) / largo, L = 30;
    const una = (s: 1 | -1) => {
        const t = { x: m.x + nx * L * s, y: m.y + ny * L * s }, ang = Math.atan2(t.y - m.y, t.x - m.x), k = 9;
        return (
            <g key={s}>
                <line x1={m.x} y1={m.y} x2={t.x} y2={t.y} stroke="#fff" strokeWidth={2.5} strokeLinecap="round" />
                <polygon points={`${t.x},${t.y} ${t.x - k * Math.cos(ang - 0.5)},${t.y - k * Math.sin(ang - 0.5)} ${t.x - k * Math.cos(ang + 0.5)},${t.y - k * Math.sin(ang + 0.5)}`} fill="#fff" />
            </g>
        );
    };
    return <g style={{ pointerEvents: "none" }} filter="url(#lienzo-sombra)"><circle cx={m.x} cy={m.y} r={3.5} fill={color} />{(sentido === "ab" || sentido === "ambos") && una(1)}{(sentido === "ba" || sentido === "ambos") && una(-1)}</g>;
}
