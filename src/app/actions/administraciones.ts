"use server";

import { prisma } from "@/lib/prisma";
import { getSession } from "@/app/actions/auth";
import { permisosDeSesion } from "@/lib/permisos";
import { auditar } from "@/lib/centrales/sesion";
import { siglaDeEtapa } from "@/lib/padron-planilla";
import { leerPlanoLotes } from "@/lib/plano-lotes";
import { cambiarCodigoDeInvitacion, type CodigoCambiado } from "@/lib/censo-codigo";
import { limpiarChapa } from "@/lib/lote-cambios";
import { copiaFija, enviarCorreo, limpiarClaveDeAplicacion, probarCuenta } from "@/lib/correo";

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
    referente: { nombre: string; rol: string; telefono: string | null; email: string | null } | null;
    /** Desde qué cuenta les escribe a sus lotes (25/11). La clave nunca sale del servidor: sólo si hay una. */
    correo: CorreoAdm;
};
export type CorreoAdm = { cuenta: string | null; nombre: string | null; conClave: boolean; probadoAt: string | null; error: string | null };

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
            referente: c ? { nombre: c.nombre, rol: c.rol, telefono: c.telefono, email: c.email } : null,
            correo: { cuenta: a.correoCuenta, nombre: a.correoNombre, conClave: !!a.correoClave, probadoAt: a.correoProbadoAt?.toISOString() || null, error: a.correoError },
        };
    });
}

export type ContactoAdm = { id: string; nombre: string; rol: string; telefono: string | null; email: string | null; notas: string | null };
export type ServicioAdm = { id: string; rubro: string; proveedor: string | null; contacto: string | null; telefono: string | null; email: string | null; horario: string | null; notas: string | null };
export type PersonaDeLote = { id: string; nombre: string; email: string | null; telefono: string | null; vinculo: string; codigo: "sin" | "listo" | "enviado" | "cargo" };
export type LoteAdm = {
    id: string; nombre: string; codigo: string; manzana: string | null; edificio: string | null; areaM2: number | null;
    titular: string | null; situacion: string | null; observaciones: string | null; personas: PersonaDeLote[];
    /** Su punto en el croquis (píxeles de la imagen original) y sus coordenadas «lat, lng», si las tiene (25/11). */
    planoX: number | null; planoY: number | null; coordenadas: string | null;
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
            planoX: u.planoX, planoY: u.planoY, coordenadas: u.coordinates?.trim() || null,
            personas: u.vinculos.map((v) => ({ id: v.user.id, nombre: v.user.name, email: v.user.email, telefono: v.user.phone, vinculo: v.vinculo, codigo: estado(v.userId) })),
        })),
    };
}

/** El croquis de los lotes, si hay uno cargado (ver lib/plano-lotes): título y tamaño, sin la calibración. */
export async function planoDeLotes(): Promise<{ titulo: string; ancho: number; alto: number; georef: boolean } | null> {
    await sesion("usuarios");
    const p = leerPlanoLotes((await prisma.setting.findUnique({ where: { key: "PLANO_LOTES" } }).catch(() => null))?.value);
    return p ? { titulo: p.titulo, ancho: p.ancho, alto: p.alto, georef: !!p.georef } : null;
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

/**
 * Subir o bajar una administración en la lista (25/11). El orden es el de la columna de la derecha
 * y el de todos los lugares donde aparecen juntas: la guardia las busca siempre en el mismo lugar,
 * así que el orden lo decide quien administra, no el alfabeto. Se renumera todo de 1 en adelante
 * para que dos con el mismo `orden` (las que se crearon a la vez) no queden trabadas.
 */
export async function moverAdministracion(id: string, hacia: "arriba" | "abajo"): Promise<{ ok: boolean }> {
    const s = await sesion("usuarios.editar");
    const todas = await prisma.administracion.findMany({ orderBy: [{ orden: "asc" }, { nombre: "asc" }], select: { id: true, nombre: true } });
    const i = todas.findIndex((a) => a.id === id);
    const j = hacia === "arriba" ? i - 1 : i + 1;
    if (i < 0 || j < 0 || j >= todas.length) return { ok: false };
    [todas[i], todas[j]] = [todas[j], todas[i]];
    await prisma.$transaction(todas.map((a, n) => prisma.administracion.update({ where: { id: a.id }, data: { orden: n + 1 } })));
    await auditar(s, "administraciones.orden", id, true, `${todas[j].nombre} · ${hacia}`);
    return { ok: true };
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


/* ─────────── Un lote: su gente, sus códigos del censo, sus matrículas y su historial ─────────── */

export type CambioVisto = {
    id: string; unitId: string; lote: string; cuando: string; que: string;
    chapa: string | null; persona: string | null; quien: string | null; origen: string; detalle: string | null;
};
export type PersonaEnLote = {
    id: string; nombre: string; email: string | null; telefono: string | null; vinculo: string | null; chapas: string[];
    /** Su invitación al censo. `clave` viene sólo para quien puede editar el padrón: es una llave. */
    invitacion: { id: string; clave: string | null; estado: "listo" | "enviado" | "cargo"; enviadoAt: string | null; usadoAt: string | null } | null;
};
export type DetalleLote = {
    id: string; nombre: string; administracion: string | null; titular: string | null; situacion: string | null; edificio: string | null;
    puedeEditar: boolean; personas: PersonaEnLote[]; cambios: CambioVisto[];
    /** Dónde está: «lat, lng» (para abrirlo en un mapa) y si tiene su punto en el croquis. */
    coordenadas: string | null; enElPlano: boolean;
    /** Desde cuándo se lleva el historial: antes de esa fecha no hay nada que mostrar, y se dice. */
    auditadoDesde: string | null;
};

const visto = (c: { id: string; unitId: string; cuando: Date; que: string; chapa: string | null; persona: string | null; quien: string | null; origen: string; detalle: string | null }, lote: string): CambioVisto =>
    ({ id: c.id, unitId: c.unitId, lote, cuando: c.cuando.toISOString(), que: c.que, chapa: c.chapa, persona: c.persona, quien: c.quien, origen: c.origen, detalle: c.detalle });

export async function detalleLote(unitId: string): Promise<DetalleLote | null> {
    const s = await sesion("usuarios");
    const puedeEditar = permisosDeSesion(s).includes("usuarios.editar");
    const u = await prisma.unit.findUnique({ where: { id: unitId }, select: { id: true, name: true, titular: true, situacion: true, edificio: true, coordinates: true, planoX: true, administracion: { select: { nombre: true } } } });
    if (!u) return null;
    const [gente, cambios, desde] = await Promise.all([
        prisma.user.findMany({
            where: { OR: [{ unitId }, { vinculos: { some: { unitId } } }] }, orderBy: { name: "asc" },
            select: { id: true, name: true, email: true, phone: true, vinculos: { where: { unitId }, select: { vinculo: true } }, vehicles: { select: { plate: true } }, credentials: { where: { type: "PLATE" }, select: { value: true } } },
        }),
        prisma.cambioLote.findMany({ where: { unitId }, orderBy: { cuando: "desc" }, take: 300 }),
        prisma.setting.findUnique({ where: { key: "LOTES_AUDITADOS_DESDE" } }),
    ]);
    const invs = gente.length ? await prisma.invitacionCenso.findMany({ where: { sitio: "", OR: [{ userId: { in: gente.map((g) => g.id) } }, { email: { in: gente.map((g) => (g.email || "").trim().toLowerCase()).filter(Boolean) } }] } }) : [];
    const deQuien = (g: { id: string; email: string | null }) => invs.find((i) => i.userId === g.id) || invs.find((i) => !i.userId && !!g.email && i.email === g.email.trim().toLowerCase()) || null;
    return {
        id: u.id, nombre: u.name, administracion: u.administracion?.nombre || null, titular: u.titular, situacion: u.situacion, edificio: u.edificio,
        puedeEditar, auditadoDesde: desde?.value || null, coordenadas: u.coordinates?.trim() || null, enElPlano: u.planoX !== null,
        personas: gente.map((g) => {
            const i = deQuien(g);
            return {
                id: g.id, nombre: g.name, email: g.email, telefono: g.phone, vinculo: g.vinculos[0]?.vinculo || null,
                chapas: [...new Set([...g.vehicles.map((v) => v.plate), ...g.credentials.map((c) => c.value)].map(limpiarChapa).filter(Boolean))].sort(),
                invitacion: i ? { id: i.id, clave: puedeEditar ? i.clave : null, estado: i.usadoAt ? "cargo" : i.enviadoAt ? "enviado" : "listo", enviadoAt: i.enviadoAt?.toISOString() || null, usadoAt: i.usadoAt?.toISOString() || null } : null,
            };
        }),
        cambios: cambios.map((c) => visto(c, u.name)),
    };
}

/**
 * Lo último que cambió en los lotes de una administración (o en todos): la respuesta a «¿quién
 * cambió sus matrículas esta semana?» sin abrir lote por lote.
 */
export async function cambiosDeLotes(o: { administracionId?: string; dias?: number } = {}): Promise<{ cambios: CambioVisto[]; auditadoDesde: string | null; hayMas: boolean }> {
    await sesion("usuarios");
    const TOPE = 400;
    const desde = new Date(Date.now() - Math.min(Math.max(o.dias || 30, 1), 366) * 86_400_000);
    const [filas, marca] = await Promise.all([
        prisma.cambioLote.findMany({
            where: { cuando: { gte: desde }, ...(o.administracionId ? { unit: { administracionId: o.administracionId } } : {}) },
            orderBy: { cuando: "desc" }, take: TOPE + 1, include: { unit: { select: { name: true } } },
        }),
        prisma.setting.findUnique({ where: { key: "LOTES_AUDITADOS_DESDE" } }),
    ]);
    return { cambios: filas.slice(0, TOPE).map((c) => visto(c, c.unit.name)), auditadoDesde: marca?.value || null, hayMas: filas.length > TOPE };
}

/** Cambiarle a una persona su código del censo. `clave` vacía pide uno nuevo, generado. */
export async function cambiarCodigoCenso(invitacionId: string, clave: string | null): Promise<CodigoCambiado> {
    const s = await sesion("usuarios.editar");
    const quien = String(s.name || s.sub || "panel");
    const r = await cambiarCodigoDeInvitacion(String(invitacionId || ""), clave == null || !String(clave).trim() ? null : String(clave), quien);
    const inv = await prisma.invitacionCenso.findUnique({ where: { id: String(invitacionId || "") }, select: { nombre: true, lote: true } });
    if (!(r.ok && r.igual)) await auditar(s, "censo.cambiar-codigo", `${inv?.nombre || "sin nombre"} · ${inv?.lote || ""}`, r.ok, r.ok ? (clave ? "puesto a mano" : "generado") : r.error);
    return r;
}

/* ── La cuenta de correo de cada administración (25/11) ──────────────────────────────────── */

/**
 * Nico: «tenemos que cargar una cuenta de correo para cada administración, con su clave de app cada
 * una, todas son Gmail… debo poder distinguir de qué cuenta se envió y mantener en copia de todos los
 * envíos a María». Qué cuenta usa cada lote: lib/correo-administracion.
 *
 * La clave de aplicación entra por acá y no vuelve: se guarda cifrada (lib/cifrado-datos) y la
 * pantalla sólo sabe si hay una. Al guardar se le pregunta a Gmail si la acepta, y queda escrito.
 */
const CORREO_GMAIL = /^[^@\s]+@(gmail|googlemail)\.com$/i;

export async function guardarCorreoAdm(id: string, d: { cuenta: string; nombre?: string; clave?: string }): Promise<{ ok: boolean; error?: string; probada?: boolean; aviso?: string }> {
    const s = await sesion("usuarios.editar");
    const a = await prisma.administracion.findUnique({ where: { id }, select: { id: true, nombre: true, correoCuenta: true, correoClave: true } });
    if (!a) return { ok: false, error: "Esa administración ya no existe." };
    const cuenta = String(d.cuenta || "").trim().toLowerCase();
    if (!CORREO_GMAIL.test(cuenta)) return { ok: false, error: "Tiene que ser una casilla de Gmail (…@gmail.com)." };
    const otra = await prisma.administracion.findFirst({ where: { correoCuenta: cuenta, NOT: { id } }, select: { nombre: true } });
    if (otra) return { ok: false, error: `Esa casilla ya es la de ${otra.nombre}.` };
    const nueva = limpiarClaveDeAplicacion(d.clave || "");
    if (nueva && !/^[a-z]{16}$/i.test(nueva)) return { ok: false, error: "La clave de aplicación de Gmail tiene 16 letras (se muestra en cuatro grupos de cuatro)." };
    /* Cambiar de casilla sin clave nueva dejaría la clave de la anterior: no sirve para la nueva. */
    const clave = nueva || (a.correoCuenta === cuenta ? a.correoClave : null);
    const nombre = oNada(d.nombre, 80);
    let probada = false, error: string | null = null;
    if (clave) { const p = await probarCuenta({ cuenta, clave }); probada = p.ok; error = p.ok ? null : p.error || "Gmail no la aceptó"; }
    await prisma.administracion.update({
        where: { id },
        data: { correoCuenta: cuenta, correoNombre: nombre, ...(nueva ? { correoClave: nueva } : a.correoCuenta !== cuenta ? { correoClave: null } : {}), correoProbadoAt: probada ? new Date() : null, correoError: error },
    });
    await auditar(s, "administraciones.correo", id, probada, `${a.nombre} · ${cuenta}${nueva ? " · clave nueva" : ""} · ${probada ? "Gmail la aceptó" : clave ? `Gmail no la aceptó: ${error}` : "sin clave"}`);
    return { ok: true, probada, aviso: !clave ? "Falta la clave de aplicación: sin ella no sale nada desde esta cuenta." : error || undefined };
}

/** Probar la cuenta; con `mandarA`, además manda un correo de prueba (sin las copias fijas, para no llenarles la casilla). */
export async function probarCorreoAdm(id: string, mandarA?: string | null): Promise<{ ok: boolean; error?: string }> {
    const s = await sesion("usuarios.editar");
    const a = await prisma.administracion.findUnique({ where: { id }, select: { id: true, nombre: true, correoCuenta: true, correoClave: true, correoNombre: true } });
    if (!a?.correoCuenta || !a.correoClave) return { ok: false, error: "Primero cargá la casilla y su clave de aplicación." };
    const cuenta = { cuenta: a.correoCuenta, clave: a.correoClave, nombre: a.correoNombre || a.nombre };
    const p = await probarCuenta(cuenta);
    await prisma.administracion.update({ where: { id }, data: { correoProbadoAt: p.ok ? new Date() : null, correoError: p.ok ? null : p.error || "Gmail no la aceptó" } });
    if (!p.ok || !mandarA) return p;
    const para = String(mandarA).trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(para)) return { ok: false, error: "Ese destinatario no tiene forma de correo." };
    const r = await enviarCorreo({ para, asunto: `Prueba de correo · ${a.nombre}`, texto: `Este es un correo de prueba de OmniAccess.\n\nSi lo recibís, ${a.nombre} ya puede escribirles a sus lotes desde ${a.correoCuenta}.` }, { desde: cuenta, sinCopia: true });
    await auditar(s, "administraciones.correo.prueba", id, r.ok, `${a.nombre} · desde ${a.correoCuenta} · ${r.ok ? "salió" : r.error}`);
    return r.ok ? { ok: true } : { ok: false, error: r.error };
}

export async function quitarCorreoAdm(id: string): Promise<{ ok: boolean }> {
    const s = await sesion("usuarios.editar");
    const a = await prisma.administracion.update({ where: { id }, data: { correoCuenta: null, correoNombre: null, correoClave: null, correoProbadoAt: null, correoError: null }, select: { nombre: true } }).catch(() => null);
    if (a) await auditar(s, "administraciones.correo.quitar", id, true, a.nombre);
    return { ok: !!a };
}

/** La copia fija de todos los envíos (Ajustes › Correo), para decirla al lado de cada cuenta. */
export async function copiaDeLosCorreos(): Promise<string> {
    await sesion("usuarios");
    return copiaFija();
}
