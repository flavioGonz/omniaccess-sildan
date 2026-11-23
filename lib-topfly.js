/**
 * El protocolo de los rastreadores TOPFLYtech de la familia OBD (cabecera 26 26): TorchX 100/110,
 * TLD1-D, TLD2-D y parientes. Binario sobre TCP.
 *
 * Puro, como lib-gt06 y lib-teltonika: bytes adentro, objetos afuera. Sin red ni base.
 *
 * Por qué existe (23/11): Nico configuró un TorchX 110 apuntando al mismo puerto que el GT06 y el
 * configurador le decía «IP1: Disconnected». La red estaba bien: el equipo llegaba, mandaba 35
 * bytes y el receptor lo cortaba en el acto por «no habla el protocolo». Se presentaba cada pocos
 * segundos, siempre con la misma trama —la primera prueba de este archivo es esa trama—.
 *
 * De dónde sale lo que dice acá: de las tramas reales de ese equipo, y de dos lecturas públicas del
 * protocolo —el códec que publica el fabricante (github.com/TopFlyTech/TopflytechCodec) y el
 * decodificador «t800x» de Traccar—. No se copió código de ninguno: se leyeron para saber qué hay
 * en cada byte, y lo que sólo sale de ahí y todavía no se vio en una trama real está marcado.
 *
 * Cómo habla:
 *   1. Toda trama:  26 26 | tipo(1) | largo(2, de la trama entera) | serie(2) | IMEI(8, BCD con un 0 adelante) | contenido
 *      No lleva CRC ni marca de fin: el largo es lo único que separa una trama de la siguiente.
 *   2. TODA trama lleva el IMEI, no sólo la primera. Igual empieza presentándose (tipo 01).
 *   3. Se contesta con la misma cabecera, el mismo tipo y la misma serie, largo 15 y sin contenido.
 *      SIN ESE ACUSE EL EQUIPO NO PASA DE PRESENTARSE, y lo que no se le acusa lo guarda y lo
 *      vuelve a mandar. A una alarma se le contesta además con su código (largo 16).
 *   4. La posición (tipos 02, 04, 16, 18) trae en un solo mensaje lo que un GT06 reparte en tres:
 *      dónde está, el estado (motor, señal, relé, batería) y el voltaje de la alimentación.
 *      Latitud, longitud y altura son números de coma flotante de 4 bytes, con el byte menos
 *      significativo primero; la hora es UTC, en BCD (aa mm dd hh mm ss).
 *
 * Las otras familias de la marca (25 25 vehículos con cable, 27 27 personales) comparten el sobre
 * pero no el contenido de la posición. No se leen: sin un equipo en la mano, leerlas «de oído»
 * dibuja autos en lugares donde no están. `esInicio` dice que no y el receptor las corta como antes.
 */
"use strict";

const CABECERA = 0x26;
/** Sobre: cabecera(2) + tipo(1) + largo(2) + serie(2) + IMEI(8). */
const SOBRE = 15;
/** Una trama más larga que esto no es de un rastreador (la más larga que manda, Bluetooth con varias etiquetas, no llega). */
const LARGO_MAX = 2048;

const TIPO = {
    LOGIN: 0x01, POSICION: 0x02, LATIDO: 0x03, ALARMA: 0x04,
    CONDUCCION_GPS: 0x05, CONDUCCION_ACEL: 0x06, CHOQUE: 0x07, OBD: 0x09,
    BLUETOOTH: 0x10, RED: 0x11, BLUETOOTH_2: 0x12, WIFI: 0x15,
    POSICION_SENSOR: 0x16, ALARMA_SENSOR: 0x18, LOGIN_2: 0x31,
    POSICION_LIBRE: 0x62, ALARMA_LIBRE: 0x64, RESPUESTA: 0x81,
};
const DE_POSICION = new Set([TIPO.POSICION, TIPO.ALARMA, TIPO.POSICION_SENSOR, TIPO.ALARMA_SENSOR]);
const DE_ALARMA = new Set([TIPO.ALARMA, TIPO.ALARMA_SENSOR]);

/** ¿Lo que llegó empieza como una trama de esta familia? `null` = todavía no alcanza para saber. */
function esInicio(buf) {
    if (buf.length < 2) return null;
    return buf[0] === CABECERA && buf[1] === CABECERA;
}

/**
 * Parte lo que llegó en tramas enteras. `roto` si lo que hay no puede ser el comienzo de una trama:
 * sin CRC ni marca de fin no hay cómo volver a engancharse en el medio de un flujo, así que se corta
 * y el equipo reconecta (y repite lo que no se le acusó).
 */
function partir(buf) {
    const tramas = [];
    let i = 0;
    while (buf.length - i >= 5) {
        if (buf[i] !== CABECERA || buf[i + 1] !== CABECERA) return { tramas, resto: Buffer.alloc(0), roto: true };
        const largo = buf.readUInt16BE(i + 3);
        if (largo < SOBRE || largo > LARGO_MAX) return { tramas, resto: Buffer.alloc(0), roto: true };
        if (buf.length - i < largo) break;                          // todavía no llegó entera
        tramas.push(Buffer.from(buf.subarray(i, i + largo)));
        i += largo;
    }
    /* Menos de 5 bytes: alcanza para mirar la cabecera, no el largo. */
    if (buf.length - i >= 1 && buf[i] !== CABECERA) return { tramas, resto: Buffer.alloc(0), roto: true };
    return { tramas, resto: buf.subarray(i), roto: false };
}

/** Un número escrito en BCD: cada medio byte es un dígito. `null` si algún medio byte no es un dígito. */
function bcd(buf, desde, bytes) {
    const txt = buf.subarray(desde, desde + bytes).toString("hex");
    return /^\d+$/.test(txt) ? txt : null;
}

/** La hora del equipo: UTC, en BCD. `null` si no es una fecha. */
function fechaDe(buf, o) {
    const t = bcd(buf, o, 6);
    if (!t) return null;
    const [aa, mm, dd, hh, mi, ss] = t.match(/../g).map(Number);
    if (mm < 1 || mm > 12 || dd < 1 || dd > 31 || hh > 23 || mi > 59 || ss > 59) return null;
    const f = new Date(Date.UTC(2000 + aa, mm - 1, dd, hh, mi, ss));
    return Number.isNaN(f.getTime()) ? null : f;
}

/**
 * La señal, de la escala del módem (0 a 31, el «CSQ») a las cinco rayas que usa el resto del
 * receptor (0 a 4, como la manda un GT06). 99 es «no sabe».
 */
function rayas(csq) {
    if (csq === 99 || csq > 31) return undefined;
    return csq === 0 ? 0 : csq < 10 ? 1 : csq < 15 ? 2 : csq < 20 ? 3 : 4;
}

/**
 * Qué evento nuestro es cada código de alarma del equipo. Los que no están acá se anotan como
 * «alarma del rastreador» con su número, para poder agregarlos cuando se vea qué son.
 * Sale de la tabla de Traccar para esta familia; NINGUNO se vio todavía en una trama real.
 */
const EVENTO_DE_ALARMA = {
    1: "GPS_CORTE",            // se quedó sin alimentación externa
    2: "GPS_BATERIA_EQUIPO",
    3: "GPS_SOS",
    4: "GPS_VELOCIDAD",
    7: "GPS_MOVIMIENTO",       // remolque: se mueve con el motor apagado
    8: "GPS_VIBRACION",
    10: "GPS_VIBRACION",
    21: "GPS_INHIBIDOR",
    24: "GPS_BATERIA",         // alimentación externa baja
};
/** Códigos que no son una alarma para nosotros: las geocercas del equipo (usamos las nuestras) y «volvió la alimentación». */
const ALARMA_QUE_NO_SE_AVISA = new Set([5, 6, 23]);
function eventoDeAlarma(codigo) {
    if (!codigo || ALARMA_QUE_NO_SE_AVISA.has(codigo)) return null;
    return EVENTO_DE_ALARMA[codigo] || "GPS_OTRA";
}

/** La presentación: qué modelo y qué versión dice ser. Sólo informa; no cambia cómo se lo trata. */
function leerLogin(t) {
    const c = t.subarray(SOBRE);
    /* La forma larga (35 bytes, la del TorchX): modelo(2) y después las versiones, un dígito por medio byte. */
    if (t.length >= 35) {
        const v = c.subarray(2, 10).toString("hex");
        return { modelo: c.readUInt16BE(0), programa: `${v[10]}.${v[11]}.${v[12]}.${v[13]}`, placa: `${v[14]}.${v[15]}`, plataforma: v.slice(4, 10) };
    }
    return {};
}

/**
 * La posición, con todo lo que trae pegado. Los desplazamientos son dentro del contenido (después
 * del sobre). Devuelve la misma forma de `gps` que los otros dos protocolos.
 */
function leerPosicion(t) {
    const c = t.subarray(SOBRE);
    if (c.length < 51) return { error: `posición corta (${c.length} bytes de contenido)` };
    const estado = c[9];
    const historia = (estado & 0x80) !== 0;
    const satelites = estado & 0x1f;
    let valida = (estado & 0x40) !== 0;
    const es = c.readUInt16BE(16);
    const alarma = c[18];
    const fecha = fechaDe(c, 25);
    /* Sin posición, en el lugar de la latitud y la longitud vienen las antenas de celular que ve
       (para ubicarlo «más o menos»). No se leen como coordenadas: se quedan sin leer. */
    let lat = 0, lon = 0, altitud = 0, rumbo = 0;
    if (valida) {
        altitud = c.readFloatLE(31); lon = c.readFloatLE(35); lat = c.readFloatLE(39); rumbo = c.readUInt16BE(45);
        if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180 || (lat === 0 && lon === 0)) valida = false;
    }
    /* La velocidad viene aparte del bloque del GPS, en BCD con un decimal: «0123» son 12,3 km/h.
       Con una F adentro es «no sabe». */
    const vel = bcd(c, 49, 2);
    const velocidad = vel ? Math.min(255, Math.round(Number(vel) / 10)) : 0;
    const volt = bcd(c, 47, 2);
    const carga = bcd(c, 24, 1);
    const senal = rayas(c.readUInt16BE(7) & 0x7f);
    return {
        gps: {
            fecha, lat: +lat.toFixed(6), lon: +lon.toFixed(6), altitud: Math.round(altitud), rumbo: valida ? rumbo % 360 : 0,
            satelites, velocidad: valida ? velocidad : 0,
            conFix: valida,
            /* Lo que el equipo guardó sin cobertura y manda después llega marcado: no es «ahora». */
            enVivo: !historia,
        },
        encendido: (es & 0x4000) !== 0,
        /* El relé de corte de motor, accionado. */
        cortado: (es & 0x0400) !== 0,
        ...(senal !== undefined ? { senal } : {}),
        /* La alimentación externa (la batería del vehículo), en volts. 0 es «no la mide». */
        ...(volt && Number(volt) > 0 ? { voltaje: Number(volt) / 100 } : {}),
        /* La batería interna, en porcentaje. El equipo manda 00 cuando está llena. */
        ...(carga ? { cargaInterna: Number(carga) === 0 ? 100 : Number(carga) } : {}),
        /* El cuentakilómetros que lleva el equipo, en metros. */
        odometro: c.readUInt32BE(20),
        alarma,
    };
}

/** Los datos de la SIM y de la red (tipo 11): cada campo va precedido de su largo. */
function leerRed(t) {
    const c = t.subarray(SOBRE);
    try {
        let o = 6;                                                  // la hora, que acá no interesa
        const campo = (codif) => { const l = c[o]; const v = c.subarray(o + 1, o + 1 + l).toString(codif); o += 1 + l; return v.replace(/\0+$/, ""); };
        const operadora = campo("utf16le"), tecnologia = campo("latin1"), banda = campo("latin1");
        campo("latin1");                                            // IMSI: identifica a la línea; no se guarda
        const iccid = campo("latin1");
        return { operadora, tecnologia, banda, ...(/^[0-9A-Fa-f]{18,22}$/.test(iccid) ? { iccid } : {}) };
    } catch { return {}; }
}

/**
 * Lee una trama entera. Siempre devuelve `tipoCrudo` y `serie` e `imei`, que es lo que hace falta
 * para acusarla aunque no se entienda lo de adentro.
 */
function leer(t) {
    if (t.length < SOBRE || t[0] !== CABECERA || t[1] !== CABECERA) return { ok: false, error: "no es una trama" };
    const tipoCrudo = t[2], serie = t.readUInt16BE(5);
    const crudoImei = t.subarray(7, 15).toString("hex");
    /* Quince dígitos con un 0 adelante. Otra cosa no es un IMEI: no se sigue. */
    if (!/^0\d{15}$/.test(crudoImei)) return { ok: false, error: "IMEI mal formado", tipoCrudo, serie };
    const m = { ok: true, tipoCrudo, serie, imei: crudoImei.slice(1) };
    if (tipoCrudo === TIPO.LOGIN) return { ...m, tipo: "login", ...leerLogin(t) };
    if (tipoCrudo === TIPO.LATIDO) return { ...m, tipo: "latido" };
    if (DE_POSICION.has(tipoCrudo)) {
        const p = leerPosicion(t);
        if (p.error) return { ...m, tipo: "desconocido", error: p.error };
        return { ...m, tipo: DE_ALARMA.has(tipoCrudo) ? "alarma" : "posicion", ...p };
    }
    if (tipoCrudo === TIPO.RED) return { ...m, tipo: "red", ...leerRed(t) };
    if (tipoCrudo === TIPO.RESPUESTA) {
        /* Lo que contesta a un comando: un byte de qué clase de mensaje es y el texto en UTF-16. */
        const texto = t.subarray(SOBRE + 1).toString("utf16le").replace(/\0+$/, "");
        return { ...m, tipo: "respuesta", texto };
    }
    /* Conducción brusca, datos del motor por OBD, etiquetas Bluetooth, WiFi, y la posición «libre»
       (62/64): se sabe qué son y todavía no se leen. Se acusan igual, para que el equipo no las
       guarde y las repita. */
    return { ...m, tipo: "desconocido" };
}

/**
 * El acuse de una trama: su mismo tipo y su misma serie, sin contenido. A una alarma se le
 * devuelve además su código: es como el equipo sabe CUÁL alarma quedó recibida.
 */
function acuse(m) {
    const conCodigo = m.tipo === "alarma";
    const b = Buffer.alloc(conCodigo ? 16 : 15);
    b[0] = CABECERA; b[1] = CABECERA; b[2] = m.tipoCrudo;
    b.writeUInt16BE(b.length, 3); b.writeUInt16BE(m.serie, 5);
    Buffer.from("0" + m.imei, "hex").copy(b, 7);
    if (conCodigo) b[15] = m.alarma & 0xff;
    return b;
}

/** Lo que el equipo contesta a un comando no se acusa: es él el que está contestando. */
const pideAcuse = (m) => m.tipo !== "respuesta";

module.exports = { esInicio, partir, leer, acuse, pideAcuse, eventoDeAlarma, rayas, TIPO, SOBRE };
