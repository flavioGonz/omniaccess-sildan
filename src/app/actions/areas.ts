"use server";

import { prisma } from "@/lib/prisma";
import { getSession } from "@/app/actions/auth";
import { APAGADO_SIN_AREA, CLAVE_APAGADOS, recalcularApagados } from "@/lib/apagado";

/**
 * Áreas: un árbol para agrupar equipos (Portería › Garita P1, Perímetro › Norte, …).
 *
 * Vive en un Setting (JSON) y no en una tabla: es organización visual del panel, no cambia
 * cómo funciona ningún equipo, y así no toca el esquema de la base. Un equipo está en un área
 * o en ninguna; un área puede tener sub-áreas. Borrar un área no borra equipos: sus equipos y
 * sub-áreas suben al área padre.
 */
const CLAVE = "DEVICE_AREAS";

/**
 * `cuentas`: la gestión de las cuentas locales de los equipos del área (openspec usuarios-de-equipos).
 * Sin el campo, el área hereda el de su madre; la raíz y «Sin área» no se gestionan (lib/usuarios-equipo/areas).
 */
export type Area = { id: string; nombre: string; padre: string | null; orden: number; color: string; cuentas?: { gestionada: boolean; roles: string[] } };
/** `apagadas`: áreas, «Sin área» o tipos apagados (lib/apagado). */
export type EstadoAreas = { areas: Area[]; equipos: Record<string, string>; apagadas?: string[] };

const COLORES = ["#6366f1", "#10b981", "#f59e0b", "#ef4444", "#0ea5e9", "#8b5cf6", "#ec4899", "#14b8a6"];

async function conSesion() { if (!(await getSession())) throw new Error("Hace falta una sesión del panel."); }

async function leer(): Promise<EstadoAreas> {
    try {
        const v = (await prisma.setting.findUnique({ where: { key: CLAVE } }))?.value;
        const j = v ? JSON.parse(v) : {};
        return { areas: Array.isArray(j.areas) ? j.areas : [], equipos: j.equipos && typeof j.equipos === "object" ? j.equipos : {}, apagadas: Array.isArray(j.apagadas) ? j.apagadas.map(String) : [] };
    } catch { return { areas: [], equipos: {}, apagadas: [] }; }
}
async function escribir(e: EstadoAreas) {
    // Un área borrada no queda apagada (su id ya no existe): limpiar para que no quede basura.
    const vivas = new Set(e.areas.map((a) => a.id));
    e.apagadas = (e.apagadas || []).filter((x) => vivas.has(x) || x === APAGADO_SIN_AREA || x.startsWith("tipo:"));
    const value = JSON.stringify(e);
    await prisma.setting.upsert({ where: { key: CLAVE }, update: { value }, create: { key: CLAVE, value } });
    // Mover equipos o áreas puede meter un equipo en un área apagada (o sacarlo): se recalcula.
    if (e.apagadas.length || (await hayApagadosGuardados())) await recalcularApagados(e).catch((er) => console.error("[areas] apagado:", er?.message));
    return e;
}
async function hayApagadosGuardados() {
    try { const v = (await prisma.setting.findUnique({ where: { key: CLAVE_APAGADOS } }))?.value; return JSON.parse(v || "[]").length > 0; } catch { return false; }
}

/**
 * Apaga o prende un área (id), «Sin área» (APAGADO_SIN_AREA) o un tipo («tipo:<vista>»). Pide el
 * permiso Ajustes: deja sin vivo ni análisis a cámaras enteras.
 */
export async function apagarGrupo(clave: string, apagar: boolean): Promise<EstadoAreas & { resumen: { apagados: number; cambiaron: number } }> {
    const s: any = await getSession();
    if (!s) throw new Error("Hace falta una sesión del panel.");
    const { permisosDeSesion } = await import("@/lib/permisos");
    if (!permisosDeSesion(s).includes("ajustes")) throw new Error("Sólo quien tiene Ajustes puede apagar un área.");
    const e = await leer();
    const valida = clave === APAGADO_SIN_AREA || clave.startsWith("tipo:") || e.areas.some((a) => a.id === clave);
    if (!valida) throw new Error("No existe eso para apagar.");
    const set = new Set(e.apagadas || []);
    if (apagar) set.add(clave); else set.delete(clave);
    e.apagadas = [...set];
    const value = JSON.stringify(e);
    await prisma.setting.upsert({ where: { key: CLAVE }, update: { value }, create: { key: CLAVE, value } });
    const r = await recalcularApagados(e);
    return { ...e, resumen: { apagados: r.apagados, cambiaron: apagar ? r.apagadosAhora.length : r.prendidosAhora.length } };
}
const id = () => "ar_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
/** ¿`posible` está dentro del subárbol de `raiz`? (para no colgar un área de su propia rama) */
function descendiente(areas: Area[], raiz: string, posible: string | null): boolean {
    let cur = posible;
    for (let i = 0; cur && i < 100; i++) { if (cur === raiz) return true; cur = areas.find((a) => a.id === cur)?.padre ?? null; }
    return false;
}

export async function leerAreas(): Promise<EstadoAreas> { await conSesion(); return leer(); }

export async function crearArea(nombre: string, padre: string | null): Promise<EstadoAreas> {
    await conSesion();
    const e = await leer();
    const n = String(nombre || "").trim().slice(0, 60) || "Nueva área";
    if (padre && !e.areas.some((a) => a.id === padre)) padre = null;
    const hermanos = e.areas.filter((a) => a.padre === padre);
    e.areas.push({ id: id(), nombre: n, padre, orden: hermanos.length, color: COLORES[e.areas.length % COLORES.length] });
    return escribir(e);
}

export async function editarArea(areaId: string, cambios: { nombre?: string; color?: string }): Promise<EstadoAreas> {
    await conSesion();
    const e = await leer();
    const a = e.areas.find((x) => x.id === areaId);
    if (a) {
        if (cambios.nombre !== undefined) a.nombre = String(cambios.nombre).trim().slice(0, 60) || a.nombre;
        if (cambios.color && /^#[0-9a-f]{6}$/i.test(cambios.color)) a.color = cambios.color;
    }
    return escribir(e);
}

export async function borrarArea(areaId: string): Promise<EstadoAreas> {
    await conSesion();
    const e = await leer();
    const a = e.areas.find((x) => x.id === areaId);
    if (!a) return e;
    for (const h of e.areas) if (h.padre === areaId) h.padre = a.padre;
    for (const k of Object.keys(e.equipos)) if (e.equipos[k] === areaId) { if (a.padre) e.equipos[k] = a.padre; else delete e.equipos[k]; }
    e.areas = e.areas.filter((x) => x.id !== areaId);
    return escribir(e);
}

/** Mueve un área bajo otra (o a la raíz con null) y la deja en la posición `indice` entre sus hermanas. */
export async function moverArea(areaId: string, nuevoPadre: string | null, indice?: number): Promise<EstadoAreas> {
    await conSesion();
    const e = await leer();
    const a = e.areas.find((x) => x.id === areaId);
    if (!a) return e;
    if (nuevoPadre && (nuevoPadre === areaId || descendiente(e.areas, areaId, nuevoPadre))) throw new Error("Un área no puede ir adentro de sí misma.");
    a.padre = nuevoPadre;
    const hermanas = e.areas.filter((x) => x.padre === nuevoPadre && x.id !== areaId).sort((x, y) => x.orden - y.orden);
    const pos = indice === undefined ? hermanas.length : Math.max(0, Math.min(indice, hermanas.length));
    hermanas.splice(pos, 0, a);
    hermanas.forEach((h, i) => (h.orden = i));
    return escribir(e);
}

/** Pone equipos en un área (null = sacarlos de toda área). */
export async function asignarEquipos(deviceIds: string[], areaId: string | null): Promise<EstadoAreas> {
    await conSesion();
    const e = await leer();
    if (areaId && !e.areas.some((a) => a.id === areaId)) throw new Error("El área no existe.");
    for (const d of deviceIds || []) { if (areaId) e.equipos[String(d)] = areaId; else delete e.equipos[String(d)]; }
    return escribir(e);
}
