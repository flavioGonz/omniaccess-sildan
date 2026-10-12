"use client";

import { useEffect, useMemo, useState } from "react";
import { MapContainer, TileLayer, Polygon, Polyline, Marker, Tooltip as LTooltip, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Loader2, MapPin, Pentagon, Pencil, Plus, Save, X, Trash2, Check, Undo2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { getBarrioMap, saveBarrioMap, type BarrioMapData } from "@/app/actions/barriomap";
import { createUnit } from "@/app/actions/units";
import { sileo as toast } from "sileo";

/**
 * El mapa del barrio, chico, para elegir un lote — y, con el lápiz, para dibujarlo.
 *
 * Lee los MISMOS lotes que el mapa grande (ajuste BARRIO_MAP). En Olivos cada lote se llama
 * como su unidad («A18»), así que la unidad del lote sale del nombre cuando el lote no la
 * trae atada. Con el lápiz: tocar un lote lo deja editar (mover vértices, renombrar, borrar)
 * y «Nuevo lote» dibuja uno punto a punto; al guardar, si no hay unidad con ese nombre, se
 * crea, y el lote nuevo queda elegido para la persona que se está cargando.
 */

const CENTRO_POR_DEFECTO: [number, number] = [-34.9011, -56.1645];

function Acomodar({ cuando }: { cuando: unknown }) {
    const map = useMap();
    useEffect(() => { const t = setTimeout(() => map.invalidateSize(), 120); return () => clearTimeout(t); }, [map, cuando]);
    return null;
}
function Encuadrar({ puntos, congelar }: { puntos: [number, number][][]; congelar?: boolean }) {
    const map = useMap();
    useEffect(() => {
        if (congelar) return;
        const todos = puntos.flat(); if (!todos.length) return;
        try { map.fitBounds(todos as any, { padding: [28, 28], maxZoom: 19, animate: false }); } catch { }
    }, [map, JSON.stringify(puntos), congelar]); // eslint-disable-line react-hooks/exhaustive-deps
    return null;
}
function Clics({ activo, alTocar }: { activo: boolean; alTocar: (p: [number, number]) => void }) {
    useMapEvents({ click: (e) => { if (activo) alTocar([e.latlng.lat, e.latlng.lng]); } });
    return null;
}
const vertice = (activo: boolean) => L.divIcon({ className: "", iconSize: [14, 14], iconAnchor: [7, 7],
    html: `<span style="display:block;width:14px;height:14px;border-radius:999px;background:${activo ? "#f59e0b" : "#fff"};border:2px solid #f59e0b;box-shadow:0 1px 4px rgba(0,0,0,.6)"></span>` });

export type LoteDelMapa = { id: string; label: string; unitId?: string | null; parkingSlotId?: string | null; points: [number, number][] };
type Crudo = { id: string; name?: string; label?: string; unitId?: string | null; parkingSlotId?: string; points: [number, number][]; [k: string]: any };

export function MapaLotes({ unidadId, loteElegido, alElegir, nombreDeUnidad, alto = 300, soloConUnidad, alCargar, pie, unidades, alCrearUnidad, editable = true }: {
    unidadId?: string | null;
    loteElegido?: string | null;
    alElegir: (lote: LoteDelMapa | null) => void;
    nombreDeUnidad?: (unitId: string) => string | undefined;
    alto?: number;
    soloConUnidad?: boolean;
    alCargar?: (lotes: LoteDelMapa[]) => void;
    pie?: { conElegido?: (lote: LoteDelMapa) => string; sinElegir?: string };
    /** Las unidades del padrón: para atar cada lote a la suya por el nombre. */
    unidades?: { id: string; name: string }[];
    /** Se creó una unidad desde el mapa (lote nuevo): quien lo usa la suma a su lista. */
    alCrearUnidad?: (u: any) => void;
    editable?: boolean;
}) {
    const [mapa, setMapa] = useState<BarrioMapData | null>(null);
    const [crudos, setCrudos] = useState<Crudo[]>([]);
    const [error, setError] = useState<string | null>(null);
    // Edición
    const [editando, setEditando] = useState(false);
    const [dibujando, setDibujando] = useState(false);
    const [nuevo, setNuevo] = useState<[number, number][]>([]);
    const [selId, setSelId] = useState<string | null>(null);
    const [nombreSel, setNombreSel] = useState("");
    const [crearUnidad, setCrearUnidad] = useState(true);
    const [sucio, setSucio] = useState(false);
    const [guardando, setGuardando] = useState(false);
    const [idNuevo, setIdNuevo] = useState<string | null>(null);

    const cargar = () => getBarrioMap()
        .then((d) => { setMapa(d); setCrudos(((d?.lotes || []) as Crudo[]).map((x) => ({ ...x }))); setError(null); })
        .catch((e: any) => setError(e?.message || "No se pudo traer el mapa del barrio."));
    useEffect(() => { cargar(); }, []);

    const porNombre = useMemo(() => new Map((unidades || []).map((u) => [String(u.name).trim().toUpperCase(), u.id])), [unidades]);
    const lotes = useMemo<LoteDelMapa[]>(() => crudos.map((x) => {
        const label = x.label || x.name || "Lote";
        return { id: x.id, label, points: x.points, parkingSlotId: x.parkingSlotId || null, unitId: x.unitId || porNombre.get(String(label).trim().toUpperCase()) || null };
    }), [crudos, porNombre]);
    useEffect(() => { if (lotes.length) alCargar?.(lotes); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [lotes]);

    const elegido = lotes.find((l) => l.id === loteElegido) || (loteElegido == null && unidadId ? lotes.find((l) => l.unitId === unidadId) : undefined);
    const idElegido = elegido?.id ?? null;
    const sel = crudos.find((x) => x.id === selId) || null;
    const aEncuadrar = elegido ? [elegido.points] : lotes.map((l) => l.points);

    const empezarEdicion = () => { setEditando(true); setSelId(null); setDibujando(false); setNuevo([]); };
    const salir = () => { if (sucio) cargar(); setEditando(false); setDibujando(false); setNuevo([]); setSelId(null); setSucio(false); setIdNuevo(null); };
    const elegirParaEditar = (id: string) => { const x = crudos.find((c) => c.id === id); setSelId(id); setNombreSel(x?.label || x?.name || ""); setCrearUnidad(false); setDibujando(false); };
    const terminarDibujo = () => {
        if (nuevo.length < 3) { toast.error({ title: "Marcá al menos 3 puntos" }); return; }
        const id = `l_${Date.now()}`;
        setCrudos((c) => [...c, { id, name: "", points: nuevo }]);
        setIdNuevo(id); setSelId(id); setNombreSel(""); setCrearUnidad(true); setNuevo([]); setDibujando(false); setSucio(true);
    };
    const moverVertice = (i: number, p: [number, number]) => { setCrudos((c) => c.map((x) => x.id === selId ? { ...x, points: x.points.map((q, j) => (j === i ? p : q)) } : x)); setSucio(true); };
    const borrarSel = () => { setCrudos((c) => c.filter((x) => x.id !== selId)); setSelId(null); setSucio(true); };
    const renombrar = (v: string) => { setNombreSel(v); setCrudos((c) => c.map((x) => x.id === selId ? { ...x, name: v, ...(x.label !== undefined ? { label: v } : {}) } : x)); setSucio(true); };

    const guardar = async () => {
        const sinNombre = crudos.find((x) => !String(x.name || x.label || "").trim());
        if (sinNombre) { setSelId(sinNombre.id); toast.error({ title: "Ponele nombre al lote", description: "Ej.: el nombre de la casa, «A18»." }); return; }
        setGuardando(true);
        try {
            const r = await saveBarrioMap({ lotes: crudos } as any);
            if (!r.ok) throw new Error(r.error);
            let unidadNueva: any = null;
            const lo = idNuevo ? crudos.find((x) => x.id === idNuevo) : null;
            const nombre = String(lo?.name || "").trim();
            if (lo && crearUnidad && nombre && !porNombre.has(nombre.toUpperCase())) {
                const f = new FormData(); f.append("name", nombre); f.append("type", "CASA");
                unidadNueva = await createUnit(f);
                alCrearUnidad?.(unidadNueva);
            }
            toast.success({ title: "Plano guardado", description: unidadNueva ? `Lote y unidad ${nombre} creados` : undefined });
            if (lo) {
                const uid = unidadNueva?.id || porNombre.get(nombre.toUpperCase()) || null;
                alElegir({ id: lo.id, label: nombre, points: lo.points, unitId: uid, parkingSlotId: null });
            }
            setSucio(false); setEditando(false); setSelId(null); setIdNuevo(null);
            await cargar();
        } catch (e: any) { toast.error({ title: "No se pudo guardar el plano", description: e?.message }); }
        finally { setGuardando(false); }
    };

    if (error) return (
        <div style={{ height: alto }} className="rounded-lg border border-border bg-muted/40 flex flex-col items-center justify-center gap-1 text-center px-6">
            <MapPin size={20} className="text-muted-foreground/50" /><p className="text-[12.5px] font-semibold">No se pudo traer el mapa</p><p className="text-[11.5px] text-muted-foreground">{error}</p>
        </div>
    );
    if (!mapa) return <div style={{ height: alto }} className="rounded-lg border border-border bg-muted/40 flex items-center justify-center"><Loader2 size={18} className="animate-spin text-muted-foreground" /></div>;

    const vacio = !lotes.length && !editando;
    const btn = "h-8 px-2.5 rounded-lg text-[12px] font-semibold inline-flex items-center gap-1.5 backdrop-blur-md transition-colors";

    return (
        <div style={{ height: editando ? Math.max(alto, 340) : alto }} className={cn("rounded-lg overflow-hidden border relative transition-[height]", editando ? "border-amber-500/70 ring-1 ring-amber-500/40" : "border-border")}>
            <MapContainer center={(mapa.center as [number, number]) || CENTRO_POR_DEFECTO} zoom={mapa.zoom || 17} zoomControl={false} attributionControl={false} doubleClickZoom={!dibujando}
                style={{ height: "100%", width: "100%", background: "var(--muted)", cursor: dibujando ? "crosshair" : undefined }}>
                <TileLayer url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}" maxZoom={21} maxNativeZoom={19} />
                <Acomodar cuando={`${alto}-${editando}`} />
                <Encuadrar puntos={aEncuadrar} congelar={editando} />
                <Clics activo={dibujando} alTocar={(p) => setNuevo((n) => [...n, p])} />

                {lotes.map((lo) => {
                    const esEste = !editando && lo.id === idElegido;
                    const enEdicion = editando && lo.id === selId;
                    const sinCasa = soloConUnidad && !lo.unitId && !editando;
                    const deOtra = !editando && !esEste && !!lo.unitId && lo.unitId !== unidadId;
                    const nombreEste = lo.unitId && nombreDeUnidad ? nombreDeUnidad(lo.unitId) : undefined;
                    const apagado = sinCasa || deOtra;
                    const color = enEdicion ? "#f59e0b" : esEste ? "#f59e0b" : editando ? "#fde68a" : apagado ? "#64748b" : "#38bdf8";
                    return (
                        <Polygon key={lo.id} positions={lo.points}
                            pathOptions={{ color, weight: esEste || enEdicion ? 3 : 2, dashArray: sinCasa ? "5 5" : undefined, fillColor: color, fillOpacity: esEste || enEdicion ? 0.34 : apagado ? 0.08 : 0.16 }}
                            eventHandlers={{ click: () => { if (dibujando) return; if (editando) elegirParaEditar(lo.id); else if (!sinCasa) alElegir(esEste ? null : lo); } }}>
                            <LTooltip direction="center" sticky>
                                <span className="font-semibold">{lo.label}</span>
                                {nombreEste && !editando && <span className="opacity-70"> · {nombreEste === lo.label ? "unidad" : nombreEste}</span>}
                                {sinCasa && <span className="opacity-70"> · sin unidad con ese nombre</span>}
                                {editando && <span className="opacity-70"> · tocá para editar</span>}
                            </LTooltip>
                        </Polygon>
                    );
                })}

                {/* Vértices del lote en edición: se arrastran. */}
                {editando && sel && sel.points.map((p, i) => (
                    <Marker key={`${sel.id}-${i}`} position={p} draggable icon={vertice(false)}
                        eventHandlers={{ dragend: (e: any) => { const ll = e.target.getLatLng(); moverVertice(i, [ll.lat, ll.lng]); } }} />
                ))}
                {/* El lote que se está dibujando */}
                {dibujando && nuevo.length > 0 && <Polyline positions={nuevo.length > 2 ? [...nuevo, nuevo[0]] : nuevo} pathOptions={{ color: "#f59e0b", weight: 2, dashArray: "6 4" }} />}
                {dibujando && nuevo.map((p, i) => <Marker key={`n-${i}`} position={p} icon={vertice(i === 0)} />)}
            </MapContainer>

            {vacio && (
                <div className="absolute inset-0 z-[450] flex flex-col items-center justify-center gap-1.5 text-center px-8 bg-background/80 backdrop-blur-sm">
                    <Pentagon size={20} className="text-muted-foreground/60" />
                    <p className="text-[12.5px] font-semibold">Todavía no hay lotes dibujados</p>
                    <p className="text-[11.5px] text-muted-foreground max-w-xs">Tocá el lápiz y dibujá el contorno de la casa, punto por punto.</p>
                </div>
            )}

            {/* Barra de arriba: lápiz y herramientas */}
            {editable && (
                <div className="absolute top-2 right-2 left-2 z-[500] flex items-center justify-end gap-1.5 flex-wrap">
                    {!editando ? (
                        <button type="button" onClick={empezarEdicion} title="Editar los lotes del plano" className={cn(btn, "bg-background/90 border border-border hover:bg-background")}><Pencil size={13} /> Editar lotes</button>
                    ) : (<>
                        {!dibujando ? (
                            <button type="button" onClick={() => { setDibujando(true); setSelId(null); setNuevo([]); }} className={cn(btn, "bg-amber-500 text-black hover:bg-amber-400")}><Plus size={13} /> Nuevo lote</button>
                        ) : (<>
                            <span className="h-8 px-2.5 rounded-lg bg-black/70 text-white text-[11.5px] inline-flex items-center">Tocá el mapa en cada esquina · {nuevo.length} puntos</span>
                            <button type="button" onClick={() => setNuevo((n) => n.slice(0, -1))} disabled={!nuevo.length} className={cn(btn, "bg-background/90 border border-border disabled:opacity-40")}><Undo2 size={13} /></button>
                            <button type="button" onClick={terminarDibujo} disabled={nuevo.length < 3} className={cn(btn, "bg-amber-500 text-black disabled:opacity-40")}><Check size={13} /> Terminar</button>
                        </>)}
                        <span className="flex-1" />
                        <button type="button" onClick={salir} className={cn(btn, "bg-background/90 border border-border")}><X size={13} /> Cancelar</button>
                        <button type="button" onClick={guardar} disabled={!sucio || guardando || dibujando} className={cn(btn, "bg-emerald-600 text-white hover:bg-emerald-500 disabled:opacity-40")}>{guardando ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Guardar plano</button>
                    </>)}
                </div>
            )}

            {/* Abajo: ficha del lote en edición, o el texto de elección */}
            {editando && sel ? (
                <div className="absolute bottom-2 left-2 right-2 z-[500] rounded-lg bg-background/95 backdrop-blur-sm border border-border p-2 flex items-center gap-2 flex-wrap">
                    <Pentagon size={15} className="text-amber-500 shrink-0" />
                    <input value={nombreSel} onKeyDown={(e) => { if (e.key === "Enter") e.preventDefault(); }} onChange={(e) => renombrar(e.target.value.toUpperCase())} placeholder="Nombre del lote. Ej.: A18" autoFocus
                        className="h-8 w-36 rounded-md border border-border bg-background px-2 text-[12.5px] font-semibold uppercase outline-none focus:border-amber-500" />
                    {selId === idNuevo && nombreSel && !porNombre.has(nombreSel.trim().toUpperCase()) && (
                        <label className="inline-flex items-center gap-1.5 text-[11.5px]"><input type="checkbox" checked={crearUnidad} onChange={(e) => setCrearUnidad(e.target.checked)} className="accent-amber-500" /> Crear la unidad {nombreSel}</label>
                    )}
                    {nombreSel && porNombre.has(nombreSel.trim().toUpperCase()) && <span className="text-[11px] text-emerald-500 font-semibold">unidad existente</span>}
                    <span className="flex-1 text-[11px] text-muted-foreground hidden sm:block">Arrastrá los puntos para ajustar el contorno.</span>
                    <button type="button" onClick={borrarSel} className="h-8 w-8 grid place-items-center rounded-md text-red-500 hover:bg-red-500/10" title="Borrar este lote"><Trash2 size={14} /></button>
                </div>
            ) : !editando && !vacio ? (
                <div className="absolute bottom-2 left-2 right-2 z-[500] px-3 py-1.5 rounded-lg bg-background/92 backdrop-blur-sm border border-border text-[11.5px] pointer-events-none">
                    {elegido
                        ? <span>{pie?.conElegido ? pie.conElegido(elegido) : <><span className="font-semibold">{elegido.label}</span> · tocá el contorno otra vez para soltarlo</>}</span>
                        : <span className="text-muted-foreground">{pie?.sinElegir || "Tocá el contorno de esta propiedad en el plano"}</span>}
                </div>
            ) : editando && !dibujando ? (
                <div className="absolute bottom-2 left-2 right-2 z-[500] px-3 py-1.5 rounded-lg bg-background/92 backdrop-blur-sm border border-border text-[11.5px] text-muted-foreground pointer-events-none">
                    Tocá un lote para editarlo, o «Nuevo lote» para dibujar uno.
                </div>
            ) : null}
        </div>
    );
}
