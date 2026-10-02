import { NextResponse } from "next/server";
import { getWhatsAppConfig } from "@/lib/whatsapp";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
    const action = new URL(req.url).searchParams.get("action") || "restart";
    try {
        const cfg = await getWhatsAppConfig();
        const s = encodeURIComponent(cfg.session);
        const hit = (path: string) => fetch(`${cfg.url}${path}`, { method: "POST", headers: { "X-Api-Key": cfg.apiKey } });
        if (action === "logout") { await hit(`/api/sessions/${s}/logout`).catch(() => { }); await new Promise(r => setTimeout(r, 800)); await hit(`/api/sessions/${s}/restart`).catch(() => { }); }
        else { await hit(`/api/sessions/${s}/restart`).catch(() => { }); }
        return NextResponse.json({ ok: true });
    } catch { return NextResponse.json({ ok: false }); }
}
