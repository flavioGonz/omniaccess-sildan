export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { authenticatedRequest } from "@/lib/digest-auth";
import { resolveNvrById } from "@/lib/nvr-resolve";
import sharp from "sharp";

// ?w=320 → miniatura (para listas: el JPEG completo del NVR pesa 200–400 KB por canal).
async function salida(buf: Buffer, w: number | null): Promise<Response> {
    let b = buf;
    if (w) { try { b = await sharp(buf).resize({ width: w, withoutEnlargement: true }).jpeg({ quality: 70 }).toBuffer(); } catch { } }
    return new Response(new Uint8Array(b), { headers: { "Content-Type": "image/jpeg", "Cache-Control": w ? "private, max-age=60" : "no-store" } });
}

// GET /api/nvr/snapshot?ch=N&nvr=<id> -> JPEG del canal N del NVR (foto para identificar cámaras)
export async function GET(req: NextRequest) {
    const ch = req.nextUrl.searchParams.get("ch");
    if (!ch || !/^\d+$/.test(ch)) return new Response("bad ch", { status: 400 });
    const wq = parseInt(req.nextUrl.searchParams.get("w") || "") || null;
    const w = wq ? Math.min(Math.max(wq, 80), 960) : null;
    const conn = await resolveNvrById(req.nextUrl.searchParams.get("nvr"));
    if (!conn) return new Response("no nvr", { status: 404 });
    if (conn.brand === "DAHUA") {
        for (const a of ["DIGEST", "BASIC"]) {
            try {
                const dev: any = { ip: conn.ip, username: conn.user, password: conn.pass, authType: a };
                const buf = await authenticatedRequest("GET", `/cgi-bin/snapshot.cgi?channel=${ch}`, dev, { responseType: "arraybuffer", accept: "image/jpeg", timeout: 12000 });
                return await salida(Buffer.from(buf), w);
            } catch { /* next */ }
        }
        return new Response("err", { status: 502 });
    }
    for (const a of ["DIGEST", "BASIC"]) {
        try {
            const dev: any = { ip: conn.ip, username: conn.user, password: conn.pass, authType: a };
            const buf = await authenticatedRequest("GET", `/ISAPI/Streaming/channels/${ch}01/picture`, dev, { responseType: "arraybuffer", accept: "image/jpeg", timeout: 12000 });
            return await salida(Buffer.from(buf), w);
        } catch { /* try next */ }
    }
    return new Response("err", { status: 502 });
}
