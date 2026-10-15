"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Play, Pause, SkipBack, SkipForward, Rewind, FastForward, Download, Radio, Loader2, CalendarDays, Clock, Car } from "lucide-react";
import { Scrub, type MarcaScrub } from "@/components/Scrub";
import { metaDe } from "@/components/intrusion/comun";
import { DescargaClip, type VentanaClip } from "@/components/video/DescargaClip";
import { ZONA } from "@/lib/fechas";
import { Vivo, vivoDe, type Canal } from "./piezas";
import { cn } from "@/lib/utils";

/**
 * La grabación del canal, en el mismo cuadro donde se estaba viendo el vivo: sin ventana nueva.
 *
 * Por qué así (pedido 15/10): «Ver grabación» abría el visor de otra pantalla (LiveModal) encima
 * de la pared, con su marco y sus pestañas. Ahora el video del cuadro pasa a ser el de la
 * grabación y la regla se dibuja encima, abajo; el vivo queda chico en una esquina y un toque
 * vuelve a él.
 *
 * La regla es la misma rueda del visor (Scrub: la hora grande con sus dígitos, el cursor rojo,
 * se arrastra con inercia). Nico lo pidió así el 15/10 —«no estás usando la barra que
 * tenemos»— y con los controles ARRIBA de la regla, que queda al pie. Lo que se le sumó:
 *  · La franja de dónde HAY grabación (los tramos que informa el NVR), dibujada sobre los
 *    ticks: un hueco se ve antes de llegar. Antes se descubría esperando 9 s.
 *  · Las detecciones y las lecturas de la cámara como marcas (tono por resultado), y flechas
 *    para saltar a la anterior o a la siguiente: revisar una noche es ir de marca en marca.
 *  · Día y hora se eligen con sus campos; ±30 s con botones o ±10 s con ← →; , y . saltan de marca.
 *
 * El video: si el navegador reproduce H.265 se le pide la grabación tal cual (`hevc=1`) y el
 * servidor sólo la reempaqueta; si no arranca, se pide sin eso (el servidor la convierte). En
 * Safari se pide el clip entero (`whole=1`): el MP4 que se arma mientras llega no lo reproduce.
 */

/** Cuánto se pide al NVR de una vez; al terminar se sigue sola desde donde quedó. */
const TRAMO_SEG = 180;
/** En Safari el clip se arma entero antes de mandarlo: más corto, para que arranque antes. */
const TRAMO_SAFARI_SEG = 40;
/** Al saltar a una marca, cuánto antes de ella empieza el video: se ve llegar al que la causó. */
const ANTES_DE_MARCA_MS = 5000;
/** Sin cuadros en este tiempo, el tramo no vino: se reintenta convertido o se dice que no hay. */
const ESPERA_MS = 10_000;
/** El arrastre no pide nada al NVR hasta que la regla se queda quieta este tiempo. */
const ASENTAR_MS = 350;
const SALTO_MS = 30_000;
const VENTANA_POR_DEFECTO: VentanaClip = { antes: 10, despues: 10, topes: { antesMax: 60, despuesMax: 170, despuesMin: 3 } };

type Evento = { id: string; ts: number; clase: "deteccion" | "lectura"; tipo: string; plate: string | null; ok: boolean | null };
type Linea = { dia: string; desde: number; hasta: number; tramos: [number, number][] | null; eventos: Evento[] };

const partes = (ms: number) => {
    const f = new Intl.DateTimeFormat("en-CA", { timeZone: ZONA, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).formatToParts(new Date(ms));
    const g = (t: string) => f.find((x) => x.type === t)?.value || "00";
    return { dia: `${g("year")}-${g("month")}-${g("day")}`, hora: `${g("hour") === "24" ? "00" : g("hour")}:${g("minute")}:${g("second")}` };
};
/** «YYYY-MM-DD» + «HH:MM[:SS]» de la hora del barrio → ms. */
function msDe(dia: string, hora: string): number | null {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dia), h = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(hora);
    if (!m || !h) return null;
    const comoUtc = Date.UTC(+m[1], +m[2] - 1, +m[3], +h[1], +h[2], +(h[3] || 0));
    const p = partes(comoUtc);
    const [y, mo, d] = p.dia.split("-").map(Number), [hh, mi, ss] = p.hora.split(":").map(Number);
    return comoUtc - (Date.UTC(y, mo - 1, d, hh, mi, ss) - comoUtc);
}
const horaCorta = (ms: number) => partes(ms).hora.slice(0, 5);

function Boton({ children, onClick, titulo, disabled, grande, activo }: { children: React.ReactNode; onClick: () => void; titulo: string; disabled?: boolean; grande?: boolean; activo?: boolean }) {
    return (
        <button type="button" onClick={onClick} title={titulo} aria-label={titulo} disabled={disabled}
            className={cn("rounded-full grid place-items-center transition-colors disabled:opacity-30 disabled:pointer-events-none",
                grande ? "w-12 h-12" : "w-10 h-10",
                activo ? "bg-white text-black" : grande ? "bg-white/15 text-white hover:bg-white/25" : "text-white/85 hover:text-white hover:bg-white/15")}>
            {children}
        </button>
    );
}

export function Grabacion({ c, h265, hls, desdeMs, visibles, alVivo, deviceIdEnvio }: {
    c: Canal; h265: boolean; hls: boolean;
    /** Dónde arranca (el instante de la alerta, o un minuto atrás). */
    desdeMs: number;
    /** Los controles del cuadro están a la vista (el mouse se movió hace poco). */
    visibles: boolean;
    alVivo: () => void;
    /** Con cámara (y sesión) el cajón de exportar ofrece WhatsApp; sin ella, sólo bajar. */
    deviceIdEnvio?: string;
}) {
    const [t, setT] = useState(desdeMs);                 // el instante pedido
    const [cargaT, setCargaT] = useState(desdeMs);       // el que se le pidió al NVR (asentado)
    const [posMs, setPosMs] = useState<number | null>(null);
    const [jugando, setJugando] = useState(false);
    const [estado, setEstado] = useState<"buscando" | "viendo" | "sin">("buscando");
    const [convertir, setConvertir] = useState(!h265);
    const [intento, setIntento] = useState(0);
    const pausado = useRef(false);
    const video = useRef<HTMLVideoElement>(null);
    const [linea, setLinea] = useState<Linea | null>(null);
    const [descarga, setDescarga] = useState(false);
    const [ventana, setVentana] = useState<VentanaClip>(VENTANA_POR_DEFECTO);
    useEffect(() => { fetch("/api/playback/ventana", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((d) => { if (d && typeof d.antes === "number") setVentana(d); }).catch(() => { }); }, []);

    const ahora = posMs ?? t;
    const dia = partes(ahora).dia;

    // La regla del día que se mira: tramos con grabación y marcas.
    useEffect(() => {
        if (!c.nvrId || c.ch == null) return;
        let vivo = true;
        const q = new URLSearchParams({ nvr: c.nvrId, ch: String(c.ch), dia, ...(c.equipoId ? { equipo: c.equipoId } : {}) });
        fetch(`/api/monitor/camaras/linea?${q}`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((d) => { if (vivo && d) setLinea(d); }).catch(() => { });
        return () => { vivo = false; };
    }, [c.nvrId, c.ch, c.equipoId, dia]);

    // ¿Hay grabación en ese instante? null = no se sabe (NVR que no informa tramos).
    const hayEn = useCallback((ms: number) => {
        if (!linea?.tramos || ms < linea.desde || ms > linea.hasta) return null;
        return linea.tramos.some(([a, b]) => ms >= a - 2000 && ms <= b);
    }, [linea]);
    const proximoTramo = useMemo(() => linea?.tramos?.find(([a]) => a > t)?.[0] ?? null, [linea, t]);

    const ir = useCallback((ms: number) => {
        const v = Math.min(Date.now() - 5000, ms);
        pausado.current = false; setPosMs(null); setT(v);
    }, []);
    // El arrastre y los saltos seguidos no le piden al NVR cada paso: sólo donde se queda.
    useEffect(() => { setEstado("buscando"); const k = setTimeout(() => { setCargaT(t); setIntento(0); setConvertir(!h265); }, ASENTAR_MS); return () => clearTimeout(k); }, [t, h265]);

    const sinGrabacionAhi = hayEn(cargaT) === false;
    const url = c.nvrId && c.ch != null && !sinGrabacionAhi
        ? `/api/nvr/playback?ch=${c.ch}&nvr=${encodeURIComponent(c.nvrId)}&t=${Math.floor(cargaT)}&pre=0` + (hls ? `&whole=1&dur=${TRAMO_SAFARI_SEG}` : `&dur=${TRAMO_SEG}${convertir ? "" : "&hevc=1"}`)
        : null;
    useEffect(() => { if (sinGrabacionAhi) setEstado("sin"); }, [sinGrabacionAhi]);

    // Si a ESPERA_MS no llegó nada: primero se prueba convertido, después se dice que no hay.
    useEffect(() => {
        if (!url) return;
        setEstado("buscando"); setJugando(false);
        const k = setTimeout(() => {
            const v = video.current;
            if (v && v.readyState >= 2) return;
            if (!convertir && !hls) { setConvertir(true); setIntento((i) => i + 1); } else setEstado("sin");
        }, ESPERA_MS);
        return () => clearTimeout(k);
    }, [url, intento]); // eslint-disable-line react-hooks/exhaustive-deps

    const alternarPlay = useCallback(() => {
        const v = video.current; if (!v) return;
        if (v.paused) { pausado.current = false; v.play().catch(() => { }); } else { pausado.current = true; v.pause(); }
    }, []);

    // Marcas: anterior y siguiente respecto de donde está el video.
    const eventos = linea?.eventos || [];
    const siguiente = eventos.find((e) => e.ts - ANTES_DE_MARCA_MS > ahora + 1500) || null;
    const anterior = [...eventos].reverse().find((e) => e.ts - ANTES_DE_MARCA_MS < ahora - 3000) || null;
    const irAMarca = (e: Evento | null) => { if (e) ir(e.ts - ANTES_DE_MARCA_MS); };

    useEffect(() => {
        const k = (e: KeyboardEvent) => {
            const el = e.target as HTMLElement | null;
            if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) return;
            if (e.key === " ") { e.preventDefault(); alternarPlay(); }
            else if (e.key === "ArrowLeft") { e.preventDefault(); ir(ahora - 10_000); }
            else if (e.key === "ArrowRight") { e.preventDefault(); ir(ahora + 10_000); }
            else if (e.key === ",") irAMarca(anterior);
            else if (e.key === ".") irAMarca(siguiente);
        };
        window.addEventListener("keydown", k);
        return () => window.removeEventListener("keydown", k);
    });

    // ── La regla: la misma rueda del visor (Scrub), con los tramos y las marcas de este día ──
    const cajaRegla = useRef<HTMLDivElement>(null);
    const [ancho, setAncho] = useState(800);
    useLayoutEffect(() => {
        const el = cajaRegla.current; if (!el) return;
        const ro = new ResizeObserver(() => setAncho(el.clientWidth || 800));
        ro.observe(el); setAncho(el.clientWidth || 800);
        return () => ro.disconnect();
    }, []);
    const minutoDe = (ms: number) => { const [h, m, sg] = partes(ms).hora.split(":").map(Number); return h * 60 + m + sg / 60; };
    const tramosMin = useMemo(() => linea?.tramos?.map(([a, b]) => [a <= linea.desde ? 0 : minutoDe(a), b >= linea.hasta ? 1440 : minutoDe(b)] as [number, number]), [linea]); // eslint-disable-line react-hooks/exhaustive-deps
    const marcas = useMemo<MarcaScrub[]>(() => eventos.map((e) => {
        const det = e.clase === "deteccion";
        const hora = partes(e.ts).hora;
        return {
            id: e.id, m: minutoDe(e.ts), Icon: det ? metaDe(e.tipo).Icon : Car,
            titulo: det ? `${metaDe(e.tipo).label} · ${hora}` : `${e.plate || "Sin leer"} · ${e.tipo === "EXIT" ? "sale" : "entra"} · ${hora}`,
            tono: det ? "mal" : e.ok ? "bien" : "mal",
        };
    }), [eventos]); // eslint-disable-line react-hooks/exhaustive-deps
    const irAMarcaScrub = (k: MarcaScrub) => irAMarca(eventos.find((e) => e.id === k.id) || null);

    const sigueVisible = visibles || !jugando || estado !== "viendo";
    const hrefDescarga = (antes: number, despues: number, instante: number) => `/api/nvr/playback?ch=${c.ch}&t=${Math.floor(instante)}&pre=${antes}&dur=${antes + despues}&download=1&nvr=${encodeURIComponent(c.nvrId || "")}`;
    const p = partes(ahora);

    if (!c.nvrId || c.ch == null) {
        return <div className="absolute inset-0 grid place-items-center text-white/70 text-[16px] px-6 text-center">No se sabe en qué NVR graba esta cámara: no hay grabación para mostrar.</div>;
    }

    return (
        <>
            {url && (
                <video key={`${url}#${intento}`} ref={video} src={url} muted playsInline autoPlay preload="auto" disablePictureInPicture
                    onClick={alternarPlay}
                    onPlay={() => setJugando(true)} onPause={() => setJugando(false)}
                    onPlaying={() => { setEstado("viendo"); setJugando(true); }}
                    onLoadedData={() => { if (!pausado.current) video.current?.play().catch(() => { }); }}
                    onTimeUpdate={(e) => { const ms = cargaT + e.currentTarget.currentTime * 1000; if (Math.abs(ms - (posMs ?? 0)) >= 900) setPosMs(ms); }}
                    onEnded={(e) => {
                        // Terminó el tramo: se sigue desde donde quedó, salvo pausa o que haya muerto enseguida.
                        const v = e.currentTarget;
                        if (v.currentTime < 3) { setEstado("sin"); return; }
                        const sig = cargaT + v.currentTime * 1000 + 200;
                        if (!pausado.current && sig < Date.now() - 15_000) ir(sig);
                    }}
                    onError={() => { if (!convertir && !hls) { setConvertir(true); setIntento((i) => i + 1); } else setEstado("sin"); }}
                    className="absolute inset-0 w-full h-full object-contain cursor-pointer" />
            )}

            {/* El vivo, chico, en una esquina: un toque vuelve a él. */}
            <button type="button" onClick={alVivo} title="Volver al vivo"
                className={cn("absolute right-4 bottom-[200px] sm:bottom-[176px] w-[180px] sm:w-[240px] aspect-video rounded-[10px] overflow-hidden ring-1 ring-white/25 bg-black transition-opacity", !sigueVisible && "opacity-0 pointer-events-none")}>
                <Vivo src={vivoDe(c.stream, !h265, hls)} className="absolute inset-0 w-full h-full object-cover" />
                <span className="absolute top-1.5 left-1.5 inline-flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-bold text-white"><Radio size={11} className="text-[var(--mal)] animate-pulse" /> Vivo</span>
            </button>

            {/* Estado en el centro: buscando o sin grabación (con la salida). */}
            {estado !== "viendo" && (
                <div className="absolute inset-x-0 top-0 bottom-[190px] grid place-items-center pointer-events-none">
                    {estado === "buscando" ? (
                        <span className="inline-flex items-center gap-2 text-white text-[18px] font-bold visor-sombra-texto"><Loader2 size={20} className="animate-spin" /> Buscando la grabación en el NVR</span>
                    ) : (
                        <span className="flex flex-col items-center gap-2 text-center visor-sombra-texto pointer-events-auto">
                            <span className="text-white text-[18px] font-bold">Sin grabación a esta hora</span>
                            {proximoTramo != null && (
                                <button type="button" onClick={() => ir(proximoTramo)} className="h-10 px-4 rounded-full bg-white/15 hover:bg-white/25 text-white text-[14px] font-semibold">
                                    Ir a la próxima grabación · {horaCorta(proximoTramo)}
                                </button>
                            )}
                        </span>
                    )}
                </div>
            )}

            {/* Abajo, sobre el video: arriba los controles, y al pie la regla. */}
            <div className={cn("absolute bottom-0 inset-x-0 px-3 sm:px-6 pb-2 pt-16 bg-gradient-to-t from-black/90 via-black/55 to-transparent transition-opacity duration-300", !sigueVisible && "opacity-0 pointer-events-none")}>
                <div className="flex flex-wrap items-center justify-center gap-2">
                    <button type="button" onClick={alVivo} title="Volver al vivo  ( Esc )"
                        className="h-10 px-3.5 rounded-full visor-panel text-white text-[13px] font-semibold inline-flex items-center gap-1.5"><Radio size={14} className="text-[var(--mal)]" /> Vivo</button>

                    <span className="visor-panel rounded-full h-10 px-1 inline-flex items-center gap-1">
                        <label className="relative h-8 pl-2.5 pr-2 inline-flex items-center gap-1.5 rounded-full hover:bg-white/10 cursor-pointer text-white text-[13px] tabular-nums">
                            <CalendarDays size={14} className="text-white/60" /> {p.dia.split("-").reverse().join("/")}
                            <input type="date" value={p.dia} max={partes(Date.now()).dia} aria-label="Día"
                                onChange={(e) => { const ms = msDe(e.target.value, p.hora); if (ms) ir(ms); }}
                                className="absolute inset-0 opacity-0 cursor-pointer [color-scheme:dark]" />
                        </label>
                        <label className="h-8 pl-2.5 pr-1 inline-flex items-center gap-1.5 rounded-full hover:bg-white/10 text-white text-[13px]">
                            <Clock size={14} className="text-white/60" />
                            <input type="time" step={1} value={p.hora} aria-label="Hora"
                                onChange={(e) => { const ms = msDe(p.dia, e.target.value); if (ms) ir(ms); }}
                                className="bg-transparent tabular-nums outline-none [color-scheme:dark] w-[92px]" />
                        </label>
                    </span>

                    <span className="visor-panel rounded-full p-1 inline-flex items-center gap-0.5">
                        <Boton onClick={() => irAMarca(anterior)} disabled={!anterior} titulo={anterior ? `Evento anterior · ${partes(anterior.ts).hora}  ( , )` : "No hay eventos antes en este día"}><SkipBack size={18} /></Boton>
                        <Boton onClick={() => ir(ahora - SALTO_MS)} titulo="30 s atrás  ( ← 10 s )"><Rewind size={18} /></Boton>
                        <Boton onClick={alternarPlay} titulo={jugando ? "Pausar  ( espacio )" : "Reproducir  ( espacio )"} grande disabled={!url}>
                            {estado === "buscando" && url ? <Loader2 size={20} className="animate-spin" /> : jugando ? <Pause size={20} /> : <Play size={20} className="ml-0.5" />}
                        </Boton>
                        <Boton onClick={() => ir(ahora + SALTO_MS)} titulo="30 s adelante  ( → 10 s )" disabled={ahora + SALTO_MS > Date.now()}><FastForward size={18} /></Boton>
                        <Boton onClick={() => irAMarca(siguiente)} disabled={!siguiente} titulo={siguiente ? `Evento siguiente · ${partes(siguiente.ts).hora}  ( . )` : "No hay eventos después en este día"}><SkipForward size={18} /></Boton>
                    </span>

                    <span className="visor-panel rounded-full p-1 inline-flex items-center">
                        <Boton onClick={() => setDescarga(true)} titulo="Exportar un clip de este momento"><Download size={17} /></Boton>
                    </span>

                    <span className="hidden lg:inline-flex items-center gap-3 text-[12px] text-white/60 ml-1">
                        {estado === "viendo" && !convertir && <span title="El servidor no la convierte: la pasa tal cual la grabó el NVR">H.265 directo</span>}
                        {tramosMin && <span className="inline-flex items-center gap-1"><span className="w-3 h-1 rounded-full bg-[color-mix(in_oklab,var(--bien)_80%,transparent)]" /> hay grabación</span>}
                    </span>
                </div>

                {/* La regla de siempre (la del visor): la hora grande arriba, se arrastra, y las marcas se tocan. */}
                <div ref={cajaRegla} className="mt-1">
                    <Scrub step="1" momentum={30} format="24h" width={ancho} difuminado={8} value={minutoDe(ahora)} start={minutoDe(ahora)}
                        onChange={(mins) => { const ms = msDe(p.dia, `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(Math.round(mins) % 60).padStart(2, "0")}`); if (ms) ir(ms); }}
                        marcas={marcas} onMarca={irAMarcaScrub} tramos={tramosMin || undefined} />
                </div>
            </div>

            {descarga && <DescargaClip instante={ahora} ventana={ventana} href={hrefDescarga} onClose={() => setDescarga(false)} deviceId={deviceIdEnvio} camara={c.nombre} />}
        </>
    );
}

