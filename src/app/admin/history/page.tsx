"use client";

import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { PulsoActividad } from "@/components/history/PulsoActividad";
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
import { History, Search, Filter, Calendar as CalendarIcon, User as UserIcon, HardDrive, ArrowRightCircle, ArrowLeftCircle, Download, Camera, Loader2, Clock, Car, CreditCard, Building2, ArrowUpRight, ArrowDownLeft, Phone, MapPin, CheckCircle2, XCircle, X, MoreHorizontal, TrendingUp, ShieldAlert, Activity, Fingerprint, ScanFace, BadgeAlert, Cpu, Wifi, ChevronDown, RefreshCw, AlertTriangle, Film, Upload, FileJson, Users, Zap, ChevronLeft, ChevronRight, Route, ParkingCircle } from "lucide-react";
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
import { TablaUnificada } from "@/components/history/TablaUnificada";
import { Seek } from "@/components/ui/search";
import { io } from "socket.io-client";
import { useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { getSocketUrl } from "@/lib/socket-config";
import { getImagePath } from "@/lib/image-path";
import { horaSeg } from "@/lib/fechas";

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
    return horaSeg(new Date(date));
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
 * Un grupo de filtros.
 *
 * Tenía su rótulo en una línea aparte arriba —CLASE DE REGISTRO, IDENTIFICACIÓN,
 * RESULTADO, SENTIDO— y cuatro grupos así apilaban dos renglones cada uno, con aire entre
 * medio, dentro de una tarjeta con su propio relleno. El resultado era un bloque más alto
 * que seis filas de la tabla para decir qué se está mirando, arriba de la tabla que hay
 * que mirar.
 *
 * Ahora es un renglón. El rótulo no se pierde: vive en la explicación que aparece al pasar
 * el mouse por el grupo, que además es donde ya estaba lo que de verdad hacía falta saber.
 */
function GrupoFiltro({ rotulo, ayuda, children, oculto }: { rotulo: string; ayuda: string; children: React.ReactNode; oculto?: boolean }) {
    if (oculto) return null;
    return (
        <Pista titulo={rotulo} texto={ayuda} lado="abajo">
            <span className="flex items-center gap-0.5 rounded-lg bg-muted/60 p-0.5 border border-border/50">{children}</span>
        </Pista>
    );
}

/**
 * Un botón de un grupo de filtros.
 *
 * El tono encendido NO es decoración: adelanta lo que se va a ver. "Permitidos" prendido en
 * verde y "Denegados" en rojo dicen qué trae el filtro antes de apretarlo, que es
 * exactamente para lo que existen los cinco tonos del sistema. Lo que no puede pasar es
 * que un botón que no dice nada sobre el estado — "Todo", "Entrada" — se pinte de un color
 * cualquiera: ese va con el único azul de acción.
 *
 * Los cuatro colores estaban escritos como `bg-blue-600`, `bg-emerald-600`, `bg-rose-600` y
 * `bg-orange-600`. Los mismos significados aparecían en otras pantallas como emerald-500,
 * red-500 y violet-600, y ninguna de esas diferencias quería decir nada.
 */
function Opcion({ activo, onClick, tono = "accion", children }: {
    activo: boolean; onClick: () => void; tono?: "accion" | "bien" | "mal" | "salida"; children: React.ReactNode;
}) {
    const encendido = {
        accion: "accion",
        bien: "pleno-bien",
        mal: "pleno-mal",
        salida: "pleno-aviso",
    }[tono];
    return (
        <button onClick={onClick}
            className={cn("h-7 px-2.5 rounded-md text-[11.5px] font-semibold whitespace-nowrap transition-colors",
                activo ? encendido : "text-muted-foreground hover:text-foreground hover:bg-accent")}>
            {children}
        </button>
    );
}

/** Lo que está filtrando ahora, y cómo sacarlo de encima. */
function ChipFiltro({ children, onQuitar }: { children: React.ReactNode; onQuitar: () => void }) {
    return (
        <motion.span
            initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }}
            transition={{ duration: 0.15 }}
            className="chip-info inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-full border text-[11px] font-semibold">
            {children}
            <button onClick={onQuitar} className="w-4 h-4 rounded-full hover:bg-[var(--info-suave)] flex items-center justify-center opacity-70 hover:opacity-100">
                <X size={10} />
            </button>
        </motion.span>
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
    /**
     * Qué clases de registro se muestran. Vacío es todas.
     *
     * Antes había dos pestañas, Accesos y Seguimiento, y eso obligaba a buscar la misma
     * matrícula dos veces en dos pantallas para reconstruir un solo recorrido. La
     * diferencia entre un acceso y un avistamiento sigue importando — y por eso cada fila
     * dice de qué clase es — pero es una propiedad de la fila, no un lugar aparte.
     */
    const [tipos, setTipos] = useState<string[]>([]);
    const [chapasMerodeo, setChapasMerodeo] = useState<Set<string>>(new Set());

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
    /**
     * Los contadores y los selectores de color y tipo salen de LO QUE HAY EN LA TABLA.
     *
     * Antes salían de `events`, que es la consulta vieja: los selectores ofrecían colores
     * que no estaban en pantalla y los contadores hablaban de otro conjunto de registros
     * que el que se estaba mirando. Dos datos correctos sobre cosas distintas, presentados
     * como si fueran del mismo.
     */
    const [resumen, setResumen] = useState<{ grant: number; deny: number; colores: string[]; tipos: string[] }>(
        { grant: 0, deny: 0, colores: [], tipos: [] },
    );
    const grantCount = resumen.grant;
    const denyCount = resumen.deny;
    const vehFacets = useMemo(() => ({ colors: resumen.colores, types: resumen.tipos }), [resumen]);

    /**
     * Cuando se eligió mirar sólo avistamientos o estacionados, los filtros de acceso no
     * aplican: una lectura interior no decide nada, así que no hay permitido ni denegado
     * ni sentido. La condición estaba escrita cuatro veces igual.
     */
    const soloSeguimiento = tipos.length > 0 && !tipos.includes("ACCESO");

    /** Los filtros activos, en palabras, cada uno con su forma de sacarlo. */
    const filtrosPuestos = useMemo(() => {
        const l: { id: string; texto: string; quitar: () => void }[] = [];
        if (searchTerm.trim()) l.push({ id: "q", texto: `«${searchTerm.trim()}»`, quitar: () => setSearchTerm("") });
        if (startDate) l.push({ id: "d1", texto: `desde ${startDate}`, quitar: () => setStartDate("") });
        if (endDate) l.push({ id: "d2", texto: `hasta ${endDate}`, quitar: () => setEndDate("") });
        // Las clases elegidas también son un filtro puesto: si no se ven acá, la barra
        // miente sobre por qué la tabla muestra lo que muestra.
        for (const t of tipos) {
            const nombre: Record<string, string> = { ACCESO: "accesos", PASO: "avistamientos", ESTACIONADO: "estacionados" };
            l.push({ id: "cl_" + t, texto: nombre[t] || t, quitar: () => setTipos((p) => p.filter((x) => x !== t)) });
        }
        if (!soloSeguimiento) {
            const ident: Record<string, string> = { PLATE: "matrícula", FACE: "rostro", TAG: "RFID" };
            if (filterType !== "ALL" && ident[filterType]) l.push({ id: "t", texto: ident[filterType], quitar: () => setFilterType("ALL") });
            if (filterDecision !== "ALL") l.push({ id: "dec", texto: filterDecision === "GRANT" ? "permitidos" : "denegados", quitar: () => setFilterDecision("ALL") });
            if (filterDirection !== "ALL") l.push({ id: "dir", texto: filterDirection === "ENTRY" ? "entradas" : "salidas", quitar: () => setFilterDirection("ALL") });
            if (filterColor !== "ALL") l.push({ id: "col", texto: `color ${filterColor}`, quitar: () => setFilterColor("ALL") });
            if (filterVehType !== "ALL") l.push({ id: "veh", texto: filterVehType, quitar: () => setFilterVehType("ALL") });
            if (filterMerodeo) l.push({ id: "mer", texto: "merodeo", quitar: () => setFilterMerodeo(false) });
        }
        return l;
    }, [searchTerm, startDate, endDate, tipos, soloSeguimiento, filterType, filterDecision, filterDirection, filterColor, filterVehType, filterMerodeo]);

    const limpiarFiltros = useCallback(() => {
        setSearchTerm(""); setStartDate(""); setEndDate("");
        setFilterType("ALL"); setFilterDecision("ALL"); setFilterDirection("ALL");
        setFilterColor("ALL"); setFilterVehType("ALL"); setFilterMerodeo(false); setTipos([]);
    }, []);
    /*
     * Acá se calculaba `displayEvents`, que filtraba por color y tipo de vehículo y
     * **no lo leía nadie**: el arreglo que filtraba dejó de alimentar la tabla cuando se
     * unificó el historial. El resultado eran dos selectores en pantalla, con su chip de
     * "quitar filtro" y todo, que no filtraban nada. Ahora los dos viajan a la tabla, que
     * es la que tiene las filas, y filtran de verdad.
     */

    return (
        <div className="p-6 lg:p-8 space-y-6 max-w-[1600px] mx-auto">
            {/*
                Encabezado: una sola barra.
                =========================

                Antes eran tres bloques sueltos apilados —título, un mapa de actividad que
                ocupaba un rectángulo grande para decir "0 contributions", y una fila de
                botones de cuatro estilos distintos— que juntos se comían un tercio de la
                pantalla antes de mostrar un solo registro.

                Ahora es una sola superficie con dos zonas: qué es esta pantalla a la
                izquierda, con qué se la opera a la derecha. Los controles van en un riel
                único, separados por hairlines en vez de por aire, para que se lean como un
                instrumento y no como botones que quedaron ahí.
            */}
            <div className="rounded-xl border border-border/50 bg-card/60 px-4 py-3">
                <div className="flex items-center justify-between gap-4 flex-wrap">

                    <div className="flex items-center gap-3 min-w-0">
                        <div className="p-2 rounded-lg bg-blue-500/10 border border-blue-500/30 shrink-0">
                            <History className="w-[18px] h-[18px] text-blue-400" />
                        </div>
                        <div className="min-w-0">
                            <h1 className="text-[17px] font-bold text-foreground leading-tight whitespace-nowrap">Historial</h1>
                            <p className="text-[11.5px] text-muted-foreground leading-tight whitespace-nowrap">
                                Accesos y seguimiento en un solo registro
                            </p>
                        </div>

                        <span className="hidden xl:block w-px h-8 bg-border/60 mx-1" />
                        <div className="hidden xl:block"><PulsoActividad dias={60} /></div>
                    </div>

                    {/* El riel de controles: un solo objeto, no cinco */}
                    <div className="flex items-center rounded-lg border border-border/50 bg-muted/40 overflow-hidden shrink-0">

                        <div className="flex items-center gap-1.5 px-2.5 h-9">
                            <CalendarIcon className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)}
                                aria-label="Desde"
                                className="bg-transparent border-none text-[11.5px] text-muted-foreground focus:outline-none focus:text-foreground w-[96px]" />
                            <span className="text-muted-foreground/40 text-[11px]">—</span>
                            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)}
                                aria-label="Hasta"
                                className="bg-transparent border-none text-[11.5px] text-muted-foreground focus:outline-none focus:text-foreground w-[96px]" />
                        </div>

                        <span className="w-px h-9 bg-border/50" />

                        {/* Exportar conserva su rótulo: es la acción que la gente viene a
                            buscar. Las otras dos son de mantenimiento y van con ícono. */}
                        <Pista titulo="Exportar" texto="Descarga los registros filtrados en planilla, para compartir o archivar.">
                            <button onClick={() => setIsExportDialogOpen(true)}
                                className="flex items-center gap-1.5 h-9 px-3 text-[12px] font-bold text-blue-300 hover:text-white hover:bg-blue-600/80 transition-colors">
                                <Download className="w-3.5 h-3.5" /> Exportar
                            </button>
                        </Pista>

                        <Pista titulo="Exportar en JSON" texto="El mismo registro en un archivo reimportable en otra instalación de OmniAccess.">
                            <button onClick={exportJson}
                                className="flex items-center justify-center w-9 h-9 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
                                <FileJson className="w-4 h-4" />
                            </button>
                        </Pista>

                        <Pista titulo="Importar" texto="Trae registros exportados desde otra instalación.">
                            <button onClick={() => setIsImportOpen(true)}
                                className="flex items-center justify-center w-9 h-9 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
                                <Upload className="w-4 h-4" />
                            </button>
                        </Pista>

                        <span className="w-px h-9 bg-border/50" />

                        <Pista titulo="Última actualización"
                            texto="El registro se refresca solo. El botón fuerza una consulta ahora, por si estás esperando un evento puntual.">
                            <button onClick={() => { setPage(0); loadData(0, true); }}
                                className="flex items-center gap-1.5 h-9 px-2.5 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse shrink-0" />
                                <span className="text-[11px] tabular-nums" suppressHydrationWarning>
                                    {lastUpdate ? formatTime(lastUpdate) : "--:--:--"}
                                </span>
                                <RefreshCw className="w-3 h-3 ml-0.5" />
                            </button>
                        </Pista>
                    </div>
                </div>
            </div>

            {/*
                LOS CONTROLES DE LA TABLA
                =========================

                Estaban en una tarjeta aparte de 170 píxeles de alto, con más de la mitad
                vacía, flotando entre el encabezado y la tabla. Y adentro había tres piezas
                que se calculaban y no se dibujaban nunca: la lista de filtros puestos, su
                botón de quitar y el de limpiar todo. Tres controles diseñados, escritos,
                mantenidos — e invisibles.

                Ahora es un renglón, pegado al borde de arriba de la tabla, adentro de su
                mismo marco: son SUS controles, no una tarjeta que casualmente está cerca.
                Y debajo, sólo cuando hay algo puesto, la línea que dice qué se está
                filtrando — que es la que contesta "¿por qué no aparece lo que busco?".
            */}
            <TablaUnificada
                barra={
                    <div>
                        <div className="flex items-center gap-2 px-2.5 py-2 overflow-x-auto omni-sin-barra">
                            {/* El buscador, uno solo y del mismo estilo en toda la aplicación.
                                Arranca abierto: acá no es una pieza suelta en una tarjeta sino
                                el filtro de una tabla, y un guardia que viene a buscar una
                                matrícula tiene que poder escribirla sin abrir nada primero. */}
                            <div className="shrink-0">
                                {/* Chico: en la barra de una tabla es UN control al lado de
                                    chips de 28 y botones de 32. A su alto original de 64 con
                                    96 de marco, el buscador dejaba de ser un control y pasaba
                                    a ser el renglon entero. */}
                                <Seek value={searchTerm} onChange={setSearchTerm}
                                    placeholder="Matrícula, nombre o cámara" startOpen width={260} alto={34} />
                            </div>

                            <span className="w-px h-6 bg-border shrink-0 mx-0.5" />

                            <GrupoFiltro rotulo="Clase de registro"
                                ayuda="Entradas y salidas las decide una cámara LPR y abren la barrera. Un avistamiento lo hace una cámara interior y sólo deja constancia. Estacionado es un vehículo quieto dentro del encuadre. Sin nada elegido se ven todos juntos.">
                                {[
                                    { v: "", l: "Todo" },
                                    { v: "ACCESO", l: "Accesos" },
                                    { v: "PASO", l: "Avistamientos" },
                                    { v: "ESTACIONADO", l: "Estacionados" },
                                ].map((t) => (
                                    <Opcion key={t.l}
                                        activo={t.v === "" ? tipos.length === 0 : tipos.includes(t.v)}
                                        onClick={() => {
                                            if (t.v === "") { setTipos([]); return; }
                                            setTipos((p) => p.includes(t.v) ? p.filter((x) => x !== t.v) : [...p, t.v]);
                                        }}>
                                        {t.l}
                                    </Opcion>
                                ))}
                            </GrupoFiltro>

                            <GrupoFiltro rotulo="Identificación" oculto={soloSeguimiento}
                                ayuda="Con qué se identificó: la matrícula (LPR), el rostro, o una tarjeta o llavero (RFID).">
                                {activeMode === null && <Opcion activo={filterType === "ALL"} onClick={() => setFilterType("ALL")}>Todos</Opcion>}
                                {(activeMode === null || activeMode === "LPR") && <Opcion activo={filterType === "PLATE"} onClick={() => setFilterType("PLATE")}>LPR</Opcion>}
                                {(activeMode === null || activeMode === "FACE") && <Opcion activo={filterType === "FACE"} onClick={() => setFilterType("FACE")}>Rostros</Opcion>}
                                {activeMode !== "QUEUE" && <Opcion activo={filterType === "TAG"} onClick={() => setFilterType("TAG")}>RFID</Opcion>}
                            </GrupoFiltro>

                            <GrupoFiltro rotulo="Resultado" oculto={soloSeguimiento}
                                ayuda="Si el sistema abrió o no. Los denegados son los que conviene revisar: matrícula desconocida, permiso vencido u horario fuera de rango.">
                                <Opcion activo={filterDecision === "ALL"} onClick={() => setFilterDecision("ALL")}>Todos</Opcion>
                                <Opcion activo={filterDecision === "GRANT"} tono="bien" onClick={() => setFilterDecision("GRANT")}>Permitidos</Opcion>
                                <Opcion activo={filterDecision === "DENY"} tono="mal" onClick={() => setFilterDecision("DENY")}>Denegados</Opcion>
                            </GrupoFiltro>

                            <GrupoFiltro rotulo="Sentido" oculto={soloSeguimiento}
                                ayuda="Entradas o salidas. Sirve para responder quién está adentro, o para mirar solo el movimiento de una punta.">
                                <Opcion activo={filterDirection === "ALL"} onClick={() => setFilterDirection("ALL")}>Todos</Opcion>
                                <Opcion activo={filterDirection === "ENTRY"} onClick={() => setFilterDirection("ENTRY")}>Entrada</Opcion>
                                <Opcion activo={filterDirection === "EXIT"} tono="salida" onClick={() => setFilterDirection("EXIT")}>Salida</Opcion>
                            </GrupoFiltro>

                            {/* Color y tipo aparecen sólo si hay de dónde elegir: un selector
                                con una sola opción es un control que no decide nada. */}
                            {!soloSeguimiento && (vehFacets.colors.length > 0 || vehFacets.types.length > 0) && (
                                <>
                                    <span className="w-px h-6 bg-border shrink-0 mx-0.5" />
                                    {vehFacets.colors.length > 0 && (
                                        <select value={filterColor} onChange={(e) => setFilterColor(e.target.value)}
                                            className="h-8 shrink-0 bg-muted/60 border border-border/50 rounded-lg px-2 text-[11.5px] font-semibold text-foreground outline-none focus:ring-1 focus:ring-blue-500/30">
                                            <option value="ALL">Color: todos</option>
                                            {vehFacets.colors.map((cl) => <option key={cl} value={cl}>{cl}</option>)}
                                        </select>
                                    )}
                                    {vehFacets.types.length > 0 && (
                                        <select value={filterVehType} onChange={(e) => setFilterVehType(e.target.value)}
                                            className="h-8 shrink-0 bg-muted/60 border border-border/50 rounded-lg px-2 text-[11.5px] font-semibold text-foreground outline-none focus:ring-1 focus:ring-blue-500/30">
                                            <option value="ALL">Tipo: todos</option>
                                            {vehFacets.types.map((t) => <option key={t} value={t}>{t}</option>)}
                                        </select>
                                    )}
                                </>
                            )}

                            <button onClick={() => setFilterMerodeo(v => !v)}
                                title="Matrículas que aparecen muchas veces en poco tiempo sin llegar a entrar"
                                className={cn("ml-auto shrink-0 flex items-center gap-1.5 h-8 px-2.5 rounded-lg text-[11.5px] font-semibold border transition-colors",
                                    filterMerodeo ? "pleno-mal border-transparent" : "bg-muted/60 text-muted-foreground border-border/50 hover:text-foreground")}>
                                <ShieldAlert size={13} /> Merodeo{chapasMerodeo.size > 0 ? ` (${chapasMerodeo.size})` : ""}
                            </button>
                        </div>

                        {/* Qué se está filtrando. Aparece sólo cuando hay algo puesto, así
                            que no reserva alto: un renglón vacío permanente es lo que hacía
                            que el bloque anterior pareciera roto. */}
                        <AnimatePresence initial={false}>
                            {filtrosPuestos.length > 0 && (
                                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                                    transition={{ duration: 0.18 }} className="overflow-hidden border-t border-border/60">
                                    <div className="flex items-center gap-1.5 flex-wrap px-2.5 py-1.5">
                                        <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/60 mr-0.5">Filtrando</span>
                                        <AnimatePresence initial={false}>
                                            {filtrosPuestos.map((f) => (
                                                <ChipFiltro key={f.id} onQuitar={f.quitar}>{f.texto}</ChipFiltro>
                                            ))}
                                        </AnimatePresence>
                                        <button onClick={limpiarFiltros}
                                            className="ml-1 text-[11px] font-semibold text-muted-foreground hover:text-foreground underline underline-offset-2 decoration-dotted">
                                            limpiar todo
                                        </button>
                                    </div>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>
                }
                buscar={searchTerm}
                desde={startDate}
                hasta={endDate}
                tipos={tipos}
                merodeo={filterMerodeo ? chapasMerodeo : undefined}
                color={filterColor}
                tipoVeh={filterVehType}
                onMerodeo={setChapasMerodeo}
                onResumen={setResumen}
            />

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
