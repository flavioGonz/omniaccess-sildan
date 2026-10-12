"use client";

import { useEffect, useMemo, useState } from "react";
import { Tooltip } from "react-tooltip";
import {
    Download, Loader2, FileSpreadsheet, FileText, FileJson, CalendarRange, Filter, Search, Car, ScanFace, CreditCard,
    CheckCircle2, XCircle, ArrowDownLeft, ArrowUpRight, Camera, Columns3, Check, Layers, AlertTriangle,
} from "lucide-react";
import { Cajon, CajonContenido } from "@/components/ui/cajon";
import { Button } from "@/components/ui/button";
import { Campo, Bloque, Etiqueta, Heroe, chipHeroe } from "@/components/ui/cajon-campos";
import { RangoFechaHora, RANGO_VACIO, rotuloRango, type Rango } from "@/components/history/RangoFechaHora";
import { getAccessEvents } from "@/app/actions/history";
import { getReportBranding } from "@/app/actions/settings";
import { parseVehicleMeta } from "@/lib/vehicle-details";
import { cn } from "@/lib/utils";
import { sileo as toast } from "sileo";
import ExcelJS from "exceljs";

/**
 * Exportar el historial, en un cajón: qué período (el mismo selector de rango del historial),
 * qué eventos (tipo, resultado, sentido, búsqueda, cámaras), en qué formato (Excel con la marca
 * de la empresa, CSV o JSON reimportable) y con qué columnas. Arriba se ve cuántos eventos van
 * a salir antes de generar.
 */
type Formato = "xlsx" | "csv" | "json";
type Col = { k: string; t: string; ancho: number; v: (e: any) => any };
const TT = "tt-exportar";
const LIMITE = 100000;

const COLUMNAS: Col[] = [
    { k: "fecha", t: "Fecha", ancho: 13, v: (e) => new Date(e.timestamp).toLocaleDateString("es-UY") },
    { k: "hora", t: "Hora", ancho: 11, v: (e) => new Date(e.timestamp).toLocaleTimeString("es-UY") },
    { k: "matricula", t: "Matrícula", ancho: 13, v: (e) => e.plateDetected || "" },
    { k: "tipo", t: "Tipo", ancho: 10, v: (e) => (e.accessType === "PLATE" ? "LPR" : e.accessType === "FACE" ? "Facial" : "RFID") },
    { k: "persona", t: "Persona", ancho: 28, v: (e) => e.user?.name || "Sin registro" },
    { k: "unidad", t: "Lote / unidad", ancho: 16, v: (e) => e.user?.unit?.name || "" },
    { k: "camara", t: "Punto de acceso", ancho: 24, v: (e) => e.device?.name || "" },
    { k: "sentido", t: "Sentido", ancho: 10, v: (e) => (e.direction === "EXIT" ? "Salida" : "Entrada") },
    { k: "resultado", t: "Resultado", ancho: 12, v: (e) => (e.decision === "GRANT" ? "PERMITIDO" : "DENEGADO") },
    { k: "vehiculo", t: "Vehículo", ancho: 24, v: (e) => { const m: any = parseVehicleMeta(e.details); return [m.brand, m.model, m.typeLabel, m.color].filter(Boolean).join(" · "); } },
    { k: "detalles", t: "Detalles", ancho: 40, v: (e) => e.details || "" },
    { k: "id", t: "ID de evento", ancho: 26, v: (e) => e.id },
];
const POR_DEFECTO = new Set(["fecha", "hora", "matricula", "tipo", "persona", "unidad", "camara", "sentido", "resultado", "vehiculo"]);
const hoy = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

interface ExportHistoryDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    filters?: { search?: string; decision?: "ALL" | "GRANT" | "DENY"; type?: "ALL" | "PLATE" | "FACE" | "TAG"; direction?: "ALL" | "ENTRY" | "EXIT" };
    /** El rango que está mirando el historial: se propone igual. */
    rango?: Rango;
    /** Cámaras conocidas y las que estaban elegidas en el historial. */
    camaras?: string[];
    camarasElegidas?: Set<string>;
}

export function ExportHistoryDialog({ open, onOpenChange, filters, rango: rangoInicial, camaras = [], camarasElegidas }: ExportHistoryDialogProps) {
    const [rango, setRango] = useState<Rango>(RANGO_VACIO);
    const [busqueda, setBusqueda] = useState("");
    const [tipo, setTipo] = useState<"ALL" | "PLATE" | "FACE" | "TAG">("ALL");
    const [decision, setDecision] = useState<"ALL" | "GRANT" | "DENY">("ALL");
    const [sentido, setSentido] = useState<"ALL" | "ENTRY" | "EXIT">("ALL");
    const [cams, setCams] = useState<Set<string>>(new Set());
    const [formato, setFormato] = useState<Formato>("xlsx");
    const [cols, setCols] = useState<Set<string>>(new Set(POR_DEFECTO));
    const [cuenta, setCuenta] = useState<number | null>(null);
    const [contando, setContando] = useState(false);
    const [generando, setGenerando] = useState<string | null>(null);

    // Al abrir, propone lo que el historial está mostrando (o el día de hoy).
    useEffect(() => {
        if (!open) return;
        setRango(rangoInicial && (rangoInicial.desde || rangoInicial.hasta) ? rangoInicial : { desde: hoy(), hasta: hoy(), horaDesde: "", horaHasta: "" });
        setBusqueda(filters?.search || ""); setTipo(filters?.type || "ALL"); setDecision(filters?.decision || "ALL"); setSentido(filters?.direction || "ALL");
        setCams(new Set(camarasElegidas || []));
    }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

    const desde = rango.desde ? new Date(`${rango.desde}T${rango.horaDesde || "00:00"}:00`) : undefined;
    const hasta = rango.hasta ? new Date(`${rango.hasta}T${rango.horaHasta || "23:59"}:59`) : undefined;
    const consulta = useMemo(() => ({ from: desde, to: hasta, search: busqueda || undefined, decision, type: tipo, direction: sentido }),
        [rango, busqueda, decision, tipo, sentido]); // eslint-disable-line react-hooks/exhaustive-deps

    // Cuántos van a salir (sin cámaras: ese filtro se aplica al generar).
    useEffect(() => {
        if (!open) return;
        let vivo = true; setContando(true);
        const t = setTimeout(() => {
            getAccessEvents({ ...consulta, take: 1, skip: 0, omitEnrichment: true, conTotal: true } as any)
                .then((r: any) => vivo && setCuenta(r?.total ?? null)).catch(() => vivo && setCuenta(null)).finally(() => vivo && setContando(false));
        }, 400);
        return () => { vivo = false; clearTimeout(t); };
    }, [open, consulta]);

    const columnas = COLUMNAS.filter((c) => cols.has(c.k));
    const nombreBase = `Historial_${rango.desde || "inicio"}_a_${rango.hasta || hoy()}`;
    const bajar = (blob: Blob, nombre: string) => { const u = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = u; a.download = nombre; a.click(); URL.revokeObjectURL(u); };

    const generar = async () => {
        if (!columnas.length && formato !== "json") { toast.error({ title: "Elegí al menos una columna" }); return; }
        setGenerando("Leyendo eventos…");
        try {
            const r: any = await getAccessEvents({ ...consulta, take: LIMITE, skip: 0, omitEnrichment: true, conTotal: false } as any);
            let eventos: any[] = r.events || [];
            if (cams.size) eventos = eventos.filter((e) => cams.has(e.device?.name));
            if (!eventos.length) { toast.error({ title: "No hay eventos con esos filtros" }); return; }
            setGenerando(`Armando ${eventos.length.toLocaleString("es-UY")} filas…`);

            if (formato === "json") {
                const evs = eventos.map((e) => ({ id: e.id, timestamp: e.timestamp, createdAt: e.createdAt, accessType: e.accessType, credentialId: e.credentialId, decision: e.decision, direction: e.direction, plateDetected: e.plateDetected, plateNumber: e.plateNumber, location: e.location, snapshotPath: e.snapshotPath, imagePath: e.imagePath, details: e.details, deviceName: e.device?.name || null }));
                bajar(new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), count: evs.length, events: evs }, null, 2)], { type: "application/json" }), `${nombreBase}.json`);
            } else if (formato === "csv") {
                const esc = (x: any) => { const s = String(x ?? ""); return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
                const lineas = [columnas.map((c) => esc(c.t)).join(";"), ...eventos.map((e) => columnas.map((c) => esc(c.v(e))).join(";"))];
                bajar(new Blob(["﻿" + lineas.join("\n")], { type: "text/csv;charset=utf-8" }), `${nombreBase}.csv`);
            } else {
                await excel(eventos);
            }
            toast.success({ title: "Reporte listo", description: `${eventos.length.toLocaleString("es-UY")} eventos · ${formato.toUpperCase()}` });
            onOpenChange(false);
        } catch (e: any) {
            console.error(e); toast.error({ title: "No se pudo exportar", description: e?.message });
        } finally { setGenerando(null); }
    };

    const excel = async (eventos: any[]) => {
        let rb: any = {};
        try { rb = await getReportBranding(); } catch { }
        const argb = (hex: string, fb: string) => { const h = (hex || "").replace("#", ""); return /^[0-9a-fA-F]{6}$/.test(h) ? "FF" + h.toUpperCase() : fb; };
        const cHeader = argb(rb?.tableHeader, "FFC52828"), cStripe = argb(rb?.tableStripe, "FFF9FAFB"), cPrimary = argb(rb?.primary, "FF6366F1");
        const wb = new ExcelJS.Workbook();
        const ws = wb.addWorksheet("Historial de accesos");
        ws.addRow([`REPORTE DE HISTORIAL - ${(rb?.company || "OmniAccess").toUpperCase()}`]).font = { bold: true, size: 14 };
        ws.addRow([`Generado: ${new Date().toLocaleString("es-UY")}`]);
        ws.addRow([`Período: ${rotuloRango(rango)}`]);
        const f: string[] = [];
        if (busqueda) f.push(`Búsqueda: "${busqueda}"`);
        if (tipo !== "ALL") f.push(`Tipo: ${tipo === "PLATE" ? "LPR" : tipo === "FACE" ? "Facial" : "RFID"}`);
        if (decision !== "ALL") f.push(`Resultado: ${decision === "GRANT" ? "Permitidos" : "Denegados"}`);
        if (sentido !== "ALL") f.push(`Sentido: ${sentido === "ENTRY" ? "Entrada" : "Salida"}`);
        if (cams.size) f.push(`Cámaras: ${[...cams].join(", ")}`);
        if (f.length) ws.addRow([`Filtros: ${f.join(" | ")}`]);
        ws.addRow([]);
        const n = (p: (e: any) => boolean) => eventos.filter(p).length;
        ws.addRow(["RESUMEN DEL PERÍODO"]).font = { bold: true, size: 12, color: { argb: cPrimary } };
        ws.addRow([`Eventos: ${eventos.length}`]);
        ws.addRow([`Entradas: ${n((e) => e.direction === "ENTRY")} | Salidas: ${n((e) => e.direction === "EXIT")}`]);
        ws.addRow([`Permitidos: ${n((e) => e.decision === "GRANT")} | Denegados: ${n((e) => e.decision === "DENY")}`]);
        ws.addRow([]);
        ws.columns = columnas.map((c) => ({ key: c.k, width: c.ancho }));
        const cab = ws.addRow(columnas.map((c) => c.t));
        cab.font = { bold: true, color: { argb: "FFFFFFFF" } };
        cab.fill = { type: "pattern", pattern: "solid", fgColor: { argb: cHeader } };
        cab.alignment = { vertical: "middle", horizontal: "center" }; cab.height = 24;
        eventos.forEach((e, i) => {
            const fila = ws.addRow(Object.fromEntries(columnas.map((c) => [c.k, c.v(e)])));
            fila.height = 19; fila.alignment = { vertical: "middle" };
            if (i % 2 === 0) fila.fill = { type: "pattern", pattern: "solid", fgColor: { argb: cStripe } };
            if (cols.has("resultado")) fila.getCell("resultado").font = { bold: true, color: { argb: e.decision === "GRANT" ? "FF059669" : "FFDC2626" } };
        });
        const ultima = String.fromCharCode(64 + Math.min(columnas.length, 26));
        ws.autoFilter = `A${cab.number}:${ultima}${cab.number}`;
        ws.views = [{ state: "frozen", ySplit: cab.number }];
        const buf = await wb.xlsx.writeBuffer();
        bajar(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `${nombreBase}.xlsx`);
    };

    const alternarCol = (k: string) => setCols((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });
    const excede = (cuenta ?? 0) > LIMITE;

    return (
        <Cajon open={open} onOpenChange={(v) => !generando && onOpenChange(v)}>
            <CajonContenido ancho="intermedio" tituloOculto titulo="Exportar reporte" descripcion="Historial de accesos en Excel, CSV o JSON"
                pie={<div className="flex items-center gap-2 w-full">
                    <span className="flex-1 text-[12px] text-muted-foreground truncate">{generando || (cuenta != null ? `${cuenta.toLocaleString("es-UY")} eventos con estos filtros${cams.size ? " (antes de filtrar cámaras)" : ""}` : "")}</span>
                    <Button variant="outline" onClick={() => onOpenChange(false)} disabled={!!generando}>Cancelar</Button>
                    <Button onClick={generar} disabled={!!generando || cuenta === 0} className="gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white">
                        {generando ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />} Descargar .{formato}
                    </Button>
                </div>}>
                <Heroe titulo="Exportar reporte" subtitulo="Historial de accesos con los filtros que elijas"
                    fondo="bg-[radial-gradient(120%_120%_at_0%_0%,#065f46_0%,#0b2a22_55%,#000_100%)]"
                    chips={<>
                        <span className={chipHeroe}><CalendarRange size={11} /> {rotuloRango(rango)}</span>
                        <span className={chipHeroe}><Columns3 size={11} /> {formato === "json" ? "todos los campos" : `${columnas.length} columnas`}</span>
                    </>}>
                    <div className="flex items-center gap-3 mt-1">
                        <span className="h-12 w-12 rounded-xl bg-emerald-500/25 ring-1 ring-white/15 grid place-items-center"><FileSpreadsheet size={24} className="text-emerald-200" /></span>
                        <div className="flex-1 rounded-xl bg-white/10 ring-1 ring-white/10 px-3 py-2">
                            <div className="text-[10px] uppercase tracking-[0.14em] text-white/60">Eventos a exportar</div>
                            <div className="text-[24px] font-black tabular-nums leading-tight flex items-center gap-2">
                                {contando ? <Loader2 size={18} className="animate-spin text-white/70" /> : (cuenta ?? "—").toLocaleString("es-UY")}
                                {excede && <span className="text-[11px] font-semibold text-amber-300 inline-flex items-center gap-1"><AlertTriangle size={12} /> sólo los primeros {LIMITE.toLocaleString("es-UY")}</span>}
                            </div>
                        </div>
                    </div>
                </Heroe>

                <Bloque titulo="Período" icono={CalendarRange} tt={TT} ayuda="Desde y hasta, con hora. Ej.: «Ayer», «Últimos 7 días» o de 20:00 de ayer a 06:00 de hoy.">
                    <RangoFechaHora valor={rango} alCambiar={setRango} />
                </Bloque>

                <Bloque titulo="Qué eventos" icono={Filter} tt={TT} ayuda="Los mismos filtros del historial. Ya vienen como los tenías en pantalla.">
                    <Campo etiqueta="Búsqueda" icono={Search} value={busqueda} onChange={setBusqueda} placeholder="Matrícula, persona, lote o cámara. Ej.: SDE4787, G18" tt={TT}
                        ayuda="Opcional. Busca en matrícula, nombre, lote, cámara y detalles." />
                    <div>
                        <Etiqueta texto="Tipo" tt={TT} />
                        <Opciones valor={tipo} alCambiar={setTipo as any} opciones={[{ v: "ALL", l: "Todos", I: Layers }, { v: "PLATE", l: "LPR", I: Car }, { v: "FACE", l: "Rostros", I: ScanFace }, { v: "TAG", l: "RFID", I: CreditCard }]} />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <Etiqueta texto="Resultado" tt={TT} />
                            <Opciones valor={decision} alCambiar={setDecision as any} opciones={[{ v: "ALL", l: "Todos" }, { v: "GRANT", l: "Permitidos", I: CheckCircle2 }, { v: "DENY", l: "Denegados", I: XCircle }]} />
                        </div>
                        <div>
                            <Etiqueta texto="Sentido" tt={TT} />
                            <Opciones valor={sentido} alCambiar={setSentido as any} opciones={[{ v: "ALL", l: "Ambos" }, { v: "ENTRY", l: "Entrada", I: ArrowDownLeft }, { v: "EXIT", l: "Salida", I: ArrowUpRight }]} />
                        </div>
                    </div>
                    {camaras.length > 0 && (
                        <div>
                            <Etiqueta texto={`Cámaras${cams.size ? ` · ${cams.size}` : " · todas"}`} ayuda="Sin ninguna marcada salen todas. Ej.: sólo «P1 - Entrada (207)» para el reporte de una garita." tt={TT} />
                            <div className="flex flex-wrap gap-1.5">
                                {camaras.map((c) => {
                                    const on = cams.has(c); return (
                                        <button key={c} type="button" onClick={() => setCams((s) => { const n = new Set(s); on ? n.delete(c) : n.add(c); return n; })}
                                            className={cn("h-8 px-2.5 rounded-lg border text-[12px] inline-flex items-center gap-1.5 transition-colors", on ? "border-[var(--accion)] bg-[color-mix(in_oklab,var(--accion)_10%,transparent)] font-semibold" : "border-border hover:bg-accent text-muted-foreground")}>
                                            {on ? <Check size={12} /> : <Camera size={12} />} {c}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                </Bloque>

                <Bloque titulo="Formato" icono={FileSpreadsheet} tt={TT}>
                    <div className="grid grid-cols-3 gap-2">
                        {([["xlsx", FileSpreadsheet, "Excel", "Con la marca y colores del reporte, resumen y autofiltro", "text-emerald-500"],
                           ["csv", FileText, "CSV", "Texto separado por «;», abre en cualquier planilla", "text-sky-500"],
                           ["json", FileJson, "JSON", "Reimportable en otra instancia de OmniAccess", "text-amber-500"]] as const).map(([v, I, t, d, c]) => (
                            <button key={v} type="button" onClick={() => setFormato(v)}
                                className={cn("relative rounded-xl border p-3 text-left transition-colors", formato === v ? "border-[var(--accion)] bg-[color-mix(in_oklab,var(--accion)_7%,transparent)] ring-1 ring-[var(--accion)]" : "border-border hover:bg-accent/50")}>
                                {formato === v && <span className="absolute top-2 right-2 grid h-5 w-5 place-items-center rounded-full bg-[var(--accion)] text-white"><Check size={12} /></span>}
                                <I size={22} className={c} />
                                <div className="mt-1.5 text-[13px] font-bold">{t}</div>
                                <div className="text-[11px] text-muted-foreground leading-snug">{d}</div>
                            </button>
                        ))}
                    </div>
                </Bloque>

                {formato !== "json" && (
                    <Bloque titulo="Columnas" icono={Columns3} tt={TT} ayuda="Qué columnas lleva el archivo, en este orden."
                        accion={<div className="flex gap-1">
                            <button type="button" onClick={() => setCols(new Set(COLUMNAS.map((c) => c.k)))} className="h-7 px-2 rounded-md text-[11px] font-semibold border border-border hover:bg-accent">Todas</button>
                            <button type="button" onClick={() => setCols(new Set(POR_DEFECTO))} className="h-7 px-2 rounded-md text-[11px] font-semibold border border-border hover:bg-accent">Por defecto</button>
                        </div>}>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                            {COLUMNAS.map((c) => {
                                const on = cols.has(c.k); return (
                                    <label key={c.k} className={cn("flex items-center gap-2 h-9 px-2.5 rounded-lg border cursor-pointer text-[12.5px] transition-colors", on ? "border-[var(--accion)]/60 bg-[color-mix(in_oklab,var(--accion)_6%,transparent)]" : "border-border hover:bg-accent/50 text-muted-foreground")}>
                                        <input type="checkbox" checked={on} onChange={() => alternarCol(c.k)} className="h-4 w-4 accent-[var(--accion)]" />
                                        <span className="truncate">{c.t}</span>
                                    </label>
                                );
                            })}
                        </div>
                    </Bloque>
                )}
                <Tooltip id={TT} place="top" className="!max-w-[280px] !text-[12px] !rounded-lg !z-[9999]" />
            </CajonContenido>
        </Cajon>
    );
}

function Opciones({ valor, alCambiar, opciones }: { valor: string; alCambiar: (v: string) => void; opciones: { v: string; l: string; I?: any }[] }) {
    return (
        <div className="flex rounded-lg border border-border bg-background p-0.5">
            {opciones.map((o) => (
                <button key={o.v} type="button" onClick={() => alCambiar(o.v)}
                    className={cn("flex-1 h-8 px-2 rounded-md text-[12px] font-semibold inline-flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap",
                        valor === o.v ? "bg-[var(--accion)] text-white" : "text-muted-foreground hover:text-foreground hover:bg-accent")}>
                    {o.I && <o.I size={13} />}{o.l}
                </button>
            ))}
        </div>
    );
}
