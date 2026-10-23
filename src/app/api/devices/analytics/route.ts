/**
 * /api/devices/analytics?deviceId=...
 *
 *  GET  → { support, lineas: { max, reglas[] }, zonas: { max, reglas[] }, limites, edita, line, field }
 *         `lineas` / `zonas`: TODAS las reglas de la cámara (Hikvision trae hasta 4 de cada una),
 *         con su id, si está prendida, su geometría y sus ajustes (lib/analitica-xml.ts).
 *         `line` / `field`: la primera regla prendida, para las pantallas que dibujan una sola.
 *
 *  POST → { lineas?: CambioRegla[], zonas?: CambioRegla[] }
 *         Cada cambio nombra su id y dice qué cambia (geometría, prendida, sentido, sensibilidad,
 *         objetivo, tiempo) o `borrar`. Se escribe todo un tipo en un solo PUT, se vuelve a leer la
 *         cámara y se devuelven las `diferencias` entre lo pedido y lo guardado: vacío = quedó así.
 *       → { kind:"line"|"field", enabled, points, direction }  (forma vieja: la primera regla)
 *
 * Coordenadas 0–1000 origen abajo-izquierda (la pantalla invierte Y).
 *
 * 23/10, Nico: «no puedo eliminar analíticas creadas… intentá tener varias líneas y zonas por
 * dispositivo… que se guarde perfecto». La forma vieja veía una sola línea y una sola zona,
 * prendía la raíz y no el elemento, y no sabía borrar.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSmartSupport, leerTodas, escribirTodas, writeLine, writeField } from "@/lib/isapi-analytics";
import { resolveForCamera } from "@/lib/nvr-resolve";
import { readDahuaIvs, writeDahuaField, writeDahuaLine } from "@/lib/dahua-ivs";
import { ZONA_MAX, ZONA_MIN, type CambioRegla, type ReglaCam } from "@/lib/analitica-xml";

export const dynamic = "force-dynamic";
const SIN_CACHE = { "Cache-Control": "no-store" };

async function load(id: string) {
    const d = await prisma.device.findUnique({ where: { id }, select: { id: true, ip: true, username: true, password: true, authType: true } });
    return d ? { ...d, authType: d.authType || "DIGEST" } : null;
}

const primera = (reglas: ReglaCam[] | undefined) => {
    const r = reglas?.find((x) => x.enabled) || reglas?.find((x) => !x.vacia);
    return { enabled: !!r?.enabled, points: r?.points || [], direction: r?.direction };
};

/** Un canal de un NVR Dahua: el IVS por configManager. Una línea y una zona, sin borrar. */
async function dahua(camD: NonNullable<Awaited<ReturnType<typeof resolveForCamera>>>) {
    const r = await readDahuaIvs({ ip: camD.nvr.ip, user: camD.nvr.user, pass: camD.nvr.pass }, camD.ch);
    const regla = (tipo: "linea" | "zona", p: { x: number; y: number }[]): ReglaCam => ({
        id: 1, tipo, enabled: p.length >= (tipo === "linea" ? 2 : 3), vacia: p.length < (tipo === "linea" ? 2 : 3), points: p,
        sensibilidad: null, objetivo: null, ...(tipo === "linea" ? { direction: r.lineDir } : {}),
    });
    const lineas = r.support.line ? { max: 1, reglas: [regla("linea", r.line)] } : null;
    const zonas = r.support.field ? { max: 1, reglas: [regla("zona", r.field)] } : null;
    return { lineas, zonas, support: r.support };
}

export async function GET(req: NextRequest) {
    const id = req.nextUrl.searchParams.get("deviceId");
    const ch = parseInt(req.nextUrl.searchParams.get("ch") || "1") || 1;
    if (!id) return NextResponse.json({ ok: false, error: "deviceId requerido" }, { status: 400 });
    const d = await load(id);
    if (!d) return NextResponse.json({ ok: false, error: "device no existe" }, { status: 404 });
    const limites = { zonaMin: ZONA_MIN, zonaMax: ZONA_MAX };
    const camD = await resolveForCamera(id);
    if (camD && String((camD.nvr as any).brand).toUpperCase() === "DAHUA") {
        try {
            const r = await dahua(camD);
            return NextResponse.json({
                ok: true, marca: "dahua", support: r.support, lineas: r.lineas, zonas: r.zonas, limites,
                edita: { varias: false, borrar: false, ajustes: false, motivo: "Canal de un NVR Dahua: una línea y una zona, y se quitan desde el NVR." },
                line: { ...primera(r.lineas?.reglas), supported: r.support.line }, field: { ...primera(r.zonas?.reglas), supported: r.support.field },
            }, { headers: SIN_CACHE });
        } catch (e: any) { return NextResponse.json({ ok: false, error: e?.message || "Dahua IVS error" }, { status: 502 }); }
    }
    try {
        const support = await getSmartSupport(d as any);
        const lineas = support.line ? await leerTodas(d as any, "linea", ch).catch(() => null) : null;
        const zonas = support.field ? await leerTodas(d as any, "zona", ch).catch(() => null) : null;
        const sinXml = (l: typeof lineas) => (l ? { max: l.max, raiz: l.raiz, reglas: l.reglas } : null);
        return NextResponse.json({
            ok: true, marca: "hikvision", support: { line: !!lineas, field: !!zonas }, lineas: sinXml(lineas), zonas: sinXml(zonas), limites,
            edita: { varias: true, borrar: true, ajustes: true },
            line: { ...primera(lineas?.reglas), supported: !!lineas }, field: { ...primera(zonas?.reglas), supported: !!zonas },
        }, { headers: SIN_CACHE });
    } catch (e: any) {
        return NextResponse.json({ ok: false, error: e?.message || "ISAPI error" }, { status: 502 });
    }
}

export async function POST(req: NextRequest) {
    const id = req.nextUrl.searchParams.get("deviceId");
    const ch = parseInt(req.nextUrl.searchParams.get("ch") || "1") || 1;
    if (!id) return NextResponse.json({ ok: false, error: "deviceId requerido" }, { status: 400 });
    const d = await load(id);
    if (!d) return NextResponse.json({ ok: false, error: "device no existe" }, { status: 404 });
    const body = await req.json().catch(() => ({}));
    const camP = await resolveForCamera(id);
    const esDahua = !!camP && String((camP.nvr as any).brand).toUpperCase() === "DAHUA";

    // ── Forma nueva: listas de cambios por tipo ──
    if (Array.isArray(body.lineas) || Array.isArray(body.zonas)) {
        const lineas: CambioRegla[] = Array.isArray(body.lineas) ? body.lineas : [];
        const zonas: CambioRegla[] = Array.isArray(body.zonas) ? body.zonas : [];
        if (esDahua) {
            try {
                const conn = { ip: camP!.nvr.ip, user: camP!.nvr.user, pass: camP!.nvr.pass };
                if ([...lineas, ...zonas].some((c) => c.borrar || c.id !== 1)) return NextResponse.json({ ok: false, error: "En canales de un NVR Dahua hay una línea y una zona, y se quitan desde el NVR." }, { status: 400 });
                for (const c of lineas) if (c.points) await writeDahuaLine(conn, camP!.ch, c.points, c.direction);
                for (const c of zonas) if (c.points) await writeDahuaField(conn, camP!.ch, c.points);
                return NextResponse.json({ ok: true, diferencias: [] });
            } catch (e: any) { return NextResponse.json({ ok: false, error: e?.message || "Dahua IVS write error" }, { status: 502 }); }
        }
        try {
            // De a un tipo: si la línea falla, la zona no se toca (y se dice cuál falló).
            const rl = await escribirTodas(d as any, "linea", lineas, ch).catch((e) => { throw new Error(`Líneas: ${e?.message || e}`); });
            const rz = await escribirTodas(d as any, "zona", zonas, ch).catch((e) => { throw new Error(`Zonas: ${e?.message || e}`); });
            return NextResponse.json({ ok: true, diferencias: [...rl.diferencias, ...rz.diferencias] });
        } catch (e: any) {
            return NextResponse.json({ ok: false, error: e?.message || "ISAPI PUT error" }, { status: 502 });
        }
    }

    // ── Forma vieja: una línea / una zona ──
    const { kind, enabled, points, direction } = body as { kind: "line" | "field"; enabled: boolean; points: { x: number; y: number }[]; direction?: string };
    if (kind !== "line" && kind !== "field") return NextResponse.json({ ok: false, error: "kind inválido" }, { status: 400 });
    const apagar = enabled === false;
    if (!apagar && (!Array.isArray(points) || points.length < 2)) return NextResponse.json({ ok: false, error: "puntos insuficientes" }, { status: 400 });
    if (esDahua) {
        try {
            const conn = { ip: camP!.nvr.ip, user: camP!.nvr.user, pass: camP!.nvr.pass };
            if (apagar) return NextResponse.json({ ok: false, error: "En canales de un NVR Dahua la regla se quita desde el NVR." }, { status: 400 });
            if (kind === "line") await writeDahuaLine(conn, camP!.ch, points as any, direction);
            else await writeDahuaField(conn, camP!.ch, points as any);
            return NextResponse.json({ ok: true });
        } catch (e: any) { return NextResponse.json({ ok: false, error: e?.message || "Dahua IVS write error" }, { status: 502 }); }
    }
    try {
        if (kind === "line") await writeLine(d as any, ch, { enabled: !apagar, points: apagar ? [] : points, direction });
        else await writeField(d as any, ch, { enabled: !apagar, points: apagar ? [] : points });
        return NextResponse.json({ ok: true });
    } catch (e: any) {
        return NextResponse.json({ ok: false, error: e?.message || "ISAPI PUT error" }, { status: 502 });
    }
}
