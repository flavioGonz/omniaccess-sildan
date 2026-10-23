"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowRightLeft, Ban, Camera, Check, CheckCircle2, CircleDot, CircleHelp, Clock, Flame, Hand, History, Info, ListChecks, Loader2, MessageSquareText, Phone, RotateCcw, ShieldAlert, ShieldCheck, ShieldOff, Siren, SkipForward, Timer, UserRound, Users, Wrench, X } from "lucide-react";
import { Pista } from "@/components/ui/pista";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Estado } from "@/components/ui/celdas";
import { ChipPrioridad } from "@/components/alarmas/MensajesCentrales";
import { Actividad, type EventoActividad } from "@/components/alarmas/GestionEnVivo";
import { useTiempoReal } from "@/lib/tiempo-real";
import { nivel } from "@/lib/centrales/prioridades";
import { MOTIVO_SALTEO_MINIMO, TEXTO_MINIMO, obligatoriosFaltantes, origenProcedimiento, segATexto, type Cierre, type EventoCentral, type Procedimiento } from "@/lib/centrales/tratamiento-tipos";
import type { PasoGestion } from "@/lib/gestion-alarma-texto";
import { cn } from "@/lib/utils";
import { IlustracionEvento } from "@/components/centrales/IlustracionEvento";
import { VerificacionVideo, type CamVerif, type OrigenVerif } from "@/components/centrales/VerificacionVideo";

/**
 * La ficha de un evento de central de alarma (22/10, Nico: «similar a la de Intrusión pero con cosas
 * particulares: un botón TRATAR EVENTO que obligue a anotar algo —usuario probando, falsa alarma; robo
 * confirmado, se llamó a la policía—. Un evento de intrusión de una alarma necesita una intervención
 * humana, incluso para llamar a la policía. Tomar el evento con mejor lógica de asignación y auditoría»).
 *
 * Arriba, qué pasó y qué tan urgente es (el color es el de su prioridad). A la izquierda, lo que ayuda a
 * decidir: las cámaras de la zona y lo que hizo la central alrededor (¿se desarmó enseguida? ¿se
 * restauró sola?). A la derecha, la gestión, en el orden en que se hace: quién lo tiene, los pasos
 * del procedimiento de su prioridad, y TRATAR, que pide cómo se cerró y qué se hizo. Abajo, la
 * actividad completa con quién y cuándo.
 *
 * Exclusivo: sólo quien lo tiene trata o tilda. Quitárselo a otro pide escribir por qué. Lo controla
 * el servidor (lib/centrales/tratamiento); acá sólo se ofrece lo que se puede.
 */

type Ficha = {
    evento: EventoCentral;
    contexto: { id: string; ts: string; eventos: { categoria: string; texto: string; zona?: number | null; usuario?: number | null }[]; esEste: boolean }[];
    pasos: PasoGestion[]; cierres: Cierre[]; procedimiento: Procedimiento;
    /** Las cámaras de la verificación (zona → área → abonado) y las otras del abonado. */
    video?: { camaras: CamVerif[]; otras: CamVerif[] } & OrigenVerif;
};

const hora = (iso: string) => new Date(iso).toLocaleTimeString("es-UY", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZone: "America/Montevideo" });
const hace = (iso: string) => { const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000)); return s < 60 ? `hace ${s} s` : s < 3600 ? `hace ${Math.round(s / 60)} min` : `hace ${Math.round(s / 3600)} h`; };
const ICONO_CAT: Record<string, typeof Siren> = { ALARMA: Siren, RESTAURACION: RotateCcw, ARMADO: ShieldCheck, DESARMADO: ShieldOff, FALLA: Wrench, FALLA_FIN: Wrench };
/** El color de cada prioridad (los tonos de estado: P1 rojo, P2-P3 ámbar, P4 info, P5 quieto). */
const COLOR_PRIO: Record<number, string> = { 1: "var(--mal)", 2: "var(--aviso)", 3: "var(--aviso)", 4: "var(--info)", 5: "var(--quieto)" };
/** Un ícono para cada paso, por lo que dice: se reconoce de un vistazo qué hay que hacer. */
const iconoPaso = (t: string) => /c[aá]mara|video|mirar/i.test(t) ? Camera : /bomber|incendio|fuego/i.test(t) ? Flame : /llam|tel[eé]f|contact|titular|polic|911|emergenc/i.test(t) ? Phone : /guardia|m[oó]vil|enviar/i.test(t) ? Users : CircleDot;
const ICONO_RESULTADO = { falsa: Ban, real: ShieldAlert, otro: CircleHelp } as const;
const ROTULO_RESULTADO = { falsa: "Falsa alarma", real: "Real", otro: "Otro" } as const;
const RESULTADO: Record<string, { rotulo: string; tono: "mal" | "quieto" | "info" }> = { real: { rotulo: "Real", tono: "mal" }, falsa: { rotulo: "Falsa", tono: "quieto" }, otro: { rotulo: "Otro", tono: "info" } };

async function pedir(url: string, cuerpo?: unknown) {
    const r = await fetch(url, cuerpo ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(cuerpo) } : { cache: "no-store" });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j?.ok) throw new Error(j?.error || `HTTP ${r.status}`);
    return j;
}

export function FichaEventoCentral({ id, abierta, alCerrar }: { id: string | null; abierta: boolean; alCerrar: () => void }) {
    const [f, setF] = useState<Ficha | null>(null);
    const [error, setError] = useState<string | null>(null);
    const leer = useCallback(() => { if (id) pedir(`/api/centrales/eventos/${id}`).then((j) => { setF(j); setError(null); }).catch((e) => setError(e.message)); }, [id]);
    useEffect(() => { setF(null); setError(null); leer(); }, [leer]);
    useTiempoReal("alarma_gestion", (x: any) => { if (!x?.clave || x.clave === `d:${id}`) leer(); });
    useTiempoReal("central_tratado", (x: any) => { if (x?.id === id) leer(); });
    const [, tic] = useState(0);
    useEffect(() => { const iv = setInterval(() => tic((n) => n + 1), 5000); return () => clearInterval(iv); }, []);

    const ev = f?.evento;
    const color = ev ? COLOR_PRIO[ev.prioridad] || "var(--quieto)" : "var(--border)";
    return (
        <Dialog open={abierta && !!id} onOpenChange={(o) => { if (!o) alCerrar(); }}>
            <DialogContent showCloseButton={false} onOpenAutoFocus={(e) => e.preventDefault()} className="p-0 gap-0 border-0 rounded-[14px] sm:max-w-[1200px] h-[90vh] max-h-[90vh] overflow-hidden flex flex-col">
                <DialogTitle className="sr-only">Evento de central</DialogTitle>
                {/*
                  * Cabecera en una sola fila (23/10, Nico: «ocupa mucho espacio la franja roja arriba»). Era un
                  * bloque de ~100 px pintado entero del color de la prioridad; ahora la prioridad es una franja
                  * fina arriba y una pastilla, y lo que se lee es qué pasó, dónde y hace cuánto.
                  */}
                <header className="shrink-0 relative flex items-center gap-3 pl-5 pr-3 h-[60px] bg-card">
                    <span className="absolute top-0 inset-x-0 h-[3px]" style={{ background: color }} aria-hidden />
                    <span className={cn("grid place-items-center w-9 h-9 rounded-[10px] shrink-0 text-white", ev?.prioridad === 1 && !ev.tratado && "animate-pulse")} style={{ background: color }}><Siren size={18} /></span>
                    {!ev ? <div className="text-[14px] font-semibold text-muted-foreground">{error || "Cargando…"}</div> : (<>
                        <Pista titulo={`Prioridad ${ev.prioridad} · ${nivel(ev.prioridad).nombre}`} texto="La prioridad sale de la clase del evento (Ajustes → Centrales de alarma). P1 y P2 abren esta ventana con sonido en cualquier pantalla y se escalan si nadie las toma." lado="abajo" ancho={300}>
                            <span className="shrink-0 inline-flex items-center h-6 px-2 rounded-full text-[11px] font-bold uppercase tracking-[0.08em] text-white cursor-help" style={{ background: color }}>P{ev.prioridad} · {nivel(ev.prioridad).nombre}</span>
                        </Pista>
                        <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 min-w-0">
                                <h2 className="text-[16px] font-bold tracking-tight truncate">{ev.titulo}</h2>
                                {ev.central.prueba && <Pista texto="Central de prueba (el simulador): no dispara reglas ni avisos, y no se escala." lado="abajo"><span className="shrink-0 inline-flex items-center h-5 px-1.5 rounded text-[10.5px] font-semibold chip-quieto border cursor-help">de prueba</span></Pista>}
                                {ev.escalado && <Pista titulo="Escalado" texto={ev.escalado} lado="abajo"><span className="shrink-0 inline-flex items-center gap-1 h-5 px-1.5 rounded text-[10.5px] font-bold pleno-mal cursor-help"><AlertTriangle size={11} /> Escalado</span></Pista>}
                            </div>
                            <div className="text-[12px] text-muted-foreground truncate tabular-nums">
                                {[ev.central.nombre, `cuenta ${ev.central.cuenta}`, ev.area, ev.particion ? `partición ${ev.particion}` : null].filter(Boolean).join(" · ")}
                            </div>
                        </div>
                        <Pista texto={`Llegó a las ${hora(ev.ts)}.`} lado="abajo">
                            <span className="shrink-0 inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg bg-muted text-[12.5px] font-semibold tabular-nums cursor-help"><Clock size={13} className="text-muted-foreground" /> {hora(ev.ts)} <span className="text-muted-foreground font-normal">· {hace(ev.ts)}</span></span>
                        </Pista>
                    </>)}
                    <Pista texto="Cerrar la ficha no trata el evento: sigue pendiente abajo, en los avisos." lado="izquierda">
                        <button type="button" onClick={alCerrar} aria-label="Cerrar" className="w-9 h-9 rounded-lg grid place-items-center shrink-0 text-muted-foreground hover:text-foreground hover:bg-accent"><X size={18} /></button>
                    </Pista>
                </header>

                {ev && f && (
                    <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_440px] overflow-y-auto lg:overflow-hidden">
                        {/* Lo que ayuda a decidir: qué pasó, el video y lo que hizo la central alrededor. Sin marcos: superficie y aire. */}
                        <div className="min-h-0 lg:overflow-y-auto px-5 pt-4 pb-6 space-y-6">
                            {/* La misma escena del detalle de Centrales (23/10, Nico: «estandarizar las animaciones»). */}
                            <IlustracionEvento key={ev.id} evento={{ categoria: "ALARMA", tipo: ev.tipo, texto: ev.titulo }} alto={170}
                                className="rounded-[12px] overflow-hidden bg-muted/40 pb-2" />
                            <section>
                                <Titulo icono={Camera} texto="Video verificación" pista="En vivo al abrir. «Ver el momento» reproduce la grabación desde unos segundos antes del evento (Ajustes → Video del evento). Las cámaras salen de la zona; si no tiene, de su área; si tampoco, del abonado."
                                    derecha={f.video && f.video.camaras.length ? <span className="text-muted-foreground">{f.video.origen === "zona" ? "Cámaras de la zona" : f.video.origen === "area" ? `Cámaras del área ${f.video.area || ""}` : "Cámaras del abonado"}</span> : null} />
                                {/* Video verificación (23/10): en vivo al abrir, y «Ver el momento» con la grabación. */}
                                <VerificacionVideo eventoId={ev.id} instanteMs={new Date(ev.ts).getTime()} camaras={f.video?.camaras || []} otras={f.video?.otras || []} />
                            </section>
                            <Contexto f={f} />
                        </div>
                        {/*
                          * La gestión, como un panel lateral bien marcado (23/10, Nico: «el slide derecho bien
                          * marcado»): otra superficie, una línea firme a la izquierda, y TRATAR fijo abajo.
                          */}
                        <aside className="min-h-0 flex flex-col bg-[color-mix(in_oklab,var(--muted),var(--foreground)_4%)] border-t lg:border-t-0 lg:border-l-2 border-border">
                            {ev.tratado
                                ? <div className="flex-1 min-h-0 overflow-y-auto p-5 space-y-6"><Tratado ev={ev} /><Tiempos ev={ev} /><Bitacora ev={ev} f={f} /></div>
                                : <Gestion ev={ev} f={f} alHecho={leer} debajo={<><Tiempos ev={ev} /><Bitacora ev={ev} f={f} /></>} />}
                        </aside>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}

/** El título de una parte de la ficha: ícono, rótulo y, si hace falta, la explicación al pasar. */
function Titulo({ icono: Ic, texto, pista, derecha }: { icono: typeof Siren; texto: string; pista?: string; derecha?: React.ReactNode }) {
    return (
        <div className="flex items-center gap-1.5 mb-2.5 text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
            <Ic size={13} />
            <span>{texto}</span>
            {pista && <Pista texto={pista} lado="arriba" ancho={300}><Info size={12} className="opacity-60 hover:opacity-100 cursor-help" /></Pista>}
            {derecha && <span className="ml-auto normal-case tracking-normal font-semibold">{derecha}</span>}
        </div>
    );
}

/** Cuánto tardó en tomarse y en tratarse, desde la hora del evento. */
function Tiempos({ ev }: { ev: EventoCentral }) {
    return (
        <section>
            <Titulo icono={Timer} texto="Tiempos" pista="Desde la hora del evento. Cuentan para el informe de tiempos por operador (Gestión de alarmas → Centrales → Tiempos)." />
            <div className="grid grid-cols-2 gap-2">
                <div className="rounded-[10px] bg-background px-3 py-2"><div className="text-[11px] text-muted-foreground flex items-center gap-1"><Hand size={11} /> Se tomó a los</div><div className="font-bold tabular-nums text-[15px]">{segATexto(ev.tiempos.tomarSeg)}</div></div>
                <div className="rounded-[10px] bg-background px-3 py-2"><div className="text-[11px] text-muted-foreground flex items-center gap-1"><CheckCircle2 size={11} /> Se trató a los</div><div className="font-bold tabular-nums text-[15px]">{ev.tratado ? segATexto(ev.tiempos.tratarSeg) : <span className="text-muted-foreground font-semibold">sin tratar</span>}</div></div>
            </div>
        </section>
    );
}

function Bitacora({ ev, f }: { ev: EventoCentral; f: Ficha }) {
    return (
        <section>
            {/* Actividad trae su propio título. */}
            <Actividad pasos={f.pasos} inicio={[{ id: `o:${ev.id}`, ts: ev.ts, por: ev.central.nombre, texto: `reportó ${ev.titulo.toLowerCase()}`, tipo: "origen" } as EventoActividad]} />
        </section>
    );
}

/** Lo que mandó la central media hora antes y después: dice si se desarmó, se restauró o disparó otra zona. */
function Contexto({ f }: { f: Ficha }) {
    return (
        <section>
            <Titulo icono={History} texto="La central, ±30 min" pista="Lo que mandó esta central media hora antes y después del evento. Ayuda a decidir: ¿se desarmó enseguida (un usuario que entró)? ¿se restauró sola? ¿disparó otra zona?" />
            {!f.contexto.length ? <p className="text-[12.5px] text-muted-foreground">Sin otros mensajes alrededor.</p> : (
                <ol className="space-y-1">
                    {f.contexto.map((m) => {
                        const e = m.eventos[0];
                        const I = (e && ICONO_CAT[e.categoria]) || CircleHelp;
                        return (
                            <li key={m.id} className={cn("flex items-center gap-2.5 rounded-md px-2 py-1.5 text-[12.5px]", m.esEste ? "bg-[color-mix(in_oklab,var(--mal)_12%,transparent)] font-semibold" : "")}>
                                <span className="tabular-nums text-muted-foreground w-[62px] shrink-0">{hora(m.ts)}</span>
                                <I size={14} className={cn("shrink-0", e?.categoria === "ALARMA" ? "tono-mal" : "text-muted-foreground")} />
                                <span className="min-w-0 truncate">{e ? e.texto : "—"}{e?.zona ? ` · zona ${e.zona}` : ""}{e?.usuario ? ` · usuario ${e.usuario}` : ""}{m.eventos.length > 1 ? ` · y ${m.eventos.length - 1} más` : ""}</span>
                                {m.esEste && <span className="ml-auto text-[10.5px] uppercase tracking-wider tono-mal">este</span>}
                            </li>
                        );
                    })}
                </ol>
            )}
        </section>
    );
}

function Tratado({ ev }: { ev: EventoCentral }) {
    const r = RESULTADO[ev.tratado?.resultado || "otro"] || RESULTADO.otro;
    return (
        <div className="rounded-[12px] chip-bien px-4 py-3 space-y-1.5">
            <div className="flex items-center gap-2 text-[13.5px] font-semibold"><CheckCircle2 size={16} /> Tratado por {ev.tratado?.por || "—"}<span className="ml-auto"><Estado tono={r.tono}>{r.rotulo}</Estado></span></div>
            <div className="text-[13px]">{ev.tratado?.cierre}</div>
            {ev.tratado?.texto && <div className="text-[12.5px] opacity-85">«{ev.tratado.texto}»</div>}
            <div className="text-[11.5px] opacity-75 tabular-nums">{ev.tratado && `${hora(ev.tratado.ts)} · ${hace(ev.tratado.ts)}`}</div>
        </div>
    );
}

/**
 * La gestión del evento, en el panel lateral: arriba quién lo tiene, en el medio el procedimiento (y el
 * formulario de tratar cuando se abre), los tiempos y la actividad, y abajo, fijo, el botón que lo termina.
 */
function Gestion({ ev, f, alHecho, debajo }: { ev: EventoCentral; f: Ficha; alHecho: () => void; debajo?: React.ReactNode }) {
    const [ocupado, setOcupado] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [quitando, setQuitando] = useState(false);
    const [motivo, setMotivo] = useState("");
    const [pasando, setPasando] = useState(false);
    const [nota, setNota] = useState("");
    const [tratando, setTratando] = useState(false);
    const [cierre, setCierre] = useState<string | null>(null);
    const [texto, setTexto] = useState("");
    const mio = ev.operador.soyYo;
    const deOtro = !!ev.operador.nombre && !mio;
    // El procedimiento con que se abrió el evento (guardado con él): el de su clase o el de su prioridad.
    const pasos = ev.procedimiento?.pasos || [];
    const faltan = obligatoriosFaltantes(pasos, ev.pasos, ev.salteos || {});
    const [salteando, setSalteando] = useState<string | null>(null);
    const [motivoSalteo, setMotivoSalteo] = useState("");

    const accion = async (clave: string, cuerpo: Record<string, unknown>, despues?: () => void) => {
        setOcupado(clave); setError(null);
        try { await pedir(`/api/centrales/eventos/${ev.id}`, cuerpo); despues?.(); alHecho(); }
        catch (e: any) { setError(e?.message || "No se pudo."); }
        finally { setOcupado(null); }
    };
    const porResultado = useMemo(() => ({ falsa: f.cierres.filter((c) => c.resultado === "falsa"), real: f.cierres.filter((c) => c.resultado === "real"), otro: f.cierres.filter((c) => c.resultado === "otro") }), [f.cierres]);
    const listo = !!cierre && texto.trim().length >= TEXTO_MINIMO;

    const hechos = pasos.filter((x) => ev.pasos[x.texto] || ev.salteos?.[x.texto]).length;
    const entrada = "flex-1 h-9 rounded-[8px] px-3 text-[12.5px] bg-background border border-border outline-none focus:ring-2 focus:ring-[var(--accion)]/40";

    return (
        <>
            {/* Quién lo tiene. */}
            <div className="shrink-0 px-5 pt-4 pb-3">
                <div className="flex items-center gap-2.5">
                    <span className={cn("grid h-9 w-9 place-items-center rounded-full shrink-0", ev.operador.nombre ? "bg-[var(--accion)] text-white" : "bg-background text-muted-foreground")}><UserRound size={16} /></span>
                    <div className="min-w-0 flex-1 leading-tight">
                        <div className="text-[13.5px] font-semibold truncate">{mio ? "Lo estás atendiendo vos" : deOtro ? `Lo tiene ${ev.operador.nombre}` : "Nadie lo tomó"}</div>
                        <div className="text-[11.5px] text-muted-foreground">{ev.operador.desde ? `desde ${hora(ev.operador.desde)} · ${hace(ev.operador.desde)}` : "Sin tomar: cualquiera lo puede tomar"}</div>
                    </div>
                    {mio ? (
                        <Pista texto="Se lo pasás a otro operador; podés dejarle una nota. Queda en la bitácora." lado="abajo"><Button size="sm" variant="outline" onClick={() => setPasando((v) => !v)} disabled={!!ocupado} className="gap-1.5 bg-background"><ArrowRightLeft size={13} /> Pasar</Button></Pista>
                    ) : deOtro ? (
                        <Pista texto={`Lo tiene ${ev.operador.nombre}. Para tomarlo hay que escribir por qué; queda en la auditoría con su nombre.`} lado="abajo"><Button size="sm" variant="outline" onClick={() => setQuitando((v) => !v)} disabled={!!ocupado} className="gap-1.5 bg-background"><Hand size={13} /> Quitárselo</Button></Pista>
                    ) : (
                        <Pista titulo="Tomar el evento" texto="Mientras lo tengas, sólo vos podés seguir el procedimiento y tratarlo. Si no se toma a tiempo, se escala." lado="abajo" ancho={280}>
                            <Button size="sm" onClick={() => accion("tomar", { accion: "tomar" })} disabled={!!ocupado} className="gap-1.5">{ocupado === "tomar" ? <Loader2 size={13} className="animate-spin" /> : <Hand size={13} />} Tomar evento</Button>
                        </Pista>
                    )}
                </div>
                {quitando && (
                    <div className="mt-3 space-y-1.5">
                        <div className="flex gap-2">
                            <input autoFocus value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Por qué (p. ej. no contesta, terminó el turno)" maxLength={300} className={entrada} />
                            <Button size="sm" onClick={() => accion("tomar", { accion: "tomar", motivo }, () => { setQuitando(false); setMotivo(""); })} disabled={motivo.trim().length < 4 || !!ocupado}>Quitárselo</Button>
                        </div>
                        <p className="text-[11.5px] text-muted-foreground">Queda en la auditoría que se lo quitaste a {ev.operador.nombre}, con el motivo.</p>
                    </div>
                )}
                {pasando && (
                    <div className="mt-3 flex gap-2">
                        <input autoFocus value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Qué dejarle dicho al compañero (opcional)" maxLength={500} className={entrada} />
                        <Button size="sm" onClick={() => accion("pasar", { accion: "pasar", nota }, () => { setPasando(false); setNota(""); })} disabled={!!ocupado}>Pasarlo</Button>
                    </div>
                )}
            </div>
            <div className="shrink-0 h-px bg-border mx-5" />

            <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-6">
                {/* El procedimiento (23/10, openspec alarmas-como-funciones): de su clase o de su prioridad,
                    con los pasos obligatorios marcados. Un obligatorio se tilda o se saltea escribiendo por qué. */}
                {pasos.length > 0 && !tratando && (
                    <section>
                        <Titulo icono={ListChecks} texto={ev.procedimiento ? origenProcedimiento(ev.procedimiento) : "Procedimiento"}
                            pista="Los pasos de actuación de este evento (Ajustes → Centrales de alarma → Procedimiento). Cada tilde queda con tu nombre y la hora. Un paso obligatorio se hace, o se saltea escribiendo por qué; sin eso no se puede tratar."
                            derecha={<span className="tabular-nums text-foreground">{hechos}/{pasos.length}</span>} />
                        <div className="h-1 rounded-full bg-background overflow-hidden mb-3"><div className="h-full rounded-full bg-[var(--bien)] transition-[width] duration-500" style={{ width: `${Math.round((hechos / pasos.length) * 100)}%` }} /></div>
                        <ul className="space-y-1.5">
                            {pasos.map((paso) => {
                                const p = paso.texto;
                                const hecho = ev.pasos[p];
                                const salteo = ev.salteos?.[p];
                                const Ic = iconoPaso(p);
                                return (
                                    <li key={p} className={cn("rounded-[10px] transition-colors", hecho ? "bg-[var(--bien-suave)]" : salteo ? "bg-[var(--aviso-suave)]" : "bg-background")}>
                                        <div className={cn("flex items-center gap-1 pr-1.5", !mio && "opacity-75")}>
                                            <Pista texto={!mio ? "Tomá el evento para seguir el procedimiento." : hecho || salteo ? "Deshacer: vuelve a quedar pendiente." : "Marcar como hecho: queda con tu nombre y la hora."} lado="izquierda" className="flex-1 min-w-0">
                                                <button type="button" disabled={!mio || !!ocupado} onClick={() => accion(`paso:${p}`, { accion: "paso", paso: p, hecho: !(hecho || salteo) })}
                                                    className={cn("w-full flex items-start gap-2.5 px-3 py-2.5 text-left text-[13px]", mio ? "cursor-pointer" : "cursor-not-allowed")}>
                                                    <span className={cn("mt-px grid h-[22px] w-[22px] place-items-center rounded-full shrink-0", hecho ? "pleno-bien" : salteo ? "pleno-aviso" : "bg-muted text-muted-foreground")}>
                                                        {hecho ? <Check size={13} /> : salteo ? <SkipForward size={12} /> : <Ic size={12} />}
                                                    </span>
                                                    <span className="min-w-0 flex-1">
                                                        <span className={cn("font-medium", (hecho || salteo) && "line-through opacity-70")}>{p}</span>
                                                        {paso.obligatorio && !hecho && !salteo && <span className="ml-1.5 align-middle inline-flex items-center rounded px-1 py-px text-[9.5px] font-bold uppercase tracking-wider chip-aviso border">obligatorio</span>}
                                                        {hecho && <span className="block text-[11px] text-muted-foreground tabular-nums">{hecho.por} · {hora(hecho.ts)}</span>}
                                                        {salteo && <span className="block text-[11px] text-[var(--aviso-texto)]">Salteado por {salteo.por} · {hora(salteo.ts)}: «{salteo.motivo}»</span>}
                                                    </span>
                                                </button>
                                            </Pista>
                                            {mio && !hecho && !salteo && (
                                                <Pista texto="No se hizo: escribí por qué. Queda en la auditoría y cuenta como resuelto para poder tratar." lado="izquierda">
                                                    <button type="button" onClick={() => { setSalteando(salteando === p ? null : p); setMotivoSalteo(""); }} disabled={!!ocupado}
                                                        className="shrink-0 h-7 px-2 rounded-md text-[11.5px] font-semibold text-muted-foreground hover:text-foreground hover:bg-accent inline-flex items-center gap-1"><SkipForward size={12} /> Saltear</button>
                                                </Pista>
                                            )}
                                        </div>
                                        {salteando === p && (
                                            <div className="px-3 pb-2.5 flex gap-2">
                                                <input autoFocus value={motivoSalteo} onChange={(e) => setMotivoSalteo(e.target.value)} placeholder="Por qué se saltea" maxLength={300} className={entrada} />
                                                <Button size="sm" onClick={() => accion(`salteo:${p}`, { accion: "saltear", paso: p, motivo: motivoSalteo }, () => { setSalteando(null); setMotivoSalteo(""); })}
                                                    disabled={motivoSalteo.trim().length < MOTIVO_SALTEO_MINIMO || !!ocupado}>Saltear</Button>
                                            </div>
                                        )}
                                    </li>
                                );
                            })}
                        </ul>
                    </section>
                )}

                {/* Tratar: cómo se cerró + qué se hizo. Es lo único que lo termina. */}
                {tratando && (
                    <section className="space-y-4">
                        <Titulo icono={CheckCircle2} texto="Tratar el evento" pista="Elegí cómo terminó y contá qué se hizo. El resultado (falsa, real u otro) cuenta en los informes. Es lo único que da el evento por terminado en todas las pantallas." />
                        {(["falsa", "real", "otro"] as const).map((g) => {
                            if (!porResultado[g].length) return null;
                            const Ic = ICONO_RESULTADO[g];
                            return (
                                <div key={g}>
                                    <div className={cn("flex items-center gap-1.5 text-[11.5px] font-semibold mb-1.5", g === "real" ? "tono-mal" : "text-muted-foreground")}><Ic size={13} /> {ROTULO_RESULTADO[g]}</div>
                                    <div className="space-y-1">
                                        {porResultado[g].map((c) => (
                                            <label key={c.id} className={cn("flex items-center gap-2.5 rounded-[10px] px-3 py-2.5 text-[12.5px] cursor-pointer transition-colors", cierre === c.id ? "bg-[color-mix(in_oklab,var(--accion)_12%,var(--background))] ring-2 ring-[var(--accion)]" : "bg-background hover:bg-accent")}>
                                                <input type="radio" name="cierre" checked={cierre === c.id} onChange={() => setCierre(c.id)} className="accent-[var(--accion)]" />
                                                {c.texto}
                                            </label>
                                        ))}
                                    </div>
                                </div>
                            );
                        })}
                        <div>
                            <div className="flex items-center gap-1.5 text-[11.5px] font-semibold text-muted-foreground mb-1.5"><MessageSquareText size={13} /> Qué se hizo</div>
                            <textarea value={texto} onChange={(e) => setTexto(e.target.value)} rows={3} maxLength={1000}
                                placeholder="Qué se hizo y con quién se habló. P. ej.: Llamé al titular, estaba probando el sistema."
                                className="w-full rounded-[10px] px-3 py-2 text-[12.5px] bg-background border border-border outline-none focus:ring-2 focus:ring-[var(--accion)]/40 resize-y" />
                            <div className="text-[11px] text-muted-foreground mt-0.5">{texto.trim().length < TEXTO_MINIMO ? `Al menos ${TEXTO_MINIMO} letras.` : "Queda en la bitácora con tu nombre y la hora."}</div>
                        </div>
                    </section>
                )}
                {!tratando && debajo}
            </div>

            {/* Abajo, fijo: lo que termina el evento. */}
            <div className="shrink-0 border-t border-border bg-card px-5 py-3 space-y-2">
                {error && <div className="rounded-[8px] chip-mal px-3 py-2 text-[12.5px]">{error}</div>}
                {!tratando ? (
                    <>
                        {faltan.length > 0 && !deOtro && (
                            <p className="text-[12px] text-[var(--aviso-texto)] flex items-start gap-1.5"><AlertTriangle size={13} className="mt-0.5 shrink-0" /> <span>Falta{faltan.length > 1 ? "n" : ""} {faltan.map((x) => `«${x}»`).join(", ")}: hacelo{faltan.length > 1 ? "s" : ""} o salteálo{faltan.length > 1 ? "s" : ""} escribiendo por qué.</span></p>
                        )}
                        <Button className="w-full h-11 text-[14px] font-bold gap-2" onClick={() => setTratando(true)} disabled={deOtro || !!ocupado || faltan.length > 0}
                            title={deOtro ? `Lo tiene ${ev.operador.nombre}: quitáselo primero` : undefined}>
                            <CheckCircle2 size={17} /> TRATAR EVENTO
                        </Button>
                    </>
                ) : (
                    <div className="flex gap-2">
                        <Button variant="outline" className="h-11" onClick={() => setTratando(false)} disabled={!!ocupado}>Cancelar</Button>
                        <Button className="flex-1 h-11 text-[14px] font-bold gap-2" disabled={!listo || !!ocupado} onClick={() => accion("tratar", { accion: "tratar", cierre, texto })}>
                            {ocupado === "tratar" ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} Tratar y cerrar
                        </Button>
                    </div>
                )}
            </div>
        </>
    );
}

export { abrirEventoCentral } from "@/lib/centrales/abrir-evento";
