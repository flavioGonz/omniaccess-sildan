"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    BatteryLow, BellRing, Car, ChevronDown, CloudOff, Gauge, History, Loader2, Lock, LogIn, LogOut, MapPinOff, Satellite, ShieldOff, Siren,
    Unplug, Vibrate, Waypoints, Wifi, WifiOff, X,
} from "lucide-react";
import { historialEventosGps, type EventoGps, type HistorialEventosGps, type Rastreador } from "@/app/actions/gps";
import { CLASES_EVENTO_GPS, demoraLegible, fichaDeEventoGps, plegarEventos, tituloDeEventoGps, type ClaseEventoGps, type DibujoEventoGps } from "@/lib/gps-eventos";
import { nivel } from "@/lib/centrales/prioridades";
import { useTiempoReal } from "@/lib/tiempo-real";
import { ErrorEstado, Vacio } from "@/components/ui/estados";
import { fechaCorta, hace, hora, horaSeg, paraInput } from "@/lib/fechas";
import { cn } from "@/lib/utils";

/**
 * El cajón de eventos de un rastreador, sobre el mapa.
 *
 * Pedido de Nico (21/11): «Ver sus eventos debe ser un drawer premium, con la lista de todos los
 * eventos que le ocurrieron; al presionar cada evento, llevar a su posición de ese evento».
 *
 * Lo que había era un cuadrito de 320 px con los últimos cuarenta, sin los de satélites ni los
 * del relé, y con una hora y un texto por renglón. Para un operador eso no es un historial: no
 * se puede filtrar, no llega más atrás, y el día que hubo 62 vibraciones el único corte de
 * alimentación quedaba enterrado.
 *
 * Cómo está pensado:
 *  · **Es una línea de tiempo**, del más nuevo al más viejo, cortada por día. El riel de la
 *    izquierda lleva el dibujo y el tono de cada cosa: rojo lo que es una alarma, ámbar lo que
 *    hay que mirar, verde lo que se resolvió, gris el ruido.
 *  · **Las pestañas son los números**: cuántas alarmas, cuántos cruces de geocerca, cuántos cortes
 *    de conexión hubo en el período. Tocar una filtra.
 *  · **Las rachas de ruido se pliegan** (lib/gps-eventos): «Vibración · 12 veces» en un renglón
 *    que se abre. Las alarmas nunca se pliegan.
 *  · **Tocar un evento lleva el mapa a donde pasó**, con un pin y el tramo que venía recorriendo
 *    (lo dibuja CapaGps). Con ↑ y ↓ se recorre la lista y el mapa va acompañando: es la forma
 *    rápida de reconstruir una noche.
 *  · **La hora es la del equipo.** Si la noticia llegó tarde (estuvo sin señal), se dice cuánto.
 *  · Lo que pasa mientras está abierto entra arriba, solo.
 *
 * El cajón no tapa el mapa entero a propósito: la mitad del valor está en ver la lista y el punto
 * a la vez.
 */

const PERIODOS: { dias: number | null; rotulo: string }[] = [
    { dias: 1, rotulo: "24 h" }, { dias: 7, rotulo: "7 días" }, { dias: 30, rotulo: "30 días" }, { dias: null, rotulo: "Todo" },
];
const POR_PAGINA = 80;

const DIBUJO: Record<DibujoEventoGps, typeof Siren> = {
    sos: Siren, corte: Unplug, vibracion: Vibrate, velocidad: Gauge, movimiento: Car, bateria: BatteryLow, desarme: ShieldOff, alarma: BellRing,
    entra: LogIn, sale: LogOut, sinsat: CloudOff, consat: Satellite, silencio: WifiOff, volvio: Wifi, salto: Waypoints, rele: Lock,
};

/** «Hoy», «Ayer» o «jue 19 nov»: el corte de la lista. La clave es el día en la zona del barrio. */
function diaDe(iso: string): { clave: string; rotulo: string } {
    const clave = paraInput(iso);
    const hoy = paraInput(new Date()), ayer = paraInput(new Date(Date.now() - 86_400_000));
    if (clave === hoy) return { clave, rotulo: "Hoy" };
    if (clave === ayer) return { clave, rotulo: "Ayer" };
    return { clave, rotulo: fechaCorta(iso) };
}

export function CajonEventosGps({ imei, rastreador, elegido, alElegir, alCerrar, refresco }: {
    imei: string;
    rastreador: Rastreador | undefined;
    /** El evento que está marcado en el mapa. */
    elegido: string | null;
    alElegir: (e: EventoGps | null) => void;
    alCerrar: () => void;
    /** Cambia cuando la capa sabe que hay algo nuevo que este cajón no recibe por el socket (el relé). */
    refresco: number;
}) {
    const [clase, setClase] = useState<ClaseEventoGps | null>(null);
    const [dias, setDias] = useState<number | null>(7);
    const [datos, setDatos] = useState<HistorialEventosGps | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [trayendoMas, setTrayendoMas] = useState(false);
    const [abiertos, setAbiertos] = useState<Set<string>>(new Set());
    /** Los que acaban de entrar por el socket: se destacan un momento. */
    const [recien, setRecien] = useState<Set<string>>(new Set());
    const caja = useRef<HTMLElement>(null);
    const lista = useRef<HTMLDivElement>(null);
    /** Para descartar la respuesta de un pedido que ya no es el que se está mirando. */
    const pedido = useRef(0);

    const traer = useCallback(async () => {
        const n = ++pedido.current;
        setError(null);
        try {
            const r = await historialEventosGps({ imei, clase, dias, cuantos: POR_PAGINA });
            if (n === pedido.current) setDatos(r);
        } catch (e) {
            if (n === pedido.current) setError(e instanceof Error ? e.message : "No se pudo traer el historial.");
        }
    }, [imei, clase, dias]);
    useEffect(() => { setDatos(null); setAbiertos(new Set()); traer(); }, [traer]);
    useEffect(() => { if (refresco) traer(); }, [refresco, traer]);

    const traerMas = async () => {
        if (!datos || !datos.eventos.length || trayendoMas) return;
        setTrayendoMas(true);
        const n = pedido.current;
        try {
            const r = await historialEventosGps({ imei, clase, dias, cuantos: POR_PAGINA, antes: datos.eventos[datos.eventos.length - 1].cuando });
            if (n !== pedido.current) return;
            setDatos((v) => (v ? { ...v, eventos: [...v.eventos, ...r.eventos.filter((x) => !v.eventos.some((y) => y.id === x.id))], hayMas: r.hayMas } : v));
        } catch { setError("No se pudieron traer los más antiguos."); }
        finally { setTrayendoMas(false); }
    };

    /* Lo que pasa mientras el cajón está abierto entra arriba, sin volver a pedir la lista. */
    useTiempoReal<EventoGps & { nombre?: string }>("gps_evento", (d) => {
        if (d.imei !== imei || !d.id) return;
        const f = fichaDeEventoGps(d.tipo);
        setDatos((v) => {
            if (!v || v.eventos.some((x) => x.id === d.id)) return v;
            const cuenta = { ...v.cuenta, [f.clase]: v.cuenta[f.clase] + 1 };
            if (clase && f.clase !== clase) return { ...v, cuenta };
            const e: EventoGps = { id: d.id, imei: d.imei, tipo: d.tipo, cuando: d.cuando, detalle: d.detalle || null, lat: d.lat ?? null, lon: d.lon ?? null, tarde: d.tarde || null, prioridad: d.prioridad ?? null, lugar: d.lugar ?? null };
            /* Uno atrasado no va arriba: va en su hora. */
            return { ...v, cuenta, eventos: [...v.eventos, e].sort((a, b) => (a.cuando < b.cuando ? 1 : a.cuando > b.cuando ? -1 : 0)) };
        });
        setRecien((s) => new Set(s).add(d.id));
        setTimeout(() => setRecien((s) => { const o = new Set(s); o.delete(d.id); return o; }), 6000);
    });

    const grupos = useMemo(() => plegarEventos(datos?.eventos || []), [datos]);
    /** Lo que se puede recorrer con las flechas, en el orden en que se ve: sólo lo desplegado. */
    const recorribles = useMemo(() => grupos.flatMap((g) => (g.eventos.length === 1 || abiertos.has(g.clave) ? g.eventos : [])), [grupos, abiertos]);

    /* El foco entra al cajón al abrirse: Escape y las flechas tienen que andar sin un clic previo. */
    useEffect(() => { caja.current?.focus(); }, []);
    /* El elegido siempre a la vista: al recorrer con flechas la lista acompaña. */
    useEffect(() => {
        if (!elegido) return;
        lista.current?.querySelector<HTMLElement>(`[data-ev="${elegido}"]`)?.scrollIntoView({ block: "nearest" });
    }, [elegido]);

    const tecla = (e: React.KeyboardEvent) => {
        if (e.key === "Escape") { e.stopPropagation(); if (elegido) alElegir(null); else alCerrar(); return; }
        if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
        if ((e.target as HTMLElement).tagName === "INPUT") return;
        e.preventDefault();
        if (!recorribles.length) return;
        const i = recorribles.findIndex((x) => x.id === elegido);
        const sig = i < 0 ? 0 : Math.min(recorribles.length - 1, Math.max(0, i + (e.key === "ArrowDown" ? 1 : -1)));
        alElegir(recorribles[sig]);
    };

    const total = datos ? datos.cuenta.alarma + datos.cuenta.geocerca + datos.cuenta.conexion + datos.cuenta.equipo : null;
    const nombre = rastreador?.nombre || `Rastreador ${imei.slice(-6)}`;
    /* El estado en una línea, con el mismo criterio que el mapa: callado pesa más que todo lo demás. */
    const estado = !rastreador ? null
        : rastreador.sinReporteDesde ? { tono: "tono-mal", punto: "bg-[var(--mal)]", texto: `Dejó de reportar ${hace(rastreador.sinReporteDesde)}` }
            : rastreador.enLinea ? { tono: "tono-bien", punto: "bg-[var(--bien)]", texto: `En línea · reportó ${hace(rastreador.ultimoLatido)}` }
                : { tono: "text-muted-foreground", punto: "bg-muted-foreground/50", texto: `Sin reportar desde ${hace(rastreador.ultimoLatido, "nunca")}` };

    let diaAnterior = "";

    return (
        <aside ref={caja} data-cajon-gps tabIndex={-1} role="dialog" aria-label={`Eventos de ${nombre}`} onKeyDown={tecla} onClick={(e) => e.stopPropagation()}
            className="cajon-gps fixed z-[520] top-[76px] right-3 bottom-3 w-[min(420px,calc(100vw-24px))] flex flex-col rounded-[14px] border border-border bg-popover shadow-2xl overflow-hidden outline-none">
            {/* La entrada del cajón y el destello de lo recién llegado. Sin movimiento si el sistema lo pide. */}
            <style>{`
                .cajon-gps { animation: cajon-gps-entra .28s cubic-bezier(.2,.8,.2,1) both; }
                @keyframes cajon-gps-entra { from { opacity: 0; transform: translateX(18px); } to { opacity: 1; transform: translateX(0); } }
                .ev-recien { animation: ev-recien 6s ease-out both; }
                @keyframes ev-recien { 0%, 25% { background: color-mix(in oklab, var(--accion) 16%, transparent); } 100% { background: transparent; } }
                @media (prefers-reduced-motion: reduce) { .cajon-gps, .ev-recien { animation: none; } }
            `}</style>

            <header className="px-4 pt-3.5 pb-3 border-b border-border">
                <div className="flex items-start gap-3">
                    <span className="h-9 w-9 shrink-0 grid place-items-center rounded-full bg-muted text-foreground/80"><History size={17} /></span>
                    <div className="min-w-0 flex-1">
                        <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Eventos</p>
                        <h2 className="text-[15px] font-bold tracking-tight truncate leading-tight">{nombre}</h2>
                        {estado && (
                            <p className={cn("mt-0.5 text-[11.5px] flex items-center gap-1.5 min-w-0", estado.tono)}>
                                <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", estado.punto)} />
                                <span className="truncate">{rastreador?.matricula ? `${rastreador.matricula} · ` : ""}{estado.texto}</span>
                            </p>
                        )}
                    </div>
                    <button type="button" onClick={alCerrar} aria-label="Cerrar" className="h-8 w-8 -mr-1 grid place-items-center rounded-[6px] text-muted-foreground hover:bg-accent"><X size={15} /></button>
                </div>

                {/* Las pestañas son los números del período: se lee cuánto hubo de cada cosa y se filtra con el mismo gesto. */}
                <div className="mt-3 flex flex-wrap gap-1.5" role="tablist" aria-label="Qué eventos se ven">
                    <Pestania activa={clase === null} onClick={() => setClase(null)} rotulo="Todos" n={total} />
                    {CLASES_EVENTO_GPS.map((c) => (
                        <Pestania key={c.clave} activa={clase === c.clave} onClick={() => setClase(clase === c.clave ? null : c.clave)} rotulo={c.rotulo} n={datos ? datos.cuenta[c.clave] : null}
                            alerta={c.clave === "alarma" && !!datos?.cuenta.alarma} />
                    ))}
                </div>
                <div className="mt-2 flex items-center gap-1" role="group" aria-label="Período">
                    {PERIODOS.map((p) => (
                        <button key={p.rotulo} type="button" onClick={() => setDias(p.dias)} aria-pressed={dias === p.dias}
                            className={cn("h-6 px-2 rounded-[6px] text-[11px] font-semibold", dias === p.dias ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground")}>{p.rotulo}</button>
                    ))}
                </div>
            </header>

            <div ref={lista} className="flex-1 overflow-y-auto [scrollbar-width:thin]">
                {error && !datos ? <ErrorEstado mensaje={error} alReintentar={traer} titulo="No se pudo traer el historial" />
                    : !datos ? <Esqueleto />
                        : grupos.length === 0 ? (
                            <Vacio icono={History}
                                titulo={clase ? "No hubo ninguno de esos en el período" : "No le pasó nada en el período"}
                                ayuda={dias ? "Probá con un período más largo, o con «Todo»." : "Cuando el rastreador avise algo, o cruce una geocerca, aparece acá."} />
                        ) : (
                            <ol className="pb-2">
                                {grupos.map((g) => {
                                    const primero = g.eventos[0];
                                    const d = diaDe(primero.cuando);
                                    const corte = d.clave !== diaAnterior; diaAnterior = d.clave;
                                    const abierto = abiertos.has(g.clave);
                                    return (
                                        <React.Fragment key={g.clave}>
                                            {corte && (
                                                <li aria-hidden className="sticky top-0 z-[1] px-4 py-1.5 bg-popover/95 backdrop-blur-sm border-b border-border/60 text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground">{d.rotulo}</li>
                                            )}
                                            {g.eventos.length === 1 ? (
                                                <Renglon e={primero} elegido={elegido === primero.id} recien={recien.has(primero.id)} alElegir={alElegir} />
                                            ) : (
                                                <li>
                                                    <Racha eventos={g.eventos} abierta={abierto}
                                                        alternar={() => setAbiertos((s) => { const o = new Set(s); if (o.has(g.clave)) o.delete(g.clave); else o.add(g.clave); return o; })} />
                                                    {abierto && <ol className="bg-muted/30">{g.eventos.map((e) => <Renglon key={e.id} e={e} elegido={elegido === e.id} recien={false} alElegir={alElegir} chico />)}</ol>}
                                                </li>
                                            )}
                                        </React.Fragment>
                                    );
                                })}
                            </ol>
                        )}
                {datos && grupos.length > 0 && (
                    <div className="px-4 pb-4 pt-1">
                        {datos.hayMas ? (
                            <button type="button" onClick={traerMas} disabled={trayendoMas}
                                className="w-full h-8 inline-flex items-center justify-center gap-2 rounded-[6px] border border-border text-[12px] font-semibold hover:bg-accent disabled:opacity-60">
                                {trayendoMas && <Loader2 size={13} className="animate-spin" />} Traer más antiguos
                            </button>
                        ) : <p className="text-center text-[11px] text-muted-foreground">Es todo lo que hay{dias ? " en el período" : ""}.</p>}
                        {error && <p className="mt-2 text-center text-[11px] tono-aviso">{error}</p>}
                    </div>
                )}
            </div>

            <footer className="px-4 py-2 border-t border-border text-[10.5px] text-muted-foreground flex items-center gap-3">
                <span>Tocá un evento para ir a donde pasó.</span>
                <span className="ml-auto whitespace-nowrap"><kbd className="font-sans font-semibold">↑ ↓</kbd> recorrer · <kbd className="font-sans font-semibold">Esc</kbd> {elegido ? "soltar" : "cerrar"}</span>
            </footer>
        </aside>
    );
}

/** Una pestaña con su número. La píldora es elección (prende y apaga), no acción. */
function Pestania({ activa, onClick, rotulo, n, alerta }: { activa: boolean; onClick: () => void; rotulo: string; n: number | null; alerta?: boolean }) {
    return (
        <button type="button" role="tab" aria-selected={activa} onClick={onClick}
            className={cn("h-7 pl-2.5 pr-2 rounded-full border text-[11.5px] font-semibold inline-flex items-center gap-1.5 transition-colors",
                activa ? "bg-foreground text-background border-foreground" : "border-border hover:bg-accent")}>
            {rotulo}
            <span className={cn("min-w-[18px] h-[18px] px-1 rounded-full text-[10.5px] tabular-nums grid place-items-center",
                activa ? "bg-background/20" : alerta ? "pleno-mal" : "bg-muted text-muted-foreground")}>{n === null ? "·" : n > 999 ? "999+" : n}</span>
        </button>
    );
}

/** El dibujo de un evento en su círculo, sobre el riel de la línea de tiempo. */
function Punto({ tipo, chico, cuenta }: { tipo: string; chico?: boolean; cuenta?: number }) {
    const f = fichaDeEventoGps(tipo);
    const I = DIBUJO[f.dibujo];
    return (
        <span className={cn("relative z-[1] shrink-0 grid place-items-center rounded-full border", `chip-${f.tono}`, chico ? "h-6 w-6" : "h-8 w-8")}>
            <I size={chico ? 12 : 15} />
            {cuenta ? <span className="absolute -top-1.5 -right-2 min-w-[18px] h-[16px] px-1 rounded-full bg-foreground text-background text-[9.5px] font-bold tabular-nums grid place-items-center">{cuenta}</span> : null}
        </span>
    );
}

/** El riel: una línea fina detrás de los círculos, que es lo que hace leer la lista como un recorrido en el tiempo. */
const Riel = ({ chico }: { chico?: boolean }) => <span aria-hidden className={cn("absolute top-0 bottom-0 w-px bg-border", chico ? "left-[43px]" : "left-[31px]")} />;

function Renglon({ e, elegido, recien, alElegir, chico }: { e: EventoGps; elegido: boolean; recien: boolean; alElegir: (e: EventoGps | null) => void; chico?: boolean }) {
    const { titulo, resto } = tituloDeEventoGps(e);
    const conLugar = e.lat !== null && e.lon !== null;
    const demora = demoraLegible(e.tarde);
    const segunda = [resto, e.lugar].filter(Boolean).join(" · ");
    return (
        <li className="relative">
            <Riel chico={chico} />
            <button type="button" data-ev={e.id} aria-pressed={elegido} onClick={() => alElegir(elegido ? null : e)}
                title={conLugar ? undefined : "Este evento llegó sin posición: el equipo no tenía satélites y no se sabía dónde estaba."}
                className={cn("relative w-full text-left flex items-start gap-3 pr-4 transition-colors outline-none focus-visible:bg-accent",
                    chico ? "pl-8 py-1.5" : "pl-4 py-2.5",
                    elegido ? "bg-[color-mix(in_oklab,var(--accion)_12%,transparent)]" : "hover:bg-accent/70", recien && !elegido && "ev-recien")}>
                {elegido && <span aria-hidden className="absolute left-0 top-0 bottom-0 w-[3px] bg-[var(--accion)]" />}
                <Punto tipo={e.tipo} chico={chico} />
                <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-2">
                        <span className={cn("min-w-0 flex-1 truncate font-semibold", chico ? "text-[12px]" : "text-[13px]")}>{titulo}</span>
                        <time dateTime={e.cuando} title={horaSeg(e.cuando)} className="shrink-0 text-[12px] font-semibold tabular-nums text-foreground/80">{chico ? horaSeg(e.cuando) : hora(e.cuando)}</time>
                    </span>
                    {(segunda || !conLugar) && !chico && (
                        <span className="mt-0.5 flex items-center gap-1.5 text-[11.5px] text-muted-foreground min-w-0">
                            {!conLugar && <MapPinOff size={11} className="shrink-0" />}
                            <span className="truncate">{segunda || "Sin posición"}</span>
                        </span>
                    )}
                    {(e.prioridad !== null || demora) && (
                        <span className="mt-1 flex flex-wrap items-center gap-1">
                            {e.prioridad !== null && <span className={cn("h-[18px] px-1.5 rounded-full border text-[10px] font-bold inline-flex items-center", `chip-${nivel(e.prioridad).tono}`)} title="Abrió un caso en Gestión de alarmas">P{e.prioridad} · {nivel(e.prioridad).nombre}</span>}
                            {demora && <span className="h-[18px] px-1.5 rounded-full border chip-aviso text-[10px] font-semibold inline-flex items-center" title="El equipo estuvo sin señal: lo guardó y lo mandó después. La hora es la del momento en que pasó.">llegó {demora} tarde</span>}
                        </span>
                    )}
                </span>
            </button>
        </li>
    );
}

/** Una racha plegada: «Vibración · 12 veces», de tal hora a tal hora. */
function Racha({ eventos, abierta, alternar }: { eventos: EventoGps[]; abierta: boolean; alternar: () => void }) {
    const nuevo = eventos[0], viejo = eventos[eventos.length - 1];
    const f = fichaDeEventoGps(nuevo.tipo);
    const esSatelites = nuevo.tipo === "GPS_SIN_SATELITES" || nuevo.tipo === "GPS_CON_SATELITES";
    return (
        <div className="relative">
            <Riel />
            <button type="button" onClick={alternar} aria-expanded={abierta}
                className="relative w-full text-left flex items-center gap-3 pl-4 pr-4 py-2.5 hover:bg-accent/70 outline-none focus-visible:bg-accent">
                <Punto tipo={esSatelites ? "GPS_SIN_SATELITES" : nuevo.tipo} cuenta={eventos.length} />
                <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-semibold truncate">{esSatelites ? "Perdió y recuperó los satélites" : f.rotulo} <span className="font-normal text-muted-foreground">· {eventos.length} veces</span></span>
                    <span className="block mt-0.5 text-[11.5px] text-muted-foreground tabular-nums">{hora(viejo.cuando)} → {hora(nuevo.cuando)}</span>
                </span>
                <ChevronDown size={15} className={cn("shrink-0 text-muted-foreground transition-transform", abierta && "rotate-180")} />
            </button>
        </div>
    );
}

/** Mientras llega: la forma de la lista, no una rueda sola en el medio de un cajón vacío. */
function Esqueleto() {
    return (
        <div className="px-4 py-3 space-y-4" aria-busy="true" aria-label="Trayendo el historial">
            {[62, 48, 70, 40, 56, 66].map((w, i) => (
                <div key={i} className="flex items-center gap-3 animate-pulse">
                    <span className="h-8 w-8 rounded-full bg-muted shrink-0" />
                    <span className="flex-1 space-y-1.5"><span className="block h-3 rounded bg-muted" style={{ width: `${w}%` }} /><span className="block h-2.5 rounded bg-muted/60" style={{ width: `${w - 20}%` }} /></span>
                    <span className="h-3 w-9 rounded bg-muted" />
                </div>
            ))}
        </div>
    );
}
