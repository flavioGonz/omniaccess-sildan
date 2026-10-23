"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { getSession } from "@/app/actions/auth";
import { nuevoToken, hashToken, olvidarVigencia } from "@/lib/pantalla-auth";
import { esVista, vistaPorClave, CLAVES_VISTAS, type ClaveVista } from "@/lib/monitor/vistas";
import { permisosDeSesion } from "@/lib/permisos";
import { AJUSTE_VISTAS_CAMARAS, VISTAS_CAMARAS_MAX, vistaValida, leerVistas, type VistaCamaras } from "@/lib/monitor/disposiciones";
import { AJUSTE_ROTACION_VISTAS, AJUSTE_ROTACION_SEG, ROTACION_SEG_MIN, ROTACION_SEG_POR_DEFECTO, ROTACION_VISTAS_POR_DEFECTO } from "@/lib/monitor/ajustes";

/**
 * Monitores: emitir y revocar enlaces de pantalla, y los ajustes de cada vista.
 *
 * Todo acá exige una SESIÓN con el permiso `monitores`. Un enlace de pantalla no puede
 * llamar a nada de esto: las acciones del servidor se ejecutan desde /admin/monitores,
 * que el middleware no abre con la cookie de pantalla, y además `exigirMonitores` lee la
 * cookie `session`, que una pantalla no tiene.
 */

/** Ver la lista pide Monitores; crear enlaces, diseñar vistas, sonido y rotación, Configurar monitores. */
async function exigirMonitores(nivel: "monitores" | "monitores.config" = "monitores.config") {
    const s: any = await getSession();
    if (!permisosDeSesion(s).includes(nivel)) throw new Error(nivel === "monitores" ? "No tenés permiso para ver los monitores." : "Hace falta el permiso Configurar monitores.");
    return s;
}

export type EnlaceListado = { id: string; nombre: string; vista: ClaveVista; creadoPor: string | null; creadoEn: string; ultimoUsoEn: string | null; ultimoUsoIp: string | null; revocadoEn: string | null };

export async function listarEnlacesPantalla(): Promise<EnlaceListado[]> {
    await exigirMonitores("monitores");
    const filas = await prisma.enlacePantalla.findMany({ orderBy: [{ revocadoEn: "asc" }, { creadoEn: "desc" }] });
    return filas.filter((f) => esVista(f.vista)).map((f) => ({
        id: f.id, nombre: f.nombre, vista: f.vista as ClaveVista, creadoPor: f.creadoPor, creadoEn: f.creadoEn.toISOString(),
        ultimoUsoEn: f.ultimoUsoEn ? f.ultimoUsoEn.toISOString() : null, ultimoUsoIp: f.ultimoUsoIp, revocadoEn: f.revocadoEn ? f.revocadoEn.toISOString() : null,
    }));
}

/** Crea el enlace y devuelve el token UNA sola vez: no se guarda ni se puede volver a ver. */
export async function crearEnlacePantalla(data: { nombre: string; vista: string }): Promise<{ ok: true; id: string; token: string; url: string } | { ok: false; error: string }> {
    const s = await exigirMonitores();
    const nombre = (data.nombre || "").trim();
    if (!nombre) return { ok: false, error: "El enlace necesita un nombre: dónde va a estar esa pantalla." };
    if (!esVista(data.vista)) return { ok: false, error: "Esa vista no existe." };
    const token = nuevoToken();
    const e = await prisma.enlacePantalla.create({ data: { nombre, vista: data.vista, tokenHash: hashToken(token), creadoPor: s?.name || s?.sub || null } });
    revalidatePath("/admin/monitores");
    return { ok: true, id: e.id, token, url: `/monitor/${data.vista}?pantalla=${token}` };
}

export async function revocarEnlacePantalla(id: string): Promise<{ ok: boolean }> {
    await exigirMonitores();
    await prisma.enlacePantalla.update({ where: { id }, data: { revocadoEn: new Date() } });
    olvidarVigencia(id);
    revalidatePath("/admin/monitores");
    return { ok: true };
}

// ── Ajustes de las vistas (sonido por vista, rotación) ────────────────────────────────

type AjustesMonitores = { sonido: Record<string, string>; rotacion: { vistas: ClaveVista[]; segundos: number } };

/** Los ajustes de todas las vistas. Lo leen el menú (con sesión) y las propias vistas vía /api/monitor/marco. */
export async function leerAjustesMonitores(): Promise<AjustesMonitores> {
    const claves = [AJUSTE_ROTACION_VISTAS, AJUSTE_ROTACION_SEG, ...CLAVES_VISTAS.map((c) => vistaPorClave(c)?.sonido?.ajuste).filter(Boolean) as string[]];
    const filas = await prisma.setting.findMany({ where: { key: { in: claves } } }).catch(() => []);
    const v = (k: string) => filas.find((f) => f.key === k)?.value;
    const sonido: Record<string, string> = {};
    for (const c of CLAVES_VISTAS) { const a = vistaPorClave(c)?.sonido; if (a) sonido[c] = a.modos.some((m) => m.valor === v(a.ajuste)) ? (v(a.ajuste) as string) : a.modos[0].valor; }
    let vistas: ClaveVista[] = [];
    try { vistas = (JSON.parse(v(AJUSTE_ROTACION_VISTAS) || "[]") as string[]).filter((x) => esVista(x) && x !== "rotacion") as ClaveVista[]; } catch { }
    if (!vistas.length) vistas = [...ROTACION_VISTAS_POR_DEFECTO];
    const seg = parseInt(v(AJUSTE_ROTACION_SEG) || "", 10);
    return { sonido, rotacion: { vistas, segundos: Number.isFinite(seg) ? Math.max(ROTACION_SEG_MIN, seg) : ROTACION_SEG_POR_DEFECTO } };
}

export async function guardarAjusteSonido(vista: string, modo: string): Promise<{ ok: boolean; error?: string }> {
    await exigirMonitores();
    const a = esVista(vista) ? vistaPorClave(vista)?.sonido : null;
    if (!a || !a.modos.some((m) => m.valor === modo)) return { ok: false, error: "Modo de sonido desconocido." };
    await prisma.setting.upsert({ where: { key: a.ajuste }, update: { value: modo }, create: { key: a.ajuste, value: modo } });
    revalidatePath("/admin/monitores");
    return { ok: true };
}

export async function guardarRotacion(data: { vistas: string[]; segundos: number }): Promise<{ ok: boolean; error?: string }> {
    await exigirMonitores();
    const vistas = (data.vistas || []).filter((x) => esVista(x) && x !== "rotacion");
    if (vistas.length < 2) return { ok: false, error: "La rotación necesita al menos dos vistas." };
    const segundos = Math.max(ROTACION_SEG_MIN, Math.round(Number(data.segundos) || ROTACION_SEG_POR_DEFECTO));
    await prisma.setting.upsert({ where: { key: AJUSTE_ROTACION_VISTAS }, update: { value: JSON.stringify(vistas) }, create: { key: AJUSTE_ROTACION_VISTAS, value: JSON.stringify(vistas) } });
    await prisma.setting.upsert({ where: { key: AJUSTE_ROTACION_SEG }, update: { value: String(segundos) }, create: { key: AJUSTE_ROTACION_SEG, value: String(segundos) } });
    revalidatePath("/admin/monitores");
    return { ok: true };
}

// ── Vistas diseñadas de la pared de cámaras ───────────────────────────────────────────

/**
 * ¿Quien mira puede diseñar vistas? Lo pregunta /api/monitor/camaras para mostrar o no el
 * botón: un enlace de pantalla no tiene sesión, y un operador sin el permiso no las cambia.
 */
export async function puedeDisenarVistas(): Promise<boolean> {
    try { const s: any = await getSession(); return !!s && permisosDeSesion(s).includes("monitores.config"); } catch { return false; }
}

async function vistasGuardadas() {
    const fila = await prisma.setting.findUnique({ where: { key: AJUSTE_VISTAS_CAMARAS } });
    return leerVistas(fila?.value);
}
async function escribirVistas(vistas: VistaCamaras[]) {
    const value = JSON.stringify(vistas);
    await prisma.setting.upsert({ where: { key: AJUSTE_VISTAS_CAMARAS }, update: { value }, create: { key: AJUSTE_VISTAS_CAMARAS, value } });
}

/** Crea (sin id) o reemplaza (con id) una vista. Las ven todas las pantallas en la próxima vuelta. */
export async function guardarVistaCamaras(data: unknown): Promise<{ ok: true; vista: VistaCamaras } | { ok: false; error: string }> {
    await exigirMonitores();
    const v = vistaValida(data);
    if (!v) return { ok: false, error: "La vista necesita un nombre y una disposición." };
    if (!v.canales.some(Boolean)) return { ok: false, error: "Poné al menos una cámara en la vista." };
    const vistas = await vistasGuardadas();
    const i = v.id ? vistas.findIndex((x) => x.id === v.id) : -1;
    if (i < 0 && vistas.length >= VISTAS_CAMARAS_MAX) return { ok: false, error: `Ya hay ${VISTAS_CAMARAS_MAX} vistas: borrá alguna antes.` };
    const vista = { ...v, id: i >= 0 ? v.id : `v${Date.now().toString(36)}` };
    if (i >= 0) vistas[i] = vista; else vistas.push(vista);
    await escribirVistas(vistas);
    return { ok: true, vista };
}

export async function borrarVistaCamaras(id: string): Promise<{ ok: boolean }> {
    await exigirMonitores();
    const vistas = await vistasGuardadas();
    await escribirVistas(vistas.filter((x) => x.id !== id));
    return { ok: true };
}
