"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { AlertTriangle, Check, CreditCard, DoorOpen, Fingerprint, KeyRound, Layers, Radio, ScanFace, Search, ShieldCheck } from "lucide-react";
import { sileo as toast } from "sileo";
import { monitorFace, resumenMonitorFace, type MonitorFace, type EquipoDeAcceso, type CapturaFace, type ResumenFace } from "@/app/actions/monitor-face";
import { rostroDesdeEvento } from "@/app/actions/rostros";
import { Cargando, ErrorEstado, Vacio } from "@/components/ui/estados";
import { Pista } from "@/components/ui/pista";
import { Switch } from "@/components/ui/switch";
import { BaseDeEquipos } from "@/components/rostro/monitor-face/BaseDeEquipos";
import { FranjaAnalisis } from "@/components/rostro/monitor-face/FranjaAnalisis";
import { HojaCaptura } from "@/components/rostro/monitor-face/HojaCaptura";
import { CajonRostro } from "@/components/vision/rostros/CajonRostro";
import { agruparRafagas, rotuloIdentidad, TONO_IDENTIDAD, QUE_MOSTRAR, type QueMostrar, type Rafaga } from "@/lib/monitor-face";
import { getImagePath } from "@/lib/image-path";
import { hora, fecha } from "@/lib/fechas";
import { cn } from "@/lib/utils";

/**
 * Monitor Face: las caras que pasaron por cada portero y control de acceso, y qué se sabe de cada
 * una (24/11; nació el 18/11 como «Bitácora de equipos»).
 *
 * Nico, el 24/11: «está mal nombrada. Es un historial de Face, capturas de rostros… debe ser
 * Monitor Face… depurar más esa sección, mejorar el reco facial y datos analizados de capturas;
 * más premium». Lo que cambió, y por qué:
 *
 * **1. Arriba, lo que se analizó** (FranjaAnalisis): qué se decidió con las caras, de qué tamaño
 * llegan y por qué quedan sin comparar, sobre TODO el período. Es lo que dice si el reconocimiento
 * anda, y antes no estaba en ningún lado.
 *
 * **2. Ráfagas.** En el lab, 3.783 de las 8.331 capturas sin comparar caían a menos de 20 s de otra
 * del mismo equipo: la misma persona partida en pistas. Se juntan en una baldosa con la mejor cara
 * al frente y «×N» (lib/monitor-face › agruparRafagas). Se puede apagar.
 *
 * **3. La baldosa dice qué se decidió**: el chip de identidad con su tono de estado (padrón, ya
 * vista N veces, primera vez, cara chica), el parecido y el tamaño de la cara. Antes decía «Sin
 * identificar» igual para una cara de 20 px que para una identidad que ya pasó diez veces.
 *
 * **4. La hoja explica la decisión** (HojaCaptura): la escena con la cara marcada, la frase con los
 * números, el parecido sobre la escala de umbrales y la calidad desarmada.
 *
 * Lo de la versión del 19/11 sigue (skill `apple-design`): bento donde el tamaño es *mapping* (más
 * grande = más para ver), los equipos como estado en un botón y no como filtro de tarjetas, barra
 * translúcida, resortes sin rebote que se apagan con `prefers-reduced-motion`.
 */

/** Cada cuánto se vuelve a pedir con la pantalla abierta: las capturas entran solas. */
const REFRESCO_MS = 12_000;
/** El resumen recorre todo el período: con una vez por minuto alcanza (el servidor también lo guarda un minuto). */
const REFRESCO_RESUMEN_MS = 60_000;
const DIAS = [1, 7, 30];
const RESORTE = { type: "spring" as const, bounce: 0, duration: 0.35 };
const SUAVE = { duration: 0.14, ease: "easeOut" as const };

const ICONO_TIPO: Record<string, typeof ScanFace> = { FACE: ScanFace, TAG: CreditCard, PIN: KeyRound, FINGERPRINT: Fingerprint };
const ICONO_EQUIPO: Record<string, typeof DoorOpen> = { DOOR_INTERCOM: DoorOpen, ACCESS_CONTROL: KeyRound, FACE_TERMINAL: ScanFace };

const hace = (iso: string) => {
    const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
    return s < 60 ? "recién" : s < 3600 ? `hace ${Math.round(s / 60)} min` : s < 86400 ? `hace ${Math.round(s / 3600)} h` : `hace ${Math.round(s / 86400)} d`;
};

/** Qué tamaño ocupa una ráfaga en el bento. Mapping, no decoración: más grande = más para ver. */
function tamanoDe(r: Rafaga<CapturaFace>, i: number): "grande" | "medio" | "chico" {
    const p = r.cabeza;
    const conFoto = !!(p.cara || p.foto);
    const sabida = p.identidad !== "sin-cara";
    if (i === 0 && conFoto && sabida) return "grande";      // la más nueva del día, si se sabe quién es
    if (conFoto && (sabida || p.decision === "DENY")) return "medio";
    return "chico";
}

export function VistaMonitorFace() {
    const [dias, setDias] = useState(7);
    /** Equipos elegidos. Vacío = todos: el estado más común no necesita que nadie lo arme. */
    const [equipos, setEquipos] = useState<string[]>([]);
    const [q, setQ] = useState("");
    const [que, setQue] = useState<QueMostrar>("todas");
    const [juntar, setJuntar] = useState(true);
    const [datos, setDatos] = useState<MonitorFace | null>(null);
    const [resumen, setResumen] = useState<ResumenFace | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [elegido, setElegido] = useState<string | null>(null);
    const [abriendoEquipos, setAbriendoEquipos] = useState(false);
    const [cajon, setCajon] = useState<{ id: string; registrar: boolean } | null>(null);
    const [agregando, setAgregando] = useState(false);
    /* Dos miradas sobre los mismos lectores: lo que PASÓ (las capturas) y lo que TIENEN cargado
       adentro (su base local). 19/11, Nico: «base de datos locales de cada lector, logs, registros, rostros». */
    const [vista, setVista] = useState<"capturas" | "base">("capturas");
    const nuevas = useRef<Set<string>>(new Set());
    const vistos = useRef<Set<string>>(new Set());
    const unEquipo = equipos.length === 1 ? equipos[0] : null;

    const cargar = useCallback(async () => {
        try {
            /* El servidor filtra por UN equipo; con varios elegidos se trae todo y se filtra acá.
               Es la misma consulta y evita una ida y vuelta por cada cambio de la lista. */
            const d = await monitorFace({ dias, deviceId: unEquipo, q, que });
            nuevas.current = new Set(vistos.current.size ? d.capturas.filter((p) => !vistos.current.has(p.id)).map((p) => p.id) : []);
            for (const p of d.capturas) vistos.current.add(p.id);
            setDatos(d); setError(null);
        } catch (e: unknown) { setError(e instanceof Error ? e.message : "No se pudieron traer las capturas"); }
    }, [dias, unEquipo, q, que]);

    const cargarResumen = useCallback(async () => {
        try { setResumen(await resumenMonitorFace({ dias, deviceId: unEquipo })); }
        catch { /* el resumen acompaña: sin él, las capturas se ven igual y la franja queda en gris */ }
    }, [dias, unEquipo]);

    useEffect(() => {
        const t = setTimeout(cargar, q ? 250 : 0);
        const i = setInterval(cargar, REFRESCO_MS);
        return () => { clearTimeout(t); clearInterval(i); };
    }, [cargar, q]);
    useEffect(() => {
        setResumen(null);
        cargarResumen();
        const i = setInterval(cargarResumen, REFRESCO_RESUMEN_MS);
        return () => clearInterval(i);
    }, [cargarResumen]);

    const capturas = useMemo(() => {
        const todas = datos?.capturas || [];
        return equipos.length > 1 ? todas.filter((p) => p.deviceId && equipos.includes(p.deviceId)) : todas;
    }, [datos, equipos]);
    const rafagas = useMemo(() => (juntar ? agruparRafagas(capturas) : capturas.map((c) => ({ cabeza: c, resto: [] }))), [capturas, juntar]);

    const sel = useMemo(() => {
        if (!elegido) return null;
        const r = rafagas.find((x) => x.cabeza.id === elegido || x.resto.some((y) => y.id === elegido));
        if (!r) return null;
        return { r, c: r.cabeza.id === elegido ? r.cabeza : r.resto.find((y) => y.id === elegido)! };
    }, [rafagas, elegido]);
    const porDia = useMemo(() => {
        const g = new Map<string, Rafaga<CapturaFace>[]>();
        for (const r of rafagas) {
            const k = r.cabeza.cuando.slice(0, 10);
            if (!g.has(k)) g.set(k, []);
            g.get(k)!.push(r);
        }
        return [...g.entries()];
    }, [rafagas]);

    const agregar = async (c: CapturaFace) => {
        setAgregando(true);
        try {
            const r = await rostroDesdeEvento(c.id);
            toast.success({ title: r.nueva ? `Nació ${r.codigo}` : `Era ${r.nombre || r.codigo}`, description: r.nueva ? "Ahora decile quién es." : "El motor la reconoció: se le sumó esta captura." });
            await cargar();
            setCajon({ id: r.id, registrar: r.nueva });
        } catch (e: unknown) { toast.error({ title: "No se pudo agregar", description: e instanceof Error ? e.message : undefined }); }
        finally { setAgregando(false); }
    };

    if (error && !datos) return <div className="p-6 lg:p-8 max-w-[1500px] mx-auto"><ErrorEstado mensaje={error} alReintentar={cargar} /></div>;
    if (!datos) return <div className="p-6 lg:p-8 max-w-[1500px] mx-auto"><Cargando texto="Trayendo las capturas…" /></div>;

    const rotuloEquipos = equipos.length === 0 ? "Todos los equipos"
        : equipos.length === 1 ? (datos.equipos.find((e) => e.id === equipos[0])?.nombre || "1 equipo")
            : `${equipos.length} de ${datos.equipos.length} equipos`;
    const cuantas: Partial<Record<QueMostrar, number>> = resumen ? {
        todas: resumen.total,
        identificadas: resumen.identidades.padron + resumen.identidades.misma + resumen.identidades.nueva,
        "sin-comparar": resumen.identidades["sin-cara"],
        negadas: resumen.negadas,
    } : {};
    const periodo = dias === 1 ? "hoy" : `los últimos ${dias} días`;

    return (
        <div className="relative h-full flex flex-col overflow-hidden bg-background">
            {/* La barra: material translúcido con el contenido corriendo por debajo. */}
            <header className="relative z-20 shrink-0 px-6 lg:px-8 pt-5 pb-3 bg-[color-mix(in_oklab,var(--card)_55%,transparent)] backdrop-blur-xl">
                <div className="flex items-center gap-3 flex-wrap">
                    <span className="grid h-9 w-9 place-items-center rounded-[10px] bg-foreground text-background shrink-0"><ScanFace size={18} strokeWidth={2.3} /></span>
                    <div className="min-w-0">
                        <h1 className="text-[17px] font-bold leading-tight tracking-[-0.01em]">Monitor Face</h1>
                        <p className="text-[12px] text-muted-foreground leading-snug">
                            {vista === "capturas"
                                ? <>{resumen ? <><span className="tabular-nums font-semibold text-foreground">{resumen.total.toLocaleString("es-UY")}</span> capturas en {periodo}</> : `Capturas de ${periodo}`} · {rotuloEquipos.toLowerCase()}</>
                                : "Lo que cada lector tiene guardado adentro, y cuánto de eso está en el padrón"}
                        </p>
                    </div>

                    {/* Las dos miradas. Píldoras: en este sistema la píldora significa elegir. */}
                    <Segmentado id="vista" valor={vista} alCambiar={setVista} opciones={[["capturas", "Capturas"], ["base", "Base de los lectores"]]} className="ml-1" />

                    <div className="ml-auto flex items-center gap-2 flex-wrap">
                        <label className={cn("relative", vista === "base" && "hidden")}>
                            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nombre, código, tarjeta o legajo"
                                className="h-9 w-[220px] pl-8 pr-3 rounded-full border border-border bg-card/70 text-[12.5px] outline-none transition-shadow focus:ring-2 focus:ring-[var(--accion)]/35" />
                        </label>
                        {vista === "capturas" && (
                            <>
                                <Segmentado id="periodo" valor={String(dias)} alCambiar={(v) => setDias(Number(v))} opciones={DIAS.map((d) => [String(d), d === 1 ? "Hoy" : `${d} días`] as const)} />
                                <ElegirEquipos equipos={datos.equipos} elegidos={equipos} alCambiar={setEquipos}
                                    abierto={abriendoEquipos} alAbrir={setAbriendoEquipos} rotulo={rotuloEquipos} />
                            </>
                        )}
                    </div>
                </div>
            </header>
            {/* Donde la barra toca el contenido: un degradado, no una línea. */}
            <div className="relative z-10 h-5 -mt-5 shrink-0 bg-gradient-to-b from-background/80 to-transparent pointer-events-none" />

            <div className="flex-1 min-h-0 overflow-y-auto">
                {vista === "base" ? (
                    <BaseDeEquipos equipos={datos.equipos.map((e) => ({ id: e.id, nombre: e.nombre }))}
                        elegido={equipos[0] || null} alElegir={(id) => setEquipos([id])} />
                ) : (
                <div className="px-6 lg:px-8 pb-10 space-y-4">
                    <FranjaAnalisis r={resumen} cargando={!resumen} />

                    {/* Qué mostrar, y si juntar las ráfagas. */}
                    <div className="flex items-center gap-3 flex-wrap">
                        <div className="inline-flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label="Qué capturas mostrar">
                            {QUE_MOSTRAR.map((o) => (
                                <Pista key={o.id} texto={o.ayuda} titulo={o.rotulo}>
                                    <button type="button" role="radio" aria-checked={que === o.id} onClick={() => setQue(o.id)}
                                        className={cn("h-8 px-3 rounded-full border text-[12.5px] font-semibold inline-flex items-center gap-1.5 transition-colors",
                                            que === o.id ? "border-foreground bg-foreground text-background" : "border-border bg-card hover:bg-accent/60")}>
                                        {o.rotulo}
                                        {cuantas[o.id] != null && <span className={cn("tabular-nums text-[11px]", que === o.id ? "text-background/70" : "text-muted-foreground")}>{cuantas[o.id]!.toLocaleString("es-UY")}</span>}
                                    </button>
                                </Pista>
                            ))}
                        </div>
                        <label className="ml-auto inline-flex items-center gap-2 text-[12.5px] font-semibold cursor-pointer select-none">
                            <Layers size={14} className="text-muted-foreground" />
                            <Pista texto="Las capturas seguidas de un mismo equipo que pueden ser una sola persona van juntas, con la mejor cara al frente. Lo que contó el equipo no se junta nunca: cada una es una decisión de la puerta.">
                                <span>Juntar ráfagas</span>
                            </Pista>
                            <Switch checked={juntar} onCheckedChange={setJuntar} aria-label="Juntar ráfagas" />
                        </label>
                    </div>

                    {datos.recortado && (
                        <p className="text-[11.5px] text-muted-foreground">Se muestran las {capturas.length} más nuevas. Para ver más atrás, elegí un equipo, un filtro o buscá.</p>
                    )}

                    {rafagas.length === 0 ? (
                        <Vacio icono={ScanFace} titulo={que === "todas" ? "Ninguna captura en este período" : "Ninguna captura con este filtro"}
                            ayuda="Un portero cuenta sus pasadas cuando se lo escucha (hay que apuntarle los avisos a OmniAccess) y un control de acceso cuando se le trae la bitácora desde su ficha. OmniVision suma las suyas si le está mirando el video." />
                    ) : porDia.map(([dia, lista]) => (
                        <section key={dia}>
                            <h2 className="sticky top-0 z-10 -mx-2 px-2 py-2 bg-background/80 backdrop-blur-sm text-[9.5px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                                {fecha(dia)} · <span className="tabular-nums">{lista.length}</span> {lista.length === 1 ? "pasada" : "pasadas"}
                            </h2>
                            <div className="mt-1 grid gap-2.5 [grid-auto-flow:dense] [grid-auto-rows:100px] [grid-template-columns:repeat(auto-fill,minmax(152px,1fr))]">
                                <AnimatePresence initial={false}>
                                    {lista.map((r, i) => (
                                        <Baldosa key={r.cabeza.id} r={r} tamano={tamanoDe(r, i)} activo={!!sel && sel.r.cabeza.id === r.cabeza.id}
                                            nueva={nuevas.current.has(r.cabeza.id)} alElegir={() => setElegido(r.cabeza.id)} />
                                    ))}
                                </AnimatePresence>
                            </div>
                        </section>
                    ))}
                </div>
                )}
            </div>

            {/* La captura elegida: una hoja que entra desde la derecha y se va por donde vino. */}
            <AnimatePresence>
                {sel && vista === "capturas" && (
                    <HojaCaptura key="hoja" r={sel.r} elegida={sel.c} umbrales={datos.umbrales} puede={datos.puede} piso={datos.pisoManual}
                        agregando={agregando} alElegir={setElegido} alCerrar={() => setElegido(null)}
                        alVerFicha={(id, registrar) => setCajon({ id, registrar })} alAgregar={agregar} />
                )}
            </AnimatePresence>
            {datos.puede.verFicha && (
                <CajonRostro id={cajon?.id || null} panelInicial={cajon?.registrar ? "registrar" : null} puedeCambiar={datos.puede.registrar}
                    alCerrar={() => setCajon(null)} alCambiar={cargar} alAbrir={(id) => setCajon({ id, registrar: false })} />
            )}
        </div>
    );
}

/** Un control segmentado de píldoras, con el fondo del elegido deslizándose. */
function Segmentado<T extends string>({ id, valor, alCambiar, opciones, className }: { id: string; valor: T; alCambiar: (v: T) => void; opciones: readonly (readonly [T, string])[]; className?: string }) {
    return (
        <div className={cn("relative inline-flex items-center rounded-full border border-border bg-card/70 p-0.5", className)}>
            {opciones.map(([v, rotulo]) => (
                <button key={v} type="button" onClick={() => alCambiar(v)}
                    className={cn("relative h-8 px-3.5 rounded-full text-[12.5px] font-semibold transition-colors",
                        valor === v ? "text-background" : "text-muted-foreground hover:text-foreground")}>
                    {valor === v && <motion.span layoutId={`${id}-activo`} transition={RESORTE} className="absolute inset-0 rounded-full bg-foreground" />}
                    <span className="relative">{rotulo}</span>
                </button>
            ))}
        </div>
    );
}

/**
 * Una ráfaga en el bento. Al frente va la cara —el recorte, no la escena: es lo que se vino a
 * mirar— y encima qué se decidió con ella. El tamaño sale de cuánto hay para ver (ver `tamanoDe`).
 */
function Baldosa({ r, tamano, activo, nueva, alElegir }: { r: Rafaga<CapturaFace>; tamano: "grande" | "medio" | "chico"; activo: boolean; nueva: boolean; alElegir: () => void }) {
    const quieto = useReducedMotion();
    const p = r.cabeza;
    const Ico = (p.tipo && ICONO_TIPO[p.tipo]) || ScanFace;
    /* En la grande va la escena (hay lugar para ver dónde estaba); en las demás, la cara. */
    const foto = tamano === "grande" ? (p.escena || p.foto || p.cara) : (p.cara || p.foto);
    const negada = p.decision === "DENY";
    const tono = TONO_IDENTIDAD[p.identidad];
    const span = tamano === "grande" ? "sm:col-span-2 sm:row-span-3" : tamano === "medio" ? "sm:row-span-2" : "";
    return (
        <motion.button type="button" onClick={alElegir}
            initial={nueva ? (quieto ? { opacity: 0 } : { opacity: 0, scale: 0.96 }) : false}
            animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: quieto ? 1 : 0.98 }} transition={quieto ? SUAVE : RESORTE}
            whileTap={quieto ? undefined : { scale: 0.985 }}
            className={cn("group relative overflow-hidden rounded-[14px] border text-left transition-colors",
                span,
                activo ? "border-[var(--accion)] ring-2 ring-[var(--accion)]/25" : "border-border hover:border-foreground/25",
                foto ? "bg-black" : "bg-card")}>
            {foto ? (
                <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={getImagePath(foto) || ""} alt="" loading="lazy"
                        className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]" />
                    <span className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/85 via-black/35 to-transparent" />
                </>
            ) : (
                <span className="absolute inset-0 grid place-items-center text-muted-foreground/60"><Ico size={tamano === "chico" ? 18 : 26} /></span>
            )}
            {tamano === "grande" && p.cara && foto !== p.cara && (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={getImagePath(p.cara) || ""} alt="" className="absolute right-2.5 bottom-12 h-[72px] w-[72px] rounded-[10px] object-cover ring-2 ring-white/80" />
            )}

            {/* Qué se decidió: el tono es de ESTADO (no de acción). Sobre foto lleva fondo propio para leerse. */}
            {/* Sobre la foto el chip va pleno: el suave de estado se pierde contra una cara o una pared. */}
            <span className={cn("absolute left-2.5 top-2.5 max-w-[calc(100%-56px)] inline-flex items-center gap-1 h-[20px] px-1.5 rounded-full text-[10px] font-bold truncate", foto ? `pleno-${tono}` : `border chip-${tono}`)}>
                <Ico size={10} className="shrink-0" /> <span className="truncate">{rotuloIdentidad(p)}</span>
            </span>
            <span className="absolute right-2.5 top-2.5 flex items-center gap-1">
                {r.resto.length > 0 && (
                    <span className={cn("h-[20px] px-1.5 rounded-full text-[10px] font-bold tabular-nums inline-flex items-center", foto ? "bg-black/55 text-white ring-1 ring-white/15 backdrop-blur-md" : "bg-muted text-muted-foreground")}
                        title={`${r.resto.length + 1} capturas de la misma pasada`}>×{r.resto.length + 1}</span>
                )}
                {negada && <span className="h-[20px] w-[20px] rounded-full pleno-mal grid place-items-center" title="Negado"><AlertTriangle size={11} /></span>}
            </span>

            <span className={cn("absolute inset-x-0 bottom-0 p-2.5", foto ? "text-white" : "text-foreground")}>
                <span className="flex items-center gap-1.5">
                    <span className={cn("truncate font-bold", tamano === "grande" ? "text-[15px]" : "text-[12.5px]",
                        !p.persona && (foto ? "text-white/70 italic font-semibold" : "text-muted-foreground italic font-semibold"))}>
                        {p.persona || "Sin identificar"}
                    </span>
                    {p.registrado && <ShieldCheck size={12} className={foto ? "tono-accion-oscuro shrink-0" : "tono-bien shrink-0"} />}
                </span>
                <span className={cn("flex items-center gap-1.5 text-[11px] tabular-nums whitespace-nowrap", foto ? "text-white/75" : "text-muted-foreground")}>
                    <span className="shrink-0">{hora(p.cuando)}</span>
                    {p.similitud != null && p.identidad !== "sin-cara" && <span className="shrink-0">· {p.similitud} %</span>}
                    {/* El tamaño de la cara, sólo donde entra: en la baldosa mediana desplazaría al equipo. */}
                    {p.caraPx != null && tamano === "grande" && <span className="shrink-0">· {p.caraPx} px</span>}
                    <span className="min-w-0 truncate opacity-80">· {p.equipo}</span>
                </span>
            </span>
        </motion.button>
    );
}

/**
 * El filtro de equipos: un botón que dice el estado y abre la lista anclada a él.
 *
 * Anclado al origen (apple-design §7): la lista sale del botón que la pidió, no del centro de la
 * pantalla. Y adentro cada equipo trae lo que contó cada lado, que es la información que hace
 * falta para entender una bitácora flaca sin preguntar.
 */
function ElegirEquipos({ equipos, elegidos, alCambiar, abierto, alAbrir, rotulo }: {
    equipos: EquipoDeAcceso[]; elegidos: string[]; alCambiar: (v: string[]) => void;
    abierto: boolean; alAbrir: (v: boolean) => void; rotulo: string;
}) {
    const quieto = useReducedMotion();
    const caja = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (!abierto) return;
        const fuera = (e: MouseEvent) => { if (caja.current && !caja.current.contains(e.target as Node)) alAbrir(false); };
        const esc = (e: KeyboardEvent) => { if (e.key === "Escape") alAbrir(false); };
        document.addEventListener("mousedown", fuera); document.addEventListener("keydown", esc);
        return () => { document.removeEventListener("mousedown", fuera); document.removeEventListener("keydown", esc); };
    }, [abierto, alAbrir]);

    const alternar = (id: string) => alCambiar(elegidos.includes(id) ? elegidos.filter((x) => x !== id) : [...elegidos, id]);

    return (
        <div className="relative" ref={caja}>
            <button type="button" onClick={() => alAbrir(!abierto)}
                className={cn("h-9 px-3.5 rounded-full border text-[12.5px] font-semibold inline-flex items-center gap-2 transition-colors",
                    elegidos.length ? "border-[var(--accion)] bg-[color-mix(in_oklab,var(--accion)_10%,transparent)]" : "border-border bg-card/70 hover:bg-accent/60")}>
                <DoorOpen size={14} /> {rotulo}
            </button>
            <AnimatePresence>
                {abierto && (
                    <motion.div
                        initial={quieto ? { opacity: 0 } : { opacity: 0, scale: 0.96, y: -6 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={quieto ? { opacity: 0 } : { opacity: 0, scale: 0.97, y: -4 }}
                        transition={quieto ? SUAVE : RESORTE} style={{ transformOrigin: "top right" }}
                        className="absolute right-0 top-[calc(100%+8px)] z-30 w-[320px] max-h-[62vh] overflow-y-auto rounded-[14px] border border-border bg-popover/85 backdrop-blur-xl shadow-[var(--sombra-flotante)] p-1.5">
                        <button type="button" onClick={() => alCambiar([])}
                            className={cn("w-full flex items-center gap-2 rounded-[10px] px-2.5 py-2 text-[12.5px] font-semibold transition-colors",
                                elegidos.length === 0 ? "bg-accent" : "hover:bg-accent/60")}>
                            {elegidos.length === 0 ? <Check size={14} className="text-[var(--accion)]" /> : <span className="w-[14px]" />}
                            Todos los equipos
                        </button>
                        <div className="my-1 border-t border-border" />
                        {equipos.map((e) => {
                            const Ico = ICONO_EQUIPO[e.tipo] || DoorOpen;
                            const sel = elegidos.includes(e.id);
                            return (
                                <button key={e.id} type="button" onClick={() => alternar(e.id)}
                                    className={cn("w-full text-left rounded-[10px] px-2.5 py-2 transition-colors", sel ? "bg-accent" : "hover:bg-accent/60")}>
                                    <span className="flex items-center gap-2">
                                        {sel ? <Check size={14} className="text-[var(--accion)] shrink-0" /> : <span className="w-[14px] shrink-0" />}
                                        <Ico size={14} className="text-muted-foreground shrink-0" />
                                        <span className="font-semibold text-[12.5px] truncate flex-1">{e.nombre}</span>
                                        <span className="text-[11px] tabular-nums text-muted-foreground shrink-0">{e.hoy} hoy</span>
                                    </span>
                                    <span className="mt-1 ml-[30px] flex items-center gap-1.5 text-[10.5px]">
                                        <span className={cn("inline-flex items-center gap-1 h-[17px] px-1.5 rounded", e.delEquipo ? "chip-bien" : "chip-quieto")}>
                                            <Radio size={9} /> {e.delEquipo ? `${e.delEquipo} del equipo` : "no lo cuenta"}
                                        </span>
                                        <span className={cn("inline-flex items-center gap-1 h-[17px] px-1.5 rounded", e.propias ? "chip-info" : "chip-quieto")}>
                                            <ScanFace size={9} /> {e.propias ? `${e.propias} nuestras` : "sin mirar"}
                                        </span>
                                        {e.ultima && <span className="text-muted-foreground truncate">· {hace(e.ultima)}</span>}
                                    </span>
                                </button>
                            );
                        })}
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}

