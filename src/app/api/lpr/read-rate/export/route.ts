import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { verifyApiAuth, unauthorizedResponse } from "@/lib/api-auth";
import { medirTasas, type CamaraTasa } from "@/lib/tasa-lectura-servidor";
import { estadoTasa, horaTxt } from "@/lib/tasa-lectura";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/lpr/read-rate/export?days=7 — la tasa de lectura en Excel (26/11, Nico: «poder exportar la
 * tasa de lectura claramente para ver qué cámara está capturando mal»).
 *
 *  · Resumen     — cada cámara (peor primero): método, intentos, leídas, tasa, día/noche, horas peores
 *                  y lo que conviene corregir.
 *  · Por hora    — cámara × hora, con la tasa coloreada: las horas malas se ven de un vistazo.
 *  · Sugerencias — una fila por corrección, para repartir el trabajo.
 * Los porcentajes van como número con formato de porcentaje (se pueden ordenar y graficar).
 */
const ROJO = "FFFDE2E2", AMBAR = "FFFEF3C7", VERDE = "FFDCFCE7", AZUL = "FF0A63B8";

export async function GET(req: NextRequest) {
    const auth = await verifyApiAuth();
    if (!auth.authenticated || auth.pantalla) return unauthorizedResponse();
    const days = Math.min(90, Math.max(1, parseInt(req.nextUrl.searchParams.get("days") || "7", 10)));
    const t = await medirTasas(days);
    const filas: (CamaraTasa & { grupo: string })[] = [
        ...t.accesos.camaras.map((c) => ({ ...c, grupo: "Acceso" })),
        ...t.interiores.camaras.map((c) => ({ ...c, grupo: "Interior" })),
    ].sort((a, b) => (a.ratePct ?? 101) - (b.ratePct ?? 101));

    const wb = new ExcelJS.Workbook();
    wb.creator = "OmniAccess"; wb.title = "Tasa de lectura"; wb.created = new Date();
    const cab = (ws: ExcelJS.Worksheet) => {
        const r = ws.getRow(1); r.height = 26;
        r.eachCell((c) => { c.font = { bold: true, color: { argb: "FFFFFFFF" } }; c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: AZUL } }; c.alignment = { vertical: "middle" }; });
        ws.views = [{ state: "frozen", ySplit: 1 }];
    };
    const tono = (v: number | null) => (v == null ? undefined : v >= 90 ? VERDE : v >= 75 ? AMBAR : ROJO);
    const pinta = (c: ExcelJS.Cell, v: number | null) => { const t2 = tono(v); if (t2) c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: t2 } }; };

    const res = wb.addWorksheet("Resumen");
    res.columns = [
        { header: "Cámara", key: "name", width: 28 }, { header: "Grupo", key: "grupo", width: 10 }, { header: "Método", key: "metodo", width: 12 },
        { header: "Intentos", key: "total", width: 10 }, { header: "Leídas", key: "read", width: 10 }, { header: "Sin leer", key: "unread", width: 10 },
        { header: "Tasa", key: "tasa", width: 9 }, { header: "Estado", key: "estado", width: 11 }, { header: "Día", key: "dia", width: 8 }, { header: "Noche", key: "noche", width: 8 },
        { header: "Horas peores", key: "peores", width: 34 }, { header: "Rescatadas por OmniVision", key: "rec", width: 14 }, { header: "Por escena", key: "escena", width: 11 },
        { header: "Fuera de zona", key: "fuera", width: 12 }, { header: "Última lectura", key: "ultima", width: 18 }, { header: "Qué corregir", key: "sug", width: 90 },
    ];
    for (const c of filas) {
        const r = res.addRow({
            name: c.name, grupo: c.grupo, metodo: c.metodo === "anpr" ? "ANPR cámara" : "OmniVision", total: c.total, read: c.read, unread: c.unread,
            tasa: c.ratePct == null ? null : c.ratePct / 100, estado: estadoTasa(c.ratePct), dia: c.dia == null ? null : c.dia / 100, noche: c.noche == null ? null : c.noche / 100,
            peores: c.peores.map((h) => `${horaTxt(h.hour)} (${Math.round(h.ratePct || 0)}%)`).join(", "), rec: c.metodo === "anpr" ? c.recuperadas ?? 0 : null,
            escena: c.minutosEscenaPct == null ? null : c.minutosEscenaPct / 100, fuera: c.fueraDeLinea ?? null,
            ultima: c.ultima ? new Date(c.ultima) : null, sug: c.sugerencias.map((s) => `${s.titulo}: ${s.detalle}`).join("\n"),
        });
        for (const k of ["tasa", "dia", "noche", "escena"]) r.getCell(k).numFmt = "0.0%";
        r.getCell("ultima").numFmt = "dd/mm/yyyy hh:mm";
        r.getCell("sug").alignment = { wrapText: true, vertical: "top" };
        pinta(r.getCell("tasa"), c.ratePct);
    }
    cab(res);

    const ph = wb.addWorksheet("Por hora");
    ph.columns = [{ header: "Cámara", key: "name", width: 28 }, { header: "Método", key: "metodo", width: 12 }, ...Array.from({ length: 24 }, (_, h) => ({ header: `${String(h).padStart(2, "0")} h`, key: `h${h}`, width: 7 }))];
    for (const c of filas) {
        const datos: Record<string, unknown> = { name: c.name, metodo: c.metodo === "anpr" ? "ANPR" : "OmniVision" };
        for (const h of c.horas) datos[`h${h.hour}`] = h.ratePct == null ? null : h.ratePct / 100;
        const r = ph.addRow(datos);
        for (const h of c.horas) { const cell = r.getCell(`h${h.hour}`); cell.numFmt = "0%"; if (h.total >= 5) pinta(cell, h.ratePct); }
    }
    cab(ph);

    const sg = wb.addWorksheet("Sugerencias");
    sg.columns = [{ header: "Cámara", key: "name", width: 28 }, { header: "Método", key: "metodo", width: 12 }, { header: "Gravedad", key: "g", width: 10 }, { header: "Qué pasa", key: "t", width: 32 }, { header: "Qué hacer", key: "d", width: 100 }];
    for (const c of filas) for (const s of c.sugerencias) {
        const r = sg.addRow({ name: c.name, metodo: c.metodo === "anpr" ? "ANPR" : "OmniVision", g: s.gravedad === "mal" ? "Alta" : s.gravedad === "aviso" ? "Media" : "Baja", t: s.titulo, d: s.detalle });
        r.getCell("d").alignment = { wrapText: true, vertical: "top" };
        r.getCell("g").fill = { type: "pattern", pattern: "solid", fgColor: { argb: s.gravedad === "mal" ? ROJO : s.gravedad === "aviso" ? AMBAR : "FFE0F2FE" } };
    }
    cab(sg);

    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const dia = new Date().toISOString().slice(0, 10);
    return new NextResponse(new Uint8Array(buf), { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="tasa-de-lectura-${days}d-${dia}.xlsx"`, "Cache-Control": "no-store" } });
}
