/**
 * Consulta asistida de "Matrículas Requeridas" (Ministerio del Interior, Uruguay).
 *
 * Lo que comparten el botón, el diálogo y la ruta: la URL oficial (para ofrecer abrirla
 * cuando la respuesta no se pudo clasificar) y la normalización de la matrícula. Vivían
 * repetidas en el botón y en el diálogo, y el diálogo no podía importarlas del botón sin
 * un ciclo (el botón importa al diálogo).
 */

/**
 * La página del servicio en gub.uy. Hasta el 22/10 era el formulario de
 * matriculas-requeridas.minterior.gub.uy/index.php, pero ese sitio ahora redirige a la portada del
 * Ministerio en gub.uy: el enlace «Abrir el sitio oficial» llevaba a una página que ya no existe.
 */
export const MIN_INTERIOR_URL = "https://www.gub.uy/ministerio-interior/tramites-y-servicios/servicios/matriculas-requeridas";

/** Sólo letras y números en mayúscula: así la escribe el sitio y así la guarda OmniAccess. */
export const normalizarMatricula = (p?: string | null) => String(p || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

/** Largo máximo del código de la imagen: el formulario oficial no acepta más. */
export const LARGO_CODIGO = 6;

export type EstadoConsulta = "REQUERIDA" | "NO" | "CAPTCHA" | "UNKNOWN";
