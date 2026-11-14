"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Acercar la foto de un evento con la ruedita, hacia donde está el puntero, y moverla arrastrando.
 *
 * Por qué (14/11, Nico, con un aviso de analítica entrenable abierto: «permití hacer zoom con la
 * ruedita sobre la foto del evento, como el resto de eventos»). El visor de las lecturas
 * (VisorCuadro) siempre lo tuvo; la ficha de las detecciones no, y ahí lo que importa suele ser
 * chico y lejos: un contenedor al fondo de la calle, alguien en una esquina del cuadro.
 *
 * Es un gancho aparte y no el código de VisorCuadro movido: aquel está enredado con su recuadro
 * de matrícula, su pellizco y sus teclas, y sacarlo de ahí era tocar el visor más usado para
 * arreglar otro. Las reglas son las mismas: el zoom va al puntero y no al centro, la foto nunca
 * deja un borde vacío, y cada foto nueva se abre sin acercar.
 *
 * Cómo se usa: `marco` es quien escucha (la ventana), `contenido` es lo que se agranda (la foto
 * con todo lo que lleva dibujado encima, así las marcas siguen pegadas a lo que marcan). La rueda
 * no actúa sobre los paneles (`.visor-zona`): ahí la rueda es para leer la lista.
 */
export const ZOOM_MAX = 8;
/** Lo que acerca el doble clic. */
const ZOOM_DOBLE_CLIC = 2.5;
/** Menos que esto no es arrastrar: es un clic con el pulso de siempre. */
const UMBRAL_ARRASTRE_PX = 5;

type Vista = { s: number; x: number; y: number };
const QUIETA: Vista = { s: 1, x: 0, y: 0 };

export function useZoomFoto({ activo, clave }: { activo: boolean; clave: string }) {
    const marco = useRef<HTMLDivElement>(null);
    const contenido = useRef<HTMLDivElement>(null);
    // La vista guarda de qué foto es: con otra foto (u otro modo) vale «sin acercar» sin tener que
    // borrarla. Cada foto se abre entera: heredar el zoom de la anterior desorienta.
    const [guardada, setGuardada] = useState<Vista & { de: string }>({ ...QUIETA, de: clave });
    const v: Vista = activo && guardada.de === clave ? guardada : QUIETA;
    // La vista vigente, para los manejadores: dos muescas de la rueda pueden llegar antes de que
    // React vuelva a dibujar, y la segunda tiene que partir de la primera, no de lo dibujado.
    const vRef = useRef<Vista>(QUIETA);
    useEffect(() => { vRef.current = QUIETA; }, [clave, activo]);
    const poner = useCallback((n: Vista) => { vRef.current = n; setGuardada({ ...n, de: clave }); }, [clave]);
    const [arrastrando, setArrastrando] = useState(false);
    /** El último gesto fue un arrastre: el clic que le sigue no es para lo que quedó debajo. */
    const movio = useRef(false);

    /** Que la foto no deje ver un borde vacío: se puede correr sólo lo que sobra a esa escala. */
    const acotar = useCallback((n: Vista): Vista => {
        const m = marco.current?.getBoundingClientRect(), c = contenido.current;
        if (!m || !c || n.s <= 1) return QUIETA;
        // offsetWidth es el tamaño sin la transformación.
        const maxX = Math.max(0, (c.offsetWidth * n.s - m.width) / 2), maxY = Math.max(0, (c.offsetHeight * n.s - m.height) / 2);
        return { s: n.s, x: Math.max(-maxX, Math.min(maxX, n.x)), y: Math.max(-maxY, Math.min(maxY, n.y)) };
    }, []);

    /** Poner la escala dejando quieto el punto de la foto que está bajo (clienteX, clienteY). */
    const zoomEn = useCallback((escala: number, clienteX?: number, clienteY?: number) => {
        const m = marco.current?.getBoundingClientRect();
        if (!m) return;
        const a = vRef.current, s = Math.max(1, Math.min(ZOOM_MAX, escala));
        // El puntero, medido desde el centro del marco (que es el centro de la foto sin correr).
        const px = clienteX == null ? 0 : clienteX - m.left - m.width / 2, py = clienteY == null ? 0 : clienteY - m.top - m.height / 2;
        const k = s / a.s;
        poner(acotar({ s, x: px - (px - a.x) * k, y: py - (py - a.y) * k }));
    }, [acotar, poner]);
    const reiniciar = useCallback(() => poner(QUIETA), [poner]);

    // La rueda se escucha a mano y no con onWheel: React la registra pasiva y no deja frenar el
    // desplazamiento de la página de atrás.
    useEffect(() => {
        const el = marco.current;
        if (!el || !activo) return;
        const sobreLaFoto = (t: EventTarget | null) => !(t instanceof Element && t.closest(".visor-zona, [role='menu'], [data-sin-zoom]"));
        const rueda = (e: WheelEvent) => {
            if (!sobreLaFoto(e.target)) return;
            e.preventDefault();
            zoomEn(vRef.current.s * (e.deltaY < 0 ? 1.18 : 1 / 1.18), e.clientX, e.clientY);
        };
        let desde: { x: number; y: number; vx: number; vy: number } | null = null;
        const abajo = (e: PointerEvent) => {
            movio.current = false;
            if (e.button !== 0 || vRef.current.s <= 1 || !sobreLaFoto(e.target)) return;
            desde = { x: e.clientX, y: e.clientY, vx: vRef.current.x, vy: vRef.current.y };
        };
        const mueve = (e: PointerEvent) => {
            if (!desde) return;
            const dx = e.clientX - desde.x, dy = e.clientY - desde.y;
            if (!movio.current && Math.hypot(dx, dy) < UMBRAL_ARRASTRE_PX) return;
            movio.current = true; setArrastrando(true);
            poner(acotar({ s: vRef.current.s, x: desde.vx + dx, y: desde.vy + dy }));
        };
        const arriba = () => { desde = null; setArrastrando(false); };
        // Después de arrastrar, el clic no llega a lo que quedó debajo (una marca, la foto).
        const clic = (e: MouseEvent) => { if (movio.current) { e.stopPropagation(); e.preventDefault(); movio.current = false; } };
        const doble = (e: MouseEvent) => { if (!sobreLaFoto(e.target)) return; zoomEn(vRef.current.s > 1 ? 1 : ZOOM_DOBLE_CLIC, e.clientX, e.clientY); };
        el.addEventListener("wheel", rueda, { passive: false });
        el.addEventListener("pointerdown", abajo);
        el.addEventListener("click", clic, true);
        el.addEventListener("dblclick", doble);
        window.addEventListener("pointermove", mueve);
        window.addEventListener("pointerup", arriba);
        window.addEventListener("pointercancel", arriba);
        return () => {
            el.removeEventListener("wheel", rueda); el.removeEventListener("pointerdown", abajo); el.removeEventListener("click", clic, true); el.removeEventListener("dblclick", doble);
            window.removeEventListener("pointermove", mueve); window.removeEventListener("pointerup", arriba); window.removeEventListener("pointercancel", arriba);
        };
    }, [activo, zoomEn, acotar, poner]);

    const acercado = v.s > 1.001;
    return {
        marco, contenido, escala: v.s, acercado, arrastrando, reiniciar, zoomEn,
        /** Para el `style` de `contenido`. Sin transición mientras se arrastra: tiene que ir con la mano. */
        estilo: { transform: acercado ? `translate3d(${v.x}px, ${v.y}px, 0) scale(${v.s})` : undefined, transition: arrastrando ? "none" : "transform 140ms ease-out", willChange: acercado ? "transform" as const : undefined },
    };
}
