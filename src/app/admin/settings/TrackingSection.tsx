"use client";

/**
 * Panel del seguimiento — Ajustes › Avanzado.
 *
 * Criterio de lo que se muestra: solo lo que cambia una decisión. El pid de un ffmpeg,
 * la URL RTSP con la clave tapada o cuántas veces se reinició la pasarela no le dicen
 * nada a quien tiene que decidir si esto anda bien, así que no están. Lo que sí está es
 * la serie: si la GPU viene trabajando, si el lector viene leyendo, y de cada disparo
 * cuántos terminaron en una matrícula.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { sileo as toast } from "sileo";
import {
    ScanLine, Video, Plus, RefreshCw, Play, Square, Camera as CamIcon,
    Loader2, Terminal, CheckCircle2, XCircle, BookOpen, Cpu, Zap,
    MemoryStick, Thermometer, AlertTriangle, SlidersHorizontal,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { fechaCorta, fechaHora } from "@/lib/fechas";

type Camara = { id: string; name: string; rtsp: string; rtspVisible?: string; activa?: boolean; enMapa?: boolean; lat?: number | null; lng?: number | null };

const RANGOS = [
    { horas: 6, etiqueta: "6 h" },
    { horas: 24, etiqueta: "24 h" },
    { horas: 168, etiqueta: "7 días" },
];

/* ─────────────────────────── piezas ─────────────────────────── */

function Pastilla({ tono, texto }: { tono: "ok" | "mal" | "tibio" | "gris"; texto: string }) {
    return (
        <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold",
            tono === "ok" && "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
            tono === "mal" && "bg-red-500/10 text-red-600 dark:text-red-400",
            tono === "tibio" && "bg-amber-500/10 text-amber-600 dark:text-amber-400",
            tono === "gris" && "bg-muted text-muted-foreground")}>
            <span className={cn("h-1.5 w-1.5 rounded-full",
                tono === "ok" && "bg-emerald-500 animate-pulse",
                tono === "mal" && "bg-red-500",
                tono === "tibio" && "bg-amber-500",
                tono === "gris" && "bg-muted-foreground/50")} />
            {texto}
        </span>
    );
}

/** Dato suelto: rótulo chico arriba, número grande abajo. Sin caja ni borde. */
function Dato({ rotulo, valor, pie, tono }: { rotulo: string; valor: string; pie?: string; tono?: string }) {
    return (
        <div className="min-w-0">
            <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{rotulo}</div>
            <div className={cn("text-xl font-bold tabular-nums mt-0.5 truncate", tono || "text-foreground")}>{valor}</div>
            {pie && <div className="text-[11px] text-muted-foreground truncate">{pie}</div>}
        </div>
    );
}

/** Línea de tendencia. El área rellena ayuda a leer el nivel de un vistazo. */
function Linea({ datos, color, max }: { datos: (number | null)[]; color: string; max?: number }) {
    const vals = datos.map((v) => (v == null ? 0 : v));
    if (vals.length < 2) return <div className="h-10 rounded bg-muted/30" />;
    const tope = Math.max(max ?? 0, ...vals, 1);
    const an = 100, al = 30;
    const px = (i: number) => (i / (vals.length - 1)) * an;
    const py = (v: number) => al - (v / tope) * (al - 2) - 1;
    const linea = vals.map((v, i) => `${i ? "L" : "M"}${px(i).toFixed(2)},${py(v).toFixed(2)}`).join(" ");
    const area = `${linea} L${an},${al} L0,${al} Z`;
    return (
        <svg viewBox={`0 0 ${an} ${al}`} preserveAspectRatio="none" className="h-10 w-full" aria-hidden>
            <path d={area} fill={color} opacity={0.14} />
            <path d={linea} fill="none" stroke={color} strokeWidth={1.2} vectorEffect="non-scaling-stroke" />
        </svg>
    );
}

/** Barras por hora. Cada barra es una hora; el pie dice cuál es cuál. */
function Barras({ datos }: { datos: { hora: string; lecturas: number }[] }) {
    const tope = Math.max(1, ...datos.map((d) => d.lecturas));
    return (
        <div>
            <div className="flex items-end gap-[2px] h-20">
                {datos.map((d) => {
                    const h = (d.lecturas / tope) * 100;
                    return (
                        <div key={d.hora} className="flex-1 min-w-0 flex items-end h-full group relative">
                            <div
                                className={cn("w-full rounded-sm transition-colors", d.lecturas ? "bg-violet-500/70 group-hover:bg-violet-400" : "bg-muted/50")}
                                style={{ height: `${Math.max(d.lecturas ? 6 : 2, h)}%` }}
                            />
                            <div className="pointer-events-none absolute bottom-full mb-1 left-1/2 -translate-x-1/2 hidden group-hover:block z-10 whitespace-nowrap rounded bg-popover border border-border px-2 py-1 text-[10px] text-popover-foreground shadow">
                                {fechaHora(new Date(d.hora))} · {d.lecturas}
                            </div>
                        </div>
                    );
                })}
            </div>
            <div className="flex justify-between text-[10px] text-muted-foreground mt-1.5">
                <span>{datos[0] ? fechaHora(new Date(datos[0].hora)) : ""}</span>
                <span>ahora</span>
            </div>
        </div>
    );
}

function haceCuanto(iso: string | null) {
    if (!iso) return "nunca";
    const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 60) return `hace ${s} s`;
    if (s < 3600) return `hace ${Math.round(s / 60)} min`;
    if (s < 86400) return `hace ${Math.round(s / 3600)} h`;
    return fechaCorta(new Date(iso));
}

/* ─────────────────────────── panel ─────────────────────────── */

export default function TrackingSection() {
    const [estado, setEstado] = useState<any>(null);
    const [camaras, setCamaras] = useState<Camara[]>([]);
    const [serie, setSerie] = useState<any>(null);
    const [horas, setHoras] = useState(24);
    const [cargando, setCargando] = useState(true);
    const [operando, setOperando] = useState<string | null>(null);
    const [probando, setProbando] = useState(false);
    const [probada, setProbada] = useState<string | null>(null);
    const [prueba, setPrueba] = useState<any>(null);
    const [metricas, setMetricas] = useState<any>(null);
    const [logs, setLogs] = useState<{ lpr: string; worker: string } | null>(null);
    const [verLogs, setVerLogs] = useState(false);

    const cargar = useCallback(async () => {
        try {
            const [s, c] = await Promise.all([axios.get("/api/tracking/service"), axios.get("/api/tracking/cameras")]);
            setEstado(s.data);
            setCamaras(c.data.camaras || []);
        } catch {
            toast.error({ title: "No se pudo leer el estado de Omni-LPR" });
        } finally { setCargando(false); }
    }, []);

    useEffect(() => { cargar(); const t = setInterval(cargar, 20000); return () => clearInterval(t); }, [cargar]);

    useEffect(() => {
        let vivo = true;
        const leer = async () => { try { const r = await axios.get(`/api/tracking/series?horas=${horas}`); if (vivo) setSerie(r.data); } catch { } };
        leer();
        const t = setInterval(leer, 60000);
        return () => { vivo = false; clearInterval(t); };
    }, [horas]);

    useEffect(() => {
        let vivo = true;
        const leer = async () => { try { const r = await axios.get("/api/tracking/metrics"); if (vivo) setMetricas(r.data); } catch { } };
        leer();
        const t = setInterval(leer, 8000);
        return () => { vivo = false; clearInterval(t); };
    }, []);

    const operar = async (accion: string, etiqueta: string) => {
        setOperando(accion);
        try {
            await axios.post("/api/tracking/service", { accion });
            toast.success({ title: `${etiqueta} listo` });
            setTimeout(cargar, 2500);
        } catch (e: any) {
            toast.error({ title: e?.response?.data?.error || `No se pudo ${etiqueta.toLowerCase()}` });
        } finally { setOperando(null); }
    };

    const probar = async (rtsp: string, id?: string) => {
        if (!rtsp.trim()) return toast.error({ title: "Esa cámara no tiene URL RTSP cargada" });
        setProbando(true); setPrueba(null); setProbada(id || null);
        try {
            const r = await axios.post("/api/tracking/probe", { rtsp });
            setPrueba(r.data);
            const mejor = r.data.lecturas?.[0];
            if (mejor) toast.success({ title: `Leyó ${mejor.plate}`, description: `Confianza ${(mejor.confidence * 100).toFixed(0)}%` });
            else toast.info?.({ title: "Cuadro capturado, sin matrícula visible" });
        } catch (e: any) {
            toast.error({ title: e?.response?.data?.error || "No se pudo probar la cámara" });
        } finally { setProbando(false); }
    };

    const abrirLogs = async () => { setVerLogs(true); try { const r = await axios.get("/api/tracking/logs"); setLogs(r.data); } catch { } };

    const contVivo = estado?.contenedor?.estado === "running";
    const lprVivo = estado?.salud?.status === "ok";
    const workerVivo = estado?.worker?.estado === "online";
    const enGpu = metricas?.enGpu ?? serie?.resumen?.enGpu;
    const m = serie?.muestras || [];

    /** Un solo veredicto arriba, para no obligar a leer cuatro tarjetas. */
    const veredicto = useMemo(() => {
        if (!estado) return { tono: "gris" as const, texto: "consultando" };
        if (!contVivo || !lprVivo) return { tono: "mal" as const, texto: "el lector no responde" };
        if (!workerVivo) return { tono: "mal" as const, texto: "la pasarela está caída" };
        if (!estado.camaras) return { tono: "tibio" as const, texto: "sin cámaras interiores" };
        if (enGpu === false) return { tono: "tibio" as const, texto: "trabajando en CPU" };
        return { tono: "ok" as const, texto: "en marcha" };
    }, [estado, contVivo, lprVivo, workerVivo, enGpu]);

    const camarasPorId = useMemo(() => {
        const x: Record<string, any> = {};
        for (const c of serie?.porCamara || []) x[c.id] = c;
        return x;
    }, [serie]);

    if (cargando) {
        return <div className="flex items-center gap-3 p-10 text-muted-foreground"><Loader2 className="animate-spin" size={18} /> Consultando el servicio…</div>;
    }

    const r = serie?.resumen;

    return (
        <div className="space-y-5 animate-in fade-in duration-500">
            {/* ── Encabezado con las acciones a mano ── */}
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                    <div className="p-2 bg-teal-500/10 rounded-xl border border-teal-500/20 shrink-0"><ScanLine className="text-teal-500" size={22} /></div>
                    <div>
                        <div className="flex items-center gap-2 flex-wrap">
                            <h2 className="text-xl font-bold text-foreground tracking-tight">Omni-LPR · Seguimiento</h2>
                            <Pastilla tono={veredicto.tono} texto={veredicto.texto} />
                        </div>
                        <p className="text-sm text-muted-foreground mt-0.5">Lector de matrículas en contenedor, leyendo cámaras comunes por RTSP</p>
                    </div>
                </div>
                <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" disabled={!!operando} onClick={() => operar("reiniciar-lpr", "Reiniciar lector")}>
                        {operando === "reiniciar-lpr" ? <Loader2 className="animate-spin" size={14} /> : <RefreshCw size={14} />}<span className="ml-1.5">Lector</span>
                    </Button>
                    <Button size="sm" variant="outline" disabled={!!operando} onClick={() => operar("reiniciar-worker", "Reiniciar pasarela")}>
                        {operando === "reiniciar-worker" ? <Loader2 className="animate-spin" size={14} /> : <RefreshCw size={14} />}<span className="ml-1.5">Pasarela</span>
                    </Button>
                    {contVivo ? (
                        <Button size="sm" variant="ghost" disabled={!!operando} onClick={() => operar("detener-lpr", "Detener lector")}><Square size={14} /></Button>
                    ) : (
                        <Button size="sm" variant="ghost" disabled={!!operando} onClick={() => operar("iniciar-lpr", "Iniciar lector")}><Play size={14} /></Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={abrirLogs}><Terminal size={14} /><span className="ml-1.5">Logs</span></Button>
                </div>
            </div>

            {/* ── Los cuatro datos que contestan "¿anda?" ── */}
            <div className="rounded-2xl border border-border bg-card px-5 py-4 grid grid-cols-2 lg:grid-cols-4 gap-5">
                <Dato rotulo="Lector"
                    valor={enGpu === true ? "GPU" : enGpu === false ? "CPU" : "—"}
                    tono={enGpu === false ? "text-amber-500" : undefined}
                    pie={lprVivo ? `v${estado?.salud?.version} · responde en ${estado?.salud?.latencia} ms` : "la API no responde"} />
                <Dato rotulo="Pasarela"
                    valor={`${estado?.camaras || 0} cámara${estado?.camaras === 1 ? "" : "s"}`}
                    pie={workerVivo ? (serie?.porCamara?.some((c: any) => c.modo === "camara") ? "disparo por aviso de la cámara" : "disparo por cambio de escena") : "detenida"} />
                <Dato rotulo={`Lecturas · ${horas >= 168 ? "7 días" : horas + " h"}`}
                    valor={String(r?.avistamientos ?? 0)}
                    pie={r?.confianzaMediana != null ? `confianza mediana ${r.confianzaMediana}%` : "sin lecturas todavía"} />
                <Dato rotulo="Efectividad"
                    valor={r?.efectividad != null ? `${r.efectividad}%` : "—"}
                    tono={r?.efectividad != null && r.efectividad < 30 ? "text-amber-500" : undefined}
                    pie={r?.disparos ? `${r.lecturas} de ${r.disparos} disparos` : "sin disparos en el período"} />
            </div>

            {/* ── Rendimiento con historia ── */}
            <div className="rounded-2xl border border-border bg-card p-5 space-y-4">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                    <span className="text-sm font-semibold text-foreground">Rendimiento</span>
                    <div className="flex items-center gap-1 bg-muted/40 rounded-md p-1 border border-border/30">
                        {RANGOS.map((x) => (
                            <button key={x.horas} onClick={() => setHoras(x.horas)}
                                className={cn("px-2.5 py-1 rounded text-[11px] font-semibold transition-all",
                                    horas === x.horas ? "bg-teal-600 text-white" : "text-muted-foreground hover:text-foreground")}>
                                {x.etiqueta}
                            </button>
                        ))}
                    </div>
                </div>

                {m.length < 2 ? (
                    <p className="text-xs text-muted-foreground py-6 text-center">
                        Todavía no hay historia. La pasarela guarda una muestra por minuto; en un rato esto se llena.
                    </p>
                ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                        {[
                            { ic: Zap, t: "GPU", col: "#10b981", k: "gpuUso", v: metricas?.gpu ? `${metricas.gpu.uso}%` : "—", pie: r?.gpuPico != null ? `pico ${r.gpuPico}% · promedio ${r.gpuProm}%` : "", max: 100 },
                            { ic: Cpu, t: "CPU del lector", col: "#0ea5e9", k: "cpuCont", v: metricas?.contenedor ? `${metricas.contenedor.cpu.toFixed(0)}%` : "—", pie: "del total de la máquina", max: 100 },
                            { ic: MemoryStick, t: "Memoria del lector", col: "#8b5cf6", k: "memCont", v: metricas?.contenedor ? `${(metricas.contenedor.memUsada / 1e9).toFixed(1)} GB` : "—", pie: "residente", max: undefined },
                            { ic: Thermometer, t: "Temperatura", col: "#f59e0b", k: "gpuTemp", v: metricas?.gpu ? `${metricas.gpu.temperatura} °C` : "—", pie: metricas?.gpu ? `${metricas.gpu.potencia?.toFixed(0)} de ${metricas.gpu.potenciaMax?.toFixed(0)} W` : "", max: 90 },
                        ].map((x) => (
                            <div key={x.k}>
                                <div className="flex items-center justify-between">
                                    <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5"><x.ic size={11} /> {x.t}</span>
                                    <span className="text-sm font-bold text-foreground tabular-nums">{x.v}</span>
                                </div>
                                <div className="mt-1.5"><Linea datos={m.map((d: any) => d[x.k])} color={x.col} max={x.max} /></div>
                                {x.pie && <div className="text-[10px] text-muted-foreground mt-0.5">{x.pie}</div>}
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* ── Lecturas en el tiempo ── */}
            {!!serie?.porHora?.length && (
                <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                        <span className="text-sm font-semibold text-foreground">Lecturas por hora</span>
                        <span className="text-[11px] text-muted-foreground">
                            {r?.lecturas ?? 0} aceptadas · {r?.descartes ?? 0} descartadas por no coincidir entre cuadros
                        </span>
                    </div>
                    <Barras datos={serie.porHora} />
                    {r?.efectividad != null && r.efectividad < 30 && r.disparos > 10 && (
                        <div className="flex items-start gap-2 text-[11px] text-amber-600 dark:text-amber-400 rounded-lg bg-amber-500/10 border border-amber-500/20 px-3 py-2">
                            <AlertTriangle size={13} className="mt-px shrink-0" />
                            <span>
                                Se dispara mucho y se lee poco. Suele ser la zona de interés demasiado abierta, o una cámara
                                que mira donde las matrículas quedan de costado. El calibrador de cada cámara lo muestra sobre un cuadro real.
                            </span>
                        </div>
                    )}
                </div>
            )}

            {verLogs && (
                <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
                    <div className="flex items-center justify-between">
                        <span className="text-sm font-semibold text-foreground">Últimas líneas</span>
                        <Button size="sm" variant="ghost" onClick={() => setVerLogs(false)}>Cerrar</Button>
                    </div>
                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                        {[["Contenedor", logs?.lpr], ["Pasarela", logs?.worker]].map(([t, v]) => (
                            <div key={t as string}>
                                <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">{t}</div>
                                <pre className="text-[10px] leading-relaxed bg-background/60 border border-border rounded-xl p-3 h-56 overflow-auto whitespace-pre-wrap font-mono text-muted-foreground">{(v as string) || "…"}</pre>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* ── Cámaras ── */}
            <div className="rounded-2xl border border-border bg-card overflow-hidden">
                <div className="px-5 py-3 border-b border-border flex items-center justify-between gap-3 flex-wrap">
                    <div>
                        <span className="text-sm font-semibold text-foreground">Cámaras interiores</span>
                        <p className="text-[11px] text-muted-foreground mt-0.5">
                            No abren barrera: solo alimentan el recorrido. Se dan de alta en Dispositivos LPR con el tipo <b className="text-foreground/80">Cámara Interior</b>.
                        </p>
                    </div>
                    <div className="flex gap-2">
                        <a href="/admin/manuales?m=seguimiento"><Button size="sm" variant="ghost"><BookOpen size={14} /><span className="ml-1.5">Manual</span></Button></a>
                        <a href="/admin/devices"><Button size="sm"><Plus size={15} /><span className="ml-1.5">Agregar</span></Button></a>
                    </div>
                </div>

                {camaras.length === 0 ? (
                    <div className="p-8 text-center text-sm text-muted-foreground">
                        Todavía no hay ninguna. El seguimiento no hace nada hasta que se dé de alta la primera.
                    </div>
                ) : (
                    <div className="divide-y divide-border">
                        {camaras.map((c) => {
                            const d = camarasPorId[c.id];
                            return (
                                <div key={c.id} className="px-5 py-3 flex flex-col lg:flex-row lg:items-center gap-3">
                                    <div className="lg:w-64 min-w-0">
                                        <div className="flex items-center gap-2">
                                            <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", c.activa ? "bg-emerald-500" : "bg-muted-foreground/40")} />
                                            <span className="font-semibold text-sm text-foreground truncate">{c.name}</span>
                                        </div>
                                        <div className="text-[11px] text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-2">
                                            <span>{d?.modo === "camara" ? "avisa la cámara" : "cambio de escena"}</span>
                                            <span>·</span>
                                            <span className={d?.conZona ? "" : "text-amber-500"}>{d?.conZona ? "con zona" : "sin zona de interés"}</span>
                                            {!c.enMapa && <><span>·</span><span className="text-amber-500">sin ubicar</span></>}
                                        </div>
                                    </div>

                                    <div className="flex-1 grid grid-cols-3 gap-3 text-[11px]">
                                        <div><div className="text-muted-foreground">Lecturas</div><div className="text-foreground font-semibold tabular-nums">{d?.lecturas ?? 0}</div></div>
                                        <div><div className="text-muted-foreground">Confianza</div><div className="text-foreground font-semibold tabular-nums">{d?.confianzaProm != null ? `${d.confianzaProm}%` : "—"}</div></div>
                                        <div><div className="text-muted-foreground">Última</div><div className="text-foreground font-semibold">{haceCuanto(d?.ultima ?? null)}</div></div>
                                    </div>

                                    <div className="flex items-center gap-2 shrink-0">
                                        <Button size="sm" variant="outline" disabled={probando || !c.rtsp} onClick={() => probar(c.rtsp, c.id)}>
                                            {probando && probada === c.id ? <Loader2 className="animate-spin" size={14} /> : <CamIcon size={14} />}
                                            <span className="ml-1.5">Probar</span>
                                        </Button>
                                        <a href="/admin/devices"><Button size="sm" variant="ghost"><SlidersHorizontal size={14} /><span className="ml-1.5">Calibrar</span></Button></a>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}

                {prueba && (
                    <div className="border-t border-border p-4 grid grid-cols-1 md:grid-cols-[280px_1fr] gap-4">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={prueba.imagen} alt="Cuadro de prueba" className="rounded-lg w-full object-cover border border-border" />
                        <div className="space-y-2 text-sm">
                            <div className="text-xs text-muted-foreground">
                                Cuadro de {Math.round(prueba.bytes / 1024)} KB · captura {prueba.msCaptura} ms · lectura {prueba.msLectura} ms
                            </div>
                            {prueba.errorLpr && <div className="text-red-500 text-xs">{prueba.errorLpr}</div>}
                            {prueba.lecturas?.length ? prueba.lecturas.map((l: any, i: number) => {
                                const pasa = l.confidence >= prueba.umbral;
                                return (
                                    <div key={i} className="flex items-center gap-3">
                                        {pasa ? <CheckCircle2 className="text-emerald-500" size={16} /> : <XCircle className="text-amber-500" size={16} />}
                                        <span className="font-mono font-bold tracking-widest text-foreground">{l.plate}</span>
                                        <span className="text-xs text-muted-foreground">{(l.confidence * 100).toFixed(0)}%</span>
                                        <span className={cn("text-[11px]", pasa ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400")}>
                                            {pasa ? "se registraría" : `por debajo del ${Math.round(prueba.umbral * 100)}%`}
                                        </span>
                                    </div>
                                );
                            }) : !prueba.errorLpr && (
                                <div className="text-muted-foreground text-xs">
                                    No se vio ninguna matrícula en ese cuadro. Es normal si no pasaba ningún auto.
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>

            {/* ── Últimos avistamientos ── */}
            {!!estado?.ultimas?.length && (
                <div className="rounded-2xl border border-border bg-card overflow-hidden">
                    <div className="px-5 py-3 border-b border-border flex items-center justify-between">
                        <span className="text-sm font-semibold text-foreground">Últimos avistamientos</span>
                        <a href="/admin/history" className="text-[11px] text-muted-foreground hover:text-foreground underline underline-offset-2">ver el historial completo</a>
                    </div>
                    <div className="divide-y divide-border">
                        {estado.ultimas.slice(0, 8).map((u: any, i: number) => (
                            <div key={i} className="px-5 py-2.5 flex items-center gap-4 text-sm">
                                <span className="font-mono font-bold tracking-widest text-foreground w-28">{u.plate}</span>
                                <span className="text-muted-foreground flex-1 truncate">{u.cameraName || "—"}</span>
                                <span className="text-xs text-muted-foreground">{u.confidence != null ? `${Math.round(u.confidence * 100)}%` : ""}</span>
                                <span className="text-xs text-muted-foreground tabular-nums">{haceCuanto(u.timestamp)}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
