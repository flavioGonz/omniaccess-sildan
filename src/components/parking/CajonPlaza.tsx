"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Loader2, MapPin, Route, Search, SquareParking, Trash2, UserPlus, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Pista } from "@/components/ui/pista";
import { Cajon, CajonContenido, CajonSeccion } from "@/components/ui/cajon";
import { Cargando, ErrorEstado } from "@/components/ui/estados";
import { Estado, Matricula } from "@/components/ui/celdas";
import { toast } from "@/lib/avisos";
import { cn } from "@/lib/utils";
import { asignarPlaza, buscarPersonasParaPlaza, datosPlaza } from "@/app/actions/parking";
import { getParkingElements } from "@/app/actions/plazas";

/**
 * La plaza de una matrícula: dónde estaciona, cómo se llega, y asignarla si no tiene.
 *
 * Era un diálogo que, sin plaza, decía «Sin plaza asignada» y nada más: no había cómo
 * resolverlo desde ahí. Y en San Nicolás es el caso de casi todas: 114 plazas dibujadas en
 * el plano y una sola asignada. Ahora el cajón dice de quién es la matrícula, muestra el
 * plano con todas las plazas (libres, ocupadas, la suya) y se elige tocando una.
 *
 * La plaza es de una PERSONA, no de un auto: la matrícula llega a la plaza por su dueño.
 * Si la matrícula no es de nadie, primero se elige de quién es (o se registra la persona).
 */

type Datos = Awaited<ReturnType<typeof datosPlaza>>;
type Plaza = Datos["plazas"][number];
type Persona = Awaited<ReturnType<typeof buscarPersonasParaPlaza>>[number];
type P = { x: number; y: number };

const puntosDe = (raw: any): P[] => {
    try {
        const arr = typeof raw === "string" ? JSON.parse(raw) : raw;
        if (!Array.isArray(arr)) return [];
        // Los planos viejos guardan 0–1 y los nuevos 0–100: se lleva todo a 0–100.
        return arr.map((p: any) => ({ x: p.x <= 1 ? p.x * 100 : p.x, y: p.y <= 1 ? p.y * 100 : p.y }));
    } catch { return []; }
};
const centro = (pts: P[]): P | null => pts.length ? { x: pts.reduce((a, p) => a + p.x, 0) / pts.length, y: pts.reduce((a, p) => a + p.y, 0) / pts.length } : null;

/** El camino desde la entrada más cercana hasta la plaza, por las calles dibujadas (Dijkstra sobre sus vértices). */
function camino(destino: P | null, elems: any): P[] | null {
    if (!destino || !elems) return null;
    const entradas: P[] = puntosDe(elems.entradas || []);
    if (!entradas.length) return null;
    const D = (a: P, b: P) => Math.hypot(a.x - b.x, a.y - b.y);
    const ent = entradas.reduce((m, e) => (D(e, destino) < D(m, destino) ? e : m), entradas[0]);
    const nodos: P[] = [];
    const nodo = (p: P) => { for (let i = 0; i < nodos.length; i++) if (D(nodos[i], p) < 1.4) return i; nodos.push(p); return nodos.length - 1; };
    const ady = new Map<number, { a: number; w: number }[]>();
    const unir = (a: number, b: number) => { const w = D(nodos[a], nodos[b]); (ady.get(a) || ady.set(a, []).get(a)!).push({ a: b, w }); (ady.get(b) || ady.set(b, []).get(b)!).push({ a, w }); };
    for (const c of elems.calles || []) { let prev = -1; for (const pt of puntosDe(c.points)) { const id = nodo(pt); if (prev >= 0 && prev !== id) unir(prev, id); prev = id; } }
    if (nodos.length < 2) return [ent, destino];
    const cerca = (p: P) => nodos.reduce((bi, n, i) => (D(n, p) < D(nodos[bi], p) ? i : bi), 0);
    const s = cerca(ent), t = cerca(destino);
    const dist = nodos.map(() => Infinity), prev = nodos.map(() => -1), visto = nodos.map(() => false); dist[s] = 0;
    for (let k = 0; k < nodos.length; k++) {
        let u = -1; for (let i = 0; i < nodos.length; i++) if (!visto[i] && (u < 0 || dist[i] < dist[u])) u = i;
        if (u < 0 || dist[u] === Infinity) break; visto[u] = true;
        for (const e of ady.get(u) || []) if (dist[u] + e.w < dist[e.a]) { dist[e.a] = dist[u] + e.w; prev[e.a] = u; }
    }
    const medio: P[] = []; for (let c = t; c >= 0; c = prev[c]) medio.unshift(nodos[c]);
    return medio.length > 1 ? [ent, ...medio, destino] : [ent, destino];
}

export function CajonPlaza({ plate, onClose, onRegistrar, alCambiar }: {
    plate: string | null;
    onClose: () => void;
    /** Registrar a la persona dueña (el flujo de «Registrar» del monitor). */
    onRegistrar?: (plate: string) => void;
    /** Se asignó o se sacó una plaza: refrescar lo de atrás. */
    alCambiar?: () => void;
}) {
    const [d, setD] = useState<Datos | null>(null);
    const [elems, setElems] = useState<any>(null);
    const [error, setError] = useState<string | null>(null);
    const [elegida, setElegida] = useState<string | null>(null);
    const [persona, setPersona] = useState<Persona | null>(null);
    const [buscar, setBuscar] = useState("");
    const [personas, setPersonas] = useState<Persona[]>([]);
    const [filtroPlaza, setFiltroPlaza] = useState("");
    const [sobre, setSobre] = useState<Plaza | null>(null);
    const [guardando, setGuardando] = useState(false);
    const [pisar, setPisar] = useState<string | null>(null);

    const cargar = async () => {
        if (!plate) return;
        setError(null);
        try {
            const [x, e] = await Promise.all([datosPlaza(plate), getParkingElements().catch(() => null)]);
            setD(x); setElems(e); setElegida(x.duenio?.plazaId || null);
        } catch (e: any) { setError(e?.message || "No se pudo leer la plaza."); }
    };
    useEffect(() => { setD(null); setPersona(null); setBuscar(""); setFiltroPlaza(""); setPisar(null); cargar(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [plate]);

    // Buscar dueño sólo cuando la matrícula no tiene.
    useEffect(() => {
        if (!d || d.duenio) return;
        const t = setTimeout(() => { buscarPersonasParaPlaza(buscar).then(setPersonas).catch(() => setPersonas([])); }, 250);
        return () => clearTimeout(t);
    }, [buscar, d]);

    // El plano en píxeles, como en la versión anterior: en un viewBox 0–100 deformado los círculos salen ovalados.
    const imgRef = useRef<HTMLImageElement>(null);
    const [caja, setCaja] = useState({ w: 0, h: 0 });
    useEffect(() => {
        const el = imgRef.current; if (!el) return;
        const medir = () => setCaja({ w: el.clientWidth, h: el.clientHeight });
        medir(); const ro = new ResizeObserver(medir); ro.observe(el);
        return () => ro.disconnect();
    }, [d?.mapUrl]);
    const px = (p: P) => ({ x: (p.x / 100) * caja.w, y: (p.y / 100) * caja.h });

    const duenioId = d?.duenio?.id || persona?.id || null;
    const actual = d?.plazas.find((p) => p.id === d?.duenio?.plazaId) || null;
    const seleccion = d?.plazas.find((p) => p.id === elegida) || null;
    const formas = useMemo(() => (d?.plazas || []).map((p) => ({ p, pts: puntosDe(p.points) })).filter((x) => x.pts.length >= 3), [d]);
    const ruta = useMemo(() => camino(seleccion ? centro(puntosDe(seleccion.points)) : null, elems), [seleccion, elems]);
    const libres = (d?.plazas || []).filter((p) => !p.ocupadaPor || p.ocupadaPor.id === duenioId);
    const listaPlazas = (d?.plazas || []).filter((p) => !filtroPlaza || p.label.toLowerCase().includes(filtroPlaza.toLowerCase())).slice(0, 60);
    const cambio = !!d && (elegida !== (d.duenio?.plazaId || null));

    const guardar = async (slotId: string | null, reasignar = false) => {
        if (!plate || !duenioId) return;
        setGuardando(true);
        const r = await asignarPlaza({ plate, userId: duenioId, slotId, reasignar });
        setGuardando(false);
        if (!r.ok) {
            if (r.ocupadaPor) { setPisar(r.ocupadaPor); return; }
            toast.error("No se pudo asignar", { description: r.error }); return;
        }
        setPisar(null);
        toast.success(slotId ? `${plate} · plaza ${r.label}` : `${plate} sin plaza`, { description: slotId ? "Queda asignada a su dueño. El ícono de plaza se pone verde en el monitor." : "Se le sacó la plaza a su dueño." });
        alCambiar?.();
        await cargar();
    };

    return (
        <Cajon open={!!plate} onOpenChange={(o) => { if (!o && !guardando) onClose(); }}>
            {plate && (
                <CajonContenido ancho="ancho" titulo={`Plaza de ${plate}`}
                    descripcion={actual ? `Estaciona en ${actual.label}. Tocá otra plaza del plano para cambiarla.` : "Todavía no tiene plaza. Elegí una en el plano."}
                    pie={d && duenioId ? (
                        <>
                            {pisar && (
                                <span className="mr-auto flex items-center gap-2 text-[12.5px]">
                                    <span className="tono-aviso font-semibold">{seleccion?.label} es de {pisar}.</span>
                                    <Button size="sm" variant="outline" onClick={() => guardar(elegida, true)} disabled={guardando} className="h-8 text-[12px] font-semibold">Pasársela igual</Button>
                                </span>
                            )}
                            {!pisar && actual && (
                                <Button variant="ghost" onClick={() => { setElegida(null); guardar(null); }} disabled={guardando}
                                    className="mr-auto h-9 px-3 text-[13px] font-semibold gap-1.5 tono-mal">
                                    <Trash2 size={14} /> Sacar la plaza
                                </Button>
                            )}
                            <Button variant="ghost" onClick={onClose} disabled={guardando} className="h-9 px-4 text-[13px] font-semibold text-muted-foreground">Cerrar</Button>
                            <Button onClick={() => guardar(elegida)} disabled={guardando || !cambio || !elegida}
                                className="accion h-9 px-4 rounded-md text-[13px] font-semibold gap-1.5">
                                {guardando ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                                {seleccion ? `Asignar ${seleccion.label}` : "Elegí una plaza"}
                            </Button>
                        </>
                    ) : undefined}>

                    {error && <ErrorEstado mensaje={error} alReintentar={cargar} className="py-16" />}
                    {!d && !error && <Cargando texto="Buscando la plaza…" className="py-16" />}

                    {d && (
                        <>
                            {/* ── De quién es ── */}
                            <CajonSeccion titulo="De quién es" icono={UserRound}
                                pista="La plaza es de una persona, no de un auto: todos sus vehículos estacionan en la misma. Por eso, si la matrícula no está a nombre de nadie, primero se dice de quién es.">
                                <div className="flex items-center gap-3 flex-wrap">
                                    <Matricula p={plate} className="text-[15px] px-2.5 py-1" />
                                    {d.duenio ? (
                                        <>
                                            <span className="text-[13.5px] font-semibold">{d.duenio.nombre}</span>
                                            {d.duenio.unidad && <Estado tono="neutro">{d.duenio.unidad}</Estado>}
                                            {actual ? <Estado tono="bien" icono={SquareParking}>{actual.label}</Estado> : <Estado tono="aviso">Sin plaza</Estado>}
                                        </>
                                    ) : persona ? (
                                        <>
                                            <span className="text-[13.5px] font-semibold">{persona.nombre}</span>
                                            {persona.unidad && <Estado tono="neutro">{persona.unidad}</Estado>}
                                            <button onClick={() => setPersona(null)} className="text-[12px] font-semibold tono-accion">Cambiar</button>
                                        </>
                                    ) : <span className="text-[12.5px] text-muted-foreground">No está a nombre de nadie del barrio.</span>}
                                </div>

                                {!d.duenio && !persona && (
                                    <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_auto] gap-3 items-start">
                                        <div className="space-y-2">
                                            <div className="relative">
                                                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                                                <Input value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="Buscar a la persona por nombre o lote" className="h-9 pl-9" autoFocus />
                                            </div>
                                            <div className="rounded-[10px] border border-border divide-y divide-border max-h-52 overflow-y-auto">
                                                {personas.map((p) => (
                                                    <button key={p.id} type="button" onClick={() => setPersona(p)}
                                                        className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-accent transition-colors">
                                                        <UserRound size={14} className="text-muted-foreground shrink-0" />
                                                        <span className="text-[12.5px] font-semibold truncate flex-1">{p.nombre}</span>
                                                        <span className="text-[11px] text-muted-foreground shrink-0">{[p.unidad, p.plaza ? `plaza ${p.plaza}` : null].filter(Boolean).join(" · ")}</span>
                                                    </button>
                                                ))}
                                                {!personas.length && <p className="px-3 py-4 text-center text-[12px] text-muted-foreground">Nadie coincide.</p>}
                                            </div>
                                        </div>
                                        {onRegistrar && (
                                            <Pista texto="Si es alguien que todavía no está cargado: se abre el registro con la matrícula puesta. Después volvés acá a darle la plaza.">
                                                <Button variant="outline" onClick={() => onRegistrar(plate)} className="h-9 gap-1.5 text-[12.5px] font-semibold">
                                                    <UserPlus size={14} /> Registrar persona nueva
                                                </Button>
                                            </Pista>
                                        )}
                                    </div>
                                )}
                            </CajonSeccion>

                            {/* ── El plano ── */}
                            <CajonSeccion titulo="Plaza" icono={SquareParking}
                                pista="Libres en contorno, ocupadas por otra persona en gris, la elegida en azul con el camino desde la entrada más cercana. Pasá el mouse por una plaza para ver de quién es.">
                                {!duenioId && <p className="text-[12.5px] text-muted-foreground">Primero elegí de quién es la matrícula; después tocás la plaza.</p>}
                                <div className="flex items-center gap-3 flex-wrap text-[11.5px] text-muted-foreground">
                                    <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm border-2 border-[var(--accion)] bg-[color-mix(in_oklab,var(--accion)_30%,transparent)]" /> Elegida</span>
                                    <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm border border-foreground/40" /> Libre</span>
                                    <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-foreground/25" /> De otra persona</span>
                                    {ruta && <span className="flex items-center gap-1.5"><Route size={12} /> Camino desde la entrada</span>}
                                    <span className="ml-auto tabular-nums">{libres.length} libres de {d.plazas.length}</span>
                                </div>

                                {d.mapUrl ? (
                                    <div className="relative rounded-[10px] overflow-hidden border border-border bg-muted">
                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                        <img ref={imgRef} src={d.mapUrl} alt="Plano del barrio" draggable={false}
                                            className="w-full max-h-[62vh] object-contain grayscale opacity-60 dark:invert select-none"
                                            onLoad={() => setCaja({ w: imgRef.current?.clientWidth || 0, h: imgRef.current?.clientHeight || 0 })} />
                                        {caja.w > 0 && (
                                            <svg className="absolute inset-0 w-full h-full" viewBox={`0 0 ${caja.w} ${caja.h}`}>
                                                {formas.map(({ p, pts }) => {
                                                    const esElegida = p.id === elegida;
                                                    const deOtro = !!p.ocupadaPor && p.ocupadaPor.id !== duenioId;
                                                    const dPath = pts.map((q, i) => { const r = px(q); return `${i ? "L" : "M"} ${r.x} ${r.y}`; }).join(" ") + " Z";
                                                    return (
                                                        <path key={p.id} d={dPath}
                                                            onMouseEnter={() => setSobre(p)} onMouseLeave={() => setSobre((s) => (s?.id === p.id ? null : s))}
                                                            onClick={() => { if (duenioId) { setElegida(p.id); setPisar(null); } }}
                                                            className={cn("transition-colors", duenioId ? "cursor-pointer" : "cursor-not-allowed")}
                                                            fill={esElegida ? "color-mix(in oklab, var(--accion) 38%, transparent)" : deOtro ? "color-mix(in oklab, var(--foreground) 22%, transparent)" : sobre?.id === p.id ? "color-mix(in oklab, var(--accion) 14%, transparent)" : "transparent"}
                                                            stroke={esElegida ? "var(--accion)" : "color-mix(in oklab, var(--foreground) 45%, transparent)"}
                                                            strokeWidth={esElegida ? 2.5 : 1} strokeLinejoin="round" />
                                                    );
                                                })}
                                                {ruta && (() => {
                                                    const r = ruta.map(px);
                                                    const dd = r.map((q, i) => `${i ? "L" : "M"} ${q.x} ${q.y}`).join(" ");
                                                    const o = r[0];
                                                    return (
                                                        <g className="pointer-events-none">
                                                            <path d={dd} fill="none" stroke="var(--background)" strokeOpacity={0.8} strokeWidth={8} strokeLinecap="round" strokeLinejoin="round" />
                                                            <path d={dd} fill="none" stroke="var(--accion)" strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" strokeDasharray="10 7" />
                                                            <circle cx={o.x} cy={o.y} r={7} fill="var(--background)" stroke="var(--accion)" strokeWidth={3} />
                                                        </g>
                                                    );
                                                })()}
                                            </svg>
                                        )}
                                        {sobre && (
                                            <div className="absolute top-3 left-3 rounded-[10px] bg-popover border border-border px-3 py-2 text-[12px] pointer-events-none" style={{ boxShadow: "var(--sombra-flotante, 0 8px 24px rgba(0,0,0,.25))" }}>
                                                <p className="font-bold flex items-center gap-1.5"><MapPin size={12} /> {sobre.label}</p>
                                                <p className="text-muted-foreground">{sobre.ocupadaPor ? (sobre.ocupadaPor.id === duenioId ? "Es la suya" : `De ${sobre.ocupadaPor.nombre}`) : "Libre"}</p>
                                            </div>
                                        )}
                                    </div>
                                ) : (
                                    <p className="text-[12.5px] text-muted-foreground">No hay plano del barrio cargado: se elige por número.</p>
                                )}

                                {/* Por número, para cuando se sabe cuál es o el plano no alcanza. */}
                                <div className="space-y-2">
                                    <div className="relative max-w-xs">
                                        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                                        <Input value={filtroPlaza} onChange={(e) => setFiltroPlaza(e.target.value)} placeholder="Buscar plaza por número (P-12)" className="h-9 pl-9" />
                                    </div>
                                    <div className="flex flex-wrap gap-1.5">
                                        {listaPlazas.map((p) => {
                                            const deOtro = !!p.ocupadaPor && p.ocupadaPor.id !== duenioId;
                                            const esElegida = p.id === elegida;
                                            return (
                                                <button key={p.id} type="button" disabled={!duenioId} title={deOtro ? `De ${p.ocupadaPor!.nombre}` : "Libre"}
                                                    onClick={() => { setElegida(p.id); setPisar(null); }}
                                                    className={cn("h-7 px-2.5 rounded-full border text-[11.5px] font-semibold tabular-nums transition-colors disabled:opacity-50",
                                                        esElegida ? "border-[var(--accion)] tono-accion bg-[color-mix(in_oklab,var(--accion)_10%,transparent)]"
                                                            : deOtro ? "border-border text-muted-foreground/60 line-through" : "border-border text-muted-foreground hover:bg-accent")}>
                                                    {p.label}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            </CajonSeccion>
                        </>
                    )}
                </CajonContenido>
            )}
        </Cajon>
    );
}
