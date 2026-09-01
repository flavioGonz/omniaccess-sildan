"use client";

import { useRef, useState, useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap, useMapEvents, Polyline, ZoomControl } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { Locate, ShieldAlert, Navigation } from 'lucide-react';

// SVG Icons
const iconSvg = `
<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="#B20D30" stroke="#FFFFFF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="filter: drop-shadow(0px 4px 4px rgba(0,0,0,0.3));">
  <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
  <circle cx="12" cy="10" r="3" fill="#FFFFFF"></circle>
</svg>
`;

const alertIconSvg = `
<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="#F59E0B" stroke="#000000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="animate-pulse" style="filter: drop-shadow(0px 4px 8px rgba(245, 158, 11, 0.5));">
  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
  <line x1="12" y1="9" x2="12" y2="13"></line>
  <line x1="12" y1="17" x2="12.01" y2="17"></line>
</svg>
`;

const guardIcon = L.divIcon({
    className: "bg-transparent border-none",
    html: iconSvg,
    iconSize: [40, 40],
    iconAnchor: [20, 40],
    popupAnchor: [0, -40],
});

const alertIcon = L.divIcon({
    className: "bg-transparent border-none",
    html: alertIconSvg,
    iconSize: [48, 48],
    iconAnchor: [24, 44],
    popupAnchor: [0, -44],
});


function MapRecenter({ lat, lng }: { lat: number; lng: number }) {
    const map = useMap();
    return null;
}

function AutoFitBounds({ guards, myLocation }: { guards: any[], myLocation: { lat: number; lng: number } | null }) {
    const map = useMap();

    useEffect(() => {
        // If we have guards but no myLocation (Admin view usually), fit to guards
        if (!myLocation && guards && guards.length > 0) {
            const bounds = L.latLngBounds(guards.map(g => [g.lat, g.lng]));
            map.fitBounds(bounds, { padding: [50, 50], maxZoom: 16 });
        }
    }, [guards, myLocation, map]);

    return null;
}

function UserLocationControl({ myLocation }: { myLocation: { lat: number; lng: number } | null }) {
    const map = useMap();

    return (
        <div className="leaflet-bottom leaflet-right" style={{ marginBottom: '80px', marginRight: '20px', pointerEvents: 'auto', zIndex: 1000 }}>
            <button
                onClick={(e) => {
                    e.stopPropagation(); // Avoid map click
                    if (myLocation) {
                        map.setView([myLocation.lat, myLocation.lng], 17);
                    }
                }}
                className="bg-white w-14 h-14 flex items-center justify-center rounded-full shadow-lg text-[#B20D30] border-4 border-white active:scale-95 transition-all"
                title="Mi Ubicación"
            >
                <Locate size={28} />
            </button>
        </div>
    );
}

function MapEvents({ onLongPress }: { onLongPress?: (latlng: { lat: number, lng: number }) => void }) {
    const timerRef = useRef<NodeJS.Timeout | null>(null);
    const isLongPress = useRef(false);

    const startPress = (e: any) => {
        isLongPress.current = false;
        timerRef.current = setTimeout(() => {
            isLongPress.current = true;
            // @ts-ignore
            if (onLongPress && e.latlng) onLongPress(e.latlng);
        }, 800); // 800ms for long press
    };

    const clearPress = () => {
        if (timerRef.current) {
            clearTimeout(timerRef.current);
            timerRef.current = null;
        }
    };

    useMapEvents({
        contextmenu: (e: any) => {
            if (onLongPress) onLongPress(e.latlng);
        },
        mousedown: (e: any) => startPress(e),
        mouseup: () => clearPress(),
        mousemove: () => clearPress(),
        touchstart: (e: any) => {
            // @ts-ignore
            startPress(e);
        },
        touchend: () => clearPress(),
        touchmove: () => clearPress()
    } as any);

    return null;
}

interface BackupMission {
    lat: number;
    lng: number;
    type: string; // 'INDIVIDUO' | 'VEHICULO'
    status: 'PENDING' | 'ACCEPTED';
    responderLocation?: { lat: number, lng: number };
    requesterName?: string;
    responderId?: string;
    requesterId?: string;
    id?: string;
    timestamp?: number;
    details?: string;
}

interface GuardMapProps {
    myLocation: { lat: number; lng: number } | null;
    guards: any[];
    socketId: string | null;
    onLongPress?: (latlng: { lat: number, lng: number }) => void;
    backupMission?: BackupMission | null;
    backupMissions?: BackupMission[]; // Support multiple
    onAlertClick?: (mission: BackupMission) => void;
}

function MissionMarker({ mission, onAlertClick, myLocation, guards, socketId }: { mission: BackupMission, onAlertClick?: (m: BackupMission) => void, myLocation: any, guards: any[], socketId: string | null }) {


    // To properly support "even me", we need socketId in MissionMarker.
    // Let's assume parent passes adequate data or we use what we have.
    // For now, let's trust the props or fallback:

    const rawResponderLoc = mission.responderLocation
        ? mission.responderLocation
        : (
            (guards.find(g => g.socketId === mission.responderId)) ||
            (socketId && mission.responderId === socketId ? myLocation : null)
        );

    const finalResponderLoc = (rawResponderLoc && typeof rawResponderLoc.lat !== 'undefined' && typeof rawResponderLoc.lng !== 'undefined' && !isNaN(Number(rawResponderLoc.lat)) && !isNaN(Number(rawResponderLoc.lng)))
        ? { lat: Number(rawResponderLoc.lat), lng: Number(rawResponderLoc.lng) }
        : null;

    // If I am the responder, myLocation should be used? 
    // The issue is MissionMarker doesn't know 'socketId'. 
    // But LiveGuardMap does. Let's pass it.

    const [elapsed, setElapsed] = useState(0);

    useEffect(() => {
        if (mission.timestamp) {
            const update = () => setElapsed(Math.floor((Date.now() - mission.timestamp!) / 1000));
            update();
            const interval = setInterval(update, 1000);
            return () => clearInterval(interval);
        }
    }, [mission.timestamp]);

    const formatElapsed = (s: number) => {
        const mins = Math.floor(s / 60);
        const secs = s % 60;
        if (mins > 60) {
            const hrs = Math.floor(mins / 60);
            return `${hrs}h ${mins % 60}m`;
        }
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    const missionIconWithTimer = L.divIcon({
        className: "bg-transparent border-none",
        html: `
            <div class="flex flex-col items-center group">
                <div class="bg-black text-white text-[10px] font-bold px-2 py-1 rounded-lg mb-1 shadow-lg border-2 border-amber-500/50 flex items-center gap-1.5 animate-bounce">
                    <span class="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse"></span>
                    ${formatElapsed(elapsed)}
                </div>
                ${alertIconSvg}
            </div>
        `,
        iconSize: [60, 80],
        iconAnchor: [30, 76],
        popupAnchor: [0, -76],
    });

    const [missionStats, setMissionStats] = useState<{ distance: number, time: number } | null>(null);
    const [routeCoords, setRouteCoords] = useState<any[]>([]);

    useEffect(() => {
        if (mission.status === 'ACCEPTED' && finalResponderLoc) {
            // OSRM Public Demo for Prototype
            const url = `https://router.project-osrm.org/route/v1/driving/${finalResponderLoc.lng},${finalResponderLoc.lat};${mission.lng},${mission.lat}?overview=full&geometries=geojson`;

            fetch(url)
                .then(res => res.json())
                .then(data => {
                    if (data.routes && data.routes.length > 0) {
                        const route = data.routes[0];
                        setMissionStats({
                            distance: Math.round(route.distance), // meters
                            time: Math.round(route.duration / 60) // minutes
                        });
                        // GeoJSON uses [lng, lat], Leaflet uses [lat, lng]
                        const coords = route.geometry.coordinates.map((c: any) => [c[1], c[0]]);
                        setRouteCoords(coords);
                    } else {
                        console.warn(`⚠️ No routes found for ${mission.id}`);
                    }
                })
                .catch(err => console.error("OSRM Error:", err));
        } else {
            setMissionStats(null);
            setRouteCoords([]);
        }
    }, [mission.status, finalResponderLoc?.lat, finalResponderLoc?.lng, mission.lat, mission.lng]);

    return (
        <>
            <Marker
                position={[mission.lat, mission.lng]}
                icon={missionIconWithTimer}
                eventHandlers={{
                    click: () => {
                        if (onAlertClick) onAlertClick(mission);
                    }
                }}
            >
                <Popup closeButton={false} className="custom-popup">
                    <div className="text-center min-w-[180px]" onClick={(e) => {
                        e.stopPropagation(); // Prevent map click
                        if (onAlertClick) onAlertClick(mission);
                    }}>
                        <strong className="text-[#B20D30] font-bold uppercase text-sm block mb-1">SOLICITUD ACTIVA</strong>
                        <span className="font-bold block text-black text-xs mb-3">{mission.type} <span className="text-gray-400 font-normal block mt-0.5">por {mission.requesterName}</span></span>

                        <button type="button" onClick={(e) => {
                            e.stopPropagation();
                            if (onAlertClick) onAlertClick(mission);
                        }} className="group w-full bg-[#B20D30] text-white font-bold py-3 rounded-xl text-[10px] uppercase shadow-lg tracking-widest hover:bg-black transition-all active:scale-95 flex items-center justify-center gap-2">
                            <ShieldAlert size={14} className="group-hover:animate-pulse" /> TOCAR PARA GESTIONAR
                        </button>
                    </div>
                </Popup>
            </Marker>

            {/* Route Line if Accepted */}
            {mission.status === 'ACCEPTED' && routeCoords.length > 0 && (
                <>
                    <Polyline
                        positions={routeCoords}
                        pathOptions={{
                            color: '#2563EB', // Solid Blue
                            weight: 6,
                            opacity: 0.9,
                            lineCap: 'round',
                            lineJoin: 'round'
                        }}
                    />

                    {/* Info Box Overlay for Stats (Always visible when routing) */}
                    {missionStats && finalResponderLoc && (
                        <Marker position={[
                            (mission.lat + finalResponderLoc.lat) / 2, // Midpoint
                            (mission.lng + finalResponderLoc.lng) / 2
                        ]} icon={L.divIcon({
                            className: 'bg-white px-3 py-2 rounded-xl shadow-xl text-sm font-bold border-2 border-red-500 whitespace-nowrap animate-pulse flex flex-col items-center justify-center',
                            html: `<div style="text-align: center; line-height: 1.2;">⏱️ ${missionStats.time} min<br/><span style="font-size: 10px; color: #666;">${missionStats.distance}m</span></div>`,
                            iconSize: [100, 42],
                            iconAnchor: [50, 21]
                        })} />
                    )}
                </>
            )}
        </>
    );
}

export default function LiveGuardMap({ myLocation, guards, socketId, onLongPress, backupMission, backupMissions, onAlertClick }: GuardMapProps) {
    // Default to Montevideo if no location
    const defaultCenter = { lat: -34.9011, lng: -56.1645 }; // Montevideo

    // Safely extract coordinates ensuring we never pass undefined to Leaflet
    const getSafeCoords = (loc: any) => {
        if (!loc) return null;
        const lat = parseFloat(loc.lat);
        const lng = parseFloat(loc.lng);
        if (isNaN(lat) || isNaN(lng)) return null;
        return { lat, lng };
    };

    const mySafeLoc = getSafeCoords(myLocation);
    const validGuards = guards
        .map(g => ({ ...g, ...getSafeCoords(g) }))
        .filter(g => g.lat !== undefined && g.lng !== undefined && !isNaN(g.lat) && !isNaN(g.lng));

    const firstGuardSafeLoc = validGuards.length > 0 ? { lat: validGuards[0].lat, lng: validGuards[0].lng } : null;

    const center = mySafeLoc || firstGuardSafeLoc || defaultCenter;

    // Normalize missions to array and filter valid ones
    const rawMissions = backupMissions || (backupMission ? [backupMission] : []);
    const validMissions = rawMissions.filter(m => {
        const safe = getSafeCoords(m);
        if (!safe) return false;
        m.lat = safe.lat;
        m.lng = safe.lng;
        return true;
    });

    return (
        <MapContainer center={[center.lat, center.lng]} zoom={15} style={{ height: '100%', width: '100%', zIndex: 0 }} zoomControl={false}>
            {/* CSS Animation for Dash Flow */}
            <style>{`
                @keyframes flow {
                    to {
                        stroke-dashoffset: -20;
                    }
                }
                .anim-path {
                    animation: flow 1s linear infinite;
                }
            `}</style>

            <ZoomControl position="bottomleft" />

            <TileLayer
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                attribution='&copy; OpenStreetMap contributors'
            />

            <MapEvents onLongPress={onLongPress} />
            <UserLocationControl myLocation={mySafeLoc} />
            <AutoFitBounds guards={validGuards} myLocation={mySafeLoc} />

            {mySafeLoc && (
                <Marker position={[mySafeLoc.lat, mySafeLoc.lng]} icon={guardIcon}>
                    <Popup>
                        <strong>USTED</strong><br />
                        Tablet de Guardia
                    </Popup>
                </Marker>
            )}

            {/* Other Guards */}
            {validGuards.filter(g => g.socketId !== socketId).map((g, idx) => (
                <Marker key={g.socketId || idx} position={[g.lat, g.lng]} icon={guardIcon}>
                    <Popup>
                        <strong>{g.guardName || "Guardia"}</strong>
                    </Popup>
                </Marker>
            ))}

            {/* BACKUP MISSIONS RENDER */}
            {validMissions.map((mission, idx) => (
                <MissionMarker
                    key={mission.id || idx}
                    mission={mission}
                    onAlertClick={onAlertClick}
                    myLocation={mySafeLoc}
                    guards={validGuards}
                    socketId={socketId}
                />
            ))}
        </MapContainer>
    );
}

