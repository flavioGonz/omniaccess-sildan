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
import {
    History,
    Search,
    Filter,
    Calendar as CalendarIcon,
    User as UserIcon,
    HardDrive,
    ArrowRightCircle,
    ArrowLeftCircle,
    Download,
    Camera,
    Loader2,
    Clock,
    Car,
    CreditCard,
    Building2,
    ArrowUpRight,
    ArrowDownLeft,
    Phone,
    MapPin,
    CheckCircle2,
    XCircle,
    X,
    MoreHorizontal,
    TrendingUp,
    ShieldAlert,
    Activity,
    Fingerprint,
    ScanFace,
    BadgeAlert,
    Cpu,
    Wifi,
    ChevronDown,
    RefreshCw,
    AlertTriangle,
    Film,
    Upload,
    FileJson,
    Users,
    Zap,
} from "lucide-react";
import { AccessEvent, User, Device } from "@prisma/client";
import Image from "next/image";
import { EventDetailsDialog } from "@/components/dashboard/EventDetailsDialog";
import { cn } from "@/lib/utils";
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
        const socket = io(socketUrl, { transports: ["polling"] });

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

                    {/* Type filter tabs */}
                    <div className="flex items-center gap-1 bg-muted/40 rounded-md p-1 border border-border/30">
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
                    </div>

                    {/* Decision filter */}
                    <div className="flex items-center gap-1 bg-muted/40 rounded-md p-1 border border-border/30">
                        <button onClick={() => setFilterDecision("ALL")} className={cn("px-3 py-1.5 rounded text-xs font-semibold transition-all", filterDecision === "ALL" ? "bg-blue-600 text-foreground" : "text-muted-foreground hover:text-foreground")}>
                            Todos
                        </button>
                        <button onClick={() => setFilterDecision("GRANT")} className={cn("px-3 py-1.5 rounded text-xs font-semibold transition-all", filterDecision === "GRANT" ? "bg-emerald-600 text-foreground" : "text-muted-foreground hover:text-foreground")}>
                            Permitidos
                        </button>
                        <button onClick={() => setFilterDecision("DENY")} className={cn("px-3 py-1.5 rounded text-xs font-semibold transition-all", filterDecision === "DENY" ? "bg-red-600 text-foreground" : "text-muted-foreground hover:text-foreground")}>
                            Denegados
                        </button>
                    </div>

                    {/* Direction filter */}
                    <div className="flex items-center gap-1 bg-muted/40 rounded-md p-1 border border-border/30">
                        <button onClick={() => setFilterDirection("ALL")} className={cn("px-3 py-1.5 rounded text-xs font-semibold transition-all", filterDirection === "ALL" ? "bg-blue-600 text-foreground" : "text-muted-foreground hover:text-foreground")}>
                            Todos
                        </button>
                        <button onClick={() => setFilterDirection("ENTRY")} className={cn("px-3 py-1.5 rounded text-xs font-semibold transition-all", filterDirection === "ENTRY" ? "bg-blue-600 text-foreground" : "text-muted-foreground hover:text-foreground")}>
                            Entrada
                        </button>
                        <button onClick={() => setFilterDirection("EXIT")} className={cn("px-3 py-1.5 rounded text-xs font-semibold transition-all", filterDirection === "EXIT" ? "bg-orange-600 text-foreground" : "text-muted-foreground hover:text-foreground")}>
                            Salida
                        </button>
                    </div>

                    {/* Vehicle color / type filters (client-side, sobre details) */}
                    {(vehFacets.colors.length > 0 || vehFacets.types.length > 0) && (
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

                    {/* Merodeo filter */}
                    <button onClick={() => setFilterMerodeo(v => !v)} className={cn("flex items-center gap-1.5 px-3 py-2 rounded-md text-xs font-semibold border transition-all", filterMerodeo ? "bg-red-600 text-foreground border-red-500" : "bg-muted/40 text-muted-foreground border-border/30 hover:text-foreground")}>
                        <ShieldAlert size={14} /> Merodeo{merodeoSet.size > 0 ? ` (${merodeoSet.size})` : ""}
                    </button>
                </div>
            </div>

            {/* Events Table */}
            <div className="bg-card/60 border border-border/50 rounded-lg overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-left">
                        <thead className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm">
                            <tr className="border-b border-border/50">
                                <th className="px-5 py-3 text-[11px] text-muted-foreground uppercase tracking-wide font-semibold">Timestamp</th>
                                <th className="px-5 py-3 text-[11px] text-muted-foreground uppercase tracking-wide font-semibold">Identidad</th>
                                <th className="px-5 py-3 text-[11px] text-muted-foreground uppercase tracking-wide font-semibold">Tipo</th>
                                <th className="px-5 py-3 text-[11px] text-muted-foreground uppercase tracking-wide font-semibold">Terminal</th>
                                <th className="px-5 py-3 text-[11px] text-muted-foreground uppercase tracking-wide font-semibold">Estado</th>
                                <th className="px-5 py-3 text-[11px] text-muted-foreground uppercase tracking-wide font-semibold">Alertas</th>
                                <th className="px-5 py-3 text-[11px] text-muted-foreground uppercase tracking-wide font-semibold">Permanencia</th>
                                <th className="px-5 py-3 text-[11px] text-muted-foreground uppercase tracking-wide font-semibold text-center">Grab.</th>
                                <th className="px-5 py-3 text-[11px] text-muted-foreground uppercase tracking-wide font-semibold text-right">Detalle</th>
                            </tr>
                        </thead>
                        <tbody>
                            {displayEvents.length === 0 && !loading ? (
                                <tr>
                                    <td colSpan={9} className="py-16 text-center">
                                        <div className="flex flex-col items-center gap-3">
                                            <History className="w-8 h-8 text-muted-foreground" />
                                            <p className="text-sm text-muted-foreground">Sin registros</p>
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
                                        <tr
                                            key={evt.id}
                                            ref={isLast ? lastElementRef : null}
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
                                        </tr>
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
