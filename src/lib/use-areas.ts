"use client";

import { useEffect, useState } from "react";
import type { AreaElegible } from "@/components/devices/ElegirCamara";

/**
 * Las áreas de Dispositivos para los elegidores de cámara (ElegirCamara): el árbol y en qué área
 * está cada equipo. Se piden una vez por página y se comparten entre los elegidores que haya.
 */
type Areas = { areas: AreaElegible[]; equipoArea: Record<string, string> };
const VACIO: Areas = { areas: [], equipoArea: {} };
let pedido: Promise<Areas> | null = null;
let ultimo: { t: number; datos: Areas } | null = null;
const VIGENCIA_MS = 60_000;

function pedir(): Promise<Areas> {
    if (ultimo && Date.now() - ultimo.t < VIGENCIA_MS) return Promise.resolve(ultimo.datos);
    pedido ??= fetch("/api/areas", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : VACIO))
        .then((j): Areas => { const d = { areas: Array.isArray(j?.areas) ? j.areas : [], equipoArea: j?.equipoArea || {} }; ultimo = { t: Date.now(), datos: d }; return d; })
        .catch(() => VACIO)
        .finally(() => { pedido = null; });
    return pedido;
}

export function useAreas(): Areas {
    const [d, setD] = useState<Areas>(ultimo?.datos || VACIO);
    useEffect(() => { let vivo = true; pedir().then((x) => { if (vivo) setD(x); }); return () => { vivo = false; }; }, []);
    return d;
}
