"use server";

import { randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { DURACIONES, estadoDeEnlace, horasValidas } from "@/lib/gps-compartir";
import { leerLimite } from "@/lib/gps-jornada";
import { limitesDelDia, ZONA } from "@/lib/fechas";
import { RECORRIDO_MAX_DIAS, tiposQueDicen } from "@/lib/gps-filtro";
import { prisma } from "@/lib/prisma";
import { circuloDe, leerHorario, puntosDe, rotuloDeHorario, VERTICES_MAX, type AvisaCerca, type HorarioCerca } from "@/lib/gps-geocerca";
import { getSession } from "@/app/actions/auth";
import { permisosDeSesion } from "@/lib/permisos";
import { puedeGps, type QueGps } from "@/lib/gps-permisos";
import { olvidarServicioDeRutas, porLaCalleDe, servicioDeRutas } from "@/lib/rutas";
import { estadoOmniRutas, fraseDeRutas, prenderOmniRutas, type FaseRutas } from "@/lib/omni-rutas";
import { SILENCIO_MAX_S } from "@/lib/gps-calle";
import { armarComando, CLAVE_EQUIPO, comandoPorClave, comandosDe, palabraDeConfirmacion, pareceRechazo, type NivelComando, type Valores } from "@/lib/gps-comandos";
import { auditar } from "@/lib/centrales/sesion";
import { leerEstadoRele, puedeAccionarRele } from "@/lib/gps-rele";
import { aligerar, type ResumenRecorrido } from "@/lib/gps-recorrido";
import { nivelDelTanque, rendimiento, type NivelTanque } from "@/lib/gps-combustible";
import { resumenDeViajes, viajesYParadas, type Parada, type Viaje } from "@/lib/gps-viajes";
import { CLASES_EVENTO_GPS, EVENTOS_GPS, tiposDeClase, type ClaseEventoGps } from "@/lib/gps-eventos";
import { CLAVES_REPORTE, type ClaveReporte } from "@/lib/gps-reportes-catalogo";
import { armarReporteGps, conDirecciones, HORARIO_LABORAL_GPS, horarioLaboral, type ReporteGps } from "@/lib/gps-reportes-servidor";
import { AJUSTE_GEO, direccionesDe, olvidarServicio, probarServicio, servicioDeDirecciones, urlValida } from "@/lib/direcciones";
import { claveDeLugar } from "@/lib/direccion-texto";
import { estadoOmniGeo, fraseDeFase, prenderOmniGeo, URL_GEO, type FaseGeo } from "@/lib/omni-geo";
import { funcionActiva } from "@/app/actions/funciones";
import { leerMatriculaGps } from "@/lib/gps-matricula";

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
    /** Esa matrícula además está en el padrón de vehículos. No hace falta para rastrearlo. */
    enPadron: boolean;
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
    /** Dónde está, en palabras: «Cavour 3230, La Blanqueada, Montevideo». Null si no hay servicio de direcciones o no hay nada que decir. */
    direccion: string | null;
    /** Qué protocolo habla (GT06, TELTONIKA, TOPFLY): de eso depende qué comandos se le pueden mandar. */
    protocolo: string;
    /** Sólo los que se enchufan al conector OBD: lo último que le leyó al motor, el chasis y su cuentakilómetros. */
    motor: MotorGps | null;
    /** Cuánto queda en el tanque: lo que dice el vehículo, o lo que se estima (lib/gps-combustible). */
    tanque: NivelTanque & { capacidad: number | null };
    /** Litros cada 100 km desde que el equipo está puesto; null si anduvo poco para decirlo. */
    rendimiento: number | null;
    fallas: FallasGps | null;
    vin: string | null;
    odometroKm: number | null;
};
/** Lo que un rastreador OBD le lee al motor. Cada dato puede faltar: no todos los vehículos contestan todo. */
export type MotorGps = {
    rpm?: number; agua?: number; aire?: number; carga?: number; acelerador?: number; presion?: number; caudal?: number;
    /** Nivel de combustible, en porcentaje o en litros según lo dé el vehículo. */
    combustible?: number; combustibleL?: number;
    /** Litros por hora en ese instante, y litros quemados desde que el equipo está puesto. */
    consumo?: number; consumido?: number;
    cuando?: string;
};
/** Los códigos de falla que el vehículo tiene guardados, según el rastreador. Lista vacía: no tiene. */
export type FallasGps = { codigos: string[]; norma?: string; cuando?: string };

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- la sesión es el JWT crudo
async function sesion(que: QueGps): Promise<any> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s: any = await getSession().catch(() => null);
    if (!s || !puedeGps(permisosDeSesion(s), que)) throw new Error("Tu rol no puede hacer eso con los rastreadores.");
    return s;
}

export async function rastreadoresGps(): Promise<Rastreador[]> {
    await sesion("ver");
    /* Los de la prueba de carga (scripts/carga-gps.js) no son de nadie: no se listan. */
    const equipos = await prisma.gpsEquipo.findMany({ where: { OR: [{ deviceId: null }, { NOT: { deviceId: DEVICE_DE_PRUEBA } }] }, orderBy: { createdAt: "asc" } });
    if (!equipos.length) return [];
    /* Antes acá se contaban TODAS las posiciones de cada rastreador, en cada refresco (cada 15 s
       desde el mapa y cada 20 desde Dispositivos): recorrer la tabla entera para mostrar «1.369
       puntos». Con un equipo no se nota; con doscientos son millones de filas por minuto. El
       número pasó al diagnóstico, que se pide cada tanto (diagnosticoGps). */
    const [devs, vehs] = await Promise.all([
        prisma.device.findMany({ where: { id: { in: equipos.map((e) => e.deviceId).filter(Boolean) as string[] } }, select: { id: true, name: true } }),
        /* La matrícula es del rastreador; al padrón sólo se le pregunta si además está ahí. */
        prisma.vehicle.findMany({ where: { plate: { in: equipos.map((e) => e.matricula).filter(Boolean) as string[] } }, select: { plate: true } }),
    ]);
    const nombreDe = new Map(devs.map((d) => [d.id, d.name]));
    const enPadron = new Set(vehs.map((v) => v.plate));
    const ahora = Date.now();
    /* La dirección de cada uno. Casi siempre sale de lo guardado; las preguntas nuevas tienen tope
       para que la lista —que se pide cada quince segundos— no espere nunca a nadie. */
    const dir = await direccionesDe(equipos.flatMap((e) => (e.lat !== null && e.lon !== null ? [{ lat: e.lat, lon: e.lon }] : [])), { nuevasMax: 40 });
    return equipos.map((e) => {
        /* Si el Device se borró, el rastreador vuelve a «sin dar de alta»: el vínculo no puede
           apuntar a un equipo que ya no existe. */
        const vivo = e.deviceId && nombreDe.has(e.deviceId) ? e.deviceId : null;
        return {
            imei: e.imei, nombre: (vivo && nombreDe.get(vivo)) || e.nombre, deviceId: vivo,
            matricula: e.matricula || null, enPadron: !!e.matricula && enPadron.has(e.matricula),
            enLinea: !!e.ultimoLatido && ahora - e.ultimoLatido.getTime() < EN_LINEA_MS,
            ultimoLatido: e.ultimoLatido?.toISOString() || null,
            lat: e.lat, lon: e.lon, cuando: e.cuando?.toISOString() || null,
            velocidad: e.velocidad, rumbo: e.rumbo, encendido: e.encendido,
            bateria: e.bateria, senal: e.senal, voltaje: e.voltaje, cortado: e.cortado, icono: e.icono,
            sinReporteDesde: e.sinReporteDesde?.toISOString() || null,
            direccion: (e.lat !== null && e.lon !== null && dir.get(claveDeLugar(e.lat, e.lon))) || null,
            protocolo: e.protocolo || "GT06",
            tanque: { ...nivelDelTanque(e.motor as MotorGps | null, { capacidad: e.tanqueLitros, llenoEn: e.tanqueLlenoEn, llenoCuando: e.tanqueLlenoCuando?.toISOString() || null }), capacidad: e.tanqueLitros },
            rendimiento: rendimiento((e.motor as MotorGps | null)?.consumido, e.odometro === null ? null : e.odometro / 1000),
            motor: (e.motor as MotorGps | null) || null, fallas: (e.fallas as FallasGps | null) || null, vin: e.vin, odometroKm: e.odometro === null ? null : Math.round(e.odometro / 100) / 10,
        };
    });
}

/** Da de alta como equipo a un rastreador que se presentó. Devuelve el id del Device creado. */
export async function darDeAltaGps(imei: string, nombre: string): Promise<{ ok: boolean; deviceId?: string; error?: string }> {
    const s = await sesion("equipo");
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
    const s = await sesion("config");
    const limpio = nombre.trim().slice(0, 60);
    if (!limpio) return { ok: false, error: "El nombre no puede quedar vacío." };
    const e = await prisma.gpsEquipo.findUnique({ where: { imei } });
    if (!e?.deviceId) return { ok: false, error: "Ese rastreador no está dado de alta." };
    await prisma.device.update({ where: { id: e.deviceId }, data: { name: limpio } });
    await prisma.gpsEquipo.update({ where: { imei }, data: { nombre: limpio } });
    await auditar(s, "equipos.gps.renombrar", e.deviceId, true, `IMEI ${imei} → ${limpio}`);
    return { ok: true };
}

/**
 * Le pone al rastreador la matrícula del vehículo que lo lleva (vacía = se la saca).
 *
 * No hace falta que la matrícula esté en el padrón (lib/gps-matricula dice por qué). Si está, queda
 * además atado a ese vehículo, y `enPadron` lo cuenta para que la pantalla lo diga.
 *
 * Una matrícula la lleva un solo rastreador: el cruce con las cámaras busca «el rastreador de esta
 * chapa», y con dos no sabría contra cuál comparar. Casi siempre es un error de tipeo o un equipo
 * que se cambió y quedó el viejo con la matrícula; el mensaje dice cuál la tiene.
 */
export async function atarVehiculoGps(imei: string, matricula: string): Promise<{ ok: boolean; error?: string; enPadron?: boolean }> {
    const s = await sesion("config");
    const leida = leerMatriculaGps(matricula);
    if ("error" in leida) return { ok: false, error: leida.error };
    const chapa = leida.chapa;
    if (!chapa) {
        await prisma.gpsEquipo.update({ where: { imei }, data: { matricula: null, vehicleId: null } });
        await auditar(s, "equipos.gps.vehiculo", imei, true, `IMEI ${imei} → sin matrícula`);
        return { ok: true };
    }
    const otro = await prisma.gpsEquipo.findFirst({ where: { matricula: chapa, imei: { not: imei } }, select: { imei: true, nombre: true } });
    if (otro) return { ok: false, error: `La matrícula ${chapa} ya la lleva otro rastreador: ${otro.nombre || `el que termina en ${otro.imei.slice(-6)}`}. Sacásela a ese primero.` };
    const v = await prisma.vehicle.findUnique({ where: { plate: chapa }, select: { id: true } });
    await prisma.gpsEquipo.update({ where: { imei }, data: { matricula: chapa, vehicleId: v?.id ?? null } });
    await auditar(s, "equipos.gps.vehiculo", imei, true, `IMEI ${imei} → ${chapa}${v ? "" : " (no está en el padrón)"}`);
    return { ok: true, enPadron: !!v };
}

/** `rumbo`, `sat` y `enc` son lo demás que reportó el equipo en ese punto: se ven al recorrer el trayecto. */
/**
 * `via`: el punto no lo reportó el equipo; es del camino por la calle entre dos que sí reportó
 * (lib/gps-calle). Dibuja la línea y lleva al auto que la recorre, con la hora y la velocidad que le
 * tocan por dónde está entre los dos; no cuenta como posición.
 */
export type PuntoGps = { lat: number; lon: number; cuando: string; velocidad: number; rumbo?: number | null; sat?: number | null; enc?: boolean | null; via?: true };
export type RecorridoGps = {
    puntos: PuntoGps[]; resumen: ResumenRecorrido; viajes: Viaje[]; paradas: Parada[];
    /** La velocidad permitida por la empresa (km/h): contra ella se marca el exceso en la línea. */
    limite: number;
    /** La dirección de donde empezó y terminó cada viaje, por la clave del punto (`claveDeLugar`). Vacío si no hay servicio de direcciones. */
    lugares: Record<string, string>;
    /** El trazo va por la calle entre posición y posición (función «Recorridos por la calle»). Si no, en línea recta. */
    porCalle: boolean;
};

/**
 * Por dónde anduvo en las últimas horas: sus VIAJES, y nada más.
 *
 * La primera versión dibujaba todas las posiciones unidas por una línea, y la primera noche real
 * (21/11) el mapa mostró una telaraña alrededor de un auto estacionado: 29 «viajes» y 48,8 km
 * donde hubo 8 viajes y 37,5 km. Un auto quieto con mala señal no manda una posición fija: manda
 * decenas de posiciones que saltan, con velocidad y todo.
 *
 * Así que ahora:
 *  · Sólo entran las posiciones con satélites suficientes PARA SU EQUIPO (las que no son `pobre`:
 *    lo decide el receptor al guardarlas, con el mínimo de cada protocolo).
 *  · Se cortan los viajes (lib/gps-viajes), que exigen haberse alejado de donde se salió.
 *  · Al mapa van únicamente los puntos que son parte de un viaje. Lo que pasó entre viaje y viaje
 *    es una PARADA —un lugar y un tiempo—, no una línea.
 *  · Los kilómetros, el tiempo y la velocidad máxima son los de los viajes.
 */
export async function recorridoGps(imei: string, horas = 24, rango?: { desde: string; hasta?: string | null } | null): Promise<RecorridoGps> {
    await sesion("ver");
    /* Con `rango`, el recorrido es el de esas fechas y horas (22/11: «filtrar por fecha y hora
       también»); si no, las últimas `horas`. Un rango de más de un mes se recorta desde su comienzo:
       más que eso no es un recorrido que se pueda leer. */
    const d0 = rango?.desde ? new Date(rango.desde) : null, h0 = rango?.hasta ? new Date(rango.hasta) : null;
    const conRango = !!d0 && !Number.isNaN(d0.getTime());
    const desde = conRango ? d0! : new Date(Date.now() - Math.min(Math.max(horas, 1), 24 * 31) * 3600_000);
    const tope = new Date(desde.getTime() + RECORRIDO_MAX_DIAS * 86_400_000);
    const hasta = conRango ? (h0 && !Number.isNaN(h0.getTime()) && h0 < tope ? h0 : h0 ? tope : null) : null;
    const filas = await prisma.gpsPosicion.findMany({
        where: { imei, cuando: { gte: desde, ...(hasta ? { lte: hasta } : {}) }, pobre: false }, orderBy: { cuando: "asc" }, take: 120_000,
        select: { lat: true, lon: true, cuando: true, velocidad: true, rumbo: true, satelites: true, encendido: true },
    });
    const todos: PuntoGps[] = filas.map((f) => ({ lat: f.lat, lon: f.lon, cuando: f.cuando.toISOString(), velocidad: f.velocidad, rumbo: f.rumbo, sat: f.satelites, enc: f.encendido }));
    const { viajes, paradas } = viajesYParadas(todos);
    /* Los puntos de cada viaje, por su horario. Los dos están ordenados, así que se recorren juntos. */
    const porViaje: PuntoGps[][] = [];
    let k = 0;
    for (const v of viajes) {
        const suyos: PuntoGps[] = [];
        while (k < todos.length && todos[k].cuando < v.desde) k++;
        while (k < todos.length && todos[k].cuando <= v.hasta) suyos.push(todos[k++]);
        porViaje.push(suyos);
    }
    /* Cada viaje, por la calle (24/11: «no está bien alineado con las calles»). Los kilómetros, los
       viajes y las paradas ya se contaron con las posiciones del equipo: esto sólo cambia el dibujo. */
    const [lugares, calle] = await Promise.all([direccionesDe(viajes.flatMap((v) => [v.inicio, v.fin]), { nuevasMax: 400 }), porLaCalleDe(porViaje)]);
    return {
        lugares: Object.fromEntries(lugares),
        /* El tope sube cuando va por la calle: cada posición trae además los puntos de su camino. */
        puntos: aligerar(calle.tramos.flat(), calle.ajustado ? 8000 : 3000),
        porCalle: calle.ajustado,
        resumen: resumenDeViajes(viajes, todos[0]?.cuando || null, todos[todos.length - 1]?.cuando || null, todos.length),
        viajes, paradas,
        limite: leerLimite((await prisma.setting.findUnique({ where: { key: LIMITE_GPS } }).catch(() => null))?.value),
    };
}

/** El ajuste con la velocidad permitida por la empresa. Uno para todos los vehículos. */
const LIMITE_GPS = "GPS_VELOCIDAD_PERMITIDA";

/** La velocidad permitida hoy. Para la pestaña Ajustes de Gestión GPS, que la muestra sin pedir un recorrido entero. */
export async function limiteVelocidadGps(): Promise<number> {
    await sesion("ver");
    return leerLimite((await prisma.setting.findUnique({ where: { key: LIMITE_GPS } }).catch(() => null))?.value);
}

export async function guardarLimiteVelocidadGps(kmh: number): Promise<{ ok: boolean; limite?: number; error?: string }> {
    const s = await sesion("config");
    const n = Math.round(Number(kmh));
    if (!Number.isFinite(n) || n < 20 || n > 200) return { ok: false, error: "Poné una velocidad entre 20 y 200 km/h." };
    await prisma.setting.upsert({ where: { key: LIMITE_GPS }, update: { value: String(n) }, create: { key: LIMITE_GPS, value: String(n) } });
    await auditar(s, "equipos.gps.limite-velocidad", "todos", true, `${n} km/h`);
    return { ok: true, limite: n };
}

/**
 * La estela: las últimas posiciones buenas, tal cual, sin cortar en viajes. Para «últimos 10
 * minutos» y para el modo en vivo, donde lo que se quiere ver es por dónde viene AHORA: cortar
 * diez minutos en viajes y paradas no dice nada, y el viaje en curso todavía no terminó.
 */
export async function estelaGps(imei: string, minutos = 10): Promise<PuntoGps[]> {
    await sesion("ver");
    const desde = new Date(Date.now() - Math.min(Math.max(minutos, 1), 120) * 60_000);
    const filas = await prisma.gpsPosicion.findMany({
        where: { imei, cuando: { gte: desde }, pobre: false }, orderBy: { cuando: "asc" }, take: 2000,
        select: { lat: true, lon: true, cuando: true, velocidad: true },
    });
    const puntos: PuntoGps[] = filas.map((f) => ({ lat: f.lat, lon: f.lon, cuando: f.cuando.toISOString(), velocidad: f.velocidad }));
    /* Por la calle, de a tramos seguidos: donde el equipo calló más de dos minutos no se dibuja un camino (ni se le pregunta por él). */
    const seguidos: PuntoGps[][] = [];
    for (const p of puntos) {
        const t = seguidos[seguidos.length - 1], ult = t?.[t.length - 1];
        if (ult && Date.parse(p.cuando) - Date.parse(ult.cuando) <= SILENCIO_MAX_S * 1000) t.push(p); else seguidos.push([p]);
    }
    return (await porLaCalleDe(seguidos)).tramos.flat();
}

/** ¿Los recorridos van por la calle en esta instalación? El mapa en vivo lo pregunta una vez, para saber si vale la pena pedir el camino de cada posición nueva. */
export async function ajusteACalleGps(): Promise<boolean> {
    await sesion("ver");
    return !!(await servicioDeRutas());
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
    await sesion("ver");
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
    await sesion("ver");
    const f = await prisma.gpsEvento.findUnique({ where: { id: String(id || "") } }).catch(() => null);
    return f ? aEvento(f) : null;
}

export type HistorialEventosGps = {
    eventos: EventoGps[];
    /** Hay más viejos que éstos: se piden con `antes` = la hora del último. */
    hayMas: boolean;
    /** Cuántos hay de cada clase en el período, sin importar el filtro: los números de las pestañas. */
    cuenta: Record<ClaseEventoGps, number>;
    /** Lo mismo, tipo por tipo: para elegir uno solo dentro de una clase. */
    porTipo: Record<string, number>;
};

/**
 * TODO lo que le pasó a un rastreador, para su cajón de eventos en el mapa (21/11, Nico: «la lista
 * de todos los eventos que le ocurrieron»). Acá sí entran los de satélites y los del relé: el
 * cajón tiene pestañas para apartarlos y pliega las rachas, así que no tapan nada.
 *
 * Se pagina por la hora (`antes`): la lista crece hacia atrás sin volver a traer lo que ya está.
 */
export async function historialEventosGps(o: {
    imei: string; clase?: ClaseEventoGps | null; dias?: number | null; antes?: string | null; cuantos?: number;
    /** El período con fecha y hora (ISO). Gana sobre `dias`. Sin `hasta`, llega hasta ahora. */
    desde?: string | null; hasta?: string | null;
    /** Tipos concretos, dentro de la clase. */
    tipos?: string[];
    /** Lo que dice el evento, su detalle o el lugar. */
    texto?: string;
    /** Sólo los que abrieron un caso en la consola. */
    soloCasos?: boolean;
}): Promise<HistorialEventosGps> {
    await sesion("ver");
    const imei = String(o.imei || "");
    const cuantos = Math.min(Math.max(o.cuantos || 60, 10), 200);
    const fecha = (v: string | null | undefined) => { const d = v ? new Date(v) : null; return d && !Number.isNaN(d.getTime()) ? d : null; };
    const desde = fecha(o.desde) ?? (o.dias ? new Date(Date.now() - Math.min(Math.max(o.dias, 1), 366) * 86_400_000) : null);
    const hasta = fecha(o.hasta), antes = fecha(o.antes);
    const clase = o.clase && CLASES_EVENTO_GPS.some((c) => c.clave === o.clase) ? o.clase : null;
    const texto = String(o.texto || "").trim().slice(0, 60);
    /* El texto se busca en lo que quedó escrito (el detalle, el lugar) y en el NOMBRE del evento,
       que no está en la base: «corte» tiene que encontrar «Le cortaron la alimentación». */
    const porTexto: Prisma.GpsEventoWhereInput | null = texto ? { OR: [
        { detalle: { contains: texto, mode: "insensitive" } }, { lugar: { contains: texto, mode: "insensitive" } },
        ...(tiposQueDicen(texto).length ? [{ tipo: { in: tiposQueDicen(texto) } }] : []),
    ] } : null;
    /* Lo que vale para la lista Y para los números de las pestañas: el período, el texto y «sólo
       casos». La clase y el tipo no entran en los números — son justamente lo que las pestañas
       dejan elegir, y si se filtraran a sí mismas dirían siempre cero en las demás. */
    const base: Prisma.GpsEventoWhereInput = {
        imei, ...(desde || hasta ? { cuando: { ...(desde ? { gte: desde } : {}), ...(hasta ? { lte: hasta } : {}) } } : {}),
        ...(o.soloCasos ? { prioridad: { not: null } } : {}), ...(porTexto ? { AND: [porTexto] } : {}),
    };
    const deLaClase = clase ? tiposDeClase(clase) : null;
    const pedidos = (o.tipos || []).filter((t) => typeof t === "string" && EVENTOS_GPS[t] && (!deLaClase || deLaClase.includes(t)));
    const [filas, porTipo] = await Promise.all([
        prisma.gpsEvento.findMany({
            where: {
                ...base,
                ...(pedidos.length ? { tipo: { in: pedidos } } : deLaClase ? { tipo: { in: deLaClase } } : {}),
                ...(antes ? { cuando: { ...(desde ? { gte: desde } : {}), ...(hasta && hasta < antes ? { lte: hasta } : { lt: antes }) } } : {}),
            },
            orderBy: [{ cuando: "desc" }, { id: "desc" }], take: cuantos + 1,
        }),
        prisma.gpsEvento.groupBy({ by: ["tipo"], where: base, _count: { _all: true } }),
    ]);
    const cuenta: Record<ClaseEventoGps, number> = { alarma: 0, geocerca: 0, conexion: 0, equipo: 0 };
    const cuentaPorTipo: Record<string, number> = {};
    for (const t of porTipo) { cuenta[EVENTOS_GPS[t.tipo]?.clase || "equipo"] += t._count._all; cuentaPorTipo[t.tipo] = t._count._all; }
    return { eventos: filas.slice(0, cuantos).map(aEvento), hayMas: filas.length > cuantos, cuenta, porTipo: cuentaPorTipo };
}

/**
 * Por dónde venía y para dónde siguió alrededor de un evento: las posiciones buenas de unos
 * minutos antes y después. Es lo que convierte «un punto en el mapa» en «venía por esta calle,
 * paró acá, y siguió para allá».
 */
export async function entornoEventoGps(imei: string, cuando: string, minutos = 5): Promise<PuntoGps[]> {
    await sesion("ver");
    const t = new Date(cuando).getTime();
    if (!Number.isFinite(t)) return [];
    const ms = Math.min(Math.max(minutos, 1), 30) * 60_000;
    const filas = await prisma.gpsPosicion.findMany({
        where: { imei, cuando: { gte: new Date(t - ms), lte: new Date(t + ms) }, pobre: false }, orderBy: { cuando: "asc" }, take: 600,
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
    await sesion("ver");
    const equipos = await prisma.gpsEquipo.findMany({ where: { deviceId: { not: null }, NOT: { deviceId: DEVICE_DE_PRUEBA } }, select: { imei: true, encendido: true, encendidoDesde: true } });
    if (!equipos.length) return [];
    const ayer = new Date(Date.now() - 86_400_000);
    const imeis = equipos.map((e) => e.imei);
    const [total, andando, andandoPobres, vibraciones] = await Promise.all([
        prisma.gpsPosicion.groupBy({ by: ["imei"], where: { imei: { in: imeis } }, _count: { _all: true } }),
        prisma.gpsPosicion.groupBy({ by: ["imei"], where: { imei: { in: imeis }, cuando: { gte: ayer }, velocidad: { gte: 10 } }, _count: { _all: true } }),
        prisma.gpsPosicion.groupBy({ by: ["imei"], where: { imei: { in: imeis }, cuando: { gte: ayer }, velocidad: { gte: 10 }, pobre: true }, _count: { _all: true } }),
        prisma.gpsEvento.groupBy({ by: ["imei"], where: { imei: { in: imeis }, cuando: { gte: ayer }, tipo: "GPS_VIBRACION" }, _count: { _all: true } }),
    ]);
    const de = (g: { imei: string; _count: { _all: number } }[]) => new Map(g.map((x) => [x.imei, x._count._all]));
    const mTotal = de(total), mAnd = de(andando), mPobres = de(andandoPobres), mVib = de(vibraciones);
    const out: DiagnosticoGps[] = [];
    for (const e of equipos) {
        const avisos: string[] = [];
        if (e.encendido === true && e.encendidoDesde && Date.now() - e.encendidoDesde.getTime() > ACC_SOSPECHOSO_H * 3600_000) {
            /* «Encendido» hace horas: ¿se movió en ese tiempo? Si anduvo, es un viaje largo y está bien. */
            const anduvo = await prisma.gpsPosicion.count({ where: { imei: e.imei, cuando: { gte: e.encendidoDesde }, velocidad: { gte: 10 }, pobre: false } });
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
    await sesion("ver");
    const [f, pendientes] = await Promise.all([
        prisma.setting.findUnique({ where: { key: "GPS_PUERTA" } }),
        prisma.gpsEquipo.count({ where: { deviceId: null } }),
    ]);
    return { cerrada: f?.value === "cerrada", pendientes };
}

export async function cambiarPuertaGps(cerrada: boolean): Promise<{ ok: boolean }> {
    const s = await sesion("equipo");
    const value = cerrada ? "cerrada" : "abierta";
    await prisma.setting.upsert({ where: { key: "GPS_PUERTA" }, create: { key: "GPS_PUERTA", value }, update: { value } });
    await auditar(s, "equipos.gps.puerta", "GPS_PUERTA", true, value);
    return { ok: true };
}

/** Descarta a uno que se presentó y nadie aceptó: borra su registro. Si vuelve a presentarse con la puerta abierta, vuelve a anotarse. */
export async function descartarGps(imei: string): Promise<{ ok: boolean; error?: string }> {
    const s = await sesion("equipo");
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
    await sesion("config");
    if (!ICONOS.has(icono)) return { ok: false, error: "Ese ícono no existe." };
    await prisma.gpsEquipo.update({ where: { imei }, data: { icono } });
    return { ok: true };
}

/** Cuántos litros entran en el tanque de este vehículo. Vacío lo borra. Lo usa la estimación del nivel. */
export async function guardarTanqueGps(imei: string, litros: number | null): Promise<{ ok: boolean; error?: string }> {
    await sesion("config");
    const n = litros === null ? null : Number(litros);
    if (n !== null && (!Number.isFinite(n) || n < 5 || n > 2000)) return { ok: false, error: "La capacidad del tanque va entre 5 y 2.000 litros." };
    await prisma.gpsEquipo.update({ where: { imei: String(imei) }, data: { tanqueLitros: n } });
    return { ok: true };
}

/**
 * «Llené el tanque»: desde acá se empieza a descontar lo que quema el motor. Se anota cuánto llevaba
 * consumido el equipo en este momento; si el equipo todavía no lo informó, no hay desde dónde contar.
 */
export async function tanqueLlenoGps(imei: string): Promise<{ ok: boolean; error?: string }> {
    await sesion("operar");
    const e = await prisma.gpsEquipo.findUnique({ where: { imei: String(imei) }, select: { motor: true, tanqueLitros: true } });
    if (!e) return { ok: false, error: "Ese rastreador no existe." };
    if (!e.tanqueLitros) return { ok: false, error: "Primero cargá cuántos litros entran en el tanque." };
    const consumido = (e.motor as MotorGps | null)?.consumido;
    if (consumido === undefined) return { ok: false, error: "El equipo todavía no informó cuánto lleva consumido: probá con el motor en marcha." };
    await prisma.gpsEquipo.update({ where: { imei: String(imei) }, data: { tanqueLlenoEn: consumido, tanqueLlenoCuando: new Date() } });
    return { ok: true };
}

/**
 * Los comandos al rastreador. La lista —qué hay, qué valores lleva cada uno, qué permiso pide— está
 * en lib/gps-comandos, que tiene también el porqué de que sea una lista cerrada y no texto libre.
 * Acá está lo que hace falta un servidor para hacer: exigir el permiso, aplicar la regla del relé,
 * mandar, preguntarle al equipo cómo quedó, y dejar escrito quién mandó qué.
 */
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

/** Qué hay que poder para mandar cada clase de comando. */
const PERMISO_DE_NIVEL: Record<NivelComando, QueGps> = { consulta: "operar", ajuste: "config", rele: "rele", instalacion: "equipo" };

export type RespuestaComando = {
    /** El equipo contestó. Que haya ACEPTADO lo dice `respuesta`, y `rechazo` si parece que no. */
    ok: boolean;
    /** Lo que contestó el equipo, textual. */
    respuesta?: string;
    error?: string;
    /** Lo que contestó cuando, después de una escritura, se le preguntó cómo quedó. */
    quedo?: string | null;
    rechazo?: boolean;
    /** El relé, si el comando lo tocó o lo consultó. */
    cortado?: boolean | null;
    /** El texto que viajó. */
    texto?: string;
};

/**
 * Manda un comando del catálogo y devuelve LO QUE EL EQUIPO CONTESTÓ, tal cual. No se traduce ni
 * se resume: cuando se trata de un relé o de a qué servidor reporta, la palabra del equipo es el dato.
 *
 * `confirmacion` es lo que la persona tipeó para los comandos que no tienen vuelta. Se comprueba
 * acá y no sólo en la pantalla: un pedido armado a mano no se saltea la pregunta.
 */
export async function mandarComandoGps(imei: string, clave: string, valores?: Valores | null, confirmacion?: string | null): Promise<RespuestaComando> {
    await sesion("operar");
    const e = await prisma.gpsEquipo.findUnique({ where: { imei: String(imei) } });
    if (!e) return { ok: false, error: "Ese rastreador no existe." };
    const def = comandoPorClave(e.protocolo, String(clave));
    if (!def) return { ok: false, error: comandosDe(e.protocolo).length ? "Ese comando no existe." : "Los comandos a este modelo de rastreador todavía no están hechos." };
    const s = await sesion(PERMISO_DE_NIVEL[def.nivel]);
    /* A uno que se presentó solo no se le manda nada: todavía no es de nadie. */
    if (!e.deviceId) return { ok: false, error: "Primero hay que dar de alta el rastreador." };

    const armado = armarComando(def, valores);
    if (!armado.ok) return { ok: false, error: armado.error };
    if (def.confirmar === "escribir" && String(confirmacion || "").trim() !== palabraDeConfirmacion(e.imei)) {
        return { ok: false, error: `Para confirmar hay que escribir los últimos cuatro números del IMEI (${palabraDeConfirmacion(e.imei)}).` };
    }
    const quien = String(s?.name || s?.sub || "panel");
    const anotado = def.paraAnotar ? def.paraAnotar(armado.valores) : armado.texto;
    const anotar = (ok: boolean, respuesta: string | null, quedo: string | null = null) =>
        prisma.gpsComando.create({ data: { imei: e.imei, clave: def.clave, texto: anotado, ok, respuesta: respuesta?.slice(0, 500) ?? null, quedo: quedo?.slice(0, 500) ?? null, quien } }).catch(() => { /* el historial no puede tirar abajo el comando */ });
    const esConsulta = def.nivel === "consulta";

    if (def.clave === "rele.accionar") {
        const v = puedeAccionarRele({ velocidad: e.velocidad, cuando: e.cuando, encendido: e.encendido, ultimoLatido: e.ultimoLatido });
        if (!v.ok) {
            await auditar(s, "equipos.gps.rele", e.deviceId, false, `IMEI ${e.imei} · accionar · frenado: ${v.motivo}`);
            await anotar(false, `No se mandó. ${v.motivo}`);
            return { ok: false, error: v.motivo, texto: anotado };
        }
    }

    /* Los comandos de un TopFly llevan la clave del equipo: la pone el servidor acá, no viaja desde la
       pantalla ni queda en el historial (ahí va `anotado`, que la trae tapada). De fábrica es 0000. */
    const viaja = armado.texto.includes(CLAVE_EQUIPO)
        ? armado.texto.replace(CLAVE_EQUIPO, ((await prisma.setting.findUnique({ where: { key: "GPS_TOPFLY_CLAVE" } }).catch(() => null))?.value || "0000").replace(/[^A-Za-z0-9]/g, "").slice(0, 10) || "0000")
        : armado.texto;
    const r = await alEquipo(e.imei, viaja);
    /* Después de una escritura se le pregunta al equipo cómo quedó, en vez de suponerlo. Para el relé
       importa (el latido que trae ese dato puede tardar cinco minutos); para lo demás, es la única
       prueba de que este clon entendió el comando. Lo que reinicia el equipo no se pregunta: no va a contestar. */
    let quedo: string | null = null;
    if (!esConsulta && r.ok && def.pregunta && !def.puedeCallar) {
        const c = await alEquipo(e.imei, def.pregunta);
        quedo = c.ok ? c.respuesta || "" : null;
    }
    let cortado: boolean | null | undefined;
    if (def.grupo === "rele") {
        const dicho = def.clave === "rele" ? (r.ok ? r.respuesta || "" : null) : quedo;
        cortado = dicho === null ? null : leerEstadoRele(dicho);
        if (cortado !== null && cortado !== undefined) await prisma.gpsEquipo.update({ where: { imei: e.imei }, data: { cortado } }).catch(() => { });
    }

    const respuesta = r.ok ? (r.respuesta || "").replace(/\s+/g, " ").trim() : null;
    /* Un equipo que se reinicia puede no llegar a contestar: no es que el comando haya fallado. */
    const error = r.ok ? undefined : def.puedeCallar && /no contestó/i.test(r.error || "") ? "El equipo no llegó a contestar. Con este comando es esperable: se reinicia. Mirá si vuelve a estar en línea en un par de minutos." : r.error;
    await anotar(r.ok, r.ok ? respuesta : error || null, quedo);
    if (!esConsulta) {
        const esRele = def.nivel === "rele";
        await auditar(s, esRele ? "equipos.gps.rele" : "equipos.gps.comando", e.deviceId, r.ok,
            `IMEI ${e.imei} · ${esRele ? (def.clave === "rele.accionar" ? "accionar" : "soltar") : `${def.titulo} · ${anotado}`} · ${r.ok ? `equipo: «${(respuesta || "").slice(0, 120)}»` : error}`);
    }
    /* Y al historial del rastreador: en su línea de tiempo, «le cortaron la alimentación» y «alguien
       accionó el relé» tienen que poder leerse juntos. Con quién fue y lo que contestó el equipo. */
    if (def.nivel === "rele" && r.ok) await prisma.gpsEvento.create({
        data: { imei: e.imei, tipo: def.clave === "rele.accionar" ? "GPS_RELE_ACCIONADO" : "GPS_RELE_SOLTADO", lat: e.lat, lon: e.lon, detalle: `Por ${quien} · equipo: «${(respuesta || "").slice(0, 80)}»` },
    }).catch(() => { });
    return { ok: r.ok, respuesta: respuesta ?? undefined, error, quedo, rechazo: r.ok && pareceRechazo(respuesta), cortado, texto: anotado };
}

/** Los cinco comandos de antes, con los nombres con que los llaman el mapa y Dispositivos. Son los mismos del catálogo. */
export type ComandoGps = "estado" | "posicion" | "rele" | "rele.accionar" | "rele.soltar";
export async function comandoGps(imei: string, accion: ComandoGps): Promise<{ ok: boolean; respuesta?: string; error?: string; cortado?: boolean | null }> {
    const r = await mandarComandoGps(imei, accion);
    return { ok: r.ok, respuesta: r.respuesta, error: r.error, cortado: r.cortado };
}

/**
 * Cómo tiene el equipo, hoy, lo que un comando cambia: para que el formulario arranque con lo que
 * hay y no con valores de fábrica. Le pregunta al equipo (una consulta, no cambia nada) y devuelve
 * también la respuesta textual, por si este firmware la escribe de una forma que no se sabe leer.
 */
export async function valoresActualesGps(imei: string, clave: string): Promise<{ ok: boolean; respuesta?: string; valores?: Valores | null; error?: string }> {
    await sesion("operar");
    const e = await prisma.gpsEquipo.findUnique({ where: { imei: String(imei) }, select: { imei: true, protocolo: true, deviceId: true } });
    const def = e ? comandoPorClave(e.protocolo, String(clave)) : null;
    if (!e || !def) return { ok: false, error: "Ese comando no existe." };
    if (!e.deviceId) return { ok: false, error: "Primero hay que dar de alta el rastreador." };
    /* Los que no se pueden preguntar por comando pero informan su configuración en cada posición. */
    if (def.deAjustes) {
        const a = (await prisma.gpsEquipo.findUnique({ where: { imei: e.imei }, select: { ajustes: true } }))?.ajustes as Record<string, number> | null;
        const valores = a ? def.deAjustes(a) : null;
        if (!valores) return { ok: true, valores: null };
        /* Lo que «dice» el equipo, armado con los nombres del formulario: «Andando, cada 40 s · Detenido, cada 600 s». */
        const dicho = (def.campos || []).map((c) => `${c.rotulo} ${valores[c.clave]}${"unidad" in c && c.unidad ? ` ${c.unidad}` : ""}`).join(" · ");
        return { ok: true, respuesta: `${dicho} (informado en su última posición)`, valores };
    }
    if (!def.pregunta) return { ok: true, valores: null };
    const r = await alEquipo(e.imei, def.pregunta);
    if (!r.ok) return { ok: false, error: r.error };
    return { ok: true, respuesta: r.respuesta, valores: def.leer ? def.leer(r.respuesta || "") : null };
}

/* ---------- La clave de los equipos TopFly ---------- */

/** Cómo es una clave de equipo: de 4 a 10 letras o números. De fábrica, 0000. */
const CLAVE_TOPFLY = /^[A-Za-z0-9]{4,10}$/;

/**
 * ¿Hay una clave propia cargada, o se usa la de fábrica? No devuelve la clave: quien la cargó la
 * sabe, y a los demás no les hace falta verla para mandar un comando (la pone el servidor).
 */
export async function claveTopflyGps(): Promise<{ propia: boolean }> {
    await sesion("ver");
    const f = await prisma.setting.findUnique({ where: { key: "GPS_TOPFLY_CLAVE" } }).catch(() => null);
    return { propia: !!f?.value && f.value !== "0000" };
}

/**
 * Carga la clave con la que los TopFly aceptan comandos (24/11). Vacía, vuelve a la de fábrica.
 *
 * Hacía falta una pantalla para esto: la clave estaba sólo como un ajuste escrito en la base, y el
 * primer comando que rechazó un equipo real dejó la duda de si era la clave —sin dónde cargarla—.
 * Es una sola para todos los TopFly de la instalación; por equipo, cuando haya dos con claves distintas.
 * No se le manda nada al equipo: esto NO le cambia la clave, sólo dice cuál usar.
 */
export async function guardarClaveTopflyGps(clave: string): Promise<{ ok: boolean; error?: string }> {
    const s = await sesion("equipo");
    const v = String(clave || "").trim();
    if (!v) {
        await prisma.setting.deleteMany({ where: { key: "GPS_TOPFLY_CLAVE" } });
        await auditar(s, "equipos.gps.clave-topfly", "GPS_TOPFLY_CLAVE", true, "Vuelve a la de fábrica");
        return { ok: true };
    }
    if (!CLAVE_TOPFLY.test(v)) return { ok: false, error: "La clave del equipo tiene de 4 a 10 letras o números, sin espacios." };
    await prisma.setting.upsert({ where: { key: "GPS_TOPFLY_CLAVE" }, create: { key: "GPS_TOPFLY_CLAVE", value: v }, update: { value: v } });
    await auditar(s, "equipos.gps.clave-topfly", "GPS_TOPFLY_CLAVE", true, "Se cargó una clave propia");
    return { ok: true };
}

export type ComandoMandado = { id: string; imei: string; clave: string; titulo: string; texto: string; ok: boolean; respuesta: string | null; quedo: string | null; quien: string; cuando: string };

/** Lo último que se le mandó a un rastreador (o a todos), del más nuevo al más viejo. */
export async function historialComandosGps(imei?: string | null, cuantos = 30): Promise<ComandoMandado[]> {
    await sesion("ver");
    const filas = await prisma.gpsComando.findMany({ where: imei ? { imei: String(imei) } : {}, orderBy: { cuando: "desc" }, take: Math.min(Math.max(1, cuantos), 200) });
    return filas.map((f) => ({ id: f.id, imei: f.imei, clave: f.clave, titulo: comandoPorClave("GT06", f.clave)?.titulo || comandoPorClave("TOPFLY", f.clave)?.titulo || f.clave, texto: f.texto, ok: f.ok, respuesta: f.respuesta, quedo: f.quedo, quien: f.quien, cuando: f.cuando.toISOString() }));
}

/**
 * ¿Hay algún rastreador? Para que el menú muestre «Gestión GPS» sólo donde hay flota: en un barrio
 * sin rastreadores sería una entrada que lleva a una pantalla vacía. No tira si el rol no puede
 * ver los rastreadores: contesta que no, que para ese rol es la verdad.
 */
export async function hayRastreadoresGps(): Promise<boolean> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s: any = await getSession().catch(() => null);
    if (!s || !puedeGps(permisosDeSesion(s), "ver")) return false;
    return (await prisma.gpsEquipo.count({ where: { OR: [{ deviceId: null }, { NOT: { deviceId: DEVICE_DE_PRUEBA } }] } })) > 0;
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
    await sesion("ver");
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
    const s = await sesion("config");
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
    const s = await sesion("config");
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
    await sesion("compartir");
    const f = await prisma.gpsCompartido.findMany({ where: { imei, revocadoAt: null, venceAt: { gt: new Date() } }, orderBy: { createdAt: "desc" } });
    return f.map(comoCompartido);
}

export async function compartirGps(imei: string, o: { horas: number; nombre?: string; conRecorrido?: boolean }): Promise<{ ok: boolean; compartido?: Compartido; error?: string }> {
    const s = await sesion("compartir");
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
    const s = await sesion("compartir");
    const c = await prisma.gpsCompartido.findUnique({ where: { id } });
    if (!c || estadoDeEnlace(c) !== "vigente") return { ok: !!c };
    await prisma.gpsCompartido.update({ where: { id }, data: { revocadoAt: new Date() } });
    await auditar(s, "equipos.gps.dejar-de-compartir", c.imei, true, `«${c.nombre}», lo había compartido ${c.creadoPor}`);
    return { ok: true };
}


/**
 * Qué días de un mes anduvo: cuántos reportes en movimiento tuvo cada día del sitio. Es lo que pinta
 * los puntos del calendario del recorrido (22/11: elegir el día sin escribir fechas, y viendo de
 * antemano en cuáles hubo algo que mirar).
 */
export async function diasConMovimientoGps(imei: string, mes: string): Promise<Record<string, number>> {
    await sesion("ver");
    if (!/^\d{4}-\d{2}$/.test(mes || "")) return {};
    const [a, m] = mes.split("-").map(Number);
    const desde = limitesDelDia(`${mes}-01`)?.inicio, hasta = limitesDelDia(`${m === 12 ? a + 1 : a}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}-01`)?.inicio;
    if (!desde || !hasta) return {};
    /* El día se corta en la zona del sitio, no en la de la base: un viaje de las 22:00 de Montevideo
       es del mismo día, aunque en UTC ya sea el siguiente. */
    const filas = await prisma.$queryRaw<{ dia: string; n: bigint }[]>`
        SELECT to_char(("cuando" AT TIME ZONE 'UTC') AT TIME ZONE ${ZONA}, 'YYYY-MM-DD') AS dia, count(*) AS n
        FROM "GpsPosicion" WHERE "imei" = ${String(imei || "")} AND "cuando" >= ${desde} AND "cuando" < ${hasta} AND "velocidad" >= 10 AND NOT "pobre"
        GROUP BY 1`;
    return Object.fromEntries(filas.map((f) => [f.dia, Number(f.n)]));
}

/* ---------- Reportes ---------- */

/** Filas por tabla en la vista previa: alcanza para ver qué trae; el archivo las trae todas. */
const PREVIA_FILAS = 60;

/**
 * Lo que va a salir en el Excel y en el PDF, para mirarlo antes de bajarlo (22/11: «reportes en
 * Excel y PDF; debe tener todo lo que tiene un soft de rastreo satelital»).
 *
 * Es la MISMA cuenta que la descarga (lib/gps-reportes-servidor), con las tablas recortadas a las
 * primeras filas: `filasTotales` dice cuántas hay de verdad. El listado de posiciones no se
 * calcula acá —son cientos de miles de renglones para mostrar sesenta—: va sólo al Excel.
 */
export async function vistaPreviaReportesGps(o: { imeis: string[] | null; desde: string; hasta: string | null; reportes: ClaveReporte[] }): Promise<{ ok: true; reporte: ReporteGps } | { ok: false; error: string }> {
    await sesion("ver");
    const desde = new Date(o.desde), hasta = o.hasta ? new Date(o.hasta) : null;
    if (Number.isNaN(desde.getTime()) || (hasta && Number.isNaN(hasta.getTime()))) return { ok: false, error: "El período no se entiende." };
    if (hasta && hasta <= desde) return { ok: false, error: "El «hasta» es anterior al «desde»." };
    const claves = CLAVES_REPORTE.filter((c) => c !== "posiciones" && (o.reportes || []).includes(c));
    if (!claves.length) return { ok: false, error: "Elegí al menos un reporte." };
    const imeis = o.imeis ? o.imeis.map((x) => String(x).replace(/\D/g, "").slice(0, 20)).filter(Boolean) : null;
    const r = await armarReporteGps({ imeis: imeis && imeis.length ? imeis : null, desde, hasta, claves });
    return { ok: true, reporte: await conDirecciones({ ...r, tablas: r.tablas.map((t) => ({ ...t, filas: t.filas.slice(0, PREVIA_FILAS) })) }) };
}

/** El horario laboral: contra él se marca el uso fuera de horario. Uno para todos los vehículos. */
export async function horarioLaboralGps(): Promise<HorarioCerca | null> {
    await sesion("ver");
    return horarioLaboral();
}

export async function guardarHorarioLaboralGps(h: HorarioCerca | null): Promise<{ ok: boolean; horario?: HorarioCerca | null; error?: string }> {
    const s = await sesion("config");
    if (h === null) {
        await prisma.setting.deleteMany({ where: { key: HORARIO_LABORAL_GPS } });
        await auditar(s, "equipos.gps.horario-laboral", "todos", true, "sin horario");
        return { ok: true, horario: null };
    }
    const limpio = leerHorario(h);
    if (!limpio) return { ok: false, error: "Elegí al menos un día, y dos horas distintas." };
    await prisma.setting.upsert({ where: { key: HORARIO_LABORAL_GPS }, update: { value: JSON.stringify(limpio) }, create: { key: HORARIO_LABORAL_GPS, value: JSON.stringify(limpio) } });
    await auditar(s, "equipos.gps.horario-laboral", "todos", true, rotuloDeHorario(limpio));
    return { ok: true, horario: limpio };
}

/* ---------- Recorridos por la calle ---------- */

export type ServicioRutas = {
    /** La función «Recorridos por la calle» está prendida. */
    funcion: boolean;
    fase: FaseRutas;
    /** En qué anda, en una frase. */
    frase: string;
    /** Anda: los recorridos salen por la calle. */
    ok: boolean;
};
/** Cómo está el servicio que pone los recorridos sobre la calle (omni-rutas), para la pantalla de Ajustes. */
export async function servicioRutasGps(): Promise<ServicioRutas> {
    await sesion("ver");
    const funcion = await funcionActiva("GPS_POR_CALLE");
    const e = await estadoOmniRutas();
    return { funcion, fase: e.fase, frase: fraseDeRutas(e), ok: funcion && e.fase === "listo" };
}
export async function levantarRutasGps(): Promise<{ ok: boolean; error?: string }> {
    const s = await sesion("config");
    if (!(await funcionActiva("GPS_POR_CALLE"))) return { ok: false, error: "Primero hay que prender «Recorridos por la calle» en Ajustes › Características." };
    const e = await prenderOmniRutas();
    olvidarServicioDeRutas();
    await auditar(s, "equipos.gps.rutas", "omni-rutas", e.fase !== "sin-docker", fraseDeRutas(e));
    return e.fase === "sin-docker" ? { ok: false, error: fraseDeRutas(e) } : { ok: true };
}

/* ---------- Direcciones ---------- */

export type ServicioDirecciones = {
    /** La función «Direcciones de los lugares» está prendida. */
    funcion: boolean;
    /** Se usa el servicio incorporado (omni-geo, en este equipo) y no uno de afuera. */
    propio: boolean;
    /** El servicio de afuera, si se cargó uno. */
    url: string | null;
    /** En qué anda el incorporado. Null si no se usa. */
    fase: FaseGeo | null;
    /** Lo mismo, en una frase. */
    frase: string | null;
    ok: boolean; ejemplo: string | null; guardadas: number;
};

/**
 * Las direcciones: si están prendidas, quién las contesta y si contesta. El servicio es omni-geo,
 * un contenedor de OmniAccess (`lib/omni-geo`); sin él todo anda igual, pero los lugares se dicen
 * con coordenadas.
 */
export async function servicioDireccionesGps(): Promise<ServicioDirecciones> {
    await sesion("ver");
    const guardadas = await prisma.geoDireccion.count().catch(() => 0);
    if (!(await funcionActiva("GPS_DIRECCIONES"))) return { funcion: false, propio: true, url: null, fase: null, frase: null, ok: false, ejemplo: null, guardadas };
    const s = await servicioDeDirecciones();
    if (!s.propio) { const p = await probarServicio(s.url!); return { funcion: true, propio: false, url: s.url, fase: null, frase: null, ...p, guardadas }; }
    const e = await estadoOmniGeo();
    const p = e.fase === "listo" ? await probarServicio(URL_GEO) : { ok: false, ejemplo: null };
    return { funcion: true, propio: true, url: null, fase: e.fase, frase: fraseDeFase(e), ...p, guardadas };
}

/** Levantar el servicio incorporado: instalarlo si falta, arrancarlo si está parado. No espera a que termine. */
export async function levantarDireccionesGps(): Promise<{ ok: boolean; error?: string }> {
    const s = await sesion("config");
    if (!(await funcionActiva("GPS_DIRECCIONES"))) return { ok: false, error: "Primero hay que prender «Direcciones de los lugares» en Ajustes › Características." };
    const e = await prenderOmniGeo();
    olvidarServicio();
    await auditar(s, "equipos.gps.direcciones", "omni-geo", e.fase !== "sin-docker", `levantar → ${e.fase}`);
    return e.fase === "sin-docker" ? { ok: false, error: fraseDeFase(e) } : { ok: true };
}

/** Usar OTRO servicio de direcciones en vez del incorporado (uno central, compartido). Vacío vuelve al de este equipo. */
export async function guardarServicioDireccionesGps(url: string): Promise<{ ok: boolean; error?: string; ejemplo?: string | null }> {
    const s = await sesion("config");
    const limpia = (url || "").trim();
    if (!limpia) {
        await prisma.setting.deleteMany({ where: { key: AJUSTE_GEO } });
        olvidarServicio();
        await auditar(s, "equipos.gps.direcciones", "servicio", true, "el incorporado");
        return { ok: true };
    }
    const u = urlValida(limpia);
    if (!u) return { ok: false, error: "Tiene que ser una dirección como http://172.26.20.186:8080" };
    /* Se prueba ANTES de guardar: una dirección mal escrita dejaría todo sin direcciones sin que nadie sepa por qué. */
    const p = await probarServicio(u);
    if (!p.ok) return { ok: false, error: "Ese servicio no contesta. No se guardó." };
    await prisma.setting.upsert({ where: { key: AJUSTE_GEO }, update: { value: u }, create: { key: AJUSTE_GEO, value: u } });
    olvidarServicio();
    await auditar(s, "equipos.gps.direcciones", "servicio", true, u);
    return { ok: true, ejemplo: p.ejemplo };
}
