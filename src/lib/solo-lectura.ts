/**
 * Equipos de sólo lectura para ESTE servidor.
 *
 * 21/10: desde el lab se guardó «Elegir canales» de búsqueda IA en el NVR 6 de San Nicolás (el lab
 * ve los equipos del barrio por la VPN). El NVR pasó tres LPR de acceso a modo «smart»: el ANPR se
 * habría apagado en el próximo reinicio. La regla ya era «desde el lab nunca configurar equipos de
 * San Nicolás», pero la cumplía quien apretaba, no el código.
 *
 * Ahora la cumple el código: OMNI_EQUIPOS_SOLO_LECTURA (en el .env, redes CIDR o IPs separadas por
 * coma; en el lab «192.168.1.0/24») hace que cualquier pedido que CAMBIE algo en esos equipos se
 * corte antes de salir. Leer sigue andando (GET, y los POST que sólo consultan: búsquedas, pruebas,
 * logs). Excepción explícita: el lente (zoom y foco), que Nico pidió que ande en el lab
 * (OMNI_MUEVE_LENTES); un lente movido se vuelve a mover, un modo ANPR cambiado apaga un acceso.
 */
const VAR = "OMNI_EQUIPOS_SOLO_LECTURA";

type Red = { base: number; mascara: number };
let cache: { crudo: string; redes: Red[] } | null = null;

const aNumero = (ip: string): number | null => {
    const p = ip.trim().split(".").map(Number);
    if (p.length !== 4 || p.some((x) => !Number.isInteger(x) || x < 0 || x > 255)) return null;
    return ((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3];
};

function redes(): Red[] {
    const crudo = process.env[VAR] || "";
    if (cache && cache.crudo === crudo) return cache.redes;
    const out: Red[] = [];
    for (const t of crudo.split(",").map((x) => x.trim()).filter(Boolean)) {
        const [ip, bits] = t.split("/");
        const n = aNumero(ip);
        if (n == null) continue;
        const b = bits == null ? 32 : Math.max(0, Math.min(32, Number(bits)));
        const mascara = b === 0 ? 0 : (0xffffffff << (32 - b)) >>> 0;
        out.push({ base: (n & mascara) >>> 0, mascara });
    }
    cache = { crudo, redes: out };
    return out;
}

const hostDe = (ip: string) => String(ip || "").replace(/^https?:\/\//, "").split("/")[0].split(":")[0];

export function esSoloLectura(ip: string): boolean {
    const n = aNumero(hostDe(ip));
    if (n == null) return false;
    return redes().some((r) => ((n & r.mascara) >>> 0) === r.base);
}

/** POST que sólo consultan o prueban (no cambian la configuración del equipo). */
const POST_DE_LECTURA = [
    /AsynSearchByTextTask/i, /SearchTextTaskStatus/i, /DeleteAsynSearchByTextTask/i, /searchByPic/i, /\/ContentMgmt\/search/i,
    /logSearch/i, /\/test(\?|$)/i, /TestPicSearchBy\w*Channel/i, /SearchEventRuleAndTriggerParams/i, /SearchAcuSeekTarget/i, /\/capabilities/i,
];
/** Lo que se deja cambiar igual: el lente (ver arriba). */
const PERMITIDO = [/\/PTZCtrl\/channels\/\d+\/continuous/i, /\/System\/Video\/inputs\/channels\/\d+\/focus/i, /onepushfoucs/i];

export function cambiaAlgo(metodo: string, ruta: string): boolean {
    const m = metodo.toUpperCase();
    if (m === "GET" || m === "HEAD" || m === "OPTIONS") return false;
    if (m === "POST" && POST_DE_LECTURA.some((r) => r.test(ruta))) return false;
    return !PERMITIDO.some((r) => r.test(ruta));
}

export class EquipoSoloLectura extends Error {
    constructor(ip: string) {
        super(`Este servidor no puede cambiar la configuración de ${hostDe(ip)}: está marcado de sólo lectura (${VAR}). Hacelo desde el servidor de ese barrio.`);
        this.name = "EquipoSoloLectura";
    }
}

/** Corta el pedido si cambiaría algo en un equipo de sólo lectura. */
export function exigirEscritura(ip: string, metodo: string, ruta: string): void {
    if (esSoloLectura(ip) && cambiaAlgo(metodo, ruta)) throw new EquipoSoloLectura(ip);
}
