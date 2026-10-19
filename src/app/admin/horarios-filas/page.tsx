"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Tooltip } from "react-tooltip";
import {
    CalendarClock, ChevronLeft, ChevronRight, Plus, RotateCcw, Users, Type, Clock, CalendarX2, Trash2, Loader2, Save, CalendarDays, StickyNote,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Cajon, CajonContenido } from "@/components/ui/cajon";
import { Bloque, Campo, Etiqueta, TT, tip } from "@/components/devices/CajonDispositivo";
import {
    getQueueSchedules, createQueueSchedule, updateQueueSchedule, deleteQueueSchedule, runQueueReset,
    getDiasEspeciales, guardarDiaEspecial, borrarDiaEspecial,
} from "@/app/actions/queue-schedules";
import { getQueueDevices } from "@/app/actions/queue";
import { enMontevideo, diasDe, especialDe, horariosDe } from "@/lib/filas/horario";
import { cn } from "@/lib/utils";
import { sileo as toast } from "sileo";

/**
 * Horarios de las filas, como calendario (Nico, HB 19/10: «un calendario completo, bien hecho,
 * profesional, para definir los calendarios no obligatorios a las filas creadas»).
 *
 * Dos cosas distintas, y por eso dos editores:
 *   - el HORARIO de siempre: qué días y de qué hora a qué hora atiende una fila (o todas), y si al
 *     abrir el contador vuelve a cero;
 *   - el DÍA ESPECIAL: una fecha que no sigue el de siempre — feriado (cerrada) u otro horario.
 * Son opcionales: una fila sin horarios atiende siempre y avisa a toda hora. Con horario, fuera
 * de él no avisa que está llena (lib/filas/horario, usado también por el aviso y el reinicio).
 *
 * Vistas: SEMANA (franjas por día, como una agenda) y MES (qué pasa cada día, de un vistazo).
 */

type Horario = { id: string; name: string; deviceId: string | null; daysOfWeek: string; openTime: string; closeTime: string; resetOnOpen: boolean; enabled: boolean };
type Especial = { id: string; fecha: string; deviceId: string | null; cerrada: boolean; openTime: string | null; closeTime: string | null; nota: string | null };
type Fila = { id: string; name: string };

const DIAS = [
    { n: 1, corto: "Lun", inicial: "L", largo: "Lunes" }, { n: 2, corto: "Mar", inicial: "M", largo: "Martes" },
    { n: 3, corto: "Mié", inicial: "X", largo: "Miércoles" }, { n: 4, corto: "Jue", inicial: "J", largo: "Jueves" },
    { n: 5, corto: "Vie", inicial: "V", largo: "Viernes" }, { n: 6, corto: "Sáb", inicial: "S", largo: "Sábado" },
    { n: 7, corto: "Dom", inicial: "D", largo: "Domingo" },
];
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
/** La grilla de la semana muestra de una hora antes de la primera apertura a una después del último cierre. */
const GRILLA_POR_DEFECTO = { desde: 7, hasta: 21 };
const ALTO_HORA_PX = 44;
const TODAS = "__todas";

/* ── Fechas como texto AAAA-MM-DD: el calendario es de días, no de instantes ── */
const aTexto = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const deTexto = (s: string) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const sumarDias = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const lunesDe = (d: Date) => sumarDias(d, -((d.getDay() + 6) % 7));
const dowDe = (d: Date) => (d.getDay() === 0 ? 7 : d.getDay());
const minutos = (hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };

/** Lo que pasa un día con una fila: cerrada, o sus franjas (y si vienen de un día especial). */
function franjasDelDia(horarios: Horario[], especiales: Especial[], filaId: string, fecha: string) {
    const esp = especialDe(especiales as any, filaId, fecha) as Especial | null;
    if (esp) return esp.cerrada || !esp.openTime || !esp.closeTime
        ? { cerrada: true, especial: esp, franjas: [] as { abre: string; cierra: string; horario?: Horario }[] }
        : { cerrada: false, especial: esp, franjas: [{ abre: esp.openTime, cierra: esp.closeTime }] };
    const dow = dowDe(deTexto(fecha));
    const propios = (horariosDe(horarios as any, filaId) as Horario[]).filter((h) => diasDe(h.daysOfWeek).includes(dow));
    return { cerrada: false, especial: null, franjas: propios.map((h) => ({ abre: h.openTime, cierra: h.closeTime, horario: h })) };
}

export default function HorariosFilasPage() {
    const [horarios, setHorarios] = useState<Horario[]>([]);
    const [especiales, setEspeciales] = useState<Especial[]>([]);
    const [filas, setFilas] = useState<Fila[]>([]);
    const [cargando, setCargando] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [vista, setVista] = useState<"semana" | "mes">("semana");
    const [ancla, setAncla] = useState(() => new Date());
    const [filtro, setFiltro] = useState<string>("");
    const [editHorario, setEditHorario] = useState<Partial<Horario> | null>(null);
    const [editEspecial, setEditEspecial] = useState<Partial<Especial> | null>(null);
    const [ahora, setAhora] = useState(() => enMontevideo());

    const cargar = useCallback(async () => {
        try {
            const [h, e, f] = await Promise.all([getQueueSchedules(), getDiasEspeciales(), getQueueDevices()]);
            setHorarios(h as any); setEspeciales(e as any); setFilas((f as any[]).map((x) => ({ id: x.id, name: x.name })));
            setError(null);
        } catch (e: any) { setError(e?.message || "No se pudieron leer los horarios"); }
        finally { setCargando(false); }
    }, []);
    useEffect(() => { cargar(); }, [cargar]);
    useEffect(() => { const t = setInterval(() => setAhora(enMontevideo()), 30_000); return () => clearInterval(t); }, []);

    const filasVisibles = filtro ? filas.filter((f) => f.id === filtro) : filas;
    const nombreFila = (id: string | null) => (id ? filas.find((f) => f.id === id)?.name || "Fila borrada" : "Todas las filas");

    /* Navegación */
    const mover = (n: number) => setAncla((a) => (vista === "semana" ? sumarDias(a, 7 * n) : new Date(a.getFullYear(), a.getMonth() + n, 1)));
    const dias = useMemo(() => {
        if (vista === "semana") { const l = lunesDe(ancla); return Array.from({ length: 7 }, (_, i) => sumarDias(l, i)); }
        const primero = new Date(ancla.getFullYear(), ancla.getMonth(), 1);
        const l = lunesDe(primero);
        return Array.from({ length: 42 }, (_, i) => sumarDias(l, i));
    }, [vista, ancla]);
    const titulo = vista === "semana"
        ? (() => { const a = dias[0], b = dias[6]; return a.getMonth() === b.getMonth() ? `${a.getDate()} – ${b.getDate()} de ${MESES[a.getMonth()]} ${a.getFullYear()}` : `${a.getDate()} ${MESES[a.getMonth()].slice(0, 3)} – ${b.getDate()} ${MESES[b.getMonth()].slice(0, 3)} ${b.getFullYear()}`; })()
        : `${MESES[ancla.getMonth()][0].toUpperCase()}${MESES[ancla.getMonth()].slice(1)} ${ancla.getFullYear()}`;

    /* Rango horario de la grilla semanal */
    const grilla = useMemo(() => {
        const todas = [...horarios.filter((h) => h.enabled), ...especiales.filter((e) => !e.cerrada && e.openTime) as any[]];
        if (!todas.length) return GRILLA_POR_DEFECTO;
        const abre = Math.min(...todas.map((h: any) => minutos(h.openTime)));
        const cierra = Math.max(...todas.map((h: any) => (minutos(h.closeTime) <= minutos(h.openTime) ? 24 * 60 : minutos(h.closeTime))));
        return { desde: Math.max(0, Math.floor(abre / 60) - 1), hasta: Math.min(24, Math.ceil(cierra / 60) + 1) };
    }, [horarios, especiales]);

    async function alternarHorario(h: Horario) {
        try { await updateQueueSchedule(h.id, { enabled: !h.enabled }); cargar(); }
        catch (e: any) { toast.error({ title: "No se pudo cambiar", description: e?.message }); }
    }

    const proximosEspeciales = especiales.filter((e) => e.fecha >= ahora.fecha && (!filtro || !e.deviceId || e.deviceId === filtro)).slice(0, 8);
    const horariosVisibles = horarios.filter((h) => !filtro || !h.deviceId || h.deviceId === filtro);

    return (
        <div className="p-6 space-y-5 max-w-[1680px] mx-auto">
            <Tooltip id={TT} place="top" className="!max-w-[300px] !text-[12px] !leading-snug !rounded-lg !z-[9999]" />
            {/* Encabezado */}
            <div className="flex items-center gap-3 flex-wrap">
                <div>
                    <h1 className="text-[28px] font-bold tracking-[-0.02em] leading-tight">Horarios de las filas</h1>
                    <p className="text-[13px] text-muted-foreground">Cuándo atiende cada fila. Son opcionales: una fila sin horario atiende siempre y avisa a toda hora.</p>
                </div>
                <div className="ml-auto flex items-center gap-2">
                    <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setEditEspecial({ fecha: ahora.fecha, deviceId: filtro || null, cerrada: true })}><CalendarX2 size={14} /> Día especial</Button>
                    <Button size="sm" className="gap-1.5" onClick={() => setEditHorario({ name: "", deviceId: filtro || null, daysOfWeek: "1,2,3,4,5", openTime: "08:00", closeTime: "18:00", resetOnOpen: true, enabled: true })}><Plus size={14} /> Nuevo horario</Button>
                </div>
            </div>

            {/* Barra: navegación, vista y fila, en una sola fila */}
            <div className="flex items-center gap-3 flex-wrap rounded-[10px] border border-border bg-card px-3 py-2">
                <div className="flex items-center gap-1">
                    <button onClick={() => mover(-1)} className="h-8 w-8 grid place-items-center rounded-[6px] hover:bg-accent text-muted-foreground" aria-label="Anterior"><ChevronLeft size={16} /></button>
                    <button onClick={() => setAncla(new Date())} className="h-8 px-3 rounded-[6px] border border-border text-[12px] font-semibold hover:bg-accent">Hoy</button>
                    <button onClick={() => mover(1)} className="h-8 w-8 grid place-items-center rounded-[6px] hover:bg-accent text-muted-foreground" aria-label="Siguiente"><ChevronRight size={16} /></button>
                </div>
                <span className="text-[15px] font-semibold tracking-[-0.01em]">{titulo}</span>
                <div className="ml-auto flex items-center gap-2 flex-wrap">
                    {filas.length > 1 && (
                        <div className="inline-flex items-center gap-0.5 p-0.5 rounded-full bg-muted border border-border">
                            {[{ v: "", r: "Todas" }, ...filas.map((f) => ({ v: f.id, r: f.name }))].map((o) => (
                                <button key={o.v} onClick={() => setFiltro(o.v)} className={cn("h-7 px-3 rounded-full text-[12px] font-semibold", filtro === o.v ? "bg-[var(--accion)] text-white" : "text-muted-foreground hover:text-foreground")}>{o.r}</button>
                            ))}
                        </div>
                    )}
                    <div className="inline-flex items-center gap-0.5 p-0.5 rounded-full bg-muted border border-border">
                        {(["semana", "mes"] as const).map((v) => (
                            <button key={v} onClick={() => setVista(v)} className={cn("h-7 px-3 rounded-full text-[12px] font-semibold", vista === v ? "bg-[var(--accion)] text-white" : "text-muted-foreground hover:text-foreground")}>{v === "semana" ? "Semana" : "Mes"}</button>
                        ))}
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_340px] gap-5 items-start">
                {/* El calendario */}
                <div className="rounded-[10px] border border-border bg-card overflow-hidden">
                    {error ? (
                        <div className="p-10 text-center space-y-3"><div className="text-[13px] tono-mal">{error}</div><Button size="sm" variant="outline" onClick={cargar}>Reintentar</Button></div>
                    ) : cargando ? (
                        <div className="h-[520px] animate-pulse bg-muted/40" />
                    ) : filas.length === 0 ? (
                        <div className="p-10 text-center text-[13px] text-muted-foreground">No hay filas dadas de alta. Se agregan en Filas o en Dispositivos.</div>
                    ) : vista === "semana" ? (
                        <Semana dias={dias} grilla={grilla} filas={filasVisibles} horarios={horarios} especiales={especiales} ahora={ahora}
                            nombreFila={nombreFila}
                            alNuevo={(fecha, hhmm) => setEditHorario({ name: "", deviceId: filtro || null, daysOfWeek: String(dowDe(deTexto(fecha))), openTime: hhmm, closeTime: `${String(Math.min(23, Number(hhmm.slice(0, 2)) + 4)).padStart(2, "0")}:00`, resetOnOpen: true, enabled: true })}
                            alHorario={(h) => setEditHorario(h)} alEspecial={(e) => setEditEspecial(e)} />
                    ) : (
                        <Mes dias={dias} mes={ancla.getMonth()} filas={filasVisibles} horarios={horarios} especiales={especiales} ahora={ahora}
                            alDia={(fecha) => setEditEspecial(especiales.find((e) => e.fecha === fecha && (filtro ? e.deviceId === filtro : true)) || { fecha, deviceId: filtro || null, cerrada: true })} />
                    )}
                </div>

                {/* Lateral: los horarios de siempre y los próximos días especiales */}
                <div className="space-y-5">
                    <section className="rounded-[10px] border border-border bg-card overflow-hidden">
                        <header className="flex items-center gap-2 px-4 h-11 border-b border-border">
                            <Clock size={15} className="text-muted-foreground" /><h2 className="text-[15px] font-semibold">Horarios de siempre</h2>
                            <span className="ml-auto text-[11px] text-muted-foreground tabular-nums">{horariosVisibles.length}</span>
                        </header>
                        {horariosVisibles.length === 0 ? (
                            <div className="px-4 py-5 text-[13px] text-muted-foreground">Sin horarios: las filas atienden siempre. Agregá uno con «Nuevo horario».</div>
                        ) : (
                            <ul className="divide-y divide-border">
                                {horariosVisibles.map((h) => {
                                    const d = diasDe(h.daysOfWeek);
                                    return (
                                        <li key={h.id} className={cn("px-4 py-3 cursor-pointer hover:bg-accent/50", !h.enabled && "opacity-55")} onClick={() => setEditHorario(h)}>
                                            <div className="flex items-center gap-2">
                                                <span className="text-[13px] font-semibold truncate">{h.name || "Horario"}</span>
                                                {h.resetOnOpen && <span {...tip("Al abrir, el contador vuelve a cero.")}><RotateCcw size={12} className="text-muted-foreground" /></span>}
                                                <span className="ml-auto" onClick={(e) => e.stopPropagation()}><Switch checked={h.enabled} onCheckedChange={() => alternarHorario(h)} /></span>
                                            </div>
                                            <div className="text-[11px] text-muted-foreground">{nombreFila(h.deviceId)}</div>
                                            <div className="flex items-center gap-1 mt-1.5">
                                                {DIAS.map((x) => <span key={x.n} className={cn("h-5 w-5 grid place-items-center rounded-full text-[10px] font-bold", d.includes(x.n) ? "bg-[var(--accion)] text-white" : "bg-muted text-muted-foreground")}>{x.inicial}</span>)}
                                                <span className="ml-auto text-[12px] font-semibold tabular-nums">{h.openTime}–{h.closeTime}</span>
                                            </div>
                                        </li>
                                    );
                                })}
                            </ul>
                        )}
                    </section>

                    <section className="rounded-[10px] border border-border bg-card overflow-hidden">
                        <header className="flex items-center gap-2 px-4 h-11 border-b border-border">
                            <CalendarX2 size={15} className="text-muted-foreground" /><h2 className="text-[15px] font-semibold">Próximos días especiales</h2>
                        </header>
                        {proximosEspeciales.length === 0 ? (
                            <div className="px-4 py-5 text-[13px] text-muted-foreground">Ninguno. Un feriado o un día con otro horario se marca con «Día especial» o tocando el día en la vista Mes.</div>
                        ) : (
                            <ul className="divide-y divide-border">
                                {proximosEspeciales.map((e) => (
                                    <li key={e.id} className="px-4 py-2.5 flex items-center gap-3 cursor-pointer hover:bg-accent/50" onClick={() => setEditEspecial(e)}>
                                        <div className="w-11 text-center shrink-0">
                                            <div className="text-[18px] font-bold leading-none tabular-nums">{deTexto(e.fecha).getDate()}</div>
                                            <div className="text-[10px] text-muted-foreground uppercase">{MESES[deTexto(e.fecha).getMonth()].slice(0, 3)}</div>
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            <div className="text-[13px] font-semibold truncate">{e.nota || (e.cerrada ? "Cerrada" : "Horario especial")}</div>
                                            <div className="text-[11px] text-muted-foreground truncate">{nombreFila(e.deviceId)}</div>
                                        </div>
                                        <span className={cn("text-[11px] font-semibold px-2 py-0.5 rounded-full border tabular-nums", e.cerrada ? "chip-mal" : "chip-aviso")}>{e.cerrada ? "Cerrada" : `${e.openTime}–${e.closeTime}`}</span>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </section>

                    <div className="text-[12px] text-muted-foreground px-1 leading-relaxed">
                        Con horario, fuera de él no se avisa que la fila está llena. Si el horario tiene «Reiniciar al abrir», el contador vuelve a cero a la hora de apertura.{" "}
                        <button onClick={async () => { const r = await runQueueReset(filtro || null); toast.success({ title: `Contador en cero`, description: `${r.reset} fila(s)` }); }} className="text-[var(--accion)] font-semibold hover:underline">Poner en cero ahora</button>
                    </div>
                </div>
            </div>

            <CajonHorario valor={editHorario} filas={filas} onClose={() => setEditHorario(null)} onSaved={cargar} />
            <CajonEspecial valor={editEspecial} filas={filas} onClose={() => setEditEspecial(null)} onSaved={cargar} />
        </div>
    );
}

/* ── Vista semana: agenda con franjas ───────────────────────────────────────── */
function Semana({ dias, grilla, filas, horarios, especiales, ahora, nombreFila, alNuevo, alHorario, alEspecial }: {
    dias: Date[]; grilla: { desde: number; hasta: number }; filas: Fila[]; horarios: Horario[]; especiales: Especial[];
    ahora: { fecha: string; hhmm: string }; nombreFila: (id: string | null) => string;
    alNuevo: (fecha: string, hhmm: string) => void; alHorario: (h: Horario) => void; alEspecial: (e: Especial) => void;
}) {
    const horas = Array.from({ length: grilla.hasta - grilla.desde }, (_, i) => grilla.desde + i);
    const alto = horas.length * ALTO_HORA_PX;
    const topDe = (hhmm: string) => ((minutos(hhmm) - grilla.desde * 60) / 60) * ALTO_HORA_PX;
    return (
        <div className="overflow-x-auto">
            <div className="min-w-[760px]">
                {/* Encabezado de días */}
                <div className="grid grid-cols-[56px_repeat(7,minmax(0,1fr))] border-b border-border">
                    <div />
                    {dias.map((d) => {
                        const f = aTexto(d); const hoy = f === ahora.fecha;
                        return (
                            <div key={f} className="px-2 py-2 text-center border-l border-border">
                                <div className="text-[11px] text-muted-foreground">{DIAS[dowDe(d) - 1].corto}</div>
                                <div className={cn("mx-auto mt-0.5 h-7 w-7 grid place-items-center rounded-full text-[14px] font-bold tabular-nums", hoy && "bg-[var(--accion)] text-white")}>{d.getDate()}</div>
                            </div>
                        );
                    })}
                </div>
                {/* Cuerpo */}
                <div className="grid grid-cols-[56px_repeat(7,minmax(0,1fr))] relative" style={{ height: alto }}>
                    <div className="relative">
                        {horas.map((h, i) => <div key={h} className="absolute right-2 text-[10px] text-muted-foreground tabular-nums -translate-y-1/2" style={{ top: i * ALTO_HORA_PX }}>{i === 0 ? "" : `${String(h).padStart(2, "0")}:00`}</div>)}
                    </div>
                    {dias.map((d) => {
                        const fecha = aTexto(d);
                        const columnas = filas.map((fila) => ({ fila, ...franjasDelDia(horarios, especiales, fila.id, fecha) }));
                        const n = Math.max(1, columnas.length);
                        return (
                            <div key={fecha} className="relative border-l border-border"
                                onDoubleClick={(e) => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); const h = Math.floor((e.clientY - r.top) / ALTO_HORA_PX) + grilla.desde; alNuevo(fecha, `${String(h).padStart(2, "0")}:00`); }}>
                                {horas.map((h, i) => <div key={h} className="absolute inset-x-0 border-t border-border/60" style={{ top: i * ALTO_HORA_PX }} />)}
                                {fecha === ahora.fecha && minutos(ahora.hhmm) >= grilla.desde * 60 && minutos(ahora.hhmm) <= grilla.hasta * 60 && (
                                    <div className="absolute inset-x-0 z-10 h-px bg-[var(--mal)]" style={{ top: topDe(ahora.hhmm) }}><span className="absolute -left-1 -top-1 h-2 w-2 rounded-full bg-[var(--mal)]" /></div>
                                )}
                                {columnas.map((c, k) => {
                                    const izq = `calc(${(k / n) * 100}% + 2px)`; const ancho = `calc(${100 / n}% - 4px)`;
                                    if (c.cerrada) return (
                                        <button key={c.fila.id} onClick={() => c.especial && alEspecial(c.especial)} {...tip(`${c.fila.name}: ${c.especial?.nota || "cerrada"} (día especial)`)}
                                            className="absolute top-1 bottom-1 rounded-[6px] border border-dashed chip-mal text-[10.5px] font-semibold px-1.5 pt-1 text-left overflow-hidden" style={{ left: izq, width: ancho }}>
                                            Cerrada{n > 1 ? ` · ${c.fila.name}` : ""}
                                        </button>
                                    );
                                    return c.franjas.map((fr, j) => {
                                        const top = Math.max(0, topDe(fr.abre));
                                        const fin = minutos(fr.cierra) <= minutos(fr.abre) ? grilla.hasta * 60 : minutos(fr.cierra);
                                        const altoB = Math.max(18, ((fin - minutos(fr.abre)) / 60) * ALTO_HORA_PX);
                                        return (
                                            <button key={`${c.fila.id}-${j}`} onClick={() => (c.especial ? alEspecial(c.especial) : fr.horario && alHorario(fr.horario))}
                                                {...tip(`${c.fila.name} · ${fr.abre}–${fr.cierra}${c.especial ? ` · día especial${c.especial.nota ? `: ${c.especial.nota}` : ""}` : fr.horario ? ` · ${fr.horario.name || "horario"} (${nombreFila(fr.horario.deviceId)})` : ""}`)}
                                                className={cn("absolute rounded-[6px] border px-1.5 py-1 text-left overflow-hidden transition-colors", c.especial ? "chip-aviso" : "chip-info hover:brightness-95")}
                                                style={{ top, height: altoB, left: izq, width: ancho }}>
                                                <div className="text-[11px] font-bold tabular-nums leading-tight">{fr.abre}–{fr.cierra}</div>
                                                <div className="text-[10.5px] leading-tight truncate opacity-90">{c.fila.name}</div>
                                                {fr.horario?.resetOnOpen && altoB > 52 && <RotateCcw size={11} className="mt-0.5 opacity-70" />}
                                            </button>
                                        );
                                    });
                                })}
                            </div>
                        );
                    })}
                </div>
                <div className="px-3 py-2 border-t border-border text-[11px] text-muted-foreground flex items-center gap-4 flex-wrap">
                    <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm chip-info border" /> Horario de siempre</span>
                    <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm chip-aviso border" /> Día especial</span>
                    <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm chip-mal border border-dashed" /> Cerrada</span>
                    <span className="ml-auto">Doble clic en un hueco para crear un horario a esa hora.</span>
                </div>
            </div>
        </div>
    );
}

/* ── Vista mes: qué pasa cada día ───────────────────────────────────────────── */
function Mes({ dias, mes, filas, horarios, especiales, ahora, alDia }: {
    dias: Date[]; mes: number; filas: Fila[]; horarios: Horario[]; especiales: Especial[]; ahora: { fecha: string }; alDia: (fecha: string) => void;
}) {
    return (
        <div>
            <div className="grid grid-cols-7 border-b border-border">
                {DIAS.map((d) => <div key={d.n} className="px-2 py-2 text-[11px] text-muted-foreground text-center">{d.corto}</div>)}
            </div>
            <div className="grid grid-cols-7">
                {dias.map((d, i) => {
                    const fecha = aTexto(d); const fuera = d.getMonth() !== mes; const hoy = fecha === ahora.fecha;
                    const items = filas.map((f) => ({ f, ...franjasDelDia(horarios, especiales, f.id, fecha) }));
                    return (
                        <button key={fecha} onClick={() => alDia(fecha)}
                            className={cn("min-h-[104px] p-1.5 text-left border-border hover:bg-accent/40 transition-colors flex flex-col gap-1", i % 7 !== 0 && "border-l", i >= 7 && "border-t", fuera && "bg-muted/30")}>
                            <span className={cn("h-6 w-6 grid place-items-center rounded-full text-[12px] font-bold tabular-nums", hoy ? "bg-[var(--accion)] text-white" : fuera ? "text-muted-foreground/60" : "")}>{d.getDate()}</span>
                            {items.map(({ f, cerrada, especial, franjas }) => (
                                cerrada ? <span key={f.id} className="text-[10.5px] font-semibold px-1.5 py-0.5 rounded-[6px] border chip-mal truncate">{filas.length > 1 ? `${f.name}: ` : ""}{especial?.nota || "Cerrada"}</span>
                                    : franjas.length ? <span key={f.id} className={cn("text-[10.5px] font-semibold px-1.5 py-0.5 rounded-[6px] border truncate tabular-nums", especial ? "chip-aviso" : "chip-info")}>
                                        {filas.length > 1 ? `${f.name}: ` : ""}{franjas.map((x) => `${x.abre}–${x.cierra}`).join(", ")}</span>
                                        : null
                            ))}
                        </button>
                    );
                })}
            </div>
        </div>
    );
}

/* ── Editor del horario de siempre ──────────────────────────────────────────── */
function CajonHorario({ valor, filas, onClose, onSaved }: { valor: Partial<Horario> | null; filas: Fila[]; onClose: () => void; onSaved: () => void }) {
    const [f, setF] = useState<Partial<Horario>>({});
    const [guardando, setGuardando] = useState(false);
    useEffect(() => { if (valor) setF(valor); }, [valor]);
    const dias = diasDe(f.daysOfWeek || "");
    const alternarDia = (n: number) => setF((p) => ({ ...p, daysOfWeek: (dias.includes(n) ? dias.filter((x) => x !== n) : [...dias, n]).sort().join(",") }));
    const bloqueo = !dias.length ? "Elegí al menos un día" : !f.openTime || !f.closeTime ? "Falta el horario" : f.openTime === f.closeTime ? "Abre y cierra a la misma hora" : null;

    async function guardar() {
        if (bloqueo) return;
        setGuardando(true);
        try {
            const nombre = f.name?.trim() || `${filas.find((x) => x.id === f.deviceId)?.name || "Todas"} · ${f.openTime}–${f.closeTime}`;
            const datos = { name: nombre, deviceId: f.deviceId || null, daysOfWeek: f.daysOfWeek!, openTime: f.openTime!, closeTime: f.closeTime!, resetOnOpen: !!f.resetOnOpen, enabled: f.enabled !== false };
            if (f.id) await updateQueueSchedule(f.id, datos); else await createQueueSchedule(datos);
            toast.success({ title: "Horario guardado", description: nombre });
            onSaved(); onClose();
        } catch (e: any) { toast.error({ title: "No se pudo guardar", description: e?.message }); }
        finally { setGuardando(false); }
    }
    async function borrar() {
        if (!f.id) return;
        try { await deleteQueueSchedule(f.id); toast.success({ title: "Horario borrado" }); onSaved(); onClose(); }
        catch (e: any) { toast.error({ title: "No se pudo borrar", description: e?.message }); }
    }

    return (
        <Cajon open={!!valor} onOpenChange={(v) => !v && onClose()}>
            <CajonContenido ancho="medio" titulo={f.id ? "Horario" : "Nuevo horario"} descripcion="Qué días y en qué horario atiende la fila, todas las semanas."
                pie={
                    <div className="flex items-center gap-2 w-full">
                        {f.id && <Button variant="ghost" onClick={borrar} className="gap-1.5 tono-mal"><Trash2 size={14} /> Borrar</Button>}
                        <span className="flex-1 text-[12px] text-muted-foreground truncate">{bloqueo || ""}</span>
                        <Button variant="outline" onClick={onClose}>Cancelar</Button>
                        <Button onClick={guardar} disabled={guardando || !!bloqueo} className="gap-1.5">{guardando ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Guardar</Button>
                    </div>
                }>
                <Bloque titulo="A qué fila" icono={Users} ayuda="Un horario puede ser de una fila o de todas. Si una fila tiene el suyo y también hay uno general, valen los dos.">
                    <label className="block">
                        <Etiqueta texto="Fila" />
                        <Select value={f.deviceId || TODAS} onValueChange={(v) => setF((p) => ({ ...p, deviceId: v === TODAS ? null : v }))}>
                            <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                            <SelectContent><SelectItem value={TODAS}>Todas las filas</SelectItem>{filas.map((x) => <SelectItem key={x.id} value={x.id}>{x.name}</SelectItem>)}</SelectContent>
                        </Select>
                    </label>
                    <Campo etiqueta="Nombre" icono={Type} value={f.name || ""} onChange={(v) => setF((p) => ({ ...p, name: v }))} placeholder="Ej.: Atención de mañana"
                        ayuda="Opcional. Sin nombre se arma solo con la fila y el horario." />
                </Bloque>
                <Bloque titulo="Cuándo" icono={CalendarClock}>
                    <div>
                        <Etiqueta texto="Días" />
                        <div className="flex items-center gap-1.5 flex-wrap">
                            {DIAS.map((d) => (
                                <button key={d.n} type="button" onClick={() => alternarDia(d.n)}
                                    className={cn("h-9 px-3 rounded-full text-[12px] font-semibold border transition-colors", dias.includes(d.n) ? "bg-[var(--accion)] text-white border-transparent" : "border-border text-muted-foreground hover:text-foreground")}>{d.corto}</button>
                            ))}
                            <span className="mx-1 h-5 w-px bg-border" />
                            <button type="button" onClick={() => setF((p) => ({ ...p, daysOfWeek: "1,2,3,4,5" }))} className="h-9 px-3 rounded-full text-[12px] font-semibold border border-border text-muted-foreground hover:text-foreground">Lun a Vie</button>
                            <button type="button" onClick={() => setF((p) => ({ ...p, daysOfWeek: "1,2,3,4,5,6,7" }))} className="h-9 px-3 rounded-full text-[12px] font-semibold border border-border text-muted-foreground hover:text-foreground">Todos</button>
                        </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <Campo etiqueta="Abre" icono={Clock} tipo="time" value={f.openTime || ""} onChange={(v) => setF((p) => ({ ...p, openTime: v }))} />
                        <Campo etiqueta="Cierra" icono={Clock} tipo="time" value={f.closeTime || ""} onChange={(v) => setF((p) => ({ ...p, closeTime: v }))}
                            ayuda="Si cierra más temprano que la hora en que abre, el turno pasa la medianoche (ej.: 22:00 a 02:00)." />
                    </div>
                    {f.openTime && f.closeTime && f.closeTime <= f.openTime && <div className="text-[12px] tono-aviso">Pasa la medianoche: cierra al día siguiente.</div>}
                </Bloque>
                <Bloque titulo="Al abrir" icono={RotateCcw}>
                    <label className="flex items-center gap-3 rounded-lg border border-border px-3 h-11 cursor-pointer">
                        <span className="flex-1 text-[13px]">Poner el contador en cero a la hora de apertura</span>
                        <Switch checked={!!f.resetOnOpen} onCheckedChange={(v) => setF((p) => ({ ...p, resetOnOpen: v }))} />
                    </label>
                    <label className="flex items-center gap-3 rounded-lg border border-border px-3 h-11 cursor-pointer">
                        <span className="flex-1 text-[13px]">Horario activo</span>
                        <Switch checked={f.enabled !== false} onCheckedChange={(v) => setF((p) => ({ ...p, enabled: v }))} />
                    </label>
                </Bloque>
            </CajonContenido>
        </Cajon>
    );
}

/* ── Editor de un día especial ──────────────────────────────────────────────── */
function CajonEspecial({ valor, filas, onClose, onSaved }: { valor: Partial<Especial> | null; filas: Fila[]; onClose: () => void; onSaved: () => void }) {
    const [f, setF] = useState<Partial<Especial>>({});
    const [guardando, setGuardando] = useState(false);
    useEffect(() => { if (valor) setF({ openTime: "09:00", closeTime: "13:00", ...valor }); }, [valor]);
    const bloqueo = !f.fecha ? "Falta la fecha" : !f.cerrada && (!f.openTime || !f.closeTime) ? "Falta el horario de ese día" : null;
    const fechaLarga = f.fecha ? (() => { const d = deTexto(f.fecha!); return `${DIAS[dowDe(d) - 1].largo} ${d.getDate()} de ${MESES[d.getMonth()]} de ${d.getFullYear()}`; })() : "";

    async function guardar() {
        if (bloqueo) return;
        setGuardando(true);
        try {
            await guardarDiaEspecial({ id: f.id, fecha: f.fecha!, deviceId: f.deviceId || null, cerrada: !!f.cerrada, openTime: f.openTime, closeTime: f.closeTime, nota: f.nota });
            toast.success({ title: "Día especial guardado", description: fechaLarga });
            onSaved(); onClose();
        } catch (e: any) { toast.error({ title: "No se pudo guardar", description: e?.message }); }
        finally { setGuardando(false); }
    }
    async function borrar() {
        if (!f.id) return;
        try { await borrarDiaEspecial(f.id); toast.success({ title: "Día especial borrado", description: "Ese día vuelve a su horario de siempre." }); onSaved(); onClose(); }
        catch (e: any) { toast.error({ title: "No se pudo borrar", description: e?.message }); }
    }

    return (
        <Cajon open={!!valor} onOpenChange={(v) => !v && onClose()}>
            <CajonContenido ancho="medio" titulo={f.id ? "Día especial" : "Nuevo día especial"} descripcion={fechaLarga || "Un día que no sigue el horario de siempre: feriado u otro horario."}
                pie={
                    <div className="flex items-center gap-2 w-full">
                        {f.id && <Button variant="ghost" onClick={borrar} className="gap-1.5 tono-mal"><Trash2 size={14} /> Quitar</Button>}
                        <span className="flex-1 text-[12px] text-muted-foreground truncate">{bloqueo || ""}</span>
                        <Button variant="outline" onClick={onClose}>Cancelar</Button>
                        <Button onClick={guardar} disabled={guardando || !!bloqueo} className="gap-1.5">{guardando ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Guardar</Button>
                    </div>
                }>
                <Bloque titulo="Qué día" icono={CalendarDays}>
                    <div className="grid grid-cols-2 gap-4">
                        <Campo etiqueta="Fecha" icono={CalendarDays} tipo="date" value={f.fecha || ""} onChange={(v) => setF((p) => ({ ...p, fecha: v }))} />
                        <label className="block">
                            <Etiqueta texto="Fila" ayuda="De una fila manda sobre el general ese día." />
                            <Select value={f.deviceId || TODAS} onValueChange={(v) => setF((p) => ({ ...p, deviceId: v === TODAS ? null : v }))}>
                                <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                                <SelectContent><SelectItem value={TODAS}>Todas las filas</SelectItem>{filas.map((x) => <SelectItem key={x.id} value={x.id}>{x.name}</SelectItem>)}</SelectContent>
                            </Select>
                        </label>
                    </div>
                    <Campo etiqueta="Motivo" icono={StickyNote} value={f.nota || ""} onChange={(v) => setF((p) => ({ ...p, nota: v }))} placeholder="Ej.: Feriado, inventario, horario de verano"
                        ayuda="Opcional. Es lo que se ve en el calendario." />
                </Bloque>
                <Bloque titulo="Ese día" icono={Clock}>
                    <div className="grid grid-cols-2 gap-2">
                        {[{ v: true, t: "Cerrada", d: "No atiende: no avisa ni se reinicia" }, { v: false, t: "Otro horario", d: "Atiende en un horario distinto" }].map((o) => (
                            <button key={String(o.v)} type="button" onClick={() => setF((p) => ({ ...p, cerrada: o.v }))}
                                className={cn("rounded-xl border p-3 text-left transition-all", !!f.cerrada === o.v ? "border-[var(--accion)] ring-2 ring-[color-mix(in_oklab,var(--accion)_25%,transparent)]" : "border-border hover:bg-accent/60")}>
                                <div className="text-[13px] font-bold">{o.t}</div><div className="text-[11.5px] text-muted-foreground">{o.d}</div>
                            </button>
                        ))}
                    </div>
                    {!f.cerrada && (
                        <div className="grid grid-cols-2 gap-4">
                            <Campo etiqueta="Abre" icono={Clock} tipo="time" value={f.openTime || ""} onChange={(v) => setF((p) => ({ ...p, openTime: v }))} />
                            <Campo etiqueta="Cierra" icono={Clock} tipo="time" value={f.closeTime || ""} onChange={(v) => setF((p) => ({ ...p, closeTime: v }))} />
                        </div>
                    )}
                </Bloque>
            </CajonContenido>
        </Cajon>
    );
}
