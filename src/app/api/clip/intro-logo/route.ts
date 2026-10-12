import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import os from "os";
import path from "path";
import { spawn } from "child_process";
import { getSession } from "@/app/actions/auth";
import { ARCHIVO_LOGO_INTRO, DIR_MARCA } from "@/lib/intro-clip";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * El logo propio de la intro de los clips (Ajustes → Video del evento).
 *   GET     lo sirve (para la vista previa); 404 si no hay uno subido.
 *   POST    form-data `archivo` (PNG, JPG o WEBP): se normaliza a PNG de hasta 1200 px de ancho.
 *   DELETE  lo quita: la intro vuelve a usar el logo de la marca de agua.
 * Vive bajo /api/clip/, que el middleware deja pasar sin sesión: por eso POST y DELETE la piden acá.
 */
export async function GET() {
    try {
        const buf = fs.readFileSync(ARCHIVO_LOGO_INTRO);
        return new Response(buf, { headers: { "Content-Type": "image/png", "Cache-Control": "no-store" } });
    } catch { return new Response("sin logo", { status: 404 }); }
}

function convertir(origen: string, destino: string): Promise<boolean> {
    return new Promise((resolve) => {
        const p = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", origen, "-vf", "scale='min(1200,iw)':-1,format=rgba", "-frames:v", "1", destino], { stdio: "ignore" });
        const k = setTimeout(() => { try { p.kill("SIGKILL"); } catch { } resolve(false); }, 20_000);
        p.on("close", (c) => { clearTimeout(k); resolve(c === 0); });
        p.on("error", () => { clearTimeout(k); resolve(false); });
    });
}

export async function POST(req: NextRequest) {
    if (!(await getSession())) return NextResponse.json({ ok: false, error: "Hace falta una sesión del panel." }, { status: 401 });
    const form = await req.formData().catch(() => null);
    const f = form?.get("archivo") as File | null;
    if (!f || typeof f === "string") return NextResponse.json({ ok: false, error: "No llegó ningún archivo." }, { status: 400 });
    if (!/^image\/(png|jpe?g|webp)$/i.test(f.type)) return NextResponse.json({ ok: false, error: "Tiene que ser PNG, JPG o WEBP (PNG con fondo transparente queda mejor)." }, { status: 400 });
    if (f.size > 8 * 1024 * 1024) return NextResponse.json({ ok: false, error: "El archivo pesa más de 8 MB." }, { status: 400 });
    const tmp = path.join(os.tmpdir(), `logo-intro-${Date.now()}`);
    try {
        fs.writeFileSync(tmp, Buffer.from(await f.arrayBuffer()));
        fs.mkdirSync(DIR_MARCA, { recursive: true });
        const destTmp = ARCHIVO_LOGO_INTRO + ".nuevo.png";
        if (!(await convertir(tmp, destTmp))) return NextResponse.json({ ok: false, error: "No se pudo leer la imagen." }, { status: 400 });
        fs.renameSync(destTmp, ARCHIVO_LOGO_INTRO);
        return NextResponse.json({ ok: true });
    } finally { try { fs.unlinkSync(tmp); } catch { } }
}

export async function DELETE() {
    if (!(await getSession())) return NextResponse.json({ ok: false, error: "Hace falta una sesión del panel." }, { status: 401 });
    try { fs.unlinkSync(ARCHIVO_LOGO_INTRO); } catch { }
    return NextResponse.json({ ok: true });
}
