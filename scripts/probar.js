#!/usr/bin/env node
/**
 * Las pruebas de las librerías críticas, sin dependencias nuevas (punto 4, 21/10):
 *   node scripts/probar.js
 * Corre tests/*.test.ts con el corredor de Node (node:test). Los .ts se traducen al vuelo con el
 * TypeScript que ya está en node_modules, y «@/…» apunta a src/ como en la app. También corre las
 * pruebas del protocolo SIA DC-09 (scripts/probar-dc09.js). Sale con 1 si alguna falla.
 */
"use strict";
const path = require("path");
const fs = require("fs");
const Module = require("module");
const ts = require("typescript");
const RAIZ = path.join(__dirname, "..");

const resolver = Module._resolveFilename;
Module._resolveFilename = function (pedido, padre, ...resto) {
    if (pedido.startsWith("@/")) pedido = path.join(RAIZ, "src", pedido.slice(2));
    return resolver.call(this, pedido, padre, ...resto);
};
for (const ext of [".ts", ".tsx"]) {
    require.extensions[ext] = (m, archivo) => {
        const fuente = fs.readFileSync(archivo, "utf8");
        const { outputText } = ts.transpileModule(fuente, { fileName: archivo, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } });
        m._compile(outputText, archivo);
    };
}
Module._extensions = require.extensions;

// Los archivos se cargan en este mismo proceso (así valen el require de .ts y el alias): node:test
// corre lo que registran y, al salir, deja el código de salida en 1 si algo falló.
process.env.OMNI_CLAVE_DATOS ||= "clave-de-prueba";
// El protocolo de centrales tiene sus propias pruebas en JS; se corren primero.
const dc = require("child_process").spawnSync(process.execPath, [path.join(__dirname, "probar-dc09.js")], { stdio: "inherit" });
if (dc.status) process.exitCode = 1;
// Y las de la salida a CMS de un receptor (IPC10 de Paradox, Sur-Gard).
const cms = require("child_process").spawnSync(process.execPath, [path.join(__dirname, "probar-cms.js")], { stdio: "inherit" });
if (cms.status) process.exitCode = 1;
const archivos = fs.readdirSync(path.join(RAIZ, "tests")).filter((f) => f.endsWith(".test.ts")).sort();
for (const f of archivos) require(path.join(RAIZ, "tests", f));
