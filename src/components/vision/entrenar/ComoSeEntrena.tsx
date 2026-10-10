"use client";

import { motion } from "motion/react";
import { Camera, CircleCheck, GraduationCap, Lightbulb, MessageSquareText, Moon, SkipForward, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { MuestraVista } from "@/components/vision/entrenar/Piezas";
import type { Analisis } from "@/lib/vision-capa";
import { MIN_POR_CLASE, RECOMENDADO_POR_CLASE } from "@/lib/zona-entrenable";

/**
 * Cómo se entrena, contado con los nombres de ESTA analítica y, si ya hay, con sus propios
 * ejemplos: «Desbordado» y «Normal» con fotos de este contenedor se entienden mejor que un
 * diagrama genérico.
 *
 * La trampa que hay que contar sí o sí: el estado que avisa casi nunca pasa (por eso avisa), y
 * sin ejemplos de él no se puede entrenar. Se provoca: se saca el cono, se deja una bolsa, y se
 * toca «Mirar ahora» varias veces.
 */
type Ejemplo = { id: string; url: string; analisis?: Analisis | null };

const paso = { initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 } };

export function ComoSeEntrena({ positivo, negativo, frasesPositivo, frasesNegativo, ejemplosPos, ejemplosNeg, conteo }: {
    positivo: string; negativo: string; frasesPositivo: string[]; frasesNegativo: string[];
    ejemplosPos: Ejemplo[]; ejemplosNeg: Ejemplo[]; conteo: { pos: number; neg: number };
}) {
    const sinRaro = conteo.pos < MIN_POR_CLASE;
    return (
        <div className="space-y-3">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                <motion.div {...paso} transition={{ delay: 0 }} className="rounded-[10px] border border-border bg-card p-4 space-y-2">
                    <Paso n={1} icono={MessageSquareText} titulo="Describila con palabras" />
                    <p className="text-[12.5px] text-muted-foreground">Mientras no haya ejemplos, decide comparando lo que ve con estas frases. Ya funciona desde el primer minuto, aunque no conoce tu lugar.</p>
                    <Frase tono="aviso" estado={positivo} frase={frasesPositivo[0]} />
                    <Frase tono="bien" estado={negativo} frase={frasesNegativo[0]} />
                </motion.div>

                <motion.div {...paso} transition={{ delay: 0.08 }} className="rounded-[10px] border border-border bg-card p-4 space-y-2">
                    <Paso n={2} icono={GraduationCap} titulo="Enseñale con ejemplos" />
                    <p className="text-[12.5px] text-muted-foreground">Cada pocos minutos toma una foto de la zona. Vos decís qué es cada una. Así aprende <b className="text-foreground">este</b> lugar, con su luz y su ángulo.</p>
                    <div className="grid grid-cols-2 gap-2">
                        <Muestrario titulo={positivo} tono="aviso" ejemplos={ejemplosPos} />
                        <Muestrario titulo={negativo} tono="bien" ejemplos={ejemplosNeg} />
                    </div>
                </motion.div>

                <motion.div {...paso} transition={{ delay: 0.16 }} className="rounded-[10px] border border-border bg-card p-4 space-y-2">
                    <Paso n={3} icono={CircleCheck} titulo="Entrená y fijate el acierto" />
                    <p className="text-[12.5px] text-muted-foreground">Con {MIN_POR_CLASE} de cada uno ya se puede; con {RECOMENDADO_POR_CLASE} suele estabilizarse. El acierto se mide con ejemplos que <b className="text-foreground">no vio</b>: es lo que va a pasar en la cámara.</p>
                    <ul className="text-[12.5px] space-y-1.5">
                        <li className="flex gap-2"><span className="tabular-nums font-bold w-12 shrink-0">90 %+</span><span className="text-muted-foreground">lista: probala unos días sin avisar y después prendé el aviso.</span></li>
                        <li className="flex gap-2"><span className="tabular-nums font-bold w-12 shrink-0">70-90</span><span className="text-muted-foreground">le faltan ejemplos: sumá, sobre todo de los que confunde.</span></li>
                        <li className="flex gap-2"><span className="tabular-nums font-bold w-12 shrink-0">−70</span><span className="text-muted-foreground">la zona no muestra la diferencia: ajustala más cerca de lo que importa.</span></li>
                    </ul>
                </motion.div>
            </div>

            <motion.div {...paso} transition={{ delay: 0.24 }} className={cn("rounded-[10px] border p-4 grid grid-cols-1 md:grid-cols-3 gap-4", sinRaro ? "border-[var(--aviso)] bg-[var(--aviso-suave)]" : "border-border bg-card")}>
                <Consejo icono={Lightbulb} titulo={`¿«${positivo}» casi no pasa? Provocalo`}>
                    Sin ejemplos de lo raro no aprende. Armalo a propósito (sacá el cono, dejá una bolsa al lado del contenedor), tocá <b>Mirar ahora</b> tres o cuatro veces, volvé todo a como estaba y repetí en otro momento del día.
                </Consejo>
                <Consejo icono={Moon} titulo="Día, noche y lluvia">
                    De noche la cámara pasa a infrarrojo y se ve en blanco y negro. Si va a mirar de noche, necesita ejemplos de noche; si no, poné horario de día.
                </Consejo>
                <Consejo icono={SkipForward} titulo="Ante la duda, saltear">
                    Una foto borrosa, tapada por un auto o a medio camino entre los dos estados enseña mal. Saltearla no cuesta nada.
                </Consejo>
            </motion.div>
        </div>
    );
}

function Paso({ n, icono: I, titulo }: { n: number; icono: typeof Camera; titulo: string }) {
    return (
        <div className="flex items-center gap-2">
            <span className="grid h-7 w-7 place-items-center rounded-full bg-[var(--accion)] text-white text-[12px] font-bold tabular-nums">{n}</span>
            <I size={15} className="text-muted-foreground" />
            <h3 className="text-[13.5px] font-bold">{titulo}</h3>
        </div>
    );
}

function Frase({ tono, estado, frase }: { tono: "aviso" | "bien"; estado: string; frase?: string }) {
    const I = tono === "aviso" ? TriangleAlert : CircleCheck;
    return (
        <div className={cn("rounded-md px-2.5 py-1.5 text-[12px]", tono === "aviso" ? "bg-[var(--aviso-suave)]" : "bg-[var(--bien-suave)]")}>
            <div className={cn("flex items-center gap-1 font-bold", tono === "aviso" ? "tono-aviso" : "tono-bien")}><I size={12} /> {estado}</div>
            <div className="text-muted-foreground italic">«{frase || "…"}»</div>
        </div>
    );
}

function Muestrario({ titulo, tono, ejemplos }: { titulo: string; tono: "aviso" | "bien"; ejemplos: Ejemplo[] }) {
    const I = tono === "aviso" ? TriangleAlert : CircleCheck;
    return (
        <div className="space-y-1">
            <div className={cn("flex items-center gap-1 text-[11.5px] font-bold truncate", tono === "aviso" ? "tono-aviso" : "tono-bien")}><I size={12} /> <span className="truncate">{titulo}</span></div>
            {ejemplos.length ? (
                <div className="grid grid-cols-2 gap-1">
                    {ejemplos.slice(0, 2).map((e) => <MuestraVista key={e.id} url={e.url} analisis={e.analisis} ancho={320} etiquetas={false} ajuste="cover"
                        className={cn("aspect-[4/3] rounded-md border-2", tono === "aviso" ? "border-[var(--aviso)]" : "border-[var(--bien)]")} />)}
                </div>
            ) : <div className="aspect-[8/3] rounded-md border border-dashed border-border grid place-items-center text-[11px] text-muted-foreground px-2 text-center">todavía no hay</div>}
        </div>
    );
}

function Consejo({ icono: I, titulo, children }: { icono: typeof Camera; titulo: string; children: React.ReactNode }) {
    return (
        <div className="flex gap-2.5">
            <I size={18} className="shrink-0 mt-0.5" />
            <div><div className="text-[13px] font-bold">{titulo}</div><p className="text-[12px] text-muted-foreground leading-snug mt-0.5">{children}</p></div>
        </div>
    );
}
