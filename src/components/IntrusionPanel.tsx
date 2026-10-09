"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Camera, Radar, ShieldAlert, Shapes, Video, RefreshCw, Loader2 } from "lucide-react";
import { getAnalyticsGeometryBatch, getRecentDetections, resumenDetecciones, type DetItem, type ResumenDetecciones } from "@/app/actions/detections";
import { useDestello, useTiempoReal } from "@/lib/tiempo-real";
import { Estado, type Tono } from "@/components/ui/celdas";
import { Pista } from "@/components/ui/pista";
import { metaDe, type Geom } from "@/components/intrusion/comun";
import { FichaDeteccion } from "@/components/intrusion/FichaDeteccion";
import { fechaHoraSeg, hace, horaSeg, paraInput, ZONA } from "@/lib/fechas";
import { cn } from "@/lib/utils";

/**
 * Las detecciones de las cámaras (cruces de línea, intrusión, zonas), en el cajón del
 * monitor LPR.
 *
 * La primera versión del cajón era la lista de la columna central estirada: treinta
 * renglones con "hace 2 h" y nada más. Faltaban tres cosas que el guardia necesita:
 *
 *  - **Cuántas.** Contadas en la base (hoy y últimas 24 h, por tipo), no sobre las filas
 *    cargadas: un contador sobre la lista mostrada dice "30" siempre.
 *  - **Cuándo, exacto.** "hace 2 h" no se puede cruzar con una grabación ni con lo que
 *    cuenta un vecino. Ahora va la hora con segundos, y los renglones agrupados por día.
 *  - **Quién está callado.** Una cámara cuya regla se apagó no manda nada, y una lista
 *    vacía se ve igual que una noche tranquila. Cada cámara muestra su última detección.
 */

/** Cuántas se traen de entrada, y cuántas más con cada «Cargar más». El servidor corta en 150. */
const PRIMERA_TANDA = 60;
const TANDA = 45;
const TOPE = 150;

const TONO: Record<string, Tono> = { LINECROSS: "mal", INTRUSION: "mal", REGION_ENTER: "aviso", REGION_EXIT: "aviso", MOTION: "info" };

/** Los contadores agrupan los tipos como los piensa el guardia: entrar a una zona y salir de ella son "zona". */
const GRUPOS = [
    { clave: "cruce", titulo: "Cruces", tipos: ["LINECROSS"], Icono: Radar, pista: "La cámara vio algo atravesar la línea dibujada. Ej.: alguien que salta el cerco." },
    { clave: "intrusion", titulo: "Intrusiones", tipos: ["INTRUSION"], Icono: ShieldAlert, pista: "Algo se quedó dentro de la zona dibujada más tiempo del permitido. Ej.: una persona parada junto al portón." },
    { clave: "zona", titulo: "Zonas", tipos: ["REGION_ENTER", "REGION_EXIT"], Icono: Shapes, pista: "Algo entró o salió de una zona marcada. Ej.: un auto que entra al sector de obra." },
] as const;
type ClaveGrupo = (typeof GRUPOS)[number]["clave"];

const suma = (m: Record<string, number> | undefined, tipos: readonly string[]) => tipos.reduce((s, t) => s + (m?.[t] || 0), 0);
const sumaTodo = (m: Record<string, number> | undefined) => Object.values(m || {}).reduce((s, n) => s + n, 0);

/** "Persona" / "Vehículo" en vez del código de la cámara. Lo que no se reconoce va tal cual. */
function clase(label?: string | null) {
    if (!label) return null;
    if (label === "human") return "Persona";
    if (label === "vehicle") return "Vehículo";
    return label;
}

/** El rótulo del día: "Hoy", "Ayer" o "mié 07 oct", siempre en la zona del barrio. */
function rotuloDia(ymd: string) {
    const hoy = paraInput(new Date());
    const ayer = paraInput(new Date(Date.now() - 86_400_000));
    if (ymd === hoy) return "Hoy";
    if (ymd === ayer) return "Ayer";
    return new Date(`${ymd}T12:00:00Z`).toLocaleDateString("es-UY", { timeZone: ZONA, weekday: "short", day: "2-digit", month: "short" });
}

export function IntrusionPanel({ alAbrir }: {
    /** Se acepta por compatibilidad: el panel vive sólo en el cajón desde que el monitor dejó la columna central. */
    enCajon?: boolean;
    /**
     * Quién abre la ficha. Adentro de un cajón no puede abrirla el panel: el cajón es un
     * diálogo modal y la ficha quedaría atrapada debajo o lo cerraría al tocarla. Ahí la
     * abre la pantalla, después de cerrar el cajón.
     */
    alAbrir?: (d: DetItem) => void;
} = {}) {
    const [items, setItems] = useState<DetItem[] | null>(null);
    const [resumen, setResumen] = useState<ResumenDetecciones | null>(null);
    const [error, setError] = useState(false);
    const [cuantas, setCuantas] = useState(PRIMERA_TANDA);
    const [trayendo, setTrayendo] = useState(false);
    const [conMovimiento, setConMovimiento] = useState(false);
    const [filtro, setFiltro] = useState<ClaveGrupo | null>(null);
    const [ficha, setFicha] = useState<DetItem | null>(null);
    const [geom, setGeom] = useState<Record<string, Geom>>({});
    const { marcar, es } = useDestello();
    const [, tic] = useState(0);

    const cargar = useCallback((n: number) => {
        setError(false); setTrayendo(true);
        Promise.all([getRecentDetections(n, conMovimiento), resumenDetecciones()])
            .then(([lista, r]) => { setItems(lista); setResumen(r); })
            .catch(() => setError(true))
            .finally(() => setTrayendo(false));
    }, [conMovimiento]);
    useEffect(() => { cargar(cuantas); }, [cargar]); // eslint-disable-line react-hooks/exhaustive-deps
    // Los "hace 3 min" se mueven solos.
    useEffect(() => { const iv = setInterval(() => tic((x) => x + 1), 15_000); return () => clearInterval(iv); }, []);

    useTiempoReal<any>("general_detection", (d) => {
        if (!conMovimiento && d.type === "MOTION") return;
        setItems((prev) => [{ id: d.id, deviceId: d.deviceId, deviceName: d.deviceName, type: d.type, eventType: d.eventType, snapshotPath: d.snapshotPath || null, timestamp: d.timestamp, label: d.label || null }, ...(prev || []).filter((x) => x.id !== d.id)].slice(0, TOPE));
        // Los contadores suben con la detección, sin volver a preguntarle a la base.
        if (d.type !== "MOTION") setResumen((r) => r && ({
            ...r,
            hoy: { ...r.hoy, [d.type]: (r.hoy[d.type] || 0) + 1 },
            dia: { ...r.dia, [d.type]: (r.dia[d.type] || 0) + 1 },
            camaras: r.camaras.map((c) => c.id === d.deviceId ? { ...c, ultima: d.timestamp, dia: c.dia + 1, callada: false } : c),
        }));
        marcar(d.id);
    });
    // La captura llega después de la detección: se completa la miniatura cuando aparece.
    useTiempoReal<any>("detection_snapshot", (d) => {
        setItems((prev) => prev && prev.map((x) => x.id === d.id ? { ...x, snapshotPath: d.snapshotPath } : x));
    });

    const abrir = (d: DetItem) => {
        if (alAbrir) { alAbrir(d); return; }
        setFicha(d);
        // La línea o la zona dibujada sobre la captura: se pide al abrir, la ficha se muestra igual mientras llega.
        if (d.deviceId && !geom[d.deviceId]) getAnalyticsGeometryBatch([d.deviceId]).then((g) => setGeom((x) => ({ ...x, ...g }))).catch(() => { });
    };

    const visibles = useMemo(() => {
        const g = GRUPOS.find((x) => x.clave === filtro);
        return (items || []).filter((d) => !g || (g.tipos as readonly string[]).includes(d.type));
    }, [items, filtro]);

    // Agrupadas por día del barrio, en el orden en que llegan (de la más nueva a la más vieja).
    const porDia = useMemo(() => {
        const out: { dia: string; filas: DetItem[] }[] = [];
        for (const d of visibles) {
            const k = paraInput(d.timestamp);
            const ult = out[out.length - 1];
            if (ult && ult.dia === k) ult.filas.push(d); else out.push({ dia: k, filas: [d] });
        }
        return out;
    }, [visibles]);

    const hayMas = (items?.length || 0) >= cuantas && cuantas < TOPE;
    const masSi = () => { const n = Math.min(TOPE, cuantas + TANDA); setCuantas(n); cargar(n); };

    return (
        <div className="flex flex-col gap-4">
            {/* Contadores. «Hoy» es también «todas»: tocarlo saca el filtro. */}
            <div className="grid grid-cols-4 gap-2">
                <Contador titulo="Hoy" valor={sumaTodo(resumen?.hoy)} dia={sumaTodo(resumen?.dia)} activo={filtro === null}
                    onClick={() => setFiltro(null)} pista="Todas las detecciones desde la medianoche, sin contar movimiento. Abajo, las de las últimas 24 horas." />
                {GRUPOS.map((g) => (
                    <Contador key={g.clave} titulo={g.titulo} Icono={g.Icono} valor={suma(resumen?.hoy, g.tipos)} dia={suma(resumen?.dia, g.tipos)}
                        activo={filtro === g.clave} onClick={() => setFiltro((f) => f === g.clave ? null : g.clave)} pista={`${g.pista} Tocalo para ver sólo esas.`} />
                ))}
            </div>

            {/* Cada cámara con su última detección: lo que deja ver una cámara muda. */}
            {resumen && resumen.camaras.length > 0 && (
                <div className="rounded-[10px] border border-border bg-card">
                    <div className="flex items-center gap-2 px-3 pt-2.5 pb-1.5">
                        <Video size={13} className="text-muted-foreground" />
                        <span className="text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Cámaras que detectan</span>
                        <Pista texto="La última detección de cada cámara. Una cámara que pasa más de un día sin avisar se marca en ámbar: puede ser un lugar tranquilo, o una regla apagada en la cámara. Vale mirarla.">
                            <span className="ml-auto text-[10.5px] text-muted-foreground underline decoration-dotted underline-offset-2 cursor-help">¿Qué es esto?</span>
                        </Pista>
                    </div>
                    <div className="divide-y divide-border">
                        {resumen.camaras.map((c) => (
                            <div key={c.id} className="flex items-center gap-2.5 px-3 py-1.5">
                                <span className={cn("w-2 h-2 rounded-full shrink-0", c.callada ? "bg-[var(--aviso)]" : "bg-[var(--bien)]")} />
                                <span className="text-[12.5px] font-semibold text-foreground truncate min-w-0 flex-1">{c.nombre}</span>
                                <span className="text-[11px] text-muted-foreground tabular-nums shrink-0">{c.dia} en 24 h</span>
                                <span className={cn("text-[11px] tabular-nums shrink-0 w-[150px] text-right", c.callada ? "tono-aviso font-semibold" : "text-muted-foreground")}
                                    title={c.ultima ? fechaHoraSeg(c.ultima) : undefined}>
                                    {c.ultima ? `última ${hace(c.ultima)}` : "nunca detectó"}
                                </span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Barra de la lista */}
            <div className="flex items-center gap-2">
                <span className="text-[13px] font-bold text-foreground">
                    {filtro ? GRUPOS.find((g) => g.clave === filtro)?.titulo : "Todas"}
                </span>
                {items && <span className="text-[11px] text-muted-foreground tabular-nums">{visibles.length} {visibles.length === 1 ? "detección" : "detecciones"}</span>}
                <div className="ml-auto flex items-center gap-1.5">
                    <Pista texto="Sumar también el movimiento simple. Es mucho más ruidoso: por defecto se muestran sólo cruces, intrusiones y zonas.">
                        <button type="button" onClick={() => setConMovimiento((v) => !v)} aria-pressed={conMovimiento}
                            className={cn("h-7 px-2.5 rounded-full border text-[11px] font-semibold transition-colors",
                                conMovimiento ? "border-[var(--accion)] tono-accion bg-[color-mix(in_oklab,var(--accion)_10%,transparent)]" : "border-border text-muted-foreground hover:bg-accent")}>
                            Movimiento
                        </button>
                    </Pista>
                    <Pista texto="Volver a contar y a traer la lista.">
                        <button type="button" onClick={() => cargar(cuantas)} aria-label="Actualizar" className="h-7 w-7 rounded-md grid place-items-center text-muted-foreground hover:text-[var(--accion)] hover:bg-accent">
                            <RefreshCw size={13} className={cn(trayendo && "animate-spin")} />
                        </button>
                    </Pista>
                    <Pista texto="Todas las detecciones, con video y la línea de cada cámara.">
                        <Link href="/admin/monitor-intrusion" aria-label="Abrir el monitor de intrusión" className="h-7 w-7 rounded-md grid place-items-center text-muted-foreground hover:text-[var(--accion)] hover:bg-accent">
                            <ArrowUpRight size={14} />
                        </Link>
                    </Pista>
                </div>
            </div>

            {error ? (
                <p className="py-6 text-center text-[12px] text-muted-foreground">No se pudieron traer. <button onClick={() => cargar(cuantas)} className="tono-accion font-semibold">Reintentar</button></p>
            ) : items === null ? (
                <p className="py-6 text-center text-[12px] text-muted-foreground flex items-center justify-center gap-2"><Loader2 size={13} className="animate-spin" /> Cargando…</p>
            ) : visibles.length === 0 ? (
                <p className="py-6 text-center text-[12px] text-muted-foreground">Sin detecciones{filtro ? " de este tipo" : ""}{conMovimiento ? "" : " (sin contar movimiento)"}.</p>
            ) : (
                <div className="flex flex-col gap-3">
                    {porDia.map(({ dia, filas }) => (
                        <section key={dia}>
                            <div className="sticky top-0 z-[1] flex items-baseline gap-2 px-1 py-1 bg-background">
                                <span className="text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground">{rotuloDia(dia)}</span>
                                <span className="text-[10.5px] text-muted-foreground/80 tabular-nums">{filas.length}</span>
                            </div>
                            <div className="rounded-[10px] border border-border bg-card divide-y divide-border overflow-hidden">
                                {filas.map((d) => {
                                    const m = metaDe(d.type);
                                    const c = clase(d.label);
                                    return (
                                        <button key={d.id} type="button" onClick={() => abrir(d)}
                                            className={cn("w-full flex items-center gap-3 px-2.5 py-2 text-left transition-colors hover:bg-accent",
                                                es(d.id) && "bg-[var(--mal-suave)]")}>
                                            <span className="relative w-16 h-10 rounded-[6px] overflow-hidden bg-muted border border-border shrink-0 grid place-items-center text-muted-foreground">
                                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                                {d.snapshotPath ? <img src={d.snapshotPath} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} /> : <Camera size={14} />}
                                            </span>
                                            <span className="min-w-0 flex-1">
                                                <span className="flex items-center gap-1.5">
                                                    <Estado tono={TONO[d.type] || "neutro"} icono={m.Icon}>{m.label}</Estado>
                                                    {c && <span className="text-[11px] text-muted-foreground truncate">{c}</span>}
                                                </span>
                                                <span className="block mt-0.5 text-[12.5px] font-semibold text-foreground truncate">{d.deviceName || "Cámara sin identificar"}</span>
                                            </span>
                                            <span className="shrink-0 text-right leading-tight" title={fechaHoraSeg(d.timestamp)}>
                                                <span className="block text-[13px] font-semibold tabular-nums text-foreground">{horaSeg(d.timestamp)}</span>
                                                <span className="block text-[10.5px] text-muted-foreground tabular-nums">{hace(d.timestamp)}</span>
                                            </span>
                                        </button>
                                    );
                                })}
                            </div>
                        </section>
                    ))}
                    {hayMas && (
                        <button type="button" onClick={masSi} disabled={trayendo}
                            className="self-center h-8 px-3 rounded-md border border-border text-[12px] font-semibold text-foreground hover:bg-accent disabled:opacity-60">
                            {trayendo ? "Trayendo…" : "Cargar más"}
                        </button>
                    )}
                </div>
            )}

            {ficha && <FichaDeteccion det={ficha} geom={ficha.deviceId ? geom[ficha.deviceId] : undefined} onClose={() => setFicha(null)} />}
        </div>
    );
}

/** Un contador: el número de hoy grande, las 24 h abajo. Es también el filtro de la lista (una píldora de elección). */
function Contador({ titulo, valor, dia, activo, onClick, pista, Icono }: {
    titulo: string; valor: number; dia: number; activo: boolean; onClick: () => void; pista: string;
    Icono?: React.ComponentType<{ size?: number; className?: string }>;
}) {
    return (
        <Pista texto={pista} ancho={260}>
            <button type="button" onClick={onClick} aria-pressed={activo}
                className={cn("w-full rounded-[10px] border px-2.5 py-2 text-left transition-colors",
                    activo ? "border-[var(--accion)] bg-[color-mix(in_oklab,var(--accion)_8%,transparent)]" : "border-border bg-card hover:bg-accent")}>
                <span className="flex items-center gap-1 text-[10.5px] font-semibold text-muted-foreground">
                    {Icono && <Icono size={11} />}{titulo}
                </span>
                <span className={cn("block text-[22px] font-bold tabular-nums leading-tight tracking-[-0.01em]", activo ? "tono-accion" : "text-foreground")}>{valor}</span>
                <span className="block text-[10px] text-muted-foreground tabular-nums">24 h: {dia}</span>
            </button>
        </Pista>
    );
}
