"use server";
import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";

const SUBS_FILE = path.join(process.cwd(), "push_subs.json");

function sid(endpoint: string) { return crypto.createHash("sha1").update(endpoint).digest("hex").slice(0, 12); }
function hostOf(endpoint: string) { try { return new URL(endpoint).host; } catch { return ""; } }
function browserOf(ua: string) {
    if (!ua) return "Navegador";
    if (/edg/i.test(ua)) return "Edge";
    if (/chrome|crios/i.test(ua)) return "Chrome";
    if (/firefox|fxios/i.test(ua)) return "Firefox";
    if (/safari/i.test(ua)) return "Safari";
    return "Navegador";
}
function osOf(ua: string) {
    if (/android/i.test(ua)) return "Android";
    if (/iphone|ipad|ios/i.test(ua)) return "iOS";
    if (/windows/i.test(ua)) return "Windows";
    if (/mac os|macintosh/i.test(ua)) return "macOS";
    if (/linux/i.test(ua)) return "Linux";
    return "";
}

async function readSubs(): Promise<any[]> {
    try { const a = JSON.parse(await fs.readFile(SUBS_FILE, "utf-8")); return Array.isArray(a) ? a : []; } catch { return []; }
}
async function writeSubs(subs: any[]) { await fs.writeFile(SUBS_FILE, JSON.stringify(subs, null, 2)); }

export async function getPushSubscribers() {
    const subs = await readSubs();
    return subs.map((s: any) => ({
        id: sid(s.endpoint || ""),
        host: hostOf(s.endpoint || ""),
        browser: browserOf(s.ua || ""),
        os: osOf(s.ua || ""),
        label: s.label || "",
        createdAt: s.createdAt || null,
        enabled: s.enabled !== false,
    }));
}

export async function deletePushSubscriber(id: string) {
    const subs = await readSubs();
    await writeSubs(subs.filter((s: any) => sid(s.endpoint || "") !== id));
    return { ok: true };
}

export async function togglePushSubscriber(id: string) {
    const subs = await readSubs();
    for (const s of subs) if (sid(s.endpoint || "") === id) s.enabled = s.enabled === false ? true : false;
    await writeSubs(subs);
    return { ok: true };
}

export async function renamePushSubscriber(id: string, label: string) {
    const subs = await readSubs();
    for (const s of subs) if (sid(s.endpoint || "") === id) s.label = label;
    await writeSubs(subs);
    return { ok: true };
}
