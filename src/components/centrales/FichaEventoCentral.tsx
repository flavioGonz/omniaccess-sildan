"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowRightLeft, Camera, Check, CheckCircle2, CircleHelp, Clock, Hand, Loader2, RotateCcw, ShieldCheck, ShieldOff, Siren, UserRound, Wrench, X } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Estado } from "@/components/ui/celdas";
import { ChipPrioridad } from "@/components/alarmas/MensajesCentrales";
import { Actividad, type EventoActividad } from "@/components/alarmas/GestionEnVivo";
import { useTiempoReal } from "@/lib/tiempo-real";
import { nivel } from "@/lib/centrales/prioridades";
import { TEXTO_MINIMO, segATexto, type Cierre, type EventoCentral, type Procedimiento } from "@/lib/centrales/tratamiento-tipos";
import type { PasoGestion } from "@/lib/gestion-alarma-texto";
import { cn } from "@/lib/utils";

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
};

const hora = (iso: string) => new Date(iso).toLocaleTimeString("es-UY", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZone: "America/Montevideo" });
const hace = (iso: string) => { const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000)); return s < 60 ? `hace ${s} s` : s < 3600 ? `hace ${Math.round(s / 60)} min` : `hace ${Math.round(s / 3600)} h`; };
const ICONO_CAT: Record<string, typeof Siren> = { ALARMA: Siren, RESTAURACION: RotateCcw, ARMADO: ShieldCheck, DESARMADO: ShieldOff, FALLA: Wrench, FALLA_FIN: Wrench };
const FONDO_PRIO: Record<number, string> = { 1: "var(--mal)", 2: "var(--aviso)" };
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
    const fondo = ev ? FONDO_PRIO[ev.prioridad] : undefined;
    return (
        <Dialog open={abierta && !!id} onOpenChange={(o) => { if (!o) alCerrar(); }}>
            <DialogContent showCloseButton={false} className="p-0 gap-0 sm:max-w-[1100px] max-h-[92vh] overflow-hidden flex flex-col">
                <DialogTitle className="sr-only">Evento de central</DialogTitle>
                {/* Cabecera: el color es el de la prioridad (P1 rojo, P2 ámbar); de P3 para abajo, la superficie. */}
                <div className={cn("shrink-0 px-6 py-4 flex items-start gap-4", !fondo && "border-b border-border")} style={fondo ? { background: fondo, color: ev!.prioridad === 1 ? "#fff" : "#16120a" } : undefined}>
                    <span className={cn("grid place-items-center w-11 h-11 rounded-[10px] shrink-0", fondo ? "bg-black/15" : "bg-muted/60 tono-mal", ev?.prioridad === 1 && !ev.tratado && "animate-pulse")}><Siren size={22} /></span>
                    <div className="min-w-0 flex-1">
                        {!ev ? <div className="text-[15px] font-semibold">{error || "Cargando…"}</div> : (<>
                            <div className="flex items-center gap-2 flex-wrap text-[11px] font-bold uppercase tracking-[0.14em] opacity-85">
                                <span>P{ev.prioridad} · {nivel(ev.prioridad).nombre}</span><span>·</span><span>Central de alarma</span>
                                {ev.central.prueba && <span className="rounded px-1.5 py-0.5 bg-black/15 normal-case tracking-normal">de prueba</span>}
                            </div>
                            <div className="text-[20px] font-bold tracking-tight leading-tight mt-0.5">{ev.titulo}</div>
                            <div className="text-[12.5px] opacity-85 mt-1 tabular-nums">
                                {[ev.central.nombre, `cuenta ${ev.central.cuenta}`, ev.area, ev.particion ? `partición ${ev.particion}` : null].filter(Boolean).join(" · ")}
                                {" · "}{hora(ev.ts)} · {hace(ev.ts)}
                            </div>
                            {ev.escalado && <div className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-black/20 px-2 py-1 text-[12px] font-semibold"><AlertTriangle size={13} /> Escalado: {ev.escalado}</div>}
                        </>)}
                    </div>
                    <button type="button" onClick={alCerrar} aria-label="Cerrar" title="Cerrar (queda pendiente abajo)" className={cn("w-8 h-8 rounded-md grid place-items-center shrink-0", fondo ? "hover:bg-black/15" : "text-muted-foreground hover:bg-accent")}><X size={17} /></button>
                </div>

                {ev && f && (
                    <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[1fr_420px] lg:divide-x divide-border overflow-y-auto lg:overflow-hidden">
                        <div className="min-h-0 lg:overflow-y-auto p-5 space-y-5">
                            <Camaras ev={ev} />
                            <Contexto f={f} />
                        </div>
                        <div className="min-h-0 lg:overflow-y-auto p-5 space-y-5">
                            {ev.tratado ? <Tratado ev={ev} /> : <Gestion ev={ev} f={f} alHecho={leer} />}
                            <div className="rounded-[10px] border border-border px-3 py-2.5 grid grid-cols-2 gap-2 text-[12px]">
                                <div><div className="text-muted-foreground flex items-center gap-1"><Hand size={12} /> Se tomó a los</div><div className="font-semibold tabular-nums text-[13px]">{segATexto(ev.tiempos.tomarSeg)}</div></div>
                                <div><div className="text-muted-foreground flex items-center gap-1"><Clock size={12} /> Se trató a los</div><div className="font-semibold tabular-nums text-[13px]">{ev.tratado ? segATexto(ev.tiempos.tratarSeg) : "sin tratar"}</div></div>
                            </div>
                            <Actividad pasos={f.pasos} inicio={[{ id: `o:${ev.id}`, ts: ev.ts, por: ev.central.nombre, texto: `reportó ${ev.titulo.toLowerCase()}`, tipo: "origen" } as EventoActividad]} />
                        </div>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}

/** Las cámaras de la zona: una foto que se refresca cada 5 s. Sin cámaras, se dice dónde asignarlas. */
function Camaras({ ev }: { ev: EventoCentral }) {
    const [t, setT] = useState(() => Date.now());
    useEffect(() => { const iv = setInterval(() => setT(Date.now()), 5000); return () => clearInterval(iv); }, []);
    const cams = ev.zona?.camaras || [];
    return (
        <section>
            <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground mb-2 flex items-center gap-1.5"><Camera size={12} /> Cámaras de la zona</div>
            {!cams.length ? (
                <div className="rounded-[10px] border border-dashed border-border px-4 py-5 text-[12.5px] text-muted-foreground">
                    {ev.zona ? <>La zona {ev.zona.zona} no tiene cámaras asignadas. Se asignan en Dispositivos › la central › Zonas, y desde entonces la foto aparece acá.</> : "El evento no trae zona."}
                </div>
            ) : (
                <div className={cn("grid gap-2", cams.length > 1 && "grid-cols-2")}>
                    {cams.slice(0, 4).map((c) => (
                        <div key={c} className="relative aspect-video rounded-[10px] overflow-hidden bg-muted">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={`/api/snapshot/${c}?t=${Math.floor(t / 5000)}`} alt="" className="absolute inset-0 w-full h-full object-cover" />
                            <span className="absolute left-2 top-2 rounded bg-black/60 px-1.5 py-0.5 text-[10.5px] font-semibold text-white">AHORA · cada 5 s</span>
                        </div>
                    ))}
                </div>
            )}
        </section>
    );
}

/** Lo que mandó la central media hora antes y después: dice si se desarmó, se restauró o disparó otra zona. */
function Contexto({ f }: { f: Ficha }) {
    return (
        <section>
            <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground mb-2">La central, ±30 min</div>
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
        <div className="rounded-[10px] chip-bien px-4 py-3 space-y-1.5">
            <div className="flex items-center gap-2 text-[13.5px] font-semibold"><CheckCircle2 size={16} /> Tratado por {ev.tratado?.por || "—"}<span className="ml-auto"><Estado tono={r.tono}>{r.rotulo}</Estado></span></div>
            <div className="text-[13px]">{ev.tratado?.cierre}</div>
            {ev.tratado?.texto && <div className="text-[12.5px] opacity-85">«{ev.tratado.texto}»</div>}
            <div className="text-[11.5px] opacity-75 tabular-nums">{ev.tratado && `${hora(ev.tratado.ts)} · ${hace(ev.tratado.ts)}`}</div>
        </div>
    );
}

function Gestion({ ev, f, alHecho }: { ev: EventoCentral; f: Ficha; alHecho: () => void }) {
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
    const pasos = f.procedimiento[String(ev.prioridad) as keyof Procedimiento] || [];

    const accion = async (clave: string, cuerpo: Record<string, unknown>, despues?: () => void) => {
        setOcupado(clave); setError(null);
        try { await pedir(`/api/centrales/eventos/${ev.id}`, cuerpo); despues?.(); alHecho(); }
        catch (e: any) { setError(e?.message || "No se pudo."); }
        finally { setOcupado(null); }
    };
    const porResultado = useMemo(() => ({ falsa: f.cierres.filter((c) => c.resultado === "falsa"), real: f.cierres.filter((c) => c.resultado === "real"), otro: f.cierres.filter((c) => c.resultado === "otro") }), [f.cierres]);
    const listo = !!cierre && texto.trim().length >= TEXTO_MINIMO;

    return (
        <div className="space-y-4">
            {/* Quién lo tiene. */}
            <div className="rounded-[10px] bg-muted/50 px-3 py-2.5">
                <div className="flex items-center gap-2.5">
                    <span className={cn("grid h-8 w-8 place-items-center rounded-full shrink-0", ev.operador.nombre ? "bg-[var(--accion)] text-white" : "bg-muted text-muted-foreground")}><UserRound size={15} /></span>
                    <div className="min-w-0 flex-1 leading-tight">
                        <div className="text-[13px] font-semibold truncate">{mio ? "Lo estás atendiendo vos" : deOtro ? `Lo tiene ${ev.operador.nombre}` : "Nadie lo tomó"}</div>
                        <div className="text-[11px] text-muted-foreground">{ev.operador.desde ? `desde ${hora(ev.operador.desde)} · ${hace(ev.operador.desde)}` : "Tomalo: mientras lo tengas, sólo vos lo podés tratar"}</div>
                    </div>
                    {mio ? <Button size="sm" variant="outline" onClick={() => setPasando((v) => !v)} disabled={!!ocupado} className="gap-1.5"><ArrowRightLeft size={13} /> Pasar</Button>
                        : deOtro ? <Button size="sm" variant="outline" onClick={() => setQuitando((v) => !v)} disabled={!!ocupado} className="gap-1.5"><Hand size={13} /> Quitárselo</Button>
                        : <Button size="sm" onClick={() => accion("tomar", { accion: "tomar" })} disabled={!!ocupado} className="gap-1.5">{ocupado === "tomar" ? <Loader2 size={13} className="animate-spin" /> : <Hand size={13} />} Tomar evento</Button>}
                </div>
                {quitando && (
                    <div className="mt-2.5 space-y-2">
                        <p className="text-[12px] text-muted-foreground">Queda en la auditoría que se lo quitaste a {ev.operador.nombre}, con el motivo.</p>
                        <div className="flex gap-2">
                            <input autoFocus value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Por qué (p. ej. no contesta, terminó el turno)" maxLength={300}
                                className="flex-1 h-9 rounded-[8px] px-3 text-[12.5px] bg-background border border-border outline-none focus:ring-2 focus:ring-[var(--accion)]/40" />
                            <Button size="sm" onClick={() => accion("tomar", { accion: "tomar", motivo }, () => { setQuitando(false); setMotivo(""); })} disabled={motivo.trim().length < 4 || !!ocupado}>Quitárselo</Button>
                        </div>
                    </div>
                )}
                {pasando && (
                    <div className="mt-2.5 flex gap-2">
                        <input autoFocus value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Qué dejarle dicho al compañero (opcional)" maxLength={500}
                            className="flex-1 h-9 rounded-[8px] px-3 text-[12.5px] bg-background border border-border outline-none focus:ring-2 focus:ring-[var(--accion)]/40" />
                        <Button size="sm" onClick={() => accion("pasar", { accion: "pasar", nota }, () => { setPasando(false); setNota(""); })} disabled={!!ocupado}>Pasarlo</Button>
                    </div>
                )}
            </div>

            {/* El procedimiento de su prioridad. */}
            {pasos.length > 0 && (
                <section>
                    <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground mb-2">Procedimiento P{ev.prioridad}</div>
                    <ul className="space-y-1">
                        {pasos.map((p) => {
                            const hecho = ev.pasos[p];
                            return (
                                <li key={p}>
                                    <button type="button" disabled={!mio || !!ocupado} onClick={() => accion(`paso:${p}`, { accion: "paso", paso: p, hecho: !hecho })}
                                        title={!mio ? "Tomalo para seguir el procedimiento" : undefined}
                                        className={cn("w-full flex items-start gap-2.5 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors", mio ? "hover:bg-accent" : "opacity-70 cursor-not-allowed")}>
                                        <span className={cn("mt-0.5 grid h-4 w-4 place-items-center rounded border shrink-0", hecho ? "bg-[var(--bien)] border-[var(--bien)] text-white" : "border-border")}>{hecho && <Check size={11} />}</span>
                                        <span className="min-w-0 flex-1"><span className={cn(hecho && "line-through opacity-70")}>{p}</span>
                                            {hecho && <span className="block text-[11px] text-muted-foreground tabular-nums">{hecho.por} · {hora(hecho.ts)}</span>}</span>
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                </section>
            )}

            {/* Tratar: cómo se cerró + qué se hizo. Es lo único que lo termina. */}
            {!tratando ? (
                <Button className="w-full h-11 text-[14px] font-bold gap-2" onClick={() => setTratando(true)} disabled={deOtro || !!ocupado}
                    title={deOtro ? `Lo tiene ${ev.operador.nombre}: quitáselo primero` : undefined}>
                    <CheckCircle2 size={17} /> TRATAR EVENTO
                </Button>
            ) : (
                <section className="rounded-[10px] border border-border p-3 space-y-3">
                    <div className="flex items-center"><span className="text-[13px] font-semibold flex-1">Tratar el evento</span><button type="button" onClick={() => setTratando(false)} className="text-muted-foreground hover:text-foreground" aria-label="Cancelar"><X size={15} /></button></div>
                    {(["falsa", "real", "otro"] as const).map((g) => porResultado[g].length > 0 && (
                        <div key={g}>
                            <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground mb-1">{g === "falsa" ? "Falsa alarma" : g === "real" ? "Real" : "Otro"}</div>
                            <div className="space-y-1">
                                {porResultado[g].map((c) => (
                                    <label key={c.id} className={cn("flex items-center gap-2.5 rounded-md border px-2.5 py-2 text-[12.5px] cursor-pointer", cierre === c.id ? "border-[var(--accion)] bg-[color-mix(in_oklab,var(--accion)_7%,transparent)]" : "border-border hover:bg-accent/50")}>
                                        <input type="radio" name="cierre" checked={cierre === c.id} onChange={() => setCierre(c.id)} className="accent-[var(--accion)]" />
                                        {c.texto}
                                    </label>
                                ))}
                            </div>
                        </div>
                    ))}
                    <div>
                        <textarea value={texto} onChange={(e) => setTexto(e.target.value)} rows={3} maxLength={1000}
                            placeholder="Qué se hizo y con quién se habló (obligatorio). P. ej.: Llamé al titular, estaba probando el sistema."
                            className="w-full rounded-[8px] px-3 py-2 text-[12.5px] bg-background border border-border outline-none focus:ring-2 focus:ring-[var(--accion)]/40 resize-y" />
                        <div className="text-[11px] text-muted-foreground mt-0.5">{texto.trim().length < TEXTO_MINIMO ? `Al menos ${TEXTO_MINIMO} letras.` : "Queda en la bitácora con tu nombre y la hora."}</div>
                    </div>
                    <Button className="w-full gap-1.5" disabled={!listo || !!ocupado} onClick={() => accion("tratar", { accion: "tratar", cierre, texto })}>
                        {ocupado === "tratar" ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Tratar y cerrar
                    </Button>
                </section>
            )}
            {error && <div className="rounded-[10px] chip-mal px-3 py-2 text-[12.5px]">{error}</div>}
        </div>
    );
}

export { abrirEventoCentral } from "@/lib/centrales/abrir-evento";
