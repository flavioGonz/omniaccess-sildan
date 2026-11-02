"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { horaSeg } from "@/lib/fechas";
import { useTiempoReal } from "@/lib/tiempo-real";
import { VEREDICTOS } from "@/lib/vision-capa";
import type { FotoCentral, VerificacionCentral } from "@/lib/centrales/verificacion";

/**
 * La video verificación de un evento de central en su ficha (lib/centrales/verificacion): las fotos
 * de cada cámara de la zona, del momento y de ahora, con lo que vio OmniVision en cada una.
 */

const TONO: Record<string, string> = { mal: "var(--mal)", aviso: "var(--aviso)", quieto: "rgba(255,255,255,0.45)", bien: "var(--bien)" };

/** Pide la verificación y la vuelve a pedir cuando OmniVision avisa que terminó (socket detection_verified). */
export function useVerificacionCentral(id: string | null) {
    const [datos, setDatos] = useState<VerificacionCentral | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [pidiendo, setPidiendo] = useState(false);
    const pedir = useCallback(() => {
        if (!id) return;
        fetch(`/api/centrales/eventos/${encodeURIComponent(id)}/verificacion`, { cache: "no-store" })
            .then((r) => r.json())
            .then((j) => { if (j?.ok) { setDatos(j); setError(null); } else setError(j?.error || "No se pudo traer la verificación."); })
            .catch(() => setError("No se pudo traer la verificación."));
    }, [id]);
    useEffect(() => { setDatos(null); setError(null); pedir(); }, [pedir]);
    useTiempoReal("detection_verified", (x: any) => { if (x?.id && x.id === id) pedir(); });
    // Mientras está en cola sin socket (otra pestaña, reconexión), una mirada cada 6 s.
    useEffect(() => {
        if (datos?.estado !== "PEDIDA") return;
        const t = setInterval(pedir, 6000);
        return () => clearInterval(t);
    }, [datos?.estado, pedir]);

    /** «Volver a verificar»: cuadros de ahora de las cámaras de la zona y otra vuelta de OmniVision. */
    const verificarAhora = useCallback(async () => {
        if (!id || pidiendo) return;
        setPidiendo(true); setError(null);
        try {
            const r = await fetch(`/api/centrales/eventos/${encodeURIComponent(id)}/verificacion`, { method: "POST" });
            const j = await r.json().catch(() => ({}));
            if (!j?.ok) setError(j?.error || "No se pudo volver a verificar.");
        } catch { setError("No se pudo volver a verificar."); }
        setPidiendo(false);
        pedir();
    }, [id, pidiendo, pedir]);

    return { datos, error, pidiendo, verificarAhora, pedir };
}

/** El rótulo de una foto: de qué momento es. */
export function momentoDe(f: FotoCentral): string {
    return f.momento === "evento" ? `Del evento · ${horaSeg(f.en)}` : `De ahora · ${horaSeg(f.en)}`;
}

/**
 * Las fotos, en una tira de vidrio arriba a la derecha de la ventana: una por cámara y momento, con
 * su veredicto. Tocar una la pone en grande. Primero las del evento, después las de ahora.
 */
export function TiraFotosCentral({ fotos, sel, onSel, verificando }: { fotos: FotoCentral[]; sel: number; onSel: (i: number) => void; verificando: boolean }) {
    if (!fotos.length) return null;
    return (
        <div className="visor-panel rounded-[14px] p-1.5 flex items-stretch gap-1.5 overflow-x-auto [scrollbar-width:none] max-w-[min(640px,52vw)]">
            {fotos.map((f, i) => {
                const v = f.veredicto ? VEREDICTOS[f.veredicto] : null;
                const antes = i > 0 && fotos[i - 1].momento !== f.momento;
                return (
                    <div key={f.foto} className="flex items-stretch gap-1.5 shrink-0">
                        {antes && <span className="w-px self-stretch my-1 bg-white/15" aria-hidden />}
                        <button type="button" onClick={() => onSel(i)} aria-pressed={i === sel} title={`${f.nombre} · ${momentoDe(f)}${v ? ` · ${v.rotulo}` : f.fuera ? " · la cámara no está en OmniVision" : ""}`}
                            className={cn("group relative w-[124px] rounded-[10px] overflow-hidden text-left transition-[box-shadow,opacity]",
                                i === sel ? "ring-2 ring-[var(--accion-en-oscuro)]" : "opacity-80 hover:opacity-100 ring-1 ring-white/10")}>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={f.foto} alt="" draggable={false} className="block w-full aspect-video object-cover bg-black" />
                            <span className="absolute inset-x-0 bottom-0 px-1.5 pt-4 pb-1 bg-gradient-to-t from-black/85 to-transparent">
                                <span className="block text-[10.5px] font-semibold text-white truncate leading-tight">{f.nombre}</span>
                                <span className="flex items-center gap-1 text-[9.5px] text-white/70 tabular-nums leading-tight">
                                    {v ? <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: TONO[v.tono] }} />
                                        : verificando ? <Loader2 size={9} className="animate-spin shrink-0" /> : null}
                                    <span className="truncate">{f.momento === "evento" ? "Evento" : "Ahora"} · {horaSeg(f.en)}{f.fuera ? " · sin OmniVision" : ""}</span>
                                </span>
                            </span>
                            {v && v.tono !== "quieto" && (
                                <span className="absolute top-1 left-1 px-1.5 py-[1px] rounded-full text-[9px] font-bold text-white" style={{ background: TONO[v.tono] }}>{v.rotulo}</span>
                            )}
                        </button>
                    </div>
                );
            })}
        </div>
    );
}
