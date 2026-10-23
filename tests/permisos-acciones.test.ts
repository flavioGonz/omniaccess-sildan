/** Que toda acción de servidor tenga su clase de permiso (openspec roles-y-permisos, «Nada sin clasificar»). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { claseDeAccion, ACCIONES } from "@/lib/permisos-acciones";
import { CLAVES_PERMISOS } from "@/lib/permisos";

const DIR = join(process.cwd(), "src/app/actions");
function exportadas(): string[] {
    const out: string[] = [];
    for (const f of readdirSync(DIR).filter((x) => x.endsWith(".ts"))) {
        const s = readFileSync(join(DIR, f), "utf8");
        if (!/^\s*["']use server["']/m.test(s)) continue;
        for (const m of s.matchAll(/^export\s+(?:async\s+function\s+(\w+)|const\s+(\w+)\s*=\s*async)/gm)) out.push(`src/app/actions/${f}#${m[1] || m[2]}`);
    }
    return out;
}

test("toda acción exportada tiene clase", () => {
    const sin = exportadas().filter((n) => claseDeAccion(n) === null);
    assert.deepEqual(sin, [], `sin clasificar: ${sin.join(", ")}`);
});

test("las clases sólo nombran permisos que existen", () => {
    for (const [archivo, a] of Object.entries(ACCIONES)) {
        for (const c of [a.defecto, ...Object.values(a.por || {})]) {
            if (typeof c === "string") continue;
            for (const k of c) assert.ok(CLAVES_PERMISOS.includes(k), `${archivo}: ${k} no existe`);
        }
    }
});

test("las peligrosas piden lo suyo", () => {
    assert.deepEqual(claseDeAccion("src/app/actions/settings.ts#restoreBackup"), ["mantenimiento"]);
    assert.deepEqual(claseDeAccion("src/app/actions/users.ts#deleteAllUsers"), ["mantenimiento"]);
    assert.deepEqual(claseDeAccion("src/app/actions/settings.ts#updateSetting"), ["ajustes"]);
    assert.deepEqual(claseDeAccion("src/app/actions/users.ts#saveAdmin"), ["accesos"]);
    assert.equal(claseDeAccion("src/app/actions/settings.ts#getSetting"), "secreto");
    assert.equal(claseDeAccion("src/app/actions/history.ts#getAccessEvents"), "sesion");
    assert.equal(claseDeAccion("src/app/actions/inventada.ts#x"), null);
});
