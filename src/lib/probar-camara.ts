import { authenticatedRequest } from "@/lib/digest-auth";

/**
 * Por qué una cámara no entrega video: se le pregunta por ISAPI con el usuario y la clave
 * cargados. «go2rtc no entregó cuadro» (lo único que sabía el motor) junta tres problemas muy
 * distintos, y cada uno se arregla en otro lado:
 *  · clave      — la cámara rechaza el usuario o la clave (401): se corrige en Dispositivos.
 *                 Medido el 16/10 en el lab: 14 cámaras cargadas el 14/10 con otra clave daban
 *                 401 y el motor les pedía un cuadro cada 4 s. Cada pedido es un intento de
 *                 login fallido, y Hikvision bloquea la IP después de unos pocos.
 *  · bloqueada  — la cámara ya bloqueó la IP por demasiados intentos fallidos (lockStatus).
 *  · sin-red    — no contesta (apagada, IP equivocada, sin ruta).
 *  · ok         — contesta y acepta la clave: el problema es el video (perfil, códec, go2rtc).
 */
export type ResultadoPrueba = "ok" | "clave" | "bloqueada" | "sin-red" | "error";

export async function probarCamara(d: { ip: string; username?: string | null; password?: string | null }): Promise<ResultadoPrueba> {
    if (!d.ip) return "sin-red";
    try {
        await authenticatedRequest("GET", "/ISAPI/System/deviceInfo", { ip: d.ip, username: d.username || "admin", password: d.password || "", authType: "DIGEST" } as any,
            { responseType: "text", accept: "application/xml", timeout: 4000 });
        return "ok";
    } catch (e: any) {
        const st = e?.response?.status;
        const cuerpo = String(e?.response?.data || "");
        if (/lockStatus>\s*lock|unlockTime|userLocked/i.test(cuerpo)) return "bloqueada";
        if (st === 401 || st === 403) return "clave";
        if (!e?.response) return "sin-red";
        return "error";
    }
}

export const TEXTO_PRUEBA: Record<ResultadoPrueba, string> = {
    ok: "La cámara contesta y acepta la clave, pero el video no llega: revisar el perfil de video o go2rtc.",
    clave: "La cámara rechaza el usuario o la clave cargados. Corregila en Dispositivos. Mientras tanto el motor la pide cada vez más espaciado, para no bloquear la IP del servidor.",
    bloqueada: "La cámara bloqueó la IP del servidor por intentos fallidos. Se desbloquea sola en ~30 min; antes, corregí la clave.",
    "sin-red": "La cámara no contesta en la red (apagada, otra IP o sin ruta).",
    error: "La cámara contesta con un error.",
};
