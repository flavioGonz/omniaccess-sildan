"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Check, Crosshair, ExternalLink, Layers, Map as MapaIcono, MapPinOff, Minus, MousePointer2, Move, Plus, RotateCcw, Save, Undo2, X } from "lucide-react";
import { sileo as toast } from "sileo";
import { guardarPuntosPlano, lotesDelPlano, planoDeLotes, type LoteDelPlano } from "@/app/actions/administraciones";
import { Girando as Loader2 } from "@/components/brand/CargaOmni";
import { Button } from "@/components/ui/button";
import { Cargando, Chip, ErrorEstado, Vacio } from "@/components/ui/estados";
import { Seek } from "@/components/ui/search";
import { cn } from "@/lib/utils";

/**
 * El croquis de los lotes, para mirarlo y para corregirlo (25/11).
 *
 * Nico pasó un artefacto con el croquis unificado de San Nicolás y el punto de cada solar: un
 * buscador de lotes y vecinos sobre el plano. Después pidió que esto lo continúe: «el tab de planos
 * debe mejorar mucho, debe permitir editar esos lotes, es decir moderar el artefacto que te di,
 * poder editarlo y continuarlo acá en OmniAccess». Entonces tiene las dos cosas:
 *
 *   · Lo del artefacto: buscar por lote, titular, vecino o correo; filtrar por estado; ver la ficha
 *     de un lote con su gente. Con lo que agrega OmniAccess: cómo va su censo y su administración.
 *   · Editar: arrastrar el punto de un lote que cae mal, o ubicar uno que no tenía (tocando el
 *     plano). Los cambios quedan pendientes hasta «Guardar», se pueden deshacer de a uno, y al guardar
 *     se recalculan sus coordenadas con la calibración del croquis: son las que usa el censo (la casa
 *     ya viene ubicada) y los pases de las visitas.
 *
 * Al entrar se encuadra en los lotes de la administración elegida: cada comisión ve primero lo suyo.
 * Los de las otras se ven tenues, para ubicarse, o enteros con «Todo el complejo».
 *
 * El croquis es una imagen grande (la lámina entera a 1:1000): se mueve arrastrando y se acerca con
 * la rueda. Los puntos tienen el mismo tamaño en pantalla a cualquier zoom, y de cerca pasan a ser un
 * aro para no tapar el número del solar.
 */

type Estado = "cargo" | "enviado" | "listo" | "nadie" | "terreno";
const ESTADOS: Record<Estado, { rotulo: string; color: string }> = {
    cargo: { rotulo: "Cargó el censo", color: "var(--bien)" },
    enviado: { rotulo: "Código enviado", color: "var(--info)" },
    listo: { rotulo: "Sin enviar", color: "var(--aviso)" },
    nadie: { rotulo: "Sin nadie con correo", color: "var(--mal)" },
    terreno: { rotulo: "Terreno o sin vender", color: "var(--quieto, #8a8f98)" },
};
const ORDEN: Estado[] = ["cargo", "enviado", "listo", "nadie", "terreno"];
const VINCULO: Record<string, string> = { PROPIETARIO: "propietario", INQUILINO: "inquilino", OCUPANTE: "ocupante", FAMILIA: "familia" };
function estadoDe(l: LoteDelPlano): Estado {
    if (l.censo === "cargo") return "cargo";
    if (l.censo === "enviado") return "enviado";
    if (l.personas.some((p) => p.email)) return "listo";
    return l.situacion === "TERRENO" || l.situacion === "DESARROLLADOR" ? "terreno" : "nadie";
}
const sinEspacios = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, "");
type Plano = { titulo: string; ancho: number; alto: number; georef: boolean; puedeEditar: boolean };
type Punto = { x: number; y: number };

export function PlanoLotes({ administracionId, alAbrir }: { administracionId: string; alAbrir: (id: string) => void }) {
    const [datos, setDatos] = useState<{ plano: Plano | null; lotes: LoteDelPlano[] } | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [otra, setOtra] = useState(0);
    useEffect(() => {
        let vivo = true;
        Promise.all([planoDeLotes(), lotesDelPlano()])
            .then(([plano, lotes]) => { if (vivo) { setDatos({ plano, lotes }); setError(null); } })
            .catch((e) => { if (vivo) setError(e instanceof Error ? e.message : "No se pudo traer el croquis."); });
        return () => { vivo = false; };
    }, [otra]);

    if (error) return <ErrorEstado mensaje={error} alReintentar={() => setOtra((n) => n + 1)} />;
    if (!datos) return <div className="rounded-[14px] border border-border bg-card"><Cargando texto="Trayendo el croquis…" /></div>;
    if (!datos.plano) return (
        <div className="rounded-[14px] border border-dashed border-border">
            <Vacio icono={MapaIcono} titulo="Todavía no hay un croquis de los lotes" ayuda="Se carga desde el servidor con el plano del complejo y el punto de cada solar (scripts/importar-plano-lotes.ts)." />
        </div>
    );
    return <Editor plano={datos.plano} lotes={datos.lotes} administracionId={administracionId} alAbrir={alAbrir} alGuardar={() => setOtra((n) => n + 1)} />;
}

function Editor({ plano, lotes, administracionId, alAbrir, alGuardar }: { plano: Plano; lotes: LoteDelPlano[]; administracionId: string; alAbrir: (id: string) => void; alGuardar: () => void }) {
    const caja = useRef<HTMLDivElement>(null);
    const [v, setV] = useState({ s: 0.1, x: 0, y: 0 });
    const [cargada, setCargada] = useState(false);
    const [alcance, setAlcance] = useState<"suya" | "todo">("suya");
    const [ver, setVer] = useState<Record<Estado, boolean>>({ cargo: true, enviado: true, listo: true, nadie: true, terreno: true });
    const [q, setQ] = useState("");
    const [sel, setSel] = useState<string | null>(null);
    const [encima, setEncima] = useState<{ id: string; px: number; py: number; w: number } | null>(null);
    /* La edición: los puntos movidos quedan acá hasta guardar; `historia` es para deshacer de a uno. */
    const [editando, setEditando] = useState(false);
    const [pendientes, setPendientes] = useState<Record<string, Punto>>({});
    const [historia, setHistoria] = useState<{ id: string; antes: Punto | null }[]>([]);
    const [guardando, setGuardando] = useState(false);

    const punto = useCallback((l: LoteDelPlano): Punto | null => pendientes[l.id] || (l.x !== null && l.y !== null ? { x: l.x, y: l.y } : null), [pendientes]);
    const estado = useMemo(() => new Map(lotes.map((l) => [l.id, estadoDe(l)])), [lotes]);
    const enAlcance = useCallback((l: LoteDelPlano) => alcance === "todo" || l.administracionId === administracionId, [alcance, administracionId]);
    const suyos = useMemo(() => lotes.filter((l) => l.administracionId === administracionId), [lotes, administracionId]);
    const lote = useMemo(() => new Map(lotes.map((l) => [l.id, l])), [lotes]);
    const elegido = sel ? lote.get(sel) || null : null;

    /** La lista del costado: lo que coincide con la búsqueda, dentro del alcance y de los estados prendidos. */
    const lista = useMemo(() => {
        const t = sinEspacios(q.trim());
        return lotes.filter((l) => enAlcance(l) && ver[estado.get(l.id)!] && (!t || [l.codigo, l.nombre, l.titular, ...l.personas.flatMap((p) => [p.nombre, p.email])].some((x) => sinEspacios(x || "").includes(t))));
    }, [lotes, q, enAlcance, ver, estado]);
    const sinUbicar = useMemo(() => lotes.filter((l) => enAlcance(l) && !punto(l)), [lotes, enAlcance, punto]);
    const cuenta = useMemo(() => { const c = { cargo: 0, enviado: 0, listo: 0, nadie: 0, terreno: 0 } as Record<Estado, number>; for (const l of lotes) if (enAlcance(l)) c[estado.get(l.id)!]++; return c; }, [lotes, enAlcance, estado]);

    /* ── Mirar: encuadrar, acercar, mover ── */
    const encuadrar = useCallback((x0: number, y0: number, x1: number, y1: number, margen = 80) => {
        const r = caja.current?.getBoundingClientRect();
        if (!r) return;
        const w = Math.max(x1 - x0, 1) + margen * 2, h = Math.max(y1 - y0, 1) + margen * 2;
        const s = Math.min(1.4, Math.min(r.width / w, r.height / h));
        setV({ s, x: r.width / 2 - ((x0 + x1) / 2) * s, y: r.height / 2 - ((y0 + y1) / 2) * s });
    }, []);
    const encuadrarSuyos = useCallback(() => {
        const pts = suyos.map((l) => (l.x !== null && l.y !== null ? { x: l.x, y: l.y } : null)).filter((p): p is Punto => !!p);
        if (!pts.length) return encuadrar(0, 0, plano.ancho, plano.alto, 0);
        encuadrar(Math.min(...pts.map((p) => p.x)), Math.min(...pts.map((p) => p.y)), Math.max(...pts.map((p) => p.x)), Math.max(...pts.map((p) => p.y)), 260);
    }, [suyos, encuadrar, plano.ancho, plano.alto]);
    // En el cuadro siguiente: recién ahí la caja tiene su tamaño.
    useLayoutEffect(() => { const id = requestAnimationFrame(encuadrarSuyos); return () => cancelAnimationFrame(id); }, [encuadrarSuyos]);
    const irA = useCallback((l: LoteDelPlano) => { setSel(l.id); const p = punto(l); if (p) encuadrar(p.x - 1, p.y - 1, p.x + 1, p.y + 1, 420); }, [punto, encuadrar]);

    const zoomEn = useCallback((f: number, cx: number, cy: number) => {
        setV((o) => { const s = Math.min(2, Math.max(0.04, o.s * f)); return { s, x: cx - ((cx - o.x) * s) / o.s, y: cy - ((cy - o.y) * s) / o.s }; });
    }, []);
    // La rueda tiene que poder cancelar el scroll de la página: con React no se puede (es pasivo).
    useEffect(() => {
        const el = caja.current;
        if (!el) return;
        const rueda = (e: WheelEvent) => { e.preventDefault(); const r = el.getBoundingClientRect(); zoomEn(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top); };
        el.addEventListener("wheel", rueda, { passive: false });
        return () => el.removeEventListener("wheel", rueda);
    }, [zoomEn]);

    /* ── Editar: mover un punto arrastrándolo, ubicar uno que no tenía tocando el plano ── */
    const aPlano = (clientX: number, clientY: number): Punto => {
        const r = caja.current!.getBoundingClientRect();
        return { x: Math.min(plano.ancho, Math.max(0, (clientX - r.left - v.x) / v.s)), y: Math.min(plano.alto, Math.max(0, (clientY - r.top - v.y) / v.s)) };
    };
    const mover = (id: string, p: Punto, registrar: boolean) => {
        if (registrar) { const l = lote.get(id); setHistoria((h) => [...h, { id, antes: l ? punto(l) : null }]); }
        setPendientes((o) => ({ ...o, [id]: p }));
    };
    const deshacer = () => {
        const ult = historia[historia.length - 1];
        if (!ult) return;
        setHistoria((h) => h.slice(0, -1));
        setPendientes((o) => {
            const n = { ...o }; const l = lote.get(ult.id);
            const original = l && l.x !== null && l.y !== null ? { x: l.x, y: l.y } : null;
            if (!ult.antes || (original && ult.antes.x === original.x && ult.antes.y === original.y)) delete n[ult.id]; else n[ult.id] = ult.antes;
            return n;
        });
    };
    const descartar = () => { setPendientes({}); setHistoria([]); };
    const guardar = async () => {
        const cambios = Object.entries(pendientes).map(([unitId, p]) => ({ unitId, x: p.x, y: p.y }));
        if (!cambios.length) return;
        setGuardando(true);
        try {
            const r = await guardarPuntosPlano(cambios);
            if (!r.ok) { toast.error({ title: "No se guardó", description: r.error }); return; }
            toast.success({ title: `${r.guardados} ${r.guardados === 1 ? "ubicación guardada" : "ubicaciones guardadas"}`, description: plano.georef ? "Sus coordenadas se recalcularon: el censo y los pases ya usan las nuevas." : undefined });
            setPendientes({}); setHistoria([]); alGuardar();
        } catch (e) { toast.error({ title: "No se guardó", description: e instanceof Error ? e.message : undefined }); }
        finally { setGuardando(false); }
    };
    const nPend = Object.keys(pendientes).length;
    // Con cambios sin guardar, salir de la página pregunta.
    useEffect(() => {
        if (!nPend) return;
        const antes = (e: BeforeUnloadEvent) => { e.preventDefault(); };
        addEventListener("beforeunload", antes);
        return () => removeEventListener("beforeunload", antes);
    }, [nPend]);

    /* ── El puntero: arrastrar el plano, arrastrar un punto (editando), o tocar ── */
    const gesto = useRef<{ x: number; y: number; movido: number; lote: string | null } | null>(null);
    const bajar = (e: React.PointerEvent) => {
        if ((e.target as HTMLElement).closest("[data-control]")) return;
        const id = (e.target as Element).getAttribute?.("data-lote");
        gesto.current = { x: e.clientX, y: e.clientY, movido: 0, lote: editando && id ? id : null };
        setEncima(null);
        if (gesto.current.lote) { setSel(id); const l = lote.get(id!); if (l) setHistoria((h) => [...h, { id: id!, antes: punto(l) }]); }
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    };
    const moverPuntero = (e: React.PointerEvent) => {
        const g = gesto.current; if (!g) return;
        const dx = e.clientX - g.x, dy = e.clientY - g.y; g.movido += Math.abs(dx) + Math.abs(dy); g.x = e.clientX; g.y = e.clientY;
        if (g.lote) mover(g.lote, aPlano(e.clientX, e.clientY), false);
        else setV((o) => ({ ...o, x: o.x + dx, y: o.y + dy }));
    };
    const soltar = (e: React.PointerEvent) => {
        const g = gesto.current; gesto.current = null;
        if (!g) return;
        if (g.lote) {
            // Un toque sin arrastrar sobre un punto, editando: no se movió; se saca de la historia.
            if (g.movido < 4) setHistoria((h) => h.slice(0, -1));
            return;
        }
        if (g.movido >= 6) return;
        const el = document.elementFromPoint(e.clientX, e.clientY) as Element | null;
        const id = el?.getAttribute?.("data-lote");
        if (id) { setSel(id); return; }
        // Editando, con un lote sin punto elegido: tocar el plano lo ubica ahí.
        if (editando && elegido && !punto(elegido)) { mover(elegido.id, aPlano(e.clientX, e.clientY), true); return; }
        setSel(null);
    };
    useEffect(() => {
        const tecla = (e: KeyboardEvent) => {
            if (e.key === "Escape") setSel(null);
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && editando) { e.preventDefault(); deshacer(); }
        };
        addEventListener("keydown", tecla);
        return () => removeEventListener("keydown", tecla);
    });

    const r = 9 / v.s;          // el radio del punto: 9 px de pantalla a cualquier zoom
    /* De cerca el punto pasa a ser un aro alrededor del número del solar: lleno lo tapaba. */
    const cerca = v.s >= 0.3;
    const centro = () => { const b = caja.current?.getBoundingClientRect(); return b ? [b.width / 2, b.height / 2] as const : [0, 0] as const; };
    const encimaL = encima ? lote.get(encima.id) : null;
    const colocando = editando && elegido && !punto(elegido);

    return (
        <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_316px]">
            {/* ── El croquis ── */}
            <div className="relative overflow-hidden rounded-[14px] border border-border bg-card">
                <div ref={caja} onPointerDown={bajar} onPointerMove={moverPuntero} onPointerUp={soltar} onPointerCancel={() => { gesto.current = null; }}
                    className={cn("relative h-[calc(100vh-230px)] min-h-[520px] overflow-hidden bg-white touch-none select-none", colocando ? "cursor-crosshair" : "cursor-grab active:cursor-grabbing")}>
                    <div className="absolute left-0 top-0 origin-top-left will-change-transform" style={{ transform: `translate(${v.x}px, ${v.y}px) scale(${v.s})`, width: plano.ancho, height: plano.alto }}>
                        {/* eslint-disable-next-line @next/next/no-img-element -- una imagen de 5000 px que se escala con transform: el optimizador de Next no aporta y la recortaría */}
                        <img src="/api/administraciones/plano" alt={plano.titulo} width={plano.ancho} height={plano.alto} draggable={false} onLoad={() => setCargada(true)}
                            className={cn("block h-full w-full transition-opacity duration-300", cargada ? "opacity-100" : "opacity-0")} />
                        <svg className="absolute inset-0" width={plano.ancho} height={plano.alto} viewBox={`0 0 ${plano.ancho} ${plano.alto}`}>
                            {lotes.map((l) => {
                                const p = punto(l); if (!p) return null;
                                const e = estado.get(l.id)!;
                                const dentro = enAlcance(l) && ver[e];
                                /* Lo que queda fuera del alcance se ve tenue y no se toca: está para ubicarse. */
                                if (!dentro) return <circle key={l.id} cx={p.x} cy={p.y} r={r * 0.45} fill="#94a3b8" fillOpacity={0.55} pointerEvents="none" />;
                                const movido = !!pendientes[l.id];
                                return (
                                    <circle key={l.id} data-lote={l.id} cx={p.x} cy={p.y} r={cerca ? r * 1.7 : r} fill={ESTADOS[e].color} fillOpacity={cerca ? 0.14 : 0.88}
                                        stroke={movido ? "var(--accion)" : cerca ? ESTADOS[e].color : "#fff"} strokeWidth={(movido ? 4 : cerca ? 3.5 : 2.5) / v.s} strokeDasharray={movido ? `${6 / v.s} ${4 / v.s}` : undefined}
                                        className={editando ? "cursor-move" : "cursor-pointer"}
                                        onPointerEnter={(ev) => { const b = caja.current!.getBoundingClientRect(); setEncima({ id: l.id, px: ev.clientX - b.left, py: ev.clientY - b.top, w: b.width }); }}
                                        onPointerLeave={() => setEncima(null)} />
                                );
                            })}
                            {elegido && punto(elegido) && <circle cx={punto(elegido)!.x} cy={punto(elegido)!.y} r={r * 2.5} fill="none" stroke="var(--accion)" strokeWidth={3 / v.s} className="animate-pulse" pointerEvents="none" />}
                        </svg>
                    </div>
                    {!cargada && <div className="absolute inset-0 grid place-items-center"><Cargando texto="Dibujando el croquis…" /></div>}

                    {/* Lo que dice el punto bajo el mouse. */}
                    {encima && encimaL && (
                        <div className="pointer-events-none absolute z-10 w-[216px] rounded-[10px] border border-border bg-card px-3 py-2 text-[12px] shadow-[0_8px_24px_-8px_rgba(0,0,0,0.35)]"
                            style={{ left: Math.min(encima.px + 14, encima.w - 230), top: Math.max(encima.py - 64, 8) }}>
                            <p className="flex items-center gap-1.5 font-bold tabular-nums"><span className="h-2 w-2 rounded-full" style={{ background: ESTADOS[estado.get(encimaL.id)!].color }} />{encimaL.nombre}</p>
                            <p className="truncate text-muted-foreground">{encimaL.titular || "Sin titular"}</p>
                            <p className="text-[11px] text-muted-foreground">{ESTADOS[estado.get(encimaL.id)!].rotulo}{editando ? " · arrastralo para moverlo" : ""}</p>
                        </div>
                    )}

                    {/* La barra de arriba: editar, y los cambios sin guardar. */}
                    <div data-control className="absolute left-3 right-3 top-3 flex flex-wrap items-center gap-2">
                        {plano.puedeEditar && (
                            <div className="inline-flex rounded-full border border-border bg-card/95 p-0.5 shadow-[0_4px_14px_-6px_rgba(0,0,0,0.3)] backdrop-blur" role="group" aria-label="Modo">
                                <button type="button" aria-pressed={!editando} onClick={() => setEditando(false)} className={cn("h-8 px-3 rounded-full text-[12px] font-semibold inline-flex items-center gap-1.5 transition-colors", !editando ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground")}><MousePointer2 size={13} /> Mirar</button>
                                <button type="button" aria-pressed={editando} onClick={() => setEditando(true)} className={cn("h-8 px-3 rounded-full text-[12px] font-semibold inline-flex items-center gap-1.5 transition-colors", editando ? "bg-[var(--accion)] text-white" : "text-muted-foreground hover:text-foreground")}><Move size={13} /> Editar ubicaciones</button>
                            </div>
                        )}
                        {colocando && (
                            <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--accion)] px-3 py-1.5 text-[12px] font-semibold text-white shadow-[0_4px_14px_-6px_rgba(0,0,0,0.4)]">
                                <Crosshair size={13} /> Tocá en el plano dónde va {elegido!.codigo}
                            </span>
                        )}
                        {nPend > 0 && (
                            <div className="ml-auto inline-flex items-center gap-1 rounded-full border border-border bg-card/95 p-1 pl-3 shadow-[0_4px_14px_-6px_rgba(0,0,0,0.3)] backdrop-blur">
                                <span className="text-[12px] font-semibold tabular-nums">{nPend} sin guardar</span>
                                <Button size="sm" variant="ghost" className="h-7 px-2" onClick={deshacer} disabled={!historia.length || guardando} title="Deshacer (Ctrl+Z)"><Undo2 size={13} /></Button>
                                <Button size="sm" variant="ghost" className="h-7 px-2" onClick={descartar} disabled={guardando} title="Descartar todo"><RotateCcw size={13} /></Button>
                                <Button size="sm" className="h-7" onClick={guardar} disabled={guardando}>{guardando ? <Loader2 size={13} /> : <Save size={13} />} Guardar</Button>
                            </div>
                        )}
                    </div>

                    <div data-control className="absolute right-3 bottom-3 flex flex-col gap-1.5">
                        <Button size="icon" variant="outline" className="h-9 w-9 bg-card" aria-label="Acercar" onClick={() => { const [x, y] = centro(); zoomEn(1.5, x, y); }}><Plus size={15} /></Button>
                        <Button size="icon" variant="outline" className="h-9 w-9 bg-card" aria-label="Alejar" onClick={() => { const [x, y] = centro(); zoomEn(1 / 1.5, x, y); }}><Minus size={15} /></Button>
                        <Button size="icon" variant="outline" className="h-9 w-9 bg-card" aria-label="Volver a sus lotes" title="Volver a sus lotes" onClick={encuadrarSuyos}><Crosshair size={15} /></Button>
                        <Button size="icon" variant="outline" className="h-9 w-9 bg-card" aria-label="Ver el complejo entero" title="Ver el complejo entero" onClick={() => encuadrar(0, 0, plano.ancho, plano.alto, 0)}><Layers size={15} /></Button>
                    </div>
                </div>
            </div>

            {/* ── El costado: buscar, filtrar, la ficha del lote ── */}
            <aside className="flex min-h-0 flex-col rounded-[14px] border border-border bg-card xl:h-[calc(100vh-230px)] xl:min-h-[520px]">
                <div className="space-y-2.5 border-b border-border p-3">
                    <Seek value={q} onChange={(t) => { setQ(t); setSel(null); }} placeholder="Lote, titular, vecino o correo" startOpen width={290} alto={34} />
                    <div className="inline-flex w-full rounded-[8px] bg-muted p-0.5" role="group" aria-label="Qué lotes">
                        {([["suya", "Esta administración"], ["todo", "Todo el complejo"]] as const).map(([k, t]) => (
                            <button key={k} type="button" aria-pressed={alcance === k} onClick={() => setAlcance(k)}
                                className={cn("h-7 flex-1 rounded-[6px] text-[11.5px] font-semibold transition-all", alcance === k ? "bg-card text-foreground shadow-[0_1px_3px_rgba(0,0,0,0.12)]" : "text-muted-foreground hover:text-foreground")}>{t}</button>))}
                    </div>
                    <div className="flex flex-wrap gap-1" role="group" aria-label="Estados">
                        {ORDEN.filter((e) => cuenta[e] > 0).map((e) => (
                            <button key={e} type="button" aria-pressed={ver[e]} onClick={() => setVer((o) => ({ ...o, [e]: !o[e] }))} title={ESTADOS[e].rotulo}
                                className={cn("h-6 px-2 rounded-full border text-[10.5px] font-semibold inline-flex items-center gap-1 transition-opacity", ver[e] ? "border-border bg-background" : "border-dashed border-border opacity-45")}>
                                <span className="h-2 w-2 rounded-full" style={{ background: ESTADOS[e].color }} />{ESTADOS[e].rotulo}<span className="tabular-nums text-muted-foreground">{cuenta[e]}</span>
                            </button>))}
                    </div>
                </div>

                {elegido ? (
                    <FichaLote l={elegido} estado={estado.get(elegido.id)!} sinPunto={!punto(elegido)} movido={!!pendientes[elegido.id]} editando={editando}
                        alCerrar={() => setSel(null)} alAbrir={() => alAbrir(elegido.id)} alCentrar={() => irA(elegido)} />
                ) : (
                    <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-width:thin]">
                        {sinUbicar.length > 0 && (
                            <div className="border-b border-border bg-[color-mix(in_oklab,var(--aviso)_7%,transparent)] px-3 py-2.5">
                                <p className="flex items-center gap-1.5 text-[11.5px] font-semibold tono-aviso"><MapPinOff size={12} /> {sinUbicar.length} sin ubicar en el plano</p>
                                <div className="mt-1.5 flex flex-wrap gap-1">
                                    {sinUbicar.slice(0, 30).map((l) => (
                                        <button key={l.id} type="button" onClick={() => { setSel(l.id); if (plano.puedeEditar) setEditando(true); }}
                                            className="h-6 rounded-full border border-border bg-card px-2 text-[11px] font-bold tabular-nums hover:border-[var(--accion)] hover:text-[var(--accion)]">{l.nombre}</button>))}
                                </div>
                            </div>
                        )}
                        <p className="px-3 pt-2.5 pb-1 text-[10.5px] text-muted-foreground tabular-nums">{lista.length} {lista.length === 1 ? "lote" : "lotes"}</p>
                        <ul className="pb-2">
                            {lista.slice(0, 400).map((l) => {
                                const e = estado.get(l.id)!, p = l.personas.find((x) => x.principal) || l.personas[0];
                                return (
                                    <li key={l.id}>
                                        <button type="button" onClick={() => irA(l)} className="flex w-full items-start gap-2.5 px-3 py-2 text-left hover:bg-accent/60">
                                            <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: ESTADOS[e].color }} />
                                            <span className="min-w-0 flex-1 leading-tight">
                                                <span className="flex items-center gap-1.5"><b className="text-[13px] tabular-nums">{l.codigo}</b><span className="text-[10.5px] text-muted-foreground">{l.sigla}</span>{!punto(l) && <MapPinOff size={11} className="tono-aviso" />}{pendientes[l.id] && <span className="text-[10px] font-semibold text-[var(--accion)]">movido</span>}</span>
                                                <span className="block truncate text-[11.5px] text-muted-foreground">{p ? p.nombre : l.titular || "Sin titular"}{l.personas.length > 1 ? ` y ${l.personas.length - 1} más` : ""}</span>
                                            </span>
                                        </button>
                                    </li>
                                );
                            })}
                        </ul>
                        {!lista.length && <p className="px-3 py-6 text-center text-[12px] text-muted-foreground">Ningún lote coincide.</p>}
                    </div>
                )}
            </aside>
        </div>
    );
}

/** La ficha de un lote en el costado, como la del artefacto: quién es, su gente y cómo va su censo. */
function FichaLote({ l, estado, sinPunto, movido, editando, alCerrar, alAbrir, alCentrar }: {
    l: LoteDelPlano; estado: Estado; sinPunto: boolean; movido: boolean; editando: boolean; alCerrar: () => void; alAbrir: () => void; alCentrar: () => void;
}) {
    return (
        <div className="min-h-0 flex-1 overflow-y-auto p-4 [scrollbar-width:thin]">
            <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                    <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Lote · {l.sigla}</p>
                    <h3 className="text-[20px] font-bold leading-tight tabular-nums">{l.codigo}</h3>
                    {l.edificio && <p className="text-[12px] text-muted-foreground">{l.edificio}</p>}
                </div>
                <button type="button" onClick={alCerrar} aria-label="Cerrar la ficha" className="grid h-8 w-8 place-items-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"><X size={15} /></button>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
                <Chip tono={estado === "cargo" ? "bien" : estado === "enviado" ? "info" : estado === "nadie" ? "mal" : estado === "terreno" ? "quieto" : "aviso"}>{ESTADOS[estado].rotulo}</Chip>
                {movido && <Chip tono="info">Movido, sin guardar</Chip>}
                {sinPunto && !movido && <Chip tono="aviso">Sin ubicar</Chip>}
            </div>
            {sinPunto && !movido && <p className="mt-2 text-[12px] text-muted-foreground">{editando ? "Tocá en el plano el lugar del número del solar." : "Pasá a «Editar ubicaciones» y tocá en el plano dónde va."}</p>}
            {editando && !sinPunto && <p className="mt-2 text-[12px] text-muted-foreground">Arrastrá su punto en el plano hasta el número del solar.</p>}

            <dl className="mt-3 grid grid-cols-[84px_1fr] gap-x-2 gap-y-1.5 text-[12.5px]">
                <dt className="text-muted-foreground">Titular</dt><dd className="min-w-0 break-words">{l.titular || "—"}</dd>
                {l.areaM2 ? <><dt className="text-muted-foreground">Área</dt><dd className="tabular-nums">{Math.round(l.areaM2).toLocaleString("es-UY")} m²</dd></> : null}
            </dl>

            <p className="mt-4 text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Gente · {l.personas.length}</p>
            {l.personas.length === 0 ? <p className="mt-1.5 text-[12px] text-muted-foreground">Nadie figura en este lote.</p> : (
                <ul className="mt-1.5 space-y-1.5">
                    {l.personas.map((p, k) => (
                        <li key={k} className="rounded-[10px] border border-border px-2.5 py-2">
                            <p className="flex items-center gap-1.5 text-[12.5px] font-semibold">
                                <span className="truncate">{p.nombre}</span>
                                {p.principal && <span className="inline-flex shrink-0 items-center gap-0.5 text-[10.5px] text-[var(--accion)]"><Check size={11} /> principal</span>}
                                <span className="ml-auto shrink-0 text-[10.5px] font-normal text-muted-foreground">{VINCULO[p.vinculo] || p.vinculo}</span>
                            </p>
                            <p className="truncate text-[11.5px] text-muted-foreground">{p.email || "Sin correo"}</p>
                        </li>))}
                </ul>
            )}
            <div className="mt-4 flex flex-wrap gap-2">
                <Button size="sm" onClick={alAbrir}><ExternalLink size={13} /> Abrir el lote</Button>
                {!sinPunto && <Button size="sm" variant="outline" onClick={alCentrar}><Crosshair size={13} /> Centrar</Button>}
            </div>
        </div>
    );
}

/** Abrir un lote en un mapa (Google Maps), con sus coordenadas «lat, lng». */
export function EnElMapa({ coordenadas, className }: { coordenadas: string | null; className?: string }) {
    if (!coordenadas) return null;
    const [lat, lng] = coordenadas.split(/[,;\s]+/).map(Number);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return (
        <a href={`https://www.google.com/maps/search/?api=1&query=${lat},${lng}`} target="_blank" rel="noreferrer"
            className={cn("inline-flex items-center gap-1 text-[var(--accion)] hover:underline", className)}>
            <ExternalLink size={12} /> Ver en el mapa
        </a>
    );
}
