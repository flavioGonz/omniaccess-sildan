"use client";

import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { CreditCard, Fingerprint, ScanFace, ScrollText, ShieldCheck, UserRound, Users } from "lucide-react";
import { baseDelEquipo, type BaseEquipo, type PersonaDeBase } from "@/app/actions/base-equipo";
import { Cargando, ErrorEstado } from "@/components/ui/estados";
import { cn } from "@/lib/utils";

/**
 * La base local de un lector: lo que tiene guardado adentro, y cuánto de eso conocemos.
 *
 * Pedido de Nico (19/11): «tema lectura de rostros, base de datos locales de cada lector, logs,
 * registros, rostros».
 *
 * Lo que hace útil esta pantalla no es la lista: es el CRUCE. Un lector con 417 personas y un
 * padrón con otras tantas son dos listas que nadie comparó nunca, y la pregunta que importa
 * —¿quién puede abrir esta puerta y no está en el sistema?— no se podía contestar sin dos
 * pantallas al lado. Acá cada persona del equipo dice si la conocemos, y por qué.
 */

const RESORTE = { type: "spring" as const, bounce: 0, duration: 0.35 };
const SUAVE = { duration: 0.14, ease: "easeOut" as const };
const POR_PAGINA = 30;

export function BaseDeEquipos({ equipos, elegido, alElegir }: {
    equipos: { id: string; nombre: string }[];
    elegido: string | null;
    alElegir: (id: string) => void;
}) {
    const quieto = useReducedMotion();
    const [datos, setDatos] = useState<BaseEquipo | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [desde, setDesde] = useState(0);
    const [cargando, setCargando] = useState(false);

    const id = elegido || equipos[0]?.id || null;
    const traer = useCallback(async () => {
        if (!id) return;
        setCargando(true);
        try { setDatos(await baseDelEquipo(id, desde)); setError(null); }
        catch (e: unknown) { setError(e instanceof Error ? e.message : "No se pudo leer la base"); setDatos(null); }
        finally { setCargando(false); }
    }, [id, desde]);
    useEffect(() => { traer(); }, [traer]);
    useEffect(() => { setDesde(0); }, [id]);

    if (!id) return <p className="px-6 lg:px-8 py-6 text-[12.5px] text-muted-foreground">No hay ningún portero ni control de acceso dado de alta.</p>;
    if (error) return <div className="px-6 lg:px-8 py-6"><ErrorEstado mensaje={error} alReintentar={traer} /></div>;
    if (!datos) return <div className="px-6 lg:px-8 py-6"><Cargando texto="Preguntándole al equipo qué tiene cargado…" /></div>;

    const c = datos.cuenta;
    const paginas = Math.max(1, Math.ceil(datos.total / POR_PAGINA));
    const pagina = Math.floor(desde / POR_PAGINA) + 1;

    return (
        <div className="px-6 lg:px-8 pb-10">
            {/* Qué equipo se está mirando. Con uno solo no hay nada que elegir y no se dibuja. */}
            {equipos.length > 1 && (
                <div className="flex items-center gap-1.5 flex-wrap mb-4">
                    {equipos.map((e) => (
                        <button key={e.id} type="button" onClick={() => alElegir(e.id)}
                            className={cn("relative h-8 px-3.5 rounded-full text-[12.5px] font-semibold transition-colors",
                                e.id === id ? "text-background" : "text-muted-foreground hover:text-foreground hover:bg-accent/60")}>
                            {e.id === id && <motion.span layoutId="base-equipo-activo" transition={quieto ? SUAVE : RESORTE} className="absolute inset-0 rounded-full bg-foreground" />}
                            <span className="relative">{e.nombre}</span>
                        </button>
                    ))}
                </div>
            )}

            <div className="grid gap-2.5 [grid-template-columns:repeat(auto-fit,minmax(132px,1fr))]">
                <Cifra icono={Users} titulo="Personas" valor={c.personas} />
                <Cifra icono={CreditCard} titulo="Tarjetas" valor={c.tarjetas} />
                <Cifra icono={ScanFace} titulo="Rostros" valor={c.rostros} />
                <Cifra icono={Fingerprint} titulo="Huellas" valor={c.huellas ? "sí" : "no las maneja"} apagado={!c.huellas} />
                <Cifra icono={ScrollText} titulo="Bitácora" valor={c.bitacora ? "se puede pedir" : "no la guarda"} apagado={!c.bitacora} />
            </div>

            {datos.error && <p className="mt-3 text-[12.5px] tono-aviso">{datos.error}</p>}

            {datos.personas.length > 0 && (<>
                <div className="mt-6 flex items-baseline gap-2">
                    <h2 className="text-[9.5px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Personas cargadas en el equipo</h2>
                    <span className="text-[11.5px] text-muted-foreground tabular-nums">
                        {desde + 1}–{Math.min(desde + datos.personas.length, datos.total)} de {datos.total} · {datos.enPadron} de esta página están en el padrón
                    </span>
                </div>

                <div className="mt-2 rounded-[12px] border border-border overflow-hidden divide-y divide-border">
                    <AnimatePresence initial={false} mode="popLayout">
                        {datos.personas.map((x) => <Fila key={x.legajo} x={x} quieto={!!quieto} />)}
                    </AnimatePresence>
                </div>

                {paginas > 1 && (
                    <div className="mt-3 flex items-center justify-center gap-3 text-[12.5px]">
                        <button type="button" disabled={desde === 0 || cargando} onClick={() => setDesde(Math.max(0, desde - POR_PAGINA))}
                            className="h-8 px-3 rounded-full border border-border font-semibold hover:bg-accent disabled:opacity-40">Anteriores</button>
                        <span className="text-muted-foreground tabular-nums">{pagina} de {paginas}</span>
                        <button type="button" disabled={pagina >= paginas || cargando} onClick={() => setDesde(desde + POR_PAGINA)}
                            className="h-8 px-3 rounded-full border border-border font-semibold hover:bg-accent disabled:opacity-40">Siguientes</button>
                    </div>
                )}
            </>)}
        </div>
    );
}

/** Una persona del equipo, y si la conocemos. */
function Fila({ x, quieto }: { x: PersonaDeBase; quieto: boolean }) {
    return (
        <motion.div layout={!quieto} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={quieto ? SUAVE : RESORTE}
            className="flex items-center gap-3 px-3.5 py-2.5 bg-card">
            <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-full", x.padron ? "chip-bien" : "bg-muted text-muted-foreground")}>
                {x.padron ? <ShieldCheck size={16} /> : <UserRound size={16} />}
            </span>
            <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-2">
                    <span className="font-bold text-[13px] truncate">{x.nombre || `Legajo ${x.legajo}`}</span>
                    <span className="text-[11px] text-muted-foreground tabular-nums shrink-0">{x.legajo}</span>
                </span>
                <span className="block text-[11.5px] text-muted-foreground truncate">
                    {x.padron
                        ? <>En el padrón como <b className="text-foreground font-semibold">{x.padron.nombre}</b>{x.padron.unidad ? ` · ${x.padron.unidad}` : ""}<span className="opacity-70"> (por {x.porQue === "legajo" ? "su legajo" : "el nombre"})</span></>
                        : "No figura en el padrón de OmniAccess"}
                </span>
            </span>
            <span className="shrink-0 flex items-center gap-1.5 text-[11px]">
                {x.rostros > 0 && <span className="inline-flex items-center gap-1 h-[20px] px-1.5 rounded chip-info"><ScanFace size={10} /> {x.rostros}</span>}
                {x.tarjetas > 0 && <span className="inline-flex items-center gap-1 h-[20px] px-1.5 rounded chip-quieto"><CreditCard size={10} /> {x.tarjetas}</span>}
                {x.huellas > 0 && <span className="inline-flex items-center gap-1 h-[20px] px-1.5 rounded chip-quieto"><Fingerprint size={10} /> {x.huellas}</span>}
            </span>
        </motion.div>
    );
}

function Cifra({ icono: Ico, titulo, valor, apagado }: { icono: typeof Users; titulo: string; valor: number | string | null; apagado?: boolean }) {
    const hay = valor !== null && valor !== undefined;
    return (
        <div className={cn("rounded-[12px] border border-border bg-card px-3.5 py-3", apagado && "opacity-60")}>
            <div className="flex items-center gap-1.5 text-[9.5px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                <Ico size={12} /> {titulo}
            </div>
            <div className={cn("mt-1 font-bold leading-none", typeof valor === "number" ? "text-[22px] tabular-nums" : "text-[13px] mt-1.5")}>
                {hay ? valor : "—"}
            </div>
        </div>
    );
}
