"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Polyline, CircleMarker, Tooltip as LTooltip, useMap } from "react-leaflet";
import { Route, Search, Play, Pause, X, Clock, Camera, Loader2, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export type Punto = {
    id: string; plate: string; deviceId: string | null; cameraName: string | null;
    lat: number; lng: number; timestamp: string; source: string;
    eventType: string | null; decision: string | null; confidence: number | null; snapshotUrl: string | null;
};
export type Tramo = { desde: string; hasta: string; segundos: number; metros: number; kmh: number | null };

const hora = (t: string) => new Date(t).toLocaleTimeString("es-UY", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
const fechaHora = (t: string) => new Date(t).toLocaleString("es-UY", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

/** Dibuja el recorrido dentro del mapa: linea, puntos y el vehiculo animado. */
export function CapaRecorrido({ puntos, indice }: { puntos: Punto[]; indice: number }) {
    const map = useMap();
    const linea = useMemo(() => puntos.map((p) => [p.lat, p.lng] as [number, number]), [puntos]);
    const hasta = Math.min(indice, puntos.length - 1);
    const recorrida = linea.slice(0, hasta + 1);

    useEffect(() => {
        if (linea.length >= 2) {
            try { map.fitBounds(linea as any, { padding: [80, 80], maxZoom: 18 }); } catch { }
        } else if (linea.length === 1) {
            map.setView(linea[0], 18);
        }
    }, [linea, map]);

    if (!puntos.length) return null;

    return (
        <>
            {/* trazo completo, tenue */}
            {linea.length >= 2 && (
                <Polyline positions={linea} pathOptions={{ color: "#38bdf8", weight: 3, opacity: 0.28, dashArray: "4 8" }} />
            )}
            {/* trazo ya recorrido */}
            {recorrida.length >= 2 && (
                <Polyline positions={recorrida} pathOptions={{ color: "#f59e0b", weight: 5, opacity: 0.95 }} />
            )}

            {puntos.map((p, i) => {
                const actual = i === hasta;
                const pasado = i <= hasta;
                const color = p.source === "TRACK" ? "#a855f7" : p.decision === "DENY" ? "#ef4444" : "#10b981";
                return (
                    <CircleMarker
                        key={p.id}
                        center={[p.lat, p.lng]}
                        radius={actual ? 11 : pasado ? 7 : 5}
                        pathOptions={{
                            color: actual ? "#f59e0b" : color,
                            weight: actual ? 3 : 2,
                            fillColor: color,
                            fillOpacity: pasado ? 0.9 : 0.35,
                        }}
                    >
                        <LTooltip direction="top" offset={[0, -6]}>
                            <div style={{ fontSize: 11, fontWeight: 700 }}>
                                {i + 1}. {p.cameraName || "Cámara"}<br />
                                <span style={{ fontWeight: 500, opacity: 0.75 }}>
                                    {hora(p.timestamp)} · {p.source === "TRACK" ? "cámara común" : "LPR"}
                                </span>
                            </div>
                        </LTooltip>
                    </CircleMarker>
                );
            })}
        </>
    );
}

/** Panel de busqueda y reproduccion del recorrido (va fuera del mapa). */
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
    const [abierto, setAbierto] = useState(true);
    const timer = useRef<any>(null);

    useEffect(() => {
        if (!reproduciendo || puntos.length === 0) return;
        timer.current = setInterval(() => {
            setIndice((prev: any) => {
                const n = (typeof prev === "number" ? prev : 0) + 1;
                if (n >= puntos.length) { setReproduciendo(false); return puntos.length - 1; }
                return n;
            });
        }, 900);
        return () => clearInterval(timer.current);
    }, [reproduciendo, puntos.length, setIndice]);

    const duracion = puntos.length >= 2
        ? Math.round((new Date(puntos[puntos.length - 1].timestamp).getTime() - new Date(puntos[0].timestamp).getTime()) / 60000)
        : 0;
    const metros = tramos.reduce((a, t) => a + t.metros, 0);

    return (
        <div className="absolute top-4 left-4 z-[1100] w-[330px] max-w-[calc(100vw-2rem)]">
            <div className="rounded-2xl border border-border bg-card/95 backdrop-blur-xl shadow-2xl overflow-hidden">
                <button onClick={() => setAbierto((o) => !o)}
                    className="w-full flex items-center gap-2.5 px-4 py-3 border-b border-border hover:bg-accent/40 transition">
                    <div className="w-8 h-8 rounded-lg bg-amber-500/15 text-amber-400 flex items-center justify-center"><Route size={16} /></div>
                    <div className="text-left flex-1">
                        <div className="text-sm font-bold text-foreground leading-tight">Recorrido de un vehículo</div>
                        <div className="text-[10px] text-muted-foreground">
                            {puntos.length ? `${puntos.length} detecciones · ${metros} m · ${duracion} min` : "Buscá una matrícula"}
                        </div>
                    </div>
                    <ChevronRight size={15} className={cn("text-muted-foreground transition-transform", abierto && "rotate-90")} />
                </button>

                {abierto && (
                    <div className="p-3 space-y-3">
                        <div className="flex gap-2">
                            <div className="relative flex-1">
                                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                                <input
                                    value={plate}
                                    onChange={(e) => setPlate(e.target.value.toUpperCase())}
                                    onKeyDown={(e) => e.key === "Enter" && buscar()}
                                    placeholder="ABC1234"
                                    className="w-full h-9 pl-8 pr-2 rounded-lg bg-background border border-border text-sm font-bold tracking-wider text-foreground outline-none focus:border-amber-500"
                                />
                            </div>
                            <select value={horas} onChange={(e) => setHoras(Number(e.target.value))}
                                className="h-9 px-2 rounded-lg bg-background border border-border text-xs font-semibold text-foreground outline-none">
                                <option value={1}>1 h</option>
                                <option value={6}>6 h</option>
                                <option value={24}>24 h</option>
                                <option value={72}>3 días</option>
                                <option value={168}>7 días</option>
                            </select>
                        </div>

                        <div className="flex gap-2">
                            <button onClick={buscar} disabled={cargando || plate.trim().length < 4}
                                className="flex-1 h-9 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-white text-xs font-bold uppercase tracking-wider transition flex items-center justify-center gap-2">
                                {cargando ? <Loader2 size={14} className="animate-spin" /> : <Route size={14} />} Trazar
                            </button>
                            {puntos.length > 0 && (
                                <>
                                    <button onClick={() => setReproduciendo((r) => !r)}
                                        className="h-9 w-9 rounded-lg bg-muted hover:bg-accent border border-border text-foreground flex items-center justify-center transition"
                                        title={reproduciendo ? "Pausar" : "Reproducir"}>
                                        {reproduciendo ? <Pause size={14} /> : <Play size={14} />}
                                    </button>
                                    <button onClick={() => { setReproduciendo(false); limpiar(); }}
                                        className="h-9 w-9 rounded-lg bg-muted hover:bg-accent border border-border text-muted-foreground flex items-center justify-center transition"
                                        title="Limpiar">
                                        <X size={14} />
                                    </button>
                                </>
                            )}
                        </div>

                        {error && <p className="text-xs text-red-400">{error}</p>}
                        {!error && !cargando && puntos.length === 0 && plate.length >= 4 && (
                            <p className="text-xs text-muted-foreground">Sin detecciones en ese período.</p>
                        )}
                        {sinUbicacion > 0 && (
                            <p className="text-[11px] text-amber-400/90">
                                {sinUbicacion} detección(es) sin cámara ubicada en el mapa: ubicala para que aparezcan.
                            </p>
                        )}

                        {puntos.length > 0 && (
                            <>
                                <input type="range" min={0} max={puntos.length - 1} value={Math.min(indice, puntos.length - 1)}
                                    onChange={(e) => setIndice(Number(e.target.value))}
                                    className="w-full accent-amber-500 cursor-pointer" />

                                <div className="max-h-64 overflow-y-auto space-y-1.5 pr-1 custom-scrollbar">
                                    {puntos.map((p, i) => {
                                        const t = tramos[i - 1];
                                        return (
                                            <button key={p.id} onClick={() => setIndice(i)}
                                                className={cn(
                                                    "w-full text-left rounded-lg border px-2.5 py-2 transition flex items-center gap-2",
                                                    i === indice ? "border-amber-500/60 bg-amber-500/10" : "border-border bg-background/40 hover:bg-accent/40"
                                                )}>
                                                <span className={cn("w-6 h-6 rounded-md flex items-center justify-center text-[10px] font-bold shrink-0",
                                                    p.source === "TRACK" ? "bg-violet-500/15 text-violet-400" : "bg-emerald-500/15 text-emerald-400")}>
                                                    {i + 1}
                                                </span>
                                                <span className="min-w-0 flex-1">
                                                    <span className="block text-[11px] font-bold text-foreground truncate">{p.cameraName || "Cámara"}</span>
                                                    <span className="block text-[10px] text-muted-foreground flex items-center gap-1">
                                                        <Clock size={9} /> {fechaHora(p.timestamp)}
                                                        {t && <> · {t.metros} m · {t.kmh != null ? `${t.kmh} km/h` : `${t.segundos}s`}</>}
                                                    </span>
                                                </span>
                                                {p.snapshotUrl && <Camera size={12} className="text-muted-foreground shrink-0" />}
                                            </button>
                                        );
                                    })}
                                </div>
                            </>
                        )}
                    </div>
                )}
            </div>
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
        } catch (e: any) {
            setError(e.message || "Error de consulta");
            setPuntos([]); setTramos([]);
        } finally { setCargando(false); }
    }, [plate, horas]);

    const limpiar = useCallback(() => { setPuntos([]); setTramos([]); setIndice(0); setSinUbicacion(0); }, []);

    return { plate, setPlate, horas, setHoras, puntos, tramos, sinUbicacion, cargando, error, indice, setIndice, buscar, limpiar };
}
