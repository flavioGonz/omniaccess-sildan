/**
 * /api/devices/osd?deviceId=…  — el texto que la cámara escribe sobre su video (26/11).
 *
 * Nico: «agregá un campo a la derecha del nombre: OSD, que lea el OSD de la cámara, con un mini
 * botón de guardar para modificarlo». El nombre en OmniAccess y el OSD de la cámara son dos cosas:
 * el primero lo ve el panel, el segundo queda quemado en cada grabación y cada foto que se exporta.
 *
 *  GET → { ok, texto, visible, max, editable }
 *        Hikvision: <name> de /ISAPI/System/Video/inputs/channels/1, y si se dibuja
 *        (channelNameOverlay de /overlays). Dahua: ChannelTitle[0].Name.
 *  PUT { texto } → lo escribe y lo relee; contesta con lo que quedó.
 */
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/app/actions/auth";
import { prisma } from "@/lib/prisma";
import { authenticatedRequest } from "@/lib/digest-auth";
import { nombreDeCanal, conNombreDeCanal, nombreVisible, OSD_MAX } from "@/lib/intrusion-xml";

export const dynamic = "force-dynamic";
const SIN_CACHE = { "Cache-Control": "no-store" };
const CANAL = "/ISAPI/System/Video/inputs/channels/1";

async function cargar(id: string) {
    const d = await prisma.device.findUnique({ where: { id }, select: { id: true, name: true, ip: true, username: true, password: true, authType: true, httpPort: true, brand: true, deviceType: true } });
    return d ? { ...d, authType: d.authType || "DIGEST" } : null;
}

async function leer(d: any): Promise<{ texto: string | null; visible: boolean | null }> {
    if (String(d.brand).toUpperCase() === "DAHUA") {
        const t = String(await authenticatedRequest("GET", "/cgi-bin/configManager.cgi?action=getConfig&name=ChannelTitle", d, { responseType: "text", timeout: 7000 }));
        const m = /ChannelTitle\[0\]\.Name=([^\r\n]*)/.exec(t);
        return { texto: m ? m[1] : null, visible: null };
    }
    const xml = String(await authenticatedRequest("GET", CANAL, d, { responseType: "text", accept: "application/xml", timeout: 7000 }));
    const ov = await authenticatedRequest("GET", `${CANAL}/overlays`, d, { responseType: "text", accept: "application/xml", timeout: 7000 }).then(String).catch(() => "");
    return { texto: nombreDeCanal(xml), visible: nombreVisible(ov) };
}

const motivo = (e: any) => e?.name === "EquipoSoloLectura" ? e.message : e?.response?.status === 401 ? "La cámara rechazó el usuario o la clave." : e?.response?.status ? `La cámara contestó ${e.response.status}.` : e?.code ? `La cámara no contestó (${e.code}).` : e?.message || "No se pudo.";

export async function GET(req: NextRequest) {
    if (!(await getSession())) return NextResponse.json({ ok: false, error: "Hace falta una sesión del panel." }, { status: 401 });
    const d = await cargar(req.nextUrl.searchParams.get("deviceId") || "");
    if (!d) return NextResponse.json({ ok: false, error: "El equipo no existe." }, { status: 404 });
    if (String(d.deviceType) === "NVR") return NextResponse.json({ ok: false, error: "Un NVR no tiene un OSD propio." }, { headers: SIN_CACHE });
    try { return NextResponse.json({ ok: true, ...(await leer(d)), max: OSD_MAX }, { headers: SIN_CACHE }); }
    catch (e: any) { return NextResponse.json({ ok: false, error: motivo(e) }, { headers: SIN_CACHE }); }
}

export async function PUT(req: NextRequest) {
    const s: any = await getSession();
    if (!s) return NextResponse.json({ ok: false, error: "Hace falta una sesión del panel." }, { status: 401 });
    const { permisosDeSesion } = await import("@/lib/permisos");
    if (!permisosDeSesion(s).includes("dispositivos.editar")) return NextResponse.json({ ok: false, error: "Hace falta el permiso Editar dispositivos." }, { status: 403 });
    const d = await cargar(req.nextUrl.searchParams.get("deviceId") || "");
    if (!d) return NextResponse.json({ ok: false, error: "El equipo no existe." }, { status: 404 });
    const b = await req.json().catch(() => ({}));
    const texto = String(b?.texto ?? "").trim();
    if (!texto) return NextResponse.json({ ok: false, error: "El OSD no puede quedar vacío." }, { status: 400 });
    if (texto.length > OSD_MAX) return NextResponse.json({ ok: false, error: `La cámara acepta hasta ${OSD_MAX} caracteres (tiene ${texto.length}).` }, { status: 400 });
    try {
        const antes = await leer(d).catch(() => ({ texto: null }));
        if (String(d.brand).toUpperCase() === "DAHUA") {
            await authenticatedRequest("GET", `/cgi-bin/configManager.cgi?action=setConfig&ChannelTitle[0].Name=${encodeURIComponent(texto)}`, d, { responseType: "text", timeout: 8000 });
        } else {
            const xml = String(await authenticatedRequest("GET", CANAL, d, { responseType: "text", accept: "application/xml", timeout: 7000 }));
            await authenticatedRequest("PUT", CANAL, d, { data: conNombreDeCanal(xml, texto), contentType: "application/xml", responseType: "text", timeout: 9000 });
        }
        const ahora = await leer(d);
        const ok = ahora.texto === texto;
        await prisma.accionSistema.create({ data: { quien: String(s.name || s.sub || "panel"), accion: "equipos.osd", objetivo: d.name, ok, detalle: `«${antes.texto ?? "?"}» → «${ahora.texto ?? "?"}»`.slice(0, 500) } }).catch(() => { });
        return NextResponse.json(ok ? { ok: true, ...ahora, max: OSD_MAX } : { ok: false, error: `La cámara aceptó, pero quedó «${ahora.texto ?? "?"}».`, ...ahora, max: OSD_MAX }, { headers: SIN_CACHE });
    } catch (e: any) { return NextResponse.json({ ok: false, error: motivo(e) }, { headers: SIN_CACHE }); }
}
