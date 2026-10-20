"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
/**
 * Arrastrar en la semana (Nico, HB 19/10: «permite drag and drop en el calendario»).
 * Los horarios se mueven y se estiran de a 15 minutos: con minutos libres el arrastre deja
 * horarios como 09:07, que nadie quiso poner y que después cuesta leer en la grilla.
 */
const PASO_MIN = 15;
/** Debajo de esto, soltar es un clic (abre el editor) y no un arrastre. Un pulso de mano en el mouse mueve 1–3 px. */
const UMBRAL_ARRASTRE_PX = 4;
/** Alto del borde de abajo de una franja que la estira en vez de moverla. */
const BORDE_ESTIRAR_PX = 7;
const DIA_MIN = 24 * 60;

/* ── Fechas como texto AAAA-MM-DD: el calendario es de días, no de instantes ── */
const aTexto = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const deTexto = (s: string) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const sumarDias = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const lunesDe = (d: Date) => sumarDias(d, -((d.getDay() + 6) % 7));
const dowDe = (d: Date) => (d.getDay() === 0 ? 7 : d.getDay());
const minutos = (hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };
/** Minutos del día → HH:MM. El fin del día se guarda 23:59: «00:00» como cierre se lee como turno que pasa la medianoche. */
const aHora = (m: number) => (m >= DIA_MIN ? "23:59" : `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`);
const ajustar = (m: number) => Math.round(m / PASO_MIN) * PASO_MIN;

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

    /**
     * Soltar una franja arrastrada. Un horario es «de siempre» y puede abarcar varios días; por eso:
     *  - mismo día, otra hora: cambia el horario entero (todos sus días). Arrastrar el lunes de un
     *    «Lun a Vie 8–18» a las 9 es, casi siempre, «ahora abrimos a las 9»; partirlo dejaría cinco
     *    horarios sueltos para algo que se pensó como uno solo;
     *  - otro día: cambia SÓLO ese día. Si el horario tenía varios, se le saca el día de origen y se
     *    crea uno nuevo para el destino. Llevar el lunes al sábado no quiere decir que el martes
     *    también se mude.
     */
    async function soltarHorario(h: Horario, origen: number, destino: number, abre: number, cierra: number) {
        const nuevo = { openTime: aHora(abre), closeTime: aHora(cierra) };
        const dias = diasDe(h.daysOfWeek);
        const mismaHora = nuevo.openTime === h.openTime && nuevo.closeTime === h.closeTime;
        try {
            if (origen === destino) {
                if (mismaHora) return;
                await updateQueueSchedule(h.id, nuevo);
                toast.success({ title: `${nuevo.openTime}–${nuevo.closeTime}`, description: dias.length > 1 ? `Cambia en todos sus días (${dias.map((n) => DIAS[n - 1].corto).join(", ")}).` : h.name });
            } else if (dias.length === 1) {
                await updateQueueSchedule(h.id, { ...nuevo, daysOfWeek: String(destino) });
                toast.success({ title: `Pasa al ${DIAS[destino - 1].largo.toLowerCase()}`, description: `${nuevo.openTime}–${nuevo.closeTime}` });
            } else {
                const resto = dias.filter((n) => n !== origen).join(",");
                await updateQueueSchedule(h.id, { daysOfWeek: resto });
                // Si el destino ya estaba en el horario con la misma hora, alcanza con sacar el origen.
                if (!(dias.includes(destino) && mismaHora)) {
                    await createQueueSchedule({
                        name: `${h.name || "Horario"} (${DIAS[destino - 1].corto})`, deviceId: h.deviceId, daysOfWeek: String(destino),
                        ...nuevo, resetOnOpen: h.resetOnOpen, enabled: h.enabled,
                    });
                }
                toast.success({ title: `Sólo el ${DIAS[origen - 1].largo.toLowerCase()} pasa al ${DIAS[destino - 1].largo.toLowerCase()}`, description: "Los demás días del horario quedan como estaban." });
            }
        } catch (e: any) { toast.error({ title: "No se pudo mover", description: e?.message }); }
        await cargar();
    }

    /** Llevar un día especial a otra fecha (vista Mes). Dos para la misma fila el mismo día se pisarían: no se deja. */
    async function moverEspecial(e: Especial, fecha: string) {
        if (fecha === e.fecha) return;
        if (especiales.some((x) => x.id !== e.id && x.fecha === fecha && (x.deviceId || null) === (e.deviceId || null))) {
            toast.error({ title: "Ese día ya tiene uno", description: "Abrilo y editalo, o quitalo primero." });
            return;
        }
        try {
            await guardarDiaEspecial({ ...e, fecha });
            const d = deTexto(fecha);
            toast.success({ title: "Día especial movido", description: `${DIAS[dowDe(d) - 1].largo} ${d.getDate()} de ${MESES[d.getMonth()]}` });
        } catch (err: any) { toast.error({ title: "No se pudo mover", description: err?.message }); }
        await cargar();
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
                            alRango={(fecha, abre, cierra, deviceId) => setEditHorario({ name: "", deviceId: deviceId ?? (filtro || null), daysOfWeek: String(dowDe(deTexto(fecha))), openTime: aHora(abre), closeTime: aHora(cierra), resetOnOpen: true, enabled: true })}
                            alSoltar={soltarHorario}
                            alHorario={(h) => setEditHorario(h)} alEspecial={(e) => setEditEspecial(e)} />
                    ) : (
                        <Mes dias={dias} mes={ancla.getMonth()} filas={filasVisibles} horarios={horarios} especiales={especiales} ahora={ahora}
                            alMoverEspecial={moverEspecial}
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
/**
 * Lo que se está arrastrando. Va en un ref además del estado: los manejadores del puntero viven
 * en `window` mientras dura el gesto y tienen que leer el valor de ESTE instante, no el del render
 * en que se colgaron.
 *  - mover: la franja entera, a otra hora y/o a otro día (columna).
 *  - estirar: sólo el cierre, desde el borde de abajo.
 *  - crear: se pinta un rango en un hueco y al soltar se abre el editor con ese horario.
 */
type Arrastre =
    | { tipo: "mover" | "estirar"; horario: Horario; k: number; n: number; origen: number; diaIdx: number; abre: number; cierra: number; x0: number; y0: number; movido: boolean }
    | { tipo: "crear"; k: number; n: number; filaId: string | null; diaIdx: number; desde: number; hasta: number; x0: number; y0: number; movido: boolean };

function Semana({ dias, grilla, filas, horarios, especiales, ahora, nombreFila, alNuevo, alRango, alSoltar, alHorario, alEspecial }: {
    dias: Date[]; grilla: { desde: number; hasta: number }; filas: Fila[]; horarios: Horario[]; especiales: Especial[];
    ahora: { fecha: string; hhmm: string }; nombreFila: (id: string | null) => string;
    alNuevo: (fecha: string, hhmm: string) => void;
    alRango: (fecha: string, abre: number, cierra: number, deviceId: string | null) => void;
    alSoltar: (h: Horario, origen: number, destino: number, abre: number, cierra: number) => Promise<void>;
    alHorario: (h: Horario) => void; alEspecial: (e: Especial) => void;
}) {
    const horas = Array.from({ length: grilla.hasta - grilla.desde }, (_, i) => grilla.desde + i);
    const alto = horas.length * ALTO_HORA_PX;
    const topDe = (hhmm: string) => ((minutos(hhmm) - grilla.desde * 60) / 60) * ALTO_HORA_PX;
    const topMin = (m: number) => ((m - grilla.desde * 60) / 60) * ALTO_HORA_PX;

    const cuerpo = useRef<HTMLDivElement>(null);
    const [arr, setArr] = useState<Arrastre | null>(null);
    const arrRef = useRef<Arrastre | null>(null);
    /** Mientras se guarda, la franja fantasma queda donde se soltó: si volviera a su lugar hasta que llegue la recarga, parecería que no se movió. */
    const [guardando, setGuardando] = useState(false);
    const poner = (a: Arrastre | null) => { arrRef.current = a; setArr(a); };

    /** Geometría del cuerpo: minuto del día bajo el puntero y día (0–6) bajo el puntero. */
    const geo = () => {
        const r = cuerpo.current!.getBoundingClientRect();
        const anchoDia = (r.width - 56) / 7;
        return {
            minuto: (y: number) => grilla.desde * 60 + ((y - r.top) / ALTO_HORA_PX) * 60,
            dia: (x: number) => Math.max(0, Math.min(6, Math.floor((x - r.left - 56) / anchoDia))),
        };
    };

    useEffect(() => {
        if (!arr || guardando) return;
        const mover = (e: PointerEvent) => {
            const a = arrRef.current; if (!a) return;
            const g = geo();
            const movido = a.movido || Math.abs(e.clientX - a.x0) > UMBRAL_ARRASTRE_PX || Math.abs(e.clientY - a.y0) > UMBRAL_ARRASTRE_PX;
            if (a.tipo === "crear") {
                const m = Math.max(0, Math.min(DIA_MIN, ajustar(g.minuto(e.clientY))));
                poner({ ...a, hasta: m, movido });
            } else if (a.tipo === "estirar") {
                const h = a.horario; const delta = ajustar(g.minuto(e.clientY) - g.minuto(a.y0));
                const cierra = Math.max(minutos(h.openTime) + PASO_MIN, Math.min(DIA_MIN, minutos(h.closeTime) + delta));
                poner({ ...a, cierra, movido });
            } else {
                const h = a.horario; const dur = minutos(h.closeTime) - minutos(h.openTime);
                const delta = ajustar(g.minuto(e.clientY) - g.minuto(a.y0));
                const abre = Math.max(0, Math.min(DIA_MIN - dur, minutos(h.openTime) + delta));
                poner({ ...a, abre, cierra: abre + dur, diaIdx: g.dia(e.clientX), movido });
            }
        };
        const soltar = async () => {
            const a = arrRef.current; if (!a) return;
            if (!a.movido) {
                poner(null);
                if (a.tipo !== "crear") alHorario(a.horario);
                return;
            }
            if (a.tipo === "crear") {
                poner(null);
                const desde = Math.min(a.desde, a.hasta), hasta = Math.max(a.desde, a.hasta);
                if (hasta - desde >= PASO_MIN) alRango(aTexto(dias[a.diaIdx]), desde, hasta, a.filaId);
                return;
            }
            setGuardando(true);
            try { await alSoltar(a.horario, a.origen, dowDe(dias[a.diaIdx]), a.abre, a.cierra); }
            finally { setGuardando(false); poner(null); }
        };
        const escape = (e: KeyboardEvent) => { if (e.key === "Escape") poner(null); };
        window.addEventListener("pointermove", mover);
        window.addEventListener("pointerup", soltar);
        window.addEventListener("keydown", escape);
        return () => { window.removeEventListener("pointermove", mover); window.removeEventListener("pointerup", soltar); window.removeEventListener("keydown", escape); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [!!arr, guardando]);

    /** Empezar a arrastrar una franja: desde el borde de abajo la estira, desde el resto la mueve. */
    function tomarFranja(e: React.PointerEvent<HTMLElement>, h: Horario, k: number, n: number, diaIdx: number) {
        if (e.button !== 0) return;
        e.stopPropagation(); e.preventDefault();
        const r = e.currentTarget.getBoundingClientRect();
        const tipo = r.bottom - e.clientY <= BORDE_ESTIRAR_PX ? "estirar" : "mover";
        poner({ tipo, horario: h, k, n, origen: dowDe(dias[diaIdx]), diaIdx, abre: minutos(h.openTime), cierra: minutos(h.closeTime), x0: e.clientX, y0: e.clientY, movido: false });
    }
    /** Pintar un rango en un hueco de un día. Con varias filas a la vista, el horario nuevo es de la columna donde se pintó. */
    function pintarRango(e: React.PointerEvent<HTMLElement>, diaIdx: number) {
        if (e.button !== 0 || (e.target !== e.currentTarget && !(e.target as HTMLElement).dataset.hueco)) return;
        e.preventDefault();
        const r = e.currentTarget.getBoundingClientRect();
        const n = Math.max(1, filas.length);
        const k = Math.max(0, Math.min(n - 1, Math.floor(((e.clientX - r.left) / r.width) * n)));
        const m = Math.max(0, Math.min(DIA_MIN - PASO_MIN, Math.floor(geo().minuto(e.clientY) / PASO_MIN) * PASO_MIN));
        poner({ tipo: "crear", k, n, filaId: filas.length > 1 ? filas[k].id : null, diaIdx, desde: m, hasta: m + PASO_MIN, x0: e.clientX, y0: e.clientY, movido: false });
    }

    /** La franja fantasma: dónde va a quedar y con qué horario, mientras dura el arrastre. */
    const fantasma = arr && arr.movido ? (() => {
        const desde = arr.tipo === "crear" ? Math.min(arr.desde, arr.hasta) : arr.tipo === "estirar" ? minutos(arr.horario.openTime) : arr.abre;
        const hasta = arr.tipo === "crear" ? Math.max(arr.desde, arr.hasta) : arr.cierra;
        const anchoDia = `((100% - 56px) / 7)`;
        return {
            diaIdx: arr.diaIdx,
            texto: `${aHora(desde)}–${aHora(hasta)}`,
            sub: arr.tipo === "crear" ? "Nuevo horario" : arr.tipo === "mover" && dowDe(dias[arr.diaIdx]) !== arr.origen ? `Sólo ${DIAS[dowDe(dias[arr.diaIdx]) - 1].largo.toLowerCase()}` : arr.horario.name,
            style: {
                top: topMin(desde), height: Math.max(18, topMin(hasta) - topMin(desde)),
                left: `calc(56px + ${anchoDia} * ${arr.diaIdx} + ${anchoDia} * ${arr.k / arr.n} + 2px)`,
                width: `calc(${anchoDia} / ${arr.n} - 4px)`,
            },
        };
    })() : null;

    return (
        <div className="overflow-x-auto">
            <div className={cn("min-w-[760px]", arr?.movido && "select-none", arr?.movido && (arr.tipo === "estirar" ? "cursor-ns-resize" : arr.tipo === "mover" ? "cursor-grabbing" : "cursor-crosshair"))}>
                {/* Encabezado de días */}
                <div className="grid grid-cols-[56px_repeat(7,minmax(0,1fr))] border-b border-border">
                    <div />
                    {dias.map((d, i) => {
                        const f = aTexto(d); const hoy = f === ahora.fecha;
                        return (
                            <div key={f} className={cn("px-2 py-2 text-center border-l border-border transition-colors", fantasma && fantasma.diaIdx === i && "bg-accent/60")}>
                                <div className="text-[11px] text-muted-foreground">{DIAS[dowDe(d) - 1].corto}</div>
                                <div className={cn("mx-auto mt-0.5 h-7 w-7 grid place-items-center rounded-full text-[14px] font-bold tabular-nums", hoy && "bg-[var(--accion)] text-white")}>{d.getDate()}</div>
                            </div>
                        );
                    })}
                </div>
                {/* Cuerpo */}
                <div ref={cuerpo} className="grid grid-cols-[56px_repeat(7,minmax(0,1fr))] relative" style={{ height: alto }}>
                    <div className="relative">
                        {horas.map((h, i) => <div key={h} className="absolute right-2 text-[10px] text-muted-foreground tabular-nums -translate-y-1/2" style={{ top: i * ALTO_HORA_PX }}>{i === 0 ? "" : `${String(h).padStart(2, "0")}:00`}</div>)}
                    </div>
                    {dias.map((d, diaIdx) => {
                        const fecha = aTexto(d);
                        const columnas = filas.map((fila) => ({ fila, ...franjasDelDia(horarios, especiales, fila.id, fecha) }));
                        const n = Math.max(1, columnas.length);
                        return (
                            <div key={fecha} className="relative border-l border-border cursor-crosshair"
                                onPointerDown={(e) => pintarRango(e, diaIdx)}
                                onDoubleClick={(e) => { if (e.target !== e.currentTarget && !(e.target as HTMLElement).dataset.hueco) return; const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); const h = Math.floor((e.clientY - r.top) / ALTO_HORA_PX) + grilla.desde; alNuevo(fecha, `${String(h).padStart(2, "0")}:00`); }}>
                                {horas.map((h, i) => <div key={h} data-hueco="1" className="absolute inset-x-0 border-t border-border/60" style={{ top: i * ALTO_HORA_PX }} />)}
                                {fecha === ahora.fecha && minutos(ahora.hhmm) >= grilla.desde * 60 && minutos(ahora.hhmm) <= grilla.hasta * 60 && (
                                    <div className="absolute inset-x-0 z-10 h-px bg-[var(--mal)] pointer-events-none" style={{ top: topDe(ahora.hhmm) }}><span className="absolute -left-1 -top-1 h-2 w-2 rounded-full bg-[var(--mal)]" /></div>
                                )}
                                {columnas.map((c, k) => {
                                    const izq = `calc(${(k / n) * 100}% + 2px)`; const ancho = `calc(${100 / n}% - 4px)`;
                                    if (c.cerrada) return (
                                        <button key={c.fila.id} onPointerDown={(e) => e.stopPropagation()} onClick={() => c.especial && alEspecial(c.especial)} {...tip(`${c.fila.name}: ${c.especial?.nota || "cerrada"} (día especial)`)}
                                            className="absolute top-1 bottom-1 rounded-[6px] border border-dashed chip-mal text-[10.5px] font-semibold px-1.5 pt-1 text-left overflow-hidden cursor-pointer" style={{ left: izq, width: ancho }}>
                                            Cerrada{n > 1 ? ` · ${c.fila.name}` : ""}
                                        </button>
                                    );
                                    return c.franjas.map((fr, j) => {
                                        const top = Math.max(0, topDe(fr.abre));
                                        const pasaMedianoche = minutos(fr.cierra) <= minutos(fr.abre);
                                        const fin = pasaMedianoche ? grilla.hasta * 60 : minutos(fr.cierra);
                                        const altoB = Math.max(18, ((fin - minutos(fr.abre)) / 60) * ALTO_HORA_PX);
                                        // Se arrastran sólo los horarios de siempre que no pasan la medianoche: un día
                                        // especial se edita en su cajón (o se mueve en la vista Mes), y un turno nocturno
                                        // dibujado hasta el borde de la grilla no tiene un «abajo» real que estirar.
                                        const arrastrable = !c.especial && !!fr.horario && !pasaMedianoche;
                                        const esteSeMueve = !!arr?.movido && arr.tipo !== "crear" && arr.horario.id === fr.horario?.id && arr.k === k;
                                        return (
                                            <button key={`${c.fila.id}-${j}`}
                                                onPointerDown={(e) => { if (arrastrable) tomarFranja(e, fr.horario!, k, n, diaIdx); else e.stopPropagation(); }}
                                                onClick={() => { if (!arrastrable) (c.especial ? alEspecial(c.especial) : fr.horario && alHorario(fr.horario)); }}
                                                {...tip(`${c.fila.name} · ${fr.abre}–${fr.cierra}${c.especial ? ` · día especial${c.especial.nota ? `: ${c.especial.nota}` : ""}` : fr.horario ? ` · ${fr.horario.name || "horario"} (${nombreFila(fr.horario.deviceId)})` : ""}${arrastrable ? " · arrastrá para mover, el borde de abajo para estirar" : ""}`)}
                                                className={cn("group absolute rounded-[6px] border px-1.5 py-1 text-left overflow-hidden transition-[opacity,filter]", c.especial ? "chip-aviso cursor-pointer" : "chip-info hover:brightness-95",
                                                    arrastrable && "cursor-grab touch-none", esteSeMueve && "opacity-35")}
                                                style={{ top, height: altoB, left: izq, width: ancho }}>
                                                <div className="text-[11px] font-bold tabular-nums leading-tight">{fr.abre}–{fr.cierra}</div>
                                                <div className="text-[10.5px] leading-tight truncate opacity-90">{c.fila.name}</div>
                                                {fr.horario?.resetOnOpen && altoB > 52 && <RotateCcw size={11} className="mt-0.5 opacity-70" />}
                                                {arrastrable && (
                                                    <span aria-hidden className="absolute inset-x-0 bottom-0 cursor-ns-resize flex justify-center items-end pb-0.5" style={{ height: BORDE_ESTIRAR_PX }}>
                                                        <span className="h-[3px] w-6 rounded-full bg-current opacity-0 group-hover:opacity-40 transition-opacity" />
                                                    </span>
                                                )}
                                            </button>
                                        );
                                    });
                                })}
                            </div>
                        );
                    })}
                    {fantasma && (
                        <div className="absolute z-20 rounded-[6px] border-2 border-dashed border-[var(--accion)] bg-[color-mix(in_oklab,var(--accion)_14%,transparent)] px-1.5 py-1 pointer-events-none overflow-hidden" style={fantasma.style}>
                            <div className="text-[11.5px] font-bold tabular-nums leading-tight text-[var(--accion)]">{fantasma.texto}</div>
                            {fantasma.sub && <div className="text-[10.5px] leading-tight truncate text-foreground/80">{fantasma.sub}</div>}
                            {guardando && <Loader2 size={12} className="mt-0.5 animate-spin text-[var(--accion)]" />}
                        </div>
                    )}
                </div>
                <div className="px-3 py-2 border-t border-border text-[11px] text-muted-foreground flex items-center gap-4 flex-wrap">
                    <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm chip-info border" /> Horario de siempre</span>
                    <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm chip-aviso border" /> Día especial</span>
                    <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm chip-mal border border-dashed" /> Cerrada</span>
                    <span className="ml-auto">Arrastrá en un hueco para crear · arrastrá una franja para moverla · su borde de abajo la estira · Esc cancela.</span>
                </div>
            </div>
        </div>
    );
}

/* ── Vista mes: qué pasa cada día ───────────────────────────────────────────── */
function Mes({ dias, mes, filas, horarios, especiales, ahora, alDia, alMoverEspecial }: {
    dias: Date[]; mes: number; filas: Fila[]; horarios: Horario[]; especiales: Especial[]; ahora: { fecha: string }; alDia: (fecha: string) => void;
    alMoverEspecial: (e: Especial, fecha: string) => Promise<void>;
}) {
    /**
     * Un día especial se lleva a otra fecha arrastrando su etiqueta (un feriado que se corrió, un
     * inventario que se pasó al viernes). El destino se busca con elementFromPoint sobre las celdas
     * marcadas con data-fecha: el puntero pasa por encima de botones que no son el que se tomó.
     */
    const [toma, setToma] = useState<{ esp: Especial; destino: string | null; x0: number; y0: number; movido: boolean } | null>(null);
    const tomaRef = useRef(toma);
    const poner = (t: typeof toma) => { tomaRef.current = t; setToma(t); };
    /** El clic que sigue a soltar cae en la celda: no tiene que abrir el editor de ese día. */
    const recienSoltado = useRef(false);

    useEffect(() => {
        if (!toma) return;
        const mover = (e: PointerEvent) => {
            const t = tomaRef.current; if (!t) return;
            const movido = t.movido || Math.abs(e.clientX - t.x0) > UMBRAL_ARRASTRE_PX || Math.abs(e.clientY - t.y0) > UMBRAL_ARRASTRE_PX;
            const celda = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest("[data-fecha]") as HTMLElement | null;
            poner({ ...t, movido, destino: celda?.dataset.fecha || null });
        };
        const soltar = async () => {
            const t = tomaRef.current; poner(null);
            if (!t || !t.movido) return;
            recienSoltado.current = true; setTimeout(() => { recienSoltado.current = false; }, 0);
            if (t.destino) await alMoverEspecial(t.esp, t.destino);
        };
        window.addEventListener("pointermove", mover);
        window.addEventListener("pointerup", soltar);
        return () => { window.removeEventListener("pointermove", mover); window.removeEventListener("pointerup", soltar); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [!!toma]);

    return (
        <div className={cn(toma?.movido && "select-none cursor-grabbing")}>
            <div className="grid grid-cols-7 border-b border-border">
                {DIAS.map((d) => <div key={d.n} className="px-2 py-2 text-[11px] text-muted-foreground text-center">{d.corto}</div>)}
            </div>
            <div className="grid grid-cols-7">
                {dias.map((d, i) => {
                    const fecha = aTexto(d); const fuera = d.getMonth() !== mes; const hoy = fecha === ahora.fecha;
                    const items = filas.map((f) => ({ f, ...franjasDelDia(horarios, especiales, f.id, fecha) }));
                    const esDestino = !!toma?.movido && toma.destino === fecha && toma.destino !== toma.esp.fecha;
                    return (
                        <button key={fecha} data-fecha={fecha} onClick={() => { if (!recienSoltado.current) alDia(fecha); }}
                            className={cn("min-h-[104px] p-1.5 text-left border-border hover:bg-accent/40 transition-colors flex flex-col gap-1", i % 7 !== 0 && "border-l", i >= 7 && "border-t", fuera && "bg-muted/30",
                                esDestino && "bg-[color-mix(in_oklab,var(--accion)_12%,transparent)] ring-2 ring-inset ring-[var(--accion)]")}>
                            <span className={cn("h-6 w-6 grid place-items-center rounded-full text-[12px] font-bold tabular-nums", hoy ? "bg-[var(--accion)] text-white" : fuera ? "text-muted-foreground/60" : "")}>{d.getDate()}</span>
                            {items.map(({ f, cerrada, especial, franjas }) => {
                                // Sólo la etiqueta de un día especial se toma para arrastrar; la de un horario de siempre es de todas las semanas.
                                const esp = especial as Especial | null;
                                const tomar = esp ? {
                                    onPointerDown: (e: React.PointerEvent) => { if (e.button !== 0) return; e.stopPropagation(); poner({ esp, destino: fecha, x0: e.clientX, y0: e.clientY, movido: false }); },
                                    ...tip("Arrastrá a otro día para moverlo"),
                                } : {};
                                const tomado = !!toma?.movido && !!esp && toma.esp.id === esp.id;
                                return cerrada ? <span key={f.id} {...tomar} className={cn("text-[10.5px] font-semibold px-1.5 py-0.5 rounded-[6px] border chip-mal truncate", esp && "cursor-grab touch-none", tomado && "opacity-40")}>{filas.length > 1 ? `${f.name}: ` : ""}{esp?.nota || "Cerrada"}</span>
                                    : franjas.length ? <span key={f.id} {...tomar} className={cn("text-[10.5px] font-semibold px-1.5 py-0.5 rounded-[6px] border truncate tabular-nums", esp ? "chip-aviso cursor-grab touch-none" : "chip-info", tomado && "opacity-40")}>
                                        {filas.length > 1 ? `${f.name}: ` : ""}{franjas.map((x) => `${x.abre}–${x.cierra}`).join(", ")}</span>
                                        : null;
                            })}
                            {esDestino && toma && <span className="mt-auto text-[10.5px] font-semibold text-[var(--accion)] truncate">Mover «{toma.esp.nota || (toma.esp.cerrada ? "Cerrada" : `${toma.esp.openTime}–${toma.esp.closeTime}`)}» acá</span>}
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
