"use client";

import { Check } from "lucide-react";
import { Pista } from "@/components/ui/pista";
import { cn } from "@/lib/utils";

/**
 * A qué equipos se le copia una credencial.
 *
 * Vive acá y no adentro de una pantalla porque la pregunta es la misma desde dos lados
 * distintos: al cargar una persona con su matrícula, y al cargar un vehículo. Es la misma
 * matrícula y el mismo equipo del otro lado; tenerlo escrito dos veces era la forma segura
 * de que uno de los dos se quedara atrás.
 *
 * **Tener el permiso y estar en la memoria del equipo son cosas distintas**, y esa
 * confusión es la que este bloque tiene que deshacer cada vez que alguien lo mira. El
 * grupo de acceso dice por dónde y cuándo puede pasar; esto COPIA la credencial adentro
 * del equipo. Sin la copia, la cámara tiene el permiso cargado pero no sabe a quién
 * reconocer.
 */
export function ElegirEquipos({ equipos, elegidos, alAlternar, icono: Icono, vacio, bloqueo }: {
    equipos: any[];
    elegidos: string[];
    alAlternar: (id: string) => void;
    icono: React.ComponentType<{ size?: number; className?: string }>;
    /** Qué decir cuando no hay ninguno dado de alta. */
    vacio: string;
    /** Por qué todavía no se puede elegir. Si viene, la lista no se muestra. */
    bloqueo?: string;
}) {
    if (bloqueo) return <p className="text-[12px] text-muted-foreground">{bloqueo}</p>;
    if (!equipos.length) return <p className="text-[12px] text-muted-foreground">{vacio}</p>;

    return (
        <div className="space-y-1.5">
            {equipos.map((eq) => {
                const puesto = elegidos.includes(eq.id);
                return (
                    <button key={eq.id} type="button" onClick={() => alAlternar(eq.id)}
                        className={cn(
                            "w-full text-left p-2.5 rounded-[10px] border flex items-center justify-between gap-3 transition-colors",
                            puesto ? "border-[var(--accion)] bg-[color-mix(in_oklab,var(--accion)_10%,transparent)]"
                                : "border-border bg-card/40 hover:bg-accent",
                        )}>
                        <span className="flex items-center gap-2.5 min-w-0">
                            <span className={cn("w-7 h-7 rounded-md flex items-center justify-center shrink-0",
                                puesto ? "text-[var(--accion)]" : "text-muted-foreground bg-muted")}>
                                <Icono size={14} />
                            </span>
                            <span className="min-w-0">
                                <span className="block text-[13px] font-semibold text-foreground truncate">{eq.name}</span>
                                <span className="block text-[11.5px] text-muted-foreground tabular-nums truncate">{eq.ip}</span>
                            </span>
                        </span>
                        {puesto && <Check size={15} className="text-[var(--accion)] shrink-0" />}
                    </button>
                );
            })}
        </div>
    );
}

/** El rótulo de un grupo de equipos, con el porqué detrás del signo de pregunta. */
export function RotuloEquipos({ icono: Icono, children, pista, titulo }: {
    icono: React.ComponentType<{ size?: number; className?: string }>;
    children: React.ReactNode;
    pista?: React.ReactNode;
    titulo?: string;
}) {
    return (
        <span className="flex items-center gap-1.5 text-[12px] font-medium text-foreground/85 mb-1.5">
            <Icono size={13} className="text-muted-foreground/70" />
            {children}
            {pista && (
                <Pista titulo={titulo} texto={pista} lado="arriba" ancho={280}>
                    <span className="w-3.5 h-3.5 rounded-full border border-muted-foreground/40 text-muted-foreground/60
                        text-[9px] leading-none flex items-center justify-center cursor-help
                        hover:border-[var(--accion)] hover:text-[var(--accion)] transition-colors">?</span>
                </Pista>
            )}
        </span>
    );
}
