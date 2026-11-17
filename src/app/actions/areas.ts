"use server";

import { prisma } from "@/lib/prisma";
import { getSession } from "@/app/actions/auth";
import { APAGADO_SIN_AREA, CLAVE_APAGADOS, recalcularApagados } from "@/lib/apagado";

/**
 * Áreas: un árbol para agrupar equipos (Portería › Garita P1, Perímetro › Norte, …).
 *
 * Vive en un Setting (JSON) y no en una tabla: es organización visual del panel, no cambia
 * cómo funciona ningún equipo, y así no toca el esquema de la base. Un equipo está en un área
 * o en ninguna; un área puede tener sub-áreas.
 *
 * Borrar un área, por sí sola, NO borra equipos: sus equipos y sub-áreas suben al área padre.
 * Eso sorprendió (17/11, Nico: «eliminé áreas enteras, pero veo que aún siguen persistiendo
 * equipos de esas áreas»), y la sorpresa es razonable: si uno borra la carpeta espera que se
 * vaya lo de adentro. Por eso ahora hay que elegir: borrar sólo el área, o borrarla CON sus
 * equipos — y entonces se borran de verdad, de todo OmniAccess (lib/borrar-equipo).
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

/** Las áreas de la rama de `areaId` (ella y todas sus sub-áreas). */
function rama(areas: Area[], areaId: string): Set<string> {
    const out = new Set([areaId]);
    for (let n = 0; n < 50; n++) {
        const antes = out.size;
        for (const a of areas) if (a.padre && out.has(a.padre)) out.add(a.id);
        if (out.size === antes) break;
    }
    return out;
}

/**
 * Borra DE VERDAD los equipos de un área (y de sus sub-áreas), o los que no están en ninguna
 * (`areaId` en null). Cada uno se borra de todo OmniAccess: sus eventos, sus lecturas, sus
 * reglas, sus streams. Queda el registro en Auditoría.
 *
 * Pide «Editar dispositivos», como borrar un equipo de a uno. Que un equipo falle no frena a los
 * demás: se cuentan y se informan, porque a mitad de una limpieza de cincuenta equipos lo peor
 * que puede pasar es no saber cuáles quedaron.
 */
export async function borrarEquiposDeArea(areaId: string | null, soloVacios = false): Promise<{ borrados: number; fallaron: number; error?: string }> {
    const s: any = await getSession();
    if (!s) return { borrados: 0, fallaron: 0, error: "Hace falta una sesión del panel." };
    const { permisosDeSesion } = await import("@/lib/permisos");
    if (!permisosDeSesion(s).includes("dispositivos.editar")) return { borrados: 0, fallaron: 0, error: "Hace falta el permiso Editar dispositivos para borrar equipos." };

    const e = await leer();
    let ids = await idsDeArea(e, areaId);
    // La limpieza segura: sólo los que nunca registraron nada. Es lo que casi siempre se quiere
    // cuando se barren los sueltos — entre ellos suele haber cámaras que están trabajando.
    if (soloVacios) { const con = await conDatos(ids); ids = ids.filter((id) => !con.has(id)); }
    if (!ids.length) return { borrados: 0, fallaron: 0 };

    const { borrarEquipoDeTodo } = await import("@/lib/borrar-equipo");
    const quien = String(s.name || s.sub || "panel");
    let borrados = 0, fallaron = 0;
    for (const id of ids) {
        const r = await borrarEquipoDeTodo(id, quien).catch(() => ({ ok: false as const }));
        if (r.ok) borrados++; else fallaron++;
    }
    return { borrados, fallaron };
}

/**
 * Cuántos de esos equipos tienen algo guardado (lecturas, eventos, detecciones, fotos o una
 * analítica entrenable) y cuántos están vacíos.
 *
 * Es el aviso que faltaba. En el lab, de los 55 equipos sin área, 40 son cámaras que nunca
 * registraron nada —la basura que se quiere limpiar— y 15 están trabajando: las LPR interiores
 * de Cairoli, Fco. Simon, la florería… Borrar «todos los sueltos» de una pasada se llevaba esas
 * también, con sus avistamientos, y eso no se deshace. Así que antes de borrar se dice cuántos
 * son de cada clase.
 */
async function idsDeArea(e: EstadoAreas, areaId: string | null): Promise<string[]> {
    const dentro = areaId ? rama(e.areas, areaId) : null;
    const todos = await prisma.device.findMany({ select: { id: true } });
    return todos.map((d) => d.id).filter((id) => {
        const suya = e.equipos[id];
        return dentro ? !!suya && dentro.has(suya) : !suya || !e.areas.some((a) => a.id === suya);
    });
}

/** De esos equipos, los que tienen algo guardado. Una consulta por tabla, con `distinct`. */
async function conDatos(ids: string[]): Promise<Set<string>> {
    if (!ids.length) return new Set();
    const cuenta = async (f: () => Promise<{ deviceId: string | null }[]>) => (await f().catch(() => [])).map((x) => x.deviceId).filter(Boolean) as string[];
    return new Set<string>([
        ...await cuenta(() => prisma.plateSighting.findMany({ where: { deviceId: { in: ids } }, select: { deviceId: true }, distinct: ["deviceId"] })),
        ...await cuenta(() => prisma.accessEvent.findMany({ where: { deviceId: { in: ids } }, select: { deviceId: true }, distinct: ["deviceId"] })),
        ...await cuenta(() => prisma.detection.findMany({ where: { deviceId: { in: ids } }, select: { deviceId: true }, distinct: ["deviceId"] })),
        ...await cuenta(() => prisma.fotoEntrenamiento.findMany({ where: { deviceId: { in: ids } }, select: { deviceId: true }, distinct: ["deviceId"] })),
        ...await cuenta(() => prisma.zonaEntrenable.findMany({ where: { deviceId: { in: ids } }, select: { deviceId: true }, distinct: ["deviceId"] })),
    ]);
}

export async function resumenParaBorrar(areaId: string | null): Promise<{ total: number; conDatos: number; vacios: number }> {
    await conSesion();
    const ids = await idsDeArea(await leer(), areaId);
    if (!ids.length) return { total: 0, conDatos: 0, vacios: 0 };
    const con = await conDatos(ids);
    return { total: ids.length, conDatos: con.size, vacios: ids.length - con.size };
}

export async function borrarArea(areaId: string, conEquipos = false): Promise<EstadoAreas> {
    await conSesion();
    if (conEquipos) {
        const r = await borrarEquiposDeArea(areaId);
        if (r.error) throw new Error(r.error);
    }
    // Se vuelve a leer: borrar un equipo también lo saca de este mismo ajuste.
    const e = await leer();
    const a = e.areas.find((x) => x.id === areaId);
    if (!a) return e;
    if (conEquipos) {
        // Se llevó sus equipos: también se lleva sus sub-áreas, que quedarían vacías y sin sentido.
        const dentro = rama(e.areas, areaId);
        e.areas = e.areas.filter((x) => !dentro.has(x.id));
        for (const k of Object.keys(e.equipos)) if (dentro.has(e.equipos[k])) delete e.equipos[k];
        return escribir(e);
    }
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
