import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyApiAuth, unauthorizedResponse } from "@/lib/api-auth";
import { limitesDelDia } from "@/lib/fechas";

export const dynamic = "force-dynamic";

/**
 * GET /api/history/camaras?from&to — las cámaras que tienen algo en el historial, con de dónde.
 *
 * 18/10, Nico: «en el filtro de cámaras deben aparecer también» las cámaras RTSP de OmniVision. El
 * filtro se armaba con las cámaras de las filas YA cargadas (las primeras 60): las LPR, que son
 * casi todo, tapaban al resto, y una cámara con dos lecturas en la semana no aparecía nunca. Ahora
 * se le pregunta al servidor por el período entero, agrupado por origen:
 *   lpr          accesos (cámaras LPR, lectoras)
 *   seguimiento  lecturas del seguimiento (cámaras interiores con omni-lpr)
 *   omnivision   lo que OmniVision ve en las cámaras que no son LPR (con cuántas chapas leyó)
 * Sin período, los últimos 30 días: es para elegir, no para contar todo.
 */
const DIAS_SIN_RANGO = 30;
const sinZona = (d: Date) => d.toISOString().replace("T", " ").replace("Z", "");
const limite = (v: string | null, extremo: "inicio" | "fin") => {
    if (!v) return null;
    const dia = limitesDelDia(v);
    if (dia) return dia[extremo];
    const d = new Date(v);
    return isNaN(+d) ? null : d;
};

export type CamaraHistorial = { nombre: string; origen: "lpr" | "seguimiento" | "omnivision"; n: number; chapas?: number };

export async function GET(req: NextRequest) {
    const auth = await verifyApiAuth();
    if (!auth.authenticated) return unauthorizedResponse();
    const sp = req.nextUrl.searchParams;
    const desde = limite(sp.get("from"), "inicio") || new Date(Date.now() - DIAS_SIN_RANGO * 864e5);
    const hasta = limite(sp.get("to"), "fin") || new Date();
    const d = sinZona(desde), h = sinZona(hasta);

    const [accesos, seguimiento, omni] = await Promise.all([
        prisma.$queryRaw<{ nombre: string | null; n: bigint }[]>`
            SELECT coalesce(dv.name, e.location) AS nombre, count(*) AS n
              FROM "AccessEvent" e LEFT JOIN "Device" dv ON dv.id = e."deviceId"
             WHERE e.timestamp >= ${d}::timestamp AND e.timestamp <= ${h}::timestamp
             GROUP BY 1`.catch(() => []),
        prisma.$queryRaw<{ nombre: string | null; n: bigint }[]>`
            SELECT "cameraName" AS nombre, count(*) AS n FROM "PlateSighting"
             WHERE source = 'TRACK' AND timestamp >= ${d}::timestamp AND timestamp <= ${h}::timestamp
             GROUP BY 1`.catch(() => []),
        prisma.$queryRaw<{ nombre: string | null; n: bigint; chapas: bigint }[]>`
            SELECT o.camara AS nombre, count(*) AS n,
                   count(*) FILTER (WHERE jsonb_typeof(o.textos) = 'array' AND o.textos @> '[{"tipo":"matricula"}]'::jsonb) AS chapas
              FROM "ObjetoVisto" o LEFT JOIN "Device" dv ON dv.id = o."deviceId"
             WHERE (dv.id IS NULL OR dv."deviceType"::text <> 'LPR_CAMERA')
               AND o."primeraVez" >= ${d}::timestamp AND o."primeraVez" <= ${h}::timestamp
             GROUP BY 1`.catch(() => []),
    ]);

    const porNombre = new Map<string, CamaraHistorial>();
    const sumar = (filas: { nombre: string | null; n: bigint; chapas?: bigint }[], origen: CamaraHistorial["origen"]) => {
        for (const f of filas) {
            if (!f.nombre) continue;
            const ya = porNombre.get(f.nombre);
            if (ya) { ya.n += Number(f.n); continue; } // la misma cámara por dos caminos: queda con el primero (lpr > seguimiento > omnivision)
            porNombre.set(f.nombre, { nombre: f.nombre, origen, n: Number(f.n), ...(f.chapas != null ? { chapas: Number(f.chapas) } : {}) });
        }
    };
    sumar(accesos, "lpr");
    sumar(seguimiento, "seguimiento");
    sumar(omni, "omnivision");
    const camaras = [...porNombre.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
    return NextResponse.json({ camaras }, { headers: { "Cache-Control": "no-store" } });
}
