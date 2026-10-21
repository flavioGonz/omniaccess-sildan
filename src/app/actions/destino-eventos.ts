"use server";

import os from "os";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/app/actions/auth";
import { permisosDeSesion } from "@/lib/permisos";

/**
 * A qué IP y puerto le mandan sus eventos las cámaras (el «servidor de alarmas» que se les escribe).
 *
 * 21/10, Otto Villa: al importar el NVR, el servidor de alarmas de cada cámara falló con «Falta
 * configurar el host de eventos (EVENT_HOST_IP)», y no había ningún lugar en el panel donde
 * decirlo. Además la puesta a punto de las LPR usaba otra clave (LPR_WEBHOOK_HOST) que en el lab
 * había «aprendido» la IP de San Nicolás leyendo una cámara de allá: a una cámara de Otto Villa se
 * le escribió 192.168.1.3. Ahora es UN destino (EVENT_HOST_*), se dice desde el panel, y se
 * escriben las dos claves juntas para que alarmas e LPR apunten al mismo lugar.
 */
const PUERTO_DEFECTO = "10000";
const RUTA_DEFECTO = "/api/webhooks/hikvision";

async function exigirAjustes() {
    const s: any = await getSession();
    if (!s || !permisosDeSesion(s).includes("ajustes")) throw new Error("Sólo quien tiene Ajustes puede cambiar el destino de los eventos.");
}

export async function leerDestinoEventos(): Promise<{ ip: string | null; puerto: string; sugeridas: string[] }> {
    const filas = await prisma.setting.findMany({ where: { key: { in: ["EVENT_HOST_IP", "EVENT_HOST_PORT"] } } });
    const m: Record<string, string> = {}; filas.forEach((f) => (m[f.key] = f.value));
    // Las IPv4 del servidor (sin la de docker): la que ven las cámaras suele ser una de éstas.
    const sugeridas = Object.entries(os.networkInterfaces())
        .filter(([n]) => !/^(docker|br-|veth|lo)/.test(n))
        .flatMap(([, l]) => (l || []).filter((x) => x.family === "IPv4" && !x.internal).map((x) => x.address));
    return { ip: m.EVENT_HOST_IP || null, puerto: m.EVENT_HOST_PORT || PUERTO_DEFECTO, sugeridas };
}

export async function guardarDestinoEventos(ip: string, puerto: string): Promise<{ ok: true } | { ok: false; error: string }> {
    await exigirAjustes();
    const i = String(ip || "").trim(), p = String(puerto || PUERTO_DEFECTO).trim();
    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(i)) return { ok: false, error: "La IP no es válida. Ej.: 172.26.20.200" };
    if (!/^\d{2,5}$/.test(p)) return { ok: false, error: "El puerto no es válido. Ej.: 10000" };
    const poner = (key: string, value: string) => prisma.setting.upsert({ where: { key }, update: { value }, create: { key, value } });
    await Promise.all([
        poner("EVENT_HOST_IP", i), poner("EVENT_HOST_PORT", p),
        poner("LPR_WEBHOOK_HOST", i), poner("LPR_WEBHOOK_PORT", p), poner("LPR_WEBHOOK_URL", RUTA_DEFECTO),
    ]);
    return { ok: true };
}
