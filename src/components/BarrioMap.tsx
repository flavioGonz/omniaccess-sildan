"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, TileLayer, Polygon, Polyline, Marker, Popup, Tooltip as LTooltip, useMap, useMapEvents } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import {
    MousePointer2, Hexagon, Video, Trash2, Save, Pencil, X, Check,
    Loader2, MapPin, Undo2, Radio, Pencil as PencilIcon, LandPlot,
    Layers3, ChevronDown, Plus, Minus, Crosshair, Maximize2, Minimize2, Search, Eye, EyeOff, SquareParking, Move, RotateCw,
    Camera as CamIco, Hexagon as PerimIco, Shield as GuardIco, Type as TypeIco, LandPlot as LoteIco,
    BookText, LocateFixed, Tag, User as UserIcon, Fence, Car, Clock, StickyNote, Palette, Compass, Home, Route, ShieldAlert, Volume2, VolumeX, Play, Activity, ListFilter,
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { sileo as toast } from "sileo";
import { getBarrioMap, type BarrioMapData } from "@/app/actions/barriomap";
import { getParkingSlots, getPlateSlotMap } from "@/app/actions/parking";
import { getSlotDetail, type SlotDetail } from "@/app/actions/plazas";
import { getBitacoraPage } from "@/app/actions/bitacora";
import { io } from "socket.io-client";
import { FlowAnims, FlowColumn, useFlow } from "@/components/barrio/FlowLayer";
import { LogIn, LogOut } from "lucide-react";
import { getDevices } from "@/app/actions/devices";
import { getIntrusionCameras, getAnalyticsGeometryBatch, ackAlarms, getDetectionHistory, type IntrusionCam } from "@/app/actions/detections";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { montarVivo } from "@/lib/vivo";
import { BotonFijar, useVivo } from "@/components/vivo/PanelVivo";
import { useRouter } from "next/navigation";

type Tool = "select" | "perimeter" | "camera" | "lote" | "division" | "street";
type LL = [number, number];
type Base = "Táctico" | "Satélite" | "Calles";
type SelKind = "street" | "camera" | "lote";
type CtxKind = "street" | "camera" | "lote" | "guard" | "division" | "map" | "intr";
type DivTipo = "pared" | "tejido" | "alambrado";

// Estilo de cada tipo de división (línea)
const DIV_STYLE: Record<DivTipo, { color: string; weight: number; dashArray?: string; label: string }> = {
    pared: { color: "#a8a29e", weight: 5, label: "Pared" },
    tejido: { color: "#93c5fd", weight: 3, dashArray: "10 6", label: "Tejido" },
    alambrado: { color: "#fcd34d", weight: 2, dashArray: "2 7", label: "Alambrado" },
};

const CAM_COLORS = ["#2563eb", "#ef4444", "#22c55e", "#f59e0b", "#a855f7", "#06b6d4", "#e5e7eb", "#111827"];
const camGlyph = (size: number, color: string) => `
  <span class="cam-glyph" style="width:${size}px;height:${size}px;border-radius:${Math.round(size * 0.27)}px;background:${color};border:2px solid #fff;display:flex;align-items:center;justify-content:center;box-shadow:0 3px 6px rgba(0,0,0,.4)">
    <svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(size * 0.57)}" height="${Math.round(size * 0.57)}" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m22 8-6 4 6 4V8Z"/><rect width="14" height="12" x="2" y="6" rx="2" ry="2"/></svg>
  </span>`;
// Flecha de dirección (hacia dónde apunta) orbitando el ícono según el rumbo (0 = norte).
const camArrow = (size: number, color: string, rumbo?: number | null) => rumbo == null ? "" : `
  <span style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%) rotate(${Math.round(rumbo)}deg);pointer-events:none">
    <span style="display:block;transform:translateY(-${Math.round(size * 0.62 + 9)}px)">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="${color}" stroke="#fff" stroke-width="1.5"><path d="M12 2 L19 21 L12 17 L5 21 Z"/></svg>
    </span>
  </span>`;
const camHtml = (o?: { rumbo?: number | null; size?: number; color?: string }) => {
    const size = o?.size || 30, color = o?.color || "#2563eb";
    return `<div style="position:relative;display:flex;align-items:center;justify-content:center;transform:translateY(-4px)">${camArrow(size, color, o?.rumbo)}${camGlyph(size, color)}</div>`;
};
const camIconDe = (o?: { rumbo?: number | null; size?: number; color?: string }, extra = "") => {
    const size = o?.size || 30;
    return L.divIcon({ className: "bg-transparent border-0 " + extra, html: camHtml(o), iconSize: [size, size], iconAnchor: [size / 2, Math.round(size * 0.73)], popupAnchor: [0, -Math.round(size * 0.66)] });
};

const guardIconHtml = (name: string, heading?: number | null) => `
<div style="display:flex;flex-direction:column;align-items:center;transform:translateY(-2px)">
  <span style="margin-bottom:2px;padding:1px 6px;border-radius:6px;background:rgba(16,185,129,.95);color:#fff;font-size:10px;font-weight:700;white-space:nowrap;box-shadow:0 2px 6px rgba(0,0,0,.4)">${name}</span>
  <span style="position:relative;width:30px;height:30px;border-radius:50%;background:#10b981;border:3px solid #fff;display:flex;align-items:center;justify-content:center;box-shadow:0 3px 8px rgba(0,0,0,.45)">
    ${heading != null ? `<span style="position:absolute;top:-9px;left:50%;transform:translateX(-50%) rotate(${Math.round(heading)}deg);transform-origin:50% 24px"><svg width="14" height="14" viewBox="0 0 24 24" fill="#10b981" stroke="#fff" stroke-width="1.5"><path d="M12 2 L19 21 L12 17 L5 21 Z"/></svg></span>` : ``}
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/></svg>
  </span>
</div>`;

const centroid = (pts: LL[]): LL => {
    if (!pts.length) return [0, 0];
    let a = 0, cx = 0, cy = 0;
    for (let i = 0; i < pts.length; i++) {
        const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length];
        const f = x1 * y2 - x2 * y1; a += f; cx += (x1 + x2) * f; cy += (y1 + y2) * f;
    }
    if (Math.abs(a) < 1e-12) { const s = pts.reduce((p, c) => [p[0] + c[0], p[1] + c[1]], [0, 0]); return [s[0] / pts.length, s[1] / pts.length]; }
    a *= 0.5; return [cx / (6 * a), cy / (6 * a)];
};

// ── Ruteo por calles ──────────────────────────────────────────────────────
// Distancia métrica aproximada (haversine) entre dos coordenadas.
const RAD = Math.PI / 180;
function hav(a: LL, b: LL): number {
    const R = 6371000;
    const dLat = (b[0] - a[0]) * RAD, dLng = (b[1] - a[1]) * RAD;
    const la1 = a[0] * RAD, la2 = b[0] * RAD;
    const x = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(x)));
}
// Proyección de un punto p sobre el segmento a-b (planar a escala de barrio).
function projSeg(p: LL, a: LL, b: LL): LL {
    const ay = a[0], ax = a[1], by = b[0], bx = b[1], py = p[0], px = p[1];
    const dx = bx - ax, dy = by - ay; const L2 = dx * dx + dy * dy;
    let t = L2 ? ((px - ax) * dx + (py - ay) * dy) / L2 : 0; t = Math.max(0, Math.min(1, t));
    return [ay + t * dy, ax + t * dx];
}
type Street = { id: string; name?: string; points: LL[] };
const gkey = (ll: LL) => `${ll[0].toFixed(5)},${ll[1].toFixed(5)}`;
type GraphBase = { coords: Map<string, LL>; adj: Map<string, [string, number][]>; segs: [LL, LL][] };
// El grafo base (nodos+aristas de las calles) es CARO de armar (fusión O(V²) de nodos cercanos).
// Se cachea por firma de las calles y se reutiliza en cada ruteo (solo se agregan los accesos).
let _gbSig = ""; let _gbBase: GraphBase | null = null;
function buildBase(list: Street[]): GraphBase {
    const coords = new Map<string, LL>();
    const adj = new Map<string, [string, number][]>();
    const node = (ll: LL) => { const k = gkey(ll); if (!coords.has(k)) { coords.set(k, ll); adj.set(k, []); } return k; };
    const edge = (k1: string, k2: string, w: number) => { if (k1 === k2) return; adj.get(k1)!.push([k2, w]); adj.get(k2)!.push([k1, w]); };
    const segs: [LL, LL][] = [];
    for (const s of list) {
        const pts = s.points; let prev: string | null = null;
        for (const pt of pts) { const k = node(pt); if (prev) edge(prev, k, hav(coords.get(prev)!, pt)); prev = k; }
        for (let i = 0; i + 1 < pts.length; i++) segs.push([pts[i], pts[i + 1]]);
    }
    const ks = [...coords.keys()];
    for (let i = 0; i < ks.length; i++) for (let j = i + 1; j < ks.length; j++) {
        const d = hav(coords.get(ks[i])!, coords.get(ks[j])!); if (d > 0 && d < 8) edge(ks[i], ks[j], d);
    }
    return { coords, adj, segs };
}
// Calcula la ruta siguiendo la red de calles (Dijkstra). Sin calles o sin camino → recta directa.
function routeOnStreets(streets: Street[] | undefined, from: LL, to: LL): LL[] {
    const list = (streets || []).filter((s) => (s.points || []).length >= 2);
    if (!list.length) return [from, to];
    const sig = list.length + ":" + list.reduce((a, s) => a + s.points.length, 0) + ":" + (list[0].id || "") + ":" + (list[list.length - 1].id || "");
    if (_gbSig !== sig || !_gbBase) { _gbBase = buildBase(list); _gbSig = sig; }
    const base = _gbBase;
    // Copia liviana del grafo para insertar los nodos de acceso sin tocar la caché.
    const coords = new Map(base.coords);
    const adj = new Map<string, [string, number][]>();
    for (const [k, v] of base.adj) adj.set(k, v.slice());
    const edge = (k1: string, k2: string, w: number) => { if (!adj.has(k1)) adj.set(k1, []); if (!adj.has(k2)) adj.set(k2, []); adj.get(k1)!.push([k2, w]); adj.get(k2)!.push([k1, w]); };
    const access = (p: LL, name: string): string => {
        let best: { d: number; a: LL; b: LL; point: LL } | null = null;
        for (const [a, b] of base.segs) { const point = projSeg(p, a, b); const d = hav(p, point); if (!best || d < best.d) best = { d, a, b, point }; }
        if (!best) { coords.set(name, p); adj.set(name, []); return name; }
        coords.set(name, best.point); adj.set(name, []);
        edge(name, gkey(best.a), hav(best.point, best.a));
        edge(name, gkey(best.b), hav(best.point, best.b));
        return name;
    };
    const kf = access(from, "__from"), kt = access(to, "__to");
    const dist = new Map<string, number>(), prev = new Map<string, string | null>(), seen = new Set<string>();
    for (const k of adj.keys()) dist.set(k, Infinity);
    dist.set(kf, 0); prev.set(kf, null);
    while (true) {
        let u: string | null = null, ud = Infinity;
        for (const [k, dv] of dist) if (!seen.has(k) && dv < ud) { ud = dv; u = k; }
        if (u == null || u === kt) break; seen.add(u);
        for (const [v, w] of adj.get(u) || []) { if (seen.has(v)) continue; const nd = ud + w; if (nd < (dist.get(v) ?? Infinity)) { dist.set(v, nd); prev.set(v, u); } }
    }
    if ((dist.get(kt) ?? Infinity) === Infinity) return [from, to];
    const mid: LL[] = []; let c: string | null = kt;
    while (c != null) { const cc = coords.get(c); if (cc) mid.unshift(cc); c = prev.get(c) ?? null; }
    return cleanPath([from, ...mid, to]);
}
// Limpia la ruta: quita puntos casi repetidos y "espolones" (donde el camino se devuelve
// sobre sí mismo formando una U/gancho), que son los errores visibles en la línea.
function cleanPath(path: LL[]): LL[] {
    const p: LL[] = [];
    for (const pt of path) { if (!p.length || hav(p[p.length - 1], pt) > 1.5) p.push(pt); }
    let changed = true;
    while (changed && p.length > 2) {
        changed = false;
        for (let i = 1; i < p.length - 1; i++) {
            const a = p[i - 1], b = p[i], c = p[i + 1];
            const v1x = b[0] - a[0], v1y = b[1] - a[1], v2x = c[0] - b[0], v2y = c[1] - b[1];
            const m1 = Math.hypot(v1x, v1y), m2 = Math.hypot(v2x, v2y);
            if (m1 > 0 && m2 > 0) {
                const cos = (v1x * v2x + v1y * v2y) / (m1 * m2);
                if (cos < -0.6) { p.splice(i, 1); changed = true; break; } // gancho / reversa → quitar
            }
        }
    }
    return p;
}
// Recorta la ruta a los primeros `maxM` metros (para mostrar solo un tramo desde el origen).
function headPath(path: LL[], maxM: number): LL[] {
    if (path.length < 2) return path;
    const out: LL[] = [path[0]]; let acc = 0;
    for (let i = 1; i < path.length; i++) {
        const d = hav(path[i - 1], path[i]);
        if (acc + d >= maxM) { const t = (maxM - acc) / d; out.push([path[i - 1][0] + (path[i][0] - path[i - 1][0]) * t, path[i - 1][1] + (path[i][1] - path[i - 1][1]) * t]); return out; }
        acc += d; out.push(path[i]);
    }
    return out;
}
// Recorta la ruta a los últimos `maxM` metros (termina en el destino).
function tailPath(path: LL[], maxM: number): LL[] {
    return headPath([...path].reverse(), maxM).reverse();
}

function MapRefGrabber({ onMap }: { onMap: (m: L.Map) => void }) {
    const map = useMap();
    useEffect(() => { onMap(map); }, [map, onMap]);
    return null;
}
function ClickHandler({ onClick }: { onClick: (ll: LL) => void }) {
    useMapEvents({ click(e) { onClick([e.latlng.lat, e.latlng.lng]); } });
    return null;
}
function MapCtxMenu({ onCtx }: { onCtx: (oe: MouseEvent) => void }) {
    useMapEvents({ contextmenu(e: any) {
        const oe = e.originalEvent as MouseEvent; try { oe?.preventDefault?.(); } catch { }
        const t = oe?.target as HTMLElement | null;
        if (t && (t.closest?.(".leaflet-marker-pane") || ["path", "polyline", "polygon", "image"].includes((t.tagName || "").toLowerCase()))) return;
        onCtx(oe);
    } });
    return null;
}
type MiniGeom = { line?: { x: number; y: number }[]; field?: { x: number; y: number }[] };
function MiniGeomOverlay({ geom }: { geom?: MiniGeom }) {
    if (!geom || ((!geom.line || geom.line.length < 2) && (!geom.field || geom.field.length < 3))) return null;
    return (
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 w-full h-full pointer-events-none">
            {geom.field && geom.field.length >= 3 && <polygon points={geom.field.map((p) => `${p.x},${p.y}`).join(" ")} fill="rgba(244,63,94,0.18)" stroke="#f43f5e" strokeWidth={1.4} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />}
            {geom.line && geom.line.length === 2 && <line x1={geom.line[0].x} y1={geom.line[0].y} x2={geom.line[1].x} y2={geom.line[1].y} stroke="#38bdf8" strokeWidth={2} strokeLinecap="round" vectorEffect="non-scaling-stroke" />}
        </svg>
    );
}
function ZoomTracker({ onZoom }: { onZoom: (z: number) => void }) {
    const map = useMapEvents({ zoomend: () => onZoom(map.getZoom()) });
    useEffect(() => { onZoom(map.getZoom()); /* eslint-disable-next-line */ }, []);
    return null;
}
// Publica los límites visibles (con margen) para hacer culling de lotes fuera de pantalla.
function BoundsTracker({ onBounds }: { onBounds: (b: L.LatLngBounds) => void }) {
    const map = useMapEvents({ moveend: () => onBounds(map.getBounds().pad(0.25)), zoomend: () => onBounds(map.getBounds().pad(0.25)) });
    useEffect(() => { onBounds(map.getBounds().pad(0.25)); /* eslint-disable-next-line */ }, []);
    return null;
}

function LiveMp4({ deviceId, className }: { deviceId: string; className?: string }) {
    const ref = useRef<HTMLVideoElement>(null);
    const [nonce, setNonce] = useState(0);
    useEffect(() => { const v = ref.current; if (!v) return; return montarVivo(v, deviceId); }, [deviceId, nonce]);
    return (
        <div className={cn("relative block group/vid", className || "w-full h-full")}>
            <video ref={ref} muted autoPlay playsInline className="block w-full h-full object-cover bg-black" />
            <button onClick={(e) => { e.stopPropagation(); setNonce((n) => n + 1); }} title="Refrescar video"
                className="absolute top-1 right-1 z-[10] h-6 w-6 rounded-md bg-black/55 text-white/85 hover:bg-black/85 hover:text-white flex items-center justify-center opacity-0 group-hover/vid:opacity-100 transition-opacity">
                <RotateCw size={12} />
            </button>
        </div>
    );
}

/* ── Capa de lotes memoizada: no se re-renderiza cuando se actualizan guardias/flujo,
 *    solo cuando cambian los lotes, la selección, el zoom o el lote localizado.
 *    Las etiquetas de nombre se muestran solo con zoom alto (rendimiento con muchos lotes). */
// Ancla invisible: el nombre lo dibuja un Tooltip permanente (Leaflet lo mantiene pegado
// al punto durante zoom/pan, sin el "salto" que tenían los divIcon con transform).
const emptyPin = L.divIcon({ className: "bg-transparent border-0", html: "", iconSize: [0, 0], iconAnchor: [0, 0] });
// Manija (vértice) para editar los puntos de una división guardada.
const vertexIcon = L.divIcon({ className: "bg-transparent border-0", html: `<span style="display:block;width:14px;height:14px;border-radius:50%;background:#f59e0b;border:2px solid #fff;box-shadow:0 1px 5px rgba(0,0,0,.55);cursor:grab"></span>`, iconSize: [14, 14], iconAnchor: [7, 7] });
const intrPulseIcon = L.divIcon({ className: "bg-transparent border-0", html: `<span class="intr-pulse"></span>`, iconSize: [0, 0], iconAnchor: [0, 0] });
function destPoint(lat: number, lng: number, bearingDeg: number, meters: number): LL {
    const R = 6371000; const br = (bearingDeg * Math.PI) / 180; const lat1 = (lat * Math.PI) / 180; const lng1 = (lng * Math.PI) / 180; const dR = meters / R;
    const lat2 = Math.asin(Math.sin(lat1) * Math.cos(dR) + Math.cos(lat1) * Math.sin(dR) * Math.cos(br));
    const lng2 = lng1 + Math.atan2(Math.sin(br) * Math.sin(dR) * Math.cos(lat1), Math.cos(dR) - Math.sin(lat1) * Math.sin(lat2));
    return [(lat2 * 180) / Math.PI, (lng2 * 180) / Math.PI];
}

const LotesLayer = React.memo(function LotesLayer({ lotes, selectedId, showNames, showPolys, zoom, bounds, locatedId, onSelect, onEdit, onCtx }: {
    lotes: { id: string; name?: string; points: LL[]; parkingSlotId?: string }[];
    selectedId: string | null; showNames: boolean; showPolys: boolean; zoom: number; bounds: L.LatLngBounds | null; locatedId: string | null;
    onSelect: (id: string) => void; onEdit: (id: string) => void; onCtx: (e: any, id: string) => void;
}) {
    // Culling por viewport: solo procesamos los lotes visibles (clave con muchos lotes).
    const items = useMemo(() => {
        const out: { id: string; name?: string; points: LL[]; parkingSlotId?: string; c: LL }[] = [];
        for (const lo of lotes) {
            if (!lo.points || lo.points.length < 3) continue;
            const c = centroid(lo.points);
            if (bounds && !bounds.contains(c as any)) continue;
            out.push({ ...lo, c });
        }
        return out;
    }, [lotes, bounds]);
    const verNombres = showNames && zoom >= 16;
    return (
        <>
            {showPolys && items.map((lo) => (
                <Polygon key={lo.id} positions={lo.points}
                    pathOptions={{
                        className: locatedId === lo.id ? "lote-blink" : undefined,
                        color: selectedId === lo.id ? "#f59e0b" : lo.parkingSlotId ? "#22c55e" : "#a855f7",
                        weight: selectedId === lo.id ? 3 : 1.5,
                        fillColor: lo.parkingSlotId ? "#22c55e" : "#a855f7",
                        fillOpacity: selectedId === lo.id ? 0.3 : 0.14,
                    }}
                    eventHandlers={{ click: () => onSelect(lo.id), dblclick: () => onEdit(lo.id), contextmenu: (e) => onCtx(e, lo.id) }} />
            ))}
            {/* Etiquetas: ancla invisible + Tooltip permanente (estable en zoom/pan). Clicable. */}
            {verNombres && items.map((lo) => (
                <Marker key={`ln_${lo.id}`} position={lo.c} icon={emptyPin} interactive={false}>
                    <LTooltip permanent interactive direction="center" offset={[0, 0]}
                        className={cn("lote-lbl", selectedId === lo.id && "sel", locatedId === lo.id && "loc", lo.parkingSlotId ? "ok" : "na")}>
                        <span onClick={() => onSelect(lo.id)} onDoubleClick={() => onEdit(lo.id)} onContextMenu={(e) => onCtx(e, lo.id)}>{lo.name || "·"}</span>
                    </LTooltip>
                </Marker>
            ))}
        </>
    );
});

/* ── Bloque colapsable del drawer (a nivel de módulo para no remontar el input) ── */
function DrawerBlock({ open, onToggle, icon: Icon, titulo, children }: { open: boolean; onToggle: () => void; icon: any; titulo: string; children: React.ReactNode }) {
    return (
        <div className="rounded-xl border border-border bg-background/40 overflow-hidden">
            <button onClick={onToggle} className="w-full flex items-center gap-2 px-3 h-10 text-left hover:bg-accent/50 transition-colors">
                <Icon size={14} className="text-purple-500 shrink-0" />
                <span className="text-[11px] font-black uppercase tracking-widest text-muted-foreground flex-1">{titulo}</span>
                <ChevronDown size={14} className={cn("text-muted-foreground transition-transform", open && "rotate-180")} />
            </button>
            <AnimatePresence initial={false}>
                {open && (
                    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.18 }}>
                        <div className="px-3 pb-3 pt-1">{children}</div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}

/* ── Drawer de edición de lote: SVG animado, bloques separados y colapsables, adaptable light/dark ── */
function LoteDrawer({ value, slots, onChange, onSave, onClose, onDelete }: {
    value: { mode: "create" | "edit"; id?: string; name: string; parkingSlotId: string; points: LL[] };
    slots: any[];
    onChange: (patch: Partial<{ name: string; parkingSlotId: string }>) => void;
    onSave: () => void; onClose: () => void; onDelete?: () => void;
}) {
    const [abre, setAbre] = useState({ datos: true, plaza: true });
    const slot = slots.find((s: any) => s.id === value.parkingSlotId);
    return (
        <div className="fixed inset-0 z-[620] flex justify-end" onClick={onClose}>
            <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" />
            <motion.div initial={{ x: 380, opacity: 0.6 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 380, opacity: 0 }} transition={{ type: "spring", stiffness: 380, damping: 38 }}
                onClick={(e) => e.stopPropagation()}
                className="relative h-full w-[360px] max-w-[92vw] bg-card border-l border-border shadow-2xl flex flex-col">
                {/* Header con SVG animado */}
                <div className="flex items-center gap-3 px-4 py-4 border-b border-border">
                    <span className="relative h-10 w-10 flex items-center justify-center shrink-0">
                        <span className="absolute inset-0 rounded-2xl bg-purple-500/15 animate-ping" />
                        <span className="relative h-10 w-10 rounded-2xl bg-purple-500/15 flex items-center justify-center"><LandPlot size={20} className="text-purple-500" /></span>
                    </span>
                    <div className="min-w-0 flex-1">
                        <p className="text-sm font-bold text-foreground leading-tight">{value.mode === "create" ? "Nuevo lote" : "Editar lote"}</p>
                        <p className="text-[11px] text-muted-foreground leading-tight truncate">{value.name || "Sin nombre"}{slot ? ` · ${slot.label}` : ""}</p>
                    </div>
                    <button onClick={onClose} className="h-8 w-8 rounded-lg hover:bg-accent flex items-center justify-center text-muted-foreground shrink-0"><X size={16} /></button>
                </div>

                {/* Cuerpo */}
                <div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-3">
                    <DrawerBlock open={abre.datos} onToggle={() => setAbre((a) => ({ ...a, datos: !a.datos }))} icon={Tag} titulo="Identificación">
                        <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide">Nombre / número</label>
                        <input autoFocus value={value.name} onChange={(e) => onChange({ name: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter") onSave(); }}
                            placeholder="Ej: Lote 12" className="mt-1 w-full bg-background border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-purple-500 transition-colors" />
                    </DrawerBlock>

                    <DrawerBlock open={abre.plaza} onToggle={() => setAbre((a) => ({ ...a, plaza: !a.plaza }))} icon={SquareParking} titulo="Plaza de parking">
                        <select value={value.parkingSlotId} onChange={(e) => onChange({ parkingSlotId: e.target.value })}
                            className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-purple-500 transition-colors">
                            <option value="">— Sin vincular —</option>
                            {slots.map((s: any) => <option key={s.id} value={s.id}>{s.label}{s.user?.name ? ` · ${s.user.name}` : ""}</option>)}
                        </select>
                        {slot ? (
                            <div className="mt-2 flex items-center gap-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-2">
                                <UserIcon size={13} className="text-emerald-500 shrink-0" />
                                <span className="text-[12px] text-foreground/90 truncate">{slot.user?.name ? slot.user.name : "Plaza sin residente asignado"}</span>
                            </div>
                        ) : (
                            <p className="mt-1.5 text-[10px] text-muted-foreground">Vinculá el lote a una plaza para reflejar ocupación y residente.</p>
                        )}
                    </DrawerBlock>
                </div>

                {/* Footer */}
                <div className="flex items-center gap-2 px-3 py-3 border-t border-border">
                    {value.mode === "edit" && onDelete && (
                        <button onClick={onDelete} className="h-9 w-9 rounded-lg text-red-500 hover:bg-red-500/10 flex items-center justify-center shrink-0" title="Borrar lote"><Trash2 size={16} /></button>
                    )}
                    <button onClick={onClose} className="flex-1 h-9 rounded-lg text-xs font-bold text-muted-foreground hover:bg-accent transition-colors">Cancelar</button>
                    <button onClick={onSave} className="flex-1 h-9 rounded-lg text-xs font-bold bg-blue-600 text-white hover:bg-blue-500 flex items-center justify-center gap-1.5 transition-colors"><Check size={14} /> Guardar</button>
                </div>
            </motion.div>
        </div>
    );
}

/* ── Shell de drawer genérico del mapa (ficha de lote, bitácora), adaptable light/dark ── */
function MapDrawer({ title, subtitle, icon: Icon, accent = "blue", onClose, children }: {
    title: string; subtitle?: string; icon: any; accent?: "blue" | "emerald" | "purple"; onClose: () => void; children: React.ReactNode;
}) {
    const accentCls = accent === "emerald" ? "text-emerald-500 bg-emerald-500/15" : accent === "purple" ? "text-purple-500 bg-purple-500/15" : "text-blue-500 bg-blue-500/15";
    return (
        <div className="fixed inset-0 z-[625] flex justify-end" onClick={onClose}>
            <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" />
            <motion.div initial={{ x: 400, opacity: 0.6 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 400, opacity: 0 }} transition={{ type: "spring", stiffness: 380, damping: 38 }}
                onClick={(e) => e.stopPropagation()} className="relative h-full w-[380px] max-w-[94vw] bg-card border-l border-border shadow-2xl flex flex-col">
                <div className="flex items-center gap-3 px-4 py-4 border-b border-border">
                    <span className={cn("h-10 w-10 rounded-2xl flex items-center justify-center shrink-0", accentCls)}><Icon size={20} /></span>
                    <div className="min-w-0 flex-1">
                        <p className="text-sm font-bold text-foreground leading-tight truncate">{title}</p>
                        {subtitle && <p className="text-[11px] text-muted-foreground leading-tight truncate">{subtitle}</p>}
                    </div>
                    <button onClick={onClose} className="h-8 w-8 rounded-lg hover:bg-accent flex items-center justify-center text-muted-foreground shrink-0"><X size={16} /></button>
                </div>
                <div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-3">{children}</div>
            </motion.div>
        </div>
    );
}

const fechaHora = (iso: string) => { try { return new Date(iso).toLocaleString("es-UY", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }); } catch { return ""; } };

/* ── Burbujas de video en vivo, cada una sobre su cámara en el mapa (clon de San Nicolás) ── */
const BURBUJA_MEDIO = 118;
const BURBUJA_ALTO = 168;
const BURBUJA_SUBE = 34;
const PICO_TOLERANCIA = 2;

function BurbujasVivo({ camaras, nombre, onCerrarUna }: {
    camaras: { deviceId: string; lat: number; lng: number }[];
    nombre: (id: string) => string;
    onCerrarUna: (id: string) => void;
}) {
    const map = useMap();
    const { esFija } = useVivo();
    const nodos = useRef(new Map<string, HTMLDivElement>());
    const picos = useRef(new Map<string, HTMLSpanElement>());
    const lista = useRef<{ deviceId: string; lat: number; lng: number }[]>([]);

    const ubicar = useCallback(() => {
        const tam = map.getSize();
        for (const c of lista.current) {
            const el = nodos.current.get(c.deviceId);
            if (!el) continue;
            let p: L.Point;
            try { p = map.latLngToContainerPoint([c.lat, c.lng]); } catch { continue; }
            const x = Math.max(BURBUJA_MEDIO + 6, Math.min(tam.x - BURBUJA_MEDIO - 6, p.x));
            const y = Math.max(BURBUJA_ALTO + 6, p.y - BURBUJA_SUBE);
            el.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -100%)`;
            const pico = picos.current.get(c.deviceId);
            if (pico) pico.style.visibility = Math.abs(x - p.x) < PICO_TOLERANCIA ? "visible" : "hidden";
        }
    }, [map]);

    useMapEvents({ move: ubicar, zoom: ubicar, resize: ubicar });

    const utiles = camaras.filter((c) => Number.isFinite(c.lat) && Number.isFinite(c.lng) && !esFija(c.deviceId));
    lista.current = utiles;

    useEffect(() => { ubicar(); });
    if (!utiles.length) return null;

    return createPortal(
        <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 640 }}>
            {utiles.map((c) => (
                <div key={c.deviceId}
                    ref={(el) => { if (el) nodos.current.set(c.deviceId, el); else { nodos.current.delete(c.deviceId); picos.current.delete(c.deviceId); } }}
                    className="absolute left-0 top-0 pointer-events-auto" style={{ willChange: "transform" }}>
                    <motion.div initial={{ opacity: 0, scale: 0.9, y: 6 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.9 }} transition={{ type: "spring", stiffness: 420, damping: 32 }}>
                        <div className="rounded-xl overflow-hidden border border-white/15 shadow-2xl shadow-black/70 bg-[#0a0d12]">
                            <div className="relative w-[224px] h-[126px]"><LiveMp4 deviceId={c.deviceId} /></div>
                            <div className="px-2 py-1 bg-black/85 flex items-center gap-1.5">
                                <Radio size={10} className="text-red-400 shrink-0 animate-pulse" />
                                <span className="text-[11px] font-bold text-white truncate">{nombre(c.deviceId)}</span>
                                <span className="ml-auto flex items-center gap-0.5 shrink-0">
                                    <BotonFijar deviceId={c.deviceId} nombre={nombre(c.deviceId)} />
                                    <button onClick={() => onCerrarUna(c.deviceId)} title="Ocultar esta cámara"
                                        className="w-5 h-5 rounded text-white/45 hover:text-white hover:bg-white/10 flex items-center justify-center transition-colors"><X size={11} /></button>
                                </span>
                            </div>
                        </div>
                        <span ref={(el) => { if (el) picos.current.set(c.deviceId, el); }}
                            className="block mx-auto w-2 h-2 rotate-45 -mt-1 bg-black/85 border-r border-b border-white/15" />
                    </motion.div>
                </div>
            ))}
        </div>,
        map.getContainer(),
    );
}

export default function BarrioMap() {
    const router = useRouter();
    const [data, setData] = useState<BarrioMapData | null>(null);
    const [devices, setDevices] = useState<any[]>([]);
    const [slots, setSlots] = useState<any[]>([]);
    const [editing, setEditing] = useState(false);
    const [tool, setTool] = useState<Tool>("select");
    const [draftPerimeter, setDraftPerimeter] = useState<LL[]>([]);
    const [draftLote, setDraftLote] = useState<LL[]>([]);
    const [draftDivision, setDraftDivision] = useState<LL[]>([]);
    const [divTipo, setDivTipo] = useState<DivTipo>("pared");
    const [pendingCam, setPendingCam] = useState<string>("");
    const [selected, setSelected] = useState<{ type: SelKind; id: string } | null>(null);
    const [saving, setSaving] = useState(false);
    const [ctx, setCtx] = useState<{ x: number; y: number; type: CtxKind; id: string } | null>(null);
    const mapRef = useRef<L.Map | null>(null);
    const wrapRef = useRef<HTMLDivElement | null>(null);
    const [guards, setGuards] = useState<any[]>([]);
    const [liveSocket, setLiveSocket] = useState<any>(null);

    const [base, setBase] = useState<Base>("Satélite");
    const [menuCapas, setMenuCapas] = useState(false);
    // Por rendimiento: por defecto NO se dibujan los polígonos de lotes, solo los nombres.
    const [show, setShow] = useState({ cameras: true, lotes: false, loteNames: false, divisions: true, perimeter: true, guards: true, names: true, intrusion: true, fov: false });
    const [mapBounds, setMapBounds] = useState<L.LatLngBounds | null>(null);
    const [openCamPopup, setOpenCamPopup] = useState<string | null>(null); // cámara con popup de video abierto (lazy)
    const [pantalla, setPantalla] = useState(false);
    const [q, setQ] = useState("");
    const [zoom, setZoom] = useState(16);
    const [movingCam, setMovingCam] = useState<string | null>(null);
    const [located, setLocated] = useState<{ type: "lote" | "camera"; id: string } | null>(null);
    const locateTimer = useRef<any>(null);

    const [loteModal, setLoteModal] = useState<{ mode: "create" | "edit"; id?: string; name: string; parkingSlotId: string; points: LL[] } | null>(null);
    const [loteDetail, setLoteDetail] = useState<{ lote: any; loading: boolean; data: SlotDetail | null } | null>(null);
    const [bitacora, setBitacora] = useState<{ guardName: string; loading: boolean; entries: any[] } | null>(null);
    const [camCustom, setCamCustom] = useState<{ deviceId: string; rumbo: number; size: number; color: string } | null>(null);
    const [divCustom, setDivCustom] = useState<{ id: string; tipo: DivTipo; color: string; weight: number } | null>(null);
    const [extendDiv, setExtendDiv] = useState<string | null>(null);
    const [editDivPts, setEditDivPts] = useState<string | null>(null); // id de la división cuyos vértices se editan
    const [vivoTodas, setVivoTodas] = useState(false);
    const [ocultas, setOcultas] = useState<string[]>([]);
    const oscura = base !== "Calles";
    const editingRef = useRef(editing); editingRef.current = editing;
    const lotesRef = useRef<any[]>([]);
    const camerasRef = useRef<any[]>([]);
    const plateMapRef = useRef<Record<string, string>>({});
    const streetsRef = useRef<Street[]>([]);
    const centerRef = useRef<LL>([-34.9, -56.1]);
    const autoRef = useRef(false);
    const autoLastRef = useRef(0);
    const rutaTimer = useRef<any>(null);
    const [autoResaltar, setAutoResaltar] = useState(false);
    autoRef.current = autoResaltar;
    // Persistimos el toggle de auto-resaltado (botón casa) para que sobreviva al F5.
    useEffect(() => { try { if (localStorage.getItem("olivos.autoResaltar") === "1") setAutoResaltar(true); } catch { } }, []);
    useEffect(() => { try { localStorage.setItem("olivos.autoResaltar", autoResaltar ? "1" : "0"); } catch { } }, [autoResaltar]);
    const [ruta, setRuta] = useState<{ path: LL[]; key: number; dir?: string } | null>(null);
    const [draftStreet, setDraftStreet] = useState<LL[]>([]);
    const [importingOsm, setImportingOsm] = useState(false);
    // ── Alertas de intrusión en vivo sobre el mapa (cruce de línea / zona) ──
    const [intrAlerts, setIntrAlerts] = useState<Record<string, { ts: number; ms?: number; id?: string; type: string; label?: string | null; name?: string }>>({});
    const [alertCard, setAlertCard] = useState<null | { deviceId: string; ms: number; id?: string; type: string; label?: string | null; name?: string }>(null);
    const [soundOn, setSoundOn] = useState(true);
    const [recentIntr, setRecentIntr] = useState<any[]>([]);
    const [feedOpen, setFeedOpen] = useState(false);
    useEffect(() => { try { if (localStorage.getItem("olivos.intrFeed") === "1") setFeedOpen(true); } catch { } }, []);
    useEffect(() => { try { localStorage.setItem("olivos.intrFeed", feedOpen ? "1" : "0"); } catch { } }, [feedOpen]);
    useEffect(() => { getDetectionHistory({ pageSize: 14 }).then((r: any) => setRecentIntr((r.items || []).map((it: any) => ({ id: it.id, deviceId: it.deviceId, name: it.deviceName, type: it.type, label: it.label, ms: new Date(it.timestamp).getTime() })))).catch(() => { }); }, []);
    const soundRef = useRef(true);
    useEffect(() => { soundRef.current = soundOn; }, [soundOn]);
    useEffect(() => { try { if (localStorage.getItem("olivos.intrSound") === "0") setSoundOn(false); } catch { } }, []);
    useEffect(() => { try { localStorage.setItem("olivos.intrSound", soundOn ? "1" : "0"); } catch { } }, [soundOn]);
    const [draftIntr, setDraftIntr] = useState<LL[]>([]);
    const [intrDraw, setIntrDraw] = useState<{ kind: "line" | "zone"; deviceId: string } | null>(null);
    const [intrPick, setIntrPick] = useState<{ kind: "line" | "zone" } | null>(null);
    const [intrPickCam, setIntrPickCam] = useState<string>("");
    const [intrCamList, setIntrCamList] = useState<IntrusionCam[]>([]);
    const [intrGeomPrev, setIntrGeomPrev] = useState<Record<string, MiniGeom>>({});
    const [geomLoading, setGeomLoading] = useState(false);
    const geomLoadedRef = useRef(false);
    useEffect(() => { getIntrusionCameras().then((c) => setIntrCamList(c || [])).catch(() => { }); }, []);
    useEffect(() => { if (!intrPickCam || intrGeomPrev[intrPickCam]) return; getAnalyticsGeometryBatch([intrPickCam]).then((g: any) => setIntrGeomPrev((p) => ({ ...p, ...g }))).catch(() => { }); }, [intrPickCam, intrGeomPrev]);
    // En modo edición, en segundo plano, traemos la analítica (línea/zona) real de cada canal para
    // poder listar/clasificar SOLO las cámaras que tienen un cruce o una zona configurada.
    useEffect(() => {
        if (!editing || geomLoadedRef.current || !intrCamList.length) return;
        geomLoadedRef.current = true; setGeomLoading(true);
        const ids = intrCamList.filter((c) => c.ch != null).map((c) => c.id);
        (async () => {
            for (let i = 0; i < ids.length; i += 10) {
                try { const g = await getAnalyticsGeometryBatch(ids.slice(i, i + 10)); setIntrGeomPrev((p) => ({ ...p, ...g })); } catch { }
            }
            setGeomLoading(false);
        })();
    }, [editing, intrCamList]);
    const geomKinds = useCallback((id: string) => { const g = intrGeomPrev[id]; return { line: !!(g && g.line && g.line.length >= 2), zone: !!(g && g.field && g.field.length >= 3) }; }, [intrGeomPrev]);
    const [intrMenu, setIntrMenu] = useState(false);
    const [intrDrawer, setIntrDrawer] = useState<null | "line" | "zone">(null);
    const [camSearch, setCamSearch] = useState("");
    const [camOpen, setCamOpen] = useState(false);
    const [placeSearch, setPlaceSearch] = useState("");
    const [placeDrawer, setPlaceDrawer] = useState(false);
    const beepRef = useRef<AudioContext | null>(null);
    const lastBeepRef = useRef<Record<string, number>>({});
    const playBeep = useCallback((label?: string | null) => { try { const AC = (window.AudioContext || (window as any).webkitAudioContext); if (!AC) return; const ac = beepRef.current || (beepRef.current = new AC()); if (ac.state === "suspended") ac.resume().catch(() => { }); const seq: [number, number, number][] = label === "human" ? [[1046, 0, 0.13], [1318, 0.17, 0.13]] : [[660, 0, 0.2]]; for (const [f, at, du] of seq) { const o = ac.createOscillator(); const g = ac.createGain(); o.type = "square"; o.frequency.value = f; o.connect(g); g.connect(ac.destination); const t = ac.currentTime + at; g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(label === "human" ? 0.28 : 0.2, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + du); o.start(t); o.stop(t + du + 0.03); } } catch { } }, []);
    const speakAlert = useCallback((label?: string | null, name?: string | null) => { try { const w: any = window; if (!w.speechSynthesis) return; const who = label === "vehicle" ? "Vehículo" : label === "human" ? "Persona" : "Detección"; const u = new SpeechSynthesisUtterance(`${who} en ${name || "cámara"}`); u.lang = "es-UY"; u.rate = 1.08; w.speechSynthesis.cancel(); w.speechSynthesis.speak(u); } catch { } }, []);
    const ackAlert = useCallback(async (deviceId: string, kind: "real" | "false") => { try { await ackAlarms(deviceId, kind); } catch { } setAlertCard(null); setIntrAlerts((p) => { const o = { ...p }; delete o[deviceId]; return o; }); toast.success({ title: kind === "real" ? "Alarma confirmada" : "Marcada como falsa" }); }, []);
    useEffect(() => { const iv = setInterval(() => { setIntrAlerts((prev) => { const now = Date.now(); const out: typeof prev = {}; let ch = false; for (const k in prev) { if (now - prev[k].ts < 9000) out[k] = prev[k]; else ch = true; } return ch ? out : prev; }); }, 1000); return () => clearInterval(iv); }, []);

    useEffect(() => {
        const s = io(window.location.origin, { path: "/io/socket.io", transports: ["polling"], upgrade: false, reconnection: true, reconnectionAttempts: Infinity, reconnectionDelay: 1000, reconnectionDelayMax: 8000 });
        s.on("guard_locations", (data: any[]) => setGuards(Array.isArray(data) ? data.filter((g) => g.lat != null) : []));
        s.on("general_detection", (d: any) => {
            if (!d || !d.deviceId) return;
            const ms = d.timestamp ? new Date(d.timestamp).getTime() : Date.now();
            setIntrAlerts((prev) => ({ ...prev, [d.deviceId]: { ts: Date.now(), ms, id: d.id, type: d.type, label: d.label, name: d.deviceName } }));
            setRecentIntr((prev) => [{ id: d.id, deviceId: d.deviceId, name: d.deviceName, type: d.type, label: d.label, ms }, ...prev].slice(0, 14));
            try { const lb = lastBeepRef.current[d.deviceId] || 0; if (soundRef.current && Date.now() - lb > 6000) { lastBeepRef.current[d.deviceId] = Date.now(); playBeep(d.label); speakAlert(d.label, d.deviceName); } } catch { }
            if (autoRef.current) { const cam = camerasRef.current.find((c: any) => c.deviceId === d.deviceId); if (cam && mapRef.current) { try { mapRef.current.setView([cam.lat, cam.lng], Math.max(mapRef.current.getZoom(), 18), { animate: true }); } catch { } } }
        });
        s.on("connect", () => s.emit("get_guard_locations"));
        setLiveSocket(s);
        const iv = setInterval(() => { if (s.connected) s.emit("get_guard_locations"); }, 30000);
        return () => { clearInterval(iv); setLiveSocket(null); s.disconnect(); };
    }, []);

    useEffect(() => {
        getBarrioMap().then((d) => { setData(d); setZoom(d.zoom || 16); }).catch(() => setData(null));
        getDevices().then((d: any) => setDevices((d || []).filter((x: any) => x.deviceType === "LPR_CAMERA" || x.deviceType === "CAMERA"))).catch(() => { });
        getParkingSlots().then((s: any) => setSlots(s || [])).catch(() => { });
        getPlateSlotMap().then((m: any) => { plateMapRef.current = m || {}; }).catch(() => { });
    }, []);
    useEffect(() => {
        const close = () => { setCtx(null); setIntrMenu(false); };
        window.addEventListener("click", close);
        return () => window.removeEventListener("click", close);
    }, []);
    useEffect(() => {
        const onFs = () => setPantalla(!!document.fullscreenElement);
        document.addEventListener("fullscreenchange", onFs);
        return () => document.removeEventListener("fullscreenchange", onFs);
    }, []);

    const devById = useMemo(() => Object.fromEntries(devices.map((d) => [d.id, d])), [devices]);
    const camsNamed = useMemo(() => (data?.cameras || []).map((c) => ({ ...c, name: (devById as any)[c.deviceId]?.name })), [data, devById]);
    const flow = useFlow(data?.streets || [], camsNamed, liveSocket);
    const animateRef = useRef<((ev: any) => void) | null>(null);
    animateRef.current = flow.animateEvent;
    const clearRef = useRef<(() => void) | null>(null);
    clearRef.current = flow.clearAnims;
    const placedIds = useMemo(() => new Set((data?.cameras || []).map((c) => c.deviceId)), [data]);
    const unplaced = devices.filter((d) => !placedIds.has(d.id));
    const placeFiltered = placeSearch.trim() ? unplaced.filter((d) => (d.name || "").toLowerCase().includes(placeSearch.trim().toLowerCase())) : unplaced;
    const placeCamera = (id: string, ll: LL) => { setData((d) => d ? { ...d, cameras: [...d.cameras.filter((c) => c.deviceId !== id), { deviceId: id, lat: ll[0], lng: ll[1] }] } : d); };

    // Guarda TODO el mapa (API route POST — pasa el proxy sin problema)
    const persistNow = useCallback(async (next: BarrioMapData, okMsg = "Guardado") => {
        const m = mapRef.current;
        const payload: BarrioMapData = { ...next, center: m ? [m.getCenter().lat, m.getCenter().lng] : next.center, zoom: m ? m.getZoom() : next.zoom };
        setData(payload);
        try {
            const r = await fetch("/api/barriomap", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
            const j = await r.json().catch(() => ({}));
            if (r.ok && j.ok) toast.success({ title: okMsg });
            else toast.error({ title: "Error al guardar", description: j.error || `HTTP ${r.status}` });
        } catch (e: any) { toast.error({ title: "Error al guardar", description: String(e?.message || e) }); }
    }, []);

    const editLote = useCallback((id: string) => {
        setData((cur) => {
            const l = (cur?.lotes || []).find((x) => x.id === id);
            if (l) setLoteModal({ mode: "edit", id, name: l.name || "", parkingSlotId: l.parkingSlotId || "", points: l.points });
            return cur;
        });
    }, []);
    const abrirLoteDetalle = useCallback((id: string) => {
        const lo = lotesRef.current.find((x: any) => x.id === id);
        if (!lo) return;
        setLoteDetail({ lote: lo, loading: !!lo.parkingSlotId, data: null });
        if (lo.parkingSlotId) {
            getSlotDetail(lo.parkingSlotId)
                .then((d) => setLoteDetail((cur) => cur && cur.lote.id === id ? { ...cur, loading: false, data: d } : cur))
                .catch(() => setLoteDetail((cur) => cur && cur.lote.id === id ? { ...cur, loading: false } : cur));
        }
    }, []);
    const abrirBitacora = useCallback(async (guardName: string) => {
        setBitacora({ guardName, loading: true, entries: [] });
        try {
            const r: any = await getBitacoraPage(0, 40, "", guardName);
            const entries = Array.isArray(r) ? r : (r?.entries || []);
            setBitacora({ guardName, loading: false, entries });
        } catch { setBitacora({ guardName, loading: false, entries: [] }); }
    }, []);
    const onSelectLote = useCallback((id: string) => {
        if (editingRef.current) setSelected({ type: "lote", id });
        else abrirLoteDetalle(id);
    }, [abrirLoteDetalle]);
    const openCtx = useCallback((e: any, type: CtxKind, id: string) => {
        const oe = e.originalEvent || e; oe.preventDefault?.(); oe.stopPropagation?.();
        setCtx({ x: oe.clientX, y: oe.clientY, type, id });
    }, []);
    const onCtxLote = useCallback((e: any, id: string) => openCtx(e, "lote", id), [openCtx]);

    const localizar = useCallback((type: "lote" | "camera", id: string) => {
        setLocated({ type, id });
        if (locateTimer.current) clearTimeout(locateTimer.current);
        locateTimer.current = setTimeout(() => setLocated(null), 6000);
    }, []);

    // Al tocar/detectar una matrícula: resalta el lote del residente y anima la ruta cámara→casa.
    // auto=true (evento LPR en vivo): NO reencuadra el mapa (evita el salto/lag continuo).
    const onPlate = useCallback((ev: any, auto = false) => {
        const plate = (ev?.plateDetected || "").toUpperCase();
        if (!plate) return;
        // Al elegir otra matrícula, borramos el recorrido anterior de inmediato.
        if (rutaTimer.current) clearTimeout(rutaTimer.current);
        setRuta(null);
        clearRef.current?.();
        const dir = (ev?.direction || "").toUpperCase(); // ENTRY (entrada) | EXIT (salida)
        const devId0 = ev?.device?.id || ev?.deviceId;
        const cam0 = devId0 ? camerasRef.current.find((c: any) => c.deviceId === devId0) : null;
        const gate0 = cam0 ? ([cam0.lat, cam0.lng] as LL) : null;
        const slotId = plateMapRef.current[plate];
        // Matrícula desconocida (no es de un residente): igual dibujamos su recorrido de
        // entrada/salida entre la cámara y el interior del barrio, siguiendo las calles.
        if (!slotId) {
            if (gate0) {
                const inner = centerRef.current;
                // Recorrido corto y prolijo desde/hacia la cámara (no sabemos el destino exacto).
                const full = dir === "EXIT"
                    ? routeOnStreets(streetsRef.current, inner, gate0)  // interior → cámara de salida
                    : routeOnStreets(streetsRef.current, gate0, inner); // cámara de entrada → interior
                const path = dir === "EXIT" ? tailPath(full, 260) : headPath(full, 260);
                setRuta({ path, key: Date.now(), dir });
                rutaTimer.current = setTimeout(() => setRuta(null), 9000);
                if (!auto && mapRef.current) { try { mapRef.current.fitBounds(L.latLngBounds(path as any), { padding: [90, 90], maxZoom: 19 }); } catch { } }
            } else {
                animateRef.current?.(ev);
            }
            return;
        }
        const lote = lotesRef.current.find((l: any) => l.parkingSlotId === slotId);
        if (!lote || !lote.points?.length) { animateRef.current?.(ev); return; }
        const house = centroid(lote.points);
        const devId = ev?.device?.id || ev?.deviceId;
        const cam = devId ? camerasRef.current.find((c: any) => c.deviceId === devId) : null;
        const gate = cam ? ([cam.lat, cam.lng] as LL) : null;
        localizar("lote", lote.id);
        if (gate) {
            // ENTRADA: de la cámara de entrada → la casa. SALIDA: de la casa → la cámara de salida.
            const from = dir === "EXIT" ? house : gate;
            const to = dir === "EXIT" ? gate : house;
            const path = routeOnStreets(streetsRef.current, from, to); // sigue las calles
            setRuta({ path, key: Date.now(), dir });
            rutaTimer.current = setTimeout(() => setRuta(null), 9000);
            if (!auto && mapRef.current) { try { mapRef.current.fitBounds(L.latLngBounds(path as any), { padding: [90, 90], maxZoom: 19 }); } catch { } }
        } else if (!auto && mapRef.current) {
            mapRef.current.setView(house, Math.max(mapRef.current.getZoom(), 18));
        }
    }, [localizar]);

    // Resaltado automático: al entrar una matrícula de residente por LPR (si el toggle está activo)
    useEffect(() => {
        if (!liveSocket) return;
        const onEv = (raw: any) => {
            if (!autoRef.current) return;
            if (raw?.accessType !== "PLATE") return;
            const d = (raw?.direction || "").toUpperCase();
            if (d !== "ENTRY" && d !== "EXIT") return; // dibuja tanto entradas como salidas
            const plate = (raw.plateDetected || "").toUpperCase();
            if (!plate || plate === "NO_LEIDA" || plate.startsWith("DOOR_")) return;
            // Throttle: como máximo un recorrido cada 2s (evita recalcular en ráfaga y lag).
            const now = Date.now();
            if (now - autoLastRef.current < 2000) return;
            autoLastRef.current = now;
            // Dibuja el recorrido de TODA matrícula (residente → casa, desconocida → cámara↔interior).
            // auto=true → no reencuadra el mapa.
            onPlate(raw, true);
        };
        liveSocket.on("access_event", onEv);
        return () => liveSocket.off("access_event", onEv);
    }, [liveSocket, onPlate]);

    if (!data) return <div className="h-full w-full flex items-center justify-center text-muted-foreground"><Loader2 className="animate-spin mr-2" size={18} /> Cargando mapa…</div>;

    const lotes = data.lotes || [];
    lotesRef.current = lotes;
    camerasRef.current = data.cameras;
    streetsRef.current = data.streets;
    centerRef.current = (data.perimeter && data.perimeter.length >= 3) ? centroid(data.perimeter) : (data.center as LL);

    const onMapClick = (ll: LL) => {
        // Mover cámara (menú contextual → editar posición) — funciona aún fuera de edición
        if (movingCam) {
            const next = { ...data, cameras: data.cameras.map((c) => c.deviceId === movingCam ? { ...c, lat: ll[0], lng: ll[1] } : c) };
            setMovingCam(null);
            persistNow(next, "Posición actualizada");
            return;
        }
        if (intrDraw) { setDraftIntr((p) => [...p, ll]); return; }
        if (extendDiv) {
            setData((d) => d ? ({ ...d, divisions: ((d as any).divisions || []).map((x: any) => x.id === extendDiv ? { ...x, points: [...x.points, ll] } : x) }) as any : d);
            return;
        }
        if (!editing) return;
        if (tool === "perimeter") setDraftPerimeter((p) => [...p, ll]);
        else if (tool === "lote") setDraftLote((p) => [...p, ll]);
        else if (tool === "division") setDraftDivision((p) => [...p, ll]);
        else if (tool === "street") setDraftStreet((p) => [...p, ll]);
        else if (tool === "camera") {
            if (!pendingCam) { toast.error({ title: "Elegí una cámara primero" }); return; }
            setData((d) => d ? { ...d, cameras: [...d.cameras.filter((c) => c.deviceId !== pendingCam), { deviceId: pendingCam, lat: ll[0], lng: ll[1] }] } : d);
            setPendingCam(""); setTool("select");
        }
    };
    const commitPerimeter = () => { if (draftPerimeter.length >= 3) setData((d) => d ? { ...d, perimeter: draftPerimeter } : d); setDraftPerimeter([]); setTool("select"); };
    const commitLote = () => {
        if (draftLote.length >= 3) setLoteModal({ mode: "create", name: "", parkingSlotId: "", points: draftLote });
        setDraftLote([]); setTool("select");
    };
    const commitDivision = () => {
        if (draftDivision.length >= 2) setData((d) => d ? { ...d, divisions: [...((d as any).divisions || []), { id: `d_${Date.now()}`, tipo: divTipo, points: draftDivision }] } as any : d);
        setDraftDivision([]); setTool("select");
    };
    const commitStreet = () => {
        if (draftStreet.length >= 2) setData((d) => d ? { ...d, streets: [...d.streets, { id: `st_${Date.now()}`, name: "", points: draftStreet }] } : d);
        setDraftStreet([]); setTool("select");
    };
    const commitIntr = () => {
        if (!intrDraw) return;
        const min = intrDraw.kind === "zone" ? 3 : 2;
        if (draftIntr.length >= min) {
            const next = { ...data, intrusions: [...((data as any).intrusions || []).filter((x: any) => !(x.deviceId === intrDraw.deviceId && x.kind === intrDraw.kind)), { id: `intr_${Date.now()}`, deviceId: intrDraw.deviceId, kind: intrDraw.kind, points: draftIntr }] } as any;
            persistNow(next, intrDraw.kind === "zone" ? "Zona de intrusión guardada" : "Cruce de línea guardado");
        }
        setDraftIntr([]); setIntrDraw(null);
    };
    const removeIntr = (id: string) => { const next = { ...data, intrusions: ((data as any).intrusions || []).filter((x: any) => x.id !== id) } as any; persistNow(next, "Eliminado"); };
    const suggestGeom = (deviceId: string, kind: "line" | "zone") => {
        const cam = data.cameras.find((c) => c.deviceId === deviceId);
        if (!cam) { toast.error({ title: "Colocá la cámara en el mapa primero" }); return; }
        const h = (cam as any).rumbo ?? 0;
        let points: LL[];
        if (kind === "line") { const f = destPoint(cam.lat, cam.lng, h, 28); points = [destPoint(f[0], f[1], h + 90, 16), destPoint(f[0], f[1], h - 90, 16)]; }
        else { const a = destPoint(cam.lat, cam.lng, h + 90, 13); const b = destPoint(cam.lat, cam.lng, h - 90, 13); const af = destPoint(a[0], a[1], h, 30); const bf = destPoint(b[0], b[1], h, 30); const a0 = destPoint(a[0], a[1], h, 8); const b0 = destPoint(b[0], b[1], h, 8); points = [a0, af, bf, b0]; }
        const next = { ...data, intrusions: [...((data as any).intrusions || []).filter((x: any) => !(x.deviceId === deviceId && x.kind === kind)), { id: `intr_${Date.now()}`, deviceId, kind, points }] } as any;
        persistNow(next, "Sugerencia creada — ajustá con Redibujar si hace falta");
    };
    const removeDivision = (id: string) => setData((d) => d ? { ...d, divisions: ((d as any).divisions || []).filter((x: any) => x.id !== id) } as any : d);
    // Edición de vértices de una división (tejido/pared/alambrado) ya guardada.
    const setDivPoint = (divId: string, idx: number, ll: LL) => setData((d) => d ? ({ ...d, divisions: ((d as any).divisions || []).map((x: any) => x.id === divId ? { ...x, points: x.points.map((p: LL, i: number) => i === idx ? ll : p) } : x) }) as any : d);
    const removeDivPoint = (divId: string, idx: number) => setData((d) => d ? ({ ...d, divisions: ((d as any).divisions || []).map((x: any) => x.id === divId ? { ...x, points: x.points.length > 2 ? x.points.filter((_: LL, i: number) => i !== idx) : x.points } : x) }) as any : d);
    const removeCamera = (id: string) => setData((d) => d ? { ...d, cameras: d.cameras.filter((c) => c.deviceId !== id) } : d);
    const removeCameraPersist = (id: string) => persistNow({ ...data, cameras: data.cameras.filter((c) => c.deviceId !== id) }, "Cámara quitada del mapa");
    const removeStreet = (id: string) => setData((d) => d ? { ...d, streets: d.streets.filter((s) => s.id !== id) } : d);
    const removeLote = async (id: string) => { const next = { ...data, lotes: (data.lotes || []).filter((l) => l.id !== id) }; await persistNow(next, "Lote eliminado"); };
    const renameStreet = (id: string) => { const n = window.prompt("Nombre de la calle:"); if (n != null) setData((d) => d ? { ...d, streets: d.streets.map((s) => s.id === id ? { ...s, name: n } : s) } : d); };
    const deleteSelected = () => { if (!selected) return; if (selected.type === "camera") removeCamera(selected.id); else if (selected.type === "street") removeStreet(selected.id); else removeLote(selected.id); setSelected(null); };

    const saveLoteModal = async () => {
        if (!loteModal) return;
        const nm = loteModal.name.trim();
        const psid = loteModal.parkingSlotId || undefined;
        let next: BarrioMapData;
        if (loteModal.mode === "create") {
            next = { ...data, lotes: [...(data.lotes || []), { id: `l_${Date.now()}`, name: nm, points: loteModal.points, parkingSlotId: psid }] };
        } else {
            next = { ...data, lotes: (data.lotes || []).map((l) => l.id === loteModal.id ? { ...l, name: nm, parkingSlotId: psid } : l) };
        }
        setLoteModal(null);
        await persistNow(next, loteModal.mode === "create" ? "Lote creado" : "Lote actualizado");
    };

    const save = async () => {
        setSaving(true);
        await persistNow(data, "Mapa guardado");
        setSaving(false); setEditing(false); setTool("select");
    };

    // Trae la red de calles REAL del barrio desde OpenStreetMap (Overpass) para la vista
    // actual del mapa y la guarda como grafo de ruteo. Reemplaza el dibujo manual de calles.
    const importOsmStreets = async () => {
        const m = mapRef.current; if (!m) return;
        const b = m.getBounds();
        const bbox = `${b.getSouth()},${b.getWest()},${b.getNorth()},${b.getEast()}`;
        const ql = `[out:json][timeout:25];(way["highway"~"^(residential|living_street|service|unclassified|tertiary|tertiary_link|secondary|secondary_link|primary|road|track)$"](${bbox}););out geom;`;
        setImportingOsm(true);
        toast.info({ title: "Importando calles…", description: "Consultando OpenStreetMap para esta vista." });
        try {
            const r = await fetch("https://overpass-api.de/api/interpreter", { method: "POST", headers: { "Content-Type": "text/plain;charset=UTF-8" }, body: ql });
            if (!r.ok) throw new Error(`Overpass HTTP ${r.status}`);
            const d = await r.json();
            const streets = (d.elements || [])
                .filter((e: any) => e.type === "way" && Array.isArray(e.geometry) && e.geometry.length >= 2)
                .map((e: any) => ({ id: `osm_${e.id}`, name: e.tags?.name || "", points: e.geometry.map((g: any) => [g.lat, g.lon] as LL) }));
            if (!streets.length) { toast.error({ title: "Sin calles", description: "OSM no devolvió calles en esta vista. Acercá o centrá el barrio y reintentá." }); return; }
            await persistNow({ ...data, streets }, `Calles importadas de OSM (${streets.length})`);
        } catch (e: any) {
            toast.error({ title: "No se pudieron importar", description: String(e?.message || e) });
        } finally { setImportingOsm(false); }
    };

    const acercar = (d: number) => { const m = mapRef.current; if (m) m.setZoom(m.getZoom() + d); };
    const centrar = () => { const m = mapRef.current; if (m) m.setView(data.center, data.zoom); };
    const alternarPantalla = () => {
        const el = wrapRef.current; if (!el) return;
        if (document.fullscreenElement) document.exitFullscreen().catch(() => { });
        else el.requestFullscreen?.().catch(() => { });
    };
    const toggleVivo = () => { setOcultas([]); setVivoTodas((v) => !v); };
    const buscar = () => {
        const s = q.trim().toUpperCase(); if (!s || !mapRef.current) return;
        const lo = lotes.find((l) => (l.name || "").toUpperCase().includes(s));
        if (lo && lo.points.length) { mapRef.current.setView(centroid(lo.points), Math.max(mapRef.current.getZoom(), 19)); localizar("lote", lo.id); return; }
        const cam = data.cameras.find((c) => (devById[c.deviceId]?.name || "").toUpperCase().includes(s));
        if (cam) { mapRef.current.setView([cam.lat, cam.lng], Math.max(mapRef.current.getZoom(), 18)); localizar("camera", cam.deviceId); return; }
        const st = data.streets.find((x) => (x.name || "").toUpperCase().includes(s));
        if (st && st.points.length) { mapRef.current.setView(st.points[Math.floor(st.points.length / 2)] as any, 18); return; }
        toast.error({ title: "Sin coincidencias", description: "No encontré ese lote, cámara o calle." });
    };

    const tools: { id: Tool; icon: any; label: string }[] = [
        { id: "select", icon: MousePointer2, label: "Seleccionar" },
        { id: "lote", icon: LandPlot, label: "Dibujar lote" },
        { id: "division", icon: Fence, label: "Dibujar división (pared/tejido/alambrado)" },
        { id: "perimeter", icon: Hexagon, label: "Dibujar perímetro" },
    ];
    const fondos: Base[] = ["Satélite", "Táctico", "Calles"];
    const capas: { key: keyof typeof show; label: string; Icon: any }[] = [
        { key: "cameras", label: "Cámaras", Icon: CamIco },
        { key: "intrusion", label: "Cruces / Zonas", Icon: ShieldAlert },
        { key: "fov", label: "Campo de visiÃ³n", Icon: Eye },
        { key: "lotes", label: "Lotes (polígonos)", Icon: LoteIco },
        { key: "loteNames", label: "Nombres de lotes", Icon: TypeIco },
        { key: "divisions", label: "Divisiones", Icon: Fence },
        { key: "perimeter", label: "Perímetro", Icon: PerimIco },
        { key: "guards", label: "Guardias", Icon: GuardIco },
        { key: "names", label: "Nombres", Icon: TypeIco },
    ];
    const gbtn = "h-9 w-9 flex items-center justify-center rounded-xl text-muted-foreground hover:text-foreground hover:bg-white/10 transition-colors disabled:opacity-30";
    const locatedLoteId = located?.type === "lote" ? located.id : null;

    return (
        <TooltipProvider delayDuration={150}>
            <style>{`
                .cam-live-popup .leaflet-popup-content-wrapper{background:transparent;box-shadow:none;padding:0;border:0}
                .cam-live-popup .leaflet-popup-content{margin:0}
                .cam-live-popup .leaflet-popup-tip{display:none}
                .cam-live-popup a.leaflet-popup-close-button{color:#fff;top:4px;right:6px}
                .cam-name-tip{background:rgba(17,17,17,.85);color:#fff;border:0;box-shadow:none;font-size:10px;font-weight:700;padding:1px 6px;border-radius:6px}
                .cam-name-tip:before{display:none}
                .lote-tip{background:rgba(168,85,247,.92);color:#fff;border:0;box-shadow:none;font-size:10px;font-weight:800;padding:1px 6px;border-radius:6px}
                .lote-tip:before{display:none}
                /* Etiqueta de lote como tooltip permanente (estable en zoom, sin jitter). */
                .lote-lbl{background:rgba(168,85,247,.92);color:#fff;border:0;box-shadow:0 1px 3px rgba(0,0,0,.45);font-size:10px;font-weight:800;line-height:1;padding:2px 6px;border-radius:6px;white-space:nowrap}
                .lote-lbl:before{display:none !important}
                .lote-lbl span{cursor:pointer;display:inline-block}
                .lote-lbl.ok{background:rgba(34,197,94,.92)}
                .lote-lbl.na{background:rgba(168,85,247,.92)}
                .lote-lbl.sel{outline:2px solid #f59e0b;outline-offset:1px}
                @keyframes loteLblBlink{0%,100%{box-shadow:0 0 0 0 rgba(245,158,11,.6)}50%{box-shadow:0 0 0 8px rgba(245,158,11,0)}}
                .lote-lbl.loc{background:#f59e0b;animation:loteLblBlink 0.9s ease-in-out infinite}
                @keyframes loteBlink{0%,100%{stroke-opacity:1;fill-opacity:.15;stroke-width:2}50%{stroke-opacity:.25;fill-opacity:.5;stroke-width:5}}
                .lote-blink{stroke:#f59e0b !important;fill:#f59e0b !important;animation:loteBlink 0.9s ease-in-out infinite}
                @keyframes rutaDash{to{stroke-dashoffset:-34}}
                .ruta-anim{animation:rutaDash 0.9s linear 1.15s infinite}
                /* La línea se dibuja de inicio a fin (reveal por stroke-dashoffset). */
                @keyframes rutaDraw{from{stroke-dashoffset:6000}to{stroke-dashoffset:0}}
                .ruta-draw{stroke-dasharray:6000 !important;stroke-dashoffset:6000;animation:rutaDraw 1.15s cubic-bezier(.4,0,.2,1) forwards}
                .cam-locate .cam-glyph{animation:loteBlink 0.9s ease-in-out infinite}
                .map-tactico .leaflet-tile-pane{filter:grayscale(.65) contrast(1.05) brightness(.72)}
                /* Cursor flecha (no manito) mientras se dibuja en el mapa */
                .map-draw .leaflet-grab,.map-draw.leaflet-dragging .leaflet-grab{cursor:default !important}
                .map-draw .leaflet-container{cursor:default !important}
                .omni-reticula{position:absolute;inset:0;pointer-events:none;z-index:400;background-image:linear-gradient(rgba(255,255,255,.04) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.04) 1px,transparent 1px);background-size:44px 44px}
                .omni-vineta{position:absolute;inset:0;pointer-events:none;z-index:400;box-shadow:inset 0 0 200px 40px rgba(0,0,0,.55)}
                .intr-pulse{position:absolute;left:-7px;top:-7px;width:14px;height:14px;border-radius:50%;background:#ef4444;box-shadow:0 0 0 0 rgba(239,68,68,.75);animation:intrPulse 1.1s ease-out infinite}
                @keyframes intrPulse{0%{box-shadow:0 0 0 0 rgba(239,68,68,.75)}70%{box-shadow:0 0 0 30px rgba(239,68,68,0)}100%{box-shadow:0 0 0 0 rgba(239,68,68,0)}}
                @keyframes intrBanner{0%,100%{opacity:1}50%{opacity:.62}}
                @keyframes intrGeomBlink{0%,100%{opacity:1}50%{opacity:.3}}
                .intr-geom-blink{animation:intrGeomBlink 0.8s ease-in-out infinite}
            `}</style>
            <div ref={wrapRef} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { const id = e.dataTransfer.getData("text/camId"); if (!id || !mapRef.current) return; e.preventDefault(); try { const ll = (mapRef.current as any).mouseEventToLatLng(e.nativeEvent); setEditing(true); placeCamera(id, [ll.lat, ll.lng]); } catch { } }} className={cn("relative h-full w-full bg-black", base === "Táctico" && "map-tactico", ((editing && tool !== "select") || movingCam || extendDiv || intrDraw) && "map-draw")}>
                <MapContainer center={data.center} zoom={data.zoom} className="h-full w-full z-0" zoomControl={false} scrollWheelZoom>
                    <MapRefGrabber onMap={(m) => (mapRef.current = m)} />
                    <ZoomTracker onZoom={setZoom} />
                    <BoundsTracker onBounds={setMapBounds} />
                    {(movingCam || extendDiv || intrDraw || (editing && tool !== "select")) && <ClickHandler onClick={onMapClick} />}
                    <MapCtxMenu onCtx={(oe) => setCtx({ x: oe.clientX, y: oe.clientY, type: "map", id: "" })} />

                    {base === "Satélite" && (
                        <TileLayer key="esri" attribution="&copy; Esri" url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}" maxNativeZoom={19} maxZoom={21} />
                    )}
                    {(base === "Calles" || base === "Táctico") && (
                        <TileLayer key="osm" attribution="&copy; OpenStreetMap" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" maxNativeZoom={19} maxZoom={21} />
                    )}

                    {show.perimeter && data.perimeter.length >= 3 && <Polygon positions={data.perimeter} pathOptions={{ color: "#22c55e", weight: 2, fillOpacity: 0.08 }} />}
                    {draftPerimeter.length > 0 && <Polyline positions={draftPerimeter} pathOptions={{ color: "#22c55e", weight: 2, dashArray: "6 6" }} />}

                    {(show.lotes || show.loteNames) && (
                        <LotesLayer lotes={lotes} selectedId={selected?.type === "lote" ? selected.id : null} showNames={show.loteNames} showPolys={show.lotes} zoom={zoom} bounds={mapBounds}
                            locatedId={locatedLoteId} onSelect={onSelectLote} onEdit={editLote} onCtx={onCtxLote} />
                    )}
                    {draftLote.length > 0 && <Polygon positions={draftLote} pathOptions={{ color: "#a855f7", weight: 2, dashArray: "6 6", fillOpacity: 0.1 }} />}

                    {/* Calles: son la red de ruteo (OSM). NO se dibujan en la vista normal;
                        solo se muestran tenues al editar, como referencia del grafo por donde
                        se calculan las rutas de las matrículas. */}
                    {editing && data.streets.map((s) => (
                        <Polyline key={s.id} positions={s.points}
                            pathOptions={{ color: selected?.id === s.id ? "#f59e0b" : "#38bdf8", weight: selected?.id === s.id ? 5 : 2, opacity: selected?.id === s.id ? 0.9 : 0.45, dashArray: selected?.id === s.id ? undefined : "3 7" }}
                            eventHandlers={{
                                click: () => tool === "select" && setSelected({ type: "street", id: s.id }),
                                contextmenu: (e) => openCtx(e, "street", s.id),
                            }}>
                            {s.name && show.names && <LTooltip sticky className="cam-name-tip">{s.name}</LTooltip>}
                        </Polyline>
                    ))}

                    {/* Divisiones (pared / tejido / alambrado) */}
                    {show.divisions && ((data as any).divisions || []).map((dv: any) => {
                        const st = DIV_STYLE[(dv.tipo as DivTipo)] || DIV_STYLE.pared;
                        const color = dv.color || st.color; const weight = dv.weight || st.weight;
                        return (
                            <Polyline key={`${dv.id}_${color}_${weight}_${dv.points.length}`} positions={dv.points}
                                pathOptions={{ color, weight, dashArray: st.dashArray, opacity: 0.95, lineCap: "round" }}
                                eventHandlers={{ contextmenu: (e) => openCtx(e, "division", dv.id) }}>
                                {show.names && <LTooltip sticky className="cam-name-tip">{st.label}</LTooltip>}
                            </Polyline>
                        );
                    })}
                    {/* Manijas para editar los vértices de una división guardada. */}
                    {editDivPts && (((data as any).divisions || []).find((x: any) => x.id === editDivPts)?.points || []).map((p: LL, i: number) => (
                        <Marker key={`dvp_${editDivPts}_${i}`} position={p} draggable icon={vertexIcon}
                            eventHandlers={{
                                drag: (e: any) => { const ll = e.target.getLatLng(); setDivPoint(editDivPts, i, [ll.lat, ll.lng]); },
                                contextmenu: (e: any) => { e.originalEvent?.preventDefault?.(); e.originalEvent?.stopPropagation?.(); removeDivPoint(editDivPts, i); },
                            }} />
                    ))}
                    {draftDivision.length > 0 && <Polyline positions={draftDivision} pathOptions={{ color: DIV_STYLE[divTipo].color, weight: DIV_STYLE[divTipo].weight, dashArray: DIV_STYLE[divTipo].dashArray || "4 4", opacity: 0.8 }} />}
                    {draftStreet.length > 0 && <Polyline positions={draftStreet} pathOptions={{ color: "#38bdf8", weight: 4, dashArray: "6 6", opacity: 0.85, lineCap: "round" }} />}
                    {show.fov && data.cameras.map((c) => { const h = (c as any).rumbo; if (h == null) return null; const r = 42, a = 26; const pL = destPoint(c.lat, c.lng, h - a, r); const pM = destPoint(c.lat, c.lng, h, r); const pR = destPoint(c.lat, c.lng, h + a, r); return <Polygon key={`fov_${c.deviceId}`} positions={[[c.lat, c.lng], pL, pM, pR]} pathOptions={{ color: "#38bdf8", weight: 1, opacity: 0.35, fillColor: "#38bdf8", fillOpacity: 0.07 }} interactive={false} />; })}
                    {show.intrusion && ((data as any).intrusions || []).map((g: any) => {
                        const active = !!intrAlerts[g.deviceId];
                        const col = active ? "#ef4444" : "#3b82f6";
                        const cls = active ? "intr-geom-blink" : undefined;
                        return g.kind === "zone"
                            ? <Polygon key={g.id} positions={g.points} pathOptions={{ color: col, weight: active ? 4 : 2.5, opacity: 0.95, fillColor: col, fillOpacity: active ? 0.28 : 0.1, className: cls }} eventHandlers={{ contextmenu: (e) => openCtx(e, "intr", g.id) }} />
                            : <Polyline key={g.id} positions={g.points} pathOptions={{ color: col, weight: active ? 6 : 3.5, opacity: 0.98, lineCap: "round", className: cls }} eventHandlers={{ contextmenu: (e) => openCtx(e, "intr", g.id) }} />;
                    })}
                    {draftIntr.length > 0 && (intrDraw?.kind === "zone"
                        ? <Polygon positions={draftIntr} pathOptions={{ color: "#3b82f6", weight: 2, dashArray: "6 6", fillOpacity: 0.08 }} />
                        : <Polyline positions={draftIntr} pathOptions={{ color: "#3b82f6", weight: 3, dashArray: "6 6", lineCap: "round" }} />)}

                    {show.guards && guards.map((g) => (
                        <Marker key={"g" + g.id} position={[g.lat, g.lng]}
                            icon={L.divIcon({ className: "bg-transparent border-0", html: guardIconHtml(g.guardName || g.name || "Guardia", g.heading), iconSize: [60, 52], iconAnchor: [30, 44] })}
                            eventHandlers={{ contextmenu: (e) => openCtx(e, "guard", String(g.id)) }}>
                            <Popup>
                                <div style={{ minWidth: 140 }}>
                                    <b>{g.guardName || "Guardia"}</b><br />
                                    <span style={{ fontSize: 11, opacity: .7 }}>{g.deviceInfo || "Tablet"} · hace {Math.max(0, Math.round((Date.now() - (g.ts || Date.now())) / 1000))}s</span>
                                    {g.accuracy ? <><br /><span style={{ fontSize: 10, opacity: .5 }}>±{Math.round(g.accuracy)}m</span></> : null}
                                    {(g.battery != null || g.signal != null || g.heading != null || g.steps != null) && (
                                        <div style={{ marginTop: 6, display: "flex", flexWrap: "wrap", gap: 6, fontSize: 10, fontWeight: 700 }}>
                                            {g.battery != null && <span style={{ padding: "2px 6px", borderRadius: 6, background: g.battery <= 20 ? "#fee2e2" : "#dcfce7", color: g.battery <= 20 ? "#dc2626" : "#16a34a" }}>🔋 {g.battery}%{g.charging ? "⚡" : ""}</span>}
                                            {g.signal != null && g.signal >= 0 && <span style={{ padding: "2px 6px", borderRadius: 6, background: "#e0e7ff", color: "#4338ca" }}>📶 {g.signal}/4</span>}
                                            {g.heading != null && <span style={{ padding: "2px 6px", borderRadius: 6, background: "#f1f5f9", color: "#475569" }}>🧭 {Math.round(g.heading)}°</span>}
                                            {g.steps != null && g.steps > 0 && <span style={{ padding: "2px 6px", borderRadius: 6, background: "#f1f5f9", color: "#475569" }}>👣 {g.steps}</span>}
                                        </div>
                                    )}
                                </div>
                            </Popup>
                        </Marker>
                    ))}

                    {show.cameras && data.cameras.filter((c) => !mapBounds || mapBounds.contains([c.lat, c.lng] as any)).map((c) => (
                        <Marker key={`${c.deviceId}_${(c as any).rumbo ?? "n"}_${(c as any).size ?? 30}_${(c as any).color ?? "d"}`} position={[c.lat, c.lng]}
                            icon={camIconDe({ rumbo: (c as any).rumbo, size: (c as any).size, color: (c as any).color }, located?.type === "camera" && located.id === c.deviceId ? "cam-locate" : "")}
                            eventHandlers={{
                                click: () => { if (editing && tool === "select") setSelected({ type: "camera", id: c.deviceId }); },
                                contextmenu: (e) => openCtx(e, "camera", c.deviceId),
                                popupopen: () => setOpenCamPopup(c.deviceId),
                                popupclose: () => setOpenCamPopup((v) => v === c.deviceId ? null : v),
                            }}>
                            {show.names && zoom >= 16 && <LTooltip permanent direction="top" offset={[0, -22]} className="cam-name-tip">{devById[c.deviceId]?.name || "Cámara"}</LTooltip>}
                            {!editing && !movingCam && (
                                <Popup className="cam-live-popup" maxWidth={280} minWidth={260}>
                                    <div className="rounded-lg overflow-hidden">
                                        {/* El video se monta solo cuando este popup está abierto (evita 12 streams a la vez). */}
                                        {openCamPopup === c.deviceId
                                            ? <LiveMp4 deviceId={c.deviceId} className="block w-[260px] h-[150px] object-cover bg-black" />
                                            : <div className="w-[260px] h-[150px] bg-black" />}
                                        <div className="px-2 py-1 bg-black/80 text-white text-[11px] font-bold flex items-center gap-1.5"><Radio size={11} className="text-red-400" /> {devById[c.deviceId]?.name || "Cámara"}</div>
                                    </div>
                                </Popup>
                            )}
                        </Marker>
                    ))}
                    {/* Alerta de intrusión: halo rojo pulsante sobre la cámara que se activó */}
                    {Object.keys(intrAlerts).map((devId) => { const cam = data.cameras.find((c) => c.deviceId === devId); if (!cam) return null; return <Marker key={`intr_${devId}`} position={[cam.lat, cam.lng]} icon={intrPulseIcon} interactive={false} zIndexOffset={2000} />; })}
                    {/* Ruta animada cámara → casa (estilo Uber: azul sólido con casing blanco) */}
                    {ruta && ruta.path.length >= 2 && (
                        <>
                            {/* Casing blanco + núcleo (azul=entrada, naranja=salida). Ambos se dibujan
                                de inicio a fin; encima, guiones blancos que fluyen tras el trazado. */}
                            <Polyline key={`rw${ruta.key}`} positions={ruta.path} interactive={false} pathOptions={{ color: "#ffffff", weight: 8, opacity: 0.9, lineCap: "round", lineJoin: "round", className: "ruta-draw" }} />
                            <Polyline key={`rb${ruta.key}`} positions={ruta.path} interactive={false} pathOptions={{ color: ruta.dir === "EXIT" ? "#f97316" : "#2563eb", weight: 5, opacity: 1, lineCap: "round", lineJoin: "round", className: "ruta-draw" }} />
                            <Polyline key={`ra${ruta.key}`} positions={ruta.path} interactive={false} pathOptions={{ color: "#ffffff", weight: 2.5, opacity: 0.95, dashArray: "1 16", lineCap: "round", lineJoin: "round", className: "ruta-anim" }} />
                        </>
                    )}

                    {vivoTodas && !editing && (
                        <BurbujasVivo
                            camaras={data.cameras.filter((c) => !ocultas.includes(c.deviceId))}
                            nombre={(id) => devById[id]?.name || "Cámara"}
                            onCerrarUna={(id) => setOcultas((o) => [...o, id])}
                        />
                    )}
                </MapContainer>

                <button onClick={() => setSoundOn((v) => !v)} title={soundOn ? "Silenciar alertas" : "Activar sonido de alertas"} className={cn("absolute top-4 left-4 z-[601] h-9 w-9 grid place-items-center rounded-xl backdrop-blur-sm shadow-lg transition-colors", soundOn ? "bg-card/80 text-foreground hover:bg-card" : "bg-red-600/90 text-white")}>{soundOn ? <Volume2 size={16} /> : <VolumeX size={16} />}</button>
                <button onClick={() => setFeedOpen((v) => !v)} title="Feed de intrusiones" className={cn("absolute top-4 left-[3.5rem] z-[601] h-9 w-9 grid place-items-center rounded-xl backdrop-blur-sm shadow-lg transition-colors", feedOpen ? "bg-red-600/90 text-white" : "bg-card/80 text-foreground hover:bg-card")}><Activity size={16} /></button>
                {feedOpen && (
                    <div className="absolute top-4 right-4 bottom-4 z-[600] w-[270px] bg-card/95 backdrop-blur-xl border border-border rounded-2xl shadow-2xl flex flex-col overflow-hidden">
                        <div className="flex items-center justify-between px-3 py-2.5 border-b border-border shrink-0">
                            <div className="text-[13px] font-bold flex items-center gap-2"><Activity size={14} className="text-red-500" /> Intrusiones recientes</div>
                            <button onClick={() => setFeedOpen(false)} className={gbtn}><X size={14} /></button>
                        </div>
                        <div className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-1.5">
                            {recentIntr.length === 0 && <div className="text-xs text-muted-foreground p-3 text-center">Sin eventos recientes.</div>}
                            {recentIntr.map((it) => (
                                <button key={it.id || it.ms} onClick={() => { setAlertCard({ deviceId: it.deviceId, ms: it.ms, id: it.id, type: it.type, label: it.label, name: it.name }); const cam = camerasRef.current.find((c: any) => c.deviceId === it.deviceId); if (cam && mapRef.current) { try { mapRef.current.setView([cam.lat, cam.lng], Math.max(mapRef.current.getZoom(), 18), { animate: true }); } catch { } } }}
                                    className="w-full flex items-center gap-2 rounded-xl border border-border bg-background/60 p-1.5 hover:bg-accent/40 transition-colors text-left">
                                    <div className="relative w-[64px] h-[40px] rounded-md overflow-hidden bg-black shrink-0 ring-1 ring-border">
                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                        <img src={`/api/snapshot/${it.deviceId}?t=${it.id || it.ms}`} alt="" className="absolute inset-0 w-full h-full object-cover" loading="lazy" />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="text-[11.5px] font-bold truncate flex items-center gap-1">{it.type === "INTRUSION" ? <ShieldAlert size={11} className="text-red-500 shrink-0" /> : <Route size={11} className="text-sky-500 shrink-0" />}{it.type === "INTRUSION" ? "Intrusión" : it.type === "LINECROSS" ? "Cruce" : "Detección"}{it.label ? <span className="text-muted-foreground">· {it.label === "vehicle" ? "Auto" : "Persona"}</span> : null}</div>
                                        <div className="text-[10px] text-muted-foreground truncate">{it.name || "Cámara"}</div>
                                        <div className="text-[9.5px] text-muted-foreground tabular-nums">{new Date(it.ms).toLocaleTimeString("es-UY", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</div>
                                    </div>
                                </button>
                            ))}
                        </div>
                    </div>
                )}
                {Object.keys(intrAlerts).length > 0 && (
                    <div className="absolute top-16 left-4 z-[600] flex flex-col gap-1.5 items-start">
                        {Object.entries(intrAlerts).sort((a, b) => b[1].ts - a[1].ts).slice(0, 6).map(([devId, a]) => (
                            <button key={devId} onClick={() => setAlertCard({ deviceId: devId, ms: a.ms || a.ts, id: a.id, type: a.type, label: a.label, name: a.name })}
                                className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-red-600/95 text-white shadow-2xl ring-1 ring-red-300/50 backdrop-blur-sm hover:bg-red-600 transition-colors text-left" style={{ animation: "intrBanner 1s ease-in-out infinite" }}>
                                <ShieldAlert size={16} className="shrink-0" />
                                <span className="text-[13px] font-extrabold uppercase tracking-wide">{a.type === "LINECROSS" ? "Cruce de línea" : a.type === "INTRUSION" ? "Intrusión" : a.type === "REGION_ENTER" ? "Entra a zona" : "Detección"}</span>
                                {a.label && <span className="text-[12px] font-bold">· {a.label === "vehicle" ? "Auto" : "Persona"}</span>}
                                <span className="text-[12px] font-semibold opacity-90 truncate max-w-[140px]">· {a.name || "Cámara"}</span>
                            </button>
                        ))}
                    </div>
                )}
                {alertCard && (() => {
                    const cam = intrCamList.find((c) => c.id === alertCard.deviceId);
                    const clip = cam && cam.ch != null && cam.nvrId ? `/api/nvr/playback?ch=${cam.ch}&t=${Math.floor(alertCard.ms)}&pre=4&dur=12&nvr=${cam.nvrId}` : null;
                    return (
                        <div className="absolute top-16 left-4 z-[690] w-[320px] bg-card/97 backdrop-blur-xl border border-border rounded-2xl shadow-2xl overflow-hidden">
                            <div className="flex items-center justify-between px-3 py-2 bg-red-600 text-white">
                                <div className="flex items-center gap-1.5 text-[12px] font-extrabold uppercase tracking-wide"><ShieldAlert size={14} /> {alertCard.type === "LINECROSS" ? "Cruce de línea" : alertCard.type === "INTRUSION" ? "Intrusión" : "Detección"}{alertCard.label ? ` · ${alertCard.label === "vehicle" ? "Auto" : "Persona"}` : ""}</div>
                                <button onClick={() => setAlertCard(null)} className="p-1 rounded hover:bg-white/20"><X size={14} /></button>
                            </div>
                            <div className="relative w-full h-[180px] bg-black">
                                {clip ? (
                                    // eslint-disable-next-line jsx-a11y/media-has-caption
                                    <video src={clip} autoPlay loop muted playsInline controls poster={`/api/snapshot/${alertCard.deviceId}?t=${alertCard.id || alertCard.ms}`} className="absolute inset-0 w-full h-full object-cover" />
                                ) : (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img src={`/api/snapshot/${alertCard.deviceId}?t=${alertCard.id || alertCard.ms}`} alt="" className="absolute inset-0 w-full h-full object-cover" />
                                )}
                            </div>
                            <div className="px-3 py-2">
                                <div className="text-[13px] font-bold truncate">{alertCard.name || "Cámara"}</div>
                                <div className="text-[11px] text-muted-foreground tabular-nums">{new Date(alertCard.ms).toLocaleString("es-UY", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })}</div>
                                <div className="mt-2 flex gap-2">
                                    <button onClick={() => ackAlert(alertCard.deviceId, "real")} className="flex-1 py-1.5 rounded-lg bg-red-600 text-white text-xs font-bold hover:bg-red-500">Real</button>
                                    <button onClick={() => ackAlert(alertCard.deviceId, "false")} className="flex-1 py-1.5 rounded-lg bg-accent text-xs font-bold hover:bg-accent/70">Falsa alarma</button>
                                </div>
                            </div>
                        </div>
                    );
                })()}

                {oscura && <><div className="omni-reticula" /><div className="omni-vineta" /></>}

                {/* Aviso de mover cámara */}
                {movingCam && (
                    <div className="absolute top-20 left-1/2 -translate-x-1/2 z-[540] flex items-center gap-2 bg-blue-600 text-white rounded-xl shadow-2xl px-3 py-2 text-xs font-bold">
                        <Move size={14} /> Hacé clic en la nueva posición de la cámara
                        <button onClick={() => setMovingCam(null)} className="ml-1 hover:bg-white/20 rounded p-0.5"><X size={13} /></button>
                    </div>
                )}
                {/* Aviso de extender línea */}
                {extendDiv && (
                    <div className="absolute top-20 left-1/2 -translate-x-1/2 z-[540] flex items-center gap-2 bg-blue-600 text-white rounded-xl shadow-2xl px-3 py-2 text-xs font-bold">
                        <Plus size={14} /> Clic para agregar puntos a la línea
                        <button onClick={() => { const d = data; setExtendDiv(null); persistNow(d, "Línea actualizada"); }} className="ml-1 px-2 py-0.5 rounded bg-white/20 hover:bg-white/30">Listo</button>
                    </div>
                )}
                {/* Edición de vértices de una división */}
                {editDivPts && (
                    <div className="absolute top-20 left-1/2 -translate-x-1/2 z-[540] flex items-center gap-2 bg-amber-500 text-white rounded-xl shadow-2xl px-3 py-2 text-xs font-bold">
                        <Move size={14} /> Arrastrá los puntos · clic derecho en un punto para quitarlo
                        <button onClick={() => { const d = data; setEditDivPts(null); persistNow(d, "Línea actualizada"); }} className="ml-1 px-2 py-0.5 rounded bg-white/20 hover:bg-white/30">Listo</button>
                        <button onClick={() => { setEditDivPts(null); getBarrioMap().then(setData); }} className="px-2 py-0.5 rounded bg-black/20 hover:bg-black/30">Cancelar</button>
                    </div>
                )}

                {/* Columnas de flujo en vivo */}
                {!editing && (
                    <>
                        <FlowColumn side="left" title="Entradas" icon={LogIn} accent="emerald" events={flow.entries} onPick={(ev) => onPlate(ev)} />
                        <FlowColumn side="right" title="Salidas" icon={LogOut} accent="orange" events={flow.exits} onPick={(ev) => onPlate(ev)} />
                    </>
                )}

                {/* ── Barra superior glass ── */}
                <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[530] flex flex-col items-center">
                    <div className="flex items-center gap-1 bg-card/90 backdrop-blur-2xl border border-border rounded-2xl shadow-2xl p-1.5">
                        <button onClick={(e) => { e.stopPropagation(); setMenuCapas((v) => !v); }}
                            className={cn("h-9 px-3 flex items-center gap-1.5 rounded-xl text-xs font-bold transition-colors", menuCapas ? "bg-white/10 text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-white/10")}>
                            <Layers3 size={15} /> {base} <ChevronDown size={12} className={cn("transition-transform", menuCapas && "rotate-180")} />
                        </button>
                        <div className="w-px h-6 bg-border mx-0.5" />

                        {editing ? (
                            <>
                                {tools.map((t) => (
                                    <Tooltip key={t.id}><TooltipTrigger asChild>
                                        <button onClick={() => { setTool(t.id); setSelected(null); }} className={cn(gbtn, tool === t.id && "bg-blue-600 text-white hover:bg-blue-500 hover:text-white")}><t.icon size={16} /></button>
                                    </TooltipTrigger><TooltipContent>{t.label}</TooltipContent></Tooltip>
                                ))}
                                <div className="relative">
                                    <Tooltip><TooltipTrigger asChild>
                                        <button onClick={(e) => { e.stopPropagation(); setIntrMenu((v) => !v); }} className={cn(gbtn, intrMenu && "bg-white/10 text-foreground")}><Video size={16} /></button>
                                    </TooltipTrigger><TooltipContent>Cámaras: cruces y zonas</TooltipContent></Tooltip>
                                    {intrMenu && (
                                        <div className="absolute top-full mt-2 left-0 z-[560] bg-popover border border-border rounded-xl shadow-2xl py-1 min-w-[180px]" onClick={(e) => e.stopPropagation()}>
                                            <button onClick={() => { setPlaceDrawer(true); setIntrMenu(false); }} className="w-full text-left px-3 py-1.5 hover:bg-accent flex items-center gap-2 text-xs font-bold"><Video size={13} className="text-blue-400" /> Colocar cámara</button>
                                            <div className="h-px bg-border my-1" />
                                            <button onClick={() => { setIntrDrawer("line"); setIntrMenu(false); }} className="w-full text-left px-3 py-1.5 hover:bg-accent flex items-center gap-2 text-xs font-bold"><Route size={13} className="text-sky-400" /> Cruces de línea</button>
                                            <button onClick={() => { setIntrDrawer("zone"); setIntrMenu(false); }} className="w-full text-left px-3 py-1.5 hover:bg-accent flex items-center gap-2 text-xs font-bold"><ShieldAlert size={13} className="text-sky-400" /> Zonas de intrusión</button>
                                        </div>
                                    )}
                                </div>
                                <div className="w-px h-6 bg-border mx-0.5" />
                                <Tooltip><TooltipTrigger asChild><button onClick={importOsmStreets} disabled={importingOsm} className={cn(gbtn, "text-sky-400 hover:text-sky-300 hover:bg-sky-500/10")}>{importingOsm ? <Loader2 size={16} className="animate-spin" /> : <Route size={16} />}</button></TooltipTrigger><TooltipContent>Importar calles reales del barrio (OpenStreetMap) para el ruteo</TooltipContent></Tooltip>
                                <div className="w-px h-6 bg-border mx-0.5" />
                                <Tooltip><TooltipTrigger asChild><button onClick={deleteSelected} disabled={!selected} className={cn(gbtn, selected && "text-red-400 hover:text-red-300 hover:bg-red-500/10")}><Trash2 size={16} /></button></TooltipTrigger><TooltipContent>Borrar seleccionado</TooltipContent></Tooltip>
                                <button onClick={save} disabled={saving} className="h-9 px-3.5 ml-0.5 flex items-center gap-1.5 rounded-xl text-xs font-bold bg-blue-600 text-white hover:bg-blue-500 transition-colors">{saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Guardar</button>
                                <button onClick={() => { setEditing(false); setTool("select"); setDraftPerimeter([]); setDraftLote([]); setDraftDivision([]); setDraftStreet([]); setSelected(null); getBarrioMap().then(setData); }} className={gbtn}><X size={16} /></button>
                            </>
                        ) : (
                            <>
                                <Tooltip><TooltipTrigger asChild><button onClick={() => acercar(1)} className={gbtn}><Plus size={16} /></button></TooltipTrigger><TooltipContent>Acercar</TooltipContent></Tooltip>
                                <Tooltip><TooltipTrigger asChild><button onClick={() => acercar(-1)} className={gbtn}><Minus size={16} /></button></TooltipTrigger><TooltipContent>Alejar</TooltipContent></Tooltip>
                                <Tooltip><TooltipTrigger asChild><button onClick={centrar} className={gbtn}><Crosshair size={16} /></button></TooltipTrigger><TooltipContent>Centrar en el barrio</TooltipContent></Tooltip>
                                <Tooltip><TooltipTrigger asChild><button onClick={toggleVivo} disabled={!data.cameras.length} className={cn(gbtn, vivoTodas && "bg-red-600 text-white hover:bg-red-500 hover:text-white")}>{vivoTodas ? <EyeOff size={16} /> : <Eye size={16} />}</button></TooltipTrigger><TooltipContent>{vivoTodas ? "Apagar las cámaras en vivo" : "Ver todas las cámaras en vivo"}</TooltipContent></Tooltip>
                                <Tooltip><TooltipTrigger asChild><button onClick={() => setAutoResaltar((v) => !v)} className={cn(gbtn, autoResaltar && "bg-emerald-600 text-white hover:bg-emerald-500 hover:text-white")}><Home size={16} /></button></TooltipTrigger><TooltipContent>{autoResaltar ? "Auto: resalta la casa al detectar matrícula (ON)" : "Resaltar la casa automáticamente al detectar matrícula"}</TooltipContent></Tooltip>
                                <Tooltip><TooltipTrigger asChild><button onClick={alternarPantalla} className={gbtn}>{pantalla ? <Minimize2 size={16} /> : <Maximize2 size={16} />}</button></TooltipTrigger><TooltipContent>{pantalla ? "Salir de pantalla completa" : "Pantalla completa"}</TooltipContent></Tooltip>
                                <div className="w-px h-6 bg-border mx-0.5" />
                                <button onClick={() => { setMenuCapas(false); setVivoTodas(false); setEditing(true); }} className="h-9 px-3.5 flex items-center gap-1.5 rounded-xl text-xs font-bold bg-blue-600 text-white hover:bg-blue-500 transition-colors"><Pencil size={14} /> Editar mapa</button>
                            </>
                        )}
                    </div>

                    {menuCapas && (
                        <div onClick={(e) => e.stopPropagation()} className="mt-2 w-[220px] p-2 rounded-2xl bg-card/95 backdrop-blur-2xl border border-border shadow-2xl">
                            <p className="px-2 pt-1 pb-1.5 text-[10px] font-black uppercase tracking-widest text-muted-foreground/70">Mapa de fondo</p>
                            <div className="grid grid-cols-2 gap-1">
                                {fondos.map((f) => (
                                    <button key={f} onClick={() => setBase(f)}
                                        className={cn("h-9 rounded-xl text-[11px] font-bold transition-colors", base === f ? "bg-blue-600 text-white" : "bg-background/40 text-muted-foreground hover:text-foreground hover:bg-white/10")}>{f}</button>
                                ))}
                            </div>
                            <div className="h-px bg-border my-2" />
                            <p className="px-2 pb-1.5 text-[10px] font-black uppercase tracking-widest text-muted-foreground/70">Mostrar</p>
                            <div className="space-y-0.5">
                                {capas.map(({ key, label, Icon }) => (
                                    <button key={key} onClick={() => setShow((s) => ({ ...s, [key]: !s[key] }))}
                                        className="w-full flex items-center gap-2.5 px-2 h-9 rounded-xl hover:bg-white/10 transition-colors text-left">
                                        <Icon size={14} className={show[key] ? "text-blue-400" : "text-muted-foreground/50"} />
                                        <span className={cn("text-xs font-semibold flex-1", show[key] ? "text-foreground" : "text-muted-foreground/60")}>{label}</span>
                                        <span className={cn("relative inline-flex h-4 w-7 items-center rounded-full transition-colors", show[key] ? "bg-blue-500" : "bg-muted-foreground/25")}>
                                            <span className={cn("inline-block h-3 w-3 rounded-full bg-white transition-transform", show[key] ? "translate-x-3.5" : "translate-x-0.5")} />
                                        </span>
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}
                </div>

                {/* Buscador inferior glass */}
                {!editing && (
                    <div className="absolute bottom-5 left-1/2 -translate-x-1/2 z-[520] w-[min(520px,calc(100%-2rem))]">
                        <div className="flex items-center gap-2 bg-card/90 backdrop-blur-2xl border border-border rounded-2xl shadow-2xl px-3 h-12">
                            <Search size={16} className="text-muted-foreground shrink-0" />
                            <input value={q} onChange={(e) => setQ(e.target.value.toUpperCase())} onKeyDown={(e) => { if (e.key === "Enter") buscar(); }}
                                placeholder="Lote, cámara o calle…" className="flex-1 bg-transparent outline-none text-sm font-medium placeholder:text-muted-foreground/60" />
                            {q && <button onClick={() => { setQ(""); setLocated(null); }} className="text-muted-foreground hover:text-foreground"><X size={15} /></button>}
                            <button onClick={buscar} className="h-8 px-2.5 rounded-lg bg-blue-600 text-white flex items-center gap-1 text-xs font-bold hover:bg-blue-500 transition-colors"><LocateFixed size={14} /></button>
                        </div>
                    </div>
                )}

                {/* Panel contextual de edición */}
                {editing && (
                    <div className="absolute bottom-4 left-4 z-[500] bg-card/95 backdrop-blur border border-border rounded-xl shadow-lg p-3 w-64 text-xs space-y-2">
                        {tool === "lote" && (<>
                            <p className="font-bold flex items-center gap-1.5"><LandPlot size={13} className="text-purple-400" /> Lote</p>
                            <p className="text-muted-foreground">Clic en el mapa para marcar las esquinas del lote ({draftLote.length}). Al cerrar te pido el nombre y la plaza.</p>
                            <div className="flex gap-2"><button onClick={commitLote} disabled={draftLote.length < 3} className="flex-1 py-1.5 rounded-md bg-purple-600 text-white font-bold disabled:opacity-40 flex items-center justify-center gap-1"><Check size={13} /> Cerrar lote</button><button onClick={() => setDraftLote((p) => p.slice(0, -1))} className="px-2 py-1.5 rounded-md bg-accent"><Undo2 size={13} /></button></div>
                        </>)}
                        {tool === "division" && (<>
                            <p className="font-bold flex items-center gap-1.5"><Fence size={13} className="text-stone-400" /> División</p>
                            <div className="flex gap-1">
                                {(["pared", "tejido", "alambrado"] as DivTipo[]).map((tp) => (
                                    <button key={tp} onClick={() => setDivTipo(tp)}
                                        className={cn("flex-1 py-1 rounded-md text-[11px] font-bold border transition-colors", divTipo === tp ? "bg-blue-600 text-white border-blue-600" : "bg-background border-border text-muted-foreground hover:text-foreground")}>{DIV_STYLE[tp].label}</button>
                                ))}
                            </div>
                            <p className="text-muted-foreground">Clic para trazar la línea ({draftDivision.length} puntos).</p>
                            <div className="flex gap-2"><button onClick={commitDivision} disabled={draftDivision.length < 2} className="flex-1 py-1.5 rounded-md bg-blue-600 text-white font-bold disabled:opacity-40 flex items-center justify-center gap-1"><Check size={13} /> Finalizar</button><button onClick={() => setDraftDivision((p) => p.slice(0, -1))} className="px-2 py-1.5 rounded-md bg-accent"><Undo2 size={13} /></button></div>
                        </>)}
                        {tool === "street" && (<>
                            <p className="font-bold flex items-center gap-1.5"><Route size={13} className="text-sky-400" /> Calle</p>
                            <p className="text-muted-foreground">Trazá el eje de la calle con clics ({draftStreet.length} puntos). La ruta de las matrículas va a seguir estas calles. En los cruces, tocá sobre otra calle para que queden conectadas.</p>
                            <div className="flex gap-2"><button onClick={commitStreet} disabled={draftStreet.length < 2} className="flex-1 py-1.5 rounded-md bg-sky-600 text-white font-bold disabled:opacity-40 flex items-center justify-center gap-1"><Check size={13} /> Finalizar calle</button><button onClick={() => setDraftStreet((p) => p.slice(0, -1))} className="px-2 py-1.5 rounded-md bg-accent"><Undo2 size={13} /></button></div>
                        </>)}
                        {tool === "perimeter" && (<>
                            <p className="font-bold flex items-center gap-1.5"><Hexagon size={13} className="text-emerald-400" /> Perímetro</p>
                            <p className="text-muted-foreground">Clic en el mapa para agregar vértices ({draftPerimeter.length}).</p>
                            <div className="flex gap-2"><button onClick={commitPerimeter} disabled={draftPerimeter.length < 3} className="flex-1 py-1.5 rounded-md bg-emerald-600 text-white font-bold disabled:opacity-40 flex items-center justify-center gap-1"><Check size={13} /> Cerrar</button><button onClick={() => setDraftPerimeter((p) => p.slice(0, -1))} className="px-2 py-1.5 rounded-md bg-accent"><Undo2 size={13} /></button></div>
                        </>)}
                        {tool === "camera" && (<>
                            <p className="font-bold flex items-center gap-1.5"><Video size={13} className="text-blue-400" /> Soltar cámara</p>
                            <p className="text-muted-foreground">{pendingCam ? `Clic en el mapa para ubicar ${devById[pendingCam]?.name || "la cámara"}.` : "Elegí una cámara en el panel (o arrastrala al mapa)."}</p>
                        </>)}
                        {tool === "select" && (<p className="text-muted-foreground flex items-center gap-1.5"><MapPin size={13} /> {selected ? `Seleccionado: ${selected.type === "camera" ? (devById[selected.id]?.name || "cámara") : selected.type === "lote" ? (lotes.find((l) => l.id === selected.id)?.name || "lote") : "calle"}` : "Tocá un lote (doble clic para editar) o cámara · clic derecho para menú."}</p>)}
                    </div>
                )}

                {/* Menú contextual */}
                {ctx && (
                    <div className="fixed z-[600] bg-popover border border-border rounded-lg shadow-xl py-1 text-xs min-w-[180px]" style={{ left: ctx.x, top: ctx.y }} onClick={(e) => e.stopPropagation()}>
                        {ctx.type === "camera" ? (<>
                            <button onClick={() => { const cam = data.cameras.find((c) => c.deviceId === ctx.id); if (cam && mapRef.current) mapRef.current.setView([cam.lat, cam.lng], Math.max(mapRef.current.getZoom(), 18)); setCtx(null); }} className="w-full text-left px-3 py-1.5 hover:bg-accent flex items-center gap-2"><Radio size={13} className="text-red-400" /> Centrar / ver</button>
                            <button onClick={() => { setMovingCam(ctx.id); setCtx(null); }} className="w-full text-left px-3 py-1.5 hover:bg-accent flex items-center gap-2"><Move size={13} className="text-blue-400" /> Editar posición</button>
                            <button onClick={() => { const c = data.cameras.find((x) => x.deviceId === ctx.id); if (c) setCamCustom({ deviceId: c.deviceId, rumbo: (c as any).rumbo ?? 0, size: (c as any).size ?? 30, color: (c as any).color ?? "#2563eb" }); setCtx(null); }} className="w-full text-left px-3 py-1.5 hover:bg-accent flex items-center gap-2"><Compass size={13} className="text-purple-400" /> Dirección / tamaño / color</button>
                            <button onClick={() => { removeCameraPersist(ctx.id); setCtx(null); }} className="w-full text-left px-3 py-1.5 hover:bg-accent flex items-center gap-2 text-red-400"><Trash2 size={13} /> Eliminar del mapa</button>
                        </>) : ctx.type === "guard" ? (<>
                            <button onClick={() => { const g = guards.find((x) => String(x.id) === ctx.id); abrirBitacora(g?.guardName || ""); setCtx(null); }} className="w-full text-left px-3 py-1.5 hover:bg-accent flex items-center gap-2"><BookText size={13} className="text-emerald-500" /> Bitácora</button>
                            <button onClick={() => { const g = guards.find((x) => String(x.id) === ctx.id); if (g && mapRef.current) mapRef.current.setView([g.lat, g.lng], Math.max(mapRef.current.getZoom(), 18)); setCtx(null); }} className="w-full text-left px-3 py-1.5 hover:bg-accent flex items-center gap-2"><Crosshair size={13} /> Centrar en el guardia</button>
                        </>) : ctx.type === "lote" ? (<>
                            <button onClick={() => { editLote(ctx.id); setCtx(null); }} className="w-full text-left px-3 py-1.5 hover:bg-accent flex items-center gap-2"><PencilIcon size={13} /> Editar lote / plaza</button>
                            <button onClick={() => { const lo = lotes.find((l) => l.id === ctx.id); if (lo && mapRef.current) { mapRef.current.setView(centroid(lo.points), Math.max(mapRef.current.getZoom(), 19)); localizar("lote", lo.id); } setCtx(null); }} className="w-full text-left px-3 py-1.5 hover:bg-accent flex items-center gap-2"><LocateFixed size={13} className="text-amber-500" /> Localizar</button>
                            <button onClick={() => { removeLote(ctx.id); setCtx(null); }} className="w-full text-left px-3 py-1.5 hover:bg-accent flex items-center gap-2 text-red-400"><Trash2 size={13} /> Borrar lote</button>
                        </>) : ctx.type === "division" ? (<>
                            <button onClick={() => { setExtendDiv(null); setEditDivPts(ctx.id); setCtx(null); }} className="w-full text-left px-3 py-1.5 hover:bg-accent flex items-center gap-2"><Move size={13} className="text-amber-400" /> Editar puntos (mover / quitar)</button>
                            <button onClick={() => { setEditDivPts(null); setExtendDiv(ctx.id); setCtx(null); }} className="w-full text-left px-3 py-1.5 hover:bg-accent flex items-center gap-2"><Plus size={13} className="text-blue-400" /> Seguir agregando puntos</button>
                            <button onClick={() => { const dv = ((data as any).divisions || []).find((x: any) => x.id === ctx.id); if (dv) { const st = DIV_STYLE[dv.tipo as DivTipo] || DIV_STYLE.pared; setDivCustom({ id: dv.id, tipo: dv.tipo, color: dv.color || st.color, weight: dv.weight || st.weight }); } setCtx(null); }} className="w-full text-left px-3 py-1.5 hover:bg-accent flex items-center gap-2"><Palette size={13} className="text-purple-400" /> Color y grosor</button>
                            <button onClick={() => { removeDivision(ctx.id); setCtx(null); }} className="w-full text-left px-3 py-1.5 hover:bg-accent flex items-center gap-2 text-red-400"><Trash2 size={13} /> Borrar división</button>
                        </>) : ctx.type === "map" ? (<>
                            <button onClick={() => { setEditing(true); setPlaceDrawer(true); setCtx(null); }} className="w-full text-left px-3 py-1.5 hover:bg-accent flex items-center gap-2"><Video size={13} className="text-blue-400" /> Colocar cámara</button>
                            <div className="h-px bg-border my-1" />
                            <div className="px-3 py-1 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Intrusión</div>
                            <button onClick={() => { setEditing(true); setIntrDrawer("line"); setCtx(null); }} className="w-full text-left px-3 py-1.5 hover:bg-accent flex items-center gap-2"><Route size={13} className="text-sky-400" /> Definir cruce de línea</button>
                            <button onClick={() => { setEditing(true); setIntrDrawer("zone"); setCtx(null); }} className="w-full text-left px-3 py-1.5 hover:bg-accent flex items-center gap-2"><ShieldAlert size={13} className="text-sky-400" /> Definir zona de intrusión</button>
                        </>) : ctx.type === "intr" ? (<>
                            <button onClick={() => { removeIntr(ctx.id); setCtx(null); }} className="w-full text-left px-3 py-1.5 hover:bg-accent flex items-center gap-2 text-red-400"><Trash2 size={13} /> Borrar cruce / zona</button>
                        </>) : (<>
                            <button onClick={() => { renameStreet(ctx.id); setCtx(null); }} className="w-full text-left px-3 py-1.5 hover:bg-accent flex items-center gap-2"><PencilIcon size={13} /> Renombrar calle</button>
                            {editing && <button onClick={() => { removeStreet(ctx.id); setCtx(null); }} className="w-full text-left px-3 py-1.5 hover:bg-accent flex items-center gap-2 text-red-400"><Trash2 size={13} /> Borrar calle</button>}
                        </>)}
                    </div>
                )}

                {intrPick && (() => {
                    const list: any[] = intrCamList.filter((c) => { const k = geomKinds(c.id); return k.line || k.zone; });
                    const sel = list.find((c) => c.id === intrPickCam);
                    const q = camSearch.trim().toLowerCase();
                    const filtered = q ? list.filter((c) => `${c.name} ${c.nvrName || ""} ${c.ch ?? ""}`.toLowerCase().includes(q)) : list;
                    return (
                    <div className="fixed inset-0 z-[700] bg-black/50 flex items-center justify-center" onClick={() => setIntrPick(null)}>
                        <div className="bg-popover border border-border rounded-xl shadow-2xl p-4 flex gap-4" onClick={(e) => e.stopPropagation()}>
                            <div className="w-[300px]">
                                <div className="text-sm font-bold mb-2 flex items-center gap-2">{intrPick.kind === "zone" ? <ShieldAlert size={15} className="text-sky-500" /> : <Route size={15} className="text-sky-500" />} {intrPick.kind === "zone" ? "Nueva zona de intrusión" : "Nuevo cruce de línea"}</div>
                                <div className="flex gap-1.5 mb-3">
                                    <button onClick={() => setIntrPick({ kind: "line" })} className={cn("flex-1 py-1.5 rounded-md text-xs font-bold flex items-center justify-center gap-1", intrPick.kind === "line" ? "bg-sky-600 text-white" : "bg-accent")}><Route size={13} /> Cruce</button>
                                    <button onClick={() => setIntrPick({ kind: "zone" })} className={cn("flex-1 py-1.5 rounded-md text-xs font-bold flex items-center justify-center gap-1", intrPick.kind === "zone" ? "bg-sky-600 text-white" : "bg-accent")}><ShieldAlert size={13} /> Zona</button>
                                </div>
                                <p className="text-xs text-muted-foreground mb-1.5">¿De qué cámara es?</p>
                                <div className="relative mb-3">
                                    <button type="button" onClick={() => setCamOpen((v) => !v)} className="w-full h-9 px-3 rounded-md bg-background border border-border text-sm flex items-center justify-between hover:bg-accent/50 transition-colors">
                                        <span className={cn("truncate", !sel && "text-muted-foreground")}>{sel ? `${sel.name}${sel.nvrName ? ` · ${sel.nvrName}${sel.ch != null ? " CH" + sel.ch : ""}` : ""}` : "Elegí una cámara…"}</span>
                                        <ChevronDown size={14} className={cn("text-muted-foreground shrink-0 transition-transform", camOpen && "rotate-180")} />
                                    </button>
                                    {camOpen && (
                                        <div className="absolute z-[710] mt-1 left-0 right-0 bg-popover border border-border rounded-xl shadow-2xl overflow-hidden">
                                            <div className="p-1.5 border-b border-border">
                                                <div className="relative">
                                                    <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                                                    <input autoFocus value={camSearch} onChange={(e) => setCamSearch(e.target.value)} placeholder="Buscar cámara / NVR / canal…" className="w-full h-8 pl-7 pr-2 rounded-lg bg-background border border-border text-xs focus:outline-none focus:ring-1 focus:ring-sky-500" />
                                                </div>
                                            </div>
                                            <div className="max-h-[210px] overflow-y-auto custom-scrollbar py-1">
                                                {filtered.length === 0 && <div className="px-3 py-3 text-xs text-muted-foreground text-center">{geomLoading ? "Cargando analíticas…" : "Sin resultados"}</div>}
                                                {filtered.map((c) => { const k = geomKinds(c.id); const tipo = k.line && k.zone ? "Cruce+Zona" : k.zone ? "Zona" : "Cruce"; return (
                                                    <button key={c.id} onClick={() => { setIntrPickCam(c.id); setCamOpen(false); setCamSearch(""); }} className={cn("w-full text-left px-3 py-1.5 text-xs hover:bg-accent flex items-center justify-between gap-2 transition-colors", intrPickCam === c.id && "bg-accent")}>
                                                        <span className="truncate"><span className="font-bold">{c.name}</span>{c.nvrName ? <span className="text-muted-foreground"> · {c.nvrName}{c.ch != null ? ` CH${c.ch}` : ""}</span> : null}</span>
                                                        <span className={cn("shrink-0 text-[9px] font-extrabold px-1.5 py-0.5 rounded", tipo === "Zona" ? "bg-rose-500/15 text-rose-400" : tipo === "Cruce" ? "bg-sky-500/15 text-sky-400" : "bg-violet-500/15 text-violet-400")}>{tipo}</span>
                                                    </button>
                                                ); })}
                                            </div>
                                        </div>
                                    )}
                                </div>
                                <div className="flex gap-2">
                                    <button disabled={!intrPickCam} onClick={() => { setIntrDraw({ kind: intrPick.kind, deviceId: intrPickCam }); setDraftIntr([]); setIntrPick(null); }} className="flex-1 py-1.5 rounded-md bg-sky-600 text-white font-bold text-sm disabled:opacity-40">Dibujar</button>
                                    <button onClick={() => setIntrPick(null)} className="px-3 py-1.5 rounded-md bg-accent text-sm">Cancelar</button>
                                </div>
                            </div>
                            <div className="w-[260px] flex flex-col">
                                <div className="text-[11px] font-bold text-muted-foreground mb-1.5">Analítica en la cámara</div>
                                <div className="relative w-[260px] h-[150px] bg-black rounded-lg overflow-hidden ring-1 ring-border flex items-center justify-center">
                                    {intrPickCam ? (<>
                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                        <img src={`/api/snapshot/${intrPickCam}?t=intr`} alt="" className="absolute inset-0 w-full h-full object-cover" />
                                        <MiniGeomOverlay geom={intrGeomPrev[intrPickCam]} />
                                        {!intrGeomPrev[intrPickCam] && <span className="relative text-[10px] text-white/70">Cargando analítica…</span>}
                                    </>) : <span className="text-[11px] text-muted-foreground px-3 text-center">Elegí una cámara para ver su línea/zona</span>}
                                </div>
                                {sel && sel.nvrName && <div className="text-[10px] text-muted-foreground mt-1.5 truncate">{sel.nvrName}{sel.ch != null ? ` · CH ${sel.ch}` : ""}</div>}
                                <p className="text-[10px] text-muted-foreground mt-auto pt-2">La referencia azul marca qué cruza la cámara: dibujá la línea/zona en el mapa con esa orientación.</p>
                            </div>
                        </div>
                    </div>
                    );
                })()}
                {intrDraw && (
                    <div className="absolute bottom-24 left-1/2 -translate-x-1/2 z-[650] bg-popover/95 border border-border rounded-xl shadow-2xl px-3 py-2 flex items-center gap-2 backdrop-blur">
                        <div className="relative w-[64px] h-[40px] rounded-md overflow-hidden bg-black ring-1 ring-border shrink-0">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={`/api/snapshot/${intrDraw.deviceId}?t=ref`} alt="" className="absolute inset-0 w-full h-full object-cover" />
                            <MiniGeomOverlay geom={intrGeomPrev[intrDraw.deviceId]} />
                        </div>
                        <span className="text-xs font-bold">{intrDraw.kind === "zone" ? "Zona" : "Cruce"} · {devById[intrDraw.deviceId]?.name || intrCamList.find((c) => c.id === intrDraw.deviceId)?.name || "Cámara"} · {draftIntr.length} pts</span>
                        <button onClick={commitIntr} disabled={draftIntr.length < (intrDraw.kind === "zone" ? 3 : 2)} className="px-3 py-1.5 rounded-md bg-sky-600 text-white font-bold text-xs disabled:opacity-40 flex items-center gap-1"><Check size={13} /> Finalizar</button>
                        <button onClick={() => setDraftIntr((p) => p.slice(0, -1))} className="px-2 py-1.5 rounded-md bg-accent"><Undo2 size={13} /></button>
                        <button onClick={() => { setDraftIntr([]); setIntrDraw(null); }} className="px-2 py-1.5 rounded-md bg-accent"><X size={13} /></button>
                    </div>
                )}

{placeDrawer && (
                    <div className="absolute top-0 right-0 bottom-0 z-[680] w-[320px] bg-card/95 backdrop-blur-xl border-l border-border shadow-2xl flex flex-col">
                        <div className="flex items-center justify-between px-3 py-2.5 border-b border-border shrink-0">
                            <div className="text-sm font-bold flex items-center gap-2"><Video size={15} className="text-blue-400" /> Colocar cámara</div>
                            <button onClick={() => setPlaceDrawer(false)} className={gbtn}><X size={15} /></button>
                        </div>
                        <div className="px-2.5 pt-2 pb-1 shrink-0">
                            <div className="relative"><Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" /><input value={placeSearch} onChange={(e) => setPlaceSearch(e.target.value)} placeholder="Buscar cámara…" className="w-full h-8 pl-7 pr-2 rounded-lg bg-background border border-border text-xs focus:outline-none focus:ring-1 focus:ring-blue-500" /></div>
                            <p className="text-[10px] text-muted-foreground mt-1.5">Arrastrá una cámara al mapa, o tocÃ¡ “Colocar” y hacé clic en el punto.</p>
                        </div>
                        <div className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-1.5">
                            {placeFiltered.length === 0 && <div className="text-xs text-muted-foreground p-3 text-center">{unplaced.length === 0 ? "Todas las cámaras ya están ubicadas." : "Sin resultados."}</div>}
                            {placeFiltered.map((d: any) => (
                                <div key={d.id} draggable onDragStart={(e) => { e.dataTransfer.setData("text/camId", d.id); e.dataTransfer.effectAllowed = "copy"; }}
                                    className={cn("rounded-xl border border-border bg-background/60 p-1.5 flex items-center gap-2 cursor-grab active:cursor-grabbing", pendingCam === d.id && "ring-1 ring-blue-500")}>
                                    <div className="relative w-[72px] h-[44px] rounded-md overflow-hidden bg-black shrink-0 ring-1 ring-border">
                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                        <img src={`/api/snapshot/${d.id}?t=pl`} alt="" className="absolute inset-0 w-full h-full object-cover" loading="lazy" draggable={false} />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="text-[12px] font-bold truncate">{d.name}</div>
                                        <div className="mt-0.5"><span className={cn("text-[9px] font-bold px-1.5 py-0.5 rounded", d.deviceType === "LPR_CAMERA" ? "bg-amber-500/15 text-amber-400" : "bg-sky-500/15 text-sky-400")}>{d.deviceType === "LPR_CAMERA" ? "LPR" : "Cámara"}</span></div>
                                    </div>
                                    <button onClick={() => { setEditing(true); setPendingCam(d.id); setTool("camera"); }} className="text-[10px] font-bold px-2 py-1 rounded bg-blue-600 text-white hover:bg-blue-500 shrink-0">Colocar</button>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {intrDrawer && (() => {
                    const kind = intrDrawer;
                    const list = intrCamList.filter((c) => { const k = geomKinds(c.id); return kind === "line" ? k.line : k.zone; });
                    const drawnOf = (id: string) => ((data as any).intrusions || []).find((g: any) => g.deviceId === id && g.kind === kind);
                    const drawnCount = list.filter((c) => drawnOf(c.id)).length;
                    return (
                        <div className="absolute top-0 right-0 bottom-0 z-[680] w-[320px] bg-card/95 backdrop-blur-xl border-l border-border shadow-2xl flex flex-col">
                            <div className="flex items-center justify-between px-3 py-2.5 border-b border-border shrink-0">
                                <div className="text-sm font-bold flex items-center gap-2">{kind === "zone" ? <ShieldAlert size={15} className="text-sky-500" /> : <Route size={15} className="text-sky-500" />} {kind === "zone" ? "Zonas de intrusión" : "Cruces de línea"} <span className="text-[11px] font-semibold text-muted-foreground">{drawnCount}/{list.length}</span></div>
                                <button onClick={() => setIntrDrawer(null)} className={gbtn}><X size={15} /></button>
                            </div>
                            <div className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-2">
                                {geomLoading && list.length === 0 && <div className="text-xs text-muted-foreground flex items-center gap-2 p-3"><Loader2 size={14} className="animate-spin" /> Cargando analíticas…</div>}
                                {!geomLoading && list.length === 0 && <div className="text-xs text-muted-foreground p-3">Ninguna cámara con {kind === "zone" ? "zona" : "cruce"} configurado.</div>}
                                {list.map((c) => { const drawn = drawnOf(c.id); return (
                                    <div key={c.id} className="rounded-xl border border-border bg-background/60 p-2 flex gap-2">
                                        <div className="relative w-[84px] h-[52px] rounded-md overflow-hidden bg-black shrink-0 ring-1 ring-border">
                                            {/* eslint-disable-next-line @next/next/no-img-element */}
                                            <img src={`/api/snapshot/${c.id}?t=dr`} alt="" className="absolute inset-0 w-full h-full object-cover" loading="lazy" />
                                            <MiniGeomOverlay geom={intrGeomPrev[c.id]} />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="text-[12px] font-bold truncate">{c.name}</div>
                                            <div className="text-[10px] text-muted-foreground truncate">{c.nvrName || "—"}{c.ch != null ? ` · CH ${c.ch}` : ""}</div>
                                            <div className="mt-0.5">{drawn ? <span className="text-[9px] font-bold uppercase text-emerald-500">● Dibujado ({drawn.points.length} pts)</span> : <span className="text-[9px] font-bold uppercase text-amber-500">● Pendiente</span>}</div>
                                            <div className="mt-1 flex gap-1 flex-wrap">
                                                <button onClick={() => { setIntrDraw({ kind, deviceId: c.id }); setDraftIntr([]); setIntrPickCam(c.id); setIntrDrawer(null); }} className="text-[10px] font-bold px-2 py-0.5 rounded bg-sky-600 text-white hover:bg-sky-500">{drawn ? "Redibujar" : "Dibujar"}</button>
                                                {!drawn && placedIds.has(c.id) && <button onClick={() => suggestGeom(c.id, kind)} title="Crear una sugerencia segun la orientacion de la camara" className="text-[10px] font-bold px-2 py-0.5 rounded bg-violet-600/80 text-white hover:bg-violet-600">Sugerir</button>}
                                                {drawn && <button onClick={() => { if (mapRef.current && drawn.points[0]) mapRef.current.setView(drawn.points[0], Math.max(mapRef.current.getZoom(), 18)); }} className="text-[10px] font-bold px-2 py-0.5 rounded bg-accent">Ver</button>}
                                                {drawn && <button onClick={() => removeIntr(drawn.id)} title="Borrar del mapa" className="text-[10px] font-bold px-2 py-0.5 rounded bg-accent text-red-400"><Trash2 size={11} /></button>}
                                            </div>
                                        </div>
                                    </div>
                                ); })}
                            </div>
                        </div>
                    );
                })()}

                {/* Drawer de lote (edición) */}
                <AnimatePresence>
                    {loteModal && (
                        <LoteDrawer value={loteModal} slots={slots}
                            onChange={(patch) => setLoteModal((m) => m ? { ...m, ...patch } : m)}
                            onSave={saveLoteModal}
                            onClose={() => setLoteModal(null)}
                            onDelete={loteModal.mode === "edit" && loteModal.id ? () => { const id = loteModal.id!; setLoteModal(null); removeLote(id); } : undefined}
                        />
                    )}
                </AnimatePresence>

                {/* Drawer de ficha del lote (clic en el lote) */}
                <AnimatePresence>
                    {loteDetail && (
                        <MapDrawer title={loteDetail.lote.name || "Lote"} icon={LandPlot} accent="purple"
                            subtitle={loteDetail.data?.sector ? `Sector ${loteDetail.data.sector}${loteDetail.data.unidad ? ` · ${loteDetail.data.unidad}` : ""}` : (loteDetail.lote.parkingSlotId ? "Plaza vinculada" : "Sin plaza vinculada")}
                            onClose={() => setLoteDetail(null)}>
                            {loteDetail.loading ? (
                                <div className="flex items-center justify-center py-10 text-muted-foreground"><Loader2 size={18} className="animate-spin mr-2" /> Cargando ficha…</div>
                            ) : !loteDetail.lote.parkingSlotId ? (
                                <div className="rounded-xl border border-border bg-background/40 p-4 text-center space-y-3">
                                    <SquareParking size={22} className="mx-auto text-muted-foreground" />
                                    <p className="text-xs text-muted-foreground">Este lote no está vinculado a una plaza de parking. Vinculalo para ver residentes, matrículas y movimientos.</p>
                                    <button onClick={() => { const l = loteDetail.lote; setLoteDetail(null); setLoteModal({ mode: "edit", id: l.id, name: l.name || "", parkingSlotId: l.parkingSlotId || "", points: l.points }); }}
                                        className="px-3 py-1.5 rounded-lg text-xs font-bold bg-blue-600 text-white hover:bg-blue-500">Vincular a plaza</button>
                                </div>
                            ) : (
                                <>
                                    {/* Residentes y matrículas */}
                                    <div className="rounded-xl border border-border bg-background/40 overflow-hidden">
                                        <div className="flex items-center gap-2 px-3 h-9 border-b border-border"><UserIcon size={13} className="text-blue-500" /><span className="text-[11px] font-black uppercase tracking-widest text-muted-foreground">Residentes</span></div>
                                        <div className="p-2 space-y-2">
                                            {(loteDetail.data?.residentes || []).length ? (loteDetail.data!.residentes.map((r) => (
                                                <div key={r.id} className="px-2 py-1.5 rounded-lg hover:bg-accent/40">
                                                    <p className="text-[13px] font-semibold text-foreground">{r.nombre}</p>
                                                    <div className="flex flex-wrap gap-1 mt-1">
                                                        {r.matriculas.length ? r.matriculas.map((m) => (
                                                            <span key={m} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-blue-500/10 text-blue-600 dark:text-blue-300 text-[11px] font-mono font-bold"><Car size={10} /> {m}</span>
                                                        )) : <span className="text-[11px] text-muted-foreground">Sin matrículas</span>}
                                                    </div>
                                                </div>
                                            ))) : <p className="px-2 py-3 text-[12px] text-muted-foreground text-center">Sin residentes asignados</p>}
                                        </div>
                                    </div>

                                    {/* Últimos movimientos */}
                                    <div className="rounded-xl border border-border bg-background/40 overflow-hidden">
                                        <div className="flex items-center gap-2 px-3 h-9 border-b border-border"><Clock size={13} className="text-emerald-500" /><span className="text-[11px] font-black uppercase tracking-widest text-muted-foreground">Últimos movimientos</span></div>
                                        <div className="p-1.5 space-y-0.5">
                                            {(loteDetail.data?.movimientos || []).length ? (loteDetail.data!.movimientos.map((m) => {
                                                const ent = m.dir === "ENTRY";
                                                return (
                                                    <div key={m.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-accent/40">
                                                        {ent ? <LogIn size={14} className="text-emerald-500 shrink-0" /> : <LogOut size={14} className="text-orange-500 shrink-0" />}
                                                        <div className="min-w-0 flex-1">
                                                            <p className="text-[12px] font-mono font-bold text-foreground truncate">{m.plate || "S/L"}</p>
                                                            <p className="text-[10px] text-muted-foreground truncate">{m.camara || ""}</p>
                                                        </div>
                                                        <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">{fechaHora(m.ts)}</span>
                                                    </div>
                                                );
                                            })) : <p className="px-2 py-3 text-[12px] text-muted-foreground text-center">Sin movimientos recientes</p>}
                                        </div>
                                    </div>

                                    <button onClick={() => { const l = loteDetail.lote; setLoteDetail(null); setLoteModal({ mode: "edit", id: l.id, name: l.name || "", parkingSlotId: l.parkingSlotId || "", points: l.points }); }}
                                        className="w-full h-9 rounded-lg text-xs font-bold text-muted-foreground border border-border hover:bg-accent flex items-center justify-center gap-1.5"><PencilIcon size={13} /> Editar lote</button>
                                </>
                            )}
                        </MapDrawer>
                    )}
                </AnimatePresence>

                {/* Drawer de bitácora (clic derecho en tablet → Bitácora) */}
                <AnimatePresence>
                    {bitacora && (
                        <MapDrawer title="Bitácora" subtitle={bitacora.guardName || "Todas"} icon={BookText} accent="emerald" onClose={() => setBitacora(null)}>
                            {bitacora.loading ? (
                                <div className="flex items-center justify-center py-10 text-muted-foreground"><Loader2 size={18} className="animate-spin mr-2" /> Cargando bitácora…</div>
                            ) : bitacora.entries.length ? (
                                bitacora.entries.map((e: any) => (
                                    <div key={e.id} className="rounded-xl border border-border bg-background/40 p-2.5">
                                        <div className="flex items-center gap-2 mb-1">
                                            <span className="px-1.5 py-0.5 rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-300 text-[10px] font-black uppercase tracking-wide">{e.type || "NOTA"}</span>
                                            {e.plate && <span className="px-1.5 py-0.5 rounded-md bg-blue-500/10 text-blue-600 dark:text-blue-300 text-[11px] font-mono font-bold">{e.plate}</span>}
                                            <span className="ml-auto text-[10px] text-muted-foreground tabular-nums">{fechaHora(e.timestamp)}</span>
                                        </div>
                                        {e.name && <p className="text-[12px] font-semibold text-foreground">{e.name}{e.company ? ` · ${e.company}` : ""}</p>}
                                        {e.destination && <p className="text-[11px] text-muted-foreground">→ {e.destination}</p>}
                                        {e.notes && <p className="text-[11px] text-muted-foreground mt-0.5 flex items-start gap-1"><StickyNote size={11} className="mt-0.5 shrink-0" /> {e.notes}</p>}
                                    </div>
                                ))
                            ) : (
                                <div className="flex flex-col items-center gap-2 py-10 text-muted-foreground/60"><BookText size={22} /><span className="text-xs">Sin registros de esta tablet</span></div>
                            )}
                        </MapDrawer>
                    )}
                </AnimatePresence>

                {/* Drawer: personalizar cámara (dirección / tamaño / color) */}
                <AnimatePresence>
                    {camCustom && (() => {
                        const cc = camCustom;
                        const setCam = (patch: Partial<{ rumbo: number; size: number; color: string }>) => {
                            const next = { ...cc, ...patch };
                            setCamCustom(next);
                            setData((d) => d ? { ...d, cameras: d.cameras.map((x) => x.deviceId === cc.deviceId ? { ...x, rumbo: next.rumbo, size: next.size, color: next.color } : x) } : d);
                        };
                        const guardarCam = () => {
                            const next = { ...data, cameras: data.cameras.map((x) => x.deviceId === cc.deviceId ? { ...x, rumbo: cc.rumbo, size: cc.size, color: cc.color } : x) };
                            setCamCustom(null); persistNow(next, "Cámara personalizada");
                        };
                        const dirs: [string, number][] = [["N", 0], ["NE", 45], ["E", 90], ["SE", 135], ["S", 180], ["SO", 225], ["O", 270], ["NO", 315]];
                        return (
                            <MapDrawer title="Cámara" subtitle={devById[cc.deviceId]?.name || "Ícono"} icon={Compass} accent="purple" onClose={() => setCamCustom(null)}>
                                <div className="flex items-center justify-center py-6 rounded-xl border border-border bg-background/40" dangerouslySetInnerHTML={{ __html: `<div style="position:relative">${camHtml({ rumbo: cc.rumbo, size: cc.size, color: cc.color })}</div>` }} />
                                <div className="rounded-xl border border-border bg-background/40 p-3 space-y-2">
                                    <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Dirección (hacia dónde apunta)</p>
                                    <div className="grid grid-cols-4 gap-1">{dirs.map(([l, d]) => <button key={l} onClick={() => setCam({ rumbo: d })} className={cn("h-8 rounded-lg text-[11px] font-bold transition-colors", Math.round(cc.rumbo) === d ? "bg-blue-600 text-white" : "bg-background border border-border text-muted-foreground hover:text-foreground")}>{l}</button>)}</div>
                                    <input type="range" min={0} max={359} value={cc.rumbo} onChange={(e) => setCam({ rumbo: +e.target.value })} className="w-full accent-blue-600" />
                                    <p className="text-[11px] text-muted-foreground text-center tabular-nums">{Math.round(cc.rumbo)}°</p>
                                </div>
                                <div className="rounded-xl border border-border bg-background/40 p-3 space-y-2">
                                    <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Tamaño</p>
                                    <input type="range" min={22} max={54} value={cc.size} onChange={(e) => setCam({ size: +e.target.value })} className="w-full accent-blue-600" />
                                </div>
                                <div className="rounded-xl border border-border bg-background/40 p-3 space-y-2">
                                    <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Color</p>
                                    <div className="flex flex-wrap gap-2">{CAM_COLORS.map((c) => <button key={c} onClick={() => setCam({ color: c })} style={{ background: c }} className={cn("h-7 w-7 rounded-full border-2 transition-all", cc.color === c ? "border-blue-500 ring-2 ring-blue-500/40 scale-110" : "border-white/40")} />)}</div>
                                </div>
                                <div className="flex gap-2 pt-1">
                                    <button onClick={() => setCamCustom(null)} className="flex-1 h-9 rounded-lg text-xs font-bold text-muted-foreground hover:bg-accent">Cerrar</button>
                                    <button onClick={guardarCam} className="flex-1 h-9 rounded-lg text-xs font-bold bg-blue-600 text-white hover:bg-blue-500 flex items-center justify-center gap-1.5"><Check size={14} /> Guardar</button>
                                </div>
                            </MapDrawer>
                        );
                    })()}
                </AnimatePresence>

                {/* Drawer: color / grosor de la línea de división */}
                <AnimatePresence>
                    {divCustom && (() => {
                        const dc = divCustom;
                        const setDiv = (patch: Partial<{ tipo: DivTipo; color: string; weight: number }>) => {
                            const next = { ...dc, ...patch };
                            setDivCustom(next);
                            setData((d) => d ? ({ ...d, divisions: ((d as any).divisions || []).map((x: any) => x.id === dc.id ? { ...x, tipo: next.tipo, color: next.color, weight: next.weight } : x) }) as any : d);
                        };
                        const guardarDiv = () => {
                            const next = { ...data, divisions: ((data as any).divisions || []).map((x: any) => x.id === dc.id ? { ...x, tipo: dc.tipo, color: dc.color, weight: dc.weight } : x) } as any;
                            setDivCustom(null); persistNow(next, "Línea actualizada");
                        };
                        return (
                            <MapDrawer title="División" subtitle={DIV_STYLE[dc.tipo].label} icon={Fence} accent="blue" onClose={() => setDivCustom(null)}>
                                <div className="rounded-xl border border-border bg-background/40 p-3 space-y-2">
                                    <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Tipo</p>
                                    <div className="flex gap-1">{(["pared", "tejido", "alambrado"] as DivTipo[]).map((tp) => <button key={tp} onClick={() => setDiv({ tipo: tp, color: DIV_STYLE[tp].color, weight: DIV_STYLE[tp].weight })} className={cn("flex-1 h-8 rounded-lg text-[11px] font-bold border transition-colors", dc.tipo === tp ? "bg-blue-600 text-white border-blue-600" : "bg-background border-border text-muted-foreground hover:text-foreground")}>{DIV_STYLE[tp].label}</button>)}</div>
                                </div>
                                <div className="rounded-xl border border-border bg-background/40 p-3 space-y-2">
                                    <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Color</p>
                                    <div className="flex flex-wrap gap-2">{CAM_COLORS.map((c) => <button key={c} onClick={() => setDiv({ color: c })} style={{ background: c }} className={cn("h-7 w-7 rounded-full border-2 transition-all", dc.color === c ? "border-blue-500 ring-2 ring-blue-500/40 scale-110" : "border-white/40")} />)}</div>
                                </div>
                                <div className="rounded-xl border border-border bg-background/40 p-3 space-y-2">
                                    <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Grosor · {dc.weight}px</p>
                                    <input type="range" min={1} max={12} value={dc.weight} onChange={(e) => setDiv({ weight: +e.target.value })} className="w-full accent-blue-600" />
                                </div>
                                <button onClick={() => { setDivCustom(null); setExtendDiv(dc.id); }} className="w-full h-9 rounded-lg text-xs font-bold border border-border hover:bg-accent flex items-center justify-center gap-1.5"><Plus size={13} /> Seguir agregando puntos</button>
                                <div className="flex gap-2">
                                    <button onClick={() => setDivCustom(null)} className="flex-1 h-9 rounded-lg text-xs font-bold text-muted-foreground hover:bg-accent">Cerrar</button>
                                    <button onClick={guardarDiv} className="flex-1 h-9 rounded-lg text-xs font-bold bg-blue-600 text-white hover:bg-blue-500 flex items-center justify-center gap-1.5"><Check size={14} /> Guardar</button>
                                </div>
                            </MapDrawer>
                        );
                    })()}
                </AnimatePresence>
            </div>
        </TooltipProvider>
    );
}
