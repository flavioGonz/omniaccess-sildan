"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2 } from "lucide-react";
import { LiveModal, type EvidenciaLpr } from "@/components/intrusion/LiveModal";

/**
 * Ver la grabación de un evento: el visor de vivo, grabación y evidencias, abierto en
 * Grabación y parado en el instante del evento (de san-nicolas 3781426 / 6495b6f).
 *
 * Había dos visores: el time machine (monitor LPR, ficha del evento, AcuSeek) y el LiveModal
 * (monitor de intrusión, mapa). Quedó uno. Si quien llama ya sabe canal y NVR, se usan de
 * entrada; si no, se piden una vez y quedan en caché para la próxima.
 */
type Canal = { ch: number | null; nvr: string | null };
const canales = new Map<string, Promise<Canal>>();
const resueltos = new Map<string, Canal>();
export function canalDe(deviceId: string): Promise<Canal> {
    if (!canales.has(deviceId)) {
        canales.set(deviceId, fetch(`/api/nvr/channel?deviceId=${deviceId}`, { cache: "no-store" })
            .then((r) => r.json())
            .then((d) => { const c = { ch: d?.channel != null ? Number(d.channel) : null, nvr: d?.nvr ? String(d.nvr) : null }; resueltos.set(deviceId, c); return c; })
            .catch(() => { canales.delete(deviceId); return { ch: null, nvr: null }; }));
    }
    return canales.get(deviceId)!;
}

export function VerGrabacion({ deviceId, nombre, instanteMs, canal, nvrId, evidencia, onClose }: {
    deviceId: string;
    nombre?: string | null;
    instanteMs: number;
    canal?: number | null;
    nvrId?: string | null;
    /** La lectura LPR que abrió el visor: va primera en la pestaña Evidencia. */
    evidencia?: EvidenciaLpr | null;
    onClose: () => void;
}) {
    const [c, setC] = useState<Canal | null>(() => {
        if (canal != null && nvrId) return { ch: canal, nvr: nvrId };
        const r = resueltos.get(deviceId);
        return r ? { ch: canal ?? r.ch, nvr: nvrId || r.nvr } : null;
    });
    useEffect(() => {
        if (c) return;
        let vivo = true;
        canalDe(deviceId).then((x) => { if (vivo) setC({ ch: canal ?? x.ch, nvr: nvrId || x.nvr }); });
        return () => { vivo = false; };
    }, [deviceId]); // eslint-disable-line react-hooks/exhaustive-deps

    // Escape cierra ESTE visor y nada más (no la ficha que quedó debajo).
    useEffect(() => {
        const alTeclear = (e: KeyboardEvent) => { if (e.key !== "Escape") return; e.preventDefault(); e.stopImmediatePropagation(); onClose(); };
        window.addEventListener("keydown", alTeclear, true);
        return () => window.removeEventListener("keydown", alTeclear, true);
    }, [onClose]);

    if (typeof document === "undefined") return null;
    const cam: any = c ? { id: deviceId, name: nombre || "Cámara", brand: "", ip: "", nvrName: null, nvrId: c.nvr, ch: c.ch, alarmOk: false } : null;
    return createPortal(
        <div className="fixed inset-0 z-[3300] pointer-events-auto">
            {cam ? <LiveModal cam={cam} initialTab="rec" initialRecMs={instanteMs} onClose={onClose} lpr={!!evidencia} evidenciaLpr={evidencia || null} /> : (
                <div className="absolute inset-0 bg-black/80 grid place-items-center text-white/80" onClick={onClose}>
                    <span className="flex items-center gap-2 text-[13px] font-semibold"><Loader2 size={16} className="animate-spin" /> Ubicando la grabación…</span>
                </div>
            )}
        </div>,
        document.body,
    );
}
