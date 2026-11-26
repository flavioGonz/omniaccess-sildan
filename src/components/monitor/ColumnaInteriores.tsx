"use client";

import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { EyeOff, Waypoints, Crown, ShieldAlert, Eye } from "lucide-react";
import { cn } from "@/lib/utils";
import { ChapaMercosur } from "@/components/tracking/ChapaMercosur";
import { Cronometro, useTranscurrido } from "@/components/tracking/Cronometro";
import { interioresAdentro } from "@/app/actions/lpr-interiores";
import type { ChapaAdentro } from "@/lib/lpr-interiores";
import { rolEtiqueta } from "@/lib/roles-etiquetas";

/**
 * La columna del centro del monitor LPR: las interiores (26/11). Nico: «una tercera columna en el
 * centro, destinada a las LPR interiores, que se pueda ocultar; que contabilice el tiempo de cada
 * matrícula que ve y está dentro; tipo bento, sólo matrículas, con estilo premium».
 *
 * Arriba los cuadros de las cámaras interiores; abajo, las chapas que están adentro, cada una con su
 * reloj. La más reciente va grande (la que el guardia acaba de ver pasar por adentro); el resto en
 * mosaico. El reloj corre desde la entrada si se la registró, o desde que una interior la vio —y lo
 * dice—, porque no es lo mismo «adentro hace 2 h» que «la vemos hace 2 h».
 *
 * Se pide cada REFRESCO_MS y no por socket: las interiores leen por OmniVision (la pasarela) y no
 * todas sus lecturas llegan como evento al monitor.
 */
const REFRESCO_MS = 15_000;

export function ColumnaInteriores({ tiles, camaras, alOcultar, alInvestigar }: {
    tiles: React.ReactNode;
    camaras: number;
    alOcultar: () => void;
    alInvestigar?: (plate: string) => void;
}) {
    const [chapas, setChapas] = useState<ChapaAdentro[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const traer = useCallback(() => {
        interioresAdentro().then((r) => { if (r.ok) { setChapas(r.chapas); setError(null); } else setError(r.error || "No se pudo leer."); }).catch(() => setError("No se pudo leer."));
    }, []);
    useEffect(() => { const t = setTimeout(traer, 0); const iv = setInterval(traer, REFRESCO_MS); return () => { clearTimeout(t); clearInterval(iv); }; }, [traer]);

    const [hero, ...resto] = chapas || [];
    return (
        <section className="flex flex-col min-h-0 overflow-hidden bg-[color-mix(in_oklab,var(--color-violet-500,#8b5cf6)_3%,transparent)]">
            <div className="shrink-0 flex items-center gap-2.5 px-4 h-11 border-b border-border">
                <span className="w-7 h-7 rounded-md grid place-items-center border border-border bg-muted text-violet-500"><Waypoints size={15} /></span>
                <h2 className="text-[14px] font-bold">Interiores</h2>
                <span className="text-[11.5px] text-muted-foreground tabular-nums">{camaras} cámara{camaras === 1 ? "" : "s"}</span>
                <span className="ml-auto text-[11.5px] text-muted-foreground tabular-nums"><b className="text-foreground">{chapas?.length ?? "—"}</b> adentro</span>
                <button type="button" onClick={alOcultar} title="Ocultar la columna de interiores" aria-label="Ocultar la columna de interiores"
                    className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"><EyeOff size={14} /></button>
            </div>

            <div className="shrink-0 p-3 border-b border-border">
                <div className={cn("grid gap-2", camaras > 1 ? "grid-cols-2" : "grid-cols-1")}>{tiles}</div>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-3">
                <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground"><Eye size={12} /> Adentro ahora · vistas por las interiores</p>
                {error && <p className="rounded-[10px] border border-dashed border-border p-4 text-center text-[12px] tono-mal">{error}</p>}
                {!error && chapas && chapas.length === 0 && (
                    <div className="rounded-[14px] border border-dashed border-border p-6 text-center">
                        <Waypoints size={20} className="mx-auto mb-2 text-violet-500/60" />
                        <p className="text-[12.5px] text-muted-foreground">Las interiores no vieron matrículas en las últimas 12 horas.</p>
                    </div>
                )}
                {!chapas && !error && <div className="grid grid-cols-2 gap-2">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-24 rounded-[14px] bg-muted animate-pulse" />)}</div>}
                {hero && (
                    <div className="grid grid-cols-2 gap-2">
                        <AnimatePresence initial={false}>
                            <Tarjeta key={hero.plate} c={hero} grande alInvestigar={alInvestigar} />
                            {resto.map((c) => <Tarjeta key={c.plate} c={c} alInvestigar={alInvestigar} />)}
                        </AnimatePresence>
                    </div>
                )}
            </div>
        </section>
    );
}

function Tarjeta({ c, grande, alInvestigar }: { c: ChapaAdentro; grande?: boolean; alInvestigar?: (plate: string) => void }) {
    const visto = Math.max(0, Math.round((useTranscurrido(c.ultima) || 0) / 60000));
    const borde = c.lista === "negra" ? "border-red-500/60 shadow-[0_0_0_1px_rgba(239,68,68,0.35)]" : c.lista === "amarilla" ? "border-yellow-400/60" : "border-border";
    return (
        <motion.button type="button" layout initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.96 }} transition={{ type: "spring", bounce: 0, duration: 0.35 }}
            onClick={() => alInvestigar?.(c.plate)} title={`Investigar ${c.plate}`}
            className={cn("group relative overflow-hidden rounded-[14px] border bg-card text-left transition-colors hover:border-violet-400/60", borde, grande ? "col-span-2 p-3.5" : "p-2.5")}>
            {grande && c.foto && (
                // La escena de la última vez que la vieron, muy atenuada: contexto, no protagonista.
                // eslint-disable-next-line @next/next/no-img-element
                <img src={c.foto} alt="" className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-[0.13] group-hover:opacity-20" />
            )}
            <div className="relative">
                {/* La chapa a todo el ancho y sin cortarse: «AAC 6351» partida en dos renglones no se lee. */}
                <ChapaMercosur plate={c.plate} tamano={grande ? "normal" : "chico"} conocida={grande && c.quien ? true : undefined} className="w-full [&_.chapa-texto]:whitespace-nowrap" />
                {c.lista && <span className={cn("mt-1.5 inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9.5px] font-bold uppercase", c.lista === "negra" ? "bg-red-500/15 text-red-500" : "bg-yellow-400/20 text-yellow-600")}><ShieldAlert size={10} />Lista {c.lista}</span>}
                <p className={cn("mt-1.5 truncate font-semibold", grande ? "text-[13.5px]" : "text-[11.5px]")}>
                    {c.quien ? <>{c.quien.vip && <Crown size={11} className="mr-1 inline text-amber-500" />}{c.quien.nombre}<span className="font-normal text-muted-foreground"> · {rolEtiqueta(c.quien.rol)}{c.quien.lote ? ` · ${c.quien.lote}` : ""}</span></> : <span className="text-muted-foreground">No está en el padrón</span>}
                </p>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <Cronometro desde={c.desde} tamano={grande ? "normal" : "chico"} etiqueta={c.desdeEs === "entrada" ? "adentro" : "visto hace"} />
                    <span className={cn("text-muted-foreground tabular-nums", grande ? "text-[11.5px]" : "text-[10px]")}>
                        {c.camara ? `${c.camara} · ` : ""}{visto < 1 ? "recién" : `hace ${visto < 60 ? `${visto} min` : `${Math.floor(visto / 60)} h`}`}{c.veces > 1 ? ` · ${c.veces} veces` : ""}
                    </span>
                </div>
                {grande && c.desdeEs === "vista" && <p className="mt-1 text-[10.5px] text-muted-foreground">Sin entrada registrada: el reloj corre desde que una interior la vio.</p>}
            </div>
        </motion.button>
    );
}
