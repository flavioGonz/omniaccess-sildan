"use client";

import { useEffect, useState } from "react";
import { FICHA_ANTES_POR_DEFECTO, FICHA_DESPUES_POR_DEFECTO } from "@/lib/clips";

/*
 * El clip en loop de un evento: los segundos de antes de la foto, sacados del grabador
 * (/api/clip/instante, 480p, sin audio). La foto dice QUÉ había; los segundos de antes dicen CÓMO
 * llegó, que es lo que separa a alguien que salta el cerco de un vecino que pasa caminando.
 *
 * Vivía adentro de la ficha (16/10). El 17/10 lo pidió también el panel de la detección elegida
 * en el Monitor de Intrusión («debe cargar el video del evento mientras presenta la foto»), así
 * que salió acá: un solo cálculo, una sola preferencia (C prende/apaga en los dos lados) y un solo
 * caché — el clip que trajo el panel lo reusa la ficha al abrirse, sin pedirle otro corte al NVR.
 *
 * Se pide recién después de CLIP_ESPERA_MS en el mismo evento: bajar por la lista con el teclado
 * no le pide un corte al grabador por cada fila. El servidor guarda el archivo 10 min.
 */
export const CLIP_ANTES_S = FICHA_ANTES_POR_DEFECTO;
export const CLIP_DESPUES_S = FICHA_DESPUES_POR_DEFECTO;
const CLIP_ESPERA_MS = 1200;

/**
 * Cuánto antes y después trae el clip: Ajustes → Video del evento → «Al abrir la ficha» (20/10).
 * Se pregunta una vez por pestaña; mientras no llega se usa lo de siempre (4 / 1), así la ficha
 * no espera a Ajustes para pedir el video.
 */
export type VentanaFicha = { antes: number; despues: number };
let ventanaFicha: VentanaFicha = { antes: CLIP_ANTES_S, despues: CLIP_DESPUES_S };
let pedidaVentana: Promise<VentanaFicha> | null = null;
function leerVentanaFicha(): Promise<VentanaFicha> {
    if (!pedidaVentana) pedidaVentana = fetch("/api/playback/ventana", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => { if (j?.ficha && typeof j.ficha.antes === "number") ventanaFicha = { antes: j.ficha.antes, despues: j.ficha.despues }; return ventanaFicha; })
        .catch(() => ventanaFicha);
    return pedidaVentana;
}
/*
 * Cambiar la ventana desde la ficha (21/10, ver components/video/AjusteVideoFicha): se guarda en el
 * servidor y se avisa a todas las fichas abiertas en la pestaña, que vuelven a pedir su clip con
 * la ventana nueva (la clave del caché la lleva).
 */
const oyentes = new Set<(v: VentanaFicha) => void>();
export function ventanaFichaActual(): VentanaFicha { return ventanaFicha; }
export function useVentanaFicha(): VentanaFicha {
    const [v, setV] = useState<VentanaFicha>(ventanaFicha);
    useEffect(() => {
        let vivo = true;
        leerVentanaFicha().then((x) => { if (vivo) setV(x); });
        oyentes.add(setV);
        return () => { vivo = false; oyentes.delete(setV); };
    }, []);
    return v;
}
export async function guardarVentanaFicha(v: VentanaFicha): Promise<VentanaFicha> {
    const r = await fetch("/api/playback/ventana", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ ficha: v }) });
    const j = await r.json().catch(() => null);
    if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
    ventanaFicha = { antes: j.ficha.antes, despues: j.ficha.despues };
    pedidaVentana = Promise.resolve(ventanaFicha);
    for (const f of oyentes) f(ventanaFicha);
    return ventanaFicha;
}
const CLAVE_CLIP = "ficha-deteccion:clip";
const clipsHechos = new Map<string, string>();

export type EstadoClip = { estado: "nada" | "cargando" | "listo" | "sin"; url?: string; motivo?: string };

export function useClipEvento({ id, deviceId, instante, nvrId, ch, activo = true, propia }: {
    id: string | null | undefined; deviceId: string | null | undefined; instante: string | number | Date | null | undefined;
    nvrId?: string | null; ch?: number | null;
    /**
     * Una ventana propia del evento, en vez de la de Ajustes: la permanencia trae la maniobra de
     * estacionar (de la llegada a cuando quedó quieto), que no es «N s antes de la foto».
     */
    propia?: { instante: number; antes: number; despues: number; motivo: string } | null;
    /** Falso cuando no corresponde pedirlo (un evento en vivo sin id real, una vista sin video). */
    activo?: boolean;
}) {
    const [clipOn, setClipOn] = useState(true);
    useEffect(() => { try { const v = localStorage.getItem(CLAVE_CLIP); if (v != null) setClipOn(v === "1"); } catch { } }, []);
    const cambiarClip = (v: boolean) => { setClipOn(v); try { localStorage.setItem(CLAVE_CLIP, v ? "1" : "0"); } catch { } };
    const [clip, setClip] = useState<EstadoClip>({ estado: "nada" });
    const [clipVisible, setClipVisible] = useState(false);
    const general = useVentanaFicha();
    const ventana: VentanaFicha = propia ? { antes: propia.antes, despues: propia.despues } : general;
    const ms = propia ? propia.instante : instante == null ? NaN : new Date(instante).getTime();

    useEffect(() => {
        setClip({ estado: "nada" }); setClipVisible(false);
        if (!clipOn || !activo || !id || !deviceId || !Number.isFinite(ms)) return;
        // La clave lleva la ventana: si se cambió en Ajustes, no se reusa el corte viejo.
        const clave = `${id}:${ms}:${ventana.antes}:${ventana.despues}`;
        const hecho = clipsHechos.get(clave);
        if (hecho) { setClip({ estado: "listo", url: hecho }); return; }
        let vigente = true;
        const t = setTimeout(async () => {
            setClip({ estado: "cargando" });
            try {
                const r = await fetch("/api/clip/instante", {
                    method: "POST", headers: { "content-type": "application/json" },
                    body: JSON.stringify({ deviceId, instante: ms, antes: ventana.antes, despues: ventana.despues, para: "alerta", nvrId: nvrId ?? null, ch: ch ?? null }),
                });
                const j = await r.json().catch(() => ({}));
                if (j?.ok && j.url) clipsHechos.set(clave, j.url);
                if (vigente) setClip(j?.ok && j.url ? { estado: "listo", url: j.url } : { estado: "sin", motivo: j?.motivo || `el servidor respondió ${r.status}` });
            } catch { if (vigente) setClip({ estado: "sin", motivo: "no se pudo pedir" }); }
        }, CLIP_ESPERA_MS);
        return () => { vigente = false; clearTimeout(t); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [id, clipOn, activo, ventana.antes, ventana.despues, ms]);

    return { clipOn, cambiarClip, clip, clipVisible, setClipVisible, ventana, propia: propia || null };
}
