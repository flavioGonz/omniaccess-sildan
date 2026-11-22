"use client";

import { useEffect, useMemo, useRef } from "react";
import { CircleMarker, MapContainer, Marker, Polyline, TileLayer, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { VistaCompartida } from "@/lib/gps-compartir";

/**
 * El mapa de un enlace compartido: el vehículo, hacia dónde va y el camino desde que se compartió.
 * Sigue al vehículo mientras nadie mueva el mapa; si quien mira lo corre para ver otra cosa, deja
 * de perseguirlo — pelearle el mapa de las manos cada diez segundos es peor que quedarse quieto.
 */
function Seguidor({ centro }: { centro: [number, number] }) {
    const mapa = useMap();
    const suelto = useRef(false);
    useEffect(() => { const soltar = () => { suelto.current = true; }; mapa.on("dragstart", soltar); return () => { mapa.off("dragstart", soltar); }; }, [mapa]);
    useEffect(() => { if (!suelto.current) mapa.panTo(centro, { animate: true }); }, [centro, mapa]);
    return null;
}

export default function MapaSeguir({ v }: { v: VistaCompartida }) {
    const centro = useMemo<[number, number]>(() => [v.lat!, v.lon!], [v.lat, v.lon]);
    const anda = (v.velocidad || 0) > 3;
    /* La flecha de rumbo sólo si se mueve: quieto, el rumbo que informa un GPS es ruido. Sin imágenes
       de marcador: las de Leaflet se bajan de un servidor ajeno. */
    const icono = useMemo(() => L.divIcon({
        className: "bg-transparent border-0", iconSize: [34, 34], iconAnchor: [17, 17],
        html: `<div style="width:34px;height:34px;display:grid;place-items:center;transform:rotate(${anda ? v.rumbo || 0 : 0}deg)">`
            + (anda ? '<svg width="34" height="34" viewBox="0 0 34 34"><path d="M17 3 27 29 17 23 7 29Z" fill="#1f5eff" stroke="#fff" stroke-width="2.5" stroke-linejoin="round"/></svg>'
                : '<div style="width:18px;height:18px;border-radius:50%;background:#1f5eff;border:3px solid #fff;box-shadow:0 1px 6px rgba(0,0,0,.6)"></div>') + "</div>",
    }), [anda, v.rumbo]);
    return (
        <MapContainer center={centro} zoom={16} className="h-full w-full" zoomControl={false} attributionControl={false}>
            <TileLayer attribution="&copy; Esri" maxNativeZoom={19} maxZoom={21} url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}" />
            <TileLayer url="https://a.basemaps.cartocdn.com/rastertiles/dark_only_labels/{z}/{x}/{y}.png" maxZoom={21} maxNativeZoom={19} />
            <Seguidor centro={centro} />
            {v.recorrido.length > 1 && (
                <>
                    <Polyline positions={[...v.recorrido, centro]} pathOptions={{ color: "#0a0e14", weight: 8, opacity: 0.5, lineCap: "round", lineJoin: "round" }} />
                    <Polyline positions={[...v.recorrido, centro]} pathOptions={{ color: "#60a5fa", weight: 4, opacity: 0.95, lineCap: "round", lineJoin: "round" }} />
                </>
            )}
            <CircleMarker center={centro} radius={22} pathOptions={{ color: "#1f5eff", weight: 1, fillColor: "#1f5eff", fillOpacity: 0.18 }} />
            <Marker position={centro} icon={icono} interactive={false} />
        </MapContainer>
    );
}
