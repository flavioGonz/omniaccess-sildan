/**
 * La matrícula del vehículo que lleva un rastreador (24/11). Sin React ni base, para probarla.
 *
 * Nico: «cuando edito un GPS y le agrego matrícula, me obliga a agregarlo como usuario o residente;
 * no quiero eso». La matrícula sólo se podía ATAR a un vehículo del padrón, y en el padrón un
 * vehículo es siempre de una persona (y nace con su credencial de matrícula, que es lo que abre una
 * barrera). Una camioneta de la empresa no es de ningún residente ni tiene por qué abrir nada.
 *
 * Ahora la matrícula es un dato del rastreador. Si además esa matrícula está en el padrón, mejor
 * —se sabe de quién es—, pero no hace falta para rastrearlo, para los reportes ni para cruzarlo con
 * lo que leen las cámaras.
 */
export const MATRICULA_MIN = 4, MATRICULA_MAX = 10;

/** Como se guarda y se compara: sin espacios ni guiones, en mayúsculas («sc j8731» → «SCJ8731»). */
export const limpiarMatricula = (texto: string | null | undefined): string => (texto || "").replace(/[^0-9A-Za-z]/g, "").toUpperCase();

/** La matrícula lista para guardar, o por qué no sirve. Vacía es válida: es «no lleva ninguna». */
export function leerMatriculaGps(texto: string): { chapa: string } | { error: string } {
    const chapa = limpiarMatricula(texto);
    if (!chapa) return { chapa: "" };
    if (chapa.length < MATRICULA_MIN) return { error: `Una matrícula tiene al menos ${MATRICULA_MIN} letras y números.` };
    if (chapa.length > MATRICULA_MAX) return { error: `Una matrícula no tiene más de ${MATRICULA_MAX} letras y números.` };
    return { chapa };
}
