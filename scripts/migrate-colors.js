const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

// Mapeo de colores en inglés a español
const COLOR_TEXT_MAP = {
    'white': 'Blanco',
    'silver': 'Plateado',
    'gray': 'Gris',
    'grey': 'Gris',
    'black': 'Negro',
    'red': 'Rojo',
    'blue': 'Azul',
    'darkblue': 'Azul Oscuro',
    'yellow': 'Amarillo',
    'green': 'Verde',
    'brown': 'Marrón',
    'pink': 'Rosa',
    'purple': 'Púrpura',
    'cyan': 'Cian',
    'orange': 'Naranja'
};

async function migrateColors() {
    console.log("🔄 Iniciando migración de colores...\n");

    try {
        // Obtener todos los eventos con detalles
        const events = await prisma.accessEvent.findMany({
            where: {
                details: { not: null },
                accessType: 'PLATE'
            },
            orderBy: { timestamp: 'desc' }
        });

        console.log(`📊 Total de eventos a procesar: ${events.length}\n`);

        let updated = 0;
        let skipped = 0;
        let errors = 0;

        for (const event of events) {
            try {
                const details = event.details || "";

                // Extraer color del campo details
                // Formato: "Marca: Toyota, Modelo: Unknown, Color: Gris, Tipo: SUVMPV"
                const colorMatch = details.match(/Color:\s*([^,]+)/i);

                if (!colorMatch) {
                    skipped++;
                    continue;
                }

                let extractedColor = colorMatch[1].trim();

                // Si el color ya está en español, dejarlo como está
                // Si está en inglés, traducirlo
                const lowerColor = extractedColor.toLowerCase();
                if (COLOR_TEXT_MAP[lowerColor]) {
                    extractedColor = COLOR_TEXT_MAP[lowerColor];
                }

                // Actualizar el campo details con el color correcto
                const newDetails = details.replace(
                    /Color:\s*[^,]+/i,
                    `Color: ${extractedColor}`
                );

                if (newDetails !== details) {
                    await prisma.accessEvent.update({
                        where: { id: event.id },
                        data: { details: newDetails }
                    });
                    updated++;

                    if (updated % 100 === 0) {
                        console.log(`✅ Procesados: ${updated} eventos`);
                    }
                }

            } catch (err) {
                errors++;
                console.error(`❌ Error procesando evento ${event.id}:`, err.message);
            }
        }

        console.log("\n" + "=".repeat(60));
        console.log("📈 RESUMEN DE MIGRACIÓN:");
        console.log("=".repeat(60));
        console.log(`✅ Eventos actualizados: ${updated}`);
        console.log(`⏭️  Eventos omitidos: ${skipped}`);
        console.log(`❌ Errores: ${errors}`);
        console.log(`📊 Total procesados: ${events.length}`);
        console.log("=".repeat(60) + "\n");

        console.log("✨ Migración completada exitosamente!\n");

    } catch (error) {
        console.error("💥 Error fatal en la migración:", error);
        process.exit(1);
    } finally {
        await prisma.$disconnect();
    }
}

// Ejecutar migración
migrateColors()
    .then(() => {
        console.log("👋 Proceso finalizado.");
        process.exit(0);
    })
    .catch((error) => {
        console.error("💥 Error inesperado:", error);
        process.exit(1);
    });
