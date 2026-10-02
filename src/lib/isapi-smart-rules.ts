import { authenticatedRequest } from "@/lib/digest-auth";
import type { Linea, Zona } from "@/components/tracking/Calibracion";

/**
 * Escritura de reglas Smart (cruce de línea / zona) en cámaras Hikvision AcuSense.
 *
 * El mecanismo y los gotchas del firmware salieron de `api/tracking/camera-rule/route.ts`,
 * que hace lo mismo para el disparo de SEGUIMIENTO (objetivo "vehicle"). Acá se generaliza
 * con un parámetro `objetivo` para poder escribir además reglas de INTRUSIÓN (objetivo
 * "human"), sin tocar esa ruta —que funciona y toca hardware— hasta poder probarla contra
 * una cámara. Cuando eso pase, camera-rule debería migrar a esta lib y quedar una sola copia.
 *
 * Gotchas heredados (no volver a aprender a los golpes):
 *  - El XML se ARMA SOBRE EL QUE DEVUELVE LA CÁMARA. De cero da "Invalid XML Content".
 *  - Zona usa <RegionCoordinatesList>/<RegionCoordinates>; línea usa <CoordinatesList>/
 *    <Coordinates>. Con el nombre cruzado responde OK y no guarda nada.
 *  - Coordenadas 0–1000 con origen ABAJO a la izquierda, al revés que una imagen.
 *  - El <enabled> se lee SIEMPRE false; hay que forzarlo en cada escritura.
 *  - ISAPI contesta 200 aunque rechace el contenido: hay que leer <statusString>.
 */

export type EquipoISAPI = { ip: string; username: string | null; password: string | null; authType: string | null };

// Objetivo de detección por defecto para intrusión: personas en el perímetro. El tracking
// usa "vehicle". Un solo token porque es lo único que el firmware acepta sin chistar.
export const OBJETIVO_INTRUSION = "human";

export function equipoDe(d: any): EquipoISAPI {
    return { ip: d.ip, username: d.username, password: d.password, authType: d.authType || "DIGEST" };
}

const RE_REGION = /<FieldDetectionRegion\b[\s\S]*?<\/FieldDetectionRegion>/g;
const RE_LINEA = /<LineItem>[\s\S]*?<\/LineItem>/g;

export const campo = (xml: string, t: string) => (new RegExp(`<${t}>([^<]*)</${t}>`, "i").exec(xml) || [])[1] || "";

/** De fracciones de imagen (origen arriba) a la grilla 0–1000 de ISAPI (origen abajo). */
export const aIsapi = (x: number, y: number): [number, number] => [
    Math.round(Math.max(0, Math.min(1, x)) * 1000),
    Math.round((1 - Math.max(0, Math.min(1, y))) * 1000),
];

export function puntosZona(zona: Zona): string {
    const x = Math.max(0, Math.min(1, Number(zona?.x) || 0));
    const y = Math.max(0, Math.min(1, Number(zona?.y) || 0));
    const w = Math.max(0.05, Math.min(1 - x, Number(zona?.w) || 1));
    const h = Math.max(0.05, Math.min(1 - y, Number(zona?.h) || 1));
    return [[x, y + h], [x + w, y + h], [x + w, y], [x, y]]
        .map(([px, py]) => aIsapi(px, py))
        .map(([a, b]) => `<RegionCoordinates><positionX>${a}</positionX><positionY>${b}</positionY></RegionCoordinates>`)
        .join("");
}

export function puntosLinea(linea: Linea): string {
    const p1 = aIsapi(Number(linea?.x1) || 0, Number(linea?.y1) || 0);
    const p2 = aIsapi(Number(linea?.x2) || 0, Number(linea?.y2) || 0);
    return [p1, p2]
        .map(([a, b]) => `<Coordinates><positionX>${a}</positionX><positionY>${b}</positionY></Coordinates>`)
        .join("");
}

// El sentido de la línea en los términos de Hikvision. "any" = ambos.
function sentidoIsapi(sentido?: string): string | null {
    if (sentido === "left-right") return "left-right";
    if (sentido === "right-left") return "right-left";
    return "any";
}

/** Reescribe el documento de la cámara con la regla puesta (o apagada), para el objetivo dado. */
export function ajustar(
    xml: string,
    opciones: { activar: boolean; puntos?: string; sentido?: string; tipo: "zona" | "linea"; objetivo: string }
): string {
    const { activar, puntos, sentido, tipo, objetivo } = opciones;
    const re = tipo === "zona" ? RE_REGION : RE_LINEA;
    const listaRe = tipo === "zona" ? /<RegionCoordinatesList>[\s\S]*?<\/RegionCoordinatesList>/ : /<CoordinatesList>[\s\S]*?<\/CoordinatesList>/;
    const listaTag = tipo === "zona" ? "RegionCoordinatesList" : "CoordinatesList";
    const raiz = tipo === "zona"
        ? /(<FieldDetection\b[^>]*>\s*<id>1<\/id>\s*)<enabled>[^<]*<\/enabled>/
        : /(<LineDetection\b[^>]*>\s*<id>1<\/id>\s*)<enabled>[^<]*<\/enabled>/;

    let salida = xml.replace(re, (bloque) => {
        if (!/<id>1<\/id>/.test(bloque)) return bloque;
        let b = bloque.replace(/<enabled>[^<]*<\/enabled>/, `<enabled>${activar}</enabled>`);
        if (activar && puntos) {
            b = listaRe.test(b)
                ? b.replace(listaRe, `<${listaTag}>${puntos}</${listaTag}>`)
                : b.replace(/<detectionTarget>/, `<${listaTag}>${puntos}</${listaTag}><detectionTarget>`);
            // Objetivo de detección: acá está la diferencia con el tracking (que fija "vehicle").
            b = b.replace(/<detectionTarget>[^<]*<\/detectionTarget>/, `<detectionTarget>${objetivo}</detectionTarget>`);
            const s = sentidoIsapi(sentido);
            if (s) b = b.replace(/<directionSensitivity>[^<]*<\/directionSensitivity>/, `<directionSensitivity>${s}</directionSensitivity>`);
        }
        return b;
    });
    salida = salida.replace(raiz, `$1<enabled>${activar}</enabled>`);
    return salida;
}

async function leerRegla(d: EquipoISAPI, tipo: "zona" | "linea"): Promise<string> {
    const ruta = tipo === "zona" ? "/ISAPI/Smart/FieldDetection/1" : "/ISAPI/Smart/LineDetection/1";
    return authenticatedRequest("GET", ruta, d as any, { responseType: "text", accept: "application/xml", timeout: 8000 });
}

/** Escribe la regla y valida releyendo el estado que devuelve la cámara. Lanza si no quedó OK. */
export async function escribirRegla(
    d: EquipoISAPI,
    tipo: "zona" | "linea",
    o: { activar: boolean; puntos?: string; sentido?: string; objetivo: string }
): Promise<void> {
    const ruta = tipo === "zona" ? "/ISAPI/Smart/FieldDetection/1" : "/ISAPI/Smart/LineDetection/1";
    const actual = await leerRegla(d, tipo);
    const respuesta = await authenticatedRequest("PUT", ruta, d as any, {
        data: ajustar(actual, { ...o, tipo }),
        contentType: "application/xml",
        accept: "application/xml",
        responseType: "text",
        timeout: 12000,
    });
    const estado = campo(respuesta, "statusString");
    if (estado && estado.toUpperCase() !== "OK") {
        throw new Error(estado || campo(respuesta, "subStatusCode") || "sin detalle");
    }
}

/**
 * Confirma que la regla quedó realmente activa RELEYÉNDOLA de la cámara. El spec exige que
 * si la escritura no "prendió" de verdad, se reporte error y no se marque como aplicada.
 * (El <enabled> del cuerpo miente, pero el documento de la regla activa sí trae la geometría.)
 */
export async function verificarActiva(d: EquipoISAPI, tipo: "zona" | "linea"): Promise<boolean> {
    const xml = await leerRegla(d, tipo);
    return campo(xml, "enabled") === "true";
}

/**
 * Para que la cámara AVISE al server cuando dispara la regla, el trigger tiene que notificar
 * al "center" (el host que escucha). El tracking ya depende de esto; acá lo forzamos al
 * activar intrusión, sobre el documento que devuelve la cámara (mismo criterio que las reglas).
 * El httpHost global (a dónde postea) ya está configurado en estas cámaras porque es el mismo
 * que usan LPR y tracking; por eso NO lo reescribimos —hacerlo a ciegas podría cortar esos avisos.
 */
export async function asegurarNotificacionCenter(d: EquipoISAPI, tipo: "zona" | "linea"): Promise<boolean> {
    const clave = tipo === "zona" ? "fielddetection" : "linedetection";
    const ruta = `/ISAPI/Event/triggers/${clave}-1`;
    let actual = "";
    try {
        actual = await authenticatedRequest("GET", ruta, d as any, { responseType: "text", accept: "application/xml", timeout: 6000 });
    } catch {
        return false; // algunos firmwares no exponen el trigger por separado; no es fatal
    }
    if (/<notificationMethod>center<\/notificationMethod>/.test(actual)) return true;

    let cuerpo = actual;
    if (/<notificationMethod>[^<]*<\/notificationMethod>/.test(cuerpo)) {
        cuerpo = cuerpo.replace(/<notificationMethod>[^<]*<\/notificationMethod>/, "<notificationMethod>center</notificationMethod>");
    } else if (/<EventTriggerNotificationList\b[^>]*>/.test(cuerpo)) {
        cuerpo = cuerpo.replace(/(<EventTriggerNotificationList\b[^>]*>)/, `$1<EventTriggerNotification><id>center</id><notificationMethod>center</notificationMethod></EventTriggerNotification>`);
    } else {
        return false;
    }
    const resp = await authenticatedRequest("PUT", ruta, d as any, {
        data: cuerpo, contentType: "application/xml", accept: "application/xml", responseType: "text", timeout: 10000,
    });
    const estado = campo(resp, "statusString");
    return !estado || estado.toUpperCase() === "OK";
}
