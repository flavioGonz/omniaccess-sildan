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

export function GestionEnVivo({ clave, deviceId, oscuro }: { clave: string; deviceId?: string | null; oscuro?: boolean }) {
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
            {datos && datos.pasos.length > 0 && (
                <ol className="relative space-y-2 pl-4">
                    <span aria-hidden className={cn("absolute left-[5px] top-1.5 bottom-1.5 w-px", oscuro ? "bg-white/15" : "bg-border")} />
                    {[...datos.pasos].reverse().map((p) => (
                        <li key={p.id} className="relative text-[12px] leading-snug">
                            <span aria-hidden className={cn("absolute -left-[14.5px] top-[5px] h-2 w-2 rounded-full", p.accion === "TOMO" ? "bg-[var(--accion)]" : p.accion === "CONFIRMO_REAL" || p.accion === "MARCO_REAL" ? "bg-[var(--mal)]" : p.accion === "DESACTIVO" || p.accion === "ATENDIO" ? "bg-[var(--bien)]" : oscuro ? "bg-white/40" : "bg-muted-foreground/50")} />
                            <span className="font-semibold">{p.por || "Sistema"}</span> <span className={suave}>{TEXTO_ACCION[p.accion]?.toLowerCase() || p.accion}</span>
                            <span className={cn("tabular-nums ml-1.5 text-[11px]", suave)}>{hora(p.ts)}</span>
                            {p.detalle && <div className={cn("text-[11.5px]", oscuro ? "text-white/75" : "text-foreground/80")}>{p.accion === "NOTA" || p.accion === "PASO" ? `«${p.detalle}»` : p.detalle}</div>}
                        </li>
                    ))}
                </ol>
            )}
            {datos && !datos.pasos.length && <p className={cn("text-[11.5px]", suave)}>Todavía nadie hizo nada con esta alarma.</p>}
        </div>
    );
}
