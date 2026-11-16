import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { DeleteObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { avisarPorSocket } from "@/lib/avisar";
import { getS3Client, uploadToS3 } from "@/lib/s3";
import { clipDeTramos, DIR_CLIPS, type AvanceDeClip, type TramoGrabado } from "@/lib/clip-instante";

/**
 * Los clips de «Grabar» como tareas del servidor.
 *
 * Por qué (14/11, Nico: «Armando el clip desde la grabación debe ser más tipo wizard animado, que
 * debe seguir funcionando a pesar de cerrar la pestaña, tipo encolar la tarea en el servidor…
 * siempre con el foco de ser un VMS profesional»). Hasta ese día el clip lo armaba el pedido del
 * navegador: quien grababa quedaba mirando un cartel hasta dos minutos, y si cerraba la pestaña o
 * la ficha el clip se perdía. Y el pedido tenía un tope: el 14/11 a las 20:02 un clip de tres
 * cámaras falló porque el grabador tardó más de 90 s en tener lo último (ver EDAD_DEL_FIN_SEG).
 *
 * Ahora «Grabar» deja una fila (ClipGrabado) y contesta al instante. El clip se arma acá, sin
 * nadie esperando, con cinco minutos de paciencia con el grabador; la fila cuenta por dónde va
 * (para la bandeja) y, al terminar, dónde quedó. Los tramos van con su hora absoluta, así que una
 * tarea que quedó a medias por un reinicio se puede rehacer: `retomarColgados`.
 *
 * Dentro del proceso de la web y no en un worker aparte: el corte y la edición ya viven acá
 * (lib/clip-instante) y son TypeScript; un worker nuevo era otro proceso que vigilar para algo
 * que pasa unas pocas veces por día. De a uno por vez: cada corte es un ffmpeg contra el grabador.
 */

/** Sin latido en este tiempo, la tarea se da por colgada (el proceso que la armaba ya no está). */
const COLGADA_MS = 45_000;
const LATIDO_MS = 10_000;
/** Cuántas veces se intenta una tarea antes de darla por fallida. */
const INTENTOS_MAX = 3;
/** La bandeja muestra lo de estas horas. */
export const BANDEJA_HORAS = 24;
export const EVENTO_CLIP = "clip_grabado";

export type EstadoClip = "en-cola" | "esperando" | "trayendo" | "uniendo" | "editando" | "guardando" | "listo" | "fallo";
export const TERMINADO: EstadoClip[] = ["listo", "fallo"];

export type ClipEnBandeja = {
    id: string; estado: EstadoClip; avance: { tramo?: number; de?: number; proximo?: number } | null;
    rotulo: string | null; creado: string; terminado: string | null;
    /** De cuándo es lo grabado, cuántas cámaras se pidieron y cuántos segundos. */
    desde: number; pedidas: number; pedidos: number;
    nombre: string | null; url: string | null; guardado: string | null; foto: string | null;
    segundos: number | null; camaras: number | null; salteados: number | null; motivo: string | null;
};

type Fila = Prisma.ClipGrabadoGetPayload<object>;
const tramosDe = (f: Fila): TramoGrabado[] => (Array.isArray(f.tramos) ? (f.tramos as unknown as TramoGrabado[]) : []);

export function paraBandeja(f: Fila): ClipEnBandeja {
    const t = tramosDe(f);
    return {
        id: f.id, estado: f.estado as EstadoClip, avance: (f.avance as ClipEnBandeja["avance"]) || null, rotulo: f.rotulo,
        creado: f.creado.toISOString(), terminado: f.terminado?.toISOString() || null,
        desde: t[0]?.desde || f.creado.getTime(), pedidas: t.length, pedidos: Math.round(t.reduce((s, x) => s + (x.hasta - x.desde), 0) / 1000),
        nombre: f.nombre, url: f.nombre ? `/api/clip/${f.nombre}` : null, guardado: f.guardado, foto: f.foto,
        segundos: f.segundos, camaras: f.camaras, salteados: f.salteados, motivo: f.motivo,
    };
}

/** A las pantallas de quien lo pidió: cambió algo de este clip (la bandeja vuelve a preguntar). */
const avisar = (f: { id: string; usuarioId: string; estado: string }) => avisarPorSocket(EVENTO_CLIP, { id: f.id, usuarioId: f.usuarioId, estado: f.estado });

/** Un cuadro del clip, como JPEG: la portada con que se comparte y se lista. Null si no se pudo. */
function portada(archivo: string): Promise<Buffer | null> {
    return new Promise((resolve) => {
        const trozos: Buffer[] = [];
        // Pasada la apertura (2,6 s): la portada es la cámara, no el logo.
        const ff = spawn("ffmpeg", ["-loglevel", "error", "-ss", "3.4", "-i", archivo, "-frames:v", "1", "-q:v", "4", "-f", "image2pipe", "-vcodec", "mjpeg", "pipe:1"], { stdio: ["ignore", "pipe", "ignore"] });
        const tope = setTimeout(() => { try { ff.kill("SIGKILL"); } catch { /* ya terminó */ } resolve(null); }, 15_000);
        ff.stdout.on("data", (d: Buffer) => trozos.push(d));
        ff.on("close", () => { clearTimeout(tope); const b = Buffer.concat(trozos); resolve(b.length > 1000 ? b : null); });
        ff.on("error", () => { clearTimeout(tope); resolve(null); });
    });
}

/** De a una por vez en este proceso: la cola es una cadena de promesas. */
let cola: Promise<unknown> = Promise.resolve();
const enEsteProceso = new Set<string>();

/** Deja el pedido en la cola y lo empieza a armar. Contesta enseguida. */
export async function encolarClip(quien: { id: string; nombre: string | null }, tramos: TramoGrabado[], rotulo: string | null): Promise<ClipEnBandeja> {
    const f = await prisma.clipGrabado.create({ data: { usuarioId: quien.id, usuario: quien.nombre, tramos: tramos as unknown as Prisma.InputJsonValue, rotulo } });
    arrancar(f.id);
    return paraBandeja(f);
}

function arrancar(id: string) {
    if (enEsteProceso.has(id)) return;
    enEsteProceso.add(id);
    cola = cola.then(() => armar(id)).catch((e) => console.error(`[clips] ${id}: ${e?.message || e}`)).finally(() => enEsteProceso.delete(id));
}

async function armar(id: string) {
    const f = await prisma.clipGrabado.findUnique({ where: { id } });
    if (!f || TERMINADO.includes(f.estado as EstadoClip)) return;
    if (f.intentos >= INTENTOS_MAX) { await terminar(f, { estado: "fallo", motivo: "Se interrumpió varias veces mientras se armaba. Pedilo de nuevo." }); return; }
    await prisma.clipGrabado.update({ where: { id }, data: { intentos: { increment: 1 }, latido: new Date(), estado: f.estado === "en-cola" ? "esperando" : f.estado } });
    const latido = setInterval(() => { prisma.clipGrabado.update({ where: { id }, data: { latido: new Date() } }).catch(() => { }); }, LATIDO_MS);
    let ultimo = "";
    const alAvance = (a: AvanceDeClip) => {
        const clave = `${a.paso}|${a.tramo}|${a.proximo}`;
        if (clave === ultimo) return;
        ultimo = clave;
        prisma.clipGrabado.update({ where: { id }, data: { estado: a.paso, avance: { tramo: a.tramo, de: a.de, proximo: a.proximo }, latido: new Date() } })
            .then(() => avisar({ id, usuarioId: f.usuarioId, estado: a.paso })).catch(() => { });
    };
    try {
        const tramos = tramosDe(f);
        const r = await clipDeTramos(tramos, f.rotulo, alAvance);
        if (!r.ok) { console.warn(`[clip/grabar] ${f.usuario || f.usuarioId} no obtuvo el clip: ${r.motivo}`); await terminar(f, { estado: "fallo", motivo: r.motivo }); return; }
        await prisma.clipGrabado.update({ where: { id }, data: { estado: "guardando", avance: Prisma.DbNull, latido: new Date() } }).catch(() => { });
        avisar({ id, usuarioId: f.usuarioId, estado: "guardando" });
        // Al almacén: el clip y su portada. Si el depósito falla, el clip igual se puede bajar y mandar
        // durante unos minutos, y se dice que no quedó guardado.
        const { guardado, foto } = await alAlmacen(r.archivo, r.nombre, tramos[0]?.desde || Date.now());
        const pedidos = Math.round(tramos.reduce((s, x) => s + (x.hasta - x.desde), 0) / 1000);
        console.log(`[clip/grabar] ${f.usuario || f.usuarioId} grabó ${pedidos} s en ${r.tramos ?? 1} ${(r.tramos ?? 1) === 1 ? "cámara" : "cámaras"} (${r.fuente}, ${Math.round(r.bytes / 1024)} KB)${guardado ? "" : " · SIN guardar en el almacén"}`);
        await terminar(f, { estado: "listo", nombre: r.nombre, guardado, foto, segundos: Math.round(r.segundos ?? pedidos), camaras: r.tramos ?? 1, salteados: r.salteados ?? 0 });
    } catch (e) {
        console.error(`[clip/grabar] falló al armarlo: ${(e as Error)?.message || e}`);
        await terminar(f, { estado: "fallo", motivo: "Falló al armarlo. Pedilo de nuevo." });
    } finally { clearInterval(latido); }
}

async function terminar(f: Fila, datos: Partial<Pick<Fila, "estado" | "motivo" | "nombre" | "guardado" | "foto" | "segundos" | "camaras" | "salteados">>) {
    await prisma.clipGrabado.update({ where: { id: f.id }, data: { ...datos, avance: Prisma.DbNull, terminado: new Date(), latido: null } }).catch((e) => console.error(`[clips] no se pudo cerrar ${f.id}: ${e?.message || e}`));
    avisar({ id: f.id, usuarioId: f.usuarioId, estado: String(datos.estado) });
}

/**
 * Las tareas que quedaron a medias porque el proceso que las armaba se fue (un despliegue, un
 * reinicio): se retoman acá. Lo llama la bandeja cada vez que pregunta, así que no hace falta un
 * reloj propio: si nadie mira la bandeja, nadie espera ese clip todavía.
 */
export async function retomarColgados(): Promise<void> {
    const viejo = new Date(Date.now() - COLGADA_MS);
    const filas = await prisma.clipGrabado.findMany({
        where: { estado: { notIn: TERMINADO }, creado: { gte: new Date(Date.now() - BANDEJA_HORAS * 3600_000) }, OR: [{ latido: null }, { latido: { lt: viejo } }] },
        select: { id: true }, take: 10, orderBy: { creado: "asc" },
    }).catch(() => []);
    for (const f of filas) arrancar(f.id);
}

/** La bandeja de alguien: sus clips de las últimas horas, lo más nuevo primero. */
export async function bandejaDe(usuarioId: string): Promise<ClipEnBandeja[]> {
    const filas = await prisma.clipGrabado.findMany({ where: { usuarioId, oculto: false, creado: { gte: new Date(Date.now() - BANDEJA_HORAS * 3600_000) } }, orderBy: { creado: "desc" }, take: 20 });
    return filas.map(paraBandeja);
}

/** Sacarlo de la bandeja (el clip sigue en el almacén). False si no es de quien lo pide. */
export async function quitarDeBandeja(usuarioId: string, id: string): Promise<boolean> {
    const r = await prisma.clipGrabado.updateMany({ where: { id, usuarioId }, data: { oculto: true } });
    return r.count > 0;
}

/** Volver a intentar uno que falló: la misma fila, de cero. */
export async function reintentar(usuarioId: string, id: string): Promise<ClipEnBandeja | null> {
    const r = await prisma.clipGrabado.updateMany({ where: { id, usuarioId, estado: "fallo" }, data: { estado: "en-cola", motivo: null, intentos: 0, terminado: null, latido: null } });
    if (!r.count) return null;
    arrancar(id);
    const f = await prisma.clipGrabado.findUnique({ where: { id } });
    return f ? paraBandeja(f) : null;
}

/**
 * Que el archivo del clip esté en la carpeta de clips, para mandarlo: ahí vive unos minutos y el
 * envío (dispatch-worker) lo toma de ahí. Si ya se borró, se baja del almacén. Devuelve el nombre.
 */
/**
 * Un clip y su portada, al almacén (clips/<mes>/). Lo usa la cola de Grabar y, desde el 16/11, los
 * clips que se mandan por WhatsApp o Telegram: antes vivían diez minutos en una carpeta temporal
 * y de la evidencia quedaba sólo el renglón en Despachos. Nunca tira: sin almacén, devuelve null
 * y el que llama lo dice.
 */
export async function alAlmacen(archivo: string, nombre: string, instanteMs: number): Promise<{ guardado: string | null; foto: string | null }> {
    const mes = new Date(instanteMs || Date.now()).toISOString().slice(0, 7);
    let guardado: string | null = null, foto: string | null = null;
    try { guardado = await uploadToS3(fs.readFileSync(archivo), `clips/${mes}/${nombre}`, "video/mp4", "lpr"); }
    catch (e) { console.error(`[clip] no se pudo guardar ${nombre} en el almacén: ${(e as Error)?.message || e}`); }
    if (guardado) {
        const jpg = await portada(archivo);
        if (jpg) { try { foto = await uploadToS3(jpg, `clips/${mes}/${nombre.replace(/\.mp4$/, ".jpg")}`, "image/jpeg", "lpr"); } catch { /* sin portada: se ve igual, sin foto */ } }
    }
    return { guardado, foto };
}

/** `usuarioId` null: cualquiera con permiso de video (la pantalla de Evidencias); con id, sólo los suyos (la bandeja). */
export async function prepararParaEnviar(usuarioId: string | null, id: string): Promise<{ ok: true; nombre: string } | { ok: false; motivo: string }> {
    const f = await prisma.clipGrabado.findFirst({ where: { id, ...(usuarioId ? { usuarioId } : {}), estado: "listo" } });
    if (!f?.nombre) return { ok: false, motivo: "Ese clip no está listo." };
    return traerDelAlmacen(f.guardado, f.nombre);
}

/**
 * Deja un clip guardado otra vez a mano en la carpeta de clips (vive minutos), para mandarlo: lo
 * que WhatsApp y Telegram bajan es ese archivo. Sirve para un clip grabado y para uno que se mandó
 * y quedó guardado (Evidencias › Reenviar).
 */
export async function traerDelAlmacen(guardado: string | null, nombreCrudo: string): Promise<{ ok: true; nombre: string } | { ok: false; motivo: string }> {
    const nombre = path.basename(nombreCrudo);
    if (!/^[\w.\-]{1,200}\.mp4$/.test(nombre)) return { ok: false, motivo: "Ese archivo no es un clip." };
    const destino = path.join(DIR_CLIPS, nombre);
    try { if (fs.statSync(destino).size > 1500) { const ahora = new Date(); fs.utimesSync(destino, ahora, ahora); return { ok: true, nombre }; } } catch { /* no está: se baja */ }
    const m = /^\/api\/files\/([^/]+)\/(.+)$/.exec(guardado || "");
    if (!m) return { ok: false, motivo: "El clip ya no está en el servidor y no quedó guardado en el almacén." };
    try {
        const s3 = await getS3Client();
        const o = await s3.send(new GetObjectCommand({ Bucket: m[1], Key: decodeURIComponent(m[2]) }));
        const bytes = Buffer.from(await (o.Body as { transformToByteArray: () => Promise<Uint8Array> }).transformToByteArray());
        fs.mkdirSync(DIR_CLIPS, { recursive: true });
        fs.writeFileSync(destino, bytes);
        return { ok: true, nombre };
    } catch (e) {
        console.error(`[clips] no se pudo traer ${nombre} del almacén: ${(e as Error)?.message || e}`);
        return { ok: false, motivo: "No se pudo traer el clip del almacén." };
    }
}

/** Saca del almacén un archivo guardado con `uploadToS3` (su URL /api/files/<depósito>/<clave>). No tira: dice si pudo. */
export async function quitarDelAlmacen(url: string | null | undefined): Promise<boolean> {
    const m = /^\/api\/files\/([^/]+)\/(.+)$/.exec(url || "");
    if (!m) return false;
    try { const s3 = await getS3Client(); await s3.send(new DeleteObjectCommand({ Bucket: m[1], Key: decodeURIComponent(m[2]) })); return true; }
    catch (e) { console.error(`[clips] no se pudo quitar ${m[2]} del almacén: ${(e as Error)?.message || e}`); return false; }
}
