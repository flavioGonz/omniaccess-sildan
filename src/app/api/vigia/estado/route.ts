import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyApiAuth, unauthorizedResponse } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/vigia/estado — qué vio el vigía en su última vuelta.
 *
 * El estado lo escribe `vigia.js` en un ajuste, y no en una tabla propia, por una razón
 * concreta: son ocho renglones que se pisan cada treinta segundos. Una tabla para eso
 * sería una tabla que crece sin parar y que nadie consulta hacia atrás — el histórico de
 * caídas ya queda en `DispatchJob`, que es donde están los avisos con su fecha.
 *
 * Se devuelve también `al`, y eso importa más de lo que parece: si el propio vigía se cayó,
 * el estado que hay guardado es viejo y todo figuraría en verde. Un panel que dice "todo
 * bien" porque quien mira dejó de mirar es exactamente la clase de mentira que este
 * trabajo vino a sacar del sistema.
 */
export async function GET() {
    const auth = await verifyApiAuth();
    if (!auth.authenticated) return unauthorizedResponse();

    const fila = await prisma.setting.findUnique({ where: { key: "VIGIA_ESTADO" } });
    if (!fila?.value) {
        return NextResponse.json({ hay: false, motivo: "el vigía todavía no escribió nada" });
    }
    try {
        const d = JSON.parse(fila.value);
        const al = Date.parse(d?.al || "");
        const segundos = Number.isFinite(al) ? Math.round((Date.now() - al) / 1000) : null;
        return NextResponse.json({
            hay: true,
            al: d?.al ?? null,
            /* Más de tres vueltas sin escribir: el vigía no está mirando. */
            vigente: segundos != null && segundos < 120,
            haceSegundos: segundos,
            servicios: Array.isArray(d?.servicios) ? d.servicios : [],
        });
    } catch {
        return NextResponse.json({ hay: false, motivo: "el estado guardado no se pudo leer" });
    }
}
