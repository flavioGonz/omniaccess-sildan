"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
    Armchair, CalendarDays, Check, ChevronLeft, ChevronRight, ClipboardList, Clock, Dumbbell, Flame, MapPin, PartyPopper, Pencil, Plus,
    Home, LayoutGrid, ScrollText, Search, ShieldCheck, StickyNote, Trees, Trophy, User, Users, Waves, Wrench, X,
} from "lucide-react";
import { sileo as toast } from "sileo";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Cajon, CajonCampo, CajonContenido, CajonSeccion } from "@/components/ui/cajon";
import { Cargando, Chip, ErrorEstado, Vacio } from "@/components/ui/estados";
import { DeleteButton } from "@/components/ui/delete-button";
import { useTiempoReal } from "@/lib/tiempo-real";
import { hace } from "@/lib/fechas";
import {
    diasDeSemana, inicioDeSemana, posicionEnDia, rotuloTipo, ESTADOS_ESPACIO, ESTADOS_RESERVA, ESTADOS_TAREA, TIPOS_ESPACIO, TIPOS_TAREA,
} from "@/lib/espacios";
import {
    borrarEspacio, borrarTarea, cambiarEstadoEspacio, cambiarEstadoTarea, cancelarReserva, espaciosDe, guardarEspacio, guardarReserva, guardarTarea,
    lotesParaReservar, proximasReservas, reservasDe, tareasDe, type EspacioVisto, type ReservaVista, type Resultado, type TareaVista,
} from "@/app/actions/espacios";

/**
 * Las pestañas SUM y Espacios comunes de una administración (25/11). Nico: «agrega una tab SUM, y
 * otra Espacios comunes; desarrollalas premium». Eligió ficha y reglamento, reservas con calendario,
 * mantenimiento y tareas, y el estado en vivo.
 *
 * El SUM es el espacio que más se usa y el único que todos los complejos tienen: por eso tiene su
 * propia pestaña con la agenda de la semana a lo grande. Los demás espacios van en una grilla de
 * fichas, y cada una abre su cajón con lo mismo (estado, ficha, reservas si se reserva, tareas).
 *
 * El estado en vivo viaja por el socket (`espacio_estado`): si la guardia o otra administradora
 * cierra la piscina, esta pantalla se entera sin volver a cargar.
 */

const ENTRADA = "h-9 w-full px-3 rounded-[6px] border border-border bg-background text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accion)]/40 focus-visible:border-[var(--accion)]";
const DIBUJO: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
    SUM: PartyPopper, PISCINA: Waves, CANCHA: Trophy, PARRILLERO: Flame, GIMNASIO: Dumbbell, PARQUE: Trees, OTRO: MapPin,
};
/** La franja de horas que muestra la agenda: un SUM se usa de mañana a la noche. */
const DESDE_H = 8, HASTA_H = 24;
const tonoDe = (lista: readonly { id: string; tono: string }[], id: string) => (lista.find((x) => x.id === id)?.tono || "quieto") as "bien" | "aviso" | "mal" | "info" | "quieto";
const rotuloDe = (lista: readonly { id: string; rotulo: string }[], id: string) => lista.find((x) => x.id === id)?.rotulo || id;
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString("es-UY", { hour: "2-digit", minute: "2-digit", hour12: false });
const diaLargo = (d: Date) => d.toLocaleDateString("es-UY", { weekday: "long", day: "numeric", month: "long" });
const aFecha = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const aHora = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

async function correr(accion: () => Promise<Resultado>, listo: string): Promise<Resultado> {
    try {
        const r = await accion();
        if (!r.ok) toast.error({ title: "No se guardó", description: r.error }); else toast.success({ title: listo });
        return r;
    } catch (e) {
        toast.error({ title: "No se guardó", description: e instanceof Error ? e.message : undefined });
        return { ok: false };
    }
}

function Eleccion<T extends string>({ opciones, valor, alCambiar }: { opciones: readonly { v: T; r: string }[]; valor: T; alCambiar: (v: T) => void }) {
    return (
        <div className="flex flex-wrap gap-1.5" role="radiogroup">
            {opciones.map((o) => (
                <button key={o.v} type="button" role="radio" aria-checked={valor === o.v} onClick={() => alCambiar(o.v)}
                    className={cn("h-7 px-2.5 rounded-full border text-[11.5px] font-semibold", valor === o.v ? "border-[var(--accion)] text-[var(--accion)] bg-[color-mix(in_oklab,var(--accion)_8%,transparent)]" : "border-border hover:bg-accent")}>
                    {o.r}
                </button>
            ))}
        </div>
    );
}

/* ═══════════════════════ Los datos, compartidos por las dos pestañas ═══════════════════════ */

function useEspacios(administracionId: string) {
    const [lista, setLista] = useState<EspacioVisto[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [vuelta, setVuelta] = useState(0);
    const refrescar = useCallback(() => setVuelta((n) => n + 1), []);
    useEffect(() => {
        let vivo = true;
        espaciosDe(administracionId).then((l) => { if (vivo) { setLista(l); setError(null); } }).catch((e) => { if (vivo) setError(e instanceof Error ? e.message : "No se pudieron traer los espacios."); });
        return () => { vivo = false; };
    }, [administracionId, vuelta]);
    /* En vivo: el estado de un espacio o una reserva nueva, desde otra pantalla. */
    useTiempoReal("espacio_estado", refrescar);
    useTiempoReal("espacio_reserva", refrescar);
    return { lista, error, refrescar };
}

/* ═══════════════════════ La pestaña SUM ═══════════════════════ */

export function PestaniaSum({ administracionId }: { administracionId: string }) {
    const { lista, error, refrescar } = useEspacios(administracionId);
    const sums = useMemo(() => (lista || []).filter((e) => e.tipo === "SUM"), [lista]);
    const [elegido, setElegido] = useState<string | null>(null);
    const [editando, setEditando] = useState<Partial<EspacioVisto> | null>(null);
    const [reserva, setReserva] = useState<Partial<ReservaVista> | null>(null);
    const [vueltaAgenda, setVueltaAgenda] = useState(0);
    const sum = sums.find((s) => s.id === elegido) || sums[0] || null;

    if (error) return <ErrorEstado mensaje={error} alReintentar={refrescar} />;
    if (!lista) return <Cargando texto="Trayendo el SUM…" />;
    const alGuardarReserva = () => { setReserva(null); setVueltaAgenda((n) => n + 1); refrescar(); };

    return (
        <div className="space-y-4">
            {!sum ? (
                <div className="rounded-[14px] border border-dashed border-border p-8 text-center">
                    <span className="mx-auto grid h-12 w-12 place-items-center rounded-[14px] bg-muted"><PartyPopper size={22} /></span>
                    <p className="mt-3 text-[15px] font-bold">Esta administración todavía no tiene su SUM cargado</p>
                    <p className="mx-auto mt-1 max-w-[440px] text-[13px] text-muted-foreground">Cargalo una vez —capacidad, horario, reglamento, lo que tiene adentro— y desde acá se llevan sus reservas en una agenda, se anota su mantenimiento y se dice si está abierto.</p>
                    <Button className="mt-4" onClick={() => setEditando({ tipo: "SUM", reservable: true, administracionId })}><Plus size={14} /> Cargar el SUM</Button>
                </div>
            ) : (
                <>
                    {sums.length > 1 && (
                        <Eleccion opciones={sums.map((s) => ({ v: s.id, r: s.nombre }))} valor={sum.id} alCambiar={setElegido} />
                    )}
                    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px] items-start">
                        <div className="min-w-0 rounded-[14px] border border-border bg-card">
                            <AgendaSemana key={`${sum.id}-${vueltaAgenda}`} espacio={sum} alNueva={(inicio) => setReserva({ espacioId: sum.id, inicio: inicio.toISOString(), fin: new Date(inicio.getTime() + 4 * 3600_000).toISOString() })} alAbrir={setReserva} />
                        </div>
                        <div className="space-y-4">
                            <FichaEspacio e={sum} alEditar={() => setEditando(sum)} alCambiar={refrescar} />
                            <ProximasReservas key={`${sum.id}-p-${vueltaAgenda}`} espacioId={sum.id} alAbrir={setReserva} />
                        </div>
                    </div>
                    <div className="rounded-[14px] border border-border bg-card p-4">
                        <TareasDeEspacio espacioId={sum.id} alCambiar={refrescar} />
                    </div>
                    {sums.length === 1 && (
                        <button type="button" onClick={() => setEditando({ tipo: "SUM", reservable: true, administracionId })} className="text-[12px] font-semibold text-muted-foreground hover:text-[var(--accion)]">+ Cargar otro SUM</button>
                    )}
                </>
            )}
            <CajonEspacio valor={editando} alCerrar={() => setEditando(null)} alGuardar={() => { setEditando(null); refrescar(); }} />
            <CajonReserva valor={reserva} espacio={sum} administracionId={administracionId} alCerrar={() => setReserva(null)} alGuardar={alGuardarReserva} />
        </div>
    );
}

/* ═══════════════════════ La pestaña Espacios comunes ═══════════════════════ */

export function PestaniaEspacios({ administracionId }: { administracionId: string }) {
    const { lista, error, refrescar } = useEspacios(administracionId);
    const otros = useMemo(() => (lista || []).filter((e) => e.tipo !== "SUM"), [lista]);
    const [abierto, setAbierto] = useState<string | null>(null);
    const [editando, setEditando] = useState<Partial<EspacioVisto> | null>(null);
    const quieto = useReducedMotion();
    const e = otros.find((x) => x.id === abierto) || null;

    if (error) return <ErrorEstado mensaje={error} alReintentar={refrescar} />;
    if (!lista) return <Cargando texto="Trayendo los espacios…" />;
    const cuenta = { abiertos: otros.filter((x) => x.estado === "ABIERTO").length, mant: otros.filter((x) => x.estado === "MANTENIMIENTO").length, cerrados: otros.filter((x) => x.estado === "CERRADO").length, tareas: otros.reduce((n, x) => n + x.tareasAbiertas, 0) };

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                {otros.length > 0 && (
                    <div className="flex flex-wrap items-center gap-4 text-[12.5px]">
                        <span><b className="tabular-nums">{cuenta.abiertos}</b> <span className="text-muted-foreground">abiertos</span></span>
                        {cuenta.mant > 0 && <span><b className="tabular-nums tono-aviso">{cuenta.mant}</b> <span className="text-muted-foreground">en mantenimiento</span></span>}
                        {cuenta.cerrados > 0 && <span><b className="tabular-nums tono-mal">{cuenta.cerrados}</b> <span className="text-muted-foreground">cerrados</span></span>}
                        <span><b className="tabular-nums">{cuenta.tareas}</b> <span className="text-muted-foreground">{cuenta.tareas === 1 ? "tarea abierta" : "tareas abiertas"}</span></span>
                    </div>
                )}
                <Button size="sm" variant="outline" className="ml-auto" onClick={() => setEditando({ tipo: "PISCINA", administracionId })}><Plus size={14} /> Agregar espacio</Button>
            </div>
            {otros.length === 0 ? (
                <Vacio icono={Trees} titulo="Sin espacios comunes cargados" ayuda="La piscina, las canchas, los parrilleros, el gimnasio, las plazas: cada uno con su ficha, su reglamento, su estado en vivo y su mantenimiento. Los que se reservan llevan su agenda." />
            ) : (
                <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
                    {otros.map((x, k) => {
                        const Dib = DIBUJO[x.tipo] || MapPin;
                        return (
                            <motion.button key={x.id} type="button" onClick={() => setAbierto(x.id)}
                                initial={quieto ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ type: "spring", bounce: 0, duration: 0.4, delay: quieto ? 0 : k * 0.03 }}
                                className="group text-left rounded-[14px] border border-border bg-card p-4 hover:border-[color-mix(in_oklab,var(--accion)_45%,transparent)] transition-colors">
                                <div className="flex items-start gap-3">
                                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[10px] bg-muted text-foreground group-hover:text-[var(--accion)] transition-colors"><Dib size={18} /></span>
                                    <div className="min-w-0 flex-1">
                                        <p className="truncate text-[14.5px] font-bold">{x.nombre}</p>
                                        <p className="text-[11.5px] text-muted-foreground">{rotuloTipo(x.tipo)}{x.capacidad ? ` · ${x.capacidad} personas` : ""}</p>
                                    </div>
                                    <Chip tono={tonoDe(ESTADOS_ESPACIO, x.estado)}>{rotuloDe(ESTADOS_ESPACIO, x.estado)}</Chip>
                                </div>
                                {x.estadoNota && x.estado !== "ABIERTO" && <p className="mt-2.5 text-[12px] leading-snug text-muted-foreground">«{x.estadoNota}»</p>}
                                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-border pt-2.5 text-[11.5px] text-muted-foreground">
                                    {x.horario && <span className="inline-flex items-center gap-1"><Clock size={11} />{x.horario}</span>}
                                    {x.reservable && <span className="inline-flex items-center gap-1"><CalendarDays size={11} />{x.proxima ? `Próxima: ${new Date(x.proxima.inicio).toLocaleDateString("es-UY", { weekday: "short", day: "numeric" })} ${hhmm(x.proxima.inicio)}` : "Sin reservas"}</span>}
                                    {x.tareasAbiertas > 0 && <span className={cn("inline-flex items-center gap-1", x.urgentes && "tono-mal font-semibold")}><Wrench size={11} />{x.tareasAbiertas} {x.tareasAbiertas === 1 ? "tarea" : "tareas"}{x.urgentes ? ` · ${x.urgentes} urgente${x.urgentes > 1 ? "s" : ""}` : ""}</span>}
                                </div>
                            </motion.button>
                        );
                    })}
                </div>
            )}
            <CajonFichaEspacio e={e} administracionId={administracionId} alCerrar={() => setAbierto(null)} alEditar={() => e && setEditando(e)} alCambiar={refrescar} />
            <CajonEspacio valor={editando} alCerrar={() => setEditando(null)} alGuardar={(id) => { setEditando(null); refrescar(); if (id) setAbierto(id); }} />
        </div>
    );
}

/** El cajón de un espacio de la grilla: lo mismo que la pestaña SUM, en chico. */
function CajonFichaEspacio({ e, administracionId, alCerrar, alEditar, alCambiar }: { e: EspacioVisto | null; administracionId: string; alCerrar: () => void; alEditar: () => void; alCambiar: () => void }) {
    const [reserva, setReserva] = useState<Partial<ReservaVista> | null>(null);
    const [vuelta, setVuelta] = useState(0);
    return (
        <>
            <Cajon open={!!e} onOpenChange={(o) => { if (!o) alCerrar(); }}>
                <CajonContenido ancho={e?.reservable ? "ancho" : "medio"} titulo={e?.nombre || "Espacio"} descripcion={e ? `${rotuloTipo(e.tipo)}${e.administracionId ? "" : " · de todo el complejo"}` : undefined}>
                    {e && (
                        <>
                            <CabeceraEspacio e={e} />
                            <CajonSeccion titulo="Estado y ficha" icono={ClipboardList} compacta
                                ayuda="El estado de ahora lo ve cualquiera que tenga la pantalla abierta, y se actualiza solo."
                                pista="Abierto, en mantenimiento o cerrado, con una nota para la guardia («se limpia el filtro hasta las 15»). Cada cambio queda con quién lo hizo y cuándo.">
                                <FichaEspacio e={e} alEditar={alEditar} alCambiar={alCambiar} sinMarco />
                            </CajonSeccion>
                            {e.reservable && (
                                <CajonSeccion titulo="Reservas" icono={CalendarDays} compacta ayuda="Tocá un hueco de la agenda para reservar a esa hora, o una reserva para verla, cambiarla o cancelarla.">
                                    <div className="rounded-[10px] border border-border">
                                        <AgendaSemana key={`${e.id}-${vuelta}`} espacio={e} compacta alNueva={(inicio) => setReserva({ espacioId: e.id, inicio: inicio.toISOString(), fin: new Date(inicio.getTime() + 2 * 3600_000).toISOString() })} alAbrir={setReserva} />
                                    </div>
                                </CajonSeccion>
                            )}
                            <CajonSeccion titulo="Mantenimiento y tareas" icono={Wrench} compacta ayuda="Lo que hay que arreglar, limpiar o revisar, con quién y para cuándo. Las urgentes van arriba y se ven en la ficha.">
                                <TareasDeEspacio espacioId={e.id} alCambiar={alCambiar} sinTitulo />
                            </CajonSeccion>
                        </>
                    )}
                </CajonContenido>
            </Cajon>
            <CajonReserva valor={reserva} espacio={e} administracionId={administracionId} alCerrar={() => setReserva(null)} alGuardar={() => { setReserva(null); setVuelta((n) => n + 1); alCambiar(); }} />
        </>
    );
}

/** La cabecera del cajón de un espacio: su dibujo, su estado de ahora y lo que viene. */
function CabeceraEspacio({ e }: { e: EspacioVisto }) {
    const Dib = DIBUJO[e.tipo] || MapPin;
    return (
        <div className="px-6 pt-5">
            <div className="flex items-center gap-3.5 rounded-[14px] bg-muted/50 p-4">
                <span className="grid h-12 w-12 shrink-0 place-items-center rounded-[10px] bg-background text-[var(--accion)]"><Dib size={22} /></span>
                <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2"><p className="truncate text-[16px] font-bold">{e.nombre}</p><Chip tono={tonoDe(ESTADOS_ESPACIO, e.estado)}>{rotuloDe(ESTADOS_ESPACIO, e.estado)}</Chip></div>
                    <p className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[12px] text-muted-foreground">
                        <span>{rotuloTipo(e.tipo)}</span>
                        {e.capacidad != null && <span className="inline-flex items-center gap-1"><Users size={11} />{e.capacidad} personas</span>}
                        {e.horario && <span className="inline-flex items-center gap-1"><Clock size={11} />{e.horario}</span>}
                        {e.reservable && <span className="inline-flex items-center gap-1"><CalendarDays size={11} />{e.proxima ? `Próxima: ${new Date(e.proxima.inicio).toLocaleDateString("es-UY", { weekday: "short", day: "numeric" })} ${hhmm(e.proxima.inicio)}` : "Sin reservas por delante"}</span>}
                        {e.tareasAbiertas > 0 && <span className={cn("inline-flex items-center gap-1", e.urgentes && "tono-mal font-semibold")}><Wrench size={11} />{e.tareasAbiertas} {e.tareasAbiertas === 1 ? "tarea abierta" : "tareas abiertas"}</span>}
                    </p>
                </div>
            </div>
        </div>
    );
}

/* ═══════════════════════ La ficha y el estado en vivo ═══════════════════════ */

function FichaEspacio({ e, alEditar, alCambiar, sinMarco }: { e: EspacioVisto; alEditar: () => void; alCambiar: () => void; sinMarco?: boolean }) {
    const [nota, setNota] = useState(e.estadoNota || "");
    const [cambiando, setCambiando] = useState<string | null>(null);
    const [verReglamento, setVerReglamento] = useState(false);
    const Dib = DIBUJO[e.tipo] || MapPin;
    const poner = async (estado: string) => {
        setCambiando(estado);
        const r = await correr(() => cambiarEstadoEspacio(e.id, estado, estado === "ABIERTO" ? "" : nota), `${e.nombre}: ${rotuloDe(ESTADOS_ESPACIO, estado).toLowerCase()}`);
        setCambiando(null);
        if (r.ok) { if (estado === "ABIERTO") setNota(""); alCambiar(); }
    };
    return (
        <div className={cn(!sinMarco && "rounded-[14px] border border-border bg-card p-4")}>
            {!sinMarco && (
                <div className="flex items-start gap-3">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[10px] bg-muted"><Dib size={18} /></span>
                    <div className="min-w-0 flex-1"><p className="truncate text-[15px] font-bold">{e.nombre}</p><p className="text-[11.5px] text-muted-foreground">{rotuloTipo(e.tipo)}</p></div>
                    <button type="button" onClick={alEditar} className="h-8 w-8 grid place-items-center rounded-[6px] text-muted-foreground hover:text-[var(--accion)] hover:bg-accent" aria-label="Editar la ficha" title="Editar la ficha"><Pencil size={14} /></button>
                </div>
            )}

            {/* El estado en vivo: tres botones, el actual marcado, y la nota para la guardia. */}
            <div className={cn(!sinMarco && "mt-4")}>
                <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Estado ahora</p>
                <div className="mt-1.5 grid grid-cols-3 gap-1.5">
                    {ESTADOS_ESPACIO.map((x) => {
                        const activo = e.estado === x.id;
                        return (
                            <button key={x.id} type="button" disabled={!!cambiando} onClick={() => !activo && poner(x.id)} aria-pressed={activo}
                                className={cn("h-9 rounded-[6px] border text-[12px] font-semibold transition-colors disabled:opacity-60",
                                    activo ? `pleno-${x.tono} border-transparent` : "border-border hover:bg-accent")}>
                                {cambiando === x.id ? "…" : x.id === "MANTENIMIENTO" ? "Mantenimiento" : x.rotulo}
                            </button>
                        );
                    })}
                </div>
                <input value={nota} onChange={(ev) => setNota(ev.target.value)} placeholder="Nota para la guardia (opcional): «se limpia el filtro hasta las 15»" maxLength={200}
                    onBlur={() => { if (e.estado !== "ABIERTO" && nota.trim() !== (e.estadoNota || "")) poner(e.estado); }}
                    className={cn(ENTRADA, "mt-1.5 h-8 text-[12px]")} />
                {e.estadoAt && <p className="mt-1 text-[11px] text-muted-foreground">Cambiado {hace(e.estadoAt)}{e.estadoPor ? ` por ${e.estadoPor}` : ""}.</p>}
            </div>

            <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[12.5px]">
                {e.capacidad != null && <><dt className="text-muted-foreground inline-flex items-center gap-1.5"><Users size={12} />Capacidad</dt><dd>{e.capacidad} personas</dd></>}
                {e.horario && <><dt className="text-muted-foreground inline-flex items-center gap-1.5"><Clock size={12} />Horario</dt><dd>{e.horario}</dd></>}
                {e.responsable && <><dt className="text-muted-foreground inline-flex items-center gap-1.5"><User size={12} />Responsable</dt><dd>{e.responsable}</dd></>}
                {e.inventario && <><dt className="text-muted-foreground inline-flex items-center gap-1.5"><Armchair size={12} />Tiene</dt><dd className="whitespace-pre-line">{e.inventario}</dd></>}
            </dl>
            {e.descripcion && <p className="mt-3 text-[12.5px] leading-relaxed text-muted-foreground whitespace-pre-line">{e.descripcion}</p>}
            {e.reglamento ? (
                <div className="mt-3 border-t border-border pt-3">
                    <button type="button" onClick={() => setVerReglamento((v) => !v)} className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold hover:text-[var(--accion)]">
                        <ScrollText size={13} /> Reglamento <ChevronRight size={13} className={cn("transition-transform", verReglamento && "rotate-90")} />
                    </button>
                    <AnimatePresence initial={false}>
                        {verReglamento && (
                            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ type: "spring", bounce: 0, duration: 0.35 }} className="overflow-hidden">
                                <p className="mt-2 max-h-[280px] overflow-y-auto rounded-[10px] bg-muted/50 p-3 text-[12.5px] leading-relaxed whitespace-pre-line">{e.reglamento}</p>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>
            ) : (
                <button type="button" onClick={alEditar} className="mt-3 text-[12px] font-semibold text-muted-foreground hover:text-[var(--accion)]">+ Cargar el reglamento</button>
            )}
            {sinMarco && <Button size="sm" variant="outline" className="mt-4" onClick={alEditar}><Pencil size={13} /> Editar la ficha</Button>}
        </div>
    );
}

/* ═══════════════════════ La agenda de la semana ═══════════════════════ */

function AgendaSemana({ espacio, alNueva, alAbrir, compacta }: { espacio: EspacioVisto; alNueva: (inicio: Date) => void; alAbrir: (r: ReservaVista) => void; compacta?: boolean }) {
    const [lunes, setLunes] = useState(() => inicioDeSemana(new Date()));
    const [filas, setFilas] = useState<ReservaVista[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [sentido, setSentido] = useState(0);
    const quieto = useReducedMotion();
    const dias = useMemo(() => diasDeSemana(lunes), [lunes]);
    useEffect(() => {
        let vivo = true;
        const hasta = new Date(lunes.getFullYear(), lunes.getMonth(), lunes.getDate() + 7);
        reservasDe(espacio.id, lunes.toISOString(), hasta.toISOString()).then((r) => { if (vivo) { setFilas(r); setError(null); } }).catch((e) => { if (vivo) setError(e instanceof Error ? e.message : "No se pudo traer la agenda."); });
        return () => { vivo = false; };
    }, [espacio.id, lunes]);
    const mover = (n: number) => { setSentido(n); setLunes((l) => new Date(l.getFullYear(), l.getMonth(), l.getDate() + 7 * n)); };
    const hoy = new Date();
    const ALTO = compacta ? 420 : 560;
    const horas = Array.from({ length: HASTA_H - DESDE_H }, (_, i) => DESDE_H + i);
    const titulo = `${dias[0].toLocaleDateString("es-UY", { day: "numeric", month: "short" })} – ${dias[6].toLocaleDateString("es-UY", { day: "numeric", month: "short", year: "numeric" })}`;
    const enSemana = (filas || []).filter((r) => r.estado !== "CANCELADA").length;

    return (
        <div>
            <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2.5">
                <CalendarDays size={15} className="text-muted-foreground" />
                <span className="text-[13.5px] font-bold capitalize">{titulo}</span>
                <span className="text-[11.5px] text-muted-foreground">{enSemana} {enSemana === 1 ? "reserva" : "reservas"}</span>
                <div className="ml-auto flex items-center gap-1">
                    <button type="button" onClick={() => mover(-1)} className="h-8 w-8 grid place-items-center rounded-[6px] hover:bg-accent" aria-label="Semana anterior"><ChevronLeft size={15} /></button>
                    <button type="button" onClick={() => { setSentido(0); setLunes(inicioDeSemana(new Date())); }} className="h-8 px-2.5 rounded-[6px] border border-border text-[12px] font-semibold hover:bg-accent">Hoy</button>
                    <button type="button" onClick={() => mover(1)} className="h-8 w-8 grid place-items-center rounded-[6px] hover:bg-accent" aria-label="Semana siguiente"><ChevronRight size={15} /></button>
                    <Button size="sm" className="ml-1.5" onClick={() => { const d = new Date(); d.setMinutes(0, 0, 0); d.setHours(Math.max(d.getHours() + 1, DESDE_H)); alNueva(d); }}><Plus size={14} /> Reservar</Button>
                </div>
            </div>
            {error ? <div className="p-4"><ErrorEstado mensaje={error} alReintentar={() => setLunes(new Date(lunes))} /></div> : (
                <div className="overflow-x-auto">
                    <div className="min-w-[640px]">
                        {/* Los días */}
                        <div className="grid grid-cols-[44px_repeat(7,minmax(0,1fr))] border-b border-border">
                            <span />
                            {dias.map((d) => {
                                const esHoy = d.toDateString() === hoy.toDateString();
                                return (
                                    <div key={d.toISOString()} className="px-1.5 py-2 text-center">
                                        <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">{d.toLocaleDateString("es-UY", { weekday: "short" }).replace(".", "")}</p>
                                        <p className={cn("mx-auto mt-0.5 grid h-7 w-7 place-items-center rounded-full text-[13px] font-bold tabular-nums", esHoy && "bg-[var(--accion)] text-white")}>{d.getDate()}</p>
                                    </div>
                                );
                            })}
                        </div>
                        {/* La grilla de horas, con los turnos encima. Cambiar de semana la desliza hacia ese lado. */}
                        <AnimatePresence mode="wait" initial={false} custom={sentido}>
                            <motion.div key={lunes.toISOString()} custom={sentido}
                                initial={quieto ? false : { opacity: 0, x: 18 * sentido }} animate={{ opacity: 1, x: 0 }} exit={quieto ? undefined : { opacity: 0, x: -18 * sentido }}
                                transition={{ type: "spring", bounce: 0, duration: 0.32 }}
                                className="relative grid grid-cols-[44px_repeat(7,minmax(0,1fr))]" style={{ height: ALTO }}>
                                <div className="relative">
                                    {horas.map((h, i) => <span key={h} className="absolute right-1.5 -translate-y-1/2 text-[10px] tabular-nums text-muted-foreground" style={{ top: `${(i / horas.length) * 100}%` }}>{i === 0 ? "" : `${h}:00`}</span>)}
                                </div>
                                {dias.map((d) => {
                                    const esHoy = d.toDateString() === hoy.toDateString();
                                    const delDia = (filas || []).map((r) => ({ r, p: posicionEnDia(r, d, DESDE_H, HASTA_H) })).filter((x) => x.p);
                                    const ahoraP = esHoy ? posicionEnDia({ inicio: hoy, fin: new Date(hoy.getTime() + 60_000) }, d, DESDE_H, HASTA_H) : null;
                                    return (
                                        <div key={d.toISOString()} className={cn("relative border-l border-border", esHoy && "bg-[color-mix(in_oklab,var(--accion)_3%,transparent)]")}>
                                            {/* Cada hora es un botón: tocar un hueco arranca una reserva a esa hora. */}
                                            {horas.map((h, i) => (
                                                <button key={h} type="button" aria-label={`Reservar el ${diaLargo(d)} a las ${h}:00`}
                                                    onClick={() => alNueva(new Date(d.getFullYear(), d.getMonth(), d.getDate(), h))}
                                                    className="absolute inset-x-0 border-t border-border/60 hover:bg-accent/60 transition-colors" style={{ top: `${(i / horas.length) * 100}%`, height: `${100 / horas.length}%` }} />
                                            ))}
                                            {ahoraP && <span className="pointer-events-none absolute inset-x-0 z-10 h-0.5 bg-[var(--mal)]" style={{ top: `${ahoraP.arriba * 100}%` }}><span className="absolute -left-1 -top-[3px] h-2 w-2 rounded-full bg-[var(--mal)]" /></span>}
                                            {delDia.map(({ r, p }) => {
                                                const cancelada = r.estado === "CANCELADA";
                                                const tono = tonoDe(ESTADOS_RESERVA, r.estado);
                                                return (
                                                    <button key={r.id} type="button" onClick={() => alAbrir(r)}
                                                        className={cn("absolute left-0.5 right-0.5 z-[5] overflow-hidden rounded-[6px] border px-1.5 py-1 text-left transition-transform hover:z-20 hover:scale-[1.02]",
                                                            cancelada ? "border-dashed border-border bg-background text-muted-foreground line-through" : tono === "aviso" ? "chip-aviso border-transparent" : "border-transparent bg-[var(--accion)] text-white")}
                                                        style={{ top: `calc(${p!.arriba * 100}% + 1px)`, height: `calc(${p!.alto * 100}% - 2px)` }}>
                                                        <p className="truncate text-[11px] font-bold leading-tight">{r.lote || r.responsable}</p>
                                                        <p className="truncate text-[10px] opacity-90 tabular-nums">{hhmm(r.inicio)}–{hhmm(r.fin)}{r.motivo ? ` · ${r.motivo}` : ""}</p>
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    );
                                })}
                            </motion.div>
                        </AnimatePresence>
                    </div>
                </div>
            )}
        </div>
    );
}

function ProximasReservas({ espacioId, alAbrir }: { espacioId: string; alAbrir: (r: ReservaVista) => void }) {
    const [filas, setFilas] = useState<ReservaVista[] | null>(null);
    useEffect(() => { let vivo = true; proximasReservas(espacioId).then((r) => { if (vivo) setFilas(r); }).catch(() => { if (vivo) setFilas([]); }); return () => { vivo = false; }; }, [espacioId]);
    const vivas = (filas || []).filter((r) => r.estado !== "CANCELADA");
    return (
        <div className="rounded-[14px] border border-border bg-card p-4">
            <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Próximas reservas</p>
            {!filas ? <p className="mt-2 text-[12.5px] text-muted-foreground">Trayendo…</p> : !vivas.length ? <p className="mt-2 text-[12.5px] text-muted-foreground">No hay reservas por delante.</p> : (
                <ul className="mt-2 divide-y divide-border">
                    {vivas.slice(0, 8).map((r) => (
                        <li key={r.id}>
                            <button type="button" onClick={() => alAbrir(r)} className="flex w-full items-center gap-3 py-2 text-left hover:text-[var(--accion)]">
                                <span className="w-11 shrink-0 text-center">
                                    <span className="block text-[9.5px] font-bold uppercase text-muted-foreground">{new Date(r.inicio).toLocaleDateString("es-UY", { weekday: "short" }).replace(".", "")}</span>
                                    <span className="block text-[17px] font-bold leading-none tabular-nums">{new Date(r.inicio).getDate()}</span>
                                </span>
                                <span className="min-w-0 flex-1">
                                    <span className="block truncate text-[13px] font-semibold">{r.lote || r.responsable}</span>
                                    <span className="block truncate text-[11.5px] text-muted-foreground tabular-nums">{hhmm(r.inicio)}–{hhmm(r.fin)}{r.invitados ? ` · ${r.invitados} personas` : ""}{r.motivo ? ` · ${r.motivo}` : ""}</span>
                                </span>
                                {r.estado === "PEDIDA" && <Chip tono="aviso">Pedida</Chip>}
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}

/* ═══════════════════════ Tareas ═══════════════════════ */

function TareasDeEspacio({ espacioId, alCambiar, sinTitulo }: { espacioId: string; alCambiar: () => void; sinTitulo?: boolean }) {
    const [filas, setFilas] = useState<TareaVista[] | null>(null);
    const [vuelta, setVuelta] = useState(0);
    const [nueva, setNueva] = useState<{ titulo: string; tipo: string; prioridad: string; responsable: string; vence: string } | null>(null);
    const [verHechas, setVerHechas] = useState(false);
    const [ahora] = useState(() => Date.now());
    useEffect(() => { let vivo = true; tareasDe(espacioId).then((r) => { if (vivo) setFilas(r); }).catch(() => { if (vivo) setFilas([]); }); return () => { vivo = false; }; }, [espacioId, vuelta]);
    const listo = () => { setVuelta((n) => n + 1); alCambiar(); };
    const abiertas = (filas || []).filter((t) => t.estado !== "HECHA"), hechas = (filas || []).filter((t) => t.estado === "HECHA");
    return (
        <div>
            <div className="flex items-center gap-2">
                {!sinTitulo && <p className="text-[14px] font-bold inline-flex items-center gap-2"><Wrench size={15} /> Mantenimiento y tareas</p>}
                <span className="text-[11.5px] text-muted-foreground">{abiertas.length} {abiertas.length === 1 ? "abierta" : "abiertas"}</span>
                {!nueva && <Button size="sm" variant="outline" className="ml-auto" onClick={() => setNueva({ titulo: "", tipo: "MANTENIMIENTO", prioridad: "NORMAL", responsable: "", vence: "" })}><Plus size={14} /> Anotar</Button>}
            </div>
            <AnimatePresence initial={false}>
                {nueva && (
                    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ type: "spring", bounce: 0, duration: 0.3 }} className="overflow-hidden">
                        <div className="mt-3 space-y-2.5 rounded-[10px] border border-border p-3">
                            <input autoFocus value={nueva.titulo} onChange={(e) => setNueva({ ...nueva, titulo: e.target.value })} placeholder="Qué hay que hacer: «cambiar la lámpara del baño», «limpiar la parrilla»" className={ENTRADA} />
                            <div className="flex flex-wrap items-center gap-3">
                                <Eleccion opciones={TIPOS_TAREA.map((t) => ({ v: t.id, r: t.rotulo }))} valor={nueva.tipo} alCambiar={(v) => setNueva({ ...nueva, tipo: v })} />
                                <Eleccion opciones={[{ v: "NORMAL", r: "Normal" }, { v: "URGENTE", r: "Urgente" }] as const} valor={nueva.prioridad as "NORMAL" | "URGENTE"} alCambiar={(v) => setNueva({ ...nueva, prioridad: v })} />
                            </div>
                            <div className="grid gap-2 sm:grid-cols-2">
                                <input value={nueva.responsable} onChange={(e) => setNueva({ ...nueva, responsable: e.target.value })} placeholder="Quién (opcional)" className={ENTRADA} />
                                <input type="date" value={nueva.vence} onChange={(e) => setNueva({ ...nueva, vence: e.target.value })} className={ENTRADA} aria-label="Para cuándo" />
                            </div>
                            <div className="flex justify-end gap-2">
                                <Button size="sm" variant="ghost" onClick={() => setNueva(null)}>Cancelar</Button>
                                <Button size="sm" disabled={nueva.titulo.trim().length < 2} onClick={async () => {
                                    const r = await correr(() => guardarTarea({ espacioId, ...nueva, vence: nueva.vence ? new Date(`${nueva.vence}T12:00:00`).toISOString() : null }), "Tarea anotada");
                                    if (r.ok) { setNueva(null); listo(); }
                                }}><Check size={14} /> Anotar</Button>
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
            {!filas ? <p className="mt-3 text-[12.5px] text-muted-foreground">Trayendo…</p> : !filas.length ? (
                <p className="mt-3 text-[12.5px] text-muted-foreground">Nada anotado. Lo que haya que arreglar, limpiar o revisar queda acá con quién y para cuándo.</p>
            ) : (
                <ul className="mt-3 space-y-1.5">
                    {[...abiertas, ...(verHechas ? hechas : [])].map((t) => {
                        const vencida = t.vence && t.estado !== "HECHA" && Date.parse(t.vence) < ahora - 12 * 3600_000;
                        return (
                            <li key={t.id} className={cn("group flex items-start gap-3 rounded-[10px] border px-3 py-2.5", t.estado === "HECHA" ? "border-border/60 opacity-70" : "border-border")}>
                                <button type="button" aria-label={t.estado === "HECHA" ? "Volver a abrir" : "Marcar hecha"} onClick={async () => { const r = await correr(() => cambiarEstadoTarea(t.id, t.estado === "HECHA" ? "PENDIENTE" : "HECHA"), t.estado === "HECHA" ? "Tarea abierta de nuevo" : "Tarea hecha"); if (r.ok) listo(); }}
                                    className={cn("mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 transition-colors", t.estado === "HECHA" ? "border-[var(--bien)] bg-[var(--bien)] text-white" : "border-border hover:border-[var(--bien)]")}>
                                    {t.estado === "HECHA" && <Check size={11} strokeWidth={3} />}
                                </button>
                                <div className="min-w-0 flex-1">
                                    <p className={cn("text-[13px] font-semibold", t.estado === "HECHA" && "line-through")}>{t.titulo}</p>
                                    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11.5px] text-muted-foreground">
                                        <span>{rotuloDe(TIPOS_TAREA.map((x) => ({ id: x.id, rotulo: x.rotulo })), t.tipo)}</span>
                                        {t.responsable && <span>· {t.responsable}</span>}
                                        {t.vence && <span className={cn(vencida && "tono-mal font-semibold")}>· {vencida ? "venció" : "para"} el {new Date(t.vence).toLocaleDateString("es-UY", { day: "numeric", month: "short" })}</span>}
                                        {t.estado === "HECHA" && t.hechaAt && <span>· hecha {hace(t.hechaAt)}</span>}
                                    </p>
                                </div>
                                {t.prioridad === "URGENTE" && t.estado !== "HECHA" && <Chip tono="mal">Urgente</Chip>}
                                {t.estado !== "HECHA" && (
                                    <button type="button" onClick={async () => { const r = await correr(() => cambiarEstadoTarea(t.id, t.estado === "EN_CURSO" ? "PENDIENTE" : "EN_CURSO"), "Listo"); if (r.ok) listo(); }}
                                        className={cn("h-6 px-2 rounded-full text-[11px] font-semibold border", t.estado === "EN_CURSO" ? "chip-info border-transparent" : "border-border text-muted-foreground hover:bg-accent")}>
                                        {rotuloDe(ESTADOS_TAREA, t.estado)}
                                    </button>
                                )}
                                <DeleteButton className="scale-[.66] -m-2 opacity-0 group-hover:opacity-100 transition-opacity" aria-label="Borrar la tarea" onConfirm={async () => { const r = await correr(() => borrarTarea(t.id), "Tarea borrada"); if (r.ok) listo(); }} />
                            </li>
                        );
                    })}
                </ul>
            )}
            {hechas.length > 0 && (
                <button type="button" onClick={() => setVerHechas((v) => !v)} className="mt-2 text-[12px] font-semibold text-muted-foreground hover:text-[var(--accion)]">
                    {verHechas ? "Ocultar las hechas" : hechas.length === 1 ? "Ver la hecha" : `Ver las ${hechas.length} hechas`}
                </button>
            )}
        </div>
    );
}

/* ═══════════════════════ Cajones de carga ═══════════════════════ */

/* Los cajones de carga arman su formulario adentro de un componente con clave: al abrir con otro
   valor arranca de cero sin copiar el valor al estado dentro de un efecto. */
function CajonEspacio({ valor, alCerrar, alGuardar }: { valor: Partial<EspacioVisto> | null; alCerrar: () => void; alGuardar: (id?: string) => void }) {
    return (
        <Cajon open={!!valor} onOpenChange={(o) => { if (!o) alCerrar(); }}>
            {valor && <FormEspacio key={valor.id || `nuevo-${valor.tipo}`} valor={valor} alCerrar={alCerrar} alGuardar={alGuardar} />}
        </Cajon>
    );
}
function FormEspacio({ valor, alCerrar, alGuardar }: { valor: Partial<EspacioVisto>; alCerrar: () => void; alGuardar: (id?: string) => void }) {
    const [f, setF] = useState<Partial<EspacioVisto>>(() => ({ reservable: TIPOS_ESPACIO.find((t) => t.id === valor.tipo)?.reservable ?? false, ...valor }));
    const [guardando, setGuardando] = useState(false);
    const set = <K extends keyof EspacioVisto>(k: K, v: EspacioVisto[K]) => setF((x) => ({ ...x, [k]: v }));
    const Dib = DIBUJO[f.tipo || "OTRO"] || MapPin;
    const titulo = valor.id ? `Editar ${valor.nombre}` : f.tipo === "SUM" ? "Cargar el SUM" : "Nuevo espacio común";
    return (
            <CajonContenido ancho="medio" titulo={titulo}
                descripcion="La ficha que ve quien lo tiene que usar o cuidar: qué es, cuándo se usa, qué tiene adentro y sus reglas."
                pie={
                    <div className="flex w-full items-center gap-2">
                        {valor.id && <DeleteButton aria-label="Borrar el espacio" onConfirm={async () => { const r = await correr(() => borrarEspacio(valor.id!), "Espacio borrado"); if (r.ok) alGuardar(); }} />}
                        <span className="flex-1 truncate text-[12px] text-muted-foreground">{valor.id ? "Las reservas y tareas que ya tiene no cambian." : ""}</span>
                        <Button variant="ghost" onClick={alCerrar}>Cancelar</Button>
                        <Button disabled={guardando || (f.nombre || "").trim().length < 2} onClick={async () => {
                            setGuardando(true);
                            const r = await correr(() => guardarEspacio({
                                id: f.id, administracionId: f.administracionId ?? null, tipo: f.tipo || "OTRO", nombre: f.nombre || "", descripcion: f.descripcion || "", capacidad: f.capacidad ?? null,
                                horario: f.horario || "", reglamento: f.reglamento || "", inventario: f.inventario || "", responsable: f.responsable || "", reservable: !!f.reservable,
                            }), valor.id ? "Ficha guardada" : "Espacio cargado");
                            setGuardando(false);
                            if (r.ok) alGuardar(valor.id ? undefined : r.id);
                        }}><Check size={14} /> Guardar</Button>
                    </div>
                }>
                {/* La ficha como va a quedar: el dibujo del tipo y el nombre, mientras se escribe. */}
                <div className="px-6 pt-5">
                    <div className="flex items-center gap-3 rounded-[14px] bg-muted/50 p-3.5">
                        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-[10px] bg-background text-[var(--accion)]"><Dib size={20} /></span>
                        <div className="min-w-0 flex-1">
                            <p className="truncate text-[15px] font-bold">{(f.nombre || "").trim() || (f.tipo === "SUM" ? "SUM" : "Sin nombre todavía")}</p>
                            <p className="text-[12px] text-muted-foreground">{rotuloTipo(f.tipo || "OTRO")}{f.capacidad ? ` · ${f.capacidad} personas` : ""}{f.reservable ? " · se reserva" : ""}</p>
                        </div>
                    </div>
                </div>
                <CajonSeccion titulo="Qué es" icono={LayoutGrid} compacta ayuda="Define el dibujo de la ficha y si se reserva por turnos de entrada (se puede cambiar abajo).">
                    <div className="flex flex-wrap gap-1.5" role="radiogroup">
                        {TIPOS_ESPACIO.map((t) => {
                            const I = DIBUJO[t.id] || MapPin, activo = (f.tipo || "OTRO") === t.id;
                            return (
                                <button key={t.id} type="button" role="radio" aria-checked={activo}
                                    onClick={() => setF((x) => ({ ...x, tipo: t.id, reservable: x.id ? x.reservable : t.reservable }))}
                                    className={cn("h-8 px-3 rounded-full border text-[12px] font-semibold inline-flex items-center gap-1.5", activo ? "border-[var(--accion)] text-[var(--accion)] bg-[color-mix(in_oklab,var(--accion)_8%,transparent)]" : "border-border hover:bg-accent")}>
                                    <I size={13} />{t.rotulo}
                                </button>
                            );
                        })}
                    </div>
                </CajonSeccion>
                <CajonSeccion titulo="Datos" icono={ClipboardList} compacta>
                    <CajonCampo etiqueta="Nombre" ayuda="Como lo nombra la gente del barrio.">
                        <input autoFocus value={f.nombre || ""} onChange={(e) => set("nombre", e.target.value)} placeholder={f.tipo === "SUM" ? "SUM de la 7ª Etapa" : "Piscina grande, Cancha de fútbol 5…"} className={ENTRADA} />
                    </CajonCampo>
                    <div className="grid gap-3 sm:grid-cols-2">
                        <CajonCampo etiqueta="Capacidad" ayuda="Personas como máximo. Una reserva con más invitados no se deja guardar.">
                            <input inputMode="numeric" value={f.capacidad ?? ""} onChange={(e) => set("capacidad", e.target.value ? Number(e.target.value.replace(/\D/g, "")) : null)} placeholder="60" className={cn(ENTRADA, "tabular-nums")} />
                        </CajonCampo>
                        <CajonCampo etiqueta="Horario" ayuda="Cuándo se puede usar, como se dice.">
                            <input value={f.horario || ""} onChange={(e) => set("horario", e.target.value)} placeholder="Todos los días de 9 a 23" className={ENTRADA} />
                        </CajonCampo>
                    </div>
                    <CajonCampo etiqueta="Responsable" ayuda="Quién lo cuida o a quién llamar si pasa algo.">
                        <input value={f.responsable || ""} onChange={(e) => set("responsable", e.target.value)} placeholder="Marta, de la administración · 099 123 456" className={ENTRADA} />
                    </CajonCampo>
                    <CajonCampo etiqueta="Descripción" ayuda="Dónde queda, cómo se accede, lo que convenga saber.">
                        <textarea value={f.descripcion || ""} onChange={(e) => set("descripcion", e.target.value)} rows={2} className={cn(ENTRADA, "h-auto py-2 leading-snug")} />
                    </CajonCampo>
                </CajonSeccion>
                <CajonSeccion titulo="Reservas" icono={CalendarDays} compacta>
                    <button type="button" role="switch" aria-checked={!!f.reservable} onClick={() => set("reservable", !f.reservable)}
                        className={cn("flex w-full items-start gap-3 rounded-[10px] border p-3.5 text-left transition-colors", f.reservable ? "border-[var(--accion)] bg-[color-mix(in_oklab,var(--accion)_5%,transparent)]" : "border-border hover:bg-accent/40")}>
                        <span className={cn("mt-0.5 relative h-5 w-9 shrink-0 rounded-full transition-colors", f.reservable ? "bg-[var(--accion)]" : "bg-muted-foreground/30")}>
                            <span className={cn("absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all", f.reservable ? "left-[18px]" : "left-0.5")} />
                        </span>
                        <span>
                            <span className="block text-[13px] font-semibold">Se reserva por turnos</span>
                            <span className="block text-[12px] leading-snug text-muted-foreground">Lleva su agenda de la semana: quién lo usa, cuándo y para qué, sin que dos reservas se pisen. El SUM, una cancha o un parrillero, sí; una piscina o una plaza, normalmente no.</span>
                        </span>
                    </button>
                </CajonSeccion>
                <CajonSeccion titulo="Lo que tiene" icono={Armchair} compacta ayuda="El inventario, para revisarlo después de cada uso y saber si falta algo.">
                    <textarea value={f.inventario || ""} onChange={(e) => set("inventario", e.target.value)} rows={3} placeholder="40 sillas, 8 mesas, parrilla, heladera, equipo de audio" className={cn(ENTRADA, "h-auto py-2 leading-snug")} />
                </CajonSeccion>
                <CajonSeccion titulo="Reglamento" icono={ScrollText} compacta ayuda="El que aprobó la comisión, tal cual. Se ve desplegable en la ficha, para mostrárselo a quien reserva.">
                    <textarea value={f.reglamento || ""} onChange={(e) => set("reglamento", e.target.value)} rows={8} placeholder={"1. Se reserva con 72 h de anticipación.\n2. Horario máximo hasta las 24 h.\n3. Se entrega limpio y con el inventario completo."} className={cn(ENTRADA, "h-auto py-2 leading-relaxed")} />
                </CajonSeccion>
            </CajonContenido>
    );
}

function CajonReserva({ valor, espacio, administracionId, alCerrar, alGuardar }: { valor: Partial<ReservaVista> | null; espacio: EspacioVisto | null; administracionId: string; alCerrar: () => void; alGuardar: () => void }) {
    return (
        <Cajon open={!!valor && !!espacio} onOpenChange={(o) => { if (!o) alCerrar(); }}>
            {valor && espacio && <FormReserva key={valor.id || `nueva-${valor.inicio}`} valor={valor} espacio={espacio} administracionId={administracionId} alCerrar={alCerrar} alGuardar={alGuardar} />}
        </Cajon>
    );
}
function FormReserva({ valor, espacio, administracionId, alCerrar, alGuardar }: { valor: Partial<ReservaVista>; espacio: EspacioVisto; administracionId: string; alCerrar: () => void; alGuardar: () => void }) {
    const [f, setF] = useState(() => {
        const i = valor.inicio ? new Date(valor.inicio) : new Date(), fi = valor.fin ? new Date(valor.fin) : new Date(i.getTime() + 4 * 3600_000);
        return { unitId: valor.unitId || "", lote: valor.lote || "", responsable: valor.responsable || "", telefono: valor.telefono || "", motivo: valor.motivo || "", invitados: valor.invitados ? String(valor.invitados) : "",
            dia: aFecha(i), desde: aHora(i), hasta: aHora(fi), estado: valor.estado || "CONFIRMADA", nota: valor.nota || "" };
    });
    const [buscar, setBuscar] = useState("");
    const [lotes, setLotes] = useState<{ id: string; nombre: string; titular: string | null }[]>([]);
    const [guardando, setGuardando] = useState(false);
    useEffect(() => {
        if (f.unitId) return;
        let vivo = true;
        const h = setTimeout(() => { lotesParaReservar(administracionId, buscar).then((l) => { if (vivo) setLotes(l); }).catch(() => { }); }, 200);
        return () => { vivo = false; clearTimeout(h); };
    }, [buscar, f.unitId, administracionId]);
    /* «hasta 00:00» es medianoche del día siguiente: una fiesta que termina a las 24. */
    const turno = () => {
        const inicio = new Date(`${f.dia}T${f.desde}`);
        let fin = new Date(`${f.dia}T${f.hasta}`);
        if (fin <= inicio) fin = new Date(fin.getTime() + 86400_000);
        return { inicio, fin };
    };
    const t = f.dia && f.desde && f.hasta ? turno() : null;
    const horas = t ? (t.fin.getTime() - t.inicio.getTime()) / 3600_000 : 0;
    const invitados = Number(f.invitados) || 0;
    const pasado = !!espacio.capacidad && invitados > espacio.capacidad;
    const editando = !!valor.id;
    const Dib = DIBUJO[espacio.tipo] || MapPin;
    const AYUDA_ESTADO: Record<string, string> = {
        PEDIDA: "La pidieron pero falta confirmar (la seña, el reglamento firmado). Ocupa el turno igual, en ámbar.",
        CONFIRMADA: "Está acordada: el turno es de este lote.",
        CANCELADA: "Libera el turno. Queda en el registro, tachada.",
    };
    return (
            <CajonContenido ancho="intermedio" titulo={editando ? "Reserva" : `Reservar ${espacio.nombre}`}
                descripcion={editando ? `${espacio.nombre}${valor.creadaPor ? ` · cargada por ${valor.creadaPor}` : ""}` : "Quién lo usa, cuándo y para qué. Si se pisa con otra reserva, no se deja guardar y se dice con cuál."}
                pie={
                    <div className="flex w-full items-center gap-2">
                        {editando && valor.estado !== "CANCELADA" && <Button variant="ghost" className="tono-mal" onClick={async () => { const r = await correr(() => cancelarReserva(valor.id!), "Reserva cancelada"); if (r.ok) alGuardar(); }}><X size={14} /> Cancelar reserva</Button>}
                        <span className="flex-1" />
                        <Button variant="ghost" onClick={alCerrar}>Cerrar</Button>
                        <Button disabled={guardando || f.responsable.trim().length < 2 || !t || pasado} onClick={async () => {
                            setGuardando(true);
                            const x = turno();
                            const r = await correr(() => guardarReserva({ id: valor.id, espacioId: espacio.id, unitId: f.unitId || null, lote: f.lote, responsable: f.responsable, telefono: f.telefono, motivo: f.motivo,
                                invitados: f.invitados ? Number(f.invitados) : null, inicio: x.inicio.toISOString(), fin: x.fin.toISOString(), estado: f.estado, nota: f.nota }), editando ? "Reserva guardada" : "Reservado");
                            setGuardando(false);
                            if (r.ok) alGuardar();
                        }}><Check size={14} /> {editando ? "Guardar" : "Reservar"}</Button>
                    </div>
                }>
                {/* El turno como va a quedar, en una tarjeta que se arma mientras se completa. */}
                <div className="px-6 pt-5">
                    <div className="flex items-center gap-3.5 rounded-[14px] bg-muted/50 p-3.5">
                        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-[10px] bg-background text-center">
                            {t ? <span><span className="block text-[9.5px] font-bold uppercase text-muted-foreground">{t.inicio.toLocaleDateString("es-UY", { weekday: "short" }).replace(".", "")}</span><span className="block text-[18px] font-bold leading-none tabular-nums">{t.inicio.getDate()}</span></span> : <Dib size={20} />}
                        </span>
                        <div className="min-w-0 flex-1">
                            <p className="truncate text-[14.5px] font-bold">{f.lote || f.responsable.trim() || "¿Quién reserva?"}</p>
                            <p className="text-[12px] text-muted-foreground tabular-nums">{t ? `${diaLargo(t.inicio)} · ${f.desde} a ${f.hasta} · ${horas.toLocaleString("es-UY", { maximumFractionDigits: 1 })} h` : "Elegí el día y la hora"}</p>
                        </div>
                        <Chip tono={tonoDe(ESTADOS_RESERVA, f.estado)}>{rotuloDe(ESTADOS_RESERVA, f.estado)}</Chip>
                    </div>
                </div>
                <CajonSeccion titulo="Quién reserva" icono={User} compacta ayuda="El lote queda anotado en la reserva; quién reserva es a quien se llama.">
                    <CajonCampo etiqueta="Lote">
                        {f.unitId ? (
                            <div className="flex items-center gap-2 rounded-[6px] border border-[var(--accion)] px-3 py-2">
                                <Home size={14} className="text-[var(--accion)]" />
                                <span className="flex-1 text-[13px] font-semibold">{f.lote}</span>
                                <button type="button" onClick={() => setF({ ...f, unitId: "", lote: "" })} className="text-muted-foreground hover:text-foreground" aria-label="Elegir otro lote"><X size={14} /></button>
                            </div>
                        ) : (
                            <>
                                <div className="relative"><Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                                    <input value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="Buscar el lote o el titular (opcional)" className={cn(ENTRADA, "pl-8")} /></div>
                                {buscar.trim() && lotes.length > 0 && (
                                    <ul className="mt-1.5 max-h-[180px] overflow-y-auto divide-y divide-border rounded-[6px] border border-border">
                                        {lotes.map((l) => (
                                            <li key={l.id}><button type="button" onClick={() => setF({ ...f, unitId: l.id, lote: l.nombre, responsable: f.responsable || (l.titular || "").split(/\s[-/]\s/)[0] })} className="w-full px-3 py-1.5 text-left hover:bg-accent">
                                                <span className="text-[13px] font-semibold">{l.nombre}</span>{l.titular && <span className="ml-2 text-[11.5px] text-muted-foreground">{l.titular}</span>}
                                            </button></li>
                                        ))}
                                    </ul>
                                )}
                            </>
                        )}
                    </CajonCampo>
                    <div className="grid gap-3 sm:grid-cols-2">
                        <CajonCampo etiqueta="Quién reserva"><input value={f.responsable} onChange={(e) => setF({ ...f, responsable: e.target.value })} placeholder="Nombre y apellido" className={ENTRADA} /></CajonCampo>
                        <CajonCampo etiqueta="Teléfono"><input value={f.telefono} onChange={(e) => setF({ ...f, telefono: e.target.value })} inputMode="tel" placeholder="099 123 456" className={cn(ENTRADA, "tabular-nums")} /></CajonCampo>
                    </div>
                </CajonSeccion>
                <CajonSeccion titulo="Cuándo" icono={Clock} compacta ayuda={espacio.horario ? `Horario del espacio: ${espacio.horario}. Si termina a las 00:00, es la medianoche de ese día.` : "Si termina a las 00:00, es la medianoche de ese día."}>
                    <div className="grid grid-cols-[1.4fr_1fr_1fr] gap-2">
                        <CajonCampo etiqueta="Día"><input type="date" value={f.dia} onChange={(e) => setF({ ...f, dia: e.target.value })} className={ENTRADA} /></CajonCampo>
                        <CajonCampo etiqueta="Desde"><input type="time" step={900} value={f.desde} onChange={(e) => setF({ ...f, desde: e.target.value })} className={cn(ENTRADA, "tabular-nums")} /></CajonCampo>
                        <CajonCampo etiqueta="Hasta"><input type="time" step={900} value={f.hasta} onChange={(e) => setF({ ...f, hasta: e.target.value })} className={cn(ENTRADA, "tabular-nums")} /></CajonCampo>
                    </div>
                </CajonSeccion>
                <CajonSeccion titulo="Para qué" icono={PartyPopper} compacta>
                    <div className="grid gap-3 sm:grid-cols-[1fr_130px]">
                        <CajonCampo etiqueta="Motivo"><input value={f.motivo} onChange={(e) => setF({ ...f, motivo: e.target.value })} placeholder="Cumpleaños, reunión de la comisión…" className={ENTRADA} /></CajonCampo>
                        <CajonCampo etiqueta="Personas" ayuda={espacio.capacidad ? `Hasta ${espacio.capacidad}.` : undefined}>
                            <input inputMode="numeric" value={f.invitados} onChange={(e) => setF({ ...f, invitados: e.target.value.replace(/\D/g, "") })} className={cn(ENTRADA, "tabular-nums", pasado && "border-[var(--mal)]")} />
                        </CajonCampo>
                    </div>
                    {pasado && <p className="text-[12px] tono-mal">{espacio.nombre} tiene capacidad para {espacio.capacidad} personas.</p>}
                </CajonSeccion>
                <CajonSeccion titulo="Estado" icono={ShieldCheck} compacta ayuda={AYUDA_ESTADO[f.estado]}>
                    <Eleccion opciones={ESTADOS_RESERVA.filter((x) => x.id !== "CANCELADA" || editando).map((x) => ({ v: x.id, r: x.rotulo }))} valor={f.estado as (typeof ESTADOS_RESERVA)[number]["id"]} alCambiar={(v) => setF({ ...f, estado: v })} />
                </CajonSeccion>
                <CajonSeccion titulo="Nota" icono={StickyNote} compacta ayuda="Lo que haya que acordarse el día: la seña, quién retira las llaves, qué se entrega.">
                    <textarea value={f.nota} onChange={(e) => setF({ ...f, nota: e.target.value })} rows={2} placeholder="Seña pagada · retira las llaves el viernes" className={cn(ENTRADA, "h-auto py-2 leading-snug")} />
                </CajonSeccion>
            </CajonContenido>
    );
}
