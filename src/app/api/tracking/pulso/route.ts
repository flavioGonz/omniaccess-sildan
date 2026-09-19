import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyApiAuth, unauthorizedResponse } from "@/lib/api-auth";
import { exec } from "child_process";
import { promisify } from "util";

const correr = promisify(exec);
export const dynamic = "force-dynamic";

/**
 * El pulso de la GPU, para el indicador del sidebar.
 *
 * Existe aparte de /api/tracking/metrics porque aquel corre `docker stats` y `nvidia-smi`
 * en cada llamada, y tarda un segundo largo. Eso esta bien para una pantalla de
 * diagnostico que alguien abre a proposito; el sidebar esta en TODAS las paginas y en
 * todas las sesiones abiertas, asi que pedirlo desde ahi seria un comando por usuario cada
 * pocos segundos, para siempre.
 *
 * Aca se lee la ultima muestra que la pasarela ya guarda una vez por minuto. Es una
 * consulta con indice y el dato tiene hasta un minuto: para mirar de reojo si la placa
 * esta trabajando, alcanza. `edad` va en la respuesta para que el indicador pueda decir
 * cuando el dato dejo de ser fresco en vez de mostrar un numero viejo como si fuera de
 * ahora.
 *
 * **Vatios y no porcentaje.** `utilization.gpu` no mide cuanto calcula la placa sino que
 * fraccion del tiempo hubo algun nucleo ocupado, y el lector, entre pedido y pedido, deja
 * un hilo de CUDA girando en vacio que el driver cuenta como trabajo. Medido en esta
 * instalacion con el lector trabado: uso 100% y 37,5 de 70 W. La potencia sale del sensor
 * y no sube si no hay calculo.
 */

/** El limite de potencia no cambia en toda la vida de la placa: se pregunta una sola vez. */
let limiteW: number | null = null;

async function limiteDePotencia() {
    if (limiteW != null) return limiteW;
    try {
        const { stdout } = await correr(
            "nvidia-smi --query-gpu=power.limit --format=csv,noheader,nounits",
            { timeout: 8000 },
        );
        const n = parseFloat(stdout.trim().split("\n")[0]);
        if (!isNaN(n)) limiteW = n;
    } catch { }
    return limiteW;
}

export async function GET() {
    const auth = await verifyApiAuth();
    if (!auth.authenticated) return unauthorizedResponse();

    const [ultima, limite] = await Promise.all([
        prisma.trackingSample.findFirst({
            orderBy: { momento: "desc" },
            select: { momento: true, gpuUso: true, gpuWatts: true, gpuTemp: true, enGpu: true, lecturas: true },
        }),
        limiteDePotencia(),
    ]);

    if (!ultima) return NextResponse.json({ hay: false });

    return NextResponse.json({
        hay: ultima.gpuWatts != null,
        watts: ultima.gpuWatts,
        limite,
        uso: ultima.gpuUso,
        temp: ultima.gpuTemp,
        enGpu: ultima.enGpu,
        lecturas: ultima.lecturas,
        edadSeg: Math.round((Date.now() - ultima.momento.getTime()) / 1000),
    });
}
