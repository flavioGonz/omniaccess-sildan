import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { getSession } from "@/app/actions/auth";
import { permisosDeSesion } from "@/lib/permisos";
import { prisma } from "@/lib/prisma";
import { leerPlanoLotes } from "@/lib/plano-lotes";
import { carpetaPlanos } from "@/lib/plano-lotes-importar";

export const dynamic = "force-dynamic";

/**
 * GET /api/administraciones/plano — la imagen del croquis de los lotes (ver lib/plano-lotes).
 *
 * Sale por acá y no desde `public/` porque es el dibujo de un barrio con sus padrones: lo ve quien
 * tiene sesión en el panel, no cualquiera que adivine la dirección. El nombre del archivo sale de la
 * Setting ya validado (sin barras ni `..`), así que no se puede pedir otro archivo del servidor.
 */
export async function GET() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- la sesión es el JWT crudo
    const s: any = await getSession().catch(() => null);
    if (!s) return NextResponse.json({ error: "Hace falta iniciar sesión." }, { status: 401 });
    if (!permisosDeSesion(s).includes("usuarios")) return NextResponse.json({ error: "Tu rol no ve los lotes." }, { status: 403 });
    const plano = leerPlanoLotes((await prisma.setting.findUnique({ where: { key: "PLANO_LOTES" } }).catch(() => null))?.value);
    if (!plano) return NextResponse.json({ error: "No hay croquis cargado." }, { status: 404 });
    const f = path.join(carpetaPlanos(), plano.archivo);
    const buf = await fs.promises.readFile(f).catch(() => null);
    if (!buf) return NextResponse.json({ error: "Falta la imagen del croquis en el servidor." }, { status: 404 });
    const tipo = /\.png$/i.test(f) ? "image/png" : /\.webp$/i.test(f) ? "image/webp" : "image/jpeg";
    // Un día de caché privada: el croquis casi no cambia, y pesa.
    return new NextResponse(new Uint8Array(buf), { headers: { "Content-Type": tipo, "Cache-Control": "private, max-age=86400" } });
}
