import { NextResponse } from "next/server";
import { getWhatsAppConfig } from "@/lib/whatsapp";

export const dynamic = "force-dynamic";

export async function GET() {
    try {
        const cfg = await getWhatsAppConfig();
        const r = await fetch(`${cfg.url}/api/${encodeURIComponent(cfg.session)}/auth/qr?format=image`, { headers: { "X-Api-Key": cfg.apiKey }, cache: "no-store" });
        if (!r.ok) return new NextResponse(null, { status: 204 });
        const buf = Buffer.from(await r.arrayBuffer());
        return new NextResponse(buf, { headers: { "content-type": "image/png", "cache-control": "no-store, max-age=0" } });
    } catch { return new NextResponse(null, { status: 204 }); }
}
