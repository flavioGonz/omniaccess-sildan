"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { MapPin } from "lucide-react";
import { Girando as Loader2 } from "@/components/brand/CargaOmni";
import { sileo as toast } from "sileo";
import { guardarServicioDireccionesGps, levantarDireccionesGps, servicioDireccionesGps, type ServicioDirecciones } from "@/app/actions/gps";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Las direcciones: si están prendidas, en qué anda el servicio y cómo levantarlo (23/11).
 *
 * El servicio es omni-geo, un contenedor de OmniAccess que se prende con la función «Direcciones de
 * los lugares» (Ajustes › Características), como cualquier otra función. La primera versión fue
 * una máquina aparte con su dirección de red cargada a mano, y Nico la devolvió el mismo día: «¿no
 * debe ser un contenedor de OmniAccess, activable como una función incorporada?».
 *
 * Nació en Dispositivos › GPS, al lado de la puerta del receptor, y pasó a Gestión GPS › Ajustes
 * cuando el rastreo tuvo su menú. Se ve SIEMPRE cómo está: instalarlo tarda un cuarto de hora, y un
 * «no contesta» durante ese rato se leería como una falla. Por eso dice en qué paso va.
 */
export function ServicioDeDirecciones({ puedeConfig = true }: { /** Si el rol puede levantarlo o cambiarle el servidor. Sin eso, sólo dice cómo está. */ puedeConfig?: boolean }) {
    const [e, setE] = useState<ServicioDirecciones | null>(null);
    const [borrador, setBorrador] = useState<string | null>(null);
    const [trabajando, setTrabajando] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [vuelta, setVuelta] = useState(0);
    useEffect(() => { servicioDireccionesGps().then(setE).catch(() => { /* sin saber cómo está, no se muestra nada: no es un error de esta pantalla */ }); }, [vuelta]);
    /* Mientras se instala o se prepara, se vuelve a mirar sola: nadie tiene que recargar para ver que terminó. */
    const enCamino = e?.fase === "construyendo" || e?.fase === "preparando";
    useEffect(() => { if (!enCamino) return; const t = setInterval(() => setVuelta((n) => n + 1), 8000); return () => clearInterval(t); }, [enCamino]);
    if (!e) return null;

    const hacer = async (que: () => Promise<{ ok: boolean; error?: string; ejemplo?: string | null }>, dicho: string) => {
        setTrabajando(true); setError(null);
        try {
            const r = await que();
            if (!r.ok) { setError(r.error || "No se pudo."); return; }
            setBorrador(null); setVuelta((n) => n + 1);
            toast.success({ title: dicho, description: r.ejemplo ? `Contesta. Por ejemplo: «${r.ejemplo}».` : undefined });
        } catch (x) { setError(x instanceof Error ? x.message : "No se pudo."); }
        finally { setTrabajando(false); }
    };
    const guardadas = e.guardadas ? ` · ${e.guardadas.toLocaleString("es-UY")} direcciones ya averiguadas` : "";
    const tono = !e.funcion ? "chip-quieto" : e.ok ? "chip-bien" : enCamino ? "chip-info" : "chip-mal";
    const titulo = !e.funcion ? "Las direcciones están apagadas"
        : e.ok ? "Los lugares se dicen con su dirección"
        : enCamino ? "Se está instalando el servicio de direcciones"
        : "El servicio de direcciones no anda";
    const sePuedeLevantar = e.funcion && e.propio && (e.fase === "sin-instalar" || e.fase === "detenido" || e.fase === "falla");
    return (
        <div className="flex flex-wrap items-center gap-3">
            <span className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-full border", tono)}>{enCamino ? <Loader2 size={15} className="animate-spin" /> : <MapPin size={15} />}</span>
            <div className="min-w-0 flex-1">
                <p className="text-[13px] font-semibold">{titulo}</p>
                <p className="text-[11.5px] text-muted-foreground">
                    {!e.funcion ? "El mapa, el recorrido y los reportes muestran el nombre de la geocerca o coordenadas. Se prenden en Ajustes › Características › «Direcciones de los lugares»: se instala sola en este equipo."
                        : e.ok ? <>{e.propio ? "Servicio incorporado en este equipo (omni-geo)" : <>Servicio de afuera en <span className="tabular-nums">{e.url}</span></>}{e.ejemplo ? ` · por ejemplo, «${e.ejemplo}»` : ""}{guardadas}.</>
                        : e.propio ? <>{e.frase}{!enCamino && e.guardadas ? " Los lugares ya averiguados siguen saliendo con su dirección." : ""}</>
                        : <>Está cargado <span className="tabular-nums">{e.url}</span> y no responde. Mientras tanto los lugares nuevos se ven con coordenadas.</>}
                </p>
                {borrador !== null && (
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        <input value={borrador} onChange={(x) => setBorrador(x.target.value)} placeholder="http://direcciones.ejemplo:8080" autoFocus aria-label="Dirección del otro servicio"
                            onKeyDown={(x) => { if (x.key === "Enter") hacer(() => guardarServicioDireccionesGps(borrador || ""), borrador ? "Servicio de direcciones guardado" : "Se usa el servicio de este equipo"); if (x.key === "Escape") setBorrador(null); }}
                            className="h-11 w-full rounded-[6px] border border-border bg-background px-3 text-[16px] tabular-nums outline-none focus:border-[var(--accion)] sm:h-8 sm:w-[260px] sm:px-2 sm:text-[12.5px]" />
                        <Button size="sm" className="h-10 px-3.5 text-[13px] sm:h-8 sm:px-2.5 sm:text-[12px]" disabled={trabajando} onClick={() => hacer(() => guardarServicioDireccionesGps(borrador || ""), borrador ? "Servicio de direcciones guardado" : "Se usa el servicio de este equipo")}>{trabajando && <Loader2 size={13} className="animate-spin" />} {borrador ? "Probar y guardar" : "Usar el de este equipo"}</Button>
                        <Button size="sm" variant="ghost" className="h-10 px-3 text-[13px] sm:h-8 sm:px-2.5 sm:text-[12px]" disabled={trabajando} onClick={() => { setBorrador(null); setError(null); }}>Cancelar</Button>
                        <p className="w-full text-[11px] text-muted-foreground">Sólo si hay un servicio de direcciones compartido en otro equipo. Vacío vuelve al incorporado.</p>
                    </div>
                )}
                {error && <p className="tono-mal mt-1 text-[11.5px] font-semibold" role="alert">{error}</p>}
            </div>
            {!e.funcion && <Link href="/admin/settings" className="shrink-0 text-[12px] font-semibold text-[var(--accion)] hover:underline">Ir a Ajustes</Link>}
            {puedeConfig && sePuedeLevantar && borrador === null && <Button size="sm" className="h-10 shrink-0 px-4 text-[13px] max-sm:w-full sm:h-8 sm:px-3 sm:text-[12px]" disabled={trabajando} onClick={() => hacer(levantarDireccionesGps, e.fase === "sin-instalar" ? "Instalando el servicio de direcciones" : "Levantando el servicio de direcciones")}>{trabajando && <Loader2 size={13} className="animate-spin" />} {e.fase === "sin-instalar" ? "Instalar" : "Levantar"}</Button>}
            {puedeConfig && e.funcion && borrador === null && !enCamino && <button type="button" className="h-10 shrink-0 text-left text-[12.5px] font-semibold text-muted-foreground hover:text-foreground max-sm:w-full sm:h-auto sm:text-[11.5px]" onClick={() => { setError(null); setBorrador(e.url || ""); }}>{e.propio ? "Usar otro servidor" : "Cambiar"}</button>}
        </div>
    );
}
