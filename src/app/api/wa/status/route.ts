import { NextResponse } from "next/server";
import { getWhatsAppConfig } from "@/lib/whatsapp";

export const dynamic = "force-dynamic";

export async function GET() {
    try {
        const cfg = await getWhatsAppConfig();
        const r = await fetch(`${cfg.url}/api/sessions/${encodeURIComponent(cfg.session)}`, { headers: { "X-Api-Key": cfg.apiKey }, cache: "no-store" });
        if (!r.ok) return NextResponse.json({ ok: false, status: r.status === 401 ? "BADKEY" : "ERROR" });
        const d = await r.json();
        const me = d.me ? { id: (d.me.id || "").replace(/@c\.us$/, ""), pushName: d.me.pushName || null } : null;
        return NextResponse.json({ ok: true, status: d.status, me, engine: d?.engine?.engine || null });
    } catch { return NextResponse.json({ ok: false, status: "UNREACHABLE" }); }
}
