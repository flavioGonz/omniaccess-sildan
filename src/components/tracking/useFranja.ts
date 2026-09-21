"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
    aprenderVacio, borrarFranja, guardarFranja, leerFranja, medirFranja, tomarCuadro, type Medicion,
} from "@/app/actions/franja";

/**
 * El estado de una franja de estacionamiento, sin nada de dibujo.
 *
 * Vive aparte porque la franja se edita en DOS pantallas —la ficha del equipo y el
 * calibrador— y antes cada una iba a tener su copia. Dos copias del mismo estado se
 * separan sin que nadie lo decida: una arregla un caso, la otra no, y después la franja se
 * comporta distinto según desde dónde se la haya dibujado.
 *
 * Acá está lo que se guarda y las acciones; el polígono lo dibuja `FranjaLienzo` y los
 * controles los pone `FranjaPanel`.
 */

export type Punto = { x: number; y: number };
export type Esq = [Punto, Punto, Punto, Punto];

/**
 * Una franja de arranque sobre la mitad baja del cuadro, que es donde cae la calzada en
 * una cámara de calle. No es un valor mágico: es un punto de partida para mover, y mover
 * cuatro puntos es mucho menos trabajo que ponerlos de cero.
 */
export const FRANJA_INICIAL: Esq = [
    { x: 0.08, y: 0.62 }, { x: 0.92, y: 0.52 },
    { x: 0.92, y: 0.78 }, { x: 0.08, y: 0.95 },
];

export const LUGARES_POR_DEFECTO = 6;

const mezclar = (p: Punto, q: Punto, t: number): Punto => ({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });

/** La misma fórmula que el servidor. Repetida a propósito: el dibujo no puede esperar un viaje. */
export function celdaDe(e: Esq, i: number, n: number): Punto[] {
    const punto = (u: number, v: number) => {
        const t = (i + u) / n;
        return mezclar(mezclar(e[0], e[1], t), mezclar(e[3], e[2], t), v);
    };
    return [punto(0, 0), punto(1, 0), punto(1, 1), punto(0, 1)];
}

export type Ocupado = "" | "guardando" | "midiendo" | "aprendiendo" | "tomando";

export function useFranja(deviceId: string, hayRtsp: boolean) {
    const [esquinas, setEsquinas] = useState<Esq>(FRANJA_INICIAL);
    const [lugares, setLugares] = useState(LUGARES_POR_DEFECTO);
    const [activa, setActiva] = useState(true);
    const [existe, setExiste] = useState(false);
    const [aprendida, setAprendida] = useState<string | null>(null);
    const [medicion, setMedicion] = useState<Medicion | null>(null);
    const [ocupado, setOcupado] = useState<Ocupado>("");
    const [aviso, setAviso] = useState<string | null>(null);

    useEffect(() => {
        leerFranja(deviceId).then((f) => {
            if (!f) return;
            setExiste(true);
            if (f.esquinas) setEsquinas(f.esquinas as Esq);
            setLugares(f.lugares);
            setActiva(f.activa);
            setAprendida(f.aprendida);
        }).catch(() => { });
    }, [deviceId]);

    const conCarga = useCallback(async (que: Ocupado, fn: () => Promise<void>) => {
        setOcupado(que); setAviso(null);
        try { await fn(); } finally { setOcupado(""); }
    }, []);

    const tomar = useCallback(() => conCarga("tomando", async () => {
        const r = await tomarCuadro(deviceId);
        setMedicion(r);
        if (!r.ok && r.error) setAviso(r.error);
    }), [conCarga, deviceId]);

    const guardar = useCallback(() => conCarga("guardando", async () => {
        const r = await guardarFranja(deviceId, { esquinas, lugares, activa });
        setExiste(true);
        setAprendida(r.aprendida);
        if (r.reaprender && !r.aprendida) {
            setAviso("La franja cambió de forma, así que hay que volver a enseñarle cómo se ve vacía.");
        }
    }), [conCarga, deviceId, esquinas, lugares, activa]);

    const aprender = useCallback(() => conCarga("aprendiendo", async () => {
        const r = await aprenderVacio(deviceId);
        setMedicion(r);
        if (r.ok) setAprendida(r.aprendida ?? null);
        else setAviso(r.error || "No se pudo.");
    }), [conCarga, deviceId]);

    const medir = useCallback(() => conCarga("midiendo", async () => {
        const r = await medirFranja(deviceId);
        setMedicion(r);
        if (!r.ok) setAviso(r.error || "No se pudo.");
    }), [conCarga, deviceId]);

    const quitar = useCallback(async () => {
        await borrarFranja(deviceId);
        setExiste(false); setAprendida(null); setMedicion(null);
    }, [deviceId]);

    const celdas = useMemo(
        () => Array.from({ length: lugares }, (_, i) => celdaDe(esquinas, i, lugares)),
        [esquinas, lugares],
    );

    const estados = medicion?.ok ? medicion.celdas : undefined;

    return {
        esquinas, setEsquinas, lugares, setLugares, activa, setActiva,
        existe, aprendida, medicion, ocupado, aviso, setAviso,
        celdas, estados, hayRtsp,
        tomar, guardar, aprender, medir, quitar,
    };
}

export type Franja = ReturnType<typeof useFranja>;
