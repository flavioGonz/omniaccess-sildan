"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { PulsoActividad } from "@/components/history/PulsoActividad";
import { getAccessEvents } from "@/app/actions/history";
import { getEnabledModules } from "@/app/actions/modules";
import { History, Download, RefreshCw, Upload, FileJson, X } from "lucide-react";
import { Pista } from "@/components/ui/pista";
import { Seek } from "@/components/ui/search";
import { ExportHistoryDialog } from "@/components/history/ExportHistoryDialog";
import { ImportHistoryDialog } from "@/components/history/ImportHistoryDialog";
import { TablaUnificada } from "@/components/history/TablaUnificada";
import { CajonFiltros, BotonFiltros, type FiltrosHistorial, type CambiarFiltros } from "@/components/history/CajonFiltros";
import { useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { horaSeg, fechaCorta } from "@/lib/fechas";

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

/** Sin nada puesto: todo el registro. */
const SIN_FILTROS: FiltrosHistorial = {
    desde: "", hasta: "", tipos: [], identificacion: "ALL", resultado: "ALL", sentido: "ALL",
    camaras: [], color: "ALL", tipoVeh: "ALL", merodeo: false,
};

const NOMBRE_CLASE: Record<string, string> = { ACCESO: "accesos", PASO: "avistamientos", ESTACIONADO: "estacionados", VISTO: "vistos" };
const NOMBRE_IDENT: Record<string, string> = { PLATE: "matrícula", FACE: "rostro", TAG: "RFID" };

/**
 * El historial: accesos y seguimiento en un solo registro.
 *
 * Esta página cargaba, por debajo, una segunda consulta entera — `getAccessEvents` con su
 * propio paginado, su propio socket y su propio contador — que dejó de alimentar la tabla
 * cuando se unificó el historial. Quedó un año así: el botón de refrescar recargaba esa
 * lista fantasma (la tabla no se enteraba), tres grupos de filtros cambiaban un estado que
 * la tabla no leía, y el reloj de "última actualización" marcaba la hora de la consulta
 * que nadie veía. Todo eso se fue; lo que queda alimenta lo que se ve.
 */
export default function HistoryPage() {
    const [searchTerm, setSearchTerm] = useState("");
    const _urlSearch = useSearchParams();
    useEffect(() => { const _q = _urlSearch.get("search"); if (_q) setSearchTerm(_q); /* eslint-disable-next-line */ }, []);

    const [f, setF] = useState<FiltrosHistorial>(SIN_FILTROS);
    const cambiar = useCallback<CambiarFiltros>((clave, valor) => setF((p) => ({ ...p, [clave]: valor })), []);
    const [cajonAbierto, setCajonAbierto] = useState(false);

    const [activeMode, setActiveMode] = useState<"LPR" | "FACE" | "QUEUE" | null>(null);
    const [isExportDialogOpen, setIsExportDialogOpen] = useState(false);
    const [isImportOpen, setIsImportOpen] = useState(false);
    const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
    /** Subirlo recarga la tabla desde la primera página. */
    const [version, setVersion] = useState(0);
    const [chapasMerodeo, setChapasMerodeo] = useState<Set<string>>(new Set());

    useEffect(() => {
        getEnabledModules().then(modules => {
            if (modules.MODULE_QUEUE) { setActiveMode("QUEUE"); }
            else if (modules.MODULE_FACE && !modules.MODULE_LPR) { setActiveMode("FACE"); cambiar("identificacion", "FACE"); }
            else if (modules.MODULE_LPR && !modules.MODULE_FACE) { setActiveMode("LPR"); cambiar("identificacion", "PLATE"); }
            else setActiveMode(null);
        });
    }, [cambiar]);

    const exportJson = async () => {
        try {
            const resp: any = await getAccessEvents({ take: 100000, skip: 0, search: searchTerm, decision: f.resultado, type: f.identificacion, direction: f.sentido, from: f.desde ? new Date(f.desde) : undefined, to: f.hasta ? new Date(f.hasta) : undefined });
            const evs = (resp.events || []).map((e: any) => ({ id: e.id, timestamp: e.timestamp, createdAt: e.createdAt, accessType: e.accessType, credentialId: e.credentialId, decision: e.decision, direction: e.direction, plateDetected: e.plateDetected, plateNumber: e.plateNumber, location: e.location, snapshotPath: e.snapshotPath, imagePath: e.imagePath, details: e.details, deviceName: e.device?.name || null }));
            const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), count: evs.length, events: evs }, null, 2)], { type: "application/json" });
            const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `omniaccess-historial-${new Date().toISOString().slice(0, 10)}.json`; a.click(); URL.revokeObjectURL(url);
        } catch (e) { console.error(e); }
    };

    /**
     * Lo que se puede decir de lo que está cargado: cuántos permitidos, cuántos denegados,
     * y qué colores, tipos de vehículo y cámaras aparecen. Sale de la tabla: un filtro
     * tiene que ofrecer lo que hay en pantalla, no lo que había en otra consulta.
     */
    const [resumen, setResumen] = useState<{ grant: number; deny: number; colores: string[]; tipos: string[]; camaras: string[] }>(
        { grant: 0, deny: 0, colores: [], tipos: [], camaras: [] },
    );

    /**
     * Cuando se eligió mirar sólo avistamientos o estacionados, los filtros de acceso no
     * aplican: una lectura interior no decide nada, así que no hay permitido ni denegado
     * ni sentido.
     */
    const soloSeguimiento = f.tipos.length > 0 && !f.tipos.includes("ACCESO");

    /** Los filtros activos, en palabras, cada uno con su forma de sacarlo. */
    const filtrosPuestos = useMemo(() => {
        const l: { id: string; texto: string; quitar: () => void }[] = [];
        const diaDe = (s: string) => fechaCorta(new Date(`${s}T12:00:00`));
        if (f.desde && f.hasta && f.desde === f.hasta) l.push({ id: "d", texto: `el ${diaDe(f.desde)}`, quitar: () => { cambiar("desde", ""); cambiar("hasta", ""); } });
        else {
            if (f.desde) l.push({ id: "d1", texto: `desde ${diaDe(f.desde)}`, quitar: () => cambiar("desde", "") });
            if (f.hasta) l.push({ id: "d2", texto: `hasta ${diaDe(f.hasta)}`, quitar: () => cambiar("hasta", "") });
        }
        for (const t of f.tipos) l.push({ id: "cl_" + t, texto: NOMBRE_CLASE[t] || t, quitar: () => cambiar("tipos", f.tipos.filter((x) => x !== t)) });
        if (!soloSeguimiento) {
            // Con un solo módulo la identificación viene fija y no es algo que el operador haya puesto.
            if (f.identificacion !== "ALL" && activeMode === null && NOMBRE_IDENT[f.identificacion]) l.push({ id: "t", texto: NOMBRE_IDENT[f.identificacion], quitar: () => cambiar("identificacion", "ALL") });
            if (f.resultado !== "ALL") l.push({ id: "dec", texto: f.resultado === "GRANT" ? "permitidos" : "denegados", quitar: () => cambiar("resultado", "ALL") });
            if (f.sentido !== "ALL") l.push({ id: "dir", texto: f.sentido === "ENTRY" ? "entradas" : "salidas", quitar: () => cambiar("sentido", "ALL") });
            if (f.color !== "ALL") l.push({ id: "col", texto: `color ${f.color}`, quitar: () => cambiar("color", "ALL") });
            if (f.tipoVeh !== "ALL") l.push({ id: "veh", texto: f.tipoVeh, quitar: () => cambiar("tipoVeh", "ALL") });
            if (f.merodeo) l.push({ id: "mer", texto: "merodeo", quitar: () => cambiar("merodeo", false) });
        }
        for (const c of f.camaras) l.push({ id: "cam_" + c, texto: c, quitar: () => cambiar("camaras", f.camaras.filter((x) => x !== c)) });
        return l;
    }, [f, soloSeguimiento, activeMode, cambiar]);

    const limpiarFiltros = useCallback(() => {
        setSearchTerm("");
        setF({ ...SIN_FILTROS, identificacion: activeMode === "FACE" ? "FACE" : activeMode === "LPR" ? "PLATE" : "ALL" });
    }, [activeMode]);

    const recargar = useCallback(() => setVersion((v) => v + 1), []);
    const alCargar = useCallback(() => setLastUpdate(new Date()), []);

    return (
        <div className="p-6 lg:p-8 space-y-6 max-w-[1600px] mx-auto">
            {/*
                Encabezado: una sola barra. Qué es esta pantalla a la izquierda, con qué se
                la opera a la derecha, en un riel único. Las fechas ya no están acá: son un
                filtro más y viven en el cajón con los otros, con sus atajos.
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
                            texto="El registro se refresca solo con cada evento nuevo. El botón vuelve a consultar ahora, por si estás esperando algo puntual.">
                            <button onClick={recargar}
                                className="flex items-center gap-1.5 h-9 px-2.5 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse shrink-0" />
                                <span className="text-[11px] tabular-nums" suppressHydrationWarning>
                                    {lastUpdate ? horaSeg(lastUpdate) : "--:--:--"}
                                </span>
                                <RefreshCw className="w-3 h-3 ml-0.5" />
                            </button>
                        </Pista>
                    </div>
                </div>
            </div>

            {/*
                LOS CONTROLES DE LA TABLA: el buscador, UN botón de filtros que dice cuántos
                hay puestos, y debajo — sólo cuando hay algo — la línea que dice qué se está
                filtrando, que es la que contesta "¿por qué no aparece lo que busco?".
            */}
            <TablaUnificada
                barra={
                    <div>
                        <div className="flex items-center flex-wrap gap-2 min-h-[34px]">
                            <Seek value={searchTerm} onChange={setSearchTerm} placeholder="Matrícula, nombre o cámara" startOpen width={280} alto={34} />
                            <BotonFiltros puestos={filtrosPuestos.length} onClick={() => setCajonAbierto(true)} />
                        </div>

                        <AnimatePresence initial={false}>
                            {(filtrosPuestos.length > 0 || searchTerm.trim()) && (
                                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                                    transition={{ duration: 0.18 }} className="overflow-hidden">
                                    <div className="flex items-center gap-1.5 flex-wrap pt-2">
                                        <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/60 mr-0.5">Filtrando</span>
                                        <AnimatePresence initial={false}>
                                            {searchTerm.trim() && <ChipFiltro key="q" onQuitar={() => setSearchTerm("")}>«{searchTerm.trim()}»</ChipFiltro>}
                                            {filtrosPuestos.map((x) => (
                                                <ChipFiltro key={x.id} onQuitar={x.quitar}>{x.texto}</ChipFiltro>
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
                desde={f.desde}
                hasta={f.hasta}
                tipos={f.tipos}
                identificacion={soloSeguimiento ? "ALL" : f.identificacion}
                resultado={soloSeguimiento ? "ALL" : f.resultado}
                sentido={soloSeguimiento ? "ALL" : f.sentido}
                version={version}
                merodeo={f.merodeo && !soloSeguimiento ? chapasMerodeo : undefined}
                color={soloSeguimiento ? "ALL" : f.color}
                tipoVeh={soloSeguimiento ? "ALL" : f.tipoVeh}
                camaras={f.camaras}
                onMerodeo={setChapasMerodeo}
                onResumen={setResumen}
                onCargado={alCargar}
            />

            <CajonFiltros
                abierto={cajonAbierto} onOpenChange={setCajonAbierto}
                f={f} cambiar={cambiar} limpiar={limpiarFiltros}
                camarasDisponibles={resumen.camaras} colores={resumen.colores} tiposVeh={resumen.tipos}
                soloSeguimiento={soloSeguimiento} modo={activeMode} merodeando={chapasMerodeo.size}
            />

            <ExportHistoryDialog
                open={isExportDialogOpen}
                onOpenChange={setIsExportDialogOpen}
                filters={{ search: searchTerm, decision: f.resultado, type: f.identificacion, direction: f.sentido }}
            />
            <ImportHistoryDialog open={isImportOpen} onOpenChange={setIsImportOpen} onDone={recargar} />
        </div>
    );
}
