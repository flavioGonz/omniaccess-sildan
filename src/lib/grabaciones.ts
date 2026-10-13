import { prisma } from "@/lib/prisma";
import { authenticatedRequest } from "@/lib/digest-auth";
import { getChannelMap, resolveNvrById, defaultNvrId, type NvrConn } from "@/lib/nvr-resolve";
import { ZONA } from "@/lib/fechas";
import crypto from "crypto";

/**
 * Donde graba cada camara y cuanto guarda.
 *
 * - DETECTAR: se le pregunta a cada NVR dado de alta que camaras tiene en sus canales (por IP:
 *   InputProxy en Hikvision, RemoteDevice en Dahua). Si la IP de una camara aparece en un canal,
 *   ese es su NVR y su canal: no hace falta mapearlo a mano.
 * - RETENCION: se busca en ese canal la grabacion MAS VIEJA que queda en el disco. Desde ese dia
 *   hasta hoy es lo que el NVR esta guardando (cuando el disco se llena pisa lo mas viejo).
 *
 * Todo es solo lectura sobre los NVR. Lo unico que se escribe es el mapa NVR_CHANNEL_MAP (lo
 * que antes se hacia a mano) y el ultimo calculo de retencion (NVR_RETENCION), para mostrarlo.
 */

export type Ubicacion = { nvrId: string | null; nvrNombre: string | null; ch: number; canalNombre?: string | null };
export type Retencion = { dias: number; desde: string; grabando: boolean | null; calculado: string; error?: string };

const CLAVE_RETENCION = "NVR_RETENCION";
const p2 = (n: number) => String(n).padStart(2, "0");

/** "YYYY-MM-DD HH:mm:ss" de la hora del barrio (los NVR guardan su hora local). */
function ahoraLocal(offsetMs = 0): { y: number; m: number; d: number; hh: number; mm: number; ss: number } {
    const f = new Intl.DateTimeFormat("en-CA", { timeZone: ZONA, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })
        .formatToParts(new Date(Date.now() + offsetMs));
    const g = (t: string) => Number(f.find((x) => x.type === t)?.value || 0);
    return { y: g("year"), m: g("month"), d: g("day"), hh: g("hour") % 24, mm: g("minute"), ss: g("second") };
}
const fmtHik = (t: ReturnType<typeof ahoraLocal>) => `${t.y}-${p2(t.m)}-${p2(t.d)}T${p2(t.hh)}:${p2(t.mm)}:${p2(t.ss)}Z`;
const fmtDahua = (t: ReturnType<typeof ahoraLocal>) => `${t.y}-${p2(t.m)}-${p2(t.d)}%20${p2(t.hh)}:${p2(t.mm)}:${p2(t.ss)}`;
/** Dias entre la fecha local "YYYY-MM-DD..." y hoy (local). */
function diasDesde(fechaLocal: string): number {
    const m = fechaLocal.match(/(\d{4})-(\d{2})-(\d{2})/); if (!m) return 0;
    const h = ahoraLocal();
    return Math.max(0, Math.round((Date.UTC(h.y, h.m - 1, h.d) - Date.UTC(+m[1], +m[2] - 1, +m[3])) / 86_400_000));
}

const dev = (c: NvrConn) => ({ ip: c.ip, username: c.user, password: c.pass, authType: "DIGEST" } as any);

async function retencionHik(c: NvrConn, ch: number): Promise<{ desde: string | null; grabando: boolean | null }> {
    const buscar = async (desde: string, hasta: string, max: number) => {
        const body = `<CMSearchDescription><searchID>${crypto.randomUUID()}</searchID><trackIDList><trackID>${ch}01</trackID></trackIDList><timeSpanList><timeSpan><startTime>${desde}</startTime><endTime>${hasta}</endTime></timeSpan></timeSpanList><maxResults>${max}</maxResults><searchResultPostion>0</searchResultPostion></CMSearchDescription>`;
        return String(await authenticatedRequest("POST", "/ISAPI/ContentMgmt/search", dev(c), { data: body, contentType: "application/xml", accept: "application/xml", responseType: "text", timeout: 20000 }));
    };
    const hasta = fmtHik(ahoraLocal(86_400_000));
    // El NVR devuelve los tramos en orden cronologico: el primero es el mas viejo que queda.
    const xml = await buscar(fmtHik(ahoraLocal(-3 * 365 * 86_400_000)), hasta, 1);
    const desde = (xml.match(/<startTime>([^<]+)<\/startTime>/) || [])[1] || null;
    let grabando: boolean | null = null;
    try {
        const ult = await buscar(fmtHik(ahoraLocal(-30 * 60_000)), hasta, 1);
        grabando = Number((ult.match(/<numOfMatches>(\d+)/) || [])[1] || 0) > 0;
    } catch { }
    return { desde, grabando };
}

async function retencionDahua(c: NvrConn, ch: number): Promise<{ desde: string | null; grabando: boolean | null }> {
    const cgi = (q: string) => authenticatedRequest("GET", `/cgi-bin/mediaFileFind.cgi?${q}`, dev(c), { responseType: "text", timeout: 20000 }).then(String);
    const primero = async (desde: string, hasta: string): Promise<string | null> => {
        const obj = ((await cgi("action=factory.create")).match(/result=(\d+)/) || [])[1];
        if (!obj) throw new Error("El NVR Dahua no abrio la busqueda");
        try {
            const ok = await cgi(`action=findFile&object=${obj}&condition.Channel=${ch}&condition.StartTime=${desde}&condition.EndTime=${hasta}`);
            if (!/OK/.test(ok)) return null;
            const r = await cgi(`action=findNextFile&object=${obj}&count=1`);
            return (r.match(/items\[0\]\.StartTime=([^\r\n]+)/) || [])[1]?.trim() || null;
        } finally {
            await cgi(`action=close&object=${obj}`).catch(() => null);
            await cgi(`action=destroy&object=${obj}`).catch(() => null);
        }
    };
    const hasta = fmtDahua(ahoraLocal(86_400_000));
    const desde = await primero(fmtDahua(ahoraLocal(-3 * 365 * 86_400_000)), hasta);
    let grabando: boolean | null = null;
    try { grabando = !!(await primero(fmtDahua(ahoraLocal(-30 * 60_000)), hasta)); } catch { }
    return { desde, grabando };
}

/** El NVR y el canal donde graba una camara, segun el mapa (con nombre del NVR). */
export async function ubicacionDe(ipCamara: string): Promise<Ubicacion | null> {
    const mapa = await getChannelMap();
    const e = mapa[ipCamara];
    if (!e) return null;
    const nvrId = e.nvrId || (await defaultNvrId());
    const nvr = nvrId ? await prisma.device.findUnique({ where: { id: nvrId }, select: { name: true } }) : null;
    return { nvrId, nvrNombre: nvr?.name || null, ch: e.ch };
}

export async function leerRetenciones(): Promise<Record<string, Retencion>> {
    try { return JSON.parse((await prisma.setting.findUnique({ where: { key: CLAVE_RETENCION } }))?.value || "{}"); } catch { return {}; }
}

/** Calcula la retencion de la camara (por IP) en su NVR y la guarda. */
export async function calcularRetencion(ipCamara: string): Promise<Retencion> {
    const u = await ubicacionDe(ipCamara);
    if (!u) throw new Error("La cámara no tiene NVR asignado: detectá primero dónde graba.");
    const c = await resolveNvrById(u.nvrId);
    if (!c) throw new Error("No se encontró el NVR de la cámara.");
    const r = String(c.brand).toUpperCase() === "DAHUA" ? await retencionDahua(c, u.ch) : await retencionHik(c, u.ch);
    const out: Retencion = r.desde
        ? { dias: diasDesde(r.desde), desde: r.desde.replace("T", " ").replace(/Z$/, ""), grabando: r.grabando, calculado: new Date().toISOString() }
        : { dias: 0, desde: "", grabando: r.grabando, calculado: new Date().toISOString(), error: "El NVR no tiene grabaciones de ese canal" };
    const todas = await leerRetenciones();
    todas[ipCamara] = out;
    await prisma.setting.upsert({ where: { key: CLAVE_RETENCION }, update: { value: JSON.stringify(todas) }, create: { key: CLAVE_RETENCION, value: JSON.stringify(todas) } });
    return out;
}

/**
 * Recorre los NVR y busca en sus canales las IP de las camaras pedidas. Devuelve donde graba cada
 * una (o nada). No escribe: quien llama decide si guarda el resultado en el mapa.
 */
export async function buscarEnNvrs(ips: string[], leerCanales: (nvr: { ip: string; username?: string; password?: string; authType?: string }) => Promise<any>): Promise<{
    halladas: Record<string, Ubicacion>; nvrs: { id: string; nombre: string; ok: boolean; error?: string; canales: number }[];
}> {
    const buscadas = new Set(ips.filter(Boolean));
    const nvrs = await prisma.device.findMany({ where: { deviceType: "NVR" }, select: { id: true, name: true, ip: true, username: true, password: true, authType: true } });
    const halladas: Record<string, Ubicacion> = {};
    const reporte: { id: string; nombre: string; ok: boolean; error?: string; canales: number }[] = [];
    await Promise.all(nvrs.map(async (n) => {
        try {
            const r = await leerCanales({ ip: n.ip, username: n.username || undefined, password: n.password || undefined, authType: (n.authType as any) || undefined });
            const canales: { channel: number; ip: string | null; name: string | null }[] = r?.channels || [];
            reporte.push({ id: n.id, nombre: n.name, ok: !!r?.ok, error: r?.ok ? undefined : r?.error, canales: canales.length });
            for (const c of canales) if (c.ip && buscadas.has(c.ip)) halladas[c.ip] = { nvrId: n.id, nvrNombre: n.name, ch: c.channel, canalNombre: c.name };
        } catch (e: any) { reporte.push({ id: n.id, nombre: n.name, ok: false, error: e?.message || "sin respuesta", canales: 0 }); }
    }));
    return { halladas, nvrs: reporte };
}
