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
 *
 * Pausar (lo pide la pantalla con parametros.pausar): para al terminar la época, NO exporta,
 * libera la GPU y levanta omni-vision; la carpeta queda con salida/last.ckpt y la fila en PAUSADO.
 * Retomar la vuelve a la cola con parametros.reanudar y sigue desde esa época, sin rearmar el
 * conjunto. Es distinto del congelado por temperatura (docker pause), que retiene la GPU.
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });  // pm2 lo corre con cwd en la raíz, pero así no depende de eso
const fs = require("fs");
const path = require("path");
const { promisify } = require("util");
const { exec } = require("child_process");
const { PrismaClient } = require("@prisma/client");
const { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectsCommand } = require("@aws-sdk/client-s3");

const salud = require("./salud-equipo");
const correr = promisify(exec);
const prisma = new PrismaClient();
const log = (...a) => console.log(new Date().toISOString(), "[entrenador]", ...a);

const CADA_MS = 20_000;
const BUCKET = process.env.VISION_BUCKET || "objetos";
const CARPETAS = process.env.ENTRENAMIENTOS_DIR || path.join(__dirname, "..", "entrenamientos");
/**
 * Dónde se trabaja. Por defecto, al lado de la carpeta del modelo activo; en San Nicolás va al
 * disco de datos (ENTRENADOR_TRABAJO=/datos/entrenamientos en el .env): el del CT es de 118 GB y
 * lo comparte con Docker, mientras que /datos tiene 3,6 TB. Es temporal: se borra al terminar.
 */
const TRABAJO = process.env.ENTRENADOR_TRABAJO || CARPETAS;
/**
 * Retención: los mismos números que src/lib/detector-propio.ts (MODELOS_GUARDADOS,
 * MODELOS_PREFIJO; allá está el porqué). Si se cambian acá, se cambian allá.
 */
const MODELOS_GUARDADOS = 5;
const MODELOS_PREFIJO = "modelos/";
const CADA_PODA_MS = 60 * 60_000;
/**
 * Espacio libre que tiene que haber donde se trabaja antes de empezar. Estimado, no medido con
 * un conjunto real: copia de las fotos dos veces (crudo y COCO, ~300 KB cada una) y cuatro o cinco
 * checkpoints de unos 450 MB (pesos + EMA + estado del optimizador) — unos 3 GB con 1.000 fotos.
 * El doble y algo, porque quedarse sin disco a la mitad deja el CT sin espacio para la app.
 */
const ESPACIO_MIN_GB = 8;
const TERMINADOS = ["LISTO", "CANCELADO", "FALLO"];
/** Pausado por una persona: la carpeta (con last.ckpt) NO se borra, porque desde ahí se retoma. */
const PAUSADO = "PAUSADO";
/** El script se monta desde el repo: un cambio de entrenar.py no obliga a reconstruir la imagen (torch, varios GB). */
const SCRIPT = path.join(__dirname, "..", "services", "omni-entrenador", "entrenar.py");
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

const TELEMETRIA = salud.dirTelemetria(TRABAJO);

/**
 * El entrenamiento en curso, visto desde la salud del equipo: si está congelado por temperatura,
 * cuánto, y lo peor que se midió. Lo actualiza `vigilar` cada 5 s.
 */
let enCurso = null;
let ultimaMuestra = null;
/**
 * `base` es el consumo de los tramos anteriores (si se pausó y retomó): el resumen suma todo, así
 * la pantalla dice lo que costó el entrenamiento entero, no sólo el último tramo.
 */
const nuevoEnCurso = (id, base = null) => ({ id, congelado: false, congeladoDesde: 0, enfriadoMs: 0, pausas: 0, corte: null, max: { gpu: null, cpu: null, w: null, mem: null }, sumaW: 0, n: 0, wh: 0, ultimaMs: 0, desde: Date.now(), base });
const mayor = (a, b) => (b == null ? a : a == null ? b : Math.max(a, b));
const resumenSalud = (e) => {
    if (!e) return null;
    const b = e.base || {};
    const enfriadoSeg = Math.round((e.enfriadoMs + (e.congelado ? Date.now() - e.congeladoDesde : 0)) / 1000);
    const segundos = Math.round((Date.now() - e.desde) / 1000);
    return {
        estado: e.corte ? "cortado" : e.congelado ? "enfriando" : "entrenando", corte: e.corte,
        pausas: (b.pausas || 0) + e.pausas, enfriadoSeg: (b.enfriadoSeg || 0) + enfriadoSeg,
        max: { gpu: mayor(b.max?.gpu ?? null, e.max.gpu), cpu: mayor(b.max?.cpu ?? null, e.max.cpu), w: mayor(b.max?.w ?? null, e.max.w), mem: mayor(b.max?.mem ?? null, e.max.mem) },
        wPromedio: e.n ? Math.round(e.sumaW / e.n) : b.wPromedio ?? null,
        // Energía de la GPU (integrada muestra a muestra) y tiempo de reloj, sumando los tramos.
        wh: Math.round(((b.wh || 0) + e.wh) * 10) / 10,
        segundos: (b.segundos || 0) + segundos, minutos: Math.round(((b.segundos || 0) + segundos) / 60),
        tramos: (b.tramos || 0) + 1,
        ahora: ultimaMuestra ? { gpu: ultimaMuestra.gpu?.t ?? null, cpu: ultimaMuestra.cpu?.t ?? null, w: ultimaMuestra.gpu?.w ?? null, uso: ultimaMuestra.gpu?.uso ?? null, mem: ultimaMuestra.gpu?.mem ?? null, memTotal: ultimaMuestra.gpu?.memTotal ?? null } : null,
    };
};

/** Congelar / descongelar / parar el contenedor. Parar uno congelado exige descongelarlo antes. */
async function congelar() { await sh(`docker pause ${CONTENEDOR}`, 30_000); }
async function descongelar() { await sh(`docker unpause ${CONTENEDOR}`, 30_000).catch(() => null); }
async function parar(t = 30) { await descongelar(); await sh(`docker stop -t ${t} ${CONTENEDOR}`, 120_000).catch(() => null); }

/**
 * La vigilancia: mide (salud-equipo.js), guarda la muestra y, si se está entrenando, decide.
 * Corre siempre — cada 5 s entrenando, cada minuto en reposo — para que el reporte muestre
 * también cómo está el equipo cuando no se entrena (la referencia contra la que comparar).
 */
async function vigilar() {
    try {
        const m = await salud.medir();
        const e = enCurso;
        m.estado = e ? (e.congelado ? "enfriando" : "entrenando") : "reposo";
        if (e) m.entrenamiento = e.id;
        ultimaMuestra = m;
        salud.registrar(TELEMETRIA, m, !!e);
        if (e && !e.corte) {
            e.max = { gpu: mayor(e.max.gpu, m.gpu?.t), cpu: mayor(e.max.cpu, m.cpu?.t), w: mayor(e.max.w, m.gpu?.w), mem: mayor(e.max.mem, m.gpu?.mem) };
            const ahoraMs = Date.now();
            if (m.gpu?.w != null) {
                e.sumaW += m.gpu.w; e.n++;
                // Vatios × el tiempo desde la muestra anterior (tope 30 s: si la vigilancia se trabó,
                // no se inventa consumo para el hueco).
                if (e.ultimaMs) e.wh += m.gpu.w * Math.min(30, (ahoraMs - e.ultimaMs) / 1000) / 3600;
            }
            e.ultimaMs = ahoraMs;
            const d = salud.decidir(m, e.congelado, e.congeladoDesde);
            if (d.accion === "enfriar") {
                await congelar().then(() => { e.congelado = true; e.congeladoDesde = Date.now(); e.pausas++; log(`${e.id}: congelado para enfriar (${d.motivo})`); })
                    .catch((x) => log(`${e.id}: no se pudo congelar:`, x.message));
            } else if (d.accion === "reanudar") {
                await descongelar(); e.enfriadoMs += Date.now() - e.congeladoDesde; e.congelado = false;
                log(`${e.id}: se reanuda (GPU ${m.gpu?.t} °C, CPU ${m.cpu?.t} °C)`);
            } else if (d.accion === "cortar") {
                e.corte = d.motivo;
                log(`${e.id}: CORTADO para cuidar el equipo: ${d.motivo}`);
                if (e.congelado) { e.enfriadoMs += Date.now() - e.congeladoDesde; e.congelado = false; }
                await parar(10);
            }
        }
    } catch (x) { log("vigilar:", x.message); }
    finally { setTimeout(vigilar, enCurso ? salud.MUESTRA_ENTRENANDO_MS : salud.MUESTRA_REPOSO_MS); }
}

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
    let pedidoCancelar = null, pedidoPausa = null;
    for (;;) {
        const p = leer(path.join(carpeta, "progreso.json"));
        const fila = await prisma.entrenamientoDetector.findUnique({ where: { id: t.id } });
        const estado = p?.fase === "exportando" ? "EXPORTANDO" : "ENTRENANDO";
        await prisma.entrenamientoDetector.update({ where: { id: t.id }, data: { estado, progreso: { ...(p || {}), salud: resumenSalud(enCurso) } } });
        if (fila?.cancelar && !pedidoCancelar) {
            pedidoCancelar = Date.now();
            // Congelado por temperatura, no va a llegar al fin de la época: se para ya.
            if (enCurso?.congelado) await parar(10);
            fs.writeFileSync(path.join(carpeta, "detener"), "");
            log(`cancelar ${t.id}: se para al terminar la época`);
        }
        if (fila?.parametros?.pausar && !pedidoPausa && !pedidoCancelar) {
            pedidoPausa = Date.now();
            if (enCurso?.congelado) { await descongelar(); enCurso.enfriadoMs += Date.now() - enCurso.congeladoDesde; enCurso.congelado = false; }
            fs.writeFileSync(path.join(carpeta, "pausar"), "");
            fs.writeFileSync(path.join(carpeta, "detener"), "");
            log(`pausar ${t.id}: se para al terminar la época y queda last.ckpt`);
        }
        // Si la época no termina a tiempo se para igual: last.ckpt de la época anterior sigue ahí.
        const pedido = pedidoCancelar || pedidoPausa;
        if (pedido && Date.now() - pedido > CANCELAR_ESPERA_MS) await parar(30);
        if (!(await corriendo())) break;
        await new Promise((r) => setTimeout(r, 10_000));
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
    const corte = enCurso?.id === t.id ? enCurso.corte : null;
    const s0 = resumenSalud(enCurso?.id === t.id ? enCurso : null);
    // Pausado: o lo dijo entrenar.py, o se lo paró a la fuerza tras pedir pausa y quedó last.ckpt.
    const ckpt = fs.existsSync(path.join(carpeta, "salida", "last.ckpt"));
    if (!corte && !fila?.cancelar && fila?.parametros?.pausar && ckpt && (r?.pausado || !hayModelo)) {
        const p = leer(path.join(carpeta, "progreso.json")) || {};
        await prisma.entrenamientoDetector.update({ where: { id: t.id }, data: {
            estado: PAUSADO, error: null,
            parametros: { ...fila.parametros, pausar: false, reanudar: false, segundos_previos: r?.segundos ?? p.segundos ?? 0, epoca_previa: p.epoca || 0 },
            progreso: { ...p, fase: "pausado", salud: s0 ? { ...s0, estado: "pausado" } : null },
        } });
        fs.rmSync(path.join(carpeta, "pausar"), { force: true }); fs.rmSync(path.join(carpeta, "detener"), { force: true });
        log(`${t.id}: PAUSADO en la época ${p.epoca || "?"}`);
        return;
    }
    const estado = corte ? "FALLO" : r?.ok && hayModelo ? (fila?.cancelar || r.cancelado ? "CANCELADO" : "LISTO") : fila?.cancelar ? "CANCELADO" : "FALLO";
    const error = corte ? `Cortado para cuidar el equipo: ${corte}. Mirá «Salud del equipo» para ver cómo venía.`
        : estado === "FALLO" ? (r?.error || `El entrenamiento terminó con código ${codigo}.`) + (cola ? `\n…\n${cola.slice(-3000)}` : "") : null;
    const s = s0;
    await prisma.entrenamientoDetector.update({ where: { id: t.id }, data: {
        estado, resultado: r ? { ...r, salud: s } : s ? { ok: false, salud: s } : undefined, error, terminadoAt: new Date(),
        progreso: { ...(leer(path.join(carpeta, "progreso.json")) || {}), salud: s },
    } });
    log(`${t.id}: ${estado}`);
}

async function correrUno(t) {
    const carpeta = path.join(TRABAJO, t.id);
    const max = Number(t.parametros?.max_minutos) || 180;
    try {
        await sh(`docker image inspect ${IMAGEN} --format '{{.Id}}'`).catch(() => { throw new Error(`Falta la imagen ${IMAGEN}: hay que construirla una vez (services/omni-entrenador/Dockerfile).`); });
        const libre = libreGB(TRABAJO);
        if (libre != null && libre < ESPACIO_MIN_GB) throw new Error(`Falta espacio en ${TRABAJO}: quedan ${libre.toFixed(1)} GB y hacen falta ${ESPACIO_MIN_GB} para entrenar sin llenar el disco.`);
        // Retomar: misma carpeta, mismo conjunto (las fotos pudieron cambiar desde la pausa, pero
        // mezclar conjuntos a mitad de camino haría que la medición no corresponda a nada).
        const retoma = !!t.parametros?.reanudar && fs.existsSync(path.join(carpeta, "salida", "last.ckpt"));
        if (t.parametros?.reanudar && !retoma) throw new Error("No quedó el punto de guardado (last.ckpt) de la pausa: hay que entrenar de nuevo.");
        await prisma.entrenamientoDetector.update({ where: { id: t.id }, data: { estado: "PREPARANDO", iniciadoAt: t.iniciadoAt || new Date(), carpeta } });
        if (retoma) {
            fs.writeFileSync(path.join(carpeta, "parametros.json"), JSON.stringify(t.parametros));
            for (const f of ["pausar", "detener", "resultado.json"]) fs.rmSync(path.join(carpeta, f), { force: true });
            log(`${t.id}: se retoma desde la época ${t.parametros.epoca_previa || "?"}; se pausa omni-vision`);
        } else {
            const conjunto = await preparar(t, carpeta);
            await prisma.entrenamientoDetector.update({ where: { id: t.id }, data: { conjunto } });
            log(`${t.id}: ${conjunto.fotos} fotos; se pausa omni-vision`);
        }
        await pausarVision(max);
        await sh(`docker rm -f ${CONTENEDOR}`).catch(() => null);
        const montaScript = fs.existsSync(SCRIPT) ? `-v ${SCRIPT}:/app/entrenar.py:ro` : "";
        await sh(`docker run -d --name ${CONTENEDOR} --gpus all --memory ${MEMORIA} --cpus ${CPUS} --shm-size 2g -v ${carpeta}:/trabajo ${montaScript} ${IMAGEN} /trabajo`);
        enCurso = nuevoEnCurso(t.id, retoma ? t.progreso?.salud || null : null);
        await terminar(t, carpeta, await seguir(t, carpeta));
    } catch (e) {
        log(`${t.id}: falló: ${e.message}`);
        await prisma.entrenamientoDetector.update({ where: { id: t.id }, data: { estado: "FALLO", error: e.message, terminadoAt: new Date() } }).catch(() => null);
    } finally {
        enCurso = null;
        await reanudarVision();
        await guardarYLimpiar(t.id, carpeta).catch((e) => log(`${t.id}: no se pudo archivar:`, e.message));
        await podar().catch((e) => log("retención:", e.message));
    }
}

/** GB libres en el disco de esa carpeta (null si no se puede saber). */
function libreGB(dir) {
    try { fs.mkdirSync(dir, { recursive: true }); const s = fs.statfsSync(dir); return (s.bavail * s.bsize) / 1e9; } catch { return null; }
}

const borrarCarpeta = (c) => fs.rmSync(c, { recursive: true, force: true });

/**
 * Un entrenamiento terminado no deja nada en el disco: si dejó modelo, el ONNX y su resultado
 * suben a MinIO (MODELOS_PREFIJO/<id>/) y la fila guarda dónde (resultado.archivo); después se
 * borra la carpeta entera, checkpoints incluidos. Si la subida falla, la carpeta queda SIN los
 * checkpoints (el ONNX solo, ~110 MB) para que se pueda usar igual, y se reintenta en la poda.
 */
async function guardarYLimpiar(id, carpeta) {
    if (!fs.existsSync(carpeta)) return;
    const t = await prisma.entrenamientoDetector.findUnique({ where: { id } });
    // Corriendo, en cola o PAUSADO: no es de la poda. Antes se borraban crudo/coco/salida primero
    // y recién después se miraba el estado: con la pausa eso tiraba el last.ckpt de donde se retoma.
    if (t && !TERMINADOS.includes(t.estado)) return;
    for (const d of ["crudo", "coco", "salida"]) borrarCarpeta(path.join(carpeta, d));
    const onnx = path.join(carpeta, "modelo.onnx");
    const r = t?.resultado;
    if (t && r?.ok && !r.archivo && fs.existsSync(onnx) && (t.estado === "LISTO" || t.estado === "CANCELADO")) {
        const clave = `${MODELOS_PREFIJO}${id}/modelo.onnx`;
        const bytes = fs.statSync(onnx).size;
        const c = await s3();
        await c.send(new PutObjectCommand({ Bucket: BUCKET, Key: clave, Body: fs.createReadStream(onnx), ContentLength: bytes, ContentType: "application/octet-stream" }));
        await c.send(new PutObjectCommand({ Bucket: BUCKET, Key: `${MODELOS_PREFIJO}${id}/resultado.json`, Body: JSON.stringify(r), ContentType: "application/json" }));
        await prisma.entrenamientoDetector.update({ where: { id }, data: { resultado: { ...r, archivo: { clave, bytes, guardadoAt: new Date().toISOString() } } } });
        log(`${id}: modelo en MinIO (${(bytes / 1e6).toFixed(0)} MB)`);
    }
    borrarCarpeta(carpeta);
}

/**
 * La retención: en MinIO, los últimos MODELOS_GUARDADOS modelos más el que esté en uso; y en
 * disco, ninguna carpeta de un entrenamiento terminado (las que quedaron de antes, o de una
 * subida que falló, se archivan y se borran acá). La fila queda: dice qué se entrenó y cómo dio.
 */
async function podar() {
    for (const dir of new Set([TRABAJO, CARPETAS])) {
        if (!fs.existsSync(dir)) continue;
        for (const n of fs.readdirSync(dir)) {
            if (n === "activo" || !fs.statSync(path.join(dir, n)).isDirectory()) continue;
            if (!(await prisma.entrenamientoDetector.findUnique({ where: { id: n }, select: { id: true } }))) continue;  // no es de un entrenamiento: no se toca
            await guardarYLimpiar(n, path.join(dir, n)).catch((e) => log(`${n}: no se pudo archivar:`, e.message));
        }
    }
    let activo = null;
    try { activo = JSON.parse((await ajuste("DETECTOR_PROPIO_ACTIVO")) || "null")?.entrenamiento || null; } catch { activo = null; }
    const conModelo = (await prisma.entrenamientoDetector.findMany({ where: { estado: { in: ["LISTO", "CANCELADO"] } }, orderBy: { createdAt: "desc" } }))
        .filter((t) => t.resultado?.archivo?.clave && !t.resultado.archivo.borradoAt);
    const sobran = conModelo.slice(MODELOS_GUARDADOS).filter((t) => t.id !== activo);
    if (!sobran.length) return;
    const c = await s3();
    for (const t of sobran) {
        await c.send(new DeleteObjectsCommand({ Bucket: BUCKET, Delete: { Quiet: true, Objects: [{ Key: t.resultado.archivo.clave }, { Key: `${MODELOS_PREFIJO}${t.id}/resultado.json` }] } }));
        await prisma.entrenamientoDetector.update({ where: { id: t.id }, data: { resultado: { ...t.resultado, archivo: { ...t.resultado.archivo, borradoAt: new Date().toISOString() } } } });
        log(`retención: modelo de ${t.id} borrado (se guardan los últimos ${MODELOS_GUARDADOS})`);
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
        const libre = libreGB(TRABAJO);
        const t = await prisma.entrenamientoDetector.findFirst({ where: { estado: "EN_COLA" }, orderBy: { createdAt: "asc" } });
        // No se arranca con el equipo ya caliente: se espera en la cola, y la pantalla lo dice.
        const g = ultimaMuestra?.gpu?.t, c = ultimaMuestra?.cpu?.t, tope = salud.LIMITES.arrancarHasta;
        const caliente = (g != null && g > tope.gpu) || (c != null && c > tope.cpu) ? `esperando que el equipo se enfríe (GPU ${g ?? "?"} °C, CPU ${c ?? "?"} °C; arranca con GPU ≤ ${tope.gpu} y CPU ≤ ${tope.cpu})` : null;
        await escribirAjuste("ENTRENADOR_ESTADO", JSON.stringify({
            latido: new Date().toISOString(), imagen, ventana, enVentana: enVentana(ventana), libreGB: libre == null ? null : Math.round(libre * 10) / 10, minimoGB: ESPACIO_MIN_GB,
            salud: ultimaMuestra, limites: salud.LIMITES, telemetria: TELEMETRIA, espera: t ? caliente : null,
        }));
        if (t && (t.cuando === "ahora" || enVentana(ventana))) {
            if (caliente) { log(`${t.id}: ${caliente}`); return; }
            log(`toma ${t.id} (${t.cuando})`); await correrUno(t);
        }
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
        enCurso = nuevoEnCurso(t.id);
        // Si quedó congelado por temperatura, la vigilancia lo descongela cuando baje.
        enCurso.congelado = (await sh(`docker inspect ${CONTENEDOR} --format '{{.State.Paused}}'`).catch(() => "false")) === "true";
        enCurso.congeladoDesde = Date.now();
        try { await terminar(t, carpeta, await seguir(t, carpeta)); } finally { enCurso = null; await reanudarVision(); await guardarYLimpiar(t.id, carpeta).catch(() => null); ocupado = false; }
    } else {
        await prisma.entrenamientoDetector.update({ where: { id: t.id }, data: { estado: "FALLO", error: "El entrenador se reinició a la mitad y el contenedor ya no corría.", terminadoAt: new Date() } });
        await sh(`docker rm -f ${CONTENEDOR}`).catch(() => null);
        await reanudarVision();
        await guardarYLimpiar(t.id, carpeta).catch(() => null);
    }
}

(async () => {
    fs.mkdirSync(CARPETAS, { recursive: true });
    fs.mkdirSync(TRABAJO, { recursive: true });
    log(`arranca; modelo activo en ${CARPETAS}, trabajo en ${TRABAJO}; ventana por defecto ${VENTANA_DEFECTO} (${ZONA})`);
    log(`salud del equipo: telemetría en ${TELEMETRIA}; límites ${JSON.stringify(salud.LIMITES)}`);
    vigilar();
    await recuperar().catch((e) => log("recuperar:", e.message));
    const poda = async () => { salud.podarTelemetria(TELEMETRIA); if (ocupado) return; ocupado = true; try { await podar(); } catch (e) { log("retención:", e.message); } finally { ocupado = false; } };
    await poda();
    setInterval(poda, CADA_PODA_MS);
    setInterval(vuelta, CADA_MS);
    vuelta();
})();
