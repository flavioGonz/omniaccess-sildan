"use client";

import { useState } from "react";
import Link from "next/link";
import { BellRing, Check, ChevronRight, CircleDashed, FlaskConical, GraduationCap, Loader2, Pause, ShieldCheck, X } from "lucide-react";
import { sileo as toast } from "sileo";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/estados";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { CAMINO, ROTULO_ETAPA, chequeos, etapaDe, sugerencias, type Etapa, type ZonaParaEtapa } from "@/lib/zona-produccion";

/**
 * La puesta en producción de una analítica «Cómo está un lugar»: en qué etapa está, qué le falta
 * y el botón que la pone a avisar (o la vuelve a prueba). Lo usan la lista y la ficha, para que
 * las dos digan lo mismo (lib/zona-produccion).
 */

export const ICONO_ETAPA: Record<Etapa, any> = {
    apagada: Pause, pausada: Pause, aprendiendo: GraduationCap, prueba: FlaskConical, lista: ShieldCheck, produccion: BellRing,
};

export function ChipEtapa({ etapa }: { etapa: Etapa }) {
    const r = ROTULO_ETAPA[etapa];
    return <Chip tono={r.tono} icono={ICONO_ETAPA[etapa]}>{r.rotulo}</Chip>;
}

/** Cambia avisar con el PATCH de la zona. Devuelve si salió. */
export async function cambiarAvisar(id: string, avisar: boolean): Promise<boolean> {
    try {
        const r = await fetch(`/api/vision/zonas/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ avisar }) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j?.error || `El servidor respondió ${r.status}`);
        toast.success({ title: avisar ? "Avisa a la guardia" : "Volvió a prueba", description: avisar ? "Desde la próxima vez que se sostenga el estado." : "Sigue registrando, sin avisar a nadie." });
        return true;
    } catch (e: any) { toast.error({ title: "No se cambió", description: e?.message }); return false; }
}

/** La lista de condiciones, con su número real a la derecha. */
export function ListaChequeos({ z, prendida, compacta }: { z: ZonaParaEtapa; prendida: boolean; compacta?: boolean }) {
    return (
        <ul className={cn("space-y-1.5", compacta && "space-y-1")}>
            {chequeos(z, prendida).map((c) => (
                <li key={c.texto} className="flex items-start gap-2 text-[12.5px]">
                    <span className={cn("mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full", c.ok ? "pleno-bien" : "bg-muted text-muted-foreground")}>
                        {c.ok ? <Check size={11} strokeWidth={3} /> : <X size={10} strokeWidth={3} />}
                    </span>
                    <span className="min-w-0 flex-1">{c.texto}</span>
                    {c.detalle && <span className="text-muted-foreground tabular-nums text-right max-w-[55%] truncate" title={c.detalle}>{c.detalle}</span>}
                </li>
            ))}
        </ul>
    );
}

/**
 * Confirmar antes de que avise. Dice exactamente qué va a pasar y cuándo: un aviso a la guardia es
 * un compromiso con alguien que está trabajando, no un interruptor más.
 */
export function ConfirmarAvisar({ z, id, prendida, abierto, alCerrar, alCambio }: {
    z: ZonaParaEtapa; id: string; prendida: boolean; abierto: boolean; alCerrar: () => void; alCambio: () => void;
}) {
    const [enviando, setEnviando] = useState(false);
    const listos = chequeos(z, prendida).every((c) => c.ok);
    return (
        <Dialog open={abierto} onOpenChange={(v) => !v && alCerrar()}>
            <DialogContent className="max-w-lg">
                <DialogTitle>Poner a avisar «{z.nombre}»</DialogTitle>
                <DialogDescription>
                    Cuando «{z.positivo}» se sostenga {Math.round(z.sostenerSeg / 60)} min{z.horario ? `, de ${z.horario.desde} a ${z.horario.hasta}` : ", a cualquier hora"}, la guardia
                    recibe un aviso con la foto. Avisa una vez y no vuelve a avisar hasta que el lugar vuelva a «{z.negativo}». Se puede volver a prueba cuando quieras.
                </DialogDescription>
                <div className="rounded-[10px] border border-border p-3"><ListaChequeos z={z} prendida={prendida} /></div>
                {!listos && <p className="text-[12.5px] tono-aviso">No pasa todas las condiciones: puede mandar avisos equivocados. Se puede igual, pero conviene seguir en prueba.</p>}
                <div className="flex justify-end gap-2">
                    <Button variant="outline" onClick={alCerrar} disabled={enviando}>Cancelar</Button>
                    <Button onClick={async () => { setEnviando(true); const ok = await cambiarAvisar(id, true); setEnviando(false); if (ok) { alCerrar(); alCambio(); } }} disabled={enviando}>
                        {enviando ? <Loader2 size={15} className="animate-spin" /> : <BellRing size={15} />} {listos ? "Poner a avisar" : "Poner a avisar igual"}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}

/** El camino de las cuatro etapas, con la actual marcada (o, en la lista, cuántas hay en cada una). */
export function Camino({ actual, cuantas, className }: { actual?: Etapa; cuantas?: Partial<Record<Etapa, number>>; className?: string }) {
    return (
        <ol className={cn("grid grid-cols-1 md:grid-cols-4 gap-px rounded-[10px] overflow-hidden border border-border bg-border", className)}>
            {CAMINO.map((p, i) => {
                const Icono = ICONO_ETAPA[p.etapa];
                const es = actual === p.etapa;
                const n = cuantas?.[p.etapa];
                return (
                    <li key={p.etapa} className={cn("relative bg-card px-4 py-3 flex gap-3", es && "bg-[color-mix(in_oklab,var(--accion)_7%,var(--card))]")}>
                        <span className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-full", es ? "bg-[var(--accion)] text-white" : "bg-muted text-muted-foreground")}><Icono size={15} /></span>
                        <div className="min-w-0">
                            <div className="flex items-center gap-1.5 text-[13px] font-bold">
                                <span className="text-muted-foreground tabular-nums">{i + 1}.</span> {p.rotulo}
                                {n != null && <span className={cn("ml-1 tabular-nums rounded-full px-1.5 text-[11px]", n ? "bg-foreground text-background" : "bg-muted text-muted-foreground")}>{n}</span>}
                            </div>
                            <p className="text-[11.5px] text-muted-foreground leading-snug mt-0.5">{p.que}</p>
                        </div>
                        {i < CAMINO.length - 1 && <ChevronRight size={14} className="hidden md:block absolute -right-[7px] top-1/2 -translate-y-1/2 z-10 text-muted-foreground bg-card rounded-full" />}
                    </li>
                );
            })}
        </ol>
    );
}

/**
 * El panel de la ficha: dónde está, qué le falta, qué conviene hacer y el botón. Reemplaza el chip
 * «No avisa: sólo registra», que no decía cómo se salía de ahí.
 */
export function PanelProduccion({ id, z, prendida, alCambio }: { id: string; z: ZonaParaEtapa; prendida: boolean; alCambio: () => void }) {
    const [confirmar, setConfirmar] = useState(false);
    const [volviendo, setVolviendo] = useState(false);
    const etapa = etapaDe(z, prendida);
    const sug = sugerencias(z, prendida);
    return (
        <section className="rounded-[10px] border border-border bg-card overflow-hidden">
            <div className="px-4 pt-3 pb-2 flex items-center gap-2 flex-wrap">
                <h2 className="text-[14px] font-bold">Puesta en producción</h2>
                <ChipEtapa etapa={etapa} />
                <span className="ml-auto flex gap-2">
                    {etapa === "produccion"
                        ? <Button variant="outline" size="sm" disabled={volviendo} onClick={async () => { setVolviendo(true); if (await cambiarAvisar(id, false)) alCambio(); setVolviendo(false); }}>
                            {volviendo ? <Loader2 size={14} className="animate-spin" /> : <FlaskConical size={14} />} Volver a prueba</Button>
                        : (etapa === "lista" || etapa === "prueba") && <Button size="sm" variant={etapa === "lista" ? "default" : "outline"} onClick={() => setConfirmar(true)}><BellRing size={14} /> Poner a avisar</Button>}
                </span>
            </div>
            <Camino actual={etapa === "apagada" || etapa === "pausada" ? undefined : etapa} className="mx-4 mb-3" />
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 px-4 pb-4">
                <div>
                    <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground mb-2">Para avisar a la guardia</div>
                    <ListaChequeos z={z} prendida={prendida} />
                </div>
                <div>
                    <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground mb-2">Qué conviene hacer ahora</div>
                    {sug.length ? (
                        <ul className="space-y-1.5">{sug.map((s) => (
                            <li key={s.texto} className="flex items-start gap-2 text-[12.5px] leading-snug">
                                <CircleDashed size={13} className={cn("mt-0.5 shrink-0", s.tono === "mal" ? "tono-mal" : s.tono === "aviso" ? "tono-aviso" : s.tono === "bien" ? "tono-bien" : "tono-info")} />{s.texto}
                            </li>))}
                        </ul>
                    ) : <p className="text-[12.5px] text-muted-foreground">Nada pendiente.</p>}
                    {!prendida && <p className="mt-2 text-[12px]"><Link href="/admin/vision/analiticas" className="text-[var(--accion)] font-semibold">Prender «Analíticas entrenables» en OmniVision › Analíticas</Link></p>}
                </div>
            </div>
            <ConfirmarAvisar z={z} id={id} prendida={prendida} abierto={confirmar} alCerrar={() => setConfirmar(false)} alCambio={alCambio} />
        </section>
    );
}
