import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/app/actions/auth";
import { permisosDeSesion } from "@/lib/permisos";
import { verifyApiAuth } from "@/lib/api-auth";
import { analizaVision, ponerVision } from "@/lib/vision-camaras";

export const dynamic = "force-dynamic";

/** GET /api/vision/camaras/<id> — si omni-vision analiza el video de esta cámara. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ deviceId: string }> }) {
    const auth = await verifyApiAuth();
    if (!auth.authenticated) return NextResponse.json({ error: "Sin sesión" }, { status: 401 });
    const { deviceId } = await params;
    return NextResponse.json({ analiza: await analizaVision(deviceId) }, { headers: { "Cache-Control": "no-store" } });
}

/** PUT { analiza } — prender o apagar el análisis. Pide Ajustes, como el resto de OmniVision. */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ deviceId: string }> }) {
    const s: any = await getSession();
    if (!s) return NextResponse.json({ error: "Sin sesión" }, { status: 401 });
    if (!permisosDeSesion(s).includes("ajustes")) return NextResponse.json({ error: "Sólo quien tiene Ajustes puede cambiar qué analiza OmniVision." }, { status: 403 });
    const { deviceId } = await params;
    const b = await req.json().catch(() => null);
    if (typeof b?.analiza !== "boolean") return NextResponse.json({ error: "Falta «analiza»." }, { status: 400 });
    const r = await ponerVision(deviceId, b.analiza);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
    return NextResponse.json({ ok: true, analiza: b.analiza });
}
