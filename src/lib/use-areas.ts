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
        .then((r) => (r.ok ? r.json() : null))
        // Sin permiso (una pantalla) no se pisa lo que ya se sabía (sembrarAreas).
        .then((j): Areas => { if (!j) return ultimo?.datos || VACIO; const d = { areas: Array.isArray(j?.areas) ? j.areas : [], equipoArea: j?.equipoArea || {} }; ultimo = { t: Date.now(), datos: d }; return d; })
        .catch(() => VACIO)
        .finally(() => { pedido = null; });
    return pedido;
}

/**
 * Las áreas ya conocidas por otro camino. La pared de Cámaras con un enlace de pantalla no puede
 * pedir /api/areas (es del panel), pero /api/monitor/camaras ya trae el árbol: con esto los
 * elegidores de área de «Buscar parecidos» las tienen igual (openspec pared-vms).
 */
export function sembrarAreas(areas: AreaElegible[]) {
    if (ultimo && ultimo.datos.areas.length) return;
    ultimo = { t: Date.now(), datos: { areas, equipoArea: {} } };
}

export function useAreas(): Areas {
    const [d, setD] = useState<Areas>(ultimo?.datos || VACIO);
    useEffect(() => { let vivo = true; pedir().then((x) => { if (vivo) setD(x); }); return () => { vivo = false; }; }, []);
    return d;
}
