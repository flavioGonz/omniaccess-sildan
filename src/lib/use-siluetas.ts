"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Si se dibujan las siluetas de OmniVision sobre las capturas. UNA preferencia para el visor del
 * evento y las miniaturas del historial: apagarla en el visor las apaga también en el mosaico
 * de atrás, que es lo que se espera de un interruptor que dice «siluetas».
 *
 * Vive en el navegador (es cómo mira cada uno, no un dato) y se avisa con un evento propio para
 * que todos los que la usan en la misma pestaña cambien juntos.
 */
const CLAVE = "omnivision.siluetas";
const EVENTO = "omnivision-siluetas";

function leer(): boolean {
    try { return localStorage.getItem(CLAVE) !== "0"; } catch { return true; }
}
function suscribir(cb: () => void) {
    window.addEventListener(EVENTO, cb);
    window.addEventListener("storage", cb);
    return () => { window.removeEventListener(EVENTO, cb); window.removeEventListener("storage", cb); };
}

export function useSiluetas(): [boolean, (v: boolean) => void] {
    const ver = useSyncExternalStore(suscribir, leer, () => true);
    const poner = useCallback((v: boolean) => {
        try { localStorage.setItem(CLAVE, v ? "1" : "0"); } catch { /* sin almacenamiento: dura lo que la pestaña */ }
        window.dispatchEvent(new Event(EVENTO));
    }, []);
    return [ver, poner];
}
