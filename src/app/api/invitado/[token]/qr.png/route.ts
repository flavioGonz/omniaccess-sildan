import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { qrPasePng } from "@/lib/qr-pase";

export const dynamic = "force-dynamic";

// GET /api/invitado/<token>/qr.png → el QR del pase, con el logo del barrio si está
// configurado. Lo usa el bot de WhatsApp (proceso aparte, sin Next) para no tener una
// segunda implementación del QR; también sirve para descargar/imprimir el pase.
export async function GET(_req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
    const { token } = await ctx.params;
    const limpio = String(token || "").replace(/[^A-Za-z0-9_-]/g, "");
    if (!limpio) return new Response("token inválido", { status: 400 });
    const base = ((await prisma.setting.findUnique({ where: { key: "BASE_URL" } }))?.value || "").replace(/\/+$/, "");
    // El QR codifica el link completo cuando hay BASE_URL (abre la página del pase en
    // cualquier teléfono); si no, el token pelado, que la garita igual resuelve.
    const texto = base ? `${base}/invitado/${limpio}` : limpio;
    const png = await qrPasePng(texto, 512);
    return new Response(new Uint8Array(png), { headers: { "Content-Type": "image/png", "Cache-Control": "no-store" } });
}
