"use server";

import { prisma } from "@/lib/prisma";
import { getSession } from "@/app/actions/auth";
import { permisosDeSesion } from "@/lib/permisos";
import { auditar } from "@/lib/centrales/sesion";
import { avisarPorSocket } from "@/lib/avisar";
import { choque, problemaDeTurno, ESTADOS_ESPACIO, ESTADOS_RESERVA, ESTADOS_TAREA, TIPOS_ESPACIO, TIPOS_TAREA } from "@/lib/espacios";

/**
 * Los espacios comunes de cada administración: el SUM, la piscina, las canchas, los parrilleros
 * (25/11, ver lib/espacios). Verlos es ver el padrón; cargarlos, reservar y anotar tareas es editarlo.
 *
 * El estado en vivo (abierto, cerrado, en mantenimiento) avisa por el socket cuando cambia, para que
 * la pantalla de quien esté mirando —la guardia, otra administradora— se ponga al día sola.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- la sesión es el JWT crudo
async function sesion(permiso: string): Promise<any> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s: any = await getSession().catch(() => null);
    if (!s || !permisosDeSesion(s).includes(permiso)) throw new Error("Tu rol no puede hacer eso con los espacios comunes.");
    return s;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const quien = (s: any) => String(s?.name || s?.sub || "panel");
const corto = (t: unknown, n = 160) => String(t ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const largo = (t: unknown, n = 8000) => String(t ?? "").trim().slice(0, n) || null;
/* El socket vive en el proceso de los webhooks: se le pasa por el puente de siempre (lib/avisar). */
const avisar = (evento: string, dato: Record<string, unknown>) => { try { avisarPorSocket(evento, dato); } catch { /* sin puente: la pantalla se pone al día al volver a pedir */ } };

export type Resultado = { ok: boolean; error?: string; id?: string };
export type EspacioVisto = {
    id: string; administracionId: string | null; tipo: string; nombre: string; descripcion: string | null; capacidad: number | null;
    horario: string | null; reglamento: string | null; inventario: string | null; responsable: string | null; reservable: boolean;
    estado: string; estadoNota: string | null; estadoAt: string | null; estadoPor: string | null;
    /** Lo que viene: la próxima reserva confirmada o pedida, y cuántas tareas quedan abiertas. */
    proxima: { inicio: string; fin: string; lote: string; responsable: string; estado: string } | null;
    reservasProximas: number; tareasAbiertas: number; urgentes: number;
};
export type ReservaVista = {
    id: string; espacioId: string; unitId: string | null; lote: string; responsable: string; telefono: string | null; motivo: string | null;
    invitados: number | null; inicio: string; fin: string; estado: string; nota: string | null; creadaPor: string | null;
};
export type TareaVista = {
    id: string; espacioId: string; titulo: string; detalle: string | null; tipo: string; prioridad: string; responsable: string | null;
    vence: string | null; estado: string; hechaAt: string | null; creadaPor: string | null; createdAt: string;
};

/** Los espacios de una administración (y los del complejo entero, que son de todas). */
export async function espaciosDe(administracionId: string | null): Promise<EspacioVisto[]> {
    await sesion("usuarios");
    const ahora = new Date();
    const filas = await prisma.espacioComun.findMany({
        where: administracionId ? { OR: [{ administracionId }, { administracionId: null }] } : {},
        orderBy: [{ orden: "asc" }, { nombre: "asc" }],
        include: {
            reservas: { where: { fin: { gte: ahora }, estado: { not: "CANCELADA" } }, orderBy: { inicio: "asc" }, select: { inicio: true, fin: true, lote: true, responsable: true, estado: true } },
            tareas: { where: { estado: { not: "HECHA" } }, select: { prioridad: true } },
        },
    });
    return filas.map((e) => ({
        id: e.id, administracionId: e.administracionId, tipo: e.tipo, nombre: e.nombre, descripcion: e.descripcion, capacidad: e.capacidad,
        horario: e.horario, reglamento: e.reglamento, inventario: e.inventario, responsable: e.responsable, reservable: e.reservable,
        estado: e.estado, estadoNota: e.estadoNota, estadoAt: e.estadoAt?.toISOString() || null, estadoPor: e.estadoPor,
        proxima: e.reservas[0] ? { inicio: e.reservas[0].inicio.toISOString(), fin: e.reservas[0].fin.toISOString(), lote: e.reservas[0].lote, responsable: e.reservas[0].responsable, estado: e.reservas[0].estado } : null,
        reservasProximas: e.reservas.length, tareasAbiertas: e.tareas.length, urgentes: e.tareas.filter((t) => t.prioridad === "URGENTE").length,
    }));
}

export async function guardarEspacio(d: {
    id?: string; administracionId: string | null; tipo: string; nombre: string; descripcion?: string; capacidad?: number | null;
    horario?: string; reglamento?: string; inventario?: string; responsable?: string; reservable?: boolean;
}): Promise<Resultado> {
    const s = await sesion("usuarios.editar");
    const nombre = corto(d.nombre, 80);
    if (nombre.length < 2) return { ok: false, error: "Falta el nombre." };
    if (!TIPOS_ESPACIO.some((t) => t.id === d.tipo)) return { ok: false, error: "Elegí qué es." };
    const data = {
        administracionId: d.administracionId || null, tipo: d.tipo, nombre, descripcion: largo(d.descripcion, 600),
        capacidad: d.capacidad && d.capacidad > 0 ? Math.min(Math.round(d.capacidad), 100_000) : null,
        horario: corto(d.horario, 160) || null, reglamento: largo(d.reglamento), inventario: largo(d.inventario, 2000),
        responsable: corto(d.responsable, 120) || null, reservable: !!d.reservable,
    };
    const e = d.id ? await prisma.espacioComun.update({ where: { id: d.id }, data }) : await prisma.espacioComun.create({ data });
    await auditar(s, d.id ? "espacios.editar" : "espacios.crear", nombre, true, "");
    return { ok: true, id: e.id };
}

export async function borrarEspacio(id: string): Promise<Resultado> {
    const s = await sesion("usuarios.editar");
    const e = await prisma.espacioComun.delete({ where: { id } }).catch(() => null);
    if (!e) return { ok: false, error: "Ese espacio ya no está." };
    await auditar(s, "espacios.borrar", e.nombre, true, "");
    return { ok: true };
}

/** El estado en vivo: abierto, en mantenimiento o cerrado, con una nota. Avisa por el socket. */
export async function cambiarEstadoEspacio(id: string, estado: string, nota?: string): Promise<Resultado> {
    const s = await sesion("usuarios.editar");
    if (!ESTADOS_ESPACIO.some((x) => x.id === estado)) return { ok: false, error: "Ese estado no existe." };
    const e = await prisma.espacioComun.update({ where: { id }, data: { estado, estadoNota: corto(nota, 200) || null, estadoAt: new Date(), estadoPor: quien(s) } }).catch(() => null);
    if (!e) return { ok: false, error: "Ese espacio ya no está." };
    avisar("espacio_estado", { id: e.id, nombre: e.nombre, estado: e.estado, nota: e.estadoNota, por: e.estadoPor, at: e.estadoAt });
    await auditar(s, "espacios.estado", e.nombre, true, `${estado}${e.estadoNota ? ` · ${e.estadoNota}` : ""}`);
    return { ok: true };
}

/* ───────── Reservas ───────── */

const reservaVista = (r: { id: string; espacioId: string; unitId: string | null; lote: string; responsable: string; telefono: string | null; motivo: string | null; invitados: number | null; inicio: Date; fin: Date; estado: string; nota: string | null; creadaPor: string | null }): ReservaVista =>
    ({ ...r, inicio: r.inicio.toISOString(), fin: r.fin.toISOString() });

/** Las reservas de un espacio en un rango (la semana que se mira). */
export async function reservasDe(espacioId: string, desde: string, hasta: string): Promise<ReservaVista[]> {
    await sesion("usuarios");
    const filas = await prisma.reservaEspacio.findMany({ where: { espacioId, inicio: { lt: new Date(hasta) }, fin: { gt: new Date(desde) } }, orderBy: { inicio: "asc" } });
    return filas.map(reservaVista);
}

/** Las próximas de un espacio (para la lista de al lado del calendario). */
export async function proximasReservas(espacioId: string): Promise<ReservaVista[]> {
    await sesion("usuarios");
    const filas = await prisma.reservaEspacio.findMany({ where: { espacioId, fin: { gte: new Date() } }, orderBy: { inicio: "asc" }, take: 30 });
    return filas.map(reservaVista);
}

/** Los lotes para elegir quién reserva. */
export async function lotesParaReservar(administracionId: string | null, q: string): Promise<{ id: string; nombre: string; titular: string | null }[]> {
    await sesion("usuarios");
    const t = corto(q, 40);
    const filas = await prisma.unit.findMany({
        where: { ...(administracionId ? { administracionId } : {}), ...(t ? { OR: [{ name: { contains: t, mode: "insensitive" } }, { titular: { contains: t, mode: "insensitive" } }] } : {}) },
        select: { id: true, name: true, titular: true }, orderBy: { name: "asc" }, take: 12,
    });
    return filas.map((u) => ({ id: u.id, nombre: u.name, titular: u.titular }));
}

export async function guardarReserva(d: {
    id?: string; espacioId: string; unitId?: string | null; lote?: string; responsable: string; telefono?: string; motivo?: string;
    invitados?: number | null; inicio: string; fin: string; estado?: string; nota?: string;
}): Promise<Resultado> {
    const s = await sesion("usuarios.editar");
    const e = await prisma.espacioComun.findUnique({ where: { id: d.espacioId }, select: { id: true, nombre: true, reservable: true, estado: true, capacidad: true } });
    if (!e) return { ok: false, error: "Ese espacio ya no está." };
    if (!e.reservable) return { ok: false, error: `${e.nombre} no se reserva por turnos.` };
    const responsable = corto(d.responsable, 120);
    if (responsable.length < 2) return { ok: false, error: "Falta quién reserva." };
    const estado = d.estado && ESTADOS_RESERVA.some((x) => x.id === d.estado) ? d.estado : "CONFIRMADA";
    const turno = { id: d.id, inicio: d.inicio, fin: d.fin, estado };
    const mal = problemaDeTurno(turno);
    if (mal && !(d.id && /ya pasó/.test(mal))) return { ok: false, error: mal };
    if (estado !== "CANCELADA") {
        const cerca = await prisma.reservaEspacio.findMany({ where: { espacioId: e.id, inicio: { lt: new Date(d.fin) }, fin: { gt: new Date(d.inicio) } }, select: { id: true, inicio: true, fin: true, estado: true, lote: true, responsable: true } });
        const otra = choque(cerca, turno);
        if (otra) {
            const h = (x: Date) => x.toLocaleTimeString("es-UY", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/Montevideo" });
            return { ok: false, error: `Choca con la reserva de ${otra.lote || otra.responsable} (${h(otra.inicio)} a ${h(otra.fin)}).` };
        }
    }
    const invitados = d.invitados && d.invitados > 0 ? Math.round(d.invitados) : null;
    if (invitados && e.capacidad && invitados > e.capacidad) return { ok: false, error: `${e.nombre} tiene capacidad para ${e.capacidad} personas.` };
    let lote = corto(d.lote, 60);
    if (d.unitId && !lote) lote = (await prisma.unit.findUnique({ where: { id: d.unitId }, select: { name: true } }))?.name || "";
    const data = {
        espacioId: e.id, unitId: d.unitId || null, lote, responsable, telefono: corto(d.telefono, 30) || null, motivo: corto(d.motivo, 160) || null,
        invitados, inicio: new Date(d.inicio), fin: new Date(d.fin), estado, nota: largo(d.nota, 600),
    };
    const r = d.id ? await prisma.reservaEspacio.update({ where: { id: d.id }, data }) : await prisma.reservaEspacio.create({ data: { ...data, creadaPor: quien(s) } });
    avisar("espacio_reserva", { espacioId: e.id });
    await auditar(s, d.id ? "espacios.reserva.editar" : "espacios.reserva.crear", e.nombre, true, `${lote || responsable} · ${d.inicio} → ${d.fin} · ${estado}`);
    return { ok: true, id: r.id };
}

export async function cancelarReserva(id: string): Promise<Resultado> {
    const s = await sesion("usuarios.editar");
    const r = await prisma.reservaEspacio.update({ where: { id }, data: { estado: "CANCELADA" }, include: { espacio: { select: { nombre: true } } } }).catch(() => null);
    if (!r) return { ok: false, error: "Esa reserva ya no está." };
    avisar("espacio_reserva", { espacioId: r.espacioId });
    await auditar(s, "espacios.reserva.cancelar", r.espacio.nombre, true, `${r.lote || r.responsable} · ${r.inicio.toISOString()}`);
    return { ok: true };
}

/* ───────── Tareas ───────── */

const tareaVista = (t: { id: string; espacioId: string; titulo: string; detalle: string | null; tipo: string; prioridad: string; responsable: string | null; vence: Date | null; estado: string; hechaAt: Date | null; creadaPor: string | null; createdAt: Date }): TareaVista =>
    ({ ...t, vence: t.vence?.toISOString() || null, hechaAt: t.hechaAt?.toISOString() || null, createdAt: t.createdAt.toISOString() });

export async function tareasDe(espacioId: string): Promise<TareaVista[]> {
    await sesion("usuarios");
    const filas = await prisma.tareaEspacio.findMany({ where: { espacioId }, orderBy: [{ estado: "asc" }, { vence: "asc" }, { createdAt: "desc" }], take: 200 });
    /* Primero lo abierto (urgentes arriba), después lo hecho, lo más nuevo primero. */
    const peso = (t: { estado: string; prioridad: string }) => (t.estado === "HECHA" ? 2 : t.prioridad === "URGENTE" ? 0 : 1);
    return filas.sort((a, b) => peso(a) - peso(b)).map(tareaVista);
}

export async function guardarTarea(d: { id?: string; espacioId: string; titulo: string; detalle?: string; tipo?: string; prioridad?: string; responsable?: string; vence?: string | null }): Promise<Resultado> {
    const s = await sesion("usuarios.editar");
    const titulo = corto(d.titulo, 140);
    if (titulo.length < 2) return { ok: false, error: "Falta qué hay que hacer." };
    const data = {
        espacioId: d.espacioId, titulo, detalle: largo(d.detalle, 2000),
        tipo: TIPOS_TAREA.some((x) => x.id === d.tipo) ? d.tipo! : "MANTENIMIENTO", prioridad: d.prioridad === "URGENTE" ? "URGENTE" : "NORMAL",
        responsable: corto(d.responsable, 120) || null, vence: d.vence ? new Date(d.vence) : null,
    };
    const t = d.id ? await prisma.tareaEspacio.update({ where: { id: d.id }, data }) : await prisma.tareaEspacio.create({ data: { ...data, creadaPor: quien(s) } });
    await auditar(s, d.id ? "espacios.tarea.editar" : "espacios.tarea.crear", titulo, true, "");
    return { ok: true, id: t.id };
}

export async function cambiarEstadoTarea(id: string, estado: string): Promise<Resultado> {
    const s = await sesion("usuarios.editar");
    if (!ESTADOS_TAREA.some((x) => x.id === estado)) return { ok: false, error: "Ese estado no existe." };
    const t = await prisma.tareaEspacio.update({ where: { id }, data: { estado, hechaAt: estado === "HECHA" ? new Date() : null } }).catch(() => null);
    if (!t) return { ok: false, error: "Esa tarea ya no está." };
    await auditar(s, "espacios.tarea.estado", t.titulo, true, estado);
    return { ok: true };
}

export async function borrarTarea(id: string): Promise<Resultado> {
    const s = await sesion("usuarios.editar");
    const t = await prisma.tareaEspacio.delete({ where: { id } }).catch(() => null);
    if (!t) return { ok: false, error: "Esa tarea ya no está." };
    await auditar(s, "espacios.tarea.borrar", t.titulo, true, "");
    return { ok: true };
}
