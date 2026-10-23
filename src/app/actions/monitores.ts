"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { getSession } from "@/app/actions/auth";
import { nuevoToken, hashToken, olvidarVigencia } from "@/lib/pantalla-auth";
import { esVista, vistaPorClave, CLAVES_VISTAS, type ClaveVista } from "@/lib/monitor/vistas";
import { permisosDeSesion } from "@/lib/permisos";
import { AJUSTE_VISTAS_CAMARAS, VISTAS_CAMARAS_MAX, vistaValida, leerVistas, type VistaCamaras } from "@/lib/monitor/disposiciones";
import { AJUSTE_FUENTES_WEB, FUENTES_WEB_MAX, fuenteValida, leerFuentes, problemaDeUrl, prohibeMarco, type AvisoFuente, type FuenteWeb } from "@/lib/monitor/fuentes-web";
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

// ── Fuentes web de la pared de cámaras (openspec pared-vms) ───────────────────────────

async function fuentesGuardadas() {
    const fila = await prisma.setting.findUnique({ where: { key: AJUSTE_FUENTES_WEB } });
    return leerFuentes(fila?.value);
}
async function escribirFuentes(fuentes: FuenteWeb[]) {
    const value = JSON.stringify(fuentes);
    await prisma.setting.upsert({ where: { key: AJUSTE_FUENTES_WEB }, update: { value }, create: { key: AJUSTE_FUENTES_WEB, value } });
}

/** El catálogo, con sus avisos, para la sección «Páginas web» de Monitores. */
export async function listarFuentesWeb(): Promise<FuenteWeb[]> {
    await exigirMonitores("monitores");
    return fuentesGuardadas();
}

/**
 * Lo que se puede saber desde el servidor de si la página se va a ver en la pared: si el sitio
 * prohíbe mostrarse en un marco, si es http dentro de un panel https, si contesta. Son avisos: que
 * el servidor no llegue no prueba que la PC de la pared no llegue (una herramienta de la LAN).
 * Se leen sólo los encabezados; el cuerpo se descarta.
 */
async function revisarFuente(url: string): Promise<AvisoFuente[]> {
    const avisos: AvisoFuente[] = [];
    try {
        const h = await headers();
        const proto = (h.get("x-forwarded-proto") || "").split(",")[0].trim() || (h.get("origin") || h.get("referer") || "").split(":")[0];
        if (url.startsWith("http:") && proto === "https") avisos.push("http-en-https");
    } catch { /* sin encabezados: no se sabe */ }
    let actual = url;
    try {
        for (let saltos = 0; saltos <= REVISAR_SALTOS; saltos++) {
            const r = await fetch(actual, { method: "GET", redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(REVISAR_MS), headers: { "user-agent": "OmniAccess (revisar fuente web)" } });
            r.body?.cancel().catch(() => { });
            const destino = r.headers.get("location");
            if (r.status >= 300 && r.status < 400 && destino) { actual = new URL(destino, actual).toString(); continue; }
            if (prohibeMarco(r.headers.get("x-frame-options"), r.headers.get("content-security-policy"))) avisos.push("no-enmarcable");
            return avisos;
        }
    } catch { avisos.push("sin-respuesta"); }
    return avisos;
}
/** Cuánto se espera a que la página conteste, y cuántas redirecciones se siguen, al revisarla. */
const REVISAR_MS = 5000;
const REVISAR_SALTOS = 3;

/** Crea (sin id) o reemplaza (con id) una fuente. La revisa al guardar y deja los avisos con ella. */
export async function guardarFuenteWeb(data: unknown): Promise<{ ok: true; fuente: FuenteWeb } | { ok: false; error: string }> {
    await exigirMonitores();
    const crudo: any = data && typeof data === "object" ? data : {};
    const problema = problemaDeUrl(String(crudo.url || "").trim());
    if (problema) return { ok: false, error: problema };
    const f = fuenteValida(crudo);
    if (!f) return { ok: false, error: "La página necesita un nombre y una dirección." };
    const fuentes = await fuentesGuardadas();
    const i = f.id ? fuentes.findIndex((x) => x.id === f.id) : -1;
    if (i < 0 && fuentes.length >= FUENTES_WEB_MAX) return { ok: false, error: `Ya hay ${FUENTES_WEB_MAX} páginas: borrá alguna antes.` };
    const fuente: FuenteWeb = { ...f, id: i >= 0 ? f.id : `w${Date.now().toString(36)}`, avisos: await revisarFuente(f.url) };
    if (i >= 0) fuentes[i] = fuente; else fuentes.push(fuente);
    await escribirFuentes(fuentes);
    revalidatePath("/admin/monitores");
    return { ok: true, fuente };
}

/** Borra una fuente. Las vistas que la usaban muestran «Página que ya no existe» en esa casilla. */
export async function borrarFuenteWeb(id: string): Promise<{ ok: boolean }> {
    await exigirMonitores();
    const fuentes = await fuentesGuardadas();
    const n = fuentes.filter((f) => f.id !== id);
    if (n.length === fuentes.length) return { ok: false };
    await escribirFuentes(n);
    revalidatePath("/admin/monitores");
    return { ok: true };
}
