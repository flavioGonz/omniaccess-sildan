"use client";

import { useEffect, useState } from "react";
import { MapContainer, TileLayer, Marker, useMapEvents } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// Leaflet marker fix - Only run on client
const icon = typeof window !== 'undefined' ? L.icon({
    iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
    shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
    iconSize: [25, 41],
    iconAnchor: [12, 41]
}) : null;

interface LocationPickerProps {
    coords: string;
    onChange: (val: string) => void;
    fullScreen?: boolean;
}

export default function LocationPicker({ coords, onChange, fullScreen = false }: LocationPickerProps) {
    const [lat, lng] = coords.split(',').map(n => parseFloat(n.trim()));
    const [isMounted, setIsMounted] = useState(false);

    useEffect(() => {
        setIsMounted(true);
    }, []);

    function LocationComponent() {
        useMapEvents({
            click(e) {
                onChange(`${e.latlng.lat.toFixed(6)}, ${e.latlng.lng.toFixed(6)}`);
            },
        });
        return null;
    }

    if (!isMounted) return <div className={`h-64 w-full bg-card animate-pulse ${fullScreen ? '' : 'rounded-xl'}`} />;

    return (
        <div className={`w-full ${fullScreen ? 'h-full' : 'h-64 rounded-xl'} overflow-hidden border border-border relative`}>
            <MapContainer center={[lat || -34.6037, lng || -58.3816]} zoom={15} style={{ height: '100%', width: '100%' }}>
                <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" className="grayscale contrast-125 brightness-75" />
                <Marker
                    position={[lat || -34.6037, lng || -58.3816]}
                    icon={icon as any}
                    draggable={true}
                    eventHandlers={{
                        dragend: (e) => {
                            const marker = e.target;
                            const position = marker.getLatLng();
                            onChange(`${position.lat.toFixed(6)}, ${position.lng.toFixed(6)}`);
                        }
                    }}
                />
                <LocationComponent />
            </MapContainer>
            <div className="absolute bottom-2 right-2 z-[1000] bg-black/80 px-2 py-1 rounded text-[10px] text-white font-mono border border-border">
                CLICK O DRAG PARA UBICAR
            </div>
        </div>
    );
}
