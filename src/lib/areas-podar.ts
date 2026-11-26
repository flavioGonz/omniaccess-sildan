/**
 * Las asignaciones de equipo → área que ya no apuntan a nada (26/11).
 *
 * En el lab aparecieron 14 entradas en `DEVICE_AREAS.equipos` de cámaras que ya no existen
 * (creadas el 14/10, borradas antes de que existiera «borrar de todos lados», el 21/10). No se
 * veían en el árbol —la pantalla cuenta sólo equipos vivos— pero seguían en el ajuste, y cada
 * vez que se borraba su área subían al área madre: así terminaron todas en la raíz «San nicolas».
 * Nico movió equipos desde la pantalla y no hizo nada mal; el ajuste arrastraba basura invisible.
 *
 * Además había una carrera: el ajuste se lee, se cambia y se escribe entero. Si mientras se borra
 * un equipo otra acción escribe el estado que leyó antes, el equipo borrado vuelve a aparecer.
 *
 * La regla, entonces: el estado se poda contra los equipos y las áreas que existen, al leerlo y
 * ANTES de cada escritura. Así ninguna carrera ni ningún camino de borrado viejo puede dejar
 * (ni resucitar) una asignación huérfana.
 */
export function podarEquipos(equipos: Record<string, string>, idsVivos: Iterable<string>, areasVivas: Iterable<string>): { equipos: Record<string, string>; quitados: number } {
    const vivos = new Set(idsVivos), areas = new Set(areasVivas);
    const out: Record<string, string> = {};
    let quitados = 0;
    for (const [d, a] of Object.entries(equipos || {})) {
        // Un área que ya no existe deja al equipo «sin área» (la clave se va); un equipo que ya no
        // existe se va del todo.
        if (vivos.has(d) && areas.has(a)) out[d] = a; else quitados++;
    }
    return { equipos: out, quitados };
}
