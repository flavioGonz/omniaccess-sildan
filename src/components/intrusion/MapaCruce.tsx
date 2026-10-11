"use client";

import { useEffect } from "react";
import { MapContainer, TileLayer, Polygon, Polyline, CircleMarker, Tooltip, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import type { AnalisisDeteccion } from "@/lib/intrusion/analisis";

/**
 * El recuadro de mapa de una detección: dónde está la cámara, su línea o zona dibujada en el
 * mapa del barrio (en rojo, que es donde fue el cruce) y, si otras cámaras detectaron algo
 * alrededor, dónde están (en ámbar) — el recorrido posible.
 *
 * Satélite, sin controles: es para ubicar, no para navegar. Se carga sólo en el navegador
 * (Leaflet no corre en el servidor): importarlo con next/dynamic y ssr:false.
 */

/** Los colores van por variables del tema donde se puede; Leaflet necesita valores, se leen al montar. */
const leer = (v: string, def: string) => (typeof window === "undefined" ? def : getComputedStyle(document.documentElement).getPropertyValue(v).trim() || def);

function Encuadre({ puntos }: { puntos: [number, number][] }) {
    const map = useMap();
    useEffect(() => {
        if (!puntos.length) return;
        if (puntos.length === 1) map.setView(puntos[0], 19);
        else map.fitBounds(puntos, { padding: [24, 24], maxZoom: 20 });
    }, [map, puntos]);
    return null;
}

export default function MapaCruce({ mapa, alto = 220 }: { mapa: NonNullable<AnalisisDeteccion["mapa"]>; alto?: number }) {
    const mal = leer("--mal", "#ef4444");
    const aviso = leer("--aviso", "#f59e0b");
    const accion = leer("--accion-en-oscuro", "#60a5fa");
    const puntos: [number, number][] = [
        ...(mapa.camara ? [[mapa.camara.lat, mapa.camara.lng] as [number, number]] : []),
        ...mapa.figuras.flatMap((f) => f.points),
        ...mapa.otras.map((o) => [o.lat, o.lng] as [number, number]),
    ];
    return (
        <div style={{ height: alto }} className="relative w-full rounded-[10px] overflow-hidden border border-border bg-neutral-900">
            <MapContainer center={mapa.centro} zoom={mapa.zoom} zoomControl={false} attributionControl={false} scrollWheelZoom={false} doubleClickZoom={false} className="absolute inset-0 h-full w-full">
                <TileLayer url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}" maxNativeZoom={19} maxZoom={21} />
                {mapa.figuras.map((f, i) => f.kind === "line" || f.points.length === 2
                    ? <Polyline key={i} positions={f.points} pathOptions={{ color: mal, weight: 4 }} />
                    : <Polygon key={i} positions={f.points} pathOptions={{ color: mal, weight: 2, fillColor: mal, fillOpacity: 0.28 }} />)}
                {mapa.otras.map((o, i) => (
                    <CircleMarker key={`o${i}`} center={[o.lat, o.lng]} radius={7} pathOptions={{ color: "#fff", weight: 2, fillColor: aviso, fillOpacity: 1 }}>
                        <Tooltip direction="top" offset={[0, -6]}>{o.nombre}</Tooltip>
                    </CircleMarker>
                ))}
                {mapa.camara && (
                    <CircleMarker center={[mapa.camara.lat, mapa.camara.lng]} radius={8} pathOptions={{ color: "#fff", weight: 2, fillColor: accion, fillOpacity: 1 }}>
                        <Tooltip direction="top" offset={[0, -6]} permanent>Cámara</Tooltip>
                    </CircleMarker>
                )}
                <Encuadre puntos={puntos} />
            </MapContainer>
        </div>
    );
}
