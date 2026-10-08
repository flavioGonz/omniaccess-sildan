import { prisma } from "@/lib/prisma";
import { normalizarMatricula } from "@/lib/lista-negra";
import { avisarPorSocket } from "@/lib/avisar";
import type { TipoAviso } from "./presentacion";

/**
 * Las operaciones de las visitas y los avisos sobre la base, y el aviso por socket de cada
 * cambio. Las usan el motor (en cada lectura), el tick (cada minuto) y las acciones de la
 * consola del guardia: un solo lugar que abre, cierra, extiende y avisa.
 */

export const chapa = (p: string | null | undefined) => normalizarMatricula(p) || null;

/** Lo que la cámara manda cuando NO leyó una chapa: no es una matrícula. Mismo criterio que el monitor. */
const NO_ES_CHAPA = new Set(["", "NOLEIDA", "NOLEIDO", "UNKNOWN", "SINLECTURA", "SINMATRICULA", "NONE", "NULL"]);
export const esChapa = (p: string | null | undefined): p is string => !!p && !NO_ES_CHAPA.has(p);

export type PorQueRegistrada = "padron" | "visita" | "invitacion" | "lista_blanca";

/**
 * ¿Qué matrículas de esta lista están "registradas"? Padrón (credencial o vehículo), visita en
 * curso, invitación vigente o lista blanca. En lote, porque el monitor pregunta por treinta a
 * la vez y una consulta por matrícula serían treinta.
 */
export async function registradas(plates: (string | null | undefined)[]): Promise<Map<string, PorQueRegistrada>> {
    const lista = [...new Set(plates.map(chapa).filter(esChapa))];
    const out = new Map<string, PorQueRegistrada>();
    if (!lista.length) return out;
    const ahora = new Date();
    const [creds, vehiculos, visitas, invitados, blancas] = await Promise.all([
        padronDe(lista).then((s) => [...s].map((value) => ({ value }))).catch(() => [] as { value: string }[]),
        Promise.resolve([] as { plate: string }[]),
        prisma.visita.findMany({ where: { plate: { in: lista }, sale: null }, select: { plate: true } }).catch(() => []),
        prisma.guestPlate.findMany({ where: { plate: { in: lista }, guest: { invitation: { status: "ACTIVE" as any, validFrom: { lte: ahora }, validTo: { gte: ahora } } } }, select: { plate: true } }).catch(() => []),
        prisma.plateWatch.findMany({ where: { plate: { in: lista }, active: true, category: "WHITELISTED" }, select: { plate: true } }).catch(() => []),
    ]);
    for (const c of creds) out.set(chapa(c.value)!, "padron");
    for (const v of vehiculos) out.set(chapa(v.plate)!, "padron");
    for (const v of visitas) if (v.plate && !out.has(v.plate)) out.set(v.plate, "visita");
    for (const g of invitados) { const p = chapa(g.plate)!; if (!out.has(p)) out.set(p, "invitacion"); }
    for (const b of blancas) { const p = chapa(b.plate)!; if (!out.has(p)) out.set(p, "lista_blanca"); }
    return out;
}

export async function estaRegistrada(plate: string | null | undefined): Promise<PorQueRegistrada | null> {
    const p = chapa(plate);
    if (!esChapa(p)) return null;
    return (await registradas([p])).get(p) || null;
}

/** ¿Está en el padrón? (credencial PLATE o vehículo) */
export async function enPadron(plates: string[]): Promise<Set<string>> {
    const lista = [...new Set(plates.map(chapa).filter(esChapa))];
    if (!lista.length) return new Set();
    return padronDe(lista);
}

/**
 * Las matrículas del padrón entre `lista`, comparando normalizado de los dos lados: una
 * credencial cargada como "SDC 9058" es la misma chapa que la cámara lee "SDC9058".
 */
async function padronDe(lista: string[]): Promise<Set<string>> {
    const filas = await prisma.$queryRaw<{ p: string }[]>`
        SELECT upper(regexp_replace(value, '[^A-Za-z0-9]', '', 'g')) AS p FROM "Credential"
         WHERE type = 'PLATE' AND upper(regexp_replace(value, '[^A-Za-z0-9]', '', 'g')) = ANY(${lista})
        UNION
        SELECT upper(regexp_replace(plate, '[^A-Za-z0-9]', '', 'g')) AS p FROM "Vehicle"
         WHERE upper(regexp_replace(plate, '[^A-Za-z0-9]', '', 'g')) = ANY(${lista})`;
    return new Set(filas.map((f) => f.p));
}

// ─────────────────────────────── Visitas ───────────────────────────────

export type NuevaVisita = {
    plate?: string | null; tipo: string; minutos: number; unitId?: string | null; loteNombre?: string | null;
    nombre?: string | null; empresa?: string | null; origen: "GUARDIA" | "INVITACION"; registradaPor?: string | null;
    invitationId?: string | null; entra?: Date; vence?: Date; accessEventEntradaId?: string | null;
};

export async function visitaEnCurso(plate: string | null | undefined) {
    const p = chapa(plate);
    if (!esChapa(p)) return null;
    return prisma.visita.findFirst({ where: { plate: p, sale: null }, orderBy: { entra: "desc" } });
}

export async function abrirVisita(v: NuevaVisita) {
    const entra = v.entra || new Date();
    const visita = await prisma.visita.create({
        data: {
            plate: esChapa(chapa(v.plate)) ? chapa(v.plate) : null, tipo: v.tipo, unitId: v.unitId || null, loteNombre: v.loteNombre || null,
            nombre: v.nombre?.trim() || null, empresa: v.empresa?.trim() || null, origen: v.origen, registradaPor: v.registradaPor || null,
            invitationId: v.invitationId || null, entra, vence: v.vence || new Date(entra.getTime() + v.minutos * 60_000),
            accessEventEntradaId: v.accessEventEntradaId || null,
        },
    });
    avisarPorSocket("visita", { accion: "alta", visita });
    return visita;
}

export async function cerrarVisita(id: string, c: { cierre: "CAMARA_SALIDA" | "GUARDIA" | "FIN_DEL_DIA"; por?: string | null; accessEventId?: string | null; sale?: Date }) {
    const v = await prisma.visita.updateMany({
        where: { id, sale: null },
        data: { sale: c.sale || new Date(), cierre: c.cierre, cerradaPor: c.por || null, accessEventSalidaId: c.accessEventId || null },
    });
    if (!v.count) return null;
    const visita = await prisma.visita.findUnique({ where: { id } });
    // Un aviso de excedida que quedó pendiente ya no tiene a quién avisar: la visita se fue.
    await prisma.avisoGuardia.updateMany({ where: { visitaId: id, atendidoAt: null }, data: { atendidoAt: new Date(), atendidoPor: c.cierre === "GUARDIA" ? c.por || "guardia" : "sistema", nota: "La visita se cerró" } }).catch(() => { });
    avisarPorSocket("visita", { accion: "cierre", visita });
    return visita;
}

export async function extenderVisita(id: string, minutos: number, quien: string | null) {
    const v = await prisma.visita.findUnique({ where: { id } });
    if (!v || v.sale) return null;
    const ahora = new Date();
    // Si ya venció, se extiende desde AHORA: extender 10 min un delivery que lleva 2 de más
    // tiene que dejarle 10 por delante, no 8.
    const base = v.vence.getTime() < ahora.getTime() ? ahora : v.vence;
    const extensiones = [...((v.extensiones as any[]) || []), { quien, minutos, cuando: ahora.toISOString() }];
    const visita = await prisma.visita.update({ where: { id }, data: { vence: new Date(base.getTime() + minutos * 60_000), extensiones, avisadaExcedidaAt: null } });
    await prisma.avisoGuardia.updateMany({ where: { visitaId: id, tipo: "VISITA_EXCEDIDA", atendidoAt: null }, data: { atendidoAt: ahora, atendidoPor: quien || "guardia", nota: `Extendida ${minutos} min` } }).catch(() => { });
    avisarPorSocket("visita", { accion: "cambio", visita });
    return visita;
}

// ─────────────────────────────── Avisos ───────────────────────────────

export type NuevoAviso = { tipo: TipoAviso; motivo: string; plate?: string | null; visitaId?: string | null; accessEventId?: string | null; camara?: string | null; datos?: any };

/**
 * Crea un aviso salvo que ya haya uno igual (mismo tipo y misma matrícula o visita) sin
 * atender o creado dentro de la ventana. El chequeo y la creación van dentro de una
 * transacción con un candado de Postgres por clave: la lectura y el tick pueden querer crear el
 * mismo aviso a la vez, y "buscar y después crear" sin candado deja pasar los dos.
 */
export async function crearAviso(a: NuevoAviso, ventanaMin: number) {
    const plate = esChapa(chapa(a.plate)) ? chapa(a.plate) : null;
    const clave = `aviso:${a.tipo}:${a.visitaId || plate || "-"}`;
    const desde = new Date(Date.now() - ventanaMin * 60_000);
    const creado = await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${clave}))`;
        const previo = await tx.avisoGuardia.findFirst({
            where: {
                tipo: a.tipo,
                ...(a.visitaId ? { visitaId: a.visitaId } : { plate }),
                OR: [{ atendidoAt: null }, { creado: { gte: desde } }],
            },
            select: { id: true },
        });
        if (previo) return null;
        return tx.avisoGuardia.create({ data: { tipo: a.tipo, motivo: a.motivo, plate, visitaId: a.visitaId || null, accessEventId: a.accessEventId || null, camara: a.camara || null, datos: a.datos ?? undefined } });
    });
    if (creado) avisarPorSocket("aviso_guardia", { accion: "nuevo", aviso: creado });
    return creado;
}

export async function atenderAviso(id: string, quien: string | null, nota?: string | null) {
    const r = await prisma.avisoGuardia.updateMany({ where: { id, atendidoAt: null }, data: { atendidoAt: new Date(), atendidoPor: quien || "guardia", nota: nota?.trim() || null } });
    if (!r.count) return null;
    const aviso = await prisma.avisoGuardia.findUnique({ where: { id } });
    avisarPorSocket("aviso_guardia", { accion: "atendido", aviso });
    return aviso;
}
