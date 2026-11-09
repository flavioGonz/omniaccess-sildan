import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * Receptor del "Event Notification" de los porteros Grandstream GDS (Maintenance → Event
 * Notification del equipo). El GDS hace POST acá cuando pasa algo (abrir puerta, tarjeta,
 * timbre, y —si está— rostro). Es el push nativo del equipo: complementa lo que OmniVision
 * ya reconoce sobre el stream (doble verificación).
 *
 * Configurar en el GDS:
 *   Via Type: HTTP · HTTP Method: POST
 *   HTTP/HTTPS Server:  http://<ip-omniaccess>:10001/api/webhooks/grandstream
 *   URL Template (cuerpo JSON):
 *     {"mac":"${MAC}","type":"${TYPE}","msg":"${WARNING_MSG}","card":"${CARDID}","door":"${DOOR_NUM}","user":"${USERNAME}","sip":"${SIPNUM}","date":"${DATE}"}
 *
 * Acepta también form-urlencoded / texto por si el template se deja en otro formato.
 */

function limpio(v: any): string | null {
    const s = (v ?? "").toString().trim();
    // El GDS manda la variable sin expandir (ej. "${CARDID}") cuando no aplica: se descarta.
    if (!s || /^\$\{.*\}$/.test(s)) return null;
    return s;
}

export async function POST(req: NextRequest) {
    try {
        let body: any = {};
        const ct = req.headers.get("content-type") || "";
        const raw = await req.text();
        if (ct.includes("json")) { try { body = JSON.parse(raw); } catch { body = {}; } }
        else if (ct.includes("form-urlencoded")) { body = Object.fromEntries(new URLSearchParams(raw)); }
        else { try { body = JSON.parse(raw); } catch { body = { msg: raw }; } }

        const mac = limpio(body.mac || body.MAC);
        const tipo = limpio(body.type || body.TYPE);
        const msg = limpio(body.msg || body.WARNING_MSG || body.content);
        const card = limpio(body.card || body.CARDID);
        const door = limpio(body.door || body.DOOR_NUM);
        const usuario = limpio(body.user || body.USERNAME);
        const fecha = limpio(body.date || body.DATE);

        // Ubicar el equipo por MAC; si no, por la IP de origen.
        const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || req.nextUrl.hostname;
        const device = await prisma.device.findFirst({
            where: { OR: [...(mac ? [{ mac }] : []), { ip }] },
            select: { id: true, name: true },
        });

        // userId: por nombre de usuario (si el equipo lo manda) o por credencial = tarjeta.
        let userId: string | null = null;
        if (usuario) userId = (await prisma.user.findFirst({ where: { name: { equals: usuario, mode: "insensitive" } }, select: { id: true } }))?.id || null;
        if (!userId && card) userId = (await prisma.credential.findFirst({ where: { value: card, type: "TAG" }, select: { userId: true } }))?.userId || null;

        // Tipo de acceso: tarjeta → TAG; con usuario/rostro → FACE; si no, genérico.
        const accessType = card ? "TAG" : (usuario ? "FACE" : null);

        const details = [
            tipo ? `Tipo: ${tipo}` : null,
            msg ? msg : null,
            card ? `Tarjeta: ${card}` : null,
            door ? `Puerta: ${door}` : null,
            usuario ? `Usuario: ${usuario}` : null,
            "Source: Grandstream (push)",
        ].filter(Boolean).join(", ");

        await prisma.accessEvent.create({
            data: {
                timestamp: fecha ? (new Date(fecha).toString() !== "Invalid Date" ? new Date(fecha) : new Date()) : new Date(),
                accessType: accessType as any,
                userId,
                deviceId: device?.id || null,
                decision: "GRANT",
                details,
                location: device?.name || "Grandstream",
            },
        });

        return NextResponse.json({ status: "received", ok: true });
    } catch (error: any) {
        console.error("[Webhook Grandstream]", error?.message);
        return NextResponse.json({ error: error?.message || "error" }, { status: 500 });
    }
}

// El GDS puede probar con GET; respondemos para que el "Test" del equipo dé OK.
export async function GET() {
    return NextResponse.json({ status: "ok", driver: "grandstream" });
}
