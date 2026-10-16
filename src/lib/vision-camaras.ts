import { prisma } from "@/lib/prisma";
import { probarCamara, TEXTO_PRUEBA } from "@/lib/probar-camara";

/**
 * Qué cámaras analiza omni-vision (el registro de detecciones: siluetas, búsqueda, reglas).
 *
 * Vive en el Setting `VISION_CAMARAS` (lista de ids) que lee vision-worker. Lista vacía quiere
 * decir TODAS las que no son grabadores — y ahí estaba la trampa: cualquier cámara nueva entraba
 * sola al análisis, sin que nadie lo hubiera decidido, y sumaba GPU sin que se notara. Ahora se
 * decide cámara por cámara: al apagar una sola, la lista vacía se convierte en la lista explícita
 * de las que estaban (todas), menos ésa.
 */
const CLAVE = "VISION_CAMARAS";

export async function camarasVision(): Promise<{ todas: boolean; ids: Set<string> }> {
    const fila = await prisma.setting.findUnique({ where: { key: CLAVE } });
    let lista: unknown = [];
    try { lista = JSON.parse(fila?.value || "[]"); } catch { lista = []; }
    const ids = Array.isArray(lista) ? lista.map(String) : [];
    if (ids.length) return { todas: false, ids: new Set(ids) };
    const todas = await prisma.device.findMany({ where: { deviceType: { not: "NVR" } }, select: { id: true } });
    return { todas: true, ids: new Set(todas.map((d) => d.id)) };
}

export async function analizaVision(deviceId: string): Promise<boolean> {
    return (await camarasVision()).ids.has(deviceId);
}

/**
 * Un canal de NVR que no es equipo (`nvrch-<nvr>-<ch>`, el nombre de su stream en go2rtc). Desde
 * el 15/10 también se puede mandar a OmniVision (botón de la pared de cámaras): vision-worker
 * registra su stream si falta y lo analiza como a una cámara más.
 */
export const CANAL_NVR = /^nvrch-([\w-]+)-(\d{1,4})$/;
const CLAVE_NOMBRES = "VISION_CAMARAS_NOMBRES";
const CLAVE_ESTADO = "VISION_REGISTRO_ESTADO";
const CLAVE_TOPE = "VISION_TOPE_POR_SEG";
/** El mismo valor por defecto que vision-worker (TOPE_POR_SEG_DEFECTO). */
export const TOPE_POR_SEG_DEFECTO = 12;
/**
 * Lo que se supone que va a costar una cámara nueva antes de medirla: la mediana de lo que
 * cuestan las que ya están (sin las del carril rápido, que son otra cosa), y nunca menos que
 * esto. Una cámara recién agregada se mide en los minutos siguientes y pasa a contar lo real.
 */
const COSTO_MINIMO_POR_SEG = 0.05;

export type CargaVision = { total: number; tope: number; porCamara: Record<string, number>; medido: boolean };

/** La carga medida por vision-worker (lo que escribe en VISION_REGISTRO_ESTADO cada 15 s). */
export async function cargaVision(): Promise<CargaVision> {
    const filas = await prisma.setting.findMany({ where: { key: { in: [CLAVE_ESTADO, CLAVE_TOPE] } } }).catch(() => []);
    const tope = Math.max(1, Number(filas.find((f) => f.key === CLAVE_TOPE)?.value) || TOPE_POR_SEG_DEFECTO);
    try {
        const e = JSON.parse(filas.find((f) => f.key === CLAVE_ESTADO)?.value || "{}");
        const porCamara: Record<string, number> = {};
        for (const [id, v] of Object.entries<any>(e.camaras || {})) if (typeof v?.porSeg === "number") porCamara[id] = v.porSeg;
        // Un estado viejo (worker caído) no es una medida: se dice que no hay.
        const fresco = e.t && Date.now() - Date.parse(e.t) < 2 * 60_000;
        return { total: fresco && typeof e.carga?.total === "number" ? e.carga.total : 0, tope: e.carga?.tope || tope, porCamara, medido: !!(fresco && e.carga) };
    } catch { return { total: 0, tope, porCamara: {}, medido: false }; }
}

/**
 * ¿Ya está en otra forma? Un canal de NVR cuya cámara también es equipo (misma IP en el mapa de
 * canales) se analiza con el id del equipo: así una cámara no entra dos veces.
 */
async function idUnico(id: string): Promise<string> {
    const m = CANAL_NVR.exec(id); if (!m) return id;
    const fila = await prisma.setting.findUnique({ where: { key: "NVR_CHANNEL_MAP" } }).catch(() => null);
    let mapa: any = {}; try { mapa = JSON.parse(fila?.value || "{}"); } catch { }
    const ip = Object.keys(mapa).find((k) => { const v = mapa[k]; const ch = typeof v === "object" ? Number(v.ch) : Number(v); const nvr = typeof v === "object" ? v.nvr || v.nvrId : null; return ch === Number(m[2]) && (!nvr || nvr === m[1]); });
    if (!ip) return id;
    const d = await prisma.device.findFirst({ where: { ip, deviceType: { not: "NVR" as any } }, select: { id: true } });
    return d?.id || id;
}

/**
 * Prender o apagar el análisis de una cámara (equipo o canal de NVR). Al prender se mira el cupo:
 * si la carga medida más lo que costaría esta cámara pasa el tope, no se agrega y se dice por qué.
 * Los grabadores no se analizan nunca (no tienen un video propio).
 */
export async function ponerVision(deviceId: string, analiza: boolean, nombre?: string | null): Promise<{ ok: boolean; error?: string; id?: string }> {
    const id = await idUnico(deviceId);
    const canal = CANAL_NVR.exec(id);
    if (canal) {
        const nvr = await prisma.device.findUnique({ where: { id: canal[1] }, select: { deviceType: true } });
        if (!nvr || String(nvr.deviceType) !== "NVR") return { ok: false, error: "Ese NVR no existe." };
    } else {
        const d = await prisma.device.findUnique({ where: { id }, select: { deviceType: true, ip: true, username: true, password: true } });
        if (!d) return { ok: false, error: "El equipo no existe." };
        if (String(d.deviceType) === "NVR") return { ok: false, error: "Un grabador no se analiza: se analizan sus cámaras." };
        // Antes de mandarla al motor, que la clave sirva: con una clave mala el motor intentaba cada
        // 4 s y la cámara terminaba bloqueando la IP del servidor (lab, 16/10).
        if (analiza) {
            const p = await probarCamara(d);
            if (p === "clave" || p === "bloqueada") return { ok: false, error: TEXTO_PRUEBA[p] };
        }
    }
    const { ids } = await camarasVision();
    if (analiza && !ids.has(id)) {
        const c = await cargaVision();
        const costos = Object.entries(c.porCamara).filter(([k]) => ids.has(k)).map(([, v]) => v).sort((a, b) => a - b);
        const estimado = Math.max(COSTO_MINIMO_POR_SEG, costos.length ? costos[Math.floor(costos.length / 2)] : COSTO_MINIMO_POR_SEG);
        if (c.medido && c.total + estimado > c.tope) {
            return { ok: false, error: `OmniVision está al límite: hace ${c.total.toFixed(1)} análisis por segundo de ${c.tope} y esta cámara sumaría unos ${estimado.toFixed(2)}. Retirá otra antes.` };
        }
    }
    if (analiza) ids.add(id); else ids.delete(id);
    // Si se prendió el equipo, el canal de NVR de la misma cámara sobra.
    if (id !== deviceId) ids.delete(deviceId);
    // Se guardan sólo ids que existen: una cámara borrada no tiene que quedar «analizada» para siempre.
    const lista = [...ids];
    const equipos = new Set((await prisma.device.findMany({ where: { id: { in: lista.filter((x) => !CANAL_NVR.test(x)) } }, select: { id: true } })).map((x) => x.id));
    const valor = JSON.stringify(lista.filter((x) => equipos.has(x) || CANAL_NVR.test(x)));
    // Lista vacía significa «todas»: si apagaron la última, se guarda una marca que no es ningún id.
    const final = valor === "[]" ? JSON.stringify(["ninguna"]) : valor;
    await prisma.setting.upsert({ where: { key: CLAVE }, update: { value: final }, create: { key: CLAVE, value: final } });
    if (canal && analiza && nombre) {
        const fila = await prisma.setting.findUnique({ where: { key: CLAVE_NOMBRES } }).catch(() => null);
        let nombres: Record<string, string> = {}; try { nombres = JSON.parse(fila?.value || "{}"); } catch { }
        nombres[id] = String(nombre).slice(0, 80);
        const v = JSON.stringify(nombres);
        await prisma.setting.upsert({ where: { key: CLAVE_NOMBRES }, update: { value: v }, create: { key: CLAVE_NOMBRES, value: v } });
    }
    return { ok: true, id };
}
