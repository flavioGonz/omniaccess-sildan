/**
 * «Grabar» del vivo (13/11, Nico: «comenzar un fragmento de video de lo que está viendo, y OmniAccess
 * depositarlo a MinIO y poder descargarlo o enviarlo por Telegram o WhatsApp como el resto de clips»).
 *
 *   POST   { tramos: [{ deviceId?, nvrId?, ch?, desde, hasta, nombre? }], rotulo? }  → { ok, clip }
 *          Deja el pedido en la cola y contesta al instante (lib/clips-grabados).
 *   POST   { accion: "reintentar" | "preparar", id }   reintentar uno que falló; dejar el archivo a mano para enviarlo
 *   GET    → { clips: [...] }   la bandeja de quien pregunta (y retoma lo que quedó a medias)
 *   DELETE ?id=   sacarlo de la bandeja
 *
 * NO graba el vivo del navegador. El botón marca un inicio y un fin, y el clip se corta de la
 * GRABACIÓN del NVR (o del anillo local): es la imagen original, no una copia recomprimida de lo
 * que llegó a la pantalla. Tope: ENVIO_MAX_SEG. Si mientras grababa se cambió de cámara, cada
 * cámara es un tramo y el clip los une en orden, con su pase.
 *
 * Desde el 15/11 el clip NO lo arma este pedido: lo arma el servidor como tarea, aunque se cierre
 * la pestaña (Nico, 14/11). Antes este pedido quedaba abierto hasta dos minutos y había que
 * mandarle latidos para que el proxy no lo cortara.
 *
 * Vive bajo /api/clip/, que el middleware deja pasar sin sesión para que WhatsApp baje los
 * archivos: por eso la sesión y el permiso se verifican acá, en los tres verbos.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/app/actions/auth";
import { permisosDeSesion } from "@/lib/permisos";
import { PERMISOS_VIDEO, TRAMOS_MAX, type TramoGrabado } from "@/lib/clip-instante";
import { bandejaDe, encolarClip, prepararParaEnviar, quitarDeBandeja, reintentar, retomarColgados } from "@/lib/clips-grabados";

/** Menos que esto no es una grabación: es un doble clic. */
const MINIMO_SEG = 2;
const SIN_CACHE = { "Cache-Control": "no-store" };

/** Quién pregunta, o la respuesta de por qué no puede. */
async function quien(): Promise<{ id: string; nombre: string | null } | NextResponse> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- la sesión es el JWT crudo
    const s: any = await getSession().catch(() => null);
    if (!s) return NextResponse.json({ ok: false, motivo: "Hace falta iniciar sesión." }, { status: 401 });
    if (!PERMISOS_VIDEO.some((p) => permisosDeSesion(s).includes(p))) return NextResponse.json({ ok: false, motivo: "Tu rol no puede sacar clips de las grabaciones." }, { status: 403 });
    const id = String(s.sub || s.id || s.email || "");
    if (!id) return NextResponse.json({ ok: false, motivo: "La sesión no dice quién sos." }, { status: 401 });
    return { id, nombre: s.name || s.email || null };
}

export async function GET() {
    const q = await quien(); if (q instanceof NextResponse) return q;
    await retomarColgados();
    return NextResponse.json({ ok: true, clips: await bandejaDe(q.id), yo: q.id }, { headers: SIN_CACHE });
}

export async function DELETE(req: NextRequest) {
    const q = await quien(); if (q instanceof NextResponse) return q;
    const id = req.nextUrl.searchParams.get("id") || "";
    return NextResponse.json({ ok: await quitarDeBandeja(q.id, id) });
}

export async function POST(req: NextRequest) {
    const q = await quien(); if (q instanceof NextResponse) return q;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- cuerpo sin forma hasta validarlo
    const b: any = await req.json().catch(() => ({}));
    if (b?.accion === "reintentar") { const clip = await reintentar(q.id, String(b.id || "")); return NextResponse.json(clip ? { ok: true, clip } : { ok: false, motivo: "Ese clip no se puede reintentar." }); }
    if (b?.accion === "preparar") return NextResponse.json(await prepararParaEnviar(q.id, String(b.id || "")));

    // Una grabación es una lista de tramos (uno por cámara por la que se pasó); un pedido suelto es un tramo.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const crudos: any[] = Array.isArray(b?.tramos) ? b.tramos.slice(0, TRAMOS_MAX) : [b];
    const tramos: TramoGrabado[] = [];
    for (const t of crudos) {
        const desde = Number(t?.desde), hasta = Number(t?.hasta);
        const deviceId = typeof t?.deviceId === "string" ? t.deviceId.slice(0, 64) : "";
        const nvrId = typeof t?.nvrId === "string" && t.nvrId.length <= 64 ? t.nvrId : null;
        const ch = Number.isInteger(t?.ch) && t.ch > 0 && t.ch < 1000 ? t.ch : null;
        if (!Number.isFinite(desde) || !Number.isFinite(hasta) || hasta <= desde) continue;
        if (!deviceId && !(nvrId && ch)) continue;
        if (hasta > Date.now() + 5000) return NextResponse.json({ ok: false, motivo: "Ese tramo todavía no pasó." }, { status: 400 });
        tramos.push({ deviceId, nvrId, ch, desde, hasta, nombre: typeof t?.nombre === "string" ? t.nombre.slice(0, 80) : null });
    }
    if (!tramos.length) return NextResponse.json({ ok: false, motivo: "Falta la cámara, o desde cuándo y hasta cuándo." }, { status: 400 });
    tramos.sort((x, y) => x.desde - y.desde);
    if (tramos.reduce((x, t) => x + (t.hasta - t.desde) / 1000, 0) < MINIMO_SEG) return NextResponse.json({ ok: false, motivo: "La grabación es demasiado corta." }, { status: 400 });
    const clip = await encolarClip(q, tramos, typeof b?.rotulo === "string" ? b.rotulo.slice(0, 80) : null);
    return NextResponse.json({ ok: true, clip });
}
