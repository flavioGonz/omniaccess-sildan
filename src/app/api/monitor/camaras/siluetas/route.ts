export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { spawn } from "child_process";
import { NextRequest, NextResponse } from "next/server";
import { autorizarMonitor } from "@/lib/monitor/servidor";

/**
 * GET /api/monitor/camaras/siluetas?stream=<nombre> → text/event-stream con lo que OmniVision ve
 * en el canal, varias veces por segundo: las siluetas para dibujar sobre el vivo de la ficha.
 *
 * Cómo, y lo que cuesta (medido el 15/10 en San Nicolás, RTX 3050 compartida con omni-lpr):
 *  · Un ffmpeg lee el subflujo desde go2rtc (640×360, H.265) y saca CUADROS_POR_SEG cuadros JPEG
 *    por segundo: 2,6 % de un núcleo. No se usa /api/frame.jpeg de go2rtc, que arranca un
 *    ffmpeg por cada cuadro.
 *  · Cada cuadro va a omni-vision /detectar con tarea=segmentar: ~45 ms (27 ms de inferencia,
 *    rfdetr-small). A 3 por segundo son ~135 ms de cada segundo de omni-vision.
 *  · Si omni-vision todavía no contestó el cuadro anterior, el nuevo se descarta: nunca se le
 *    encolan pedidos (omni-vision atiende de a uno y comparte la GPU con el lector de chapas).
 *  · Hay un tope de SESIONES_MAX canales a la vez en todo el servidor, sumando todas las
 *    pantallas. Sólo se pide con la ficha de un canal abierta, no para la pared entera.
 *  · Una sesión dura a lo sumo SESION_MAX_MS: si la ficha sigue abierta, el navegador se vuelve a
 *    conectar solo (EventSource), y si quedó una pestaña olvidada, se corta.
 */

const VISION = (process.env.OMNI_VISION_URL || "http://127.0.0.1:8010").replace(/\/$/, "");
/** El RTSP de go2rtc (en el mismo CT). */
const GO2RTC_RTSP = process.env.GO2RTC_RTSP || "rtsp://127.0.0.1:8554";
const CUADROS_POR_SEG = 3;
const SESIONES_MAX = 2;
const SESION_MAX_MS = 10 * 60_000;
const GRUPOS = "persona,vehiculo,animal";
/** Puntos por silueta que viajan al navegador: más no se distingue a este tamaño. */
const PUNTOS_SILUETA_MAX = 60;
const NOMBRE_STREAM = /^(lpr|face)_[\w-]{1,100}$/;

let sesiones = 0;

const r4 = (v: number) => Math.round(v * 10000) / 10000;
function aligerar(poli: number[][]): number[][] {
    if (poli.length <= PUNTOS_SILUETA_MAX) return poli;
    const paso = poli.length / PUNTOS_SILUETA_MAX;
    return Array.from({ length: PUNTOS_SILUETA_MAX }, (_, i) => poli[Math.floor(i * paso)]);
}

export async function GET(req: NextRequest) {
    const p = await autorizarMonitor("/api/monitor/camaras/siluetas");
    if (p.error) return p.error;
    const stream = req.nextUrl.searchParams.get("stream") || "";
    if (!NOMBRE_STREAM.test(stream) || stream.endsWith("_hd")) return NextResponse.json({ error: "stream inválido" }, { status: 400 });
    // Sin lugar se contesta igual con un flujo de eventos que dice «ocupado» y se cierra: un 429 no
    // lo puede leer EventSource, que sólo reintentaría para siempre.
    if (sesiones >= SESIONES_MAX) {
        return new Response(`event: ocupado\ndata: ${JSON.stringify({ max: SESIONES_MAX })}\n\n`, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-store" } });
    }
    sesiones++;

    const enc = new TextEncoder();
    let cerrado = false;
    let ff: ReturnType<typeof spawn> | null = null;
    let fin: ReturnType<typeof setTimeout> | null = null;

    const body = new ReadableStream({
        start(controller) {
            const enviar = (evento: string, datos: unknown) => { if (!cerrado) try { controller.enqueue(enc.encode(`event: ${evento}\ndata: ${JSON.stringify(datos)}\n\n`)); } catch { } };
            const cerrar = () => {
                if (cerrado) return; cerrado = true; sesiones = Math.max(0, sesiones - 1);
                if (fin) clearTimeout(fin);
                try { ff?.kill("SIGKILL"); } catch { }
                try { controller.close(); } catch { }
            };
            req.signal.addEventListener("abort", cerrar);
            fin = setTimeout(cerrar, SESION_MAX_MS);

            ff = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-rtsp_transport", "tcp", "-i", `${GO2RTC_RTSP}/${stream}`,
                "-an", "-vf", `fps=${CUADROS_POR_SEG}`, "-q:v", "5", "-f", "image2pipe", "-c:v", "mjpeg", "pipe:1"], { stdio: ["ignore", "pipe", "ignore"] });
            ff.on("close", cerrar);
            ff.on("error", cerrar);

            let buf = Buffer.alloc(0);
            let ocupado = false;
            let descartados = 0;
            const analizar = async (jpeg: Buffer, t: number) => {
                ocupado = true;
                try {
                    const r = await fetch(`${VISION}/detectar?tarea=segmentar&grupos=${GRUPOS}`, { method: "POST", body: new Uint8Array(jpeg), headers: { "content-type": "image/jpeg" }, signal: AbortSignal.timeout(5000) });
                    const j: any = await r.json().catch(() => ({}));
                    if (!r.ok) { enviar("error", { error: j.error || `omni-vision respondió ${r.status}` }); return; }
                    enviar("cuadro", {
                        t, ms: Date.now() - t, descartados,
                        analisis: {
                            ancho: j.ancho, alto: j.alto, tarea: "segmentar",
                            objetos: (j.objetos || []).map((o: any) => ({
                                clase: o.clase, nombre: o.nombre, grupo: o.grupo, confianza: Math.round(o.confianza * 1000) / 1000,
                                caja: (o.caja_norm || []).map(r4),
                                ...(Array.isArray(o.silueta) ? { silueta: o.silueta.map((q: number[][]) => aligerar(q).map(([x, y]) => [r4(x), r4(y)])) } : {}),
                            })),
                        },
                    });
                    descartados = 0;
                } catch (e: any) {
                    enviar("error", { error: e?.message || "omni-vision no contestó" });
                } finally { ocupado = false; }
            };
            // Los JPEG llegan pegados por el pipe: se cortan por sus marcas de inicio y fin.
            ff.stdout?.on("data", (d: Buffer) => {
                buf = Buffer.concat([buf, d]);
                for (;;) {
                    const ini = buf.indexOf(Buffer.from([0xff, 0xd8]));
                    if (ini < 0) { buf = Buffer.alloc(0); break; }
                    const fin2 = buf.indexOf(Buffer.from([0xff, 0xd9]), ini + 2);
                    if (fin2 < 0) { if (ini > 0) buf = buf.subarray(ini); break; }
                    const jpeg = buf.subarray(ini, fin2 + 2);
                    buf = buf.subarray(fin2 + 2);
                    if (ocupado) { descartados++; continue; }
                    void analizar(Buffer.from(jpeg), Date.now());
                }
            });
            enviar("hola", { cuadrosPorSeg: CUADROS_POR_SEG });
        },
        cancel() {
            if (!cerrado) { cerrado = true; sesiones = Math.max(0, sesiones - 1); if (fin) clearTimeout(fin); try { ff?.kill("SIGKILL"); } catch { } }
        },
    });

    return new Response(body, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-store", "X-Accel-Buffering": "no", Connection: "keep-alive" } });
}
