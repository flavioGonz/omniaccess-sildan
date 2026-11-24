"use client";

import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { AlertTriangle, CalendarClock, CreditCard, Fingerprint, Plus, RefreshCw, ScanFace, ScrollText, ShieldCheck, ShieldX, UserRound, Users } from "lucide-react";
import { baseDelEquipo, type BaseEquipo, type PersonaDeBase } from "@/app/actions/base-equipo";
import { Button } from "@/components/ui/button";
import { Cargando, ErrorEstado } from "@/components/ui/estados";
import { Pista } from "@/components/ui/pista";
import { RostrosDelEquipo } from "@/components/devices/RostrosDelEquipo";
import { FichaPersonaEquipo } from "@/components/rostro/monitor-face/FichaPersonaEquipo";
import { fecha } from "@/lib/fechas";
import { cn } from "@/lib/utils";

/**
 * La base local de un lector: lo que tiene guardado adentro, y cuánto de eso conocemos.
 *
 * Pedido de Nico (19/11): «tema lectura de rostros, base de datos locales de cada lector, logs,
 * registros, rostros». Y el 24/11: «base de los lectores, debe ser tipo bento también, más premium;
 * se deben ver los datos, rostros, número de tarjeta».
 *
 * Lo que hace útil esta pantalla no es la lista: es el CRUCE. Un lector con 417 personas y un
 * padrón con otras tantas son dos listas que nadie comparó nunca, y la pregunta que importa
 * —¿quién puede abrir esta puerta y no está en el sistema?— no se podía contestar sin dos
 * pantallas al lado. Acá cada persona del equipo dice si la conocemos, y cada TARJETA de quién es
 * en el padrón: una tarjeta que abre la puerta y en el padrón es de otro, o de nadie, se ve sola.
 *
 * Por qué un bento y no la lista de antes: la lista mostraba «2 tarjetas» y había que abrir a cada
 * persona para saber cuáles. Ahora cada persona es una baldosa con sus números a la vista, y la
 * que tiene la cara cargada ocupa más (mapping, como en las capturas: más grande = más para ver).
 */

const RESORTE = { type: "spring" as const, bounce: 0, duration: 0.35 };
const SUAVE = { duration: 0.14, ease: "easeOut" as const };
const POR_PAGINA = 30;
/** Cuántos números de tarjeta entran en la baldosa; el resto queda en «+N» y en la ficha. */
const TARJETAS_A_LA_VISTA = 3;
/** El fin de vigencia que pone el equipo cuando no se le dice ninguno (y el que pone OmniAccess al dar de alta): no es un vencimiento. */
const SIN_VENCIMIENTO_DESDE = 2036;

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
    /** Qué persona se está editando: un legajo, `null` para una nueva, `undefined` para ninguna. */
    const [ficha, setFicha] = useState<string | null | undefined>(undefined);

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

    const selector = equipos.length > 1 && (
        <div className="flex items-center gap-1.5 flex-wrap">
            {equipos.map((e) => (
                <button key={e.id} type="button" onClick={() => alElegir(e.id)}
                    className={cn("relative h-8 px-3.5 rounded-full text-[12.5px] font-semibold transition-colors",
                        e.id === id ? "text-background" : "text-muted-foreground hover:text-foreground hover:bg-accent/60")}>
                    {e.id === id && <motion.span layoutId="base-equipo-activo" transition={quieto ? SUAVE : RESORTE} className="absolute inset-0 rounded-full bg-foreground" />}
                    <span className="relative">{e.nombre}</span>
                </button>
            ))}
        </div>
    );

    if (error) return <div className="px-6 lg:px-8 pb-10 space-y-4">{selector}<ErrorEstado mensaje={error} alReintentar={traer} /></div>;
    if (!datos) return <div className="px-6 lg:px-8 pb-10 space-y-4">{selector}<Cargando texto="Preguntándole al equipo qué tiene cargado…" /></div>;

    const c = datos.cuenta;
    const paginas = Math.max(1, Math.ceil(datos.total / POR_PAGINA));
    const pagina = Math.floor(desde / POR_PAGINA) + 1;
    const numerosPagina = datos.personas.reduce((a, x) => a + x.numeros.length, 0);
    const numerosAjenos = datos.personas.reduce((a, x) => a + x.numeros.filter((n) => !n.padron || (x.padron && n.padron.id !== x.padron.id)).length, 0);

    return (
        <div className="px-6 lg:px-8 pb-10 space-y-5">
            <div className="flex items-center gap-2 flex-wrap">
                {selector}
                <div className="ml-auto flex items-center gap-2">
                    <Button variant="ghost" size="sm" disabled={cargando} onClick={traer}><RefreshCw size={14} className={cn(cargando && "animate-spin")} /> Volver a leer</Button>
                    <Button size="sm" onClick={() => setFicha(null)}><Plus size={14} /> Cargar una persona</Button>
                </div>
            </div>

            {/* ── Lo que tiene el equipo, en un bento: la persona es el dato grande ── */}
            <div className="@container">
                <div className="grid gap-2.5 grid-cols-2 @2xl:grid-cols-4">
                    <section className="col-span-2 row-span-2 rounded-[14px] border border-border bg-card p-4 flex flex-col">
                        <div className="flex items-center gap-1.5 text-[9.5px] font-bold uppercase tracking-[0.14em] text-muted-foreground"><Users size={12} /> Personas cargadas</div>
                        <div className="mt-2 text-[44px] font-bold leading-none tracking-[-0.03em] tabular-nums">{c.personas ?? "—"}</div>
                        <p className="mt-1.5 text-[12px] text-muted-foreground">{datos.equipo.nombre} · {datos.equipo.marca.toLowerCase()}</p>
                        {datos.personas.length > 0 && (
                            <div className="mt-auto pt-4">
                                <div className="flex items-baseline justify-between text-[11.5px]">
                                    <Pista texto="El cruce se hace por el número con que OmniAccess cargó a la persona, por una credencial del padrón con su legajo, o por el nombre exacto. No se adivina nada más.">
                                        <span className="text-muted-foreground">En el padrón, de esta página</span>
                                    </Pista>
                                    <span className="font-semibold tabular-nums">{datos.enPadron} de {datos.personas.length}</span>
                                </div>
                                <div className="mt-1.5 flex h-2 gap-[2px] overflow-hidden rounded-full bg-muted">
                                    <span className="pleno-bien h-full rounded-l-full" style={{ width: `${(100 * datos.enPadron) / datos.personas.length}%` }} />
                                </div>
                            </div>
                        )}
                    </section>
                    <Cifra icono={CreditCard} titulo="Tarjetas" valor={c.tarjetas}
                        nota={numerosPagina ? (numerosAjenos ? `${numerosAjenos} de esta página no son de esa persona en el padrón` : "las de esta página coinciden con el padrón") : null}
                        tono={numerosAjenos ? "aviso" : undefined} />
                    <Cifra icono={ScanFace} titulo="Rostros" valor={c.rostros}
                        nota={datos.rostrosBiblioteca > 0 && datos.rostrosAtados === 0 ? "ninguno atado a una persona" : datos.rostrosAtados ? `${datos.rostrosAtados} de esta página con su cara` : null}
                        tono={datos.rostrosBiblioteca > 0 && datos.rostrosAtados === 0 ? "aviso" : undefined} />
                    <Cifra icono={Fingerprint} titulo="Huellas" valor={c.huellas ? "Las maneja" : "No las maneja"} apagado={!c.huellas} />
                    <Cifra icono={ScrollText} titulo="Bitácora" valor={c.bitacora ? "Se puede pedir" : "No la guarda"} apagado={!c.bitacora} />
                </div>
            </div>

            {datos.error && <p className="text-[12.5px] tono-aviso">{datos.error}</p>}

            {/* Medido el 19/11: en los equipos de producción las caras están cargadas con un
                identificador propio («414ad2», «arquitecto1») y sin nombre, así que no se atan a
                ninguna persona de la lista. Decirlo es el punto de la pantalla: una cara que puede
                abrir la puerta y no se sabe de quién es, es exactamente lo que hay que ver. */}
            {datos.rostrosBiblioteca > 0 && datos.rostrosAtados === 0 && (
                <p className="flex items-start gap-2 rounded-[12px] chip-aviso border px-3.5 py-2.5 text-[12.5px] leading-snug">
                    <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                    <span>Las {datos.rostrosBiblioteca} caras de este equipo están cargadas con un identificador propio, sin nombre y sin legajo: ninguna se puede atar a una persona de la lista. Se ven todas más abajo.</span>
                </p>
            )}

            {/* ── Las personas ── */}
            {datos.personas.length > 0 && (
                <section>
                    <div className="flex items-baseline gap-2 flex-wrap">
                        <h2 className="text-[9.5px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Personas cargadas en el equipo</h2>
                        <span className="text-[11.5px] text-muted-foreground tabular-nums">{desde + 1}–{Math.min(desde + datos.personas.length, datos.total)} de {datos.total}</span>
                    </div>
                    <div className="mt-2 grid gap-2.5 [grid-auto-flow:dense] [grid-auto-rows:20px] [grid-template-columns:repeat(auto-fill,minmax(236px,1fr))]">
                        <AnimatePresence initial={false} mode="popLayout">
                            {datos.personas.map((x) => <Baldosa key={x.legajo} x={x} deviceId={id} quieto={!!quieto} alAbrir={() => setFicha(x.legajo)} />)}
                        </AnimatePresence>
                    </div>
                    {paginas > 1 && (
                        <div className="mt-4 flex items-center justify-center gap-3 text-[12.5px]">
                            <Button variant="outline" size="sm" disabled={desde === 0 || cargando} onClick={() => setDesde(Math.max(0, desde - POR_PAGINA))}>Anteriores</Button>
                            <span className="text-muted-foreground tabular-nums">{pagina} de {paginas}</span>
                            <Button variant="outline" size="sm" disabled={pagina >= paginas || cargando} onClick={() => setDesde(desde + POR_PAGINA)}>Siguientes</Button>
                        </div>
                    )}
                </section>
            )}

            {/* Los rostros, acá abajo y no en otra pantalla. «¿Qué caras tiene cargadas este
                portero?» y «¿quién está cargado?» son la misma pregunta mirada de dos maneras;
                tenerlas separadas obligaba a irse a la ficha del equipo para ver una foto. */}
            <section>
                <h2 className="text-[9.5px] font-bold uppercase tracking-[0.14em] text-muted-foreground mb-2">Rostros cargados en el equipo</h2>
                <RostrosDelEquipo id={id} otros={equipos.filter((e) => e.id !== id)} amplio />
            </section>

            <AnimatePresence>
                {ficha !== undefined && (
                    <FichaPersonaEquipo deviceId={id} legajo={ficha} daFoto={datos.rostrosAtados > 0 || !!datos.personas.find((x) => x.fpid)}
                        alCerrar={() => setFicha(undefined)} alCambiar={traer} />
                )}
            </AnimatePresence>
        </div>
    );
}

/** Las iniciales para la baldosa sin foto: dicen de quién es sin inventar una cara. */
const iniciales = (n: string | null) => (n || "").trim().split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join("") || null;

/** Alto de una fila del bento de personas; con el hueco entre baldosas, cada fila suma `FILA_PX + 10`. */
const FILA_PX = 20;
/**
 * Cuántas filas ocupa una persona: se calcula con lo que lleva adentro, para que la baldosa no
 * quede con medio cuerpo vacío ni corte sus tarjetas. Se cuentan dos números de tarjeta por renglón,
 * que es lo que entra en el ancho mínimo (236 px).
 */
function filasDe(x: PersonaDeBase, conFoto: boolean, conMarcas: boolean): number {
    const items = Math.min(x.numeros.length, TARJETAS_A_LA_VISTA) + (x.numeros.length > TARJETAS_A_LA_VISTA ? 1 : 0);
    let alto = 24 + (conFoto ? 164 + 34 : 40) + 8 + 18;           // relleno, foto o iniciales, padrón
    if (items) alto += 8 + Math.ceil(items / 2) * 26;
    else if (x.tarjetas > 0) alto += 26;
    if (conMarcas) alto += 28;
    return Math.ceil((alto + 10) / (FILA_PX + 10));
}

/** Qué dice el equipo de la vigencia: nada si es la de siempre, aviso si ya venció. */
function vigencia(vence: string | null): { texto: string; vencida: boolean } | null {
    if (!vence) return null;
    const t = new Date(vence);
    if (!Number.isFinite(t.getTime()) || t.getFullYear() >= SIN_VENCIMIENTO_DESDE) return null;
    return t.getTime() < Date.now() ? { texto: `Venció el ${fecha(t)}`, vencida: true } : { texto: `Vale hasta el ${fecha(t)}`, vencida: false };
}

/**
 * Una persona del equipo, con todo a la vista: quién es en el padrón, sus tarjetas con el número,
 * su cara si el equipo la entrega, y lo que la marca (lista negra, visita, vencida).
 */
function Baldosa({ x, deviceId, quieto, alAbrir }: { x: PersonaDeBase; deviceId: string; quieto: boolean; alAbrir: () => void }) {
    /* La cara sale del equipo por nuestra ruta, nunca por una URL con credencial. Si ese equipo no
       entrega la foto —el terminal facial da la plantilla pero no la foto— el <img> falla y queda
       la baldosa sin foto: se degrada, no se inventa una silueta que parezca una persona. */
    const [sinFoto, setSinFoto] = useState(false);
    const hayFoto = !!x.fpid && !sinFoto;
    const v = vigencia(x.vence);
    const negra = x.tipo === "blackList";
    const visita = x.tipo === "visitor";
    const resto = x.numeros.length - TARJETAS_A_LA_VISTA;
    const filas = filasDe(x, hayFoto, !!(negra || visita || v));
    return (
        <motion.button type="button" onClick={alAbrir} layout={!quieto} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={quieto ? SUAVE : RESORTE}
            style={{ gridRow: `span ${filas}` }}
            className={cn("group relative flex flex-col overflow-hidden rounded-[14px] border bg-card text-left transition-colors hover:border-foreground/25",
                negra ? "border-[color-mix(in_oklab,var(--mal)_45%,transparent)]" : "border-border")}>
            {hayFoto && (
                <span className="relative block h-[164px] shrink-0 overflow-hidden bg-black">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/api/devices/rostros-equipo/foto?deviceId=${encodeURIComponent(deviceId)}&fpid=${encodeURIComponent(x.fpid || "")}`}
                        alt="" loading="lazy" onError={() => setSinFoto(true)}
                        className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]" />
                    <span className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/70 to-transparent" />
                    <span className="absolute left-2.5 top-2.5 inline-flex items-center gap-1 h-[20px] px-1.5 rounded-full pleno-info text-[10px] font-bold"><ScanFace size={10} /> Con su cara</span>
                </span>
            )}
            <span className="flex min-h-0 flex-1 flex-col p-3">
                <span className="flex items-center gap-2.5">
                    {!hayFoto && (
                        <span className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-[10px] text-[14px] font-bold",
                            negra ? "pleno-mal" : x.padron ? "chip-bien" : "bg-muted text-muted-foreground")}>
                            {iniciales(x.nombre) || <UserRound size={16} />}
                        </span>
                    )}
                    <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13.5px] font-bold leading-tight">{x.nombre || `Legajo ${x.legajo}`}</span>
                        <span className="block text-[11px] text-muted-foreground tabular-nums">Legajo {x.legajo}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1">
                        {x.rostros > 0 && !hayFoto && <Pista texto={`${x.rostros} ${x.rostros === 1 ? "cara cargada" : "caras cargadas"} en el equipo`}><span className="grid h-6 w-6 place-items-center rounded-full chip-info"><ScanFace size={12} /></span></Pista>}
                        {x.huellas > 0 && <Pista texto={`${x.huellas} ${x.huellas === 1 ? "huella" : "huellas"}`}><span className="grid h-6 w-6 place-items-center rounded-full chip-quieto"><Fingerprint size={12} /></span></Pista>}
                    </span>
                </span>

                {/* Quién es en el padrón, y por qué se dice. */}
                <span className="mt-2 flex items-center gap-1.5 text-[11.5px] leading-snug min-w-0">
                    {x.padron
                        ? <><ShieldCheck size={12} className="tono-bien shrink-0" /><span className="truncate">En el padrón como <b className="font-semibold">{x.padron.nombre}</b>{x.padron.unidad ? ` · ${x.padron.unidad}` : ""}</span></>
                        : <><ShieldX size={12} className="text-muted-foreground shrink-0" /><span className="truncate text-muted-foreground">No figura en el padrón</span></>}
                </span>

                {/* Las tarjetas, con su número, y de quién es cada una en el padrón. */}
                {x.numeros.length > 0 && (
                    <span className="mt-2 flex flex-wrap gap-1">
                        {x.numeros.slice(0, TARJETAS_A_LA_VISTA).map((n) => {
                            const ajena = !!n.padron && !!x.padron && n.padron.id !== x.padron.id;
                            const tono = ajena ? "chip-aviso" : n.padron ? "chip-bien" : "chip-neutro";
                            const ayuda = ajena ? `En el padrón esta tarjeta es de ${n.padron!.nombre}, no de esta persona.`
                                : n.padron ? `En el padrón es de ${n.padron.nombre}.` : "Esta tarjeta no está en el padrón de OmniAccess.";
                            return (
                                <Pista key={n.numero} texto={ayuda}>
                                    <span className={cn("inline-flex items-center gap-1 h-[22px] px-1.5 rounded-[6px] border text-[11.5px] font-semibold tabular-nums", tono)}>
                                        <CreditCard size={11} className="shrink-0" />{n.numero}
                                    </span>
                                </Pista>
                            );
                        })}
                        {resto > 0 && <span className="inline-flex items-center h-[22px] px-1.5 rounded-[6px] text-[11.5px] font-semibold text-muted-foreground">+{resto}</span>}
                    </span>
                )}
                {x.numeros.length === 0 && x.tarjetas > 0 && (
                    <span className="mt-2 inline-flex items-center gap-1 text-[11.5px] text-muted-foreground"><CreditCard size={11} /> {x.tarjetas} {x.tarjetas === 1 ? "tarjeta" : "tarjetas"} (el equipo no dio el número)</span>
                )}

                {(negra || visita || v) && (
                    <span className="mt-auto pt-2 flex flex-wrap gap-1">
                        {negra && <span className="inline-flex items-center h-[20px] px-1.5 rounded-full pleno-mal text-[10px] font-bold">Lista negra en el equipo</span>}
                        {visita && <span className="inline-flex items-center h-[20px] px-1.5 rounded-full chip-info border text-[10px] font-bold">Visita</span>}
                        {v && <span className={cn("inline-flex items-center gap-1 h-[20px] px-1.5 rounded-full border text-[10px] font-bold", v.vencida ? "chip-aviso" : "chip-neutro")}><CalendarClock size={10} /> {v.texto}</span>}
                    </span>
                )}
            </span>
        </motion.button>
    );
}

function Cifra({ icono: Ico, titulo, valor, nota, tono, apagado }: { icono: typeof Users; titulo: string; valor: number | string | null; nota?: string | null; tono?: "aviso"; apagado?: boolean }) {
    const hay = valor !== null && valor !== undefined;
    return (
        <div className={cn("rounded-[14px] border border-border bg-card px-4 py-3.5 flex flex-col", apagado && "opacity-60")}>
            <div className="flex items-center gap-1.5 text-[9.5px] font-bold uppercase tracking-[0.14em] text-muted-foreground"><Ico size={12} /> {titulo}</div>
            <div className={cn("mt-1.5 font-bold leading-none", typeof valor === "number" ? "text-[26px] tracking-[-0.02em] tabular-nums" : "text-[14px] mt-2")}>{hay ? valor : "—"}</div>
            {nota && <p className={cn("mt-auto pt-2 text-[11px] leading-snug", tono === "aviso" ? "tono-aviso" : "text-muted-foreground")}>{nota}</p>}
        </div>
    );
}
