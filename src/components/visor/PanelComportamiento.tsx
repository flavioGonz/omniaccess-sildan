"use client";

import { useMemo } from "react";
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
const COLOR_RAMA = "var(--accion-en-oscuro)";

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
    const { items, pasa, unen, abren, cortadas, arribaAbierta, estadias } = useMemo(() => armarGrafo(datos.pasos), [datos.pasos]);
    const max = Math.max(1, ...datos.franja.flat());
    const perfil = datos.perfil;
    const mediana = perfil?.permanenciaMedianaMin ?? (estadias.length ? Math.round(estadias.sort((a, b) => a - b)[Math.floor(estadias.length / 2)] / 60000) : null);

    return (
        <aside className="absolute right-0 top-0 bottom-0 z-[45] w-[min(500px,50vw)] flex flex-col bg-[#0b0f16]/95 backdrop-blur-xl border-l border-white/12 shadow-[0_0_60px_rgba(0,0,0,0.6)] text-white animate-in slide-in-from-right-4 duration-200">
            <header className="shrink-0 flex items-start justify-between gap-3 px-5 pt-4 pb-3 border-b border-white/10">
                <div>
                    <h2 className="flex items-center gap-2 text-[15px] font-bold tracking-[-0.01em]"><Activity size={16} className="text-white/60" /> Comportamiento</h2>
                    <p className="text-[12px] text-white/55 mt-0.5"><b className="text-white/85 tracking-wider">{plate}</b> · últimos {datos.dias} días · {datos.pasos.length} {datos.pasos.length === 1 ? "paso" : "pasos"}</p>
                </div>
                <button type="button" onClick={onCerrar} aria-label="Cerrar" title="Cerrar  ( Esc )" className="w-8 h-8 rounded-[8px] grid place-items-center text-white/70 hover:text-white hover:bg-white/10"><X size={16} /></button>
            </header>

            <div className="flex-1 min-h-0 overflow-y-auto [scrollbar-width:thin]">
                {/* El perfil, en cifras. */}
                <div className="grid grid-cols-3 border-b border-white/10">
                    <Cifra rotulo="Clase" valor={perfil ? (NOMBRE_CLASE as Record<string, string>)[perfil.clase] || perfil.clase : "—"} />
                    <Cifra rotulo="Entradas · salidas" valor={perfil ? `${perfil.entradas} · ${perfil.salidas}` : `${datos.pasos.filter((p) => p.direccion === "ENTRY").length} · ${datos.pasos.filter((p) => p.direccion === "EXIT").length}`} />
                    <Cifra rotulo="Se queda (típico)" valor={mediana != null ? leerDuracion(mediana * 60000) : "—"}
                        sub={perfil?.permanenciaP90Min != null ? `9 de 10, menos de ${leerDuracion(perfil.permanenciaP90Min * 60000)}` : undefined} />
                    <Cifra rotulo="Días visto" valor={perfil ? String(perfil.diasVistos) : "—"} />
                    <Cifra rotulo="Primera vez" valor={perfil ? fechaCorta(perfil.primeraVez) : "—"} />
                    <Cifra rotulo="Última vez" valor={perfil ? fechaCorta(perfil.ultimaVez) : "—"} />
                </div>

                {/* La franja: cuándo se lo ve en la semana. */}
                <section className="px-5 py-4 border-b border-white/10">
                    <h3 className="text-[9.5px] font-bold uppercase tracking-[0.14em] text-white/50 mb-2.5">Cuándo se lo ve</h3>
                    <div className="grid grid-cols-[28px_1fr] gap-x-1.5 gap-y-[3px]">
                        {datos.franja.map((fila, d) => (
                            <div key={d} className="contents">
                                <span className="text-[10.5px] text-white/45 leading-[14px]">{DIAS[d]}</span>
                                <div className="grid gap-[2px]" style={{ gridTemplateColumns: "repeat(24, minmax(0, 1fr))" }}>
                                    {fila.map((n, h) => (
                                        <span key={h} title={`${DIAS[d]} ${String(h).padStart(2, "0")} h · ${n} ${n === 1 ? "paso" : "pasos"}`}
                                            className="h-[14px] rounded-[2px]"
                                            style={{ background: n ? `color-mix(in oklab, ${COLOR_RAMA} ${Math.round(25 + 75 * (n / max))}%, transparent)` : "rgba(255,255,255,0.05)" }} />
                                    ))}
                                </div>
                            </div>
                        ))}
                        <span />
                        <div className="flex justify-between text-[10px] text-white/40 tabular-nums mt-1">
                            <span>0 h</span><span>6 h</span><span>12 h</span><span>18 h</span><span>24 h</span>
                        </div>
                    </div>
                </section>

                {/* El grafo de estadías. */}
                <section className="px-3 py-3">
                    <div className="flex items-center justify-between px-2 mb-1.5">
                        <h3 className="text-[9.5px] font-bold uppercase tracking-[0.14em] text-white/50">Entradas y salidas</h3>
                        <span className="flex items-center gap-3 text-[10.5px] text-white/45">
                            <span className="flex items-center gap-1.5"><span className="w-3 h-[2px] bg-white/40" /> afuera</span>
                            <span className="flex items-center gap-1.5"><span className="w-3 h-[2px]" style={{ background: COLOR_RAMA }} /> adentro</span>
                        </span>
                    </div>
                    {!items.length ? <p className="px-2 text-[12px] text-white/50">No hay pasos en los últimos {datos.dias} días.</p> : (
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
                                            <span className="text-[11px] font-semibold text-white/55 first-letter:uppercase">{it.texto}</span>
                                        </li>
                                    );
                                }
                                const p = it.p;
                                const salida = p.direccion === "EXIT";
                                const negado = p.decision === "DENY";
                                const verbo = negado ? "No abrió" : p.direccion === "ENTRY" ? "Entró" : salida ? "Salió" : "Pasó";
                                return (
                                    <li key={it.clave} style={{ height: alto }}>
                                        <button type="button" disabled={!p.foto} onClick={() => onElegir({ ...p, id: it.clave })}
                                            className={cn("w-full h-full flex items-center rounded-[6px] pr-2 text-left transition-colors disabled:cursor-default",
                                                viendo === it.clave ? "bg-white/12" : "hover:bg-white/[0.06]")}>
                                            {grafo}
                                            <span className="flex-1 min-w-0">
                                                <span className="flex items-baseline gap-2 text-[12.5px]">
                                                    <span className={cn("font-semibold", negado ? "visor-mal" : "text-white/95")}>{verbo}</span>
                                                    <span className="text-white/50 truncate">{p.camara || "Cámara sin nombre"}</span>
                                                    {p.actual && <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--accion-en-oscuro)]">este evento</span>}
                                                </span>
                                                {it.dur != null && <span className="block text-[11px] tabular-nums" style={{ color: COLOR_RAMA }}>estuvo {leerDuracion(it.dur)}</span>}
                                                {it.sinSalida && <span className="block text-[11px] text-white/40">sin salida registrada</span>}
                                                {it.abierta && <span className="block text-[11px] text-white/55">sin salida todavía</span>}
                                            </span>
                                            <span className="text-[11.5px] text-white/60 tabular-nums shrink-0">{horaSeg(p.momento)}</span>
                                        </button>
                                    </li>
                                );
                            })}
                        </ol>
                    )}
                </section>
            </div>
        </aside>
    );
}

function Cifra({ rotulo, valor, sub }: { rotulo: string; valor: string; sub?: string }) {
    return (
        <div className="px-5 py-3 border-r border-b border-white/[0.06] [&:nth-child(3n)]:border-r-0 min-w-0">
            <div className="text-[10.5px] text-white/45">{rotulo}</div>
            <div className="text-[15px] font-bold tabular-nums tracking-[-0.01em] truncate">{valor}</div>
            {sub && <div className="text-[10.5px] text-white/40 truncate" title={sub}>{sub}</div>}
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
            <line x1={VIA_AFUERA} x2={VIA_AFUERA} y1={primero ? m : 0} y2={ultimo ? m : alto} stroke="rgba(255,255,255,0.28)" strokeWidth={2} />
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
                    {actual && <circle cx={VIA_AFUERA} cy={m} r={9} fill="none" stroke="var(--accion-en-oscuro)" strokeWidth={2} />}
                    <circle cx={VIA_AFUERA} cy={m} r={5}
                        fill={negado ? "var(--mal)" : sinSentido ? "#0b0f16" : "#f1f5f9"}
                        stroke={negado ? "var(--mal)" : "#f1f5f9"} strokeWidth={2} />
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
