"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Activity, AlertTriangle, Check, HardDrive, Loader2, MemoryStick, Network, RefreshCw, Timer, Wifi, X } from "lucide-react";
import { CajonCerrar } from "@/components/ui/cajon";
import { cn } from "@/lib/utils";

/**
 * La cabecera de la ficha de un NVR: el grabador dibujado como un switch (Nico, 14/10).
 *
 * Un puerto por canal, pegados, con su número: con cámara y conectada, con cámara pero caída, o
 * vacío. Así se ve de un vistazo qué tiene conectado el grabador — antes la cabecera era una
 * banda con un ícono de disco y la IP, y para saber qué había en cada canal había que importar.
 * Al pasar sobre un puerto se despliega abajo el vivo de ese canal (del equipo si la cámara ya
 * está dada de alta; si no, un vivo temporal del canal en el grabador). Debajo, la salud del
 * grabador: si contesta, hace cuánto está prendido, memoria y cada disco.
 *
 * A sangre, sin redondeo ni sombra: es la cabecera del cajón, no una tarjeta adentro de él.
 */

type Canal = { ch: number; nombre: string | null; ip: string | null; modelo: string | null; online: boolean | null; sensorDe: number | null; equipo: { id: string; nombre: string; tipo: string } | null };
type Disco = { nombre: string; estado: string; capacidadGB: number; usadoPct: number; modelo: string | null };
type Panel = {
    ok: boolean; error: string | null; capacidad: number; canales: Canal[];
    salud: { alcanzable: boolean; latenciaMs: number | null; uptimeSec: number | null; memoriaPct: number | null; discos: Disco[] | null };
};

/** Cuántos puertos por fila: como un switch de 16 bocas; más, en filas de 16. */
const POR_FILA = 16;
/** Lo que se espera antes de abrir el vivo de un puerto: pasar el mouse por encima de varios no tiene que abrir varios. */
const ESPERA_HOVER_MS = 220;
/** Lo que tarda en replegarse el vivo al salir de los puertos: da tiempo a bajar el mouse hasta el video. */
const ESPERA_SALIDA_MS = 450;
/**
 * Desde acá el disco se muestra «lleno». No es una alarma: un grabador en modo sobrescritura vive
 * lleno y pisa lo más viejo; lo que dice cuánto guarda es la retención de cada cámara.
 */
const DISCO_LLENO_PCT = 97;

const chip = "inline-flex items-center gap-1 h-6 px-2 rounded-md bg-white/10 text-white text-[10.5px] font-bold";

function estadoDe(c: Canal | undefined): "vacio" | "conectada" | "caida" | "nosabe" {
    if (!c || (!c.ip && !c.nombre)) return "vacio";
    if (c.online === true) return "conectada";
    if (c.online === false) return "caida";
    return "nosabe";
}

const ROTULO: Record<ReturnType<typeof estadoDe>, string> = { vacio: "Vacío", conectada: "Conectada", caida: "Sin señal", nosabe: "Sin dato" };
const COLOR: Record<ReturnType<typeof estadoDe>, string> = {
    vacio: "bg-white/[0.06] text-white/30",
    conectada: "bg-[color-mix(in_oklab,var(--bien)_78%,black)] text-white",
    caida: "bg-[color-mix(in_oklab,var(--mal)_75%,black)] text-white",
    nosabe: "bg-white/25 text-white",
};

function hace(seg: number): string {
    const d = Math.floor(seg / 86400), h = Math.floor((seg % 86400) / 3600);
    return d ? `${d} d ${h} h` : h ? `${h} h` : `${Math.max(1, Math.floor(seg / 60))} min`;
}

export function CabeceraNvr({ device, titulo, subtitulo, ip, mac, detectando, puedeDetectar, onComprobar, info }: {
    device: any; titulo: string; subtitulo: string; ip: string; mac?: string;
    detectando: boolean; puedeDetectar: boolean; onComprobar: () => void; info: any;
}) {
    const [panel, setPanel] = useState<Panel | null>(null);
    const [cargando, setCargando] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [sobre, setSobre] = useState<number | null>(null);
    const [vivo, setVivo] = useState<{ ch: number; stream: string | null; listo: boolean; falla: boolean } | null>(null);
    const timers = useRef<{ entrar?: any; salir?: any }>({});

    const cargar = useCallback(async () => {
        if (!device?.id) return;
        setCargando(true); setError(null);
        try {
            const r = await fetch(`/api/nvr/panel?nvr=${encodeURIComponent(device.id)}`, { cache: "no-store" });
            const j = await r.json();
            if (!r.ok || !j.ok) throw new Error(j.error || `El servidor respondió ${r.status}`);
            setPanel(j);
        } catch (e: any) { setError(e?.message || "No se pudo leer el NVR"); }
        finally { setCargando(false); }
    }, [device?.id]);
    useEffect(() => { cargar(); }, [cargar]);

    const porCanal = useMemo(() => new Map((panel?.canales || []).map((c) => [c.ch, c])), [panel]);
    const capacidad = panel?.capacidad || 0;
    const puertos = Array.from({ length: capacidad }, (_, i) => i + 1);
    const conCamara = (panel?.canales || []).filter((c) => estadoDe(c) !== "vacio");
    const conectadas = conCamara.filter((c) => c.online === true).length;
    const caidas = conCamara.filter((c) => c.online === false).length;

    // El vivo del puerto: el del equipo si la cámara está dada de alta; si no, uno temporal del canal.
    const abrirVivo = useCallback(async (ch: number) => {
        const c = porCanal.get(ch);
        if (estadoDe(c) === "vacio") { setVivo(null); return; }
        if (c?.equipo) { setVivo({ ch, stream: `lpr_${c.equipo.id}`, listo: false, falla: false }); return; }
        setVivo({ ch, stream: null, listo: false, falla: false });
        try {
            const r = await fetch("/api/nvr/canal-vivo", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nvr: device.id, ch }) }).then((x) => x.json());
            setVivo((v) => (v && v.ch === ch ? { ...v, stream: r?.ok ? `lpr_${r.id}` : null, falla: !r?.ok } : v));
        } catch { setVivo((v) => (v && v.ch === ch ? { ...v, falla: true } : v)); }
    }, [porCanal, device?.id]);

    const entrar = (ch: number) => {
        clearTimeout(timers.current.salir); clearTimeout(timers.current.entrar);
        setSobre(ch);
        timers.current.entrar = setTimeout(() => { if (vivo?.ch !== ch) abrirVivo(ch); }, ESPERA_HOVER_MS);
    };
    const salir = () => {
        clearTimeout(timers.current.entrar);
        timers.current.salir = setTimeout(() => { setSobre(null); setVivo(null); }, ESPERA_SALIDA_MS);
    };
    const quedarse = () => clearTimeout(timers.current.salir);
    useEffect(() => () => { clearTimeout(timers.current.entrar); clearTimeout(timers.current.salir); }, []);

    const canalVivo = vivo ? porCanal.get(vivo.ch) : undefined;
    const salud = panel?.salud;

    return (
        <div className="relative bg-[#0b0d11] text-white">
            {/* Título y cerrar */}
            <div className="flex items-start gap-3 px-5 pt-4">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[10px] bg-white/[0.07] text-[var(--accion-en-oscuro)]"><HardDrive size={19} /></span>
                <div className="min-w-0 flex-1">
                    <h2 className="text-[19px] font-bold leading-tight truncate">{titulo}</h2>
                    <p className="text-[12px] text-white/60 truncate">{subtitulo}</p>
                </div>
                <CajonCerrar className="shrink-0 h-9 w-9 rounded-full bg-white/10 hover:bg-white/20 text-white grid place-items-center transition-colors" aria-label="Cerrar"><X size={17} /></CajonCerrar>
            </div>

            <div className="flex items-center gap-1.5 flex-wrap px-5 mt-3">
                <span className={cn(chip, "font-mono")}><Network size={11} /> {ip}</span>
                {mac && <span className={cn(chip, "font-mono font-semibold")}>{mac}</span>}
                {info && <span title={info.nota || undefined} className={cn(chip, info.ok ? "text-[var(--bien)]" : "text-[var(--mal)]")}>{info.ok ? <Check size={11} /> : <AlertTriangle size={11} />} {info.ok ? `${info.model || "Responde"}${info.firmwareVersion ? ` · ${info.firmwareVersion}` : ""}` : (info.error || "No respondió")}</span>}
                <button type="button" onClick={onComprobar} disabled={detectando || !puedeDetectar}
                    className="ml-auto h-8 px-3 rounded-full bg-white/90 hover:bg-white text-black text-[12px] font-bold inline-flex items-center gap-1.5 disabled:opacity-60">
                    {detectando ? <Loader2 size={14} className="animate-spin" /> : <Activity size={14} />} Comprobar
                </button>
            </div>

            {/* Los puertos */}
            <div className="px-5 pt-4">
                <div className="flex items-center gap-2 mb-2">
                    <span className="text-[9px] font-bold uppercase tracking-[0.14em] text-white/50">Canales</span>
                    {panel && <span className="text-[11px] text-white/60 tabular-nums">{conCamara.length} de {capacidad} con cámara · {conectadas} conectadas{caidas ? ` · ${caidas} sin señal` : ""}</span>}
                    <button type="button" onClick={cargar} disabled={cargando} title="Volver a leer el NVR" className="ml-auto h-6 w-6 grid place-items-center rounded-md text-white/50 hover:text-white hover:bg-white/10 disabled:opacity-40">
                        <RefreshCw size={12} className={cn(cargando && "animate-spin")} />
                    </button>
                </div>
                {cargando && !panel ? (
                    <div className="grid gap-[3px]" style={{ gridTemplateColumns: `repeat(${POR_FILA}, minmax(0, 1fr))` }}>
                        {Array.from({ length: POR_FILA }).map((_, i) => <span key={i} className="h-[26px] rounded-[3px] bg-white/[0.06] animate-pulse" />)}
                    </div>
                ) : error && !panel ? (
                    <div className="rounded-[6px] bg-white/[0.05] px-3 py-2 text-[12px] text-white/70 flex items-center gap-2">
                        <AlertTriangle size={14} className="text-[var(--aviso)] shrink-0" /> No se pudieron leer los canales: {error}
                        <button type="button" onClick={cargar} className="ml-auto text-[12px] font-semibold text-[var(--accion-en-oscuro)] hover:underline">Reintentar</button>
                    </div>
                ) : (
                    <div onMouseLeave={salir} onMouseEnter={quedarse}>
                        <div className="grid gap-[3px]" style={{ gridTemplateColumns: `repeat(${Math.min(POR_FILA, capacidad || POR_FILA)}, minmax(0, 1fr))` }}>
                            {puertos.map((ch) => {
                                const c = porCanal.get(ch);
                                const e = estadoDe(c);
                                return (
                                    <button key={ch} type="button" onMouseEnter={() => entrar(ch)} onFocus={() => entrar(ch)} onClick={() => abrirVivo(ch)}
                                        aria-label={`Canal ${ch}: ${ROTULO[e]}${c?.nombre ? ` · ${c.nombre}` : ""}`}
                                        title={`D${ch} · ${ROTULO[e]}${c?.nombre ? ` · ${c.nombre}` : ""}${c?.ip ? ` · ${c.ip}` : ""}${c?.equipo ? ` · en OmniAccess: ${c.equipo.nombre}` : ""}`}
                                        className={cn("relative h-[26px] rounded-[3px] text-[10px] font-bold tabular-nums grid place-items-center transition-shadow", COLOR[e],
                                            sobre === ch && "ring-2 ring-white ring-offset-1 ring-offset-[#0b0d11]")}>
                                        {ch}
                                        {/* La cámara ya es un equipo de OmniAccess. */}
                                        {c?.equipo && <span className="absolute right-[2px] top-[2px] h-[5px] w-[5px] rounded-full bg-[var(--accion-en-oscuro)]" />}
                                    </button>
                                );
                            })}
                        </div>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-[10.5px] text-white/50">
                            {(["conectada", "caida", "vacio"] as const).map((k) => <span key={k} className="inline-flex items-center gap-1.5"><span className={cn("h-2.5 w-2.5 rounded-[2px]", COLOR[k])} /> {ROTULO[k]}</span>)}
                            <span className="inline-flex items-center gap-1.5"><span className="h-[5px] w-[5px] rounded-full bg-[var(--accion-en-oscuro)]" /> Dada de alta en OmniAccess</span>
                        </div>

                        {/* El vivo del puerto, desplegado abajo */}
                        <AnimatePresence initial={false}>
                            {vivo && (
                                <motion.div key="vivo" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.22 }} className="overflow-hidden">
                                    <div className="mt-3 -mx-5">
                                        <div className="relative aspect-video bg-black">
                                            {/* eslint-disable-next-line @next/next/no-img-element */}
                                            <img key={`f${vivo.ch}`} src={`/api/nvr/snapshot?nvr=${encodeURIComponent(device.id)}&ch=${vivo.ch}`} alt=""
                                                className={cn("absolute inset-0 w-full h-full object-cover transition-opacity", vivo.listo ? "opacity-0" : "opacity-100")}
                                                onError={(e) => { (e.target as HTMLImageElement).style.visibility = "hidden"; }} />
                                            {vivo.stream && !vivo.falla && (
                                                <video key={vivo.stream} src={`/go2rtc/api/stream.mp4?src=${encodeURIComponent(vivo.stream)}&video=h264`} autoPlay muted playsInline
                                                    onPlaying={() => setVivo((v) => (v ? { ...v, listo: true } : v))} onError={() => setVivo((v) => (v ? { ...v, falla: true } : v))}
                                                    className={cn("absolute inset-0 w-full h-full object-cover transition-opacity", vivo.listo ? "opacity-100" : "opacity-0")} />
                                            )}
                                            {!vivo.listo && !vivo.falla && <span className="absolute right-3 top-3 inline-flex items-center gap-1.5 text-[11px] font-semibold text-white/80"><Loader2 size={13} className="animate-spin" /> Conectando el vivo…</span>}
                                            {vivo.falla && <span className="absolute right-3 top-3 text-[11px] font-semibold text-white/70">Sin vivo: se muestra la foto del canal</span>}
                                            <span className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/80 to-transparent pointer-events-none" />
                                            <div className="absolute left-4 right-4 bottom-2.5 flex items-end gap-2 text-[12px]">
                                                <span className="px-1.5 rounded bg-black/60 font-mono font-bold">D{vivo.ch}</span>
                                                <span className="min-w-0 truncate font-semibold">{canalVivo?.nombre || `Canal ${vivo.ch}`}</span>
                                                <span className="text-white/60 font-mono truncate">{canalVivo?.ip || ""}{canalVivo?.modelo ? ` · ${canalVivo.modelo}` : ""}</span>
                                                <span className="ml-auto text-white/70 whitespace-nowrap">{canalVivo?.equipo ? `En OmniAccess: ${canalVivo.equipo.nombre}` : "No dada de alta"}</span>
                                            </div>
                                        </div>
                                    </div>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>
                )}
            </div>

            {/* La salud del grabador */}
            <div className="px-5 py-4 mt-1 space-y-2.5">
                <div className="flex flex-wrap items-center gap-1.5">
                    {!salud ? (
                        cargando ? <span className={cn(chip, "text-white/60")}><Loader2 size={11} className="animate-spin" /> Midiendo…</span> : null
                    ) : !salud.alcanzable ? (
                        <span className={cn(chip, "text-[var(--mal)]")}><AlertTriangle size={11} /> No contesta</span>
                    ) : (
                        <>
                            <span className={cn(chip, "text-[var(--bien)]")}><Wifi size={11} /> En línea{salud.latenciaMs != null ? ` · ${salud.latenciaMs} ms` : ""}</span>
                            {salud.uptimeSec != null && <span className={chip}><Timer size={11} /> Prendido hace {hace(salud.uptimeSec)}</span>}
                            {salud.memoriaPct != null && <span className={chip}><MemoryStick size={11} /> Memoria {salud.memoriaPct} %</span>}
                        </>
                    )}
                </div>
                {salud?.discos && (
                    salud.discos.length === 0 ? (
                        <div className="text-[12px] text-[var(--mal)] inline-flex items-center gap-1.5"><AlertTriangle size={13} /> Sin discos: este grabador no está guardando nada.</div>
                    ) : (
                        <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${Math.min(salud.discos.length, 2)}, minmax(0, 1fr))` }}>
                            {salud.discos.map((d) => {
                                const sano = d.estado === "ok";
                                const lleno = d.usadoPct >= DISCO_LLENO_PCT;
                                return (
                                    <div key={d.nombre} className="rounded-[6px] bg-white/[0.05] px-2.5 py-2" title={`${d.modelo || ""} · estado «${d.estado}»`}>
                                        <div className="flex items-center gap-1.5 text-[11.5px]">
                                            <HardDrive size={12} className={sano ? "text-white/60" : "text-[var(--mal)]"} />
                                            <span className="font-semibold">{d.nombre}</span>
                                            <span className="text-white/50 tabular-nums">{d.capacidadGB >= 1000 ? `${(d.capacidadGB / 1000).toFixed(1)} TB` : `${d.capacidadGB} GB`}</span>
                                            <span className={cn("ml-auto font-bold", sano ? "text-[var(--bien)]" : "text-[var(--mal)]")}>{sano ? "Sano" : d.estado}</span>
                                        </div>
                                        <div className="mt-1.5 h-1 rounded-full bg-white/10 overflow-hidden"><div className="h-full bg-white/50" style={{ width: `${d.usadoPct}%` }} /></div>
                                        <div className="mt-1 text-[10.5px] text-white/45 tabular-nums">{d.usadoPct} % ocupado{lleno ? " · lleno: graba encima de lo más viejo" : ""}</div>
                                    </div>
                                );
                            })}
                        </div>
                    )
                )}
            </div>
        </div>
    );
}
