import { NextResponse } from "next/server";
import { sendWebPushToAll } from "@/lib/webpush";
import { exigirTokenInterno } from "@/lib/token-interno";

export async function POST(req: Request) {
    const no = await exigirTokenInterno(req); if (no) return no;
    let body: any = {};
    try { body = await req.json(); } catch {}
    const r = await sendWebPushToAll({ title: body.title || "OmniAccess", body: body.body || "", url: body.url || "/pwa/filas" });
    return NextResponse.json({ sent: r.sent });
}
