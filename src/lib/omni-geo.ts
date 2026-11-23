import { execFile, spawn } from "node:child_process";
import { openSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

/**
 * omni-geo: el contenedor de las direcciones, visto desde OmniAccess (23/11).
 *
 * Nico, apenas vio la primera versión —una máquina aparte, con su dirección de red cargada a
 * mano—: «¿no debe ser un contenedor de OmniAccess, en vez de algo aparte? ¿Activable como una
 * función incorporada?». Sí. Es lo mismo que omni-lpr y omni-vision: una pieza que viene con el
 * programa (`services/omni-geo`), que se prende desde Ajustes › Características y que cada
 * instalación tiene para sí, sin depender de un servidor de otro lado.
 *
 * Acá está lo que hace falta para eso: saber en qué anda el contenedor, instalarlo la primera vez
 * y prenderlo o apagarlo. Todo con `docker` por `execFile` —sin intérprete de por medio— y con
 * nombres fijos: nada de lo que escribe una persona llega a la línea de comandos.
 */

const ejecutar = promisify(execFile);
const DOCKER = process.env.DOCKER_BIN || "docker";
export const OMNI_GEO = "omni-geo";
export const PUERTO_GEO = Number(process.env.OMNI_GEO_PUERTO || 8020);
/** Donde contesta el contenedor: sólo en este equipo. */
export const URL_GEO = `http://127.0.0.1:${PUERTO_GEO}`;
const BITACORA = "/tmp/omni-geo-instala.log", PID = "/tmp/omni-geo-instala.pid";

export type FaseGeo =
    /** No hay Docker en este equipo, o este proceso no lo puede usar. */
    | "sin-docker"
    /** Nunca se instaló. */
    | "sin-instalar"
    /** Se está construyendo la imagen (unos minutos, la primera vez). */
    | "construyendo"
    /** El contenedor corre pero todavía no contesta: prepara la base, baja el mapa o lo importa. */
    | "preparando"
    | "listo"
    /** Existe y está parado. */
    | "detenido"
    /** Corre, debería contestar y no contesta, o el arranque dejó dicho un error. */
    | "falla";
export type EstadoGeo = { fase: FaseGeo; detalle: string | null };

async function docker(args: string[], ms = 20_000): Promise<string> {
    const { stdout } = await ejecutar(DOCKER, args, { timeout: ms, maxBuffer: 1024 * 1024 });
    return stdout.trim();
}

/** ¿Sigue corriendo la instalación que se lanzó desde acá? */
function instalando(): boolean {
    try { process.kill(Number(readFileSync(PID, "utf8")), 0); return true; } catch { return false; }
}

async function contesta(): Promise<boolean> {
    try { const r = await fetch(`${URL_GEO}/status`, { signal: AbortSignal.timeout(2500), cache: "no-store" }); return r.ok; } catch { return false; }
}

/** En qué anda omni-geo, para decirlo en pantalla con palabras y no con «no contesta». */
export async function estadoOmniGeo(): Promise<EstadoGeo> {
    let visto: string;
    try { visto = await docker(["inspect", OMNI_GEO, "--format", "{{.State.Status}}"]); }
    catch (e) {
        const m = e instanceof Error ? e.message : "";
        if (/ENOENT|permission denied|Cannot connect to the Docker daemon/i.test(m)) return { fase: "sin-docker", detalle: null };
        return instalando() ? { fase: "construyendo", detalle: null } : { fase: "sin-instalar", detalle: null };
    }
    if (visto !== "running") return instalando() ? { fase: "construyendo", detalle: null } : { fase: "detenido", detalle: visto };
    if (await contesta()) return { fase: "listo", detalle: null };
    /* Corre y no contesta: lo que esté haciendo lo dejó escrito (services/omni-geo/arranque.sh). */
    const dicho = await docker(["exec", OMNI_GEO, "cat", "/datos/estado"]).catch(() => "");
    if (dicho.startsWith("error")) return { fase: "falla", detalle: dicho.replace(/^error:\s*/, "") };
    if (dicho === "listo") return { fase: "falla", detalle: "terminó de prepararse y no contesta" };
    return { fase: "preparando", detalle: dicho || "arrancando" };
}

/**
 * Dejar omni-geo andando: instalarlo si nunca se instaló, o levantarlo si está parado. No espera:
 * construir la imagen e importar el mapa lleva un cuarto de hora, y quien prendió la función tiene
 * que poder seguir usando el panel. El avance se ve con `estadoOmniGeo`.
 */
export async function prenderOmniGeo(): Promise<EstadoGeo> {
    const e = await estadoOmniGeo();
    if (e.fase === "detenido") { await docker(["start", OMNI_GEO], 60_000).catch(() => { }); return estadoOmniGeo(); }
    if (e.fase === "falla") { await docker(["restart", OMNI_GEO], 90_000).catch(() => { }); return estadoOmniGeo(); }
    if (e.fase !== "sin-instalar") return e;
    const guion = path.join(process.cwd(), "services", "omni-geo", "run.sh");
    const salida = openSync(BITACORA, "a");
    const hijo = spawn("sh", [guion], { detached: true, stdio: ["ignore", salida, salida] });
    if (hijo.pid) writeFileSync(PID, String(hijo.pid));
    hijo.unref();
    return { fase: "construyendo", detalle: null };
}

/** Pararlo. No se borra nada: el mapa importado queda en su volumen para la próxima vez. */
export async function apagarOmniGeo(): Promise<void> {
    await docker(["stop", OMNI_GEO], 60_000).catch(() => { /* si no existe o ya está parado, no hay nada que apagar */ });
}

/** En una frase, para la pantalla. */
export function fraseDeFase(e: EstadoGeo): string {
    switch (e.fase) {
        case "listo": return "Anda.";
        case "construyendo": return "Se está instalando (unos minutos la primera vez).";
        case "preparando": return `Se está preparando: ${e.detalle}. La primera vez tarda unos diez minutos.`;
        case "detenido": return "Está detenido.";
        case "sin-instalar": return "Todavía no se instaló.";
        case "sin-docker": return "Este equipo no tiene Docker, o OmniAccess no lo puede usar: no se puede instalar acá.";
        default: return `No anda: ${e.detalle || "no contesta"}.`;
    }
}
