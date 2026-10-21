"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAreas } from "@/lib/use-areas";
import { SIN_AREA } from "@/lib/filtro-areas";

/**
 * Filtrar una pantalla de monitoreo por ÁREA de Dispositivos (21/10, Nico: «Monitor LPR y Monitor
 * de Intrusión deben tener el filtro de áreas también»).
 *
 * Lo mismo que hace Monitor CCTV, sacado a una pieza para no escribirlo tres veces:
 *  · elegir un área trae los equipos de esa área Y de las de adentro (Otto Villa › Portones);
 *  · «Sin área» es lo que no está en ninguna;
 *  · un canal de NVR que no tiene área propia hereda la de su grabador (el respaldo), que es como
 *    se arman las áreas en la práctica: se pone el NVR en «Otto Villa» y no cada canal.
 *
 * Lo elegido se recuerda por pantalla en el navegador (es una comodidad del puesto, no un dato:
 * si el navegador no guarda, arranca en «todas»).
 */
export const TODAS_LAS_AREAS = "todas";

export function useFiltroArea(clave: string) {
    const { areas, equipoArea } = useAreas();
    const llave = `omni.area.${clave}`;
    const [area, setAreaCrudo] = useState<string>(TODAS_LAS_AREAS);
    useEffect(() => { try { const v = localStorage.getItem(llave); if (v) setAreaCrudo(v); } catch { /* sin almacenamiento: queda en «todas» */ } }, [llave]);
    const setArea = useCallback((v: string) => { setAreaCrudo(v || TODAS_LAS_AREAS); try { localStorage.setItem(llave, v || TODAS_LAS_AREAS); } catch { /* idem */ } }, [llave]);

    // Cada área con las de adentro (el área cuenta como dentro de sí misma).
    const bajo = useMemo(() => {
        const m = new Map<string, Set<string>>();
        for (const a of areas) {
            const set = new Set([a.id]);
            for (let cambio = true; cambio;) { cambio = false; for (const b of areas) if (b.padre && set.has(b.padre) && !set.has(b.id)) { set.add(b.id); cambio = true; } }
            m.set(a.id, set);
        }
        return m;
    }, [areas]);

    // Un área elegida que ya no existe (la borraron) vale como «todas»: si no, la pantalla queda vacía sin explicación.
    const elegida = area === TODAS_LAS_AREAS || area === SIN_AREA || bajo.has(area) ? area : (areas.length ? TODAS_LAS_AREAS : area);

    const areaDe = useCallback((id?: string | null, respaldo?: string | null): string | null => {
        const a = (id && equipoArea[id]) || (respaldo && equipoArea[respaldo]) || null;
        return a && bajo.has(a) ? a : null;
    }, [equipoArea, bajo]);

    const enAreaDe = useCallback((sel: string, id?: string | null, respaldo?: string | null) => {
        if (sel === TODAS_LAS_AREAS) return true;
        const a = areaDe(id, respaldo);
        if (sel === SIN_AREA) return !a;
        return !!a && !!bajo.get(sel)?.has(a);
    }, [areaDe, bajo]);

    /** ¿Este equipo (o, si no tiene área, su grabador) está en el área elegida? */
    const enArea = useCallback((id?: string | null, respaldo?: string | null) => enAreaDe(elegida, id, respaldo), [enAreaDe, elegida]);

    const nombre = elegida === TODAS_LAS_AREAS ? null : elegida === SIN_AREA ? "Sin área" : areas.find((a) => a.id === elegida)?.nombre || null;
    return { areas, area: elegida, setArea, enArea, enAreaDe, areaDe, nombre, hayAreas: areas.length > 0, filtrando: elegida !== TODAS_LAS_AREAS };
}
