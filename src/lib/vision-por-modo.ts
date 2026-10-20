import type { Analitica } from "@/lib/vision-catalogo";
import type { TipoRegla } from "@/lib/vision-reglas";

/**
 * Qué parte de OmniVision corresponde a cada modo de la instalación. Un solo lugar: la barra de
 * OmniVision, el menú «OmniVision» de Ajustes, el catálogo de Analíticas y el cajón de una regla
 * leen esta regla.
 *
 * Por qué existe (HB, 19/10, Nico: «en modo fila no tenemos todas estas analíticas me parece»):
 * el catálogo mostraba las 29 analíticas —matrículas, intrusión, rostros, obras, búsqueda— en una
 * instalación que sólo cuenta filas. Prender «Color del vehículo» en el Hospital Británico no hace
 * nada, y verlo «corriendo» dice que la instalación tiene algo que no tiene. Lo de las otras
 * instalaciones (San Nicolás, Olivos: modo matrículas) no cambia: fuera del modo Filas se ve todo.
 */

export type Modulos = Partial<Record<string, boolean>>;

/** El modo Filas solo: ni matrículas ni rostros prendidos (los modos se excluyen entre sí). */
export const esSoloFilas = (m?: Modulos | null) => !!m?.MODULE_QUEUE && !m.MODULE_LPR && !m.MODULE_FACE;

/** En modo Filas: la analítica de la fila y las herramientas de prueba (ver qué detecta la cámara). */
const MODOS_ANALITICA_FILAS: readonly Analitica["modo"][] = ["Filas", "Prueba"];
/** Las pantallas de OmniVision que tienen algo que mostrar en una instalación de filas. */
const SECCIONES_FILAS: readonly string[] = ["/admin/vision/analiticas", "/admin/vision/reglas", "/admin/vision/detecciones", "/admin/vision/filas", "/admin/vision"];
/** Los tipos de regla que se pueden crear en modo Filas. */
const TIPOS_REGLA_FILAS: readonly TipoRegla[] = ["fila"];

export const analiticaAplica = (a: Pick<Analitica, "modo">, soloFilas: boolean) => !soloFilas || MODOS_ANALITICA_FILAS.includes(a.modo);
export const seccionAplica = (href: string, soloFilas: boolean) => !soloFilas || SECCIONES_FILAS.includes(href);
export const tipoReglaAplica = (t: TipoRegla, soloFilas: boolean) => !soloFilas || TIPOS_REGLA_FILAS.includes(t);
