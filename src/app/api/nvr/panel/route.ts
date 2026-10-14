export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyApiAuth, unauthorizedResponse } from "@/lib/api-auth";
import { getNvrChannels } from "@/app/actions/nvr";
import { capacidadNvr, saludNvr } from "@/lib/salud-nvr";

/**
 * GET /api/nvr/panel?nvr=<id> — lo que dibuja la cabecera del NVR en su ficha: un puerto por
 * canal (con cámara o vacío, conectado o no, y si esa cámara es un equipo de OmniAccess) y la
 * salud del grabador con sus discos.
 */
export async function GET(req: NextRequest) {
    const auth = await verifyApiAuth();
    if (!auth.authenticated) return unauthorizedResponse();
    const id = req.nextUrl.searchParams.get("nvr") || "";
    const nvr = await prisma.device.findUnique({ where: { id } });
    if (!nvr || String(nvr.deviceType) !== "NVR") return NextResponse.json({ ok: false, error: "NVR no encontrado" }, { status: 404 });

    const [canalesR, salud] = await Promise.all([
        getNvrChannels({ ip: nvr.ip, username: nvr.username || undefined, password: nvr.password || undefined, authType: nvr.authType || undefined }).catch((e: any) => ({ ok: false, error: e?.message, channels: [] as any[] })),
        saludNvr(nvr as any),
    ]);
    const canales: any[] = (canalesR as any).channels || [];
    const ips = canales.map((c) => c.ip).filter(Boolean);
    const equipos = ips.length ? await prisma.device.findMany({ where: { ip: { in: ips }, deviceType: { not: "NVR" as any } }, select: { id: true, name: true, deviceType: true, ip: true } }) : [];
    const porIp = new Map(equipos.map((e) => [e.ip, e]));
    const max = canales.reduce((m, c) => Math.max(m, Number(c.channel) || 0), 0);
    return NextResponse.json({
        ok: true,
        error: (canalesR as any).ok ? null : (canalesR as any).error || "No se pudieron leer los canales",
        capacidad: capacidadNvr(nvr.deviceModel, max),
        canales: canales.map((c) => {
            const e = c.ip ? porIp.get(c.ip) : null;
            return { ch: Number(c.channel), nombre: c.name || null, ip: c.ip || null, modelo: c.model || null, online: c.online ?? null, sensorDe: c.sensorDe ?? null,
                equipo: e ? { id: e.id, nombre: e.name, tipo: String(e.deviceType) } : null };
        }),
        salud,
    });
}
