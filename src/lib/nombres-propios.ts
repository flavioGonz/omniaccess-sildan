"use client";

import { useEffect, useState } from "react";

/**
 * Los nombres de las clases del detector propio, para la pantalla. omni-vision las emite como
 * «propio:<id>» (el id no cambia si se renombra la clase) y el registro las guarda así; acá se
 * traduce al nombre que eligió quien la creó.
 *
 * Un solo pedido por pestaña, compartido: las pantallas que muestran objetos llaman a
 * `useNombresPropios()` para volver a dibujarse cuando llegan los nombres.
 */
const nombres = new Map<string, string>();
let pedido: Promise<void> | null = null;
export const PREFIJO_PROPIO = "propio:";

function cargar(): Promise<void> {
    return (pedido ||= fetch("/api/vision/objetos", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => { for (const c of j?.clases || []) nombres.set(c.id, c.nombre); })
        .catch(() => { pedido = null; }));
}

export const esPropia = (clase: string) => clase.startsWith(PREFIJO_PROPIO);

/** El nombre de una clase propia, o null si no es propia. Sin los nombres todavía: «Objeto propio». */
export function nombrePropio(clase: string): string | null {
    if (!esPropia(clase)) return null;
    return nombres.get(clase.slice(PREFIJO_PROPIO.length)) || "Objeto propio";
}

export function listaPropias(): { clase: string; nombre: string }[] {
    return [...nombres].map(([id, nombre]) => ({ clase: `${PREFIJO_PROPIO}${id}`, nombre }));
}

export function useNombresPropios(): number {
    const [n, setN] = useState(nombres.size);
    useEffect(() => { let vivo = true; cargar().then(() => { if (vivo) setN(nombres.size); }); return () => { vivo = false; }; }, []);
    return n;
}
