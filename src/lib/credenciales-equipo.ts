import { authenticatedRequest } from "@/lib/digest-auth";

/**
 * Probar un usuario y una clave contra un equipo que apareció en el barrido, antes de darlo
 * de alta.
 *
 * Pedido de Nico (18/11): «permite ingresar contraseñas de NVRs, cámaras, autenticarse y
 * verificar si podemos agregarlo». El motivo es concreto: un alta con la clave equivocada no
 * falla al guardar —falla después, en silencio, cuando el equipo deja de contestar y alguien
 * tiene que ir a buscar por qué esa cámara no manda nada. Probar antes convierte eso en una
 * línea roja en una lista.
 *
 * Y de paso el equipo se presenta: modelo, número de serie y firmware salen de la misma
 * respuesta, así que el alta ya no se escribe a mano.
 *
 * Sólo lecturas (`GET` a la ficha del equipo). Nada de esto escribe en el equipo.
 */

export type Credencial = { usuario: string; clave: string };

export type Verificacion = {
    ip: string;
    /** ok: entró. clave: contestó 401, la credencial no sirve. muda: no contestó o no habla
     *  ninguno de los dos protocolos que sabemos probar. */
    estado: "ok" | "clave" | "muda";
    protocolo: "ISAPI" | "DAHUA" | null;
    modelo: string | null;
    serie: string | null;
    firmware: string | null;
    nombre: string | null;
    /** Si la ficha dice que es un grabador. Cambia el tipo con el que se da de alta. */
    grabador: boolean;
    detalle: string | null;
};

const VACIA: Omit<Verificacion, "ip" | "estado" | "protocolo" | "detalle"> = {
    modelo: null, serie: null, firmware: null, nombre: null, grabador: false,
};

const entre = (xml: string, etiqueta: string): string | null =>
    new RegExp(`<${etiqueta}[^>]*>([^<]*)</${etiqueta}>`, "i").exec(xml)?.[1]?.trim() || null;

/** `key=value` por línea, que es como contesta el CGI de Dahua. */
const deLineas = (txt: string): Record<string, string> => {
    const m: Record<string, string> = {};
    for (const l of txt.split(/\r?\n/)) {
        const i = l.indexOf("=");
        if (i > 0) m[l.slice(0, i).trim().toLowerCase()] = l.slice(i + 1).trim();
    }
    return m;
};

/** Un 401 es «la clave no sirve»; cualquier otra cosa es «no pude hablar con esto». */
const esClaveMala = (e: unknown): boolean => {
    const t = e instanceof Error ? e.message : String(e);
    return /\b401\b|unauthor/i.test(t);
};

async function porIsapi(ip: string, c: Credencial, puerto?: number): Promise<Verificacion | null> {
    try {
        const xml: string = await authenticatedRequest("GET", "/ISAPI/System/deviceInfo",
            { ip, username: c.usuario, password: c.clave, authType: "DIGEST", httpPort: puerto },
            { responseType: "text", accept: "application/xml", timeout: 8000 });
        if (typeof xml !== "string" || !/deviceInfo/i.test(xml)) return null;
        const tipo = (entre(xml, "deviceType") || "") + " " + (entre(xml, "model") || "");
        return {
            ip, estado: "ok", protocolo: "ISAPI", detalle: null,
            modelo: entre(xml, "model"),
            serie: entre(xml, "serialNumber"),
            firmware: entre(xml, "firmwareVersion"),
            nombre: entre(xml, "deviceName"),
            // Un grabador se delata por el tipo que declara o por la familia del modelo
            // (DS-7xxx / DS-9xxx son NVR; las cámaras son DS-2xxx).
            grabador: /NVR|DVR|recorder/i.test(tipo) || /\bDS-[79]\d/i.test(tipo),
        };
    } catch (e) {
        if (esClaveMala(e)) return { ip, estado: "clave", protocolo: "ISAPI", detalle: "El equipo contestó que usuario o clave no sirven.", ...VACIA };
        return null;
    }
}

async function porDahua(ip: string, c: Credencial, puerto?: number): Promise<Verificacion | null> {
    try {
        const txt: string = await authenticatedRequest("GET", "/cgi-bin/magicBox.cgi?action=getSystemInfo",
            { ip, username: c.usuario, password: c.clave, authType: "DIGEST", httpPort: puerto },
            { responseType: "text", accept: "text/plain", timeout: 8000 });
        if (typeof txt !== "string" || !txt.includes("=")) return null;
        const m = deLineas(txt);
        const tipo = m.devicetype || m["devicetype"] || "";
        return {
            ip, estado: "ok", protocolo: "DAHUA", detalle: null,
            modelo: tipo || null,
            serie: m.serialnumber || null,
            firmware: m.updateserial || m.version || null,
            nombre: null,
            grabador: /NVR|DVR|XVR/i.test(tipo),
        };
    } catch (e) {
        if (esClaveMala(e)) return { ip, estado: "clave", protocolo: "DAHUA", detalle: "El equipo contestó que usuario o clave no sirven.", ...VACIA };
        return null;
    }
}

/**
 * Prueba la credencial contra una dirección. `habla` viene del barrido y dice por dónde
 * empezar; si no se sabe, se prueban los dos (son dos pedidos, no veinte).
 */
export async function probarCredencial(ip: string, c: Credencial, habla: string[] = [], puerto?: number): Promise<Verificacion> {
    const orden = habla.includes("DAHUA") ? [porDahua, porIsapi] : [porIsapi, porDahua];
    let mala: Verificacion | null = null;
    for (const probar of orden) {
        const r = await probar(ip, c, puerto);
        if (r?.estado === "ok") return r;
        if (r?.estado === "clave") mala = r;
    }
    return mala || { ip, estado: "muda", protocolo: null, detalle: "No contestó la ficha del equipo. Puede no ser Hikvision ni Dahua, o tener el puerto web en otro número.", ...VACIA };
}

/** De a poco: diez equipos a la vez es suficiente y no satura la red del cliente. */
const EN_PARALELO = 10;

export async function probarVarias(ips: { ip: string; habla?: string[]; puerto?: number }[], c: Credencial): Promise<Verificacion[]> {
    const out: Verificacion[] = [];
    for (let i = 0; i < ips.length; i += EN_PARALELO) {
        out.push(...await Promise.all(ips.slice(i, i + EN_PARALELO).map((x) => probarCredencial(x.ip, c, x.habla || [], x.puerto))));
    }
    return out;
}
