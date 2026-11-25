"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Check, Crosshair, Map as MapaIcono, Minus, Move, Plus, Satellite, X } from "lucide-react";
import { sileo as toast } from "sileo";
import { guardarPuntosPlano, guardarUbicacionLote, planoDeLotes } from "@/app/actions/administraciones";
import { Girando as Loader2 } from "@/components/brand/CargaOmni";
import { EnElMapa } from "@/components/administraciones/PlanoLotes";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const MapaPunto = dynamic(() => import("@/components/mapa/MapaPunto"), { ssr: false, loading: () => <div className="h-[260px] w-full animate-pulse rounded-[10px] bg-muted" /> });

/**
 * Dónde queda el lote, en su cajón, para mirarlo y corregirlo (25/11).
 *
 * Nico: «al seleccionar un lote se abre su drawer, pero debería mostrar el mapa ahí, y poder
 * editarlo también». Dos vistas del mismo punto:
 *   · Plano: el croquis del complejo centrado en el lote. Se corrige arrastrando el punto hasta el
 *     número del solar, que es lo que se reconoce en un croquis.
 *   · Satélite: la foto aérea en sus coordenadas. Se corrige moviendo el mapa debajo del pin hasta
 *     el techo, que es lo que se reconoce en una foto.
 * Guardar cualquiera de las dos pone al día la otra (la calibración del croquis las vincula): son
 * las coordenadas que usan el censo y los pases de las visitas.
 */
type Vista = "plano" | "satelite";
type Punto = { x: number; y: number };

export function UbicacionLote({ unitId, plano: puntoPlano, coordenadas, puedeEditar, alGuardar }: {
    unitId: string; plano: Punto | null; coordenadas: string | null; puedeEditar: boolean; alGuardar: () => void;
}) {
    const [info, setInfo] = useState<{ ancho: number; alto: number; titulo: string } | null | undefined>(undefined);
    useEffect(() => { let vivo = true; planoDeLotes().then((p) => { if (vivo) setInfo(p); }).catch(() => { if (vivo) setInfo(null); }); return () => { vivo = false; }; }, []);
    const latlng = (() => { const [a, b] = String(coordenadas || "").split(/[,;\s]+/).map(Number); return Number.isFinite(a) && Number.isFinite(b) && a !== 0 ? ([a, b] as [number, number]) : null; })();
    const [vista, setVista] = useState<Vista>(puntoPlano ? "plano" : "satelite");
    const [editando, setEditando] = useState(false);
    const [nuevoPlano, setNuevoPlano] = useState<Punto | null>(null);
    const [nuevoGeo, setNuevoGeo] = useState<[number, number] | null>(null);
    const [guardando, setGuardando] = useState(false);
    const hayPlano = !!info && (!!puntoPlano || editando);
    const cambio = vista === "plano" ? !!nuevoPlano : !!nuevoGeo;

    const cancelar = () => { setEditando(false); setNuevoPlano(null); setNuevoGeo(null); };
    const guardar = async () => {
        setGuardando(true);
        try {
            if (vista === "plano" && nuevoPlano) {
                const r = await guardarPuntosPlano([{ unitId, x: nuevoPlano.x, y: nuevoPlano.y }]);
                if (!r.ok) { toast.error({ title: "No se guardó", description: r.error }); return; }
            } else if (vista === "satelite" && nuevoGeo) {
                const r = await guardarUbicacionLote(unitId, nuevoGeo[0], nuevoGeo[1]);
                if (!r.ok) { toast.error({ title: "No se guardó", description: r.error }); return; }
                if (!r.enElPlano) toast.warning({ title: "Guardada", description: "Ese punto cae fuera del croquis: se guardaron las coordenadas, y el punto del plano quedó como estaba." });
            }
            toast.success({ title: "Ubicación guardada", description: "El censo y los pases ya usan la nueva." });
            cancelar(); alGuardar();
        } catch (e) { toast.error({ title: "No se guardó", description: e instanceof Error ? e.message : undefined }); }
        finally { setGuardando(false); }
    };

    if (info === undefined) return <div className="h-[260px] w-full animate-pulse rounded-[10px] bg-muted" />;
    return (
        <div>
            <div className="mb-2 flex flex-wrap items-center gap-2">
                <div className="inline-flex rounded-[8px] bg-muted p-0.5" role="group" aria-label="Vista">
                    {([["plano", "Plano", MapaIcono], ["satelite", "Satélite", Satellite]] as const).map(([k, t, I]) => (
                        <button key={k} type="button" aria-pressed={vista === k} disabled={(k === "plano" && !info) || (editando && cambio)} onClick={() => setVista(k)}
                            className={cn("h-7 px-2.5 rounded-[6px] text-[11.5px] font-semibold inline-flex items-center gap-1.5 transition-all disabled:opacity-40",
                                vista === k ? "bg-card text-foreground shadow-[0_1px_3px_rgba(0,0,0,0.12)]" : "text-muted-foreground hover:text-foreground")}><I size={12} />{t}</button>))}
                </div>
                <div className="ml-auto flex items-center gap-1.5">
                    {!editando && <EnElMapa coordenadas={coordenadas} className="text-[12px] font-semibold" />}
                    {puedeEditar && !editando && (info || vista === "satelite") && (
                        <Button size="sm" variant="outline" className="h-7" onClick={() => setEditando(true)}><Move size={13} /> Corregir</Button>
                    )}
                    {editando && (
                        <>
                            <Button size="sm" variant="ghost" className="h-7" onClick={cancelar} disabled={guardando}><X size={13} /> Cancelar</Button>
                            <Button size="sm" className="h-7" onClick={guardar} disabled={guardando || !cambio}>{guardando ? <Loader2 size={13} /> : <Check size={13} />} Guardar</Button>
                        </>
                    )}
                </div>
            </div>

            {vista === "plano" ? (
                info ? (
                    hayPlano
                        ? <MiniPlano ancho={info.ancho} alto={info.alto} titulo={info.titulo} punto={nuevoPlano || puntoPlano} editando={editando} alMover={setNuevoPlano} />
                        : <p className="rounded-[10px] border border-dashed border-border px-3 py-6 text-center text-[12.5px] text-muted-foreground">Este lote no tiene su punto en el croquis.{puedeEditar ? " Tocá «Corregir» y después el plano donde va." : ""}</p>
                ) : <p className="rounded-[10px] border border-dashed border-border px-3 py-6 text-center text-[12.5px] text-muted-foreground">No hay un croquis cargado: usá la vista satelital.</p>
            ) : (
                latlng || editando
                    ? <MapaPunto key={editando ? "editar" : "mirar"} punto={nuevoGeo || latlng} centro={latlng || [-34.856, -56.074]} soloVer={!editando} alElegir={editando ? (a, b) => setNuevoGeo([Number(a.toFixed(6)), Number(b.toFixed(6))]) : undefined} alto={260} />
                    : <p className="rounded-[10px] border border-dashed border-border px-3 py-6 text-center text-[12.5px] text-muted-foreground">Este lote todavía no tiene ubicación.{puedeEditar ? " Tocá «Corregir» y mové el mapa hasta su techo." : ""}</p>
            )}
            {editando && <p className="mt-1.5 text-[11.5px] text-muted-foreground">{vista === "plano" ? "Arrastrá el punto hasta el número del solar (o tocá el plano donde va)." : "Mové el mapa hasta que el pin quede sobre el techo."}</p>}
        </div>
    );
}

/** El croquis centrado en un punto: se mueve, se acerca, y editando el punto se arrastra. */
function MiniPlano({ ancho, alto, titulo, punto, editando, alMover }: { ancho: number; alto: number; titulo: string; punto: Punto | null; editando: boolean; alMover: (p: Punto) => void }) {
    const caja = useRef<HTMLDivElement>(null);
    const [v, setV] = useState({ s: 0.4, x: 0, y: 0 });
    const [cargada, setCargada] = useState(false);
    const centrar = useCallback(() => {
        const r = caja.current?.getBoundingClientRect(); if (!r) return;
        const p = punto || { x: ancho / 2, y: alto / 2 }; const s = punto ? 0.45 : Math.min(r.width / ancho, r.height / alto);
        setV({ s, x: r.width / 2 - p.x * s, y: r.height / 2 - p.y * s });
        // eslint-disable-next-line react-hooks/exhaustive-deps -- se centra al abrir, no cada vez que el punto se arrastra
    }, [ancho, alto]);
    useLayoutEffect(() => { const id = requestAnimationFrame(centrar); return () => cancelAnimationFrame(id); }, [centrar]);
    const zoom = useCallback((f: number, cx: number, cy: number) => setV((o) => { const s = Math.min(2, Math.max(0.05, o.s * f)); return { s, x: cx - ((cx - o.x) * s) / o.s, y: cy - ((cy - o.y) * s) / o.s }; }), []);
    useEffect(() => {
        const el = caja.current; if (!el) return;
        const rueda = (e: WheelEvent) => { e.preventDefault(); const r = el.getBoundingClientRect(); zoom(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top); };
        el.addEventListener("wheel", rueda, { passive: false });
        return () => el.removeEventListener("wheel", rueda);
    }, [zoom]);
    const aPlano = (cx: number, cy: number): Punto => { const r = caja.current!.getBoundingClientRect(); return { x: Math.min(ancho, Math.max(0, (cx - r.left - v.x) / v.s)), y: Math.min(alto, Math.max(0, (cy - r.top - v.y) / v.s)) }; };
    const g = useRef<{ x: number; y: number; movido: number; punto: boolean } | null>(null);
    const bajar = (e: React.PointerEvent) => {
        if ((e.target as HTMLElement).closest("[data-control]")) return;
        g.current = { x: e.clientX, y: e.clientY, movido: 0, punto: editando && !!(e.target as HTMLElement).closest("[data-punto]") };
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    };
    const mover = (e: React.PointerEvent) => {
        const a = g.current; if (!a) return;
        const dx = e.clientX - a.x, dy = e.clientY - a.y; a.movido += Math.abs(dx) + Math.abs(dy); a.x = e.clientX; a.y = e.clientY;
        if (a.punto) alMover(aPlano(e.clientX, e.clientY)); else setV((o) => ({ ...o, x: o.x + dx, y: o.y + dy }));
    };
    const soltar = (e: React.PointerEvent) => {
        const a = g.current; g.current = null;
        // Editando, un toque en el plano (sin arrastrar) pone el punto ahí: sirve para un lote sin ubicar.
        if (a && !a.punto && a.movido < 5 && editando) alMover(aPlano(e.clientX, e.clientY));
    };
    const px = punto ? v.x + punto.x * v.s : 0, py = punto ? v.y + punto.y * v.s : 0;
    const centro = () => { const b = caja.current?.getBoundingClientRect(); return b ? [b.width / 2, b.height / 2] as const : [0, 0] as const; };
    return (
        <div ref={caja} onPointerDown={bajar} onPointerMove={mover} onPointerUp={soltar} onPointerCancel={() => { g.current = null; }}
            className={cn("relative h-[260px] overflow-hidden rounded-[10px] border border-border bg-white touch-none select-none", editando ? "cursor-crosshair" : "cursor-grab active:cursor-grabbing")}>
            <div className="absolute left-0 top-0 origin-top-left will-change-transform" style={{ transform: `translate(${v.x}px, ${v.y}px) scale(${v.s})`, width: ancho, height: alto }}>
                {/* eslint-disable-next-line @next/next/no-img-element -- una imagen de 5000 px que se escala con transform */}
                <img src="/api/administraciones/plano" alt={titulo} width={ancho} height={alto} draggable={false} onLoad={() => setCargada(true)}
                    className={cn("block h-full w-full transition-opacity duration-300", cargada ? "opacity-100" : "opacity-0")} />
            </div>
            {/* El punto, en pantalla y no escalado: un aro alrededor del número del solar, que no lo tapa. */}
            {punto && (
                <span data-punto className={cn("absolute grid h-9 w-9 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-[3px] border-[var(--accion)] bg-[color-mix(in_oklab,var(--accion)_14%,transparent)]",
                    editando ? "cursor-move ring-4 ring-[var(--accion)]/25" : "pointer-events-none")} style={{ left: px, top: py }}>
                    <span className="h-1.5 w-1.5 rounded-full bg-[var(--accion)]" />
                </span>
            )}
            {!cargada && <div className="absolute inset-0 grid place-items-center text-[12px] text-muted-foreground">Dibujando el croquis…</div>}
            <div data-control className="absolute right-2 bottom-2 flex flex-col gap-1">
                <Button size="icon" variant="outline" className="h-8 w-8 bg-card" aria-label="Acercar" onClick={() => { const [x, y] = centro(); zoom(1.5, x, y); }}><Plus size={14} /></Button>
                <Button size="icon" variant="outline" className="h-8 w-8 bg-card" aria-label="Alejar" onClick={() => { const [x, y] = centro(); zoom(1 / 1.5, x, y); }}><Minus size={14} /></Button>
                <Button size="icon" variant="outline" className="h-8 w-8 bg-card" aria-label="Centrar en el lote" onClick={centrar}><Crosshair size={14} /></Button>
            </div>
        </div>
    );
}
