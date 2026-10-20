export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { spawn } from "child_process";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/app/actions/auth";

/**
 * GET /api/filas/siluetas?device=<id> → text/event-stream con las personas que la Bosch está
 * viendo, varias veces por segundo, para dibujarlas sobre el vivo (HB, 20/10: «¿podés dibujar las
 * siluetas de las personas?»).
 *
 * Sin GPU y sin OmniVision: lo dice la misma cámara. La Bosch manda, en el RTSP con `vcd=2`, el
 * flujo de metadatos ONVIF (tt:MetadataStream) con cada objeto que sigue: id, clase («Human»),
 * confianza, caja, centro y polígono, en coordenadas −1..1 con y = 1 ARRIBA. Probado en HB: ~5
 * cuadros por segundo. Se copia sólo la pista de datos; pedir únicamente esa pista
 * (`-allowed_media_types data`) deja a ffmpeg esperando para siempre con esta cámara (probado), así
 * que la sesión trae también el video, por la red local, y se descarta. Por eso hay tope de sesiones.
 *
 * Es lo mismo que la cámara usa para contar: si una persona no aparece acá, la cámara no la está
 * viendo; si aparece una «persona» en una planta, ese es el falso conteo.
 */

/** Cuántas veces por segundo, como mucho, se le manda al navegador. */
const ENVIOS_POR_SEG = 6;
/** Pantallas mirando a la vez en todo el servidor: cada una es una sesión RTSP con la cámara. */
const SESIONES_MAX = 3;
/** Una sesión dura a lo sumo esto; EventSource se reconecta solo si la pantalla sigue abierta. */
const SESION_MAX_MS = 10 * 60_000;
/** El flujo RTSP de la Bosch que trae los metadatos ONVIF (el principal; el secundario no los trae). */
const RUTA_METADATOS = "rtsp_tunnel?line=1&inst=1&vcd=2";

const g = globalThis as unknown as { __siluetasFilas?: { n: number } };
const sesiones = (g.__siluetasFilas ||= { n: 0 });

export type ObjetoBosch = { id: string; clase: string; p: number; caja: [number, number, number, number]; poligono: [number, number][] };

const num = (s: string | undefined) => (s == null ? 0 : Number(s));

/** Los objetos del último tt:Frame de un bloque de metadatos. */
function objetosDe(xml: string): ObjetoBosch[] | null {
    const frames = xml.split("<tt:Frame");
    if (frames.length < 2) return null;
    const f = frames[frames.length - 1];
    const out: ObjetoBosch[] = [];
    for (const m of f.matchAll(/<tt:Object ObjectId="([^"]+)">([\s\S]*?)<\/tt:Object>/g)) {
        const cuerpo = m[2];
        const bb = cuerpo.match(/<tt:BoundingBox([^>]*)>/)?.[1] || "";
        const a = (k: string) => num(bb.match(new RegExp(`${k}="(-?[\\d.]+)"`))?.[1]);
        const pol = [...(cuerpo.match(/<tt:Polygon>([\s\S]*?)<\/tt:Polygon>/)?.[1] || "").matchAll(/<tt:Point x="(-?[\d.]+)" y="(-?[\d.]+)"/g)].map((q) => [Number(q[1]), Number(q[2])] as [number, number]);
        const tipo = cuerpo.match(/<tt:Type[^>]*Likelihood="([\d.]+)"[^>]*>([^<]+)</);
        out.push({ id: m[1], clase: tipo?.[2] || cuerpo.match(/<tt:Type>([^<]+)</)?.[1] || "Objeto", p: tipo ? Number(tipo[1]) : 0, caja: [a("left"), a("top"), a("right"), a("bottom")], poligono: pol });
    }
    return out;
}

export async function GET(req: NextRequest) {
    if (!(await getSession())) return NextResponse.json({ error: "Necesitás iniciar sesión" }, { status: 401 });
    const id = req.nextUrl.searchParams.get("device") || "";
    const dev = await prisma.device.findFirst({ where: { id, deviceType: "QUEUE_COUNTER" }, select: { ip: true, username: true, password: true } });
    if (!dev?.ip) return NextResponse.json({ error: "No existe ese contador de fila" }, { status: 404 });
    if (sesiones.n >= SESIONES_MAX) {
        return new Response(`event: ocupado\ndata: ${JSON.stringify({ max: SESIONES_MAX })}\n\n`, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-store" } });
    }
    sesiones.n++;
    const cred = dev.username ? `${encodeURIComponent(dev.username)}:${encodeURIComponent(dev.password || "")}@` : "";
    const ff = spawn("ffmpeg", ["-v", "error", "-rtsp_transport", "tcp",
        "-i", `rtsp://${cred}${dev.ip}/${RUTA_METADATOS}`, "-map", "0:d", "-c", "copy", "-f", "data", "-"], { stdio: ["ignore", "pipe", "ignore"] });

    let cerrado = false, liberado = false;
    const liberar = () => { if (!liberado) { liberado = true; sesiones.n = Math.max(0, sesiones.n - 1); } };
    const enc = new TextEncoder();
    const stream = new ReadableStream({
        start(ctrl) {
            let buf = "";
            let ultimo = 0;
            const mandar = (ev: string, data: unknown) => { if (!cerrado) try { ctrl.enqueue(enc.encode(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`)); } catch { /* cerrado */ } };
            const cerrar = () => {
                if (cerrado) return; cerrado = true; liberar();
                try { ff.kill("SIGKILL"); } catch { /* ya terminó */ }
                try { ctrl.close(); } catch { /* ya cerrado */ }
            };
            const tope = setTimeout(cerrar, SESION_MAX_MS);
            ff.stdout.on("data", (c: Buffer) => {
                buf += c.toString("utf8");
                const fin = buf.lastIndexOf("</tt:MetadataStream>");
                if (fin < 0) { if (buf.length > 1_000_000) buf = ""; return; }
                const bloque = buf.slice(0, fin);
                buf = buf.slice(fin + "</tt:MetadataStream>".length);
                const ahora = Date.now();
                if (ahora - ultimo < 1000 / ENVIOS_POR_SEG) return;
                // Sólo bloques con objetos (los eventos de alarma vienen en bloques aparte).
                const ultimoFrame = bloque.lastIndexOf("<tt:VideoAnalytics");
                if (ultimoFrame < 0) return;
                const objs = objetosDe(bloque.slice(ultimoFrame));
                if (!objs) return;
                ultimo = ahora;
                mandar("objetos", { t: ahora, objetos: objs });
            });
            ff.on("close", () => { clearTimeout(tope); mandar("fin", { motivo: "la cámara cortó" }); cerrar(); });
            req.signal.addEventListener("abort", () => { clearTimeout(tope); cerrar(); });
            mandar("hola", { max: SESIONES_MAX });
        },
        cancel() { cerrado = true; liberar(); try { ff.kill("SIGKILL"); } catch { /* */ } },
    });
    return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-store", "X-Accel-Buffering": "no" } });
}
