"use client";

import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { CircleCheck, GraduationCap, Loader2, SkipForward, TriangleAlert, Undo2, X } from "lucide-react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { MuestraVista } from "@/components/vision/entrenar/Piezas";
import { cn } from "@/lib/utils";
import type { Analisis } from "@/lib/vision-capa";

/**
 * Etiquetado rápido: una muestra por vez, grande, con lo que omni-vision ve dibujado, y dos
 * botones con el nombre de cada estado. Con el teclado: 1 o ← para el que avisa, 2 o → para el
 * normal, espacio para saltar, Z para deshacer. Es la forma en que se etiquetan cincuenta en dos
 * minutos sin errores: la grilla sirve para revisar, no para enseñar.
 *
 * Arranca por las «dudosas» (las que el modelo menos sabe decidir): cada una de ésas enseña más
 * que diez que ya acierta.
 */
export type MuestraRapida = { id: string; url: string; prob: number | null; analisis?: Analisis | null; ts: string };

export function EtiquetadoRapido({ abierto, alCerrar, cola, positivo, negativo, umbral, alEtiquetar, alEntrenar, puedeEntrenar }: {
    abierto: boolean; alCerrar: () => void; cola: MuestraRapida[];
    positivo: string; negativo: string; umbral: number;
    /** `antes`: la etiqueta que tenía (para que los conteos resten de donde corresponde al deshacer). */
    alEtiquetar: (id: string, e: "pos" | "neg" | null, antes: "pos" | "neg" | null) => Promise<boolean>;
    alEntrenar: () => void; puedeEntrenar: boolean;
}) {
    const [i, setI] = useState(0);
    const [hechas, setHechas] = useState<{ id: string; e: "pos" | "neg" | null }[]>([]);
    const [salida, setSalida] = useState<"pos" | "neg" | "saltar">("saltar");
    const [ocupado, setOcupado] = useState(false);
    /** El destello del color del estado elegido sobre la foto: confirma la etiqueta sin leer nada. */
    const [destello, setDestello] = useState<{ e: "pos" | "neg"; n: number } | null>(null);
    useEffect(() => { if (abierto) { setI(0); setHechas([]); } }, [abierto]);
    const m = cola[i];
    const cuenta = { pos: hechas.filter((h) => h.e === "pos").length, neg: hechas.filter((h) => h.e === "neg").length };

    const marcar = useCallback(async (e: "pos" | "neg" | null) => {
        if (!m || ocupado) return;
        setSalida(e ?? "saltar");
        if (e) setDestello({ e, n: Date.now() });
        if (e) {
            setOcupado(true);
            const ok = await alEtiquetar(m.id, e, null);
            setOcupado(false);
            if (!ok) return;
        }
        setHechas((h) => [...h, { id: m.id, e }]);
        setI((x) => x + 1);
    }, [m, ocupado, alEtiquetar]);

    const deshacer = useCallback(async () => {
        const ult = hechas[hechas.length - 1];
        if (!ult || ocupado) return;
        if (ult.e) { setOcupado(true); const ok = await alEtiquetar(ult.id, null, ult.e); setOcupado(false); if (!ok) return; }
        setHechas((h) => h.slice(0, -1));
        setI((x) => Math.max(0, x - 1));
    }, [hechas, ocupado, alEtiquetar]);

    useEffect(() => {
        if (!abierto) return;
        const tecla = (ev: KeyboardEvent) => {
            if (ev.target instanceof HTMLInputElement || ev.target instanceof HTMLTextAreaElement) return;
            if (ev.key === "1" || ev.key === "ArrowLeft") { ev.preventDefault(); marcar("pos"); }
            else if (ev.key === "2" || ev.key === "ArrowRight") { ev.preventDefault(); marcar("neg"); }
            else if (ev.key === " ") { ev.preventDefault(); marcar(null); }
            else if (ev.key.toLowerCase() === "z") { ev.preventDefault(); deshacer(); }
        };
        window.addEventListener("keydown", tecla);
        return () => window.removeEventListener("keydown", tecla);
    }, [abierto, marcar, deshacer]);

    const vuela = { pos: { x: -140, opacity: 0, filter: "blur(6px)" }, neg: { x: 140, opacity: 0, filter: "blur(6px)" }, saltar: { y: -40, opacity: 0, filter: "blur(6px)" } };
    // Vidrio sobre la foto: se lee sobre cielo, pasto o noche, sin tapar más de lo necesario.
    const vidrio = "bg-black/45 backdrop-blur-md border border-white/15 text-white";
    const total = cola.length;

    /*
     * Ventana sin bordes: la foto es la ventana. Todo lo demás (título, avance, botones) flota
     * encima en vidrio, con un degradé arriba y abajo para que se lea. Es lo que pidió Nico (10/10):
     * «sin bordes, estilizada, botones overlay, ligeras animaciones de entrada y salida, premium».
     */
    return (
        <Dialog open={abierto} onOpenChange={(o) => { if (!o) alCerrar(); }}>
            <DialogContent showCloseButton={false} className="sm:max-w-6xl w-[calc(100%-2rem)] p-0 gap-0 border-0 bg-transparent shadow-none overflow-visible">
                <motion.div initial={{ opacity: 0, scale: 0.97, y: 12 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={{ type: "spring", stiffness: 240, damping: 24 }}
                    className="relative rounded-[14px] overflow-hidden bg-black shadow-[0_24px_80px_-12px_rgba(0,0,0,0.75)] aspect-[16/9] max-h-[86vh]">

                    {/* La muestra */}
                    <AnimatePresence mode="popLayout" initial={false}>
                        {m ? (
                            <motion.div key={m.id} className="absolute inset-0"
                                initial={{ opacity: 0, scale: 1.03, filter: "blur(4px)" }} animate={{ opacity: 1, scale: 1, x: 0, y: 0, filter: "blur(0px)" }}
                                exit={vuela[salida]} transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}>
                                <MuestraVista url={m.url} analisis={m.analisis} ancho={960} className="absolute inset-0" />
                            </motion.div>
                        ) : (
                            <motion.div key="fin" className="absolute inset-0 grid place-items-center text-center text-white p-6 bg-[radial-gradient(ellipse_at_center,rgba(255,255,255,0.06),transparent_70%)]"
                                initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }}>
                                <div className="space-y-3">
                                    <motion.div initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 260, damping: 16, delay: 0.1 }}>
                                        <GraduationCap size={44} className="mx-auto opacity-90" />
                                    </motion.div>
                                    <div className="text-[20px] font-bold">{hechas.filter((h) => h.e).length ? `Listo: ${hechas.filter((h) => h.e).length} ejemplos nuevos` : "No quedan muestras para etiquetar"}</div>
                                    <div className="text-[13px] text-white/70">{puedeEntrenar ? "Entrenala para que use lo que le enseñaste." : "Todavía faltan ejemplos de alguno de los dos estados para entrenar."}</div>
                                    {puedeEntrenar && <Button onClick={() => { alCerrar(); alEntrenar(); }}><GraduationCap size={15} /> Entrenar ahora</Button>}
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>

                    {/* Destello del estado elegido */}
                    <AnimatePresence>
                        {destello && (
                            <motion.div key={destello.n} className="absolute inset-0 pointer-events-none grid place-items-center"
                                initial={{ opacity: 0 }} animate={{ opacity: [0, 1, 0] }} transition={{ duration: 0.55, times: [0, 0.25, 1] }} onAnimationComplete={() => setDestello(null)}
                                style={{ background: `radial-gradient(ellipse at ${destello.e === "pos" ? "20%" : "80%"} 85%, color-mix(in oklab, var(--${destello.e === "pos" ? "aviso" : "bien"}) 45%, transparent), transparent 60%)` }}>
                                <motion.span initial={{ scale: 0.5 }} animate={{ scale: [0.5, 1.15, 1] }} transition={{ duration: 0.4 }}
                                    className={cn("grid h-16 w-16 place-items-center rounded-full", vidrio)}>
                                    {destello.e === "pos" ? <TriangleAlert size={28} style={{ color: "var(--aviso)" }} /> : <CircleCheck size={28} style={{ color: "var(--bien)" }} />}
                                </motion.span>
                            </motion.div>
                        )}
                    </AnimatePresence>

                    {/* Arriba: título, avance, cerrar */}
                    <div className="absolute inset-x-0 top-0 px-5 pt-4 pb-10 bg-gradient-to-b from-black/75 via-black/35 to-transparent pointer-events-none">
                        <div className="flex items-start gap-3">
                            <div className="min-w-0 flex-1 text-white">
                                <DialogTitle className="text-[15px] font-bold leading-tight">Enseñale con ejemplos</DialogTitle>
                                <DialogDescription className="text-[12px] text-white/70">¿Qué se ve en la zona? Si no se distingue bien, salteala.</DialogDescription>
                            </div>
                            <div className="text-right text-white tabular-nums">
                                <div className="text-[15px] font-bold">{Math.min(i + 1, total)}<span className="text-white/60 font-semibold"> / {total}</span></div>
                                <div className="text-[11px] text-white/70">{cuenta.pos} «{positivo}» · {cuenta.neg} «{negativo}»</div>
                            </div>
                            <button type="button" onClick={alCerrar} aria-label="Cerrar" className={cn("pointer-events-auto grid h-9 w-9 place-items-center rounded-full hover:bg-black/60 transition", vidrio)}><X size={16} /></button>
                        </div>
                        <div className="mt-3 h-1 rounded-full bg-white/15 overflow-hidden">
                            <motion.div className="h-full rounded-full bg-[var(--accion-en-oscuro)]" animate={{ width: `${total ? (i / total) * 100 : 0}%` }} transition={{ duration: 0.35 }} />
                        </div>
                    </div>

                    {/* Abajo: lo que diría hoy, y los botones */}
                    {m && (
                        <div className="absolute inset-x-0 bottom-0 px-4 pb-4 pt-16 bg-gradient-to-t from-black/80 via-black/40 to-transparent">
                            <div className="text-center text-[11.5px] text-white/75 tabular-nums mb-3">
                                {new Date(m.ts).toLocaleString("es-UY", { weekday: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false })}
                                {m.prob != null && <> · hoy diría <b className="text-white">{m.prob >= umbral ? positivo : negativo}</b> ({Math.round((m.prob >= 0.5 ? m.prob : 1 - m.prob) * 100)} %)</>}
                            </div>
                            <div className="grid grid-cols-[1fr_auto_1fr] gap-3 items-end">
                                <motion.button type="button" disabled={ocupado} onClick={() => marcar("pos")} whileHover={{ y: -2 }} whileTap={{ scale: 0.97 }}
                                    className={cn("rounded-[12px] px-4 py-3 text-left disabled:opacity-50 transition-colors hover:bg-black/60", vidrio)}
                                    style={{ boxShadow: "inset 3px 0 0 var(--aviso)" }}>
                                    <span className="flex items-center gap-2 text-[15px] font-bold"><TriangleAlert size={18} style={{ color: "var(--aviso)" }} /> <span className="truncate">{positivo}</span></span>
                                    <span className="block text-[10.5px] text-white/55 mt-0.5">1 o ←</span>
                                </motion.button>
                                <div className="flex items-center gap-2 pb-1">
                                    <motion.button type="button" whileTap={{ scale: 0.92 }} onClick={deshacer} disabled={!hechas.length || ocupado} title="Deshacer (Z)" aria-label="Deshacer"
                                        className={cn("grid h-11 w-11 place-items-center rounded-full disabled:opacity-35 hover:bg-black/60", vidrio)}><Undo2 size={17} /></motion.button>
                                    <motion.button type="button" whileTap={{ scale: 0.92 }} onClick={() => marcar(null)} disabled={ocupado} title="Saltar (espacio)" aria-label="Saltar"
                                        className={cn("grid h-11 w-11 place-items-center rounded-full disabled:opacity-35 hover:bg-black/60", vidrio)}>{ocupado ? <Loader2 size={17} className="animate-spin" /> : <SkipForward size={17} />}</motion.button>
                                </div>
                                <motion.button type="button" disabled={ocupado} onClick={() => marcar("neg")} whileHover={{ y: -2 }} whileTap={{ scale: 0.97 }}
                                    className={cn("rounded-[12px] px-4 py-3 text-right disabled:opacity-50 transition-colors hover:bg-black/60", vidrio)}
                                    style={{ boxShadow: "inset -3px 0 0 var(--bien)" }}>
                                    <span className="flex items-center justify-end gap-2 text-[15px] font-bold"><span className="truncate">{negativo}</span> <CircleCheck size={18} style={{ color: "var(--bien)" }} /></span>
                                    <span className="block text-[10.5px] text-white/55 mt-0.5">2 o →</span>
                                </motion.button>
                            </div>
                        </div>
                    )}
                </motion.div>
            </DialogContent>
        </Dialog>
    );
}
