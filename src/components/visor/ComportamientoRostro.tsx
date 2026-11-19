"use client";

import { useEffect, useMemo, useState } from "react";
import { Activity, CalendarDays, X } from "lucide-react";
import { GitHubActivity } from "@/components/ui/github-activity";
import { Cargando, ErrorEstado, Vacio } from "@/components/ui/estados";
import { ContenidoComportamiento, type ComportamientoVisor } from "@/components/visor/PanelComportamiento";
import { calendarioDePasos } from "@/components/visor/FrecuenciaDeChapa";
import { comportamientoDeRostro } from "@/app/actions/rostro-comportamiento";

/**
 * El comportamiento de una CARA, en el mismo panel que el de una matrícula.
 *
 * Pedido de Nico (19/11): «la ventana del evento face debe tener el botón de comportamiento, para
 * ver la frecuencia similar a git». La pregunta es la misma que con un vehículo —¿este viene
 * seguido, a qué hora, desde cuándo?— y la respuesta tiene que verse igual, porque quien la hace
 * ya aprendió a leer ese calendario. Lo único que cambia es el sujeto: las pasadas de ese rostro
 * por las cámaras en vez de los pasos de una chapa por los accesos.
 */
export function ComportamientoRostro({ rostroId, nombre, onCerrar }: { rostroId: string; nombre: string; onCerrar: () => void }) {
    const [vuelta, setVuelta] = useState(0);
    const [estado, setEstado] = useState<{ cargando: boolean; datos: ComportamientoVisor | null; error: string | null }>({ cargando: true, datos: null, error: null });

    useEffect(() => {
        let vivo = true;
        setEstado({ cargando: true, datos: null, error: null });
        comportamientoDeRostro(rostroId)
            .then((d) => { if (vivo) setEstado({ cargando: false, datos: d, error: null }); })
            .catch((e: unknown) => { if (vivo) setEstado({ cargando: false, datos: null, error: e instanceof Error ? e.message : "No se pudo traer" }); });
        return () => { vivo = false; };
    }, [rostroId, vuelta]);

    const datos = estado.datos;
    const calendario = useMemo(() => (datos ? calendarioDePasos(datos.pasos, datos.dias) : []), [datos]);
    const diasConPasos = calendario.filter((c) => c.count > 0).length;

    return (
        <aside className="absolute right-0 top-0 bottom-0 z-[45] w-[min(500px,50vw)] flex flex-col cajon-vidrio cajon-denso border-l border-border shadow-[0_0_60px_rgba(0,0,0,0.35)] text-foreground animate-in slide-in-from-right-4 duration-200">
            <header className="shrink-0 flex items-start justify-between gap-3 px-5 pt-4 pb-3 border-b border-border">
                <div className="min-w-0">
                    <h2 className="flex items-center gap-2 text-[15px] font-bold tracking-[-0.01em]"><Activity size={16} className="text-muted-foreground" /> Comportamiento</h2>
                    <p className="text-[12px] text-muted-foreground mt-0.5 truncate">
                        <b className="text-foreground">{nombre}</b>
                        {datos ? ` · últimos ${datos.dias} días · ${datos.pasos.length} ${datos.pasos.length === 1 ? "pasada" : "pasadas"}` : ""}
                    </p>
                </div>
                <button type="button" onClick={onCerrar} aria-label="Cerrar" title="Cerrar  ( Esc )"
                    className="w-8 h-8 rounded-[8px] grid place-items-center text-foreground/80 hover:text-foreground hover:bg-muted"><X size={16} /></button>
            </header>
            <div className="flex-1 min-h-0 overflow-y-auto [scrollbar-width:thin]">
                {estado.cargando ? <div className="p-5"><Cargando texto={`Buscando cuándo se vio a ${nombre}…`} /></div>
                    : estado.error ? <div className="p-5"><ErrorEstado mensaje={estado.error} alReintentar={() => setVuelta((n) => n + 1)} /></div>
                        : !datos || !datos.pasos.length ? (
                            <div className="p-5">
                                <Vacio icono={CalendarDays} titulo="Todavía no hay otras pasadas"
                                    ayuda="Esta cara se vio por primera vez recién. Cuando vuelva a pasar por una cámara que mire rostros, acá se va a ver con qué frecuencia viene." />
                            </div>
                        ) : (<>
                            <section className="px-5 py-4 border-b border-border">
                                <GitHubActivity contributions={calendario} months={Math.max(1, Math.round(datos.dias / 30))} label="pasadas"
                                    accent={["#0ea5e9", "#38bdf8"]} cellSize={13} showMonths
                                    heading={`Se la vio ${diasConPasos} de los últimos ${datos.dias} días · ${datos.pasos.length} ${datos.pasos.length === 1 ? "pasada" : "pasadas"}`} />
                            </section>
                            <ContenidoComportamiento datos={datos} />
                        </>)}
            </div>
        </aside>
    );
}
