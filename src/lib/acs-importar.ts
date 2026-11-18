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
 *  · **Se pide de a páginas, desde la última hacia atrás, y se corta solo.** El equipo acepta 30
 *    por pedido y devuelve los eventos del más viejo al más nuevo. Pidiendo desde el principio,
 *    las primeras 40 páginas eran las 1.200 más VIEJAS —todas ya traídas— y la segunda corrida
 *    decía «0 accesos guardados de 1200 eventos leídos» mientras los 188 nuevos quedaban atrás
 *    del tope (medido 18/11, con 1.418 eventos en el equipo). Ahora se pregunta cuántos hay
 *    (`totalMatches`) y se empieza por el final: lo nuevo entra en la primera página, y se corta
 *    en cuanto una página entera ya estaba traída.
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
    /** Eventos más viejos que quedaron sin traer porque se llegó al tope de esta corrida. */
    masViejos?: number;
    /** El equipo no tiene bitácora que se pueda pedir (ver `tieneBitacora`). No es un error. */
    sinBitacora?: boolean;
    error?: string;
};

type Equipo = { id: string; ip: string; username: string | null; password: string | null; httpPort: number | null; name: string; location: string | null; direction: string };

async function pagina(d: Equipo, desde: number, hasta: number, offset: string, posicion: number, cuantos = POR_PAGINA): Promise<{ lista: AcsEvent[]; total: number }> {
    const cuerpo = {
        AcsEventCond: {
            searchID: `oa-${d.id.slice(0, 8)}`,
            searchResultPosition: posicion,
            maxResults: cuantos,
            major: 0, minor: 0,
            // Con huso explícito y en el huso del equipo: con `...Z` contesta 400 (medido 18/11).
            startTime: isoConOffset(desde, offset),
            endTime: isoConOffset(hasta, offset),
        },
    };
    const r = await authenticatedRequest("POST", "/ISAPI/AccessControl/AcsEvent?format=json",
        { ip: d.ip, username: d.username || "admin", password: d.password || "", authType: "DIGEST", httpPort: d.httpPort || undefined },
        { data: cuerpo, contentType: "application/json", accept: "application/json", responseType: "json", timeout: 15000 });
    return { lista: (r?.AcsEvent?.InfoList || []) as AcsEvent[], total: Number(r?.AcsEvent?.totalMatches) || 0 };
}

/**
 * ¿Este equipo guarda una bitácora que se le pueda pedir?
 *
 * 18/11, Nico: «al intentar traer la de 30 días da un error: Request failed with status code 400».
 * Medido: el portero DS-KV9503 contesta `notSupport` a /AccessControl/AcsEvent, y el terminal
 * DS-K1T343MFWX contesta las capacidades. No es una falla: ese modelo de portero no lleva registro
 * de accesos — los eventos los manda en el momento, no los guarda. Preguntarlo antes convierte un
 * error rojo sin explicación en una frase que dice qué hacer en su lugar (escucharlo).
 */
async function tieneBitacora(d: Equipo): Promise<boolean> {
    try {
        const r = await authenticatedRequest("GET", "/ISAPI/AccessControl/AcsEvent/capabilities?format=json",
            { ip: d.ip, username: d.username || "admin", password: d.password || "", authType: "DIGEST", httpPort: d.httpPort || undefined },
            { accept: "application/json", responseType: "json", timeout: 8000 });
        return !!r?.AcsEvent;
    } catch { return false; }
}

/** Lo mismo, por id: la pantalla lo pregunta al abrir la ficha para no ofrecer un botón que falla. */
export async function puedeBitacora(deviceId: string): Promise<boolean> {
    const d = await prisma.device.findUnique({
        where: { id: deviceId },
        select: { id: true, ip: true, username: true, password: true, httpPort: true, name: true, location: true, direction: true },
    }) as Equipo | null;
    if (!d) return false;
    return tieneBitacora(d);
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

    if (!(await tieneBitacora(d))) return { ...vacio, sinBitacora: true };

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

    const desde = ahoraDelEquipo - desdeDias * 86_400_000;
    const hasta = ahoraDelEquipo + 86_400_000;
    let masViejos = 0;

    try {
        // Cuántos hay en la ventana, para empezar por la última página (ver el comentario de arriba).
        const total = (await pagina(d, desde, hasta, offset, 0, 1)).total;
        let pos = Math.max(0, total - POR_PAGINA);

        for (let p = 0; p < PAGINAS_MAX; p++) {
            const { lista: lote } = await pagina(d, desde, hasta, offset, pos);
            if (!lote.length) break;
            leidos += lote.length;
            let nuevos = 0;

            for (const e of lote) {
                const serie = Number(e.serialNo) || 0;
                if (serie && serie <= ultima) continue;        // ya estaba
                nuevos++;
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
            // Una página entera que ya estaba: de acá para atrás es todo viejo.
            if (!nuevos && ultima > 0) break;
            if (pos === 0) break;
            if (p === PAGINAS_MAX - 1) masViejos = pos;    // se llegó al tope: queda lo anterior
            pos = Math.max(0, pos - POR_PAGINA);
        }
    } catch (err) {
        return { leidos, guardados, otros, sinTraducir, desfasajeMs, ultimaSerie: mayorSerie || null, error: err instanceof Error ? err.message.slice(0, 200) : "No se pudo leer la bitácora" };
    }

    if (mayorSerie > ultima) {
        await prisma.setting.upsert({ where: { key: CLAVE_SERIE(d.id) }, update: { value: String(mayorSerie) }, create: { key: CLAVE_SERIE(d.id), value: String(mayorSerie) } });
    }
    return { leidos, guardados, otros, sinTraducir, desfasajeMs, ultimaSerie: mayorSerie || null, masViejos: masViejos || undefined };
}
