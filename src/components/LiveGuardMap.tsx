"use client";

import { useRef, useState, useEffect, useMemo, memo } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap, useMapEvents, Polyline, Polygon, Tooltip as LTooltip, ZoomControl } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { Locate, ShieldAlert, X, Home, Car, Loader2, Clock, LogIn, LogOut } from 'lucide-react';
import { getBarrioMap, type BarrioMapData } from '@/app/actions/barriomap';
import { getSlotDetail, type SlotDetail } from '@/app/actions/plazas';

// SVG Icons
const iconSvg = `
<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="#B20D30" stroke="#FFFFFF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="filter: drop-shadow(0px 4px 4px rgba(0,0,0,0.3));">
  <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
  <circle cx="12" cy="10" r="3" fill="#FFFFFF"></circle>
</svg>`;

const alertIconSvg = `
<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="#F59E0B" stroke="#000000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="animate-pulse" style="filter: drop-shadow(0px 4px 8px rgba(245, 158, 11, 0.5));">
  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
  <line x1="12" y1="9" x2="12" y2="13"></line>
  <line x1="12" y1="17" x2="12.01" y2="17"></line>
</svg>`;

const guardIcon = L.divIcon({ className: "bg-transparent border-none", html: iconSvg, iconSize: [40, 40], iconAnchor: [20, 40], popupAnchor: [0, -40] });
const alertIcon = L.divIcon({ className: "bg-transparent border-none", html: alertIconSvg, iconSize: [48, 48], iconAnchor: [24, 44], popupAnchor: [0, -44] });
const emptyPin = L.divIcon({ className: "bg-transparent border-none", html: "", iconSize: [0, 0] });

function AutoFitBounds({ guards, myLocation, barrioReady }: { guards: any[], myLocation: { lat: number; lng: number } | null, barrioReady: boolean }) {
    const map = useMap();
    useEffect(() => {
        if (barrioReady) return; // el barrio fija la vista
        if (!myLocation && guards && guards.length > 0) {
            const bounds = L.latLngBounds(guards.map(g => [g.lat, g.lng]));
            map.fitBounds(bounds, { padding: [50, 50], maxZoom: 16 });
        }
    }, [guards, myLocation, map, barrioReady]);
    return null;
}

// Fija la vista al centro del barrio una vez (si no hay ubicación propia).
function SetBarrioView({ center, zoom }: { center: [number, number] | null; zoom: number }) {
    const map = useMap();
    const done = useRef(false);
    useEffect(() => {
        if (done.current || !center) return;
        done.current = true;
        map.setView(center, zoom);
    }, [center, zoom, map]);
    return null;
}

function ZoomWatcher({ onZoom }: { onZoom: (z: number) => void }) {
    const map = useMap();
    useMapEvents({ zoomend: () => onZoom(map.getZoom()) });
    useEffect(() => { onZoom(map.getZoom()); }, [map, onZoom]);
    return null;
}

function UserLocationControl({ myLocation }: { myLocation: { lat: number; lng: number } | null }) {
    const map = useMap();
    return (
        <div className="leaflet-bottom leaflet-right" style={{ marginBottom: '90px', marginRight: '20px', pointerEvents: 'auto', zIndex: 1000 }}>
            <button
                onClick={(e) => { e.stopPropagation(); if (myLocation) map.setView([myLocation.lat, myLocation.lng], 18); }}
                className="bg-white w-14 h-14 flex items-center justify-center rounded-full shadow-lg text-[#B20D30] border-4 border-white active:scale-95 transition-all"
                title="Mi Ubicación"
            >
                <Locate size={28} />
            </button>
        </div>
    );
}

// ── Capa de lotes memoizada (read-only): polígonos + etiquetas (por zoom) ──
const LotesLayer = memo(function LotesLayer({ lotes, zoom, selectedId, onSelect }: {
    lotes: BarrioMapData["lotes"]; zoom: number; selectedId: string | null; onSelect: (lote: BarrioMapData["lotes"][number]) => void;
}) {
    const showNames = zoom >= 17;
    return (
        <>
            {lotes.map((lo) => {
                if (!lo.points || lo.points.length < 3) return null;
                const sel = lo.id === selectedId;
                return (
                    <Polygon
                        key={lo.id}
                        positions={lo.points as any}
                        pathOptions={{ color: sel ? "#6366f1" : "#22c55e", weight: sel ? 3 : 1.5, fillColor: sel ? "#6366f1" : "#22c55e", fillOpacity: sel ? 0.28 : 0.1 }}
                        eventHandlers={{ click: () => onSelect(lo) }}
                    >
                        {showNames && lo.name && (
                            <LTooltip permanent direction="center" className="lote-lbl">{lo.name}</LTooltip>
                        )}
                    </Polygon>
                );
            })}
        </>
    );
});

interface BackupMission { lat: number; lng: number; type: string; status: 'PENDING' | 'ACCEPTED'; responderLocation?: { lat: number, lng: number }; requesterName?: string; responderId?: string; requesterId?: string; id?: string; timestamp?: number; details?: string; }

interface GuardMapProps {
    myLocation: { lat: number; lng: number } | null;
    guards: any[];
    socketId: string | null;
    onLongPress?: (latlng: { lat: number, lng: number }) => void;
    backupMission?: BackupMission | null;
    backupMissions?: BackupMission[];
    onAlertClick?: (mission: BackupMission) => void;
}

export default function LiveGuardMap({ myLocation, guards, socketId, onLongPress, backupMission, backupMissions, onAlertClick }: GuardMapProps) {
    const defaultCenter = { lat: -34.9011, lng: -56.1645 };
    const getSafeCoords = (loc: any) => { if (!loc) return null; const lat = parseFloat(loc.lat); const lng = parseFloat(loc.lng); if (isNaN(lat) || isNaN(lng)) return null; return { lat, lng }; };

    const mySafeLoc = getSafeCoords(myLocation);
    const validGuards = guards.map(g => ({ ...g, ...getSafeCoords(g) })).filter(g => g.lat !== undefined && g.lng !== undefined && !isNaN(g.lat) && !isNaN(g.lng));
    const firstGuardSafeLoc = validGuards.length > 0 ? { lat: validGuards[0].lat, lng: validGuards[0].lng } : null;
    const center = mySafeLoc || firstGuardSafeLoc || defaultCenter;

    const [barrio, setBarrio] = useState<BarrioMapData | null>(null);
    const [zoom, setZoom] = useState(15);
    const [selected, setSelected] = useState<BarrioMapData["lotes"][number] | null>(null);
    const [detail, setDetail] = useState<SlotDetail | null>(null);
    const [detailLoading, setDetailLoading] = useState(false);

    useEffect(() => { getBarrioMap().then(setBarrio).catch(() => setBarrio(null)); }, []);

    const openLote = async (lo: BarrioMapData["lotes"][number]) => {
        setSelected(lo); setDetail(null);
        if (!lo.parkingSlotId) return;
        setDetailLoading(true);
        try { setDetail(await getSlotDetail(lo.parkingSlotId)); }
        catch { setDetail(null); }
        finally { setDetailLoading(false); }
    };
    const closeLote = () => { setSelected(null); setDetail(null); };

    const rawMissions = backupMissions || (backupMission ? [backupMission] : []);
    const validMissions = rawMissions.filter(m => { const safe = getSafeCoords(m); if (!safe) return false; m.lat = safe.lat; m.lng = safe.lng; return true; });

    const barrioCenter = barrio && barrio.lotes.length > 0 ? barrio.center : null;

    return (
        <div className="relative h-full w-full">
            <MapContainer center={[center.lat, center.lng]} zoom={barrioCenter ? barrio!.zoom : 15} style={{ height: '100%', width: '100%', zIndex: 0 }} zoomControl={false} preferCanvas>
                <style>{`.lote-lbl{background:transparent;border:none;box-shadow:none;color:#fff;font-weight:800;font-size:11px;text-shadow:0 1px 3px rgba(0,0,0,.9);}
                .lote-lbl::before{display:none;}`}</style>

                <ZoomControl position="bottomleft" />
                {/* Satélite (Esri) como el mapa del admin */}
                <TileLayer url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}" attribution="&copy; Esri" maxZoom={21} maxNativeZoom={19} />

                <ZoomWatcher onZoom={setZoom} />
                {!mySafeLoc && barrioCenter && <SetBarrioView center={barrioCenter} zoom={barrio!.zoom} />}
                <UserLocationControl myLocation={mySafeLoc} />
                <AutoFitBounds guards={validGuards} myLocation={mySafeLoc} barrioReady={!!barrioCenter} />

                {/* Perímetro */}
                {barrio && barrio.perimeter.length > 1 && (
                    <Polyline positions={barrio.perimeter as any} pathOptions={{ color: "#38bdf8", weight: 2, opacity: 0.7, dashArray: "6 6" }} />
                )}
                {/* Divisiones / tejidos */}
                {barrio && barrio.divisions.map((d) => d.points.length > 1 && (
                    <Polyline key={d.id} positions={d.points as any} pathOptions={{ color: d.color || "#f59e0b", weight: d.weight || 2, opacity: 0.7 }} />
                ))}
                {/* Lotes */}
                {barrio && <LotesLayer lotes={barrio.lotes} zoom={zoom} selectedId={selected?.id || null} onSelect={openLote} />}

                {/* Yo */}
                {mySafeLoc && (
                    <Marker position={[mySafeLoc.lat, mySafeLoc.lng]} icon={guardIcon}>
                        <Popup><strong>USTED</strong><br />Tablet de Guardia</Popup>
                    </Marker>
                )}
                {/* Compañeros */}
                {validGuards.filter(g => g.socketId !== socketId).map((g, idx) => (
                    <Marker key={g.socketId || idx} position={[g.lat, g.lng]} icon={guardIcon}>
                        <Popup><strong>{g.guardName || "Guardia"}</strong></Popup>
                    </Marker>
                ))}
                {/* Misiones de apoyo */}
                {validMissions.map((mission, idx) => (
                    <Marker key={mission.id || idx} position={[mission.lat, mission.lng]} icon={alertIcon}
                        eventHandlers={{ click: () => { if (onAlertClick) onAlertClick(mission); } }}>
                        <Popup closeButton={false}>
                            <div className="text-center min-w-[160px]">
                                <strong className="text-[#B20D30] font-bold uppercase text-sm block mb-1">Solicitud activa</strong>
                                <span className="font-bold block text-black text-xs">{mission.type}<span className="text-gray-400 font-normal block">por {mission.requesterName}</span></span>
                            </div>
                        </Popup>
                    </Marker>
                ))}
            </MapContainer>

            {/* Ficha del lote (drawer inferior) */}
            {selected && (
                <div className="absolute inset-x-0 bottom-0 z-[1200] p-3 pointer-events-none">
                    <div className="pointer-events-auto mx-auto w-full max-w-xl rounded-3xl bg-white shadow-2xl border border-slate-200 overflow-hidden animate-in slide-in-from-bottom duration-200">
                        <div className="flex items-center justify-between px-5 py-3.5 bg-gradient-to-r from-[#0b3d91] to-[#0a337c] text-white">
                            <div className="flex items-center gap-2 min-w-0">
                                <Home size={18} className="shrink-0" />
                                <span className="font-bold text-base truncate">{selected.name || detail?.label || "Lote"}</span>
                                {detail?.sector && <span className="text-xs text-white/70">· {detail.sector}</span>}
                            </div>
                            <button onClick={closeLote} className="w-9 h-9 rounded-full bg-white/15 hover:bg-white/25 flex items-center justify-center active:scale-95"><X size={18} /></button>
                        </div>
                        <div className="max-h-[45vh] overflow-y-auto px-5 py-4 space-y-4">
                            {!selected.parkingSlotId ? (
                                <p className="text-sm text-slate-400">Lote sin unidad asociada.</p>
                            ) : detailLoading ? (
                                <div className="flex items-center gap-2 text-slate-400 py-4"><Loader2 size={18} className="animate-spin" /> Cargando ficha…</div>
                            ) : !detail ? (
                                <p className="text-sm text-slate-400">Sin datos para este lote.</p>
                            ) : (
                                <>
                                    <div>
                                        <div className="text-[11px] font-bold uppercase tracking-widest text-slate-400 mb-1.5">Residentes</div>
                                        {detail.residentes.length === 0 ? <p className="text-sm text-slate-400">Sin residentes cargados.</p> : (
                                            <div className="space-y-2">
                                                {detail.residentes.map((r) => (
                                                    <div key={r.id} className="flex items-start justify-between gap-3">
                                                        <span className="text-sm font-semibold text-slate-800">{r.nombre}</span>
                                                        <div className="flex flex-wrap gap-1 justify-end">
                                                            {r.matriculas.map((m) => (
                                                                <span key={m} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-900 text-white text-[11px] font-mono font-bold"><Car size={11} />{m}</span>
                                                            ))}
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                    <div>
                                        <div className="text-[11px] font-bold uppercase tracking-widest text-slate-400 mb-1.5">Últimos movimientos</div>
                                        {detail.movimientos.length === 0 ? <p className="text-sm text-slate-400">Sin movimientos recientes.</p> : (
                                            <div className="space-y-1.5">
                                                {detail.movimientos.slice(0, 8).map((mv) => (
                                                    <div key={mv.id} className="flex items-center gap-2 text-sm">
                                                        {mv.dir === "EXIT" ? <LogOut size={14} className="text-orange-500 shrink-0" /> : <LogIn size={14} className="text-emerald-500 shrink-0" />}
                                                        <span className="font-mono font-bold text-slate-800">{mv.plate || "S/M"}</span>
                                                        <span className="text-slate-400 text-xs flex items-center gap-1 ml-auto"><Clock size={11} />{new Date(mv.ts).toLocaleString("es-UY", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                </>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
