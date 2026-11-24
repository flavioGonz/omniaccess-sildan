import { hojasDe, type HojaConGrupo, type SeccionMenu } from "@/lib/menu";

/**
 * Las pantallas fijadas arriba del menú (24/11). Sólo la regla, para poder probarla.
 *
 * Nico: «cada elemento del menú debe tener un ícono invisible que al pasar por encima se ve, para
 * fijar el elemento arriba del todo del sidebar; así podemos personalizar cómo mostrar los primeros
 * elementos del menú. Comenzando por Monitor LPR arriba del todo».
 *
 * El menú por módulos ordena, pero a la pantalla que alguien usa todo el día la deja adentro de un
 * módulo, a dos clics. Fijarla la sube a una lista corta arriba de todo, en el orden en que se la
 * fijó. Es un ATAJO, no una mudanza: la pantalla sigue también en su módulo, así el árbol no cambia
 * de forma según quién lo mire y lo que dice un manual («Matrículas › Monitor LPR») sigue valiendo.
 *
 * Lo que se guarda son los ids de las hojas del menú. Un id que el menú de esta instalación o de
 * este rol no tiene (un módulo apagado, una pantalla sin permiso) no se dibuja y no se borra: si
 * vuelve a estar, vuelve a aparecer fijado.
 */

/** Lo que trae fijado quien nunca tocó nada. */
export const FIJADOS_DE_FABRICA = ["lpr-monitor"];
/** Más que esto ya no es «los primeros elementos»: es otro menú arriba del menú. */
export const FIJADOS_MAX = 8;

/** Lee lo guardado. `null` (nunca se guardó nada) es «los de fábrica»; una lista vacía es «sacó todos», y se respeta. */
export function leerFijados(crudo: string | null | undefined): string[] {
    if (crudo === null || crudo === undefined || crudo === "") return FIJADOS_DE_FABRICA;
    try {
        const l = JSON.parse(crudo);
        if (!Array.isArray(l)) return FIJADOS_DE_FABRICA;
        return [...new Set(l.filter((x): x is string => typeof x === "string" && x.length > 0 && x.length < 80))].slice(0, FIJADOS_MAX);
    } catch { return FIJADOS_DE_FABRICA; }
}

/** Fija lo que no estaba (al final de los fijados) o suelta lo que estaba. Al llegar al tope no fija más. */
export function alternarFijado(fijados: string[], id: string): string[] {
    if (fijados.includes(id)) return fijados.filter((x) => x !== id);
    return fijados.length >= FIJADOS_MAX ? fijados : [...fijados, id];
}

/** Las hojas fijadas que este menú tiene, en el orden en que se fijaron. */
export function hojasFijadas(menu: SeccionMenu[], fijados: string[]): HojaConGrupo[] {
    const porId = new Map(hojasDe(menu).map((h) => [h.id, h]));
    return fijados.map((id) => porId.get(id)).filter((h): h is HojaConGrupo => !!h);
}
