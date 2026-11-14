/**
 * POST /api/clip/grabar { tramos: [{ deviceId?, nvrId?, ch?, desde, hasta }], rotulo? }
 *   (o un solo tramo suelto: { deviceId?, nvrId?, ch?, desde, hasta })
 *
 * El botón «Grabar» del vivo (13/11, Nico: «comenzar un fragmento de video de lo que está viendo,
 * y OmniAccess depositarlo a MinIO y poder descargarlo o enviarlo por Telegram o WhatsApp como el
 * resto de clips»).
 *
 * NO graba el vivo del navegador. El botón marca un inicio y un fin, y el clip se corta de la
 * GRABACIÓN del NVR (o del anillo local): es la imagen original, no una copia recomprimida de lo
 * que llegó a la pantalla, y usa el mismo camino que los demás clips (lib/clip-instante: nombre,
 * calidad, logo e intro según Ajustes). Tope: ENVIO_MAX_SEG, el mismo de un clip que se manda a
 * mano — el grabador entrega a tiempo real y quien grabó está esperando. Si mientras grababa se
 * cambió de cámara, cada cámara es un tramo y el clip los une en orden (lib/clip-instante → clipDeTramos).
 *
 * Queda en dos lugares: en la carpeta de clips (minutos; de ahí lo toma el envío por WhatsApp o
 * Telegram) y en MinIO, con un cuadro de portada, para bajarlo después.
 *
 * Vive bajo /api/clip/, que el middleware deja pasar sin sesión para que WhatsApp baje los
 * archivos: por eso la sesión y el permiso se verifican acá.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

import fs from "fs";
import { spawn } from "child_process";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/app/actions/auth";
import { permisosDeSesion } from "@/lib/permisos";
import { clipDeTramos, PERMISOS_VIDEO, TRAMOS_MAX, type TramoGrabado } from "@/lib/clip-instante";
import { ENVIO_MAX_SEG } from "@/lib/clips";
import { uploadToS3 } from "@/lib/s3";

/** Menos que esto no es una grabación: es un doble clic. */
const MINIMO_SEG = 2;

/** Un cuadro del clip, como JPEG: la portada con que se comparte y se lista. Null si no se pudo. */
function portada(archivo: string): Promise<Buffer | null> {
    return new Promise((resolve) => {
        const trozos: Buffer[] = [];
        const ff = spawn("ffmpeg", ["-loglevel", "error", "-ss", "1", "-i", archivo, "-frames:v", "1", "-q:v", "4", "-f", "image2pipe", "-vcodec", "mjpeg", "pipe:1"], { stdio: ["ignore", "pipe", "ignore"] });
        const tope = setTimeout(() => { try { ff.kill("SIGKILL"); } catch { /* ya terminó */ } resolve(null); }, 15_000);
        ff.stdout.on("data", (d: Buffer) => trozos.push(d));
        ff.on("close", () => { clearTimeout(tope); const b = Buffer.concat(trozos); resolve(b.length > 1000 ? b : null); });
        ff.on("error", () => { clearTimeout(tope); resolve(null); });
    });
}

export async function POST(req: NextRequest) {
    const s: any = await getSession().catch(() => null);
    if (!s) return NextResponse.json({ ok: false, motivo: "Hace falta iniciar sesión." }, { status: 401 });
    if (!PERMISOS_VIDEO.some((p) => permisosDeSesion(s).includes(p))) return NextResponse.json({ ok: false, motivo: "Tu rol no puede sacar clips de las grabaciones." }, { status: 403 });

    const b: any = await req.json().catch(() => ({}));
    // Una grabación es una lista de tramos (uno por cámara por la que se pasó); un pedido suelto es un tramo.
    const crudos: any[] = Array.isArray(b?.tramos) ? b.tramos.slice(0, TRAMOS_MAX) : [b];
    const tramos: TramoGrabado[] = [];
    for (const t of crudos) {
        const desde = Number(t?.desde), hasta = Number(t?.hasta);
        const deviceId = typeof t?.deviceId === "string" ? t.deviceId.slice(0, 64) : "";
        const nvrId = typeof t?.nvrId === "string" && t.nvrId.length <= 64 ? t.nvrId : null;
        const ch = Number.isInteger(t?.ch) && t.ch > 0 && t.ch < 1000 ? t.ch : null;
        if (!Number.isFinite(desde) || !Number.isFinite(hasta) || hasta <= desde) continue;
        if (!deviceId && !(nvrId && ch)) continue;
        if (hasta > Date.now() + 5000) return NextResponse.json({ ok: false, motivo: "Ese tramo todavía no pasó." }, { status: 400 });
        tramos.push({ deviceId, nvrId, ch, desde, hasta });
    }
    if (!tramos.length) return NextResponse.json({ ok: false, motivo: "Falta la cámara, o desde cuándo y hasta cuándo." }, { status: 400 });
    tramos.sort((x, y) => x.desde - y.desde);
    const pedidos = tramos.reduce((x, t) => x + (t.hasta - t.desde) / 1000, 0);
    if (pedidos < MINIMO_SEG) return NextResponse.json({ ok: false, motivo: "La grabación es demasiado corta." }, { status: 400 });
    const desde = tramos[0].desde;
    const deviceId = tramos[0].deviceId || "", nvrId = tramos[0].nvrId, ch = tramos[0].ch;
    const segundos = Math.min(ENVIO_MAX_SEG, Math.round(pedidos));

    const rotulo = typeof b?.rotulo === "string" ? b.rotulo.slice(0, 80) : null;
    return conLatido(() => armar(tramos, rotulo, { desde, deviceId, nvrId, ch, segundos, quien: s?.name || s?.sub || "?" }));
}

/** Cada cuánto se manda un espacio mientras se arma el clip. */
const LATIDO_MS = 15_000;

/**
 * Contesta de a poco: un espacio cada LATIDO_MS y, al final, el JSON de siempre.
 *
 * Por qué (14/11). Armar el clip puede llevar más de dos minutos: se espera a que el grabador
 * tenga lo último (ver EDAD_DEL_FIN_SEG en lib/clip-instante) y después entrega a tiempo real. Un
 * pedido que no manda un solo byte en todo ese tiempo lo corta el proxy que publica el sitio
 * (nginx espera 60 s entre lecturas, salvo que se le diga otra cosa), y quien grabó vería un error
 * con el clip a medio armar. Los espacios adelante de un JSON no lo cambian: `r.json()` los ignora.
 * `no-transform` es para que nadie en el camino los junte para comprimirlos.
 */
function conLatido(trabajo: () => Promise<object>): Response {
    const cod = new TextEncoder();
    const cuerpo = new ReadableStream<Uint8Array>({
        start(ctl) {
            const latido = setInterval(() => { try { ctl.enqueue(cod.encode(" ")); } catch { /* ya se cerró */ } }, LATIDO_MS);
            trabajo()
                .catch((e: any) => { console.error(`[clip/grabar] falló: ${e?.message || e}`); return { ok: false, motivo: "falló al armarlo" }; })
                .then((j) => { clearInterval(latido); try { ctl.enqueue(cod.encode(JSON.stringify(j))); ctl.close(); } catch { /* quien pidió ya se fue */ } });
        },
    });
    return new Response(cuerpo, { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store, no-transform", "x-accel-buffering": "no" } });
}

async function armar(tramos: TramoGrabado[], rotulo: string | null, d: { desde: number; deviceId: string; nvrId: string | null | undefined; ch: number | null | undefined; segundos: number; quien: string }): Promise<object> {
    const { desde, deviceId, nvrId, ch, segundos } = d;
    const r = await clipDeTramos(tramos, rotulo);
    if (!r.ok) { console.warn(`[clip/grabar] ${d.quien} no obtuvo el clip de ${deviceId || `${nvrId}/${ch}`}: ${r.motivo}`); return { ok: false, motivo: r.motivo }; }

    // A MinIO: el clip y su portada. Si el depósito falla, el clip igual se puede bajar y mandar
    // durante unos minutos, y se dice que no quedó guardado.
    const mes = new Date(desde).toISOString().slice(0, 7);
    let guardado: string | null = null, foto: string | null = null;
    try { guardado = await uploadToS3(fs.readFileSync(r.archivo), `clips/${mes}/${r.nombre}`, "video/mp4", "lpr"); }
    catch (e: any) { console.error(`[clip/grabar] no se pudo guardar ${r.nombre} en el almacén: ${e?.message || e}`); }
    const jpg = await portada(r.archivo);
    if (jpg) { try { foto = await uploadToS3(jpg, `clips/${mes}/${r.nombre.replace(/\.mp4$/, ".jpg")}`, "image/jpeg", "lpr"); } catch { /* sin portada: se comparte igual, sin foto */ } }
    console.log(`[clip/grabar] ${d.quien} grabó ${segundos} s de ${deviceId || `${nvrId}/${ch}`} (${r.fuente}, ${Math.round(r.bytes / 1024)} KB)${guardado ? "" : " · SIN guardar en el almacén"}`);
    return { ok: true, nombre: r.nombre, url: r.url, guardado, foto, segundos: r.segundos ?? segundos, bytes: r.bytes, fuente: r.fuente, editado: !!r.editado, camaras: r.tramos ?? 1, salteados: r.salteados ?? 0 };
}
