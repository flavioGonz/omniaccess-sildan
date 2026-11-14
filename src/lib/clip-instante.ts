import fs from "fs";
import os from "os";
import path from "path";
import { spawn } from "child_process";
import { prisma } from "@/lib/prisma";
import { getChannelMap, resolveNvrById, type NvrConn } from "@/lib/nvr-resolve";
import { configClips, nombreDeClip, type ConfigClip } from "@/lib/clips";
import { cortarDesdeNvr } from "@/lib/clip-nvr";
import { editarClip, cuandoLargo } from "@/lib/clip-editado";
import { ventanaPlayback } from "@/lib/ventana-playback";
import {
    AJUSTE_ALERTA_ANTES, AJUSTE_ALERTA_DESPUES, ALERTA_ANTES_POR_DEFECTO, ALERTA_DESPUES_POR_DEFECTO,
    ALERTA_ANTES_MAX, ALERTA_DESPUES_MAX, ENVIO_MAX_SEG, SEG_ANILLO_SEG, MARGEN_GRABACION_SEG, CLIP_RETENCION_MIN,
    AJUSTE_MARCA_AGUA, ARCHIVO_MARCA_AGUA,
} from "@/lib/clips";

/**
 * El clip de un instante: dado (cámara, instante, segundos antes, segundos después) produce UN
 * MP4 en disco, de la mejor fuente que haya, y dice cuál usó o por qué no hubo.
 *
 * Lo usan la alerta con video (el worker de despachos lo pide por /api/clip/instante) y el
 * envío por WhatsApp desde el playback. Antes cada uno tenía su ffmpeg: el del worker sólo
 * conocía las cámaras de fila del primer barrio y en San Nicolás no produjo un solo clip, mientras el
 * toggle del panel decía que sí.
 *
 * Orden de fuentes:
 *   1. La grabación del NVR al que la cámara está mapeada (lib/clip-nvr, el mismo corte del
 *      playback).
 *   2. El anillo local que mantiene el worker para las cámaras SIN NVR que alcanza alguna
 *      regla activa (hoy LPR Interior).
 *   3. Nada, con el motivo en palabras: la alerta va con foto y lo dice.
 */

/** Dónde quedan los clips servibles (/api/clip/<archivo>). Por defecto, public/clips del proyecto. */
// Fuera del proyecto, como la caché de miniaturas: el 7/10 el build se cayó porque Turbopack
// rastreaba public/clips (un enlace a /datos/clips) en cuanto había un clip adentro ("Symlink ...
// points out of the filesystem root"), y marcarlo con turbopackIgnore no alcanzó. Los clips son
// temporales (CLIP_RETENCION_MIN) y los sirve /api/clip/[file], no Next como estáticos.
export const DIR_CLIPS = process.env.CLIPS_DIR || path.join(os.tmpdir(), "omniaccess-clips");
/** Dónde graba el worker el anillo. Fuera de public: nada del anillo se sirve. Igual en los dos procesos. */
export const DIR_ANILLO = process.env.ANILLO_DIR || path.join(os.tmpdir(), "omniaccess-anillo");

/** El logo a pegar en lo que sale por WhatsApp, o null si está apagado en Ajustes (o falta el archivo). */
export async function marcaAgua(): Promise<string | null> {
    const v = (await prisma.setting.findUnique({ where: { key: AJUSTE_MARCA_AGUA } }).catch(() => null))?.value;
    if (v === "false") return null;
    const fp = path.join(/* turbopackIgnore: true */ process.cwd(), "public", ARCHIVO_MARCA_AGUA);
    return fs.existsSync(fp) ? fp : null;
}

/** Quién puede pedir o mandar un clip: los que ya ven video en el panel (monitor, intrusión, historial). */
/** Mandar o exportar video (roles-y-permisos: «Grabaciones y clips»; los roles de antes con Monitor, Intrusión o Historial lo traen traducido). */
export const PERMISOS_VIDEO = ["grabaciones"] as const;

/** Cuánto se espera, como mucho, a que el tramo posterior exista antes de cortar. */
const ESPERA_TOPE_MS = 30_000;
/** Altura del clip de alerta: se mira en un teléfono, y menos píxeles es menos CPU sin GPU. */
const ALTURA_ALERTA = 480;

export type Para = "alerta" | "envio";
export type Ventana = { antes: number; despues: number };
export type FuenteVideo =
    | { tipo: "nvr"; conn: NvrConn; ch: number; nvrId: string | null }
    | { tipo: "anillo"; dir: string }
    | { tipo: null; motivo: string };

export type ResultadoClip =
    | { ok: true; archivo: string; nombre: string; url: string; fuente: "nvr" | "anillo"; ventana: Ventana; bytes: number;
        /** Lleva la intro de OmniAccess (sólo lo que se manda a mano, con el logo prendido). */
        editado?: boolean; ancho?: number; alto?: number; segundos?: number }
    | { ok: false; motivo: string; ventana: Ventana; fuente: "nvr" | "anillo" | null };

const acotar = (v: unknown, def: number, max: number) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) ? Math.min(max, Math.max(0, n)) : def;
};

/** La ventana de las alertas (Ajustes → Video del evento). Distinta de la del playback a propósito. */
export async function ventanaAlerta(): Promise<Ventana> {
    try {
        const filas = await prisma.setting.findMany({ where: { key: { in: [AJUSTE_ALERTA_ANTES, AJUSTE_ALERTA_DESPUES] } } });
        const v = (k: string) => filas.find((f) => f.key === k)?.value;
        return {
            antes: acotar(v(AJUSTE_ALERTA_ANTES) ?? ALERTA_ANTES_POR_DEFECTO, ALERTA_ANTES_POR_DEFECTO, ALERTA_ANTES_MAX),
            despues: Math.max(1, acotar(v(AJUSTE_ALERTA_DESPUES) ?? ALERTA_DESPUES_POR_DEFECTO, ALERTA_DESPUES_POR_DEFECTO, ALERTA_DESPUES_MAX)),
        };
    } catch { return { antes: ALERTA_ANTES_POR_DEFECTO, despues: ALERTA_DESPUES_POR_DEFECTO }; }
}

/**
 * La ventana efectiva de un pedido. Alerta: topes de alerta. Envío: lo que el operador eligió,
 * pero el total no pasa de ENVIO_MAX_SEG (el NVR entrega la grabación a tiempo real: un clip
 * de dos minutos tarda dos minutos en salir, y el operador está esperando con el diálogo abierto).
 */
export async function ventanaEfectiva(para: Para, pedida?: Partial<Ventana>): Promise<Ventana> {
    if (para === "alerta") {
        const base = await ventanaAlerta();
        return {
            antes: pedida?.antes != null ? acotar(pedida.antes, base.antes, ALERTA_ANTES_MAX) : base.antes,
            despues: pedida?.despues != null ? Math.max(1, acotar(pedida.despues, base.despues, ALERTA_DESPUES_MAX)) : base.despues,
        };
    }
    const base = await ventanaPlayback();
    let antes = pedida?.antes != null ? acotar(pedida.antes, base.antes, ENVIO_MAX_SEG) : base.antes;
    let despues = pedida?.despues != null ? Math.max(1, acotar(pedida.despues, base.despues, ENVIO_MAX_SEG)) : base.despues;
    if (antes + despues > ENVIO_MAX_SEG) { const k = ENVIO_MAX_SEG / (antes + despues); antes = Math.floor(antes * k); despues = ENVIO_MAX_SEG - antes; }
    return { antes, despues };
}

/** Segmentos del anillo de una cámara, del más viejo al más nuevo (mtime ≈ fin del segmento). */
export function segmentosAnillo(dir: string): { fp: string; fin: number }[] {
    let nombres: string[] = [];
    try { nombres = fs.readdirSync(dir).filter((f) => f.endsWith(".ts")); } catch { return []; }
    return nombres
        .map((f) => { const fp = path.join(dir, f); let fin = 0; try { fin = fs.statSync(fp).mtimeMs; } catch { } return { fp, fin }; })
        .filter((s) => s.fin > 0)
        .sort((a, b) => a.fin - b.fin);
}

/** De dónde puede salir video de esta cámara. */
export async function fuenteDeVideo(deviceId: string, canal?: { nvrId?: string | null; ch?: number | null }): Promise<FuenteVideo> {
    const dev = await prisma.device.findUnique({ where: { id: deviceId }, select: { ip: true, name: true } }).catch(() => null);
    if (!dev) {
        // Un canal del grabador sin equipo en Dispositivos (los hay en la pared de cámaras): alcanza con saber grabador y canal.
        if (canal?.nvrId && canal.ch && canal.ch > 0) {
            const conn = await resolveNvrById(canal.nvrId);
            if (conn) return { tipo: "nvr", conn, ch: canal.ch, nvrId: canal.nvrId };
        }
        return { tipo: null, motivo: "la cámara no existe" };
    }
    if (dev.ip) {
        const mapa = await getChannelMap();
        const e = mapa[dev.ip];
        if (e?.ch) {
            const conn = await resolveNvrById(e.nvrId);
            if (conn) return { tipo: "nvr", conn, ch: e.ch, nvrId: e.nvrId };
            return { tipo: null, motivo: "el grabador de la cámara no está configurado" };
        }
    }
    const dir = path.join(DIR_ANILLO, deviceId);
    if (segmentosAnillo(dir).length) return { tipo: "anillo", dir };
    // Quien pide ya sabe el grabador y el canal (la ficha de una detección los trae de la cámara):
    // sirve cuando el equipo no tiene IP propia en el mapa de canales.
    if (canal?.nvrId && canal.ch && canal.ch > 0) {
        const conn = await resolveNvrById(canal.nvrId);
        if (conn) return { tipo: "nvr", conn, ch: canal.ch, nvrId: canal.nvrId };
    }
    return { tipo: null, motivo: "la cámara no está en ningún grabador y no tiene grabación local" };
}

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

function ffmpeg(args: string[], topeMs: number): Promise<boolean> {
    return new Promise((resolve) => {
        const ff = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "ignore"] });
        const killer = setTimeout(() => { try { ff.kill("SIGKILL"); } catch { } resolve(false); }, topeMs);
        ff.on("close", (code) => { clearTimeout(killer); resolve(code === 0); });
        ff.on("error", () => { clearTimeout(killer); resolve(false); });
    });
}

/**
 * Corta [inicioMs, finMs] del anillo. Los segmentos son de SEG_ANILLO_SEG y su mtime es su fin,
 * así que el primero que sirve arranca en (fin − SEG). Se reencodea (sub-stream chico, barato)
 * porque con copy el corte cae en el keyframe y el clip arrancaría segundos antes o después.
 */
export async function cortarDesdeAnillo(dir: string, inicioMs: number, finMs: number, destino: string): Promise<{ ok: boolean; motivo?: string }> {
    const segMs = SEG_ANILLO_SEG * 1000;
    const segs = segmentosAnillo(dir).filter((s) => s.fin > inicioMs && s.fin - segMs < finMs);
    if (!segs.length) return { ok: false, motivo: "la grabación local no tiene ese horario (guarda sólo los últimos segundos)" };
    const lista = destino + ".txt";
    fs.writeFileSync(lista, segs.map((s) => `file '${s.fp.replace(/'/g, "'\\''")}'`).join("\n"));
    const desde = Math.max(0, (inicioMs - (segs[0].fin - segMs)) / 1000);
    const dur = (finMs - inicioMs) / 1000;
    const ok = await ffmpeg(["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", lista, "-ss", desde.toFixed(2), "-t", dur.toFixed(2),
        "-an", "-vf", `scale=-2:'min(${ALTURA_ALERTA},ih)',format=yuv420p`, "-c:v", "libx264", "-preset", "veryfast", "-crf", "26", "-movflags", "+faststart", destino], 30_000);
    try { fs.unlinkSync(lista); } catch { }
    return ok ? { ok: true } : { ok: false, motivo: "no se pudo armar el clip desde la grabación local" };
}

/** Borra los clips servibles con más de CLIP_RETENCION_MIN minutos. El anillo no se toca. */
export function purgarClips(ahora = Date.now()): number {
    let borrados = 0;
    let nombres: string[] = [];
    try { nombres = fs.readdirSync(DIR_CLIPS); } catch { return 0; }
    for (const n of nombres) {
        if (!/\.(mp4|txt)$/.test(n)) continue;
        const fp = path.join(DIR_CLIPS, n);
        try { if (ahora - fs.statSync(fp).mtimeMs > CLIP_RETENCION_MIN * 60_000) { fs.unlinkSync(fp); borrados++; } } catch { }
    }
    return borrados;
}

/**
 * Produce el clip. Espera, con tope, a que exista el tramo posterior; nunca entrega un clip
 * más corto como si fuera completo: si el corte falla o sale vacío, no hay clip y se dice por qué.
 */
export async function clipDeInstante(p: { deviceId: string; instante: number; antes?: number; despues?: number; para: Para; matricula?: string | null; nvrId?: string | null; ch?: number | null }): Promise<ResultadoClip> {
    const ventana = await ventanaEfectiva(p.para, { antes: p.antes, despues: p.despues });
    const fuente = await fuenteDeVideo(p.deviceId, { nvrId: p.nvrId, ch: p.ch });
    if (!fuente.tipo) return { ok: false, motivo: fuente.motivo, ventana, fuente: null };

    const inicioMs = p.instante - ventana.antes * 1000;
    const finMs = p.instante + ventana.despues * 1000;

    // El tramo posterior tiene que existir. Del NVR: margen de grabación. Del anillo: que haya
    // un segmento que termine después del fin pedido.
    const listoEn = finMs + (fuente.tipo === "nvr" ? MARGEN_GRABACION_SEG * 1000 : SEG_ANILLO_SEG * 1000);
    const falta = listoEn - Date.now();
    if (falta > ESPERA_TOPE_MS) return { ok: false, motivo: "ese tramo todavía no se grabó", ventana, fuente: fuente.tipo };
    if (falta > 0) await esperar(falta);

    try { fs.mkdirSync(DIR_CLIPS, { recursive: true }); } catch { }
    purgarClips();
    const cfg = await configClips();
    const dev = await prisma.device.findUnique({ where: { id: p.deviceId }, select: { name: true } }).catch(() => null);
    const base = nombreDeClip(cfg.nombre, { camara: dev?.name || null, matricula: p.matricula || null, fecha: new Date(p.instante), evento: p.para });
    const nombre = `${base}_${Date.now().toString(36)}.mp4`;
    const destino = path.join(DIR_CLIPS, nombre);

    let ok = false;
    let motivo = "";
    // El clip que se manda a mano (WhatsApp o Telegram) lleva el logo y la intro; el de una alerta
    // sigue su ajuste aparte. Con el logo apagado en Ajustes, ninguna de las dos cosas.
    const marca = p.para === "envio" ? await marcaAgua() : null;
    if (fuente.tipo === "nvr") {
        const cfgCorte: ConfigClip = p.para === "alerta" ? { ...cfg, altura: ALTURA_ALERTA } : cfg;
        ok = await cortarDesdeNvr(fuente.conn, String(fuente.ch), inicioMs, (finMs - inicioMs) / 1000, destino, { cfg: cfgCorte, marcaAgua: marca, topeMs: marca ? 75_000 : undefined });
        if (!ok) motivo = "el grabador no entregó grabación de ese horario";
    } else {
        const r = await cortarDesdeAnillo(fuente.dir, inicioMs, finMs, destino);
        ok = r.ok; motivo = r.motivo || "";
    }

    // Un MP4 de menos de 1,5 KB es un encabezado sin cuadros: no es un clip.
    let bytes = 0;
    try { bytes = fs.statSync(destino).size; } catch { }
    if (!ok || bytes < 1500) {
        try { fs.unlinkSync(destino); } catch { }
        return { ok: false, motivo: motivo || "el clip salió vacío", ventana, fuente: fuente.tipo };
    }
    // La intro de OmniAccess (y el logo, si el corte no lo trae: el del anillo no lo dibuja). Si la
    // edición falla, va el clip como salió del grabador: mejor sin intro que sin clip.
    let edicion: { editado?: boolean; ancho?: number; alto?: number; segundos?: number } = {};
    if (marca) {
        const d = new Date(p.instante);
        const e = await editarClip(destino, { titulo: dev?.name || "Cámara", lineas: [cuandoLargo(d), p.matricula ? `Matrícula ${p.matricula}` : ""], conMarca: fuente.tipo === "anillo" });
        if (e.ok) { edicion = { editado: true, ancho: e.ancho, alto: e.alto, segundos: e.segundos }; try { bytes = fs.statSync(destino).size; } catch { } }
        else console.warn(`[clip] sin intro (${dev?.name || p.deviceId}): ${e.motivo}`);
    }
    return { ok: true, archivo: destino, nombre, url: `/api/clip/${nombre}`, fuente: fuente.tipo, ventana, bytes, ...edicion };
}

/** Un tramo de una grabación hecha desde el vivo: qué canal y de cuándo a cuándo. */
export type TramoGrabado = { deviceId?: string | null; nvrId?: string | null; ch?: number | null; desde: number; hasta: number };
/** Cuántos tramos lleva como mucho una grabación (cambios de cámara). */
export const TRAMOS_MAX = 8;
/** Un tramo más corto que esto no se corta: es el instante de pasar de una cámara a otra. */
const TRAMO_MINIMO_SEG = 1;
/**
 * Cuánto tiene que haber pasado desde el FIN de un tramo en cada intento de cortarlo.
 *
 * Por qué hay intentos (14/11, el primer clip que grabó Nico: «el grabador no entregó grabación de
 * ese horario»). Se esperaban 4 s fijos después del fin y se pedía. Medido ese día contra los
 * grabadores del lab, pidiendo tramos de 3 s: uno entrega lo que terminó hace 15 s; otro contesta
 * 400 a todo lo que terminó hace menos de un minuto y recién entrega lo de hace 75 s. Cada
 * grabador tarda lo suyo en tener disponible lo último que grabó, y un clip «de lo que estoy
 * viendo» pide justo eso.
 *
 * El rechazo llega al instante (0,2 s), así que insistir no cuesta: se reintenta cuando el fin del
 * tramo tiene esta antigüedad (una edad que ya pasó no se repite: un tramo viejo se pide una vez).
 * Un corte que falla después de varios segundos NO se reintenta: ese no es «todavía no lo tengo».
 */
const EDAD_DEL_FIN_SEG = [0, 20, 40, 65, 90];
/** Un corte que falla en menos que esto fue un rechazo del grabador (no un corte que se cayó a mitad). */
const RECHAZO_RAPIDO_MS = 5000;
/** Diferencia de reloj que se corrige: menos es ruido; más no es un reloj corrido sino la zona horaria mal puesta. */
const RELOJ_MIN_SEG = 3, RELOJ_MAX_SEG = 300;

/**
 * Cuánto está corrido el reloj de un grabador respecto del servidor, en segundos (negativo =
 * atrasado), según la última muestra de salud. El grabador guarda lo que pasó a las 10:00:00 con
 * SU hora: si atrasa 24 s, eso está en sus 09:59:36, y pedirle las 10:00:00 trae lo que pasó 24 s
 * después. Medido el 14/11: un grabador del lab atrasa 24 s; los otros, 2 s.
 */
async function relojDelGrabador(nvrId: string | null): Promise<number> {
    if (!nvrId) return 0;
    const m = await prisma.deviceHealthSample.findFirst({ where: { deviceId: nvrId, driftSec: { not: null }, ts: { gte: new Date(Date.now() - 3600_000) } }, orderBy: { ts: "desc" }, select: { driftSec: true } }).catch(() => null);
    const d = m?.driftSec ?? 0;
    return Math.abs(d) >= RELOJ_MIN_SEG && Math.abs(d) <= RELOJ_MAX_SEG ? d : 0;
}

/**
 * El clip de una grabación hecha desde el vivo que pasó por VARIAS cámaras (13/11, Nico: «el
 * botón de grabación debe continuar grabando mientras cambiamos de cámara vía el ícono de visual
 * track»). Cada tramo se corta de la grabación de su canal, en orden, y se unen en un solo MP4
 * con UNA intro.
 *
 * - El total no pasa de ENVIO_MAX_SEG, como cualquier clip que se manda a mano: lo que sobra se
 *   recorta del final. Los tramos se cortan de a uno (no se le abren varias reproducciones a la
 *   vez al grabador), así que tarda lo mismo que un clip de ese largo de una sola cámara.
 * - Un tramo que su grabador no entrega se saltea y se dice cuántos faltaron; si no sale ninguno,
 *   no hay clip. Nunca se rellena.
 * - Las cámaras pueden grabar en tamaños distintos: al unir se lleva todo al alto de Ajustes
 *   (720 si está en «original»), con bandas si la proporción no coincide. Se recodifica una vez.
 */
export async function clipDeTramos(pedidos: TramoGrabado[], rotulo?: string | null): Promise<ResultadoClip & { tramos?: number; salteados?: number }> {
    let resta = ENVIO_MAX_SEG;
    const tramos: (TramoGrabado & { seg: number })[] = [];
    for (const t of pedidos.slice(0, TRAMOS_MAX)) {
        const seg = Math.min(resta, Math.round((t.hasta - t.desde) / 1000));
        if (seg < TRAMO_MINIMO_SEG) continue;
        tramos.push({ ...t, seg }); resta -= seg;
        if (resta <= 0) break;
    }
    const total = tramos.reduce((x, t) => x + t.seg, 0);
    const ventana: Ventana = { antes: 0, despues: total };
    if (!tramos.length) return { ok: false, motivo: "la grabación es demasiado corta", ventana, fuente: null };

    // El último tramo tiene que haber terminado (más el margen de siempre); cuánto más hay que
    // esperar para que el grabador lo tenga se resuelve tramo por tramo, abajo.
    const falta = Math.max(...tramos.map((t) => t.desde + t.seg * 1000)) + MARGEN_GRABACION_SEG * 1000 - Date.now();
    if (falta > ESPERA_TOPE_MS) return { ok: false, motivo: "ese tramo todavía no se grabó", ventana, fuente: null };
    if (falta > 0) await esperar(falta);

    try { fs.mkdirSync(DIR_CLIPS, { recursive: true }); } catch { }
    purgarClips();
    const cfg = await configClips();
    const marca = await marcaAgua();
    const primero = tramos[0];
    const dev = primero.deviceId ? await prisma.device.findUnique({ where: { id: primero.deviceId }, select: { name: true } }).catch(() => null) : null;
    const base = nombreDeClip(cfg.nombre, { camara: tramos.length > 1 ? "Recorrida" : dev?.name || rotulo || null, matricula: null, fecha: new Date(primero.desde), evento: "envio" });
    const nombre = `${base}_${Date.now().toString(36)}.mp4`;
    const destino = path.join(DIR_CLIPS, nombre);

    const partes: string[] = [];
    let fuente: "nvr" | "anillo" | null = null, salteados = 0;
    for (const [i, t] of tramos.entries()) {
        const f = await fuenteDeVideo(t.deviceId || "", { nvrId: t.nvrId, ch: t.ch });
        const parte = `${destino}.t${i}.mp4`;
        let ok = false, bytes = 0, intentos = 0;
        if (f.tipo === "nvr") {
            // Con la hora del grabador (ver relojDelGrabador), y las veces que haga falta (ver EDAD_DEL_FIN_SEG).
            const reloj = await relojDelGrabador(f.nvrId);
            const fin = t.desde + t.seg * 1000;
            for (const edad of EDAD_DEL_FIN_SEG) {
                const aun = fin + edad * 1000 - Date.now();
                if (aun <= 0 && intentos > 0) continue;
                if (aun > 0) await esperar(aun);
                intentos++;
                const t0 = Date.now();
                ok = await cortarDesdeNvr(f.conn, String(f.ch), t.desde + reloj * 1000, t.seg, parte, { cfg, marcaAgua: marca, topeMs: marca ? 75_000 : undefined });
                bytes = 0; try { bytes = fs.statSync(parte).size; } catch { }
                if ((ok && bytes >= 1500) || Date.now() - t0 > RECHAZO_RAPIDO_MS) break;
            }
            if (!(ok && bytes >= 1500)) console.warn(`[clip] grabación: el grabador no entregó el tramo ${i + 1} (canal ${f.ch}, ${t.seg} s, terminó hace ${Math.round((Date.now() - fin) / 1000)} s) tras ${intentos} ${intentos === 1 ? "intento" : "intentos"}${reloj ? `; reloj del grabador ${reloj} s` : ""}`);
        } else if (f.tipo === "anillo") {
            ok = (await cortarDesdeAnillo(f.dir, t.desde, t.desde + t.seg * 1000, parte)).ok;
            try { bytes = fs.statSync(parte).size; } catch { }
        } else console.warn(`[clip] grabación: tramo ${i + 1} sin fuente de video: ${f.motivo}`);
        if (ok && bytes >= 1500) { partes.push(parte); fuente = fuente || f.tipo; }
        else { salteados++; try { fs.unlinkSync(parte); } catch { } }
    }
    const limpiar = () => { for (const x of partes) try { fs.unlinkSync(x); } catch { } };
    if (!partes.length) return { ok: false, motivo: "el grabador todavía no tiene disponible ese tramo (se insistió durante un minuto y medio). Probá de nuevo en un rato, o cortalo desde la grabación", ventana, fuente: null };

    if (partes.length === 1) fs.renameSync(partes[0], destino);
    else {
        // Unir: todo al mismo tamaño y cadencia, y recodificar una vez (los tramos vienen de cámaras distintas).
        const alto = cfg.altura || 720, ancho = Math.round((alto * 16) / 9 / 2) * 2;
        const filtro = partes.map((_, i) => `[${i}:v]scale=${ancho}:${alto}:force_original_aspect_ratio=decrease,pad=${ancho}:${alto}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=25[v${i}]`).join(";")
            + `;${partes.map((_, i) => `[v${i}]`).join("")}concat=n=${partes.length}:v=1:a=0[v]`;
        const unido = await ffmpeg(["-y", "-loglevel", "error", ...partes.flatMap((x) => ["-i", x]), "-filter_complex", filtro, "-map", "[v]", "-an",
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p", "-movflags", "+faststart", destino], 90_000);
        limpiar();
        if (!unido) { try { fs.unlinkSync(destino); } catch { } return { ok: false, motivo: "no se pudieron unir los tramos", ventana, fuente }; }
    }
    let bytes = 0; try { bytes = fs.statSync(destino).size; } catch { }
    if (bytes < 1500) { try { fs.unlinkSync(destino); } catch { } return { ok: false, motivo: "el clip salió vacío", ventana, fuente }; }

    let edicion: { editado?: boolean; ancho?: number; alto?: number; segundos?: number } = {};
    if (marca) {
        const e = await editarClip(destino, {
            titulo: partes.length > 1 ? "Recorrida" : dev?.name || rotulo || "Cámara",
            lineas: [cuandoLargo(new Date(primero.desde)), partes.length > 1 ? `${partes.length} cámaras` : ""], conMarca: fuente === "anillo",
        });
        if (e.ok) { edicion = { editado: true, ancho: e.ancho, alto: e.alto, segundos: e.segundos }; try { bytes = fs.statSync(destino).size; } catch { } }
        else console.warn(`[clip] grabación sin intro: ${e.motivo}`);
    }
    return { ok: true, archivo: destino, nombre, url: `/api/clip/${nombre}`, fuente: fuente || "nvr", ventana, bytes, ...edicion, tramos: partes.length, salteados };
}
