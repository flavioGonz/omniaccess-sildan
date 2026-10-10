"use client";

import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { CircleCheck, GraduationCap, Loader2, SkipForward, TriangleAlert, Undo2 } from "lucide-react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { MuestraVista } from "@/components/vision/entrenar/Piezas";
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
    useEffect(() => { if (abierto) { setI(0); setHechas([]); } }, [abierto]);
    const m = cola[i];
    const cuenta = { pos: hechas.filter((h) => h.e === "pos").length, neg: hechas.filter((h) => h.e === "neg").length };

    const marcar = useCallback(async (e: "pos" | "neg" | null) => {
        if (!m || ocupado) return;
        setSalida(e ?? "saltar");
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

    const vuela = { pos: { x: -420, rotate: -8 }, neg: { x: 420, rotate: 8 }, saltar: { y: -60 } };

    return (
        <Dialog open={abierto} onOpenChange={(o) => { if (!o) alCerrar(); }}>
            <DialogContent className="sm:max-w-5xl p-0 gap-0 overflow-hidden">
                <div className="px-5 pt-4 pb-3 border-b border-border flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                        <DialogTitle className="text-[16px] font-bold">Enseñale con ejemplos</DialogTitle>
                        <DialogDescription className="text-[12px] text-muted-foreground">¿Qué se ve en la zona? Si no se distingue bien, salteala: una etiqueta dudosa enseña mal.</DialogDescription>
                    </div>
                    <div className="text-[12px] tabular-nums text-muted-foreground text-right">
                        <div><b className="text-foreground">{Math.min(i + 1, cola.length)}</b> de {cola.length}</div>
                        <div>{cuenta.pos} «{positivo}» · {cuenta.neg} «{negativo}»</div>
                    </div>
                </div>
                <div className="h-1 bg-muted"><motion.div className="h-full bg-[var(--accion)]" animate={{ width: `${cola.length ? (i / cola.length) * 100 : 0}%` }} transition={{ duration: 0.35 }} /></div>

                <div className="relative bg-black aspect-[16/9] max-h-[58vh] w-full overflow-hidden">
                    <AnimatePresence mode="popLayout" initial={false}>
                        {m ? (
                            <motion.div key={m.id} className="absolute inset-0"
                                initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1, x: 0, y: 0, rotate: 0 }}
                                exit={{ opacity: 0, ...vuela[salida] }} transition={{ type: "spring", stiffness: 260, damping: 26 }}>
                                <MuestraVista url={m.url} analisis={m.analisis} ancho={960} className="absolute inset-0" />
                                <div className="absolute left-3 bottom-3 text-[11.5px] text-white/80 tabular-nums bg-black/40 rounded px-2 py-0.5">
                                    {new Date(m.ts).toLocaleString("es-UY", { weekday: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false })}
                                    {m.prob != null && <> · hoy diría <b className="text-white">{m.prob >= umbral ? positivo : negativo}</b> ({Math.round((m.prob >= 0.5 ? m.prob : 1 - m.prob) * 100)} %)</>}
                                </div>
                            </motion.div>
                        ) : (
                            <motion.div key="fin" className="absolute inset-0 grid place-items-center text-center text-white p-6" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                                <div className="space-y-3">
                                    <GraduationCap size={40} className="mx-auto opacity-80" />
                                    <div className="text-[18px] font-bold">{hechas.filter((h) => h.e).length ? `Listo: ${hechas.filter((h) => h.e).length} ejemplos nuevos` : "No quedan muestras para etiquetar"}</div>
                                    <div className="text-[13px] text-white/70">{puedeEntrenar ? "Entrenala para que use lo que le enseñaste." : "Todavía faltan ejemplos de alguno de los dos estados para entrenar."}</div>
                                    {puedeEntrenar && <Button onClick={() => { alCerrar(); alEntrenar(); }}><GraduationCap size={15} /> Entrenar ahora</Button>}
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>

                <div className="p-4 grid grid-cols-[1fr_auto_1fr] gap-3 items-stretch">
                    <button type="button" disabled={!m || ocupado} onClick={() => marcar("pos")}
                        className="group rounded-[10px] border-2 border-[var(--aviso)] bg-[var(--aviso-suave)] px-4 py-3 text-left disabled:opacity-40 hover:brightness-110 transition">
                        <div className="flex items-center gap-2 text-[15px] font-bold"><TriangleAlert size={18} /> <span className="truncate">{positivo}</span></div>
                        <div className="text-[11px] text-muted-foreground mt-0.5">tecla 1 o ←</div>
                    </button>
                    <div className="flex flex-col gap-2 justify-center">
                        <Button variant="outline" onClick={() => marcar(null)} disabled={!m || ocupado}>{ocupado ? <Loader2 size={15} className="animate-spin" /> : <SkipForward size={15} />} Saltar</Button>
                        <Button variant="ghost" onClick={deshacer} disabled={!hechas.length || ocupado}><Undo2 size={15} /> Deshacer</Button>
                    </div>
                    <button type="button" disabled={!m || ocupado} onClick={() => marcar("neg")}
                        className="group rounded-[10px] border-2 border-[var(--bien)] bg-[var(--bien-suave)] px-4 py-3 text-right disabled:opacity-40 hover:brightness-110 transition">
                        <div className="flex items-center justify-end gap-2 text-[15px] font-bold"><span className="truncate">{negativo}</span> <CircleCheck size={18} /></div>
                        <div className="text-[11px] text-muted-foreground mt-0.5">tecla 2 o →</div>
                    </button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
