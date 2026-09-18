"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
const Mapa3D = dynamic(() => import("@/components/mapa/Mapa3D"), { ssr: false });
import { motion } from "framer-motion";
import { CapaRecorrido, PanelRecorrido, useRecorrido, type Lugar } from "@/components/mapa/Recorrido";
import { MapContainer, TileLayer, Polygon, Polyline, Marker, Popup, Tooltip as LTooltip, Pane, useMap, useMapEvents } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import {
    MousePointer2, Hexagon, Spline, Video, Trash2, Save, Pencil, X, Check,
    Loader2, MapPin, Undo2, Map as MapIco, Radio, Pencil as PencilIcon,
    Plus, Minus, Crosshair, Maximize2, Minimize2, Eye, EyeOff, ShieldCheck, Route as RouteIco,
    Layers3, ChevronDown, Pentagon, Home, Search,
} from "lucide-react";
import { AnimatePresence } from "framer-motion";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { sileo as toast } from "sileo";
import { getBarrioMap, saveBarrioMap, type BarrioMapData } from "@/app/actions/barriomap";
import { io } from "socket.io-client";
import { getSocketUrl } from "@/lib/socket-config";
import { FlowAnims, FlowColumn, useFlow } from "@/components/barrio/FlowLayer";
import { LogIn, LogOut } from "lucide-react";
import { getDevices } from "@/app/actions/devices";
import { getUnits } from "@/app/actions/units";

type Tool = "select" | "perimeter" | "street" | "camera" | "lote";
type LL = [number, number];

const camSvg = `
<div style="display:flex;flex-direction:column;align-items:center;transform:translateY(-4px)">
  <span class="cam-glyph" style="width:30px;height:30px;border-radius:8px;background:#2563eb;border:2px solid #fff;display:flex;align-items:center;justify-content:center;box-shadow:0 3px 6px rgba(0,0,0,.4)">
    <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m22 8-6 4 6 4V8Z"/><rect width="14" height="12" x="2" y="6" rx="2" ry="2"/></svg>
  </span>
</div>`;
const camIcon = L.divIcon({ className: "bg-transparent border-0", html: camSvg, iconSize: [30, 30], iconAnchor: [15, 22], popupAnchor: [0, -20] });

/** Manija de vértice: arrastrar mueve, clic derecho lo quita. */
const verticeHtml = `<span style="display:block;width:12px;height:12px;border-radius:50%;background:#fff;border:2px solid #f59e0b;box-shadow:0 1px 4px rgba(0,0,0,.6)"></span>`;

const guardIconHtml = (name: string, heading?: number | null) => `
<div style="display:flex;flex-direction:column;align-items:center;transform:translateY(-2px)">
  <span style="margin-bottom:2px;padding:1px 6px;border-radius:6px;background:rgba(16,185,129,.95);color:#fff;font-size:10px;font-weight:700;white-space:nowrap;box-shadow:0 2px 6px rgba(0,0,0,.4)">${name}</span>
  <span style="position:relative;width:30px;height:30px;border-radius:50%;background:#10b981;border:3px solid #fff;display:flex;align-items:center;justify-content:center;box-shadow:0 3px 8px rgba(0,0,0,.45)">
    ${heading != null ? `<span style="position:absolute;top:-9px;left:50%;transform:translateX(-50%) rotate(${Math.round(heading)}deg);transform-origin:50% 24px"><svg width="14" height="14" viewBox="0 0 24 24" fill="#10b981" stroke="#fff" stroke-width="1.5"><path d="M12 2 L19 21 L12 17 L5 21 Z"/></svg></span>` : ``}
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/></svg>
  </span>
</div>`;

function MapRefGrabber({ onMap }: { onMap: (m: L.Map) => void }) {
    const map = useMap();
    useEffect(() => { onMap(map); }, [map, onMap]);
    return null;
}
function ClickHandler({ onClick }: { onClick: (ll: LL) => void }) {
    useMapEvents({ click(e) { onClick([e.latlng.lat, e.latlng.lng]); } });
    return null;
}

function LiveMp4({ deviceId }: { deviceId: string }) {
    const ref = useRef<HTMLVideoElement>(null);
    const tries = useRef(0);
    const src = `/go2rtc/api/stream.mp4?src=lpr_${deviceId}_hd&video=h264`;
    useEffect(() => {
        const v = ref.current; if (!v) return; tries.current = 0;
        v.src = src; v.play().catch(() => {});
        const onErr = () => { tries.current++; if (tries.current > 4) return; setTimeout(() => { if (ref.current) { ref.current.src = src; ref.current.play().catch(() => {}); } }, 1400); };
        v.addEventListener("error", onErr);
        return () => { v.removeEventListener("error", onErr); try { v.pause(); v.removeAttribute("src"); v.load(); } catch {} };
    }, [deviceId]);
    return <video ref={ref} muted autoPlay playsInline className="block w-[260px] h-[150px] object-cover rounded-lg bg-black" />;
}

export default function BarrioMap() {
    const [data, setData] = useState<BarrioMapData | null>(null);
    // Capa base elegida: define el tratamiento de color del mapa.
    const [base, setBase] = useState<string>("Híbrido");
    const [vista3D, setVista3D] = useState(false);
    const rec = useRecorrido();
    const [devices, setDevices] = useState<any[]>([]);
    const [editing, setEditing] = useState(false);
    const [tool, setTool] = useState<Tool>("select");
    const [draftPerimeter, setDraftPerimeter] = useState<LL[]>([]);
    const [draftStreet, setDraftStreet] = useState<LL[]>([]);
    const [draftLote, setDraftLote] = useState<LL[]>([]);
    const [asignando, setAsignando] = useState<string | null>(null);   // id del lote
    const [unidades, setUnidades] = useState<any[]>([]);
    const [buscaUnidad, setBuscaUnidad] = useState("");
    const [pendingCam, setPendingCam] = useState<string>("");
    const [selected, setSelected] = useState<{ type: "street" | "camera" | "lote"; id: string } | null>(null);
    const [saving, setSaving] = useState(false);
    const [ctx, setCtx] = useState<{ x: number; y: number; type: "street" | "camera" | "lote"; id: string } | null>(null);
    const mapRef = useRef<L.Map | null>(null);
    const [guards, setGuards] = useState<any[]>([]);
    // Usabilidad: capas que se pueden apagar y pantalla completa.
    const [verCapa, setVerCapa] = useState({ camaras: true, calles: true, lotes: true, perimetro: true, guardias: true });
    const [menuCapas, setMenuCapas] = useState(false);
    const [ayuda3D, setAyuda3D] = useState(false);
    const [pantallaCompleta, setPantallaCompleta] = useState(false);
    const contenedorRef = useRef<HTMLDivElement | null>(null);
    const [liveSocket, setLiveSocket] = useState<any>(null);

    // GPS de guardias en vivo (tablets PWA /guard) via socket
    useEffect(() => {
        const s = io(window.location.origin, { path: "/io/socket.io", transports: ["polling"], reconnection: true, reconnectionAttempts: Infinity, reconnectionDelay: 1000, reconnectionDelayMax: 8000 });
        s.on("guard_locations", (data: any[]) => setGuards(Array.isArray(data) ? data.filter((g) => g.lat != null) : []));
        s.on("connect", () => s.emit("get_guard_locations"));
        setLiveSocket(s);
        const iv = setInterval(() => { if (s.connected) s.emit("get_guard_locations"); }, 30000);
        return () => { clearInterval(iv); setLiveSocket(null); s.disconnect(); };
    }, []);

    useEffect(() => {
        getBarrioMap().then(setData).catch(() => setData(null));
        getDevices().then((d: any) => setDevices((d || []).filter((x: any) => x.deviceType === "LPR_CAMERA" || x.deviceType === "LPR_INTERIOR"))).catch(() => {});
        getUnits().then((u: any) => setUnidades(u || [])).catch(() => { });
    }, []);
    useEffect(() => {
        const close = () => { setCtx(null); setMenuCapas(false); };
        window.addEventListener("click", close);
        return () => window.removeEventListener("click", close);
    }, []);

    // La capa se recuerda: primero la guardada en el mapa (vale para todos),
    // y si no hay, la ultima que eligio este navegador.
    useEffect(() => {
        const guardada = (data as any)?.base;
        if (guardada) { setBase(guardada); return; }
        try { const g = localStorage.getItem("omni-mapa-capa"); if (g) setBase(g); } catch { }
    }, [data]);
    useEffect(() => {
        try { localStorage.setItem("omni-mapa-capa", base); } catch { }
    }, [base]);

    // Atajos: "/" o Ctrl/Cmd+K enfocan el buscador de abajo (hay uno solo);
    // Esc cierra el menú de capas y el menú contextual.
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            const enCampo = ["INPUT", "TEXTAREA", "SELECT"].includes((e.target as HTMLElement)?.tagName || "");
            if ((e.key === "/" && !enCampo) || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k")) {
                e.preventDefault();
                const campo = contenedorRef.current?.querySelector<HTMLInputElement>('input[placeholder^="Matrícula"]');
                campo?.focus();
            }
            if (e.key === "Escape") { setMenuCapas(false); setCtx(null); }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, []);

    // La ayuda de la vista 3D se muestra unos segundos y se va sola.
    useEffect(() => {
        if (!vista3D) { setAyuda3D(false); return; }
        setAyuda3D(true);
        const t = setTimeout(() => setAyuda3D(false), 7000);
        return () => clearTimeout(t);
    }, [vista3D]);

    useEffect(() => {
        const onFs = () => setPantallaCompleta(!!document.fullscreenElement);
        document.addEventListener("fullscreenchange", onFs);
        return () => document.removeEventListener("fullscreenchange", onFs);
    }, []);

    const devById = useMemo(() => Object.fromEntries(devices.map((d) => [d.id, d])), [devices]);
    // Flujo en vivo (columnas + autitos) — hooks siempre antes del early-return
    const camsNamed = useMemo(() => (data?.cameras || []).map((c) => ({ ...c, name: (devById as any)[c.deviceId]?.name })), [data, devById]);
    const flow = useFlow(data?.streets || [], camsNamed, liveSocket);
    const placedIds = useMemo(() => new Set((data?.cameras || []).map((c) => c.deviceId)), [data]);
    const unplaced = devices.filter((d) => !placedIds.has(d.id));

    if (!data) return <div className="h-full w-full flex items-center justify-center text-muted-foreground"><Loader2 className="animate-spin mr-2" size={18} /> Cargando mapa…</div>;

    const onMapClick = (ll: LL) => {
        if (!editing) return;
        if (tool === "perimeter") setDraftPerimeter((p) => [...p, ll]);
        else if (tool === "street") setDraftStreet((p) => [...p, ll]);
        else if (tool === "lote") setDraftLote((p) => [...p, ll]);
        else if (tool === "camera") {
            if (!pendingCam) { toast.error({ title: "Elegí una cámara primero" }); return; }
            setData((d) => d ? { ...d, cameras: [...d.cameras.filter((c) => c.deviceId !== pendingCam), { deviceId: pendingCam, lat: ll[0], lng: ll[1] }] } : d);
            setPendingCam(""); setTool("select");
        }
    };
    const commitPerimeter = () => { if (draftPerimeter.length >= 3) setData((d) => d ? { ...d, perimeter: draftPerimeter } : d); setDraftPerimeter([]); setTool("select"); };
    const commitStreet = () => { if (draftStreet.length >= 2) setData((d) => d ? { ...d, streets: [...d.streets, { id: `s_${Date.now()}`, points: draftStreet }] } : d); setDraftStreet([]); setTool("select"); };
    const lotes = data.lots || [];
    const commitLote = () => {
        if (draftLote.length >= 3) {
            const nombre = window.prompt("Nombre de la casa o lote:", `Lote ${lotes.length + 1}`);
            setData((d) => d ? { ...d, lots: [...(d.lots || []), { id: `l_${Date.now()}`, label: (nombre || `Lote ${lotes.length + 1}`).trim(), unitId: null, points: draftLote }] } : d);
        }
        setDraftLote([]); setTool("select");
    };
    const removeLote = (id: string) => setData((d) => d ? { ...d, lots: (d.lots || []).filter((l) => l.id !== id) } : d);
    const renameLote = (id: string) => {
        const actual = lotes.find((l) => l.id === id);
        const n = window.prompt("Nombre de la casa o lote:", actual?.label || "");
        if (n != null) setData((d) => d ? { ...d, lots: (d.lots || []).map((l) => l.id === id ? { ...l, label: n.trim() } : l) } : d);
    };
    const asignarUnidad = (loteId: string, unitId: string | null) => {
        setData((d) => d ? { ...d, lots: (d.lots || []).map((l) => l.id === loteId ? { ...l, unitId } : l) } : d);
        setAsignando(null); setBuscaUnidad("");
    };
    const moverVertice = (loteId: string, idx: number, ll: LL) => {
        setData((d) => d ? { ...d, lots: (d.lots || []).map((l) => l.id === loteId ? { ...l, points: l.points.map((p, i) => i === idx ? ll : p) } : l) } : d);
    };
    const quitarVertice = (loteId: string, idx: number) => {
        setData((d) => d ? { ...d, lots: (d.lots || []).map((l) => l.id === loteId && l.points.length > 3 ? { ...l, points: l.points.filter((_, i) => i !== idx) } : l) } : d);
    };
    /** Unidad asignada a un lote, para el cartel y el panel. */
    const unidadDe = (unitId?: string | null) => unidades.find((u: any) => u.id === unitId);

    const removeCamera = (id: string) => setData((d) => d ? { ...d, cameras: d.cameras.filter((c) => c.deviceId !== id) } : d);
    const removeStreet = (id: string) => setData((d) => d ? { ...d, streets: d.streets.filter((s) => s.id !== id) } : d);
    const renameStreet = (id: string) => { const n = window.prompt("Nombre de la calle:"); if (n != null) setData((d) => d ? { ...d, streets: d.streets.map((s) => s.id === id ? { ...s, name: n } : s) } : d); };

    const deleteSelected = () => {
        if (!selected) return;
        if (selected.type === "camera") removeCamera(selected.id);
        else if (selected.type === "lote") removeLote(selected.id);
        else removeStreet(selected.id);
        setSelected(null);
    };

    const FILTROS: Record<string, string> = {
        "Táctico": "invert(1) hue-rotate(180deg) saturate(0.55) brightness(0.92) contrast(1.06)",
        "Híbrido": "saturate(0.45) contrast(1.22) brightness(0.82)",
        "Satélite": "saturate(0.72) contrast(1.08) brightness(0.94)",
        "Calles": "saturate(0.85)",
    };
    const oscura = base === "Táctico" || base === "Híbrido";

    const save = async () => {
        setSaving(true);
        const m = mapRef.current;
        // Guardamos tambien la capa elegida: al volver, el mapa abre igual a
        // como lo dejo el operador.
        const payload: BarrioMapData = {
            ...data,
            center: m ? [m.getCenter().lat, m.getCenter().lng] : data.center,
            zoom: m ? m.getZoom() : data.zoom,
            base,
        } as BarrioMapData;
        try { const r = await saveBarrioMap(payload); if (r.ok) { toast.success({ title: "Mapa guardado", description: `Vista, zoom y capa ${base} recordados` }); setData(payload); setEditing(false); setTool("select"); } else toast.error({ title: "Error al guardar", description: r.error || "sin detalle" }); }
        catch (e: any) { toast.error({ title: "Error al guardar", description: String(e?.message || e) }); } finally { setSaving(false); }
    };

    const openCtx = (e: any, type: "street" | "camera" | "lote", id: string) => {
        const oe = e.originalEvent || e; oe.preventDefault?.(); oe.stopPropagation?.();
        setCtx({ x: oe.clientX, y: oe.clientY, type, id });
    };

    // ── Controles del mapa ──────────────────────────────────────────────
    const acercar = (d: number) => { const m = mapRef.current; if (m) m.setZoom(m.getZoom() + d); };
    const centrarBarrio = () => {
        const m = mapRef.current; if (!m) return;
        if (data.perimeter.length >= 3) m.fitBounds(L.latLngBounds(data.perimeter as any), { padding: [60, 60] });
        else m.setView(data.center as any, data.zoom);
    };
    const alternarPantalla = async () => {
        try {
            if (document.fullscreenElement) await document.exitFullscreen();
            else await contenedorRef.current?.requestFullscreen();
        } catch { }
    };
    // Un solo buscador: lo que se escribe abajo sirve para matrículas y para
    // saltar a una cámara o a una calle.
    const lugares = (() => {
        const q = (rec.plate || "").trim().toLowerCase();
        if (q.length < 2) return [] as Lugar[];
        const cams = data.cameras
            .map((c) => ({ tipo: "camara" as const, id: c.deviceId, nombre: devById[c.deviceId]?.name || "Cámara", lat: c.lat, lng: c.lng }))
            .filter((c) => c.nombre.toLowerCase().includes(q));
        const calles = data.streets
            .filter((st) => (st.name || "").toLowerCase().includes(q) && st.points.length)
            .map((st) => ({ tipo: "calle" as const, id: st.id, nombre: st.name || "Calle", lat: st.points[Math.floor(st.points.length / 2)][0], lng: st.points[Math.floor(st.points.length / 2)][1] }));
        return [...cams, ...calles].slice(0, 6);
    })();

    const irALugar = (l: Lugar) => {
        setVista3D(false);
        mapRef.current?.flyTo([l.lat, l.lng], l.tipo === "camara" ? 19 : 18, { duration: 0.9 });
        rec.setPlate("");
    };

    const capas: { k: keyof typeof verCapa; label: string; icon: any }[] = [
        { k: "camaras", label: "Cámaras", icon: Video },
        { k: "calles", label: "Calles", icon: RouteIco },
        { k: "lotes", label: "Casas", icon: Pentagon },
        { k: "perimetro", label: "Perímetro", icon: Hexagon },
        { k: "guardias", label: "Guardias", icon: ShieldCheck },
    ];

    const tools: { id: Tool; icon: any; label: string }[] = [
        { id: "select", icon: MousePointer2, label: "Seleccionar" },
        { id: "perimeter", icon: Hexagon, label: "Dibujar perímetro" },
        { id: "street", icon: Spline, label: "Dibujar calle" },
        { id: "camera", icon: Video, label: "Soltar cámara" },
        { id: "lote", icon: Pentagon, label: "Dibujar casa / lote" },
    ];

    return (
        <TooltipProvider delayDuration={150}>
            <style>{`
                .cam-live-popup .leaflet-popup-content-wrapper{background:transparent;box-shadow:none;padding:0;border:0}
                .cam-live-popup .leaflet-popup-content{margin:0}
                .cam-live-popup .leaflet-popup-tip{display:none}
                .cam-live-popup a.leaflet-popup-close-button{color:#fff;top:4px;right:6px}
                .cam-name-tip{background:rgba(17,17,17,.85);color:#fff;border:0;box-shadow:none;font-size:10px;font-weight:700;padding:1px 6px;border-radius:6px}
                .cam-name-tip:before{display:none}

                /* ── Mapa táctico ── */
                .omni-barrio .leaflet-tile-pane{filter:${FILTROS[base] || 'none'};transition:filter .25s ease}
                .omni-barrio .leaflet-pane.omni-rotulos{filter:none !important;opacity:.95}
                .omni-barrio .leaflet-control-attribution{background:rgba(8,9,11,.6)!important;color:#8b8b93!important;font-size:9px}
                .omni-barrio .leaflet-control-attribution a{color:#9aa4b2!important}
                .omni-barrio .leaflet-control-layers{background:rgba(14,16,20,.92)!important;color:#e5e7eb!important;
                    border:1px solid rgba(148,163,184,.22)!important;border-radius:12px!important;
                    box-shadow:0 12px 30px -12px rgba(0,0,0,.8)!important;backdrop-filter:blur(10px)}
                .omni-barrio .leaflet-control-layers-toggle{background-color:rgba(14,16,20,.92)!important;border-radius:12px!important}
                .omni-barrio .leaflet-control-layers label{font-size:12px;font-weight:600;padding:3px 2px}
                .omni-barrio .leaflet-control-layers-separator{border-color:rgba(148,163,184,.2)}
                .omni-vineta{position:absolute;inset:0;pointer-events:none;z-index:400;
                    box-shadow:inset 0 0 170px 45px rgba(0,0,0,.55)}
                .omni-flujo{stroke-dasharray:14 16;animation:omniFlujo 1.15s linear infinite}
                @keyframes omniFlujo{to{stroke-dashoffset:-30}}
                .omni-vehiculo{filter:drop-shadow(0 0 10px rgba(251,191,36,.9))}
                .omni-punto-actual{filter:drop-shadow(0 0 7px rgba(251,191,36,.85));animation:omniLatido 1.8s ease-in-out infinite}
                @keyframes omniLatido{0%,100%{opacity:1}50%{opacity:.55}}
                .omni-sin-barra::-webkit-scrollbar{display:none}
                .omni-sin-barra{scrollbar-width:none}
                .omni-barrio .custom-scrollbar::-webkit-scrollbar{height:4px;width:4px}
                .omni-barrio .custom-scrollbar::-webkit-scrollbar-thumb{background:rgba(255,255,255,.18);border-radius:4px}
                .omni-reticula{position:absolute;inset:0;pointer-events:none;z-index:399;opacity:.14;
                    background-image:linear-gradient(rgba(148,163,184,.6) 1px,transparent 1px),
                                     linear-gradient(90deg,rgba(148,163,184,.6) 1px,transparent 1px);
                    background-size:130px 130px}
            `}</style>
            <div ref={contenedorRef} className="relative h-full w-full bg-[#07080a]">
                {vista3D ? (
                    <Mapa3D
                        center={data.center as [number, number]}
                        zoom={data.zoom}
                        perimeter={data.perimeter as [number, number][]}
                        streets={data.streets as any}
                        cameras={data.cameras.map((c: any) => ({ ...c, nombre: devices.find((d: any) => d.id === c.deviceId)?.name })) as any}
                        puntos={rec.puntos}
                        indice={rec.indice}
                    />
                ) : (
                <MapContainer center={data.center} zoom={data.zoom} maxZoom={21} className="h-full w-full z-0 omni-barrio" style={{ background: "#07080a" }} zoomControl={false} scrollWheelZoom>
                    <Pane name="omni-rotulos" style={{ zIndex: 350 }} />
                    {/* Capas: se eligen con el selector flotante, no con el control de Leaflet */}
                    {(base === "Táctico" || base === "Calles") && (
                        <TileLayer attribution="&copy; OpenStreetMap" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" maxNativeZoom={19} maxZoom={21} />
                    )}
                    {(base === "Híbrido" || base === "Satélite") && (
                        <TileLayer attribution="&copy; Esri" url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}" maxNativeZoom={19} maxZoom={21} />
                    )}
                    {base === "Híbrido" && (
                        <>
                            {/* Nombres de calles sobre la foto satelital. Las capas de
                                referencia de Esri no traen calles de barrio a este zoom,
                                asi que los rotulos salen de CARTO (OpenStreetMap). */}
                            <TileLayer pane="omni-rotulos"
                                attribution="&copy; OpenStreetMap &copy; CARTO"
                                url="https://{s}.basemaps.cartocdn.com/rastertiles/dark_only_labels/{z}/{x}/{y}{r}.png"
                                subdomains="abcd" maxNativeZoom={18} maxZoom={21} />
                        </>
                    )}

                    <MapRefGrabber onMap={(m) => (mapRef.current = m)} />
                    {editing && tool !== "select" && <ClickHandler onClick={onMapClick} />}

                    {verCapa.perimetro && data.perimeter.length >= 3 && <Polygon positions={data.perimeter} pathOptions={{ color: "#22c55e", weight: 2, fillOpacity: 0.08 }} />}
                    {draftPerimeter.length > 0 && <Polyline positions={draftPerimeter} pathOptions={{ color: "#22c55e", weight: 2, dashArray: "6 6" }} />}

                    {/* Casas / lotes: polígono, nombre y vértices arrastrables al editar */}
                    {(verCapa.lotes ? lotes : []).map((lo) => {
                        const sel = selected?.type === "lote" && selected.id === lo.id;
                        const uni = unidadDe(lo.unitId);
                        return (
                            <React.Fragment key={lo.id}>
                                <Polygon positions={lo.points}
                                    pathOptions={{
                                        color: sel ? "#f59e0b" : lo.unitId ? "#38bdf8" : "#94a3b8",
                                        weight: sel ? 3 : 2,
                                        fillColor: sel ? "#f59e0b" : lo.unitId ? "#38bdf8" : "#94a3b8",
                                        fillOpacity: sel ? 0.28 : 0.14,
                                    }}
                                    eventHandlers={{
                                        click: () => setSelected({ type: "lote", id: lo.id }),
                                        contextmenu: (e) => openCtx(e, "lote", lo.id),
                                    }}>
                                    <LTooltip direction="center" permanent className="cam-name-tip">
                                        {lo.label}{uni ? ` · ${uni.name}` : ""}
                                    </LTooltip>
                                </Polygon>
                                {editing && sel && lo.points.map((pt, i) => (
                                    <Marker key={i} position={pt} draggable
                                        icon={L.divIcon({ className: "bg-transparent border-0", html: verticeHtml, iconSize: [12, 12], iconAnchor: [6, 6] })}
                                        eventHandlers={{
                                            drag: (e: any) => { const ll = e.target.getLatLng(); moverVertice(lo.id, i, [ll.lat, ll.lng]); },
                                            contextmenu: (e: any) => { e.originalEvent?.preventDefault?.(); quitarVertice(lo.id, i); },
                                        }} />
                                ))}
                            </React.Fragment>
                        );
                    })}
                    {draftLote.length > 0 && (
                        <Polygon positions={draftLote} pathOptions={{ color: "#38bdf8", weight: 2, dashArray: "6 6", fillOpacity: 0.12 }} />
                    )}

                    {(verCapa.calles ? data.streets : []).map((s) => (
                        <Polyline key={s.id} positions={s.points}
                            pathOptions={{ color: selected?.id === s.id ? "#f59e0b" : "#38bdf8", weight: selected?.id === s.id ? 6 : 4, opacity: 0.9 }}
                            eventHandlers={{
                                click: () => editing && tool === "select" && setSelected({ type: "street", id: s.id }),
                                contextmenu: (e) => openCtx(e, "street", s.id),
                            }}>
                            {s.name && <LTooltip sticky className="cam-name-tip">{s.name}</LTooltip>}
                        </Polyline>
                    ))}
                    {draftStreet.length > 0 && <Polyline positions={draftStreet} pathOptions={{ color: "#38bdf8", weight: 4, dashArray: "6 6" }} />}

                    {(verCapa.guardias ? guards : []).map((g) => (
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

                    {(verCapa.camaras ? data.cameras : []).map((c) => (
                        <Marker key={c.deviceId} position={[c.lat, c.lng]} icon={camIcon}
                            eventHandlers={{
                                click: () => { if (editing && tool === "select") setSelected({ type: "camera", id: c.deviceId }); },
                                contextmenu: (e) => openCtx(e, "camera", c.deviceId),
                            }}>
                            <LTooltip permanent direction="top" offset={[0, -22]} className="cam-name-tip">{devById[c.deviceId]?.name || "Cámara"}</LTooltip>
                            {!editing && (
                                <Popup className="cam-live-popup" maxWidth={280} minWidth={260}>
                                    <div className="rounded-lg overflow-hidden">
                                        <LiveMp4 deviceId={c.deviceId} />
                                        <div className="px-2 py-1 bg-black/80 text-white text-[11px] font-bold flex items-center gap-1.5"><Radio size={11} className="text-red-400" /> {devById[c.deviceId]?.name || "Cámara"}</div>
                                    </div>
                                </Popup>
                            )}
                        </Marker>
                    ))}
                    <FlowAnims anims={flow.anims} pulses={flow.pulses} onDone={flow.onDone} />
                    <CapaRecorrido puntos={rec.puntos} indice={rec.indice} />
                </MapContainer>
                )}
                {!vista3D && oscura && <><div className="omni-reticula" /><div className="omni-vineta" /></>}
                <PanelRecorrido
                    puntos={rec.puntos} tramos={rec.tramos} cargando={rec.cargando} error={rec.error}
                    sinUbicacion={rec.sinUbicacion} plate={rec.plate} setPlate={rec.setPlate}
                    horas={rec.horas} setHoras={rec.setHoras} buscar={rec.buscar} limpiar={rec.limpiar}
                    indice={rec.indice} setIndice={rec.setIndice as any}
                    lugares={lugares} onIrA={irALugar}
                />

                {/* Columnas de flujo en vivo */}
                {!editing && (
                    <>
                        <FlowColumn side="left" title="Entradas" icon={LogIn} accent="emerald" events={flow.entries} onPick={(ev) => flow.animateEvent(ev)} />
                        <FlowColumn side="right" title="Salidas" icon={LogOut} accent="orange" events={flow.exits} onPick={(ev) => flow.animateEvent(ev)} />
                    </>
                )}

                {/* Toolbar pill */}
                <motion.div layout transition={{ type: "spring", stiffness: 420, damping: 34 }} className="absolute top-4 left-1/2 -translate-x-1/2 z-[530] flex items-center gap-1 flex-nowrap max-w-[calc(100%-1.5rem)] rounded-full px-1.5 py-1.5 bg-[#0a0d12]/80 backdrop-blur-2xl border border-white/[0.08] shadow-2xl shadow-black/50">
                    {/* Capas: un menú, disponible también al editar */}
                    <div className="relative shrink-0">
                        <motion.button whileTap={{ scale: 0.94 }} onClick={(e) => { e.stopPropagation(); setMenuCapas((v) => !v); }}
                            className={cn("flex items-center gap-1.5 h-8 px-3 rounded-full text-[11.5px] font-semibold transition-colors",
                                menuCapas ? "bg-white/[0.16] text-white" : "text-white/60 hover:text-white hover:bg-white/[0.1]")}>
                            <Layers3 size={14} />
                            {vista3D ? "Vista 3D" : base}
                            <ChevronDown size={12} className={cn("transition-transform", menuCapas && "rotate-180")} />
                        </motion.button>
                        <AnimatePresence>
                            {menuCapas && (
                                <motion.div initial={{ opacity: 0, y: -6, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -6, scale: 0.97 }}
                                    transition={{ type: "spring", stiffness: 460, damping: 34 }} onClick={(e) => e.stopPropagation()}
                                    className="absolute top-10 left-0 w-[188px] p-1.5 rounded-2xl bg-[#0a0d12]/92 backdrop-blur-2xl border border-white/[0.08] shadow-2xl shadow-black/60">
                                    <p className="px-2 pt-1 pb-1.5 text-[9px] font-bold uppercase tracking-[0.18em] text-white/35">Mapa de fondo</p>
                                    <div className="grid grid-cols-2 gap-0.5">
                                        {["Híbrido", "Táctico", "Satélite", "Calles"].map((nb) => (
                                            <button key={nb} onClick={() => { setBase(nb); setVista3D(false); }}
                                                className="relative h-7 rounded-lg text-[11px] font-semibold text-white/55 hover:text-white transition-colors">
                                                {base === nb && !vista3D && (
                                                    <motion.span layoutId="capa-activa" transition={{ type: "spring", stiffness: 420, damping: 34 }}
                                                        className="absolute inset-0 rounded-lg bg-white/[0.14]" />
                                                )}
                                                <span className={cn("relative", base === nb && !vista3D && "text-white")}>{nb}</span>
                                            </button>
                                        ))}
                                    </div>
                                    <button onClick={() => setVista3D((v) => !v)}
                                        className="relative w-full h-7 mt-0.5 rounded-lg text-[11px] font-bold text-white/55 hover:text-white transition-colors">
                                        {vista3D && ayuda3D && (
                                            <motion.span layoutId="capa-activa" transition={{ type: "spring", stiffness: 420, damping: 34 }}
                                                className="absolute inset-0 rounded-lg bg-sky-400/25" />
                                        )}
                                        <span className={cn("relative", vista3D && "text-sky-200")}>Vista 3D · girar e inclinar</span>
                                    </button>
                                    {!vista3D && (<>
                                        <span className="block h-px bg-white/[0.08] mx-1 my-1.5" />
                                        <p className="px-2 pb-1 text-[9px] font-bold uppercase tracking-[0.18em] text-white/35">Mostrar</p>
                                        {capas.map(({ k, label, icon: Ic }) => {
                                            const on = verCapa[k];
                                            return (
                                                <button key={k} onClick={() => setVerCapa((v) => ({ ...v, [k]: !v[k] }))}
                                                    className={cn("w-full flex items-center gap-2 h-7 px-2 rounded-lg text-[11px] font-semibold transition-colors",
                                                        on ? "text-white hover:bg-white/[0.08]" : "text-white/35 hover:text-white/70")}>
                                                    <Ic size={12} />
                                                    <span className="flex-1 text-left">{label}</span>
                                                    {on ? <Eye size={11} className="opacity-60" /> : <EyeOff size={11} className="opacity-60" />}
                                                </button>
                                            );
                                        })}
                                    </>)}
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>

                    <span className="w-px h-5 bg-white/10 mx-0.5 shrink-0" />

                    <div className="flex items-center gap-1 min-w-0 overflow-x-auto omni-sin-barra">
                    {/* Navegación: los mismos botones mirando o editando */}
                    {[
                        { ic: Plus, t: "Acercar", fn: () => acercar(1), off: vista3D },
                        { ic: Minus, t: "Alejar", fn: () => acercar(-1), off: vista3D },
                        { ic: Crosshair, t: "Centrar en el barrio", fn: centrarBarrio, off: vista3D },
                        { ic: pantallaCompleta ? Minimize2 : Maximize2, t: pantallaCompleta ? "Salir de pantalla completa" : "Pantalla completa", fn: alternarPantalla, off: false },
                    ].map(({ ic: Ic, t, fn, off }) => (
                        <Tooltip key={t}><TooltipTrigger asChild>
                            <motion.button whileTap={{ scale: 0.88 }} onClick={fn} disabled={off}
                                className={cn("w-8 h-8 rounded-full flex items-center justify-center transition-colors shrink-0",
                                    off ? "text-white/20" : "text-white/60 hover:text-white hover:bg-white/[0.12]")}>
                                <Ic size={15} />
                            </motion.button>
                        </TooltipTrigger><TooltipContent>{t}</TooltipContent></Tooltip>
                    ))}

                    <span className="w-px h-5 bg-white/10 mx-0.5 shrink-0" />

                    {editing && (
                        <>
                            {/* Herramientas de dibujo */}
                            {tools.map((t) => (
                                <Tooltip key={t.id}><TooltipTrigger asChild>
                                    <motion.button whileTap={{ scale: 0.88 }} onClick={() => { setTool(t.id); setSelected(null); }}
                                        className={cn("w-8 h-8 rounded-full flex items-center justify-center transition-colors shrink-0",
                                            tool === t.id ? "bg-blue-600 text-white" : "text-white/60 hover:text-white hover:bg-white/[0.12]")}>
                                        <t.icon size={15} />
                                    </motion.button>
                                </TooltipTrigger><TooltipContent>{t.label}</TooltipContent></Tooltip>
                            ))}
                            <Tooltip><TooltipTrigger asChild>
                                <motion.button whileTap={{ scale: 0.88 }} onClick={deleteSelected} disabled={!selected}
                                    className={cn("w-8 h-8 rounded-full flex items-center justify-center transition-colors shrink-0",
                                        selected ? "text-red-400 hover:bg-red-500/15" : "text-white/20")}>
                                    <Trash2 size={15} />
                                </motion.button>
                            </TooltipTrigger><TooltipContent>Borrar seleccionado</TooltipContent></Tooltip>

                        </>
                    )}
                    </div>

                    <span className="w-px h-5 bg-white/10 mx-0.5 shrink-0" />

                    {/* Acción principal: siempre en la misma punta de la barra */}
                    {!editing ? (
                        <Tooltip><TooltipTrigger asChild>
                            <button onClick={() => { setVista3D(false); setEditing(true); setMenuCapas(false); }}
                                className="flex items-center gap-2 h-8 px-3 rounded-full text-xs font-bold bg-blue-600 text-white hover:bg-blue-500 transition-colors shrink-0">
                                <Pencil size={14} /> Editar mapa
                            </button>
                        </TooltipTrigger><TooltipContent>Dibujar perímetro, calles y cámaras</TooltipContent></Tooltip>
                    ) : (
                        <>
                            <Tooltip><TooltipTrigger asChild>
                                <button onClick={save} disabled={saving}
                                    className="flex items-center gap-1.5 h-8 px-3 rounded-full text-xs font-bold bg-emerald-600 text-white hover:bg-emerald-500 transition-colors shrink-0 disabled:opacity-60">
                                    {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Guardar
                                </button>
                            </TooltipTrigger><TooltipContent>Guarda el dibujo, la vista y la capa elegida</TooltipContent></Tooltip>
                            <Tooltip><TooltipTrigger asChild>
                                <button onClick={() => { setEditing(false); setTool("select"); setDraftPerimeter([]); setDraftStreet([]); setDraftLote([]); setSelected(null); setAsignando(null); getBarrioMap().then(setData); }}
                                    className="w-8 h-8 rounded-full flex items-center justify-center text-white/50 hover:text-white hover:bg-white/[0.12] transition-colors shrink-0">
                                    <X size={15} />
                                </button>
                            </TooltipTrigger><TooltipContent>Salir sin guardar</TooltipContent></Tooltip>
                        </>
                    )}
                </motion.div>

                {/* Contextual editing panel */}
                {editing && (
                    <div className="absolute bottom-4 left-4 z-[500] bg-card/95 backdrop-blur border border-border rounded-xl shadow-lg p-3 w-64 text-xs space-y-2">
                        {tool === "perimeter" && (<>
                            <p className="font-bold flex items-center gap-1.5"><Hexagon size={13} className="text-emerald-400" /> Perímetro</p>
                            <p className="text-muted-foreground">Clic en el mapa para agregar vértices ({draftPerimeter.length}).</p>
                            <div className="flex gap-2"><button onClick={commitPerimeter} disabled={draftPerimeter.length < 3} className="flex-1 py-1.5 rounded-md bg-emerald-600 text-white font-bold disabled:opacity-40 flex items-center justify-center gap-1"><Check size={13} /> Cerrar</button><button onClick={() => setDraftPerimeter((p) => p.slice(0, -1))} className="px-2 py-1.5 rounded-md bg-accent"><Undo2 size={13} /></button></div>
                        </>)}
                        {tool === "street" && (<>
                            <p className="font-bold flex items-center gap-1.5"><Spline size={13} className="text-sky-400" /> Calle</p>
                            <p className="text-muted-foreground">Clic para trazar ({draftStreet.length} puntos).</p>
                            <div className="flex gap-2"><button onClick={commitStreet} disabled={draftStreet.length < 2} className="flex-1 py-1.5 rounded-md bg-sky-600 text-white font-bold disabled:opacity-40 flex items-center justify-center gap-1"><Check size={13} /> Finalizar</button><button onClick={() => setDraftStreet((p) => p.slice(0, -1))} className="px-2 py-1.5 rounded-md bg-accent"><Undo2 size={13} /></button></div>
                        </>)}
                        {tool === "camera" && (<>
                            <p className="font-bold flex items-center gap-1.5"><Video size={13} className="text-blue-400" /> Soltar cámara</p>
                            <select value={pendingCam} onChange={(e) => setPendingCam(e.target.value)} className="w-full bg-background border border-border rounded-md px-2 py-1.5">
                                <option value="">Elegí una cámara…</option>
                                {unplaced.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                            </select>
                            <p className="text-muted-foreground">{pendingCam ? "Clic en el mapa para ubicarla." : `Ubicadas: ${placedIds.size}`}</p>
                        </>)}
                        {tool === "lote" && (<>
                            <p className="font-bold flex items-center gap-1.5"><Pentagon size={13} className="text-sky-400" /> Casa / lote</p>
                            <p className="text-muted-foreground">Clic en el mapa para marcar las esquinas ({draftLote.length}). Con 3 o más, cerrá el contorno.</p>
                            <div className="flex gap-2"><button onClick={commitLote} disabled={draftLote.length < 3} className="flex-1 py-1.5 rounded-md bg-sky-600 text-white font-bold disabled:opacity-40 flex items-center justify-center gap-1"><Check size={13} /> Cerrar</button><button onClick={() => setDraftLote((p) => p.slice(0, -1))} className="px-2 py-1.5 rounded-md bg-accent"><Undo2 size={13} /></button></div>
                        </>)}
                        {tool === "select" && selected?.type === "lote" && (() => {
                            const lo = lotes.find((l) => l.id === selected.id);
                            const uni = unidadDe(lo?.unitId);
                            return (<>
                                <p className="font-bold flex items-center gap-1.5"><Pentagon size={13} className="text-amber-400" /> {lo?.label}</p>
                                <p className="text-muted-foreground">{uni ? `Unidad: ${uni.name}` : "Sin unidad asignada."}</p>
                                <p className="text-muted-foreground">Arrastrá los puntos blancos para ajustar el contorno; clic derecho sobre uno lo quita.</p>
                                <div className="flex gap-2">
                                    <button onClick={() => setAsignando(lo!.id)} className="flex-1 py-1.5 rounded-md bg-sky-600 text-white font-bold flex items-center justify-center gap-1"><Home size={13} /> {uni ? "Cambiar unidad" : "Asignar unidad"}</button>
                                    <button onClick={() => renameLote(lo!.id)} className="px-2 py-1.5 rounded-md bg-accent"><PencilIcon size={13} /></button>
                                </div>
                            </>);
                        })()}
                        {tool === "select" && selected?.type !== "lote" && (<p className="text-muted-foreground flex items-center gap-1.5"><MapPin size={13} /> {selected ? `Seleccionado: ${selected.type === "camera" ? (devById[selected.id]?.name || "cámara") : "calle"}` : "Tocá una casa, calle o cámara (o clic derecho para menú)."}</p>)}
                    </div>
                )}

                {/* Asignar una unidad al lote, igual que en plazas de parking */}
                <AnimatePresence>
                    {asignando && (() => {
                        const lo = lotes.find((l) => l.id === asignando);
                        const q = buscaUnidad.trim().toLowerCase();
                        const usadas: Record<string, string> = {};
                        for (const l of lotes) if (l.unitId && l.id !== asignando) usadas[l.unitId] = l.label;
                        const lista = unidades
                            .filter((u: any) => !q || `${u.name} ${u.number || ""} ${u.lot || ""} ${u.houseNumber || ""}`.toLowerCase().includes(q))
                            .slice(0, 60);
                        return (
                            <motion.div initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }}
                                transition={{ type: "spring", stiffness: 420, damping: 34 }}
                                className="absolute bottom-4 left-4 z-[560] w-72 rounded-2xl bg-[#0a0d12]/92 backdrop-blur-2xl border border-white/[0.08] shadow-2xl shadow-black/60 overflow-hidden">
                                <div className="flex items-center gap-2 px-3 h-11 border-b border-white/[0.07]">
                                    <Home size={14} className="text-sky-400 shrink-0" />
                                    <span className="text-[12px] font-bold text-white truncate flex-1">{lo?.label}</span>
                                    <button onClick={() => { setAsignando(null); setBuscaUnidad(""); }} className="text-white/40 hover:text-white"><X size={13} /></button>
                                </div>
                                <div className="flex items-center gap-2 px-3 h-10 border-b border-white/[0.07]">
                                    <Search size={13} className="text-white/35 shrink-0" />
                                    <input autoFocus value={buscaUnidad} onChange={(e) => setBuscaUnidad(e.target.value)}
                                        placeholder="Buscar unidad…"
                                        className="flex-1 bg-transparent text-[12px] text-white placeholder:text-white/30 focus:outline-none" />
                                </div>
                                <div className="max-h-64 overflow-y-auto custom-scrollbar">
                                    {lo?.unitId && (
                                        <button onClick={() => asignarUnidad(lo.id, null)}
                                            className="w-full text-left px-3 py-2 text-[11.5px] text-red-300 hover:bg-white/[0.08]">
                                            Quitar la unidad asignada
                                        </button>
                                    )}
                                    {lista.length === 0 ? (
                                        <p className="px-3 py-4 text-[11px] text-white/40">No hay unidades con ese nombre.</p>
                                    ) : lista.map((u: any) => {
                                        const ocupada = usadas[u.id];
                                        return (
                                            <button key={u.id} onClick={() => asignarUnidad(asignando!, u.id)}
                                                className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-white/[0.08] transition-colors">
                                                <span className="flex-1 min-w-0">
                                                    <span className="block text-[12px] text-white/90 truncate">{u.name}</span>
                                                    {(u.lot || u.houseNumber || u.address) && (
                                                        <span className="block text-[10px] text-white/35 truncate">{[u.lot, u.houseNumber, u.address].filter(Boolean).join(" · ")}</span>
                                                    )}
                                                </span>
                                                {ocupada && <span className="text-[9px] text-amber-300/80 shrink-0">ya en {ocupada}</span>}
                                                {lo?.unitId === u.id && <Check size={13} className="text-emerald-400 shrink-0" />}
                                            </button>
                                        );
                                    })}
                                </div>
                            </motion.div>
                        );
                    })()}
                </AnimatePresence>

                {/* Context menu */}
                {ctx && (
                    <div className="fixed z-[600] bg-popover border border-border rounded-lg shadow-xl py-1 text-xs min-w-[160px]" style={{ left: ctx.x, top: ctx.y }} onClick={(e) => e.stopPropagation()}>
                        {ctx.type === "lote" ? (<>
                            <button onClick={() => { setSelected({ type: "lote", id: ctx.id }); setAsignando(ctx.id); setCtx(null); }} className="w-full text-left px-3 py-1.5 hover:bg-accent flex items-center gap-2"><Home size={13} className="text-sky-400" /> Asignar unidad</button>
                            <button onClick={() => { renameLote(ctx.id); setCtx(null); }} className="w-full text-left px-3 py-1.5 hover:bg-accent flex items-center gap-2"><PencilIcon size={13} /> Renombrar</button>
                            <button onClick={() => { removeLote(ctx.id); setCtx(null); }} className="w-full text-left px-3 py-1.5 hover:bg-accent flex items-center gap-2 text-red-400"><Trash2 size={13} /> Borrar casa</button>
                        </>) : ctx.type === "camera" ? (<>
                            <button onClick={() => { const dev = devById[ctx.id]; if (dev && mapRef.current) { const cam = data.cameras.find((c) => c.deviceId === ctx.id); if (cam) mapRef.current.setView([cam.lat, cam.lng], Math.max(mapRef.current.getZoom(), 18)); } setCtx(null); }} className="w-full text-left px-3 py-1.5 hover:bg-accent flex items-center gap-2"><Radio size={13} className="text-red-400" /> Centrar / ver</button>
                            <button onClick={() => { removeCamera(ctx.id); setCtx(null); }} className="w-full text-left px-3 py-1.5 hover:bg-accent flex items-center gap-2 text-red-400"><Trash2 size={13} /> Quitar del mapa</button>
                        </>) : (<>
                            <button onClick={() => { renameStreet(ctx.id); setCtx(null); }} className="w-full text-left px-3 py-1.5 hover:bg-accent flex items-center gap-2"><PencilIcon size={13} /> Renombrar calle</button>
                            <button onClick={() => { removeStreet(ctx.id); setCtx(null); }} className="w-full text-left px-3 py-1.5 hover:bg-accent flex items-center gap-2 text-red-400"><Trash2 size={13} /> Borrar calle</button>
                        </>)}
                    </div>
                )}

                {/* Legend */}
                {!editing && <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} transition={{ type: "spring", stiffness: 420, damping: 34 }} className="absolute top-4 left-3 z-[520] hidden xl:flex rounded-2xl px-3 py-2 items-center gap-2 bg-[#0a0d12]/80 backdrop-blur-2xl border border-white/[0.08] shadow-2xl shadow-black/50">
                    <MapIco size={16} className="text-blue-400" />
                    <div><p className="text-xs font-bold leading-none">Mapa del barrio</p><p className="text-[10px] text-muted-foreground">{data.cameras.length} cámaras · {data.streets.length} calles · {lotes.length} casas · <span className={guards.length ? "text-emerald-500 font-bold" : ""}>{guards.length} guardias</span></p></div>
                </motion.div>}

                {vista3D && (
                    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                        className="absolute bottom-[104px] left-3 z-[520] rounded-2xl px-3 py-2 text-[10px] leading-relaxed text-white/60 bg-[#0a0d12]/80 backdrop-blur-2xl border border-white/[0.08] shadow-2xl shadow-black/50">
                        <b className="text-white/80">Vista 3D</b><br />
                        Arrastrar: mover · Ctrl + arrastrar: girar e inclinar<br />
                        Rueda: acercar · La edición se hace en la vista plana
                    </motion.div>
                )}
            </div>
        </TooltipProvider>
    );
}


