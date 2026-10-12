"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Car, ChevronLeft, ChevronRight, Crosshair, Download, Loader2, Pause, Play, RotateCcw, RotateCw, ScanEye } from "lucide-react";
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
/** Sin cuadros a los 9 s se reintenta (dos veces); después, «sin grabación en este horario». */
const ESPERA_CUADRO_MS = 9000;
const REINTENTOS = 2;
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
    const [sinGrabacion, setSinGrabacion] = useState(false);
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

    const url = canal?.ch != null && canal.nvr
        ? `/api/nvr/playback?ch=${canal.ch}&t=${Math.floor(tramo)}&nvr=${canal.nvr}&dur=${DUR_TRAMO_SEG}${reintento > 0 ? "&tx=1" : ""}`
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

    // Cada tramo nuevo: se arranca de cero, con su espera y sus reintentos.
    useEffect(() => {
        setCargando(true); setSinGrabacion(false); setRebufer(false); setReproduciendo(false); arranco.current = false;
        const forzar = setTimeout(() => { const v = video.current; if (v && !arranco.current && !pausadoAMano.current) v.play().catch(() => { }); }, ARRANQUE_FORZADO_MS);
        const espera = setTimeout(() => {
            const v = video.current;
            if (v && v.readyState < 2) {
                if (intentos.current < REINTENTOS) { intentos.current++; setReintento((r) => r + 1); }
                else { setCargando(false); setSinGrabacion(true); }
            }
        }, ESPERA_CUADRO_MS);
        return () => { clearTimeout(forzar); clearTimeout(espera); };
    }, [tramo, reintento, url]);
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
        // Los eventos de la cámara van en gris: son contexto. El evento (azul) y los pasos de la
        // misma chapa (ámbar) ya tienen su marca; no se repiten.
        const yaMarcados = [instanteMs, ...pasos.map((m) => m.ms)];
        const deCamara = eventos.filter((e) => new Date(e.ms).toDateString() === dia && !yaMarcados.some((ms) => Math.abs(ms - e.ms) < MISMO_EVENTO_MS));
        return [
            { id: "evento", m: minutosDe(instanteMs), Icon: Crosshair, titulo: `El evento · ${horaSeg(instanteMs)}`, tono: "info" },
            ...pasos.map((m, i) => ({ id: `paso-${i}`, m: minutosDe(m.ms), Icon: Car, titulo: m.titulo, tono: "aviso" })),
            ...deCamara.map((e) => ({ id: `cam-${e.ms}`, m: minutosDe(e.ms), Icon: e.tipo === "deteccion" ? ScanEye : Car, titulo: `${e.titulo} · ${horaSeg(e.ms)}`, tono: "quieto" })),
        ];
    }, [marcas, instanteMs, eventos]); // eslint-disable-line react-hooks/exhaustive-deps
    const ancho = useRef<HTMLDivElement>(null);
    const [anchoRegla, setAnchoRegla] = useState(680);
    useEffect(() => {
        const el = ancho.current; if (!el) return;
        const ro = new ResizeObserver(() => setAnchoRegla(Math.max(280, el.clientWidth)));
        ro.observe(el); return () => ro.disconnect();
    }, []);

    if (canal && (canal.ch == null || !canal.nvr)) {
        return <div className="absolute inset-0 z-[8] grid place-items-center bg-black text-white/60 text-[13px]">Esta cámara no tiene un canal de NVR asignado: no hay grabación que mostrar.</div>;
    }

    return (
        <div className="absolute inset-0 z-[8] bg-black" onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {poster && cargando && <img src={poster} alt="" className="absolute inset-0 w-full h-full object-contain blur-[6px] brightness-[0.4] scale-105" />}
            {url && (
                <video key={`${url}#${reintento}`} ref={video} src={url} muted playsInline preload="auto" onClick={alternar}
                    onPlay={() => setReproduciendo(true)} onPause={() => setReproduciendo(false)}
                    onLoadedData={() => { intentos.current = 0; setSinGrabacion(false); try { video.current!.playbackRate = velocidad; } catch { } intentarPlay(); }}
                    onCanPlay={intentarPlay} onProgress={intentarPlay}
                    onPlaying={() => { intentos.current = 0; arranco.current = true; setSinGrabacion(false); setRebufer(false); setCargando(false); }}
                    onWaiting={() => { if (arranco.current) setRebufer(true); else setCargando(true); }}
                    onTimeUpdate={(e) => {
                        if (rebufer) setRebufer(false);
                        const ms = inicioTramo + e.currentTarget.currentTime * 1000;
                        if (Math.abs(ms - ultimaPos.current) >= 400) { ultimaPos.current = ms; setPosMs(ms); }
                    }}
                    onEnded={() => {
                        const v = video.current; if (!v) return;
                        if (v.currentTime < MIN_SEG_PARA_ENCADENAR) { setCargando(false); setSinGrabacion(true); return; }
                        const sig = inicioTramo + v.currentTime * 1000 + ventana.antes * 1000 + 100;
                        if (!pausadoAMano.current && sig < Date.now() - 15_000) irA(sig);
                    }}
                    onError={() => { if (intentos.current < REINTENTOS) { intentos.current++; setTimeout(() => setReintento((r) => r + 1), 800); } else { setCargando(false); setSinGrabacion(true); } }}
                    className="absolute inset-0 w-full h-full object-contain cursor-pointer" />
            )}

            {(cargando || !canal) && !sinGrabacion && (
                <div className="absolute inset-x-0 top-0 bottom-60 grid place-items-center pointer-events-none">
                    <span className="flex items-center gap-2 text-white/85 text-[14px] font-semibold drop-shadow"><Loader2 size={16} className="animate-spin" /> Buscando la grabación en el NVR…</span>
                </div>
            )}
            {sinGrabacion && (
                <div className="absolute inset-x-0 top-0 bottom-60 grid place-items-center pointer-events-none text-center">
                    <span><span className="block text-white text-[16px] font-bold">Sin grabación en este horario</span><span className="block text-white/55 text-[12px] mt-1">Probá otro momento en la regla.</span></span>
                </div>
            )}
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

            {/* ── La barra: controles y regla ── */}
            <div className="absolute inset-x-0 bottom-0 px-5 md:px-7 pb-4 pt-20 bg-gradient-to-t from-black/90 via-black/55 to-transparent">
                <div className="flex items-center gap-2 mb-2.5">
                    <button type="button" onClick={alternar} disabled={!url} title={reproduciendo ? "Pausar  ( espacio )" : "Reproducir  ( espacio )"}
                        className="w-10 h-10 rounded-full bg-white text-black grid place-items-center hover:brightness-95 disabled:opacity-40">
                        {cargando && !sinGrabacion ? <Loader2 size={17} className="animate-spin" /> : reproduciendo ? <Pause size={17} /> : <Play size={17} className="ml-0.5" />}
                    </button>
                    <BotonBarra onClick={() => irA(actual - SALTO_SEG * 1000)} title={`Atrás ${SALTO_SEG} s  ( ← )`}><RotateCcw size={15} /><span className="text-[10px] font-bold tabular-nums">{SALTO_SEG}</span></BotonBarra>
                    <BotonBarra onClick={() => irA(actual + SALTO_SEG * 1000)} title={`Adelante ${SALTO_SEG} s  ( → )`}><span className="text-[10px] font-bold tabular-nums">{SALTO_SEG}</span><RotateCw size={15} /></BotonBarra>
                    <div className="ml-2 leading-tight">
                        <div className="text-[18px] font-bold tabular-nums text-white">{horaSeg(actual)}</div>
                        <div className="text-[11px] text-white/55 tabular-nums">{fechaCorta(actual)} · {diferencia(actual, instanteMs)}</div>
                    </div>
                    <div className="ml-auto flex items-center gap-1.5">
                        <BotonBarra onClick={() => irA(instanteMs)} title="Volver al instante del evento  ( E )"><Crosshair size={15} /> <span className="text-[11.5px] font-semibold">Evento</span></BotonBarra>
                        <span className="w-px h-5 bg-white/15 mx-1" />
                        <span className="flex items-center rounded-full bg-white/[0.07] border border-white/12 p-0.5">
                            {VELOCIDADES.map((v) => (
                                <button key={v} type="button" onClick={() => setVelocidad(v)} aria-pressed={velocidad === v}
                                    className={cn("h-7 min-w-[30px] px-2 rounded-full text-[11px] font-semibold tabular-nums", velocidad === v ? "bg-white text-black" : "text-white/70 hover:text-white")}>{v}×</button>
                            ))}
                        </span>
                        <span className="w-px h-5 bg-white/15 mx-1" />
                        <BotonBarra onClick={() => setDescarga(true)} title={`Bajar o mandar por WhatsApp un clip de este instante (${ventana.antes} s antes y ${ventana.despues} s después)`}><Download size={15} /> <span className="text-[11.5px] font-semibold">Clip</span></BotonBarra>
                    </div>
                </div>

                {/* La regla: la misma rueda del otro reproductor. Arrastrar va a otro minuto; las marcas, a su instante. */}
                <div className="flex items-end gap-2">
                    <FlechaEvento lado="anterior" evento={vecinos.anterior} onClick={() => saltarA(vecinos.anterior)} />
                    <div ref={ancho} className="flex-1 min-w-0">
                        <Scrub step="1" momentum={30} format="24h" width={anchoRegla} value={minutosDe(actual)} start={minutosDe(instanteMs)} difuminado={DIFUMINADO_REGLA}
                            onChange={(min) => irA(msDeMinutos(min))}
                            marcas={marcasScrub} onMarca={(k) => irA(k.id === "evento" ? instanteMs : msDeMinutos(k.m))} />
                    </div>
                    <FlechaEvento lado="siguiente" evento={vecinos.siguiente} onClick={() => saltarA(vecinos.siguiente)} />
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
 * Las flechas a los costados de la regla: al evento anterior / siguiente que detectó esta cámara
 * (accesos, lecturas, detecciones). Dicen a qué hora está y qué fue; apagadas si no hay.
 */
function FlechaEvento({ lado, evento, onClick }: { lado: "anterior" | "siguiente"; evento: EventoCamara | null; onClick: () => void }) {
    const titulo = evento
        ? `${lado === "anterior" ? "Evento anterior" : "Evento siguiente"} de esta cámara · ${horaSeg(evento.ms)} · ${evento.titulo}  ( Shift ${lado === "anterior" ? "←" : "→"} )`
        : `No hay ${lado === "anterior" ? "eventos antes" : "eventos después"} en esta cámara (12 h)`;
    return (
        <button type="button" onClick={onClick} disabled={!evento} title={titulo} aria-label={titulo}
            className="mb-[22px] shrink-0 w-11 h-11 rounded-full grid place-items-center border border-white/15 bg-white/[0.06] text-white/85 hover:text-white hover:bg-white/15 disabled:opacity-25 disabled:hover:bg-white/[0.06] transition-colors">
            {lado === "anterior" ? <ChevronLeft size={20} /> : <ChevronRight size={20} />}
        </button>
    );
}

function BotonBarra({ children, onClick, title }: { children: React.ReactNode; onClick: () => void; title: string }) {
    return (
        <button type="button" onClick={onClick} title={title} aria-label={title}
            className="h-8 px-2.5 rounded-[8px] inline-flex items-center gap-1 text-white/85 hover:text-white hover:bg-white/10 border border-white/12">
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
