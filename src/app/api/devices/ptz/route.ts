import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticatedRequest } from "@/lib/digest-auth";
import { resolveForCamera } from "@/lib/nvr-resolve";

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

export async function POST(req: NextRequest) {
    const id = req.nextUrl.searchParams.get("deviceId");
    if (!id) return NextResponse.json({ ok: false, error: "deviceId requerido" }, { status: 400 });
    const body = await req.json().catch(() => ({}));
    const action: string = body.action || "stop";
    const dir: string = body.dir || "";
    const speed: number = Math.max(1, Math.min(8, parseInt(body.speed || "5")));
    const preset: number = parseInt(body.preset || "0") || 0;

    // Preferir control por NVR (credenciales válidas + canal mapeado); fallback a la cámara directa.
    let ip = "", user = "admin", pass = "", brand = "", ch = 1;
    try {
        const cam = await resolveForCamera(id);
        if (cam && cam.nvr) { ip = cam.nvr.ip; user = cam.nvr.user; pass = cam.nvr.pass; brand = String((cam.nvr as any).brand || ""); ch = cam.ch || 1; }
    } catch { }
    if (!ip) {
        const d = await prisma.device.findUnique({ where: { id }, select: { ip: true, username: true, password: true, brand: true } });
        if (!d) return NextResponse.json({ ok: false, error: "device no existe" }, { status: 404 });
        ip = d.ip; user = d.username || "admin"; pass = d.password || ""; brand = String(d.brand || ""); ch = 1;
    }
    brand = brand.toUpperCase();
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
