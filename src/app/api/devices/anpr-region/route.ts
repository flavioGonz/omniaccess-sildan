/**
 * /api/devices/anpr-region?deviceId=...
 *  GET  → región de detección ANPR (carriles + línea de calibración) en coords 0–1000
 *  POST → { lanes, calib } aplica la región editada (read-modify-write ISAPI)
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { readAnprRegion, writeAnprRegion } from "@/lib/isapi-anpr";

export const dynamic = "force-dynamic";

async function load(id: string) {
    const d = await prisma.device.findUnique({ where: { id }, select: { id: true, ip: true, username: true, password: true, authType: true, brand: true } });
    if (!d) return null;
    return { ...d, authType: d.authType || "DIGEST" };
}

export async function GET(req: NextRequest) {
    const id = req.nextUrl.searchParams.get("deviceId");
    if (!id) return NextResponse.json({ ok: false, error: "deviceId requerido" }, { status: 400 });
    const d = await load(id);
    if (!d) return NextResponse.json({ ok: false, error: "device no existe" }, { status: 404 });
    try {
        const region = await readAnprRegion(d as any);
        return NextResponse.json({ ok: true, region });
    } catch (e: any) {
        return NextResponse.json({ ok: false, error: e?.message || "ISAPI error" }, { status: 502 });
    }
}

export async function POST(req: NextRequest) {
    const id = req.nextUrl.searchParams.get("deviceId");
    if (!id) return NextResponse.json({ ok: false, error: "deviceId requerido" }, { status: 400 });
    const d = await load(id);
    if (!d) return NextResponse.json({ ok: false, error: "device no existe" }, { status: 404 });
    const body = await req.json().catch(() => ({}));
    const { lanes, calib } = body as { lanes: any[]; calib: any[] };
    if (!Array.isArray(lanes)) return NextResponse.json({ ok: false, error: "lanes requerido" }, { status: 400 });
    try {
        await writeAnprRegion(d as any, { lanes, calib: calib || [] });
        return NextResponse.json({ ok: true });
    } catch (e: any) {
        return NextResponse.json({ ok: false, error: e?.message || "ISAPI PUT error" }, { status: 502 });
    }
}
