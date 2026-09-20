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
            gpuUso: prom("gpuUso"), gpuMem: prom("gpuMem"), gpuTemp: prom("gpuTemp"), gpuWatts: prom("gpuWatts"),
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

    /*
     * La ventana se pide en MINUTOS.
     *
     * Venía en horas con un piso de una, y eso dejaba afuera justo la pregunta más
     * frecuente cuando algo acaba de pasar: ¿qué está haciendo AHORA? Con una hora como
     * ventana más corta, un pico de treinta segundos queda promediado contra los otros
     * cincuenta y nueve minutos y desaparece. `horas` sigue aceptado para no romper nada.
     */
    const pedidoMin = req.nextUrl.searchParams.get("minutos");
    const pedidoHoras = req.nextUrl.searchParams.get("horas");
    const minutos = Math.min(Math.max(
        pedidoMin != null ? (parseInt(pedidoMin, 10) || 60)
            : (parseInt(pedidoHoras || "24", 10) || 24) * 60,
        5), 336 * 60);
    const horas = minutos / 60;
    const desde = new Date(Date.now() - minutos * 60 * 1000);

    const [crudas, avistamientos, camaras] = await Promise.all([
        prisma.trackingSample.findMany({
            where: { momento: { gte: desde } },
            orderBy: { momento: "asc" },
            select: {
                momento: true, gpuUso: true, gpuMem: true, gpuTemp: true, gpuWatts: true,
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

    /*
     * Las lecturas agrupadas, para el gráfico de barras.
     *
     * El tramo sale de la ventana y no es fijo de una hora. Con la hora clavada, una
     * ventana de diez minutos daba UNA barra — un gráfico de una sola columna, que no es
     * un gráfico — y siete días daban ciento sesenta y ocho, que tampoco se leen. Se
     * apunta a unas veinte o treinta barras, que es lo que el ojo distingue de un vistazo.
     */
    const tramoMin = minutos <= 15 ? 1 : minutos <= 45 ? 2 : minutos <= 120 ? 5
        : minutos <= 360 ? 15 : minutos <= 1440 ? 60 : 360;
    const tramoMs = tramoMin * 60 * 1000;
    const porTramo: { desde: string; lecturas: number }[] = [];
    const cubos = new Map<number, number>();
    for (const a of avistamientos) {
        const k = Math.floor(new Date(a.timestamp).getTime() / tramoMs) * tramoMs;
        cubos.set(k, (cubos.get(k) || 0) + 1);
    }
    const primero = Math.floor(desde.getTime() / tramoMs) * tramoMs;
    for (let t = primero; t <= Date.now(); t += tramoMs) {
        porTramo.push({ desde: new Date(t).toISOString(), lecturas: cubos.get(t) || 0 });
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
    const watts = crudas.map((x) => x.gpuWatts).filter((x): x is number => x != null);
    const ultima = crudas[crudas.length - 1];

    /**
     * ¿El 100% de la GPU es trabajo o es espera?
     *
     * `utilization.gpu` no mide cuánto calcula la placa: mide qué fracción del tiempo hubo
     * al menos un núcleo ocupado. El lector, entre pedido y pedido, deja un hilo de CUDA
     * dando vueltas esperando — spin-wait — y el driver cuenta esa vuelta como trabajo. El
     * resultado es 100% clavado con la placa tibia.
     *
     * Medido acá, sobre una RTX 3050 con el lector en reposo: uso 100%, potencia 37,5 W de
     * 70, temperatura 57 °C, memoria al 2%. Ocho muestras seguidas sin una décima de
     * variación. Inferencia de verdad al 100% chupa cerca del límite y la potencia
     * fluctúa con cada ráfaga.
     *
     * El número no es inútil, es ambiguo, y mostrarlo solo hizo que alguien viera "GPU
     * 100%" y saliera a buscar un incendio que no existía. La potencia no es ambigua: sale
     * del sensor de la placa y no sube si no hay cálculo. Así que la potencia es el
     * titular y esto explica el porcentaje cuando los dos no coinciden.
     */
    const usoProm = gpus.length ? gpus.reduce((a, b) => a + b, 0) / gpus.length : null;
    const wattsProm = watts.length ? watts.reduce((a, b) => a + b, 0) / watts.length : null;

    return NextResponse.json({
        horas,
        muestras: comprimir(crudas, 120),
        porTramo,
        tramoMin,
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
            gpuProm: usoProm != null ? Math.round(usoProm) : null,
            gpuWattsPico: watts.length ? Math.max(...watts) : null,
            gpuWattsProm: wattsProm != null ? Math.round(wattsProm) : null,
            enGpu: ultima?.enGpu ?? null,
            conMuestras: crudas.length,
        },
    });
}
