/**
 * El protocolo de los rastreadores Teltonika (FMB, FMC, FMM…): Codec 8 y Codec 8 Extended sobre TCP.
 *
 * Puro, como lib-gt06: bytes adentro, objetos afuera. Sin red ni base.
 *
 * Por qué existe (21/11): el receptor hablaba un solo protocolo, GT06, el de los rastreadores
 * chinos baratos. Teltonika es lo que se instala cuando el cliente paga por el equipo, y además
 * avisa cosas que un GT06 no sabe decir: que lo desenchufaron, que lo están remolcando y —la que
 * importa en seguridad— que detecta un INHIBIDOR de señal.
 *
 * ESTADO: escrito contra la documentación pública del fabricante y probado con SUS tramas de
 * ejemplo (scripts/probar-gt06.js). No pasó por un equipo real todavía: hasta que pase, el
 * catálogo de drivers lo dice.
 *
 * Cómo habla:
 *   1. Al conectar manda su IMEI:  00 0F | 15 dígitos en ASCII.   Se contesta 01 (o 00 = rechazado).
 *   2. Después manda paquetes:     00 00 00 00 | largo(4) | codec(1) | N(1) | N registros | N(1) | CRC-16(4)
 *      Se contesta con 4 bytes: cuántos registros se aceptaron. Si no se contesta ESE número, el
 *      equipo vuelve a mandar los mismos para siempre.
 *   3. Cada registro: hora(8, ms UTC) | prioridad(1) | lon(4) lat(4) alt(2) rumbo(2) sats(1) vel(2) | E/S
 *      Latitud y longitud son enteros CON signo en diezmillonésimas de grado.
 *   4. Las E/S son pares id→valor agrupados por tamaño (1, 2, 4 y 8 bytes; en el 8E además de largo
 *      variable). En Codec 8 los ids y las cuentas ocupan 1 byte; en 8E, 2.
 */
"use strict";

const CODEC8 = 0x08, CODEC8E = 0x8e;

/** CRC-16/IBM (el «ARC»: polinomio 0xA001 reflejado, arranca en 0), como lo pide el fabricante. */
function crc16(buf) {
    let c = 0;
    for (const b of buf) { c ^= b; for (let i = 0; i < 8; i++) c = c & 1 ? (c >>> 1) ^ 0xa001 : c >>> 1; }
    return c & 0xffff;
}

/** ¿Estos primeros bytes son el saludo de un Teltonika? `null` = todavía no alcanza para saber. */
function esSaludo(buf) {
    if (buf.length < 2) return null;
    if (buf[0] !== 0x00 || buf[1] !== 0x0f) return false;
    if (buf.length < 17) return null;
    return /^\d{15}$/.test(buf.subarray(2, 17).toString("latin1"));
}
const imeiDeSaludo = (buf) => buf.subarray(2, 17).toString("latin1");

/**
 * Parte lo que llegó en paquetes enteros. Devuelve `{ paquetes, resto, roto }`: `roto` si lo que
 * hay no puede ser el comienzo de un paquete (ahí no hay cómo resincronizar: se corta).
 */
function partir(buf) {
    const paquetes = [];
    let i = 0;
    while (buf.length - i >= 12) {
        if (buf.readUInt32BE(i) !== 0) return { paquetes, resto: Buffer.alloc(0), roto: true };
        const largo = buf.readUInt32BE(i + 4);
        if (largo < 3 || largo > 16 * 1024) return { paquetes, resto: Buffer.alloc(0), roto: true };
        if (buf.length - i < 8 + largo + 4) break;                  // todavía no llegó entero
        paquetes.push(Buffer.from(buf.subarray(i, i + 8 + largo + 4)));
        i += 8 + largo + 4;
    }
    return { paquetes, resto: buf.subarray(i), roto: false };
}

/** Las E/S que se usan. El resto se devuelve igual, por su número, para poder mirarlas. */
const ES = { ENCENDIDO: 239, MOVIMIENTO: 240, SENAL: 21, VOLTAJE_MV: 66, BATERIA_MV: 67, SALIDA1: 179, ALARMA: 236, REMOLQUE: 246, CHOQUE: 247, INHIBIDOR: 249, DESENCHUFADO: 252, VELOCIDAD_EXCEDIDA: 255 };

/** Lee un paquete entero. `ok:false` con el motivo si no cierra. */
function leer(p) {
    const largo = p.readUInt32BE(4);
    const datos = p.subarray(8, 8 + largo);
    if (crc16(datos) !== p.readUInt32BE(8 + largo)) return { ok: false, error: "CRC" };
    const codec = datos[0];
    if (codec !== CODEC8 && codec !== CODEC8E) return { ok: false, error: `codec ${codec.toString(16)}`, codec };
    const ancho = codec === CODEC8E ? 2 : 1;                         // cuántos bytes ocupan ids y cuentas
    const n = datos[1];
    let o = 2;
    const num = () => { const v = ancho === 2 ? datos.readUInt16BE(o) : datos[o]; o += ancho; return v; };
    const registros = [];
    try {
        for (let k = 0; k < n; k++) {
            const fecha = new Date(Number(datos.readBigUInt64BE(o))); o += 8;
            const prioridad = datos[o]; o += 1;
            const lon = datos.readInt32BE(o) / 1e7, lat = datos.readInt32BE(o + 4) / 1e7;
            const altitud = datos.readInt16BE(o + 8), rumbo = datos.readUInt16BE(o + 10), satelites = datos[o + 12], velocidad = datos.readUInt16BE(o + 13);
            o += 15;
            const evento = num(); num();                             // qué E/S lo disparó (0 = periódico), y el total
            const es = {};
            for (const bytes of [1, 2, 4, 8]) {
                const cuantos = num();
                for (let j = 0; j < cuantos; j++) {
                    const id = num();
                    es[id] = bytes === 1 ? datos[o] : bytes === 2 ? datos.readUInt16BE(o) : bytes === 4 ? datos.readUInt32BE(o) : Number(datos.readBigUInt64BE(o));
                    o += bytes;
                }
            }
            if (codec === CODEC8E) { const cuantos = num(); for (let j = 0; j < cuantos; j++) { num(); const l = datos.readUInt16BE(o); o += 2 + l; } }
            registros.push({
                gps: {
                    fecha: Number.isNaN(fecha.getTime()) ? null : fecha,
                    lat: +lat.toFixed(6), lon: +lon.toFixed(6), altitud, rumbo, satelites, velocidad: Math.min(255, velocidad),
                    /* Sin satélites el equipo repite lo último que supo, o manda ceros: eso no es una posición. */
                    conFix: satelites >= 3 && !(lat === 0 && lon === 0),
                    enVivo: true,
                },
                prioridad, evento, es,
                ...(es[ES.ENCENDIDO] !== undefined ? { encendido: es[ES.ENCENDIDO] === 1 } : {}),
                ...(es[ES.VOLTAJE_MV] !== undefined ? { voltaje: es[ES.VOLTAJE_MV] / 1000 } : {}),
                ...(es[ES.SENAL] !== undefined ? { senal: Math.min(4, es[ES.SENAL]) } : {}),
                ...(es[ES.SALIDA1] !== undefined ? { cortado: es[ES.SALIDA1] === 1 } : {}),
            });
        }
        if (datos[o] !== n) return { ok: false, error: "las dos cuentas de registros no coinciden" };
    } catch (e) { return { ok: false, error: `paquete cortado: ${e.message}` }; }
    return { ok: true, codec, registros };
}

/**
 * Qué evento nuestro es un registro, si alguno. El equipo marca con `evento` cuál E/S disparó el
 * envío: sólo ésa cuenta, y sólo cuando PASA a 1 — un registro periódico con «desenchufado = 1»
 * adentro no es otra alarma, es el estado que sigue.
 */
function eventoDe(r) {
    const v = r.es[r.evento];
    if (r.prioridad === 2 || (r.evento === ES.ALARMA && v === 1)) return "GPS_SOS";
    if (r.evento === ES.INHIBIDOR && v === 1) return "GPS_INHIBIDOR";
    if (r.evento === ES.DESENCHUFADO && v === 1) return "GPS_CORTE";
    if (r.evento === ES.REMOLQUE && v === 1) return "GPS_MOVIMIENTO";
    if (r.evento === ES.VELOCIDAD_EXCEDIDA && v) return "GPS_VELOCIDAD";
    if (r.evento === ES.CHOQUE && v) return "GPS_CHOQUE";
    return null;
}

/** El acuse del saludo, y el de un paquete: cuántos registros se aceptaron, en 4 bytes. */
const acuseSaludo = (aceptado) => Buffer.from([aceptado ? 0x01 : 0x00]);
const acusePaquete = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };

module.exports = { crc16, esSaludo, imeiDeSaludo, partir, leer, eventoDe, acuseSaludo, acusePaquete, ES, CODEC8, CODEC8E };
