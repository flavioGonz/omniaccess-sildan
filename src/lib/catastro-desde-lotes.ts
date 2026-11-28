import { prisma } from "@/lib/prisma";

// En San Nicolás se dibujaron 81 lotes en el mapa antes de cargar una sola unidad: el
// operador dibuja primero, porque el plano es lo que tiene a mano, y el catastro queda
// vacío. Cargar 81 unidades a mano para después vincularlas una por una al lote es el
// trabajo que esto ahorra. Es idempotente: un lote que ya tiene unidad se saltea, y una
// unidad que ya se llama como el lote se vincula en vez de duplicarse.
//
// Lee los lotes directo de la Setting (no de la action getBarrioMap) para no depender
// de "use server" y poder correr desde un script.
//
// Con el padrón por administraciones (28/11) esto cambió de sentido. En el lab aparecieron nueve
// unidades «Sin administración» —L1, L3…L9 y una con el nombre de un dibujo de prueba— que no eran
// lotes de nadie: las había creado este atajo a partir de dibujos del mapa, cuando los lotes de
// verdad ya existían con otro nombre («L 3 (1-3)»). Nico: «los lotes y esos números no existen».
// Un complejo que ya tiene su padrón no necesita que el mapa le invente unidades: necesita que el
// dibujo se ate al lote que ya está. Entonces, si hay administraciones, NO se crea nada: el dibujo
// se ata al lote del padrón cuando su código es de uno solo, y si no, queda sin atar y se informa.
export type ResultadoCatastro = { ok: boolean; error?: string; creadas: number; vinculadas: number; omitidas: number;
    /** Con padrón: dibujos que no se pudieron atar solos (no hay lote con ese código, o hay más de uno). */
    sinLote?: number };

/**
 * El código de lote que dice un rótulo del mapa: «L3», «Lote L 3» y «l 3» son el lote L 3. Es lo que
 * se compara con el código de un lote del padrón (lo que va antes del paréntesis de la etapa).
 */
export function codigoDeRotulo(rotulo: string): string {
    return String(rotulo || "").replace(/\(.*$/, "").replace(/\blote\b/i, "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/**
 * A qué lote del padrón se ata cada dibujo. Sólo cuando no hay duda: un único lote con ese código y
 * que no tenga ya otro dibujo. «A 2» existe en dos etapas: ése no se adivina.
 */
export function atarDibujos(dibujos: { id: string; rotulo: string }[], lotes: { id: string; nombre: string }[], yaAtados: Set<string>): { atados: Record<string, string>; sinLote: string[] } {
    const porCodigo = new Map<string, string[]>();
    for (const l of lotes) { const c = codigoDeRotulo(l.nombre); if (c) porCodigo.set(c, [...(porCodigo.get(c) || []), l.id]); }
    const atados: Record<string, string> = {}, sinLote: string[] = [], tomados = new Set(yaAtados);
    for (const d of dibujos) {
        const candidatos = porCodigo.get(codigoDeRotulo(d.rotulo)) || [];
        if (candidatos.length === 1 && !tomados.has(candidatos[0])) { atados[d.id] = candidatos[0]; tomados.add(candidatos[0]); }
        else sinLote.push(d.id);
    }
    return { atados, sinLote };
}

export async function crearUnidadesDesdeLotes(opts?: { parentId?: string | null; soloMirar?: boolean }): Promise<ResultadoCatastro> {
    try {
        const row = await prisma.setting.findUnique({ where: { key: "BARRIO_MAP" } });
        const d = row?.value ? JSON.parse(row.value) : {};
        // `lotes` es el modelo vigente; `lots` el viejo de San Nicolás (ver actions/barriomap.ts).
        const key = Array.isArray(d.lotes) ? "lotes" : "lots";
        const arr: any[] = Array.isArray(d[key]) ? d[key] : [];

        const existentes = await prisma.unit.findMany({ select: { id: true, name: true, parentId: true, administracionId: true } });

        // Con padrón por administraciones no se inventan unidades: los dibujos se atan a sus lotes.
        if (await prisma.administracion.count()) {
            const sueltos = arr.filter((l) => !l.unitId);
            const { atados, sinLote } = atarDibujos(
                sueltos.map((l) => ({ id: String(l.id), rotulo: String(l.label || l.name || "") })),
                existentes.filter((u) => u.administracionId).map((u) => ({ id: u.id, nombre: u.name })),
                new Set(arr.map((l) => l.unitId).filter(Boolean)),
            );
            if (!opts?.soloMirar && Object.keys(atados).length) {
                d[key] = arr.map((x) => (atados[x.id] ? { ...x, unitId: atados[x.id] } : x));
                await prisma.setting.update({ where: { key: "BARRIO_MAP" }, data: { value: JSON.stringify(d) } });
            }
            return { ok: true, creadas: 0, vinculadas: Object.keys(atados).length, omitidas: arr.length - sueltos.length, sinLote: sinLote.length };
        }
        const porNombre = new Map(existentes.map((u) => [u.name.trim().toLowerCase(), u]));
        const padre = opts?.parentId ? existentes.find((u) => u.id === opts.parentId) : null;

        let creadas = 0, vinculadas = 0, omitidas = 0;
        const vinculos: Record<string, string> = {}; // loteId -> unitId

        for (const l of arr) {
            if (l.unitId) { omitidas++; continue; }
            const nombre = String(l.label || l.name || l.id).trim();
            // El rótulo del lote suele ser "Lote 12": el número queda en `lot`, que es lo que
            // busca el filtro de la tabla y lo que muestra la celda.
            const numero = nombre.match(/\d+/)?.[0] ?? null;
            const ya = porNombre.get(nombre.toLowerCase());
            if (ya) { vinculos[l.id] = ya.id; vinculadas++; continue; }
            creadas++;
            if (opts?.soloMirar) continue;
            const u = await prisma.unit.create({
                data: {
                    name: nombre,
                    type: "CASA",
                    lot: numero,
                    description: "Creada desde el lote dibujado en el mapa",
                    parentId: padre?.id ?? null,
                },
                select: { id: true },
            });
            porNombre.set(nombre.toLowerCase(), { id: u.id, name: nombre, parentId: padre?.id ?? null, administracionId: null });
            vinculos[l.id] = u.id;
        }

        if (!opts?.soloMirar && Object.keys(vinculos).length) {
            // Un solo guardado del mapa, no uno por lote: la clave BARRIO_MAP es un JSON entero.
            d[key] = arr.map((x) => (vinculos[x.id] ? { ...x, unitId: vinculos[x.id] } : x));
            await prisma.setting.update({ where: { key: "BARRIO_MAP" }, data: { value: JSON.stringify(d) } });
        }
        return { ok: true, creadas, vinculadas, omitidas };
    } catch (e: any) {
        console.error("[crearUnidadesDesdeLotes] fallo:", e);
        return { ok: false, error: String(e?.message || e), creadas: 0, vinculadas: 0, omitidas: 0 };
    }
}
