"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * IconBar — el bloque "Icon bar" de Bencho (bencho.dev), MIT.
 *
 * Autor: Lorenzo Cabra. El sitio publica la API y el CSS; la lógica está reconstruida a
 * partir de ellos y del bloque andando, y se mantiene fiel a sus nombres y sus valores.
 *
 * Lo que lo distingue de una fila de botones con un fondito que se mueve es el
 * INDICADOR DE DOS FASES. Moverse entre ranuras no se suaviza sobre una sola distancia:
 *
 *   fase 1 · estirar   el borde de adelante salta y la píldora se dilata hasta cubrir las
 *                      dos ranuras, la que deja y la que toma.
 *   fase 2 · asentar   el borde de atrás alcanza al de adelante y la píldora se contrae
 *                      sobre el destino, pasándose un poco.
 *
 * El traspaso entre las dos es lo que decide cuánto se estira. El rebote es literalmente
 * el tercer punto de control de la curva pasado de 1: ahí y en ningún otro lado.
 *
 * Añadidos de este proyecto, marcados para no confundirlos con el original:
 *   · `value` / `onChange` — el bloque maneja su propia selección; acá casi siempre hay
 *     un estado afuera que ya sabe cuál es la vista activa.
 *   · `acciones` — botones que comparten la ranura y el aspecto pero NO se llevan el
 *     indicador. Una barra de herramientas mezcla dos cosas distintas: elegir un modo
 *     (que tiene estado, y por eso tiene indicador) y disparar una acción (que no lo
 *     tiene). Dibujarlas iguales sin distinguirlas haría que el indicador saltara a un
 *     botón de "acercar", que no es un lugar donde quedarse.
 *   · `antes` / `despues` — lo que no entra en una ranura cuadrada: un menú desplegable,
 *     un botón con texto. Van DENTRO de la misma barra en vez de al lado, porque tres
 *     píldoras separadas con tres vidrios y tres sombras no se leen como una barra de
 *     herramientas sino como tres cosas que casualmente están alineadas.
 */

/** Duración: al 50 vale 1, o sea los 190 ms y 420 ms del CSS tal cual. */
const factorDuracion = (velocidad: number) => 1.6 - (velocidad / 100) * 1.2;

/** El pico de la curva, interpolado por el rebote. Al 50 devuelve el pico nominal. */
const pico = (rebote: number, tope: number) =>
    Number((1 + (rebote / 100) * (tope - 1) * 2).toFixed(3));

const curva = (rebote: number, tope: number, x1 = 0.28, x2 = 0.36) =>
    `cubic-bezier(${x1}, ${pico(rebote, tope)}, ${x2}, 1)`;

const curvas = (rebote: number) => ({
    mover: curva(rebote, 1.28, 0.28, 0.36),
    tamano: curva(rebote, 1.34, 0.24, 0.38),
});

const acotar = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/** Radio máximo. Por encima de esto la píldora deja de leerse como ranura. */
const ESQUINA_MAX = 26;

export type ItemBarra = {
    key: string;
    label: string;
    Icon: React.ComponentType<{ size?: number; strokeWidth?: number }>;
    /** Apagado: se ve, no se puede elegir. */
    off?: boolean;
};

export type AccionBarra = {
    key: string;
    label: string;
    Icon: React.ComponentType<{ size?: number; strokeWidth?: number }>;
    onClick: () => void;
    off?: boolean;
    /** Encendida de forma permanente (un interruptor, no un disparo). */
    activa?: boolean;
    /** Tono de alarma cuando está encendida. */
    tono?: "normal" | "alerta";
};

export function IconBar({
    items,
    value,
    onChange,
    acciones,
    antes,
    despues,
    glyph = 17,
    axis = "row",
    dilate = 100,
    bounce = 50,
    speed = 50,
    hug = 6,
    corner = ESQUINA_MAX,
    superficie,
    className,
}: {
    items: ItemBarra[];
    value?: string;
    onChange?: (key: string) => void;
    acciones?: AccionBarra[];
    /** Antes de las ranuras: lo que no es cuadrado — un menú, un botón con texto. */
    antes?: React.ReactNode;
    /** Después de las ranuras: la acción principal, siempre en la misma punta. */
    despues?: React.ReactNode;
    glyph?: number;
    axis?: "row" | "column";
    /** Cuánto se estira en tránsito — 0 a 100. */
    dilate?: number;
    /** Cuánto se pasa al aterrizar — 0 a 100. */
    bounce?: number;
    /** Velocidad — 0 a 100. */
    speed?: number;
    /** Abrazo: el aire entre la píldora y el borde — 3 a 10 px. */
    hug?: number;
    /** Esquina — 0 a 26 px. */
    corner?: number;
    /** "oscura" cuando la barra flota sobre una foto o un mapa: la superficie de abajo no
     *  es la de la aplicación, así que el vidrio tiene que ser oscuro en los dos temas. */
    superficie?: "oscura";
    className?: string;
}) {
    const vertical = axis === "column";
    const [propio, setPropio] = useState(items[0]?.key);
    const activo = value ?? propio;

    const nav = useRef<HTMLElement | null>(null);
    const ranuras = useRef<Record<string, HTMLButtonElement | null>>({});
    const [caja, setCaja] = useState<{ p: number; s: number } | null>(null);
    const [fase, setFase] = useState<"idle" | "stretch" | "settle">("idle");
    const previo = useRef<{ p: number; s: number } | null>(null);
    const reloj = useRef<number | undefined>(undefined);

    const medir = (k: string) => {
        const el = ranuras.current[k];
        if (!el) return null;
        return vertical
            ? { p: el.offsetTop, s: el.offsetHeight }
            : { p: el.offsetLeft, s: el.offsetWidth };
    };

    // El indicador se coloca sin animar cuando cambia el tamaño de la barra: una ventana
    // que se achica no es un cambio de selección, y animarlo se ve como un tirón.
    useLayoutEffect(() => {
        const poner = () => {
            const m = medir(activo);
            if (!m) return;
            previo.current = m;
            setFase("idle");
            setCaja(m);
        };
        poner();
        const obs = new ResizeObserver(poner);
        if (nav.current) obs.observe(nav.current);
        return () => obs.disconnect();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [vertical, activo, items.length]);

    const elegir = (k: string) => {
        if (k === activo) return;
        const destino = medir(k);
        const desde = previo.current;
        if (value === undefined) setPropio(k);
        onChange?.(k);
        if (!destino) return;

        window.clearTimeout(reloj.current);
        if (!desde) {
            previo.current = destino;
            setFase("settle");
            setCaja(destino);
            return;
        }

        // Fase 1: la píldora cubre las dos ranuras, tanto como diga `dilate`.
        const desdeBorde = Math.min(desde.p, destino.p);
        const hastaBorde = Math.max(desde.p + desde.s, destino.p + destino.s);
        const u = dilate / 100;
        setFase("stretch");
        setCaja({
            p: destino.p + (desdeBorde - destino.p) * u,
            s: destino.s + (hastaBorde - desdeBorde - destino.s) * u,
        });

        // Fase 2: se contrae sobre el destino.
        reloj.current = window.setTimeout(() => {
            previo.current = destino;
            setFase("settle");
            setCaja(destino);
        }, 150 * factorDuracion(speed));
    };

    const estiloInd = caja
        ? vertical
            ? { transform: `translate3d(0, ${caja.p}px, 0)`, height: caja.s }
            : { transform: `translate3d(${caja.p}px, 0, 0)`, width: caja.s }
        : { opacity: 0 };

    const c = curvas(bounce);

    return (
        <nav
            ref={nav as any}
            className={cn("gnav", className)}
            data-orientation={vertical ? "vertical" : "horizontal"}
            data-superficie={superficie}
            aria-label="Controles"
            style={{
                "--gnav-r": `${acotar(corner, 0, ESQUINA_MAX)}px`,
                "--nav-pad": `${hug}px`,
                "--ind-stretch": `${Math.round(190 * factorDuracion(speed))}ms`,
                "--ind-settle": `${Math.round(420 * factorDuracion(speed))}ms`,
                "--ind-move": c.mover,
                "--ind-size": c.tamano,
            } as React.CSSProperties}
        >
            <span className="gnav-ind" data-phase={fase} style={estiloInd} aria-hidden />

            {antes}
            {antes && (items.length > 0 || !!acciones?.length) && <span className="gnav-sep" aria-hidden />}

            {items.map(({ key, label, Icon, off }) => (
                <button
                    key={key}
                    ref={(el) => { ranuras.current[key] = el; }}
                    className="gnav-item"
                    data-active={activo === key}
                    disabled={off}
                    aria-label={label}
                    title={label}
                    aria-current={activo === key ? "page" : undefined}
                    onClick={() => elegir(key)}
                    onPointerDown={(e) => e.stopPropagation()}
                >
                    <Icon size={glyph} strokeWidth={2} />
                </button>
            ))}

            {!!acciones?.length && items.length > 0 && <span className="gnav-sep" aria-hidden />}

            {acciones?.map(({ key, label, Icon, onClick, off, activa, tono }) => (
                <button
                    key={key}
                    className="gnav-item"
                    data-accion="true"
                    data-encendida={activa || undefined}
                    data-tono={tono === "alerta" ? "alerta" : undefined}
                    disabled={off}
                    aria-label={label}
                    title={label}
                    aria-pressed={activa}
                    onClick={onClick}
                    onPointerDown={(e) => e.stopPropagation()}
                >
                    <Icon size={glyph} strokeWidth={2} />
                </button>
            ))}

            {despues && (items.length > 0 || !!acciones?.length) && <span className="gnav-sep" aria-hidden />}
            {despues}
        </nav>
    );
}
