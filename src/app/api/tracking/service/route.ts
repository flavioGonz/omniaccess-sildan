import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyApiAuth, unauthorizedResponse } from "@/lib/api-auth";
import { exec } from "child_process";
import { promisify } from "util";

const correr = promisify(exec);
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Estado y control del contenedor Omni-LPR y de la pasarela de seguimiento. */

async function salida(cmd: string) {
    try { const { stdout } = await correr(cmd, { timeout: 20000 }); return stdout.trim(); }
    catch { return ""; }
}

export async function GET() {
    const auth = await verifyApiAuth();
    if (!auth.authenticated) return unauthorizedResponse();

    const lprUrl = (process.env.OMNI_LPR_URL || "http://127.0.0.1:8000").replace(/\/$/, "");

    let salud: any = null;
    let ms = 0;
    try {
        const t = Date.now();
        const r = await fetch(`${lprUrl}/api/health`, { signal: AbortSignal.timeout(4000) });
        ms = Date.now() - t;
        salud = await r.json();
    } catch { }

    const contenedor = await salida(`docker inspect omni-lpr --format '{{.State.Status}}|{{.State.StartedAt}}|{{.Config.Image}}'`);
    const [estadoCont, desde, imagen] = contenedor ? contenedor.replace(/'/g, "").split("|") : ["", "", ""];

    const pm2 = await salida(`pm2 jlist`);
    let worker: any = null;
    try {
        const lista = JSON.parse(pm2 || "[]");
        const p = lista.find((x: any) => x.name === "tracking-worker");
        if (p) worker = { estado: p.pm2_env?.status, reinicios: p.pm2_env?.restart_time, memoria: p.monit?.memory, cpu: p.monit?.cpu, desde: p.pm2_env?.pm_uptime };
    } catch { }

    // Las camaras interiores viven en Dispositivos LPR; el Setting queda de respaldo.
    let camaras = 0;
    try {
        camaras = await prisma.device.count({
            where: { deviceType: "LPR_INTERIOR" as any, trackEnabled: true, NOT: { rtspUrl: null } },
        });
        if (camaras === 0) {
            const s = await prisma.setting.findUnique({ where: { key: "TRACK_CAMERAS" } });
            const arr = JSON.parse(s?.value || "[]");
            if (Array.isArray(arr)) camaras = arr.filter((c: any) => c?.rtsp && c?.name && c?.activa !== false).length;
        }
    } catch { }

    const desde24 = new Date(Date.now() - 24 * 60 * 60 * 1000);
    let lecturas24 = 0;
    let ultimas: any[] = [];
    try {
        lecturas24 = await prisma.plateSighting.count({ where: { source: "TRACK", timestamp: { gte: desde24 } } });
        ultimas = await prisma.plateSighting.findMany({
            where: { source: "TRACK" },
            orderBy: { timestamp: "desc" },
            take: 12,
            select: { plate: true, cameraName: true, confidence: true, timestamp: true, snapshotUrl: true },
        });
    } catch { }

    return NextResponse.json({
        lprUrl,
        salud: salud ? { ...salud, latencia: ms } : null,
        contenedor: estadoCont ? { estado: estadoCont, desde, imagen } : null,
        worker,
        camaras,
        lecturas24,
        ultimas,
        parametros: {
            minConfidence: Number(process.env.TRACKING_MIN_CONFIDENCE || 0.6),
            dedupeSeconds: Number(process.env.TRACKING_DEDUPE_SECONDS || 45),
        },
    });
}

export async function POST(req: NextRequest) {
    const auth = await verifyApiAuth();
    if (!auth.authenticated) return unauthorizedResponse();
    if (auth.role !== "ADMIN") {
        return NextResponse.json({ error: "Solo un administrador puede operar el servicio." }, { status: 403 });
    }

    const accion = String((await req.json().catch(() => ({})))?.accion || "");
    const permitidas: Record<string, string> = {
        "reiniciar-lpr": "docker restart omni-lpr",
        "iniciar-lpr": "docker start omni-lpr",
        "detener-lpr": "docker stop omni-lpr",
        "reiniciar-worker": "pm2 restart tracking-worker",
    };
    const cmd = permitidas[accion];
    if (!cmd) return NextResponse.json({ error: "Acción no permitida." }, { status: 400 });

    try {
        await correr(cmd, { timeout: 45000 });
        return NextResponse.json({ ok: true, accion });
    } catch (e: any) {
        return NextResponse.json({ error: e?.message || "El comando falló" }, { status: 500 });
    }
}
