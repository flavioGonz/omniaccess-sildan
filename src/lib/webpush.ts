import webpush from "web-push";
import { promises as fs } from "fs";
import path from "path";
import { prisma } from "@/lib/prisma";

let configured = false;
function ensureConfigured() {
    if (configured) return true;
    const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || "";
    const priv = process.env.VAPID_PRIVATE_KEY || "";
    const subject = process.env.VAPID_SUBJECT || "mailto:soporte@omniaccess.com";
    if (pub && priv) { webpush.setVapidDetails(subject, pub, priv); configured = true; }
    return configured;
}

const SUBS_FILE = path.join(process.cwd(), "push_subs.json");

/** Icono del modo activo de OmniAccess para usar en las notificaciones push. */
async function modeIconKey(): Promise<string> {
    try {
        const rows = await prisma.setting.findMany({ where: { key: { in: ["MODULE_LPR", "MODULE_FACE", "MODULE_QUEUE"] } } });
        const on = (k: string) => rows.find((r) => r.key === k)?.value === "true";
        if (on("MODULE_QUEUE")) return "filas";
        if (on("MODULE_FACE")) return "face";
        if (on("MODULE_LPR")) return "lpr";
    } catch {}
    return "filas";
}

/** Send a Web Push notification to every stored subscription (prunes dead ones). */
export async function sendWebPushToAll(payload: { title: string; body: string; url?: string }) {
    if (!ensureConfigured()) return { sent: 0 };
    let subs: any[] = [];
    try { subs = JSON.parse(await fs.readFile(SUBS_FILE, "utf-8")); } catch { return { sent: 0 }; }
    if (!Array.isArray(subs) || subs.length === 0) return { sent: 0 };
    const active = subs.filter((s) => s.enabled !== false);
    const ik = await modeIconKey();
    const data = JSON.stringify({ title: payload.title, body: payload.body, url: payload.url || "/pwa/filas", icon: `/iconos/${ik}-512.png`, badge: `/iconos/${ik}-192.png` });
    let sent = 0;
    const dead: string[] = [];
    await Promise.all(active.map(async (s) => {
        try { await webpush.sendNotification(s, data); sent++; }
        catch (e: any) { if (e?.statusCode === 410 || e?.statusCode === 404) dead.push(s.endpoint); }
    }));
    if (dead.length) {
        try { await fs.writeFile(SUBS_FILE, JSON.stringify(subs.filter((s) => !dead.includes(s.endpoint)), null, 2)); } catch {}
    }
    return { sent };
}

/** Send a Web Push notification to a single subscription. */
export async function sendWebPushToOne(sub: any, payload: { title: string; body: string; url?: string }) {
    if (!ensureConfigured()) return { ok: false };
    const ik = await modeIconKey();
    const data = JSON.stringify({ title: payload.title, body: payload.body, url: payload.url || "/pwa/filas", icon: `/iconos/${ik}-512.png`, badge: `/iconos/${ik}-192.png` });
    try { await webpush.sendNotification(sub, data); return { ok: true }; }
    catch (e: any) { return { ok: false, status: e?.statusCode }; }
}
