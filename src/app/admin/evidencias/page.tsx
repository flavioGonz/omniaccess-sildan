"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Cctv, Download, FileVideo, Film, Images, ImageOff, Play, RefreshCw, Send, Share2, Trash2, Video } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Cargando, Chip, ErrorEstado, Vacio } from "@/components/ui/estados";
import { Pestanias, type Pestania } from "@/components/ui/pestanias";
import { Seek } from "@/components/ui/search";
import { Cajon, CajonContenido, CajonSeccion } from "@/components/ui/cajon";
import { ConfirmarAccion } from "@/components/DeleteConfirmDialog";
import { CompartirEvento } from "@/components/visor/CompartirEvento";
import { VerGrabacion } from "@/components/video/VerGrabacion";
import { duracion, fechaHora, hace, horaSeg } from "@/lib/fechas";
import { toast } from "@/lib/avisos";
import type { Evidencia, FuenteEvidencia } from "@/lib/evidencias";

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

/** De dónde salió cada tramo: la cámara, su grabador y canal, y el rato. Con varias cámaras van numeradas: es el recorrido. */
function Fuentes({ fuentes }: { fuentes: FuenteEvidencia[] }) {
    if (!fuentes.length) return <p className="text-[12.5px] text-muted-foreground">No quedó registrado de qué cámara salió.</p>;
    return (
        <ol className="space-y-1.5">
            {fuentes.map((f, i) => {
                const seg = f.desde && f.hasta ? Math.round((Date.parse(f.hasta) - Date.parse(f.desde)) / 1000) : null;
                return (
                    <li key={i} className="flex items-start gap-3 rounded-md bg-muted px-3 py-2.5">
                        {fuentes.length > 1 && <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-foreground text-background text-[11px] font-bold tabular-nums mt-px">{i + 1}</span>}
                        <span className="min-w-0 flex-1">
                            <span className="block text-[13px] font-semibold leading-tight truncate">{f.camara || "Cámara"}</span>
                            <span className="block text-[12px] text-muted-foreground mt-0.5">
                                {f.origen === "anillo" ? "Del resguardo del servidor (los últimos minutos de esa cámara), no de un grabador"
                                    : f.grabador ? <>Graba en <b className="font-semibold text-foreground">{f.grabador}</b>{f.canal != null ? <> · canal <b className="font-semibold text-foreground tabular-nums">{f.canal}</b></> : null}</>
                                    : "No figura en ningún grabador"}
                            </span>
                        </span>
                        {f.desde && (
                            <span className="shrink-0 text-right text-[12px] tabular-nums text-muted-foreground">
                                <span className="block text-foreground">{horaSeg(f.desde)}{f.hasta ? ` → ${horaSeg(f.hasta)}` : ""}</span>
                                {seg != null && seg > 0 && <span className="block">{duracion(seg)}</span>}
                            </span>
                        )}
                    </li>
                );
            })}
        </ol>
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
    const [enviar, setEnviar] = useState<{ e: Evidencia; clip: string | null } | null>(null);
    const [borrar, setBorrar] = useState<Evidencia | null>(null);
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

    /**
     * Volver a mandar. Con video guardado: su archivo vive minutos en el servidor, así que primero
     * se lo trae del almacén. Un evento compartido (sólo la foto) se vuelve a compartir tal cual.
     */
    const conVideo = (e: Evidencia) => !!e.video && !!e.archivo;
    const puedeReenviar = (e: Evidencia) => conVideo(e) || (e.origen === "enviado" && !!e.foto);
    const reenviar = async (e: Evidencia) => {
        if (!conVideo(e)) { setAbierta(null); setEnviar({ e, clip: null }); return; }
        setPreparando(true);
        try {
            const r = await fetch("/api/evidencias", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ accion: "preparar", id: e.id }) });
            const j = await r.json().catch(() => null);
            if (!j?.ok) { toast.error("No se pudo preparar el clip", { description: j?.motivo || "Probá de nuevo." }); return; }
            setAbierta(null); setEnviar({ e, clip: j.nombre });
        } catch { toast.error("No se pudo preparar el clip", { description: "Sin conexión con el servidor." }); }
        finally { setPreparando(false); }
    };
    const eliminar = async (e: Evidencia) => {
        const r = await fetch("/api/evidencias", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: e.id, despachos: e.despachos, titulo: e.titulo }) }).catch(() => null);
        const j = r ? await r.json().catch(() => null) : null;
        return j?.ok ? { success: true } : { success: false, error: j?.motivo || "No se pudo borrar." };
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

            <Cajon open={!!abierta} onOpenChange={(v) => { if (!v) setAbierta(null); }}>
                {abierta && (
                    <CajonContenido ancho="medio" titulo={`${abierta.titulo}${abierta.matricula ? ` · ${abierta.matricula}` : ""}`}
                        descripcion={[abierta.instante ? `Del ${fechaHora(abierta.instante)}` : `Guardado ${fechaHora(abierta.cuando)}`, abierta.segundos != null ? duracion(abierta.segundos) : null,
                            abierta.quien ? `${abierta.origen === "grabado" ? "lo grabó" : "lo mandó"} ${abierta.quien} ${hace(abierta.cuando)}` : null].filter(Boolean).join(" · ")}
                        pie={(
                            <div className="flex flex-wrap items-center gap-2 w-full">
                                {abierta.video && <Button asChild size="sm"><a href={abierta.video} download={abierta.archivo || "evidencia.mp4"}><Download size={14} /> Descargar</a></Button>}
                                {puedeReenviar(abierta) && (
                                    <Button variant="outline" size="sm" disabled={preparando} onClick={() => void reenviar(abierta)}>
                                        <Send size={14} /> {preparando ? "Preparando…" : abierta.envios.length ? "Reenviar" : "Enviar"}
                                    </Button>
                                )}
                                {abierta.deviceId && abierta.instante && (
                                    <Button variant="outline" size="sm" onClick={() => { setGrabacion(abierta); setAbierta(null); }}><Video size={14} /> Ver en la grabación</Button>
                                )}
                                <Button variant="ghost" size="sm" onClick={() => setBorrar(abierta)} className="ml-auto text-[var(--mal)] hover:text-[var(--mal)] hover:bg-[color-mix(in_oklab,var(--mal)_12%,transparent)]"><Trash2 size={14} /> Eliminar</Button>
                            </div>
                        )}>
                        <div className="space-y-5">
                            <div className="overflow-hidden rounded-[10px] bg-black aspect-video">
                                {abierta.video
                                    ? <video key={abierta.id} src={abierta.video} poster={abierta.foto || undefined} controls autoPlay playsInline className="w-full h-full object-contain" />
                                    : <Portada e={abierta} className="w-full h-full object-contain" />}
                            </div>
                            {abierta.sinVideo && <p className="text-[12.5px] text-muted-foreground -mt-2">{abierta.sinVideo}</p>}
                            {abierta.detalle && abierta.fuentes.length < 2 && <p className="text-[13px] -mt-1">{abierta.detalle}</p>}
                            <CajonSeccion titulo={abierta.fuentes.length > 1 ? `De dónde salió · ${abierta.fuentes.length} cámaras, en este orden` : "De dónde salió"} icono={Cctv}>
                                <Fuentes fuentes={abierta.fuentes} />
                            </CajonSeccion>
                            <CajonSeccion titulo={abierta.envios.length ? `A quién se mandó · ${abierta.envios.length}` : "A quién se mandó"} icono={Send}>
                                {!abierta.envios.length ? <p className="text-[12.5px] text-muted-foreground">Todavía no se mandó a nadie.</p> : (
                                    <ul className="divide-y divide-border">
                                        {abierta.envios.map((x, i) => (
                                            <li key={i} className="flex items-start gap-3 py-2.5 first:pt-0 last:pb-0">
                                                <span className="min-w-0 flex-1">
                                                    <span className="block text-[13px] font-semibold leading-tight">{CANAL[x.canal] || x.canal}{x.a.length ? ` · ${x.a.join(", ")}` : ""}</span>
                                                    <span className="block text-[12px] text-muted-foreground tabular-nums mt-0.5">{fechaHora(x.cuando)}{x.por ? ` · ${x.por}` : ""}</span>
                                                    {x.estado === "FAILED" && x.error && <span className="block text-[12px] tono-mal mt-0.5">{x.error}</span>}
                                                </span>
                                                <Chip tono={x.estado === "SENT" ? "bien" : x.estado === "FAILED" ? "mal" : "quieto"}>{x.estado === "SENT" ? "Salió" : x.estado === "FAILED" ? "No salió" : "Saliendo"}</Chip>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </CajonSeccion>
                        </div>
                    </CajonContenido>
                )}
            </Cajon>

            {borrar && (
                <ConfirmarAccion id={borrar.id} title={borrar.titulo} open onOpenChange={(v) => { if (!v) setBorrar(null); }} etiquetaAccion="Eliminar"
                    description={borrar.origen === "grabado"
                        ? "Se borran el video y su portada del almacén. No se puede recuperar; si hace falta, hay que volver a sacarlo de la grabación mientras el grabador la conserve."
                        : borrar.video ? "Se borra el video guardado y deja de aparecer acá. El registro de que se mandó, a quién y cuándo sigue en Despachos."
                            : "Deja de aparecer acá. El registro de que se mandó, a quién y cuándo sigue en Despachos."}
                    onDelete={() => eliminar(borrar)} onSuccess={() => { setBorrar(null); setAbierta(null); void pedir(); }} />
            )}

            {enviar && (
                <CompartirEvento clipHecho={enviar.clip} foto={enviar.e.foto} deviceId={enviar.e.deviceId} deviceName={enviar.e.titulo} instante={new Date(enviar.e.instante || enviar.e.cuando)}
                    titulo={enviar.e.titulo} lineas={[enviar.e.fuentes.length > 1 ? enviar.e.fuentes.map((f) => f.camara).filter(Boolean).join(" → ") : enviar.e.detalle || "", enviar.e.segundos != null ? duracion(enviar.e.segundos) : ""].filter(Boolean)} onCerrar={() => { setEnviar(null); void pedir(); }} />
            )}
            {grabacion && grabacion.deviceId && grabacion.instante && (
                <VerGrabacion deviceId={grabacion.deviceId} nombre={grabacion.titulo} instanteMs={Date.parse(grabacion.instante)} onClose={() => setGrabacion(null)} />
            )}
        </div>
    );
}
