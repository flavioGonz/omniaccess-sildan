export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { fotoConMarca, type PersonaFoto } from "@/lib/filas/presentacion";
import { cuadroBosch } from "@/lib/filas/foto";
import { cuadroActual, ES_PERSONA } from "@/lib/filas/metadatos";
import { demoraFila } from "@/lib/filas/demora";

/**
 * GET /api/filas/foto-marcada?device=<id>[&ruta=/api/files/queue/…][&personas=N][&titulo=…] → JPEG
 * La foto que sale por Telegram y WhatsApp: las personas marcadas y la franja con la cuenta
 * (lib/filas/presentacion). Con `ruta`, la foto guardada de esa lectura y las personas que se
 * guardaron con ella; sin `ruta`, el cuadro de ahora. Sólo interno (la pide el worker de despachos).
 */
export async function GET(req: NextRequest) {
    const q = req.nextUrl.searchParams;
    const device = q.get("device") || "";
    const dev = await prisma.device.findFirst({ where: { id: device, deviceType: "QUEUE_COUNTER" }, select: { id: true, name: true, ip: true, username: true, password: true } });
    if (!dev) return NextResponse.json({ error: "No existe ese contador" }, { status: 404 });
    const ruta = q.get("ruta");
    let foto: Buffer | null = null;
    let personas: PersonaFoto[] = [];
    let momento = new Date();
    if (ruta && ruta.startsWith("/api/files/")) {
        const r = await fetch(`http://127.0.0.1:${process.env.PORT || 10001}${ruta}`).catch(() => null);
        if (r?.ok) foto = Buffer.from(await r.arrayBuffer());
        const ev = await prisma.queueEvent.findFirst({ where: { snapshotPath: ruta }, select: { metadata: true, timestamp: true } });
        if (ev) {
            momento = ev.timestamp;
            try { personas = (JSON.parse(ev.metadata || "{}").personas || []).map((x: any) => ({ caja: x.c, poligono: x.g || null, p: x.p })); } catch { /* sin personas */ }
        }
    }
    if (!foto) {
        foto = await cuadroBosch(dev);
        personas = (cuadroActual(dev.id)?.objetos || []).filter((o) => ES_PERSONA.test(o.clase)).map((o) => ({ caja: o.caja, poligono: o.poligono, p: o.p }));
    }
    if (!foto) return NextResponse.json({ error: "Sin foto" }, { status: 502 });
    const d = await demoraFila(dev.id);
    const n = q.get("personas");
    const jpg = await fotoConMarca(foto, personas, {
        fila: dev.name, titulo: q.get("titulo") || "Control de filas", momento,
        personas: n != null && n !== "" ? Number(n) : d.aforo, limite: d.limite, esperaMin: d.esperaMin,
    });
    return new Response(new Uint8Array(jpg), { headers: { "Content-Type": "image/jpeg", "Cache-Control": "no-store" } });
}
