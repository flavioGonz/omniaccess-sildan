/**
 * Lo de OmniVision › Accesos que usan el servidor (lib/accesos-vision) y la pantalla: los
 * umbrales y los tipos. Va aparte porque la pantalla no puede importar nada que traiga la base.
 */

/** Lectura a esta distancia de un cruce (antes o después) es la de ese vehículo. */
export const VENTANA_S = 10;
/** Dos cruces de paso más cerca que esto, con una sola lectura: el segundo pudo entrar detrás. */
export const COLADO_S = 6;
/** Lecturas más cerca que esto son el mismo vehículo leído dos veces (SCY6809 / SCY680P). */
export const MISMO_VEHICULO_S = 5;
/** Con menos cruces que esto en un sentido no se decide cuál es el de paso. */
export const CRUCES_MIN = 10;
/** Un sentido con menos lecturas que esto no es de paso: es tráfico que la línea no debería ver. */
export const PASO_MIN = 0.5;
/** Clases que debería contar la regla de un acceso para que motos y camiones no se escapen. */
export const CLASES_ACCESO = ["car", "truck", "bus", "motorcycle"];

export type Sentido = "ab" | "ba";
export type PasoSinLectura = { id: string; ts: string; clase: string | null; foto: string | null; caja: number[] | null; colado: boolean };
export type ResumenAcceso = {
    deviceId: string; camara: string;
    regla: { id: string; nombre: string; clases: string[] };
    porSentido: Record<Sentido, { cruces: number; conLectura: number }>;
    sentidoPaso: Sentido | null;
    pasos: number; conLectura: number; sinLectura: number; colados: number; motos: number;
    porClase: Record<string, number>;
    /** Vehículos leídos (lecturas agrupadas) y cuántos de ellos cruzaron la línea de paso. */
    leidos: number; leidosConCruce: number;
    sin: PasoSinLectura[];
    faltanClases: string[];
};

