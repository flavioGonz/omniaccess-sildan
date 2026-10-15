"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Play, Pause, SkipBack, SkipForward, Rewind, FastForward, ZoomIn, ZoomOut, Download, Radio, Loader2, CalendarDays, Clock } from "lucide-react";
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
 * La regla, mejorada respecto de la del visor:
 *  · Dice dónde HAY grabación (los tramos que informa el NVR) antes de tocarla. Antes un hueco
 *    se descubría esperando 9 s a que el NVR no mandara nada.
 *  · Tiene las detecciones y las lecturas de la cámara como marcas, y flechas para saltar a la
 *    anterior o a la siguiente: revisar una noche es ir de marca en marca, no arrastrar a ciegas.
 *  · Se arrastra (la hora queda fija en el centro y la regla corre debajo), se toca para saltar
 *    y se acerca o aleja de 24 h a 15 min.
 *  · Día y hora se eligen con sus campos; ±30 s con botones o con ← →; , y . saltan de marca.
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
/** Las escalas de la regla: cuánto tiempo entra a lo ancho, y cada cuánto va una raya y un rótulo. */
const ESCALAS = [
    { nombre: "24 h", span: 24 * 3600e3, raya: 3600e3, rotulo: 2 * 3600e3 },
    { nombre: "6 h", span: 6 * 3600e3, raya: 1800e3, rotulo: 3600e3 },
    { nombre: "1 h", span: 3600e3, raya: 300e3, rotulo: 600e3 },
    { nombre: "15 min", span: 900e3, raya: 60e3, rotulo: 300e3 },
] as const;
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
const fechaLarga = (ms: number) => new Date(ms).toLocaleDateString("es-UY", { timeZone: ZONA, weekday: "long", day: "numeric", month: "long" });

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
    const [escala, setEscala] = useState(2);
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

    // ── La regla ────────────────────────────────────────────────────────────────────
    const regla = useRef<HTMLDivElement>(null);
    const [ancho, setAncho] = useState(800);
    useLayoutEffect(() => {
        const el = regla.current; if (!el) return;
        const ro = new ResizeObserver(() => setAncho(el.clientWidth || 800));
        ro.observe(el); setAncho(el.clientWidth || 800);
        return () => ro.disconnect();
    }, []);
    const E = ESCALAS[escala];
    const msPorPx = E.span / Math.max(1, ancho);
    const [arrastre, setArrastre] = useState<{ x0: number; t0: number; t: number; movio: boolean } | null>(null);
    const centro = arrastre ? arrastre.t : ahora;
    const inicio = centro - E.span / 2;
    const xDe = (ms: number) => (ms - inicio) / msPorPx;
    const rayas = useMemo(() => {
        const out: { ms: number; rotulo: boolean }[] = [];
        for (let ms = Math.ceil(inicio / E.raya) * E.raya; ms <= inicio + E.span; ms += E.raya) {
            // Las rayas van en la hora del barrio: el desfase de la zona se corrige con el rótulo.
            out.push({ ms, rotulo: Math.round((ms - (msDe(partes(ms).dia, "00:00") || 0)) % E.rotulo) === 0 });
        }
        return out;
    }, [inicio, E]);
    const abajo = (e: React.PointerEvent) => { try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { } setArrastre({ x0: e.clientX, t0: centro, t: centro, movio: false }); };
    const mover = (e: React.PointerEvent) => {
        if (!arrastre) return;
        const dx = e.clientX - arrastre.x0;
        setArrastre({ ...arrastre, t: Math.min(Date.now(), arrastre.t0 - dx * msPorPx), movio: arrastre.movio || Math.abs(dx) > 4 });
    };
    const arriba = (e: React.PointerEvent) => {
        if (!arrastre) return;
        if (arrastre.movio) ir(arrastre.t);
        else {
            // Un toque sin arrastrar: salta a donde se tocó.
            const caja = (e.currentTarget as HTMLElement).getBoundingClientRect();
            ir(inicio + (e.clientX - caja.left) * msPorPx);
        }
        setArrastre(null);
    };

    const sigueVisible = visibles || !jugando || !!arrastre || estado !== "viendo";
    const hrefDescarga = (antes: number, despues: number, instante: number) => `/api/nvr/playback?ch=${c.ch}&t=${Math.floor(instante)}&pre=${antes}&dur=${antes + despues}&download=1&nvr=${encodeURIComponent(c.nvrId || "")}`;
    const p = partes(centro);

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

            {/* Abajo: la regla y los controles, sobre el video. */}
            <div className={cn("absolute bottom-0 inset-x-0 px-3 sm:px-6 pb-4 pt-16 bg-gradient-to-t from-black/90 via-black/55 to-transparent transition-opacity duration-300", !sigueVisible && "opacity-0 pointer-events-none")}>
                {/* La hora que se ve (o a la que se va, mientras se arrastra) */}
                <div className="flex items-baseline justify-center gap-3 mb-2 visor-sombra-texto">
                    <span className="text-[13px] text-white/70 capitalize">{fechaLarga(centro)}</span>
                    <span className="text-[26px] sm:text-[30px] font-bold tabular-nums text-white leading-none">{p.hora}</span>
                    {!arrastre && estado === "viendo" && !convertir && <span className="text-[12px] text-white/55" title="El servidor no la convierte: la pasa tal cual la grabó el NVR">H.265 directo</span>}
                </div>

                <div ref={regla} onPointerDown={abajo} onPointerMove={mover} onPointerUp={arriba} onPointerCancel={() => setArrastre(null)}
                    className="relative h-[64px] cursor-grab active:cursor-grabbing select-none touch-none overflow-hidden rounded-[10px] bg-white/[0.06]">
                    {/* Tramos con grabación */}
                    {linea?.tramos?.map(([a, b], i) => {
                        const x1 = Math.max(0, xDe(a)), x2 = Math.min(ancho, xDe(b));
                        return x2 > x1 ? <span key={i} className="absolute bottom-[18px] h-[6px] rounded-full bg-[color-mix(in_oklab,var(--bien)_70%,transparent)]" style={{ left: x1, width: x2 - x1 }} /> : null;
                    })}
                    {linea && !linea.tramos && <span className="absolute bottom-[18px] inset-x-0 h-[6px] rounded-full bg-white/15" title="El NVR no informa los tramos: se sabe si hay grabación al pedirla" />}
                    {/* Futuro: no se puede ir */}
                    {xDe(Date.now()) < ancho && <span className="absolute top-0 bottom-0 right-0 bg-black/40" style={{ left: Math.max(0, xDe(Date.now())) }} />}
                    {/* Rayas y rótulos */}
                    {rayas.map((r) => (
                        <span key={r.ms} className="absolute bottom-0 flex flex-col items-center" style={{ left: xDe(r.ms), transform: "translateX(-50%)" }}>
                            {r.rotulo && <span className="text-[10px] tabular-nums text-white/60 mb-0.5">{horaCorta(r.ms)}</span>}
                            <span className={cn("w-px", r.rotulo ? "h-3 bg-white/50" : "h-1.5 bg-white/30")} />
                        </span>
                    ))}
                    {/* Marcas: detecciones y lecturas */}
                    {eventos.map((e) => {
                        const x = xDe(e.ts); if (x < -8 || x > ancho + 8) return null;
                        const color = e.clase === "deteccion" ? "var(--mal)" : e.ok ? "var(--bien)" : "var(--mal)";
                        const titulo = e.clase === "deteccion" ? `${metaDe(e.tipo).label} · ${partes(e.ts).hora}` : `${e.plate || "Sin leer"} · ${e.tipo === "EXIT" ? "sale" : "entra"} · ${partes(e.ts).hora}`;
                        return (
                            <button key={e.id} type="button" title={titulo} aria-label={titulo}
                                onPointerDown={(ev) => ev.stopPropagation()} onClick={(ev) => { ev.stopPropagation(); irAMarca(e); }}
                                className="absolute top-1.5 w-5 h-6 -ml-2.5 grid place-items-start justify-center group" style={{ left: x }}>
                                <span className="block w-2.5 h-2.5 rotate-45 rounded-[2px] ring-1 ring-black/50 group-hover:scale-125 transition-transform" style={{ background: color }} />
                            </button>
                        );
                    })}
                    {/* El cursor: la hora de arriba es la de esta raya */}
                    <span className="absolute top-0 bottom-0 left-1/2 w-[2px] -ml-px bg-[var(--accion-en-oscuro)]" />
                </div>

                {/* Controles */}
                <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
                    <button type="button" onClick={alVivo} title="Volver al vivo"
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

                    <span className="visor-panel rounded-full p-1 inline-flex items-center gap-0.5">
                        <Boton onClick={() => setEscala((x) => Math.max(0, x - 1))} disabled={escala === 0} titulo="Ver más tiempo en la regla"><ZoomOut size={17} /></Boton>
                        <span className="text-[12px] font-semibold text-white/80 tabular-nums w-[44px] text-center">{E.nombre}</span>
                        <Boton onClick={() => setEscala((x) => Math.min(ESCALAS.length - 1, x + 1))} disabled={escala === ESCALAS.length - 1} titulo="Acercar la regla"><ZoomIn size={17} /></Boton>
                    </span>

                    <span className="visor-panel rounded-full p-1 inline-flex items-center">
                        <Boton onClick={() => setDescarga(true)} titulo="Exportar un clip de este momento"><Download size={17} /></Boton>
                    </span>

                    {eventos.length > 0 && (
                        <span className="hidden lg:inline-flex items-center gap-3 text-[12px] text-white/60 ml-1">
                            <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rotate-45 rounded-[1px] bg-[var(--mal)]" /> detección o no pasó</span>
                            {eventos.some((e) => e.clase === "lectura") && <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rotate-45 rounded-[1px] bg-[var(--bien)]" /> pasó</span>}
                            <span className="inline-flex items-center gap-1"><span className="w-3 h-1.5 rounded-full bg-[color-mix(in_oklab,var(--bien)_70%,transparent)]" /> hay grabación</span>
                        </span>
                    )}
                </div>
            </div>

            {descarga && <DescargaClip instante={ahora} ventana={ventana} href={hrefDescarga} onClose={() => setDescarga(false)} deviceId={deviceIdEnvio} camara={c.nombre} />}
        </>
    );
}

