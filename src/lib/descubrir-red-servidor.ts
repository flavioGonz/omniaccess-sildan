import { execFile } from "child_process";
import net from "net";
import os from "os";
import dns from "dns/promises";
import { promisify } from "util";
import { prisma } from "@/lib/prisma";
import { direcciones, prefijoDe, queParece, PUERTOS, PUERTOS_AMPLIOS, type Hallazgo, type Parecer } from "@/lib/descubrir-red";
import { promises as fsp } from "fs";
import { clasificar, convieneProbarClave, fabricantePorMac, nombrePropuesto, type Clasificacion } from "@/lib/descubrir-inteligente";
import { preguntarSnmp, type FichaSnmp } from "@/lib/snmp-servidor";
import { probarCredencial, type Credencial, type Verificacion } from "@/lib/credenciales-equipo";

/**
 * El barrido de red de Dispositivos: lo que toca la red.
 *
 * `execFile`, nunca `exec`: los argumentos van como lista y no pasan por un shell, así que un
 * prefijo con algo pegado no puede convertirse en un comando. Igual se valida antes
 * (`esSubredPrivada`), porque de las dos defensas la que importa es la que no se olvida.
 */
const correr = promisify(execFile);

/** Un ping por dirección, con un segundo de paciencia: más es esperar a algo que no está. */
const PING_MS = 1200;
/** Cuántos pings a la vez. Treinta no llenan la red y bajan un /24 a unos diez segundos. */
const EN_PARALELO = 30;
/** Un puerto cerrado contesta enseguida; uno filtrado no contesta nunca. Esto es la espera. */
const PUERTO_MS = 450;
const WEB_MS = 1500;

export type HallazgoCompleto = Hallazgo & {
    parece: Parecer;
    /** Si esa IP ya es un equipo de OmniAccess. */
    equipo: { id: string; nombre: string; tipo: string } | null;
};

async function pingear(ip: string): Promise<number | null> {
    try {
        const { stdout } = await correr("ping", ["-n", "-c", "1", "-W", "1", ip], { timeout: PING_MS + 800 });
        const m = /time[=<]([\d.]+)\s*ms/.exec(stdout);
        return m ? Math.round(Number(m[1]) * 10) / 10 : 0;
    } catch { return null; }
}

function puertoAbierto(ip: string, puerto: number): Promise<boolean> {
    return new Promise((listo) => {
        const s = new net.Socket();
        let contestado = false;
        const cerrar = (abierto: boolean) => { if (contestado) return; contestado = true; s.destroy(); listo(abierto); };
        s.setTimeout(PUERTO_MS);
        s.once("connect", () => cerrar(true));
        s.once("timeout", () => cerrar(false));
        s.once("error", () => cerrar(false));
        s.connect(puerto, ip);
    });
}

type Respuesta = { estado: number; servidor: string | null; reino: string | null } | null;

async function pedir(ip: string, ruta: string): Promise<Respuesta> {
    try {
        const r = await fetch(`http://${ip}${ruta}`, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(WEB_MS) });
        const auth = r.headers.get("www-authenticate") || "";
        // El cuerpo no se lee: alcanza con los encabezados y así la conexión se suelta enseguida.
        return { estado: r.status, servidor: r.headers.get("server"), reino: /realm="?([^",]+)"?/i.exec(auth)?.[1] || null };
    } catch { return null; }
}

/**
 * Quién es, sin credenciales.
 *
 * Primero `/`, por el encabezado `Server` y el reino si pide clave. Medido en el lab (17/11): las
 * Hikvision de ahí NO mandan `Server` ni piden clave ahí, así que eso solo deducía marca en cero
 * equipos. Lo que las delata es su propio protocolo: `/ISAPI/System/deviceInfo` contesta 401 con
 * `realm="IP Camera(GB828)"`. La misma ruta en una Dahua no existe, y su `magicBox.cgi` contesta
 * 401 donde la Hikvision da 404 — por eso el de Dahua se prueba sólo si ISAPI no contestó.
 *
 * Son como mucho tres pedidos, y sólo a las direcciones que contestaron el ping con el 80 abierto.
 */
async function identificar(ip: string): Promise<{ servidor: string | null; reino: string | null; habla: ("ISAPI" | "DAHUA")[] }> {
    const raiz = await pedir(ip, "/");
    const habla: ("ISAPI" | "DAHUA")[] = [];
    let reino = raiz?.reino || null;

    const isapi = await pedir(ip, "/ISAPI/System/deviceInfo");
    if (isapi && (isapi.estado === 401 || isapi.estado === 200)) { habla.push("ISAPI"); reino = isapi.reino || reino; }
    else {
        const dahua = await pedir(ip, "/cgi-bin/magicBox.cgi?action=getDeviceType");
        if (dahua && (dahua.estado === 401 || dahua.estado === 200)) { habla.push("DAHUA"); reino = dahua.reino || reino; }
    }
    return { servidor: raiz?.servidor || null, reino, habla };
}

/** Las subredes /24 de las direcciones del propio servidor (sin loopback ni docker). */
export function subredesPropias(): string[] {
    const fuera = /^(lo|docker|br-|veth|tun|tap)/;
    const p: string[] = [];
    for (const [nombre, dirs] of Object.entries(os.networkInterfaces())) {
        if (fuera.test(nombre)) continue;
        for (const d of dirs || []) {
            if (d.family !== "IPv4" || d.internal) continue;
            const q = prefijoDe(d.address);
            if (q && !p.includes(q)) p.push(q);
        }
    }
    return p;
}

/**
 * Barre la subred y devuelve lo que contestó, con lo que parece ser y si ya está dado de alta.
 *
 * Primero el ping a todas (barato y en paralelo); los puertos y la página web sólo a las que
 * contestaron, que son unas pocas. Al revés —probar seis puertos en 254 direcciones— son mil
 * quinientas conexiones a nada.
 */
export async function barrer(subred: string, desde: number, hasta: number): Promise<{ total: number; hallazgos: HallazgoCompleto[] }> {
    const ips = direcciones(subred, desde, hasta);
    if (!ips.length) throw new Error("Ese rango no se puede barrer.");

    const vivas: { ip: string; rtt: number | null }[] = [];
    for (let i = 0; i < ips.length; i += EN_PARALELO) {
        const tanda = await Promise.all(ips.slice(i, i + EN_PARALELO).map(async (ip) => ({ ip, rtt: await pingear(ip) })));
        for (const r of tanda) if (r.rtt != null) vivas.push(r);
    }

    const hallazgos: HallazgoCompleto[] = await Promise.all(vivas.map(async (v) => {
        const [puertos, nombre] = await Promise.all([
            Promise.all(PUERTOS.map(async (p) => ((await puertoAbierto(v.ip, p)) ? p : 0))).then((l) => l.filter(Boolean) as number[]),
            dns.reverse(v.ip).then((l) => l[0] || null).catch(() => null),
        ]);
        const w = puertos.includes(80) ? await identificar(v.ip) : { servidor: null, reino: null, habla: [] as ("ISAPI" | "DAHUA")[] };
        const base: Hallazgo = { ip: v.ip, rtt: v.rtt, nombre, puertos, ...w };
        return { ...base, parece: queParece(base), equipo: null };
    }));

    // Cuáles ya están dadas de alta: es lo primero que se quiere saber mirando la lista.
    const equipos = await prisma.device.findMany({ where: { ip: { in: hallazgos.map((h) => h.ip) } }, select: { id: true, name: true, ip: true, deviceType: true } });
    const porIp = new Map(equipos.map((e) => [e.ip, { id: e.id, nombre: e.name, tipo: String(e.deviceType) }]));
    for (const h of hallazgos) h.equipo = porIp.get(h.ip) || null;

    hallazgos.sort((a, b) => Number(a.ip.split(".")[3]) - Number(b.ip.split(".")[3]));
    return { total: ips.length, hallazgos };
}

/* ═══════════════════════ El descubridor inteligente (26/11) ═══════════════════════
 *
 * Dos pasos en vez de uno, para que ninguna llamada pase el minuto del proxy y la pantalla pueda
 * mostrar el avance: primero el ping a todo el rango (con la MAC de las que están en la misma red),
 * después la identificación de a tandas cortas — puertos, página web, SNMP, la ficha con
 * credenciales y, si es una cámara, si tiene ANPR.
 */

export type Viva = { ip: string; rtt: number | null; mac: string | null; fabricanteMac: string | null };

/**
 * La tabla ARP del servidor: después del ping, la MAC de cada vecina de la MISMA red. Si el rango
 * está detrás de un router (otra subred, una VPN) no hay MAC: la que se ve es la del router, y el
 * núcleo ni la anota por IP. Por eso la MAC es una pista que a veces falta, nunca un requisito.
 */
async function tablaArp(): Promise<Map<string, string>> {
    const m = new Map<string, string>();
    try {
        const txt = await fsp.readFile("/proc/net/arp", "utf8");
        for (const l of txt.split("\n").slice(1)) {
            const c = l.trim().split(/\s+/);
            if (c.length >= 4 && c[2] !== "0x0" && /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(c[3]) && c[3] !== "00:00:00:00:00:00") m.set(c[0], c[3].toUpperCase());
        }
    } catch { /* sin /proc (no es Linux): sin MAC */ }
    return m;
}

export async function barrerPing(subred: string, desde: number, hasta: number): Promise<{ total: number; vivas: Viva[]; mismaRed: boolean }> {
    const ips = direcciones(subred, desde, hasta);
    if (!ips.length) throw new Error("Ese rango no se puede barrer.");
    const vivas: { ip: string; rtt: number | null }[] = [];
    for (let i = 0; i < ips.length; i += EN_PARALELO) {
        const tanda = await Promise.all(ips.slice(i, i + EN_PARALELO).map(async (ip) => ({ ip, rtt: await pingear(ip) })));
        for (const r of tanda) if (r.rtt != null) vivas.push(r);
    }
    const arp = await tablaArp();
    const mismaRed = subredesPropias().includes(subred);
    return {
        total: ips.length, mismaRed,
        vivas: vivas.map((v) => { const mac = arp.get(v.ip) || null; return { ...v, mac, fabricanteMac: fabricantePorMac(mac) }; }),
    };
}

export type Identificado = {
    ip: string; rtt: number | null; mac: string | null; nombreDns: string | null; puertos: number[];
    servidor: string | null; reino: string | null; habla: ("ISAPI" | "DAHUA")[];
    snmp: FichaSnmp | null;
    /** Con qué credencial entró (su número en la lista, nunca la clave), o por qué no. */
    acceso: { estado: "ok" | "clave" | "muda" | "sin-probar"; credencial: number | null; detalle: string | null };
    ficha: { modelo: string | null; serie: string | null; firmware: string | null; nombre: string | null; clase: string | null; protocolo: string | null } | null;
    /** Grabadores: cuántos canales tiene y cuántos con cámara. */
    canales: { total: number; conCamara: number } | null;
    anpr: boolean | null;
    clasificacion: Clasificacion;
    nombre: string;
    equipo: { id: string; nombre: string; tipo: string } | null;
};

const contar = (xml: string, etiqueta: string) => (xml.match(new RegExp(`<${etiqueta}[\\s>]`, "gi")) || []).length;

/** Los canales de un grabador Hikvision con la credencial que ya entró. Sólo GET. */
async function canalesDeGrabador(ip: string, c: Credencial): Promise<{ total: number; conCamara: number } | null> {
    try {
        const { authenticatedRequest } = await import("@/lib/digest-auth");
        const xml: string = await authenticatedRequest("GET", "/ISAPI/ContentMgmt/InputProxy/channels", { ip, username: c.usuario, password: c.clave, authType: "DIGEST" },
            { responseType: "text", accept: "application/xml", timeout: 8000 });
        const total = contar(String(xml), "InputProxyChannel");
        return total ? { total, conCamara: (String(xml).match(/<ipAddress>\s*\d/gi) || []).length } : null;
    } catch { return null; }
}

/**
 * Identifica una dirección con todo lo que se le pueda preguntar sin escribirle nada.
 *
 * Las credenciales se prueban en orden y se corta en la primera que entra. Sólo con los equipos
 * nuevos (un equipo ya dado de alta tiene la suya) y sólo con los que hablan ISAPI o el CGI de
 * Dahua: cada clave equivocada es un login fallido, y una Hikvision bloquea la IP del servidor
 * después de unos pocos — el mismo servidor que después le tiene que leer las matrículas.
 */
export async function identificarUno(v: Viva, op: { credenciales: Credencial[]; comunidad: string | null; equipo: Identificado["equipo"] }): Promise<Identificado> {
    const [puertos, nombreDns, snmp] = await Promise.all([
        Promise.all(PUERTOS_AMPLIOS.map(async (p) => ((await puertoAbierto(v.ip, p)) ? p : 0))).then((l) => l.filter(Boolean) as number[]),
        dns.reverse(v.ip).then((l) => l[0] || null).catch(() => null),
        op.comunidad ? preguntarSnmp(v.ip, op.comunidad) : Promise.resolve(null),
    ]);
    const w = puertos.includes(80) ? await identificar(v.ip) : { servidor: null, reino: null, habla: [] as ("ISAPI" | "DAHUA")[] };

    let acceso: Identificado["acceso"] = { estado: "sin-probar", credencial: null, detalle: null };
    let ver: Verificacion | null = null;
    let usada: Credencial | null = null;
    const probar = !op.equipo && op.credenciales.length > 0 && puertos.includes(80) && convieneProbarClave({ puertos, habla: w.habla, mac: v.mac });
    if (probar) {
        let mala: Verificacion | null = null;
        for (let i = 0; i < op.credenciales.length; i++) {
            const r = await probarCredencial(v.ip, op.credenciales[i], w.habla);
            if (r.estado === "ok") { ver = r; usada = op.credenciales[i]; acceso = { estado: "ok", credencial: i, detalle: null }; break; }
            if (r.estado === "clave") mala = r;
            else break; // «muda»: no habla la ficha; otra clave no lo va a cambiar
        }
        if (!ver) acceso = mala ? { estado: "clave", credencial: null, detalle: "Ninguna de las claves entró." } : { estado: "muda", credencial: null, detalle: "No contestó la ficha del equipo." };
    }

    let canales: Identificado["canales"] = null, anpr: boolean | null = null;
    if (ver && usada) {
        const tipoDeclarado = `${ver.clase || ""} ${ver.modelo || ""}`;
        if (ver.grabador && ver.protocolo === "ISAPI") canales = await canalesDeGrabador(v.ip, usada);
        else if (ver.protocolo === "ISAPI" && /ip ?camera|ip ?dome|ipc|ds-2|ids-/i.test(tipoDeclarado)) {
            try {
                const { capacidadesCamara } = await import("@/lib/capacidades-camara");
                anpr = (await capacidadesCamara({ ip: v.ip, username: usada.usuario, password: usada.clave, authType: "DIGEST", brand: "HIKVISION", deviceModel: ver.modelo })).anpr;
            } catch { anpr = null; }
        }
    }

    const mac = v.mac || ver?.mac || null;
    const clasificacion = clasificar({
        puertos, servidor: w.servidor, reino: w.reino, habla: w.habla, mac, snmp,
        ficha: ver ? { protocolo: ver.protocolo, clase: ver.clase, modelo: ver.modelo, grabador: ver.grabador } : null, anpr,
    });
    return {
        ip: v.ip, rtt: v.rtt, mac, nombreDns, puertos, ...w, snmp, acceso,
        ficha: ver ? { modelo: ver.modelo, serie: ver.serie, firmware: ver.firmware, nombre: ver.nombre, clase: ver.clase || null, protocolo: ver.protocolo } : null,
        canales, anpr, clasificacion,
        nombre: op.equipo?.nombre || nombrePropuesto(clasificacion, v.ip, ver?.nombre || snmp?.nombre || null),
        equipo: op.equipo,
    };
}

/** Una tanda de identificaciones en paralelo, con los equipos ya dados de alta marcados. */
export async function identificarVarias(vivas: Viva[], op: { credenciales: Credencial[]; comunidad: string | null }): Promise<Identificado[]> {
    const equipos = await prisma.device.findMany({ where: { ip: { in: vivas.map((v) => v.ip) } }, select: { id: true, name: true, ip: true, deviceType: true } });
    const porIp = new Map(equipos.map((e) => [e.ip, { id: e.id, nombre: e.name, tipo: String(e.deviceType) }]));
    return Promise.all(vivas.map((v) => identificarUno(v, { ...op, equipo: porIp.get(v.ip) || null })));
}
