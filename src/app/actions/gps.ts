"use server";

import { randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { DURACIONES, estadoDeEnlace, horasValidas } from "@/lib/gps-compartir";
import { prisma } from "@/lib/prisma";
import { circuloDe, leerHorario, puntosDe, rotuloDeHorario, VERTICES_MAX, type AvisaCerca, type HorarioCerca } from "@/lib/gps-geocerca";
import { getSession } from "@/app/actions/auth";
import { permisosDeSesion } from "@/lib/permisos";
import { auditar } from "@/lib/centrales/sesion";
import { leerEstadoRele, puedeAccionarRele } from "@/lib/gps-rele";
import { aligerar, SATS_MIN, type ResumenRecorrido } from "@/lib/gps-recorrido";
import { resumenDeViajes, viajesYParadas, type Parada, type Viaje } from "@/lib/gps-viajes";
import { CLASES_EVENTO_GPS, EVENTOS_GPS, tiposDeClase, type ClaseEventoGps } from "@/lib/gps-eventos";

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

/** El «equipo» de los rastreadores de la prueba de carga. El mismo valor que en lib-gps-eventos.js. */
const DEVICE_DE_PRUEBA = "carga-prueba";

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
    /** Si se avisó que dejó de reportar: desde cuándo no se sabe de él. */
    sinReporteDesde: string | null;
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
    /* Los de la prueba de carga (scripts/carga-gps.js) no son de nadie: no se listan. */
    const equipos = await prisma.gpsEquipo.findMany({ where: { OR: [{ deviceId: null }, { NOT: { deviceId: DEVICE_DE_PRUEBA } }] }, orderBy: { createdAt: "asc" } });
    if (!equipos.length) return [];
    /* Antes acá se contaban TODAS las posiciones de cada rastreador, en cada refresco (cada 15 s
       desde el mapa y cada 20 desde Dispositivos): recorrer la tabla entera para mostrar «1.369
       puntos». Con un equipo no se nota; con doscientos son millones de filas por minuto. El
       número pasó al diagnóstico, que se pide cada tanto (diagnosticoGps). */
    const [devs, vehs] = await Promise.all([
        prisma.device.findMany({ where: { id: { in: equipos.map((e) => e.deviceId).filter(Boolean) as string[] } }, select: { id: true, name: true } }),
        prisma.vehicle.findMany({ where: { id: { in: equipos.map((e) => e.vehicleId).filter(Boolean) as string[] } }, select: { id: true, plate: true } }),
    ]);
    const nombreDe = new Map(devs.map((d) => [d.id, d.name]));
    const chapaDe = new Map(vehs.map((v) => [v.id, v.plate]));
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
            sinReporteDesde: e.sinReporteDesde?.toISOString() || null,
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

/**
 * La estela: las últimas posiciones buenas, tal cual, sin cortar en viajes. Para «últimos 10
 * minutos» y para el modo en vivo, donde lo que se quiere ver es por dónde viene AHORA: cortar
 * diez minutos en viajes y paradas no dice nada, y el viaje en curso todavía no terminó.
 */
export async function estelaGps(imei: string, minutos = 10): Promise<PuntoGps[]> {
    await sesion("dispositivos");
    const desde = new Date(Date.now() - Math.min(Math.max(minutos, 1), 120) * 60_000);
    const filas = await prisma.gpsPosicion.findMany({
        where: { imei, cuando: { gte: desde }, satelites: { gte: SATS_MIN } }, orderBy: { cuando: "asc" }, take: 2000,
        select: { lat: true, lon: true, cuando: true, velocidad: true },
    });
    return filas.map((f) => ({ lat: f.lat, lon: f.lon, cuando: f.cuando.toISOString(), velocidad: f.velocidad }));
}

export type EventoGps = {
    id: string; imei: string; tipo: string;
    /** Cuándo PASÓ, según el equipo. */
    cuando: string;
    detalle: string | null; lat: number | null; lon: number | null;
    /** Cuántos segundos tardó en llegar la noticia, si fueron más de dos minutos. */
    tarde: number | null;
    /** 1 a 5 si abrió un caso en Gestión de alarmas. */
    prioridad: number | null;
    /** Dónde fue en palabras, según las geocercas. */
    lugar: string | null;
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- la fila de prisma
const aEvento = (x: any): EventoGps => ({ id: x.id, imei: x.imei, tipo: x.tipo, cuando: x.cuando.toISOString(), detalle: x.detalle, lat: x.lat, lon: x.lon, tarde: x.tarde ?? null, prioridad: x.prioridad ?? null, lugar: x.lugar ?? null });

/** Lo último que le pasó a un rastreador (o a todos): alarmas, cruces de geocerca, batería. */
export async function eventosGps(imei?: string, cuantos = 30): Promise<EventoGps[]> {
    await sesion("dispositivos");
    const f = await prisma.gpsEvento.findMany({
        /* Entrar y salir de una zona sin satélites se anota para diagnóstico, pero no es algo que
           le pasó al vehículo: en la lista sólo tapa lo que importa. */
        where: { ...(imei ? { imei } : {}), tipo: { notIn: ["GPS_SIN_SATELITES", "GPS_CON_SATELITES"] } },
        orderBy: { cuando: "desc" }, take: Math.min(Math.max(cuantos, 1), 200),
    });
    return f.map(aEvento);
}

/** Un evento por su id: para llegar al mapa desde la consola de alarmas con ese evento ya marcado. */
export async function unEventoGps(id: string): Promise<EventoGps | null> {
    await sesion("dispositivos");
    const f = await prisma.gpsEvento.findUnique({ where: { id: String(id || "") } }).catch(() => null);
    return f ? aEvento(f) : null;
}

export type HistorialEventosGps = {
    eventos: EventoGps[];
    /** Hay más viejos que éstos: se piden con `antes` = la hora del último. */
    hayMas: boolean;
    /** Cuántos hay de cada clase en el período, sin importar el filtro: los números de las pestañas. */
    cuenta: Record<ClaseEventoGps, number>;
};

/**
 * TODO lo que le pasó a un rastreador, para su cajón de eventos en el mapa (21/11, Nico: «la lista
 * de todos los eventos que le ocurrieron»). Acá sí entran los de satélites y los del relé: el
 * cajón tiene pestañas para apartarlos y pliega las rachas, así que no tapan nada.
 *
 * Se pagina por la hora (`antes`): la lista crece hacia atrás sin volver a traer lo que ya está.
 */
export async function historialEventosGps(o: { imei: string; clase?: ClaseEventoGps | null; dias?: number | null; antes?: string | null; cuantos?: number }): Promise<HistorialEventosGps> {
    await sesion("dispositivos");
    const imei = String(o.imei || "");
    const cuantos = Math.min(Math.max(o.cuantos || 60, 10), 200);
    const desde = o.dias ? new Date(Date.now() - Math.min(Math.max(o.dias, 1), 366) * 86_400_000) : null;
    const antes = o.antes ? new Date(o.antes) : null;
    const clase = o.clase && CLASES_EVENTO_GPS.some((c) => c.clave === o.clase) ? o.clase : null;
    const periodo = { imei, ...(desde ? { cuando: { gte: desde } } : {}) };
    const [filas, porTipo] = await Promise.all([
        prisma.gpsEvento.findMany({
            where: {
                imei, ...(clase ? { tipo: { in: tiposDeClase(clase) } } : {}),
                ...(desde || antes ? { cuando: { ...(desde ? { gte: desde } : {}), ...(antes && !Number.isNaN(antes.getTime()) ? { lt: antes } : {}) } } : {}),
            },
            orderBy: [{ cuando: "desc" }, { id: "desc" }], take: cuantos + 1,
        }),
        prisma.gpsEvento.groupBy({ by: ["tipo"], where: periodo, _count: { _all: true } }),
    ]);
    const cuenta: Record<ClaseEventoGps, number> = { alarma: 0, geocerca: 0, conexion: 0, equipo: 0 };
    for (const t of porTipo) cuenta[EVENTOS_GPS[t.tipo]?.clase || "equipo"] += t._count._all;
    return { eventos: filas.slice(0, cuantos).map(aEvento), hayMas: filas.length > cuantos, cuenta };
}

/**
 * Por dónde venía y para dónde siguió alrededor de un evento: las posiciones buenas de unos
 * minutos antes y después. Es lo que convierte «un punto en el mapa» en «venía por esta calle,
 * paró acá, y siguió para allá».
 */
export async function entornoEventoGps(imei: string, cuando: string, minutos = 5): Promise<PuntoGps[]> {
    await sesion("dispositivos");
    const t = new Date(cuando).getTime();
    if (!Number.isFinite(t)) return [];
    const ms = Math.min(Math.max(minutos, 1), 30) * 60_000;
    const filas = await prisma.gpsPosicion.findMany({
        where: { imei, cuando: { gte: new Date(t - ms), lte: new Date(t + ms) }, satelites: { gte: SATS_MIN } }, orderBy: { cuando: "asc" }, take: 600,
        select: { lat: true, lon: true, cuando: true, velocidad: true },
    });
    return filas.map((f) => ({ lat: f.lat, lon: f.lon, cuando: f.cuando.toISOString(), velocidad: f.velocidad }));
}

export type DiagnosticoGps = {
    imei: string;
    /** Posiciones guardadas, en total. */
    posiciones: number;
    /** Lo que conviene revisar de la instalación o de la configuración, en palabras. */
    avisos: string[];
};

/** A partir de cuántas horas con el motor «encendido» sin moverse se sospecha del cable. */
const ACC_SOSPECHOSO_H = 3;

/**
 * Lo que los datos dicen de cómo está INSTALADO cada rastreador. No es una alarma: es lo que un
 * técnico tendría que mirar. Sale de cosas que se midieron con el primer equipo (21/11):
 *  · el motor figuró encendido 768 minutos de una noche con el auto estacionado — el cable de
 *    encendido (ACC) estaba mal tomado, y con eso «se mueve con el motor apagado» no sirve;
 *  · 62 alarmas de vibración en un día — el equipo quedó en guardia con la sensibilidad de fábrica;
 *  · posiciones con pocos satélites ANDANDO — la antena no ve el cielo donde lo pusieron.
 *
 * Se pide cada varios minutos y no con cada refresco: recorre un día de posiciones.
 */
export async function diagnosticoGps(): Promise<DiagnosticoGps[]> {
    await sesion("dispositivos");
    const equipos = await prisma.gpsEquipo.findMany({ where: { deviceId: { not: null }, NOT: { deviceId: DEVICE_DE_PRUEBA } }, select: { imei: true, encendido: true, encendidoDesde: true } });
    if (!equipos.length) return [];
    const ayer = new Date(Date.now() - 86_400_000);
    const imeis = equipos.map((e) => e.imei);
    const [total, andando, andandoPobres, vibraciones] = await Promise.all([
        prisma.gpsPosicion.groupBy({ by: ["imei"], where: { imei: { in: imeis } }, _count: { _all: true } }),
        prisma.gpsPosicion.groupBy({ by: ["imei"], where: { imei: { in: imeis }, cuando: { gte: ayer }, velocidad: { gte: 10 } }, _count: { _all: true } }),
        prisma.gpsPosicion.groupBy({ by: ["imei"], where: { imei: { in: imeis }, cuando: { gte: ayer }, velocidad: { gte: 10 }, satelites: { lt: SATS_MIN } }, _count: { _all: true } }),
        prisma.gpsEvento.groupBy({ by: ["imei"], where: { imei: { in: imeis }, cuando: { gte: ayer }, tipo: "GPS_VIBRACION" }, _count: { _all: true } }),
    ]);
    const de = (g: { imei: string; _count: { _all: number } }[]) => new Map(g.map((x) => [x.imei, x._count._all]));
    const mTotal = de(total), mAnd = de(andando), mPobres = de(andandoPobres), mVib = de(vibraciones);
    const out: DiagnosticoGps[] = [];
    for (const e of equipos) {
        const avisos: string[] = [];
        if (e.encendido === true && e.encendidoDesde && Date.now() - e.encendidoDesde.getTime() > ACC_SOSPECHOSO_H * 3600_000) {
            /* «Encendido» hace horas: ¿se movió en ese tiempo? Si anduvo, es un viaje largo y está bien. */
            const anduvo = await prisma.gpsPosicion.count({ where: { imei: e.imei, cuando: { gte: e.encendidoDesde }, velocidad: { gte: 10 }, satelites: { gte: SATS_MIN } } });
            if (!anduvo) avisos.push(`El motor figura encendido hace ${Math.floor((Date.now() - e.encendidoDesde.getTime()) / 3600_000)} h y el vehículo no se movió: revisar el cable de encendido (ACC) del rastreador. Mientras esté así, «se mueve con el motor apagado» no puede avisar.`);
        }
        const vib = mVib.get(e.imei) || 0;
        if (vib >= 20) avisos.push(`Mandó ${vib} alarmas de vibración en 24 h: está en guardia con la sensibilidad alta. Conviene bajársela o sacarlo de guardia (se configura en el rastreador).`);
        const and = mAnd.get(e.imei) || 0, pobres = mPobres.get(e.imei) || 0;
        if (and >= 30 && pobres / and > 0.3) avisos.push(`${Math.round((pobres / and) * 100)} % de sus posiciones andando llegó con pocos satélites: revisar dónde quedó instalado, la antena necesita ver el cielo.`);
        out.push({ imei: e.imei, posiciones: mTotal.get(e.imei) || 0, avisos });
    }
    return out;
}

/**
 * La puerta del receptor. «Abierta»: un equipo desconocido que se presenta se anota para que
 * alguien lo acepte (así se da de alta uno nuevo). «Cerrada»: sólo se atiende a los aceptados, y
 * el resto es como si el puerto no existiera. Lo razonable es tenerla cerrada y abrirla el rato
 * que dura una instalación. El receptor la relee cada medio minuto.
 */
export async function puertaGps(): Promise<{ cerrada: boolean; pendientes: number }> {
    await sesion("dispositivos");
    const [f, pendientes] = await Promise.all([
        prisma.setting.findUnique({ where: { key: "GPS_PUERTA" } }),
        prisma.gpsEquipo.count({ where: { deviceId: null } }),
    ]);
    return { cerrada: f?.value === "cerrada", pendientes };
}

export async function cambiarPuertaGps(cerrada: boolean): Promise<{ ok: boolean }> {
    const s = await sesion("dispositivos.editar");
    const value = cerrada ? "cerrada" : "abierta";
    await prisma.setting.upsert({ where: { key: "GPS_PUERTA" }, create: { key: "GPS_PUERTA", value }, update: { value } });
    await auditar(s, "equipos.gps.puerta", "GPS_PUERTA", true, value);
    return { ok: true };
}

/** Descarta a uno que se presentó y nadie aceptó: borra su registro. Si vuelve a presentarse con la puerta abierta, vuelve a anotarse. */
export async function descartarGps(imei: string): Promise<{ ok: boolean; error?: string }> {
    const s = await sesion("dispositivos.editar");
    const e = await prisma.gpsEquipo.findUnique({ where: { imei } });
    if (!e) return { ok: true };
    if (e.deviceId && (await prisma.device.count({ where: { id: e.deviceId } }))) return { ok: false, error: "Ese rastreador está dado de alta: se quita desde Dispositivos." };
    await prisma.gpsEquipo.delete({ where: { imei } });
    await auditar(s, "equipos.gps.descartar", imei, true, `IMEI ${imei}`);
    return { ok: true };
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
    /* Y al historial del rastreador: en su línea de tiempo, «le cortaron la alimentación» y «alguien
       accionó el relé» tienen que poder leerse juntos. Con quién fue y lo que contestó el equipo. */
    if (escribe && r.ok) await prisma.gpsEvento.create({
        data: { imei, tipo: accion === "rele.accionar" ? "GPS_RELE_ACCIONADO" : "GPS_RELE_SOLTADO", lat: e.lat, lon: e.lon, detalle: `Por ${String(s?.name || s?.sub || "panel")} · equipo: «${(r.respuesta || "").replace(/\s+/g, " ").trim().slice(0, 80)}»` },
    }).catch(() => { });
    return { ...r, cortado };
}

/**
 * Las geocercas: zonas sobre el mapa que avisan cuando un rastreador entra o sale. Las evalúa el
 * receptor (otro proceso), que las relee cada medio minuto: un cambio acá tarda hasta ese tiempo
 * en empezar a valer.
 */
export type Geocerca = {
    id: string; nombre: string; lat: number; lon: number; radio: number; imeis: string[]; activa: boolean;
    /** Zona de forma libre: sus vértices. Null = círculo. */
    puntos: [number, number][] | null;
    /** Cuándo vigila. Null = siempre. */
    horario: HorarioCerca | null;
    avisa: AvisaCerca;
};

const AVISA: AvisaCerca[] = ["ambos", "entra", "sale"];

export async function geocercasGps(): Promise<Geocerca[]> {
    await sesion("dispositivos");
    const f = await prisma.gpsGeocerca.findMany({ orderBy: { createdAt: "asc" } });
    return f.map((g) => ({
        id: g.id, nombre: g.nombre, lat: g.lat, lon: g.lon, radio: g.radio, imeis: g.imeis, activa: g.activa,
        puntos: puntosDe({ puntos: g.puntos }), horario: leerHorario(g.horario), avisa: AVISA.includes(g.avisa as AvisaCerca) ? (g.avisa as AvisaCerca) : "ambos",
    }));
}

export async function guardarGeocercaGps(g: {
    id?: string; nombre: string; lat: number; lon: number; radio: number; imeis?: string[]; activa?: boolean;
    puntos?: [number, number][] | null; horario?: HorarioCerca | null; avisa?: AvisaCerca;
}): Promise<{ ok: boolean; id?: string; error?: string }> {
    const s = await sesion("dispositivos.editar");
    const nombre = String(g.nombre || "").trim().slice(0, 60);
    if (!nombre) return { ok: false, error: "La geocerca necesita un nombre: es lo que va a decir el aviso." };

    /* De forma libre: valen los vértices, y el centro y el radio que se guardan son los del círculo
       que los contiene. Con menos de tres puntos no hay zona. */
    let lat = g.lat, lon = g.lon, radio: number, puntos: [number, number][] | null = null;
    if (g.puntos != null) {
        puntos = puntosDe({ puntos: g.puntos });
        if (!puntos) return { ok: false, error: "Una zona de forma libre necesita al menos tres puntos sobre el mapa." };
        if (puntos.length > VERTICES_MAX) return { ok: false, error: `Son demasiados puntos (${puntos.length}). Con ${VERTICES_MAX} alcanza para cualquier predio.` };
        const c = circuloDe(puntos)!;
        lat = c.lat; lon = c.lon; radio = c.radio;
    } else {
        if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return { ok: false, error: "El centro no es un punto del mapa." };
        /* Menos de 30 m es más chico que el ruido del propio GPS: avisaría sola. */
        radio = Math.round(Math.min(Math.max(Number(g.radio) || 0, 30), 50_000));
    }
    /* Un horario a medio cargar (sin días, o con la misma hora de los dos lados) no se guarda como
       «nunca»: se rechaza, que es distinto de callarse. */
    const horario = g.horario ? leerHorario(g.horario) : null;
    if (g.horario && !horario) return { ok: false, error: "El horario necesita al menos un día y dos horas distintas." };
    const avisa: AvisaCerca = AVISA.includes(g.avisa as AvisaCerca) ? (g.avisa as AvisaCerca) : "ambos";

    const data = {
        nombre, lat, lon, radio, imeis: [...new Set((g.imeis || []).map(String))].slice(0, 200), activa: g.activa !== false,
        puntos: puntos ?? Prisma.DbNull, horario: horario ?? Prisma.DbNull, avisa,
    };
    const fila = g.id
        ? await prisma.gpsGeocerca.update({ where: { id: g.id }, data, select: { id: true } })
        : await prisma.gpsGeocerca.create({ data, select: { id: true } });
    await auditar(s, g.id ? "equipos.gps.geocerca.cambiar" : "equipos.gps.geocerca.alta", fila.id, true,
        `${nombre} · ${puntos ? `forma libre, ${puntos.length} puntos` : `${radio} m`} · vigila ${rotuloDeHorario(horario)}${data.imeis.length ? ` · ${data.imeis.length} rastreadores` : ""}`);
    return { ok: true, id: fila.id };
}

export async function borrarGeocercaGps(id: string): Promise<{ ok: boolean }> {
    const s = await sesion("dispositivos.editar");
    const g = await prisma.gpsGeocerca.delete({ where: { id } }).catch(() => null);
    if (g) await auditar(s, "equipos.gps.geocerca.borrar", id, true, g.nombre);
    return { ok: !!g };
}


/* ─────────── Compartir la posición con alguien de afuera (lib/gps-compartir tiene el porqué) ─────────── */

export type Compartido = { id: string; nombre: string; ruta: string; venceAt: string; conRecorrido: boolean; creadoPor: string; createdAt: string; vistas: number; ultimaVista: string | null };

const comoCompartido = (c: { id: string; token: string; nombre: string; venceAt: Date; conRecorrido: boolean; creadoPor: string; createdAt: Date; vistas: number; ultimaVista: Date | null }): Compartido =>
    ({ id: c.id, nombre: c.nombre, ruta: `/seguir/${c.token}`, venceAt: c.venceAt.toISOString(), conRecorrido: c.conRecorrido, creadoPor: c.creadoPor, createdAt: c.createdAt.toISOString(), vistas: c.vistas, ultimaVista: c.ultimaVista?.toISOString() || null });

/** Los enlaces que hoy muestran a ese rastreador. Los vencidos y los cortados no se listan: ya no muestran nada. */
export async function compartidosGps(imei: string): Promise<Compartido[]> {
    await sesion("dispositivos.editar");
    const f = await prisma.gpsCompartido.findMany({ where: { imei, revocadoAt: null, venceAt: { gt: new Date() } }, orderBy: { createdAt: "desc" } });
    return f.map(comoCompartido);
}

export async function compartirGps(imei: string, o: { horas: number; nombre?: string; conRecorrido?: boolean }): Promise<{ ok: boolean; compartido?: Compartido; error?: string }> {
    const s = await sesion("dispositivos.editar");
    const e = await prisma.gpsEquipo.findUnique({ where: { imei }, select: { imei: true, nombre: true, deviceId: true, lat: true, lon: true } });
    if (!e?.deviceId) return { ok: false, error: "Ese rastreador no está dado de alta." };
    const horas = horasValidas(o.horas);
    /* El nombre es lo que ve quien abre el enlace. Por defecto, el del rastreador; nunca el IMEI. */
    const nombre = String(o.nombre || "").trim().slice(0, 60) || e.nombre || "Vehículo";
    const quien = String(s?.name || s?.sub || "panel");
    const fila = await prisma.gpsCompartido.create({
        data: { token: randomBytes(18).toString("base64url"), imei, nombre, venceAt: new Date(Date.now() + horas * 3600_000), conRecorrido: o.conRecorrido !== false, creadoPor: quien },
    });
    const rotulo = DURACIONES.find((d) => d.horas === horas)?.rotulo || `${horas} h`;
    await auditar(s, "equipos.gps.compartir", imei, true, `«${nombre}» por ${rotulo}${fila.conRecorrido ? ", con recorrido" : ""}`);
    // En la línea de tiempo del rastreador: que alguien de afuera lo esté viendo es algo que le pasó.
    await prisma.gpsEvento.create({ data: { imei, tipo: "GPS_COMPARTIDO", lat: e.lat, lon: e.lon, detalle: `Por ${quien} · ${rotulo}` } }).catch(() => { });
    return { ok: true, compartido: comoCompartido(fila) };
}

export async function cortarCompartidoGps(id: string): Promise<{ ok: boolean }> {
    const s = await sesion("dispositivos.editar");
    const c = await prisma.gpsCompartido.findUnique({ where: { id } });
    if (!c || estadoDeEnlace(c) !== "vigente") return { ok: !!c };
    await prisma.gpsCompartido.update({ where: { id }, data: { revocadoAt: new Date() } });
    await auditar(s, "equipos.gps.dejar-de-compartir", c.imei, true, `«${c.nombre}», lo había compartido ${c.creadoPor}`);
    return { ok: true };
}
