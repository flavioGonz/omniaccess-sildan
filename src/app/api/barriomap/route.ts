import { NextRequest, NextResponse } from "next/server";
import { getBarrioMap, saveBarrioMap } from "@/app/actions/barriomap";

export const dynamic = "force-dynamic";

// Esta ruta existe porque el mapa guarda por fetch (la server action no pasaba el proxy).
// Antes tenía su propia copia de "qué claves tiene un mapa", y eso es lo que borró datos:
// cada clave que la ruta no conocía (los `lots` viejos de San Nicolás, `base`, `bearing`,
// `pitch`, `tresD`, y ahora `intrusions`) se perdía en el primer guardado desde la UI, aunque
// getBarrioMap las devolviera bien. Una sola definición de lectura y de guardado, la de
// actions/barriomap.ts, y esta ruta solo la expone por HTTP.

// GET /api/barriomap  → devuelve el mapa (mismo shape que getBarrioMap)
export async function GET() {
    try {
        return NextResponse.json(await getBarrioMap());
    } catch (e: any) {
        return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
    }
}

// POST /api/barriomap  → guarda el mapa completo, fusionando sobre lo que ya hay
export async function POST(req: NextRequest) {
    try {
        const data = await req.json();
        if (!data || typeof data !== "object" || Array.isArray(data)) {
            return NextResponse.json({ ok: false, error: "payload inválido" }, { status: 400 });
        }
        const r = await saveBarrioMap(data);
        if (!r.ok) return NextResponse.json(r, { status: 500 });
        return NextResponse.json({ ok: true });
    } catch (e: any) {
        console.error("[api/barriomap POST] fallo:", e);
        return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
    }
}
