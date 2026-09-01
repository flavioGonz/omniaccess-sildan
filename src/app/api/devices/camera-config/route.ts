/**
 * /api/devices/camera-config?deviceId=...
 *  GET  → lee la config ANPR-relevante normalizada
 *  POST → aplica un parámetro puntual { param, value } (con confirm en la UI)
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
    readCamConfig, setShutter, setGain, setWDR, setHLC, setOverexpose,
    setIrcut, setSupplementLight, setSharpness, setFocusStyle, setAnprRoad,
} from "@/lib/isapi-camera";

export const dynamic = "force-dynamic";

async function loadDevice(id: string) {
    const d = await prisma.device.findUnique({ where: { id }, select: { id: true, ip: true, username: true, password: true, authType: true, brand: true, deviceType: true } });
    if (!d) return null;
    return { ...d, authType: d.authType || "DIGEST" };
}

export async function GET(req: NextRequest) {
    const id = req.nextUrl.searchParams.get("deviceId");
    if (!id) return NextResponse.json({ ok: false, error: "deviceId requerido" }, { status: 400 });
    const d = await loadDevice(id);
    if (!d) return NextResponse.json({ ok: false, error: "device no existe" }, { status: 404 });
    try {
        const cfg = await readCamConfig(d as any);
        delete cfg._raw;
        return NextResponse.json({ ok: true, config: cfg });
    } catch (e: any) {
        return NextResponse.json({ ok: false, error: e?.message || "ISAPI error" }, { status: 502 });
    }
}

export async function POST(req: NextRequest) {
    const id = req.nextUrl.searchParams.get("deviceId");
    if (!id) return NextResponse.json({ ok: false, error: "deviceId requerido" }, { status: 400 });
    const d = await loadDevice(id);
    if (!d) return NextResponse.json({ ok: false, error: "device no existe" }, { status: 404 });
    const body = await req.json().catch(() => ({}));
    const { param, value, level } = body as { param: string; value: any; level?: number };
    try {
        switch (param) {
            case "shutter": await setShutter(d as any, String(value)); break;
            case "gain": await setGain(d as any, parseInt(value, 10)); break;
            case "wdr": await setWDR(d as any, value ? "open" : "close", level ?? 50); break;
            case "hlc": await setHLC(d as any, !!value, level ?? 50); break;
            case "overexpose": await setOverexpose(d as any, !!value, level ?? 60); break;
            case "ircut": await setIrcut(d as any, value); break;
            case "supplement": await setSupplementLight(d as any, value); break;
            case "sharpness": await setSharpness(d as any, parseInt(value, 10)); break;
            case "focus": await setFocusStyle(d as any, value); break;
            case "anprRoad": await setAnprRoad(d as any, value); break;
            default: return NextResponse.json({ ok: false, error: `param desconocido: ${param}` }, { status: 400 });
        }
        return NextResponse.json({ ok: true, param, value });
    } catch (e: any) {
        return NextResponse.json({ ok: false, error: e?.message || "ISAPI PUT error" }, { status: 502 });
    }
}
