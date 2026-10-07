import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyApiAuth, unauthorizedResponse } from "@/lib/api-auth";
import { escribirHorario, describirHorario, type Horario, type TipoRegla } from "@/lib/isapi-horarios";
import { camarasDeIntrusion, leerDeCamara, olvidarHorarios } from "@/lib/horarios-camaras";

export const dynamic = "force-dynamic";

/**
 * /api/intrusion/horarios
 *  GET  ?deviceId=…        → { linea: {horario, texto, armadaAhora} | null, zona: … }
 *  GET  ?todas=1           → lo mismo para todas las cámaras de intrusión, en una llamada
 *  POST { deviceId | todas: true, tipos: ["linea","zona"], horario }
 *       → escribe en la(s) cámara(s), relee, y devuelve qué pasó en cada una.
 *       Con `todas`, además guarda el criterio general en Setting INTRUSION_HORARIO_GENERAL
 *       para que el monitor lo muestre como "criterio general".
 */

export async function GET(req: NextRequest) {
    const auth = await verifyApiAuth();
    if (!auth.authenticated) return unauthorizedResponse();
    const deviceId = req.nextUrl.searchParams.get("deviceId") || undefined;
    const todas = req.nextUrl.searchParams.get("todas") === "1";
    if (!deviceId && !todas) return NextResponse.json({ error: "deviceId o todas=1" }, { status: 400 });
    const cams = await camarasDeIntrusion(deviceId);
    if (deviceId && cams.length === 0) return NextResponse.json({ error: "Dispositivo no encontrado" }, { status: 404 });
    const porCamara: Record<string, any> = {};
    await Promise.all(cams.map(async (c) => { porCamara[c.id] = { name: c.name, ...(await leerDeCamara(c)) }; }));
    let general: any = null;
    try { const s = await prisma.setting.findUnique({ where: { key: "INTRUSION_HORARIO_GENERAL" } }); general = s?.value ? JSON.parse(s.value) : null; } catch { }
    return NextResponse.json(deviceId ? { ...porCamara[deviceId], general } : { camaras: porCamara, general }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
    const auth = await verifyApiAuth();
    if (!auth.authenticated) return unauthorizedResponse();
    const b = (await req.json().catch(() => ({}))) as { deviceId?: string; todas?: boolean; tipos?: TipoRegla[]; horario?: Horario };
    const tipos = (b.tipos || ["linea", "zona"]).filter((t) => t === "linea" || t === "zona");
    if (!b.horario || !Array.isArray(b.horario.bloques) || tipos.length === 0) return NextResponse.json({ error: "Falta el horario o los tipos" }, { status: 400 });
    const cams = await camarasDeIntrusion(b.todas ? undefined : b.deviceId);
    if (cams.length === 0) return NextResponse.json({ error: "No hay cámaras" }, { status: 404 });
    olvidarHorarios();

    const resultado: { id: string; name: string; ok: TipoRegla[]; fallo: { tipo: TipoRegla; error: string }[]; texto: string }[] = [];
    await Promise.all(cams.map(async (c) => {
        const r = { id: c.id, name: c.name, ok: [] as TipoRegla[], fallo: [] as { tipo: TipoRegla; error: string }[], texto: describirHorario(b.horario!) };
        for (const tipo of tipos) {
            try { await escribirHorario(c, tipo, b.horario!); r.ok.push(tipo); }
            catch (e: any) { r.fallo.push({ tipo, error: e?.message || "sin respuesta" }); }
        }
        resultado.push(r);
    }));
    if (b.todas) {
        const value = JSON.stringify({ horario: b.horario, tipos, texto: describirHorario(b.horario), aplicado: new Date().toISOString(), por: (auth as any).user?.name || null });
        await prisma.setting.upsert({ where: { key: "INTRUSION_HORARIO_GENERAL" }, update: { value }, create: { key: "INTRUSION_HORARIO_GENERAL", value } }).catch(() => null);
    }
    const fallaron = resultado.filter((r) => r.fallo.length);
    return NextResponse.json({ ok: fallaron.length === 0, resultado });
}
