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
import { getAccessEvents } from "@/app/actions/history";
import { getReportBranding } from "@/app/actions/settings";
import ExcelJS from "exceljs";
import { fecha, hora } from "@/lib/fechas";

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
            // Fetch ALL data for the period (no pagination)
            const fromDate = new Date(startDate + "T00:00:00");
            const toDate = new Date(endDate + "T23:59:59");

            const response = await getAccessEvents({
                from: fromDate,
                to: toDate,
                search: filters?.search,
                decision: filters?.decision,
                type: filters?.type,
                direction: filters?.direction,
                take: 100000, // Increased limit for full month exports
                skip: 0,
                omitEnrichment: true
            });

            const events = response.events;

            const workbook = new ExcelJS.Workbook();
            const worksheet = workbook.addWorksheet("Historial de Accesos");

            // 1. Add Filter Summary at the top
            worksheet.addRow([`REPORTE DE HISTORIAL - ${repCompany}`]).font = { bold: true, size: 14 };
            worksheet.addRow([`Generado el: ${fecha(new Date())}`]);
            worksheet.addRow([`Periodo: ${startDate} a ${endDate}`]);

            const filterTerms = [];
            if (filters?.search) filterTerms.push(`Búsqueda: "${filters.search}"`);
            if (filters?.type !== "ALL") filterTerms.push(`Tipo: ${filters?.type}`);
            if (filters?.decision !== "ALL") filterTerms.push(`Resultado: ${filters?.decision}`);
            if (filters?.direction !== "ALL") filterTerms.push(`Sentido: ${filters?.direction}`);

            if (filterTerms.length > 0) {
                worksheet.addRow([`Filtros activos: ${filterTerms.join(" | ")}`]);
            }

            worksheet.addRow([]); // Gap

            // 2. Calculate and add statistics
            const stats = {
                total: events.length,
                entradas: events.filter((e: any) => e.direction === 'ENTRY').length,
                salidas: events.filter((e: any) => e.direction === 'EXIT').length,
                permitidos: events.filter((e: any) => e.decision === 'GRANT').length,
                denegados: events.filter((e: any) => e.decision === 'DENY').length,
                lpr: events.filter((e: any) => e.accessType === 'PLATE').length,
                facial: events.filter((e: any) => e.accessType === 'FACE').length,
                tag: events.filter((e: any) => e.accessType === 'TAG').length,
            };

            worksheet.addRow(["ESTADÍSTICAS DEL PERIODO"]).font = { bold: true, size: 12, color: { argb: cPrimary } };
            worksheet.addRow([`Total de Eventos: ${stats.total}`]);
            worksheet.addRow([`Entradas: ${stats.entradas} | Salidas: ${stats.salidas}`]);
            worksheet.addRow([`Permitidos: ${stats.permitidos} | Denegados: ${stats.denegados}`]);
            worksheet.addRow([`LPR: ${stats.lpr} | Facial: ${stats.facial} | TAG/RFID: ${stats.tag}`]);

            worksheet.addRow([]); // Gap

            // Define columns (Widths and Keys only, headers added manually)
            worksheet.columns = [
                { key: "id", width: 25 },
                { key: "date", width: 15 },
                { key: "time", width: 15 },
                { key: "plate", width: 15 },
                { key: "type", width: 15 },
                { key: "user", width: 30 },
                { key: "unit", width: 20 },
                { key: "apartment", width: 15 },
                { key: "device", width: 25 },
                { key: "direction", width: 12 },
                { key: "decision", width: 15 },
                { key: "details", width: 40 },
            ];

            // Add Header Row Manually
            const headerRow = worksheet.addRow([
                "ID de Evento", "Fecha", "Hora", "Matrícula", "Tipo", "Sujeto / Residente", "Unidad", "Depto", "Punto de Acceso", "Dirección", "Resultado", "Detalles"
            ]);

            headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
            headerRow.fill = {
                type: "pattern",
                pattern: "solid",
                fgColor: { argb: cHeader }
            };
            headerRow.alignment = { vertical: "middle", horizontal: "center" };
            headerRow.height = 25;

            // Add rows
            events.forEach((e: any, index: number) => {
                const timestamp = new Date(e.timestamp);
                const row = worksheet.addRow({
                    id: e.id,
                    date: fecha(timestamp),
                    time: hora(timestamp),
                    plate: e.plateDetected || "-------",
                    type: e.accessType === "PLATE" ? "LPR" : e.accessType === "FACE" ? "Facial" : "TAG",
                    user: e.user?.name || "Externo / Desconocido",
                    unit: e.user?.unit?.name || "---",
                    apartment: e.user?.apartment || "---",
                    device: e.device?.name || "Nodo LPR",
                    direction: e.device?.direction === "ENTRY" ? "Entrada" : "Salida",
                    decision: e.decision === "GRANT" ? "PERMITIDO" : "DENEGADO",
                    details: e.details || ""
                });

                // Row height
                row.height = 20;
                row.alignment = { vertical: 'middle' };

                // Zebra stripes
                if (index % 2 === 0) {
                    row.fill = {
                        type: 'pattern',
                        pattern: 'solid',
                        fgColor: { argb: cStripe }
                    };
                }

                // Add borders to cells
                row.eachCell((cell) => {
                    cell.border = {
                        top: { style: 'thin', color: { argb: 'FFE5E7EB' } },
                        left: { style: 'thin', color: { argb: 'FFE5E7EB' } },
                        bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } },
                        right: { style: 'thin', color: { argb: 'FFE5E7EB' } }
                    };
                });

                // Conditional styling for Decision
                const decisionCell = row.getCell("decision");
                if (e.decision === "GRANT") {
                    decisionCell.font = { color: { argb: "FF059669" }, bold: true }; // Emerald-600
                } else {
                    decisionCell.font = { color: { argb: "FFDC2626" }, bold: true }; // Red-600
                }

                // Center specific columns
                ['date', 'time', 'plate', 'type', 'direction', 'decision'].forEach(key => {
                    row.getCell(key).alignment = { horizontal: 'center', vertical: 'middle' };
                });
            });

            // Auto-filter on the header row
            const startCol = "A";
            const endCol = "L";
            const headerRowNumber = headerRow.number;
            worksheet.autoFilter = `${startCol}${headerRowNumber}:${endCol}${headerRowNumber}`;

            // Generate buffer and download
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
            alert("Error al exportar los datos.");
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
