"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTiempoReal } from "@/lib/tiempo-real";
import { ackAlarms, getActiveAlarms, getAttendingIds, marcarDeteccion, reclasificarComoFalsa, setAttending, type ActiveAlarm } from "@/app/actions/detections";

/**
 * Las alarmas de intrusión y lo que se puede hacer con ellas, para cualquier pantalla del panel.
 *
 * Hasta el 9/10 sólo el monitor de intrusión sabía confirmar, marcar falsa o resolver: en el
 * monitor LPR la ficha de una detección se abría sin un solo botón, y una intrusión confirmada
 * había que ir a cerrarla a otra pantalla. Esto junta el estado (pendientes por cámara y
 * cámaras en atención) y las acciones, con la misma semántica que el monitor de intrusión:
 *
 *  · resolver(cámara, "real" | "false"): acepta lo pendiente de esa cámara. Real la deja
 *    "en atención" hasta que alguien la cierre.
 *  · cerrarAtencion(cámara, "resuelta" | "falsa"): cierra la atención; falsa además corrige el
 *    registro de las últimas 6 h.
 *  · marcar(detección, "real" | "false"): corrige UNA detección ya mirada.
 *
 * Los cambios se ven al instante (optimista) y se reconfirman contra la base.
 */
/** Cada cuánto se relee, por si se resolvió desde otra pantalla. */
const RELEER_MS = 30_000;

export type AlarmasIntrusion = ReturnType<typeof usarAlarmasIntrusion>;

export function usarAlarmasIntrusion() {
    const [pendientes, setPendientes] = useState<ActiveAlarm[]>([]);
    const [atencion, setAtencion] = useState<Set<string>>(() => new Set());
    const [ocupado, setOcupado] = useState<string | null>(null);
    const [version, setVersion] = useState(0);

    const releer = useCallback(() => {
        getActiveAlarms().then(setPendientes).catch(() => { });
        getAttendingIds().then((ids) => setAtencion(new Set(ids))).catch(() => { });
    }, []);
    useEffect(() => { releer(); const iv = setInterval(releer, RELEER_MS); return () => clearInterval(iv); }, [releer]);
    useTiempoReal<any>("general_detection", (d) => {
        if (!d?.id || !d.deviceId || d.type === "MOTION") return;
        setPendientes((p) => (p.some((a) => a.id === d.id) ? p : [{ id: d.id, deviceId: d.deviceId, type: d.type, ts: d.timestamp || new Date().toISOString() }, ...p]));
    });

    const porCamara = useMemo(() => {
        const m = new Map<string, ActiveAlarm[]>();
        for (const a of pendientes) m.set(a.deviceId, [...(m.get(a.deviceId) || []), a]);
        return m;
    }, [pendientes]);

    /** Algo cambió en la base: quien muestre detecciones con estado puede volver a pedirlas. */
    const cambio = () => setVersion((v) => v + 1);

    const resolver = useCallback(async (deviceId: string, kind: "real" | "false") => {
        setOcupado(deviceId);
        setPendientes((p) => p.filter((a) => a.deviceId !== deviceId));
        if (kind === "real") setAtencion((s) => new Set(s).add(deviceId));
        try {
            await ackAlarms(deviceId, kind);
            if (kind === "real") await setAttending(deviceId, true);
        } finally { setOcupado(null); cambio(); releer(); }
    }, [releer]);

    const cerrarAtencion = useCallback(async (deviceId: string, como: "resuelta" | "falsa") => {
        setOcupado(deviceId);
        setAtencion((s) => { const n = new Set(s); n.delete(deviceId); return n; });
        try {
            await setAttending(deviceId, false);
            if (como === "falsa") await reclasificarComoFalsa(deviceId);
        } finally { setOcupado(null); cambio(); releer(); }
    }, [releer]);

    const marcar = useCallback(async (id: string, kind: "real" | "false") => {
        setOcupado(id);
        try { return await marcarDeteccion(id, kind); } finally { setOcupado(null); cambio(); }
    }, []);

    return {
        pendientes, porCamara, atencion, ocupado, version,
        tieneAlarma: (deviceId?: string | null) => !!deviceId && porCamara.has(deviceId),
        enAtencion: (deviceId?: string | null) => !!deviceId && atencion.has(deviceId),
        resolver, cerrarAtencion, marcar, releer,
    };
}
