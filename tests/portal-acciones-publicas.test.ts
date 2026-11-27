/**
 * El portal del residente no tiene sesión del panel: cada acción que exporta valida su token y
 * tiene que estar en la lista de las que corren sin sesión (lib/acciones-publicas). El 27/11 se
 * sumaron editar y quitar registros y el middleware las rechazaba con 403: la hoja quedaba
 * abierta sin decir nada. Esto lo atrapa antes de subir.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { esAnonima } from "@/lib/acciones-publicas";

test("toda acción del portal del residente corre sin sesión", () => {
    const f = "src/app/actions/portal-residente.ts";
    const s = readFileSync(join(process.cwd(), f), "utf8");
    const nombres = [...s.matchAll(/^export\s+async\s+function\s+(\w+)/gm)].map((m) => `${f}#${m[1]}`);
    assert.ok(nombres.length > 5);
    const faltan = nombres.filter((n) => !esAnonima(n));
    assert.deepEqual(faltan, [], `faltan en acciones-publicas: ${faltan.join(", ")}`);
});
