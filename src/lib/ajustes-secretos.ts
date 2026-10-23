/**
 * Qué claves de Setting son secretas (openspec roles-y-permisos, «Leer un secreto»): `getSetting`
 * las devuelve sólo a quien tiene Ajustes. Antes cualquier sesión podía pedir el token de Telegram,
 * las claves del almacenamiento o la de WhatsApp desde la consola del navegador.
 * Por el nombre: lo que guarda una credencial lleva una de estas palabras.
 */
const SECRETO = /(TOKEN|SECRET|PASSWORD|PASSWD|API_KEY|APIKEY|ACCESS_KEY|_KEY$|DATABASE_URL|CLAVE_DATOS|PRIVATE)/i;

export const esClaveSecreta = (clave: string) => !clave.startsWith("GUARD_") && SECRETO.test(clave);
