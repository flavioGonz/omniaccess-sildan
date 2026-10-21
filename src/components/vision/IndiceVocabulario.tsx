"use client";

import { useCallback, useEffect, useState } from "react";
import { Database, Loader2 } from "lucide-react";
import { Pista } from "@/components/ui/pista";
import { cn } from "@/lib/utils";

/**
 * El índice de «objetos en las fotos» (vocabulario abierto, OWLv2): cuánto hay indexado y cómo se
 * mantiene (21/10). Vivía en el panel «Objetos» del Historial; cuando ese panel pasó a ser parte de
 * OmniVision dentro del buscador único, la administración del índice se perdió. Vuelve acá, en
 * OmniVision › Buscar, que es donde se busca por objeto.
 *
 * Modos (Setting VOCAB_INDICE, lo lee vision-vocab-indice.js):
 *  · siempre: cada foto se indexa al llegar (el modelo queda cargado en la GPU);
 *  · de noche: sólo en la ventana 02:00–06:00 (lo que usa San Nicolás con su 3050 de 6 GB);
 *  · no: no indexa más; lo indexado se sigue pudiendo buscar.
 */
type Estado = { indice: { fotos: number; ultimo_ts: number | null; dias: Record<string, number>; mb: number } | null; conf: { modo: string; ventana?: string } };
const MODOS: { v: string; r: string; ayuda: string }[] = [
    { v: "continuo", r: "Siempre", ayuda: "Cada foto se indexa al llegar. El modelo queda cargado en la GPU." },
    { v: "noche", r: "De noche", ayuda: "Sólo en la ventana de la noche (02:00–06:00): de día la GPU queda libre." },
    { v: "apagado", r: "No", ayuda: "No indexa más. Lo ya indexado se sigue pudiendo buscar." },
];

export function IndiceVocabulario() {
    const [e, setE] = useState<Estado | null>(null);
    const [error, setError] = useState(false);
    const [cambiando, setCambiando] = useState<string | null>(null);
    const traer = useCallback(() => {
        fetch("/api/vision/vocabulario/indice", { cache: "no-store" }).then((r) => (r.ok ? r.json() : Promise.reject())).then((j) => { setE(j); setError(false); }).catch(() => setError(true));
    }, []);
    useEffect(() => { traer(); const i = setInterval(traer, 30_000); return () => clearInterval(i); }, [traer]);
    const cambiar = async (modo: string) => {
        setCambiando(modo);
        try { const r = await fetch("/api/vision/vocabulario/indice", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ modo }) }); if (r.ok) traer(); }
        finally { setCambiando(null); }
    };
    if (error && !e) return null; // sin permiso o sin OmniVision: no se muestra nada
    if (!e) return null;
    const dias = Object.keys(e.indice?.dias || {}).sort();
    return (
        <div className="flex items-center gap-2.5 flex-wrap text-[12px] text-muted-foreground">
            <Database size={14} className="shrink-0" />
            {e.indice ? (
                <span>
                    Índice de objetos: <b className="text-foreground tabular-nums">{e.indice.fotos.toLocaleString("es-UY")}</b> fotos
                    {dias.length ? ` desde el ${new Date(`${dias[0]}T12:00`).toLocaleDateString("es-UY", { day: "2-digit", month: "2-digit" })}` : ""}
                    {e.indice.ultimo_ts ? ` · al día hasta las ${new Date(e.indice.ultimo_ts).toLocaleTimeString("es-UY", { hour: "2-digit", minute: "2-digit", hour12: false })}` : ""}
                </span>
            ) : <span>Este servidor no tiene índice de objetos: se revisa foto por foto.</span>}
            <span className="ml-auto inline-flex items-center gap-1.5">
                <span>Indexar</span>
                <span className="inline-flex rounded-full border border-border p-0.5">
                    {MODOS.map((m) => (
                        <Pista key={m.v} titulo={`Indexar: ${m.r.toLowerCase()}`} texto={m.ayuda}>
                            <button type="button" onClick={() => e.conf.modo !== m.v && cambiar(m.v)} aria-pressed={e.conf.modo === m.v} disabled={!!cambiando}
                                className={cn("h-7 px-2.5 rounded-full text-[11.5px] font-semibold inline-flex items-center gap-1 transition-colors", e.conf.modo === m.v ? "accion" : "text-muted-foreground hover:text-foreground")}>
                                {cambiando === m.v && <Loader2 size={11} className="animate-spin" />} {m.r}
                            </button>
                        </Pista>
                    ))}
                </span>
            </span>
        </div>
    );
}
