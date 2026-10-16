import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyApiAuth, unauthorizedResponse, forbiddenResponse } from "@/lib/api-auth";
import { leerAjuste } from "@/lib/ajustes-db";
import { leerInterruptores, VISION_URL } from "@/lib/vision";
import { camarasVision, CANAL_NVR, TOPE_POR_SEG_DEFECTO } from "@/lib/vision-camaras";
import { CLAVE_REGLAS, TIPOS_REGLA, validarReglas, type ReglaVision } from "@/lib/vision-reglas";
import { probarCamara, TEXTO_PRUEBA, type ResultadoPrueba } from "@/lib/probar-camara";

/**
 * El diagnóstico de las cámaras que no entregan cuadro, guardado un rato: cada prueba con una
 * clave mala es otro login fallido, y no se quiere sumar intentos a una cámara que ya los cuenta.
 */
const DIAGNOSTICO_MS = 10 * 60_000;
const diagnosticos = new Map<string, { r: ResultadoPrueba; t: number }>();

export const dynamic = "force-dynamic";

/**
 * GET /api/vision/motor — qué cámaras procesa OmniVision, qué hace con cada una, cuánto le cuesta
 * al motor y cómo le llega la imagen (pedido de Nico, 15/10: «tenemos que tener bien claro qué
 * cantidad de cámaras está procesando OmniVision, nuestra inteligencia, nuestro producto»).
 *
 * Junta cuatro fuentes que hasta ahora se veían por separado (o no se veían):
 *  · la lista VISION_CAMARAS (qué cámaras están en OmniVision, por equipo o canal de NVR);
 *  · lo que mide vision-worker cada 15 s (VISION_REGISTRO_ESTADO: análisis por segundo, último
 *    cuadro, error, si va por el carril rápido);
 *  · las reglas y zonas entrenables de cada cámara, y qué analíticas están prendidas;
 *  · lo que dejó hoy: pistas del registro y eventos de reglas.
 *
 * También lista las cámaras que tienen una regla y NO están en OmniVision: desde el 15/10 la lista
 * decide todo, y una regla en una cámara afuera no corre. Antes eso no se veía en ningún lado.
 */
/** Un estado más viejo que esto es de un worker caído: no se muestra como medida. */
const ESTADO_FRESCO_MS = 2 * 60_000;
/** Ventana para decidir si una cámara lee chapas o detecta intrusión. */
const FUNCION_DIAS = 7;

export async function GET() {
    const auth = await verifyApiAuth();
    if (!auth.authenticated) return unauthorizedResponse();
    if (auth.pantalla) return forbiddenResponse("No es una vista de pantalla.");

    const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
    const semana = new Date(Date.now() - FUNCION_DIAS * 86_400_000);
    const [enVision, equipos, inter, crudoReglas, estadoCrudo, topeCrudo, nombresCrudo, zonas, pistasHoy, eventosHoy, leen, detectan, salud] = await Promise.all([
        camarasVision(),
        prisma.device.findMany({ where: { deviceType: { not: "NVR" as any } }, select: { id: true, name: true, deviceType: true, location: true, ip: true, username: true, password: true }, orderBy: { name: "asc" } }),
        leerInterruptores(),
        leerAjuste(CLAVE_REGLAS),
        leerAjuste("VISION_REGISTRO_ESTADO"),
        leerAjuste("VISION_TOPE_POR_SEG"),
        leerAjuste("VISION_CAMARAS_NOMBRES"),
        prisma.zonaEntrenable.findMany({ where: { activa: true }, select: { deviceId: true } }).catch(() => []),
        prisma.objetoVisto.groupBy({ by: ["deviceId", "grupo"], where: { primeraVez: { gte: hoy } }, _count: { _all: true } }).catch(() => []),
        prisma.eventoVision.groupBy({ by: ["deviceId"], where: { ts: { gte: hoy } }, _count: { _all: true } }).catch(() => []),
        prisma.accessEvent.groupBy({ by: ["deviceId"], where: { timestamp: { gte: semana } } }).catch(() => []),
        prisma.detection.groupBy({ by: ["deviceId"], where: { timestamp: { gte: semana }, type: { not: "MOTION" } } }).catch(() => []),
        fetch(`${VISION_URL()}/salud`, { cache: "no-store", signal: AbortSignal.timeout(2000) }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ]);

    let reglas: ReglaVision[] = [];
    try { reglas = validarReglas(JSON.parse(crudoReglas?.value || "[]")).reglas; } catch { reglas = []; }
    const prendida = (r: ReglaVision) => r.activa && inter.analiticas[TIPOS_REGLA[r.tipo].analitica] !== false;
    let estado: any = null;
    try { estado = JSON.parse(estadoCrudo?.value || "null"); } catch { estado = null; }
    const fresco = !!(estado?.t && Date.now() - Date.parse(estado.t) < ESTADO_FRESCO_MS);
    let nombres: Record<string, string> = {};
    try { nombres = JSON.parse(nombresCrudo?.value || "{}") || {}; } catch { nombres = {}; }

    const a = inter.analiticas;
    const registro = a.registro !== false && estado?.mira !== false;
    const lee = new Set(leen.map((x) => x.deviceId).filter(Boolean) as string[]);
    const detecta = new Set(detectan.map((x) => x.deviceId).filter(Boolean) as string[]);
    const porEquipo = new Map(equipos.map((e) => [e.id, e]));
    const zonasDe = new Map<string, number>(); for (const z of zonas) zonasDe.set(z.deviceId, (zonasDe.get(z.deviceId) || 0) + 1);
    const pistasDe = new Map<string, { total: number; grupos: Record<string, number> }>();
    for (const p of pistasHoy) { if (!p.deviceId) continue; const x = pistasDe.get(p.deviceId) || { total: 0, grupos: {} }; x.total += p._count._all; x.grupos[p.grupo] = (x.grupos[p.grupo] || 0) + p._count._all; pistasDe.set(p.deviceId, x); }
    const eventosDe = new Map(eventosHoy.filter((e) => e.deviceId).map((e) => [e.deviceId!, e._count._all]));
    const cicloMs: number | null = typeof estado?.cicloMs === "number" ? estado.cicloMs : null;
    const intervaloMs: number = estado?.intervaloMs || 2000;
    const total = fresco ? Number(estado?.carga?.total) || 0 : 0;

    const fila = (id: string, dentro: boolean) => {
        const eq = porEquipo.get(id);
        const canal = CANAL_NVR.exec(id);
        const est = estado?.camaras?.[id] || null;
        const rs = reglas.filter((r) => r.deviceId === id);
        // Por lo que hizo en la semana, no por el tipo: LPR_CAMERA es el tipo por defecto de cualquier equipo.
        const funcion: "lpr" | "intrusion" | null = lee.has(id) ? "lpr" : detecta.has(id) ? "intrusion" : null;
        const rapido = !!est?.rapido;
        const porSeg = fresco && typeof est?.porSeg === "number" ? est.porSeg : null;
        return {
            id, dentro,
            nombre: eq?.name || nombres[id] || (canal ? `NVR ${canal[1]} · CH ${canal[2]}` : id),
            origen: canal ? "canal" as const : "equipo" as const,
            ubicacion: eq?.location || null,
            funcion,
            hace: {
                registro: dentro && registro,
                reglas: rs.filter(prendida).length, reglasApagadas: rs.filter((r) => !prendida(r)).length,
                rapido,
                verificacion: dentro && funcion === "intrusion" && a["verif-intrusion"] !== false,
                lecturas: dentro && funcion === "lpr" && a["tipo-vehiculo"] !== false,
                relectura: dentro && funcion === "lpr" && a.relectura !== false,
                zonas: zonasDe.get(id) || 0,
                busqueda: dentro && registro && a.busqueda !== false,
            },
            // Cómo le llega la imagen al motor.
            fuente: !dentro ? "nada" as const : rapido ? "video" as const : est ? "cuadros" as const : registro ? "esperando" as const : funcion ? "eventos" as const : "nada" as const,
            porSeg, parte: porSeg != null && total > 0 ? porSeg / total : null,
            ms: est?.ms ?? null, ultimo: est?.ultimo || null, error: est?.error || null,
            analizados: est?.analizados ?? null, saltados: est?.saltados ?? null,
            cambio: est?.cambio?.mediana ?? null,
            hoy: { pistas: pistasDe.get(id)?.total || 0, grupos: pistasDe.get(id)?.grupos || {}, eventos: eventosDe.get(id) || 0 },
        };
    };
    const ids = [...enVision.ids];
    const camaras = ids.map((id) => ({ ...fila(id, true), diagnostico: null as null | { codigo: ResultadoPrueba; texto: string } }));
    // Por qué no llega el video, preguntado a la cámara (con su clave) y guardado un rato.
    await Promise.all(camaras.filter((c) => c.error && c.origen === "equipo").map(async (c) => {
        const eq = porEquipo.get(c.id); if (!eq) return;
        let d = diagnosticos.get(c.id);
        if (!d || Date.now() - d.t > DIAGNOSTICO_MS) { d = { r: await probarCamara(eq), t: Date.now() }; diagnosticos.set(c.id, d); }
        c.diagnostico = { codigo: d.r, texto: TEXTO_PRUEBA[d.r] };
    }));
    // Con una regla prendida y fuera de OmniVision: la regla no corre.
    const fuera = [...new Set(reglas.filter(prendida).map((r) => r.deviceId))].filter((id) => !enVision.ids.has(id)).map((id) => fila(id, false));

    return NextResponse.json({
        motor: {
            vivo: fresco, t: estado?.t || null, salud: salud ? { ok: true, gpu: salud.gpu ?? salud.dispositivo ?? null, propio: !!salud.propio?.activo } : { ok: false },
            registro, cicloMs, intervaloMs, rapidoFps: estado?.rapidoFps || 4, analizarIgualMs: estado?.analizarIgualMs || 60_000,
            carga: fresco ? estado.carga : null, tope: Math.max(1, Number(topeCrudo?.value) || estado?.carga?.tope || TOPE_POR_SEG_DEFECTO),
            tareasApagadas: estado?.tareasApagadas || [],
            pistasAbiertas: estado?.pistasAbiertas ?? null,
        },
        totales: { enVision: camaras.length, todas: enVision.todas, equipos: equipos.length, canales: ids.filter((id) => CANAL_NVR.test(id)).length },
        camaras: camaras.sort((x, y) => (y.porSeg || 0) - (x.porSeg || 0) || x.nombre.localeCompare(y.nombre)),
        fuera,
    }, { headers: { "Cache-Control": "no-store" } });
}
