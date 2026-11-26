"use client";

import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Brush, Check, Clock, DoorOpen, IdCard, Pencil, Phone, Plus, Shovel, Sparkles, Waves, Wrench } from "lucide-react";
import { sileo as toast } from "sileo";
import { cn } from "@/lib/utils";
import { Matricula } from "@/components/ui/celdas";
import { autorizarServicioLote, estadoServicioLote, guardarServicioLote, serviciosDeLote, type ServicioDeLote } from "@/app/actions/lote-edicion";
import { cuandoViene, DIAS, rotuloServicio, TIPOS_SERVICIO } from "@/lib/servicios-lote";

/**
 * Los servicios de un lote, en su cajón (26/11). Nico: «cada lote tiene que tener sus propios
 * servicios, como jardinería, etc., asociados a su lote, para identificar a proveedores de servicio».
 *
 * Cada servicio dice quién es, qué días viene, a qué hora y en qué vehículo: es lo que la guardia
 * necesita para saber de qué lote es el que llega con una bordeadora. Por sí solo identifica; con la
 * entrada habilitada (26/11) entra por su matrícula en sus días y horario: lo decide el servidor en la
 * barrera (lib-proveedores.js), no la lista blanca de la cámara, que no sabe de días ni horas.
 *
 * Los que se declararon en el censo llegan solos al aprobar la carga; los demás se suman acá. El que
 * dejó de venir se da de baja (queda en el registro, apagado), y todo queda en el historial del lote.
 */

const DIBUJO: Record<string, React.ComponentType<{ size?: number; className?: string }>> = { JARDINERO: Shovel, PISCINERO: Waves, LIMPIEZA: Brush, OTRO: Wrench };
const ENTRADA = "h-9 w-full px-3 rounded-[6px] border border-border bg-background text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accion)]/40 focus-visible:border-[var(--accion)]";
const BOTON = "h-8 px-3 rounded-[6px] text-[12.5px] font-semibold inline-flex items-center gap-1.5 disabled:opacity-50";
const VACIO = { tipo: "JARDINERO", nombre: "", telefono: "", documento: "", chapa: "", dias: [] as string[], desde: "", hasta: "", notas: "", autorizado: false };
type Form = typeof VACIO & { id?: string };

export function ServiciosLote({ unitId, puedeEditar, alCambiar }: { unitId: string; puedeEditar: boolean; alCambiar: () => void }) {
    const [filas, setFilas] = useState<ServicioDeLote[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [vuelta, setVuelta] = useState(0);
    const [form, setForm] = useState<Form | null>(null);
    const [verBajas, setVerBajas] = useState(false);
    const refrescar = useCallback(() => { setVuelta((n) => n + 1); alCambiar(); }, [alCambiar]);
    useEffect(() => {
        let vivo = true;
        serviciosDeLote(unitId).then((f) => { if (vivo) { setFilas(f); setError(null); } }).catch((e) => { if (vivo) setError(e instanceof Error ? e.message : "No se pudieron traer los servicios."); });
        return () => { vivo = false; };
    }, [unitId, vuelta]);
    const activos = (filas || []).filter((f) => f.estado === "ACTIVO"), bajas = (filas || []).filter((f) => f.estado !== "ACTIVO");

    if (error) return <p className="text-[12.5px] tono-mal">{error}</p>;
    if (!filas) return <p className="text-[12.5px] text-muted-foreground">Trayendo los servicios…</p>;
    return (
        <div>
            {activos.length === 0 && !form && <p className="text-[12.5px] text-muted-foreground">Este lote no tiene servicios cargados. Los que declaren en el censo llegan solos al aprobar la carga.</p>}
            {activos.length > 0 && (
                <ul className="divide-y divide-border rounded-[10px] border border-border">
                    {activos.map((f) => <Fila key={f.id} f={f} puedeEditar={puedeEditar} alEditar={() => setForm({ ...VACIO, ...f, telefono: f.telefono || "", documento: f.documento || "", chapa: f.chapa || "", desde: f.desde || "", hasta: f.hasta || "", notas: f.notas || "" })}
                        alBaja={async () => { const r = await estadoServicioLote(unitId, f.id, false); if (!r.ok) toast.error({ title: "No se pudo", description: r.error }); else { toast.success({ title: "Servicio dado de baja", description: "Queda en el historial del lote." }); refrescar(); } }}
                        alAutorizar={async (on) => { const r = await autorizarServicioLote(unitId, f.id, on); if (!r.ok) toast.error({ title: "No se pudo", description: r.error }); else { toast.success({ title: on ? "Entrada habilitada" : "Entrada deshabilitada", description: on ? "Entra por su matrícula en sus días y horario, con media hora de margen." : "Se lo sigue identificando, pero no entra solo." }); refrescar(); } }} />)}
                </ul>
            )}
            <AnimatePresence initial={false}>
                {form && (
                    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ type: "spring", bounce: 0, duration: 0.3 }} className="overflow-hidden">
                        <Formulario unitId={unitId} inicial={form} alCerrar={() => setForm(null)} alGuardar={() => { setForm(null); refrescar(); }} />
                    </motion.div>
                )}
            </AnimatePresence>
            {puedeEditar && !form && <button type="button" onClick={() => setForm({ ...VACIO })} className={cn(BOTON, "mt-2 border border-border hover:bg-accent")}><Plus size={14} /> Sumar un servicio</button>}
            {bajas.length > 0 && (
                <div className="mt-3">
                    <button type="button" onClick={() => setVerBajas((v) => !v)} className="text-[12px] font-semibold text-muted-foreground hover:text-[var(--accion)]">{verBajas ? "Ocultar los que dejaron de venir" : `${bajas.length} ${bajas.length === 1 ? "dejó" : "dejaron"} de venir`}</button>
                    {verBajas && (
                        <ul className="mt-2 divide-y divide-border rounded-[10px] border border-border opacity-70">
                            {bajas.map((f) => <Fila key={f.id} f={f} puedeEditar={puedeEditar} alActivar={async () => { const r = await estadoServicioLote(unitId, f.id, true); if (r.ok) { toast.success({ title: "Servicio activo de nuevo" }); refrescar(); } }} />)}
                        </ul>
                    )}
                </div>
            )}
        </div>
    );
}

function Fila({ f, puedeEditar, alEditar, alBaja, alActivar, alAutorizar }: { f: ServicioDeLote; puedeEditar: boolean; alEditar?: () => void; alBaja?: () => void; alActivar?: () => void; alAutorizar?: (on: boolean) => void }) {
    const [confirmar, setConfirmar] = useState(false);
    const Dib = DIBUJO[f.tipo] || Wrench;
    const cuando = cuandoViene(f);
    return (
        <li className="group flex items-start gap-3 px-3 py-2.5">
            <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-[8px] bg-muted"><Dib size={15} /></span>
            <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-[13.5px] font-bold">{f.nombre || rotuloServicio(f.tipo)}</span>
                    <span className="text-[11.5px] text-muted-foreground">{rotuloServicio(f.tipo)}</span>
                    {f.origen === "censo" && <span className="rounded-full chip-info px-1.5 py-px text-[10px] font-bold">del censo</span>}
                    {f.chapa && <Matricula p={f.chapa} />}
                </div>
                <p className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[12px] text-muted-foreground">
                    {cuando && <span className="inline-flex items-center gap-1"><Clock size={11} />{cuando}</span>}
                    {f.telefono && <span className="inline-flex items-center gap-1 tabular-nums"><Phone size={11} />{f.telefono}</span>}
                    {f.documento && <span className="inline-flex items-center gap-1 tabular-nums"><IdCard size={11} />{f.documento}</span>}
                    {!cuando && !f.telefono && !f.documento && <span>Sin días ni contacto cargados</span>}
                </p>
                {f.notas && <p className="mt-0.5 text-[12px] leading-snug text-muted-foreground">{f.notas}</p>}
                {alAutorizar && (f.autorizado ? (
                    <p className="mt-1.5 flex flex-wrap items-center gap-2 text-[12px]">
                        <span className="inline-flex items-center gap-1 rounded-full chip-bien px-2 py-0.5 text-[11px] font-bold" title={f.autorizadoPor ? `La habilitó ${f.autorizadoPor}` : undefined}><DoorOpen size={11} /> Entra en su horario</span>
                        {puedeEditar && <button type="button" onClick={() => alAutorizar(false)} className="font-semibold text-muted-foreground hover:text-[var(--accion)]">Quitar entrada</button>}
                    </p>
                ) : f.chapa && f.dias.length ? (
                    puedeEditar && <button type="button" onClick={() => alAutorizar(true)} className="mt-1.5 inline-flex items-center gap-1 text-[12px] font-semibold text-[var(--accion)] hover:underline"><DoorOpen size={12} /> Habilitar su entrada por matrícula</button>
                ) : (
                    <p className="mt-1.5 text-[11.5px] text-muted-foreground">Sólo se lo identifica. Para que entre solo, cargale la matrícula y los días.</p>
                ))}
            </div>
            {puedeEditar && (alActivar ? (
                <button type="button" onClick={alActivar} className="text-[12px] font-semibold text-[var(--accion)]">Volver a activar</button>
            ) : confirmar ? (
                <span className="flex items-center gap-1.5 text-[12px]">
                    <button type="button" onClick={() => { setConfirmar(false); alBaja?.(); }} className="font-bold tono-mal">Dejó de venir</button>
                    <button type="button" onClick={() => setConfirmar(false)} className="text-muted-foreground">No</button>
                </span>
            ) : (
                <span className="flex items-center gap-0.5 opacity-70 group-hover:opacity-100">
                    <button type="button" onClick={alEditar} className="grid h-7 w-7 place-items-center rounded-[6px] text-muted-foreground hover:bg-accent hover:text-[var(--accion)]" aria-label="Corregir" title="Corregir"><Pencil size={13} /></button>
                    <button type="button" onClick={() => setConfirmar(true)} className="h-7 px-2 rounded-[6px] text-[11.5px] font-semibold text-muted-foreground hover:bg-accent">Baja</button>
                </span>
            ))}
        </li>
    );
}

function Formulario({ unitId, inicial, alCerrar, alGuardar }: { unitId: string; inicial: Form; alCerrar: () => void; alGuardar: () => void }) {
    const [f, setF] = useState<Form>(inicial);
    const [guardando, setGuardando] = useState(false);
    const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));
    const dia = (d: string) => set("dias", f.dias.includes(d) ? f.dias.filter((x) => x !== d) : [...f.dias, d]);
    const Dib = DIBUJO[f.tipo] || Wrench;
    return (
        <div className="mt-2 space-y-3 rounded-[10px] border border-border bg-background p-3.5">
            <div className="flex items-center gap-2.5">
                <span className="grid h-9 w-9 place-items-center rounded-[8px] bg-muted text-[var(--accion)]"><Dib size={16} /></span>
                <div className="min-w-0 flex-1"><p className="text-[13.5px] font-bold">{f.id ? "Corregir el servicio" : "Un servicio nuevo"}</p><p className="text-[11.5px] text-muted-foreground">Identifica a quien viene a trabajar al lote. Con la entrada habilitada, entra por su matrícula en su horario.</p></div>
            </div>
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Qué servicio">
                {TIPOS_SERVICIO.map((t) => {
                    const I = DIBUJO[t.id] || Wrench, activo = f.tipo === t.id;
                    return <button key={t.id} type="button" role="radio" aria-checked={activo} onClick={() => set("tipo", t.id)} className={cn("h-8 px-3 rounded-full border text-[12px] font-semibold inline-flex items-center gap-1.5", activo ? "border-[var(--accion)] text-[var(--accion)] bg-[color-mix(in_oklab,var(--accion)_8%,transparent)]" : "border-border hover:bg-accent")}><I size={13} />{t.rotulo}</button>;
                })}
            </div>
            <label className="block"><span className="mb-1 block text-[11.5px] font-semibold text-muted-foreground">Quién es</span><input autoFocus value={f.nombre} onChange={(e) => set("nombre", e.target.value)} placeholder="Ramón Pérez, o la empresa «Verde Sur»" className={ENTRADA} /></label>
            <div className="grid gap-2 sm:grid-cols-3">
                <label className="block"><span className="mb-1 block text-[11.5px] font-semibold text-muted-foreground">Teléfono</span><input value={f.telefono} onChange={(e) => set("telefono", e.target.value)} inputMode="tel" placeholder="099 123 456" className={cn(ENTRADA, "tabular-nums")} /></label>
                <label className="block"><span className="mb-1 block text-[11.5px] font-semibold text-muted-foreground">Documento</span><input value={f.documento} onChange={(e) => set("documento", e.target.value)} placeholder="1.234.567-8" className={cn(ENTRADA, "tabular-nums")} /></label>
                <label className="block"><span className="mb-1 block text-[11.5px] font-semibold text-muted-foreground">Matrícula</span><input value={f.chapa} onChange={(e) => set("chapa", e.target.value.toUpperCase())} placeholder="Si viene en vehículo" className={cn(ENTRADA, "font-bold tracking-wider")} /></label>
            </div>
            <div>
                <span className="mb-1 block text-[11.5px] font-semibold text-muted-foreground">Qué días viene</span>
                <div className="flex flex-wrap gap-1.5">
                    {DIAS.map((d) => <button key={d} type="button" aria-pressed={f.dias.includes(d)} onClick={() => dia(d)} className={cn("h-8 w-11 rounded-full border text-[12px] font-semibold capitalize", f.dias.includes(d) ? "border-[var(--accion)] bg-[var(--accion)] text-white" : "border-border hover:bg-accent")}>{d}</button>)}
                </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
                <label className="block"><span className="mb-1 block text-[11.5px] font-semibold text-muted-foreground">Desde</span><input type="time" step={900} value={f.desde} onChange={(e) => set("desde", e.target.value)} className={cn(ENTRADA, "tabular-nums")} /></label>
                <label className="block"><span className="mb-1 block text-[11.5px] font-semibold text-muted-foreground">Hasta</span><input type="time" step={900} value={f.hasta} onChange={(e) => set("hasta", e.target.value)} className={cn(ENTRADA, "tabular-nums")} /></label>
            </div>
            <label className={cn("flex items-start gap-2.5 rounded-[10px] border p-3 cursor-pointer", f.autorizado ? "border-[var(--accion)] bg-[color-mix(in_oklab,var(--accion)_6%,transparent)]" : "border-border", (!f.chapa.trim() || !f.dias.length) && "opacity-60 cursor-not-allowed")}>
                <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[var(--accion)]" checked={f.autorizado} disabled={!f.chapa.trim() || !f.dias.length} onChange={(e) => set("autorizado", e.target.checked)} />
                <span className="min-w-0">
                    <span className="flex items-center gap-1.5 text-[13px] font-semibold"><DoorOpen size={14} /> Habilitar su entrada por matrícula</span>
                    <span className="block text-[11.5px] leading-snug text-muted-foreground">{!f.chapa.trim() || !f.dias.length ? "Hacen falta la matrícula y los días que viene." : "Entra sólo en sus días y su horario, con media hora de margen. Fuera de horario queda denegado y la guardia ve de qué lote es. La lista negra manda siempre."}</span>
                </span>
            </label>
            <label className="block"><span className="mb-1 block text-[11.5px] font-semibold text-muted-foreground">Notas para la guardia</span><input value={f.notas} onChange={(e) => set("notas", e.target.value)} placeholder="Viene con un ayudante · deja la camioneta afuera" className={ENTRADA} /></label>
            <div className="flex items-center justify-end gap-2">
                <button type="button" onClick={alCerrar} className={cn(BOTON, "border border-border hover:bg-accent")}>Cancelar</button>
                <button type="button" disabled={guardando || (!f.nombre.trim() && !f.chapa.trim())} onClick={async () => {
                    setGuardando(true);
                    try {
                        const r = await guardarServicioLote(unitId, f);
                        if (!r.ok) toast.error({ title: "No se guardó", description: r.error });
                        else { toast.success({ title: f.id ? "Servicio corregido" : "Servicio sumado", description: "Quedó anotado en el historial del lote." }); alGuardar(); }
                    } finally { setGuardando(false); }
                }} className={cn(BOTON, "bg-[var(--accion)] text-white hover:opacity-90")}>{guardando ? <Sparkles size={14} className="animate-pulse" /> : <Check size={14} />} Guardar</button>
            </div>
        </div>
    );
}
