import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyApiAuth, unauthorizedResponse } from "@/lib/api-auth";
import { ESTADIA_VENCE_MIN } from "@/lib/estadias";

export const dynamic = "force-dynamic";

const CAMPOS = {
    id: true, plate: true, deviceId: true, cameraName: true, timestamp: true,
    confidence: true, snapshotUrl: true, reads: true, bbox: true,
    estado: true, estDesde: true, estHasta: true, estAvisado: true, estCerrada: true,
    lat: true, lng: true,
} as const;

/**
 * GET /api/tracking/recent
 *
 * Lo último que leyó Omni-LPR en las cámaras interiores. El monitor en vivo lo usa para
 * poner la matrícula sobre cada baldosa, igual que hacen las cámaras de acceso con su
 * evento. Se mira una ventana corta a propósito: si hace horas que no pasa un auto, la
 * baldosa queda limpia en vez de mostrar una lectura vieja como si fuera de ahora.
 *
 * Además de lo que pasó, devuelve lo que ESTÁ pasando: qué vehículos están estacionados
 * ahora mismo y cuáles acaban de irse. Son las dos caras de una estadía, y son la
 * información que el guardia mira sin tener que reconstruirla de una lista de lecturas.
 *
 * Y devuelve la ficha de cada matrícula que aparece — dueño, unidad, cochera, vigilancia.
 * La pantalla ya no tiene que salir a preguntar de a una: lo que se sabe del vehículo
 * viaja junto con la lectura que lo nombra.
 */
export async function GET() {
    const auth = await verifyApiAuth();
    if (!auth.authenticated) return unauthorizedResponse();

    const ahora = Date.now();
    const desde = new Date(ahora - 30 * 60 * 1000);
    // Las que se fueron se miran más atrás: un auto que se va recién se nota cuando el
    // barrendero cierra la estadía, y eso ocurre ESTADIA_VENCE_MIN después de la última
    // lectura. Con una ventana corta, "se fue" nunca llegaría a mostrarse.
    const desdePartidos = new Date(ahora - (60 + ESTADIA_VENCE_MIN) * 60 * 1000);

    const [filas, estacionados, partidos] = await Promise.all([
        prisma.plateSighting.findMany({
            where: { source: "TRACK", timestamp: { gte: desde } },
            orderBy: { timestamp: "desc" },
            take: 160,
            select: CAMPOS,
        }),
        // Estacionados ahora: la estadía está consolidada y todavía no se cerró.
        prisma.plateSighting.findMany({
            where: { source: "TRACK", estado: "ESTACIONADO", estAvisado: true, estCerrada: false },
            orderBy: { estDesde: "desc" },
            take: 24,
            select: CAMPOS,
        }),
        // Se fueron: estadías cerradas que en su momento se avisaron. Una estadía que
        // nunca llegó a ser un estacionamiento tampoco tiene de qué retirarse.
        prisma.plateSighting.findMany({
            where: {
                source: "TRACK", estado: "ESTACIONADO", estAvisado: true, estCerrada: true,
                estHasta: { gte: desdePartidos },
            },
            orderBy: { estHasta: "desc" },
            take: 24,
            select: CAMPOS,
        }),
    ]);

    const porCamara: Record<string, any> = {};
    for (const f of filas) {
        if (f.deviceId && !porCamara[f.deviceId]) porCamara[f.deviceId] = f;
    }

    // La ficha de cada matrícula nombrada, en una sola consulta por tabla.
    const patentes = [...new Set([...filas, ...estacionados, ...partidos].map((f) => f.plate))];
    const fichas: Record<string, any> = {};
    if (patentes.length) {
        const [vehiculos, vigiladas] = await Promise.all([
            prisma.vehicle.findMany({
                where: { plate: { in: patentes } },
                select: {
                    plate: true, brand: true, model: true, color: true, type: true,
                    user: {
                        select: {
                            id: true, name: true, phone: true, apartment: true, role: true,
                            unit: { select: { name: true } },
                            parkingSlot: { select: { label: true } },
                        },
                    },
                },
            }),
            prisma.plateWatch.findMany({
                where: { plate: { in: patentes }, active: true },
                select: { plate: true, label: true, category: true, color: true },
            }),
        ]);
        for (const v of vehiculos) {
            fichas[v.plate] = {
                marca: v.brand, modelo: v.model, color: v.color, tipo: v.type,
                dueno: v.user ? {
                    id: v.user.id, nombre: v.user.name, telefono: v.user.phone,
                    unidad: v.user.unit?.name || null, apartamento: v.user.apartment || null,
                    cochera: v.user.parkingSlot?.label || null, rol: v.user.role,
                } : null,
            };
        }
        for (const w of vigiladas) {
            fichas[w.plate] = { ...(fichas[w.plate] || {}), vigilancia: { etiqueta: w.label, categoria: w.category, color: w.color } };
        }
    }

    return NextResponse.json({
        porCamara,
        ultimos: filas.slice(0, 40),
        estadias: { estacionados, partidos, venceMin: ESTADIA_VENCE_MIN },
        fichas,
        ahora: new Date().toISOString(),
    });
}
