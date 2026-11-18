"use server";

import { prisma } from "@/lib/prisma";
import { getSession } from "@/app/actions/auth";
import { permisosDeSesion } from "@/lib/permisos";
import { TIPOS_CARA } from "@/lib/caras-vivo";
import { leerDetalleRostro } from "@/lib/monitor/rostro";

/**
 * La bitácora de los equipos de acceso: quién pasó por cada portero y control de acceso.
 *
 * Pedido de Nico (18/11): «creo que debemos crear una sección nueva: Bitácora de equipos, y
 * concentrar las lecturas en vivo, historial de lectura de porteros y controles de acceso».
 *
 * Por qué una pantalla aparte y no un filtro del Historial: el Historial es de matrículas y está
 * armado para eso —una fila por lectura, la chapa como sujeto—. Acá el sujeto es una PERSONA
 * frente a una puerta, y lo que se viene a mirar es su cara. Son dos lecturas distintas del mismo
 * registro, y meterlas en la misma tabla obliga a que una de las dos quede incómoda.
 *
 * Lo que hay de cada pasada depende de quién la contó: el equipo sabe a quién reconoció y con qué
 * (tarjeta, rostro, PIN); nosotros sabemos qué cara vimos y cuánto se parecía. Se muestran las
 * dos cosas y se dice cuál es cuál — de dónde sale un dato es parte del dato.
 */

const MAX = 400;

/** ¿Esta instalación tiene algún portero o control de acceso? El menú no ofrece una sección vacía. */
export async function hayEquiposDeAcceso(): Promise<boolean> {
    return (await prisma.device.count({ where: { deviceType: { in: TIPOS_CARA as unknown as string[] } as never } }).catch(() => 0)) > 0;
}

export type PasoEquipo = {
    id: string;
    cuando: string;
    deviceId: string | null;
    equipo: string;
    /** "equipo" (lo contó el portero) | "omnivision" (lo vimos nosotros). */
    fuente: "equipo" | "omnivision";
    decision: string | null;
    /** TAG | FACE | PIN | FINGERPRINT | null. */
    tipo: string | null;
    persona: string | null;
    /** El legajo o la tarjeta, cuando el equipo lo dice. */
    credencial: string | null;
    similitud: number | null;
    /** El recorte de la cara (nuestro) o la foto del paso. */
    cara: string | null;
    foto: string | null;
    sentido: string | null;
    detalle: string | null;
    /** Está en el padrón (el evento quedó atado a una persona). */
    registrado: boolean;
};

export type EquipoDeAcceso = {
    id: string; nombre: string; ip: string; tipo: string; ubicacion: string | null;
    hoy: number; ultima: string | null;
    /** Cuántas pasadas contó cada lado en el período: dice si al equipo se lo está escuchando. */
    delEquipo: number; propias: number;
};

export type BitacoraEquipos = {
    pasos: PasoEquipo[];
    equipos: EquipoDeAcceso[];
    desdeDias: number;
    /** Cuántas pasadas hay por día en el período, para la tira de arriba. */
    porDia: { dia: string; n: number }[];
};

const esNuestro = (d: string | null) => /Source:\s*OmniVision/i.test(d || "");

export async function bitacoraEquipos({ dias = 7, deviceId = null as string | null, q = "" } = {}): Promise<BitacoraEquipos> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- la sesión es el JWT crudo
    const s: any = await getSession().catch(() => null);
    if (!s || !permisosDeSesion(s).includes("historial")) throw new Error("Tu rol no puede ver el historial.");

    const equipos = await prisma.device.findMany({
        where: { deviceType: { in: TIPOS_CARA as unknown as string[] } as never },
        select: { id: true, name: true, ip: true, deviceType: true, location: true },
        orderBy: { name: "asc" },
    });
    const ids = equipos.map((e) => e.id).filter((id) => !deviceId || id === deviceId);
    const desde = new Date(Date.now() - dias * 86_400_000);
    const filas = ids.length
        ? await prisma.accessEvent.findMany({
            where: {
                deviceId: { in: ids }, timestamp: { gte: desde },
                ...(q ? { OR: [{ details: { contains: q, mode: "insensitive" } }, { credentialId: { contains: q, mode: "insensitive" } }, { user: { name: { contains: q, mode: "insensitive" } } }] } : {}),
            },
            select: {
                id: true, deviceId: true, timestamp: true, details: true, accessType: true, decision: true,
                direction: true, credentialId: true, snapshotPath: true, imagePath: true,
                user: { select: { name: true } },
            },
            orderBy: { timestamp: "desc" }, take: MAX,
        })
        : [];

    const nombre = new Map(equipos.map((e) => [e.id, e.name]));
    const pasos: PasoEquipo[] = filas.map((f) => {
        const nuestro = esNuestro(f.details);
        const dr = nuestro ? leerDetalleRostro(f.details) : null;
        /* El equipo escribe «Rostro reconocido · «Ana» · legajo 1108 · #acs16272»; nosotros,
           «Rostro: Ana, Similitud: 88%, …». Cada uno se lee con su forma y no se mezclan. */
        const delEquipo = !nuestro ? /«([^»]+)»/.exec(f.details || "")?.[1] || null : null;
        return {
            id: f.id,
            cuando: f.timestamp.toISOString(),
            deviceId: f.deviceId,
            equipo: (f.deviceId && nombre.get(f.deviceId)) || "—",
            fuente: nuestro ? "omnivision" : "equipo",
            decision: f.decision || null,
            tipo: f.accessType || null,
            persona: f.user?.name || dr?.nombre || delEquipo || null,
            credencial: f.credentialId || /legajo\s+([^\s·,]+)/i.exec(f.details || "")?.[1] || null,
            similitud: dr?.similitud ?? null,
            cara: dr?.recorte || null,
            foto: f.snapshotPath || f.imagePath || null,
            sentido: f.direction || null,
            detalle: f.details || null,
            registrado: !!f.user?.name,
        };
    });

    const hoy0 = new Date(); hoy0.setHours(0, 0, 0, 0);
    const cuenta = new Map<string, { hoy: number; ultima: string | null; delEquipo: number; propias: number }>();
    for (const e of equipos) cuenta.set(e.id, { hoy: 0, ultima: null, delEquipo: 0, propias: 0 });
    for (const p of pasos) {
        const c = p.deviceId ? cuenta.get(p.deviceId) : null;
        if (!c) continue;
        if (new Date(p.cuando) >= hoy0) c.hoy++;
        if (!c.ultima) c.ultima = p.cuando;
        if (p.fuente === "equipo") c.delEquipo++; else c.propias++;
    }

    const porDia = new Map<string, number>();
    for (const p of pasos) {
        const d = p.cuando.slice(0, 10);
        porDia.set(d, (porDia.get(d) || 0) + 1);
    }

    return {
        pasos,
        equipos: equipos.map((e) => ({
            id: e.id, nombre: e.name, ip: e.ip, tipo: String(e.deviceType), ubicacion: e.location,
            ...(cuenta.get(e.id) || { hoy: 0, ultima: null, delEquipo: 0, propias: 0 }),
        })),
        desdeDias: dias,
        porDia: [...porDia.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([dia, n]) => ({ dia, n })),
    };
}
