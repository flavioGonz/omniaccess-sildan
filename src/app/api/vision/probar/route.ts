import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyApiAuth, unauthorizedResponse, forbiddenResponse } from "@/lib/api-auth";
import { detectar, type TareaVision } from "@/lib/vision";

export const dynamic = "force-dynamic";

const GO2RTC = process.env.GO2RTC_API || "http://127.0.0.1:1984";
/** Una cámara caída deja el pedido colgado: 8 s es lo que ya usa /api/snapshot. */
const TIEMPO_CUADRO_MS = 8000;
/** Menos que esto no es una foto: go2rtc devuelve unos bytes de error cuando el stream no arranca. */
const CUADRO_MIN_BYTES = 1000;

async function cuadro(stream: string): Promise<Buffer | null> {
    try {
        const r = await fetch(`${GO2RTC}/api/frame.jpeg?src=${encodeURIComponent(stream)}`, { cache: "no-store", signal: AbortSignal.timeout(TIEMPO_CUADRO_MS) });
        if (!r.ok) return null;
        const b = Buffer.from(await r.arrayBuffer());
        return b.length > CUADRO_MIN_BYTES ? b : null;
    } catch { return null; }
}

/**
 * GET /api/vision/probar?camara=<deviceId>&umbral=0.4[&tarea=segmentar|pose][&atributos=1][&sesion=<id>]
 *
 * Saca un cuadro de la cámara (go2rtc, el mismo stream del visor) y se lo da a omni-vision.
 * Devuelve la foto analizada junto con los objetos: si la pantalla pidiera la foto aparte,
 * las cajas se dibujarían sobre otro cuadro y no coincidirían.
 *
 * Primero el substream (liviano, y el modelo trabaja a 512 px igual); si no arranca, el
 * principal. Devuelve TODOS los objetos: qué clases se muestran lo decide la pantalla con los
 * interruptores, para poder decir "3 ocultas por estar apagadas" en vez de esconderlas.
 */
export async function GET(req: NextRequest) {
    const auth = await verifyApiAuth();
    if (!auth.authenticated) return unauthorizedResponse();
    if (auth.pantalla) return forbiddenResponse("El laboratorio de visión no es una vista de pantalla.");
    const id = req.nextUrl.searchParams.get("camara") || "";
    const u = Number(req.nextUrl.searchParams.get("umbral"));
    const umbral = Number.isFinite(u) && u > 0 ? Math.min(0.95, Math.max(0.05, u)) : undefined;
    const t = req.nextUrl.searchParams.get("tarea");
    const tarea: TareaVision = t === "segmentar" || t === "pose" ? t : "detectar";
    const atributos = req.nextUrl.searchParams.get("atributos") === "1";
    // La sesión de seguimiento la elige la pantalla (una por pasada); se acota para que no sea un canal libre.
    const sesion = (req.nextUrl.searchParams.get("sesion") || "").replace(/[^a-z0-9-]/gi, "").slice(0, 40) || undefined;
    const dev = await prisma.device.findUnique({ where: { id }, select: { id: true, name: true } });
    if (!dev) return NextResponse.json({ error: "No existe esa cámara" }, { status: 404 });
    const t0 = Date.now();
    let fuente = "sub";
    let foto = await cuadro(`lpr_${dev.id}`);
    if (!foto) { fuente = "principal"; foto = await cuadro(`lpr_${dev.id}_hd`); }
    if (!foto) return NextResponse.json({ error: `No se pudo sacar un cuadro de ${dev.name} (go2rtc no lo entregó).` }, { status: 502 });
    const msCuadro = Date.now() - t0;
    try {
        const r = await detectar(foto, { umbral, tarea, atributos, sesion, fps: 2 });
        return NextResponse.json({
            camara: dev, fuente, ms_cuadro: msCuadro, ...r,
            imagen: `data:image/jpeg;base64,${foto.toString("base64")}`,
            instante: new Date().toISOString(),
        }, { headers: { "Cache-Control": "no-store" } });
    } catch (e: any) {
        return NextResponse.json({ error: e?.name === "TimeoutError" ? "omni-vision no contestó a tiempo" : e?.message || "omni-vision falló" }, { status: 502 });
    }
}
