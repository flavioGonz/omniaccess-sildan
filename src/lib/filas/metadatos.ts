import { spawn, type ChildProcess } from "child_process";
import { prisma } from "@/lib/prisma";

/**
 * Lo que la Bosch ve, de forma continua: su flujo de metadatos ONVIF (RTSP `vcd=2`) con cada
 * objeto que sigue. Lo comparten dos cosas (HB, 20/10, Nico: «la silueta debe estar dibujada por
 * nosotros, también en las fotos»):
 *   · las fotos de las lecturas (lib/filas/foto), que guardan las personas de ESE momento para
 *     dibujarlas después sobre la captura;
 *   · las siluetas en vivo (/api/filas/siluetas), que se cuelgan de la misma sesión.
 * Una sola sesión RTSP por cámara, sin importar cuántas pantallas miren: antes cada pantalla abría
 * la suya.
 *
 * La sesión trae también el video (pedir sólo la pista de datos deja a ffmpeg colgado con esta
 * cámara), por la red local, y se descarta: ffmpeg copia, no decodifica, así que no gasta CPU.
 */

export type ObjetoBosch = { id: string; clase: string; p: number; caja: [number, number, number, number]; poligono: [number, number][] };
export type Cuadro = { t: number; objetos: ObjetoBosch[] };

/** El flujo RTSP de la Bosch que trae los metadatos ONVIF (el secundario no los trae: probado). */
const RUTA_METADATOS = "rtsp_tunnel?line=1&inst=1&vcd=2";
/** Si la sesión se corta, se reintenta con espera creciente hasta este tope. */
const REINTENTO_MAX_MS = 60_000;
/** Un cuadro más viejo que esto no describe «ahora» (la foto no lo lleva). */
export const CUADRO_VIGENTE_MS = 2_000;
const FIN = "</tt:MetadataStream>";

type Escucha = (c: Cuadro) => void;
type Sesion = { ff: ChildProcess | null; ultimo: Cuadro | null; escuchas: Set<Escucha>; espera: number; reintento: NodeJS.Timeout | null };

const g = globalThis as unknown as { __metaBosch?: Map<string, Sesion> };
const sesiones: Map<string, Sesion> = (g.__metaBosch ||= new Map());

const num = (s: string | undefined) => (s == null ? 0 : Number(s));
const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** Los objetos del último tt:Frame de un bloque de metadatos, o null si el bloque no trae análisis. */
export function objetosDe(bloque: string): ObjetoBosch[] | null {
    const i = bloque.lastIndexOf("<tt:Frame");
    if (i < 0) return null;
    const f = bloque.slice(i);
    const out: ObjetoBosch[] = [];
    for (const m of f.matchAll(/<tt:Object ObjectId="([^"]+)">([\s\S]*?)<\/tt:Object>/g)) {
        const cuerpo = m[2];
        const bb = cuerpo.match(/<tt:BoundingBox([^>]*)>/)?.[1] || "";
        const a = (k: string) => r3(num(bb.match(new RegExp(`${k}="(-?[\\d.]+)"`))?.[1]));
        const pol = [...(cuerpo.match(/<tt:Polygon>([\s\S]*?)<\/tt:Polygon>/)?.[1] || "").matchAll(/<tt:Point x="(-?[\d.]+)" y="(-?[\d.]+)"/g)].map((q) => [r3(Number(q[1])), r3(Number(q[2]))] as [number, number]);
        const tipo = cuerpo.match(/<tt:Type[^>]*Likelihood="([\d.]+)"[^>]*>([^<]+)</);
        out.push({ id: m[1], clase: tipo?.[2] || cuerpo.match(/<tt:Type>([^<]+)</)?.[1] || "Objeto", p: tipo ? Number(tipo[1]) : 0, caja: [a("left"), a("top"), a("right"), a("bottom")], poligono: pol });
    }
    return out;
}

async function arrancar(deviceId: string, s: Sesion) {
    const dev = await prisma.device.findFirst({ where: { id: deviceId, deviceType: "QUEUE_COUNTER" }, select: { ip: true, username: true, password: true } }).catch(() => null);
    if (!dev?.ip) { sesiones.delete(deviceId); return; }
    const cred = dev.username ? `${encodeURIComponent(dev.username)}:${encodeURIComponent(dev.password || "")}@` : "";
    const ff = spawn("ffmpeg", ["-v", "error", "-rtsp_transport", "tcp", "-i", `rtsp://${cred}${dev.ip}/${RUTA_METADATOS}`,
        "-map", "0:d", "-c", "copy", "-f", "data", "-"], { stdio: ["ignore", "pipe", "ignore"] });
    s.ff = ff;
    let buf = "";
    ff.stdout!.on("data", (c: Buffer) => {
        buf += c.toString("utf8");
        const fin = buf.lastIndexOf(FIN);
        if (fin < 0) { if (buf.length > 1_000_000) buf = ""; return; }
        const bloque = buf.slice(0, fin);
        buf = buf.slice(fin + FIN.length);
        const objs = objetosDe(bloque);
        if (!objs) return; // un bloque de eventos, no de análisis
        s.espera = 1_000;
        s.ultimo = { t: Date.now(), objetos: objs };
        for (const e of s.escuchas) { try { e(s.ultimo); } catch { /* una pantalla rota no corta las demás */ } }
    });
    ff.on("close", () => {
        if (s.ff !== ff) return;
        s.ff = null;
        s.espera = Math.min(REINTENTO_MAX_MS, (s.espera || 1_000) * 2);
        s.reintento = setTimeout(() => { s.reintento = null; void arrancar(deviceId, s); }, s.espera);
    });
}

/** Se asegura de que la sesión de esta cámara esté andando. */
export function asegurar(deviceId: string): Sesion {
    let s = sesiones.get(deviceId);
    if (!s) {
        s = { ff: null, ultimo: null, escuchas: new Set(), espera: 1_000, reintento: null };
        sesiones.set(deviceId, s);
        void arrancar(deviceId, s);
    }
    return s;
}

/** Las personas (y objetos) que la cámara ve ahora, si el dato es de hace menos de CUADRO_VIGENTE_MS. */
export function cuadroActual(deviceId: string): Cuadro | null {
    const s = asegurar(deviceId);
    return s.ultimo && Date.now() - s.ultimo.t < CUADRO_VIGENTE_MS ? s.ultimo : null;
}

/** Escuchar los cuadros de una cámara. Devuelve cómo dejar de escuchar. */
export function escuchar(deviceId: string, e: Escucha): () => void {
    const s = asegurar(deviceId);
    s.escuchas.add(e);
    if (s.ultimo) e(s.ultimo);
    return () => { s.escuchas.delete(e); };
}

/** Lo que se guarda con la foto: sólo personas, compacto. */
export const ES_PERSONA = /human|person/i;
export function personasParaGuardar(c: Cuadro | null) {
    if (!c) return null;
    return c.objetos.filter((o) => ES_PERSONA.test(o.clase)).map((o) => ({ c: o.caja, p: Math.round(o.p * 100) / 100, ...(o.poligono.length >= 3 ? { g: o.poligono } : {}) }));
}
