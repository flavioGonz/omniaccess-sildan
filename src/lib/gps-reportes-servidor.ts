import { prisma } from "@/lib/prisma";
import { leerLimite } from "@/lib/gps-jornada";
import { leerHorario, puntosDe, rotuloDeHorario, type HorarioCerca } from "@/lib/gps-geocerca";
import { RECORRIDO_MAX_DIAS } from "@/lib/gps-filtro";
import { nuevoInforme, type CercaRep } from "@/lib/gps-reportes";
import type { ClaveReporte, TablaReporte, TotalesDeReporte } from "@/lib/gps-reportes-catalogo";
import { ZONA } from "@/lib/fechas";
import { direccionesDe } from "@/lib/direcciones";
import { claveDeLugar, lugarConDireccion } from "@/lib/direccion-texto";
import { esLugar } from "@/lib/gps-reportes-catalogo";

/**
 * Traer de la base lo que hace falta para los reportes de rastreo y pasárselo a la cuenta
 * (lib/gps-reportes). Lo usan la descarga (Excel y PDF) y la vista previa de la pantalla: una sola
 * forma de juntar los datos, para que lo que se ve y lo que se baja sea lo mismo.
 *
 * Quien llama ya comprobó la sesión y el permiso: acá no se mira.
 */

export const LIMITE_GPS = "GPS_VELOCIDAD_PERMITIDA";
export const HORARIO_LABORAL_GPS = "GPS_HORARIO_LABORAL";
const DEVICE_DE_PRUEBA = "carga-prueba";
/** Posiciones por vehículo. Un mes reportando cada diez segundos sin parar son 268.000. */
const POSICIONES_POR_VEHICULO = 400_000;
const EVENTOS_POR_VEHICULO = 20_000;
/** Vehículos por reporte. Más que esto se pide en tandas: cada uno es una lectura larga de la base. */
export const VEHICULOS_MAX = 100;

export type ReporteGps = {
    tablas: TablaReporte[]; totales: TotalesDeReporte;
    vehiculos: { imei: string; nombre: string; matricula: string | null }[];
    desde: string; hasta: string; hastaAhora: boolean;
    /** El período pedido era más largo que lo que se puede leer: se recortó. */
    recortado: boolean;
    limite: number; horario: HorarioCerca | null; horarioRotulo: string | null;
    zona: string; generado: string;
};

export async function horarioLaboral(): Promise<HorarioCerca | null> {
    const f = await prisma.setting.findUnique({ where: { key: HORARIO_LABORAL_GPS } }).catch(() => null);
    if (!f?.value) return null;
    try { return leerHorario(JSON.parse(f.value)); } catch { return null; }
}

export async function armarReporteGps(o: { imeis: string[] | null; desde: Date; hasta: Date | null; claves: ClaveReporte[] }): Promise<ReporteGps> {
    const ahora = new Date();
    const tope = new Date(o.desde.getTime() + RECORRIDO_MAX_DIAS * 86_400_000);
    const pedido = o.hasta && o.hasta < ahora ? o.hasta : ahora;
    const recortado = pedido > tope, hasta = recortado ? tope : pedido;
    const hastaAhora = !recortado && (!o.hasta || o.hasta >= ahora);

    /* Sólo los dados de alta: uno que se presentó y nadie reconoció no es un vehículo de nadie. */
    const equipos = await prisma.gpsEquipo.findMany({
        where: { deviceId: { not: null }, NOT: { deviceId: DEVICE_DE_PRUEBA }, ...(o.imeis ? { imei: { in: o.imeis } } : {}) },
        orderBy: { createdAt: "asc" }, take: VEHICULOS_MAX, select: { imei: true, nombre: true, deviceId: true, matricula: true },
    });
    const [devs, cercasCrudas, ajuste, horario] = await Promise.all([
        prisma.device.findMany({ where: { id: { in: equipos.map((e) => e.deviceId!) } }, select: { id: true, name: true } }),
        prisma.gpsGeocerca.findMany({ orderBy: { createdAt: "asc" } }),
        prisma.setting.findUnique({ where: { key: LIMITE_GPS } }).catch(() => null),
        horarioLaboral(),
    ]);
    const nombreDe = new Map(devs.map((d) => [d.id, d.name]));
    const cercas: CercaRep[] = cercasCrudas.map((g) => ({ id: g.id, nombre: g.nombre, lat: g.lat, lon: g.lon, radio: g.radio, puntos: puntosDe({ puntos: g.puntos }), imeis: g.imeis }));
    const limite = leerLimite(ajuste?.value);

    const informe = nuevoInforme({ desde: o.desde.toISOString(), hasta: hasta.toISOString(), hastaAhora, limite, cercas, horario, zona: ZONA }, o.claves);
    const vehiculos: ReporteGps["vehiculos"] = [];
    /* De a uno, a propósito: las posiciones de un vehículo se sueltan antes de traer las del siguiente. */
    for (const e of equipos) {
        const [puntos, eventos] = await Promise.all([
            prisma.gpsPosicion.findMany({ where: { imei: e.imei, cuando: { gte: o.desde, lte: hasta } }, orderBy: { cuando: "asc" }, take: POSICIONES_POR_VEHICULO, select: { lat: true, lon: true, cuando: true, velocidad: true, rumbo: true, satelites: true, pobre: true, encendido: true } }),
            prisma.gpsEvento.findMany({ where: { imei: e.imei, cuando: { gte: o.desde, lte: hasta } }, orderBy: { cuando: "asc" }, take: EVENTOS_POR_VEHICULO, select: { tipo: true, cuando: true, detalle: true, lugar: true, prioridad: true, tarde: true, lat: true, lon: true } }),
        ]);
        const v = { imei: e.imei, nombre: nombreDe.get(e.deviceId!) || e.nombre || `Rastreador ${e.imei.slice(-6)}`, matricula: e.matricula || null };
        vehiculos.push(v);
        informe.sumar({
            ...v,
            puntos: puntos.map((p) => ({ lat: p.lat, lon: p.lon, cuando: p.cuando.toISOString(), velocidad: p.velocidad, rumbo: p.rumbo, sat: p.satelites, pobre: p.pobre, enc: p.encendido })),
            eventos: eventos.map((x) => ({ ...x, cuando: x.cuando.toISOString() })),
        });
    }
    return {
        tablas: informe.tablas(), totales: informe.totales(), vehiculos,
        desde: o.desde.toISOString(), hasta: hasta.toISOString(), hastaAhora, recortado,
        limite, horario, horarioRotulo: horario ? rotuloDeHorario(horario) : null, zona: ZONA, generado: ahora.toISOString(),
    };
}

/**
 * Ponerles dirección a los lugares de las tablas: «Cavour 3230, La Blanqueada» donde había dos
 * números. El nombre de la geocerca, si lo hay, sigue adelante («en Base · Cavour 3230»).
 *
 * Va aparte de armar el reporte porque la vista previa lo llama con las tablas ya recortadas: no
 * tiene sentido averiguar la dirección de mil paradas para mostrar sesenta.
 */
export async function conDirecciones(r: ReporteGps): Promise<ReporteGps> {
    const lugares = r.tablas.flatMap((t) => t.filas.flatMap((f) => f.filter(esLugar)));
    if (!lugares.length) return r;
    const dir = await direccionesDe(lugares);
    if (!dir.size) return r;
    for (const l of lugares) l.lugar = lugarConDireccion(l.lugar, dir.get(claveDeLugar(l.lat, l.lon)));
    return r;
}

/** «del 20/11/2026 08:00 al 22/11/2026 18:30», en la hora del sitio. Lo dicen igual el Excel, el PDF y la pantalla. */
export function periodoEnPalabras(r: Pick<ReporteGps, "desde" | "hasta" | "hastaAhora" | "zona">): string {
    const f = new Intl.DateTimeFormat("es-UY", { timeZone: r.zona, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    const t = (iso: string) => f.format(new Date(iso)).replace(",", "");
    return `del ${t(r.desde)} al ${t(r.hasta)}${r.hastaAhora ? " (hasta ahora)" : ""}`;
}
/** A quiénes cubre, en una línea: los nombres si son pocos, la cuenta si son muchos. */
export function vehiculosEnPalabras(r: Pick<ReporteGps, "vehiculos">): string {
    const n = r.vehiculos.length;
    if (!n) return "Ningún vehículo";
    const nombres = r.vehiculos.map((v) => (v.matricula ? `${v.nombre} (${v.matricula})` : v.nombre));
    return n <= 4 ? nombres.join(" · ") : `${n} vehículos: ${nombres.slice(0, 3).join(" · ")} y ${n - 3} más`;
}
