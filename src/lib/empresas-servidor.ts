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
