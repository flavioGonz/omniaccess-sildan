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
        // Cualquier persona con empresa (proveedor, móvil propio, personal): sus vehículos, sus
        // credenciales de matrícula y, si no tiene ninguna cargada, la matrícula escrita en el
        // nombre («Delivery SOJ924», «Sildan SPA221»).
        prisma.user.findMany({ where: { empresa: { not: null } }, select: { name: true, empresa: true, vehicles: { select: { plate: true } }, credentials: { where: { type: "PLATE" as any }, select: { value: true } } } }),
    ]);
    const out: Record<string, LogoDeMatricula> = {};
    const poner = (plate: string | null, empresa: string | null) => {
        const e = empresaDe(empresa, catalogo);
        if (plate && e?.logo) out[plate.toUpperCase()] = { nombre: e.nombre, logo: e.logo, transparente: e.transparente };
    };
    const chapa = (v: string | null | undefined) => String(v || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    proveedores.forEach((p: any) => {
        const chapas = new Set<string>([...(p.vehicles || []).map((v: any) => chapa(v.plate)), ...(p.credentials || []).map((c: any) => chapa(c.value))].filter(Boolean));
        if (!chapas.size) (String(p.name || "").toUpperCase().match(/\b[A-Z]{3}\s?-?\d{3,4}\b/g) || []).forEach((m) => chapas.add(chapa(m)));
        chapas.forEach((c) => poner(c, p.empresa));
    });
    // La visita va después: si hoy entró como otra cosa, manda lo de hoy.
    visitas.forEach((v) => poner(v.plate, v.empresa));
    return out;
}
