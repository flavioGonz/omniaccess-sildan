"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Clapperboard, ChevronDown, Download, Share2, X, RotateCcw, Check, Play, TriangleAlert } from "lucide-react";
import { Girando as Loader2 } from "@/components/brand/CargaOmni";
import { cn } from "@/lib/utils";
import { useTiempoReal } from "@/lib/tiempo-real";
import { getImagePath } from "@/lib/image-path";
import { hora } from "@/lib/fechas";
import { CompartirEvento } from "@/components/visor/CompartirEvento";
import type { ClipEnBandeja, EstadoClip } from "@/lib/clips-grabados";

/**
 * La bandeja de clips grabados: lo que se pidió con «Grabar», armándose o listo.
 *
 * Por qué (14/11, Nico: «Armando el clip desde la grabación debe ser más tipo wizard animado, que
 * debe seguir funcionando a pesar de cerrar la pestaña… siempre con el foco de ser un VMS
 * profesional, fluido»). Antes, al detener la grabación, un cartel en el medio del video tapaba la
 * cámara hasta dos minutos, y el clip vivía en la ficha: cerrarla era perderlo. Ahora el clip es
 * una tarea del servidor (lib/clips-grabados) y esta bandeja sólo la mira: se puede seguir
 * operando, cambiar de cámara, cerrar la ficha o la pestaña, y al volver el clip está acá.
 *
 * Cada clip cuenta sus pasos —el grabador, las cámaras, la edición, el guardado— y dice la verdad
 * de la espera: el grabador tarda en tener disponible lo último que grabó (un minuto o más), y
 * eso se ve como una cuenta regresiva hasta el próximo intento, no como un cartel quieto.
 */

const ACTIVO = (e: EstadoClip) => e !== "listo" && e !== "fallo";
/** Mientras hay alguno armándose se pregunta cada tanto, además del aviso por socket (que puede no llegar). */
const PREGUNTAR_MS = 2500;
const PASOS = ["Grabador", "Cámaras", "Edición", "Guardado"] as const;
const PASO_DE: Record<EstadoClip, number> = { "en-cola": 0, esperando: 0, trayendo: 1, uniendo: 2, editando: 2, guardando: 3, listo: 4, fallo: -1 };

/** La bandeja de quien mira, y cómo sumarle un clip. Un solo lugar la pide: la pared. */
export function useClipsGrabados(activa: boolean) {
    const [clips, setClips] = useState<ClipEnBandeja[]>([]);
    const [yo, setYo] = useState<string | null>(null);
    const pedir = useCallback(() => {
        if (!activa) return;
        fetch("/api/clip/grabar", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null))
            .then((j) => { if (j?.ok && Array.isArray(j.clips)) { setClips(j.clips); setYo(j.yo || null); } }).catch(() => { /* la próxima vuelta */ });
    }, [activa]);
    useEffect(() => { pedir(); }, [pedir]);
    const hayActivos = clips.some((c) => ACTIVO(c.estado));
    useEffect(() => { if (!hayActivos) return; const t = setInterval(pedir, PREGUNTAR_MS); return () => clearInterval(t); }, [hayActivos, pedir]);
    useTiempoReal("clip_grabado", (x: { usuarioId?: string }) => { if (!yo || x?.usuarioId === yo) pedir(); });
    useEffect(() => { const f = () => { if (document.visibilityState === "visible") pedir(); }; document.addEventListener("visibilitychange", f); return () => document.removeEventListener("visibilitychange", f); }, [pedir]);

    /** Pedir un clip: devuelve null si quedó en la cola, o por qué no. */
    const encolar = useCallback(async (tramos: unknown[], rotulo: string): Promise<string | null> => {
        const r = await fetch("/api/clip/grabar", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tramos, rotulo }) }).catch(() => null);
        const j = await r?.json().catch(() => null);
        if (!j?.ok || !j.clip) return String(j?.motivo || (r ? `El servidor respondió ${r.status}` : "No se pudo llegar al servidor")).replace(/\.$/, "") + ".";
        setClips((p) => [j.clip as ClipEnBandeja, ...p.filter((c) => c.id !== j.clip.id)]);
        return null;
    }, []);
    const quitar = useCallback((id: string) => {
        setClips((p) => p.filter((c) => c.id !== id));
        fetch(`/api/clip/grabar?id=${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => { });
    }, []);
    const reintentar = useCallback((id: string) => {
        fetch("/api/clip/grabar", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ accion: "reintentar", id }) })
            .then((r) => r.json()).then((j) => { if (j?.clip) setClips((p) => p.map((c) => (c.id === id ? j.clip : c))); }).catch(() => { });
    }, []);
    return { clips, encolar, quitar, reintentar };
}

const titulo = (c: ClipEnBandeja) => `${c.pedidas > 1 ? "Recorrida" : c.rotulo || "Clip"} · ${c.segundos ?? c.pedidos} s${(c.camaras ?? c.pedidas) > 1 ? ` · ${c.camaras ?? c.pedidas} cámaras` : ""}`;

/** Lo que está pasando ahora, en una línea. `ahora` hace correr la cuenta regresiva. */
function queHace(c: ClipEnBandeja, ahora: number): string {
    const a = c.avance, de = a?.de ?? c.pedidas, cual = de > 1 && a?.tramo ? ` (cámara ${a.tramo} de ${de})` : "";
    switch (c.estado) {
        case "en-cola": return "En la cola: hay otro clip armándose antes.";
        case "esperando": {
            const falta = a?.proximo ? Math.max(0, Math.ceil((a.proximo - ahora) / 1000)) : null;
            return `El grabador todavía no tiene lo último${cual}. ${falta ? `Se le vuelve a pedir en ${falta} s.` : "Pidiéndoselo…"}`;
        }
        case "trayendo": return `Trayendo la grabación${cual}.`;
        case "uniendo": return "Uniendo las cámaras con sus pases.";
        case "editando": return "Poniendo la apertura, el logo y los nombres.";
        case "guardando": return "Guardando en el almacén.";
        default: return "";
    }
}

/** Los cuatro pasos: los hechos con su tilde, el que corre latiendo, la línea que avanza. */
function Pasos({ en }: { en: number }) {
    return (
        <ol className="flex items-start mt-2.5" aria-label="Pasos del armado">
            {PASOS.map((p, i) => {
                const hecho = i < en, corre = i === en;
                return (
                    <li key={p} className="flex-1 min-w-0 relative flex flex-col items-center gap-1" aria-current={corre ? "step" : undefined}>
                        {i > 0 && (
                            <span className="absolute right-1/2 top-[8px] h-[2px] w-full -translate-y-1/2 bg-white/15 overflow-hidden rounded-full" aria-hidden="true">
                                <motion.span className="block h-full bg-[var(--accion-en-oscuro)]" initial={false} animate={{ width: i <= en ? "100%" : "0%" }} transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }} />
                            </span>
                        )}
                        <span className={cn("relative z-[1] grid place-items-center h-4 w-4 rounded-full transition-colors duration-300", hecho ? "bg-[var(--accion-en-oscuro)] text-black" : corre ? "bg-[var(--accion-en-oscuro)]" : "bg-[#3a4150]")}>
                            {hecho && <Check size={10} strokeWidth={3.5} />}
                            {corre && <span className="absolute inset-0 rounded-full bg-[var(--accion-en-oscuro)] oa-caja-late" aria-hidden="true" />}
                        </span>
                        <span className={cn("text-[10.5px] leading-none truncate max-w-full transition-colors", hecho || corre ? "text-white/90 font-semibold" : "text-white/40")}>{p}</span>
                    </li>
                );
            })}
        </ol>
    );
}

function Tarjeta({ c, ahora, alQuitar, alReintentar, alEnviar }: { c: ClipEnBandeja; ahora: number; alQuitar: () => void; alReintentar: () => void; alEnviar: () => void }) {
    const [viendo, setViendo] = useState(false);
    const foto = getImagePath(c.foto);
    const descarga = getImagePath(c.guardado) || c.url;
    return (
        <motion.li layout initial={{ opacity: 0, y: 14, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, x: -24, transition: { duration: 0.18 } }}
            transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }} className={cn("rounded-[10px] bg-white/[.07] overflow-hidden", c.estado === "fallo" && "ring-1 ring-[color-mix(in_oklab,var(--mal)_60%,transparent)]")}>
            {c.estado === "listo" && viendo && c.url && (
                // El video del servidor (vive unos minutos) o, si ya se borró, el del almacén.
                <video src={c.url} controls autoPlay muted playsInline poster={foto || undefined} className="block w-full aspect-video bg-black"
                    onError={(e) => { const v = e.currentTarget; if (c.guardado && !v.src.includes("/api/files/")) v.src = getImagePath(c.guardado) || ""; }} />
            )}
            <div className="p-2.5">
                <div className="flex items-start gap-2.5">
                    {c.estado === "listo" && !viendo && (
                        <button type="button" onClick={() => setViendo(true)} title="Ver el clip" aria-label="Ver el clip" className="relative shrink-0 w-[88px] aspect-video rounded-[6px] overflow-hidden bg-black group">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            {foto && <img src={foto} alt="" className="absolute inset-0 w-full h-full object-cover" />}
                            <span className="absolute inset-0 grid place-items-center bg-black/25 group-hover:bg-black/10 transition-colors"><span className="grid place-items-center h-7 w-7 rounded-full bg-black/60 text-white"><Play size={13} fill="currentColor" /></span></span>
                        </button>
                    )}
                    <div className="min-w-0 flex-1">
                        <div className="text-[13px] font-semibold leading-snug truncate">{titulo(c)}</div>
                        <div className="text-[11.5px] text-white/55 tabular-nums">de las {hora(c.desde)}</div>
                        {c.estado === "listo" && (
                            <div className="text-[11.5px] text-white/65 mt-0.5">
                                {c.guardado ? "Guardado en el almacén." : "No se pudo guardar en el almacén: bajalo ahora, en unos minutos se borra."}
                                {!!c.salteados && <span className="text-[color-mix(in_oklab,var(--aviso)_70%,#fff)]"> {c.salteados === 1 ? "Una cámara no salió." : `${c.salteados} cámaras no salieron.`}</span>}
                            </div>
                        )}
                    </div>
                    <button type="button" onClick={alQuitar} title={ACTIVO(c.estado) ? "Sacarlo de la bandeja (se sigue armando)" : "Sacarlo de la bandeja"} aria-label="Sacar de la bandeja"
                        className="shrink-0 -mr-1 -mt-1 h-7 w-7 grid place-items-center rounded-full text-white/55 hover:text-white hover:bg-white/12"><X size={14} /></button>
                </div>
                {ACTIVO(c.estado) && (<>
                    <Pasos en={PASO_DE[c.estado]} />
                    <p className="mt-2 text-[11.5px] text-white/75 leading-snug tabular-nums" role="status">{queHace(c, ahora)}</p>
                </>)}
                {c.estado === "fallo" && (
                    <div className="mt-1.5 flex items-start gap-2">
                        <TriangleAlert size={14} className="shrink-0 mt-[2px] text-[color-mix(in_oklab,var(--mal)_60%,#fff)]" />
                        <p className="text-[11.5px] text-white/85 leading-snug flex-1">No salió: {c.motivo || "falló al armarlo"}.</p>
                        <button type="button" onClick={alReintentar} className="shrink-0 inline-flex items-center gap-1.5 h-7 px-2.5 rounded-[6px] bg-white/12 hover:bg-white/20 text-[11.5px] font-semibold"><RotateCcw size={12} /> Reintentar</button>
                    </div>
                )}
                {c.estado === "listo" && (
                    <div className="mt-2 flex items-center gap-1.5">
                        <a href={descarga || undefined} download={c.nombre || undefined} className="inline-flex items-center gap-1.5 h-8 px-3 rounded-[6px] bg-[var(--accion)] hover:brightness-110 text-white text-[12px] font-semibold"><Download size={13} /> Descargar</a>
                        <button type="button" onClick={alEnviar} className="inline-flex items-center gap-1.5 h-8 px-3 rounded-[6px] bg-white/12 hover:bg-white/20 text-[12px] font-semibold"><Share2 size={13} /> Enviar</button>
                        {viendo && <button type="button" onClick={() => setViendo(false)} className="ml-auto h-8 px-2.5 rounded-[6px] text-[12px] text-white/70 hover:bg-white/12">Cerrar el video</button>}
                    </div>
                )}
            </div>
        </motion.li>
    );
}

export function BandejaDeClips({ clips, alQuitar, alReintentar, elevada = false }: {
    clips: ClipEnBandeja[]; alQuitar: (id: string) => void; alReintentar: (id: string) => void;
    /** Hay un canal abierto: la bandeja sube para no tapar el REC de abajo a la izquierda. */
    elevada?: boolean;
}) {
    const [abierta, setAbierta] = useState(false);
    const [enviando, setEnviando] = useState<ClipEnBandeja | null>(null);
    const [aviso, setAviso] = useState<string | null>(null);
    const activos = clips.filter((c) => ACTIVO(c.estado)), listos = clips.filter((c) => c.estado === "listo"), fallados = clips.filter((c) => c.estado === "fallo");
    // Se abre sola cuando se pide un clip (se ve el asistente) y cuando uno que se estaba armando
    // termina (se ve el resultado). Los que ya estaban listos al entrar no la abren: quedan en el botón.
    const vistosArmandose = useRef<Set<string>>(new Set());
    useEffect(() => {
        let abrir = false;
        for (const c of clips) {
            if (ACTIVO(c.estado)) { if (!vistosArmandose.current.has(c.id)) { vistosArmandose.current.add(c.id); abrir = true; } }
            else if (vistosArmandose.current.delete(c.id)) abrir = true;
        }
        if (abrir) setAbierta(true);
    }, [clips]);
    // La cuenta regresiva: un reloj sólo mientras alguno espera al grabador, y sólo con la bandeja abierta.
    const esperando = abierta && clips.some((c) => c.estado === "esperando");
    const [ahora, setAhora] = useState(() => Date.now());
    useEffect(() => { if (!esperando) return; const t = setInterval(() => setAhora(Date.now()), 1000); return () => clearInterval(t); }, [esperando]);
    useEffect(() => { if (!aviso) return; const t = setTimeout(() => setAviso(null), 7000); return () => clearTimeout(t); }, [aviso]);

    const enviar = useCallback(async (c: ClipEnBandeja) => {
        // El envío toma el archivo de la carpeta de clips, donde vive unos minutos: si ya no está, el servidor lo trae del almacén.
        const r = await fetch("/api/clip/grabar", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ accion: "preparar", id: c.id }) }).catch(() => null);
        const j = await r?.json().catch(() => null);
        if (j?.ok) setEnviando(c); else setAviso(j?.motivo || "No se pudo preparar el clip para enviarlo.");
    }, []);
    const resumen = useMemo(() => {
        const p: string[] = [];
        if (activos.length) p.push(activos.length === 1 ? "Armando un clip" : `Armando ${activos.length} clips`);
        if (listos.length) p.push(listos.length === 1 ? "1 clip listo" : `${listos.length} clips listos`);
        if (fallados.length) p.push(fallados.length === 1 ? "1 no salió" : `${fallados.length} no salieron`);
        return p.join(" · ");
    }, [activos.length, listos.length, fallados.length]);

    if (!clips.length && !enviando) return null;
    return (
        <>
            <div data-capa-tocable className={cn("fixed left-4 sm:left-7 z-[calc(var(--capa-panel)-50)] w-[min(348px,calc(100vw-32px))] text-white transition-[bottom] duration-300", elevada ? "bottom-[84px]" : "bottom-5")}>
                <AnimatePresence initial={false} mode="popLayout">
                    {abierta ? (
                        <motion.section key="abierta" aria-label="Clips grabados" initial={{ opacity: 0, y: 16, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 12, scale: 0.97, transition: { duration: 0.15 } }}
                            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }} style={{ background: "rgba(14, 19, 28, 0.94)", transformOrigin: "bottom left" }} className="rounded-[14px] visor-panel overflow-hidden">
                            <header className="flex items-center gap-2 pl-3.5 pr-2 h-11 border-b border-white/10">
                                <Clapperboard size={15} className="text-white/70" />
                                <h2 className="text-[13px] font-bold flex-1">Clips grabados</h2>
                                <button type="button" onClick={() => setAbierta(false)} title="Achicar" aria-label="Achicar la bandeja" className="h-8 w-8 grid place-items-center rounded-full text-white/65 hover:text-white hover:bg-white/12"><ChevronDown size={16} /></button>
                            </header>
                            <ul className="p-2 space-y-2 max-h-[min(58vh,520px)] overflow-y-auto overscroll-contain [scrollbar-width:thin]">
                                <AnimatePresence initial={false}>
                                    {clips.map((c) => <Tarjeta key={c.id} c={c} ahora={ahora} alQuitar={() => alQuitar(c.id)} alReintentar={() => alReintentar(c.id)} alEnviar={() => void enviar(c)} />)}
                                </AnimatePresence>
                            </ul>
                            {aviso && <p role="alert" className="px-3.5 pb-2.5 text-[11.5px] text-[color-mix(in_oklab,var(--mal)_60%,#fff)]">{aviso}</p>}
                            {activos.length > 0 && <p className="px-3.5 pb-3 text-[11px] text-white/45 leading-snug">Se arma en el servidor: podés seguir trabajando, o cerrar esta pestaña, y al volver está acá.</p>}
                        </motion.section>
                    ) : (
                        <motion.button key="chica" type="button" onClick={() => setAbierta(true)} aria-label={`Clips grabados: ${resumen}. Abrir`} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8, transition: { duration: 0.12 } }}
                            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }} className="inline-flex items-center gap-2.5 h-11 pl-3.5 pr-4 rounded-full visor-panel">
                            {activos.length ? <Loader2 size={15} className="animate-spin text-[var(--accion-en-oscuro)]" /> : fallados.length && !listos.length ? <TriangleAlert size={15} className="text-[color-mix(in_oklab,var(--mal)_60%,#fff)]" /> : <Clapperboard size={15} />}
                            <span className="text-[13px] font-semibold whitespace-nowrap">{resumen}</span>
                        </motion.button>
                    )}
                </AnimatePresence>
            </div>
            {enviando && (
                <div className="fixed inset-0 z-[calc(var(--capa-panel)+100)]">
                    <CompartirEvento clipHecho={enviando.nombre} foto={enviando.foto} deviceId={null} deviceName={enviando.rotulo} instante={new Date(enviando.desde)}
                        titulo={(enviando.camaras ?? 1) > 1 ? "Recorrida grabada desde el vivo" : `Clip de ${enviando.rotulo || "la cámara"}`}
                        lineas={[`Grabado desde el vivo · ${enviando.segundos ?? enviando.pedidos} s${(enviando.camaras ?? 1) > 1 ? ` · ${enviando.camaras} cámaras` : ""}`]} onCerrar={() => setEnviando(null)} />
                </div>
            )}
        </>
    );
}
