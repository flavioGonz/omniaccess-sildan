import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticatedRequest } from "@/lib/digest-auth";
import { verifyApiAuth, unauthorizedResponse } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

/**
 * Regla de detección de vehículo en la propia cámara.
 *
 * Estas Hikvision con AcuSense distinguen persona de vehículo por su cuenta. Si se
 * les prende una zona de intrusión con objetivo "vehicle", avisan cada vez que pasa
 * un auto y la pasarela puede quedarse dormida el resto del tiempo, en vez de estar
 * mirando cuadros a ver si cambió algo. Se configura con la misma zona de interés
 * que ya calibró el operador, para no pedirle dibujar dos veces.
 *
 * Detalles del equipo que costaron sangre y conviene no olvidar:
 *  - El XML se ARMA SOBRE EL QUE DEVUELVE LA CÁMARA. Construirlo de cero, aunque
 *    tenga todos los campos del manual, devuelve "Invalid XML Content": el firmware
 *    quiere su propio documento, con sus atributos y su orden.
 *  - La lista de puntos es <RegionCoordinatesList>/<RegionCoordinates>, no
 *    <CoordinatesList>/<Coordinates> (eso es cruce de línea). Con el nombre
 *    equivocado el equipo responde OK y no guarda nada.
 *  - Las coordenadas van normalizadas 0–1000 con el origen ABAJO a la izquierda,
 *    al revés que una imagen.
 *  - Para que el evento salga por el flujo de avisos, el disparador tiene que
 *    incluir la notificación "center". Viene así de fábrica, pero se verifica.
 *
 * GET  ?deviceId=...        -> estado actual de la regla
 * POST { deviceId, activar }
 */

function equipo(d: any) {
    return { ip: d.ip, username: d.username, password: d.password, authType: d.authType || "DIGEST" };
}

const RE_REGION = /<FieldDetectionRegion\b[\s\S]*?<\/FieldDetectionRegion>/g;
const campo = (xml: string, t: string) => (new RegExp(`<${t}>([^<]*)</${t}>`, "i").exec(xml) || [])[1] || "";

/**
 * La zona de interés viene como {x,y,w,h} en fracciones con el origen arriba a la
 * izquierda, como una imagen. ISAPI usa 0–1000 con el origen abajo, así que el eje
 * vertical se da vuelta.
 */
function puntos(roi: any) {
    const x = Math.max(0, Math.min(1, Number(roi?.x) || 0));
    const y = Math.max(0, Math.min(1, Number(roi?.y) || 0));
    const w = Math.max(0.05, Math.min(1 - x, Number(roi?.w) || 1));
    const h = Math.max(0.05, Math.min(1 - y, Number(roi?.h) || 1));
    const x1 = Math.round(x * 1000), x2 = Math.round((x + w) * 1000);
    const abajo = Math.round((1 - (y + h)) * 1000), arriba = Math.round((1 - y) * 1000);
    return [[x1, abajo], [x2, abajo], [x2, arriba], [x1, arriba]]
        .map(([px, py]) => `<RegionCoordinates><positionX>${px}</positionX><positionY>${py}</positionY></RegionCoordinates>`)
        .join("");
}

/** Toma el XML de la cámara y devuelve el mismo documento con la regla puesta. */
function ajustar(xml: string, roi: any, activar: boolean) {
    const pts = puntos(roi);
    let salida = xml.replace(RE_REGION, (bloque) => {
        if (!/<id>1<\/id>/.test(bloque)) return bloque;
        let b = bloque.replace(/<enabled>[^<]*<\/enabled>/, `<enabled>${activar}</enabled>`);
        b = b.replace(/<RegionCoordinatesList>[\s\S]*?<\/RegionCoordinatesList>/, "");
        b = b.replace(/<detectionTarget>/, `<RegionCoordinatesList>${pts}</RegionCoordinatesList><detectionTarget>`);
        b = b.replace(/<detectionTarget>[^<]*<\/detectionTarget>/, "<detectionTarget>vehicle</detectionTarget>");
        return b;
    });
    // El <enabled> del documento (el primero, antes de la lista de zonas).
    salida = salida.replace(/(<FieldDetection\b[^>]*>\s*<id>1<\/id>\s*)<enabled>[^<]*<\/enabled>/, `$1<enabled>${activar}</enabled>`);
    return salida;
}

async function leerDispositivo(id: string) {
    return prisma.device.findUnique({
        where: { id },
        select: { id: true, name: true, ip: true, username: true, password: true, authType: true, trackRoi: true, trackTrigger: true },
    });
}

export async function GET(req: NextRequest) {
    const auth = await verifyApiAuth();
    if (!auth.authenticated) return unauthorizedResponse();

    const d = await leerDispositivo(req.nextUrl.searchParams.get("deviceId") || "");
    if (!d) return NextResponse.json({ error: "Dispositivo no encontrado" }, { status: 404 });

    try {
        const xml = await authenticatedRequest("GET", "/ISAPI/Smart/FieldDetection/1", equipo(d), {
            responseType: "text", accept: "application/xml", timeout: 8000,
        });
        const region = (xml.match(RE_REGION) || [])[0] || "";
        const conZona = /<RegionCoordinates>/.test(region);
        // El aviso solo sale por el flujo si el disparador tiene la notificación "center".
        let avisa = true;
        try {
            const trg = await authenticatedRequest("GET", "/ISAPI/Event/triggers/fielddetection-1", equipo(d), {
                responseType: "text", accept: "application/xml", timeout: 6000,
            });
            avisa = /<notificationMethod>center<\/notificationMethod>/.test(trg);
        } catch { }

        return NextResponse.json({
            soportada: true,
            activa: campo(xml, "enabled") === "true" && conZona,
            objetivo: campo(region, "detectionTarget") || null,
            avisaAlServidor: avisa,
            modo: d.trackTrigger || "escena",
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

    const activar = body.activar !== false;
    let roi: any = null;
    try { roi = d.trackRoi ? JSON.parse(d.trackRoi) : null; } catch { }
    if (activar && !roi) {
        return NextResponse.json({ error: "Falta la zona de interés: dibujala en el calibrador antes de activar el disparo por cámara." }, { status: 400 });
    }

    try {
        const actual = await authenticatedRequest("GET", "/ISAPI/Smart/FieldDetection/1", equipo(d), {
            responseType: "text", accept: "application/xml", timeout: 8000,
        });
        const respuesta = await authenticatedRequest("PUT", "/ISAPI/Smart/FieldDetection/1", equipo(d), {
            data: ajustar(actual, roi, activar),
            contentType: "application/xml",
            accept: "application/xml",
            responseType: "text",
            timeout: 12000,
        });
        // ISAPI devuelve 200 aunque haya rechazado el contenido: hay que leer el estado.
        if (/<statusString>(?!OK)/i.test(respuesta)) {
            const razon = campo(respuesta, "statusString") || campo(respuesta, "subStatusCode") || "sin detalle";
            return NextResponse.json({ error: `La cámara rechazó la configuración: ${razon}` }, { status: 502 });
        }
    } catch (e: any) {
        return NextResponse.json({ error: `No se pudo configurar la cámara: ${e?.message || "sin detalle"}` }, { status: 502 });
    }

    // El modo queda guardado en el dispositivo: la pasarela lo relee sola y se rearma
    // sin que haya que reiniciar nada.
    await prisma.device.update({
        where: { id: d.id },
        data: { trackTrigger: activar ? "camara" : "escena" },
    });

    return NextResponse.json({ ok: true, modo: activar ? "camara" : "escena" });
}
