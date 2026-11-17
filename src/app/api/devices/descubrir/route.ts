import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/app/actions/auth";
import { permisosDeSesion } from "@/lib/permisos";
import { auditar } from "@/lib/centrales/sesion";
import { prisma } from "@/lib/prisma";
import { esSubredPrivada, subredesSugeridas } from "@/lib/descubrir-red";
import { barrer, subredesPropias } from "@/lib/descubrir-red-servidor";

export const dynamic = "force-dynamic";
const SIN_CACHE = { "Cache-Control": "no-store" };
const PERMISO = "dispositivos.editar";

/**
 * Descubrir equipos en la red (pedido 17/11, el mismo barrido que el mapa de KumaMap).
 *
 * GET  — qué subredes conviene barrer: las de los equipos que ya están dados de alta y las del
 *        propio servidor. Así no hay que acordarse del prefijo.
 * POST { subred, desde, hasta } — el barrido.
 *
 * Pide «Editar dispositivos» y queda en Auditoría: manda tráfico a toda una red del cliente, y
 * eso tiene que poder explicarse después.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- la sesión es el JWT crudo
type Sesion = any;
async function permitido(): Promise<NextResponse | { sesion: Sesion }> {
    const s: Sesion = await getSession().catch(() => null);
    if (!s) return NextResponse.json({ error: "Hace falta iniciar sesión." }, { status: 401 });
    if (!permisosDeSesion(s).includes(PERMISO)) return NextResponse.json({ error: "Tu rol no puede descubrir equipos en la red." }, { status: 403 });
    return { sesion: s };
}

export async function GET() {
    const q = await permitido(); if (q instanceof NextResponse) return q;
    const equipos = await prisma.device.findMany({ select: { ip: true } }).catch(() => []);
    return NextResponse.json({ subredes: subredesSugeridas(equipos.map((e) => e.ip), subredesPropias()) }, { headers: SIN_CACHE });
}

export async function POST(req: NextRequest) {
    const q = await permitido(); if (q instanceof NextResponse) return q;
    const b = await req.json().catch(() => null);
    const subred = String(b?.subred || "").trim();
    const desde = Number(b?.desde) || 1, hasta = Number(b?.hasta) || 254;
    if (!esSubredPrivada(subred)) {
        return NextResponse.json({ error: "Sólo se pueden barrer redes privadas (10.x, 172.16–31.x, 192.168.x)." }, { status: 400 });
    }
    const t0 = Date.now();
    try {
        const r = await barrer(subred, desde, hasta);
        const nuevos = r.hallazgos.filter((h) => !h.equipo).length;
        await auditar(q.sesion, "equipos.descubrir", `${subred}.${desde}-${hasta}`, true, `${r.hallazgos.length} de ${r.total} contestaron, ${nuevos} sin dar de alta`);
        return NextResponse.json({ ...r, ms: Date.now() - t0 }, { headers: SIN_CACHE });
    } catch (e) {
        const motivo = e instanceof Error ? e.message : "no se pudo barrer";
        await auditar(q.sesion, "equipos.descubrir", `${subred}.${desde}-${hasta}`, false, motivo);
        return NextResponse.json({ error: motivo }, { status: 500 });
    }
}
