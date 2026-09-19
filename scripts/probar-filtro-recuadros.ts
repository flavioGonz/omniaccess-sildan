/**
 * Corre el filtro geometrico contra lo que ya esta en la base, sin tocar nada.
 *
 * Esto es lo que decidio los dos factores de src/lib/recuadros.ts, y sirve para volver a
 * decidirlos: si se mueve una camara, se cambia el lente o se suma una calle, el area
 * tipica cambia y conviene correrlo de nuevo antes de suponer que los numeros siguen
 * valiendo.
 *
 * Lo que importa mirar es la ultima columna del resumen. Frenar una chapa real es MUCHO
 * peor que dejar pasar una basura: la basura se ve en el historial y se ignora; el auto
 * que el filtro se comio no se recupera, y nadie se entera de que falta. Si "chapas
 * reales frenadas" no da cero, los factores estan mal.
 *
 * La lista de abajo es la clasificacion a mano del 19 de setiembre de 2026: lo que se
 * miro una por una y se decidio que no era un vehiculo. Al agregar casos nuevos, agregar
 * los que se hayan verificado, no los sospechosos.
 *
 *   npx tsx scripts/probar-filtro-recuadros.ts
 */
import { prisma } from "@/lib/prisma";
import { leerCaja, areaTipica, pareceChapa, area, type Caja } from "@/lib/recuadros";

const BASURA = new Set(["1QQ3UP1","PRGI790L","1T4K9B0","2JVOOQ","1111","11111","611111","1AZ1114","M4444","LA1111H","19D9202","CWA111"]);

(async () => {
    const camaras = await prisma.plateSighting.findMany({
        where: { source: "TRACK", bbox: { not: null } },
        select: { deviceId: true }, distinct: ["deviceId"],
    });
    let aciertos = 0, falsosPositivos = 0, escapadas = 0, ok = 0;
    for (const { deviceId } of camaras) {
        const filas = await prisma.plateSighting.findMany({
            where: { deviceId, source: "TRACK", bbox: { not: null } },
            orderBy: { timestamp: "desc" }, take: 120,
            select: { plate: true, bbox: true, cameraName: true },
        });
        const cajas = filas.map((f) => leerCaja(f.bbox)).filter((c): c is Caja => !!c);
        const ref = areaTipica(cajas);
        console.log(`\n=== ${filas[0]?.cameraName || deviceId}  (${filas.length} lecturas, area tipica ${ref?.toFixed(5) ?? "sin referencia"})`);
        for (const f of filas) {
            const c = leerCaja(f.bbox); if (!c) continue;
            const v = pareceChapa(c, ref);
            const esBasura = BASURA.has(f.plate);
            if (!v.ok && esBasura) { aciertos++; console.log(`  RECHAZA  ${f.plate.padEnd(9)} basura      area=${area(c).toFixed(5)}  ${v.motivo}`); }
            else if (!v.ok && !esBasura) { falsosPositivos++; console.log(`  RECHAZA  ${f.plate.padEnd(9)} PARECE REAL area=${area(c).toFixed(5)}  ${v.motivo}   <-- REVISAR`); }
            else if (v.ok && esBasura) { escapadas++; console.log(`  pasa     ${f.plate.padEnd(9)} basura      area=${area(c).toFixed(5)}   <-- se escapa`); }
            else ok++;
        }
    }
    console.log(`\nRESUMEN  basura frenada: ${aciertos}   basura que se escapa: ${escapadas}   chapas reales frenadas: ${falsosPositivos}   reales que pasan: ${ok}`);
    await prisma.$disconnect();
})();
