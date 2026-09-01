import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";
import { sendWebPushToOne, sendWebPushToAll } from "@/lib/webpush";

const SUBS_FILE = path.join(process.cwd(), "push_subs.json");
function sid(endpoint: string) { return crypto.createHash("sha1").update(endpoint).digest("hex").slice(0, 12); }

export async function POST(req: Request) {
    let id: string | undefined;
    try { const b = await req.json(); id = b?.id; } catch {}
    const payload = { title: "OmniAccess", body: "Notificación de prueba ✅", url: "/pwa/filas" };
    if (id) {
        let subs: any[] = [];
        try { subs = JSON.parse(await fs.readFile(SUBS_FILE, "utf-8")); } catch {}
        const sub = subs.find((s) => sid(s.endpoint || "") === id);
        if (!sub) return NextResponse.json({ error: "no encontrado" }, { status: 404 });
        const r = await sendWebPushToOne(sub, payload);
        return NextResponse.json({ sent: r.ok ? 1 : 0 });
    }
    const r = await sendWebPushToAll(payload);
    return NextResponse.json({ sent: r.sent });
}
