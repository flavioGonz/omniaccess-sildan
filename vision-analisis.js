/**
 * Análisis de fotos con omni-vision — corre dentro de vision-worker. Dos colas, en este orden:
 *
 *  1. Verificación de intrusión: cada captura de un cruce de línea o una intrusión que manda una
 *     cámara (Detection) se mira con la segmentación. Se guarda lo que se vio (siluetas) en
 *     `Detection.verifAnalisis`; el veredicto —¿una persona toca la línea?— se calcula al mostrar,
 *     con la geometría vigente de la cámara (src/lib/vision-capa.ts). Nunca acepta ni descarta
 *     una alarma: decide una persona.
 *  2. Lecturas LPR: la foto de cada lectura, con las siluetas y los atributos (color, carrocería)
 *     de lo que se ve. Una fila por lectura en `AnalisisFoto`. No cambia la lectura ni la barrera.
 *  3. Huellas para la búsqueda: el vector de SigLIP 2 del recorte de cada pista del registro
 *     (HuellaObjeto), bajado de MinIO. Primero las nuevas, y en los ratos libres las viejas: así
 *     la búsqueda encuentra también lo que se vio antes de que existiera.
 *
 * Las fotos ya están en MinIO (las sirve /api/files): acá no se guarda ninguna imagen nueva,
 * sólo lo que se vio en ellas. Lo que vision-worker sí guarda (recortes del registro, fotos de
 * eventos, relecturas) va al bucket `objetos` del mismo MinIO.
 *
 * Un pedido por vez y con pausa: la GPU es de omni-lpr también.
 */

const http = require("http");

const APP = (process.env.APP_INTERNAL_URL || "http://127.0.0.1:10001").replace(/\/$/, "");
/** Las detecciones de cámara que se verifican: las que dicen «alguien cruzó / entró». */
const TIPOS_INTRUSION = ["LINECROSS", "INTRUSION", "REGION_ENTER"];
/** Lo que se busca en la foto: gente, vehículos y animales (un perro es la falsa alarma típica). */
const GRUPOS = "persona,vehiculo,animal";
/** Hasta cuándo se mira hacia atrás al arrancar. La intrusión, un día; las lecturas, lo que muestra Control LPR. */
const VENTANA_INTRUSION_MS = 24 * 3600_000;
const VENTANA_LPR_MS = 2 * 3600_000;
/**
 * Doble verificación: además de la captura de la cámara se saca un cuadro propio del canal
 * (/api/snapshot) y se mira también. La captura sale una fracción de segundo después del cruce
 * y a veces la persona ya está a medias fuera: el cuadro propio es una segunda chance. Sólo si
 * la detección es reciente (después de esto el cuadro ya no muestra ese momento).
 */
const PROPIO_MAX_MS = 20_000;
/** La foto puede llegar a MinIO unos segundos después del evento. */
const FOTO_ESPERA_MS = 90_000;
const PAUSA_MS = 400;
const OCIOSO_MS = 3000;
/** Más puntos por silueta no se ven y pesan en la base (el mismo tope que src/lib/vision-capa.ts). */
const PUNTOS_SILUETA_MAX = 80;
/** Una pista sin verse hace esto ya se cerró: su recorte es el definitivo (el registro la cierra a los 15 s). */
const PISTA_CERRADA_MS = 30_000;
/**
 * Las columnas de fecha son `timestamp` sin zona y guardan UTC, pero la sesión de Postgres está
 * en America/Montevideo. Un Date pasado a $queryRaw llega como timestamptz, y al compararlo
 * Postgres lee la columna como hora LOCAL: todo queda 3 h en el futuro. Con eso, «la pista se
 * cerró hace 30 s» sólo era cierto para pistas de hace más de 3 h y la búsqueda nunca tenía lo
 * reciente. Se pasa el límite como texto UTC sin zona, que es lo que la columna guarda.
 */
const sinZona = (ms) => new Date(ms).toISOString().replace("T", " ").replace("Z", "");
/** Cuatro decimales en coordenadas 0-1: menos de un píxel en una foto de 4K. */
const r4 = (v) => Math.round(v * 10000) / 10000;
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

function aligerar(poli) {
    if (poli.length <= PUNTOS_SILUETA_MAX) return poli;
    const paso = poli.length / PUNTOS_SILUETA_MAX;
    return Array.from({ length: PUNTOS_SILUETA_MAX }, (_, i) => poli[Math.floor(i * paso)]);
}

function emitir(evento, datos) {
    try {
        const cuerpo = JSON.stringify({ __event: evento, ...datos });
        const req = http.request({ hostname: "127.0.0.1", port: Number(process.env.WEBHOOK_PORT || 10000), path: "/internal/emit", method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(cuerpo) }, timeout: 2000 });
        req.on("error", () => { }); req.on("timeout", () => req.destroy());
        req.write(cuerpo); req.end();
    } catch { }
}

/**
 * @param {object} o
 * @param o.estado  () => { verificar, lpr, atributos, segmentar, detectar } — lo que hoy está prendido
 */
/**
 * «¿Es un taxi?» por cómo se ve (18/10, Nico: «que el motor LPR catalogue mejor las chapas de
 * Uruguay y sus tipos»). La chapa dice el tipo por sus letras (lib/categoria-chapa), pero una
 * lectura equivocada inventa una categoría (en el lab un «SAM9863», ambulancia, era SDH 9863) y en
 * el interior el prefijo sólo es «probable». El aspecto es una segunda prueba que no depende del OCR.
 *
 * Se compara la huella SigLIP del vehículo (la misma de la búsqueda) con frases de siete clases de
 * vehículo. Medido el 18/10 en el lab, uniendo cada acceso LPR con su pista de OmniVision: de 14
 * taxis STX, 11 dieron «taxi» como la clase más parecida; de 284 particulares, ninguno. Las otras
 * clases (ambulancia, policía, ómnibus) NO se afirman: con 2 o 3 casos no hay medición, y el 3,5 %
 * de los particulares salía «patrullero». Sólo se guarda el taxi, como atributo del vehículo
 * (`servicio`), que el historial muestra como rasgo y usa en el filtro de tipo de chapa.
 *
 * Las frases son las de la medición: no cambiarlas sin volver a medir (vision-medir/siglip-cat).
 */
const SERVICIO_CLASES = {
    taxi: ["un taxi", "a taxi cab with a roof sign"],
    particular: ["un auto particular", "a private car"],
    ambulancia: ["una ambulancia", "an ambulance"],
    policia: ["un patrullero de policía", "a police car"],
    omnibus: ["un ómnibus", "a bus"],
    furgon: ["una camioneta de transporte de pasajeros", "a passenger van"],
    camion: ["un camión", "a truck"],
};
/**
 * Cuánto le tiene que ganar «taxi» a «auto particular» (coseno). Primero fue 0,005 (taxis +0,028 de
 * mediana; particulares −0,015 en el p90) y en producción dio 116 marcados de los que, cruzados con
 * la lectura LPR del mismo instante, 16 de 26 eran STX: 62 %. Los que no eran taxi quedaban todos
 * debajo de 0,02, salvo tres (y uno, SYA0523, era el taxi STX0523 mal leído). Con 0,02: ~85 %.
 */
const SERVICIO_MARGEN_TAXI = 0.02;
/** De a cuántas huellas viejas se repasan en un rato libre (sólo cuentas: no toca la GPU). */
const SERVICIO_LOTE = 400;

function normalizarV(v) { let n = 0; for (const x of v) n += x * x; n = Math.sqrt(n) || 1; return v.map((x) => x / n); }
/** El servicio que se le ve al vehículo, o null. `v` normalizado; `textos` de vectoresServicio(). */
function servicioDe(v, textos) {
    let mejor = null, sMejor = -Infinity;
    const s = {};
    for (const [k, t] of Object.entries(textos)) {
        let d = 0; for (let i = 0; i < t.length; i++) d += t[i] * v[i];
        s[k] = d; if (d > sMejor) { sMejor = d; mejor = k; }
    }
    const margen = s.taxi - s.particular;
    return mejor === "taxi" && margen >= SERVICIO_MARGEN_TAXI ? { valor: "taxi", margen: Math.round(margen * 10000) / 10000 } : null;
}
function conServicio(atributos, sv) {
    const lista = Array.isArray(atributos) ? atributos.filter((a) => a?.id !== "servicio") : [];
    return [...lista, { id: "servicio", nombre: "Servicio", valor: sv.valor, prob: Math.min(0.99, 0.6 + sv.margen * 8), dudoso: false, margen: sv.margen }];
}

/** int8 con su escala: v ≈ q × escala. Para ordenar por coseno alcanza y ocupa la cuarta parte. */
function aInt8(v) {
    const max = Math.max(...v.map((x) => Math.abs(x))) || 1;
    const q = Int8Array.from(v, (x) => Math.round((x / max) * 127));
    return { vector: Buffer.from(q.buffer), escala: max / 127 };
}

/**
 * Las cámaras que OmniVision puede tocar (VISION_CAMARAS, el botón de la pared de cámaras): se
 * arma el filtro de Prisma. Un canal de NVR sin equipo (`nvrch-<nvr>-<ch>`) no tiene detecciones
 * propias: server.js las deja sobre el NVR con la etiqueta «canal N sin mapear».
 */
const CANAL_NVR = /^nvrch-([\w-]+)-(\d{1,4})$/;
function filtroCamaras(p) {
    if (!p || p.todas) return null;
    const equipos = p.ids.filter((id) => !CANAL_NVR.test(id));
    const canales = p.ids.map((id) => CANAL_NVR.exec(id)).filter(Boolean).map((m) => ({ deviceId: m[1], label: `canal ${m[2]} sin mapear` }));
    return { OR: [{ deviceId: { in: equipos } }, ...canales] };
}

function iniciar({ prisma, log, vision, estado, bajar, subir, permitidas = () => null }) {
    const contadores = { verificadas: 0, lecturas: 0, huellas: 0, taxis: 0, sinFoto: 0, errores: 0, ultimoError: null, msUltima: null };
    /** Las frases de SERVICIO_CLASES ya vectorizadas (una vez por proceso; se reintenta si omni-vision no estaba). */
    let textosServicio = null;
    async function vectoresServicio() {
        if (textosServicio) return textosServicio;
        const out = {};
        for (const [k, frases] of Object.entries(SERVICIO_CLASES)) {
            const r = await fetch(`${vision}/vector_texto`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ textos: frases }), signal: AbortSignal.timeout(20000) });
            const j = await r.json().catch(() => ({}));
            if (!r.ok || !Array.isArray(j.vectores)) throw new Error(j.error || `omni-vision respondió ${r.status}`);
            const v = new Array(j.vectores[0].length).fill(0);
            for (const x of j.vectores) x.forEach((y, i) => (v[i] += y));
            out[k] = normalizarV(v);
        }
        return (textosServicio = out);
    }
    /** Se anota el taxi en el vehículo. Nunca se borra un servicio puesto antes. */
    async function anotarServicio(id, atributos, vector) {
        const sv = servicioDe(normalizarV(vector), await vectoresServicio());
        if (!sv) return false;
        await prisma.objetoVisto.update({ where: { id }, data: { atributos: conServicio(atributos, sv) } });
        contadores.taxis++;
        return true;
    }
    /** El repaso de las huellas que ya estaban: hacia atrás desde que arrancó el proceso, de a lotes. */
    let repasoHasta = sinZona(Date.now());
    let repasoTerminado = false;
    async function unRepasoServicio() {
        if (repasoTerminado) return false;
        const filas = await prisma.$queryRaw`
            SELECT o.id, o.atributos, o."primeraVez", h.vector, h.escala FROM "ObjetoVisto" o JOIN "HuellaObjeto" h ON h."objetoId" = o.id
             WHERE o.grupo = 'vehiculo' AND o."primeraVez" < ${repasoHasta}::timestamp
             ORDER BY o."primeraVez" DESC LIMIT ${SERVICIO_LOTE}`;
        if (!filas.length) { repasoTerminado = true; log(`servicio: repaso terminado (${contadores.taxis} taxis)`); return false; }
        const textos = await vectoresServicio();
        for (const f of filas) {
            const puesto = Array.isArray(f.atributos) ? f.atributos.find((a) => a?.id === "servicio") : null;
            // Uno marcado con un umbral anterior más bajo: se le saca (el umbral cambia, la marca vieja no debe quedar).
            if (puesto && typeof puesto.margen === "number" && puesto.margen < SERVICIO_MARGEN_TAXI) {
                await prisma.objetoVisto.update({ where: { id: f.id }, data: { atributos: f.atributos.filter((a) => a?.id !== "servicio") } }).catch(() => null);
                continue;
            }
            if (puesto) continue;
            const q = new Int8Array(f.vector.buffer, f.vector.byteOffset, f.vector.byteLength);
            const sv = servicioDe(normalizarV(Array.from(q, (x) => x * f.escala)), textos);
            if (!sv) continue;
            await prisma.objetoVisto.update({ where: { id: f.id }, data: { atributos: conServicio(f.atributos, sv) } }).catch(() => null);
            contadores.taxis++;
        }
        repasoHasta = sinZona(new Date(filas[filas.length - 1].primeraVez).getTime());
        return true;
    }
    /** Recortes que no se pudieron bajar (la retención los borró): no se reintentan en esta vuelta del proceso. */
    const sinRecorte = new Set();

    async function foto(ruta) {
        if (!ruta) return { falta: true };
        try {
            const r = await fetch(APP + ruta, { signal: AbortSignal.timeout(10000) });
            if (r.status === 404) return { falta: true };
            if (!r.ok) return null;
            const b = Buffer.from(await r.arrayBuffer());
            return b.length > 1000 ? { jpeg: b } : { falta: true };
        } catch { return null; }
    }

    /** Lo que omni-vision ve en la foto, compacto para guardar. */
    async function analizar(jpeg, atributos) {
        const e = estado();
        const tarea = e.segmentar ? "segmentar" : "detectar";
        const q = new URLSearchParams({ tarea, grupos: GRUPOS, ...(atributos ? { atributos: "1" } : {}) });
        const r = await fetch(`${vision}/detectar?${q}`, { method: "POST", body: jpeg, headers: { "content-type": "image/jpeg" }, signal: AbortSignal.timeout(30000) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || `omni-vision respondió ${r.status}`);
        return {
            ancho: j.ancho, alto: j.alto, tarea,
            objetos: (j.objetos || []).map((o) => ({
                clase: o.clase, nombre: o.nombre, grupo: o.grupo, confianza: Math.round(o.confianza * 1000) / 1000,
                caja: (o.caja_norm || []).map(r4),
                ...(Array.isArray(o.silueta) ? { silueta: o.silueta.map((p) => aligerar(p).map(([x, y]) => [r4(x), r4(y)])) } : {}),
                ...(Array.isArray(o.atributos) ? { atributos: o.atributos.map((a) => ({ id: a.id, nombre: a.nombre, valor: a.valor, prob: Math.round(a.prob * 100) / 100, dudoso: !!a.dudoso })) } : {}),
            })),
        };
    }

    /**
     * Las cámaras cuyo modo de intrusión NO pide verificación (src/lib/modo-camara.ts: sólo
     * «doble» y las que nunca eligieron modo la llevan). Antes se verificaba todo por igual.
     * Se relee cada minuto: el modo se cambia desde la ficha sin reiniciar el worker.
     */
    let sinVerificar = { ids: [], hasta: 0 };
    async function camarasSinVerificar() {
        if (Date.now() < sinVerificar.hasta) return sinVerificar.ids;
        const filas = await prisma.device.findMany({ where: { deviceType: "CAMERA", intrusionModo: { in: ["camara", "omnivision", "video"] } }, select: { id: true } }).catch(() => null);
        if (filas) sinVerificar = { ids: filas.map((f) => f.id), hasta: Date.now() + 60_000 };
        return sinVerificar.ids;
    }

    async function unaIntrusion() {
        const fuera = await camarasSinVerificar();
        const deOmni = filtroCamaras(permitidas());
        const d = await prisma.detection.findFirst({
            where: {
                verifAt: null, type: { in: TIPOS_INTRUSION }, timestamp: { gte: new Date(Date.now() - VENTANA_INTRUSION_MS) },
                AND: [
                    ...(fuera.length ? [{ OR: [{ deviceId: null }, { deviceId: { notIn: fuera } }] }] : []),
                    ...(deOmni ? [deOmni] : []),
                ],
            },
            orderBy: { timestamp: "desc" }, select: { id: true, deviceId: true, snapshotPath: true, timestamp: true },
        });
        if (!d) return false;
        const t0 = Date.now();
        // El cuadro propio se pide junto con la captura: cuanto antes, más cerca del cruce.
        const reciente = d.deviceId && Date.now() - d.timestamp.getTime() < PROPIO_MAX_MS;
        const [f, propio] = await Promise.all([foto(d.snapshotPath), reciente ? foto(`/api/snapshot/${d.deviceId}?w=1280&t=${Date.now()}`) : null]);
        if (!f) return false;
        if (f.falta) {
            if (Date.now() - d.timestamp.getTime() < FOTO_ESPERA_MS) return false;
            await prisma.detection.update({ where: { id: d.id }, data: { verifEstado: "SIN_FOTO", verifAt: new Date() } });
            contadores.sinFoto++;
            return true;
        }
        try {
            const a = await analizar(f.jpeg, false);
            if (propio?.jpeg) {
                // Se guarda en MinIO (bucket de visión): la ficha lo muestra al lado de la captura.
                const clave = `verificacion/${new Date().toISOString().slice(0, 10)}/${d.id}.jpg`;
                try {
                    await subir(clave, propio.jpeg);
                    a.propio = { foto: clave, despuesMs: Date.now() - d.timestamp.getTime(), ...(await analizar(propio.jpeg, false)) };
                } catch (e) { log("verificación: cuadro propio:", e.message); }
            }
            await prisma.detection.update({ where: { id: d.id }, data: { verifEstado: "OK", verifAnalisis: a, verifAt: new Date(), verifMs: Date.now() - t0, verifError: null } });
            contadores.verificadas++; contadores.msUltima = Date.now() - t0;
            emitir("detection_verified", { id: d.id });
        } catch (e) {
            await prisma.detection.update({ where: { id: d.id }, data: { verifEstado: "ERROR", verifAt: new Date(), verifError: String(e.message).slice(0, 300) } }).catch(() => null);
            contadores.errores++; contadores.ultimoError = e.message;
        }
        return true;
    }

    async function unaLectura() {
        const filas = await prisma.$queryRaw`
            SELECT e.id, e."snapshotPath" AS foto, e.timestamp
            FROM "AccessEvent" e LEFT JOIN "AnalisisFoto" a ON a."accessEventId" = e.id
            WHERE a.id IS NULL AND e."accessType" = 'PLATE' AND e."snapshotPath" IS NOT NULL
              AND e.timestamp > ${sinZona(Date.now() - VENTANA_LPR_MS)}::timestamp
              AND (${!!(permitidas() || { todas: true }).todas}::boolean OR e."deviceId" = ANY(${(permitidas() || { ids: [] }).ids || []}::text[]))
            ORDER BY e.timestamp DESC LIMIT 1`;
        const ev = filas[0];
        if (!ev) return false;
        const t0 = Date.now();
        const f = await foto(ev.foto);
        if (!f) return false;
        const guardar = (data) => prisma.analisisFoto.upsert({ where: { accessEventId: ev.id }, create: { accessEventId: ev.id, ...data }, update: data });
        if (f.falta) {
            if (Date.now() - new Date(ev.timestamp).getTime() < FOTO_ESPERA_MS) return false;
            await guardar({ estado: "SIN_FOTO" }); contadores.sinFoto++;
            return true;
        }
        try {
            const a = await analizar(f.jpeg, estado().atributos);
            await guardar({ estado: "OK", analisis: a, ms: Date.now() - t0 });
            contadores.lecturas++; contadores.msUltima = Date.now() - t0;
            emitir("lectura_analizada", { accessEventId: ev.id });
        } catch (e) {
            await guardar({ estado: "ERROR", error: String(e.message).slice(0, 300), ms: Date.now() - t0 }).catch(() => null);
            contadores.errores++; contadores.ultimoError = e.message;
        }
        return true;
    }

    async function unaHuella() {
        // Los que no se pudieron bajar se excluyen en la consulta: filtrarlos después de un LIMIT
        // dejaba la cola trabada si los primeros veinte eran todos de ésos.
        const filas = await prisma.$queryRaw`
            SELECT o.id, o.recorte, o.grupo, o.atributos FROM "ObjetoVisto" o LEFT JOIN "HuellaObjeto" h ON h."objetoId" = o.id
            WHERE h."objetoId" IS NULL AND o.recorte IS NOT NULL AND o."ultimaVez" < ${sinZona(Date.now() - PISTA_CERRADA_MS)}::timestamp
              AND NOT (o.id = ANY(${[...sinRecorte]}::text[]))
            ORDER BY o."primeraVez" DESC LIMIT 1`;
        const o = filas[0];
        if (!o) return false;
        let jpeg;
        try { jpeg = await bajar(o.recorte); } catch { sinRecorte.add(o.id); return true; }
        const r = await fetch(`${vision}/vector`, { method: "POST", body: jpeg, headers: { "content-type": "image/jpeg" }, signal: AbortSignal.timeout(20000) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok || !Array.isArray(j.vector)) throw new Error(j.error || `omni-vision respondió ${r.status}`);
        await prisma.huellaObjeto.upsert({ where: { objetoId: o.id }, create: { objetoId: o.id, ...aInt8(j.vector) }, update: aInt8(j.vector) });
        contadores.huellas++;
        if (o.grupo === "vehiculo") await anotarServicio(o.id, o.atributos, j.vector).catch((e) => { contadores.ultimoError = `servicio: ${e.message}`; });
        return true;
    }

    let corriendo = true;
    (async function bucle() {
        log(`análisis de fotos: intrusión (${TIPOS_INTRUSION.join(", ")}), lecturas LPR y huellas para la búsqueda`);
        while (corriendo) {
            let hizo = false;
            try {
                const e = estado();
                if (e.detectar) {
                    // La intrusión primero: es la que un guardia está mirando para decidir.
                    if (e.verificar) hizo = await unaIntrusion();
                    if (!hizo && e.lpr) hizo = await unaLectura();
                    if (!hizo && e.huellas) hizo = await unaHuella();
                    // En los ratos libres, el taxi de las huellas que ya estaban (sólo cuentas, sin GPU).
                    if (!hizo && e.huellas) hizo = await unRepasoServicio();
                }
            } catch (err) {
                contadores.errores++; contadores.ultimoError = err.message;
            }
            await dormir(hizo ? PAUSA_MS : OCIOSO_MS);
        }
    })();

    return { contadores, parar: () => { corriendo = false; } };
}

module.exports = { iniciar };
