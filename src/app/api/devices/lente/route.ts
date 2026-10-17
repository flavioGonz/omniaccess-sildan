import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticatedRequest } from "@/lib/digest-auth";
import { verifyApiAuth, unauthorizedResponse, forbiddenResponse } from "@/lib/api-auth";
import { getSession } from "@/app/actions/auth";
import { permisosDeSesion } from "@/lib/permisos";

export const dynamic = "force-dynamic";

/**
 * Zoom y foco del lente motorizado de una cámara (17/10, Nico: «en las cámaras LPR y otras, como
 * la iDS-2CD7A46G0/P-IZHS, controles para zoom y enfocar en Dispositivos»).
 *
 * Se habla con la CÁMARA directa, no con el NVR: el lente es de la cámara, y el proxy PTZ del
 * grabador no siempre pasa el foco. Hikvision:
 *   · zoom continuo  → PUT /ISAPI/PTZCtrl/channels/1/continuous  <PTZData><zoom>±v</zoom>
 *   · foco continuo  → PUT /ISAPI/System/Video/inputs/channels/1/focus  <FocusData><focus>±v</focus>
 *   · autofoco       → PUT /ISAPI/PTZCtrl/channels/1/onepushfoucs/start  (sic: así lo escribe el equipo)
 * Se mueve mientras se mantiene apretado y se para con valor 0.
 *
 * MOVER EL LENTE ES TOCAR EL EQUIPO: una cámara LPR desenfocada deja de leer. Por eso:
 *   · pide el permiso «dispositivos» (no alcanza con tener sesión);
 *   · el servidor tiene que habilitarlo con OMNI_MUEVE_LENTES=si en su .env. El lab de IES ve las
 *     cámaras reales de San Nicolás por la VPN y nunca debe moverlas: sin la llave, contesta que
 *     no y la pantalla muestra los controles apagados con el motivo. Mismo criterio que
 *     OMNI_ABRE_BARRERAS (lib/barrera-omnivision).
 * Preguntar qué sabe hacer (GET) es sólo lectura y funciona en cualquier servidor.
 */
const LLAVE_SERVIDOR = "OMNI_MUEVE_LENTES";
const habilitado = () => (process.env[LLAVE_SERVIDOR] || "").trim().toLowerCase() === "si";

/** Lo que sabe el lente no cambia: se pregunta una vez cada media hora. */
const CAPACIDAD_MS = 30 * 60_000;
const capacidades = new Map<string, { zoom: boolean; foco: boolean; t: number }>();
/** Velocidad del movimiento continuo (Hikvision: 1..100). Lenta: el ajuste fino es lo que se busca. */
const VELOCIDAD = { zoom: 40, foco: 30 };

async function equipo(id: string) {
    const d = await prisma.device.findUnique({ where: { id }, select: { ip: true, username: true, password: true, brand: true, deviceType: true } });
    if (!d?.ip || String(d.deviceType) === "NVR") return null;
    return { dev: { ip: d.ip, username: d.username || "admin", password: d.password || "", authType: "DIGEST" } as any, marca: String(d.brand || "").toUpperCase() };
}

async function puede(): Promise<NextResponse | null> {
    const auth = await verifyApiAuth();
    if (!auth.authenticated) return unauthorizedResponse();
    if (auth.pantalla) return forbiddenResponse("Un enlace de pantalla no toca cámaras.");
    const s: any = await getSession().catch(() => null);
    if (!s || !permisosDeSesion(s).includes("dispositivos")) return forbiddenResponse("Mover el lente pide el permiso de Dispositivos.");
    return null;
}

/** GET ?deviceId= → { zoom, foco, habilitado, motivo? } */
export async function GET(req: NextRequest) {
    const auth = await verifyApiAuth();
    if (!auth.authenticated) return unauthorizedResponse();
    const id = req.nextUrl.searchParams.get("deviceId") || "";
    if (!/^[\w-]{1,100}$/.test(id)) return NextResponse.json({ zoom: false, foco: false }, { status: 400 });
    const base = { habilitado: habilitado(), motivo: habilitado() ? undefined : "Este servidor no mueve lentes (falta OMNI_MUEVE_LENTES=si): se ve, pero no se toca." };
    const ya = capacidades.get(id);
    if (ya && Date.now() - ya.t < CAPACIDAD_MS) return NextResponse.json({ zoom: ya.zoom, foco: ya.foco, ...base });
    const e = await equipo(id);
    if (!e || e.marca !== "HIKVISION") return NextResponse.json({ zoom: false, foco: false, ...base });
    let zoom = false, foco = false;
    try {
        const t = String(await authenticatedRequest("GET", "/ISAPI/PTZCtrl/channels/1/capabilities", e.dev, { responseType: "text", accept: "application/xml", timeout: 6000 }));
        zoom = /ContinuousZoomSpace|<zoom/i.test(t);
    } catch { zoom = false; }
    try {
        const t = String(await authenticatedRequest("GET", "/ISAPI/Image/channels/1/focusConfiguration/capabilities", e.dev, { responseType: "text", accept: "application/xml", timeout: 6000 }));
        foco = /focusStyle|FocusConfiguration/i.test(t);
    } catch { foco = false; }
    // Un lente con zoom motorizado siempre enfoca: si la cámara no contestó la pregunta del foco, se ofrece igual.
    foco = foco || zoom;
    capacidades.set(id, { zoom, foco, t: Date.now() });
    return NextResponse.json({ zoom, foco, ...base });
}

/** POST ?deviceId=  { que: "zoom" | "foco" | "autofoco", sentido: 1 | -1 | 0 }  (0 = parar) */
export async function POST(req: NextRequest) {
    const no = await puede(); if (no) return no;
    if (!habilitado()) return NextResponse.json({ ok: false, error: "Este servidor no mueve lentes (falta OMNI_MUEVE_LENTES=si)." }, { status: 403 });
    const id = req.nextUrl.searchParams.get("deviceId") || "";
    const e = await equipo(id);
    if (!e) return NextResponse.json({ ok: false, error: "No existe esa cámara" }, { status: 404 });
    if (e.marca !== "HIKVISION") return NextResponse.json({ ok: false, error: "Sólo cámaras Hikvision por ahora" }, { status: 400 });
    const b = await req.json().catch(() => ({}));
    const que = String(b?.que || "");
    const s = Number(b?.sentido) > 0 ? 1 : Number(b?.sentido) < 0 ? -1 : 0;
    try {
        if (que === "zoom") {
            await authenticatedRequest("PUT", "/ISAPI/PTZCtrl/channels/1/continuous", e.dev, {
                data: `<?xml version="1.0" encoding="UTF-8"?><PTZData><pan>0</pan><tilt>0</tilt><zoom>${s * VELOCIDAD.zoom}</zoom></PTZData>`,
                contentType: "application/xml", responseType: "text", timeout: 5000,
            });
        } else if (que === "foco") {
            await authenticatedRequest("PUT", "/ISAPI/System/Video/inputs/channels/1/focus", e.dev, {
                data: `<?xml version="1.0" encoding="UTF-8"?><FocusData><focus>${s * VELOCIDAD.foco}</focus></FocusData>`,
                contentType: "application/xml", responseType: "text", timeout: 5000,
            });
        } else if (que === "autofoco") {
            await authenticatedRequest("PUT", "/ISAPI/PTZCtrl/channels/1/onepushfoucs/start", e.dev, { contentType: "application/xml", responseType: "text", timeout: 8000 });
        } else {
            return NextResponse.json({ ok: false, error: "Acción desconocida" }, { status: 400 });
        }
        return NextResponse.json({ ok: true });
    } catch (x: any) {
        const st = x?.response?.status;
        return NextResponse.json({ ok: false, error: st ? `La cámara respondió ${st}` : x?.message || "La cámara no respondió" }, { status: 502 });
    }
}
