#!/usr/bin/env node
/**
 * Deja escritas las funciones de la instalación (openspec alarmas-como-funciones) la primera vez,
 * según cómo se comportaba la instalación antes de que existieran:
 *   · Intrusión: prendida (el Monitor Intrusión y la alerta ya andaban).
 *   · Recepción y Gestión de alarmas: prendidas si hay al menos una central dada de alta.
 * Si una clave ya existe no la toca: es idempotente y respeta lo que decidió un administrador.
 *   node scripts/funciones-instalacion.js
 * Lo corre scripts/desplegar.sh después de las migraciones.
 */
"use strict";
const { PrismaClient } = require("@prisma/client");

(async () => {
    const prisma = new PrismaClient();
    try {
        const centrales = await prisma.centralAlarma.count().catch(() => 0);
        const quiero = { FUNC_INTRUSION: "true", FUNC_ALARMAS_RECEPCION: centrales > 0 ? "true" : "false", FUNC_ALARMAS_GESTION: centrales > 0 ? "true" : "false" };
        const ya = await prisma.setting.findMany({ where: { key: { in: Object.keys(quiero) } }, select: { key: true, value: true } });
        let escritas = 0;
        for (const [key, value] of Object.entries(quiero)) {
            if (ya.some((s) => s.key === key)) { console.log(`funciones: ${key} ya estaba en ${ya.find((s) => s.key === key).value}, no se toca`); continue; }
            await prisma.setting.create({ data: { key, value } });
            console.log(`funciones: ${key} = ${value}${key !== "FUNC_INTRUSION" ? ` (${centrales} centrales)` : ""}`);
            escritas++;
        }
        console.log(`funciones: ${escritas ? `${escritas} escritas` : "nada que escribir"}`);
    } catch (e) {
        console.error("funciones: no se pudieron escribir:", e.message);
        process.exitCode = 1;
    } finally {
        await prisma.$disconnect();
    }
})();
