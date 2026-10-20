"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Tooltip } from "react-tooltip";
import { sileo as toast } from "sileo";
import {
    Loader2, RefreshCw, Save, RotateCcw, History, HelpCircle, Timer, Repeat, Users, Activity,
    MousePointerClick, ChevronDown, ChevronUp, CheckCircle2, AlertTriangle, Wand2, Code2, Plus,
} from "lucide-react";
import Link from "next/link";
import { getQueueBounceAnalysis, getLatestQueueCounts, getResumenFilas } from "@/app/actions/queue";
import { cn } from "@/lib/utils";
import { VivoConPlay } from "@/components/queue/VivoConPlay";
import { tonoFila, ROTULO_TONO } from "@/components/queue/CajonFila";
import { useTiempoReal } from "@/lib/tiempo-real";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type Pt = { x: number; y: number };
type Field = { id: number; points: Pt[]; pct: Pt[]; debounce: number | null; objectSet: string | null };
type Task = { id: number; name: string; kind: "entrada" | "salida" | "aforo" | "otra"; fieldId: number | null; window: number | null; critical: number | null };
type Backup = { at: string; by: string; motivo: string; bytes: number };
type Estado = { device: { id: string; name: string; ip: string }; corriendo: boolean | null; fields: Field[]; tasks: Task[]; script: string; backups: Backup[]; leidoEn: string };
type Rebote = Awaited<ReturnType<typeof getQueueBounceAnalysis>>;

const TT = "tt-bosch";
const pctAScript = (p: Pt): Pt => ({ x: Math.round((p.x / 50 - 1) * 1000) / 1000, y: Math.round((p.y / 50 - 1) * 1000) / 1000 });
const fmtFecha = (iso: string) => new Date(iso).toLocaleString("es-UY", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

/** Canal de aforo (gente en la zona) frente a los contadores de Entrada/Salida. Igual que en actions/queue. */
const CANAL_AFORO_RX = /aforo|occupancy|ocupaci/i;
/**
 * Cada cuánto se relee el aforo por si el socket no llega. El push de la Bosch avisa por
 * `webhook-event` y el sondeo por `queue_update`; si el servidor de sockets se reinicia, sin esto
 * el número del medio de la zona quedaría congelado y parecería que la cámara no cuenta.
 */
const RELECTURA_AFORO_MS = 5_000;
/** Puntos por zona: lo que acepta el VCA de la Bosch. */
const MAX_PUNTOS = 16;
const MIN_PUNTOS = 3;

/**
 * El centro del polígono por su área (no el del rectángulo que lo encierra): en una zona en «L» o
 * en trapecio el centro del rectángulo cae afuera o pegado a un borde, y el número parece de otra
 * zona. La fórmula es invariante a escalar cada eje por separado, así que sirve en porcentaje aunque
 * el video esté estirado. Si el área es casi nula (puntos alineados), el promedio de los vértices.
 */
function centroide(ps: Pt[]): Pt {
    let a = 0, cx = 0, cy = 0;
    for (let i = 0; i < ps.length; i++) {
        const p = ps[i], q = ps[(i + 1) % ps.length];
        const k = p.x * q.y - q.x * p.y;
        a += k; cx += (p.x + q.x) * k; cy += (p.y + q.y) * k;
    }
    if (Math.abs(a) < 1e-6) return { x: ps.reduce((s, p) => s + p.x, 0) / ps.length, y: ps.reduce((s, p) => s + p.y, 0) / ps.length };
    return { x: cx / (3 * a), y: cy / (3 * a) };
}

function Ayuda({ texto }: { texto: string }) {
    return <HelpCircle size={13} className="text-muted-foreground/70 hover:text-foreground cursor-help shrink-0" data-tooltip-id={TT} data-tooltip-content={texto} />;
}

function Deslizador({ label, icon: Icon, valor, min, max, paso, unidad, ayuda, sugerido, onChange }: {
    label: string; icon: any; valor: number; min: number; max: number; paso: number; unidad: string; ayuda: string; sugerido?: number | null; onChange: (v: number) => void;
}) {
    return (
        <div className="space-y-2">
            <div className="flex items-center gap-2">
                <Icon size={14} className="text-primary" />
                <span className="text-xs font-semibold">{label}</span>
                <Ayuda texto={ayuda} />
                <span className="ml-auto font-mono text-sm tabular-nums">{valor.toLocaleString("es-UY", { maximumFractionDigits: 2 })} {unidad}</span>
            </div>
            <input type="range" min={min} max={max} step={paso} value={valor} onChange={(e) => onChange(Number(e.target.value))} className="w-full accent-[var(--primary)]" />
            {sugerido != null && sugerido !== valor && (
                <button onClick={() => onChange(sugerido)} className="text-[11px] text-primary hover:underline">Usar sugerido: {sugerido.toLocaleString("es-UY")} {unidad}</button>
            )}
        </div>
    );
}

/** `color` es el nombre de un tono del sistema, no un hex: los colores viven en globals.css. */
function Histo({ datos, color }: { datos: { label: string; n: number }[]; color: "aviso" | "info" | "quieto" }) {
    const max = Math.max(1, ...datos.map((d) => d.n));
    return (
        <div className="flex items-end gap-1 h-16">
            {datos.map((d) => (
                <div key={d.label} className="flex-1 flex flex-col items-center gap-1" data-tooltip-id={TT} data-tooltip-content={`${d.label}: ${d.n}`}>
                    <div className="w-full rounded-sm" style={{ height: `${Math.max(3, (d.n / max) * 48)}px`, background: `var(--${color})`, opacity: d.n ? 0.85 : 0.2 }} />
                    <span className="text-[8px] text-muted-foreground leading-none whitespace-nowrap">{d.label.replace(" s", "")}</span>
                </div>
            ))}
        </div>
    );
}

export default function EditorBosch({ deviceId, streamSrc }: { deviceId: string; streamSrc: string }) {
    const [estado, setEstado] = useState<Estado | null>(null);
    const [cargando, setCargando] = useState(true);
    const [guardando, setGuardando] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [puntos, setPuntos] = useState<Pt[]>([]);
    const [debounce, setDebounce] = useState(1);
    const [ventana, setVentana] = useState(20);
    const [critico, setCritico] = useState(3);
    const [rebote, setRebote] = useState<Rebote | null>(null);
    const [ventanaMedicion, setVentanaMedicion] = useState(240);
    const [arrastrando, setArrastrando] = useState<number | null>(null);
    const [confirmar, setConfirmar] = useState<null | { tipo: "guardar" } | { tipo: "restaurar"; at: string }>(null);
    const [verScript, setVerScript] = useState(false);
    const [videoOk, setVideoOk] = useState(true);
    const zonaRef = useRef<HTMLDivElement | null>(null);
    const [aforo, setAforo] = useState<number | null>(null);
    const [limite, setLimite] = useState<number | null>(null);

    const campo = estado?.fields[0];
    const tareaEnt = estado?.tasks.find((t) => t.kind === "entrada");
    const tareaSal = estado?.tasks.find((t) => t.kind === "salida");
    const tareaAforo = estado?.tasks.find((t) => t.kind === "aforo");

    const aplicarEstado = useCallback((e: Estado) => {
        setEstado(e);
        const f = e.fields[0];
        setPuntos(f ? f.pct : []);
        setDebounce(f?.debounce ?? 1);
        const w = e.tasks.find((t) => t.window != null)?.window;
        setVentana(w ?? 20);
        setCritico(e.tasks.find((t) => t.kind === "aforo")?.critical ?? 3);
    }, []);

    const cargar = useCallback(async () => {
        setCargando(true); setError(null);
        try {
            const r = await fetch(`/api/queue/bosch-vca?deviceId=${deviceId}`, { cache: "no-store" });
            const j = await r.json();
            if (!j.ok) throw new Error(j.error);
            aplicarEstado(j);
        } catch (e: any) { setError(e?.message || String(e)); }
        finally { setCargando(false); }
    }, [deviceId, aplicarEstado]);

    const medir = useCallback(async () => {
        try { setRebote(await getQueueBounceAnalysis(deviceId, ventanaMedicion)); } catch { /* sin datos */ }
    }, [deviceId, ventanaMedicion]);

    useEffect(() => { cargar(); }, [cargar]);
    useEffect(() => { medir(); }, [medir]);

    // ── el aforo de ahora, para el número del medio de la zona ──
    const leerAforo = useCallback(async () => {
        try {
            const r = await getLatestQueueCounts();
            const ch = r.find((x) => x.device.id === deviceId)?.channels.find((c) => CANAL_AFORO_RX.test(c.channelName));
            setAforo(ch ? ch.peopleCount : null);
        } catch { /* se reintenta en la próxima vuelta */ }
    }, [deviceId]);
    useEffect(() => {
        leerAforo();
        const t = setInterval(leerAforo, RELECTURA_AFORO_MS);
        return () => clearInterval(t);
    }, [leerAforo]);
    // El límite de la fila en OmniAccess (el de los avisos y el tablero), para el tono del número.
    useEffect(() => {
        getResumenFilas().then((fs) => setLimite(fs.find((f) => f.id === deviceId)?.limite ?? null)).catch(() => {});
    }, [deviceId]);
    useTiempoReal<any>("queue_update", (d) => {
        if (d?.deviceId === deviceId && (d.isOccupancy || CANAL_AFORO_RX.test(d.channelName || ""))) setAforo(d.peopleCount);
    });
    // El push de la Bosch (api/onvif/notify) avisa por acá, con el nombre del equipo y no su id.
    const nombreEquipo = estado?.device.name;
    useTiempoReal<any>("webhook-event", (d) => {
        if (d?.type === "BOSCH" && nombreEquipo && d.deviceName === nombreEquipo && CANAL_AFORO_RX.test(d.channelName || "")) setAforo(d.peopleCount);
    });

    const cambios = useMemo(() => {
        if (!estado || !campo) return null;
        const c: any = { fields: [], tasks: [] };
        const ptsOrig = JSON.stringify(campo.pct.map(pctAScript));
        const ptsNuevos = puntos.map(pctAScript);
        const fc: any = { id: campo.id };
        if (JSON.stringify(ptsNuevos) !== ptsOrig) fc.points = ptsNuevos;
        if ((campo.debounce ?? 1) !== debounce) fc.debounce = debounce;
        if (Object.keys(fc).length > 1) c.fields.push(fc);
        for (const t of [tareaEnt, tareaSal]) if (t && t.window != null && t.window !== ventana) c.tasks.push({ id: t.id, window: ventana });
        if (tareaAforo && tareaAforo.critical != null && tareaAforo.critical !== critico) c.tasks.push({ id: tareaAforo.id, critical: critico });
        return c.fields.length || c.tasks.length ? c : null;
    }, [estado, campo, puntos, debounce, ventana, critico, tareaEnt, tareaSal, tareaAforo]);

    const guardar = async () => {
        if (!cambios) return;
        setGuardando(true); setConfirmar(null);
        try {
            const r = await fetch("/api/queue/bosch-vca", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ deviceId, cambios }) });
            const j = await r.json();
            if (!j.ok) throw new Error(j.error);
            aplicarEstado(j);
            toast.success({ title: "Analíticas guardadas en la cámara", description: "La cámara confirmó la configuración nueva." });
        } catch (e: any) {
            toast.error({ title: "No se guardó", description: e?.message || String(e) });
        } finally { setGuardando(false); }
    };

    const restaurar = async (at: string) => {
        setGuardando(true); setConfirmar(null);
        try {
            const r = await fetch("/api/queue/bosch-vca", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ deviceId, restaurar: at }) });
            const j = await r.json();
            if (!j.ok) throw new Error(j.error);
            aplicarEstado(j);
            toast.success({ title: "Configuración restaurada", description: `Volvió al backup del ${fmtFecha(at)}.` });
        } catch (e: any) {
            toast.error({ title: "No se restauró", description: e?.message || String(e) });
        } finally { setGuardando(false); }
    };

    // ── edición del polígono ──
    const aPct = (ev: { clientX: number; clientY: number }): Pt => {
        const r = zonaRef.current!.getBoundingClientRect();
        return { x: Math.min(100, Math.max(0, ((ev.clientX - r.left) / r.width) * 100)), y: Math.min(100, Math.max(0, ((ev.clientY - r.top) / r.height) * 100)) };
    };
    const onMove = (ev: React.PointerEvent) => {
        if (arrastrando == null) return;
        const p = aPct(ev);
        setPuntos((ps) => ps.map((q, i) => (i === arrastrando ? p : q)));
    };
    const agregarEnBorde = (ev: React.MouseEvent) => {
        if (puntos.length >= MAX_PUNTOS) return toast.info({ title: `Máximo ${MAX_PUNTOS} puntos por zona` });
        const p = aPct(ev);
        let mejor = 0, dist = Infinity;
        for (let i = 0; i < puntos.length; i++) {
            const a = puntos[i], b = puntos[(i + 1) % puntos.length];
            const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
            const d = (mx - p.x) ** 2 + (my - p.y) ** 2;
            if (d < dist) { dist = d; mejor = i; }
        }
        setPuntos((ps) => [...ps.slice(0, mejor + 1), p, ...ps.slice(mejor + 1)]);
    };
    /** Tomar el «+» del medio de un borde: nace un punto ahí y ya queda agarrado para arrastrarlo. */
    const insertarEnMedio = (i: number, ev: React.PointerEvent) => {
        ev.stopPropagation(); ev.preventDefault();
        if (puntos.length >= MAX_PUNTOS) { toast.info({ title: `Máximo ${MAX_PUNTOS} puntos por zona` }); return; }
        const a = puntos[i], b = puntos[(i + 1) % puntos.length];
        setPuntos((ps) => [...ps.slice(0, i + 1), { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, ...ps.slice(i + 1)]);
        zonaRef.current?.setPointerCapture?.(ev.pointerId);
        setArrastrando(i + 1);
    };
    const quitar = (i: number) => {
        if (puntos.length <= MIN_PUNTOS) return toast.info({ title: `Una zona necesita al menos ${MIN_PUNTOS} puntos` });
        setPuntos((ps) => ps.filter((_, k) => k !== i));
    };

    const sug = rebote?.sugerido;
    const centro = puntos.length >= MIN_PUNTOS ? centroide(puntos) : null;
    const tono = limite != null ? tonoFila(aforo, limite) : null;
    const estadoCamara = estado?.corriendo ? "analíticas activas" : estado?.corriendo === false ? "analíticas detenidas" : "estado desconocido";

    return (
        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_380px] gap-5">
            <Tooltip id={TT} place="top" className="!max-w-xs !text-xs !z-[9999]" />

            {/* Video + zona */}
            <div className="space-y-3">
                {/* El estado de la cámara va arriba, FUERA del video: encima tapaba la fecha y hora que
                    la Bosch imprime en la esquina, que es lo que se mira para saber si el cuadro es
                    de ahora. */}
                <div className="flex items-center gap-3 text-[12px]">
                    <span className="flex items-center gap-2 font-semibold">
                        <span className={cn("w-2 h-2 rounded-full", estado?.corriendo ? "pleno-bien" : estado?.corriendo === false ? "pleno-mal" : "bg-muted-foreground")} />
                        {estado?.device.name || "Cámara"}
                    </span>
                    <span className="text-muted-foreground">{estadoCamara}</span>
                    <span className="ml-auto flex items-center gap-1.5 text-muted-foreground tabular-nums">
                        <Users size={13} /> Contando ahora: <b className={cn("text-foreground", tono && `tono-${tono}`)}>{aforo ?? "—"}</b>
                        {limite != null && <span>/ {limite}</span>}
                    </span>
                </div>
                <div ref={zonaRef} className="relative w-full aspect-video rounded-[10px] overflow-hidden border border-border bg-muted touch-none select-none"
                    onPointerMove={onMove} onPointerUp={() => setArrastrando(null)} onPointerCancel={() => setArrastrando(null)}
                    onDoubleClick={(e) => { if (puntos.length >= MIN_PUNTOS && !(e.target as Element).closest("button")) agregarEnBorde(e); }}>
                    {videoOk ? (
                        <VivoConPlay deviceId={deviceId} compacto><video src={`/go2rtc/api/stream.mp4?src=${streamSrc}`} poster={`/api/snapshot/${deviceId}`} autoPlay muted playsInline onError={() => setVideoOk(false)} className="absolute inset-0 w-full h-full object-fill" /></VivoConPlay>
                    ) : (
                        <img src={`/api/snapshot/${deviceId}`} alt="" className="absolute inset-0 w-full h-full object-fill" />
                    )}
                    {puntos.length >= MIN_PUNTOS && (
                        <>
                            {/* Sólo el polígono va en el SVG estirado (el trazo no se deforma gracias a
                                non-scaling-stroke). Los puntos van en HTML: en un SVG con
                                preserveAspectRatio="none" un círculo se dibuja como un óvalo. Azul de
                                acción en su versión sobre video: la zona es lo que se puede tocar. */}
                            <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 w-full h-full pointer-events-none">
                                <polygon points={puntos.map((p) => `${p.x},${p.y}`).join(" ")}
                                    style={{ fill: "var(--accion-en-oscuro)", fillOpacity: arrastrando != null ? 0.26 : 0.18, stroke: "var(--accion-en-oscuro)", strokeWidth: 2 }}
                                    vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
                            </svg>
                            {/* «+» en el medio de cada borde: agregar un punto justo donde se quiere, sin
                                tener que adivinar el doble clic. Se esconden mientras se arrastra. */}
                            {arrastrando == null && puntos.length < MAX_PUNTOS && puntos.map((p, i) => {
                                const q = puntos[(i + 1) % puntos.length];
                                return (
                                    <button key={`m${i}`} type="button" aria-label="Agregar un punto en este borde"
                                        onPointerDown={(e) => insertarEnMedio(i, e)}
                                        onDoubleClick={(e) => e.stopPropagation()}
                                        className="group absolute -translate-x-1/2 -translate-y-1/2 w-7 h-7 grid place-items-center cursor-copy"
                                        style={{ left: `${(p.x + q.x) / 2}%`, top: `${(p.y + q.y) / 2}%` }}>
                                        <span className="w-4 h-4 rounded-full grid place-items-center bg-black/45 text-white ring-1 ring-white/60 opacity-55 group-hover:opacity-100 group-hover:scale-110 transition">
                                            <Plus size={10} strokeWidth={3} />
                                        </span>
                                    </button>
                                );
                            })}
                            {puntos.map((p, i) => (
                                <div key={i} role="slider" aria-label={`Punto ${i + 1} de la zona`} aria-valuetext={`${Math.round(p.x)}%, ${Math.round(p.y)}%`}
                                    onPointerDown={(e) => { e.stopPropagation(); zonaRef.current?.setPointerCapture?.(e.pointerId); setArrastrando(i); }}
                                    onDoubleClick={(e) => e.stopPropagation()}
                                    onContextMenu={(e) => { e.preventDefault(); quitar(i); }}
                                    className={cn("group absolute -translate-x-1/2 -translate-y-1/2 w-8 h-8 grid place-items-center",
                                        arrastrando === i ? "cursor-grabbing" : "cursor-grab")}
                                    style={{ left: `${p.x}%`, top: `${p.y}%` }}>
                                    {/* Lo visible es chico; el área para agarrarlo, 32 px. */}
                                    <span className={cn("rounded-full bg-white transition-all ring-[var(--accion-en-oscuro)]",
                                        arrastrando === i ? "w-4 h-4 ring-4" : "w-3 h-3 ring-2 group-hover:w-3.5 group-hover:h-3.5 group-hover:ring-[3px]")} />
                                </div>
                            ))}
                            {/* Cuántas personas cuenta la cámara en esta zona, en su centro. Se mueve con
                                la zona mientras se arrastra: así se lee que el número es de ESA zona. */}
                            {centro && (
                                <div className="absolute -translate-x-1/2 -translate-y-1/2 pointer-events-none transition-[left,top] duration-150"
                                    style={{ left: `${centro.x}%`, top: `${centro.y}%` }}>
                                    <div className={cn("flex flex-col items-center rounded-[14px] px-4 py-2 min-w-[84px] shadow-[var(--sombra-flotante)]",
                                        tono && tono !== "quieto" ? `pleno-${tono}` : "bg-black/65 text-white")}>
                                        <span className="text-[34px] font-bold leading-none tabular-nums">{aforo ?? "—"}</span>
                                        <span className="text-[11px] font-semibold mt-1 opacity-90 whitespace-nowrap">
                                            {aforo == null ? "sin lectura" : aforo === 1 ? "persona" : "personas"}
                                            {tono && aforo != null && <> · {ROTULO_TONO[tono].toLowerCase()}</>}
                                        </span>
                                    </div>
                                </div>
                            )}
                        </>
                    )}
                    {cargando && <div className="absolute inset-0 flex items-center justify-center bg-background/40"><Loader2 className="animate-spin" /></div>}
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                    <span className="flex items-center gap-1"><MousePointerClick size={12} /> Arrastrá un punto para mover el borde</span>
                    <span className="flex items-center gap-1"><Plus size={12} /> El «+» de un borde agrega un punto (también doble clic)</span>
                    <span>Clic derecho sobre un punto: lo quita</span>
                </div>
                {error && (
                    <div className="flex items-start gap-2 rounded-[10px] border chip-mal p-3 text-sm">
                        <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                        <span className="flex-1">No se pudo leer la configuración de la cámara: {error}</span>
                        <button onClick={cargar} className="text-[12px] font-semibold underline">Reintentar</button>
                    </div>
                )}

                {/* Script avanzado */}
                <button onClick={() => setVerScript((v) => !v)} className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground">
                    <Code2 size={13} /> Ver configuración técnica de la cámara {verScript ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                </button>
                {verScript && estado && <pre className="text-[11px] leading-relaxed bg-muted/60 border border-border rounded-lg p-3 overflow-auto max-h-72 font-mono">{estado.script}</pre>}
            </div>

            {/* Panel */}
            <div className="space-y-4">
                <div className="rounded-xl border border-border bg-card p-4 space-y-5">
                    <div className="flex items-center gap-2">
                        <span className="text-sm font-bold">Zona de la fila</span>
                        <span className="text-[11px] text-muted-foreground">{puntos.length} puntos</span>
                        <button onClick={cargar} disabled={cargando || guardando} className="ml-auto p-1.5 rounded-md hover:bg-muted" data-tooltip-id={TT} data-tooltip-content="Volver a leer lo que tiene la cámara (descarta los cambios sin guardar)"><RefreshCw size={14} className={cn(cargando && "animate-spin")} /></button>
                    </div>
                    <Deslizador label="Rebote de la zona" icon={Timer} valor={debounce} min={0} max={5} paso={0.25} unidad="s" sugerido={sug?.debounce}
                        ayuda="Tiempo que una persona tiene que estar dentro (o fuera) de la zona para que la cámara cambie el conteo. Ejemplo: con 1 s, alguien que pasa rozando el borde medio segundo no suma; con 0 s el aforo parpadea más." onChange={setDebounce} />
                    <Deslizador label="Ventana anti doble conteo" icon={Repeat} valor={ventana} min={0} max={60} paso={1} unidad="s" sugerido={sug?.ventana}
                        ayuda="Si la misma persona vuelve a entrar o salir dentro de este tiempo, la cámara no la cuenta de nuevo. Ejemplo: con 20 s, alguien que sale y vuelve a la fila a los 10 s cuenta una sola entrada." onChange={setVentana} />
                    <div className="space-y-2">
                        <div className="flex items-center gap-2">
                            <Users size={14} className="text-primary" />
                            <span className="text-xs font-semibold">Aforo crítico de la cámara</span>
                            <Ayuda texto="Es la alarma PROPIA de la Bosch (su tarea de aforo): a partir de cuántas personas la cámara marca la zona como crítica en sus eventos, su relé o su grabador. No es el límite de la fila en OmniAccess: los avisos, el Telegram y el tablero usan el límite de la fila, que se cambia en su ficha (Filas)." />
                            <input type="number" min={1} max={99} value={critico} disabled={!tareaAforo}
                                onChange={(e) => setCritico(Math.max(1, Number(e.target.value) || 1))}
                                className="ml-auto w-16 rounded-md border border-border bg-background px-2 py-1 text-right text-sm tabular-nums disabled:opacity-50" />
                        </div>
                        {/* Los dos números convivían sin explicación (3 en la cámara, 10 en la fila) y
                            parecía que uno de los dos estaba mal. Se muestran juntos y se ofrece igualarlos. */}
                        {limite != null && (
                            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                                <span>Límite de la fila en OmniAccess: <b className="text-foreground tabular-nums">{limite}</b></span>
                                {tareaAforo?.critical != null && critico !== limite && (
                                    <button onClick={() => setCritico(limite)} className="text-[var(--accion)] hover:underline">Igualar</button>
                                )}
                                <Link href="/admin/filas" className="ml-auto text-[var(--accion)] hover:underline">Cambiarlo en la fila</Link>
                            </div>
                        )}
                        {estado && !tareaAforo && <div className="text-[11px] text-muted-foreground">La cámara no tiene una tarea de aforo: este valor no se puede guardar.</div>}
                    </div>
                    <div className="flex gap-2 pt-1">
                        <button onClick={() => { if (campo) { setPuntos(campo.pct); setDebounce(campo.debounce ?? 1); setVentana(tareaEnt?.window ?? 20); setCritico(tareaAforo?.critical ?? 3); } }} disabled={!cambios || guardando}
                            className="flex-1 flex items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-semibold hover:bg-muted disabled:opacity-40"><RotateCcw size={13} /> Descartar</button>
                        <button onClick={() => setConfirmar({ tipo: "guardar" })} disabled={!cambios || guardando}
                            className="flex-[2] flex items-center justify-center gap-1.5 rounded-lg bg-primary text-primary-foreground px-3 py-2 text-xs font-bold hover:opacity-90 disabled:opacity-40">
                            {guardando ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Guardar en la cámara</button>
                    </div>
                </div>

                {/* Medición */}
                <div className="rounded-xl border border-border bg-card p-4 space-y-3">
                    <div className="flex items-center gap-2">
                        <Activity size={14} className="text-primary" />
                        <span className="text-sm font-bold">Medición del rebote</span>
                        <Ayuda texto="Se calcula con los eventos reales que mandó la cámara. Los parpadeos son cambios del aforo que vuelven al valor anterior en pocos segundos; los rebotes de borde son entradas seguidas de una salida enseguida." />
                        <select value={ventanaMedicion} onChange={(e) => setVentanaMedicion(Number(e.target.value))} className="ml-auto rounded-md border border-border bg-background px-1.5 py-1 text-xs">
                            <option value={60}>1 h</option><option value={240}>4 h</option><option value={1440}>24 h</option><option value={10080}>7 días</option>
                        </select>
                    </div>
                    {!rebote ? <div className="text-xs text-muted-foreground flex items-center gap-2"><Loader2 size={12} className="animate-spin" /> Midiendo…</div> : (
                        <>
                            <div className="grid grid-cols-3 gap-2 text-center">
                                <div className="rounded-lg bg-muted/50 p-2"><div className="text-lg font-bold tabular-nums">{rebote.aforo.porcentajeParpadeo}%</div><div className="text-[10px] text-muted-foreground">parpadeo del aforo</div></div>
                                <div className="rounded-lg bg-muted/50 p-2"><div className="text-lg font-bold tabular-nums">{rebote.borde.porcentaje}%</div><div className="text-[10px] text-muted-foreground">rebote en el borde</div></div>
                                <div className="rounded-lg bg-muted/50 p-2"><div className="text-lg font-bold tabular-nums">{rebote.repetidasMenos10s}</div><div className="text-[10px] text-muted-foreground">entradas &lt;10 s</div></div>
                            </div>
                            <div><div className="text-[11px] text-muted-foreground mb-1">Duración de los parpadeos del aforo</div><Histo datos={rebote.aforo.histograma} color="aviso" /></div>
                            <div><div className="text-[11px] text-muted-foreground mb-1">Tiempo entre entrada y salida</div><Histo datos={rebote.borde.histograma} color="info" /></div>
                            <div className="text-[11px] text-muted-foreground">Basado en {rebote.muestras.aforo} lecturas de aforo, {rebote.muestras.entradas} entradas y {rebote.muestras.salidas} salidas.</div>
                            {(sug?.debounce != null || sug?.ventana != null) && (
                                <button onClick={() => { if (sug?.debounce != null) setDebounce(sug.debounce); if (sug?.ventana != null) setVentana(sug.ventana); }}
                                    className="w-full flex items-center justify-center gap-1.5 rounded-lg border border-primary/40 text-primary px-3 py-2 text-xs font-semibold hover:bg-primary/10">
                                    <Wand2 size={13} /> Usar valores sugeridos{sug?.debounce != null ? ` (rebote ${sug.debounce} s` : " ("}{sug?.ventana != null ? `${sug?.debounce != null ? ", " : ""}ventana ${sug.ventana} s)` : ")"}</button>
                            )}
                        </>
                    )}
                </div>

                {/* Backups */}
                <div className="rounded-xl border border-border bg-card p-4 space-y-2">
                    <div className="flex items-center gap-2"><History size={14} className="text-primary" /><span className="text-sm font-bold">Backups de la cámara</span>
                        <Ayuda texto="Antes de cada cambio se guarda la configuración que tenía la cámara. Restaurar la vuelve exactamente a ese estado." /></div>
                    {!estado?.backups.length ? <div className="text-xs text-muted-foreground">Todavía no hay cambios hechos desde OmniAccess.</div> : (
                        <div className="divide-y divide-border">
                            {estado.backups.map((b) => (
                                <div key={b.at} className="flex items-center gap-2 py-2 text-xs">
                                    <CheckCircle2 size={13} className="text-muted-foreground" />
                                    <div className="min-w-0"><div className="font-medium">{fmtFecha(b.at)} · {b.by}</div><div className="text-muted-foreground truncate">{b.motivo}</div></div>
                                    <button onClick={() => setConfirmar({ tipo: "restaurar", at: b.at })} disabled={guardando} className="ml-auto rounded-md border border-border px-2 py-1 hover:bg-muted">Restaurar</button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* Confirmación */}
            {/* Un diálogo de verdad (ui/dialog) y no un fixed inset-0 a mano: Escape lo cierra,
                atrapa el foco y no queda debajo de otra capa con su z-index inventado. */}
            <Dialog open={!!confirmar} onOpenChange={(v) => { if (!v) setConfirmar(null); }}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2"><AlertTriangle size={18} className="tono-aviso" />{confirmar?.tipo === "restaurar" ? "Restaurar backup" : "Guardar en la cámara"}</DialogTitle>
                        <DialogDescription>
                            {confirmar?.tipo === "restaurar"
                                ? `La cámara vuelve a la configuración del ${fmtFecha(confirmar.at)} y reinicia sus contadores.`
                                : "La cámara aplica la configuración nueva al instante y reinicia sus contadores. Antes de escribir se guarda un backup de lo que tiene ahora; si la cámara no la acepta, se restaura sola."}
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <button onClick={() => setConfirmar(null)} className="rounded-lg border border-border px-3 py-2 text-xs font-semibold hover:bg-muted">Cancelar</button>
                        <button onClick={() => { if (confirmar) (confirmar.tipo === "guardar" ? guardar() : restaurar(confirmar.at)); }} className="rounded-lg bg-primary text-primary-foreground px-3 py-2 text-xs font-bold">Confirmar</button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
