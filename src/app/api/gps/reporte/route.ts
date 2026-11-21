import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/app/actions/auth";
import { permisosDeSesion } from "@/lib/permisos";
import { SATS_MIN } from "@/lib/gps-recorrido";
import { viajesYParadas } from "@/lib/gps-viajes";
import { demoraLegible, fichaDeEventoGps, tituloDeEventoGps } from "@/lib/gps-eventos";
import { ZONA, IDIOMA } from "@/lib/fechas";

export const dynamic = "force-dynamic";

/**
 * GET /api/gps/reporte?imei=…&dias=7 → el reporte de un vehículo, en una planilla.
 *
 * Es lo que pide un cliente de seguimiento después de mirar el mapa: «mandame qué hizo la camioneta
 * esta semana». Cuatro hojas —resumen por día, viajes, paradas y eventos— con lo mismo que
 * muestra la pantalla, calculado con las mismas reglas (lib/gps-viajes): sólo posiciones con buena
 * señal, y un viaje es un viaje si se alejó de donde salió.
 *
 * Las horas van como TEXTO en la hora del barrio. Una fecha de Excel no tiene zona: el mismo
 * archivo abierto en otra computadora mostraría otra hora, y en un reporte que puede terminar
 * delante de un cliente o de un seguro eso no puede depender de quién lo abre.
 */

const DIAS_MAX = 31;
const fmt = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(IDIOMA, { timeZone: ZONA, hour12: false, ...o });
const F_DIA = fmt({ weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" });
const F_HORA = fmt({ hour: "2-digit", minute: "2-digit", second: "2-digit" });
const F_CLAVE = new Intl.DateTimeFormat("en-CA", { timeZone: ZONA, year: "numeric", month: "2-digit", day: "2-digit" });
const dur = (min: number) => (min >= 60 ? `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, "0")} min` : `${min} min`);

export async function GET(req: NextRequest) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- la sesión es el JWT crudo
    const s: any = await getSession().catch(() => null);
    if (!s) return NextResponse.json({ error: "Hace falta iniciar sesión." }, { status: 401 });
    if (!permisosDeSesion(s).includes("dispositivos")) return NextResponse.json({ error: "Tu rol no puede ver los equipos." }, { status: 403 });

    const imei = (req.nextUrl.searchParams.get("imei") || "").replace(/\D/g, "").slice(0, 20);
    const dias = Math.min(Math.max(Number(req.nextUrl.searchParams.get("dias")) || 7, 1), DIAS_MAX);
    const e = imei ? await prisma.gpsEquipo.findUnique({ where: { imei } }) : null;
    if (!e || !e.deviceId) return NextResponse.json({ error: "Ese rastreador no existe o no está dado de alta." }, { status: 404 });

    const desde = new Date(Date.now() - dias * 86_400_000);
    const [filas, eventos, veh] = await Promise.all([
        prisma.gpsPosicion.findMany({ where: { imei, cuando: { gte: desde }, satelites: { gte: SATS_MIN } }, orderBy: { cuando: "asc" }, take: 400_000, select: { lat: true, lon: true, cuando: true, velocidad: true } }),
        prisma.gpsEvento.findMany({ where: { imei, cuando: { gte: desde } }, orderBy: { cuando: "asc" }, take: 20_000 }),
        e.vehicleId ? prisma.vehicle.findUnique({ where: { id: e.vehicleId }, select: { plate: true } }).catch(() => null) : null,
    ]);
    const puntos = filas.map((f) => ({ lat: f.lat, lon: f.lon, cuando: f.cuando.toISOString(), velocidad: f.velocidad }));
    const { viajes, paradas } = viajesYParadas(puntos);
    const nombre = e.nombre || `Rastreador ${imei.slice(-6)}`;

    const wb = new ExcelJS.Workbook();
    wb.creator = "OmniAccess"; wb.created = new Date();
    const cabecera = (h: ExcelJS.Worksheet, fila = 1) => {
        const c = h.getRow(fila); c.height = 22;
        c.eachCell((x) => { x.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 }; x.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0A0E14" } }; x.alignment = { vertical: "middle", horizontal: "left", indent: 1 }; });
    };
    const mapa = (lat: number, lon: number) => ({ text: `${lat.toFixed(5)}, ${lon.toFixed(5)}`, hyperlink: `https://maps.google.com/?q=${lat},${lon}` });

    // ── Resumen por día ──
    const porDia = new Map<string, { rotulo: string; viajes: number; km: number; min: number; velMax: number; salida: string | null; llegada: string | null; alarmas: number }>();
    const dia = (iso: string) => {
        const k = F_CLAVE.format(new Date(iso));
        if (!porDia.has(k)) porDia.set(k, { rotulo: F_DIA.format(new Date(iso)), viajes: 0, km: 0, min: 0, velMax: 0, salida: null, llegada: null, alarmas: 0 });
        return porDia.get(k)!;
    };
    for (const v of viajes) {
        const d = dia(v.desde);
        d.viajes++; d.km += v.km; d.min += v.minutos; d.velMax = Math.max(d.velMax, v.velMax);
        if (!d.salida) d.salida = F_HORA.format(new Date(v.desde));
        d.llegada = F_HORA.format(new Date(v.hasta));
    }
    for (const ev of eventos) if (ev.prioridad !== null) dia(ev.cuando.toISOString()).alarmas++;

    const r = wb.addWorksheet("Resumen", { views: [{ state: "frozen", ySplit: 5 }] });
    r.columns = [{ width: 20 }, { width: 10 }, { width: 12 }, { width: 16 }, { width: 16 }, { width: 14 }, { width: 14 }, { width: 12 }];
    r.addRow([nombre]).font = { bold: true, size: 14 };
    r.addRow([[veh?.plate, `IMEI ${imei}`].filter(Boolean).join(" · ")]).font = { color: { argb: "FF64748B" } };
    r.addRow([`Últimos ${dias} ${dias === 1 ? "día" : "días"} · generado el ${F_DIA.format(new Date())} a las ${F_HORA.format(new Date())} (hora de ${ZONA.split("/").pop()?.replace(/_/g, " ")})`]).font = { color: { argb: "FF64748B" } };
    r.addRow([]);
    r.addRow(["Día", "Viajes", "Km", "En movimiento", "Velocidad máxima", "Primera salida", "Última llegada", "Alarmas"]);
    cabecera(r, 5);
    const claves = [...porDia.keys()].sort();
    for (const k of claves) { const d = porDia.get(k)!; r.addRow([d.rotulo, d.viajes, Number(d.km.toFixed(1)), dur(d.min), d.velMax ? `${d.velMax} km/h` : "—", d.salida || "—", d.llegada || "—", d.alarmas]); }
    if (!claves.length) r.addRow(["Sin viajes ni alarmas en el período."]);
    else {
        const t = r.addRow(["Total", viajes.length, Number(viajes.reduce((a, v) => a + v.km, 0).toFixed(1)), dur(viajes.reduce((a, v) => a + v.minutos, 0)), `${Math.max(0, ...viajes.map((v) => v.velMax))} km/h`, "", "", eventos.filter((x) => x.prioridad !== null).length]);
        t.font = { bold: true };
    }

    // ── Viajes ──
    const hv = wb.addWorksheet("Viajes", { views: [{ state: "frozen", ySplit: 1 }] });
    hv.columns = [
        { header: "Día", width: 18 }, { header: "Salida", width: 11 }, { header: "Llegada", width: 11 }, { header: "Duración", width: 13 }, { header: "Km", width: 9 },
        { header: "Vel. máxima", width: 13 }, { header: "Vel. media", width: 12 }, { header: "Salió de", width: 24 }, { header: "Llegó a", width: 24 },
    ];
    cabecera(hv);
    for (const v of viajes) {
        const f = hv.addRow([F_DIA.format(new Date(v.desde)), F_HORA.format(new Date(v.desde)), F_HORA.format(new Date(v.hasta)), dur(v.minutos), Number(v.km.toFixed(1)), `${v.velMax} km/h`, `${v.velMedia} km/h`, mapa(v.inicio.lat, v.inicio.lon), mapa(v.fin.lat, v.fin.lon)]);
        for (const n of [8, 9]) f.getCell(n).font = { color: { argb: "FF2563EB" }, underline: true };
    }

    // ── Paradas ──
    const hp = wb.addWorksheet("Paradas", { views: [{ state: "frozen", ySplit: 1 }] });
    hp.columns = [{ header: "Día", width: 18 }, { header: "Desde", width: 11 }, { header: "Hasta", width: 11 }, { header: "Duración", width: 13 }, { header: "Dónde", width: 24 }];
    cabecera(hp);
    for (const p of paradas) {
        const f = hp.addRow([F_DIA.format(new Date(p.desde)), F_HORA.format(new Date(p.desde)), F_HORA.format(new Date(p.hasta)), dur(p.minutos), mapa(p.lat, p.lon)]);
        f.getCell(5).font = { color: { argb: "FF2563EB" }, underline: true };
    }

    // ── Eventos ──
    const he = wb.addWorksheet("Eventos", { views: [{ state: "frozen", ySplit: 1 }] });
    he.columns = [{ header: "Día", width: 18 }, { header: "Hora", width: 11 }, { header: "Evento", width: 36 }, { header: "Detalle", width: 34 }, { header: "Lugar", width: 22 }, { header: "Prioridad", width: 11 }, { header: "Llegó tarde", width: 13 }, { header: "Dónde", width: 24 }];
    cabecera(he);
    for (const ev of eventos) {
        const { titulo, resto } = tituloDeEventoGps(ev);
        const f = he.addRow([F_DIA.format(ev.cuando), F_HORA.format(ev.cuando), titulo || fichaDeEventoGps(ev.tipo).rotulo, resto || "", ev.lugar || "", ev.prioridad ?? "", demoraLegible(ev.tarde) || "", ev.lat !== null && ev.lon !== null ? mapa(ev.lat, ev.lon) : ""]);
        if (ev.lat !== null && ev.lon !== null) f.getCell(8).font = { color: { argb: "FF2563EB" }, underline: true };
    }

    const buf = await wb.xlsx.writeBuffer();
    const archivo = `reporte-gps-${(veh?.plate || nombre).replace(/[^0-9A-Za-z_-]+/g, "-")}-${F_CLAVE.format(new Date())}.xlsx`;
    return new NextResponse(buf as ArrayBuffer, {
        headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="${archivo}"`, "Cache-Control": "no-store" },
    });
}
