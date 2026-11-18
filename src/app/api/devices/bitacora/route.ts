import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/app/actions/auth";
import { permisosDeSesion } from "@/lib/permisos";
import { auditar } from "@/lib/centrales/sesion";
import { importarBitacora } from "@/lib/acs-importar";

export const dynamic = "force-dynamic";
const PERMISO = "dispositivos.editar";

/**
 * POST { deviceId, desdeDias? } — trae la bitácora de un control de acceso Hikvision al historial.
 *
 * Es una lectura del equipo que ESCRIBE en nuestro historial, así que pide «Editar dispositivos»
 * y queda en Auditoría: un botón que mete mil filas en el historial tiene que poder explicarse.
 */
export async function POST(req: NextRequest) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- la sesión es el JWT crudo
    const s: any = await getSession().catch(() => null);
    if (!s) return NextResponse.json({ error: "Hace falta iniciar sesión." }, { status: 401 });
    if (!permisosDeSesion(s).includes(PERMISO)) return NextResponse.json({ error: "Tu rol no puede traer la bitácora de un equipo." }, { status: 403 });

    const b = await req.json().catch(() => null);
    const deviceId = String(b?.deviceId || "");
    if (!deviceId) return NextResponse.json({ error: "Falta el equipo." }, { status: 400 });
    const desdeDias = Math.min(365, Math.max(1, Number(b?.desdeDias) || 30));

    const r = await importarBitacora(deviceId, desdeDias);
    await auditar(s, "equipos.bitacora", deviceId, !r.error, `${r.guardados} accesos de ${r.leidos} eventos${r.error ? ` · ${r.error}` : ""}`);
    return NextResponse.json(r, { status: r.error && !r.guardados ? 502 : 200, headers: { "Cache-Control": "no-store" } });
}
