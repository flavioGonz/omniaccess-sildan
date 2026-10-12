import type { Analisis } from "@/lib/vision-capa";

/**
 * El filtro OmniVision del historial: qué vio la inteligencia en la foto de cada lectura.
 *
 * vision-worker (vision-analisis.js) mira la foto de cada lectura LPR con omni-vision y guarda
 * lo que encontró en `AnalisisFoto` (una fila por lectura: objetos con su clase, caja, silueta
 * y atributos). Con eso el historial puede contestar preguntas que la cámara LPR no sabe:
 * «lecturas donde había una persona» (alguien caminando junto al auto), «las motos de hoy»,
 * «el camión que entró sin chapa». Y `Relectura` dice qué NO_LEIDA volvió a leer OmniVision.
 *
 * Este archivo lo comparten la pantalla y la API: los ids que viajan en la URL y qué clases del
 * detector (COCO) abarca cada uno. Sin base ni red.
 */

export type OpcionVision = {
    id: string;
    rotulo: string;
    /** Clases del detector que cuentan como esta opción. */
    clases?: string[];
    /** O un grupo entero de omni-vision (animal = perro, gato, caballo…). */
    grupo?: string;
    ayuda: string;
};

export const OPCIONES_VISION: OpcionVision[] = [
    { id: "persona", rotulo: "Persona", clases: ["person"], ayuda: "Había alguien en la foto: un peatón junto al auto, alguien que baja a abrir, un repartidor en moto." },
    { id: "auto", rotulo: "Auto", clases: ["car"], ayuda: "Un auto (sedán, hatchback, SUV chica)." },
    { id: "camion", rotulo: "Camioneta o camión", clases: ["truck"], ayuda: "Camionetas, furgones y camiones: el detector los pone en la misma clase." },
    { id: "moto", rotulo: "Moto", clases: ["motorcycle"], ayuda: "Una moto. Suelen pasar sin que la cámara lea la chapa." },
    { id: "bici", rotulo: "Bicicleta", clases: ["bicycle"], ayuda: "Una bicicleta." },
    { id: "omnibus", rotulo: "Ómnibus", clases: ["bus"], ayuda: "Un ómnibus o micro." },
    { id: "animal", rotulo: "Animal", grupo: "animal", ayuda: "Un perro, un gato, un caballo: cualquier animal." },
];

/** Relecturas: NO_LEIDA que OmniVision volvió a leer recortando el vehículo. */
export const OPCION_RELEIDA = {
    id: "releida", rotulo: "Releída por OmniVision",
    ayuda: "Lecturas que la cámara dio como NO_LEIDA y OmniVision volvió a leer recortando el vehículo. Es una sugerencia: no cambia el evento ni la decisión de la barrera.",
};
/** Estados de una relectura que traen una matrícula (LEIDA segura, DUDOSA para confirmar). */
export const RELECTURA_CON_CHAPA = ["LEIDA", "DUDOSA"];

/**
 * Hasta cuántas lecturas que cumplen el filtro se miran, de las más nuevas. La API trae los ids
 * de AnalisisFoto y los pasa al filtro del historial: sin tope, «persona» en un año serían
 * cientos de miles. Si se llega al tope, la respuesta lo dice y la pantalla también.
 */
export const VISION_IDS_MAX = 5000;

/** De los ids de la URL a las clases y grupos que hay que buscar en AnalisisFoto. */
export function clasesDe(ids: string[]): { clases: string[]; grupos: string[]; releida: boolean } {
    const elegidas = OPCIONES_VISION.filter((o) => ids.includes(o.id));
    return {
        clases: elegidas.flatMap((o) => o.clases || []),
        grupos: elegidas.flatMap((o) => (o.grupo ? [o.grupo] : [])),
        releida: ids.includes(OPCION_RELEIDA.id),
    };
}

/**
 * Lo que vio OmniVision en una lectura, como lo manda la API con cada fila de acceso: el resumen
 * (qué clases y cuántas), la relectura si hubo, y el análisis entero (siluetas, cajas, atributos)
 * para dibujarlo sobre la captura. Pesa ~1,5 KB por lectura (medido el 12/10): sesenta filas son
 * ~90 KB, y a cambio las miniaturas muestran las siluetas sin pedir nada más.
 */
export type VisionFila = {
    vio: { clase: string; nombre: string; n: number }[];
    /** La relectura de una NO_LEIDA, cualquiera sea su resultado: `plate` sólo si leyó (LEIDA o DUDOSA). */
    releida?: { plate: string | null; estado: string; confianza?: number | null } | null;
    analisis?: Analisis | null;
};

/** La empresa (delivery, taxi…) de la matrícula de una fila, con su logo. */
export type EmpresaFila = { nombre: string; logo: string; transparente: boolean };
