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
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { sileo as toast } from "sileo";
import { getBarrioMap, saveBarrioMap, type BarrioMapData } from "@/app/actions/barriomap";
import { getParkingSlots } from "@/app/actions/parking";
import { io } from "socket.io-client";
import { FlowAnims, FlowColumn, useFlow } from "@/components/barrio/FlowLayer";
import { LogIn, LogOut } from "lucide-react";
import { getDevices } from "@/app/actions/devices";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import { montarVivo } from "@/lib/vivo";
import { BotonFijar, useVivo } from "@/components/vivo/PanelVivo";

type Tool = "select" | "perimeter" | "camera" | "lote";
type LL = [number, number];
type Base = "Híbrido" | "Táctico" | "Satélite" | "Calles";
type SelKind = "street" | "camera" | "lote";

const camSvg = `
<div style="display:flex;flex-direction:column;align-items:center;transform:translateY(-4px)">
  <span class="cam-glyph" style="width:30px;height:30px;border-radius:8px;background:#2563eb;border:2px solid #fff;display:flex;align-items:center;justify-content:center;box-shadow:0 3px 6px rgba(0,0,0,.4)">
    <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m22 8-6 4 6 4V8Z"/><rect width="14" height="12" x="2" y="6" rx="2" ry="2"/></svg>
  </span>
</div>`;
const camIcon = L.divIcon({ className: "bg-transparent border-0", html: camSvg, iconSize: [30, 30], iconAnchor: [15, 22], popupAnchor: [0, -20] });

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

function MapRefGrabber({ onMap }: { onMap: (m: L.Map) => void }) {
    const map = useMap();
    useEffect(() => { onMap(map); }, [map, onMap]);
    return null;
}
function ClickHandler({ onClick }: { onClick: (ll: LL) => void }) {
    useMapEvents({ click(e) { onClick([e.latlng.lat, e.latlng.lng]); } });
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

/* ── Burbujas de video en vivo, cada una sobre su cámara en el mapa (clon de San Nicolás) ──
 * No son marcadores de Leaflet: el <video> se monta una sola vez y en cada movimiento del
 * mapa se recalcula solo su posición vía transform (sin re-render de React ni recortar el
 * stream). "Fijar" (BotonFijar) la saca del mapa y la deja como ventana flotante que
 * sobrevive al cambio de página. */
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
    const [data, setData] = useState<BarrioMapData | null>(null);
    const [devices, setDevices] = useState<any[]>([]);
    const [slots, setSlots] = useState<any[]>([]);
    const [editing, setEditing] = useState(false);
    const [tool, setTool] = useState<Tool>("select");
    const [draftPerimeter, setDraftPerimeter] = useState<LL[]>([]);
    const [draftLote, setDraftLote] = useState<LL[]>([]);
    const [pendingCam, setPendingCam] = useState<string>("");
    const [selected, setSelected] = useState<{ type: SelKind; id: string } | null>(null);
    const [saving, setSaving] = useState(false);
    const [ctx, setCtx] = useState<{ x: number; y: number; type: SelKind; id: string } | null>(null);
    const mapRef = useRef<L.Map | null>(null);
    const wrapRef = useRef<HTMLDivElement | null>(null);
    const [guards, setGuards] = useState<any[]>([]);
    const [liveSocket, setLiveSocket] = useState<any>(null);

    // Chrome (estilo San Nicolás)
    const [base, setBase] = useState<Base>("Satélite");
    const [menuCapas, setMenuCapas] = useState(false);
    const [show, setShow] = useState({ cameras: true, lotes: true, perimeter: true, guards: true, names: true });
    const [pantalla, setPantalla] = useState(false);
    const [q, setQ] = useState("");

    // Modal de lote (crear / editar)
    const [loteModal, setLoteModal] = useState<{ mode: "create" | "edit"; id?: string; name: string; parkingSlotId: string; points: LL[] } | null>(null);
    // Video en vivo de todas las cámaras (burbujas sobre cada cámara, estilo San Nicolás)
    const [vivoTodas, setVivoTodas] = useState(false);
    const [ocultas, setOcultas] = useState<string[]>([]);
    const oscura = base !== "Calles";

    useEffect(() => {
        const s = io(window.location.origin, { path: "/io/socket.io", transports: ["polling"], upgrade: false, reconnection: true, reconnectionAttempts: Infinity, reconnectionDelay: 1000, reconnectionDelayMax: 8000 });
        s.on("guard_locations", (data: any[]) => setGuards(Array.isArray(data) ? data.filter((g) => g.lat != null) : []));
        s.on("connect", () => s.emit("get_guard_locations"));
        setLiveSocket(s);
        const iv = setInterval(() => { if (s.connected) s.emit("get_guard_locations"); }, 30000);
        return () => { clearInterval(iv); setLiveSocket(null); s.disconnect(); };
    }, []);

    useEffect(() => {
        getBarrioMap().then(setData).catch(() => setData(null));
        getDevices().then((d: any) => setDevices((d || []).filter((x: any) => x.deviceType === "LPR_CAMERA"))).catch(() => { });
        getParkingSlots().then((s: any) => setSlots(s || [])).catch(() => { });
    }, []);
    useEffect(() => {
        const close = () => setCtx(null);
        window.addEventListener("click", close);
        return () => window.removeEventListener("click", close);
    }, []);
    useEffect(() => {
        const onFs = () => setPantalla(!!document.fullscreenElement);
        document.addEventListener("fullscreenchange", onFs);
        return () => document.removeEventListener("fullscreenchange", onFs);
    }, []);

    const devById = useMemo(() => Object.fromEntries(devices.map((d) => [d.id, d])), [devices]);
    const slotById = useMemo(() => Object.fromEntries(slots.map((s: any) => [s.id, s])), [slots]);
    const camsNamed = useMemo(() => (data?.cameras || []).map((c) => ({ ...c, name: (devById as any)[c.deviceId]?.name })), [data, devById]);
    const flow = useFlow(data?.streets || [], camsNamed, liveSocket);
    const placedIds = useMemo(() => new Set((data?.cameras || []).map((c) => c.deviceId)), [data]);
    const unplaced = devices.filter((d) => !placedIds.has(d.id));

    if (!data) return <div className="h-full w-full flex items-center justify-center text-muted-foreground"><Loader2 className="animate-spin mr-2" size={18} /> Cargando mapa…</div>;

    const lotes = data.lotes || [];

    const onMapClick = (ll: LL) => {
        if (!editing) return;
        if (tool === "perimeter") setDraftPerimeter((p) => [...p, ll]);
        else if (tool === "lote") setDraftLote((p) => [...p, ll]);
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
    const removeCamera = (id: string) => setData((d) => d ? { ...d, cameras: d.cameras.filter((c) => c.deviceId !== id) } : d);
    const removeStreet = (id: string) => setData((d) => d ? { ...d, streets: d.streets.filter((s) => s.id !== id) } : d);
    const removeLote = async (id: string) => { const next = { ...data, lotes: (data.lotes || []).filter((l) => l.id !== id) }; await persistNow(next, "Lote eliminado"); };
    const renameStreet = (id: string) => { const n = window.prompt("Nombre de la calle:"); if (n != null) setData((d) => d ? { ...d, streets: d.streets.map((s) => s.id === id ? { ...s, name: n } : s) } : d); };
    const editLote = (id: string) => { const l = lotes.find((x) => x.id === id); if (l) setLoteModal({ mode: "edit", id, name: l.name || "", parkingSlotId: l.parkingSlotId || "", points: l.points }); };
    const deleteSelected = () => { if (!selected) return; if (selected.type === "camera") removeCamera(selected.id); else if (selected.type === "street") removeStreet(selected.id); else removeLote(selected.id); setSelected(null); };

    // Guarda TODO el mapa (incluye lotes) en la DB al instante — sobrevive el reload.
    // Usa una API route (POST JSON) en vez de server action: los server actions daban
    // "unexpected response" a través del proxy; un POST normal pasa sin problemas.
    const persistNow = async (next: BarrioMapData, okMsg = "Guardado") => {
        const m = mapRef.current;
        const payload: BarrioMapData = { ...next, center: m ? [m.getCenter().lat, m.getCenter().lng] : next.center, zoom: m ? m.getZoom() : next.zoom };
        setData(payload);
        try {
            const r = await fetch("/api/barriomap", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
            const j = await r.json().catch(() => ({}));
            if (r.ok && j.ok) toast.success({ title: okMsg });
            else toast.error({ title: "Error al guardar", description: j.error || `HTTP ${r.status}` });
        } catch (e: any) { toast.error({ title: "Error al guardar", description: String(e?.message || e) }); }
    };

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

    const openCtx = (e: any, type: SelKind, id: string) => {
        const oe = e.originalEvent || e; oe.preventDefault?.(); oe.stopPropagation?.();
        setCtx({ x: oe.clientX, y: oe.clientY, type, id });
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
        const cam = data.cameras.find((c) => (devById[c.deviceId]?.name || "").toUpperCase().includes(s));
        if (cam) { mapRef.current.setView([cam.lat, cam.lng], Math.max(mapRef.current.getZoom(), 18)); return; }
        const lo = lotes.find((l) => (l.name || "").toUpperCase().includes(s));
        if (lo && lo.points.length) { mapRef.current.setView(centroid(lo.points), 19); return; }
        const st = data.streets.find((x) => (x.name || "").toUpperCase().includes(s));
        if (st && st.points.length) { mapRef.current.setView(st.points[Math.floor(st.points.length / 2)] as any, 18); return; }
        toast.error({ title: "Sin coincidencias", description: "No encontré esa cámara, lote o calle." });
    };

    const tools: { id: Tool; icon: any; label: string }[] = [
        { id: "select", icon: MousePointer2, label: "Seleccionar" },
        { id: "lote", icon: LandPlot, label: "Dibujar lote" },
        { id: "perimeter", icon: Hexagon, label: "Dibujar perímetro" },
        { id: "camera", icon: Video, label: "Soltar cámara" },
    ];
    const fondos: Base[] = ["Híbrido", "Táctico", "Satélite", "Calles"];
    const capas: { key: keyof typeof show; label: string; Icon: any }[] = [
        { key: "cameras", label: "Cámaras", Icon: CamIco },
        { key: "lotes", label: "Lotes", Icon: LoteIco },
        { key: "perimeter", label: "Perímetro", Icon: PerimIco },
        { key: "guards", label: "Guardias", Icon: GuardIco },
        { key: "names", label: "Nombres", Icon: TypeIco },
    ];
    const gbtn = "h-9 w-9 flex items-center justify-center rounded-xl text-muted-foreground hover:text-foreground hover:bg-white/10 transition-colors disabled:opacity-30";

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
                .map-tactico .leaflet-tile-pane{filter:grayscale(.65) contrast(1.05) brightness(.72)}
                .omni-reticula{position:absolute;inset:0;pointer-events:none;z-index:400;background-image:linear-gradient(rgba(255,255,255,.04) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.04) 1px,transparent 1px);background-size:44px 44px}
                .omni-vineta{position:absolute;inset:0;pointer-events:none;z-index:400;box-shadow:inset 0 0 200px 40px rgba(0,0,0,.55)}
            `}</style>
            <div ref={wrapRef} className={cn("relative h-full w-full bg-black", base === "Táctico" && "map-tactico")}>
                <MapContainer center={data.center} zoom={data.zoom} className="h-full w-full z-0" zoomControl={false} scrollWheelZoom>
                    <MapRefGrabber onMap={(m) => (mapRef.current = m)} />
                    {editing && tool !== "select" && <ClickHandler onClick={onMapClick} />}

                    {/* Fondos */}
                    {(base === "Satélite" || base === "Híbrido") && (
                        <TileLayer key="esri" attribution="&copy; Esri" url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}" maxNativeZoom={19} maxZoom={21} />
                    )}
                    {(base === "Calles" || base === "Táctico") && (
                        <TileLayer key="osm" attribution="&copy; OpenStreetMap" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" maxNativeZoom={19} maxZoom={21} />
                    )}
                    {base === "Híbrido" && (
                        <TileLayer key="labels" attribution="&copy; CARTO" url="https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}{r}.png" subdomains="abcd" maxNativeZoom={20} maxZoom={21} />
                    )}

                    {show.perimeter && data.perimeter.length >= 3 && <Polygon positions={data.perimeter} pathOptions={{ color: "#22c55e", weight: 2, fillOpacity: 0.08 }} />}
                    {draftPerimeter.length > 0 && <Polyline positions={draftPerimeter} pathOptions={{ color: "#22c55e", weight: 2, dashArray: "6 6" }} />}

                    {/* Lotes */}
                    {show.lotes && lotes.map((lo) => (
                        <Polygon key={lo.id} positions={lo.points}
                            pathOptions={{ color: selected?.id === lo.id ? "#f59e0b" : lo.parkingSlotId ? "#22c55e" : "#a855f7", weight: selected?.id === lo.id ? 3 : 1.5, fillColor: lo.parkingSlotId ? "#22c55e" : "#a855f7", fillOpacity: selected?.id === lo.id ? 0.3 : 0.14 }}
                            eventHandlers={{
                                click: () => editing && tool === "select" && setSelected({ type: "lote", id: lo.id }),
                                dblclick: () => editing && editLote(lo.id),
                                contextmenu: (e) => openCtx(e, "lote", lo.id),
                            }}>
                            {lo.name && show.names && <LTooltip permanent direction="center" className="lote-tip">{lo.name}</LTooltip>}
                        </Polygon>
                    ))}
                    {draftLote.length > 0 && <Polygon positions={draftLote} pathOptions={{ color: "#a855f7", weight: 2, dashArray: "6 6", fillOpacity: 0.1 }} />}

                    {data.streets.map((s) => (
                        <Polyline key={s.id} positions={s.points}
                            pathOptions={{ color: selected?.id === s.id ? "#f59e0b" : "#38bdf8", weight: selected?.id === s.id ? 6 : 4, opacity: 0.9 }}
                            eventHandlers={{
                                click: () => editing && tool === "select" && setSelected({ type: "street", id: s.id }),
                                contextmenu: (e) => openCtx(e, "street", s.id),
                            }}>
                            {s.name && show.names && <LTooltip sticky className="cam-name-tip">{s.name}</LTooltip>}
                        </Polyline>
                    ))}

                    {show.guards && guards.map((g) => (
                        <Marker key={"g" + g.id} position={[g.lat, g.lng]}
                            icon={L.divIcon({ className: "bg-transparent border-0", html: guardIconHtml(g.guardName || g.name || "Guardia", g.heading), iconSize: [60, 52], iconAnchor: [30, 44] })}>
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

                    {show.cameras && data.cameras.map((c) => (
                        <Marker key={c.deviceId} position={[c.lat, c.lng]} icon={camIcon}
                            eventHandlers={{
                                click: () => { if (editing && tool === "select") setSelected({ type: "camera", id: c.deviceId }); },
                                contextmenu: (e) => openCtx(e, "camera", c.deviceId),
                            }}>
                            {show.names && <LTooltip permanent direction="top" offset={[0, -22]} className="cam-name-tip">{devById[c.deviceId]?.name || "Cámara"}</LTooltip>}
                            {!editing && (
                                <Popup className="cam-live-popup" maxWidth={280} minWidth={260}>
                                    <div className="rounded-lg overflow-hidden">
                                        <LiveMp4 deviceId={c.deviceId} className="block w-[260px] h-[150px] object-cover bg-black" />
                                        <div className="px-2 py-1 bg-black/80 text-white text-[11px] font-bold flex items-center gap-1.5"><Radio size={11} className="text-red-400" /> {devById[c.deviceId]?.name || "Cámara"}</div>
                                    </div>
                                </Popup>
                            )}
                        </Marker>
                    ))}
                    <FlowAnims anims={flow.anims} pulses={flow.pulses} onDone={flow.onDone} />

                    {/* Burbujas de video en vivo sobre cada cámara (fijables/desacoplables) */}
                    {vivoTodas && !editing && (
                        <BurbujasVivo
                            camaras={data.cameras.filter((c) => !ocultas.includes(c.deviceId))}
                            nombre={(id) => devById[id]?.name || "Cámara"}
                            onCerrarUna={(id) => setOcultas((o) => [...o, id])}
                        />
                    )}
                </MapContainer>

                {oscura && <><div className="omni-reticula" /><div className="omni-vineta" /></>}

                {/* Columnas de flujo en vivo */}
                {!editing && (
                    <>
                        <FlowColumn side="left" title="Entradas" icon={LogIn} accent="emerald" events={flow.entries} onPick={(ev) => flow.animateEvent(ev)} />
                        <FlowColumn side="right" title="Salidas" icon={LogOut} accent="orange" events={flow.exits} onPick={(ev) => flow.animateEvent(ev)} />
                    </>
                )}

                {/* ── Barra superior glass (estilo San Nicolás) ── */}
                <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[530] flex flex-col items-center">
                    <div className="flex items-center gap-1 bg-card/90 backdrop-blur-2xl border border-border rounded-2xl shadow-2xl p-1.5">
                        {/* Capas */}
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
                                <div className="w-px h-6 bg-border mx-0.5" />
                                <Tooltip><TooltipTrigger asChild><button onClick={deleteSelected} disabled={!selected} className={cn(gbtn, selected && "text-red-400 hover:text-red-300 hover:bg-red-500/10")}><Trash2 size={16} /></button></TooltipTrigger><TooltipContent>Borrar seleccionado</TooltipContent></Tooltip>
                                <button onClick={save} disabled={saving} className="h-9 px-3.5 ml-0.5 flex items-center gap-1.5 rounded-xl text-xs font-bold bg-blue-600 text-white hover:bg-blue-500 transition-colors">{saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Guardar</button>
                                <button onClick={() => { setEditing(false); setTool("select"); setDraftPerimeter([]); setDraftLote([]); setSelected(null); getBarrioMap().then(setData); }} className={gbtn}><X size={16} /></button>
                            </>
                        ) : (
                            <>
                                <Tooltip><TooltipTrigger asChild><button onClick={() => acercar(1)} className={gbtn}><Plus size={16} /></button></TooltipTrigger><TooltipContent>Acercar</TooltipContent></Tooltip>
                                <Tooltip><TooltipTrigger asChild><button onClick={() => acercar(-1)} className={gbtn}><Minus size={16} /></button></TooltipTrigger><TooltipContent>Alejar</TooltipContent></Tooltip>
                                <Tooltip><TooltipTrigger asChild><button onClick={centrar} className={gbtn}><Crosshair size={16} /></button></TooltipTrigger><TooltipContent>Centrar en el barrio</TooltipContent></Tooltip>
                                <Tooltip><TooltipTrigger asChild><button onClick={toggleVivo} disabled={!data.cameras.length} className={cn(gbtn, vivoTodas && "bg-red-600 text-white hover:bg-red-500 hover:text-white")}>{vivoTodas ? <EyeOff size={16} /> : <Eye size={16} />}</button></TooltipTrigger><TooltipContent>{vivoTodas ? "Apagar las cámaras en vivo" : "Ver todas las cámaras en vivo"}</TooltipContent></Tooltip>
                                <Tooltip><TooltipTrigger asChild><button onClick={alternarPantalla} className={gbtn}>{pantalla ? <Minimize2 size={16} /> : <Maximize2 size={16} />}</button></TooltipTrigger><TooltipContent>{pantalla ? "Salir de pantalla completa" : "Pantalla completa"}</TooltipContent></Tooltip>
                                <div className="w-px h-6 bg-border mx-0.5" />
                                <button onClick={() => { setMenuCapas(false); setVivoTodas(false); setEditing(true); }} className="h-9 px-3.5 flex items-center gap-1.5 rounded-xl text-xs font-bold bg-blue-600 text-white hover:bg-blue-500 transition-colors"><Pencil size={14} /> Editar mapa</button>
                            </>
                        )}
                    </div>

                    {/* Menú de capas colgado de la barra */}
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
                                placeholder="Cámara, lote o calle…" className="flex-1 bg-transparent outline-none text-sm font-medium placeholder:text-muted-foreground/60" />
                            {q && <button onClick={() => setQ("")} className="text-muted-foreground hover:text-foreground"><X size={15} /></button>}
                        </div>
                    </div>
                )}

                {/* Contextual editing panel */}
                {editing && (
                    <div className="absolute bottom-4 left-4 z-[500] bg-card/95 backdrop-blur border border-border rounded-xl shadow-lg p-3 w-64 text-xs space-y-2">
                        {tool === "lote" && (<>
                            <p className="font-bold flex items-center gap-1.5"><LandPlot size={13} className="text-purple-400" /> Lote</p>
                            <p className="text-muted-foreground">Clic en el mapa para marcar las esquinas del lote ({draftLote.length}). Al cerrar te pido el nombre y la plaza.</p>
                            <div className="flex gap-2"><button onClick={commitLote} disabled={draftLote.length < 3} className="flex-1 py-1.5 rounded-md bg-purple-600 text-white font-bold disabled:opacity-40 flex items-center justify-center gap-1"><Check size={13} /> Cerrar lote</button><button onClick={() => setDraftLote((p) => p.slice(0, -1))} className="px-2 py-1.5 rounded-md bg-accent"><Undo2 size={13} /></button></div>
                        </>)}
                        {tool === "perimeter" && (<>
                            <p className="font-bold flex items-center gap-1.5"><Hexagon size={13} className="text-emerald-400" /> Perímetro</p>
                            <p className="text-muted-foreground">Clic en el mapa para agregar vértices ({draftPerimeter.length}).</p>
                            <div className="flex gap-2"><button onClick={commitPerimeter} disabled={draftPerimeter.length < 3} className="flex-1 py-1.5 rounded-md bg-emerald-600 text-white font-bold disabled:opacity-40 flex items-center justify-center gap-1"><Check size={13} /> Cerrar</button><button onClick={() => setDraftPerimeter((p) => p.slice(0, -1))} className="px-2 py-1.5 rounded-md bg-accent"><Undo2 size={13} /></button></div>
                        </>)}
                        {tool === "camera" && (<>
                            <p className="font-bold flex items-center gap-1.5"><Video size={13} className="text-blue-400" /> Soltar cámara</p>
                            <select value={pendingCam} onChange={(e) => setPendingCam(e.target.value)} className="w-full bg-background border border-border rounded-md px-2 py-1.5">
                                <option value="">Elegí una cámara…</option>
                                {unplaced.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                            </select>
                            <p className="text-muted-foreground">{pendingCam ? "Clic en el mapa para ubicarla." : `Ubicadas: ${placedIds.size}`}</p>
                        </>)}
                        {tool === "select" && (<p className="text-muted-foreground flex items-center gap-1.5"><MapPin size={13} /> {selected ? `Seleccionado: ${selected.type === "camera" ? (devById[selected.id]?.name || "cámara") : selected.type === "lote" ? (lotes.find((l) => l.id === selected.id)?.name || "lote") : "calle"}` : "Tocá un lote (doble clic para editar) o cámara · clic derecho para menú."}</p>)}
                    </div>
                )}

                {/* Context menu */}
                {ctx && (
                    <div className="fixed z-[600] bg-popover border border-border rounded-lg shadow-xl py-1 text-xs min-w-[170px]" style={{ left: ctx.x, top: ctx.y }} onClick={(e) => e.stopPropagation()}>
                        {ctx.type === "camera" ? (<>
                            <button onClick={() => { const cam = data.cameras.find((c) => c.deviceId === ctx.id); if (cam && mapRef.current) mapRef.current.setView([cam.lat, cam.lng], Math.max(mapRef.current.getZoom(), 18)); setCtx(null); }} className="w-full text-left px-3 py-1.5 hover:bg-accent flex items-center gap-2"><Radio size={13} className="text-red-400" /> Centrar / ver</button>
                            {editing && <button onClick={() => { removeCamera(ctx.id); setCtx(null); }} className="w-full text-left px-3 py-1.5 hover:bg-accent flex items-center gap-2 text-red-400"><Trash2 size={13} /> Quitar del mapa</button>}
                        </>) : ctx.type === "lote" ? (<>
                            <button onClick={() => { editLote(ctx.id); setCtx(null); }} className="w-full text-left px-3 py-1.5 hover:bg-accent flex items-center gap-2"><PencilIcon size={13} /> Editar lote / plaza</button>
                            <button onClick={() => { removeLote(ctx.id); setCtx(null); }} className="w-full text-left px-3 py-1.5 hover:bg-accent flex items-center gap-2 text-red-400"><Trash2 size={13} /> Borrar lote</button>
                        </>) : (<>
                            <button onClick={() => { renameStreet(ctx.id); setCtx(null); }} className="w-full text-left px-3 py-1.5 hover:bg-accent flex items-center gap-2"><PencilIcon size={13} /> Renombrar calle</button>
                            {editing && <button onClick={() => { removeStreet(ctx.id); setCtx(null); }} className="w-full text-left px-3 py-1.5 hover:bg-accent flex items-center gap-2 text-red-400"><Trash2 size={13} /> Borrar calle</button>}
                        </>)}
                    </div>
                )}

                {/* Modal de lote (nombre + vínculo a plaza de parking) */}
                {loteModal && (
                    <div className="fixed inset-0 z-[620] bg-black/60 backdrop-blur-sm flex items-center justify-center p-5" onClick={() => setLoteModal(null)}>
                        <div className="bg-card border border-border rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
                            <div className="flex items-center justify-between px-5 py-3 border-b border-border">
                                <div className="flex items-center gap-2"><LandPlot size={16} className="text-purple-400" /><span className="text-sm font-bold text-foreground">{loteModal.mode === "create" ? "Nuevo lote" : "Editar lote"}</span></div>
                                <button onClick={() => setLoteModal(null)} className="h-8 w-8 rounded-lg hover:bg-accent flex items-center justify-center text-muted-foreground"><X size={16} /></button>
                            </div>
                            <div className="p-4 space-y-3">
                                <div>
                                    <label className="text-[11px] font-bold text-muted-foreground uppercase tracking-wide">Nombre / número</label>
                                    <input autoFocus value={loteModal.name} onChange={(e) => setLoteModal((m) => m ? { ...m, name: e.target.value } : m)} onKeyDown={(e) => { if (e.key === "Enter") saveLoteModal(); }}
                                        placeholder="Ej: Lote 12" className="mt-1 w-full bg-background border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500" />
                                </div>
                                <div>
                                    <label className="text-[11px] font-bold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5"><SquareParking size={13} /> Plaza de parking</label>
                                    <select value={loteModal.parkingSlotId} onChange={(e) => setLoteModal((m) => m ? { ...m, parkingSlotId: e.target.value } : m)}
                                        className="mt-1 w-full bg-background border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500">
                                        <option value="">— Sin vincular —</option>
                                        {slots.map((s: any) => <option key={s.id} value={s.id}>{s.label}{s.user?.name ? ` · ${s.user.name}` : ""}</option>)}
                                    </select>
                                    <p className="mt-1 text-[10px] text-muted-foreground">Vinculá el lote a una plaza para reflejar ocupación y residente.</p>
                                </div>
                            </div>
                            <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border">
                                <button onClick={() => setLoteModal(null)} className="px-3 py-1.5 rounded-lg text-xs font-bold text-muted-foreground hover:bg-accent">Cancelar</button>
                                <button onClick={saveLoteModal} className="px-4 py-1.5 rounded-lg text-xs font-bold bg-blue-600 text-white hover:bg-blue-500 flex items-center gap-1.5"><Check size={14} /> Guardar</button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </TooltipProvider>
    );
}
