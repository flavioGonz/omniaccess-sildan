import fs from "fs";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { puedeMirar } from "@/lib/zona-entrenable-servidor";
import { medirAhora } from "@/lib/salud-ahora";

export const dynamic = "force-dynamic";

/**
 * GET /api/vision/entrenar/salud?horas=24 — la salud del equipo: temperaturas, consumo y uso de
 * la GPU y temperatura de la CPU, de la telemetría que escribe el entrenador (scripts/salud-equipo.js),
 * más los entrenamientos de ese rango con lo peor que midió cada uno.
 *
 * Los límites y la carpeta los dice el propio entrenador en ENTRENADOR_ESTADO: un solo lugar donde
 * viven, para que la pantalla no muestre una raya en 78 °C mientras el entrenador frena en 80.
 */

const RANGOS_HORAS = [1, 6, 24, 72, 168];
/** Puntos por serie que se mandan: una línea de 1.000 px no muestra más, y 7 días a 5 s son 120.000. */
const PUNTOS_MAX = 900;
/** Sin muestra en este rato, se dibuja un hueco (el entrenador no estaba corriendo, o el equipo se colgó). */
const HUECO_MS = 3 * 60_000;

type Punto = { ts: number; gt: number | null; ct: number | null; w: number | null; wMax: number | null; uso: number | null; mem: number | null; memTotal: number | null; estado: string; motivos: string[] };

export async function GET(req: NextRequest) {
    const e = await puedeMirar(); if (e) return e;
    // ?vivo=1: una medida de este momento (para la vista en vivo), no la telemetría guardada.
    if (req.nextUrl.searchParams.get("vivo") === "1") {
        let est: any = null;
        try { est = JSON.parse((await prisma.setting.findUnique({ where: { key: "ENTRENADOR_ESTADO" } }))?.value || "null"); } catch { }
        const m = await medirAhora();
        return NextResponse.json({ ...m, estado: est?.salud?.estado || "reposo", limites: est?.limites || null }, { headers: { "Cache-Control": "no-store" } });
    }
    const pedidas = Number(req.nextUrl.searchParams.get("horas"));
    const horas = RANGOS_HORAS.includes(pedidas) ? pedidas : 24;
    const hasta = Date.now(), desde = hasta - horas * 3_600_000;

    let estado: any = null;
    try { estado = JSON.parse((await prisma.setting.findUnique({ where: { key: "ENTRENADOR_ESTADO" } }))?.value || "null"); } catch { estado = null; }
    const dir = estado?.telemetria || process.env.ENTRENADOR_TELEMETRIA
        || path.join(path.dirname(path.resolve(process.env.ENTRENADOR_TRABAJO || path.join(process.cwd(), "entrenamientos"))), "telemetria");

    // Las muestras del rango, día por día.
    const crudas: Punto[] = [];
    for (let d = new Date(desde); d.getTime() <= hasta + 86_400_000; d = new Date(d.getTime() + 86_400_000)) {
        const f = path.join(dir, `${d.toISOString().slice(0, 10)}.jsonl`);
        let texto = "";
        try { texto = fs.readFileSync(f, "utf8"); } catch { continue; }
        for (const linea of texto.split("\n")) {
            if (!linea) continue;
            try {
                const m = JSON.parse(linea); const ts = Date.parse(m.ts);
                if (!(ts >= desde && ts <= hasta)) continue;
                crudas.push({
                    ts, gt: m.gpu?.t ?? null, ct: m.cpu?.t ?? null, w: m.gpu?.w ?? null, wMax: m.gpu?.wMax ?? null, uso: m.gpu?.uso ?? null,
                    mem: m.gpu?.mem ?? null, memTotal: m.gpu?.memTotal ?? null, estado: m.estado || "reposo", motivos: m.gpu?.motivos || [],
                });
            } catch { }
        }
    }
    crudas.sort((a, b) => a.ts - b.ts);

    // Achicar sin esconder picos: de cada tramo, lo PEOR (máximo de temperatura y consumo).
    const paso = Math.max(1, Math.ceil(crudas.length / PUNTOS_MAX));
    const GRAVEDAD: Record<string, number> = { reposo: 0, entrenando: 1, enfriando: 2 };
    const max = (xs: (number | null)[]) => { const v = xs.filter((x): x is number => x != null); return v.length ? Math.max(...v) : null; };
    const prom = (xs: (number | null)[]) => { const v = xs.filter((x): x is number => x != null); return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null; };
    const puntos: (Punto | null)[] = [];
    for (let i = 0; i < crudas.length; i += paso) {
        const g = crudas.slice(i, i + paso);
        if (puntos.length && puntos[puntos.length - 1] && g[0].ts - puntos[puntos.length - 1]!.ts > HUECO_MS * paso) puntos.push(null);
        puntos.push({
            ts: g[0].ts, gt: max(g.map((x) => x.gt)), ct: max(g.map((x) => x.ct)), w: max(g.map((x) => x.w)), wMax: g[0].wMax,
            uso: prom(g.map((x) => x.uso)), mem: max(g.map((x) => x.mem)), memTotal: g[0].memTotal,
            estado: g.reduce((a, x) => (GRAVEDAD[x.estado] > GRAVEDAD[a] ? x.estado : a), "reposo"),
            motivos: [...new Set(g.flatMap((x) => x.motivos))],
        });
    }

    const entrenamientos = (await prisma.entrenamientoDetector.findMany({
        where: { OR: [{ iniciadoAt: { gte: new Date(desde) } }, { terminadoAt: { gte: new Date(desde) } }, { estado: { in: ["PREPARANDO", "ENTRENANDO", "EXPORTANDO"] } }] },
        orderBy: { createdAt: "desc" }, take: 30,
        select: { id: true, estado: true, iniciadoAt: true, terminadoAt: true, error: true, resultado: true, progreso: true, conjunto: true, parametros: true },
    })).map((t) => ({
        id: t.id, estado: t.estado, desde: t.iniciadoAt?.toISOString() || null, hasta: t.terminadoAt?.toISOString() || null,
        error: t.error, fotos: (t.conjunto as any)?.fotos ?? null, modelo: (t.parametros as any)?.modelo ?? null,
        salud: (t.resultado as any)?.salud || (t.progreso as any)?.salud || null,
    }));

    const resumen = {
        muestras: crudas.length,
        gpuMax: max(crudas.map((x) => x.gt)), cpuMax: max(crudas.map((x) => x.ct)), wMax: max(crudas.map((x) => x.w)),
        segEntrenando: Math.round(crudas.filter((x) => x.estado !== "reposo").length * 5),
        segEnfriando: Math.round(crudas.filter((x) => x.estado === "enfriando").length * 5),
    };
    return NextResponse.json({ horas, desde, hasta, limites: estado?.limites || null, ahora: estado?.salud || null, latido: estado?.latido || null, puntos, entrenamientos, resumen },
        { headers: { "Cache-Control": "no-store" } });
}
