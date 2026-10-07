import { metodoDeLectura } from "@/lib/lectura-metodo";

/**
 * Una lectura LPR como la ve una pantalla de Monitores. Compartida por la vista
 * (/api/monitor/lpr) y la ficha de una lectura (/api/monitor/lpr/lectura/<id>), para que la
 * pantalla no muestre dos formas distintas de la misma fila.
 *
 * Lleva la UNIDAD de la persona: en la pared lo primero que se pregunta de un auto que entra es
 * "¿de qué lote es?", y el nombre solo no lo contesta.
 */
export const INCLUIR_LECTURA = { user: { select: { name: true, unit: { select: { name: true } } } }, device: { select: { name: true } } } as const;

export const formaLectura = (e: any) => ({
    id: e.id, ts: e.timestamp.toISOString(), plate: e.plateDetected || e.plateNumber || null, persona: e.user?.name || null,
    unidad: e.user?.unit?.name || null,
    camara: e.device?.name || e.location || null, sentido: e.direction, decision: e.decision, accessType: e.accessType,
    foto: e.snapshotPath || e.imagePath || null, detalles: e.details || null, metodo: metodoDeLectura(e.details || null),
});
