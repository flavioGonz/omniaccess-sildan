/** POST /api/acuseek/search — crea búsqueda por texto (→taskID). GET ?taskId= → poll+resultados. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createTextSearch, getTextSearchStatus, AcuSeekNotActivatedError } from "@/lib/acuseek";

async function getNvr() {
    const nvr = await prisma.device.findFirst({ where: { deviceType: "NVR" }, select: { ip: true, username: true, password: true, authType: true } });
    if (!nvr?.ip) return null;
    return { ip: nvr.ip, username: nvr.username || "admin", password: nvr.password || "", authType: nvr.authType || "DIGEST" };
}

export async function POST(req: NextRequest) {
    const nvr = await getNvr();
    if (!nvr) return NextResponse.json({ ok: false, error: "No hay NVR configurado." }, { status: 404 });
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
    const nvr = await getNvr();
    if (!nvr) return NextResponse.json({ ok: false, error: "No hay NVR configurado." }, { status: 404 });
    const taskID = req.nextUrl.searchParams.get("taskId") || req.nextUrl.searchParams.get("taskID");
    if (!taskID) return NextResponse.json({ ok: false, error: "Falta taskId." }, { status: 400 });
    const maxResults = Math.min(200, parseInt(req.nextUrl.searchParams.get("max") || "50", 10));
    try {
        const st = await getTextSearchStatus(nvr, taskID, { maxResults });
        // enriquecer cada match con deviceId/nombre (revierte NVR_CHANNEL_MAP: canal→IP→device)
        try {
            const row = await prisma.setting.findUnique({ where: { key: "NVR_CHANNEL_MAP" } });
            const map = row?.value ? JSON.parse(row.value) as Record<string, number | string> : {};
            const chToIp: Record<number, string> = {};
            for (const [ip, ch] of Object.entries(map)) chToIp[Number(ch)] = ip;
            const ips = Array.from(new Set(Object.values(chToIp)));
            const devs = ips.length ? await prisma.device.findMany({ where: { ip: { in: ips } }, select: { id: true, name: true, ip: true } }) : [];
            const byIp: Record<string, { id: string; name: string }> = {};
            for (const d of devs) byIp[d.ip!] = { id: d.id, name: d.name };
            for (const m of st.matches as any[]) {
                const ip = chToIp[m.channel];
                const d = ip ? byIp[ip] : null;
                if (d) { m.deviceId = d.id; m.deviceName = d.name; }
            }
        } catch { /* enrich best-effort */ }
        return NextResponse.json({ ok: true, ...st });
    } catch (e: any) {
        if (e instanceof AcuSeekNotActivatedError) return NextResponse.json({ ok: false, activated: false, error: e.message }, { status: 409 });
        return NextResponse.json({ ok: false, error: e?.message || "poll error" }, { status: 500 });
    }
}
