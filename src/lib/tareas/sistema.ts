import { execFile, spawn } from "node:child_process";
import { open, stat } from "node:fs/promises";
import { promisify } from "node:util";

/**
 * Lo que corre de fondo en el CT, leído de quien lo sabe: PM2, Docker y el crontab.
 *
 * Todo pasa por `execFile` con argumentos fijos, nunca por un shell con texto armado: los
 * nombres que llegan del panel se validan contra la lista real antes de usarse, así que
 * un nombre como "x; rm -rf /" no llega a ningún comando.
 */

const ejecutar = promisify(execFile);
/** Los binarios. En el CT están en /usr/bin; se pueden cambiar sin tocar código. */
const PM2 = process.env.PM2_BIN || "pm2";
const DOCKER = process.env.DOCKER_BIN || "docker";
/** Lo más que se espera a un comando. `docker restart` de un contenedor pesado ronda los 10-20 s. */
const ESPERA_MS = 60_000;
/** De un log se leen como mucho estos bytes del final: alcanza para varios cientos de líneas. */
const COLA_LOG_BYTES = 192 * 1024;

export type Pm2 = {
    nombre: string; estado: string; pid: number | null; desde: string | null; reinicios: number;
    memoria: number; cpu: number; script: string | null; logOut: string | null; logErr: string | null;
};
export type Contenedor = { nombre: string; imagen: string; estado: string; detalle: string; puertos: string; creado: string };
export type LineaCron = { horario: string; comando: string; ruta: string | null; enUnaFrase: string };

export async function listarPm2(): Promise<Pm2[]> {
    const { stdout } = await ejecutar(PM2, ["jlist"], { timeout: ESPERA_MS, maxBuffer: 16 * 1024 * 1024 });
    // pm2 a veces antepone avisos de versión: se toma desde el primer "[".
    const lista = JSON.parse(stdout.slice(stdout.indexOf("[")));
    return lista.map((p: any) => ({
        nombre: p.name,
        estado: p.pm2_env?.status || "desconocido",
        pid: p.pid || null,
        desde: p.pm2_env?.pm_uptime ? new Date(p.pm2_env.pm_uptime).toISOString() : null,
        reinicios: Number(p.pm2_env?.restart_time || 0),
        memoria: Number(p.monit?.memory || 0),
        cpu: Number(p.monit?.cpu || 0),
        script: p.pm2_env?.pm_exec_path || null,
        logOut: p.pm2_env?.pm_out_log_path || null,
        logErr: p.pm2_env?.pm_err_log_path || null,
    }));
}

export async function listarDocker(): Promise<Contenedor[]> {
    const { stdout } = await ejecutar(DOCKER, ["ps", "-a", "--format", "{{json .}}"], { timeout: ESPERA_MS });
    return stdout.split("\n").filter(Boolean).map((l) => {
        const c = JSON.parse(l);
        return { nombre: c.Names, imagen: c.Image, estado: c.State, detalle: c.Status, puertos: c.Ports || "", creado: c.CreatedAt };
    });
}

/**
 * Lo que tiene el cron, sin secretos: un token en un encabezado o un `$(…)` que lo lee del
 * .env se reemplazan por "…". La línea se muestra para auditar QUÉ corre, no para copiarla.
 */
function limpiar(comando: string): string {
    // Primero los `$(…)`: adentro suelen tener comillas que confundirían al reemplazo del encabezado.
    return comando
        .replace(/\$\([^)]*\)/g, "…")
        .replace(/(-H\s+["'][^:"']+:\s*)[^"']*(["'])/g, "$1…$2")
        .replace(/(token|key|secret|password)=([^&\s"']+)/gi, "$1=…");
}

/** El horario en castellano, para los casos que hay. Lo raro se muestra tal cual. */
function enUnaFrase(h: string): string {
    const [mi, ho, dm, me, ds] = h.split(/\s+/);
    if (h === "* * * * *") return "Cada minuto";
    if (/^\*\/\d+$/.test(mi) && ho === "*" && dm === "*" && me === "*" && ds === "*") return `Cada ${mi.slice(2)} minutos`;
    if (/^\d+$/.test(mi) && ho === "*" && dm === "*") return `Cada hora, al minuto ${mi}`;
    if (/^\d+$/.test(mi) && /^\d+$/.test(ho) && dm === "*" && me === "*" && ds === "*") return `Todos los días a las ${ho.padStart(2, "0")}:${mi.padStart(2, "0")}`;
    return h;
}

export async function leerCrontab(): Promise<LineaCron[]> {
    let stdout = "";
    try { ({ stdout } = await ejecutar("crontab", ["-l"], { timeout: ESPERA_MS })); }
    catch (e: any) { if (/no crontab/i.test(String(e?.stderr || e?.message))) return []; throw e; }
    return stdout.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#") && !/^\w+=/.test(l)).map((l) => {
        const especial = l.startsWith("@") ? l.split(/\s+/)[0] : null;
        const partes = l.split(/\s+/);
        const horario = especial || partes.slice(0, 5).join(" ");
        const comando = especial ? partes.slice(1).join(" ") : partes.slice(5).join(" ");
        const ruta = comando.match(/https?:\/\/[^/\s"']+(\/[^\s"'?]*)/)?.[1] || null;
        return { horario, comando: limpiar(comando), ruta, enUnaFrase: especial ? especial : enUnaFrase(horario) };
    });
}

/** Las últimas `lineas` de un archivo de log, leyendo sólo el final. */
export async function colaDeArchivo(ruta: string, lineas: number): Promise<string[]> {
    const info = await stat(ruta);
    const desde = Math.max(0, info.size - COLA_LOG_BYTES);
    const f = await open(ruta, "r");
    try {
        const buf = Buffer.alloc(info.size - desde);
        await f.read(buf, 0, buf.length, desde);
        const todas = buf.toString("utf8").split("\n");
        if (desde > 0) todas.shift(); // la primera quedó cortada a la mitad
        return todas.filter((l) => l.length).slice(-lineas);
    } finally { await f.close(); }
}

export async function logsDocker(nombre: string, lineas: number): Promise<string[]> {
    const { stdout, stderr } = await ejecutar(DOCKER, ["logs", "--tail", String(lineas), "--timestamps", nombre], { timeout: ESPERA_MS, maxBuffer: 16 * 1024 * 1024 });
    // Docker manda lo del contenedor por stdout y stderr según cómo lo escribió: se juntan y se ordenan por la marca de tiempo.
    return [...stdout.split("\n"), ...stderr.split("\n")].filter(Boolean).sort().slice(-lineas);
}

export async function reiniciarPm2(nombre: string): Promise<"hecho" | "en-curso"> {
    // Reiniciarse a uno mismo corta esta misma respuesta: se deja encargado y se contesta antes.
    if (process.env.name === nombre) {
        spawn("sh", ["-c", `sleep 2; ${PM2} restart "$0"`, nombre], { detached: true, stdio: "ignore" }).unref();
        return "en-curso";
    }
    await ejecutar(PM2, ["restart", nombre], { timeout: ESPERA_MS });
    return "hecho";
}

export async function reiniciarDocker(nombre: string): Promise<void> {
    await ejecutar(DOCKER, ["restart", nombre], { timeout: ESPERA_MS });
}
