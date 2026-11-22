/** Los reportes de rastreo (lib/gps-reportes): visitas a geocercas, horas de motor y las tablas. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { nuevoInforme, periodosDeMotor, visitasDe, type ContextoRep, type PuntoRep, type VehiculoRep } from "@/lib/gps-reportes";
import { duracionDeReporte, leerClaves, REPORTES_POR_DEFECTO, textoDeCelda, type Celda, type TablaReporte } from "@/lib/gps-reportes-catalogo";

/* Todo en hora de Montevideo (UTC−3): las 11:00Z son las 08:00 del sitio. */
const T0 = Date.parse("2026-11-23T11:00:00.000Z");   // lunes 23, 08:00
const iso = (seg: number) => new Date(T0 + seg * 1000).toISOString();
const BASE = { lat: -34.9, lon: -56.1 }, GRADO_M = 111_320;
/** Un punto a `metros` al norte de la base. */
const p = (seg: number, metros: number, velocidad: number, extra: Partial<PuntoRep> = {}): PuntoRep => ({ lat: BASE.lat + metros / GRADO_M, lon: BASE.lon, cuando: iso(seg), velocidad, sat: 11, rumbo: 0, ...extra });
const CERCA = { id: "g1", nombre: "Base", lat: BASE.lat, lon: BASE.lon, radio: 200, imeis: [] as string[] };
const ctx = (o: Partial<ContextoRep> = {}): ContextoRep => ({ desde: iso(-3600), hasta: iso(12 * 3600), hastaAhora: false, limite: 90, cercas: [CERCA], horario: null, zona: "America/Montevideo", ...o });

/**
 * Un día de trabajo: quieto en la base, sale a las 08:10, anda 20 minutos a 72 km/h (con un rato a
 * 108), queda dos horas a 24 km, y vuelve.
 */
function jornada(enc: boolean | null = null): PuntoRep[] {
    const pts: PuntoRep[] = [];
    for (let s = 0; s < 600; s += 60) pts.push(p(s, 0, 0, { enc: enc === null ? null : false }));
    for (let s = 600, m = 0; s <= 1800; s += 10, m += 200) pts.push(p(s, m, s >= 1200 && s < 1260 ? 108 : 72, { enc }));          // ida: 24 km
    for (let s = 1860; s < 9000; s += 60) pts.push(p(s, 24_000, 0, { enc: enc === null ? null : s < 2400 }));                       // en la obra; el motor queda 10 min más
    for (let s = 9000, m = 24_000; s <= 10_200; s += 10, m -= 200) pts.push(p(s, m, 72, { enc }));                                  // vuelta
    for (let s = 10_260; s < 11_000; s += 60) pts.push(p(s, 0, 0, { enc: enc === null ? null : false }));
    return pts;
}
const auto = (o: Partial<VehiculoRep> = {}): VehiculoRep => ({ imei: "1", nombre: "Camioneta 1", matricula: "SBA1234", puntos: jornada(), eventos: [], ...o });
const tabla = (ts: TablaReporte[], clave: string) => ts.find((t) => t.clave === clave)!;
const col = (t: TablaReporte, rotulo: string) => { const i = t.columnas.findIndex((c) => c.rotulo === rotulo); assert.ok(i >= 0, `no hay columna «${rotulo}»`); return (f: Celda[]) => f[i]; };

test("una visita a una geocerca va del primer reporte adentro al primero afuera", () => {
    const pts = [p(0, 500, 30), p(10, 300, 30), p(20, 150, 20), p(30, 50, 5), p(600, 40, 0), p(610, 120, 20), p(620, 400, 40), p(630, 700, 40)];
    const v = visitasDe(CERCA, pts, iso(700));
    assert.equal(v.length, 1);
    assert.equal(v[0].desde, iso(20));
    assert.equal(v[0].hasta, iso(620));
    assert.equal(v[0].minutos, 10);
});

test("un salto del GPS al otro lado del borde no es una visita ni una salida", () => {
    const quieto = [p(0, 190, 0), p(10, 190, 0), p(20, 215, 0), p(30, 190, 0), p(40, 190, 0), p(50, 212, 0), p(60, 190, 0)];
    const v = visitasDe(CERCA, quieto, iso(60));
    assert.equal(v.length, 1, "un auto en el borde es UNA estadía, no tres");
    assert.equal(v[0].desde, null, "ya estaba adentro en el primer reporte");
    assert.equal(v[0].hasta, null, "y sigue adentro");
    const afuera = [p(0, 230, 0), p(10, 195, 0), p(20, 230, 0), p(30, 230, 0)];
    assert.deepEqual(visitasDe(CERCA, afuera, iso(30)), []);
});

test("si sigue adentro, la visita se cuenta hasta el final del período", () => {
    const v = visitasDe(CERCA, [p(0, 500, 30), p(10, 100, 10), p(20, 50, 0)], iso(3610));
    assert.deepEqual(v, [{ desde: iso(10), hasta: null, minutos: 60 }]);
});

test("las horas de motor salen del contacto, y un equipo que no lo informa no tiene ninguna", () => {
    const sin = periodosDeMotor(jornada(null), { hasta: iso(12 * 3600), hastaAhora: false });
    assert.deepEqual(sin, { informa: false, periodos: [] });
    const con = periodosDeMotor(jornada(true), { hasta: iso(12 * 3600), hastaAhora: false });
    assert.equal(con.informa, true);
    assert.equal(con.periodos.length, 2);
    assert.equal(con.periodos[0].desde, iso(600));
    assert.equal(con.periodos[0].hasta, iso(2400), "se apagó nueve minutos después de llegar");
    assert.equal(con.periodos[0].minutos, 30);
    assert.equal(con.periodos[1].minutos, 21);
});

test("sin noticias del contacto no se supone que el motor siguió encendido", () => {
    const pts = [{ cuando: iso(0), enc: true }, { cuando: iso(60), enc: true }, { cuando: iso(3600), enc: true }, { cuando: iso(3660), enc: true }];
    const m = periodosDeMotor(pts, { hasta: iso(3670), hastaAhora: true });
    assert.equal(m.periodos.length, 2, "una hora muda corta el período en dos");
    assert.equal(m.periodos[0].minutos, 1);
    assert.equal(m.periodos[1].sigue, true, "el último llega hasta ahora: sigue encendido");
});

test("el resumen cuenta lo mismo que los viajes, y el vehículo que no salió estuvo estacionado", () => {
    const inf = nuevoInforme(ctx(), REPORTES_POR_DEFECTO);
    inf.sumar(auto({ puntos: jornada(true), eventos: [{ tipo: "GPS_SOS", cuando: iso(700), detalle: null, lugar: null, prioridad: 1, tarde: null, lat: BASE.lat, lon: BASE.lon }] }));
    inf.sumar(auto({ imei: "2", nombre: "Camioneta 2", matricula: null, puntos: [p(0, 0, 0), p(600, 0, 0), p(1200, 0, 0)] }));
    const ts = inf.tablas(), r = tabla(ts, "resumen"), v = tabla(ts, "viajes");
    assert.equal(r.filas.length, 2);
    const viajes = col(r, "Viajes"), km = col(r, "Recorrió"), est = col(r, "Estacionado"), ral = col(r, "Ralentí"), exc = col(r, "Excesos"), al = col(r, "Alarmas");
    assert.equal(viajes(r.filas[0]), 2);
    assert.equal(v.filas.length, 2);
    assert.ok(Math.abs((km(r.filas[0]) as number) - 48) < 0.5, "24 km de ida y 24 de vuelta");
    assert.equal(exc(r.filas[0]), 1);
    assert.equal(al(r.filas[0]), 1);
    assert.equal(ral(r.filas[0]), 11, "diez minutos encendido después de llegar a la obra y uno al volver");
    assert.equal(viajes(r.filas[1]), 0);
    assert.equal(est(r.filas[1]), 12 * 60, "desde su primer reporte hasta el fin del período");
    assert.equal(ral(r.filas[1]), null, "ese equipo no informa el contacto: no es cero, es que no se sabe");
    assert.equal(r.total![3], 2);
    const t = inf.totales();
    assert.equal(t.vehiculos, 2); assert.equal(t.viajes, 2); assert.equal(t.excesos, 1); assert.equal(t.alarmas, 1); assert.equal(t.fuera, null);
});

test("cada viaje dice de dónde salió y a dónde llegó, con el nombre de la geocerca si lo hay", () => {
    const inf = nuevoInforme(ctx(), ["viajes", "paradas", "excesos", "geocercas"]);
    inf.sumar(auto());
    const ts = inf.tablas(), v = tabla(ts, "viajes"), salio = col(v, "Salió de"), llego = col(v, "Llegó a"), dia = col(v, "Día"), salida = col(v, "Salida");
    assert.deepEqual(ts.map((x) => x.clave), ["viajes", "paradas", "excesos", "geocercas"], "sólo las pedidas, en el orden del catálogo");
    assert.equal((salio(v.filas[0]) as { lugar: string }).lugar, "en Base");
    assert.equal((llego(v.filas[0]) as { lugar: string | null }).lugar, null, "a 24 km no hay nombre: van las coordenadas");
    assert.match(String(dia(v.filas[0])), /23\/11\/2026/);
    assert.equal(salida(v.filas[0]), "08:10:00", "en la hora del sitio, no en UTC");
    const par = tabla(ts, "paradas");
    assert.equal(par.filas.length, 3, "antes de salir, en la obra y al volver");
    assert.equal(col(par, "Duró")(par.filas[1]), 120);
    const exc = tabla(ts, "excesos");
    assert.equal(exc.filas.length, 1);
    assert.equal(col(exc, "Llegó a")(exc.filas[0]), 108);
    assert.equal(col(exc, "Sobre el límite")(exc.filas[0]), 18);
    const geo = tabla(ts, "geocercas");
    assert.deepEqual(geo.filas.map((f) => [f[3], f[4]]), [["ya estaba", "08:10:20"], ["10:49:50", "sigue adentro"]]);
});

test("fuera de horario: sin horario cargado lo dice; con horario, lista los viajes que quedaron afuera", () => {
    const sin = nuevoInforme(ctx(), ["fuera"]); sin.sumar(auto());
    const a = tabla(sin.tablas(), "fuera");
    assert.equal(a.filas.length, 0);
    assert.match(a.nota || "", /horario laboral/);
    /* De 9 a 18: el viaje de las 08:10 queda afuera; el de las 10:30, adentro. */
    const con = nuevoInforme(ctx({ horario: { dias: [1, 2, 3, 4, 5], desde: "09:00", hasta: "18:00" } }), ["fuera", "viajes"]); con.sumar(auto());
    const ts = con.tablas(), b = tabla(ts, "fuera");
    assert.equal(b.filas.length, 1);
    assert.equal(col(b, "Salida")(b.filas[0]), "08:10:00");
    assert.deepEqual(tabla(ts, "viajes").filas.map(col(tabla(ts, "viajes"), "Horario")), ["Fuera de horario", "En horario"]);
    assert.equal(con.totales().fuera, 1);
});

test("el motor: una tabla que avisa cuando ningún equipo informa el contacto", () => {
    const sin = nuevoInforme(ctx(), ["motor"]); sin.sumar(auto());
    assert.match(tabla(sin.tablas(), "motor").nota || "", /ACC/);
    const con = nuevoInforme(ctx(), ["motor"]); con.sumar(auto({ puntos: jornada(true) }));
    const m = tabla(con.tablas(), "motor");
    assert.equal(m.filas.length, 2);
    assert.equal(col(m, "En marcha")(m.filas[0]), 30);
    assert.equal(col(m, "De eso, en ralentí")(m.filas[0]), 10);
    assert.ok(Math.abs((col(m, "Recorrió")(m.filas[0]) as number) - 24) < 0.3);
});

test("las celdas se leen con su unidad, y lo vacío es una raya", () => {
    assert.equal(textoDeCelda("km", 16.74), "16,7 km");
    assert.equal(textoDeCelda("kmh", 113), "113 km/h");
    assert.equal(textoDeCelda("dur", 65), "1 h 05 min");
    assert.equal(textoDeCelda("dur", 0), "menos de 1 min");
    assert.equal(textoDeCelda("seg", 40), "40 s");
    assert.equal(textoDeCelda("seg", 185), "3 min 05 s");
    assert.equal(textoDeCelda("metros", 178), "178 m");
    assert.equal(textoDeCelda("metros", 1840), "1,8 km");
    assert.equal(textoDeCelda("entero", null), "—");
    assert.equal(textoDeCelda("lugar", { lugar: "en Base", lat: -34.9, lon: -56.1 }), "en Base");
    assert.equal(textoDeCelda("lugar", { lugar: null, lat: -34.9, lon: -56.1 }), "-34.90000, -56.10000");
    assert.equal(duracionDeReporte(540), "9 h 00 min");
});

test("los reportes pedidos se leen de un texto, y sin nada sale todo menos el listado crudo", () => {
    assert.deepEqual(leerClaves("viajes,resumen,no-existe"), ["resumen", "viajes"]);
    assert.deepEqual(leerClaves(""), REPORTES_POR_DEFECTO);
    assert.ok(!REPORTES_POR_DEFECTO.includes("posiciones"));
});

test("el listado de posiciones trae todas, también las de mala señal", () => {
    const inf = nuevoInforme(ctx(), ["posiciones"]);
    inf.sumar(auto({ puntos: [p(0, 0, 0, { sat: 4, enc: true }), p(10, 0, 0)] }));
    const t = tabla(inf.tablas(), "posiciones");
    assert.equal(t.filas.length, 2);
    assert.equal(col(t, "Satélites")(t.filas[0]), 4);
    assert.equal(col(t, "Contacto")(t.filas[0]), "encendido");
    assert.equal(col(t, "Contacto")(t.filas[1]), null);
});
