"use server";

import { prisma } from "@/lib/prisma";
import { getSession } from "@/app/actions/auth";
import { permisosDeSesion } from "@/lib/permisos";
import { TAREAS, servicioDe, tareaPorClave } from "@/lib/tareas/catalogo";
import { CLAVE_PAUSADAS, olvidarPausas, tareasPausadas } from "@/lib/tareas/ejecucion";
import { colaDeArchivo, estadisticasDocker, inspeccionarDocker, leerCrontab, listarDocker, listarPm2, listarSystemd, logsDocker, logsSystemd, reiniciarDocker, reiniciarPm2 } from "@/lib/tareas/sistema";
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
    if (!s || !permisosDeSesion(s).includes("mantenimiento")) throw new Error("Hace falta el permiso Mantenimiento para ver y tocar los procesos.");
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

export type TipoServicio = "pm2" | "docker" | "sistema";
export type ServicioFila = {
    tipo: TipoServicio; nombre: string; titulo: string; queHace: string | null; siCae: string | null;
    estado: string; vivo: boolean; desde: string | null; detalle: string; reinicios: number | null;
    memoria: number | null; cpu: number | null; origen: string | null; internas: { nombre: string; cada: string }[];
    cortaElPanel: boolean; conLogs: boolean;
    /** Los del sistema (base, Redis…) se miran, no se reinician desde una página: ver reiniciarServicio. */
    reiniciable: boolean;
    /** Lo que dice el chequeo de salud del contenedor, si tiene: healthy / unhealthy / starting. */
    salud: string | null;
};
export type TareaFila = {
    clave: string; nombre: string; queHace: string | null; siFalla: string | null; horario: string; enUnaFrase: string;
    comando: string; ruta: string | null; pausada: boolean; conocida: boolean;
    ultima: { inicio: string; ms: number | null; ok: boolean | null; detalle: string | null; origen: string } | null;
    corridas24: number; fallas24: number; msPromedio: number | null;
};
export type AccionFila = { id: string; cuando: string; quien: string; accion: string; objetivo: string; ok: boolean; detalle: string | null };

/** El CPU de las unidades de systemd sale de un contador acumulado: el % es la diferencia entre dos lecturas. */
const cpuPrevio = new Map<string, { ns: number; t: number }>();

/**
 * Todo lo que corre, de quien lo sabe: PM2, Docker (con arranque, reinicios, salud y consumo) y
 * systemd (base, Redis, almacenamiento, video, Docker). Lo que no se pudo leer se avisa y no se
 * inventa: una tabla vacía porque Docker no contestó no es lo mismo que «no hay contenedores».
 */
async function leerServicios(avisos: string[]): Promise<ServicioFila[]> {
    const [pm2, docker, unidades] = await Promise.all([
        listarPm2().catch((e) => { avisos.push(`PM2: ${e?.message || e}`); return []; }),
        listarDocker().catch((e) => { avisos.push(`Docker: ${e?.message || e}`); return []; }),
        listarSystemd().catch((e) => { avisos.push(`Servicios del sistema: ${e?.message || e}`); return []; }),
    ]);
    const [insp, stats] = await Promise.all([
        inspeccionarDocker(docker.map((d) => d.nombre)).catch(() => new Map()),
        estadisticasDocker().catch(() => new Map()),
    ]);
    const ahora = Date.now();
    return [
        ...pm2.map((p) => {
            const c = servicioDe(p.nombre);
            return {
                tipo: "pm2" as const, nombre: p.nombre, titulo: c?.nombre || p.nombre, queHace: c?.queHace || null, siCae: c?.siCae || null,
                estado: p.estado, vivo: p.estado === "online", desde: p.estado === "online" ? p.desde : null, detalle: p.estado === "online" ? "En línea" : p.estado,
                reinicios: p.reinicios, memoria: p.memoria, cpu: p.cpu, origen: p.script, internas: c?.internas || [],
                cortaElPanel: !!c?.cortaElPanel, conLogs: !!(p.logOut || p.logErr), reiniciable: true, salud: null,
            };
        }),
        ...docker.map((d) => {
            const c = servicioDe(d.nombre);
            const i = insp.get(d.nombre);
            const st = stats.get(d.nombre);
            const vivo = d.estado === "running";
            return {
                tipo: "docker" as const, nombre: d.nombre, titulo: c?.nombre || d.nombre, queHace: c?.queHace || null, siCae: c?.siCae || null,
                estado: d.estado, vivo, desde: vivo ? i?.desde || null : null, detalle: d.detalle, reinicios: i?.reinicios ?? null,
                memoria: vivo ? st?.memoria ?? null : null, cpu: vivo ? st?.cpu ?? null : null,
                origen: `${d.imagen}${d.puertos ? ` · ${d.puertos}` : ""}`, internas: [],
                cortaElPanel: false, conLogs: true, reiniciable: true, salud: i?.salud || null,
            };
        }),
        ...unidades.map((u) => {
            const c = servicioDe(u.nombre);
            let cpu: number | null = null;
            if (u.cpuNs != null) {
                const prev = cpuPrevio.get(u.nombre);
                if (prev && ahora > prev.t) cpu = Math.max(0, Math.round(((u.cpuNs - prev.ns) / 1e6 / (ahora - prev.t)) * 1000) / 10);
                cpuPrevio.set(u.nombre, { ns: u.cpuNs, t: ahora });
            }
            const vivo = u.estado === "active";
            return {
                tipo: "sistema" as const, nombre: u.nombre, titulo: c?.nombre || u.nombre, queHace: c?.queHace || null, siCae: c?.siCae || null,
                estado: vivo ? "activo" : u.estado, vivo, desde: vivo ? u.desde : null, detalle: `${u.estado} · ${u.subestado}`,
                reinicios: u.reinicios, memoria: u.memoria, cpu, origen: `systemd · ${u.nombre}.service${u.pid ? ` · PID ${u.pid}` : ""}`, internas: [],
                cortaElPanel: false, conLogs: true, reiniciable: false, salud: null,
            };
        }),
    ];
}

/**
 * Sólo los servicios, para la vista en vivo: la pantalla pregunta cada pocos segundos y no hace
 * falta releer el cron, las corridas ni la auditoría en cada vuelta.
 */
export async function vivoServicios() {
    await exigirAjustes();
    const avisos: string[] = [];
    const servicios = await leerServicios(avisos);
    return { servicios, avisos, al: new Date().toISOString() };
}

/** La cola de envíos (BullMQ sobre Redis). */
export async function estadoCola() {
    await exigirAjustes();
    try {
        const c = await Promise.race([
            getDispatchQueue().getJobCounts("waiting", "active", "delayed", "failed", "completed"),
            new Promise<never>((_, no) => setTimeout(() => no(new Error("Redis no contesta")), 4000)),
        ]);
        return { ok: true as const, al: new Date().toISOString(), espera: c.waiting || 0, activos: c.active || 0, demorados: c.delayed || 0, fallidos: c.failed || 0, completos: c.completed || 0 };
    } catch (e: any) { return { ok: false as const, al: new Date().toISOString(), error: e?.message || "No se pudo leer la cola" }; }
}

/** Lo que se hizo desde Procesos: reinicios, tareas a mano, pausas. */
export async function auditoriaProcesos(limite = 500) {
    await exigirAjustes();
    return (await prisma.accionSistema.findMany({ orderBy: { cuando: "desc" }, take: Math.min(2000, Math.max(20, limite)) })).map((a) => ({ ...a, cuando: a.cuando.toISOString() })) as AccionFila[];
}

export async function estadoProcesos() {
    await exigirAjustes();
    const avisos: string[] = [];

    const [servicios, cron] = await Promise.all([
        leerServicios(avisos),
        leerCrontab().catch((e) => { avisos.push(`Cron: ${e?.message || e}`); return []; }),
    ]);

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

    return { servicios, tareas, avisos, al: new Date().toISOString() };
}

export async function logsDeServicio(tipo: TipoServicio, nombre: string, cual: "salida" | "errores", lineas = 300): Promise<{ ok: true; lineas: string[]; archivo: string | null } | { ok: false; error: string }> {
    try {
        await exigirAjustes();
        const n = Math.min(Math.max(20, Math.round(lineas)), LINEAS_MAX);
        if (tipo === "sistema") {
            // Sólo unidades de la lista real: el nombre llega del navegador.
            if (!(await listarSystemd()).some((u) => u.nombre === nombre)) return { ok: false, error: "Ese servicio no existe." };
            return { ok: true, lineas: await logsSystemd(nombre, n), archivo: `journalctl -u ${nombre}` };
        }
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

export async function reiniciarServicio(tipo: TipoServicio, nombre: string): Promise<{ ok: true; mensaje: string } | { ok: false; error: string }> {
    let quien = "panel";
    try {
        quien = await exigirAjustes();
        // La base, Redis, el almacenamiento y Docker no se reinician desde una página: reiniciar la
        // base corta el propio panel a la mitad de la respuesta, y reiniciar Docker ya tumbó el
        // lector y WhatsApp una vez (ver skill omniaccess-despliegue). Se hace desde la consola.
        if (tipo === "sistema") return { ok: false, error: "Los servicios del sistema se reinician desde la consola del servidor, no desde el panel." };
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
