import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/app/actions/auth";
import { permisosDeSesion } from "@/lib/permisos";
import { auditar } from "@/lib/centrales/sesion";
import { importarPadronDesdeLibro } from "@/lib/padron-importar";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * POST /api/administraciones/padron — la planilla del padrón (multipart: `archivo`, y `aplicar=1`).
 *
 * Sin `aplicar` es un SIMULACRO: recorre todo, no escribe nada y devuelve qué haría. Es el paso
 * obligado antes de tocar el padrón: la pantalla muestra ese informe y recién ahí ofrece aplicar,
 * con el mismo archivo.
 *
 * No manda correos y no borra nada (lib/padron-importar).
 */
export async function POST(req: NextRequest) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- la sesión es el JWT crudo
    const s: any = await getSession().catch(() => null);
    if (!s) return NextResponse.json({ error: "Hace falta iniciar sesión." }, { status: 401 });
    if (!permisosDeSesion(s).includes("usuarios.editar")) return NextResponse.json({ error: "Tu rol no puede cargar el padrón." }, { status: 403 });
    const form = await req.formData().catch(() => null);
    const archivo = form?.get("archivo");
    if (!(archivo instanceof File)) return NextResponse.json({ error: "Falta la planilla." }, { status: 400 });
    if (archivo.size > 8 * 1024 * 1024) return NextResponse.json({ error: "La planilla es muy grande (tope 8 MB)." }, { status: 400 });
    if (!/\.xlsx$/i.test(archivo.name)) return NextResponse.json({ error: "Tiene que ser un .xlsx." }, { status: 400 });
    const aplicar = form?.get("aplicar") === "1";
    try {
        const informe = await importarPadronDesdeLibro(Buffer.from(await archivo.arrayBuffer()), { simulacro: !aplicar, quien: String(s.name || s.sub || "panel") });
        if (aplicar) await auditar(s, "administraciones.importar-padron", archivo.name, true, `${informe.lotes.nuevos} lotes nuevos, ${informe.lotes.actualizados} actualizados, ${informe.personas.nuevas} personas nuevas, ${informe.invitaciones.nuevas} códigos nuevos`);
        return NextResponse.json(informe, { headers: { "Cache-Control": "no-store" } });
    } catch (e) {
        return NextResponse.json({ error: `No se pudo leer la planilla: ${e instanceof Error ? e.message : "formato desconocido"}` }, { status: 400 });
    }
}
