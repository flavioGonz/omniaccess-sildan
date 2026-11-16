"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Download, FileVideo, Film, Images, ImageOff, Play, RefreshCw, Send, Share2, Video } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Cargando, Chip, ErrorEstado, Vacio } from "@/components/ui/estados";
import { Pestanias, type Pestania } from "@/components/ui/pestanias";
import { Seek } from "@/components/ui/search";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { CompartirEvento } from "@/components/visor/CompartirEvento";
import { VerGrabacion } from "@/components/video/VerGrabacion";
import { duracion, fechaHora, hace } from "@/lib/fechas";
import { toast } from "@/lib/avisos";
import type { Evidencia } from "@/lib/evidencias";

/**
 * Evidencias: lo que alguien grabó o mandó, en un solo lugar (el porqué y lo verificado: lib/evidencias).
 *
 * La portada es lo que se vino a ver: la grilla es de fotos, con lo mínimo debajo (de qué momento
 * es, quién lo guardó y a quién se mandó). El estado de un envío va en su tono (salió / no salió);
 * no hay otro color en la pantalla.
 */
type Origen = "todo" | "grabado" | "enviado";
type Respuesta = { evidencias: Evidencia[]; hayMas: boolean; total: { grabado: number } };
const CANAL: Record<string, string> = { whatsapp: "WhatsApp", telegram: "Telegram", email: "Correo" };
const ESPERA_BUSCAR_MS = 300;

function Portada({ e, className }: { e: Evidencia; className?: string }) {
    const [rota, setRota] = useState(false);
    if (e.foto && !rota) return <img src={e.foto} alt="" loading="lazy" onError={() => setRota(true)} className={className} />;
    return <span className={`grid place-items-center bg-muted text-muted-foreground ${className || ""}`}>{e.video ? <Film size={26} /> : <ImageOff size={24} />}</span>;
}

function Envios({ e, todos }: { e: Evidencia; todos?: boolean }) {
    if (!e.envios.length) return null;
    return (
        <span className="flex flex-wrap gap-1">
            {(todos ? e.envios : e.envios.slice(0, 2)).map((x, i) => (
                <Chip key={i} tono={x.estado === "SENT" ? "bien" : x.estado === "FAILED" ? "mal" : "quieto"} icono={Send}
                    title={`${x.estado === "SENT" ? "Salió" : x.estado === "FAILED" ? `No salió${x.error ? `: ${x.error}` : ""}` : "Saliendo"} · ${fechaHora(x.cuando)}${x.por ? ` · ${x.por}` : ""}`}>
                    {CANAL[x.canal] || x.canal}{x.a.length ? ` · ${todos ? x.a.join(", ") : `${x.a[0]}${x.a.length > 1 ? ` y ${x.a.length - 1} más` : ""}`}` : ""}
                </Chip>
            ))}
            {!todos && e.envios.length > 2 && <Chip tono="quieto">+{e.envios.length - 2}</Chip>}
        </span>
    );
}

export default function Evidencias() {
    const [origen, setOrigen] = useState<Origen>("todo");
    const [q, setQ] = useState("");
    const [datos, setDatos] = useState<Respuesta | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [cargando, setCargando] = useState(true);
    const [trayendoMas, setTrayendoMas] = useState(false);
    const [abierta, setAbierta] = useState<Evidencia | null>(null);
    const [enviar, setEnviar] = useState<Evidencia | null>(null);
    const [grabacion, setGrabacion] = useState<Evidencia | null>(null);
    const [preparando, setPreparando] = useState(false);
    const pedido = useRef(0);

    const pedir = useCallback(async (antes?: string) => {
        const n = ++pedido.current;
        if (antes) setTrayendoMas(true); else setCargando(true);
        try {
            const sp = new URLSearchParams();
            if (origen !== "todo") sp.set("origen", origen);
            if (q.trim()) sp.set("q", q.trim());
            if (antes) sp.set("antes", String(Date.parse(antes)));
            const r = await fetch(`/api/evidencias?${sp}`, { cache: "no-store" });
            const j = await r.json().catch(() => null);
            if (n !== pedido.current) return;
            if (!r.ok || !j?.evidencias) { setError(j?.error || `El servidor respondió ${r.status}`); return; }
            setError(null);
            setDatos((d) => (antes && d ? { ...j, evidencias: [...d.evidencias, ...j.evidencias] } : j));
        } catch (e) { if (n === pedido.current) setError(e instanceof Error ? e.message : "Sin conexión con el servidor"); }
        finally { if (n === pedido.current) { setCargando(false); setTrayendoMas(false); } }
    }, [origen, q]);
    // Al escribir se espera un momento: una consulta por letra no le sirve a nadie.
    useEffect(() => { const t = setTimeout(() => { void pedir(); }, q ? ESPERA_BUSCAR_MS : 0); return () => clearTimeout(t); }, [pedir, q]);

    /** Volver a mandar un clip grabado: su archivo vive minutos en el servidor; se lo trae del almacén y se abre el diálogo. */
    const reenviar = async (e: Evidencia) => {
        setPreparando(true);
        try {
            const r = await fetch("/api/evidencias", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ accion: "preparar", id: e.id }) });
            const j = await r.json().catch(() => null);
            if (!j?.ok) { toast.error("No se pudo preparar el clip", { description: j?.motivo || "Probá de nuevo." }); return; }
            setAbierta(null); setEnviar(e);
        } catch { toast.error("No se pudo preparar el clip", { description: "Sin conexión con el servidor." }); }
        finally { setPreparando(false); }
    };

    const lista = datos?.evidencias || [];
    const opciones: Pestania<Origen>[] = [
        { valor: "todo", rotulo: "Todo", icono: Images },
        { valor: "grabado", rotulo: "Grabados", icono: Video, cuenta: datos?.total.grabado, ayuda: "Lo que se grabó con el botón Grabar del vivo, en una cámara o siguiendo a alguien por varias" },
        { valor: "enviado", rotulo: "Enviados", icono: Share2, ayuda: "Los clips y los eventos que se mandaron por WhatsApp o Telegram desde el panel" },
    ];

    return (
        <div className="p-6 lg:p-8 space-y-4">
            <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-3 min-w-0 mr-auto">
                    <span className="grid h-9 w-9 place-items-center rounded-[10px] bg-foreground text-background shrink-0"><FileVideo size={18} strokeWidth={2.3} /></span>
                    <div className="min-w-0">
                        <h1 className="text-[17px] font-bold leading-tight">Evidencias</h1>
                        <p className="text-[11.5px] text-muted-foreground">Lo que se grabó y lo que se mandó desde el panel</p>
                    </div>
                </div>
                <Seek value={q} onChange={setQ} placeholder="Cámara, persona, matrícula o destino" alto={34} startOpen />
                <Button variant="ghost" size="sm" onClick={() => void pedir()} disabled={cargando} className="h-[34px] text-muted-foreground hover:text-foreground">
                    <RefreshCw size={14} className={cargando ? "animate-spin" : ""} /> Actualizar
                </Button>
            </div>
            <Pestanias valor={origen} opciones={opciones} alElegir={setOrigen} />

            {error ? <ErrorEstado mensaje={error} alReintentar={() => void pedir()} />
                : cargando && !datos ? <Cargando texto="Buscando las evidencias…" />
                : !lista.length ? (
                    <Vacio icono={FileVideo} titulo={q.trim() ? "Nada coincide con esa búsqueda" : origen === "enviado" ? "Todavía no se mandó nada desde el panel" : "Todavía no hay nada guardado"}
                        ayuda={q.trim() ? "Se busca por cámara, por quién lo guardó, por matrícula y por a quién se mandó." : "Lo que se graba con el botón Grabar del vivo y lo que se manda por WhatsApp o Telegram queda acá."} />
                ) : (
                    <>
                        <div className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(250px,1fr))]">
                            {lista.map((e) => (
                                <button key={e.id} type="button" onClick={() => setAbierta(e)}
                                    className="group flex flex-col text-left rounded-[10px] border border-border bg-card overflow-hidden hover:border-foreground/30 focus-visible:outline-2 focus-visible:outline-[var(--accion)] transition-colors">
                                    <span className="relative block w-full aspect-video bg-muted shrink-0">
                                        <Portada e={e} className="absolute inset-0 w-full h-full object-cover" />
                                        {e.video && <span className="absolute inset-0 grid place-items-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/25"><span className="grid h-11 w-11 place-items-center rounded-full bg-white text-black"><Play size={18} fill="currentColor" /></span></span>}
                                        <span className="absolute left-2 top-2"><Chip tono={e.origen === "grabado" ? "info" : "neutro"} pleno>{e.origen === "grabado" ? "Grabado" : e.video ? "Clip enviado" : "Enviado"}</Chip></span>
                                        {e.segundos != null && <span className="absolute right-2 bottom-2 rounded-md bg-black/75 px-1.5 py-0.5 text-[11px] font-semibold text-white tabular-nums">{duracion(e.segundos)}</span>}
                                    </span>
                                    <span className="block w-full min-w-0 p-3 space-y-1.5">
                                        <span className="block text-[13px] font-semibold leading-tight truncate">{e.titulo}{e.matricula ? ` · ${e.matricula}` : ""}</span>
                                        <span className="block text-[11.5px] text-muted-foreground tabular-nums truncate">
                                            {fechaHora(e.instante || e.cuando)}{e.camaras && e.camaras > 1 ? ` · ${e.camaras} cámaras` : ""}{e.quien ? ` · ${e.quien}` : ""}
                                        </span>
                                        <Envios e={e} />
                                    </span>
                                </button>
                            ))}
                        </div>
                        {datos?.hayMas && (
                            <div className="flex justify-center pt-2">
                                <Button variant="outline" size="sm" disabled={trayendoMas} onClick={() => void pedir(lista[lista.length - 1].cuando)}>{trayendoMas ? "Trayendo…" : "Ver más antiguas"}</Button>
                            </div>
                        )}
                    </>
                )}

            <Dialog open={!!abierta} onOpenChange={(v) => { if (!v) setAbierta(null); }}>
                <DialogContent className="max-w-[920px] p-0 overflow-hidden gap-0">
                    {abierta && (
                        <>
                            <div className="bg-black aspect-video">
                                {abierta.video
                                    ? <video key={abierta.id} src={abierta.video} poster={abierta.foto || undefined} controls autoPlay playsInline className="w-full h-full object-contain" />
                                    : <Portada e={abierta} className="w-full h-full object-contain" />}
                            </div>
                            <div className="p-5 space-y-3">
                                <div>
                                    <DialogTitle className="text-[16px] font-bold leading-tight">{abierta.titulo}{abierta.matricula ? ` · ${abierta.matricula}` : ""}</DialogTitle>
                                    <DialogDescription className="text-[12.5px] text-muted-foreground tabular-nums mt-1">
                                        {abierta.instante ? `Del ${fechaHora(abierta.instante)}` : `Guardado ${fechaHora(abierta.cuando)}`}
                                        {abierta.segundos != null ? ` · ${duracion(abierta.segundos)}` : ""}
                                        {abierta.quien ? ` · ${abierta.origen === "grabado" ? "lo grabó" : "lo mandó"} ${abierta.quien} ${hace(abierta.cuando)}` : ""}
                                    </DialogDescription>
                                    {abierta.detalle && <p className="text-[12.5px] mt-1.5">{abierta.detalle}</p>}
                                </div>
                                {abierta.sinVideo && <p className="text-[12.5px] text-muted-foreground">{abierta.sinVideo}</p>}
                                <Envios e={abierta} todos />
                                <div className="flex flex-wrap gap-2 pt-1">
                                    {abierta.video && <Button asChild size="sm"><a href={abierta.video} download={abierta.archivo || "evidencia.mp4"}><Download size={14} /> Descargar</a></Button>}
                                    {abierta.origen === "grabado" && abierta.video && abierta.archivo && (
                                        <Button variant="outline" size="sm" disabled={preparando} onClick={() => void reenviar(abierta)}><Send size={14} /> {preparando ? "Preparando…" : "Enviar"}</Button>
                                    )}
                                    {abierta.deviceId && abierta.instante && (
                                        <Button variant="outline" size="sm" onClick={() => { setGrabacion(abierta); setAbierta(null); }}><Video size={14} /> Ver ese momento en la grabación</Button>
                                    )}
                                </div>
                            </div>
                        </>
                    )}
                </DialogContent>
            </Dialog>

            {enviar && enviar.archivo && (
                <CompartirEvento clipHecho={enviar.archivo} foto={enviar.foto} deviceId={enviar.deviceId} deviceName={enviar.titulo} instante={new Date(enviar.instante || enviar.cuando)}
                    titulo={enviar.titulo} lineas={[enviar.detalle || "", enviar.segundos != null ? duracion(enviar.segundos) : ""].filter(Boolean)} onCerrar={() => { setEnviar(null); void pedir(); }} />
            )}
            {grabacion && grabacion.deviceId && grabacion.instante && (
                <VerGrabacion deviceId={grabacion.deviceId} nombre={grabacion.titulo} instanteMs={Date.parse(grabacion.instante)} onClose={() => setGrabacion(null)} />
            )}
        </div>
    );
}
