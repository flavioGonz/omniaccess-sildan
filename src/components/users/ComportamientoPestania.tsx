"use client";

import Link from "next/link";
import { Ban, BellRing, DoorClosed, MessageSquare, MonitorPlay, Palette, Search, Star, Volume2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Switch } from "@/components/ui/switch";
import { Pista } from "@/components/ui/pista";
import { ExplicacionCategoria } from "@/components/WatchlistDialog";
import {
    ESTILO_APAGADO, ESTILO_MONITOR, LO_FIJO, PESTANIAS_CON_VIP,
    type ClaseMonitor, type ClavePestania, type ClaveComportamiento, type Comportamiento, type Interruptores,
} from "@/lib/padron";

/**
 * «Cómo se comporta»: la franja de arriba de cada pestaña.
 *
 * Dos clases de cosas, y se ven distintas a propósito:
 *   · lo FIJO (la barrera, las lectoras, la alarma de la lista negra) va como texto con su
 *     explicación al pasar el mouse — no se puede elegir, así que no se dibuja como control;
 *   · los INTERRUPTORES son reales: los lee el monitor LPR al cargar (color propio, sonido al
 *     pasar). Cambiarlos se guarda en el momento.
 *
 * La muestra «así se ve en el monitor» usa las mismas clases que el monitor (lib/padron →
 * ESTILO_MONITOR), sobre fondo oscuro como la consola: una muestra que no coincide con la
 * pantalla enseña otra cosa.
 */

function Muestra({ clase, color }: { clase: ClaseMonitor; color: boolean }) {
    const e = ESTILO_MONITOR[clase];
    return (
        <Pista titulo="Así se ve en el monitor LPR" texto={color ? "Con su color: la franja de la tarjeta y la etiqueta." : "Sin color propio: la etiqueta se sigue viendo, en gris."}>
            <span className="inline-flex items-center gap-1.5 h-7 pl-1.5 pr-2 rounded-[6px] bg-neutral-900">
                <span className={cn("w-1 h-4 rounded-full", color ? e.dot : "bg-neutral-700")} />
                <span className={cn("text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded", color ? e.badge : ESTILO_APAGADO.badge)}>{e.etiqueta}</span>
            </span>
        </Pista>
    );
}

function Interruptor({ icono: Ic, rotulo, ayuda, valor, alCambiar, deshabilitado }: {
    icono: any; rotulo: string; ayuda: string; valor: boolean; alCambiar: (v: boolean) => void; deshabilitado?: boolean;
}) {
    return (
        <Pista titulo={rotulo} texto={ayuda} lado="abajo" ancho={280}>
            <label className="inline-flex items-center gap-2 cursor-pointer select-none">
                <Switch checked={valor} onCheckedChange={alCambiar} disabled={deshabilitado} aria-label={rotulo} />
                <span className="inline-flex items-center gap-1 text-[12px] text-foreground/90"><Ic size={13} className="text-muted-foreground" /> {rotulo}</span>
            </label>
        </Pista>
    );
}

function Fijo({ icono: Ic, rotulo, texto }: { icono: any; rotulo: string; texto: React.ReactNode }) {
    return (
        <Pista titulo={rotulo} texto={texto} lado="abajo" ancho={320}>
            <span className="inline-flex items-center gap-1 text-[12px] text-muted-foreground cursor-help underline decoration-dotted decoration-muted-foreground/40 underline-offset-[3px]">
                <Ic size={13} /> {rotulo}
            </span>
        </Pista>
    );
}

const Separador = () => <span className="hidden md:block w-px h-6 bg-border" />;

export function ComportamientoPestania({ pestania, comportamiento, alCambiar, guardando, avisos }: {
    pestania: ClavePestania;
    comportamiento: Comportamiento;
    alCambiar: (clave: ClaveComportamiento, cambio: Partial<Interruptores>) => void;
    guardando?: boolean;
    /** Lista negra: las reglas de Notificaciones que escuchan WATCHLIST. */
    avisos?: { activas: number; total: number; canales: string[] } | null;
}) {
    const marco = "rounded-[10px] border border-border bg-card px-4 py-2.5 flex flex-wrap items-center gap-x-5 gap-y-2";
    const rotulo = <span className="text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Cómo se comporta</span>;

    if (pestania === "listanegra") {
        const b = comportamiento.busqueda;
        return (
            <section className={marco}>
                {rotulo}
                <span className="inline-flex items-center gap-2">
                    <Muestra clase="alerta" color />
                    <Fijo icono={Ban} rotulo="Alerta máxima: deniega, lectoras y alarma" texto={<ExplicacionCategoria cat="BLACKLISTED" />} />
                </span>
                <Separador />
                <span className="inline-flex items-center gap-3 flex-wrap">
                    <Muestra clase="busqueda" color />
                    <Fijo icono={Search} rotulo="En búsqueda: pasa y avisa" texto={<ExplicacionCategoria cat="SEARCH" />} />
                    <Interruptor icono={Volume2} rotulo="Sonido al pasar" valor={b.sonido} deshabilitado={guardando}
                        ayuda="Suena el aviso corto en el monitor LPR cuando una cámara lee una matrícula en búsqueda (si el sonido del monitor está prendido). La alerta máxima suena siempre."
                        alCambiar={(v) => alCambiar("busqueda", { sonido: v })} />
                </span>
                <Separador />
                <span className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground">
                    <MessageSquare size={13} />
                    {avisos == null ? "Avisos…" : avisos.activas
                        ? <>WhatsApp / Telegram: <b className="text-foreground tabular-nums">{avisos.activas}</b> regla{avisos.activas === 1 ? "" : "s"}{avisos.canales.length ? ` (${avisos.canales.join(", ")})` : ""}</>
                        : <span className="tono-aviso">Ninguna regla avisa por WhatsApp o Telegram</span>}
                    <Pista titulo="Avisos fuera de la pantalla" texto="A quién se le avisa, por qué canal y en qué horario lo deciden las reglas de Notificaciones que escuchan «lista negra» (WATCHLIST). Se cambian allá: un interruptor acá que no tocara esas reglas mentiría.">
                        <Link href="/admin/notificaciones" className="tono-accion font-semibold ml-1">Configurar</Link>
                    </Pista>
                </span>
            </section>
        );
    }

    const clave = pestania as Exclude<ClavePestania, "listanegra">;
    const c = comportamiento[clave];
    const fijo = LO_FIJO[clave];
    return (
        <section className={marco}>
            {rotulo}
            <Muestra clase={clave} color={c.color} />
            <Interruptor icono={Palette} rotulo="Color propio" valor={c.color} deshabilitado={guardando}
                ayuda="La tarjeta del monitor LPR lleva el color de esta pestaña. Apagado, la etiqueta se sigue viendo, en gris: para que lo que importa resalte más."
                alCambiar={(v) => alCambiar(clave, { color: v })} />
            <Interruptor icono={Volume2} rotulo="Sonido al pasar" valor={c.sonido} deshabilitado={guardando}
                ayuda="Suena el aviso corto en el monitor LPR cada vez que una cámara lee a alguien de esta pestaña (si el sonido del monitor está prendido)."
                alCambiar={(v) => alCambiar(clave, { sonido: v })} />
            {PESTANIAS_CON_VIP.includes(pestania) && (
                <>
                    <Separador />
                    <span className="inline-flex items-center gap-3">
                        <Muestra clase="vip" color />
                        <Interruptor icono={BellRing} rotulo="Sonido al pasar un VIP" valor={comportamiento.vip.sonido} deshabilitado={guardando}
                            ayuda="VIP se marca en la ficha de cada persona (Residentes y Personal). El monitor lo destaca en verde; con esto además suena al pasar."
                            alCambiar={(v) => alCambiar("vip", { sonido: v })} />
                    </span>
                </>
            )}
            <Separador />
            <Fijo icono={DoorClosed} rotulo="En la barrera" texto={fijo.barrera} />
            <Fijo icono={MonitorPlay} rotulo="En Control LPR" texto={fijo.monitores} />
            {pestania === "residentes" && <Fijo icono={Star} rotulo="VIP" texto="Una marca de la persona, en su ficha: el monitor la destaca. No cambia lo que decide la barrera." />}
        </section>
    );
}
