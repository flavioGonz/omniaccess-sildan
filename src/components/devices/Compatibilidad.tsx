"use client";

import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, BadgeCheck, Check, CircleSlash } from "lucide-react";
import { Pista } from "@/components/ui/pista";
import { SOPORTE, QUE_ES, evaluar, type Soporte } from "@/lib/drivers/catalogo";
import { cn } from "@/lib/utils";

/**
 * Elegir el fabricante sabiendo con cuál se puede contar.
 *
 * Antes eran diez opciones de un desplegable, todas iguales. Y no lo son: de los once
 * drivers, siete tienen las funciones vacías —devuelven sin hacer nada, sin lanzar un
 * error. Con esos, cargar un equipo y mandarle una credencial termina en un "salió bien"
 * que no ocurrió, y el problema aparece días después, en la barrera, sin ninguna pista de
 * dónde salió.
 *
 * Por eso cada marca muestra su estado y qué sabe hacer. Las que no están implementadas no
 * se esconden —el equipo se puede cargar igual, para tenerlo inventariado— pero se dice
 * con todas las letras qué va a pasar si se espera que funcione.
 */

const TONO: Record<Soporte["estado"], { chip: string; punto: string; rotulo: string; icono: any }> = {
    andando: { chip: "chip-bien", punto: "bg-[var(--bien)]", rotulo: "Anda", icono: BadgeCheck },
    parcial: { chip: "chip-aviso", punto: "bg-[var(--aviso)]", rotulo: "A medias", icono: AlertTriangle },
    "sin hacer": { chip: "chip-mal", punto: "bg-[var(--mal)]", rotulo: "Sin driver", icono: CircleSlash },
};

export function ElegirMarca({ valor, alElegir }: { valor: string; alElegir: (v: string) => void }) {
    return (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {SOPORTE.map((s) => {
                const puesto = valor === s.marca;
                const t = TONO[s.estado];
                return (
                    <button key={s.marca} type="button" onClick={() => alElegir(s.marca)}
                        className={cn(
                            "text-left p-3 rounded-[10px] border transition-colors",
                            puesto ? "border-[var(--accion)] bg-[color-mix(in_oklab,var(--accion)_8%,transparent)]"
                                : "border-border bg-card/40 hover:bg-accent",
                        )}>
                        <span className="flex items-center gap-2">
                            <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", t.punto)} />
                            <span className="text-[13.5px] font-semibold text-foreground flex-1 truncate">{s.rotulo}</span>
                            <Pista titulo={s.rotulo} texto={s.nota} lado="arriba" ancho={260}>
                                <span className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded border cursor-help", t.chip)}>
                                    {t.rotulo}
                                </span>
                            </Pista>
                        </span>
                        <span className="block text-[11.5px] text-muted-foreground mt-1 leading-snug">
                            {s.hace.length
                                ? s.hace.map((c) => QUE_ES[c].replace(/^(Cargarle|Leerle|Abrirle|Ver su) /, "")).join(" · ")
                                : "Todavía no se le puede mandar nada"}
                        </span>
                    </button>
                );
            })}
        </div>
    );
}

/**
 * El veredicto de esta marca PARA ESTE TIPO de equipo.
 *
 * "La marca está a medias" y "la marca no sirve para lo que vine a hacer" son cosas
 * distintas. Una Bosch anda perfecto contando gente y no sirve para una barrera: decir
 * sólo "parcial" no ayuda a decidir. Lo que hay que contestar es si el equipo que se está
 * por cargar va a hacer aquello para lo que se lo carga.
 */
export function CompatibilidadMarca({ marca, tipo, rotuloTipo }: {
    marca: string; tipo: string; rotuloTipo: string;
}) {
    const v = evaluar(marca, tipo);
    if (!marca || !tipo) return null;

    return (
        <AnimatePresence mode="wait" initial={false}>
            <motion.div key={`${marca}-${tipo}`}
                initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.18 }}
                className={cn("rounded-[10px] border p-3.5",
                    v.sirve ? "border-[var(--bien)]/35 bg-[var(--bien-suave)]"
                        : "border-[var(--mal)]/35 bg-[var(--mal-suave)]")}>
                {v.sirve ? (
                    <p className="flex items-start gap-2 text-[12.5px] text-[var(--bien-texto)]">
                        <Check size={14} className="mt-px shrink-0" />
                        <span>
                            <b>{v.soporte?.rotulo}</b> sirve para esto. {v.soporte?.nota}
                        </span>
                    </p>
                ) : (
                    <>
                        <p className="flex items-start gap-2 text-[12.5px] text-[var(--mal-texto)]">
                            <AlertTriangle size={14} className="mt-px shrink-0" />
                            <span>
                                <b>{v.soporte?.rotulo || marca}</b> no puede funcionar como {rotuloTipo.toLowerCase()}.
                                {" "}{v.soporte?.nota}
                            </span>
                        </p>
                        {v.faltan.length > 0 && (
                            <p className="text-[11.5px] text-muted-foreground mt-2 pl-6">
                                Le falta: {v.faltan.map((c) => QUE_ES[c].toLowerCase()).join("; ")}.
                            </p>
                        )}
                        {/* Se puede cargar igual. Un equipo que está en la pared existe aunque
                            OmniAccess todavía no sepa hablarle, y tenerlo inventariado con su
                            IP y su ubicación ya sirve. Lo que no puede pasar es que alguien
                            crea que va a abrir una barrera. */}
                        <p className="text-[11.5px] text-muted-foreground mt-2 pl-6">
                            Se puede dar de alta igual para tenerlo inventariado, pero no esperes que abra
                            nada ni que reciba credenciales.
                        </p>
                    </>
                )}
            </motion.div>
        </AnimatePresence>
    );
}
