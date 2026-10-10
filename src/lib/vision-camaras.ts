import { prisma } from "@/lib/prisma";

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

/** Prender o apagar el análisis de una cámara. Los grabadores no se analizan nunca (no tienen un video propio). */
export async function ponerVision(deviceId: string, analiza: boolean): Promise<{ ok: boolean; error?: string }> {
    const d = await prisma.device.findUnique({ where: { id: deviceId }, select: { deviceType: true } });
    if (!d) return { ok: false, error: "El equipo no existe." };
    if (String(d.deviceType) === "NVR") return { ok: false, error: "Un grabador no se analiza: se analizan sus cámaras." };
    const { ids } = await camarasVision();
    if (analiza) ids.add(deviceId); else ids.delete(deviceId);
    // Se guardan sólo ids que existen: una cámara borrada no tiene que quedar «analizada» para siempre.
    const existen = new Set((await prisma.device.findMany({ where: { id: { in: [...ids] } }, select: { id: true } })).map((x) => x.id));
    const valor = JSON.stringify([...ids].filter((x) => existen.has(x)));
    // Lista vacía significa «todas»: si apagaron la última, se guarda una marca que no es ningún id.
    const final = valor === "[]" ? JSON.stringify(["ninguna"]) : valor;
    await prisma.setting.upsert({ where: { key: CLAVE }, update: { value: final }, create: { key: CLAVE, value: final } });
    return { ok: true };
}
