import { NextResponse } from "next/server";
import { verifyApiAuth, unauthorizedResponse } from "@/lib/api-auth";
import { ventanaPlayback, ANTES_MAX, DESPUES_MAX, DESPUES_MIN } from "@/lib/ventana-playback";

export const dynamic = "force-dynamic";

/**
 * GET /api/playback/ventana → { antes, despues, topes }
 *
 * Los segundos antes/después de un evento viven en Ajustes y los lee el servidor al armar
 * cada clip. La ventana de playback del monitor necesita saberlos del lado del navegador
 * por dos motivos: para que la línea de tiempo sepa en qué instante empieza el video que
 * está reproduciendo (y el cursor avance con él), y para decirle al operador, antes de
 * bajar un clip, cuánto va a traer y dejarle cambiarlo para ese clip.
 */
export async function GET() {
    const auth = await verifyApiAuth();
    if (!auth.authenticated) return unauthorizedResponse();
    const v = await ventanaPlayback();
    return NextResponse.json({ ...v, topes: { antesMax: ANTES_MAX, despuesMax: DESPUES_MAX, despuesMin: DESPUES_MIN } });
}
