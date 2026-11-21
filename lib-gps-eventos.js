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
    0x0a: "GPS_SIN_SATELITES",  // entró a una zona sin GPS (un techo, un subsuelo)
    0x0b: "GPS_CON_SATELITES",  // salió de la zona sin GPS
    0x0e: "GPS_BATERIA_EQUIPO", // la batería INTERNA del rastreador, no la del vehículo
    0x13: "GPS_DESARME",        // le sacaron la tapa / lo desarmaron
};
const eventoDeAlarma = (c) => (c ? DE_ALARMA[c] || "GPS_OTRA" : null);

/**
 * Lo que el equipo manda por el canal de alarmas y NO es una alarma. Se anota —sirve para entender
 * después por qué una noche no hubo posiciones— pero no se le pasa al motor de reglas: una regla
 * de «cualquier evento de GPS» no puede despertar a alguien porque el auto entró a un garage.
 * Medido el 21/11: el equipo mandó cinco de éstas en una noche, estacionado bajo techo.
 */
const SOLO_SE_ANOTA = new Set(["GPS_SIN_SATELITES", "GPS_CON_SATELITES"]);

/**
 * Con menos satélites que esto la posición se guarda, pero no mueve el punto del mapa ni puede
 * disparar una geocerca o un «se mueve con el motor apagado». Es el mismo número, y por la misma
 * medición, que SATS_MIN en src/lib/gps-recorrido.ts: si se cambia uno, se cambia el otro.
 */
const SATS_MIN = Number(process.env.GPS_SATS_MIN || 8);

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
    GPS_GEOCERCA_ENTRA: "Entró a una geocerca",
    GPS_GEOCERCA_SALE: "Salió de una geocerca",
    GPS_SIN_SATELITES: "Entró a una zona sin satélites",
    GPS_CON_SATELITES: "Volvió a tener satélites",
    GPS_SIN_REPORTE: "Dejó de reportar",
    GPS_VOLVIO: "Volvió a reportar",
    GPS_SALTO: "Posición imposible (otro equipo o un error del GPS)",
};

/**
 * Cuáles de estos son una ALARMA para la consola del operador (Gestión de alarmas), y con qué
 * prioridad: 1 es lo más urgente, igual que en las centrales (lib/centrales/prioridades).
 *
 * Lo que no figura acá queda en el historial del rastreador y sale por las reglas de notificación
 * si alguien armó una, pero no abre un caso: la vibración llegó 62 veces en un día con el auto
 * estacionado (medido el 21/11), y una geocerca que se cruza todos los días al volver a la base
 * no es algo que un operador tenga que «tratar». Una consola que suena por todo deja de mirarse.
 */
const PRIORIDAD = {
    GPS_SOS: 1,
    GPS_CORTE: 1,
    GPS_DESARME: 1,
    GPS_MOVIMIENTO: 2,
    GPS_SALTO: 3,
    GPS_BATERIA: 4,
    GPS_VELOCIDAD: 4,
    GPS_OTRA: 4,
};
/** «Dejó de reportar» pesa distinto según cómo se calló: andando es grave, estacionado es una falla. */
const prioridadDe = (tipo, extra) => (tipo === "GPS_SIN_REPORTE" ? (extra && extra.andando ? 2 : 3) : PRIORIDAD[tipo] || null);


/** Debajo de esto, la batería de 12 V de un vehículo en reposo está descargándose. */
const VOLTAJE_BAJO = 11.8;
/** Recién por encima de esto se considera recuperada: sin esta franja, 11,8 ↔ 11,7 avisaría sin parar. */
const VOLTAJE_RECUPERADO = 12.2;
/** A partir de esta velocidad, con satélites, el vehículo se está trasladando (no es ruido del GPS). */
const VEL_TRASLADO = 10;
/** Quieto este tiempo, el traslado terminó y el próximo vuelve a avisar. */
const QUIETO_MS = 5 * 60_000;

/** Metros entre dos puntos (haversine). */
function metros(aLat, aLon, bLat, bLon) {
    const R = 6371000, rad = Math.PI / 180;
    const dLat = (bLat - aLat) * rad, dLon = (bLon - aLon) * rad;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
}

/** ¿Ese punto está adentro de la geocerca? Hoy son círculos: un centro y un radio en metros. */
const dentroDe = (gc, lat, lon) => metros(gc.lat, gc.lon, lat, lon) <= gc.radio;

/** ¿La geocerca vale para ese rastreador? Sin lista, vale para todos. */
const aplicaA = (gc, imei) => !gc.imeis || !gc.imeis.length || gc.imeis.includes(imei);

/**
 * El «equipo» de los rastreadores de mentira de la prueba de carga (scripts/carga-gps.js). Tienen
 * que estar aceptados para que el receptor haga con ellos todo el trabajo (guardar el historial,
 * empujar a las pantallas, mirar geocercas), pero no son de nadie: no se listan, no abren casos y
 * no se los declara mudos cuando la prueba termina.
 */
const DEVICE_DE_PRUEBA = "carga-prueba";

/**
 * EL SILENCIO. Un rastreador que deja de reportar no manda ninguna trama que lo diga: hay que
 * darse cuenta de que falta. Es la alarma más importante del seguimiento —lo desconectaron, lo
 * taparon con un inhibidor, entró a un contenedor— y es la única que el equipo no puede avisar.
 *
 * Los tiempos salen de medir al equipo de Nico (20 y 21/11, 2.472 tramas):
 *  · Estacionado manda un latido cada 5 minutos, y en día y medio NUNCA pasó de 301 segundos
 *    entre una trama y la siguiente (salvo los 588 s del día que se cayó el servidor). Quince
 *    minutos son tres latidos perdidos.
 *  · Andando reporta cada 10 segundos (p98: 20 s). De 715 posiciones en movimiento, sólo 2
 *    llegaron con más de cinco minutos de hueco, y una fue la caída del servidor.
 */
const SILENCIO_ANDANDO_MS = Number(process.env.GPS_SILENCIO_ANDANDO_MIN || 5) * 60_000;
const SILENCIO_QUIETO_MS = Number(process.env.GPS_SILENCIO_QUIETO_MIN || 15) * 60_000;
/** La última posición es «de recién» respecto del último contacto: venía reportando posiciones, no sólo latidos. */
const POSICION_FRESCA_MS = 2 * 60_000;

/**
 * ¿Venía andando cuando se supo de él por última vez? Hace falta que la última posición sea
 * del mismo momento que el último contacto: un equipo bajo techo sigue mandando latidos durante
 * horas con una posición vieja que dice «40 km/h», y eso no es estar andando.
 */
function veniaAndando(e) {
    if (!e || !e.ultimoLatido || !e.cuando) return false;
    const fresca = Math.abs(new Date(e.ultimoLatido).getTime() - new Date(e.cuando).getTime()) <= POSICION_FRESCA_MS;
    return fresca && (e.velocidad || 0) >= VEL_TRASLADO;
}

/**
 * ¿Hay que avisar que se calló? `arranque` es cuándo arrancó el receptor: el silencio se cuenta
 * desde lo MÁS RECIENTE entre el último contacto y el arranque, porque si el receptor estuvo
 * caído media hora los que no se escucharon fuimos nosotros, y al volver no puede declarar mudos
 * a todos los equipos a la vez.
 */
function seCallo(e, arranque, ahora = Date.now()) {
    if (!e || !e.ultimoLatido || e.sinReporteDesde) return false;      // nunca habló, o ya se avisó
    const desde = Math.max(new Date(e.ultimoLatido).getTime(), arranque || 0);
    return ahora - desde >= (veniaAndando(e) ? SILENCIO_ANDANDO_MS : SILENCIO_QUIETO_MS);
}

/**
 * UNA POSICIÓN ATRASADA. Sin señal de celular el equipo guarda las posiciones y las manda juntas
 * cuando vuelve: medido, 82 de 1.369 (6 %) llegaron con más de dos minutos de demora, y hasta con
 * catorce. La hora que vale es la que dice el equipo (la toma de los satélites), no la de llegada:
 * un cruce de geocerca de hace diez minutos no puede avisarse como si fuera de ahora.
 */
const ATRASO_MIN_S = 120;
/** Segundos de demora entre lo que dice el equipo y la llegada; 0 si llegó a tiempo (o no se sabe). */
function atrasoDe(cuandoEquipo, llego = Date.now()) {
    if (!cuandoEquipo) return 0;
    const s = Math.round((llego - new Date(cuandoEquipo).getTime()) / 1000);
    return s >= ATRASO_MIN_S ? s : 0;
}
/** Una hora del equipo que no puede ser: del futuro, o de hace más de un mes. Se guarda nada. */
function horaCreible(cuandoEquipo, llego = Date.now()) {
    const d = llego - new Date(cuandoEquipo).getTime();
    return Number.isFinite(d) && d > -5 * 60_000 && d < 31 * 86_400_000;
}

/**
 * UN SALTO IMPOSIBLE. Dos posiciones buenas seguidas que exigirían ir a más de 250 km/h: o el GPS
 * se equivocó feo, u otro aparato se está presentando con el mismo IMEI (el protocolo no tiene
 * clave: quien conoce un IMEI puede mandar posiciones a su nombre). En los dos casos el punto
 * del mapa no se mueve. Sólo se juzga con menos de diez minutos entre una y otra: después de un
 * hueco largo no se sabe qué pasó en el medio, y un avión existe.
 */
const SALTO_KMH = 250, SALTO_MIN_M = 2000, SALTO_VENTANA_MS = 10 * 60_000;
function esSaltoImposible(ant, p) {
    if (!ant || !p) return false;
    const dt = new Date(p.cuando).getTime() - new Date(ant.cuando).getTime();
    if (!(dt > 0) || dt > SALTO_VENTANA_MS) return false;
    const m = metros(ant.lat, ant.lon, p.lat, p.lon);
    return m >= SALTO_MIN_M && (m / 1000) / (dt / 3_600_000) > SALTO_KMH;
}

/**
 * DÓNDE FUE, en palabras. Sin un servicio de direcciones (mandarle a un tercero cada coordenada de
 * cada vehículo es justamente lo que no se hace), el lugar se dice con lo que ya se sabe: las
 * geocercas, que tienen el nombre que les puso quien las dibujó. «en Base», «a 300 m de Taller».
 * Más lejos que LUGAR_CERCA_M de todas, no se dice nada: «a 14 km de Base» no ubica a nadie.
 */
const LUGAR_CERCA_M = 1500;
function lugarDe(lat, lon, geocercas) {
    if (lat == null || lon == null || !geocercas || !geocercas.length) return null;
    let mejor = null;
    for (const gc of geocercas) {
        const borde = metros(gc.lat, gc.lon, lat, lon) - gc.radio;      // negativo = adentro
        if (!mejor || borde < mejor.borde) mejor = { borde, nombre: gc.nombre };
    }
    if (!mejor || mejor.borde > LUGAR_CERCA_M) return null;
    if (mejor.borde <= 0) return `en ${mejor.nombre}`;
    const m = mejor.borde < 100 ? Math.max(10, Math.round(mejor.borde / 10) * 10) : Math.round(mejor.borde / 50) * 50;
    return `a ${m >= 1000 ? `${(m / 1000).toFixed(1).replace(".", ",")} km` : `${m} m`} de ${mejor.nombre}`;
}

/**
 * Cuántas posiciones seguidas del otro lado hacen falta para creer que cruzó. Con una sola, un
 * vehículo estacionado JUSTO en el borde entra y sale con cada salto del GPS (medido: quince
 * metros de ruido estando quieto) y manda un aviso por cada uno.
 */
const CONFIRMACIONES = 2;

/** El estado por rastreador. `voltajeInicial` siembra lo último que se supo, para no avisar al reiniciar. */
function nuevoVigia() {
    const e = new Map(); // imei → { baja, trasladando, quietoDesde }
    const de = (imei) => { if (!e.has(imei)) e.set(imei, { baja: null, trasladando: false, quietoDesde: null }); return e.get(imei); };
    const cercas = new Map(); // `${imei}|${geocercaId}` → { dentro, cuenta }
    return {
        /**
         * Una posición nueva contra las geocercas. Devuelve los cruces: `[{ tipo, geocerca }]`.
         * La primera vez que se ve a un rastreador contra una geocerca no es un cruce: se anota
         * de qué lado está y nada más — si no, dar de alta una geocerca alrededor de la base
         * avisaría «entró» por cada vehículo que ya estaba adentro.
         */
        alUbicarse(imei, geocercas, p) {
            const cruces = [];
            if (!p || !p.conFix) return cruces;
            for (const gc of geocercas || []) {
                if (gc.activa === false || !aplicaA(gc, imei)) continue;
                const clave = `${imei}|${gc.id}`;
                const ahora = dentroDe(gc, p.lat, p.lon);
                const c = cercas.get(clave);
                if (!c) { cercas.set(clave, { dentro: ahora, cuenta: 0 }); continue; }
                if (ahora === c.dentro) { c.cuenta = 0; continue; }
                if (++c.cuenta < CONFIRMACIONES) continue;
                c.dentro = ahora; c.cuenta = 0;
                cruces.push({ tipo: ahora ? "GPS_GEOCERCA_ENTRA" : "GPS_GEOCERCA_SALE", geocerca: gc });
            }
            return cruces;
        },
        /**
         * De qué lado de cada geocerca está: `{ <geocercaId>: true|false }`. El receptor lo guarda
         * en la base cada vez que cambia y lo vuelve a sembrar al arrancar. Sin esto, reiniciar el
         * receptor (cada despliegue) era olvidar dónde estaba cada vehículo: el primer reporte
         * después del reinicio «no era un cruce», y una salida que pasó en ese rato se perdía.
         */
        lados(imei) {
            const o = {};
            for (const [k, c] of cercas) if (k.startsWith(`${imei}|`)) o[k.slice(imei.length + 1)] = c.dentro;
            return o;
        },
        sembrarLados(imei, o) {
            if (!o || typeof o !== "object") return;
            for (const [id, dentro] of Object.entries(o)) {
                const clave = `${imei}|${id}`;
                if (typeof dentro === "boolean" && !cercas.has(clave)) cercas.set(clave, { dentro, cuenta: 0 });
            }
        },
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

module.exports = {
    eventoDeAlarma, nuevoVigia, dentroDe, metros, SOLO_SE_ANOTA, SATS_MIN, ROTULO, VOLTAJE_BAJO, VOLTAJE_RECUPERADO, VEL_TRASLADO,
    PRIORIDAD, prioridadDe, seCallo, veniaAndando, SILENCIO_ANDANDO_MS, SILENCIO_QUIETO_MS,
    atrasoDe, horaCreible, ATRASO_MIN_S, esSaltoImposible, lugarDe, DEVICE_DE_PRUEBA,
};
