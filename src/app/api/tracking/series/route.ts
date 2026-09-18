import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyApiAuth, unauthorizedResponse } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/tracking/series?horas=24
 *
 * La serie del seguimiento: cómo viene trabajando, no cómo está justo ahora. Junta las
 * muestras de recursos que guarda la pasarela con las lecturas que quedaron en la base,
 * porque son las dos mitades de la misma pregunta: si el lector trabaja y si sirve.
 */

/** Agrupa las muestras en tramos parejos: 1440 puntos por día no se ven, 120 sí. */
function comprimir(filas: any[], puntos: number) {
    if (filas.length <= puntos) return filas;
    const tam = Math.ceil(filas.length / puntos);
    const salida: any[] = [];
    for (let i = 0; i < filas.length; i += tam) {
        const tramo = filas.slice(i, i + tam);
        const prom = (k: string) => {
            const v = tramo.map((x) => x[k]).filter((x) => x != null) as number[];
            return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 : null;
        };
        const suma = (k: string) => tramo.reduce((a, x) => a + (x[k] || 0), 0);
        salida.push({
            momento: tramo[Math.floor(tramo.length / 2)].momento,
            gpuUso: prom("gpuUso"), gpuMem: prom("gpuMem"), gpuTemp: prom("gpuTemp"),
            cpuCont: prom("cpuCont"), memCont: prom("memCont"),
            lecturas: suma("lecturas"), disparos: suma("disparos"), descartes: suma("descartes"),
            enGpu: tramo[tramo.length - 1].enGpu,
        });
    }
    return salida;
}

export async function GET(req: NextRequest) {
    const auth = await verifyApiAuth();
    if (!auth.authenticated) return unauthorizedResponse();

    const horas = Math.min(Math.max(parseInt(req.nextUrl.searchParams.get("horas") || "24", 10) || 24, 1), 336);
    const desde = new Date(Date.now() - horas * 60 * 60 * 1000);

    const [crudas, avistamientos, camaras] = await Promise.all([
        prisma.trackingSample.findMany({
            where: { momento: { gte: desde } },
            orderBy: { momento: "asc" },
            select: {
                momento: true, gpuUso: true, gpuMem: true, gpuTemp: true,
                cpuCont: true, memCont: true, camaras: true,
                disparos: true, lecturas: true, descartes: true, enGpu: true,
            },
        }),
        prisma.plateSighting.findMany({
            where: { source: "TRACK", timestamp: { gte: desde } },
            orderBy: { timestamp: "desc" },
            select: { plate: true, deviceId: true, cameraName: true, confidence: true, reads: true, timestamp: true },
        }),
        prisma.device.findMany({
            where: { deviceType: "LPR_INTERIOR" as any },
            select: { id: true, name: true, trackEnabled: true, trackTrigger: true, trackRoi: true, trackMinConf: true },
        }),
    ]);

    // ── Lecturas por hora, para el gráfico de barras
    const porHora: { hora: string; lecturas: number }[] = [];
    const cubos = new Map<string, number>();
    for (const a of avistamientos) {
        const h = new Date(a.timestamp); h.setMinutes(0, 0, 0);
        const k = h.toISOString();
        cubos.set(k, (cubos.get(k) || 0) + 1);
    }
    const inicio = new Date(desde); inicio.setMinutes(0, 0, 0);
    for (let t = inicio.getTime(); t <= Date.now(); t += 3600000) {
        const k = new Date(t).toISOString();
        porHora.push({ hora: k, lecturas: cubos.get(k) || 0 });
    }

    // ── Por cámara: lo que de verdad importa mirar para calibrar
    const porCamara = camaras.map((c) => {
        const suyos = avistamientos.filter((a) => a.deviceId === c.id);
        const confs = suyos.map((a) => a.confidence).filter((x): x is number => x != null);
        return {
            id: c.id,
            nombre: c.name,
            activa: c.trackEnabled !== false,
            modo: c.trackTrigger || "escena",
            conZona: !!c.trackRoi,
            umbral: c.trackMinConf ?? null,
            lecturas: suyos.length,
            confianzaProm: confs.length ? Math.round((confs.reduce((a, b) => a + b, 0) / confs.length) * 100) : null,
            cuadrosProm: suyos.length ? Math.round(suyos.reduce((a, b) => a + (b.reads || 0), 0) / suyos.length) : null,
            ultima: suyos[0]?.timestamp ?? null,
            ultimaPlaca: suyos[0]?.plate ?? null,
        };
    }).sort((a, b) => b.lecturas - a.lecturas);

    // ── Resumen del período
    const disparos = crudas.reduce((a, x) => a + (x.disparos || 0), 0);
    const lecturas = crudas.reduce((a, x) => a + (x.lecturas || 0), 0);
    const descartes = crudas.reduce((a, x) => a + (x.descartes || 0), 0);
    const confs = avistamientos.map((a) => a.confidence).filter((x): x is number => x != null).sort((a, b) => a - b);
    const gpus = crudas.map((x) => x.gpuUso).filter((x): x is number => x != null);
    const ultima = crudas[crudas.length - 1];

    return NextResponse.json({
        horas,
        muestras: comprimir(crudas, 120),
        porHora,
        porCamara,
        resumen: {
            disparos,
            lecturas,
            descartes,
            // De cada disparo, cuántos terminaron en una lectura confiable. Es la medida
            // honesta del rendimiento: un número alto de disparos sin lecturas quiere decir
            // que la zona está mal puesta o que la cámara mira donde no hay matrículas.
            efectividad: disparos ? Math.round((lecturas / disparos) * 100) : null,
            confianzaMediana: confs.length ? Math.round(confs[Math.floor(confs.length / 2)] * 100) : null,
            avistamientos: avistamientos.length,
            gpuPico: gpus.length ? Math.max(...gpus) : null,
            gpuProm: gpus.length ? Math.round(gpus.reduce((a, b) => a + b, 0) / gpus.length) : null,
            enGpu: ultima?.enGpu ?? null,
            conMuestras: crudas.length,
        },
    });
}
