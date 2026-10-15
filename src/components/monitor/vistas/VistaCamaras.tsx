"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Server, VideoOff, ChevronLeft, ChevronRight, Pause, Play, X, History, Cpu, Image as ImageIcon, Loader2 } from "lucide-react";
import { useMarco } from "@/components/monitor/MarcoMonitor";
import { usarDatos, horaCorta, hace, usarReloj } from "@/lib/monitor/cliente";
import { useTiempoReal } from "@/lib/tiempo-real";
import { metaDe } from "@/components/intrusion/comun";
import { SUAVE, tocable, usarInactividad, CuentaAtras } from "@/components/monitor/tactil";
import { VerGrabacion } from "@/components/video/VerGrabacion";
import LiveEdgeKeeper from "@/components/LiveEdgeKeeper";
import { cn } from "@/lib/utils";

/**
 * La pared de video: todos los canales de los NVR y las cámaras sueltas, en mosaico.
 *
 * El problema de fondo (medido el 15/10 en San Nicolás): todos los subflujos son H.265 a
 * 640×360. Un navegador que no decodifica H.265 necesita que el servidor convierta cada canal
 * a H.264 con su CPU — veinte canales a la vez es dejar al servidor sin aire para la lectura
 * de matrículas. Entonces cada pantalla decide por sí misma, al abrir:
 *
 *  · Si el navegador reproduce H.265 (Chrome o Edge en Windows con decodificación por
 *    hardware), todas las baldosas van en vivo DIRECTO: go2rtc sólo reempaqueta, no
 *    convierte. Costo en el servidor: casi nada.
 *  · Si no, a lo sumo MAX_CONVERTIDOS baldosas van en vivo convertido (las que detectan
 *    primero) y el resto muestra una foto que se renueva. Cada baldosa dice cuál de las tres
 *    cosas es: una foto con aire de vivo sería una pantalla que miente.
 *
 * El mosaico (2×2 a 5×5), la pausa y el filtro por NVR se guardan en ESTE navegador: una
 * pantalla de pared no tiene sesión y su enlace sólo lee, así que no puede guardar en el
 * servidor. Con ?grilla=4 en el enlace, la pantalla arranca en 4×4.
 */

/** Cada cuánto se repite la lista de canales (y las detecciones de los últimos minutos). */
const INTERVALO_MS = 30_000;
/** Tope de baldosas convertidas por pantalla cuando el navegador no reproduce H.265. */
const MAX_CONVERTIDOS = 4;
/** Cadencia de la foto en las baldosas que no van en vivo. */
const FOTO_MS = 8000;
/** Sin imagen en este tiempo, el vivo se da por fallido y la baldosa pasa a foto. */
const VIVO_ESPERA_MS = 12_000;
/** La ficha grande se cierra sola: nadie tiene que acordarse de cerrarla en una pared. */
const FICHA_SE_CIERRA_MS = 2 * 60_000;
/** Cuánto antes de "ahora" arranca la grabación si no hay detección de referencia. */
const GRABACION_ANTES_MS = 60_000;
const GRILLAS = [2, 3, 4, 5] as const;
type Grilla = (typeof GRILLAS)[number];
const PAGINA_SEG = [10, 20, 40] as const;
const PREFS_CLAVE = "omni.pared-camaras.v1";
/** El códec que se pregunta: H.265 Main, nivel 3.1 (alcanza para 640×360 y sobra). */
const TIPOS_H265 = ['video/mp4; codecs="hvc1.1.6.L93.B0"', 'video/mp4; codecs="hev1.1.6.L93.B0"'];

type Alerta = { id: string; tipo: string; ts: string };
type Canal = { clave: string; nombre: string; nvrId: string | null; nvr: string | null; ch: number | null; online: boolean | null; stream: string; equipoId: string | null; alerta: Alerta | null };
type Datos = { canales: Canal[]; errores: { nvr: string; error: string }[]; go2rtc: boolean; ventanaAlertaMs: number; ahora: string };
type Prefs = { grilla: Grilla; pagSeg: number; pausa: boolean; nvr: string };
type Modo = "directo" | "convertido" | "foto";

function reproduceH265(): boolean {
    try {
        const v = document.createElement("video");
        const ms = (window as any).MediaSource;
        return TIPOS_H265.some((t) => v.canPlayType(t) === "probably" || !!ms?.isTypeSupported?.(t));
    } catch { return false; }
}

function leerPrefs(): Prefs {
    const base: Prefs = { grilla: 3, pagSeg: 20, pausa: false, nvr: "todos" };
    try {
        const g = Number(new URLSearchParams(window.location.search).get("grilla"));
        const guardadas = JSON.parse(localStorage.getItem(PREFS_CLAVE) || "{}");
        const p = { ...base, ...guardadas };
        if (GRILLAS.includes(g as Grilla)) p.grilla = g as Grilla;
        if (!GRILLAS.includes(p.grilla)) p.grilla = base.grilla;
        if (!PAGINA_SEG.includes(p.pagSeg)) p.pagSeg = base.pagSeg;
        return p;
    } catch { return base; }
}

const fotoDe = (c: Canal, ancho = 640) => c.equipoId
    ? `/api/snapshot/${c.equipoId}?w=${ancho}`
    : c.nvrId && c.ch != null ? `/api/monitor/camaras/foto?nvr=${encodeURIComponent(c.nvrId)}&ch=${c.ch}&w=${ancho}` : null;
const vivoDe = (stream: string, convertido: boolean) => `/go2rtc/api/stream.mp4?src=${encodeURIComponent(stream)}${convertido ? "&video=h264" : ""}`;
const ubicacion = (c: Canal) => [c.nvr, c.ch != null ? `CH ${c.ch}` : null].filter(Boolean).join(" · ") || "Cámara";

/** Un <video> de go2rtc que avisa si arrancó o no, y suelta la conexión al desmontarse. */
function Vivo({ src, alResultado, className }: { src: string; alResultado: (ok: boolean) => void; className?: string }) {
    const ref = useRef<HTMLVideoElement>(null);
    const avisar = useRef(alResultado); avisar.current = alResultado;
    useEffect(() => {
        const v = ref.current; if (!v) return;
        let listo = false;
        const ok = () => { if (!listo) { listo = true; avisar.current(true); } };
        const mal = () => { if (!listo) { listo = true; avisar.current(false); } };
        const to = setTimeout(mal, VIVO_ESPERA_MS);
        v.addEventListener("loadeddata", ok); v.addEventListener("error", mal);
        v.src = src; v.play().catch(() => { });
        return () => {
            clearTimeout(to); v.removeEventListener("loadeddata", ok); v.removeEventListener("error", mal);
            // Sin esto el navegador mantiene la descarga abierta y go2rtc sigue sirviendo el canal.
            try { v.pause(); v.removeAttribute("src"); v.load(); } catch { }
        };
    }, [src]);
    return <video ref={ref} muted playsInline autoPlay className={className} />;
}

/** Foto que se renueva sola. La nueva sólo reemplaza a la vieja cuando terminó de bajar. */
function Foto({ src, ms, className }: { src: string; ms: number; className?: string }) {
    const [k, setK] = useState(() => Date.now());
    const [mostrada, setMostrada] = useState<string | null>(null);
    const [falla, setFalla] = useState(false);
    useEffect(() => { const iv = setInterval(() => setK(Date.now()), ms); return () => clearInterval(iv); }, [ms]);
    const pedida = `${src}${src.includes("?") ? "&" : "?"}t=${k}`;
    return (
        <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {mostrada && <img src={mostrada} alt="" draggable={false} className={className} />}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img key={pedida} src={pedida} alt="" className="hidden" onLoad={() => { setMostrada(pedida); setFalla(false); }} onError={() => setFalla(true)} />
            {!mostrada && !falla && <span className="absolute inset-0 grid place-items-center text-white/30"><Loader2 size={22} className="animate-spin" /></span>}
            {!mostrada && falla && <span className="absolute inset-0 grid place-items-center text-white/40 text-[13px]">Sin foto del canal</span>}
        </>
    );
}

const MODO_ROTULO: Record<Modo, { t: string; Ic: any; titulo: string }> = {
    directo: { t: "En vivo", Ic: null, titulo: "En vivo, directo desde la cámara (H.265 en este navegador)" },
    convertido: { t: "En vivo · convertido", Ic: Cpu, titulo: "En vivo, convertido a H.264 por el servidor" },
    foto: { t: `Foto c/${FOTO_MS / 1000} s`, Ic: ImageIcon, titulo: "Foto que se renueva: este navegador no reproduce H.265 y el servidor ya convierte el máximo de canales" },
};

function Baldosa({ c, modo, alerta, alTocar, alFallarVivo }: { c: Canal; modo: Modo; alerta: Alerta | null; alTocar: () => void; alFallarVivo: (c: Canal, modo: Modo, ok: boolean) => void }) {
    const caido = c.online === false;
    const m = alerta ? metaDe(alerta.tipo) : null;
    const foto = fotoDe(c);
    const r = MODO_ROTULO[modo];
    return (
        <motion.button type="button" layout onClick={alTocar} transition={SUAVE} aria-label={`Abrir ${c.nombre}`}
            className={cn("relative min-h-0 rounded-[10px] overflow-hidden bg-neutral-950 text-left", tocable,
                alerta ? "ring-4 ring-[var(--mal)]" : "ring-1 ring-white/10")}>
            {caido ? (
                <span className="absolute inset-0 grid place-items-center text-white/45">
                    <span className="flex flex-col items-center gap-2"><VideoOff size={28} /><span className="text-[14px] font-semibold">Sin señal en el NVR</span></span>
                </span>
            ) : modo === "foto" ? (
                foto ? <Foto src={foto} ms={FOTO_MS} className="absolute inset-0 w-full h-full object-cover" /> : null
            ) : (
                <Vivo src={vivoDe(c.stream, modo === "convertido")} alResultado={(ok) => alFallarVivo(c, modo, ok)} className="absolute inset-0 w-full h-full object-cover" />
            )}
            <div className="absolute top-0 inset-x-0 px-3 pt-2 pb-6 bg-gradient-to-b from-black/75 to-transparent">
                <div className="text-[15px] font-bold text-white leading-tight truncate">{c.nombre}</div>
                <div className="text-[12px] text-white/65 inline-flex items-center gap-1 truncate">{c.nvr && <Server size={11} />} {ubicacion(c)}</div>
            </div>
            {alerta && m && (
                <span className="absolute bottom-2 left-2 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-bold pleno-mal">
                    <m.Icon size={13} /> {m.label} · <span className="tabular-nums">{horaCorta(alerta.ts)}</span>
                </span>
            )}
            {!caido && (
                <span title={r.titulo} className="absolute bottom-2 right-2 inline-flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-semibold text-white/80">
                    {r.Ic ? <r.Ic size={11} /> : <span className="h-1.5 w-1.5 rounded-full bg-[var(--mal)]" />} {r.t}
                </span>
            )}
        </motion.button>
    );
}

export function VistaCamaras() {
    const { latir, setTitulo } = useMarco();
    useEffect(() => { setTitulo("Cámaras"); }, [setTitulo]);
    usarReloj(5000);
    const { datos, error, recargar } = usarDatos<Datos>("/api/monitor/camaras", INTERVALO_MS, latir);

    // Lo que sabe este navegador. null = todavía no se preguntó (primer render en el servidor).
    const [h265, setH265] = useState<boolean | null>(null);
    const [prefs, setPrefsState] = useState<Prefs | null>(null);
    useEffect(() => { setH265(reproduceH265()); setPrefsState(leerPrefs()); }, []);
    const setPrefs = useCallback((cambio: Partial<Prefs>) => setPrefsState((p) => {
        const n = { ...(p || leerPrefs()), ...cambio };
        try { localStorage.setItem(PREFS_CLAVE, JSON.stringify(n)); } catch { }
        return n;
    }), []);

    // Cuántos vivos directos arrancaron y cuántos no: es la prueba de verdad, más que canPlayType.
    const [resultados, setResultados] = useState<Record<string, boolean>>({});
    // Clave «canal|modo»: que el directo haya fallado no dice nada del convertido, y viceversa.
    const alResultado = useCallback((c: Canal, modo: Modo, ok: boolean) => setResultados((r) => { const k = `${c.clave}|${modo}`; return r[k] === ok ? r : { ...r, [k]: ok }; }), []);

    // Las detecciones que llegan por el socket, sin esperar a la próxima vuelta.
    const [alertasVivas, setAlertasVivas] = useState<Record<string, Alerta>>({});
    useTiempoReal("general_detection", (d: any) => {
        if (!d?.id || !d.deviceId || d.type === "MOTION") return;
        setAlertasVivas((p) => ({ ...p, [d.deviceId]: { id: d.id, tipo: d.type, ts: d.timestamp || new Date().toISOString() } }));
        latir();
        // Si quien avisó es un NVR (canal sin mapear), el canal lo resuelve la consulta.
        setTimeout(recargar, 1500);
    });
    const ventana = datos?.ventanaAlertaMs || 120_000;
    const alertaDe = useCallback((c: Canal): Alerta | null => {
        const viva = c.equipoId ? alertasVivas[c.equipoId] : undefined;
        const a = [c.alerta, viva].filter(Boolean).sort((x, y) => +new Date(y!.ts) - +new Date(x!.ts))[0] || null;
        return a && Date.now() - +new Date(a.ts) < ventana ? a : null;
    }, [alertasVivas, ventana]);

    const todos = datos?.canales || [];
    const nvrs = useMemo(() => [...new Set(todos.map((c) => c.nvr || "Cámaras sueltas"))], [todos]);
    const filtro = prefs?.nvr && (prefs.nvr === "todos" || nvrs.includes(prefs.nvr)) ? prefs.nvr : "todos";
    // Las que detectan van primero, la más reciente adelante; el resto en el orden del NVR.
    const canales = useMemo(() => {
        const f = todos.filter((c) => filtro === "todos" || (c.nvr || "Cámaras sueltas") === filtro);
        const con = f.filter((c) => alertaDe(c)).sort((a, b) => +new Date(alertaDe(b)!.ts) - +new Date(alertaDe(a)!.ts));
        return [...con, ...f.filter((c) => !alertaDe(c))];
    }, [todos, filtro, alertaDe]);
    const hayAlerta = canales.some((c) => alertaDe(c));

    const grilla = prefs?.grilla || 3;
    const porPagina = grilla * grilla;
    const paginas = Math.max(1, Math.ceil(canales.length / porPagina));
    const [pagina, setPagina] = useState(0);
    // Con una detección, la pared se queda en la primera página (ahí está la baldosa roja).
    const pausada = !!prefs?.pausa;
    useEffect(() => { if (hayAlerta) setPagina(0); }, [hayAlerta]);
    useEffect(() => {
        if (paginas <= 1 || pausada || hayAlerta) return;
        const iv = setInterval(() => setPagina((p) => (p + 1) % paginas), (prefs?.pagSeg || 20) * 1000);
        return () => clearInterval(iv);
    }, [paginas, pausada, hayAlerta, prefs?.pagSeg]);
    const pag = Math.min(pagina, paginas - 1);
    const visibles = canales.slice(pag * porPagina, pag * porPagina + porPagina);

    // Qué es cada baldosa: directo si el navegador puede (y ese canal no falló); si no, las
    // primeras MAX_CONVERTIDOS de la página van convertidas y el resto es foto.
    const modos = useMemo(() => {
        const m = new Map<string, Modo>();
        let convertidos = 0;
        for (const c of visibles) {
            if (h265 && resultados[`${c.clave}|directo`] !== false) { m.set(c.clave, "directo"); continue; }
            if (convertidos < MAX_CONVERTIDOS && c.online !== false && resultados[`${c.clave}|convertido`] !== false) { m.set(c.clave, "convertido"); convertidos++; continue; }
            m.set(c.clave, "foto");
        }
        return m;
    }, [visibles, h265, resultados]);

    const directos = Object.entries(resultados).filter(([k]) => k.endsWith("|directo")).map(([, v]) => v);
    const directosOk = directos.filter(Boolean).length;
    const directosMal = directos.filter((x) => !x).length;
    const [abierta, setAbierta] = useState<Canal | null>(null);

    return (
        <div className="absolute inset-0 flex flex-col gap-3 p-3">
            <LiveEdgeKeeper />
            <div className="shrink-0 flex flex-wrap items-center gap-2">
                <div className="flex gap-1" role="group" aria-label="Mosaico">
                    {GRILLAS.map((g) => (
                        <button key={g} type="button" onClick={() => { setPrefs({ grilla: g }); setPagina(0); }} aria-pressed={grilla === g}
                            className={cn("h-10 px-3.5 rounded-full border text-[14px] font-semibold tabular-nums", tocable,
                                grilla === g ? "border-[var(--accion-en-oscuro)] bg-[color-mix(in_oklab,var(--accion-en-oscuro)_18%,transparent)] text-foreground" : "border-border text-muted-foreground")}>
                            {g}×{g}
                        </button>
                    ))}
                </div>
                {nvrs.length > 1 && (
                    <div className="flex gap-1 overflow-x-auto [scrollbar-width:none]" role="group" aria-label="Grabador">
                        {["todos", ...nvrs].map((n) => (
                            <button key={n} type="button" onClick={() => { setPrefs({ nvr: n }); setPagina(0); }} aria-pressed={filtro === n}
                                className={cn("h-10 px-3.5 rounded-full border text-[14px] font-semibold whitespace-nowrap", tocable,
                                    filtro === n ? "border-[var(--accion-en-oscuro)] bg-[color-mix(in_oklab,var(--accion-en-oscuro)_18%,transparent)] text-foreground" : "border-border text-muted-foreground")}>
                                {n === "todos" ? "Todos" : n} <span className="tabular-nums opacity-70">{n === "todos" ? todos.length : todos.filter((c) => (c.nvr || "Cámaras sueltas") === n).length}</span>
                            </button>
                        ))}
                    </div>
                )}
                <div className="ml-auto flex items-center gap-2">
                    {h265 !== null && (
                        <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-3 h-10 text-[13px] font-semibold", h265 && !(directosMal && !directosOk) ? "chip-bien" : "chip-aviso")}
                            title={h265 ? "Este navegador decodifica H.265: el servidor no convierte nada." : `Este navegador no reproduce H.265: el servidor convierte hasta ${MAX_CONVERTIDOS} canales y el resto son fotos. Chrome o Edge en Windows con aceleración por hardware lo reproducen directo.`}>
                            {h265 ? (directosMal && !directosOk ? "H.265 anunciado, no reproduce" : `H.265 directo${directosOk ? ` · ${directosOk} en vivo` : ""}${directosMal ? ` · ${directosMal} fallaron` : ""}`) : `Sin H.265 · ${MAX_CONVERTIDOS} convertidos`}
                        </span>
                    )}
                    {paginas > 1 && (
                        <div className="flex items-center gap-1">
                            <button type="button" aria-label="Página anterior" onClick={() => setPagina((p) => (p - 1 + paginas) % paginas)} className={cn("grid h-10 w-10 place-items-center rounded-[6px] border border-border", tocable)}><ChevronLeft size={18} /></button>
                            <span className="text-[14px] tabular-nums text-muted-foreground px-1 min-w-[64px] text-center">{pag + 1} de {paginas}</span>
                            <button type="button" aria-label="Página siguiente" onClick={() => setPagina((p) => (p + 1) % paginas)} className={cn("grid h-10 w-10 place-items-center rounded-[6px] border border-border", tocable)}><ChevronRight size={18} /></button>
                            <button type="button" onClick={() => setPrefs({ pausa: !pausada })} aria-pressed={pausada} title={pausada ? "Volver a pasar de página sola" : "Dejar fija esta página"}
                                className={cn("h-10 px-3 rounded-[6px] border border-border inline-flex items-center gap-1.5 text-[13px] font-semibold", tocable)}>
                                {pausada ? <><Play size={15} /> Fija</> : hayAlerta ? <><Pause size={15} /> Fija por detección</> : <><Pause size={15} /> c/{prefs?.pagSeg || 20} s</>}
                            </button>
                            {!pausada && !hayAlerta && (
                                <select aria-label="Segundos por página" value={prefs?.pagSeg || 20} onChange={(e) => setPrefs({ pagSeg: Number(e.target.value) })}
                                    className="h-10 rounded-[6px] border border-border bg-background px-2 text-[13px] tabular-nums">
                                    {PAGINA_SEG.map((s) => <option key={s} value={s}>{s} s</option>)}
                                </select>
                            )}
                        </div>
                    )}
                </div>
            </div>

            {datos?.errores?.length ? (
                <div className="shrink-0 rounded-[10px] chip-aviso border px-3 py-2 text-[13px]">
                    {datos.errores.map((e) => `${e.nvr}: no se pudieron leer sus canales (${e.error})`).join(" · ")}
                </div>
            ) : null}
            {datos && !datos.go2rtc && (
                <div className="shrink-0 rounded-[10px] chip-mal border px-3 py-2 text-[13px]">El servidor de video (go2rtc) no responde: los vivos no van a abrir.</div>
            )}

            <div className="flex-1 min-h-0 grid gap-2" style={{ gridTemplateColumns: `repeat(${grilla}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${grilla}, minmax(0, 1fr))` }}>
                {!datos && !error && <div className="col-span-full row-span-full grid place-items-center text-[18px] text-muted-foreground">Cargando canales…</div>}
                {error && !datos && (
                    <div className="col-span-full row-span-full grid place-items-center text-center">
                        <div>
                            <div className="text-[18px] text-[var(--mal-texto)]">No se pudo leer la lista de canales: {error}</div>
                            <button type="button" onClick={recargar} className={cn("mt-3 h-11 px-4 rounded-[6px] bg-[var(--accion)] text-white font-semibold", tocable)}>Reintentar</button>
                        </div>
                    </div>
                )}
                {datos && canales.length === 0 && <div className="col-span-full row-span-full grid place-items-center text-[18px] text-muted-foreground">No hay canales para mostrar.</div>}
                {h265 !== null && visibles.map((c) => (
                    <Baldosa key={c.clave} c={c} modo={modos.get(c.clave) || "foto"} alerta={alertaDe(c)} alTocar={() => setAbierta(c)} alFallarVivo={alResultado} />
                ))}
            </div>

            <FichaCanal c={abierta} h265={!!h265 && resultados[`${abierta?.clave}|directo`] !== false} alerta={abierta ? alertaDe(abierta) : null} alCerrar={() => setAbierta(null)} />
        </div>
    );
}

/** El canal grande: el vivo en HD si el navegador puede, su estado, y la grabación. */
function FichaCanal({ c, h265, alerta, alCerrar }: { c: Canal | null; h265: boolean; alerta: Alerta | null; alCerrar: () => void }) {
    const [grabacion, setGrabacion] = useState(false);
    const [fallo, setFallo] = useState(false);
    useEffect(() => { setGrabacion(false); setFallo(false); }, [c?.clave]);
    // Mientras se mira la grabación no se cierra sola.
    const vuelta = usarInactividad(!!c && !grabacion, FICHA_SE_CIERRA_MS, alCerrar);
    // HD convertido es mucho más caro que el subflujo: sin H.265 se muestra el subflujo convertido.
    const hd = h265 && !fallo;
    const m = alerta ? metaDe(alerta.tipo) : null;
    const foto = c ? fotoDe(c, 960) : null;
    return (
        <AnimatePresence>
            {c && (
                <motion.div key={c.clave} role="dialog" aria-label={c.nombre} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={SUAVE}
                    className="fixed inset-0 z-50 bg-black flex flex-col">
                    <div className="shrink-0 flex items-center gap-3 px-5 py-3 bg-background border-b border-border">
                        <div className="min-w-0 flex-1">
                            <div className="text-[22px] font-bold leading-tight truncate">{c.nombre}</div>
                            <div className="text-[14px] text-muted-foreground inline-flex items-center gap-1.5">{c.nvr && <Server size={13} />} {ubicacion(c)} · {c.online === false ? "sin señal en el NVR" : hd ? "en vivo, alta calidad" : fallo ? "en vivo, subflujo convertido (la alta calidad no abrió)" : "en vivo, subflujo convertido: este navegador no reproduce H.265 en alta"}</div>
                        </div>
                        {alerta && m && <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[14px] font-bold pleno-mal"><m.Icon size={15} /> {m.label} · {horaCorta(alerta.ts)} · {hace(alerta.ts)}</span>}
                        {(c.equipoId || (c.nvrId && c.ch != null)) && (
                            <button type="button" onClick={() => setGrabacion(true)} className={cn("h-14 px-5 rounded-[14px] bg-[var(--accion)] text-white inline-flex items-center gap-2 text-[16px] font-semibold", tocable)}>
                                <History size={20} /> Ver grabación
                            </button>
                        )}
                        <button type="button" onClick={alCerrar} aria-label="Cerrar" className={cn("grid h-14 w-14 place-items-center rounded-[14px] bg-muted", tocable)}><X size={26} /></button>
                    </div>
                    <CuentaAtras ms={FICHA_SE_CIERRA_MS} vuelta={vuelta} className="bg-muted [&>span]:bg-muted-foreground/60" />
                    <div className="relative flex-1 min-h-0">
                        {c.online === false ? (
                            foto ? <Foto src={foto} ms={FOTO_MS} className="absolute inset-0 w-full h-full object-contain" /> : null
                        ) : (
                            <Vivo key={hd ? "hd" : "sd"} src={hd ? vivoDe(`${c.stream}_hd`, false) : vivoDe(c.stream, true)} alResultado={(ok) => { if (!ok && hd) setFallo(true); }} className="absolute inset-0 w-full h-full object-contain" />
                        )}
                    </div>
                    {grabacion && (
                        <VerGrabacion deviceId={c.equipoId || `nvrch-${c.nvrId}-${c.ch}`} nombre={c.nombre} canal={c.ch} nvrId={c.nvrId}
                            instanteMs={alerta ? +new Date(alerta.ts) : Date.now() - GRABACION_ANTES_MS} onClose={() => setGrabacion(false)} />
                    )}
                </motion.div>
            )}
        </AnimatePresence>
    );
}
