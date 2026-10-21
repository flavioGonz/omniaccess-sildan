"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";

/*
 * La ficha de un contador de filas (21/10, Nico: «tiene el modal viejo, debe tener su modal»). La
 * Bosch del Hospital Británico, en el lab, se editaba con el formulario viejo de cuatro fases
 * pensado para dar de alta una lectora. Esta ficha muestra lo que importa de un contador: si se lo
 * está leyendo, cuánta gente cuenta, cómo se le habla (HTTP o HTTPS, Digest o Básica) y si
 * OmniVision cuenta la misma fila para compararla.
 */

async function exigir() {
    const { getSession } = await import("@/app/actions/auth");
    const { permisosDeSesion } = await import("@/lib/permisos");
    const s: any = await getSession().catch(() => null);
    if (!s || !permisosDeSesion(s).includes("dispositivos")) throw new Error("Tu rol no puede ver ni cambiar dispositivos.");
}

const leerSetting = async (k: string) => (await prisma.setting.findUnique({ where: { key: k } }).catch(() => null))?.value ?? null;
const lista = (v: string | null) => String(v || "").split(/[\s,]+/).map((x) => x.trim()).filter(Boolean);
const json = <T,>(v: string | null, def: T): T => { try { return v ? JSON.parse(v) : def; } catch { return def; } };
async function escribirSetting(key: string, value: string) {
    await prisma.setting.upsert({ where: { key }, update: { value }, create: { key, value } });
}

/** Cuánto sin leer para decir que el contador no se está leyendo: el ciclo lee cada ~1 s. */
const LEIDO_HACE_MAX_MS = 60_000;

export type FichaContadorFila = {
    id: string; name: string; ip: string; location: string | null; username: string | null; authType: string; deviceModel: string | null; brand: string; direction: string;
    soloHttp: boolean;
    bosch: { leyendo: boolean; ultimaLectura: string | null; aforo: number | null; aforoTs: string | null; canal: string | null; eventos24h: number };
    vision: { enOmniVision: boolean; reglas: { id: string; nombre: string; activa: boolean }[]; ultimoEvento: string | null; eventos24h: number };
};

export async function fichaContadorFila(id: string): Promise<FichaContadorFila> {
    await exigir();
    const d = await prisma.device.findUnique({ where: { id }, select: { id: true, name: true, ip: true, location: true, username: true, authType: true, deviceModel: true, brand: true, direction: true, lastOnlinePull: true } });
    if (!d) throw new Error("No existe ese equipo.");
    const hace24 = new Date(Date.now() - 86_400_000);
    const [ultimo, n24, http, camaras, reglas, ultVision, nVision] = await Promise.all([
        prisma.queueEvent.findFirst({ where: { deviceId: id }, orderBy: { timestamp: "desc" }, select: { peopleCount: true, timestamp: true, channelName: true } }).catch(() => null),
        prisma.queueEvent.count({ where: { deviceId: id, timestamp: { gte: hace24 } } }).catch(() => 0),
        leerSetting("BOSCH_SOLO_HTTP"), leerSetting("VISION_CAMARAS"), leerSetting("VISION_REGLAS"),
        prisma.eventoVision.findFirst({ where: { deviceId: id, tipo: { startsWith: "FILA" } }, orderBy: { ts: "desc" }, select: { ts: true } }).catch(() => null),
        prisma.eventoVision.count({ where: { deviceId: id, tipo: { startsWith: "FILA" }, ts: { gte: hace24 } } }).catch(() => 0),
    ]);
    const lectura = d.lastOnlinePull ? d.lastOnlinePull.getTime() : 0;
    return {
        id: d.id, name: d.name, ip: d.ip, location: d.location, username: d.username, authType: String(d.authType), deviceModel: d.deviceModel, brand: String(d.brand), direction: String(d.direction),
        soloHttp: lista(http).includes(d.ip),
        bosch: {
            leyendo: !!lectura && Date.now() - lectura < LEIDO_HACE_MAX_MS, ultimaLectura: d.lastOnlinePull?.toISOString() || null,
            aforo: ultimo?.peopleCount ?? null, aforoTs: ultimo?.timestamp.toISOString() || null, canal: ultimo?.channelName || null, eventos24h: n24,
        },
        vision: {
            enOmniVision: json<string[]>(camaras, []).includes(id),
            reglas: json<any[]>(reglas, []).filter((r) => r?.deviceId === id && r?.tipo === "fila").map((r) => ({ id: String(r.id), nombre: String(r.nombre || "Fila"), activa: r.activa !== false })),
            ultimoEvento: ultVision?.ts.toISOString() || null, eventos24h: nVision,
        },
    };
}

/**
 * Lo que la ficha cambia además de los datos del equipo (que guarda updateDevice): si se le habla
 * por HTTP (BOSCH_SOLO_HTTP, ver lib/onvif-polling) y si OmniVision mira la cámara (VISION_CAMARAS).
 * Si cambió la IP, la lista de HTTP se corrige con la nueva.
 */
export async function ajustesContadorFila(id: string, a: { soloHttp: boolean; enOmniVision: boolean; ipAnterior: string; ip: string }) {
    await exigir();
    const ips = lista(await leerSetting("BOSCH_SOLO_HTTP")).filter((x) => x !== a.ipAnterior && x !== a.ip);
    if (a.soloHttp) ips.push(a.ip);
    await escribirSetting("BOSCH_SOLO_HTTP", ips.join(","));
    const camaras = json<string[]>(await leerSetting("VISION_CAMARAS"), []).filter((x) => x !== id);
    if (a.enOmniVision) camaras.push(id);
    await escribirSetting("VISION_CAMARAS", JSON.stringify(camaras));
    revalidatePath("/admin/devices");
    return { ok: true };
}
