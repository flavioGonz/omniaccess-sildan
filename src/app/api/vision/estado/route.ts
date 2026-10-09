import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyApiAuth, unauthorizedResponse, forbiddenResponse } from "@/lib/api-auth";
import { saludVision, leerInterruptores, leerTareasApagadas, mandarTareas } from "@/lib/vision";
import { leerAjuste, guardarAjuste } from "@/lib/ajustes-db";
import { CLAVE_MEDIDAS, MIN_PEDIDOS_GPU, type Medida } from "@/lib/vision-peso";

/**
 * Las medidas de peso de cada tarea viven en omni-vision sólo mientras el contenedor está
 * arriba, y una tarea se mide al cargarse. Se guarda la última de cada una, así el laboratorio
 * puede decir cuánto pesa la pose aunque hoy nadie la haya cargado.
 */
async function medidasGuardadas(vivas?: Record<string, Medida>): Promise<Record<string, Medida>> {
    let guardadas: Record<string, Medida> = {};
    try { guardadas = JSON.parse((await leerAjuste(CLAVE_MEDIDAS))?.value || "{}") || {}; } catch { }
    if (!vivas) return guardadas;
    let cambio = false;
    const out = { ...guardadas };
    for (const [t, m] of Object.entries(vivas)) {
        const g = guardadas[t];
        // La memoria, de la carga más reciente; el CPU, de lo que esté corriendo ahora.
        const nueva = { ...g, ...(m.medido && m.medido !== g?.medido ? { vram_mb: m.vram_mb, ram_mb: m.ram_mb, medido: m.medido } : {}), ...(m.cpu_ms != null ? { cpu_ms: m.cpu_ms, n: m.n } : {}), ...(m.gpu_ms != null ? { gpu_ms: m.gpu_ms } : {}) };
        if (JSON.stringify(nueva) !== JSON.stringify(g)) { out[t] = nueva; cambio = true; }
    }
    // Sólo se escribe cuando cambia la memoria (el CPU se mueve en cada consulta y no vale una escritura cada 5 s).
    // …o cuando aparece por primera vez el tiempo de GPU de una tarea (siluetas y pose se usan poco).
    const cambioMemoria = Object.entries(vivas).some(([t, m]) => (m.medido && m.medido !== guardadas[t]?.medido) || (m.gpu_ms != null && guardadas[t]?.gpu_ms == null));
    if (cambio && cambioMemoria) await guardarAjuste(CLAVE_MEDIDAS, JSON.stringify(out)).catch(() => null);
    return out;
}

export const dynamic = "force-dynamic";

/**
 * GET /api/vision/estado — lo que necesita el laboratorio de visión (/admin/vision) al abrir:
 * la salud de omni-vision, los interruptores guardados y las cámaras que se pueden probar.
 *
 * Ruta GET y no acción de servidor por lo mismo que /api/detecciones: la pantalla consulta
 * la salud cada pocos segundos y no tiene que esperar detrás de otra acción.
 */
export async function GET() {
    const auth = await verifyApiAuth();
    if (!auth.authenticated) return unauthorizedResponse();
    if (auth.pantalla) return forbiddenResponse("El laboratorio de visión no es una vista de pantalla.");
    const [vision, interruptores, camaras, tareasApagadas] = await Promise.all([
        saludVision(),
        leerInterruptores(),
        // Las que tienen video en go2rtc: todo menos los grabadores.
        prisma.device.findMany({ where: { deviceType: { not: "NVR" as any } }, select: { id: true, name: true, deviceType: true }, orderBy: { name: "asc" } }),
        leerTareasApagadas(),
    ]);
    // Si omni-vision se reinició y todavía no se enteró de lo apagado, se le dice ya: no hace
    // falta esperar la próxima vuelta del worker para que la pantalla y el servicio coincidan.
    const enServicio = vision.salud?.apagadas;
    if (enServicio && [...enServicio].sort().join() !== [...tareasApagadas].sort().join()) await mandarTareas(tareasApagadas);
    // El tiempo de GPU por tarea lo da /salud aparte; se suma a la medida para guardarlo.
    const vivas = vision.salud?.medidas ? { ...vision.salud.medidas } : undefined;
    if (vivas) for (const [t, v] of Object.entries(vision.salud?.tareas || {})) {
        if ((v.latencia_ms?.n || 0) >= MIN_PEDIDOS_GPU && v.latencia_ms?.p50 != null) vivas[t] = { ...vivas[t], gpu_ms: v.latencia_ms.p50 };
    }
    const medidas = await medidasGuardadas(vivas);
    return NextResponse.json({ ...vision, ...interruptores, camaras, tareasApagadas, medidas }, { headers: { "Cache-Control": "no-store" } });
}
