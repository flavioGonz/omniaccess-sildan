export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { spawn } from "child_process";
import { NextRequest, NextResponse } from "next/server";
import { autorizarMonitor } from "@/lib/monitor/servidor";
import { prisma } from "@/lib/prisma";
import { GRUPO_PROPIO, UMBRAL_PANTALLA_DEFECTO } from "@/lib/detector-propio";
import { conChapa, conEstadia, type EstadiaAbierta, type LugarVehiculo } from "@/lib/vision-estadia";
import { leerRecuadro } from "@/lib/deteccion";

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
 *
 * 13/11 (Nico: «lo veo aún un poco lento cuadro a cuadro el seguimiento de siluetas»). Medido en el
 * lab sobre «03 - Entrada Proveedores 2» de Otto, con 8 vehículos en escena:
 *  · El «subflujo» de ese canal no es de 640×360: es de 2688×1520. Cada cuadro salía como un JPEG
 *    de 726 KB y omni-vision tardaba 75–80 ms en contestarlo. Achicado a 960 px de ancho antes de
 *    mandarlo pesa 106 KB y tarda 34 ms, con las mismas siluetas (el modelo mira a menos que eso).
 *  · Con eso entran 8 a 10 cuadros por segundo donde antes entraban 3. El ritmo ya no es fijo:
 *    se pide el cuadro siguiente recién cuando pasó ESPERA_POR_MS veces lo que tardó el anterior,
 *    así una sesión nunca ocupa más de un tercio del tiempo de omni-vision. En una GPU más lenta,
 *    o con omni-vision ocupado, baja sola (a 100 ms por cuadro vuelve a los 3 por segundo de antes).
 */

const VISION = (process.env.OMNI_VISION_URL || "http://127.0.0.1:8010").replace(/\/$/, "");
/** El RTSP de go2rtc (en el mismo CT). */
const GO2RTC_RTSP = process.env.GO2RTC_RTSP || "rtsp://127.0.0.1:8554";
/** Lo máximo que se analiza por segundo. El ritmo real lo pone lo que tarda omni-vision (ESPERA_POR_MS). */
const CUADROS_POR_SEG = 10;
/** El cuadro siguiente se toma cuando pasó esto por lo que tardó el anterior: 3 = a lo sumo un tercio del tiempo de omni-vision. */
const ESPERA_POR_MS = 3;
/** Ancho al que se achica el cuadro antes de analizarlo (nunca se agranda). */
const ANCHO_ANALISIS = 960;
const SESIONES_MAX = 2;
const SESION_MAX_MS = 10 * 60_000;
/**
 * «propio»: lo que encuentra el detector entrenado en OmniVision › Entrenar › Objetos nuevos
 * (basurero, cono…), cuando hay uno activo. Antes se pedían sólo los tres grupos de fábrica y lo
 * entrenado quedaba afuera aunque omni-vision lo estuviera viendo (15/10, Nico: «¿no debería
 * detectar también mis entrenamientos?»). Sale como caja (el detector propio no segmenta).
 */
const GRUPOS = "persona,vehiculo,animal,propio";
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

/**
 * Lo que cada clase entrenada tiene configurado para la pantalla: desde qué confianza se dibuja y
 * con qué ícono. Se lee de la base a lo sumo cada AJUSTES_MS (el vivo manda tres cuadros por
 * segundo): un cambio en Entrenar › Objetos se ve en el vivo en ese tiempo, sin volver a abrirlo.
 */
type AjustePantalla = { umbral: number; icono: string | null };
const AJUSTES_MS = 15_000;
const PREFIJO_PROPIO = "propio:";
let ajustes: { al: number; porClase: Map<string, AjustePantalla> } = { al: 0, porClase: new Map() };
async function ajustesDePantalla(): Promise<Map<string, AjustePantalla>> {
    if (Date.now() - ajustes.al < AJUSTES_MS) return ajustes.porClase;
    try {
        const cs = await prisma.clasePropia.findMany({ select: { id: true, icono: true, umbralPantalla: true } });
        ajustes = { al: Date.now(), porClase: new Map(cs.map((c) => [`${PREFIJO_PROPIO}${c.id}`, { umbral: c.umbralPantalla, icono: c.icono }])) };
    } catch {
        // Sin base un momento: se sigue con lo último que se leyó, y se vuelve a intentar en la próxima.
        ajustes = { ...ajustes, al: Date.now() - AJUSTES_MS + 2000 };
    }
    return ajustes.porClase;
}

/**
 * Los vehículos que están en su lugar y desde cuándo, por cámara: lo publica vision-worker cada
 * 15 s (VISION_LUGARES, ver lib-lugares-vehiculos.js). Se lee a lo sumo cada LUGARES_MS. Es lo que
 * permite escribir «2 h 05» sobre un auto sin pedirle nada a la GPU.
 */
const CLAVE_LUGARES = "VISION_LUGARES";
const LUGARES_MS = 5000;
/** Una publicación más vieja que esto no se usa: el worker está parado y los relojes mentirían. */
const LUGARES_VIEJOS_MS = 3 * 60_000;
let lugares: { al: number; camaras: Record<string, LugarVehiculo[]> } = { al: 0, camaras: {} };
async function lugaresDe(camara: string): Promise<LugarVehiculo[] | undefined> {
    if (Date.now() - lugares.al > LUGARES_MS) {
        try {
            const j = JSON.parse((await prisma.setting.findUnique({ where: { key: CLAVE_LUGARES } }))?.value || "null");
            lugares = { al: Date.now(), camaras: j?.t && Date.now() - Date.parse(j.t) < LUGARES_VIEJOS_MS ? j.camaras || {} : {} };
        } catch { lugares = { al: Date.now(), camaras: {} }; }
    }
    return lugares.camaras[camara];
}
/**
 * Las estadías abiertas de una cámara (PlateSighting ESTACIONADO sin cerrar): la matrícula de cada
 * auto estacionado y dónde quedó su chapa en el cuadro. Las lleva el seguimiento de matrículas;
 * acá sólo se leen, a lo sumo cada ESTADIAS_MS por cámara, mientras alguien mira el vivo.
 */
const ESTADIAS_MS = 5000;
const estadias = new Map<string, { al: number; lista: EstadiaAbierta[] }>();
async function estadiasDe(camara: string): Promise<EstadiaAbierta[]> {
    const e = estadias.get(camara);
    if (e && Date.now() - e.al < ESTADIAS_MS) return e.lista;
    let lista: EstadiaAbierta[] = e?.lista || [];
    try {
        const filas = await prisma.plateSighting.findMany({
            where: { deviceId: camara, estado: "ESTACIONADO", estCerrada: false, bbox: { not: null } },
            select: { plate: true, bbox: true, estDesde: true }, orderBy: { timestamp: "desc" }, take: 30,
        });
        lista = filas.map((f) => ({ plate: f.plate, chapa: leerRecuadro(f.bbox), desde: f.estDesde ? f.estDesde.getTime() : null }))
            .filter((x): x is EstadiaAbierta => !!x.chapa && !!x.plate);
    } catch { /* sin base un momento: lo último que se leyó */ }
    estadias.set(camara, { al: Date.now(), lista });
    if (estadias.size > 200) for (const [k, v] of estadias) if (Date.now() - v.al > 60_000) estadias.delete(k);
    return lista;
}

/** `lpr_<id>` o `face_<id>` → el id de la cámara, que es como la conoce vision-worker. */
const camaraDeStream = (stream: string) => stream.replace(/^(lpr|face)_/, "");

/**
 * Lo que viaja al navegador de lo que vio omni-vision, para el vivo (GET) y la grabación (POST).
 * Lo del detector entrenado acá sólo desde el umbral de pantalla de su clase: se decide cuadro a
 * cuadro, así que el recuadro aparece cuando lo supera y se va cuando baja. Lo de fábrica
 * (personas, vehículos, animales) no cambia: ya sale con el umbral de omni-vision.
 */
function paraPantalla(objetos: any[] | undefined, porClase: Map<string, AjustePantalla>) {
    return (objetos || [])
        .filter((o) => o.grupo !== GRUPO_PROPIO || o.confianza >= (porClase.get(o.clase)?.umbral ?? UMBRAL_PANTALLA_DEFECTO))
        .map((o) => ({
            clase: o.clase, nombre: o.nombre, grupo: o.grupo, confianza: Math.round(o.confianza * 1000) / 1000,
            caja: (o.caja_norm || []).map(r4),
            ...(Array.isArray(o.silueta) ? { silueta: o.silueta.map((q: number[][]) => aligerar(q).map(([x, y]) => [r4(x), r4(y)])) } : {}),
            ...(o.grupo === GRUPO_PROPIO && porClase.get(o.clase)?.icono ? { icono: porClase.get(o.clase)!.icono } : {}),
        }));
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

            // Sin búfer de entrada: lo que se analiza es lo más reciente que entregó la cámara, no lo de hace un rato.
            ff = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-fflags", "nobuffer", "-flags", "low_delay", "-rtsp_transport", "tcp", "-i", `${GO2RTC_RTSP}/${stream}`,
                "-an", "-vf", `fps=${CUADROS_POR_SEG},scale='min(${ANCHO_ANALISIS},iw)':-2`, "-q:v", "5", "-f", "image2pipe", "-c:v", "mjpeg", "pipe:1"], { stdio: ["ignore", "pipe", "ignore"] });
            ff.on("close", cerrar);
            ff.on("error", cerrar);

            let buf = Buffer.alloc(0);
            let ocupado = false;
            let descartados = 0;
            // Cuándo se puede tomar el próximo cuadro (ver ESPERA_POR_MS).
            let proximo = 0;
            const camara = camaraDeStream(stream);
            const analizar = async (jpeg: Buffer, t: number) => {
                ocupado = true;
                try {
                    const r = await fetch(`${VISION}/detectar?tarea=segmentar&grupos=${GRUPOS}`, { method: "POST", body: new Uint8Array(jpeg), headers: { "content-type": "image/jpeg" }, signal: AbortSignal.timeout(5000) });
                    const j: any = await r.json().catch(() => ({}));
                    proximo = t + Math.max(1000 / CUADROS_POR_SEG - 5, (Date.now() - t) * ESPERA_POR_MS);
                    if (!r.ok) { enviar("error", { error: j.error || `omni-vision respondió ${r.status}` }); return; }
                    enviar("cuadro", {
                        t, ms: Date.now() - t, descartados,
                        analisis: {
                            ancho: j.ancho, alto: j.alto, tarea: "segmentar",
                            // El tiempo en el lugar sólo en el vivo: en la grabación el cuadro es de otro momento.
                            objetos: conChapa(conEstadia(paraPantalla(j.objetos, await ajustesDePantalla()), await lugaresDe(camara)), await estadiasDe(camara)),
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
                    if (ocupado || Date.now() < proximo) { descartados++; continue; }
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

/**
 * POST /api/monitor/camaras/siluetas (cuerpo image/jpeg) → lo que OmniVision ve en ESE cuadro.
 *
 * Para la grabación (pedido 15/10: «en playback, ¿no podemos tener detecciones sin perder
 * rendimiento?»). El navegador ya está decodificando la grabación para mostrarla: saca el cuadro
 * que tiene en pantalla, lo achica a 640 px y lo manda. El servidor no decodifica nada (otra
 * sesión de playback contra el NVR y un H.265 de 1080p por CPU serían lo caro); sólo pone los
 * ~40 ms de la GPU. Y como es el cuadro exacto que se ve, las siluetas caen justo, también en
 * pausa, que es cuando más se mira.
 *
 * Tope global de POST_POR_SEG cuadros por segundo entre todas las pantallas: pasado eso,
 * 429 y la pantalla espera. Cuerpo de a lo sumo POST_MAX_BYTES (un 640 px en JPEG pesa ~60 KB).
 */
const POST_POR_SEG = 6;
const POST_MAX_BYTES = 400 * 1024;
let cubeta = { fichas: POST_POR_SEG, t: Date.now() };

export async function POST(req: NextRequest) {
    const p = await autorizarMonitor("/api/monitor/camaras/siluetas");
    if (p.error) return p.error;
    const ahora = Date.now();
    cubeta = { fichas: Math.min(POST_POR_SEG, cubeta.fichas + ((ahora - cubeta.t) / 1000) * POST_POR_SEG), t: ahora };
    if (cubeta.fichas < 1) return NextResponse.json({ error: "Demasiados cuadros a la vez" }, { status: 429, headers: { "Retry-After": "1" } });
    cubeta.fichas -= 1;
    if (!(req.headers.get("content-type") || "").startsWith("image/jpeg")) return NextResponse.json({ error: "Mandá un JPEG" }, { status: 415 });
    const jpeg = Buffer.from(await req.arrayBuffer());
    if (!jpeg.length || jpeg.length > POST_MAX_BYTES) return NextResponse.json({ error: "Cuadro vacío o demasiado grande" }, { status: 413 });
    try {
        const r = await fetch(`${VISION}/detectar?tarea=segmentar&grupos=${GRUPOS}`, { method: "POST", body: new Uint8Array(jpeg), headers: { "content-type": "image/jpeg" }, signal: AbortSignal.timeout(5000) });
        const j: any = await r.json().catch(() => ({}));
        if (!r.ok) return NextResponse.json({ error: j.error || `omni-vision respondió ${r.status}` }, { status: 502 });
        return NextResponse.json({
            ms: Date.now() - ahora,
            analisis: {
                ancho: j.ancho, alto: j.alto, tarea: "segmentar",
                objetos: paraPantalla(j.objetos, await ajustesDePantalla()),
            },
        }, { headers: { "Cache-Control": "no-store" } });
    } catch (e: any) {
        return NextResponse.json({ error: e?.message || "omni-vision no contestó" }, { status: 502 });
    }
}
