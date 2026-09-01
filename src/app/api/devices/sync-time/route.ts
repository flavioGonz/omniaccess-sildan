/**
 * POST /api/devices/sync-time
 *   body: { deviceId?: string, all?: boolean, mode?: "now" | "ntp", ntpServer?: string, tz?: string }
 *
 *  mode "now" (default): empuja la hora ACTUAL del servidor (America/Montevideo) al
 *    equipo por ISAPI (timeMode=manual + localTime). Confiable y OFFLINE-SAFE — la
 *    cámara no necesita internet ni un server NTP alcanzable.
 *  mode "ntp": pone timeMode=NTP y configura el server NTP (hostName). Sólo sirve si
 *    el equipo alcanza ese host (p.ej. un NTP en la LAN).
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticatedRequest } from "@/lib/digest-auth";

export const dynamic = "force-dynamic";
const TZ = "America/Montevideo";
const TIME = "/ISAPI/System/time";

function auth(d: any) { return { ip: d.ip, username: d.username, password: d.password, authType: d.authType || "DIGEST" }; }

/** Hora local de Montevideo en ISO con offset -03:00 (independiente del TZ del server) */
function montevideoNow(): string {
    const p = new Intl.DateTimeFormat("sv-SE", {
        timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
    }).format(new Date());
    return p.replace(" ", "T") + "-03:00";
}

function setTag(xml: string, tag: string, val: string): string {
    const re = new RegExp(`(<${tag}>)[\\s\\S]*?(</${tag}>)`, "i");
    return re.test(xml) ? xml.replace(re, `$1${val}$2`) : xml;
}

async function syncOne(d: any, mode: string, ntpServer: string): Promise<any> {
    try {
        let xml: string = await authenticatedRequest("GET", TIME, auth(d), { responseType: "text", accept: "application/xml", timeout: 6000 });
        if (mode === "ntp") {
            xml = setTag(xml, "timeMode", "NTP");
            await authenticatedRequest("PUT", TIME, auth(d), { data: xml, contentType: "application/xml", responseType: "text", timeout: 8000 });
            // configurar server NTP #1
            const ntpXml = `<?xml version="1.0" encoding="UTF-8"?><NTPServer version="2.0" xmlns="http://www.hikvision.com/ver20/XMLSchema"><id>1</id><addressingFormatType>ipaddress</addressingFormatType><ipAddress>${ntpServer}</ipAddress><portNo>123</portNo><synchronizeInterval>60</synchronizeInterval></NTPServer>`;
            await authenticatedRequest("PUT", `${TIME}/ntpServers/1`, auth(d), { data: ntpXml, contentType: "application/xml", responseType: "text", timeout: 8000 });
            return { id: d.id, ok: true, mode: "ntp", server: ntpServer };
        }
        // mode "now": manual push
        const local = montevideoNow();
        xml = setTag(setTag(xml, "timeMode", "manual"), "localTime", local);
        await authenticatedRequest("PUT", TIME, auth(d), { data: xml, contentType: "application/xml", responseType: "text", timeout: 8000 });
        return { id: d.id, ok: true, mode: "now", localTime: local };
    } catch (e: any) {
        return { id: d.id, ok: false, error: e?.message || "ISAPI error" };
    }
}

export async function POST(req: NextRequest) {
    const body = await req.json().catch(() => ({}));
    const { deviceId, all, mode = "now", ntpServer = "192.168.1.16" } = body as any;
    let devices: any[] = [];
    if (all) {
        devices = await prisma.device.findMany({
            where: { brand: "HIKVISION", deviceType: { in: ["LPR_CAMERA", "NVR"] as any } },
            select: { id: true, ip: true, username: true, password: true, authType: true },
        });
    } else if (deviceId) {
        const d = await prisma.device.findUnique({ where: { id: deviceId }, select: { id: true, ip: true, username: true, password: true, authType: true } });
        if (d) devices = [d];
    }
    if (!devices.length) return NextResponse.json({ ok: false, error: "sin dispositivos" }, { status: 400 });

    const results = await Promise.all(devices.map((d) => syncOne(d, mode, ntpServer)));
    const okCount = results.filter((r) => r.ok).length;
    return NextResponse.json({ ok: okCount > 0, applied: okCount, total: results.length, results });
}
