"use client";

import { IconosAvisosMonitor } from "@/components/avisos/PilaAvisos";
import { useFuncion } from "@/lib/funciones-cliente";
import { useSilencioAvisos } from "@/lib/avisos-pantalla";
import { useEffect, useState, useMemo, useRef, memo, useCallback, createContext, useContext } from "react";
import { io, Socket } from "socket.io-client";
import { useRouter } from "next/navigation";
import { getAccessEvents, getEventsCountToday, getLprCounters, getLastEventPerDevice, relecturasDeEventos } from "@/app/actions/history";
import { chapaDe, MarcaOmniVision, MarcaVerificacion, textoChapa } from "@/components/vision/ChapaReleida";
import type { RelecturaEvento } from "@/lib/relectura";
import { getDevices, getAvailableStreams, getEquiposApagados } from "@/app/actions/devices";
import { MinInteriorButton } from "@/components/MinInteriorButton";
import { PlateManualButton } from "@/components/PlateManualButton";
import { SugerenciaRelectura } from "@/components/monitor/SugerenciaRelectura";
import { IntrusionPanel } from "@/components/IntrusionPanel";
import { logosPorMatricula } from "@/app/actions/empresas";
import { LogoSobreFoto } from "@/components/empresas/LogoSobreFoto";
import { CajonPlaza } from "@/components/parking/CajonPlaza";
import { Cajon, CajonContenido } from "@/components/ui/cajon";
import { FichaDeteccion } from "@/components/intrusion/FichaDeteccion";
import { usarAlarmasIntrusion } from "@/components/intrusion/usarAlarmas";
import type { Geom } from "@/components/intrusion/comun";
import { getAnalyticsGeometryBatch, type DetItem } from "@/app/actions/detections";
import {
    Car,
    CheckCircle2,
    Ban,
    Siren,
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
import { VisorEventoAcceso } from "@/components/eventos/VisorEventoAcceso";
import { VerGrabacion, canalDe } from "@/components/video/VerGrabacion";
import Image from "next/image";
import { AccessEvent, Device, Unit } from "@prisma/client";
import { getCarLogo } from "@/lib/car-logos";
import { marcaDeEvento, AVISO_MARCA_CAMARA, useMarcasCamara, datoDeCamara } from "@/lib/marca-vehiculo";
import { MarcaFormatoChapa } from "@/components/ui/MarcaFormatoChapa";
import { getVehicleBrandName } from "@/lib/hikvision-codes";
import { rotuloLectura } from "@/lib/lectura-metodo";
import { getImagePath } from "@/lib/image-path";
import { getSocketUrl } from "@/lib/socket-config";
import { getUnits } from "@/app/actions/units";
import { getAccessGroups } from "@/app/actions/groups";
import { getParkingSlots, getPlatesWithParking } from "@/app/actions/parking";
import { getWatchMap } from "@/app/actions/watchlist";
import { getComportamientoPadron } from "@/app/actions/padron";
import {
    claseDeLectura, ESTILO_MONITOR, ESTILO_APAGADO, normalizarComportamiento, COMPORTAMIENTO_DEFECTO,
    type ClaseMonitor, type ClaveComportamiento, type Comportamiento,
} from "@/lib/padron";
import { watchCatMeta } from "@/lib/watch-categories";
import { WatchlistDialog } from "@/components/WatchlistDialog";
import { getParkingElements, getPresenceSummary } from "@/app/actions/plazas";
import { RegistrarMatricula } from "@/components/registro/RegistrarMatricula";
import { Filtros } from "@/components/ui/filtros";
import { ElegirArea } from "@/components/devices/ElegirArea";
import { useFiltroArea } from "@/lib/use-filtro-area";
import { parseVehicleMeta, collectVehicleFacets } from "@/lib/vehicle-details";

/** Matrícula → logo de su empresa (ver logosPorMatricula). */
type LogosMatricula = Awaited<ReturnType<typeof logosPorMatricula>>;

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

/**
 * Tipo de usuario reconocido en cada detección (color + etiqueta).
 *
 * La clase sale de lib/padron (claseDeLectura): lista negra > VIP > la pestaña del rol. Los
 * colores también viven allá (ESTILO_MONITOR), para que la muestra de cada pestaña en
 * /admin/users sea exactamente esto. Con «Color propio» apagado en esa pestaña, la etiqueta se
 * sigue viendo (el guardia necesita saber quién es), en gris y sin franja.
 */
type TipoMeta = { key: string; label: string; badge: string; ring: string; dot: string };
/** La clave vieja de cada clase: la usan las tarjetas («residente» suma el lote, «negra» el borde rojo). */
const CLAVE_VIEJA: Record<ClaseMonitor, string> = { residentes: "residente", personal: "personal", proveedores: "proveedor", visitas: "visitante", vip: "blanca", alerta: "negra", busqueda: "busqueda" };
/** Los interruptores de las pestañas (Usuarios → «Cómo se comporta»). Se leen al cargar el monitor. */
const ComportamientoCtx = createContext<Comportamiento>(normalizarComportamiento(COMPORTAMIENTO_DEFECTO));
/**
 * Las relecturas de OmniVision que llegaron DESPUÉS que el evento. Una NO_LEIDA entra por el
 * socket sin relectura (vision-worker la relee 1-5 s después); el monitor la va a buscar y la
 * deja acá, y cada tarjeta la toma con `relecturaDe`.
 */
const RelecturasCtx = createContext<Record<string, RelecturaEvento>>({});
function useRelectura(ev: any): RelecturaEvento | null {
    const m = useContext(RelecturasCtx);
    return ev?.relectura || (ev?.id ? m[ev.id] : null) || null;
}
/** Cuánto se sigue esperando la relectura de una NO_LEIDA nueva, y cada cuánto se pregunta. */
const RELECTURA_ESPERA_MAX_MS = 120_000;
const RELECTURA_SONDEO_MS = 3_000;
const esSinLeer = (p?: string | null) => !p || ["NO_LEIDA", "UNKNOWN", "S/P"].includes(String(p).toUpperCase());
function tipoDeteccion(event: any, watch?: any, comp?: Comportamiento): TipoMeta | null {
    const clase = claseDeLectura(event?.user, watch?.category);
    if (!clase) return event?.user
        ? { key: "otro", label: "Registrado", badge: "bg-zinc-500/15 text-zinc-300 border border-zinc-500/40", ring: "ring-1 ring-zinc-500/40", dot: "bg-zinc-400" }
        : { key: "desconocido", label: "Desconocido", badge: "bg-zinc-600/20 text-zinc-400 border border-zinc-600/40", ring: "", dot: "bg-zinc-500" };
    const e = ESTILO_MONITOR[clase];
    // La lista negra no se apaga: es justamente lo que tiene que resaltar.
    const conColor = clase === "alerta" ? true : (comp?.[clase as ClaveComportamiento]?.color ?? true);
    return conColor
        ? { key: CLAVE_VIEJA[clase], label: e.etiqueta, badge: e.badge, ring: e.ring, dot: e.dot }
        : { key: CLAVE_VIEJA[clase], label: e.etiqueta, ...ESTILO_APAGADO };
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
    const relCam = useRelectura(ev);
    const chCam = chapaDe(plate, relCam);
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
                    <div className={cn("inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md font-mono text-sm font-bold tracking-widest text-white backdrop-blur-sm border shadow-lg",
                        chCam.omni ? "bg-black/65 border-dashed border-[var(--accion-en-oscuro)]" : anomalous ? "bg-yellow-500/40 border-yellow-300/50 text-yellow-100" : ok ? "bg-emerald-600/80 border-emerald-300/40" : "bg-red-600/80 border-red-300/40")}>
                        {/* Una NO_LEIDA: la chapa que leyó OmniVision, con su destello. */}
                        {chCam.omni ? <>{textoChapa(chCam)}<MarcaOmniVision r={relCam} oscuro tamano="xs" soloIcono /></> : anomalous ? "S/L" : <>{plate}<MarcaVerificacion plate={plate} r={relCam} oscuro tamano="xs" soloIcono /></>}
                    </div>
                </div>
            )}
        </div>
    );
    // Una lectura que todavía no es evento de acceso (sinEvento: avistamiento viejo de una
    // interior) no tiene ficha que abrir: el diálogo pediría un AccessEvent que no existe.
    return ev && !ev.sinEvento ? (
        <div className="relative group/cam">
            <VisorEventoAcceso event={relCam && !ev.relectura ? { ...ev, relectura: relCam } : ev} timeStatus={null} onRegister={(p) => onRegister?.(p)}>
                <button type="button" className="block w-full text-left cursor-pointer">{inner}</button>
            </VisorEventoAcceso>
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
        <div ref={boxRef} className="relative flex-1 min-w-[180px] max-w-md hidden md:block">
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
function CenterShot({ ev, onRegister, dir, className, watchMap, logos }: { ev: any; onRegister?: (plate?: string) => void; dir?: "ENTRY" | "EXIT"; className?: string; watchMap?: Record<string, any>; logos?: LogosMatricula }) {
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
    const relHero = useRelectura(ev);
    const chHero = chapaDe(plate, relHero);
    // Padrón primero; la de la cámara sólo con LPR_MARCAS prendida (lib/marca-vehiculo).
    const marca = marcaDeEvento(ev, (String(ev.details || "").match(/Marca:\s*([^,]+)/)?.[1] || "").trim())?.marca || "";
    const crop = getImagePath((String(ev.details || "").match(/PlateCrop:\s*([^,]+)/)?.[1] || "").trim()) || "";
    const sentido = ev.direction;
    const watch = (ev as any).watch || (watchMap && ev.plateDetected ? watchMap[String(ev.plateDetected).toUpperCase()] : null);
    const comp = useContext(ComportamientoCtx);
    const tipo = tipoDeteccion(ev, watch, comp);
    const empresa = plate && logos ? logos[String(plate).toUpperCase()] : null;
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
                {/* El logo de la empresa (delivery, taxi) incrustado en la foto: abajo a la izquierda,
                    donde no tapa ni la patente ni la matrícula leída. */}
                {empresa && <div className="absolute left-3 bottom-3 z-20"><LogoSobreFoto empresa={empresa} className="h-[clamp(20px,2.6vw,40px)] max-w-[9vw]" /></div>}
                <div className="absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/95 via-black/60 to-transparent px-4 pb-3 pt-14 flex flex-col items-center">
                    {anomalous ? (
                        <div className="flex flex-col items-center gap-2">
                            {/* La cámara no leyó: la chapa la leyó OmniVision (doble verificación) y va donde
                                va la chapa, con el borde punteado y su marca. Si tampoco pudo, se dice. */}
                            {chHero.omni ? (
                                <div className="flex flex-col items-center gap-1">
                                    <div className="inline-block px-4 py-1.5 bg-black/55 rounded-lg border border-dashed border-[var(--accion-en-oscuro)] backdrop-blur-sm"><span className="font-mono text-[clamp(18px,1.9vw,30px)] font-bold tracking-[0.2em] text-white drop-shadow">{textoChapa(chHero)}</span></div>
                                    <MarcaOmniVision r={relHero} oscuro tamano="md" />
                                </div>
                            ) : (
                                <div className="flex flex-col items-center gap-1">
                                    <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-yellow-500/20 rounded-lg border border-yellow-500/50"><AlertTriangle size={18} className="text-yellow-300" /><span className="text-lg font-bold text-yellow-300">SIN LECTURA</span></div>
                                    {relHero && <MarcaOmniVision r={relHero} oscuro tamano="sm" />}
                                </div>
                            )}
                            {/* De quién es la chapa sugerida y si está en una lista: es lo que cambia lo que hace el guardia. */}
                            <SugerenciaRelectura r={relHero} sobreFoto soloContexto />
                            {ev.id && <PlateManualButton eventId={ev.id} currentPlate={plate} sugerida={relHero?.plate ? { plate: relHero.plate, confianza: relHero.confianza } : null} onSaved={() => router.refresh()} label className="!bg-white/15 hover:!bg-white/25 !text-amber-200 uppercase tracking-wide backdrop-blur" />}
                        </div>
                    ) : (
                        <div className="flex flex-col items-center gap-1">
                            <div className="inline-block px-4 py-1.5 bg-black/50 rounded-lg border border-blue-400/40 backdrop-blur-sm"><span className="font-mono text-[clamp(18px,1.9vw,30px)] font-bold tracking-[0.2em] text-white drop-shadow">{plate}</span></div>
                            <MarcaVerificacion plate={plate} r={relHero} oscuro tamano="md" />
                        </div>
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

const VehicleCard = memo(function VehicleCard({ event, onRegister, platesWithParking, watchMap, onPlaza, logos }: { event: any; onRegister: (p?: string) => void; platesWithParking?: Set<string>; watchMap?: Record<string, any>; onPlaza?: (plate: string) => void; logos?: LogosMatricula }) {
    const router = useRouter();
    const meta = parseMeta(event.details);
    // Padrón primero; la de la cámara, atenuada (lib/marca-vehiculo).
    useMarcasCamara();
    const marcaEv = marcaDeEvento(event, meta.Marca);
    const logoUrl = getCarLogo(marcaEv?.marca);
    const fullImageUrl = getImagePath(event.snapshotPath || event.imagePath) || "";
    const isAnomalous = event.plateDetected === "NO_LEIDA" || event.plateDetected === "unknown" || event.plateDetected === "S/P" || !event.plateDetected;
    const relCard = useRelectura(event);
    const chCard = chapaDe(event.plateDetected, relCard);
    const hasPlaza = !!(event.plateDetected && platesWithParking && platesWithParking.has(String(event.plateDetected).toUpperCase()));
    const _wp = event.plateDetected ? String(event.plateDetected).toUpperCase() : "";
    const watch = (event as any).watch || (watchMap && _wp ? watchMap[_wp] : null);
    const empresa = _wp && logos ? logos[_wp] : null;
    const watchMeta = watch ? watchCatMeta(watch.category) : null;
    const watchStyle = watchMeta ? { ring: watchMeta.ring, badge: watchMeta.badge, label: watchMeta.label.toUpperCase() } : null;
    const comp = useContext(ComportamientoCtx);
    const tipo = tipoDeteccion(event, watch, comp);
    const [nvrCh, setNvrCh] = useState<number | null>(null);
    const [showVid, setShowVid] = useState(false);
    useEffect(() => { let alive = true; const dev = (event as any).device; if (dev?.id) fetchNvrChannel(dev.id).then((ch) => { if (alive) setNvrCh(ch); }); return () => { alive = false; }; }, [(event as any).device?.id]);
    return (
      <>
        <VisorEventoAcceso event={relCard && !event.relectura ? { ...event, relectura: relCard } : event} timeStatus={null} onRegister={(p) => onRegister(p)} empresa={empresa}>
            <div className={cn(
                "relative p-3 cursor-pointer transition-all group border-b border-border last:border-0",
                isAnomalous ? "bg-yellow-500/5 hover:bg-yellow-500/10" : "hover:bg-accent",
                watchStyle?.ring || tipo?.ring
            )}>
                {tipo && <span className={cn("absolute left-0 top-0 bottom-0 w-1", tipo.dot)} />}
                <div className="flex items-center gap-3">
                    <div className="w-16 h-14 rounded-lg border border-border shrink-0 bg-card/60 flex items-center justify-center overflow-hidden p-1.5" title={!marcaEv ? "Marca desconocida" : marcaEv.deCamara ? `${marcaEv.marca} · ${AVISO_MARCA_CAMARA}` : `${marcaEv.marca} · del padrón`}>
                        {/* La marca en texto, sin logo del fabricante (17/10); la de la cámara, atenuada y en cursiva. */}
                        {logoUrl ? <Image src={logoUrl} alt={marcaEv?.marca || "marca"} width={48} height={48} className={cn("object-contain w-full h-full", marcaEv?.deCamara && "grayscale opacity-40")} />
                            : marcaEv ? <span className={cn("text-[10px] font-bold uppercase tracking-[0.04em] leading-[1.15] text-center line-clamp-2 break-words", marcaEv.deCamara ? "text-muted-foreground italic font-semibold" : "text-foreground")}>{marcaEv.marca}</span>
                                : <Car size={22} className="text-muted-foreground" />}
                    </div>
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                            {chCard.omni ? (
                                <span className="inline-flex items-center gap-1.5">
                                    <span className="font-mono text-sm font-bold text-foreground tracking-wider">{textoChapa(chCard)}</span>
                                    <MarcaOmniVision r={relCard} tamano="xs" />
                                </span>
                            ) : isAnomalous ? (
                                <div className="flex items-center gap-1.5 text-yellow-400">
                                    <AlertTriangle size={12} />
                                    <span className="text-xs font-bold">SIN LECTURA</span>
                                    {relCard && <MarcaOmniVision r={relCard} tamano="xs" soloIcono />}
                                </div>
                            ) : (
                                <span className="inline-flex items-center gap-1.5"><span className="font-mono text-sm font-bold text-foreground tracking-wider">{event.plateDetected}</span><MarcaFormatoChapa plate={event.plateDetected} /><MarcaVerificacion plate={event.plateDetected} r={relCard} tamano="xs" /></span>
                            )}
                            <Badge variant="outline" className={cn("text-[9px] px-1.5 py-0", event.decision === "GRANT" ? "border-emerald-500/50 text-emerald-400" : "border-red-500/50 text-red-400")}>{event.decision === "GRANT" ? "OK" : "DENY"}</Badge>
                            {watchStyle && <span className={cn("inline-flex items-center gap-1 text-[8px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded", watchStyle.badge)} title={watch?.label || ""}><ShieldAlert size={9} /> {watchStyle.label}</span>}
                            {!watchStyle && tipo && <span className={cn("inline-flex items-center gap-1 text-[8px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded", tipo.badge)}>{tipo.label}{tipo.key === "residente" && event.user?.unit?.name ? ` · ${event.user.unit.name}` : ""}</span>}
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            {empresa && <img src={empresa.logo} alt={empresa.nombre} title={empresa.nombre} className="h-4 w-auto max-w-16 object-contain" />}
                        </div>
                        {watch?.motivo && <p className={cn("text-[11px] font-semibold mt-1 truncate", watchMeta?.text)} title={watch.motivo}>{watch.motivo}</p>}
                        {isAnomalous && relCard?.plate && <div className="mt-1"><SugerenciaRelectura r={relCard} soloContexto /></div>}
                        <div className="flex items-center gap-2 mt-1">
                            {(marcaEv || meta.Tipo) && <span className="text-[10px] text-muted-foreground font-semibold">{[marcaEv?.marca, marcaEv ? (datoDeCamara(meta.Modelo) || meta.Tipo) : meta.Tipo].filter(Boolean).join(" · ")}</span>}
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
                        {onPlaza && <button onClick={(e) => { e.stopPropagation(); if (!isAnomalous && event.plateDetected) onPlaza?.(String(event.plateDetected).toUpperCase()); }} disabled={isAnomalous} title={isAnomalous ? "Sin matrícula leída: no hay plaza que buscar" : hasPlaza ? "Ver su plaza y el camino" : "Sin plaza: tocá para asignarle una"} className={cn("p-2 rounded-lg transition-colors", hasPlaza ? "text-emerald-500 hover:bg-emerald-500/15" : "text-red-500 hover:bg-red-500/15")}><SquareParking size={18} /></button>}
                    </div>
                </div>
            </div>
        </VisorEventoAcceso>
        {/* El visor único (vivo · grabación · evidencias), abierto en Grabación en el instante de la lectura. */}
        {showVid && nvrCh != null && (event as any).device?.id && <VerGrabacion deviceId={(event as any).device.id} nombre={(event as any).device?.name} canal={nvrCh} instanteMs={new Date(event.timestamp).getTime()} onClose={() => setShowVid(false)} />}
      </>
    );
});



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

function ColumnaSentido({ dir, camaras, eventos, ultimaPorCamara, cargando, onRegister, platesPark, watchMap, onPlaza, logos }: {
    dir: "ENTRY" | "EXIT";
    camaras: any[];
    eventos: any[];
    ultimaPorCamara: (id: string) => any;
    cargando: boolean;
    onRegister: (p?: string) => void;
    platesPark: Set<string>;
    watchMap: Record<string, any>;
    logos: LogosMatricula;
    /** Sin «Plazas de parking» (función de LPR) no hay botón de plaza. */
    onPlaza?: (plate: string) => void;
}) {
    const entrada = dir === "ENTRY";
    const Icono = entrada ? LogIn : LogOut;
    const sinLeer = eventos.filter((e) => !e.plateDetected || ["NO_LEIDA", "unknown", "S/P"].includes(e.plateDetected)).length;
    const ultimaDeCamaras = camaras.map((d: any) => ultimaPorCamara(d.id)).filter((e: any) => e?.timestamp)
        .sort((a: any, b: any) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())[0];
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
                    {/* La última de la columna; si la lista todavía no la trae, la más nueva de sus cámaras. */}
                    <CenterShot ev={eventos[0] || ultimaDeCamaras} onRegister={onRegister} dir={dir} className="aspect-video" watchMap={watchMap} logos={logos} />
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
                    eventos.slice(1).map((e) => <VehicleCard key={e.id} event={e} onRegister={onRegister} platesWithParking={platesPark} watchMap={watchMap} onPlaza={onPlaza} logos={logos} />)
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
    const [lastCapByDev, setLastCapByDev] = useState<Record<string, any>>({});
    const [isConnected, setIsConnected] = useState(false);
    const [devices, setDevices] = useState<Device[]>([]);
    // Áreas de Dispositivos (21/10, Nico): las columnas muestran sólo las cámaras del área elegida y
    // sus lecturas. Los números de «Hoy» siguen siendo del día entero (salen del servidor).
    const fa = useFiltroArea("monitor-lpr");
    /** Los equipos del área elegida (null = todas), en un ref: el refresco cada 5 s lo lee al momento. */
    const idsAreaRef = useRef<string[] | null>(null);
    const [streams, setStreams] = useState<string[]>([]);
    const router = useRouter();
    const [units, setUnits] = useState<any[]>([]);
    const [groups, setGroups] = useState<any[]>([]);
    const [parkingSlots, setParkingSlots] = useState<any[]>([]);
    const [registerOpen, setRegisterOpen] = useState(false);
    const [registerInit, setRegisterInit] = useState<{ plate?: string } | undefined>(undefined);
    // Lista negra, merodeo e intrusión ya no saltan acá: van a la pila de avisos de toda la app
    // (components/avisos, 20/10). Este monitor sólo conserva el contador de lecturas para revisar.
    const [eventsLoading, setEventsLoading] = useState(true);
    const [verDetecciones, setVerDetecciones] = useState(false);
    /** La detección abierta desde el cajón. Al cerrarla se vuelve al cajón, como en la ficha del evento. */
    const [fichaDet, setFichaDet] = useState<DetItem | null>(null);
    const [geomDet, setGeomDet] = useState<Geom | undefined>(undefined);
    // Las alarmas de intrusión y sus acciones (confirmar, falsa, resolver), las mismas que el
    // monitor de intrusión: la ficha y el cajón de Detecciones dejan de ser sólo para mirar.
    const alarmas = usarAlarmasIntrusion();
    useEffect(() => {
        setGeomDet(undefined);
        if (!fichaDet?.deviceId) return;
        getAnalyticsGeometryBatch([fichaDet.deviceId]).then((g) => setGeomDet(g?.[fichaDet.deviceId!])).catch(() => { });
    }, [fichaDet?.deviceId]);
    const pendingRef = useRef<any[]>([]);

    const lastEntry = events.find(e => e.direction === 'ENTRY');
    const lastExit = events.find(e => e.direction === 'EXIT');

    const loadInitialData = async () => {
        try {
            const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
            // Con un área elegida, las 50 lecturas se piden de SUS cámaras (22/10, Nico: «cuando cambio el
            // área no muestra bien las últimas capturas»): eran las 50 últimas de todo el servidor y
            // se filtraban acá; las de un área tranquila quedaban afuera y la columna salía vacía.
            const data = await getAccessEvents({ take: 50, from: twentyFourHoursAgo, type: "PLATE", ...(idsAreaRef.current ? { deviceIds: idsAreaRef.current } : {}) });
            setEvents(data.events as FullAccessEvent[]);
            setEventsLoading(false);
            const todayStats = await getEventsCountToday("PLATE");
            setStats(todayStats);
            getLprCounters().then(setAforo).catch(() => {});
        } catch (error) {
            console.error("Error loading LPR data:", error);
        }
    };

    // Las lectoras de barrera y las interiores que miran un acceso (trackAcceso): a esas
    // últimas las lee el contenedor, no la cámara, y sus lecturas no llegan por el socket
    // de access_event, así que su última captura se vuelve a pedir cada tanto.
    const esCamaraDeAcceso = (x: any) => x.deviceType === "LPR_CAMERA" || (x.deviceType === "LPR_INTERIOR" && !!x.trackAcceso);
    // Sólo las que leen matrículas de un acceso —ANPR de la cámara (LPR_CAMERA) o lectura de OmniVision
    // (LPR_INTERIOR que mira un acceso)— y que no estén apagadas por su área (22/10).
    useEffect(() => { Promise.all([getDevices(), getEquiposApagados().catch(() => [] as string[])]).then(([d, off]: any) => { const ap = new Set<string>(off || []); setDevices((d || []).filter((x: any) => esCamaraDeAcceso(x) && !ap.has(x.id))); }).catch(() => {}); getLastEventPerDevice().then(setLastCapByDev).catch(() => {}); getAvailableStreams().then((s: any) => setStreams(s || [])).catch(() => {}); }, []);
    const hayInterioresDeAcceso = useMemo(() => devices.some((x: any) => x.deviceType === "LPR_INTERIOR"), [devices]);
    useEffect(() => {
        if (!hayInterioresDeAcceso) return;
        const iv = setInterval(() => { getLastEventPerDevice().then(setLastCapByDev).catch(() => {}); }, REFRESCO_LECTURAS_INTERIOR_MS);
        return () => clearInterval(iv);
    }, [hayInterioresDeAcceso]);
    const [platesPark, setPlatesPark] = useState<Set<string>>(new Set());
    /** La matrícula cuya plaza se está mirando o asignando. Un solo cajón para toda la pantalla, no uno por fila. */
    const [plazaDe, setPlazaDe] = useState<string | null>(null);
    const plazasOn = useFuncion("LPR_PLAZAS");
    useEffect(() => { Promise.all([getUnits(), getAccessGroups(), getParkingSlots()]).then(([u, g, p]: any) => { setUnits(u || []); setGroups(g || []); setParkingSlots(p || []); }).catch(() => {}); getPlatesWithParking().then((pl) => setPlatesPark(new Set(pl))).catch(() => {}); }, []);

    // Watchlist (lista negra / búsqueda / VIP) — resaltado + sonido
    const [watchMap, setWatchMap] = useState<Record<string, any>>({});
    const [showWatch, setShowWatch] = useState(false);
    // El silencio es el de la pila de avisos (lib/avisos-pantalla): uno solo para todo el panel.
    const [silencioAvisos, setSilencioAvisos] = useSilencioAvisos();
    const soundOn = !silencioAvisos;
    const soundOnRef = useRef(true);
    useEffect(() => { soundOnRef.current = soundOn; }, [soundOn]);
    const audioCtxRef = useRef<any>(null);
    const lastAlertRef = useRef<Record<string, number>>({});
    // Los interruptores de cada pestaña de Usuarios («Cómo se comporta»): color propio y sonido
    // al pasar. Se releen con la lista negra, así un cambio llega sin recargar la pantalla.
    const [comportamiento, setComportamiento] = useState<Comportamiento>(normalizarComportamiento(COMPORTAMIENTO_DEFECTO));
    const comportamientoRef = useRef(comportamiento);
    useEffect(() => { comportamientoRef.current = comportamiento; }, [comportamiento]);
    const refreshWatch = useCallback(() => {
        getWatchMap().then((m) => setWatchMap(m || {})).catch(() => { });
        getComportamientoPadron().then(setComportamiento).catch(() => { /* queda lo anterior */ });
    }, []);
    // Qué matrícula es de qué empresa (con logo): proveedores registrados y visitas abiertas.
    // Al ritmo de la lista de vigilancia: una visita nueva tarda a lo sumo un minuto en mostrar el logo.
    const [logos, setLogos] = useState<LogosMatricula>({});
    const refrescarLogos = useCallback(() => { logosPorMatricula().then(setLogos).catch(() => { }); }, []);
    useEffect(() => { refrescarLogos(); const iv = setInterval(refrescarLogos, 60000); return () => clearInterval(iv); }, [refrescarLogos]);
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

            // Sonido al pasar, según la pestaña de quien pasa (Usuarios → «Cómo se comporta»): en
            // búsqueda suena por defecto; residentes, personal, etc. sólo si se prendió. La lista
            // NEGRA no pasa por acá: la maneja la pila crítica, con su alarma urgente aparte.
            const clase = claseDeLectura((event as any).user, (event as any).watch?.category);
            if (clase && clase !== "alerta" && plate && comportamientoRef.current[clase as ClaveComportamiento]?.sonido) playWatchAlert(plate);

            // Buffer the event; a 250ms flush loop coalesces bursts into a single render
            // so the main thread stays free to paint incoming snapshots.
            pendingRef.current.push(event);
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

    const vehFacets = useMemo(() => collectVehicleFacets(events as any[]), [events]);
    const filteredEvents = useMemo(() => {
        return events.filter(e => {
            const plate = (e.plateDetected || '').toUpperCase();
            if (plate === 'DOOR_OPEN' || plate === 'DOOR_CLOSE') return false;
            if (activeFilter !== "ALL" && e.decision !== activeFilter) return false;
            if (fa.filtrando && !fa.enArea((e as any).device?.id || (e as any).deviceId)) return false;
            if (filterColor !== "ALL" || filterVehType !== "ALL") {
                const m = parseVehicleMeta(e.details);
                if (filterColor !== "ALL" && m.color !== filterColor) return false;
                if (filterVehType !== "ALL" && m.typeLabel !== filterVehType) return false;
            }
            return true;
        });
    }, [events, activeFilter, filterColor, filterVehType, fa.filtrando, fa.enArea]);

    const entryEvents = useMemo(() => filteredEvents.filter(e => e.direction === 'ENTRY'), [filteredEvents]);
    const exitEvents = useMemo(() => filteredEvents.filter(e => e.direction === 'EXIT'), [filteredEvents]);
    const lprDevs = useMemo(() => devices.filter((x: any) => fa.enArea(x.id)), [devices, fa.enArea]);
    // Al cambiar el área: los ids nuevos y se vuelve a pedir enseguida (no al próximo refresco).
    const claveIds = fa.filtrando ? lprDevs.map((x: any) => x.id).sort().join(",") : "";
    useEffect(() => {
        idsAreaRef.current = fa.filtrando ? (claveIds ? claveIds.split(",") : []) : null;
        if (devices.length) { setEventsLoading(true); loadInitialData(); }
    }, [claveIds, fa.filtrando, devices.length]); // eslint-disable-line react-hooks/exhaustive-deps
    const entryCams = useMemo(() => (lprDevs as any[]).filter((x: any) => x.direction === 'ENTRY'), [lprDevs]);
    const exitCams = useMemo(() => (lprDevs as any[]).filter((x: any) => x.direction === 'EXIT'), [lprDevs]);
    /*
     * La doble verificación de OmniVision llega después que la NO_LEIDA: se pregunta cada pocos
     * segundos por las que todavía no la tienen (y son recientes), hasta que aparece.
     */
    const [relecturas, setRelecturas] = useState<Record<string, RelecturaEvento>>({});
    // Las cámaras con doble verificación (lib/modo-camara.ts): de esas se espera la relectura de
    // TODA lectura, no sólo de las NO_LEIDA. Sale de la lista de equipos y no del evento, porque el
    // evento que llega por el socket trae la cámara como la conoce server.js.
    const verifican = useMemo(() => new Set(devices.filter((x: any) => x.lprVerifica).map((x: any) => x.id as string)), [devices]);
    const esperando = useMemo(() => {
        const ahora = Date.now();
        const todos = [...events, ...Object.values(lastCapByDev)] as any[];
        return [...new Set(todos.filter((e) => e?.id && !e.sinEvento && (esSinLeer(e.plateDetected) || verifican.has(e.device?.id || e.deviceId)) && !e.relectura && !relecturas[e.id]
            && ahora - new Date(e.timestamp).getTime() < RELECTURA_ESPERA_MAX_MS).map((e) => e.id as string))];
    }, [events, lastCapByDev, relecturas, verifican]);
    useEffect(() => {
        if (!esperando.length) return;
        const desde = Date.now();
        const iv = setInterval(() => {
            if (Date.now() - desde > RELECTURA_ESPERA_MAX_MS) { clearInterval(iv); return; }
            relecturasDeEventos(esperando).then((m) => { if (Object.keys(m).length) setRelecturas((r) => ({ ...r, ...m })); }).catch(() => {});
        }, RELECTURA_SONDEO_MS);
        return () => clearInterval(iv);
    }, [esperando.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

    const lastByCam = useMemo(() => {
        const m: Record<string, any> = {};
        for (const e of events) { const id = (e as any).device?.id; if (id && !m[id]) m[id] = e; }
        return m;
    }, [events]);
    const openRegister = useCallback((plate?: string) => { if (!plate) return; setRegisterInit({ plate: String(plate).toUpperCase() }); setRegisterOpen(true); }, []);

    return (
        <ComportamientoCtx.Provider value={comportamiento}>
        <RelecturasCtx.Provider value={relecturas}>
        <TooltipProvider>
            <div className="h-full flex flex-col bg-background text-foreground">
                {/* Cabecera en dos renglones (16/10, Nico: «mejorá los filtros de arriba, no se
                    entiende»). Arriba: qué pantalla es, el buscador de matrícula y las acciones.
                    Abajo: los filtros de la lista de lecturas, con los conteos de hoy adentro de cada
                    opción en vez de un bloque de números sueltos (✓ / ✗) que no decía qué filtraba.
                    Quién está adentro se mira en Gestión de alarmas y en la pared (Control LPR). */}
                {/* Cabecera en UN renglón (16/10, Nico: «los controles de arriba están en varias filas;
                    el buscador y los filtros tienen que caber en la misma»): qué pantalla es, el
                    buscador, los filtros de la lista —permitidas y denegadas con su ícono y su
                    número— y las acciones. Lo que se prende y se apaga (anomalías, intrusiones,
                    sonido) es sólo ícono; Detecciones y Lista negra conservan el rótulo. */}
                <div className="px-6 py-3 border-b border-border shrink-0 flex items-center gap-3">
                    <div className="flex items-center gap-3 shrink-0">
                        <span className="grid place-items-center w-10 h-10 rounded-[10px] bg-muted/60 text-[var(--accion)]">
                            <Car size={20} />
                        </span>
                        <div>
                            <h1 className="text-lg font-bold tracking-tight whitespace-nowrap">Monitor LPR</h1>
                            <p className="text-xs text-muted-foreground hidden 2xl:block">Reconocimiento de matrículas en tiempo real</p>
                        </div>
                    </div>

                    <PlateCommandBar />

                    <Filtros className="flex-nowrap shrink-0"
                        grupos={[{
                            clave: "resultado", titulo: "Lecturas de hoy, por resultado",
                            valor: activeFilter, alElegir: (v) => setActiveFilter(v as any),
                            opciones: [
                                { valor: "ALL", rotulo: "Hoy", cuenta: stats.total },
                                { valor: "GRANT", rotulo: "", titulo: "Permitidas", icono: CheckCircle2, cuenta: stats.grants, tono: "bien" },
                                { valor: "DENY", rotulo: "", titulo: "Denegadas", icono: Ban, cuenta: stats.denies, tono: "mal" },
                            ],
                        }]}>
                        {fa.hayAreas && (
                            <ElegirArea areas={fa.areas} valor={fa.area} alElegir={fa.setArea} compacto
                                cuenta={(a) => devices.filter((x: any) => fa.enAreaDe(a, x.id)).length}
                                sinArea={devices.some((x: any) => !fa.areaDe(x.id))} />
                        )}
                        {vehFacets.colors.length > 0 && (
                            <select value={filterColor} onChange={(e) => setFilterColor(e.target.value)} title="Color del vehículo"
                                className={cn("h-[34px] rounded-lg bg-muted/60 border-0 px-3 text-[12px] font-semibold focus:outline-none focus:ring-2 focus:ring-[var(--accion)]/40", filterColor === "ALL" ? "text-muted-foreground" : "text-foreground")}>
                                <option value="ALL">Color</option>
                                {vehFacets.colors.map((c) => <option key={c} value={c}>{c}</option>)}
                            </select>
                        )}
                        {vehFacets.types.length > 0 && (
                            <select value={filterVehType} onChange={(e) => setFilterVehType(e.target.value)} title="Tipo de vehículo"
                                className={cn("h-[34px] rounded-lg bg-muted/60 border-0 px-3 text-[12px] font-semibold focus:outline-none focus:ring-2 focus:ring-[var(--accion)]/40", filterVehType === "ALL" ? "text-muted-foreground" : "text-foreground")}>
                                <option value="ALL">Tipo</option>
                                {vehFacets.types.map((t) => <option key={t} value={t}>{t}</option>)}
                            </select>
                        )}
                        {(activeFilter !== "ALL" || filterColor !== "ALL" || filterVehType !== "ALL") && (
                            <button type="button" onClick={() => { setActiveFilter("ALL"); setFilterColor("ALL"); setFilterVehType("ALL"); }}
                                className="h-[34px] w-[34px] rounded-lg grid place-items-center text-muted-foreground hover:text-foreground hover:bg-accent" title="Quitar los filtros" aria-label="Quitar los filtros">
                                <X size={14} />
                            </button>
                        )}
                    </Filtros>

                    <div className="flex items-center gap-2.5 shrink-0">
                        {/* Las acciones: un solo grupo, un solo alto, la misma superficie que los filtros. */}
                        <div className="flex items-center h-[34px] rounded-lg bg-muted/60 p-0.5 gap-0.5">
                            {/* Las detecciones de las cámaras (cruces, zonas) vivían en la columna del centro; ahora en un cajón. */}
                            <button onClick={() => setVerDetecciones(true)} title="Detecciones de las cámaras (cruces de línea, zonas)" className="relative h-[30px] px-2.5 rounded-md inline-flex items-center gap-1.5 text-[12px] font-semibold text-muted-foreground hover:text-foreground hover:bg-background transition-colors">
                                <Radar size={15} /><span className="hidden 2xl:inline">Detecciones</span>
                                {/* Cámaras que esperan una decisión (sin confirmar o confirmadas sin resolver). */}
                                {(alarmas.porCamara.size + alarmas.atencion.size) > 0 && <span className="absolute -top-1 -right-1 min-w-[15px] h-[15px] px-1 rounded-full pleno-mal text-[9px] font-bold flex items-center justify-center">{new Set([...alarmas.porCamara.keys(), ...alarmas.atencion]).size}</span>}
                            </button>
                            {/* Con el rótulo a la vista: sólo el escudo no se reconocía como la lista negra (San Nicolás, 15/10). */}
                            <button onClick={() => setShowWatch(true)} title="Lista negra" className="relative h-[30px] px-2.5 rounded-md inline-flex items-center gap-1.5 text-[12px] font-semibold text-muted-foreground hover:text-foreground hover:bg-background transition-colors">
                                <ShieldAlert size={15} /><span className="hidden 2xl:inline">Lista negra</span>
                                {Object.keys(watchMap).length > 0 && <span className="absolute -top-1 -right-1 min-w-[15px] h-[15px] px-1 rounded-full pleno-mal text-[9px] font-bold flex items-center justify-center tabular-nums">{Object.keys(watchMap).length}</span>}
                            </button>
                            {/* Qué avisos saltan y la lectura en voz alta (la pila de avisos, components/avisos). */}
                            <IconosAvisosMonitor />
                            <button onClick={() => setSilencioAvisos(!silencioAvisos)} title={soundOn ? "Silenciar alertas" : "Activar sonido"} aria-pressed={!soundOn}
                                className={cn("h-[30px] w-[30px] rounded-md grid place-items-center transition-colors", soundOn ? "text-muted-foreground hover:text-foreground hover:bg-background" : "bg-background tono-mal")}>
                                {soundOn ? <Volume2 size={15} /> : <VolumeX size={15} />}
                            </button>
                            <button onClick={loadInitialData} title="Volver a pedir" className="h-[30px] w-[30px] rounded-md grid place-items-center text-muted-foreground hover:text-foreground hover:bg-background transition-colors">
                                <RefreshCw size={15} />
                            </button>
                        </div>

                        <Cajon open={verDetecciones} onOpenChange={setVerDetecciones}>
                            <CajonContenido ancho="intermedio" titulo="Detecciones" descripcion="Cruces de línea, intrusiones y zonas de las cámaras, con la hora exacta. Tocá una para ver la captura y la grabación.">
                                {verDetecciones && <IntrusionPanel enCajon alarmas={alarmas} alAbrir={(d) => { setVerDetecciones(false); setFichaDet(d); }} />}
                            </CajonContenido>
                        </Cajon>
                        {showWatch && <WatchlistDialog onClose={() => { setShowWatch(false); refreshWatch(); }} />}
                    </div>
                </div>

                {/* Dos columnas, un sentido cada una. */}
                <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-border overflow-hidden">
                    <ColumnaSentido dir="ENTRY" camaras={entryCams} eventos={entryEvents} ultimaPorCamara={(id) => lastByCam[id] || lastCapByDev[id]}
                        cargando={eventsLoading} onRegister={openRegister} platesPark={platesPark} watchMap={watchMap} onPlaza={plazasOn ? setPlazaDe : undefined} logos={logos} />
                    <ColumnaSentido dir="EXIT" camaras={exitCams} eventos={exitEvents} ultimaPorCamara={(id) => lastByCam[id] || lastCapByDev[id]}
                        cargando={eventsLoading} onRegister={openRegister} platesPark={platesPark} watchMap={watchMap} onPlaza={plazasOn ? setPlazaDe : undefined} logos={logos} />
                </div>
            </div>
                {fichaDet && <FichaDeteccion det={fichaDet} geom={geomDet} onClose={() => { setFichaDet(null); setVerDetecciones(true); }}
                    hasAlarm={alarmas.tieneAlarma(fichaDet.deviceId)} onResolveAlarm={(id, k) => { alarmas.resolver(id, k); setFichaDet(null); setVerDetecciones(true); }}
                    enAtencion={alarmas.enAtencion(fichaDet.deviceId)} onCerrarAtencion={(id, como) => { alarmas.cerrarAtencion(id, como); setFichaDet(null); setVerDetecciones(true); }}
                    onMarcar={alarmas.marcar} />}
                {plazasOn && <CajonPlaza plate={plazaDe} onClose={() => setPlazaDe(null)}
                    onRegistrar={(p) => { setPlazaDe(null); openRegister(p); }}
                    alCambiar={() => getPlatesWithParking().then((pl) => setPlatesPark(new Set(pl))).catch(() => { })} />}
                {/* Registrar pregunta primero qué es la matrícula (persona del barrio o seguimiento)
                    y recién ahí abre el cajón que corresponde. Antes abría el alta vieja de persona. */}
                <RegistrarMatricula plate={registerOpen ? registerInit?.plate || null : null}
                    alCerrar={() => { setRegisterOpen(false); setRegisterInit(undefined); }}
                    alTerminar={() => { loadInitialData(); refreshWatch(); }}
                    units={units} groups={groups} devices={devices} parkingSlots={parkingSlots} />
        </TooltipProvider>
        </RelecturasCtx.Provider>
        </ComportamientoCtx.Provider>
    );
}
