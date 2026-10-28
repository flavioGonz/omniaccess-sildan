"use client";

import { WifiOff, HardDrive, MemoryStick, Clock, AlertTriangle, UserX, Globe } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Las alertas de un equipo, en su propia fila (en vez de un cartel arriba de la tabla).
 * Un badge por falla con su ícono; el detalle va en el tooltip (react-tooltip global de la
 * página: data-tooltip-id="tt-alertas"). Tocar un badge abre el historial de salud.
 */
export type AlertaEquipo = { id: string; deviceId: string; type: string; severity: string; message: string; openedAt?: string };

const TIPO: Record<string, { t: string; I: any }> = {
    offline: { t: "Sin respuesta", I: WifiOff },
    disk: { t: "Disco", I: HardDrive },
    mem: { t: "Memoria", I: MemoryStick },
    drift: { t: "Hora corrida", I: Clock },
};
/** Las de usuarios de los equipos llevan el nombre de la cuenta en el tipo (una alerta por cuenta). */
const tipoDe = (type: string) => TIPO[type]
    || (type.startsWith("cuenta-no-gestionada:") ? { t: "Cuenta no gestionada", I: UserX } : null)
    || (type.startsWith("sesion-desconocida:") ? { t: "Acceso desconocido", I: Globe } : null)
    || { t: "Alerta", I: AlertTriangle };

export function claseNombreConAlerta(alertas?: AlertaEquipo[]) {
    if (!alertas?.length) return "";
    return alertas.some((a) => a.severity === "critical") ? "!text-red-500" : "!text-red-400";
}

export function AlertasFila({ alertas, onVer }: { alertas?: AlertaEquipo[]; onVer?: () => void }) {
    if (!alertas?.length) return null;
    const desde = (a: AlertaEquipo) => a.openedAt ? ` · desde ${new Date(a.openedAt).toLocaleString("es-UY", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}` : "";
    return (
        <span className="flex flex-wrap items-center gap-1 mt-1">
            {alertas.map((a) => {
                const m = tipoDe(a.type);
                const critica = a.severity === "critical";
                return (
                    <button key={a.id} type="button" onClick={(e) => { e.stopPropagation(); onVer?.(); }}
                        data-tooltip-id="tt-alertas" data-tooltip-content={`${a.message}${desde(a)}. Tocá para ver el historial de salud.`}
                        className={cn("inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border text-[9px] font-bold uppercase tracking-wide transition-colors",
                            critica ? "bg-red-500/15 text-red-500 border-red-500/35 hover:bg-red-500/25" : "bg-amber-500/12 text-amber-500 border-amber-500/30 hover:bg-amber-500/20")}>
                        <m.I size={10} className={cn(critica && "animate-pulse")} /> {m.t}
                    </button>
                );
            })}
        </span>
    );
}
