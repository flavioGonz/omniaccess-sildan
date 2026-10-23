#!/usr/bin/env node
/**
 * Vuelve a traducir los eventos Contact ID guardados que quedaron como «Evento N» (o como alarma o
 * falla genérica) con la tabla actual de lib-dc09-codigos. Lo nuevo que llega ya entra traducido: esto
 * es para lo de antes (23/10: se agregó la tabla completa de Ademco y la familia de los códigos propios).
 *
 *   node scripts/retraducir-centrales.js            → muestra qué cambiaría
 *   node scripts/retraducir-centrales.js --aplicar  → lo guarda
 *
 * Sólo toca `eventos` del mensaje: la trama, la respuesta y la alarma que haya generado quedan igual.
 */
require("dotenv").config({ quiet: true });
const { PrismaClient } = require("@prisma/client");
const cod = require("../lib-dc09-codigos.js");
const prisma = new PrismaClient();
const APLICAR = process.argv.includes("--aplicar");
const VIEJO = /^(Evento|Alarma|Falla) \d{3}$/;

(async () => {
    const filas = await prisma.mensajeCentral.findMany({ select: { id: true, eventos: true } });
    let cambian = 0;
    const resumen = new Map();
    for (const f of filas) {
        const evs = Array.isArray(f.eventos) ? f.eventos : [];
        let toco = false;
        const nuevos = evs.map((e) => {
            const m = /^CID ([136])(\d{3})$/.exec(e?.codigo || "");
            if (!m || !(e.tipo === "DESCONOCIDO" || VIEJO.test(e.texto || ""))) return e;
            const pp = String(e.particion ?? 0).padStart(2, "0");
            const zz = String(e.zona ?? e.modulo ?? e.usuario ?? 0).padStart(3, "0");
            const [n] = cod.traducirCid(`${m[1]}${m[2]}${pp}${zz}`);
            if (!n || n.texto === e.texto) return e;
            toco = true;
            resumen.set(`${e.texto} → ${n.texto}`, (resumen.get(`${e.texto} → ${n.texto}`) || 0) + 1);
            return { ...e, ...n };
        });
        if (!toco) continue;
        cambian++;
        if (APLICAR) await prisma.mensajeCentral.update({ where: { id: f.id }, data: { eventos: nuevos } });
    }
    for (const [k, v] of resumen) console.log(`${v}× ${k}`);
    console.log(`${cambian} mensajes ${APLICAR ? "actualizados" : "cambiarían (con --aplicar se guardan)"}`);
    await prisma.$disconnect();
})().catch((e) => { console.error(e.message); process.exit(1); });
