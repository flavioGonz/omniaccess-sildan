"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowRightLeft, Hand, Loader2, UserRound } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTiempoReal } from "@/lib/tiempo-real";
import { getHistorialGestion, tomarGestion, pasarGestion, type OperadorVista } from "@/app/actions/detections";
import { TEXTO_ACCION, type PasoGestion } from "@/lib/gestion-alarma-texto";

/**
 * Quién opera la alarma y lo que se hizo con ella (16/10, Nico: «cuando un usuario toma una alerta
 * debe quedar registrado qué usuario la está operando en vivo, y un historial claro del manejo»).
 *
 * Arriba, el operador: «La atendés vos» con «Pasar», o «La atiende Juan · hace 3 min» con «Tomar»,
 * o «Nadie la tomó» con «Tomar». Pasar pide (opcional) qué dejarle dicho al compañero. Abajo, la
 * bitácora en orden: quién, qué, cuándo. Se actualiza sola cuando otro la toma o la pasa.
 *
 * `oscuro` para la ficha sobre la foto; claro para el panel de Gestión de alarmas.
 */
const hora = (iso: string) => new Date(iso).toLocaleTimeString("es-UY", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZone: "America/Montevideo" });
const hace = (iso: string) => { const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000)); return s < 60 ? `hace ${s} s` : s < 3600 ? `hace ${Math.round(s / 60)} min` : `hace ${Math.round(s / 3600)} h`; };

export function usarGestion(clave: string | null) {
    const [datos, setDatos] = useState<{ pasos: PasoGestion[]; operador: OperadorVista } | null>(null);
    const leer = useCallback(() => { if (clave) getHistorialGestion(clave).then(setDatos).catch(() => { }); }, [clave]);
    useEffect(() => { setDatos(null); leer(); }, [leer]);
    useTiempoReal("alarma_gestion", (x: any) => { if (!x?.clave || x.clave === clave) leer(); });
    return { datos, leer };
}

export function GestionEnVivo({ clave, deviceId, oscuro, inicio }: { clave: string; deviceId?: string | null; oscuro?: boolean; inicio?: EventoActividad[] }) {
    const { datos, leer } = usarGestion(clave);
    const [ocupado, setOcupado] = useState(false);
    const [pasando, setPasando] = useState(false);
    const [nota, setNota] = useState("");
    const op = datos?.operador;
    const tomar = async () => { setOcupado(true); try { await tomarGestion(clave, deviceId); leer(); } finally { setOcupado(false); } };
    const pasar = async () => { setOcupado(true); try { await pasarGestion(clave, nota.trim() || null, deviceId); setPasando(false); setNota(""); leer(); } finally { setOcupado(false); } };
    const suave = oscuro ? "text-white/55" : "text-muted-foreground";

    return (
        <div className="space-y-2.5">
            <div className={cn("flex items-center gap-2.5 rounded-[10px] px-3 py-2", oscuro ? "bg-white/[0.07]" : "bg-muted/50")}>
                <span className={cn("grid h-8 w-8 place-items-center rounded-full shrink-0", op?.operador ? "bg-[var(--accion)] text-white" : oscuro ? "bg-white/10 text-white/60" : "bg-muted text-muted-foreground")}>
                    <UserRound size={15} />
                </span>
                <div className="min-w-0 flex-1 leading-tight">
                    <div className="text-[13px] font-semibold truncate">{!datos ? "…" : op?.soyYo ? "La estás atendiendo vos" : op?.operador ? `La atiende ${op.operador}` : "Nadie la tomó"}</div>
                    <div className={cn("text-[11px]", suave)}>{op?.desde ? `desde ${hora(op.desde)} · ${hace(op.desde)}` : "Tomala para que tus compañeros sepan que está en manos de alguien"}</div>
                </div>
                {datos && (op?.soyYo
                    ? <button type="button" onClick={() => setPasando((v) => !v)} disabled={ocupado} className={cn("h-8 px-3 rounded-[8px] text-[12px] font-bold inline-flex items-center gap-1.5 shrink-0", oscuro ? "bg-white/12 hover:bg-white/20" : "bg-background border border-border hover:bg-accent")}><ArrowRightLeft size={13} /> Pasar</button>
                    : <button type="button" onClick={tomar} disabled={ocupado} className="h-8 px-3 rounded-[8px] text-[12px] font-bold inline-flex items-center gap-1.5 shrink-0 bg-[var(--accion)] text-white hover:opacity-90 disabled:opacity-60">{ocupado ? <Loader2 size={13} className="animate-spin" /> : <Hand size={13} />} {op?.operador ? "Tomarla" : "Tomar"}</button>)}
            </div>
            {pasando && (
                <div className="flex items-center gap-2">
                    <input autoFocus value={nota} onChange={(e) => setNota(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void pasar(); if (e.key === "Escape") setPasando(false); }}
                        placeholder="Qué dejarle dicho (opcional)" maxLength={500}
                        className={cn("flex-1 h-9 rounded-[8px] px-3 text-[12.5px] outline-none", oscuro ? "bg-white/10 placeholder:text-white/40 focus:ring-2 focus:ring-white/30" : "bg-background border border-border focus:ring-2 focus:ring-[var(--accion)]/40")} />
                    <button type="button" onClick={pasar} disabled={ocupado} className="h-9 px-3.5 rounded-[8px] text-[12px] font-bold bg-[var(--accion)] text-white disabled:opacity-60">Pasarla</button>
                </div>
            )}
            {datos && <Actividad pasos={datos.pasos} inicio={inicio} oscuro={oscuro} />}
        </div>
    );
}

/*
 * La actividad de la alarma, como un historial de git (16/10, Nico: «en el drawer debe estar el
 * comportamiento de actividad tipo git»). Una línea vertical con un nodo por cosa que pasó, la más
 * nueva arriba, agrupada por día: quién (con su inicial), qué, cuándo —«hace 3 min» a la derecha y la
 * hora exacta al pasar el mouse— y el detalle debajo. El primer nodo es el origen: lo que abrió la
 * alarma (la cámara, el patrón, la regla), para que la historia se lea entera aunque nadie la haya
 * tocado todavía. `inicio` trae esos nodos que no están en la bitácora (el origen y, en alarmas
 * atendidas antes de que existiera la bitácora, quién la atendió).
 */
export type EventoActividad = {
    id: string; ts: string; por: string | null; texto: string; detalle?: string | null; tipo?: "origen" | "bien" | "mal" | "info";
    /** De antes de la bitácora: se muestra sólo si la bitácora no tiene ya una decisión (o una nota). */
    legado?: "decision" | "nota";
};
const DECISIONES = new Set(["CONFIRMO_REAL", "MARCO_FALSA", "MARCO_REAL", "DESACTIVO", "ERA_FALSA", "ATENDIO"]);

const COLOR_NODO: Record<string, string> = {
    TOMO: "var(--accion)", PASO: "var(--info)", CONFIRMO_REAL: "var(--mal)", MARCO_REAL: "var(--mal)", MARCO_FALSA: "var(--muted-foreground)",
    ERA_FALSA: "var(--muted-foreground)", DESACTIVO: "var(--bien)", ATENDIO: "var(--bien)", NOTA: "var(--aviso)",
    origen: "var(--mal)", bien: "var(--bien)", mal: "var(--mal)", info: "var(--info)",
};
const diaLargo = (iso: string) => new Date(iso).toLocaleDateString("es-UY", { weekday: "short", day: "numeric", month: "short", timeZone: "America/Montevideo" });
const iniciales = (n: string | null) => (n || "S").split(/\s+/).filter(Boolean).slice(0, 2).map((x) => x[0]!.toUpperCase()).join("");
/** Un tono estable por persona: la misma persona, el mismo color en toda la historia. */
const tonoPersona = (n: string | null) => { let h = 0; for (const c of n || "") h = (h * 31 + c.charCodeAt(0)) % 360; return `oklch(0.62 0.13 ${h})`; };

function Actividad({ pasos, inicio = [], oscuro }: { pasos: PasoGestion[]; inicio?: EventoActividad[]; oscuro?: boolean }) {
    const todos = [
        ...pasos.map((p) => ({ id: p.id, ts: p.ts, por: p.por, texto: TEXTO_ACCION[p.accion]?.toLowerCase() || p.accion, detalle: p.detalle ? (p.accion === "NOTA" || p.accion === "PASO" ? `«${p.detalle}»` : p.detalle) : null, color: COLOR_NODO[p.accion] || "var(--muted-foreground)", origen: false })),
        ...inicio.filter((e) => !e.legado || (e.legado === "decision" ? !pasos.some((p) => DECISIONES.has(p.accion)) : !pasos.some((p) => p.accion === "NOTA"))).map((e) => ({ id: e.id, ts: e.ts, por: e.por, texto: e.texto, detalle: e.detalle || null, color: COLOR_NODO[e.tipo || "info"], origen: e.tipo === "origen" })),
    ].sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0));
    const suave = oscuro ? "text-white/55" : "text-muted-foreground";
    let diaPrevio = "";
    return (
        <div>
            <div className="flex items-baseline justify-between mb-2">
                <span className={cn("text-[10px] font-bold uppercase tracking-[0.14em]", suave)}>Actividad</span>
                <span className={cn("text-[11px] tabular-nums", suave)}>{todos.length} {todos.length === 1 ? "evento" : "eventos"}</span>
            </div>
            {todos.length === 0 ? <p className={cn("text-[11.5px]", suave)}>Todavía no pasó nada con esta alarma.</p> : (
                <ol className="relative">
                    {/* El riel: une los nodos de arriba abajo, como el grafo de un log. */}
                    <span aria-hidden className={cn("absolute left-[11px] top-3 bottom-3 w-[2px] rounded-full", oscuro ? "bg-white/12" : "bg-border")} />
                    {todos.map((e) => {
                        const d = diaLargo(e.ts);
                        const separador = d !== diaPrevio; diaPrevio = d;
                        return (
                            <li key={e.id} className="relative">
                                {separador && <div className={cn("relative pl-8 pt-1 pb-1.5 text-[10.5px] font-semibold capitalize", suave)}>{d}</div>}
                                <div className="relative flex items-start gap-2.5 pb-3">
                                    <span aria-hidden className={cn("relative z-[1] mt-[3px] grid place-items-center shrink-0", e.origen ? "h-[24px] w-[24px]" : "h-[24px] w-[24px]")}>
                                        <span className={cn("block rounded-full ring-[3px]", e.origen ? "h-3.5 w-3.5 rotate-45 rounded-[3px]" : "h-3 w-3", oscuro ? "ring-[#05070b]" : "ring-background")} style={{ background: e.color }} />
                                    </span>
                                    <div className="min-w-0 flex-1">
                                        <div className="flex items-start gap-2">
                                            <span className="grid h-5 w-5 place-items-center rounded-full text-[9px] font-bold text-white shrink-0 mt-px" style={{ background: e.origen ? "var(--muted-foreground)" : tonoPersona(e.por) }} title={e.por || "Sistema"}>{e.origen ? "•" : iniciales(e.por)}</span>
                                            <div className="min-w-0 flex-1 text-[12.5px] leading-snug">
                                                <span className="font-semibold">{e.por || "Sistema"}</span> <span className={e.origen ? "" : suave}>{e.texto}</span>
                                            </div>
                                            <span className={cn("shrink-0 text-[11px] tabular-nums", suave)} title={`${diaLargo(e.ts)} ${hora(e.ts)}`}>{hace(e.ts)}</span>
                                        </div>
                                        {e.detalle && <div className={cn("mt-1 ml-7 text-[12px] leading-snug rounded-[8px] px-2.5 py-1.5", oscuro ? "bg-white/[0.06] text-white/80" : "bg-muted/50 text-foreground/85")}>{e.detalle}</div>}
                                        <div className={cn("ml-7 mt-0.5 text-[10px] tabular-nums tracking-wide", oscuro ? "text-white/30" : "text-muted-foreground/60")}>{e.id.slice(-7)} · {hora(e.ts)}</div>
                                    </div>
                                </div>
                            </li>
                        );
                    })}
                </ol>
            )}
        </div>
    );
}
