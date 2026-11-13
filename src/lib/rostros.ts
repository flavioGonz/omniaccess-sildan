/**
 * Identidad por rostro, del lado del panel: los tipos y lo poco que hace falta en el navegador.
 * Las reglas (umbrales, qué es una visita) viven en lib-rostros.js, que es lo que usa el proceso
 * de visión; acá no se repiten.
 */

/** «R-0042». Igual que `codigo` de lib-rostros.js (tests/rostros.test.ts comprueba que coincidan). */
export const codigoRostro = (numero: number) => "R-" + String(Math.max(0, Math.trunc(Number(numero) || 0))).padStart(4, "0");

export const FILTROS_ROSTRO = ["todos", "sin-registrar", "registrados", "frecuentes", "sugerencias"] as const;
export type FiltroRostro = (typeof FILTROS_ROSTRO)[number];
export const ORDENES_ROSTRO = ["recientes", "veces", "nuevos"] as const;
export type OrdenRostro = (typeof ORDENES_ROSTRO)[number];

/** De cuántas visitas para arriba una cara cuenta como «frecuente» en el filtro. */
export const FRECUENTE_DESDE = 3;
/** Cuántas caras trae cada página de la grilla. */
export const ROSTROS_POR_PAGINA = 60;
/** Cuántas pasadas se muestran en la ficha. */
export const PASADAS_EN_FICHA = 80;

export type FilaRostro = {
    id: string; numero: number; codigo: string;
    /** El nombre de la persona del padrón, o el apodo. Null si nadie la registró. */
    nombre: string | null;
    registro: "persona" | "apodo" | null;
    userId: string | null; rol: string | null;
    /** La URL de su mejor cara. Null si se perdió la foto. */
    foto: string | null;
    calidad: number;
    veces: number; primeraVez: string; ultimaVez: string; ultimaCamara: string | null;
    /** A quién se parece sin llegar al umbral: la propuesta de unirlas. */
    sugerencia: { id: string; codigo: string; nombre: string | null; foto: string | null; parecido: number } | null;
};

export type PasadaRostro = { id: string; cuando: string; camara: string | null; similitud: number | null; px: number | null; cara: string | null; cuadro: string | null };

export type FichaRostro = FilaRostro & {
    ejemplos: number;
    pasadas: PasadaRostro[];
    /** Cuántas pasadas tiene en total (la ficha muestra las últimas). */
    totalPasadas: number;
    camaras: { camara: string; veces: number }[];
};

/** Los nombres de cámara vienen de la base con las entidades HTML escapadas («Ext. -&gt; Cairoli»). */
export const nombreCamara = (s: string | null | undefined) => (s ? s.replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&amp;/g, "&") : null);

/** «3 veces», «1 vez». */
export const textoVeces = (n: number) => (n === 1 ? "1 vez" : `${n.toLocaleString("es-UY")} veces`);
