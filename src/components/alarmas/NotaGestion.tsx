"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, NotebookPen, Check } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * La nota de gestión de una alarma (16/10, Nico: «un campo de texto para la clasificación de
 * alarmas: registrar info sobre la gestión de cada evento»). Qué se hizo, a quién se avisó, qué
 * era. Se guarda en AlarmaAtendida por la clave de la alarma («d:<detección>», «a:<aviso>»,
 * «l:<lectura>»), la misma desde Gestión de alarmas y desde la ficha de intrusión.
 *
 * Una nota sola no cierra la alarma: se puede escribir mientras se atiende y decidir después.
 * Al decidir (real, falsa, atendida) se manda con la decisión lo que esté escrito.
 */
export type Gestion = { nota: string | null; por: string | null; ts: string; resultado: string | null; atendida: boolean } | null;

export function usarNotaGestion(id: string | null, inicial?: { nota: string | null; por: string | null; ts: string | null } | null) {
    const [texto, setTexto] = useState(inicial?.nota || "");
    const [guardada, setGuardada] = useState<{ nota: string; por: string | null; ts: string | null } | null>(inicial?.nota ? { nota: inicial.nota, por: inicial.por, ts: inicial.ts } : null);
    const [guardando, setGuardando] = useState(false);
    const [error, setError] = useState<string | null>(null);
    // Al cambiar de alarma: lo que venía con ella, o se pide.
    useEffect(() => {
        setError(null);
        if (!id) { setTexto(""); setGuardada(null); return; }
        if (inicial !== undefined) { setTexto(inicial?.nota || ""); setGuardada(inicial?.nota ? { nota: inicial.nota, por: inicial.por, ts: inicial.ts } : null); return; }
        let vivo = true;
        fetch(`/api/alarmas?id=${encodeURIComponent(id)}`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((j) => {
            if (!vivo) return;
            const g: Gestion = j?.gestion || null;
            setTexto(g?.nota || ""); setGuardada(g?.nota ? { nota: g.nota, por: g.por, ts: g.ts } : null);
        }).catch(() => { });
        return () => { vivo = false; };
    }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
    const sucia = texto.trim() !== (guardada?.nota || "");
    /** Guarda la nota, y la decisión si viene. Devuelve si se pudo. */
    const guardar = useCallback(async (decision?: { atender: true; resultado: "real" | "falsa" | null }) => {
        if (!id) return false;
        if (!decision && !sucia) return true;
        setGuardando(true); setError(null);
        try {
            const r = await fetch("/api/alarmas", { method: "POST", headers: { "content-type": "application/json" },
                body: JSON.stringify({ id, ...(decision || {}), ...(sucia || decision ? { nota: texto } : {}) }) });
            const j = await r.json().catch(() => null);
            if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
            const g: Gestion = j?.gestion || null;
            setGuardada(g?.nota ? { nota: g.nota, por: g.por, ts: g.ts } : null);
            return true;
        } catch (e: any) { setError(e?.message || "No se pudo guardar."); return false; }
        finally { setGuardando(false); }
    }, [id, texto, sucia]);
    return { texto, setTexto, guardada, guardando, error, sucia, guardar };
}

export function NotaGestion({ n, oscuro, className }: { n: ReturnType<typeof usarNotaGestion>; oscuro?: boolean; className?: string }) {
    return (
        <div className={cn("flex flex-col gap-1.5", className)}>
            <label className={cn("inline-flex items-center gap-1.5 text-[11.5px] font-semibold", oscuro ? "text-white/70" : "text-muted-foreground")}>
                <NotebookPen size={13} /> Gestión de la alarma
            </label>
            <textarea value={n.texto} onChange={(e) => n.setTexto(e.target.value)} rows={2} maxLength={1000}
                onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void n.guardar(); } e.stopPropagation(); }}
                placeholder="Qué era, qué se hizo, a quién se avisó…"
                className={cn("w-full resize-y min-h-[56px] rounded-[6px] px-3 py-2 text-[13px] leading-snug focus:outline-none focus:ring-2",
                    oscuro ? "bg-black/45 text-white placeholder:text-white/40 border border-white/15 focus:ring-[var(--accion-en-oscuro)]/60"
                        : "bg-background border border-border focus:ring-[var(--accion)]/40")} />
            <div className="flex items-center gap-2 min-h-[28px]">
                <button type="button" onClick={() => void n.guardar()} disabled={!n.sucia || n.guardando}
                    className={cn("h-7 px-3 rounded-[6px] text-[12px] font-semibold inline-flex items-center gap-1.5 disabled:opacity-40",
                        oscuro ? "bg-white/15 hover:bg-white/25 text-white" : "bg-[var(--accion)] text-white hover:brightness-110")}>
                    {n.guardando ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Guardar nota
                </button>
                <span className={cn("text-[11px] truncate", n.error ? "tono-mal" : oscuro ? "text-white/50" : "text-muted-foreground")}>
                    {n.error ? n.error : n.sucia ? "Sin guardar · se guarda también al decidir" : n.guardada ? `Guardada${n.guardada.por ? ` por ${n.guardada.por}` : ""}${n.guardada.ts ? ` · ${new Date(n.guardada.ts).toLocaleString("es-UY", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })}` : ""}` : ""}
                </span>
            </div>
        </div>
    );
}
