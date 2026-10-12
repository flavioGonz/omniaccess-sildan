"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getAccessEvents } from "@/app/actions/history";
import { getEnabledModules } from "@/app/actions/modules";
import { logosPorMatricula } from "@/app/actions/empresas";
import {
    History, Search, Camera, Loader2, Car, CreditCard, ArrowUpRight, ArrowDownLeft, CheckCircle2, XCircle, X,
    MoreHorizontal, ShieldAlert, ScanFace, ChevronDown, RefreshCw, Film, Upload, FileJson, Download,
    List, LayoutGrid, LayoutDashboard, SlidersHorizontal, Palette, Check,
} from "lucide-react";
import { Tooltip as ReactTooltip } from "react-tooltip";
import { EventDetailsDialog } from "@/components/dashboard/EventDetailsDialog";
import { MinInteriorButton } from "@/components/MinInteriorButton";
import { PlateManualButton } from "@/components/PlateManualButton";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { getVehicleBrandName } from "@/lib/hikvision-codes";
import { VehicleMetaChips } from "@/components/VehicleMeta";
import { parseVehicleMeta, collectVehicleFacets } from "@/lib/vehicle-details";
import { ExportHistoryDialog } from "@/components/history/ExportHistoryDialog";
import { ImportHistoryDialog } from "@/components/history/ImportHistoryDialog";
import { RangoFechaHora, RANGO_VACIO, type Rango } from "@/components/history/RangoFechaHora";
import { LogoSobreFoto } from "@/components/empresas/LogoSobreFoto";
import { io } from "socket.io-client";
import { useSearchParams } from "next/navigation";
import { getImagePath } from "@/lib/image-path";

/**
 * Historial de accesos. Tres vistas sobre los mismos datos: lista (tabla), grilla (capturas
 * iguales) y bento (mosaico denso, más capturas por pantalla; las denegadas y el merodeo van
 * grandes). Rendimiento: UNA sola ficha montada para todo el historial (antes había seis por
 * fila), filas memorizadas, miniaturas al ancho justo con carga diferida, el total se cuenta
 * sólo en la primera página y el servidor sólo mira 7 días hacia atrás para la permanencia.
 */
type Vista = "lista" | "grilla" | "bento";
type Ev = any;
const TT = "tt-hist";
const CLAVE_VISTA = "historial.vista";
const cleanPlate = (p: any) => String(p || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const esNoLeida = (p: any) => !p || ["NO_LEIDA", "UNKNOWN", "S/P"].includes(String(p).toUpperCase());
const conAncho = (raw: string, w: number) => (raw ? (raw.includes("?") ? `${raw}&w=${w}` : `${raw}?w=${w}`) : "");
const fotoDe = (e: Ev) => getImagePath(e.snapshotPath || e.imagePath) || (e.accessType !== "PLATE" ? getImagePath(e.user?.cara) || "" : "");
const hora = (t: any) => new Date(t).toLocaleTimeString("es-UY", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
const fecha = (t: any) => new Date(t).toLocaleDateString("es-UY", { day: "2-digit", month: "short", year: "numeric" });
function fmtDur(ms: number): string {
    const sec = Math.floor(ms / 1000); const h = Math.floor(sec / 3600); const m = Math.floor((sec % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m` : `${sec}s`;
}
const PAGINA: Record<Vista, number> = { lista: 50, grilla: 60, bento: 90 };

export default function HistoryPage() {
    const [events, setEvents] = useState<Ev[]>([]);
    const [totalEvents, setTotalEvents] = useState(0);
    const [loading, setLoading] = useState(false);
    const [searchTerm, setSearchTerm] = useState("");
    const _urlSearch = useSearchParams();
    useEffect(() => { const _q = _urlSearch.get("search"); if (_q) setSearchTerm(_q); /* eslint-disable-next-line */ }, []);
    const [vista, setVista] = useState<Vista>("lista");
    useEffect(() => { try { const v = localStorage.getItem(CLAVE_VISTA) as Vista | null; if (v && v in PAGINA) setVista(v); } catch { } }, []);
    const cambiarVista = (v: Vista) => { setVista(v); try { localStorage.setItem(CLAVE_VISTA, v); } catch { } };

    const [filterDecision, setFilterDecision] = useState<"ALL" | "GRANT" | "DENY">("ALL");
    const [filterType, setFilterType] = useState<"ALL" | "PLATE" | "FACE" | "TAG">("ALL");
    const [activeMode, setActiveMode] = useState<"LPR" | "FACE" | "QUEUE" | null>(null);
    const [filterDirection, setFilterDirection] = useState<"ALL" | "ENTRY" | "EXIT">("ALL");
    const [filterColor, setFilterColor] = useState<string>("ALL");
    const [filterVehType, setFilterVehType] = useState<string>("ALL");
    const [rango, setRango] = useState<Rango>(RANGO_VACIO);
    const fromDT = (r = rango) => (r.desde ? new Date(`${r.desde}T${r.horaDesde || "00:00"}:00`) : undefined);
    const toDT = (r = rango) => (r.hasta ? new Date(`${r.hasta}T${r.horaHasta || "23:59"}:59`) : undefined);
    const [isExportDialogOpen, setIsExportDialogOpen] = useState(false);
    const [isImportOpen, setIsImportOpen] = useState(false);
    const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
    const [merodeoSet, setMerodeoSet] = useState<Set<string>>(new Set());
    const [mapped, setMapped] = useState<{ ids: Set<string>; names: Set<string>; ips: Set<string> }>({ ids: new Set(), names: new Set(), ips: new Set() });
    const [filterMerodeo, setFilterMerodeo] = useState(false);
    const [selectedCams, setSelectedCams] = useState<Set<string>>(new Set());
    const [logos, setLogos] = useState<Record<string, any>>({});
    /** La ficha: una sola instancia para todo el historial. */
    const [ficha, setFicha] = useState<{ evt: Ev; auto: boolean; n: number } | null>(null);
    const abrir = useCallback((evt: Ev, auto = false) => setFicha((f) => ({ evt, auto, n: (f?.n || 0) + 1 })), []);
    const buscarRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        getEnabledModules().then((modules) => {
            if (modules.MODULE_QUEUE) { setActiveMode("QUEUE"); setFilterType("ALL"); }
            else if (modules.MODULE_FACE && !modules.MODULE_LPR) { setActiveMode("FACE"); setFilterType("FACE"); }
            else if (modules.MODULE_LPR && !modules.MODULE_FACE) { setActiveMode("LPR"); setFilterType("PLATE"); }
            else setActiveMode(null);
        });
        logosPorMatricula().then(setLogos).catch(() => { });
    }, []);

    useEffect(() => {
        const load = () => { fetch("/api/history/merodeo").then((r) => r.json()).then((d) => setMerodeoSet(new Set((d.plates || []).map((p: string) => cleanPlate(p))))).catch(() => { }); };
        load();
        const iv = setInterval(load, 60000);
        const loadMapped = () => fetch("/api/nvr/mapped-devices").then((r) => r.json()).then((d) => setMapped({ ids: new Set(d.deviceIds || []), names: new Set(d.deviceNames || []), ips: new Set(d.deviceIps || []) })).catch(() => { });
        loadMapped();
        const iv2 = setInterval(loadMapped, 60000);
        return () => { clearInterval(iv); clearInterval(iv2); };
    }, []);

    // "/" enfoca el buscador; Esc lo limpia.
    useEffect(() => {
        const k = (e: KeyboardEvent) => {
            const t = e.target as HTMLElement;
            if (e.key === "/" && !["INPUT", "TEXTAREA"].includes(t.tagName) && !t.isContentEditable) { e.preventDefault(); buscarRef.current?.focus(); }
        };
        window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k);
    }, []);

    const exportJson = async () => {
        try {
            const resp: any = await getAccessEvents({ take: 100000, skip: 0, search: searchTerm, decision: filterDecision, type: filterType, direction: filterDirection, from: fromDT(), to: toDT(), omitEnrichment: true });
            const evs = (resp.events || []).map((e: any) => ({ id: e.id, timestamp: e.timestamp, createdAt: e.createdAt, accessType: e.accessType, credentialId: e.credentialId, decision: e.decision, direction: e.direction, plateDetected: e.plateDetected, plateNumber: e.plateNumber, location: e.location, snapshotPath: e.snapshotPath, imagePath: e.imagePath, details: e.details, deviceName: e.device?.name || null }));
            const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), count: evs.length, events: evs }, null, 2)], { type: "application/json" });
            const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `omniaccess-historial-${new Date().toISOString().slice(0, 10)}.json`; a.click(); URL.revokeObjectURL(url);
        } catch (e) { console.error(e); }
    };

    // ── Carga paginada ─────────────────────────────────────────────
    const [hasMore, setHasMore] = useState(true);
    const paginaRef = useRef(0);
    const cargandoRef = useRef(false);
    const pedidoRef = useRef(0);
    const filtros = { searchTerm, filterDecision, filterType, filterDirection, rango };
    const filtrosRef = useRef(filtros);
    filtrosRef.current = filtros;
    const tam = PAGINA[vista];

    const loadData = useCallback(async (reset: boolean) => {
        if (cargandoRef.current && !reset) return;
        const f = filtrosRef.current;
        const pagina = reset ? 0 : paginaRef.current + 1;
        const yo = ++pedidoRef.current;
        cargandoRef.current = true; setLoading(true);
        try {
            const { events: nuevos, total }: any = await getAccessEvents({
                take: tam, skip: reset ? 0 : events.length, search: f.searchTerm, decision: f.filterDecision, type: f.filterType, direction: f.filterDirection,
                from: f.rango.desde ? new Date(`${f.rango.desde}T${f.rango.horaDesde || "00:00"}:00`) : undefined,
                to: f.rango.hasta ? new Date(`${f.rango.hasta}T${f.rango.horaHasta || "23:59"}:59`) : undefined,
                conTotal: reset,
            });
            if (yo !== pedidoRef.current) return; // llegó tarde: hubo otro pedido después
            paginaRef.current = pagina;
            if (total >= 0) setTotalEvents(total);
            setLastUpdate(new Date());
            setEvents((prev) => {
                if (reset) return nuevos;
                const ya = new Set(prev.map((e) => e.id));
                return [...prev, ...nuevos.filter((e: any) => !ya.has(e.id))];
            });
            setHasMore(nuevos.length >= tam);
        } catch (e) { console.error(e); }
        finally { if (yo === pedidoRef.current) { cargandoRef.current = false; setLoading(false); } }
    }, [tam, events.length]);

    useEffect(() => {
        const t = setTimeout(() => loadData(true), 350);
        return () => clearTimeout(t);
    }, [searchTerm, filterDecision, filterType, filterDirection, rango, vista]); // eslint-disable-line react-hooks/exhaustive-deps

    // Scroll infinito con un centinela al final (no un observer por fila).
    const centinela = useRef<HTMLDivElement>(null);
    const loadRef = useRef(loadData); loadRef.current = loadData;
    useEffect(() => {
        const el = centinela.current; if (!el) return;
        const ob = new IntersectionObserver((xs) => { if (xs[0].isIntersecting && !cargandoRef.current) loadRef.current(false); }, { rootMargin: "800px 0px" });
        ob.observe(el); return () => ob.disconnect();
    }, [hasMore, vista]);

    // Tiempo real
    useEffect(() => {
        const socket = io(window.location.origin, { path: "/io/socket.io", transports: ["polling"], upgrade: false, reconnection: true, reconnectionAttempts: Infinity, reconnectionDelay: 1000, reconnectionDelayMax: 8000 });
        socket.on("access_event", (event: Ev) => {
            const { searchTerm: q, filterDecision: fd, filterType: ft, filterDirection: fdir, rango: r } = filtrosRef.current;
            const s = q.toLowerCase();
            const ok = (!q || event.plateDetected?.toLowerCase().includes(s) || event.user?.name?.toLowerCase().includes(s) || event.device?.name?.toLowerCase().includes(s))
                && (fd === "ALL" || event.decision === fd) && (ft === "ALL" || event.accessType === ft) && (fdir === "ALL" || event.direction === fdir);
            const ts = new Date(event.timestamp);
            const desde = r.desde ? new Date(`${r.desde}T${r.horaDesde || "00:00"}:00`) : null;
            const hasta = r.hasta ? new Date(`${r.hasta}T${r.horaHasta || "23:59"}:59`) : null;
            if (ok && (!desde || ts >= desde) && (!hasta || ts <= hasta)) {
                setEvents((prev) => (prev.some((e) => e.id === event.id) ? prev : [event, ...prev]));
                setTotalEvents((n) => n + 1);
                setLastUpdate(new Date());
            }
        });
        return () => { socket.disconnect(); };
    }, []);

    const vehFacets = useMemo(() => collectVehicleFacets(events), [events]);
    const camList = useMemo(() => { const set = new Set<string>(); events.forEach((e: any) => { const nm = e.device?.name || e.deviceName; if (e.accessType === "PLATE" && nm) set.add(nm); }); return Array.from(set).sort((a, b) => a.localeCompare(b)); }, [events]);
    const displayEvents = useMemo(() => events
        .filter((e) => !filterMerodeo || merodeoSet.has(cleanPlate(e.plateDetected)))
        .filter((e) => {
            if (filterColor === "ALL" && filterVehType === "ALL") return true;
            const m = parseVehicleMeta(e.details);
            if (filterColor !== "ALL" && m.color !== filterColor) return false;
            if (filterVehType !== "ALL" && m.typeLabel !== filterVehType) return false;
            return true;
        })
        .filter((e: any) => { if (selectedCams.size === 0) return true; const nm = e.device?.name || e.deviceName; return !!nm && selectedCams.has(nm); }),
        [events, filterMerodeo, merodeoSet, filterColor, filterVehType, selectedCams]);

    const tieneNvr = useCallback((evt: Ev) => mapped.ids.has(evt.device?.id) || (evt.device?.name && mapped.names.has(evt.device.name)) || (evt.device?.ip && mapped.ips.has(evt.device.ip)), [mapped]);
    const recargar = useCallback(() => loadData(true), [loadData]);

    const masFiltros = (filterColor !== "ALL" ? 1 : 0) + (filterVehType !== "ALL" ? 1 : 0);
    const hayFiltros = !!searchTerm || filterDecision !== "ALL" || filterDirection !== "ALL" || (activeMode === null && filterType !== "ALL") || !!(rango.desde || rango.hasta) || masFiltros > 0 || filterMerodeo || selectedCams.size > 0;
    const limpiarTodo = () => { setSearchTerm(""); setFilterDecision("ALL"); setFilterDirection("ALL"); if (activeMode === null) setFilterType("ALL"); setRango(RANGO_VACIO); setFilterColor("ALL"); setFilterVehType("ALL"); setFilterMerodeo(false); setSelectedCams(new Set()); };

    return (
        <div className="p-5 lg:p-6 space-y-4 max-w-[1700px] mx-auto">
            {/* Encabezado: título · buscador al centro · vista y acciones */}
            <div className="grid grid-cols-1 lg:grid-cols-[1fr_minmax(360px,620px)_1fr] items-center gap-3">
                <div className="flex items-center gap-3 min-w-0">
                    <div className="h-10 w-10 shrink-0 rounded-xl bg-blue-500/10 border border-blue-500/30 grid place-items-center"><History className="w-5 h-5 text-blue-500" /></div>
                    <div className="min-w-0">
                        <h1 className="text-[20px] font-bold leading-tight truncate">Historial de accesos</h1>
                        <p className="text-[12px] text-muted-foreground truncate inline-flex items-center gap-1.5">
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                            <span suppressHydrationWarning>{totalEvents.toLocaleString("es-UY")} eventos · en vivo {lastUpdate ? `· ${hora(lastUpdate)}` : ""}</span>
                        </p>
                    </div>
                </div>

                <div className="relative group">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-[18px] h-[18px] text-muted-foreground group-focus-within:text-blue-500 transition-colors" />
                    <input ref={buscarRef} type="text" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Escape") { setSearchTerm(""); (e.target as HTMLInputElement).blur(); } }}
                        placeholder="Buscar matrícula, persona, lote o cámara…"
                        className="w-full h-11 rounded-xl border border-border bg-card pl-11 pr-24 text-[14px] outline-none shadow-sm transition-all placeholder:text-muted-foreground/70 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/15" />
                    <div className="absolute right-2.5 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
                        {loading && <Loader2 size={15} className="animate-spin text-blue-500" />}
                        {searchTerm ? (
                            <button onClick={() => setSearchTerm("")} className="h-7 w-7 grid place-items-center rounded-lg hover:bg-accent text-muted-foreground" aria-label="Limpiar búsqueda"><X size={15} /></button>
                        ) : <kbd className="h-6 min-w-6 px-1.5 grid place-items-center rounded-md border border-border bg-muted/50 text-[11px] font-semibold text-muted-foreground">/</kbd>}
                    </div>
                </div>

                <div className="flex items-center gap-2 lg:justify-end">
                    <div className="inline-flex items-center rounded-lg border border-border bg-card p-0.5">
                        {([["lista", List, "Lista: tabla con todos los datos"], ["grilla", LayoutGrid, "Grilla: capturas del mismo tamaño"], ["bento", LayoutDashboard, "Bento: mosaico denso, más capturas por pantalla; denegadas y merodeo en grande"]] as const).map(([v, I, tip]) => (
                            <button key={v} onClick={() => cambiarVista(v)} data-tooltip-id={TT} data-tooltip-content={tip}
                                className={cn("h-8 w-9 grid place-items-center rounded-md transition-colors", vista === v ? "bg-blue-600 text-white" : "text-muted-foreground hover:text-foreground hover:bg-accent")}><I size={16} /></button>
                        ))}
                    </div>
                    <span className="h-6 w-px bg-border mx-0.5" />
                    <BotonIcono tip="Exportar (Excel / PDF)" onClick={() => setIsExportDialogOpen(true)}><Download size={16} /></BotonIcono>
                    <BotonIcono tip="Exportar JSON reimportable" onClick={exportJson}><FileJson size={16} /></BotonIcono>
                    <BotonIcono tip="Importar registros de otra instancia" onClick={() => setIsImportOpen(true)}><Upload size={16} /></BotonIcono>
                    <BotonIcono tip="Recargar" onClick={recargar}><RefreshCw size={16} className={loading ? "animate-spin" : ""} /></BotonIcono>
                </div>
            </div>

            {/* Filtros agrupados: qué · resultado · sentido | cuándo | dónde · vehículo · alertas */}
            <div className="flex items-center gap-2 flex-wrap rounded-xl border border-border bg-card/60 p-2">
                {activeMode !== "QUEUE" && (activeMode === null || activeMode === "LPR" || activeMode === "FACE") && (
                    <Segmento valor={filterType} alCambiar={setFilterType as any} opciones={[
                        ...(activeMode === null ? [{ v: "ALL", l: "Todo" }] : []),
                        ...(activeMode === null || activeMode === "LPR" ? [{ v: "PLATE", l: "LPR", I: Car }] : []),
                        ...(activeMode === null || activeMode === "FACE" ? [{ v: "FACE", l: "Rostros", I: ScanFace }] : []),
                        { v: "TAG", l: "RFID", I: CreditCard },
                    ]} />
                )}
                <Segmento valor={filterDecision} alCambiar={setFilterDecision as any} opciones={[
                    { v: "ALL", l: "Todos" }, { v: "GRANT", l: "Permitidos", I: CheckCircle2, on: "bg-emerald-600 text-white" }, { v: "DENY", l: "Denegados", I: XCircle, on: "bg-red-600 text-white" },
                ]} />
                <Segmento valor={filterDirection} alCambiar={setFilterDirection as any} opciones={[
                    { v: "ALL", l: "Ambos" }, { v: "ENTRY", l: "Entrada", I: ArrowDownLeft }, { v: "EXIT", l: "Salida", I: ArrowUpRight, on: "bg-orange-600 text-white" },
                ]} />

                <span className="h-6 w-px bg-border mx-0.5" />
                <RangoFechaHora valor={rango} alCambiar={setRango} />
                <span className="h-6 w-px bg-border mx-0.5" />

                {(activeMode === null || activeMode === "LPR") && (
                    <SelectorCamaras lista={camList} sel={selectedCams} alCambiar={setSelectedCams} />
                )}
                {(vehFacets.colors.length > 0 || vehFacets.types.length > 0) && (
                    <Popover>
                        <PopoverTrigger asChild>
                            <button className={cn("h-9 inline-flex items-center gap-1.5 rounded-lg border px-3 text-[12.5px] font-semibold transition-colors", masFiltros ? "border-blue-500/60 bg-blue-500/10 text-foreground" : "border-border bg-card text-muted-foreground hover:bg-accent")}>
                                <Palette size={14} /> Vehículo{masFiltros ? ` · ${masFiltros}` : ""} <ChevronDown size={13} />
                            </button>
                        </PopoverTrigger>
                        <PopoverContent align="start" className="w-72 p-3 rounded-xl space-y-3">
                            <Chips titulo="Color" opciones={vehFacets.colors} valor={filterColor} alCambiar={setFilterColor} />
                            <Chips titulo="Tipo" opciones={vehFacets.types} valor={filterVehType} alCambiar={setFilterVehType} />
                            <p className="text-[11px] text-muted-foreground">Según lo que informó la cámara en las lecturas cargadas.</p>
                        </PopoverContent>
                    </Popover>
                )}
                <button onClick={() => setFilterMerodeo((v) => !v)} data-tooltip-id={TT} data-tooltip-content="Sólo matrículas que dieron vueltas sin entrar"
                    className={cn("h-9 inline-flex items-center gap-1.5 rounded-lg border px-3 text-[12.5px] font-semibold transition-colors", filterMerodeo ? "bg-red-600 text-white border-red-600" : "border-border bg-card text-muted-foreground hover:bg-accent")}>
                    <ShieldAlert size={14} /> Merodeo{merodeoSet.size > 0 ? ` · ${merodeoSet.size}` : ""}
                </button>

                <div className="ml-auto flex items-center gap-2">
                    <span className="text-[12px] text-muted-foreground tabular-nums">{displayEvents.length.toLocaleString("es-UY")} de {totalEvents.toLocaleString("es-UY")}</span>
                    {hayFiltros && <button onClick={limpiarTodo} className="h-8 px-2.5 rounded-lg text-[12px] font-semibold text-muted-foreground hover:text-foreground hover:bg-accent inline-flex items-center gap-1"><X size={13} /> Limpiar filtros</button>}
                </div>
            </div>

            {/* Resultados */}
            {displayEvents.length === 0 && !loading ? (
                <div className="rounded-xl border border-dashed border-border py-20 text-center">
                    <History className="w-8 h-8 mx-auto text-muted-foreground" />
                    <p className="text-sm text-muted-foreground mt-2">Sin registros con estos filtros</p>
                </div>
            ) : vista === "lista" ? (
                <div className="border border-border/60 rounded-lg overflow-hidden bg-background/50">
                    <div className="overflow-x-auto">
                        <table className="w-full text-left">
                            <thead className="sticky top-0 z-10 bg-card">
                                <tr className="border-b border-border/60">
                                    {["Fecha", "Identidad", "Tipo", "Terminal", "Estado", "Alertas", "Permanencia", "Grab.", ""].map((h, i) => (
                                        <th key={i} className={cn("px-3 py-2.5 text-[10px] text-muted-foreground uppercase tracking-wide font-semibold", i === 7 && "text-center", i === 8 && "text-right")}>{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {displayEvents.map((evt) => (
                                    <Fila key={evt.id} evt={evt} merodeo={merodeoSet.has(cleanPlate(evt.plateDetected))} nvr={!!tieneNvr(evt)} empresa={logos[cleanPlate(evt.plateDetected)]} abrir={abrir} recargar={recargar} />
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            ) : (
                <div className={cn("grid gap-2", vista === "grilla" ? "grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-3" : "grid-cols-[repeat(auto-fill,minmax(150px,1fr))] auto-rows-[96px] [grid-auto-flow:dense]")}>
                    {displayEvents.map((evt, i) => {
                        const merodeo = merodeoSet.has(cleanPlate(evt.plateDetected));
                        const grande = vista === "bento" && (evt.decision !== "GRANT" && !esNoLeida(evt.plateDetected) || merodeo || i % 11 === 0);
                        return <Tarjeta key={evt.id} evt={evt} vista={vista} grande={grande} merodeo={merodeo} nvr={!!tieneNvr(evt)} empresa={logos[cleanPlate(evt.plateDetected)]} abrir={abrir} />;
                    })}
                </div>
            )}

            {/* Centinela del scroll infinito + estado */}
            <div ref={centinela} className="h-12 flex items-center justify-center text-[12px] text-muted-foreground">
                {loading ? <span className="inline-flex items-center gap-2 text-blue-500 font-semibold"><Loader2 size={14} className="animate-spin" /> Cargando…</span>
                    : !hasMore && events.length > 0 ? "Fin del historial con estos filtros" : null}
            </div>

            {/* Una sola ficha para todo el historial */}
            {ficha && (
                <EventDetailsDialog key={`${ficha.evt.id}-${ficha.n}`} event={ficha.evt} autoRecording={ficha.auto} abrirAlMontar
                    empresa={logos[cleanPlate(ficha.evt.plateDetected)] || null}>
                    <span className="hidden" />
                </EventDetailsDialog>
            )}

            <ExportHistoryDialog open={isExportDialogOpen} onOpenChange={setIsExportDialogOpen}
                filters={{ search: searchTerm, decision: filterDecision, type: filterType, direction: filterDirection }}
                rango={rango} camaras={camList} camarasElegidas={selectedCams} />
            <ImportHistoryDialog open={isImportOpen} onOpenChange={setIsImportOpen} onDone={recargar} />
            <ReactTooltip id={TT} place="bottom" className="!max-w-[280px] !text-[12px] !rounded-lg !z-[60]" />
        </div>
    );
}

/* ── Piezas ─────────────────────────────────────────────────── */

function BotonIcono({ tip, onClick, children }: { tip: string; onClick: () => void; children: React.ReactNode }) {
    return <button onClick={onClick} data-tooltip-id={TT} data-tooltip-content={tip} aria-label={tip}
        className="h-9 w-9 grid place-items-center rounded-lg border border-border bg-card text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">{children}</button>;
}

function Segmento({ valor, alCambiar, opciones }: { valor: string; alCambiar: (v: string) => void; opciones: { v: string; l: string; I?: any; on?: string }[] }) {
    return (
        <div className="inline-flex items-center rounded-lg border border-border bg-card p-0.5">
            {opciones.map((o) => (
                <button key={o.v} onClick={() => alCambiar(o.v)}
                    className={cn("h-8 px-2.5 rounded-md text-[12.5px] font-semibold inline-flex items-center gap-1.5 transition-colors",
                        valor === o.v ? (o.on || "bg-blue-600 text-white") : "text-muted-foreground hover:text-foreground hover:bg-accent")}>
                    {o.I && <o.I size={13} />}{o.l}
                </button>
            ))}
        </div>
    );
}

function Chips({ titulo, opciones, valor, alCambiar }: { titulo: string; opciones: string[]; valor: string; alCambiar: (v: string) => void }) {
    if (!opciones.length) return null;
    return (
        <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground mb-1.5">{titulo}</div>
            <div className="flex flex-wrap gap-1.5">
                {["ALL", ...opciones].map((o) => (
                    <button key={o} onClick={() => alCambiar(o)} className={cn("h-7 px-2.5 rounded-full border text-[12px] capitalize transition-colors", valor === o ? "bg-blue-600 border-blue-600 text-white" : "border-border hover:bg-accent")}>{o === "ALL" ? "Todos" : o}</button>
                ))}
            </div>
        </div>
    );
}

function SelectorCamaras({ lista, sel, alCambiar }: { lista: string[]; sel: Set<string>; alCambiar: (s: Set<string>) => void }) {
    return (
        <Popover>
            <PopoverTrigger asChild>
                <button className={cn("h-9 inline-flex items-center gap-1.5 rounded-lg border px-3 text-[12.5px] font-semibold transition-colors", sel.size ? "border-blue-500/60 bg-blue-500/10 text-foreground" : "border-border bg-card text-muted-foreground hover:bg-accent")}>
                    <Camera size={14} /> {sel.size ? `Cámaras · ${sel.size}` : "Cámaras"} <ChevronDown size={13} />
                </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-64 p-1.5 rounded-xl">
                <div className="flex items-center justify-between px-2 py-1">
                    <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Cámaras LPR</span>
                    {sel.size > 0 && <button onClick={() => alCambiar(new Set())} className="text-[11px] text-blue-500 hover:underline">Limpiar</button>}
                </div>
                <div className="max-h-72 overflow-y-auto">
                    {lista.length === 0 && <div className="text-xs text-muted-foreground px-2 py-2">Sin cámaras en lo cargado.</div>}
                    {lista.map((name) => {
                        const on = sel.has(name); return (
                            <button key={name} onClick={() => { const s = new Set(sel); if (on) s.delete(name); else s.add(name); alCambiar(s); }}
                                className={cn("w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-[12.5px] text-left transition-colors", on ? "bg-blue-500/12 text-foreground" : "hover:bg-accent text-muted-foreground")}>
                                <span className={cn("w-4 h-4 rounded border grid place-items-center shrink-0", on ? "bg-blue-600 border-blue-600" : "border-border")}>{on && <Check size={11} className="text-white" />}</span>
                                <span className="truncate">{name}</span>
                            </button>
                        );
                    })}
                </div>
            </PopoverContent>
        </Popover>
    );
}

function marcaDe(details: any): string {
    const m = String(details || "").match(/Marca:\s*([^,]+)/); let b = (m?.[1] || "").trim();
    if (b.startsWith("Brand ")) b = getVehicleBrandName(b.replace("Brand ", ""));
    return b;
}

/** Fila de la lista. Memorizada: con cientos de filas cargadas, sólo se re-dibuja la que cambia. */
const Fila = memo(function Fila({ evt, merodeo, nvr, empresa, abrir, recargar }: { evt: Ev; merodeo: boolean; nvr: boolean; empresa?: any; abrir: (e: Ev, auto?: boolean) => void; recargar: () => void }) {
    const ok = evt.decision === "GRANT";
    const foto = fotoDe(evt);
    const marca = marcaDe(evt.details);
    const parar = (e: React.MouseEvent) => e.stopPropagation();
    return (
        <tr onClick={() => abrir(evt)} className="border-b border-border/50 last:border-0 hover:bg-foreground/[0.04] transition-colors cursor-pointer [content-visibility:auto] [contain-intrinsic-size:auto_60px]">
            <td className="px-3 py-2">
                <p className="text-[13px] font-medium tabular-nums">{hora(evt.timestamp)}</p>
                <p className="text-[10px] text-muted-foreground">{fecha(evt.timestamp)}</p>
            </td>
            <td className="px-3 py-2">
                <div className="flex items-center gap-3">
                    <div className="relative w-14 h-9 rounded-md bg-muted border border-border/60 overflow-hidden shrink-0 grid place-items-center">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        {foto ? <img src={conAncho(foto, 120)} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover" /> : <Camera size={14} className="text-muted-foreground" />}
                    </div>
                    {empresa && <span className="shrink-0 -ml-1" data-tooltip-id={TT} data-tooltip-content={empresa.nombre}><LogoSobreFoto empresa={empresa} className="h-6 max-w-[64px]" /></span>}
                    <div className="min-w-0">
                        <div className="flex items-center gap-2">
                            <p className="text-[13px] font-semibold truncate">{evt.user?.name || (evt.accessType === "PLATE" ? (evt.plateDetected || "S/M") : "Desconocido")}</p>
                            {evt.accessType === "PLATE" && evt.plateDetected && evt.user?.name && <span className="bg-white text-black text-[9px] font-bold px-1.5 py-0.5 rounded-sm font-mono border-b-2 border-blue-600">{evt.plateDetected}</span>}
                        </div>
                        <p className="text-[10px] text-muted-foreground truncate">{empresa ? <b className="text-sky-600 dark:text-sky-400">{empresa.nombre}</b> : null}{empresa ? " · " : ""}{evt.user?.unit?.name || marca || "Visitante"}</p>
                        <VehicleMetaChips details={evt.details} size="sm" className="mt-0.5" />
                    </div>
                </div>
            </td>
            <td className="px-3 py-2">
                <span className={cn("inline-flex items-center gap-1.5 text-[11px] font-medium", evt.accessType === "PLATE" ? "text-amber-500" : evt.accessType === "FACE" ? "text-teal-500" : "text-blue-500")}>
                    {evt.accessType === "PLATE" ? <Car size={13} /> : evt.accessType === "FACE" ? <ScanFace size={13} /> : <CreditCard size={13} />}
                    {evt.accessType === "PLATE" ? "LPR" : evt.accessType === "FACE" ? "Facial" : "RFID"}
                </span>
            </td>
            <td className="px-3 py-2">
                <p className="text-[12px] text-muted-foreground font-medium truncate max-w-[180px]">{evt.device?.name || "Terminal"}</p>
                <div className={cn("flex items-center gap-1 text-[10px] font-semibold mt-0.5", evt.direction === "ENTRY" ? "text-emerald-500" : "text-orange-500")}>
                    {evt.direction === "ENTRY" ? <ArrowDownLeft size={10} /> : <ArrowUpRight size={10} />}{evt.direction === "ENTRY" ? "Entrada" : "Salida"}
                </div>
            </td>
            <td className="px-3 py-2">
                <span className={cn("inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold border", ok ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20" : "bg-red-500/10 text-red-500 border-red-500/20")}>{ok ? "Autorizado" : "Denegado"}</span>
            </td>
            <td className="px-3 py-2">{merodeo ? <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-red-500/10 text-red-500 border border-red-500/20"><ShieldAlert size={11} /> Merodeo</span> : <span className="text-xs text-muted-foreground/50">—</span>}</td>
            <td className="px-3 py-2">
                {evt.direction === "EXIT" && evt.stayDuration && evt.previousDirection === "ENTRY"
                    ? <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">{fmtDur(evt.stayDuration)}</span>
                    : <span className="text-xs text-muted-foreground/50">—</span>}
            </td>
            <td className="px-3 py-2 text-center">
                {nvr ? <button onClick={(e) => { parar(e); abrir(evt, true); }} data-tooltip-id={TT} data-tooltip-content="Ver grabación" className="text-blue-500 hover:text-blue-400 p-1.5 rounded-md hover:bg-blue-500/10"><Film size={15} /></button>
                    : <span className="text-[10px] text-muted-foreground/40">sin NVR</span>}
            </td>
            <td className="px-3 py-2 text-right" onClick={parar}>
                <div className="inline-flex items-center gap-1 justify-end">
                    {esNoLeida(evt.plateDetected) && <PlateManualButton eventId={evt.id} currentPlate={evt.plateDetected} onSaved={recargar} className="!p-1.5 rounded-md" />}
                    {evt.accessType === "PLATE" && !esNoLeida(evt.plateDetected) && <MinInteriorButton plate={evt.plateDetected} className="!p-1.5 rounded-md" />}
                    <button onClick={() => abrir(evt)} className="text-muted-foreground hover:text-blue-500 p-1.5 rounded-md hover:bg-blue-500/10" aria-label="Abrir ficha"><MoreHorizontal size={16} /></button>
                </div>
            </td>
        </tr>
    );
});

/** Tarjeta de grilla y de bento: la captura manda; datos encima, sin cajas. */
const Tarjeta = memo(function Tarjeta({ evt, vista, grande, merodeo, nvr, empresa, abrir }: { evt: Ev; vista: Vista; grande: boolean; merodeo: boolean; nvr: boolean; empresa?: any; abrir: (e: Ev, auto?: boolean) => void }) {
    const ok = evt.decision === "GRANT";
    const foto = fotoDe(evt);
    const bento = vista === "bento";
    const ancho = bento ? (grande ? 520 : 260) : 400;
    const [cargada, setCargada] = useState(false);
    const placa = esNoLeida(evt.plateDetected) ? "S/L" : evt.plateDetected;
    return (
        <button type="button" onClick={() => abrir(evt)}
            className={cn("group relative overflow-hidden rounded-xl bg-muted text-left ring-1 transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-lg [content-visibility:auto]",
                ok ? "ring-border" : "ring-red-500/60", merodeo && "ring-2 ring-red-500",
                bento ? (grande ? "col-span-2 row-span-2" : "") : "aspect-video")}>
            {foto ? (
                <>
                    {!cargada && <span className="absolute inset-0 animate-pulse bg-muted-foreground/10" />}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={conAncho(foto, ancho)} alt="" loading="lazy" decoding="async" onLoad={() => setCargada(true)}
                        className={cn("absolute inset-0 w-full h-full object-cover transition-[opacity,transform] duration-300 group-hover:scale-[1.03]", cargada ? "opacity-100" : "opacity-0")} />
                </>
            ) : <span className="absolute inset-0 grid place-items-center text-muted-foreground"><Camera size={20} /></span>}
            <span className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/10 to-transparent" />

            <span className="absolute top-1.5 left-1.5 right-1.5 flex items-start justify-between gap-1">
                <span className={cn("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider text-white", ok ? "bg-emerald-600/90" : "bg-red-600/90")}>
                    {ok ? <CheckCircle2 size={10} /> : <XCircle size={10} />}{bento && !grande ? "" : ok ? "Autorizado" : "Denegado"}
                </span>
                <span className="flex items-center gap-1">
                    {merodeo && <span className="grid h-5 w-5 place-items-center rounded-md bg-red-600 text-white" title="Merodeo"><ShieldAlert size={11} /></span>}
                    {empresa && <LogoSobreFoto empresa={empresa} className={grande || !bento ? "h-6 max-w-[80px]" : "h-4 max-w-[54px]"} />}
                </span>
            </span>

            <span className="absolute bottom-1.5 left-2 right-2 flex items-end justify-between gap-2">
                <span className="min-w-0">
                    <span className={cn("block font-mono font-bold tracking-wider text-white truncate", grande || !bento ? "text-[17px]" : "text-[12.5px]")}>{placa}</span>
                    <span className={cn("block text-white/75 truncate tabular-nums", bento && !grande ? "text-[9.5px]" : "text-[11px]")}>
                        {hora(evt.timestamp).slice(0, 5)} · {evt.direction === "EXIT" ? "Salida" : "Entrada"}{(!bento || grande) && evt.user?.name ? ` · ${evt.user.name}` : ""}
                    </span>
                    {(!bento || grande) && <span className="block text-[10px] text-white/55 truncate">{fecha(evt.timestamp)} · {evt.device?.name || "—"}</span>}
                </span>
                {nvr && (!bento || grande) && (
                    <span role="button" tabIndex={0} onClick={(e) => { e.stopPropagation(); abrir(evt, true); }}
                        className="shrink-0 grid h-7 w-7 place-items-center rounded-full bg-white/15 text-white backdrop-blur hover:bg-white/30" title="Ver grabación"><Film size={13} /></span>
                )}
            </span>
        </button>
    );
});
