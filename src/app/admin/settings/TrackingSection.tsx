"use client";

import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { sileo as toast } from "sileo";
import {
    ScanLine, Video, Plus, RefreshCw, Play, Square, Camera as CamIcon,
    MapPin, Gauge, Loader2, Terminal, Route, CheckCircle2, XCircle, Info
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Camara = {
    id: string;
    name: string;
    ip?: string;
    location?: string | null;
    rtsp: string;
    rtspVisible?: string;
    escena?: number;
    activa?: boolean;
    enMapa?: boolean;
    lat?: number | null;
    lng?: number | null;
};

function Pastilla({ ok, texto }: { ok: boolean | null; texto: string }) {
    return (
        <span className={cn(
            "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold",
            ok === true && "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
            ok === false && "bg-red-500/10 text-red-600 dark:text-red-400",
            ok === null && "bg-muted text-muted-foreground"
        )}>
            <span className={cn("h-1.5 w-1.5 rounded-full",
                ok === true && "bg-emerald-500 animate-pulse",
                ok === false && "bg-red-500",
                ok === null && "bg-muted-foreground/50")} />
            {texto}
        </span>
    );
}

export default function TrackingSection() {
    const [estado, setEstado] = useState<any>(null);
    const [camaras, setCamaras] = useState<Camara[]>([]);
    const [parametros, setParametros] = useState<any>(null);
    const [cargando, setCargando] = useState(true);
    const [operando, setOperando] = useState<string | null>(null);
    const [probando, setProbando] = useState(false);
    const [probada, setProbada] = useState<string | null>(null);
    const [prueba, setPrueba] = useState<any>(null);
    const [logs, setLogs] = useState<{ lpr: string; worker: string } | null>(null);
    const [verLogs, setVerLogs] = useState(false);

    const cargar = useCallback(async () => {
        try {
            const [s, c] = await Promise.all([
                axios.get("/api/tracking/service"),
                axios.get("/api/tracking/cameras"),
            ]);
            setEstado(s.data);
            setCamaras(c.data.camaras || []);
            setParametros(c.data.parametros || null);
        } catch {
            toast.error({ title: "No se pudo leer el estado de Omni-LPR" });
        } finally {
            setCargando(false);
        }
    }, []);

    useEffect(() => {
        cargar();
        const t = setInterval(cargar, 15000);
        return () => clearInterval(t);
    }, [cargar]);

    const operar = async (accion: string, etiqueta: string) => {
        setOperando(accion);
        try {
            await axios.post("/api/tracking/service", { accion });
            toast.success({ title: `${etiqueta} listo` });
            setTimeout(cargar, 2500);
        } catch (e: any) {
            toast.error({ title: e?.response?.data?.error || `No se pudo ${etiqueta.toLowerCase()}` });
        } finally {
            setOperando(null);
        }
    };

    const probar = async (rtsp: string, id?: string) => {
        if (!rtsp.trim()) return toast.error({ title: "Esa cámara no tiene URL RTSP cargada" });
        setProbando(true);
        setPrueba(null);
        setProbada(id || null);
        try {
            const r = await axios.post("/api/tracking/probe", { rtsp });
            setPrueba(r.data);
            const mejor = r.data.lecturas?.[0];
            if (mejor) toast.success({ title: `Leyó ${mejor.plate}`, description: `Confianza ${(mejor.confidence * 100).toFixed(0)}%` });
            else toast.info?.({ title: "Cuadro capturado, sin matrícula visible" });
        } catch (e: any) {
            toast.error({ title: e?.response?.data?.error || "No se pudo probar la cámara" });
        } finally {
            setProbando(false);
        }
    };

    const abrirLogs = async () => {
        setVerLogs(true);
        try { const r = await axios.get("/api/tracking/logs"); setLogs(r.data); } catch { }
    };

    const lprVivo = estado?.salud?.status === "ok";
    const contVivo = estado?.contenedor?.estado === "running";
    const workerVivo = estado?.worker?.estado === "online";

    if (cargando) {
        return <div className="flex items-center gap-3 p-10 text-muted-foreground"><Loader2 className="animate-spin" size={18} /> Consultando el servicio…</div>;
    }

    return (
        <div className="space-y-6 animate-in fade-in duration-500">
            {/* Encabezado */}
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-2xl font-bold text-foreground tracking-tight">Omni-LPR · Seguimiento</h2>
                    <p className="text-sm text-muted-foreground mt-1">
                        Lector de matrículas en contenedor y pasarela de cámaras comunes
                    </p>
                </div>
                <div className="p-2 bg-teal-500/10 rounded-xl border border-teal-500/20">
                    <ScanLine className="text-teal-500" size={24} />
                </div>
            </div>

            {/* Estado del servicio */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Contenedor</span>
                        <Pastilla ok={contVivo ? true : estado?.contenedor ? false : null} texto={estado?.contenedor?.estado || "sin datos"} />
                    </div>
                    <div className="font-mono text-sm text-foreground">{estado?.lprUrl}</div>
                    <div className="text-xs text-muted-foreground">
                        {lprVivo ? <>API v{estado?.salud?.version} · {estado?.salud?.latencia} ms</> : "La API no responde"}
                    </div>
                    <div className="flex flex-wrap gap-2 pt-1">
                        <Button size="sm" variant="outline" disabled={!!operando} onClick={() => operar("reiniciar-lpr", "Reiniciar lector")}>
                            {operando === "reiniciar-lpr" ? <Loader2 className="animate-spin" size={14} /> : <RefreshCw size={14} />}
                            <span className="ml-1.5">Reiniciar</span>
                        </Button>
                        {contVivo ? (
                            <Button size="sm" variant="outline" disabled={!!operando} onClick={() => operar("detener-lpr", "Detener lector")}>
                                <Square size={14} /><span className="ml-1.5">Detener</span>
                            </Button>
                        ) : (
                            <Button size="sm" variant="outline" disabled={!!operando} onClick={() => operar("iniciar-lpr", "Iniciar lector")}>
                                <Play size={14} /><span className="ml-1.5">Iniciar</span>
                            </Button>
                        )}
                    </div>
                </div>

                <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Pasarela</span>
                        <Pastilla ok={workerVivo ? true : estado?.worker ? false : null} texto={estado?.worker?.estado || "sin datos"} />
                    </div>
                    <div className="text-sm text-foreground">{estado?.camaras || 0} cámara(s) activa(s)</div>
                    <div className="text-xs text-muted-foreground">
                        {estado?.worker ? <>{estado.worker.reinicios} reinicios · {Math.round((estado.worker.memoria || 0) / 1048576)} MB</> : "tracking-worker no encontrado"}
                    </div>
                    <div className="flex flex-wrap gap-2 pt-1">
                        <Button size="sm" variant="outline" disabled={!!operando} onClick={() => operar("reiniciar-worker", "Reiniciar pasarela")}>
                            {operando === "reiniciar-worker" ? <Loader2 className="animate-spin" size={14} /> : <RefreshCw size={14} />}
                            <span className="ml-1.5">Reiniciar</span>
                        </Button>
                        <Button size="sm" variant="ghost" onClick={abrirLogs}><Terminal size={14} /><span className="ml-1.5">Logs</span></Button>
                    </div>
                </div>

                <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Lecturas</span>
                        <Route className="text-violet-500" size={16} />
                    </div>
                    <div className="text-3xl font-bold text-foreground tabular-nums">{estado?.lecturas24 ?? 0}</div>
                    <div className="text-xs text-muted-foreground">avistamientos en las últimas 24 h</div>
                    <div className="text-xs text-muted-foreground pt-1">
                        Confianza mínima {Math.round((parametros?.minConfidence ?? 0.6) * 100)}% · antirrebote {parametros?.dedupeSeconds ?? 45}s
                    </div>
                </div>
            </div>

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

            {/* Cómo se agrega una cámara interior */}
            <div className="rounded-2xl border border-border bg-card p-5 space-y-4">
                <div className="flex items-start gap-3">
                    <div className="p-2 rounded-xl bg-blue-500/10 border border-blue-500/20"><Video className="text-blue-500" size={18} /></div>
                    <div className="flex-1">
                        <h3 className="font-semibold text-foreground">Cámaras interiores</h3>
                        <p className="text-sm text-muted-foreground mt-0.5">
                            Se dan de alta en <b className="text-foreground">Dispositivos LPR</b>, con el tipo
                            <b className="text-foreground"> Cámara Interior (seguimiento)</b>. Son las que el contenedor Omni-LPR
                            procesa por RTSP; las de entrada y salida siguen siendo del tipo Cámara LPR y leen la matrícula ellas mismas.
                        </p>
                    </div>
                    <a href="/admin/devices" className="shrink-0">
                        <Button size="sm"><Plus size={15} /><span className="ml-1.5">Agregar cámara</span></Button>
                    </a>
                </div>

                <div className="rounded-xl bg-muted/40 border border-border p-3 text-xs text-muted-foreground space-y-1">
                    <div className="flex items-center gap-1.5 font-semibold text-foreground"><Info size={13} /> Los tres pasos</div>
                    <div><b className="text-foreground/80">1.</b> En Dispositivos LPR, nueva cámara → tipo <b>Cámara Interior</b> → pegá la URL RTSP del canal.</div>
                    <div className="font-mono pl-4">Hikvision / NVR · rtsp://usuario:clave@IP:554/Streaming/Channels/<b>101</b></div>
                    <div className="font-mono pl-4">Dahua · rtsp://usuario:clave@IP:554/cam/realmonitor?channel=<b>1</b>&amp;subtype=0</div>
                    <div className="pl-4">101 = canal 1 flujo principal, 201 = canal 2. Un dispositivo por canal, y siempre el flujo principal.</div>
                    <div><b className="text-foreground/80">2.</b> Probala desde acá: toma un cuadro real y te dice si el lector ve la matrícula.</div>
                    <div><b className="text-foreground/80">3.</b> Arrastrala en <b className="text-foreground">Mapa</b> hasta donde está instalada, para que el recorrido se dibuje bien.</div>
                </div>

                {prueba && (
                    <div className="grid grid-cols-1 md:grid-cols-[280px_1fr] gap-4 rounded-xl border border-border bg-background/50 p-3">
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
                                    No se vio ninguna matrícula en ese cuadro. Es normal si no pasaba ningún auto:
                                    probá de nuevo con un vehículo en el encuadre, o apuntá la cámara más baja.
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>

            {/* Listado */}
            <div className="rounded-2xl border border-border bg-card overflow-hidden">
                <div className="px-5 py-3 border-b border-border flex items-center justify-between">
                    <span className="text-sm font-semibold text-foreground">Cámaras interiores dadas de alta ({camaras.length})</span>
                </div>
                {camaras.length === 0 ? (
                    <div className="p-8 text-center text-sm text-muted-foreground">
                        Todavía no hay ninguna. Agregala en Dispositivos LPR con el tipo <b className="text-foreground">Cámara Interior</b>.
                    </div>
                ) : (
                    <div className="divide-y divide-border">
                        {camaras.map((c) => (
                            <div key={c.id} className="px-5 py-3 flex flex-col md:flex-row md:items-center gap-3">
                                <div className="md:w-56">
                                    <div className="flex items-center gap-2">
                                        <span className={cn("h-1.5 w-1.5 rounded-full", c.activa ? "bg-emerald-500" : "bg-muted-foreground/40")} />
                                        <span className="font-semibold text-sm text-foreground">{c.name}</span>
                                    </div>
                                    <div className="text-[11px] text-muted-foreground flex items-center gap-1 mt-0.5">
                                        <MapPin size={10} />
                                        {c.enMapa ? `${Number(c.lat).toFixed(5)}, ${Number(c.lng).toFixed(5)}` : "sin ubicar en el mapa"}
                                    </div>
                                </div>
                                <div className="flex-1 font-mono text-[11px] text-muted-foreground truncate">
                                    {c.rtspVisible || <span className="text-amber-500 font-sans">falta cargar la URL RTSP</span>}
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className="text-[11px] text-muted-foreground flex items-center gap-1"><Gauge size={11} />{c.escena ?? 0.08}</span>
                                    <Button size="sm" variant="outline" disabled={probando || !c.rtsp} onClick={() => probar(c.rtsp, c.id)}>
                                        {probando && probada === c.id ? <Loader2 className="animate-spin" size={14} /> : <CamIcon size={14} />}
                                        <span className="ml-1.5">Probar</span>
                                    </Button>
                                    <a href="/admin/devices" className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2">editar</a>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Ultimos avistamientos */}
            {!!estado?.ultimas?.length && (
                <div className="rounded-2xl border border-border bg-card overflow-hidden">
                    <div className="px-5 py-3 border-b border-border text-sm font-semibold text-foreground">Últimos avistamientos</div>
                    <div className="divide-y divide-border">
                        {estado.ultimas.map((u: any, i: number) => (
                            <div key={i} className="px-5 py-2.5 flex items-center gap-4 text-sm">
                                <span className="font-mono font-bold tracking-widest text-foreground w-28">{u.plate}</span>
                                <span className="text-muted-foreground flex-1 truncate">{u.cameraName || "—"}</span>
                                <span className="text-xs text-muted-foreground">{u.confidence != null ? `${Math.round(u.confidence * 100)}%` : ""}</span>
                                <span className="text-xs text-muted-foreground tabular-nums">{new Date(u.timestamp).toLocaleString("es-UY")}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
