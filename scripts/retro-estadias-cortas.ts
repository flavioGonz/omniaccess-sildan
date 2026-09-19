/**
 * Las estadias que nunca lo fueron.
 *
 * Hasta ahora el estado ESTACIONADO se escribia en la primera lectura, antes de que
 * hubiera nada que lo sostuviera. El resultado quedo en la base: de treinta estadias,
 * dieciseis duraban CERO segundos y dos mas no llegaban al minuto — autos vistos una sola
 * vez en un rincon del cuadro, etiquetados como estacionados para siempre.
 *
 * El codigo ya no las crea asi. Esto arregla las que quedaron: las que no llegan a
 * ESTADIA_MINIMA_SEG pasan a VISTO, que es lo unico que se puede afirmar de ellas.
 *
 * No toca estAvisado. Si de alguna salio un aviso, el aviso salio: borrar la marca no lo
 * des-envia, solo hace que el sistema mienta en la otra direccion y lo mande de nuevo.
 *
 *   npx tsx scripts/retro-estadias-cortas.ts          ver que haria
 *   npx tsx scripts/retro-estadias-cortas.ts --aplicar
 */
import { prisma } from "../src/lib/prisma";
import { ESTADIA_MINIMA_SEG, duracionSeg, ESTACIONADO, VISTO } from "../src/lib/estadias";

async function main() {
    const aplicar = process.argv.includes("--aplicar");

    const filas = await prisma.plateSighting.findMany({
        where: { source: "TRACK", estado: ESTACIONADO },
        select: {
            id: true, plate: true, cameraName: true,
            estDesde: true, estHasta: true, estAvisado: true, estCerrada: true,
        },
        orderBy: { estDesde: "desc" },
    });

    const cortas = filas.filter((f) => duracionSeg(f.estDesde, f.estHasta) < ESTADIA_MINIMA_SEG);

    console.log(`Estadias marcadas ESTACIONADO: ${filas.length}`);
    console.log(`Por debajo de ${ESTADIA_MINIMA_SEG}s: ${cortas.length}\n`);
    for (const f of cortas) {
        const seg = Math.round(duracionSeg(f.estDesde, f.estHasta));
        console.log(
            `  ${f.plate.padEnd(10)} ${String(f.cameraName || "-").padEnd(10)} ` +
            `${seg}s${f.estAvisado ? "  (ya habia avisado)" : ""}`,
        );
    }

    if (!cortas.length) return;
    if (!aplicar) {
        console.log(`\nNada escrito. Con --aplicar pasan a ${VISTO}.`);
        return;
    }

    const { count } = await prisma.plateSighting.updateMany({
        where: { id: { in: cortas.map((f) => f.id) } },
        data: { estado: VISTO },
    });
    console.log(`\n${count} filas pasadas a ${VISTO}.`);
}

main()
    .catch((e) => { console.error(e); process.exit(1); })
    .finally(() => prisma.$disconnect());
