/**
 * El informe de lecturas en Excel: el mismo informe que el PDF, para trabajar los números.
 *
 *  · Resumen     — la ficha, las cifras, lo que se concluye, cada cámara y OmniVision;
 *  · Por día, Por hora;
 *  · Vehículos   — TODOS los pasos (el PDF tiene un tope), con filtro y la primera fila fija;
 *  · OmniVision  — cada evento releído, con la comparación contra la cámara;
 *  · Para revisar — todos los casos que no cerraron.
 *
 * Los porcentajes van como número con formato de porcentaje (no como texto): así se pueden ordenar,
 * sumar y graficar. Las horas, como fecha de Excel en la hora del barrio.
 */
import ExcelJS from "exceljs";
import type { FilaLectura } from "@/lib/lecturas-camara";
import { COLOR, suave, type Marca } from "@/lib/informes/marca";
import { PASO_ROTULO, VISION_ROTULO, compararVision, ZONA_INFORME, type InformeLecturas, type Metricas } from "@/lib/informes/lecturas-resumen";

export type ParamsExcel = { informe: InformeLecturas; filas: FilaLectura[]; marca: Marca; desde: Date; hasta: Date; camaras: string[]; generadoPor: string };

const argb = (hex: string) => "FF" + hex.replace("#", "").toUpperCase();
const TONO: Record<string, string> = { coincide: COLOR.bien, variante: COLOR.info, distinta: COLOR.avisoTexto, perdida: COLOR.mal, solo: COLOR.quieto, rescate: COLOR.accion, "no-leyo": COLOR.mal, "sin-camara": COLOR.gris, "vision-distinta": COLOR.accion };
const FUENTE = "Outfit";

/** La hora del barrio como fecha «de pared» para Excel (Excel no tiene zonas: muestra lo que recibe). */
function enZona(iso: string | Date): Date {
    const d = new Date(iso);
    const p = new Intl.DateTimeFormat("en-CA", { timeZone: ZONA_INFORME, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(d);
    const g = (t: string) => Number(p.find((x) => x.type === t)?.value);
    return new Date(Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"), g("second")));
}

export async function informeLecturasExcel(p: ParamsExcel): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    wb.creator = p.marca.empresa; wb.company = p.marca.empresa; wb.title = "Informe de lecturas LPR"; wb.created = new Date();
    const inf = p.informe;

    // ── estilos ──
    const cabecera = (ws: ExcelJS.Worksheet, fila: number) => {
        const r = ws.getRow(fila);
        r.height = 30;
        r.eachCell((c) => {
            c.font = { name: FUENTE, bold: true, size: 10, color: { argb: "FFFFFFFF" } };
            c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: argb(COLOR.tinta) } };
            c.alignment = { vertical: "middle", wrapText: true, horizontal: typeof c.value === "string" && /^(Vehículos|Capturas|Relecturas|Llegaron|Otra|No |Sólo|Demora|Acierto|Coincide|Rescate|Confianza|Sin leer|Pasos|Hora$)/.test(c.value) ? "right" : "left" };
        });
    };
    const cuerpo = (ws: ExcelJS.Worksheet, desde: number) => {
        for (let i = desde; i <= ws.rowCount; i++) {
            const r = ws.getRow(i);
            r.eachCell({ includeEmpty: true }, (c) => {
                c.font = { name: FUENTE, size: 10, color: { argb: argb(COLOR.texto) }, ...(c.font || {}) };
                c.border = { bottom: { style: "hair", color: { argb: argb(COLOR.linea) } } };
                c.alignment = { vertical: "middle", ...(c.alignment || {}) };
            });
        }
    };
    const tonoCelda = (c: ExcelJS.Cell, hex: string) => {
        c.font = { name: FUENTE, size: 10, bold: true, color: { argb: argb(hex) } };
        c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: argb(suave(hex, 0.88)) } };
    };
    const banda = (ws: ExcelJS.Worksheet, titulo: string, bajada: string, columnas: number) => {
        ws.mergeCells(1, 1, 1, columnas); ws.mergeCells(2, 1, 2, columnas);
        const a = ws.getCell(1, 1), b = ws.getCell(2, 1);
        a.value = titulo; b.value = bajada;
        a.font = { name: FUENTE, bold: true, size: 15, color: { argb: "FFFFFFFF" } };
        b.font = { name: FUENTE, size: 10, color: { argb: "FFCBD5E1" } };
        for (const c of [a, b]) { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: argb(p.marca.primario) } }; c.alignment = { vertical: "middle", indent: 1 }; }
        ws.getRow(1).height = 30; ws.getRow(2).height = 20;
        ws.addRow([]);
    };
    const periodo = `${new Intl.DateTimeFormat("es-UY", { timeZone: ZONA_INFORME, dateStyle: "long" }).format(p.desde)} al ${new Intl.DateTimeFormat("es-UY", { timeZone: ZONA_INFORME, dateStyle: "long" }).format(p.hasta)}`;
    const PCT = "0.0%", SEG = '0.0" s"';
    const metricasFila = (m: Metricas) => [m.pasos, m.capturas, m.bienPct, m.coincide, m.variante, m.distinta, m.perdida, m.solo, m.sinLeerCamara, m.demoraMs == null ? null : m.demoraMs / 1000];
    const COLS_METRICAS = ["Vehículos", "Capturas", "Llegaron bien", "Coincide", "Otra lectura", "Otra chapa", "No llegaron", "Sólo OmniAccess", "Sin leer (cámara)", "Demora típica"];
    /** `desde`: la columna del rótulo; las métricas arrancan en la siguiente (en el orden de COLS_METRICAS). */
    const formatoMetricas = (r: ExcelJS.Row, desde: number) => {
        for (let i = 0; i < COLS_METRICAS.length; i++) r.getCell(desde + 1 + i).numFmt = i === 2 ? PCT : i === 9 ? SEG : "#,##0";
    };

    // ══ Resumen ══
    {
        const ws = wb.addWorksheet("Resumen", { views: [{ showGridLines: false }] });
        ws.columns = [{ width: 46 }, ...Array(10).fill({ width: 15 })];
        banda(ws, `${p.marca.empresa} · Informe de lecturas LPR`, `Cámara, OmniAccess y OmniVision · ${periodo}`, 11);
        const ficha: [string, string][] = [["Período", periodo], ["Cámaras", p.camaras.join(", ") || "Todas"], ["Generado", new Intl.DateTimeFormat("es-UY", { timeZone: ZONA_INFORME, dateStyle: "short", timeStyle: "short" }).format(new Date())], ["Preparado por", p.marca.preparadoPor || p.generadoPor]];
        for (const [k, v] of ficha) { const r = ws.addRow([k, v]); r.getCell(1).font = { name: FUENTE, bold: true, size: 9, color: { argb: argb(COLOR.gris) } }; r.getCell(2).font = { name: FUENTE, size: 10 }; }
        ws.addRow([]);
        const t = inf.total;
        const cifras: [string, number | null, string?][] = [
            ["Vehículos leídos por las cámaras", t.pasos], ["Capturas de las cámaras", t.capturas], ["Llegaron bien a OmniAccess", t.bienPct, PCT],
            ["No llegaron", t.perdida], ["Llegó otra chapa", t.distinta], ["Sólo en OmniAccess", t.solo],
            ["Relecturas de OmniVision", t.vision.total], ["Acierto de OmniVision frente a la cámara", t.vision.aciertoPct, PCT],
            ["Chapas que OmniVision leyó y la cámara no", t.vision.rescate], ["Demora típica captura → evento", t.demoraMs == null ? null : t.demoraMs / 1000, SEG],
        ];
        const tc = ws.addRow(["Cifras del período", "Valor"]); cabecera(ws, tc.number);
        for (const [k, v, f] of cifras) { const r = ws.addRow([k, v]); r.getCell(2).numFmt = f || "#,##0"; r.getCell(2).font = { name: FUENTE, bold: true, size: 11 }; r.getCell(1).font = { name: FUENTE, size: 10 }; }
        ws.addRow([]);
        const th = ws.addRow(["Lo que se concluye"]); th.getCell(1).font = { name: FUENTE, bold: true, size: 11, color: { argb: argb(COLOR.accion) } };
        for (const h of inf.hallazgos) { const r = ws.addRow([`•  ${h}`]); ws.mergeCells(r.number, 1, r.number, 11); r.getCell(1).alignment = { wrapText: true, vertical: "top" }; r.getCell(1).font = { name: FUENTE, size: 10 }; r.height = 30; }
        ws.addRow([]);
        const t1 = ws.addRow(["Por cámara", ...COLS_METRICAS]); cabecera(ws, t1.number);
        const i1 = ws.rowCount + 1;
        for (const c of inf.camaras) formatoMetricas(ws.addRow([c.nombre, ...metricasFila(c.m)]), 1);
        const tot = ws.addRow(["Todas las cámaras", ...metricasFila(t)]); formatoMetricas(tot, 1); tot.eachCell((c) => { c.font = { name: FUENTE, bold: true, size: 10 }; });
        cuerpo(ws, i1);
        ws.addRow([]);
        const t2 = ws.addRow(["OmniVision por cámara", "Relecturas", "Acierto", ...(["coincide", "variante", "rescate", "distinta", "no-leyo", "sin-camara"] as const).map((k) => VISION_ROTULO[k]), "Confianza media"]); cabecera(ws, t2.number);
        const i2 = ws.rowCount + 1;
        for (const c of [...inf.camaras.filter((x) => x.m.vision.total), { nombre: "Todas las cámaras", m: t }]) {
            const v = c.m.vision;
            const r = ws.addRow([c.nombre, v.total, v.aciertoPct, v.coincide, v.variante, v.rescate, v.distinta, v["no-leyo"], v["sin-camara"], v.confianzaMedia]);
            r.getCell(3).numFmt = PCT; r.getCell(10).numFmt = "0%";
        }
        cuerpo(ws, i2);
    }

    // ══ Por día / Por hora ══
    const serie = (nombre: string, titulo: string, datos: { r: string | number; m: Metricas }[]) => {
        const ws = wb.addWorksheet(nombre, { views: [{ state: "frozen", ySplit: 4, showGridLines: false }] });
        ws.columns = [{ width: 14 }, ...Array(10).fill({ width: 15 })];
        banda(ws, titulo, periodo, 11);
        const h = ws.addRow([nombre === "Por día" ? "Día" : "Hora", ...COLS_METRICAS]); cabecera(ws, h.number);
        for (const d of datos) formatoMetricas(ws.addRow([d.r, ...metricasFila(d.m)]), 1);
        cuerpo(ws, h.number + 1);
    };
    serie("Por día", "Día por día", inf.porDia.map((d) => ({ r: `${d.dia.slice(8, 10)}/${d.dia.slice(5, 7)}/${d.dia.slice(0, 4)}`, m: d.m })));
    serie("Por hora", "Hora por hora (todos los días juntos)", inf.porHora.map((d) => ({ r: `${String(d.hora).padStart(2, "0")}:00`, m: d.m })));

    // ══ Vehículos ══
    {
        const ws = wb.addWorksheet("Vehículos", { views: [{ state: "frozen", ySplit: 1 }] });
        ws.columns = [
            { header: "Fecha y hora", width: 19 }, { header: "Cámara", width: 26 }, { header: "Resultado", width: 17 },
            { header: "Leyó la cámara", width: 15 }, { header: "Capturas", width: 10 }, { header: "Sin leer", width: 9 }, { header: "Otras lecturas", width: 24 }, { header: "Sentido", width: 9 },
            { header: "Recibió OmniAccess", width: 19 }, { header: "Decisión", width: 11 }, { header: "Demora", width: 9 },
            { header: "Releyó OmniVision", width: 17 }, { header: "Estado OmniVision", width: 14 }, { header: "Confianza", width: 11 }, { header: "OmniVision vs cámara", width: 24 },
        ];
        cabecera(ws, 1);
        for (const fl of p.filas) {
            const ev = fl.eventos[0];
            const evV = fl.eventos.find((e) => e.vision);
            const c = evV ? compararVision(fl, evV) : null;
            const r = ws.addRow([
                enZona(fl.ts), fl.camara, PASO_ROTULO[fl.estado],
                fl.cam ? fl.cam.plate || "sin leer" : "", fl.cam?.capturas ?? null, fl.cam?.sinLeer ?? null, fl.cam ? fl.cam.variantes.slice(1).map((v) => `${v.plate}×${v.veces}`).join(", ") : "",
                fl.cam?.sentido === "forward" ? "entra" : fl.cam?.sentido === "reverse" ? "sale" : "",
                fl.eventos.map((e) => e.plate || "—").join(", "), ev ? (ev.decision === "DENY" ? "Denegado" : "Permitido") : "",
                ev && fl.cam ? (new Date(ev.ts).getTime() - new Date(fl.ts).getTime()) / 1000 : null,
                evV?.vision?.plate || "", evV?.vision?.estado || "", evV?.vision?.confianza ?? null, c ? VISION_ROTULO[c] : "",
            ]);
            r.getCell(1).numFmt = "dd/mm/yyyy hh:mm:ss"; r.getCell(11).numFmt = SEG; r.getCell(14).numFmt = "0%";
        }
        cuerpo(ws, 2);
        for (let i = 2; i <= ws.rowCount; i++) {
            const fl = p.filas[i - 2];
            if (fl.estado !== "coincide") tonoCelda(ws.getCell(i, 3), TONO[fl.estado]);
        }
        ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 15 } };
    }

    // ══ OmniVision ══
    {
        const ws = wb.addWorksheet("OmniVision", { views: [{ state: "frozen", ySplit: 1 }] });
        ws.columns = [{ header: "Fecha y hora", width: 19 }, { header: "Cámara", width: 26 }, { header: "Leyó la cámara", width: 15 }, { header: "Recibió OmniAccess", width: 18 }, { header: "Releyó OmniVision", width: 17 }, { header: "Estado", width: 12 }, { header: "Confianza", width: 11 }, { header: "Comparación", width: 26 }];
        cabecera(ws, 1);
        const tonos: string[] = [];
        for (const fl of p.filas) for (const e of fl.eventos) {
            const c = compararVision(fl, e);
            if (!c) continue;
            const r = ws.addRow([enZona(e.ts), fl.camara, fl.cam ? fl.cam.plate || "sin leer" : "", e.plate || "", e.vision?.plate || "", e.vision?.estado || "", e.vision?.confianza ?? null, VISION_ROTULO[c]]);
            r.getCell(1).numFmt = "dd/mm/yyyy hh:mm:ss"; r.getCell(7).numFmt = "0%";
            tonos.push(c);
        }
        cuerpo(ws, 2);
        tonos.forEach((c, i) => { if (c !== "coincide") tonoCelda(ws.getCell(i + 2, 8), TONO[c]); });
        ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 8 } };
    }

    // ══ Para revisar ══
    {
        const ws = wb.addWorksheet("Para revisar", { views: [{ state: "frozen", ySplit: 1 }] });
        ws.columns = [{ header: "Fecha y hora", width: 19 }, { header: "Cámara", width: 26 }, { header: "Motivo", width: 22 }, { header: "Leyó la cámara", width: 15 }, { header: "Otras lecturas", width: 24 }, { header: "Recibió OmniAccess", width: 19 }, { header: "Releyó OmniVision", width: 17 }, { header: "Confianza", width: 11 }];
        cabecera(ws, 1);
        const MOTIVO: Record<string, string> = { perdida: "No llegó", distinta: "Llegó otra chapa", "vision-distinta": "OmniVision leyó otra" };
        const motivos: string[] = [];
        for (const fl of p.filas) {
            const vd = fl.eventos.find((e) => compararVision(fl, e) === "distinta");
            const motivo = fl.estado === "perdida" || fl.estado === "distinta" ? fl.estado : vd ? "vision-distinta" : null;
            if (!motivo) continue;
            const v = (vd || fl.eventos.find((e) => e.vision))?.vision;
            const r = ws.addRow([enZona(fl.ts), fl.camara, MOTIVO[motivo], fl.cam?.plate || (fl.cam ? "sin leer" : ""), fl.cam ? fl.cam.variantes.slice(1).map((x) => x.plate).join(", ") : "", fl.eventos.map((e) => e.plate || "—").join(", ") || "nada", v?.plate || "", v?.confianza ?? null]);
            r.getCell(1).numFmt = "dd/mm/yyyy hh:mm:ss"; r.getCell(8).numFmt = "0%";
            motivos.push(motivo);
        }
        cuerpo(ws, 2);
        motivos.forEach((m, i) => tonoCelda(ws.getCell(i + 2, 3), TONO[m]));
        ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 8 } };
    }

    // Para imprimir: apaisado y a lo ancho de la hoja.
    for (const ws of wb.worksheets) ws.pageSetup = { orientation: "landscape", paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } };
    return Buffer.from(await wb.xlsx.writeBuffer());
}
