"use client";

import { MapContainer, TileLayer, Marker, Pane, useMapEvents, useMap } from "react-leaflet";
import { useEffect, useReducer, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "leaflet/dist/leaflet.css";
import L from "leaflet";

type Dev = { id: string; name: string; ip: string; type: string; online: boolean };
type Geo = { deviceId: string; lat: number; lng: number };

function aforoColor(a: number, limit: number) { const r = limit > 0 ? a / limit : 0; return r >= 1 ? "#ef4444" : r >= 0.7 ? "#f59e0b" : "#10b981"; }
function aforoStatus(a: number, limit: number) { const r = limit > 0 ? a / limit : 0; return r >= 1 ? "full" : r >= 0.7 ? "warn" : "ok"; }

function makeIcon(isQueue: boolean, label: string, color: string, pulse: boolean) {
    const ring = pulse ? `<span style="position:absolute;inset:-7px;border-radius:9999px;background:${color}55;animation:ping 1.2s cubic-bezier(0,0,.2,1) infinite;"></span>` : "";
    const inner = isQueue
        ? `<span style="font-size:13px;font-weight:900;color:#fff;font-family:var(--font-sans)">${label}</span>`
        : `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2"><path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>`;
    const html = `<div style="position:relative;display:flex;flex-direction:column;align-items:center">${ring}
      <div style="width:34px;height:34px;border-radius:9999px;background:${color};border:2px solid rgba(255,255,255,0.85);box-shadow:0 2px 8px rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center">${inner}</div></div>`;
    return L.divIcon({ className: "bg-transparent border-none", html, iconSize: [34, 34], iconAnchor: [17, 17] });
}

function MapEvents({ onView }: { onView: (lat: number, lng: number, zoom: number) => void }) {
    useMapEvents({
        moveend: (e) => { const m = e.target; const c = m.getCenter(); onView(c.lat, c.lng, m.getZoom()); },
        zoomend: (e) => { const m = e.target; const c = m.getCenter(); onView(c.lat, c.lng, m.getZoom()); },
    });
    return null;
}

// MP4-over-HTTP mini live video tile (WS/MSE fails through the proxy)
function MapVideoTile({ ip, name, aforo, col }: { ip: string; name: string; aforo: number; col: string }) {
    const ref = useRef<HTMLVideoElement>(null);
    const [failed, setFailed] = useState(false);
    useEffect(() => {
        const v = ref.current; if (!v) return;
        const sn = `bosch_${ip.replace(/\./g, "_")}`; let tries = 0; let stopped = false;
        const start = () => { if (stopped) return; setFailed(false); v.src = `/go2rtc/api/stream.mp4?src=${sn}&t=${Date.now()}`; v.play().catch(() => {}); };
        const onErr = () => { if (stopped) return; if (tries++ < 6) setTimeout(start, 1300); else setFailed(true); };
        const onProg = () => { try { if (v.buffered.length) { const e = v.buffered.end(v.buffered.length - 1); if (e - v.currentTime > 2.5) v.currentTime = e; } } catch {} };
        v.addEventListener("error", onErr); v.addEventListener("progress", onProg); start();
        return () => { stopped = true; v.removeEventListener("error", onErr); v.removeEventListener("progress", onProg); v.pause(); v.removeAttribute("src"); v.load(); };
    }, [ip]);
    return (
        <div className="relative rounded-lg overflow-hidden border-2 shadow-xl vid-surface" style={{ borderColor: col, width: 150, height: 86 }}>
            {!failed ? <video ref={ref} autoPlay muted playsInline className="absolute inset-0 w-full h-full object-cover" /> : <div className="absolute inset-0 flex items-center justify-center text-white/40 text-[10px]">Reconectando…</div>}
            <div className="absolute top-1 left-1 px-1.5 py-0.5 rounded bg-black/60 text-[8px] font-semibold text-white max-w-[118px] truncate">{name}</div>
            <div className="absolute bottom-1 right-1 px-1.5 py-0.5 rounded text-white font-bold text-base leading-none tabular-nums" style={{ background: col + "dd" }}>{aforo}</div>
            <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
        </div>
    );
}

// Overlays the mini videos on top of the Leaflet map, positioned at each queue marker.
function VideoOverlays({ geo, devices, aforo, limit, onSelect }: { geo: Geo[]; devices: Dev[]; aforo: Record<string, number>; limit: number; onSelect: (id: string) => void; }) {
    const map = useMap();
    const [, force] = useReducer((x) => x + 1, 0);
    useEffect(() => {
        const h = () => force();
        map.on("move", h); map.on("zoom", h); map.on("viewreset", h); map.on("resize", h);
        return () => { map.off("move", h); map.off("zoom", h); map.off("viewreset", h); map.off("resize", h); };
    }, [map]);
    const items = geo.map((g) => { const d = devices.find((x) => x.id === g.deviceId); return d && d.type === "QUEUE_COUNTER" ? { g, d } : null; }).filter(Boolean) as { g: Geo; d: Dev }[];
    return createPortal(
        <div style={{ position: "absolute", inset: 0, zIndex: 640, pointerEvents: "none" }}>
            {items.map(({ g, d }) => {
                const p = map.latLngToContainerPoint([g.lat, g.lng]);
                const a = aforo[d.id] ?? 0; const col = aforoColor(a, limit);
                return (
                    <div key={d.id} onClick={() => onSelect(d.id)} style={{ position: "absolute", left: p.x, top: p.y, transform: "translate(-50%, -50%)", pointerEvents: "auto", cursor: "pointer" }}>
                        <MapVideoTile ip={d.ip} name={d.name} aforo={a} col={col} />
                    </div>
                );
            })}
        </div>,
        map.getContainer()
    );
}

// Capas del mapa. "filter" es el tratamiento de color de cada base para que el
// conjunto se lea como un mapa tactico y no como una foto de Google.
const TILES: Record<string, { url: string; attr: string; filter: string; labels?: string; dark?: boolean }> = {
    tactico: {
        url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
        attr: "&copy; Esri",
        filter: "invert(1) hue-rotate(180deg) saturate(0.55) brightness(0.92) contrast(1.06)",
        dark: true,
    },
    hibrido: {
        url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        labels: "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
        attr: "&copy; Esri",
        filter: "saturate(0.45) contrast(1.22) brightness(0.82)",
        dark: true,
    },
    satelite: {
        url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        attr: "&copy; Esri",
        filter: "saturate(0.7) contrast(1.1) brightness(0.92)",
    },
    calles: {
        url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}",
        attr: "&copy; Esri",
        filter: "none",
    },
};

export default function RealMap({ geo, devices, aforo, limit, center, edit, flashId, tiles = "calles", bright = 0, pip = true, onMove, onSelect, onView }: {
    geo: Geo[]; devices: Dev[]; aforo: Record<string, number>; limit: number;
    center: { lat: number; lng: number; zoom: number }; edit: boolean; flashId: string | null; tiles?: string; bright?: number; pip?: boolean;
    onMove: (id: string, lat: number, lng: number) => void; onSelect: (id: string) => void; onView: (lat: number, lng: number, zoom: number) => void;
}) {
    const tl = TILES[tiles] || TILES.tactico;
    const brillo = bright !== 0 ? ` brightness(${(1 + bright / 100).toFixed(2)})` : "";
    const tileFilter = `${tl.filter}${brillo}`.trim();
    const showVideo = pip && !edit;
    return (
        <>
        <style>{`
            .omni-map .leaflet-tile-pane{filter:${tileFilter};transition:filter .25s ease;}
            /* las etiquetas de calles van sin tratamiento, para que se lean nitidas */
            .omni-map .leaflet-pane.omni-labels{filter:none !important;opacity:.92;}
            .omni-map .leaflet-control-attribution{background:rgba(10,10,11,.6)!important;color:#8b8b93!important;font-size:9px;border-radius:6px 0 0 0;}
            .omni-map .leaflet-control-attribution a{color:#9aa4b2!important;}
            /* vineteado: concentra la atencion en el centro del barrio */
            .omni-vignette{position:absolute;inset:0;pointer-events:none;z-index:400;
                box-shadow:inset 0 0 160px 40px rgba(0,0,0,.55);}
            /* retícula tenue, estilo tablero de operaciones */
            .omni-grid{position:absolute;inset:0;pointer-events:none;z-index:399;opacity:.16;
                background-image:linear-gradient(rgba(148,163,184,.55) 1px,transparent 1px),
                                 linear-gradient(90deg,rgba(148,163,184,.55) 1px,transparent 1px);
                background-size:120px 120px;}
        `}</style>
        <MapContainer center={[center.lat, center.lng]} zoom={center.zoom} className="w-full h-full omni-map" style={{ background: "#07080a" }} preferCanvas>
            <TileLayer url={tl.url} attribution={tl.attr} maxZoom={19} />
            {tl.labels && <Pane name="omni-labels" style={{ zIndex: 350 }}><TileLayer url={tl.labels} maxZoom={19} /></Pane>}
            <MapEvents onView={onView} />
            {geo.map((g) => {
                const d = devices.find((x) => x.id === g.deviceId);
                if (!d) return null;
                const isQ = d.type === "QUEUE_COUNTER";
                if (isQ && showVideo) return null; // rendered as a live video tile overlay
                const a = aforo[d.id] ?? 0;
                const st = isQ ? aforoStatus(a, limit) : (d.online ? "ok" : "full");
                const col = isQ ? aforoColor(a, limit) : (d.online ? "#10b981" : "#ef4444");
                const pulse = flashId === d.id || (isQ && st !== "ok");
                return (
                    <Marker key={g.deviceId} position={[g.lat, g.lng]} draggable={edit}
                        icon={makeIcon(isQ, isQ ? String(a) : "", col, pulse)}
                        eventHandlers={{
                            dragend: (e: any) => { const ll = e.target.getLatLng(); onMove(g.deviceId, ll.lat, ll.lng); },
                            click: () => { if (!edit) onSelect(d.id); },
                        }} />
                );
            })}
            {showVideo && <VideoOverlays geo={geo} devices={devices} aforo={aforo} limit={limit} onSelect={onSelect} />}
            {tl.dark && <><div className="omni-grid" /><div className="omni-vignette" /></>}
        </MapContainer>
        </>
    );
}
