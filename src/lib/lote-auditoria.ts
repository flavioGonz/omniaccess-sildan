import { prisma } from "@/lib/prisma";
import { getSession } from "@/app/actions/auth";
import { compararLote, estadoDeLotes, leerEstado, limpiarChapa, ESTADO_VACIO, type Cambio, type QueCambio } from "@/lib/lote-cambios";

/**
 * La auditoría de los lotes: la mitad que toca la base (el porqué está en lote-cambios.ts).
 *
 * `auditarLotes` saca la foto de hoy —quién figura en cada lote y con qué matrículas—, la compara
 * con la última guardada, anota lo que difiere y guarda la foto nueva. La llaman los caminos que
 * saben quién hizo el cambio (el panel, el censo, la planilla) apenas terminan, con su firma; y la
 * llama sin firma el proceso de despachos cada minuto, por todo lo demás.
 *
 * Tres reglas:
 *  · **Nunca rompe a quien la llama.** Es un registro: si falla, el residente igual se guardó.
 *  · **De a una.** Dos pasadas a la vez anotarían el mismo cambio dos veces: un candado de la base
 *    las pone en fila.
 *  · **La primera vez no anota nada.** Sin eso, el día que esto se instala el historial de cada
 *    lote arrancaría con «entró al lote» de toda su gente, todo con la misma hora y todo mentira.
 */

/** El ajuste que dice desde cuándo se audita. Mientras no existe, la pasada sólo saca la primera foto. */
const DESDE = "LOTES_AUDITADOS_DESDE";
/** Un número cualquiera, fijo: es el nombre del candado en la base. */
const CANDADO = 20261121;

export type Firma = { quien?: string | null; origen?: "panel" | "censo" | "padron" | "sistema" };

export async function auditarLotes(o: Firma & {
    /** Sólo los lotes donde figuran (o figuraban) estas personas. Sin esto, todos. */
    personas?: string[];
} = {}): Promise<{ lotes: number; cambios: number; primera?: boolean }> {
    try {
        return await prisma.$transaction(async (tx) => {
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(${CANDADO})`;
            const [gente, fotos, desde] = await Promise.all([
                tx.user.findMany({
                    where: { OR: [{ unitId: { not: null } }, { vinculos: { some: {} } }] },
                    select: { id: true, name: true, unitId: true, vinculos: { select: { unitId: true } }, vehicles: { select: { plate: true } }, credentials: { where: { type: "PLATE" }, select: { value: true } } },
                }),
                tx.loteEstado.findMany(),
                tx.setting.findUnique({ where: { key: DESDE } }),
            ]);
            const hoy = estadoDeLotes(gente.map((u) => ({
                id: u.id, nombre: u.name,
                lotes: [u.unitId || "", ...u.vinculos.map((v) => v.unitId)],
                chapas: [...u.vehicles.map((v) => v.plate), ...u.credentials.map((c) => c.value)],
            })));
            const antes = new Map(fotos.map((f) => [f.unitId, leerEstado(f.personas, f.chapas)]));
            const primera = !desde;

            let lotes = [...new Set([...hoy.keys(), ...antes.keys()])];
            if (o.personas?.length && !primera) {
                const ellas = new Set(o.personas);
                lotes = lotes.filter((id) => [...(hoy.get(id)?.personas || []), ...(antes.get(id)?.personas || [])].some((p) => ellas.has(p.id)));
            }

            let cambios = 0;
            for (const unitId of lotes) {
                const ahora = hoy.get(unitId) ?? ESTADO_VACIO;
                const dif = primera ? [] : compararLote(antes.get(unitId) ?? ESTADO_VACIO, ahora);
                if (!primera && !dif.length && antes.has(unitId)) continue;
                if (dif.length) {
                    await tx.cambioLote.createMany({ data: dif.map((c) => fila(unitId, c, o)) });
                    cambios += dif.length;
                }
                await tx.loteEstado.upsert({
                    where: { unitId }, update: { personas: ahora.personas, chapas: ahora.chapas, vistoAt: new Date() },
                    create: { unitId, personas: ahora.personas, chapas: ahora.chapas },
                });
            }
            if (primera) await tx.setting.create({ data: { key: DESDE, value: new Date().toISOString() } });
            return { lotes: lotes.length, cambios, primera };
        }, { timeout: 30_000, maxWait: 15_000 });
    } catch (e) {
        /* Un lote borrado entre la lectura y la escritura, la base ocupada: se anota en el registro
           del proceso y la próxima pasada lo vuelve a intentar. A quien llamó no le llega nada. */
        console.error("[lotes] la auditoría no pudo correr:", e instanceof Error ? e.message.slice(0, 200) : e);
        return { lotes: 0, cambios: 0 };
    }
}

const fila = (unitId: string, c: Cambio, f: Firma) => ({
    unitId, que: c.que, chapa: c.chapa ?? null, persona: c.persona?.slice(0, 120) ?? null, userId: c.userId ?? null,
    quien: f.quien?.slice(0, 120) || null, origen: f.origen || "sistema", detalle: c.detalle?.slice(0, 500) ?? null,
});

/** Algo que no sale de comparar fotos: una carga del censo, un código cambiado. Tampoco rompe. */
export async function anotarEnLote(unitIds: (string | null | undefined)[], c: { que: QueCambio; persona?: string; userId?: string; chapa?: string; detalle?: string }, f: Firma): Promise<void> {
    const lotes = [...new Set(unitIds.filter((x): x is string => !!x))];
    if (!lotes.length) return;
    // Sólo los que existen: una invitación puede nombrar un lote que después se borró.
    const hay = await prisma.unit.findMany({ where: { id: { in: lotes } }, select: { id: true } }).catch(() => []);
    if (!hay.length) return;
    await prisma.cambioLote.createMany({ data: hay.map((u) => fila(u.id, c, f)) }).catch((e) => console.error("[lotes] no se pudo anotar:", e instanceof Error ? e.message.slice(0, 160) : e));
}

/** Las matrículas con las que hoy entra la gente de un lote. */
export async function chapasDelLote(unitId: string): Promise<string[]> {
    const gente = await prisma.user.findMany({
        where: { OR: [{ unitId }, { vinculos: { some: { unitId } } }] },
        select: { vehicles: { select: { plate: true } }, credentials: { where: { type: "PLATE" }, select: { value: true } } },
    }).catch(() => []);
    return [...new Set(gente.flatMap((u) => [...u.vehicles.map((v) => v.plate), ...u.credentials.map((c) => c.value)]).map(limpiarChapa).filter(Boolean))].sort();
}

/** Quién está en el panel, para firmar. Sin sesión (un proceso, un webhook) no hay firma. */
async function operador(): Promise<string | null> {
    try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- la sesión es el JWT crudo
        const s: any = await getSession();
        return s ? String(s.name || s.sub || "") || null : null;
    } catch { return null; }
}

/**
 * Lo que llaman las acciones del panel al terminar de tocar una persona, un vehículo o una
 * credencial: compara y firma con quien está en la sesión. Si no hay sesión —la misma acción
 * llamada desde un proceso— queda sin firma, que es la verdad.
 */
export async function auditarLotesDesdeElPanel(personas?: (string | null | undefined)[]): Promise<void> {
    const quien = await operador();
    const ids = personas?.filter((x): x is string => !!x);
    await auditarLotes({ quien, origen: quien ? "panel" : "sistema", personas: ids?.length ? ids : undefined });
}
