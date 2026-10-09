"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Check, HelpCircle, Loader2, MapPin, Route, Search, SquareParking, Trash2, UserPlus } from "lucide-react";
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

const ROL: Record<string, string> = {
    RESIDENT: "Residente", VISITOR: "Visita", STAFF: "Personal", ADMIN: "Administrador", PROVIDER: "Proveedor",
    TEMPORARY_VISITOR: "Visita temporal", WHITELISTED: "Lista blanca", SECURITY: "Seguridad", OPERATOR: "Operador",
};
const iniciales = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((x) => x[0]?.toUpperCase() || "").join("") || "?";

/** El número de paso con su estado: hecho (tilde), actual (azul) o pendiente (apagado). */
function Paso({ n, estado }: { n: number; estado: "hecho" | "actual" | "pendiente" }) {
    return (
        <span className={cn("w-5 h-5 rounded-full grid place-items-center text-[10.5px] font-bold tabular-nums shrink-0 border",
            estado === "hecho" ? "chip-bien" : estado === "actual" ? "border-[var(--accion)] tono-accion" : "border-border text-muted-foreground")}>
            {estado === "hecho" ? <Check size={11} /> : n}
        </span>
    );
}

/** Un ítem de la leyenda del plano, con su explicación al pasar el mouse. */
function Leyenda({ muestra, rotulo, texto }: { muestra: React.ReactNode; rotulo: string; texto: string }) {
    return (
        <Pista titulo={rotulo} texto={texto} ancho={250}>
            <span className="inline-flex items-center gap-1.5 cursor-help">{muestra}{rotulo}</span>
        </Pista>
    );
}

/**
 * Elegir al dueño: un buscador con su lista flotante, como cualquier selector de la app.
 *
 * Antes era una lista fija de 200 px abierta siempre debajo del campo, mostrando a todo el
 * padrón aunque no se hubiera escrito nada, con «Registrar persona nueva» suelto al
 * costado. Ahora la lista aparece al escribir o al entrar al campo, cada persona dice su
 * lote, su rol y si ya tiene plaza, se navega con las flechas, y registrar a alguien nuevo
 * es la última opción de la misma lista: es lo que se busca cuando nadie coincide.
 */
function ElegirDuenio({ plate, alElegir, onRegistrar }: { plate: string; alElegir: (p: Persona) => void; onRegistrar?: (plate: string) => void }) {
    const [q, setQ] = useState("");
    const [abierto, setAbierto] = useState(false);
    const [filas, setFilas] = useState<Persona[] | null>(null);
    const [i, setI] = useState(0);
    const caja = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (!abierto) return;
        setFilas(null);
        const t = setTimeout(() => { buscarPersonasParaPlaza(q).then((r) => { setFilas(r.slice(0, 8)); setI(0); }).catch(() => setFilas([])); }, 200);
        return () => clearTimeout(t);
    }, [q, abierto]);
    useEffect(() => {
        const fuera = (e: MouseEvent) => { if (caja.current && !caja.current.contains(e.target as Node)) setAbierto(false); };
        document.addEventListener("mousedown", fuera); return () => document.removeEventListener("mousedown", fuera);
    }, []);
    const opciones = (filas || []).length + (onRegistrar ? 1 : 0);
    const elegir = (k: number) => {
        if (filas && k < filas.length) { alElegir(filas[k]); setAbierto(false); }
        else if (onRegistrar) onRegistrar(plate);
    };
    return (
        <div ref={caja} className="relative">
            <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input value={q} autoFocus placeholder="Escribí el nombre o el lote (ej. Flavio, Lote 30)"
                    onChange={(e) => { setQ(e.target.value); setAbierto(true); }} onFocus={() => setAbierto(true)}
                    onKeyDown={(e) => {
                        if (e.key === "ArrowDown") { e.preventDefault(); setAbierto(true); setI((x) => Math.min(opciones - 1, x + 1)); }
                        else if (e.key === "ArrowUp") { e.preventDefault(); setI((x) => Math.max(0, x - 1)); }
                        else if (e.key === "Enter" && abierto && opciones) { e.preventDefault(); elegir(i); }
                        else if (e.key === "Escape" && abierto) { e.preventDefault(); e.stopPropagation(); setAbierto(false); }
                    }}
                    className="h-10 pl-9" role="combobox" aria-expanded={abierto} />
            </div>
            {abierto && (
                <div className="absolute z-20 mt-1.5 w-full rounded-[10px] border border-border bg-popover shadow-xl overflow-hidden" role="listbox">
                    {filas === null ? (
                        <p className="px-3 py-3 text-[12px] text-muted-foreground flex items-center gap-2"><Loader2 size={13} className="animate-spin" /> Buscando…</p>
                    ) : !filas.length ? (
                        <p className="px-3 py-3 text-[12px] text-muted-foreground">Nadie coincide con «{q}».</p>
                    ) : filas.map((p, k) => (
                        <button key={p.id} type="button" role="option" aria-selected={k === i}
                            onMouseEnter={() => setI(k)} onClick={() => elegir(k)}
                            className={cn("w-full flex items-center gap-3 px-3 py-2 text-left transition-colors", k === i && "bg-accent")}>
                            <span className="w-8 h-8 rounded-full bg-muted border border-border grid place-items-center text-[11px] font-bold text-muted-foreground shrink-0">{iniciales(p.nombre)}</span>
                            <span className="min-w-0 flex-1">
                                <span className="block text-[13px] font-semibold truncate">{p.nombre}</span>
                                <span className="block text-[11.5px] text-muted-foreground truncate">{[p.unidad, ROL[p.rol] || p.rol].filter(Boolean).join(" · ")}</span>
                            </span>
                            {p.plaza ? <Estado tono="neutro" icono={SquareParking}>{p.plaza}</Estado> : <span className="text-[11px] text-muted-foreground shrink-0">Sin plaza</span>}
                        </button>
                    ))}
                    {onRegistrar && (
                        <button type="button" onMouseEnter={() => setI(opciones - 1)} onClick={() => elegir(opciones - 1)}
                            className={cn("w-full flex items-center gap-3 px-3 py-2.5 text-left border-t border-border transition-colors", i === opciones - 1 && "bg-accent")}>
                            <span className="w-8 h-8 rounded-full border border-dashed border-[var(--accion)] grid place-items-center tono-accion shrink-0"><UserPlus size={14} /></span>
                            <span className="min-w-0">
                                <span className="block text-[13px] font-semibold tono-accion">Registrar a alguien nuevo</span>
                                <span className="block text-[11.5px] text-muted-foreground">Se abre el alta con {plate} ya cargada</span>
                            </span>
                        </button>
                    )}
                </div>
            )}
        </div>
    );
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
    const [filtroPlaza, setFiltroPlaza] = useState("");
    const [verOcupadas, setVerOcupadas] = useState(false);
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
    useEffect(() => { setD(null); setPersona(null); setFiltroPlaza(""); setPisar(null); setVerOcupadas(false); cargar(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [plate]);

    // El plano en píxeles: en un viewBox 0–100 deformado los círculos salen ovalados.
    const imgRef = useRef<HTMLImageElement>(null);
    const [caja, setCaja] = useState({ w: 0, h: 0 });
    useEffect(() => {
        const el = imgRef.current; if (!el) return;
        const medir = () => setCaja({ w: el.clientWidth, h: el.clientHeight });
        medir(); const ro = new ResizeObserver(medir); ro.observe(el);
        return () => ro.disconnect();
    }, [d?.mapUrl]);
    const px = (p: P) => ({ x: (p.x / 100) * caja.w, y: (p.y / 100) * caja.h });

    const duenio = d?.duenio ? { id: d.duenio.id, nombre: d.duenio.nombre, unidad: d.duenio.unidad, rol: d.duenio.rol } : persona ? { id: persona.id, nombre: persona.nombre, unidad: persona.unidad, rol: persona.rol } : null;
    const duenioId = duenio?.id || null;
    const actual = d?.plazas.find((p) => p.id === d?.duenio?.plazaId) || null;
    const seleccion = d?.plazas.find((p) => p.id === elegida) || null;
    const formas = useMemo(() => (d?.plazas || []).map((p) => ({ p, pts: puntosDe(p.points) })).filter((x) => x.pts.length >= 3), [d]);
    const ruta = useMemo(() => camino(seleccion ? centro(puntosDe(seleccion.points)) : null, elems), [seleccion, elems]);
    const esLibre = (p: Plaza) => !p.ocupadaPor || p.ocupadaPor.id === duenioId;
    const libres = (d?.plazas || []).filter(esLibre);
    const listaPlazas = (d?.plazas || []).filter((p) => (verOcupadas || esLibre(p)) && (!filtroPlaza || p.label.toLowerCase().includes(filtroPlaza.toLowerCase()))).slice(0, 48);
    const cambio = !!d && (elegida !== (d.duenio?.plazaId || null));
    const elegir = (p: Plaza) => { if (!duenioId) return; setElegida(p.id); setPisar(null); };

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
        toast.success(slotId ? `${plate} · plaza ${r.label}` : `${plate} sin plaza`, { description: slotId ? `Queda a nombre de ${duenio?.nombre}. En el monitor el ícono de plaza pasa a verde.` : "Se le sacó la plaza a su dueño." });
        alCambiar?.();
        await cargar();
    };

    return (
        <Cajon open={!!plate} onOpenChange={(o) => { if (!o && !guardando) onClose(); }}>
            {plate && (
                <CajonContenido ancho="medio" titulo={`Plaza de ${plate}`}
                    descripcion={actual ? `Estaciona en ${actual.label}. Tocá otra en el plano para cambiarla.` : "Todavía no tiene plaza: elegí el dueño y después la plaza."}
                    pie={d && duenioId ? (
                        <>
                            {pisar ? (
                                <span className="mr-auto flex items-center gap-2 text-[12.5px] min-w-0">
                                    <span className="tono-aviso font-semibold truncate">{seleccion?.label} es de {pisar}.</span>
                                    <Pista titulo="Pasársela igual" texto={`${pisar} se queda sin plaza y ${seleccion?.label} pasa a ${duenio?.nombre}. Ej: un vecino que se mudó y su plaza quedó cargada a su nombre.`}>
                                        <Button size="sm" variant="outline" onClick={() => guardar(elegida, true)} disabled={guardando} className="h-8 text-[12px] font-semibold">Pasársela igual</Button>
                                    </Pista>
                                </span>
                            ) : actual ? (
                                <Pista titulo="Sacar la plaza" texto={`${duenio?.nombre} queda sin plaza y ${actual.label} vuelve a estar libre. La matrícula sigue a su nombre.`}>
                                    <Button variant="ghost" onClick={() => { setElegida(null); guardar(null); }} disabled={guardando}
                                        className="mr-auto h-9 px-3 text-[13px] font-semibold gap-1.5 tono-mal">
                                        <Trash2 size={14} /> Sacar la plaza
                                    </Button>
                                </Pista>
                            ) : <span className="mr-auto" />}
                            <Button variant="ghost" onClick={onClose} disabled={guardando} className="h-9 px-4 text-[13px] font-semibold text-muted-foreground">Cerrar</Button>
                            <Button onClick={() => guardar(elegida)} disabled={guardando || !cambio || !elegida}
                                className="accion h-9 px-4 rounded-md text-[13px] font-semibold gap-1.5">
                                {guardando ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                                {seleccion && cambio ? `Asignar ${seleccion.label}` : "Elegí una plaza"}
                            </Button>
                        </>
                    ) : undefined}>

                    {error && <ErrorEstado mensaje={error} alReintentar={cargar} className="py-16" />}
                    {!d && !error && <Cargando texto="Buscando la plaza…" className="py-16" />}

                    {d && (
                        <>
                            {/* Resumen: matrícula → dueño → plaza. Se lee de un vistazo qué falta. */}
                            <CajonSeccion titulo="" className="py-5">
                                <div className="flex items-center gap-2.5 flex-wrap rounded-[10px] border border-border bg-card px-4 py-3">
                                    <Matricula p={plate} className="text-[14px] px-2.5 py-1" />
                                    <ArrowRight size={14} className="text-muted-foreground" />
                                    {duenio ? (
                                        <span className="flex items-center gap-2 min-w-0">
                                            <span className="w-7 h-7 rounded-full bg-muted border border-border grid place-items-center text-[10.5px] font-bold text-muted-foreground shrink-0">{iniciales(duenio.nombre)}</span>
                                            <span className="text-[13px] font-semibold truncate">{duenio.nombre}</span>
                                            {duenio.unidad && <span className="text-[12px] text-muted-foreground">{duenio.unidad}</span>}
                                        </span>
                                    ) : <span className="text-[12.5px] text-muted-foreground">sin dueño</span>}
                                    <ArrowRight size={14} className="text-muted-foreground" />
                                    {seleccion ? <Estado tono={cambio ? "info" : "bien"} icono={SquareParking}>{seleccion.label}{cambio ? " · sin guardar" : ""}</Estado> : <Estado tono="aviso">Sin plaza</Estado>}
                                </div>
                            </CajonSeccion>

                            {/* ── 1. Dueño ── */}
                            <CajonSeccion titulo="" className="py-6">
                                <div className="flex items-center gap-2.5">
                                    <Paso n={1} estado={duenio ? "hecho" : "actual"} />
                                    <h3 className="text-[13.5px] font-bold">De quién es la matrícula</h3>
                                    <Pista titulo="Por qué hace falta un dueño"
                                        texto={<>La plaza es de una persona, no de un auto: todos sus vehículos estacionan en la misma. <b>Ej.:</b> STX2035 es el auto de Flavio González (Lote 30); la plaza P-30 se le da a Flavio, y si mañana entra con su otra camioneta también va a P-30.</>}
                                        ancho={300}>
                                        <HelpCircle size={13} className="text-muted-foreground/60 hover:text-[var(--accion)] cursor-help" />
                                    </Pista>
                                </div>
                                {d.duenio ? (
                                    <p className="text-[12.5px] text-muted-foreground">Está a nombre de <b className="text-foreground">{d.duenio.nombre}</b>{d.duenio.rol ? ` (${ROL[d.duenio.rol] || d.duenio.rol})` : ""}. Para cambiar el dueño, desde su ficha en Usuarios.</p>
                                ) : persona ? (
                                    <div className="flex items-center gap-2 text-[12.5px]">
                                        <span className="text-muted-foreground">Al asignar, {plate} queda a nombre de <b className="text-foreground">{persona.nombre}</b>.</span>
                                        <button onClick={() => setPersona(null)} className="font-semibold tono-accion">Elegir otra persona</button>
                                    </div>
                                ) : (
                                    <>
                                        <p className="text-[12.5px] text-muted-foreground">No está a nombre de nadie del barrio. Buscá a la persona; si no está cargada, la última opción de la lista la registra.</p>
                                        <ElegirDuenio plate={plate} alElegir={setPersona} onRegistrar={onRegistrar} />
                                    </>
                                )}
                            </CajonSeccion>

                            {/* ── 2. Plaza ── */}
                            <CajonSeccion titulo="" className="py-6">
                                <div className="flex items-center gap-2.5">
                                    <Paso n={2} estado={!duenioId ? "pendiente" : seleccion && !cambio ? "hecho" : "actual"} />
                                    <h3 className={cn("text-[13.5px] font-bold", !duenioId && "text-muted-foreground")}>La plaza</h3>
                                    <Pista titulo="Cómo se elige"
                                        texto={<>Tocá la plaza en el plano, o escribí su número abajo. <b>Ej.:</b> «P-12» o sólo «12». Las de otra persona se pueden elegir igual: antes de pasársela te pregunta.</>}
                                        ancho={290}>
                                        <HelpCircle size={13} className="text-muted-foreground/60 hover:text-[var(--accion)] cursor-help" />
                                    </Pista>
                                    <span className="ml-auto text-[11.5px] text-muted-foreground tabular-nums">{libres.length} libres de {d.plazas.length}</span>
                                </div>
                                {!duenioId && <p className="text-[12.5px] text-muted-foreground">Primero el paso 1: sin dueño no hay a quién darle la plaza.</p>}

                                <div className="flex items-center gap-4 flex-wrap text-[11.5px] text-muted-foreground">
                                    <Leyenda muestra={<span className="w-3.5 h-3.5 rounded-[3px] border-2 border-[var(--accion)] bg-[color-mix(in_oklab,var(--accion)_30%,transparent)]" />} rotulo="Elegida"
                                        texto="La que se va a asignar al guardar. Si ya tenía una, es la suya hasta que elijas otra." />
                                    <Leyenda muestra={<span className="w-3.5 h-3.5 rounded-[3px] border border-foreground/45" />} rotulo="Libre"
                                        texto="Sin nadie asignado. Ej.: P-45 sin dueño: se asigna directo." />
                                    <Leyenda muestra={<span className="w-3.5 h-3.5 rounded-[3px] bg-foreground/25" />} rotulo="De otra persona"
                                        texto="Ya es de un vecino. Ej.: P-1 es de Gastón (Lote 21): se puede pasar, pero te pregunta antes y él queda sin plaza." />
                                    {ruta && <Leyenda muestra={<Route size={13} className="tono-accion" />} rotulo="Camino" texto="Desde la entrada más cercana hasta la plaza elegida, por las calles dibujadas en el plano." />}
                                </div>

                                {d.mapUrl ? (
                                    <div className={cn("relative rounded-[10px] overflow-hidden border border-border bg-muted", !duenioId && "opacity-60")}>
                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                        <img ref={imgRef} src={d.mapUrl} alt="Plano del barrio" draggable={false}
                                            className="w-full max-h-[56vh] object-contain grayscale opacity-70 dark:invert dark:opacity-50 select-none"
                                            onLoad={() => setCaja({ w: imgRef.current?.clientWidth || 0, h: imgRef.current?.clientHeight || 0 })} />
                                        {caja.w > 0 && (
                                            <svg className="absolute inset-0 w-full h-full" viewBox={`0 0 ${caja.w} ${caja.h}`}>
                                                {formas.map(({ p, pts }) => {
                                                    const esElegida = p.id === elegida;
                                                    const deOtro = !esLibre(p);
                                                    const enfocada = sobre?.id === p.id;
                                                    const dPath = pts.map((q, k) => { const r = px(q); return `${k ? "L" : "M"} ${r.x} ${r.y}`; }).join(" ") + " Z";
                                                    // En `style` y no como atributos: var() y color-mix() en atributos de SVG no los toma cualquier navegador.
                                                    return (
                                                        <path key={p.id} d={dPath}
                                                            onMouseEnter={() => setSobre(p)} onMouseLeave={() => setSobre((x) => (x?.id === p.id ? null : x))}
                                                            onClick={() => elegir(p)}
                                                            className={duenioId ? "cursor-pointer" : "cursor-not-allowed"}
                                                            style={{
                                                                fill: esElegida ? "color-mix(in oklab, var(--accion) 40%, transparent)" : deOtro ? "color-mix(in oklab, var(--foreground) 24%, transparent)" : enfocada ? "color-mix(in oklab, var(--accion) 16%, transparent)" : "transparent",
                                                                stroke: esElegida || enfocada ? "var(--accion)" : "color-mix(in oklab, var(--foreground) 50%, transparent)",
                                                                strokeWidth: esElegida ? 2.5 : enfocada ? 1.8 : 1,
                                                                strokeLinejoin: "round", transition: "fill .15s, stroke .15s",
                                                            }} />
                                                    );
                                                })}
                                                {ruta && (() => {
                                                    const r = ruta.map(px);
                                                    const dd = r.map((q, k) => `${k ? "L" : "M"} ${q.x} ${q.y}`).join(" ");
                                                    return (
                                                        <g className="pointer-events-none">
                                                            <path d={dd} fill="none" style={{ stroke: "var(--background)", strokeOpacity: 0.85, strokeWidth: 8, strokeLinecap: "round", strokeLinejoin: "round" }} />
                                                            <path d={dd} fill="none" style={{ stroke: "var(--accion)", strokeWidth: 4, strokeLinecap: "round", strokeLinejoin: "round", strokeDasharray: "10 7" }} />
                                                            <circle cx={r[0].x} cy={r[0].y} r={7} style={{ fill: "var(--background)", stroke: "var(--accion)", strokeWidth: 3 }} />
                                                        </g>
                                                    );
                                                })()}
                                            </svg>
                                        )}
                                        {sobre && (
                                            <div className="absolute top-3 left-3 rounded-[10px] bg-popover border border-border px-3 py-2 text-[12px] pointer-events-none shadow-xl">
                                                <p className="font-bold flex items-center gap-1.5"><MapPin size={12} /> {sobre.label}</p>
                                                <p className="text-muted-foreground">{sobre.ocupadaPor ? (sobre.ocupadaPor.id === duenioId ? "Es la suya" : `De ${sobre.ocupadaPor.nombre}`) : "Libre"}</p>
                                            </div>
                                        )}
                                    </div>
                                ) : (
                                    <p className="text-[12.5px] text-muted-foreground">No hay plano del barrio cargado (Plazas de Parking): se elige por número.</p>
                                )}

                                {/* Por número: cuando se sabe cuál es, o el plano queda chico. */}
                                <div className="flex items-center gap-2">
                                    <div className="relative w-56">
                                        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                                        <Input value={filtroPlaza} onChange={(e) => setFiltroPlaza(e.target.value)} placeholder="Número (ej. P-12 o 12)" className="h-9 pl-9" disabled={!duenioId} />
                                    </div>
                                    <Pista texto="Muestra también las plazas que ya son de otra persona, tachadas.">
                                        <button type="button" onClick={() => setVerOcupadas((v) => !v)} aria-pressed={verOcupadas}
                                            className={cn("h-8 px-3 rounded-full border text-[12px] font-semibold transition-colors",
                                                verOcupadas ? "border-[var(--accion)] tono-accion bg-[color-mix(in_oklab,var(--accion)_10%,transparent)]" : "border-border text-muted-foreground hover:bg-accent")}>
                                            Con ocupadas
                                        </button>
                                    </Pista>
                                </div>
                                <div className="flex flex-wrap gap-1.5">
                                    {listaPlazas.map((p) => {
                                        const deOtro = !esLibre(p);
                                        const esElegida = p.id === elegida;
                                        return (
                                            <button key={p.id} type="button" disabled={!duenioId} title={deOtro ? `De ${p.ocupadaPor!.nombre}` : "Libre"}
                                                onClick={() => elegir(p)} onMouseEnter={() => setSobre(p)} onMouseLeave={() => setSobre(null)}
                                                className={cn("h-7 min-w-[52px] px-2.5 rounded-full border text-[11.5px] font-semibold tabular-nums transition-colors disabled:opacity-50",
                                                    esElegida ? "border-[var(--accion)] tono-accion bg-[color-mix(in_oklab,var(--accion)_10%,transparent)]"
                                                        : deOtro ? "border-border text-muted-foreground/60 line-through" : "border-border text-foreground/80 hover:bg-accent")}>
                                                {p.label}
                                            </button>
                                        );
                                    })}
                                    {!listaPlazas.length && <span className="text-[12px] text-muted-foreground">Ninguna plaza coincide.</span>}
                                </div>
                            </CajonSeccion>
                        </>
                    )}
                </CajonContenido>
            )}
        </Cajon>
    );
}
