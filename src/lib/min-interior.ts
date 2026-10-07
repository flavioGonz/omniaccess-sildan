/**
 * Consulta asistida de "Matrículas Requeridas" (Ministerio del Interior, Uruguay).
 *
 * Lo que comparten el botón, el diálogo y la ruta: la URL oficial (para ofrecer abrirla
 * cuando la respuesta no se pudo clasificar) y la normalización de la matrícula. Vivían
 * repetidas en el botón y en el diálogo, y el diálogo no podía importarlas del botón sin
 * un ciclo (el botón importa al diálogo).
 */

export const MIN_INTERIOR_URL = "https://matriculas-requeridas.minterior.gub.uy/index.php";

/** Sólo letras y números en mayúscula: así la escribe el sitio y así la guarda OmniAccess. */
export const normalizarMatricula = (p?: string | null) => String(p || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

/** Largo máximo del código de la imagen: el formulario oficial no acepta más. */
export const LARGO_CODIGO = 6;

export type EstadoConsulta = "REQUERIDA" | "NO" | "CAPTCHA" | "UNKNOWN";
