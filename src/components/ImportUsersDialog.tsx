
"use client";

import { useState, useRef } from "react";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { Loader2, Upload, FileSpreadsheet, CheckCircle2, AlertCircle, X, Download } from "lucide-react";
import ExcelJS from "exceljs";
import { sileo as toast } from "sileo";
import { importUserBatch } from "@/app/actions/users";
import { ScrollArea } from "@/components/ui/scroll-area";

import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip";

interface ImportUsersDialogProps {
    onSuccess: () => void;
}

export function ImportUsersDialog({ onSuccess }: ImportUsersDialogProps) {
    const [open, setOpen] = useState(false);
    const [file, setFile] = useState<File | null>(null);
    const [previewData, setPreviewData] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [importing, setImporting] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            const selectedFile = e.target.files[0];
            setFile(selectedFile);
            await parseExcel(selectedFile);
        }
    };

    const parseExcel = async (file: File) => {
        setLoading(true);
        try {
            const buffer = await file.arrayBuffer();
            const workbook = new ExcelJS.Workbook();
            await workbook.xlsx.load(buffer);
            const worksheet = workbook.getWorksheet(1);

            if (!worksheet) throw new Error("No se encontró hoja de cálculo");

            const rows: any[] = [];
            // Assuming Row 1 is header
            const headers: string[] = [];
            worksheet.getRow(1).eachCell((cell, colNumber) => {
                headers[colNumber] = cell.value?.toString().trim().toLowerCase() || "";
            });

            worksheet.eachRow((row, rowNumber) => {
                if (rowNumber === 1) return; // Skip header

                const rowData: any = {};
                row.eachCell((cell, colNumber) => {
                    const header = headers[colNumber];
                    // Flexible mapping
                    if (header.includes("nombre")) rowData.Name = cell.value?.toString();
                    else if (header.includes("dni") || header.includes("legajo")) rowData.DNI = cell.value?.toString();
                    else if (header.includes("email") || header.includes("correo")) rowData.Email = cell.value?.toString();
                    else if (header.includes("tel") || header.includes("phone")) rowData.Phone = cell.value?.toString();
                    else if (header.includes("rol")) rowData.Role = cell.value?.toString().toUpperCase(); // Expect RESIDENT, VISITOR, etc.
                    else if (header.includes("patente") || header.includes("lpr")) rowData.Plates = cell.value?.toString();
                    else if (header.includes("tag") || header.includes("rfid")) rowData.Tags = cell.value?.toString();
                    else if (header.includes("unidad") || header.includes("dpto")) rowData.Unidad = cell.value?.toString();
                    else if (header.includes("rostro") || header.includes("foto")) rowData.FaceURL = cell.value?.toString();

                    // Hyperlink support for FaceURL
                    if (cell.value && (cell.value as any).hyperlink && (header.includes("rostro") || header.includes("foto"))) {
                        rowData.FaceURL = (cell.value as any).hyperlink;
                    }
                });

                if (rowData.Name || rowData.DNI) { // Only push valid-ish rows
                    rows.push(rowData);
                }
            });

            setPreviewData(rows);
            if (rows.length === 0) toast.warning({ title: "El archivo parece vacío o no se reconocieron las columnas." });

        } catch (error) {
            console.error(error);
            toast.error({ title: "Error al leer el archivo Excel." });
        } finally {
            setLoading(false);
        }
    };

    const handleImport = async () => {
        setImporting(true);
        try {
            const result = await importUserBatch(previewData);
            if (result.success) {
                toast.success({ title: `Importación completada: ${result.count} procesados, ${result.failed} fallidos.` });
                if (result.errors.length > 0) {
                    console.warn("Errors during import:", result.errors);
                }
                onSuccess();
                setOpen(false);
                setFile(null);
                setPreviewData([]);
            } else {
                toast.error({ title: "Error en la importación masiva." });
            }
        } catch (error) {
            console.error(error);
            toast.error({ title: "Error del servidor." });
        } finally {
            setImporting(false);
        }
    };

    const downloadTemplate = async () => {
        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet("Plantilla Identidades");
        sheet.columns = [
            { header: 'Nombre Completo', key: 'name', width: 30 },
            { header: 'DNI / Legajo', key: 'dni', width: 15 },
            { header: 'Email', key: 'email', width: 25 },
            { header: 'Teléfono', key: 'phone', width: 15 },
            { header: 'Rol (RESIDENT/STAFF)', key: 'role', width: 20 },
            { header: 'Unidad', key: 'unit', width: 15 },
            { header: 'Patentes (Sep. por comas)', key: 'plates', width: 25 },
            { header: 'Tags RFID (Sep. por comas)', key: 'tags', width: 25 },
            { header: 'URL Foto (Opcional)', key: 'faceUrl', width: 40 },
        ];

        // Add example row
        sheet.addRow({
            name: "Juan Perez",
            dni: "12345678",
            email: "juan@example.com",
            phone: "555-1234",
            role: "RESIDENT",
            unit: "101",
            plates: "AAA123, BBB456",
            tags: "TAG001, TAG002",
            faceUrl: "https://..."
        });

        const buffer = await workbook.xlsx.writeBuffer();
        const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const url = window.URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = "plantilla_importacion_usuarios.xlsx";
        anchor.click();
        window.URL.revokeObjectURL(url);
    };

    return (
        <>
            <Tooltip>
                <TooltipTrigger asChild>
                    <Button
                        variant="outline"
                        size="icon"
                        onClick={() => setOpen(true)}
                        className="bg-[#107c41]/10 border-[#107c41]/20 text-[#107c41] hover:bg-[#107c41]/20 h-8 w-8"
                    >
                        <FileSpreadsheet size={16} />
                    </Button>
                </TooltipTrigger>
                <TooltipContent>
                    <p>Importar desde Excel</p>
                </TooltipContent>
            </Tooltip>

            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent className="max-w-4xl bg-card border border-border p-0 overflow-hidden">
                    <DialogHeader className="p-6 bg-card border-b border-border">
                        <DialogTitle className="text-xl font-bold text-foreground uppercase flex items-center gap-3">
                            <div className="p-2 bg-[#107c41]/10 rounded border border-[#107c41]/20">
                                <FileSpreadsheet className="text-[#107c41]" size={24} />
                            </div>
                            Importación Masiva
                        </DialogTitle>
                        <DialogDescription className="text-muted-foreground">
                            Carga nuevos usuarios o actualiza existentes mediante un archivo Excel (.xlsx).
                        </DialogDescription>
                    </DialogHeader>

                    <div className="p-6 space-y-6">
                        {/* Upload Area */}
                        {!file ? (
                            <div
                                className="border-2 border-dashed border-border rounded-xl p-10 flex flex-col items-center justify-center gap-4 hover:bg-accent transition-colors cursor-pointer group"
                                onClick={() => fileInputRef.current?.click()}
                            >
                                <input
                                    type="file"
                                    ref={fileInputRef}
                                    className="hidden"
                                    accept=".xlsx, .xls"
                                    onChange={handleFileChange}
                                />
                                <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center group-hover:scale-110 transition-transform">
                                    <Upload className="text-muted-foreground group-hover:text-foreground" size={32} />
                                </div>
                                <div className="text-center">
                                    <p className="text-sm font-bold text-foreground uppercase tracking-widest">Haz click para seleccionar archivo</p>
                                    <p className="text-xs text-muted-foreground mt-1">Soporta formatos .xlsx</p>
                                </div>
                                <Button variant="link" onClick={(e) => { e.stopPropagation(); downloadTemplate(); }} className="text-[#107c41] text-xs">
                                    <Download size={12} className="mr-1" /> Descargar Plantilla
                                </Button>
                            </div>
                        ) : (
                            <div className="space-y-4">
                                <div className="flex items-center justify-between p-4 bg-card rounded-lg border border-border">
                                    <div className="flex items-center gap-3">
                                        <div className="p-2 bg-[#107c41]/20 text-[#107c41] rounded">
                                            <FileSpreadsheet size={24} />
                                        </div>
                                        <div>
                                            <p className="text-sm font-bold text-foreground truncate max-w-[200px]">{file.name}</p>
                                            <p className="text-xs text-muted-foreground">{previewData.length} registros detectados</p>
                                        </div>
                                    </div>
                                    <Button size="sm" variant="ghost" onClick={() => { setFile(null); setPreviewData([]); }}>
                                        <X size={16} />
                                    </Button>
                                </div>

                                {/* Preview Table */}
                                <div className="border border-border rounded-lg overflow-hidden bg-black/20 h-64 flex flex-col">
                                    <div className="p-2 bg-foreground/10 border-b border-border text-[10px] font-bold uppercase text-muted-foreground tracking-widest">Vista Previa</div>
                                    <ScrollArea className="flex-1">
                                        {loading ? (
                                            <div className="flex items-center justify-center h-full">
                                                <Loader2 className="animate-spin text-muted-foreground" />
                                            </div>
                                        ) : (
                                            <Table>
                                                <TableHeader>
                                                    <TableRow className="border-border hover:bg-transparent">
                                                        <TableHead className="text-[10px] text-muted-foreground">Nombre</TableHead>
                                                        <TableHead className="text-[10px] text-muted-foreground">DNI</TableHead>
                                                        <TableHead className="text-[10px] text-muted-foreground">Rol</TableHead>
                                                        <TableHead className="text-[10px] text-muted-foreground">Unidad</TableHead>
                                                        <TableHead className="text-[10px] text-muted-foreground text-right">Credenciales</TableHead>
                                                    </TableRow>
                                                </TableHeader>
                                                <TableBody>
                                                    {previewData.slice(0, 50).map((row, idx) => (
                                                        <TableRow key={idx} className="border-border hover:bg-accent">
                                                            <TableCell className="text-xs font-bold text-foreground uppercase">{row.Name || "-"}</TableCell>
                                                            <TableCell className="text-xs text-muted-foreground font-mono">{row.DNI || "-"}</TableCell>
                                                            <TableCell className="text-[10px] text-muted-foreground uppercase">{row.Role || "RESIDENT"}</TableCell>
                                                            <TableCell className="text-[10px] text-muted-foreground uppercase">{row.Unidad || "-"}</TableCell>
                                                            <TableCell className="text-[10px] text-muted-foreground text-right font-mono">
                                                                {[
                                                                    row.Plates ? `${row.Plates.split(',').length} Pat.` : null,
                                                                    row.Tags ? `${row.Tags.split(',').length} Tags` : null,
                                                                    row.FaceURL ? 'Rostro' : null
                                                                ].filter(Boolean).join(', ') || "-"}
                                                            </TableCell>
                                                        </TableRow>
                                                    ))}
                                                </TableBody>
                                            </Table>
                                        )}
                                    </ScrollArea>
                                </div>
                                <div className="flex justify-end gap-3">
                                    <Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
                                    <Button
                                        onClick={handleImport}
                                        disabled={loading || importing || previewData.length === 0}
                                        className="bg-[#107c41] hover:bg-[#0b5c30] text-foreground"
                                    >
                                        {importing ? <Loader2 className="animate-spin mr-2" size={16} /> : <CheckCircle2 className="mr-2" size={16} />}
                                        Confirmar e Importar
                                    </Button>
                                </div>
                            </div>
                        )}
                    </div>
                </DialogContent>
            </Dialog >
        </>
    );
}
