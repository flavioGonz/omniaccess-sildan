/**
 * Desde qué confianza una relectura de NO_LEIDA es «acertada» (LEIDA) y no «dudosa».
 *
 * Vive en Setting RELECTURA_CONF_SEGURA (pedido de Nico, 9/10: configurable, en 90 %). Se aplica
 * al MOSTRAR, sobre la confianza guardada, y no sólo al releer: así cambiar el umbral reclasifica
 * también lo que ya se releyó, y la estadística de la pantalla dice qué pasaría con cada valor.
 * vision-relectura.js lo lee igual para lo nuevo (si cambia acá, cambia allá).
 *
 * Archivo sin base: lo usan la ruta, la pantalla y lib/relectura.
 */
export const CLAVE_UMBRAL_RELECTURA = "RELECTURA_CONF_SEGURA";
/** El de arranque, medido con las coincidencias del primer día. */
export const UMBRAL_RELECTURA_DEFECTO = 0.7;
/** Debajo de 50 % una «acertada» sería una moneda al aire; arriba de 99 % no queda ninguna. */
export const UMBRAL_RELECTURA = { min: 0.5, max: 0.99 };
/** Los valores que la pantalla ofrece comparar. */
export const OPCIONES_UMBRAL = [0.7, 0.75, 0.8, 0.85, 0.9, 0.95];

export function leerUmbral(v: string | null | undefined): number {
    const n = Number(v);
    return Number.isFinite(n) && n >= UMBRAL_RELECTURA.min && n <= UMBRAL_RELECTURA.max ? n : UMBRAL_RELECTURA_DEFECTO;
}

/** LEIDA o DUDOSA según el umbral vigente; los demás estados (sin chapa, sin foto…) no dependen de él. */
export function estadoConUmbral(estado: string, confianza: number | null | undefined, umbral: number): string {
    if ((estado === "LEIDA" || estado === "DUDOSA") && confianza != null) return confianza >= umbral ? "LEIDA" : "DUDOSA";
    return estado;
}
