"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Eye, GraduationCap, Loader2, SkipForward, Undo2 } from "lucide-react";
import { sileo as toast } from "sileo";
import { cn } from "@/lib/utils";
import { MIN_POR_CLASE, RECOMENDADO_POR_CLASE } from "@/lib/zona-entrenable";

/**
 * Enseñar una escena desde el celular: la zona de una cámara (un contenedor, un portón) se
 * muestra como la vio OmniVision en cada muestra, y se dice cuál de los dos estados es con dos
 * botones grandes. Es lo mismo que el etiquetado rápido del panel, hecho para el pulgar.
 *
 * Arranca por las «dudosas» (las que el modelo menos sabe decidir: cada una enseña más que diez
 * que ya acierta) y sigue con las sin etiquetar. «Mirar ahora» pide una muestra nueva al worker,
 * que la toma en su próxima vuelta (≤ 15 s): sirve para enseñar el estado que se tiene enfrente.
 */
export type ZonaMovil = {
    id: string; nombre: string; positivo: string; negativo: string; camara: string; umbral: number;
    conteo: { pos: number; neg: number; sin: number };
    modelo: { exactitud?: number | null } | null;
};
type Muestra = { id: string; url: string | null; prob: number | null; ts: string };
/** Lo que tarda el worker en tomar la muestra pedida con «Mirar ahora» (da una vuelta cada 15 s). */
const ESPERA_MIRAR_MS = 17_000;

async function pedir(url: string, init?: RequestInit) {
    const r = await fetch(url, { cache: "no-store", ...init });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j?.error || `El servidor respondió ${r.status}`);
    return j;
}

export function EscenaMovil({ zona, alVolver }: { zona: ZonaMovil; alVolver: () => void }) {
    const [cola, setCola] = useState<Muestra[] | null>(null);
    const [i, setI] = useState(0);
    const [hechas, setHechas] = useState<{ id: string; e: "pos" | "neg" }[]>([]);
    const [conteo, setConteo] = useState(zona.conteo);
    const [ocupado, setOcupado] = useState<"" | "marcar" | "mirar" | "entrenar">("");

    const traer = useCallback(async () => {
        try {
            let j = await pedir(`/api/vision/zonas/${zona.id}/muestras?vista=dudosas&limite=40`);
            if (!j.muestras?.length) j = await pedir(`/api/vision/zonas/${zona.id}/muestras?vista=sin&limite=40`);
            setCola(j.muestras || []); setI(0);
        } catch (e: any) { toast.error({ title: "No se pudieron traer las muestras", description: e?.message }); setCola([]); }
    }, [zona.id]);
    useEffect(() => { traer(); }, [traer]);

    const m = cola?.[i];
    const marcar = async (e: "pos" | "neg") => {
        if (!m) return;
        setOcupado("marcar");
        try {
            await pedir(`/api/vision/zonas/${zona.id}/muestras`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids: [m.id], etiqueta: e }) });
            setHechas((h) => [...h, { id: m.id, e }]);
            setConteo((c) => ({ ...c, [e]: c[e] + 1, sin: Math.max(0, c.sin - 1) }));
            setI((x) => x + 1);
        } catch (x: any) { toast.error({ title: "No se guardó", description: x?.message }); }
        finally { setOcupado(""); }
    };
    const deshacer = async () => {
        const h = hechas[hechas.length - 1];
        if (!h) return;
        try {
            await pedir(`/api/vision/zonas/${zona.id}/muestras`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids: [h.id], etiqueta: null }) });
            setHechas(hechas.slice(0, -1));
            setConteo((c) => ({ ...c, [h.e]: Math.max(0, c[h.e] - 1), sin: c.sin + 1 }));
            setI((x) => Math.max(0, x - 1));
        } catch (x: any) { toast.error({ title: "No se deshizo", description: x?.message }); }
    };
    const mirar = async () => {
        setOcupado("mirar");
        try {
            await pedir(`/api/vision/zonas/${zona.id}/probar`, { method: "POST" });
            await new Promise((r) => setTimeout(r, ESPERA_MIRAR_MS));
            const j = await pedir(`/api/vision/zonas/${zona.id}/muestras?vista=sin&limite=1`);
            const nueva: Muestra | undefined = j.muestras?.[0];
            if (nueva && !cola?.some((x) => x.id === nueva.id)) { setCola((c) => [...(c || []).slice(0, i), nueva, ...(c || []).slice(i)]); }
            else toast.info({ title: "Todavía no llegó", description: "La cámara puede tardar un poco más. Probá de nuevo en unos segundos." });
        } catch (x: any) { toast.error({ title: "No se pudo mirar", description: x?.message }); }
        finally { setOcupado(""); }
    };
    const entrenar = async () => {
        setOcupado("entrenar");
        try {
            const j = await pedir(`/api/vision/zonas/${zona.id}/entrenar`, { method: "POST" });
            const a = j?.modelo?.exactitud;
            toast.success({ title: "Entrenada", description: a != null ? `Acierta ${Math.round(a * 100)} % en las muestras que no vio.` : "El modelo nuevo ya está mirando." });
        } catch (x: any) { toast.error({ title: "No se entrenó", description: x?.message }); }
        finally { setOcupado(""); }
    };
    const alcanza = conteo.pos >= MIN_POR_CLASE && conteo.neg >= MIN_POR_CLASE;

    return (
        <div className="space-y-3">
            <div className="flex items-center gap-2">
                <button type="button" onClick={alVolver} aria-label="Volver" className="h-10 w-10 grid place-items-center rounded-full border border-border"><ArrowLeft size={18} /></button>
                <div className="min-w-0">
                    <div className="text-[16px] font-bold leading-tight truncate">{zona.nombre}</div>
                    <div className="text-[12px] text-muted-foreground truncate">{zona.camara}</div>
                </div>
            </div>

            <div className="grid grid-cols-2 gap-2 text-[12px]">
                {(["pos", "neg"] as const).map((k) => (
                    <div key={k} className="rounded-[10px] border border-border px-3 py-2">
                        <div className="font-semibold truncate">{k === "pos" ? zona.positivo : zona.negativo}</div>
                        <div className="tabular-nums text-muted-foreground"><b className="text-foreground">{conteo[k]}</b> de {RECOMENDADO_POR_CLASE} ejemplos</div>
                        <div className="mt-1 h-1.5 rounded-full bg-muted overflow-hidden"><span className={cn("block h-full rounded-full", k === "pos" ? "bg-[var(--aviso)]" : "bg-[var(--bien)]")} style={{ width: `${Math.min(100, (conteo[k] / RECOMENDADO_POR_CLASE) * 100)}%` }} /></div>
                    </div>
                ))}
            </div>

            <div className="rounded-[10px] overflow-hidden bg-black aspect-[4/3] relative grid place-items-center">
                {cola == null ? <Loader2 className="animate-spin text-white/60" />
                    : !m ? <p className="text-white/70 text-[13px] text-center px-6">No quedan muestras por etiquetar. Tocá «Mirar ahora» para tomar una del estado que tenés enfrente.</p>
                        : (
                            <>
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                {m.url && <img src={m.url} alt="" className="absolute inset-0 w-full h-full object-contain" />}
                                <span className="absolute top-2 left-2 rounded-md bg-black/60 text-white text-[11.5px] px-2 py-1 tabular-nums">
                                    {m.prob != null ? `OmniVision cree: ${Math.round(m.prob * 100)} % «${zona.positivo}»` : "Sin opinión todavía"}
                                </span>
                                <span className="absolute top-2 right-2 rounded-md bg-black/60 text-white text-[11.5px] px-2 py-1 tabular-nums">{i + 1} de {cola.length}</span>
                            </>
                        )}
            </div>

            <p className="text-[12.5px] text-center text-muted-foreground">¿Cómo está en esta foto?</p>
            <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => marcar("pos")} disabled={!m || !!ocupado} className="h-16 rounded-xl pleno-aviso text-[15px] font-bold disabled:opacity-40">{zona.positivo}</button>
                <button type="button" onClick={() => marcar("neg")} disabled={!m || !!ocupado} className="h-16 rounded-xl pleno-bien text-[15px] font-bold disabled:opacity-40">{zona.negativo}</button>
            </div>
            <div className="grid grid-cols-3 gap-2">
                <button type="button" onClick={deshacer} disabled={!hechas.length || !!ocupado} className="h-11 rounded-xl border border-border text-[12.5px] font-semibold inline-flex items-center justify-center gap-1.5 disabled:opacity-40"><Undo2 size={15} /> Deshacer</button>
                <button type="button" onClick={() => setI((x) => x + 1)} disabled={!m || !!ocupado} className="h-11 rounded-xl border border-border text-[12.5px] font-semibold inline-flex items-center justify-center gap-1.5 disabled:opacity-40"><SkipForward size={15} /> Saltar</button>
                <button type="button" onClick={mirar} disabled={!!ocupado} className="h-11 rounded-xl border border-border text-[12.5px] font-semibold inline-flex items-center justify-center gap-1.5 disabled:opacity-40">
                    {ocupado === "mirar" ? <Loader2 size={15} className="animate-spin" /> : <Eye size={15} />} Mirar ahora
                </button>
            </div>
            <button type="button" onClick={entrenar} disabled={!alcanza || !!ocupado}
                className="w-full h-12 rounded-xl bg-[var(--accion)] text-white text-[14px] font-bold inline-flex items-center justify-center gap-2 disabled:opacity-40">
                {ocupado === "entrenar" ? <Loader2 size={16} className="animate-spin" /> : <GraduationCap size={17} />} Entrenar con lo etiquetado
            </button>
            {!alcanza && <p className="text-[11.5px] text-center text-muted-foreground">Se puede entrenar con {MIN_POR_CLASE} ejemplos de cada estado; con {RECOMENDADO_POR_CLASE} suele andar bien.</p>}
        </div>
    );
}
