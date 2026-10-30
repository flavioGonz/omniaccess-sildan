import { NextResponse } from "next/server";
import { verifyGuardCredential } from "@/app/actions/users";

export const dynamic = "force-dynamic";

/**
 * POST /api/guardia/entrar {usuario, clave} → identifica al guardia desde la app OmniAccess Guard.
 *
 * Es la misma verificación que la consola de garita (verifyGuardCredential: secreto comparado en el
 * servidor, tope de intentos por usuario) y deja la misma cookie firmada `guardia` de 14 h. La app
 * se la pasa a su WebView y la consola abre directo con ese guardia, sin volver a pedir el PIN.
 * Las acciones de servidor no se pueden llamar desde código nativo: por eso esta ruta.
 */
export async function POST(req: Request) {
    let usuario = "", clave = "";
    try { const j = await req.json(); usuario = String(j?.usuario || "").trim(); clave = String(j?.clave || ""); } catch { /* cuerpo inválido: cae abajo */ }
    if (!usuario || !clave) return NextResponse.json({ ok: false, error: "Faltan el usuario o el PIN." }, { status: 400 });
    const r = await verifyGuardCredential(usuario, clave);
    if (r.bloqueado) return NextResponse.json({ ok: false, bloqueado: true }, { status: 429 });
    if (!r.ok) return NextResponse.json({ ok: false }, { status: 401 });
    return NextResponse.json({ ok: true, nombre: r.name }, { headers: { "Cache-Control": "no-store" } });
}
