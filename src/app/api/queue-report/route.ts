import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
    const data = await req.json();
    const { format, summary, daily, hourly, dateRange, recentAlerts } = data;

    if (format === "excel") {
        // Generate CSV (simpler, no extra deps needed)
        let csv = "﻿"; // BOM for Excel UTF-8
        csv += "Reporte de Control de Filas - OmniAccess\n";
        csv += `Período: ${dateRange.from} a ${dateRange.to}\n\n`;

        // Summary
        csv += "RESUMEN\n";
        csv += `Eventos totales,${summary.totalEvents}\n`;
        csv += `Promedio personas,${summary.avgCount}\n`;
        csv += `Máximo personas,${summary.maxCount}\n`;
        csv += `Alertas enviadas,${summary.totalAlerts}\n`;
        csv += `Días con datos,${summary.daysWithData}\n\n`;

        // Daily breakdown
        if (daily && daily.length > 0) {
            csv += "DESGLOSE DIARIO\n";
            csv += "Fecha,Eventos,Promedio,Máximo,Alertas\n";
            for (const d of daily) {
                csv += `${d.date},${d.count},${d.avg},${d.max},${d.alerts}\n`;
            }
            csv += "\n";
        }

        // Hourly breakdown
        if (hourly && hourly.length > 0) {
            csv += "DISTRIBUCIÓN POR HORA\n";
            csv += "Hora,Eventos,Promedio,Máximo\n";
            for (const h of hourly) {
                csv += `${h.hour}:00,${h.count},${h.avg},${h.max}\n`;
            }
        }

        return new NextResponse(csv, {
            headers: {
                "Content-Type": "text/csv; charset=utf-8",
                "Content-Disposition": `attachment; filename="reporte-filas-${dateRange.from}.csv"`,
            },
        });
    }

    if (format === "pdf") {
        // Generate simple HTML-based PDF
        const html = `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><title>Reporte de Filas</title>
<style>
    body { font-family: Arial, sans-serif; margin: 40px; color: #333; }
    h1 { color: #0891b2; font-size: 24px; border-bottom: 2px solid #0891b2; padding-bottom: 8px; }
    h2 { color: #555; font-size: 16px; margin-top: 30px; }
    .summary { display: flex; gap: 20px; flex-wrap: wrap; margin: 20px 0; }
    .stat { background: #f8f9fa; border-radius: 8px; padding: 16px 24px; min-width: 150px; }
    .stat-value { font-size: 28px; font-weight: bold; color: #0891b2; }
    .stat-label { font-size: 11px; color: #888; text-transform: uppercase; }
    table { width: 100%; border-collapse: collapse; margin: 10px 0; }
    th { background: #f1f5f9; text-align: left; padding: 8px 12px; font-size: 12px; color: #555; border-bottom: 2px solid #e2e8f0; }
    td { padding: 8px 12px; border-bottom: 1px solid #f1f5f9; font-size: 13px; }
    tr:hover { background: #f8fafc; }
    .chart-bar { display: inline-block; height: 14px; background: #06b6d4; border-radius: 3px; margin-right: 4px; vertical-align: middle; }
    .footer { margin-top: 40px; font-size: 10px; color: #aaa; border-top: 1px solid #eee; padding-top: 8px; }
    @media print { body { margin: 20px; } }
</style></head><body>
<h1>Reporte de Control de Filas</h1>
<p style="color:#888">Período: ${dateRange.from} — ${dateRange.to} | Generado: ${new Date().toLocaleString("es-UY")}</p>

<div class="summary">
    <div class="stat"><div class="stat-value">${summary.totalEvents}</div><div class="stat-label">Eventos</div></div>
    <div class="stat"><div class="stat-value">${summary.avgCount}</div><div class="stat-label">Promedio</div></div>
    <div class="stat"><div class="stat-value">${summary.maxCount}</div><div class="stat-label">Máximo</div></div>
    <div class="stat"><div class="stat-value">${summary.totalAlerts}</div><div class="stat-label">Alertas</div></div>
</div>

${hourly && hourly.length > 0 ? `
<h2>Distribución por hora</h2>
<table>
<tr><th>Hora</th><th>Eventos</th><th>Promedio</th><th>Máximo</th><th>Gráfico</th></tr>
${hourly.map((h: any) => {
    const maxAll = Math.max(...hourly.map((x: any) => x.max), 1);
    const barWidth = maxAll > 0 ? Math.round((h.max / maxAll) * 200) : 0;
    return `<tr><td>${h.hour}:00</td><td>${h.count}</td><td>${h.avg}</td><td><strong>${h.max}</strong></td><td><div class="chart-bar" style="width:${barWidth}px"></div> ${h.max}</td></tr>`;
}).join("")}
</table>` : ""}

${daily && daily.length > 1 ? `
<h2>Desglose diario</h2>
<table>
<tr><th>Fecha</th><th>Eventos</th><th>Promedio</th><th>Máximo</th><th>Alertas</th></tr>
${daily.map((d: any) => `<tr><td>${d.date}</td><td>${d.count}</td><td>${d.avg}</td><td><strong>${d.max}</strong></td><td>${d.alerts}</td></tr>`).join("")}
</table>` : ""}

<div class="footer">OmniAccess — Sistema de Control de Acceso Unificado</div>
</body></html>`;

        return new NextResponse(html, {
            headers: {
                "Content-Type": "text/html; charset=utf-8",
                "Content-Disposition": `attachment; filename="reporte-filas-${dateRange.from}.html"`,
            },
        });
    }

    return NextResponse.json({ error: "Formato no soportado" }, { status: 400 });
}
