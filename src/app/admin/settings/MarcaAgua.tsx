"use client";

/**
 * Ajustes › Video del evento › Logo en los clips: el logo de Sildan sobre la foto de una
 * alerta y sobre el clip que se exporta para mandar. Se elige si va y en qué lugar del cuadro
 * (global para todo el barrio). Las descargas de evidencia no lo llevan. Se muestra cómo
 * queda, no se describe.
 */
import { useEffect, useState } from "react";
import { Loader2, Info, Check } from "lucide-react";
import { Tooltip } from "react-tooltip";
import { sileo as toast } from "sileo";
import { Switch } from "@/components/ui/switch";
import { getSetting, updateSetting } from "@/app/actions/settings";
import {
    AJUSTE_MARCA_AGUA, ARCHIVO_MARCA_AGUA, AJUSTE_MARCA_POSICION, POSICIONES_MARCA, POSICION_MARCA_DEFECTO,
    ROTULO_POSICION, esPosicionMarca, type PosicionMarca,
} from "@/lib/clips";
import { cn } from "@/lib/utils";

/** Clases de ubicación del logo en la vista previa (mismo criterio que el overlay de ffmpeg). */
const LUGAR: Record<PosicionMarca, string> = {
    "sup-izq": "left-[3%] top-[5%]", "sup-centro": "left-1/2 -translate-x-1/2 top-[5%]", "sup-der": "right-[3%] top-[5%]",
    "centro-izq": "left-[3%] top-1/2 -translate-y-1/2", "centro": "left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2", "centro-der": "right-[3%] top-1/2 -translate-y-1/2",
    "inf-izq": "left-[3%] bottom-[5%]", "inf-centro": "left-1/2 -translate-x-1/2 bottom-[5%]", "inf-der": "right-[3%] bottom-[5%]",
};

export default function MarcaAgua() {
    const [on, setOn] = useState(true);
    const [pos, setPos] = useState<PosicionMarca>(POSICION_MARCA_DEFECTO);
    const [cargando, setCargando] = useState(true);
    const [guardando, setGuardando] = useState(false);

    useEffect(() => {
        Promise.all([getSetting(AJUSTE_MARCA_AGUA), getSetting(AJUSTE_MARCA_POSICION)])
            .then(([a, p]: any[]) => { setOn(a?.value !== "false"); if (esPosicionMarca(p?.value)) setPos(p.value); })
            .catch(() => { }).finally(() => setCargando(false));
    }, []);

    const cambiar = async (v: boolean) => {
        setOn(v); setGuardando(true);
        try { await updateSetting(AJUSTE_MARCA_AGUA, v ? "true" : "false"); toast.success({ title: v ? "Logo activado" : "Logo desactivado" }); }
        catch (e: any) { setOn(!v); toast.error({ title: "No se pudo guardar", description: e?.message }); }
        finally { setGuardando(false); }
    };
    const ubicar = async (p: PosicionMarca) => {
        if (p === pos) return;
        const antes = pos; setPos(p); setGuardando(true);
        try { await updateSetting(AJUSTE_MARCA_POSICION, p); toast.success({ title: "Posición del logo guardada", description: ROTULO_POSICION[p] }); }
        catch (e: any) { setPos(antes); toast.error({ title: "No se pudo guardar", description: e?.message }); }
        finally { setGuardando(false); }
    };

    return (
        <div className="rounded-[10px] border border-border bg-card p-5 max-w-xl space-y-5">
            <div className="flex items-start gap-4">
                <div className="min-w-0 flex-1">
                    <div className="text-[15px] font-bold text-foreground">Logo en los clips y fotos que se mandan</div>
                    <p className="text-[12px] text-muted-foreground mt-0.5">La foto de cada alerta y el clip exportado desde la grabación llevan el logo de Sildan. Las descargas de evidencia salen sin logo, tal cual las entrega el grabador.</p>
                </div>
                {cargando ? <Loader2 size={16} className="animate-spin text-muted-foreground" /> : <Switch checked={on} onCheckedChange={cambiar} disabled={guardando} aria-label="Logo en los clips" />}
            </div>

            <div className={cn("space-y-3 transition-opacity", !on && "opacity-50 pointer-events-none")}>
                <div className="flex items-center gap-1.5 text-[12px] font-semibold text-foreground/85">
                    Posición en el cuadro
                    <span data-tooltip-id="tt-marca" data-tooltip-content="Es global: vale para todos los clips exportados y las fotos de alerta. Ej.: si la fecha del NVR está abajo a la derecha, conviene «Arriba a la derecha» para no taparla." className="text-muted-foreground/60 hover:text-[var(--accion)] cursor-help"><Info size={12.5} /></span>
                    <span className="ml-auto text-[11.5px] font-normal text-muted-foreground">{ROTULO_POSICION[pos]}</span>
                </div>
                <div className="grid grid-cols-[1fr_132px] gap-4 items-center">
                    {/* Vista previa 16:9 con el logo donde va a salir */}
                    <div className="relative aspect-video rounded-[8px] border border-border overflow-hidden bg-[linear-gradient(135deg,#1f2a1f,#3a4a36_55%,#5b6b56)]">
                        <div className="absolute inset-x-0 bottom-0 h-1/3 bg-[linear-gradient(180deg,transparent,rgba(0,0,0,.35))]" />
                        <span className="absolute left-[3%] top-[4%] text-[9px] font-mono text-white/70">2026-10-11 19:25:21</span>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={`/${ARCHIVO_MARCA_AGUA}`} alt="" className={cn("absolute w-[18%] transition-all duration-300", LUGAR[pos])} />
                    </div>
                    {/* Selector 3x3 */}
                    <div className="grid grid-cols-3 gap-1.5 p-1.5 rounded-[8px] border border-border bg-muted/40 aspect-video">
                        {POSICIONES_MARCA.map((p) => (
                            <button key={p} type="button" onClick={() => ubicar(p)} disabled={guardando} aria-label={ROTULO_POSICION[p]}
                                data-tooltip-id="tt-marca" data-tooltip-content={ROTULO_POSICION[p]}
                                className={cn("rounded-[5px] grid place-items-center transition-colors border",
                                    pos === p ? "bg-[var(--accion)] border-[var(--accion)] text-white" : "bg-background border-border hover:bg-accent text-transparent hover:text-muted-foreground")}>
                                <Check size={11} />
                            </button>
                        ))}
                    </div>
                </div>
            </div>
            <Tooltip id="tt-marca" place="top" className="!max-w-[280px] !text-[12px] !rounded-lg !z-[9999]" />
        </div>
    );
}
