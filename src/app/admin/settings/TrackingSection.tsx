"use client";

import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { sileo as toast } from "sileo";
import {
    ScanLine, Video, Plus, Trash2, RefreshCw, Play, Square, Camera as CamIcon,
    MapPin, Gauge, Loader2, Terminal, Route, CheckCircle2, XCircle, Save, Info
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

type Camara = {
    name: string;
    rtsp: string;
    deviceId?: string;
    lat?: number | string;
    lng?: number | string;
    escena?: number | string;
    activa?: boolean;
    rtspVisible?: string;
};

const CAMARA_VACIA: Camara = { name: "", rtsp: "", lat: "", lng: "", escena: "", activa: true };

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
    const [guardando, setGuardando] = useState(false);
    const [operando, setOperando] = useState<string | null>(null);
    const [nueva, setNueva] = useState<Camara>({ ...CAMARA_VACIA });
    const [probando, setProbando] = useState(false);
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

    const guardar = async (lista: Camara[]) => {
        setGuardando(true);
        try {
            const limpio = lista.map(({ rtspVisible, ...c }) => c);
            const r = await axios.put("/api/tracking/cameras", { camaras: limpio });
            toast.success({ title: `Guardado · ${r.data.total} cámara(s)`, description: "La pasarela toma el cambio en menos de un minuto." });
            await cargar();
        } catch (e: any) {
            toast.error({ title: e?.response?.data?.error || "No se pudo guardar" });
        } finally {
            setGuardando(false);
        }
    };

    const agregar = async () => {
        if (!nueva.name.trim() || !nueva.rtsp.trim()) {
            return toast.error({ title: "Faltan el nombre y la URL RTSP" });
        }
        await guardar([...camaras, nueva]);
        setNueva({ ...CAMARA_VACIA });
        setPrueba(null);
    };

    const quitar = async (i: number) => {
        await guardar(camaras.filter((_, j) => j !== i));
    };

    const alternar = async (i: number) => {
        await guardar(camaras.map((c, j) => (j === i ? { ...c, activa: c.activa === false } : c)));
    };

    const probar = async (rtsp: string) => {
        if (!rtsp.trim()) return toast.error({ title: "Escribí primero la URL RTSP" });
        setProbando(true);
        setPrueba(null);
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

            {/* Alta de camara */}
            <div className="rounded-2xl border border-border bg-card p-5 space-y-4">
                <div className="flex items-start gap-3">
                    <div className="p-2 rounded-xl bg-blue-500/10 border border-blue-500/20"><Video className="text-blue-500" size={18} /></div>
                    <div className="flex-1">
                        <h3 className="font-semibold text-foreground">Agregar una cámara interior</h3>
                        <p className="text-sm text-muted-foreground mt-0.5">
                            Cualquier cámara común sirve como sensor: la pasarela le saca cuadros por RTSP y se los pasa al lector.
                            Una cámara por canal — si el grabador tiene varios, cargá un renglón por cada canal que quieras leer.
                        </p>
                    </div>
                </div>

                <div className="rounded-xl bg-muted/40 border border-border p-3 text-xs text-muted-foreground space-y-1">
                    <div className="flex items-center gap-1.5 font-semibold text-foreground"><Info size={13} /> Cómo se arma la URL</div>
                    <div className="font-mono">Hikvision / NVR · rtsp://usuario:clave@IP:554/Streaming/Channels/<b>101</b></div>
                    <div className="font-mono">Dahua · rtsp://usuario:clave@IP:554/cam/realmonitor?channel=<b>1</b>&amp;subtype=0</div>
                    <div className="font-mono">ONVIF genérica · rtsp://usuario:clave@IP:554/onvif1</div>
                    <div>El canal es el número: <b>101</b> = canal 1 flujo principal, <b>201</b> = canal 2, y así. Usá el flujo principal: el secundario suele no tener resolución para la matrícula.</div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
                    <Input className="md:col-span-3" placeholder="Nombre (ej. Rotonda)" value={nueva.name} onChange={(e) => setNueva({ ...nueva, name: e.target.value })} />
                    <Input className="md:col-span-9 font-mono text-xs" placeholder="rtsp://usuario:clave@192.168.1.50:554/Streaming/Channels/101" value={nueva.rtsp} onChange={(e) => setNueva({ ...nueva, rtsp: e.target.value })} />
                    <Input className="md:col-span-3" placeholder="Latitud (-34.8590869)" value={nueva.lat as string} onChange={(e) => setNueva({ ...nueva, lat: e.target.value })} />
                    <Input className="md:col-span-3" placeholder="Longitud (-56.0784090)" value={nueva.lng as string} onChange={(e) => setNueva({ ...nueva, lng: e.target.value })} />
                    <Input className="md:col-span-2" placeholder="Sensibilidad 0.08" value={nueva.escena as string} onChange={(e) => setNueva({ ...nueva, escena: e.target.value })} />
                    <div className="md:col-span-4 flex gap-2">
                        <Button variant="outline" className="flex-1" disabled={probando} onClick={() => probar(nueva.rtsp)}>
                            {probando ? <Loader2 className="animate-spin" size={15} /> : <CamIcon size={15} />}
                            <span className="ml-1.5">Probar</span>
                        </Button>
                        <Button className="flex-1" disabled={guardando} onClick={agregar}>
                            {guardando ? <Loader2 className="animate-spin" size={15} /> : <Plus size={15} />}
                            <span className="ml-1.5">Agregar</span>
                        </Button>
                    </div>
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
                    <span className="text-sm font-semibold text-foreground">Cámaras cargadas ({camaras.length})</span>
                    {guardando && <span className="text-xs text-muted-foreground flex items-center gap-1.5"><Save size={12} /> guardando…</span>}
                </div>
                {camaras.length === 0 ? (
                    <div className="p-8 text-center text-sm text-muted-foreground">
                        Todavía no hay cámaras de seguimiento. Agregá la primera arriba.
                    </div>
                ) : (
                    <div className="divide-y divide-border">
                        {camaras.map((c, i) => (
                            <div key={i} className="px-5 py-3 flex flex-col md:flex-row md:items-center gap-3">
                                <div className="flex items-center gap-3 md:w-56">
                                    <Switch checked={c.activa !== false} onCheckedChange={() => alternar(i)} />
                                    <div>
                                        <div className="font-semibold text-sm text-foreground">{c.name}</div>
                                        <div className="text-[11px] text-muted-foreground flex items-center gap-1">
                                            <MapPin size={10} />
                                            {c.lat != null && c.lng != null ? `${Number(c.lat).toFixed(5)}, ${Number(c.lng).toFixed(5)}` : "sin ubicación"}
                                        </div>
                                    </div>
                                </div>
                                <div className="flex-1 font-mono text-[11px] text-muted-foreground truncate">{c.rtspVisible || c.rtsp}</div>
                                <div className="flex items-center gap-2">
                                    <span className="text-[11px] text-muted-foreground flex items-center gap-1"><Gauge size={11} />{c.escena ?? 0.08}</span>
                                    <Button size="sm" variant="ghost" disabled={probando} onClick={() => probar(c.rtsp)}><CamIcon size={14} /></Button>
                                    <Button size="sm" variant="ghost" className="text-red-500 hover:text-red-600" onClick={() => quitar(i)}><Trash2 size={14} /></Button>
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
