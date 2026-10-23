import { prisma } from "@/lib/prisma";

/**
 * Dónde está ya una matrícula (21/10, Nico: «al agregar una matrícula, ya sea lista de residentes,
 * proveedores, lista negra, etc., debe cotejar si ya no existe en la base»).
 *
 * Cada pantalla de alta miraba sólo su tabla, y mal: la lista negra hacía upsert y no avisaba que la
 * chapa ya estaba; el padrón chocaba contra el `@unique` de Vehicle recién al guardar, y sólo con la
 * chapa escrita igual — «SDC 9058» y «SDC9058» pasaban como dos. Acá se mira TODO, por la chapa
 * normalizada (mayúsculas, sólo letras y números):
 *   · padrón: el vehículo y la credencial de matrícula de una persona (con su rol y su unidad);
 *   · vigilancia: lista negra, en búsqueda, VIP, lista blanca — activa o dada de baja;
 *   · invitados: la chapa de un invitado con un pase vigente.
 * La pantalla lo muestra mientras se escribe (components/registro/MatriculaEnBase) y decide; no
 * se bloquea nada desde acá: un residente puede terminar en lista negra a propósito.
 */
export type RegistroMatricula = {
    donde: "padron" | "vigilancia" | "invitado";
    /** «Vehículo de Juan Pérez», «Lista negra», «Invitado de Lote 12». */
    titulo: string;
    /** «Residente · Lote 12», «activa · Robo en Lote 12», «dada de baja». */
    detalle: string | null;
    tono: "mal" | "aviso" | "info" | "quieto";
    userId?: string | null;
    /** Para abrir el registro: la ficha de la persona, la lista. */
    href?: string | null;
    /** Vigilancia: la categoría (BLACKLISTED, SEARCH, VIP…) y si está activa. */
    categoria?: string | null;
    activa?: boolean;
};

const ROL: Record<string, string> = {
    RESIDENT: "Residente", PROVIDER: "Proveedor", VISITOR: "Visita", TEMPORARY_VISITOR: "Visita", STAFF: "Personal",
    SECURITY: "Seguridad", OPERATOR: "Operador", ADMIN: "Administrador", WHITELISTED: "Lista blanca", BLACKLISTED: "Lista negra",
};
const VIGILANCIA: Record<string, { nombre: string; tono: RegistroMatricula["tono"] }> = {
    BLACKLISTED: { nombre: "Lista negra", tono: "mal" }, SEARCH: { nombre: "En búsqueda", tono: "mal" },
    VIP: { nombre: "VIP", tono: "info" }, WHITELISTED: { nombre: "Lista blanca", tono: "info" },
};

export const normalizarChapa = (p: unknown) => String(p || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

export async function dondeEstanMatriculas(plates: string[], opts: { excluirUserId?: string | null } = {}): Promise<Record<string, RegistroMatricula[]>> {
    const lista = [...new Set(plates.map(normalizarChapa).filter((p) => p.length >= 4))].slice(0, 30);
    const out: Record<string, RegistroMatricula[]> = Object.fromEntries(lista.map((p) => [p, []]));
    if (!lista.length) return out;
    type Fila = { p: string; userId: string | null; nombre: string | null; rol: string | null; unidad: string | null };
    const [vehiculos, credenciales, vigilancia, invitados] = await Promise.all([
        prisma.$queryRaw<Fila[]>`
            SELECT upper(regexp_replace(v.plate, '[^A-Za-z0-9]', '', 'g')) AS p, u.id AS "userId", u.name AS nombre, u.role::text AS rol, un.name AS unidad
              FROM "Vehicle" v LEFT JOIN "User" u ON u.id = v."userId" LEFT JOIN "Unit" un ON un.id = u."unitId"
             WHERE upper(regexp_replace(v.plate, '[^A-Za-z0-9]', '', 'g')) = ANY(${lista})`.catch(() => [] as Fila[]),
        prisma.$queryRaw<Fila[]>`
            SELECT upper(regexp_replace(c.value, '[^A-Za-z0-9]', '', 'g')) AS p, u.id AS "userId", u.name AS nombre, u.role::text AS rol, un.name AS unidad
              FROM "Credential" c LEFT JOIN "User" u ON u.id = c."userId" LEFT JOIN "Unit" un ON un.id = u."unitId"
             WHERE c.type = 'PLATE' AND upper(regexp_replace(c.value, '[^A-Za-z0-9]', '', 'g')) = ANY(${lista})`.catch(() => [] as Fila[]),
        prisma.$queryRaw<{ p: string; category: string; active: boolean; motivo: string | null; label: string | null }[]>`
            SELECT upper(regexp_replace(plate, '[^A-Za-z0-9]', '', 'g')) AS p, category::text AS category, active, motivo, label
              FROM "PlateWatch" WHERE upper(regexp_replace(plate, '[^A-Za-z0-9]', '', 'g')) = ANY(${lista})`.catch(() => []),
        prisma.guestPlate.findMany({
            where: { guest: { invitation: { status: "ACTIVE" as any, validTo: { gte: new Date() } } } },
            select: { plate: true, guest: { select: { name: true, invitation: { select: { hostName: true, hostLabel: true } } } } },
            take: 2000,
        }).catch(() => []),
    ]);
    // Una persona con vehículo Y credencial de la misma chapa es un registro, no dos.
    const vistos = new Set<string>();
    for (const f of [...vehiculos, ...credenciales]) {
        if (!out[f.p] || (opts.excluirUserId && f.userId === opts.excluirUserId)) continue;
        const k = `${f.p}:${f.userId || "-"}`;
        if (vistos.has(k)) continue;
        vistos.add(k);
        out[f.p].push({
            donde: "padron", titulo: f.nombre ? `Padrón · ${f.nombre}` : "Padrón · sin persona",
            detalle: [f.rol ? ROL[f.rol] || f.rol : null, f.unidad].filter(Boolean).join(" · ") || null,
            tono: f.rol === "BLACKLISTED" ? "mal" : "aviso", userId: f.userId,
        });
    }
    for (const w of vigilancia) {
        if (!out[w.p]) continue;
        const c = VIGILANCIA[w.category] || { nombre: w.category, tono: "aviso" as const };
        out[w.p].push({
            donde: "vigilancia", titulo: c.nombre,
            detalle: [w.active ? "activa" : "dada de baja", w.motivo || w.label || null].filter(Boolean).join(" · "),
            tono: w.active ? c.tono : "quieto", href: "/admin/users?tab=listanegra", categoria: w.category, activa: w.active,
        });
    }
    for (const g of invitados) {
        const p = normalizarChapa(g.plate);
        if (!out[p]) continue;
        const inv = g.guest.invitation;
        out[p].push({ donde: "invitado", titulo: `Invitado${g.guest.name ? ` · ${g.guest.name}` : ""}`, detalle: inv?.hostLabel || inv?.hostName || "pase vigente", tono: "info" });
    }
    return out;
}
