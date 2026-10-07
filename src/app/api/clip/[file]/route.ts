import { NextRequest } from "next/server";
import fs from "fs";
import path from "path";
import { DIR_CLIPS } from "@/lib/clip-instante";

export const dynamic = "force-dynamic";

// Sirve clips de alerta generados en runtime (Next NO sirve public/ creado en runtime).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ file: string }> }) {
    const { file } = await params;
    const safe = path.basename(file || "");
    if (!/^[A-Za-z0-9._-]+\.mp4$/.test(safe)) return new Response("bad name", { status: 400 });
    // Mismo directorio en el que escribe lib/clip-instante (antes un /opt/OmniAccess fijo).
    const fp = path.join(DIR_CLIPS, safe);
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
