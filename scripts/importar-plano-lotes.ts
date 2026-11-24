/**
 * Carga el croquis de los lotes desde la carpeta de planos (ver src/lib/plano-lotes-importar.ts).
 *
 *   npx tsx scripts/importar-plano-lotes.ts            ver qué haría
 *   npx tsx scripts/importar-plano-lotes.ts --aplicar
 */
import { importarPlanoLotes } from "../src/lib/plano-lotes-importar";
import { prisma } from "../src/lib/prisma";

const aplicar = process.argv.includes("--aplicar");
importarPlanoLotes({ simulacro: !aplicar })
    .then((r) => { console.log(aplicar ? "aplicado:" : "haría:", { ...r, sinLote: r.sinLote.length ? r.sinLote : "ninguno" }); })
    .catch((e) => { console.error("No se pudo:", e instanceof Error ? e.message : e); process.exitCode = 1; })
    .finally(() => prisma.$disconnect());
