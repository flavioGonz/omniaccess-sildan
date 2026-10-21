"use client";

import { AjusteVideoFicha } from "@/components/video/AjusteVideoFicha";
import { useClipEvento } from "@/lib/clip-evento";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    Check, ChevronLeft, ChevronRight, Clock, Cctv, Eye, EyeOff, ImageOff, Loader2, PlayCircle, Radar,
    ScanEye, Share2, ShieldAlert, Sparkles, Undo2, X, Car, NotebookPen, Repeat, UserRound, Download, Image as IconoFoto, Radio,
} from "lucide-react";
import { useAnalisisDeteccion } from "@/components/intrusion/AnalisisDeteccion";
import { GrabacionVisor } from "@/components/visor/GrabacionVisor";
import { montarVivo } from "@/lib/vivo";
import { CompartirEvento } from "@/components/visor/CompartirEvento";
import { DescargaClip, type VentanaClip } from "@/components/video/DescargaClip";
import { BotonVisor, Dato, ListaVision, Seccion, describirObjeto } from "@/components/visor/FichaVisor";
import { CapaAnalisis } from "@/components/vision/CapaAnalisis";
import { cn } from "@/lib/utils";
import { fechaCorta, horaSeg, hace } from "@/lib/fechas";
import { useSiluetas } from "@/lib/use-siluetas";
import { useTiempoReal } from "@/lib/tiempo-real";
import { geomDeIntrusion, VEREDICTOS } from "@/lib/vision-capa";
import type { Verificacion } from "@/lib/verificacion";
import { getDetectionHistory, type DetHistItem, type IntrusionCam } from "@/app/actions/detections";
import { META_DETECCION, GeomOverlay, type Geom } from "@/components/intrusion/comun";
import { NotaGestion, usarNotaGestion } from "@/components/alarmas/NotaGestion";
import { GestionEnVivo } from "@/components/alarmas/GestionEnVivo";
import { CapaComportamiento, type MarcasComportamiento } from "@/components/vision/CapaComportamiento";
import type { ClaveComportamiento, ParamsComportamiento } from "@/lib/comportamientos";

/**
 * Una detección de OmniVision (un aviso de sus reglas) abierta en esta ventana (21/10): con qué se
 * dibuja en vivo sobre la foto, cómo funciona el comportamiento, su clip propio (la permanencia trae
 * la llegada, no «N s antes de la foto») y la estadía si es «Se quedó en la zona».
 */
export type FichaVision = {
    clave: ClaveComportamiento | null;
    params: ParamsComportamiento;
    marcas: MarcasComportamiento;
    /** El cuadro sin marcas: la capa dibuja encima. Sin él, la foto marcada del aviso y sin capa. */
    fotoCruda: string | null;
    clipPropio?: { instante: number; antes: number; despues: number; motivo: string } | null;
    estadia?: { desde: string; hasta: string | null; quieto: string | null; llegada: boolean | null; como: string | null; reabierta: number } | null;
};

/**
 * La ficha de una detección (cruce de línea, intrusión, zona), con la forma del visor de los
 * eventos de acceso: la foto ocupa la ventana y los datos van encima.
 *
 * Antes era una foto arriba y, abajo, tarjetas y un mapa satelital: para leer el análisis había
 * que bajar, y el mapa ocupaba media pantalla para decir algo que el guardia ya sabe (dónde está
 * su cámara). Lo que decide si una detección es real es la FOTO y lo que se ve en ella, así que
 * todo lo demás queda a su lado y a la vista:
 *
 *   IZQUIERDA  qué vio OmniVision (veredicto, objetos con sus rasgos, el cuadro propio), cuándo y
 *              de dónde, y lo que pasaba alrededor (el episodio, el ritmo, las falsas de la cámara,
 *              las matrículas leídas cerca).
 *   ABAJO      la decisión: falsa o real.
 *   DERECHA    grabación, cámara en vivo, compartir, imagen limpia.
 *
 * Vivía adentro de admin/monitor-intrusion/page.tsx; salió el 8/10 para que una detección se vea
 * igual desde el monitor de intrusión, el monitor LPR y el panel.
 */

const CLASE: Record<string, string> = { human: "Persona", vehicle: "Vehículo" };
/** La proporción de la ventana; la misma que `.visor-ventana` en globals.css. */
const AR_VENTANA = 16 / 9;
/** Un análisis tarda unos segundos (cola de vision-worker): antes de esto se dice «verificando». */
const VERIFICANDO_MS = 90_000;
const TONO_VEREDICTO: Record<string, string> = { mal: "var(--mal)", aviso: "var(--aviso)", quieto: "var(--muted-foreground)", bien: "var(--bien)" };
const TEXTO_VEREDICTO: Record<string, string> = { mal: "visor-mal", aviso: "visor-aviso", quieto: "text-white/75", bien: "visor-bien" };
/*
 * Tema (18/10, Nico: «estilizar similar a la de LPR respecto a light y dark»): la ventana usa las
 * mismas clases que el visor de LPR (visor-raiz, visor-marco, visor-velo-*, visor-zona), y la capa
 * de globals.css «El visor en tema claro» la aclara. En oscuro queda como estaba.
 */

// El clip en loop vive en lib/clip-evento (lo comparte el panel del Monitor de Intrusión).

export function FichaDeteccion({ det, cam, geom, onClose, onResolveAlarm, hasAlarm, enAtencion, onCerrarAtencion, onMarcar, zCapa, extraArriba, claveGestion, titulo, vision }: {
    det: any; cam?: IntrusionCam; geom?: Geom; onClose: () => void;
    onResolveAlarm?: (deviceId: string, kind: "real" | "false") => void; hasAlarm?: boolean;
    /** La cámara tiene una intrusión confirmada como real y sin resolver. */
    enAtencion?: boolean;
    /** Cerrarla: aceptarla como resuelta, o reclasificarla como falsa alarma. */
    onCerrarAtencion?: (deviceId: string, como: "resuelta" | "falsa") => void;
    /** Corregir ESTA detección (no la cámara entera): real o falsa alarma. */
    onMarcar?: (id: string, kind: "real" | "false") => Promise<{ ok: boolean; error?: string } | void>;
    /** z-index de la ficha: abierta desde la alerta global tiene que quedar por encima de ella. */
    zCapa?: number;
    /** Lo que agrega quien la abre, arriba a la derecha (la alerta global: el sonido y las otras cámaras). */
    extraArriba?: React.ReactNode;
    /**
     * La ventana abierta para algo que NO es una detección de intrusión (un aviso de OmniVision desde
     * Gestión de alarmas, 20/10): su clave de gestión (`a:<aviso>`), para que la nota y la bitácora
     * sean las de esa alarma, y sin pedir la verificación de intrusión, que no existe para ella.
     */
    claveGestion?: string;
    /** El nombre de lo detectado cuando no es un tipo de intrusión («Se quedó en la zona»…). */
    titulo?: string;
    /** Un aviso de OmniVision: ver FichaVision. */
    vision?: FichaVision | null;
}) {
    const [cur, setCur] = useState<any>(det);
    /*
     * La grabación y el vivo, EN la ventana (18/10, Nico: «el playback de los cruces de línea e
     * intrusión llama al otro modal viejo; debe tener en su mismo modal el módulo de playback, como
     * LPR»). Antes los dos botones abrían el reproductor viejo (LiveModal) encima de la ficha. Ahora
     * son modos de la misma ventana, como en el visor de LPR: el reproductor con su regla y sus
     * controles de tiempo (GrabacionVisor), o el vivo de la cámara, y se vuelve a la foto con un
     * botón o con Esc. En esos modos la ficha se oculta; para decidir se vuelve a la foto.
     */
    const [modo, setModo] = useState<"foto" | "grabacion" | "vivo">("foto");
    /** El cajón del clip de la grabación: mientras está abierto, la barrita de arriba no lo tapa. */
    const [clipGrab, setClipGrab] = useState(false);
    const vivoRef = useRef<HTMLVideoElement>(null);
    const [vivoListo, setVivoListo] = useState(false);
    const [compartir, setCompartir] = useState(false);
    /*
     * Exportar el clip (18/10, Nico: «debe permitir también exportar los clips con el drawer»): el
     * mismo cajón «Exportar clip» del visor de LPR, dentro de la ventana. El canal del NVR sale de
     * la detección o de la cámara; si no viene, se pregunta (como el video de la alerta).
     */
    const [descarga, setDescarga] = useState(false);
    const [ventanaClip, setVentanaClip] = useState<VentanaClip | null>(null);
    const [canalClip, setCanalClip] = useState<{ ch: number; nvr: string | null } | null>(null);
    useEffect(() => { fetch("/api/playback/ventana", { cache: "no-store" }).then((r) => r.json()).then((d) => { if (d?.topes) setVentanaClip(d); }).catch(() => { }); }, []);
    const [limpio, setLimpio] = useState(false);
    /** Qué foto se mira: la captura de la cámara o el cuadro propio de la doble verificación. */
    const [foto, setFoto] = useState<"captura" | "propio">("captura");
    const [proporcion, setProporcion] = useState(AR_VENTANA);
    const [verSiluetas, setVerSiluetas] = useSiluetas();
    useEffect(() => {
        const chConocido = cur.ch ?? cam?.ch;
        if (chConocido != null) { setCanalClip({ ch: Number(chConocido), nvr: cam?.nvrId ?? null }); return; }
        setCanalClip(null);
        if (!cur.deviceId) return;
        let vivo = true;
        fetch(`/api/nvr/channel?deviceId=${encodeURIComponent(cur.deviceId)}`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null))
            .then((j) => { if (vivo && j && j.channel != null) setCanalClip({ ch: Number(j.channel), nvr: j.nvr ? String(j.nvr) : null }); }).catch(() => { });
        return () => { vivo = false; };
    }, [cur.deviceId, cur.ch, cam?.ch, cam?.nvrId]);
    const [sibs, setSibs] = useState<DetHistItem[]>([]);
    useEffect(() => { setCur(det); }, [det]);
    useEffect(() => { if (!det.deviceId) { setSibs([]); return; } getDetectionHistory({ deviceId: det.deviceId, pageSize: 60 }).then((r) => setSibs(r.items)).catch(() => setSibs([])); }, [det.deviceId]);
    useEffect(() => { setFoto("captura"); setProporcion(AR_VENTANA); setModo("foto"); setClipGrab(false); }, [cur.id]);
    useEffect(() => {
        if (modo !== "vivo" || !cur.deviceId) return;
        const v = vivoRef.current; if (!v) return;
        setVivoListo(false);
        const alAndar = () => setVivoListo(true);
        v.addEventListener("playing", alAndar);
        const cortar = montarVivo(v, cur.deviceId, 4, "sd");
        return () => { v.removeEventListener("playing", alAndar); cortar(); };
    }, [modo, cur.deviceId]);
    const idx = sibs.findIndex((x) => x.id === cur.id);
    const go = (d: number) => { if (idx < 0) return; const n = idx + d; if (n >= 0 && n < sibs.length) setCur(sibs[n]); };
    const hasPrev = idx >= 0 && idx < sibs.length - 1; // más viejo
    const hasNext = idx > 0;                            // más nuevo
    const real = !!cur.id && !String(cur.id).startsWith("live-");

    /* Lo que vio omni-vision. No viene con la detección: se pide, y se vuelve a pedir cuando
       vision-worker avisa que la terminó (una detección recién llegada todavía se está mirando). */
    const [verif, setVerif] = useState<Verificacion | null>(null);
    const pedirVerif = useCallback(() => {
        if (!real || claveGestion) return;
        fetch(`/api/monitor/intrusion/verificacion?ids=${encodeURIComponent(cur.id)}`, { cache: "no-store" })
            .then((r) => (r.ok ? r.json() : {})).then((j: Record<string, Verificacion>) => setVerif(j?.[cur.id] || null)).catch(() => { });
    }, [cur.id, real, claveGestion]);
    useEffect(() => { setVerif(null); pedirVerif(); }, [pedirVerif]);
    useTiempoReal("detection_verified", (x: any) => { if (x?.id && x.id === cur.id) pedirVerif(); });
    const { analisis: alrededor, error: errorAlrededor } = useAnalisisDeteccion(real && !claveGestion ? cur.id : null);

    const m0 = META_DETECCION[cur.type] || META_DETECCION.OTHER;
    const m = titulo ? { ...m0, label: titulo } : m0;
    const clase = cur.label && CLASE[cur.label] ? CLASE[cur.label] : null;
    const nvr = cur.nvrName || cam?.nvrName; const ch = cur.ch ?? cam?.ch;
    const [rk] = useState(Date.now());
    // Un aviso de OmniVision se mira sobre su cuadro crudo, con la capa en vivo encima (ver FichaVision).
    const conCapa = !!vision?.fotoCruda && cur.id === det.id;
    const captura = conCapa ? vision!.fotoCruda : cur.snapshotPath ? cur.snapshotPath : (cur.deviceId ? `/api/snapshot/${cur.deviceId}?t=${rk}_${cur.id}` : null);
    const propio = verif?.analisis?.propio ? verif.analisis.propio : null;
    const enPropio = foto === "propio" && !!propio;
    const src = enPropio ? `/api/monitor/intrusion/verificacion/${cur.id}` : captura;
    const capa = enPropio ? propio : verif?.analisis || null;
    const g = useMemo(() => geomDeIntrusion(geom as any), [geom]);
    const ver = verif?.veredicto ? VEREDICTOS[verif.veredicto] : null;
    const verificando = !verif?.estado && real && !claveGestion && Date.now() - new Date(cur.timestamp).getTime() < VERIFICANDO_MS;
    const momento = new Date(cur.timestamp);

    const alarmaPendiente = !!(hasAlarm && cur.deviceId && onResolveAlarm);
    const atencionAbierta = !hasAlarm && !!enAtencion && !!cur.deviceId && !!onCerrarAtencion;
    const corregible = !alarmaPendiente && !atencionAbierta && !!onMarcar && real;
    /** El tono de la ventana lo pone el estado: rojo lo que hay que decidir o fue real, gris lo archivado. */
    const tono = alarmaPendiente || atencionAbierta || (cur.acknowledged && cur.ackKind !== "false") ? "var(--mal)"
        : !cur.acknowledged ? "var(--aviso)" : "var(--muted-foreground)";
    const estado = alarmaPendiente ? "Intrusión detectada · sin confirmar" : atencionAbierta ? "Intrusión confirmada · sin resolver"
        : !cur.acknowledged ? "Sin revisar" : cur.ackKind === "false" ? "Marcada falsa alarma" : "Marcada real";

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (compartir || descarga) return;
            const t = e.target as HTMLElement | null;
            if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
            // En la grabación las flechas, el espacio y la E son del reproductor; Esc vuelve a la foto.
            if (modo !== "foto") { if (e.key === "Escape" && !clipGrab) { e.preventDefault(); setModo("foto"); } return; }
            if (e.key === "ArrowLeft") { e.preventDefault(); go(1); }
            else if (e.key === "ArrowRight") { e.preventDefault(); go(-1); }
            else if (e.key === "Escape") { e.preventDefault(); if (verNota) setVerNota(false); else if (limpio) setLimpio(false); else if (enPropio) setFoto("captura"); else onClose(); }
            else if (e.key === "h" || e.key === "H") setLimpio((v) => !v);
            else if ((e.key === "o" || e.key === "O") && capa) setVerSiluetas(!verSiluetas);
            else if ((e.key === "c" || e.key === "C") && real) cambiarClip(!clipOn);
            else if (alarmaPendiente) {
                const k = e.key.toLowerCase();
                if (k === "a" || e.key === "Enter") { e.preventDefault(); onResolveAlarm!(cur.deviceId, "real"); }
                else if (k === "f" || k === "r") { e.preventDefault(); onResolveAlarm!(cur.deviceId, "false"); }
            } else if (atencionAbierta) {
                const k = e.key.toLowerCase();
                if (k === "a" || e.key === "Enter") { e.preventDefault(); onCerrarAtencion!(cur.deviceId, "resuelta"); }
                else if (k === "f") { e.preventDefault(); onCerrarAtencion!(cur.deviceId, "falsa"); }
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }); // se re-engancha en cada render: lee siempre el estado vigente

    /* La nota de gestión de esta detección (la misma que en Gestión de alarmas). Lo escrito se
       guarda también al decidir, para que la decisión no quede sin su porqué. */
    const nota = usarNotaGestion(real ? claveGestion || `d:${cur.id}` : null);
    const conNota = (f: () => unknown) => () => { f(); if (nota.sucia) void nota.guardar(); };
    /* La nota se abre a pedido (16/10, Nico: «sólo debe abrirse al presionar el botón»): siempre a
       la vista tapaba las detecciones de la columna izquierda. Flota abajo al centro, sobre la foto. */
    const [verNota, setVerNota] = useState(false);
    useEffect(() => { setVerNota(false); }, [cur.id]);
    const botonNota = real ? (
        <BotonDecision onClick={() => setVerNota((v) => !v)} icono={NotebookPen} activo={verNota}>
            {nota.guardada ? "Ver nota" : "Nota"}{nota.guardada && !verNota && <span className="h-1.5 w-1.5 rounded-full bg-[var(--accion-en-oscuro)]" />}
        </BotonDecision>
    ) : null;
    const { clipOn, cambiarClip, clip, clipVisible, setClipVisible, ventana: ventanaFicha } = useClipEvento({
        id: cur.id, deviceId: cur.deviceId, instante: cur.timestamp, nvrId: cam?.nvrId ?? null, ch: cur.ch ?? cam?.ch ?? null, activo: real,
    });
    const enVideo = clipOn && clip.estado === "listo" && clipVisible && !enPropio;
    /** Con la grabación o el vivo en la ventana, lo de encima se oculta como en la imagen limpia. */
    const oculto = limpio || modo !== "foto";

    const marcar = async (k: "real" | "false") => {
        const r = await onMarcar!(cur.id, k);
        if (!r || r.ok) setCur((c: any) => ({ ...c, acknowledged: true, ackKind: k }));
        if (nota.sucia) void nota.guardar();
    };

    const objetosVeredicto = (verif?.fuente === "propio" && propio ? propio : verif?.analisis)?.objetos || [];
    const lineasCompartir = [
        `${fechaCorta(momento)} ${horaSeg(momento)}${nvr ? ` · ${nvr}${ch != null ? ` CH ${ch}` : ""}` : ""}`,
        // Los objetos de la foto que dio el veredicto: si fue el cuadro propio, los de ése.
        ver ? `OmniVision: ${ver.rotulo}${objetosVeredicto.length ? ` — ${objetosVeredicto.slice(0, 4).map((o) => describirObjeto(o)).join("; ")}` : ""}${verif?.fuente === "propio" ? " (cuadro propio)" : ""}` : "",
        estado,
    ].filter(Boolean);

    return (
        <div className="visor-raiz visor-fondo fixed inset-0 z-[2100] bg-black/85 backdrop-blur-md flex items-center justify-center p-4 md:p-6" style={zCapa ? { zIndex: zCapa } : undefined} onClick={onClose}>
            {/* Las flechas AFUERA de la ventana, para pasar los eventos de la cámara. */}
            {hasPrev && <button onClick={(e) => { e.stopPropagation(); go(1); }} title="Evento anterior (más viejo)  ( ← )" aria-label="Evento anterior"
                className="absolute left-2 md:left-5 top-1/2 -translate-y-1/2 z-[5] w-11 h-11 grid place-items-center rounded-full bg-card/70 hover:bg-card text-foreground border border-border backdrop-blur-md"><ChevronLeft size={22} /></button>}
            {hasNext && <button onClick={(e) => { e.stopPropagation(); go(-1); }} title="Evento siguiente (más nuevo)  ( → )" aria-label="Evento siguiente"
                className="absolute right-2 md:right-5 top-1/2 -translate-y-1/2 z-[5] w-11 h-11 grid place-items-center rounded-full bg-card/70 hover:bg-card text-foreground border border-border backdrop-blur-md"><ChevronRight size={22} /></button>}

            <div onClick={(e) => e.stopPropagation()}
                style={{ ["--visor-tono" as any]: tono, borderRadius: "var(--radio-ventana)" }}
                className="visor-ventana visor-marco relative overflow-hidden border border-white/15 shadow-[0_25px_70px_rgba(0,0,0,0.85)] bg-[#05070b] text-white">

                {/* ── La foto, que CUBRE la ventana; lo que se dibuja encima va en su misma caja. ── */}
                <div className="absolute inset-0 overflow-hidden flex items-center justify-center">
                    <div className="relative" style={{
                        height: proporcion >= AR_VENTANA ? "100%" : "auto", width: proporcion >= AR_VENTANA ? "auto" : "100%",
                        aspectRatio: String(proporcion),
                    }}>
                        {src ? (
                            /* eslint-disable-next-line @next/next/no-img-element */
                            <img key={src} src={src} alt="" draggable={false}
                                ref={(i) => { if (i?.complete && i.naturalWidth) setProporcion(i.naturalWidth / i.naturalHeight); }}
                                onLoad={(e) => { const i = e.currentTarget; if (i.naturalWidth) setProporcion(i.naturalWidth / i.naturalHeight); }}
                                className="block w-full h-full object-cover select-none" />
                        ) : <div className="absolute inset-0 grid place-items-center text-white/30"><ImageOff size={32} /></div>}
                        {/* El clip en loop, sobre la foto: entra cuando ya corre, así no hay un cuadro negro. */}
                        {clipOn && clip.estado === "listo" && clip.url && !enPropio && (
                            <video key={clip.url} src={clip.url} autoPlay muted loop playsInline onPlaying={() => setClipVisible(true)} onError={() => setClipVisible(false)}
                                className={cn("absolute inset-0 w-full h-full object-cover transition-opacity duration-500", clipVisible ? "opacity-100" : "opacity-0")} />
                        )}
                        {/* Las reglas de la CÁMARA no van sobre un aviso de OmniVision: dibujaban líneas que no tenían nada que ver. */}
                        {!oculto && !vision && <GeomOverlay geom={geom} alert={alarmaPendiente || atencionAbierta} />}
                        {!oculto && conCapa && <CapaComportamiento m={enVideo ? { zona: vision!.marcas.zona, linea: vision!.marcas.linea } : vision!.marcas} className="z-[6]" />}
                        {/* Las siluetas son de la foto: sobre el video no coinciden. */}
                        {!oculto && verSiluetas && capa && !enVideo && <CapaAnalisis analisis={capa} geom={g} className="z-[6]" />}
                    </div>
                </div>
                {(alarmaPendiente || atencionAbierta) && !oculto && <div className="absolute inset-0 pointer-events-none intr-conf-borde z-[7]" />}
                {/* Los fondos que hacen legible el texto sobre la foto. */}
                <div className={cn("visor-velo-vert absolute inset-0 z-[5] pointer-events-none bg-gradient-to-t from-black/80 via-transparent to-black/60 transition-opacity", oculto && "opacity-0")} />
                <div className={cn("visor-velo-izq absolute inset-y-0 left-0 w-[58%] z-[5] pointer-events-none bg-gradient-to-r from-black/85 via-black/50 to-transparent transition-opacity", oculto && "opacity-0")} />

                {/* La grabación del NVR, en el lugar de la foto, con su regla y sus controles (como en LPR). */}
                {modo === "grabacion" && cur.deviceId && (
                    <GrabacionVisor deviceId={cur.deviceId} camara={cur.deviceName || cam?.name} instanteMs={momento.getTime()} poster={captura} clip={clipGrab} onClip={setClipGrab} />
                )}
                {/* El vivo de la cámara, en la misma ventana. */}
                {modo === "vivo" && cur.deviceId && (
                    <div className="absolute inset-0 z-[8] bg-black overflow-hidden">
                        {/* El cuadro de la detección desenfocado detrás: rellena lo que el vivo (entero) no ocupa. */}
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        {captura && <img src={captura} alt="" aria-hidden className="absolute inset-0 w-full h-full object-cover blur-[40px] opacity-50 scale-110 pointer-events-none" />}
                        <video ref={vivoRef} muted autoPlay playsInline className="absolute inset-0 w-full h-full object-contain" />
                        {!vivoListo && (
                            <div className="absolute inset-0 grid place-items-center">
                                <span className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-black/55 backdrop-blur-xl border border-white/15 text-[11.5px] font-semibold text-white/80">
                                    <Radio size={11} className="animate-pulse text-[var(--mal)]" /> Conectando con la cámara…
                                </span>
                            </div>
                        )}
                    </div>
                )}
                {/* En la grabación o el vivo: qué se mira y cómo volver a la foto, arriba a la derecha. */}
                {modo !== "foto" && !clipGrab && (
                    <div className="absolute top-4 right-4 z-40 flex items-center gap-2">
                        <span className="h-9 pl-2.5 pr-3 rounded-full bg-black/55 backdrop-blur-xl border border-white/15 text-white/85 text-[12px] font-semibold flex items-center gap-2 max-w-[300px]">
                            {modo === "vivo" ? <Radio size={14} className="animate-pulse text-[var(--mal)] shrink-0" /> : <PlayCircle size={14} className="text-[var(--accion-en-oscuro)] shrink-0" />}
                            <span className="truncate">{modo === "vivo" ? "En vivo" : "Grabación"} · {cur.deviceName || cam?.name || "Cámara"}</span>
                        </span>
                        <span className="h-9 rounded-full bg-black/55 backdrop-blur-xl border border-white/15 p-0.5 flex items-center gap-0.5">
                            <button type="button" onClick={() => setModo("foto")} title="Volver a la foto de la detección  ( Esc )" aria-label="Volver a la foto"
                                className="w-8 h-8 rounded-full grid place-items-center text-white/80 hover:text-white hover:bg-white/15"><IconoFoto size={15} /></button>
                            <span className="w-px h-4 bg-white/15 mx-0.5" />
                            <button type="button" onClick={onClose} title="Cerrar" aria-label="Cerrar"
                                className="w-8 h-8 rounded-full grid place-items-center text-white/80 hover:text-white hover:bg-white/15"><X size={15} /></button>
                        </span>
                    </div>
                )}

                {/* ── ARRIBA · qué fue, dónde y cuándo ── */}
                <div className={cn("visor-zona absolute top-0 inset-x-0 z-30 flex items-start justify-between gap-4 p-4 md:px-7 md:py-5 transition-opacity", oculto && "opacity-0 pointer-events-none")}>
                    <div className="flex items-center gap-4 min-w-0">
                        <div className="min-w-0 visor-sombra-texto">
                            <h1 className="flex items-center gap-2.5 text-[20px] md:text-[22px] font-bold tracking-[-0.015em] leading-tight">
                                <m.Icon size={20} className="visor-vig shrink-0" style={{ color: "color-mix(in oklab, var(--visor-tono) 65%, #fff)" }} />
                                <span className="truncate">{m.label}{clase ? ` · ${clase}` : ""}</span>
                            </h1>
                            <p className="flex items-center gap-2 mt-0.5 text-[12.5px] text-white/70 tabular-nums">
                                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: "var(--visor-tono)" }} />
                                <span className="font-semibold text-white/90 truncate max-w-[34vw]">{cur.deviceName || cam?.name || "Cámara"}</span>
                                <span className="text-white/30">·</span><span>{fechaCorta(momento)}</span>
                                <span className="text-white/30">·</span><span>{horaSeg(momento)}</span>
                            </p>
                        </div>
                        {/* Acciones sobre la imagen, sólo íconos (16/10): lo que se ve encima y el clip en loop. */}
                        <div className="flex items-center gap-1.5 shrink-0">
                            {capa && (
                                <BotonArriba activo={verSiluetas && !enVideo} onClick={() => setVerSiluetas(!verSiluetas)}
                                    title={verSiluetas ? `Ocultar lo que detectó OmniVision (${capa.objetos.length})  ( O )` : `Mostrar lo que detectó OmniVision (${capa.objetos.length})  ( O )`}>
                                    <Sparkles size={15} />
                                    {capa.objetos.length > 0 && <span className="absolute -top-0.5 -right-0.5 min-w-4 h-4 px-1 rounded-full bg-white text-black text-[9.5px] font-bold tabular-nums grid place-items-center">{capa.objetos.length}</span>}
                                </BotonArriba>
                            )}
                            {real && cur.deviceId && (
                                <BotonArriba activo={clipOn} onClick={() => cambiarClip(!clipOn)}
                                    title={!clipOn ? `Ver en loop los ${ventanaFicha.antes} s antes de la foto  ( C )`
                                        : clip.estado === "sin" ? `Sin clip: ${clip.motivo}. Tocá para ver sólo la foto  ( C )`
                                            : clip.estado === "cargando" ? "Trayendo el clip del grabador…  ( C )" : `Clip en loop: ${ventanaFicha.antes} s antes de la foto. Tocá para ver sólo la foto  ( C )`}>
                                    {clipOn && clip.estado === "cargando" ? <Loader2 size={15} className="animate-spin" /> : <Repeat size={15} />}
                                    {clipOn && clip.estado === "sin" && <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-[var(--aviso)] ring-2 ring-black/60" />}
                                </BotonArriba>
                            )}
                            {/* Al lado del video en loop, el ajuste de cuánto trae (21/10, Nico: «debe tener acá el ícono
                                para cambiar el tiempo de pre y post del video de fondo»): en la píldora vertical no se encontraba. */}
                            {real && cur.deviceId && <AjusteVideoFicha lado="abajo-izq" />}
                            {enVideo && <span className="text-[11px] font-semibold text-white/70 visor-sombra-texto tabular-nums">En loop · {ventanaFicha.antes} s antes · {ventanaFicha.despues} s después</span>}
                            {clipOn && clip.estado === "sin" && <span className="text-[11px] text-white/50 visor-sombra-texto max-w-[220px] truncate" title={clip.motivo}>Sin clip: {clip.motivo}</span>}
                        </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                        {extraArriba}
                        {idx >= 0 && sibs.length > 1 && <span className="text-[11.5px] font-semibold text-white/60 tabular-nums visor-sombra-texto">{idx + 1} / {sibs.length}</span>}
                        <button type="button" onClick={onClose} title="Cerrar  ( Esc )" aria-label="Cerrar"
                            className="visor-vidrio w-9 h-9 rounded-full text-white/85 hover:text-white flex items-center justify-center"><X size={16} /></button>
                    </div>
                </div>

                {limpio && modo === "foto" && (
                    <button type="button" onClick={() => setLimpio(false)} title="Mostrar la ficha y los controles  ( H )"
                        className="absolute top-4 right-4 z-40 h-8 px-3 rounded-[8px] bg-black/50 backdrop-blur-xl border border-white/15 text-white/80 text-[11.5px] font-semibold flex items-center gap-1.5 opacity-40 hover:opacity-100 transition-opacity">
                        <Eye size={14} /> Mostrar controles
                    </button>
                )}

                {enPropio && !oculto && (
                    <div className="visor-zona absolute top-[92px] left-1/2 -translate-x-1/2 z-30 visor-panel rounded-[10px] pl-3.5 pr-1.5 py-1.5 flex items-center gap-3 text-[12px] text-white/85">
                        <ScanEye size={14} className="text-white/55" />
                        <span>Cuadro propio de OmniVision · <b className="text-white">{verif?.propio?.despuesS ?? "?"} s después</b>{verif?.propio ? ` · ${VEREDICTOS[verif.propio.veredicto].rotulo.toLowerCase()}` : ""}</span>
                        <BotonVisor icono={Undo2} onClick={() => setFoto("captura")}>Volver a la captura</BotonVisor>
                    </div>
                )}

                {/* ── IZQUIERDA · la ficha ── */}
                <div className={cn("visor-zona absolute left-5 md:left-8 top-[88px] bottom-[96px] z-20 w-[min(420px,42vw)] overflow-y-auto overscroll-contain [scrollbar-width:none] flex flex-col transition-opacity",
                    oculto && "opacity-0 pointer-events-none")}>
                    <div className="my-auto flex flex-col gap-3 py-2 visor-sombra-texto">
                        {/* El veredicto de OmniVision, en grande: es lo primero que se quiere saber. */}
                        {!vision && <div className="flex items-start gap-3">
                            <span className="mt-1.5 w-2.5 h-2.5 rounded-full shrink-0" style={{ background: ver ? TONO_VEREDICTO[ver.tono] : "rgba(255,255,255,0.3)" }} />
                            <div className="min-w-0">
                                <div className={cn("text-[22px] font-bold leading-tight", ver ? TEXTO_VEREDICTO[ver.tono] : "text-white/70")}>
                                    {ver ? ver.rotulo
                                        : verificando ? <span className="inline-flex items-center gap-2"><Loader2 size={18} className="animate-spin" /> Verificando…</span>
                                            : verif?.estado === "SIN_FOTO" ? "Sin foto para verificar"
                                                : verif?.estado === "ERROR" ? "OmniVision no pudo mirarla" : "Sin verificar"}
                                </div>
                                <p className="text-[12.5px] text-white/65 leading-snug mt-0.5">
                                    {ver ? <>{ver.explica}{verif?.tocan.some(Boolean) ? " En rojo, la parte que toca." : ""}{verif?.fuente === "propio" ? " Lo vio en el cuadro propio." : ""}</>
                                        : verificando ? "OmniVision está mirando la captura." : "OmniVision no la analizó (anterior al 9/10, sin foto o con error)."}
                                    {" "}<span className="text-white/45">Es una ayuda: la decide una persona.</span>
                                </p>
                                {verif?.aviso === "RETENIDO" && <p className="text-[12px] visor-aviso mt-1">El aviso por WhatsApp/Telegram no salió: sólo se vio {verif.veredicto === "ANIMAL" ? "un animal" : "la escena vacía"}.</p>}
                            </div>
                        </div>}

                        {verif?.analisis && (
                            <Seccion titulo="Lo que vio OmniVision" icono={Sparkles}
                                extra={<span className="text-[11px] text-white/45 tabular-nums">{verif.analisis.objetos.length} {verif.analisis.objetos.length === 1 ? "objeto" : "objetos"}</span>}>
                                {verif.analisis.objetos.length ? <ListaVision objetos={(enPropio && propio ? propio : verif.analisis).objetos} />
                                    : <p className="text-[12.5px] text-white/60">Ni personas, ni vehículos, ni animales en la captura.</p>}
                                {propio && (
                                    /* La doble verificación: un cuadro del canal unos segundos después. Se mira en grande en lugar de la captura. */
                                    <button type="button" onClick={() => setFoto(enPropio ? "captura" : "propio")}
                                        className={cn("mt-2 w-full flex items-center gap-3 p-1.5 rounded-[8px] text-left transition-colors", enPropio ? "bg-white/15" : "bg-white/[0.06] hover:bg-white/12")}>
                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                        <img src={enPropio ? captura || "" : `/api/monitor/intrusion/verificacion/${cur.id}`} alt="" className="w-[96px] aspect-video rounded-[6px] object-cover bg-black shrink-0" />
                                        <span className="min-w-0 text-[12px] leading-snug">
                                            <span className="font-semibold block">{enPropio ? "Ver la captura de la cámara" : `Cuadro propio · ${verif?.propio?.despuesS ?? "?"} s después`}</span>
                                            <span className="text-white/55 block">{enPropio ? "La foto que mandó la cámara con el evento." : `OmniVision miró el canal otra vez${verif?.propio ? `: ${VEREDICTOS[verif.propio.veredicto].rotulo.toLowerCase()}` : ""}.`}</span>
                                        </span>
                                    </button>
                                )}
                            </Seccion>
                        )}

                        <Seccion titulo="La detección" icono={Radar}>
                            <dl>
                                <Dato rotulo="Cuándo" valor={`${fechaCorta(momento)} · ${horaSeg(momento)}`} sufijo={hace(cur.timestamp)} />
                                {/* Sin nombre de NVR en la detección (los avisos de OmniVision no lo traen), el canal que se averiguó para el clip. */}
                                <Dato rotulo="Grabador" valor={nvr ? `${nvr}${ch != null ? ` · CH ${ch}` : ""}` : canalClip ? `CH ${canalClip.ch}` : null} falta="sin NVR" />
                                {cur.eventType && <Dato rotulo="Evento" valor={cur.eventType} />}
                                <Dato rotulo="Estado" valor={estado}
                                    tono={cn("font-semibold", alarmaPendiente || atencionAbierta || (cur.acknowledged && cur.ackKind !== "false") ? "visor-mal" : !cur.acknowledged ? "visor-aviso" : "text-white/80")} />
                            </dl>
                        </Seccion>

                        {/* Quién la opera y lo que se hizo (16/10): tomarla, pasarla a un compañero, la bitácora. */}
                        {real && (
                            <Seccion titulo="Gestión" icono={UserRound}>
                                <GestionEnVivo clave={claveGestion || `d:${cur.id}`} deviceId={cur.deviceId} oscuro inicio={[
                                    { id: `origen-${cur.id}`, ts: cur.timestamp, por: cur.deviceName || cam?.name || "La cámara", texto: `detectó ${m.label.toLowerCase()}${clase ? ` · ${clase.toLowerCase()}` : ""}`, tipo: "origen" },
                                    ...(ver ? [{ id: `vision-${cur.id}`, ts: new Date(new Date(cur.timestamp).getTime() + (verif?.propio?.despuesS ?? 5) * 1000).toISOString(), por: "OmniVision", texto: `la verificó: ${ver.rotulo.toLowerCase()}`, tipo: (ver.tono === "mal" ? "mal" : "info") as "mal" | "info" }] : []),
                                ]} />
                            </Seccion>
                        )}

                        {real && !claveGestion && (
                            <Seccion titulo="Alrededor" icono={Clock}>
                                {errorAlrededor ? <p className="text-[12.5px] text-white/55">No se pudo analizar: {errorAlrededor}</p>
                                    : !alrededor ? <p className="text-[12.5px] text-white/55 flex items-center gap-2"><Loader2 size={13} className="animate-spin" /> Mirando alrededor de esta detección…</p>
                                        : (<>
                                            <dl>
                                                <Dato rotulo="Episodio" valor={`${alrededor.rafaga.cantidad} ${alrededor.rafaga.cantidad === 1 ? "detección" : "detecciones"}`}
                                                    sufijo={alrededor.rafaga.cantidad > 1 ? `${horaSeg(alrededor.rafaga.desde)} a ${horaSeg(alrededor.rafaga.hasta)}` : null} />
                                                <Dato rotulo="Hoy" valor={`${alrededor.ritmo.hoy} en esta cámara`} sufijo={`${alrededor.ritmo.hoyEnLaHora} en esta hora · suele ${alrededor.ritmo.habitualPorHora}`} />
                                                <Dato rotulo="Falsas" valor={alrededor.historial.revisadas >= 5 ? `${Math.round((alrededor.historial.falsas / alrededor.historial.revisadas) * 100)} %` : null}
                                                    falta="pocas revisadas aún" sufijo={alrededor.historial.revisadas >= 5 ? `de ${alrededor.historial.revisadas} revisadas en esta cámara` : null} />
                                            </dl>
                                            {alrededor.indicios.length > 0 && (
                                                <ul className="mt-1.5 space-y-1">
                                                    {alrededor.indicios.map((i, k) => (
                                                        <li key={k} className="flex items-start gap-2 text-[12.5px] leading-snug text-white/85">
                                                            <span className="mt-[0.45em] h-1.5 w-1.5 rounded-full shrink-0" style={{ background: i.tono === "neutro" ? "rgba(255,255,255,0.4)" : `var(--${i.tono})` }} />
                                                            <span>{i.texto}</span>
                                                        </li>
                                                    ))}
                                                </ul>
                                            )}
                                            {alrededor.lecturas.length > 0 && (
                                                <dl className="mt-1.5">
                                                    {alrededor.lecturas.slice(0, 4).map((l, k) => (
                                                        <Dato key={k} rotulo={k === 0 ? "Leídas cerca" : ""} valor={<span className="inline-flex items-center gap-1.5"><Car size={12} className="text-white/50" /><span className="tracking-[0.08em]">{l.plate}</span></span>}
                                                            sufijo={`${l.sentido === "EXIT" ? "sale" : "entra"} ${horaSeg(l.timestamp)}`} />
                                                    ))}
                                                </dl>
                                            )}
                                        </>)}
                            </Seccion>
                        )}
                    </div>
                </div>

                {/* ── ABAJO · la decisión, a la derecha (16/10, Nico); los atajos, a la izquierda ── */}
                <div className={cn("visor-zona absolute bottom-0 inset-x-0 z-30 px-5 md:px-8 pb-5 pt-3 flex items-end justify-between gap-4 transition-opacity", oculto && "opacity-0 pointer-events-none")}>
                    <span className="text-[11px] text-white/45 tabular-nums visor-sombra-texto">
                        ← → eventos · H imagen limpia{real ? " · C clip" : ""} · Esc {enPropio ? "volver a la captura" : "cerrar"}
                        <span className="block text-[10px] text-white/30 select-all">{cur.id}</span>
                    </span>
                    <div className="flex flex-col items-end gap-1.5 text-right">
                        {alarmaPendiente ? (
                            <div className="flex items-center gap-2">
                                <BotonDecision onClick={conNota(() => onResolveAlarm!(cur.deviceId, "false"))} icono={X} tecla="F">Falsa alarma</BotonDecision>
                                <BotonDecision onClick={conNota(() => onResolveAlarm!(cur.deviceId, "real"))} icono={Check} tecla="A" grave>Confirmar real</BotonDecision>
                                {botonNota}
                            </div>
                        ) : atencionAbierta ? (
                            <>
                                <div className="flex items-center gap-2">
                                    <BotonDecision onClick={conNota(() => onCerrarAtencion!(cur.deviceId, "falsa"))} icono={X} tecla="F">Falsa alarma</BotonDecision>
                                    <BotonDecision onClick={conNota(() => onCerrarAtencion!(cur.deviceId, "resuelta"))} icono={Check} tecla="A" grave>Aceptar · resuelta</BotonDecision>
                                    {botonNota}
                                </div>
                                <p className="text-[11px] text-white/55 visor-sombra-texto max-w-md text-right">Fue confirmada como real. Si con la foto delante ves que no lo era, marcala como falsa: queda corregido en el historial.</p>
                            </>
                        ) : corregible ? (
                            <>
                                <div className="flex items-center gap-2">
                                    {cur.ackKind !== "false" && <BotonDecision onClick={() => marcar("false")} icono={X}>{cur.acknowledged ? "Era falsa alarma" : "Falsa alarma"}</BotonDecision>}
                                    {(cur.ackKind === "false" || !cur.acknowledged) && <BotonDecision onClick={() => marcar("real")} icono={ShieldAlert} grave>{cur.acknowledged ? "Era real" : "Fue real"}</BotonDecision>}
                                    {botonNota}
                                </div>
                                <p className="text-[11px] text-white/55 visor-sombra-texto">Corrige sólo este evento en el historial; no cambia el estado de la cámara.</p>
                            </>
                        ) : botonNota ? <div className="flex items-center gap-2">{botonNota}</div> : <span />}
                    </div>
                </div>

                {/* La nota de gestión, a pedido: flota sobre sus botones, abajo a la derecha, no sobre la columna. */}
                {verNota && real && (
                    <div className={cn("visor-zona absolute bottom-[84px] right-5 md:right-8 z-40 w-[min(460px,62vw)] visor-panel rounded-[14px] p-3 shadow-[0_18px_40px_rgba(0,0,0,0.55)]", oculto && "hidden")}
                        onClick={(e) => e.stopPropagation()}>
                        <button type="button" onClick={() => setVerNota(false)} aria-label="Cerrar la nota" title="Cerrar"
                            className="absolute top-2 right-2 w-7 h-7 grid place-items-center rounded-full text-white/60 hover:text-white hover:bg-white/15"><X size={14} /></button>
                        <NotaGestion n={nota} oscuro />
                    </div>
                )}

                {/* ── DERECHA · lo que se hace con la cámara ── */}
                <div className={cn("visor-zona absolute right-4 md:right-5 top-1/2 -translate-y-1/2 z-30 visor-panel rounded-full p-1.5 flex flex-col items-center gap-1.5 transition-opacity",
                    oculto && "opacity-0 pointer-events-none")}>
                    {cur.deviceId && real && <BotonRiel onClick={() => setModo("grabacion")} title="Ver la grabación de este momento, acá (con su regla y los eventos de la cámara)"><PlayCircle size={15} /></BotonRiel>}
                    {cur.deviceId && <BotonRiel onClick={() => setModo("vivo")} title="Ver la cámara en vivo, acá"><Cctv size={15} /></BotonRiel>}
                    {real && cur.deviceId && canalClip && ventanaClip && <BotonRiel onClick={() => setDescarga(true)} title={`Exportar un clip: bajarlo o mandarlo por WhatsApp (${ventanaClip.antes} s antes y ${ventanaClip.despues} s después)`}><Download size={15} /></BotonRiel>}
                    {real && cur.snapshotPath && <BotonRiel onClick={() => setCompartir(true)} title="Compartir por WhatsApp o Telegram"><Share2 size={15} /></BotonRiel>}
                    <span className="w-4 h-px bg-white/15" />
                    <BotonRiel onClick={() => setLimpio(true)} title="Ver la imagen limpia, sin nada encima  ( H )"><EyeOff size={15} /></BotonRiel>
                </div>

                {/* Compartir: un cajón dentro de la ventana, como «Exportar clip». */}
                {compartir && <CompartirEvento foto={cur.snapshotPath || null} deviceId={cur.deviceId || null} deviceName={cur.deviceName || cam?.name || null}
                    instante={cur.timestamp} titulo={`🚨 ${m.label}${clase ? ` · ${clase}` : ""} · ${cur.deviceName || cam?.name || "Cámara"}`} lineas={lineasCompartir}
                    onCerrar={() => setCompartir(false)} />}
                {descarga && canalClip && ventanaClip && (
                    <DescargaClip instante={momento.getTime()} ventana={ventanaClip} onClose={() => setDescarga(false)} deviceId={cur.deviceId} camara={cur.deviceName || cam?.name || undefined}
                        poster={captura || undefined}
                        href={(antes, despues, instante) => `/api/nvr/playback?ch=${canalClip.ch}&t=${Math.floor(instante)}&pre=${antes}&dur=${antes + despues}&download=1${canalClip.nvr ? `&nvr=${canalClip.nvr}` : ""}`} />
                )}
            </div>

        </div>
    );
}

/** Una decisión sobre la detección. La grave (real) va en rojo: es la que dispara cosas. */
function BotonDecision({ children, onClick, icono: Ico, tecla, grave, activo }: { children: React.ReactNode; onClick: () => void; icono: any; tecla?: string; grave?: boolean; activo?: boolean }) {
    return (
        <button type="button" onClick={onClick} aria-pressed={activo}
            className={cn("inline-flex items-center gap-2 h-10 px-4 rounded-[8px] text-[13px] font-bold transition-colors",
                grave ? "pleno-mal hover:brightness-110" : activo ? "bg-white text-black border border-white" : "bg-white/10 hover:bg-white/20 text-white border border-white/15")}>
            <Ico size={16} /> {children}
            {tecla && <kbd className="ml-0.5 px-1.5 rounded bg-black/25 text-[10px] font-semibold">{tecla}</kbd>}
        </button>
    );
}

/** Un botón de ícono arriba, sobre la foto. Prendido = azul: es una elección que se mantiene. */
function BotonArriba({ children, onClick, title, activo }: { children: React.ReactNode; onClick: () => void; title: string; activo?: boolean }) {
    return (
        <button type="button" onClick={onClick} title={title} aria-label={title} aria-pressed={activo}
            className={cn("relative w-9 h-9 rounded-full flex items-center justify-center transition-colors",
                activo ? "bg-[var(--accion)] text-white" : "visor-vidrio text-white/80 hover:text-white")}>
            {children}
        </button>
    );
}

function BotonRiel({ children, onClick, title }: { children: React.ReactNode; onClick: () => void; title: string }) {
    return (
        <button type="button" onClick={onClick} title={title} aria-label={title}
            className="visor-vidrio w-9 h-9 rounded-full flex items-center justify-center text-white/85 hover:text-white">
            {children}
        </button>
    );
}

