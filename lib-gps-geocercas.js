/**
 * La geometría y el horario de las geocercas: qué es estar adentro, a cuánto queda el borde y
 * cuándo una geocerca está vigilando.
 *
 * Vive en un archivo suelto y sin dependencias porque lo usan los dos lados: el receptor
 * (gps-receiver.js, que es JS aparte) para decidir un cruce, y el mapa del panel para pintar quién
 * está adentro. Si cada uno tuviera su copia, el día que difieran el mapa mostraría adentro a un
 * vehículo por el que el receptor ya avisó que salió.
 *
 * Hasta el 22/11 una geocerca era un círculo que valía para todos y a toda hora. Ahora puede ser
 * de forma libre (un polígono: el predio de verdad, no el círculo que lo contiene y se come la
 * calle de al lado), valer para algunos rastreadores, avisar sólo al entrar o sólo al salir, y
 * vigilar sólo en un horario («que avise si sale del depósito de noche»).
 */

/** Metros entre dos puntos (haversine). */
function metros(aLat, aLon, bLat, bLon) {
    const R = 6371000, rad = Math.PI / 180;
    const dLat = (bLat - aLat) * rad, dLon = (bLon - aLon) * rad;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
}

/** Los vértices de una geocerca de forma libre, o null si es un círculo. Lo mal formado se descarta. */
function puntosDe(gc) {
    const p = gc && gc.puntos;
    if (!Array.isArray(p)) return null;
    const v = p.filter((x) => Array.isArray(x) && x.length >= 2 && Number.isFinite(x[0]) && Number.isFinite(x[1]) && Math.abs(x[0]) <= 90 && Math.abs(x[1]) <= 180).map((x) => [x[0], x[1]]);
    return v.length >= 3 ? v : null;
}
const esPoligono = (gc) => !!puntosDe(gc);

/** ¿El punto está adentro del polígono? Rayo hacia el este, contando cruces: par afuera, impar adentro. */
function enPoligono(v, lat, lon) {
    let dentro = false;
    for (let i = 0, j = v.length - 1; i < v.length; j = i++) {
        const [la1, lo1] = v[i], [la2, lo2] = v[j];
        if ((la1 > lat) !== (la2 > lat) && lon < ((lo2 - lo1) * (lat - la1)) / (la2 - la1) + lo1) dentro = !dentro;
    }
    return dentro;
}

/**
 * Metros de un punto a un segmento. A la escala de un predio la Tierra es plana: se lleva todo a
 * metros alrededor del punto y se resuelve con geometría de cuaderno.
 */
function metrosAlSegmento(lat, lon, a, b) {
    const k = 111320, kx = k * Math.cos((lat * Math.PI) / 180);
    const ax = (a[1] - lon) * kx, ay = (a[0] - lat) * k, bx = (b[1] - lon) * kx, by = (b[0] - lat) * k;
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / l2)) : 0;
    return Math.hypot(ax + t * dx, ay + t * dy);
}

/** ¿Ese punto está adentro de la geocerca? */
function dentroDe(gc, lat, lon) {
    const v = puntosDe(gc);
    return v ? enPoligono(v, lat, lon) : metros(gc.lat, gc.lon, lat, lon) <= gc.radio;
}

/** Metros hasta el borde: negativo adentro, positivo afuera. Es con lo que se dice «a 300 m de Taller». */
function bordeDe(gc, lat, lon) {
    const v = puntosDe(gc);
    if (!v) return metros(gc.lat, gc.lon, lat, lon) - gc.radio;
    let m = Infinity;
    for (let i = 0, j = v.length - 1; i < v.length; j = i++) m = Math.min(m, metrosAlSegmento(lat, lon, v[j], v[i]));
    return enPoligono(v, lat, lon) ? -m : m;
}

/**
 * El círculo que contiene a un polígono: su centro y su radio. Se guarda junto con los vértices
 * para todo lo que sólo necesita saber por dónde queda y qué tamaño tiene (encuadrar el mapa,
 * poner el rótulo), y para que una versión vieja del receptor que no sabe de polígonos vea un
 * círculo razonable en vez de nada.
 */
function circuloDe(puntos) {
    const v = puntosDe({ puntos });
    if (!v) return null;
    const lat = v.reduce((s, p) => s + p[0], 0) / v.length, lon = v.reduce((s, p) => s + p[1], 0) / v.length;
    return { lat, lon, radio: Math.max(30, Math.ceil(Math.max(...v.map((p) => metros(lat, lon, p[0], p[1]))))) };
}

/** ¿La geocerca vale para ese rastreador? Sin lista, vale para todos. */
const aplicaA = (gc, imei) => !gc.imeis || !gc.imeis.length || gc.imeis.includes(imei);

/** ¿Avisa ese cruce? `avisa` es "ambos" (o nada), "entra" o "sale". */
const avisaCruce = (gc, entra) => !gc.avisa || gc.avisa === "ambos" || gc.avisa === (entra ? "entra" : "sale");

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
const minutos = (t) => { const m = HHMM.exec(String(t || "")); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };

/**
 * El horario como se guarda: `{ dias: [0..6] (0 = domingo), desde: "HH:MM", hasta: "HH:MM" }`.
 * Devuelve null —«vigila siempre»— si no hay horario o no tiene forma: una geocerca con un horario
 * roto que no avisara nunca sería peor que una que avisa de más.
 */
function leerHorario(x) {
    if (!x || typeof x !== "object") return null;
    const dias = [...new Set((Array.isArray(x.dias) ? x.dias : []).map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort();
    const d = minutos(x.desde), h = minutos(x.hasta);
    if (!dias.length || d === null || h === null || d === h) return null;
    return { dias, desde: String(x.desde), hasta: String(x.hasta) };
}

/** El día de la semana (0 = domingo) y el minuto del día de una fecha, en la zona del sitio. */
function relojDe(fecha, zona) {
    const p = new Intl.DateTimeFormat("en-US", { timeZone: zona, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(fecha);
    const de = (t) => (p.find((x) => x.type === t) || {}).value;
    return { dia: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(de("weekday")), minuto: Number(de("hour")) * 60 + Number(de("minute")) };
}

/**
 * ¿La geocerca está vigilando a esa hora?
 *
 * Un horario que cruza la medianoche («de 22:00 a 06:00») pertenece al día en que EMPIEZA: el
 * martes a las 02:00 sigue siendo la guardia del lunes. Si no, «lunes a viernes de 22 a 6» dejaría
 * sin vigilar la madrugada del sábado —que es la noche del viernes— y vigilaría la del lunes, que
 * es la del domingo.
 */
function enHorario(horario, fecha, zona) {
    const h = leerHorario(horario);
    if (!h) return true;
    const { dia, minuto } = relojDe(fecha, zona || "America/Montevideo");
    const d = minutos(h.desde), hasta = minutos(h.hasta);
    if (d < hasta) return h.dias.includes(dia) && minuto >= d && minuto < hasta;
    if (minuto >= d) return h.dias.includes(dia);
    if (minuto < hasta) return h.dias.includes((dia + 6) % 7);
    return false;
}

const DIAS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
/** «lun a vie, de 22:00 a 06:00». Para decir en una línea cuándo vigila. */
function rotuloDeHorario(horario) {
    const h = leerHorario(horario);
    if (!h) return "siempre";
    // Se lee de lunes a domingo, que es como se piensa la semana acá.
    const orden = [1, 2, 3, 4, 5, 6, 0].filter((d) => h.dias.includes(d));
    const seguidos = orden.every((d, i) => i === 0 || [1, 2, 3, 4, 5, 6, 0].indexOf(d) === [1, 2, 3, 4, 5, 6, 0].indexOf(orden[i - 1]) + 1);
    const dias = orden.length === 7 ? "todos los días" : orden.length > 2 && seguidos ? `${DIAS[orden[0]]} a ${DIAS[orden[orden.length - 1]]}` : orden.map((d) => DIAS[d]).join(", ");
    return `${dias}, de ${h.desde} a ${h.hasta}`;
}

module.exports = { metros, puntosDe, esPoligono, dentroDe, bordeDe, circuloDe, aplicaA, avisaCruce, leerHorario, enHorario, rotuloDeHorario };
