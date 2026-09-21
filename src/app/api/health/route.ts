import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/health — ¿está vivo el sitio?
 *
 * Deliberadamente **no** consulta la base, ni Redis, ni nada más. Un chequeo de vida que
 * depende de otra cosa contesta "caído" cuando lo que se cayó es esa otra cosa, y entonces
 * el vigía reinicia el sitio para arreglar un problema de Postgres — que es peor que no
 * hacer nada. Cada servicio se revisa por su cuenta (ver `vigia.js`).
 *
 * Va sin sesión, como el resto de los tick y los webhooks: no dice absolutamente nada del
 * barrio, y exigirle sesión al vigía implicaría darle credenciales a un proceso cuyo único
 * trabajo es saber si el otro contesta.
 */
export async function GET() {
    return NextResponse.json({ ok: true, al: new Date().toISOString() });
}
