"use client";

import { useMemo, useState } from "react";
import { CarFront, ClipboardCheck, ClipboardList, ClipboardX, History, KeyRound, PencilLine, UserMinus, UserPen, UserPlus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Vacio } from "@/components/ui/estados";
import { Matricula } from "@/components/ui/celdas";
import { Seek } from "@/components/ui/search";
import { fecha, hora } from "@/lib/fechas";
import { CAMBIOS, contarPorClase, firmaDeCambio, type QueCambio } from "@/lib/lote-cambios";
import type { CambioVisto } from "@/app/actions/administraciones";

/**
 * El historial de un lote —o de varios—: qué cambió, cuándo y quién.
 *
 * Pedido de Nico (21/11): «auditoría de cambios en cada lote; el objetivo es saber cuándo un
 * residente cambia sus matrículas». Por eso las matrículas son el filtro que viene primero después
 * de «Todo», y la chapa va dibujada como chapa: es lo que se busca con la vista.
 *
 * El tono dice qué pasó, no qué hay que hacer: verde entró una matrícula, rojo salió. No es una
 * alarma: una baja es un cambio como cualquier otro, y por eso el renglón no lleva fondo de color.
 */

const DIBUJO: Record<QueCambio, React.ComponentType<{ size?: number; className?: string }>> = {
    MATRICULA_ALTA: CarFront, MATRICULA_BAJA: CarFront, PERSONA_ALTA: UserPlus, PERSONA_BAJA: UserMinus,
    CENSO_CARGA: ClipboardList, CENSO_APROBADA: ClipboardCheck, CENSO_RECHAZADA: ClipboardX, CODIGO_CAMBIADO: KeyRound,
    DATO_CAMBIADO: PencilLine, PERSONA_EDITADA: UserPen,
};
type Clase = "todos" | "matriculas" | "personas" | "censo" | "datos";
const CLASES: { v: Clase; r: string }[] = [{ v: "todos", r: "Todo" }, { v: "matriculas", r: "Matrículas" }, { v: "personas", r: "Personas" }, { v: "censo", r: "Censo" }, { v: "datos", r: "Datos" }];

export function HistorialLote({ cambios, conLote, alAbrirLote, auditadoDesde, hayMas, className }: {
    cambios: CambioVisto[];
    /** Varios lotes mezclados: cada renglón dice de cuál es, y se puede ir a él. */
    conLote?: boolean;
    alAbrirLote?: (unitId: string) => void;
    /** Desde cuándo se lleva el historial. Antes de eso no hay nada, y hay que decirlo. */
    auditadoDesde: string | null;
    hayMas?: boolean;
    className?: string;
}) {
    const [clase, setClase] = useState<Clase>("todos");
    const [q, setQ] = useState("");
    const n = useMemo(() => contarPorClase(cambios), [cambios]);
    const porDia = useMemo(() => {
        const t = q.trim().toLowerCase(), chapa = t.replace(/[^a-z0-9]/g, "");
        const vistos = cambios.filter((c) => (clase === "todos" || CAMBIOS[c.que as QueCambio]?.clase === clase)
            && (!t || [c.persona, c.quien, c.detalle, conLote ? c.lote : ""].some((x) => (x || "").toLowerCase().includes(t)) || (!!chapa && (c.chapa || "").toLowerCase().includes(chapa))));
        const dias: { dia: string; filas: CambioVisto[] }[] = [];
        for (const c of vistos) { const d = fecha(c.cuando); if (dias[dias.length - 1]?.dia === d) dias[dias.length - 1].filas.push(c); else dias.push({ dia: d, filas: [c] }); }
        return dias;
    }, [cambios, clase, q, conLote]);
    const desde = auditadoDesde ? `El historial se lleva desde el ${fecha(auditadoDesde)}. Lo de antes no quedó anotado.` : "El historial empieza con la primera pasada de la auditoría, que corre sola cada minuto.";

    if (!cambios.length) return (
        <Vacio className={className} icono={History} titulo={conLote ? "Sin cambios en este período" : "Este lote todavía no tuvo cambios"}
            ayuda={`Acá queda cada matrícula que entra o sale, cada persona que se suma o se va, lo que carguen en el censo y cada dato que se corrija a mano. ${desde}`} />
    );
    return (
        <div className={className}>
            <div className="flex flex-wrap items-center gap-2">
                <div className="flex flex-wrap gap-1.5" role="group" aria-label="Qué cambios">
                    {CLASES.map((o) => (
                        <button key={o.v} type="button" aria-pressed={clase === o.v} onClick={() => setClase(o.v)}
                            className={cn("h-7 px-2.5 rounded-full border text-[11.5px] font-semibold inline-flex items-center gap-1.5", clase === o.v ? "bg-foreground text-background border-foreground" : "border-border hover:bg-accent")}>
                            {o.r}<span className={cn("tabular-nums text-[10.5px]", clase === o.v ? "opacity-70" : "text-muted-foreground")}>{n[o.v]}</span>
                        </button>))}
                </div>
                {cambios.length > 8 && <div className="ml-auto"><Seek value={q} onChange={setQ} placeholder={conLote ? "Matrícula, lote o persona" : "Matrícula o persona"} startOpen width={220} alto={30} /></div>}
            </div>

            {porDia.length === 0 ? <p className="mt-4 text-[12.5px] text-muted-foreground">Nada coincide con ese filtro.</p> : porDia.map((d) => (
                <section key={d.dia} className="mt-4">
                    <h4 className="text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground">{d.dia}</h4>
                    <ol className="mt-1.5 divide-y divide-border rounded-[10px] border border-border">
                        {d.filas.map((c) => {
                            const k = CAMBIOS[c.que as QueCambio] || { rotulo: c.que, tono: "quieto" as const };
                            const Dib = DIBUJO[c.que as QueCambio] || History;
                            return (
                                <li key={c.id} className="flex items-start gap-3 px-3 py-2.5">
                                    <span className={cn("mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full border", `chip-${k.tono}`)}><Dib size={13} /></span>
                                    <div className="min-w-0 flex-1">
                                        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] font-semibold leading-tight">
                                            {k.rotulo}
                                            {c.chapa && <Matricula p={c.chapa} />}
                                            {c.persona && <span className="font-normal text-muted-foreground">{c.chapa ? "de " : ""}{c.persona}</span>}
                                        </p>
                                        {c.detalle && <p className="mt-0.5 text-[12px] leading-snug text-muted-foreground">{c.detalle}</p>}
                                        <p className={cn("mt-0.5 text-[11.5px] leading-snug", c.quien || c.origen !== "sistema" ? "text-muted-foreground" : "tono-aviso")}>{firmaDeCambio(c)}</p>
                                    </div>
                                    <div className="shrink-0 text-right leading-tight">
                                        <p className="text-[12px] tabular-nums text-muted-foreground">{hora(c.cuando)}</p>
                                        {conLote && (alAbrirLote
                                            ? <button type="button" onClick={() => alAbrirLote(c.unitId)} className="mt-0.5 text-[12px] font-bold tabular-nums text-[var(--accion)] hover:underline">{c.lote}</button>
                                            : <p className="mt-0.5 text-[12px] font-bold tabular-nums">{c.lote}</p>)}
                                    </div>
                                </li>
                            );
                        })}
                    </ol>
                </section>
            ))}
            <p className="mt-3 text-[11.5px] text-muted-foreground">{hayMas ? "Se muestran los 400 más recientes. " : ""}{desde}</p>
        </div>
    );
}
