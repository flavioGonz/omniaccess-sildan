/**
 * Protocolo GT06 (Concox / Jimi y sus muchos clones): el que hablan los rastreadores GPS.
 *
 * Por qué existe este archivo y no un «webhook»: un GPS no hace un POST y se va. Abre una
 * conexión TCP, la deja abierta y manda tramas binarias; y si el servidor no le CONTESTA el
 * login, lo reintenta en loop y se declara sin enlace. Medido el 20/11 contra el equipo de Nico
 * (IMEI 865190075749880): mandó `78 78 0d 01 …` cada 30 segundos durante horas, sin pasar nunca
 * de ahí, y por SMS contestaba «GPRS: Link Down». No estaba roto: estaba esperando el acuse.
 *
 * La trama:
 *
 *   78 78 | largo(1) | protocolo(1) | datos(N) | serie(2) | CRC(2) | 0d 0a
 *   79 79 | largo(2) | …lo mismo, para las tramas largas…
 *
 * `largo` cuenta desde el protocolo hasta el CRC inclusive. El CRC es CRC-ITU (X.25) sobre todo
 * lo que va desde el largo hasta la serie. Verificado contra cuatro tramas reales del equipo.
 *
 * Este archivo es PURO: no abre sockets ni toca la base. Eso es `gps-receiver.js`. Así se puede
 * probar con tramas capturadas (scripts/probar-gt06.js) sin tener un GPS a mano.
 */
"use strict";

/** CRC-ITU (CRC-16/X.25): polinomio 0x1021 reflejado, arranca en 0xFFFF y se invierte al final. */
function crcItu(b) {
    let c = 0xffff;
    for (const x of b) {
        c ^= x;
        for (let i = 0; i < 8; i++) c = (c & 1) ? (c >>> 1) ^ 0x8408 : c >>> 1;
    }
    return (~c) & 0xffff;
}

/** Los protocolos que se entienden. Lo que no está acá se anota en crudo y se acusa igual. */
const PROTO = {
    LOGIN: 0x01,
    POSICION: 0x12,       // GPS + celda
    ESTADO: 0x13,         // latido: batería, señal, encendido
    ALARMA: 0x16,
    POSICION_N: 0x22,     // GT06N: lo mismo con encendido y modo de envío
    ESTADO_N: 0x23,
    ALARMA_N: 0x26,
    HORA: 0x8a,           // el equipo pide la hora
    INFO: 0x94,           // trama larga: voltaje del vehículo, datos de la SIM
    POSICION_4G: 0xa0,
};

/**
 * Parte lo que llegó por el socket en tramas enteras. TCP no respeta los bordes: pueden venir dos
 * tramas pegadas o una por la mitad, y tratar cada `data` como una trama es el error clásico.
 * Devuelve las tramas completas y lo que sobró para juntar con lo próximo que llegue.
 */
function partir(buf) {
    const tramas = [];
    let i = 0;
    while (i + 5 <= buf.length) {
        const corta = buf[i] === 0x78 && buf[i + 1] === 0x78;
        const larga = buf[i] === 0x79 && buf[i + 1] === 0x79;
        if (!corta && !larga) { i++; continue; }            // basura (un escáner de internet): se saltea
        const cab = corta ? 3 : 4;
        if (i + cab > buf.length) break;
        const largo = corta ? buf[i + 2] : buf.readUInt16BE(i + 2);
        const total = cab + largo + 2;                        // + 0d 0a
        if (largo < 5 || largo > 2048) { i++; continue; }
        if (i + total > buf.length) break;                    // todavía no llegó entera
        const t = buf.subarray(i, i + total);
        if (t[total - 2] !== 0x0d || t[total - 1] !== 0x0a) { i++; continue; }
        tramas.push(Buffer.from(t));
        i += total;
    }
    return { tramas, resto: buf.subarray(i) };
}

/** El IMEI viene en BCD: 8 bytes = 16 dígitos, el primero es un cero de relleno. */
function imeiDe(b) { return b.toString("hex").replace(/^0/, ""); }

/**
 * La fecha del equipo. Viene como seis bytes (AA MM DD hh mm ss) y es UTC salvo que al equipo le
 * hayan configurado otro huso: por eso el receptor guarda también la hora en que LLEGÓ la trama,
 * y si las dos difieren en horas enteras, es el huso y no un atraso.
 */
function fechaDe(b, o) {
    const d = new Date(Date.UTC(2000 + b[o], b[o + 1] - 1, b[o + 2], b[o + 3], b[o + 4], b[o + 5]));
    return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * El bloque de GPS, que es igual en 0x12, 0x22, 0x16, 0x26 y 0xA0:
 *   fecha(6) | satélites(1) | lat(4) | lon(4) | velocidad(1) | rumbo y banderas(2)
 * Latitud y longitud vienen en 1/30000 de minuto. El signo NO viene en el número: viene en dos
 * banderas. Olvidarlo deja a un auto de Montevideo en el desierto de Libia.
 */
function gpsDe(b, o) {
    const lat = b.readUInt32BE(o + 7) / 30000 / 60;
    const lon = b.readUInt32BE(o + 11) / 30000 / 60;
    const bn = b.readUInt16BE(o + 16);
    const norte = !!(bn & 0x0400), oeste = !!(bn & 0x0800);
    return {
        fecha: fechaDe(b, o),
        satelites: b[o + 6] & 0x0f,
        lat: +(norte ? lat : -lat).toFixed(6),
        lon: +(oeste ? -lon : lon).toFixed(6),
        velocidad: b[o + 15],                 // km/h
        rumbo: bn & 0x03ff,                   // grados
        /** El equipo dice si esta posición es de un satélite ahora o la última que supo. */
        conFix: !!(bn & 0x1000),
        enVivo: !(bn & 0x2000),
    };
}

/**
 * Lee una trama entera. Devuelve siempre algo: `ok:false` con el motivo si el CRC no cierra, y si
 * el protocolo no se conoce, la trama en crudo — para que lo desconocido se vea y no se pierda.
 */
function leer(t) {
    const larga = t[0] === 0x79;
    const cab = larga ? 4 : 3;
    const cuerpo = t.subarray(2, t.length - 4);
    const crc = t.readUInt16BE(t.length - 4);
    if (crcItu(cuerpo) !== crc) return { ok: false, error: "CRC" };
    const proto = t[cab];
    const serie = t.readUInt16BE(t.length - 6);
    const d = t.subarray(cab + 1, t.length - 6);          // los datos, sin protocolo ni serie
    const m = { ok: true, proto, serie, larga };

    switch (proto) {
        case PROTO.LOGIN:
            m.tipo = "login"; m.imei = imeiDe(d.subarray(0, 8));
            break;
        case PROTO.POSICION: case PROTO.POSICION_N: case PROTO.POSICION_4G:
            if (d.length < 18) return { ...m, tipo: "desconocido" };
            m.tipo = "posicion"; m.gps = gpsDe(d, 0);
            /* El GT06N agrega, después de la celda (8 bytes), si el motor está encendido. */
            if (proto === PROTO.POSICION_N && d.length >= 27) m.encendido = d[26] === 1;
            break;
        case PROTO.ESTADO: case PROTO.ESTADO_N: {
            const info = d[0];
            m.tipo = "estado";
            m.estado = {
                encendido: !!(info & 0x02),            // ACC
                cargando: !!(info & 0x04),
                conFix: !!(info & 0x40),
                cortado: !!(info & 0x80),              // corte de combustible/energía activo
                /** 0 = sin batería … 6 = llena. */
                bateria: d[1],
                /** 0 = sin señal … 4 = fuerte. */
                senal: d[2],
            };
            break;
        }
        case PROTO.ALARMA: case PROTO.ALARMA_N:
            m.tipo = "alarma";
            if (d.length >= 18) m.gps = gpsDe(d, 0);
            /* El código de la alarma está en el anteúltimo byte de los datos (antes del idioma). */
            m.alarma = d[d.length - 2];
            break;
        case PROTO.HORA:
            m.tipo = "hora";
            break;
        case PROTO.INFO: {
            /* «Transmisión de información»: un subtipo y sus datos. Los dos que manda el equipo
               de Nico al conectarse, leídos de sus tramas reales del 20/11:
                 00 → el voltaje de la alimentación, en centésimas de volt (0x0492 = 11,70 V, el
                      mismo «Charging:11.7V» que contesta por SMS). Es la batería DEL VEHÍCULO.
                 0a → IMEI, IMSI e ICCID de la SIM, en BCD. */
            m.tipo = "info";
            const sub = d[0];
            if (sub === 0x00 && d.length >= 3) m.voltaje = d.readUInt16BE(1) / 100;
            else if (sub === 0x0a && d.length >= 27) m.iccid = d.subarray(17, 27).toString("hex").replace(/f+$/i, "");
            break;
        }
        default:
            m.tipo = "desconocido";
    }
    return m;
}

/** Qué quiere decir cada código de alarma. Lo que no está, se muestra por su número. */
const ALARMAS = {
    0x01: "SOS", 0x02: "Corte de alimentación", 0x03: "Vibración", 0x04: "Entró a la geocerca",
    0x05: "Salió de la geocerca", 0x06: "Exceso de velocidad", 0x09: "Movimiento", 0x0e: "Batería baja",
    0x11: "Apagado", 0x13: "Lo desarmaron", 0x14: "Puerta",
};
const nombreAlarma = (c) => ALARMAS[c] || `Alarma ${c}`;

/**
 * El acuse. Sin esto el equipo no pasa del login: reintenta cada 30 segundos y se declara sin
 * enlace. Es la misma trama mínima para todo lo que pide respuesta: protocolo y serie devueltos.
 */
function acuse(proto, serie) {
    const cuerpo = Buffer.from([0x05, proto, (serie >> 8) & 0xff, serie & 0xff]);
    const c = crcItu(cuerpo);
    return Buffer.concat([Buffer.from([0x78, 0x78]), cuerpo, Buffer.from([(c >> 8) & 0xff, c & 0xff, 0x0d, 0x0a])]);
}

/** La respuesta al pedido de hora: seis bytes en UTC. */
function acuseHora(serie, ahora = new Date()) {
    const f = [ahora.getUTCFullYear() - 2000, ahora.getUTCMonth() + 1, ahora.getUTCDate(), ahora.getUTCHours(), ahora.getUTCMinutes(), ahora.getUTCSeconds()];
    const cuerpo = Buffer.from([0x0b, PROTO.HORA, ...f, (serie >> 8) & 0xff, serie & 0xff]);
    const c = crcItu(cuerpo);
    return Buffer.concat([Buffer.from([0x78, 0x78]), cuerpo, Buffer.from([(c >> 8) & 0xff, c & 0xff, 0x0d, 0x0a])]);
}

/** ¿A esta trama hay que contestarle? La posición sola no lo pide; el resto sí. */
const pideAcuse = (m) => m.ok && (m.tipo === "login" || m.tipo === "estado" || m.tipo === "alarma");

module.exports = { crcItu, partir, leer, acuse, acuseHora, pideAcuse, nombreAlarma, PROTO };
