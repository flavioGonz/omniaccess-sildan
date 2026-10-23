/** El catálogo de permisos por módulo y nivel (openspec roles-y-permisos, specs/permisos-catalogo). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
    PERMISOS, CLAVES_PERMISOS, MODULOS, PLANTILLAS_ROL, TRADUCCION, SECCIONES_PERMISOS, VERSION_PERMISOS,
    normalizarPermisos, permisoDeRuta, permisosDeSesion, puedeAbrir, esPaginaLibre,
} from "@/lib/permisos";

/** Las rutas de cada permiso del catálogo del 7/10, tal cual estaban: la traducción tiene que seguir abriéndolas. */
const RUTAS_DE_ANTES: Record<string, string[]> = {
    monitor: ["/admin/monitor-lpr", "/admin/monitor-face", "/admin/monitor-queue", "/admin/alarmas", "/admin/monitor-cctv"],
    intrusion: ["/admin/monitor-intrusion"],
    historial: ["/admin/history", "/admin/lecturas-camara"],
    mapa: ["/admin/mapa", "/admin/mapas", "/admin/seguimiento", "/admin/evidencia"],
    invitados: ["/admin/invitados", "/admin/calendar"],
    guardia: ["/admin/bitacora", "/admin/consolas", "/admin/guardias", "/admin/visitas"],
    acuseek: ["/admin/acuseek"],
    monitores: ["/admin/monitores", "/monitor", "/monitor/alarmas"],
    usuarios: ["/admin/users"],
    unidades: ["/admin/units"],
    vehiculos: ["/admin/vehicles", "/admin/credentials", "/admin/rfid"],
    grupos: ["/admin/groups"],
    plazas: ["/admin/plazas"],
    dispositivos: ["/admin/devices"],
    filas: ["/admin/filas", "/admin/flujo-filas", "/admin/despachos", "/admin/horarios-filas", "/admin/kiosko", "/admin/calibracion-aforo", "/admin/reportes-queue"],
    notificaciones: ["/admin/notificaciones"],
    ajustes: ["/admin/settings", "/admin/debug", "/admin/manuales", "/admin/vision", "/admin/vision/reglas", "/admin/vision/entrenar"],
};

function paginas(dir: string, base: string): string[] {
    const out: string[] = [];
    for (const e of readdirSync(dir)) {
        const p = join(dir, e);
        if (statSync(p).isDirectory()) out.push(...paginas(p, `${base}/${e}`));
        else if (e === "page.tsx") out.push(base);
    }
    return out;
}

test("claves únicas, módulos conocidos y un permiso por nivel en cada sección", () => {
    assert.equal(new Set(CLAVES_PERMISOS).size, CLAVES_PERMISOS.length);
    for (const p of PERMISOS) assert.ok(MODULOS.some((m) => m.id === p.modulo), p.clave);
    for (const s of SECCIONES_PERMISOS) assert.ok(Object.values(s.niveles).some(Boolean), s.seccion);
    for (const p of PERMISOS) assert.equal(PERMISOS.filter((q) => q.seccion === p.seccion && q.nivel === p.nivel).length, 1, p.clave);
});

test("toda página de /admin y /monitor pide un permiso o es libre a propósito", () => {
    const raiz = join(process.cwd(), "src/app");
    const todas = [...paginas(join(raiz, "admin"), "/admin"), ...paginas(join(raiz, "monitor"), "/monitor")]
        .map((r) => r.replace(/\/\[[^\]]+\]/g, "/x"));
    const sueltas = todas.filter((r) => !permisoDeRuta(r) && !esPaginaLibre(r));
    assert.deepEqual(sueltas, [], `páginas sin permiso: ${sueltas.join(", ")}`);
});

test("las pantallas que estaban abiertas a cualquiera ahora piden su permiso", () => {
    assert.equal(permisoDeRuta("/admin/audit")?.clave, "auditoria");
    assert.equal(permisoDeRuta("/admin/dashboard-face/blacklist")?.clave, "rostros.listas");
    assert.equal(permisoDeRuta("/admin/queue")?.clave, "filas");
    assert.equal(permisoDeRuta("/admin/notificaciones-queue")?.clave, "filas.config");
    assert.equal(permisoDeRuta("/admin/dashboard-face")?.clave, "rostros");
    assert.equal(permisoDeRuta("/admin/dashboard"), null);
});

test("cada permiso de antes, traducido, sigue abriendo sus pantallas", () => {
    for (const [vieja, rutas] of Object.entries(RUTAS_DE_ANTES)) {
        const nuevos = normalizarPermisos([vieja], { deAntes: true });
        for (const r of rutas) assert.ok(puedeAbrir(nuevos, r), `${vieja} ya no abre ${r}`);
    }
    for (const k of Object.keys(TRADUCCION)) for (const t of TRADUCCION[k]) assert.ok(CLAVES_PERMISOS.includes(t), `${k} → ${t} no existe`);
});

test("Operar y Configurar arrastran Ver", () => {
    assert.deepEqual(normalizarPermisos(["hub.tratar"]), ["hub", "hub.tratar"]);
    assert.ok(normalizarPermisos(["intrusion.reglas"]).includes("intrusion"));
    assert.deepEqual(normalizarPermisos(["vigilancia"]), ["vigilancia"]);
});

test("una clave que existe en los dos catálogos vale por lo de hoy, salvo en un token de antes", () => {
    assert.deepEqual(normalizarPermisos(["intrusion"]), ["intrusion"]);
    assert.ok(normalizarPermisos(["intrusion"], { deAntes: true }).includes("intrusion.reglas"));
    // «monitor» ya no existe: se traduce siempre.
    assert.ok(normalizarPermisos(["monitor"]).includes("lpr"));
    // Token sin `pv`: se traduce; con la versión, no.
    assert.ok(permisosDeSesion({ perms: ["intrusion"] }).includes("intrusion.atender"));
    assert.deepEqual(permisosDeSesion({ perms: ["intrusion"], pv: VERSION_PERMISOS }), ["intrusion"]);
    assert.equal(permisosDeSesion({ rolAppId: "rol-administrador", perms: [] }).length, PERMISOS.length);
});

test("ninguna plantilla trae Accesos ni Mantenimiento, y todas están normalizadas", () => {
    for (const p of PLANTILLAS_ROL) {
        assert.ok(!p.permisos.includes("accesos") && !p.permisos.includes("mantenimiento"), p.id);
        assert.deepEqual(p.permisos, normalizarPermisos(p.permisos), p.id);
    }
});
