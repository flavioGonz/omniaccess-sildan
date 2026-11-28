/**
 * Quién es la gente de un lote (28/11).
 *
 * Una persona puede estar en un lote de dos maneras: lo tiene como lote principal (`User.unitId`) o
 * figura en él con un vínculo (`UserUnidad`: propietario, inquilino, ocupante, familia). Casi siempre
 * son las dos cosas a la vez; alguien cargado a mano en Usuarios con su unidad tiene sólo la primera.
 *
 * El cajón del lote, su historial y sus matrículas ya contaban a los dos. Las tablas —Unidades y los
 * lotes de cada administración— miraban sólo el vínculo, y por eso un lote decía «0 personas, 0
 * matrículas» en la lista y mostraba dos personas con sus chapas al abrirlo (lo vio Nico en el lab).
 * Una lista y su ficha no pueden contestar distinto la misma pregunta: las dos pasan por acá.
 *
 * A quien no tiene vínculo no se le inventa uno: sale con el vínculo vacío, que la tabla dice como
 * «sin vínculo», y se le pone desde el cajón del lote.
 */
export function genteDelLote<P extends { id: string }>(conVinculo: { vinculo: string; user: P }[], principales: P[]): { persona: P; vinculo: string }[] {
    const vistos = new Set(conVinculo.map((v) => v.user.id));
    return [
        ...conVinculo.map((v) => ({ persona: v.user, vinculo: v.vinculo })),
        ...principales.filter((p) => !vistos.has(p.id)).map((p) => ({ persona: p, vinculo: "" })),
    ];
}
