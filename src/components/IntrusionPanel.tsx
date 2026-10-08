"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Camera, ChevronDown, ChevronUp, Radar } from "lucide-react";
import { getAnalyticsGeometryBatch, getRecentDetections, type DetItem } from "@/app/actions/detections";
import { useDestello, useTiempoReal } from "@/lib/tiempo-real";
import { Estado, type Tono } from "@/components/ui/celdas";
import { Pista } from "@/components/ui/pista";
import { metaDe, type Geom } from "@/components/intrusion/comun";
import { FichaDeteccion } from "@/components/intrusion/FichaDeteccion";
import { cn } from "@/lib/utils";

/**
 * Las detecciones de las cámaras (cruces de línea, intrusión, zonas) en la columna central
 * del monitor LPR.
 *
 * Tres cosas mal en la versión anterior: cada renglón era una caja roja transparente con
 * texto blanco a la mitad de opacidad — en tema claro el rojo quedaba lavado y el nombre de
 * la cámara no se leía —; tocar una detección no abría nada, así que no había forma de ver
 * qué había cruzado; y abría su propio socket en vez del compartido de la pestaña.
 *
 * Ahora sigue el sistema: superficie de tarjeta, el tipo como chip de tono (rojo cruce e
 * intrusión, ámbar zona, celeste movimiento), texto en tinta normal, la miniatura cuando el
 * evento la tiene, y cada renglón abre la misma ficha que el monitor de intrusión.
 */

/** Cuántas detecciones se muestran. Es un vistazo: el historial completo está en Monitor Intrusión. */
const CUANTAS = 30;

const TONO: Record<string, Tono> = { LINECROSS: "mal", INTRUSION: "mal", REGION_ENTER: "aviso", REGION_EXIT: "aviso", MOTION: "info" };

function hace(ts: string) {
    const s = Math.max(0, Math.floor((Date.now() - new Date(ts).getTime()) / 1000));
    if (s < 60) return `${s} s`;
    const m = Math.floor(s / 60); if (m < 60) return `${m} min`;
    const h = Math.floor(m / 60); if (h < 24) return `${h} h`;
    return new Date(ts).toLocaleDateString("es-UY", { day: "2-digit", month: "2-digit" });
}

export function IntrusionPanel() {
    const [items, setItems] = useState<DetItem[] | null>(null);
    const [error, setError] = useState(false);
    const [abierto, setAbierto] = useState(true);
    const [conMovimiento, setConMovimiento] = useState(false);
    const [ficha, setFicha] = useState<DetItem | null>(null);
    const [geom, setGeom] = useState<Record<string, Geom>>({});
    const { marcar, es } = useDestello();
    const [, tic] = useState(0);

    const cargar = useCallback(() => {
        setError(false);
        getRecentDetections(CUANTAS, conMovimiento).then(setItems).catch(() => setError(true));
    }, [conMovimiento]);
    useEffect(() => { cargar(); }, [cargar]);
    // Los "hace 3 min" se mueven solos.
    useEffect(() => { const iv = setInterval(() => tic((x) => x + 1), 15_000); return () => clearInterval(iv); }, []);

    useTiempoReal<any>("general_detection", (d) => {
        if (!conMovimiento && d.type === "MOTION") return;
        setItems((prev) => [{ id: d.id, deviceId: d.deviceId, deviceName: d.deviceName, type: d.type, eventType: d.eventType, snapshotPath: d.snapshotPath || null, timestamp: d.timestamp }, ...(prev || []).filter((x) => x.id !== d.id)].slice(0, CUANTAS));
        marcar(d.id);
    });

    const abrir = (d: DetItem) => {
        setFicha(d);
        // La línea o la zona dibujada sobre la captura: se pide al abrir, la ficha se muestra igual mientras llega.
        if (d.deviceId && !geom[d.deviceId]) getAnalyticsGeometryBatch([d.deviceId]).then((g) => setGeom((x) => ({ ...x, ...g }))).catch(() => { });
    };

    const analiticas = (items || []).filter((i) => i.type !== "MOTION").length;

    return (
        <div className="shrink-0 border-t border-border bg-card">
            <div className="flex items-center gap-2 px-4 py-2">
                <button type="button" onClick={() => setAbierto((o) => !o)} className="flex items-center gap-2 min-w-0 flex-1 text-left">
                    <Radar size={14} className="text-muted-foreground shrink-0" />
                    <span className="text-[12px] font-bold text-foreground">Detecciones</span>
                    {analiticas > 0 && <Estado tono="mal">{analiticas}</Estado>}
                    {abierto ? <ChevronDown size={14} className="text-muted-foreground" /> : <ChevronUp size={14} className="text-muted-foreground" />}
                </button>
                <Pista texto="Sumar también el movimiento simple. Es mucho más ruidoso: por defecto se muestran sólo cruces, intrusiones y zonas.">
                    <button type="button" onClick={() => setConMovimiento((v) => !v)} aria-pressed={conMovimiento}
                        className={cn("h-7 px-2.5 rounded-full border text-[11px] font-semibold transition-colors",
                            conMovimiento ? "border-[var(--accion)] tono-accion bg-[color-mix(in_oklab,var(--accion)_10%,transparent)]" : "border-border text-muted-foreground hover:bg-accent")}>
                        Movimiento
                    </button>
                </Pista>
                <Pista texto="Todas las detecciones, con video y la línea de cada cámara.">
                    <Link href="/admin/monitor-intrusion" className="h-7 w-7 rounded-md grid place-items-center text-muted-foreground hover:text-[var(--accion)] hover:bg-accent">
                        <ArrowUpRight size={14} />
                    </Link>
                </Pista>
            </div>

            {abierto && (
                <div className="max-h-44 overflow-y-auto custom-scrollbar px-2 pb-2">
                    {error ? (
                        <p className="py-4 text-center text-[12px] text-muted-foreground">No se pudieron traer. <button onClick={cargar} className="tono-accion font-semibold">Reintentar</button></p>
                    ) : items === null ? (
                        <p className="py-4 text-center text-[12px] text-muted-foreground">Cargando…</p>
                    ) : items.length === 0 ? (
                        <p className="py-4 text-center text-[12px] text-muted-foreground">Sin detecciones{conMovimiento ? "" : " (sin contar movimiento)"}.</p>
                    ) : (
                        <div className="divide-y divide-border">
                            {items.map((d) => {
                                const m = metaDe(d.type);
                                return (
                                    <button key={d.id} type="button" onClick={() => abrir(d)}
                                        className={cn("w-full flex items-center gap-2.5 px-2 py-1.5 rounded-md text-left transition-colors hover:bg-accent",
                                            es(d.id) && "bg-[var(--mal-suave)]")}>
                                        <span className="relative w-12 h-8 rounded-[6px] overflow-hidden bg-muted border border-border shrink-0 grid place-items-center text-muted-foreground">
                                            {/* eslint-disable-next-line @next/next/no-img-element */}
                                            {d.snapshotPath ? <img src={d.snapshotPath} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} /> : <Camera size={13} />}
                                        </span>
                                        <Estado tono={TONO[d.type] || "neutro"} icono={m.Icon}>{m.label}</Estado>
                                        <span className="text-[12.5px] font-semibold text-foreground truncate min-w-0 flex-1">{d.deviceName || "Cámara"}</span>
                                        <span className="text-[11px] text-muted-foreground tabular-nums shrink-0">{hace(d.timestamp)}</span>
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </div>
            )}

            {ficha && <FichaDeteccion det={ficha} geom={ficha.deviceId ? geom[ficha.deviceId] : undefined} onClose={() => setFicha(null)} />}
        </div>
    );
}
