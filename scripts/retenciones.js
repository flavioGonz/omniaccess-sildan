#!/usr/bin/env node
/**
 * Las retenciones de los buckets de capturas de eventos (23/10, Nico: «cuidá muy bien las
 * retenciones, para que no se nos llene el disco»). Idempotente: lo corre desplegar.sh y se
 * puede correr a mano. Dice qué hizo y qué encontró.
 *
 *  · alarmas: el bucket propio de las fotos de las centrales; la regla sale de Ajustes → Centrales
 *    de alarma → Fotos y retención (lib-retencion-alarmas). Se crea si falta.
 *  · intrusion: sólo capturas de detecciones. Si NO tiene regla se le pone INTRUSION_DIAS; si
 *    alguien le puso una a mano, no se toca.
 *  · los demás (lpr, face, objetos…) no se tocan: guardan además cosas que no vencen (fotos de
 *    personas y de equipos, mapas, entrenamiento) y una regla sin prefijo se las llevaría.
 *    Sólo se informa su tamaño y su regla.
 */
"use strict";
const path = require("path");
const { PrismaClient } = require("@prisma/client");
const { ListBucketsCommand } = require("@aws-sdk/client-s3");
const s3 = require(path.join(__dirname, "..", "lib-s3.js"));
const ret = require(path.join(__dirname, "..", "lib-retencion-alarmas.js"));

/** Días para el bucket de intrusión cuando no tiene regla: lo mismo que las fotos de las alarmas. */
const INTRUSION_DIAS = 90;
const gb = (b) => `${(b / 1e9).toFixed(2)} GB`;

(async () => {
    const prisma = new PrismaClient();
    try {
        const r = await ret.leerRetencion(prisma);
        const a = await s3.asegurarRetencion("alarmas", r.dias);
        console.log(`retenciones: ${a.bucket} → ${a.dias} días${a.creado ? " (bucket creado)" : ""}${a.cambio ? (a.antes ? ` (antes ${a.antes})` : " (no tenía regla)") : ", ya estaba"} · tope ${r.topeGb} GB`);
        const i = await s3.asegurarRetencion("intrusion", INTRUSION_DIAS, { soloSiFalta: true });
        console.log(`retenciones: ${i.bucket} → ${i.dias} días${i.creado ? " (bucket creado)" : ""}${i.cambio ? " (no tenía regla)" : ", ya tenía regla: no se toca"}`);
        // El resto, para saber: tamaño y regla.
        const { s3: c } = await s3.clienteS3();
        const buckets = (await c.send(new ListBucketsCommand({}))).Buckets || [];
        for (const b of buckets) {
            if (b.Name === a.bucket || b.Name === i.bucket) continue;
            const m = await s3.medirBucket(c, b.Name).catch(() => null);
            const d = await s3.diasDeRetencion(c, b.Name).catch(() => null);
            console.log(`retenciones: ${b.Name} · ${m ? `${m.n} objetos, ${gb(m.bytes)}` : "sin medir"} · ${d ? `${d} días` : "sin regla"} (no se toca)`);
        }
    } catch (e) {
        console.log(`retenciones: no se pudo revisar el almacenamiento: ${e.message}`);
    } finally { await prisma.$disconnect(); }
})();
