export const runtime = "nodejs";
export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { resolveNvrById } from "@/lib/nvr-resolve";
import { tramosHik, diaLocal } from "@/lib/nvr-tramos";

/**
 * GET /api/nvr/tramos?nvr=<id>&ch=<n>&t=<epochMs> → { tramos: [desdeMs, hastaMs][] | null, dia }
 *
 * Los tramos grabados del canal en el día de `t` (y del anterior o siguiente si `t` cae a menos
 * de una hora del cambio de día, para que «lo más cercano» no se pierda a medianoche). Lo usa el
 * visor del evento antes de pedir el video: si a esa hora el NVR no grabó lo dice al toque y
 * ofrece lo más cercano, en vez de esperar a que el video no llegue. null = no se pudo saber
 * (Dahua, NVR caído): el visor intenta igual.
 */
const HORA = 3600_000;

export async function GET(req: NextRequest) {
    const sp = req.nextUrl.searchParams;
    const nvrId = sp.get("nvr") || "";
    const ch = parseInt(sp.get("ch") || "", 10);
    const t = parseInt(sp.get("t") || "", 10);
    if (!/^[\w-]{1,80}$/.test(nvrId) || !(ch > 0) || !(t > 0)) return NextResponse.json({ error: "nvr, ch y t requeridos" }, { status: 400 });
    const conn = await resolveNvrById(nvrId);
    if (!conn || String(conn.brand).toUpperCase() === "DAHUA") return NextResponse.json({ tramos: null }, { headers: { "Cache-Control": "no-store" } });
    const dias = [...new Set([diaLocal(t - HORA), diaLocal(t), diaLocal(t + HORA)])];
    const partes = await Promise.all(dias.map((d) => tramosHik(conn, ch, d).catch(() => null)));
    if (partes.every((p) => p == null)) return NextResponse.json({ tramos: null, dia: diaLocal(t) }, { headers: { "Cache-Control": "no-store" } });
    const todos = partes.flatMap((p) => p || []).sort((a, b) => a[0] - b[0]);
    const unidos: [number, number][] = [];
    for (const x of todos) {
        const u = unidos[unidos.length - 1];
        if (u && x[0] <= u[1] + 2000) u[1] = Math.max(u[1], x[1]); else unidos.push([...x] as [number, number]);
    }
    return NextResponse.json({ tramos: unidos, dia: diaLocal(t) }, { headers: { "Cache-Control": "no-store" } });
}
