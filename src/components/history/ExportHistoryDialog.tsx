"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Cajon, CajonContenido, CajonSeccion } from "@/components/ui/cajon";
import { Bot, Calendar as CalendarIcon, Camera, Car, Check, Download, Filter, KeyRound, Loader2, ScanLine, ShieldAlert, Sparkles, Ticket } from "lucide-react";
import { cn } from "@/lib/utils";
import { getAccessEvents, getReporteComplementario, getLecturasInteriores, opcionesExportacion, visionParaExportar } from "@/app/actions/history";
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

/**
 * Qué se puede exportar, cada cosa en su pestaña. Antes iba todo siempre (y sin las lecturas de
 * las cámaras interiores, que no estaban): un Excel de un mes con el bot de WhatsApp adentro
 * cuando se quería mostrar las entradas de un auto.
 */
const CONTENIDOS = [
    { id: "accesos", rotulo: "Accesos", detalle: "Barreras, lectoras faciales y tarjetas: quién, cuándo, permitido o no.", Ico: KeyRound },
    { id: "lecturas", rotulo: "Lecturas de cámaras interiores", detalle: "Pasos, estacionados y vistos del seguimiento.", Ico: ScanLine },
    { id: "intrusiones", rotulo: "Intrusiones", detalle: "Cruces de línea y zonas, y cómo se atendieron.", Ico: ShieldAlert },
    { id: "bot", rotulo: "Bot de WhatsApp", detalle: "Lo que pidieron los vecinos y qué se les contestó.", Ico: Bot },
    { id: "invitados", rotulo: "Invitados", detalle: "Invitaciones, invitados y sus ingresos.", Ico: Ticket },
] as const;
type Contenido = (typeof CONTENIDOS)[number]["id"];

const PERIODOS = [
    { id: "hoy", rotulo: "Hoy" }, { id: "ayer", rotulo: "Ayer" }, { id: "7d", rotulo: "7 días" },
    { id: "30d", rotulo: "30 días" }, { id: "mes", rotulo: "Este mes" }, { id: "otro", rotulo: "Otro" },
] as const;
const dia = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
function rangoDe(p: string): [string, string] {
    const hoy = new Date();
    const menos = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return d; };
    if (p === "ayer") return [dia(menos(1)), dia(menos(1))];
    if (p === "7d") return [dia(menos(6)), dia(hoy)];
    if (p === "30d") return [dia(menos(29)), dia(hoy)];
    if (p === "mes") return [dia(new Date(hoy.getFullYear(), hoy.getMonth(), 1)), dia(hoy)];
    return [dia(hoy), dia(hoy)];
}
const TIPO_EQUIPO: Record<string, string> = { LPR_CAMERA: "Lectoras de matrícula", LPR_INTERIOR: "Cámaras interiores", CAMERA: "Cámaras", FACE_TERMINAL: "Lectoras faciales", ACCESS_CONTROL: "Control de acceso", DOOR_INTERCOM: "Porteros" };

export function ExportHistoryDialog({ open, onOpenChange, filters }: ExportHistoryDialogProps) {
    const [periodo, setPeriodo] = useState<string>("hoy");
    const [startDate, setStartDate] = useState(dia(new Date()));
    const [endDate, setEndDate] = useState(dia(new Date()));
    const [isExporting, setIsExporting] = useState(false);
    const [incluir, setIncluir] = useState<Set<Contenido>>(new Set(["accesos", "lecturas", "intrusiones", "bot", "invitados"]));
    const [equipos, setEquipos] = useState<{ id: string; nombre: string; tipo: string }[]>([]);
    /** Vacío = todas las cámaras. */
    const [camaras, setCamaras] = useState<Set<string>>(new Set());
    const [decision, setDecision] = useState(filters?.decision || "ALL");
    const [sentido, setSentido] = useState(filters?.direction || "ALL");
    const [identificacion, setIdentificacion] = useState(filters?.type || "ALL");
    const [conBusqueda, setConBusqueda] = useState(!!filters?.search);
    const [conVision, setConVision] = useState(true);
    const [avance, setAvance] = useState("");
    // Al abrir, se parte de lo que se está mirando en la pantalla.
    useEffect(() => {
        if (!open) return;
        setDecision(filters?.decision || "ALL"); setSentido(filters?.direction || "ALL"); setIdentificacion(filters?.type || "ALL"); setConBusqueda(!!filters?.search);
        opcionesExportacion().then(setEquipos).catch(() => setEquipos([]));
    }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
    const elegirPeriodo = (p: string) => { setPeriodo(p); if (p !== "otro") { const [a, b] = rangoDe(p); setStartDate(a); setEndDate(b); } };
    const alternar = <T,>(set: Set<T>, v: T) => { const n = new Set(set); if (n.has(v)) n.delete(v); else n.add(v); return n; };
    const grupos = useMemo(() => {
        const m = new Map<string, typeof equipos>();
        for (const e of equipos) m.set(e.tipo, [...(m.get(e.tipo) || []), e]);
        return [...m.entries()];
    }, [equipos]);

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
            const ids = camaras.size ? [...camaras] : undefined;
            const delEquipo = (id?: string | null) => !ids || (!!id && camaras.has(id));

            setAvance("Trayendo los registros…");
            const [response, extraTodo, lecturas] = await Promise.all([
                incluir.has("accesos") ? getAccessEvents({
                    from: fromDate, to: toDate,
                    search: conBusqueda ? filters?.search : undefined, decision, type: identificacion, direction: sentido,
                    take: 100000, skip: 0, omitEnrichment: true,
                }) : Promise.resolve({ events: [] as any[] }),
                incluir.has("intrusiones") || incluir.has("bot") || incluir.has("invitados")
                    ? getReporteComplementario(fromDate, toDate) : Promise.resolve({ detecciones: [], charlas: [], invitaciones: [] } as unknown as Awaited<ReturnType<typeof getReporteComplementario>>),
                incluir.has("lecturas") ? getLecturasInteriores(fromDate, toDate, ids) : Promise.resolve([] as any[]),
            ]);
            const events = (response.events as any[]).filter((e) => delEquipo(e.deviceId || e.device?.id));
            const extra = { ...extraTodo, detecciones: extraTodo.detecciones.filter((d) => delEquipo(d.deviceId)) };
            // Lo que vio OmniVision en cada acceso, de a tandas (una planilla de un mes son miles).
            const vision: Record<string, { vio: string; releida: string | null }> = {};
            if (conVision && events.length) {
                const TANDA = 2000;
                for (let i = 0; i < events.length; i += TANDA) {
                    setAvance(`Sumando lo que vio OmniVision… ${Math.min(events.length, i + TANDA)} de ${events.length}`);
                    Object.assign(vision, await visionParaExportar(events.slice(i, i + TANDA).map((e) => e.id)).catch(() => ({})));
                }
            }
            setAvance("Armando el Excel…");

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
            if (conBusqueda && filters?.search) filterTerms.push(`Búsqueda: "${filters.search}"`);
            if (identificacion !== "ALL") filterTerms.push(`Tipo: ${identificacion}`);
            if (decision !== "ALL") filterTerms.push(`Resultado: ${decision}`);
            if (sentido !== "ALL") filterTerms.push(`Sentido: ${sentido}`);
            if (filterTerms.length) resumen.addRow([`Filtros activos (sólo en Accesos): ${filterTerms.join(" | ")}`]);
            resumen.addRow([]);
            const cuenta = (f: (e: any) => boolean) => events.filter(f).length;
            const camarasTxt = ids ? equipos.filter((e) => camaras.has(e.id)).map((e) => e.nombre).join(", ") : "todas";
            resumen.addRow([`Cámaras: ${camarasTxt}`]);
            const filasResumen: [string, number][] = [
                ["Lecturas de cámaras interiores", (lecturas as any[]).length],
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
            resumen.addRow([`Pestañas: ${CONTENIDOS.filter((c) => incluir.has(c.id)).map((c) => c.rotulo).join(" · ")}${incluir.has("accesos") ? " · Buscar" : ""}. Cada tabla tiene filtros en la cabecera (la flecha de cada columna).`]).font = { italic: true, color: { argb: "FF6B7280" } };

            // ── Lecturas de cámaras interiores ───────────────────────────────────────
            if (incluir.has("lecturas")) {
                const wl = workbook.addWorksheet("Lecturas interiores");
                wl.columns = [{ key: "date", width: 12 }, { key: "time", width: 10 }, { key: "plate", width: 12 }, { key: "camara", width: 24 }, { key: "estado", width: 13 }, { key: "desde", width: 16 }, { key: "hasta", width: 16 }, { key: "conf", width: 11 }, { key: "reads", width: 9 }, { key: "foto", width: 44 }, { key: "id", width: 26 }];
                pintarCabecera(wl, ["Fecha", "Hora", "Matrícula", "Cámara", "Qué", "Desde", "Hasta", "Confianza", "Cuadros", "Foto", "ID"]);
                const ESTADO_L: Record<string, string> = { PASO: "Pasó", ESTACIONADO: "Estacionado", VISTO: "Visto" };
                (lecturas as any[]).forEach((l) => {
                    const ts = new Date(l.timestamp);
                    const row = wl.addRow({ date: fecha(ts), time: horaSeg(ts), plate: l.plate, camara: l.cameraName || "", estado: ESTADO_L[l.estado] || l.estado,
                        desde: l.estDesde ? fechaHora(new Date(l.estDesde)) : "", hasta: l.estHasta ? fechaHora(new Date(l.estHasta)) : "",
                        conf: l.confidence != null ? l.confidence : "", reads: l.reads ?? "", foto: l.snapshotUrl ? `${window.location.origin}${getImagePath(l.snapshotUrl) || ""}` : "", id: l.id });
                    row.getCell("conf").numFmt = "0%";
                    if (l.snapshotUrl) { const c = row.getCell("foto"); c.value = { text: "ver foto", hyperlink: String(c.value) }; c.font = { color: { argb: "FF2563EB" }, underline: true }; }
                });
                cerrarTabla(wl, 11, ["date", "time", "plate", "estado", "conf", "reads"]);
            }

            // ── Accesos ──────────────────────────────────────────────────────────────
            if (incluir.has("accesos")) {
            const ws = workbook.addWorksheet("Accesos");
            ws.columns = [
                { key: "date", width: 12 }, { key: "time", width: 10 }, { key: "plate", width: 12 }, { key: "type", width: 9 },
                { key: "direction", width: 10 }, { key: "decision", width: 12 }, { key: "user", width: 28 }, { key: "unit", width: 16 },
                { key: "device", width: 22 }, { key: "metodo", width: 13 }, { key: "confianza", width: 11 },
                { key: "marca", width: 14 }, { key: "modelo", width: 14 }, { key: "color", width: 10 }, { key: "vtipo", width: 12 },
                { key: "foto", width: 44 }, { key: "details", width: 40 }, { key: "id", width: 26 },
                ...(conVision ? [{ key: "vio", width: 36 }, { key: "releida", width: 16 }] : []),
            ];
            pintarCabecera(ws, ["Fecha", "Hora", "Matrícula", "Tipo", "Sentido", "Resultado", "Sujeto / Residente", "Unidad", "Punto de acceso", "Método", "Confianza", "Marca", "Modelo", "Color", "Tipo vehículo", "Foto", "Detalles", "ID de evento", ...(conVision ? ["OmniVision vio", "Releída por OmniVision"] : [])]);
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
                    ...(conVision ? { vio: vision[e.id]?.vio || "", releida: vision[e.id]?.releida || "" } : {}),
                });
                row.getCell("confianza").numFmt = "0%";
                colorDecision(row.getCell("decision"), e.decision);
                if (e.snapshotPath) { const c = row.getCell("foto"); c.value = { text: "ver foto", hyperlink: String(c.value) }; c.font = { color: { argb: "FF2563EB" }, underline: true }; }
            });
            cerrarTabla(ws, conVision ? 20 : 18, ["date", "time", "plate", "type", "direction", "decision", "metodo", "confianza"]);
            }

            // ── Intrusiones ──────────────────────────────────────────────────────────
            if (incluir.has("intrusiones")) {
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
            }

            // ── Bot WhatsApp ─────────────────────────────────────────────────────────
            if (incluir.has("bot")) {
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
            }

            // ── Invitados ────────────────────────────────────────────────────────────
            if (incluir.has("invitados")) {
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
            }

            // ── Buscar ───────────────────────────────────────────────────────────────
            // Un buscador adentro del Excel: se escribe en B2 y la tabla de abajo muestra
            // los accesos cuya matrícula, sujeto, unidad o cámara contienen ese texto. Usa
            // FILTER (Excel 2021 / Microsoft 365, LibreOffice 24.8+); en un Excel más viejo
            // la celda muestra #NAME? y la nota de al lado dice qué usar en su lugar. Va
            // como fórmula de matriz sobre un rango fijo —lo único que ExcelJS sabe
            // escribir—, así que las filas que sobran se dejan en blanco con IFERROR.
            if (incluir.has("accesos")) {
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
            }

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
            setAvance("");
        }
    };

    const BOTON_OPCION = "h-8 px-3 rounded-full text-[12.5px] font-semibold border transition-colors";
    const opcion = (activa: boolean) => cn(BOTON_OPCION, activa ? "bg-foreground text-background border-transparent" : "border-border text-muted-foreground hover:text-foreground");
    const nada = incluir.size === 0;

    return (
        <Cajon open={open} onOpenChange={(o) => { if (!isExporting) onOpenChange(o); }}>
            <CajonContenido ancho="intermedio" titulo="Exportar el historial"
                descripcion="Un Excel con una pestaña por cosa que elijas, cada una con filtros en la cabecera, y un resumen del período."
                pie={
                    <div className="flex items-center gap-3 w-full">
                        <span className="text-[12px] text-muted-foreground flex-1 min-w-0 truncate">{isExporting ? avance : nada ? "Elegí al menos una cosa para exportar." : `${incluir.size} ${incluir.size === 1 ? "pestaña" : "pestañas"} · ${camaras.size ? `${camaras.size} ${camaras.size === 1 ? "cámara" : "cámaras"}` : "todas las cámaras"}`}</span>
                        <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={isExporting}>Cancelar</Button>
                        <Button onClick={handleExport} disabled={isExporting || nada} className="accion">
                            {isExporting ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />} Descargar Excel
                        </Button>
                    </div>
                }>
                <CajonSeccion titulo="Período" icono={CalendarIcon}>
                    <div className="flex flex-wrap gap-1.5">
                        {PERIODOS.map((p) => <button key={p.id} type="button" onClick={() => elegirPeriodo(p.id)} aria-pressed={periodo === p.id} className={opcion(periodo === p.id)}>{p.rotulo}</button>)}
                    </div>
                    <div className="grid grid-cols-2 gap-3 mt-2">
                        {([["Desde", startDate, setStartDate], ["Hasta", endDate, setEndDate]] as const).map(([r, v, set]) => (
                            <label key={r} className="block">
                                <span className="text-[11.5px] text-muted-foreground">{r}</span>
                                <input type="date" value={v} max={dia(new Date())} onChange={(e) => { set(e.target.value); setPeriodo("otro"); }}
                                    className="mt-1 w-full h-9 rounded-[6px] border border-border bg-background px-2.5 text-[13px] tabular-nums outline-none focus:border-[var(--accion)]" />
                            </label>
                        ))}
                    </div>
                </CajonSeccion>

                <CajonSeccion titulo="Qué incluir" icono={Filter} ayuda="Cada cosa va en su pestaña. Se pueden exportar todas juntas.">
                    <div className="rounded-[10px] border border-border divide-y divide-border">
                        {CONTENIDOS.map((c) => {
                            const on = incluir.has(c.id);
                            return (
                                <button key={c.id} type="button" onClick={() => setIncluir(alternar(incluir, c.id))} aria-pressed={on}
                                    className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-accent/50">
                                    <span className={cn("grid h-5 w-5 place-items-center rounded-[5px] border shrink-0", on ? "bg-[var(--accion)] border-transparent text-white" : "border-border")}>{on && <Check size={13} strokeWidth={3} />}</span>
                                    <c.Ico size={16} className="text-muted-foreground shrink-0" />
                                    <span className="min-w-0"><span className="block text-[13px] font-semibold">{c.rotulo}</span><span className="block text-[11.5px] text-muted-foreground">{c.detalle}</span></span>
                                </button>
                            );
                        })}
                    </div>
                    <div className="flex gap-2 mt-2">
                        <button type="button" onClick={() => setIncluir(new Set(CONTENIDOS.map((c) => c.id)))} className="text-[12px] font-semibold tono-accion">Todo</button>
                        <span className="text-muted-foreground text-[12px]">·</span>
                        <button type="button" onClick={() => setIncluir(new Set(["accesos"]))} className="text-[12px] font-semibold tono-accion">Sólo accesos</button>
                    </div>
                </CajonSeccion>

                <CajonSeccion titulo="Cámaras" icono={Camera} ayuda="Para accesos, lecturas interiores e intrusiones. Sin elegir ninguna, van todas.">
                    <div className="flex flex-wrap gap-1.5">
                        <button type="button" onClick={() => setCamaras(new Set())} aria-pressed={!camaras.size} className={opcion(!camaras.size)}>Todas</button>
                    </div>
                    {grupos.map(([tipo, lista]) => (
                        <div key={tipo} className="mt-2.5">
                            <div className="text-[11px] text-muted-foreground mb-1">{TIPO_EQUIPO[tipo] || tipo}</div>
                            <div className="flex flex-wrap gap-1.5">
                                {lista.map((e) => <button key={e.id} type="button" onClick={() => setCamaras(alternar(camaras, e.id))} aria-pressed={camaras.has(e.id)} className={opcion(camaras.has(e.id))}>{e.nombre}</button>)}
                            </div>
                        </div>
                    ))}
                </CajonSeccion>

                {incluir.has("accesos") && (
                    <CajonSeccion titulo="Accesos" icono={Car} ayuda="Arranca con los filtros que tenés puestos en la pantalla.">
                        {([
                            ["Resultado", decision, setDecision, [["ALL", "Todos"], ["GRANT", "Permitidos"], ["DENY", "Denegados"]]],
                            ["Sentido", sentido, setSentido, [["ALL", "Ambos"], ["ENTRY", "Entradas"], ["EXIT", "Salidas"]]],
                            ["Con qué", identificacion, setIdentificacion, [["ALL", "Todo"], ["PLATE", "Matrícula"], ["FACE", "Rostro"], ["TAG", "Tarjeta"]]],
                        ] as const).map(([r, v, set, ops]) => (
                            <div key={r} className="flex items-center gap-3 flex-wrap mb-2">
                                <span className="w-20 text-[12px] text-muted-foreground">{r}</span>
                                <div className="flex flex-wrap gap-1.5">{ops.map(([k, t]) => <button key={k} type="button" onClick={() => (set as any)(k)} aria-pressed={v === k} className={opcion(v === k)}>{t}</button>)}</div>
                            </div>
                        ))}
                        {filters?.search && (
                            <label className="flex items-center gap-2 text-[12.5px] mt-1 cursor-pointer">
                                <input type="checkbox" checked={conBusqueda} onChange={(e) => setConBusqueda(e.target.checked)} className="accent-[var(--accion)] w-4 h-4" />
                                Sólo lo que coincide con la búsqueda «{filters.search}»
                            </label>
                        )}
                        <label className="flex items-center gap-2 text-[12.5px] mt-1.5 cursor-pointer">
                            <input type="checkbox" checked={conVision} onChange={(e) => setConVision(e.target.checked)} className="accent-[var(--accion)] w-4 h-4" />
                            <Sparkles size={13} className="tono-accion" /> Sumar lo que vio OmniVision y las chapas que releyó
                        </label>
                    </CajonSeccion>
                )}
            </CajonContenido>
        </Cajon>
    );
}
