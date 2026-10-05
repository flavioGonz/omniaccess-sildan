/**
 * Crea una unidad (CASA) por cada lote dibujado en el mapa que todavía no tiene una, y
 * la deja vinculada. Es lo mismo que el botón "Crear N desde el mapa" de /admin/units,
 * para correrlo desde el server cuando no hay quien haga clic.
 *
 *   npx tsx scripts/crear-unidades-desde-lotes.ts            ver qué haría
 *   npx tsx scripts/crear-unidades-desde-lotes.ts --aplicar
 */
import { crearUnidadesDesdeLotes } from "../src/lib/catastro-desde-lotes";
import { prisma } from "../src/lib/prisma";

const aplicar = process.argv.includes("--aplicar");
crearUnidadesDesdeLotes({ soloMirar: !aplicar })
    .then((r) => { console.log(aplicar ? "aplicado:" : "haría:", r); })
    .finally(() => prisma.$disconnect());
