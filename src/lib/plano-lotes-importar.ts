import fs from "node:fs";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { coordenadasDeTexto, leerPlanoLotes, planoALatLng } from "@/lib/plano-lotes";

/**
 * Carga el croquis de los lotes (ver lib/plano-lotes): la imagen y `lotes-plano.json` viven en la
 * carpeta de planos del servidor (`PLANOS_DIR`, por defecto `planos/` junto a la aplicación, fuera
 * de git: es el dibujo de un barrio, no código).
 *
 * Qué hace, y qué no:
 *   · Guarda el croquis en la Setting PLANO_LOTES (título, tamaño, calibración).
 *   · A cada lote que encuentra POR NOMBRE («A 2 (4-5)») le pone su punto del croquis. Si el lote no
 *     tenía coordenadas, le pone también su latitud y longitud; si ya tenía, no se las toca (las pudo
 *     haber marcado el vecino en el censo, que estuvo ahí).
 *   · No crea lotes ni borra nada. Los que no encuentra los nombra.
 * Es idempotente: correrlo dos veces da lo mismo.
 */
export const carpetaPlanos = () => process.env.PLANOS_DIR || path.join(process.cwd(), "planos");

export type InformePlano = { lotes: number; ubicados: number; conCoordenadasNuevas: number; yaTenianCoordenadas: number; sinLote: string[]; iguales: number };

export async function importarPlanoLotes(o: { simulacro: boolean }): Promise<InformePlano> {
    const crudo = JSON.parse(fs.readFileSync(path.join(carpetaPlanos(), "lotes-plano.json"), "utf8"));
    const plano = leerPlanoLotes(crudo);
    if (!plano) throw new Error("lotes-plano.json no tiene la forma esperada (archivo, ancho, alto).");
    if (!fs.existsSync(path.join(carpetaPlanos(), plano.archivo))) throw new Error(`Falta la imagen ${plano.archivo} en ${carpetaPlanos()}.`);
    const lotes: { nombre: string; x: number; y: number }[] = (Array.isArray(crudo.lotes) ? crudo.lotes : [])
        .filter((l: { nombre?: unknown; x?: unknown; y?: unknown }) => typeof l?.nombre === "string" && Number.isFinite(l.x) && Number.isFinite(l.y));
    const unidades = await prisma.unit.findMany({ where: { name: { in: lotes.map((l) => l.nombre) } }, select: { id: true, name: true, coordinates: true, planoX: true, planoY: true } });
    const porNombre = new Map(unidades.map((u) => [u.name, u]));
    const inf: InformePlano = { lotes: lotes.length, ubicados: 0, conCoordenadasNuevas: 0, yaTenianCoordenadas: 0, sinLote: [], iguales: 0 };
    const cambios: { id: string; data: { planoX: number; planoY: number; coordinates?: string } }[] = [];
    for (const l of lotes) {
        const u = porNombre.get(l.nombre);
        if (!u) { inf.sinLote.push(l.nombre); continue; }
        inf.ubicados++;
        const data: { planoX: number; planoY: number; coordinates?: string } = { planoX: l.x, planoY: l.y };
        if (plano.georef && !u.coordinates?.trim()) { data.coordinates = coordenadasDeTexto(planoALatLng(l.x, l.y, plano.georef)); inf.conCoordenadasNuevas++; }
        else if (u.coordinates?.trim()) inf.yaTenianCoordenadas++;
        if (u.planoX === l.x && u.planoY === l.y && !data.coordinates) { inf.iguales++; continue; }
        cambios.push({ id: u.id, data });
    }
    if (!o.simulacro) {
        const { lotes: _fuera, ...ajuste } = crudo;   // la Setting lleva el croquis y su calibración; los puntos ya quedan en cada lote
        void _fuera;
        await prisma.setting.upsert({ where: { key: "PLANO_LOTES" }, create: { key: "PLANO_LOTES", value: JSON.stringify(ajuste) }, update: { value: JSON.stringify(ajuste) } });
        for (let i = 0; i < cambios.length; i += 50) await prisma.$transaction(cambios.slice(i, i + 50).map((c) => prisma.unit.update({ where: { id: c.id }, data: c.data })));
    }
    return inf;
}
