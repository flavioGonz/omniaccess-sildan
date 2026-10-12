import { NextRequest } from "next/server";
import fs from "fs";
import os from "os";
import path from "path";
import { spawn } from "child_process";
import { getSession } from "@/app/actions/auth";
import { ponerIntro, logoIntro } from "@/lib/intro-clip";
import { marcaAguaArchivo } from "@/lib/clip-instante";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Una intro de muestra con lo configurado ahora (logo, color), sobre un video de relleno. Para Ajustes. */
function correr(args: string[]): Promise<boolean> {
    return new Promise((resolve) => {
        const p = spawn("ffmpeg", args, { stdio: "ignore" });
        const k = setTimeout(() => { try { p.kill("SIGKILL"); } catch { } resolve(false); }, 30_000);
        p.on("close", (c) => { clearTimeout(k); resolve(c === 0); });
        p.on("error", () => { clearTimeout(k); resolve(false); });
    });
}

export async function GET(req: NextRequest) {
    if (!(await getSession())) return new Response("no autorizado", { status: 401 });
    const base = path.join(os.tmpdir(), "omni-intro", "relleno.mp4");
    if (!fs.existsSync(base)) {
        fs.mkdirSync(path.dirname(base), { recursive: true });
        await correr(["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=1280x720:r=30:d=3", "-vf", "eq=saturation=0.35:brightness=-0.05", "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", base]);
    }
    const salida = path.join(os.tmpdir(), "omni-intro", `prueba-${Date.now()}.mp4`);
    fs.copyFileSync(base, salida);
    const color = req.nextUrl.searchParams.get("color");
    const ok = await ponerIntro(salida, {
        descripcion: req.nextUrl.searchParams.get("texto") || "Ingreso de vehículo por la garita principal, revisado por el guardia",
        camara: "Matrículas P1", instante: Date.now(), matricula: "ABC1234",
        logo: logoIntro() || marcaAguaArchivo(), color: color && /^#[0-9a-fA-F]{6}$/.test(color) ? color : null,
    }, 26);
    if (!ok) { try { fs.unlinkSync(salida); } catch { } return new Response("no se pudo armar la muestra", { status: 500 }); }
    const buf = fs.readFileSync(salida); fs.unlink(salida, () => { });
    return new Response(buf, { headers: { "Content-Type": "video/mp4", "Content-Length": String(buf.length), "Cache-Control": "no-store" } });
}
