"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Crosshair, Download, Loader2, Pause, Play, RotateCcw, RotateCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { fechaCorta, hora, horaSeg } from "@/lib/fechas";
import { canalDe } from "@/components/video/VerGrabacion";
import { DescargaClip } from "@/components/video/DescargaClip";

/**
 * La grabación del NVR, adentro del visor del evento.
 *
 * El botón de grabación abría OTRO visor (el de intrusión, con pestañas vivo / grabación /
 * evidencia) encima de éste: dos ventanas para mirar un instante, cada una con sus controles. Esto
 * es el mismo reproductor —la misma ruta al NVR, la misma espera de búfer, el mismo encadenado de
 * tramos (la lógica que se probó en LiveModal)— dibujado en el lugar de la foto, con una regla de
 * tiempo centrada en el evento.
 *
 * La regla es una VENTANA alrededor del evento, no el día entero: lo que se quiere al revisar un
 * acceso son los minutos de antes y de después. Tres anchos (±2 min, ±10 min, ±1 h) y el evento
 * marcado siempre; tocar o arrastrar sobre la regla salta a ese instante.
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
/** Los anchos de la regla, en minutos a cada lado del evento. */
const ANCHOS = [{ min: 2, rotulo: "±2 min" }, { min: 10, rotulo: "±10 min" }, { min: 60, rotulo: "±1 h" }];
const VELOCIDADES = [1, 2, 4, 8];
/** El salto de los botones y de ← → . */
const SALTO_SEG = 10;

type Ventana = { antes: number; despues: number; topes: { antesMax: number; despuesMax: number; despuesMin: number } };
const VENTANA_INICIAL: Ventana = { antes: 10, despues: 10, topes: { antesMax: 60, despuesMax: 170, despuesMin: 3 } };

export function GrabacionVisor({ deviceId, camara, instanteMs, marcas = [], matricula, poster }: {
    deviceId: string;
    camara?: string | null;
    /** El instante del evento: la grabación arranca ahí y la regla se centra ahí. */
    instanteMs: number;
    /** Otros momentos para marcar en la regla (pasos de la misma chapa por esta cámara). */
    marcas?: { ms: number; titulo: string }[];
    matricula?: string | null;
    poster?: string | null;
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
    const [ancho, setAncho] = useState(0);
    const [posMs, setPosMs] = useState<number | null>(null);
    const [descarga, setDescarga] = useState(false);
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
        pausadoAMano.current = false; setPosMs(null); setDestino(v);
    }, []);
    const actual = posMs ?? destino;

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
            else if (e.key === "ArrowLeft") { e.preventDefault(); irA(actual - SALTO_SEG * 1000); }
            else if (e.key === "ArrowRight") { e.preventDefault(); irA(actual + SALTO_SEG * 1000); }
            else if (e.key === "e" || e.key === "E") irA(instanteMs);
        };
        window.addEventListener("keydown", k);
        return () => window.removeEventListener("keydown", k);
    }, [alternar, irA, actual, instanteMs, descarga]);

    // La regla: una ventana centrada en el evento (y corrida si el cursor se sale).
    const mitad = ANCHOS[ancho].min * 60_000;
    const [centro, setCentro] = useState(instanteMs);
    useEffect(() => { if (actual < centro - mitad || actual > centro + mitad) setCentro(actual); }, [actual, centro, mitad]);
    useEffect(() => { setCentro(Math.abs(actual - instanteMs) < mitad ? instanteMs : actual); }, [ancho]); // eslint-disable-line react-hooks/exhaustive-deps
    const desde = centro - mitad, hasta = centro + mitad;
    const pct = (ms: number) => ((ms - desde) / (hasta - desde)) * 100;
    const marcasRegla = useMemo(() => {
        const paso = ancho === 0 ? 60_000 : ancho === 1 ? 2 * 60_000 : 10 * 60_000; // los rótulos son hh:mm: más fino que un minuto se repiten
        const out: number[] = [];
        for (let t = Math.ceil(desde / paso) * paso; t <= hasta; t += paso) out.push(t);
        return out;
    }, [desde, hasta, ancho]);
    const regla = useRef<HTMLDivElement>(null);
    const [arrastre, setArrastre] = useState<number | null>(null);
    const msDe = (clientX: number) => {
        const r = regla.current!.getBoundingClientRect();
        return desde + Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * (hasta - desde);
    };

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
                <div className="absolute inset-x-0 top-0 bottom-32 grid place-items-center pointer-events-none">
                    <span className="flex items-center gap-2 text-white/85 text-[14px] font-semibold drop-shadow"><Loader2 size={16} className="animate-spin" /> Buscando la grabación en el NVR…</span>
                </div>
            )}
            {sinGrabacion && (
                <div className="absolute inset-x-0 top-0 bottom-32 grid place-items-center pointer-events-none text-center">
                    <span><span className="block text-white text-[16px] font-bold">Sin grabación en este horario</span><span className="block text-white/55 text-[12px] mt-1">Probá otro momento en la regla.</span></span>
                </div>
            )}
            {rebufer && !cargando && <span className="absolute top-20 left-1/2 -translate-x-1/2 px-2.5 py-1 rounded-[6px] bg-black/60 text-white/80 text-[11px] font-semibold pointer-events-none">Cargando…</span>}

            {/* ── La barra: controles y regla ── */}
            <div className="absolute inset-x-0 bottom-0 px-5 md:px-7 pb-4 pt-14 bg-gradient-to-t from-black/90 via-black/55 to-transparent">
                <div className="flex items-center gap-2 mb-2.5">
                    <button type="button" onClick={alternar} disabled={!url} title={reproduciendo ? "Pausar  ( espacio )" : "Reproducir  ( espacio )"}
                        className="w-10 h-10 rounded-full bg-white text-black grid place-items-center hover:brightness-95 disabled:opacity-40">
                        {cargando && !sinGrabacion ? <Loader2 size={17} className="animate-spin" /> : reproduciendo ? <Pause size={17} /> : <Play size={17} className="ml-0.5" />}
                    </button>
                    <BotonBarra onClick={() => irA(actual - SALTO_SEG * 1000)} title={`Atrás ${SALTO_SEG} s  ( ← )`}><RotateCcw size={15} /><span className="text-[10px] font-bold tabular-nums">{SALTO_SEG}</span></BotonBarra>
                    <BotonBarra onClick={() => irA(actual + SALTO_SEG * 1000)} title={`Adelante ${SALTO_SEG} s  ( → )`}><span className="text-[10px] font-bold tabular-nums">{SALTO_SEG}</span><RotateCw size={15} /></BotonBarra>
                    <div className="ml-2 leading-tight">
                        <div className="text-[18px] font-bold tabular-nums text-white">{horaSeg(arrastre ?? actual)}</div>
                        <div className="text-[11px] text-white/55 tabular-nums">{fechaCorta(arrastre ?? actual)} · {diferencia(arrastre ?? actual, instanteMs)}</div>
                    </div>
                    <div className="ml-auto flex items-center gap-1.5">
                        <BotonBarra onClick={() => irA(instanteMs)} title="Volver al instante del evento  ( E )"><Crosshair size={15} /> <span className="text-[11.5px] font-semibold">Evento</span></BotonBarra>
                        <span className="w-px h-5 bg-white/15 mx-1" />
                        {/* Elegir uno: píldoras. */}
                        <span className="flex items-center rounded-full bg-white/[0.07] border border-white/12 p-0.5">
                            {ANCHOS.map((a, i) => (
                                <button key={a.min} type="button" onClick={() => setAncho(i)} aria-pressed={ancho === i}
                                    className={cn("h-7 px-2.5 rounded-full text-[11px] font-semibold tabular-nums", ancho === i ? "bg-white text-black" : "text-white/70 hover:text-white")}>{a.rotulo}</button>
                            ))}
                        </span>
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

                {/* La regla. Tocar o arrastrar salta; el evento siempre marcado. */}
                <div ref={regla} className="relative h-9 cursor-pointer select-none touch-none"
                    onPointerDown={(e) => { (e.target as HTMLElement).setPointerCapture?.(e.pointerId); setArrastre(msDe(e.clientX)); }}
                    onPointerMove={(e) => { if (arrastre != null) setArrastre(msDe(e.clientX)); }}
                    onPointerUp={(e) => { if (arrastre != null) { irA(msDe(e.clientX)); setArrastre(null); } }}
                    onPointerCancel={() => setArrastre(null)}>
                    <div className="absolute inset-x-0 top-[14px] h-[6px] rounded-full bg-white/15" />
                    {/* Lo ya visto del tramo, hasta el cursor. */}
                    <div className="absolute top-[14px] h-[6px] rounded-full bg-white/35" style={{ left: `${Math.max(0, pct(inicioTramo))}%`, width: `${Math.max(0, Math.min(100, pct(actual)) - Math.max(0, pct(inicioTramo)))}%` }} />
                    {marcasRegla.map((t) => (
                        <span key={t} className="absolute top-[24px] -translate-x-1/2 text-[9.5px] text-white/40 tabular-nums" style={{ left: `${pct(t)}%` }}>{horaCorta(t)}</span>
                    ))}
                    {marcas.filter((m) => m.ms >= desde && m.ms <= hasta).map((m) => (
                        <span key={m.ms} title={m.titulo} className="absolute top-[11px] w-[3px] h-3 -translate-x-1/2 rounded-full bg-white/60" style={{ left: `${pct(m.ms)}%` }} />
                    ))}
                    {instanteMs >= desde && instanteMs <= hasta && (
                        <span title={`El evento · ${horaSeg(instanteMs)}`} className="absolute top-[7px] -translate-x-1/2 w-[3px] h-5 rounded-full" style={{ left: `${pct(instanteMs)}%`, background: "var(--visor-tono, var(--accion))" }} />
                    )}
                    {/* El cursor. */}
                    <span className="absolute top-[9px] -translate-x-1/2 w-4 h-4 rounded-full bg-white border-2 border-black/40 pointer-events-none" style={{ left: `${Math.min(100, Math.max(0, pct(arrastre ?? actual)))}%` }} />
                </div>
            </div>

            {descarga && canal?.ch != null && canal.nvr && (
                <DescargaClip instante={actual} ventana={ventana} onClose={() => setDescarga(false)} deviceId={deviceId} camara={camara} matricula={matricula}
                    href={(antes, despues, instante) => `/api/nvr/playback?ch=${canal.ch}&t=${Math.floor(instante)}&pre=${antes}&dur=${antes + despues}&download=1&nvr=${canal.nvr}${matricula ? `&matricula=${encodeURIComponent(matricula)}` : ""}`} />
            )}
        </div>
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

const horaCorta = (ms: number) => hora(ms);
/** «12 s antes del evento», «2 min 5 s después», «en el evento». */
function diferencia(ms: number, evento: number) {
    const s = Math.round((ms - evento) / 1000);
    if (Math.abs(s) < 1) return "en el evento";
    const a = Math.abs(s), m = Math.floor(a / 60), r = a % 60;
    const txt = m ? `${m} min${r ? ` ${r} s` : ""}` : `${r} s`;
    return `${txt} ${s < 0 ? "antes" : "después"} del evento`;
}
