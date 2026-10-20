"use server";

import { prisma } from "@/lib/prisma";
import { getSession } from "@/app/actions/auth";
import { esAdministrador, permisosDeSesion } from "@/lib/permisos";
import DEFECTO from "@/lib/telegram-reglas.json";

/**
 * Reglas de lo que se envía al grupo de Telegram. Se guardan en Setting TELEGRAM_REGLAS y las
 * aplica la pasarela del bot (telegram-bot.js). Solo administradores.
 */
const CATEGORIAS = ["vigilancia", "merodeo", "denegado", "no_leida", "invitados", "intrusion", "equipos", "reglas"] as const;
type Reglas = { version: number; categorias: Record<string, any> };

async function soloAdmin() {
    const s: any = await getSession();
    if (!s) throw new Error("Hace falta una sesión del panel.");
    if (!esAdministrador(permisosDeSesion(s))) throw new Error("Solo un administrador puede cambiar esto.");
    return s;
}
function fusionar(a: any, b: any): any {
    if (b === undefined) return a;
    if (!a || !b || typeof a !== "object" || typeof b !== "object" || Array.isArray(a) || Array.isArray(b)) return b;
    const o: any = { ...a };
    for (const k of Object.keys(b)) o[k] = fusionar(a[k], b[k]);
    return o;
}
async function leer(): Promise<Reglas> {
    let guardadas = {};
    try { const st = await prisma.setting.findUnique({ where: { key: "TELEGRAM_REGLAS" } }); if (st?.value) guardadas = JSON.parse(st.value); } catch { }
    return fusionar(DEFECTO, guardadas);
}
async function bot(ruta: string, cuerpo: any) {
    try {
        const r = await fetch(`http://127.0.0.1:10010${ruta}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo), signal: AbortSignal.timeout(8000) });
        return { ok: r.ok, datos: await r.json().catch(() => ({})) };
    } catch { return { ok: false, datos: { motivo: "el bot de Telegram no responde" } }; }
}

export async function getReglasTelegram() {
    await soloAdmin();
    const [reglas, camaras, filas] = await Promise.all([
        leer(),
        prisma.device.findMany({ where: { deviceType: { in: ["CAMERA", "LPR_CAMERA"] as any } }, select: { id: true, name: true, deviceType: true }, orderBy: { name: "asc" } }),
        prisma.telegramEnvio.groupBy({ by: ["categoria", "decision"], where: { createdAt: { gte: new Date(Date.now() - 86_400_000) } }, _count: { _all: true } }),
    ]);
    const resumen: Record<string, { ENVIADO: number; FILTRADO: number; ERROR: number }> = {};
    for (const f of filas) {
        const r = (resumen[f.categoria] ||= { ENVIADO: 0, FILTRADO: 0, ERROR: 0 });
        if (f.decision in r) (r as any)[f.decision] = f._count._all;
    }
    const bot = await prisma.setting.findMany({ where: { key: { in: ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID"] } } });
    const configurado = bot.filter((s) => s.value).length === 2 || !!(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);
    return { reglas, defecto: DEFECTO as Reglas, camaras, resumen, configurado };
}

export async function guardarReglasTelegram(reglas: Reglas) {
    await soloAdmin();
    if (!reglas || typeof reglas !== "object" || !reglas.categorias) throw new Error("Reglas inválidas");
    // Solo se guardan las categorías conocidas, con tipos sanos.
    const limpio: Reglas = { version: 1, categorias: {} };
    for (const k of CATEGORIAS) {
        const c = reglas.categorias[k]; if (!c) continue;
        const o: any = { activo: !!c.activo };
        if ("foto" in c) o.foto = !!c.foto;
        if (Array.isArray(c.camaras)) o.camaras = c.camaras.filter((x: any) => typeof x === "string").slice(0, 500);
        if (c.horario) o.horario = { activo: !!c.horario.activo, desde: /^\d{2}:\d{2}$/.test(c.horario.desde) ? c.horario.desde : "22:00", hasta: /^\d{2}:\d{2}$/.test(c.horario.hasta) ? c.horario.hasta : "06:00" };
        if (k === "intrusion") {
            o.tipos = (Array.isArray(c.tipos) ? c.tipos : []).filter((x: string) => ["LINECROSS", "INTRUSION", "REGION_ENTER", "REGION_EXIT"].includes(x));
            o.objetivos = (Array.isArray(c.objetivos) ? c.objetivos : []).filter((x: string) => ["human", "vehicle", "otro"].includes(x));
            o.soloArmadas = !!c.soloArmadas;
            o.antirrafagaMin = Math.max(0, Math.min(120, Math.round(Number(c.antirrafagaMin) || 0)));
        }
        limpio.categorias[k] = o;
    }
    await prisma.setting.upsert({ where: { key: "TELEGRAM_REGLAS" }, update: { value: JSON.stringify(limpio) }, create: { key: "TELEGRAM_REGLAS", value: JSON.stringify(limpio) } });
    const r = await bot("/recargar", {});
    return { ok: true, botAvisado: r.ok };
}

export async function getEnviosTelegram(filtro: { categoria?: string; decision?: string; limite?: number } = {}) {
    await soloAdmin();
    const where: any = {};
    if (filtro.categoria) where.categoria = filtro.categoria;
    if (filtro.decision) where.decision = filtro.decision;
    const filas = await prisma.telegramEnvio.findMany({ where, orderBy: { createdAt: "desc" }, take: Math.min(500, filtro.limite || 150) });
    const ids = [...new Set(filas.map((f) => f.deviceId).filter(Boolean))] as string[];
    const devs = ids.length ? await prisma.device.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : [];
    const nombre = Object.fromEntries(devs.map((d) => [d.id, d.name]));
    return filas.map((f) => ({ ...f, createdAt: f.createdAt.toISOString(), deviceName: f.deviceId ? nombre[f.deviceId] || null : null }));
}

/** Manda un aviso de prueba de la categoría con el último caso real que haya (sin aplicar filtros). */
export async function probarCategoriaTelegram(categoria: string) {
    await soloAdmin();
    if (!(CATEGORIAS as readonly string[]).includes(categoria)) throw new Error("Categoría desconocida");
    const cuerpo: any = { categoria, prueba: true };
    if (["vigilancia", "merodeo", "denegado", "invitados"].includes(categoria)) {
        const e = await prisma.accessEvent.findFirst({ where: { accessType: "PLATE", NOT: { plateNumber: "NO_LEIDA" }, ...(categoria === "denegado" ? { decision: "DENY" as any } : {}) }, orderBy: { timestamp: "desc" }, select: { id: true, plateNumber: true } });
        if (e) { cuerpo.eventId = e.id; if (categoria !== "vigilancia") cuerpo.texto = e.plateNumber || ""; }
    } else if (categoria === "no_leida") {
        const e = await prisma.accessEvent.findFirst({ where: { plateNumber: "NO_LEIDA" }, orderBy: { timestamp: "desc" }, select: { id: true } });
        if (e) cuerpo.eventId = e.id;
    } else if (categoria === "equipos") {
        cuerpo.titulo = "ALERTA · Equipo de ejemplo"; cuerpo.texto = "Así se ve un aviso de equipo caído o normalizado.";
    } else if (categoria === "reglas") {
        cuerpo.titulo = "ALERTA · Regla de ejemplo"; cuerpo.texto = "Así se ve un aviso de una regla de alerta.";
    }
    const r = await bot("/evento", cuerpo);
    if (!r.ok) return { ok: false, motivo: r.datos?.motivo || "no se pudo enviar" };
    return { ok: true, decision: r.datos?.decision };
}
