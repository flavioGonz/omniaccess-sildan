import fs from "fs";
import os from "os";
import path from "path";
import { spawn } from "child_process";
import { prisma } from "@/lib/prisma";
import { getChannelMap, resolveNvrById, type NvrConn } from "@/lib/nvr-resolve";
import { configClips, nombreDeClip, type ConfigClip } from "@/lib/clips";
import { cortarDesdeNvr } from "@/lib/clip-nvr";
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
 * conocía las cámaras de fila de Olivos y en San Nicolás no produjo un solo clip, mientras el
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
export const DIR_CLIPS = process.env.CLIPS_DIR || path.join(process.cwd(), "public", "clips");
/** Dónde graba el worker el anillo. Fuera de public: nada del anillo se sirve. Igual en los dos procesos. */
export const DIR_ANILLO = process.env.ANILLO_DIR || path.join(os.tmpdir(), "omniaccess-anillo");

/** El logo a pegar en lo que sale por WhatsApp, o null si está apagado en Ajustes (o falta el archivo). */
export async function marcaAgua(): Promise<string | null> {
    const v = (await prisma.setting.findUnique({ where: { key: AJUSTE_MARCA_AGUA } }).catch(() => null))?.value;
    if (v === "false") return null;
    const fp = path.join(process.cwd(), "public", ARCHIVO_MARCA_AGUA);
    return fs.existsSync(fp) ? fp : null;
}

/** Quién puede pedir o mandar un clip: los que ya ven video en el panel (monitor, intrusión, historial). */
export const PERMISOS_VIDEO = ["monitor", "intrusion", "historial"] as const;

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
    | { ok: true; archivo: string; nombre: string; url: string; fuente: "nvr" | "anillo"; ventana: Ventana; bytes: number }
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
export async function fuenteDeVideo(deviceId: string): Promise<FuenteVideo> {
    const dev = await prisma.device.findUnique({ where: { id: deviceId }, select: { ip: true, name: true } }).catch(() => null);
    if (!dev) return { tipo: null, motivo: "la cámara no existe" };
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
export async function clipDeInstante(p: { deviceId: string; instante: number; antes?: number; despues?: number; para: Para; matricula?: string | null }): Promise<ResultadoClip> {
    const ventana = await ventanaEfectiva(p.para, { antes: p.antes, despues: p.despues });
    const fuente = await fuenteDeVideo(p.deviceId);
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
    if (fuente.tipo === "nvr") {
        const cfgCorte: ConfigClip = p.para === "alerta" ? { ...cfg, altura: ALTURA_ALERTA } : cfg;
        // El clip que se manda a mano por WhatsApp lleva el logo; el de una alerta sigue su ajuste aparte.
        const marca = p.para === "envio" ? await marcaAgua() : null;
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
    return { ok: true, archivo: destino, nombre, url: `/api/clip/${nombre}`, fuente: fuente.tipo, ventana, bytes };
}
