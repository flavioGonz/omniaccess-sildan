"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { sileo as toast } from "sileo";
import { X, Save, RotateCcw, Route, Square, Minus, Trash2, ArrowUpDown, RefreshCw, Eye, EyeOff, Info, Check, Undo2 } from "lucide-react";
import { Girando as Loader2 } from "@/components/brand/CargaOmni";
import { cn } from "@/lib/utils";

/**
 * Carriles, zonas de captura y líneas de cruce para la lectura de OmniVision (26/11).
 *
 * Nico: «para las cámaras que leen con OmniVision el calibrador no deja dibujar líneas A-B y B-A
 * ni carriles; toma toda la imagen como válida. Tiene que dejarme dibujar líneas o zonas de
 * captura para bajar el rebote de lecturas, más premium que las de Hik: carriles, dirección del
 * auto, zonas de captura o línea de cruce vehicular. Algo nuevo, sin afectar lo actual».
 *
 * Lo que decide cada elemento lo explica lib-geometria-lpr.js (lo usa el worker). Acá se dibuja
 * sobre una foto de la cámara —no sobre el video: con el video «contain» los bordes negros
 * corrían los puntos— y debajo, como guía, dónde cayeron las chapas leídas en las últimas 48 h:
 * los carriles se dibujan encima de donde de verdad pasan los autos.
 *
 * Coordenadas: fracciones 0..1 del cuadro entero, origen arriba-izquierda; el SVG usa 0..1000.
 */

type P = { x: number; y: number };
type SentidoCarril = "entra" | "sale" | "ambos";
type SentidoLinea = "ab" | "ba" | "ambos";
type Carril = { id: string; nombre: string; puntos: P[]; sentido: SentidoCarril; flecha: { a: P; b: P } | null };
type Zona = { id: string; nombre: string; puntos: P[] };
type Linea = { id: string; nombre: string; a: P; b: P; sentido: SentidoLinea };
type Geo = { v: 1; activa: boolean; rebote: number; carriles: Carril[]; zonas: Zona[]; lineas: Linea[] };
type Herramienta = "carril" | "zona" | "linea" | null;
type Sel = { tipo: "carril" | "zona" | "linea"; id: string } | null;
type Arrastre = { tipo: "carril" | "zona" | "linea" | "flecha"; id: string; i: number } | null;

const COLOR = { entra: "#34d399", sale: "#fb923c", ambos: "#38bdf8", zona: "#facc15", linea: "#f87171" } as const;
const S = (p: P) => ({ x: p.x * 1000, y: p.y * 1000 });
const nuevaId = (pre: string) => `${pre}${Math.random().toString(36).slice(2, 7)}`;
const centroide = (ps: P[]) => ({ x: ps.reduce((a, p) => a + p.x, 0) / ps.length, y: ps.reduce((a, p) => a + p.y, 0) / ps.length });
/** La flecha por defecto de un carril: vertical por su centro, hacia arriba (el auto se aleja de la cámara). */
const flechaPorDefecto = (ps: P[]) => { const c = centroide(ps); const ys = ps.map((p) => p.y); const alto = (Math.max(...ys) - Math.min(...ys)) * 0.35; return { a: { x: c.x, y: Math.min(1, c.y + alto) }, b: { x: c.x, y: Math.max(0, c.y - alto) } }; };

const AYUDA = {
    carril: "Un polígono sobre una mano de la calle, con su flecha. «Entra» o «Sale» además dicen el sentido del evento: una sola cámara separa la entrada de la salida. Un auto que va al revés de la flecha no se lee como de ese carril.",
    zona: "Un polígono de captura: sólo cuentan las chapas que caen adentro. Sin sentido: sirve para recortar la vereda, el estacionamiento o la calle de al lado.",
    linea: "Una línea que el auto cruza. Con sentido (A→B o B→A) sólo cuenta el cruce en esa dirección; la flecha del medio muestra hacia dónde. Cuenta lo que pasa cerca de la línea.",
    rebote: "La misma chapa en el mismo carril, zona o línea dentro de estos segundos se descarta: es el mismo auto leído en dos ráfagas seguidas.",
};

export function GeometriaLectura({ deviceId, nombre, onCerrar }: { deviceId: string; nombre: string; onCerrar: () => void }) {
    const [geo, setGeo] = useState<Geo | null>(null);
    const [original, setOriginal] = useState<string>("");
    const [guia, setGuia] = useState<{ roi: { x: number; y: number; w: number; h: number } | null; linea: { x1: number; y1: number; x2: number; y2: number } | null; puntos: { x: number; y: number; quieto: boolean }[] }>({ roi: null, linea: null, puntos: [] });
    const [cargando, setCargando] = useState(true);
    const [guardando, setGuardando] = useState(false);
    const [herr, setHerr] = useState<Herramienta>(null);
    const [borrador, setBorrador] = useState<P[]>([]);
    const [sel, setSel] = useState<Sel>(null);
    const [verPuntos, setVerPuntos] = useState(true);
    const [foto, setFoto] = useState(0);
    const svgRef = useRef<SVGSVGElement>(null);
    const arrastre = useRef<Arrastre>(null);

    const cargar = useCallback(async () => {
        setCargando(true);
        try {
            const j = await fetch(`/api/devices/lpr-geometria?deviceId=${encodeURIComponent(deviceId)}`, { cache: "no-store" }).then((r) => r.json());
            if (!j?.ok) { toast.error({ title: "No se pudo leer la geometría", description: j?.error }); return; }
            setGeo(j.geometria); setOriginal(JSON.stringify(j.geometria));
            setGuia({ roi: j.roi || null, linea: j.linea || null, puntos: j.puntos || [] });
            setSel(null); setHerr(null); setBorrador([]);
        } catch { toast.error({ title: "No se pudo leer la geometría", description: "Sin conexión con el servidor." }); }
        finally { setCargando(false); }
    }, [deviceId]);
    useEffect(() => { const t = setTimeout(cargar, 0); return () => clearTimeout(t); }, [cargar]);

    const cambiado = !!geo && JSON.stringify(geo) !== original;
    const cambiar = (f: (g: Geo) => Geo) => setGeo((g) => (g ? f(structuredClone(g)) : g));

    const punto = (e: React.PointerEvent | PointerEvent): P => {
        const r = svgRef.current!.getBoundingClientRect();
        return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
    };

    const terminar = useCallback((ps?: P[]) => {
        const pts = ps || borrador;
        if (!herr || !geo) return;
        if (herr === "linea" && pts.length >= 2) {
            const l: Linea = { id: nuevaId("l"), nombre: `Línea ${geo.lineas.length + 1}`, a: pts[0], b: pts[1], sentido: "ab" };
            cambiar((g) => ({ ...g, lineas: [...g.lineas, l] })); setSel({ tipo: "linea", id: l.id });
        } else if (herr === "carril" && pts.length >= 3) {
            const c: Carril = { id: nuevaId("c"), nombre: `Carril ${geo.carriles.length + 1}`, puntos: pts, sentido: "entra", flecha: flechaPorDefecto(pts) };
            cambiar((g) => ({ ...g, carriles: [...g.carriles, c] })); setSel({ tipo: "carril", id: c.id });
        } else if (herr === "zona" && pts.length >= 3) {
            const z: Zona = { id: nuevaId("z"), nombre: `Zona ${geo.zonas.length + 1}`, puntos: pts };
            cambiar((g) => ({ ...g, zonas: [...g.zonas, z] })); setSel({ tipo: "zona", id: z.id });
        } else return;
        setBorrador([]); setHerr(null);
    }, [borrador, herr, geo]);

    useEffect(() => {
        const k = (e: KeyboardEvent) => {
            if (e.key === "Escape" && (herr || borrador.length)) { e.stopImmediatePropagation(); setHerr(null); setBorrador([]); }
            if (e.key === "Enter" && herr && herr !== "linea") terminar();
            if ((e.key === "Delete" || e.key === "Backspace") && sel && !herr && !(e.target instanceof HTMLInputElement)) borrar(sel);
        };
        window.addEventListener("keydown", k, true);
        return () => window.removeEventListener("keydown", k, true);
    });

    const alTocar = (e: React.PointerEvent) => {
        if (!herr) { setSel(null); return; }
        const p = punto(e);
        if (herr === "linea") {
            const n = [...borrador, p];
            if (n.length >= 2) terminar(n); else setBorrador(n);
            return;
        }
        // Tocar cerca del primer punto cierra la figura.
        if (borrador.length >= 3 && Math.hypot(p.x - borrador[0].x, p.y - borrador[0].y) < 0.025) { terminar(); return; }
        setBorrador([...borrador, p]);
    };
    const alMover = (e: React.PointerEvent) => {
        const a = arrastre.current; if (!a) return;
        const p = punto(e);
        cambiar((g) => {
            if (a.tipo === "carril") { const c = g.carriles.find((x) => x.id === a.id); if (c) c.puntos[a.i] = p; }
            if (a.tipo === "flecha") { const c = g.carriles.find((x) => x.id === a.id); if (c?.flecha) c.flecha[a.i === 0 ? "a" : "b"] = p; }
            if (a.tipo === "zona") { const z = g.zonas.find((x) => x.id === a.id); if (z) z.puntos[a.i] = p; }
            if (a.tipo === "linea") { const l = g.lineas.find((x) => x.id === a.id); if (l) l[a.i === 0 ? "a" : "b"] = p; }
            return g;
        });
    };
    const agarrar = (a: NonNullable<Arrastre>) => (e: React.PointerEvent) => { e.stopPropagation(); arrastre.current = a; (e.target as Element).setPointerCapture?.(e.pointerId); };

    const borrar = (s: NonNullable<Sel>) => {
        cambiar((g) => ({ ...g, carriles: s.tipo === "carril" ? g.carriles.filter((x) => x.id !== s.id) : g.carriles, zonas: s.tipo === "zona" ? g.zonas.filter((x) => x.id !== s.id) : g.zonas, lineas: s.tipo === "linea" ? g.lineas.filter((x) => x.id !== s.id) : g.lineas }));
        setSel(null);
    };

    const guardar = async () => {
        if (!geo) return;
        setGuardando(true);
        try {
            const j = await fetch(`/api/devices/lpr-geometria?deviceId=${encodeURIComponent(deviceId)}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ geometria: geo }) }).then((r) => r.json());
            if (!j?.ok) { toast.error({ title: "No se guardó", description: j?.error }); return; }
            setGeo(j.geometria); setOriginal(JSON.stringify(j.geometria));
            const n = j.geometria.carriles.length + j.geometria.zonas.length + j.geometria.lineas.length;
            toast.success({ title: n ? "Geometría guardada" : "Geometría quitada", description: n ? (j.geometria.activa ? "OmniVision la aplica en el próximo minuto." : "Quedó guardada pero apagada: sigue la compuerta de siempre.") : "Vuelve la zona o la línea del calibrador de lectura." });
        } catch { toast.error({ title: "No se guardó", description: "Sin conexión con el servidor." }); }
        finally { setGuardando(false); }
    };

    const total = geo ? geo.carriles.length + geo.zonas.length + geo.lineas.length : 0;
    const elegido = useMemo(() => {
        if (!geo || !sel) return null;
        return sel.tipo === "carril" ? geo.carriles.find((x) => x.id === sel.id) : sel.tipo === "zona" ? geo.zonas.find((x) => x.id === sel.id) : geo.lineas.find((x) => x.id === sel.id);
    }, [geo, sel]);

    return (
        <div className="absolute inset-0 z-30 bg-black/95 backdrop-blur-[2px] flex flex-col">
            <div className="flex items-center gap-3 px-4 py-2.5 border-b border-white/10">
                <Route size={16} className="text-emerald-300" />
                <div className="min-w-0">
                    <p className="text-xs font-bold uppercase tracking-wide text-white">Carriles y líneas de lectura</p>
                    <p className="text-[10.5px] text-white/50 truncate">{nombre} · OmniVision lee sólo lo que pasa por acá. Sin nada dibujado, sigue como siempre.</p>
                </div>
                <div className="ml-auto flex items-center gap-2">
                    <button onClick={cargar} disabled={cargando || !cambiado} className="h-8 px-3 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] text-white/80 text-[11px] font-semibold flex items-center gap-1.5 disabled:opacity-40"><RotateCcw size={13} /> Revertir</button>
                    <button onClick={onCerrar} className="h-8 px-3 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] text-white/80 text-[11px] font-semibold flex items-center gap-1.5"><X size={13} /> Cerrar</button>
                    <button onClick={guardar} disabled={!cambiado || guardando} className="h-8 px-4 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-black text-[11px] font-bold flex items-center gap-1.5 disabled:opacity-40">
                        {guardando ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Guardar
                    </button>
                </div>
            </div>

            <div className="flex-1 min-h-0 flex">
                {/* El lienzo: la foto de la cámara y lo dibujado encima. */}
                <div className="flex-1 min-w-0 flex items-center justify-center p-3 overflow-hidden">
                    <div className="relative inline-block">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={`/api/snapshot/${deviceId}?w=1280&t=${foto}`} alt="" draggable={false} className="block max-h-[62vh] max-w-full object-contain select-none pointer-events-none rounded-lg" />
                        <svg ref={svgRef} viewBox="0 0 1000 1000" preserveAspectRatio="none" className={cn("absolute inset-0 w-full h-full touch-none", herr ? "cursor-crosshair" : "cursor-default")}
                            onPointerDown={alTocar} onPointerMove={alMover} onPointerUp={() => (arrastre.current = null)} onPointerLeave={() => (arrastre.current = null)}>
                            <defs>
                                {Object.entries({ ...COLOR, blanco: "#ffffff" }).map(([k, c]) => (
                                    <marker key={k} id={`punta-${k}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill={c} /></marker>
                                ))}
                            </defs>
                            {/* Guía: la zona y la línea del calibrador de lectura (con lo que convive). */}
                            {guia.roi && guia.roi.w > 0 && (guia.roi.w < 1 || guia.roi.h < 1) && <rect x={guia.roi.x * 1000} y={guia.roi.y * 1000} width={guia.roi.w * 1000} height={guia.roi.h * 1000} fill="none" stroke="rgba(255,255,255,0.35)" strokeDasharray="6 6" vectorEffect="non-scaling-stroke" />}
                            {guia.linea && <line x1={guia.linea.x1 * 1000} y1={guia.linea.y1 * 1000} x2={guia.linea.x2 * 1000} y2={guia.linea.y2 * 1000} stroke="rgba(255,255,255,0.35)" strokeDasharray="6 6" strokeWidth={2} vectorEffect="non-scaling-stroke" />}
                            {/* Guía: dónde se leyeron chapas (48 h). */}
                            {verPuntos && guia.puntos.map((p, i) => <circle key={i} cx={p.x * 1000} cy={p.y * 1000} r={5} fill={p.quieto ? "rgba(255,255,255,0.25)" : "rgba(255,255,255,0.7)"} stroke="rgba(0,0,0,0.5)" strokeWidth={1} vectorEffect="non-scaling-stroke" />)}

                            {geo?.zonas.map((z) => {
                                const on = sel?.tipo === "zona" && sel.id === z.id;
                                return (
                                    <g key={z.id} onPointerDown={(e) => { if (herr) return; e.stopPropagation(); setSel({ tipo: "zona", id: z.id }); }}>
                                        <polygon points={z.puntos.map(S).map((p) => `${p.x},${p.y}`).join(" ")} fill={`${COLOR.zona}${on ? "33" : "1f"}`} stroke={COLOR.zona} strokeWidth={on ? 3 : 2} vectorEffect="non-scaling-stroke" className="cursor-pointer" />
                                        {on && z.puntos.map((p, i) => <circle key={i} cx={p.x * 1000} cy={p.y * 1000} r={9} fill={COLOR.zona} stroke="#000" strokeWidth={2} vectorEffect="non-scaling-stroke" className="cursor-grab" onPointerDown={agarrar({ tipo: "zona", id: z.id, i })} />)}
                                    </g>
                                );
                            })}
                            {geo?.carriles.map((c) => {
                                const on = sel?.tipo === "carril" && sel.id === c.id; const col = COLOR[c.sentido];
                                const ce = S(centroide(c.puntos));
                                return (
                                    <g key={c.id} onPointerDown={(e) => { if (herr) return; e.stopPropagation(); setSel({ tipo: "carril", id: c.id }); }}>
                                        <polygon points={c.puntos.map(S).map((p) => `${p.x},${p.y}`).join(" ")} fill={`${col}${on ? "38" : "22"}`} stroke={col} strokeWidth={on ? 3 : 2} vectorEffect="non-scaling-stroke" className="cursor-pointer" />
                                        {c.flecha && c.sentido !== "ambos" && <line x1={c.flecha.a.x * 1000} y1={c.flecha.a.y * 1000} x2={c.flecha.b.x * 1000} y2={c.flecha.b.y * 1000} stroke={col} strokeWidth={4} markerEnd={`url(#punta-${c.sentido})`} vectorEffect="non-scaling-stroke" />}
                                        {c.flecha && c.sentido === "ambos" && <line x1={c.flecha.a.x * 1000} y1={c.flecha.a.y * 1000} x2={c.flecha.b.x * 1000} y2={c.flecha.b.y * 1000} stroke={col} strokeWidth={3} markerStart="url(#punta-ambos)" markerEnd="url(#punta-ambos)" vectorEffect="non-scaling-stroke" />}
                                        <text x={ce.x} y={ce.y} textAnchor="middle" fontSize={22} fontWeight={700} fill="#fff" stroke="#000" strokeWidth={4} paintOrder="stroke" style={{ pointerEvents: "none" }}>{c.nombre}</text>
                                        {on && c.puntos.map((p, i) => <circle key={i} cx={p.x * 1000} cy={p.y * 1000} r={9} fill={col} stroke="#000" strokeWidth={2} vectorEffect="non-scaling-stroke" className="cursor-grab" onPointerDown={agarrar({ tipo: "carril", id: c.id, i })} />)}
                                        {on && c.flecha && [c.flecha.a, c.flecha.b].map((p, i) => <circle key={`f${i}`} cx={p.x * 1000} cy={p.y * 1000} r={7} fill="#fff" stroke={col} strokeWidth={3} vectorEffect="non-scaling-stroke" className="cursor-grab" onPointerDown={agarrar({ tipo: "flecha", id: c.id, i })} />)}
                                    </g>
                                );
                            })}
                            {geo?.lineas.map((l) => {
                                const on = sel?.tipo === "linea" && sel.id === l.id;
                                const a = S(l.a), b = S(l.b), m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
                                const largo = Math.hypot(b.x - a.x, b.y - a.y) || 1, nx = -(b.y - a.y) / largo, ny = (b.x - a.x) / largo, L = 55;
                                const s = l.sentido === "ba" ? -1 : 1;
                                return (
                                    <g key={l.id} onPointerDown={(e) => { if (herr) return; e.stopPropagation(); setSel({ tipo: "linea", id: l.id }); }}>
                                        <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={COLOR.linea} strokeWidth={on ? 5 : 4} vectorEffect="non-scaling-stroke" className="cursor-pointer" />
                                        <line x1={m.x - (l.sentido === "ambos" ? nx * L : 0)} y1={m.y - (l.sentido === "ambos" ? ny * L : 0)} x2={m.x + s * nx * L} y2={m.y + s * ny * L} stroke="#fff" strokeWidth={3}
                                            markerEnd="url(#punta-blanco)" markerStart={l.sentido === "ambos" ? "url(#punta-blanco)" : undefined} vectorEffect="non-scaling-stroke" style={{ pointerEvents: "none" }} />
                                        {[["A", a], ["B", b]].map(([t, p]) => {
                                            const q = p as { x: number; y: number };
                                            return <text key={t as string} x={q.x} y={q.y - 16} textAnchor="middle" fontSize={22} fontWeight={800} fill={COLOR.linea} stroke="#000" strokeWidth={4} paintOrder="stroke" style={{ pointerEvents: "none" }}>{t as string}</text>;
                                        })}
                                        {on && [l.a, l.b].map((p, i) => <circle key={i} cx={p.x * 1000} cy={p.y * 1000} r={9} fill={COLOR.linea} stroke="#000" strokeWidth={2} vectorEffect="non-scaling-stroke" className="cursor-grab" onPointerDown={agarrar({ tipo: "linea", id: l.id, i })} />)}
                                    </g>
                                );
                            })}
                            {/* Lo que se está dibujando. */}
                            {borrador.length > 0 && (
                                <g style={{ pointerEvents: "none" }}>
                                    <polyline points={borrador.map(S).map((p) => `${p.x},${p.y}`).join(" ")} fill="none" stroke="#fff" strokeWidth={2} strokeDasharray="8 6" vectorEffect="non-scaling-stroke" />
                                    {borrador.map((p, i) => <circle key={i} cx={p.x * 1000} cy={p.y * 1000} r={i === 0 && borrador.length >= 3 ? 11 : 7} fill={i === 0 ? "#fff" : "rgba(255,255,255,0.8)"} stroke="#000" strokeWidth={2} vectorEffect="non-scaling-stroke" />)}
                                </g>
                            )}
                        </svg>
                        {herr && (
                            <div className="absolute left-1/2 -translate-x-1/2 bottom-3 px-3 py-1.5 rounded-full bg-black/75 backdrop-blur-md text-white text-[11.5px] font-semibold flex items-center gap-2 ring-1 ring-white/15 whitespace-nowrap">
                                {herr === "linea" ? (borrador.length ? "Tocá el punto B" : "Tocá el punto A") : borrador.length < 3 ? `Tocá los vértices (${borrador.length}/3 mínimo)` : "Tocá el primer punto o Enter para cerrar"}
                                {herr !== "linea" && borrador.length >= 3 && <button onClick={() => terminar()} className="h-6 px-2 rounded-md bg-white text-black text-[11px] font-bold inline-flex items-center gap-1"><Check size={11} /> Cerrar figura</button>}
                                {borrador.length > 0 && <button onClick={() => setBorrador(borrador.slice(0, -1))} title="Deshacer el último punto" className="h-6 w-6 grid place-items-center rounded-md bg-white/15 hover:bg-white/25"><Undo2 size={11} /></button>}
                                <button onClick={() => { setHerr(null); setBorrador([]); }} className="h-6 px-2 rounded-md bg-white/15 hover:bg-white/25 text-[11px]">Cancelar</button>
                            </div>
                        )}
                    </div>
                </div>

                {/* El panel: qué se dibuja, cómo se comporta. */}
                <aside className="w-[290px] shrink-0 border-l border-white/10 bg-neutral-950/80 overflow-y-auto p-4 space-y-5 text-white">
                    {cargando && !geo ? <div className="flex items-center gap-2 text-[12px] text-white/60"><Loader2 size={14} className="animate-spin" /> Leyendo…</div> : geo && (<>
                        <label className="flex items-start gap-3 cursor-pointer select-none">
                            <input type="checkbox" checked={geo.activa} onChange={(e) => cambiar((g) => ({ ...g, activa: e.target.checked }))} className="mt-0.5 h-4 w-4 accent-emerald-500" />
                            <span>
                                <span className="block text-[12.5px] font-semibold">Usar esta geometría</span>
                                <span className="block text-[11px] text-white/55">{geo.activa ? "Con algo dibujado, OmniVision decide con esto." : "Apagada: sigue la zona o la línea del calibrador de lectura (punteada)."}</span>
                            </span>
                        </label>

                        <div>
                            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-white/45 mb-2">Dibujar</p>
                            <div className="grid grid-cols-3 gap-1.5">
                                {([["carril", "Carril", Route, COLOR.entra], ["zona", "Zona", Square, COLOR.zona], ["linea", "Línea", Minus, COLOR.linea]] as const).map(([k, t, I, c]) => (
                                    <button key={k} onClick={() => { setHerr(herr === k ? null : k); setBorrador([]); setSel(null); }} title={AYUDA[k]}
                                        className={cn("h-16 rounded-xl border flex flex-col items-center justify-center gap-1 text-[11px] font-bold transition", herr === k ? "bg-white/15 border-white/40" : "bg-white/[0.04] border-white/10 hover:bg-white/[0.09]")}>
                                        <I size={18} style={{ color: c }} /> {t}
                                    </button>
                                ))}
                            </div>
                            <p className="mt-2 text-[11px] text-white/50 leading-snug">{herr ? AYUDA[herr] : "Elegí qué dibujar y tocá sobre la foto. Los puntos blancos son chapas leídas en las últimas 48 h: dibujá encima de donde pasan."}</p>
                        </div>

                        {total > 0 && (
                            <div>
                                <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-white/45 mb-2">Dibujado</p>
                                <ul className="space-y-1">
                                    {[...geo.carriles.map((x) => ({ tipo: "carril" as const, x, col: COLOR[x.sentido] })), ...geo.zonas.map((x) => ({ tipo: "zona" as const, x, col: COLOR.zona })), ...geo.lineas.map((x) => ({ tipo: "linea" as const, x, col: COLOR.linea }))].map(({ tipo, x, col }) => (
                                        <li key={x.id}>
                                            <button onClick={() => { setSel({ tipo, id: x.id }); setHerr(null); }} className={cn("w-full h-8 px-2 rounded-lg flex items-center gap-2 text-left text-[12px]", sel?.id === x.id ? "bg-white/12 ring-1 ring-white/25" : "hover:bg-white/[0.06]")}>
                                                <span className="h-2.5 w-2.5 rounded-sm shrink-0" style={{ background: col }} />
                                                <span className="truncate flex-1 font-semibold">{x.nombre}</span>
                                                <span className="text-[10px] text-white/45">{tipo === "carril" ? ({ entra: "entra", sale: "sale", ambos: "dos manos" } as const)[(x as Carril).sentido] : tipo === "linea" ? ({ ab: "A→B", ba: "B→A", ambos: "ambos" } as const)[(x as Linea).sentido] : "captura"}</span>
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}

                        {elegido && sel && (
                            <div className="rounded-xl bg-white/[0.05] ring-1 ring-white/10 p-3 space-y-3">
                                <input value={elegido.nombre} maxLength={40} onChange={(e) => cambiar((g) => { const l = sel.tipo === "carril" ? g.carriles : sel.tipo === "zona" ? g.zonas : g.lineas; const it = (l as { id: string; nombre: string }[]).find((y) => y.id === sel.id); if (it) it.nombre = e.target.value; return g; })}
                                    className="w-full h-8 rounded-md bg-black/40 border border-white/15 px-2 text-[12.5px] font-semibold outline-none focus:border-emerald-400" />
                                {sel.tipo === "carril" && (<>
                                    <div className="grid grid-cols-3 gap-1">
                                        {(["entra", "sale", "ambos"] as SentidoCarril[]).map((s) => (
                                            <button key={s} onClick={() => cambiar((g) => { const c = g.carriles.find((y) => y.id === sel.id); if (c) { c.sentido = s; if (!c.flecha) c.flecha = flechaPorDefecto(c.puntos); } return g; })}
                                                className={cn("h-7 rounded-full text-[11px] font-bold", (elegido as Carril).sentido === s ? "text-black" : "bg-white/[0.06] text-white/75 hover:bg-white/[0.12]")} style={(elegido as Carril).sentido === s ? { background: COLOR[s] } : undefined}>
                                                {s === "entra" ? "Entra" : s === "sale" ? "Sale" : "Dos manos"}
                                            </button>
                                        ))}
                                    </div>
                                    <button onClick={() => cambiar((g) => { const c = g.carriles.find((y) => y.id === sel.id); if (c) c.flecha = c.flecha ? { a: c.flecha.b, b: c.flecha.a } : flechaPorDefecto(c.puntos); return g; })}
                                        className="w-full h-7 rounded-md bg-white/[0.06] hover:bg-white/[0.12] text-[11px] font-semibold inline-flex items-center justify-center gap-1.5"><ArrowUpDown size={12} /> Invertir la flecha</button>
                                    <p className="text-[10.5px] text-white/50 leading-snug">La flecha es hacia dónde va el auto en este carril (arrastrá sus puntas). «Entra» y «Sale» además dicen el sentido de la lectura.</p>
                                </>)}
                                {sel.tipo === "linea" && (<>
                                    <div className="grid grid-cols-3 gap-1">
                                        {(["ab", "ba", "ambos"] as SentidoLinea[]).map((s) => (
                                            <button key={s} onClick={() => cambiar((g) => { const l = g.lineas.find((y) => y.id === sel.id); if (l) l.sentido = s; return g; })}
                                                className={cn("h-7 rounded-full text-[11px] font-bold", (elegido as Linea).sentido === s ? "bg-rose-400 text-black" : "bg-white/[0.06] text-white/75 hover:bg-white/[0.12]")}>
                                                {s === "ab" ? "A→B" : s === "ba" ? "B→A" : "Ambos"}
                                            </button>
                                        ))}
                                    </div>
                                    <p className="text-[10.5px] text-white/50 leading-snug">La flecha blanca del medio es el cruce que cuenta. Arrastrá A y B para mover la línea.</p>
                                </>)}
                                {sel.tipo === "zona" && <p className="text-[10.5px] text-white/50 leading-snug">Sólo cuentan las chapas que caen adentro. Arrastrá los vértices para ajustarla.</p>}
                                <button onClick={() => borrar(sel)} className="w-full h-7 rounded-md bg-red-500/15 hover:bg-red-500/25 text-red-300 text-[11px] font-semibold inline-flex items-center justify-center gap-1.5"><Trash2 size={12} /> Quitar</button>
                            </div>
                        )}

                        <div>
                            <div className="flex items-center gap-1.5 mb-1.5">
                                <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-white/45">Rebote</p>
                                <span title={AYUDA.rebote} className="text-white/40 cursor-help"><Info size={11} /></span>
                                <span className="ml-auto text-[12px] font-bold tabular-nums">{geo.rebote ? `${geo.rebote} s` : "apagado"}</span>
                            </div>
                            <input type="range" min={0} max={120} step={5} value={geo.rebote} onChange={(e) => cambiar((g) => ({ ...g, rebote: Number(e.target.value) }))} className="w-full accent-emerald-500" />
                            <p className="text-[10.5px] text-white/50 leading-snug">{AYUDA.rebote}</p>
                        </div>

                        <div className="flex items-center gap-1.5 pt-1">
                            <button onClick={() => setVerPuntos((v) => !v)} className="h-7 px-2 rounded-md bg-white/[0.06] hover:bg-white/[0.12] text-[11px] font-semibold inline-flex items-center gap-1.5">
                                {verPuntos ? <EyeOff size={12} /> : <Eye size={12} />} {verPuntos ? "Ocultar" : "Ver"} lecturas ({guia.puntos.length})
                            </button>
                            <button onClick={() => setFoto(Date.now())} className="h-7 px-2 rounded-md bg-white/[0.06] hover:bg-white/[0.12] text-[11px] font-semibold inline-flex items-center gap-1.5"><RefreshCw size={12} /> Foto nueva</button>
                        </div>
                        {(guia.roi || guia.linea) && <p className="text-[10.5px] text-white/45 leading-snug">Punteado blanco: la {guia.linea ? "línea" : "zona"} del calibrador de lectura, que sigue valiendo cuando esto está apagado o vacío.</p>}
                    </>)}
                </aside>
            </div>
        </div>
    );
}
