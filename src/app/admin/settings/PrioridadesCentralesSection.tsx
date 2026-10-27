"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, MotionConfig, motion } from "framer-motion";
import {
    ArrowDown, ArrowUp, Asterisk, BatteryWarning, Bell, BellRing, Check, CircleCheck, CircleDot, CircleSlash, ClipboardCheck,
    Database, Droplets, Flame, FlaskConical, Gauge, HardDrive, HeartPulse, ImageIcon, Info, ListChecks, LockKeyhole, Minus,
    OctagonAlert, Plus, RotateCcw, Save, ShieldAlert, Siren, SlidersHorizontal, Timer, Trash2, TrendingUp, Unplug, UserX,
} from "lucide-react";
import { toast } from "@/lib/avisos";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Pista } from "@/components/ui/pista";
import { Pestanias, type Pestania } from "@/components/ui/pestanias";
import { Cargando, ErrorEstado } from "@/components/ui/estados";
import { useConfirmar } from "@/components/ui/use-confirmar";
import { ChipPrioridad } from "@/components/alarmas/MensajesCentrales";
import { CLASES, NIVELES, PRIORIDADES_DEFECTO, nivel, type ClaseEvento, type Prioridades } from "@/lib/centrales/prioridades";
import { CLASES_CON_PROCEDIMIENTO, PASOS_MAX, type Cierre, type Escalado, type Paso, type Procedimiento, type ProcedimientosClase } from "@/lib/centrales/tratamiento-tipos";
import { cn } from "@/lib/utils";
import { useFuncion } from "@/lib/funciones-cliente";

/**
 * Ajustes › Centrales de alarma: prioridades, cierres, procedimiento, ventana y escalado, y fotos.
 *
 * Rediseño del 27/10 (Nico: «no me gusta cómo está diseñada esta sección; debe ser premium: bloques
 * claros, mejor uso de espacios, estilo de tabs, transiciones de entrada y salida, iconografía»).
 * Qué estaba mal en la versión anterior y por qué:
 *  - **Doce cajas sueltas** para doce clases: cada fila con su borde, el ojo no encontraba dónde
 *    terminaba la lista. Ahora es UN panel con renglones, y al costado lo que explica la pestaña.
 *  - **La prioridad se decía tres veces** (el número negro, el chip y el texto «de fábrica»), las
 *    tres en negro: no se distinguía una crítica de una informativa sin leer. Ahora el número elegido
 *    toma el color de su nivel y el ícono de la clase también, así la lista se lee por color.
 *  - **El escalado eran tres desplegables «hasta P2»**: había que hacer la cuenta para saber qué le
 *    pasa a una P3. Ahora es una grilla prioridad × comportamiento que se marca con un toque.
 *  - **Cambiar de pestaña perdía lo no guardado** sin avisar. Ahora una barra flotante dice que hay
 *    cambios y el cambio de pestaña pide confirmación.
 *  - Las pestañas eran las de texto negro; ahora son `Pestanias` (ícono + indicador que se desliza),
 *    la misma pieza de Gestión de alarmas, y el contenido entra y sale con una transición corta.
 *
 * Los datos y las rutas son los de siempre (/api/centrales/prioridades, /ajustes, /fotos): no cambió
 * qué se guarda, sólo cómo se ve y se edita.
 */

type Parte = "prioridades" | "cierres" | "procedimiento" | "escalado" | "fotos";

const PESTANIAS: Pestania<Parte>[] = [
    { valor: "prioridades", rotulo: "Prioridades", icono: Gauge, ayuda: "Qué tan urgente es cada clase de evento" },
    { valor: "cierres", rotulo: "Cierres", icono: ClipboardCheck, ayuda: "Lo que se elige al tratar un evento" },
    { valor: "procedimiento", rotulo: "Procedimiento", icono: ListChecks, ayuda: "Los pasos que tilda el operador" },
    { valor: "escalado", rotulo: "Ventana y escalado", icono: BellRing, ayuda: "Cuándo suena y cuándo se escala" },
    { valor: "fotos", rotulo: "Fotos y retención", icono: ImageIcon, ayuda: "Dónde quedan los cuadros y cuánto se guardan" },
];

/** Cada clase con su ícono: hace reconocible la fila sin leerla. Lo que no esté acá usa el genérico. */
const ICONO_CLASE: Partial<Record<string, React.ComponentType<{ size?: number; className?: string }>>> = {
    ROBO: ShieldAlert, PANICO: OctagonAlert, COACCION: UserX, INCENDIO: Flame, MEDICA: HeartPulse, SABOTAJE: Unplug,
    TECNICA: Droplets, FALLA: BatteryWarning, RESTAURACION: CircleCheck, ARMADO: LockKeyhole, PRUEBA: FlaskConical, OTRO: SlidersHorizontal,
};
const iconoDe = (clase: string) => ICONO_CLASE[clase] || Siren;
const tonoDe = (n: number) => nivel(n).tono;

/** La curva de todas las transiciones de la sección: arranca rápido y se posa, no rebota. */
const CURVA = [0.2, 0.8, 0.2, 1] as const;
const RESORTE = { type: "spring", stiffness: 520, damping: 38, mass: 0.7 } as const;

// ── Datos ───────────────────────────────────────────────────────────────────────────────────

/** Lee una ruta de /api/centrales con su error a la vista (un catch vacío dejaba la pestaña en blanco). */
function useLectura<T>(url: string, extraer: (j: any) => T) {
    const [datos, setDatos] = useState<T | null>(null);
    const [error, setError] = useState<string | null>(null);
    const cargar = useCallback(() => {
        setError(null);
        return fetch(url, { cache: "no-store" })
            .then(async (r) => { const j = await r.json().catch(() => null); if (!r.ok || !j?.ok) throw new Error(j?.error || `HTTP ${r.status}`); return extraer(j); })
            .then((x) => { setDatos(x); return x; })
            .catch((e) => { setError(e?.message || "No se pudo leer."); return null; });
    }, [url]); // eslint-disable-line react-hooks/exhaustive-deps
    useEffect(() => { cargar(); }, [cargar]);
    return { datos, error, cargar, setDatos };
}

type Ajustes = { cierres: Cierre[]; procedimiento: Procedimiento; procedimientosClase: ProcedimientosClase; escalado: Escalado };

async function enviar(url: string, cuerpo: unknown) {
    const r = await fetch(url, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(cuerpo) });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j?.ok) throw new Error(j?.error || `HTTP ${r.status}`);
    return j;
}

// ── La sección ──────────────────────────────────────────────────────────────────────────────

export default function CentralesSection() {
    const [parte, setParte] = useState<Parte>("prioridades");
    const [sucio, setSucio] = useState(false);
    const { confirmar, elemento } = useConfirmar();
    // Sin la Recepción de alarmas estos ajustes no existen (sus rutas contestan 404): se dice dónde prenderla.
    const recepcion = useFuncion("FUNC_ALARMAS_RECEPCION");

    const elegir = async (p: Parte) => {
        if (p === parte) return;
        if (sucio && !(await confirmar({ titulo: "Hay cambios sin guardar", descripcion: "Si cambiás de pestaña, lo que no guardaste en ésta se pierde.", accion: "Descartar y cambiar" }))) return;
        setSucio(false);
        setParte(p);
    };

    if (recepcion === false) {
        return (
            <div className="rounded-[10px] border border-border bg-card px-5 py-6 flex items-start gap-4 max-w-2xl">
                <span className="grid place-items-center w-10 h-10 rounded-[10px] bg-muted shrink-0"><Siren size={18} className="text-muted-foreground" /></span>
                <div>
                    <div className="text-[15px] font-semibold tracking-tight">La Recepción de alarmas está apagada</div>
                    <p className="mt-1 text-[12.5px] text-muted-foreground leading-relaxed">Las prioridades, los cierres, los procedimientos y el escalado son de las alarmas de las centrales. Se prende en Ajustes → Modos → Funciones de la instalación.</p>
                </div>
            </div>
        );
    }

    return (
        <MotionConfig reducedMotion="user">
            <div className="space-y-5">
                <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
                    <div className="flex items-start gap-3.5 min-w-0">
                        <span className="grid place-items-center w-11 h-11 rounded-[10px] chip-mal border shrink-0"><Siren size={20} /></span>
                        <div className="min-w-0">
                            <h2 className="text-[19px] font-bold tracking-tight leading-tight">Centrales de alarma</h2>
                            <p className="text-[12.5px] text-muted-foreground mt-1 max-w-[62ch] leading-relaxed">Cómo se clasifica, se atiende y se cierra cada evento que mandan las centrales. Lo que se cambia acá vale en Gestión de alarmas y en la ventana de cada alarma.</p>
                        </div>
                    </div>
                    <Pestanias valor={parte} opciones={PESTANIAS} alElegir={elegir} />
                </div>

                <AnimatePresence mode="wait" initial={false}>
                    <motion.div key={parte}
                        initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
                        transition={{ duration: 0.2, ease: CURVA }}>
                        {parte === "prioridades" ? <ParPrioridades alSucio={setSucio} />
                            : parte === "cierres" ? <ParCierres alSucio={setSucio} />
                                : parte === "procedimiento" ? <ParProcedimiento alSucio={setSucio} />
                                    : parte === "escalado" ? <ParEscalado alSucio={setSucio} />
                                        : <ParFotos alSucio={setSucio} />}
                    </motion.div>
                </AnimatePresence>
                {elemento}
            </div>
        </MotionConfig>
    );
}

// ── Piezas comunes de la sección ────────────────────────────────────────────────────────────

/** Panel principal + columna de ayuda. La ayuda va al costado y no arriba: arriba empujaba la lista. */
function Disposicion({ children, lado }: { children: React.ReactNode; lado: React.ReactNode }) {
    return (
        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_300px] gap-5 items-start">
            <div className="min-w-0 space-y-3">{children}</div>
            <aside className="space-y-3 xl:sticky xl:top-4">{lado}</aside>
        </div>
    );
}

/** El renglón de arriba de cada pestaña: el resumen a la izquierda, volver a fábrica a la derecha. */
function Barra({ resumen, alRestaurar, restaurarDeshabilitado, ayudaRestaurar }: { resumen: React.ReactNode; alRestaurar?: () => void; restaurarDeshabilitado?: boolean; ayudaRestaurar?: string }) {
    return (
        <div className="flex items-center gap-3 min-h-9">
            <div className="flex-1 min-w-0 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-muted-foreground">{resumen}</div>
            {alRestaurar && (
                <Pista titulo="Volver a lo de fábrica" texto={ayudaRestaurar || "Deja esta pestaña como venía el sistema y lo guarda."} lado="abajo">
                    <Button variant="ghost" size="sm" onClick={alRestaurar} disabled={restaurarDeshabilitado} className="gap-1.5 text-muted-foreground"><RotateCcw size={14} /> De fábrica</Button>
                </Pista>
            )}
        </div>
    );
}

function Tarjeta({ icono: I, titulo, children, className }: { icono: React.ComponentType<{ size?: number; className?: string }>; titulo: string; children: React.ReactNode; className?: string }) {
    return (
        <section className={cn("rounded-[10px] border border-border bg-card p-4", className)}>
            <div className="flex items-center gap-2 text-[13px] font-semibold"><I size={15} className="text-muted-foreground" />{titulo}</div>
            <div className="mt-2.5 text-[12.5px] text-muted-foreground leading-relaxed space-y-2">{children}</div>
        </section>
    );
}

/**
 * La barra que aparece abajo cuando hay algo sin guardar. Flota de verdad sobre el contenido (por
 * eso es lo único con sombra de la sección) y entra deslizándose: el guardar quieto en una esquina
 * se perdía en pantallas altas, y no decía si había algo para guardar.
 */
function BarraCambios({ visible, guardando, alDescartar, alGuardar, detalle }: { visible: boolean; guardando: boolean; alDescartar: () => void; alGuardar: () => void; detalle?: string }) {
    return (
        <AnimatePresence>
            {visible && (
                <motion.div className="sticky bottom-4 z-20 flex justify-center pointer-events-none mt-4"
                    initial={{ opacity: 0, y: 18, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 14, scale: 0.98 }}
                    transition={{ duration: 0.22, ease: CURVA }}>
                    <div className="pointer-events-auto flex items-center gap-3 pl-4 pr-2 py-2 rounded-[14px] border border-border bg-card sombra-flotante">
                        <span className="relative grid place-items-center w-2 h-2"><span className="absolute inset-0 rounded-full bg-[var(--accion)] animate-ping opacity-40" /><span className="w-2 h-2 rounded-full bg-[var(--accion)]" /></span>
                        <span className="text-[12.5px] font-semibold whitespace-nowrap">Cambios sin guardar{detalle && <span className="font-normal text-muted-foreground"> · {detalle}</span>}</span>
                        <Button variant="ghost" size="sm" onClick={alDescartar} disabled={guardando}>Descartar</Button>
                        <Button size="sm" onClick={alGuardar} disabled={guardando} className="gap-1.5">{guardando ? <span className="w-3.5 h-3.5 rounded-full border-2 border-current border-t-transparent animate-spin" /> : <Save size={14} />} Guardar</Button>
                    </div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}

/**
 * Elegir uno entre pocos, con un indicador que viaja al elegido (`layoutId`). Es una elección, no una
 * acción: por eso es una píldora. El indicador toma el tono de la opción cuando lo tiene.
 */
function Segmentos<T extends string | number>({ id, valor, opciones, alElegir, rotulo, chico }: {
    id: string; valor: T; rotulo: string; chico?: boolean;
    opciones: { valor: T; texto: React.ReactNode; tono?: string; ayuda?: string }[];
    alElegir: (v: T) => void;
}) {
    return (
        <div role="radiogroup" aria-label={rotulo} className="relative inline-flex items-center rounded-full bg-muted/70 p-[3px] shrink-0">
            {opciones.map((o) => {
                const on = o.valor === valor;
                return (
                    <button key={String(o.valor)} type="button" role="radio" aria-checked={on} title={o.ayuda} onClick={() => alElegir(o.valor)}
                        className={cn("relative rounded-full font-semibold tabular-nums transition-colors duration-200 outline-none focus-visible:ring-2 focus-visible:ring-[var(--accion)]/50",
                            chico ? "h-7 px-2.5 text-[11.5px]" : "h-8 min-w-9 px-2.5 text-[12.5px]",
                            on ? (o.tono ? "text-white" : "text-foreground") : "text-muted-foreground hover:text-foreground")}>
                        {on && <motion.span layoutId={`seg-${id}`} transition={RESORTE} className={cn("absolute inset-0 rounded-full", o.tono ? `pleno-${o.tono}` : "bg-background ring-1 ring-border/70")} />}
                        <span className="relative">{o.texto}</span>
                    </button>
                );
            })}
        </div>
    );
}

/** Un número con − y +: el campo numérico solo obligaba a apuntar a las flechitas del navegador. */
function Paso_({ valor, min, max, alCambiar, unidad, rotulo }: { valor: number; min: number; max: number; alCambiar: (n: number) => void; unidad: string; rotulo: string }) {
    const fijar = (n: number) => alCambiar(Math.max(min, Math.min(max, Number.isFinite(n) ? Math.round(n) : min)));
    const boton = "h-9 w-9 grid place-items-center text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-30 transition-colors";
    return (
        <div className="inline-flex items-center rounded-[8px] border border-border bg-background overflow-hidden">
            <button type="button" className={boton} onClick={() => fijar(valor - 1)} disabled={valor <= min} aria-label={`Menos ${rotulo}`}><Minus size={14} /></button>
            <input type="number" min={min} max={max} value={valor} aria-label={rotulo} onChange={(e) => fijar(Number(e.target.value))}
                className="h-9 w-14 text-center text-[14px] font-semibold tabular-nums bg-transparent outline-none border-x border-border [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none" />
            <span className="px-2 text-[12px] text-muted-foreground">{unidad}</span>
            <button type="button" className={cn(boton, "border-l border-border")} onClick={() => fijar(valor + 1)} disabled={valor >= max} aria-label={`Más ${rotulo}`}><Plus size={14} /></button>
        </div>
    );
}

/** Campo de texto que no parece formulario hasta que se lo toca: en una lista de doce, doce cajas grises pesaban más que el texto. */
const ENTRADA_LIMPIA = "h-9 w-full rounded-[6px] px-2.5 text-[13px] bg-transparent border border-transparent hover:border-border focus:border-[var(--accion)] focus:bg-background outline-none transition-colors placeholder:text-muted-foreground/60";

function Cubo({ icono: I, tono, tam = 34 }: { icono: React.ComponentType<{ size?: number; className?: string }>; tono: string; tam?: number }) {
    return <span className={cn("grid place-items-center rounded-[8px] border shrink-0 transition-colors duration-300", `chip-${tono}`)} style={{ width: tam, height: tam }}><I size={Math.round(tam * 0.47)} /></span>;
}

function Estados({ error, cargando, alReintentar, children }: { error: string | null; cargando: boolean; alReintentar: () => void; children: () => React.ReactNode }) {
    if (error) return <ErrorEstado mensaje={error} alReintentar={alReintentar} />;
    if (cargando) return <Cargando />;
    return <>{children()}</>;
}

// ── Prioridades ─────────────────────────────────────────────────────────────────────────────

function ParPrioridades({ alSucio }: { alSucio: (b: boolean) => void }) {
    const lect = useLectura<Prioridades>("/api/centrales/prioridades", (j) => j.prioridades);
    // El escalado se lee sólo para mostrar qué le pasa a cada nivel; si falla, la columna lo calla.
    const esc = useLectura<Escalado>("/api/centrales/ajustes", (j) => j.escalado);
    const [p, setP] = useState<Prioridades>(PRIORIDADES_DEFECTO);
    const [guardando, setGuardando] = useState(false);
    const { confirmar, elemento } = useConfirmar();
    useEffect(() => { if (lect.datos) setP(lect.datos); }, [lect.datos]);

    const guardadas = lect.datos;
    const cambiadas = useMemo(() => (guardadas ? CLASES.filter((c) => guardadas[c.clase] !== p[c.clase]).length : 0), [guardadas, p]);
    const deFabrica = CLASES.every((c) => p[c.clase] === c.defecto);
    useEffect(() => { alSucio(cambiadas > 0); }, [cambiadas, alSucio]);

    const guardar = async (restaurar = false) => {
        if (restaurar && !(await confirmar({ titulo: "Volver a las prioridades de fábrica", descripcion: "Las doce clases vuelven a su prioridad original y se guarda.", accion: "Restaurar" }))) return;
        setGuardando(true);
        try {
            const j = await enviar("/api/centrales/prioridades", restaurar ? { restaurar: true } : { prioridades: p });
            lect.setDatos(j.prioridades); setP(j.prioridades);
            toast.success(restaurar ? "Prioridades de fábrica restauradas" : "Prioridades guardadas");
        } catch (e: any) { toast.error(e?.message || "No se pudieron guardar."); }
        finally { setGuardando(false); }
    };

    const porNivel = NIVELES.map((n) => ({ ...n, cuantas: CLASES.filter((c) => p[c.clase] === n.n).length }));
    const conducta = (n: number) => esc.datos ? [
        n <= esc.datos.ventanaHasta && { icono: BellRing, texto: "Ventana con sonido" },
        n > esc.datos.ventanaHasta && n <= esc.datos.avisoHasta && { icono: Bell, texto: "Aviso abajo" },
        n <= esc.datos.escalarHasta && { icono: TrendingUp, texto: "Se escala" },
    ].filter(Boolean) as { icono: typeof Bell; texto: string }[] : [];

    return (
        <Estados error={lect.error} cargando={!guardadas} alReintentar={lect.cargar}>{() => (
            <Disposicion lado={<>
                <section className="rounded-[10px] border border-border bg-card overflow-hidden">
                    <div className="px-4 pt-3.5 pb-2 text-[13px] font-semibold flex items-center gap-2"><Gauge size={15} className="text-muted-foreground" /> Los cinco niveles</div>
                    <div className="divide-y divide-border">
                        {porNivel.map((n) => (
                            <div key={n.n} className="flex items-start gap-3 px-4 py-2.5">
                                <span className={cn("mt-0.5 w-1 self-stretch rounded-full", `pleno-${n.tono}`)} />
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center justify-between gap-2">
                                        <span className="text-[13px] font-semibold">P{n.n} · {n.nombre}</span>
                                        <motion.span key={n.cuantas} initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className="text-[12px] tabular-nums text-muted-foreground">{n.cuantas} {n.cuantas === 1 ? "clase" : "clases"}</motion.span>
                                    </div>
                                    {conducta(n.n).length > 0 && (
                                        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                                            {conducta(n.n).map((c) => <span key={c.texto} className="inline-flex items-center gap-1 text-[11.5px] text-muted-foreground"><c.icono size={12} />{c.texto}</span>)}
                                        </div>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                </section>
                <Tarjeta icono={Info} titulo="Dónde se usa">
                    <p>En Gestión de alarmas, en la pestaña Centrales y en la ventana de cada alarma de central.</p>
                    <p>Vale también para lo ya recibido: la prioridad se calcula al mostrar, no se guarda en el evento.</p>
                    <p>Sólo un administrador puede cambiarlas.</p>
                </Tarjeta>
            </>}>
                <Barra
                    resumen={<>
                        <span><b className="text-foreground tabular-nums">{CLASES.length}</b> clases de evento</span>
                        <span><b className="tono-mal tabular-nums">{porNivel[0].cuantas}</b> críticas</span>
                        {!deFabrica && <span className="inline-flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-[var(--accion)]" />distinto de fábrica en {CLASES.filter((c) => p[c.clase] !== c.defecto).length}</span>}
                    </>}
                    alRestaurar={() => guardar(true)} restaurarDeshabilitado={guardando || deFabrica} />
                <div className="rounded-[10px] border border-border bg-card overflow-hidden">
                    <div className="hidden md:grid grid-cols-[34px_minmax(0,1fr)_auto_128px] gap-4 px-4 h-9 items-center bg-muted/40 border-b border-border text-[11.5px] font-semibold text-muted-foreground">
                        <span /><span>Clase de evento</span><span className="text-center">Prioridad</span><span className="text-right">Nivel</span>
                    </div>
                    <div className="divide-y divide-border">
                        {CLASES.map((c, i) => {
                            const n = p[c.clase]; const tono = tonoDe(n); const I = iconoDe(c.clase);
                            return (
                                <motion.div key={c.clase} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25, delay: i * 0.02, ease: CURVA }}
                                    className="grid grid-cols-[34px_minmax(0,1fr)] md:grid-cols-[34px_minmax(0,1fr)_auto_128px] gap-x-4 gap-y-2 px-4 py-3 items-center hover:bg-muted/25 transition-colors">
                                    <Cubo icono={I} tono={tono} />
                                    <div className="min-w-0">
                                        <div className="flex items-center gap-2 text-[13.5px] font-semibold">
                                            {c.nombre}
                                            {n !== c.defecto && (
                                                <Pista titulo="Cambiada" texto={`De fábrica era P${c.defecto} · ${nivel(c.defecto).nombre}.`}>
                                                    <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[var(--accion)]"><span className="w-1.5 h-1.5 rounded-full bg-[var(--accion)]" />cambiada</span>
                                                </Pista>
                                            )}
                                        </div>
                                        <div className="text-[12px] text-muted-foreground truncate">{c.ejemplos}</div>
                                    </div>
                                    <div className="col-start-2 md:col-start-auto">
                                        <Segmentos id={`prio-${c.clase}`} rotulo={`Prioridad de ${c.nombre}`} valor={n}
                                            opciones={NIVELES.map((x) => ({ valor: x.n, texto: x.n, tono: x.tono, ayuda: `P${x.n} · ${x.nombre}` }))}
                                            alElegir={(v) => setP((x) => ({ ...x, [c.clase as ClaseEvento]: v }))} />
                                    </div>
                                    <div className="hidden md:flex justify-end">
                                        <AnimatePresence mode="wait" initial={false}>
                                            <motion.span key={n} initial={{ opacity: 0, x: 6 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -6 }} transition={{ duration: 0.16 }}><ChipPrioridad n={n} /></motion.span>
                                        </AnimatePresence>
                                    </div>
                                </motion.div>
                            );
                        })}
                    </div>
                </div>
                <BarraCambios visible={cambiadas > 0} guardando={guardando} detalle={`${cambiadas} ${cambiadas === 1 ? "clase" : "clases"}`}
                    alDescartar={() => guardadas && setP(guardadas)} alGuardar={() => guardar(false)} />
                {elemento}
            </Disposicion>
        )}</Estados>
    );
}

// ── Lo que se guarda en /api/centrales/ajustes (cierres, procedimiento, escalado) ─────────────

/** Cada pestaña guarda sólo su parte; el procedimiento son dos ajustes que se editan juntos. */
function useAjustes(parte: "cierres" | "procedimiento" | "escalado", alSucio: (b: boolean) => void) {
    const lect = useLectura<Ajustes>("/api/centrales/ajustes", (j) => j as Ajustes);
    const [a, setA] = useState<Ajustes | null>(null);
    const [guardando, setGuardando] = useState(false);
    const { confirmar, elemento } = useConfirmar();
    useEffect(() => { if (lect.datos) setA(lect.datos); }, [lect.datos]);
    const delaParte = (x: Ajustes) => (parte === "procedimiento" ? { procedimiento: x.procedimiento, procedimientosClase: x.procedimientosClase } : { [parte]: x[parte] });
    const cambiado = !!a && !!lect.datos && JSON.stringify(delaParte(a)) !== JSON.stringify(delaParte(lect.datos));
    useEffect(() => { alSucio(cambiado); }, [cambiado, alSucio]);
    const guardar = async (restaurar = false) => {
        if (!a) return;
        if (restaurar && !(await confirmar({ titulo: "Volver a lo de fábrica", descripcion: "Esta pestaña vuelve a como venía el sistema y se guarda. Las otras no cambian.", accion: "Restaurar" }))) return;
        setGuardando(true);
        try {
            const j = await enviar("/api/centrales/ajustes", restaurar ? { restaurar: parte } : delaParte(a));
            lect.setDatos(j); setA(j); toast.success(restaurar ? "Restaurado lo de fábrica" : "Guardado");
        } catch (e: any) { toast.error(e?.message || "No se pudo guardar."); }
        finally { setGuardando(false); }
    };
    const descartar = () => lect.datos && setA(lect.datos);
    return { lect, a, setA, guardando, cambiado, guardar, descartar, elemento };
}

// ── Cierres ─────────────────────────────────────────────────────────────────────────────────

const RESULTADOS: { valor: Cierre["resultado"]; texto: string; tono: string; icono: React.ComponentType<{ size?: number; className?: string }>; ayuda: string }[] = [
    { valor: "falsa", texto: "Falsa", tono: "bien", icono: CircleSlash, ayuda: "Cuenta como falsa alarma en los informes" },
    { valor: "real", texto: "Real", tono: "mal", icono: ShieldAlert, ayuda: "Cuenta como alarma real en los informes" },
    { valor: "otro", texto: "Otro", tono: "quieto", icono: CircleDot, ayuda: "Ni falsa ni real: no se pudo saber" },
];
const resultado = (r: Cierre["resultado"]) => RESULTADOS.find((x) => x.valor === r) || RESULTADOS[2];

function ParCierres({ alSucio }: { alSucio: (b: boolean) => void }) {
    const { lect, a, setA, guardando, cambiado, guardar, descartar, elemento } = useAjustes("cierres", alSucio);
    const fijar = (i: number, cambio: Partial<Cierre>) => a && setA({ ...a, cierres: a.cierres.map((x, j) => (j === i ? { ...x, ...cambio } : x)) });
    return (
        <Estados error={lect.error} cargando={!a} alReintentar={lect.cargar}>{() => {
            const cierres = a!.cierres;
            const cuenta = (r: Cierre["resultado"]) => cierres.filter((c) => c.activo && c.resultado === r).length;
            const inactivos = cierres.filter((c) => !c.activo).length;
            return (
                <Disposicion lado={<>
                    <section className="rounded-[10px] border border-border bg-card p-4">
                        <div className="text-[13px] font-semibold flex items-center gap-2"><ClipboardCheck size={15} className="text-muted-foreground" /> Lo que se ofrece</div>
                        <div className="mt-3 grid grid-cols-3 gap-2">
                            {RESULTADOS.map((r) => (
                                <div key={r.valor} className="rounded-[8px] bg-muted/50 px-3 py-2.5">
                                    <div className={cn("text-[20px] font-bold tabular-nums leading-none", `tono-${r.tono}`)}>{cuenta(r.valor)}</div>
                                    <div className="mt-1 text-[11.5px] text-muted-foreground">{r.texto}</div>
                                </div>
                            ))}
                        </div>
                        {inactivos > 0 && <p className="mt-2.5 text-[12px] text-muted-foreground">{inactivos} {inactivos === 1 ? "desactivado" : "desactivados"}: no se ofrecen, pero quedan en lo ya tratado.</p>}
                    </section>
                    <Tarjeta icono={Info} titulo="Cómo se usan">
                        <p>Al <b className="text-foreground">tratar</b> un evento de central, el operador elige uno de estos cierres y además escribe qué pasó.</p>
                        <p>El resultado —falsa, real u otro— es el que cuenta en los informes.</p>
                    </Tarjeta>
                </>}>
                    <Barra resumen={<span><b className="text-foreground tabular-nums">{cierres.filter((c) => c.activo).length}</b> cierres activos</span>}
                        alRestaurar={() => guardar(true)} restaurarDeshabilitado={guardando} />
                    <div className="rounded-[10px] border border-border bg-card overflow-hidden">
                        <div className="hidden md:grid grid-cols-[34px_minmax(0,1fr)_auto_64px] gap-4 px-4 h-9 items-center bg-muted/40 border-b border-border text-[11.5px] font-semibold text-muted-foreground">
                            <span /><span>Cierre</span><span className="text-center">Resultado</span><span className="text-right">Activo</span>
                        </div>
                        <div className="divide-y divide-border">
                            <AnimatePresence initial={false}>
                                {cierres.map((c, i) => {
                                    const r = resultado(c.resultado);
                                    return (
                                        <motion.div key={c.id} layout initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.22, ease: CURVA }}
                                            className="overflow-hidden">
                                            <div className={cn("grid grid-cols-[34px_minmax(0,1fr)_auto] md:grid-cols-[34px_minmax(0,1fr)_auto_64px] gap-x-4 gap-y-2 px-4 py-2.5 items-center transition-opacity", !c.activo && "opacity-50")}>
                                                <Cubo icono={r.icono} tono={c.activo ? r.tono : "neutro"} />
                                                <input value={c.texto} onChange={(e) => fijar(i, { texto: e.target.value })} maxLength={120} placeholder="Qué pasó y qué se hizo" className={cn(ENTRADA_LIMPIA, "font-semibold")} />
                                                <div className="hidden md:block">
                                                    <Segmentos id={`cierre-${c.id}`} rotulo={`Resultado de ${c.texto}`} valor={c.resultado} chico
                                                        opciones={RESULTADOS.map((x) => ({ valor: x.valor, texto: x.texto, tono: x.tono, ayuda: x.ayuda }))} alElegir={(v) => fijar(i, { resultado: v })} />
                                                </div>
                                                <div className="flex justify-end"><Switch checked={c.activo} onCheckedChange={(v) => fijar(i, { activo: v })} aria-label="Activo" /></div>
                                                <div className="md:hidden col-start-2 col-span-2">
                                                    <Segmentos id={`cierre-m-${c.id}`} rotulo={`Resultado de ${c.texto}`} valor={c.resultado} chico
                                                        opciones={RESULTADOS.map((x) => ({ valor: x.valor, texto: x.texto, tono: x.tono }))} alElegir={(v) => fijar(i, { resultado: v })} />
                                                </div>
                                            </div>
                                        </motion.div>
                                    );
                                })}
                            </AnimatePresence>
                        </div>
                        <button type="button" onClick={() => setA({ ...a!, cierres: [...cierres, { id: `nuevo-${Date.now().toString(36)}`, texto: "", resultado: "otro", activo: true }] })}
                            className="w-full h-11 flex items-center justify-center gap-2 border-t border-dashed border-border text-[12.5px] font-semibold text-[var(--accion)] hover:bg-muted/30 transition-colors">
                            <Plus size={15} /> Agregar cierre
                        </button>
                    </div>
                    <BarraCambios visible={cambiado} guardando={guardando} alDescartar={descartar} alGuardar={() => guardar(false)} />
                    {elemento}
                </Disposicion>
            );
        }}</Estados>
    );
}

// ── Procedimiento ───────────────────────────────────────────────────────────────────────────

/**
 * Los pasos de un procedimiento, uno por renglón: el texto, si es obligatorio, y subir, bajar o
 * quitar. Los renglones se mueven con animación (`layout`): al subir un paso se ve adónde fue.
 */
function EditorPasos({ pasos, alCambiar }: { pasos: Paso[]; alCambiar: (p: Paso[]) => void }) {
    const mover = (i: number, d: -1 | 1) => { const j = i + d; if (j < 0 || j >= pasos.length) return; const x = [...pasos]; [x[i], x[j]] = [x[j], x[i]]; alCambiar(x); };
    const icono = "h-8 w-8 grid place-items-center rounded-[6px] text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-25 disabled:hover:bg-transparent transition-colors";
    return (
        <div className="space-y-1">
            {pasos.length === 0 && <p className="text-[12px] text-muted-foreground px-1 py-1.5">Sin pasos: el operador sólo escribe qué pasó.</p>}
            <AnimatePresence initial={false}>
                {pasos.map((p, i) => (
                    <motion.div key={i} layout="position" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.18, ease: CURVA }}
                        className="group flex items-center gap-1.5 rounded-[8px] hover:bg-muted/30 pr-1">
                        <span className="w-6 h-6 ml-1 grid place-items-center rounded-full bg-muted text-[11px] font-bold tabular-nums text-muted-foreground shrink-0">{i + 1}</span>
                        <input value={p.texto} onChange={(e) => alCambiar(pasos.map((x, j) => (j === i ? { ...x, texto: e.target.value.slice(0, 100) } : x)))} placeholder="Qué hacer" className={cn(ENTRADA_LIMPIA, "h-8 flex-1 min-w-0")} />
                        <Pista titulo="Paso obligatorio" texto="Para tratar el evento hay que tildarlo, o saltearlo escribiendo por qué. Queda con nombre y hora.">
                            <button type="button" aria-pressed={p.obligatorio} onClick={() => alCambiar(pasos.map((x, j) => (j === i ? { ...x, obligatorio: !x.obligatorio } : x)))}
                                className={cn("h-7 px-2 rounded-full border inline-flex items-center gap-1 text-[11px] font-semibold transition-colors",
                                    p.obligatorio ? "chip-aviso" : "border-transparent text-muted-foreground/70 hover:text-foreground hover:border-border")}>
                                <Asterisk size={12} /> Obligatorio
                            </button>
                        </Pista>
                        <span className="flex items-center opacity-60 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                            <button type="button" onClick={() => mover(i, -1)} disabled={i === 0} aria-label="Subir" className={icono}><ArrowUp size={14} /></button>
                            <button type="button" onClick={() => mover(i, 1)} disabled={i === pasos.length - 1} aria-label="Bajar" className={icono}><ArrowDown size={14} /></button>
                            <button type="button" onClick={() => alCambiar(pasos.filter((_, j) => j !== i))} aria-label="Quitar el paso" className={cn(icono, "hover:text-[var(--mal-texto)]")}><Trash2 size={14} /></button>
                        </span>
                    </motion.div>
                ))}
            </AnimatePresence>
            {pasos.length < PASOS_MAX && (
                <button type="button" onClick={() => alCambiar([...pasos, { texto: "", obligatorio: false }])}
                    className="ml-1 mt-1 h-8 px-2 inline-flex items-center gap-1.5 rounded-[6px] text-[12px] font-semibold text-[var(--accion)] hover:bg-muted/40 transition-colors">
                    <Plus size={14} /> Agregar paso
                </button>
            )}
        </div>
    );
}

function ParProcedimiento({ alSucio }: { alSucio: (b: boolean) => void }) {
    const { lect, a, setA, guardando, cambiado, guardar, descartar, elemento } = useAjustes("procedimiento", alSucio);
    // Las prioridades vigentes: para el color de cada clase y para decir qué clases usan cada nivel.
    const prio = useLectura<Prioridades>("/api/centrales/prioridades", (j) => j.prioridades);
    const pr = prio.datos || PRIORIDADES_DEFECTO;
    const conProc = CLASES.filter((c) => (CLASES_CON_PROCEDIMIENTO as readonly string[]).includes(c.clase));
    return (
        <Estados error={lect.error} cargando={!a} alReintentar={lect.cargar}>{() => {
            const propio = (clase: string) => (a!.procedimientosClase as Record<string, Paso[] | null | undefined>)[clase];
            const fijarClase = (clase: string, v: Paso[] | null) => setA({ ...a!, procedimientosClase: { ...a!.procedimientosClase, [clase]: v } });
            const usanNivel = (n: number) => CLASES.filter((c) => pr[c.clase] === n && !Array.isArray(propio(c.clase))).map((c) => c.nombre);
            const conPropio = conProc.filter((c) => Array.isArray(propio(c.clase))).length;
            return (
                <div className="space-y-3">
                    <Barra
                        resumen={<>
                            <span><b className="text-foreground tabular-nums">{conPropio}</b> de {conProc.length} clases con procedimiento propio</span>
                            <span className="hidden lg:inline">Las demás usan el de su prioridad. Un evento conserva el procedimiento con que llegó.</span>
                        </>}
                        alRestaurar={() => guardar(true)} restaurarDeshabilitado={guardando} />
                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-5 items-start">
                        <div className="space-y-2">
                            <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground px-1 pb-1">Por clase de evento</div>
                            {conProc.map((c) => {
                                const pasos = propio(c.clase); const tiene = Array.isArray(pasos); const n = pr[c.clase]; const I = iconoDe(c.clase);
                                const heredados = a!.procedimiento[String(n) as keyof Procedimiento]?.length ?? 0;
                                return (
                                    <motion.section key={c.clase} layout="position" className="rounded-[10px] border border-border bg-card">
                                        <div className="flex items-center gap-3 px-3.5 py-3">
                                            <Cubo icono={I} tono={tonoDe(n)} tam={32} />
                                            <div className="min-w-0 flex-1">
                                                <div className="text-[13.5px] font-semibold">{c.nombre}</div>
                                                <div className="text-[12px] text-muted-foreground truncate">{tiene ? `${pasos!.length} ${pasos!.length === 1 ? "paso propio" : "pasos propios"}` : (heredados === 0 ? `Usa el de P${n} · ${nivel(n).nombre}, que no tiene pasos` : heredados === 1 ? `Usa el paso de P${n} · ${nivel(n).nombre}` : `Usa los ${heredados} pasos de P${n} · ${nivel(n).nombre}`)}</div>
                                            </div>
                                            <Segmentos id={`proc-${c.clase}`} rotulo={`Procedimiento de ${c.nombre}`} valor={tiene ? "propio" : "prio"} chico
                                                opciones={[{ valor: "prio", texto: `El de P${n}` }, { valor: "propio", texto: "Propio" }]}
                                                alElegir={(v) => fijarClase(c.clase, v === "propio" ? (tiene ? pasos! : [...(a!.procedimiento[String(n) as keyof Procedimiento] || [])]) : null)} />
                                        </div>
                                        <AnimatePresence initial={false}>
                                            {tiene && (
                                                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.24, ease: CURVA }} className="overflow-hidden">
                                                    <div className="border-t border-border px-2.5 py-2.5"><EditorPasos pasos={pasos!} alCambiar={(p) => fijarClase(c.clase, p)} /></div>
                                                </motion.div>
                                            )}
                                        </AnimatePresence>
                                    </motion.section>
                                );
                            })}
                        </div>
                        <div className="space-y-2">
                            <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground px-1 pb-1">Por prioridad · para las clases sin procedimiento propio</div>
                            {NIVELES.map((nv) => {
                                const k = String(nv.n) as keyof Procedimiento; const usan = usanNivel(nv.n);
                                return (
                                    <section key={nv.n} className="rounded-[10px] border border-border bg-card overflow-hidden flex">
                                        <span className={cn("w-1 shrink-0", `pleno-${nv.tono}`)} />
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-3 px-3.5 pt-3 pb-1.5">
                                                <ChipPrioridad n={nv.n} />
                                                <span className="flex-1 min-w-0 text-[12px] text-muted-foreground truncate" title={usan.join(", ")}>{usan.length ? `Lo usan: ${usan.join(", ")}` : "Ninguna clase lo usa hoy"}</span>
                                                <span className="text-[12px] tabular-nums text-muted-foreground">{a!.procedimiento[k].length} pasos</span>
                                            </div>
                                            <div className="px-2.5 pb-2.5"><EditorPasos pasos={a!.procedimiento[k]} alCambiar={(p) => setA({ ...a!, procedimiento: { ...a!.procedimiento, [k]: p } })} /></div>
                                        </div>
                                    </section>
                                );
                            })}
                        </div>
                    </div>
                    <BarraCambios visible={cambiado} guardando={guardando} alDescartar={descartar} alGuardar={() => guardar(false)} />
                    {elemento}
                </div>
            );
        }}</Estados>
    );
}

// ── Ventana y escalado ──────────────────────────────────────────────────────────────────────

/** Los tres umbrales «hasta qué prioridad», como filas de la grilla. */
const CONDUCTAS: { clave: "ventanaHasta" | "avisoHasta" | "escalarHasta"; rotulo: string; ayuda: string; icono: React.ComponentType<{ size?: number; className?: string }> }[] = [
    { clave: "ventanaHasta", rotulo: "Ventana con sonido", ayuda: "Se abre en todas las pantallas del panel y suena hasta que alguien lo trate.", icono: BellRing },
    { clave: "avisoHasta", rotulo: "Aviso abajo", ayuda: "Aparece en la pila de avisos, sin abrir ventana. Siempre incluye lo que abre ventana.", icono: Bell },
    { clave: "escalarHasta", rotulo: "Se escala", ayuda: "Si nadie lo toma, o quien lo tomó no lo trata a tiempo, vuelve a abrir la ventana y avisa según las reglas.", icono: TrendingUp },
];

function ParEscalado({ alSucio }: { alSucio: (b: boolean) => void }) {
    const { lect, a, setA, guardando, cambiado, guardar, descartar, elemento } = useAjustes("escalado", alSucio);
    return (
        <Estados error={lect.error} cargando={!a} alReintentar={lect.cargar}>{() => {
            const e = a!.escalado;
            /**
             * Tocar la celda de un nivel lleva el umbral hasta ahí; tocar la del borde lo baja uno (así
             * se llega a «nunca»). El aviso no puede quedar por debajo de la ventana (lo exige también
             * leerEscalado en el servidor): se arrastran juntos en vez de rechazar el toque.
             */
            const tocar = (k: (typeof CONDUCTAS)[number]["clave"], n: number) => {
                const v = e[k] === n ? n - 1 : n;
                const x = { ...e, [k]: v };
                if (k === "ventanaHasta" && x.avisoHasta < v) x.avisoHasta = v;
                if (k === "avisoHasta" && x.ventanaHasta > v) x.ventanaHasta = v;
                setA({ ...a!, escalado: x });
            };
            const fijarMin = (k: "tomarMin" | "tratarMin", n: number) => setA({ ...a!, escalado: { ...e, [k]: n } });
            const sinEscalado = e.escalarHasta === 0;
            return (
                <Disposicion lado={<>
                    <section className="rounded-[10px] border border-border bg-card p-4">
                        <div className="text-[13px] font-semibold flex items-center gap-2"><TrendingUp size={15} className="text-muted-foreground" /> Cómo se escala</div>
                        <ol className="mt-3 space-y-0">
                            {[
                                { t: "Llega el evento", d: "Abre ventana o aviso según su prioridad." },
                                { t: `Nadie lo toma en ${e.tomarMin} min`, d: "Se escala." },
                                { t: "Alguien lo toma", d: "Queda asignado a esa persona." },
                                { t: `No lo trata en ${e.tratarMin} min`, d: "Se escala otra vez." },
                            ].map((x, i, l) => (
                                <li key={i} className="relative pl-6 pb-3 last:pb-0">
                                    {i < l.length - 1 && <span className="absolute left-[7px] top-4 bottom-0 w-px bg-border" />}
                                    <span className={cn("absolute left-0 top-1 w-[15px] h-[15px] rounded-full border-2 bg-card", i % 2 ? "border-[var(--mal)]" : "border-border")} />
                                    <div className="text-[12.5px] font-semibold">{x.t}</div>
                                    <div className="text-[12px] text-muted-foreground">{x.d}</div>
                                </li>
                            ))}
                        </ol>
                    </section>
                    <Tarjeta icono={Info} titulo="Que le llegue a un supervisor">
                        <p>Escalar dispara el evento <b className="text-foreground">«Alarma de central sin atender»</b> de las reglas de notificación. Armá una regla con ese evento en Notificaciones › Reglas.</p>
                    </Tarjeta>
                </>}>
                    <Barra resumen={<span>Qué le pasa a un evento según su prioridad. Tocá una celda para marcar hasta qué nivel.</span>}
                        alRestaurar={() => guardar(true)} restaurarDeshabilitado={guardando} />
                    <div className="rounded-[10px] border border-border bg-card overflow-x-auto">
                        <div className="min-w-[560px]">
                            <div className="grid grid-cols-[minmax(180px,1fr)_repeat(5,minmax(64px,88px))] gap-2 px-4 h-11 items-center bg-muted/40 border-b border-border">
                                <span className="text-[11.5px] font-semibold text-muted-foreground">Comportamiento</span>
                                {NIVELES.map((n) => <span key={n.n} className="flex justify-center"><ChipPrioridad n={n.n} corto /></span>)}
                            </div>
                            <div className="divide-y divide-border">
                                {CONDUCTAS.map((c) => (
                                    <div key={c.clave} className="grid grid-cols-[minmax(180px,1fr)_repeat(5,minmax(64px,88px))] gap-2 px-4 py-3 items-center">
                                        <Pista titulo={c.rotulo} texto={c.ayuda} lado="derecha">
                                            <span className="flex items-center gap-2.5 min-w-0">
                                                <span className="grid place-items-center w-8 h-8 rounded-[8px] bg-muted shrink-0"><c.icono size={15} className="text-muted-foreground" /></span>
                                                <span className="min-w-0">
                                                    <span className="block text-[13px] font-semibold">{c.rotulo}</span>
                                                    <span className="block text-[11.5px] text-muted-foreground">{e[c.clave] ? `De P1 a P${e[c.clave]}` : "Nunca"}</span>
                                                </span>
                                            </span>
                                        </Pista>
                                        {NIVELES.map((n) => {
                                            const on = n.n <= e[c.clave];
                                            return (
                                                <button key={n.n} type="button" onClick={() => tocar(c.clave, n.n)} aria-pressed={on} aria-label={`${c.rotulo} en P${n.n}`}
                                                    className={cn("relative h-10 rounded-[8px] border grid place-items-center transition-all duration-200 outline-none focus-visible:ring-2 focus-visible:ring-[var(--accion)]/50",
                                                        on ? `chip-${n.tono}` : "border-dashed border-border text-muted-foreground/40 hover:text-muted-foreground hover:border-muted-foreground/40")}>
                                                    <AnimatePresence mode="wait" initial={false}>
                                                        <motion.span key={on ? "si" : "no"} initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.6, opacity: 0 }} transition={{ duration: 0.14 }}>
                                                            {on ? <Check size={16} strokeWidth={2.6} /> : <Minus size={14} />}
                                                        </motion.span>
                                                    </AnimatePresence>
                                                </button>
                                            );
                                        })}
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                    <div className={cn("grid grid-cols-1 md:grid-cols-2 gap-3 transition-opacity", sinEscalado && "opacity-50")}>
                        {([
                            ["tomarMin", "Nadie lo toma en", "Desde que llegó el evento.", 120, Timer],
                            ["tratarMin", "Quien lo tomó no lo trata en", "Desde que lo tomó.", 240, ClipboardCheck],
                        ] as const).map(([k, rotulo, ayuda, max, I]) => (
                            <section key={k} className="rounded-[10px] border border-border bg-card p-4 flex items-center gap-4">
                                <span className="grid place-items-center w-9 h-9 rounded-[8px] bg-muted shrink-0"><I size={16} className="text-muted-foreground" /></span>
                                <div className="flex-1 min-w-0">
                                    <div className="text-[11px] font-semibold text-muted-foreground">Se escala si…</div>
                                    <div className="text-[13px] font-semibold">{rotulo}</div>
                                    <div className="text-[11.5px] text-muted-foreground">{ayuda}</div>
                                </div>
                                <Paso_ valor={e[k]} min={0} max={max} unidad="min" rotulo={rotulo} alCambiar={(n) => fijarMin(k, n)} />
                            </section>
                        ))}
                    </div>
                    {sinEscalado && <p className="text-[12px] text-muted-foreground px-1">Ninguna prioridad se escala: los tiempos no se usan hasta marcar al menos P1 en «Se escala».</p>}
                    <BarraCambios visible={cambiado} guardando={guardando} alDescartar={descartar} alGuardar={() => guardar(false)} />
                    {elemento}
                </Disposicion>
            );
        }}</Estados>
    );
}

// ── Fotos y retención ───────────────────────────────────────────────────────────────────────

type DatosFotos = {
    bucket: string; dias: number; topeGb: number; regla: number; existe: boolean; n: number; bytes: number; desde: string | null; truncado: boolean;
    limites: { diasMin: number; diasMax: number; topeMin: number; topeMax: number };
};
const tamano = (b: number) => (b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : b >= 1e6 ? `${(b / 1e6).toFixed(0)} MB` : `${Math.round(b / 1e3)} KB`);
/** Desde qué parte del tope la barra avisa y desde cuál alarma (el receptor recorta al 90 %). */
const USO_AVISO = 0.7;
const USO_MAL = 0.9;

/**
 * Dónde quedan los cuadros que se guardan con cada alarma y cuánto se guardan (23/10, Nico: «su
 * bucket para separar las fotos de confirmaciones de robo; cuidar muy bien las retenciones para que
 * no se nos llene el disco»). Dos topes: los días (los aplica el almacenamiento solo) y el tamaño
 * (lo revisa el receptor cada 6 h: una central en bucle llena el disco antes de que venzan los días).
 */
function ParFotos({ alSucio }: { alSucio: (b: boolean) => void }) {
    const lect = useLectura<DatosFotos>("/api/centrales/fotos", (j) => j as DatosFotos);
    const [dias, setDias] = useState(0);
    const [tope, setTope] = useState(0);
    const [guardando, setGuardando] = useState(false);
    const d = lect.datos;
    useEffect(() => { if (d) { setDias(d.dias); setTope(d.topeGb); } }, [d]);
    const cambiado = !!d && (d.dias !== dias || d.topeGb !== tope);
    useEffect(() => { alSucio(cambiado); }, [cambiado, alSucio]);
    const guardar = async () => {
        setGuardando(true);
        try {
            const j = await enviar("/api/centrales/fotos", { dias, topeGb: tope });
            if (j.aviso) toast.error(j.aviso); else toast.success(`Las fotos se guardan ${j.dias} días, con un tope de ${j.topeGb} GB`);
            lect.cargar();
        } catch (e: any) { toast.error(e?.message || "No se pudo guardar"); }
        finally { setGuardando(false); }
    };
    return (
        <Estados error={lect.error && !d ? lect.error : null} cargando={!d} alReintentar={lect.cargar}>{() => {
            const x = d!;
            const uso = x.topeGb ? Math.min(1, x.bytes / (x.topeGb * 1e9)) : 0;
            const tonoUso = uso > USO_MAL ? "mal" : uso > USO_AVISO ? "aviso" : "bien";
            const reglaDistinta = x.existe && x.regla > 0 && x.regla !== x.dias;
            const cifras = [
                { r: "Fotos", v: `${x.n.toLocaleString("es-UY")}${x.truncado ? "+" : ""}` },
                { r: "Ocupan", v: tamano(x.bytes) },
                { r: "La más vieja", v: x.desde ? new Date(x.desde).toLocaleDateString("es-UY", { day: "2-digit", month: "short", year: "numeric" }) : "—" },
            ];
            return (
                <div className="space-y-3">
                    <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] gap-5 items-start">
                        <section className="rounded-[10px] border border-border bg-card p-5">
                            <div className="flex items-start gap-3">
                                <span className="grid place-items-center w-9 h-9 rounded-[8px] bg-muted shrink-0"><Database size={16} className="text-muted-foreground" /></span>
                                <div className="min-w-0">
                                    <div className="text-[14px] font-semibold">Dónde quedan</div>
                                    <p className="mt-0.5 text-[12.5px] text-muted-foreground leading-relaxed">Los cuadros de las cámaras que se guardan con cada alarma de central van a un bucket propio, separado de las capturas de intrusión y de matrículas: cada cosa con su retención.</p>
                                </div>
                            </div>
                            <div className="mt-4 flex items-center gap-2 text-[12.5px]">
                                <span className="text-muted-foreground">Bucket</span>
                                <span className="font-semibold tabular-nums px-2 py-0.5 rounded-[6px] bg-muted">{x.bucket}</span>
                                {!x.existe && <span className="text-muted-foreground">se crea con la primera foto</span>}
                            </div>
                            <div className="mt-4 grid grid-cols-3 gap-2">
                                {cifras.map((c) => (
                                    <div key={c.r} className="rounded-[8px] bg-muted/50 px-3 py-2.5 min-w-0">
                                        <div className="text-[11.5px] text-muted-foreground">{c.r}</div>
                                        <div className="mt-0.5 text-[16px] font-bold tabular-nums tracking-tight truncate">{c.v}</div>
                                    </div>
                                ))}
                            </div>
                            <div className="mt-5">
                                <div className="flex items-baseline justify-between text-[12px]">
                                    <span className="text-muted-foreground">Uso del tope</span>
                                    <span className="tabular-nums"><b className={`tono-${tonoUso}`}>{Math.round(uso * 100)} %</b> <span className="text-muted-foreground">de {x.topeGb} GB</span></span>
                                </div>
                                <div className="mt-1.5 h-2 rounded-full bg-muted overflow-hidden">
                                    <motion.div className={cn("h-full rounded-full", `pleno-${tonoUso}`)} initial={{ width: 0 }} animate={{ width: `${Math.max(uso * 100, x.bytes ? 1 : 0)}%` }} transition={{ duration: 0.6, ease: CURVA }} />
                                </div>
                            </div>
                            <div className="mt-4 flex items-start gap-2 text-[12.5px]">
                                <HardDrive size={14} className="text-muted-foreground mt-0.5 shrink-0" />
                                {!x.existe ? <span className="text-muted-foreground">Sin fotos todavía.</span>
                                    : x.regla ? <span>El almacenamiento borra solo lo de más de <b>{x.regla} días</b>.</span>
                                        : <span className="tono-aviso font-semibold">El bucket no tiene regla de días: crece hasta el tope de tamaño.</span>}
                            </div>
                            {reglaDistinta && <p className="mt-1.5 text-[12px] tono-aviso">La regla del bucket ({x.regla} días) no coincide con lo guardado ({x.dias}): se corrige al guardar o en la próxima revisión del receptor.</p>}
                        </section>
                        <section className="rounded-[10px] border border-border bg-card divide-y divide-border">
                            <div className="px-5 pt-4 pb-3 text-[14px] font-semibold">Cuánto se guardan</div>
                            <div className="px-5 py-4 flex items-start gap-4">
                                <div className="flex-1 min-w-0">
                                    <div className="text-[13px] font-semibold">Días</div>
                                    <p className="mt-0.5 text-[12px] text-muted-foreground leading-snug">Lo más viejo se borra solo. Un robo se reclama semanas después: lo que haga falta guardar más se exporta desde la ficha.</p>
                                </div>
                                <Paso_ valor={dias} min={x.limites.diasMin} max={x.limites.diasMax} unidad="días" rotulo="días" alCambiar={setDias} />
                            </div>
                            <div className="px-5 py-4 flex items-start gap-4">
                                <div className="flex-1 min-w-0">
                                    <div className="text-[13px] font-semibold">Tope de tamaño</div>
                                    <p className="mt-0.5 text-[12px] text-muted-foreground leading-snug">Si una central se dispara de más y se pasa, se borran las más viejas hasta quedar en el 90 %. Lo revisa el receptor cada 6 horas.</p>
                                </div>
                                <Paso_ valor={tope} min={x.limites.topeMin} max={x.limites.topeMax} unidad="GB" rotulo="GB" alCambiar={setTope} />
                            </div>
                            <div className="px-5 py-3 text-[11.5px] text-muted-foreground">Días entre {x.limites.diasMin} y {x.limites.diasMax} · tope entre {x.limites.topeMin} y {x.limites.topeMax} GB.</div>
                        </section>
                    </div>
                    <BarraCambios visible={cambiado} guardando={guardando} alDescartar={() => { setDias(x.dias); setTope(x.topeGb); }} alGuardar={guardar} />
                </div>
            );
        }}</Estados>
    );
}
