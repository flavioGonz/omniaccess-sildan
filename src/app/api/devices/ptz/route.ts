import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticatedRequest } from "@/lib/digest-auth";
import { resolveForCamera } from "@/lib/nvr-resolve";
import { verifyApiAuth, unauthorizedResponse, forbiddenResponse } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

const DAHUA_MOVE: Record<string, string> = {
    up: "Up", down: "Down", left: "Left", right: "Right",
    upleft: "LeftUp", upright: "RightUp", downleft: "LeftDown", downright: "RightDown",
    zoomin: "ZoomTele", zoomout: "ZoomWide",
};
const HIK_VEC: Record<string, [number, number, number]> = {
    up: [0, 1, 0], down: [0, -1, 0], left: [-1, 0, 0], right: [1, 0, 0],
    upleft: [-1, 1, 0], upright: [1, 1, 0], downleft: [-1, -1, 0], downright: [1, -1, 0],
    zoomin: [0, 0, 1], zoomout: [0, 0, -1],
};

/** Un canal de NVR que no es equipo (el id que usa la pared de cámaras). */
const CANAL_NVR = /^nvrch-([\w-]+)-(\d{1,4})$/;

/**
 * Con qué se habla para mover esa cámara: el NVR (credenciales válidas y canal mapeado) o la
 * cámara directa. Desde el 16/10 también un canal de NVR sin equipo (`nvrch-<nvr>-<ch>`), para el
 * joystick de la pared de cámaras.
 */
async function conexion(id: string): Promise<{ ip: string; user: string; pass: string; brand: string; ch: number } | null> {
    const canal = CANAL_NVR.exec(id);
    if (canal) {
        const n = await prisma.device.findUnique({ where: { id: canal[1] }, select: { ip: true, username: true, password: true, brand: true, deviceType: true } });
        if (!n?.ip || String(n.deviceType) !== "NVR") return null;
        return { ip: n.ip, user: n.username || "admin", pass: n.password || "", brand: String(n.brand || "").toUpperCase(), ch: Number(canal[2]) };
    }
    try {
        const cam = await resolveForCamera(id);
        if (cam && cam.nvr) return { ip: cam.nvr.ip, user: cam.nvr.user, pass: cam.nvr.pass, brand: String((cam.nvr as any).brand || "").toUpperCase(), ch: cam.ch || 1 };
    } catch { }
    const d = await prisma.device.findUnique({ where: { id }, select: { ip: true, username: true, password: true, brand: true } });
    if (!d) return null;
    return { ip: d.ip, user: d.username || "admin", pass: d.password || "", brand: String(d.brand || "").toUpperCase(), ch: 1 };
}

/** Si la cámara es PTZ, preguntado al equipo y guardado un rato (no cambia). */
const CAPACIDAD_MS = 30 * 60_000;
const capacidades = new Map<string, { ptz: boolean; t: number }>();

/**
 * GET /api/devices/ptz?deviceId=<id> → { ptz } — si la cámara se mueve. La pantalla muestra el
 * joystick sólo si es así; antes se adivinaba por el nombre («PTZ» en el nombre de la cámara).
 */
export async function GET(req: NextRequest) {
    const auth = await verifyApiAuth();
    if (!auth.authenticated) return unauthorizedResponse();
    const id = req.nextUrl.searchParams.get("deviceId") || "";
    if (!/^[\w-]{1,100}$/.test(id)) return NextResponse.json({ ptz: false, error: "deviceId requerido" }, { status: 400 });
    const ya = capacidades.get(id);
    if (ya && Date.now() - ya.t < CAPACIDAD_MS) return NextResponse.json({ ptz: ya.ptz });
    const c = await conexion(id);
    if (!c) return NextResponse.json({ ptz: false });
    const dev = { ip: c.ip, username: c.user, password: c.pass, authType: "DIGEST" } as any;
    let ptz = false;
    try {
        if (c.brand === "DAHUA") {
            const t = String(await authenticatedRequest("GET", `/cgi-bin/ptz.cgi?action=getCurrentProtocolCaps&channel=${c.ch}`, dev, { responseType: "text", timeout: 6000 }));
            ptz = /Pan\s*=\s*true|SupportPan/i.test(t);
        } else {
            const t = String(await authenticatedRequest("GET", `/ISAPI/PTZCtrl/channels/${c.ch}/capabilities`, dev, { responseType: "text", accept: "application/xml", timeout: 6000 } as any));
            ptz = /ContinuousPanTiltSpace/i.test(t);
        }
    } catch { ptz = false; }
    capacidades.set(id, { ptz, t: Date.now() });
    return NextResponse.json({ ptz });
}

export async function POST(req: NextRequest) {
    // Mover una cámara es actuar sobre el equipo: con sesión del panel, nunca desde un enlace de pared.
    const auth = await verifyApiAuth();
    if (!auth.authenticated) return unauthorizedResponse();
    if (auth.pantalla) return forbiddenResponse("Un enlace de pantalla no mueve cámaras.");
    const id = req.nextUrl.searchParams.get("deviceId");
    if (!id) return NextResponse.json({ ok: false, error: "deviceId requerido" }, { status: 400 });
    const body = await req.json().catch(() => ({}));
    const action: string = body.action || "stop";
    const dir: string = body.dir || "";
    const speed: number = Math.max(1, Math.min(8, parseInt(body.speed || "5")));
    const preset: number = parseInt(body.preset || "0") || 0;

    const c = await conexion(id);
    if (!c) return NextResponse.json({ ok: false, error: "device no existe" }, { status: 404 });
    const { ip, user, pass, ch } = c;
    const brand = c.brand;
    const dev = { ip, username: user, password: pass, authType: "DIGEST" } as any;

    try {
        if (brand === "DAHUA" || brand === "") {
            if (action === "preset") {
                await authenticatedRequest("GET", `/cgi-bin/ptz.cgi?action=start&channel=${ch}&code=GotoPreset&arg1=0&arg2=${preset}&arg3=0`, dev, { responseType: "text", timeout: 6000 });
                return NextResponse.json({ ok: true });
            }
            if (action === "setpreset") {
                await authenticatedRequest("GET", `/cgi-bin/ptz.cgi?action=start&channel=${ch}&code=SetPreset&arg1=0&arg2=${preset}&arg3=0`, dev, { responseType: "text", timeout: 6000 });
                return NextResponse.json({ ok: true });
            }
            if (action === "tourstart" || action === "tourstop") {
                const code = action === "tourstart" ? "StartTour" : "StopTour";
                await authenticatedRequest("GET", `/cgi-bin/ptz.cgi?action=start&channel=${ch}&code=${code}&arg1=${preset || 1}&arg2=0&arg3=0`, dev, { responseType: "text", timeout: 6000 });
                return NextResponse.json({ ok: true });
            }
            const code = DAHUA_MOVE[dir] || "Up";
            const act = action === "move" ? "start" : "stop";
            const arg2 = action === "move" ? speed : 0;
            await authenticatedRequest("GET", `/cgi-bin/ptz.cgi?action=${act}&channel=${ch}&code=${code}&arg1=0&arg2=${arg2}&arg3=0`, dev, { responseType: "text", timeout: 6000 });
            return NextResponse.json({ ok: true });
        }
        // HIKVISION
        if (action === "preset") {
            await authenticatedRequest("PUT", `/ISAPI/PTZCtrl/channels/${ch}/presets/${preset}/goto`, dev, { responseType: "text", timeout: 6000 });
            return NextResponse.json({ ok: true });
        }
        if (action === "setpreset") {
            const xml = `<?xml version="1.0" encoding="UTF-8"?><PTZPreset><id>${preset}</id><presetName>Preset ${preset}</presetName></PTZPreset>`;
            await authenticatedRequest("PUT", `/ISAPI/PTZCtrl/channels/${ch}/presets/${preset}`, dev, { body: xml, responseType: "text", accept: "application/xml", timeout: 6000 } as any);
            return NextResponse.json({ ok: true });
        }
        if (action === "tourstart" || action === "tourstop") {
            const cmd = action === "tourstart" ? "start" : "stop";
            await authenticatedRequest("PUT", `/ISAPI/PTZCtrl/channels/${ch}/patrols/${preset || 1}/${cmd}`, dev, { responseType: "text", timeout: 6000 });
            return NextResponse.json({ ok: true });
        }
        const v = HIK_VEC[dir] || [0, 0, 0];
        const sp = action === "move" ? speed * 12 : 0;
        const xml = `<?xml version="1.0" encoding="UTF-8"?><PTZData><pan>${v[0] * sp}</pan><tilt>${v[1] * sp}</tilt><zoom>${v[2] * sp}</zoom></PTZData>`;
        await authenticatedRequest("PUT", `/ISAPI/PTZCtrl/channels/${ch}/continuous`, dev, { body: xml, responseType: "text", accept: "application/xml", timeout: 6000 } as any);
        return NextResponse.json({ ok: true });
    } catch (e: any) {
        return NextResponse.json({ ok: false, error: e?.message || "PTZ error" }, { status: 502 });
    }
}
