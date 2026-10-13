"use client";

import { HardDrive, Loader2, ScanSearch, Calculator } from "lucide-react";
import { cn } from "@/lib/utils";
import type { FilaGrabacion } from "@/app/actions/grabaciones";

/**
 * Dónde se graba una cámara (NVR + canal) y cuánto guarda. Igual para LPR e intrusión.
 * Sin NVR: botón para detectarlo (busca la IP en los canales de todos los NVR).
 * Con NVR: botón para calcular la retención (la grabación más vieja de ese canal).
 * Tooltips con react-tooltip: la página monta <Tooltip id="tt-grab" />.
 */
export function CeldaGrabacion({ g, detectando, calculando, onDetectar, onRetencion }: {
    g?: FilaGrabacion; detectando?: boolean; calculando?: boolean; onDetectar: () => void; onRetencion: () => void;
}) {
    if (!g) return <span className="inline-block h-8 w-32 rounded-md bg-muted/50 animate-pulse" />;
    const u = g.ubicacion; const r = g.retencion;
    if (!u) return (
        <button onClick={onDetectar} disabled={detectando}
            data-tooltip-id="tt-grab" data-tooltip-content="No sabemos dónde se graba. «Detectar» busca la IP de esta cámara en los canales de todos los NVR y la vincula sola. Sin NVR no hay clips ni playback."
            className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md border border-amber-500/30 bg-amber-500/10 text-amber-500 text-[10px] font-bold uppercase tracking-wide hover:bg-amber-500/20 transition">
            {detectando ? <Loader2 size={11} className="animate-spin" /> : <ScanSearch size={11} />} Sin NVR · detectar
        </button>
    );
    return (
        <div className="flex items-center gap-2 min-w-[190px]">
            <div className="space-y-0.5 min-w-0">
                <p className="text-xs font-semibold text-foreground flex items-center gap-1 truncate">
                    <HardDrive size={11} className="text-indigo-400 shrink-0" />
                    <span className="truncate max-w-[130px]">{u.nvrNombre || "NVR"}</span>
                    <span className="px-1.5 rounded bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 text-[9px] font-bold font-mono shrink-0">CH {u.ch}</span>
                </p>
                {r ? (
                    <p className={cn("text-[10px] flex items-center gap-1", r.error ? "text-red-400" : "text-muted-foreground")}>
                        <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", r.grabando === false ? "bg-red-500" : r.grabando ? "bg-emerald-500" : "bg-muted-foreground/40")} />
                        {r.error ? r.error : <><b className="text-foreground tabular-nums">{r.dias} días</b> · desde {r.desde.slice(0, 10).split("-").reverse().join("/")}</>}
                        {r.grabando === false && !r.error && <span className="text-red-400 font-semibold">· no graba</span>}
                    </p>
                ) : <p className="text-[10px] text-muted-foreground">Retención sin calcular</p>}
            </div>
            <div className="flex items-center gap-1 shrink-0">
                <button onClick={onRetencion} disabled={calculando}
                    data-tooltip-id="tt-grab" data-tooltip-content={`Calcular la retención: busca en el NVR la grabación más vieja de este canal; de ese día a hoy es lo que se guarda. También dice si está grabando ahora.${r ? ` Último cálculo: ${new Date(r.calculado).toLocaleString("es-UY")}.` : ""}`}
                    className="h-7 w-7 grid place-items-center rounded-md border border-border/60 bg-card/80 hover:bg-indigo-500/10 hover:text-indigo-400 text-muted-foreground">
                    {calculando ? <Loader2 size={13} className="animate-spin" /> : <Calculator size={13} />}
                </button>
                <button onClick={onDetectar} disabled={detectando}
                    data-tooltip-id="tt-grab" data-tooltip-content="Volver a detectar dónde graba (por si se movió de NVR o de canal)."
                    className="h-7 w-7 grid place-items-center rounded-md border border-border/60 bg-card/80 hover:bg-indigo-500/10 hover:text-indigo-400 text-muted-foreground">
                    {detectando ? <Loader2 size={13} className="animate-spin" /> : <ScanSearch size={13} />}
                </button>
            </div>
        </div>
    );
}
