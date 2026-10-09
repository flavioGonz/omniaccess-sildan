/**
 * Las reglas de las analíticas de visión, dentro de vision-worker: conteo por línea, sentido
 * contrario, tiempo de permanencia, aglomeración, cruce de línea propio e intrusión en zona propia (ver src/lib/vision-reglas.ts, que define
 * las reglas y su validación; acá se aplican).
 *
 * Trabaja sobre lo que ya hace el registro: cada cámara se mira cada ~2 s y omni-vision
 * devuelve los objetos con su número de pista (ByteTrack). De cada objeto se usa el PIE de su
 * caja. Lo que pasa se escribe en EventoVision; si la regla avisa, además un AvisoGuardia (lo
 * ven la consola del guardia, Control LPR y Visitas) y se le avisa al socket por
 * /internal/emit, como hace el resto de la app.
 *
 * Límites que hay que saber (se dicen también en la pantalla):
 *  · A 2 s entre cuadros un auto rápido puede perder su número de pista entre dos cuadros:
 *    entonces no cruza «de un lado al otro» con el mismo número y no se cuenta. Las personas
 *    y los autos a paso de barrio se cuentan bien; una avenida, no.
 *  · El cruce se mide con el segmento entre dos cuadros seguidos: no hace falta que el pie
 *    caiga justo sobre la línea.
 */

const http = require("http");
const crypto = require("crypto");

/** Las analíticas del laboratorio que prenden cada tipo, y su valor si nadie las tocó. */
const ANALITICA = { conteo: "aforo", sentido: "sentido-contrario", permanencia: "permanencia", aglomeracion: "aglomeracion", cruce: "linea-propia", intrusion: "zona-propia" };
const DEFECTO = { aforo: true, "sentido-contrario": true, permanencia: true, aglomeracion: true, "linea-propia": true, "zona-propia": true };
/** Cuánto tiene que correrse el pie (fracción del cuadro) para contar como movimiento. */
const MOVIMIENTO_MIN = 0.01;
/** Una pista que no se ve hace esto deja de existir para las reglas. */
const OLVIDO_MS = 20_000;
/** Dos cruces de la misma pista en la misma línea dentro de esto son el mismo (el pie tiembla sobre la línea). */
const REBOTE_MS = 5_000;
/** Entre dos avisos de sentido contrario de la misma regla. */
const ENFRIO_SENTIDO_MS = 60_000;
/** Entre dos avisos de aglomeración de la misma regla: la misma reunión no avisa cada 30 s. */
const ENFRIO_AGLOMERACION_MS = 10 * 60_000;

/**
 * Entre dos avisos de cruce propio de la misma regla. Cada cruce queda registrado con su foto;
 * lo que se espacia es el aviso: un grupo de cinco que salta el cerco es un aviso, no cinco.
 */
const ENFRIO_CRUCE_MS = 30_000;
/** Lo mismo para la intrusión en zona propia. */
const ENFRIO_INTRUSION_MS = 60_000;
/** La hora del barrio, para el horario de armado de cruce e intrusión. */
const ZONA = process.env.NEXT_PUBLIC_TZ || "America/Montevideo";

const TIPO_AVISO = { SENTIDO_CONTRARIO: "VISION_SENTIDO", PERMANENCIA: "VISION_PERMANENCIA", AGLOMERACION: "VISION_AGLOMERACION", CRUCE_LINEA: "VISION_CRUCE", INTRUSION: "VISION_INTRUSION" };
const NOMBRE_CLASE = { person: "persona", car: "auto", truck: "camioneta", bus: "ómnibus", motorcycle: "moto", bicycle: "bicicleta", dog: "perro" };

const pie = (o) => { const [x1, , x2, y2] = o.caja_norm; return [(x1 + x2) / 2, y2]; };
const lado = (l, p) => (l.b[0] - l.a[0]) * (p[1] - l.a[1]) - (l.b[1] - l.a[1]) * (p[0] - l.a[0]);
/** ¿El segmento p→q corta el segmento a→b? */
function corta(p, q, a, b) {
    const o = (u, v, w) => (v[0] - u[0]) * (w[1] - u[1]) - (v[1] - u[1]) * (w[0] - u[0]);
    const d1 = o(a, b, p), d2 = o(a, b, q), d3 = o(p, q, a), d4 = o(p, q, b);
    return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}
/** Punto dentro de un polígono (ray casting). */
function adentro(p, zona) {
    let dentro = false;
    for (let i = 0, j = zona.length - 1; i < zona.length; j = i++) {
        const [xi, yi] = zona[i], [xj, yj] = zona[j];
        if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) dentro = !dentro;
    }
    return dentro;
}

/** Minuto del día en la hora del barrio. */
function minutoDelDia(d) {
    const [h, m] = new Intl.DateTimeFormat("en-GB", { timeZone: ZONA, hour: "2-digit", minute: "2-digit", hour12: false }).format(d).split(":").map(Number);
    return (h % 24) * 60 + m;
}
/** La misma cuenta que enHorario en src/lib/vision-reglas.ts: si cambia allá, cambia acá. */
function enHorario(h, d) {
    if (!h || !h.desde || !h.hasta) return true;
    const m = (x) => Number(x.slice(0, 2)) * 60 + Number(x.slice(3, 5));
    const a = m(h.desde), b = m(h.hasta), x = minutoDelDia(d);
    if (a === b) return true;
    return a < b ? x >= a && x < b : x >= a || x < b;
}

function emitir(evento, datos) {
    try {
        const cuerpo = JSON.stringify({ __event: evento, ...datos });
        const req = http.request({ hostname: "127.0.0.1", port: Number(process.env.WEBHOOK_PORT || 10000), path: "/internal/emit", method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(cuerpo) }, timeout: 2000 });
        req.on("error", () => { }); req.on("timeout", () => req.destroy());
        req.write(cuerpo); req.end();
    } catch { }
}

function iniciar({ prisma, subir, log }) {
    let reglas = [];
    let analiticas = {};
    const contadores = { cruces: 0, sentido: 0, permanencia: 0, aglomeracion: 0, crucesPropios: 0, intrusiones: 0, avisos: 0, errores: 0, ultimoError: null };
    /** Último pie visto de cada pista: `${deviceId}:${pista}` → { p, t }. */
    const pies = new Map();
    /** Por regla y pista: último cruce { t, sentido }. */
    const cruces = new Map();
    /** Permanencia: `${regla}:${pista}` → { desde, visto, eventoId, clase }. */
    const estadias = new Map();
    /** Aglomeración: regla → { desde, ultimoAviso }. */
    const grupos = new Map();
    const ultimoAvisoSentido = new Map();
    /** Intrusión: `${regla}:${pista}` → { desde, visto, avisado, deviceId }. */
    const intrusos = new Map();
    const ultimoAvisoCruce = new Map();
    const ultimoAvisoIntrusion = new Map();

    const prendida = (r) => r.activa !== false && (analiticas[ANALITICA[r.tipo]] ?? DEFECTO[ANALITICA[r.tipo]]) !== false;

    function cargar(lista, an) {
        reglas = Array.isArray(lista) ? lista.filter((r) => r && r.deviceId && ANALITICA[r.tipo]) : [];
        analiticas = an || {};
    }
    /** Cámaras que hay que mirar por las reglas, aunque el registro esté apagado o no las incluya. */
    function camaras() { return new Set(reglas.filter(prendida).map((r) => r.deviceId)); }
    /** Cámaras con reglas de LÍNEA prendidas: necesitan el carril rápido (ver RAPIDO_FPS en vision-worker). */
    function camarasRapidas() { return new Set(reglas.filter((r) => prendida(r) && (r.tipo === "conteo" || r.tipo === "sentido" || r.tipo === "cruce")).map((r) => r.deviceId)); }
    /** Si hay algo en curso en esa cámara (alguien adentro de una zona): se mira aunque la imagen no cambie. */
    function enCurso(deviceId) {
        if (!reglas.some((r) => r.deviceId === deviceId && prendida(r))) return false;
        // Algo que se MOVIÓ hace poco en una cámara con reglas: se sigue mirando para no perder el
        // cruce. Que se mueva, no que esté: un auto estacionado en el cuadro lo dejaba analizando a
        // 4 c/s todo el día (9/10, LPR Interior: 430 cuadros seguidos por un auto quieto).
        const ahora = Date.now();
        for (const [k, v] of pies) if (k.startsWith(deviceId + ":") && ahora - v.t < OLVIDO_MS && ahora - (v.mov || 0) < OLVIDO_MS) return true;
        for (const r of reglas) {
            if (r.deviceId !== deviceId || !prendida(r)) continue;
            if (r.tipo === "aglomeracion" && grupos.get(r.id)?.desde) return true;
            if (r.tipo === "permanencia") for (const k of estadias.keys()) if (k.startsWith(r.id + ":")) return true;
            if (r.tipo === "intrusion") for (const k of intrusos.keys()) if (k.startsWith(r.id + ":")) return true;
        }
        return false;
    }

    async function foto(jpeg, ahora) {
        const clave = `eventos/${ahora.toISOString().slice(0, 10)}/${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}.jpg`;
        try { await subir(clave, jpeg); return clave; } catch (e) { log("reglas: no se pudo guardar la foto:", e.message); return null; }
    }

    async function avisar(r, tipoEvento, motivo, eventoId, fotoClave, cam) {
        if (!r.avisar) return null;
        try {
            const aviso = await prisma.avisoGuardia.create({ data: { tipo: TIPO_AVISO[tipoEvento], motivo, camara: cam.name, datos: { reglaId: r.id, regla: r.nombre, eventoId, foto: fotoClave } } });
            await prisma.eventoVision.update({ where: { id: eventoId }, data: { avisoId: aviso.id } }).catch(() => null);
            emitir("aviso_guardia", { accion: "nuevo", aviso });
            contadores.avisos++;
            return aviso;
        } catch (e) { contadores.errores++; contadores.ultimoError = `aviso: ${e.message}`; return null; }
    }

    async function evento(datos) {
        return prisma.eventoVision.create({ data: datos });
    }

    /** Lo que vio omni-vision en un cuadro de esa cámara. `objetos` con pista y caja_norm. */
    async function procesar(cam, objetos, jpeg, ahora) {
        const mias = reglas.filter((r) => r.deviceId === cam.id && prendida(r));
        const t = ahora.getTime();
        const conPista = objetos.filter((o) => o.pista != null && Array.isArray(o.caja_norm));
        if (mias.length) {
            for (const r of mias) {
                try {
                    const valen = conPista.filter((o) => r.clases.includes(o.clase));
                    if (r.tipo === "conteo" || r.tipo === "sentido" || r.tipo === "cruce") await lineas(r, cam, valen, jpeg, ahora, t);
                    else if (r.tipo === "intrusion") await intrusion(r, cam, valen, jpeg, ahora, t);
                    else if (r.tipo === "permanencia") await permanencia(r, cam, valen, jpeg, ahora, t);
                    else if (r.tipo === "aglomeracion") await aglomeracion(r, cam, valen, jpeg, ahora, t);
                } catch (e) { contadores.errores++; contadores.ultimoError = `${r.nombre}: ${e.message}`; }
            }
        }
        // El pie de cada pista, para el próximo cuadro (aunque hoy no haya reglas: si se crea una, ya tiene de dónde partir).
        for (const o of conPista) {
            const k = `${cam.id}:${o.pista}`, ant = pies.get(k), p = pie(o);
            // `mov`: la última vez que el pie se corrió más de MOVIMIENTO_MIN desde donde estaba.
            const se_movio = !ant || Math.hypot(p[0] - ant.ref[0], p[1] - ant.ref[1]) > MOVIMIENTO_MIN;
            pies.set(k, { p, t, ref: se_movio ? p : ant.ref, mov: se_movio ? t : ant.mov });
        }
        // Olvido de lo viejo.
        for (const [k, v] of pies) if (t - v.t > OLVIDO_MS * 3) pies.delete(k);
        for (const [k, v] of cruces) if (t - v.t > OLVIDO_MS * 3) cruces.delete(k);
        for (const [k, v] of intrusos) if (v.deviceId === cam.id && t - v.visto > OLVIDO_MS) intrusos.delete(k);
        await cerrarEstadias(cam, t, false);
    }

    async function lineas(r, cam, valen, jpeg, ahora, t) {
        for (const o of valen) {
            const antes = pies.get(`${cam.id}:${o.pista}`);
            if (!antes || t - antes.t > OLVIDO_MS) continue;
            const ahoraP = pie(o);
            if (!corta(antes.p, ahoraP, r.linea.a, r.linea.b)) continue;
            const sentido = lado(r.linea, ahoraP) > 0 ? "ab" : "ba";
            const k = `${r.id}:${cam.id}:${o.pista}`;
            const previo = cruces.get(k);
            if (previo && previo.sentido === sentido && t - previo.t < REBOTE_MS * 6) continue; // el mismo cruce visto dos veces
            if (previo && t - previo.t < REBOTE_MS) { cruces.set(k, { t, sentido }); continue; } // tiembla sobre la línea
            cruces.set(k, { t, sentido });
            if (r.tipo === "conteo") {
                await evento({ tipo: "CRUCE", reglaId: r.id, deviceId: cam.id, camara: cam.name, clase: o.clase, pista: o.pista, sentido, ts: ahora });
                contadores.cruces++;
            } else if (r.tipo === "cruce") {
                // Fuera de horario, o en el sentido que no interesa: no pasó nada para esta regla.
                if ((r.sentidos && r.sentidos !== "ambos" && sentido !== r.sentidos) || !enHorario(r.horario, ahora)) continue;
                const f = await foto(jpeg, ahora);
                const ev = await evento({ tipo: "CRUCE_LINEA", reglaId: r.id, deviceId: cam.id, camara: cam.name, clase: o.clase, pista: o.pista, sentido, foto: f, caja: o.caja_norm, ts: ahora });
                contadores.crucesPropios++;
                if (t - (ultimoAvisoCruce.get(r.id) || 0) > ENFRIO_CRUCE_MS) {
                    ultimoAvisoCruce.set(r.id, t);
                    await avisar(r, "CRUCE_LINEA", `${NOMBRE_CLASE[o.clase] || o.clase} cruzó ${r.nombre}`, ev.id, f, cam);
                }
            } else if (sentido !== r.permitido) {
                const f = await foto(jpeg, ahora);
                const ev = await evento({ tipo: "SENTIDO_CONTRARIO", reglaId: r.id, deviceId: cam.id, camara: cam.name, clase: o.clase, pista: o.pista, sentido, foto: f, caja: o.caja_norm, ts: ahora });
                contadores.sentido++;
                if (t - (ultimoAvisoSentido.get(r.id) || 0) > ENFRIO_SENTIDO_MS) {
                    ultimoAvisoSentido.set(r.id, t);
                    await avisar(r, "SENTIDO_CONTRARIO", `${NOMBRE_CLASE[o.clase] || o.clase} en sentido contrario · ${r.nombre}`, ev.id, f, cam);
                }
            }
        }
    }

    async function permanencia(r, cam, valen, jpeg, ahora, t) {
        for (const o of valen) {
            const k = `${r.id}:${o.pista}`;
            const dentro = adentro(pie(o), r.zona);
            let e = estadias.get(k);
            if (!dentro) { if (e) { e.visto = t; e.fuera = true; } continue; }
            if (!e) { e = { desde: t, visto: t, eventoId: null, clase: o.clase, deviceId: cam.id, fuera: false }; estadias.set(k, e); }
            e.visto = t; e.fuera = false;
            const seg = (t - e.desde) / 1000;
            if (!e.eventoId && seg >= r.segundos) {
                const f = await foto(jpeg, ahora);
                const ev = await evento({ tipo: "PERMANENCIA", reglaId: r.id, deviceId: cam.id, camara: cam.name, clase: o.clase, pista: o.pista, valor: Math.round(seg), foto: f, caja: o.caja_norm, ts: new Date(e.desde) });
                e.eventoId = ev.id;
                contadores.permanencia++;
                const min = Math.round(seg / 60);
                await avisar(r, "PERMANENCIA", `${NOMBRE_CLASE[o.clase] || o.clase} hace ${min >= 1 ? `${min} min` : `${Math.round(seg)} s`} en ${r.nombre}`, ev.id, f, cam);
            }
        }
    }

    /** Intrusión: un objeto con el pie adentro de la zona `segundos` seguidos, en horario. Una vez por pista. */
    async function intrusion(r, cam, valen, jpeg, ahora, t) {
        const armada = enHorario(r.horario, ahora);
        for (const o of valen) {
            const k = `${r.id}:${o.pista}`;
            if (!armada || !adentro(pie(o), r.zona)) { intrusos.delete(k); continue; }
            let e = intrusos.get(k);
            if (!e) { e = { desde: t, visto: t, avisado: false, deviceId: cam.id }; intrusos.set(k, e); }
            e.visto = t;
            if (e.avisado || (t - e.desde) / 1000 < (r.segundos ?? 2)) continue;
            e.avisado = true;
            const f = await foto(jpeg, ahora);
            const ev = await evento({ tipo: "INTRUSION", reglaId: r.id, deviceId: cam.id, camara: cam.name, clase: o.clase, pista: o.pista, valor: Math.round((t - e.desde) / 1000), foto: f, caja: o.caja_norm, ts: new Date(e.desde) });
            contadores.intrusiones++;
            if (t - (ultimoAvisoIntrusion.get(r.id) || 0) > ENFRIO_INTRUSION_MS) {
                ultimoAvisoIntrusion.set(r.id, t);
                await avisar(r, "INTRUSION", `${NOMBRE_CLASE[o.clase] || o.clase} en ${r.nombre}`, ev.id, f, cam);
            }
        }
    }

    /** Las estadías que terminaron (salió de la zona o dejó de verse): se guarda cuánto duraron. */
    async function cerrarEstadias(cam, t, todas) {
        for (const [k, e] of estadias) {
            if (cam && e.deviceId !== cam.id && !todas) continue;
            const termino = todas || e.fuera || t - e.visto > OLVIDO_MS;
            if (!termino) continue;
            estadias.delete(k);
            if (e.eventoId) await prisma.eventoVision.update({ where: { id: e.eventoId }, data: { valor: Math.round((e.visto - e.desde) / 1000) } }).catch(() => null);
        }
    }

    async function aglomeracion(r, cam, valen, jpeg, ahora, t) {
        const dentro = valen.filter((o) => !r.zona || adentro(pie(o), r.zona));
        const g = grupos.get(r.id) || { desde: null, ultimoAviso: 0, max: 0 };
        if (dentro.length < r.maximo) { g.desde = null; g.max = 0; grupos.set(r.id, g); return; }
        if (!g.desde) g.desde = t;
        g.max = Math.max(g.max, dentro.length);
        grupos.set(r.id, g);
        if ((t - g.desde) / 1000 < r.segundos || t - g.ultimoAviso < ENFRIO_AGLOMERACION_MS) return;
        g.ultimoAviso = t;
        const f = await foto(jpeg, ahora);
        const ev = await evento({ tipo: "AGLOMERACION", reglaId: r.id, deviceId: cam.id, camara: cam.name, clase: "person", valor: dentro.length, foto: f, ts: ahora });
        contadores.aglomeracion++;
        await avisar(r, "AGLOMERACION", `${dentro.length} personas juntas en ${r.nombre}`, ev.id, f, cam);
    }

    return { cargar, camaras, camarasRapidas, enCurso, procesar, contadores, cerrarTodo: () => cerrarEstadias(null, Date.now(), true) };
}

module.exports = { iniciar };
