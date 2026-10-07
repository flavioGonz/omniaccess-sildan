import { prisma } from "@/lib/prisma";
import { leerHorario, describirHorario, armadaAhora, type Horario, type TipoRegla } from "@/lib/isapi-horarios";

/**
 * Los horarios de armado de las cámaras de intrusión, leídos de las cámaras.
 *
 * Salió de /api/intrusion/horarios cuando la vista de pantalla Intrusión necesitó lo mismo:
 * una lectura ISAPI por regla y por cámara es lenta (dos pedidos por cámara) y un monitor
 * de pared la pediría cada 30 s. Por eso acá hay una versión con caché de 5 minutos, que
 * es la cadencia con la que el propio monitor del panel ya la refrescaba.
 */

export type EstadoHorario = { horario: Horario; texto: string; armadaAhora: boolean } | null;
export type HorariosDeCamara = { name: string; linea: EstadoHorario; zona: EstadoHorario };

/** Las cámaras que vigilan intrusión: Hikvision, de tipo CAMERA o interior. */
export async function camarasDeIntrusion(deviceId?: string) {
    return prisma.device.findMany({
        where: { brand: "HIKVISION", ...(deviceId ? { id: deviceId } : { deviceType: { in: ["CAMERA", "LPR_INTERIOR"] as any } }) },
        select: { id: true, name: true, ip: true, username: true, password: true, authType: true },
        orderBy: { name: "asc" },
    });
}

export async function leerDeCamara(cam: any): Promise<Record<TipoRegla, EstadoHorario>> {
    const out: Record<TipoRegla, EstadoHorario> = { linea: null, zona: null };
    for (const tipo of ["linea", "zona"] as TipoRegla[]) {
        try { const h = await leerHorario(cam, tipo); out[tipo] = h ? { horario: h, texto: describirHorario(h), armadaAhora: armadaAhora(h) } : null; }
        catch { out[tipo] = null; }
    }
    return out;
}

const CACHE_MS = 5 * 60 * 1000;
let cache: { ts: number; datos: Record<string, HorariosDeCamara> } | null = null;
let enCurso: Promise<Record<string, HorariosDeCamara>> | null = null;

/** Todas las cámaras, con caché de 5 min y una sola lectura en curso aunque pregunten varios monitores a la vez. */
export async function horariosDeTodas(forzar = false): Promise<Record<string, HorariosDeCamara>> {
    if (!forzar && cache && Date.now() - cache.ts < CACHE_MS) {
        // `armadaAhora` depende de la hora: se recalcula sobre el horario cacheado, que no cambia.
        const out: Record<string, HorariosDeCamara> = {};
        for (const [id, h] of Object.entries(cache.datos)) out[id] = { name: h.name, linea: h.linea && { ...h.linea, armadaAhora: armadaAhora(h.linea.horario) }, zona: h.zona && { ...h.zona, armadaAhora: armadaAhora(h.zona.horario) } };
        return out;
    }
    if (enCurso) return enCurso;
    enCurso = (async () => {
        const cams = await camarasDeIntrusion();
        const datos: Record<string, HorariosDeCamara> = {};
        await Promise.all(cams.map(async (c) => { datos[c.id] = { name: c.name, ...(await leerDeCamara(c)) }; }));
        cache = { ts: Date.now(), datos };
        enCurso = null;
        return datos;
    })();
    return enCurso;
}

/** Al escribir un horario, que la próxima lectura vaya a la cámara. */
export function olvidarHorarios() { cache = null; }
