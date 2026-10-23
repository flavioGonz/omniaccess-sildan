import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/app/actions/auth";
import { permisosDeSesion } from "@/lib/permisos";
import { verifyApiAuth, unauthorizedResponse, forbiddenResponse } from "@/lib/api-auth";
import { leerAjuste, guardarAjuste } from "@/lib/ajustes-db";
import { leerInterruptores } from "@/lib/vision";
import { camarasVision, CANAL_NVR } from "@/lib/vision-camaras";
import { CLAVE_REGLAS, TIPOS_REGLA, TIPOS_FILA_DATOS, validarReglas, type ReglaVision, type TipoRegla } from "@/lib/vision-reglas";

export const dynamic = "force-dynamic";

/** Cuántos eventos con foto se listan. */
const EVENTOS_MAX = 60;
/** Ventana de la lista de eventos. */
const EVENTOS_DIAS = 7;
/** Cuántos días de objetos vistos se miran para proponer cámaras en el asistente. */
const VISTOS_DIAS = 7;

function leerReglas(v: string | null | undefined): ReglaVision[] {
    try { return validarReglas(JSON.parse(v || "[]")).reglas; } catch { return []; }
}

/**
 * GET /api/vision/reglas — las reglas, las cámaras, qué analíticas están prendidas, el estado
 * del worker, los números de hoy de cada regla y los últimos eventos con foto.
 */
export async function GET() {
    const auth = await verifyApiAuth();
    if (!auth.authenticated) return unauthorizedResponse();
    if (auth.pantalla) return forbiddenResponse("No es una vista de pantalla.");
    const [crudo, equipos, inter, estadoCrudo, enVision, nombresCrudo, vistosCrudo] = await Promise.all([
        leerAjuste(CLAVE_REGLAS),
        prisma.device.findMany({ where: { deviceType: { not: "NVR" as any } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
        leerInterruptores(),
        leerAjuste("VISION_REGISTRO_ESTADO"),
        camarasVision(),
        leerAjuste("VISION_CAMARAS_NOMBRES"),
        /*
         * Qué vio cada cámara en la última semana, por clase (16/10: «una regla por cada canal que
         * tenga un contenedor»). El asistente lo usa para proponer las cámaras donde aparece lo que
         * se quiere vigilar, en vez de hacer adivinar cuáles de 30 miran un contenedor.
         */
        prisma.objetoVisto.groupBy({ by: ["deviceId", "clase"], where: { primeraVez: { gte: new Date(Date.now() - VISTOS_DIAS * 86_400_000) }, deviceId: { not: null } }, _count: { _all: true } }).catch(() => []),
    ]);
    const vistos = (vistosCrudo as any[]).map((v) => ({ deviceId: v.deviceId as string, clase: v.clase as string, n: v._count._all as number }));
    /*
     * Las cámaras para elegir: las de OmniVision primero (equipos Y canales de NVR), después el
     * resto. Antes se listaban sólo los equipos: un canal de NVR agregado a OmniVision desde la
     * pared no aparecía, y una regla en una cámara afuera de OmniVision se guardaba y no corría
     * (desde el 15/10 la lista de OmniVision decide todo). `analiza` lo dice en la pantalla.
     */
    let nombres: Record<string, string> = {};
    try { nombres = JSON.parse(nombresCrudo?.value || "{}") || {}; } catch { nombres = {}; }
    const canales = [...enVision.ids].filter((id) => CANAL_NVR.test(id)).map((id) => { const m = CANAL_NVR.exec(id)!; return { id, name: nombres[id] || `NVR ${m[1]} · CH ${m[2]}` }; });
    const camaras = [...equipos, ...canales].map((c) => ({ ...c, analiza: enVision.ids.has(c.id) }))
        .sort((a, b) => Number(b.analiza) - Number(a.analiza) || a.name.localeCompare(b.name));
    const reglas = leerReglas(crudo?.value);
    const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
    const ids = reglas.map((r) => r.id);

    // Los números de hoy, por regla, con una consulta por tipo de dato.
    const [cruces, otros, eventos] = ids.length ? await Promise.all([
        prisma.eventoVision.groupBy({ by: ["reglaId", "sentido", "clase"], where: { reglaId: { in: ids }, tipo: "CRUCE", ts: { gte: hoy } }, _count: { _all: true } }),
        prisma.eventoVision.groupBy({ by: ["reglaId", "tipo"], where: { reglaId: { in: ids }, tipo: { notIn: ["CRUCE", ...TIPOS_FILA_DATOS] }, ts: { gte: hoy } }, _count: { _all: true }, _max: { valor: true } }),
        prisma.eventoVision.findMany({ where: { reglaId: { in: ids }, tipo: { notIn: ["CRUCE", ...TIPOS_FILA_DATOS] }, ts: { gte: new Date(Date.now() - EVENTOS_DIAS * 86_400_000) } }, orderBy: { ts: "desc" }, take: EVENTOS_MAX }),
    ]) : [[], [], []];
    // Cruces por hora de hoy (para la barrita de cada regla de conteo).
    const porHora = ids.length ? await prisma.$queryRaw<{ regla: string; h: number; n: number }[]>`
        SELECT "reglaId" AS regla, extract(hour FROM ts AT TIME ZONE 'UTC' AT TIME ZONE 'America/Montevideo')::int AS h, count(*)::int AS n
          FROM "EventoVision" WHERE tipo = 'CRUCE' AND ts >= ${hoy.toISOString().replace("T", " ").replace("Z", "")}::timestamp AND "reglaId" = ANY(${ids}) GROUP BY 1, 2`.catch(() => []) : [];

    const resumen: Record<string, any> = {};
    for (const r of reglas) resumen[r.id] = { ab: 0, ba: 0, porClase: {} as Record<string, { ab: number; ba: number }>, porHora: Array(24).fill(0), hoy: 0, max: null as number | null };
    for (const c of cruces) {
        const s = resumen[c.reglaId]; if (!s) continue;
        const n = c._count._all, sen = c.sentido === "ba" ? "ba" : "ab";
        s[sen] += n;
        const k = c.clase || "otro";
        (s.porClase[k] ||= { ab: 0, ba: 0 })[sen] += n;
    }
    for (const o of otros) { const s = resumen[o.reglaId]; if (s) { s.hoy += o._count._all; s.max = o._max.valor ?? s.max; } }
    for (const h of porHora as any[]) { const s = resumen[h.regla]; if (s && h.h >= 0 && h.h < 24) s.porHora[h.h] = h.n; }
    // La fila: en la tarjeta, cuántos hay ahora (el último FILA) y el máximo de hoy, en vez de
    // cuántos eventos tuvo (los FILA son renglones de la curva, no eventos).
    const filas = reglas.filter((r) => r.tipo === "fila").map((r) => r.id);
    if (filas.length) {
        const [ultimos, maximos] = await Promise.all([
            prisma.$queryRaw<{ regla: string; n: number }[]>`SELECT DISTINCT ON ("reglaId") "reglaId" AS regla, valor AS n FROM "EventoVision" WHERE tipo = 'FILA' AND "reglaId" = ANY(${filas}) ORDER BY "reglaId", ts DESC`.catch(() => []),
            prisma.eventoVision.groupBy({ by: ["reglaId"], where: { reglaId: { in: filas }, tipo: "FILA", ts: { gte: hoy } }, _max: { valor: true } }).catch(() => []),
        ]);
        for (const u of ultimos as any[]) if (resumen[u.regla]) resumen[u.regla].hoy = Number(u.n) || 0;
        for (const m of maximos as any[]) if (resumen[m.reglaId]) resumen[m.reglaId].max = m._max.valor ?? null;
    }

    const analiticas: Record<TipoRegla, boolean> = Object.fromEntries((Object.keys(TIPOS_REGLA) as TipoRegla[]).map((t) => [t, inter.analiticas[TIPOS_REGLA[t].analitica] !== false])) as any;
    let estado: any = null;
    try { const e = JSON.parse(estadoCrudo?.value || "null"); estado = e ? { t: e.t, reglas: e.reglas, camaras: e.camaras } : null; } catch { }
    const nombreRegla = new Map(reglas.map((r) => [r.id, r.nombre]));
    return NextResponse.json({
        reglas, camaras, vistos, vistosDias: VISTOS_DIAS, analiticas, rotulado: inter.analiticas["rotulados"] !== false, estado, resumen,
        eventos: eventos.map((e) => ({ ...e, ts: e.ts.toISOString(), regla: nombreRegla.get(e.reglaId) || "Regla borrada", foto: e.foto ? `/api/vision/imagen/${e.foto}` : null, fotoAntes: e.fotoAntes ? `/api/vision/imagen/${e.fotoAntes}` : null })),
    }, { headers: { "Cache-Control": "no-store" } });
}

/** PUT /api/vision/reglas { reglas } — guarda la lista ENTERA. Pide el permiso Ajustes. */
export async function PUT(req: NextRequest) {
    const s: any = await getSession();
    if (!s) return NextResponse.json({ error: "Sin sesión" }, { status: 401 });
    if (!permisosDeSesion(s).includes("vision.config")) return NextResponse.json({ error: "Hace falta el permiso Configurar OmniVision para cambiar las reglas." }, { status: 403 });
    const b = await req.json().catch(() => null);
    const { reglas, errores } = validarReglas(b?.reglas);
    if (errores.length) return NextResponse.json({ error: errores.join(" · ") }, { status: 400 });
    const ids = new Set((await prisma.device.findMany({ select: { id: true } })).map((d) => d.id));
    // Los canales de NVR que están en OmniVision también son cámaras válidas para una regla.
    for (const id of (await camarasVision()).ids) if (CANAL_NVR.test(id)) ids.add(id);
    const sinCamara = reglas.filter((r) => !ids.has(r.deviceId));
    if (sinCamara.length) return NextResponse.json({ error: `La cámara de «${sinCamara[0].nombre}» ya no existe.` }, { status: 400 });
    await guardarAjuste(CLAVE_REGLAS, JSON.stringify(reglas));
    return NextResponse.json({ ok: true, reglas });
}
