"use server";

import { prisma } from "@/lib/prisma";
import { getSession } from "@/app/actions/auth";
import { permisosDeSesion } from "@/lib/permisos";
import { auditar } from "@/lib/centrales/sesion";

/**
 * Los rastreadores GPS que se presentaron en gps-receiver.js, para la pantalla de Dispositivos.
 *
 * Pedido de Nico (20/11): «aquí debe tener un tipo de dispositivo GPS, ¿no?». Lo tenía, pero
 * vacío: el tipo sólo se mostraba si había un Device de ese tipo, y el rastreador vive en
 * GpsEquipo, que se llena solo cuando el equipo se conecta. El equipo estaba reportando y
 * Dispositivos no sabía que existía.
 *
 * Un rastreador que se presenta **no se da de alta solo**, a propósito. El puerto está abierto
 * a internet: cualquiera que hable el protocolo puede presentarse con un IMEI inventado, y eso no
 * tiene que llenar el árbol de equipos. Se muestra como «se presentó, sin dar de alta» y una
 * persona decide: el IMEI identifica, no autoriza.
 */

/** Sin latido en este tiempo se lo da por fuera de línea (parado reporta cada 3 a 5 minutos). */
const EN_LINEA_MS = 12 * 60_000;

export type Rastreador = {
    imei: string;
    nombre: string | null;
    /** El Device que lo representa, si alguien lo dio de alta. */
    deviceId: string | null;
    matricula: string | null;
    enLinea: boolean;
    ultimoLatido: string | null;
    /** La última posición CON satélites. Puede ser vieja: `cuando` dice de cuándo. */
    lat: number | null; lon: number | null; cuando: string | null;
    velocidad: number | null; rumbo: number | null;
    encendido: boolean | null;
    bateria: number | null; senal: number | null;
    /** La alimentación que informa el equipo: la batería del vehículo. */
    voltaje: number | null;
    posiciones: number;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- la sesión es el JWT crudo
async function sesion(permiso: string): Promise<any> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s: any = await getSession().catch(() => null);
    if (!s || !permisosDeSesion(s).includes(permiso)) throw new Error("Tu rol no puede hacer eso con los equipos.");
    return s;
}

export async function rastreadoresGps(): Promise<Rastreador[]> {
    await sesion("dispositivos");
    const equipos = await prisma.gpsEquipo.findMany({ orderBy: { createdAt: "asc" } });
    if (!equipos.length) return [];
    const [devs, vehs, cuentas] = await Promise.all([
        prisma.device.findMany({ where: { id: { in: equipos.map((e) => e.deviceId).filter(Boolean) as string[] } }, select: { id: true, name: true } }),
        prisma.vehicle.findMany({ where: { id: { in: equipos.map((e) => e.vehicleId).filter(Boolean) as string[] } }, select: { id: true, plate: true } }),
        prisma.gpsPosicion.groupBy({ by: ["imei"], _count: { _all: true } }),
    ]);
    const nombreDe = new Map(devs.map((d) => [d.id, d.name]));
    const chapaDe = new Map(vehs.map((v) => [v.id, v.plate]));
    const cuantas = new Map(cuentas.map((c) => [c.imei, c._count._all]));
    const ahora = Date.now();
    return equipos.map((e) => {
        /* Si el Device se borró, el rastreador vuelve a «sin dar de alta»: el vínculo no puede
           apuntar a un equipo que ya no existe. */
        const vivo = e.deviceId && nombreDe.has(e.deviceId) ? e.deviceId : null;
        return {
            imei: e.imei, nombre: (vivo && nombreDe.get(vivo)) || e.nombre, deviceId: vivo,
            matricula: (e.vehicleId && chapaDe.get(e.vehicleId)) || null,
            enLinea: !!e.ultimoLatido && ahora - e.ultimoLatido.getTime() < EN_LINEA_MS,
            ultimoLatido: e.ultimoLatido?.toISOString() || null,
            lat: e.lat, lon: e.lon, cuando: e.cuando?.toISOString() || null,
            velocidad: e.velocidad, rumbo: e.rumbo, encendido: e.encendido,
            bateria: e.bateria, senal: e.senal, voltaje: e.voltaje,
            posiciones: cuantas.get(e.imei) || 0,
        };
    });
}

/** Da de alta como equipo a un rastreador que se presentó. Devuelve el id del Device creado. */
export async function darDeAltaGps(imei: string, nombre: string): Promise<{ ok: boolean; deviceId?: string; error?: string }> {
    const s = await sesion("dispositivos.editar");
    const e = await prisma.gpsEquipo.findUnique({ where: { imei } });
    if (!e) return { ok: false, error: "Ese rastreador no se presentó nunca." };
    const limpio = nombre.trim().slice(0, 60) || `GPS ${imei.slice(-6)}`;
    /* En un GPS la IP no identifica nada (sale por la red celular y cambia): se guarda la última
       como dato, y el IMEI va donde los demás equipos llevan la MAC, que es lo que es — el
       identificador de fábrica del aparato. */
    const d = await prisma.device.create({
        data: { name: limpio, deviceType: "GPS", brand: "GENERICA", ip: e.ultimaIp || "0.0.0.0", mac: imei, deviceModel: e.protocolo, authType: "NONE" },
        select: { id: true },
    });
    await prisma.gpsEquipo.update({ where: { imei }, data: { deviceId: d.id, nombre: limpio } });
    await auditar(s, "equipos.gps.alta", d.id, true, `${limpio} · IMEI ${imei}`);
    return { ok: true, deviceId: d.id };
}

/** Ata el rastreador a un vehículo del padrón por su matrícula (vacía = lo desata). */
export async function atarVehiculoGps(imei: string, matricula: string): Promise<{ ok: boolean; error?: string }> {
    const s = await sesion("dispositivos.editar");
    const chapa = matricula.replace(/[^0-9A-Za-z]/g, "").toUpperCase();
    if (!chapa) { await prisma.gpsEquipo.update({ where: { imei }, data: { vehicleId: null } }); return { ok: true }; }
    const v = await prisma.vehicle.findUnique({ where: { plate: chapa }, select: { id: true } });
    if (!v) return { ok: false, error: `No hay ningún vehículo con la matrícula ${chapa} en el padrón.` };
    await prisma.gpsEquipo.update({ where: { imei }, data: { vehicleId: v.id } });
    await auditar(s, "equipos.gps.vehiculo", imei, true, `IMEI ${imei} → ${chapa}`);
    return { ok: true };
}

export type PuntoGps = { lat: number; lon: number; cuando: string; velocidad: number };

/** Por dónde anduvo en las últimas horas, del más viejo al más nuevo, para dibujar el recorrido. */
export async function recorridoGps(imei: string, horas = 24): Promise<PuntoGps[]> {
    await sesion("dispositivos");
    const desde = new Date(Date.now() - Math.min(Math.max(horas, 1), 24 * 7) * 3600_000);
    const filas = await prisma.gpsPosicion.findMany({
        where: { imei, cuando: { gte: desde } }, orderBy: { cuando: "asc" }, take: 3000,
        select: { lat: true, lon: true, cuando: true, velocidad: true },
    });
    return filas.map((f) => ({ lat: f.lat, lon: f.lon, cuando: f.cuando.toISOString(), velocidad: f.velocidad }));
}
