"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2 } from "lucide-react";
import { LiveModal } from "@/components/intrusion/LiveModal";
import type { IntrusionCam } from "@/app/actions/detections";

/**
 * Ver la grabación de un evento: el visor de vivo, grabación y evidencias, abierto en
 * Grabación y parado en el instante del evento.
 *
 * Había dos visores. El viejo (NvrTimeMachine) se abría desde el monitor LPR, la ficha del
 * evento, el visor de accesos y AcuSeek; el nuevo (LiveModal) desde el monitor de
 * intrusión y el mapa. Dos maneras de ver lo mismo, con controles distintos y una sola de
 * las dos con evidencias y vivo. Quedó uno: todo lo que pide "ver grabación" pasa por acá.
 *
 * Recibe lo que el que llama ya sepa (canal y NVR) para no preguntarlo otra vez; si no lo
 * sabe, lo pide una vez y lo guarda para la próxima.
 */

type Canal = { ch: number | null; nvr: string | null };
const canales = new Map<string, Promise<Canal>>();
export function canalDe(deviceId: string): Promise<Canal> {
    if (!canales.has(deviceId)) {
        canales.set(deviceId, fetch(`/api/nvr/channel?deviceId=${deviceId}`, { cache: "no-store" })
            .then((r) => r.json())
            .then((d) => ({ ch: d?.channel != null ? Number(d.channel) : null, nvr: d?.nvr ? String(d.nvr) : null }))
            .catch(() => { canales.delete(deviceId); return { ch: null, nvr: null }; }));
    }
    return canales.get(deviceId)!;
}

export function VerGrabacion({ deviceId, nombre, instanteMs, canal, nvrId, onClose }: {
    deviceId: string;
    nombre?: string | null;
    /** El instante del evento: la grabación arranca ahí (menos los segundos "antes" de Ajustes). */
    instanteMs: number;
    canal?: number | null;
    nvrId?: string | null;
    onClose: () => void;
}) {
    const [c, setC] = useState<Canal | null>(canal != null && nvrId ? { ch: canal, nvr: nvrId } : null);
    useEffect(() => {
        if (c) return;
        let vivo = true;
        canalDe(deviceId).then((x) => { if (vivo) setC({ ch: canal ?? x.ch, nvr: nvrId || x.nvr }); });
        return () => { vivo = false; };
    }, [deviceId]); // eslint-disable-line react-hooks/exhaustive-deps

    // Escape cierra ESTE visor y nada más: sin esto, el visor del evento que quedó debajo
    // también escuchaba la tecla y se cerraba junto.
    useEffect(() => {
        const alTeclear = (e: KeyboardEvent) => { if (e.key !== "Escape") return; e.preventDefault(); e.stopImmediatePropagation(); onClose(); };
        window.addEventListener("keydown", alTeclear, true);
        return () => window.removeEventListener("keydown", alTeclear, true);
    }, [onClose]);

    if (typeof document === "undefined") return null;
    const cam: IntrusionCam | null = c ? { id: deviceId, name: nombre || "Cámara", brand: "", ip: "", nvrName: null, nvrId: c.nvr, ch: c.ch } : null;
    /* Fuera del árbol y por encima de los paneles: se abre desde el visor del evento (z 3400) y
       desde fichas en diálogo. Con `pointer-events-auto` porque un diálogo modal abierto le
       quita los clics a todo lo que está fuera de él. */
    return createPortal(
        <div className="fixed inset-0 z-[calc(var(--capa-panel)+600)] pointer-events-auto">
            {cam ? <LiveModal cam={cam} initialTab="rec" initialRecMs={instanteMs} onClose={onClose} /> : (
                <div className="absolute inset-0 bg-black/80 grid place-items-center text-white/80" onClick={onClose}>
                    <span className="flex items-center gap-2 text-[13px] font-semibold"><Loader2 size={16} className="animate-spin" /> Ubicando la grabación…</span>
                </div>
            )}
        </div>,
        document.body,
    );
}
