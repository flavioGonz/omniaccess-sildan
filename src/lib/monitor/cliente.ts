"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Los datos de una vista de pantalla: se piden por HTTP cada tanto, se repiten al volver
 * el foco, y avisan al marco cada vez que llega algo (`alLatir`), que es lo que mantiene
 * "En vivo" aunque en el barrio no pase nada. Un 401 significa que el enlace fue revocado
 * o la sesión venció: la vista no lo esconde, lo dice.
 */
export function usarDatos<T>(url: string | null, intervaloMs: number, alLatir?: () => void) {
    const [datos, setDatos] = useState<T | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [revocado, setRevocado] = useState(false);
    const [actualizado, setActualizado] = useState<Date | null>(null);
    const vivo = useRef(true);
    const latir = useRef(alLatir); latir.current = alLatir;

    const cargar = useCallback(async () => {
        if (!url) return;
        try {
            const r = await fetch(url, { cache: "no-store" });
            if (r.status === 401 || r.status === 403) { if (vivo.current) setRevocado(true); return; }
            if (!r.ok) throw new Error(`El servidor respondió ${r.status}`);
            const j = await r.json();
            if (!vivo.current) return;
            setDatos(j); setError(null); setActualizado(new Date()); latir.current?.();
        } catch (e: any) { if (vivo.current) setError(e?.message || "sin respuesta"); }
    }, [url]);

    useEffect(() => {
        vivo.current = true;
        cargar();
        const iv = setInterval(cargar, intervaloMs);
        const foco = () => { if (document.visibilityState === "visible") cargar(); };
        document.addEventListener("visibilitychange", foco); window.addEventListener("focus", foco);
        return () => { vivo.current = false; clearInterval(iv); document.removeEventListener("visibilitychange", foco); window.removeEventListener("focus", foco); };
    }, [cargar, intervaloMs]);

    return { datos, error, revocado, actualizado, recargar: cargar };
}

export const hace = (ts: string | number | Date | null | undefined): string => {
    if (!ts) return "—";
    const s = Math.max(0, Math.floor((Date.now() - new Date(ts).getTime()) / 1000));
    if (s < 60) return `hace ${s} s`;
    const m = Math.floor(s / 60); if (m < 60) return `hace ${m} min`;
    const h = Math.floor(m / 60); if (h < 24) return `hace ${h} h`;
    return `hace ${Math.floor(h / 24)} d`;
};

export const horaCorta = (ts: string | number | Date) => new Date(ts).toLocaleTimeString("es-UY", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });

/** Un tick por segundo, para los "hace cuánto" de la pantalla. */
export function usarReloj(ms = 1000) {
    const [, tick] = useState(0);
    useEffect(() => { const iv = setInterval(() => tick((x) => x + 1), ms); return () => clearInterval(iv); }, [ms]);
}
