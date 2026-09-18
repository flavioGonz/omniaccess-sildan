import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyApiAuth, unauthorizedResponse } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

const PIN_POR_DEFECTO = "271111";

/**
 * Clave para cambiar de modalidad. Se guarda en el Setting MODE_CHANGE_PIN
 * para poder cambiarla sin tocar codigo; si no existe, vale la de fabrica.
 * La comparacion vive en el servidor: la clave nunca viaja al navegador.
 */
export async function POST(req: NextRequest) {
    const auth = await verifyApiAuth();
    if (!auth.authenticated) return unauthorizedResponse();

    const codigo = String((await req.json().catch(() => ({})))?.codigo || "").trim();
    if (!codigo) return NextResponse.json({ ok: false }, { status: 400 });

    let esperado = PIN_POR_DEFECTO;
    try {
        const s = await prisma.setting.findUnique({ where: { key: "MODE_CHANGE_PIN" } });
        if (s?.value?.trim()) esperado = s.value.trim();
    } catch { }

    if (codigo !== esperado) {
        return NextResponse.json({ ok: false, error: "Clave incorrecta" }, { status: 403 });
    }
    return NextResponse.json({ ok: true });
}
