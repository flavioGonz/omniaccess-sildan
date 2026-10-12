"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Camera, ChevronDown, Globe, Lightbulb } from "lucide-react";
import { cn } from "@/lib/utils";
import { CURVA_SUAVE } from "@/components/ui/entrada";

/**
 * ¿Fotos de las cámaras donde va a correr, o fotos subidas? La pregunta que más decide si el
 * modelo sirve en el barrio, y que la pantalla no contestaba: «También sirven fotos de internet»
 * era cierto a medias. Sirven para variedad; no reemplazan a las del lugar.
 *
 * La razón, en una línea: el modelo aprende la imagen, no la idea. Si el examen y el uso se
 * parecen a lo que vio al aprender, el número del examen predice lo que va a pasar en la cámara.
 *
 * Abajo, la mezcla real del conjunto (por origen de la foto), contra la recomendación.
 */

/** Fracción de fotos de las cámaras finales con la que el examen ya predice bien el uso real. */
export const FRACCION_CAMARAS = 0.7;

const GANA_CAMARA = [
    ["El mismo ángulo y la misma distancia", "El objeto aparece del tamaño en píxeles que va a tener de verdad: chico, lejos, en diagonal."],
    ["La noche infrarroja", "De noche la cámara ve en blanco y negro y con reflejos. Un modelo que nunca vio eso de noche no encuentra nada."],
    ["La compresión y el lente", "H.265, el ojo de pez de las esquinas, el ruido. Para el modelo eso también es «cómo se ve un tacho»."],
    ["El fondo del lugar", "Las fotos sin el objeto, de esa cámara, le enseñan qué NO marcar ahí: el cartel, el cono, la sombra del portón."],
    ["Un examen que no miente", "Si se examina con fotos de la cámara, el «acierta 85 %» es lo que vas a ver en esa cámara."],
];
const GANA_SUBIDA = [
    ["Variedad", "Modelos, colores y formas que todavía no pasaron por tus cámaras."],
    ["Arrancar antes", "Cuando el objeto aparece poco (una volqueta una vez por mes), sirven para no esperar meses."],
    ["Cámaras que vendrán", "Si después se suma otra cámara con otro ángulo, ayuda a que no dependa de una sola vista."],
];

export function CamarasOSubidas({ porOrigen }: { porOrigen?: Record<string, number> }) {
    const [abierto, setAbierto] = useState(false);
    const camaras = (porOrigen?.CAMARA || 0) + (porOrigen?.REGISTRO || 0);
    const subidas = porOrigen?.SUBIDA || 0;
    const total = camaras + subidas;
    const frac = total ? camaras / total : 0;
    const bien = total > 0 && frac >= FRACCION_CAMARAS;

    return (
        <section className="rounded-[10px] border border-border bg-card">
            <button type="button" onClick={() => setAbierto((x) => !x)} aria-expanded={abierto}
                className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-accent/40 rounded-[10px] transition-colors">
                <span className="grid h-8 w-8 place-items-center rounded-[8px] bg-muted shrink-0"><Lightbulb size={15} /></span>
                <span className="min-w-0 flex-1">
                    <span className="block text-[13.5px] font-bold">¿Fotos de las cámaras o subidas?</span>
                    <span className="block text-[12px] text-muted-foreground leading-snug">
                        Conviene que {Math.round(FRACCION_CAMARAS * 100)} de cada 100 sean de las cámaras donde va a correr, de día y de noche. Las subidas suman variedad.
                    </span>
                </span>
                {total > 0 && (
                    <span className="hidden sm:flex items-center gap-2 shrink-0">
                        <span className="relative h-2 w-28 rounded-full bg-muted overflow-hidden" aria-hidden>
                            <span className={cn("absolute inset-y-0 left-0 rounded-full", bien ? "bg-[var(--bien)]" : "bg-[var(--aviso)]")} style={{ width: `${frac * 100}%` }} />
                            <span className="absolute inset-y-0 w-0.5 bg-foreground/50" style={{ left: `${FRACCION_CAMARAS * 100}%` }} />
                        </span>
                        <span className={cn("text-[12px] font-semibold tabular-nums", bien ? "tono-bien" : "tono-aviso")}>{Math.round(frac * 100)} % de cámaras</span>
                    </span>
                )}
                <ChevronDown size={16} className={cn("text-muted-foreground transition-transform shrink-0", abierto && "rotate-180")} />
            </button>
            <AnimatePresence initial={false}>
                {abierto && (
                    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.26, ease: CURVA_SUAVE }} className="overflow-hidden">
                        <div className="px-4 pb-4 pt-1 space-y-3">
                            <p className="text-[12.5px] leading-relaxed max-w-[900px]">
                                El modelo aprende <b>la imagen, no la idea</b> de «tacho de basura». Si aprende con fotos de catálogo — de día, de cerca, centradas — lo va a encontrar en fotos de catálogo,
                                y en tu cámara de noche a 30 metros no. Entrenar con <b>las cámaras finales</b> es enseñarle exactamente la situación en la que va a trabajar.
                            </p>
                            <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] gap-3">
                                <div className="rounded-[10px] bg-muted/50 p-3 space-y-2">
                                    <div className="text-[13px] font-bold inline-flex items-center gap-1.5"><Camera size={14} /> Lo que se gana con las cámaras donde va a correr</div>
                                    <ul className="space-y-1.5">
                                        {GANA_CAMARA.map(([t, d]) => <li key={t} className="text-[12px] leading-snug"><b>{t}.</b> <span className="text-muted-foreground">{d}</span></li>)}
                                    </ul>
                                </div>
                                <div className="rounded-[10px] bg-muted/50 p-3 space-y-2">
                                    <div className="text-[13px] font-bold inline-flex items-center gap-1.5"><Globe size={14} /> Para qué sirven las subidas</div>
                                    <ul className="space-y-1.5">
                                        {GANA_SUBIDA.map(([t, d]) => <li key={t} className="text-[12px] leading-snug"><b>{t}.</b> <span className="text-muted-foreground">{d}</span></li>)}
                                    </ul>
                                    <p className="text-[12px] leading-snug tono-aviso">Solas engañan: aprende «foto de catálogo» y el examen da alto porque se examina con más fotos de catálogo.</p>
                                </div>
                            </div>
                            <div className="text-[12px] leading-snug text-muted-foreground">
                                <b className="text-foreground">Regla práctica:</b> si va a correr en una cámara fija, casi todo de esa cámara (mañana, tarde, noche, lluvia) y un puñado de subidas para variedad.
                                Si va a correr en muchas cámaras distintas, fotos de varias de ellas. Y siempre fotos del lugar <b>sin</b> el objeto, marcadas «No hay ninguno».
                                {total > 0 && <> Hoy: <b className="text-foreground tabular-nums">{camaras}</b> de cámaras y <b className="text-foreground tabular-nums">{subidas}</b> subidas.</>}
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </section>
    );
}
