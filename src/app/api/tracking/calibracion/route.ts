import { NextRequest, NextResponse } from "next/server";
import { execFile } from "child_process";
import path from "path";

export const dynamic = "force-dynamic";

/**
 * GET /api/tracking/calibracion?horas=6
 *
 * El informe de calibración, por HTTP.
 *
 * La medición ya existe como script y corre dentro del servidor. Este endpoint la expone
 * para que una tarea programada pueda pedirla desde afuera, sin depender de que la
 * computadora de nadie esté prendida: una tarea que sólo corre cuando hay una laptop
 * despierta no es una tarea programada, es un recordatorio.
 *
 * Se protege con el mismo token que la pasarela (`x-tracking-token`). No devuelve datos
 * de residentes: sólo conteos, confianzas y veredictos por cámara.
 */

const TIEMPO_MS = 60_000;

export async function POST(req: NextRequest) { return manejar(req); }
export async function GET(req: NextRequest) { return manejar(req); }

async function manejar(req: NextRequest) {
    const token = req.headers.get("x-tracking-token") || "";
    let esperado = process.env.TRACKING_TOKEN || "";
    if (!esperado) {
        const { prisma } = await import("@/lib/prisma");
        const s = await prisma.setting.findUnique({ where: { key: "TRACKING_TOKEN" } });
        esperado = s?.value || "";
    }
    if (!esperado || token !== esperado) {
        return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const horas = Math.max(1, Math.min(Number(req.nextUrl.searchParams.get("horas") || 6), 168));
    const script = path.join(process.cwd(), "scripts", "calibracion.js");

    const salida: string = await new Promise<string>((resolve, reject) => {
        execFile(
            process.execPath,
            [script, "--horas", String(horas), "--json"],
            { cwd: process.cwd(), timeout: TIEMPO_MS, maxBuffer: 4 * 1024 * 1024 },
            (err, stdout, stderr) => {
                if (err) reject(new Error(stderr?.trim() || err.message));
                else resolve(stdout);
            },
        );
    }).catch((e) => { throw e; });

    try {
        return NextResponse.json(JSON.parse(salida));
    } catch {
        // Si el script escribió algo que no es JSON, devolverlo crudo es más útil que un
        // error genérico: el texto suele decir exactamente qué falló.
        return NextResponse.json({ error: "salida no interpretable", salida: salida.slice(0, 4000) }, { status: 500 });
    }
}
