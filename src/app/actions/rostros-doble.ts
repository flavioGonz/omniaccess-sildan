"use server";

import { prisma } from "@/lib/prisma";
import { getSession } from "@/app/actions/auth";
import { permisosDeSesion } from "@/lib/permisos";
import { emparejar, resumen, type Par } from "@/lib/rostros-doble";

/**
 * La doble verificación: las pasadas por un portero o un control de acceso con las DOS opiniones
 * —la del equipo y la nuestra— una al lado de la otra.
 *
 * El emparejado vive en lib/rostros-doble (sin base, con pruebas); acá está sólo lo que hace
 * falta para traer los eventos y ponerles nombre de equipo.
 */

/** Los equipos que miran personas: son los únicos que pueden tener dos opiniones. */
const TIPOS = ["DOOR_INTERCOM", "ACCESS_CONTROL", "FACE_TERMINAL"] as const;
/** Tope de eventos por consulta: más que esto no entra en una pantalla y tarda. */
const MAX = 1500;
/** La clave de la característica. Apagada, la pantalla no se ofrece. */
export const CLAVE_DOBLE = "FACE_DOBLE_VERIFICACION";

export type PasadaDoble = Par & { equipoNombre: string | null };
export type RespuestaDoble = {
    prendida: boolean;
    pares: PasadaDoble[];
    resumen: ReturnType<typeof resumen>;
    equipos: { id: string; nombre: string; propias: number; delEquipo: number }[];
    desdeDias: number;
};

export async function pasadasDobles({ dias = 7, deviceId = null as string | null } = {}): Promise<RespuestaDoble> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- la sesión es el JWT crudo
    const s: any = await getSession().catch(() => null);
    const puede = permisosDeSesion(s || {});
    if (!s || !(puede.includes("vision.config") || puede.includes("rostros.listas"))) throw new Error("Tu rol no puede ver los rostros.");

    const prendida = (await prisma.setting.findUnique({ where: { key: CLAVE_DOBLE } }).catch(() => null))?.value === "true";
    const equipos = await prisma.device.findMany({
        where: { deviceType: { in: TIPOS as unknown as string[] } as never, ...(deviceId ? { id: deviceId } : {}) },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
    });
    const ids = equipos.map((e) => e.id);
    const desde = new Date(Date.now() - dias * 86_400_000);
    const eventos = ids.length
        ? await prisma.accessEvent.findMany({
            where: { deviceId: { in: ids }, timestamp: { gte: desde } },
            select: { id: true, deviceId: true, timestamp: true, details: true, accessType: true, userId: true, snapshotPath: true },
            orderBy: { timestamp: "desc" }, take: MAX,
        })
        : [];

    const nombre = new Map(equipos.map((e) => [e.id, e.name]));
    const pares = emparejar(eventos).map((p) => ({ ...p, equipoNombre: p.deviceId ? nombre.get(p.deviceId) || null : null }));

    /* Cuántos eventos puso cada lado, por equipo: es el número que explica un «no hay pares».
       En el lab, el portero tenía 42 nuestros y 0 del equipo — sin esto, la pantalla vacía no
       dice si falta la integración o si no pasó nadie. */
    const cuentas = new Map(ids.map((id) => [id, { propias: 0, delEquipo: 0 }]));
    for (const e of eventos) {
        const c = cuentas.get(e.deviceId || "");
        if (!c) continue;
        if (/Source:\s*OmniVision/i.test(e.details || "")) c.propias++; else c.delEquipo++;
    }

    return {
        prendida,
        pares,
        resumen: resumen(pares),
        equipos: equipos.map((e) => ({ id: e.id, nombre: e.name, ...(cuentas.get(e.id) || { propias: 0, delEquipo: 0 }) })),
        desdeDias: dias,
    };
}
