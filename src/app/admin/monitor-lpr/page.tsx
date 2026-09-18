"use client";

import { useEffect, useState, useMemo, useRef, memo, useCallback } from "react";
import { io, Socket } from "socket.io-client";
import { useRouter } from "next/navigation";
import { getAccessEvents, getEventsCountToday, getLprCounters, getLastEventPerDevice } from "@/app/actions/history";
import { getDevices, getAvailableStreams } from "@/app/actions/devices";
import { Car, CheckCircle2, XCircle, Clock, TrendingUp, TrendingDown, Zap, Shield, ShieldAlert, Volume2, VolumeX, AlertTriangle, Filter, RefreshCw, Camera, LogIn, LogOut, Truck, Bus, Bike, Activity, Search, SquareParking, X, MapPin, Home, Loader2, UserPlus, PlayCircle, Route, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { VisorCuadro } from "@/components/VisorCuadro";
import { EventDetailsDialog } from "@/components/dashboard/EventDetailsDialog";
import { NvrTimeMachine } from "@/components/dashboard/NvrTimeMachine";
import Image from "next/image";
import { AccessEvent, Device, Unit } from "@prisma/client";
import { getCarLogo } from "@/lib/car-logos";
import { getVehicleBrandName } from "@/lib/hikvision-codes";
import { getImagePath } from "@/lib/image-path";
import { getSocketUrl } from "@/lib/socket-config";
import { getUnits } from "@/app/actions/units";
import { getAccessGroups } from "@/app/actions/groups";
import { getParkingSlots, getPlateParking, getPlatesWithParking } from "@/app/actions/parking";
import { getWatchMap } from "@/app/actions/watchlist";
import { watchCatMeta } from "@/lib/watch-categories";
import { WatchlistDialog } from "@/components/WatchlistDialog";
import { getParkingElements, getPresenceSummary } from "@/app/actions/plazas";
import { UserFormDialog } from "@/components/UserFormDialog";
import { parseVehicleMeta, collectVehicleFacets } from "@/lib/vehicle-details";

interface FullAccessEvent extends AccessEvent {
    user: {
        id: string;
        name: string;
        role?: string | null;
        email: string | null;
        phone: string | null;
        dni: string | null;
        apartment: string | null;
        cara: string | null;
        unit: Unit | null;
        parkingSlotId: string | null;
    } | null;
    device: Device | null;
}

/** Tipo de usuario reconocido en cada detección (color + etiqueta).
 *  Prioridad: lista negra > lista blanca (watch o rol) > rol del usuario. */
type TipoMeta = { key: string; label: string; badge: string; ring: string; dot: string };
function tipoDeteccion(event: any, watch?: any): TipoMeta | null {
    const cat = (watch?.category || "").toString().toLowerCase();
    if (cat === "negra" || cat === "blacklisted") return { key: "negra", label: "Lista Negra", badge: "bg-red-500/15 text-red-300 border border-red-500/40", ring: "ring-2 ring-red-500/70", dot: "bg-red-500" };
    if (cat === "blanca" || cat === "whitelisted") return { key: "blanca", label: "Lista Blanca", badge: "bg-sky-500/15 text-sky-300 border border-sky-500/40", ring: "ring-2 ring-sky-400/70", dot: "bg-sky-400" };
    const role = (event?.user?.role || "").toString().toUpperCase();
    switch (role) {
        case "RESIDENT": return { key: "residente", label: "Residente", badge: "bg-blue-500/15 text-blue-300 border border-blue-500/40", ring: "ring-1 ring-blue-500/50", dot: "bg-blue-500" };
        case "VISITOR": case "TEMPORARY_VISITOR": return { key: "visitante", label: "Visitante", badge: "bg-purple-500/15 text-purple-300 border border-purple-500/40", ring: "ring-1 ring-purple-500/50", dot: "bg-purple-500" };
        case "STAFF": case "SECURITY": return { key: "personal", label: "Personal", badge: "bg-emerald-500/15 text-emerald-300 border border-emerald-500/40", ring: "ring-1 ring-emerald-500/50", dot: "bg-emerald-500" };
        case "PROVIDER": return { key: "proveedor", label: "Proveedor", badge: "bg-amber-500/15 text-amber-300 border border-amber-500/40", ring: "ring-1 ring-amber-500/50", dot: "bg-amber-500" };
        case "WHITELISTED": return { key: "blanca", label: "Lista Blanca", badge: "bg-sky-500/15 text-sky-300 border border-sky-500/40", ring: "ring-2 ring-sky-400/70", dot: "bg-sky-400" };
        case "BLACKLISTED": return { key: "negra", label: "Lista Negra", badge: "bg-red-500/15 text-red-300 border border-red-500/40", ring: "ring-2 ring-red-500/70", dot: "bg-red-500" };
        case "ADMIN": case "OPERATOR": return null;
        default: return event?.user ? { key: "otro", label: "Registrado", badge: "bg-zinc-500/15 text-zinc-300 border border-zinc-500/40", ring: "ring-1 ring-zinc-500/40", dot: "bg-zinc-400" } : { key: "desconocido", label: "Desconocido", badge: "bg-zinc-600/20 text-zinc-400 border border-zinc-600/40", ring: "", dot: "bg-zinc-500" };
    }
}

function playShutter() { /* sonido de captura desactivado para evitar warnings de autoplay del navegador */ }

function TimeAgo({ timestamp }: { timestamp: string | Date }) {
    const [now, setNow] = useState<number | null>(null);
    useEffect(() => { setNow(Date.now()); const iv = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(iv); }, []);
    if (now === null) return <span suppressHydrationWarning>&middot;&middot;&middot;</span>;
    const s = Math.max(0, Math.floor((now - new Date(timestamp).getTime()) / 1000));
    let txt: string;
    if (s < 60) txt = `Hace ${s}s`;
    else if (s < 3600) txt = `Hace ${Math.floor(s / 60)}m`;
    else if (s < 86400) txt = `Hace ${Math.floor(s / 3600)}h`;
    else txt = new Date(timestamp).toLocaleDateString("es-UY", { day: "2-digit", month: "short" });
    return <span suppressHydrationWarning>{txt}</span>;
}

function SmartThumb({ src, w, className }: { src?: string; w?: number; className?: string }) {
    const [tries, setTries] = useState(0);
    const [auto, setAuto] = useState(0);
    const imgRef = useRef<HTMLImageElement>(null);
    useEffect(() => { setTries(0); }, [src]);
    // Refresco automático cada 5s: re-pide la foto (cache-bust) para que las capturas
    // LPR se actualicen aunque el snapshot haya llegado tarde a MinIO.
    useEffect(() => {
        const id = setInterval(() => setAuto((a) => a + 1), 5000);
        return () => clearInterval(id);
    }, []);
    // Watchdog: si al rato la imagen no está completa (request que nunca arrancó o quedó
    // colgado — eso NO dispara onError), forzamos un request fresco con cache-bust.
    useEffect(() => {
        if (!src) return;
        if (tries >= 6) return;
        const t = setTimeout(() => {
            const im = imgRef.current;
            if (!im || (im.complete && im.naturalWidth > 0)) return;
            setTries((n) => n + 1);
        }, tries === 0 ? 1200 : 1500 + tries * 500);
        return () => clearTimeout(t);
    }, [src, tries]);
    if (!src) {
        return (
            <div className={cn("relative overflow-hidden bg-muted flex items-center justify-center", className)}>
                <Car size={18} className="text-muted-foreground/40" />
            </div>
        );
    }
    const base = w ? `${src}${src.includes("?") ? "&" : "?"}w=${w}` : src;
    let finalSrc = tries > 0 ? `${base}${base.includes("?") ? "&" : "?"}r=${tries}` : base;
    if (auto > 0) finalSrc = `${finalSrc}${finalSrc.includes("?") ? "&" : "?"}a5=${auto}`;
    return (
        <div className={cn("relative overflow-hidden bg-muted/60", className)}>
            <img ref={imgRef} src={finalSrc} alt="" loading="eager" decoding="async"
                className="absolute inset-0 w-full h-full object-cover" />
        </div>
    );
}

function ThumbImg({ src, className }: { src?: string; className?: string }) {
    if (!src) return null;
    return <img src={src} alt="" className={className} loading="eager" decoding="async" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />;
}

function CamTile({ dev, accent = "emerald", ev, onRegister }: { dev: any; accent?: string; ev?: any; onRegister?: (p: string) => void }) {
    const [lit, setLit] = useState(false);
    const last = useRef<string | undefined>(undefined);
    const snap = useMemo(() => `/api/snapshot/${dev.id}?t=${Date.now()}`, [dev.id]);
    const [rk, setRk] = useState(0);
    useEffect(() => {
        if (ev?.id && ev.id !== last.current) {
            const first = last.current === undefined;
            last.current = ev.id;
            if (!first) {
                setLit(true);
                const t1 = setTimeout(() => setLit(false), 1000);
                const t2 = setTimeout(() => setRk(x => x + 1), 1000); // refrescar la foto 1s despues de la captura
                return () => { clearTimeout(t1); clearTimeout(t2); };
            }
        }
    }, [ev?.id]);
    const ring = accent === "orange" ? "border-orange-400 shadow-[0_0_18px_rgba(251,146,60,0.7)]" : "border-emerald-400 shadow-[0_0_18px_rgba(52,211,153,0.7)]";
    const img = ev ? (getImagePath(ev.snapshotPath || ev.imagePath) || "") : "";
    const plate = ev?.plateDetected as string | undefined;
    const ok = ev?.decision === "GRANT";
    const anomalous = !plate || ["NO_LEIDA", "unknown", "S/P"].includes(plate || "");
    const inner = (
        <div className={cn("relative rounded-lg overflow-hidden border vid-surface aspect-video transition-all duration-300", lit ? ring : "border-neutral-800")}>
            <SmartThumb src={(() => { const b = img || snap; return rk > 0 ? `${b}${b.includes("?") ? "&" : "?"}rk=${rk}` : b; })()} w={384} className="absolute inset-0 w-full h-full" />
            <div className="absolute top-1.5 left-1.5 z-20 flex items-center gap-1 px-1.5 py-0.5 rounded bg-black/60 backdrop-blur-sm border border-white/10 pointer-events-none">
                <span className="relative flex h-1.5 w-1.5"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span><span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-red-500"></span></span>
                <span className="text-[9px] font-bold text-white/90 truncate max-w-[130px]">{dev.name}</span>
            </div>
            {plate && (
                <div className="absolute inset-x-1.5 bottom-1.5 z-20 pointer-events-none flex justify-center">
                    <div className={cn("px-2.5 py-0.5 rounded-md font-mono text-sm font-bold tracking-widest text-white backdrop-blur-sm border shadow-lg", anomalous ? "bg-yellow-500/40 border-yellow-300/50 text-yellow-100" : ok ? "bg-emerald-600/80 border-emerald-300/40" : "bg-red-600/80 border-red-300/40")}>
                        {anomalous ? "S/L" : plate}
                    </div>
                </div>
            )}
        </div>
    );
    return ev ? (
        <EventDetailsDialog event={ev} timeStatus={null} onRegister={(p) => onRegister?.(p)}>
            <button type="button" className="block w-full text-left cursor-pointer">{inner}</button>
        </EventDetailsDialog>
    ) : inner;
}

/**
 * Baldosa de camara interior. No abre barrera ni tiene evento de acceso, asi que
 * muestra el cuadro en vivo y encima la ultima matricula que leyo Omni-LPR.
 */
function TrackTile({ dev, av }: { dev: any; av?: any }) {
    const [rk, setRk] = useState(0);
    useEffect(() => { const iv = setInterval(() => setRk(x => x + 1), 15000); return () => clearInterval(iv); }, []);
    const src = `/api/snapshot/${dev.id}?rk=${rk}`;
    const hace = av?.timestamp ? Math.round((Date.now() - new Date(av.timestamp).getTime()) / 1000) : null;
    const fresco = hace != null && hace < 120;
    return (
        <div className={cn("relative rounded-lg overflow-hidden border vid-surface aspect-video transition-all duration-300", fresco ? "border-violet-400 shadow-[0_0_18px_rgba(167,139,250,0.6)]" : "border-neutral-800")}>
            <SmartThumb src={src} w={384} className="absolute inset-0 w-full h-full" />
            <div className="absolute top-1.5 left-1.5 z-20 flex items-center gap-1 px-1.5 py-0.5 rounded bg-black/60 backdrop-blur-sm border border-white/10 pointer-events-none">
                <span className="relative flex h-1.5 w-1.5"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-violet-400 opacity-75"></span><span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-violet-500"></span></span>
                <span className="text-[9px] font-bold text-white/90 truncate max-w-[130px]">{dev.name}</span>
            </div>
            {av?.plate && (
                <div className="absolute inset-x-1.5 bottom-1.5 z-20 pointer-events-none flex flex-col items-center gap-0.5">
                    <div className="px-2.5 py-0.5 rounded-md font-mono text-sm font-bold tracking-widest text-white backdrop-blur-sm border shadow-lg bg-violet-600/80 border-violet-300/40">
                        {av.plate}
                    </div>
                    <span className="text-[9px] text-white/70 font-medium">
                        {hace != null ? (hace < 60 ? `hace ${hace}s` : `hace ${Math.round(hace / 60)} min`) : ""}
                        {av.confidence ? ` · ${Math.round(av.confidence * 100)}%` : ""}
                    </span>
                </div>
            )}
        </div>
    );
}

/**
 * Las últimas lecturas de las cámaras interiores, en fila.
 *
 * Las columnas de entrada y salida muestran sus capturas recientes debajo del vivo; esto
 * es lo mismo para las interiores. Queda visible aunque la sección esté plegada: plegar
 * es para recuperar lugar, no para dejar de ver lo que pasó.
 */
function TiraInteriores({ avistamientos, onAbrir }: { avistamientos: any[]; onAbrir: (i: number) => void }) {
    if (!avistamientos.length) {
        return (
            <p className="text-[10px] text-foreground/35 py-1.5">
                Sin lecturas recientes. Las interiores solo registran cuando pasa un vehículo.
            </p>
        );
    }
    return (
        <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">Capturas recientes</div>
            <div className="flex gap-2 overflow-x-auto pb-1 custom-scrollbar">
                {avistamientos.slice(0, 14).map((a, i) => {
                    const t = new Date(a.timestamp);
                    const seg = Math.round((Date.now() - t.getTime()) / 1000);
                    const conf = typeof a.confidence === "number" ? Math.round(a.confidence * 100) : null;
                    return (
                        <button key={a.id || i} type="button" onClick={() => onAbrir(i)}
                            className="shrink-0 w-[104px] text-left group">
                            <div className="relative rounded-lg overflow-hidden border border-neutral-800 group-hover:border-violet-400/60 transition-colors aspect-video bg-black">
                                {a.snapshotUrl ? (
                                    /* eslint-disable-next-line @next/next/no-img-element */
                                    <img src={a.snapshotUrl} alt={a.plate} className="absolute inset-0 w-full h-full object-cover" />
                                ) : (
                                    <div className="absolute inset-0 flex items-center justify-center text-foreground/25"><Car size={16} /></div>
                                )}
                                <div className="absolute inset-x-0 bottom-0 flex justify-center pb-0.5">
                                    <span className="px-1.5 rounded bg-violet-600/85 font-mono text-[10px] font-bold tracking-wider text-white">{a.plate}</span>
                                </div>
                            </div>
                            <div className="flex items-center gap-1 mt-1 text-[9px] text-muted-foreground">
                                <span className="truncate flex-1">{a.cameraName || "—"}</span>
                                {conf != null && (
                                    <span className={cn("font-semibold", conf >= 85 ? "text-emerald-400" : conf >= 65 ? "text-amber-400" : "text-red-400")}>{conf}%</span>
                                )}
                            </div>
                            <div className="text-[9px] text-muted-foreground/70">
                                {seg < 60 ? `hace ${seg}s` : seg < 3600 ? `hace ${Math.round(seg / 60)} min` : t.toLocaleTimeString("es-UY", { hour: "2-digit", minute: "2-digit" })}
                            </div>
                        </button>
                    );
                })}
            </div>
        </div>
    );
}

function PlateCommandBar() {
    const router = useRouter();
    const [q, setQ] = useState("");
    const [results, setResults] = useState<any[]>([]);
    const [open, setOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const boxRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (!q.trim()) { setResults([]); return; }
        setLoading(true);
        const t = setTimeout(async () => {
            try { const r: any = await getAccessEvents({ search: q.trim(), take: 6, type: "PLATE" }); setResults(r?.events || []); } catch { setResults([]); }
            setLoading(false);
        }, 300);
        return () => clearTimeout(t);
    }, [q]);
    useEffect(() => {
        const onDoc = (e: any) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
        document.addEventListener("mousedown", onDoc); return () => document.removeEventListener("mousedown", onDoc);
    }, []);
    const go = (path: string) => { setOpen(false); router.push(path); };
    return (
        <div ref={boxRef} className="relative flex-1 max-w-md mx-4 hidden md:block">
            <div className="relative">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input value={q}
                    onChange={(e) => { setQ(e.target.value.toUpperCase()); setOpen(true); }}
                    onFocus={() => setOpen(true)}
                    onKeyDown={(e) => { if (e.key === "Enter" && q.trim()) go(`/admin/history?search=${encodeURIComponent(q.trim())}`); }}
                    placeholder="Buscar matrícula e investigar..."
                    className="w-full h-9 pl-9 pr-3 rounded-lg bg-card border border-border text-sm font-mono tracking-wider text-foreground placeholder:font-sans placeholder:tracking-normal placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-blue-500/40" />
            </div>
            {open && (q.trim() || results.length > 0) && (
                <div className="absolute z-50 mt-1 w-full rounded-lg border border-border bg-popover shadow-xl overflow-hidden max-h-80 overflow-y-auto">
                    {loading && <div className="px-3 py-2 text-xs text-muted-foreground">Buscando…</div>}
                    {!loading && results.length === 0 && q.trim() && <div className="px-3 py-2 text-xs text-muted-foreground">Sin resultados</div>}
                    {results.map((r) => (
                        <button key={r.id} type="button" onClick={() => go(`/admin/history?search=${encodeURIComponent(r.plateDetected || q.trim())}`)} className="w-full text-left px-3 py-2 flex items-center gap-2 hover:bg-accent transition-colors">
                            <span className="font-mono font-bold text-sm">{r.plateDetected || "S/L"}</span>
                            <span className="text-[11px] text-muted-foreground truncate">{r.device?.name || ""}</span>
                            <span className={cn("ml-auto text-[10px] font-bold", r.decision === "GRANT" ? "text-emerald-400" : "text-red-400")}>{r.decision === "GRANT" ? "OK" : "DENY"}</span>
                        </button>
                    ))}
                    <button type="button" onClick={() => go(`/admin/history?search=${encodeURIComponent(q.trim())}`)} className="w-full text-left px-3 py-2 text-[11px] font-bold text-blue-400 hover:bg-accent border-t border-border">Ver todo en Historial →</button>
                </div>
            )}
        </div>
    );
}

function CenterShot({ ev, onRegister }: { ev: any; onRegister?: (plate?: string) => void }) {
    const router = useRouter();
    const [flash, setFlash] = useState(false);
    const last = useRef<string | undefined>(undefined);
    useEffect(() => {
        if (ev?.id && ev.id !== last.current) {
            const first = last.current === undefined; last.current = ev.id;
            if (!first) { setFlash(true); playShutter(); const t = setTimeout(() => setFlash(false), 900); return () => clearTimeout(t); }
        }
    }, [ev?.id]);
    if (!ev) {
        return (<div className="p-4"><div className="relative w-full aspect-video rounded-xl overflow-hidden vid-surface border border-border flex items-center justify-center"><div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1.5 px-3 py-1 rounded-lg bg-black/65 backdrop-blur-sm border border-blue-500/30 shadow-lg"><Camera size={13} className="text-blue-400" /><span className="text-[11px] font-bold text-blue-300 uppercase tracking-wider">Ultima captura</span></div><Camera size={36} className="text-muted-foreground/40" /></div></div>);
    }
    const img = getImagePath(ev.snapshotPath || ev.imagePath) || "";
    const plate = ev.plateDetected as string | undefined;
    const ok = ev.decision === "GRANT";
    const anomalous = !plate || ["NO_LEIDA", "unknown", "S/P"].includes(plate || "");
    const marca = (String(ev.details || "").match(/Marca:\s*([^,]+)/)?.[1] || "").trim();
    const crop = getImagePath((String(ev.details || "").match(/PlateCrop:\s*([^,]+)/)?.[1] || "").trim()) || "";
    const dir = ev.direction;
    const tipo = tipoDeteccion(ev, (ev as any).watch);
    const ring = dir === "EXIT" ? "border-orange-400 shadow-[0_0_24px_rgba(251,146,60,0.7)]" : "border-emerald-400 shadow-[0_0_24px_rgba(52,211,153,0.7)]";
    return (
        <div className="p-4">
            <div className={cn("relative w-full aspect-video rounded-xl overflow-hidden vid-surface border transition-all duration-300", flash ? ring : "border-border")}>
                <SmartThumb src={img} w={960} className="absolute inset-0 w-full h-full" />
                {flash && <div className="iris-shot" />}
                <div className="absolute top-3 left-3 z-10 flex flex-col items-start gap-1.5">
                    <Badge className={cn("text-xs shadow-lg", dir === "EXIT" ? "bg-orange-500" : "bg-emerald-500")}>{dir === "EXIT" ? "SALIDA" : "ENTRADA"}</Badge>
                    {tipo && <span className={cn("inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded shadow-lg backdrop-blur", tipo.badge)}>{tipo.label}{tipo.key === "residente" && ev.user?.unit?.name ? ` · ${ev.user.unit.name}` : ""}</span>}
                </div>
                <div className="absolute top-3 right-3 z-10"><Badge className={cn("text-xs shadow-lg", ok ? "bg-emerald-600" : "bg-red-600")}>{ok ? "PERMITIDO" : "DENEGADO"}</Badge></div>
                {crop && (
                    <div className="absolute top-14 right-3 z-20 w-40 rounded-lg overflow-hidden border-2 border-white/70 shadow-lg bg-black/50">
                        <div className="px-1.5 py-0.5 bg-black/70 text-[8px] font-bold text-white/90 uppercase tracking-wide">Patente</div>
                        <ThumbImg src={crop} className="w-full h-auto object-contain bg-black" />
                    </div>
                )}
                <div className="absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/95 via-black/60 to-transparent px-4 pb-3 pt-14 flex flex-col items-center">
                    {anomalous ? (
                        <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-yellow-500/20 rounded-lg border border-yellow-500/50"><AlertTriangle size={18} className="text-yellow-300" /><span className="text-lg font-bold text-yellow-300">SIN LECTURA</span></div>
                    ) : (
                        <div className="inline-block px-4 py-1.5 bg-black/50 rounded-lg border border-blue-400/40 backdrop-blur-sm"><span className="font-mono text-3xl font-bold tracking-[0.2em] text-white drop-shadow">{plate}</span></div>
                    )}
                    <div className="mt-1.5 text-[11px] text-white/80 flex items-center gap-2">
                        {marca && <span className="font-semibold">{marca}</span>}
                        <span>{ev.device?.name || "Dispositivo"}</span>
                        <span className="text-white/50">&middot; <TimeAgo timestamp={ev.timestamp} /></span>
                    </div>
                    {plate && !anomalous && (
                        <div className="mt-2 flex gap-2">
                            <button onClick={(e) => { e.stopPropagation(); router.push(`/admin/history?search=${encodeURIComponent(plate)}`); }} className="px-3 py-1 rounded-md bg-white/15 hover:bg-white/25 text-white text-[10px] font-bold uppercase tracking-wide backdrop-blur transition-colors">Investigar</button>
                            {!ok && <button onClick={(e) => { e.stopPropagation(); onRegister?.(plate); }} className="px-3 py-1 rounded-md bg-emerald-500/80 hover:bg-emerald-500 text-white text-[10px] font-bold uppercase tracking-wide transition-colors">Registrar</button>}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

function parseMeta(details: string | null) {
    const meta: any = {};
    if (details) {
        // parseo genérico (pares k: v) …
        details.split(',').forEach(p => {
            const idx = p.indexOf(':');
            if (idx > 0) { const k = p.slice(0, idx).trim(); const v = p.slice(idx + 1).trim(); if (k && v) meta[k] = v; }
        });
        // … y extracción robusta por regex (funciona aunque venga "ALERTA: … Marca: X")
        const grab = (key: string) => { const m = details.match(new RegExp(key + "\\s*:\\s*([^,]+)", "i")); return m ? m[1].trim() : ""; };
        const marca = grab("Marca"); if (marca) meta.Marca = marca;
        const modelo = grab("Modelo"); if (modelo && !/^unknown$/i.test(modelo)) meta.Modelo = modelo; else delete meta.Modelo;
        const tipo = grab("Tipo"); if (tipo && !/^(unknown|vehicle)$/i.test(tipo)) meta.Tipo = tipo;
        const color = grab("Color"); if (color && !/^unknown$/i.test(color)) meta.Color = color;
    }
    if (meta.Marca) {
        let cleanBrand = meta.Marca.replace(/\s*UNKNOWN\s*/gi, '').trim();
        const brandCodeMatch = cleanBrand.match(/BRAND\s*(\d+)/i);
        if (brandCodeMatch) cleanBrand = getVehicleBrandName(brandCodeMatch[1]);
        if (/^unknown$/i.test(cleanBrand)) cleanBrand = "";
        meta.Marca = cleanBrand;
    }
    return meta;
}

const _nvrChCache = new Map<string, Promise<number | null>>();
function fetchNvrChannel(deviceId: string): Promise<number | null> {
    if (!_nvrChCache.has(deviceId)) {
        _nvrChCache.set(deviceId, fetch(`/api/nvr/channel?deviceId=${deviceId}`, { cache: "no-store" }).then((r) => r.json()).then((d) => (d && d.channel != null ? Number(d.channel) : null)).catch(() => null));
    }
    return _nvrChCache.get(deviceId)!;
}

function VehicleCardSkeleton() {
    return (
        <div className="p-3 border-b border-border animate-pulse">
            <div className="flex items-center gap-3">
                <div className="w-16 h-14 rounded-lg bg-muted/50 shrink-0" />
                <div className="flex-1 min-w-0 space-y-2">
                    <div className="flex items-center gap-2"><div className="h-3.5 w-24 rounded bg-muted/50" /><div className="h-3 w-8 rounded bg-muted/40" /></div>
                    <div className="h-2.5 w-32 rounded bg-muted/40" />
                    <div className="h-2.5 w-20 rounded bg-muted/30" />
                </div>
                <div className="flex items-center gap-1 shrink-0"><div className="w-7 h-7 rounded-lg bg-muted/40" /><div className="w-7 h-7 rounded-lg bg-muted/40" /></div>
            </div>
        </div>
    );
}

const VehicleCard = memo(function VehicleCard({ event, onRegister, platesWithParking, watchMap }: { event: any; onRegister: (p?: string) => void; platesWithParking?: Set<string>; watchMap?: Record<string, any> }) {
    const router = useRouter();
    const meta = parseMeta(event.details);
    const logoUrl = getCarLogo(meta.Marca);
    const fullImageUrl = getImagePath(event.snapshotPath || event.imagePath) || "";
    const isAnomalous = event.plateDetected === "NO_LEIDA" || event.plateDetected === "unknown" || event.plateDetected === "S/P" || !event.plateDetected;
    const hasPlaza = !!(event.plateDetected && platesWithParking && platesWithParking.has(String(event.plateDetected).toUpperCase()));
    const _wp = event.plateDetected ? String(event.plateDetected).toUpperCase() : "";
    const watch = (event as any).watch || (watchMap && _wp ? watchMap[_wp] : null);
    const watchMeta = watch ? watchCatMeta(watch.category) : null;
    const watchStyle = watchMeta ? { ring: watchMeta.ring, badge: watchMeta.badge, label: watchMeta.label.toUpperCase() } : null;
    const tipo = tipoDeteccion(event, watch);
    const [showPark, setShowPark] = useState(false);
    const [nvrCh, setNvrCh] = useState<number | null>(null);
    const [showVid, setShowVid] = useState(false);
    useEffect(() => { let alive = true; const dev = (event as any).device; if (dev?.id) fetchNvrChannel(dev.id).then((ch) => { if (alive) setNvrCh(ch); }); return () => { alive = false; }; }, [(event as any).device?.id]);
    return (
      <>
        <EventDetailsDialog event={event} timeStatus={null} onRegister={(p) => onRegister(p)}>
            <div className={cn(
                "relative p-3 cursor-pointer transition-all group border-b border-border last:border-0",
                isAnomalous ? "bg-yellow-500/5 hover:bg-yellow-500/10" : "hover:bg-accent",
                watchStyle?.ring || tipo?.ring
            )}>
                {tipo && <span className={cn("absolute left-0 top-0 bottom-0 w-1", tipo.dot)} />}
                <div className="flex items-center gap-3">
                    <div className="w-16 h-14 rounded-lg border border-border shrink-0 bg-card/60 flex items-center justify-center overflow-hidden p-1.5" title={meta.Marca || "Marca desconocida"}>
                        {logoUrl ? <Image src={logoUrl} alt={meta.Marca || "marca"} width={48} height={48} className="object-contain w-full h-full" /> : <Car size={22} className="text-muted-foreground" />}
                    </div>
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                            {isAnomalous ? (
                                <div className="flex items-center gap-1 text-yellow-400">
                                    <AlertTriangle size={12} />
                                    <span className="text-xs font-bold">SIN LECTURA</span>
                                </div>
                            ) : (
                                <span className="font-mono text-sm font-bold text-foreground tracking-wider">{event.plateDetected}</span>
                            )}
                            <Badge variant="outline" className={cn("text-[9px] px-1.5 py-0", event.decision === "GRANT" ? "border-emerald-500/50 text-emerald-400" : "border-red-500/50 text-red-400")}>{event.decision === "GRANT" ? "OK" : "DENY"}</Badge>
                            {watchStyle && <span className={cn("inline-flex items-center gap-1 text-[8px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded", watchStyle.badge)} title={watch?.label || ""}><ShieldAlert size={9} /> {watchStyle.label}</span>}
                            {!watchStyle && tipo && <span className={cn("inline-flex items-center gap-1 text-[8px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded", tipo.badge)}>{tipo.label}{tipo.key === "residente" && event.user?.unit?.name ? ` · ${event.user.unit.name}` : ""}</span>}
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                            {meta.Marca && <span className="text-[10px] text-muted-foreground font-semibold">{meta.Marca}{(meta.Modelo || meta.Tipo) ? ` · ${meta.Modelo || meta.Tipo}` : ""}</span>}
                            {event.user?.name && (<span className="text-[10px] text-blue-400 truncate">{event.user.name}</span>)}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5 text-[10px] text-muted-foreground">
                            <TimeAgo timestamp={event.timestamp} />
                            {event.device?.name && <span>&middot; {event.device.name}</span>}
                        </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0 self-center">
                        {event.plateDetected && !isAnomalous && (<>
                            <button onClick={(e) => { e.stopPropagation(); router.push(`/admin/history?search=${encodeURIComponent(event.plateDetected!)}`); }} title="Investigar" className="p-2 rounded-lg text-blue-500 hover:bg-blue-500/15 transition-colors"><Search size={17} /></button>
                            {event.decision !== "GRANT" && <button onClick={(e) => { e.stopPropagation(); onRegister(event.plateDetected!); }} title="Registrar" className="p-2 rounded-lg text-emerald-500 hover:bg-emerald-500/15 transition-colors"><UserPlus size={17} /></button>}
                        </>)}
                        {nvrCh != null && <button onClick={(e) => { e.stopPropagation(); setShowVid(true); }} title="Ver grabación" className="p-2 rounded-lg text-cyan-400 hover:bg-cyan-500/15 transition-colors"><PlayCircle size={17} /></button>}
                        <button onClick={(e) => { e.stopPropagation(); setShowPark(true); }} title={hasPlaza ? "Ver plaza y camino al lote" : "Sin plaza asignada"} className={cn("p-2 rounded-lg transition-colors", hasPlaza ? "text-emerald-500 hover:bg-emerald-500/15" : "text-red-500 hover:bg-red-500/15")}><SquareParking size={18} /></button>
                    </div>
                </div>
            </div>
        </EventDetailsDialog>
        {showPark && <ParkingLocationDialog plate={event.plateDetected || ""} onClose={() => setShowPark(false)} />}
        {showVid && nvrCh != null && <NvrTimeMachine open={showVid} onClose={() => setShowVid(false)} deviceId={(event as any).device?.id} channel={nvrCh} eventTimeMs={new Date(event.timestamp).getTime()} deviceName={(event as any).device?.name} evidenceUrl={fullImageUrl || undefined} plate={event.plateDetected} />}
      </>
    );
});

/** Une los puntos con las esquinas redondeadas, como una ruta de mapa. */
function trazoRedondeado(pts: { x: number; y: number }[], radio = 14) {
    if (!pts.length) return "";
    if (pts.length < 3) return pts.map((p, i) => (i ? "L" : "M") + ` ${p.x} ${p.y}`).join(" ");
    let d = `M ${pts[0].x} ${pts[0].y}`;
    for (let i = 1; i < pts.length - 1; i++) {
        const a = pts[i - 1], b = pts[i], c = pts[i + 1];
        const v1 = { x: b.x - a.x, y: b.y - a.y }, v2 = { x: c.x - b.x, y: c.y - b.y };
        const l1 = Math.hypot(v1.x, v1.y) || 1, l2 = Math.hypot(v2.x, v2.y) || 1;
        const r = Math.min(radio, l1 / 2, l2 / 2);
        d += ` L ${b.x - (v1.x / l1) * r} ${b.y - (v1.y / l1) * r}`;
        d += ` Q ${b.x} ${b.y} ${b.x + (v2.x / l2) * r} ${b.y + (v2.y / l2) * r}`;
    }
    const f = pts[pts.length - 1];
    return d + ` L ${f.x} ${f.y}`;
}

function ParkingLocationDialog({ plate, onClose }: { plate: string; onClose: () => void }) {
    const [data, setData] = useState<any>(null);
    const [elems, setElems] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    // El overlay se dibuja en píxeles, no en un viewBox 0-100 deformado: si no, los
    // círculos salen elípticos y los guiones de la ruta quedan de largo distinto
    // según hacia dónde vaya la línea.
    const imgRef = useRef<HTMLImageElement>(null);
    const [caja, setCaja] = useState({ w: 0, h: 0 });
    useEffect(() => {
        const el = imgRef.current; if (!el) return;
        const medir = () => setCaja({ w: el.clientWidth, h: el.clientHeight });
        medir();
        const ro = new ResizeObserver(medir); ro.observe(el);
        return () => ro.disconnect();
    }, [data?.mapUrl, loading]);
    useEffect(() => {
        let alive = true;
        Promise.all([getPlateParking(plate), getParkingElements().catch(() => null)])
            .then(([d, e]) => { if (alive) { setData(d); setElems(e); setLoading(false); } })
            .catch(() => { if (alive) setLoading(false); });
        return () => { alive = false; };
    }, [plate]);

    const points: any[] | null = (() => { try { return data?.points ? (typeof data.points === "string" ? JSON.parse(data.points) : data.points) : null; } catch { return null; } })();
    const norm = (p: any) => ({ x: p.x <= 1 ? p.x * 100 : p.x, y: p.y <= 1 ? p.y * 100 : p.y });
    const centroid = points && points.length ? { x: points.reduce((a: number, p: any) => a + norm(p).x, 0) / points.length, y: points.reduce((a: number, p: any) => a + norm(p).y, 0) / points.length } : null;

    // Camino desde la entrada más cercana hasta el lote, ruteado por las calles dibujadas.
    const route = useMemo<any[] | null>(() => {
        if (!centroid || !elems) return null;
        const entradas = (elems.entradas || []).map(norm);
        const calles = (elems.calles || []);
        const D = (a: any, b: any) => Math.hypot(a.x - b.x, a.y - b.y);
        if (!entradas.length) return null;
        let ent = entradas[0]; for (const e of entradas) if (D(e, centroid) < D(ent, centroid)) ent = e;
        // grafo euclidiano de las calles
        const nodes: any[] = [];
        const push = (p: any) => { const n = norm(p); for (let i = 0; i < nodes.length; i++) if (D(nodes[i], n) < 1.4) return i; nodes.push(n); return nodes.length - 1; };
        const adj = new Map<number, { to: number; w: number }[]>();
        const link = (a: number, b: number) => { const w = D(nodes[a], nodes[b]); (adj.get(a) || adj.set(a, []).get(a)!).push({ to: b, w }); (adj.get(b) || adj.set(b, []).get(b)!).push({ to: a, w }); };
        for (const c of calles) { let prev = -1; for (const pt of c.points) { const id = push(pt); if (prev >= 0 && prev !== id) link(prev, id); prev = id; } }
        if (nodes.length < 2) return [ent, centroid];
        const nearest = (pt: any) => { let bi = 0, bd = Infinity; for (let i = 0; i < nodes.length; i++) { const d = D(nodes[i], pt); if (d < bd) { bd = d; bi = i; } } return bi; };
        const sI = nearest(ent), tI = nearest(centroid);
        const dj = (s: number, t: number) => {
            const dist = new Array(nodes.length).fill(Infinity); const prev = new Array(nodes.length).fill(-1); const vis = new Array(nodes.length).fill(false); dist[s] = 0;
            for (let it = 0; it < nodes.length; it++) { let u = -1, bd = Infinity; for (let i = 0; i < nodes.length; i++) if (!vis[i] && dist[i] < bd) { bd = dist[i]; u = i; } if (u < 0) break; vis[u] = true; for (const e of (adj.get(u) || [])) if (dist[u] + e.w < dist[e.to]) { dist[e.to] = dist[u] + e.w; prev[e.to] = u; } }
            const path: any[] = []; let cur = t; while (cur >= 0) { path.unshift(nodes[cur]); cur = prev[cur]; } return path.length > 1 ? path : null;
        };
        const mid = dj(sI, tI);
        return mid ? [ent, ...mid, centroid] : [ent, centroid];
    }, [centroid, elems]);

    // Todo pasa a píxeles de la imagen ya renderizada
    const aPx = (p: { x: number; y: number }) => ({ x: (p.x / 100) * caja.w, y: (p.y / 100) * caja.h });
    const rutaPx = route && caja.w ? route.map(aPx) : null;
    const routeD = rutaPx ? trazoRedondeado(rutaPx, Math.max(8, Math.min(caja.w, caja.h) * 0.02)) : "";
    const largoRuta = rutaPx ? rutaPx.reduce((t, p, i) => (i ? t + Math.hypot(p.x - rutaPx[i - 1].x, p.y - rutaPx[i - 1].y) : 0), 0) : 0;
    const destino = centroid && caja.w ? aPx(centroid) : null;
    const origen = rutaPx?.[0] ?? null;
    const escala = Math.max(0.7, Math.min(1.6, Math.min(caja.w, caja.h) / 700));

    return (
        <div className="fixed inset-0 z-[200] bg-black/80 backdrop-blur-md flex items-center justify-center p-6 animate-in fade-in duration-200" onClick={onClose}>
            <style>{`
              @keyframes oaDibuja{from{stroke-dashoffset:var(--largo)}to{stroke-dashoffset:0}}
              @keyframes oaFlujo{from{stroke-dashoffset:var(--largo)}to{stroke-dashoffset:calc(var(--largo) * -1)}}
              @keyframes oaLatido{0%{transform:scale(.6);opacity:.55}70%{transform:scale(2.1);opacity:0}100%{opacity:0}}
              @keyframes oaCae{0%{transform:translateY(-14px) scale(.85);opacity:0}60%{transform:translateY(2px) scale(1.03)}100%{transform:translateY(0) scale(1);opacity:1}}
              @keyframes oaAura{0%,100%{opacity:.35}50%{opacity:.8}}
            `}</style>
            <div className="relative w-[92vw] max-w-[1400px] rounded-2xl overflow-hidden shadow-2xl animate-in zoom-in-95 duration-200" onClick={(e) => e.stopPropagation()}>
                <button onClick={onClose} className="absolute top-3 right-3 z-20 p-2 rounded-full bg-black/50 backdrop-blur text-white/80 hover:text-white hover:bg-black/70 transition-colors"><X size={18} /></button>
                {loading ? (
                    <div className="bg-card p-20 flex flex-col items-center gap-3 text-muted-foreground"><Loader2 size={24} className="animate-spin" /><span className="text-xs font-bold uppercase tracking-widest">Buscando plaza…</span></div>
                ) : !data?.found ? (
                    <div className="bg-card p-14 text-center"><MapPin size={30} className="mx-auto text-red-400 mb-3" /><p className="text-base font-bold text-foreground">Sin plaza asignada</p><p className="text-xs text-muted-foreground mt-1">{data?.resident ? `${data.resident}${data.unitNumber ? " · Unidad " + data.unitNumber : ""}` : `${plate} no tiene una plaza en el barrio.`}</p></div>
                ) : (
                    <div className="relative bg-black">
                        {data.mapUrl ? (
                            <img ref={imgRef} src={data.mapUrl} alt="Plano del barrio" className="w-full max-h-[82vh] object-contain grayscale opacity-55 invert select-none pointer-events-none" draggable={false} onLoad={() => setCaja({ w: imgRef.current?.clientWidth || 0, h: imgRef.current?.clientHeight || 0 })} />
                        ) : <div className="p-16 text-center text-xs text-muted-foreground">No hay plano del barrio cargado.</div>}
                        {data.mapUrl && caja.w > 0 && (
                            <svg className="absolute inset-0 w-full h-full pointer-events-none overflow-visible" viewBox={`0 0 ${caja.w} ${caja.h}`}>
                                <defs>
                                    <linearGradient id="oaRuta" x1="0" y1="0" x2="1" y2="1">
                                        <stop offset="0%" stopColor="#38bdf8" /><stop offset="55%" stopColor="#3b82f6" /><stop offset="100%" stopColor="#6366f1" />
                                    </linearGradient>
                                    <filter id="oaBrillo" x="-40%" y="-40%" width="180%" height="180%">
                                        <feGaussianBlur stdDeviation={3 * escala} result="b" />
                                        <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
                                    </filter>
                                    <filter id="oaSombra" x="-60%" y="-60%" width="220%" height="220%">
                                        <feDropShadow dx="0" dy={2 * escala} stdDeviation={2.5 * escala} floodColor="#000" floodOpacity="0.55" />
                                    </filter>
                                </defs>

                                {/* La ruta: contorno oscuro, línea llena y un destello que la recorre */}
                                {routeD && <>
                                    <path d={routeD} fill="none" stroke="#0b1220" strokeOpacity={0.55} strokeWidth={11 * escala} strokeLinecap="round" strokeLinejoin="round" />
                                    <path d={routeD} fill="none" stroke="url(#oaRuta)" strokeWidth={6 * escala} strokeLinecap="round" strokeLinejoin="round"
                                        style={{ ["--largo" as any]: largoRuta, strokeDasharray: largoRuta, animation: "oaDibuja 1.1s cubic-bezier(.4,0,.2,1) forwards" }} />
                                    <path d={routeD} fill="none" stroke="#e0f2fe" strokeWidth={3 * escala} strokeLinecap="round" strokeLinejoin="round" filter="url(#oaBrillo)" opacity={0.9}
                                        style={{ ["--largo" as any]: largoRuta, strokeDasharray: `${Math.max(18, largoRuta * 0.07)} ${largoRuta}`, animation: "oaFlujo 2.6s linear infinite 1s" }} />
                                </>}

                                {/* El lote de destino */}
                                {points && caja.w > 0 && <path
                                    d={points.map((p: any, i: number) => { const q = aPx(norm(p)); return (i === 0 ? "M" : "L") + ` ${q.x} ${q.y}`; }).join(" ") + " Z"}
                                    fill="rgba(59,130,246,0.28)" stroke="#60a5fa" strokeWidth={2 * escala} strokeLinejoin="round"
                                    style={{ animation: "oaAura 2.2s ease-in-out infinite" }} />}

                                {/* Punto de partida: la entrada */}
                                {origen && <g>
                                    <circle cx={origen.x} cy={origen.y} r={9 * escala} fill="#38bdf8" style={{ transformOrigin: `${origen.x}px ${origen.y}px`, animation: "oaLatido 2s ease-out infinite" }} />
                                    <circle cx={origen.x} cy={origen.y} r={7 * escala} fill="#fff" filter="url(#oaSombra)" />
                                    <circle cx={origen.x} cy={origen.y} r={4.5 * escala} fill="#0ea5e9" />
                                </g>}

                                {/* Destino: pin de gota que cae al abrir */}
                                {destino && <g style={{ transformOrigin: `${destino.x}px ${destino.y}px`, animation: "oaCae .5s cubic-bezier(.34,1.4,.64,1) .9s backwards" }}>
                                    <ellipse cx={destino.x} cy={destino.y + 1.5 * escala} rx={5.5 * escala} ry={2 * escala} fill="#000" opacity={0.35} />
                                    <path d={`M ${destino.x} ${destino.y} c ${-6 * escala} ${-9 * escala} ${-9.5 * escala} ${-13 * escala} ${-9.5 * escala} ${-18.5 * escala} a ${9.5 * escala} ${9.5 * escala} 0 1 1 ${19 * escala} 0 c 0 ${5.5 * escala} ${-3.5 * escala} ${9.5 * escala} ${-9.5 * escala} ${18.5 * escala} z`}
                                        fill="#2563eb" stroke="#fff" strokeWidth={1.6 * escala} filter="url(#oaSombra)" />
                                    <circle cx={destino.x} cy={destino.y - 18.5 * escala} r={3.6 * escala} fill="#fff" />
                                </g>}
                            </svg>
                        )}
                        {/* Datos en overlay — se ubica en el rincón opuesto a la plaza para no tapar el camino */}
                        <div className={cn("absolute z-10 bg-black/55 backdrop-blur-xl rounded-xl px-4 py-3 border border-white/10 shadow-lg pointer-events-none", centroid ? cn(centroid.y < 50 ? "bottom-3" : "top-3", centroid.x < 50 ? "right-3" : "left-3") : "top-3 left-3")}>
                            <div className="flex items-center gap-2 mb-2"><SquareParking size={16} className="text-blue-400" /><span className="text-xs font-bold uppercase tracking-widest text-white">Ubicación de <span className="font-mono text-blue-300">{plate}</span></span></div>
                            <div className="flex items-center gap-5">
                                <div><span className="text-[9px] text-white/50 uppercase tracking-widest block">Plaza</span><span className="text-xl font-bold text-blue-300 leading-none">{data.label}</span></div>
                                {data.unitNumber && <div><span className="text-[9px] text-white/50 uppercase tracking-widest block">Unidad</span><span className="text-sm font-bold text-white">{data.unitNumber}</span></div>}
                                {data.resident && <div className="min-w-0 max-w-[160px]"><span className="text-[9px] text-white/50 uppercase tracking-widest block">Residente</span><span className="text-sm font-bold text-white truncate block">{data.resident}</span></div>}
                            </div>
                            {route && <div className="mt-2 flex items-center gap-1.5 text-[10px] text-sky-300"><span className="inline-block w-4 h-[3px] rounded-full bg-gradient-to-r from-sky-400 to-indigo-500" /> Camino desde la entrada</div>}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

/** Mini-ventanas apiladas abajo a la derecha con las lecturas anómalas.
 *  Quedan FIJAS hasta que el guardia cierra cada una (o todas). */
function PinnedAnomalies({ items, onDismiss, onClear, onRegister }: { items: any[]; onDismiss: (id: string) => void; onClear: () => void; onRegister: (p?: string) => void }) {
    if (!items.length) return null;
    return (
        <div className="fixed bottom-4 right-4 z-[400] w-[340px] max-w-[92vw] flex flex-col gap-2 pointer-events-none">
            <div className="flex items-center justify-between px-1 pointer-events-auto">
                <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-yellow-300">
                    <AlertTriangle size={13} /> Lecturas para revisar · {items.length}
                </span>
                <button onClick={onClear} className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground hover:text-foreground bg-card border border-border rounded px-2 py-0.5">Cerrar todas</button>
            </div>
            <div className="flex flex-col gap-2 pr-0.5 pointer-events-auto">
                {items.slice(0, 4).map((ev) => {
                    const plate = (ev.plateDetected || "").toUpperCase();
                    const anomalous = !ev.plateDetected || ["NO_LEIDA", "UNKNOWN", "S/P"].includes(plate);
                    const watch = ev.watch;
                    const watchMeta = watch ? watchCatMeta(watch.category) : null;
                    const tipo = tipoDeteccion(ev, watch);
                    const img = getImagePath(ev.snapshotPath || ev.imagePath) || "";
                    const dir = ev.direction;
                    const isBlack = tipo?.key === "negra";
                    return (
                        <div key={ev.id} className={cn(
                            "relative rounded-xl border bg-card shadow-2xl overflow-hidden animate-in slide-in-from-right-4 duration-200",
                            isBlack ? "border-red-500/60 ring-2 ring-red-500/40" : anomalous ? "border-yellow-500/50" : "border-border"
                        )}>
                            <button onClick={() => onDismiss(ev.id)} title="Cerrar" className="absolute top-1.5 right-1.5 z-10 h-6 w-6 rounded-md bg-black/50 hover:bg-black/70 text-white/80 hover:text-white flex items-center justify-center backdrop-blur"><X size={13} /></button>
                            <EventDetailsDialog event={ev} timeStatus={null} onRegister={(p) => onRegister(p)}>
                                <div className="flex gap-2.5 p-2.5 cursor-pointer">
                                    <div className="w-24 h-16 rounded-lg overflow-hidden shrink-0 border border-border">
                                        <SmartThumb src={img} w={240} className="w-full h-full" />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-1.5 flex-wrap">
                                            {anomalous ? (
                                                <span className="inline-flex items-center gap-1 text-xs font-bold text-yellow-300"><AlertTriangle size={12} /> SIN LECTURA</span>
                                            ) : (
                                                <span className="font-mono text-sm font-bold tracking-wider text-foreground">{ev.plateDetected}</span>
                                            )}
                                            <Badge className={cn("text-[8px] px-1 py-0", dir === "EXIT" ? "bg-orange-500" : "bg-emerald-500")}>{dir === "EXIT" ? "SALIDA" : "ENTRADA"}</Badge>
                                        </div>
                                        <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                                            {watchMeta
                                                ? <span className={cn("inline-flex items-center gap-1 text-[8px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded", watchMeta.badge)}><ShieldAlert size={9} /> {watchMeta.label.toUpperCase()}</span>
                                                : tipo && <span className={cn("inline-flex items-center gap-1 text-[8px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded", tipo.badge)}>{tipo.label}{tipo.key === "residente" && ev.user?.unit?.name ? ` · ${ev.user.unit.name}` : ""}</span>}
                                            {ev.user?.name && <span className="text-[10px] text-blue-400 truncate max-w-[120px]">{ev.user.name}</span>}
                                        </div>
                                        <div className="mt-1 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                                            <TimeAgo timestamp={ev.timestamp} />
                                            {ev.device?.name && <span className="truncate">· {ev.device.name}</span>}
                                        </div>
                                    </div>
                                </div>
                            </EventDetailsDialog>
                        </div>
                    );
                })}
            </div>
            {items.length > 4 && (
                <div className="relative h-8 mt-0.5 pointer-events-auto">
                    <div className="absolute inset-x-3 top-2 h-7 rounded-xl bg-card/50 border border-border" />
                    <div className="absolute inset-x-1.5 top-1 h-7 rounded-xl bg-card/75 border border-border" />
                    <div className="absolute inset-x-0 top-0 h-8 rounded-xl bg-card border border-border shadow-lg flex items-center justify-center gap-1.5 text-[11px] font-bold text-muted-foreground">
                        <AlertTriangle size={12} className="text-yellow-400" /> +{items.length - 4} en cola
                    </div>
                </div>
            )}
        </div>
    );
}

export default function MonitorLPR() {
    const [events, setEvents] = useState<FullAccessEvent[]>([]);
    const [socket, setSocket] = useState<Socket | null>(null);
    const [activeFilter, setActiveFilter] = useState<"ALL" | "GRANT" | "DENY">("ALL");
    const [filterColor, setFilterColor] = useState<string>("ALL");
    const [filterVehType, setFilterVehType] = useState<string>("ALL");
    const [stats, setStats] = useState({ total: 0, grants: 0, denies: 0 });
    const [aforo, setAforo] = useState({ entradas: 0, salidas: 0, inside: 0 });
    // "Adentro" = autos en casa = plazas ocupadas / total (getPresenceSummary)
    const [presence, setPresence] = useState({ adentro: 0, total: 0 });
    const [lastCapByDev, setLastCapByDev] = useState<Record<string, any>>({});
    const [isConnected, setIsConnected] = useState(false);
    const [devices, setDevices] = useState<Device[]>([]);
    const [streams, setStreams] = useState<string[]>([]);
    const [interiores, setInteriores] = useState<any[]>([]);
    const [avistPorCam, setAvistPorCam] = useState<Record<string, any>>({});
    const [avistUltimos, setAvistUltimos] = useState<any[]>([]);
    const [cuadroAbierto, setCuadroAbierto] = useState<number | null>(null);
    const [verInteriores, setVerInteriores] = useState(true);
    const router = useRouter();
    const [units, setUnits] = useState<any[]>([]);
    const [groups, setGroups] = useState<any[]>([]);
    const [parkingSlots, setParkingSlots] = useState<any[]>([]);
    const [registerOpen, setRegisterOpen] = useState(false);
    const [registerInit, setRegisterInit] = useState<{ plate?: string } | undefined>(undefined);
    const [merodeo, setMerodeo] = useState<any | null>(null);
    const [eventsLoading, setEventsLoading] = useState(true);
    const pendingRef = useRef<any[]>([]);
    // Lecturas anómalas fijadas (sin lectura / lista negra / lista blanca / vigilancia):
    // quedan como mini-ventanas apiladas abajo hasta que el guardia las cierra.
    const [pinned, setPinned] = useState<any[]>([]);
    const dismissedRef = useRef<Set<string>>(new Set()); // ids que el guardia cerró: no reaparecen
    const dismissPin = useCallback((id: string) => { dismissedRef.current.add(id); setPinned(p => p.filter(x => x.id !== id)); }, []);
    // Toggle del popup automático de lecturas anómalas — DESHABILITADO por defecto.
    const [pinEnabled, setPinEnabled] = useState(false);
    useEffect(() => { if (!pinEnabled) { setPinned([]); dismissedRef.current.clear(); } }, [pinEnabled]);

    const lastEntry = events.find(e => e.direction === 'ENTRY');
    const lastExit = events.find(e => e.direction === 'EXIT');

    const loadInitialData = async () => {
        try {
            const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
            const data = await getAccessEvents({ take: 50, from: twentyFourHoursAgo, type: "PLATE" });
            setEvents(data.events as FullAccessEvent[]);
            setEventsLoading(false);
            const todayStats = await getEventsCountToday("PLATE");
            setStats(todayStats);
            getLprCounters().then(setAforo).catch(() => {});
            getPresenceSummary().then((p) => setPresence({ adentro: p.adentro, total: p.total })).catch(() => {});
        } catch (error) {
            console.error("Error loading LPR data:", error);
        }
    };

    useEffect(() => { getDevices().then((d: any) => { const todos = d || []; setDevices(todos.filter((x: any) => x.deviceType === "LPR_CAMERA")); setInteriores(todos.filter((x: any) => x.deviceType === "LPR_INTERIOR" && x.trackEnabled !== false)); }).catch(() => {}); getLastEventPerDevice().then(setLastCapByDev).catch(() => {}); getAvailableStreams().then((s: any) => setStreams(s || [])).catch(() => {}); }, []);
    // Las interiores no generan evento de acceso: lo unico que se sabe de ellas son
    // los avistamientos que publica Omni-LPR, asi que se piden aparte.
    useEffect(() => {
        let vivo = true;
        const traer = async () => {
            try { const r = await fetch("/api/tracking/recent", { cache: "no-store" }); const j = await r.json(); if (vivo) { setAvistPorCam(j?.porCamara || {}); setAvistUltimos(j?.ultimos || []); } } catch { }
        };
        traer();
        const iv = setInterval(traer, 10000);
        return () => { vivo = false; clearInterval(iv); };
    }, []);
    const [platesPark, setPlatesPark] = useState<Set<string>>(new Set());
    useEffect(() => { Promise.all([getUnits(), getAccessGroups(), getParkingSlots()]).then(([u, g, p]: any) => { setUnits(u || []); setGroups(g || []); setParkingSlots(p || []); }).catch(() => {}); getPlatesWithParking().then((pl) => setPlatesPark(new Set(pl))).catch(() => {}); }, []);

    // Watchlist (lista negra / búsqueda / VIP) — resaltado + sonido
    const [watchMap, setWatchMap] = useState<Record<string, any>>({});
    const [showWatch, setShowWatch] = useState(false);
    const [soundOn, setSoundOn] = useState(true);
    const soundOnRef = useRef(true);
    useEffect(() => { soundOnRef.current = soundOn; }, [soundOn]);
    const alertAudioRef = useRef<HTMLAudioElement | null>(null);
    const lastAlertRef = useRef<Record<string, number>>({});
    const refreshWatch = useCallback(() => { getWatchMap().then((m) => setWatchMap(m || {})).catch(() => { }); }, []);
    useEffect(() => { refreshWatch(); const iv = setInterval(refreshWatch, 60000); return () => clearInterval(iv); }, [refreshWatch]);
    const playWatchAlert = useCallback((plate: string) => {
        if (!soundOnRef.current) return;
        const now = Date.now();
        if (lastAlertRef.current[plate] && now - lastAlertRef.current[plate] < 4000) return; // throttle por placa
        lastAlertRef.current[plate] = now;
        try { const a = alertAudioRef.current || (alertAudioRef.current = new Audio("/sounds/alert.mp3")); a.currentTime = 0; a.volume = 1; a.play().catch(() => { }); } catch { }
    }, []);

    // Auto-refresh cada 5s: mismo efecto que el botón de refrescar (re-baja los eventos
    // con snapshotPath actualizado, no sólo cache-bust de imágenes).
    useEffect(() => {
        const id = setInterval(() => { loadInitialData(); }, 5000);
        return () => clearInterval(id);
    }, []);

    useEffect(() => {
        loadInitialData();
        // Conectar al MISMO origen con el path proxificado por NPM/next-server (/io/socket.io).
        // Con el path por defecto (/socket.io) el socket quedaba OFFLINE al entrar por el dominio.
        // Transporte POLLING only: por el dominio, el upgrade a WebSocket pasa por el doble
        // proxy (NPM → next-server → server.js) y falla con "Invalid frame header", spameando
        // reintentos. El long-polling es estable y casi en tiempo real; evita el flood.
        const newSocket = io(window.location.origin, {
            path: "/io/socket.io",
            transports: ["polling"],
            upgrade: false,
            reconnection: true,
            reconnectionAttempts: Infinity,
            reconnectionDelay: 1000,
            reconnectionDelayMax: 8000,
            timeout: 8000,
        });

        // Robustez: si el server se reinicia o se corta la red, al RE-conectar re-sincronizamos
        // (los eventos emitidos durante la desconexión no se re-emiten solos).
        let hadSession = false;
        newSocket.on("connect", () => {
            setIsConnected(true);
            if (hadSession) loadInitialData();
            hadSession = true;
        });
        newSocket.on("disconnect", () => setIsConnected(false));
        newSocket.on("connect_error", () => setIsConnected(false));
        // Watchdog: si quedó desconectado (sesión muerta, 400 en polling), forzar reconexión limpia.
        const watchdog = setInterval(() => {
            if (!newSocket.connected) { try { newSocket.connect(); } catch { } }
        }, 10000);
        // Al volver a la pestaña: reconectar si hace falta y re-sincronizar.
        const onVisible = () => {
            if (document.visibilityState === "visible") {
                if (!newSocket.connected) { try { newSocket.connect(); } catch { } }
                loadInitialData();
            }
        };
        document.addEventListener("visibilitychange", onVisible);
        window.addEventListener("online", onVisible);

        newSocket.on("access_event", (event: FullAccessEvent) => {
            // Only LPR events
            if (event.accessType !== "PLATE") return;

            const eventTime = new Date(event.timestamp).getTime();
            const limit = Date.now() - 24 * 60 * 60 * 1000;
            if (eventTime < limit) return;

            // Skip door open/close
            const plate = (event.plateDetected || '').toUpperCase();
            if (plate === 'DOOR_OPEN' || plate === 'DOOR_CLOSE') return;

            // Watchlist: alerta sonora inmediata si el server marcó la placa
            if ((event as any).watch && plate) playWatchAlert(plate);

            // Buffer the event; a 250ms flush loop coalesces bursts into a single render
            // so the main thread stays free to paint incoming snapshots.
            pendingRef.current.push(event);
        });

        newSocket.on("merodeo_alert", (a: any) => { setMerodeo(a); setTimeout(() => setMerodeo(null), 30000); });
        setSocket(newSocket);
        return () => {
            clearInterval(watchdog);
            document.removeEventListener("visibilitychange", onVisible);
            window.removeEventListener("online", onVisible);
            newSocket.disconnect();
        };
    }, []);

    // Flush buffered socket events at most ~4x/sec (batch) to avoid render storms.
    useEffect(() => {
        const iv = setInterval(() => {
            const batch = pendingRef.current;
            if (batch.length === 0) return;
            pendingRef.current = [];
            const ordered = batch.slice().reverse();
            setEvents(prev => [...ordered, ...prev].slice(0, 50) as FullAccessEvent[]);
            let g = 0, d = 0;
            for (const e of batch) { if (e.decision === "GRANT") g++; else if (e.decision === "DENY") d++; }
            setStats(s => ({ total: s.total + batch.length, grants: s.grants + g, denies: s.denies + d }));
            setAforo(a => {
                let entradas = a.entradas, salidas = a.salidas, inside = a.inside;
                for (const e of batch) { if (e.decision === "GRANT") { if (e.direction === "ENTRY") { entradas++; inside++; } else if (e.direction === "EXIT") { salidas++; inside = Math.max(0, inside - 1); } } }
                return { entradas, salidas, inside };
            });
        }, 250);
        return () => clearInterval(iv);
    }, []);

    // Popup automático de lecturas anómalas: cuando el toggle está activo, siembra las
    // mini-ventanas desde los eventos ya cargados (poll + socket), no solo de eventos nuevos.
    // Así aparecen apenas se activa, y quedan fijas hasta que el guardia las cierra.
    const esAnomala = useCallback((e: any) => {
        const plate = (e.plateDetected || "").toUpperCase();
        if (plate === "DOOR_OPEN" || plate === "DOOR_CLOSE") return false;
        const anomalous = !e.plateDetected || ["NO_LEIDA", "UNKNOWN", "S/P"].includes(plate);
        const role = (e.user?.role || "").toUpperCase();
        return anomalous || !!e.watch || role === "WHITELISTED" || role === "BLACKLISTED";
    }, []);
    useEffect(() => {
        if (!pinEnabled) return;
        setPinned((prev) => {
            const seen = new Set(prev.map((x) => x.id));
            const nuevos = events.filter((e) => esAnomala(e) && !seen.has(e.id) && !dismissedRef.current.has(e.id));
            if (!nuevos.length) return prev;
            return [...nuevos, ...prev].slice(0, 24);
        });
    }, [pinEnabled, events, esAnomala]);

    const vehFacets = useMemo(() => collectVehicleFacets(events as any[]), [events]);
    const filteredEvents = useMemo(() => {
        return events.filter(e => {
            const plate = (e.plateDetected || '').toUpperCase();
            if (plate === 'DOOR_OPEN' || plate === 'DOOR_CLOSE') return false;
            if (activeFilter !== "ALL" && e.decision !== activeFilter) return false;
            if (filterColor !== "ALL" || filterVehType !== "ALL") {
                const m = parseVehicleMeta(e.details);
                if (filterColor !== "ALL" && m.color !== filterColor) return false;
                if (filterVehType !== "ALL" && m.typeLabel !== filterVehType) return false;
            }
            return true;
        });
    }, [events, activeFilter, filterColor, filterVehType]);

    const entryEvents = useMemo(() => filteredEvents.filter(e => e.direction === 'ENTRY'), [filteredEvents]);
    const exitEvents = useMemo(() => filteredEvents.filter(e => e.direction === 'EXIT'), [filteredEvents]);
    const lprDevs = useMemo(() => devices, [devices]);
    const entryCams = useMemo(() => (lprDevs as any[]).filter((x: any) => x.direction === 'ENTRY'), [lprDevs]);
    const exitCams = useMemo(() => (lprDevs as any[]).filter((x: any) => x.direction === 'EXIT'), [lprDevs]);
    const lastByCam = useMemo(() => {
        const m: Record<string, any> = {};
        for (const e of events) { const id = (e as any).device?.id; if (id && !m[id]) m[id] = e; }
        return m;
    }, [events]);
    const hasStream = (id: any) => !!id && streams.includes(`lpr_${id}`);
    const pickCam = (evts: any[], dir: string) => {
        for (const e of evts) { if (hasStream(e?.device?.id)) return e.device.id; }
        const d = lprDevs.find((x: any) => x.direction === dir && hasStream(x.id)) || lprDevs.find((x: any) => hasStream(x.id));
        return d?.id || null;
    };
    const entryCam = useMemo(() => pickCam(entryEvents, "ENTRY"), [lprDevs, entryEvents, streams]);
    const exitCam = useMemo(() => pickCam(exitEvents, "EXIT"), [lprDevs, exitEvents, streams]);



    const centerPanes = useMemo(() => {
        const build = (ev: any, dir: string) => ev?.device?.id ? {
            dir, deviceId: ev.device.id,
            plate: ev.plateDetected as string | undefined,
            ok: ev.decision === "GRANT",
            anomalous: !ev.plateDetected || ["NO_LEIDA", "unknown", "S/P"].includes(ev.plateDetected || ""),
            marca: parseMeta(ev.details).Marca || ev.user?.name || "",
            deviceName: ev.device?.name || "Dispositivo",
        } : null;
        return [build(entryEvents[0], "ENTRY"), build(exitEvents[0], "EXIT")].filter(Boolean) as any[];
    }, [entryEvents, exitEvents]);

    const openRegister = useCallback((plate?: string) => { if (!plate) return; setRegisterInit({ plate: String(plate).toUpperCase() }); setRegisterOpen(true); }, []);

    return (
        <TooltipProvider>
            <div className="h-full flex flex-col bg-background text-foreground">
                {/* Header */}
                <div className="px-6 py-4 border-b border-border flex items-center justify-between shrink-0">
                    <div className="flex items-center gap-3">
                        <div className="p-2 rounded-xl bg-blue-500/10">
                            <Car size={22} className="text-blue-400" />
                        </div>
                        <div>
                            <h1 className="text-lg font-bold">Monitor LPR</h1>
                            <p className="text-xs text-muted-foreground">Reconocimiento de matrículas en tiempo real</p>
                        </div>
                    </div>

                    <PlateCommandBar />

                    <div className="flex items-center gap-2.5">
                        {/* Métricas unificadas en un solo bloque */}
                        <div className="flex items-center h-9 rounded-lg bg-card border border-border divide-x divide-border overflow-hidden">
                            <span className="flex items-center gap-1.5 px-3 h-full" title="Autos en casa (plazas ocupadas / total)">
                                <Home size={13} className="text-blue-400" />
                                <span className="text-[9px] text-muted-foreground uppercase tracking-wider font-bold">En casa</span>
                                <span className="font-bold text-blue-400 text-sm tabular-nums">{presence.adentro}<span className="text-muted-foreground font-normal text-[11px]">/{presence.total}</span></span>
                            </span>
                            <span className="flex items-center gap-1.5 px-3 h-full" title="Lecturas de hoy">
                                <span className="text-[9px] text-muted-foreground uppercase tracking-wider font-bold">Hoy</span>
                                <span className="font-bold text-foreground text-sm tabular-nums">{stats.total}</span>
                            </span>
                            <span className="flex items-center gap-1.5 px-3 h-full" title="Permitidos hoy">
                                <CheckCircle2 size={13} className="text-emerald-400" />
                                <span className="font-bold text-emerald-400 text-sm tabular-nums">{stats.grants}</span>
                            </span>
                            <span className="flex items-center gap-1.5 px-3 h-full" title="Denegados hoy">
                                <XCircle size={13} className="text-red-400" />
                                <span className="font-bold text-red-400 text-sm tabular-nums">{stats.denies}</span>
                            </span>
                        </div>

                        {/* Filtro de decisión (segmentado) */}
                        <div className="flex items-center h-9 bg-card border border-border rounded-lg p-0.5">
                            {(["ALL", "GRANT", "DENY"] as const).map(f => (
                                <button key={f} onClick={() => setActiveFilter(f)}
                                    className={cn("px-2.5 h-full text-[11px] font-semibold rounded-md transition-all",
                                        activeFilter === f ? "bg-blue-500 text-white shadow" : "text-muted-foreground hover:text-foreground")}>
                                    {f === "ALL" ? "Todos" : f === "GRANT" ? "Permitidos" : "Denegados"}
                                </button>
                            ))}
                        </div>

                        {/* Filtros color / tipo */}
                        {(vehFacets.colors.length > 0 || vehFacets.types.length > 0) && (
                            <div className="flex items-center gap-1.5">
                                {vehFacets.colors.length > 0 && (
                                    <select value={filterColor} onChange={(e) => setFilterColor(e.target.value)}
                                        className="h-9 rounded-lg bg-card border border-border px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-blue-500">
                                        <option value="ALL">Color</option>
                                        {vehFacets.colors.map((c) => <option key={c} value={c}>{c}</option>)}
                                    </select>
                                )}
                                {vehFacets.types.length > 0 && (
                                    <select value={filterVehType} onChange={(e) => setFilterVehType(e.target.value)}
                                        className="h-9 rounded-lg bg-card border border-border px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-blue-500">
                                        <option value="ALL">Tipo</option>
                                        {vehFacets.types.map((t) => <option key={t} value={t}>{t}</option>)}
                                    </select>
                                )}
                                {(filterColor !== "ALL" || filterVehType !== "ALL") && (
                                    <button onClick={() => { setFilterColor("ALL"); setFilterVehType("ALL"); }}
                                        className="h-9 w-9 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent border border-border" title="Limpiar filtros">
                                        <X size={14} />
                                    </button>
                                )}
                            </div>
                        )}

                        {/* Cluster de acciones (íconos) */}
                        <div className="flex items-center h-9 bg-card border border-border rounded-lg divide-x divide-border overflow-hidden">
                            <button onClick={() => setShowWatch(true)} title="Lista de vigilancia" className="relative h-full px-2.5 text-muted-foreground hover:text-red-400 hover:bg-accent transition-colors">
                                <ShieldAlert size={16} />
                                {Object.keys(watchMap).length > 0 && <span className="absolute top-0.5 right-0.5 min-w-[14px] h-[14px] px-1 rounded-full bg-red-500 text-white text-[8px] font-bold flex items-center justify-center">{Object.keys(watchMap).length}</span>}
                            </button>
                            <button onClick={() => setPinEnabled(v => !v)} title={pinEnabled ? "Popup automático de anomalías: ACTIVADO" : "Popup automático de anomalías: desactivado"}
                                className={cn("h-full px-2.5 transition-colors flex items-center gap-1.5", pinEnabled ? "bg-yellow-500/15 text-yellow-400" : "text-muted-foreground hover:text-foreground hover:bg-accent")}>
                                <AlertTriangle size={15} />
                                <span className={cn("relative inline-flex h-4 w-7 items-center rounded-full transition-colors", pinEnabled ? "bg-yellow-500" : "bg-muted-foreground/30")}>
                                    <span className={cn("inline-block h-3 w-3 transform rounded-full bg-white transition-transform", pinEnabled ? "translate-x-3.5" : "translate-x-0.5")} />
                                </span>
                            </button>
                            <button onClick={() => setSoundOn(s => !s)} title={soundOn ? "Silenciar alertas" : "Activar sonido"}
                                className={cn("h-full px-2.5 transition-colors", soundOn ? "text-muted-foreground hover:text-foreground hover:bg-accent" : "bg-red-500/10 text-red-400")}>
                                {soundOn ? <Volume2 size={16} /> : <VolumeX size={16} />}
                            </button>
                            <button onClick={loadInitialData} title="Refrescar" className="h-full px-2.5 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
                                <RefreshCw size={16} />
                            </button>
                        </div>

                        {showWatch && <WatchlistDialog onClose={() => { setShowWatch(false); refreshWatch(); }} />}
                    </div>
                </div>

                {merodeo && (
                    <div className="mx-6 mt-2 mb-1 flex items-center gap-3 rounded-xl border border-red-500/50 bg-red-500/10 px-4 py-2 shrink-0">
                        <AlertTriangle size={18} className="text-red-500 shrink-0" />
                        <div className="min-w-0 flex-1">
                            <p className="text-sm font-bold text-red-500">Merodeo detectado &mdash; <span className="font-mono tracking-wider">{merodeo.plate}</span></p>
                            <p className="text-[11px] text-muted-foreground truncate">{merodeo.count} pasadas en {merodeo.windowMin} min &middot; {merodeo.distinctDevices} acceso/s{merodeo.deviceName ? ` \u00b7 ${merodeo.deviceName}` : ""}</p>
                        </div>
                        <button onClick={() => setMerodeo(null)} className="text-muted-foreground hover:text-foreground shrink-0"><XCircle size={18} /></button>
                    </div>
                )}
                {/* Three columns */}
                <div className="flex-1 grid grid-cols-3 divide-x divide-neutral-800 overflow-hidden">
                    {/* ENTRIES */}
                    <div className="flex flex-col overflow-hidden">
                        <div className="shrink-0 p-3 pb-1">
                            <div className="flex items-center gap-1.5 mb-2">
                                <LogIn size={13} className="text-emerald-400" />
                                <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-300">Entradas</span>
                                <span className="ml-auto px-1.5 py-0.5 rounded-md text-[10px] font-bold border border-emerald-500/40 text-emerald-300">{entryCams.length} cám</span>
                            </div>
                            {entryCams.length === 0 ? (
                                <div className="flex items-center justify-center h-24 text-[11px] text-foreground/40 border border-dashed border-border rounded-lg">Sin cámaras de entrada</div>
                            ) : (
                                <div className={cn("grid gap-2", entryCams.length === 1 ? "grid-cols-1" : "grid-cols-2")}>
                                    {entryCams.map((d: any) => <CamTile key={d.id} dev={d} accent="emerald" ev={lastByCam[d.id] || lastCapByDev[d.id]} onRegister={openRegister} />)}
                                </div>
                            )}
                        </div>
                        <div className="flex-1 overflow-y-auto custom-scrollbar">
                            <div className="px-3 pt-2 pb-1 text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Capturas recientes</div>
                            {eventsLoading && filteredEvents.length === 0 ? (
                                <>{Array.from({ length: 6 }).map((_, i) => <VehicleCardSkeleton key={i} />)}</>
                            ) : filteredEvents.length === 0 ? (
                                <div className="flex flex-col items-center justify-center h-32 text-muted-foreground">
                                    <Car size={24} className="mb-2 opacity-30" />
                                    <span className="text-xs">Sin capturas recientes</span>
                                </div>
                            ) : (
                                filteredEvents.map(e => <VehicleCard key={e.id} event={e} onRegister={openRegister} platesWithParking={platesPark} watchMap={watchMap} />)
                            )}
                        </div>
                    </div>

                    {/* CENTER: fixed spotlight + independently scrolling recent list */}
                    <div className="flex flex-col overflow-hidden">
                        <div className="shrink-0">
                            <CenterShot ev={filteredEvents[0]} onRegister={openRegister} />
                        </div>
                        {interiores.length > 0 && (
                            <div className="shrink-0 border-t border-neutral-800 px-4 py-2">
                                <button type="button" onClick={() => setVerInteriores(v => !v)} className="w-full flex items-center gap-1.5 mb-2 text-left">
                                    <Route size={13} className="text-violet-400" />
                                    <span className="text-[11px] font-bold uppercase tracking-wider text-violet-300">Interiores · seguimiento</span>
                                    <span className="ml-auto px-1.5 py-0.5 rounded-md text-[10px] font-bold border border-violet-500/40 text-violet-300">{interiores.length} cam</span>
                                    <ChevronDown size={13} className={cn("text-violet-300/70 transition-transform", verInteriores ? "" : "-rotate-90")} />
                                </button>
                                {/* El vivo se pliega; las capturas no. Plegar la sección es para
                                    recuperar lugar en pantalla, no para dejar de ver lo que pasó. */}
                                {verInteriores && (
                                    <div className={cn("grid gap-2 mb-2", interiores.length === 1 ? "grid-cols-1" : "grid-cols-2")}>
                                        {interiores.map((d: any) => <TrackTile key={d.id} dev={d} av={avistPorCam[d.id]} />)}
                                    </div>
                                )}

                                <TiraInteriores avistamientos={avistUltimos} onAbrir={setCuadroAbierto} />
                            </div>
                        )}
                        <div className="flex-1 overflow-y-auto custom-scrollbar">
                            <div className="px-4 pt-2 pb-2">
                                <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Capturas recientes</div>
                            </div>
                            {eventsLoading && filteredEvents.length === 0
                                ? Array.from({ length: 6 }).map((_, i) => <VehicleCardSkeleton key={i} />)
                                : filteredEvents.slice(1, 15).map(e => <VehicleCard key={e.id} event={e} onRegister={openRegister} platesWithParking={platesPark} watchMap={watchMap} />)}
                        </div>
                    </div>

                    {/* EXITS */}
                    <div className="flex flex-col overflow-hidden">
                        <div className="shrink-0 p-3 pb-1">
                            <div className="flex items-center gap-1.5 mb-2">
                                <LogOut size={13} className="text-orange-400" />
                                <span className="text-[11px] font-bold uppercase tracking-wider text-orange-300">Salidas</span>
                                <span className="ml-auto px-1.5 py-0.5 rounded-md text-[10px] font-bold border border-orange-500/40 text-orange-300">{exitCams.length} cám</span>
                            </div>
                            {exitCams.length === 0 ? (
                                <div className="flex items-center justify-center h-24 text-[11px] text-foreground/40 border border-dashed border-border rounded-lg">Sin cámaras de salida</div>
                            ) : (
                                <div className={cn("grid gap-2", exitCams.length === 1 ? "grid-cols-1" : "grid-cols-2")}>
                                    {exitCams.map((d: any) => <CamTile key={d.id} dev={d} accent="orange" ev={lastByCam[d.id] || lastCapByDev[d.id]} onRegister={openRegister} />)}
                                </div>
                            )}
                        </div>
                        <div className="flex-1 overflow-y-auto custom-scrollbar">
                            <div className="px-3 pt-2 pb-1 text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Capturas recientes</div>
                            {eventsLoading && filteredEvents.length === 0 ? (
                                <>{Array.from({ length: 6 }).map((_, i) => <VehicleCardSkeleton key={i} />)}</>
                            ) : filteredEvents.length === 0 ? (
                                <div className="flex flex-col items-center justify-center h-32 text-muted-foreground">
                                    <Car size={24} className="mb-2 opacity-30" />
                                    <span className="text-xs">Sin capturas recientes</span>
                                </div>
                            ) : (
                                filteredEvents.map(e => <VehicleCard key={e.id} event={e} onRegister={openRegister} platesWithParking={platesPark} watchMap={watchMap} />)
                            )}
                        </div>
                    </div>
                </div>
            </div>
                <PinnedAnomalies items={pinned} onDismiss={dismissPin} onClear={() => setPinned([])} onRegister={openRegister} />
                {cuadroAbierto !== null && avistUltimos[cuadroAbierto] && (
                    <VisorCuadro
                        fila={avistUltimos[cuadroAbierto]}
                        hayAnterior={cuadroAbierto > 0}
                        haySiguiente={cuadroAbierto < avistUltimos.length - 1}
                        onAnterior={() => setCuadroAbierto((v) => (v === null ? v : Math.max(0, v - 1)))}
                        onSiguiente={() => setCuadroAbierto((v) => (v === null ? v : Math.min(avistUltimos.length - 1, v + 1)))}
                        onCerrar={() => setCuadroAbierto(null)}
                    />
                )}

                <UserFormDialog open={registerOpen} onOpenChange={(o) => { setRegisterOpen(o); if (!o) setRegisterInit(undefined); }} initialData={registerInit} units={units} groups={groups} devices={devices} parkingSlots={parkingSlots} onSuccess={() => { setRegisterOpen(false); setRegisterInit(undefined); loadInitialData(); }} />
        </TooltipProvider>
    );
}
