/** AcuSearch — búsqueda por IMAGEN/objetivo.
 *  POST /api/acuseek/image-search  (multipart: file=<jpeg> | JSON: {sourceUrl}) + from,to,similarity,channelID → {taskID}
 *  GET  /api/acuseek/image-search?taskId=&pos=&max=  → progreso + resultados (enriquecidos con deviceId por canal) */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { createImageSearch, getImageSearchProgress, getImageSearchResults, fetchAcuSeekImage, AcuSeekNotActivatedError } from "@/lib/acuseek";
import { nvrConAcuSeek, camarasDelNvr, conSesion, SIN_ACUSEEK } from "@/lib/acuseek-nvr";

/** El grabador que SÍ tiene AcuSearch (lib/acuseek-nvr), no el primero de la tabla. */
async function getNvr() { return (await nvrConAcuSeek())?.dev ?? null; }

export async function POST(req: NextRequest) {
    const no = await conSesion(); if (no) return no;
    const nvr = await getNvr();
    if (!nvr) return NextResponse.json({ ok: false, sinAcuSeek: true, error: SIN_ACUSEEK }, { status: 404 });
    try {
        let image: Buffer | null = null;
        let p: Record<string, any> = {};
        const ct = req.headers.get("content-type") || "";
        if (ct.includes("multipart/form-data")) {
            const fd = await req.formData();
            const f = fd.get("file");
            if (f && typeof f !== "string") image = Buffer.from(await (f as File).arrayBuffer());
            for (const k of ["from", "to", "similarity", "channelID", "sourceUrl", "maxResults", "engine"]) { const v = fd.get(k); if (typeof v === "string" && v) p[k] = v; }
        } else {
            p = await req.json().catch(() => ({}));
        }
        // referencia = recorte/foto del propio NVR (para "Buscar similar" desde un resultado)
        if (!image && p.sourceUrl) {
            const host = new URL(p.sourceUrl).hostname;
            const nvrHost = nvr.ip.replace(/^https?:\/\//, "").split(":")[0];
            if (host !== nvrHost) return NextResponse.json({ ok: false, error: "sourceUrl debe ser del NVR." }, { status: 403 });
            image = (await fetchAcuSeekImage(nvr, p.sourceUrl)).buf;
        }
        if (!image || image.length < 200) return NextResponse.json({ ok: false, error: "Falta la imagen de referencia (file o sourceUrl)." }, { status: 400 });
        if (image.length > 5 * 1024 * 1024) return NextResponse.json({ ok: false, error: "Imagen demasiado grande (máx 5MB)." }, { status: 413 });

        const sim = p.similarity != null ? Number(p.similarity) : 0.6;
        const { taskID } = await createImageSearch(nvr, image, {
            from: p.from, to: p.to,
            similarity: sim > 1 ? sim / 100 : sim,   // acepta 0-1 o 0-100
            maxResults: p.maxResults ? Number(p.maxResults) : 100,
            channelID: p.channelID && p.channelID !== "ALL" ? p.channelID : undefined,
            engine: p.engine === "vehicle" ? "vehicle" : "human",
        });
        return NextResponse.json({ ok: true, taskID, engine: p.engine === "vehicle" ? "vehicle" : "human" });
    } catch (e: any) {
        if (e instanceof AcuSeekNotActivatedError) return NextResponse.json({ ok: false, activated: false, error: e.message }, { status: 409 });
        return NextResponse.json({ ok: false, error: e?.message || "image-search error" }, { status: 500 });
    }
}

export async function GET(req: NextRequest) {
    const no = await conSesion(); if (no) return no;
    const acu = await nvrConAcuSeek();
    const nvr = acu?.dev ?? null;
    if (!acu || !nvr) return NextResponse.json({ ok: false, sinAcuSeek: true, error: SIN_ACUSEEK }, { status: 404 });
    const taskID = req.nextUrl.searchParams.get("taskId") || req.nextUrl.searchParams.get("taskID");
    if (!taskID) return NextResponse.json({ ok: false, error: "Falta taskId." }, { status: 400 });
    const pos = parseInt(req.nextUrl.searchParams.get("pos") || "0", 10);
    const max = Math.min(200, parseInt(req.nextUrl.searchParams.get("max") || "80", 10));
    const engine = (req.nextUrl.searchParams.get("engine") === "vehicle" ? "vehicle" : "human") as "human" | "vehicle";
    try {
        const prog = await getImageSearchProgress(nvr, taskID, engine);
        if (prog.progress < 100) return NextResponse.json({ ok: true, status: "working", progress: prog.progress, totalMatches: prog.matches, matches: [] });
        const res = await getImageSearchResults(nvr, taskID, pos, max, engine);
        // el motor de vehículos no acepta similarity en el request → filtro server-side (?minScore=0-100)
        const minScore = Number(req.nextUrl.searchParams.get("minScore") || 0);
        if (minScore > 0) res.matches = res.matches.filter((m: any) => m.score == null || m.score >= minScore);
        // enriquecer con la cámara (canal de ESTE grabador → cámara) para la grabación
        try {
            const cams = await camarasDelNvr(acu.id);
            for (const m of res.matches as any[]) { const c = cams[m.channel]; if (c) { m.deviceId = c.id; m.deviceName = m.deviceName || c.nombre; } }
        } catch { /* best-effort */ }
        return NextResponse.json({ ok: true, status: "completed", progress: 100, totalMatches: res.total, more: res.more, matches: res.matches });
    } catch (e: any) {
        if (e instanceof AcuSeekNotActivatedError) return NextResponse.json({ ok: false, activated: false, error: e.message }, { status: 409 });
        return NextResponse.json({ ok: false, error: e?.message || "poll error" }, { status: 500 });
    }
}
