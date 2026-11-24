import { execFile, spawn } from "node:child_process";
import { openSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

/**
 * Un contenedor que viene con OmniAccess, visto desde OmniAccess (24/11).
 *
 * Salió de `lib/omni-geo` cuando hizo falta el segundo: omni-rutas (por qué calle fue un recorrido)
 * se instala, se prende y se apaga igual que omni-geo (las direcciones). Son piezas del programa
 * —`services/<nombre>`— que se prenden desde Ajustes › Características y que cada instalación tiene
 * para sí, sin depender de un servidor de otro lado.
 *
 * Acá está lo que hace falta para eso: saber en qué anda el contenedor, instalarlo la primera vez
 * y prenderlo o apagarlo. Todo con `docker` por `execFile` —sin intérprete de por medio— y con
 * nombres fijos: nada de lo que escribe una persona llega a la línea de comandos.
 */

const ejecutar = promisify(execFile);
const DOCKER = process.env.DOCKER_BIN || "docker";

export type FaseContenedor =
    /** No hay Docker en este equipo, o este proceso no lo puede usar. */
    | "sin-docker"
    /** Nunca se instaló. */
    | "sin-instalar"
    /** Se está construyendo la imagen (unos minutos, la primera vez). */
    | "construyendo"
    /** El contenedor corre pero todavía no contesta: baja el mapa o lo prepara. */
    | "preparando"
    | "listo"
    /** Existe y está parado. */
    | "detenido"
    /** Corre, debería contestar y no contesta, o el arranque dejó dicho un error. */
    | "falla";
export type EstadoContenedor = { fase: FaseContenedor; detalle: string | null };

async function docker(args: string[], ms = 20_000): Promise<string> {
    const { stdout } = await ejecutar(DOCKER, args, { timeout: ms, maxBuffer: 1024 * 1024 });
    return stdout.trim();
}

export function contenedorPropio(o: {
    /** El nombre del contenedor y de su carpeta en `services/`. */
    nombre: string;
    puerto: number;
    /** La dirección que contesta 200 cuando está listo: «/status». */
    salud: string;
}) {
    const url = `http://127.0.0.1:${o.puerto}`;
    const BITACORA = `/tmp/${o.nombre}-instala.log`, PID = `/tmp/${o.nombre}-instala.pid`;

    /** ¿Sigue corriendo la instalación que se lanzó desde acá? */
    const instalando = (): boolean => { try { process.kill(Number(readFileSync(PID, "utf8")), 0); return true; } catch { return false; } };
    const contesta = async (): Promise<boolean> => {
        try { const r = await fetch(`${url}${o.salud}`, { signal: AbortSignal.timeout(2500), cache: "no-store" }); return r.ok; } catch { return false; }
    };

    /** En qué anda, para decirlo en pantalla con palabras y no con «no contesta». */
    async function estado(): Promise<EstadoContenedor> {
        let visto: string;
        try { visto = await docker(["inspect", o.nombre, "--format", "{{.State.Status}}"]); }
        catch (e) {
            const m = e instanceof Error ? e.message : "";
            if (/ENOENT|permission denied|Cannot connect to the Docker daemon/i.test(m)) return { fase: "sin-docker", detalle: null };
            return instalando() ? { fase: "construyendo", detalle: null } : { fase: "sin-instalar", detalle: null };
        }
        if (visto !== "running") return instalando() ? { fase: "construyendo", detalle: null } : { fase: "detenido", detalle: visto };
        if (await contesta()) return { fase: "listo", detalle: null };
        /* Corre y no contesta: lo que esté haciendo lo dejó escrito (services/<nombre>/arranque.sh). */
        const dicho = await docker(["exec", o.nombre, "cat", "/datos/estado"]).catch(() => "");
        if (dicho.startsWith("error")) return { fase: "falla", detalle: dicho.replace(/^error:\s*/, "") };
        if (dicho === "listo") return { fase: "falla", detalle: "terminó de prepararse y no contesta" };
        return { fase: "preparando", detalle: dicho || "arrancando" };
    }

    /**
     * Dejarlo andando: instalarlo si nunca se instaló, o levantarlo si está parado. No espera:
     * construir la imagen y preparar el mapa lleva minutos, y quien prendió la función tiene que
     * poder seguir usando el panel. El avance se ve con `estado`.
     */
    async function prender(): Promise<EstadoContenedor> {
        const e = await estado();
        if (e.fase === "detenido") { await docker(["start", o.nombre], 60_000).catch(() => { }); return estado(); }
        if (e.fase === "falla") { await docker(["restart", o.nombre], 90_000).catch(() => { }); return estado(); }
        if (e.fase !== "sin-instalar") return e;
        const guion = path.join(process.cwd(), "services", o.nombre, "run.sh");
        const salida = openSync(BITACORA, "a");
        const hijo = spawn("sh", [guion], { detached: true, stdio: ["ignore", salida, salida] });
        if (hijo.pid) writeFileSync(PID, String(hijo.pid));
        hijo.unref();
        return { fase: "construyendo", detalle: null };
    }

    /** Pararlo. No se borra nada: el mapa preparado queda en su volumen para la próxima vez. */
    async function apagar(): Promise<void> {
        await docker(["stop", o.nombre], 60_000).catch(() => { /* si no existe o ya está parado, no hay nada que apagar */ });
    }

    return { url, estado, prender, apagar };
}

/** En una frase, para la pantalla. `demora`: cuánto tarda en prepararse la primera vez («unos diez minutos»). */
export function fraseDeFase(e: EstadoContenedor, demora = "unos diez minutos"): string {
    switch (e.fase) {
        case "listo": return "Anda.";
        case "construyendo": return "Se está instalando (unos minutos la primera vez).";
        case "preparando": return `Se está preparando: ${e.detalle}. La primera vez tarda ${demora}.`;
        case "detenido": return "Está detenido.";
        case "sin-instalar": return "Todavía no se instaló.";
        case "sin-docker": return "Este equipo no tiene Docker, o OmniAccess no lo puede usar: no se puede instalar acá.";
        default: return `No anda: ${e.detalle || "no contesta"}.`;
    }
}
