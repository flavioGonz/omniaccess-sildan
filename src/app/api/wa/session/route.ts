import { NextResponse } from "next/server";
import { getWhatsAppConfig } from "@/lib/whatsapp";

export const dynamic = "force-dynamic";

// Eventos que WAHA le avisa a OmniAccess. "message" alimenta el chatbot y las invitaciones;
// "session.status" deja ver en el panel cuándo se vinculó o se cayó la sesión.
const EVENTOS_WEBHOOK = ["message", "session.status"];

export async function POST(req: Request) {
    const action = new URL(req.url).searchParams.get("action") || "restart";
    try {
        const cfg = await getWhatsAppConfig();
        const s = encodeURIComponent(cfg.session);
        const headers = { "X-Api-Key": cfg.apiKey, "Content-Type": "application/json" };
        const hit = (path: string, body?: any) =>
            fetch(`${cfg.url}${path}`, { method: "POST", headers, body: body ? JSON.stringify(body) : undefined });

        // La sesión puede no existir: WAHA la pierde si se recrea el contenedor, y "restart"
        // sobre una sesión inexistente da 404 y el panel se queda sin QR para siempre.
        // Entonces primero se mira; si no está, se crea con el webhook y arrancada.
        const existe = await fetch(`${cfg.url}/api/sessions/${s}`, { headers: { "X-Api-Key": cfg.apiKey }, cache: "no-store" })
            .then(r => r.ok).catch(() => false);

        if (!existe) {
            const config = cfg.webhookUrl ? { webhooks: [{ url: cfg.webhookUrl, events: EVENTOS_WEBHOOK }] } : {};
            const r = await hit(`/api/sessions`, { name: cfg.session, start: true, config });
            return NextResponse.json({ ok: r.ok, created: true, webhook: cfg.webhookUrl || null });
        }

        if (action === "logout") {
            await hit(`/api/sessions/${s}/logout`).catch(() => { });
            await new Promise(r => setTimeout(r, 800));
        }
        await hit(`/api/sessions/${s}/restart`).catch(() => { });
        return NextResponse.json({ ok: true, created: false });
    } catch { return NextResponse.json({ ok: false }); }
}
