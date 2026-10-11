"use client";

import { useEffect, useState } from "react";
import { ShieldAlert } from "lucide-react";

/**
 * El overlay de un canal en alarma. UNA pieza para el monitor del panel y para la vista de
 * pantalla del centro de monitoreo.
 *
 * Dos estados y un solo tratamiento: pendiente (hay eventos sin aceptar) y confirmada (el
 * operador dijo que es real y nadie la resolvió). El canal entero se tiñe con el degradé
 * rojo que se mueve y respira (`.intr-conf*` en globals.css), el rótulo late en el centro
 * —DETECTADA o CONFIRMADA, que es lo único que cambia— y debajo va lo que el padre quiera
 * poner como acción: el panel pasa el botón "Ver evento"; una pantalla de pared no pasa
 * nada, porque desde ahí no se actúa.
 *
 * Se extrajo del monitor el 7/10 para que la pared y el panel no puedan desincronizarse:
 * si mañana cambia el texto o el color de una alarma, cambia en los dos lugares.
 */
export type EstadoCanalEnAlarma = "pendiente" | "confirmada";

export function hace(ts: string | number | Date): string {
    const s = Math.max(0, Math.floor((Date.now() - new Date(ts).getTime()) / 1000));
    if (s < 60) return `hace ${s} s`;
    const m = Math.floor(s / 60); if (m < 60) return `hace ${m} min`;
    const h = Math.floor(m / 60); if (h < 24) return `hace ${h} h`;
    return new Date(ts).toLocaleDateString("es-UY", { day: "2-digit", month: "2-digit" });
}

export function CanalEnAlarma({ estado, tipo, desde, camara, eventos = 1, accion, escala = "panel" }: {
    estado: EstadoCanalEnAlarma;
    /** Qué se detectó: "Cruce de línea", "Intrusión"… */
    tipo: string;
    /** Cuándo fue el evento más reciente; el "hace cuánto" se actualiza solo cada segundo. */
    desde?: string | null;
    /** La línea con cámara · NVR · canal. */
    camara: string;
    /** Cuántos eventos hay apilados (pendiente). */
    eventos?: number;
    /** El panel pone acá el botón "Ver evento"; una pantalla de pared no pone nada. */
    accion?: React.ReactNode;
    /** `pared` agranda todo para leerse a 3–4 metros. */
    escala?: "panel" | "pared";
}) {
    const [, tick] = useState(0);
    useEffect(() => { if (!desde) return; const iv = setInterval(() => tick((x) => x + 1), 1000); return () => clearInterval(iv); }, [desde]);
    const pared = escala === "pared";
    return (
        <div className="absolute inset-0 z-[41] rounded-2xl overflow-hidden pointer-events-none">
            <div className="intr-conf" />
            <div className="intr-conf-borde" />
            <div className={pared ? "absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center" : "absolute inset-0 flex flex-col items-center justify-center gap-2 p-3 text-center"}>
                <span className={pared
                    ? "inline-flex items-center gap-2 px-3 py-1 rounded-full bg-black/35 backdrop-blur-sm text-red-100 text-[14px] font-extrabold uppercase tracking-[0.18em]"
                    : "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-black/35 backdrop-blur-sm text-red-100 text-[9px] font-extrabold uppercase tracking-[0.18em]"}>
                    <ShieldAlert size={pared ? 16 : 10} /> {tipo}{desde ? ` · ${hace(desde)}` : ""}{estado === "pendiente" && eventos > 1 ? ` · ${eventos} eventos` : ""}
                </span>
                <div className={pared
                    ? "intr-conf-rotulo text-white font-black uppercase leading-none tracking-[0.12em] text-[clamp(28px,3.6vw,64px)] drop-shadow-lg"
                    : "intr-conf-rotulo text-white font-black uppercase leading-none tracking-[0.12em] text-[clamp(14px,2.1vw,24px)] drop-shadow-lg"}>
                    {estado === "pendiente" ? "Intrusión detectada" : "Intrusión confirmada"}
                </div>
                <div className={pared ? "text-[18px] font-semibold text-white/85 drop-shadow truncate max-w-full" : "text-[10.5px] font-semibold text-white/85 drop-shadow truncate max-w-full"}>
                    {camara}
                    <span className="text-white/60"> · {estado === "pendiente" ? "sin confirmar" : "sin resolver"}</span>
                </div>
                {accion && <div className="pointer-events-auto mt-1">{accion}</div>}
            </div>
        </div>
    );
}
