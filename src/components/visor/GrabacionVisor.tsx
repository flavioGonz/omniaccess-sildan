"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Car, Check, ChevronLeft, ChevronRight, Crosshair, Download, Film, Loader2, Pause, Play, RefreshCw, SkipBack, SkipForward, VideoOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { fechaCorta, horaSeg } from "@/lib/fechas";
import { canalDe } from "@/components/video/VerGrabacion";
import { DescargaClip } from "@/components/video/DescargaClip";
import { Scrub, type MarcaScrub } from "@/components/Scrub";
import { eventosDeCamara, type EventoCamara } from "@/app/actions/history";

/**
 * La grabación del NVR, adentro del visor del evento.
 *
 * El botón de grabación abría OTRO visor (el de intrusión, con pestañas vivo / grabación /
 * evidencia) encima de éste: dos ventanas para mirar un instante, cada una con sus controles. Esto
 * es el mismo reproductor —la misma ruta al NVR, la misma espera de búfer, el mismo encadenado de
 * tramos (la lógica que se probó en LiveModal)— dibujado en el lugar de la foto, con una regla de
 * tiempo centrada en el evento.
 *
 * La regla es la misma rueda de tiempo del otro reproductor (components/Scrub), con el evento y
 * los pasos anteriores de la chapa por esta cámara marcados: tocar una marca va a ese instante.
 */

/** Cuánto video se pide al NVR por tramo (el tope de la ruta); al terminar se sigue solo desde donde quedó. */
const DUR_TRAMO_SEG = 180;
/** Si el tramo murió antes de esto, no era el final del tramo: no había grabación. */
const MIN_SEG_PARA_ENCADENAR = 3;
/** Búfer por delante antes de dar play, y a cuánto se arranca igual (ver LiveModal). */
const COLCHON_SEG = 1;
const ARRANQUE_FORZADO_MS = 600;
/**
 * Sin cuadros a los 28 s se da por perdido. El servidor ya espera el primer dato hasta 20 s y,
 * si no llega, contesta con el MOTIVO (ver api/nvr/playback): esto es sólo el tope del navegador.
 * Antes eran 9 s y dos reintentos a ciegas, y todo terminaba en «sin grabación en este horario»
 * aunque la grabación estuviera (18/10, canal 7 del NVR 6).
 */
const ESPERA_CUADRO_MS = 28_000;
/** Un solo reintento, y sólo cuando el motivo deja esperar algo de él (no cuando no hay grabación). */
const REINTENTOS = 1;
/** Hasta cuándo se espera saber si a esa hora se grabó, antes de pedir el video igual. */
const ESPERA_TRAMOS_MS = 4000;
/** Holgura al preguntar si un instante cae dentro de lo grabado (los archivos se cortan por hora). */
const HOLGURA_TRAMO_MS = 3000;
/** Se espera esto al arrastrar antes de pedir el tramo: un pedido por arrastre, no uno por píxel. */
const ASENTAR_MS = 300;
const VELOCIDADES = [1, 2, 4, 8];
/** El salto de los botones y de ← → . */
const SALTO_SEG = 10;
/** Esfumado de los bordes de la regla (%): a lo ancho del visor, el 22 del vivo la hacía ver cortada. */
const DIFUMINADO_REGLA = 7;
/**
 * Al saltar a un evento, el video arranca unos segundos ANTES (la ventana de Ajustes): sin esto,
 * la flecha «siguiente» volvería a encontrar el mismo evento, que todavía está adelante. El salto
 * queda anclado mientras el video ande cerca de ese evento.
 */
const ANCLA_DESPUES_MS = 30_000;
/** Dos eventos más cerca que esto, para las flechas, son el mismo. */
const MISMO_EVENTO_MS = 1500;

type Ventana = { antes: number; despues: number; topes: { antesMax: number; despuesMax: number; despuesMin: number } };
const VENTANA_INICIAL: Ventana = { antes: 10, despues: 10, topes: { antesMax: 60, despuesMax: 170, despuesMin: 3 } };

export function GrabacionVisor({ deviceId, camara, instanteMs, marcas = [], matricula, poster, clip, onClip }: {
    deviceId: string;
    camara?: string | null;
    /** El instante del evento: la grabación arranca ahí y la regla se centra ahí. */
    instanteMs: number;
    /** Otros momentos para marcar en la regla (pasos de la misma chapa por esta cámara). */
    marcas?: { ms: number; titulo: string }[];
    matricula?: string | null;
    poster?: string | null;
    /** El cajón del clip, si lo maneja quien monta el reproductor (el visor lo abre desde sus íconos de arriba). */
    clip?: boolean;
    onClip?: (abierto: boolean) => void;
}) {
    const [canal, setCanal] = useState<{ ch: number | null; nvr: string | null } | null>(null);
    useEffect(() => { let vivo = true; canalDe(deviceId).then((c) => { if (vivo) setCanal(c); }); return () => { vivo = false; }; }, [deviceId]);
    const [ventana, setVentana] = useState<Ventana>(VENTANA_INICIAL);
    useEffect(() => { fetch("/api/playback/ventana", { cache: "no-store" }).then((r) => r.json()).then((d) => { if (d && typeof d.antes === "number") setVentana(d); }).catch(() => { }); }, []);

    /** Dónde se pidió ir (inmediato) y el tramo que se está reproduciendo (asentado). */
    const [destino, setDestino] = useState(instanteMs);
    const [tramo, setTramo] = useState(instanteMs);
    useEffect(() => { const t = setTimeout(() => setTramo(destino), ASENTAR_MS); return () => clearTimeout(t); }, [destino]);
    const [reintento, setReintento] = useState(0);
    const [cargando, setCargando] = useState(true);
    /** Por qué no hay video, cuando no lo hay: lo que el NVR o la búsqueda de tramos dijeron. */
    const [fallo, setFallo] = useState<Fallo | null>(null);
    const sinGrabacion = fallo != null;
    /** Ya llegan bytes del video (el NVR entregó y ffmpeg está armando): el último paso de la entrada. */
    const [recibiendo, setRecibiendo] = useState(false);
    /** Segundos desde que se pidió el tramo: la entrada dice cuánto lleva, no gira en silencio. */
    const [espera, setEspera] = useState(0);
    /** Lo grabado en el canal ese día: undefined = preguntando, null = no se pudo saber. */
    const [tramos, setTramos] = useState<[number, number][] | null | undefined>(undefined);
    /** Tramos que el operador pidió intentar aunque la búsqueda diga que no hay grabación. */
    const [forzados, setForzados] = useState<number[]>([]);
    /** Reintento automático convirtiendo (tx=1): por si lo que falló fue la copia directa. El manual no convierte. */
    const [tx, setTx] = useState(false);
    const [rebufer, setRebufer] = useState(false);
    const [reproduciendo, setReproduciendo] = useState(false);
    const [velocidad, setVelocidad] = useState(1);
    const [posMs, setPosMs] = useState<number | null>(null);
    const [descargaPropia, setDescargaPropia] = useState(false);
    const descarga = clip ?? descargaPropia;
    const setDescarga = onClip ?? setDescargaPropia;
    // Los eventos de ESTA cámara alrededor del instante: para las flechas y para la regla.
    const [eventos, setEventos] = useState<EventoCamara[]>([]);
    useEffect(() => { let vivo = true; eventosDeCamara(deviceId, instanteMs).then((e) => { if (vivo) setEventos(e); }).catch(() => { }); return () => { vivo = false; }; }, [deviceId, instanteMs]);
    const ancla = useRef<number | null>(null);
    const video = useRef<HTMLVideoElement>(null);
    const intentos = useRef(0);
    const arranco = useRef(false);
    const pausadoAMano = useRef(false);
    const ultimaPos = useRef(0);

    // Lo grabado del día, antes de pedir el video: si a esa hora no hay nada se dice al toque.
    const diaTramo = new Date(tramo).toDateString();
    useEffect(() => {
        if (canal?.ch == null || !canal.nvr) return;
        let vivo = true;
        setTramos(undefined);
        const tope = setTimeout(() => { if (vivo) setTramos((t) => (t === undefined ? null : t)); }, ESPERA_TRAMOS_MS);
        fetch(`/api/nvr/tramos?nvr=${encodeURIComponent(canal.nvr)}&ch=${canal.ch}&t=${Math.floor(tramo)}`, { cache: "no-store" })
            .then((r) => (r.ok ? r.json() : null)).then((d) => { if (vivo) setTramos(Array.isArray(d?.tramos) ? d.tramos : null); })
            .catch(() => { if (vivo) setTramos(null); });
        return () => { vivo = false; clearTimeout(tope); };
    }, [canal?.ch, canal?.nvr, diaTramo]); // eslint-disable-line react-hooks/exhaustive-deps
    const cubierto = tramos == null ? null : tramos.some(([a, b]) => tramo >= a - HOLGURA_TRAMO_MS && tramo <= b + HOLGURA_TRAMO_MS);
    /** Lo grabado más cerca, para ofrecerlo cuando a esa hora no hay nada. */
    const cercanos = useMemo(() => {
        if (!tramos?.length) return { antes: null as number | null, despues: null as number | null };
        let antes: number | null = null, despues: number | null = null;
        for (const [a, b] of tramos) {
            if (b < tramo) antes = b;
            else if (a > tramo) { despues = a; break; }
        }
        return { antes, despues };
    }, [tramos, tramo]);
    const forzado = forzados.includes(tramo);
    const pedir = canal?.ch != null && !!canal.nvr && tramos !== undefined && (cubierto !== false || forzado);

    const url = pedir
        ? `/api/nvr/playback?ch=${canal!.ch}&t=${Math.floor(tramo)}&nvr=${canal!.nvr}&dur=${DUR_TRAMO_SEG}${tx ? "&tx=1" : ""}&r=${reintento}`
        : null;
    /** El video empieza «antes» segundos antes del instante pedido (Ajustes → Video del evento). */
    const inicioTramo = tramo - ventana.antes * 1000;

    const irA = useCallback((ms: number) => {
        const v = Math.min(Date.now() - 5000, ms);
        ancla.current = null;
        pausadoAMano.current = false; setPosMs(null); setDestino(v);
    }, []);
    const actual = posMs ?? destino;

    /** El evento anterior y el siguiente de esta cámara, contados desde lo que se mira (o desde el último salto). */
    const vecinos = useMemo(() => {
        const a = ancla.current;
        const anclado = a != null && actual >= a - (ventana.antes * 1000 + 5000) && actual <= a + ANCLA_DESPUES_MS;
        const desde = anclado ? a! : actual;
        let anterior: EventoCamara | null = null, siguiente: EventoCamara | null = null;
        for (const e of eventos) {
            if (e.ms < desde - MISMO_EVENTO_MS) anterior = e;
            else if (e.ms > desde + MISMO_EVENTO_MS) { siguiente = e; break; }
        }
        return { anterior, siguiente };
    }, [eventos, actual, ventana.antes]);
    const saltarA = useCallback((e: EventoCamara | null) => { if (!e) return; irA(e.ms); ancla.current = e.ms; }, [irA]);

    const intentarPlay = useCallback(() => {
        const v = video.current; if (!v || arranco.current || pausadoAMano.current) return;
        let colchon = 0; try { if (v.buffered.length) colchon = v.buffered.end(v.buffered.length - 1) - (v.currentTime || 0); } catch { }
        if (colchon >= COLCHON_SEG || v.readyState >= 4) v.play().catch(() => { });
    }, []);

    const fallar = useCallback((f: Fallo) => { setCargando(false); setFallo(f); }, []);
    // A esa hora el NVR no grabó (lo dijo la búsqueda de tramos): no se pide nada.
    useEffect(() => {
        if (cubierto === false && !forzado) fallar({ motivo: "sin-grabacion", fuente: "tramos" });
    }, [cubierto, forzado, tramo, fallar]);

    /**
     * El video no llegó: se le pregunta al servidor POR QUÉ (la misma URL contesta un JSON con el
     * motivo cuando no hay video). Un <video> no expone el estado HTTP, así que es la única
     * forma de distinguir «no hay grabación» de «el NVR no contesta».
     */
    const diagnosticar = useCallback(async (u: string): Promise<Fallo | null> => {
        const ac = new AbortController();
        const tope = setTimeout(() => ac.abort(), 25_000);
        try {
            const r = await fetch(u, { cache: "no-store", signal: ac.signal });
            if (r.ok) { ac.abort(); return null; } // ahora sí entrega: era pasajero
            const j = await r.json().catch(() => null);
            return { motivo: (j?.motivo as MotivoFallo) || "nvr-error", detalle: j?.detalle || null, fuente: "nvr" };
        } catch { return { motivo: "nvr-no-responde", fuente: "nvr" }; }
        finally { clearTimeout(tope); }
    }, []);
    const alFallarVideo = useCallback(async (u: string) => {
        const f = await diagnosticar(u);
        if (!f || ((f.motivo === "nvr-error" || f.motivo === "nvr-lento") && intentos.current < REINTENTOS)) {
            intentos.current++; setTx(true); setTimeout(() => setReintento((r) => r + 1), 400); return;
        }
        fallar(f);
    }, [diagnosticar, fallar]);

    // Cada tramo nuevo: se arranca de cero, con su espera y sus reintentos.
    useEffect(() => {
        if (!url) return;
        setCargando(true); setFallo(null); setRecibiendo(false); setEspera(0); setRebufer(false); setReproduciendo(false); arranco.current = false;
        const forzar = setTimeout(() => { const v = video.current; if (v && !arranco.current && !pausadoAMano.current) v.play().catch(() => { }); }, ARRANQUE_FORZADO_MS);
        const reloj = setInterval(() => setEspera((s) => s + 1), 1000);
        const tope = setTimeout(() => {
            const v = video.current;
            if (v && v.readyState < 2) {
                if (intentos.current < REINTENTOS) { intentos.current++; setTx(true); setReintento((r) => r + 1); }
                else fallar({ motivo: "nvr-lento", fuente: "nvr" });
            }
        }, ESPERA_CUADRO_MS);
        return () => { clearTimeout(forzar); clearTimeout(tope); clearInterval(reloj); };
    }, [tramo, reintento, url, fallar]);
    // Mientras se pregunta por los tramos también se está «cargando».
    useEffect(() => { if (!url && tramos === undefined) { setCargando(true); setFallo(null); } }, [url, tramos]);
    /** Volver a intentar el mismo instante, de cero (y aunque la búsqueda diga que no se grabó). */
    const reintentar = useCallback(() => {
        intentos.current = 0;
        if (fallo?.fuente === "tramos") setForzados((f) => [...f, tramo]);
        setTx(false); setFallo(null); setReintento((r) => r + 1);
    }, [fallo, tramo]);
    useEffect(() => { const v = video.current; if (v) try { v.playbackRate = velocidad; } catch { } }, [velocidad, tramo, reintento]);

    const alternar = useCallback(() => {
        const v = video.current; if (!v) return;
        if (v.paused) { pausadoAMano.current = false; v.play().catch(() => { }); } else { pausadoAMano.current = true; v.pause(); }
    }, []);
    // Teclas propias de la grabación: espacio, ← → (10 s), E (al evento). El visor de abajo no las toma en este modo.
    useEffect(() => {
        const k = (e: KeyboardEvent) => {
            const t = e.target as HTMLElement | null;
            if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
            if (descarga) return;
            if (e.key === " " || e.key === "k") { e.preventDefault(); alternar(); }
            else if (e.key === "ArrowLeft" && e.shiftKey) { e.preventDefault(); saltarA(vecinos.anterior); }
            else if (e.key === "ArrowRight" && e.shiftKey) { e.preventDefault(); saltarA(vecinos.siguiente); }
            else if (e.key === "ArrowLeft") { e.preventDefault(); irA(actual - SALTO_SEG * 1000); }
            else if (e.key === "ArrowRight") { e.preventDefault(); irA(actual + SALTO_SEG * 1000); }
            else if (e.key === "e" || e.key === "E") irA(instanteMs);
        };
        window.addEventListener("keydown", k);
        return () => window.removeEventListener("keydown", k);
    }, [alternar, irA, actual, instanteMs, descarga, saltarA, vecinos]);

    // La regla (la rueda de Scrub) trabaja en minutos del día, en la hora de este navegador, como LiveModal.
    const minutosDe = (ms: number) => { const d = new Date(ms); return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60; };
    const msDeMinutos = (min: number) => { const d = new Date(actual); d.setHours(0, 0, 0, 0); return d.getTime() + Math.round(min * 60) * 1000; };
    const marcasScrub = useMemo<MarcaScrub[]>(() => {
        const dia = new Date(instanteMs).toDateString();
        const pasos = marcas.filter((m) => new Date(m.ms).toDateString() === dia);
        // Los demás eventos de la cámara NO van como marcas: una lectora de portón tiene cientos
        // por día y la regla quedaba tapada de íconos (se probó). Para ellos están las flechas.
        return [
            { id: "evento", m: minutosDe(instanteMs), Icon: Crosshair, titulo: `El evento · ${horaSeg(instanteMs)}`, tono: "info" },
            ...pasos.map((m, i) => ({ id: `paso-${i}`, m: minutosDe(m.ms), Icon: Car, titulo: m.titulo, tono: "aviso" })),
        ];
    }, [marcas, instanteMs]); // eslint-disable-line react-hooks/exhaustive-deps
    const ancho = useRef<HTMLDivElement>(null);
    const [anchoRegla, setAnchoRegla] = useState(680);
    useEffect(() => {
        const el = ancho.current; if (!el) return;
        const ro = new ResizeObserver(() => setAnchoRegla(Math.max(280, el.clientWidth)));
        ro.observe(el); return () => ro.disconnect();
    }, []);

    if (canal && (canal.ch == null || !canal.nvr)) {
        return <div className="absolute inset-0 z-[8] grid place-items-center bg-muted dark:bg-black text-muted-foreground text-[13px]">Esta cámara no tiene un canal de NVR asignado: no hay grabación que mostrar.</div>;
    }

    /*
     * La grabación es IMAGEN, y lo que va sobre la imagen es oscuro (como la foto del historial):
     * escenario negro y controles de vidrio encima, sin bordes ni cajas (18/10, Nico: «no está bien
     * ocupando los espacios del modal el video; sin bordes, sin marcos, controles overlay, como los
     * del historial»). Antes el escenario seguía el tema y en claro el video quedaba entre dos
     * franjas blancas, con un velo blanco que tapaba el tercio de abajo. Ahora los costados que el
     * video no llena se rellenan con el mismo cuadro desenfocado (ambiente), y el velo de los
     * controles es oscuro y corto.
     */
    return (
        <div className="absolute inset-0 z-[8] bg-black overflow-hidden" onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
            {/* El ambiente: el cuadro desenfocado llena lo que el video (contain) no ocupa. */}
            {poster && (<>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={poster} alt="" aria-hidden className={cn("absolute inset-0 w-full h-full object-cover scale-125 transition-[filter,opacity] duration-500", cargando || sinGrabacion ? "blur-[18px] opacity-70" : "blur-[40px] opacity-45")} />
                <div className={cn("absolute inset-0 transition-colors duration-500", cargando || sinGrabacion ? "bg-black/30" : "bg-black/45")} />
            </>)}
            {url && (
                <video key={url} ref={video} src={url} muted playsInline preload="auto" onClick={alternar}
                    onPlay={() => setReproduciendo(true)} onPause={() => setReproduciendo(false)}
                    onLoadStart={() => setRecibiendo(false)} onLoadedMetadata={() => setRecibiendo(true)}
                    onLoadedData={() => { intentos.current = 0; setFallo(null); try { video.current!.playbackRate = velocidad; } catch { } intentarPlay(); }}
                    onCanPlay={intentarPlay} onProgress={() => { setRecibiendo(true); intentarPlay(); }}
                    onPlaying={() => { intentos.current = 0; arranco.current = true; setFallo(null); setRebufer(false); setCargando(false); }}
                    onWaiting={() => { if (arranco.current) setRebufer(true); else setCargando(true); }}
                    onTimeUpdate={(e) => {
                        if (rebufer) setRebufer(false);
                        const ms = inicioTramo + e.currentTarget.currentTime * 1000;
                        if (Math.abs(ms - ultimaPos.current) >= 400) { ultimaPos.current = ms; setPosMs(ms); }
                    }}
                    onEnded={() => {
                        const v = video.current; if (!v) return;
                        if (v.currentTime < MIN_SEG_PARA_ENCADENAR) { fallar({ motivo: "sin-grabacion", fuente: "nvr" }); return; }
                        const sig = inicioTramo + v.currentTime * 1000 + ventana.antes * 1000 + 100;
                        if (!pausadoAMano.current && sig < Date.now() - 15_000) irA(sig);
                    }}
                    onError={() => { if (url) alFallarVideo(url); }}
                    className={cn("absolute inset-0 w-full h-full object-contain cursor-pointer transition-opacity duration-300", cargando && !arranco.current ? "opacity-0" : "opacity-100")} />
            )}

            <AnimatePresence mode="wait">
                {(cargando || !canal) && !sinGrabacion && (
                    <EntradaGrabacion key="entrada" camara={camara} instante={tramo} canal={canal} tramos={tramos} cubierto={cubierto} pidiendo={!!url} recibiendo={recibiendo} espera={espera} reintento={reintento} />
                )}
                {fallo && (
                    <AvisoFallo key="fallo" fallo={fallo} camara={camara} instante={tramo} cercanos={cercanos} enEvento={Math.abs(tramo - instanteMs) < 1500}
                        onReintentar={reintentar} onIr={(ms) => irA(ms)} onEvento={() => irA(instanteMs)} antesSeg={ventana.antes} />
                )}
            </AnimatePresence>
            {/* El play grande del centro: está mientras el video está en pausa y se va al reproducir.
                Tocar el video en cualquier lado hace lo mismo (pausa y sigue). */}
            <AnimatePresence>
                {url && !reproduciendo && !cargando && !sinGrabacion && (
                    <motion.button key="play" type="button" onClick={alternar} title="Reproducir  ( espacio )" aria-label="Reproducir"
                        initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 1.25 }} transition={{ duration: 0.18 }}
                        className="absolute left-1/2 top-[42%] -translate-x-1/2 -translate-y-1/2 z-[2] w-[76px] h-[76px] rounded-full grid place-items-center bg-black/45 backdrop-blur-md border border-white/25 text-white hover:bg-black/60 hover:scale-105 transition-[background-color,transform]">
                        <Play size={32} className="ml-1" fill="currentColor" />
                    </motion.button>
                )}
            </AnimatePresence>
            {rebufer && !cargando && <span className="absolute top-20 left-1/2 -translate-x-1/2 px-2.5 py-1 rounded-[6px] bg-black/60 text-white/80 text-[11px] font-semibold pointer-events-none">Cargando…</span>}

            {/* ── Los controles, sobre la imagen: velo oscuro corto y vidrio sin bordes ── */}
            <div className="absolute inset-x-0 bottom-0 px-4 md:px-6 pb-3 pt-24 bg-[linear-gradient(to_top,rgba(0,0,0,.82)_0%,rgba(0,0,0,.55)_45%,transparent_100%)] text-white">
                <div className="flex items-center gap-2 mb-1">
                    {/* Atrás / adelante: al evento anterior o siguiente de esta cámara, como era su lógica original.
                        Los 10 s quedan en ← → del teclado. */}
                    <SaltoEvento lado="anterior" evento={vecinos.anterior} onClick={() => saltarA(vecinos.anterior)} />
                    <button type="button" onClick={alternar} disabled={!url} title={reproduciendo ? "Pausar  ( espacio )" : "Reproducir  ( espacio )"} aria-label={reproduciendo ? "Pausar" : "Reproducir"}
                        className="w-11 h-11 rounded-full bg-white text-black grid place-items-center hover:scale-105 active:scale-95 transition-transform disabled:opacity-40 shadow-[0_6px_20px_rgba(0,0,0,.35)]">
                        {cargando && !sinGrabacion ? <Loader2 size={18} className="animate-spin" /> : reproduciendo ? <Pause size={18} fill="currentColor" /> : <Play size={18} className="ml-0.5" fill="currentColor" />}
                    </button>
                    <SaltoEvento lado="siguiente" evento={vecinos.siguiente} onClick={() => saltarA(vecinos.siguiente)} />
                    <div className="ml-3 leading-tight [text-shadow:0_1px_8px_rgba(0,0,0,.6)]">
                        <div className="text-[19px] font-bold tabular-nums">{horaSeg(actual)}</div>
                        <div className="text-[11px] text-white/70 tabular-nums">{fechaCorta(actual)} · {diferencia(actual, instanteMs)}</div>
                    </div>
                    <div className="ml-auto flex items-center gap-1.5">
                        <BotonBarra onClick={() => irA(instanteMs)} title="Volver al instante del evento  ( E )"><Crosshair size={15} /> <span className="text-[12px] font-semibold">Evento</span></BotonBarra>
                        <span className="flex items-center rounded-full bg-white/10 backdrop-blur-md p-0.5">
                            {VELOCIDADES.map((v) => (
                                <button key={v} type="button" onClick={() => setVelocidad(v)} aria-pressed={velocidad === v}
                                    className={cn("h-7 min-w-[32px] px-2 rounded-full text-[11.5px] font-semibold tabular-nums transition-colors", velocidad === v ? "bg-white text-black" : "text-white/75 hover:text-white")}>{v}×</button>
                            ))}
                        </span>
                        <BotonBarra onClick={() => setDescarga(true)} title={`Bajar o mandar por WhatsApp un clip de este instante (${ventana.antes} s antes y ${ventana.despues} s después)`}><Download size={15} /> <span className="text-[12px] font-semibold">Clip</span></BotonBarra>
                    </div>
                </div>

                {/* La regla: la misma rueda del otro reproductor, a todo el ancho. Arrastrar va a otro minuto; las marcas, a su instante. */}
                <div ref={ancho} className="min-w-0">
                    <Scrub step="1" momentum={30} format="24h" width={anchoRegla} value={minutosDe(actual)} start={minutosDe(instanteMs)} difuminado={DIFUMINADO_REGLA}
                        onChange={(min) => irA(msDeMinutos(min))}
                        marcas={marcasScrub} onMarca={(k) => irA(k.id === "evento" ? instanteMs : msDeMinutos(k.m))} />
                </div>
            </div>

            {descarga && canal?.ch != null && canal.nvr && (
                <DescargaClip instante={actual} ventana={ventana} onClose={() => setDescarga(false)} deviceId={deviceId} camara={camara} matricula={matricula} poster={poster}
                    href={(antes, despues, instante) => `/api/nvr/playback?ch=${canal.ch}&t=${Math.floor(instante)}&pre=${antes}&dur=${antes + despues}&download=1&nvr=${canal.nvr}${matricula ? `&matricula=${encodeURIComponent(matricula)}` : ""}`} />
            )}
        </div>
    );
}

/**
 * Atrás / adelante del reproductor: al evento anterior / siguiente que detectó esta cámara
 * (accesos, lecturas, detecciones, lo que registró OmniVision). Dicen a qué hora está y qué fue;
 * apagadas si no hay. Antes eran ±10 s y las flechas de eventos iban aparte, a los costados de la
 * regla, con borde (18/10, Nico: «deben llevar a la hora del evento anterior o posterior»).
 */
function SaltoEvento({ lado, evento, onClick }: { lado: "anterior" | "siguiente"; evento: EventoCamara | null; onClick: () => void }) {
    const titulo = evento
        ? `${lado === "anterior" ? "Evento anterior" : "Evento siguiente"} de esta cámara · ${horaSeg(evento.ms)} · ${evento.titulo}  ( Shift ${lado === "anterior" ? "←" : "→"} )`
        : `No hay ${lado === "anterior" ? "eventos antes" : "eventos después"} en esta cámara (12 h)`;
    return (
        <button type="button" onClick={onClick} disabled={!evento} title={titulo} aria-label={titulo}
            className={cn("group h-9 rounded-full inline-flex items-center gap-1 bg-white/10 backdrop-blur-md text-white/90 hover:text-white hover:bg-white/20 disabled:opacity-30 disabled:hover:bg-white/10 transition-colors",
                lado === "anterior" ? "pl-2 pr-3" : "pl-3 pr-2")}>
            {lado === "anterior" && <SkipBack size={15} fill="currentColor" />}
            <span className="text-[11.5px] font-semibold tabular-nums">{evento ? horaSeg(evento.ms) : "—"}</span>
            {lado === "siguiente" && <SkipForward size={15} fill="currentColor" />}
        </button>
    );
}

function BotonBarra({ children, onClick, title }: { children: React.ReactNode; onClick: () => void; title: string }) {
    return (
        <button type="button" onClick={onClick} title={title} aria-label={title}
            className="h-8 px-3 rounded-full inline-flex items-center gap-1.5 bg-white/10 backdrop-blur-md text-white/85 hover:text-white hover:bg-white/20 transition-colors">
            {children}
        </button>
    );
}

/** «12 s antes del evento», «2 min 5 s después», «en el evento». */
function diferencia(ms: number, evento: number) {
    const s = Math.round((ms - evento) / 1000);
    if (Math.abs(s) < 1) return "en el evento";
    const a = Math.abs(s), m = Math.floor(a / 60), r = a % 60;
    const txt = m ? `${m} min${r ? ` ${r} s` : ""}` : `${r} s`;
    return `${txt} ${s < 0 ? "antes" : "después"} del evento`;
}

type MotivoFallo = "sin-grabacion" | "nvr-credenciales" | "nvr-no-responde" | "nvr-lento" | "sdp-cambiado" | "nvr-error";
/** Por qué no hay video. `fuente`: lo dijo la búsqueda de tramos (antes de pedir) o el NVR al pedir. */
type Fallo = { motivo: MotivoFallo; detalle?: string | null; fuente: "tramos" | "nvr" };

/**
 * La entrada de la grabación (18/10, Nico: «queda cargando, mejorá esta entrada antes de cargar
 * una grabación»). Antes era una línea girando —«Buscando la grabación en el NVR…»— sobre el
 * póster apagado, igual a los 2 s que a los 20, sin decir en qué estaba. Ahora son los pasos
 * reales del pedido, cada uno se tilda cuando pasa, y el que está en curso dice cuánto lleva:
 * ubicar la cámara en el NVR, confirmar que a esa hora se grabó, pedir el tramo, recibirlo.
 */
function EntradaGrabacion({ camara, instante, canal, tramos, cubierto, pidiendo, recibiendo, espera, reintento }: {
    camara?: string | null; instante: number; canal: { ch: number | null; nvr: string | null } | null;
    tramos: [number, number][] | null | undefined; cubierto: boolean | null; pidiendo: boolean; recibiendo: boolean; espera: number; reintento: number;
}) {
    const pasos: { texto: string; estado: "hecho" | "ahora" | "luego"; nota?: string }[] = [
        { texto: canal ? `Cámara ubicada${canal.ch != null ? ` · canal ${canal.ch}` : ""}` : "Ubicando la cámara en el NVR", estado: canal ? "hecho" : "ahora" },
        {
            texto: tramos === undefined ? "Confirmando que a esa hora se grabó" : cubierto ? "Hay grabación a esa hora" : "No se pudo confirmar: se intenta igual",
            estado: !canal ? "luego" : tramos === undefined ? "ahora" : "hecho",
        },
        { texto: recibiendo ? "El NVR entregó el tramo" : "Pidiendo el tramo al NVR", estado: !pidiendo ? "luego" : recibiendo ? "hecho" : "ahora", nota: pidiendo && !recibiendo && espera >= 2 ? `${espera} s` : undefined },
        { texto: "Armando el video", estado: recibiendo ? "ahora" : "luego" },
    ];
    return (
        <motion.div initial={{ opacity: 0, y: 8, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, scale: 0.98 }} transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="absolute inset-x-0 top-0 bottom-44 grid place-items-center pointer-events-none px-4">
            <div className="cajon-vidrio w-[min(360px,100%)] rounded-[14px] border border-border shadow-xl px-5 py-4">
                <div className="flex items-center gap-3">
                    <span className="relative w-10 h-10 shrink-0 grid place-items-center rounded-full bg-[var(--accion)]/12 text-[var(--accion)]">
                        <Film size={18} />
                        <span className="absolute inset-0 rounded-full border-2 border-[var(--accion)]/25 border-t-[var(--accion)] animate-spin [animation-duration:1.1s]" />
                    </span>
                    <div className="min-w-0 leading-tight">
                        <div className="text-[14px] font-bold text-foreground truncate">Grabación{camara ? ` · ${camara}` : ""}</div>
                        <div className="text-[12px] text-muted-foreground tabular-nums">{fechaCorta(instante)} · {horaSeg(instante)}{reintento > 0 ? " · otro intento" : ""}</div>
                    </div>
                </div>
                <ol className="mt-3.5 space-y-2">
                    {pasos.map((p, i) => (
                        <li key={i} className={cn("flex items-center gap-2.5 text-[12.5px]", p.estado === "luego" ? "text-muted-foreground/60" : p.estado === "ahora" ? "text-foreground font-semibold" : "text-muted-foreground")}>
                            <span className="w-4 h-4 shrink-0 grid place-items-center">
                                {p.estado === "hecho" ? <Check size={14} className="tono-bien" strokeWidth={3} />
                                    : p.estado === "ahora" ? <Loader2 size={14} className="animate-spin text-[var(--accion)]" />
                                        : <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40" />}
                            </span>
                            <span className="truncate">{p.texto}</span>
                            {p.nota && <span className="ml-auto text-[11px] text-muted-foreground font-normal tabular-nums">{p.nota}</span>}
                        </li>
                    ))}
                </ol>
            </div>
        </motion.div>
    );
}

/**
 * Cuando no hay video, decir POR QUÉ y qué se puede hacer. Antes todo terminaba en «Sin
 * grabación en este horario», incluso cuando la grabación estaba y lo que fallaba era el NVR
 * (18/10, canal 7 del NVR 6). Cada motivo tiene su frase, y lo grabado más cerca se ofrece
 * como botón en vez de «probá otro momento en la regla».
 */
const TEXTO_FALLO: Record<MotivoFallo, { titulo: string; cuerpo: string; reintentar: boolean }> = {
    "sin-grabacion": { titulo: "El NVR no grabó a esa hora", cuerpo: "No hay video de este momento en el disco del NVR.", reintentar: false },
    "nvr-credenciales": { titulo: "El NVR rechazó el usuario", cuerpo: "Revisar el usuario y la clave del NVR en Dispositivos.", reintentar: true },
    "nvr-no-responde": { titulo: "El NVR no contesta", cuerpo: "No llegó respuesta. Puede estar sin red o reiniciándose.", reintentar: true },
    "nvr-lento": { titulo: "El NVR no entregó el video a tiempo", cuerpo: "Contestó pero no mandó cuadros. Suele pasar cuando está atendiendo muchos pedidos.", reintentar: true },
    "sdp-cambiado": { titulo: "El NVR anuncia otro códec", cuerpo: "Se corrigió y se puede volver a intentar.", reintentar: true },
    "nvr-error": { titulo: "No se pudo reproducir este tramo", cuerpo: "El NVR contestó con un error.", reintentar: true },
};

function AvisoFallo({ fallo, camara, instante, cercanos, enEvento, antesSeg, onReintentar, onIr, onEvento }: {
    fallo: Fallo; camara?: string | null; instante: number; cercanos: { antes: number | null; despues: number | null };
    enEvento: boolean; antesSeg: number; onReintentar: () => void; onIr: (ms: number) => void; onEvento: () => void;
}) {
    const t = TEXTO_FALLO[fallo.motivo] || TEXTO_FALLO["nvr-error"];
    const sinGrab = fallo.motivo === "sin-grabacion";
    const boton = "h-8 px-3 rounded-[8px] inline-flex items-center gap-1.5 text-[12px] font-semibold border border-border text-foreground/85 hover:text-foreground hover:bg-muted transition-colors";
    return (
        <motion.div initial={{ opacity: 0, y: 8, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="absolute inset-x-0 top-0 bottom-44 grid place-items-center px-4">
            <div className="cajon-vidrio w-[min(400px,100%)] rounded-[14px] border border-border shadow-xl px-5 py-4">
                <div className="flex items-start gap-3">
                    <span className={cn("w-10 h-10 shrink-0 grid place-items-center rounded-full", sinGrab ? "chip-quieto" : "chip-aviso")}><VideoOff size={18} /></span>
                    <div className="min-w-0">
                        <div className="text-[15px] font-bold text-foreground leading-snug">{t.titulo}</div>
                        <div className="mt-0.5 text-[12.5px] text-muted-foreground">
                            {camara ? <span className="font-semibold text-foreground/80">{camara}</span> : "La cámara"} · <span className="tabular-nums">{fechaCorta(instante)} {horaSeg(instante)}</span>
                        </div>
                        <p className="mt-1.5 text-[12.5px] text-muted-foreground">{t.cuerpo}</p>
                        {fallo.detalle && !sinGrab && <p className="mt-1 text-[11px] text-muted-foreground/70 break-words line-clamp-2" title={fallo.detalle}>{fallo.detalle}</p>}
                    </div>
                </div>
                {sinGrab && (cercanos.antes != null || cercanos.despues != null) && (
                    <div className="mt-3.5">
                        <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground mb-1.5">Lo grabado más cerca</div>
                        <div className="grid grid-cols-2 gap-2">
                            <button type="button" disabled={cercanos.antes == null} onClick={() => cercanos.antes != null && onIr(cercanos.antes - 20_000)}
                                className="h-11 px-3 rounded-[10px] border border-border text-left hover:bg-muted disabled:opacity-35 transition-colors">
                                <div className="text-[10.5px] text-muted-foreground flex items-center gap-1"><ChevronLeft size={12} /> Termina</div>
                                <div className="text-[13px] font-bold tabular-nums text-foreground">{cercanos.antes != null ? horaSeg(cercanos.antes) : "—"}</div>
                            </button>
                            <button type="button" disabled={cercanos.despues == null} onClick={() => cercanos.despues != null && onIr(cercanos.despues + antesSeg * 1000)}
                                className="h-11 px-3 rounded-[10px] border border-border text-right hover:bg-muted disabled:opacity-35 transition-colors">
                                <div className="text-[10.5px] text-muted-foreground flex items-center justify-end gap-1">Empieza <ChevronRight size={12} /></div>
                                <div className="text-[13px] font-bold tabular-nums text-foreground">{cercanos.despues != null ? horaSeg(cercanos.despues) : "—"}</div>
                            </button>
                        </div>
                    </div>
                )}
                <div className="mt-3.5 flex items-center gap-2 flex-wrap">
                    {(t.reintentar || fallo.fuente === "tramos") && (
                        <button type="button" onClick={onReintentar}
                            className={cn("h-8 px-3 rounded-[8px] inline-flex items-center gap-1.5 text-[12px] font-semibold", t.reintentar ? "bg-[var(--accion)] text-white hover:brightness-110" : boton)}>
                            <RefreshCw size={13} /> {t.reintentar ? "Reintentar" : "Pedirlo igual"}
                        </button>
                    )}
                    {!enEvento && <button type="button" onClick={onEvento} className={boton}><Crosshair size={13} /> Volver al evento</button>}
                </div>
            </div>
        </motion.div>
    );
}
