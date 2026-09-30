/**
 * /api/devices/analytics?deviceId=...
 *  GET  → { support:{line,field}, line:{enabled,points}, field:{enabled,points} }
 *  POST → { kind:"line"|"field", enabled, points:[{x,y}] }  aplica la geometría (read-modify-write ISAPI)
 * Coordenadas 0–1000 origen abajo-izquierda (la UI invierte Y).
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSmartSupport, readLine, readField, writeLine, writeField } from "@/lib/isapi-analytics";

export const dynamic = "force-dynamic";

async function load(id: string) {
    const d = await prisma.device.findUnique({ where: { id }, select: { id: true, ip: true, username: true, password: true, authType: true } });
    return d ? { ...d, authType: d.authType || "DIGEST" } : null;
}

export async function GET(req: NextRequest) {
    const id = req.nextUrl.searchParams.get("deviceId");
    const ch = parseInt(req.nextUrl.searchParams.get("ch") || "1") || 1;
    if (!id) return NextResponse.json({ ok: false, error: "deviceId requerido" }, { status: 400 });
    const d = await load(id);
    if (!d) return NextResponse.json({ ok: false, error: "device no existe" }, { status: 404 });
    try {
        const support = await getSmartSupport(d as any);
        const line = support.line ? await readLine(d as any, ch) : { supported: false, enabled: false, points: [] };
        const field = support.field ? await readField(d as any, ch) : { supported: false, enabled: false, points: [] };
        return NextResponse.json({ ok: true, support, line: { enabled: line.enabled, points: line.points, supported: line.supported }, field: { enabled: field.enabled, points: field.points, supported: field.supported } }, { headers: { "Cache-Control": "no-store" } });
    } catch (e: any) {
        return NextResponse.json({ ok: false, error: e?.message || "ISAPI error" }, { status: 502 });
    }
}

export async function POST(req: NextRequest) {
    const id = req.nextUrl.searchParams.get("deviceId");
    const ch = parseInt(req.nextUrl.searchParams.get("ch") || "1") || 1;
    if (!id) return NextResponse.json({ ok: false, error: "deviceId requerido" }, { status: 400 });
    const d = await load(id);
    if (!d) return NextResponse.json({ ok: false, error: "device no existe" }, { status: 404 });
    const body = await req.json().catch(() => ({}));
    const { kind, enabled, points } = body as { kind: "line" | "field"; enabled: boolean; points: { x: number; y: number }[] };
    if (kind !== "line" && kind !== "field") return NextResponse.json({ ok: false, error: "kind inválido" }, { status: 400 });
    if (!Array.isArray(points) || points.length < 2) return NextResponse.json({ ok: false, error: "puntos insuficientes" }, { status: 400 });
    try {
        if (kind === "line") await writeLine(d as any, ch, { enabled: enabled !== false, points });
        else await writeField(d as any, ch, { enabled: enabled !== false, points });
        return NextResponse.json({ ok: true });
    } catch (e: any) {
        return NextResponse.json({ ok: false, error: e?.message || "ISAPI PUT error" }, { status: 502 });
    }
}
