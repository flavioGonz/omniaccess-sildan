/**
 * Los reportes de rastreo en una planilla: una hoja por reporte.
 *
 * Cada hoja es una tabla que se puede filtrar y sumar, no un dibujo de una tabla:
 *  · los kilómetros, las velocidades y los tiempos son NÚMEROS con su formato, no texto;
 *  · las duraciones van como tiempo de Excel ([h]:mm), que se suma solo y pasa de 24 horas;
 *  · la cabecera queda fija y con filtro.
 *
 * Las fechas y las horas, en cambio, van como TEXTO en la hora del sitio (la decisión de la primera
 * planilla, que sigue valiendo): una fecha de Excel no tiene zona, y un reporte que puede terminar
 * delante de un cliente o de un seguro no puede mostrar otra hora según quién lo abra.
 */
import ExcelJS from "exceljs";
import { esLugar, type Celda, type Columna, type Formato, type TablaReporte } from "@/lib/gps-reportes-catalogo";
import { periodoEnPalabras, vehiculosEnPalabras, type ReporteGps } from "@/lib/gps-reportes-servidor";
import type { Marca } from "@/lib/informes/marca";

const FORMATO: Partial<Record<Formato, string>> = { entero: "#,##0", km: "#,##0.0", kmh: '0 "km/h"', dur: "[h]:mm", seg: '0 "s"', metros: '#,##0 "m"', coord: "0.000000" };
const GRIS = "FF64748B", TINTA = "FF0A0E14", ENLACE = "FF2563EB";
/** El rótulo de la columna, con la unidad cuando el número no la lleva puesta. */
const rotuloDe = (c: Columna) => (c.formato === "dur" ? `${c.rotulo} (h:mm)` : c.formato === "km" ? `${c.rotulo} (km)` : c.rotulo);

function valor(c: Columna, x: Celda): ExcelJS.CellValue {
    if (x === null || x === "") return null;
    if (esLugar(x)) return { text: x.lugar || `${x.lat.toFixed(5)}, ${x.lon.toFixed(5)}`, hyperlink: `https://maps.google.com/?q=${x.lat},${x.lon}` };
    if (typeof x === "string") return x;
    if (c.formato === "dur") return x / 1440;      // minutos → días, que es como Excel cuenta el tiempo
    if (c.formato === "km") return Math.round(x * 10) / 10;
    return x;
}

function hoja(wb: ExcelJS.Workbook, t: TablaReporte, r: ReporteGps, marca: Marca) {
    const FILA_CABECERA = 5;
    const h = wb.addWorksheet(t.hoja, { views: [{ state: "frozen", ySplit: FILA_CABECERA, xSplit: 1 }] });
    /* El rótulo en negrita, con su unidad y el botón del filtro, ocupa más que el dato: que no se corte. */
    h.columns = t.columnas.map((c) => ({ width: Math.max(c.ancho, rotuloDe(c).length + 5) }));
    h.addRow([t.titulo]).font = { bold: true, size: 14 };
    h.addRow([`${vehiculosEnPalabras(r)} · ${periodoEnPalabras(r)}`]).font = { color: { argb: GRIS } };
    h.addRow([t.nota || t.ayuda]).font = { color: { argb: GRIS }, italic: true };
    h.addRow([]);
    const cab = h.addRow(t.columnas.map(rotuloDe));
    cab.height = 22;
    cab.eachCell((x, n) => {
        x.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 }; x.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TINTA } };
        x.alignment = { vertical: "middle", horizontal: t.columnas[n - 1].formato === "texto" || t.columnas[n - 1].formato === "lugar" ? "left" : "right", indent: 1 };
    });
    const vestir = (fila: ExcelJS.Row, celdas: Celda[]) => t.columnas.forEach((c, i) => {
        const x = fila.getCell(i + 1);
        if (FORMATO[c.formato]) x.numFmt = FORMATO[c.formato]!;
        if (esLugar(celdas[i])) x.font = { color: { argb: ENLACE }, underline: true };
    });
    for (const f of t.filas) vestir(h.addRow(t.columnas.map((c, i) => valor(c, f[i]))), f);
    if (!t.filas.length) h.addRow([t.vacio]).font = { color: { argb: GRIS } };
    if (t.total) {
        const tot = h.addRow(t.columnas.map((c, i) => valor(c, t.total![i])));
        vestir(tot, t.total);
        tot.eachCell({ includeEmpty: true }, (x) => { x.font = { bold: true }; x.border = { top: { style: "thin", color: { argb: TINTA } } }; });
    }
    if (t.filas.length) h.autoFilter = { from: { row: FILA_CABECERA, column: 1 }, to: { row: FILA_CABECERA + t.filas.length, column: t.columnas.length } };
    h.headerFooter.oddFooter = `&L${marca.pie}&RPágina &P de &N`;
    h.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 };
}

export async function reporteGpsExcel(r: ReporteGps, marca: Marca): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    wb.creator = marca.empresa || "OmniAccess"; wb.created = new Date(r.generado);
    for (const t of r.tablas) hoja(wb, t, r, marca);
    return Buffer.from(await wb.xlsx.writeBuffer());
}
