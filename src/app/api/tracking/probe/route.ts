import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";
import { verifyApiAuth, unauthorizedResponse } from "@/lib/api-auth";
import { capturarCuadro, leerMatriculas } from "@/lib/cuadro";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * ¿Sirve esta cámara?
 *
 * Antes contestaba media pregunta: sacaba un cuadro y lo pasaba por el lector. Eso dice si
 * el encuadre enfoca bien las matrículas y no dice nada sobre si la cámara va a andar —
 * que es lo que uno quiere saber cuando la cámara no es de una marca conocida.
 *
 * Y ahí está el punto: el seguimiento no necesita que la cámara sea de ninguna marca. Toma
 * cuadros por RTSP con ffmpeg, que habla con cualquiera. Lo que sí necesita son tres cosas
 * concretas, y las tres se pueden medir antes de dar de alta nada:
 *
 *   RESOLUCIÓN. Una matrícula a quince metros no entra en 704×480. Es la causa número uno
 *   de "la cámara anda pero no lee nada", y no da ningún síntoma: el video se ve bien.
 *
 *   CÓDEC. El video en vivo del navegador sale por go2rtc pidiendo H.264. Una cámara que
 *   sólo emite H.265 se va a leer igual —a ffmpeg le da lo mismo— pero su ventanita de
 *   vivo va a quedar en negro, y eso se confunde con "la cámara no anda".
 *
 *   CUADROS POR SEGUNDO. Con menos de cinco, un auto cruza la línea entre dos cuadros.
 *
 * Nada de esto es una marca: es lo que el flujo dice de sí mismo. Por eso el veredicto
 * vale para cualquier cámara, incluidas las que OmniAccess no sabe configurar.
 */

type Flujo = {
    codec: string | null;
    ancho: number | null;
    alto: number | null;
    cps: number | null;
    audio: boolean;
    contenedor: string | null;
};

/** Lo que ffprobe dice del flujo. Sin abrir el video: sólo su cabecera. */
function mirarElFlujo(rtsp: string, segundos = 20): Promise<Flujo | null> {
    return new Promise((resolve) => {
        const ff = spawn("ffprobe", [
            "-hide_banner", "-loglevel", "error",
            "-rtsp_transport", "tcp",
            "-print_format", "json", "-show_streams", "-show_format",
            "-i", rtsp,
        ]);
        let salida = "";
        const corte = setTimeout(() => { ff.kill("SIGKILL"); resolve(null); }, segundos * 1000);
        ff.stdout.on("data", (d) => { salida += d.toString(); });
        ff.on("error", () => { clearTimeout(corte); resolve(null); });
        ff.on("close", () => {
            clearTimeout(corte);
            try {
                const d = JSON.parse(salida || "{}");
                const flujos: any[] = d?.streams || [];
                const v = flujos.find((x) => x.codec_type === "video");
                if (!v) return resolve(null);
                /* r_frame_rate viene como "25/1" o "0/0" cuando la cámara no lo declara. */
                const [a, b] = String(v.r_frame_rate || "").split("/").map(Number);
                const cps = a && b ? Math.round((a / b) * 10) / 10 : null;
                resolve({
                    codec: v.codec_name || null,
                    ancho: Number(v.width) || null,
                    alto: Number(v.height) || null,
                    cps,
                    audio: flujos.some((x) => x.codec_type === "audio"),
                    contenedor: d?.format?.format_name || null,
                });
            } catch { resolve(null); }
        });
    });
}

/** Cada cosa que puede salir mal, dicha en una línea y con su arreglo. */
function revisar(f: Flujo | null) {
    const avisos: { grave: boolean; que: string }[] = [];
    if (!f) {
        avisos.push({
            grave: false,
            que: "No se pudo leer la ficha técnica del flujo. El cuadro llegó igual, así que la cámara sirve; sólo no se puede comprobar la resolución ni el códec desde acá.",
        });
        return avisos;
    }
    if (f.ancho && f.ancho < 1280) {
        avisos.push({
            grave: true,
            que: `El flujo es de ${f.ancho}×${f.alto}. Una matrícula a más de unos pocos metros no entra en esa resolución: casi seguro es el flujo secundario. Usá el principal.`,
        });
    }
    if (f.codec && !/h264|avc/i.test(f.codec)) {
        /* Verificado contra la cámara de la Calle 22, que emite HEVC: se lee bien y el
           vivo también se ve, porque go2rtc tiene un segundo origen `ffmpeg:...#video=h264`
           que lo convierte al vuelo. Así que esto NO es una falla — decirlo como falla
           mandaría a cambiar la configuración de una cámara que anda. Es un costo. */
        avisos.push({
            grave: false,
            que: `El video viene en ${f.codec.toUpperCase()}. Se lee igual, y el vivo del navegador se ve porque el servidor lo pasa a H.264 al vuelo — pero esa conversión cuesta CPU por cada ventana abierta. Si la cámara puede emitir H.264, conviene.`,
        });
    }
    if (f.cps != null && f.cps > 0 && f.cps < 5) {
        avisos.push({
            grave: true,
            que: `El flujo manda ${f.cps} cuadros por segundo. Con tan pocos, un vehículo cruza la línea entre dos cuadros y no se lo lee.`,
        });
    }
    return avisos;
}

export async function POST(req: NextRequest) {
    const auth = await verifyApiAuth();
    if (!auth.authenticated) return unauthorizedResponse();

    let rtsp = "";
    try { rtsp = String((await req.json())?.rtsp || "").trim(); } catch { }
    if (!rtsp.startsWith("rtsp://") && !rtsp.startsWith("http")) {
        return NextResponse.json({ error: "La URL debe empezar con rtsp:// (o http:// para snapshot)." }, { status: 400 });
    }

    /* La ficha del flujo y el cuadro se piden a la vez: son dos conexiones distintas a la
       misma cámara y esperar una después de la otra duplicaba la espera del operador. */
    const t0 = Date.now();
    const [flujo, cuadro] = await Promise.all([
        mirarElFlujo(rtsp),
        capturarCuadro(rtsp, { segundos: 20 }).then(
            (b) => ({ jpeg: b as Buffer, error: null as string | null }),
            (e: any) => ({ jpeg: null, error: e?.message || String(e) }),
        ),
    ]);
    const msCaptura = Date.now() - t0;

    if (!cuadro.jpeg) {
        return NextResponse.json({
            error: `No se pudo tomar el cuadro: ${cuadro.error}`,
            flujo, avisos: revisar(flujo),
        }, { status: 502 });
    }

    const t1 = Date.now();
    const { lecturas, error: errorLpr } = await leerMatriculas(cuadro.jpeg);
    const msLectura = Date.now() - t1;

    return NextResponse.json({
        ok: true,
        imagen: `data:image/jpeg;base64,${cuadro.jpeg.toString("base64")}`,
        bytes: cuadro.jpeg.length,
        msCaptura,
        msLectura,
        lecturas,
        errorLpr,
        flujo,
        avisos: revisar(flujo),
        umbral: Number(process.env.TRACKING_MIN_CONFIDENCE || 0.6),
    });
}
