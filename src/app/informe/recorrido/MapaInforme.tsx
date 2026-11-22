"use client";

import { useEffect, useMemo } from "react";
import { MapContainer, Marker, Polyline, TileLayer, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { RecorridoGps } from "@/app/actions/gps";
import { COLOR_FRANJA, trozosPorVelocidad } from "@/lib/gps-jornada";

/** El mapa del informe: el recorrido entero a la vista, pintado por velocidad, con el número de cada viaje. Quieto: es para papel. */
function Encuadrar({ puntos }: { puntos: [number, number][] }) {
    const mapa = useMap();
    useEffect(() => { if (puntos.length > 1) mapa.fitBounds(L.latLngBounds(puntos), { padding: [26, 26], maxZoom: 17, animate: false }); }, [puntos, mapa]);
    return null;
}

export default function MapaInforme({ datos }: { datos: RecorridoGps }) {
    const viajes = useMemo(() => datos.viajes.map((v) => datos.puntos.filter((p) => p.cuando >= v.desde && p.cuando <= v.hasta)).filter((p) => p.length > 1), [datos]);
    const todos = useMemo(() => viajes.flat().map((p) => [p.lat, p.lon] as [number, number]), [viajes]);
    return (
        <MapContainer center={todos[0] || [-34.9, -56.16]} zoom={14} className="h-full w-full" zoomControl={false} attributionControl={false} dragging={false} scrollWheelZoom={false} doubleClickZoom={false} touchZoom={false} keyboard={false}>
            {/* En papel va el plano de calles y no el satélite: se leen los nombres, gasta menos tinta, y la capa de
                rótulos que acompaña al satélite sale con marca de agua cuando el proveedor no reconoce el origen. */}
            <TileLayer attribution="&copy; OpenStreetMap" maxNativeZoom={19} maxZoom={21} url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
            <Encuadrar puntos={todos} />
            {viajes.map((p, v) => (
                <Polyline key={`b${v}`} positions={p.map((x) => [x.lat, x.lon] as [number, number])} interactive={false} pathOptions={{ color: "#0a0e14", weight: 8, opacity: 0.6, lineCap: "round", lineJoin: "round" }} />
            ))}
            {viajes.flatMap((p, v) => trozosPorVelocidad(p, datos.limite).map((t, k) => (
                <Polyline key={`c${v}-${k}`} positions={t.linea} interactive={false} pathOptions={{ color: COLOR_FRANJA[t.franja], weight: 4, opacity: 1, lineCap: "round", lineJoin: "round" }} />
            )))}
            {viajes.map((p, v) => (
                <Marker key={`n${v}`} position={[p[0].lat, p[0].lon]} interactive={false}
                    icon={L.divIcon({ className: "bg-transparent border-0", iconSize: [20, 20], iconAnchor: [10, 10], html: `<div style="width:20px;height:20px;border-radius:50%;background:#0a0e14;color:#fff;border:2px solid #fff;font:800 10.5px/16px Outfit,system-ui,sans-serif;text-align:center">${v + 1}</div>` })} />
            ))}
        </MapContainer>
    );
}
