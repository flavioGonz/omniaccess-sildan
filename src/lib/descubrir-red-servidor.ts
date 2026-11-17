import { execFile } from "child_process";
import net from "net";
import os from "os";
import dns from "dns/promises";
import { promisify } from "util";
import { prisma } from "@/lib/prisma";
import { direcciones, prefijoDe, queParece, PUERTOS, type Hallazgo, type Parecer } from "@/lib/descubrir-red";

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

/**
 * Lo que dice el servidor web del equipo sin que nadie se identifique: el encabezado `Server` y,
 * si pide clave, el reino del 401. Es de donde sale la marca sin tener que probar contraseñas —
 * una cámara Hikvision se presenta sola («App-webs», `DS-2CD…` en el reino).
 */
async function web(ip: string): Promise<{ servidor: string | null; reino: string | null }> {
    try {
        const r = await fetch(`http://${ip}/`, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(WEB_MS) });
        const auth = r.headers.get("www-authenticate") || "";
        const reino = /realm="?([^",]+)"?/i.exec(auth)?.[1] || null;
        return { servidor: r.headers.get("server"), reino };
    } catch { return { servidor: null, reino: null }; }
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
        const w = puertos.includes(80) ? await web(v.ip) : { servidor: null, reino: null };
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
