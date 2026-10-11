/**
 * Entrenador del detector propio (pm2: omniaccess-entrenador).
 *
 * Toma de a uno los EntrenamientoDetector en cola y los corre en el contenedor omni-entrenador
 * (services/omni-entrenador), que afina RF-DETR con las fotos dibujadas y deja un ONNX.
 *
 * Lo delicado es la GPU: es una RTX 3050 de 6 GB que comparten omni-lpr y omni-vision, y
 * omni-vision solo ya ocupa ~2,6 GB. Entrenar al lado no entra, así que mientras se entrena
 * omni-vision se PARA (verificación de intrusión, registro, búsqueda y zonas entrenables quedan en
 * pausa) y se avisa al vigía con VISION_PAUSA, que tiene vencimiento: si este proceso se cae a la
 * mitad, el vigía lo levanta igual cuando vence. omni-lpr no se toca.
 *
 * Por eso, por defecto, se entrena de noche (ENTRENADOR_VENTANA, hora del barrio); «ahora» lo
 * pide una persona desde la pantalla, que le dice qué se pausa.
 *
 * Cada paso deja rastro en la fila: estado, progreso (época y métricas), resultado o error.
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });  // pm2 lo corre con cwd en la raíz, pero así no depende de eso
const fs = require("fs");
const path = require("path");
const { promisify } = require("util");
const { exec } = require("child_process");
const { PrismaClient } = require("@prisma/client");
const { S3Client, GetObjectCommand } = require("@aws-sdk/client-s3");

const correr = promisify(exec);
const prisma = new PrismaClient();
const log = (...a) => console.log(new Date().toISOString(), "[entrenador]", ...a);

const CADA_MS = 20_000;
const BUCKET = process.env.VISION_BUCKET || "objetos";
const CARPETAS = process.env.ENTRENAMIENTOS_DIR || path.join(__dirname, "..", "entrenamientos");
const IMAGEN = "omni-entrenador:gpu";
const CONTENEDOR = "omni-entrenando";
const ZONA = process.env.NEXT_PUBLIC_TZ || "America/Montevideo";
/** Cuándo se puede entrenar sin que nadie lo pida: de madrugada, cuando menos se usa la verificación. */
const VENTANA_DEFECTO = "02:00-06:00";
/** La pausa del vigía dura lo que el entrenamiento como máximo, más esto (exportar, levantar). */
const MARGEN_PAUSA_MIN = 30;
/** Tras pedir cancelar, se espera a que termine la época; si no, se para el contenedor. */
const CANCELAR_ESPERA_MS = 10 * 60_000;
/** Memoria y CPU del contenedor: el CT tiene 12 GB y 8 núcleos, y la app sigue andando. */
const MEMORIA = process.env.ENTRENADOR_MEMORIA || "6g";
const CPUS = process.env.ENTRENADOR_CPUS || "4";

const ajuste = async (k, d = null) => (await prisma.setting.findUnique({ where: { key: k } }).catch(() => null))?.value ?? d;
const escribirAjuste = (key, value) => prisma.setting.upsert({ where: { key }, update: { value }, create: { key, value } });

async function s3() {
    const [endpoint, accessKey, secretKey] = await Promise.all([ajuste("S3_ENDPOINT"), ajuste("S3_ACCESS_KEY"), ajuste("S3_SECRET_KEY")]);
    return new S3Client({
        endpoint: endpoint || process.env.S3_ENDPOINT, region: "us-east-1", forcePathStyle: true,
        credentials: { accessKeyId: accessKey || process.env.S3_ACCESS_KEY, secretAccessKey: secretKey || process.env.S3_SECRET_KEY },
    });
}

/** ¿Estamos dentro de la ventana «HH:MM-HH:MM» (hora del barrio)? Cruza la medianoche si hace falta. */
function enVentana(ventana) {
    const m = /^(\d{2}):(\d{2})-(\d{2}):(\d{2})$/.exec(ventana || "");
    if (!m) return false;
    const [h, mi] = new Intl.DateTimeFormat("es-UY", { timeZone: ZONA, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date()).split(":").map(Number);
    const ahora = h * 60 + mi, a = +m[1] * 60 + +m[2], b = +m[3] * 60 + +m[4];
    return a <= b ? ahora >= a && ahora < b : ahora >= a || ahora < b;
}

async function sh(cmd, timeout = 60_000) { return (await correr(cmd, { timeout, maxBuffer: 8 * 1024 * 1024 })).stdout.trim(); }
async function corriendo() { try { return (await sh(`docker inspect ${CONTENEDOR} --format '{{.State.Running}}'`)) === "true"; } catch { return null; } }
const leer = (f) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; } };

async function pausarVision(maxMin) {
    const hasta = new Date(Date.now() + (maxMin + MARGEN_PAUSA_MIN) * 60_000).toISOString();
    await escribirAjuste("VISION_PAUSA", JSON.stringify({ hasta, motivo: "entrenando el detector propio" }));
    await sh("docker stop omni-vision", 90_000).catch((e) => log("no se pudo parar omni-vision:", e.message));
}
async function reanudarVision() {
    await prisma.setting.deleteMany({ where: { key: "VISION_PAUSA" } }).catch(() => null);
    await sh("docker start omni-vision", 90_000).then(() => log("omni-vision levantado")).catch((e) => log("no se pudo levantar omni-vision (lo intenta el vigía):", e.message));
}

/** Baja las fotos revisadas y arma dataset.json. Devuelve el resumen que queda en la fila. */
async function preparar(t, carpeta) {
    const crudo = path.join(carpeta, "crudo");
    fs.mkdirSync(crudo, { recursive: true });
    const clases = await prisma.clasePropia.findMany({ orderBy: { createdAt: "asc" } });
    const fotos = await prisma.fotoEntrenamiento.findMany({ where: { revisada: true } });
    const validas = new Set(clases.map((c) => c.id));
    const c = await s3();
    const lista = [];
    for (const f of fotos) {
        const destino = path.join(crudo, `${f.id}.jpg`);
        try {
            const r = await c.send(new GetObjectCommand({ Bucket: BUCKET, Key: f.clave }));
            fs.writeFileSync(destino, Buffer.from(await r.Body.transformToByteArray()));
            lista.push({ archivo: `${f.id}.jpg`, cajas: (f.cajas || []).filter((x) => validas.has(x.clase)) });
        } catch (e) { log(`foto ${f.id} no se pudo bajar: ${e.message}`); }
    }
    fs.writeFileSync(path.join(crudo, "dataset.json"), JSON.stringify({ clases: clases.map((x) => ({ id: x.id, nombre: x.nombre })), fotos: lista }));
    fs.writeFileSync(path.join(carpeta, "parametros.json"), JSON.stringify(t.parametros));
    const porClase = Object.fromEntries(clases.map((x) => [x.id, lista.reduce((n, f) => n + f.cajas.filter((k) => k.clase === x.id).length, 0)]));
    return { clases: clases.map((x) => ({ id: x.id, nombre: x.nombre, cajas: porClase[x.id] })), fotos: lista.length, negativas: lista.filter((f) => !f.cajas.length).length };
}

/** Sigue un contenedor que ya corre hasta que termina. Devuelve el código de salida. */
async function seguir(t, carpeta) {
    let pedidoCancelar = null;
    for (;;) {
        const p = leer(path.join(carpeta, "progreso.json"));
        const fila = await prisma.entrenamientoDetector.findUnique({ where: { id: t.id } });
        const estado = p?.fase === "exportando" ? "EXPORTANDO" : "ENTRENANDO";
        await prisma.entrenamientoDetector.update({ where: { id: t.id }, data: { estado, ...(p ? { progreso: p } : {}) } });
        if (fila?.cancelar && !pedidoCancelar) {
            pedidoCancelar = Date.now();
            fs.writeFileSync(path.join(carpeta, "detener"), "");
            log(`cancelar ${t.id}: se para al terminar la época`);
        }
        if (pedidoCancelar && Date.now() - pedidoCancelar > CANCELAR_ESPERA_MS) await sh(`docker stop ${CONTENEDOR}`, 120_000).catch(() => null);
        if (!(await corriendo())) break;
        await new Promise((r) => setTimeout(r, 15_000));
    }
    const codigo = Number(await sh(`docker inspect ${CONTENEDOR} --format '{{.State.ExitCode}}'`).catch(() => "1"));
    const cola = await sh(`docker logs --tail 60 ${CONTENEDOR} 2>&1`).catch(() => "");
    await sh(`docker rm -f ${CONTENEDOR}`).catch(() => null);
    return { codigo, cola };
}

async function terminar(t, carpeta, { codigo, cola }) {
    const r = leer(path.join(carpeta, "resultado.json"));
    const fila = await prisma.entrenamientoDetector.findUnique({ where: { id: t.id } });
    const hayModelo = fs.existsSync(path.join(carpeta, "modelo.onnx"));
    const estado = r?.ok && hayModelo ? (fila?.cancelar || r.cancelado ? "CANCELADO" : "LISTO") : fila?.cancelar ? "CANCELADO" : "FALLO";
    const error = estado === "FALLO" ? (r?.error || `El entrenamiento terminó con código ${codigo}.`) + (cola ? `\n…\n${cola.slice(-3000)}` : "") : null;
    await prisma.entrenamientoDetector.update({ where: { id: t.id }, data: { estado, resultado: r || undefined, error, terminadoAt: new Date(), progreso: leer(path.join(carpeta, "progreso.json")) || undefined } });
    log(`${t.id}: ${estado}`);
}

async function correrUno(t) {
    const carpeta = path.join(CARPETAS, t.id);
    const max = Number(t.parametros?.max_minutos) || 180;
    try {
        await sh(`docker image inspect ${IMAGEN} --format '{{.Id}}'`).catch(() => { throw new Error(`Falta la imagen ${IMAGEN}: hay que construirla una vez (services/omni-entrenador/Dockerfile).`); });
        await prisma.entrenamientoDetector.update({ where: { id: t.id }, data: { estado: "PREPARANDO", iniciadoAt: new Date(), carpeta } });
        const conjunto = await preparar(t, carpeta);
        await prisma.entrenamientoDetector.update({ where: { id: t.id }, data: { conjunto } });
        log(`${t.id}: ${conjunto.fotos} fotos; se pausa omni-vision`);
        await pausarVision(max);
        await sh(`docker rm -f ${CONTENEDOR}`).catch(() => null);
        await sh(`docker run -d --name ${CONTENEDOR} --gpus all --memory ${MEMORIA} --cpus ${CPUS} --shm-size 2g -v ${carpeta}:/trabajo ${IMAGEN} /trabajo`);
        await terminar(t, carpeta, await seguir(t, carpeta));
    } catch (e) {
        log(`${t.id}: falló: ${e.message}`);
        await prisma.entrenamientoDetector.update({ where: { id: t.id }, data: { estado: "FALLO", error: e.message, terminadoAt: new Date() } }).catch(() => null);
    } finally {
        if (fs.existsSync(path.join(CARPETAS, t.id, "crudo"))) fs.rmSync(path.join(CARPETAS, t.id, "crudo"), { recursive: true, force: true });
        if (fs.existsSync(path.join(CARPETAS, t.id, "coco"))) fs.rmSync(path.join(CARPETAS, t.id, "coco"), { recursive: true, force: true });
        await reanudarVision();
    }
}

let ocupado = false;
async function vuelta() {
    if (ocupado) return;
    ocupado = true;
    try {
        // Cancelados antes de empezar: no hay nada que parar.
        await prisma.entrenamientoDetector.updateMany({ where: { estado: "EN_COLA", cancelar: true }, data: { estado: "CANCELADO", terminadoAt: new Date() } });
        const ventana = await ajuste("ENTRENADOR_VENTANA", VENTANA_DEFECTO);
        // El latido: la pantalla dice «el entrenador no está corriendo» o «falta la imagen» en vez
        // de dejar un entrenamiento en cola para siempre sin que nadie sepa por qué.
        const imagen = await sh(`docker image inspect ${IMAGEN} --format '{{.Id}}'`).then(() => true).catch(() => false);
        await escribirAjuste("ENTRENADOR_ESTADO", JSON.stringify({ latido: new Date().toISOString(), imagen, ventana, enVentana: enVentana(ventana) }));
        const t = await prisma.entrenamientoDetector.findFirst({ where: { estado: "EN_COLA" }, orderBy: { createdAt: "asc" } });
        if (t && (t.cuando === "ahora" || enVentana(ventana))) { log(`toma ${t.id} (${t.cuando})`); await correrUno(t); }
    } catch (e) { log("vuelta:", e.message); }
    finally { ocupado = false; }
}

/**
 * Al arrancar: si quedó un entrenamiento a medias (este proceso se reinició), se lo sigue si el
 * contenedor todavía corre; si no, se lo da por fallado y se levanta omni-vision.
 */
async function recuperar() {
    const t = await prisma.entrenamientoDetector.findFirst({ where: { estado: { in: ["PREPARANDO", "ENTRENANDO", "EXPORTANDO"] } } });
    if (!t) { if (await ajuste("VISION_PAUSA")) await reanudarVision(); return; }
    const carpeta = t.carpeta || path.join(CARPETAS, t.id);
    if (await corriendo()) {
        log(`${t.id}: el contenedor sigue; se retoma el seguimiento`);
        ocupado = true;
        try { await terminar(t, carpeta, await seguir(t, carpeta)); } finally { await reanudarVision(); ocupado = false; }
    } else {
        await prisma.entrenamientoDetector.update({ where: { id: t.id }, data: { estado: "FALLO", error: "El entrenador se reinició a la mitad y el contenedor ya no corría.", terminadoAt: new Date() } });
        await sh(`docker rm -f ${CONTENEDOR}`).catch(() => null);
        await reanudarVision();
    }
}

(async () => {
    fs.mkdirSync(CARPETAS, { recursive: true });
    log(`arranca; carpeta ${CARPETAS}; ventana por defecto ${VENTANA_DEFECTO} (${ZONA})`);
    await recuperar().catch((e) => log("recuperar:", e.message));
    setInterval(vuelta, CADA_MS);
    vuelta();
})();
