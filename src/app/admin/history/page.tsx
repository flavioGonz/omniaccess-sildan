"use client";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { PulsoActividad } from "@/components/history/PulsoActividad";
import { getAccessEvents } from "@/app/actions/history";
import { getEnabledModules } from "@/app/actions/modules";
import { History, Download, RefreshCw, Upload, FileJson } from "lucide-react";
import { Pista } from "@/components/ui/pista";
import { Seek } from "@/components/ui/search";
import { ExportHistoryDialog } from "@/components/history/ExportHistoryDialog";
import { ImportHistoryDialog } from "@/components/history/ImportHistoryDialog";
import { TablaUnificada } from "@/components/history/TablaUnificada";
import { BarraFiltros, SIN_FILTROS, type FiltrosHistorial, type CambiarFiltros } from "@/components/history/BarraFiltros";
import { SelectorVista, useVista } from "@/components/history/MosaicoHistorial";
import { useSiluetas } from "@/lib/use-siluetas";
import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSearchParams } from "next/navigation";
import { horaSeg } from "@/lib/fechas";

/**
 * El historial: accesos y seguimiento en un solo registro.
 *
 * Arriba, dos renglones con un trabajo cada uno, como quedó en Olivos (main 1013697):
 *
 *   1. **Qué es y con qué se opera**: el título con el pulso y el vivo a la izquierda, el
 *      buscador al centro (se llega con «/» desde cualquier lado, y Esc lo vacía), y a la
 *      derecha cómo se mira (lista, grilla, bento) y las acciones (exportar, importar).
 *   2. **Qué se está mirando**: los filtros a la vista (BarraFiltros), cada uno diciendo lo que
 *      tiene puesto. Reemplaza al botón «Filtros» con su cajón y los chips de debajo.
 *
 * Esta página cargaba, por debajo, una segunda consulta entera que dejó de alimentar la tabla
 * cuando se unificó el historial; eso se fue hace rato y lo que queda alimenta lo que se ve.
 */
export default function HistoryPage() {
    const [searchTerm, setSearchTerm] = useState("");
    const _urlSearch = useSearchParams();
    useEffect(() => { const _q = _urlSearch.get("search"); if (_q) setSearchTerm(_q); /* eslint-disable-next-line */ }, []);

    const [f, setF] = useState<FiltrosHistorial>(SIN_FILTROS);
    const cambiar = useCallback<CambiarFiltros>((clave, valor) => setF((p) => ({ ...p, [clave]: valor })), []);
    const [vista, setVista] = useVista();
    const [siluetas, setSiluetas] = useSiluetas();

    const [activeMode, setActiveMode] = useState<"LPR" | "FACE" | "QUEUE" | null>(null);
    /** Hasta saber qué módulos hay no se ofrece el filtro de identificación: aparecía y se iba en el primer segundo. */
    const [modosListos, setModosListos] = useState(false);
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
            setModosListos(true);
        });
    }, [cambiar]);

    /**
     * «/» lleva al buscador desde cualquier lado (si no se está escribiendo en otro campo), y Esc
     * adentro lo vacía. El buscador no expone su campo, así que se lo busca dentro de su caja.
     */
    const cajaBuscar = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const alTeclear = (e: KeyboardEvent) => {
            const el = e.target as HTMLElement | null;
            const escribiendo = el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
            const campo = cajaBuscar.current?.querySelector("input");
            if (e.key === "/" && !escribiendo && campo) { e.preventDefault(); campo.focus(); }
            if (e.key === "Escape" && campo && el === campo) { setSearchTerm(""); campo.blur(); }
        };
        window.addEventListener("keydown", alTeclear);
        return () => window.removeEventListener("keydown", alTeclear);
    }, []);

    const exportJson = async () => {
        try {
            const resp: any = await getAccessEvents({ take: 100000, skip: 0, search: searchTerm, decision: f.resultado, type: f.identificacion, direction: f.sentido, from: f.desde ? new Date(f.desde) : undefined, to: f.hasta ? new Date(f.hasta) : undefined });
            const evs = (resp.events || []).map((e: any) => ({ id: e.id, timestamp: e.timestamp, createdAt: e.createdAt, accessType: e.accessType, credentialId: e.credentialId, decision: e.decision, direction: e.direction, plateDetected: e.plateDetected, plateNumber: e.plateNumber, location: e.location, snapshotPath: e.snapshotPath, imagePath: e.imagePath, details: e.details, deviceName: e.device?.name || null }));
            const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), count: evs.length, events: evs }, null, 2)], { type: "application/json" });
            const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `omniaccess-historial-${new Date().toISOString().slice(0, 10)}.json`; a.click(); URL.revokeObjectURL(url);
        } catch (e) { console.error(e); }
    };

    /**
     * Lo que se puede decir de lo que está cargado: qué colores, tipos de vehículo y cámaras
     * aparecen. Sale de la tabla: un filtro tiene que ofrecer lo que hay en pantalla.
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

    /** Cuántos filtros hay puestos (para «Limpiar»). La identificación fija por módulo no cuenta: no la puso nadie. */
    const puestos = useMemo(() => {
        let n = searchTerm.trim() ? 1 : 0;
        if (f.desde || f.hasta) n++;
        if (f.tipos.length) n++;
        if (f.identificacion !== "ALL" && activeMode === null) n++;
        if (f.resultado !== "ALL") n++;
        if (f.sentido !== "ALL") n++;
        if (f.camaras.length) n++;
        if (f.color !== "ALL" || f.tipoVeh !== "ALL") n++;
        if (f.merodeo) n++;
        if (f.vision.length) n++;
        return n;
    }, [f, searchTerm, activeMode]);

    const limpiarFiltros = useCallback(() => {
        setSearchTerm("");
        setF({ ...SIN_FILTROS, identificacion: activeMode === "FACE" ? "FACE" : activeMode === "LPR" ? "PLATE" : "ALL" });
    }, [activeMode]);

    const recargar = useCallback(() => setVersion((v) => v + 1), []);
    const alCargar = useCallback(() => setLastUpdate(new Date()), []);

    const iconoAccion = "flex items-center justify-center w-9 h-9 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors";

    return (
        <div className="p-6 lg:p-8 space-y-4 max-w-[1600px] mx-auto">
            {/* Renglón 1: qué es · buscador al centro · cómo se mira y acciones */}
            <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(280px,440px)_minmax(0,1fr)] items-center gap-3">
                <div className="flex items-center gap-3 min-w-0">
                    <span className="grid h-9 w-9 place-items-center rounded-[10px] bg-foreground text-background shrink-0"><History size={18} strokeWidth={2.3} /></span>
                    <div className="min-w-0">
                        <h1 className="text-[17px] font-bold leading-tight whitespace-nowrap">Historial</h1>
                        <Pista titulo="Última actualización" texto="El registro se refresca solo con cada evento nuevo. Tocá para volver a consultar ahora.">
                            <button type="button" onClick={recargar} className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground hover:text-foreground whitespace-nowrap">
                                <span className="w-1.5 h-1.5 rounded-full bg-[var(--bien)] animate-pulse shrink-0" />
                                en vivo · <span className="tabular-nums" suppressHydrationWarning>{lastUpdate ? horaSeg(lastUpdate) : "--:--:--"}</span>
                                <RefreshCw size={11} />
                            </button>
                        </Pista>
                    </div>
                    {/* El pulso sólo donde entra sin apretar al título: con menos ancho empujaba el buscador. */}
                    <span className="hidden min-[1800px]:block w-px h-8 bg-border mx-1" />
                    <div className="hidden min-[1800px]:block"><PulsoActividad dias={60} /></div>
                </div>

                <div ref={cajaBuscar} className="flex justify-center min-w-0">
                    <Seek value={searchTerm} onChange={setSearchTerm} placeholder="Matrícula, persona, cámara o lo que vio OmniVision (moto blanca, chaleco)…  ( / )" startOpen width={420} alto={38} />
                </div>

                <div className="flex items-center justify-start lg:justify-end gap-1.5">
                    {/* Las siluetas de OmniVision sobre las capturas: sólo en grilla y bento (en la lista la foto es de 80 px). */}
                    {vista !== "lista" && (
                        <Pista titulo="Siluetas de OmniVision" texto="Dibuja sobre cada captura lo que detectó OmniVision (personas, vehículos, animales). Es la misma opción que el interruptor del visor del evento.">
                            <button type="button" onClick={() => setSiluetas(!siluetas)} aria-pressed={siluetas} aria-label="Siluetas de OmniVision"
                                className={cn("h-[34px] px-2.5 rounded-lg border inline-flex items-center gap-1.5 text-[12px] font-semibold transition-colors",
                                    siluetas ? "accion border-transparent" : "border-border text-muted-foreground hover:text-foreground hover:bg-accent")}>
                                <Sparkles size={14} /> Siluetas
                            </button>
                        </Pista>
                    )}
                    <SelectorVista vista={vista} alCambiar={setVista} />
                    <span className="w-px h-6 bg-border mx-1" />
                    <Pista titulo="Exportar" texto="Descarga los registros filtrados en planilla, para compartir o archivar.">
                        <button type="button" onClick={() => setIsExportDialogOpen(true)}
                            /* Exportar conserva su rótulo: es la acción que la gente viene a buscar; las otras dos son de mantenimiento. */
                            className="flex items-center gap-1.5 h-9 px-3 rounded-lg text-[12px] font-semibold tono-accion hover:bg-accent transition-colors"><Download size={15} /> Exportar</button>
                    </Pista>
                    <Pista titulo="Exportar en JSON" texto="El mismo registro en un archivo reimportable en otra instalación de OmniAccess.">
                        <button type="button" onClick={exportJson} className={iconoAccion} aria-label="Exportar en JSON"><FileJson size={16} /></button>
                    </Pista>
                    <Pista titulo="Importar" texto="Trae registros exportados desde otra instalación.">
                        <button type="button" onClick={() => setIsImportOpen(true)} className={iconoAccion} aria-label="Importar"><Upload size={16} /></button>
                    </Pista>
                </div>
            </div>

            {/* Renglón 2 (barra de la tabla): los filtros a la vista */}
            <TablaUnificada
                barra={
                    <BarraFiltros f={f} cambiar={cambiar} limpiar={limpiarFiltros} puestos={puestos}
                        camarasDisponibles={resumen.camaras} colores={resumen.colores} tiposVeh={resumen.tipos}
                        soloSeguimiento={soloSeguimiento} modo={modosListos ? activeMode : "LPR"} merodeando={chapasMerodeo.size} />
                }
                buscar={searchTerm}
                desde={f.desde}
                hasta={f.hasta}
                tipos={f.tipos}
                identificacion={soloSeguimiento ? "ALL" : f.identificacion}
                resultado={soloSeguimiento ? "ALL" : f.resultado}
                sentido={soloSeguimiento ? "ALL" : f.sentido}
                version={version}
                vista={vista}
                vision={soloSeguimiento ? [] : f.vision}
                merodeo={f.merodeo && !soloSeguimiento ? chapasMerodeo : undefined}
                color={soloSeguimiento ? "ALL" : f.color}
                tipoVeh={soloSeguimiento ? "ALL" : f.tipoVeh}
                camaras={f.camaras}
                onMerodeo={setChapasMerodeo}
                onResumen={setResumen}
                onCargado={alCargar}
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
