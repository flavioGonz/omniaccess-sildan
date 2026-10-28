/**
 * La lectura de cuentas y sesiones de los equipos (openspec usuarios-de-equipos, fase de sólo lectura).
 * La corre la tarea /api/devices/usuarios/tick cada 5 minutos. No escribe nada en ningún equipo: sólo GET.
 *
 * Cada vuelta lee las sesiones de todos los equipos compatibles. Las cuentas cambian mucho menos, así
 * que se leen cuando la última lectura tiene más de CUENTAS_CADA_MIN. Una lectura que falla no borra
 * nada ni cierra sesiones: «el equipo no contestó» no es «el equipo no tiene cuentas».
 */
import os from "os";
import type { Device } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { HikvisionDriver } from "@/lib/drivers/HikvisionDriver";
import { leeUsuarios } from "@/lib/drivers/catalogo";
import { equiposApagados } from "@/lib/apagado";
import { getEventTarget } from "@/lib/isapi-alarmhost";
import type { CuentaLeida, SesionLeida, CapacidadesLeidas } from "@/lib/usuarios-equipo/hikvision";
import { clasificar, procedencia, fusionarCuentas, fusionarSesiones, alertaCuenta, alertaSesion, type Fuentes } from "@/lib/usuarios-equipo/inventario";
import { ACCION_EQUIPOS, QUIEN_LECTURA } from "@/lib/usuarios-equipo/acciones";
import { leerIpsConocidas } from "@/lib/usuarios-equipo/conocidas";

/** Las cuentas se releen cuando la última lectura tiene más de esto. */
export const CUENTAS_CADA_MIN = 60;
/** Equipos que se leen a la vez: la vuelta no puede tardar más que el intervalo del cron (5 min). */
export const EN_PARALELO = 4;
/** Las sesiones cerradas se guardan este tiempo (design, Open Questions: se puede pasar a Ajustes). */
export const RETENCION_SESIONES_DIAS = 90;
/** Tipos que no tienen cuentas locales que leer por ISAPI. */
const SIN_CUENTAS = new Set(["ALARM_HUB"]);

export const compatible = (d: Pick<Device, "brand" | "deviceType">) => leeUsuarios(String(d.brand)) && !SIN_CUENTAS.has(String(d.deviceType));

/** El error de un equipo, dicho para el que mira el panel. Nunca lleva claves ni la respuesta cruda. */
export function errorLectura(e: any): string {
    const st = e?.response?.status;
    if (e?.name === "EquipoSoloLectura") return String(e.message);
    if (st === 401) return "El equipo rechazó el usuario o la clave guardados en OmniAccess (401).";
    if (st === 403) return "La cuenta de OmniAccess no tiene permiso para ver usuarios en este equipo (403).";
    if (st === 404) return "El equipo no ofrece esta consulta (404): puede ser un modelo o un firmware sin la función.";
    if (st) return `El equipo respondió ${st}.`;
    const c = String(e?.code || "");
    if (c === "ECONNABORTED" || /timeout/i.test(String(e?.message))) return "Sin respuesta a tiempo.";
    if (c === "ECONNREFUSED") return "El equipo rechazó la conexión.";
    if (c === "EHOSTUNREACH" || c === "ENETUNREACH") return "No hay ruta hasta el equipo.";
    return String(e?.message || "Error al leer el equipo").slice(0, 200);
}

export async function fuentesDeProcedencia(equipos: Pick<Device, "ip" | "name" | "deviceType">[]): Promise<Fuentes> {
    const servidor = new Set<string>();
    for (const lista of Object.values(os.networkInterfaces())) for (const a of lista || []) if (!a.internal) servidor.add(a.address);
    const destino = await getEventTarget().catch(() => null);
    if (destino?.ip) servidor.add(destino.ip);
    for (const ip of String(process.env.OMNI_IPS_SERVIDOR || "").split(",").map((x) => x.trim()).filter(Boolean)) servidor.add(ip);
    const grabadores = new Map<string, string>(), resto = new Map<string, string>();
    for (const d of equipos) {
        const ip = String(d.ip || "").replace(/^https?:\/\//, "").split(/[:/]/)[0];
        if (!ip) continue;
        if (d.deviceType === "NVR") grabadores.set(ip, d.name);
        resto.set(ip, d.name);
    }
    const conocidas = new Map((await leerIpsConocidas()).map((x) => [x.ip, x.nombre] as [string, string]));
    return { servidor, grabadores, equipos: resto, conocidas };
}

const registrar = (accion: string, objetivo: string, detalle: string) =>
    prisma.accionSistema.create({ data: { quien: QUIEN_LECTURA, accion, objetivo: objetivo.slice(0, 120), ok: true, detalle: detalle.slice(0, 500) } }).catch(() => { });

/** Las alertas de cuentas y sesiones: sin Telegram ni WhatsApp en esta fase (design, Non-Goals). */
async function abrirAlerta(deviceId: string, type: string, message: string): Promise<boolean> {
    const ya = await prisma.deviceAlert.findFirst({ where: { deviceId, type, active: true }, select: { id: true } });
    if (ya) return false;
    await prisma.deviceAlert.create({ data: { deviceId, type, severity: "warning", message: message.slice(0, 300), active: true } });
    return true;
}
async function cerrarAlerta(deviceId: string, type: string) {
    await prisma.deviceAlert.updateMany({ where: { deviceId, type, active: true }, data: { active: false, resolvedAt: new Date() } });
}

export type ResultadoEquipo = { deviceId: string; sesiones: "ok" | "error" | "sin-soporte"; cuentas: "ok" | "error" | "no-tocaba"; avisos: number; error?: string };

async function aplicarSesiones(d: Device, leidas: SesionLeida[] | null, f: Fuentes, ahora: Date): Promise<number> {
    const abiertas = await prisma.sesionEquipo.findMany({ where: { deviceId: d.id, hasta: null }, select: { id: true, nombre: true, ip: true, desdeEquipo: true, procedencia: true } });
    const plan = fusionarSesiones(abiertas, leidas);
    let avisos = 0;
    if (plan.siguen.length) await prisma.sesionEquipo.updateMany({ where: { id: { in: plan.siguen } }, data: { vistaUltima: ahora } });
    if (plan.cerradas.length) await prisma.sesionEquipo.updateMany({ where: { id: { in: plan.cerradas } }, data: { hasta: ahora } });
    for (const s of plan.nuevas) {
        const p = procedencia(s.ip, f);
        await prisma.sesionEquipo.create({ data: { deviceId: d.id, nombre: s.nombre, ip: s.ip, procedencia: p.procedencia, origenNombre: p.nombre, desdeEquipo: s.desde, vistaPrimera: ahora, vistaUltima: ahora } });
        if (p.procedencia === "desconocida" && (await abrirAlerta(d.id, alertaSesion(s.nombre, s.ip), `Sesión desde una IP desconocida: ${s.nombre} desde ${s.ip}`))) {
            avisos++;
            await registrar(ACCION_EQUIPOS.SESION_DESCONOCIDA, d.name, `${s.nombre} desde ${s.ip}${s.desde ? ` · entró ${s.desde}` : ""}`);
        }
    }
    // Una alerta de sesión se cierra cuando ya no queda ninguna sesión abierta de esa cuenta desde esa IP.
    if (plan.cerradas.length) {
        const cerradas = abiertas.filter((a) => plan.cerradas.includes(a.id) && a.procedencia === "desconocida");
        for (const c of cerradas) {
            const sigue = await prisma.sesionEquipo.count({ where: { deviceId: d.id, hasta: null, nombre: c.nombre, ip: c.ip } });
            if (!sigue) await cerrarAlerta(d.id, alertaSesion(c.nombre, c.ip));
        }
    }
    return avisos;
}

async function aplicarCuentas(d: Device, leidas: CuentaLeida[] | null, ahora: Date): Promise<number> {
    const previas = await prisma.cuentaEquipo.findMany({ where: { deviceId: d.id } });
    const plan = fusionarCuentas(previas, leidas);
    let avisos = 0;
    for (const a of plan.altas) {
        await prisma.cuentaEquipo.create({ data: { deviceId: d.id, nombre: a.nombre, idEquipo: a.idEquipo, nivel: a.nivel, deFabrica: a.deFabrica, origen: "equipo", primeraVez: ahora, ultimaVez: ahora } });
    }
    for (const s of plan.siguen) {
        await prisma.cuentaEquipo.update({ where: { id: s.id }, data: { ultimaVez: ahora, idEquipo: s.leida.idEquipo, nivel: s.leida.nivel, deFabrica: s.leida.deFabrica, ...(s.reaparecio ? { desaparecida: null } : {}) } });
    }
    for (const id of plan.desaparecidas) {
        const c = previas.find((p) => p.id === id)!;
        await prisma.cuentaEquipo.update({ where: { id }, data: { desaparecida: ahora } });
        await cerrarAlerta(d.id, alertaCuenta(c.nombre));
        if (clasificar(c, d.username) !== "servicio") await registrar(ACCION_EQUIPOS.CUENTA_YA_NO_ESTA, d.name, `${c.nombre}${c.nivel ? ` (${c.nivel})` : ""}`);
    }
    // Las alertas se recalculan sobre lo que hay ahora: una por cuenta no gestionada y no reconocida.
    if (leidas) {
        const actuales = await prisma.cuentaEquipo.findMany({ where: { deviceId: d.id, desaparecida: null } });
        for (const c of actuales) {
            const tipo = alertaCuenta(c.nombre);
            if (clasificar(c, d.username) === "no-gestionada" && !c.conocida) {
                if (await abrirAlerta(d.id, tipo, `Cuenta no gestionada: ${c.nombre}${c.nivel ? ` (${c.nivel})` : ""}`)) {
                    avisos++;
                    await registrar(ACCION_EQUIPOS.CUENTA_NUEVA, d.name, `${c.nombre}${c.nivel ? ` · ${c.nivel}` : ""} · no la creó OmniAccess`);
                }
            } else await cerrarAlerta(d.id, tipo);
        }
    }
    return avisos;
}

/** Lee un equipo y guarda el resultado. Nunca lanza: el error queda en LecturaUsuariosEquipo. */
export async function leerEquipo(d: Device, conCuentas: boolean, f: Fuentes, ahora = new Date()): Promise<ResultadoEquipo> {
    const drv = new HikvisionDriver();
    const r: ResultadoEquipo = { deviceId: d.id, sesiones: "ok", cuentas: conCuentas ? "ok" : "no-tocaba", avisos: 0 };
    const lect: Record<string, any> = {};

    let sesiones: SesionLeida[] | null = null;
    try { sesiones = await drv.listarSesiones(d); Object.assign(lect, { sesionesAt: ahora, sesionesOk: true, sesionesError: null }); }
    catch (e) { r.sesiones = "error"; r.error = errorLectura(e); Object.assign(lect, { sesionesAt: ahora, sesionesOk: false, sesionesError: r.error }); }
    r.avisos += await aplicarSesiones(d, sesiones, f, ahora);

    if (conCuentas) {
        let cuentas: CuentaLeida[] | null = null, cap: CapacidadesLeidas | null = null;
        try { const x = await drv.listarCuentas(d); cuentas = x.cuentas; cap = x.capacidades; Object.assign(lect, { cuentasAt: ahora, cuentasOk: true, cuentasError: null, ...(cap ? { maxCuentas: cap.maxCuentas, claveDebil: cap.claveDebil } : {}) }); }
        catch (e) { r.cuentas = "error"; r.error = errorLectura(e); Object.assign(lect, { cuentasAt: ahora, cuentasOk: false, cuentasError: r.error }); }
        r.avisos += await aplicarCuentas(d, cuentas, ahora);
    }
    await prisma.lecturaUsuariosEquipo.upsert({ where: { deviceId: d.id }, create: { deviceId: d.id, ...lect }, update: lect });
    return r;
}

/** Una vuelta completa. `soloEquipo` lee uno solo (el botón «Leer ahora» de la ficha), con cuentas. */
export async function vueltaUsuarios(opc: { soloEquipo?: string; forzarCuentas?: boolean } = {}) {
    const t0 = Date.now(), ahora = new Date();
    const todos = await prisma.device.findMany();
    const apagados = await equiposApagados().catch(() => new Set<string>());
    const lista = todos.filter((d) => compatible(d) && !apagados.has(d.id) && (!opc.soloEquipo || d.id === opc.soloEquipo));
    const f = await fuentesDeProcedencia(todos);
    const ultimas = new Map((await prisma.lecturaUsuariosEquipo.findMany({ where: { deviceId: { in: lista.map((d) => d.id) } }, select: { deviceId: true, cuentasAt: true } })).map((x) => [x.deviceId, x.cuentasAt]));
    const tocaCuentas = (id: string) => opc.forzarCuentas || !!opc.soloEquipo || !ultimas.get(id) || ahora.getTime() - ultimas.get(id)!.getTime() > CUENTAS_CADA_MIN * 60_000;

    const res: ResultadoEquipo[] = [];
    let i = 0;
    const trabajador = async () => { while (i < lista.length) { const d = lista[i++]; res.push(await leerEquipo(d, tocaCuentas(d.id), f, ahora).catch((e) => ({ deviceId: d.id, sesiones: "error" as const, cuentas: "error" as const, avisos: 0, error: errorLectura(e) }))); } };
    await Promise.all(Array.from({ length: Math.min(EN_PARALELO, lista.length) }, trabajador));

    // Retención: las sesiones cerradas viejas se borran (las abiertas nunca).
    if (!opc.soloEquipo) await prisma.sesionEquipo.deleteMany({ where: { hasta: { lt: new Date(ahora.getTime() - RETENCION_SESIONES_DIAS * 86_400_000) } } }).catch(() => null);

    return {
        equipos: lista.length,
        conCuentas: res.filter((r) => r.cuentas !== "no-tocaba").length,
        errores: res.filter((r) => r.sesiones === "error" || r.cuentas === "error").length,
        avisos: res.reduce((a, r) => a + r.avisos, 0),
        ms: Date.now() - t0,
    };
}
