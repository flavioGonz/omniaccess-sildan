"use client";

import { useEffect, useMemo, useState } from "react";
import { Activity, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { diaSemana, fechaCorta, fechaNumerica, horaSeg } from "@/lib/fechas";
import { leerDuracion } from "@/components/tracking/Cronometro";
import { NOMBRE_CLASE } from "@/lib/visitas/calculos";
import { claveDePaso, type PasoVisor } from "./TiraPasos";

/** Lo que /api/history/ficha devuelve como `comportamiento`. */
export type ComportamientoVisor = {
    dias: number;
    pasos: (PasoVisor & { id: string; momento: string })[];
    /** 7 × 24: [0] es lunes, cada fila son las horas 0..23, en la hora del barrio. */
    franja: number[][];
    perfil: {
        clase: string; diasVistos: number; entradas: number; salidas: number;
        primeraVez: string; ultimaVez: string;
        permanenciaMedianaMin: number | null; permanenciaP90Min: number | null;
        /** Armado con los pasos porque la chapa no tiene perfil calculado todavía. */
        estimado?: boolean;
    } | null;
};

/**
 * Una entrada y una salida más separadas que esto no son la misma estadía: es una salida que no
 * se leyó y otra entrada mucho después. Unirlas dibujaría una permanencia de semanas que nadie vio.
 */
const ESTADIA_MAX_MS = 3 * 86_400_000;
/** Una entrada sin salida más nueva que esto se dibuja abierta («sin salida todavía»); más vieja, cortada. */
const ABIERTA_RECIENTE_MS = 24 * 3_600_000;

const DIAS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
/** Alto de cada renglón del grafo y de los separadores de día. Fijo: el grafo se dibuja por renglón. */
const ALTO_PASO = 40;
const ALTO_DIA = 30;
/** Las dos vías: afuera (la línea de tiempo) y adentro (la rama de cada estadía). */
const VIA_AFUERA = 12;
const VIA_ADENTRO = 32;
const ANCHO_GRAFO = 44;
const COLOR_RAMA = "var(--accion)";

type Item =
    | { k: "dia"; clave: string; texto: string }
    | { k: "paso"; clave: string; p: PasoVisor; dur?: number | null; sinSalida?: boolean; abierta?: boolean };

/**
 * El comportamiento de una chapa, a la manera de un historial de git.
 *
 * La pregunta que se hace un guardia mirando los pasos de un auto no es «¿cuándo pasó?» sino
 * «¿cuándo estuvo adentro, y cuánto?». En una lista de pasos eso hay que armarlo de cabeza,
 * emparejando cada salida con su entrada. Acá viene dibujado: la línea de tiempo es la vía de
 * afuera, cada entrada abre una rama a la vía de adentro y la salida la vuelve a unir — como un
 * branch y su merge. Una rama larga es una estadía larga; una entrada que no vuelve es una salida
 * que la cámara no leyó (y se dice así, no se inventa).
 *
 * Arriba, la franja día × hora: cuándo se lo ve en la semana. Un repartidor dibuja una mancha en
 * la mañana de lunes a viernes; un vecino, dos franjas a la hora de ir y volver.
 */
export function PanelComportamiento({ plate, datos, viendo, onElegir, onCerrar }: {
    plate: string;
    datos: ComportamientoVisor;
    viendo?: string | null;
    onElegir: (p: PasoVisor) => void;
    onCerrar: () => void;
}) {
    return (
        /* Sigue el tema (18/10, Nico: «lo mismo para comportamiento»), como la ficha del visor:
           era un panel casi negro con el blanco escrito a mano, también en tema claro. */
        <aside className="absolute right-0 top-0 bottom-0 z-[45] w-[min(500px,50vw)] flex flex-col cajon-vidrio cajon-denso border-l border-border shadow-[0_0_60px_rgba(0,0,0,0.35)] text-foreground animate-in slide-in-from-right-4 duration-200">
            <header className="shrink-0 flex items-start justify-between gap-3 px-5 pt-4 pb-3 border-b border-border">
                <div>
                    <h2 className="flex items-center gap-2 text-[15px] font-bold tracking-[-0.01em]"><Activity size={16} className="text-muted-foreground" /> Comportamiento</h2>
                    <p className="text-[12px] text-muted-foreground mt-0.5"><b className="text-foreground tracking-wider">{plate}</b> · últimos {datos.dias} días · {datos.pasos.length} {datos.pasos.length === 1 ? "paso" : "pasos"}</p>
                </div>
                <button type="button" onClick={onCerrar} aria-label="Cerrar" title="Cerrar  ( Esc )" className="w-8 h-8 rounded-[8px] grid place-items-center text-foreground/80 hover:text-foreground hover:bg-muted"><X size={16} /></button>
            </header>
            <div className="flex-1 min-h-0 overflow-y-auto [scrollbar-width:thin]">
                <ContenidoComportamiento datos={datos} viendo={viendo} onElegir={onElegir} />
            </div>
        </aside>
    );
}

/**
 * Lo de adentro del panel (cifras, franja día × hora y el grafo de estadías), sin el marco: lo usa
 * también el cajón de Gestión de alarmas (18/10, Nico: «en el drawer de la alarma debe tener el
 * comportamiento, similar al de git»). Sin `onElegir`, los pasos no se tocan.
 */
export function ContenidoComportamiento({ datos, viendo, onElegir, compacto }: {
    datos: ComportamientoVisor;
    viendo?: string | null;
    onElegir?: (p: PasoVisor) => void;
    /** En un cajón angosto: las cifras en dos columnas y sin márgenes laterales propios. */
    compacto?: boolean;
}) {
    const { items, pasa, unen, abren, cortadas, arribaAbierta, estadias } = useMemo(() => armarGrafo(datos.pasos), [datos.pasos]);
    const max = Math.max(1, ...datos.franja.flat());
    const perfil = datos.perfil;
    const mediana = perfil?.permanenciaMedianaMin ?? (estadias.length ? Math.round([...estadias].sort((a, b) => a - b)[Math.floor(estadias.length / 2)] / 60000) : null);
    const px = compacto ? "px-0" : "px-5";

    return (
        <>
                {/* El perfil, en cifras. */}
                <div className={cn("grid border-b border-border", compacto ? "grid-cols-3 [&>div]:px-2" : "grid-cols-3")}>
                    <Cifra rotulo="Clase" valor={perfil ? (NOMBRE_CLASE as Record<string, string>)[perfil.clase] || perfil.clase : "—"}
                        sub={perfil?.estimado ? `por sus pasos de ${datos.dias} días` : undefined} />
                    <Cifra rotulo="Entradas · salidas" valor={perfil ? `${perfil.entradas} · ${perfil.salidas}` : `${datos.pasos.filter((p) => p.direccion === "ENTRY").length} · ${datos.pasos.filter((p) => p.direccion === "EXIT").length}`} />
                    <Cifra rotulo="Se queda (típico)" valor={mediana != null ? leerDuracion(mediana * 60000) : "—"}
                        sub={perfil?.permanenciaP90Min != null ? `9 de 10, menos de ${leerDuracion(perfil.permanenciaP90Min * 60000)}` : undefined} />
                    <Cifra rotulo="Días visto" valor={perfil ? String(perfil.diasVistos) : "—"} />
                    <Cifra rotulo="Primera vez" valor={perfil ? fechaCorta(perfil.primeraVez) : "—"} />
                    <Cifra rotulo="Última vez" valor={perfil ? fechaCorta(perfil.ultimaVez) : "—"} />
                </div>

                {/* La franja: cuándo se lo ve en la semana. */}
                <section className={cn(px, "py-4 border-b border-border")}>
                    <h3 className="text-[9.5px] font-bold uppercase tracking-[0.14em] text-muted-foreground mb-2.5">Cuándo se lo ve</h3>
                    <div className="grid grid-cols-[28px_1fr] gap-x-1.5 gap-y-[3px]">
                        {datos.franja.map((fila, d) => (
                            <div key={d} className="contents">
                                <span className="text-[10.5px] text-muted-foreground leading-[14px]">{DIAS[d]}</span>
                                <div className="grid gap-[2px]" style={{ gridTemplateColumns: "repeat(24, minmax(0, 1fr))" }}>
                                    {fila.map((n, h) => (
                                        <span key={h} title={`${DIAS[d]} ${String(h).padStart(2, "0")} h · ${n} ${n === 1 ? "paso" : "pasos"}`}
                                            className="h-[14px] rounded-[2px]"
                                            style={{ background: n ? `color-mix(in oklab, ${COLOR_RAMA} ${Math.round(25 + 75 * (n / max))}%, transparent)` : "color-mix(in oklab, var(--foreground) 6%, transparent)" }} />
                                    ))}
                                </div>
                            </div>
                        ))}
                        <span />
                        <div className="flex justify-between text-[10px] text-muted-foreground tabular-nums mt-1">
                            <span>0 h</span><span>6 h</span><span>12 h</span><span>18 h</span><span>24 h</span>
                        </div>
                    </div>
                </section>

                {/* El grafo de estadías. */}
                <section className={compacto ? "py-3" : "px-3 py-3"}>
                    <div className="flex items-center justify-between px-2 mb-1.5">
                        <h3 className="text-[9.5px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Entradas y salidas</h3>
                        <span className="flex items-center gap-3 text-[10.5px] text-muted-foreground">
                            <span className="flex items-center gap-1.5"><span className="w-3 h-[2px] bg-foreground/40" /> afuera</span>
                            <span className="flex items-center gap-1.5"><span className="w-3 h-[2px]" style={{ background: COLOR_RAMA }} /> adentro</span>
                        </span>
                    </div>
                    {!items.length ? <p className="px-2 text-[12px] text-muted-foreground">No hay pasos en los últimos {datos.dias} días.</p> : (
                        <ol>
                            {items.map((it, i) => {
                                const alto = it.k === "dia" ? ALTO_DIA : ALTO_PASO;
                                const grafo = (
                                    <Grafo alto={alto} primero={i === 0} ultimo={i === items.length - 1}
                                        pasa={pasa[i]} une={unen.has(i)} abre={abren.has(i)} cortada={cortadas.has(i)}
                                        abiertaArriba={i === 0 && arribaAbierta}
                                        nodo={it.k === "paso" ? it.p : null} actual={it.k === "paso" && (!!it.p.actual || viendo === it.clave)} />
                                );
                                if (it.k === "dia") {
                                    return (
                                        <li key={it.clave} className="flex items-center" style={{ height: alto }}>
                                            {grafo}
                                            <span className="text-[11px] font-semibold text-muted-foreground first-letter:uppercase">{it.texto}</span>
                                        </li>
                                    );
                                }
                                const p = it.p;
                                const salida = p.direccion === "EXIT";
                                const negado = p.decision === "DENY";
                                const verbo = negado ? "No abrió" : p.direccion === "ENTRY" ? "Entró" : salida ? "Salió" : "Pasó";
                                return (
                                    <li key={it.clave} style={{ height: alto }}>
                                        <button type="button" disabled={!p.foto || !onElegir} onClick={() => onElegir?.({ ...p, id: it.clave })}
                                            className={cn("w-full h-full flex items-center rounded-[6px] pr-2 text-left transition-colors disabled:cursor-default",
                                                viendo === it.clave ? "bg-muted" : onElegir ? "hover:bg-muted" : "")}>
                                            {grafo}
                                            <span className="flex-1 min-w-0">
                                                <span className="flex items-baseline gap-2 text-[12.5px]">
                                                    <span className={cn("font-semibold", negado ? "tono-mal" : "text-foreground")}>{verbo}</span>
                                                    <span className="text-muted-foreground truncate">{p.camara || "Cámara sin nombre"}</span>
                                                    {p.actual && <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--accion)]">este evento</span>}
                                                </span>
                                                {it.dur != null && <span className="block text-[11px] tabular-nums" style={{ color: COLOR_RAMA }}>estuvo {leerDuracion(it.dur)}</span>}
                                                {it.sinSalida && <span className="block text-[11px] text-muted-foreground">sin salida registrada</span>}
                                                {it.abierta && <span className="block text-[11px] text-muted-foreground">sin salida todavía</span>}
                                            </span>
                                            <span className="text-[11.5px] text-muted-foreground tabular-nums shrink-0">{horaSeg(p.momento)}</span>
                                        </button>
                                    </li>
                                );
                            })}
                        </ol>
                    )}
                </section>
        </>
    );
}

/**
 * El comportamiento de una chapa pedido por su cuenta (/api/history/ficha), para quien no tiene la
 * ficha a mano: el cajón de Gestión de alarmas. Con sus estados: cargando, error, sin pasos.
 */
export function ComportamientoDeChapa({ plate, momento, evento }: { plate: string; momento: string; evento?: string | null }) {
    const [estado, setEstado] = useState<{ cargando: boolean; datos: ComportamientoVisor | null; error: string | null }>({ cargando: true, datos: null, error: null });
    const [vuelta, setVuelta] = useState(0);
    useEffect(() => {
        let vivo = true;
        setEstado({ cargando: true, datos: null, error: null });
        const q = new URLSearchParams({ plate, momento });
        if (evento) q.set("evento", evento);
        fetch(`/api/history/ficha?${q}`, { cache: "no-store" })
            .then(async (r) => { if (!r.ok) throw new Error(`El servidor respondió ${r.status}`); return r.json(); })
            .then((j) => { if (vivo) setEstado({ cargando: false, datos: j?.comportamiento || null, error: null }); })
            .catch((e) => { if (vivo) setEstado({ cargando: false, datos: null, error: e?.message || "No se pudo traer" }); });
        return () => { vivo = false; };
    }, [plate, momento, evento, vuelta]);
    if (estado.cargando) return <div className="py-3 text-[12px] text-muted-foreground flex items-center gap-2"><Activity size={13} className="animate-pulse" /> Armando el comportamiento de {plate}…</div>;
    if (estado.error) return <div className="py-3 text-[12px] tono-mal flex items-center gap-2">No se pudo traer el comportamiento: {estado.error}. <button type="button" onClick={() => setVuelta((n) => n + 1)} className="underline">Reintentar</button></div>;
    if (!estado.datos || !estado.datos.pasos.length) return <div className="py-3 text-[12px] text-muted-foreground">Sin otros pasos de {plate} en los últimos días.</div>;
    return <ContenidoComportamiento datos={estado.datos} compacto />;
}

function Cifra({ rotulo, valor, sub }: { rotulo: string; valor: string; sub?: string }) {
    return (
        <div className="px-5 py-3 border-r border-b border-border [&:nth-child(3n)]:border-r-0 min-w-0">
            <div className="text-[10.5px] text-muted-foreground">{rotulo}</div>
            <div className="text-[15px] font-bold tabular-nums tracking-[-0.01em] truncate">{valor}</div>
            {sub && <div className="text-[10.5px] text-muted-foreground truncate" title={sub}>{sub}</div>}
        </div>
    );
}

/**
 * Un tramo del grafo, del alto de su renglón. Se dibuja por renglón (y no un SVG entero) para
 * que cada renglón sea su propio botón y el grafo siga al texto sin cuentas de posición.
 */
function Grafo({ alto, primero, ultimo, pasa, une, abre, cortada, abiertaArriba, nodo, actual }: {
    alto: number; primero: boolean; ultimo: boolean;
    pasa: boolean; une: boolean; abre: boolean; cortada: boolean; abiertaArriba: boolean;
    nodo: PasoVisor | null; actual: boolean;
}) {
    const m = alto / 2;
    const negado = nodo?.decision === "DENY";
    const sinSentido = nodo && !nodo.direccion;
    return (
        <svg width={ANCHO_GRAFO} height={alto} className="shrink-0 overflow-visible" aria-hidden>
            {/* La vía de afuera: la línea de tiempo. */}
            <line x1={VIA_AFUERA} x2={VIA_AFUERA} y1={primero ? m : 0} y2={ultimo ? m : alto} stroke="color-mix(in oklab, var(--foreground) 28%, transparent)" strokeWidth={2} />
            {/* La vía de adentro, de paso por este renglón. */}
            {pasa && <line x1={VIA_ADENTRO} x2={VIA_ADENTRO} y1={0} y2={alto} stroke={COLOR_RAMA} strokeWidth={2}
                strokeDasharray={abiertaArriba ? "3 3" : undefined} />}
            {/* La salida: la rama vuelve a la línea de tiempo (merge). */}
            {une && <path d={`M ${VIA_ADENTRO} ${alto} C ${VIA_ADENTRO} ${m + 4}, ${VIA_AFUERA} ${m + 6}, ${VIA_AFUERA} ${m}`} fill="none" stroke={COLOR_RAMA} strokeWidth={2} />}
            {/* La entrada: se abre la rama (branch). Cortada si nunca se leyó la salida. */}
            {abre && <path d={`M ${VIA_AFUERA} ${m} C ${VIA_AFUERA} ${m - 6}, ${VIA_ADENTRO} ${m - 4}, ${VIA_ADENTRO} ${cortada ? m - 12 : 0}`}
                fill="none" stroke={COLOR_RAMA} strokeWidth={2} strokeOpacity={cortada ? 0.45 : 1} strokeDasharray={cortada ? "2 3" : undefined} />}
            {nodo && (
                <>
                    {actual && <circle cx={VIA_AFUERA} cy={m} r={9} fill="none" stroke="var(--accion)" strokeWidth={2} />}
                    <circle cx={VIA_AFUERA} cy={m} r={5}
                        fill={negado ? "var(--mal)" : sinSentido ? "var(--background)" : "var(--foreground)"}
                        stroke={negado ? "var(--mal)" : "var(--foreground)"} strokeWidth={2} />
                </>
            )}
        </svg>
    );
}

/** Empareja entradas con salidas (de lo más viejo a lo más nuevo) y arma los renglones con sus días. */
function armarGrafo(pasos: ComportamientoVisor["pasos"]) {
    const n = pasos.length;
    const dur = new Map<number, number>();
    const parejaDe = new Map<number, number>(); // salida → entrada
    const sinSalida = new Set<number>();
    let abierta: number | null = null;
    for (let i = n - 1; i >= 0; i--) {
        const p = pasos[i];
        if (p.direccion === "ENTRY" && p.decision !== "DENY") {
            if (abierta != null) sinSalida.add(abierta);
            abierta = i;
        } else if (p.direccion === "EXIT") {
            if (abierta != null) {
                const ms = +new Date(p.momento) - +new Date(pasos[abierta].momento);
                if (ms >= 0 && ms <= ESTADIA_MAX_MS) { parejaDe.set(i, abierta); dur.set(i, ms); }
                else sinSalida.add(abierta);
            }
            abierta = null;
        }
    }
    const abiertaReciente = abierta != null && Date.now() - +new Date(pasos[abierta].momento) <= ABIERTA_RECIENTE_MS;
    if (abierta != null && !abiertaReciente) sinSalida.add(abierta);

    const items: Item[] = [];
    const pos = new Map<number, number>(); // índice del paso → índice del renglón
    let dia = "";
    pasos.forEach((p, i) => {
        const d = fechaNumerica(p.momento);
        if (d !== dia) { dia = d; items.push({ k: "dia", clave: `d-${d}`, texto: `${diaSemana(p.momento).split(" ")[0]} ${fechaCorta(p.momento)}` }); }
        pos.set(i, items.length);
        items.push({ k: "paso", clave: claveDePaso(p, i), p, dur: dur.get(i) ?? null, sinSalida: sinSalida.has(i), abierta: abiertaReciente && i === abierta });
    });

    const pasa = items.map(() => false);
    const unen = new Set<number>(), abren = new Set<number>(), cortadas = new Set<number>();
    for (const [s, e] of parejaDe) {
        const a = pos.get(s)!, b = pos.get(e)!;
        unen.add(a); abren.add(b);
        for (let k = a + 1; k < b; k++) pasa[k] = true;
    }
    for (const e of sinSalida) { const b = pos.get(e)!; abren.add(b); cortadas.add(b); }
    let arribaAbierta = false;
    if (abiertaReciente && abierta != null) {
        const b = pos.get(abierta)!;
        abren.add(b);
        for (let k = 0; k < b; k++) pasa[k] = true;
        arribaAbierta = b > 0;
    }
    return { items, pasa, unen, abren, cortadas, arribaAbierta, estadias: [...dur.values()] };
}
