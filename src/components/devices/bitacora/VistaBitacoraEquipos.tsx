"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
    AlertTriangle, Check, CreditCard, DoorOpen, Fingerprint, KeyRound, Radio, ScanFace, Search, ShieldCheck, X,
} from "lucide-react";
import { bitacoraEquipos, type BitacoraEquipos, type EquipoDeAcceso, type PasoEquipo } from "@/app/actions/bitacora-equipos";
import { Cargando, ErrorEstado, Vacio } from "@/components/ui/estados";
import { getImagePath } from "@/lib/image-path";
import { hora, fecha } from "@/lib/fechas";
import { cn } from "@/lib/utils";

/**
 * Bitácora de equipos: quién pasó por cada portero y control de acceso.
 *
 * Rehecha el 19/11 con el criterio de Apple (skill `apple-design`), por dos cosas que Nico vio en
 * la primera versión: «debe tener grillas tipo bento para ver más claro las pasadas» y «los
 * filtros arriba quedan raros si tenemos muchos lectores».
 *
 * Las tres decisiones que la ordenan:
 *
 * **1. La captura manda, y el tamaño dice cuánto.** Una tira de renglones iguales trata igual a
 * una pasada con la cara nítida y a una que no dejó foto. En un bento, la primera de cada día y
 * las que tienen cara ocupan más: el ojo cae en la foto, que es lo que se vino a mirar. El
 * tamaño no es decorativo — es *mapping*: más grande = hay más para ver ahí.
 *
 * **2. Los equipos no son el filtro: son el estado.** Una tarjeta por lectora arriba de todo se
 * rompe sola al llegar a diez. Ahora el filtro vive en un botón que dice «Todos» o «3 de 12» y
 * abre una lista anclada a él (anclar al origen: la lista sale del botón que la pidió). La barra
 * mide lo mismo con dos lectoras que con cuarenta.
 *
 * **3. La barra flota, no come pantalla.** Material translúcido con el contenido corriendo por
 * debajo, y un degradado donde se tocan en vez de una línea de un píxel.
 *
 * Todo lo que se mueve usa resortes críticamente amortiguados (sin rebote: nada de esto lo
 * empujó un dedo) y se apaga con `prefers-reduced-motion`.
 */

/** Cada cuánto se vuelve a pedir con la pantalla abierta: las pasadas entran solas. */
const REFRESCO_MS = 12_000;
const DIAS = [1, 7, 30];
/** El resorte de la casa para esta pantalla: sin rebote, 0,35 s (apple-design, «default UI spring»). */
const RESORTE = { type: "spring" as const, bounce: 0, duration: 0.35 };
/** Con «reducir movimiento» puesto: lo mismo, pero fundido y corto (nada se desliza ni escala). */
const SUAVE = { duration: 0.14, ease: "easeOut" as const };

const ICONO_TIPO: Record<string, typeof ScanFace> = { FACE: ScanFace, TAG: CreditCard, PIN: KeyRound, FINGERPRINT: Fingerprint };
const NOMBRE_TIPO: Record<string, string> = { FACE: "Rostro", TAG: "Tarjeta", PIN: "Clave", FINGERPRINT: "Huella" };
const ICONO_EQUIPO: Record<string, typeof DoorOpen> = { DOOR_INTERCOM: DoorOpen, ACCESS_CONTROL: KeyRound, FACE_TERMINAL: ScanFace };

const hace = (iso: string) => {
    const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
    return s < 60 ? "recién" : s < 3600 ? `hace ${Math.round(s / 60)} min` : s < 86400 ? `hace ${Math.round(s / 3600)} h` : `hace ${Math.round(s / 86400)} d`;
};

/** Qué tamaño ocupa una pasada en el bento. Es mapping, no decoración: más grande = más para ver. */
function tamanoDe(p: PasoEquipo, i: number): "grande" | "medio" | "chico" {
    const conFoto = !!(p.cara || p.foto);
    if (i === 0 && conFoto) return "grande";          // la más nueva del día, si dejó imagen
    if (conFoto && (p.persona || p.decision === "DENY")) return "medio";
    return "chico";
}

export function VistaBitacoraEquipos() {
    const [dias, setDias] = useState(7);
    /** Equipos elegidos. Vacío = todos: el estado más común no necesita que nadie lo arme. */
    const [equipos, setEquipos] = useState<string[]>([]);
    const [q, setQ] = useState("");
    const [datos, setDatos] = useState<BitacoraEquipos | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [elegido, setElegido] = useState<string | null>(null);
    const [abriendoEquipos, setAbriendoEquipos] = useState(false);
    const nuevas = useRef<Set<string>>(new Set());
    const vistos = useRef<Set<string>>(new Set());

    const cargar = useCallback(async () => {
        try {
            /* El servidor filtra por UN equipo; con varios elegidos se trae todo y se filtra acá.
               Es la misma consulta y evita una ida y vuelta por cada cambio de la lista. */
            const d = await bitacoraEquipos({ dias, deviceId: equipos.length === 1 ? equipos[0] : null, q });
            nuevas.current = new Set(vistos.current.size ? d.pasos.filter((p) => !vistos.current.has(p.id)).map((p) => p.id) : []);
            for (const p of d.pasos) vistos.current.add(p.id);
            setDatos(d); setError(null);
        } catch (e: unknown) { setError(e instanceof Error ? e.message : "No se pudo traer la bitácora"); }
    }, [dias, equipos, q]);

    useEffect(() => {
        const t = setTimeout(cargar, q ? 250 : 0);
        const i = setInterval(cargar, REFRESCO_MS);
        return () => { clearTimeout(t); clearInterval(i); };
    }, [cargar, q]);

    const pasos = useMemo(() => {
        const todos = datos?.pasos || [];
        return equipos.length > 1 ? todos.filter((p) => p.deviceId && equipos.includes(p.deviceId)) : todos;
    }, [datos, equipos]);

    const sel = useMemo(() => pasos.find((p) => p.id === elegido) || null, [pasos, elegido]);
    const porDia = useMemo(() => {
        const g = new Map<string, PasoEquipo[]>();
        for (const p of pasos) {
            const k = p.cuando.slice(0, 10);
            if (!g.has(k)) g.set(k, []);
            g.get(k)!.push(p);
        }
        return [...g.entries()];
    }, [pasos]);

    if (error && !datos) return <div className="p-6 lg:p-8 max-w-[1500px] mx-auto"><ErrorEstado mensaje={error} alReintentar={cargar} /></div>;
    if (!datos) return <div className="p-6 lg:p-8 max-w-[1500px] mx-auto"><Cargando texto="Trayendo las pasadas…" /></div>;

    const rotuloEquipos = equipos.length === 0 ? "Todos los equipos"
        : equipos.length === 1 ? (datos.equipos.find((e) => e.id === equipos[0])?.nombre || "1 equipo")
            : `${equipos.length} de ${datos.equipos.length} equipos`;

    return (
        <div className="relative h-full flex flex-col overflow-hidden bg-background">
            {/* La barra: material translúcido con el contenido corriendo por debajo. */}
            <header className="relative z-20 shrink-0 px-6 lg:px-8 pt-5 pb-3 bg-[color-mix(in_oklab,var(--card)_55%,transparent)] backdrop-blur-xl">
                <div className="flex items-center gap-3 flex-wrap">
                    <span className="grid h-9 w-9 place-items-center rounded-[10px] bg-foreground text-background shrink-0"><DoorOpen size={18} strokeWidth={2.3} /></span>
                    <div className="min-w-0">
                        <h1 className="text-[17px] font-bold leading-tight tracking-[-0.01em]">Bitácora de equipos</h1>
                        <p className="text-[12px] text-muted-foreground leading-snug">
                            <span className="tabular-nums font-semibold text-foreground">{pasos.length}</span> {pasos.length === 1 ? "pasada" : "pasadas"} · {rotuloEquipos.toLowerCase()}
                        </p>
                    </div>

                    <div className="ml-auto flex items-center gap-2">
                        <label className="relative">
                            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nombre, tarjeta o legajo"
                                className="h-9 w-[200px] pl-8 pr-3 rounded-full border border-border bg-card/70 text-[12.5px] outline-none transition-shadow focus:ring-2 focus:ring-[var(--accion)]/35" />
                        </label>

                        {/* Período: un control segmentado, con el fondo del elegido deslizándose. */}
                        <div className="relative inline-flex items-center rounded-full border border-border bg-card/70 p-0.5">
                            {DIAS.map((d) => (
                                <button key={d} type="button" onClick={() => setDias(d)}
                                    className={cn("relative h-8 px-3.5 rounded-full text-[12.5px] font-semibold transition-colors",
                                        dias === d ? "text-background" : "text-muted-foreground hover:text-foreground")}>
                                    {dias === d && <motion.span layoutId="periodo-activo" transition={RESORTE} className="absolute inset-0 rounded-full bg-foreground" />}
                                    <span className="relative">{d === 1 ? "Hoy" : `${d} días`}</span>
                                </button>
                            ))}
                        </div>

                        <ElegirEquipos equipos={datos.equipos} elegidos={equipos} alCambiar={setEquipos}
                            abierto={abriendoEquipos} alAbrir={setAbriendoEquipos} rotulo={rotuloEquipos} />
                    </div>
                </div>
            </header>
            {/* Donde la barra toca el contenido: un degradado, no una línea. */}
            <div className="relative z-10 h-5 -mt-5 shrink-0 bg-gradient-to-b from-background/80 to-transparent pointer-events-none" />

            <div className="flex-1 min-h-0 overflow-y-auto px-6 lg:px-8 pb-10">
                {pasos.length === 0 ? (
                    <Vacio icono={DoorOpen} titulo="Ninguna pasada en este período"
                        ayuda="Un portero cuenta sus pasadas cuando se lo escucha (hay que apuntarle los avisos a OmniAccess) y un control de acceso cuando se le trae la bitácora desde su ficha. OmniVision suma las suyas si le está mirando el video." />
                ) : porDia.map(([dia, lista]) => (
                    <section key={dia} className="mb-7">
                        <h2 className="sticky top-0 z-10 -mx-2 px-2 py-2 bg-background/80 backdrop-blur-sm text-[9.5px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                            {fecha(dia)} · <span className="tabular-nums">{lista.length}</span> {lista.length === 1 ? "pasada" : "pasadas"}
                        </h2>
                        <div className="mt-1 grid gap-2.5 [grid-auto-flow:dense] [grid-template-columns:repeat(auto-fill,minmax(152px,1fr))]">
                            <AnimatePresence initial={false}>
                                {lista.map((p, i) => (
                                    <Baldosa key={p.id} p={p} tamano={tamanoDe(p, i)} activo={sel?.id === p.id}
                                        nueva={nuevas.current.has(p.id)} alElegir={() => setElegido(p.id)} />
                                ))}
                            </AnimatePresence>
                        </div>
                    </section>
                ))}
            </div>

            {/* La pasada elegida: una hoja que entra desde la derecha y se va por donde vino. */}
            <AnimatePresence>
                {sel && <HojaDetalle p={sel} alCerrar={() => setElegido(null)} />}
            </AnimatePresence>
        </div>
    );
}

/** Una pasada en el bento. El tamaño sale de cuánto hay para ver (ver `tamanoDe`). */
function Baldosa({ p, tamano, activo, nueva, alElegir }: { p: PasoEquipo; tamano: "grande" | "medio" | "chico"; activo: boolean; nueva: boolean; alElegir: () => void }) {
    const quieto = useReducedMotion();
    const Ico = (p.tipo && ICONO_TIPO[p.tipo]) || ScanFace;
    const foto = p.cara || p.foto;
    const negada = p.decision === "DENY";
    const span = tamano === "grande" ? "sm:col-span-2 sm:row-span-2" : tamano === "medio" ? "sm:col-span-1 sm:row-span-2" : "";
    const alto = tamano === "chico" ? "h-[86px]" : "";
    return (
        <motion.button type="button" onClick={alElegir}
            initial={nueva ? (quieto ? { opacity: 0 } : { opacity: 0, scale: 0.96 }) : false}
            animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: quieto ? 1 : 0.98 }} transition={quieto ? SUAVE : RESORTE}
            whileTap={quieto ? undefined : { scale: 0.985 }}
            className={cn("group relative overflow-hidden rounded-[14px] border text-left transition-colors",
                span, alto,
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

            <span className={cn("absolute left-2.5 top-2.5 inline-flex items-center gap-1 h-[20px] px-1.5 rounded-full text-[10px] font-bold backdrop-blur-md",
                foto ? "bg-black/45 text-white ring-1 ring-white/15" : "bg-muted text-muted-foreground")}>
                <Ico size={10} /> {p.tipo ? NOMBRE_TIPO[p.tipo] || p.tipo : "Paso"}
            </span>
            {negada && (
                <span className="absolute right-2.5 top-2.5 h-[20px] w-[20px] rounded-full pleno-mal grid place-items-center" title="Negado"><AlertTriangle size={11} /></span>
            )}

            <span className={cn("absolute inset-x-0 bottom-0 p-2.5", foto ? "text-white" : "text-foreground")}>
                <span className="flex items-center gap-1.5">
                    <span className={cn("truncate font-bold", tamano === "grande" ? "text-[15px]" : "text-[12.5px]",
                        !p.persona && (foto ? "text-white/70 italic font-semibold" : "text-muted-foreground italic font-semibold"))}>
                        {p.persona || "Sin identificar"}
                    </span>
                    {p.registrado && <ShieldCheck size={12} className={foto ? "text-emerald-300 shrink-0" : "tono-bien shrink-0"} />}
                </span>
                <span className={cn("flex items-center gap-1.5 text-[11px] tabular-nums", foto ? "text-white/75" : "text-muted-foreground")}>
                    {hora(p.cuando)}
                    <span className="truncate opacity-80">· {p.equipo}</span>
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

/** La pasada elegida, en una hoja que entra y sale por el mismo lado. */
function HojaDetalle({ p, alCerrar }: { p: PasoEquipo; alCerrar: () => void }) {
    const quieto = useReducedMotion();
    const foto = p.cara || p.foto;
    useEffect(() => {
        const esc = (e: KeyboardEvent) => { if (e.key === "Escape") alCerrar(); };
        document.addEventListener("keydown", esc);
        return () => document.removeEventListener("keydown", esc);
    }, [alCerrar]);
    return (
        <motion.aside
            initial={quieto ? { opacity: 0 } : { x: "100%" }} animate={quieto ? { opacity: 1 } : { x: 0 }}
            exit={quieto ? { opacity: 0 } : { x: "100%" }} transition={quieto ? SUAVE : RESORTE}
            className="absolute right-0 top-0 bottom-0 z-30 w-[min(400px,92vw)] overflow-y-auto border-l border-border bg-card/85 backdrop-blur-xl shadow-[var(--sombra-flotante)]">
            <div className="p-5 space-y-4">
                <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                        <div className="text-[9.5px] font-bold uppercase tracking-[0.14em] text-muted-foreground">{p.fuente === "equipo" ? "Lo contó el equipo" : "Lo vio OmniVision"}</div>
                        <h2 className="mt-0.5 text-[21px] font-bold leading-tight tracking-[-0.01em]">{p.persona || "Sin identificar"}</h2>
                        <p className="text-[12.5px] text-muted-foreground">{fecha(p.cuando)} · {hora(p.cuando)}</p>
                    </div>
                    <button type="button" onClick={alCerrar} aria-label="Cerrar"
                        className="h-8 w-8 shrink-0 rounded-full grid place-items-center text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"><X size={16} /></button>
                </div>
                {foto && (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img src={getImagePath(foto) || ""} alt="" className="w-full rounded-[12px] object-cover bg-black [box-shadow:var(--sombra-captura)]" />
                )}
                <dl className="rounded-[12px] border border-border divide-y divide-border overflow-hidden">
                    <Dato k="Equipo" v={p.equipo} />
                    <Dato k="Con qué" v={p.tipo ? NOMBRE_TIPO[p.tipo] || p.tipo : null} />
                    <Dato k="Credencial" v={p.credencial} />
                    <Dato k="Decisión" v={p.decision === "GRANT" ? "Permitido" : p.decision === "DENY" ? "Negado" : p.decision} tono={p.decision === "DENY" ? "mal" : p.decision === "GRANT" ? "bien" : undefined} />
                    <Dato k="Sentido" v={p.sentido === "ENTRY" ? "Entrada" : p.sentido === "EXIT" ? "Salida" : p.sentido} />
                    <Dato k="Parecido" v={p.similitud != null ? `${p.similitud} %` : null} />
                    <Dato k="En el padrón" v={p.registrado ? "Sí" : "No figura"} tono={p.registrado ? "bien" : undefined} />
                </dl>
                {p.detalle && (
                    <details className="text-[11.5px] text-muted-foreground">
                        <summary className="cursor-pointer font-semibold">Lo que escribió el equipo</summary>
                        <p className="mt-1.5 break-words font-mono leading-snug">{p.detalle}</p>
                    </details>
                )}
            </div>
        </motion.aside>
    );
}

function Dato({ k, v, tono }: { k: string; v: string | null | undefined; tono?: "bien" | "mal" }) {
    return (
        <div className="flex items-baseline gap-3 px-3 py-2 text-[12.5px]">
            <dt className="w-[92px] shrink-0 text-muted-foreground">{k}</dt>
            <dd className={cn("min-w-0 font-semibold", !v && "text-muted-foreground/60 italic font-normal", tono === "bien" && "tono-bien", tono === "mal" && "tono-mal")}>{v || "—"}</dd>
        </div>
    );
}
