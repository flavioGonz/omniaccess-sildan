"use client";

import { useMemo, useSyncExternalStore } from "react";
import { alternarFijado, leerFijados } from "@/lib/menu-fijados";

/**
 * Las pantallas fijadas arriba del menú, guardadas en este navegador (24/11). La regla está en
 * lib/menu-fijados.ts; acá sólo dónde se guarda, igual que el estado del menú (hooks/useMenuLateral):
 * con useSyncExternalStore, para que el primer dibujo ya salga con lo guardado, y con una copia en
 * memoria que manda si el almacenamiento no está.
 *
 * Es por navegador y no por persona: fijar algo en la PC de la guardia lo fija para quien se siente
 * ahí. Que siga a la persona de una PC a otra pide guardarlo en su cuenta; queda anotado.
 */
const CLAVE = "oa.menu.fijados";
let leido = false;
let crudo: string | null = null;
const oyentes = new Set<() => void>();

function cargar() {
    if (leido) return;
    leido = true;
    try { crudo = localStorage.getItem(CLAVE); } catch { /* sin almacenamiento: los de fábrica */ }
}
function suscribir(avisar: () => void) {
    oyentes.add(avisar);
    const otra = (e: StorageEvent) => { if (e.key === CLAVE) { crudo = e.newValue; avisar(); } };
    window.addEventListener("storage", otra);
    return () => { oyentes.delete(avisar); window.removeEventListener("storage", otra); };
}
/* El texto guardado, o «\u0000» si nunca se guardó nada: una instantánea tiene que ser un valor estable. */
const instantanea = () => { cargar(); return crudo ?? "\u0000"; };
const instantaneaServidor = () => "\u0000";

export function useMenuFijados() {
    const guardado = useSyncExternalStore(suscribir, instantanea, instantaneaServidor);
    const fijados = useMemo(() => leerFijados(guardado === "\u0000" ? null : guardado), [guardado]);
    const alternar = (id: string) => {
        crudo = JSON.stringify(alternarFijado(fijados, id));
        try { localStorage.setItem(CLAVE, crudo); } catch { /* idem */ }
        oyentes.forEach((f) => f());
    };
    return { fijados, alternar };
}
