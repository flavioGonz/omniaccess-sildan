"use client";

import { useEffect, useState, useMemo, useRef, memo, useCallback } from "react";
import { io, Socket } from "socket.io-client";
import { useRouter } from "next/navigation";
import { getAccessEvents, getEventsCountToday, getLprCounters, getLastEventPerDevice } from "@/app/actions/history";
import { getDevices, getAvailableStreams } from "@/app/actions/devices";
import {
    Car,
    CheckCircle2,
    XCircle,
    Clock,
    TrendingUp,
    TrendingDown,
    Zap,
    Shield,
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
    PlayCircle
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
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
import { getParkingElements } from "@/app/actions/plazas";
import { UserFormDialog } from "@/components/UserFormDialog";

interface FullAccessEvent extends AccessEvent {
    user: {
        id: string;
        name: string;
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

function CamTile({ dev, accent = "emerald", ev }: { dev: any; accent?: string; ev?: any }) {
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
        <EventDetailsDialog event={ev} timeStatus={null}>
            <button type="button" className="block w-full text-left cursor-pointer">{inner}</button>
        </EventDetailsDialog>
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
    const ring = dir === "EXIT" ? "border-orange-400 shadow-[0_0_24px_rgba(251,146,60,0.7)]" : "border-emerald-400 shadow-[0_0_24px_rgba(52,211,153,0.7)]";
    return (
        <div className="p-4">
            <div className={cn("relative w-full aspect-video rounded-xl overflow-hidden vid-surface border transition-all duration-300", flash ? ring : "border-border")}>
                <SmartThumb src={img} w={960} className="absolute inset-0 w-full h-full" />
                {flash && <div className="iris-shot" />}
                <div className="absolute top-3 left-3 z-10"><Badge className={cn("text-xs shadow-lg", dir === "EXIT" ? "bg-orange-500" : "bg-emerald-500")}>{dir === "EXIT" ? "SALIDA" : "ENTRADA"}</Badge></div>
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

const VehicleCard = memo(function VehicleCard({ event, onRegister, platesWithParking }: { event: any; onRegister: (p?: string) => void; platesWithParking?: Set<string> }) {
    const router = useRouter();
    const meta = parseMeta(event.details);
    const logoUrl = getCarLogo(meta.Marca);
    const fullImageUrl = getImagePath(event.snapshotPath || event.imagePath) || "";
    const isAnomalous = event.plateDetected === "NO_LEIDA" || event.plateDetected === "unknown" || event.plateDetected === "S/P" || !event.plateDetected;
    const hasPlaza = !!(event.plateDetected && platesWithParking && platesWithParking.has(String(event.plateDetected).toUpperCase()));
    const [showPark, setShowPark] = useState(false);
    const [nvrCh, setNvrCh] = useState<number | null>(null);
    const [showVid, setShowVid] = useState(false);
    useEffect(() => { let alive = true; const dev = (event as any).device; if (dev?.id) fetchNvrChannel(dev.id).then((ch) => { if (alive) setNvrCh(ch); }); return () => { alive = false; }; }, [(event as any).device?.id]);
    return (
      <>
        <EventDetailsDialog event={event} timeStatus={null}>
            <div className={cn(
                "p-3 cursor-pointer transition-all group border-b border-border last:border-0",
                isAnomalous ? "bg-yellow-500/5 hover:bg-yellow-500/10" : "hover:bg-accent"
            )}>
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

function ParkingLocationDialog({ plate, onClose }: { plate: string; onClose: () => void }) {
    const [data, setData] = useState<any>(null);
    const [elems, setElems] = useState<any>(null);
    const [loading, setLoading] = useState(true);
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

    const routeD = route ? route.map((p, i) => (i === 0 ? "M" : "L") + " " + p.x + " " + p.y).join(" ") : "";

    return (
        <div className="fixed inset-0 z-[200] bg-black/80 backdrop-blur-md flex items-center justify-center p-6 animate-in fade-in duration-200" onClick={onClose}>
            <style>{`@keyframes lprDash{to{stroke-dashoffset:-24}}`}</style>
            <div className="relative w-[92vw] max-w-[1400px] rounded-2xl overflow-hidden shadow-2xl animate-in zoom-in-95 duration-200" onClick={(e) => e.stopPropagation()}>
                <button onClick={onClose} className="absolute top-3 right-3 z-20 p-2 rounded-full bg-black/50 backdrop-blur text-white/80 hover:text-white hover:bg-black/70 transition-colors"><X size={18} /></button>
                {loading ? (
                    <div className="bg-card p-20 flex flex-col items-center gap-3 text-muted-foreground"><Loader2 size={24} className="animate-spin" /><span className="text-xs font-bold uppercase tracking-widest">Buscando plaza…</span></div>
                ) : !data?.found ? (
                    <div className="bg-card p-14 text-center"><MapPin size={30} className="mx-auto text-red-400 mb-3" /><p className="text-base font-bold text-foreground">Sin plaza asignada</p><p className="text-xs text-muted-foreground mt-1">{data?.resident ? `${data.resident}${data.unitNumber ? " · Unidad " + data.unitNumber : ""}` : `${plate} no tiene una plaza en el barrio.`}</p></div>
                ) : (
                    <div className="relative bg-black">
                        {data.mapUrl ? (
                            <img src={data.mapUrl} alt="Plano del barrio" className="w-full max-h-[82vh] object-contain grayscale opacity-55 invert select-none pointer-events-none" draggable={false} />
                        ) : <div className="p-16 text-center text-xs text-muted-foreground">No hay plano del barrio cargado.</div>}
                        {data.mapUrl && (
                            <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 100 100" preserveAspectRatio="none">
                                {routeD && <path d={routeD} fill="none" stroke="#0b1220" strokeOpacity={0.6} strokeWidth="4.5" vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />}
                                {routeD && <path d={routeD} fill="none" stroke="#22d3ee" strokeWidth="2.4" vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="6 5" style={{ animation: "lprDash 1s linear infinite" }} />}
                                {route && route[0] && <circle cx={route[0].x} cy={route[0].y} r="1.3" fill="#22d3ee" stroke="#0b1220" strokeWidth="0.6" vectorEffect="non-scaling-stroke" />}
                                {points && <path d={points.map((p: any, i: number) => (i === 0 ? "M" : "L") + " " + norm(p).x + " " + norm(p).y).join(" ") + " Z"} fill="rgba(59,130,246,0.5)" stroke="#60a5fa" strokeWidth="2" vectorEffect="non-scaling-stroke" className="animate-pulse" />}
                                {centroid && <circle cx={centroid.x} cy={centroid.y} r="1.4" fill="#fff" stroke="#3b82f6" strokeWidth="0.8" vectorEffect="non-scaling-stroke" />}
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
                            {route && <div className="mt-2 flex items-center gap-1.5 text-[10px] text-cyan-300"><span className="inline-block w-3 h-0.5 bg-cyan-400 rounded" /> Camino desde la entrada</div>}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

export default function MonitorLPR() {
    const [events, setEvents] = useState<FullAccessEvent[]>([]);
    const [socket, setSocket] = useState<Socket | null>(null);
    const [activeFilter, setActiveFilter] = useState<"ALL" | "GRANT" | "DENY">("ALL");
    const [stats, setStats] = useState({ total: 0, grants: 0, denies: 0 });
    const [aforo, setAforo] = useState({ entradas: 0, salidas: 0, inside: 0 });
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
    const [merodeo, setMerodeo] = useState<any | null>(null);
    const [eventsLoading, setEventsLoading] = useState(true);
    const pendingRef = useRef<any[]>([]);

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
        } catch (error) {
            console.error("Error loading LPR data:", error);
        }
    };

    useEffect(() => { getDevices().then((d: any) => setDevices((d || []).filter((x: any) => x.deviceType === "LPR_CAMERA"))).catch(() => {}); getLastEventPerDevice().then(setLastCapByDev).catch(() => {}); getAvailableStreams().then((s: any) => setStreams(s || [])).catch(() => {}); }, []);
    const [platesPark, setPlatesPark] = useState<Set<string>>(new Set());
    useEffect(() => { Promise.all([getUnits(), getAccessGroups(), getParkingSlots()]).then(([u, g, p]: any) => { setUnits(u || []); setGroups(g || []); setParkingSlots(p || []); }).catch(() => {}); getPlatesWithParking().then((pl) => setPlatesPark(new Set(pl))).catch(() => {}); }, []);

    // Auto-refresh cada 5s: mismo efecto que el botón de refrescar (re-baja los eventos
    // con snapshotPath actualizado, no sólo cache-bust de imágenes).
    useEffect(() => {
        const id = setInterval(() => { loadInitialData(); }, 5000);
        return () => clearInterval(id);
    }, []);

    useEffect(() => {
        loadInitialData();
        const socketUrl = getSocketUrl();
        const newSocket = io(socketUrl, {
            transports: ["websocket", "polling"],
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

    const filteredEvents = useMemo(() => {
        return events.filter(e => {
            const plate = (e.plateDetected || '').toUpperCase();
            if (plate === 'DOOR_OPEN' || plate === 'DOOR_CLOSE') return false;
            if (activeFilter !== "ALL" && e.decision !== activeFilter) return false;
            return true;
        });
    }, [events, activeFilter]);

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

                    <div className="flex items-center gap-3">
                        {/* Connection status */}
                        <div className={cn(
                            "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium",
                            isConnected ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400"
                        )}>
                            <div className={cn("w-2 h-2 rounded-full", isConnected ? "bg-emerald-400 animate-pulse" : "bg-red-400")} />
                            {isConnected ? "LIVE" : "OFFLINE"}
                        </div>

                        {/* Quick stats */}
                        <div className="flex items-center gap-3 pl-1">
                            <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-blue-500/10 border border-blue-500/20 text-xs"><Car size={13} className="text-blue-400" /><span className="text-muted-foreground uppercase tracking-wide text-[10px] font-bold">Adentro</span><span className="font-bold text-blue-400 text-sm">{aforo.inside}</span></span>
                            <span className="flex items-center gap-1.5 text-xs"><Activity size={13} className="text-blue-400" /><span className="text-muted-foreground">Hoy</span><span className="font-bold text-foreground">{stats.total}</span></span>
                            <span className="flex items-center gap-1 text-xs"><CheckCircle2 size={13} className="text-emerald-400" /><span className="font-semibold text-emerald-400">{stats.grants}</span></span>
                            <span className="flex items-center gap-1 text-xs"><XCircle size={13} className="text-red-400" /><span className="font-semibold text-red-400">{stats.denies}</span></span>
                            <span className="text-[10px] text-muted-foreground hidden xl:inline">{filteredEvents.length} en buffer</span>
                        </div>
                        <div className="w-px h-5 bg-border" />

                        {/* Decision filter */}
                        <div className="flex bg-card rounded-lg p-0.5">
                            {(["ALL", "GRANT", "DENY"] as const).map(f => (
                                <button
                                    key={f}
                                    onClick={() => setActiveFilter(f)}
                                    className={cn(
                                        "px-3 py-1 text-xs rounded-md transition-all",
                                        activeFilter === f ? "bg-blue-500 text-foreground" : "text-muted-foreground hover:text-foreground"
                                    )}
                                >
                                    {f === "ALL" ? "Todos" : f === "GRANT" ? "Permitidos" : "Denegados"}
                                </button>
                            ))}
                        </div>

                        <Button variant="ghost" size="icon" onClick={loadInitialData} className="text-muted-foreground hover:text-foreground">
                            <RefreshCw size={16} />
                        </Button>
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
                                    {entryCams.map((d: any) => <CamTile key={d.id} dev={d} accent="emerald" ev={lastByCam[d.id] || lastCapByDev[d.id]} />)}
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
                                filteredEvents.map(e => <VehicleCard key={e.id} event={e} onRegister={openRegister} platesWithParking={platesPark} />)
                            )}
                        </div>
                    </div>

                    {/* CENTER: fixed spotlight + independently scrolling recent list */}
                    <div className="flex flex-col overflow-hidden">
                        <div className="shrink-0">
                            <CenterShot ev={filteredEvents[0]} onRegister={openRegister} />
                        </div>
                        <div className="flex-1 overflow-y-auto custom-scrollbar">
                            <div className="px-4 pt-2 pb-2">
                                <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Capturas recientes</div>
                            </div>
                            {eventsLoading && filteredEvents.length === 0
                                ? Array.from({ length: 6 }).map((_, i) => <VehicleCardSkeleton key={i} />)
                                : filteredEvents.slice(1, 15).map(e => <VehicleCard key={e.id} event={e} onRegister={openRegister} platesWithParking={platesPark} />)}
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
                                    {exitCams.map((d: any) => <CamTile key={d.id} dev={d} accent="orange" ev={lastByCam[d.id] || lastCapByDev[d.id]} />)}
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
                                filteredEvents.map(e => <VehicleCard key={e.id} event={e} onRegister={openRegister} platesWithParking={platesPark} />)
                            )}
                        </div>
                    </div>
                </div>
            </div>
                <UserFormDialog open={registerOpen} onOpenChange={(o) => { setRegisterOpen(o); if (!o) setRegisterInit(undefined); }} initialData={registerInit} units={units} groups={groups} devices={devices} parkingSlots={parkingSlots} onSuccess={() => { setRegisterOpen(false); setRegisterInit(undefined); loadInitialData(); }} />
        </TooltipProvider>
    );
}
