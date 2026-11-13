"use server";

import { prisma } from "@/lib/prisma";
import { comoAbre, type ComoAbre, type Puerta } from "@/lib/aperturas";
import { soporteDe, QUE_ES, type Capacidad } from "@/lib/drivers/catalogo";

/*
 * La ficha de un portero (13/11, Nico: «no tiene drawer, llama al modal viejo; debe ser el drawer
 * típico pero adaptado a porteros… explorá las aperturas»). Un portero se mira distinto que una
 * cámara: lo que importa es qué puertas maneja, si se le puede pedir que abra una y qué contestó
 * la última vez. El formulario viejo de cuatro fases («Sincronizar nodo») no mostraba nada de eso.
 */

async function sesionCon(permiso: string) {
    const { getSession } = await import("@/app/actions/auth");
    const { permisosDeSesion } = await import("@/lib/permisos");
    const s: any = await getSession().catch(() => null);
    if (!s || !permisosDeSesion(s).includes(permiso)) throw new Error("Tu rol no puede hacer esto con los dispositivos.");
    return s;
}

const leerSetting = async (k: string) => (await prisma.setting.findUnique({ where: { key: k } }).catch(() => null))?.value ?? null;
const lista = (v: string | null): string[] => { try { const x = JSON.parse(v || "[]"); return Array.isArray(x) ? x.map(String) : []; } catch { return []; } };
async function escribirSetting(key: string, value: string) { await prisma.setting.upsert({ where: { key }, update: { value }, create: { key, value } }); }

/** La acción con la que queda en Auditoría cada apertura pedida desde la ficha. */
const ACCION_ABRIR = "portero.abrir";
/** Cuántas aperturas pasadas se muestran en la ficha. */
const APERTURAS_EN_FICHA = 6;
/** Sin noticias del equipo por más de esto, la ficha no dice «en línea». */
const EN_LINEA_MAX_MS = 10 * 60_000;

export type AperturaPasada = { cuando: string; quien: string; ok: boolean; detalle: string | null };

/** Qué hace OmniVision con la cámara de este portero. */
export type VisionPortero = {
    /** OmniVision la mira (detecciones, reglas). `todas`: no hay lista de cámaras elegidas, mira todos los equipos. */
    enOmniVision: boolean; todas: boolean;
    /** Se le miran las caras (modo face), y si el modo face está prendido en el sistema. */
    miraCaras: boolean; moduloFace: boolean;
    /** Lo que dejó en los últimos 7 días: pasadas con cara, personas distintas y la última. */
    caras7d: number; personas7d: number; ultimaCara: string | null;
    /** Nuestro lector (omni-lpr) lee matrículas en su video; si el lector está prendido en el sistema; y lo que leyó en 7 días. */
    leeMatriculas: boolean; lectorPrendido: boolean; lecturas7d: number;
};

/** Una cara encontrada al comparar un cuadro del portero, y a quién se parece. */
export type CaraComparada = {
    /** Dónde está, en fracciones del cuadro. */
    caja: [number, number, number, number]; px: number; prob: number;
    /** padron | misma | nueva | sin-cara, con las mismas reglas que usa el proceso de visión (lib-rostros.js). */
    que: string; motivo: string | null;
    /** A quién se parece más, y cuánto. Null si el motor no conoce a nadie. */
    parecido: { nombre: string; rostroId: string | null; foto: string | null; similitud: number; veces: number | null } | null;
};
export type ComparacionPortero = { ok: boolean; error: string | null; foto: string | null; caras: CaraComparada[]; ms: number };

export type FichaPortero = {
    id: string; name: string; ip: string; httpPort: number | null; location: string | null; username: string | null; authType: string;
    deviceModel: string | null; brand: string; deviceType: string; direction: string; mac: string | null;
    /** Última vez que el equipo contestó o avisó algo. */
    ultimaVez: string | null; enLinea: boolean;
    como: ComoAbre;
    /** Lo que se le leyó al equipo sobre sus puertas (o la lista asumida, con `leidas: false`). */
    puertas: Puerta[]; puertasLeidas: boolean; puertasError: string | null;
    /** Este servidor no puede abrirle nada a ese equipo (OMNI_EQUIPOS_SOLO_LECTURA). */
    soloLectura: boolean;
    /** Lo que OmniAccess hace de verdad con esta marca (drivers/catalogo). */
    hace: { clave: Capacidad; que: string }[]; notaMarca: string | null;
    aperturas: AperturaPasada[];
    /** Los grupos de acceso que incluyen a este portero. */
    grupos: string[];
    vision: VisionPortero;
};

export async function fichaPortero(id: string): Promise<FichaPortero> {
    await sesionCon("dispositivos");
    const d = await prisma.device.findUnique({ where: { id }, include: { accessGroups: { select: { name: true } } } });
    if (!d) throw new Error("No existe ese equipo.");
    const { leerPuertas } = await import("@/lib/aperturas-servidor");
    const { esSoloLectura } = await import("@/lib/solo-lectura");
    const hace7 = new Date(Date.now() - 7 * 86_400_000);
    const [lectura, pasadas, vCams, fCams, mFace, caras7d, personas, ultima, lector, lecturas7d] = await Promise.all([
        leerPuertas(d),
        prisma.accionSistema.findMany({ where: { accion: ACCION_ABRIR, objetivo: d.id }, orderBy: { cuando: "desc" }, take: APERTURAS_EN_FICHA }).catch(() => []),
        leerSetting("VISION_CAMARAS"), leerSetting("FACE_CAMARAS"), leerSetting("MODULE_FACE"),
        prisma.accessEvent.count({ where: { deviceId: d.id, accessType: "FACE", timestamp: { gte: hace7 } } }).catch(() => 0),
        prisma.rostroPasada.findMany({ where: { deviceId: d.id, cuando: { gte: hace7 } }, distinct: ["rostroId"], select: { rostroId: true } }).catch(() => []),
        prisma.accessEvent.findFirst({ where: { deviceId: d.id, accessType: "FACE" }, orderBy: { timestamp: "desc" }, select: { timestamp: true } }).catch(() => null),
        leerSetting("OMNI_LPR_ENABLED"),
        prisma.plateSighting.count({ where: { deviceId: d.id, timestamp: { gte: hace7 } } }).catch(() => 0),
    ]);
    const elegidas = lista(vCams);
    // Si el equipo contestó recién, está en línea aunque el latido de fondo todavía no haya pasado.
    const visto = Math.max(d.lastOnlinePull?.getTime() || 0, d.lastOnlinePush?.getTime() || 0, lectura.leidas ? Date.now() : 0);
    const soporte = soporteDe(String(d.brand));
    return {
        id: d.id, name: d.name, ip: d.ip, httpPort: d.httpPort, location: d.location, username: d.username, authType: String(d.authType),
        deviceModel: d.deviceModel, brand: String(d.brand), deviceType: String(d.deviceType), direction: String(d.direction), mac: d.mac,
        ultimaVez: visto ? new Date(visto).toISOString() : null, enLinea: !!visto && Date.now() - visto < EN_LINEA_MAX_MS,
        como: comoAbre(String(d.brand)),
        puertas: lectura.puertas, puertasLeidas: lectura.leidas, puertasError: lectura.error || null,
        soloLectura: esSoloLectura(d.ip || ""),
        hace: (soporte?.hace || []).map((c) => ({ clave: c, que: QUE_ES[c] })), notaMarca: soporte?.nota || null,
        aperturas: pasadas.map((a) => ({ cuando: a.cuando.toISOString(), quien: a.quien, ok: a.ok, detalle: a.detalle })),
        grupos: d.accessGroups.map((g) => g.name),
        vision: {
            // Sin lista elegida, OmniVision mira todos los equipos (así lo lee vision-worker).
            todas: elegidas.length === 0, enOmniVision: elegidas.length === 0 || elegidas.includes(d.id),
            miraCaras: lista(fCams).includes(d.id), moduloFace: mFace === "true",
            caras7d, personas7d: personas.length, ultimaCara: ultima?.timestamp.toISOString() || null,
            leeMatriculas: d.trackEnabled && !!d.rtspUrl, lectorPrendido: lector === "true", lecturas7d,
        },
    };
}

/**
 * A qué analíticas va el video del portero (13/11, Nico: «en el drawer del portero debo permitir
 * enviar el video a las analíticas de OmniVision, LPR, Face»):
 *
 *  · OmniVision y Face son las mismas dos listas que se manejan desde OmniVision y desde Ajustes
 *    (VISION_CAMARAS y FACE_CAMARAS).
 *  · LPR: nuestro lector (omni-lpr) toma cuadros del portero como de una LPR interior. La pasarela
 *    (tracking-worker) lee de `rtspUrl`; acá se le da el reenvío de go2rtc del stream principal, así
 *    no se abre otra conexión al equipo ni se copia su clave. Se dispara cuando OmniVision ve un
 *    vehículo (y por cambio de escena si OmniVision no la mira).
 */
export async function ajustesVisionPortero(id: string, a: { enOmniVision: boolean; miraCaras: boolean; leeMatriculas?: boolean }): Promise<{ ok: true }> {
    const s = await sesionCon("dispositivos.editar");
    const d = await prisma.device.findUnique({ where: { id }, select: { id: true, name: true, rtspUrl: true, trackTrigger: true } });
    if (!d) throw new Error("No existe ese equipo.");
    const lee = !!a.leeMatriculas;
    const camaras = lista(await leerSetting("VISION_CAMARAS"));
    // Con la lista vacía OmniVision ya mira todo: no se toca (escribir sólo este id dejaría afuera a todas las demás).
    if (camaras.length) {
        const sin = camaras.filter((x) => x !== id);
        await escribirSetting("VISION_CAMARAS", JSON.stringify(a.enOmniVision || a.miraCaras || lee ? [...sin, id] : sin));
    }
    await prisma.device.update({
        where: { id },
        data: lee
            ? { trackEnabled: true, rtspUrl: d.rtspUrl || `${GO2RTC_RTSP}/lpr_${id}_hd`, trackTrigger: "omnivision" }
            : { trackEnabled: false },
    });
    const caras = lista(await leerSetting("FACE_CAMARAS")).filter((x) => x !== id);
    await escribirSetting("FACE_CAMARAS", JSON.stringify(a.miraCaras ? [...caras, id] : caras));
    await prisma.accionSistema.create({ data: { quien: String(s?.name || s?.sub || "panel"), accion: "portero.vision", objetivo: d.id, ok: true, detalle: `${d.name} · OmniVision ${a.enOmniVision || a.miraCaras || lee ? "sí" : "no"} · rostros ${a.miraCaras ? "sí" : "no"} · matrículas ${lee ? "sí" : "no"}` } }).catch(() => { });
    return { ok: true };
}

/** El reenvío RTSP de go2rtc (el mismo que usa el vivo de las siluetas): de ahí lee la pasarela de matrículas. */
const GO2RTC_RTSP = process.env.GO2RTC_RTSP || "rtsp://127.0.0.1:8554";

/** Cuántas caras se informan, como mucho, de un cuadro. */
const CARAS_MAXIMO = 6;
/** Ancho de la foto que vuelve a la ficha con el resultado. */
const ANCHO_COMPARACION = 960;

/**
 * Comparar ahora: toma un cuadro del portero y le pregunta al motor de rostros quién está. No
 * guarda nada ni funda identidades (eso lo hace el proceso de visión cuando alguien pasa): es para
 * probar el encuadre y ver qué reconocería, con las mismas reglas.
 */
export async function compararCaraPortero(id: string): Promise<ComparacionPortero> {
    await sesionCon("dispositivos");
    const t0 = Date.now();
    const fin = (error: string): ComparacionPortero => ({ ok: false, error, foto: null, caras: [], ms: Date.now() - t0 });
    const { cuadroDeCamara } = await import("@/lib/detector-propio-servidor");
    const c = await cuadroDeCamara(id);
    if ("error" in c) return fin(c.error === "go2rtc no entregó un cuadro de esa cámara" ? "No llegó video del portero: sin cuadro no hay cara que comparar." : c.error);
    const { getCompreFace } = await import("@/lib/compareface");
    const { url, recoKey } = await getCompreFace();
    if (!recoKey) return fin("El motor de rostros no está configurado (Ajustes › Modos › Motor de rostros).");
    let j: any;
    try {
        const fd = new FormData(); fd.append("file", new Blob([new Uint8Array(c.bytes)]), "f.jpg");
        const r = await fetch(`${url}/api/v1/recognition/recognize?det_prob_threshold=0.7&prediction_count=3&limit=${CARAS_MAXIMO}`, { method: "POST", headers: { "x-api-key": recoKey }, body: fd, signal: AbortSignal.timeout(15_000) });
        j = await r.json().catch(() => ({}));
        // El motor contesta 400 «No face is found» cuando no hay nadie: no es un fallo.
        if (!r.ok && !/no face/i.test(String(j?.message || ""))) return fin(`El motor de rostros respondió ${r.status}.`);
    } catch (e: any) { return fin(/timeout|aborted/i.test(e?.message || "") ? "El motor de rostros no contestó a tiempo." : "No se pudo hablar con el motor de rostros."); }

    const sharp = (await import("sharp")).default;
    const meta = await sharp(c.bytes).metadata();
    const W = meta.width || 1, H = meta.height || 1;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const R = require("../../../lib-rostros.js");
    const u = R.umbrales({ misma: await leerSetting("FACE_UMBRAL_MISMA"), parecida: await leerSetting("FACE_UMBRAL_PARECIDA"), padron: await leerSetting("FACE_UMBRAL"), pxMin: await leerSetting("FACE_CARA_PX_MIN") });
    const crudas: any[] = (j?.result || []).filter((x: any) => x?.box).sort((a: any, b: any) => (b.box.y_max - b.box.y_min) - (a.box.y_max - a.box.y_min)).slice(0, CARAS_MAXIMO);
    const f3 = (v: number) => Math.max(0, Math.min(1, Math.round(v * 1000) / 1000));
    const caras: CaraComparada[] = [];
    for (const x of crudas) {
        const px = Math.round(x.box.y_max - x.box.y_min), prob = Number(x.box.probability) || 0;
        const vecinos = (x.subjects || []).map((v: any) => ({ sujeto: String(v.subject), similitud: Number(v.similarity) || 0 }));
        const d = R.decidir({ px, prob }, vecinos, u);
        let parecido: CaraComparada["parecido"] = null;
        if (vecinos[0]) {
            const rostro = await prisma.rostro.findUnique({ where: { sujeto: vecinos[0].sujeto }, select: { id: true, numero: true, apodo: true, foto: true, veces: true, userId: true } }).catch(() => null);
            const persona = rostro?.userId ? await prisma.user.findUnique({ where: { id: rostro.userId }, select: { name: true } }).catch(() => null) : null;
            parecido = {
                nombre: persona?.name || rostro?.apodo || (rostro ? R.codigo(rostro.numero) : vecinos[0].sujeto), rostroId: rostro?.id || null,
                foto: rostro?.foto ? `/api/vision/imagen/${rostro.foto}` : null, similitud: vecinos[0].similitud, veces: rostro?.veces ?? null,
            };
        }
        caras.push({ caja: [f3(x.box.x_min / W), f3(x.box.y_min / H), f3(x.box.x_max / W), f3(x.box.y_max / H)], px, prob, que: d.que, motivo: d.motivo || null, parecido });
    }
    const chica = await sharp(c.bytes).resize({ width: ANCHO_COMPARACION, withoutEnlargement: true }).jpeg({ quality: 72 }).toBuffer();
    return { ok: true, error: null, foto: `data:image/jpeg;base64,${chica.toString("base64")}`, caras, ms: Date.now() - t0 };
}

/**
 * Pide abrir una puerta del portero. Queda en Auditoría quién la pidió y qué contestó el equipo,
 * haya abierto o no: una puerta es una acción física y tiene que poder reconstruirse.
 */
export async function abrirPuertaPortero(id: string, puerta: number, nombrePuerta?: string): Promise<{ ok: boolean; mensaje: string }> {
    const { getSession } = await import("@/app/actions/auth");
    const s: any = await getSession().catch(() => null);
    const d = await prisma.device.findUnique({ where: { id } });
    if (!d) return { ok: false, mensaje: "No existe ese equipo." };
    const { abrirPuerta } = await import("@/lib/aperturas-servidor");
    const r = await abrirPuerta(d, Number(puerta));
    const cual = (nombrePuerta || `Puerta ${puerta}`).slice(0, 60);
    await prisma.accionSistema.create({
        data: { quien: String(s?.name || s?.sub || "panel"), accion: ACCION_ABRIR, objetivo: d.id, ok: r.ok, detalle: `${d.name} · ${cual}${r.ok ? "" : ` · ${r.error || "no abrió"}`}`.slice(0, 500) },
    }).catch(() => { });
    return r.ok ? { ok: true, mensaje: `${d.name} aceptó abrir ${cual}.` } : { ok: false, mensaje: r.error || "El equipo no abrió." };
}

/**
 * Antes de dar de alta: ¿contesta el equipo con esos datos, y qué puertas declara? No guarda nada
 * ni cambia nada en el equipo. La clave viaja sólo en este pedido.
 */
export async function probarPortero(datos: { ip: string; httpPort?: number | null; brand: string; username?: string; password?: string; authType?: string; id?: string }): Promise<{ ok: boolean; puertas: Puerta[]; leidas: boolean; error: string | null }> {
    await sesionCon("dispositivos.editar");
    const { leerPuertas } = await import("@/lib/aperturas-servidor");
    // Editando, la clave vacía es «la guardada»: se toma de la base, no vuelve al navegador.
    const guardado = datos.id ? await prisma.device.findUnique({ where: { id: datos.id }, select: { password: true, username: true } }) : null;
    const d: any = {
        ip: String(datos.ip || "").trim(), httpPort: datos.httpPort || null, brand: datos.brand,
        username: datos.username || guardado?.username || "admin", password: datos.password || guardado?.password || "", authType: datos.authType || "DIGEST",
    };
    if (!comoAbre(d.brand).puede) return { ok: false, puertas: [], leidas: false, error: comoAbre(d.brand).nota };
    const l = await leerPuertas(d);
    // Akuvox no informa sus relés: no hay forma de saber desde acá si contestó. Se dice así.
    if (String(d.brand).toUpperCase() === "AKUVOX") return { ok: true, puertas: l.puertas, leidas: false, error: null };
    return { ok: l.leidas, puertas: l.puertas, leidas: l.leidas, error: l.error || null };
}
