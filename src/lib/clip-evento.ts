"use client";

import { useEffect, useState } from "react";

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
export const CLIP_ANTES_S = 4;
export const CLIP_DESPUES_S = 1;
const CLIP_ESPERA_MS = 1200;
const CLAVE_CLIP = "ficha-deteccion:clip";
const clipsHechos = new Map<string, string>();

export type EstadoClip = { estado: "nada" | "cargando" | "listo" | "sin"; url?: string; motivo?: string };

export function useClipEvento({ id, deviceId, instante, nvrId, ch, activo = true }: {
    id: string | null | undefined; deviceId: string | null | undefined; instante: string | number | Date | null | undefined;
    nvrId?: string | null; ch?: number | null;
    /** Falso cuando no corresponde pedirlo (un evento en vivo sin id real, una vista sin video). */
    activo?: boolean;
}) {
    const [clipOn, setClipOn] = useState(true);
    useEffect(() => { try { const v = localStorage.getItem(CLAVE_CLIP); if (v != null) setClipOn(v === "1"); } catch { } }, []);
    const cambiarClip = (v: boolean) => { setClipOn(v); try { localStorage.setItem(CLAVE_CLIP, v ? "1" : "0"); } catch { } };
    const [clip, setClip] = useState<EstadoClip>({ estado: "nada" });
    const [clipVisible, setClipVisible] = useState(false);
    const ms = instante == null ? NaN : new Date(instante).getTime();

    useEffect(() => {
        setClip({ estado: "nada" }); setClipVisible(false);
        if (!clipOn || !activo || !id || !deviceId || !Number.isFinite(ms)) return;
        const hecho = clipsHechos.get(id);
        if (hecho) { setClip({ estado: "listo", url: hecho }); return; }
        let vigente = true;
        const t = setTimeout(async () => {
            setClip({ estado: "cargando" });
            try {
                const r = await fetch("/api/clip/instante", {
                    method: "POST", headers: { "content-type": "application/json" },
                    body: JSON.stringify({ deviceId, instante: ms, antes: CLIP_ANTES_S, despues: CLIP_DESPUES_S, para: "alerta", nvrId: nvrId ?? null, ch: ch ?? null }),
                });
                const j = await r.json().catch(() => ({}));
                if (j?.ok && j.url) clipsHechos.set(id, j.url);
                if (vigente) setClip(j?.ok && j.url ? { estado: "listo", url: j.url } : { estado: "sin", motivo: j?.motivo || `el servidor respondió ${r.status}` });
            } catch { if (vigente) setClip({ estado: "sin", motivo: "no se pudo pedir" }); }
        }, CLIP_ESPERA_MS);
        return () => { vigente = false; clearTimeout(t); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [id, clipOn, activo]);

    return { clipOn, cambiarClip, clip, clipVisible, setClipVisible };
}
