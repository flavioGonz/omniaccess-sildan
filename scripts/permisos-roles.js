#!/usr/bin/env node
/**
 * Lleva los roles guardados al catálogo de permisos por módulo y nivel (openspec roles-y-permisos).
 *
 *  · La primera vez (sin PERMISOS_VERSION = 2 en Setting) traduce las claves del catálogo del 7/10
 *    a las nuevas que habilitan lo mismo (TRADUCCION en src/lib/permisos.ts): nadie pierde nada.
 *  · Después sólo normaliza: saca claves que ya no existen y suma Ver donde haya Operar o
 *    Configurar. No vuelve a traducir: si no, lo que un administrador le saca a un rol volvería.
 *  · El rol Administrador queda con el catálogo entero.
 * Idempotente: la segunda corrida dice «nada que cambiar». Lo corre scripts/desplegar.sh.
 *   node scripts/permisos-roles.js
 */
"use strict";
const fs = require("fs");
const path = require("path");
const ts = require("typescript");
const { PrismaClient } = require("@prisma/client");

/** src/lib/permisos.ts no importa nada: se traduce y se carga como módulo, así hay una sola tabla. */
function cargarPermisos() {
    const archivo = path.join(__dirname, "..", "src", "lib", "permisos.ts");
    const { outputText } = ts.transpileModule(fs.readFileSync(archivo, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
    const m = { exports: {} };
    new Function("module", "exports", "require", outputText)(m, m.exports, require);
    return m.exports;
}
const AJUSTE_VERSION = "PERMISOS_VERSION";

(async () => {
    const prisma = new PrismaClient();
    try {
        const P = cargarPermisos();
        const version = (await prisma.setting.findUnique({ where: { key: AJUSTE_VERSION } }).catch(() => null))?.value;
        const deAntes = version !== String(P.VERSION_PERMISOS);
        const roles = await prisma.appRole.findMany({ select: { id: true, nombre: true, permisos: true } });
        let cambiados = 0;
        for (const r of roles) {
            const nuevos = r.id === P.ROL_ADMINISTRADOR_ID ? P.CLAVES_PERMISOS : P.normalizarPermisos(r.permisos, { deAntes });
            const antes = new Set(r.permisos), despues = new Set(nuevos);
            const mas = nuevos.filter((k) => !antes.has(k)), menos = r.permisos.filter((k) => !despues.has(k));
            if (!mas.length && !menos.length) { console.log(`permisos: ${r.nombre}: sin cambios (${nuevos.length})`); continue; }
            await prisma.appRole.update({ where: { id: r.id }, data: { permisos: nuevos } });
            console.log(`permisos: ${r.nombre}: ${r.permisos.length} → ${nuevos.length}${mas.length ? ` · + ${mas.join(", ")}` : ""}${menos.length ? ` · − ${menos.join(", ")}` : ""}`);
            cambiados++;
        }
        if (deAntes) await prisma.setting.upsert({ where: { key: AJUSTE_VERSION }, update: { value: String(P.VERSION_PERMISOS) }, create: { key: AJUSTE_VERSION, value: String(P.VERSION_PERMISOS) } });
        console.log(`permisos: ${deAntes ? "traducidos del catálogo anterior; " : ""}${cambiados ? `${cambiados} roles cambiados` : "nada que cambiar"}`);
    } catch (e) {
        console.error("permisos: no se pudieron revisar los roles:", e.message);
        process.exitCode = 1;
    } finally { await prisma.$disconnect(); }
})();
