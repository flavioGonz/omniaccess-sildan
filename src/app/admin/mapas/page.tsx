"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import dynamic from "next/dynamic";
import {
    Image as ImageIcon, Globe, Pencil, Save, Upload, RefreshCw, X, Camera,
    Wifi, WifiOff, Plus, Crosshair, Sun, Moon, Video,
} from "lucide-react";
import { cn } from "@/lib/utils";
import MapFloatingWindow from "./MapFloatingWindow";
import { toast } from "sonner";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";
import { getMapConfig, saveMapConfig, getMapDevices } from "@/app/actions/maps";
import { getLatestQueueCounts, getQueueAlerts } from "@/app/actions/queue";
import { getEnabledModules } from "@/app/actions/modules";
import { uploadBrandingFile } from "@/app/actions/settings";
import io from "socket.io-client";

const RealMap = dynamic(() => import("./RealMap"), { ssr: false });

const OCC = ["Aforo", "Occupancy", "Ocupación", "Ocupacion"];
type Dev = { id: string; name: string; ip: string; type: string; brand: string; online: boolean };

function getStreamName(ip: string) { return `bosch_${ip.replace(/\./g, "_")}`; }
function aforoColor(a: number, limit: number) { const r = limit > 0 ? a / limit : 0; return r >= 1 ? "#ef4444" : r >= 0.7 ? "#f59e0b" : "#10b981"; }

function LiveVideo({ ip, deviceId, className }: { ip: string; deviceId: string; className?: string }) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const [failed, setFailed] = useState(false);
    const retry = useRef(0);
    useEffect(() => {
        const sn = ip ? getStreamName(ip) : "";
        if (!sn) { setFailed(true); return; }
        setFailed(false); retry.current = 0;
        const video = videoRef.current; if (!video) return;
        let destroyed = false; let timer: any = null;
        const src = `/go2rtc/api/stream.mp4?src=${encodeURIComponent(sn)}`;
        const load = () => { if (destroyed || !video) return; video.src = src; video.play().catch(() => {}); };
        const onError = () => { if (destroyed) return; retry.current++; if (retry.current > 5) { setFailed(true); return; } timer = setTimeout(load, Math.min(1000 * retry.current, 4000)); };
        video.addEventListener("error", onError); load();
        return () => { destroyed = true; if (timer) clearTimeout(timer); video.removeEventListener("error", onError); video.pause(); video.removeAttribute("src"); video.load(); };
    }, [ip]);
    if (failed) return <img src={`/api/snapshot/${deviceId}?t=${Date.now()}`} alt="" className={cn("object-cover", className)} onError={(e) => ((e.target as HTMLImageElement).style.opacity = "0.2")} />;
    return <video ref={videoRef} className={cn("object-cover", className)} autoPlay muted playsInline />;
}

function IconBtn({ label, onClick, active, disabled, children }: { label: string; onClick?: () => void; active?: boolean; disabled?: boolean; children: React.ReactNode }) {
    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <button onClick={onClick} disabled={disabled} className={cn("w-10 h-10 rounded-full flex items-center justify-center transition disabled:opacity-50", active ? "bg-blue-500 text-white" : "text-foreground/70 hover:bg-accent")}>{children}</button>
            </TooltipTrigger>
            <TooltipContent>{label}</TooltipContent>
        </Tooltip>
    );
}

async function compressImage(file: File, maxDim = 2400, quality = 0.85): Promise<Blob> {
    try {
        const dataUrl = await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result as string); r.onerror = rej; r.readAsDataURL(file); });
        const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new window.Image(); i.onload = () => res(i); i.onerror = rej; i.src = dataUrl; });
        let width = img.naturalWidth, height = img.naturalHeight;
        if (Math.max(width, height) > maxDim) { const sc = maxDim / Math.max(width, height); width = Math.round(width * sc); height = Math.round(height * sc); }
        const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
        const ctx = canvas.getContext("2d"); if (!ctx) return file;
        ctx.drawImage(img, 0, 0, width, height);
        return await new Promise<Blob>((res) => canvas.toBlob((b) => res(b || file), "image/jpeg", quality));
    } catch { return file; }
}

export default function MapasPage() {
    const [devices, setDevices] = useState<Dev[]>([]);
    const [mode, setMode] = useState<"foto" | "real">("foto");
    const [bgUrl, setBgUrl] = useState("");
    const [photo, setPhoto] = useState<{ deviceId: string; x: number; y: number }[]>([]);
    const [geo, setGeo] = useState<{ deviceId: string; lat: number; lng: number }[]>([]);
    const [center, setCenter] = useState({ lat: -34.9, lng: -56.16, zoom: 14 });
    const [tiles, setTiles] = useState("calles");
    const [aforo, setAforo] = useState<Record<string, number>>({});
    const [limit, setLimit] = useState(8);
    const [edit, setEdit] = useState(false);
    const [selected, setSelected] = useState<string | null>(null);
    const [winGeom, setWinGeom] = useState({ x: 120, y: 100, w: 440, h: 320, docked: false });
    useEffect(() => {
        try {
            const raw = localStorage.getItem("oa_map_win");
            if (raw) { const j = JSON.parse(raw); if (j && j.deviceId) { setSelected(j.deviceId); setWinGeom({ x: j.x ?? 120, y: j.y ?? 100, w: j.w ?? 440, h: j.h ?? 320, docked: !!j.docked }); } }
        } catch {}
    }, []);
    const saveMapWin = () => { try { localStorage.setItem("oa_map_win", JSON.stringify({ deviceId: selected, ...winGeom })); toast.success("Vista de mapa guardada"); } catch {} };
    const closeMapWin = () => { setSelected(null); try { localStorage.removeItem("oa_map_win"); } catch {} };
    const [flashId, setFlashId] = useState<string | null>(null);
    const [uploading, setUploading] = useState(false);
    const [bright, setBright] = useState(0);
    const [modules, setModules] = useState<Record<string, boolean>>({});
    const [pip, setPip] = useState(true);
    const [layersOpen, setLayersOpen] = useState(false);
    const [brightOpen, setBrightOpen] = useState(false);
    const mapRef = useRef<HTMLDivElement>(null);
    const dragId = useRef<string | null>(null);
    const fileRef = useRef<HTMLInputElement>(null);

    const load = useCallback(async () => {
        try {
            const [cfg, devs, counts, alerts, mods] = await Promise.all([getMapConfig(), getMapDevices(), getLatestQueueCounts(), getQueueAlerts(), getEnabledModules()]);
            setModules(mods as any);
            const c = cfg as any;
            setMode(c.mode || "foto"); setBgUrl(c.bgUrl || ""); setPhoto(c.photo || []); setGeo(c.geo || []); if (c.center) setCenter(c.center); if (c.tiles) setTiles(c.tiles); setBright(c.bright ?? 0);
            setDevices(devs as any);
            const map: Record<string, number> = {};
            for (const x of counts as any[]) { const ch = (x.channels || []).find((y: any) => OCC.includes(y.channelName)); map[x.device.id] = ch ? ch.peopleCount : 0; }
            setAforo(map);
            const ths = (alerts as any[]).map((a) => a.threshold).filter((n: number) => n > 0);
            if (ths.length) setLimit(Math.max(...ths));
        } catch (e) { console.error(e); }
    }, []);
    useEffect(() => { load(); const r = setInterval(load, 15000); return () => clearInterval(r); }, [load]);

    useEffect(() => {
        const socket = io(window.location.origin, { path: "/io/socket.io", transports: ["polling"] });
        socket.on("queue_update", (d: any) => { if (OCC.includes(d.channelName) && d.deviceId) setAforo((p) => ({ ...p, [d.deviceId]: d.peopleCount })); });
        socket.on("queue_alert", (d: any) => { const id = devices.find((x) => x.name === d.deviceName)?.id; if (id) { setFlashId(id); setTimeout(() => setFlashId(null), 2500); } });
        return () => { socket.disconnect(); };
    }, [devices]);

    const placedIds = new Set((mode === "foto" ? photo.map((m) => m.deviceId) : geo.map((m) => m.deviceId)));
    const allowedTypes = modules.MODULE_QUEUE ? ["QUEUE_COUNTER"]
        : modules.MODULE_FACE ? ["FACE_TERMINAL", "DOOR_INTERCOM"]
        : modules.MODULE_LPR ? ["LPR_CAMERA"]
        : ["QUEUE_COUNTER", "LPR_CAMERA", "FACE_TERMINAL", "DOOR_INTERCOM"];
    const unplaced = devices.filter((d) => !placedIds.has(d.id) && allowedTypes.includes(d.type));

    const markerColor = (d: Dev) => d.type === "QUEUE_COUNTER" ? aforoColor(aforo[d.id] ?? 0, limit) : (d.online ? "#10b981" : "#ef4444");

    // Foto drag
    const onPointerDown = (id: string) => (e: React.PointerEvent) => { if (!edit) return; e.preventDefault(); dragId.current = id; (e.target as HTMLElement).setPointerCapture?.(e.pointerId); };
    const onPointerMove = (e: React.PointerEvent) => {
        if (!edit || !dragId.current || !mapRef.current) return;
        const rect = mapRef.current.getBoundingClientRect();
        const x = Math.max(2, Math.min(98, ((e.clientX - rect.left) / rect.width) * 100));
        const y = Math.max(2, Math.min(98, ((e.clientY - rect.top) / rect.height) * 100));
        setPhoto((prev) => prev.map((m) => (m.deviceId === dragId.current ? { ...m, x, y } : m)));
    };
    const onPointerUp = () => { dragId.current = null; };

    const addToMap = (id: string) => { if (mode === "foto") setPhoto((p) => [...p, { deviceId: id, x: 50, y: 50 }]); else setGeo((g) => [...g, { deviceId: id, lat: center.lat, lng: center.lng }]); };
    const removeMarker = (id: string) => { if (mode === "foto") setPhoto((p) => p.filter((m) => m.deviceId !== id)); else setGeo((g) => g.filter((m) => m.deviceId !== id)); };
    const moveGeo = (id: string, lat: number, lng: number) => setGeo((g) => g.map((m) => (m.deviceId === id ? { ...m, lat, lng } : m)));

    const save = async () => { await saveMapConfig({ mode, bgUrl, photo, geo, center, tiles, bright }); setEdit(false); toast.success("Mapa guardado"); };
    const switchMode = async (m: "foto" | "real") => { setMode(m); await saveMapConfig({ mode: m }); };

    const uploadBg = async (file: File) => {
        setUploading(true);
        try {
            const blob = await compressImage(file);
            const named = new File([blob], (file.name.replace(/\.[^.]+$/, "") || "plano") + ".jpg", { type: "image/jpeg" });
            const fd = new FormData(); fd.append("file", named);
            const res = await uploadBrandingFile(fd);
            if (res.success && res.url) { setBgUrl(res.url); await saveMapConfig({ bgUrl: res.url }); toast.success("Plano actualizado"); }
            else { console.error("upload failed", res); toast.error(res.message || "No se pudo subir"); }
        } catch (e: any) { console.error(e); toast.error("Error al subir: " + (e?.message || "")); } finally { setUploading(false); }
    };

    const sel = selected ? devices.find((d) => d.id === selected) : null;

    return (
        <div className="relative h-full w-full overflow-hidden bg-muted">
            {/* ── Map area (full bleed) ── */}
            {mode === "foto" ? (
                <div ref={mapRef} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerLeave={onPointerUp}
                    className="absolute inset-0 select-none" style={{ touchAction: edit ? "none" : "auto" }}>
                    {bgUrl ? (
                        <img src={bgUrl} alt="plano" className="absolute inset-0 w-full h-full object-contain" draggable={false} style={{ filter: bright !== 0 ? `brightness(${(1 + bright / 100).toFixed(2)})` : undefined }} />
                    ) : (
                        <div className="absolute inset-0 flex flex-col items-center justify-center text-muted-foreground gap-2"
                            style={{ backgroundImage: "linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px)", backgroundSize: "34px 34px" }}>
                            <ImageIcon size={34} className="opacity-40" /><span className="text-sm">Subí un plano del sitio (botón de subir)</span>
                        </div>
                    )}
                    {photo.map((m) => {
                        const d = devices.find((x) => x.id === m.deviceId); if (!d) return null;
                        const col = markerColor(d); const isQ = d.type === "QUEUE_COUNTER";
                        return (
                            <div key={m.deviceId} onPointerDown={onPointerDown(m.deviceId)} onClick={() => !edit && setSelected(d.id)}
                                className="absolute -translate-x-1/2 -translate-y-1/2 z-10" style={{ left: `${m.x}%`, top: `${m.y}%`, cursor: edit ? "grab" : "pointer" }}>
                                <div className="relative flex flex-col items-center">
                                    {(flashId === d.id || (isQ && (aforo[d.id] ?? 0) / (limit || 1) >= 0.7)) && <span className="absolute -inset-3 rounded-full animate-ping" style={{ background: col + "55" }} />}
                                    {isQ && pip && !edit ? (
                                        <div className="relative rounded-lg overflow-hidden border-2 shadow-xl bg-black" style={{ borderColor: col, width: 150, height: 86 }}>
                                            <LiveVideo ip={d.ip} deviceId={d.id} className="absolute inset-0 w-full h-full" />
                                            <div className="absolute top-1 left-1 px-1.5 py-0.5 rounded bg-black/60 text-[8px] font-semibold text-white max-w-[118px] truncate">{d.name}</div>
                                            <div className="absolute bottom-1 right-1 px-1.5 py-0.5 rounded text-white font-bold text-base leading-none tabular-nums" style={{ background: col + "dd" }}>{aforo[d.id] ?? 0}</div>
                                            <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                                        </div>
                                    ) : (
                                        <>
                                            <div className="relative w-9 h-9 rounded-full flex items-center justify-center shadow-lg border-2 border-border" style={{ background: col }}>
                                                {isQ ? <span className="text-xs font-bold text-white tabular-nums">{aforo[d.id] ?? 0}</span> : <Camera size={15} className="text-white" />}
                                            </div>
                                            <span className="mt-0.5 px-1.5 py-0.5 rounded bg-black/70 text-[9px] font-semibold text-white whitespace-nowrap max-w-[120px] truncate">{d.name}</span>
                                        </>
                                    )}
                                    {edit && <button onClick={(e) => { e.stopPropagation(); removeMarker(m.deviceId); }} className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-red-600 text-white flex items-center justify-center"><X size={11} /></button>}
                                </div>
                            </div>
                        );
                    })}
                </div>
            ) : (
                <div className="absolute inset-0">
                    <RealMap geo={geo} devices={devices as any} aforo={aforo} limit={limit} center={center} edit={edit} flashId={flashId} tiles={tiles} bright={bright} pip={pip} onMove={moveGeo} onSelect={(id) => setSelected(id)} onView={(lat, lng, zoom) => setCenter({ lat, lng, zoom })} />
                </div>
            )}

            {/* ── Floating toolbar ── */}
            <TooltipProvider delayDuration={150}>
                <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[1000] flex items-center gap-1 px-1.5 py-1.5 rounded-full bg-card/90 backdrop-blur-xl border border-border shadow-lg">
                    {/* mode segment */}
                    <div className="flex items-center bg-muted rounded-full p-0.5">
                        <IconBtn label="Mapa foto (plano)" active={mode === "foto"} onClick={() => switchMode("foto")}><ImageIcon size={18} /></IconBtn>
                        <IconBtn label="Mapa real · capas" active={mode === "real"} onClick={() => { if (mode === "real") { setLayersOpen(o => !o); } else { switchMode("real"); setLayersOpen(true); } }}><Globe size={18} /></IconBtn>
                    </div>
                    <span className="w-px h-6 bg-border mx-0.5" />
                    {mode === "foto" && (
                        <>
                            <input ref={fileRef} type="file" accept="image/png,image/webp,image/jpeg" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadBg(f); }} />
                            <IconBtn label="Subir plano" disabled={uploading} onClick={() => fileRef.current?.click()}>{uploading ? <RefreshCw size={18} className="animate-spin" /> : <Upload size={18} />}</IconBtn>
                        </>
                    )}
                    <IconBtn label={pip ? "Ocultar mini-video" : "Mini-video en vivo"} active={pip} onClick={() => setPip(p => !p)}><Video size={18} /></IconBtn>
                    <IconBtn label="Brillo del mapa" active={brightOpen} onClick={() => setBrightOpen(o => !o)}><Sun size={18} /></IconBtn>
                    <IconBtn label="Actualizar" onClick={load}><RefreshCw size={18} /></IconBtn>
                    {edit ? (
                        <IconBtn label="Guardar posiciones" active onClick={save}><Save size={18} /></IconBtn>
                    ) : (
                        <IconBtn label="Editar posiciones" onClick={() => setEdit(true)}><Pencil size={18} /></IconBtn>
                    )}
                </div>
            </TooltipProvider>

            {/* ── Edit tray (unplaced) ── */}
            {edit && unplaced.length > 0 && (
                <div className="absolute bottom-4 left-4 z-[1000] w-56 max-h-[55vh] overflow-y-auto rounded-2xl bg-card/90 backdrop-blur-xl border border-border shadow-lg p-3">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">Sin ubicar · arrastrá al mapa</div>
                    <div className="space-y-1.5">
                        {unplaced.map((d) => (
                            <button key={d.id} onClick={() => addToMap(d.id)} className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg bg-muted/40 hover:bg-accent text-left transition">
                                <Plus size={13} className="text-blue-400 shrink-0" /><span className="text-xs font-medium text-foreground truncate">{d.name}</span>
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {/* ── Layers (real mode) ── */}
            {mode === "real" && layersOpen && (
                <>
                    <div className="fixed inset-0 z-[999]" onClick={() => setLayersOpen(false)} />
                    <div className="absolute top-[64px] left-1/2 -translate-x-1/2 z-[1001] flex items-center gap-1 p-1 rounded-full bg-card/95 backdrop-blur-xl border border-border shadow-lg animate-in fade-in slide-in-from-top-1 duration-200">
                        <span className="pl-2 pr-1 text-[9px] font-bold uppercase tracking-wider text-muted-foreground">Capa</span>
                        <button onClick={() => { setTiles("calles"); setLayersOpen(false); }} className={cn("px-3 py-1.5 rounded-full text-[11px] font-bold transition", tiles === "calles" ? "bg-blue-500 text-white" : "text-foreground/60 hover:bg-accent")}>Calles</button>
                        <button onClick={() => { setTiles("satelite"); setLayersOpen(false); }} className={cn("px-3 py-1.5 rounded-full text-[11px] font-bold transition", tiles === "satelite" ? "bg-blue-500 text-white" : "text-foreground/60 hover:bg-accent")}>Satélite</button>
                    </div>
                </>
            )}

            {/* ── Brightness popover ── */}
            {brightOpen && (
                <>
                    <div className="fixed inset-0 z-[999]" onClick={() => setBrightOpen(false)} />
                    <div className="absolute top-[64px] left-1/2 -translate-x-1/2 z-[1001] flex items-center gap-2 px-3 py-2 rounded-full bg-card/95 backdrop-blur-xl border border-border shadow-lg animate-in fade-in slide-in-from-top-1 duration-200">
                        <Moon size={14} className="text-foreground/50" />
                        <input type="range" min={-80} max={80} step={5} value={bright}
                            onChange={(e) => setBright(Number(e.target.value))}
                            onPointerUp={() => saveMapConfig({ bright } as any)}
                            className="w-36 accent-blue-500 cursor-pointer" title="Aclarar / oscurecer el mapa" />
                        <Sun size={14} className="text-foreground/50" />
                    </div>
                </>
            )}

            {/* ── Legend ── */}
            <div className="absolute bottom-4 right-4 z-[1000] flex items-center gap-3 px-3 py-2 rounded-full bg-card/90 backdrop-blur-xl border border-border text-[11px] text-foreground/70">
                <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-emerald-500" /> OK</span>
                <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-amber-500" /> Alto</span>
                <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-red-500" /> Lleno/Offline</span>
            </div>

            {/* ── Floating video window (drag / dock / resize / save) ── */}
            {sel && !edit && (
                <MapFloatingWindow
                    device={sel as any}
                    aforo={aforo[sel.id] ?? 0}
                    limit={limit}
                    geom={winGeom}
                    setGeom={setWinGeom}
                    onClose={closeMapWin}
                    onSave={saveMapWin}
                >
                    <LiveVideo ip={sel.ip} deviceId={sel.id} className="absolute inset-0 w-full h-full" />
                </MapFloatingWindow>
            )}
        </div>
    );
}
