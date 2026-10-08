/**
 * Qué secretos de una persona pueden salir del servidor hacia la pantalla de quien mira.
 *
 * Antes salían todos: `getUsers` y `getCredentials` mandaban al navegador cada credencial tal
 * cual —el hash de la contraseña de cada administrador, la contraseña EN CLARO de los guardias
 * (que se guarda igual que su PIN) y los PIN—, y la tabla de usuarios mostraba los PIN de
 * cualquiera. Un administrador podía leer el secreto de otro administrador; la regla del barrio
 * es que cada uno ve el suyo y a los demás sólo se lo puede resetear.
 *
 *  · La CONTRASEÑA no sale nunca, de nadie: ni siquiera la propia se puede "ver" (está cifrada),
 *    y el hash sirve para adivinarla fuera de línea. Se informa sólo si existe.
 *  · El PIN de una CUENTA DEL PANEL (tiene rol de la aplicación, o es ADMIN/OPERATOR) sale sólo
 *    para su dueño. A los demás les llega vacío y marcado `oculto`: la pantalla dice que hay uno
 *    y deja poner otro (resetearlo), nunca leerlo.
 *  · El PIN de un residente o de un proveedor sigue visible: es el código del teclado de la
 *    entrada, el operador lo carga y lo dicta, y no abre el panel.
 *
 * Este archivo no importa nada de Next ni de la sesión: recibe quién mira (`yo`) para poder
 * usarse desde cualquier acción de servidor.
 */

const ROLES_DEL_PANEL = new Set(["ADMIN", "OPERATOR"]);

export type DuenioCredencial = { id: string; role?: string | null; appRoleId?: string | null };

/** ¿Esta persona entra al panel? Entonces sus secretos son de ella sola. */
export const esCuentaDelPanel = (u: DuenioCredencial | null | undefined) => !!u && (!!u.appRoleId || ROLES_DEL_PANEL.has(String(u.role || "")));

/** Las credenciales de `duenio` tal como las puede ver `yo` (id del usuario de la sesión). */
export function credencialesVisibles<C extends { type: string; value: string }>(creds: C[], duenio: DuenioCredencial, yo: string | null): (C & { oculto?: boolean })[] {
    const ajeno = esCuentaDelPanel(duenio) && duenio.id !== yo;
    return creds
        .filter((c) => c.type !== "PASSWORD")
        .map((c) => (c.type === "PIN" && ajeno ? { ...c, value: "", oculto: true } : c));
}
