"use client";

import Link from "next/link";
import { Ban, DoorClosed, MessageSquare, MonitorPlay, Palette, Search, Send, Star, Volume2, VolumeX } from "lucide-react";
import { Tooltip } from "react-tooltip";
import { cn } from "@/lib/utils";
import { ExplicacionCategoria } from "@/components/WatchlistDialog";
import {
    ESTILO_APAGADO, ESTILO_MONITOR, LO_FIJO, PESTANIAS_CON_VIP,
    type ClaseMonitor, type ClavePestania, type ClaveComportamiento, type Comportamiento, type Interruptores,
} from "@/lib/padron";

/**
 * «Cómo se comporta»: los interruptores y lo fijo de cada pestaña, en íconos a la derecha de
 * los filtros de la tabla (17/10, Nico). Fue una franja arriba y después debajo de la tabla; las
 * dos ocupaban un renglón entero para algo que se consulta de vez en cuando. Ahora cada cosa es
 * un ícono y lo que dice va en la ayuda (react-tooltip, con contenido rico: la muestra del
 * monitor y la tabla de efectos de la lista negra).
 *
 * Dos clases de cosas, y se ven distintas a propósito:
 *   · lo FIJO (la barrera, las lectoras, la alarma de la lista negra) es un ícono quieto con
 *     su explicación en la ayuda — no se puede elegir, así que no se dibuja como botón;
 *   · los INTERRUPTORES son botones (azul lleno = prendido) y son reales: los lee el monitor
 *     LPR al cargar (color propio, sonido al pasar). Cambiarlos se guarda en el momento.
 *
 * La muestra «así se ve en el monitor» usa las mismas clases que el monitor (lib/padron →
 * ESTILO_MONITOR), sobre fondo oscuro como la consola: una muestra que no coincide con la
 * pantalla enseña otra cosa.
 */

function Muestra({ clase, color }: { clase: ClaseMonitor; color: boolean }) {
    const e = ESTILO_MONITOR[clase];
    return (
        <span className="inline-flex items-center gap-1.5 h-7 pl-1.5 pr-2 rounded-[6px] bg-neutral-900">
            <span className={cn("w-1 h-4 rounded-full", color ? e.dot : "bg-neutral-700")} />
            <span className={cn("text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded", color ? e.badge : ESTILO_APAGADO.badge)}>{e.etiqueta}</span>
        </span>
    );
}

/** Un id de ayuda por pantalla: el contenido de cada ícono se arma en `render` según su clave. */
const TT = "tt-comporta";

type Ayuda = { titulo: string; cuerpo: React.ReactNode };

function Ayudas({ ayudas }: { ayudas: Record<string, Ayuda> }) {
    return (
        <Tooltip id={TT} place="bottom" positionStrategy="fixed" noArrow delayShow={120} opacity={1}
            className="!z-[9999] !max-w-[330px] !rounded-[10px] !bg-popover !text-popover-foreground !border !border-border !shadow-2xl !px-3 !py-2.5"
            render={({ content }) => {
                const a = content ? ayudas[content] : null;
                if (!a) return null;
                return (
                    <div className="space-y-1.5">
                        <div className="text-[12.5px] font-semibold">{a.titulo}</div>
                        <div className="text-[11.5px] leading-snug text-muted-foreground">{a.cuerpo}</div>
                    </div>
                );
            }} />
    );
}

/** Un interruptor de verdad (lo lee el monitor): lleno en azul cuando está prendido. */
function Llave({ clave, icono: Ic, iconoApagado, valor, alCambiar, deshabilitado, rotulo }: {
    clave: string; icono: any; iconoApagado?: any; valor: boolean; alCambiar: (v: boolean) => void; deshabilitado?: boolean; rotulo: string;
}) {
    const I = !valor && iconoApagado ? iconoApagado : Ic;
    return (
        <button type="button" role="switch" aria-checked={valor} aria-label={rotulo} disabled={deshabilitado}
            onClick={() => alCambiar(!valor)} data-tooltip-id={TT} data-tooltip-content={clave}
            className={cn("h-[30px] w-[30px] rounded-md grid place-items-center transition-colors disabled:opacity-50",
                valor ? "bg-[var(--accion)] text-white" : "text-muted-foreground hover:text-foreground")}>
            <I size={14} strokeWidth={2.2} />
        </button>
    );
}

/** Algo que no se elige (lo decide el sistema): ícono quieto, la explicación en la ayuda. */
function Dato({ clave, icono: Ic, className, rotulo }: { clave: string; icono: any; className?: string; rotulo: string }) {
    return (
        <span tabIndex={0} aria-label={rotulo} data-tooltip-id={TT} data-tooltip-content={clave}
            className={cn("h-[30px] w-[30px] rounded-md grid place-items-center cursor-help text-muted-foreground hover:text-foreground", className)}>
            <Ic size={14} strokeWidth={2.2} />
        </span>
    );
}

const Grupo = ({ children }: { children: React.ReactNode }) => (
    <div className="flex items-center h-[34px] rounded-lg bg-muted/60 p-0.5 gap-0.5">{children}</div>
);

const estado = (v: boolean) => <span className={cn("font-semibold", v ? "tono-accion" : "")}>{v ? "Prendido" : "Apagado"}</span>;

export function ComportamientoPestania({ pestania, comportamiento, alCambiar, guardando, avisos }: {
    pestania: ClavePestania;
    comportamiento: Comportamiento;
    alCambiar: (clave: ClaveComportamiento, cambio: Partial<Interruptores>) => void;
    guardando?: boolean;
    /** Lista negra: las reglas de Notificaciones que escuchan WATCHLIST. */
    avisos?: { activas: number; total: number; canales: string[] } | null;
}) {
    if (pestania === "listanegra") {
        const b = comportamiento.busqueda;
        const ayudas: Record<string, Ayuda> = {
            alerta: { titulo: "Alerta máxima", cuerpo: <div className="space-y-2"><Muestra clase="alerta" color /><ExplicacionCategoria cat="BLACKLISTED" /></div> },
            busqueda: { titulo: "En búsqueda", cuerpo: <div className="space-y-2"><Muestra clase="busqueda" color /><ExplicacionCategoria cat="SEARCH" /></div> },
            sonido: { titulo: "Sonido al pasar alguien en búsqueda", cuerpo: <>{estado(b.sonido)}. Suena el aviso corto cuando una cámara lee una matrícula en búsqueda, en el monitor LPR y en Control LPR (si tienen el sonido prendido). La alerta máxima suena siempre. Tocá para cambiarlo.</> },
            // Dos caminos distintos, y se dicen los dos: el servidor manda SIEMPRE un Telegram al
            // grupo de la guardia (server.js → notifyWatchTelegram), y además están las reglas de
            // Notificaciones que escuchan WATCHLIST. Decir «ninguna regla avisa» a secas hacía
            // creer que nadie se enteraba.
            telegram: { titulo: "Telegram a la guardia: siempre", cuerpo: "Cada vez que una cámara lee una matrícula de esta lista, el servidor manda un Telegram al grupo de la guardia con la matrícula, quién es, el motivo y la cámara." },
            reglas: { titulo: avisos == null ? "Reglas de aviso…" : avisos.activas ? `${avisos.activas} regla${avisos.activas === 1 ? "" : "s"} de aviso${avisos.canales.length ? ` (${avisos.canales.join(", ")})` : ""}` : "Ninguna regla de WhatsApp la escucha",
                cuerpo: "A quién más se le avisa (WhatsApp, correo), por qué canal y en qué horario lo deciden las reglas de Notificaciones que escuchan «lista negra». Tocá para configurarlas allá." },
        };
        const sinReglas = avisos != null && !avisos.activas;
        return (
            <div className="flex items-center gap-1.5">
                <Grupo>
                    <Dato clave="alerta" icono={Ban} rotulo="Alerta máxima" className="tono-mal hover:text-[inherit]" />
                    <Dato clave="busqueda" icono={Search} rotulo="En búsqueda" className="tono-aviso hover:text-[inherit]" />
                    <Llave clave="sonido" icono={Volume2} iconoApagado={VolumeX} rotulo="Sonido al pasar" valor={b.sonido} deshabilitado={guardando}
                        alCambiar={(v) => alCambiar("busqueda", { sonido: v })} />
                </Grupo>
                <Grupo>
                    <Dato clave="telegram" icono={Send} rotulo="Telegram a la guardia" />
                    <Link href="/admin/notificaciones" aria-label="Reglas de aviso" data-tooltip-id={TT} data-tooltip-content="reglas"
                        className={cn("relative h-[30px] w-[30px] rounded-md grid place-items-center hover:text-foreground", sinReglas ? "tono-aviso" : "text-muted-foreground")}>
                        <MessageSquare size={14} strokeWidth={2.2} />
                        {avisos != null && (
                            <span className={cn("absolute -top-1 -right-1 min-w-[15px] h-[15px] px-1 rounded-full text-[9.5px] font-bold tabular-nums grid place-items-center",
                                sinReglas ? "pleno-aviso" : "bg-[var(--accion)] text-white")}>{avisos.activas}</span>
                        )}
                    </Link>
                </Grupo>
                <Ayudas ayudas={ayudas} />
            </div>
        );
    }

    const clave = pestania as Exclude<ClavePestania, "listanegra">;
    const c = comportamiento[clave];
    const fijo = LO_FIJO[clave];
    const conVip = PESTANIAS_CON_VIP.includes(pestania);
    const ayudas: Record<string, Ayuda> = {
        color: { titulo: "Color propio en el monitor", cuerpo: <div className="space-y-2"><Muestra clase={clave} color={c.color} /><div>{estado(c.color)}. La tarjeta del monitor LPR y la etiqueta de Control LPR llevan el color de esta pestaña. Apagado, la etiqueta se sigue viendo, en gris: para que lo que importa resalte más.</div></div> },
        sonido: { titulo: "Sonido al pasar", cuerpo: <>{estado(c.sonido)}. Suena el aviso corto cada vez que una cámara lee a alguien de esta pestaña: en el monitor LPR (con su sonido prendido) y en Control LPR de Monitores (si esa pantalla tiene sonido).</> },
        vip: { titulo: "Sonido al pasar un VIP", cuerpo: <div className="space-y-2"><Muestra clase="vip" color /><div>{estado(comportamiento.vip.sonido)}. VIP se marca en la ficha de cada persona; el monitor lo destaca en verde y no cambia lo que decide la barrera. Con esto, además, suena al pasar.</div></div> },
        barrera: { titulo: "En la barrera", cuerpo: fijo.barrera },
        monitores: { titulo: "En Control LPR", cuerpo: fijo.monitores },
    };
    return (
        <div className="flex items-center gap-1.5">
            <Grupo>
                <Llave clave="color" icono={Palette} rotulo="Color propio" valor={c.color} deshabilitado={guardando} alCambiar={(v) => alCambiar(clave, { color: v })} />
                <Llave clave="sonido" icono={Volume2} iconoApagado={VolumeX} rotulo="Sonido al pasar" valor={c.sonido} deshabilitado={guardando} alCambiar={(v) => alCambiar(clave, { sonido: v })} />
                {conVip && <Llave clave="vip" icono={Star} rotulo="Sonido al pasar un VIP" valor={comportamiento.vip.sonido} deshabilitado={guardando} alCambiar={(v) => alCambiar("vip", { sonido: v })} />}
            </Grupo>
            <Grupo>
                <Dato clave="barrera" icono={DoorClosed} rotulo="En la barrera" />
                <Dato clave="monitores" icono={MonitorPlay} rotulo="En Control LPR" />
            </Grupo>
            <Ayudas ayudas={ayudas} />
        </div>
    );
}
