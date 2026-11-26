"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, AlertTriangle, Minus, HelpCircle, Crosshair, Wrench, RefreshCw, ShieldAlert, ShieldCheck } from "lucide-react";
import { Girando as Loader2 } from "@/components/brand/CargaOmni";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { sileo as toast } from "sileo";
import type { EstadoIntrusion as Estado, Paso } from "@/lib/intrusion-estado";

/**
 * Lo que la cámara de intrusión tiene HOY y si un aviso puede llegar (26/11). Nico: «¿distingue
 * si la cámara tiene las reglas dibujadas, no sólo si sabe?», «¿qué pasa si está en modo avisa y
 * no tiene servidor de alarma? Nunca se entera OmniAccess».
 *
 * La ficha mostraba qué SABE hacer la cámara y qué modo se eligió; lo dibujado sólo se veía
 * abriendo el calibrador, y nada decía si la cadena estaba entera. Ahora se lee en vivo (sólo
 * lectura) y se muestra eslabón por eslabón, con el primero roto marcado y el arreglo al lado.
 * Arreglar escribe en la cámara: agrega, no borra (lib/intrusion-estado).
 */

export function useEstadoIntrusion(deviceId: string | null) {
    const [estado, setEstado] = useState<Estado | null>(null);
    const [cargando, setCargando] = useState(false);
    const [arreglando, setArreglando] = useState(false);
    const recargar = useCallback(async () => {
        if (!deviceId) return;
        setCargando(true);
        try { setEstado(await fetch(`/api/devices/intrusion-estado?deviceId=${encodeURIComponent(deviceId)}`, { cache: "no-store" }).then((r) => r.json())); }
        catch { setEstado((e) => e ? { ...e, ok: false, error: "Sin conexión con el servidor." } : null); }
        finally { setCargando(false); }
    }, [deviceId]);
    useEffect(() => { setEstado(null); if (deviceId) { const t = setTimeout(recargar, 0); return () => clearTimeout(t); } }, [deviceId, recargar]);
    /** Arreglar lo que falte de `que` (o todo lo arreglable). Devuelve si quedó sin errores. */
    const arreglar = useCallback(async (que?: ("servidor" | "centro")[], callado = false): Promise<boolean> => {
        if (!deviceId) return false;
        const pedir = que || (estado?.pasos || []).filter((p) => p.estado === "falta" && (p.arreglo === "servidor" || p.arreglo === "centro")).map((p) => p.arreglo as "servidor" | "centro");
        if (!pedir.length) return true;
        setArreglando(true);
        try {
            const r = await fetch(`/api/devices/intrusion-estado?deviceId=${encodeURIComponent(deviceId)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ arreglar: pedir }) }).then((x) => x.json());
            if (r?.estado) setEstado(r.estado);
            if (r?.ok) { if (!callado) toast.success({ title: "Arreglado en la cámara", description: (r.hechos || []).join(" · ") }); return true; }
            toast.error({ title: "La cámara no quedó avisando", description: [...(r?.errores || []), r?.error].filter(Boolean).join(" · ") || "Sin respuesta" });
            return false;
        } catch { toast.error({ title: "No se pudo arreglar", description: "Sin conexión con el servidor." }); return false; }
        finally { setArreglando(false); }
    }, [deviceId, estado]);
    return { estado, cargando, arreglando, recargar, arreglar };
}

const ICONO: Record<Paso["estado"], { I: any; tono: string }> = {
    ok: { I: Check, tono: "chip-bien" },
    falta: { I: AlertTriangle, tono: "chip-mal" },
    "no-aplica": { I: Minus, tono: "chip-quieto" },
    "sin-dato": { I: HelpCircle, tono: "chip-aviso" },
};

export function EstadoIntrusion({ ctl, avisa, onCalibrar }: { ctl: ReturnType<typeof useEstadoIntrusion>; avisa: boolean; onCalibrar?: () => void }) {
    const { estado, cargando, arreglando, recargar, arreglar } = ctl;
    const arreglables = (estado?.pasos || []).filter((p) => p.estado === "falta" && (p.arreglo === "servidor" || p.arreglo === "centro"));
    // El roto que importa depende del modo ELEGIDO en pantalla (puede no estar guardado todavía).
    const roto = avisa ? (estado?.pasos || []).find((p) => p.estado === "falta") || null : null;
    return (
        <div className="rounded-[10px] border border-border overflow-hidden">
            <div className="flex items-center gap-2 px-3.5 h-10 bg-muted/40 border-b border-border">
                {roto ? <ShieldAlert size={14} className="tono-mal" /> : <ShieldCheck size={14} className={estado?.ok ? "tono-bien" : "text-muted-foreground"} />}
                <span className="text-[12.5px] font-semibold">Lo que tiene la cámara hoy</span>
                <span className="text-[11px] text-muted-foreground">· leído en vivo</span>
                <button type="button" onClick={recargar} disabled={cargando} title="Volver a leer la cámara" aria-label="Volver a leer la cámara"
                    className="ml-auto grid h-7 w-7 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50">
                    {cargando ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                </button>
            </div>

            {!estado && cargando && <div className="p-4 space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-9 rounded-md bg-muted animate-pulse" />)}</div>}
            {estado && !estado.ok && (
                <div className="p-4 text-[12.5px] flex items-center gap-2">
                    <AlertTriangle size={14} className="tono-aviso shrink-0" />
                    <span className="flex-1">No se pudo leer la cámara: {estado.error || "sin respuesta"}.</span>
                    <Button size="sm" variant="outline" onClick={recargar} disabled={cargando}>Reintentar</Button>
                </div>
            )}

            {estado?.ok && (<>
                {roto && (
                    <div className="px-3.5 py-3 border-b border-border bg-[color-mix(in_oklab,var(--mal,#ef4444)_7%,transparent)] flex items-start gap-2.5">
                        <AlertTriangle size={15} className="tono-mal mt-0.5 shrink-0" />
                        <div className="flex-1 min-w-0">
                            <p className="text-[12.5px] font-semibold">Con este modo, OmniAccess no se va a enterar de los cruces</p>
                            <p className="text-[11.5px] text-muted-foreground mt-0.5">Falta: {roto.titulo.charAt(0).toLowerCase() + roto.titulo.slice(1)}.</p>
                        </div>
                        {arreglables.length > 0 && (
                            <Button size="sm" onClick={() => arreglar()} disabled={arreglando} className="gap-1.5 bg-[var(--accion)] text-white shrink-0">
                                {arreglando ? <Loader2 size={13} className="animate-spin" /> : <Wrench size={13} />} Arreglar
                            </Button>
                        )}
                    </div>
                )}
                {!avisa && <p className="px-3.5 pt-3 text-[11.5px] text-muted-foreground">En este modo la cámara no tiene por qué avisar: lo de abajo es informativo.</p>}
                <ul className="divide-y divide-border">
                    {estado.pasos.map((p) => {
                        const { I, tono } = ICONO[p.estado];
                        return (
                            <li key={p.clave} className="flex items-start gap-3 px-3.5 py-2.5">
                                <span className={cn("mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full", tono)}><I size={11} /></span>
                                <div className="min-w-0 flex-1">
                                    <p className="text-[12.5px] font-semibold">{p.titulo}</p>
                                    <p className="text-[11.5px] text-muted-foreground">{p.detalle}</p>
                                </div>
                                {p.estado === "falta" && (p.arreglo === "servidor" || p.arreglo === "centro") && (
                                    <Button size="sm" variant="outline" onClick={() => arreglar([p.arreglo as "servidor" | "centro"])} disabled={arreglando} className="shrink-0 h-7 text-[11.5px]">
                                        {p.arreglo === "servidor" ? "Configurar" : "Activar"}
                                    </Button>
                                )}
                                {p.arreglo === "calibrar" && p.estado === "falta" && onCalibrar && (
                                    <Button size="sm" variant="outline" onClick={onCalibrar} className="shrink-0 h-7 gap-1 text-[11.5px]"><Crosshair size={12} /> Dibujar</Button>
                                )}
                            </li>
                        );
                    })}
                </ul>
            </>)}
        </div>
    );
}

/**
 * Las líneas y zonas que la cámara tiene dibujadas, encima del video de la ficha. Sólo para mirar:
 * se editan en el calibrador. Coordenadas de la API: 0–1000, origen abajo-izquierda.
 */
export function ReglasSobreVideo({ estado }: { estado: Estado | null }) {
    if (!estado?.ok || (!estado.lineas.length && !estado.zonas.length)) return null;
    const pt = (p: { x: number; y: number }) => `${p.x / 10},${(1000 - p.y) / 10}`;
    return (
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full pointer-events-none" aria-hidden>
            {estado.zonas.map((z) => (
                <polygon key={`z${z.id}`} points={z.puntos.map(pt).join(" ")} vectorEffect="non-scaling-stroke"
                    fill={z.activa ? "rgba(250,204,21,0.12)" : "rgba(255,255,255,0.05)"} stroke={z.activa ? "rgba(250,204,21,0.9)" : "rgba(255,255,255,0.45)"} strokeWidth={1.5} strokeDasharray={z.activa ? undefined : "4 3"} />
            ))}
            {estado.lineas.map((l) => (
                <polyline key={`l${l.id}`} points={l.puntos.map(pt).join(" ")} vectorEffect="non-scaling-stroke" fill="none"
                    stroke={l.activa ? "rgba(248,113,113,0.95)" : "rgba(255,255,255,0.45)"} strokeWidth={2} strokeDasharray={l.activa ? undefined : "4 3"} />
            ))}
        </svg>
    );
}
