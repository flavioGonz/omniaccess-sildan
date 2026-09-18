import { NextRequest } from "next/server";
import fs from "fs";
import path from "path";

export const dynamic = "force-dynamic";

/** Sirve los cuadros guardados por la pasarela de seguimiento. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ file: string }> }) {
    const { file } = await params;
    const safe = path.basename(file || "");
    if (!/^[A-Za-z0-9._-]+\.jpg$/.test(safe)) return new Response("bad name", { status: 400 });
    const dir = process.env.TRACKING_SHOTS_DIR || "/datos/track";
    try {
        const buf = fs.readFileSync(path.join(dir, safe));
        return new Response(buf, {
            status: 200,
            headers: { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=86400" },
        });
    } catch {
        return new Response("not found", { status: 404 });
    }
}
