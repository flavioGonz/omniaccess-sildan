import { NextRequest } from "next/server";
import fs from "fs";
import path from "path";

export const dynamic = "force-dynamic";

// Sirve clips de alerta generados en runtime (Next NO sirve public/ creado en runtime).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ file: string }> }) {
    const { file } = await params;
    const safe = path.basename(file || "");
    if (!/^[A-Za-z0-9._-]+\.mp4$/.test(safe)) return new Response("bad name", { status: 400 });
    const fp = path.join("/opt/OmniAccess/public/clips", safe);
    try {
        const buf = fs.readFileSync(fp);
        return new Response(buf, { status: 200, headers: {
            "Content-Type": "video/mp4",
            "Content-Length": String(buf.length),
            "Cache-Control": "no-store",
        } });
    } catch {
        return new Response("not found", { status: 404 });
    }
}
