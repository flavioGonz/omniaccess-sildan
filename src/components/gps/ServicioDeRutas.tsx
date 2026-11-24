"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, Route } from "lucide-react";
import { sileo as toast } from "sileo";
import { levantarRutasGps, servicioRutasGps, type ServicioRutas } from "@/app/actions/gps";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Los recorridos por la calle: si están prendidos y en qué anda el servicio (24/11).
 *
 * El servicio es omni-rutas, un contenedor de OmniAccess que se prende con la función «Recorridos
 * por la calle» (Ajustes › Características). Como con las direcciones, se ve SIEMPRE cómo está:
 * mientras baja y prepara el mapa no contesta, y eso no es una falla.
 */
export function ServicioDeRutas({ puedeConfig = true }: { /** Si el rol puede levantarlo. Sin eso, sólo dice cómo está. */ puedeConfig?: boolean }) {
    const [e, setE] = useState<ServicioRutas | null>(null);
    const [trabajando, setTrabajando] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [vuelta, setVuelta] = useState(0);
    useEffect(() => { servicioRutasGps().then(setE).catch(() => { /* sin saber cómo está, no se muestra nada: no es un error de esta pantalla */ }); }, [vuelta]);
    /* Mientras se instala o se prepara, se vuelve a mirar sola: nadie tiene que recargar para ver que terminó. */
    const enCamino = e?.fase === "construyendo" || e?.fase === "preparando";
    useEffect(() => { if (!enCamino) return; const t = setInterval(() => setVuelta((n) => n + 1), 8000); return () => clearInterval(t); }, [enCamino]);
    if (!e) return null;

    const levantar = async () => {
        setTrabajando(true); setError(null);
        try {
            const r = await levantarRutasGps();
            if (!r.ok) { setError(r.error || "No se pudo."); return; }
            setVuelta((n) => n + 1); toast.success({ title: "Levantando el servicio de rutas" });
        } catch (x) { setError(x instanceof Error ? x.message : "No se pudo."); }
        finally { setTrabajando(false); }
    };
    const tono = !e.funcion ? "chip-quieto" : e.ok ? "chip-bien" : enCamino ? "chip-info" : "chip-mal";
    const titulo = !e.funcion ? "Los recorridos van en línea recta" : e.ok ? "Los recorridos siguen la calle" : enCamino ? "Se está instalando el servicio de rutas" : "El servicio de rutas no anda";
    const sePuedeLevantar = e.funcion && (e.fase === "sin-instalar" || e.fase === "detenido" || e.fase === "falla");
    return (
        <div className="flex flex-wrap items-center gap-3">
            <span className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-full border", tono)}>{enCamino ? <Loader2 size={15} className="animate-spin" /> : <Route size={15} />}</span>
            <div className="min-w-0 flex-1">
                <p className="text-[13px] font-semibold">{titulo}</p>
                <p className="text-[11.5px] leading-snug text-muted-foreground">
                    {!e.funcion ? "Entre una posición y la siguiente el mapa traza una recta, que corta por las manzanas si el equipo reporta poco. Se prende en Ajustes › Características › «Recorridos por la calle»: se instala sola en este equipo."
                        : e.ok ? "Servicio incorporado en este equipo (omni-rutas). Entre posición y posición el trazo va por la calle más probable; donde no es creíble, o el equipo calló más de dos minutos, queda la recta. Los kilómetros se siguen contando con las posiciones del equipo."
                        : <>{e.frase}{!enCamino && " Mientras tanto los recorridos salen en línea recta, como antes."}</>}
                </p>
                {error && <p className="tono-mal mt-1 text-[11.5px] font-semibold" role="alert">{error}</p>}
            </div>
            {!e.funcion && <Link href="/admin/settings" className="shrink-0 text-[12px] font-semibold text-[var(--accion)] hover:underline">Ir a Ajustes</Link>}
            {puedeConfig && sePuedeLevantar && <Button size="sm" className="h-10 shrink-0 px-4 text-[13px] max-sm:w-full sm:h-8 sm:px-3 sm:text-[12px]" disabled={trabajando} onClick={levantar}>{trabajando && <Loader2 size={13} className="animate-spin" />} Levantarlo</Button>}
        </div>
    );
}
