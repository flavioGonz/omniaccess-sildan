"use client";

import { AnimatePresence, motion } from "framer-motion";
import { AlertCircle, Check, Loader2, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Lo que pasa cuando se aprieta Registrar.
 *
 * Guardar a una persona no es un solo acto: se escribe la ficha, puede subirse una foto, y
 * después la credencial se copia UNA POR UNA a la memoria de cada cámara y cada terminal.
 * Eso son cosas que ocurren en el mundo real, en equipos lentos que a veces no contestan.
 *
 * Antes eso era una barra de progreso con el nombre del equipo de turno, debajo del
 * formulario, y al terminar el cajón se cerraba **aunque algún equipo hubiera fallado**.
 * Nadie se enteraba: la persona quedaba guardada, la cámara sin la matrícula, y el auto no
 * abría la barrera el lunes sin que hubiera ninguna señal de por qué.
 *
 * Por eso el envío es un momento propio y no un renglón: toma la pantalla, muestra cada
 * paso con su resultado, y **no se cierra solo si algo salió mal**. Si todo salió bien sí
 * se cierra, porque quedarse a mirar una lista de tildes verdes no le sirve a nadie.
 *
 * La línea vertical que une los pasos no es decoración: es lo que dice que son etapas de
 * una misma cosa y en ese orden. Sin ella son cuatro renglones sueltos.
 */

export type EstadoPaso = "espera" | "curso" | "listo" | "falló";

export type Paso = {
    id: string;
    titulo: string;
    /** Qué es exactamente lo que se está haciendo. Una línea. */
    detalle?: string;
    estado: EstadoPaso;
    /** Por qué falló, cuando falló. */
    error?: string;
};

const ICONOS: Record<EstadoPaso, React.ReactNode> = {
    espera: <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40" />,
    curso: <Loader2 size={13} className="animate-spin text-[var(--accion)]" />,
    listo: <Check size={13} className="text-[var(--bien)]" />,
    falló: <AlertCircle size={13} className="text-[var(--mal)]" />,
};

export function PasosEnvio({ pasos, terminado, alCerrar, alReintentar }: {
    pasos: Paso[];
    /** Null mientras corre. Después, si se puede dar por bueno. */
    terminado: boolean;
    alCerrar: () => void;
    alReintentar: () => void;
}) {
    const fallaron = pasos.filter((p) => p.estado === "falló");
    const listos = pasos.filter((p) => p.estado === "listo").length;

    return (
        <div className="px-6 py-8">
            <div className="mb-6">
                <p className="text-[15px] font-semibold text-foreground">
                    {!terminado ? "Guardando…" : fallaron.length ? "Terminó, pero no todo salió" : "Listo"}
                </p>
                <p className="text-[12.5px] text-muted-foreground mt-0.5">
                    {!terminado
                        ? "Los equipos tardan unos segundos en contestar."
                        : fallaron.length
                            ? `${listos} de ${pasos.length} pasos salieron bien. Los que fallaron se pueden volver a intentar.`
                            : "La persona quedó cargada y sus credenciales están en los equipos."}
                </p>
            </div>

            <ol className="relative">
                {/* La línea corre por detrás de los puntos y se corta antes del último. */}
                <span aria-hidden className="absolute left-[11px] top-3 bottom-3 w-px bg-border" />

                {pasos.map((paso) => (
                    <li key={paso.id} className="relative flex gap-3 pb-4 last:pb-0">
                        <span className={cn(
                            "relative z-[1] mt-0.5 w-[23px] h-[23px] shrink-0 rounded-full border flex items-center justify-center transition-colors duration-300",
                            paso.estado === "curso" ? "border-[var(--accion)] bg-background"
                                : paso.estado === "listo" ? "border-[var(--bien)]/40 bg-[var(--bien-suave)]"
                                    : paso.estado === "falló" ? "border-[var(--mal)]/40 bg-[var(--mal-suave)]"
                                        : "border-border bg-background",
                        )}>
                            <AnimatePresence mode="wait" initial={false}>
                                <motion.span key={paso.estado}
                                    initial={{ opacity: 0, scale: 0.6 }}
                                    animate={{ opacity: 1, scale: 1 }}
                                    exit={{ opacity: 0, scale: 0.6 }}
                                    transition={{ duration: 0.18 }}
                                    className="flex items-center justify-center">
                                    {ICONOS[paso.estado]}
                                </motion.span>
                            </AnimatePresence>
                        </span>

                        <span className="min-w-0 flex-1 pt-0.5">
                            <span className={cn("block text-[13px] font-medium transition-colors duration-300",
                                paso.estado === "espera" ? "text-muted-foreground" : "text-foreground")}>
                                {paso.titulo}
                            </span>
                            {(paso.error || paso.detalle) && (
                                <span className={cn("block text-[11.5px] mt-0.5",
                                    paso.error ? "text-[var(--mal-texto)]" : "text-muted-foreground")}>
                                    {paso.error || paso.detalle}
                                </span>
                            )}
                        </span>
                    </li>
                ))}
            </ol>

            {terminado && (
                <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
                    className="flex gap-2 mt-7">
                    {fallaron.length > 0 && (
                        <Button type="button" onClick={alReintentar} className="flex-1">
                            <RotateCw size={14} /> Reintentar {fallaron.length === 1 ? "el que falló" : `los ${fallaron.length} que fallaron`}
                        </Button>
                    )}
                    <Button type="button" variant={fallaron.length ? "ghost" : "default"}
                        onClick={alCerrar} className="flex-1">
                        {fallaron.length ? "Cerrar igual" : "Cerrar"}
                    </Button>
                </motion.div>
            )}
        </div>
    );
}
