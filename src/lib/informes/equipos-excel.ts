/**
 * El inventario de equipos en Excel (26/11): el mismo informe que el PDF, para trabajarlo.
 *
 *  · Portada      — la marca de OmniAccess y del cliente, la ficha y las cifras;
 *  · Equipos      — TODOS, una fila por equipo, con filtro y cabecera fija;
 *  · Grabadores   — cada NVR con su hardware;
 *  · Discos       — cada disco de cada NVR, con su estado;
 *  · Áreas        — el árbol, con cuántos equipos tiene cada una.
 *
 * Las claves van sólo si se pidieron, en su columna y marcadas: la hoja «Equipos» queda protegida
 * contra cambios (no es cifrado: quien abre el archivo las lee) y la portada lo advierte.
 */
import ExcelJS from "exceljs";
import { COLOR, suave, isotipoPng, type Marca } from "@/lib/informes/marca";
import { discoBien, estadoDiscoTxt, tiempoPrendido, type Inventario } from "@/lib/informes/equipos-datos";

const argb = (hex: string) => "FF" + hex.replace("#", "").toUpperCase();
const FUENTE = "Outfit";
const ZONA = "America/Montevideo";
const fechaTxt = (iso: string | null) => (iso ? new Intl.DateTimeFormat("es-UY", { timeZone: ZONA, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso)).replace(",", "") : "");

export async function inventarioExcel(inv: Inventario, marca: Marca, generadoPor: string): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    wb.creator = marca.empresa; wb.company = marca.empresa; wb.title = "Inventario de equipos"; wb.created = new Date(inv.generado);

    const cabecera = (ws: ExcelJS.Worksheet, fila: number, derecha: number[] = []) => {
        const r = ws.getRow(fila); r.height = 28;
        r.eachCell((c, n) => {
            c.font = { name: FUENTE, bold: true, size: 10, color: { argb: "FFFFFFFF" } };
            c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: argb(COLOR.tinta) } };
            c.alignment = { vertical: "middle", horizontal: derecha.includes(n) ? "right" : "left", indent: 1, wrapText: true };
        });
    };
    const cuerpo = (ws: ExcelJS.Worksheet, desde: number) => {
        for (let i = desde; i <= ws.rowCount; i++) ws.getRow(i).eachCell({ includeEmpty: true }, (c) => {
            c.font = { name: FUENTE, size: 10, color: { argb: argb(COLOR.texto) }, ...(c.font || {}) };
            c.border = { bottom: { style: "hair", color: { argb: argb(COLOR.linea) } } };
            c.alignment = { vertical: "middle", ...(c.alignment || {}) };
        });
    };
    const tono = (c: ExcelJS.Cell, hex: string) => { c.font = { name: FUENTE, size: 10, bold: true, color: { argb: argb(hex) } }; c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: argb(suave(hex, 0.88)) } }; };
    const banda = (ws: ExcelJS.Worksheet, titulo: string, bajada: string, columnas: number) => {
        ws.mergeCells(1, 1, 1, columnas); ws.mergeCells(2, 1, 2, columnas);
        const a = ws.getCell(1, 1), b = ws.getCell(2, 1);
        a.value = titulo; b.value = bajada;
        a.font = { name: FUENTE, bold: true, size: 15, color: { argb: "FFFFFFFF" } };
        b.font = { name: FUENTE, size: 10, color: { argb: "FFCBD5E1" } };
        for (const c of [a, b]) { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: argb(marca.primario) } }; c.alignment = { vertical: "middle", indent: 1 }; }
        ws.getRow(1).height = 30; ws.getRow(2).height = 20;
        ws.addRow([]);
    };
    const t = inv.totales;

    // ══ Portada ══
    {
        const ws = wb.addWorksheet("Portada", { views: [{ showGridLines: false }] });
        ws.columns = [{ width: 4 }, { width: 34 }, { width: 22 }, { width: 22 }, { width: 22 }, { width: 22 }, { width: 22 }, { width: 4 }];
        // Un bloque oscuro a sangre, como la tapa del PDF: la marca arriba y el título grande.
        for (let r = 1; r <= 14; r++) { ws.getRow(r).height = r === 7 ? 46 : 20; for (let c = 1; c <= 8; c++) ws.getCell(r, c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: argb(marca.primario) } }; }
        for (let c = 1; c <= 8; c++) ws.getCell(1, c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: argb(COLOR.accion) } };
        ws.getRow(1).height = 5;
        const iso = await isotipoPng("#ffffff", 256);
        if (iso) ws.addImage(wb.addImage({ buffer: iso as unknown as ExcelJS.Buffer, extension: "png" }), { tl: { col: 1, row: 1.6 }, ext: { width: 44, height: 44 } });
        if (marca.logo) ws.addImage(wb.addImage({ buffer: marca.logo.png as unknown as ExcelJS.Buffer, extension: "png" }), { tl: { col: 5.2, row: 1.7 }, ext: { width: Math.min(220, 40 * (marca.logo.w / marca.logo.h)), height: 40 } });
        const put = (r: number, c: number, v: string, f: Partial<ExcelJS.Font>) => { const x = ws.getCell(r, c); x.value = v; x.font = { name: FUENTE, color: { argb: "FFFFFFFF" }, ...f }; x.alignment = { vertical: "middle" }; };
        put(3, 2, "      OMNIACCESS", { bold: true, size: 14 });
        put(4, 2, "      DISPOSITIVOS", { size: 8, color: { argb: "FF94A3B8" }, bold: true });
        put(6, 2, inv.conClaves ? "INVENTARIO DE EQUIPOS · CONFIDENCIAL" : "INVENTARIO DE EQUIPOS", { size: 8, bold: true, color: { argb: "FF7FB6F5" } });
        put(7, 2, marca.empresa, { size: 28, bold: true });
        put(8, 2, `${t.equipos} equipos en ${inv.areas.length} ${inv.areas.length === 1 ? "área" : "áreas"}`, { size: 11, color: { argb: "FF94A3B8" } });
        put(9, 2, `Al ${fechaTxt(inv.generado)}`, { size: 12, bold: true });
        const cifras: [string, string, string?][] = [
            [String(t.equipos), "equipos"], [String(t.enLinea), "en línea"], [String(t.fueraDeLinea), "fuera de línea", t.fueraDeLinea ? "FFFF6B84" : undefined],
            [String(t.nvrs), "grabadores"], [inv.conSalud ? `${t.discos - t.discosMal}/${t.discos}` : "—", "discos bien", t.discosMal ? "FFFF6B84" : undefined],
            [t.retProm != null ? `${t.retProm} d` : "—", "retención prom."],
        ];
        cifras.forEach(([v, q, c], i) => { put(11, 2 + i, v, { size: 18, bold: true, ...(c ? { color: { argb: c } } : {}) }); put(12, 2 + i, q, { size: 9, color: { argb: "FF94A3B8" } }); });
        put(14, 2, `Emitido el ${fechaTxt(inv.generado)} por ${marca.preparadoPor || generadoPor}`, { size: 9, color: { argb: "FFE2E8F0" } });
        ws.addRow([]);
        if (inv.conClaves) {
            const r = ws.addRow(["", "CONFIDENCIAL: este archivo trae usuarios y claves de los equipos. Guardalo como guardarías las llaves."]);
            ws.mergeCells(r.number, 2, r.number, 7); tono(r.getCell(2), COLOR.mal); r.height = 26;
            ws.addRow([]);
        }
        const tc = ws.addRow(["", "Equipos por tipo", "Cantidad"]); cabecera(ws, tc.number, [3]);
        for (let c = 4; c <= 8; c++) ws.getCell(tc.number, c).fill = { type: "pattern", pattern: "none" };
        const i0 = ws.rowCount + 1;
        for (const x of t.porTipo) ws.addRow(["", x.rotulo, x.n]);
        cuerpo(ws, i0);
        ws.addRow([]);
        const nota = ws.addRow(["", "Cada hoja tiene su filtro. «Equipos» trae todos; «Grabadores» y «Discos», el hardware de cada NVR preguntado al armar el informe."]);
        ws.mergeCells(nota.number, 2, nota.number, 7); nota.getCell(2).font = { name: FUENTE, italic: true, size: 9, color: { argb: argb(COLOR.gris) } };
        ws.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 };
    }

    // ══ Equipos ══
    {
        const ws = wb.addWorksheet("Equipos", { views: [{ state: "frozen", ySplit: 4, xSplit: 1, showGridLines: false }] });
        const cols: { r: string; w: number; der?: boolean }[] = [
            { r: "Nombre", w: 32 }, { r: "Tipo", w: 22 }, { r: "Área", w: 30 }, { r: "Marca", w: 12 }, { r: "Modelo", w: 22 }, { r: "Firmware", w: 16 },
            { r: "IP", w: 15 }, { r: "Puerto HTTP", w: 11, der: true }, { r: "MAC", w: 19 }, { r: "Ubicación", w: 18 }, { r: "Sentido", w: 10 },
            { r: "NVR", w: 24 }, { r: "Canal", w: 8, der: true }, { r: "Retención (días)", w: 14, der: true }, { r: "Graba", w: 9 }, { r: "Grabación desde", w: 16 },
            { r: "Usuario", w: 14 }, ...(inv.conClaves ? [{ r: "Clave", w: 18 }] : []), { r: "Estado", w: 14 }, { r: "Latencia (ms)", w: 12, der: true }, { r: "Alertas abiertas", w: 36 },
            { r: "Comprobado", w: 17 }, { r: "Alta", w: 17 },
        ];
        ws.columns = cols.map((c) => ({ width: c.w }));
        banda(ws, `Equipos · ${marca.empresa}`, `${t.equipos} equipos · al ${fechaTxt(inv.generado)}${inv.conClaves ? " · CONFIDENCIAL: incluye claves" : ""}`, cols.length);
        const cab = ws.addRow(cols.map((c) => c.r)); cabecera(ws, cab.number, cols.map((c, i) => (c.der ? i + 1 : 0)).filter(Boolean));
        const i0 = ws.rowCount + 1;
        for (const e of inv.equipos) {
            const r = ws.addRow([
                e.nombre, e.rotuloTipo, e.area, e.marca, e.modelo, e.firmware, e.ip, e.puertoHttp, e.mac, e.ubicacion, e.sentido,
                e.tipo === "NVR" ? null : e.nvr, e.canal, e.retencion && !e.retencion.error ? e.retencion.dias : null,
                e.retencion ? (e.retencion.grabando === false ? "No" : e.retencion.grabando ? "Sí" : null) : null, e.retencion?.desde ? e.retencion.desde.slice(0, 10) : null,
                e.usuario, ...(inv.conClaves ? [e.clave] : []),
                e.enLinea === null ? "sin dato" : e.enLinea ? "En línea" : "Fuera de línea", e.latenciaMs, e.alertas.join(" · ") || null,
                fechaTxt(e.comprobado) || null, fechaTxt(e.alta),
            ]);
            r.getCell(1).font = { name: FUENTE, bold: true, size: 10 };
            const est = r.getCell(cols.findIndex((c) => c.r === "Estado") + 1);
            if (e.enLinea === false) tono(est, COLOR.mal); else if (e.enLinea) tono(est, COLOR.bien);
            if (e.alertas.length) tono(r.getCell(cols.findIndex((c) => c.r === "Alertas abiertas") + 1), COLOR.avisoTexto);
            if (e.retencion?.grabando === false) tono(r.getCell(cols.findIndex((c) => c.r === "Graba") + 1), COLOR.mal);
            if (inv.conClaves) r.getCell(cols.findIndex((c) => c.r === "Clave") + 1).font = { name: FUENTE, size: 10, color: { argb: argb(COLOR.mal) } };
        }
        cuerpo(ws, i0);
        if (inv.equipos.length) ws.autoFilter = { from: { row: cab.number, column: 1 }, to: { row: cab.number + inv.equipos.length, column: cols.length } };
        if (inv.conClaves) await ws.protect("", { selectLockedCells: true, selectUnlockedCells: true, autoFilter: true, sort: true, formatColumns: true });
        ws.headerFooter.oddFooter = `&L${marca.pie}${inv.conClaves ? " · CONFIDENCIAL" : ""}&RPágina &P de &N`;
        ws.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 };
    }

    // ══ Grabadores ══
    {
        const ws = wb.addWorksheet("Grabadores", { views: [{ state: "frozen", ySplit: 4, showGridLines: false }] });
        const cols = ["Nombre", "Área", "Marca", "Modelo", "Firmware", "IP", "MAC", "Estado", "Latencia (ms)", "Prendido hace", "Memoria (%)", "Discos", "Discos con problema", "Cámaras", "Usuario", ...(inv.conClaves ? ["Clave"] : [])];
        ws.columns = cols.map((c) => ({ width: Math.max(12, c.length + 4) })); ws.getColumn(1).width = 28; ws.getColumn(2).width = 26;
        banda(ws, "Grabadores", inv.conSalud ? "Salud preguntada a cada NVR al armar el informe" : "Sin salud en vivo", cols.length);
        const cab = ws.addRow(cols); cabecera(ws, cab.number, [9, 11, 12, 13, 14]);
        const i0 = ws.rowCount + 1;
        for (const n of inv.nvrs) {
            const s = n.salud, d = s?.discos || [];
            const r = ws.addRow([n.nombre, n.area, n.marca, n.modelo, n.firmware, n.ip, n.mac, !inv.conSalud ? "sin consultar" : s?.alcanzable ? "Responde" : "No contesta", s?.latenciaMs ?? null, tiempoPrendido(s?.uptimeSec), s?.memoriaPct ?? null, d.length, d.filter((x) => !discoBien(x.estado)).length, n.camaras, n.usuario, ...(inv.conClaves ? [n.clave] : [])]);
            r.getCell(1).font = { name: FUENTE, bold: true, size: 10 };
            if (inv.conSalud) tono(r.getCell(8), s?.alcanzable ? COLOR.bien : COLOR.mal);
            if (d.some((x) => !discoBien(x.estado))) tono(r.getCell(13), COLOR.mal);
        }
        cuerpo(ws, i0);
    }

    // ══ Discos ══
    {
        const ws = wb.addWorksheet("Discos", { views: [{ state: "frozen", ySplit: 4, showGridLines: false }] });
        ws.columns = [{ width: 28 }, { width: 14 }, { width: 16 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 28 }];
        banda(ws, "Discos de los grabadores", "Estado, capacidad y ocupación de cada disco", 7);
        const cab = ws.addRow(["NVR", "Disco", "Estado", "Estado (crudo)", "Capacidad (TB)", "Ocupado", "Modelo"]); cabecera(ws, cab.number, [5, 6]);
        const i0 = ws.rowCount + 1;
        for (const n of inv.nvrs) for (const d of n.salud?.discos || []) {
            const r = ws.addRow([n.nombre, d.nombre, estadoDiscoTxt(d.estado), d.estado, d.capacidadGB ? Math.round((d.capacidadGB / 1024) * 10) / 10 : null, d.usadoPct / 100, d.modelo]);
            r.getCell(5).numFmt = "0.0"; r.getCell(6).numFmt = "0%";
            if (!discoBien(d.estado)) tono(r.getCell(3), COLOR.mal); else tono(r.getCell(3), COLOR.bien);
        }
        if (ws.rowCount < i0) ws.addRow([inv.conSalud ? "Ningún grabador informó discos." : "El informe se pidió sin preguntar a los grabadores."]).getCell(1).font = { name: FUENTE, italic: true, color: { argb: argb(COLOR.gris) } };
        cuerpo(ws, i0);
    }

    // ══ Áreas ══
    {
        const ws = wb.addWorksheet("Áreas", { views: [{ showGridLines: false }] });
        ws.columns = [{ width: 50 }, { width: 12 }, { width: 14 }, { width: 14 }];
        banda(ws, "Áreas", "El árbol de áreas de Dispositivos", 4);
        const cab = ws.addRow(["Área", "Nivel", "Equipos", "En línea"]); cabecera(ws, cab.number, [2, 3, 4]);
        const i0 = ws.rowCount + 1;
        for (const a of inv.areas) {
            const es = inv.equipos.filter((e) => e.areaId === a.id);
            const r = ws.addRow([`${"    ".repeat(a.nivel)}${a.nombre}`, a.nivel + 1, es.length, es.filter((e) => e.enLinea).length]);
            if (a.nivel === 0) r.getCell(1).font = { name: FUENTE, bold: true, size: 10 };
        }
        const sin = inv.equipos.filter((e) => !e.areaId);
        if (sin.length) ws.addRow(["Sin área", null, sin.length, sin.filter((e) => e.enLinea).length]);
        cuerpo(ws, i0);
    }
    return Buffer.from(await wb.xlsx.writeBuffer());
}
