export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticatedRequest } from "@/lib/digest-auth";
import crypto from "crypto";

// GET /api/nvr/recording-days?ch=12&year=2026&month=8 -> { days: [1,2,15,...] }
// El NVR (DS-7732NXI Sildan) reporta los tiempos en HORA LOCAL etiquetada Z:
// buscamos con el mes "local-Z" y extraemos los días directamente de los strings.
export async function GET(req: NextRequest) {
    const sp = req.nextUrl.searchParams;
    const ch = sp.get("ch");
    const year = parseInt(sp.get("year") || "0");
    const month = parseInt(sp.get("month") || "0"); // 1-12
    if (!ch || !/^\d+$/.test(ch) || !year || !month) return NextResponse.json({ days: [] });

    const rows = await prisma.setting.findMany({ where: { key: { in: ["NVR_HOST", "NVR_USER", "NVR_PASS"] } } });
    const cfg: any = {}; rows.forEach((r: any) => (cfg[r.key] = r.value));
    if (!cfg.NVR_HOST) return NextResponse.json({ days: [] });

    const p2 = (n: number) => String(n).padStart(2, "0");
    const lastDay = new Date(year, month, 0).getDate();
    const days = new Set<number>();
    const dev: any = { ip: cfg.NVR_HOST, username: cfg.NVR_USER || "admin", password: cfg.NVR_PASS || "", authType: "DIGEST" };

    // Paginamos el search del mes (segmentos de ~1h => hasta ~744/mes; maxResults 100 por página)
    let pos = 0;
    for (let page = 0; page < 10; page++) {
        const guid = crypto.randomUUID();
        const body = `<CMSearchDescription><searchID>${guid}</searchID><trackIDList><trackID>${ch}01</trackID></trackIDList><timeSpanList><timeSpan><startTime>${year}-${p2(month)}-01T00:00:00Z</startTime><endTime>${year}-${p2(month)}-${p2(lastDay)}T23:59:59Z</endTime></timeSpan></timeSpanList><maxResults>100</maxResults><searchResultPostion>${pos}</searchResultPostion></CMSearchDescription>`;
        let xml: string;
        try {
            xml = await authenticatedRequest("POST", "/ISAPI/ContentMgmt/search", dev, { data: body, contentType: "application/xml", accept: "application/xml", responseType: "text", timeout: 15000 });
        } catch { break; }
        const spans = [...String(xml).matchAll(/<startTime>(\d{4})-(\d{2})-(\d{2})T[^<]*<\/startTime>\s*<endTime>(\d{4})-(\d{2})-(\d{2})T/g)];
        for (const m of spans) {
            const [ , sy, sm, sd, ey, em, ed ] = m;
            if (parseInt(sy) === year && parseInt(sm) === month) {
                const d1 = parseInt(sd);
                const d2 = (parseInt(ey) === year && parseInt(em) === month) ? parseInt(ed) : d1;
                for (let d = d1; d <= Math.min(d2, lastDay); d++) days.add(d);
            }
        }
        const num = parseInt((String(xml).match(/<numOfMatches>(\d+)</) || [])[1] || "0");
        pos += num;
        if (num < 100) break;
    }
    return NextResponse.json({ days: Array.from(days).sort((a, b) => a - b) }, { headers: { "Cache-Control": "private, max-age=120" } });
}
