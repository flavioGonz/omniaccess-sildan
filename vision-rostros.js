/**
 * Identidad por rostro: la parte que habla con el motor (CompreFace), el bucket y la base. Lo que
 * decide —si una cara alcanza para comparar, a quién pertenece, si es otra visita— está en
 * lib-rostros.js, sin red, con los números medidos que lo justifican.
 *
 * Reemplaza a `reconocerRostro` de vision-worker.js, que hacía una sola pregunta («¿está en el
 * padrón?») sobre el cuadro chico. Tres cambios:
 *
 *   1. Mira el cuadro del stream principal, recortado a la persona de ESA pista. Medido el 13/11:
 *      en el cuadro de 640×360 la cara mide 14 a 20 px en dos de cada tres pasadas y el motor no
 *      puede comparar ninguna. Y al mirar el cuadro entero se quedaba con la primera cara que
 *      aparecía, fuera o no la de la pista que se estaba cerrando.
 *   2. Si la cara no es de nadie conocido y alcanza para comparar, funda una identidad (Rostro):
 *      guarda la cara, le da un número y la enrola en el motor para reconocerla la próxima vez.
 *   3. Cada pasada queda escrita con su similitud y el tamaño de la cara: es el dato con el que
 *      se van a volver a medir los umbrales.
 *
 * Un fallo acá nunca frena el cierre de la pista ni el camino de matrículas: `reconocer` se
 * dispara sin await y atrapa todo.
 */
const crypto = require("crypto");
const R = require("./lib-rostros");

/** Cada cuánto, como mucho, se le pide a go2rtc un cuadro del stream principal para una misma pista. */
const HD_CADA_MS = 3000;
/** Cuánto se agranda la caja de la persona al recortarla: la cabeza suele quedar al borde, y el cuadro principal llega un instante después. */
const MARGEN_PERSONA = 0.35;
/** Cuánto aire se deja alrededor de la cara en el recorte que se guarda y se enrola. */
const MARGEN_CARA = 0.3;
/** Lado máximo del recorte de cara que se guarda para mostrar. */
const LADO_CARA = 320;
/** Dos pistas de la misma persona en la misma cámara dentro de esto son el mismo momento: una sola pasada. */
const MISMA_PASADA_MS = 30_000;
const MOTOR_MS = 12_000;
const LOTE = 200;

function crear({ prisma, log, bajar, subir, borrar, emitir, sharp, go2rtc }) {
    const contadores = { miradas: 0, sinRostro: 0, sinCalidad: 0, nuevas: 0, sumadas: 0, padron: 0, conHd: 0, errores: 0, ultimoError: null };
    const falla = (e) => { contadores.errores++; contadores.ultimoError = String(e?.message || e).slice(0, 200); };

    /** ¿Esta pista es de una persona en una cámara donde se miran caras? */
    const aplica = (p, ajustes) => p.grupo === "persona" && ajustes.moduloFace && ajustes.faceCamaras.has(p.deviceId);

    /**
     * Guarda en la pista un cuadro del stream principal, mientras la persona está a la vista. Se
     * llama cuando la pista consigue una foto mejor (igual que el cuadro para leer el rotulado de
     * un vehículo). Sin cuadro principal se sigue con el chico: no es un error.
     */
    async function cuadroPrincipal(cam, p, o, ajustes) {
        if (!aplica(p, ajustes) || Date.now() - (p.hdCaraT || 0) < HD_CADA_MS) return;
        p.hdCaraT = Date.now();
        try {
            const r = await fetch(`${go2rtc}/api/frame.jpeg?src=${encodeURIComponent(`lpr_${cam.id}_hd`)}`, { signal: AbortSignal.timeout(6000) });
            if (!r.ok) return;
            const b = Buffer.from(await r.arrayBuffer());
            if (b.length > 1000) p.hdCara = { jpeg: b, caja: o.caja_norm };
        } catch { /* la cámara no entregó el principal a tiempo */ }
    }

    /** El recorte de la persona, con margen, sin achicar: el alto de la cara se mide en estos px. */
    async function recortePersona(jpeg, caja) {
        const meta = await sharp(jpeg).metadata();
        const W = meta.width || 0, H = meta.height || 0;
        if (!W || !H || !Array.isArray(caja)) return jpeg;
        const [x1, y1, x2, y2] = caja;
        const mw = (x2 - x1) * MARGEN_PERSONA, mh = (y2 - y1) * MARGEN_PERSONA;
        const left = Math.max(0, Math.floor((x1 - mw) * W)), top = Math.max(0, Math.floor((y1 - mh) * H));
        const width = Math.max(1, Math.min(W - left, Math.ceil((x2 - x1 + 2 * mw) * W)));
        // Hacia abajo no hace falta margen: la cara está arriba.
        const height = Math.max(1, Math.min(H - top, Math.ceil((y2 - y1 + mh) * H)));
        return sharp(jpeg).extract({ left, top, width, height }).jpeg({ quality: 92 }).toBuffer();
    }

    async function motor(ajustes, ruta, { metodo = "POST", jpeg } = {}) {
        const op = { method: metodo, headers: { "x-api-key": ajustes.faceKey }, signal: AbortSignal.timeout(MOTOR_MS) };
        if (jpeg) { const fd = new FormData(); fd.append("file", new Blob([jpeg]), "f.jpg"); op.body = fd; }
        const r = await fetch(`${ajustes.faceUrl}${ruta}`, op);
        return { ok: r.ok, estado: r.status, j: await r.json().catch(() => ({})) };
    }

    /** La cara más grande que el motor ve en la imagen, con a quién se parece. */
    async function mirar(ajustes, jpeg) {
        const r = await motor(ajustes, "/api/v1/recognition/recognize?det_prob_threshold=0.7&prediction_count=3", { jpeg });
        const caras = (r.j.result || []).filter((c) => c.box).sort((a, b) => (b.box.y_max - b.box.y_min) - (a.box.y_max - a.box.y_min));
        const c = caras[0];
        if (!c) return null;
        return {
            caja: c.box, px: Math.round(c.box.y_max - c.box.y_min), prob: Number(c.box.probability) || 0,
            vecinos: (c.subjects || []).map((s) => ({ sujeto: s.subject, similitud: Number(s.similarity) || 0 })),
        };
    }

    /** El recorte de la cara con aire: `nativa` para el motor (sin achicar), `chica` para mostrar. */
    async function recortesCara(jpeg, caja) {
        const meta = await sharp(jpeg).metadata();
        const W = meta.width || 0, H = meta.height || 0;
        const bw = caja.x_max - caja.x_min, bh = caja.y_max - caja.y_min;
        const left = Math.max(0, Math.floor(caja.x_min - bw * MARGEN_CARA)), top = Math.max(0, Math.floor(caja.y_min - bh * MARGEN_CARA));
        const width = Math.max(1, Math.min(W - left, Math.ceil(bw * (1 + 2 * MARGEN_CARA))));
        const height = Math.max(1, Math.min(H - top, Math.ceil(bh * (1 + 2 * MARGEN_CARA))));
        const nativa = await sharp(jpeg).extract({ left, top, width, height }).jpeg({ quality: 92 }).toBuffer();
        const chica = await sharp(nativa).resize(LADO_CARA, LADO_CARA, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 88 }).toBuffer();
        return { nativa, chica };
    }

    const enrolar = (ajustes, sujeto, jpeg) => motor(ajustes, `/api/v1/recognition/faces?subject=${encodeURIComponent(sujeto)}&det_prob_threshold=0.5`, { jpeg });
    const olvidarSujeto = (ajustes, sujeto) => motor(ajustes, `/api/v1/recognition/subjects/${encodeURIComponent(sujeto)}`, { metodo: "DELETE" }).catch(() => null);
    const claveFoto = (id) => `rostros/${id}.jpg`;

    /** Suma una vez más a una identidad que ya existía. */
    async function sumar(ajustes, rostro, cara, recortes, cuando, camara) {
        const datos = { ultimaCamara: camara };
        if (cuando > rostro.ultimaVez) datos.ultimaVez = cuando;
        if (R.esOtraVisita(rostro.ultimaVez, cuando)) datos.veces = { increment: 1 };
        if (!rostro.foto || R.esMejorFoto(cara.px, rostro.calidad)) {
            await subir(claveFoto(rostro.id), recortes.chica);
            datos.foto = claveFoto(rostro.id); datos.calidad = cara.px;
        }
        // Otro ángulo de la misma cara ayuda al motor; la misma foto otra vez, no.
        if (cara.similitud != null && R.sumaEjemplo(rostro.ejemplos, cara.similitud) && R.idDeSujeto(rostro.sujeto)) {
            const r = await enrolar(ajustes, rostro.sujeto, recortes.nativa).catch(() => null);
            if (r?.ok) datos.ejemplos = { increment: 1 };
        }
        return prisma.rostro.update({ where: { id: rostro.id }, data: datos });
    }

    /** Funda una identidad con esta cara. Devuelve null si el motor no la toma como cara. */
    async function fundar(ajustes, cara, recortes, cuando, camara, d) {
        const id = "r" + crypto.randomBytes(12).toString("hex");
        const sujeto = R.sujetoDe(id);
        const r = await enrolar(ajustes, sujeto, recortes.nativa);
        if (!r.ok) return null;
        await subir(claveFoto(id), recortes.chica);
        // La sugerencia de unir apunta a un Rostro: si el parecido era con alguien del padrón, al suyo.
        let parecidaA = null;
        if (d.parecidaA) parecidaA = R.idDeSujeto(d.parecidaA) || (await prisma.rostro.findUnique({ where: { sujeto: d.parecidaA }, select: { id: true } }).catch(() => null))?.id || null;
        try {
            return await prisma.rostro.create({
                data: { id, sujeto, foto: claveFoto(id), calidad: cara.px, primeraVez: cuando, ultimaVez: cuando, ultimaCamara: camara, parecidaA, parecido: parecidaA ? d.parecido : null },
            });
        } catch (e) {
            // Sin la fila, el sujeto quedaría en el motor reconociendo a alguien que la base no conoce.
            await olvidarSujeto(ajustes, sujeto);
            throw e;
        }
    }

    /**
     * Al cerrar la pista de una persona en una cámara facial: mirar su cara, decidir de quién es,
     * dejar la pasada escrita y el acceso FACE para el monitor.
     */
    async function reconocer(p, ajustes) {
        if (!aplica(p, ajustes)) return;
        const hd = p.hdCara; p.hdCara = null;
        try {
            contadores.miradas++;
            // Primero el cuadro principal; si ahí no hay cara (llegó tarde, la persona ya giró), el chico.
            let jpeg = null, cara = null, conHd = false;
            if (hd) { jpeg = await recortePersona(hd.jpeg, hd.caja); cara = await mirar(ajustes, jpeg); conHd = !!cara; }
            if (!cara) { jpeg = await recortePersona(await bajar(p.foto), p.caja); cara = await mirar(ajustes, jpeg); }
            if (!cara) { contadores.sinRostro++; return; } // sin cara a la vista no es un acceso FACE
            if (conHd) contadores.conHd++;
            const cuando = p.ultimaVez || new Date();
            const recortes = await recortesCara(jpeg, cara.caja);
            const claveCara = p.foto.replace(/-f\.jpg$/, "-cara.jpg");
            await subir(claveCara, recortes.chica);

            const u = R.umbrales({ misma: ajustes.faceMisma, parecida: ajustes.faceParecida, padron: ajustes.faceUmbral, pxMin: ajustes.facePxMin });
            let d = R.decidir(cara, cara.vecinos, u);
            let rostro = null, usuario = null;

            if (d.que === "misma") {
                rostro = await prisma.rostro.findUnique({ where: { id: d.rostroId } });
                // El motor conoce a alguien que la base ya olvidó: se le borra, y esta cara empieza de nuevo.
                if (!rostro) { await olvidarSujeto(ajustes, R.sujetoDe(d.rostroId)); d = { que: "nueva" }; }
                else { rostro = await sumar(ajustes, rostro, { ...cara, similitud: d.similitud }, recortes, cuando, p.camara); contadores.sumadas++; }
            } else if (d.que === "padron") {
                usuario = await prisma.user.findFirst({ where: { name: d.sujeto }, select: { id: true, name: true, cara: true, role: true, unit: true } }).catch(() => null);
                // Alguien del padrón también tiene su Rostro: así sus pasadas se cuentan igual que las de un anónimo.
                const ya = await prisma.rostro.findUnique({ where: { sujeto: d.sujeto } });
                if (ya) rostro = await sumar(ajustes, ya, { ...cara, similitud: d.similitud }, recortes, cuando, p.camara);
                else {
                    const id = "r" + crypto.randomBytes(12).toString("hex");
                    await subir(claveFoto(id), recortes.chica);
                    rostro = await prisma.rostro.create({ data: { id, sujeto: d.sujeto, userId: usuario?.id || null, foto: claveFoto(id), calidad: cara.px, primeraVez: cuando, ultimaVez: cuando, ultimaCamara: p.camara } });
                }
                contadores.padron++;
            }
            if (d.que === "nueva") {
                rostro = await fundar(ajustes, cara, recortes, cuando, p.camara, d);
                if (rostro) contadores.nuevas++; else d = { que: "sin-cara", motivo: "el motor no la tomó como cara" };
            }
            if (d.que === "sin-cara") contadores.sinCalidad++;

            // Registrada a mano después de nacer sola: el acceso sale a nombre de esa persona.
            if (rostro?.userId && !usuario) usuario = await prisma.user.findUnique({ where: { id: rostro.userId }, select: { id: true, name: true, cara: true, role: true, unit: true } }).catch(() => null);

            const nombre = usuario?.name || rostro?.apodo || (rostro ? R.codigo(rostro.numero) : "Desconocido");
            const sim = d.similitud ?? cara.vecinos[0]?.similitud ?? null;
            const meta = await sharp(jpeg).metadata();
            // Claves que parsea el monitor/face: `Rostro`, `Similitud`, `FaceImage`, `Deteccion`, `CaraFrac`; y las nuevas.
            const details = [
                `Rostro: ${nombre}`,
                sim != null ? `Similitud: ${Math.round(sim * 100)}%` : null,
                `FaceImage: /api/vision/imagen/${claveCara}`,
                `Deteccion: ${Math.round(cara.prob * 100)}%`,
                meta.height ? `CaraFrac: ${Math.round(100 * cara.px / meta.height)}` : null,
                `CaraPx: ${cara.px}`,
                rostro ? `RostroId: ${rostro.id}` : null,
                rostro ? `Veces: ${rostro.veces}` : null,
                d.que === "sin-cara" ? `SinIdentidad: ${d.motivo}` : null,
                "Source: OmniVision",
            ].filter(Boolean).join(", ");
            const ev = await prisma.accessEvent.create({
                data: {
                    deviceId: p.deviceId, userId: usuario?.id || null, timestamp: cuando, accessType: "FACE",
                    decision: "GRANT", // es una pasada registrada, no una barrera; el rol decide el resaltado
                    snapshotPath: "/api/vision/imagen/" + p.foto, details,
                },
            });
            if (rostro) {
                const repetida = await prisma.rostroPasada.findFirst({
                    where: { rostroId: rostro.id, deviceId: p.deviceId, cuando: { gte: new Date(cuando.getTime() - MISMA_PASADA_MS), lte: new Date(cuando.getTime() + MISMA_PASADA_MS) } }, select: { id: true },
                });
                if (!repetida) await prisma.rostroPasada.create({
                    data: { rostroId: rostro.id, deviceId: p.deviceId, camara: p.camara, cuando, similitud: d.similitud ?? null, px: cara.px, prob: cara.prob, cara: claveCara, cuadro: p.foto, eventoId: ev.id },
                });
            }
            emitir("access_event", {
                ...ev, device: { id: p.deviceId, name: p.camara },
                user: usuario ? { id: usuario.id, name: usuario.name, cara: usuario.cara, role: usuario.role, unit: usuario.unit } : null,
                direction: ev.direction, watch: usuario?.role === "BLACKLISTED" ? { category: "BLACKLISTED" } : null, guest: null,
            });
        } catch (e) { falla(e); }
    }

    /**
     * La retención. Las fotos de cada pasada viven lo que las detecciones (son personas caminando);
     * una identidad que nadie registró se olvida entera tras FACE_ANONIMOS_DIAS sin verla: del
     * motor, del bucket y de la base.
     */
    async function limpiar(ajustes) {
        const limiteFotos = new Date(Date.now() - ajustes.retencionDias * 86_400_000);
        for (;;) {
            const viejas = await prisma.rostroPasada.findMany({ where: { cuando: { lt: limiteFotos }, OR: [{ cara: { not: null } }, { cuadro: { not: null } }] }, select: { id: true, cara: true }, take: LOTE });
            if (!viejas.length) break;
            // El cuadro lo borra la retención del registro (es la foto de la pista); la cara es de acá.
            await borrar(viejas.map((v) => v.cara)).catch((e) => log("rostros: limpieza de caras:", e.message));
            await prisma.rostroPasada.updateMany({ where: { id: { in: viejas.map((v) => v.id) } }, data: { cara: null, cuadro: null } });
            if (viejas.length < LOTE) break;
        }
        const dias = Math.max(1, Number(ajustes.faceAnonDias) || R.ANONIMOS_DIAS);
        const limite = new Date(Date.now() - dias * 86_400_000);
        for (;;) {
            const viejos = await prisma.rostro.findMany({ where: { userId: null, apodo: null, ultimaVez: { lt: limite } }, select: { id: true, sujeto: true, foto: true }, take: LOTE });
            if (!viejos.length) break;
            for (const r of viejos) if (R.idDeSujeto(r.sujeto)) await olvidarSujeto(ajustes, r.sujeto);
            await borrar(viejos.map((r) => r.foto)).catch((e) => log("rostros: limpieza de fotos:", e.message));
            await prisma.rostro.deleteMany({ where: { id: { in: viejos.map((r) => r.id) } } });
            log(`rostros: ${viejos.length} identidades sin registrar, sin verse en ${dias} días, olvidadas`);
            if (viejos.length < LOTE) break;
        }
    }

    return { contadores, aplica, cuadroPrincipal, reconocer, limpiar };
}

module.exports = { crear, HD_CADA_MS, MISMA_PASADA_MS };
