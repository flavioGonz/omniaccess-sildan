import { prisma } from "@/lib/prisma";

// En San Nicolás se dibujaron 81 lotes en el mapa antes de cargar una sola unidad: el
// operador dibuja primero, porque el plano es lo que tiene a mano, y el catastro queda
// vacío. Cargar 81 unidades a mano para después vincularlas una por una al lote es el
// trabajo que esto ahorra. Es idempotente: un lote que ya tiene unidad se saltea, y una
// unidad que ya se llama como el lote se vincula en vez de duplicarse.
//
// Lee los lotes directo de la Setting (no de la action getBarrioMap) para no depender
// de "use server" y poder correr desde un script.
export type ResultadoCatastro = { ok: boolean; error?: string; creadas: number; vinculadas: number; omitidas: number };

export async function crearUnidadesDesdeLotes(opts?: { parentId?: string | null; soloMirar?: boolean }): Promise<ResultadoCatastro> {
    try {
        const row = await prisma.setting.findUnique({ where: { key: "BARRIO_MAP" } });
        const d = row?.value ? JSON.parse(row.value) : {};
        // `lotes` es el modelo vigente; `lots` el viejo de San Nicolás (ver actions/barriomap.ts).
        const key = Array.isArray(d.lotes) ? "lotes" : "lots";
        const arr: any[] = Array.isArray(d[key]) ? d[key] : [];

        const existentes = await prisma.unit.findMany({ select: { id: true, name: true, parentId: true } });
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
            porNombre.set(nombre.toLowerCase(), { id: u.id, name: nombre, parentId: padre?.id ?? null });
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
