"use server";
/**
 * Prender y apagar los avisos de salud de un equipo, o de todos los de un área (lib/avisos-equipo.ts).
 * Pide `dispositivos.editar` y queda en Auditoría con quién y qué cambió.
 *
 * Apagar un aviso cierra en silencio la alerta abierta de ese tipo: si no, quedaría prendida en la
 * tabla para siempre, porque ya nadie la va a resolver (el chequeo deja de mirarla).
 */
import { prisma } from "@/lib/prisma";
import { exigirPermiso } from "@/lib/permiso-servidor";
import { AVISOS, avisosDe, leerAjuste, prendido, type AjusteAvisos, type ClaveAviso } from "@/lib/avisos-equipo";
import { leerAreas } from "@/app/actions/areas";
import { ramaDe } from "@/lib/usuarios-equipo/areas";

/** Cómo empieza el texto de cada problema de imagen (lib/diagnostico-imagen, TEXTO): una sola alerta «imagen» los lleva. */
const INICIO_IMAGEN: Partial<Record<ClaveAviso, string>> = { tapada: "Imagen tapada", borrosa: "Imagen borrosa", movida: "Cámara movida" };

export async function leerAvisos(deviceId: string): Promise<AjusteAvisos> {
    await exigirPermiso("dispositivos", "ver avisos");
    const d = await prisma.device.findUnique({ where: { id: deviceId }, select: { avisos: true } });
    return leerAjuste(d?.avisos);
}

/** Lo que se guarda en un equipo: sólo los avisos que le corresponden por tipo, y Telegram. */
function paraEquipo(deviceType: string, previo: AjusteAvisos, cambio: AjusteAvisos): AjusteAvisos {
    const validas = new Set<string>([...avisosDe(deviceType).map((a) => a.clave), "telegram"]);
    const out: AjusteAvisos = { ...previo };
    for (const [k, v] of Object.entries(leerAjuste(cambio))) if (validas.has(k)) (out as any)[k] = v;
    return out;
}

async function cerrarApagadas(deviceId: string, aj: AjusteAvisos) {
    const abiertas = await prisma.deviceAlert.findMany({ where: { deviceId, active: true } });
    for (const a of abiertas) {
        const clave = a.type === "imagen"
            ? (Object.entries(INICIO_IMAGEN).find(([, ini]) => a.message.startsWith(ini!))?.[0] as ClaveAviso | undefined)
            : AVISOS.find((x) => x.clave === a.type)?.clave;
        if (clave && !prendido(aj, clave)) await prisma.deviceAlert.update({ where: { id: a.id }, data: { active: false, resolvedAt: new Date() } });
    }
}

const resumen = (aj: AjusteAvisos) => [...AVISOS.map((a) => [a.clave, a.rotulo] as const), ["telegram", "Telegram"] as const]
    .filter(([k]) => k in aj).map(([k, r]) => `${r}: ${(aj as any)[k] ? "sí" : "no"}`).join(" · ");

export async function guardarAvisos(deviceId: string, cambio: AjusteAvisos): Promise<AjusteAvisos> {
    const s = await exigirPermiso("dispositivos.editar", "cambiar avisos");
    const d = await prisma.device.findUnique({ where: { id: deviceId }, select: { id: true, name: true, deviceType: true, avisos: true } });
    if (!d) throw new Error("No existe ese equipo.");
    const aj = paraEquipo(String(d.deviceType), leerAjuste(d.avisos), cambio);
    await prisma.device.update({ where: { id: d.id }, data: { avisos: aj as any } });
    await cerrarApagadas(d.id, aj);
    await prisma.accionSistema.create({ data: { quien: String(s?.name || s?.sub || "panel"), accion: "Cambió los avisos de un equipo", objetivo: d.name, ok: true, detalle: resumen(leerAjuste(cambio)).slice(0, 500) } }).catch(() => { });
    return aj;
}

/** El mismo cambio a todos los equipos del área y sus sub-áreas. Devuelve cuántos se tocaron. */
export async function aplicarAvisosArea(areaId: string, cambio: AjusteAvisos): Promise<{ equipos: number }> {
    const s = await exigirPermiso("dispositivos.editar", "cambiar avisos del área");
    const estado = await leerAreas();
    const area = estado.areas.find((a) => a.id === areaId);
    if (!area) throw new Error("No existe esa área.");
    const rama = ramaDe(estado, areaId);
    const ids = Object.entries(estado.equipos).filter(([, a]) => rama.has(a)).map(([id]) => id);
    const equipos = await prisma.device.findMany({ where: { id: { in: ids } }, select: { id: true, deviceType: true, avisos: true } });
    let n = 0;
    for (const d of equipos) {
        if (!avisosDe(String(d.deviceType)).length) continue;
        const aj = paraEquipo(String(d.deviceType), leerAjuste(d.avisos), cambio);
        await prisma.device.update({ where: { id: d.id }, data: { avisos: aj as any } });
        await cerrarApagadas(d.id, aj);
        n++;
    }
    await prisma.accionSistema.create({ data: { quien: String(s?.name || s?.sub || "panel"), accion: "Cambió los avisos de un área", objetivo: area.nombre, ok: true, detalle: `${n} equipos · ${resumen(leerAjuste(cambio))}`.slice(0, 500) } }).catch(() => { });
    return { equipos: n };
}
