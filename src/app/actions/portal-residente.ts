"use server";

import { prisma } from "@/lib/prisma";
import { getPortalHost } from "@/app/actions/invitations";
import { anotarEnLote } from "@/lib/lote-auditoria";
import { limpiarChapa } from "@/lib/lote-cambios";
import { normalizarChapa } from "@/lib/formato-chapa";
import { cuandoViene, ordenarDias, rotuloServicio, TIPOS_SERVICIO } from "@/lib/servicios-lote";

/**
 * El portal del residente, todo junto (26/11). Nico: «que el registro del lote y las invitaciones QR
 * sean bajo el mismo sistema y el mismo panel: poder invitar, gestionar tus matrículas, etc., en el
 * mismo que ya tenemos». Antes el portal sólo tenía invitaciones, y el censo era otro enlace que una
 * vez enviado no servía para nada más.
 *
 * Todo entra por el token personal del portal (el mismo de /residente/<token>): cada acción lo valida
 * y trabaja sólo sobre la persona que nombra. Nada de lo que se pide acá cambia el padrón: un pedido
 * de matrícula queda pendiente hasta que la administración lo aprueba en la bandeja del censo.
 */

export type PersonaDelLote = { id: string; nombre: string; vinculo: string; yo: boolean };
export type ChapaDelLote = { chapa: string; de: string; mia: boolean };
/** Un servicio del lote, como lo ve el residente: sin documento ni teléfono del proveedor (eso es de la administración). */
export type ServicioVisto = { id: string; tipo: string; rotulo: string; nombre: string; cuando: string; chapa: string | null; entra: boolean };
export type PedidoVisto = { id: string; tipo: string; chapa: string | null; estado: string; motivo: string | null; createdAt: string; detalle: Record<string, string> };
export type MiPortal = {
    nombre: string; email: string | null; telefono: string | null;
    lote: { id: string; nombre: string; administracion: string | null; titular: string | null } | null;
    otrosLotes: string[];
    gente: PersonaDelLote[];
    chapas: ChapaDelLote[];
    pedidos: PedidoVisto[];
    servicios: ServicioVisto[];
    /** Su enlace del censo (el del lote, o su copia), y en qué está la carga de su lote. */
    censo: { enlace: string | null; estado: "sin-cargar" | "esperando" | "aprobado"; cuando: string | null };
};

async function quien(token: string) {
    const host = await getPortalHost(token);
    if (!host) return null;
    const u = await prisma.user.findUnique({
        where: { id: host.userId },
        select: { id: true, name: true, email: true, phone: true, unitId: true, vinculos: { select: { unitId: true, vinculo: true, unit: { select: { id: true, name: true, titular: true, administracion: { select: { nombre: true } } } } }, orderBy: { createdAt: "asc" } } },
    });
    return u;
}

/** Todo lo que muestra el portal además de las invitaciones. */
export async function miPortal(token: string): Promise<{ ok: boolean; datos?: MiPortal }> {
    const u = await quien(token);
    if (!u) return { ok: false };
    const principal = u.vinculos.find((v) => v.unitId === u.unitId) || u.vinculos[0] || null;
    const lote = principal?.unit || null;
    const [gente, pedidos, inv, copia, cargas, servicios] = await Promise.all([
        lote ? prisma.userUnidad.findMany({
            where: { unitId: lote.id }, orderBy: { createdAt: "asc" },
            select: { vinculo: true, user: { select: { id: true, name: true, vehicles: { select: { plate: true } }, credentials: { where: { type: "PLATE" }, select: { value: true } } } } },
        }) : Promise.resolve([]),
        prisma.pedidoResidente.findMany({ where: { userId: u.id }, orderBy: { createdAt: "desc" }, take: 30 }),
        lote ? prisma.invitacionCenso.findFirst({ where: { sitio: "", unitId: lote.id }, select: { id: true, clave: true, userId: true } }) : Promise.resolve(null),
        lote ? prisma.copiaCenso.findFirst({ where: { userId: u.id, invitacion: { unitId: lote.id } }, select: { id: true } }) : Promise.resolve(null),
        lote ? prisma.solicitudPadron.findMany({ where: { unitId: lote.id, estado: { in: ["pendiente", "aprobada"] } }, orderBy: { createdAt: "desc" }, take: 1, select: { estado: true, createdAt: true } }) : Promise.resolve([]),
        lote ? prisma.servicioLote.findMany({ where: { unitId: lote.id, estado: "ACTIVO" }, orderBy: [{ tipo: "asc" }, { createdAt: "asc" }], select: { id: true, tipo: true, nombre: true, dias: true, desde: true, hasta: true, chapa: true, autorizado: true } }) : Promise.resolve([]),
    ]);
    const enlace = inv ? (inv.userId === u.id || !copia ? `/registro/${inv.clave}` : `/registro/${inv.clave}?de=${copia.id}`) : null;
    const chapas: ChapaDelLote[] = [];
    for (const g of gente) {
        for (const c of new Set([...g.user.vehicles.map((v) => v.plate), ...g.user.credentials.map((x) => x.value)].map(limpiarChapa).filter(Boolean))) {
            if (!chapas.some((x) => x.chapa === c)) chapas.push({ chapa: c, de: g.user.name, mia: g.user.id === u.id });
        }
    }
    return {
        ok: true,
        datos: {
            nombre: u.name, email: u.email, telefono: u.phone,
            lote: lote ? { id: lote.id, nombre: lote.name, administracion: lote.administracion?.nombre || null, titular: lote.titular } : null,
            otrosLotes: u.vinculos.filter((v) => v.unitId !== lote?.id).map((v) => v.unit.name),
            gente: gente.map((g) => ({ id: g.user.id, nombre: g.user.name, vinculo: g.vinculo, yo: g.user.id === u.id })),
            chapas: chapas.sort((a, b) => Number(b.mia) - Number(a.mia) || a.chapa.localeCompare(b.chapa)),
            pedidos: pedidos.map((p) => ({ id: p.id, tipo: p.tipo, chapa: p.chapa, estado: p.estado, motivo: p.motivo, createdAt: p.createdAt.toISOString(), detalle: (p.detalle || {}) as Record<string, string> })),
            servicios: servicios.map((sv) => ({ id: sv.id, tipo: sv.tipo, rotulo: rotuloServicio(sv.tipo), nombre: sv.nombre, cuando: cuandoViene(sv), chapa: sv.chapa, entra: sv.autorizado })),
            censo: { enlace, estado: cargas[0] ? (cargas[0].estado === "aprobada" ? "aprobado" : "esperando") : "sin-cargar", cuando: cargas[0]?.createdAt.toISOString() || null },
        },
    };
}

/**
 * Pedir sumar una matrícula. Queda pendiente: la aprueba la administración. Se rechaza en el momento
 * lo que no tiene forma de chapa, la que ya es del lote y la que ya está pedida.
 */
export async function pedirMatricula(token: string, d: { chapa: string; tipo?: string; marca?: string; color?: string; quien?: string }): Promise<{ ok: boolean; error?: string }> {
    const u = await quien(token);
    if (!u) return { ok: false, error: "Tu enlace ya no sirve: pedile uno nuevo a la administración." };
    const n = normalizarChapa(d.chapa);
    const chapa = n?.plate || limpiarChapa(d.chapa);
    if (chapa.length < 5 || chapa.length > 8) return { ok: false, error: "Esa matrícula no tiene forma de matrícula." };
    const unitId = u.unitId || u.vinculos[0]?.unitId || null;
    const ya = await prisma.credential.findFirst({ where: { type: "PLATE", value: chapa }, select: { userId: true } });
    if (ya?.userId === u.id) return { ok: false, error: `${chapa} ya está a tu nombre.` };
    const pedida = await prisma.pedidoResidente.findFirst({ where: { userId: u.id, chapa, estado: "PENDIENTE" }, select: { id: true } });
    if (pedida) return { ok: false, error: `Ya pediste ${chapa}: está esperando que la administración la apruebe.` };
    const corto = (t: unknown, n2 = 60) => String(t ?? "").replace(/\s+/g, " ").trim().slice(0, n2);
    await prisma.pedidoResidente.create({ data: { userId: u.id, unitId, tipo: "MATRICULA_ALTA", chapa, detalle: { tipo: corto(d.tipo, 20) || "PROPIO", marca: corto(d.marca), color: corto(d.color, 30), quien: corto(d.quien) } } });
    if (unitId) await anotarEnLote([unitId], { que: "CENSO_CARGA", persona: u.name, userId: u.id, chapa, detalle: `Pidió sumar ${chapa} desde su portal. Espera que la administración lo apruebe.` }, { quien: u.name, origen: "censo" });
    return { ok: true };
}

/** Pedir sacar una matrícula suya. También queda pendiente: dejar de abrir el portón es un cambio de padrón. */
export async function pedirBajaMatricula(token: string, chapa: string): Promise<{ ok: boolean; error?: string }> {
    const u = await quien(token);
    if (!u) return { ok: false, error: "Tu enlace ya no sirve: pedile uno nuevo a la administración." };
    const c = limpiarChapa(chapa);
    const suya = await prisma.credential.findFirst({ where: { type: "PLATE", value: c, userId: u.id }, select: { id: true } })
        || await prisma.vehicle.findFirst({ where: { plate: c, userId: u.id }, select: { id: true } });
    if (!suya) return { ok: false, error: `${c} no está a tu nombre: la puede pedir quien la tiene.` };
    const pedida = await prisma.pedidoResidente.findFirst({ where: { userId: u.id, chapa: c, estado: "PENDIENTE" }, select: { id: true } });
    if (pedida) return { ok: false, error: `Ya hay un pedido de ${c} esperando a la administración.` };
    const unitId = u.unitId || u.vinculos[0]?.unitId || null;
    await prisma.pedidoResidente.create({ data: { userId: u.id, unitId, tipo: "MATRICULA_BAJA", chapa: c } });
    if (unitId) await anotarEnLote([unitId], { que: "CENSO_CARGA", persona: u.name, userId: u.id, chapa: c, detalle: `Pidió sacar ${c} desde su portal. Espera que la administración lo apruebe.` }, { quien: u.name, origen: "censo" });
    return { ok: true };
}

/** Anular un pedido propio que todavía no se resolvió. */
export async function anularPedido(token: string, id: string): Promise<{ ok: boolean; error?: string }> {
    const u = await quien(token);
    if (!u) return { ok: false, error: "Tu enlace ya no sirve." };
    const r = await prisma.pedidoResidente.updateMany({ where: { id, userId: u.id, estado: "PENDIENTE" }, data: { estado: "RECHAZADO", motivo: "Lo anuló quien lo pidió.", resueltoAt: new Date(), resueltoPor: u.name } });
    return r.count ? { ok: true } : { ok: false, error: "Ese pedido ya se resolvió." };
}

/* ═══════════════════════ Proveedores del lote, pedidos desde el portal (26/11) ═══════════════════════
 *
 * Nico: «que el residente pueda pedir sus proveedores desde su portal». Como las matrículas, es un
 * PEDIDO: lo aprueba la administración en la bandeja del censo. Sumar a alguien con la entrada
 * habilitada es dejar entrar a un tercero al barrio, y eso lo decide la administración.
 */
const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;
export async function pedirServicio(token: string, d: { tipo: string; nombre: string; telefono?: string; chapa?: string; dias?: string[]; desde?: string; hasta?: string; notas?: string; entrada?: boolean }): Promise<{ ok: boolean; error?: string }> {
    const u = await quien(token);
    if (!u) return { ok: false, error: "Tu enlace ya no sirve: pedile uno nuevo a la administración." };
    const unitId = u.unitId || u.vinculos[0]?.unitId || null;
    if (!unitId) return { ok: false, error: "Todavía no figurás en ningún lote: pedile a la administración que te sume al tuyo." };
    if (!TIPOS_SERVICIO.some((t) => t.id === d.tipo)) return { ok: false, error: "Elegí qué servicio es." };
    const corto = (t: unknown, n2 = 80) => String(t ?? "").replace(/\s+/g, " ").trim().slice(0, n2);
    const nombre = corto(d.nombre);
    const crudo = String(d.chapa || "").trim();
    const chapa = crudo ? (normalizarChapa(crudo)?.plate || limpiarChapa(crudo)) : null;
    if (!nombre && !chapa) return { ok: false, error: "Poné quién es, o al menos la matrícula con la que viene." };
    if (chapa && (chapa.length < 5 || chapa.length > 8)) return { ok: false, error: "Esa matrícula no tiene forma de matrícula." };
    if ((d.desde && !HORA.test(d.desde)) || (d.hasta && !HORA.test(d.hasta))) return { ok: false, error: "La hora va como 08:00." };
    const dias = ordenarDias(d.dias);
    if (d.entrada && (!chapa || !dias.length)) return { ok: false, error: "Para que entre solo hacen falta la matrícula y los días que viene." };
    const abierto = await prisma.pedidoResidente.count({ where: { userId: u.id, tipo: "SERVICIO_ALTA", estado: "PENDIENTE" } });
    if (abierto >= 5) return { ok: false, error: "Ya tenés cinco pedidos esperando: esperá que la administración los revise." };
    await prisma.pedidoResidente.create({ data: { userId: u.id, unitId, tipo: "SERVICIO_ALTA", chapa, detalle: { tipo: d.tipo, nombre, telefono: corto(d.telefono, 30), dias: dias.join(","), desde: d.desde || "", hasta: d.hasta || "", notas: corto(d.notas, 200), entrada: d.entrada ? "si" : "no" } } });
    await anotarEnLote([unitId], { que: "CENSO_CARGA", persona: u.name, userId: u.id, chapa: chapa || undefined, detalle: `Pidió sumar un proveedor desde su portal: ${rotuloServicio(d.tipo)}${nombre ? ` ${nombre}` : ""}${d.entrada ? ", con entrada por matrícula" : ""}. Espera que la administración lo apruebe.` }, { quien: u.name, origen: "censo" });
    return { ok: true };
}

/** Pedir que un proveedor del lote deje de figurar (dejó de venir). También lo aprueba la administración. */
export async function pedirBajaServicio(token: string, servicioId: string): Promise<{ ok: boolean; error?: string }> {
    const u = await quien(token);
    if (!u) return { ok: false, error: "Tu enlace ya no sirve: pedile uno nuevo a la administración." };
    const lotes = u.vinculos.map((v) => v.unitId);
    const sv = await prisma.servicioLote.findFirst({ where: { id: servicioId, unitId: { in: lotes }, estado: "ACTIVO" } });
    if (!sv) return { ok: false, error: "Ese proveedor ya no figura en tu lote." };
    const ya = await prisma.pedidoResidente.findFirst({ where: { tipo: "SERVICIO_BAJA", estado: "PENDIENTE", unitId: sv.unitId, chapa: sv.chapa, detalle: { path: ["servicioId"], equals: sv.id } } });
    if (ya) return { ok: false, error: "Ya hay un pedido de baja de ese proveedor esperando a la administración." };
    await prisma.pedidoResidente.create({ data: { userId: u.id, unitId: sv.unitId, tipo: "SERVICIO_BAJA", chapa: sv.chapa, detalle: { servicioId: sv.id, tipo: sv.tipo, nombre: sv.nombre } } });
    await anotarEnLote([sv.unitId], { que: "CENSO_CARGA", persona: u.name, userId: u.id, chapa: sv.chapa || undefined, detalle: `Pidió dar de baja a ${rotuloServicio(sv.tipo)}${sv.nombre ? ` ${sv.nombre}` : ""} desde su portal.` }, { quien: u.name, origen: "censo" });
    return { ok: true };
}
