"use server";

import { prisma } from "@/lib/prisma";
import { getSession } from "@/app/actions/auth";
import { permisosDeSesion } from "@/lib/permisos";
import { auditar } from "@/lib/centrales/sesion";
import { siglaDeEtapa } from "@/lib/padron-planilla";

/**
 * Las administraciones del complejo (21/11, Nico: «el complejo se fue construyendo por proyectos
 * de grupos de lotes; cada grupo tiene su comisión, que le llaman etapas… debemos crear
 * "Administraciones", un apartado para reflejar esto, para tener los contactos, servicios de cada
 * comisión, referentes»).
 *
 * Una administración junta tres cosas: su gente (administradora, comisión, referentes), lo que
 * contrata (jardinería, recolección, mantenimiento) y sus lotes. Los lotes llegan por la planilla
 * del padrón (lib/padron-importar); la gente y los servicios se cargan acá.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- la sesión es el JWT crudo
async function sesion(permiso: string): Promise<any> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s: any = await getSession().catch(() => null);
    if (!s || !permisosDeSesion(s).includes(permiso)) throw new Error("Tu rol no puede hacer eso con las administraciones.");
    return s;
}

export type ResumenAdministracion = {
    id: string; nombre: string; sigla: string; notas: string | null;
    lotes: number; terrenos: number; sinGente: number;
    personas: number;
    /** De sus personas: cuántas tienen su código del censo, a cuántas se les mandó y cuántas ya cargaron. */
    conCodigo: number; enviados: number; cargaron: number;
    contactos: number; servicios: number;
    /** A quién llamar primero: el primer contacto cargado. */
    referente: { nombre: string; rol: string; telefono: string | null } | null;
};

export async function administraciones(): Promise<ResumenAdministracion[]> {
    await sesion("usuarios");
    const [admins, unidades, vinculos, invitaciones] = await Promise.all([
        prisma.administracion.findMany({ orderBy: [{ orden: "asc" }, { nombre: "asc" }], include: { contactos: { orderBy: [{ orden: "asc" }, { createdAt: "asc" }] }, _count: { select: { servicios: true } } } }),
        prisma.unit.findMany({ where: { administracionId: { not: null } }, select: { id: true, administracionId: true, situacion: true } }),
        prisma.userUnidad.findMany({ select: { userId: true, unitId: true } }),
        prisma.invitacionCenso.findMany({ where: { userId: { not: null } }, select: { userId: true, enviadoAt: true, usadoAt: true } }),
    ]);
    const adminDeUnidad = new Map(unidades.map((u) => [u.id, u.administracionId!]));
    const inv = new Map(invitaciones.map((i) => [i.userId!, i]));
    return admins.map((a) => {
        const suyas = unidades.filter((u) => u.administracionId === a.id);
        const gente = new Set<string>(), conGente = new Set<string>();
        for (const v of vinculos) if (adminDeUnidad.get(v.unitId) === a.id) { gente.add(v.userId); conGente.add(v.unitId); }
        const invs = [...gente].map((id) => inv.get(id)).filter(Boolean);
        const c = a.contactos[0];
        return {
            id: a.id, nombre: a.nombre, sigla: a.sigla, notas: a.notas,
            lotes: suyas.length, terrenos: suyas.filter((u) => u.situacion === "TERRENO").length,
            sinGente: suyas.filter((u) => !u.situacion && !conGente.has(u.id)).length,
            personas: gente.size, conCodigo: invs.length, enviados: invs.filter((i) => i!.enviadoAt).length, cargaron: invs.filter((i) => i!.usadoAt).length,
            contactos: a.contactos.length, servicios: a._count.servicios,
            referente: c ? { nombre: c.nombre, rol: c.rol, telefono: c.telefono } : null,
        };
    });
}

export type ContactoAdm = { id: string; nombre: string; rol: string; telefono: string | null; email: string | null; notas: string | null };
export type ServicioAdm = { id: string; rubro: string; proveedor: string | null; contacto: string | null; telefono: string | null; email: string | null; horario: string | null; notas: string | null };
export type PersonaDeLote = { id: string; nombre: string; email: string | null; telefono: string | null; vinculo: string; codigo: "sin" | "listo" | "enviado" | "cargo" };
export type LoteAdm = {
    id: string; nombre: string; codigo: string; manzana: string | null; edificio: string | null; areaM2: number | null;
    titular: string | null; situacion: string | null; observaciones: string | null; personas: PersonaDeLote[];
};
export type DetalleAdministracion = { id: string; nombre: string; sigla: string; notas: string | null; contactos: ContactoAdm[]; servicios: ServicioAdm[]; lotes: LoteAdm[] };

export async function detalleAdministracion(id: string): Promise<DetalleAdministracion | null> {
    await sesion("usuarios");
    const a = await prisma.administracion.findUnique({
        where: { id },
        include: {
            contactos: { orderBy: [{ orden: "asc" }, { createdAt: "asc" }] }, servicios: { orderBy: [{ rubro: "asc" }, { createdAt: "asc" }] },
            unidades: { include: { vinculos: { include: { user: { select: { id: true, name: true, email: true, phone: true } } } } } },
        },
    });
    if (!a) return null;
    const ids = a.unidades.flatMap((u) => u.vinculos.map((v) => v.userId));
    const invs = new Map((ids.length ? await prisma.invitacionCenso.findMany({ where: { userId: { in: ids } }, select: { userId: true, enviadoAt: true, usadoAt: true } }) : []).map((i) => [i.userId!, i]));
    const estado = (userId: string): PersonaDeLote["codigo"] => { const i = invs.get(userId); return !i ? "sin" : i.usadoAt ? "cargo" : i.enviadoAt ? "enviado" : "listo"; };
    /* Orden del plano: por manzana, y dentro de la manzana por el número del solar (10 después de 9, no de 1). */
    const num = (s: string | null) => parseInt(String(s || "").replace(/\D+/g, "")) || 0;
    const lotes = [...a.unidades].sort((x, y) => (x.manzana || "").localeCompare(y.manzana || "") || num(x.solar) - num(y.solar) || (x.lot || "").localeCompare(y.lot || ""));
    return {
        id: a.id, nombre: a.nombre, sigla: a.sigla, notas: a.notas,
        contactos: a.contactos.map((c) => ({ id: c.id, nombre: c.nombre, rol: c.rol, telefono: c.telefono, email: c.email, notas: c.notas })),
        servicios: a.servicios.map((s) => ({ id: s.id, rubro: s.rubro, proveedor: s.proveedor, contacto: s.contacto, telefono: s.telefono, email: s.email, horario: s.horario, notas: s.notas })),
        lotes: lotes.map((u) => ({
            id: u.id, nombre: u.name, codigo: u.lot || u.name, manzana: u.manzana, edificio: u.edificio, areaM2: u.areaM2, titular: u.titular, situacion: u.situacion, observaciones: u.description,
            personas: u.vinculos.map((v) => ({ id: v.user.id, nombre: v.user.name, email: v.user.email, telefono: v.user.phone, vinculo: v.vinculo, codigo: estado(v.userId) })),
        })),
    };
}

const corto = (v: unknown, n: number): string => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const oNada = (v: unknown, n: number): string | null => corto(v, n) || null;

export async function guardarAdministracion(d: { id?: string; nombre: string; sigla?: string; notas?: string }): Promise<{ ok: boolean; id?: string; error?: string }> {
    const s = await sesion("usuarios.editar");
    const nombre = corto(d.nombre, 60);
    if (!nombre) return { ok: false, error: "La administración necesita un nombre." };
    /* La sigla va entre paréntesis en el nombre de cada lote: si no la escriben, sale del nombre. */
    const sigla = corto(d.sigla, 12) || siglaDeEtapa(nombre);
    const choca = await prisma.administracion.findFirst({ where: { OR: [{ nombre }, { sigla }], NOT: d.id ? { id: d.id } : undefined }, select: { nombre: true } });
    if (choca) return { ok: false, error: `Ya hay una administración con ese nombre o esa sigla (${choca.nombre}).` };
    if (d.id) {
        const antes = await prisma.administracion.findUnique({ where: { id: d.id }, select: { sigla: true } });
        if (!antes) return { ok: false, error: "Esa administración ya no existe." };
        /* La sigla es parte del nombre de sus lotes: cambiarla con lotes cargados dejaría «A 2 (4-5)» apuntando a una sigla que ya no es. */
        if (antes.sigla !== sigla && (await prisma.unit.count({ where: { administracionId: d.id } }))) return { ok: false, error: "La sigla no se puede cambiar con lotes cargados: es parte del nombre de cada lote." };
        await prisma.administracion.update({ where: { id: d.id }, data: { nombre, sigla, notas: oNada(d.notas, 2000) } });
        await auditar(s, "administraciones.cambiar", d.id, true, nombre);
        return { ok: true, id: d.id };
    }
    const orden = (await prisma.administracion.count()) + 1;
    const a = await prisma.administracion.create({ data: { nombre, sigla, notas: oNada(d.notas, 2000), orden }, select: { id: true } });
    await auditar(s, "administraciones.alta", a.id, true, nombre);
    return { ok: true, id: a.id };
}

/** Sólo una administración vacía de lotes: con lotes adentro, borrarla los dejaría sin etapa. */
export async function borrarAdministracion(id: string): Promise<{ ok: boolean; error?: string }> {
    const s = await sesion("usuarios.editar");
    const lotes = await prisma.unit.count({ where: { administracionId: id } });
    if (lotes) return { ok: false, error: `Tiene ${lotes} lotes: no se borra una administración con lotes.` };
    const a = await prisma.administracion.delete({ where: { id } }).catch(() => null);
    if (a) await auditar(s, "administraciones.borrar", id, true, a.nombre);
    return { ok: !!a };
}

export async function guardarContactoAdm(administracionId: string, d: Partial<ContactoAdm>): Promise<{ ok: boolean; error?: string }> {
    const s = await sesion("usuarios.editar");
    const nombre = corto(d.nombre, 80);
    if (!nombre) return { ok: false, error: "Falta el nombre." };
    const data = { nombre, rol: corto(d.rol, 60), telefono: oNada(d.telefono, 40), email: oNada(d.email, 120)?.toLowerCase() ?? null, notas: oNada(d.notas, 500) };
    if (d.id) await prisma.administracionContacto.update({ where: { id: d.id }, data });
    else await prisma.administracionContacto.create({ data: { ...data, administracionId, orden: await prisma.administracionContacto.count({ where: { administracionId } }) } });
    await auditar(s, d.id ? "administraciones.contacto.cambiar" : "administraciones.contacto.alta", administracionId, true, `${nombre}${data.rol ? ` · ${data.rol}` : ""}`);
    return { ok: true };
}

export async function borrarContactoAdm(id: string): Promise<{ ok: boolean }> {
    const s = await sesion("usuarios.editar");
    const c = await prisma.administracionContacto.delete({ where: { id } }).catch(() => null);
    if (c) await auditar(s, "administraciones.contacto.borrar", c.administracionId, true, c.nombre);
    return { ok: !!c };
}

export async function guardarServicioAdm(administracionId: string, d: Partial<ServicioAdm>): Promise<{ ok: boolean; error?: string }> {
    const s = await sesion("usuarios.editar");
    const rubro = corto(d.rubro, 60);
    if (!rubro) return { ok: false, error: "Falta qué servicio es (jardinería, recolección…)." };
    const data = { rubro, proveedor: oNada(d.proveedor, 80), contacto: oNada(d.contacto, 80), telefono: oNada(d.telefono, 40), email: oNada(d.email, 120)?.toLowerCase() ?? null, horario: oNada(d.horario, 120), notas: oNada(d.notas, 500) };
    if (d.id) await prisma.administracionServicio.update({ where: { id: d.id }, data });
    else await prisma.administracionServicio.create({ data: { ...data, administracionId } });
    await auditar(s, d.id ? "administraciones.servicio.cambiar" : "administraciones.servicio.alta", administracionId, true, `${rubro}${data.proveedor ? ` · ${data.proveedor}` : ""}`);
    return { ok: true };
}

export async function borrarServicioAdm(id: string): Promise<{ ok: boolean }> {
    const s = await sesion("usuarios.editar");
    const c = await prisma.administracionServicio.delete({ where: { id } }).catch(() => null);
    if (c) await auditar(s, "administraciones.servicio.borrar", c.administracionId, true, c.rubro);
    return { ok: !!c };
}
