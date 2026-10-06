"use client";

import { useState } from "react";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Calendar as CalendarIcon, Download, Loader2, FileSpreadsheet } from "lucide-react";
import { getAccessEvents, getReporteComplementario } from "@/app/actions/history";
import { getReportBranding } from "@/app/actions/settings";
import ExcelJS from "exceljs";
import { fecha, horaSeg, fechaHora } from "@/lib/fechas";
import { getImagePath } from "@/lib/image-path";
import { metodoDeLectura } from "@/lib/lectura-metodo";

/**
 * `details` es un texto "Clave: valor, Clave: valor" que escribe server.js. Antes iba
 * entero a una columna, con PlateRect y PlateCrop adentro: ilegible, y la marca o el
 * color no se podían filtrar. Se abre en columnas y lo que queda sin clave conocida va a
 * "Detalles". Lo que la cámara no supo ("Unknown") queda vacío, no "Unknown".
 */
function metaDeDetalles(details: string | null | undefined) {
    const out = { marca: "", modelo: "", color: "", tipo: "", resto: "" };
    const resto: string[] = [];
    String(details || "").split(",").forEach((p) => {
        const i = p.indexOf(":");
        const k = i > 0 ? p.slice(0, i).trim().toLowerCase() : "";
        const v = i > 0 ? p.slice(i + 1).trim() : p.trim();
        const limpio = /^unknown$/i.test(v) ? "" : v;
        if (k === "marca") out.marca = limpio.replace(/\s*UNKNOWN\s*/gi, "").trim();
        else if (k === "modelo") out.modelo = limpio;
        else if (k === "color") out.color = limpio;
        else if (k === "tipo") out.tipo = /^vehicle$/i.test(limpio) ? "" : limpio;
        else if (["platerect", "platecrop", "source", "metodo", "confianza", "lecturas"].includes(k)) return;
        else if (v) resto.push(p.trim());
    });
    out.resto = resto.join(", ");
    return out;
}
import { sileo as toast } from "sileo";

interface ExportHistoryDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    filters?: {
        search?: string;
        decision?: "ALL" | "GRANT" | "DENY";
        type?: "ALL" | "PLATE" | "FACE" | "TAG";
        direction?: "ALL" | "ENTRY" | "EXIT";
    }
}

export function ExportHistoryDialog({ open, onOpenChange, filters }: ExportHistoryDialogProps) {
    const [startDate, setStartDate] = useState(new Date().toISOString().split('T')[0]);
    const [endDate, setEndDate] = useState(new Date().toISOString().split('T')[0]);
    const [isExporting, setIsExporting] = useState(false);

    const handleExport = async () => {
        setIsExporting(true);
        try {
            let rb: any = {};
            try { rb = await getReportBranding(); } catch {}
            const toARGB = (hex: string, fb: string) => { const h = (hex || "").replace("#", ""); return /^[0-9a-fA-F]{6}$/.test(h) ? ("FF" + h.toUpperCase()) : fb; };
            const cHeader = toARGB(rb?.tableHeader, "FFC52828");
            const cStripe = toARGB(rb?.tableStripe, "FFF9FAFB");
            const cPrimary = toARGB(rb?.primary, "FF6366F1");
            const repCompany = (rb?.company || "OmniAccess").toUpperCase();
            const fromDate = new Date(startDate + "T00:00:00");
            const toDate = new Date(endDate + "T23:59:59");

            const [response, extra] = await Promise.all([
                getAccessEvents({
                    from: fromDate, to: toDate,
                    search: filters?.search, decision: filters?.decision, type: filters?.type, direction: filters?.direction,
                    take: 100000, skip: 0, omitEnrichment: true,
                }),
                getReporteComplementario(fromDate, toDate),
            ]);
            const events = response.events;

            const workbook = new ExcelJS.Workbook();
            workbook.creator = repCompany;
            workbook.created = new Date();

            /*
             * Cada pestaña es una tabla: cabecera en la fila 1, autofiltro sobre toda la
             * tabla y la fila fija al desplazarse. Antes la tabla de accesos arrancaba en
             * la fila 13, debajo de un encabezado de texto, y el autofiltro de Excel
             * funciona mal con eso (la "tabla" incluía el resumen). El encabezado y las
             * cifras del periodo van ahora en su propia pestaña, "Resumen".
             */
            const pintarCabecera = (ws: ExcelJS.Worksheet, titulos: string[]) => {
                const h = ws.addRow(titulos);
                h.font = { bold: true, color: { argb: "FFFFFFFF" } };
                h.fill = { type: "pattern", pattern: "solid", fgColor: { argb: cHeader } };
                h.alignment = { vertical: "middle", horizontal: "center" };
                h.height = 22;
                ws.views = [{ state: "frozen", ySplit: 1 }];
            };
            const cerrarTabla = (ws: ExcelJS.Worksheet, columnas: number, centradas: string[] = []) => {
                const ultima = Math.max(ws.rowCount, 1);
                ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: ultima, column: columnas } };
                ws.eachRow((row, n) => {
                    if (n === 1) return;
                    if (n % 2 === 0) row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: cStripe } };
                    row.eachCell((cell) => { cell.border = { top: { style: "thin", color: { argb: "FFE5E7EB" } }, left: { style: "thin", color: { argb: "FFE5E7EB" } }, bottom: { style: "thin", color: { argb: "FFE5E7EB" } }, right: { style: "thin", color: { argb: "FFE5E7EB" } } }; });
                    centradas.forEach((k) => { row.getCell(k).alignment = { horizontal: "center", vertical: "middle" }; });
                });
            };
            const colorDecision = (cell: ExcelJS.Cell, decision: string) => {
                cell.font = { bold: true, color: { argb: decision === "GRANT" ? "FF059669" : decision === "DENY" ? "FFDC2626" : "FFD97706" } };
            };

            // ── Resumen ──────────────────────────────────────────────────────────────
            const resumen = workbook.addWorksheet("Resumen");
            resumen.columns = [{ width: 34 }, { width: 18 }];
            resumen.addRow([`REPORTE DE HISTORIAL - ${repCompany}`]).font = { bold: true, size: 14 };
            resumen.addRow([`Generado el ${fechaHora(new Date())}`]);
            resumen.addRow([`Periodo: ${startDate} a ${endDate}`]);
            const filterTerms: string[] = [];
            if (filters?.search) filterTerms.push(`Búsqueda: "${filters.search}"`);
            if (filters?.type && filters.type !== "ALL") filterTerms.push(`Tipo: ${filters.type}`);
            if (filters?.decision && filters.decision !== "ALL") filterTerms.push(`Resultado: ${filters.decision}`);
            if (filters?.direction && filters.direction !== "ALL") filterTerms.push(`Sentido: ${filters.direction}`);
            if (filterTerms.length) resumen.addRow([`Filtros activos (sólo en Accesos): ${filterTerms.join(" | ")}`]);
            resumen.addRow([]);
            const cuenta = (f: (e: any) => boolean) => events.filter(f).length;
            const filasResumen: [string, number][] = [
                ["Accesos en el periodo", events.length],
                ["Entradas", cuenta((e) => e.direction === "ENTRY")],
                ["Salidas", cuenta((e) => e.direction === "EXIT")],
                ["Permitidos", cuenta((e) => e.decision === "GRANT")],
                ["Denegados", cuenta((e) => e.decision === "DENY")],
                ["Sin decisión", cuenta((e) => e.decision !== "GRANT" && e.decision !== "DENY")],
                ["LPR (matrícula)", cuenta((e) => e.accessType === "PLATE")],
                ["Facial", cuenta((e) => e.accessType === "FACE")],
                ["TAG / RFID", cuenta((e) => e.accessType === "TAG")],
                ["Detecciones de intrusión", extra.detecciones.length],
                ["Consultas al bot de WhatsApp", extra.charlas.length],
                ["Invitaciones creadas", extra.invitaciones.length],
                ["Invitados", extra.invitaciones.reduce((n, i) => n + i.guests.length, 0)],
            ];
            const tit = resumen.addRow(["Cifras del periodo", ""]); tit.font = { bold: true, size: 12, color: { argb: cPrimary } };
            filasResumen.forEach(([k, v]) => { const r = resumen.addRow([k, v]); r.getCell(2).alignment = { horizontal: "right" }; r.getCell(2).numFmt = "#,##0"; });
            resumen.addRow([]);
            resumen.addRow(["Pestañas: Accesos · Intrusiones · Bot WhatsApp · Invitados · Buscar. Cada tabla tiene filtros en la cabecera (la flecha de cada columna)."]).font = { italic: true, color: { argb: "FF6B7280" } };

            // ── Accesos ──────────────────────────────────────────────────────────────
            const ws = workbook.addWorksheet("Accesos");
            ws.columns = [
                { key: "date", width: 12 }, { key: "time", width: 10 }, { key: "plate", width: 12 }, { key: "type", width: 9 },
                { key: "direction", width: 10 }, { key: "decision", width: 12 }, { key: "user", width: 28 }, { key: "unit", width: 16 },
                { key: "device", width: 22 }, { key: "metodo", width: 13 }, { key: "confianza", width: 11 },
                { key: "marca", width: 14 }, { key: "modelo", width: 14 }, { key: "color", width: 10 }, { key: "vtipo", width: 12 },
                { key: "foto", width: 44 }, { key: "details", width: 40 }, { key: "id", width: 26 },
            ];
            pintarCabecera(ws, ["Fecha", "Hora", "Matrícula", "Tipo", "Sentido", "Resultado", "Sujeto / Residente", "Unidad", "Punto de acceso", "Método", "Confianza", "Marca", "Modelo", "Color", "Tipo vehículo", "Foto", "Detalles", "ID de evento"]);
            events.forEach((e: any) => {
                const ts = new Date(e.timestamp);
                const meta = metaDeDetalles(e.details);
                const lectura = metodoDeLectura(e.details);
                const row = ws.addRow({
                    date: fecha(ts), time: horaSeg(ts),
                    plate: e.plateDetected || "",
                    type: e.accessType === "PLATE" ? "LPR" : e.accessType === "FACE" ? "Facial" : e.accessType === "TAG" ? "TAG" : (e.accessType || ""),
                    // El sentido es el DEL EVENTO: antes se tomaba el de la cámara al momento
                    // de exportar, y una cámara que cambió de sentido reescribía su historia.
                    direction: e.direction === "EXIT" ? "Salida" : "Entrada",
                    // Antes todo lo que no era GRANT salía "DENEGADO", incluso lo que no tenía decisión.
                    decision: e.decision === "GRANT" ? "PERMITIDO" : e.decision === "DENY" ? "DENEGADO" : "SIN DECISIÓN",
                    user: e.user?.name || "",
                    unit: e.user?.unit?.name || "",
                    device: e.device?.name || "",
                    metodo: lectura.metodo || "", confianza: lectura.confianza != null ? lectura.confianza / 100 : "",
                    marca: meta.marca, modelo: meta.modelo, color: meta.color, vtipo: meta.tipo,
                    foto: e.snapshotPath ? `${window.location.origin}${getImagePath(e.snapshotPath) || ""}` : "",
                    details: meta.resto,
                    id: e.id,
                });
                row.getCell("confianza").numFmt = "0%";
                colorDecision(row.getCell("decision"), e.decision);
                if (e.snapshotPath) { const c = row.getCell("foto"); c.value = { text: "ver foto", hyperlink: String(c.value) }; c.font = { color: { argb: "FF2563EB" }, underline: true }; }
            });
            cerrarTabla(ws, 18, ["date", "time", "plate", "type", "direction", "decision", "metodo", "confianza"]);

            // ── Intrusiones ──────────────────────────────────────────────────────────
            const wi = workbook.addWorksheet("Intrusiones");
            wi.columns = [{ key: "date", width: 12 }, { key: "time", width: 10 }, { key: "tipo", width: 18 }, { key: "clase", width: 12 }, { key: "device", width: 24 }, { key: "estado", width: 14 }, { key: "ack", width: 18 }, { key: "foto", width: 44 }, { key: "details", width: 36 }, { key: "id", width: 26 }];
            pintarCabecera(wi, ["Fecha", "Hora", "Evento", "Qué", "Cámara", "Atendida", "Atendida el", "Foto", "Detalles", "ID"]);
            const TIPO_DET: Record<string, string> = { LINECROSS: "Cruce de línea", INTRUSION: "Intrusión en zona", REGION_ENTER: "Entró a la zona", REGION_EXIT: "Salió de la zona", MOTION: "Movimiento", OTHER: "Otro" };
            const CLASE: Record<string, string> = { human: "Persona", vehicle: "Vehículo" };
            extra.detecciones.forEach((d) => {
                const ts = new Date(d.timestamp);
                const row = wi.addRow({
                    date: fecha(ts), time: horaSeg(ts), tipo: TIPO_DET[d.type] || d.type, clase: (d.label && CLASE[d.label]) || d.label || "",
                    device: d.device || "", estado: d.acknowledged ? (d.ackKind || "Sí") : "No", ack: d.ackAt ? fechaHora(new Date(d.ackAt)) : "",
                    foto: d.snapshotPath ? `${window.location.origin}${getImagePath(d.snapshotPath) || ""}` : "", details: d.details || "", id: d.id,
                });
                if (d.snapshotPath) { const c = row.getCell("foto"); c.value = { text: "ver foto", hyperlink: String(c.value) }; c.font = { color: { argb: "FF2563EB" }, underline: true }; }
            });
            cerrarTabla(wi, 10, ["date", "time", "estado"]);

            // ── Bot WhatsApp ─────────────────────────────────────────────────────────
            const wb = workbook.addWorksheet("Bot WhatsApp");
            wb.columns = [{ key: "date", width: 12 }, { key: "time", width: 10 }, { key: "quien", width: 26 }, { key: "rol", width: 12 }, { key: "numero", width: 16 }, { key: "pedido", width: 36 }, { key: "estado", width: 11 }, { key: "respuesta", width: 60 }];
            pintarCabecera(wb, ["Fecha", "Hora", "Quién", "Rol", "Número", "Lo que pidió", "Estado", "Respuesta"]);
            const ROL: Record<string, string> = { RESIDENT: "Residente", ADMIN: "Admin", STAFF: "Personal", SECURITY: "Seguridad", OPERATOR: "Operador" };
            extra.charlas.forEach((c) => {
                const ts = new Date(c.timestamp);
                const row = wb.addRow({ date: fecha(ts), time: horaSeg(ts), quien: c.quien || "", rol: c.rol ? (ROL[c.rol] || c.rol) : "", numero: c.fromNumber, pedido: c.messageBody, estado: c.status === "OK" ? "Atendido" : c.status === "IGNORADO" ? "Ignorado" : c.status, respuesta: (c.responseDetails || "").replace(/\*/g, "") });
                row.getCell("respuesta").alignment = { wrapText: true, vertical: "top" };
            });
            cerrarTabla(wb, 8, ["date", "time", "estado"]);

            // ── Invitados ────────────────────────────────────────────────────────────
            // Una fila por invitado (y una por invitación sin invitados cargados), con las
            // entradas registradas al final: es como se lee en el panel y como se busca.
            const wg = workbook.addWorksheet("Invitados");
            wg.columns = [{ key: "creada", width: 16 }, { key: "anfitrion", width: 24 }, { key: "lote", width: 14 }, { key: "titulo", width: 22 }, { key: "clase", width: 10 }, { key: "desde", width: 16 }, { key: "hasta", width: 16 }, { key: "estado", width: 11 }, { key: "via", width: 11 }, { key: "invitado", width: 24 }, { key: "doc", width: 12 }, { key: "matriculas", width: 16 }, { key: "ingresos", width: 10 }, { key: "primer", width: 16 }, { key: "ultimo", width: 16 }, { key: "id", width: 26 }];
            pintarCabecera(wg, ["Creada", "Anfitrión", "Lote / Unidad", "Título", "Clase", "Válida desde", "Válida hasta", "Estado", "Creada por", "Invitado", "Documento", "Matrículas", "Ingresos", "Primer ingreso", "Último ingreso", "ID invitación"]);
            const ESTADO_INV: Record<string, string> = { ACTIVE: "Activa", EXPIRED: "Vencida", REVOKED: "Anulada" };
            const VIA: Record<string, string> = { WHATSAPP: "WhatsApp", PORTAL: "Portal", GUARD: "Garita" };
            extra.invitaciones.forEach((i) => {
                const base = { creada: fechaHora(new Date(i.createdAt)), anfitrion: i.hostName, lote: i.hostLabel, titulo: i.title, clase: i.kind === "EVENT" ? "Evento" : "Visita", desde: fechaHora(new Date(i.validFrom)), hasta: fechaHora(new Date(i.validTo)), estado: ESTADO_INV[i.status] || i.status, via: VIA[i.createdVia] || i.createdVia, id: i.id };
                if (i.guests.length === 0) { wg.addRow({ ...base, invitado: "(sin invitados cargados)" }); return; }
                i.guests.forEach((g) => {
                    const ing = g.entradas.filter((e) => e.direction === "ENTRY");
                    wg.addRow({ ...base, invitado: g.name || "", doc: g.doc || "", matriculas: g.plates.join(", "), ingresos: ing.length, primer: ing[0] ? fechaHora(new Date(ing[0].timestamp)) : "", ultimo: ing.length ? fechaHora(new Date(ing[ing.length - 1].timestamp)) : "" });
                });
            });
            cerrarTabla(wg, 16, ["creada", "clase", "estado", "via", "ingresos"]);

            // ── Buscar ───────────────────────────────────────────────────────────────
            // Un buscador adentro del Excel: se escribe en B2 y la tabla de abajo muestra
            // los accesos cuya matrícula, sujeto, unidad o cámara contienen ese texto. Usa
            // FILTER (Excel 2021 / Microsoft 365, LibreOffice 24.8+); en un Excel más viejo
            // la celda muestra #NAME? y la nota de al lado dice qué usar en su lugar. Va
            // como fórmula de matriz sobre un rango fijo —lo único que ExcelJS sabe
            // escribir—, así que las filas que sobran se dejan en blanco con IFERROR.
            const wq = workbook.addWorksheet("Buscar");
            wq.columns = [{ width: 12 }, { width: 10 }, { width: 12 }, { width: 9 }, { width: 10 }, { width: 12 }, { width: 28 }, { width: 16 }, { width: 22 }];
            wq.getCell("A1").value = "Buscar en Accesos"; wq.getCell("A1").font = { bold: true, size: 13 };
            wq.getCell("A2").value = "Texto:"; wq.getCell("A2").font = { bold: true };
            wq.getCell("B2").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFEF3C7" } };
            wq.getCell("B2").border = { top: { style: "medium" }, left: { style: "medium" }, bottom: { style: "medium" }, right: { style: "medium" } };
            wq.getCell("C2").value = "← escribí una matrícula, un nombre, una unidad o una cámara (necesita Excel 2021 / 365; si ves #NAME?, usá los filtros de la pestaña Accesos)";
            wq.getCell("C2").font = { italic: true, color: { argb: "FF6B7280" } };
            const cab = wq.getRow(4);
            cab.values = ["Fecha", "Hora", "Matrícula", "Tipo", "Sentido", "Resultado", "Sujeto / Residente", "Unidad", "Punto de acceso"];
            cab.font = { bold: true, color: { argb: "FFFFFFFF" } }; cab.fill = { type: "pattern", pattern: "solid", fgColor: { argb: cHeader } };
            const n = Math.max(events.length + 1, 2);
            const rango = (col: string) => `Accesos!$${col}$2:$${col}$${n}`;
            const texto = (col: string) => `ISNUMBER(SEARCH($B$2,${rango(col)}))`;
            const filtro = `_xlfn._xlws.FILTER(Accesos!$A$2:$I$${n},(${texto("C")})+(${texto("G")})+(${texto("H")})+(${texto("I")}),"Sin resultados")`;
            wq.getCell("A5").value = { formula: `IF($B$2="","",IFERROR(${filtro},""))`, shareType: "array", ref: `A5:I${n + 4}`, result: "" } as any;
            workbook.calcProperties.fullCalcOnLoad = true;

            const buffer = await workbook.xlsx.writeBuffer();
            const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = url;
            link.download = `Historial_OmniAccess_${startDate}_a_${endDate}.xlsx`;
            link.click();
            URL.revokeObjectURL(url);

            onOpenChange(false);
        } catch (error) {
            console.error("Export error:", error);
            toast.error({ title: "No se pudieron exportar los datos", description: (error as any)?.message });
        } finally {
            setIsExporting(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[425px] bg-card border-border text-foreground">
                <DialogHeader>
                    <div className="mx-auto w-12 h-12 bg-red-500/10 rounded-full flex items-center justify-center mb-4 border border-red-500/20">
                        <FileSpreadsheet className="text-red-500" size={24} />
                    </div>
                    <DialogTitle className="text-xl font-bold text-center uppercase tracking-tight">Exportar Reporte</DialogTitle>
                    <DialogDescription className="text-muted-foreground text-center text-xs font-medium">
                        Selecciona el rango de fechas para generar el reporte de accesos en formato Excel.
                    </DialogDescription>
                </DialogHeader>

                <div className="grid gap-6 py-4">
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label className="text-[10px] uppercase font-bold text-muted-foreground tracking-widest pl-1">Desde</Label>
                            <div className="relative">
                                <CalendarIcon className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={14} />
                                <input
                                    type="date"
                                    value={startDate}
                                    onChange={(e) => setStartDate(e.target.value)}
                                    className="w-full bg-background border border-border rounded-lg h-10 pl-9 text-xs font-bold text-foreground focus:outline-none focus:ring-2 focus:ring-red-500/20 uppercase appearance-none"
                                />
                            </div>
                        </div>
                        <div className="space-y-2">
                            <Label className="text-[10px] uppercase font-bold text-muted-foreground tracking-widest pl-1">Hasta</Label>
                            <div className="relative">
                                <CalendarIcon className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={14} />
                                <input
                                    type="date"
                                    value={endDate}
                                    onChange={(e) => setEndDate(e.target.value)}
                                    className="w-full bg-background border border-border rounded-lg h-10 pl-9 text-xs font-bold text-foreground focus:outline-none focus:ring-2 focus:ring-red-500/20 uppercase appearance-none"
                                />
                            </div>
                        </div>
                    </div>

                    <div className="p-3 bg-foreground/10 rounded-lg border border-border">
                        <p className="text-[10px] text-muted-foreground leading-relaxed italic text-center">
                            El archivo incluirá todos los eventos registrados dentro del periodo seleccionado, incluyendo detalles de vehículos y residentes.
                        </p>
                    </div>
                </div>

                <DialogFooter className="sm:justify-center">
                    <Button
                        type="button"
                        variant="ghost"
                        onClick={() => onOpenChange(false)}
                        className="text-xs font-bold uppercase tracking-widest text-muted-foreground hover:text-foreground"
                    >
                        Cancelar
                    </Button>
                    <Button
                        onClick={handleExport}
                        disabled={isExporting}
                        className="bg-red-600 hover:bg-red-500 text-foreground text-xs font-bold uppercase tracking-widest h-10 px-8 shadow-lg shadow-red-900/20"
                    >
                        {isExporting ? (
                            <>
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                Generando...
                            </>
                        ) : (
                            <>
                                <Download className="mr-2 h-4 w-4" />
                                Descargar (.xlsx)
                            </>
                        )}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
