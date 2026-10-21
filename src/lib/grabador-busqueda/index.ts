import { prisma } from "@/lib/prisma";
import { camarasDelNvr } from "@/lib/acuseek-nvr";
import { hikvision } from "./hikvision";
import type { CapacidadesBusqueda, ConexionGrabador, DriverBusqueda } from "./tipos";
export type * from "./tipos";

/**
 * Qué driver de búsqueda tiene cada fabricante. Para sumar uno (Dahua «WizSense», Uniview…):
 * escribir su DriverBusqueda y agregarlo acá con la marca como está en Device.brand.
 */
const DRIVERS: Record<string, DriverBusqueda> = {
    HIKVISION: hikvision,
};
export const driverDe = (marca: string | null | undefined): DriverBusqueda | null => DRIVERS[String(marca || "").toUpperCase()] || null;

export type GrabadorConBusqueda = { id: string; nombre: string; marca: string; motor: string; c: ConexionGrabador; cap: CapacidadesBusqueda };

/*
 * Se le pregunta a cada grabador (en paralelo, con tope corto) qué sabe buscar. La respuesta se
 * guarda un rato y se vuelve a preguntar si cambian los grabadores dados de alta.
 */
const VIGENCIA_MS = 15 * 60_000;
const TOPE_MS = 7000;
const g = globalThis as unknown as { __grabBusq?: { firma: string; t: number; lista: GrabadorConBusqueda[] } };

export async function grabadoresConBusqueda(): Promise<GrabadorConBusqueda[]> {
    const nvrs = await prisma.device.findMany({ where: { deviceType: "NVR" }, orderBy: { createdAt: "asc" }, select: { id: true, name: true, ip: true, brand: true, username: true, password: true, authType: true, updatedAt: true } });
    const firma = nvrs.map((n) => `${n.id}:${n.updatedAt.getTime()}`).join("|");
    const c = g.__grabBusq;
    if (c && c.firma === firma && Date.now() - c.t < VIGENCIA_MS) return c.lista;
    const lista = (await Promise.all(nvrs.map(async (n): Promise<GrabadorConBusqueda | null> => {
        const d = driverDe(n.brand);
        if (!d || !n.ip) return null;
        const con: ConexionGrabador = { ip: n.ip, username: n.username || "admin", password: n.password || "", authType: n.authType || "DIGEST" };
        try {
            const cap = await Promise.race([d.capacidades(con), new Promise<never>((_, no) => setTimeout(() => no(new Error("tiempo")), TOPE_MS))]);
            return cap.texto || cap.imagen ? { id: n.id, nombre: n.name, marca: String(n.brand), motor: d.motor, c: con, cap } : null;
        } catch { return null; }
    }))).filter((x): x is GrabadorConBusqueda => !!x);
    g.__grabBusq = { firma, t: Date.now(), lista };
    return lista;
}

export async function grabadorPorId(id: string): Promise<GrabadorConBusqueda | null> {
    return (await grabadoresConBusqueda()).find((x) => x.id === id) || null;
}

/** Canal → cámara de OmniAccess (id, nombre, tipo) de ese grabador. */
export async function camarasDeGrabador(nvrId: string): Promise<Record<number, { id: string; nombre: string; tipo: string }>> {
    const base = await camarasDelNvr(nvrId);
    const ids = Object.values(base).map((x) => x.id);
    const tipos = ids.length ? new Map((await prisma.device.findMany({ where: { id: { in: ids } }, select: { id: true, deviceType: true } })).map((d) => [d.id, String(d.deviceType)])) : new Map();
    const out: Record<number, { id: string; nombre: string; tipo: string }> = {};
    for (const [ch, x] of Object.entries(base)) out[Number(ch)] = { ...x, tipo: tipos.get(x.id) || "CAMERA" };
    return out;
}
