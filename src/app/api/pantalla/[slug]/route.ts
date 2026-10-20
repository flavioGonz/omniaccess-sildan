import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { prisma } from "@/lib/prisma";
import { filasDePantalla } from "@/lib/filas/pantalla";

/**
 * GET /api/pantalla/<slug>?t=<token> — los datos de una pantalla de fila, sin sesión.
 *
 * Es pública en el middleware a propósito: la abre un monitor de sala de espera. Lo que la cuida
 * es el token de cada pantalla, que se compara acá contra la base. Sin token válido, la misma
 * respuesta que si la pantalla no existiera: no se le confirma a nadie qué nombres hay.
 *
 * Devuelve sólo lo que se ve en la sala (nombre, aforo, límite, espera), nunca IP ni cámaras.
 */
export const dynamic = "force-dynamic";

/** Sólo logos servidos sin sesión: un /api/files/... en la pantalla pública daría 401. */
const LOGO_PUBLICO_RX = /^\/(branding\/|api\/branding\/)/;

function igual(a: string, b: string): boolean {
    const x = Buffer.from(a), y = Buffer.from(b);
    return x.length === y.length && timingSafeEqual(x, y);
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
    const { slug } = await params;
    const t = req.nextUrl.searchParams.get("t") || "";
    const p = await prisma.pantallaFila.findUnique({ where: { slug } }).catch(() => null);
    if (!p || !t || !igual(p.token, t)) return NextResponse.json({ error: "Pantalla no encontrada" }, { status: 404 });
    if (!p.activa) return NextResponse.json({ error: "Pantalla desactivada", desactivada: true }, { status: 410 });

    const [filas, marca] = await Promise.all([
        filasDePantalla(p.deviceIds),
        prisma.setting.findMany({ where: { key: { in: ["APP_BRAND_NAME", "APP_BRAND_LOGO_URL", "REPORT_LOGO_URL"] } } }).catch(() => []),
    ]);
    const m = Object.fromEntries(marca.map((s) => [s.key, s.value]));
    const logo = [m.APP_BRAND_LOGO_URL, m.REPORT_LOGO_URL].find((u) => u && LOGO_PUBLICO_RX.test(u)) || null;

    return NextResponse.json({
        pantalla: { nombre: p.nombre, tema: p.tema, verEspera: p.verEspera, verHora: p.verHora, mensaje: p.mensaje },
        marca: { nombre: m.APP_BRAND_NAME || "OmniAccess", logo },
        filas,
        ahora: new Date().toISOString(),
    }, { headers: { "Cache-Control": "no-store" } });
}
