import { authenticatedRequest } from "@/lib/digest-auth";
import { prisma } from "@/lib/prisma";
import { cuandoFue, desfasajeDeEquipo, isoConOffset, offsetDeEquipo, traducirAcs, NO_ES_ACCESO, type AcsEvent } from "@/lib/acs-evento";
import type { CredentialType } from "@prisma/client";

/**
 * Traer la bitácora de un control de acceso Hikvision al historial de OmniAccess.
 *
 * Qué resuelve: el equipo guarda quién pasó y con qué, y hasta ahora eso vivía sólo adentro del
 * equipo —se miraba con el software del fabricante o no se miraba—. Acá entra al mismo historial
 * que las matrículas, con la misma ficha y los mismos filtros.
 *
 * Tres decisiones que vale la pena leer antes de tocar esto:
 *
 *  · **Se pide de a páginas y se corta solo.** El equipo medido tiene 811 eventos y acepta 30 por
 *    pedido; traer todo de una es una petición de minutos que el navegador corta por la mitad.
 *  · **Lo ya traído no se vuelve a traer.** El equipo le pone a cada evento un número de serie
 *    creciente; se guarda el último en un Setting por equipo y se piden sólo los posteriores.
 *  · **La hora se corrige con el desfasaje medido del equipo** (lib/acs-evento). El terminal de
 *    esta instalación está once horas atrasado: sin corregir, el historial queda corrido once
 *    horas y parece cierto. La corrección es un parche y la pantalla lo dice: lo que corresponde
 *    es poner el equipo en hora.
 */

const POR_PAGINA = 30;
const PAGINAS_MAX = 40;           // 1.200 eventos por corrida: más que eso es otra corrida
const CLAVE_SERIE = (id: string) => `ACS_ULTIMA_SERIE_${id}`;

export type Resumen = {
    leidos: number;
    guardados: number;
    /** Lo que no es un acceso (puerta, administración), por motivo. */
    otros: Record<string, number>;
    /** Códigos que el equipo mandó y no sabemos traducir: se informan, no se inventan. */
    sinTraducir: Record<string, number>;
    desfasajeMs: number | null;
    ultimaSerie: number | null;
    error?: string;
};

type Equipo = { id: string; ip: string; username: string | null; password: string | null; httpPort: number | null; name: string; location: string | null; direction: string };

async function pagina(d: Equipo, desde: number, hasta: number, offset: string, posicion: number): Promise<AcsEvent[]> {
    const cuerpo = {
        AcsEventCond: {
            searchID: `oa-${d.id.slice(0, 8)}`,
            searchResultPosition: posicion,
            maxResults: POR_PAGINA,
            major: 0, minor: 0,
            // Con huso explícito y en el huso del equipo: con `...Z` contesta 400 (medido 18/11).
            startTime: isoConOffset(desde, offset),
            endTime: isoConOffset(hasta, offset),
        },
    };
    const r = await authenticatedRequest("POST", "/ISAPI/AccessControl/AcsEvent?format=json",
        { ip: d.ip, username: d.username || "admin", password: d.password || "", authType: "DIGEST", httpPort: d.httpPort || undefined },
        { data: cuerpo, contentType: "application/json", accept: "application/json", responseType: "json", timeout: 15000 });
    return (r?.AcsEvent?.InfoList || []) as AcsEvent[];
}

/** La hora que dice el equipo, para medirle el desfasaje. */
async function horaDelEquipo(d: Equipo): Promise<string | null> {
    try {
        const xml: string = await authenticatedRequest("GET", "/ISAPI/System/time",
            { ip: d.ip, username: d.username || "admin", password: d.password || "", authType: "DIGEST", httpPort: d.httpPort || undefined },
            { responseType: "text", accept: "application/xml", timeout: 8000 });
        return /<localTime[^>]*>([^<]+)</i.exec(String(xml))?.[1]?.trim() || null;
    } catch { return null; }
}

/**
 * Trae lo que haya desde la última vez. `desdeDias` sólo cuenta la primera vez (no hay marca):
 * después manda el número de serie, que es exacto.
 */
export async function importarBitacora(deviceId: string, desdeDias = 30): Promise<Resumen> {
    const vacio: Resumen = { leidos: 0, guardados: 0, otros: {}, sinTraducir: {}, desfasajeMs: null, ultimaSerie: null };
    const d = await prisma.device.findUnique({
        where: { id: deviceId },
        select: { id: true, ip: true, username: true, password: true, httpPort: true, name: true, location: true, direction: true },
    }) as Equipo | null;
    if (!d) return { ...vacio, error: "Ese equipo no existe." };

    const marca = await prisma.setting.findUnique({ where: { key: CLAVE_SERIE(d.id) } }).catch(() => null);
    const ultima = Number(marca?.value) || 0;
    const suHora = await horaDelEquipo(d);
    const desfasajeMs = desfasajeDeEquipo(suHora);
    const offset = offsetDeEquipo(suHora);
    /* La ventana se escribe en la hora DEL EQUIPO: con el reloj once horas atrasado, pedirle los
       «últimos 30 días» en hora nuestra le pide un futuro que él no tiene. */
    const ahoraDelEquipo = Date.now() + (desfasajeMs ?? 0);

    const otros: Record<string, number> = {};
    const sinTraducir: Record<string, number> = {};
    let leidos = 0, guardados = 0, mayorSerie = ultima;

    try {
        for (let p = 0; p < PAGINAS_MAX; p++) {
            const lote = await pagina(d, ahoraDelEquipo - desdeDias * 86_400_000, ahoraDelEquipo + 86_400_000, offset, p * POR_PAGINA);
            if (!lote.length) break;
            leidos += lote.length;

            for (const e of lote) {
                const serie = Number(e.serialNo) || 0;
                if (serie && serie <= ultima) continue;        // ya estaba
                if (serie > mayorSerie) mayorSerie = serie;

                const t = traducirAcs(e);
                if (!t) {
                    const k = `${e.major ?? "?"}/${e.minor ?? "?"}`;
                    if (NO_ES_ACCESO[k]) otros[NO_ES_ACCESO[k]] = (otros[NO_ES_ACCESO[k]] || 0) + 1;
                    else sinTraducir[k] = (sinTraducir[k] || 0) + 1;
                    continue;
                }
                const cuando = cuandoFue(e, desfasajeMs);
                if (!cuando) continue;

                // Quién es: por la tarjeta que ya esté en el padrón. Si no figura, el evento se
                // guarda igual con lo que dijo el equipo — un desconocido pasando es justamente
                // lo que hay que poder ver.
                const cred = t.credencial
                    ? await prisma.credential.findFirst({ where: { value: t.credencial }, select: { userId: true } }).catch(() => null)
                    : null;

                await prisma.accessEvent.create({
                    data: {
                        timestamp: cuando,
                        deviceId: d.id,
                        userId: cred?.userId || null,
                        accessType: (t.tipo as CredentialType | null) ?? undefined,
                        credentialId: t.credencial,
                        decision: t.decision,
                        direction: (d.direction as "ENTRY" | "EXIT") || "ENTRY",
                        location: d.location || d.name,
                        details: [t.detalle, t.nombre ? `«${t.nombre}»` : "", t.legajo ? `legajo ${t.legajo}` : "", `#acs${t.serie ?? ""}`]
                            .filter(Boolean).join(" · ").slice(0, 400),
                    },
                });
                guardados++;
            }
            if (lote.length < POR_PAGINA) break;
        }
    } catch (err) {
        return { leidos, guardados, otros, sinTraducir, desfasajeMs, ultimaSerie: mayorSerie || null, error: err instanceof Error ? err.message.slice(0, 200) : "No se pudo leer la bitácora" };
    }

    if (mayorSerie > ultima) {
        await prisma.setting.upsert({ where: { key: CLAVE_SERIE(d.id) }, update: { value: String(mayorSerie) }, create: { key: CLAVE_SERIE(d.id), value: String(mayorSerie) } });
    }
    return { leidos, guardados, otros, sinTraducir, desfasajeMs, ultimaSerie: mayorSerie || null };
}
