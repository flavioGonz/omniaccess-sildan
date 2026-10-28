/** Usuarios de los equipos (openspec usuarios-de-equipos): el parseo de Hikvision y el inventario. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { parsearCuentasHik, parsearSesionesHik, parsearCapacidadesHik, normalizarIp } from "@/lib/usuarios-equipo/hikvision";
import { clasificar, procedencia, fusionarCuentas, fusionarSesiones, type Fuentes } from "@/lib/usuarios-equipo/inventario";
import { claseDeApi } from "@/lib/permisos-api";
import { funcionPorId } from "@/lib/funciones";
import { PERMISOS } from "@/lib/permisos";

const fx = (f: string) => fs.readFileSync(path.join(__dirname, "fixtures", "usuarios-equipo", f), "utf8");

test("hik: cámara v2.0 con una sola cuenta admin, de fábrica por ser la id 1", () => {
    const c = parsearCuentasHik(fx("camara-usuarios-v2.xml"));
    assert.deepEqual(c, [{ idEquipo: "1", nombre: "admin", nivel: "Administrador", deFabrica: true }]);
});

test("hik: NVR v1.0 con 4 cuentas; el <id> de bondIpAddress no confunde el id de la cuenta", () => {
    const c = parsearCuentasHik(fx("nvr-usuarios-v1.xml"));
    assert.equal(c.length, 4);
    assert.deepEqual(c.map((x) => [x.idEquipo, x.nombre, x.nivel, x.deFabrica]), [
        ["1", "admin", "Administrador", true],
        ["2", "operador1", "Operador", false],
        ["3", "guardia", "Visualizador", false],
        ["4", "vecino&co", "Visualizador", false],
    ]);
});

test("hik: sesiones con IP, hora de entrada y la IPv4 mapeada normalizada", () => {
    const s = parsearSesionesHik(fx("camara-sesiones-v2.xml"));
    assert.equal(s.length, 3);
    assert.deepEqual(s[2], { nombre: "admin", ip: "192.0.2.122", desde: "2026-10-27T22:01:10" });
    assert.equal(normalizarIp("::FFFF:10.0.0.1"), "10.0.0.1");
    assert.equal(normalizarIp("fe80::1"), "fe80::1");
});

test("hik: una respuesta vacía o de error no inventa cuentas", () => {
    assert.deepEqual(parsearCuentasHik("<ResponseStatus><statusCode>4</statusCode></ResponseStatus>"), []);
    assert.deepEqual(parsearSesionesHik('<OnlineUserList version="2.0"></OnlineUserList>'), []);
});

test("hik: capacidades del NVR (32 cuentas, sin claves débiles)", () => {
    assert.deepEqual(parsearCapacidadesHik(fx("nvr-capacidades.xml")), { maxCuentas: 32, claveDebil: false });
});

test("clasificar: servicio va antes que de fábrica; lo creado afuera es no gestionado", () => {
    assert.equal(clasificar({ nombre: "admin", deFabrica: true, origen: "equipo" }, "admin"), "servicio");
    assert.equal(clasificar({ nombre: "ADMIN", deFabrica: true, origen: "equipo" }, "admin"), "servicio");
    assert.equal(clasificar({ nombre: "admin", deFabrica: true, origen: "equipo" }, "omni"), "fabrica");
    assert.equal(clasificar({ nombre: "jperez", deFabrica: false, origen: "omniaccess" }, "admin"), "gestionada");
    assert.equal(clasificar({ nombre: "tecnico2", deFabrica: false, origen: "equipo" }, "admin"), "no-gestionada");
});

const F: Fuentes = {
    servidor: new Set(["198.51.100.10"]),
    grabadores: new Map([["192.0.2.122", "NVR 1"]]),
    equipos: new Map([["192.0.2.122", "NVR 1"], ["192.0.2.7", "LPR Entrada"]]),
    conocidas: new Map([["192.0.2.77", "PC de la guardia"]]),
};

test("procedencia: servidor, grabador antes que equipo, conocida y desconocida", () => {
    assert.deepEqual(procedencia("198.51.100.10", F), { procedencia: "servidor", nombre: "OmniAccess" });
    assert.deepEqual(procedencia("192.0.2.122", F), { procedencia: "grabador", nombre: "NVR 1" });
    assert.deepEqual(procedencia("192.0.2.7", F), { procedencia: "equipo", nombre: "LPR Entrada" });
    assert.deepEqual(procedencia("192.0.2.77", F), { procedencia: "conocida", nombre: "PC de la guardia" });
    assert.deepEqual(procedencia("192.0.2.200", F), { procedencia: "desconocida", nombre: null });
});

test("fusionar cuentas: primera lectura, una cuenta borrada y una que vuelve", () => {
    const leidas = parsearCuentasHik(fx("nvr-usuarios-v1.xml"));
    const primera = fusionarCuentas([], leidas);
    assert.equal(primera.altas.length, 4);
    const previas = [
        { id: "a", nombre: "admin", desaparecida: null },
        { id: "b", nombre: "operador1", desaparecida: null },
        { id: "c", nombre: "viejo", desaparecida: null },
        { id: "d", nombre: "guardia", desaparecida: new Date() },
    ];
    const p = fusionarCuentas(previas, leidas);
    assert.deepEqual(p.altas.map((x) => x.nombre), ["vecino&co"]);
    assert.deepEqual(p.desaparecidas, ["c"]);
    assert.deepEqual(p.siguen.map((x) => [x.id, x.reaparecio]), [["a", false], ["b", false], ["d", true]]);
});

test("fusionar cuentas: un equipo que no contesta no borra nada", () => {
    assert.deepEqual(fusionarCuentas([{ id: "a", nombre: "admin", desaparecida: null }], null), { altas: [], siguen: [], desaparecidas: [] });
});

test("fusionar sesiones: dos sesiones iguales se aparean de a una; la que no está se cierra", () => {
    const leidas = parsearSesionesHik(fx("camara-sesiones-v2.xml"));
    const abiertas = [
        { id: "s1", nombre: "admin", ip: "198.51.100.10", desdeEquipo: "2026-10-28T09:12:44" },
        { id: "s2", nombre: "admin", ip: "192.0.2.200", desdeEquipo: "2026-10-28T08:00:00" },
    ];
    const p = fusionarSesiones(abiertas, leidas);
    assert.deepEqual(p.siguen, ["s1"]);
    assert.deepEqual(p.cerradas, ["s2"]);
    assert.equal(p.nuevas.length, 2);
    assert.deepEqual(fusionarSesiones(abiertas, null), { nuevas: [], siguen: [], cerradas: [] });
});

test("usuarios de equipos: la función viene apagada y el permiso es delicado", () => {
    assert.equal(funcionPorId("EQUIPOS_USUARIOS")?.porDefecto, false);
    assert.equal(funcionPorId("EQUIPOS_USUARIOS")?.alcance, "instalacion");
    const p = PERMISOS.find((x) => x.clave === "dispositivos.usuarios");
    assert.ok(p && p.delicado && p.nivel === "configurar");
});

test("usuarios de equipos: la escritura pide su permiso y la tarea es propia", () => {
    assert.deepEqual(claseDeApi("/api/devices/abc/usuarios"), ["dispositivos.usuarios"]);
    assert.deepEqual(claseDeApi("/api/devices/usuarios/conocida"), ["dispositivos.usuarios"]);
    assert.equal(claseDeApi("/api/devices/usuarios/tick"), "propio");
    assert.deepEqual(claseDeApi("/api/devices/abc"), ["dispositivos.editar"]);
});

test("cifrado: la clave de equipos de un User se cifra; nada más del User se toca", async () => {
    const { middlewareCifrado, estaCifrado } = await import("@/lib/cifrado-datos");
    const mw = middlewareCifrado();
    let args: any;
    await mw({ model: "User", action: "update", args: { where: { id: "u" }, data: { claveEquipos: "Clave-de-equipos-1", name: "Ana" } } }, async (p: any) => { args = p.args; return null; });
    assert.ok(estaCifrado(args.data.claveEquipos));
    assert.equal(args.data.name, "Ana");
    await mw({ model: "Device", action: "update", args: { data: { passwordAnterior: "vieja" } } }, async (p: any) => { args = p.args; return null; });
    assert.ok(estaCifrado(args.data.passwordAnterior));
});

test("áreas: hereda de la madre, el ajuste propio manda, «Sin área» y un área borrada no se gestionan", async () => {
    const { areaGestora, ramaDe } = await import("@/lib/usuarios-equipo/areas");
    const estado = {
        areas: [
            { id: "acc", nombre: "Accesos", padre: null, orden: 0, color: "#000", cuentas: { gestionada: true, roles: ["tecnico"] } },
            { id: "norte", nombre: "Barrera norte", padre: "acc", orden: 0, color: "#000" },
            { id: "sur", nombre: "Barrera sur", padre: "acc", orden: 1, color: "#000", cuentas: { gestionada: false, roles: [] } },
            { id: "peri", nombre: "Perímetro", padre: null, orden: 1, color: "#000" },
        ],
        equipos: { cam1: "norte", cam2: "sur", cam3: "peri", cam4: "borrada" } as Record<string, string>,
    };
    const n = areaGestora(estado as any, "cam1");
    assert.equal(n.gestionada, true); assert.equal(n.heredada, true); assert.equal(n.decide?.id, "acc"); assert.deepEqual(n.roles, ["tecnico"]);
    assert.equal(areaGestora(estado as any, "cam2").gestionada, false);
    assert.equal(areaGestora(estado as any, "cam3").gestionada, false);
    assert.equal(areaGestora(estado as any, "cam4").area, null);
    assert.equal(areaGestora(estado as any, "sin-area").gestionada, false);
    assert.deepEqual([...ramaDe(estado as any, "acc")].sort(), ["acc", "norte", "sur"]);
});
