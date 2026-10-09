import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/app/actions/auth";
import { permisosDeSesion } from "@/lib/permisos";
import { guardarAjuste } from "@/lib/ajustes-db";
import { CLAVE_TAREAS, TAREAS_VISION, leerTareasApagadas, mandarTareas } from "@/lib/vision";

export const dynamic = "force-dynamic";

/**
 * POST /api/vision/tareas  { tarea, activa }
 *
 * Prende o apaga una tarea de omni-vision (detección, siluetas, pose, atributos, texto,
 * seguimiento). Pide el permiso Ajustes, como los interruptores de analíticas. Se guarda en el
 * ajuste y se le manda a omni-vision en el acto; si no contesta, queda guardado igual y
 * vision-worker se lo vuelve a mandar en su próxima vuelta — por eso se devuelve `aplicada`
 * aparte: guardado no es lo mismo que en efecto.
 */
export async function POST(req: NextRequest) {
    const s: any = await getSession();
    if (!s) return NextResponse.json({ error: "Sin sesión" }, { status: 401 });
    if (!permisosDeSesion(s).includes("ajustes")) return NextResponse.json({ error: "Sólo quien tiene Ajustes puede cambiar esto." }, { status: 403 });
    const b = await req.json().catch(() => null);
    if (typeof b?.tarea !== "string" || !(b.tarea in TAREAS_VISION) || typeof b?.activa !== "boolean") return NextResponse.json({ error: "Pedido inválido" }, { status: 400 });
    const apagadas = new Set(await leerTareasApagadas());
    if (b.activa) apagadas.delete(b.tarea); else apagadas.add(b.tarea);
    const lista = [...apagadas].sort();
    await guardarAjuste(CLAVE_TAREAS, JSON.stringify({ apagadas: lista }));
    const aplicada = await mandarTareas(lista);
    return NextResponse.json({ tareasApagadas: lista, aplicada });
}
