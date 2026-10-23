import { NextResponse } from "next/server";
import { funcionActiva } from "@/app/actions/funciones";
import { funcionPorId, type FuncionId } from "@/lib/funciones";

/**
 * La puerta de las rutas de una función de la instalación (openspec alarmas-como-funciones,
 * «Las rutas obedecen»): con la función apagada, 404 y nada más — ni datos ni cambios.
 *
 *     const no = await exigirFuncion("FUNC_ALARMAS_GESTION"); if (no) return no;
 *
 * 404 y no 403: no es que quien pide no pueda, es que en esta instalación eso no existe ahora.
 * La pantalla lo reconoce por `funcionApagada` y lo dice en vez de mostrar un error.
 */
export async function exigirFuncion(id: FuncionId): Promise<NextResponse | null> {
    if (await funcionActiva(id)) return null;
    return NextResponse.json(
        { ok: false, error: `«${funcionPorId(id)?.nombre || id}» está apagada en la instalación.`, funcionApagada: id },
        { status: 404, headers: { "Cache-Control": "no-store" } },
    );
}
