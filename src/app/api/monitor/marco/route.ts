import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { autorizarMonitor, SIN_CACHE } from "@/lib/monitor/servidor";
import { leerAjustesMonitores } from "@/app/actions/monitores";
import { funcionActiva } from "@/app/actions/funciones";
import { FUNCIONES_INSTALACION } from "@/lib/funciones";

export const dynamic = "force-dynamic";

/** GET /api/monitor/marco → lo que toda vista necesita al arrancar: cómo se llama el barrio y los ajustes de las vistas. */
export async function GET() {
    const p = await autorizarMonitor("/api/monitor/marco");
    if (p.error) return p.error;
    const filas = await prisma.setting.findMany({ where: { key: { in: ["APP_BRAND_NAME", "REPORT_COMPANY"] } } }).catch(() => []);
    const v = (k: string) => filas.find((f) => f.key === k)?.value?.trim();
    const barrio = v("APP_BRAND_NAME") || v("REPORT_COMPANY") || "OmniAccess";
    const ajustes = await leerAjustesMonitores();
    // Las funciones de la instalación, ya efectivas: una pantalla con enlace no puede llamar acciones
    // del servidor (el middleware corta sus POST), así que las recibe acá.
    const funciones = Object.fromEntries(await Promise.all(FUNCIONES_INSTALACION().map(async (f) => [f.id, await funcionActiva(f.id)] as const)));
    return NextResponse.json({ barrio, ajustes, funciones, ahora: new Date().toISOString(), pantalla: p.auth.pantalla || null }, { headers: SIN_CACHE });
}
