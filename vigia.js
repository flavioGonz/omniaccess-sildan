/**
 * El vigia: mira que los servicios esten arriba, levanta lo que puede, y avisa.
 *
 * ## El incidente que lo justifica
 *
 * El 20 de setiembre el lector de matriculas estuvo VEINTITRES MINUTOS caido y nadie se
 * entero. Salio con codigo 128 despues de un fallo de GPU:
 *
 *     terminate called ... device free failed:
 *     cudaErrorIllegalAddress: an illegal memory access was encountered
 *
 * Y lo grave no es la caida sino lo que paso despues: el contenedor tiene
 * `restart: unless-stopped` y aun asi quedo con **RestartCount: 0**. Docker intento y no
 * pudo — "failed to create task for container: Unavailable: EOF" — porque el proceso
 * muerto dejo contextos de CUDA colgados (dos PIDs fantasma reteniendo 456 MiB con nombre
 * `[Not Found]`). Al dia siguiente volvio a pasar.
 *
 * **La politica de reinicio no cubre este modo de falla, que es justamente el que
 * tenemos.**
 *
 * ## Las dos mitades, y por que ninguna reemplaza a la otra
 *
 *   LEVANTAR  reintentar lo que se puede levantar solo, con freno para no entrar en un
 *             ciclo de reinicios que empeore las cosas.
 *
 *   AVISAR    porque una falla que el vigia no puede reparar tiene que llegarle a una
 *             persona. Un watchdog que solo reintenta en silencio convierte una caida
 *             visible en una caida invisible, que es peor.
 *
 * ## Por que corre aparte, y por que encola directo en Redis
 *
 * Corre en su PROPIO proceso pm2. Un vigia que comparte proceso con lo que vigila se cae
 * junto con ello, y entonces no vigila nada.
 *
 * Y el aviso se encola directo en la cola de despachos, sin pasar por la app web: si el
 * que se cayo es el sitio, un aviso que necesita al sitio para salir no sale — y ese es
 * exactamente el caso en que mas falta hace.
 *
 * Eso obliga a repetir aca las quince lineas de `enqueueDispatch` (src/lib/dispatch-queue.ts).
 * **La duplicacion es el punto, no un descuido**: el vigia no puede depender de lo que
 * vigila. Si el contrato de la cola cambia, este archivo tiene que cambiar con el, y por
 * eso queda dicho aca y alla.
 *
 * ## El limite honesto
 *
 * El aviso escribe una fila `DispatchJob` en Postgres antes de encolar. Si el que se cayo
 * es Postgres, el aviso no puede salir. No hay forma de arreglarlo sin un segundo canal
 * que no toque la base, asi que por ahora eso queda en el log y se dice.
 *
 * ## Lo que NO hace, a proposito
 *
 * No toca el control de acceso. La regla de la casa es que el seguimiento, el lector y
 * todo esto corren por fuera del camino de la barrera; un vigia que reiniciara procesos de
 * acceso podria dejar a alguien afuera del barrio para arreglar una estadistica.
 */

require("dotenv").config({ path: require("path").join(__dirname, ".env") });
const { exec } = require("child_process");
const { promisify } = require("util");
const { Queue } = require("bullmq");
const IORedis = require("ioredis");
const { PrismaClient } = require("@prisma/client");

const correr = promisify(exec);
const prisma = new PrismaClient();
const conexion = new IORedis(process.env.REDIS_URL || "redis://127.0.0.1:6379", {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
});
const cola = new Queue("dispatch", { connection: conexion });

const CADA_MS = Number(process.env.VIGIA_INTERVALO_MS || 30_000);

/**
 * Cuantas vueltas seguidas en falla antes de declararlo caido.
 *
 * No es prolijidad: un pedido que llega justo durante un reinicio planificado da error una
 * vez, y avisar por eso enseña a ignorar los avisos. Tres vueltas de treinta segundos son
 * noventa segundos: mas que cualquier reinicio normal y menos que el tiempo en que a
 * alguien le importa.
 */
const FALLAS_PARA_CAER = Number(process.env.VIGIA_FALLAS || 3);

/**
 * Cuantas veces se intenta levantar algo por hora antes de rendirse y solo avisar.
 *
 * Un servicio que muere apenas arranca entra en un ciclo: levantar, morir, levantar. Cada
 * vuelta cuesta GPU, memoria y logs, y ninguna arregla nada. Pasado el tope, el vigia deja
 * de intentar y pasa a insistir con el aviso, que es lo unico que queda por hacer.
 */
const INTENTOS_POR_HORA = Number(process.env.VIGIA_INTENTOS || 4);

/** Cada cuanto se repite el aviso de algo que sigue caido. */
const RECORDAR_MIN = Number(process.env.VIGIA_RECORDAR_MIN || 30);

const PM2_APPS = ["omniaccess-web", "omniaccess-webhooks", "tracking-worker", "dispatch-worker"];
const LECTOR = process.env.OMNI_LPR_URL || "http://127.0.0.1:8000";
const WEB = process.env.INTERNAL_BASE_URL || "http://127.0.0.1:10001";
const WEBHOOKS = process.env.WEBHOOK_URL || "http://127.0.0.1:10000";

const log = (...a) => console.log(new Date().toISOString(), "[vigia]", ...a);

const ajuste = async (clave, porDefecto) => {
    try { const s = await prisma.setting.findUnique({ where: { key: clave } }); return (s && s.value) || porDefecto; }
    catch { return porDefecto; }
};

// ── Estado entre vueltas ────────────────────────────────────────────────────────
const estado = new Map();

function memoria(id) {
    if (!estado.has(id)) estado.set(id, { fallas: 0, caido: false, desde: null, avisadoAl: 0, intentos: [], detalle: "" });
    return estado.get(id);
}

/** Quedan intentos en la ultima hora? Ver INTENTOS_POR_HORA. */
function puedeIntentar(m) {
    const hace1h = Date.now() - 3600_000;
    m.intentos = m.intentos.filter((t) => t > hace1h);
    return m.intentos.length < INTENTOS_POR_HORA;
}

// ── Revisiones ──────────────────────────────────────────────────────────────────
// Ninguna tira. Una revision que tira se lleva puesta la vuelta entera, y entonces el
// vigia deja de vigilar todo lo demas por culpa de uno solo.

async function porHttp(url, ms = 5000) {
    try {
        const r = await fetch(url, { signal: AbortSignal.timeout(ms) });
        return { ok: r.ok, detalle: `HTTP ${r.status}` };
    } catch (e) {
        return { ok: false, detalle: (e && e.message) || "no contesto" };
    }
}

async function porPm2(nombre) {
    try {
        const { stdout } = await correr("pm2 jlist", { timeout: 15_000, maxBuffer: 16 * 1024 * 1024 });
        const app = JSON.parse(stdout).find((a) => a.name === nombre);
        if (!app) return { ok: false, detalle: "no figura en pm2" };
        const st = app.pm2_env && app.pm2_env.status;
        return { ok: st === "online", detalle: `pm2 dice ${st}` };
    } catch (e) {
        return { ok: false, detalle: `no se pudo consultar pm2: ${e.message}` };
    }
}

async function porDocker(nombre) {
    try {
        const { stdout } = await correr(
            `docker inspect ${nombre} --format '{{.State.Status}}|{{.State.ExitCode}}|{{.State.Error}}'`,
            { timeout: 15_000 },
        );
        const [st, salida, err] = stdout.trim().split("|");
        if (st !== "running") {
            return { ok: false, detalle: `contenedor ${st}, salida ${salida}${err ? ` — ${err}` : ""}` };
        }
        return { ok: true, detalle: "corriendo" };
    } catch (e) {
        return { ok: false, detalle: `no se pudo consultar docker: ${e.message}` };
    }
}

async function porBase() {
    try { await prisma.$queryRaw`SELECT 1`; return { ok: true, detalle: "contesta" }; }
    catch (e) { return { ok: false, detalle: e.message }; }
}

async function porRedis() {
    try { return { ok: (await conexion.ping()) === "PONG", detalle: "PING" }; }
    catch (e) { return { ok: false, detalle: e.message }; }
}

// ── Arreglos ────────────────────────────────────────────────────────────────────

const levantarPm2 = (nombre) => async () => {
    await correr(`pm2 restart ${nombre}`, { timeout: 45_000 });
    return `reiniciado ${nombre}`;
};

/**
 * Levantar el lector, sabiendo como se rompe.
 *
 * `docker start` a secas alcanza casi siempre. Cuando no —que es el caso del 20 de
 * setiembre— es porque quedaron contextos de CUDA colgados y el contenedor no puede crear
 * su tarea; ahi insistir con `start` es hacer lo mismo que Docker ya estuvo haciendo sin
 * suerte, asi que se recrea.
 *
 * No se matan los procesos fantasma de la GPU: desde adentro del LXC esos PIDs son del
 * host, y matar por PID un proceso que no es nuestro es la clase de atajo que un dia apaga
 * otra cosa.
 */
async function levantarLector() {
    try {
        await correr("docker start omni-lpr", { timeout: 90_000 });
        return "contenedor levantado";
    } catch (e) {
        if (!/failed to create task|EOF|Unavailable/i.test(e.message || "")) throw e;
        log("el lector no pudo crear su tarea; se recrea el contenedor");
        await correr("docker rm -f omni-lpr", { timeout: 60_000 }).catch(() => { });
        const compose = await ajuste("VIGIA_COMPOSE", process.env.VIGIA_COMPOSE || "/opt/OmniAccess/docker-compose.yml");
        await correr(`docker compose -f ${compose} up -d omni-lpr`, { timeout: 180_000 });
        return "contenedor recreado (la GPU habia quedado trabada)";
    }
}

// ── El aviso ────────────────────────────────────────────────────────────────────

/**
 * Encolar un despacho, con el mismo contrato que `enqueueDispatch` de la app.
 *
 * Ver el encabezado: esto esta repetido a proposito. La fila en `DispatchJob` no es
 * opcional — es lo que hace que el aviso se vea en /admin/despachos como cualquier otro, y
 * lo que el worker lee para saber que mandar.
 */
async function encolar(canal, texto, asunto) {
    const fila = await prisma.dispatchJob.create({
        data: {
            type: "ALERT",
            channel: canal,
            status: "PENDING",
            payload: { text: texto, asunto, ruleName: "Vigía de servicios" },
            maxAttempts: 5,
        },
    });
    const job = await cola.add("dispatch", { dispatchJobId: fila.id }, {
        attempts: 5,
        backoff: { type: "exponential", delay: 5000 },
        removeOnComplete: 2000,
        removeOnFail: 2000,
    });
    await prisma.dispatchJob.update({ where: { id: fila.id }, data: { bullJobId: String(job.id) } });
}

async function avisar(nombre, caido, detalle, minutos) {
    const texto = caido
        ? `⚠️ OmniAccess · ${nombre} no responde\n${detalle}`
        : `✅ OmniAccess · ${nombre} volvió${minutos ? ` (estuvo ${minutos} min abajo)` : ""}`;
    log(caido ? `CAYO ${nombre}: ${detalle}` : `volvio ${nombre} tras ${minutos} min`);

    const canales = (await ajuste("VIGIA_CANALES", "whatsapp,email"))
        .split(",").map((c) => c.trim()).filter(Boolean);
    for (const canal of canales) {
        await encolar(canal, texto, `OmniAccess: ${nombre} ${caido ? "caído" : "recuperado"}`)
            .catch((e) => log(`no se pudo encolar el aviso por ${canal}: ${e.message}`));
    }
}

/** Para la franja del panel: un resumen chico, que sobrevive a que el vigia se reinicie. */
async function publicarEstado() {
    const servicios = [...estado.entries()].map(([id, m]) => ({
        id, caido: m.caido, detalle: m.detalle,
        desde: m.caido && m.desde ? new Date(m.desde).toISOString() : null,
    }));
    const valor = JSON.stringify({ al: new Date().toISOString(), servicios });
    await prisma.setting.upsert({
        where: { key: "VIGIA_ESTADO" },
        create: { key: "VIGIA_ESTADO", value: valor },
        update: { value: valor },
    }).catch(() => { /* si la base no esta, el estado es lo de menos */ });
}

// ── La vuelta ───────────────────────────────────────────────────────────────────

/**
 * Una revision, con su histeresis y su arreglo.
 *
 * El orden importa: primero se decide el estado, despues se intenta arreglar. Al reves, un
 * arreglo que funciona rapido haria que el servicio nunca figure como caido, y entonces
 * nadie se enteraria de que se esta cayendo diez veces por dia — que es el dato que
 * despues explica todo.
 */
async function atender(id, nombre, revisar, arreglar) {
    const m = memoria(id);
    const r = await revisar();
    m.detalle = r.detalle;

    if (r.ok) {
        if (m.caido) {
            const minutos = m.desde ? Math.round((Date.now() - m.desde) / 60_000) : 0;
            await avisar(nombre, false, r.detalle, minutos).catch(() => { });
        }
        m.fallas = 0; m.caido = false; m.desde = null; m.avisadoAl = 0;
        return;
    }

    m.fallas++;
    if (m.fallas < FALLAS_PARA_CAER) return;

    const ahora = Date.now();
    if (!m.caido) {
        m.caido = true;
        m.desde = ahora;
        m.avisadoAl = ahora;
        await avisar(nombre, true, r.detalle, 0).catch(() => { });
    } else if (ahora - m.avisadoAl > RECORDAR_MIN * 60_000) {
        // Sigue caido y ya paso un rato: se recuerda. Un aviso unico se pierde entre otros
        // mensajes y despues nadie sabe desde cuando esta asi.
        m.avisadoAl = ahora;
        await avisar(nombre, true, `${r.detalle} · sigue caído hace ${Math.round((ahora - m.desde) / 60_000)} min`, 0).catch(() => { });
    }

    if (!arreglar || !puedeIntentar(m)) return;
    m.intentos.push(ahora);
    try { log(`${nombre}: ${await arreglar()}`); }
    catch (e) { log(`${nombre}: no se pudo levantar: ${e.message}`); }
}

async function vuelta() {
    await atender("base", "la base de datos", porBase, null);
    await atender("redis", "Redis", porRedis, null);

    for (const app of PM2_APPS) {
        await atender(`pm2:${app}`, app, () => porPm2(app), levantarPm2(app));
    }

    await atender("web", "el sitio", () => porHttp(`${WEB}/api/health`), levantarPm2("omniaccess-web"));
    await atender("webhooks", "los webhooks", () => porHttp(`${WEBHOOKS}/health`), levantarPm2("omniaccess-webhooks"));
    await atender("lector:contenedor", "el contenedor del lector", () => porDocker("omni-lpr"), levantarLector);
    await atender("lector:api", "la API del lector", () => porHttp(`${LECTOR}/api/health`), levantarLector);

    await publicarEstado();
}

async function main() {
    log(`arranca; revisa cada ${CADA_MS / 1000} s, declara caido a las ${FALLAS_PARA_CAER} fallas seguidas`);
    for (;;) {
        await vuelta().catch((e) => log("la vuelta fallo entera:", e.message));
        await new Promise((r) => setTimeout(r, CADA_MS));
    }
}

main();
