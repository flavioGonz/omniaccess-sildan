"use client";

import { useEffect, useState, useMemo, useRef, memo, useCallback } from "react";
import { io, Socket } from "socket.io-client";
import { useRouter } from "next/navigation";
import { getAccessEvents, getEventsCountToday, getLprCounters, getLastEventPerDevice } from "@/app/actions/history";
import { getDevices, getAvailableStreams } from "@/app/actions/devices";
import { MinInteriorButton } from "@/components/MinInteriorButton";
import { PlateManualButton } from "@/components/PlateManualButton";
import { IntrusionPanel } from "@/components/IntrusionPanel";
import { CajonPlaza } from "@/components/parking/CajonPlaza";
import { Cajon, CajonContenido } from "@/components/ui/cajon";
import { FichaDeteccion } from "@/components/intrusion/FichaDeteccion";
import type { Geom } from "@/components/intrusion/comun";
import { getAnalyticsGeometryBatch, type DetItem } from "@/app/actions/detections";
import {
    Car,
    CheckCircle2,
    XCircle,
    Clock,
    TrendingUp,
    TrendingDown,
    Zap,
    Shield,
    ShieldAlert,
    Volume2,
    VolumeX,
    AlertTriangle,
    Filter,
    RefreshCw,
    Camera,
    LogIn,
    LogOut,
    Truck,
    Bus,
    Bike,
    Activity,
    Search,
    SquareParking,
    X,
    MapPin,
    Home,
    Loader2,
    UserPlus,
    PlayCircle,
    Radar
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { EventDetailsDialog } from "@/components/dashboard/EventDetailsDialog";
import { VerGrabacion, canalDe } from "@/components/video/VerGrabacion";
import Image from "next/image";
import { AccessEvent, Device, Unit } from "@prisma/client";
import { getCarLogo } from "@/lib/car-logos";
import { getVehicleBrandName } from "@/lib/hikvision-codes";
import { rotuloLectura } from "@/lib/lectura-metodo";
import { getImagePath } from "@/lib/image-path";
import { getSocketUrl } from "@/lib/socket-config";
import { getUnits } from "@/app/actions/units";
import { getAccessGroups } from "@/app/actions/groups";
import { getParkingSlots, getPlatesWithParking } from "@/app/actions/parking";
import { getWatchMap } from "@/app/actions/watchlist";
import { watchCatMeta } from "@/lib/watch-categories";
import { WatchlistDialog } from "@/components/WatchlistDialog";
import { getParkingElements, getPresenceSummary } from "@/app/actions/plazas";
import { RegistrarMatricula } from "@/components/registro/RegistrarMatricula";
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
    // VIP en verde con su nombre de la lista: es PERMITIDO. Y «en búsqueda» no caía en ningún
    // caso, así que una matrícula buscada se veía como un auto cualquiera.
    if (cat === "blanca" || cat === "whitelisted") return { key: "blanca", label: "VIP / Autorizado", badge: "bg-emerald-500/15 text-emerald-300 border border-emerald-500/40", ring: "ring-2 ring-emerald-400/70", dot: "bg-emerald-400" };
    if (cat === "search" || cat === "busca") return { key: "busqueda", label: "En búsqueda", badge: "bg-amber-500/20 text-amber-200 border border-amber-500/50", ring: "ring-2 ring-amber-400/70", dot: "bg-amber-400" };
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

/** Cada cuánto se vuelve a pedir la última lectura de las interiores de acceso (ver esCamaraDeAcceso). */
const REFRESCO_LECTURAS_INTERIOR_MS = 15_000;

function CamTile({ dev, accent = "emerald", ev, onRegister, className }: { dev: any; accent?: string; ev?: any; onRegister?: (p?: string) => void; className?: string }) {
    const camRouter = useRouter();
    const [lit, setLit] = useState(false);
    const last = useRef<string | undefined>(undefined);
    const snap = useMemo(() => `/api/snapshot/${dev.id}?w=480&t=${Date.now()}`, [dev.id]);
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
        <div className={cn("relative rounded-lg overflow-hidden border vid-surface transition-all duration-300", className || "aspect-video", lit ? ring : "border-border")}>
            <SmartThumb src={(() => { const b = img || snap; return rk > 0 ? `${b}${b.includes("?") ? "&" : "?"}rk=${rk}` : b; })()} w={384} className="absolute inset-0 w-full h-full" />
            <div className="absolute top-1.5 left-1.5 z-20 flex items-center gap-1 px-1.5 py-0.5 rounded bg-black/60 backdrop-blur-sm border border-white/10 pointer-events-none">
                <span className="relative flex h-1.5 w-1.5"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span><span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-red-500"></span></span>
                <span className="text-[9px] font-bold text-white/90 truncate max-w-[130px]">{dev.name}</span>
                {ev && rotuloLectura(ev.details) && <span className="text-[9px] tabular-nums text-white/70">· {rotuloLectura(ev.details)}</span>}
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
    // Una lectura que todavía no es evento de acceso (sinEvento: avistamiento viejo de una
    // interior) no tiene ficha que abrir: el diálogo pediría un AccessEvent que no existe.
    return ev && !ev.sinEvento ? (
        <div className="relative group/cam">
            <EventDetailsDialog event={ev} timeStatus={null} onRegister={(p) => onRegister?.(p)}>
                <button type="button" className="block w-full text-left cursor-pointer">{inner}</button>
            </EventDetailsDialog>
            {anomalous && ev.id && (
                <div className="absolute top-1.5 right-1.5 z-30">
                    <PlateManualButton eventId={ev.id} currentPlate={plate} onSaved={() => camRouter.refresh()} className="!bg-black/60 hover:!bg-black/80 !text-amber-300 rounded-md !p-1.5 shadow-lg" />
                </div>
            )}
        </div>
    ) : inner;
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

/**
 * La última lectura en grande. Era el centro de tres columnas y mostraba la última de
 * CUALQUIER sentido; ahora cada columna (Entradas, Salidas) tiene la suya arriba, así que
 * recibe el sentido (para el cartel cuando todavía no hay ninguna) y el alto de afuera.
 */
function CenterShot({ ev, onRegister, dir, className, watchMap }: { ev: any; onRegister?: (plate?: string) => void; dir?: "ENTRY" | "EXIT"; className?: string; watchMap?: Record<string, any> }) {
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
        return (
            <div className={cn("relative w-full rounded-xl overflow-hidden bg-muted border border-border flex flex-col items-center justify-center gap-2 text-muted-foreground", className || "aspect-video")}>
                <Camera size={30} className="opacity-40" />
                <span className="text-[12px]">{dir === "EXIT" ? "Todavía no hay lecturas de salida" : dir === "ENTRY" ? "Todavía no hay lecturas de entrada" : "Sin capturas"}</span>
            </div>
        );
    }
    const img = getImagePath(ev.snapshotPath || ev.imagePath) || "";
    const plate = ev.plateDetected as string | undefined;
    const ok = ev.decision === "GRANT";
    const anomalous = !plate || ["NO_LEIDA", "unknown", "S/P"].includes(plate || "");
    const marca = (String(ev.details || "").match(/Marca:\s*([^,]+)/)?.[1] || "").trim();
    const crop = getImagePath((String(ev.details || "").match(/PlateCrop:\s*([^,]+)/)?.[1] || "").trim()) || "";
    const sentido = ev.direction;
    const watch = (ev as any).watch || (watchMap && ev.plateDetected ? watchMap[String(ev.plateDetected).toUpperCase()] : null);
    const tipo = tipoDeteccion(ev, watch);
    const ring = sentido === "EXIT" ? "border-orange-400 shadow-[0_0_24px_rgba(251,146,60,0.7)]" : "border-emerald-400 shadow-[0_0_24px_rgba(52,211,153,0.7)]";
    return (
        <div>
            <div className={cn("relative w-full rounded-xl overflow-hidden vid-surface border transition-all duration-300", className || "aspect-video", flash ? ring : "border-border")}>
                <SmartThumb src={img} w={960} className="absolute inset-0 w-full h-full" />
                {flash && <div className="iris-shot" />}
                <div className="absolute top-3 left-3 z-10 flex flex-col items-start gap-1.5">
                    {/* En la columna de su sentido el cartel ENTRADA/SALIDA sobra: lo dice la columna. Se deja la cámara. */}
                    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-black/60 backdrop-blur text-[10.5px] font-semibold text-white/90">{ev.device?.name || "Cámara"} · <TimeAgo timestamp={ev.timestamp} /></span>
                    {tipo && <span className={cn("inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded shadow-lg backdrop-blur", tipo.badge)}>{tipo.label}{tipo.key === "residente" && ev.user?.unit?.name ? ` · ${ev.user.unit.name}` : ""}</span>}
                    {/* El motivo de la lista viaja con la captura: en búsqueda es lo que el guardia tiene que saber. */}
                    {watch?.motivo && <span className={cn("max-w-[60%] text-[11px] font-semibold px-2 py-1 rounded shadow-lg backdrop-blur leading-snug", tipo?.badge || "bg-black/60 text-white")}>{watch.motivo}</span>}
                    {rotuloLectura(ev.details) && <span className="text-[10px] tabular-nums px-2 py-0.5 rounded bg-black/55 text-white/85 backdrop-blur">{rotuloLectura(ev.details)}</span>}
                </div>
                <div className="absolute top-3 right-3 z-10"><Badge className={cn("text-xs shadow-lg", ok ? "bg-emerald-600" : "bg-red-600")}>{ok ? "PERMITIDO" : "DENEGADO"}</Badge></div>
                {crop && (
                    /* Proporcional al recuadro: con 160 px fijos, en una pantalla de 1366 el recorte
                       de la patente tapaba la matrícula leída, que es lo que se vino a ver. */
                    <div className="absolute top-12 right-3 z-20 w-[26%] max-w-40 rounded-lg overflow-hidden border-2 border-white/70 shadow-lg bg-black/50">
                        <div className="px-1.5 py-0.5 bg-black/70 text-[8px] font-bold text-white/90 uppercase tracking-wide">Patente</div>
                        <ThumbImg src={crop} className="w-full h-auto object-contain bg-black" />
                    </div>
                )}
                <div className="absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/95 via-black/60 to-transparent px-4 pb-3 pt-14 flex flex-col items-center">
                    {anomalous ? (
                        <div className="flex flex-col items-center gap-2">
                            <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-yellow-500/20 rounded-lg border border-yellow-500/50"><AlertTriangle size={18} className="text-yellow-300" /><span className="text-lg font-bold text-yellow-300">SIN LECTURA</span></div>
                            {ev.id && <PlateManualButton eventId={ev.id} currentPlate={plate} onSaved={() => router.refresh()} label className="!bg-white/15 hover:!bg-white/25 !text-amber-200 uppercase tracking-wide backdrop-blur" />}
                        </div>
                    ) : (
                        <div className="inline-block px-4 py-1.5 bg-black/50 rounded-lg border border-blue-400/40 backdrop-blur-sm"><span className="font-mono text-[clamp(18px,1.9vw,30px)] font-bold tracking-[0.2em] text-white drop-shadow">{plate}</span></div>
                    )}
                    <div className="mt-1.5 text-[11px] text-white/80 flex items-center gap-2">
                        {marca && <span className="font-semibold">{marca}</span>}
                        {ev.user?.name && <span className="text-white/90">{ev.user.name}{ev.user?.unit?.name ? ` · ${ev.user.unit.name}` : ""}</span>}
                    </div>
                    {plate && !anomalous && (
                        <div className="mt-2 flex gap-2">
                            <button onClick={(e) => { e.stopPropagation(); router.push(`/admin/history?search=${encodeURIComponent(plate)}`); }} className="px-3 py-1 rounded-md bg-white/15 hover:bg-white/25 text-white text-[10px] font-bold uppercase tracking-wide backdrop-blur transition-colors">Investigar</button>
                            <MinInteriorButton plate={plate} label className="!bg-white/15 hover:!bg-white/25 !text-white uppercase tracking-wide backdrop-blur" />
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

/* El canal y el NVR de cada cámara, con la misma caché que usa el visor de grabación: al
   tocar el botón el visor ya los tiene y pide la grabación en el acto, sin otra vuelta. */
function fetchNvrChannel(deviceId: string): Promise<number | null> {
    return canalDe(deviceId).then((c) => c.ch);
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

const VehicleCard = memo(function VehicleCard({ event, onRegister, platesWithParking, watchMap, onPlaza }: { event: any; onRegister: (p?: string) => void; platesWithParking?: Set<string>; watchMap?: Record<string, any>; onPlaza?: (plate: string) => void }) {
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
                        {watch?.motivo && <p className={cn("text-[11px] font-semibold mt-1 truncate", watchMeta?.text)} title={watch.motivo}>{watch.motivo}</p>}
                        <div className="flex items-center gap-2 mt-1">
                            {meta.Marca && <span className="text-[10px] text-muted-foreground font-semibold">{meta.Marca}{(meta.Modelo || meta.Tipo) ? ` · ${meta.Modelo || meta.Tipo}` : ""}</span>}
                            {event.user?.name && (<span className="text-[10px] text-blue-400 truncate">{event.user.name}</span>)}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5 text-[10px] text-muted-foreground">
                            <TimeAgo timestamp={event.timestamp} />
                            {event.device?.name && <span>&middot; {event.device.name}</span>}
                            {/* Cómo se leyó y con qué confianza: ANPR de la cámara o RTSP Detect del contenedor. Discreto: es un dato de calidad, no la captura. */}
                            {rotuloLectura(event.details) && <span className="tabular-nums opacity-80">&middot; {rotuloLectura(event.details)}</span>}
                        </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0 self-center">
                        {event.plateDetected && !isAnomalous && (<>
                            <button onClick={(e) => { e.stopPropagation(); router.push(`/admin/history?search=${encodeURIComponent(event.plateDetected!)}`); }} title="Investigar" className="p-2 rounded-lg text-blue-500 hover:bg-blue-500/15 transition-colors"><Search size={17} /></button>
                            <MinInteriorButton plate={event.plateDetected} className="!p-2 rounded-lg" />
                            {event.decision !== "GRANT" && <button onClick={(e) => { e.stopPropagation(); onRegister(event.plateDetected!); }} title="Registrar" className="p-2 rounded-lg text-emerald-500 hover:bg-emerald-500/15 transition-colors"><UserPlus size={17} /></button>}
                        </>)}
                        {nvrCh != null && <button onClick={(e) => { e.stopPropagation(); setShowVid(true); }} title="Ver grabación" className="p-2 rounded-lg text-cyan-400 hover:bg-cyan-500/15 transition-colors"><PlayCircle size={17} /></button>}
                        <button onClick={(e) => { e.stopPropagation(); if (!isAnomalous && event.plateDetected) onPlaza?.(String(event.plateDetected).toUpperCase()); }} disabled={isAnomalous} title={isAnomalous ? "Sin matrícula leída: no hay plaza que buscar" : hasPlaza ? "Ver su plaza y el camino" : "Sin plaza: tocá para asignarle una"} className={cn("p-2 rounded-lg transition-colors", hasPlaza ? "text-emerald-500 hover:bg-emerald-500/15" : "text-red-500 hover:bg-red-500/15")}><SquareParking size={18} /></button>
                    </div>
                </div>
            </div>
        </EventDetailsDialog>
        {/* El visor único (vivo · grabación · evidencias), abierto en Grabación en el instante de la lectura. */}
        {showVid && nvrCh != null && (event as any).device?.id && <VerGrabacion deviceId={(event as any).device.id} nombre={(event as any).device?.name} canal={nvrCh} instanteMs={new Date(event.timestamp).getTime()} onClose={() => setShowVid(false)} />}
      </>
    );
});


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

/** Alertas críticas (merodeo + lista negra): mini-popups abajo a la IZQUIERDA con
 *  animación de peligro constante. Siempre activas, se cierran a mano. */
function CriticalAlerts({ items, onDismiss, onClear, onRegister }: { items: any[]; onDismiss: (id: string) => void; onClear: () => void; onRegister: (p?: string) => void }) {
    const router = useRouter();
    if (!items.length) return null;
    return (
        <div className="fixed bottom-4 left-4 z-[410] w-[340px] max-w-[92vw] flex flex-col gap-2 pointer-events-none">
            <style>{`@keyframes oaPeligro{0%,100%{box-shadow:0 0 0 0 rgba(239,68,68,.55),0 0 12px 1px rgba(239,68,68,.35)}50%{box-shadow:0 0 0 4px rgba(239,68,68,0),0 0 26px 8px rgba(239,68,68,.7)}}@keyframes oaLatir{0%,100%{transform:scale(1)}50%{transform:scale(1.18)}}`}</style>
            <div className="flex items-center justify-between px-1 pointer-events-auto">
                <span className="inline-flex items-center gap-1.5 text-[11px] font-black uppercase tracking-wider text-red-400"><ShieldAlert size={13} style={{ animation: "oaLatir 1s ease-in-out infinite" }} /> Alertas críticas · {items.length}</span>
                <button onClick={onClear} className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground hover:text-foreground bg-card border border-border rounded px-2 py-0.5">Cerrar todas</button>
            </div>
            <div className="flex flex-col gap-2 pointer-events-auto">
                {items.slice(0, 4).map((ev) => {
                    const isMer = ev.kind === "merodeo";
                    const isIntr = ev.kind === "intrusion";
                    const img = getImagePath(ev.snapshotPath || ev.imagePath) || "";
                    return (
                        <div key={ev.id} className="relative rounded-xl border-2 border-red-500/70 bg-card overflow-hidden" style={{ animation: "oaPeligro 1.1s ease-in-out infinite" }}>
                            <button onClick={() => onDismiss(ev.id)} title="Cerrar" className="absolute top-1.5 right-1.5 z-10 h-6 w-6 rounded-md bg-black/50 hover:bg-black/70 text-white/80 hover:text-white flex items-center justify-center backdrop-blur"><X size={13} /></button>
                            {isMer ? (
                                <button onClick={() => router.push(`/admin/history?search=${encodeURIComponent(ev.plate || "")}`)} className="w-full text-left flex gap-2.5 p-2.5">
                                    <div className="w-12 h-12 rounded-lg bg-red-500/15 border border-red-500/40 flex items-center justify-center shrink-0">
                                        <AlertTriangle size={22} className="text-red-400" style={{ animation: "oaLatir 1s ease-in-out infinite" }} />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-1.5">
                                            <span className="text-[10px] font-black uppercase tracking-wider text-red-400">Merodeo</span>
                                            <span className="font-mono text-sm font-bold tracking-wider text-foreground">{ev.plate || "S/L"}</span>
                                        </div>
                                        <div className="mt-0.5 text-[10px] text-muted-foreground">{ev.count} pasadas en {ev.windowMin} min · {ev.distinctDevices} acceso/s{ev.deviceName ? ` · ${ev.deviceName}` : ""}</div>
                                        <div className="mt-0.5 text-[10px] text-muted-foreground"><TimeAgo timestamp={ev.timestamp} /></div>
                                    </div>
                                </button>
                            ) : isIntr ? (
                                <div className="w-full text-left flex gap-2.5 p-2.5">
                                    <div className="w-12 h-12 rounded-lg bg-red-500/15 border border-red-500/40 flex items-center justify-center shrink-0">
                                        <ShieldAlert size={22} className="text-red-400" style={{ animation: "oaLatir 1s ease-in-out infinite" }} />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-1.5">
                                            <span className="text-[10px] font-black uppercase tracking-wider text-red-400">Intrusión</span>
                                            <span className="font-mono text-sm font-bold tracking-wider text-foreground truncate">{ev.deviceName || ev.device?.name || "Cámara"}</span>
                                        </div>
                                        <div className="mt-0.5 text-[10px] text-muted-foreground truncate">{ev.details || (ev.type === "line" ? "Cruce de línea" : "Zona")}</div>
                                        <div className="mt-0.5 text-[10px] text-muted-foreground"><TimeAgo timestamp={ev.timestamp} /></div>
                                    </div>
                                </div>
                            ) : (
                                <EventDetailsDialog event={ev} timeStatus={null} onRegister={(p) => onRegister(p)}>
                                    <div className="flex gap-2.5 p-2.5 cursor-pointer">
                                        <div className="w-24 h-16 rounded-lg overflow-hidden shrink-0 border border-red-500/40">
                                            <SmartThumb src={img} w={240} className="w-full h-full" />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-1.5">
                                                <span className="font-mono text-sm font-bold tracking-wider text-foreground">{ev.plateDetected || "S/L"}</span>
                                                <Badge className={cn("text-[8px] px-1 py-0", ev.direction === "EXIT" ? "bg-orange-500" : "bg-emerald-500")}>{ev.direction === "EXIT" ? "SALIDA" : "ENTRADA"}</Badge>
                                            </div>
                                            <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                                                <span className="inline-flex items-center gap-1 text-[8px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded bg-red-500/20 text-red-300 border border-red-500/50"><ShieldAlert size={9} /> Lista Negra</span>
                                                {ev.user?.name && <span className="text-[10px] text-blue-400 truncate max-w-[110px]">{ev.user.name}</span>}
                                            </div>
                                            <div className="mt-1 flex items-center gap-1.5 text-[10px] text-muted-foreground"><TimeAgo timestamp={ev.timestamp} />{ev.device?.name && <span className="truncate">· {ev.device.name}</span>}</div>
                                        </div>
                                    </div>
                                </EventDetailsDialog>
                            )}
                        </div>
                    );
                })}
            </div>
            {items.length > 4 && (
                <div className="relative h-8 mt-0.5 pointer-events-auto">
                    <div className="absolute inset-x-3 top-2 h-7 rounded-xl bg-red-500/10 border border-red-500/40" />
                    <div className="absolute inset-x-1.5 top-1 h-7 rounded-xl bg-red-500/15 border border-red-500/50" />
                    <div className="absolute inset-x-0 top-0 h-8 rounded-xl bg-card border-2 border-red-500/60 shadow-lg flex items-center justify-center gap-1.5 text-[11px] font-bold text-red-400">
                        <ShieldAlert size={12} /> +{items.length - 4} críticas más
                    </div>
                </div>
            )}
        </div>
    );
}

/**
 * Una columna del monitor: todo lo de un sentido.
 *
 * Antes eran tres columnas y dos mentían: «Entradas» y «Salidas» listaban TODAS las
 * lecturas (las dos recibían `filteredEvents`), así que una salida aparecía en Entradas y
 * el operador tenía que mirar el nombre de la cámara para saber qué estaba viendo. La del
 * centro repetía la misma lista por tercera vez debajo de la última captura.
 *
 * Ahora cada columna es un sentido completo, de arriba abajo: la última lectura en
 * grande, sus cámaras con la lectura de cada una, y las lecturas de ese sentido nada más.
 */
/** Lo que dice la lista del sentido en cuatro números. Va al costado cuando hay una sola cámara. */
function ResumenSentido({ eventos }: { eventos: any[] }) {
    const sinLeer = (e: any) => !e.plateDetected || ["NO_LEIDA", "unknown", "S/P"].includes(e.plateDetected);
    const filas: [string, number, string][] = [
        ["Permitidas", eventos.filter((e) => e.decision === "GRANT").length, "tono-bien"],
        ["Denegadas", eventos.filter((e) => e.decision !== "GRANT").length, ""],
        ["Sin lectura", eventos.filter(sinLeer).length, "tono-aviso"],
        ["Residentes", eventos.filter((e) => e.user?.id).length, ""],
    ];
    return (
        <div className="aspect-video rounded-lg border border-border bg-card px-3 py-2.5 flex flex-col">
            <p className="text-[11px] font-semibold text-muted-foreground">En la lista</p>
            <div className="flex-1 grid grid-cols-2 gap-x-3 content-center">
                {filas.map(([r, n, tono]) => (
                    <div key={r} className="py-1">
                        <p className={cn("text-[18px] font-bold tabular-nums leading-none", n > 0 && tono)}>{n}</p>
                        <p className="text-[11px] text-muted-foreground mt-1">{r}</p>
                    </div>
                ))}
            </div>
        </div>
    );
}

function ColumnaSentido({ dir, camaras, eventos, ultimaPorCamara, cargando, onRegister, platesPark, watchMap, onPlaza }: {
    dir: "ENTRY" | "EXIT";
    camaras: any[];
    eventos: any[];
    ultimaPorCamara: (id: string) => any;
    cargando: boolean;
    onRegister: (p?: string) => void;
    platesPark: Set<string>;
    watchMap: Record<string, any>;
    onPlaza: (plate: string) => void;
}) {
    const entrada = dir === "ENTRY";
    const Icono = entrada ? LogIn : LogOut;
    const sinLeer = eventos.filter((e) => !e.plateDetected || ["NO_LEIDA", "unknown", "S/P"].includes(e.plateDetected)).length;
    return (
        <section className="flex flex-col min-h-0 overflow-hidden">
            {/* Encabezado del sentido */}
            <div className="shrink-0 flex items-center gap-2.5 px-4 h-11 border-b border-border">
                <span className={cn("w-7 h-7 rounded-md grid place-items-center border border-border bg-muted", entrada ? "text-emerald-500" : "text-orange-500")}><Icono size={15} /></span>
                <h2 className="text-[14px] font-bold">{entrada ? "Entradas" : "Salidas"}</h2>
                <span className="text-[11.5px] text-muted-foreground tabular-nums">{camaras.length} cámara{camaras.length === 1 ? "" : "s"}</span>
                <span className="ml-auto flex items-center gap-2 text-[11.5px] text-muted-foreground tabular-nums">
                    <span><b className="text-foreground">{eventos.length}</b> en la lista</span>
                    {sinLeer > 0 && <span className="text-[var(--aviso-texto)]">· {sinLeer} sin lectura</span>}
                </span>
            </div>

            {/* La última lectura y las cámaras, lado a lado y las dos en 16:9.
                La versión anterior apilaba las cámaras debajo en una tira de 84 px de alto a todo
                el ancho: un cuadro 16:9 recortado a una franja, donde no se veía nada. Las
                cámaras son 16:9; si el recuadro no lo es, se mira un pedazo. */}
            <div className="shrink-0 p-4 border-b border-border">
                <div className="grid gap-3 items-start" style={{ gridTemplateColumns: "minmax(0, 1fr) minmax(0, 31%)" }}>
                    <CenterShot ev={eventos[0]} onRegister={onRegister} dir={dir} className="aspect-video" watchMap={watchMap} />
                    <div className={cn("grid gap-2", camaras.length > 2 ? "grid-cols-2" : "grid-cols-1")}>
                        {camaras.map((d: any) => <CamTile key={d.id} dev={d} accent={entrada ? "emerald" : "orange"} ev={ultimaPorCamara(d.id)} onRegister={onRegister} className="aspect-video" />)}
                        {/* Con una sola cámara sobra la mitad del costado: ahí va el resumen del sentido. */}
                        {camaras.length < 2 && <ResumenSentido eventos={eventos} />}
                        {camaras.length === 0 && <div className="aspect-video rounded-lg border border-dashed border-border grid place-items-center text-[11.5px] text-muted-foreground">Sin cámaras de {entrada ? "entrada" : "salida"}</div>}
                    </div>
                </div>
            </div>

            {/* Las lecturas del sentido */}
            <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
                <div className="sticky top-0 z-10 px-4 py-2 bg-background/95 backdrop-blur border-b border-border text-[11px] font-semibold text-muted-foreground">
                    Lecturas recientes
                </div>
                {cargando && eventos.length === 0 ? (
                    <>{Array.from({ length: 6 }).map((_, i) => <VehicleCardSkeleton key={i} />)}</>
                ) : eventos.length <= 1 ? (
                    <div className="flex flex-col items-center justify-center h-32 text-muted-foreground">
                        <Car size={22} className="mb-2 opacity-30" />
                        <span className="text-[12px]">{eventos.length ? "Sólo la de arriba, por ahora" : "Sin lecturas con estos filtros"}</span>
                    </div>
                ) : (
                    // La primera ya está en grande arriba: la lista arranca en la segunda.
                    eventos.slice(1).map((e) => <VehicleCard key={e.id} event={e} onRegister={onRegister} platesWithParking={platesPark} watchMap={watchMap} onPlaza={onPlaza} />)
                )}
            </div>
        </section>
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
    const router = useRouter();
    const [units, setUnits] = useState<any[]>([]);
    const [groups, setGroups] = useState<any[]>([]);
    const [parkingSlots, setParkingSlots] = useState<any[]>([]);
    const [registerOpen, setRegisterOpen] = useState(false);
    const [registerInit, setRegisterInit] = useState<{ plate?: string } | undefined>(undefined);
    // Alertas críticas (merodeo + lista negra) — mini-popups con animación de peligro, siempre activas.
    const [criticals, setCriticals] = useState<any[]>([]);
    const critSeenRef = useRef<Set<string>>(new Set());
    const critInitedRef = useRef(false);
    const dismissedCritRef = useRef<Set<string>>(new Set());
    const dismissCritical = useCallback((id: string) => { dismissedCritRef.current.add(id); setCriticals(c => c.filter(x => x.id !== id)); }, []);
    const [eventsLoading, setEventsLoading] = useState(true);
    const [verDetecciones, setVerDetecciones] = useState(false);
    /** La detección abierta desde el cajón. Al cerrarla se vuelve al cajón, como en la ficha del evento. */
    const [fichaDet, setFichaDet] = useState<DetItem | null>(null);
    const [geomDet, setGeomDet] = useState<Geom | undefined>(undefined);
    useEffect(() => {
        setGeomDet(undefined);
        if (!fichaDet?.deviceId) return;
        getAnalyticsGeometryBatch([fichaDet.deviceId]).then((g) => setGeomDet(g?.[fichaDet.deviceId!])).catch(() => { });
    }, [fichaDet?.deviceId]);
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

    // Las lectoras de barrera y las interiores que miran un acceso (trackAcceso): a esas
    // últimas las lee el contenedor, no la cámara, y sus lecturas no llegan por el socket
    // de access_event, así que su última captura se vuelve a pedir cada tanto.
    const esCamaraDeAcceso = (x: any) => x.deviceType === "LPR_CAMERA" || (x.deviceType === "LPR_INTERIOR" && !!x.trackAcceso);
    useEffect(() => { getDevices().then((d: any) => setDevices((d || []).filter(esCamaraDeAcceso))).catch(() => {}); getLastEventPerDevice().then(setLastCapByDev).catch(() => {}); getAvailableStreams().then((s: any) => setStreams(s || [])).catch(() => {}); }, []);
    const hayInterioresDeAcceso = useMemo(() => devices.some((x: any) => x.deviceType === "LPR_INTERIOR"), [devices]);
    useEffect(() => {
        if (!hayInterioresDeAcceso) return;
        const iv = setInterval(() => { getLastEventPerDevice().then(setLastCapByDev).catch(() => {}); }, REFRESCO_LECTURAS_INTERIOR_MS);
        return () => clearInterval(iv);
    }, [hayInterioresDeAcceso]);
    const [platesPark, setPlatesPark] = useState<Set<string>>(new Set());
    /** La matrícula cuya plaza se está mirando o asignando. Un solo cajón para toda la pantalla, no uno por fila. */
    const [plazaDe, setPlazaDe] = useState<string | null>(null);
    useEffect(() => { Promise.all([getUnits(), getAccessGroups(), getParkingSlots()]).then(([u, g, p]: any) => { setUnits(u || []); setGroups(g || []); setParkingSlots(p || []); }).catch(() => {}); getPlatesWithParking().then((pl) => setPlatesPark(new Set(pl))).catch(() => {}); }, []);

    // Watchlist (lista negra / búsqueda / VIP) — resaltado + sonido
    const [watchMap, setWatchMap] = useState<Record<string, any>>({});
    const [showWatch, setShowWatch] = useState(false);
    const [soundOn, setSoundOn] = useState(true);
    const soundOnRef = useRef(true);
    useEffect(() => { soundOnRef.current = soundOn; }, [soundOn]);
    const audioCtxRef = useRef<any>(null);
    const lastAlertRef = useRef<Record<string, number>>({});
    const refreshWatch = useCallback(() => { getWatchMap().then((m) => setWatchMap(m || {})).catch(() => { }); }, []);
    useEffect(() => { refreshWatch(); const iv = setInterval(refreshWatch, 60000); return () => clearInterval(iv); }, [refreshWatch]);
    // El navegador bloquea el audio hasta que el usuario interactúa: desbloqueamos el
    // AudioContext en el primer gesto (click/tecla) para que las alertas suenen.
    useEffect(() => {
        const unlock = () => {
            try {
                const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
                if (!audioCtxRef.current) audioCtxRef.current = new AC();
                if (audioCtxRef.current.state === "suspended") audioCtxRef.current.resume();
            } catch { }
        };
        window.addEventListener("pointerdown", unlock);
        window.addEventListener("keydown", unlock);
        return () => { window.removeEventListener("pointerdown", unlock); window.removeEventListener("keydown", unlock); };
    }, []);
    // Beep sintetizado (Web Audio) — no depende de un archivo ni de la caché. urgent = patrón doble.
    const beep = useCallback((urgent = false) => {
        try {
            const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
            const ctx = audioCtxRef.current || (audioCtxRef.current = new AC());
            if (ctx.state === "suspended") ctx.resume();
            const now = ctx.currentTime;
            const tones = urgent ? [988, 1319, 988, 1319] : [880, 660];
            tones.forEach((f, i) => {
                const o = ctx.createOscillator(); const g = ctx.createGain();
                o.type = "square"; o.frequency.value = f;
                const t0 = now + i * 0.16;
                g.gain.setValueAtTime(0.0001, t0);
                g.gain.exponentialRampToValueAtTime(0.4, t0 + 0.01);
                g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.15);
                o.connect(g); g.connect(ctx.destination);
                o.start(t0); o.stop(t0 + 0.16);
            });
        } catch { }
    }, []);
    const playWatchAlert = useCallback((plate: string, urgent = false) => {
        if (!soundOnRef.current) return;
        const now = Date.now();
        if (lastAlertRef.current[plate] && now - lastAlertRef.current[plate] < 4000) return; // throttle por placa
        lastAlertRef.current[plate] = now;
        beep(urgent);
    }, [beep]);

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

            // Watchlist: alerta sonora inmediata. La lista NEGRA la maneja el stack crítico (beep urgente aparte).
            if ((event as any).watch && plate) {
                const cat = String((event as any).watch.category || "").toLowerCase();
                if (cat !== "negra" && cat !== "blacklisted") playWatchAlert(plate);
            }

            // Buffer the event; a 250ms flush loop coalesces bursts into a single render
            // so the main thread stays free to paint incoming snapshots.
            pendingRef.current.push(event);
        });

        newSocket.on("merodeo_alert", (a: any) => {
            const id = `mer_${(a.plate || "?")}_${Date.now()}`;
            setCriticals((prev) => [{ id, kind: "merodeo", timestamp: new Date().toISOString(), ...a }, ...prev].slice(0, 24));
            if (soundOnRef.current) beep(true);
        });
        // Intrusión: cruce de línea / zona del perímetro. Entra al mismo stream de alertas
        // críticas que merodeo/lista negra, con kind "intrusion" para que se pinte distinto.
        // Escucha `general_detection`, que es lo que emite la pila de intrusión que quedó
        // (Detection); `intrusion_alert` era de la pila vieja y ya no lo emite nadie, así que
        // este monitor estuvo meses sin enterarse de una intrusión.
        const NOMBRE_DETECCION: Record<string, string> = { LINECROSS: "Cruce de línea", INTRUSION: "Intrusión en zona", REGION_ENTER: "Entró a la zona", REGION_EXIT: "Salió de la zona" };
        newSocket.on("general_detection", (a: any) => {
            if (!a?.id || a.type === "MOTION") return;
            setCriticals((prev) => prev.some((x) => x.id === a.id) ? prev : [{ id: a.id, kind: "intrusion", timestamp: a.timestamp || new Date().toISOString(), deviceName: a.deviceName, details: NOMBRE_DETECCION[a.type] || "Detección", snapshotPath: a.snapshotPath || null }, ...prev].slice(0, 24));
            if (soundOnRef.current) beep(true);
        });
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
    // Una sola fuente: el `watch` que trae el evento (socket o recarga) y, de respaldo, el mapa
    // de vigilancia por matrícula. El rol BLACKLISTED se sigue aceptando por el módulo facial.
    const esNegra = useCallback((e: any) => {
        const plate = String(e.plateDetected || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
        const cat = String(e.watch?.category || (plate && watchMap[plate]?.category) || "").toLowerCase();
        const role = String(e.user?.role || "").toUpperCase();
        return cat === "negra" || cat === "blacklisted" || role === "BLACKLISTED";
    }, [watchMap]);
    const esAnomala = useCallback((e: any) => {
        const plate = (e.plateDetected || "").toUpperCase();
        if (plate === "DOOR_OPEN" || plate === "DOOR_CLOSE") return false;
        if (esNegra(e)) return false; // la lista negra va al stack CRÍTICO, no al de anomalías
        const anomalous = !e.plateDetected || ["NO_LEIDA", "UNKNOWN", "S/P"].includes(plate);
        const role = (e.user?.role || "").toUpperCase();
        return anomalous || !!e.watch || role === "WHITELISTED";
    }, [esNegra]);
    useEffect(() => {
        if (!pinEnabled) return;
        setPinned((prev) => {
            const seen = new Set(prev.map((x) => x.id));
            const nuevos = events.filter((e) => esAnomala(e) && !seen.has(e.id) && !dismissedRef.current.has(e.id));
            if (!nuevos.length) return prev;
            return [...nuevos, ...prev].slice(0, 24);
        });
    }, [pinEnabled, events, esAnomala]);
    // Lista negra → stack crítico SIEMPRE (independiente del toggle). Solo detecciones nuevas
    // (las históricas del feed al cargar se marcan como vistas para no inundar ni sonar).
    useEffect(() => {
        const negras = events.filter(esNegra);
        if (!critInitedRef.current) { negras.forEach((e) => critSeenRef.current.add(e.id)); critInitedRef.current = true; return; }
        const nuevos = negras.filter((e) => !critSeenRef.current.has(e.id));
        if (!nuevos.length) return;
        nuevos.forEach((e) => critSeenRef.current.add(e.id));
        const dispo = nuevos.filter((e) => !dismissedCritRef.current.has(e.id)).map((e) => ({ ...e, kind: "negra" }));
        if (!dispo.length) return;
        setCriticals((prev) => [...dispo, ...prev].slice(0, 24));
        if (soundOnRef.current) beep(true);
    }, [events, esNegra, beep]);

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
                            {/* Las detecciones de las cámaras (cruces, zonas) vivían en la columna del centro; ahora en un cajón. */}
                            <button onClick={() => setVerDetecciones(true)} title="Detecciones de las cámaras (cruces de línea, zonas)" className="h-full px-2.5 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
                                <Radar size={16} />
                            </button>
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

                        <Cajon open={verDetecciones} onOpenChange={setVerDetecciones}>
                            <CajonContenido ancho="intermedio" titulo="Detecciones" descripcion="Cruces de línea, intrusiones y zonas de las cámaras, con la hora exacta. Tocá una para ver la captura y la grabación.">
                                {verDetecciones && <IntrusionPanel enCajon alAbrir={(d) => { setVerDetecciones(false); setFichaDet(d); }} />}
                            </CajonContenido>
                        </Cajon>
                        {showWatch && <WatchlistDialog onClose={() => { setShowWatch(false); refreshWatch(); }} />}
                    </div>
                </div>

                {/* Dos columnas, un sentido cada una. */}
                <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-border overflow-hidden">
                    <ColumnaSentido dir="ENTRY" camaras={entryCams} eventos={entryEvents} ultimaPorCamara={(id) => lastByCam[id] || lastCapByDev[id]}
                        cargando={eventsLoading} onRegister={openRegister} platesPark={platesPark} watchMap={watchMap} onPlaza={setPlazaDe} />
                    <ColumnaSentido dir="EXIT" camaras={exitCams} eventos={exitEvents} ultimaPorCamara={(id) => lastByCam[id] || lastCapByDev[id]}
                        cargando={eventsLoading} onRegister={openRegister} platesPark={platesPark} watchMap={watchMap} onPlaza={setPlazaDe} />
                </div>
            </div>
                {fichaDet && <FichaDeteccion det={fichaDet} geom={geomDet} onClose={() => { setFichaDet(null); setVerDetecciones(true); }} />}
                <CajonPlaza plate={plazaDe} onClose={() => setPlazaDe(null)}
                    onRegistrar={(p) => { setPlazaDe(null); openRegister(p); }}
                    alCambiar={() => getPlatesWithParking().then((pl) => setPlatesPark(new Set(pl))).catch(() => { })} />
                <PinnedAnomalies items={pinned} onDismiss={dismissPin} onClear={() => setPinned([])} onRegister={openRegister} />
                <CriticalAlerts items={criticals} onDismiss={dismissCritical} onClear={() => setCriticals([])} onRegister={openRegister} />
                {/* Registrar pregunta primero qué es la matrícula (persona del barrio o seguimiento)
                    y recién ahí abre el cajón que corresponde. Antes abría el alta vieja de persona. */}
                <RegistrarMatricula plate={registerOpen ? registerInit?.plate || null : null}
                    alCerrar={() => { setRegisterOpen(false); setRegisterInit(undefined); }}
                    alTerminar={() => { loadInitialData(); refreshWatch(); }}
                    units={units} groups={groups} devices={devices} parkingSlots={parkingSlots} />
        </TooltipProvider>
    );
}
