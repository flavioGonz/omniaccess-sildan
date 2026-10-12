import { NextRequest } from "next/server";
import fs from "fs";
import path from "path";
import { DIR_CLIPS } from "@/lib/clip-instante";

export const dynamic = "force-dynamic";

// Sirve clips generados en runtime (Next NO sirve public/ creado en runtime).
// Primero la carpeta de lib/clip-instante (clips mandados por WhatsApp); después la vieja
// public/clips, donde el worker de despachos de Olivos sigue dejando los clips de alerta.
const CARPETAS = [DIR_CLIPS, "/opt/OmniAccess/public/clips"];

export async function GET(req: NextRequest, { params }: { params: Promise<{ file: string }> }) {
    const { file } = await params;
    const safe = path.basename(file || "");
    if (!/^[A-Za-z0-9._-]+\.mp4$/.test(safe)) return new Response("bad name", { status: 400 });
    for (const dir of CARPETAS) {
        try {
            const buf = fs.readFileSync(path.join(dir, safe));
            return new Response(buf, { status: 200, headers: {
                "Content-Type": "video/mp4",
                "Content-Length": String(buf.length),
                "Cache-Control": "no-store",
                ...(req.nextUrl.searchParams.get("dl") === "1" ? { "Content-Disposition": `attachment; filename="${safe}"` } : {}),
            } });
        } catch { /* siguiente carpeta */ }
    }
    return new Response("not found", { status: 404 });
}
