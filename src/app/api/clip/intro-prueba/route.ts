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
    // De relleno, un cuadro real de una cámara LPR (go2rtc) con un leve acercamiento, para que la
    // muestra se vea como un clip de verdad. Si no hay cámara, un fondo neutro.
    const dir = path.join(os.tmpdir(), "omni-intro");
    fs.mkdirSync(dir, { recursive: true });
    const base = path.join(dir, `relleno-${Date.now()}.mp4`);
    const cuadro = path.join(dir, "cuadro.jpg");
    try {
        const streams: any = await fetch("http://127.0.0.1:1984/api/streams", { cache: "no-store" }).then((r) => r.json());
        const src = Object.keys(streams || {}).find((k) => k.startsWith("lpr_") && !k.endsWith("_hd"));
        if (src) {
            const r = await fetch(`http://127.0.0.1:1984/api/frame.jpeg?src=${encodeURIComponent(src)}`, { cache: "no-store" });
            if (r.ok) fs.writeFileSync(cuadro, Buffer.from(await r.arrayBuffer()));
        }
    } catch { }
    const okBase = fs.existsSync(cuadro)
        ? await correr(["-hide_banner", "-loglevel", "error", "-y", "-loop", "1", "-t", "3", "-i", cuadro, "-vf", "scale=1280:720,zoompan=z='1+0.0008*on':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=1280x720:fps=30,format=yuv420p", "-c:v", "libx264", "-preset", "veryfast", base])
        : await correr(["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=c=0x1e293b:s=1280x720:r=30:d=3", "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", base]);
    if (!okBase) return new Response("no se pudo armar el video de relleno", { status: 500 });
    const salida = path.join(os.tmpdir(), "omni-intro", `prueba-${Date.now()}.mp4`);
    fs.renameSync(base, salida);
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
