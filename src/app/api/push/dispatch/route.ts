import { NextResponse } from "next/server";
import { sendWebPushToAll } from "@/lib/webpush";

export async function POST(req: Request) {
    let body: any = {};
    try { body = await req.json(); } catch {}
    const r = await sendWebPushToAll({ title: body.title || "OmniAccess", body: body.body || "", url: body.url || "/pwa/filas" });
    return NextResponse.json({ sent: r.sent });
}
