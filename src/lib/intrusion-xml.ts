/**
 * El XML de Hikvision que decide si una cámara de intrusión le avisa a OmniAccess, y el de su OSD
 * (26/11). Sin red ni base: se prueba solo (tests/intrusion-xml.test.ts).
 *
 * Nico preguntó «¿OmniAccess configura el servidor de alarmas en la cámara?» y «¿qué pasa si la
 * cámara está en modo avisa pero no tiene servidor de alarma?». La respuesta tiene tres piezas y
 * hacen falta las tres para que un cruce llegue:
 *  1. la regla dibujada y prendida (línea o zona);
 *  2. en el «enlace» de esa regla, «Avisar al centro de vigilancia» (`center`): sin eso la cámara
 *     detecta, graba si se lo pidieron, y no se lo cuenta a nadie;
 *  3. OmniAccess en la lista de servidores de alarma (httpHosts).
 * Faltando cualquiera, OmniAccess no se entera nunca, y la cámara se ve «en línea» igual.
 */

/** ¿El enlace de la regla avisa al centro? (EventTrigger de /ISAPI/Event/triggers/linedetection-1). */
export function tieneCentro(xml: string): boolean {
    return /<notificationMethod>\s*center\s*<\/notificationMethod>/i.test(xml || "");
}

const NOTIF_CENTRO = "<EventTriggerNotification><id>center</id><notificationMethod>center</notificationMethod><notificationRecurrence>beginning</notificationRecurrence></EventTriggerNotification>";

/**
 * El mismo EventTrigger con el aviso al centro agregado, sin tocar los demás enlaces (grabar,
 * relé, correo…). Si ya lo tiene, devuelve el XML tal cual. Si no tiene lista, la crea antes del
 * cierre del EventTrigger.
 */
export function agregarCentro(xml: string): string {
    if (tieneCentro(xml)) return xml;
    if (/<EventTriggerNotificationList\s*\/>/i.test(xml)) return xml.replace(/<EventTriggerNotificationList\s*\/>/i, `<EventTriggerNotificationList>${NOTIF_CENTRO}</EventTriggerNotificationList>`);
    if (/<\/EventTriggerNotificationList>/i.test(xml)) return xml.replace(/<\/EventTriggerNotificationList>/i, `${NOTIF_CENTRO}</EventTriggerNotificationList>`);
    return xml.replace(/<\/EventTrigger>\s*$/i, `<EventTriggerNotificationList>${NOTIF_CENTRO}</EventTriggerNotificationList></EventTrigger>`);
}

/** El nombre del canal (lo que la cámara escribe en el video como OSD): /ISAPI/System/Video/inputs/channels/1. */
export function nombreDeCanal(xml: string): string | null {
    const m = /<name>([\s\S]*?)<\/name>/i.exec(xml || "");
    return m ? desescapar(m[1].trim()) : null;
}

/** El mismo VideoInputChannel con otro nombre. Sólo cambia `<name>`: el resto vuelve como vino. */
export function conNombreDeCanal(xml: string, nombre: string): string {
    const n = escapar(nombre);
    if (/<name>[\s\S]*?<\/name>/i.test(xml)) return xml.replace(/<name>[\s\S]*?<\/name>/i, `<name>${n}</name>`);
    return xml.replace(/<\/id>/i, `</id><name>${n}</name>`);
}

/** ¿La cámara dibuja el nombre en el video? (channelNameOverlay de /overlays). null = no lo dice. */
export function nombreVisible(overlaysXml: string): boolean | null {
    const b = /<channelNameOverlay>([\s\S]*?)<\/channelNameOverlay>/i.exec(overlaysXml || "")?.[1];
    if (!b) return null;
    return /<enabled>\s*true\s*<\/enabled>/i.test(b);
}

/**
 * El tope del OSD. Hikvision acepta 32 caracteres en el nombre de canal; más largo lo rechaza con
 * un 400 que no explica nada, así que se corta antes y se dice.
 */
export const OSD_MAX = 32;

const escapar = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const desescapar = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&apos;/g, "'").replace(/&amp;/g, "&");
