/**
 * /api/devices/alarm-host?deviceId=...
 *  GET  → { hosts, hasOmni } estado del servidor de alarma del equipo
 *  POST → asegura OmniAccess como servidor de alarma (lo agrega si falta)
 *
 * Hikvision: configura un "HTTP Host Notification" (push) en el equipo (ISAPI).
 * Dahua: NO usa push por equipo. OmniAccess se suscribe al NVR por eventManager
 *   (proceso webhooks, pull long-lived). Acá sólo verificamos que el NVR sea
 *   alcanzable y respondamos el estado de esa suscripción — no se escribe nada
 *   en una cámara (que además suele no ser alcanzable directamente).
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { readAlarmHosts, ensureAlarmHost, testAlarmHost } from "@/lib/isapi-alarmhost";
import { getChannelMap, resolveNvrById } from "@/lib/nvr-resolve";
import { authenticatedRequest } from "@/lib/digest-auth";

export const dynamic = "force-dynamic";

// Registro liviano (Setting ALARM_CONFIGURED_IPS) de qué cámaras tienen el servidor
// de alarma activo → el tile pinta el ícono de alarma. Se actualiza cada vez que se
// consulta/configura el servidor de alarma de un canal.
async function markAlarm(ip: string | null | undefined, on: boolean) {
    if (!ip) return;
    try {
        const row = await prisma.setting.findUnique({ where: { key: "ALARM_CONFIGURED_IPS" } });
        let set: Set<string>; try { set = new Set(JSON.parse(row?.value || "[]")); } catch { set = new Set(); }
        if (on) set.add(ip); else set.delete(ip);
        const value = JSON.stringify([...set]);
        await prisma.setting.upsert({ where: { key: "ALARM_CONFIGURED_IPS" }, update: { value }, create: { key: "ALARM_CONFIGURED_IPS", value } });
    } catch { /* best-effort */ }
}

async function load(id: string) {
    const d = await prisma.device.findUnique({ where: { id }, select: { id: true, ip: true, username: true, password: true, authType: true, brand: true, deviceType: true, name: true } });
    return d ? { ...d, authType: d.authType || "DIGEST" } : null;
}

/** Resuelve el NVR dueño de una cámara (o el propio equipo si ya es NVR). */
async function resolveNvr(d: any): Promise<{ ip: string; name: string; user: string; pass: string } | null> {
    if (String(d.deviceType) === "NVR") {
        return { ip: d.ip, name: d.name || d.ip, user: d.username || "admin", pass: d.password || "" };
    }
    const map = await getChannelMap();
    const entry = d.ip ? map[d.ip] : null;
    const conn = await resolveNvrById(entry?.nvrId);
    if (!conn) return null;
    const nvrDev = conn.nvrId ? await prisma.device.findUnique({ where: { id: conn.nvrId }, select: { name: true } }) : null;
    return { ip: conn.ip, name: nvrDev?.name || conn.ip, user: conn.user, pass: conn.pass };
}

/** Verifica que el NVR Dahua sea alcanzable y autentique (la suscripción eventManager corre en el proceso webhooks). */
async function dahuaStatus(d: any) {
    const nvr = await resolveNvr(d);
    if (!nvr) return { ok: false, dahua: true, hosts: [], hasOmni: false, error: "No se encontró el NVR dueño de esta cámara." };
    try {
        await authenticatedRequest("GET", "/cgi-bin/magicBox.cgi?action=getSystemInfo",
            { ip: nvr.ip, username: nvr.user, password: nvr.pass, authType: "DIGEST" } as any,
            { responseType: "text", timeout: 8000 });
        return {
            ok: true, dahua: true, hosts: [], hasOmni: true,
            nvr: { ip: nvr.ip, name: nvr.name, reachable: true },
            info: "OmniAccess recibe los eventos de este NVR Dahua por suscripción directa (eventManager). No requiere configurar un servidor de alarma en el equipo.",
        };
    } catch (e: any) {
        return {
            ok: false, dahua: true, hosts: [], hasOmni: false,
            nvr: { ip: nvr.ip, name: nvr.name, reachable: false },
            error: `No se pudo contactar el NVR Dahua (${nvr.ip}): ${e?.code || e?.message || "sin respuesta"}.`,
        };
    }
}

export async function GET(req: NextRequest) {
    const id = req.nextUrl.searchParams.get("deviceId");
    if (!id) return NextResponse.json({ ok: false, error: "deviceId requerido" }, { status: 400 });
    const d = await load(id);
    if (!d) return NextResponse.json({ ok: false, error: "device no existe" }, { status: 404 });
    if (String(d.brand).toUpperCase() === "DAHUA") {
        const r = await dahuaStatus(d);
        await markAlarm(d.ip, !!(r as any).ok);
        return NextResponse.json(r, { headers: { "Cache-Control": "no-store" } });
    }
    const r = await readAlarmHosts(d as any);
    if (r.ok) await markAlarm(d.ip, !!r.hasOmni);
    return NextResponse.json(r, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
    const id = req.nextUrl.searchParams.get("deviceId");
    if (!id) return NextResponse.json({ ok: false, error: "deviceId requerido" }, { status: 400 });
    const d = await load(id);
    if (!d) return NextResponse.json({ ok: false, error: "device no existe" }, { status: 404 });
    if (String(d.brand).toUpperCase() === "DAHUA") {
        const r: any = await dahuaStatus(d);
        await markAlarm(d.ip, !!r.ok);
        // ambas acciones (ensure/test) sólo verifican la suscripción al NVR
        return NextResponse.json({ ...r, reporting: !!r.ok, already: !!r.ok }, { status: r.ok ? 200 : 502 });
    }
    if (req.nextUrl.searchParams.get("action") === "test") {
        const t = await testAlarmHost(d as any);
        return NextResponse.json(t, { status: t.ok ? 200 : 502 });
    }
    const r = await ensureAlarmHost(d as any);
    if (r.ok) await markAlarm(d.ip, true);
    return NextResponse.json(r, { status: r.ok ? 200 : 502 });
}
