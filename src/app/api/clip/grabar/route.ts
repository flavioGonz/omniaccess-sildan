/**
 * POST /api/clip/grabar { deviceId?, nvrId?, ch?, desde, hasta }
 *
 * El botón «Grabar» del vivo (13/11, Nico: «comenzar un fragmento de video de lo que está viendo,
 * y OmniAccess depositarlo a MinIO y poder descargarlo o enviarlo por Telegram o WhatsApp como el
 * resto de clips»).
 *
 * NO graba el vivo del navegador. El botón marca un inicio y un fin, y el clip se corta de la
 * GRABACIÓN del NVR (o del anillo local): es la imagen original, no una copia recomprimida de lo
 * que llegó a la pantalla, y usa el mismo camino que los demás clips (lib/clip-instante: nombre,
 * calidad, logo e intro según Ajustes). Tope: ENVIO_MAX_SEG, el mismo de un clip que se manda a
 * mano — el grabador entrega a tiempo real y quien grabó está esperando.
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
import { clipDeInstante, PERMISOS_VIDEO } from "@/lib/clip-instante";
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
    const desde = Number(b?.desde), hasta = Number(b?.hasta);
    const deviceId = typeof b?.deviceId === "string" ? b.deviceId.slice(0, 64) : "";
    const nvrId = typeof b?.nvrId === "string" && b.nvrId.length <= 64 ? b.nvrId : null;
    const ch = Number.isInteger(b?.ch) && b.ch > 0 && b.ch < 1000 ? b.ch : null;
    if (!Number.isFinite(desde) || !Number.isFinite(hasta) || hasta <= desde) return NextResponse.json({ ok: false, motivo: "Falta desde cuándo y hasta cuándo." }, { status: 400 });
    if (!deviceId && !(nvrId && ch)) return NextResponse.json({ ok: false, motivo: "Falta la cámara." }, { status: 400 });
    if (hasta > Date.now() + 5000) return NextResponse.json({ ok: false, motivo: "Ese tramo todavía no pasó." }, { status: 400 });
    const segundos = Math.min(ENVIO_MAX_SEG, Math.max(MINIMO_SEG, Math.round((hasta - desde) / 1000)));

    const r = await clipDeInstante({ deviceId, instante: desde, antes: 0, despues: segundos, para: "envio", nvrId, ch });
    if (!r.ok) return NextResponse.json({ ok: false, motivo: r.motivo });

    // A MinIO: el clip y su portada. Si el depósito falla, el clip igual se puede bajar y mandar
    // durante unos minutos, y se dice que no quedó guardado.
    const mes = new Date(desde).toISOString().slice(0, 7);
    let guardado: string | null = null, foto: string | null = null;
    try { guardado = await uploadToS3(fs.readFileSync(r.archivo), `clips/${mes}/${r.nombre}`, "video/mp4", "lpr"); }
    catch (e: any) { console.error(`[clip/grabar] no se pudo guardar ${r.nombre} en el almacén: ${e?.message || e}`); }
    const jpg = await portada(r.archivo);
    if (jpg) { try { foto = await uploadToS3(jpg, `clips/${mes}/${r.nombre.replace(/\.mp4$/, ".jpg")}`, "image/jpeg", "lpr"); } catch { /* sin portada: se comparte igual, sin foto */ } }
    console.log(`[clip/grabar] ${s?.name || s?.sub || "?"} grabó ${segundos} s de ${deviceId || `${nvrId}/${ch}`} (${r.fuente}, ${Math.round(r.bytes / 1024)} KB)${guardado ? "" : " · SIN guardar en el almacén"}`);
    return NextResponse.json({ ok: true, nombre: r.nombre, url: r.url, guardado, foto, segundos: r.segundos ?? segundos, bytes: r.bytes, fuente: r.fuente, editado: !!r.editado });
}
