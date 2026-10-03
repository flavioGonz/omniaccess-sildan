"use client";

import { MapContainer, TileLayer, Marker, Polygon, Tooltip } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";

export default function PassMap({ lat, lng, poly, label }: { lat: number; lng: number; poly?: [number, number][] | null; label?: string }) {
    const icon = L.divIcon({
        className: "",
        html: `<div style="width:26px;height:26px;border-radius:50% 50% 50% 0;background:#ea580c;transform:rotate(-45deg);border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.4)"></div>`,
        iconSize: [26, 26], iconAnchor: [13, 24],
    });
    return (
        <MapContainer center={[lat, lng]} zoom={18} style={{ height: 180, width: "100%" }} scrollWheelZoom={false} attributionControl={false} zoomControl={false}>
            <TileLayer url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}" maxNativeZoom={19} maxZoom={21} />
            {poly && poly.length >= 3 && <Polygon positions={poly} pathOptions={{ color: "#f59e0b", weight: 3, fillColor: "#f59e0b", fillOpacity: 0.25 }} />}
            <Marker position={[lat, lng]} icon={icon}>
                {label ? <Tooltip permanent direction="top" offset={[0, -22]}>{label}</Tooltip> : null}
            </Marker>
        </MapContainer>
    );
}
