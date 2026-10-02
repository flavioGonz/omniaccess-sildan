"use server";

// Puesta a punto ("provisioning") de una cámara LPR Hikvision por ISAPI: deja todo
// listo para que la cámara FUNCIONE apenas se agrega — hora, envío de eventos al
// server (HTTP host), modo ANPR, códec H.264 para el video en vivo, stream go2rtc y
// sincronización de matrículas. Devuelve el resultado de cada paso.

import { prisma } from "@/lib/prisma";
import { authenticatedRequest } from "@/lib/digest-auth";
import { syncLprStream } from "@/lib/go2rtc-sync";
import { syncDeviceIncremental } from "@/app/actions/lpr-sync";

const TZ = "America/Montevideo";
const auth = (d: any) => ({ ip: d.ip, username: d.username, password: d.password, authType: d.authType || "DIGEST" });
const setTag = (xml: string, tag: string, val: string) => {
    const re = new RegExp(`(<${tag}>)[\\s\\S]*?(</${tag}>)`, "i");
    return re.test(xml) ? xml.replace(re, `$1${val}$2`) : xml;
};
const pick = (xml: string, tag: string) => (xml.match(new RegExp(`<${tag}>([^<]+)`, "i")) || [])[1] || "";
function montevideoNow(): string {
    const p = new Intl.DateTimeFormat("sv-SE", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(new Date());
    return p.replace(" ", "T") + "-03:00";
}

/** A dónde deben enviar los eventos las cámaras (server webhook). Configurable por
 *  Setting; si no está, se auto-detecta de una cámara ya configurada y se cachea. */
async function getWebhookTarget(): Promise<{ ip: string; port: string; url: string } | null> {
    const rows = await prisma.setting.findMany({ where: { key: { in: ["LPR_WEBHOOK_HOST", "LPR_WEBHOOK_PORT", "LPR_WEBHOOK_URL"] } } });
    const m: any = {}; rows.forEach((r) => (m[r.key] = r.value));
    if (m.LPR_WEBHOOK_HOST) return { ip: m.LPR_WEBHOOK_HOST, port: m.LPR_WEBHOOK_PORT || "10000", url: m.LPR_WEBHOOK_URL || "/api/webhooks/hikvision" };
    const cams = await prisma.device.findMany({ where: { deviceType: "LPR_CAMERA", brand: "HIKVISION" }, select: { ip: true, username: true, password: true, authType: true } });
    for (const c of cams) {
        try {
            const xml: string = await authenticatedRequest("GET", "/ISAPI/Event/notification/httpHosts/1", auth(c), { responseType: "text", accept: "application/xml", timeout: 5000 });
            const ip = pick(xml, "ipAddress"), port = pick(xml, "portNo"), url = pick(xml, "url");
            if (ip && ip !== "0.0.0.0" && port && port !== "80") {
                const set = async (k: string, v: string) => prisma.setting.upsert({ where: { key: k }, update: { value: v }, create: { key: k, value: v } });
                await set("LPR_WEBHOOK_HOST", ip); await set("LPR_WEBHOOK_PORT", port); await set("LPR_WEBHOOK_URL", url || "/api/webhooks/hikvision");
                return { ip, port, url: url || "/api/webhooks/hikvision" };
            }
        } catch { }
    }
    return null;
}

export type ProvisionStep = { name: string; ok: boolean; detail: string };

export async function provisionLprDevice(deviceId: string, includePlates = true) {
    const d = await prisma.device.findUnique({ where: { id: deviceId } });
    if (!d) return { ok: false, error: "Dispositivo no encontrado", steps: [] as ProvisionStep[] };
    if (d.brand !== "HIKVISION" || (d.deviceType as any) !== "LPR_CAMERA") return { ok: false, error: "Solo cámaras LPR Hikvision", steps: [] as ProvisionStep[] };

    const steps: ProvisionStep[] = [];
    const step = async (name: string, fn: () => Promise<string>) => {
        try { steps.push({ name, ok: true, detail: await fn() }); }
        catch (e: any) { steps.push({ name, ok: false, detail: e?.message || "error" }); }
    };

    // 1) Hora (push manual de la hora del server — offline-safe)
    await step("Hora", async () => {
        let xml: string = await authenticatedRequest("GET", "/ISAPI/System/time", auth(d), { responseType: "text", accept: "application/xml", timeout: 6000 });
        const local = montevideoNow();
        xml = setTag(setTag(xml, "timeMode", "manual"), "localTime", local);
        await authenticatedRequest("PUT", "/ISAPI/System/time", auth(d), { data: xml, contentType: "application/xml", responseType: "text", timeout: 8000 });
        return local.replace("T", " ").slice(0, 19);
    });

    // 2) Envío de eventos → server (HTTP host id=1). Es lo que hace que la cámara reporte.
    await step("Envío de eventos (HTTP host)", async () => {
        const t = await getWebhookTarget();
        if (!t) throw new Error("No pude determinar el server destino. Configurá LPR_WEBHOOK_HOST/PORT.");
        const xml = `<HttpHostNotification version="2.0" xmlns="http://www.hikvision.com/ver20/XMLSchema"><id>1</id><url>${t.url}</url><protocolType>HTTP</protocolType><parameterFormatType>XML</parameterFormatType><addressingFormatType>ipaddress</addressingFormatType><ipAddress>${t.ip}</ipAddress><portNo>${t.port}</portNo><userName></userName><httpAuthenticationMethod>none</httpAuthenticationMethod><ANPR><detectionUpLoadPicturesType opt="all,licensePlatePicture,detectionPicture">all</detectionUpLoadPicturesType></ANPR></HttpHostNotification>`;
        await authenticatedRequest("PUT", "/ISAPI/Event/notification/httpHosts/1", auth(d), { data: xml, contentType: "application/xml", responseType: "text", timeout: 8000 });
        return `${t.ip}:${t.port}${t.url}`;
    });

    // 3) Modo ANPR (verificación; cambiarlo requiere reboot, no lo forzamos)
    await step("Modo ANPR", async () => {
        const xml: string = await authenticatedRequest("GET", "/ISAPI/System/Video/inputs/channels/1/VCAResource", auth(d), { responseType: "text", accept: "application/xml", timeout: 6000 });
        const t = pick(xml, "type");
        if (t === "roadDetection") return "OK · roadDetection";
        throw new Error(`está en '${t}'; pasala a roadDetection y reiniciá la cámara`);
    });

    // 4) Códec H.264 en principal(101) y sub(102) → video en vivo sin transcodificar
    await step("Códec H.264", async () => {
        const done: string[] = [];
        for (const ch of ["101", "102"]) {
            let xml: string = await authenticatedRequest("GET", `/ISAPI/Streaming/channels/${ch}`, auth(d), { responseType: "text", accept: "application/xml", timeout: 6000 });
            if (pick(xml, "videoCodecType").toUpperCase().includes("264")) { done.push(`${ch}=ya`); continue; }
            xml = setTag(xml, "videoCodecType", "H.264");
            await authenticatedRequest("PUT", `/ISAPI/Streaming/channels/${ch}`, auth(d), { data: xml, contentType: "application/xml", responseType: "text", timeout: 8000 });
            done.push(ch);
        }
        return "canales " + done.join(", ");
    });

    // 5) Stream de video en go2rtc (persistente + en caliente)
    await step("Video en vivo (go2rtc)", async () => { await syncLprStream(d as any); return "stream registrado"; });

    // 6) Matrículas (diff incremental) — sólo si se pide (puede tardar en cámaras nuevas)
    if (includePlates) {
        await step("Matrículas", async () => {
            const r: any = await syncDeviceIncremental(deviceId);
            if (!r.ok) throw new Error(r.error || "falló la sincronización");
            return `+${r.added} agregadas${r.removed ? `, -${r.removed} quitadas` : ""}${r.addFail ? ` (${r.addFail} fallidas)` : ""}`;
        });
    }

    const okCount = steps.filter((s) => s.ok).length;
    return { ok: okCount === steps.length, steps, okCount, total: steps.length };
}
