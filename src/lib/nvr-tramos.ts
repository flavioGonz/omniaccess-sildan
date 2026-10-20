import crypto from "crypto";
import { authenticatedRequest } from "@/lib/digest-auth";
import { ZONA } from "@/lib/fechas";

/**
 * Dónde HAY grabación en un canal de NVR Hikvision (ISAPI ContentMgmt/search), por día.
 * Salió de la regla del monitor (api/monitor/camaras/linea) para que la use también el visor
 * del evento: saber ANTES de pedir el video si a esa hora se grabó, y si no, cuál es lo más
 * cercano. Sólo lectura.
 */

/** Hasta cuántos tramos se piden por día (páginas de 100). Un canal que graba por movimiento puede tener cientos. */
const PAGINAS_MAX = 6;

/**
 * Los NVR guardan y contestan su hora local marcada con Z (ver lib/clip-nvr). Esto pasa
 * «YYYY-MM-DDTHH:MM:SS» de la hora del barrio a milisegundos reales.
 */
export function msDeLocal(texto: string): number | null {
    const m = /(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/.exec(texto); if (!m) return null;
    const comoUtc = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
    const partes = new Intl.DateTimeFormat("en-CA", { timeZone: ZONA, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).formatToParts(new Date(comoUtc));
    const g = (t: string) => Number(partes.find((x) => x.type === t)?.value || 0);
    const vistoEnZona = Date.UTC(g("year"), g("month") - 1, g("day"), g("hour") % 24, g("minute"), g("second"));
    return comoUtc - (vistoEnZona - comoUtc);
}

export async function tramosHik(conn: { ip: string; user: string; pass: string }, ch: number, dia: string): Promise<[number, number][] | null> {
    const dev = { ip: conn.ip, username: conn.user, password: conn.pass, authType: "DIGEST" } as any;
    const tramos: [number, number][] = [];
    let pos = 0;
    for (let pagina = 0; pagina < PAGINAS_MAX; pagina++) {
        const body = `<CMSearchDescription><searchID>${crypto.randomUUID()}</searchID><trackIDList><trackID>${ch}01</trackID></trackIDList><timeSpanList><timeSpan><startTime>${dia}T00:00:00Z</startTime><endTime>${dia}T23:59:59Z</endTime></timeSpan></timeSpanList><maxResults>100</maxResults><searchResultPostion>${pos}</searchResultPostion></CMSearchDescription>`;
        let xml: string;
        try { xml = String(await authenticatedRequest("POST", "/ISAPI/ContentMgmt/search", dev, { data: body, contentType: "application/xml", accept: "application/xml", responseType: "text", timeout: 12000 })); }
        catch { return pagina === 0 ? null : tramos; }
        for (const m of xml.matchAll(/<startTime>([^<]+)<\/startTime>\s*<endTime>([^<]+)<\/endTime>/g)) {
            const a = msDeLocal(m[1]), b = msDeLocal(m[2]);
            if (a != null && b != null && b > a) tramos.push([a, b]);
        }
        const n = Number((xml.match(/<numOfMatches>(\d+)</) || [])[1] || 0);
        pos += n;
        if (n < 100) break;
    }
    // Ordenados y pegados: el NVR corta los archivos por hora y la regla los quiere continuos.
    tramos.sort((x, y) => x[0] - y[0]);
    const unidos: [number, number][] = [];
    for (const t of tramos) {
        const u = unidos[unidos.length - 1];
        if (u && t[0] <= u[1] + 2000) u[1] = Math.max(u[1], t[1]); else unidos.push([...t] as [number, number]);
    }
    return unidos;
}


/** «YYYY-MM-DD» del día del barrio en que cae un instante. */
export function diaLocal(ms: number): string {
    return new Intl.DateTimeFormat("en-CA", { timeZone: ZONA, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
}
