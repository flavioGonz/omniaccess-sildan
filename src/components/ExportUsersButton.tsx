
"use client";

import { Button } from "@/components/ui/button";
import { Download, Loader2 } from "lucide-react";
import ExcelJS from "exceljs";
import { getReportBranding } from "@/app/actions/settings";
import { useState } from "react";
import { sileo as toast } from "sileo";

import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip";

interface ExportUsersButtonProps {
    users: any[];
}

export function ExportUsersButton({ users }: ExportUsersButtonProps) {
    const [exporting, setExporting] = useState(false);

    const handleExport = async () => {
        setExporting(true);
        try {
            let rb: any = {};
            try { rb = await getReportBranding(); } catch {}
            const toARGB = (hex: string, fb: string) => { const h = (hex || "").replace("#", ""); return /^[0-9a-fA-F]{6}$/.test(h) ? ("FF" + h.toUpperCase()) : fb; };
            const cHeader = toARGB(rb?.tableHeader || rb?.primary, "FF1F1F1F");
            const workbook = new ExcelJS.Workbook();
            const worksheet = workbook.addWorksheet("Directorio de Identidades", {
                views: [{ state: 'frozen', xSplit: 0, ySplit: 1 }]
            });

            // Columns
            worksheet.columns = [
                { header: 'ID (Sistema)', key: 'id', width: 15 },
                { header: 'Nombre Completo', key: 'name', width: 30 },
                { header: 'DNI / Legajo', key: 'dni', width: 15 },
                { header: 'Email', key: 'email', width: 25 },
                { header: 'Teléfono', key: 'phone', width: 15 },
                { header: 'Rol', key: 'role', width: 12 },
                { header: 'Unidad / Dpto', key: 'unit', width: 15 },
                { header: 'Patentes (LPR)', key: 'plates', width: 25 },
                { header: 'Tags (RFID)', key: 'tags', width: 25 },
                { header: 'PIN Code', key: 'pin', width: 10 },
                { header: 'Rostro (Enrolado)', key: 'hasFace', width: 12 },
                { header: 'Foto de Perfil (URL)', key: 'faceUrl', width: 40 },
                { header: 'Grupos de Acceso', key: 'groups', width: 30 },
                { header: 'Notas / Observaciones', key: 'notes', width: 30 },
            ];

            // Styling Headers
            worksheet.getRow(1).eachCell((cell) => {
                cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, name: 'Arial', size: 10 };
                cell.fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: cHeader }
                };
                cell.alignment = { vertical: 'middle', horizontal: 'center' };
                cell.border = { bottom: { style: 'thin' } };
            });
            worksheet.getRow(1).height = 30;

            // Adding Rows
            users.forEach((user) => {
                const plates = user.credentials?.filter((c: any) => c.type === 'PLATE').map((c: any) => c.value).join(', ') ||
                    user.vehicles?.map((v: any) => v.plate).join(', ') || "";
                const tags = user.credentials?.filter((c: any) => c.type === 'TAG').map((c: any) => c.value).join(', ') || "";
                const pins = user.credentials?.filter((c: any) => c.type === 'PIN').map((c: any) => c.value).join(', ') || "";
                const hasFaceCred = user.credentials?.some((c: any) => c.type === 'FACE');
                const groups = user.accessGroups?.map((g: any) => g.name).join(', ') || "";

                const row = worksheet.addRow({
                    id: user.id.slice(-8), // Short ID
                    name: user.name,
                    dni: user.dni,
                    email: user.email,
                    phone: user.phone,
                    role: user.role,
                    unit: user.unit?.name,
                    plates: plates,
                    tags: tags,
                    pin: pins,
                    hasFace: hasFaceCred ? 'SI' : 'NO',
                    faceUrl: user.cara ? { text: 'Ver Foto', hyperlink: user.cara } : '',
                    groups: groups,
                    notes: user.notes // If notes exist on user model (removed currently but might exist on others)
                });

                // Zebra striping and alignment
                // row.fill ... (ExcelJS row styling is per cell)
                row.eachCell((cell, colNumber) => {
                    cell.border = { top: { style: 'hair', color: { argb: 'FFEEEEEE' } } };
                    if (colNumber === 11) { // Has Face
                        cell.alignment = { horizontal: 'center' };
                        if (cell.value === 'SI') {
                            cell.font = { color: { argb: 'FF10B981' }, bold: true }; // Emerald
                        } else {
                            cell.font = { color: { argb: 'FFEF4444' }, bold: true }; // Red
                        }
                    }
                });
            });

            // Generate Buffer
            const buffer = await workbook.xlsx.writeBuffer();

            // Download (Client-side trigger)
            const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
            const url = window.URL.createObjectURL(blob);
            const anchor = document.createElement('a');
            anchor.href = url;
            anchor.download = `OmniAccess_Identidades_${new Date().toISOString().split('T')[0]}.xlsx`;
            anchor.click();
            window.URL.revokeObjectURL(url);

            toast.success({ title: "Excel generado correctamente." });
        } catch (error) {
            console.error(error);
            toast.error({ title: "Error al generar Excel." });
        } finally {
            setExporting(false);
        }
    };

    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <Button
                    variant="outline"
                    size="icon"
                    onClick={handleExport}
                    disabled={exporting}
                    className="bg-[#107c41]/10 border-[#107c41]/20 text-[#107c41] hover:bg-[#107c41]/20 h-8 w-8"
                >
                    {exporting ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
                </Button>
            </TooltipTrigger>
            <TooltipContent>
                <p>Exportar Listado (Excel)</p>
            </TooltipContent>
        </Tooltip>
    );
}
