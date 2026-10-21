import { prisma } from "@/lib/prisma";
import type { AreaHistorial, DatosAreasHistorial } from "@/lib/filtro-areas";

/** Las áreas de Dispositivos con los nombres de sus cámaras (ver lib/filtro-areas). Sólo lectura. */
const CLAVE = "DEVICE_AREAS";

/** El árbol de áreas en orden (cada área seguida de las suyas, con su nivel) y en qué área está cada equipo. */
export type AreaArbol = { id: string; nombre: string; padre: string | null; color: string; nivel: number };
export async function leerArbolAreas(): Promise<{ areas: AreaArbol[]; equipoArea: Record<string, string> }> {
    let estado: { areas?: { id: string; nombre: string; padre: string | null; orden?: number; color?: string }[]; equipos?: Record<string, string> } = {};
    try { estado = JSON.parse((await prisma.setting.findUnique({ where: { key: CLAVE } }))?.value || "{}"); } catch { }
    const crudas = Array.isArray(estado.areas) ? estado.areas : [];
    const existe = new Set(crudas.map((a) => a.id));
    const hijos = (p: string | null) => crudas.filter((a) => (a.padre || null) === p).sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0));
    const areas: AreaArbol[] = [];
    const recorrer = (p: string | null, nivel: number) => {
        for (const a of hijos(p)) { areas.push({ id: a.id, nombre: a.nombre, padre: a.padre || null, color: a.color || "#64748b", nivel }); if (nivel < 20) recorrer(a.id, nivel + 1); }
    };
    recorrer(null, 0);
    const equipoArea: Record<string, string> = {};
    for (const [d, a] of Object.entries(estado.equipos || {})) if (existe.has(a)) equipoArea[d] = a;
    return { areas, equipoArea };
}

export async function leerAreasHistorial(): Promise<DatosAreasHistorial> {
    let estado: { areas?: { id: string; nombre: string; padre: string | null; orden?: number; color?: string }[]; equipos?: Record<string, string> } = {};
    try { estado = JSON.parse((await prisma.setting.findUnique({ where: { key: CLAVE } }))?.value || "{}"); } catch { }
    const areas = Array.isArray(estado.areas) ? estado.areas : [];
    const equipos = estado.equipos || {};
    if (!areas.length) return { areas: [], asignadas: [] };

    const padre = new Map(areas.map((a) => [a.id, a.padre]));
    const nombres = new Map((await prisma.device.findMany({ select: { id: true, name: true } })).map((d) => [d.id, d.name]));
    const porArea = new Map<string, Set<string>>(areas.map((a) => [a.id, new Set<string>()]));
    const asignadas = new Set<string>();
    for (const [deviceId, areaId] of Object.entries(equipos)) {
        const nombre = nombres.get(deviceId);
        if (!nombre || !padre.has(areaId)) continue; // equipo borrado, o área que ya no existe: queda «sin área»
        asignadas.add(nombre);
        // El equipo cuenta en su área y en todas las de arriba.
        let cur: string | null | undefined = areaId;
        for (let i = 0; cur && i < 100; i++) { porArea.get(cur)?.add(nombre); cur = padre.get(cur); }
    }

    // En el orden del árbol: cada área seguida de las suyas.
    const hijos = (p: string | null) => areas.filter((a) => (a.padre || null) === p).sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0));
    const out: AreaHistorial[] = [];
    const recorrer = (p: string | null, nivel: number) => {
        for (const a of hijos(p)) {
            out.push({ id: a.id, nombre: a.nombre, padre: a.padre || null, color: a.color || "#64748b", nivel, camaras: [...(porArea.get(a.id) || [])].sort() });
            if (nivel < 20) recorrer(a.id, nivel + 1);
        }
    };
    recorrer(null, 0);
    return { areas: out, asignadas: [...asignadas] };
}

/**
 * Los equipos de un ÁREA (con las de adentro), para filtrar una consulta por deviceId. Un canal de
 * NVR sin área propia cuenta en la de su grabador (NVR_CHANNEL_MAP), como en los monitores.
 * Devuelve { en } (sólo estos), { fuera } (todos menos estos: «Sin área») o null (sin filtro).
 */
export async function equiposDeArea(area: string | null | undefined): Promise<{ en: string[] } | { fuera: string[] } | null> {
    if (!area || area === "todas") return null;
    const { areas, equipoArea } = await leerArbolAreas();
    const { getChannelMap } = await import("@/lib/nvr-resolve");
    const mapa = await getChannelMap().catch(() => ({} as Record<string, { nvrId: string | null; ch: number }>));
    const areaDe = (id: string) => equipoArea[id] || (mapa[id]?.nvrId ? equipoArea[mapa[id].nvrId!] : undefined);
    const ids = new Set<string>([...Object.keys(equipoArea), ...Object.keys(mapa)]);
    const conArea = [...ids].filter((id) => areaDe(id));
    if (area === "__sin_area") return { fuera: conArea };
    if (!areas.some((a) => a.id === area)) return null;
    const bajo = new Set([area]);
    for (let cambio = true; cambio;) { cambio = false; for (const a of areas) if (a.padre && bajo.has(a.padre) && !bajo.has(a.id)) { bajo.add(a.id); cambio = true; } }
    return { en: conArea.filter((id) => bajo.has(areaDe(id)!)) };
}
