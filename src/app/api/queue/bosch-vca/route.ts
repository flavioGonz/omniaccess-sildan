import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/app/actions/auth";
import { leerVca, leerBlob, partir, armar, aplicar, analizar, escribirBlob, vcaCorriendo, type BoschConn, type CambiosVca } from "@/lib/bosch-vca";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Editor de analíticas Bosch (zona de la fila, rebote, ventana anti doble conteo, umbral de aforo).
 *   GET  ?deviceId=   lee la configuración que tiene la cámara en este momento
 *   POST { deviceId, cambios }            escribe (solo ADMIN). Guarda backup antes.
 *   POST { deviceId, restaurar: "<at>" }  vuelve a un backup guardado (solo ADMIN).
 * Toda escritura se verifica contra la relectura de la cámara; si no coincide se restaura sola.
 */

const MAX_BACKUPS = 15;
const claveBackups = (id: string) => `BOSCH_VCA_BACKUPS_${id}`;
type Backup = { at: string; by: string; motivo: string; hex: string };

async function leerBackups(id: string): Promise<Backup[]> {
    const s = await prisma.setting.findUnique({ where: { key: claveBackups(id) } });
    try { return s?.value ? (JSON.parse(s.value) as Backup[]) : []; } catch { return []; }
}
async function guardarBackup(id: string, b: Backup) {
    const lista = [b, ...(await leerBackups(id))].slice(0, MAX_BACKUPS);
    await prisma.setting.upsert({ where: { key: claveBackups(id) }, update: { value: JSON.stringify(lista) }, create: { key: claveBackups(id), value: JSON.stringify(lista) } });
}

async function conexion(deviceId: string | null): Promise<{ conn: BoschConn; device: { id: string; name: string; ip: string } } | { error: string; status: number }> {
    if (!deviceId) return { error: "Falta el dispositivo.", status: 400 };
    const d = await prisma.device.findUnique({ where: { id: deviceId } });
    if (!d) return { error: "El dispositivo no existe.", status: 404 };
    if (d.brand !== "BOSCH") return { error: "El editor de analíticas es para cámaras Bosch.", status: 400 };
    return { conn: { ip: d.ip, user: d.username || "admin", pass: d.password || "" }, device: { id: d.id, name: d.name, ip: d.ip } };
}

/** Script (y = -1 arriba) → porcentaje de pantalla para dibujar sobre el video. */
const aPct = (p: { x: number; y: number }) => ({ x: ((p.x + 1) / 2) * 100, y: ((p.y + 1) / 2) * 100 });

function respuesta(device: { id: string; name: string; ip: string }, v: { script: string; fields: any[]; tasks: any[] }, corriendo: boolean | null, backups: Backup[]) {
    return {
        ok: true,
        device,
        corriendo,
        fields: v.fields.map((f) => ({ ...f, pct: f.points.map(aPct) })),
        tasks: v.tasks,
        script: v.script,
        backups: backups.map(({ hex, ...b }) => ({ ...b, bytes: hex.length / 2 })),
        leidoEn: new Date().toISOString(),
    };
}

export async function GET(req: NextRequest) {
    const r = await conexion(req.nextUrl.searchParams.get("deviceId"));
    if ("error" in r) return NextResponse.json({ ok: false, error: r.error }, { status: r.status });
    try {
        const v = await leerVca(r.conn);
        const [corriendo, backups] = await Promise.all([vcaCorriendo(r.conn), leerBackups(r.device.id)]);
        return NextResponse.json(respuesta(r.device, v, corriendo, backups));
    } catch (e: any) {
        return NextResponse.json({ ok: false, error: `No se pudo leer la cámara: ${e?.message || e}` }, { status: 502 });
    }
}

export async function POST(req: NextRequest) {
    const s: any = await getSession();
    if (!s) return NextResponse.json({ ok: false, error: "Hace falta una sesión del panel." }, { status: 401 });
    if (s.role !== "ADMIN") return NextResponse.json({ ok: false, error: "Solo un administrador puede cambiar las analíticas de la cámara." }, { status: 403 });
    const body = await req.json().catch(() => ({}));
    const r = await conexion(body?.deviceId || null);
    if ("error" in r) return NextResponse.json({ ok: false, error: r.error }, { status: r.status });
    const quien = String(s.name || s.username || s.userId || "admin");
    try {
        const actual = await leerBlob(r.conn);
        let nuevo: Buffer;
        let motivo: string;
        if (body?.restaurar) {
            const b = (await leerBackups(r.device.id)).find((x) => x.at === body.restaurar);
            if (!b) return NextResponse.json({ ok: false, error: "Ese backup no existe." }, { status: 404 });
            nuevo = Buffer.from(b.hex, "hex");
            partir(nuevo); // valida formato antes de mandarlo
            motivo = `Antes de restaurar el backup del ${b.at}`;
        } else {
            const cambios = (body?.cambios || {}) as CambiosVca;
            const { script } = partir(actual);
            const scriptNuevo = aplicar(script, cambios);
            if (scriptNuevo === script) {
                const v = { script, ...analizar(script) };
                return NextResponse.json({ ...respuesta(r.device, v, await vcaCorriendo(r.conn), await leerBackups(r.device.id)), sinCambios: true });
            }
            nuevo = armar(actual, scriptNuevo);
            motivo = "Antes de editar desde OmniAccess";
        }
        if (nuevo.equals(actual)) {
            const v = await leerVca(r.conn);
            return NextResponse.json({ ...respuesta(r.device, v, await vcaCorriendo(r.conn), await leerBackups(r.device.id)), sinCambios: true });
        }
        await guardarBackup(r.device.id, { at: new Date().toISOString(), by: quien, motivo, hex: actual.toString("hex") });
        await escribirBlob(r.conn, nuevo, actual);
        const v = await leerVca(r.conn);
        const [corriendo, backups] = await Promise.all([vcaCorriendo(r.conn), leerBackups(r.device.id)]);
        return NextResponse.json({ ...respuesta(r.device, v, corriendo, backups), escrito: true });
    } catch (e: any) {
        return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 502 });
    }
}
