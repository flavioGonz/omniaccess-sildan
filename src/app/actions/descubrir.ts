"use server";

import { prisma } from "@/lib/prisma";
import { authenticatedRequest } from "@/lib/digest-auth";

/**
 * Preguntarle al equipo qué tiene, en vez de hacérselo escribir a quien lo instala.
 *
 * El alta pedía una URL RTSP a mano. Esa URL es distinta en cada marca, cambia con el
 * canal, y el error más común —usar el flujo secundario— no se nota: la cámara conecta,
 * la imagen se ve, y las matrículas simplemente no se leen nunca porque el cuadro no
 * tiene resolución. Alguien pierde una tarde buscando el problema en el lector.
 *
 * El equipo sabe todo eso de sí mismo. Sabe qué canales tiene, con qué resolución, si
 * soporta cruce de línea y si lo tiene prendido, si su recurso inteligente está en modo
 * matrícula, qué hora tiene puesta y cuántos discos le quedan. Nada de eso hay que
 * escribirlo: hay que ir a buscarlo.
 *
 * Todo se lee en paralelo y cada lectura va en su propio try. Un equipo que no contesta
 * una de las preguntas igual contesta las otras, y media respuesta es mucho más útil que
 * un error único que no dice qué parte falló.
 */

export type CanalDescubierto = {
    canal: number;
    nombre: string | null;
    /** La IP de la cámara detrás del canal, cuando es un grabador. */
    ip: string | null;
    /** El flujo principal. Es el que sirve para leer matrículas. */
    rtsp: string;
    /** El secundario, para mirar sin gastar ancho de banda. Nunca para analítica. */
    rtspSecundario: string;
    resolucion: string | null;
    /** El equipo de OmniAccess que ya está cargado con esa IP, si existe. */
    deviceId: string | null;
    deviceNombre: string | null;
};

export type AnaliticaDescubierta = {
    clave: "linea" | "zona" | "anpr";
    rotulo: string;
    soportada: boolean;
    activa: boolean;
    detalle: string;
};

export type Hallazgo = {
    ok: boolean;
    error?: string;
    /** Con cuál de las dos formas de autenticarse contestó. Sirve para dejarla puesta. */
    autenticacion?: "BASIC" | "DIGEST";
    equipo?: { modelo?: string; firmware?: string; mac?: string; serie?: string; clase?: string };
    canales: CanalDescubierto[];
    analiticas: AnaliticaDescubierta[];
    discos: { id: string; capacidadGb: number; libresGb: number; estado: string }[];
    reloj?: { equipo: string; desvioSeg: number };
};

const uno = (xml: string, tag: string) => {
    const m = xml.match(new RegExp(`<${tag}>\\s*([^<]*)\\s*</${tag}>`, "i"));
    return m ? m[1].trim() : null;
};

const vacio = (): Hallazgo => ({ ok: false, canales: [], analiticas: [], discos: [] });

/** La URL del flujo de un canal Hikvision. 101 es el canal 1 principal; 102, su secundario. */
function rtspDe(host: string, usuario: string, clave: string, canal: number, sub = false) {
    const cred = usuario ? `${encodeURIComponent(usuario)}:${encodeURIComponent(clave || "")}@` : "";
    return `rtsp://${cred}${host}:554/Streaming/Channels/${canal}0${sub ? 2 : 1}`;
}

export async function descubrirRecursos(input: {
    ip: string; username?: string; password?: string; authType?: string;
    brand?: string; deviceType?: string;
}): Promise<Hallazgo> {
    const ip = (input.ip || "").trim();
    if (!ip) return { ...vacio(), error: "Falta la IP." };

    const marca = (input.brand || "").toUpperCase();
    if (marca && marca !== "HIKVISION") {
        /* Se dice qué falta, no "no se pudo". Un mensaje que no distingue "esta marca
           todavía no la sabemos preguntar" de "el equipo no contesta" manda a revisar el
           cableado de una cámara que está perfecta. */
        return { ...vacio(), error: `El descubrimiento por ahora sólo habla ISAPI (Hikvision). Para ${marca} hay que cargar el canal a mano.` };
    }

    const usuario = input.username || "admin";
    const clave = input.password || "";
    const orden: ("DIGEST" | "BASIC")[] =
        (input.authType || "DIGEST").toUpperCase() === "BASIC" ? ["BASIC", "DIGEST"] : ["DIGEST", "BASIC"];

    let equipoAuth: any = null;
    let autenticacion: "BASIC" | "DIGEST" | undefined;
    let infoXml = "";
    let ultimoError = "";

    /* Primero la identidad, y con eso se decide cuál de las dos autenticaciones sirve. Si
       ninguna contesta, no tiene sentido intentar las otras siete preguntas. */
    for (const a of orden) {
        try {
            const dev: any = { ip, username: usuario, password: clave, authType: a };
            const xml: string = await authenticatedRequest("GET", "/ISAPI/System/deviceInfo", dev, {
                responseType: "text", accept: "application/xml", timeout: 8000,
            });
            if (xml && /deviceName|model/i.test(String(xml))) {
                infoXml = String(xml); equipoAuth = dev; autenticacion = a; break;
            }
        } catch (e: any) { ultimoError = e?.message || String(e); }
    }
    if (!equipoAuth) return { ...vacio(), error: ultimoError || "El equipo no contestó." };

    const res: Hallazgo = {
        ok: true, autenticacion, canales: [], analiticas: [], discos: [],
        equipo: {
            modelo: uno(infoXml, "model") || undefined,
            firmware: uno(infoXml, "firmwareVersion") || undefined,
            mac: uno(infoXml, "macAddress") || undefined,
            serie: uno(infoXml, "serialNumber") || undefined,
            clase: uno(infoXml, "deviceType") || undefined,
        },
    };

    const pedir = (ruta: string, timeout = 8000) =>
        authenticatedRequest("GET", ruta, equipoAuth, {
            responseType: "text", accept: "application/xml", timeout,
        }).then((x: any) => String(x || "")).catch(() => "");

    const esGrabador = (input.deviceType || "").toUpperCase() === "NVR"
        || /NVR|DVR/i.test(res.equipo?.clase || "") || /NVR|DVR/i.test(res.equipo?.modelo || "");

    const [proxy, flujos, cap, linea, zona, vca, hora, discos] = await Promise.all([
        esGrabador ? pedir("/ISAPI/ContentMgmt/InputProxy/channels", 12000) : Promise.resolve(""),
        pedir("/ISAPI/Streaming/channels", 10000),
        pedir("/ISAPI/Smart/capabilities"),
        pedir("/ISAPI/Smart/LineDetection/1"),
        pedir("/ISAPI/Smart/FieldDetection/1"),
        pedir("/ISAPI/System/Video/inputs/channels/1/VCAResource"),
        pedir("/ISAPI/System/time", 6000),
        esGrabador ? pedir("/ISAPI/ContentMgmt/Storage/hdd", 10000) : Promise.resolve(""),
    ]);

    /* Qué equipos ya están cargados, para poder decir de una cuál canal es cuál cámara en
       vez de hacer comparar IPs a mano. */
    const cargados = await prisma.device.findMany({ select: { id: true, name: true, ip: true } }).catch(() => []);
    const porIp = new Map(cargados.filter((d) => d.ip).map((d) => [d.ip as string, d]));

    if (proxy) {
        for (const bloque of proxy.split(/<InputProxyChannel[\s>]/i).slice(1)) {
            const id = bloque.match(/<id>\s*(\d+)\s*<\/id>/i);
            if (!id) continue;
            const canal = parseInt(id[1], 10);
            const ipCanal = uno(bloque, "ipAddress");
            const ya = ipCanal ? porIp.get(ipCanal) : undefined;
            res.canales.push({
                canal,
                nombre: uno(bloque, "name"),
                ip: ipCanal,
                rtsp: rtspDe(ip, usuario, clave, canal),
                rtspSecundario: rtspDe(ip, usuario, clave, canal, true),
                resolucion: null,
                deviceId: ya?.id ?? null,
                deviceNombre: ya?.name ?? null,
            });
        }
    }

    /* En una cámara suelta los canales son los suyos propios. La resolución se lee acá
       porque es el dato que separa el flujo que sirve del que no: una matrícula a
       veinte metros no entra en 704x480, y ésa es la causa número uno de "la cámara anda
       pero no lee nada". */
    if (!res.canales.length && flujos) {
        for (const bloque of flujos.split(/<StreamingChannel[\s>]/i).slice(1)) {
            const id = bloque.match(/<id>\s*(\d+)\s*<\/id>/i);
            if (!id) continue;
            const n = parseInt(id[1], 10);
            const ancho = uno(bloque, "videoResolutionWidth");
            const alto = uno(bloque, "videoResolutionHeight");
            const canal = Math.floor(n / 100) || 1;
            const sub = n % 100 !== 1;
            if (sub) continue;   // el secundario se arma solo, no hace falta listarlo aparte
            res.canales.push({
                canal,
                nombre: uno(bloque, "channelName"),
                ip: null,
                rtsp: rtspDe(ip, usuario, clave, canal),
                rtspSecundario: rtspDe(ip, usuario, clave, canal, true),
                resolucion: ancho && alto ? `${ancho}x${alto}` : null,
                deviceId: null, deviceNombre: null,
            });
        }
    }

    const soportaLinea = /<isSupportLineDetection>\s*true/i.test(cap);
    const soportaZona = /<isSupportFieldDetection>\s*true/i.test(cap);
    const modoVca = uno(vca, "type") || uno(vca, "VCAResourceType");

    res.analiticas = [
        {
            clave: "linea", rotulo: "Cruce de línea",
            soportada: soportaLinea || !!linea,
            activa: uno(linea, "enabled") === "true",
            detalle: soportaLinea || linea
                ? "La cámara avisa en el instante en que algo cruza la línea. Es el disparo más preciso y el que menos GPU gasta."
                : "Este modelo no la ofrece. El seguimiento va a tener que mirar la escena.",
        },
        {
            clave: "zona", rotulo: "Intrusión en zona",
            soportada: soportaZona || !!zona,
            activa: uno(zona, "enabled") === "true",
            detalle: soportaZona || zona
                ? "Avisa cuando algo entra en una región del cuadro. Sirve donde el paso no se puede reducir a una raya."
                : "Este modelo no la ofrece.",
        },
        {
            clave: "anpr", rotulo: "Lectura de matrícula en la cámara",
            soportada: !!modoVca,
            activa: modoVca === "roadDetection",
            detalle: !modoVca
                ? "No tiene recurso inteligente configurable."
                : modoVca === "roadDetection"
                    ? "El recurso inteligente está en modo matrícula: la cámara lee chapas por su cuenta."
                    /* Ojo con el tono: en una cámara interior de seguimiento esto NO es un
                       problema. Ahí la matrícula la lee Omni-LPR sobre los cuadros que le
                       manda la pasarela, y el recurso inteligente de la cámara se usa para
                       avisar del cruce, no para leer. Decirlo como una falla mandaría a
                       "arreglar" una cámara que está bien. */
                    : `El recurso inteligente está en modo "${modoVca}". Alcanza para avisar de cruces de línea y de zona, que es lo que necesita el seguimiento. Sólo hace falta roadDetection si se quiere que la cámara lea la matrícula por su cuenta, como en una cámara de acceso.`,
        },
    ];

    for (const bloque of (discos || "").split(/<hdd[\s>]/i).slice(1)) {
        const id = uno(bloque, "id");
        if (!id) continue;
        const cap2 = Number(uno(bloque, "capacity") || 0);
        const libre = Number(uno(bloque, "freeSpace") || 0);
        res.discos.push({
            id,
            capacidadGb: Math.round(cap2 / 1024),
            libresGb: Math.round(libre / 1024),
            estado: uno(bloque, "status") || "?",
        });
    }

    const local = uno(hora, "localTime");
    if (local) {
        const t = Date.parse(local);
        res.reloj = {
            equipo: local,
            /* El desvío importa de verdad: el playback del grabador se pide por hora, así
               que un reloj corrido devuelve el clip equivocado — o ninguno. */
            desvioSeg: Number.isFinite(t) ? Math.round((Date.now() - t) / 1000) : 0,
        };
    }

    return res;
}

/**
 * Dejar este grabador como el del sistema.
 *
 * El mapeo canal↔cámara ya se guardaba, pero el host, el usuario y la clave del grabador
 * no los escribía nadie — y sin eso `/api/nvr/playback` no tiene a quién pedirle el clip.
 * Se podía mapear todo prolijamente y después no salía un solo video grabado, sin ninguna
 * señal de por qué.
 */
export async function guardarGrabador(input: {
    ip: string; username?: string; password?: string; port?: string;
}): Promise<{ ok: boolean; error?: string }> {
    const ip = (input.ip || "").trim();
    if (!ip) return { ok: false, error: "Falta la IP del grabador." };
    const valores: Record<string, string> = {
        NVR_HOST: ip,
        NVR_USER: input.username || "admin",
        NVR_PASS: input.password || "",
        NVR_PORT: (input.port || "554").trim(),
    };
    try {
        for (const [key, value] of Object.entries(valores)) {
            await prisma.setting.upsert({ where: { key }, update: { value }, create: { key, value } });
        }
        return { ok: true };
    } catch (e: any) {
        return { ok: false, error: e?.message || "No se pudo guardar." };
    }
}

/**
 * Atar un canal del grabador a un equipo ya cargado.
 *
 * Dos cosas distintas que hasta ahora había que hacer por separado y en pantallas
 * distintas, con lo cual casi siempre se hacía una sola:
 *
 *   1. El mapeo canal↔cámara, que es lo que después permite ir de un evento a su
 *      grabación. Se guarda por IP porque es lo que el grabador informa de cada canal.
 *   2. El flujo. Una cámara de analítica puede estar en una red a la que el servidor no
 *      llega directo, pero el grabador sí la ve: pedirle el flujo AL GRABADOR resuelve
 *      eso, y de paso deja una sola conexión contra la cámara en vez de dos.
 *
 * El flujo sólo se pisa si el equipo no tenía ninguno. Reemplazar un RTSP que alguien
 * puso a mano y que funciona sería cambiarle la fuente a una cámara en producción sin
 * que nadie lo haya pedido.
 */
export async function vincularCanal(input: {
    deviceId: string; canal: number; rtsp?: string; usarFlujoDelGrabador?: boolean;
}): Promise<{ ok: boolean; error?: string; flujoPuesto?: boolean }> {
    try {
        const dev = await prisma.device.findUnique({
            where: { id: input.deviceId },
            select: { id: true, ip: true, rtspUrl: true },
        });
        if (!dev?.ip) return { ok: false, error: "Ese equipo no tiene IP cargada." };

        const fila = await prisma.setting.findUnique({ where: { key: "NVR_CHANNEL_MAP" } });
        const mapa: Record<string, number> = fila?.value ? JSON.parse(fila.value) : {};
        /* Un canal es de una sola cámara: al asignarlo hay que soltar la que lo tenía, o
           quedan dos apuntando al mismo lugar y la grabación sale de cualquiera. */
        for (const k of Object.keys(mapa)) if (Number(mapa[k]) === input.canal) delete mapa[k];
        mapa[dev.ip] = input.canal;
        await prisma.setting.upsert({
            where: { key: "NVR_CHANNEL_MAP" },
            update: { value: JSON.stringify(mapa) },
            create: { key: "NVR_CHANNEL_MAP", value: JSON.stringify(mapa) },
        });

        let flujoPuesto = false;
        if (input.usarFlujoDelGrabador && input.rtsp && !dev.rtspUrl) {
            await prisma.device.update({ where: { id: dev.id }, data: { rtspUrl: input.rtsp } });
            flujoPuesto = true;
        }
        return { ok: true, flujoPuesto };
    } catch (e: any) {
        return { ok: false, error: e?.message || "No se pudo vincular." };
    }
}
