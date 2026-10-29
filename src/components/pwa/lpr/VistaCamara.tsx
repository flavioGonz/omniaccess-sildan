"use client";
/**
 * Una cámara a pantalla completa, como en Protect: el video arriba y, abajo, la línea de tiempo de
 * las últimas 24 h que se arrastra con el dedo. Soltar en un punto pide la grabación del NVR desde
 * ese momento; volver al extremo derecho es volver al vivo. Las lecturas de la cámara están sobre la
 * línea (un trazo por chapa, del color del resultado) y en la lista de abajo: tocar una lleva el
 * video a unos segundos antes de esa lectura.
 *
 * Antes la app sólo mostraba el vivo y la última chapa: para ver qué pasó hacía falta ir al panel.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Camera, Minus, Plus, Radio, Scissors } from "lucide-react";
import { cn } from "@/lib/utils";
import { getAccessEvents } from "@/app/actions/history";
import { horaSeg, hora, fecha } from "@/lib/fechas";
import { FilaLectura, FotoEvento, Hoja, RESULTADO, VivoCanal, chapaDe, fotoEvento, resultado } from "./piezas";

const HORA_MS = 3_600_000;
const VENTANA_MS = 24 * HORA_MS;
/** Píxeles por hora de cada nivel de acercamiento: el día entero, unas horas, una hora, minutos. */
const ZOOM = [40, 120, 480, 1800];
/** Lo que se pide al NVR de una vez; al terminar, sigue con el tramo siguiente. */
const TRAMO_SEG = 120;
/** A menos de esto del presente, soltar la línea es volver al vivo. */
const MARGEN_VIVO_MS = 20_000;
/** Cuánto antes de una lectura arranca el video al tocarla. */
const ANTES_LECTURA_MS = 4_000;
const MAX_LECTURAS = 300;

type Canal = { ch: number; nvr: string | null } | null;

export function VistaCamara({ camara, abierta, alCerrar, desde }: {
    camara: { id: string; name: string } | null;
    abierta: boolean;
    alCerrar: () => void;
    /** Abrir directamente en este instante (una lectura tocada en Eventos). */
    desde?: number | null;
}) {
    const [ahora, setAhora] = useState(() => Date.now());
    const inicio = ahora - VENTANA_MS;
    const [zoom, setZoom] = useState(1);
    const pxh = ZOOM[zoom];
    const [canal, setCanal] = useState<Canal | undefined>(undefined);
    const [tramos, setTramos] = useState<[number, number][] | null>(null);
    const [lecturas, setLecturas] = useState<any[]>([]);
    /** null = en vivo; un número = la grabación desde ese instante. */
    const [reproduce, setReproduce] = useState<number | null>(null);
    const [cursor, setCursor] = useState<number>(Date.now());
    const [activa, setActiva] = useState<string | null>(null);
    const [estadoVideo, setEstadoVideo] = useState<string>("");
    const scroller = useRef<HTMLDivElement>(null);
    const ancho = useRef(360);
    const tocando = useRef(false);
    const programado = useRef(false);
    const espera = useRef<any>(null);
    const video = useRef<HTMLVideoElement>(null);

    // El reloj de la línea: avanza solo, así el vivo siempre queda al final.
    useEffect(() => { if (!abierta) return; const iv = setInterval(() => setAhora(Date.now()), 5000); return () => clearInterval(iv); }, [abierta]);

    // Canal del NVR, tramos grabados y lecturas de la cámara.
    useEffect(() => {
        if (!abierta || !camara) return;
        let vivo = true;
        setCanal(undefined); setTramos(null); setLecturas([]); setActiva(null);
        fetch(`/api/nvr/channel?deviceId=${camara.id}`, { cache: "no-store" }).then((r) => r.json()).then(async (d) => {
            if (!vivo) return;
            const ch = d?.channel != null ? Number(d.channel) : null;
            const c: Canal = ch ? { ch, nvr: d?.nvr ? String(d.nvr) : null } : null;
            setCanal(c);
            if (!c?.nvr) return;
            const pedir = (t: number) => fetch(`/api/nvr/tramos?nvr=${c.nvr}&ch=${c.ch}&t=${t}`, { cache: "no-store" }).then((r) => r.json()).then((j) => j?.tramos as [number, number][] | null).catch(() => null);
            const [hoy, ayer] = await Promise.all([pedir(Date.now()), pedir(Date.now() - VENTANA_MS)]);
            if (!vivo) return;
            if (hoy == null && ayer == null) { setTramos(null); return; }
            const todos = [...(ayer || []), ...(hoy || [])].sort((a, b) => a[0] - b[0]);
            const unidos: [number, number][] = [];
            for (const x of todos) { const u = unidos[unidos.length - 1]; if (u && x[0] <= u[1] + 2000) u[1] = Math.max(u[1], x[1]); else unidos.push([x[0], x[1]]); }
            setTramos(unidos);
        }).catch(() => { if (vivo) setCanal(null); });
        getAccessEvents({ deviceIds: [camara.id], from: new Date(Date.now() - VENTANA_MS), take: MAX_LECTURAS, type: "PLATE", omitEnrichment: true })
            .then((r: any) => { if (vivo) setLecturas((r?.events || []) as any[]); }).catch(() => {});
        return () => { vivo = false; };
    }, [abierta, camara]);

    const xDe = useCallback((t: number) => ((t - inicio) / HORA_MS) * pxh, [inicio, pxh]);
    const tDe = useCallback((scrollLeft: number) => Math.min(ahora, Math.max(inicio, inicio + (scrollLeft / pxh) * HORA_MS)), [inicio, ahora, pxh]);

    /** Lleva la línea a un instante sin que cuente como un arrastre del usuario. */
    const llevarA = useCallback((t: number, suave = false) => {
        const el = scroller.current; if (!el) return;
        programado.current = true;
        el.scrollTo({ left: xDe(t), behavior: suave ? "smooth" : "auto" });
        setTimeout(() => { programado.current = false; }, suave ? 500 : 60);
    }, [xDe]);

    // Al abrir: al vivo, o al instante pedido.
    useEffect(() => {
        if (!abierta) return;
        const t = desde ?? null;
        setReproduce(t); setCursor(t ?? Date.now());
        requestAnimationFrame(() => { ancho.current = scroller.current?.clientWidth || 360; llevarA(t ?? Date.now()); });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [abierta, desde, camara?.id]);

    // En vivo, la línea acompaña al reloj. Al cambiar el acercamiento, se queda donde estaba.
    useEffect(() => { if (abierta && reproduce == null && !tocando.current) llevarA(ahora); }, [ahora, pxh]); // eslint-disable-line react-hooks/exhaustive-deps
    useEffect(() => { if (abierta && reproduce != null) llevarA(cursor); }, [pxh]); // eslint-disable-line react-hooks/exhaustive-deps

    const alDesplazar = () => {
        const el = scroller.current; if (!el || programado.current) return;
        const t = tDe(el.scrollLeft);
        setCursor(t);
        clearTimeout(espera.current);
        espera.current = setTimeout(() => {
            if (tocando.current) return;
            setActiva(null);
            setReproduce(t >= Date.now() - MARGEN_VIVO_MS ? null : t);
        }, 450);
    };
    const soltar = () => { tocando.current = false; alDesplazar(); };

    const irA = (t: number, id?: string) => { setActiva(id || null); setReproduce(t); setCursor(t); llevarA(t, true); };
    const alVivo = () => { setActiva(null); setReproduce(null); setCursor(Date.now()); llevarA(Date.now(), true); };

    // La grabación avanza: la línea la sigue (si nadie la está tocando) y al terminar pide el tramo siguiente.
    const alAvanzar = () => {
        const v = video.current; if (!v || reproduce == null || tocando.current) return;
        const t = reproduce + v.currentTime * 1000;
        setCursor(t); llevarA(t);
    };
    const alTerminar = () => { if (reproduce == null) return; const sig = reproduce + TRAMO_SEG * 1000; if (sig >= Date.now() - MARGEN_VIVO_MS) alVivo(); else setReproduce(sig); };

    const enVivo = reproduce == null;
    const urlGrabacion = canal && reproduce != null
        ? `/api/nvr/playback?ch=${canal.ch}&t=${Math.floor(reproduce)}&pre=0&dur=${TRAMO_SEG}${canal.nvr ? `&nvr=${canal.nvr}` : ""}`
        : null;
    const urlClip = canal && !enVivo
        ? `/api/nvr/playback?ch=${canal.ch}&t=${Math.floor(cursor)}&pre=5&dur=20&download=1${canal.nvr ? `&nvr=${canal.nvr}` : ""}`
        : null;
    // Sin grabador, tocar una lectura muestra su foto.
    const lecturaSinVideo = canal === null && activa ? lecturas.find((e) => e.id === activa) : null;

    const horas = useMemo(() => {
        const paso = pxh < 80 ? 3 : 1;
        const out: number[] = [];
        const h0 = new Date(inicio); h0.setMinutes(0, 0, 0);
        for (let t = h0.getTime() + HORA_MS; t <= ahora; t += HORA_MS) if (new Date(t).getHours() % paso === 0) out.push(t);
        return out;
    }, [inicio, ahora, pxh]);

    const anchoTotal = (VENTANA_MS / HORA_MS) * pxh;
    const lado = ancho.current / 2;
    const lecturasOrden = useMemo(() => [...lecturas].sort((a, b) => +new Date(b.timestamp) - +new Date(a.timestamp)), [lecturas]);

    return (
        <Hoja abierta={abierta} alCerrar={alCerrar}>
            {/* Encabezado */}
            <header className="shrink-0 flex items-center gap-2 px-2 pt-[max(0.5rem,env(safe-area-inset-top))] pb-2 border-b border-border">
                <button type="button" onClick={alCerrar} aria-label="Volver" className="w-10 h-10 grid place-items-center rounded-full active:bg-muted"><ArrowLeft size={20} /></button>
                <div className="min-w-0 flex-1">
                    <div className="text-[15px] font-semibold truncate">{camara?.name}</div>
                    <div className="text-[11.5px] text-muted-foreground tabular-nums">
                        {enVivo ? "En vivo" : `Grabación · ${fecha(new Date(cursor))} ${horaSeg(new Date(cursor))}`}
                    </div>
                </div>
                {urlClip && (
                    <a href={urlClip} className="h-9 px-3 rounded-full border border-border text-[12.5px] font-semibold flex items-center gap-1.5 active:bg-muted">
                        <Scissors size={14} /> Clip
                    </a>
                )}
                {camara && (
                    <a href={`/api/snapshot/${camara.id}?t=${ahora}`} download={`${camara.name}.jpg`} aria-label="Guardar foto" className="w-9 h-9 grid place-items-center rounded-full border border-border active:bg-muted"><Camera size={15} /></a>
                )}
            </header>

            {/* Video */}
            <div className="shrink-0 relative w-full aspect-video bg-black">
                {camara && enVivo && <VivoCanal deviceId={camara.id} className="absolute inset-0 w-full h-full" alEstado={(s) => setEstadoVideo(s === "foto" ? "Sin video: foto cada 4 s" : "")} />}
                {camara && !enVivo && urlGrabacion && (
                    <video key={urlGrabacion} ref={video} src={urlGrabacion} className="absolute inset-0 w-full h-full object-contain" autoPlay muted playsInline controls={false}
                        onTimeUpdate={alAvanzar} onEnded={alTerminar}
                        onWaiting={() => setEstadoVideo("Pidiendo la grabación al grabador…")} onPlaying={() => setEstadoVideo("")}
                        onError={() => setEstadoVideo("El grabador no devolvió video para ese momento")} />
                )}
                {camara && !enVivo && !urlGrabacion && (
                    lecturaSinVideo
                        ? <FotoEvento src={fotoEvento(lecturaSinVideo.snapshotPath)} className="absolute inset-0 w-full h-full object-contain" />
                        : <div className="absolute inset-0 grid place-items-center text-white/60 text-[12.5px] px-6 text-center">{canal === undefined ? "Buscando el grabador…" : "Esta cámara no tiene grabador asociado: se ve la foto de cada lectura."}</div>
                )}
                <div className="absolute top-2 left-2 flex items-center gap-1.5 px-2 py-0.5 rounded-[6px] bg-black/60 text-white text-[10.5px] font-semibold">
                    {enVivo ? <><span className="w-1.5 h-1.5 rounded-full bg-[var(--mal)] animate-pulse" />EN VIVO</> : <>GRABACIÓN</>}
                </div>
                {estadoVideo && <div className="absolute bottom-2 inset-x-2 text-center text-[11.5px] text-white/85"><span className="px-2 py-1 rounded-[6px] bg-black/60">{estadoVideo}</span></div>}
            </div>

            {/* Línea de tiempo */}
            <div className="shrink-0 border-b border-border bg-card">
                <div className="flex items-center justify-between px-3 pt-2">
                    <span className="text-[13px] font-semibold tabular-nums">{hora(new Date(cursor))}<span className="text-muted-foreground font-normal">:{String(new Date(cursor).getSeconds()).padStart(2, "0")}</span></span>
                    <div className="flex items-center gap-1">
                        <button type="button" onClick={() => setZoom((z) => Math.max(0, z - 1))} disabled={zoom === 0} aria-label="Alejar" className="w-8 h-8 grid place-items-center rounded-full border border-border disabled:opacity-40"><Minus size={14} /></button>
                        <button type="button" onClick={() => setZoom((z) => Math.min(ZOOM.length - 1, z + 1))} disabled={zoom === ZOOM.length - 1} aria-label="Acercar" className="w-8 h-8 grid place-items-center rounded-full border border-border disabled:opacity-40"><Plus size={14} /></button>
                        <button type="button" onClick={alVivo} disabled={enVivo}
                            className={cn("h-8 px-3 rounded-full text-[12px] font-semibold flex items-center gap-1.5 border", enVivo ? "border-transparent pleno-mal" : "border-border")}>
                            <Radio size={13} /> En vivo
                        </button>
                    </div>
                </div>
                <div className="relative h-[78px] mt-1">
                    <div ref={scroller} onScroll={alDesplazar}
                        onPointerDown={() => { tocando.current = true; }} onPointerUp={soltar} onPointerCancel={soltar}
                        onTouchStart={() => { tocando.current = true; }} onTouchEnd={soltar}
                        className="absolute inset-0 overflow-x-auto overflow-y-hidden [&::-webkit-scrollbar]:hidden touch-pan-x">
                        <div className="relative h-full" style={{ width: anchoTotal + 2 * lado }}>
                            {/* Lo grabado */}
                            <div className="absolute h-[8px] top-[40px] rounded-full bg-muted" style={{ left: lado, width: anchoTotal }} />
                            {(tramos || []).map(([a, b], i) => {
                                const x0 = Math.max(0, xDe(a)), x1 = Math.min(anchoTotal, xDe(b));
                                return x1 > x0 ? <div key={i} className="absolute h-[8px] top-[40px] pleno-bien opacity-70" style={{ left: lado + x0, width: Math.max(2, x1 - x0) }} /> : null;
                            })}
                            {/* Las lecturas */}
                            {lecturas.map((e) => {
                                const t = +new Date(e.timestamp); if (t < inicio) return null;
                                return (
                                    <button key={e.id} type="button" aria-label={`Lectura ${chapaDe(e) || "sin chapa"}`} onClick={() => irA(t - ANTES_LECTURA_MS, e.id)}
                                        className="absolute top-[6px] w-[14px] h-[30px] -ml-[7px] grid place-items-center" style={{ left: lado + xDe(t) }}>
                                        <span className={cn("block w-[3px] h-[20px] rounded-full", RESULTADO[resultado(e)].punto)} />
                                    </button>
                                );
                            })}
                            {/* Las horas */}
                            {horas.map((t) => (
                                <div key={t} className="absolute top-[52px] -translate-x-1/2 text-[10px] tabular-nums text-muted-foreground" style={{ left: lado + xDe(t) }}>
                                    <div className="mx-auto w-px h-[5px] bg-border mb-0.5" />{String(new Date(t).getHours()).padStart(2, "0")}:00
                                </div>
                            ))}
                        </div>
                    </div>
                    {/* La aguja: fija en el centro, la línea se mueve debajo. */}
                    <div className="pointer-events-none absolute top-[4px] bottom-[18px] left-1/2 -ml-px w-[2px] rounded-full bg-[var(--accion)]" />
                </div>
                <div className="px-3 pb-2 flex items-center gap-3 text-[10.5px] text-muted-foreground">
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full pleno-bien opacity-70" />Grabado</span>
                    <span className="flex items-center gap-1"><span className="w-[3px] h-2.5 rounded-full pleno-bien" />Permitido</span>
                    <span className="flex items-center gap-1"><span className="w-[3px] h-2.5 rounded-full pleno-mal" />Denegado</span>
                    <span className="flex items-center gap-1"><span className="w-[3px] h-2.5 rounded-full pleno-quieto" />Sin lectura</span>
                    {tramos === null && canal !== undefined && <span className="ml-auto">{canal ? "Sin datos del grabador" : "Sin grabador"}</span>}
                </div>
            </div>

            {/* Lecturas de la cámara */}
            <div className="flex-1 min-h-0 overflow-y-auto [&::-webkit-scrollbar]:hidden px-3 py-3 space-y-1.5 pb-[max(1rem,env(safe-area-inset-bottom))]">
                <div className="flex items-baseline justify-between px-0.5 pb-1">
                    <span className="text-[13px] font-semibold">Lecturas · últimas 24 h</span>
                    <span className="text-[11.5px] text-muted-foreground tabular-nums">{lecturas.length}{lecturas.length >= MAX_LECTURAS ? "+" : ""}</span>
                </div>
                {lecturasOrden.length === 0
                    ? <div className="text-center text-[12.5px] text-muted-foreground py-10">Sin lecturas en las últimas 24 horas.</div>
                    : lecturasOrden.map((e) => (
                        <FilaLectura key={e.id} e={e} sinCamara activa={activa === e.id} hora={horaSeg(new Date(e.timestamp))}
                            alTocar={() => irA(+new Date(e.timestamp) - ANTES_LECTURA_MS, e.id)} />
                    ))}
            </div>
        </Hoja>
    );
}
