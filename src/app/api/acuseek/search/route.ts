/** POST /api/acuseek/search — crea búsqueda por texto (→taskID). GET ?taskId= → poll+resultados. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { createTextSearch, getTextSearchStatus, AcuSeekNotActivatedError } from "@/lib/acuseek";
import { nvrConAcuSeek, camarasDelNvr, conSesion, SIN_ACUSEEK } from "@/lib/acuseek-nvr";

export async function POST(req: NextRequest) {
    const no = await conSesion(); if (no) return no;
    const nvr = (await nvrConAcuSeek())?.dev;
    if (!nvr) return NextResponse.json({ ok: false, sinAcuSeek: true, error: SIN_ACUSEEK }, { status: 404 });
    try {
        const body = await req.json();
        const text = (body?.text || "").toString().trim();
        if (!text) return NextResponse.json({ ok: false, error: "Falta el texto de búsqueda." }, { status: 400 });
        const { taskID } = await createTextSearch(nvr, { text, channels: body?.channels, from: body?.from, to: body?.to, similarity: body?.similarity });
        return NextResponse.json({ ok: true, taskID });
    } catch (e: any) {
        if (e instanceof AcuSeekNotActivatedError) return NextResponse.json({ ok: false, activated: false, error: e.message }, { status: 409 });
        return NextResponse.json({ ok: false, error: e?.message || "search error" }, { status: 500 });
    }
}

export async function GET(req: NextRequest) {
    const no = await conSesion(); if (no) return no;
    const acu = await nvrConAcuSeek();
    const nvr = acu?.dev;
    if (!acu || !nvr) return NextResponse.json({ ok: false, sinAcuSeek: true, error: SIN_ACUSEEK }, { status: 404 });
    const taskID = req.nextUrl.searchParams.get("taskId") || req.nextUrl.searchParams.get("taskID");
    if (!taskID) return NextResponse.json({ ok: false, error: "Falta taskId." }, { status: 400 });
    const maxResults = Math.min(200, parseInt(req.nextUrl.searchParams.get("max") || "50", 10));
    try {
        const st = await getTextSearchStatus(nvr, taskID, { maxResults });
        // enriquecer cada match con la cámara (canal de ESTE grabador → cámara)
        try {
            const cams = await camarasDelNvr(acu.id);
            for (const m of st.matches as any[]) { const c = cams[m.channel]; if (c) { m.deviceId = c.id; m.deviceName = c.nombre; } }
        } catch { /* enrich best-effort */ }
        return NextResponse.json({ ok: true, ...st });
    } catch (e: any) {
        if (e instanceof AcuSeekNotActivatedError) return NextResponse.json({ ok: false, activated: false, error: e.message }, { status: 409 });
        return NextResponse.json({ ok: false, error: e?.message || "poll error" }, { status: 500 });
    }
}
