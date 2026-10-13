import { prisma } from "@/lib/prisma";
import { authenticatedRequest } from "@/lib/digest-auth";
import { getChannelMap, resolveNvrById, defaultNvrId } from "@/lib/nvr-resolve";

/**
 * Lo que el NVR sabe de una cámara que graba en él: con qué usuario y clave se conecta, y el
 * modelo, firmware, serie y MAC que la cámara le informó.
 *
 * Sirve cuando la cámara se importó desde el NVR con las credenciales del NVR (que no son las
 * de la cámara): «Comprobar» respondía «no acepta ese usuario y contraseña». El NVR sí las tiene
 * (RemoteDevice en Dahua), así que se le preguntan. Sólo lectura.
 */
export type CamaraSegunNvr = { username: string; password: string; model: string; firmwareVersion: string; serialNumber: string; macAddress: string; deviceName: string; nvrNombre: string };

export async function camaraSegunNvr(ip: string): Promise<CamaraSegunNvr | null> {
    const e = (await getChannelMap())[ip];
    const nvrId = e?.nvrId || (await defaultNvrId());
    const c: any = nvrId ? await resolveNvrById(nvrId) : null;
    if (!c || String(c.brand).toUpperCase() !== "DAHUA") return null;
    const txt = String(await authenticatedRequest("GET", "/cgi-bin/configManager.cgi?action=getConfig&name=RemoteDevice",
        { ip: c.ip, username: c.user, password: c.pass, authType: "DIGEST" } as any, { responseType: "text", timeout: 15000 }));
    const lineas = txt.split(/\r?\n/);
    const clave = lineas.find((l) => /\.Address=/.test(l) && l.split("=")[1]?.trim() === ip)?.match(/RemoteDevice\.(.+)\.Address=/)?.[1];
    if (!clave) return null;
    const v = (campo: string) => (lineas.find((l) => l.startsWith(`table.RemoteDevice.${clave}.${campo}=`)) || "").split("=").slice(1).join("=").trim();
    return {
        username: v("UserName"), password: v("Password"), model: v("DeviceType"), firmwareVersion: v("Version"),
        serialNumber: v("SerialNo"), macAddress: v("Mac"), deviceName: v("VideoInputs[0].Name") || v("Name"), nvrNombre: (nvrId ? (await prisma.device.findUnique({ where: { id: nvrId }, select: { name: true } }))?.name : null) || "el NVR",
    };
}
