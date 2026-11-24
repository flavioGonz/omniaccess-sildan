"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
    BadgeAlert, CalendarClock, Cctv, ChevronDown, CreditCard, DoorOpen, Fingerprint, IdCard, Plus, RefreshCw, ScanFace,
    ScrollText, Search, ShieldCheck, ShieldX, SlidersHorizontal, UserRound, Users, type LucideIcon,
} from "lucide-react";
import { baseCompleta, deteccionesDeCamara, fuentesDeRostros, type BaseCompleta, type DeteccionDeCamara, type FuenteCamara, type FuenteLector, type PersonaCompleta } from "@/app/actions/base-equipo";
import { Button } from "@/components/ui/button";
import { Cajon, CajonContenido } from "@/components/ui/cajon";
import { Cargando, ErrorEstado, Vacio } from "@/components/ui/estados";
import { Pista } from "@/components/ui/pista";
import { RostrosDelEquipo } from "@/components/devices/RostrosDelEquipo";
import { FichaPersonaEquipo } from "@/components/rostro/monitor-face/FichaPersonaEquipo";
import { CajonRostro } from "@/components/vision/rostros/CajonRostro";
import { getImagePath } from "@/lib/image-path";
import { fecha, hace } from "@/lib/fechas";
import { cn } from "@/lib/utils";

/**
 * La base de los lectores, rehecha el 25/11 con dos paneles.
 *
 * Nico, sobre la versión del 24/11: «necesita mucho trabajo de organización de la info. Las cards y
 * rostros deben ser un bloque solo cuando el rostro (usuario) tiene tarjeta asociada. Debe tener un
 * sidebar lateral derecho fijo, con los dispositivos faciales porteros, y rostros capturados por
 * cámaras seleccionadas desde OmniAccess… Las detecciones se mostrarán en esa grilla tipo bento, más
 * compacto. La idea es que esta página no tenga tanto scroll, agrupar mejor la info… no me gustan
 * los tabs tipo chips; falta iconografía premium».
 *
 * Lo que cambió, y por qué:
 *
 * **Una persona es un solo bloque.** La versión anterior tenía la lista de personas arriba (de a 30)
 * y la grilla de caras abajo: la misma persona aparecía dos veces, y su cara podía estar en otra
 * página que su tarjeta. Ahora se trae la base entera (actions/base-equipo › baseCompleta) y cada
 * persona junta su cara y sus tarjetas. Medido: todas las caras de los dos equipos son de una persona
 * de su lista.
 *
 * **Agrupada por lo que tiene, no paginada.** Arriba, quien tiene cara y tarjeta (el bloque grande:
 * es lo más completo que hay); después quien tiene cara; después las tarjetas, en baldosas chicas,
 * y lo que no tiene ninguna. Los grupos largos muestran las primeras y «ver todas»: la página entera
 * cabe en una pantalla y media en vez de nueve.
 *
 * **Las cifras son los filtros.** La barra de arriba dice cuántos hay de cada cosa y, al tocarla,
 * muestra sólo eso. No hay una fila de chips aparte que repita los mismos números.
 *
 * **La barra lateral fija** tiene las fuentes de caras: los lectores (con su base adentro) y las
 * cámaras donde OmniVision mira caras. Elegir una cámara muestra sus detecciones en el mismo bento.
 * Tiene su propio scroll: el contenido corre y ella queda.
 */

const RESORTE = { type: "spring" as const, bounce: 0, duration: 0.35 };
const SUAVE = { duration: 0.14, ease: "easeOut" as const };
/** Cuántas baldosas muestra un grupo largo antes de «ver todas». */
const PRIMERAS = { tarjeta: 24, nada: 12 } as const;
/** Cuántos números de tarjeta van a la vista en el bloque grande y en la baldosa chica. */
const NUMEROS = { grande: 3, chica: 1 } as const;
/** El fin de vigencia que pone el equipo cuando no se le dice ninguno: no es un vencimiento. */
const SIN_VENCIMIENTO_DESDE = 2036;

type Fuente = { tipo: "lector"; id: string } | { tipo: "camara"; id: string };
type Filtro = "todas" | "cara" | "tarjeta" | "padron" | "fuera" | "ajena";

export function BaseDeLectores() {
    const [fuentes, setFuentes] = useState<{ lectores: FuenteLector[]; camaras: FuenteCamara[]; verCamaras: boolean } | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [fuente, setFuente] = useState<Fuente | null>(null);

    const traerFuentes = useCallback(async () => {
        try { const f = await fuentesDeRostros(); setFuentes(f); setError(null); setFuente((x) => x || (f.lectores[0] ? { tipo: "lector", id: f.lectores[0].id } : f.camaras[0] ? { tipo: "camara", id: f.camaras[0].id } : null)); }
        catch (e) { setError(e instanceof Error ? e.message : "No se pudieron traer los equipos"); }
    }, []);
    useEffect(() => { const t = setTimeout(traerFuentes, 0); return () => clearTimeout(t); }, [traerFuentes]);

    if (error && !fuentes) return <div className="p-8"><ErrorEstado mensaje={error} alReintentar={traerFuentes} /></div>;
    if (!fuentes) return <Cargando texto="Buscando los lectores y las cámaras…" className="h-full" />;
    if (!fuentes.lectores.length && !fuentes.camaras.length) return <Vacio icono={ScanFace} titulo="No hay lectores ni cámaras faciales" ayuda="Un portero o un control de acceso se da de alta en Dispositivos; una cámara mira caras cuando se la elige en Ajustes › Rostros." />;

    return (
        <div className="grid h-full min-h-0 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_300px]">
            <div className="min-h-0 overflow-y-auto">
                {fuente?.tipo === "lector" && <PanelLector key={fuente.id} id={fuente.id} otros={fuentes.lectores.filter((l) => l.id !== fuente.id).map((l) => ({ id: l.id, nombre: l.nombre }))} alLeer={traerFuentes} />}
                {fuente?.tipo === "camara" && <PanelCamara key={fuente.id} camara={fuentes.camaras.find((c) => c.id === fuente.id)!} />}
            </div>
            <BarraFuentes fuentes={fuentes} fuente={fuente} alElegir={setFuente} />
        </div>
    );
}

/* ───────────────────────────── La barra lateral ───────────────────────────── */

function BarraFuentes({ fuentes, fuente, alElegir }: { fuentes: { lectores: FuenteLector[]; camaras: FuenteCamara[]; verCamaras: boolean }; fuente: Fuente | null; alElegir: (f: Fuente) => void }) {
    const quieto = useReducedMotion();
    return (
        <aside className="order-first min-h-0 overflow-y-auto border-b border-border bg-[color-mix(in_oklab,var(--card)_60%,transparent)] lg:order-none lg:border-b-0 lg:border-l">
            <div className="p-4 space-y-5">
                <Grupo icono={DoorOpen} titulo="Lectores" ayuda="Porteros y controles de acceso. Cada uno tiene su propia base: las personas, sus tarjetas y sus caras.">
                    {fuentes.lectores.map((l) => {
                        const on = fuente?.tipo === "lector" && fuente.id === l.id;
                        const Ico = l.tipo === "DOOR_INTERCOM" ? DoorOpen : ScanFace;
                        return (
                            <Fila key={l.id} on={on} quieto={!!quieto} alElegir={() => alElegir({ tipo: "lector", id: l.id })}
                                icono={Ico} titulo={l.nombre}
                                bajada={l.leida ? `${l.leida.personas} personas · ${l.leida.caras} caras` : `${l.tipo === "DOOR_INTERCOM" ? "Portero" : "Control de acceso"} · ${l.ip}`} />
                        );
                    })}
                </Grupo>
                {fuentes.verCamaras && fuentes.camaras.length > 0 && (
                    <Grupo icono={Cctv} titulo="Cámaras faciales" ayuda="Las cámaras donde OmniVision mira caras (Ajustes › Rostros), con las personas distintas que vio en 30 días.">
                        {fuentes.camaras.map((c) => {
                            const on = fuente?.tipo === "camara" && fuente.id === c.id;
                            return (
                                <Fila key={c.id} on={on} quieto={!!quieto} alElegir={() => alElegir({ tipo: "camara", id: c.id })} apagada={!c.personas}
                                    icono={c.tipo === "DOOR_INTERCOM" ? DoorOpen : Cctv} titulo={c.nombre}
                                    bajada={c.personas ? `${c.personas} ${c.personas === 1 ? "persona" : "personas"} · ${c.ultima ? hace(c.ultima) : ""}` : "Sin caras en 30 días"} />
                            );
                        })}
                    </Grupo>
                )}
            </div>
        </aside>
    );
}

function Grupo({ icono: Ico, titulo, ayuda, children }: { icono: LucideIcon; titulo: string; ayuda: string; children: React.ReactNode }) {
    return (
        <section>
            <Pista texto={ayuda} titulo={titulo} ancho={260} lado="abajo">
                <h3 className="mb-2 flex items-center gap-1.5 text-[9.5px] font-bold uppercase tracking-[0.14em] text-muted-foreground"><Ico size={12} strokeWidth={2} /> {titulo}</h3>
            </Pista>
            <div className="space-y-1">{children}</div>
        </section>
    );
}

function Fila({ on, quieto, alElegir, icono: Ico, titulo, bajada, apagada }: { on: boolean; quieto: boolean; alElegir: () => void; icono: LucideIcon; titulo: string; bajada: string; apagada?: boolean }) {
    return (
        <button type="button" onClick={alElegir} aria-pressed={on}
            className={cn("relative flex w-full items-center gap-3 rounded-[10px] px-2.5 py-2 text-left transition-colors", on ? "text-foreground" : "text-foreground/85 hover:bg-accent/60", apagada && !on && "opacity-60")}>
            {on && <motion.span layoutId="fuente-activa" transition={quieto ? SUAVE : RESORTE} className="absolute inset-0 rounded-[10px] bg-card ring-1 ring-border" />}
            <span className={cn("relative grid h-9 w-9 shrink-0 place-items-center rounded-[9px] transition-colors", on ? "bg-foreground text-background" : "bg-muted text-muted-foreground")}>
                <Ico size={17} strokeWidth={1.8} />
            </span>
            <span className="relative min-w-0 flex-1">
                <span className="block truncate text-[12.5px] font-semibold leading-tight">{titulo}</span>
                <span className="block truncate text-[11px] text-muted-foreground tabular-nums">{bajada}</span>
            </span>
        </button>
    );
}

/* ───────────────────────────── Un lector ───────────────────────────── */

const vigencia = (vence: string | null): { texto: string; vencida: boolean } | null => {
    if (!vence) return null;
    const t = new Date(vence);
    if (!Number.isFinite(t.getTime()) || t.getFullYear() >= SIN_VENCIMIENTO_DESDE) return null;
    return t.getTime() < Date.now() ? { texto: `Venció el ${fecha(t)}`, vencida: true } : { texto: `Hasta el ${fecha(t)}`, vencida: false };
};
/** Una tarjeta que en el padrón es de OTRA persona (o de nadie, si la persona sí está). */
const esAjena = (p: PersonaCompleta, n: PersonaCompleta["tarjetas"][number]) => !!n.padron && !!p.padron && n.padron.id !== p.padron.id;

function PanelLector({ id, otros, alLeer }: { id: string; otros: { id: string; nombre: string }[]; alLeer: () => void }) {
    const [datos, setDatos] = useState<BaseCompleta | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [leyendo, setLeyendo] = useState(false);
    const [filtro, setFiltro] = useState<Filtro>("todas");
    const [q, setQ] = useState("");
    const [abiertos, setAbiertos] = useState<Record<string, boolean>>({});
    const [ficha, setFicha] = useState<string | null | undefined>(undefined);
    const [caras, setCaras] = useState(false);

    const traer = useCallback(async (forzar = false) => {
        setLeyendo(true);
        try { const d = await baseCompleta(id, forzar); setDatos(d); setError(null); alLeer(); }
        catch (e) { setError(e instanceof Error ? e.message : "No se pudo leer la base"); }
        finally { setLeyendo(false); }
    }, [id, alLeer]);
    useEffect(() => { traer(); }, [traer]);

    const personas = useMemo(() => datos?.personas || [], [datos]);
    const cuentas = useMemo(() => ({
        todas: personas.length,
        cara: personas.filter((p) => p.cara).length,
        tarjeta: personas.filter((p) => p.tarjetas.length).length,
        padron: personas.filter((p) => p.padron).length,
        fuera: personas.filter((p) => !p.padron).length,
        ajena: personas.filter((p) => p.tarjetas.some((n) => esAjena(p, n))).length,
    }), [personas]);
    const visibles = useMemo(() => {
        const t = q.trim().toLowerCase();
        return personas.filter((p) => {
            if (filtro === "cara" && !p.cara) return false;
            if (filtro === "tarjeta" && !p.tarjetas.length) return false;
            if (filtro === "padron" && !p.padron) return false;
            if (filtro === "fuera" && p.padron) return false;
            if (filtro === "ajena" && !p.tarjetas.some((n) => esAjena(p, n))) return false;
            if (!t) return true;
            return (p.nombre || "").toLowerCase().includes(t) || p.legajo.toLowerCase().includes(t)
                || (p.padron?.nombre || "").toLowerCase().includes(t) || p.tarjetas.some((n) => n.numero.includes(t));
        });
    }, [personas, filtro, q]);

    if (error && !datos) return <div className="p-8"><ErrorEstado mensaje={error} alReintentar={() => traer(true)} /></div>;
    if (!datos) return <Cargando className="h-full min-h-[60vh]" texto="Leyendo la base entera del equipo: personas, tarjetas y caras. La primera vez tarda unos segundos…" />;

    const grupos = [
        { k: "ambas", titulo: "Cara y tarjeta", icono: IdCard, lista: visibles.filter((p) => p.cara && p.tarjetas.length), forma: "grande" as const, ayuda: "Personas que abren con la cara y con tarjeta: todo junto, en un bloque." },
        { k: "cara", titulo: "Con cara", icono: ScanFace, lista: visibles.filter((p) => p.cara && !p.tarjetas.length), forma: "cara" as const, ayuda: "Abren con la cara. No tienen tarjeta cargada en este equipo." },
        { k: "tarjeta", titulo: "Con tarjeta", icono: CreditCard, lista: visibles.filter((p) => !p.cara && p.tarjetas.length), forma: "chica" as const, ayuda: "Abren con tarjeta. No tienen cara cargada en este equipo." },
        { k: "nada", titulo: "Sin credencial", icono: UserRound, lista: visibles.filter((p) => !p.cara && !p.tarjetas.length), forma: "chica" as const, ayuda: "Están cargadas en el equipo pero sin cara ni tarjeta: no pueden abrir (salvo clave o huella)." },
    ].filter((g) => g.lista.length);
    const tipo = datos.equipo.tipo === "DOOR_INTERCOM" ? "Portero" : "Control de acceso";

    return (
        <div className="px-6 lg:px-8 pt-1 pb-10 space-y-4">
            {/* ── El equipo ── */}
            <div className="flex flex-wrap items-center gap-3">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-[12px] bg-foreground text-background">
                    {datos.equipo.tipo === "DOOR_INTERCOM" ? <DoorOpen size={20} strokeWidth={1.8} /> : <ScanFace size={20} strokeWidth={1.8} />}
                </span>
                <div className="min-w-0 flex-1">
                    <h2 className="truncate text-[16px] font-bold leading-tight tracking-[-0.01em]">{datos.equipo.nombre}</h2>
                    <p className="text-[12px] text-muted-foreground">{tipo} · {datos.equipo.marca.charAt(0) + datos.equipo.marca.slice(1).toLowerCase()} · {datos.equipo.ip} · leída {hace(datos.leido)}</p>
                </div>
                <div className="flex items-center gap-1.5">
                    <Capacidad icono={Fingerprint} si={datos.huellas} texto={datos.huellas ? "Maneja huellas" : "No maneja huellas"} />
                    <Capacidad icono={ScrollText} si={datos.bitacora} texto={datos.bitacora ? "Guarda su bitácora: se le puede pedir" : "No guarda bitácora"} />
                    <Pista texto="Las caras del equipo: copiarlas a otro portero, cargar una o borrar las que no van." lado="abajo">
                        <Button variant="ghost" size="sm" onClick={() => setCaras(true)}><SlidersHorizontal size={14} /> Caras</Button>
                    </Pista>
                    <Pista texto="Preguntarle de nuevo al equipo. Lo leído se guarda cinco minutos." lado="abajo">
                        <Button variant="ghost" size="sm" disabled={leyendo} onClick={() => traer(true)} aria-label="Volver a leer"><RefreshCw size={14} className={cn(leyendo && "animate-spin")} /></Button>
                    </Pista>
                    <Button size="sm" onClick={() => setFicha(null)}><Plus size={14} /> Cargar una persona</Button>
                </div>
            </div>

            {datos.error && <p className="text-[12.5px] tono-aviso">{datos.error}</p>}

            {/* ── Las cifras, que son los filtros ── */}
            <div className="@container">
                <div role="radiogroup" aria-label="Qué personas mostrar" className="grid grid-cols-2 overflow-hidden rounded-[14px] border border-border bg-card @md:grid-cols-3 @3xl:grid-cols-6">
                    <Cifra icono={Users} titulo="Personas" valor={cuentas.todas} on={filtro === "todas"} alElegir={() => setFiltro("todas")} />
                    <Cifra icono={ScanFace} titulo="Con cara" valor={cuentas.cara} on={filtro === "cara"} alElegir={() => setFiltro("cara")} nota={`${datos.caras} en la biblioteca`} />
                    <Cifra icono={CreditCard} titulo="Con tarjeta" valor={cuentas.tarjeta} on={filtro === "tarjeta"} alElegir={() => setFiltro("tarjeta")} nota={`${datos.tarjetas} tarjetas`} />
                    <Cifra icono={ShieldCheck} titulo="En el padrón" valor={cuentas.padron} on={filtro === "padron"} alElegir={() => setFiltro("padron")} />
                    <Cifra icono={ShieldX} titulo="No figuran" valor={cuentas.fuera} on={filtro === "fuera"} alElegir={() => setFiltro("fuera")} nota="pueden abrir y no están en OmniAccess" />
                    <Cifra icono={BadgeAlert} titulo="Tarjeta de otro" valor={cuentas.ajena} on={filtro === "ajena"} alElegir={() => setFiltro("ajena")} tono={cuentas.ajena ? "aviso" : undefined} nota="en el padrón es de otra persona" />
                </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
                <label className="relative w-full max-w-[340px]">
                    <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nombre, legajo o número de tarjeta"
                        className="h-9 w-full rounded-[8px] border border-border bg-card pl-9 pr-3 text-[12.5px] outline-none transition-shadow focus:ring-2 focus:ring-[var(--accion)]/35" />
                </label>
                <span className="text-[12px] text-muted-foreground tabular-nums">{visibles.length === personas.length ? `${personas.length} personas` : `${visibles.length} de ${personas.length}`}</span>
                {datos.guardaFotos === false && datos.caras > 0 && (
                    <Pista ancho={300} titulo="Este equipo no guarda las fotos" texto="Está configurado para guardar sólo la plantilla con la que reconoce y tirar la foto (saveFacePic apagado). Por eso las caras se ven como un ícono, o con la foto del padrón si la persona la tiene. Se puede activar en el equipo para las caras que se carguen de ahora en más.">
                        <span className="ml-auto inline-flex cursor-help items-center gap-1.5 rounded-[8px] border chip-aviso px-2.5 h-8 text-[11.5px] font-semibold"><ScanFace size={13} /> El equipo no guarda las fotos</span>
                    </Pista>
                )}
            </div>

            {grupos.length === 0 ? (
                <Vacio icono={Search} titulo="Nadie con este filtro" ayuda={q ? "Probá con otra parte del nombre, el legajo o el número de la tarjeta." : undefined} />
            ) : grupos.map((g) => {
                const tope = g.k === "tarjeta" ? PRIMERAS.tarjeta : g.k === "nada" ? PRIMERAS.nada : Infinity;
                const todos = abiertos[g.k] || !!q || filtro !== "todas";
                const lista = todos ? g.lista : g.lista.slice(0, tope);
                return (
                    <section key={g.k}>
                        <Pista texto={g.ayuda} titulo={g.titulo} ancho={280} lado="abajo">
                            <h3 className="mb-2 flex items-center gap-1.5 text-[9.5px] font-bold uppercase tracking-[0.14em] text-muted-foreground"><g.icono size={12} strokeWidth={2} /> {g.titulo} · <span className="tabular-nums">{g.lista.length}</span></h3>
                        </Pista>
                        <div className={cn("grid gap-2",
                            g.forma === "grande" ? "[grid-template-columns:repeat(auto-fill,minmax(296px,1fr))]"
                                : g.forma === "cara" ? "[grid-template-columns:repeat(auto-fill,minmax(118px,1fr))]"
                                    : "[grid-template-columns:repeat(auto-fill,minmax(196px,1fr))]")}>
                            {lista.map((p) => g.forma === "grande" ? <Bloque key={p.legajo} p={p} deviceId={id} alAbrir={() => setFicha(p.legajo)} />
                                : g.forma === "cara" ? <Retrato key={p.legajo} p={p} deviceId={id} alAbrir={() => setFicha(p.legajo)} />
                                    : <Chica key={p.legajo} p={p} alAbrir={() => setFicha(p.legajo)} />)}
                        </div>
                        {lista.length < g.lista.length && (
                            <button type="button" onClick={() => setAbiertos((x) => ({ ...x, [g.k]: true }))}
                                className="mt-2 inline-flex h-8 items-center gap-1.5 rounded-[8px] px-2.5 text-[12px] font-semibold text-[var(--accion)] hover:bg-accent">
                                <ChevronDown size={14} /> Ver las {g.lista.length}
                            </button>
                        )}
                    </section>
                );
            })}

            <AnimatePresence>
                {ficha !== undefined && (
                    <FichaPersonaEquipo deviceId={id} legajo={ficha} daFoto={datos.guardaFotos !== false}
                        alCerrar={() => setFicha(undefined)} alCambiar={() => traer(true)} />
                )}
            </AnimatePresence>
            <Cajon open={caras} onOpenChange={setCaras}>
                <CajonContenido ancho="ancho" titulo="Caras del equipo" descripcion={datos.equipo.nombre}>
                    <div className="p-5"><RostrosDelEquipo id={id} otros={otros} amplio /></div>
                </CajonContenido>
            </Cajon>
        </div>
    );
}

function Capacidad({ icono: Ico, si, texto }: { icono: LucideIcon; si: boolean; texto: string }) {
    return (
        <Pista texto={texto} lado="abajo">
            <span className={cn("grid h-8 w-8 place-items-center rounded-[8px] border", si ? "border-border text-foreground" : "border-dashed border-border text-muted-foreground/50")}><Ico size={15} strokeWidth={1.8} /></span>
        </Pista>
    );
}

function Cifra({ icono: Ico, titulo, valor, on, alElegir, nota, tono }: { icono: LucideIcon; titulo: string; valor: number; on: boolean; alElegir: () => void; nota?: string; tono?: "aviso" }) {
    return (
        <button type="button" role="radio" aria-checked={on} onClick={alElegir}
            className={cn("group relative flex min-w-0 flex-col items-start gap-1 border-b border-r border-border px-4 py-3 text-left transition-colors last:border-r-0",
                on ? "bg-[color-mix(in_oklab,var(--accion)_7%,transparent)]" : "hover:bg-accent/50")}>
            <span className="flex items-center gap-1.5 text-[11.5px] font-semibold text-muted-foreground">
                <Ico size={14} strokeWidth={1.9} className={cn(on ? "text-[var(--accion)]" : tono === "aviso" && valor ? "tono-aviso" : "")} /> {titulo}
            </span>
            <span className={cn("text-[22px] font-bold leading-none tracking-[-0.02em] tabular-nums", tono === "aviso" && valor ? "tono-aviso" : "")}>{valor.toLocaleString("es-UY")}</span>
            {nota && <span className="truncate text-[10.5px] text-muted-foreground max-w-full">{nota}</span>}
            {on && <span className="absolute inset-x-0 bottom-0 h-[2px] bg-[var(--accion)]" />}
        </button>
    );
}

/** La cara de una persona: la del equipo si la entrega, si no la del padrón (marcada), si no un ícono. */
function Cara({ p, deviceId, className, iconoTam = 22 }: { p: PersonaCompleta; deviceId: string; className?: string; iconoTam?: number }) {
    const [fallo, setFallo] = useState(false);
    const src = p.foto && !fallo ? `/api/devices/rostros-equipo/foto?deviceId=${encodeURIComponent(deviceId)}&fpid=${encodeURIComponent(p.legajo)}` : getImagePath(p.padron?.cara);
    return (
        <span className={cn("relative block overflow-hidden", src ? "bg-black" : "bg-[radial-gradient(circle_at_50%_35%,color-mix(in_oklab,var(--info)_18%,var(--muted)),var(--muted))]", className)}>
            {src
                /* eslint-disable-next-line @next/next/no-img-element */
                ? <img src={src} alt="" loading="lazy" onError={() => setFallo(true)} className="absolute inset-0 h-full w-full object-cover" />
                : <span className="absolute inset-0 grid place-items-center tono-info"><ScanFace size={iconoTam} strokeWidth={1.6} /></span>}
            {!p.foto && p.padron?.cara && <span className="absolute left-1.5 top-1.5 rounded-full pleno-info px-1.5 text-[9px] font-bold leading-[16px]">Padrón</span>}
        </span>
    );
}

function Padron({ p }: { p: PersonaCompleta }) {
    return p.padron
        ? <span className="flex min-w-0 items-center gap-1 text-[11.5px]"><ShieldCheck size={12} className="tono-bien shrink-0" /><span className="truncate">{p.padron.nombre}{p.padron.unidad ? ` · ${p.padron.unidad}` : ""}</span></span>
        : <span className="flex min-w-0 items-center gap-1 text-[11.5px] text-muted-foreground"><ShieldX size={12} className="shrink-0" /><span className="truncate">No figura en el padrón</span></span>;
}

function Numero({ p, n }: { p: PersonaCompleta; n: PersonaCompleta["tarjetas"][number] }) {
    const ajena = esAjena(p, n);
    const tono = ajena ? "chip-aviso" : n.padron ? "chip-bien" : "chip-neutro";
    const ayuda = ajena ? `En el padrón esta tarjeta es de ${n.padron!.nombre}, no de esta persona.` : n.padron ? `En el padrón es de ${n.padron.nombre}.` : "Esta tarjeta no está en el padrón de OmniAccess.";
    return (
        <Pista texto={ayuda}>
            <span className={cn("inline-flex h-[22px] items-center gap-1 rounded-[6px] border px-1.5 text-[11.5px] font-semibold tabular-nums", tono)}><CreditCard size={11} className="shrink-0" />{n.numero}</span>
        </Pista>
    );
}

function Marcas({ p }: { p: PersonaCompleta }) {
    const v = vigencia(p.vence);
    if (p.tipo !== "blackList" && p.tipo !== "visitor" && !v) return null;
    return (
        <span className="flex flex-wrap gap-1">
            {p.tipo === "blackList" && <span className="inline-flex h-[18px] items-center rounded-full pleno-mal px-1.5 text-[9.5px] font-bold">Lista negra</span>}
            {p.tipo === "visitor" && <span className="inline-flex h-[18px] items-center rounded-full border chip-info px-1.5 text-[9.5px] font-bold">Visita</span>}
            {v && <span className={cn("inline-flex h-[18px] items-center gap-1 rounded-full border px-1.5 text-[9.5px] font-bold", v.vencida ? "chip-aviso" : "chip-neutro")}><CalendarClock size={9} /> {v.texto}</span>}
        </span>
    );
}

const nombreDe = (p: PersonaCompleta) => p.nombre || p.padron?.nombre || `Legajo ${p.legajo}`;

/** Cara y tarjeta: el bloque grande, la persona entera. */
function Bloque({ p, deviceId, alAbrir }: { p: PersonaCompleta; deviceId: string; alAbrir: () => void }) {
    const resto = p.tarjetas.length - NUMEROS.grande;
    return (
        <button type="button" onClick={alAbrir}
            className={cn("group flex min-h-[100px] overflow-hidden rounded-[12px] border bg-card text-left transition-colors hover:border-foreground/25", p.tipo === "blackList" ? "border-[color-mix(in_oklab,var(--mal)_45%,transparent)]" : "border-border")}>
            <Cara p={p} deviceId={deviceId} className="w-[78px] shrink-0" iconoTam={24} />
            <span className="flex min-w-0 flex-1 flex-col gap-1 px-3 py-2.5">
                <span className="flex min-w-0 items-baseline gap-2">
                    <span className="truncate text-[13px] font-bold leading-tight">{nombreDe(p)}</span>
                    <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">{p.legajo}{p.huellas ? ` · ${p.huellas} huella${p.huellas === 1 ? "" : "s"}` : ""}</span>
                </span>
                <Padron p={p} />
                <span className="flex flex-wrap gap-1">
                    {p.tarjetas.slice(0, NUMEROS.grande).map((n) => <Numero key={n.numero} p={p} n={n} />)}
                    {resto > 0 && <span className="inline-flex h-[22px] items-center px-1 text-[11.5px] font-semibold text-muted-foreground">+{resto}</span>}
                </span>
                <Marcas p={p} />
            </span>
        </button>
    );
}

/** Con cara y sin tarjeta: un retrato chico con el nombre. */
function Retrato({ p, deviceId, alAbrir }: { p: PersonaCompleta; deviceId: string; alAbrir: () => void }) {
    return (
        <button type="button" onClick={alAbrir} className="group relative aspect-[4/5] overflow-hidden rounded-[12px] border border-border text-left transition-colors hover:border-foreground/25">
            <Cara p={p} deviceId={deviceId} className="absolute inset-0" iconoTam={26} />
            <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent p-2 pt-6 text-white">
                <span className="block truncate text-[12px] font-bold">{nombreDe(p)}</span>
                <span className="flex items-center gap-1 text-[10.5px] text-white/75 tabular-nums">{p.padron ? <ShieldCheck size={10} /> : <ShieldX size={10} />}{p.legajo}</span>
            </span>
        </button>
    );
}

/** Con tarjeta (o sin nada): la baldosa chica, una línea de datos. */
function Chica({ p, alAbrir }: { p: PersonaCompleta; alAbrir: () => void }) {
    const n = p.tarjetas[0];
    const ajenas = p.tarjetas.some((x) => esAjena(p, x));
    const ini = (() => { const t = nombreDe(p).trim(); return /[A-Za-zÀ-ÿ]/.test(t) && !t.startsWith("Legajo") ? t.split(/\s+/).slice(0, 2).map((x) => x[0]!.toUpperCase()).join("") : t.replace(/^Legajo\s*/, "").slice(0, 4); })();
    return (
        <button type="button" onClick={alAbrir}
            className={cn("flex min-w-0 items-center gap-2.5 rounded-[12px] border bg-card px-2.5 py-2 text-left transition-colors hover:border-foreground/25", p.tipo === "blackList" ? "border-[color-mix(in_oklab,var(--mal)_45%,transparent)]" : "border-border")}>
            <span className={cn("grid h-9 min-w-9 shrink-0 place-items-center rounded-[9px] px-1 text-[12px] font-bold tabular-nums", p.tipo === "blackList" ? "pleno-mal" : p.padron ? "chip-bien" : "bg-muted text-muted-foreground")}>{ini || <UserRound size={14} />}</span>
            <span className="min-w-0 flex-1">
                <span className="block truncate text-[12.5px] font-semibold leading-tight">{nombreDe(p)}</span>
                <span className="flex min-w-0 items-center gap-1 text-[11px] text-muted-foreground tabular-nums">
                    {n ? <><CreditCard size={11} className={cn("shrink-0", ajenas && "tono-aviso")} /><span className="truncate">{n.numero}{p.tarjetas.length > 1 ? ` +${p.tarjetas.length - 1}` : ""}</span></> : <span className="truncate">Legajo {p.legajo}</span>}
                </span>
            </span>
            {p.padron ? <ShieldCheck size={13} className="tono-bien shrink-0" /> : <ShieldX size={13} className="text-muted-foreground/60 shrink-0" />}
        </button>
    );
}

/* ───────────────────────────── Una cámara ───────────────────────────── */

function PanelCamara({ camara }: { camara: FuenteCamara }) {
    const [datos, setDatos] = useState<{ total: number; detecciones: DeteccionDeCamara[] } | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [q, setQ] = useState("");
    const [dias, setDias] = useState(30);
    const [abierta, setAbierta] = useState<string | null>(null);
    const traer = useCallback(async () => {
        try { setDatos(await deteccionesDeCamara(camara.id, dias)); setError(null); }
        catch (e) { setError(e instanceof Error ? e.message : "No se pudieron traer las caras"); }
    }, [camara.id, dias]);
    useEffect(() => { const t = setTimeout(traer, 0); return () => clearTimeout(t); }, [traer]);
    const lista = useMemo(() => {
        const t = q.trim().toLowerCase();
        return (datos?.detecciones || []).filter((d) => !t || d.codigo.toLowerCase().includes(t) || (d.nombre || "").toLowerCase().includes(t));
    }, [datos, q]);

    return (
        <div className="px-6 lg:px-8 pt-1 pb-10 space-y-4">
            <div className="flex flex-wrap items-center gap-3">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-[12px] bg-foreground text-background"><Cctv size={20} strokeWidth={1.8} /></span>
                <div className="min-w-0 flex-1">
                    <h2 className="truncate text-[16px] font-bold leading-tight tracking-[-0.01em]">{camara.nombre}</h2>
                    <p className="text-[12px] text-muted-foreground">Cámara facial de OmniVision · las caras que vio, una por persona</p>
                </div>
                <div className="inline-flex items-center rounded-[10px] bg-muted/60 p-[3px]">
                    {[7, 30, 90].map((d) => (
                        <button key={d} type="button" onClick={() => setDias(d)} className={cn("h-8 rounded-[8px] px-3 text-[12.5px] font-semibold transition-colors", dias === d ? "bg-background text-foreground ring-1 ring-border/60" : "text-muted-foreground hover:text-foreground")}>{d} días</button>
                    ))}
                </div>
            </div>
            {error && !datos ? <ErrorEstado mensaje={error} alReintentar={traer} /> : !datos ? <Cargando texto="Trayendo las caras que vio…" /> : (
                <>
                    <div className="grid grid-cols-3 overflow-hidden rounded-[14px] border border-border bg-card">
                        <Dato icono={Users} titulo="Personas distintas" valor={datos.total} />
                        <Dato icono={ScanFace} titulo="Pasadas" valor={datos.detecciones.reduce((a, d) => a + d.aca, 0)} />
                        <Dato icono={ShieldCheck} titulo="Del padrón" valor={datos.detecciones.filter((d) => d.registrado).length} />
                    </div>
                    <label className="relative block w-full max-w-[340px]">
                        <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nombre o código (R-0012)"
                            className="h-9 w-full rounded-[8px] border border-border bg-card pl-9 pr-3 text-[12.5px] outline-none transition-shadow focus:ring-2 focus:ring-[var(--accion)]/35" />
                    </label>
                    {lista.length === 0 ? <Vacio icono={ScanFace} titulo="Ninguna cara en este período" ayuda="Esta cámara mira caras, pero en estos días no vio ninguna que alcanzara para identificarla." /> : (
                        <div className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(118px,1fr))]">
                            {lista.map((d) => (
                                <button key={d.rostroId} type="button" onClick={() => setAbierta(d.rostroId)}
                                    className="group relative aspect-[4/5] overflow-hidden rounded-[12px] border border-border bg-black text-left transition-colors hover:border-foreground/25">
                                    {d.foto
                                        /* eslint-disable-next-line @next/next/no-img-element */
                                        ? <img src={d.foto} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]" />
                                        : <span className="absolute inset-0 grid place-items-center bg-muted text-muted-foreground"><ScanFace size={24} /></span>}
                                    {d.aca > 1 && <span className="absolute right-1.5 top-1.5 rounded-full bg-black/60 px-1.5 text-[10px] font-bold leading-[18px] text-white tabular-nums backdrop-blur-md">×{d.aca}</span>}
                                    {d.registrado && <span className="absolute left-1.5 top-1.5 grid h-5 w-5 place-items-center rounded-full pleno-bien"><ShieldCheck size={11} /></span>}
                                    <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/40 to-transparent p-2 pt-6 text-white">
                                        <span className="block truncate text-[12px] font-bold">{d.nombre || d.codigo}</span>
                                        <span className="block truncate text-[10.5px] text-white/75 tabular-nums">{d.nombre ? `${d.codigo} · ` : ""}{hace(d.ultima)}</span>
                                    </span>
                                </button>
                            ))}
                        </div>
                    )}
                </>
            )}
            <CajonRostro id={abierta} alCerrar={() => setAbierta(null)} alCambiar={traer} alAbrir={setAbierta} />
        </div>
    );
}

function Dato({ icono: Ico, titulo, valor }: { icono: LucideIcon; titulo: string; valor: number }) {
    return (
        <div className="flex flex-col gap-1 border-r border-border px-4 py-3 last:border-r-0">
            <span className="flex items-center gap-1.5 text-[11.5px] font-semibold text-muted-foreground"><Ico size={14} strokeWidth={1.9} /> {titulo}</span>
            <span className="text-[22px] font-bold leading-none tracking-[-0.02em] tabular-nums">{valor.toLocaleString("es-UY")}</span>
        </div>
    );
}
