"use server";

import { prisma } from "@/lib/prisma";
import { getSession } from "@/app/actions/auth";
import { permisosDeSesion } from "@/lib/permisos";
import { auditar } from "@/lib/centrales/sesion";
import { leerEstadoRele, puedeAccionarRele } from "@/lib/gps-rele";
import { aligerar, SATS_MIN, type ResumenRecorrido } from "@/lib/gps-recorrido";
import { resumenDeViajes, viajesYParadas, type Parada, type Viaje } from "@/lib/gps-viajes";

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
    /** El relé está accionado. `null` si el equipo todavía no lo informó. */
    cortado: boolean | null;
    /** Con qué dibujo se lo ve en el mapa. */
    icono: string | null;
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
            bateria: e.bateria, senal: e.senal, voltaje: e.voltaje, cortado: e.cortado, icono: e.icono,
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

/** Le cambia el nombre a un rastreador ya dado de alta (al equipo y a su registro). */
export async function renombrarGps(imei: string, nombre: string): Promise<{ ok: boolean; error?: string }> {
    const s = await sesion("dispositivos.editar");
    const limpio = nombre.trim().slice(0, 60);
    if (!limpio) return { ok: false, error: "El nombre no puede quedar vacío." };
    const e = await prisma.gpsEquipo.findUnique({ where: { imei } });
    if (!e?.deviceId) return { ok: false, error: "Ese rastreador no está dado de alta." };
    await prisma.device.update({ where: { id: e.deviceId }, data: { name: limpio } });
    await prisma.gpsEquipo.update({ where: { imei }, data: { nombre: limpio } });
    await auditar(s, "equipos.gps.renombrar", e.deviceId, true, `IMEI ${imei} → ${limpio}`);
    return { ok: true };
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
export type RecorridoGps = { puntos: PuntoGps[]; resumen: ResumenRecorrido; viajes: Viaje[]; paradas: Parada[] };

/**
 * Por dónde anduvo en las últimas horas: sus VIAJES, y nada más.
 *
 * La primera versión dibujaba todas las posiciones unidas por una línea, y la primera noche real
 * (21/11) el mapa mostró una telaraña alrededor de un auto estacionado: 29 «viajes» y 48,8 km
 * donde hubo 8 viajes y 37,5 km. Un auto quieto con mala señal no manda una posición fija: manda
 * decenas de posiciones que saltan, con velocidad y todo.
 *
 * Así que ahora:
 *  · Sólo entran las posiciones con satélites suficientes (SATS_MIN, ver lib/gps-recorrido).
 *  · Se cortan los viajes (lib/gps-viajes), que exigen haberse alejado de donde se salió.
 *  · Al mapa van únicamente los puntos que son parte de un viaje. Lo que pasó entre viaje y viaje
 *    es una PARADA —un lugar y un tiempo—, no una línea.
 *  · Los kilómetros, el tiempo y la velocidad máxima son los de los viajes.
 */
export async function recorridoGps(imei: string, horas = 24): Promise<RecorridoGps> {
    await sesion("dispositivos");
    const desde = new Date(Date.now() - Math.min(Math.max(horas, 1), 24 * 31) * 3600_000);
    const filas = await prisma.gpsPosicion.findMany({
        where: { imei, cuando: { gte: desde }, satelites: { gte: SATS_MIN } }, orderBy: { cuando: "asc" }, take: 120_000,
        select: { lat: true, lon: true, cuando: true, velocidad: true },
    });
    const todos = filas.map((f) => ({ lat: f.lat, lon: f.lon, cuando: f.cuando.toISOString(), velocidad: f.velocidad }));
    const { viajes, paradas } = viajesYParadas(todos);
    /* Los puntos de cada viaje, por su horario. Los dos están ordenados, así que se recorren juntos. */
    const deViaje: PuntoGps[] = [];
    let k = 0;
    for (const v of viajes) {
        while (k < todos.length && todos[k].cuando < v.desde) k++;
        while (k < todos.length && todos[k].cuando <= v.hasta) deViaje.push(todos[k++]);
    }
    return {
        puntos: aligerar(deViaje, 3000),
        resumen: resumenDeViajes(viajes, todos[0]?.cuando || null, todos[todos.length - 1]?.cuando || null, todos.length),
        viajes, paradas,
    };
}

const ICONOS = new Set(["auto", "camion", "moto", "persona", "punto"]);

/** Con qué dibujo se ve el rastreador en el mapa. */
export async function cambiarIconoGps(imei: string, icono: string): Promise<{ ok: boolean; error?: string }> {
    await sesion("dispositivos.editar");
    if (!ICONOS.has(icono)) return { ok: false, error: "Ese ícono no existe." };
    await prisma.gpsEquipo.update({ where: { imei }, data: { icono } });
    return { ok: true };
}

/**
 * Los comandos que la pantalla puede mandarle a un rastreador. Es una lista cerrada, no texto
 * libre: el equipo acepta por este canal lo mismo que por SMS —incluido cambiarle el servidor o
 * reiniciarlo de fábrica—, y eso no tiene que quedar a un campo de texto de distancia.
 */
const COMANDOS = {
    estado: "STATUS#",
    posicion: "WHERE#",
    rele: "RELAY#",
    "rele.accionar": "RELAY,1#",
    "rele.soltar": "RELAY,0#",
} as const;
export type ComandoGps = keyof typeof COMANDOS;

const CONTROL = `http://127.0.0.1:${process.env.GPS_PUERTO_CONTROL || 10013}`;

async function alEquipo(imei: string, texto: string): Promise<{ ok: boolean; respuesta?: string; error?: string }> {
    try {
        const r = await fetch(`${CONTROL}/comando`, {
            method: "POST", headers: { "content-type": "application/json" },
            body: JSON.stringify({ imei, texto }), signal: AbortSignal.timeout(25_000),
        });
        return await r.json();
    } catch { return { ok: false, error: "No se pudo hablar con el receptor de GPS." }; }
}

/**
 * Manda un comando y devuelve LO QUE EL EQUIPO CONTESTÓ, tal cual. No se traduce ni se resume:
 * cuando se trata de un relé, la palabra del equipo es el dato.
 */
export async function comandoGps(imei: string, accion: ComandoGps): Promise<{ ok: boolean; respuesta?: string; error?: string; cortado?: boolean | null }> {
    const texto = COMANDOS[accion];
    if (!texto) return { ok: false, error: "Ese comando no existe." };
    const escribe = accion === "rele.accionar" || accion === "rele.soltar";
    const s = await sesion(escribe ? "dispositivos.editar" : "dispositivos");

    const e = await prisma.gpsEquipo.findUnique({ where: { imei } });
    if (!e) return { ok: false, error: "Ese rastreador no existe." };
    /* A uno que se presentó solo no se le manda nada: todavía no es de nadie. */
    if (!e.deviceId) return { ok: false, error: "Primero hay que dar de alta el rastreador." };

    if (accion === "rele.accionar") {
        const v = puedeAccionarRele({ velocidad: e.velocidad, cuando: e.cuando, encendido: e.encendido, ultimoLatido: e.ultimoLatido });
        if (!v.ok) {
            await auditar(s, "equipos.gps.rele", e.deviceId, false, `IMEI ${imei} · accionar · frenado: ${v.motivo}`);
            return { ok: false, error: v.motivo };
        }
    }

    const r = await alEquipo(imei, texto);
    let cortado: boolean | null | undefined;
    if (escribe || accion === "rele") {
        /* Después de tocar el relé se le pregunta al equipo cómo quedó, en vez de suponerlo: el
           latido que trae ese dato puede tardar cinco minutos. */
        const c = accion === "rele" ? r : await alEquipo(imei, COMANDOS.rele);
        cortado = c.ok ? leerEstadoRele(c.respuesta || "") : null;
        if (cortado !== null && cortado !== undefined) await prisma.gpsEquipo.update({ where: { imei }, data: { cortado } }).catch(() => { });
    }
    if (escribe) await auditar(s, "equipos.gps.rele", e.deviceId, r.ok, `IMEI ${imei} · ${accion === "rele.accionar" ? "accionar" : "soltar"} · ${r.ok ? `equipo: «${(r.respuesta || "").slice(0, 120)}»` : r.error}`);
    return { ...r, cortado };
}

/**
 * Las geocercas: zonas sobre el mapa que avisan cuando un rastreador entra o sale. Las evalúa el
 * receptor (otro proceso), que las relee cada medio minuto: un cambio acá tarda hasta ese tiempo
 * en empezar a valer.
 */
export type Geocerca = { id: string; nombre: string; lat: number; lon: number; radio: number; imeis: string[]; activa: boolean };

export async function geocercasGps(): Promise<Geocerca[]> {
    await sesion("dispositivos");
    const f = await prisma.gpsGeocerca.findMany({ orderBy: { createdAt: "asc" } });
    return f.map((g) => ({ id: g.id, nombre: g.nombre, lat: g.lat, lon: g.lon, radio: g.radio, imeis: g.imeis, activa: g.activa }));
}

export async function guardarGeocercaGps(g: { id?: string; nombre: string; lat: number; lon: number; radio: number; imeis?: string[]; activa?: boolean }): Promise<{ ok: boolean; id?: string; error?: string }> {
    const s = await sesion("dispositivos.editar");
    const nombre = String(g.nombre || "").trim().slice(0, 60);
    if (!nombre) return { ok: false, error: "La geocerca necesita un nombre: es lo que va a decir el aviso." };
    if (!Number.isFinite(g.lat) || !Number.isFinite(g.lon) || Math.abs(g.lat) > 90 || Math.abs(g.lon) > 180) return { ok: false, error: "El centro no es un punto del mapa." };
    /* Menos de 30 m es más chico que el ruido del propio GPS: avisaría sola. */
    const radio = Math.round(Math.min(Math.max(Number(g.radio) || 0, 30), 50_000));
    const data = { nombre, lat: g.lat, lon: g.lon, radio, imeis: (g.imeis || []).map(String).slice(0, 200), activa: g.activa !== false };
    const fila = g.id
        ? await prisma.gpsGeocerca.update({ where: { id: g.id }, data, select: { id: true } })
        : await prisma.gpsGeocerca.create({ data, select: { id: true } });
    await auditar(s, g.id ? "equipos.gps.geocerca.cambiar" : "equipos.gps.geocerca.alta", fila.id, true, `${nombre} · ${radio} m`);
    return { ok: true, id: fila.id };
}

export async function borrarGeocercaGps(id: string): Promise<{ ok: boolean }> {
    const s = await sesion("dispositivos.editar");
    const g = await prisma.gpsGeocerca.delete({ where: { id } }).catch(() => null);
    if (g) await auditar(s, "equipos.gps.geocerca.borrar", id, true, g.nombre);
    return { ok: !!g };
}
