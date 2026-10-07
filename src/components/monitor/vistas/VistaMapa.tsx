"use client";

import { useEffect, useMemo } from "react";
import dynamic from "next/dynamic";
import { useMarco } from "@/components/monitor/MarcoMonitor";
import { useTiempoReal } from "@/lib/tiempo-real";
import type { FuenteMapa } from "@/components/BarrioMap";

const BarrioMap = dynamic(() => import("@/components/BarrioMap"), { ssr: false, loading: () => <div className="absolute inset-0 grid place-items-center text-[20px] text-muted-foreground">Cargando el mapa…</div> });

/**
 * La vista Mapa de la pared: el mismo mapa del barrio del panel en modo pantalla (sin
 * edición, sin buscador, sin menús), alimentado por HTTP porque un enlace de pantalla no
 * puede invocar server actions.
 */
const pedir = async (que: string, extra = "") => {
    const r = await fetch(`/api/monitor/mapa?que=${que}${extra}`, { cache: "no-store" });
    if (!r.ok) throw new Error(`El servidor respondió ${r.status}`);
    return r.json();
};

export function VistaMapa() {
    const { latir, setTitulo } = useMarco();
    useEffect(() => { setTitulo("Mapa"); }, [setTitulo]);
    useTiempoReal("access_event", latir);
    useTiempoReal("general_detection", latir);
    const fuente = useMemo<FuenteMapa>(() => ({
        barrio: () => pedir("barrio"),
        dispositivos: () => pedir("dispositivos"),
        plazas: () => pedir("plazas"),
        chapasPorPlaza: () => pedir("chapas"),
        camarasIntrusion: () => pedir("camaras"),
        geometria: (ids: string[]) => pedir("geometria", `&ids=${encodeURIComponent(ids.join(","))}`),
        detecciones: (opts?: any) => pedir("detecciones", `&n=${opts?.pageSize || 14}`),
        conteosIntrusion: () => pedir("conteos"),
    }), []);
    return (
        <div className="absolute inset-0 [&_.leaflet-control-zoom]:hidden [&_.leaflet-control-attribution]:hidden">
            <BarrioMap modo="pantalla" fuente={fuente} />
        </div>
    );
}
