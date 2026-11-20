/**
 * Los eventos de un rastreador GPS: los que el equipo avisa y los que se deducen de lo que manda.
 *
 * Puro, como lib-gt06: no toca la base ni la red. `gps-receiver.js` le pasa lo que llega y recibe
 * qué evento disparar, si alguno. Así las reglas —cuándo es «batería baja», cuándo «se movió con
 * el motor apagado»— se pueden probar sin un vehículo.
 *
 * Los dos deducidos tienen la misma forma, y es la que evita el error clásico de estas alarmas:
 * **avisan al CRUZAR el umbral, no mientras se está del otro lado.** Una batería en 11,7 V que
 * reporta cada cinco minutos no es una alarma cada cinco minutos: es una, y otra recién cuando
 * se recuperó y volvió a caer.
 */
"use strict";

/** Los códigos de alarma del protocolo GT06 → nuestro evento. Lo que no está acá es GPS_OTRA. */
const DE_ALARMA = {
    0x01: "GPS_SOS",
    0x02: "GPS_CORTE",          // le cortaron la alimentación: lo desconectaron de la batería
    0x03: "GPS_VIBRACION",
    0x06: "GPS_VELOCIDAD",
    0x09: "GPS_MOVIMIENTO",     // el propio equipo detectó desplazamiento estando en guardia
    0x0e: "GPS_BATERIA_EQUIPO", // la batería INTERNA del rastreador, no la del vehículo
    0x13: "GPS_DESARME",        // le sacaron la tapa / lo desarmaron
};
const eventoDeAlarma = (c) => (c ? DE_ALARMA[c] || "GPS_OTRA" : null);

const ROTULO = {
    GPS_SOS: "Botón de pánico (SOS)",
    GPS_CORTE: "Le cortaron la alimentación al rastreador",
    GPS_VIBRACION: "Vibración en el vehículo",
    GPS_VELOCIDAD: "Exceso de velocidad",
    GPS_MOVIMIENTO: "Se mueve con el motor apagado",
    GPS_BATERIA: "Batería del vehículo baja",
    GPS_BATERIA_EQUIPO: "Batería interna del rastreador baja",
    GPS_DESARME: "Desarmaron el rastreador",
    GPS_OTRA: "Alarma del rastreador",
};

/** Debajo de esto, la batería de 12 V de un vehículo en reposo está descargándose. */
const VOLTAJE_BAJO = 11.8;
/** Recién por encima de esto se considera recuperada: sin esta franja, 11,8 ↔ 11,7 avisaría sin parar. */
const VOLTAJE_RECUPERADO = 12.2;
/** A partir de esta velocidad, con satélites, el vehículo se está trasladando (no es ruido del GPS). */
const VEL_TRASLADO = 10;
/** Quieto este tiempo, el traslado terminó y el próximo vuelve a avisar. */
const QUIETO_MS = 5 * 60_000;

/** El estado por rastreador. `voltajeInicial` siembra lo último que se supo, para no avisar al reiniciar. */
function nuevoVigia() {
    const e = new Map(); // imei → { baja, trasladando, quietoDesde }
    const de = (imei) => { if (!e.has(imei)) e.set(imei, { baja: null, trasladando: false, quietoDesde: null }); return e.get(imei); };
    return {
        sembrar(imei, voltaje) { if (typeof voltaje === "number") de(imei).baja = voltaje < VOLTAJE_BAJO; },
        /** Un voltaje nuevo. Devuelve "GPS_BATERIA" sólo cuando CAE por debajo del umbral. */
        alVoltaje(imei, v) {
            const s = de(imei);
            if (typeof v !== "number" || !(v > 0)) return null;
            if (s.baja === null) { s.baja = v < VOLTAJE_BAJO; return null; }   // primera lectura: no se sabe de dónde venía
            if (!s.baja && v < VOLTAJE_BAJO) { s.baja = true; return "GPS_BATERIA"; }
            if (s.baja && v >= VOLTAJE_RECUPERADO) s.baja = false;
            return null;
        },
        /**
         * Una posición nueva. Devuelve "GPS_MOVIMIENTO" cuando el vehículo empieza a trasladarse
         * con el motor apagado (un remolque, o lo están empujando), una vez por traslado.
         * `encendido` tiene que ser `false` SABIDO: si el equipo todavía no dijo nada del motor,
         * no se afirma que esté apagado.
         */
        alMoverse(imei, p, ahora = Date.now()) {
            const s = de(imei);
            if (!p || !p.conFix) return null;
            if (p.velocidad >= VEL_TRASLADO) {
                s.quietoDesde = null;
                if (p.encendido === false && !s.trasladando) { s.trasladando = true; return "GPS_MOVIMIENTO"; }
                if (p.encendido === true) s.trasladando = false;   // arrancó: ya no es «con el motor apagado»
                return null;
            }
            if (s.trasladando) {
                if (s.quietoDesde === null) s.quietoDesde = ahora;
                else if (ahora - s.quietoDesde >= QUIETO_MS) { s.trasladando = false; s.quietoDesde = null; }
            }
            return null;
        },
    };
}

module.exports = { eventoDeAlarma, nuevoVigia, ROTULO, VOLTAJE_BAJO, VOLTAJE_RECUPERADO, VEL_TRASLADO };
