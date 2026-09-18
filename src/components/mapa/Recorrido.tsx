"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Polyline, CircleMarker, Marker, Tooltip as LTooltip, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import { AnimatePresence, motion } from "framer-motion";
import { Route, Search, Play, Pause, X, Clock, Camera, Loader2, ChevronUp, Video, Spline, Gauge, Crosshair } from "lucide-react";
import { cn } from "@/lib/utils";

const vidrio = "bg-[#0a0d12]/80 backdrop-blur-2xl border border-white/[0.08] shadow-2xl shadow-black/50";
const resorte = { type: "spring" as const, stiffness: 420, damping: 34, mass: 0.7 };

export type Punto = {
    id: string; plate: string; deviceId: string | null; cameraName: string | null;
    lat: number; lng: number; timestamp: string; source: string;
    eventType: string | null; decision: string | null; confidence: number | null; snapshotUrl: string | null;
};
export type Tramo = { desde: string; hasta: string; segundos: number; metros: number; kmh: number | null };
export type Lugar = { tipo: "camara" | "calle"; id: string; nombre: string; lat: number; lng: number };

const hora = (t: string) => new Date(t).toLocaleTimeString("es-UY", { hour: "2-digit", minute: "2-digit" });
const fechaHora = (t: string) => new Date(t).toLocaleString("es-UY", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const duracionCorta = (seg: number) => seg < 60 ? `${Math.round(seg)} s` : seg < 3600 ? `${Math.round(seg / 60)} min` : `${Math.floor(seg / 3600)} h ${Math.round((seg % 3600) / 60)} min`;

const iconoVehiculo = typeof window !== "undefined"
    ? L.divIcon({
        className: "bg-transparent border-0 omni-vehiculo",
        html: `<span style="display:block;width:16px;height:16px;border-radius:50%;background:#fbbf24;border:3px solid #fff7ed;box-shadow:0 0 0 6px rgba(251,191,36,.22)"></span>`,
        iconSize: [16, 16], iconAnchor: [8, 8],
    })
    : (undefined as any);

/**
 * Marcador de una parada: el número adentro, no en el globo de ayuda.
 *
 * El orden es la mitad de la información de un recorrido, y antes había que pasar el
 * mouse por cada punto para saber cuál venía primero. Ahora se lee de un vistazo.
 */
function iconoParada(n: number, estado: "pasado" | "actual" | "futuro", color: string, esFin: boolean) {
    const tam = estado === "actual" ? 30 : 22;
    const fondo = estado === "futuro" ? "rgba(10,13,18,.75)" : color;
    const borde = estado === "actual" ? "#fbbf24" : estado === "futuro" ? "rgba(255,255,255,.25)" : "rgba(255,255,255,.65)";
    const texto = estado === "futuro" ? "rgba(255,255,255,.55)" : "#0a0d12";
    return L.divIcon({
        className: "bg-transparent border-0",
        html: `<span style="display:flex;align-items:center;justify-content:center;width:${tam}px;height:${tam}px;border-radius:50%;
            background:${fondo};border:2px solid ${borde};color:${texto};font:700 ${estado === "actual" ? 12 : 10}px/1 ui-sans-serif,system-ui;
            box-shadow:0 2px 10px rgba(0,0,0,.55)${estado === "actual" ? ",0 0 0 7px rgba(251,191,36,.18)" : ""}">${esFin ? "◼" : n}</span>`,
        iconSize: [tam, tam], iconAnchor: [tam / 2, tam / 2],
    });
}

/** Punta de flecha sobre el camino: sin esto no se sabe hacia dónde iba. */
function iconoFlecha(angulo: number, encendida: boolean) {
    return L.divIcon({
        className: "bg-transparent border-0",
        html: `<span style="display:block;transform:rotate(${angulo}deg);color:${encendida ? "#fbbf24" : "rgba(56,189,248,.5)"};
            font:700 13px/1 ui-sans-serif,system-ui;text-shadow:0 1px 4px rgba(0,0,0,.8)">➤</span>`,
        iconSize: [13, 13], iconAnchor: [6.5, 6.5],
    });
}

/** Interpola la posición del vehículo dentro del tramo, no salta de parada en parada. */
function posicionEn(linea: [number, number][], avance: number): [number, number] | null {
    if (!linea.length) return null;
    const a = Math.max(0, Math.min(avance, linea.length - 1));
    const i = Math.floor(a);
    const f = a - i;
    if (i >= linea.length - 1) return linea[linea.length - 1];
    return [
        linea[i][0] + (linea[i + 1][0] - linea[i][0]) * f,
        linea[i][1] + (linea[i + 1][1] - linea[i][1]) * f,
    ];
}

/** Dibuja el recorrido dentro del mapa: camino, sentido, paradas y el vehículo. */
export function CapaRecorrido({ puntos, avance, indice, siguiendo, onElegir }: {
    puntos: Punto[]; avance: number; indice: number; siguiendo?: boolean; onElegir?: (i: number) => void;
}) {
    const map = useMap();
    const linea = useMemo(() => puntos.map((p) => [p.lat, p.lng] as [number, number]), [puntos]);
    const [zoom, setZoom] = useState(0);
    useMapEvents({ zoomend: () => setZoom((z) => z + 1) });

    const vehiculo = posicionEn(linea, avance);
    const hasta = Math.floor(Math.max(0, Math.min(avance, linea.length - 1)));

    /** El camino ya recorrido, cortado justo donde va el vehículo. */
    const recorrida = useMemo(() => {
        if (!vehiculo || linea.length < 2) return [];
        return [...linea.slice(0, hasta + 1), vehiculo];
    }, [linea, hasta, vehiculo]);

    /** Flechas de sentido en el medio de cada tramo, giradas según se ven en pantalla. */
    const flechas = useMemo(() => {
        if (linea.length < 2) return [];
        const out: { pos: [number, number]; ang: number; i: number }[] = [];
        for (let i = 0; i < linea.length - 1; i++) {
            const a = linea[i], b = linea[i + 1];
            try {
                const pa = map.latLngToLayerPoint(a as any), pb = map.latLngToLayerPoint(b as any);
                if (Math.hypot(pb.x - pa.x, pb.y - pa.y) < 26) continue;  // tramo muy corto en pantalla
                out.push({
                    pos: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2],
                    ang: (Math.atan2(pb.y - pa.y, pb.x - pa.x) * 180) / Math.PI,
                    i,
                });
            } catch { }
        }
        return out;
        // zoom entra a propósito: al cambiar la escala cambia el ángulo en pantalla.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [linea, map, zoom]);

    // Encuadre inicial: una sola vez por recorrido, no en cada cuadro de la reproducción.
    useEffect(() => {
        if (linea.length >= 2) {
            try { map.fitBounds(linea as any, { paddingTopLeft: [240, 90], paddingBottomRight: [240, 220], maxZoom: 18 }); } catch { }
        } else if (linea.length === 1) {
            map.setView(linea[0], 18);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [puntos]);

    // Seguir al vehículo, pero solo cuando se está por salir de la vista: mover el mapa
    // en cada cuadro marea y pelea con quien quiera arrastrarlo.
    useEffect(() => {
        if (!siguiendo || !vehiculo) return;
        try {
            const p = map.latLngToContainerPoint(vehiculo as any);
            const t = map.getSize();
            const margenX = t.x * 0.28, margenY = t.y * 0.28;
            if (p.x < margenX || p.x > t.x - margenX || p.y < margenY || p.y > t.y - margenY) {
                map.panTo(vehiculo as any, { animate: true, duration: 0.6 });
            }
        } catch { }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [vehiculo?.[0], vehiculo?.[1], siguiendo]);

    if (!puntos.length) return null;

    return (
        <>
            {linea.length >= 2 && (
                <>
                    <Polyline positions={linea} pathOptions={{ color: "#0ea5e9", weight: 10, opacity: 0.12 }} />
                    <Polyline positions={linea} pathOptions={{ color: "#38bdf8", weight: 2.5, opacity: 0.35, dashArray: "3 9" }} />
                </>
            )}
            {recorrida.length >= 2 && (
                <>
                    <Polyline positions={recorrida} pathOptions={{ color: "#f59e0b", weight: 12, opacity: 0.16 }} />
                    <Polyline positions={recorrida} pathOptions={{ color: "#fbbf24", weight: 4, opacity: 0.9 }} />
                    <Polyline positions={recorrida} pathOptions={{ color: "#fff7ed", weight: 2.5, opacity: 0.9, className: "omni-flujo" }} />
                </>
            )}

            {flechas.map((f) => (
                <Marker key={`f${f.i}`} position={f.pos} icon={iconoFlecha(f.ang, f.i < hasta)} interactive={false} />
            ))}

            {vehiculo && <Marker position={vehiculo} icon={iconoVehiculo} interactive={false} zIndexOffset={600} />}

            {puntos.map((p, i) => {
                const estado = i === indice ? "actual" : i <= hasta ? "pasado" : "futuro";
                const color = p.source === "TRACK" ? "#a855f7" : p.decision === "DENY" ? "#f43f5e" : "#10b981";
                return (
                    <Marker
                        key={p.id}
                        position={[p.lat, p.lng]}
                        icon={iconoParada(i + 1, estado as any, color, i === puntos.length - 1)}
                        zIndexOffset={estado === "actual" ? 500 : 0}
                        eventHandlers={{ click: () => onElegir?.(i) }}
                    >
                        <LTooltip direction="top" offset={[0, -14]} className="cam-name-tip">
                            {i + 1}. {p.cameraName || "Cámara"} · {hora(p.timestamp)}
                        </LTooltip>
                    </Marker>
                );
            })}
        </>
    );
}

/**
 * Buscador y reproductor del recorrido. Vive abajo al centro, como una tarjeta que sube:
 * así no pisa las columnas de entradas y salidas, que van a los lados.
 */
export function PanelRecorrido({
    puntos, tramos, cargando, error, sinUbicacion,
    plate, setPlate, horas, setHoras, buscar, limpiar,
    indice, setIndice, avance, setAvance,
    reproduciendo, setReproduciendo, velocidad, setVelocidad, siguiendo, setSiguiendo,
    lugares = [], onIrA, onVerCuadro,
}: {
    puntos: Punto[]; tramos: Tramo[]; cargando: boolean; error: string | null; sinUbicacion: number;
    plate: string; setPlate: (v: string) => void;
    horas: number; setHoras: (v: number) => void;
    buscar: () => void; limpiar: () => void;
    indice: number; setIndice: (n: number) => void;
    avance: number; setAvance: (n: number) => void;
    reproduciendo: boolean; setReproduciendo: (v: boolean) => void;
    velocidad: number; setVelocidad: (v: number) => void;
    siguiendo: boolean; setSiguiendo: (v: boolean) => void;
    lugares?: Lugar[];
    onIrA?: (lugar: Lugar) => void;
    onVerCuadro?: (p: Punto) => void;
}) {
    const [abierto, setAbierto] = useState(false);
    useEffect(() => { if (puntos.length) setAbierto(true); }, [puntos.length]);

    const t0 = puntos.length ? new Date(puntos[0].timestamp).getTime() : 0;
    const tN = puntos.length ? new Date(puntos[puntos.length - 1].timestamp).getTime() : 0;
    const lapso = Math.max(1, tN - t0);
    const duracion = Math.round(lapso / 60000);
    const metros = tramos.reduce((a, t) => a + t.metros, 0);
    const actual = puntos[Math.min(indice, puntos.length - 1)];
    const tramoPrevio = indice > 0 ? tramos[indice - 1] : null;

    return (
        <div className="absolute bottom-5 left-1/2 -translate-x-1/2 z-[520] w-[min(620px,calc(100vw-2rem))] pointer-events-none">
            <motion.div layout transition={resorte}
                className={cn("rounded-[26px] overflow-hidden pointer-events-auto", vidrio)}>

                <AnimatePresence initial={false}>
                    {lugares.length > 0 && (
                        <motion.div key="lugares" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                            transition={resorte} className="overflow-hidden border-b border-white/[0.07]">
                            <p className="px-4 pt-2.5 pb-1 text-[9px] font-bold uppercase tracking-[0.18em] text-white/35">Ir a</p>
                            <div className="pb-1.5 max-h-40 overflow-y-auto">
                                {lugares.map((l) => (
                                    <button key={l.tipo + l.id} onClick={() => onIrA?.(l)}
                                        className="w-full flex items-center gap-2.5 px-4 py-2 text-left hover:bg-white/[0.08] transition-colors">
                                        {l.tipo === "camara"
                                            ? <Video size={13} className="text-blue-400 shrink-0" />
                                            : <Spline size={13} className="text-sky-400 shrink-0" />}
                                        <span className="text-[12.5px] text-white/85 truncate">{l.nombre}</span>
                                        <span className="ml-auto text-[10px] text-white/30 uppercase tracking-wider">{l.tipo}</span>
                                    </button>
                                ))}
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>

                <motion.div layout className="flex items-center gap-2 p-2">
                    <div className="relative flex-1">
                        <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-white/35" />
                        <input
                            value={plate}
                            onChange={(e) => setPlate(e.target.value.toUpperCase())}
                            onKeyDown={(e) => e.key === "Enter" && buscar()}
                            placeholder="Matrícula, cámara o calle…"
                            className="w-full h-11 pl-10 pr-3 rounded-[18px] bg-white/[0.06] text-[15px] font-semibold tracking-wide text-white placeholder:text-white/30 placeholder:font-normal placeholder:tracking-normal outline-none focus:bg-white/[0.1] transition-colors"
                        />
                    </div>

                    <div className="flex items-center rounded-[18px] bg-white/[0.06] p-0.5">
                        {[1, 6, 24, 72].map((h) => (
                            <button key={h} onClick={() => setHoras(h)}
                                className="relative px-2.5 h-10 text-[11px] font-bold text-white/60 transition-colors hover:text-white">
                                {horas === h && (
                                    <motion.span layoutId="rango-activo" transition={resorte}
                                        className="absolute inset-0 rounded-[15px] bg-white/[0.14]" />
                                )}
                                <span className={cn("relative", horas === h && "text-white")}>{h < 24 ? `${h}h` : `${h / 24}d`}</span>
                            </button>
                        ))}
                    </div>

                    <motion.button whileTap={{ scale: 0.94 }} onClick={buscar} disabled={cargando || plate.trim().length < 4}
                        className="h-11 w-11 rounded-[18px] bg-amber-500 text-black disabled:opacity-30 disabled:bg-white/10 disabled:text-white/40 flex items-center justify-center transition-colors"
                        title="Trazar recorrido">
                        {cargando ? <Loader2 size={17} className="animate-spin" /> : <Route size={17} />}
                    </motion.button>

                    {puntos.length > 0 && (
                        <motion.button whileTap={{ scale: 0.94 }} onClick={() => setAbierto((o) => !o)}
                            className="h-11 w-9 rounded-[18px] text-white/50 hover:text-white flex items-center justify-center">
                            <motion.span animate={{ rotate: abierto ? 0 : 180 }} transition={resorte}><ChevronUp size={16} /></motion.span>
                        </motion.button>
                    )}
                </motion.div>

                <AnimatePresence initial={false}>
                    {abierto && (puntos.length > 0 || error || sinUbicacion > 0) && (
                        <motion.div key="detalle"
                            initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                            transition={resorte} className="overflow-hidden">
                            <div className="px-3 pb-3 space-y-2.5">
                                {error && <p className="text-xs text-rose-400 px-1">{error}</p>}
                                {sinUbicacion > 0 && (
                                    <p className="text-[11px] text-amber-400/90 px-1">
                                        {sinUbicacion} detección(es) de cámaras que todavía no están ubicadas en el mapa.
                                    </p>
                                )}

                                {puntos.length > 0 && (
                                    <>
                                        {/* Resumen del recorrido, antes de los controles */}
                                        <div className="flex items-center gap-2 px-1 text-[11px]">
                                            <span className="font-mono font-bold tracking-widest text-white text-[13px]">{puntos[0].plate}</span>
                                            <span className="text-white/30">·</span>
                                            <span className="text-white/60">{puntos.length} detecciones</span>
                                            <span className="text-white/30">·</span>
                                            <span className="text-white/60">{metros >= 1000 ? `${(metros / 1000).toFixed(1)} km` : `${metros} m`}</span>
                                            <span className="text-white/30">·</span>
                                            <span className="text-white/60">{duracion < 60 ? `${duracion} min` : `${Math.floor(duracion / 60)} h ${duracion % 60} min`}</span>
                                            <button onClick={() => { setReproduciendo(false); limpiar(); }}
                                                className="ml-auto h-7 w-7 rounded-full bg-white/[0.06] hover:bg-white/[0.14] text-white/50 hover:text-white flex items-center justify-center transition-colors"
                                                title="Limpiar el recorrido">
                                                <X size={13} />
                                            </button>
                                        </div>

                                        {/* Línea de tiempo REAL: la separación entre paradas es el tiempo que
                                            pasó. Una fila de fichas iguales escondía justo lo que interesa,
                                            que es dónde el vehículo se quedó quieto y dónde pasó de largo. */}
                                        <LineaDeTiempo puntos={puntos} t0={t0} lapso={lapso} avance={avance} indice={indice}
                                            onElegir={(i) => { setReproduciendo(false); setAvance(i); }} />

                                        <div className="flex items-center gap-2 px-1">
                                            <motion.button whileTap={{ scale: 0.9 }}
                                                onClick={() => {
                                                    // Si terminó, volver a empezar en vez de no hacer nada.
                                                    if (!reproduciendo && avance >= puntos.length - 1) setAvance(0);
                                                    setReproduciendo(!reproduciendo);
                                                }}
                                                className="h-9 w-9 rounded-full bg-amber-400 text-black hover:bg-amber-300 flex items-center justify-center shrink-0 transition-colors">
                                                {reproduciendo ? <Pause size={15} /> : <Play size={15} className="ml-0.5" />}
                                            </motion.button>

                                            <div className="flex items-center rounded-full bg-white/[0.06] p-0.5">
                                                {[1, 2, 4].map((v) => (
                                                    <button key={v} onClick={() => setVelocidad(v)}
                                                        className={cn("px-2 h-7 rounded-full text-[10px] font-bold transition-colors",
                                                            velocidad === v ? "bg-white/[0.16] text-white" : "text-white/45 hover:text-white")}>
                                                        {v}×
                                                    </button>
                                                ))}
                                            </div>

                                            <button onClick={() => setSiguiendo(!siguiendo)}
                                                title={siguiendo ? "El mapa sigue al vehículo" : "El mapa queda quieto"}
                                                className={cn("h-7 px-2.5 rounded-full text-[10px] font-bold flex items-center gap-1.5 transition-colors",
                                                    siguiendo ? "bg-white/[0.16] text-white" : "bg-white/[0.06] text-white/45 hover:text-white")}>
                                                <Crosshair size={11} /> seguir
                                            </button>

                                            <span className="ml-auto text-[10px] text-white/45 tabular-nums">
                                                {hora(puntos[0].timestamp)} → {hora(puntos[puntos.length - 1].timestamp)}
                                            </span>
                                        </div>

                                        {/* La parada donde está parado el reproductor */}
                                        {actual && (
                                            <motion.div layout className="flex items-center gap-3 rounded-2xl bg-white/[0.05] px-2.5 py-2">
                                                <span className="w-7 h-7 rounded-xl flex items-center justify-center text-[11px] font-bold shrink-0 bg-amber-400 text-black">
                                                    {Math.min(indice, puntos.length - 1) + 1}
                                                </span>
                                                <span className="min-w-0 flex-1">
                                                    <span className="block text-[13px] font-semibold text-white truncate">{actual.cameraName || "Cámara"}</span>
                                                    <span className="block text-[10px] text-white/45 flex items-center gap-1 flex-wrap">
                                                        <Clock size={9} /> {fechaHora(actual.timestamp)}
                                                        <span className="text-white/25">·</span>
                                                        {actual.source === "TRACK" ? "cámara interior" : actual.decision === "DENY" ? "acceso denegado" : "acceso"}
                                                        {actual.confidence != null && <><span className="text-white/25">·</span>{Math.round(actual.confidence * 100)}%</>}
                                                    </span>
                                                    {/* Cómo llegó hasta acá desde la parada anterior */}
                                                    {tramoPrevio && (
                                                        <span className="block text-[10px] text-sky-300/70 flex items-center gap-1 mt-0.5">
                                                            <Gauge size={9} />
                                                            {tramoPrevio.metros} m en {duracionCorta(tramoPrevio.segundos)}
                                                            {tramoPrevio.kmh != null && <> · {Math.round(tramoPrevio.kmh)} km/h</>}
                                                        </span>
                                                    )}
                                                </span>
                                                {actual.snapshotUrl && (
                                                    <button onClick={() => onVerCuadro?.(actual)}
                                                        className="relative h-12 w-20 rounded-xl overflow-hidden border border-white/10 hover:border-amber-400/60 transition-colors shrink-0 group">
                                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                                        <img src={actual.snapshotUrl} alt={actual.plate} className="absolute inset-0 w-full h-full object-cover" />
                                                        <span className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                                            <Camera size={14} className="text-white" />
                                                        </span>
                                                    </button>
                                                )}
                                            </motion.div>
                                        )}
                                    </>
                                )}
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </motion.div>
        </div>
    );
}

/**
 * Línea de tiempo con las paradas donde de verdad ocurrieron.
 *
 * Es la diferencia entre "pasó por seis cámaras" y "pasó por tres seguidas, estuvo veinte
 * minutos quieto y después salió": lo segundo es lo que alguien quiere ver, y una fila de
 * fichas del mismo ancho no lo muestra.
 */
function LineaDeTiempo({ puntos, t0, lapso, avance, indice, onElegir }: {
    puntos: Punto[]; t0: number; lapso: number; avance: number; indice: number; onElegir: (i: number) => void;
}) {
    const frac = (p: Punto) => ((new Date(p.timestamp).getTime() - t0) / lapso) * 100;

    // Dónde está el reproductor, en tiempo: interpola entre las dos paradas del tramo.
    const i = Math.floor(Math.max(0, Math.min(avance, puntos.length - 1)));
    const f = Math.max(0, Math.min(avance, puntos.length - 1)) - i;
    const aqui = i >= puntos.length - 1
        ? 100
        : frac(puntos[i]) + (frac(puntos[i + 1]) - frac(puntos[i])) * f;

    return (
        <div className="px-1 pt-1 pb-3">
            <div className="relative h-7">
                <div className="absolute inset-x-0 top-3 h-[3px] rounded-full bg-white/[0.08]" />
                <motion.div className="absolute left-0 top-3 h-[3px] rounded-full bg-amber-400/80"
                    style={{ width: `${aqui}%` }} transition={{ duration: 0.1 }} />

                {puntos.map((p, k) => {
                    const x = frac(p);
                    const pasado = k <= i;
                    const esActual = k === indice;
                    const color = p.source === "TRACK" ? "bg-violet-400" : p.decision === "DENY" ? "bg-rose-400" : "bg-emerald-400";
                    return (
                        <button key={p.id} onClick={() => onElegir(k)}
                            style={{ left: `${x}%` }}
                            title={`${k + 1}. ${p.cameraName || "Cámara"} · ${hora(p.timestamp)}`}
                            className="absolute top-0 -translate-x-1/2 h-7 w-5 flex flex-col items-center justify-start group">
                            <span className={cn("rounded-full transition-all",
                                esActual ? "w-3 h-3 mt-[6px] bg-amber-400 ring-2 ring-amber-300/40"
                                    : pasado ? `w-2 h-2 mt-[8px] ${color}`
                                        : `w-2 h-2 mt-[8px] ${color} opacity-40 group-hover:opacity-80`)} />
                            <span className={cn("mt-1 text-[8.5px] tabular-nums transition-colors whitespace-nowrap",
                                esActual ? "text-amber-300 font-bold" : "text-white/30 group-hover:text-white/60")}>
                                {hora(p.timestamp)}
                            </span>
                        </button>
                    );
                })}
            </div>
        </div>
    );
}

/** Estado, consulta y reproducción del recorrido; lo usa la pantalla del mapa. */
export function useRecorrido() {
    const [plate, setPlate] = useState("");
    const [horas, setHoras] = useState(24);
    const [puntos, setPuntos] = useState<Punto[]>([]);
    const [tramos, setTramos] = useState<Tramo[]>([]);
    const [sinUbicacion, setSinUbicacion] = useState(0);
    const [cargando, setCargando] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // El avance es continuo, no un índice: el vehículo se desliza dentro del tramo en vez
    // de saltar de cámara en cámara, que era lo que hacía parecer el recorrido una
    // sucesión de teletransportes.
    const [avance, setAvance] = useState(0);
    const [reproduciendo, setReproduciendo] = useState(false);
    const [velocidad, setVelocidad] = useState(1);
    const [siguiendo, setSiguiendo] = useState(true);
    const cuadro = useRef<number | null>(null);

    useEffect(() => {
        if (!reproduciendo || puntos.length < 2) return;
        let ultimo = performance.now();
        const paso = (t: number) => {
            const dt = (t - ultimo) / 1000; ultimo = t;
            setAvance((a) => {
                const n = a + dt * 0.8 * velocidad;   // ~1,25 s por tramo a velocidad 1
                if (n >= puntos.length - 1) { setReproduciendo(false); return puntos.length - 1; }
                return n;
            });
            cuadro.current = requestAnimationFrame(paso);
        };
        cuadro.current = requestAnimationFrame(paso);
        return () => { if (cuadro.current) cancelAnimationFrame(cuadro.current); };
    }, [reproduciendo, puntos.length, velocidad]);

    const indice = Math.round(Math.max(0, Math.min(avance, Math.max(0, puntos.length - 1))));
    const setIndice = useCallback((n: number) => setAvance(n), []);

    const buscar = useCallback(async () => {
        const p = plate.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
        if (p.length < 4) return;
        setCargando(true); setError(null); setReproduciendo(false);
        try {
            const to = new Date();
            const from = new Date(to.getTime() - horas * 3600 * 1000);
            const r = await fetch(`/api/plates/${encodeURIComponent(p)}/track?from=${from.toISOString()}&to=${to.toISOString()}`);
            if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "No se pudo consultar");
            const d = await r.json();
            const ps: Punto[] = d.puntos || [];
            setPuntos(ps);
            setTramos(d.tramos || []);
            setSinUbicacion(d.sinUbicacion || 0);
            // Arranca desde el principio y se reproduce solo: al abrir un recorrido lo que
            // se quiere ver es cómo fue, no el último punto quieto.
            setAvance(0);
            if (ps.length >= 2) setTimeout(() => setReproduciendo(true), 700);
            if (!ps.length) setError("Sin detecciones en ese período.");
        } catch (e: any) {
            setError(e.message || "Error de consulta");
            setPuntos([]); setTramos([]);
        } finally { setCargando(false); }
    }, [plate, horas]);

    const limpiar = useCallback(() => {
        setPuntos([]); setTramos([]); setAvance(0); setSinUbicacion(0); setError(null); setReproduciendo(false);
    }, []);

    return {
        plate, setPlate, horas, setHoras, puntos, tramos, sinUbicacion, cargando, error,
        indice, setIndice, avance, setAvance, reproduciendo, setReproduciendo,
        velocidad, setVelocidad, siguiendo, setSiguiendo, buscar, limpiar,
    };
}
