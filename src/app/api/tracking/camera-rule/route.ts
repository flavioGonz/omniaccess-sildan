import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticatedRequest } from "@/lib/digest-auth";
import { verifyApiAuth, unauthorizedResponse } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

/**
 * La regla de detección de vehículo que corre DENTRO de la cámara.
 *
 * Estas Hikvision con AcuSense distinguen persona de vehículo por su cuenta. Prendiéndoles
 * una regla con objetivo "vehicle" avisan cada vez que pasa un auto, y la pasarela puede
 * quedarse dormida el resto del tiempo en vez de mirar cuadros a ver si cambió algo.
 *
 * Hay dos formas, y no dan lo mismo:
 *
 *  - **zona** (intrusión): avisa mientras haya un vehículo dentro de un área. Sirve cuando
 *    interesa todo un sector, pero un auto estacionado adentro dispara con cada movimiento.
 *  - **línea** (cruce): avisa en el instante en que un vehículo cruza una raya. Para una
 *    calle es mejor: la ráfaga queda centrada en el momento del cruce, y lo que está quieto
 *    dentro del encuadre deja de importar.
 *
 * Las dos no conviven bien —se pisarían disparando dos veces—, así que activar una apaga
 * la otra.
 *
 * Detalles del firmware que costaron y conviene no volver a aprender:
 *  - El XML se ARMA SOBRE EL QUE DEVUELVE LA CÁMARA. Construirlo de cero, aunque tenga
 *    todos los campos del manual, devuelve "Invalid XML Content".
 *  - La zona usa <RegionCoordinatesList>/<RegionCoordinates>; la línea usa
 *    <CoordinatesList>/<Coordinates>. Con el nombre cruzado responde OK y no guarda nada.
 *  - Coordenadas 0–1000 con el origen ABAJO a la izquierda, al revés que una imagen.
 *  - El <enabled> de la zona o de la línea se lee SIEMPRE false, pero reenviarlo así apaga
 *    la regla entera. Hay que forzarlo en cada escritura.
 */

type Modo = "escena" | "zona" | "linea";

function equipo(d: any) {
    return { ip: d.ip, username: d.username, password: d.password, authType: d.authType || "DIGEST" };
}

const RE_REGION = /<FieldDetectionRegion\b[\s\S]*?<\/FieldDetectionRegion>/g;
const RE_LINEA = /<LineItem>[\s\S]*?<\/LineItem>/g;
const campo = (xml: string, t: string) => (new RegExp(`<${t}>([^<]*)</${t}>`, "i").exec(xml) || [])[1] || "";

/** De fracciones de imagen (origen arriba) a la grilla 0–1000 de ISAPI (origen abajo). */
const aIsapi = (x: number, y: number) => [
    Math.round(Math.max(0, Math.min(1, x)) * 1000),
    Math.round((1 - Math.max(0, Math.min(1, y))) * 1000),
];

function puntosZona(roi: any) {
    const x = Math.max(0, Math.min(1, Number(roi?.x) || 0));
    const y = Math.max(0, Math.min(1, Number(roi?.y) || 0));
    const w = Math.max(0.05, Math.min(1 - x, Number(roi?.w) || 1));
    const h = Math.max(0.05, Math.min(1 - y, Number(roi?.h) || 1));
    return [[x, y + h], [x + w, y + h], [x + w, y], [x, y]]
        .map(([px, py]) => aIsapi(px, py))
        .map(([a, b]) => `<RegionCoordinates><positionX>${a}</positionX><positionY>${b}</positionY></RegionCoordinates>`)
        .join("");
}

function puntosLinea(linea: any) {
    const p1 = aIsapi(Number(linea?.x1) || 0, Number(linea?.y1) || 0);
    const p2 = aIsapi(Number(linea?.x2) || 0, Number(linea?.y2) || 0);
    return [p1, p2]
        .map(([a, b]) => `<Coordinates><positionX>${a}</positionX><positionY>${b}</positionY></Coordinates>`)
        .join("");
}

/**
 * La línea que la cámara tiene GUARDADA, en fracciones de la imagen (origen arriba), con su
 * sentido. Es la misma regla que dibuja el calibrador de intrusión: si el calibrador de la
 * cámara interior no la muestra, parecen dos líneas distintas y es una sola (9/10, Nico).
 */
function lineaDeLaCamara(xml: string): { x1: number; y1: number; x2: number; y2: number; sentido: string } | null {
    const item = (xml.match(RE_LINEA) || []).find((b) => /<id>1<\/id>/.test(b));
    if (!item) return null;
    const pts = [...item.matchAll(/<positionX>\s*(\d+)\s*<\/positionX>\s*<positionY>\s*(\d+)\s*<\/positionY>/g)].map((m) => ({ x: Number(m[1]) / 1000, y: 1 - Number(m[2]) / 1000 }));
    if (pts.length < 2) return null;
    const sentido = campo(item, "directionSensitivity") || "any";
    return { x1: pts[0].x, y1: pts[0].y, x2: pts[1].x, y2: pts[1].y, sentido: ["left-right", "right-left"].includes(sentido) ? sentido : "any" };
}

/** Reescribe el documento de la cámara con la regla puesta (o apagada). */
function ajustar(xml: string, opciones: { activar: boolean; puntos?: string; etiqueta?: string; sentido?: string; tipo: "zona" | "linea"; objetivo?: boolean }) {
    const { activar, puntos, sentido, tipo } = opciones;
    const re = tipo === "zona" ? RE_REGION : RE_LINEA;
    const listaRe = tipo === "zona" ? /<RegionCoordinatesList>[\s\S]*?<\/RegionCoordinatesList>/ : /<CoordinatesList>[\s\S]*?<\/CoordinatesList>/;
    const listaTag = tipo === "zona" ? "RegionCoordinatesList" : "CoordinatesList";
    const raiz = tipo === "zona" ? /(<FieldDetection\b[^>]*>\s*<id>1<\/id>\s*)<enabled>[^<]*<\/enabled>/ : /(<LineDetection\b[^>]*>\s*<id>1<\/id>\s*)<enabled>[^<]*<\/enabled>/;

    let salida = xml.replace(re, (bloque) => {
        if (!/<id>1<\/id>/.test(bloque)) return bloque;
        let b = bloque.replace(/<enabled>[^<]*<\/enabled>/, `<enabled>${activar}</enabled>`);
        if (activar && puntos) {
            b = listaRe.test(b)
                ? b.replace(listaRe, `<${listaTag}>${puntos}</${listaTag}>`)
                : b.replace(/<detectionTarget>/, `<${listaTag}>${puntos}</${listaTag}><detectionTarget>`);
            // Para el seguimiento el objetivo es vehículo. Al mover la línea desde el calibrador sin
            // cambiar el disparo (`objetivo: false`) se deja el que tenía: si la usa intrusión,
            // pasarla a "vehicle" la dejaría ciega a las personas.
            if (opciones.objetivo !== false) b = b.replace(/<detectionTarget>[^<]*<\/detectionTarget>/, "<detectionTarget>vehicle</detectionTarget>");
            if (sentido) b = b.replace(/<directionSensitivity>[^<]*<\/directionSensitivity>/, `<directionSensitivity>${sentido}</directionSensitivity>`);
        }
        return b;
    });
    salida = salida.replace(raiz, `$1<enabled>${activar}</enabled>`);
    return salida;
}

async function escribirRegla(d: any, tipo: "zona" | "linea", activar: boolean, puntos?: string, sentido?: string, objetivo = true) {
    const ruta = tipo === "zona" ? "/ISAPI/Smart/FieldDetection/1" : "/ISAPI/Smart/LineDetection/1";
    const actual = await authenticatedRequest("GET", ruta, equipo(d), { responseType: "text", accept: "application/xml", timeout: 8000 });
    const respuesta = await authenticatedRequest("PUT", ruta, equipo(d), {
        data: ajustar(actual, { activar, puntos, sentido, tipo, objetivo }),
        contentType: "application/xml",
        accept: "application/xml",
        responseType: "text",
        timeout: 12000,
    });
    // ISAPI contesta 200 aunque rechace el contenido: hay que leer el estado.
    const estado = campo(respuesta, "statusString");
    if (estado && estado.toUpperCase() !== "OK") {
        throw new Error(estado || campo(respuesta, "subStatusCode") || "sin detalle");
    }
}

async function leerDispositivo(id: string) {
    return prisma.device.findUnique({
        where: { id },
        select: {
            id: true, name: true, ip: true, username: true, password: true, authType: true,
            trackRoi: true, trackLine: true, trackTrigger: true,
        },
    });
}

export async function GET(req: NextRequest) {
    const auth = await verifyApiAuth();
    if (!auth.authenticated) return unauthorizedResponse();

    const d = await leerDispositivo(req.nextUrl.searchParams.get("deviceId") || "");
    if (!d) return NextResponse.json({ error: "Dispositivo no encontrado" }, { status: 404 });

    try {
        const cap = await authenticatedRequest("GET", "/ISAPI/Smart/capabilities", equipo(d), {
            responseType: "text", accept: "application/xml", timeout: 8000,
        });
        const [zona, linea] = await Promise.all([
            authenticatedRequest("GET", "/ISAPI/Smart/FieldDetection/1", equipo(d), { responseType: "text", accept: "application/xml", timeout: 8000 }).catch(() => ""),
            authenticatedRequest("GET", "/ISAPI/Smart/LineDetection/1", equipo(d), { responseType: "text", accept: "application/xml", timeout: 8000 }).catch(() => ""),
        ]);

        // Para que el aviso salga por el flujo, el disparador tiene que incluir "center".
        let avisa = true;
        try {
            const trg = await authenticatedRequest("GET", "/ISAPI/Event/triggers/linedetection-1", equipo(d), { responseType: "text", accept: "application/xml", timeout: 6000 });
            avisa = /<notificationMethod>center<\/notificationMethod>/.test(trg);
        } catch { }

        return NextResponse.json({
            soportada: true,
            soportaZona: /<isSupportFieldDetection>true/.test(cap),
            soportaLinea: /<isSupportLineDetection>true/.test(cap),
            zonaActiva: campo(zona, "enabled") === "true",
            lineaActiva: campo(linea, "enabled") === "true",
            lineaCamara: campo(linea, "enabled") === "true" ? lineaDeLaCamara(linea) : null,
            avisaAlServidor: avisa,
            modo: (d.trackTrigger === "camara" ? "zona" : d.trackTrigger) || "escena",
            linea: d.trackLine ? JSON.parse(d.trackLine) : null,
        });
    } catch (e: any) {
        return NextResponse.json({ soportada: false, error: e?.message || "sin respuesta", modo: d.trackTrigger || "escena" });
    }
}

export async function POST(req: NextRequest) {
    const auth = await verifyApiAuth();
    if (!auth.authenticated) return unauthorizedResponse();

    let body: any = {};
    try { body = await req.json(); } catch { }
    const d = await leerDispositivo(String(body.deviceId || ""));
    if (!d) return NextResponse.json({ error: "Dispositivo no encontrado" }, { status: 404 });

    /*
     * Poner o quitar SÓLO la línea de la cámara, sin cambiar qué dispara la lectura. Es lo que
     * usa el calibrador de la cámara interior cuando se mueve o se borra la línea que la cámara
     * ya tenía (la de intrusión): antes esa línea ni se veía ahí.
     */
    if (body.lineaCamara === "quitar" || body.lineaCamara === "poner") {
        const l = body.linea;
        if (body.lineaCamara === "poner" && !(l && [l.x1, l.y1, l.x2, l.y2].every((v: any) => Number.isFinite(Number(v))))) {
            return NextResponse.json({ error: "Falta la línea." }, { status: 400 });
        }
        try {
            if (body.lineaCamara === "quitar") await escribirRegla(d, "linea", false);
            else await escribirRegla(d, "linea", true, puntosLinea(l), l.sentido || "any", false);
        } catch (e: any) {
            return NextResponse.json({ error: `La cámara rechazó la configuración: ${e?.message || "sin detalle"}` }, { status: 502 });
        }
        await prisma.device.update({
            where: { id: d.id },
            data: body.lineaCamara === "quitar"
                // Sin línea, el disparo por cruce no tiene con qué disparar: vuelve a escena.
                ? { trackLine: null, ...(d.trackTrigger === "linea" ? { trackTrigger: "escena" } : {}) }
                : { trackLine: JSON.stringify(l) },
        });
        return NextResponse.json({ ok: true });
    }

    const modo: Modo = body.modo === "zona" || body.modo === "linea" ? body.modo : "escena";
    const linea = body.linea ?? (d.trackLine ? JSON.parse(d.trackLine) : null);
    let roi: any = null;
    try { roi = d.trackRoi ? JSON.parse(d.trackRoi) : null; } catch { }

    if (modo === "zona" && !roi) {
        return NextResponse.json({ error: "Falta la zona de interés: dibujala en el calibrador antes de activar el disparo por zona." }, { status: 400 });
    }
    if (modo === "linea" && !linea) {
        return NextResponse.json({ error: "Falta la línea de pasada: dibujala sobre el cuadro antes de activar el disparo por cruce." }, { status: 400 });
    }

    try {
        /*
         * «Escena» no toca la cámara. Antes apagaba la línea y la zona "para dejar todo
         * limpio", y esas reglas son también las de INTRUSIÓN: el 7/10 a las 11:21 la LPR
         * Interior pasó a escena y desde ese minuto no hubo una sola detección más (458
         * cruces hasta ahí, cero después). El seguimiento por escena mira cuadros y no
         * necesita la regla para nada; si la cámara igual avisa por intrusión (objetivo
         * persona), el worker lo descarta.
         */
        if (modo !== "escena") {
            // Una sola regla a la vez: si conviven, cada auto dispara dos veces.
            await escribirRegla(d, "zona", modo === "zona", modo === "zona" ? puntosZona(roi) : undefined);
            await escribirRegla(d, "linea", modo === "linea", modo === "linea" ? puntosLinea(linea) : undefined, linea?.sentido || "any");
        }
    } catch (e: any) {
        return NextResponse.json({ error: `La cámara rechazó la configuración: ${e?.message || "sin detalle"}` }, { status: 502 });
    }

    await prisma.device.update({
        where: { id: d.id },
        data: {
            trackTrigger: modo,
            ...(body.linea ? { trackLine: JSON.stringify(body.linea) } : {}),
        },
    });

    return NextResponse.json({ ok: true, modo });
}
