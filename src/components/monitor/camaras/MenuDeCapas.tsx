"use client";

import { useEffect, useState } from "react";
import { Boxes, Car, Layers, PawPrint, RectangleEllipsis, Spline, User, type LucideIcon } from "lucide-react";
import { COLOR_GRUPO } from "@/components/vision/CapaAnalisis";
import { CAPAS_DEFECTO, type CapasVisibles, type ClaveCapa } from "@/lib/capas-visibles";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { tip } from "./TipVisor";

/**
 * El menú de capas del visor: qué se dibuja sobre el video (ver lib/capas-visibles).
 *
 * Un solo botón donde había tres. Cada renglón es una elección (por eso el interruptor es una
 * píldora) y se aplica en el acto: el menú queda abierto para prender y apagar varias mirando el
 * resultado. El ícono de personas, vehículos y animales va del color de su silueta: el menú es
 * también la leyenda.
 */
const FILAS: Record<ClaveCapa, { rotulo: string; nota?: string; Icono: LucideIcon; color?: string }> = {
    persona: { rotulo: "Personas", Icono: User, color: COLOR_GRUPO.persona },
    vehiculo: { rotulo: "Vehículos", Icono: Car, color: COLOR_GRUPO.vehiculo },
    animal: { rotulo: "Animales", Icono: PawPrint, color: COLOR_GRUPO.animal },
    propio: { rotulo: "Objetos entrenados", nota: "Lo que detecta el modelo propio", Icono: Boxes },
    chapas: { rotulo: "Matrículas", nota: "De los vehículos estacionados", Icono: RectangleEllipsis },
    zonas: { rotulo: "Zonas de las analíticas", nota: "Reglas, vigías y lectura", Icono: Layers },
    camara: { rotulo: "Línea y zona de la cámara", Icono: Spline },
};

export function MenuDeCapas({ valor, alCambiar, filas, estado, claseBoton, abre = "arriba" }: {
    valor: CapasVisibles; alCambiar: (v: CapasVisibles) => void;
    /** Las capas que existen ACÁ, en orden (la grabación no tiene matrículas; un canal sin analíticas no tiene zonas). */
    filas: ClaveCapa[];
    /** Cómo viene el análisis (ms por cuadro, ocupado…): un renglón arriba. */
    estado?: string | null;
    /**
     * Para dónde se despliega. La barra del vivo está ARRIBA del video y la de la grabación abajo:
     * el 15/11 salió siempre hacia arriba y en el vivo se abría fuera de la pantalla (16/11, Nico,
     * con la captura del botón y sólo su ayuda: «esto debe desplegar un elemento hacia abajo»).
     */
    abre?: "arriba" | "abajo";
    /** El botón redondo de la barra donde vive: cada barra tiene el suyo. */
    claseBoton: (activo: boolean) => string;
}) {
    const [abierto, setAbierto] = useState(false);
    useEffect(() => {
        if (!abierto) return;
        // En captura y cortando: Esc cierra el menú, no el canal que está debajo (que escucha en la ventana).
        const tecla = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); setAbierto(false); } };
        window.addEventListener("keydown", tecla, true);
        return () => window.removeEventListener("keydown", tecla, true);
    }, [abierto]);
    const prendidas = filas.filter((k) => valor[k]).length;
    const todas = (si: boolean) => { const v = { ...valor }; for (const k of filas) v[k] = si; alCambiar(v); };
    const deFabrica = filas.every((k) => valor[k] === CAPAS_DEFECTO[k]);
    /*
     * El panel va en un portal (el Popover compartido): la barra del vivo se desplaza de costado
     * cuando no entra (`overflow-x-auto`), y eso recorta todo lo que cuelgue de ella. Por eso el
     * 15/11 el menú se abría y no se veía.
     */
    return (
        <Popover open={abierto} onOpenChange={setAbierto}>
            <PopoverTrigger asChild>
                <button type="button" aria-haspopup="menu" {...(abierto ? {} : tip(`Capas: qué se dibuja sobre el video · ${prendidas} de ${filas.length} prendidas`))} className={claseBoton(abierto || prendidas > 0)}>
                    <Layers size={18} />
                </button>
            </PopoverTrigger>
            <PopoverContent side={abre === "abajo" ? "bottom" : "top"} align={abre === "abajo" ? "start" : "end"} sideOffset={12} collisionPadding={12}
                role="menu" aria-label="Capas sobre el video" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}
                className="w-[280px] rounded-[14px] p-1.5 text-left text-white z-[var(--capa-menu)] shadow-none"
                style={{ background: "rgba(8,11,17,.9)", border: "1px solid rgba(248,250,252,.14)", boxShadow: "var(--sombra-flotante)", backdropFilter: "blur(14px)" }}>
                    <div className="px-2.5 pt-1.5 pb-2">
                        <div className="text-[9px] font-semibold uppercase tracking-[0.14em] text-white/55">Capas sobre el video</div>
                        {estado && <div className="text-[11.5px] text-white/70 mt-0.5 tabular-nums">{estado}</div>}
                    </div>
                    {filas.map((k) => {
                        const f = FILAS[k], si = valor[k];
                        return (
                            <button key={k} type="button" role="menuitemcheckbox" aria-checked={si} onClick={() => alCambiar({ ...valor, [k]: !si })}
                                className={`w-full flex items-center gap-2.5 rounded-md px-2.5 py-2 text-left hover:bg-white/[.1] transition-colors ${k === "zonas" || (k === "camara" && !filas.includes("zonas")) ? "mt-1 border-t border-white/10 rounded-t-none" : ""}`}>
                                <f.Icono size={16} strokeWidth={2.2} className="shrink-0" style={{ color: si ? f.color || "#fff" : "rgba(255,255,255,.4)" }} />
                                <span className="min-w-0 flex-1">
                                    <span className={`block text-[13px] font-semibold leading-tight ${si ? "" : "text-white/55"}`}>{f.rotulo}</span>
                                    {f.nota && <span className="block text-[11px] leading-tight text-white/50 mt-0.5">{f.nota}</span>}
                                </span>
                                <span aria-hidden className="shrink-0 w-[30px] h-[18px] rounded-full p-[2px] transition-colors" style={{ background: si ? "var(--accion-en-oscuro)" : "rgba(255,255,255,.22)" }}>
                                    <span className="block w-[14px] h-[14px] rounded-full bg-white transition-transform" style={{ transform: si ? "translateX(12px)" : "none" }} />
                                </span>
                            </button>
                        );
                    })}
                    <div className="flex items-center gap-1 px-1 pt-1.5 mt-1 border-t border-white/10 text-[12px]">
                        <button type="button" onClick={() => todas(true)} disabled={prendidas === filas.length} className="px-1.5 py-1 rounded-md text-[var(--accion-en-oscuro)] hover:bg-white/[.1] disabled:opacity-40 disabled:pointer-events-none">Mostrar todo</button>
                        <button type="button" onClick={() => todas(false)} disabled={prendidas === 0} className="px-1.5 py-1 rounded-md text-[var(--accion-en-oscuro)] hover:bg-white/[.1] disabled:opacity-40 disabled:pointer-events-none">Ocultar todo</button>
                        <button type="button" onClick={() => { const v = { ...valor }; for (const k of filas) v[k] = CAPAS_DEFECTO[k]; alCambiar(v); }} disabled={deFabrica} className="ml-auto px-1.5 py-1 rounded-md text-white/70 hover:bg-white/[.1] disabled:opacity-40 disabled:pointer-events-none">Como venía</button>
                    </div>
            </PopoverContent>
        </Popover>
    );
}
