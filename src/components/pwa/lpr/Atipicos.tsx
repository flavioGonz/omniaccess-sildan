"use client";
/**
 * Atípicos en «LPR en vivo» (29/10, Nico: «filtros de atípicos en LPR»).
 *
 * Son los mismos «Atípicos dentro» del Control LPR de la pared, con el mismo cálculo
 * (/api/monitor/lpr/presencia → lib/presencia: lista negra, en búsqueda, merodeo, primera vez visto,
 * alta frecuencia). Lo atípico es del vehículo que está adentro, no de una lectura suelta: por eso
 * es una lista propia y no sólo un chip más en Eventos — en Eventos hay además un filtro que deja
 * las lecturas de estas chapas.
 */
import { useMemo, useState } from "react";
import { AlertTriangle, LogIn, Search, Video, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { fecha, hace, hora } from "@/lib/fechas";
import { getImagePath } from "@/lib/image-path";
import { Chapa, FotoEvento, Hoja } from "./piezas";

export type FilaAtipica = {
    clave: string; plate: string | null; titulo: string; sub: string | null; clase: string | null;
    entrada: string; vistoUltimo: string | null; camara: string | null; foto: string | null; accessEventId: string | null;
    estimado: boolean; atipico: { clave: string; nombre: string }[]; entradas24h: number | null;
};

/** El tono de cada motivo, el mismo que en la pared: lo grave en rojo, lo raro en ámbar, lo nuevo en azul. */
const TONO: Record<string, { pleno: string; chip: string }> = {
    lista_negra: { pleno: "pleno-mal", chip: "chip-mal" },
    en_busqueda: { pleno: "pleno-mal", chip: "chip-mal" },
    merodeo: { pleno: "pleno-aviso", chip: "chip-aviso" },
    alta_frecuencia: { pleno: "pleno-aviso", chip: "chip-aviso" },
    primera_vez: { pleno: "pleno-info", chip: "chip-info" },
};
/** El orden de los filtros: de lo más grave a lo menos. */
const ORDEN = ["lista_negra", "en_busqueda", "merodeo", "alta_frecuencia", "primera_vez"];
const EXPLICA: Record<string, string> = {
    lista_negra: "Está en la lista negra.",
    en_busqueda: "Tiene pedido de búsqueda.",
    merodeo: "Pasó varias veces sin entrar o lo rebotaron en las últimas 24 h.",
    alta_frecuencia: "Cuatro entradas o más en las últimas 24 h, sin ser del barrio.",
    primera_vez: "Es la primera vez que se lo ve (en las últimas 24 h).",
};

export function Atipicos({ filas, error, alReintentar, alVerCamara, alBuscar }: {
    filas: FilaAtipica[] | null; error: boolean; alReintentar: () => void;
    alVerCamara: (camara: string | null, t: number) => void; alBuscar: (chapa: string) => void;
}) {
    const [motivo, setMotivo] = useState<string | null>(null);
    const [ficha, setFicha] = useState<FilaAtipica | null>(null);

    const conteo = useMemo(() => {
        const m: Record<string, { nombre: string; n: number }> = {};
        for (const f of filas || []) for (const a of f.atipico) (m[a.clave] ||= { nombre: a.nombre, n: 0 }).n++;
        return m;
    }, [filas]);
    const motivos = ORDEN.filter((k) => conteo[k]).concat(Object.keys(conteo).filter((k) => !ORDEN.includes(k)));
    const visibles = useMemo(() => (filas || [])
        .filter((f) => !motivo || f.atipico.some((a) => a.clave === motivo))
        // Lo más grave arriba; a igual gravedad, lo visto más recién.
        .sort((a, b) => peso(a) - peso(b) || +new Date(b.vistoUltimo || b.entrada) - +new Date(a.vistoUltimo || a.entrada)),
    [filas, motivo]);

    return (
        <div className="h-full flex flex-col">
            <div className="shrink-0 px-4 pb-2 flex gap-1.5 overflow-x-auto [&::-webkit-scrollbar]:hidden">
                <button type="button" onClick={() => setMotivo(null)} aria-pressed={!motivo}
                    className={cn("shrink-0 h-8 px-3 rounded-full border text-[12.5px] font-semibold", !motivo ? "bg-foreground text-background border-transparent" : "border-border bg-card text-muted-foreground")}>
                    Todos{filas ? ` · ${filas.length}` : ""}
                </button>
                {motivos.map((k) => (
                    <button key={k} type="button" onClick={() => setMotivo(motivo === k ? null : k)} aria-pressed={motivo === k}
                        className={cn("shrink-0 h-8 px-3 rounded-full border text-[12.5px] font-semibold inline-flex items-center gap-1.5", motivo === k ? "bg-foreground text-background border-transparent" : "border-border bg-card text-muted-foreground")}>
                        <span className={cn("w-2 h-2 rounded-full", TONO[k]?.pleno || "pleno-quieto")} />{conteo[k].nombre} · {conteo[k].n}
                    </button>
                ))}
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto [&::-webkit-scrollbar]:hidden px-3 pb-28">
                {filas === null && !error ? (
                    <div className="space-y-1.5">{[0, 1, 2].map((i) => <div key={i} className="h-[72px] rounded-[10px] bg-muted animate-pulse" />)}</div>
                ) : error && !filas ? (
                    <div className="text-center py-16 text-[13px] text-muted-foreground">No se pudo calcular quién está adentro. <button type="button" onClick={alReintentar} className="tono-accion font-semibold">Reintentar</button></div>
                ) : visibles.length === 0 ? (
                    <div className="py-16 flex flex-col items-center gap-2 text-muted-foreground text-center px-8"><AlertTriangle size={26} />
                        <span className="text-[13px]">{motivo ? "Ningún vehículo adentro con este motivo." : "No hay vehículos atípicos adentro ahora."}</span>
                        <span className="text-[11.5px]">Se revisa solo cada minuto.</span>
                    </div>
                ) : (
                    <div className="space-y-1.5">
                        {visibles.map((f) => (
                            <button key={f.clave} type="button" onClick={() => setFicha(f)} className="w-full flex items-center gap-3 rounded-[10px] border border-border bg-card p-2 text-left active:bg-muted">
                                <FotoEvento src={getImagePath(f.foto) || null} chica className="w-[76px] h-[52px] rounded-[6px] shrink-0" />
                                <span className="min-w-0 flex-1">
                                    <span className="flex items-center gap-2 min-w-0"><Chapa p={f.plate} /><span className="text-[11.5px] text-muted-foreground truncate">{f.titulo}</span></span>
                                    <span className="mt-1 flex flex-wrap gap-1">
                                        {f.atipico.map((a) => <span key={a.clave} className={cn("text-[10px] font-semibold px-1.5 py-[1px] rounded-full border", TONO[a.clave]?.chip || "chip-quieto")}>{a.nombre}</span>)}
                                    </span>
                                </span>
                                <span className="flex flex-col items-end gap-1 shrink-0 text-[11px] text-muted-foreground tabular-nums">
                                    <span className="inline-flex items-center gap-1"><LogIn size={11} />{hace(f.entrada)}</span>
                                    {f.camara && <span className="max-w-[90px] truncate">{f.camara}</span>}
                                </span>
                            </button>
                        ))}
                    </div>
                )}
            </div>

            <Hoja abierta={!!ficha} alCerrar={() => setFicha(null)} alto="media">
                {ficha && (
                    <>
                        <div className="flex items-center justify-between px-4 pt-1 pb-2">
                            <Chapa p={ficha.plate} grande />
                            <button type="button" aria-label="Cerrar" onClick={() => setFicha(null)} className="w-9 h-9 grid place-items-center rounded-full border border-border"><X size={16} /></button>
                        </div>
                        <div className="overflow-y-auto px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
                            <FotoEvento src={getImagePath(ficha.foto) || null} className="w-full aspect-video rounded-[10px]" />
                            <div className="mt-3 space-y-1.5">
                                {ficha.atipico.map((a) => (
                                    <div key={a.clave} className={cn("flex items-start gap-2 rounded-[10px] border px-3 py-2", TONO[a.clave]?.chip || "chip-quieto")}>
                                        <AlertTriangle size={15} className="mt-0.5 shrink-0" />
                                        <span className="text-[12.5px]"><b className="font-semibold">{a.nombre}.</b> {EXPLICA[a.clave] || ""}</span>
                                    </div>
                                ))}
                            </div>
                            <dl className="mt-3 rounded-[10px] border border-border bg-card divide-y divide-border">
                                {([
                                    ["Quién", [ficha.titulo, ficha.sub].filter(Boolean).join(" · ")],
                                    ["Adentro desde", `${fecha(new Date(ficha.entrada))} · ${hora(new Date(ficha.entrada))}${ficha.estimado ? " (estimado)" : ""}`],
                                    ["Visto por última vez", ficha.vistoUltimo ? `${hace(ficha.vistoUltimo)}${ficha.camara ? ` · ${ficha.camara}` : ""}` : "—"],
                                    ["Entradas en 24 h", ficha.entradas24h != null ? String(ficha.entradas24h) : "—"],
                                ] as [string, string][]).map(([k, v]) => (
                                    <div key={k} className="flex items-center justify-between gap-3 px-3 py-2.5">
                                        <dt className="text-[12.5px] text-muted-foreground">{k}</dt><dd className="text-[13px] font-semibold text-right">{v}</dd>
                                    </div>
                                ))}
                            </dl>
                            <div className="grid grid-cols-2 gap-2 mt-3">
                                <button type="button" disabled={!ficha.camara} onClick={() => { const f = ficha; setFicha(null); alVerCamara(f.camara, +new Date(f.vistoUltimo || f.entrada) - 4000); }}
                                    className="h-11 rounded-full bg-[var(--accion)] text-white text-[13.5px] font-semibold flex items-center justify-center gap-1.5 disabled:opacity-50"><Video size={16} /> Ver grabación</button>
                                <button type="button" disabled={!ficha.plate} onClick={() => { const p = ficha.plate!; setFicha(null); alBuscar(p); }}
                                    className="h-11 rounded-full border border-border text-[13.5px] font-semibold flex items-center justify-center gap-1.5 disabled:opacity-50"><Search size={16} /> Sus pasadas</button>
                            </div>
                        </div>
                    </>
                )}
            </Hoja>
        </div>
    );
}

/** La gravedad de una fila: la de su motivo más grave (menor = más grave). */
function peso(f: FilaAtipica) {
    return Math.min(...f.atipico.map((a) => { const i = ORDEN.indexOf(a.clave); return i < 0 ? ORDEN.length : i; }), ORDEN.length);
}
