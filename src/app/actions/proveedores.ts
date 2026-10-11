"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { getSession } from "@/app/actions/auth";
import { credencialesVisibles } from "@/lib/credenciales-visibles";
import { ZONA } from "@/lib/fechas";
import { permanencia, type Pasada } from "@/lib/planilla";

/**
 * Proveedores: no duplicarlos, y su planilla de empleados.
 *
 * Un proveedor es una empresa (Sildan, la jardinería) con sus vehículos y sus credenciales. Su
 * planilla son las personas que trabajan para ella: cada una con su credencial propia y un
 * «autorizado» que pone la empresa. Ver lib/planilla para cómo se calcula la permanencia.
 */

/** Cuántos parecidos se ofrecen al escribir el nombre: más que esto ya no ayuda a elegir. */
const PARECIDOS_MAX = 6;
/** Lo que se mira hacia atrás en la planilla. */
export type RangoPlanilla = 1 | 7 | 30;

const dia = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: ZONA }).format(d);

async function quienSoy(): Promise<string | null> {
    try { const s: any = await getSession(); return (s?.sub as string) || null; } catch { return null; }
}

/** Los proveedores que se parecen a lo escrito (nombre o empresa): para no cargar el mismo dos veces. */
export async function buscarProveedores(q: string, excluirId?: string) {
    const t = String(q || "").trim();
    if (t.length < 2) return [];
    const r = await prisma.user.findMany({
        where: {
            role: "PROVIDER", empleadorId: null, ...(excluirId ? { id: { not: excluirId } } : {}),
            OR: [{ name: { contains: t, mode: "insensitive" } }, { empresa: { contains: t, mode: "insensitive" } }],
        },
        select: { id: true, name: true, empresa: true, accessTags: true, vehicles: { select: { plate: true } }, _count: { select: { empleados: true } } },
        orderBy: { name: "asc" }, take: PARECIDOS_MAX,
    });
    return r.map((u) => ({ id: u.id, nombre: u.name, empresa: u.empresa, matriculas: u.vehicles.map((v) => v.plate), tags: u.accessTags.length, empleados: u._count.empleados }));
}

/** La ficha completa de una persona, con la misma forma que la lista de Usuarios (para abrirla en el cajón). */
export async function getFichaUsuario(id: string) {
    const u = await prisma.user.findUnique({
        where: { id },
        include: { unit: true, credentials: true, accessGroups: { include: { devices: true } }, vehicles: true, parkingSlot: true, empleador: { select: { id: true, name: true, empresa: true } } },
    });
    if (!u) return null;
    return { ...u, credentials: credencialesVisibles(u.credentials, u, await quienSoy()) };
}

export type EmpleadoPlanilla = {
    id: string; nombre: string; dni: string | null; autorizado: boolean; cara: string | null;
    credenciales: string[];
    adentroDesde: string | null; totalMin: number; dias: number; sinSalida: number; salidasSinEntrada: number; ultima: string | null;
    hoyMin: number;
    /** Pasadas concedidas desde que la empresa lo marcó no autorizado: entró igual. */
    pasoSinAutorizacion: number;
};

export async function getPlanilla(proveedorId: string, rango: RangoPlanilla = 7) {
    const ahora = new Date();
    const desde = new Date(ahora.getTime() - rango * 86_400_000);
    const [prov, empleados] = await Promise.all([
        prisma.user.findUnique({ where: { id: proveedorId }, select: { vehicles: { select: { plate: true } }, credentials: { where: { type: "PLATE" as any }, select: { value: true } } } }),
        prisma.user.findMany({
            where: { empleadorId: proveedorId },
            select: { id: true, name: true, dni: true, autorizado: true, autorizadoCambio: true, cara: true, accessTags: true, credentials: { select: { type: true } }, vehicles: { select: { plate: true } } },
            orderBy: { name: "asc" },
        }),
    ]);
    const eventos = empleados.length ? await prisma.accessEvent.findMany({
        where: { userId: { in: empleados.map((e) => e.id) }, timestamp: { gte: new Date(desde.getTime() - 86_400_000) } },
        select: { userId: true, timestamp: true, direction: true, decision: true },
        orderBy: { timestamp: "asc" },
    }) : [];
    const porEmpleado = new Map<string, Pasada[]>();
    for (const e of eventos) {
        if (!e.userId) continue;
        const l = porEmpleado.get(e.userId) || [];
        l.push({ userId: e.userId, t: e.timestamp, direccion: e.direction as any, concedida: e.decision === "GRANT" });
        porEmpleado.set(e.userId, l);
    }
    const hoy = dia(ahora);
    const filas: EmpleadoPlanilla[] = empleados.map((e) => {
        const pasadas = porEmpleado.get(e.id) || [];
        const p = permanencia(pasadas, ahora, dia);
        // Las estadías que empiezan antes del rango quedan afuera: el día de antes se trae sólo
        // para no perder una entrada de anoche cuya salida cae dentro del rango.
        const enRango = p.estadias.filter((x) => +x.entra >= +desde);
        const totalMin = Math.round(enRango.reduce((s, x) => s + (x.minutos || 0), 0));
        const hoyMin = Math.round(enRango.filter((x) => dia(x.entra) === hoy).reduce((s, x) => s + (x.minutos || 0), 0));
        const tipos = new Set(e.credentials.map((c) => String(c.type)));
        const credenciales = [
            e.vehicles.length ? `${e.vehicles.length} ${e.vehicles.length === 1 ? "matrícula" : "matrículas"}` : null,
            e.accessTags.length || tipos.has("TAG") ? "tarjeta" : null,
            tipos.has("PIN") ? "PIN" : null,
            e.cara ? "rostro" : null,
        ].filter(Boolean) as string[];
        const pasoSinAutorizacion = !e.autorizado
            ? pasadas.filter((x) => x.concedida && x.direccion === "ENTRY" && (!e.autorizadoCambio || +x.t >= +e.autorizadoCambio)).length
            : 0;
        return {
            id: e.id, nombre: e.name, dni: e.dni, autorizado: e.autorizado, cara: e.cara, credenciales,
            adentroDesde: p.adentroDesde?.toISOString() || null, totalMin, dias: new Set(enRango.map((x) => dia(x.entra)).concat(p.adentroDesde ? [dia(p.adentroDesde)] : [])).size,
            sinSalida: enRango.filter((x) => x.sinSalida).length, salidasSinEntrada: p.salidasSinEntrada, ultima: p.ultima?.toISOString() || null,
            hoyMin, pasoSinAutorizacion,
        };
    });

    // Los vehículos de la empresa: sus visitas (las abre la cámara de Entrada, ver lib/visitas/motor).
    const placas = [...new Set([...(prov?.vehicles || []).map((v) => v.plate), ...(prov?.credentials || []).map((c) => c.value)])];
    const visitas = placas.length ? await prisma.visita.findMany({ where: { plate: { in: placas }, entra: { gte: desde } }, select: { entra: true, sale: true } }) : [];
    const vehiculos = {
        entradas: visitas.length,
        totalMin: Math.round(visitas.filter((v) => v.sale).reduce((s, v) => s + (+v.sale! - +v.entra) / 60_000, 0)),
        adentro: visitas.filter((v) => !v.sale).length,
    };
    return { rango, empleados: filas, vehiculos, sinVehiculos: placas.length === 0 };
}

/** Suma una persona a la planilla. Sale con el rol de proveedor y la empresa de su empleador. */
export async function agregarEmpleado(proveedorId: string, d: { nombre: string; dni?: string; autorizado: boolean }) {
    const nombre = String(d.nombre || "").trim();
    if (!nombre) throw new Error("Falta el nombre.");
    const prov = await prisma.user.findUnique({ where: { id: proveedorId }, select: { id: true, name: true, empresa: true, role: true } });
    if (!prov || String(prov.role) !== "PROVIDER") throw new Error("La planilla es de un proveedor.");
    const dni = String(d.dni || "").replace(/\D/g, "") || null;
    // El mismo documento dos veces en la misma planilla es el mismo empleado cargado de nuevo.
    if (dni) {
        const ya = await prisma.user.findFirst({ where: { dni, empleadorId: proveedorId }, select: { name: true } });
        if (ya) throw new Error(`Ese documento ya está en la planilla (${ya.name}).`);
    }
    const u = await prisma.user.create({
        data: { name: nombre, dni, role: "PROVIDER", empresa: prov.empresa || prov.name, empleadorId: prov.id, autorizado: d.autorizado, autorizadoCambio: new Date() },
        select: { id: true },
    });
    revalidatePath("/admin/users");
    return u;
}

export async function ponerAutorizado(empleadoId: string, autorizado: boolean) {
    await prisma.user.update({ where: { id: empleadoId }, data: { autorizado, autorizadoCambio: new Date() } });
    revalidatePath("/admin/users");
}

/** Lo saca de la planilla sin borrar a la persona: su historial y sus credenciales siguen. */
export async function quitarDeLaPlanilla(empleadoId: string) {
    await prisma.user.update({ where: { id: empleadoId }, data: { empleadorId: null } });
    revalidatePath("/admin/users");
}
