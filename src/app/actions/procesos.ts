"use server";

import { prisma } from "@/lib/prisma";
import { getSession } from "@/app/actions/auth";
import { permisosDeSesion } from "@/lib/permisos";
import { SERVICIOS, TAREAS, tareaPorClave } from "@/lib/tareas/catalogo";
import { CLAVE_PAUSADAS, olvidarPausas, tareasPausadas } from "@/lib/tareas/ejecucion";
import { colaDeArchivo, leerCrontab, listarDocker, listarPm2, logsDocker, reiniciarDocker, reiniciarPm2 } from "@/lib/tareas/sistema";
import { getDispatchQueue } from "@/lib/dispatch-queue";

/**
 * Procesos y tareas: lo que corre de fondo, visto y tocado desde el panel.
 *
 * Todo exige el permiso `ajustes`: reiniciar el receptor de eventos deja al barrio sin
 * lecturas durante unos segundos, y eso no es algo que pueda hacer cualquier rol.
 * Toda acción queda en AccionSistema con quién la hizo y cómo salió, también si falló.
 */

async function exigirAjustes(): Promise<string> {
    const s: any = await getSession();
    if (!s || !permisosDeSesion(s).includes("ajustes")) throw new Error("Sólo quien tiene Ajustes puede ver y tocar los procesos.");
    return String(s.name || s.sub || "panel");
}

async function auditar(quien: string, accion: string, objetivo: string, ok: boolean, detalle?: string | null) {
    await prisma.accionSistema.create({ data: { quien, accion, objetivo, ok, detalle: detalle?.slice(0, 500) || null } }).catch(() => { });
}

/** Lo que cuenta: en el mismo puerto que escucha next-server.js. */
const PUERTO = process.env.PORT || "10001";
/** Lo más que se espera a una tarea corrida a mano. El cron le da 50 s; acá un poco más. */
const TAREA_ESPERA_MS = 55_000;
/** Lo más que se pide de un log. Más que esto ya no se lee en una pantalla. */
const LINEAS_MAX = 1000;

export type ServicioFila = {
    tipo: "pm2" | "docker"; nombre: string; titulo: string; queHace: string | null; siCae: string | null;
    estado: string; vivo: boolean; desde: string | null; detalle: string; reinicios: number | null;
    memoria: number | null; cpu: number | null; origen: string | null; internas: { nombre: string; cada: string }[];
    cortaElPanel: boolean; conLogs: boolean;
};
export type TareaFila = {
    clave: string; nombre: string; queHace: string | null; siFalla: string | null; horario: string; enUnaFrase: string;
    comando: string; ruta: string | null; pausada: boolean; conocida: boolean;
    ultima: { inicio: string; ms: number | null; ok: boolean | null; detalle: string | null; origen: string } | null;
    corridas24: number; fallas24: number; msPromedio: number | null;
};
export type AccionFila = { id: string; cuando: string; quien: string; accion: string; objetivo: string; ok: boolean; detalle: string | null };

export async function estadoProcesos() {
    await exigirAjustes();
    const avisos: string[] = [];

    const [pm2, docker, cron] = await Promise.all([
        listarPm2().catch((e) => { avisos.push(`PM2: ${e?.message || e}`); return []; }),
        listarDocker().catch((e) => { avisos.push(`Docker: ${e?.message || e}`); return []; }),
        leerCrontab().catch((e) => { avisos.push(`Cron: ${e?.message || e}`); return []; }),
    ]);

    const servicios: ServicioFila[] = [
        ...pm2.map((p) => {
            const c = SERVICIOS[p.nombre];
            return {
                tipo: "pm2" as const, nombre: p.nombre, titulo: c?.nombre || p.nombre, queHace: c?.queHace || null, siCae: c?.siCae || null,
                estado: p.estado, vivo: p.estado === "online", desde: p.desde, detalle: p.estado === "online" ? "En línea" : p.estado,
                reinicios: p.reinicios, memoria: p.memoria, cpu: p.cpu, origen: p.script, internas: c?.internas || [],
                cortaElPanel: !!c?.cortaElPanel, conLogs: !!(p.logOut || p.logErr),
            };
        }),
        ...docker.map((d) => {
            const c = SERVICIOS[d.nombre];
            return {
                tipo: "docker" as const, nombre: d.nombre, titulo: c?.nombre || d.nombre, queHace: c?.queHace || null, siCae: c?.siCae || null,
                estado: d.estado, vivo: d.estado === "running", desde: null, detalle: d.detalle, reinicios: null,
                memoria: null, cpu: null, origen: `${d.imagen}${d.puertos ? ` · ${d.puertos}` : ""}`, internas: [],
                cortaElPanel: false, conLogs: true,
            };
        }),
    ];

    // Corridas: la última de cada tarea y el resumen de 24 h, en dos consultas y no una por tarea.
    const pausadas = await tareasPausadas(true);
    const [ultimas, resumen] = await Promise.all([
        prisma.$queryRaw<any[]>`SELECT DISTINCT ON (tarea) tarea, inicio, fin, ok, detalle, origen FROM "EjecucionTarea" ORDER BY tarea, inicio DESC`,
        prisma.$queryRaw<any[]>`SELECT tarea, count(*)::int AS n, count(*) FILTER (WHERE ok = false)::int AS fallas,
            avg(EXTRACT(EPOCH FROM (fin - inicio)) * 1000)::float AS ms
            FROM "EjecucionTarea" WHERE inicio > now() AT TIME ZONE 'UTC' - interval '24 hours' GROUP BY tarea`,
    ]).catch((e) => { avisos.push(`Historial de corridas: ${e?.message || e}`); return [[], []] as any[][]; });
    const ultimaDe = new Map(ultimas.map((u) => [u.tarea, u]));
    const resumenDe = new Map(resumen.map((r) => [r.tarea, r]));

    const tareas: TareaFila[] = cron.map((l, i) => {
        const t = l.ruta ? TAREAS[l.ruta] : undefined;
        const clave = t?.clave || `cron-${i + 1}`;
        const u = ultimaDe.get(clave);
        const r = resumenDe.get(clave);
        return {
            clave, nombre: t?.nombre || "Tarea del sistema", queHace: t?.queHace || null, siFalla: t?.siFalla || null,
            horario: l.horario, enUnaFrase: l.enUnaFrase, comando: l.comando, ruta: l.ruta, pausada: pausadas.has(clave), conocida: !!t,
            ultima: u ? { inicio: new Date(u.inicio).toISOString(), ms: u.fin ? new Date(u.fin).getTime() - new Date(u.inicio).getTime() : null, ok: u.ok, detalle: u.detalle, origen: u.origen } : null,
            corridas24: r?.n || 0, fallas24: r?.fallas || 0, msPromedio: r?.ms != null ? Math.round(r.ms) : null,
        };
    });

    let cola: { espera: number; activos: number; demorados: number; fallidos: number; completos: number } | null = null;
    try {
        const c = await Promise.race([
            getDispatchQueue().getJobCounts("waiting", "active", "delayed", "failed", "completed"),
            new Promise<never>((_, no) => setTimeout(() => no(new Error("Redis no contesta")), 4000)),
        ]);
        cola = { espera: c.waiting || 0, activos: c.active || 0, demorados: c.delayed || 0, fallidos: c.failed || 0, completos: c.completed || 0 };
    } catch (e: any) { avisos.push(`Cola de envíos: ${e?.message || e}`); }

    const acciones = (await prisma.accionSistema.findMany({ orderBy: { cuando: "desc" }, take: 100 })).map((a) => ({ ...a, cuando: a.cuando.toISOString() })) as AccionFila[];

    return { servicios, tareas, cola, acciones, avisos, al: new Date().toISOString() };
}

export async function logsDeServicio(tipo: "pm2" | "docker", nombre: string, cual: "salida" | "errores", lineas = 300): Promise<{ ok: true; lineas: string[]; archivo: string | null } | { ok: false; error: string }> {
    try {
        await exigirAjustes();
        const n = Math.min(Math.max(20, Math.round(lineas)), LINEAS_MAX);
        if (tipo === "docker") {
            if (!(await listarDocker()).some((d) => d.nombre === nombre)) return { ok: false, error: "Ese contenedor no existe." };
            return { ok: true, lineas: await logsDocker(nombre, n), archivo: null };
        }
        const p = (await listarPm2()).find((x) => x.nombre === nombre);
        if (!p) return { ok: false, error: "Ese proceso no existe." };
        const archivo = cual === "errores" ? p.logErr : p.logOut;
        if (!archivo) return { ok: true, lineas: [], archivo: null };
        return { ok: true, lineas: await colaDeArchivo(archivo, n).catch((e) => (e?.code === "ENOENT" ? [] : Promise.reject(e))), archivo };
    } catch (e: any) { return { ok: false, error: e?.message || "No se pudo leer el log" }; }
}

export async function reiniciarServicio(tipo: "pm2" | "docker", nombre: string): Promise<{ ok: true; mensaje: string } | { ok: false; error: string }> {
    let quien = "panel";
    try {
        quien = await exigirAjustes();
        if (tipo === "docker") {
            if (!(await listarDocker()).some((d) => d.nombre === nombre)) return { ok: false, error: "Ese contenedor no existe." };
            await reiniciarDocker(nombre);
            await auditar(quien, "Reiniciar contenedor", nombre, true);
            return { ok: true, mensaje: `${nombre} reiniciado.` };
        }
        if (!(await listarPm2()).some((p) => p.nombre === nombre)) return { ok: false, error: "Ese proceso no existe." };
        // Se audita ANTES cuando es el propio panel: después de reiniciarse ya no hay quién escriba.
        const r = process.env.name === nombre ? (await auditar(quien, "Reiniciar proceso", nombre, true, "Se reinicia el propio panel: la página se reconecta sola."), await reiniciarPm2(nombre)) : await reiniciarPm2(nombre);
        if (r === "hecho") await auditar(quien, "Reiniciar proceso", nombre, true);
        return { ok: true, mensaje: r === "en-curso" ? "El panel se reinicia en unos segundos: la página va a dejar de contestar y vuelve sola." : `${nombre} reiniciado.` };
    } catch (e: any) {
        const error = e?.stderr ? String(e.stderr).trim().slice(-300) : e?.message || "No se pudo reiniciar";
        await auditar(quien, tipo === "docker" ? "Reiniciar contenedor" : "Reiniciar proceso", nombre, false, error);
        return { ok: false, error };
    }
}

export async function corridasDeTarea(clave: string, limite = 120) {
    await exigirAjustes();
    const filas = await prisma.ejecucionTarea.findMany({ where: { tarea: clave }, orderBy: { inicio: "desc" }, take: Math.min(500, Math.max(10, limite)) });
    return filas.map((f) => ({ id: f.id, inicio: f.inicio.toISOString(), ms: f.fin ? f.fin.getTime() - f.inicio.getTime() : null, ok: f.ok, detalle: f.detalle, origen: f.origen }));
}

export async function ejecutarTarea(clave: string): Promise<{ ok: true; detalle: string } | { ok: false; error: string }> {
    let quien = "panel";
    try {
        quien = await exigirAjustes();
        const t = tareaPorClave(clave);
        if (!t) return { ok: false, error: "Sólo se pueden correr a mano las tareas de OmniAccess." };
        if ((await tareasPausadas(true)).has(clave)) return { ok: false, error: "Está pausada: reanudala para poder correrla." };
        const [ruta] = t;
        const res = await fetch(`http://127.0.0.1:${PUERTO}${ruta}`, {
            headers: { "x-tracking-token": process.env.TRACKING_TOKEN || "", "x-tarea-origen": `A mano: ${quien}` },
            signal: AbortSignal.timeout(TAREA_ESPERA_MS), cache: "no-store",
        });
        const cuerpo = await res.json().catch(() => null);
        const ok = res.ok && cuerpo?.ok !== false && cuerpo?.status !== "error";
        const detalle = cuerpo ? JSON.stringify(cuerpo).slice(0, 300) : `HTTP ${res.status}`;
        await auditar(quien, "Ejecutar tarea", t[1].nombre, ok, detalle);
        return ok ? { ok: true, detalle } : { ok: false, error: cuerpo?.error || cuerpo?.message || `HTTP ${res.status}` };
    } catch (e: any) {
        await auditar(quien, "Ejecutar tarea", clave, false, e?.message);
        return { ok: false, error: e?.name === "TimeoutError" ? "Tardó más de un minuto: puede seguir corriendo. Mirá las corridas en un rato." : e?.message || "No se pudo correr" };
    }
}

export async function pausarTarea(clave: string, pausar: boolean): Promise<{ ok: true } | { ok: false; error: string }> {
    let quien = "panel";
    try {
        quien = await exigirAjustes();
        const t = tareaPorClave(clave);
        if (!t) return { ok: false, error: "Sólo se pueden pausar las tareas de OmniAccess." };
        const set = await tareasPausadas(true);
        if (pausar) set.add(clave); else set.delete(clave);
        const value = JSON.stringify([...set]);
        await prisma.setting.upsert({ where: { key: CLAVE_PAUSADAS }, create: { key: CLAVE_PAUSADAS, value }, update: { value } });
        olvidarPausas();
        await auditar(quien, pausar ? "Pausar tarea" : "Reanudar tarea", t[1].nombre, true);
        return { ok: true };
    } catch (e: any) {
        await auditar(quien, pausar ? "Pausar tarea" : "Reanudar tarea", clave, false, e?.message);
        return { ok: false, error: e?.message || "No se pudo cambiar" };
    }
}
