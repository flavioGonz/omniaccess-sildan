export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticatedRequest } from "@/lib/digest-auth";

// GET /api/nvr/snapshot?ch=N -> JPEG del canal N del NVR (foto para identificar cámaras)
export async function GET(req: NextRequest) {
    const ch = req.nextUrl.searchParams.get("ch");
    if (!ch || !/^\d+$/.test(ch)) return new Response("bad ch", { status: 400 });
    const rows = await prisma.setting.findMany({ where: { key: { in: ["NVR_HOST", "NVR_USER", "NVR_PASS"] } } });
    const cfg: any = {}; rows.forEach((r: any) => (cfg[r.key] = r.value));
    if (!cfg.NVR_HOST) return new Response("no nvr", { status: 404 });
    for (const a of ["DIGEST", "BASIC"]) {
        try {
            const dev: any = { ip: cfg.NVR_HOST, username: cfg.NVR_USER || "admin", password: cfg.NVR_PASS || "", authType: a };
            const buf = await authenticatedRequest("GET", `/ISAPI/Streaming/channels/${ch}01/picture`, dev, { responseType: "arraybuffer", accept: "image/jpeg", timeout: 12000 });
            return new Response(Buffer.from(buf), { headers: { "Content-Type": "image/jpeg", "Cache-Control": "no-store" } });
        } catch { /* try next */ }
    }
    return new Response("err", { status: 502 });
}
