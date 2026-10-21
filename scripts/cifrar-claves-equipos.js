#!/usr/bin/env node
/**
 * Cifra (o descifra) las credenciales de los equipos ya guardadas: Device.password y Device.rtspUrl.
 * Punto 5 (21/10). Es el SEGUNDO paso: antes, todos los procesos tienen que estar corriendo con
 * lib-cifrado-datos enganchado (si no, el que no lo tenga lee la clave cifrada y no entra al equipo).
 *
 *   node scripts/cifrar-claves-equipos.js --probar      cuántos se cifrarían, sin tocar nada
 *   node scripts/cifrar-claves-equipos.js               cifra lo que esté en claro
 *   node scripts/cifrar-claves-equipos.js --descifrar   vuelta atrás: todo en claro otra vez
 *
 * Usa un cliente de Prisma SIN el enganche, para ver y escribir los valores tal cual. Nunca imprime
 * una clave.
 */
"use strict";
require("dotenv").config({ quiet: true });
const { PrismaClient } = require("@prisma/client");
const c = require("../lib-cifrado-datos");

const probar = process.argv.includes("--probar");
const descifrar = process.argv.includes("--descifrar");
const prisma = new PrismaClient();

(async () => {
    if (!process.env.OMNI_CLAVE_DATOS) { console.error("Falta OMNI_CLAVE_DATOS en el .env"); process.exit(1); }
    const equipos = await prisma.device.findMany({ select: { id: true, name: true, password: true, rtspUrl: true } });
    let n = 0, campos = 0;
    for (const d of equipos) {
        const data = {};
        for (const k of ["password", "rtspUrl"]) {
            const v = d[k];
            if (!v) continue;
            if (descifrar && c.estaCifrado(v)) data[k] = c.descifrar(v);
            if (!descifrar && !c.estaCifrado(v)) data[k] = c.cifrar(v);
        }
        if (!Object.keys(data).length) continue;
        n++; campos += Object.keys(data).length;
        if (!probar) await prisma.device.update({ where: { id: d.id }, data });
    }
    console.log(`${probar ? "Se " + (descifrar ? "descifrarían" : "cifrarían") : descifrar ? "Descifrados" : "Cifrados"}: ${campos} campos en ${n} de ${equipos.length} equipos.`);
    await prisma.$disconnect();
})().catch((e) => { console.error(e.message); process.exit(1); });
