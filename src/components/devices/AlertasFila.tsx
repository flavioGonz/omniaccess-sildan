"use client";

import { WifiOff, HardDrive, MemoryStick, Clock, AlertTriangle, ImageOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { PREFIJOS_ALERTA } from "@/lib/usuarios-equipo/inventario";

/**
 * Las alertas de un equipo, como UN indicador en la columna de estado: un triángulo con cuántas hay,
 * en ámbar o en rojo si alguna es crítica. El detalle (qué y desde cuándo) va en el tooltip global de
 * la página (data-tooltip-id="tt-alertas"); tocarlo abre el historial de salud.
 *
 * Antes era un chip por alerta debajo del nombre, y el nombre se ponía en rojo (29/10, Nico: «me
 * quedan raras chips por todos lados»): con dos o tres alertas la fila crecía, se leía como un
 * cartel y competía con lo que la fila dice del equipo. Lo que hay que saber de un vistazo es SI
 * hay algo y qué tan grave; el qué se lee cuando se lo busca.
 *
 * Las de cuentas locales (cuenta no gestionada, acceso desconocido) no van acá: viven en el cajón
 * «Cuentas de los equipos», que es donde se resuelven.
 */
export type AlertaEquipo = { id: string; deviceId: string; type: string; severity: string; message: string; openedAt?: string };

const TIPO: Record<string, { t: string; I: any }> = {
    offline: { t: "Sin respuesta", I: WifiOff },
    disk: { t: "Disco", I: HardDrive },
    mem: { t: "Memoria", I: MemoryStick },
    drift: { t: "Hora corrida", I: Clock },
    imagen: { t: "Imagen", I: ImageOff },
};
const tipoDe = (type: string) => TIPO[type] || { t: "Alerta", I: AlertTriangle };

/** Las alertas que se muestran en la fila: todas menos las de cuentas locales. */
export const alertasDeFila = (alertas?: AlertaEquipo[]) => (alertas || []).filter((a) => !PREFIJOS_ALERTA.some((p) => a.type.startsWith(p)));

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function AlertasFila({ alertas, onVer, className }: { alertas?: AlertaEquipo[]; onVer?: () => void; className?: string }) {
    const lista = alertasDeFila(alertas);
    if (!lista.length) return null;
    const critica = lista.some((a) => a.severity === "critical");
    const desde = (a: AlertaEquipo) => a.openedAt ? ` · desde ${new Date(a.openedAt).toLocaleString("es-UY", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}` : "";
    const html = lista.map((a) => `<b>${esc(tipoDe(a.type).t)}</b>${esc(desde(a))}<br/><span style="opacity:.8">${esc(a.message)}</span>`).join("<br/><br/>")
        + `<br/><br/><span style="opacity:.6">Tocá para ver el historial de salud.</span>`;
    const I = lista.length === 1 ? tipoDe(lista[0].type).I : AlertTriangle;
    return (
        <button type="button" onClick={(e) => { e.stopPropagation(); onVer?.(); }} data-no-fila
            data-tooltip-id="tt-alertas" data-tooltip-html={html} aria-label={`${lista.length} ${lista.length === 1 ? "alerta" : "alertas"}`}
            className={cn("h-6 min-w-6 px-1.5 rounded-md border inline-flex items-center justify-center gap-1 text-[10.5px] font-bold tabular-nums transition-colors",
                critica ? "chip-mal" : "chip-aviso", className)}>
            <I size={12} />{lista.length > 1 && lista.length}
        </button>
    );
}
