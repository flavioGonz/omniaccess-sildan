"use client";

import { createElement, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    Activity, BatteryLow, BellRing, CardSim, CircleHelp, Clock3, CornerUpRight, Cpu, Factory, Gauge, Globe, HeartPulse, History, KeyRound, KeySquare, Link2,
    Loader2, Lock, MapPin, MessageCircleQuestion, Minus, Move, Network, Phone, PhoneCall, Plus, Power, PowerOff, Radio, RefreshCw, RotateCcw, Satellite, Send,
    Server, ShieldCheck, Signal, SlidersHorizontal, Timer, TriangleAlert, Truck, Undo2, Unplug, Vibrate, Waves, Wrench, Zap, type LucideIcon, type LucideProps,
} from "lucide-react";
import { claveTopflyGps, guardarClaveTopflyGps, historialComandosGps, mandarComandoGps, valoresActualesGps, type ComandoMandado, type Rastreador, type RespuestaComando } from "@/app/actions/gps";
import { Button } from "@/components/ui/button";
import { ErrorEstado, Vacio } from "@/components/ui/estados";
import { Pista } from "@/components/ui/pista";
import { Switch } from "@/components/ui/switch";
import { armarComando, codigoDeRechazo, comandosDe, GRUPOS_COMANDO, leerEstadoDelEquipo, palabraDeConfirmacion, pareceRechazo, valoresPorDefecto, type CampoComando, type DefComando, type GrupoComando, type NivelComando, type Valores } from "@/lib/gps-comandos";
import type { QueGps } from "@/lib/gps-permisos";
import { hace } from "@/lib/fechas";
import { cn } from "@/lib/utils";
import { CAMPO, ChipEstado, Insignia, nombreDe, Panel, ROTULO, SENAL, VOLTAJE_BAJO, voltios } from "@/components/gps/piezas";

/**
 * Los comandos al rastreador, todos (23/11; rehecha el 24/11).
 *
 * Pedido de Nico: «debemos poder integrar todos los comandos disponibles de este GPS». La primera
 * pantalla los puso en una columna angosta al medio, cada uno cerrado en un renglón que había que
 * abrir. Nico, al verla: «se ve pobre, encerrado en el centro… que a la vista estén los datos, no
 * ocultos». Tenía razón por algo más que el aspecto: para saber cada cuánto reporta un equipo había
 * que abrir un renglón, y para comparar dos ajustes, abrir y cerrar.
 *
 * Ahora ocupa el ancho, cada comando es una tarjeta ABIERTA que dice cómo está hoy el equipo, y a
 * la derecha queda fijo lo último que se le mandó.
 *
 * Lo que se cuidó:
 *  · **Se ve lo que contestó el equipo, textual.** No se traduce: son equipos sin manual, y la única
 *    prueba de que entendió un comando es lo que dijo.
 *  · **Un formulario arranca con lo que el equipo tiene hoy**, no con valores de fábrica. Mandar «el
 *    intervalo de fábrica» sin querer es cambiarle la configuración a un vehículo que estaba bien.
 *    Con todo abierto eso son muchas preguntas juntas, y el equipo contesta de a una: van en fila
 *    (`enFila`), lo que se manda a mano pasa primero, y lo leído vale diez minutos.
 *  · **Lo que se cambió se nota**: el campo dice cuánto tenía y se puede volver atrás.
 *  · **Después de cambiar algo se le vuelve a preguntar cómo quedó**, y se muestran las dos cosas.
 *  · **Lo que no tiene vuelta se confirma en serio**: cortar el motor, con un segundo toque (y el
 *    servidor lo rechaza si el vehículo anda); cambiarle el servidor o volverlo de fábrica,
 *    escribiendo el final del IMEI.
 *  · **Lo que el rol no puede mandar se ve igual, apagado y diciendo por qué.** Que exista y quién
 *    lo puede hacer es información; un botón que desaparece no enseña nada.
 */

/** Qué permiso pide cada clase de comando: lo mismo que exige el servidor (actions/gps, PERMISO_DE_NIVEL). */
const PERMISO: Record<NivelComando, QueGps> = { consulta: "operar", ajuste: "config", rele: "rele", instalacion: "equipo" };
const QUIEN_PUEDE: Record<NivelComando, string> = {
    consulta: "Tu rol puede ver la flota, pero no preguntarle al equipo.",
    ajuste: "Lo cambia quien tiene «Configurar el rastreo».",
    rele: "Lo acciona quien tiene «Cortar y devolver el motor».",
    instalacion: "Lo cambia quien instala los equipos («Editar dispositivos»).",
};

/* ── Con qué dibujo se reconoce cada cosa ── */
const ICONO_DE_GRUPO: Record<GrupoComando, LucideIcon> = { preguntar: MessageCircleQuestion, reporte: Timer, alarmas: BellRing, telefonos: Phone, rele: Power, instalacion: Wrench };
const ICONO_DE: Record<string, LucideIcon> = {
    estado: Activity, posicion: MapPin, enlace: Link2, parametros: SlidersHorizontal, conexion: Server, version: Cpu, sim: CardSim, rele: Zap,
    "reporte.intervalo": Timer, "reporte.latido": HeartPulse, "reporte.giro": CornerUpRight, "reporte.despierto": Satellite,
    "alarma.velocidad": Gauge, "alarma.movimiento": Move, "alarma.vibracion": Vibrate, "alarma.sensor": Waves, "alarma.nivel": SlidersHorizontal,
    "alarma.guardia": ShieldCheck, "alarma.corte": Unplug, "alarma.bateria": BatteryLow, "alarma.contacto": KeyRound, "alarma.remolque": Truck,
    "telefono.sos": PhoneCall, "telefono.central": Phone, "rele.soltar": Power, "rele.accionar": PowerOff,
    "instalacion.huso": Globe, "instalacion.reiniciar": RotateCcw, "instalacion.servidor": Server, "instalacion.apn": Network, "instalacion.fabrica": Factory,
};
/** El dibujo de un comando; el de su grupo si no tiene uno propio. */
function Dibujo({ clave, grupo, ...resto }: { clave: string; grupo?: GrupoComando } & LucideProps) {
    return createElement(ICONO_DE[clave] || (grupo ? ICONO_DE_GRUPO[grupo] : Radio), resto);
}

/* ── Hablarle al equipo de a una cosa por vez ──
   El rastreador contesta por la misma conexión por la que reporta, y el receptor empareja cada
   respuesta con el único comando que ese equipo tiene pendiente. Con todas las tarjetas abiertas,
   preguntarle veinte cosas a la vez sería cruzar las respuestas. Van en fila, por equipo; lo que
   manda una persona (`urgente`) pasa adelante de las preguntas que quedaban. */
type Tarea = () => Promise<void>;
const filas = new Map<string, { pendientes: Tarea[]; andando: boolean }>();
function enFila<T>(imei: string, hacer: () => Promise<T>, urgente = false): Promise<T> {
    return new Promise<T>((bien, mal) => {
        const f = filas.get(imei) || { pendientes: [], andando: false };
        filas.set(imei, f);
        const tarea: Tarea = () => hacer().then(bien, mal);
        if (urgente) f.pendientes.unshift(tarea); else f.pendientes.push(tarea);
        if (f.andando) return;
        f.andando = true;
        void (async () => { while (f.pendientes.length) await f.pendientes.shift()!(); f.andando = false; })();
    });
}

/** Lo que contestó el equipo cuando se le preguntó cómo está algo. */
type Lectura = { ok: boolean; respuesta?: string; valores?: Valores | null; error?: string };
/** Lo leído vale diez minutos: volver a la pestaña no es volver a preguntarle todo al equipo. */
const LEIDO_VALE_MS = 10 * 60_000;
const leido = new Map<string, { cuando: number; x: Lectura }>(), enVuelo = new Map<string, Promise<Lectura>>();
/** Tres tarjetas preguntan lo mismo (`RELAY#`): la pregunta viaja una vez. Lo que sale de los ajustes es de cada comando. */
const llaveDe = (imei: string, def: DefComando) => `${imei}|${def.deAjustes ? `a:${def.clave}` : def.pregunta}`;
function leerDelEquipo(imei: string, def: DefComando, sigue: () => boolean, forzar = false): Promise<Lectura> {
    const llave = llaveDe(imei, def), ya = leido.get(llave);
    if (!forzar && ya && Date.now() - ya.cuando < LEIDO_VALE_MS) return Promise.resolve(ya.x);
    const yendo = enVuelo.get(llave);
    if (yendo) return yendo;
    const p = enFila<Lectura>(imei, async () => {
        /* Si quien preguntaba ya se fue a otro vehículo, la pregunta no viaja. */
        if (!sigue()) return { ok: false, error: "cancelada" };
        try { const x = await valoresActualesGps(imei, def.clave); if (x.ok) leido.set(llave, { cuando: Date.now(), x }); return x; }
        catch (e) { return { ok: false, error: e instanceof Error ? e.message : "No se pudo preguntar." }; }
    }).finally(() => enVuelo.delete(llave));
    enVuelo.set(llave, p);
    return p;
}

export function ComandosGps({ lista, imei, alElegir, puede, alCambiar }: {
    lista: Rastreador[];
    imei: string | null;
    alElegir: (imei: string) => void;
    puede: (que: QueGps) => boolean;
    /** Algo cambió en el equipo (el relé): que la lista se vuelva a pedir. */
    alCambiar: () => void;
}) {
    const deAlta = useMemo(() => lista.filter((r) => r.deviceId), [lista]);
    const r = deAlta.find((x) => x.imei === imei) || deAlta[0] || null;
    const comandos = useMemo(() => comandosDe(r?.protocolo), [r?.protocolo]);

    /* El historial: se vuelve a pedir después de cada comando. */
    const [historial, setHistorial] = useState<{ de: string; filas: ComandoMandado[] | null; error: string | null }>({ de: "", filas: null, error: null });
    const [vuelta, setVuelta] = useState(0);
    /* «Volver a leer todo»: cada tarjeta le pregunta de nuevo al equipo, sin usar lo que tenía leído. */
    const [relectura, setRelectura] = useState(0);
    const elImei = r?.imei || "";
    useEffect(() => {
        if (!elImei) return;
        let vivo = true;
        historialComandosGps(elImei, 20)
            .then((f) => { if (vivo) setHistorial({ de: elImei, filas: f, error: null }); })
            .catch((e) => { if (vivo) setHistorial({ de: elImei, filas: null, error: e instanceof Error ? e.message : "No se pudo traer." }); });
        return () => { vivo = false; };
    }, [elImei, vuelta]);
    const hecho = useCallback((def: DefComando) => { setVuelta((n) => n + 1); if (def.grupo === "rele") alCambiar(); }, [alCambiar]);

    if (!deAlta.length) return <Vacio icono={Satellite} titulo="No hay rastreadores dados de alta" ayuda="Un rastreador acepta comandos recién cuando alguien lo dio de alta, en Dispositivos › GPS." />;
    if (!r) return null;
    const conPreguntas = comandos.some((c) => c.campos?.length && c.pregunta);

    return (
        <div className="space-y-4">
            {/* ── A cuál ── Todos a la vista, y no en un desplegable: son pocos, y elegir es ver cuál anda y cuál no reporta. */}
            <div role="radiogroup" aria-label="Vehículo al que se le manda el comando" className={cn("-mx-4 flex gap-2.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0 [&::-webkit-scrollbar]:hidden", deAlta.length > 9 && "sm:max-h-[178px] sm:overflow-y-auto")}>
                {deAlta.map((x) => {
                    const es = x.imei === r.imei;
                    return (
                        <button key={x.imei} type="button" role="radio" aria-checked={es} onClick={() => alElegir(x.imei)}
                            className={cn("flex min-h-[62px] w-[250px] shrink-0 items-center gap-3 rounded-[10px] border p-2.5 text-left outline-none transition-colors focus-visible:border-[var(--accion)] sm:w-auto sm:min-w-[230px] sm:max-w-[330px] sm:flex-1",
                                es ? "border-[var(--accion)] bg-[color-mix(in_oklab,var(--accion)_7%,transparent)]" : "border-border bg-card/40 hover:bg-accent/60")}>
                            <Insignia r={x} tam={40} />
                            <span className="min-w-0 flex-1">
                                <span className="block truncate text-[13.5px] font-semibold leading-tight">{nombreDe(x)}</span>
                                <span className="mt-0.5 block truncate text-[11.5px] tabular-nums text-muted-foreground">{x.matricula && x.nombre ? `${x.matricula} · ` : ""}{x.protocolo === "TOPFLY" ? "TopFly" : x.protocolo}</span>
                            </span>
                            <ChipEstado r={x} />
                        </button>
                    );
                })}
            </div>

            <FichaDelEquipo r={r} puede={puede} />

            {!comandos.length ? (
                <Panel><Vacio icono={Radio} titulo="A este modelo todavía no se le pueden mandar comandos" ayuda={`Habla ${r.protocolo}. Por ahora se lo configura por SMS o con el programa del fabricante.`} /></Panel>
            ) : (
                <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_340px] 2xl:grid-cols-[minmax(0,1fr)_390px]">
                    <div className="min-w-0 space-y-6">
                        {GRUPOS_COMANDO.map((g) => {
                            const suyos = comandos.filter((c) => c.grupo === g.clave);
                            if (!suyos.length) return null;
                            const Icono = ICONO_DE_GRUPO[g.clave];
                            return (
                                <section key={g.clave} aria-label={g.titulo} className="@container">
                                    <header className="mb-2.5 flex items-center gap-2.5">
                                        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[8px] bg-muted text-foreground"><Icono size={16} strokeWidth={1.8} /></span>
                                        <div className="min-w-0 flex-1">
                                            <h3 className="text-[15px] font-bold leading-tight tracking-[-0.01em]">{g.titulo}</h3>
                                            <p className="text-[12px] leading-snug text-muted-foreground">{g.ayuda}</p>
                                        </div>
                                        {g.clave === "reporte" && conPreguntas && r.enLinea && (
                                            <Pista lado="izquierda" ancho={250} titulo="Volver a leer todo" texto="Le pregunta de nuevo al equipo cómo tiene cada ajuste. Lo leído vale diez minutos; esto lo trae ya.">
                                                <Button variant="outline" size="sm" className="h-8 gap-1.5 text-[12px]" onClick={() => setRelectura((n) => n + 1)}><RefreshCw size={13} /> Volver a leer</Button>
                                            </Pista>
                                        )}
                                    </header>
                                    <div className="grid grid-cols-1 gap-3 @2xl:grid-cols-2 @5xl:grid-cols-3">
                                        {suyos.map((c) => <Tarjeta key={`${r.imei}:${c.clave}`} def={c} r={r} permitido={puede(PERMISO[c.nivel])} relectura={relectura} alTerminar={() => hecho(c)} />)}
                                    </div>
                                </section>
                            );
                        })}
                    </div>

                    {/* ── Lo que se le mandó ── Fijo al costado: se manda algo y se ve entrar acá, sin bajar a buscarlo. */}
                    <Panel className="xl:sticky xl:top-3 xl:flex xl:max-h-[calc(100dvh-7.5rem)] xl:flex-col">
                        <header className="flex items-center gap-2.5 px-4 py-3">
                            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[8px] bg-muted"><History size={16} strokeWidth={1.8} /></span>
                            <div className="min-w-0 flex-1">
                                <h3 className="text-[14px] font-bold leading-tight">Lo último que se le mandó</h3>
                                <p className="text-[11.5px] text-muted-foreground">Con quién lo mandó y lo que contestó el equipo.</p>
                            </div>
                        </header>
                        <div className="min-h-0 border-t border-border xl:overflow-y-auto">
                            {historial.error && historial.de === elImei ? <ErrorEstado mensaje={historial.error} alReintentar={() => setVuelta((n) => n + 1)} />
                                : historial.de !== elImei || !historial.filas ? <p className="flex items-center gap-2 px-4 py-6 text-[12.5px] text-muted-foreground"><Loader2 size={14} className="animate-spin" /> Trayendo el historial…</p>
                                : !historial.filas.length ? <Vacio className="py-8" icono={History} titulo="Todavía no se le mandó nada desde acá" ayuda="Cada comando queda anotado con quién lo mandó y lo que contestó el equipo." />
                                : <ul className="divide-y divide-border">{historial.filas.map((h) => <Mandado key={h.id} h={h} />)}</ul>}
                        </div>
                    </Panel>
                </div>
            )}
        </div>
    );
}

/** Lo que se sabe del equipo sin preguntarle nada: lo último que reportó. */
function FichaDelEquipo({ r, puede }: { r: Rastreador; puede: (que: QueGps) => boolean }) {
    const senal = r.senal === null ? null : SENAL[Math.max(0, Math.min(4, r.senal))];
    const datos: { icono: LucideIcon; k: string; v: React.ReactNode; tono?: string; pista: string }[] = [
        { icono: Clock3, k: "Última noticia", v: hace(r.ultimoLatido, "nunca"), tono: r.enLinea ? undefined : "tono-aviso", pista: "La última vez que el equipo habló con OmniAccess, con una posición o con un latido. Los comandos viajan por esa misma conexión: si hace rato que no habla, no le llegan." },
        { icono: Satellite, k: "Última posición", v: r.cuando ? hace(r.cuando) : "Sin posición", pista: "La última posición con buena señal de satélites. Detenido, el GPS se duerme y sólo sigue el latido: puede ser de hace horas sin que nada ande mal." },
        { icono: Signal, k: "Señal celular", v: senal ?? "—", tono: r.senal !== null && r.senal <= 1 ? "tono-aviso" : undefined, pista: "Con qué fuerza llega a la antena de la operadora, según el propio equipo. Con señal baja los comandos pueden tardar o perderse." },
        { icono: Zap, k: "Alimentación", v: r.voltaje === null ? "—" : voltios(r.voltaje), tono: r.voltaje !== null && r.voltaje < VOLTAJE_BAJO ? "tono-aviso" : undefined, pista: "El voltaje que le llega al rastreador: es la batería del vehículo. Por debajo de 11,8 V se está descargando." },
        { icono: KeyRound, k: "Contacto", v: r.encendido === null ? "—" : r.encendido ? "Puesto" : "Cortado", pista: "Si el vehículo está con el contacto puesto, según el equipo." },
        { icono: Cpu, k: "Habla", v: r.protocolo === "TOPFLY" ? "TopFly" : r.protocolo, pista: "El protocolo del equipo. De él depende qué comandos se le pueden mandar: por eso la lista de abajo cambia de un vehículo a otro." },
    ];
    return (
        <Panel className="@container">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 pt-3.5">
                <p className="min-w-0 truncate text-[15px] font-bold tracking-[-0.01em]">{nombreDe(r)}</p>
                <ChipEstado r={r} />
                {r.cortado && <span className="chip-mal inline-flex h-6 items-center gap-1.5 rounded-full border px-2 text-[11px] font-semibold"><PowerOff size={12} /> Motor cortado</span>}
                <p className="ml-auto text-[11.5px] tabular-nums text-muted-foreground">IMEI {r.imei}</p>
            </div>
            {r.direccion && <p className="flex items-start gap-1.5 px-4 pt-1 text-[12.5px] leading-snug text-muted-foreground"><MapPin size={13} className="mt-[2px] shrink-0" />{r.direccion}</p>}
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 px-4 py-3.5 @lg:grid-cols-3 @3xl:grid-cols-6">
                {datos.map((d) => (
                    <Pista key={d.k} titulo={d.k} texto={d.pista} ancho={260} lado="abajo">
                        <div className="flex min-w-0 cursor-help items-center gap-2.5">
                            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[8px] bg-muted text-muted-foreground"><d.icono size={15} strokeWidth={1.8} /></span>
                            <div className="min-w-0">
                                <dt className="truncate text-[11px] text-muted-foreground">{d.k}</dt>
                                <dd className={cn("truncate text-[13.5px] font-semibold tabular-nums leading-tight", d.tono)}>{d.v}</dd>
                            </div>
                        </div>
                    </Pista>
                ))}
            </dl>
            {!r.enLinea && (
                <p className="chip-aviso mx-4 mb-3.5 flex items-start gap-2 rounded-[6px] border px-3 py-2 text-[12.5px] leading-snug">
                    <TriangleAlert size={15} className="mt-[1px] shrink-0" />
                    <span>No está en línea. Los comandos viajan por la conexión que el propio rastreador mantiene abierta: hasta que vuelva a reportar no se le puede mandar nada.</span>
                </p>
            )}
            {r.protocolo === "TOPFLY" && <ClaveDelEquipo puedeCambiarla={puede("equipo")} />}
        </Panel>
    );
}

/**
 * La clave con la que un TopFly acepta comandos. Estaba sólo como un ajuste escrito en la base: el
 * 24/11 un equipo real rechazó el primer cambio y no había dónde probar con otra clave.
 */
function ClaveDelEquipo({ puedeCambiarla }: { puedeCambiarla: boolean }) {
    const [propia, setPropia] = useState<boolean | null>(null);
    const [editando, setEditando] = useState(false);
    const [clave, setClave] = useState("");
    const [guardando, setGuardando] = useState(false);
    const [error, setError] = useState<string | null>(null);
    useEffect(() => { let vivo = true; claveTopflyGps().then((x) => { if (vivo) setPropia(x.propia); }).catch(() => { if (vivo) setPropia(false); }); return () => { vivo = false; }; }, []);
    const guardar = async (valor: string) => {
        setGuardando(true); setError(null);
        try {
            const x = await guardarClaveTopflyGps(valor);
            if (!x.ok) { setError(x.error || "No se pudo guardar."); return; }
            setPropia(!!valor && valor !== "0000"); setEditando(false); setClave("");
        } catch (e) { setError(e instanceof Error ? e.message : "No se pudo guardar."); }
        finally { setGuardando(false); }
    };
    return (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-border px-4 py-3">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[8px] bg-muted text-muted-foreground"><KeySquare size={15} strokeWidth={1.8} /></span>
            <div className="min-w-0 flex-1 basis-[220px]">
                <p className="flex items-center gap-1.5 text-[13px] font-semibold">
                    Clave del equipo
                    <Pista ancho={290} titulo="Clave del equipo" texto="Este modelo sólo acepta un cambio si el comando lleva su clave. De fábrica es 0000; si quien lo configuró le puso otra, se carga acá. No se le manda nada al equipo: esto no le cambia la clave, sólo dice cuál usar. Vale para todos los TopFly de esta instalación.">
                        <CircleHelp size={13} className="cursor-help text-muted-foreground" />
                    </Pista>
                </p>
                <p className="text-[12px] text-muted-foreground">{propia === null ? "…" : propia ? "Se usa una clave propia, cargada acá." : "Se usa la de fábrica (0000)."}</p>
            </div>
            {editando ? (
                <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); guardar(clave.trim()); }}>
                    <input value={clave} onChange={(e) => setClave(e.target.value.replace(/[^A-Za-z0-9]/g, ""))} maxLength={10} autoFocus autoComplete="off" spellCheck={false} placeholder="La clave" aria-label="Clave del equipo" className={cn(CAMPO, "w-[130px] tabular-nums")} />
                    <Button type="submit" size="sm" className="h-11 sm:h-9" disabled={guardando || clave.trim().length < 4}>{guardando && <Loader2 size={14} className="animate-spin" />} Guardar</Button>
                    <Button type="button" variant="ghost" size="sm" className="h-11 sm:h-9" onClick={() => { setEditando(false); setClave(""); setError(null); }}>Cancelar</Button>
                </form>
            ) : puedeCambiarla ? (
                <div className="flex items-center gap-2">
                    {propia && <Button variant="ghost" size="sm" className="h-9 text-[12px]" disabled={guardando} onClick={() => guardar("")}>Volver a la de fábrica</Button>}
                    <Button variant="outline" size="sm" className="h-9 text-[12px]" onClick={() => setEditando(true)}>Cambiar</Button>
                </div>
            ) : <span className="flex items-center gap-1.5 text-[12px] text-muted-foreground"><Lock size={13} /> La cambia quien instala los equipos.</span>}
            {error && <p className="tono-mal basis-full text-[12.5px] font-semibold" role="alert">{error}</p>}
        </div>
    );
}

/** Una línea del historial. */
function Mandado({ h }: { h: ComandoMandado }) {
    const rechazo = h.ok && pareceRechazo(h.respuesta);
    return (
        <li className="flex gap-3 px-4 py-3">
            <span className={cn("mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full border", !h.ok ? "chip-mal" : rechazo ? "chip-aviso" : "chip-bien")}><Dibujo clave={h.clave} size={13} strokeWidth={1.9} /></span>
            <div className="min-w-0 flex-1">
                <p className="text-[13px] font-semibold leading-tight">{h.titulo}</p>
                <p className="mt-0.5 text-[11.5px] text-muted-foreground">{h.quien} · {hace(h.cuando)}</p>
                <p className="mt-1.5 break-all rounded-[6px] bg-muted/60 px-2 py-1 text-[11.5px] tabular-nums text-muted-foreground">{h.texto}</p>
                <p className={cn("mt-1.5 break-words text-[12.5px] leading-snug", !h.ok ? "tono-mal" : rechazo && "tono-aviso")}>{h.ok ? `«${h.respuesta || "sin texto"}»` : h.respuesta || "No contestó."}</p>
                {h.quedo && <p className="mt-0.5 break-words text-[12px] leading-snug text-muted-foreground">Quedó: «{h.quedo}»</p>}
            </div>
        </li>
    );
}

/** Cómo decir un valor leído, con su unidad o con el nombre de la opción. */
function dicho(c: CampoComando, v: string | number | undefined): string {
    if (v === undefined || v === "") return "—";
    if (c.tipo === "opcion") return c.opciones.find((o) => o.valor === String(v))?.rotulo || String(v);
    if (c.tipo === "entero") return `${Number(v).toLocaleString("es-UY")}${c.unidad ? ` ${c.unidad}` : ""}`;
    return String(v);
}

/** Un comando: abierto, con cómo está hoy, sus campos y lo que contestó el equipo. */
function Tarjeta({ def, r, permitido, relectura, alTerminar }: { def: DefComando; r: Rastreador; permitido: boolean; relectura: number; alTerminar: () => void }) {
    const sinCampos = !def.campos?.length;
    const esCorte = def.clave === "rele.accionar";

    /* Cómo está hoy. Los que informan su configuración en cada posición (`deAjustes`) no necesitan
       estar en línea: se lee lo último que dijeron. A los demás se les pregunta, si están. */
    const pregunta = !sinCampos && permitido && (!!def.deAjustes || (!!def.pregunta && r.enLinea));
    const [propia, setPropia] = useState(0);
    const turno = `${relectura}:${propia}`;
    const [lectura, setLectura] = useState<{ turno: string; x: Lectura } | null>(null);
    const [valores, setValores] = useState<Valores>(() => valoresPorDefecto(def));
    /* Lo que la persona ya escribió no se pisa cuando llega la respuesta del equipo (puede tardar: va en fila). */
    const [tocados, setTocados] = useState<Record<string, true>>({});
    const tocadosRef = useRefActual(tocados);
    useEffect(() => {
        if (!pregunta) return;
        let vivo = true;
        leerDelEquipo(r.imei, def, () => vivo, turno !== "0:0").then((x) => {
            if (!vivo || x.error === "cancelada") return;
            setLectura({ turno, x });
            const leidos = x.ok ? (def.deAjustes ? x.valores : def.leer && x.respuesta ? def.leer(x.respuesta) : x.valores) : null;
            if (leidos) setValores((v) => { const n = { ...v }; for (const k of Object.keys(leidos)) if (!tocadosRef.current[k]) n[k] = leidos[k]; return n; });
        });
        return () => { vivo = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps -- se pregunta al montar y cuando se pide leer de nuevo
    }, [turno, pregunta]);
    const leyendo = pregunta && lectura?.turno !== turno;
    const x = lectura?.x;
    const leidos: Valores | null = !x?.ok ? null : def.deAjustes ? x.valores || null : def.leer && x.respuesta ? def.leer(x.respuesta) : x.valores || null;

    const armado = useMemo(() => armarComando(def, valores), [def, valores]);
    const [mandando, setMandando] = useState(false);
    const [armadoParaMandar, setArmadoParaMandar] = useState(false);
    const [tipeado, setTipeado] = useState("");
    const [resultado, setResultado] = useState<RespuestaComando | null>(null);
    useEffect(() => { if (!armadoParaMandar) return; const t = setTimeout(() => setArmadoParaMandar(false), 6000); return () => clearTimeout(t); }, [armadoParaMandar]);

    const palabra = palabraDeConfirmacion(r.imei);
    const faltaEscribir = def.confirmar === "escribir" && tipeado.trim() !== palabra;
    const mandar = async () => {
        /* El primer toque arma; el segundo, dentro de unos segundos, manda. Un toque que iba para la tarjeta de al lado no corta un motor. */
        if (def.confirmar === "toque" && !armadoParaMandar) { setArmadoParaMandar(true); return; }
        setMandando(true); setArmadoParaMandar(false); setResultado(null);
        try {
            const res = await enFila(r.imei, () => mandarComandoGps(r.imei, def.clave, valores, def.confirmar === "escribir" ? tipeado.trim() : null), true);
            setResultado(res); setTipeado("");
            /* Lo que se sabía de cómo estaba ya no vale: se vuelve a leer (lo que sale de los ajustes llega con la próxima posición). */
            if (res.ok && def.nivel !== "consulta") { leido.delete(llaveDe(r.imei, def)); setTocados({}); if (def.pregunta && r.enLinea) setPropia((n) => n + 1); }
        } catch (e) { setResultado({ ok: false, error: e instanceof Error ? e.message : "No se pudo mandar." }); }
        finally { setMandando(false); alTerminar(); }
    };

    const poner = (clave: string, v: string | number) => { setValores((a) => ({ ...a, [clave]: v })); setTocados((t) => ({ ...t, [clave]: true })); };
    const apagada = valores.on === "OFF";
    const cambios = leidos ? (def.campos || []).filter((c) => leidos[c.clave] !== undefined && String(leidos[c.clave]) !== String(valores[c.clave] ?? "")).length : 0;
    const boton = def.nivel === "consulta" ? "Preguntarle" : esCorte ? "Cortar el motor" : def.clave === "rele.soltar" ? "Devolver el motor" : sinCampos ? def.titulo : cambios ? `Mandar ${cambios === 1 ? "el cambio" : `los ${cambios} cambios`}` : "Mandar al equipo";
    const ancha = (def.campos?.length || 0) >= 3;

    return (
        <article className={cn("@container flex min-w-0 flex-col rounded-[10px] border border-border bg-card/40", ancha && "@2xl:col-span-2", esCorte && "border-[color-mix(in_oklab,var(--mal,#e32a4e)_35%,var(--border))]")}>
            <header className="flex items-start gap-3 px-4 pt-3.5">
                <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-[8px]", esCorte ? "chip-mal border" : "bg-muted text-foreground")}><Dibujo clave={def.clave} grupo={def.grupo} size={17} strokeWidth={1.8} /></span>
                <div className="min-w-0 flex-1">
                    <h4 className={cn("flex items-center gap-1.5 text-[14px] font-bold leading-tight", esCorte && "tono-mal")}>
                        <span className="min-w-0 truncate">{def.titulo}</span>
                        {!permitido && <Pista ancho={240} texto={QUIEN_PUEDE[def.nivel]}><Lock size={13} className="shrink-0 cursor-help text-muted-foreground" aria-label="Tu rol no puede mandarlo" /></Pista>}
                    </h4>
                    <p className="mt-0.5 text-[12px] leading-snug text-muted-foreground">{def.ayuda}</p>
                </div>
                {pregunta && (
                    <Pista lado="izquierda" ancho={250} titulo={leyendo ? "Preguntándole al equipo" : x?.ok ? "Leído del equipo" : "No se pudo leer"}
                        texto={leyendo ? "Las preguntas van de a una: el equipo contesta por la misma conexión por la que reporta." : def.deAjustes ? "Es lo que el equipo informó en su última posición. Tocá para volver a mirar." : "Tocá para preguntarle de nuevo."}>
                        <button type="button" onClick={() => setPropia((n) => n + 1)} disabled={leyendo} aria-label="Volver a leer del equipo"
                            className="grid h-8 w-8 shrink-0 place-items-center rounded-[6px] text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:bg-accent disabled:hover:bg-transparent">
                            {leyendo ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} className={cn(x && !x.ok && "tono-aviso")} />}
                        </button>
                    </Pista>
                )}
            </header>

            <div className="flex flex-1 flex-col gap-3.5 px-4 pb-4 pt-3">
                {/* ── Cómo está hoy: a la vista, antes de tocar nada ── */}
                {!sinCampos && (
                    <div className="rounded-[8px] bg-muted/50 px-3 py-2.5">
                        <p className={ROTULO}>Hoy en el equipo</p>
                        {leyendo ? <p className="mt-1.5 flex items-center gap-2 text-[12.5px] text-muted-foreground"><Loader2 size={13} className="animate-spin" /> Preguntándole…</p>
                            : leidos ? (
                                <dl className="mt-1.5 flex flex-wrap gap-x-5 gap-y-1.5">
                                    {def.campos!.map((c) => (leidos[c.clave] === undefined ? null : (
                                        <div key={c.clave} className="min-w-0">
                                            <dt className="text-[11px] leading-tight text-muted-foreground">{c.rotulo}</dt>
                                            <dd className="text-[14px] font-bold tabular-nums leading-tight">{dicho(c, leidos[c.clave])}</dd>
                                        </div>
                                    )))}
                                </dl>
                            ) : x?.ok && x.respuesta ? <p className="mt-1.5 break-words text-[12.5px] leading-snug">«{x.respuesta}» <span className="text-muted-foreground">No se pudo leer en los campos: revisalos antes de mandar.</span></p>
                            : x && !x.ok ? <p className="tono-aviso mt-1.5 text-[12.5px] leading-snug">No se pudo saber ({(x.error || "no contestó").replace(/\.$/, "")}). Los campos muestran los valores de fábrica, no los del equipo.</p>
                            : <p className="mt-1.5 text-[12.5px] leading-snug text-muted-foreground">{!permitido ? QUIEN_PUEDE[def.nivel] : !r.enLinea ? "No está en línea: no se le puede preguntar. Los campos muestran los valores de fábrica." : def.deAjustes ? "Todavía no lo informó: llega con su próxima posición en vivo." : "Sin leer."}</p>}
                    </div>
                )}

                {/* ── Los campos ── */}
                {!sinCampos && (
                    <div className="grid gap-x-4 gap-y-4 @md:grid-cols-2">
                        {def.campos!.map((c) => (apagada && c.clave !== "on" ? null
                            : <Campo key={c.clave} c={c} valor={valores[c.clave]} leido={leidos?.[c.clave]} apagado={!permitido} alCambiar={(v) => poner(c.clave, v)} />))}
                    </div>
                )}

                {def.cuidado && <p className="flex items-start gap-2 text-[11.5px] leading-snug text-muted-foreground"><TriangleAlert size={13} className="tono-aviso mt-[2px] shrink-0" />{def.cuidado}</p>}

                {def.confirmar === "escribir" && permitido && (
                    <label className="block">
                        <span className="block text-[12.5px] font-semibold leading-snug">Para confirmar, escribí los últimos cuatro números del IMEI: <span className="tabular-nums">{palabra}</span></span>
                        <input value={tipeado} onChange={(e) => setTipeado(e.target.value)} inputMode="numeric" autoComplete="off" maxLength={4} placeholder={palabra} className={cn(CAMPO, "mt-1.5 max-w-[160px] tabular-nums")} aria-label="Confirmación" />
                    </label>
                )}

                {/* ── Lo que va a viajar y el botón, abajo de todo: las tarjetas de una fila quedan alineadas ── */}
                <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-2.5 pt-0.5">
                    {!sinCampos && (armado.ok ? (
                        <Pista ancho={270} titulo="Lo que va a viajar" texto="El texto exacto que recibe el equipo. Quien instala lo reconoce: es el mismo que se manda por SMS. La clave del equipo, si lleva, va tapada.">
                            <p className="min-w-0 cursor-help break-all rounded-[6px] bg-muted/60 px-2.5 py-1.5 text-[12px] font-semibold tabular-nums">{def.paraAnotar ? def.paraAnotar(armado.valores) : armado.texto}</p>
                        </Pista>
                    ) : <p className="tono-mal min-w-0 flex-1 text-[12.5px] font-semibold" role="alert">{armado.error}</p>)}
                    <Button onClick={mandar} disabled={!permitido || mandando || !r.enLinea || !armado.ok || faltaEscribir}
                        variant={def.nivel === "consulta" ? "outline" : "default"}
                        className={cn("ml-auto h-11 w-full gap-2 px-4 text-[14px] sm:h-9 sm:w-auto sm:text-[13px]", (esCorte || def.confirmar === "escribir" || (armadoParaMandar && def.nivel === "instalacion")) && "pleno-mal hover:opacity-90")}>
                        {mandando ? <Loader2 size={15} className="animate-spin" /> : def.nivel === "consulta" ? <MessageCircleQuestion size={15} /> : esCorte ? <PowerOff size={15} /> : <Send size={14} />}
                        {mandando ? "Esperando al equipo…" : armadoParaMandar ? `¿Confirmar? ${boton}` : boton}
                    </Button>
                </div>

                {resultado && <Resultado def={def} x={resultado} />}
            </div>
        </article>
    );
}

/** El valor más nuevo de algo, para leerlo desde una respuesta que llega tarde sin volver a pedirla. */
function useRefActual<T>(valor: T) {
    const caja = useRef(valor);
    useEffect(() => { caja.current = valor; });
    return caja;
}

/** De a cuánto sube y baja un número con los botones: de a uno donde importa, de a más donde el rango es largo. */
const pasoDe = (c: Extract<CampoComando, { tipo: "entero" }>, v: number) => (c.max <= 600 ? 1 : v >= 3600 ? 300 : v >= 600 ? 60 : v >= 60 ? 10 : 1);

/** Un campo del formulario, según qué clase de dato lleva. */
function Campo({ c, valor, leido: delEquipo, apagado, alCambiar }: { c: CampoComando; valor: string | number | undefined; leido: string | number | undefined; apagado: boolean; alCambiar: (v: string | number) => void }) {
    const cambiado = delEquipo !== undefined && String(delEquipo) !== String(valor ?? "");
    const interruptor = c.tipo === "opcion" && c.opciones.length === 2 && c.opciones.some((o) => o.valor === "ON") && c.opciones.some((o) => o.valor === "OFF");
    const pocas = c.tipo === "opcion" && c.opciones.length <= 3 && !interruptor;
    const rotulo = (
        <span className="mb-1.5 flex items-center gap-1.5">
            <span className="min-w-0 truncate text-[12.5px] font-semibold">{c.rotulo}</span>
            {c.ayuda && <Pista ancho={270} titulo={c.rotulo} texto={c.ayuda}><CircleHelp size={13} className="shrink-0 cursor-help text-muted-foreground" /></Pista>}
            {c.tipo === "entero" && <span className="ml-auto shrink-0 text-[11px] tabular-nums text-muted-foreground">{c.min.toLocaleString("es-UY")} – {c.max.toLocaleString("es-UY")}{c.unidad ? ` ${c.unidad}` : ""}</span>}
        </span>
    );
    return (
        <div className={cn("min-w-0", (pocas || c.tipo === "texto") && "@md:col-span-2")}>
            {c.tipo === "entero" ? (() => {
                const n = Number(valor), hay = String(valor ?? "").trim() !== "" && Number.isFinite(n);
                const mover = (signo: 1 | -1) => { const base = hay ? n : c.defecto, p = pasoDe(c, signo < 0 ? base - 1 : base); alCambiar(Math.max(c.min, Math.min(c.max, signo > 0 ? Math.floor(base / p) * p + p : Math.ceil(base / p) * p - p))); };
                const fuera = hay && (n < c.min || n > c.max);
                return (
                    <>
                        <label className="block">
                            {rotulo}
                            {/* Menos y más a los costados, la unidad adentro: se ajusta sin teclado y se lee como un dato, no como un número suelto. */}
                            <span className={cn("flex h-11 items-stretch overflow-hidden rounded-[6px] border bg-background focus-within:border-[var(--accion)] sm:h-9", fuera ? "border-[var(--mal,#e32a4e)]" : cambiado ? "border-[var(--accion)]" : "border-border", apagado && "opacity-50")}>
                                <button type="button" tabIndex={-1} disabled={apagado || (hay && n <= c.min)} onClick={() => mover(-1)} aria-label={`Menos ${c.rotulo}`} className="grid w-10 shrink-0 place-items-center border-r border-border text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent sm:w-9"><Minus size={14} /></button>
                                <input type="number" inputMode="numeric" min={c.min} max={c.max} disabled={apagado} value={valor ?? ""} onChange={(e) => alCambiar(e.target.value)}
                                    className="w-full min-w-0 bg-transparent px-1 text-center text-[16px] font-bold tabular-nums outline-none [appearance:textfield] sm:text-[14px] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" />
                                {c.unidad && <span className="grid shrink-0 place-items-center pr-2.5 text-[12px] text-muted-foreground">{c.unidad}</span>}
                                <button type="button" tabIndex={-1} disabled={apagado || (hay && n >= c.max)} onClick={() => mover(1)} aria-label={`Más ${c.rotulo}`} className="grid w-10 shrink-0 place-items-center border-l border-border text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent sm:w-9"><Plus size={14} /></button>
                            </span>
                        </label>
                        {/* Los valores que se suelen elegir, de un toque. La píldora dice «esto se elige». */}
                        {c.sugeridos && !apagado && (
                            <div className="mt-1.5 flex flex-wrap gap-1" role="group" aria-label={`Valores usuales de ${c.rotulo}`}>
                                {c.sugeridos.map((s) => (
                                    <button key={s} type="button" aria-pressed={hay && n === s} onClick={() => alCambiar(s)}
                                        className={cn("h-8 rounded-full border px-2.5 text-[12px] font-semibold tabular-nums sm:h-6 sm:px-2 sm:text-[11px]", hay && n === s ? "border-foreground bg-foreground text-background" : "border-border text-muted-foreground hover:text-foreground")}>
                                        {s === 0 ? "No" : s.toLocaleString("es-UY")}
                                    </button>
                                ))}
                            </div>
                        )}
                    </>
                );
            })() : interruptor ? (
                <div className="flex min-h-11 items-center justify-between gap-3 rounded-[6px] border border-border bg-background px-3 sm:min-h-9">
                    <span className="flex min-w-0 items-center gap-1.5 text-[12.5px] font-semibold"><span className="truncate">{c.rotulo}</span>{c.ayuda && <Pista ancho={270} titulo={c.rotulo} texto={c.ayuda}><CircleHelp size={13} className="shrink-0 cursor-help text-muted-foreground" /></Pista>}</span>
                    <span className="flex shrink-0 items-center gap-2 text-[12px] text-muted-foreground">
                        {c.tipo === "opcion" && c.opciones.find((o) => o.valor === String(valor ?? c.defecto))?.rotulo}
                        <Switch checked={String(valor ?? (c.tipo === "opcion" ? c.defecto : "")) === "ON"} disabled={apagado} onCheckedChange={(si) => alCambiar(si ? "ON" : "OFF")} aria-label={c.rotulo} className="data-[state=checked]:bg-[var(--accion)]" />
                    </span>
                </div>
            ) : pocas && c.tipo === "opcion" ? (
                <>
                    {rotulo}
                    {/* Pocas opciones van a la vista: elegir entre tres cosas no merece abrir una lista. */}
                    <div className="grid gap-1 rounded-[8px] bg-muted/60 p-1" style={{ gridTemplateColumns: `repeat(${c.opciones.length}, minmax(0, 1fr))` }} role="group" aria-label={c.rotulo}>
                        {c.opciones.map((o) => { const es = String(valor ?? c.defecto) === o.valor; return (
                            <button key={o.valor} type="button" aria-pressed={es} disabled={apagado} onClick={() => alCambiar(o.valor)}
                                className={cn("min-h-10 rounded-[6px] px-2 py-1 text-[12.5px] font-semibold leading-tight outline-none transition-colors disabled:opacity-50 sm:min-h-8 sm:text-[12px]", es ? "border border-border bg-background text-foreground" : "border border-transparent text-muted-foreground hover:text-foreground")}>{o.rotulo}</button>
                        ); })}
                    </div>
                </>
            ) : (
                <label className="block">
                    {rotulo}
                    {c.tipo === "opcion" ? (
                        <select value={String(valor ?? c.defecto)} disabled={apagado} onChange={(e) => alCambiar(e.target.value)} className={cn(CAMPO, cambiado && "border-[var(--accion)]")}>
                            {c.opciones.map((o) => <option key={o.valor} value={o.valor}>{o.rotulo}</option>)}
                        </select>
                    ) : c.tipo === "telefono" ? (
                        <input type="tel" inputMode="tel" autoComplete="off" disabled={apagado} value={String(valor ?? "")} onChange={(e) => alCambiar(e.target.value)} placeholder="+598 9X XXX XXX" className={cn(CAMPO, "tabular-nums", cambiado && "border-[var(--accion)]")} />
                    ) : c.tipo === "texto" ? (
                        <input type="text" autoCapitalize="none" autoCorrect="off" spellCheck={false} autoComplete="off" disabled={apagado} maxLength={c.largo} value={String(valor ?? "")} onChange={(e) => alCambiar(e.target.value)} placeholder={c.ejemplo} className={cn(CAMPO, cambiado && "border-[var(--accion)]")} />
                    ) : null}
                </label>
            )}
            {/* Lo que se cambió se nota, y se puede volver atrás sin acordarse de cuánto era. */}
            {cambiado && !apagado && (
                <button type="button" onClick={() => alCambiar(delEquipo!)} className="mt-1.5 inline-flex items-center gap-1 text-[11.5px] font-semibold text-[var(--accion)] hover:underline">
                    <Undo2 size={12} /> Hoy tiene {dicho(c, delEquipo)}
                </button>
            )}
        </div>
    );
}

/** Cómo dice la señal el equipo, en castellano. Lo que no esté acá se muestra como vino. */
const SENAL_DICHA: Record<string, string> = { strong: "Fuerte", good: "Buena", medium: "Media", normal: "Media", weak: "Débil", low: "Débil", "no signal": "Sin señal" };

/** Lo que contestó el equipo, textual, y cómo quedó. */
function Resultado({ def, x }: { def: DefComando; x: RespuestaComando }) {
    const estado = def.clave === "estado" && x.respuesta ? leerEstadoDelEquipo(x.respuesta) : null;
    /* «Dónde está» y «Enlace al mapa» traen una posición: se la ofrece como enlace, que es para lo que se la pidió. */
    const coord = x.respuesta ? /(-?\d{1,2}\.\d{4,})\s*,\s*(-?\d{1,3}\.\d{4,})/.exec(x.respuesta) || /Lat:\s*([NS])(\d+\.\d+)\s*,\s*Lon:\s*([EW])(\d+\.\d+)/i.exec(x.respuesta) : null;
    const punto = !coord ? null : coord.length === 3 ? { lat: Number(coord[1]), lon: Number(coord[2]) } : { lat: (coord[1].toUpperCase() === "S" ? -1 : 1) * Number(coord[2]), lon: (coord[3].toUpperCase() === "W" ? -1 : 1) * Number(coord[4]) };
    const tono = !x.ok ? "chip-mal" : x.rechazo ? "chip-aviso" : "chip-bien";
    const codigo = x.ok ? codigoDeRechazo(x.respuesta) : null;
    return (
        <div className={cn("rounded-[8px] border px-3 py-2.5", tono)} role="status" aria-live="polite">
            <p className="text-[12px] font-bold">{!x.ok ? "No se mandó o no contestó" : x.rechazo ? "El equipo contestó que no" : "El equipo contestó"}</p>
            <p className="mt-1 break-words text-[13px] leading-snug text-foreground">{x.ok ? `«${x.respuesta || "sin texto"}»` : x.error}</p>
            {/* El fabricante no publica qué quiere decir cada código: se dice eso, y qué probar, en vez de inventarle un significado. */}
            {codigo !== null && (
                <p className="mt-1.5 text-[12px] leading-snug text-foreground">
                    Lo rechazó con el código <span className="font-bold tabular-nums">{codigo}</span>, y no cambió nada. El fabricante no publica qué significa cada código. Suele ser una de dos cosas: la clave del equipo no es la que está cargada, o algún valor no lo admite este modelo. Para saber cuál, mandale los mismos valores que ya tiene: si eso entra, es un valor; si no, es la clave.
                </p>
            )}
            {x.quedo && <p className="mt-1.5 break-words text-[12.5px] leading-snug text-foreground">Y al preguntarle cómo quedó: <span className="font-semibold">«{x.quedo}»</span></p>}
            {x.ok && def.nivel !== "consulta" && def.pregunta && x.quedo === null && !def.puedeCallar && <p className="mt-1.5 text-[12px] leading-snug text-foreground">No contestó cuando se le preguntó cómo quedó. Tocá la flecha de la tarjeta para leerlo de nuevo.</p>}
            {estado && (
                <dl className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-1.5 text-[12.5px] text-foreground @md:grid-cols-3">
                    {([["Alimentación", estado.alimentacion ? estado.alimentacion.replace(".", ",").replace(/\s*V$/i, " V") : null], ["Enlace de datos", estado.enlace === null ? null : estado.enlace ? "Arriba" : "Caído"], ["Señal", estado.senal ? SENAL_DICHA[estado.senal.toLowerCase()] || estado.senal : null], ["GPS", estado.gps === null ? null : estado.gps ? "Despierto" : "Dormido"], ["Contacto", estado.contacto === null ? null : estado.contacto ? "Puesto" : "Cortado"], ["Guardia", estado.guardia === null ? null : estado.guardia ? "Puesta" : "Sin poner"]] as [string, string | null][])
                        .filter(([, v]) => v !== null).map(([k, v]) => <div key={k}><dt className="text-[11px] opacity-70">{k}</dt><dd className="font-semibold">{v}</dd></div>)}
                </dl>
            )}
            {punto && Number.isFinite(punto.lat) && Number.isFinite(punto.lon) && (
                <a href={`https://maps.google.com/?q=${punto.lat},${punto.lon}`} target="_blank" rel="noreferrer" className="mt-2 inline-flex h-10 items-center gap-1.5 text-[13px] font-semibold text-[var(--accion)] hover:underline sm:h-auto"><MapPin size={14} /> Abrir esa posición en el mapa</a>
            )}
        </div>
    );
}
