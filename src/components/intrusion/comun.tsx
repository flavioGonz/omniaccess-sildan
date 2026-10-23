"use client";

import { Radar, ShieldAlert, Activity, LogIn, LogOut, Siren } from "lucide-react";
import { cn } from "@/lib/utils";
import { lineasDe, zonasDe, tieneGeom } from "@/lib/geom-intrusion";

/**
 * Lo que comparten el monitor de intrusión del panel y la vista de pantalla: cómo se llama y
 * se dibuja cada tipo de detección, y la línea/zona dibujadas sobre el cuadro. Salió de
 * `admin/monitor-intrusion/page.tsx` el 7/10 para que la pared no tenga su propia copia.
 */
/** `lines` / `fields`: todas las prendidas (hasta 4 de cada una, 23/10); `line` / `field`, la primera. */
export type Geom = { line: { x: number; y: number }[]; field: { x: number; y: number }[]; lines?: { x: number; y: number }[][]; fields?: { x: number; y: number }[][] };

export const META_DETECCION: Record<string, { label: string; cls: string; ring: string; dot: string; Icon: any }> = {
    LINECROSS: { label: "Cruce de línea", cls: "text-red-300 border-red-500/40 bg-red-500/10", ring: "ring-red-500", dot: "bg-red-500", Icon: Radar },
    INTRUSION: { label: "Intrusión", cls: "text-red-300 border-red-500/40 bg-red-500/10", ring: "ring-red-500", dot: "bg-red-500", Icon: ShieldAlert },
    REGION_ENTER: { label: "Entra a zona", cls: "text-amber-300 border-amber-500/40 bg-amber-500/10", ring: "ring-amber-500", dot: "bg-amber-500", Icon: LogIn },
    REGION_EXIT: { label: "Sale de zona", cls: "text-amber-300 border-amber-500/40 bg-amber-500/10", ring: "ring-amber-500", dot: "bg-amber-500", Icon: LogOut },
    MOTION: { label: "Movimiento", cls: "text-sky-300 border-sky-500/40 bg-sky-500/10", ring: "ring-sky-500", dot: "bg-sky-500", Icon: Activity },
    // Alarm Hub (21/10): la alarma de una central (robo, pánico, incendio…), por SIA DC-09.
    CENTRAL: { label: "Central de alarma", cls: "text-red-300 border-red-500/40 bg-red-500/10", ring: "ring-red-500", dot: "bg-red-500", Icon: Siren },
    OTHER: { label: "Evento", cls: "text-slate-300 border-slate-500/40 bg-slate-500/10", ring: "ring-slate-500", dot: "bg-slate-500", Icon: Activity },
};
export const metaDe = (tipo: string | null | undefined) => META_DETECCION[tipo || ""] || META_DETECCION.OTHER;

export function GeomOverlay({ geom, alert }: { geom?: Geom | null; alert?: boolean }) {
    if (!tieneGeom(geom)) return null;
    const lineC = alert ? "#f87171" : "#38bdf8";
    const zoneStroke = alert ? "#ef4444" : "#f43f5e";
    const zoneFill = alert ? "rgba(239,68,68,0.30)" : "rgba(244,63,94,0.16)";
    return (
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className={cn("absolute inset-0 w-full h-full pointer-events-none", alert && "animate-pulse")}>
            {alert && (
                <defs><filter id="detglow" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="1.1" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter></defs>
            )}
            {zonasDe(geom).map((z, i) => (
                <polygon key={`z${i}`} points={z.map((p) => `${p.x},${p.y}`).join(" ")} fill={zoneFill} stroke={zoneStroke} strokeWidth={alert ? 2.2 : 1.4} strokeLinejoin="round" vectorEffect="non-scaling-stroke" filter={alert ? "url(#detglow)" : undefined} />
            ))}
            {lineasDe(geom).map((l, i) => (
                <line key={`l${i}`} x1={l[0].x} y1={l[0].y} x2={l[1].x} y2={l[1].y} stroke={lineC} strokeWidth={alert ? 3 : 2} strokeLinecap="round" vectorEffect="non-scaling-stroke" filter={alert ? "url(#detglow)" : undefined} />
            ))}
        </svg>
    );
}
