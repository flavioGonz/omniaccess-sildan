import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/app/actions/auth";
import { permisosDeSesion } from "@/lib/permisos";
import { verifyApiAuth } from "@/lib/api-auth";
import type { ModeloZona } from "@/lib/zona-entrenable";

/**
 * Lo común de las rutas de /api/vision/zonas: quién puede, y cómo sale una zona hacia la pantalla.
 *
 * Mirar: cualquier sesión que no sea una pantalla (los recortes pueden tener gente). Crear,
 * cambiar, etiquetar y entrenar: quien tiene Ajustes, como las reglas de visión — etiquetar ES
 * entrenar, y una etiqueta mal puesta enseña mal.
 */
export async function puedeMirar(): Promise<NextResponse | null> {
    const auth = await verifyApiAuth();
    if (!auth.authenticated) return NextResponse.json({ error: "Sin sesión" }, { status: 401 });
    if (auth.pantalla) return NextResponse.json({ error: "No es una vista de pantalla." }, { status: 403 });
    return null;
}

export async function puedeCambiar(): Promise<{ error: NextResponse | null; quien: string | null }> {
    const s: any = await getSession();
    if (!s) return { error: NextResponse.json({ error: "Sin sesión" }, { status: 401 }), quien: null };
    if (!permisosDeSesion(s).includes("ajustes")) return { error: NextResponse.json({ error: "Sólo quien tiene Ajustes puede cambiar o entrenar analíticas." }, { status: 403 }), quien: null };
    return { error: null, quien: s.name || s.email || s.sub || null };
}

/** Lo que la pantalla necesita del modelo: los números, no los 768 pesos. */
export function resumenModelo(m: any): Omit<ModeloZona, "w" | "b" | "a" | "c"> | null {
    if (!m || !Array.isArray(m.w)) return null;
    const { w, b, a, c, ...resto } = m as ModeloZona;
    return resto;
}

export const imagen = (clave: string | null | undefined) => (clave ? `/api/vision/imagen/${clave}` : null);

export async function conteos(zonaIds: string[]) {
    const filas = zonaIds.length ? await prisma.muestraZona.groupBy({ by: ["zonaId", "etiqueta"], where: { zonaId: { in: zonaIds } }, _count: { _all: true } }) : [];
    const m = new Map<string, { pos: number; neg: number; sin: number }>();
    for (const id of zonaIds) m.set(id, { pos: 0, neg: 0, sin: 0 });
    for (const f of filas) {
        const c = m.get(f.zonaId)!;
        if (f.etiqueta === "pos") c.pos += f._count._all; else if (f.etiqueta === "neg") c.neg += f._count._all; else c.sin += f._count._all;
    }
    return m;
}

export function salida(z: any, c: { pos: number; neg: number; sin: number } | undefined, camara: string | undefined) {
    const { modelo, estado, ...resto } = z;
    return {
        ...resto,
        camara: camara || z.deviceId,
        modelo: resumenModelo(modelo),
        estado: estado ? { ...estado, muestraUrl: imagen(estado.muestra) } : null,
        conteo: c || { pos: 0, neg: 0, sin: 0 },
        forzarAt: z.forzarAt ? new Date(z.forzarAt).toISOString() : null,
        createdAt: new Date(z.createdAt).toISOString(), updatedAt: new Date(z.updatedAt).toISOString(),
    };
}
