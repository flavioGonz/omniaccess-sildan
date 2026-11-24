import test from "node:test";
import assert from "node:assert/strict";
import { CORRIMIENTO_MAX_M, juntarAjustes, leerAjuste, pedidosDeAjuste, porLaCalle, PUNTOS_POR_PEDIDO, resumenDeAjuste, sinColineales, tramoCreible, type PuntoCrudo, type RespuestaOsrm } from "@/lib/gps-calle";
import { metrosEntre } from "@/lib/gps-recorrido";

/* Un recorrido INVENTADO por calles públicas de Montevideo —un punto cada 40 s, corrido unos metros
   como un GPS de verdad— y lo que contestó el servicio de rutas del lab el 24/11. No es de ningún vehículo. */
const PUNTOS: PuntoCrudo[] = [
    { lat: -34.906989, lon: -56.199127, cuando: "2026-11-24T12:00:00.000Z", velocidad: 30 }, { lat: -34.907134, lon: -56.195828, cuando: "2026-11-24T12:00:40.000Z", velocidad: 30 },
    { lat: -34.906936, lon: -56.192309, cuando: "2026-11-24T12:01:20.000Z", velocidad: 30 }, { lat: -34.904154, lon: -56.192784, cuando: "2026-11-24T12:02:00.000Z", velocidad: 30 },
    { lat: -34.901227, lon: -56.192043, cuando: "2026-11-24T12:02:40.000Z", velocidad: 30 }, { lat: -34.900104, lon: -56.188628, cuando: "2026-11-24T12:03:20.000Z", velocidad: 30 },
    { lat: -34.898603, lon: -56.186928, cuando: "2026-11-24T12:04:00.000Z", velocidad: 30 },
];
const RESPUESTA: RespuestaOsrm = JSON.parse('{"code":"Ok","tracepoints":[{"location":[-56.199084,-34.907431],"matchings_index":0,"waypoint_index":0},{"location":[-56.195821,-34.9072],"matchings_index":0,"waypoint_index":1},{"location":[-56.192399,-34.906943],"matchings_index":0,"waypoint_index":2},{"location":[-56.192707,-34.9041],"matchings_index":0,"waypoint_index":3},{"location":[-56.192049,-34.901225],"matchings_index":0,"waypoint_index":4},{"location":[-56.188636,-34.900035],"matchings_index":0,"waypoint_index":5},{"location":[-56.187407,-34.899032],"matchings_index":0,"waypoint_index":6}],"matchings":[{"confidence":0.968,"legs":[{"distance":299.2,"steps":[{"geometry":{"coordinates":[[-56.199084,-34.907431],[-56.198531,-34.907395],[-56.198005,-34.907361],[-56.196889,-34.907278],[-56.195821,-34.9072]]}},{"geometry":{"coordinates":[[-56.195821,-34.9072],[-56.195821,-34.9072]]}}]},{"distance":316.2,"steps":[{"geometry":{"coordinates":[[-56.195821,-34.9072],[-56.195773,-34.907197],[-56.194641,-34.907116],[-56.194348,-34.907095],[-56.193518,-34.907038],[-56.192397,-34.906963]]}},{"geometry":{"coordinates":[[-56.192397,-34.906963],[-56.192399,-34.906943]]}},{"geometry":{"coordinates":[[-56.192399,-34.906943],[-56.192399,-34.906943]]}}]},{"distance":316.7,"steps":[{"geometry":{"coordinates":[[-56.192399,-34.906943],[-56.192507,-34.905987],[-56.192611,-34.905011],[-56.192707,-34.9041]]}},{"geometry":{"coordinates":[[-56.192707,-34.9041],[-56.192707,-34.9041]]}}]},{"distance":333.6,"steps":[{"geometry":{"coordinates":[[-56.192707,-34.9041],[-56.192801,-34.903241],[-56.192809,-34.903162]]}},{"geometry":{"coordinates":[[-56.192809,-34.903162],[-56.192819,-34.903072],[-56.192827,-34.903001],[-56.192834,-34.902899],[-56.192834,-34.902831],[-56.192817,-34.902751],[-56.192789,-34.902684],[-56.192578,-34.902255],[-56.192545,-34.90219],[-56.192507,-34.902116],[-56.192087,-34.901299],[-56.192049,-34.901225]]}},{"geometry":{"coordinates":[[-56.192049,-34.901225],[-56.192049,-34.901225]]}}]},{"distance":386,"steps":[{"geometry":{"coordinates":[[-56.192049,-34.901225],[-56.192043,-34.901213],[-56.192011,-34.901148],[-56.19198,-34.901086],[-56.191857,-34.90081],[-56.191628,-34.900336],[-56.191592,-34.900262]]}},{"geometry":{"coordinates":[[-56.191592,-34.900262],[-56.191482,-34.900253],[-56.190916,-34.900211],[-56.190833,-34.900205],[-56.190739,-34.900198],[-56.189709,-34.900124],[-56.188636,-34.900035]]}},{"geometry":{"coordinates":[[-56.188636,-34.900035],[-56.188636,-34.900035]]}}]},{"distance":215.7,"steps":[{"geometry":{"coordinates":[[-56.188636,-34.900035],[-56.188595,-34.900032],[-56.187578,-34.899963],[-56.187465,-34.899965]]}},{"geometry":{"coordinates":[[-56.187465,-34.899965],[-56.187542,-34.899225],[-56.187527,-34.899147],[-56.187508,-34.899117],[-56.187491,-34.899089],[-56.187407,-34.899032]]}},{"geometry":{"coordinates":[[-56.187407,-34.899032],[-56.187407,-34.899032]]}}]}]}]}');

test("la pregunta: un punto por posición, con su hora, y sin que el servicio vuelva a cortar el viaje", () => {
    const [p] = pedidosDeAjuste(PUNTOS);
    assert.equal(p.desde, 0); assert.equal(p.hasta, 6);
    assert.ok(p.ruta.startsWith("/match/v1/driving/-56.199127,-34.906989;-56.195828,-34.907134;"));
    assert.match(p.ruta, /gaps=ignore/); assert.match(p.ruta, /tidy=false/); assert.match(p.ruta, /steps=true/);
    assert.equal(/timestamps=([\d;]+)/.exec(p.ruta)![1].split(";").length, 7);
    assert.deepEqual(pedidosDeAjuste(PUNTOS.slice(0, 1)), [], "con un solo punto no hay nada que preguntar");
});

test("dos posiciones en el mismo segundo no rompen la pregunta: la hora siempre crece", () => {
    const [p] = pedidosDeAjuste([PUNTOS[0], { ...PUNTOS[1], cuando: PUNTOS[0].cuando }, { ...PUNTOS[2], cuando: "2026-11-24T12:00:00.400Z" }]);
    const ts = /timestamps=([\d;]+)/.exec(p.ruta)![1].split(";").map(Number);
    assert.ok(ts[1] > ts[0] && ts[2] > ts[1]);
});

test("un viaje largo se pregunta de a cien, y cada tanda arranca donde terminó la anterior", () => {
    const largo = Array.from({ length: 250 }, (_, i) => ({ lat: -34.9 + i * 1e-4, lon: -56.19, cuando: new Date(Date.UTC(2026, 10, 24, 12, 0, i * 10)).toISOString() }));
    const ps = pedidosDeAjuste(largo);
    assert.deepEqual(ps.map((p) => [p.desde, p.hasta]), [[0, 99], [99, 198], [198, 249]]);
    assert.ok(ps.every((p) => p.hasta - p.desde < PUNTOS_POR_PEDIDO));
});

test("la respuesta real: los dos puntos que se corrieron de más quedan donde estaban; los demás van por la calle", () => {
    const a = leerAjuste(PUNTOS, RESPUESTA);
    assert.equal(a.length, 7);
    /* El servicio puso el primer punto a 49 m, en otra calle: no se le cree, ni a él ni al tramo que sale de él. */
    assert.ok(metrosEntre(PUNTOS[0], { lat: -34.907431, lon: -56.199084 }) > CORRIMIENTO_MAX_M);
    assert.equal(a[0].enCalle, null); assert.equal(a[1].via, null);
    assert.deepEqual(a[1].enCalle, [-34.9072, -56.195821]);
    for (let i = 2; i < 6; i++) { assert.ok(a[i].enCalle, `el punto ${i} quedó sobre la calle`); assert.ok(Array.isArray(a[i].via), `el tramo ${i} va por la calle`); }
    /* El tramo que dobla la esquina trae la esquina; el que va derecho por una cuadra, casi nada. */
    assert.equal(a[2].via!.length, 1, "una cuadra derecha y la vuelta de la esquina: un solo punto que dobla");
    assert.ok(a[4].via!.length >= 2 && a[4].via!.length < 13, "una curva trae los puntos que la dibujan, no los trece que mandó el servicio");
    assert.equal(a[2].metros, 316.2);
    /* El último, lo mismo que el primero: el servicio lo llevó a 65 m. */
    assert.equal(a[6].enCalle, null); assert.equal(a[6].via, null);
});

test("lo que se dibuja pasa por la esquina y no por adentro de la manzana", () => {
    const a = leerAjuste(PUNTOS, RESPUESTA), linea = porLaCalle(PUNTOS, a);
    /* Entre el punto 4 y el 5 la recta corta la manzana; el camino va hasta la esquina y dobla. */
    const esquina = { lat: -34.900262, lon: -56.191592 };
    const cerca = Math.min(...linea.map((p) => metrosEntre(p, esquina)));
    assert.ok(cerca < 3, `la línea pasa por la esquina (quedó a ${cerca.toFixed(1)} m)`);
    /* Los puntos de verdad siguen estando, en orden y con su hora; los del camino van marcados y entre medio. */
    const deVerdad = linea.filter((p) => !p.via);
    assert.deepEqual(deVerdad.map((p) => p.cuando), PUNTOS.map((p) => p.cuando));
    for (let i = 1; i < linea.length; i++) assert.ok(linea[i].cuando >= linea[i - 1].cuando, "la hora nunca vuelve atrás");
    assert.ok(linea.some((p) => p.via));
    assert.equal(linea[0].lat, PUNTOS[0].lat, "el punto que no se pudo poner sobre la calle queda donde el GPS dijo");
});

test("un tramo que no es creíble queda en recta", () => {
    assert.equal(tramoCreible(330, 300, 40), true);
    assert.equal(tramoCreible(460, 300, 40), true, "doblar una esquina alarga, y está bien");
    assert.equal(tramoCreible(1300, 300, 40), false, "dar la vuelta a la manzana para llegar a la paralela, no");
    assert.equal(tramoCreible(60, 8, 10), true, "dos puntos casi encimados: el margen fijo");
    assert.equal(tramoCreible(95, 8, 10), false);
    assert.equal(tramoCreible(2500, 2400, 20), false, "a 450 km/h no anduvo");
    assert.equal(tramoCreible(900, 800, 200), false, "más de dos minutos sin noticias: no se sabe por dónde fue");
    assert.equal(tramoCreible(NaN, 100, 10), false);
    /* Y en la lectura: el mismo recorrido, si el servicio dijera que un tramo mide cuatro veces más. */
    const mala: RespuestaOsrm = JSON.parse(JSON.stringify(RESPUESTA)); mala.matchings![0].legs![2].distance = 1400;
    const a = leerAjuste(PUNTOS, mala);
    assert.equal(a[3].via, null); assert.ok(a[3].enCalle, "el punto sigue sobre la calle; lo que no se dibuja es el camino"); assert.ok(a[4].via);
});

test("si el servicio no contesta o contesta otra cosa, todo queda como estaba", () => {
    for (const r of [null, undefined, { code: "NoMatch" }, { code: "Ok", tracepoints: [] }, { code: "Ok", tracepoints: RESPUESTA.tracepoints!.slice(0, 3), matchings: RESPUESTA.matchings }] as (RespuestaOsrm | null | undefined)[]) {
        const a = leerAjuste(PUNTOS, r);
        assert.ok(a.every((x) => x.enCalle === null && x.via === null));
        assert.deepEqual(porLaCalle(PUNTOS, a), PUNTOS);
    }
    /* Un punto sin calle cerca (el servicio lo deja en nulo): los tramos que lo tocan van en recta. */
    const hueco: RespuestaOsrm = JSON.parse(JSON.stringify(RESPUESTA)); hueco.tracepoints![3] = null;
    const a = leerAjuste(PUNTOS, hueco);
    assert.equal(a[3].enCalle, null); assert.equal(a[3].via, null); assert.equal(a[4].via, null); assert.ok(a[2].via);
});

test("las tandas se juntan sin perder el tramo donde se tocan", () => {
    const a = leerAjuste(PUNTOS, RESPUESTA);
    /* Como si el viaje se hubiera preguntado en dos tandas: 0–3 y 3–6. */
    const todos = juntarAjustes(7, [{ desde: 0, ajustes: a.slice(0, 4) }, { desde: 3, ajustes: [{ ...a[3], via: null, metros: null }, ...a.slice(4)] }]);
    assert.deepEqual(todos.map((x) => !!x.via), a.map((x) => !!x.via));
    assert.deepEqual(todos[3].enCalle, a[3].enCalle);
});

test("los puntos que no doblan se sacan; los extremos quedan", () => {
    const recta: [number, number][] = [[-34.9, -56.19], [-34.9, -56.189], [-34.9, -56.188], [-34.9, -56.187]];
    assert.deepEqual(sinColineales(recta), [recta[0], recta[3]]);
    const codo: [number, number][] = [[-34.9, -56.19], [-34.9, -56.189], [-34.899, -56.189]];
    assert.deepEqual(sinColineales(codo), codo);
    /* Una curva suave: cada punto está casi en línea con sus dos vecinos, pero la curva se aparta de la cuerda. */
    const curva: [number, number][] = Array.from({ length: 9 }, (_, k) => [-34.9 + 0.0004 * Math.sin((k / 8) * Math.PI / 2), -56.19 + 0.0005 * (1 - Math.cos((k / 8) * Math.PI / 2))] as [number, number]);
    assert.ok(sinColineales(curva).length >= 4, "de una curva quedan los puntos que la dibujan");
});

test("el resumen dice cuánto quedó por la calle", () => {
    const r = resumenDeAjuste(PUNTOS, leerAjuste(PUNTOS, RESPUESTA));
    assert.equal(r.tramos, 6); assert.equal(r.porCalle, 4); assert.equal(r.sinCalle, 2);
    assert.ok(r.metrosCalle > r.metrosRecta, "por la calle es más largo que en línea recta");
});
