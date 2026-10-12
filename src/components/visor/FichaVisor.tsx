"use client";

import { Loader2, Sparkles, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { COLOR_GRUPO, COLOR_OTRO, ICONO_CLASE, ICONO_GRUPO } from "@/components/vision/CapaAnalisis";
import type { ObjetoAnalizado } from "@/lib/vision-capa";

/**
 * Las piezas de la ficha del visor del evento.
 *
 * La ficha era una pila de chips redondeados — con borde punteado los que faltaban, con vidrio
 * los que había — y OmniVision llegaba como «Persona · no · no · no · naranja 91%». Se leía como
 * un tablero de etiquetas, no como una ficha: el ojo tenía que saltar de burbuja en burbuja y
 * cada burbuja tenía su propia forma de decir las cosas.
 *
 * Ahora es una ficha de verdad: secciones con un rótulo chico y una línea fina, y adentro
 * renglones RÓTULO → VALOR alineados, como una hoja de datos. Lo que falta se dice en el mismo
 * renglón («sin cargar»), apagado — el hueco sigue a la vista, pero sin dibujar una caja vacía.
 */

/** Una sección de la ficha: rótulo de grupo + línea fina. Sin caja, sin sombra. */
export function Seccion({ titulo, icono: Ico, extra, children, className }: {
    titulo: string; icono?: LucideIcon; extra?: React.ReactNode; children: React.ReactNode; className?: string;
}) {
    return (
        <section className={cn("border-t border-white/12 pt-2.5", className)}>
            <div className="flex items-center justify-between gap-2 mb-1.5">
                <h3 className="flex items-center gap-1.5 text-[9.5px] font-bold uppercase tracking-[0.14em] text-white/50">
                    {Ico && <Ico size={11} />} {titulo}
                </h3>
                {extra}
            </div>
            {children}
        </section>
    );
}

/**
 * Un renglón de la ficha. El rótulo a ancho fijo para que los valores queden en columna: así se
 * leen de corrido, de arriba abajo, sin buscar dónde empieza cada uno.
 */
export function Dato({ rotulo, valor, falta = "sin cargar", sufijo, tono }: {
    rotulo: string; valor?: React.ReactNode; falta?: string; sufijo?: React.ReactNode; tono?: string;
}) {
    const hay = valor != null && valor !== "" && valor !== false;
    return (
        <div className="grid grid-cols-[92px_1fr] items-baseline gap-3 py-[3px] text-[12.5px] leading-snug">
            <dt className="text-white/50">{rotulo}</dt>
            <dd className={cn("min-w-0", hay ? (tono || "text-white/95 font-semibold") : "text-white/30 italic")}>
                {hay ? valor : falta}
                {hay && sufijo && <span className="ml-1.5 font-normal text-white/55 tabular-nums">{sufijo}</span>}
            </dd>
        </div>
    );
}

/**
 * Un botón del visor. Rectángulo de 8px: la píldora en este sistema quiere decir «elegir» (un
 * chip que se prende y se apaga), y estos disparan una acción.
 */
export function BotonVisor({ icono: Ico, children, onClick, href, destacada, encendida, ocupada, title, className }: {
    icono: React.ComponentType<{ size?: number; className?: string }>;
    children?: React.ReactNode;
    onClick?: () => void;
    href?: string | null;
    destacada?: boolean;
    encendida?: boolean;
    ocupada?: boolean;
    title?: string;
    className?: string;
}) {
    const clase = cn(
        "inline-flex items-center gap-1.5 h-8 px-3 rounded-[8px] text-[12px] font-semibold whitespace-nowrap transition-colors disabled:opacity-60",
        destacada ? "bg-[var(--accion)] text-white hover:brightness-110"
            : encendida ? "bg-white/20 text-white border border-white/30"
                : "bg-white/[0.07] text-white/85 border border-white/15 hover:bg-white/15 hover:text-white",
        className,
    );
    const dentro = <>{ocupada ? <Loader2 size={14} className="animate-spin" /> : <Ico size={14} />}{children}</>;
    if (href) return <a href={href} download title={title} className={clase}>{dentro}</a>;
    return <button type="button" onClick={onClick} disabled={ocupada} title={title} className={clase}>{dentro}</button>;
}

/* ── OmniVision, en palabras ─────────────────────────────────────────────── */

/**
 * Qué se dice de un objeto, en castellano llano.
 *
 *   - Los «sí / no» (chaleco, casco, mochila, niño) se nombran SÓLO cuando son «sí»: «casco».
 *     Un «no» es la ausencia de algo y no se escribe; antes salía «no · no · no» y no se
 *     entendía de qué.
 *   - Los de elección se dicen con su sustantivo: «color blanco», «ropa naranja». Así no hace
 *     falta concordar el género con la clase («moto blanca», «auto blanco»), que el modelo no da.
 *   - Lo dudoso no se dice: el modelo mismo avisó que no se decidió.
 */
const SI_NO_NOMBRE: Record<string, string> = { chaleco: "chaleco reflectivo", casco: "casco", mochila: "mochila o bolso", nino: "niño" };
const PREFIJO: Record<string, string> = { color: "color", ropa: "ropa" };
export function rasgosDe(o: ObjetoAnalizado): string[] {
    const out: string[] = [];
    for (const a of o.atributos || []) {
        if (a.dudoso || !a.valor) continue;
        if (a.valor === "no") continue;
        if (a.valor === "sí" || a.valor === "si") { out.push(SI_NO_NOMBRE[a.id] || a.nombre.toLowerCase()); continue; }
        out.push(PREFIJO[a.id] ? `${PREFIJO[a.id]} ${a.valor}` : a.valor);
    }
    return out;
}

/** Orden de los grupos: lo que importa para un acceso primero. */
const ORDEN_GRUPO = ["vehiculo", "persona", "animal"];
/** Más renglones que esto empujan la ficha fuera de la ventana; el resto se cuenta. */
const OBJETOS_MAX = 8;

/**
 * Lo que vio OmniVision. Un renglón por objeto, agrupados (vehículos, personas, animales), con
 * el punto del MISMO color que su silueta sobre la foto: el renglón y la silueta se encuentran
 * sin leer. La confianza va a la derecha, en columna, que es donde se compara.
 */
export function ListaVision({ objetos }: { objetos: ObjetoAnalizado[] }) {
    const orden = (g: string) => { const i = ORDEN_GRUPO.indexOf(g); return i < 0 ? 99 : i; };
    const lista = [...objetos].sort((a, b) => orden(a.grupo) - orden(b.grupo) || b.confianza - a.confianza);
    return (
        <ul className="flex flex-col">
            {lista.slice(0, OBJETOS_MAX).map((o, i) => {
                const color = COLOR_GRUPO[o.grupo] || COLOR_OTRO;
                const Ico = ICONO_CLASE[o.clase] || ICONO_GRUPO[o.grupo] || Sparkles;
                const rasgos = rasgosDe(o);
                return (
                    <li key={i} className="grid grid-cols-[16px_1fr_auto] items-baseline gap-2 py-[3px] text-[12.5px] leading-snug">
                        <Ico size={13} className="self-center" style={{ color }} />
                        <span className="min-w-0">
                            <span className="font-semibold text-white/95 first-letter:uppercase inline-block">{o.nombre}</span>
                            {rasgos.length > 0 && <span className="text-white/65">{" — "}{rasgos.join(", ")}</span>}
                        </span>
                        <span className="text-[11.5px] text-white/45 tabular-nums">{Math.round(o.confianza * 100)} %</span>
                    </li>
                );
            })}
            {lista.length > OBJETOS_MAX && <li className="text-[11.5px] text-white/45 pl-6 py-[3px]">y {lista.length - OBJETOS_MAX} más en la foto</li>}
        </ul>
    );
}
