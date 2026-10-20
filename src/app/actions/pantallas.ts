"use server";

import { prisma } from "@/lib/prisma";
import { getSession } from "@/app/actions/auth";
import { nuevoToken } from "@/lib/filas/pantalla";
import { SLUG_RX, aSlug } from "@/lib/filas/pantalla-comun";

/**
 * Las pantallas de fila (kiosco): alta, edición, baja y cambio de enlace.
 *
 * Todas piden sesión del panel. La pantalla pública no usa estas acciones (lee
 * /api/pantalla/<slug> con su token), así que no hay motivo para abrir ninguna sin sesión.
 */

async function exigirSesion() {
    const s = await getSession();
    if (!s) throw new Error("Necesitás iniciar sesión");
    return s;
}

export type PantallaEditable = {
    nombre: string;
    slug: string;
    deviceIds: string[];
    tema: "oscuro" | "claro";
    verEspera: boolean;
    verHora: boolean;
    mensaje: string | null;
    activa: boolean;
};

const TEMAS = ["oscuro", "claro"] as const;

/** Limpia lo que llega del formulario. El slug inválido se dice en palabras, no se corrige callado. */
function limpiar(d: PantallaEditable): PantallaEditable {
    const nombre = (d.nombre || "").trim().slice(0, 80);
    if (!nombre) throw new Error("Poné un nombre a la pantalla");
    const slug = (d.slug || "").trim().toLowerCase() || aSlug(nombre);
    if (!SLUG_RX.test(slug)) throw new Error("La dirección sólo puede tener letras minúsculas, números y guiones (sin espacios ni tildes), hasta 40");
    return {
        nombre, slug,
        deviceIds: Array.from(new Set((d.deviceIds || []).filter(Boolean))),
        tema: TEMAS.includes(d.tema) ? d.tema : "oscuro",
        verEspera: !!d.verEspera,
        verHora: !!d.verHora,
        mensaje: (d.mensaje || "").trim().slice(0, 140) || null,
        activa: d.activa !== false,
    };
}

async function slugLibre(slug: string, salvoId?: string) {
    const otra = await prisma.pantallaFila.findUnique({ where: { slug } });
    if (otra && otra.id !== salvoId) throw new Error(`Ya hay una pantalla con la dirección «${slug}»`);
}

export async function getPantallas() {
    await exigirSesion();
    return prisma.pantallaFila.findMany({ orderBy: { createdAt: "asc" } });
}

export async function crearPantalla(d: PantallaEditable) {
    await exigirSesion();
    const v = limpiar(d);
    await slugLibre(v.slug);
    return prisma.pantallaFila.create({ data: { ...v, token: nuevoToken() } });
}

export async function guardarPantalla(id: string, d: PantallaEditable) {
    await exigirSesion();
    const v = limpiar(d);
    await slugLibre(v.slug, id);
    return prisma.pantallaFila.update({ where: { id }, data: v });
}

export async function borrarPantalla(id: string) {
    await exigirSesion();
    await prisma.pantallaFila.delete({ where: { id } });
    return { ok: true };
}

/** Un enlace nuevo: el viejo deja de abrir. Para cuando la dirección se filtró o se pasó a quien no debía. */
export async function nuevoEnlacePantalla(id: string) {
    await exigirSesion();
    return prisma.pantallaFila.update({ where: { id }, data: { token: nuevoToken() } });
}

/** Los contadores de fila, para elegir qué muestra cada pantalla. */
export async function filasParaPantallas() {
    await exigirSesion();
    return prisma.device.findMany({ where: { deviceType: "QUEUE_COUNTER" }, select: { id: true, name: true, location: true }, orderBy: { name: "asc" } });
}
