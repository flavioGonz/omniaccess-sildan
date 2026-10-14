"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Camera, Check, Radar, ShieldCheck, Sparkles, Video, DoorOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import { capacidadesModo } from "@/app/actions/modo-camara";
import {
    MODOS_INTRUSION, MODOS_LPR, ORDEN_INTRUSION, ORDEN_LPR, consecuenciasIntrusion, consecuenciasLpr,
    type ModoIntrusion, type ModoLpr,
} from "@/lib/modo-camara";

/**
 * Elegir el modo de una cámara (lib/modo-camara.ts): quién lee la matrícula, quién detecta la
 * intrusión. Lo usan el alta, la ficha y la importación de canales, para que la pregunta sea la
 * misma en los tres lugares — antes cada uno la hacía a su manera, o no la hacía.
 *
 * Al lado de cada modo se dice lo que le falta al servidor para que funcione (el lector apagado,
 * la relectura apagada, un servidor que no abre barreras): un modo elegido que no anda es un
 * control que miente.
 */

type Capacidades = { lector: boolean; relectura: boolean; verifIntrusion: boolean; abreBarreras: boolean };

const ICONO_LPR: Record<ModoLpr, any> = { camara: Camera, doble: ShieldCheck, omnivision: Sparkles };
const ICONO_INTRUSION: Record<ModoIntrusion, any> = { camara: Radar, doble: ShieldCheck, omnivision: Sparkles, video: Video };

function useCapacidades() {
    const [cap, setCap] = useState<Capacidades | null>(null);
    useEffect(() => { capacidadesModo().then((c) => setCap(c)).catch(() => setCap(null)); }, []);
    return cap;
}

function Tarjeta({ activa, onClick, icono: I, titulo, que, quien, falta, children }: {
    activa: boolean; onClick: () => void; icono: any; titulo: string; que: string; quien: string; falta?: string | null; children?: React.ReactNode;
}) {
    return (
        <div className={cn("rounded-[10px] border transition-colors", activa ? "border-[var(--accion)] bg-[color-mix(in_oklab,var(--accion)_6%,transparent)]" : "border-border hover:bg-accent/50")}>
            <button type="button" onClick={onClick} aria-pressed={activa} className="w-full text-left p-3 flex gap-3">
                <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-md", activa ? "bg-[var(--accion)] text-white" : "bg-muted text-muted-foreground")}><I size={17} /></span>
                <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 text-[13px] font-semibold">{titulo}{activa && <Check size={14} className="text-[var(--accion)]" />}</span>
                    <span className="block text-[12px] text-muted-foreground leading-snug mt-0.5">{que}</span>
                    <span className="block text-[11px] text-muted-foreground mt-1">Lee / detecta: <b className="text-foreground font-semibold">{quien}</b></span>
                    {falta && <span className="mt-1 flex items-start gap-1 text-[11.5px] tono-aviso"><AlertTriangle size={12} className="mt-0.5 shrink-0" />{falta}</span>}
                </span>
            </button>
            {activa && children}
        </div>
    );
}

function Consecuencias({ lista }: { lista: string[] }) {
    if (!lista.length) return null;
    return (
        <div className="rounded-[10px] border border-border bg-muted/40 p-3">
            <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground mb-1.5">Al guardar</div>
            <ul className="space-y-1 text-[12px] text-foreground/85 list-disc pl-4">{lista.map((l) => <li key={l}>{l}</li>)}</ul>
        </div>
    );
}

/** ¿Quién lee la matrícula? `antes` (en la ficha) es el modo guardado: con él se dicen las consecuencias. */
export function ElegirModoLpr({ valor, abre, onCambiar, antes }: {
    valor: ModoLpr; abre: boolean; onCambiar: (modo: ModoLpr, abre: boolean) => void; antes?: ModoLpr | null;
}) {
    const cap = useCapacidades();
    const falta = (m: ModoLpr): string | null => {
        if (!cap) return null;
        if (m === "doble" && !cap.lector) return "El lector (Modos › LPR) está apagado: no va a verificar.";
        if (m === "doble" && !cap.relectura) return "La relectura está apagada en OmniVision › Analíticas.";
        if (m === "omnivision" && !cap.lector) return "El lector (Modos › LPR) está apagado: no va a leer.";
        return null;
    };
    return (
        <div className="space-y-2">
            {ORDEN_LPR.map((m) => (
                <Tarjeta key={m} activa={valor === m} onClick={() => onCambiar(m, m === "omnivision" ? abre : false)} icono={ICONO_LPR[m]}
                    titulo={MODOS_LPR[m].rotulo} que={MODOS_LPR[m].que} quien={MODOS_LPR[m].quienLee} falta={falta(m)}>
                    {m === "omnivision" && (
                        <label className="flex items-start gap-2.5 border-t border-border px-3 py-2.5 cursor-pointer select-none">
                            <input type="checkbox" checked={abre} onChange={(e) => onCambiar("omnivision", e.target.checked)} className="mt-0.5 h-4 w-4 accent-[var(--accion)]" />
                            <span className="text-[12px] leading-snug">
                                <span className="font-semibold inline-flex items-center gap-1.5"><DoorOpen size={13} /> Abre la barrera</span>
                                <span className="block text-muted-foreground">Una lectura permitida acciona el relé de la cámara. Sin marcar, sólo registra y la barrera la maneja el guardia.</span>
                                {abre && cap && !cap.abreBarreras && <span className="mt-1 flex items-start gap-1 tono-aviso"><AlertTriangle size={12} className="mt-0.5 shrink-0" />Este servidor no abre barreras (falta OMNI_ABRE_BARRERAS=si): las lecturas se registran sin abrir.</span>}
                            </span>
                        </label>
                    )}
                </Tarjeta>
            ))}
            {antes !== undefined && <Consecuencias lista={consecuenciasLpr(antes ?? null, valor, abre)} />}
        </div>
    );
}

/** ¿Quién detecta la intrusión? */
export function ElegirModoIntrusion({ valor, onCambiar, antes }: { valor: ModoIntrusion; onCambiar: (m: ModoIntrusion) => void; antes?: ModoIntrusion | null }) {
    const cap = useCapacidades();
    const falta = (m: ModoIntrusion) => (cap && m === "doble" && !cap.verifIntrusion ? "La verificación de intrusión está apagada en OmniVision › Analíticas." : null);
    return (
        <div className="space-y-2">
            {ORDEN_INTRUSION.map((m) => (
                <Tarjeta key={m} activa={valor === m} onClick={() => onCambiar(m)} icono={ICONO_INTRUSION[m]}
                    titulo={MODOS_INTRUSION[m].rotulo} que={MODOS_INTRUSION[m].que} quien={MODOS_INTRUSION[m].quienLee} falta={falta(m)} />
            ))}
            {antes !== undefined && <Consecuencias lista={consecuenciasIntrusion(antes ?? null, valor)} />}
        </div>
    );
}

/**
 * La versión de una fila (importar canales): el modo como pastillas chicas al lado del rol. Es una
 * elección entre opciones, por eso la píldora (DESIGN.md: «pill = elección»).
 */
export function ModoEnFila<M extends string>({ opciones, valor, onCambiar }: { opciones: { valor: M; rotulo: string; ayuda: string }[]; valor: M; onCambiar: (m: M) => void }) {
    return (
        <div className="inline-flex rounded-full bg-muted/60 p-0.5">
            {opciones.map((o) => (
                <button key={o.valor} type="button" title={o.ayuda} onClick={() => onCambiar(o.valor)} aria-pressed={valor === o.valor}
                    className={cn("h-7 px-2.5 rounded-full text-[11px] font-semibold transition-colors", valor === o.valor ? "bg-[var(--accion)] text-white" : "text-muted-foreground hover:text-foreground")}>
                    {o.rotulo}
                </button>
            ))}
        </div>
    );
}

export const OPCIONES_LPR_FILA = ORDEN_LPR.map((m) => ({ valor: m, rotulo: MODOS_LPR[m].corto, ayuda: `${MODOS_LPR[m].rotulo}: ${MODOS_LPR[m].que}` }));
export const OPCIONES_INTRUSION_FILA = ORDEN_INTRUSION.map((m) => ({ valor: m, rotulo: MODOS_INTRUSION[m].corto, ayuda: `${MODOS_INTRUSION[m].rotulo}: ${MODOS_INTRUSION[m].que}` }));

/** El modo en una lista de equipos: quién lee o quién detecta, en una etiqueta. */
export function ChipModo({ modo, tipo }: { modo: ModoLpr | ModoIntrusion | null; tipo: "lpr" | "intrusion" }) {
    if (!modo) return null;
    const f = tipo === "lpr" ? MODOS_LPR[modo as ModoLpr] : MODOS_INTRUSION[modo as ModoIntrusion];
    if (!f) return null;
    // Tono = estado: lo propio de OmniVision en info; lo de la cámara, quieto.
    const clase = modo === "camara" || modo === "video" ? "chip-quieto" : "chip-info";
    return <span className={cn(clase, "border inline-flex items-center h-[17px] px-1.5 rounded text-[9.5px] font-semibold whitespace-nowrap")} title={`${f.rotulo}: ${f.que}`}>{f.rotulo}</span>;
}
