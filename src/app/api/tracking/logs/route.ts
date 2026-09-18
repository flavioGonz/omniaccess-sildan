import { NextResponse } from "next/server";
import { verifyApiAuth, unauthorizedResponse } from "@/lib/api-auth";
import { exec } from "child_process";
import { promisify } from "util";

const correr = promisify(exec);
export const dynamic = "force-dynamic";

/** Ultimas lineas del contenedor y de la pasarela, para diagnosticar sin SSH. */
export async function GET() {
    const auth = await verifyApiAuth();
    if (!auth.authenticated) return unauthorizedResponse();

    const leer = async (cmd: string) => {
        try { const { stdout, stderr } = await correr(cmd, { timeout: 15000, maxBuffer: 1024 * 1024 }); return (stdout + stderr).trim().split("\n").slice(-60).join("\n"); }
        catch (e: any) { return `No disponible: ${e?.message || e}`; }
    };

    const [lpr, worker] = await Promise.all([
        leer("docker logs --tail 60 omni-lpr 2>&1"),
        leer("pm2 logs tracking-worker --lines 60 --nostream --raw 2>&1"),
    ]);

    return NextResponse.json({ lpr, worker });
}
