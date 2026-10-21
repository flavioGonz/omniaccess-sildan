/**
 * /api/devices/escucha — que OmniAccess vaya a buscar los eventos de una cámara (escucha-eventos.js).
 *
 * Para las cámaras que no pueden llamar a OmniAccess (la red no tiene ruta de vuelta: Otto Villa,
 * 21/10). GET ?deviceId= → { escucha }; POST { deviceId, escuchar } (permiso Dispositivos).
 * Vive en el Setting ESCUCHA_EVENTOS, que el proceso relee cada minuto.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyApiAuth, unauthorizedResponse } from "@/lib/api-auth";

export const dynamic = "force-dynamic";
const CLAVE = "ESCUCHA_EVENTOS";

async function lista(): Promise<string[]> {
    try { const v = JSON.parse((await prisma.setting.findUnique({ where: { key: CLAVE } }))?.value || "[]"); return Array.isArray(v) ? v.map(String) : []; } catch { return []; }
}

export async function GET(req: NextRequest) {
    const a = await verifyApiAuth();
    if (!a.authenticated) return unauthorizedResponse();
    const id = req.nextUrl.searchParams.get("deviceId") || "";
    return NextResponse.json({ escucha: (await lista()).includes(id) }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
    const { getSession } = await import("@/app/actions/auth");
    const { permisosDeSesion } = await import("@/lib/permisos");
    const s: any = await getSession().catch(() => null);
    if (!s) return NextResponse.json({ ok: false, error: "Sin sesión" }, { status: 401 });
    if (!permisosDeSesion(s).includes("dispositivos")) return NextResponse.json({ ok: false, error: "Pide el permiso Dispositivos." }, { status: 403 });
    const b = await req.json().catch(() => ({}));
    const id = String(b?.deviceId || "");
    if (!id || !(await prisma.device.findUnique({ where: { id }, select: { id: true } }))) return NextResponse.json({ ok: false, error: "No existe ese equipo." }, { status: 404 });
    const l = (await lista()).filter((x) => x !== id);
    if (b?.escuchar) l.push(id);
    await prisma.setting.upsert({ where: { key: CLAVE }, update: { value: JSON.stringify(l) }, create: { key: CLAVE, value: JSON.stringify(l) } });
    return NextResponse.json({ ok: true, escucha: !!b?.escuchar });
}
