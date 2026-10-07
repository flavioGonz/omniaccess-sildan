import { NextRequest, NextResponse } from "next/server";
import { autorizarMonitor, SIN_CACHE } from "@/lib/monitor/servidor";
import { getBarrioMap } from "@/app/actions/barriomap";
import { getParkingSlots, getPlateSlotMap } from "@/app/actions/parking";
import { getDevices } from "@/app/actions/devices";
import { getIntrusionCameras, getAnalyticsGeometryBatch, getDetectionHistory, getTodayIntrusionCounts } from "@/app/actions/detections";

export const dynamic = "force-dynamic";

/**
 * GET /api/monitor/mapa?que=<dato> → los datos que el mapa del barrio pide por server
 * actions en el panel, servidos por HTTP para la pantalla de pared (que no tiene sesión y
 * no puede invocar actions). Misma función detrás de cada `que`, así los dos mapas ven lo
 * mismo. Sólo lecturas.
 */
export async function GET(req: NextRequest) {
    const p = await autorizarMonitor("/api/monitor/mapa");
    if (p.error) return p.error;
    const sp = req.nextUrl.searchParams;
    const que = sp.get("que") || "";
    try {
        switch (que) {
            case "barrio": return NextResponse.json(await getBarrioMap(), { headers: SIN_CACHE });
            case "dispositivos": return NextResponse.json(await getDevices(), { headers: SIN_CACHE });
            case "plazas": return NextResponse.json(await getParkingSlots(), { headers: SIN_CACHE });
            case "chapas": return NextResponse.json(await getPlateSlotMap(), { headers: SIN_CACHE });
            case "camaras": return NextResponse.json(await getIntrusionCameras(), { headers: SIN_CACHE });
            case "geometria": return NextResponse.json(await getAnalyticsGeometryBatch((sp.get("ids") || "").split(",").filter(Boolean)), { headers: SIN_CACHE });
            case "detecciones": return NextResponse.json(await getDetectionHistory({ pageSize: Math.min(60, parseInt(sp.get("n") || "14") || 14) }), { headers: SIN_CACHE });
            case "conteos": return NextResponse.json(await getTodayIntrusionCounts(), { headers: SIN_CACHE });
            default: return NextResponse.json({ error: "que=barrio|dispositivos|plazas|chapas|camaras|geometria|detecciones|conteos" }, { status: 400 });
        }
    } catch (e: any) { return NextResponse.json({ error: e?.message || "error" }, { status: 500 }); }
}
