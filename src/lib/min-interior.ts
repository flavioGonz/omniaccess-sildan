/**
 * Consulta asistida de "Matrículas Requeridas" (Ministerio del Interior, Uruguay).
 *
 * Lo que comparten el botón, el diálogo y la ruta: la URL oficial (para ofrecer abrirla
 * cuando la respuesta no se pudo clasificar) y la normalización de la matrícula. Vivían
 * repetidas en el botón y en el diálogo, y el diálogo no podía importarlas del botón sin
 * un ciclo (el botón importa al diálogo).
 */

/**
 * El formulario oficial. El 22/10 el sitio pasó a redirigir a la portada del Ministerio en gub.uy
 * y el enlace apuntó un tiempo a la ficha del servicio; el 2/11 Nico avisó que volvió a estar en
 * línea en su dirección de siempre, que es la que lleva la matrícula a consultar.
 */
export const MIN_INTERIOR_URL = "https://matriculas-requeridas.minterior.gub.uy/";

/** Cuánto vale una respuesta guardada para mostrarla junto al botón como «última consulta». */
export const ULTIMA_VIGENTE_MS = 24 * 60 * 60 * 1000;

/** Sólo letras y números en mayúscula: así la escribe el sitio y así la guarda OmniAccess. */
export const normalizarMatricula = (p?: string | null) => String(p || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

/** Largo máximo del código de la imagen: el formulario oficial no acepta más. */
export const LARGO_CODIGO = 6;

export type EstadoConsulta = "REQUERIDA" | "NO" | "CAPTCHA" | "UNKNOWN";

/** La última consulta guardada de una matrícula, como la devuelve `?action=ultima`. */
export type UltimaConsulta = { estado: Exclude<EstadoConsulta, "CAPTCHA">; creadoEn: string; quien: string | null; extracto: string | null };
