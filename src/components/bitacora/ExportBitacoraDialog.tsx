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
import { getBitacoraForReport, getBitacoraGuards } from "@/app/actions/bitacora";
import ExcelJS from "exceljs";
import { toast } from "sonner";
import { useEffect } from "react";
import { fecha, hora } from "@/lib/fechas";

interface ExportBitacoraDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    searchQuery?: string;
}

export function ExportBitacoraDialog({ open, onOpenChange, searchQuery }: ExportBitacoraDialogProps) {
    const [startDate, setStartDate] = useState(new Date().toISOString().split('T')[0]);
    const [endDate, setEndDate] = useState(new Date().toISOString().split('T')[0]);
    const [guards, setGuards] = useState<string[]>([]);
    const [selectedGuard, setSelectedGuard] = useState("ALL");
    const [isExporting, setIsExporting] = useState(false);

    useEffect(() => {
        const fetchGuards = async () => {
            const list = await getBitacoraGuards();
            setGuards(list);
        };
        if (open) fetchGuards();
    }, [open]);

    const handleExport = async () => {
        setIsExporting(true);
        try {
            const fromDate = new Date(startDate + "T00:00:00");
            const toDate = new Date(endDate + "T23:59:59");

            const entries = await getBitacoraForReport(fromDate, toDate, searchQuery, selectedGuard);

            if (!entries || entries.length === 0) {
                toast.error("No se encontraron registros");
                return;
            }

            const workbook = new ExcelJS.Workbook();
            const worksheet = workbook.addWorksheet("Bitácora de Guardia");

            // 1. Header & Summary
            worksheet.addRow(["REPORTE DE BITÁCORA - OMNIACCESS"]).font = { bold: true, size: 14 };
            worksheet.addRow([`Generado el: ${fecha(new Date())}`]);
            worksheet.addRow([`Periodo: ${startDate} a ${endDate}`]);
            if (searchQuery) worksheet.addRow([`Filtro de búsqueda: "${searchQuery}"`]);
            worksheet.addRow([`Total de Registros: ${entries.length}`]);
            worksheet.addRow([]); // Spacer

            // 2. Define Columns
            worksheet.columns = [
                { header: "Fecha", key: "date", width: 12 },
                { header: "Hora", key: "time", width: 10 },
                { header: "Tipo", key: "type", width: 10 },
                { header: "Matrícula", key: "plate", width: 12 },
                { header: "Nombre / Visitante", key: "name", width: 25 },
                { header: "DNI / Docto", key: "dni", width: 15 },
                { header: "Destino", key: "destination", width: 20 },
                { header: "Empresa", key: "company", width: 20 },
                { header: "Guardia", key: "guard", width: 20 },
                { header: "Observaciones", key: "notes", width: 40 },
            ];

            // Style Header
            const headerRow = worksheet.getRow(6);
            headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
            headerRow.fill = {
                type: "pattern",
                pattern: "solid",
                fgColor: { argb: "FF1E40AF" } // Blue-800
            };

            // 3. Add Data
            entries.forEach((e: any) => {
                const ts = new Date(e.timestamp);
                worksheet.addRow({
                    date: fecha(ts),
                    time: hora(ts),
                    type: e.type === "ENTRY" ? "INGRESO" : "SALIDA",
                    plate: e.plate || "---",
                    name: e.name || "---",
                    dni: e.dni || "---",
                    destination: e.destination || "---",
                    company: e.company || "---",
                    guard: e.guardName || "---",
                    notes: e.notes || ""
                });
            });

            // Auto-filter
            worksheet.autoFilter = 'A6:J6';

            // Generate buffer and download
            const buffer = await workbook.xlsx.writeBuffer();
            const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = url;
            link.download = `Bitacora_OmniAccess_${startDate}_a_${endDate}.xlsx`;
            link.click();
            URL.revokeObjectURL(url);

            onOpenChange(false);
            toast.success("Reporte generado correctamente");
        } catch (error) {
            console.error("Export error:", error);
            toast.error("Error al exportar los datos.");
        } finally {
            setIsExporting(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[425px] bg-card border-border text-foreground">
                <DialogHeader>
                    <div className="mx-auto w-12 h-12 bg-blue-500/10 rounded-full flex items-center justify-center mb-4 border border-blue-500/20">
                        <FileSpreadsheet className="text-blue-500" size={24} />
                    </div>
                    <DialogTitle className="text-xl font-bold text-center uppercase tracking-tight">Reporte de Bitácora</DialogTitle>
                    <DialogDescription className="text-muted-foreground text-center text-xs font-medium">
                        Selecciona el rango de fechas para exportar los movimientos de guardia.
                    </DialogDescription>
                </DialogHeader>

                <div className="grid gap-6 py-4">
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label className="text-[10px] uppercase font-bold text-muted-foreground tracking-widest pl-1">Desde</Label>
                            <input
                                type="date"
                                value={startDate}
                                onChange={(e) => setStartDate(e.target.value)}
                                className="w-full bg-background border border-border rounded-lg h-10 px-3 text-xs font-bold text-foreground focus:outline-none focus:border-blue-500/50 uppercase"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label className="text-[10px] uppercase font-bold text-muted-foreground tracking-widest pl-1">Hasta</Label>
                            <input
                                type="date"
                                value={endDate}
                                onChange={(e) => setEndDate(e.target.value)}
                                className="w-full bg-background border border-border rounded-lg h-10 px-3 text-xs font-bold text-foreground focus:outline-none focus:border-blue-500/50 uppercase"
                            />
                        </div>
                    </div>
                    <div className="space-y-2">
                        <Label className="text-[10px] uppercase font-bold text-muted-foreground tracking-widest pl-1">Filtrar por Guardia</Label>
                        <select
                            value={selectedGuard}
                            onChange={(e) => setSelectedGuard(e.target.value)}
                            className="w-full bg-background border border-border rounded-lg h-10 px-3 text-xs font-bold text-foreground focus:outline-none focus:border-blue-500/50 uppercase appearance-none"
                        >
                            <option value="ALL">TODOS LOS GUARDIAS</option>
                            {guards.map((g) => (
                                <option key={g} value={g}>{g}</option>
                            ))}
                        </select>
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
                        className="bg-blue-600 hover:bg-blue-500 text-foreground text-xs font-bold uppercase tracking-widest h-10 px-8 shadow-lg shadow-blue-900/20"
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
