"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { Brain, Car, Loader2, MapPin } from "lucide-react";
import type { AnalisisDeteccion as Datos, Indicio } from "@/lib/intrusion/analisis";
import { cn } from "@/lib/utils";

const MapaCruce = dynamic(() => import("@/components/intrusion/MapaCruce"), { ssr: false, loading: () => <div className="h-[220px] rounded-[10px] bg-muted animate-pulse" /> });

/**
 * El análisis de una detección (lib/intrusion/analisis): los indicios con su número y el
 * recuadro de mapa con el cruce. Una pieza para la ficha del panel y la de la pared.
 *
 * Indicios y no veredicto: la decisión es de quien mira la foto. Cada frase dice de dónde sale.
 */

const PUNTO: Record<Indicio["tono"], string> = { mal: "bg-[var(--mal)]", aviso: "bg-[var(--aviso)]", bien: "bg-[var(--bien)]", info: "bg-[var(--info)]", neutro: "bg-muted-foreground" };
const hora = (ts: string) => new Date(ts).toLocaleTimeString("es-UY", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });

export function AnalisisDeteccion({ id, grande, className }: { id: string; grande?: boolean; className?: string }) {
    const [a, setA] = useState<Datos | null>(null);
    const [error, setError] = useState<string | null>(null);
    useEffect(() => {
        if (!id || id.startsWith("live-")) return;
        let vivo = true;
        setA(null); setError(null);
        fetch(`/api/monitor/intrusion/analisis?id=${encodeURIComponent(id)}`, { cache: "no-store" })
            .then(async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || `El servidor respondió ${r.status}`); if (vivo) setA(j); })
            .catch((e) => { if (vivo) setError(e?.message || "sin respuesta"); });
        return () => { vivo = false; };
    }, [id]);

    const texto = grande ? "text-[15px]" : "text-[12.5px]";
    if (id.startsWith("live-")) return null;
    return (
        <div className={cn("grid gap-3", a?.mapa ? "md:grid-cols-[1.25fr_1fr]" : "", className)}>
            <div className="min-w-0 rounded-[10px] border border-border bg-card p-3.5">
                <div className={cn("flex items-center gap-2 font-bold uppercase tracking-[0.14em] text-muted-foreground mb-2.5", grande ? "text-[12px]" : "text-[9px]")}>
                    <Brain size={grande ? 15 : 13} /> Análisis
                </div>
                {error ? <p className={cn(texto, "text-muted-foreground")}>No se pudo analizar: {error}</p>
                    : !a ? <p className={cn(texto, "text-muted-foreground flex items-center gap-2")}><Loader2 size={13} className="animate-spin" /> Mirando alrededor de esta detección…</p>
                        : (<>
                            <div className="grid grid-cols-3 gap-2 mb-3">
                                <Cifra grande={grande} v={a.rafaga.cantidad} l={a.rafaga.cantidad === 1 ? "detección en el episodio" : "detecciones en el episodio"} />
                                <Cifra grande={grande} v={a.ritmo.hoy} l="hoy en esta cámara" />
                                <Cifra grande={grande} v={a.historial.revisadas >= 5 ? `${Math.round((a.historial.falsas / a.historial.revisadas) * 100)} %` : "—"} l={a.historial.revisadas >= 5 ? "de falsas en esta cámara" : "pocas revisadas aún"} />
                            </div>
                            {a.indicios.length === 0 ? <p className={cn(texto, "text-muted-foreground")}>Nada fuera de lo común alrededor de esta detección.</p> : (
                                <ul className="space-y-1.5">
                                    {a.indicios.map((i, k) => (
                                        <li key={k} className={cn("flex items-start gap-2 text-foreground leading-snug", texto)}>
                                            <span className={cn("mt-[0.45em] h-2 w-2 rounded-full shrink-0", PUNTO[i.tono])} />
                                            <span>{i.texto}</span>
                                        </li>
                                    ))}
                                </ul>
                            )}
                            {a.lecturas.length > 0 && (
                                <div className="mt-3 flex flex-wrap gap-1.5">
                                    {a.lecturas.slice(0, 6).map((l, k) => (
                                        <span key={k} className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md border border-border bg-muted text-[11.5px]">
                                            <Car size={12} className="text-muted-foreground" />
                                            <b className="tabular-nums tracking-[0.08em]">{l.plate}</b>
                                            <span className="text-muted-foreground tabular-nums">{l.sentido === "EXIT" ? "sale" : "entra"} {hora(l.timestamp)}</span>
                                        </span>
                                    ))}
                                </div>
                            )}
                        </>)}
            </div>
            {a?.mapa && (
                <div className="min-w-0">
                    <div className={cn("flex items-center gap-2 font-bold uppercase tracking-[0.14em] text-muted-foreground mb-1.5", grande ? "text-[12px]" : "text-[9px]")}>
                        <MapPin size={grande ? 15 : 13} /> Dónde fue el cruce
                    </div>
                    <MapaCruce mapa={a.mapa} alto={grande ? 260 : 210} />
                    <div className={cn("mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-muted-foreground", grande ? "text-[13px]" : "text-[11px]")}>
                        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-[var(--accion-en-oscuro)] ring-2 ring-white/80" /> La cámara</span>
                        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-[var(--mal)]" /> Su línea o zona</span>
                        {a.mapa.otras.length > 0 && <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-[var(--aviso)] ring-2 ring-white/80" /> Otras que detectaron</span>}
                    </div>
                </div>
            )}
        </div>
    );
}

function Cifra({ v, l, grande }: { v: number | string; l: string; grande?: boolean }) {
    return (
        <div className="rounded-md bg-muted px-2.5 py-2">
            <div className={cn("font-bold tabular-nums leading-none", grande ? "text-[24px]" : "text-[18px]")}>{v}</div>
            <div className={cn("text-muted-foreground mt-1 leading-tight", grande ? "text-[12px]" : "text-[10.5px]")}>{l}</div>
        </div>
    );
}
