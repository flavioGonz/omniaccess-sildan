import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { horariosDeTodas } from "@/lib/horarios-camaras";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Estado de armado de las reglas de intrusión de cada cámara, para la pasarela del bot de
 * Telegram (filtro "solo cámaras armadas"). Lo pide el proceso telegram-bot con el
 * `x-tracking-token`; la lectura a las cámaras ya tiene caché de 5 min en horariosDeTodas.
 *   { [deviceId]: { linea: true|false|null, zona: true|false|null } }   null = sin horario leído
 */
export async function GET(req: NextRequest) {
    let token = process.env.TRACKING_TOKEN || "";
    if (!token) { try { token = (await prisma.setting.findUnique({ where: { key: "TRACKING_TOKEN" } }))?.value || ""; } catch { } }
    if (!token || req.headers.get("x-tracking-token") !== token) return NextResponse.json({ error: "no autorizado" }, { status: 401 });
    try {
        const h = await horariosDeTodas();
        const out: Record<string, { linea: boolean | null; zona: boolean | null }> = {};
        for (const [id, x] of Object.entries(h)) out[id] = { linea: x.linea ? x.linea.armadaAhora : null, zona: x.zona ? x.zona.armadaAhora : null };
        return NextResponse.json(out);
    } catch (e: any) {
        return NextResponse.json({ error: e?.message || "error" }, { status: 500 });
    }
}
