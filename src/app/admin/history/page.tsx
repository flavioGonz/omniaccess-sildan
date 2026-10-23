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
import type { EstadoMotor } from "@/components/history/MotoresBusqueda";
import { filtroDeAreas, type DatosAreasHistorial } from "@/lib/filtro-areas";
import { BarraFiltros, SIN_FILTROS, type FiltrosHistorial, type CambiarFiltros } from "@/components/history/BarraFiltros";
import { SelectorVista, useVista } from "@/components/history/MosaicoHistorial";
import { useSiluetas } from "@/lib/use-siluetas";
import { Sparkles, Server, ImagePlus, Car, User, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSearchParams } from "next/navigation";
import { horaSeg, limiteDeFiltro, periodoConHora } from "@/lib/fechas";
import type { CamaraHistorial } from "@/app/api/history/camaras/route";

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
    /*
     * Buscar con una FOTO (21/10, Nico: «sí» a sumar la foto al buscador): se sube, se pega (Ctrl+V)
     * o se arrastra; se busca lo parecido en OmniVision y en los grabadores que buscan por imagen, y
     * la lista muestra sólo eso, del más parecido al menos. «Vehículo» o «Persona» dice qué mirar.
     * (El buscador de objetos por nombre, «Objetos», quedó adentro de OmniVision: ver TablaUnificada.)
     */
    const [foto, setFoto] = useState<{ blob: Blob; url: string; objeto: "vehiculo" | "persona" } | null>(null);
    const elegirFoto = useRef<HTMLInputElement>(null);
    const ponerFoto = useCallback((b: Blob | null | undefined) => {
        if (!b || !/^image\/(jpeg|png|webp)/.test(b.type)) return;
        setFoto((prev) => { if (prev) URL.revokeObjectURL(prev.url); return { blob: b, url: URL.createObjectURL(b), objeto: prev?.objeto || "vehiculo" }; });
    }, []);
    const sacarFoto = useCallback(() => setFoto((prev) => { if (prev) URL.revokeObjectURL(prev.url); return null; }), []);
    useEffect(() => {
        const pegar = (e: ClipboardEvent) => {
            const it = Array.from(e.clipboardData?.items || []).find((x) => x.type.startsWith("image/"));
            if (it) { e.preventDefault(); ponerFoto(it.getAsFile()); }
        };
        window.addEventListener("paste", pegar);
        return () => window.removeEventListener("paste", pegar);
    }, [ponerFoto]);
    /*
     * Un solo buscador, con botones para los motores (21/10, Nico: «debe ser un solo buscador, con
     * botones accionables a la derecha, para OmniVision y la búsqueda IA del NVR; el resultado, la
     * misma tabla, grilla o bento»). Lo que se escribe siempre busca en los registros; OmniVision suma
     * lo que vio parecido, y el grabador su búsqueda inteligente, si hay alguno que la tenga
     * (/api/grabador/capacidades: no importa el fabricante). Se recuerda qué motores estaban prendidos.
     */
    const [conOmni, setConOmni] = useState(true);
    const [conGrabador, setConGrabador] = useState(false);
    /** Cómo va cada búsqueda (lo dice la tabla): los botones de los motores giran mientras buscan. */
    const [motores, setMotores] = useState<EstadoMotor[]>([]);
    const omniBuscando = motores.some((m) => (m.clave === "omni" || m.clave === "objetos" || m.clave === "foto") && m.estado === "buscando");
    const grabMotor = motores.find((m) => m.clave === "grabador");
    const [grabadorPuede, setGrabadorPuede] = useState<{ texto: boolean; imagen: boolean; nombres: string } | null>(null);
    useEffect(() => {
        try { setConOmni(localStorage.getItem("historial.omni") !== "0"); setConGrabador(localStorage.getItem("historial.grabador") === "1"); } catch { }
        fetch("/api/grabador/capacidades", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null))
            .then((j) => { if (j) setGrabadorPuede({ texto: !!j.texto, imagen: !!j.imagen, nombres: (j.grabadores || []).filter((x: any) => x.texto && x.activa).map((x: any) => x.nombre).join(", ") }); }).catch(() => { });
    }, []);
    const alternarOmni = () => setConOmni((v) => { try { localStorage.setItem("historial.omni", v ? "0" : "1"); } catch { } return !v; });
    const alternarGrabador = () => setConGrabador((v) => { try { localStorage.setItem("historial.grabador", v ? "0" : "1"); } catch { } return !v; });

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

    /** El período con sus horas, tal cual se le pide al servidor (lib/fechas: limiteDeFiltro). */
    const periodo = useMemo(() => periodoConHora(f.desde, f.hasta, f.horaDesde, f.horaHasta), [f.desde, f.hasta, f.horaDesde, f.horaHasta]);

    const exportJson = async () => {
        try {
            const resp: any = await getAccessEvents({ take: 100000, skip: 0, search: searchTerm, decision: f.resultado, type: f.identificacion, direction: f.sentido, from: limiteDeFiltro(periodo.desde, "inicio") || undefined, to: limiteDeFiltro(periodo.hasta, "fin") || undefined });
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

    /* Las cámaras del filtro, del servidor y del período entero (api/history/camaras): las de las
       filas cargadas dejaban afuera a las que tienen pocas lecturas, como las RTSP de OmniVision. */
    const [camarasServidor, setCamarasServidor] = useState<CamaraHistorial[] | null>(null);
    useEffect(() => {
        let vivo = true;
        const q = new URLSearchParams();
        if (periodo.desde) q.set("from", periodo.desde);
        if (periodo.hasta) q.set("to", periodo.hasta);
        fetch(`/api/history/camaras?${q}`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null))
            .then((j) => { if (vivo && j?.camaras) setCamarasServidor(j.camaras); }).catch(() => { });
        return () => { vivo = false; };
    }, [periodo.desde, periodo.hasta]);

    /* Las áreas de Dispositivos con sus cámaras, para el filtro «Áreas» (lib/filtro-areas). */
    const [areasDatos, setAreasDatos] = useState<DatosAreasHistorial | null>(null);
    useEffect(() => {
        fetch("/api/history/areas", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null))
            .then((j) => { if (j?.areas) setAreasDatos({ areas: j.areas, asignadas: j.asignadas || [] }); }).catch(() => { });
    }, []);
    const filtroArea = useMemo(() => filtroDeAreas(f.areas, areasDatos), [f.areas, areasDatos]);

    /** Cuántos filtros hay puestos (para «Limpiar»). La identificación fija por módulo no cuenta: no la puso nadie. */
    const puestos = useMemo(() => {
        let n = searchTerm.trim() ? 1 : 0;
        if (f.desde || f.hasta || f.horaDesde || f.horaHasta) n++;
        if (f.sinVehiculo !== "ocultar") n++;
        if (f.tipos.length) n++;
        if (f.identificacion !== "ALL" && activeMode === null) n++;
        if (f.resultado !== "ALL") n++;
        if (f.sentido !== "ALL") n++;
        if (f.camaras.length) n++;
        if (f.areas.length) n++;
        if (f.color !== "ALL" || f.tipoVeh !== "ALL") n++;
        if (f.merodeo) n++;
        if (f.vision.length) n++;
        if (f.chapa.length) n++;
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
            <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(280px,640px)_minmax(0,1fr)] items-center gap-3">
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

                <div ref={cajaBuscar} className="flex justify-center items-center gap-2 min-w-0"
                    onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) e.preventDefault(); }}
                    onDrop={(e) => { const fl = e.dataTransfer.files?.[0]; if (fl) { e.preventDefault(); ponerFoto(fl); } }}>
                    {foto ? (
                        /* Buscando con una foto: en lugar del texto, la foto y qué mirar en ella. */
                        <span className="h-[38px] w-[340px] max-w-full rounded-full border border-[var(--accion)] pl-1 pr-1.5 inline-flex items-center gap-2 shrink-0">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={foto.url} alt="" className="h-[30px] w-[30px] rounded-full object-cover shrink-0" />
                            <span className="text-[12px] font-semibold truncate flex-1">Parecidos a la foto</span>
                            <span className="inline-flex rounded-full bg-muted p-0.5">
                                {(["vehiculo", "persona"] as const).map((o) => (
                                    <button key={o} type="button" onClick={() => setFoto((p) => (p ? { ...p, objeto: o } : p))} aria-pressed={foto.objeto === o}
                                        className={cn("h-[26px] px-2 rounded-full inline-flex items-center gap-1 text-[11.5px] font-semibold", foto.objeto === o ? "bg-background shadow-sm text-foreground" : "text-muted-foreground")}>
                                        {o === "vehiculo" ? <Car size={12} /> : <User size={12} />}{o === "vehiculo" ? "Vehículo" : "Persona"}
                                    </button>
                                ))}
                            </span>
                            <button type="button" onClick={sacarFoto} aria-label="Sacar la foto" title="Volver a buscar con texto" className="h-7 w-7 grid place-items-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"><X size={14} /></button>
                        </span>
                    ) : (
                        <Seek value={searchTerm} onChange={setSearchTerm} placeholder="Matrícula, persona, cámara o qué se ve (moto blanca, chaleco)…  ( / )" startOpen width={340} alto={38} />
                    )}
                    <Pista titulo="Buscar con una foto" texto="Subí, pegá (Ctrl+V) o arrastrá una foto: se busca lo parecido en OmniVision y en los grabadores que buscan por imagen.">
                        <button type="button" onClick={() => elegirFoto.current?.click()} aria-label="Buscar con una foto"
                            className={cn("h-[38px] w-[38px] grid place-items-center rounded-full border shrink-0 transition-colors", foto ? "border-[var(--accion)] tono-accion" : "border-border text-muted-foreground hover:text-foreground hover:bg-accent")}>
                            <ImagePlus size={16} />
                        </button>
                    </Pista>
                    <input ref={elegirFoto} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => { ponerFoto(e.target.files?.[0]); e.target.value = ""; }} />
                    {/* Los motores: además de los registros, quién más busca lo escrito. */}
                    <span className="inline-flex items-center rounded-full border border-border p-0.5 h-[38px] shrink-0">
                        <Pista titulo="OmniVision" texto="Suma a la lista lo que OmniVision vio parecido a lo que escribís (por cómo se ve, no por lo anotado), y los objetos que nombres en las fotos de los accesos («carretilla», «escalera»). Va con distintivo violeta.">
                            <button type="button" onClick={alternarOmni} aria-pressed={conOmni}
                                className={cn("h-[32px] px-2.5 rounded-full inline-flex items-center gap-1.5 text-[12px] font-semibold transition-colors", conOmni ? "pleno-quieto" : "text-muted-foreground hover:text-foreground")}>
                                {conOmni && omniBuscando ? <Sparkles size={14} className="animate-spin [animation-duration:1.6s]" /> : <Sparkles size={14} />} OmniVision
                            </button>
                        </Pista>
                        {(grabadorPuede?.texto || grabadorPuede?.imagen) && (
                            <Pista titulo="Búsqueda en el grabador" texto={`Le pide al grabador${grabadorPuede.nombres ? ` (${grabadorPuede.nombres})` : ""} que busque lo escrito en lo grabado, con su IA, en los canales que analiza (se eligen en la ficha del NVR). Tarda unos segundos; lo que encuentra entra a la lista con distintivo celeste. Sin fecha elegida, mira los últimos días.`}>
                                <button type="button" onClick={alternarGrabador} aria-pressed={conGrabador}
                                    className={cn("h-[32px] px-2.5 rounded-full inline-flex items-center gap-1.5 text-[12px] font-semibold transition-colors", conGrabador ? "bg-sky-600 text-white" : "text-muted-foreground hover:text-foreground")}>
                                    <Server size={14} className={cn(conGrabador && grabMotor?.estado === "buscando" && "animate-pulse")} /> Grabador IA
                                    {conGrabador && grabMotor?.estado === "buscando" && <span className="tabular-nums text-[11px] opacity-85">{grabMotor.progreso ? `${Math.round(grabMotor.progreso)} %` : "…"}</span>}
                                </button>
                            </Pista>
                        )}
                    </span>
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
                onMotores={setMotores}
                barra={
                    <BarraFiltros f={f} cambiar={cambiar} limpiar={limpiarFiltros} puestos={puestos}
                        camarasDisponibles={resumen.camaras} camarasServidor={camarasServidor} areasDatos={areasDatos} colores={resumen.colores} tiposVeh={resumen.tipos}
                        soloSeguimiento={soloSeguimiento} modo={modosListos ? activeMode : "LPR"} merodeando={chapasMerodeo.size} />
                }
                buscar={searchTerm}
                desde={periodo.desde}
                hasta={periodo.hasta}
                sinVehiculo={f.sinVehiculo}
                alVerSinVehiculo={() => cambiar("sinVehiculo", "mostrar")}
                tipos={f.tipos}
                identificacion={soloSeguimiento ? "ALL" : f.identificacion}
                resultado={soloSeguimiento ? "ALL" : f.resultado}
                sentido={soloSeguimiento ? "ALL" : f.sentido}
                version={version}
                vista={vista}
                vision={soloSeguimiento ? [] : f.vision}
                chapa={f.chapa}
                merodeo={f.merodeo && !soloSeguimiento ? chapasMerodeo : undefined}
                color={soloSeguimiento ? "ALL" : f.color}
                tipoVeh={soloSeguimiento ? "ALL" : f.tipoVeh}
                camaras={f.camaras}
                areas={f.areas} filtroArea={filtroArea}
                onMerodeo={setChapasMerodeo}
                onResumen={setResumen}
                onCargado={alCargar}
                omnivision={conOmni}
                grabador={conGrabador && !!(foto ? grabadorPuede?.imagen : grabadorPuede?.texto)}
                foto={foto ? { blob: foto.blob, objeto: foto.objeto } : null}
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
