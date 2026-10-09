/**
 * /api/devices/analytics?deviceId=...
 *  GET  → { support:{line,field}, line:{enabled,points}, field:{enabled,points} }
 *  POST → { kind:"line"|"field", enabled, points:[{x,y}] }  aplica la geometría (read-modify-write ISAPI)
 *         { kind, enabled:false } (sin puntos) → APAGA la regla en la cámara. Era lo que faltaba:
 *         el calibrador dejaba dibujar y guardar pero no quitar, y «Limpiar» + «Guardar» chocaba
 *         con «la línea necesita exactamente 2 puntos» (9/10, pedido de Nico).
 * Coordenadas 0–1000 origen abajo-izquierda (la UI invierte Y).
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSmartSupport, readLine, readField, writeLine, writeField } from "@/lib/isapi-analytics";
import { resolveForCamera } from "@/lib/nvr-resolve";
import { readDahuaIvs, writeDahuaField, writeDahuaLine } from "@/lib/dahua-ivs";

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
    const camD = await resolveForCamera(id);
    if (camD && String((camD.nvr as any).brand).toUpperCase() === "DAHUA") {
        try {
            const r = await readDahuaIvs({ ip: camD.nvr.ip, user: camD.nvr.user, pass: camD.nvr.pass }, camD.ch);
            return NextResponse.json({ ok: true, support: r.support, line: { enabled: r.line.length > 0, points: r.line, supported: r.support.line, direction: r.lineDir }, field: { enabled: r.field.length > 0, points: r.field, supported: r.support.field } }, { headers: { "Cache-Control": "no-store" } });
        } catch (e: any) { return NextResponse.json({ ok: false, error: e?.message || "Dahua IVS error" }, { status: 502 }); }
    }
    try {
        const support = await getSmartSupport(d as any);
        const line = support.line ? await readLine(d as any, ch) : { supported: false, enabled: false, points: [] };
        const field = support.field ? await readField(d as any, ch) : { supported: false, enabled: false, points: [] };
        return NextResponse.json({ ok: true, support, line: { enabled: line.enabled, points: line.points, supported: line.supported, direction: (line as any).dir }, field: { enabled: field.enabled, points: field.points, supported: field.supported } }, { headers: { "Cache-Control": "no-store" } });
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
    const { kind, enabled, points, direction } = body as { kind: "line" | "field"; enabled: boolean; points: { x: number; y: number }[]; direction?: string };
    if (kind !== "line" && kind !== "field") return NextResponse.json({ ok: false, error: "kind inválido" }, { status: 400 });
    const apagar = enabled === false;
    if (!apagar && (!Array.isArray(points) || points.length < 2)) return NextResponse.json({ ok: false, error: "puntos insuficientes" }, { status: 400 });
    const camP = await resolveForCamera(id);
    if (camP && String((camP.nvr as any).brand).toUpperCase() === "DAHUA") {
        try {
            const conn = { ip: camP.nvr.ip, user: camP.nvr.user, pass: camP.nvr.pass };
            // El IVS de Dahua no tiene un «apagado» separado de la geometría que se haya probado acá.
            if (apagar) return NextResponse.json({ ok: false, error: "En canales de un NVR Dahua la regla se quita desde el NVR." }, { status: 400 });
            if (kind === "line") await writeDahuaLine(conn, camP.ch, points as any, direction);
            else await writeDahuaField(conn, camP.ch, points as any);
            return NextResponse.json({ ok: true });
        } catch (e: any) { return NextResponse.json({ ok: false, error: e?.message || "Dahua IVS write error" }, { status: 502 }); }
    }
    try {
        if (kind === "line") await writeLine(d as any, ch, { enabled: !apagar, points: apagar ? [] : points, direction });
        else await writeField(d as any, ch, { enabled: !apagar, points: apagar ? [] : points });
        return NextResponse.json({ ok: true });
    } catch (e: any) {
        return NextResponse.json({ ok: false, error: e?.message || "ISAPI PUT error" }, { status: 502 });
    }
}
