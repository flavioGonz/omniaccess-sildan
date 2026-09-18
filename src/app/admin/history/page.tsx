"use client";

import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import PlateActivity from "@/components/dashboard/PlateActivity";
import { getAccessEvents } from "@/app/actions/history";
import { getEnabledModules } from "@/app/actions/modules";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { History, Search, Filter, Calendar as CalendarIcon, User as UserIcon, HardDrive, ArrowRightCircle, ArrowLeftCircle, Download, Camera, Loader2, Clock, Car, CreditCard, Building2, ArrowUpRight, ArrowDownLeft, Phone, MapPin, CheckCircle2, XCircle, X, MoreHorizontal, TrendingUp, ShieldAlert, Activity, Fingerprint, ScanFace, BadgeAlert, Cpu, Wifi, ChevronDown, RefreshCw, AlertTriangle, Film, Upload, FileJson, Users, Zap, ChevronLeft, ChevronRight, Route } from "lucide-react";
import { AccessEvent, User, Device } from "@prisma/client";
import Image from "next/image";
import { EventDetailsDialog } from "@/components/dashboard/EventDetailsDialog";
import { cn } from "@/lib/utils";
import { Pista, Columna } from "@/components/ui/pista";
import { VisorCuadro } from "@/components/VisorCuadro";
import { getCarLogo } from "@/lib/car-logos";
import { getVehicleBrandName } from "@/lib/hikvision-codes";
import { VehicleMetaChips } from "@/components/VehicleMeta";
import { parseVehicleMeta, collectVehicleFacets } from "@/lib/vehicle-details";
import { ExportHistoryDialog } from "@/components/history/ExportHistoryDialog";
import { ImportHistoryDialog } from "@/components/history/ImportHistoryDialog";
import { io } from "socket.io-client";
import { useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { getSocketUrl } from "@/lib/socket-config";
import { getImagePath } from "@/lib/image-path";

const formatDuration = (ms: number) => {
    const minutes = Math.floor(ms / 60000);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ${hours % 24}h`;
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m`;
    return `< 1m`;
};

function formatTime(date: Date): string {
    return new Date(date).toLocaleTimeString("es-UY", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

const MotionTableRow = motion(TableRow);

type FullAccessEvent = any;

const cleanPlate = (p: any) => String(p || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

function fmtDur(ms: number): string {
    const sec = Math.floor(ms / 1000); const h = Math.floor(sec / 3600); const m = Math.floor((sec % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m` : `${sec}s`;
}

/**
 * Avistamientos de las camaras interiores. Reusa el buscador y el rango de fechas
 * de la barra de arriba; lo demas (permitido/denegado, entrada/salida) no aplica,
 * porque una lectura interior no decide nada.
 */
/**
 * Un grupo de filtros con su rótulo arriba y la explicación al pasar el mouse.
 *
 * La barra tenía cuatro segmentados pegados sin nada que dijera qué filtraba cada uno:
 * había que apretar para averiguarlo. El rótulo cuesta una línea y lo resuelve.
 */
function GrupoFiltro({ rotulo, ayuda, children, oculto }: { rotulo: string; ayuda: string; children: React.ReactNode; oculto?: boolean }) {
    if (oculto) return null;
    return (
        <div className="flex flex-col gap-1">
            <Pista titulo={rotulo} texto={ayuda} lado="arriba" className="self-start">
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70 cursor-help hover:text-muted-foreground transition-colors">{rotulo}</span>
            </Pista>
            <div className="flex items-center gap-1 bg-muted/40 rounded-md p-1 border border-border/30">{children}</div>
        </div>
    );
}

/** Lo que está filtrando ahora mismo, y cómo sacarlo de encima. */
function ChipFiltro({ children, onQuitar }: { children: React.ReactNode; onQuitar: () => void }) {
    return (
        <motion.span
            initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }}
            transition={{ duration: 0.15 }}
            className="inline-flex items-center gap-1.5 pl-2.5 pr-1.5 py-1 rounded-full bg-blue-500/10 border border-blue-500/25 text-[11px] font-semibold text-blue-300">
            {children}
            <button onClick={onQuitar} className="w-4 h-4 rounded-full hover:bg-blue-500/25 flex items-center justify-center text-blue-300/70 hover:text-blue-200">
                <X size={10} />
            </button>
        </motion.span>
    );
}

/** Fila gris con latido, para que la tabla no salte de vacía a llena de golpe. */
function FilaFantasma({ celdas }: { celdas: number }) {
    const anchos = [70, 55, 40, 60, 45, 30, 35, 25, 20];
    return (
        <tr className="border-b border-border/20">
            {Array.from({ length: celdas }).map((_, i) => (
                <td key={i} className="px-5 py-4">
                    <div className="h-3 rounded bg-muted/60 animate-pulse" style={{ width: `${anchos[i % anchos.length]}%` }} />
                </td>
            ))}
        </tr>
    );
}

function TablaSeguimiento({ buscar, desde, hasta }: { buscar: string; desde: string; hasta: string }) {
    const [filas, setFilas] = useState<any[]>([]);
    const [total, setTotal] = useState(0);
    const [cargando, setCargando] = useState(false);
    const [pagina, setPagina] = useState(0);
    const [viendo, setViendo] = useState<number | null>(null);
    const POR_PAGINA = 50;

    useEffect(() => { setPagina(0); }, [buscar, desde, hasta]);

    useEffect(() => {
        let vivo = true;
        setCargando(true);
        const p = new URLSearchParams({ take: String(POR_PAGINA), skip: String(pagina * POR_PAGINA) });
        if (buscar) p.set("search", buscar);
        if (desde) p.set("from", desde);
        if (hasta) p.set("to", hasta);
        fetch(`/api/tracking/history?${p.toString()}`, { cache: "no-store" })
            .then(r => r.json())
            .then(j => { if (!vivo) return; setFilas(pagina === 0 ? (j.filas || []) : ((f: any[]) => [...f, ...(j.filas || [])]) as any); setTotal(j.total || 0); })
            .catch(() => { })
            .finally(() => { if (vivo) setCargando(false); });
        return () => { vivo = false; };
    }, [buscar, desde, hasta, pagina]);

    return (
        <div className="bg-card/60 border border-border/50 rounded-lg overflow-hidden">
            <div className="px-5 py-3 border-b border-border/50 flex items-center gap-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-violet-300">Seguimiento interior</span>
                <span className="text-[11px] text-muted-foreground">
                    lecturas de las camaras comunes procesadas por Omni-LPR · no abren barrera
                </span>
            </div>
            <div className="overflow-x-auto">
                <table className="w-full text-left">
                    <thead className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm">
                        <tr className="border-b border-border/50">
                            <Columna icono={Clock} titulo="Momento de la lectura"
                                ayuda="Cuándo pasó el vehículo por esa cámara. No es cuándo se guardó: es el momento del cuadro.">Momento</Columna>
                            <Columna icono={Car} titulo="Matrícula leída"
                                ayuda="Lo que el lector sacó del cuadro, después de comparar varias tomas del mismo paso.">Matrícula</Columna>
                            <Columna icono={Camera} titulo="Cámara que la vio"
                                ayuda="Una cámara interior. No abre barrera: solo deja constancia de por dónde pasó el vehículo.">Cámara</Columna>
                            <Columna icono={Activity} titulo="Qué tan segura es la lectura"
                                ayuda="Verde arriba de 85%, ámbar entre 65 y 85, rojo debajo. Una lectura baja no es necesariamente errada, pero conviene mirar el cuadro.">Confianza</Columna>
                            <Columna icono={Camera} alinear="right" titulo="El cuadro guardado"
                                ayuda="La foto del momento. Hacé clic en la fila para verla grande, con los datos encima.">Cuadro</Columna>
                        </tr>
                    </thead>
                    <tbody>
                        {filas.length === 0 && cargando ? (
                            <>{Array.from({ length: 6 }).map((_, i) => <FilaFantasma key={i} celdas={5} />)}</>
                        ) : filas.length === 0 ? (
                            <tr>
                                <td colSpan={5} className="py-16 text-center">
                                    <div className="flex flex-col items-center gap-2">
                                        <Route className="w-8 h-8 text-muted-foreground/50" />
                                        <p className="text-sm text-muted-foreground">Sin avistamientos en este período</p>
                                        <p className="text-xs text-muted-foreground/70 max-w-sm mx-auto">
                                            Las cámaras interiores registran cada vehículo que pasa. Si está vacío, o no pasó
                                            ninguno, o todavía no hay cámaras interiores dadas de alta.
                                        </p>
                                    </div>
                                </td>
                            </tr>
                        ) : filas.map((f, i) => {
                            const conf = typeof f.confidence === "number" ? Math.round(f.confidence * 100) : null;
                            return (
                                <motion.tr key={f.id}
                                    initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
                                    transition={{ duration: 0.18, delay: Math.min(i, 14) * 0.015 }}
                                    onClick={() => f.snapshotUrl && setViendo(i)}
                                    className={cn("border-b border-border/30 hover:bg-muted/30 transition-colors", f.snapshotUrl && "cursor-pointer")}>
                                    <td className="px-5 py-3">
                                        <p className="text-sm font-medium text-foreground">{new Date(f.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</p>
                                        <p className="text-[10px] text-muted-foreground mt-0.5">{new Date(f.timestamp).toLocaleDateString("es-UY", { day: "2-digit", month: "short", year: "numeric" })}</p>
                                    </td>
                                    <td className="px-5 py-3">
                                        <span className="px-2.5 py-0.5 rounded-md font-mono text-sm font-bold tracking-widest text-foreground bg-violet-500/15 border border-violet-500/30">{f.plate}</span>
                                    </td>
                                    <td className="px-5 py-3 text-sm text-foreground">{f.cameraName || f.deviceId || "-"}</td>
                                    <td className="px-5 py-3">
                                        {conf == null ? <span className="text-muted-foreground text-xs">-</span> : (
                                            <span className={cn("text-xs font-semibold", conf >= 85 ? "text-emerald-400" : conf >= 65 ? "text-amber-400" : "text-red-400")}>{conf}%</span>
                                        )}
                                    </td>
                                    <td className="px-5 py-3 text-right">
                                        {f.snapshotUrl ? (
                                            /* eslint-disable-next-line @next/next/no-img-element */
                                            <img src={f.snapshotUrl} alt={f.plate}
                                                className="h-12 w-20 object-cover rounded border border-border/50 ml-auto hover:border-violet-400/60 transition-colors" />
                                        ) : <span className="text-muted-foreground text-xs">-</span>}
                                    </td>
                                </motion.tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
            {viendo !== null && filas[viendo] && (
                <VisorCuadro
                    fila={filas[viendo]}
                    hayAnterior={viendo > 0}
                    haySiguiente={viendo < filas.length - 1}
                    onAnterior={() => setViendo((v) => (v === null ? v : Math.max(0, v - 1)))}
                    onSiguiente={() => setViendo((v) => (v === null ? v : Math.min(filas.length - 1, v + 1)))}
                    onCerrar={() => setViendo(null)}
                />
            )}

            <div className="flex items-center justify-between px-5 py-3 border-t border-border/50">
                <p className="text-xs text-muted-foreground">
                    Mostrando <span className="text-foreground font-semibold">{filas.length}</span> de <span className="text-foreground font-semibold">{total.toLocaleString()}</span> avistamientos
                </p>
                <div className="flex items-center gap-3">
                    {cargando && <span className="flex items-center gap-2 text-violet-400 text-xs font-semibold"><Loader2 size={14} className="animate-spin" /> Cargando...</span>}
                    {filas.length < total && !cargando && (
                        <button onClick={() => setPagina(p => p + 1)} className="px-3 py-1.5 rounded text-xs font-semibold bg-muted/60 border border-border/50 text-foreground hover:bg-muted">
                            Cargar mas
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}



export default function HistoryPage() {
    const [events, setEvents] = useState<FullAccessEvent[]>([]);
    const [totalEvents, setTotalEvents] = useState(0);
    const [loading, setLoading] = useState(false);
    const [searchTerm, setSearchTerm] = useState("");
    const _urlSearch = useSearchParams();
    useEffect(() => { const _q = _urlSearch.get("search"); if (_q) setSearchTerm(_q); /* eslint-disable-next-line */ }, []);
    const [filterDecision, setFilterDecision] = useState<"ALL" | "GRANT" | "DENY">("ALL");
    const [filterType, setFilterType] = useState<"ALL" | "PLATE" | "FACE" | "TAG">("ALL");
    const [activeMode, setActiveMode] = useState<"LPR" | "FACE" | "QUEUE" | null>(null);
    const [filterDirection, setFilterDirection] = useState<"ALL" | "ENTRY" | "EXIT">("ALL");
    const [filterColor, setFilterColor] = useState<string>("ALL");
    const [filterVehType, setFilterVehType] = useState<string>("ALL");
    const [startDate, setStartDate] = useState("");
    const [endDate, setEndDate] = useState("");
    const [isExportDialogOpen, setIsExportDialogOpen] = useState(false);
    const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
    useEffect(() => { setLastUpdate(new Date()); }, []);
    const [merodeoSet, setMerodeoSet] = useState<Set<string>>(new Set());
    const [mappedSet, setMappedSet] = useState<Set<string>>(new Set());
    const [mappedNameSet, setMappedNameSet] = useState<Set<string>>(new Set());
    const [mappedIpSet, setMappedIpSet] = useState<Set<string>>(new Set());
    const [filterMerodeo, setFilterMerodeo] = useState(false);
    const [isImportOpen, setIsImportOpen] = useState(false);
    // Accesos (AccessEvent) y seguimiento (PlateSighting) son dos registros distintos:
    // se miran por separado en vez de mezclarse en la misma tabla.
    const [vista, setVista] = useState<"accesos" | "seguimiento">("accesos");

    useEffect(() => {
        getEnabledModules().then(modules => {
            if (modules.MODULE_QUEUE) {
                setActiveMode("QUEUE");
                setFilterType("ALL");
            } else if (modules.MODULE_FACE && !modules.MODULE_LPR) {
                setActiveMode("FACE");
                setFilterType("FACE");
            } else if (modules.MODULE_LPR && !modules.MODULE_FACE) {
                setActiveMode("LPR");
                setFilterType("PLATE");
            } else {
                setActiveMode(null);
            }
        });
    }, []);

    useEffect(() => {
        const load = () => {
            fetch("/api/history/merodeo").then(r => r.json()).then(d => setMerodeoSet(new Set((d.plates || []).map((p: string) => cleanPlate(p))))).catch(() => {});
        };
        load();
        const iv = setInterval(load, 60000);
        const loadMapped = () => fetch("/api/nvr/mapped-devices").then(r => r.json()).then(d => {
            setMappedSet(new Set(d.deviceIds || []));
            setMappedNameSet(new Set(d.deviceNames || []));
            setMappedIpSet(new Set(d.deviceIps || []));
        }).catch(() => {});
        loadMapped();
        const iv2 = setInterval(loadMapped, 30000);
        window.addEventListener("focus", loadMapped);
        return () => { clearInterval(iv); clearInterval(iv2); window.removeEventListener("focus", loadMapped); };
    }, []);

    const exportJson = async () => {
        try {
            const resp: any = await getAccessEvents({ take: 100000, skip: 0, search: searchTerm, decision: filterDecision, type: filterType, direction: filterDirection, from: startDate ? new Date(startDate) : undefined, to: endDate ? new Date(endDate) : undefined });
            const evs = (resp.events || []).map((e: any) => ({ id: e.id, timestamp: e.timestamp, createdAt: e.createdAt, accessType: e.accessType, credentialId: e.credentialId, decision: e.decision, direction: e.direction, plateDetected: e.plateDetected, plateNumber: e.plateNumber, location: e.location, snapshotPath: e.snapshotPath, imagePath: e.imagePath, details: e.details, deviceName: e.device?.name || null }));
            const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), count: evs.length, events: evs }, null, 2)], { type: "application/json" });
            const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `omniaccess-historial-${new Date().toISOString().slice(0, 10)}.json`; a.click(); URL.revokeObjectURL(url);
        } catch (e) { console.error(e); }
    };

    const [page, setPage] = useState(0);
    const [hasMore, setHasMore] = useState(true);
    const ITEMS_PER_PAGE = 50;

    const filtersRef = useRef({ searchTerm, filterDecision, filterType, filterDirection, startDate, endDate, page });
    useEffect(() => {
        filtersRef.current = { searchTerm, filterDecision, filterType, filterDirection, startDate, endDate, page };
    }, [searchTerm, filterDecision, filterType, filterDirection, startDate, endDate, page]);

    useEffect(() => {
        const timer = setTimeout(() => {
            setPage(0);
            loadData(0, true);
        }, 500);
        return () => clearTimeout(timer);
    }, [searchTerm, filterDecision, filterType, filterDirection, startDate, endDate]);

    const observer = useRef<IntersectionObserver | null>(null);
    const lastElementRef = useCallback((node: HTMLTableRowElement) => {
        if (loading || !hasMore) return;
        if (observer.current) observer.current.disconnect();
        observer.current = new IntersectionObserver(entries => {
            if (entries[0].isIntersecting && !loading && hasMore) {
                setPage(prev => {
                    const nextPage = prev + 1;
                    setTimeout(() => loadData(nextPage, false), 0);
                    return nextPage;
                });
            }
        });
        if (node) observer.current.observe(node);
    }, [loading, hasMore]);

    async function loadData(pageIndex: number, reset: boolean) {
        setLoading(true);
        try {
            const response = await getAccessEvents({
                take: ITEMS_PER_PAGE,
                skip: pageIndex * ITEMS_PER_PAGE,
                search: searchTerm,
                decision: filterDecision,
                type: filterType,
                direction: filterDirection,
                from: startDate ? new Date(startDate) : undefined,
                to: endDate ? new Date(endDate) : undefined
            });
            // @ts-ignore
            const { events: newEvents, total } = response;
            setTotalEvents(total);
            setLastUpdate(new Date());

            if (reset) {
                setEvents(newEvents);
            } else {
                setEvents(prev => {
                    const existingIds = new Set(prev.map(e => e.id));
                    const uniqueNewEvents = newEvents.filter((e: any) => !existingIds.has(e.id));
                    return [...prev, ...uniqueNewEvents];
                });
            }
            setHasMore(newEvents.length >= ITEMS_PER_PAGE);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        const socketUrl = getSocketUrl();
        const socket = io(socketUrl, { path: "/io/socket.io", transports: ["polling"], upgrade: false,  });

        socket.on("access_event", (event: FullAccessEvent) => {
            const { searchTerm, filterDecision, filterType, filterDirection, startDate, endDate, page } = filtersRef.current;
            const matchesSearch = !searchTerm ||
                (event.plateDetected?.toLowerCase().includes(searchTerm.toLowerCase())) ||
                (event.user?.name?.toLowerCase().includes(searchTerm.toLowerCase())) ||
                (event.device?.name?.toLowerCase().includes(searchTerm.toLowerCase()));
            const matchesDecision = filterDecision === "ALL" || event.decision === filterDecision;
            const matchesType = filterType === "ALL" || event.accessType === filterType;
            const matchesDirection = filterDirection === "ALL" || event.direction === filterDirection;
            const eventDate = new Date(event.timestamp);
            const matchesStartDate = !startDate || eventDate >= new Date(startDate);
            const matchesEndDate = !endDate || eventDate <= new Date(endDate);

            if (matchesSearch && matchesDecision && matchesType && matchesDirection && matchesStartDate && matchesEndDate) {
                setEvents(prev => {
                    if (prev.find(e => e.id === event.id)) return prev;
                    return [event, ...prev].slice(0, ITEMS_PER_PAGE * (page + 1));
                });
                setTotalEvents(prev => prev + 1);
                setLastUpdate(new Date());
            }
        });

        return () => { socket.disconnect(); };
    }, []);

    const getImageUrl = (path: string | null | undefined): string => {
        return getImagePath(path) || "";
    };

    // Compute stats
    const grantCount = events.filter(e => e.decision === "GRANT").length;
    const denyCount = events.filter(e => e.decision === "DENY").length;
    const vehFacets = useMemo(() => collectVehicleFacets(events), [events]);

    /** Los filtros activos, en palabras, cada uno con su forma de sacarlo. */
    const filtrosPuestos = useMemo(() => {
        const l: { id: string; texto: string; quitar: () => void }[] = [];
        if (searchTerm.trim()) l.push({ id: "q", texto: `«${searchTerm.trim()}»`, quitar: () => setSearchTerm("") });
        if (startDate) l.push({ id: "d1", texto: `desde ${startDate}`, quitar: () => setStartDate("") });
        if (endDate) l.push({ id: "d2", texto: `hasta ${endDate}`, quitar: () => setEndDate("") });
        if (vista === "accesos") {
            const tipos: Record<string, string> = { PLATE: "matrícula", FACE: "rostro", TAG: "RFID" };
            if (filterType !== "ALL" && tipos[filterType]) l.push({ id: "t", texto: tipos[filterType], quitar: () => setFilterType("ALL") });
            if (filterDecision !== "ALL") l.push({ id: "dec", texto: filterDecision === "GRANT" ? "permitidos" : "denegados", quitar: () => setFilterDecision("ALL") });
            if (filterDirection !== "ALL") l.push({ id: "dir", texto: filterDirection === "ENTRY" ? "entradas" : "salidas", quitar: () => setFilterDirection("ALL") });
            if (filterColor !== "ALL") l.push({ id: "col", texto: `color ${filterColor}`, quitar: () => setFilterColor("ALL") });
            if (filterVehType !== "ALL") l.push({ id: "veh", texto: filterVehType, quitar: () => setFilterVehType("ALL") });
            if (filterMerodeo) l.push({ id: "mer", texto: "merodeo", quitar: () => setFilterMerodeo(false) });
        }
        return l;
    }, [searchTerm, startDate, endDate, vista, filterType, filterDecision, filterDirection, filterColor, filterVehType, filterMerodeo]);

    const limpiarFiltros = useCallback(() => {
        setSearchTerm(""); setStartDate(""); setEndDate("");
        setFilterType("ALL"); setFilterDecision("ALL"); setFilterDirection("ALL");
        setFilterColor("ALL"); setFilterVehType("ALL"); setFilterMerodeo(false);
    }, []);
    const displayEvents = (filterMerodeo ? events.filter(e => merodeoSet.has(cleanPlate(e.plateDetected))) : events)
        .filter(e => {
            if (filterColor === "ALL" && filterVehType === "ALL") return true;
            const m = parseVehicleMeta(e.details);
            if (filterColor !== "ALL" && m.color !== filterColor) return false;
            if (filterVehType !== "ALL" && m.typeLabel !== filterVehType) return false;
            return true;
        });

    return (
        <div className="p-6 lg:p-8 space-y-6 max-w-[1600px] mx-auto">
            {/* Header */}
            <div className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                    <h1 className="text-2xl font-bold text-foreground flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-blue-500/10 border-blue-500/30 border">
                            <History className="w-5 h-5 text-blue-400" />
                        </div>
                        Historial de Accesos
                    </h1>
                    <p className="text-sm text-muted-foreground mt-1 ml-12">
                        Registro de autorizaciones y eventos en tiempo real
                    </p>
                    {/* Mapa de actividad: lecturas por dia de los ultimos 6 meses */}
                    <div className="mt-4 ml-12">
                        <PlateActivity dias={180} label="lecturas" />
                    </div>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                    {/* Date filters */}
                    <div className="flex items-center gap-2 bg-muted/60 border border-border/50 rounded-md px-3 py-2">
                        <CalendarIcon className="w-4 h-4 text-muted-foreground" />
                        <input
                            type="date"
                            value={startDate}
                            onChange={(e) => setStartDate(e.target.value)}
                            className="bg-transparent border-none text-xs text-muted-foreground focus:outline-none w-28"
                        />
                        <span className="text-muted-foreground text-xs">—</span>
                        <input
                            type="date"
                            value={endDate}
                            onChange={(e) => setEndDate(e.target.value)}
                            className="bg-transparent border-none text-xs text-muted-foreground focus:outline-none w-28"
                        />
                    </div>

                    {/* Export button */}
                    <button
                        onClick={() => setIsExportDialogOpen(true)}
                        className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-foreground rounded-md px-4 py-2 text-sm font-semibold transition-colors"
                    >
                        <Download className="w-4 h-4" />
                        Exportar
                    </button>

                    {/* Export JSON */}
                    <button onClick={exportJson} title="Exportar JSON (reimportable)" className="flex items-center gap-2 bg-muted/60 hover:bg-muted text-muted-foreground hover:text-foreground border border-border/50 rounded-md px-3 py-2 text-sm font-semibold transition-colors">
                        <FileJson className="w-4 h-4" /> JSON
                    </button>

                    {/* Import */}
                    <button onClick={() => setIsImportOpen(true)} title="Importar registros de otra instancia" className="flex items-center gap-2 bg-muted/60 hover:bg-muted text-muted-foreground hover:text-foreground border border-border/50 rounded-md px-3 py-2 text-sm font-semibold transition-colors">
                        <Upload className="w-4 h-4" /> Importar
                    </button>

                    {/* Status pulse */}
                    <div className="flex items-center gap-2 bg-muted/40 rounded-md px-3 py-2 border border-border/30">
                        <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                        <span className="text-xs text-muted-foreground" suppressHydrationWarning>{lastUpdate ? formatTime(lastUpdate) : "--:--:--"}</span>
                        <button onClick={() => { setPage(0); loadData(0, true); }} className="text-muted-foreground hover:text-foreground transition-colors">
                            <RefreshCw className="w-3.5 h-3.5" />
                        </button>
                    </div>
                </div>
            </div>

            {/* Search + Filters */}
            <div className="bg-card/60 border border-border/50 rounded-lg p-5">
                <div className="flex items-center gap-4 flex-wrap">
                    {/* Search */}
                    <div className="relative flex-1 min-w-[250px]">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                        <input
                            type="text"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full bg-muted/60 border border-border/50 rounded-md py-2 pl-10 pr-4 text-sm text-muted-foreground focus:outline-none focus:ring-1 focus:ring-blue-500/50 placeholder:text-muted-foreground"
                            placeholder="Buscar por patente, nombre, terminal..."
                        />
                    </div>

                    {/* Accesos vs seguimiento */}
                    <GrupoFiltro rotulo="Registro" ayuda="Dos registros distintos. Accesos son las entradas y salidas que decidieron la barrera. Seguimiento son las lecturas de las cámaras interiores, que no deciden nada.">
                        <button onClick={() => setVista("accesos")} className={cn("px-3 py-1.5 rounded text-xs font-semibold transition-all", vista === "accesos" ? "bg-blue-600 text-foreground" : "text-muted-foreground hover:text-foreground")}>
                            Accesos
                        </button>
                        <button onClick={() => setVista("seguimiento")} className={cn("px-3 py-1.5 rounded text-xs font-semibold transition-all", vista === "seguimiento" ? "bg-violet-600 text-foreground" : "text-muted-foreground hover:text-foreground")}>
                            Seguimiento
                        </button>
                    </GrupoFiltro>

                    {/* Type filter tabs */}
                    <GrupoFiltro rotulo="Identificación" oculto={vista === "seguimiento"}
                        ayuda="Con qué se identificó: la matrícula (LPR), el rostro, o una tarjeta o llavero (RFID).">
                        {activeMode === null && (
                            <button onClick={() => setFilterType("ALL")} className={cn("px-3 py-1.5 rounded text-xs font-semibold transition-all", filterType === "ALL" ? "bg-blue-600 text-foreground" : "text-muted-foreground hover:text-foreground")}>
                                Todos
                            </button>
                        )}
                        {(activeMode === null || activeMode === "LPR") && (
                            <button onClick={() => setFilterType("PLATE")} className={cn("px-3 py-1.5 rounded text-xs font-semibold transition-all", filterType === "PLATE" ? "bg-blue-600 text-foreground" : "text-muted-foreground hover:text-foreground")}>
                                LPR
                            </button>
                        )}
                        {(activeMode === null || activeMode === "FACE") && (
                            <button onClick={() => setFilterType("FACE")} className={cn("px-3 py-1.5 rounded text-xs font-semibold transition-all", filterType === "FACE" ? "bg-blue-600 text-foreground" : "text-muted-foreground hover:text-foreground")}>
                                Rostros
                            </button>
                        )}
                        {activeMode !== "QUEUE" && (
                            <button onClick={() => setFilterType("TAG")} className={cn("px-3 py-1.5 rounded text-xs font-semibold transition-all", filterType === "TAG" ? "bg-blue-600 text-foreground" : "text-muted-foreground hover:text-foreground")}>
                                RFID
                            </button>
                        )}
                    </GrupoFiltro>

                    {/* Decision filter */}
                    <GrupoFiltro rotulo="Resultado" oculto={vista === "seguimiento"}
                        ayuda="Si el sistema abrió o no. Los denegados son los que conviene revisar: matrícula desconocida, permiso vencido u horario fuera de rango.">
                        <button onClick={() => setFilterDecision("ALL")} className={cn("px-3 py-1.5 rounded text-xs font-semibold transition-all", filterDecision === "ALL" ? "bg-blue-600 text-foreground" : "text-muted-foreground hover:text-foreground")}>
                            Todos
                        </button>
                        <button onClick={() => setFilterDecision("GRANT")} className={cn("px-3 py-1.5 rounded text-xs font-semibold transition-all", filterDecision === "GRANT" ? "bg-emerald-600 text-foreground" : "text-muted-foreground hover:text-foreground")}>
                            Permitidos
                        </button>
                        <button onClick={() => setFilterDecision("DENY")} className={cn("px-3 py-1.5 rounded text-xs font-semibold transition-all", filterDecision === "DENY" ? "bg-red-600 text-foreground" : "text-muted-foreground hover:text-foreground")}>
                            Denegados
                        </button>
                    </GrupoFiltro>

                    {/* Direction filter */}
                    <GrupoFiltro rotulo="Sentido" oculto={vista === "seguimiento"}
                        ayuda="Entradas o salidas. Sirve para responder quién está adentro, o para mirar solo el movimiento de una punta.">
                        <button onClick={() => setFilterDirection("ALL")} className={cn("px-3 py-1.5 rounded text-xs font-semibold transition-all", filterDirection === "ALL" ? "bg-blue-600 text-foreground" : "text-muted-foreground hover:text-foreground")}>
                            Todos
                        </button>
                        <button onClick={() => setFilterDirection("ENTRY")} className={cn("px-3 py-1.5 rounded text-xs font-semibold transition-all", filterDirection === "ENTRY" ? "bg-blue-600 text-foreground" : "text-muted-foreground hover:text-foreground")}>
                            Entrada
                        </button>
                        <button onClick={() => setFilterDirection("EXIT")} className={cn("px-3 py-1.5 rounded text-xs font-semibold transition-all", filterDirection === "EXIT" ? "bg-orange-600 text-foreground" : "text-muted-foreground hover:text-foreground")}>
                            Salida
                        </button>
                    </GrupoFiltro>

                    {/* Vehicle color / type filters (client-side, sobre details) */}
                    {vista === "accesos" && (vehFacets.colors.length > 0 || vehFacets.types.length > 0) && (
                        <div className="flex items-center gap-1.5">
                            <select value={filterColor} onChange={(e) => setFilterColor(e.target.value)}
                                className="h-9 bg-muted/40 border border-border/30 rounded-md px-2 text-xs font-semibold text-foreground outline-none focus:ring-1 focus:ring-blue-500/30">
                                <option value="ALL">Color: todos</option>
                                {vehFacets.colors.map((cl) => <option key={cl} value={cl}>{cl}</option>)}
                            </select>
                            <select value={filterVehType} onChange={(e) => setFilterVehType(e.target.value)}
                                className="h-9 bg-muted/40 border border-border/30 rounded-md px-2 text-xs font-semibold text-foreground outline-none focus:ring-1 focus:ring-blue-500/30">
                                <option value="ALL">Tipo: todos</option>
                                {vehFacets.types.map((t) => <option key={t} value={t}>{t}</option>)}
                            </select>
                            {(filterColor !== "ALL" || filterVehType !== "ALL") && (
                                <button onClick={() => { setFilterColor("ALL"); setFilterVehType("ALL"); }} title="Limpiar filtros de vehículo" className="h-9 w-9 rounded-md bg-muted/40 border border-border/30 text-muted-foreground hover:text-foreground flex items-center justify-center"><X size={14} /></button>
                            )}
                        </div>
                    )}

                    {/* Lo que está filtrando ahora, para no tener que deducirlo de la barra */}
                    {/* Merodeo filter */}
                    <button onClick={() => setFilterMerodeo(v => !v)} className={cn("flex items-center gap-1.5 px-3 py-2 rounded-md text-xs font-semibold border transition-all", filterMerodeo ? "bg-red-600 text-foreground border-red-500" : "bg-muted/40 text-muted-foreground border-border/30 hover:text-foreground")}>
                        <ShieldAlert size={14} /> Merodeo{merodeoSet.size > 0 ? ` (${merodeoSet.size})` : ""}
                    </button>
                </div>
            </div>

            {vista === "seguimiento" && <TablaSeguimiento buscar={searchTerm} desde={startDate} hasta={endDate} />}

            {/* Events Table */}
            <div className={cn("bg-card/60 border border-border/50 rounded-lg overflow-hidden", vista === "seguimiento" && "hidden")}>
                <div className="overflow-x-auto">
                    <table className="w-full text-left">
                        <thead className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm">
                            <tr className="border-b border-border/50">
                                <Columna icono={Clock} titulo="Cuándo pasó"
                                    ayuda="Hora y fecha del evento, tal como lo reportó el equipo.">Momento</Columna>
                                <Columna icono={UserIcon} titulo="Quién es"
                                    ayuda="El residente o vehículo reconocido. Si no está registrado aparece la matrícula sola y dice Visitante.">Identidad</Columna>
                                <Columna icono={Fingerprint} titulo="Cómo se identificó"
                                    ayuda="LPR es por matrícula, Facial por rostro y RFID por tarjeta o llavero.">Tipo</Columna>
                                <Columna icono={HardDrive} titulo="Por dónde"
                                    ayuda="El equipo que registró el evento, y si fue entrada o salida.">Terminal</Columna>
                                <Columna icono={CheckCircle2} titulo="Qué decidió el sistema"
                                    ayuda="Autorizado abrió la barrera. Denegado la dejó cerrada: puede ser una matrícula desconocida, un permiso vencido o un horario fuera de rango.">Estado</Columna>
                                <Columna icono={ShieldAlert} titulo="Señales para mirar"
                                    ayuda="Marca lo que merece atención. Merodeo es un vehículo que aparece muchas veces en poco tiempo sin llegar a entrar.">Alertas</Columna>
                                <Columna icono={Clock} titulo="Cuánto se quedó adentro"
                                    ayuda="Solo en las salidas: el tiempo transcurrido desde que ese mismo vehículo entró.">Permanencia</Columna>
                                <Columna icono={Film} alinear="center" titulo="Video del momento"
                                    ayuda="Si la cámara está asociada a un grabador, se puede ver el video del instante del acceso.">Grab.</Columna>
                                <Columna alinear="right" titulo="Ficha completa"
                                    ayuda="Abre el detalle: fotos, datos del vehículo, permisos y por qué se decidió lo que se decidió.">Detalle</Columna>
                            </tr>
                        </thead>
                        <tbody>
                            {displayEvents.length === 0 && loading ? (
                                <>{Array.from({ length: 8 }).map((_, i) => <FilaFantasma key={i} celdas={9} />)}</>
                            ) : displayEvents.length === 0 ? (
                                <tr>
                                    <td colSpan={9} className="py-16 text-center">
                                        <div className="flex flex-col items-center gap-2">
                                            <History className="w-8 h-8 text-muted-foreground/50" />
                                            <p className="text-sm text-muted-foreground">Ningún evento con estos filtros</p>
                                            <p className="text-xs text-muted-foreground/70 max-w-sm mx-auto">
                                                Probá ampliar el rango de fechas, o quitar alguno de los filtros de arriba.
                                            </p>
                                        </div>
                                    </td>
                                </tr>
                            ) : (
                                displayEvents.map((evt, index) => {
                                    const isLast = index === displayEvents.length - 1;
                                    const isAuthorized = evt.decision === "GRANT";
                                    const details: any = {};
                                    if (evt.details) {
                                        evt.details.split(',').forEach((p: string) => {
                                            const [k, v] = p.split(':').map((s: string) => s.trim());
                                            if (k && v) details[k] = v;
                                        });
                                    }
                                    let brandName = details.Marca || "";
                                    if (brandName.startsWith("Brand ")) {
                                        brandName = getVehicleBrandName(brandName.replace("Brand ", ""));
                                    }

                                    return (
                                        <motion.tr
                                            key={evt.id}
                                            ref={isLast ? lastElementRef : null}
                                            initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
                                            transition={{ duration: 0.18, delay: Math.min(index % 20, 14) * 0.015 }}
                                            className="border-b border-border/30 hover:bg-muted/30 transition-colors cursor-pointer group"
                                        >
                                            <td className="px-5 py-3">
                                                <EventDetailsDialog event={evt}>
                                                    <div>
                                                        <p className="text-sm font-medium text-foreground">
                                                            {new Date(evt.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                                                        </p>
                                                        <p className="text-[10px] text-muted-foreground mt-0.5">
                                                            {new Date(evt.timestamp).toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: 'numeric' })}
                                                        </p>
                                                    </div>
                                                </EventDetailsDialog>
                                            </td>
                                            <td className="px-5 py-3">
                                                <EventDetailsDialog event={evt}>
                                                    <div className="flex items-center gap-3">
                                                        <div className="w-9 h-9 rounded-lg bg-muted/80 border border-border/50 flex items-center justify-center overflow-hidden shrink-0 group-hover:border-blue-500/30 transition-colors">
                                                            {(() => {
                                                                const raw = getImageUrl(evt.snapshotPath || evt.imagePath) || (evt.accessType !== 'PLATE' ? getImageUrl(evt.user?.cara) : "");
                                                                const src = raw ? (raw.includes("?") ? `${raw}&w=96` : `${raw}?w=96`) : "";
                                                                if (src) {
                                                                    return <img src={src} alt="Snapshot" width={36} height={36} className="w-full h-full object-cover" />;
                                                                }
                                                                return <Camera size={14} className="text-muted-foreground" />;
                                                            })()}
                                                        </div>
                                                        <div>
                                                            <div className="flex items-center gap-2">
                                                                <p className="text-sm font-semibold text-foreground">
                                                                    {evt.user?.name || (evt.accessType === 'PLATE' ? (evt.plateDetected || "S/M") : "Desconocido")}
                                                                </p>
                                                                {evt.accessType === 'PLATE' && evt.plateDetected && !evt.user?.name && (
                                                                    <span className="bg-white text-black text-[9px] font-bold px-1.5 py-0.5 rounded-sm font-mono border-b-2 border-blue-600">
                                                                        {evt.plateDetected}
                                                                    </span>
                                                                )}
                                                            </div>
                                                            <p className="text-[10px] text-muted-foreground mt-0.5">
                                                                {evt.user?.unit?.name || (brandName ? brandName : "Visitante")}
                                                            </p>
                                                            <VehicleMetaChips details={evt.details} size="sm" className="mt-1" />
                                                        </div>
                                                    </div>
                                                </EventDetailsDialog>
                                            </td>
                                            <td className="px-5 py-3">
                                                <EventDetailsDialog event={evt}>
                                                    <div className="flex items-center gap-2">
                                                        <div className={cn("p-1.5 rounded-md", evt.accessType === 'PLATE' ? "bg-amber-500/10 text-amber-400" : evt.accessType === 'FACE' ? "bg-teal-500/10 text-teal-400" : "bg-blue-500/10 text-blue-400")}>
                                                            {evt.accessType === 'PLATE' ? <Car size={14} /> : evt.accessType === 'FACE' ? <ScanFace size={14} /> : <CreditCard size={14} />}
                                                        </div>
                                                        <span className="text-xs font-medium text-muted-foreground">
                                                            {evt.accessType === 'PLATE' ? 'LPR' : evt.accessType === 'FACE' ? 'Facial' : 'RFID'}
                                                        </span>
                                                    </div>
                                                </EventDetailsDialog>
                                            </td>
                                            <td className="px-5 py-3">
                                                <EventDetailsDialog event={evt}>
                                                    <div>
                                                        <p className="text-xs text-muted-foreground font-medium">{evt.device?.name || "Terminal"}</p>
                                                        <div className={cn("flex items-center gap-1 text-[10px] font-semibold mt-0.5", evt.direction === 'ENTRY' ? "text-emerald-400" : "text-orange-400")}>
                                                            {evt.direction === 'ENTRY' ? <ArrowDownLeft size={10} /> : <ArrowUpRight size={10} />}
                                                            {evt.direction === 'ENTRY' ? 'Entrada' : 'Salida'}
                                                        </div>
                                                    </div>
                                                </EventDetailsDialog>
                                            </td>
                                            <td className="px-5 py-3">
                                                <EventDetailsDialog event={evt}>
                                                    <span className={cn(
                                                        "inline-flex items-center px-2.5 py-1 rounded-md text-[10px] font-bold border",
                                                        isAuthorized
                                                            ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                                                            : "bg-red-500/10 text-red-400 border-red-500/20"
                                                    )}>
                                                        {isAuthorized ? 'Autorizado' : 'Denegado'}
                                                    </span>
                                                </EventDetailsDialog>
                                            </td>
                                            <td className="px-5 py-3">
                                                {merodeoSet.has(cleanPlate(evt.plateDetected)) ? (
                                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-red-500/10 text-red-400 border border-red-500/20"><ShieldAlert size={11} /> Merodeo</span>
                                                ) : <span className="text-xs text-muted-foreground">-</span>}
                                            </td>
                                            <td className="px-5 py-3">
                                                {evt.direction === "EXIT" && (evt as any).stayDuration && (evt as any).previousDirection === "ENTRY" ? (
                                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">{fmtDur((evt as any).stayDuration)}</span>
                                                ) : <span className="text-xs text-muted-foreground">-</span>}
                                            </td>
                                            <td className="px-5 py-3 text-center">
                                                {(mappedSet.has(evt.device?.id) || (evt.device?.name && mappedNameSet.has(evt.device.name)) || (evt.device?.ip && mappedIpSet.has(evt.device.ip))) ? (
                                                    <EventDetailsDialog event={evt} autoRecording>
                                                        <button title="Ver grabación" className="text-blue-400 hover:text-blue-300 p-1.5 rounded-md hover:bg-blue-500/10"><Film size={15} /></button>
                                                    </EventDetailsDialog>
                                                ) : (
                                                    <span title="Sin NVR asociado" className="text-[10px] text-muted-foreground/40">sin NVR</span>
                                                )}
                                            </td>
                                            <td className="px-5 py-3 text-right">
                                                <EventDetailsDialog event={evt}>
                                                    <button className="text-muted-foreground hover:text-blue-400 transition-colors p-1.5 rounded-md hover:bg-blue-500/10">
                                                        <MoreHorizontal size={16} />
                                                    </button>
                                                </EventDetailsDialog>
                                            </td>
                                        </motion.tr>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                </div>

                {/* Footer */}
                <div className="flex items-center justify-between px-5 py-3 border-t border-border/50">
                    <p className="text-xs text-muted-foreground">
                        Mostrando <span className="text-foreground font-semibold">{events.length}</span> de <span className="text-foreground font-semibold">{totalEvents.toLocaleString()}</span> eventos
                    </p>
                    {loading && (
                        <div className="flex items-center gap-2 text-blue-400 text-xs font-semibold">
                            <Loader2 size={14} className="animate-spin" />
                            Cargando...
                        </div>
                    )}
                </div>
            </div>

            <ExportHistoryDialog
                open={isExportDialogOpen}
                onOpenChange={setIsExportDialogOpen}
                filters={{
                    search: searchTerm,
                    decision: filterDecision,
                    type: filterType,
                    direction: filterDirection
                }}
            />
            <ImportHistoryDialog open={isImportOpen} onOpenChange={setIsImportOpen} onDone={() => { setPage(0); loadData(0, true); }} />
        </div>
    );
}
