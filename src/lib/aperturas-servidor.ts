import type { Device } from "@prisma/client";
import { authenticatedRequest, type DigestAuthDevice } from "@/lib/digest-auth";
import { esSoloLectura } from "@/lib/solo-lectura";
import { comoAbre, puertasHikvision, rangoHikvision, puertasDahua, PUERTAS_AKUVOX, PUERTA_ASUMIDA, type Puerta } from "@/lib/aperturas";

/**
 * La parte de las aperturas que habla con el equipo (ver lib/aperturas.ts): preguntarle qué
 * puertas tiene y pedirle que abra una.
 *
 * Dos reglas que salen de lo que ya pasó en este proyecto:
 *
 *   · Abrir dice la verdad. Devuelve si el equipo aceptó y, si no, qué contestó. Nunca «enviado».
 *   · Un equipo de sólo lectura para este servidor (lib/solo-lectura) no se abre desde acá. La
 *     guarda general mira el método HTTP, y Dahua y Akuvox abren con un GET: pasarían. Por eso
 *     acá se pregunta antes, para todas las marcas.
 */

export type LecturaPuertas = {
    /** true: la lista vino del equipo. false: no se le pudo preguntar (o la marca no lo informa) y la lista es la asumida. */
    leidas: boolean;
    puertas: Puerta[];
    /** Por qué no se pudo leer, cuando no se pudo. */
    error?: string;
};

const aDigest = (d: Device): DigestAuthDevice => ({ ip: d.ip, username: d.username || "admin", password: d.password || "", authType: d.authType, httpPort: d.httpPort });
const motivo = (e: any, quien = "el equipo") => (e?.response?.status ? `${quien} respondió ${e.response.status}` : e?.code === "ECONNABORTED" || /timeout/i.test(e?.message || "") ? `${quien} no contestó a tiempo` : (e?.message || "sin respuesta"));
const LEER_MS = 6000;
const ABRIR_MS = 8000;

async function texto(d: Device, ruta: string): Promise<string> {
    const r = await authenticatedRequest("GET", ruta, aDigest(d), { responseType: "text", accept: "*/*", timeout: LEER_MS });
    return typeof r === "string" ? r : JSON.stringify(r);
}

/** Qué puertas tiene el equipo. No cambia nada en él: son todos GET. */
export async function leerPuertas(device: Device): Promise<LecturaPuertas> {
    const marca = String(device.brand || "").toUpperCase();
    if (!comoAbre(marca).puede) return { leidas: false, puertas: [] };

    if (marca === "HIKVISION") {
        try {
            const cap = await texto(device, "/ISAPI/AccessControl/RemoteControl/door/capabilities");
            const rango = rangoHikvision(cap);
            if (!rango) return { leidas: false, puertas: [PUERTA_ASUMIDA], error: "el equipo no declara puertas (¿es un portero o un control de acceso?)" };
            const params: Record<number, string | null> = {};
            // Una por una: son una o dos, y un portero de villa atiende pocas conexiones a la vez.
            for (let n = rango.desde; n <= rango.hasta; n++) params[n] = await texto(device, `/ISAPI/AccessControl/Door/param/${n}`).catch(() => null);
            return { leidas: true, puertas: puertasHikvision(cap, params) };
        } catch (e) { return { leidas: false, puertas: [PUERTA_ASUMIDA], error: motivo(e) }; }
    }

    if (marca === "DAHUA" || marca === "INTELBRAS") {
        try {
            const puertas = puertasDahua(await texto(device, "/cgi-bin/configManager.cgi?action=getConfig&name=AccessControl"));
            return puertas.length ? { leidas: true, puertas } : { leidas: false, puertas: [PUERTA_ASUMIDA], error: "el equipo no listó puertas" };
        } catch (e) { return { leidas: false, puertas: [PUERTA_ASUMIDA], error: motivo(e) }; }
    }

    // Akuvox no informa cuántos relés tiene: se ofrecen los dos que nombra su API.
    if (marca === "AKUVOX") return { leidas: false, puertas: PUERTAS_AKUVOX };

    return { leidas: false, puertas: [] };
}

/** Pide abrir la puerta `n` y dice si el equipo lo aceptó. */
export async function abrirPuerta(device: Device, n: number): Promise<{ ok: boolean; error?: string }> {
    const marca = String(device.brand || "").toUpperCase();
    const como = comoAbre(marca);
    if (!como.puede) return { ok: false, error: como.nota };
    if (!Number.isInteger(n) || n < 1 || n > 16) return { ok: false, error: "esa puerta no existe" };
    if (esSoloLectura(device.ip || "")) return { ok: false, error: "este servidor tiene a ese equipo como de sólo lectura (OMNI_EQUIPOS_SOLO_LECTURA): se abre desde el servidor de ese lugar" };

    try {
        if (marca === "HIKVISION") {
            const { HikvisionDriver } = await import("@/lib/drivers/HikvisionDriver");
            return await new HikvisionDriver().abrirCerradura(device, n);
        }
        if (marca === "AKUVOX") {
            const { AkuvoxDriver } = await import("@/lib/drivers/AkuvoxDriver");
            await new AkuvoxDriver().triggerRelay(device, n);
            return { ok: true };
        }
        if (marca === "DAHUA" || marca === "INTELBRAS") {
            // UserID y Type son los que la API de Dahua pide para una apertura remota; el equipo
            // contesta «OK» en texto plano cuando la aceptó.
            const r = await authenticatedRequest("GET", `/cgi-bin/accessControl.cgi?action=openDoor&channel=${n}&UserID=101&Type=Remote`, aDigest(device), { responseType: "text", accept: "*/*", timeout: ABRIR_MS });
            const cuerpo = String(typeof r === "string" ? r : JSON.stringify(r)).trim();
            return /^OK\b/i.test(cuerpo) ? { ok: true } : { ok: false, error: `el equipo contestó «${cuerpo.slice(0, 80) || "vacío"}»` };
        }
    } catch (e) { return { ok: false, error: motivo(e) }; }
    return { ok: false, error: como.nota };
}
