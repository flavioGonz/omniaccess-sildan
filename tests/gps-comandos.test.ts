import test from "node:test";
import assert from "node:assert/strict";
import { armarComando, comandoPorClave, comandosDe, COMANDOS_GT06, GRUPOS_COMANDO, leerConexion, leerEstadoDelEquipo, palabraDeConfirmacion, pareceRechazo, valoresPorDefecto } from "@/lib/gps-comandos";

/* Lo que contestó el equipo de Nico (firmware W16_NP_v01) el 23/11, tal cual, consulta por consulta. */
const MEDIDO: Record<string, string> = {
    "TIMER#": "Timer:10,10;", "HBT#": "HBT:3,5;", "SENDS#": "Sends:3;", "SENSOR#": "SENSOR:10,1,20;", "DEFENSE#": "DEFENSE:10;",
    "SPEED#": "SPEED: OFF, 10, 60, 0", "MOVING#": "Moving Switch:OFF;Radius:100m;Alarm Type:0;", "SENALM#": "SENALM:ON,GPRS;",
    "POWERALM#": "PowerAlm:ON,0,5;", "BATALM#": "BATALM:ON,GPRS;", "ACCALM#": "ACCALM:OFF;", "GMT#": "Currently Timezone(GMT):W,3,0",
    "ANGLEREP#": "ANGLEREP:ON,20,2;", "SOS#": "SOS number:,,;", "CENTER#": "Center number is empty.", "LEVEL#": "LEVEL,4#",
};
const def = (clave: string) => { const d = comandoPorClave("GT06", clave); assert.ok(d, `falta ${clave}`); return d!; };
const texto = (clave: string, v?: Record<string, string | number>) => { const r = armarComando(def(clave), v); assert.ok(r.ok, r.ok ? "" : r.error); return r.ok ? r.texto : ""; };

test("cada comando tiene una clave propia, un grupo que existe y un texto que termina en un solo numeral", () => {
    const claves = new Set<string>();
    for (const c of COMANDOS_GT06) {
        assert.ok(!claves.has(c.clave), `clave repetida: ${c.clave}`); claves.add(c.clave);
        assert.ok(GRUPOS_COMANDO.some((g) => g.clave === c.grupo), `${c.clave}: grupo desconocido`);
        const r = armarComando(c, { ...valoresPorDefecto(c), destino: "gps.ejemplo.com.uy", apn: "ba.amx" });
        assert.ok(r.ok, `${c.clave}: ${r.ok ? "" : r.error}`);
        if (r.ok) { assert.match(r.texto, /^[A-Z]+[^#]*#$/); assert.ok(r.texto.length <= 80); }
    }
});

test("las consultas no llevan valores y no cambian nada: son las mismas que se le mandaron al equipo", () => {
    const consultas = COMANDOS_GT06.filter((c) => c.nivel === "consulta");
    assert.deepEqual(consultas.map((c) => c.texto({})).sort(), ["GPRSSET#", "ICCID#", "PARAM#", "RELAY#", "STATUS#", "URL#", "VERSION#", "WHERE#"]);
    for (const c of consultas) assert.ok(!c.campos?.length && !c.confirmar);
});

test("toda escritura sabe preguntar cómo quedó, salvo las que apagan o borran el equipo", () => {
    for (const c of COMANDOS_GT06.filter((x) => x.nivel !== "consulta")) {
        if (c.clave === "instalacion.reiniciar" || c.clave === "instalacion.fabrica") continue;
        assert.ok(c.pregunta, `${c.clave} no tiene con qué comprobar cómo quedó`);
    }
});

test("lo que contestó el equipo se lee en los valores del formulario", () => {
    const leido = (clave: string) => { const d = def(clave); return d.leer!(MEDIDO[d.pregunta!]); };
    assert.deepEqual(leido("reporte.intervalo"), { andando: 10, quieto: 10 });
    assert.deepEqual(leido("reporte.latido"), { andando: 3, quieto: 5 });
    assert.deepEqual(leido("reporte.despierto"), { minutos: 3 });
    assert.deepEqual(leido("reporte.giro"), { on: "ON", grados: 20, segundos: 2 });
    assert.deepEqual(leido("alarma.velocidad"), { on: "OFF", segundos: 10, kmh: 60, modo: "0" });
    assert.deepEqual(leido("alarma.movimiento"), { on: "OFF", radio: 100, modo: "0" });
    assert.deepEqual(leido("alarma.vibracion"), { on: "ON", modo: "0" });
    assert.deepEqual(leido("alarma.sensor"), { deteccion: 10, demora: 1, intervalo: 20 });
    assert.deepEqual(leido("alarma.nivel"), { nivel: 4 });
    assert.deepEqual(leido("alarma.guardia"), { minutos: 10 });
    assert.deepEqual(leido("alarma.corte"), { on: "ON", modo: "0", segundos: 5 });
    assert.deepEqual(leido("alarma.bateria"), { on: "ON", modo: "0" });
    assert.deepEqual(leido("alarma.contacto"), { on: "OFF", modo: "0" });
    assert.deepEqual(leido("telefono.sos"), { n1: "", n2: "", n3: "" });
    assert.deepEqual(leido("telefono.central"), { numero: "" });
    assert.deepEqual(leido("instalacion.huso"), { lado: "W", horas: 3, minutos: "0" });
});

test("mandar de vuelta lo que el equipo ya tiene arma el mismo valor: leer y armar no se pisan", () => {
    for (const c of COMANDOS_GT06) {
        if (!c.leer || !c.pregunta || !MEDIDO[c.pregunta]) continue;
        const v = c.leer(MEDIDO[c.pregunta]); assert.ok(v, c.clave);
        const r = armarComando(c, v!); assert.ok(r.ok, `${c.clave}: ${r.ok ? "" : r.error}`);
    }
    assert.equal(texto("reporte.intervalo", { andando: 10, quieto: 10 }), "TIMER,10,10#");
    assert.equal(texto("reporte.latido", { andando: 3, quieto: 5 }), "HBT,3,5#");
    assert.equal(texto("reporte.giro", { on: "ON", grados: 20, segundos: 2 }), "ANGLEREP,ON,20,2#");
    assert.equal(texto("alarma.corte", { on: "ON", modo: "0", segundos: 5 }), "POWERALM,ON,0,5#");
});

test("apagar una alarma manda sólo el apagado, sin arrastrar los demás valores", () => {
    assert.equal(texto("alarma.velocidad", { on: "OFF", kmh: 90, segundos: 20, modo: "1" }), "SPEED,OFF#");
    assert.equal(texto("alarma.velocidad", { on: "ON", kmh: 90, segundos: 20, modo: "1" }), "SPEED,ON,20,90,1#");
    assert.equal(texto("alarma.vibracion", { on: "OFF", modo: "0" }), "SENALM,OFF#");
    assert.equal(texto("alarma.movimiento", { on: "ON", radio: 300, modo: "0" }), "MOVING,ON,300,0#");
});

test("un número fuera de rango se rechaza diciendo el rango: no se acomoda solo", () => {
    const r = armarComando(def("reporte.intervalo"), { andando: 3, quieto: 10 });
    assert.equal(r.ok, false); if (!r.ok) assert.match(r.error, /5 a 18000 s/);
    assert.equal(armarComando(def("reporte.latido"), { andando: 0, quieto: 5 }).ok, false);
    assert.equal(armarComando(def("alarma.velocidad"), { on: "ON", kmh: 300, segundos: 10, modo: "0" }).ok, false);
});

test("un campo vaciado a mano no viaja como cero", () => {
    const r = armarComando(def("reporte.intervalo"), { andando: "", quieto: 10 });
    assert.equal(r.ok, false); if (!r.ok) assert.match(r.error, /necesita un número/);
    assert.equal(armarComando(def("reporte.intervalo"), { andando: "abc", quieto: 10 }).ok, false);
});

test("los teléfonos: sólo números, con o sin +; vacíos todos es borrarlos", () => {
    assert.equal(texto("telefono.sos", { n1: "+598 99 123 456", n2: "", n3: "" }), "SOS,A,+59899123456,,#");
    assert.equal(texto("telefono.sos", { n1: "", n2: "", n3: "" }), "SOS,D,1,2,3#");
    assert.equal(armarComando(def("telefono.sos"), { n1: "099-ABC", n2: "", n3: "" }).ok, false);
    assert.equal(texto("telefono.central", { numero: "" }), "CENTER,D#");
    assert.equal(texto("telefono.central", { numero: "099123456" }), "CENTER,A,099123456#");
});

test("no se puede colar un segundo comando adentro de un valor", () => {
    for (const malo of ["a.com,1341,0#RELAY,1", "a.com#RELAY,1#", "a b.com", "gps.ejemplo.com,", "RELAY,1#"]) {
        assert.equal(armarComando(def("instalacion.servidor"), { destino: malo, puerto: 1341 }).ok, false, malo);
    }
    for (const malo of ["ba.amx,x,y#FACTORY", "ba amx", "a#b"]) assert.equal(armarComando(def("instalacion.apn"), { apn: malo }).ok, false, malo);
    assert.equal(armarComando(def("telefono.central"), { numero: "099123456#RELAY,1" }).ok, false);
});

test("el servidor: una IP va con 0 y un nombre con 1, como lo pide el protocolo", () => {
    assert.equal(texto("instalacion.servidor", { destino: "200.40.182.246", puerto: 1341 }), "SERVER,0,200.40.182.246,1341,0#");
    assert.equal(texto("instalacion.servidor", { destino: "gps.ejemplo.com.uy", puerto: 1341 }), "SERVER,1,gps.ejemplo.com.uy,1341,0#");
    assert.equal(texto("instalacion.apn", { apn: "ba.amx" }), "APN,ba.amx#");
    assert.equal(texto("instalacion.apn", { apn: "red.ejemplo", usuario: "u", clave: "c" }), "APN,red.ejemplo,u,c#");
});

test("lo que puede dejar al equipo mudo pide escribir para confirmar; cortar el motor, un segundo toque", () => {
    for (const k of ["instalacion.servidor", "instalacion.apn", "instalacion.fabrica"]) { assert.equal(def(k).confirmar, "escribir", k); assert.equal(def(k).nivel, "instalacion"); assert.ok(def(k).cuidado, k); }
    assert.equal(def("rele.accionar").confirmar, "toque"); assert.equal(def("rele.accionar").nivel, "rele");
    assert.equal(def("rele.soltar").confirmar, undefined);          // devolver el motor nunca es lo peligroso
    assert.equal(palabraDeConfirmacion("865190075749880"), "9880");
});

test("no existen los comandos que se dejaron afuera a propósito", () => {
    const textos = COMANDOS_GT06.map((c) => { const r = armarComando(c, { ...valoresPorDefecto(c), destino: "a.ejemplo.com", apn: "x" }); return r.ok ? r.texto : ""; }).join(" ");
    for (const prohibido of ["GPRSON", "LANG", "FENCE", "DYD", "HFYD"]) assert.ok(!textos.includes(prohibido), prohibido);
});

test("un protocolo sin comandos hechos no ofrece ninguno", () => {
    assert.equal(comandosDe("TELTONIKA").length, 0);
    assert.equal(comandosDe(null).length, COMANDOS_GT06.length);       // los equipos de antes no guardaban el protocolo: son GT06
    assert.equal(comandoPorClave("GT06", "no.existe"), null);
});

test("el estado y la conexión se leen de lo que el equipo contesta", () => {
    assert.deepEqual(leerEstadoDelEquipo("Charging:12.5V;GPRS:Link Up;NW Signal Level:strong;PPP_STATE:1;GPS+BD:OFF;ACC:OFF;Defense:ON;"),
        { alimentacion: "12.5V", enlace: true, senal: "strong", gps: false, contacto: false, guardia: true });
    assert.equal(leerEstadoDelEquipo("Timer:10,10;"), null);
    assert.deepEqual(leerConexion("GPRS:ON;APN:ba.amx,,;Server:0,200.40.182.246,1341,0;URL:http://maps.google.com/maps?q=;"), { apn: "ba.amx", servidor: "200.40.182.246", puerto: 1341 });
    assert.equal(leerConexion("HBT:3,5;"), null);
});

test("un rechazo del equipo se reconoce; un éxito y un valor, no", () => {
    assert.equal(pareceRechazo("Error! Invalid command"), true);
    assert.equal(pareceRechazo("Command not supported"), true);
    assert.equal(pareceRechazo("Cut off the fuel supply: Success!"), false);
    assert.equal(pareceRechazo("Timer:10,10;"), false);
    assert.equal(pareceRechazo(""), false);
});
