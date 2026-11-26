"use server";

import { prisma } from "@/lib/prisma";
import { masParecidas, type Parecida } from "@/lib/chapas-parecidas";

/**
 * Buscar las matrículas más parecidas a una (26/11, Nico: «a veces un carácter no se detecta bien,
 * pero tenemos que poder buscar las más parecidas y sugerir el auto correcto»). La distancia pesa
 * las confusiones del OCR (8/B, 0/O, 1/I…): ver lib/chapas-parecidas.
 *
 * Dos fuentes, y se dicen por separado porque no valen lo mismo: el PADRÓN (es la chapa de alguien
 * y se sabe de quién) y lo que se LEYÓ en los últimos días (se vio pasar, quizá muchas veces). Sólo
 * lectura: corregir un evento sigue siendo «Cargar matrícula» (setEventPlate).
 */
export type DelPadron = { plate: string; nombre: string; rol: string; unidad: string | null; userId: string; vip: boolean };
export type Vista = { plate: string; veces: number; ultima: string };

const DIAS_VISTAS = 30;
const limpia = (p: string) => String(p || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

async function padron(): Promise<DelPadron[]> {
    const creds = await prisma.credential.findMany({
        where: { type: "PLATE" },
        select: { value: true, user: { select: { id: true, name: true, role: true, vip: true, unit: { select: { name: true } } } } },
    });
    return creds.filter((c) => c.user).map((c) => ({ plate: limpia(c.value), nombre: c.user!.name, rol: String(c.user!.role), unidad: c.user!.unit?.name || null, userId: c.user!.id, vip: !!c.user!.vip }));
}

/** La búsqueda del monitor: las parecidas del padrón y las parecidas que se leyeron. */
export async function buscarParecidas(consulta: string): Promise<{ padron: Parecida<DelPadron>[]; vistas: Parecida<Vista>[] }> {
    const q = limpia(consulta);
    if (q.length < 4) return { padron: [], vistas: [] };
    const desde = new Date(Date.now() - DIAS_VISTAS * 86_400_000);
    const [p, leidas] = await Promise.all([
        padron(),
        prisma.accessEvent.groupBy({ by: ["plateDetected"], where: { accessType: "PLATE", timestamp: { gte: desde }, plateDetected: { not: null } }, _count: { _all: true }, _max: { timestamp: true } }),
    ]);
    const enPadron = new Set(p.map((x) => x.plate));
    const vistas: Vista[] = leidas.filter((l) => l.plateDetected && !enPadron.has(limpia(l.plateDetected)))
        .map((l) => ({ plate: limpia(l.plateDetected!), veces: l._count._all, ultima: (l._max.timestamp || desde).toISOString() }));
    return { padron: masParecidas(q, p, 6), vistas: masParecidas(q, vistas, 4) };
}

/**
 * Para las lecturas del monitor que no son de nadie: la chapa del padrón que más se parece, si hay
 * una sola clara. «Clara» = la mejor está bien cerca y la segunda no le empata: con dos candidatas
 * igual de parecidas no se sugiere ninguna, porque sugerir es casi decidir.
 */
export async function sugerenciasParecidas(plates: string[]): Promise<Record<string, Parecida<DelPadron>>> {
    const lista = [...new Set((Array.isArray(plates) ? plates : []).map(limpia).filter((x) => x.length >= 5))].slice(0, 60);
    if (!lista.length) return {};
    const p = await padron();
    const enPadron = new Set(p.map((x) => x.plate));
    const out: Record<string, Parecida<DelPadron>> = {};
    for (const q of lista) {
        if (enPadron.has(q)) continue;
        const [a, b] = masParecidas(q, p, 2, 1);
        if (a && (!b || b.costo - a.costo >= 0.3)) out[q] = a;
    }
    return out;
}
