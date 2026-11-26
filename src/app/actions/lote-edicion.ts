"use server";

import { prisma } from "@/lib/prisma";
import { getSession } from "@/app/actions/auth";
import { permisosDeSesion } from "@/lib/permisos";
import { auditar } from "@/lib/centrales/sesion";
import { anotarEnLote, auditarLotes } from "@/lib/lote-auditoria";
import { diferenciasDeDatos, limpiarChapa } from "@/lib/lote-cambios";
import { correoSirve } from "@/lib/censo-invitaciones";
import { createCredential, deleteCredential } from "@/app/actions/credentials";
import { normalizarChapa } from "@/lib/formato-chapa";
import { cuandoViene, ordenarDias, rotuloServicio, TIPOS_SERVICIO } from "@/lib/servicios-lote";

/**
 * Corregir un lote a mano, desde su cajón en Administraciones (25/11).
 *
 * Nico: «desde el drawer del lote, en administraciones, se debe poder editar a mano, y quedar en el
 * historial el cambio, para llevar un registro de cambios en cada info del lote». Hasta acá el
 * cajón mostraba y sólo dejaba mover el punto en el mapa: para sumar una persona o sacarle una
 * matrícula había que ir al padrón, buscarla y volver, y el historial del lote se enteraba un
 * minuto después, sin saber quién había sido.
 *
 * Cada acción deja su renglón en el historial del lote con la firma de quien está en el panel:
 *   · Las personas que entran o salen y las matrículas que se suman o se quitan, por la misma
 *     auditoría de siempre (auditarLotes, que compara la foto del lote), pero firmada ya.
 *   · Lo que la foto no ve —el titular, la situación, la ubicación, el correo o el teléfono de una
 *     persona— con un renglón propio que dice qué decía antes y qué dice ahora.
 *
 * Las matrículas pasan por las mismas acciones que la pantalla de credenciales: llegan (o se van)
 * de las listas de las cámaras de lectura igual que si se cargaran allá.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- la sesión es el JWT crudo
async function sesion(): Promise<any> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s: any = await getSession().catch(() => null);
    if (!s || !permisosDeSesion(s).includes("usuarios.editar")) throw new Error("Tu rol no puede corregir lotes.");
    return s;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const firma = (s: any) => ({ quien: String(s?.name || s?.sub || "") || null, origen: "panel" as const });

export type Resultado = { ok: boolean; error?: string };
const VINCULOS = ["PROPIETARIO", "INQUILINO", "OCUPANTE", "FAMILIA"] as const;
const VINCULO_DICE: Record<string, string> = { PROPIETARIO: "propietario", INQUILINO: "inquilino", OCUPANTE: "ocupante", FAMILIA: "familia" };
const SITUACIONES = ["", "TERRENO", "DESARROLLADOR", "SIN_TITULAR"] as const;
const SITUACION_DICE: Record<string, string> = { "": "con su gente", TERRENO: "terreno", DESARROLLADOR: "del desarrollador", SIN_TITULAR: "sin titular" };
const corto = (t: unknown, n = 120) => String(t ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const soloTel = (t: unknown) => String(t ?? "").replace(/[^\d+ ]/g, "").replace(/\s+/g, " ").trim().slice(0, 30);

/* ───────── Los datos del lote ───────── */

/** El titular según la administración y la situación (terreno, del desarrollador…). */
export async function editarDatosLote(unitId: string, d: { titular?: string; situacion?: string }): Promise<Resultado> {
    const s = await sesion();
    const u = await prisma.unit.findUnique({ where: { id: unitId }, select: { id: true, name: true, titular: true, situacion: true } });
    if (!u) return { ok: false, error: "Ese lote ya no existe." };
    const nuevo: { titular?: string | null; situacion?: string | null } = {};
    if (d.titular !== undefined) nuevo.titular = corto(d.titular, 200) || null;
    if (d.situacion !== undefined) {
        if (!(SITUACIONES as readonly string[]).includes(d.situacion)) return { ok: false, error: "Esa situación no existe." };
        nuevo.situacion = d.situacion || null;
    }
    const dif = diferenciasDeDatos(
        { titular: u.titular, situacion: SITUACION_DICE[u.situacion || ""] },
        { ...(nuevo.titular !== undefined ? { titular: nuevo.titular } : {}), ...(nuevo.situacion !== undefined ? { situacion: SITUACION_DICE[nuevo.situacion || ""] } : {}) },
        { titular: "Titular", situacion: "Situación" },
    );
    if (!dif.length) return { ok: true };
    await prisma.unit.update({ where: { id: u.id }, data: nuevo });
    await anotarEnLote([u.id], { que: "DATO_CAMBIADO", detalle: dif.join(" · ") }, firma(s));
    await auditar(s, "lotes.datos", u.name, true, dif.join(" · "));
    return { ok: true };
}

/* ───────── La gente ───────── */

export type PersonaParaSumar = { id: string; nombre: string; email: string | null; lotes: string };
/** Buscar en el padrón a quien sumar al lote: así no se crea dos veces a alguien que ya está. */
export async function buscarPersonasParaLote(unitId: string, q: string): Promise<PersonaParaSumar[]> {
    await sesion();
    const t = corto(q, 60);
    if (t.length < 2) return [];
    const gente = await prisma.user.findMany({
        where: { OR: [{ name: { contains: t, mode: "insensitive" } }, { email: { contains: t, mode: "insensitive" } }, { phone: { contains: t.replace(/\D/g, "") || t } }], NOT: { vinculos: { some: { unitId } } } },
        select: { id: true, name: true, email: true, vinculos: { select: { unit: { select: { name: true } } }, take: 3 } },
        orderBy: { name: "asc" }, take: 8,
    });
    return gente.map((g) => ({ id: g.id, nombre: g.name, email: g.email, lotes: g.vinculos.map((v) => v.unit.name).join(", ") }));
}

/**
 * Sumar una persona al lote: alguien que ya está en el padrón (`userId`) o una nueva (`nueva`).
 * La entrada al lote la anota la auditoría («Entró al lote»), firmada.
 */
export async function sumarPersonaALote(unitId: string, d: { userId?: string; nueva?: { nombre: string; email?: string; telefono?: string }; vinculo: string }): Promise<Resultado> {
    const s = await sesion();
    if (!(VINCULOS as readonly string[]).includes(d.vinculo)) return { ok: false, error: "Elegí qué es del lote." };
    const u = await prisma.unit.findUnique({ where: { id: unitId }, select: { id: true, name: true } });
    if (!u) return { ok: false, error: "Ese lote ya no existe." };
    let userId = d.userId || "";
    if (!userId) {
        const nombre = corto(d.nueva?.nombre);
        if (nombre.length < 2) return { ok: false, error: "Falta el nombre." };
        const email = corto(d.nueva?.email).toLowerCase();
        if (email && !correoSirve(email)) return { ok: false, error: "Ese correo no tiene forma de correo." };
        if (email) {
            const ya = await prisma.user.findFirst({ where: { email: { equals: email, mode: "insensitive" } }, select: { name: true } });
            if (ya) return { ok: false, error: `Ese correo ya es de ${ya.name}: buscala en «Alguien del padrón».` };
        }
        const creada = await prisma.user.create({ data: { name: nombre, email: email || null, phone: soloTel(d.nueva?.telefono) || null, unitId: u.id, role: "RESIDENT", createdBy: firma(s).quien || "panel" }, select: { id: true } });
        userId = creada.id;
    } else {
        const p = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, unitId: true } });
        if (!p) return { ok: false, error: "Esa persona ya no está en el padrón." };
        if (!p.unitId) await prisma.user.update({ where: { id: p.id }, data: { unitId: u.id } });
    }
    await prisma.userUnidad.upsert({ where: { userId_unitId: { userId, unitId: u.id } }, update: { vinculo: d.vinculo }, create: { userId, unitId: u.id, vinculo: d.vinculo } });
    await auditarLotes({ ...firma(s), personas: [userId] });
    await auditar(s, "lotes.persona.sumar", u.name, true, `${d.userId ? "del padrón" : "nueva"} · ${VINCULO_DICE[d.vinculo]}`);
    return { ok: true };
}

/** Corregir el nombre, el correo, el teléfono o qué es del lote una persona. Queda qué decía y qué dice. */
export async function editarPersonaDeLote(unitId: string, userId: string, d: { nombre?: string; email?: string; telefono?: string; vinculo?: string }): Promise<Resultado> {
    const s = await sesion();
    const v = await prisma.userUnidad.findFirst({ where: { unitId, userId }, select: { vinculo: true, user: { select: { name: true, email: true, phone: true } } } });
    if (!v) return { ok: false, error: "Esa persona no está en este lote." };
    const nuevo: { name?: string; email?: string | null; phone?: string | null } = {};
    if (d.nombre !== undefined) { const n = corto(d.nombre); if (n.length < 2) return { ok: false, error: "Falta el nombre." }; nuevo.name = n; }
    if (d.email !== undefined) {
        const e = corto(d.email).toLowerCase();
        if (e && !correoSirve(e)) return { ok: false, error: "Ese correo no tiene forma de correo." };
        if (e && e !== (v.user.email || "").toLowerCase()) {
            const ya = await prisma.user.findFirst({ where: { email: { equals: e, mode: "insensitive" }, NOT: { id: userId } }, select: { name: true } });
            if (ya) return { ok: false, error: `Ese correo ya es de ${ya.name}.` };
        }
        nuevo.email = e || null;
    }
    if (d.telefono !== undefined) nuevo.phone = soloTel(d.telefono) || null;
    if (d.vinculo !== undefined && !(VINCULOS as readonly string[]).includes(d.vinculo)) return { ok: false, error: "Elegí qué es del lote." };
    const dif = diferenciasDeDatos(
        { nombre: v.user.name, correo: v.user.email, telefono: v.user.phone, vinculo: VINCULO_DICE[v.vinculo] || v.vinculo },
        { ...("name" in nuevo ? { nombre: nuevo.name } : {}), ...("email" in nuevo ? { correo: nuevo.email } : {}), ...("phone" in nuevo ? { telefono: nuevo.phone } : {}), ...(d.vinculo ? { vinculo: VINCULO_DICE[d.vinculo] } : {}) },
        { nombre: "Nombre", correo: "Correo", telefono: "Teléfono", vinculo: "En el lote" },
    );
    if (!dif.length) return { ok: true };
    if (Object.keys(nuevo).length) await prisma.user.update({ where: { id: userId }, data: nuevo });
    if (d.vinculo && d.vinculo !== v.vinculo) await prisma.userUnidad.update({ where: { userId_unitId: { userId, unitId } }, data: { vinculo: d.vinculo } });
    await anotarEnLote([unitId], { que: "PERSONA_EDITADA", persona: nuevo.name || v.user.name, userId, detalle: dif.join(" · ") }, firma(s));
    await auditar(s, "lotes.persona.editar", unitId, true, dif.join(" · "));
    return { ok: true };
}

/**
 * Sacar a una persona del lote. No se la borra del padrón (puede estar en otro lote, o mudarse
 * dentro del barrio): sólo deja de figurar acá. La salida la anota la auditoría («Salió del lote»).
 */
export async function quitarPersonaDeLote(unitId: string, userId: string): Promise<Resultado> {
    const s = await sesion();
    const v = await prisma.userUnidad.findFirst({ where: { unitId, userId }, select: { id: true, unit: { select: { name: true } }, user: { select: { name: true, unitId: true } } } });
    if (!v) return { ok: false, error: "Esa persona ya no está en este lote." };
    await prisma.userUnidad.delete({ where: { id: v.id } });
    /* Si éste era su lote principal, pasa a ser otro de los suyos, o ninguno. */
    if (v.user.unitId === unitId) {
        const otro = await prisma.userUnidad.findFirst({ where: { userId }, orderBy: { createdAt: "asc" }, select: { unitId: true } });
        await prisma.user.update({ where: { id: userId }, data: { unitId: otro?.unitId || null } });
    }
    await auditarLotes({ ...firma(s), personas: [userId] });
    await auditar(s, "lotes.persona.quitar", v.unit.name, true, v.user.name);
    return { ok: true };
}

/* ───────── Las matrículas ───────── */

/** Una matrícula nueva para una persona del lote. Se rechaza la que ya es de otra persona: eso se mira, no se pisa. */
export async function agregarMatriculaEnLote(unitId: string, userId: string, chapa: string): Promise<Resultado> {
    const s = await sesion();
    const v = await prisma.userUnidad.findFirst({ where: { unitId, userId }, select: { user: { select: { name: true } } } });
    if (!v) return { ok: false, error: "Esa persona no está en este lote." };
    const p = limpiarChapa(chapa);
    if (p.length < 5 || p.length > 8) return { ok: false, error: "Esa matrícula no tiene forma de matrícula." };
    const ya = await prisma.credential.findFirst({ where: { type: "PLATE", value: p }, select: { userId: true, user: { select: { name: true } } } });
    if (ya?.userId === userId) return { ok: false, error: `${v.user.name} ya tiene ${p}.` };
    if (ya) return { ok: false, error: `${p} ya es de ${ya.user?.name || "otra persona"}. Sacásela primero desde su lote.` };
    const f = new FormData();
    f.set("userId", userId); f.set("type", "PLATE"); f.set("value", p);
    await createCredential(f);                         // la manda a las cámaras y audita el lote, como en credenciales
    const veh = await prisma.vehicle.findUnique({ where: { plate: p }, select: { id: true } });
    if (!veh) await prisma.vehicle.create({ data: { plate: p, userId, notes: "Cargada desde el lote" } }).catch(() => null);
    await auditarLotes({ ...firma(s), personas: [userId] });   // por si la de credenciales corrió sin firma
    await auditar(s, "lotes.matricula.sumar", unitId, true, `${p} · ${v.user.name}`);
    return { ok: true };
}

/** Quitarle una matrícula a una persona del lote: deja de abrir y sale de las listas de las cámaras. */
export async function quitarMatriculaEnLote(unitId: string, userId: string, chapa: string): Promise<Resultado> {
    const s = await sesion();
    const v = await prisma.userUnidad.findFirst({ where: { unitId, userId }, select: { user: { select: { name: true } } } });
    if (!v) return { ok: false, error: "Esa persona no está en este lote." };
    const p = limpiarChapa(chapa);
    const creds = await prisma.credential.findMany({ where: { type: "PLATE", userId }, select: { id: true, value: true } });
    const suyas = creds.filter((c) => limpiarChapa(c.value) === p);
    for (const c of suyas) await deleteCredential(c.id);
    /* La ficha del vehículo también cuenta como «entra con esta matrícula» para el lote: se borra con
       ella, como hace la ficha de la persona cuando se le saca un vehículo (las lecturas de la cámara
       guardan la chapa como texto, no cuelgan de esta ficha). */
    const vehs = await prisma.vehicle.findMany({ where: { userId }, select: { id: true, plate: true } });
    const fichas = vehs.filter((x) => limpiarChapa(x.plate) === p);
    if (fichas.length) await prisma.vehicle.deleteMany({ where: { id: { in: fichas.map((x) => x.id) } } });
    if (!suyas.length && !fichas.length) return { ok: false, error: `${v.user.name} no tiene ${p}.` };
    await auditarLotes({ ...firma(s), personas: [userId] });
    await auditar(s, "lotes.matricula.quitar", unitId, true, `${p} · ${v.user.name}`);
    return { ok: true };
}

/* ───────── Un lote nuevo ───────── */

/**
 * Crear un lote a mano, desde Unidades (25/11). Lo normal es que lleguen con la planilla del padrón;
 * esto es para el que falta (un desdoblamiento, una casa nueva). Queda anotado en su historial.
 */
export async function crearLote(d: { nombre: string; administracionId: string | null; titular?: string; situacion?: string }): Promise<Resultado & { id?: string }> {
    const s = await sesion();
    const nombre = corto(d.nombre, 60);
    if (nombre.length < 1) return { ok: false, error: "Falta el nombre del lote." };
    if (d.situacion && !(SITUACIONES as readonly string[]).includes(d.situacion)) return { ok: false, error: "Esa situación no existe." };
    const ya = await prisma.unit.findFirst({ where: { name: { equals: nombre, mode: "insensitive" } }, select: { id: true } });
    if (ya) return { ok: false, error: `Ya hay un lote «${nombre}».` };
    const u = await prisma.unit.create({ data: { name: nombre, lot: nombre, type: "CASA", administracionId: d.administracionId || null, titular: corto(d.titular, 200) || null, situacion: d.situacion || null }, select: { id: true } });
    await anotarEnLote([u.id], { que: "DATO_CAMBIADO", detalle: `Lote creado a mano${d.titular ? ` · Titular: «${corto(d.titular, 200)}»` : ""}` }, firma(s));
    await auditar(s, "lotes.crear", nombre, true, "");
    return { ok: true, id: u.id };
}

/* ───────── Los servicios del lote (26/11) ───────── */

export type ServicioDeLote = {
    id: string; tipo: string; nombre: string; telefono: string | null; documento: string | null; chapa: string | null;
    dias: string[]; desde: string | null; hasta: string | null; notas: string | null; estado: string; origen: string; createdAt: string;
    /** Entrada habilitada por matrícula en sus días y horario (26/11, lib-proveedores). */
    autorizado: boolean; autorizadoPor: string | null;
};

/** Los servicios de un lote: los activos primero. */
export async function serviciosDeLote(unitId: string): Promise<ServicioDeLote[]> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- la sesión es el JWT crudo
    const s: any = await getSession().catch(() => null);
    if (!s || !permisosDeSesion(s).includes("usuarios")) throw new Error("Tu rol no puede ver el padrón.");
    const filas = await prisma.servicioLote.findMany({ where: { unitId }, orderBy: [{ estado: "asc" }, { createdAt: "asc" }] });
    return filas.map((f) => ({ id: f.id, tipo: f.tipo, nombre: f.nombre, telefono: f.telefono, documento: f.documento, chapa: f.chapa, dias: ordenarDias(f.dias), desde: f.desde, hasta: f.hasta, notas: f.notas, estado: f.estado, origen: f.origen, createdAt: f.createdAt.toISOString(), autorizado: f.autorizado, autorizadoPor: f.autorizadoPor }));
}

const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;
/** Sumar o corregir un servicio del lote. Queda en su historial con lo que decía antes y lo que dice ahora. */
export async function guardarServicioLote(unitId: string, d: { id?: string; tipo: string; nombre: string; telefono?: string; documento?: string; chapa?: string; dias?: string[]; desde?: string; hasta?: string; notas?: string; autorizado?: boolean }): Promise<Resultado & { id?: string }> {
    const s = await sesion();
    const u = await prisma.unit.findUnique({ where: { id: unitId }, select: { id: true, name: true } });
    if (!u) return { ok: false, error: "Ese lote ya no existe." };
    if (!TIPOS_SERVICIO.some((t) => t.id === d.tipo)) return { ok: false, error: "Elegí qué servicio es." };
    const nombre = corto(d.nombre, 80);
    if (!nombre && !d.chapa?.trim()) return { ok: false, error: "Poné quién es (o al menos la matrícula con la que viene)." };
    const crudo = String(d.chapa || "").trim();
    const chapa = crudo ? (normalizarChapa(crudo)?.plate || limpiarChapa(crudo)) : null;
    if (chapa && (chapa.length < 5 || chapa.length > 8)) return { ok: false, error: "Esa matrícula no tiene forma de matrícula." };
    if ((d.desde && !HORA.test(d.desde)) || (d.hasta && !HORA.test(d.hasta))) return { ok: false, error: "La hora va como 08:00." };
    const data = { tipo: d.tipo, nombre, telefono: soloTel(d.telefono) || null, documento: corto(d.documento, 20) || null, chapa, dias: ordenarDias(d.dias), desde: d.desde || null, hasta: d.hasta || null, notas: corto(d.notas, 300) || null };
    const dice = (x: { tipo: string; nombre: string }) => `${rotuloServicio(x.tipo)}${x.nombre ? ` ${x.nombre}` : ""}`;
    // La entrada se habilita sólo con matrícula y días: es lo que el servidor mira en la barrera.
    const puedeEntrar = !!data.chapa && data.dias.length > 0;
    if (d.autorizado && !puedeEntrar) return { ok: false, error: "Para habilitar su entrada hacen falta la matrícula y los días que viene." };
    if (d.id) {
        const antes = await prisma.servicioLote.findFirst({ where: { id: d.id, unitId } });
        if (!antes) return { ok: false, error: "Ese servicio ya no está." };
        const dif = diferenciasDeDatos(
            { tipo: rotuloServicio(antes.tipo), nombre: antes.nombre, telefono: antes.telefono, chapa: antes.chapa, cuando: cuandoViene(antes), notas: antes.notas },
            { tipo: rotuloServicio(data.tipo), nombre: data.nombre, telefono: data.telefono, chapa: data.chapa, cuando: cuandoViene(data), notas: data.notas },
            { tipo: "Servicio", nombre: "Quién", telefono: "Teléfono", chapa: "Matrícula", cuando: "Cuándo viene", notas: "Notas" },
        );
        // Si le sacaron la matrícula o los días, la entrada se apaga sola (no habría con qué decidirla).
        const autorizado = d.autorizado === undefined ? antes.autorizado && puedeEntrar : !!d.autorizado;
        if (autorizado !== antes.autorizado) dif.push(autorizado ? "Entrada habilitada en su horario" : "Entrada deshabilitada");
        if (!dif.length) return { ok: true, id: antes.id };
        await prisma.servicioLote.update({ where: { id: antes.id }, data: { ...data, autorizado, ...(autorizado !== antes.autorizado ? { autorizadoPor: autorizado ? firma(s).quien : null, autorizadoAt: autorizado ? new Date() : null } : {}) } });
        await anotarEnLote([u.id], { que: "SERVICIO_EDITADO", persona: dice(data), chapa: data.chapa || undefined, detalle: dif.join(" · ") }, firma(s));
        await auditar(s, "lotes.servicio.editar", u.name, true, dif.join(" · "));
        return { ok: true, id: antes.id };
    }
    const autorizado = !!d.autorizado && puedeEntrar;
    const nuevo = await prisma.servicioLote.create({ data: { ...data, unitId: u.id, origen: "panel", creadoPor: firma(s).quien, autorizado, autorizadoPor: autorizado ? firma(s).quien : null, autorizadoAt: autorizado ? new Date() : null } });
    await anotarEnLote([u.id], { que: "SERVICIO_ALTA", persona: dice(data), chapa: data.chapa || undefined, detalle: [cuandoViene(data), data.telefono, autorizado ? "entrada habilitada en su horario" : null].filter(Boolean).join(" · ") || undefined }, firma(s));
    await auditar(s, "lotes.servicio.crear", u.name, true, dice(data));
    return { ok: true, id: nuevo.id };
}

/**
 * Habilitar o quitar la entrada de un proveedor por su matrícula, en sus días y horario (26/11).
 * La decide el servidor en la barrera (lib-proveedores.js): no se carga en la lista blanca de la
 * cámara, que no sabe de días ni horas y lo dejaría entrar siempre.
 */
export async function autorizarServicioLote(unitId: string, id: string, autorizado: boolean): Promise<Resultado> {
    const s = await sesion();
    const f = await prisma.servicioLote.findFirst({ where: { id, unitId } });
    if (!f) return { ok: false, error: "Ese servicio ya no está." };
    if (autorizado && (!f.chapa || !ordenarDias(f.dias).length)) return { ok: false, error: "Para habilitar su entrada hacen falta la matrícula y los días que viene: corregilo primero." };
    if (autorizado && f.estado !== "ACTIVO") return { ok: false, error: "Ese servicio está dado de baja." };
    await prisma.servicioLote.update({ where: { id }, data: { autorizado, autorizadoPor: autorizado ? firma(s).quien : null, autorizadoAt: autorizado ? new Date() : null } });
    await anotarEnLote([unitId], { que: "SERVICIO_EDITADO", persona: `${rotuloServicio(f.tipo)}${f.nombre ? ` ${f.nombre}` : ""}`, chapa: f.chapa || undefined, detalle: autorizado ? `Entrada habilitada por matrícula: ${cuandoViene(f)}.` : "Entrada deshabilitada: se lo identifica, pero no entra solo." }, firma(s));
    await auditar(s, autorizado ? "lotes.servicio.habilitar" : "lotes.servicio.deshabilitar", f.chapa || f.nombre, true, cuandoViene(f));
    return { ok: true };
}

/** Dejó de venir: se da de baja (queda en el registro) o se vuelve a activar. */
export async function estadoServicioLote(unitId: string, id: string, activo: boolean): Promise<Resultado> {
    const s = await sesion();
    const f = await prisma.servicioLote.findFirst({ where: { id, unitId } });
    if (!f) return { ok: false, error: "Ese servicio ya no está." };
    // Darlo de baja también le quita la entrada: el que dejó de venir no entra más solo.
    await prisma.servicioLote.update({ where: { id }, data: { estado: activo ? "ACTIVO" : "INACTIVO", ...(activo ? {} : { autorizado: false, autorizadoPor: null, autorizadoAt: null }) } });
    await anotarEnLote([unitId], { que: activo ? "SERVICIO_ALTA" : "SERVICIO_BAJA", persona: `${rotuloServicio(f.tipo)}${f.nombre ? ` ${f.nombre}` : ""}`, chapa: f.chapa || undefined, detalle: activo ? "Volvió a activarse." : "Dejó de venir." }, firma(s));
    await auditar(s, activo ? "lotes.servicio.activar" : "lotes.servicio.baja", f.nombre || f.tipo, true, "");
    return { ok: true };
}
