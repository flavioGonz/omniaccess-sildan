import { prisma } from "@/lib/prisma";
import { CLAVE_EMPRESAS, empresaDe, normalizarCatalogo, type Empresa } from "@/lib/empresas";

/**
 * El catálogo de empresas y el cruce matrícula → logo, sin chequeo de sesión: lo llaman las
 * acciones (que sí lo chequean) y la API de la pantalla de pared, que entra con su enlace
 * de sólo lectura y no tiene sesión del panel.
 */

export type LogoDeMatricula = { nombre: string; logo: string; transparente: boolean };

export async function leerCatalogo(): Promise<Empresa[]> {
    const fila = await prisma.setting.findUnique({ where: { key: CLAVE_EMPRESAS } });
    let crudo: unknown = null;
    try { crudo = fila?.value ? JSON.parse(fila.value) : null; } catch { crudo = null; }
    return normalizarCatalogo(crudo);
}

/**
 * Qué matrículas son de qué empresa, ahora: la de cada visita abierta que tiene empresa, y
 * la de cada vehículo de un proveedor registrado. Sólo vuelven las que tienen logo cargado
 * y la empresa activa.
 */
export async function logosDeMatriculas(): Promise<Record<string, LogoDeMatricula>> {
    const catalogo = (await leerCatalogo()).filter((e) => e.activa && e.logo);
    if (!catalogo.length) return {};
    const [visitas, proveedores] = await Promise.all([
        prisma.visita.findMany({ where: { sale: null, plate: { not: null }, empresa: { not: null } }, select: { plate: true, empresa: true } }),
        prisma.user.findMany({ where: { role: "PROVIDER" as any, empresa: { not: null } }, select: { empresa: true, vehicles: { select: { plate: true } } } }),
    ]);
    const out: Record<string, LogoDeMatricula> = {};
    const poner = (plate: string | null, empresa: string | null) => {
        const e = empresaDe(empresa, catalogo);
        if (plate && e?.logo) out[plate.toUpperCase()] = { nombre: e.nombre, logo: e.logo, transparente: e.transparente };
    };
    proveedores.forEach((p) => p.vehicles.forEach((v) => poner(v.plate, p.empresa)));
    // La visita va después: si hoy entró como otra cosa, manda lo de hoy.
    visitas.forEach((v) => poner(v.plate, v.empresa));
    return out;
}

/**
 * La empresa de cada matrícula EN EL MOMENTO de cada lectura (para el historial).
 *
 * `logosDeMatriculas` contesta «ahora»: la visita abierta. Un delivery de ayer ya cerró su
 * visita y con eso su lectura quedaba sin logo. Acá se busca la visita de esa matrícula que
 * estaba abierta a la hora de la lectura (con un margen: la visita se carga en la garita un
 * poco antes o después de que la cámara lea), y si no, el proveedor dueño del vehículo.
 */
const MARGEN_VISITA_MS = 30 * 60_000;
export async function empresasDeLecturas(lecturas: { clave: string; plate: string; momento: Date }[]): Promise<Map<string, LogoDeMatricula>> {
    const out = new Map<string, LogoDeMatricula>();
    if (!lecturas.length) return out;
    const catalogo = (await leerCatalogo()).filter((e) => e.activa && e.logo);
    if (!catalogo.length) return out;
    const plates = [...new Set(lecturas.map((l) => l.plate.toUpperCase()))];
    const desde = new Date(Math.min(...lecturas.map((l) => +l.momento)) - 24 * 3600_000);
    const [visitas, vehiculos] = await Promise.all([
        prisma.visita.findMany({ where: { plate: { in: plates }, empresa: { not: null }, entra: { gte: desde } }, select: { plate: true, empresa: true, entra: true, sale: true }, orderBy: { entra: "desc" } }),
        prisma.vehicle.findMany({ where: { plate: { in: plates }, user: { role: "PROVIDER" as any, empresa: { not: null } } }, select: { plate: true, user: { select: { empresa: true } } } }),
    ]);
    const logo = (empresa: string | null | undefined) => {
        const e = empresaDe(empresa, catalogo);
        return e?.logo ? { nombre: e.nombre, logo: e.logo, transparente: e.transparente } : null;
    };
    const proveedor = new Map(vehiculos.map((v) => [v.plate.toUpperCase(), v.user?.empresa || null]));
    for (const l of lecturas) {
        const p = l.plate.toUpperCase(), t = +l.momento;
        const v = visitas.find((x) => x.plate?.toUpperCase() === p && +x.entra <= t + MARGEN_VISITA_MS && (x.sale ? +x.sale : Date.now()) >= t - MARGEN_VISITA_MS);
        const e = logo(v?.empresa) || logo(proveedor.get(p));
        if (e) out.set(l.clave, e);
    }
    return out;
}
