import https from "https";

/**
 * Datos de una cámara Bosch por ONVIF (modelo, firmware, serie, MAC), para «Detectar» y
 * «Comprobar» en el cajón del contador de fila. Mismo camino que ya usa la app con estas cámaras
 * (api/queue/onvif-discover): HTTPS con autenticación Basic y certificado propio de la cámara.
 * Antes probeDeviceInfo sólo sabía de Hikvision y Dahua, y con Bosch contestaba «Autodetección
 * no disponible».
 */

const ESPERA_MS = 8_000;

function soap(ip: string, servicio: string, cuerpo: string, user: string, pass: string): Promise<string> {
    const xml = `<?xml version="1.0" encoding="UTF-8"?><s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" xmlns:tds="http://www.onvif.org/ver10/device/wsdl"><s:Body>${cuerpo}</s:Body></s:Envelope>`;
    return new Promise((resolve, reject) => {
        const req = https.request({
            hostname: ip, port: 443, path: `/onvif/${servicio}`, method: "POST", timeout: ESPERA_MS,
            agent: new https.Agent({ rejectUnauthorized: false }),
            headers: {
                Authorization: `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`,
                "Content-Type": "application/soap+xml; charset=utf-8",
                "Content-Length": String(Buffer.byteLength(xml)),
            },
        }, (res) => {
            let d = "";
            res.on("data", (c: Buffer) => { d += c.toString(); });
            res.on("end", () => {
                if (res.statusCode === 401) reject(new Error("La cámara respondió pero no acepta ese usuario y contraseña"));
                else resolve(d);
            });
        });
        req.on("error", reject);
        req.on("timeout", () => { req.destroy(); reject(new Error("Sin respuesta (revisá la IP)")); });
        req.write(xml);
        req.end();
    });
}

const dato = (xml: string, tag: string) => (new RegExp(`<[^:>]*:?${tag}>([^<]*)<`).exec(xml)?.[1] || "").trim();

export async function infoBosch(ip: string, user: string, pass: string) {
    try {
        const info = await soap(ip, "device_service", "<tds:GetDeviceInformation/>", user, pass);
        const model = dato(info, "Model");
        if (!model && /Fault/i.test(info)) return { ok: false, online: true, error: dato(info, "Text") || "La cámara rechazó la consulta ONVIF" };
        let mac = "";
        try { mac = dato(await soap(ip, "device_service", "<tds:GetNetworkInterfaces/>", user, pass), "HwAddress"); } catch { /* el modelo alcanza para saber que responde */ }
        return {
            ok: true, online: true, authType: "BASIC",
            model, firmwareVersion: dato(info, "FirmwareVersion"), serialNumber: dato(info, "SerialNumber"),
            macAddress: mac, deviceName: dato(info, "Manufacturer"),
        };
    } catch (e: any) {
        return { ok: false, online: false, error: e?.message || "Sin respuesta" };
    }
}
