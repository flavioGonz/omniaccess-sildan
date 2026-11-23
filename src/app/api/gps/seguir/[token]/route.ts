import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { estadoDeEnlace, type VistaCompartida } from "@/lib/gps-compartir";
import { aligerar } from "@/lib/gps-recorrido";

export const dynamic = "force-dynamic";

/**
 * GET /api/gps/seguir/<token> — lo que ve quien abre un enlace compartido. Sin sesión: el token es
 * el permiso (lib/gps-compartir tiene las reglas).
 *
 * Tres cuidados de una ruta pública:
 *  · inexistente, vencido y cortado contestan lo mismo, un 404 sin detalle;
 *  · un tope por dirección, para que no se pueda probar tokens en serie ni usar esto de API;
 *  · sale el nombre que eligió quien compartió, la posición y el camino desde que se compartió.
 *    Nada más: ni IMEI, ni matrícula, ni batería, ni lo de antes.
 */
const EN_LINEA_MS = 6 * 60_000;
const POR_MINUTO = 60;
const baldes = new Map<string, { n: number; desde: number }>();
function hayCupo(ip: string): boolean {
    const ahora = Date.now(), b = baldes.get(ip);
    if (!b || ahora - b.desde > 60_000) { baldes.set(ip, { n: 1, desde: ahora }); if (baldes.size > 5000) for (const [k, v] of baldes) if (ahora - v.desde > 60_000) baldes.delete(k); return true; }
    return ++b.n <= POR_MINUTO;
}
const NO = () => NextResponse.json({ error: "Este enlace ya no sirve." }, { status: 404, headers: { "Cache-Control": "no-store" } });

export async function GET(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
    const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "sin-direccion";
    if (!hayCupo(ip)) return NextResponse.json({ error: "Demasiados pedidos. Esperá un momento." }, { status: 429, headers: { "Retry-After": "60" } });
    const { token } = await ctx.params;
    if (!/^[A-Za-z0-9_-]{20,40}$/.test(token || "")) return NO();
    const c = await prisma.gpsCompartido.findUnique({ where: { token } }).catch(() => null);
    if (!c || estadoDeEnlace(c) !== "vigente") return NO();
    const e = await prisma.gpsEquipo.findUnique({ where: { imei: c.imei }, select: { lat: true, lon: true, velocidad: true, rumbo: true, cuando: true, ultimoLatido: true, deviceId: true } });
    if (!e?.deviceId) return NO();

    const recorrido = c.conRecorrido
        ? aligerar(await prisma.gpsPosicion.findMany({ where: { imei: c.imei, cuando: { gte: c.createdAt }, pobre: false }, orderBy: { cuando: "asc" }, take: 5000, select: { lat: true, lon: true } }), 400).map((p) => [p.lat, p.lon] as [number, number])
        : [];
    // Cuántas veces se miró y cuándo fue la última: quien compartió lo ve en su lista. Una vez por minuto alcanza.
    if (!c.ultimaVista || Date.now() - c.ultimaVista.getTime() > 60_000) await prisma.gpsCompartido.update({ where: { id: c.id }, data: { vistas: { increment: 1 }, ultimaVista: new Date() } }).catch(() => { });
    const vista: VistaCompartida = {
        nombre: c.nombre, lat: e.lat, lon: e.lon, velocidad: e.velocidad, rumbo: e.rumbo, cuando: e.cuando?.toISOString() || null,
        enLinea: !!e.ultimoLatido && Date.now() - e.ultimoLatido.getTime() < EN_LINEA_MS, venceAt: c.venceAt.toISOString(), recorrido,
    };
    return NextResponse.json(vista, { headers: { "Cache-Control": "no-store" } });
}
