/**
 * GET /api/lpr/read-rate?days=7 — cuánto está leyendo el sistema, y dónde no.
 *
 * ## Por qué son DOS mediciones y no una
 *
 * La pantalla mostraba un solo número y decía "tasa de lectura", pero medía únicamente
 * las cámaras de barrera. Las de seguimiento no aparecían — y no porque estuvieran
 * filtradas: para ellas **no existía el denominador**.
 *
 * En la barrera la cámara Hikvision dispara siempre y escribe `NO_LEIDA` cuando no
 * reconoce. El evento queda igual, así que "cuántas veces miró" se puede contar desde la
 * misma tabla que "cuántas veces leyó".
 *
 * En seguimiento no pasa nada de eso. Una ráfaga que no da ninguna matrícula no escribe
 * ninguna fila: el intento no deja rastro. Contar avistamientos daría un numerador suelto
 * — "Calle 21 leyó 40 chapas" no dice si leyó el 90% o el 9%.
 *
 * Por eso el denominador del seguimiento es la RÁFAGA, que la pasarela cuenta por cámara
 * y por minuto en TrackingCamaraMuestra. Son dos cosas distintas medidas contra dos
 * denominadores distintos, y por eso van en dos bloques separados en vez de sumarse en un
 * promedio único: un promedio entre ellas no significaría nada.
 *
 * ## El descarte que no es un fallo
 *
 * `fueraDeLinea` cuenta lecturas BUENAS que se tiraron porque cayeron afuera de la zona o
 * de la línea del calibrador. No son un fallo del lector: son una decisión del operador.
 * Meterlas en el denominador hundiría la tasa de una cámara bien calibrada, que es
 * exactamente al revés de lo que el panel tiene que decir. Se informan aparte.
 */
import { NextRequest, NextResponse } from "next/server";
import { medirTasas } from "@/lib/tasa-lectura-servidor";

export const dynamic = "force-dynamic";

/*
 * 26/11 (Nico): «cambiar lo de seguimiento por las cámaras LPR interiores, las que ve OmniVision y las
 * ANPR también; más pro, exportable, con sugerencias y horas de fallos». La medición vive ahora en
 * lib/tasa-lectura-servidor (la usa también el Excel): dos grupos —Accesos e Interiores—, cada cámara
 * con su tasa por hora, sus horas peores, día contra noche y las correcciones sugeridas.
 */
export async function GET(req: NextRequest) {
    const days = Math.min(90, Math.max(1, parseInt(req.nextUrl.searchParams.get("days") || "7", 10)));
    try {
        return NextResponse.json({ ok: true, ...(await medirTasas(days)) }, { headers: { "Cache-Control": "no-store" } });
    } catch (e) {
        return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "No se pudo medir la tasa." }, { status: 500 });
    }
}
