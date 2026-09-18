"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Polyline, CircleMarker, Marker, Tooltip as LTooltip, useMap } from "react-leaflet";
import L from "leaflet";
import { AnimatePresence, motion } from "framer-motion";
import { Route, Search, Play, Pause, X, Clock, Camera, Loader2, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";

const vidrio = "bg-[#0a0d12]/80 backdrop-blur-2xl border border-white/[0.08] shadow-2xl shadow-black/50";
const resorte = { type: "spring" as const, stiffness: 420, damping: 34, mass: 0.7 };

export type Punto = {
    id: string; plate: string; deviceId: string | null; cameraName: string | null;
    lat: number; lng: number; timestamp: string; source: string;
    eventType: string | null; decision: string | null; confidence: number | null; snapshotUrl: string | null;
};
export type Tramo = { desde: string; hasta: string; segundos: number; metros: number; kmh: number | null };

/** Punto luminoso que representa al vehiculo sobre el recorrido. */
const iconoVehiculo = typeof window !== "undefined"
    ? L.divIcon({
        className: "bg-transparent border-0 omni-vehiculo",
        html: `<span style="display:block;width:16px;height:16px;border-radius:50%;background:#fbbf24;border:3px solid #fff7ed;box-shadow:0 0 0 6px rgba(251,191,36,.22)"></span>`,
        iconSize: [16, 16], iconAnchor: [8, 8],
    })
    : (undefined as any);

const hora = (t: string) => new Date(t).toLocaleTimeString("es-UY", { hour: "2-digit", minute: "2-digit" });
const fechaHora = (t: string) => new Date(t).toLocaleString("es-UY", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

/** Dibuja el recorrido dentro del mapa: linea, puntos y el avance. */
export function CapaRecorrido({ puntos, indice }: { puntos: Punto[]; indice: number }) {
    const map = useMap();
    const linea = useMemo(() => puntos.map((p) => [p.lat, p.lng] as [number, number]), [puntos]);
    const hasta = Math.min(indice, puntos.length - 1);
    const recorrida = linea.slice(0, hasta + 1);

    // El vehiculo no salta entre camaras: se desliza de una a la siguiente.
    const [vehiculo, setVehiculo] = useState<[number, number] | null>(null);
    const anim = useRef<number | null>(null);
    const previo = useRef<[number, number] | null>(null);

    useEffect(() => {
        if (!linea.length) { setVehiculo(null); previo.current = null; return; }
        const destino = linea[Math.max(0, Math.min(hasta, linea.length - 1))];
        const origen = previo.current || destino;
        previo.current = destino;

        const t0 = performance.now();
        const dur = 750;
        if (anim.current) cancelAnimationFrame(anim.current);
        const paso = (t: number) => {
            const k = Math.min(1, (t - t0) / dur);
            // suavizado: arranca y frena despacio
            const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
            setVehiculo([
                origen[0] + (destino[0] - origen[0]) * e,
                origen[1] + (destino[1] - origen[1]) * e,
            ]);
            if (k < 1) anim.current = requestAnimationFrame(paso);
        };
        anim.current = requestAnimationFrame(paso);
        return () => { if (anim.current) cancelAnimationFrame(anim.current); };
    }, [hasta, linea]);

    useEffect(() => {
        if (linea.length >= 2) {
            try { map.fitBounds(linea as any, { paddingTopLeft: [240, 90], paddingBottomRight: [240, 220], maxZoom: 18 }); } catch { }
        } else if (linea.length === 1) {
            map.setView(linea[0], 18);
        }
    }, [linea, map]);

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
                    {/* pulsos que corren por el camino, como los trazos de viaje */}
                    <Polyline positions={recorrida} pathOptions={{ color: "#fff7ed", weight: 2.5, opacity: 0.9, className: "omni-flujo" }} />
                </>
            )}

            {vehiculo && (
                <Marker position={vehiculo} icon={iconoVehiculo} interactive={false} />
            )}

            {puntos.map((p, i) => {
                const actual = i === hasta;
                const pasado = i <= hasta;
                const color = p.source === "TRACK" ? "#a855f7" : p.decision === "DENY" ? "#f43f5e" : "#10b981";
                return (
                    <CircleMarker
                        key={p.id}
                        center={[p.lat, p.lng]}
                        radius={actual ? 10 : pasado ? 6.5 : 4.5}
                        pathOptions={{
                            color: actual ? "#fbbf24" : color,
                            weight: actual ? 3 : 1.5,
                            fillColor: color,
                            fillOpacity: pasado ? 0.92 : 0.3,
                            className: actual ? "omni-punto-actual" : undefined,
                        }}
                    >
                        <LTooltip direction="top" offset={[0, -8]} className="cam-name-tip">
                            {i + 1}. {p.cameraName || "Cámara"} · {hora(p.timestamp)}
                        </LTooltip>
                    </CircleMarker>
                );
            })}
        </>
    );
}

/**
 * Buscador y reproductor del recorrido. Vive abajo al centro, como una tarjeta
 * que sube: asi no pisa las columnas de entradas y salidas, que van a los lados.
 */
export function PanelRecorrido({
    puntos, tramos, cargando, error, sinUbicacion,
    plate, setPlate, horas, setHoras, buscar, limpiar,
    indice, setIndice,
}: {
    puntos: Punto[]; tramos: Tramo[]; cargando: boolean; error: string | null; sinUbicacion: number;
    plate: string; setPlate: (v: string) => void;
    horas: number; setHoras: (v: number) => void;
    buscar: () => void; limpiar: () => void;
    indice: number; setIndice: (n: number) => void;
}) {
    const [reproduciendo, setReproduciendo] = useState(false);
    const [abierto, setAbierto] = useState(false);
    const timer = useRef<any>(null);

    useEffect(() => {
        if (!reproduciendo || puntos.length === 0) return;
        timer.current = setInterval(() => {
            setIndice((prev: any) => {
                const n = (typeof prev === "number" ? prev : 0) + 1;
                if (n >= puntos.length) { setReproduciendo(false); return puntos.length - 1; }
                return n;
            });
        }, 850);
        return () => clearInterval(timer.current);
    }, [reproduciendo, puntos.length, setIndice]);

    useEffect(() => { if (puntos.length) setAbierto(true); }, [puntos.length]);

    const duracion = puntos.length >= 2
        ? Math.round((new Date(puntos[puntos.length - 1].timestamp).getTime() - new Date(puntos[0].timestamp).getTime()) / 60000)
        : 0;
    const metros = tramos.reduce((a, t) => a + t.metros, 0);
    const actual = puntos[Math.min(indice, puntos.length - 1)];

    return (
        <div className="absolute bottom-5 left-1/2 -translate-x-1/2 z-[520] w-[min(560px,calc(100vw-2rem))] pointer-events-none">
            <motion.div layout transition={resorte}
                className={cn("rounded-[26px] overflow-hidden pointer-events-auto", vidrio)}>

                {/* barra de busqueda, siempre visible */}
                <motion.div layout className="flex items-center gap-2 p-2">
                    <div className="relative flex-1">
                        <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-white/35" />
                        <input
                            value={plate}
                            onChange={(e) => setPlate(e.target.value.toUpperCase())}
                            onKeyDown={(e) => e.key === "Enter" && buscar()}
                            placeholder="Seguir una matrícula…"
                            className="w-full h-11 pl-10 pr-3 rounded-[18px] bg-white/[0.06] text-[15px] font-semibold tracking-wide text-white placeholder:text-white/30 placeholder:font-normal placeholder:tracking-normal outline-none focus:bg-white/[0.1] transition-colors"
                        />
                    </div>

                    <div className="flex items-center rounded-[18px] bg-white/[0.06] p-0.5">
                        {[1, 6, 24, 72].map((h) => (
                            <button key={h} onClick={() => setHoras(h)}
                                className="relative px-2.5 h-10 text-[11px] font-bold text-white/60 transition-colors hover:text-white">
                                {abierto || horas === h ? (horas === h && (
                                    <motion.span layoutId="rango-activo" transition={resorte}
                                        className="absolute inset-0 rounded-[15px] bg-white/[0.14]" />
                                )) : null}
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
                        <motion.div
                            key="detalle"
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: "auto", opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={resorte}
                            className="overflow-hidden"
                        >
                            <div className="px-3 pb-3 space-y-3">
                                {error && <p className="text-xs text-rose-400 px-1">{error}</p>}
                                {sinUbicacion > 0 && (
                                    <p className="text-[11px] text-amber-400/90 px-1">
                                        {sinUbicacion} detección(es) sin cámara ubicada en el mapa.
                                    </p>
                                )}

                                {puntos.length > 0 && (
                                    <>
                                        <div className="flex items-center gap-3 px-1">
                                            <motion.button whileTap={{ scale: 0.9 }} onClick={() => setReproduciendo((r) => !r)}
                                                className="h-9 w-9 rounded-full bg-white/[0.1] hover:bg-white/[0.16] text-white flex items-center justify-center shrink-0 transition-colors">
                                                {reproduciendo ? <Pause size={15} /> : <Play size={15} className="ml-0.5" />}
                                            </motion.button>

                                            <div className="flex-1">
                                                <input type="range" min={0} max={puntos.length - 1} value={Math.min(indice, puntos.length - 1)}
                                                    onChange={(e) => setIndice(Number(e.target.value))}
                                                    className="w-full accent-amber-400 cursor-pointer" />
                                                <div className="flex items-center justify-between text-[10px] text-white/45 mt-0.5">
                                                    <span>{hora(puntos[0].timestamp)}</span>
                                                    <span className="text-white/70 font-semibold">
                                                        {puntos.length} detecciones · {metros} m · {duracion} min
                                                    </span>
                                                    <span>{hora(puntos[puntos.length - 1].timestamp)}</span>
                                                </div>
                                            </div>

                                            <motion.button whileTap={{ scale: 0.9 }} onClick={() => { setReproduciendo(false); limpiar(); }}
                                                className="h-9 w-9 rounded-full bg-white/[0.06] hover:bg-white/[0.14] text-white/60 flex items-center justify-center shrink-0 transition-colors"
                                                title="Limpiar">
                                                <X size={15} />
                                            </motion.button>
                                        </div>

                                        {actual && (
                                            <motion.div layout className="flex items-center gap-3 rounded-2xl bg-white/[0.05] px-3 py-2">
                                                <span className="w-7 h-7 rounded-xl flex items-center justify-center text-[11px] font-bold shrink-0 bg-amber-400 text-black">
                                                    {Math.min(indice, puntos.length - 1) + 1}
                                                </span>
                                                <span className="min-w-0 flex-1">
                                                    <span className="block text-[13px] font-semibold text-white truncate">{actual.cameraName || "Cámara"}</span>
                                                    <span className="block text-[10px] text-white/45 flex items-center gap-1">
                                                        <Clock size={9} /> {fechaHora(actual.timestamp)} ·{" "}
                                                        {actual.source === "TRACK" ? "cámara común" : "LPR"}
                                                        {actual.confidence != null && <> · {Math.round(actual.confidence * 100)}%</>}
                                                    </span>
                                                </span>
                                                {actual.snapshotUrl && (
                                                    <a href={actual.snapshotUrl} target="_blank" rel="noreferrer"
                                                        className="h-8 w-8 rounded-xl bg-white/[0.08] hover:bg-white/[0.16] text-white/70 flex items-center justify-center transition-colors shrink-0">
                                                        <Camera size={14} />
                                                    </a>
                                                )}
                                            </motion.div>
                                        )}

                                        <div className="flex gap-1.5 overflow-x-auto pb-1 custom-scrollbar">
                                            {puntos.map((p, i) => (
                                                <motion.button key={p.id} whileTap={{ scale: 0.95 }} onClick={() => setIndice(i)}
                                                    className={cn(
                                                        "shrink-0 px-2.5 py-1.5 rounded-xl text-[10px] font-semibold transition-colors",
                                                        i === indice ? "bg-amber-400 text-black" : "bg-white/[0.06] text-white/55 hover:bg-white/[0.12]"
                                                    )}>
                                                    {hora(p.timestamp)}
                                                </motion.button>
                                            ))}
                                        </div>
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

/** Estado y consulta del recorrido; lo usa la pantalla del mapa. */
export function useRecorrido() {
    const [plate, setPlate] = useState("");
    const [horas, setHoras] = useState(24);
    const [puntos, setPuntos] = useState<Punto[]>([]);
    const [tramos, setTramos] = useState<Tramo[]>([]);
    const [sinUbicacion, setSinUbicacion] = useState(0);
    const [cargando, setCargando] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [indice, setIndice] = useState(0);

    const buscar = useCallback(async () => {
        const p = plate.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
        if (p.length < 4) return;
        setCargando(true); setError(null);
        try {
            const to = new Date();
            const from = new Date(to.getTime() - horas * 3600 * 1000);
            const r = await fetch(`/api/plates/${encodeURIComponent(p)}/track?from=${from.toISOString()}&to=${to.toISOString()}`);
            if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "No se pudo consultar");
            const d = await r.json();
            setPuntos(d.puntos || []);
            setTramos(d.tramos || []);
            setSinUbicacion(d.sinUbicacion || 0);
            setIndice(Math.max(0, (d.puntos || []).length - 1));
            if (!(d.puntos || []).length) setError("Sin detecciones en ese período.");
        } catch (e: any) {
            setError(e.message || "Error de consulta");
            setPuntos([]); setTramos([]);
        } finally { setCargando(false); }
    }, [plate, horas]);

    const limpiar = useCallback(() => { setPuntos([]); setTramos([]); setIndice(0); setSinUbicacion(0); setError(null); }, []);

    return { plate, setPlate, horas, setHoras, puntos, tramos, sinUbicacion, cargando, error, indice, setIndice, buscar, limpiar };
}
