/**
 * Leer la clave de un TopFly de su respuesta a MYSELF#, y taparla. Es lib-topfly.js (el receptor la
 * usa para el log); acá se trae para que la acción del panel decida con la misma regla, sin copiarla.
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TF = require("../../lib-topfly.js") as {
    respuestaSinClave: (texto: string, forzar?: boolean) => string;
    claveDeRespuesta: (texto: string) => string | null;
};
export const respuestaSinClave = (texto: string, forzar = false) => TF.respuestaSinClave(texto, forzar);
export const claveDeRespuesta = (texto: string) => TF.claveDeRespuesta(texto);
