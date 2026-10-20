import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyApiAuth, unauthorizedResponse, forbiddenResponse } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/vision/calor?camara=<id>&h=24&grupo=persona|vehiculo&quietos=0 — el mapa de calor de
 * una cámara: por dónde pasaron las personas (o los vehículos), sacado de los recorridos que ya
 * guarda el registro de detecciones (ObjetoVisto.recorrido: el pie de la caja cuadro a cuadro).
 * No le pide nada a la GPU.
 *
 * Cada pista suma UNO en cada celda que pisó, no uno por cuadro: si no, el que se queda parado
 * diez minutos pesaría como cien que pasan, y el mapa diría «acá se juntan» cuando la pregunta es
 * «por dónde circulan». Entre dos puntos seguidos del recorrido se rellenan las celdas del medio:
 * a 2 s entre cuadros un auto salta media pantalla y sin esto dejaría puntos sueltos.
 *
 * Los quietos (el recorrido entero cabe en QUIETO_MAX) quedan afuera por defecto: un auto
 * estacionado se parte en muchas pistas a lo largo del día (19/10, LPR Interior) y pintaría la
 * cochera como la zona más transitada.
 */
const COLUMNAS = 64;
const FILAS = 36;
const HORAS = new Set([6, 24, 72, 168]);
const PISTAS_MAX = 30_000;
const QUIETO_MAX = 0.02;
const GRUPOS = new Set(["persona", "vehiculo"]);

export async function GET(req: NextRequest) {
    const auth = await verifyApiAuth();
    if (!auth.authenticated) return unauthorizedResponse();
    if (auth.pantalla) return forbiddenResponse("No es una vista de pantalla.");
    const q = req.nextUrl.searchParams;
    const h = HORAS.has(Number(q.get("h"))) ? Number(q.get("h")) : 24;
    const grupo = GRUPOS.has(q.get("grupo") || "") ? q.get("grupo")! : "persona";
    const conQuietos = q.get("quietos") === "1";
    const desde = new Date(Date.now() - h * 3_600_000);

    // Las cámaras con algo de ese grupo en el rango, la más transitada primero.
    const porCamara = await prisma.objetoVisto.groupBy({
        by: ["deviceId", "camara"], where: { grupo, primeraVez: { gte: desde }, deviceId: { not: null } },
        _count: { _all: true }, orderBy: { _count: { deviceId: "desc" } }, take: 200,
    });
    const camaras = porCamara.map((c) => ({ id: c.deviceId as string, nombre: c.camara, pistas: c._count._all }));
    const camara = camaras.find((c) => c.id === q.get("camara"))?.id || camaras[0]?.id || null;
    if (!camara) return NextResponse.json({ camaras, camara: null, columnas: COLUMNAS, filas: FILAS, celdas: [], max: 0, pistas: 0, quietas: 0, recortado: false });

    const filas = await prisma.objetoVisto.findMany({
        where: { deviceId: camara, grupo, primeraVez: { gte: desde } },
        select: { recorrido: true }, orderBy: { primeraVez: "desc" }, take: PISTAS_MAX,
    });
    const celdas = new Array<number>(COLUMNAS * FILAS).fill(0);
    let pistas = 0, quietas = 0;
    const celda = (x: number, y: number) => Math.min(FILAS - 1, Math.max(0, Math.floor(y * FILAS))) * COLUMNAS + Math.min(COLUMNAS - 1, Math.max(0, Math.floor(x * COLUMNAS)));
    for (const f of filas) {
        const r = (Array.isArray(f.recorrido) ? f.recorrido : []).filter((p: any) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])) as number[][];
        if (!r.length) continue;
        const xs = r.map((p) => p[0]), ys = r.map((p) => p[1]);
        if (Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) < QUIETO_MAX) {
            quietas++;
            if (!conQuietos) continue;
        }
        pistas++;
        const pisadas = new Set<number>();
        for (let i = 0; i < r.length; i++) {
            const [x, y] = r[i];
            pisadas.add(celda(x, y));
            if (i === 0) continue;
            const [x0, y0] = r[i - 1];
            // Relleno entre dos puntos: un paso por celda en el eje más largo.
            const pasos = Math.ceil(Math.max(Math.abs(x - x0) * COLUMNAS, Math.abs(y - y0) * FILAS));
            for (let k = 1; k < pasos; k++) pisadas.add(celda(x0 + ((x - x0) * k) / pasos, y0 + ((y - y0) * k) / pasos));
        }
        for (const c of pisadas) celdas[c]++;
    }
    return NextResponse.json({
        camaras, camara, columnas: COLUMNAS, filas: FILAS, celdas, max: Math.max(0, ...celdas),
        pistas, quietas, recortado: filas.length >= PISTAS_MAX, horas: h, grupo,
    }, { headers: { "Cache-Control": "no-store" } });
}
