"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import { ImageIcon, Loader2, Scan, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { ICONO_GRUPO, nombreClase } from "@/components/vision/ObjetoRegistro";

/**
 * Buscar con una foto: la que se sube, se arrastra, se pega o se saca con el celular.
 *
 * Las huellas del registro son de RECORTES (una persona, un auto), no de escenas: una foto de
 * la calle entera no se parece a ningún recorte. Por eso primero se le pregunta a omni-vision
 * qué hay en la foto, se marca cada cosa encima, y se busca la que se elija —de entrada la más
 * grande—. «Toda la foto» queda para cuando lo que se busca no es algo que el detector conozca.
 */

/** Lado mayor con que se manda la foto: alcanza para detectar y no sube 4 MB de celular. */
const LADO_MAX = 1600;
/** Margen alrededor del objeto elegido, como el recorte que guarda el registro. */
const MARGEN = 0.06;
const CALIDAD = 0.9;

export type FotoElegida = { blob: Blob; miniatura: string; etiqueta: string };
type Objeto = { caja: [number, number, number, number]; clase: string; grupo: string; confianza: number };

async function reducir(archivo: File): Promise<HTMLCanvasElement> {
    const bmp = await createImageBitmap(archivo);
    const k = Math.min(1, LADO_MAX / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas");
    c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
    bmp.close();
    return c;
}

function aBlob(c: HTMLCanvasElement): Promise<Blob> {
    return new Promise((ok, mal) => c.toBlob((b) => (b ? ok(b) : mal(new Error("No se pudo leer la foto"))), "image/jpeg", CALIDAD));
}

function recortar(base: HTMLCanvasElement, caja: Objeto["caja"] | null): HTMLCanvasElement {
    if (!caja) return base;
    const [x1, y1, x2, y2] = caja, W = base.width, H = base.height;
    const mx = (x2 - x1) * MARGEN, my = (y2 - y1) * MARGEN;
    const a = Math.max(0, (x1 - mx) * W), b = Math.max(0, (y1 - my) * H);
    const w = Math.min(W, (x2 + mx) * W) - a, h = Math.min(H, (y2 + my) * H) - b;
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h));
    c.getContext("2d")!.drawImage(base, a, b, w, h, 0, 0, c.width, c.height);
    return c;
}

export function FotoParaBuscar({ archivo, alElegir, alCerrar }: { archivo: File; alElegir: (f: FotoElegida) => void; alCerrar: () => void }) {
    const [base, setBase] = useState<HTMLCanvasElement | null>(null);
    const [url, setUrl] = useState<string | null>(null);
    const [objetos, setObjetos] = useState<Objeto[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [elegido, setElegido] = useState<number | "toda" | null>(null);

    useEffect(() => {
        let vivo = true;
        setObjetos(null); setError(null); setElegido(null);
        (async () => {
            try {
                const c = await reducir(archivo);
                if (!vivo) return;
                setBase(c); setUrl(c.toDataURL("image/jpeg", 0.85));
                const r = await fetch("/api/vision/buscar?objetos=1", { method: "POST", body: await aBlob(c), headers: { "content-type": "image/jpeg" } });
                const j = await r.json().catch(() => ({}));
                if (!r.ok) throw new Error(j?.error || `El servidor respondió ${r.status}`);
                if (vivo) setObjetos(j.objetos || []);
            } catch (e: any) { if (vivo) setError(e?.message || "No se pudo mirar la foto"); }
        })();
        return () => { vivo = false; };
    }, [archivo]);

    async function elegir(i: number | "toda") {
        if (!base) return;
        setElegido(i);
        const o = i === "toda" ? null : objetos![i];
        const c = recortar(base, o?.caja ?? null);
        alElegir({ blob: await aBlob(c), miniatura: c.toDataURL("image/jpeg", 0.7), etiqueta: o ? nombreClase(o.clase) : "Toda la foto" });
    }

    // De entrada, lo más grande: casi siempre es lo que se fotografió. Sin nada reconocible, la foto entera.
    const mayor = useMemo(() => {
        if (!objetos?.length) return null;
        let m = 0, area = -1;
        objetos.forEach((o, i) => { const a = (o.caja[2] - o.caja[0]) * (o.caja[3] - o.caja[1]); if (a > area) { area = a; m = i; } });
        return m;
    }, [objetos]);
    useEffect(() => { if (objetos && elegido === null) elegir(mayor ?? "toda"); }, [objetos]); // eslint-disable-line react-hooks/exhaustive-deps

    return (
        <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}
            className="rounded-[10px] border border-border bg-card p-3 flex flex-col sm:flex-row gap-3">
            <div className="relative bg-black rounded-[6px] overflow-hidden sm:w-[360px] shrink-0 grid place-items-center min-h-[160px]">
                {url ? (
                    <div className="relative">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={url} alt="" className="block max-h-[260px] w-auto" draggable={false} />
                        {objetos?.map((o, i) => {
                            const [x1, y1, x2, y2] = o.caja, sel = elegido === i;
                            return (
                                <button key={i} type="button" onClick={() => elegir(i)} aria-label={`Buscar ${nombreClase(o.clase)}`}
                                    className={cn("absolute rounded-[4px] border-2 transition-colors", sel ? "border-[var(--accion-en-oscuro,#60a5fa)] bg-[color-mix(in_oklab,var(--accion-en-oscuro,#60a5fa)_18%,transparent)]" : "border-white/70 hover:border-white bg-transparent")}
                                    style={{ left: `${x1 * 100}%`, top: `${y1 * 100}%`, width: `${(x2 - x1) * 100}%`, height: `${(y2 - y1) * 100}%` }} />
                            );
                        })}
                        {!objetos && !error && (
                            <div className="absolute inset-0 grid place-items-center bg-black/40 text-white text-[12px] font-semibold">
                                <span className="inline-flex items-center gap-1.5"><Loader2 size={14} className="animate-spin" /> Mirando la foto…</span>
                            </div>
                        )}
                    </div>
                ) : <Loader2 size={18} className="animate-spin text-white/60" />}
            </div>
            <div className="min-w-0 flex-1 flex flex-col gap-2">
                <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                        <div className="text-[13px] font-bold">Buscar con esta foto</div>
                        <p className="text-[12px] text-muted-foreground leading-snug">Tocá en la foto lo que querés buscar. Se compara con lo que registraron las cámaras, por cómo se ve.</p>
                    </div>
                    <button type="button" onClick={alCerrar} aria-label="Quitar la foto" className="h-7 w-7 grid place-items-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent"><X size={15} /></button>
                </div>
                {error ? <p className="text-[12px] tono-mal">{error}</p> : objetos && (
                    <div className="flex flex-wrap gap-1.5">
                        {objetos.map((o, i) => {
                            const I = ICONO_GRUPO[o.grupo] || Scan;
                            return (
                                <button key={i} type="button" onClick={() => elegir(i)} aria-pressed={elegido === i}
                                    className={cn("h-8 pl-1 pr-2.5 rounded-full border text-[12px] font-semibold inline-flex items-center gap-1.5 transition-colors",
                                        elegido === i ? "border-[var(--accion)] bg-[var(--accion)] text-white" : "border-border hover:bg-accent")}>
                                    <span className={cn("grid place-items-center h-6 w-6 rounded-full", elegido === i ? "bg-white/20" : "bg-foreground text-background")}><I size={13} strokeWidth={2.4} /></span>
                                    {nombreClase(o.clase)}
                                </button>
                            );
                        })}
                        <button type="button" onClick={() => elegir("toda")} aria-pressed={elegido === "toda"}
                            className={cn("h-8 pl-1 pr-2.5 rounded-full border text-[12px] font-semibold inline-flex items-center gap-1.5 transition-colors",
                                elegido === "toda" ? "border-[var(--accion)] bg-[var(--accion)] text-white" : "border-border hover:bg-accent")}>
                            <span className={cn("grid place-items-center h-6 w-6 rounded-full", elegido === "toda" ? "bg-white/20" : "bg-foreground text-background")}><ImageIcon size={13} strokeWidth={2.4} /></span>
                            Toda la foto
                        </button>
                    </div>
                )}
                {objetos && objetos.length === 0 && <p className="text-[11.5px] text-muted-foreground">No se reconoce una persona, un vehículo ni un animal: se busca con la foto entera, que funciona peor.</p>}
            </div>
        </motion.div>
    );
}
