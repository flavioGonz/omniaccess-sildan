/** Que toda ruta de /api que cambia algo tenga su clase (openspec roles-y-permisos, «Nada sin clasificar»). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { claseDeApi, RUTAS_API } from "@/lib/permisos-api";
import { CLAVES_PERMISOS } from "@/lib/permisos";

function rutas(dir: string, base: string): { ruta: string; archivo: string }[] {
    const out: { ruta: string; archivo: string }[] = [];
    for (const e of readdirSync(dir)) {
        const p = join(dir, e);
        if (statSync(p).isDirectory()) out.push(...rutas(p, `${base}/${e.replace(/^\[\.\.\.[^\]]+\]$/, "x/y").replace(/^\[[^\]]+\]$/, "x")}`));
        else if (e === "route.ts") out.push({ ruta: base, archivo: p });
    }
    return out;
}

test("toda ruta que cambia algo tiene clase", () => {
    const sin: string[] = [];
    for (const r of rutas(join(process.cwd(), "src/app/api"), "/api")) {
        const s = readFileSync(r.archivo, "utf8");
        if (!/export\s+(async\s+)?function\s+(POST|PUT|PATCH|DELETE)\b|export\s+const\s+(POST|PUT|PATCH|DELETE)\b/.test(s)) continue;
        if (!claseDeApi(r.ruta)) sin.push(r.ruta);
    }
    assert.deepEqual(sin, [], `sin clasificar: ${sin.join(", ")}`);
});

test("las clases sólo nombran permisos que existen", () => {
    for (const [re, c] of RUTAS_API) if (typeof c !== "string") for (const k of c) assert.ok(CLAVES_PERMISOS.includes(k), `${re}: ${k}`);
});

test("lo específico gana", () => {
    assert.deepEqual(claseDeApi("/api/centrales/eventos/abc"), ["hub.tratar"]);
    assert.deepEqual(claseDeApi("/api/centrales/abc"), ["hub.config"]);
    assert.equal(claseDeApi("/api/centrales/abc/accion"), "propio");
    assert.deepEqual(claseDeApi("/api/vision/buscar"), ["vision"]);
    assert.deepEqual(claseDeApi("/api/vision/reglas"), ["vision.config"]);
    assert.equal(claseDeApi("/api/webhooks/hikvision"), "propio");
});
