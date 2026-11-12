"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CalendarClock, Camera, Loader2, Pause, Pencil, Play, Plus, Save, Trash2, VideoOff } from "lucide-react";
import { sileo as toast } from "sileo";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Cajon, CajonCampo, CajonContenido, CajonSeccion } from "@/components/ui/cajon";
import { Cargando, Chip, ErrorEstado, Vacio } from "@/components/ui/estados";
import { ConfirmarAccion } from "@/components/DeleteConfirmDialog";
import { fechaCorta, hace, hora } from "@/lib/fechas";
import {
    CADA_MIN_DEFECTO, CADA_MIN_OPCIONES, CAMARAS_MAXIMO, COLA_MAXIMA, DIAS_DEFECTO, DIAS_MAXIMO, LARGO_NOMBRE_PROGRAMA, TOPE_DEFECTO, TOPE_MAXIMO,
    cadaCuanto, type Horario, type ProgramaFila, type Situacion,
} from "@/lib/capturas-programadas";

/**
 * Las capturas programadas del conjunto de entrenamiento (openspec capturas-programadas-entrenamiento):
 * la lista de programaciones con lo que está haciendo cada una, y el formulario para armar una.
 *
 * Nico, 12/11: «podemos dejar una forma de sacar capturas de las escenas cada x tiempo, para
 * entrenar los objetos también con las escenas actuales?». «Sacar foto ahora» pedía estar sentado
 * tocando el botón a la mañana, a la tarde y de noche.
 *
 * Un solo cajón con dos vistas (lista y formulario) y no dos ventanas: el formulario siempre
 * vuelve a la lista, que es donde se ve si lo que se armó está andando.
 */
type Canal = { id: string; nombre: string; grupo: string };
type Form = { id: string | null; nombre: string; camaras: string[]; cadaMin: number; horario: Horario; tope: number; dias: number; guardadas: number };
type Datos = { programas: ProgramaFila[]; sinDibujar: number; relojVivo: boolean | null };

/** Cada cuánto se vuelve a preguntar mientras el cajón está abierto: una vuelta tarda segundos y se quiere ver entrar. */
const REFRESCO_MS = 15_000;
const HORARIO_NOCHE: Horario = { desde: "20:00", hasta: "06:00" };

const NUEVO: Form = { id: null, nombre: "", camaras: [], cadaMin: CADA_MIN_DEFECTO, horario: null, tope: TOPE_DEFECTO, dias: DIAS_DEFECTO, guardadas: 0 };

/** «en 12 min», «en 3 h», «ya»: cuánto falta para una hora que todavía no llegó. */
function falta(iso: string): string {
    const seg = (Date.parse(iso) - Date.now()) / 1000;
    if (seg < 60) return "en menos de un minuto";
    if (seg < 3600) return `en ${Math.round(seg / 60)} min`;
    if (seg < 86400) return `en ${Math.round(seg / 3600)} h`;
    return `el ${fechaCorta(iso)}`;
}

/** El estado en una palabra (el chip) y en una frase (qué va a pasar). El tono es estado, nunca acción. */
function decir(s: Situacion, p: ProgramaFila): { chip: string; tono: "bien" | "aviso" | "quieto" | "info"; frase: string } {
    switch (s.que) {
        case "tomar": return { chip: "Activa", tono: "bien", frase: s.pedida ? "Tomando ahora: entra en la próxima pasada, en menos de dos minutos." : "Le toca: toma en la próxima pasada, en menos de un minuto." };
        case "esperar": return { chip: "Activa", tono: "bien", frase: `Próxima vuelta ${falta(s.proxima)} (${hora(s.proxima)}).` };
        case "franja": return { chip: "Fuera de horario", tono: "info", frase: `Vuelve a tomar a las ${p.horario?.desde}, ${falta(s.proxima)}.` };
        case "cola": return { chip: "Esperando", tono: "aviso", frase: `Hay ${COLA_MAXIMA} fotos o más sin dibujar. Sigue sola cuando se dibujen o se descarten.` };
        case "pausada": return { chip: "En pausa", tono: "quieto", frase: "No toma fotos hasta que se reanude. Conserva sus contadores, su tope y su fecha." };
        case "terminada": return { chip: "Terminó", tono: "quieto", frase: s.motivo === "tope" ? `Llegó a ${p.tope} fotos. Para seguir, subile el tope.` : `Llegó a su fecha de fin (${fechaCorta(p.hasta)}). Para seguir, dale más días.` };
    }
}

export function CapturasProgramadas({ canales, alCerrar, alCambiarFotos }: {
    /** Las cámaras que se pueden elegir: las mismas de «Sacar foto ahora», agrupadas por grabador. */
    canales: Canal[];
    alCerrar: () => void;
    /** Entraron o se descartaron fotos: la pantalla de atrás tiene que volver a contar. */
    alCambiarFotos: () => void;
}) {
    const [datos, setDatos] = useState<Datos | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [form, setForm] = useState<Form | null>(null);
    const [guardando, setGuardando] = useState(false);
    const [ocupada, setOcupada] = useState<string | null>(null);
    const [aBorrar, setABorrar] = useState<ProgramaFila | null>(null);
    const [aDescartar, setADescartar] = useState<ProgramaFila | null>(null);

    const colaVista = useRef<number | null>(null);
    const cargar = useCallback(async () => {
        try {
            const r = await fetch("/api/vision/objetos/capturas", { cache: "no-store" });
            const j = await r.json().catch(() => ({}));
            if (!r.ok) throw new Error(j?.error || `El servidor respondió ${r.status}`);
            // Si entraron fotos desde la última vez, la grilla de atrás quedó vieja.
            if (colaVista.current != null && j.sinDibujar !== colaVista.current) alCambiarFotos();
            colaVista.current = j.sinDibujar;
            setDatos(j);
            setError(null);
        } catch (e: any) { setError(e?.message || "No se pudo leer"); }
    }, [alCambiarFotos]);
    useEffect(() => { cargar(); const t = setInterval(cargar, REFRESCO_MS); return () => clearInterval(t); }, [cargar]);

    async function pedir(url: string, init: RequestInit) {
        const r = await fetch(url, init);
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j?.error || `El servidor respondió ${r.status}`);
        return j;
    }
    async function accion(p: ProgramaFila, cual: "pausar" | "reanudar" | "tomar") {
        setOcupada(p.id);
        try {
            await pedir(`/api/vision/objetos/capturas/${p.id}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ accion: cual }) });
            if (cual === "tomar") toast.success({ title: "Pedido", description: "Toma una foto por cámara en la próxima pasada, en menos de dos minutos." });
            await cargar();
        } catch (e: any) { toast.error({ title: "No se pudo", description: e?.message }); }
        finally { setOcupada(null); }
    }
    async function guardar(f: Form) {
        setGuardando(true);
        try {
            const cuerpo = { nombre: f.nombre, camaras: f.camaras, cadaMin: f.cadaMin, horario: f.horario, tope: f.tope, hasta: new Date(Date.now() + f.dias * 86_400_000).toISOString() };
            await pedir(f.id ? `/api/vision/objetos/capturas/${f.id}` : "/api/vision/objetos/capturas", { method: f.id ? "PUT" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(cuerpo) });
            toast.success({ title: f.id ? "Guardada" : "Programación creada", description: f.id ? undefined : "La primera vuelta sale en menos de dos minutos." });
            setForm(null); await cargar();
        } catch (e: any) { toast.error({ title: "No se guardó", description: e?.message }); }
        finally { setGuardando(false); }
    }
    const editar = (p: ProgramaFila) => setForm({
        id: p.id, nombre: p.nombre, camaras: p.camaras, cadaMin: p.cadaMin, horario: p.horario, tope: p.tope, guardadas: p.guardadas,
        // Los días que le quedan; una vencida arranca con los de siempre.
        dias: p.hasta && Date.parse(p.hasta) > Date.now() ? Math.max(1, Math.ceil((Date.parse(p.hasta) - Date.now()) / 86_400_000)) : DIAS_DEFECTO,
    });

    if (form) return <Formulario inicial={form} canales={canales} guardando={guardando} alVolver={() => setForm(null)} alGuardar={guardar} />;

    return (
        <Cajon open onOpenChange={(o) => { if (!o) alCerrar(); }}>
            <CajonContenido ancho="medio" titulo="Capturas programadas"
                descripcion="Fotos de las cámaras cada cierto tiempo, solas. Entran a «Sin dibujar»; si la escena no cambió desde la última, se saltea."
                pie={<><Button variant="ghost" onClick={alCerrar}>Cerrar</Button><Button onClick={() => setForm(NUEVO)}><Plus size={15} /> Nueva programación</Button></>}>
                {!datos && error ? <ErrorEstado mensaje={error} alReintentar={cargar} />
                    : !datos ? <Cargando texto="Trayendo las programaciones…" />
                        : (
                            <div className="space-y-3">
                                {error && <p className="text-[12px] tono-aviso">No se pudo actualizar ({error}). Se muestra lo último que se leyó.</p>}
                                {datos.relojVivo === false && (
                                    <div className="rounded-[10px] border border-border chip-mal px-3 py-2.5 flex items-start gap-2 text-[12.5px] leading-snug">
                                        <AlertTriangle size={15} className="shrink-0 mt-0.5" />
                                        <span><b>Las capturas no se están tomando.</b> El proceso de visión no pasó en los últimos 5 minutos: hasta que vuelva, ninguna programación saca fotos.</span>
                                    </div>
                                )}
                                {datos.programas.length === 0 ? (
                                    <Vacio icono={CalendarClock} titulo="Todavía no hay ninguna programación"
                                        ayuda="Elegí las cámaras donde va a correr el modelo y dejá que junten fotos de día y de noche. Después se dibujan de corrido."
                                        accion={<Button onClick={() => setForm(NUEVO)}><Plus size={15} /> Nueva programación</Button>} />
                                ) : datos.programas.map((p) => (
                                    <Tarjeta key={p.id} p={p} ocupada={ocupada === p.id} alAccion={(c) => accion(p, c)} alEditar={() => editar(p)} alBorrar={() => setABorrar(p)} alDescartar={() => setADescartar(p)} />
                                ))}
                                {datos.programas.length > 0 && (
                                    <p className="text-[11.5px] text-muted-foreground leading-snug">
                                        Sin dibujar en todo el conjunto: <b className="text-foreground tabular-nums">{datos.sinDibujar}</b> de {COLA_MAXIMA}. Al llegar a {COLA_MAXIMA}, todas esperan.
                                        Una cámara con árboles al viento o tránsito al fondo nunca da «repetida»: ahí el freno es el tope.
                                    </p>
                                )}
                            </div>
                        )}
                {aBorrar && (
                    <ConfirmarAccion open onOpenChange={(o) => { if (!o) setABorrar(null); }} id={aBorrar.id} title={`Programación «${aBorrar.nombre}»`}
                        description={`Deja de tomar fotos. Las ${aBorrar.guardadas} que ya tomó quedan en el conjunto, dibujadas o no.`}
                        onDelete={async (id) => { try { await pedir(`/api/vision/objetos/capturas/${id}`, { method: "DELETE" }); } catch (e: any) { return { success: false, error: e?.message }; } }}
                        onSuccess={() => { setABorrar(null); cargar(); }} />
                )}
                {aDescartar && (
                    <ConfirmarAccion open onOpenChange={(o) => { if (!o) setADescartar(null); }} id={aDescartar.id} title={`${aDescartar.pendientes} fotos sin dibujar de «${aDescartar.nombre}»`}
                        description="Se quitan del conjunto las que nadie dibujó todavía. Las ya dibujadas (o marcadas «No hay ninguno») no se tocan. No le devuelve cupo a la programación."
                        etiquetaAccion={`Descartar las ${aDescartar.pendientes}`}
                        onDelete={async (id) => { try { await pedir(`/api/vision/objetos/capturas/${id}/fotos`, { method: "DELETE" }); } catch (e: any) { return { success: false, error: e?.message }; } }}
                        onSuccess={() => { setADescartar(null); alCambiarFotos(); cargar(); }} />
                )}
            </CajonContenido>
        </Cajon>
    );
}

function Tarjeta({ p, ocupada, alAccion, alEditar, alBorrar, alDescartar }: {
    p: ProgramaFila; ocupada: boolean; alAccion: (c: "pausar" | "reanudar" | "tomar") => void; alEditar: () => void; alBorrar: () => void; alDescartar: () => void;
}) {
    const d = decir(p.situacion, p);
    const corre = ["tomar", "esperar", "franja", "cola"].includes(p.situacion.que);
    const sinImagen = p.camarasEstado.filter((c) => c.fallos > 0);
    return (
        <section className="rounded-[10px] border border-border bg-card p-3.5 space-y-2.5">
            <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[14px] font-bold truncate">{p.nombre}</span>
                        <Chip tono={d.tono}>{d.chip}</Chip>
                    </div>
                    <div className="text-[12px] text-muted-foreground mt-0.5">
                        {p.camaras.length === 1 ? "1 cámara" : `${p.camaras.length} cámaras`} · {cadaCuanto(p.cadaMin)}{p.horario ? ` · de ${p.horario.desde} a ${p.horario.hasta}` : ""}{p.hasta ? ` · hasta el ${fechaCorta(p.hasta)}` : ""}
                    </div>
                </div>
                <Button variant="ghost" size="icon-sm" onClick={alEditar} aria-label="Editar" title="Editar"><Pencil size={14} /></Button>
                <Button variant="ghost" size="icon-sm" onClick={alBorrar} aria-label="Borrar" title="Borrar la programación (las fotos quedan)"><Trash2 size={14} /></Button>
            </div>

            {/* El avance contra el tope: cuántas tomó, no cuántas quedan sin dibujar. */}
            <div>
                <div className="relative h-1.5 rounded-full bg-muted overflow-hidden" aria-hidden>
                    <span className="absolute inset-y-0 left-0 rounded-full bg-[var(--accion)]" style={{ width: `${Math.min(100, (p.guardadas / p.tope) * 100)}%` }} />
                </div>
                <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-[12px] tabular-nums">
                    <span><b>{p.guardadas}</b> <span className="text-muted-foreground">de {p.tope} fotos</span></span>
                    <span><b>{p.salteadas}</b> <span className="text-muted-foreground">repetidas salteadas</span></span>
                    <span><b>{p.pendientes}</b> <span className="text-muted-foreground">sin dibujar</span></span>
                    {p.ultimaVueltaAt && <span className="text-muted-foreground">última vuelta {hace(p.ultimaVueltaAt)}</span>}
                </div>
            </div>

            <p className="text-[12.5px] leading-snug">{d.frase}</p>

            {sinImagen.length > 0 && (
                <ul className="space-y-1">
                    {sinImagen.map((c) => (
                        <li key={c.id} className="flex items-start gap-1.5 text-[12px] leading-snug tono-mal">
                            <VideoOff size={13} className="shrink-0 mt-0.5" />
                            <span><b>{c.nombre}</b> no da imagen{c.errorDesde ? ` desde ${hace(c.errorDesde)}` : ""}: {c.error || "sin cuadro"}. Las demás siguen.</span>
                        </li>
                    ))}
                </ul>
            )}

            <div className="flex flex-wrap gap-2 pt-0.5">
                {corre && <Button variant="outline" size="sm" disabled={ocupada || p.situacion.que === "cola"} onClick={() => alAccion("tomar")}>{ocupada ? <Loader2 size={13} className="animate-spin" /> : <Camera size={13} />} Tomar ahora</Button>}
                {p.situacion.que === "pausada" && <Button variant="outline" size="sm" disabled={ocupada} onClick={() => alAccion("reanudar")}><Play size={13} /> Reanudar</Button>}
                {corre && <Button variant="ghost" size="sm" disabled={ocupada} onClick={() => alAccion("pausar")}><Pause size={13} /> Pausar</Button>}
                {p.pendientes > 0 && <Button variant="ghost" size="sm" onClick={alDescartar} className="ml-auto"><Trash2 size={13} /> Descartar las {p.pendientes} sin dibujar</Button>}
            </div>
        </section>
    );
}

function Formulario({ inicial, canales, guardando, alVolver, alGuardar }: { inicial: Form; canales: Canal[]; guardando: boolean; alVolver: () => void; alGuardar: (f: Form) => void }) {
    const [f, setF] = useState<Form>(inicial);
    const [busca, setBusca] = useState("");
    const cambiar = (p: Partial<Form>) => setF((x) => ({ ...x, ...p }));
    const elegidas = useMemo(() => new Set(f.camaras), [f.camaras]);
    const visibles = useMemo(() => { const q = busca.trim().toLowerCase(); return q ? canales.filter((c) => `${c.nombre} ${c.grupo}`.toLowerCase().includes(q)) : canales; }, [canales, busca]);
    const grupos = useMemo(() => [...new Set(visibles.map((c) => c.grupo))], [visibles]);
    // Las que ya estaban elegidas y hoy no figuran en la lista (un canal que se dio de baja): se ven, para poder sacarlas.
    const huerfanas = f.camaras.filter((id) => !canales.some((c) => c.id === id));
    const alternar = (id: string) => cambiar({ camaras: elegidas.has(id) ? f.camaras.filter((x) => x !== id) : [...f.camaras, id] });
    const lleno = f.camaras.length >= CAMARAS_MAXIMO;
    const topeMin = Math.max(1, f.guardadas);
    const listo = f.nombre.trim() && f.camaras.length > 0 && f.camaras.length <= CAMARAS_MAXIMO && f.tope >= topeMin && f.tope <= TOPE_MAXIMO && f.dias >= 1 && f.dias <= DIAS_MAXIMO
        && (!f.horario || (f.horario.desde && f.horario.hasta && f.horario.desde !== f.horario.hasta));
    // Lo que va a pasar, en números: es lo que hay que ver antes de guardar.
    const porDia = Math.round((f.horario ? horasDe(f.horario) : 24) * 60 / f.cadaMin) * Math.max(1, f.camaras.length);
    const diasHastaTope = porDia > 0 ? (f.tope - f.guardadas) / porDia : 0;

    return (
        <Cajon open onOpenChange={(o) => { if (!o) alVolver(); }}>
            <CajonContenido ancho="medio" titulo={f.id ? f.nombre || "Programación" : "Nueva programación"}
                descripcion="Qué cámaras, cada cuánto y hasta cuándo. Se puede pausar o cambiar después."
                pie={<><Button variant="ghost" onClick={alVolver}>Volver</Button><Button onClick={() => alGuardar(f)} disabled={!listo || guardando}>{guardando ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} {f.id ? "Guardar" : "Crear"}</Button></>}>
                <CajonSeccion titulo="Qué cámaras" ayuda="Las cámaras donde va a correr el modelo. De cada una se toma el cuadro en máxima resolución, igual que «Sacar foto ahora».">
                    <CajonCampo etiqueta="Nombre">
                        <Input value={f.nombre} maxLength={LARGO_NOMBRE_PROGRAMA} onChange={(e) => cambiar({ nombre: e.target.value })} placeholder="Contenedores, día y noche" />
                    </CajonCampo>
                    <div>
                        <div className="flex items-center justify-between gap-2 mb-1.5">
                            <span className="text-[12px] font-medium text-foreground/85">Cámaras</span>
                            <span className={cn("text-[11.5px] tabular-nums", lleno ? "tono-aviso font-semibold" : "text-muted-foreground")}>{f.camaras.length} de {CAMARAS_MAXIMO}</span>
                        </div>
                        {canales.length > 8 && <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar una cámara o un grabador" className="mb-2 h-8 text-[12.5px]" />}
                        <div className="rounded-[10px] border border-border max-h-64 overflow-y-auto divide-y divide-border">
                            {canales.length === 0 && <p className="p-3 text-[12px] text-muted-foreground">No se pudo leer la lista de cámaras. Cerrá y volvé a abrir.</p>}
                            {grupos.map((g) => (
                                <div key={g}>
                                    <div className="px-3 pt-2 pb-1 text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground">{g}</div>
                                    {visibles.filter((c) => c.grupo === g).map((c) => {
                                        const on = elegidas.has(c.id);
                                        return (
                                            <label key={c.id} className={cn("flex items-center gap-2.5 px-3 py-1.5 text-[12.5px] cursor-pointer hover:bg-accent/40", !on && lleno && "opacity-50 cursor-not-allowed")}>
                                                <input type="checkbox" checked={on} disabled={!on && lleno} onChange={() => alternar(c.id)} className="accent-[var(--accion)] h-3.5 w-3.5" />
                                                <span className="truncate">{c.nombre}</span>
                                            </label>
                                        );
                                    })}
                                </div>
                            ))}
                            {huerfanas.map((id) => (
                                <label key={id} className="flex items-center gap-2.5 px-3 py-1.5 text-[12.5px] cursor-pointer tono-aviso">
                                    <input type="checkbox" checked onChange={() => alternar(id)} className="accent-[var(--accion)] h-3.5 w-3.5" />
                                    <span className="truncate">Una cámara que ya no está en la lista: destildala para poder guardar</span>
                                </label>
                            ))}
                        </div>
                    </div>
                </CajonSeccion>

                <CajonSeccion titulo="Cada cuánto" ayuda="Más seguido no es mejor: sirve la variedad (mañana, tarde, noche, lluvia), no cien fotos de la misma hora.">
                    <div className="flex flex-wrap gap-1.5">
                        {CADA_MIN_OPCIONES.map((m) => (
                            <button key={m} type="button" onClick={() => cambiar({ cadaMin: m })} aria-pressed={f.cadaMin === m}
                                className={cn("h-8 px-3 rounded-full text-[12.5px] font-semibold border transition-colors", f.cadaMin === m ? "bg-[var(--accion)] text-white border-transparent" : "border-border text-muted-foreground hover:text-foreground")}>
                                {cadaCuanto(m).replace(/^cada /, "")}
                            </button>
                        ))}
                    </div>
                    <CajonCampo etiqueta="Horario" ayuda="Hora del barrio. «Sólo de noche» sirve para completar lo que falta: de noche la cámara ve en infrarrojo y es otra imagen.">
                        <div className="inline-flex rounded-md bg-muted p-0.5 w-fit">
                            {([["siempre", "Todo el día"], ["horario", "En un horario"]] as const).map(([v, r]) => (
                                <button key={v} type="button" onClick={() => cambiar({ horario: v === "siempre" ? null : f.horario || HORARIO_NOCHE })}
                                    className={cn("h-8 px-3 rounded-md text-[12.5px] font-semibold", (f.horario ? "horario" : "siempre") === v ? "bg-background text-foreground" : "text-muted-foreground hover:text-foreground")}>{r}</button>
                            ))}
                        </div>
                    </CajonCampo>
                    {f.horario && (
                        <div className="flex items-end gap-3">
                            <CajonCampo etiqueta="Desde"><Input type="time" value={f.horario.desde} onChange={(e) => cambiar({ horario: { ...f.horario!, desde: e.target.value } })} className="w-32 tabular-nums" /></CajonCampo>
                            <CajonCampo etiqueta="Hasta"><Input type="time" value={f.horario.hasta} onChange={(e) => cambiar({ horario: { ...f.horario!, hasta: e.target.value } })} className="w-32 tabular-nums" /></CajonCampo>
                        </div>
                    )}
                </CajonSeccion>

                <CajonSeccion titulo="Hasta cuándo" ayuda="Termina sola con lo que ocurra primero. Las fotos repetidas que saltea no cuentan para el tope.">
                    <div className="grid grid-cols-2 gap-3">
                        <CajonCampo etiqueta="Tope de fotos" ayuda={f.guardadas ? `Ya tomó ${f.guardadas}. Hasta ${TOPE_MAXIMO}.` : `Hasta ${TOPE_MAXIMO}.`}>
                            <Input type="number" min={topeMin} max={TOPE_MAXIMO} value={f.tope} onChange={(e) => cambiar({ tope: Math.round(Number(e.target.value)) })} className="tabular-nums" />
                        </CajonCampo>
                        <CajonCampo etiqueta="Durante" ayuda={`días desde hoy (hasta ${DIAS_MAXIMO})`}>
                            <Input type="number" min={1} max={DIAS_MAXIMO} value={f.dias} onChange={(e) => cambiar({ dias: Math.round(Number(e.target.value)) })} className="tabular-nums" />
                        </CajonCampo>
                    </div>
                    {f.camaras.length > 0 && (
                        <p className="text-[12px] leading-snug text-muted-foreground">
                            Son hasta <b className="text-foreground tabular-nums">{porDia}</b> fotos por día si la escena cambia siempre.
                            {diasHastaTope > 0 && diasHastaTope < f.dias && <> A ese ritmo el tope se alcanza en <b className="text-foreground">{diasHastaTope < 1 ? "menos de un día" : `${Math.round(diasHastaTope)} ${Math.round(diasHastaTope) === 1 ? "día" : "días"}`}</b>, antes de la fecha: si querés cubrir toda la semana, espaciá más las fotos.</>}
                        </p>
                    )}
                </CajonSeccion>
            </CajonContenido>
        </Cajon>
    );
}

/** Cuántas horas por día abarca una franja, incluida la que cruza medianoche. */
function horasDe(h: NonNullable<Horario>): number {
    const m = (x: string) => Number(x.slice(0, 2)) * 60 + Number(x.slice(3, 5));
    const d = (m(h.hasta) - m(h.desde) + 1440) % 1440;
    return (d || 1440) / 60;
}
