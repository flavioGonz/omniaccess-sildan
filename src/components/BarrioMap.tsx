"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, TileLayer, Polygon, Polyline, Marker, Popup, Tooltip as LTooltip, LayersControl, useMap, useMapEvents } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import {
    MousePointer2, Hexagon, Spline, Video, Trash2, Save, Pencil, X, Check,
    Loader2, MapPin, Undo2, Map as MapIco, Radio, Pencil as PencilIcon,
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { sileo as toast } from "sileo";
import { getBarrioMap, saveBarrioMap, type BarrioMapData } from "@/app/actions/barriomap";
import { io } from "socket.io-client";
import { getSocketUrl } from "@/lib/socket-config";
import { FlowAnims, FlowColumn, useFlow } from "@/components/barrio/FlowLayer";
import { LogIn, LogOut } from "lucide-react";
import { getDevices } from "@/app/actions/devices";

type Tool = "select" | "perimeter" | "street" | "camera";
type LL = [number, number];

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
    const [devices, setDevices] = useState<any[]>([]);
    const [editing, setEditing] = useState(false);
    const [tool, setTool] = useState<Tool>("select");
    const [draftPerimeter, setDraftPerimeter] = useState<LL[]>([]);
    const [draftStreet, setDraftStreet] = useState<LL[]>([]);
    const [pendingCam, setPendingCam] = useState<string>("");
    const [selected, setSelected] = useState<{ type: "street" | "camera"; id: string } | null>(null);
    const [saving, setSaving] = useState(false);
    const [ctx, setCtx] = useState<{ x: number; y: number; type: "street" | "camera"; id: string } | null>(null);
    const mapRef = useRef<L.Map | null>(null);
    const [guards, setGuards] = useState<any[]>([]);
    const [liveSocket, setLiveSocket] = useState<any>(null);

    // GPS de guardias en vivo (tablets PWA /guard) via socket
    useEffect(() => {
        const s = io(window.location.origin, { path: "/io/socket.io", transports: ["polling", "websocket"], reconnection: true, reconnectionAttempts: Infinity, reconnectionDelay: 1000, reconnectionDelayMax: 8000 });
        s.on("guard_locations", (data: any[]) => setGuards(Array.isArray(data) ? data.filter((g) => g.lat != null) : []));
        s.on("connect", () => s.emit("get_guard_locations"));
        setLiveSocket(s);
        const iv = setInterval(() => { if (s.connected) s.emit("get_guard_locations"); }, 30000);
        return () => { clearInterval(iv); setLiveSocket(null); s.disconnect(); };
    }, []);

    useEffect(() => {
        getBarrioMap().then(setData).catch(() => setData(null));
        getDevices().then((d: any) => setDevices((d || []).filter((x: any) => x.deviceType === "LPR_CAMERA"))).catch(() => {});
    }, []);
    useEffect(() => {
        const close = () => setCtx(null);
        window.addEventListener("click", close);
        return () => window.removeEventListener("click", close);
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
        else if (tool === "camera") {
            if (!pendingCam) { toast.error({ title: "Elegí una cámara primero" }); return; }
            setData((d) => d ? { ...d, cameras: [...d.cameras.filter((c) => c.deviceId !== pendingCam), { deviceId: pendingCam, lat: ll[0], lng: ll[1] }] } : d);
            setPendingCam(""); setTool("select");
        }
    };
    const commitPerimeter = () => { if (draftPerimeter.length >= 3) setData((d) => d ? { ...d, perimeter: draftPerimeter } : d); setDraftPerimeter([]); setTool("select"); };
    const commitStreet = () => { if (draftStreet.length >= 2) setData((d) => d ? { ...d, streets: [...d.streets, { id: `s_${Date.now()}`, points: draftStreet }] } : d); setDraftStreet([]); setTool("select"); };
    const removeCamera = (id: string) => setData((d) => d ? { ...d, cameras: d.cameras.filter((c) => c.deviceId !== id) } : d);
    const removeStreet = (id: string) => setData((d) => d ? { ...d, streets: d.streets.filter((s) => s.id !== id) } : d);
    const renameStreet = (id: string) => { const n = window.prompt("Nombre de la calle:"); if (n != null) setData((d) => d ? { ...d, streets: d.streets.map((s) => s.id === id ? { ...s, name: n } : s) } : d); };

    const deleteSelected = () => { if (!selected) return; if (selected.type === "camera") removeCamera(selected.id); else removeStreet(selected.id); setSelected(null); };

    const save = async () => {
        setSaving(true);
        const m = mapRef.current;
        const payload: BarrioMapData = { ...data, center: m ? [m.getCenter().lat, m.getCenter().lng] : data.center, zoom: m ? m.getZoom() : data.zoom };
        try { const r = await saveBarrioMap(payload); if (r.ok) { toast.success({ title: "Mapa guardado" }); setData(payload); setEditing(false); setTool("select"); } else toast.error({ title: "Error al guardar", description: r.error || "sin detalle" }); }
        catch (e: any) { toast.error({ title: "Error al guardar", description: String(e?.message || e) }); } finally { setSaving(false); }
    };

    const openCtx = (e: any, type: "street" | "camera", id: string) => {
        const oe = e.originalEvent || e; oe.preventDefault?.(); oe.stopPropagation?.();
        setCtx({ x: oe.clientX, y: oe.clientY, type, id });
    };

    const tools: { id: Tool; icon: any; label: string }[] = [
        { id: "select", icon: MousePointer2, label: "Seleccionar" },
        { id: "perimeter", icon: Hexagon, label: "Dibujar perímetro" },
        { id: "street", icon: Spline, label: "Dibujar calle" },
        { id: "camera", icon: Video, label: "Soltar cámara" },
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
            `}</style>
            <div className="relative h-full w-full">
                <MapContainer center={data.center} zoom={data.zoom} className="h-full w-full z-0" zoomControl={false} scrollWheelZoom>
                    <LayersControl position="topright">
                        <LayersControl.BaseLayer name="Calles">
                            <TileLayer attribution="&copy; OpenStreetMap" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                        </LayersControl.BaseLayer>
                        <LayersControl.BaseLayer checked name="Satélite">
                            <TileLayer attribution="&copy; Esri" url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}" maxZoom={19} />
                        </LayersControl.BaseLayer>
                        <LayersControl.BaseLayer name="Oscuro">
                            <TileLayer attribution="&copy; CARTO" url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" />
                        </LayersControl.BaseLayer>
                    </LayersControl>

                    <MapRefGrabber onMap={(m) => (mapRef.current = m)} />
                    {editing && tool !== "select" && <ClickHandler onClick={onMapClick} />}

                    {data.perimeter.length >= 3 && <Polygon positions={data.perimeter} pathOptions={{ color: "#22c55e", weight: 2, fillOpacity: 0.08 }} />}
                    {draftPerimeter.length > 0 && <Polyline positions={draftPerimeter} pathOptions={{ color: "#22c55e", weight: 2, dashArray: "6 6" }} />}

                    {data.streets.map((s) => (
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

                    {guards.map((g) => (
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

                    {data.cameras.map((c) => (
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
                </MapContainer>

                {/* Columnas de flujo en vivo */}
                {!editing && (
                    <>
                        <FlowColumn side="left" title="Entradas" icon={LogIn} accent="emerald" events={flow.entries} onPick={(ev) => flow.animateEvent(ev)} />
                        <FlowColumn side="right" title="Salidas" icon={LogOut} accent="orange" events={flow.exits} onPick={(ev) => flow.animateEvent(ev)} />
                    </>
                )}

                {/* Toolbar pill */}
                <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[500] flex items-center gap-1 bg-card/95 backdrop-blur border border-border rounded-full shadow-lg px-1.5 py-1.5">
                    {!editing ? (
                        <Tooltip><TooltipTrigger asChild>
                            <button onClick={() => setEditing(true)} className="flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-bold bg-blue-600 text-white hover:bg-blue-500 transition-colors"><Pencil size={14} /> Editar mapa</button>
                        </TooltipTrigger><TooltipContent>Activar modo edición</TooltipContent></Tooltip>
                    ) : (
                        <>
                            {tools.map((t) => (
                                <Tooltip key={t.id}><TooltipTrigger asChild>
                                    <button onClick={() => { setTool(t.id); setSelected(null); }} className={cn("p-2 rounded-full transition-colors", tool === t.id ? "bg-blue-600 text-white" : "text-muted-foreground hover:bg-accent")}><t.icon size={16} /></button>
                                </TooltipTrigger><TooltipContent>{t.label}</TooltipContent></Tooltip>
                            ))}
                            <div className="w-px h-6 bg-border mx-0.5" />
                            <Tooltip><TooltipTrigger asChild>
                                <button onClick={deleteSelected} disabled={!selected} className={cn("p-2 rounded-full transition-colors", selected ? "text-red-400 hover:bg-red-500/10" : "text-muted-foreground/40")}><Trash2 size={16} /></button>
                            </TooltipTrigger><TooltipContent>Borrar seleccionado</TooltipContent></Tooltip>
                            <Tooltip><TooltipTrigger asChild>
                                <button onClick={save} disabled={saving} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold bg-emerald-600 text-white hover:bg-emerald-500 transition-colors">{saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Guardar</button>
                            </TooltipTrigger><TooltipContent>Guardar cambios</TooltipContent></Tooltip>
                            <Tooltip><TooltipTrigger asChild>
                                <button onClick={() => { setEditing(false); setTool("select"); setDraftPerimeter([]); setDraftStreet([]); setSelected(null); getBarrioMap().then(setData); }} className="p-2 rounded-full text-muted-foreground hover:bg-accent"><X size={16} /></button>
                            </TooltipTrigger><TooltipContent>Cancelar</TooltipContent></Tooltip>
                        </>
                    )}
                </div>

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
                        {tool === "select" && (<p className="text-muted-foreground flex items-center gap-1.5"><MapPin size={13} /> {selected ? `Seleccionado: ${selected.type === "camera" ? (devById[selected.id]?.name || "cámara") : "calle"}` : "Tocá una calle o cámara (o clic derecho para menú)."}</p>)}
                    </div>
                )}

                {/* Context menu */}
                {ctx && (
                    <div className="fixed z-[600] bg-popover border border-border rounded-lg shadow-xl py-1 text-xs min-w-[160px]" style={{ left: ctx.x, top: ctx.y }} onClick={(e) => e.stopPropagation()}>
                        {ctx.type === "camera" ? (<>
                            <button onClick={() => { const dev = devById[ctx.id]; if (dev && mapRef.current) { const cam = data.cameras.find((c) => c.deviceId === ctx.id); if (cam) mapRef.current.setView([cam.lat, cam.lng], Math.max(mapRef.current.getZoom(), 18)); } setCtx(null); }} className="w-full text-left px-3 py-1.5 hover:bg-accent flex items-center gap-2"><Radio size={13} className="text-red-400" /> Centrar / ver</button>
                            <button onClick={() => { removeCamera(ctx.id); setCtx(null); }} className="w-full text-left px-3 py-1.5 hover:bg-accent flex items-center gap-2 text-red-400"><Trash2 size={13} /> Quitar del mapa</button>
                        </>) : (<>
                            <button onClick={() => { renameStreet(ctx.id); setCtx(null); }} className="w-full text-left px-3 py-1.5 hover:bg-accent flex items-center gap-2"><PencilIcon size={13} /> Renombrar calle</button>
                            <button onClick={() => { removeStreet(ctx.id); setCtx(null); }} className="w-full text-left px-3 py-1.5 hover:bg-accent flex items-center gap-2 text-red-400"><Trash2 size={13} /> Borrar calle</button>
                        </>)}
                    </div>
                )}

                {/* Legend */}
                <div className="absolute top-4 left-4 z-[500] bg-card/90 backdrop-blur border border-border rounded-lg px-3 py-2 shadow flex items-center gap-2">
                    <MapIco size={16} className="text-blue-400" />
                    <div><p className="text-xs font-bold leading-none">Mapa del barrio</p><p className="text-[10px] text-muted-foreground">{data.cameras.length} cámaras · {data.streets.length} calles · <span className={guards.length ? "text-emerald-500 font-bold" : ""}>{guards.length} guardias</span></p></div>
                </div>
            </div>
        </TooltipProvider>
    );
}
