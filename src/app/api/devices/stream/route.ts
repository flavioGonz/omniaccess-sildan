/**
 * /api/devices/stream?deviceId=...
 *   GET  → prueba de salud del stream go2rtc: baja un frame y reporta ok/ms/bytes + consumers/producers
 *   POST { action: "restart" } → reinicia el stream (DELETE + re-sync en go2rtc)
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
const GO2RTC = process.env.GO2RTC_API || "http://127.0.0.1:1984";

export async function GET(req: NextRequest) {
    const id = req.nextUrl.searchParams.get("deviceId");
    if (!id) return NextResponse.json({ ok: false, error: "deviceId requerido" }, { status: 400 });
    const name = `lpr_${id}`;
    // info de configuración (sin cargar la cámara)
    let consumers = 0, producers = 0, configured = false;
    try {
        const r = await fetch(`${GO2RTC}/api/streams`, { cache: "no-store", signal: AbortSignal.timeout(4000) });
        const j: any = await r.json();
        for (const [k, v] of Object.entries<any>(j)) {
            if (k === name || k === `${name}_hd`) {
                configured = true;
                producers += Array.isArray(v?.producers) ? v.producers.length : 0;
                consumers += Array.isArray(v?.consumers) ? v.consumers.length : 0;
            }
        }
    } catch { }
    // prueba real: bajar un frame (esto sí toca la cámara vía go2rtc)
    let ok = false, ms: number | null = null, bytes = 0;
    const t0 = Date.now();
    try {
        const fr = await fetch(`${GO2RTC}/api/frame.jpeg?src=${encodeURIComponent(name)}`, { cache: "no-store", signal: AbortSignal.timeout(8000) });
        if (fr.ok) {
            const buf = await fr.arrayBuffer();
            bytes = buf.byteLength;
            ok = bytes > 1000; // un JPEG válido pesa > 1KB
            ms = Date.now() - t0;
        }
    } catch { }
    return NextResponse.json({ ok: true, stream: { name, configured, producers, consumers, frameOk: ok, ms, bytes } });
}

export async function POST(req: NextRequest) {
    const id = req.nextUrl.searchParams.get("deviceId");
    if (!id) return NextResponse.json({ ok: false, error: "deviceId requerido" }, { status: 400 });
    const body = await req.json().catch(() => ({}));
    if (body.action !== "restart") return NextResponse.json({ ok: false, error: "action inválida" }, { status: 400 });

    const dev = await prisma.device.findUnique({ where: { id }, select: { id: true, ip: true, username: true, password: true, authType: true, brand: true, deviceType: true, direction: true, name: true } });
    if (!dev) return NextResponse.json({ ok: false, error: "device no existe" }, { status: 404 });

    const names = [`lpr_${id}`, `lpr_${id}_hd`];
    // 1) DELETE productores actuales para forzar reconexión
    for (const n of names) {
        try { await fetch(`${GO2RTC}/api/streams?src=${encodeURIComponent(n)}`, { method: "DELETE", signal: AbortSignal.timeout(4000) }); } catch { }
    }
    // 2) re-sincronizar el stream (reescribe yaml + PUT en caliente)
    try {
        const { syncLprStream } = await import("@/lib/go2rtc-sync");
        await syncLprStream(dev as any);
    } catch (e: any) {
        return NextResponse.json({ ok: false, error: e?.message || "no se pudo re-sincronizar" }, { status: 500 });
    }
    // 3) verificar frame post-reinicio
    let frameOk = false; let ms: number | null = null;
    const t0 = Date.now();
    try {
        const fr = await fetch(`${GO2RTC}/api/frame.jpeg?src=lpr_${id}`, { cache: "no-store", signal: AbortSignal.timeout(9000) });
        if (fr.ok) { const b = await fr.arrayBuffer(); frameOk = b.byteLength > 1000; ms = Date.now() - t0; }
    } catch { }
    return NextResponse.json({ ok: true, restarted: true, frameOk, ms });
}
