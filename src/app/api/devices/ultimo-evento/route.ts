import { NextRequest, NextResponse } from "next/server";
import { verifyApiAuth, unauthorizedResponse } from "@/lib/api-auth";
import { ultimosEventos } from "@/lib/silencio";

export const dynamic = "force-dynamic";

/** GET /api/devices/ultimo-evento?ids=a,b,c — el último evento real de cada equipo (lib/silencio). */
export async function GET(req: NextRequest) {
    const a = await verifyApiAuth();
    if (!a.authenticated) return unauthorizedResponse();
    const ids = (req.nextUrl.searchParams.get("ids") || req.nextUrl.searchParams.get("deviceId") || "").split(",").map((x) => x.trim()).filter(Boolean).slice(0, 500);
    const m = await ultimosEventos(ids.length ? ids : undefined);
    const out: Record<string, { ts: string; fuente: string }> = {};
    for (const [id, u] of m) out[id] = { ts: u.ts.toISOString(), fuente: u.fuente };
    return NextResponse.json({ equipos: out }, { headers: { "Cache-Control": "no-store" } });
}
