"use client";

import { useState } from "react";
import Link from "next/link";
import { Building2, CalendarDays, Car, Cctv, ChevronRight, Cpu, CreditCard, FileVideo, History, KeyRound, Map as MapaIcono, MapPin, Pin, PinOff, Radar, Rows3, ScanEye, ScanFace, ShieldCheck, Siren, SlidersHorizontal, Users } from "lucide-react";
import { insigniaDeGrupo, type EntradaMenu, type HojaConGrupo, type IconoMenu, type Insignia, type SeccionMenu } from "@/lib/menu";
import { FIJADOS_MAX } from "@/lib/menu-fijados";
import { cn } from "@/lib/utils";

/**
 * El menú del panel, dibujado (23/11).
 *
 * Qué entradas hay y en qué orden lo dice lib/menu.ts; acá sólo está cómo se ven. La forma es la del
 * menú de Cloudflare, que es lo que Nico pidió («quiero ese estilo de sidebar, mismo estilo»):
 *  · secciones con un título chico y gris, en minúsculas —no los rótulos de colores «LPR» y «Face»
 *    que había, que usaban el color para decir algo que no era un estado—;
 *  · cada módulo es una entrada con una flecha que se abre, y sus pantallas cuelgan de una línea;
 *  · la pantalla en la que se está es una pastilla gris suave. No es azul: el azul es para lo que
 *    se aprieta para HACER algo, y esto dice dónde se está.
 *
 * Cuántos módulos quedan abiertos (Nico lo dejó a criterio): el del lugar donde uno está, siempre;
 * se pueden abrir otros para mirar; y al entrar a una pantalla se cierran los que no son el suyo. Un
 * acordeón estricto obliga a reabrir al ir y venir entre dos módulos; dejarlos todos abiertos vuelve
 * a la lista larga que se quería sacar.
 */

/** El dibujo de cada entrada. Lo usa también el buscador (Buscador.tsx), para que una pantalla se vea igual en los dos lados. */
export const ICONOS_MENU: Record<IconoMenu, React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>> = {
    alarmas: Siren, mapa: MapaIcono, historial: History, evidencias: FileVideo, matriculas: Car, rostro: ScanFace, intrusion: Radar, video: Cctv, gps: MapPin,
    guardia: ShieldCheck, vision: ScanEye, filas: Rows3, personas: Users, unidades: Building2, tags: CreditCard, grupos: KeyRound, calendario: CalendarDays, equipos: Cpu, ajustes: SlidersHorizontal,
};

/** La cuenta de algo que espera: en el tono de su lista, y suave —es un dato, no un botón—. */
function Cuenta({ i, punto }: { i: Insignia; punto?: boolean }) {
    if (punto) return <span className={cn("absolute right-1.5 top-1.5 h-2 w-2 rounded-full", i.tono === "aviso" ? "bg-[var(--aviso)]" : "bg-[var(--mal)]")} />;
    return <span className={cn("shrink-0 rounded-full border px-1.5 text-[10.5px] font-semibold leading-[17px] tabular-nums", i.tono === "aviso" ? "chip-aviso" : "chip-mal")}>{i.n > 99 ? "99+" : i.n}</span>;
}

const FILA = "group relative flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-[13.5px] text-foreground/80 outline-none transition-colors hover:bg-accent/70 hover:text-foreground focus-visible:ring-2 focus-visible:ring-[var(--accion)]";
const ACTIVA = "bg-accent font-medium text-foreground";

/** Lo que hace falta para fijar y soltar: qué está fijado y cómo cambiarlo. */
type Fijar = { ids: string[]; alternar: (id: string) => void };

/**
 * El alfiler de cada pantalla (24/11). Nico: «cada elemento del menú debe tener un ícono invisible
 * que al pasar por encima se ve, para fijar el elemento arriba del todo».
 *
 * Invisible hasta que el mouse está sobre el renglón (o el foco del teclado sobre él): treinta
 * alfileres a la vista serían treinta cosas más para mirar en un menú que se acaba de ordenar. Va
 * AL LADO del enlace y no adentro —un botón adentro de un enlace no es válido, y apretarlo navegaría—,
 * encima del lugar de la insignia, que mientras tanto queda tapada: en ese momento se está eligiendo
 * qué fijar, no leyendo cuántas hay.
 */
function Alfiler({ id, rotulo, fijar }: { id: string; rotulo: string; fijar: Fijar }) {
    const fijada = fijar.ids.includes(id);
    const lleno = !fijada && fijar.ids.length >= FIJADOS_MAX;
    const dicho = fijada ? "Quitar de arriba" : lleno ? `Ya hay ${FIJADOS_MAX} fijadas: quitá una para fijar otra` : "Fijar arriba del menú";
    return (
        <button type="button" disabled={lleno} onClick={() => fijar.alternar(id)} title={dicho} aria-label={`${fijada ? "Quitar de arriba" : "Fijar arriba"}: ${rotulo}`} aria-pressed={fijada}
            className="absolute right-1 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-md bg-accent text-muted-foreground opacity-0 outline-none transition-opacity hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-[var(--accion)] disabled:cursor-not-allowed group-hover/fila:opacity-100">
            {fijada ? <PinOff size={13} /> : <Pin size={13} />}
        </button>
    );
}
/** Cómo se ve el enlace de un renglón mientras el mouse está sobre su alfiler (que es su vecino, no su hijo). */
const SOBRE_LA_FILA = "group-hover/fila:bg-accent/70 group-hover/fila:text-foreground";

export function MenuLateral({ menu, activo, plegado, fijadas, fijar }: {
    menu: SeccionMenu[];
    /** La pantalla en la que se está (lib/menu, `activoDe`), o null si no está en el menú. */
    activo: { id: string; grupo: string | null } | null;
    /** Sólo íconos. */
    plegado: boolean;
    /** Las pantallas fijadas arriba de todo, en su orden (lib/menu-fijados). */
    fijadas: HojaConGrupo[];
    fijar: Fijar;
}) {
    /* Lo que se abrió a mano, anotado junto con la pantalla en la que se estaba: al cambiar de
       pantalla deja de valer solo, sin un efecto que lo limpie. */
    const [aMano, setAMano] = useState<{ en: string; abiertos: string[]; cerrados: string[] }>({ en: "", abiertos: [], cerrados: [] });
    const donde = activo?.id || "";
    const vale = aMano.en === donde ? aMano : { en: donde, abiertos: [], cerrados: [] };
    const estaAbierto = (id: string) => (id === activo?.grupo ? !vale.cerrados.includes(id) : vale.abiertos.includes(id));
    const alternar = (id: string) => {
        const abierto = estaAbierto(id), saca = (l: string[]) => l.filter((x) => x !== id);
        setAMano({ en: donde, abiertos: abierto ? saca(vale.abiertos) : [...saca(vale.abiertos), id], cerrados: abierto ? [...saca(vale.cerrados), id] : saca(vale.cerrados) });
    };

    return (
        <>
            {/* ── Lo fijado: los atajos de quien usa este puesto. Cada uno sigue estando, además, en su módulo. ── */}
            {fijadas.length > 0 && (
                <div className="mb-1.5 border-b border-border pb-1.5">
                    <ul className="space-y-0.5">
                        {fijadas.map((h) => {
                            const Icono = ICONOS_MENU[h.icono], esta = activo?.id === h.id;
                            return (
                                <li key={h.id} className="group/fila relative">
                                    <Link href={h.href} title={plegado ? h.rotulo : undefined} aria-label={plegado ? h.rotulo : undefined} data-activa={esta} className={cn(FILA, SOBRE_LA_FILA, esta && ACTIVA, plegado && "justify-center px-0")}>
                                        <Icono size={16} strokeWidth={1.7} className="shrink-0 text-muted-foreground group-hover:text-foreground group-data-[activa=true]:text-foreground" />
                                        {!plegado && <span className="min-w-0 flex-1 truncate">{h.rotulo}{h.rotuloGrupo && <span className="ml-1.5 text-[11.5px] font-normal text-muted-foreground">{h.rotuloGrupo}</span>}</span>}
                                        {h.insignia && <Cuenta i={h.insignia} punto={plegado} />}
                                    </Link>
                                    {!plegado && <Alfiler id={h.id} rotulo={h.rotulo} fijar={fijar} />}
                                </li>
                            );
                        })}
                    </ul>
                </div>
            )}
            {menu.map((s, n) => (
                <div key={s.id}>
                    {s.titulo && (plegado
                        ? <div className="mx-2 my-2 border-t border-border" />
                        : <div className={cn("px-2.5 pb-1 text-[12px] font-medium text-muted-foreground", n ? "pt-4" : "pt-1")}>{s.titulo}</div>)}
                    <ul className="space-y-0.5">
                        {s.entradas.map((e) => <li key={e.id} className={e.hijos ? undefined : "group/fila relative"}><Entrada e={e} activo={activo} plegado={plegado} abierto={!!e.hijos && estaAbierto(e.id)} alAlternar={() => alternar(e.id)} fijar={fijar} /></li>)}
                    </ul>
                </div>
            ))}
        </>
    );
}

function Entrada({ e, activo, plegado, abierto, alAlternar, fijar }: { e: EntradaMenu; activo: { id: string; grupo: string | null } | null; plegado: boolean; abierto: boolean; alAlternar: () => void; fijar: Fijar }) {
    const Icono = ICONOS_MENU[e.icono];
    const dibujo = <Icono size={16} strokeWidth={1.7} className="shrink-0 text-muted-foreground group-hover:text-foreground group-data-[activa=true]:text-foreground" />;
    /* Plegado no hay dónde escribir el nombre: lo dice el navegador al pasar el mouse. Un cartel propio
       al costado quedaba cortado por la lista, que tiene su propio desplazamiento. */
    const nombre = plegado ? e.rotulo : undefined;

    /* ── Una pantalla ── */
    if (!e.hijos) {
        const esta = activo?.id === e.id;
        return (
            <>
                <Link href={e.href} title={nombre} aria-label={nombre} data-activa={esta} aria-current={esta ? "page" : undefined} className={cn(FILA, SOBRE_LA_FILA, esta && ACTIVA, plegado && "justify-center px-0")}>
                    {dibujo}
                    {!plegado && <span className="min-w-0 flex-1 truncate">{e.rotulo}</span>}
                    {e.insignia && <Cuenta i={e.insignia} punto={plegado} />}
                </Link>
                {!plegado && <Alfiler id={e.id} rotulo={e.rotulo} fijar={fijar} />}
            </>
        );
    }

    /* ── Un módulo ── */
    const suyo = activo?.grupo === e.id;
    const pendiente = insigniaDeGrupo(e.hijos);
    /* Plegado no se puede abrir: lleva a su primera pantalla, que es la más usada del módulo. */
    if (plegado) {
        return (
            <Link href={e.hijos[0].href} title={nombre} aria-label={nombre} data-activa={suyo} className={cn(FILA, "justify-center px-0", suyo && ACTIVA)}>
                {dibujo}
                {pendiente && <Cuenta i={pendiente} punto />}
            </Link>
        );
    }
    return (
        <>
            {/* El módulo que tiene adentro la pantalla abierta se nota aunque esté cerrado: el nombre va en el color del texto pleno. */}
            <button type="button" onClick={alAlternar} aria-expanded={abierto} data-activa={suyo} className={cn(FILA, "text-left", suyo && "text-foreground")}>
                {dibujo}
                <span className="min-w-0 flex-1 truncate">{e.rotulo}</span>
                {e.nuevo && <span className="shrink-0 rounded-full border border-border bg-background px-1.5 text-[10.5px] font-medium leading-[17px] text-foreground/80">Nuevo</span>}
                {/* Cerrado, suma lo que espera adentro: cerrado no es vacío. Abierto, cada cuenta está en su renglón. */}
                {!abierto && pendiente && <Cuenta i={pendiente} />}
                <ChevronRight size={15} className={cn("shrink-0 text-muted-foreground/70 transition-transform duration-200", abierto && "rotate-90")} />
            </button>
            {abierto && (
                <ul className="mb-1 ml-[17px] mt-0.5 space-y-0.5 border-l border-border pl-2.5">
                    {e.hijos.map((h) => {
                        const esta = activo?.id === h.id;
                        return (
                            <li key={h.id} className="group/fila relative">
                                <Link href={h.href} data-activa={esta} aria-current={esta ? "page" : undefined} className={cn(FILA, SOBRE_LA_FILA, "h-[33px] text-[13px]", esta && ACTIVA)}>
                                    <span className="min-w-0 flex-1 truncate">{h.rotulo}</span>
                                    {h.insignia && <Cuenta i={h.insignia} />}
                                </Link>
                                <Alfiler id={h.id} rotulo={h.rotulo} fijar={fijar} />
                            </li>
                        );
                    })}
                </ul>
            )}
        </>
    );
}
