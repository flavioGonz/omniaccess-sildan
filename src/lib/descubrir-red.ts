/**
 * Descubrir equipos en la red, las reglas.
 *
 * Pedido del 17/11 (Nico): «en /admin/devices también debe estar el escaneador de red y de
 * dispositivos que tenemos en los mapas tipo diagramas» — el de KumaMap, que hace un barrido de
 * ping por subred y deja agregar lo que encuentra.
 *
 * Acá va lo que se puede probar sin red: qué rango se deja barrer, cómo se arma la lista, y —lo
 * que de verdad ahorra trabajo— **qué parece ser cada IP que contestó**. Un barrido que devuelve
 * veinte números no sirve de mucho; lo que se quiere saber es cuál de esos veinte es una cámara
 * que todavía no está dada de alta.
 *
 * El trabajo con la red (ping, puertos, encabezados) está en descubrir-red-servidor.ts.
 */

/** Los puertos que se prueban, y qué significa cada uno. Pocos: cada uno cuesta tiempo por IP. */
export const PUERTOS = [80, 443, 554, 8000, 37777, 22] as const;
/**
 * Los del descubridor inteligente (26/11): además de los de video, los que delatan qué es lo que
 * NO es una cámara — Winbox (8291) es un MikroTik, 9100 una impresora, 3389 un Windows, 5060 un
 * teléfono o un portero SIP, 8443 un controlador UniFi. Se prueban sólo en las que contestaron.
 */
export const PUERTOS_AMPLIOS = [80, 443, 554, 8000, 37777, 22, 8291, 9100, 3389, 5060, 8443] as const;

/** Un octeto decimal, sin ceros a la izquierda ni espacios ni nada más. */
const OCTETO = /^(0|[1-9]\d{0,2})$/;

/**
 * Sólo se barren redes privadas, y el prefijo se valida octeto por octeto.
 *
 * Las dos cosas por el mismo motivo: el prefijo viaja al servidor y termina del lado del sistema
 * operativo. Validarlo con `parseInt` deja pasar «10.0.1;loquesea» — por eso cada octeto se mide
 * contra esta expresión y, además, el valor se le pasa a `ping` como argumento y nunca por un
 * shell (ver descubrir-red-servidor.ts). Y privadas porque un barrido hacia afuera es escanear
 * internet desde el servidor del cliente, que no es lo que nadie quiso pedir.
 */
export function esSubredPrivada(subred: string): boolean {
    const partes = subred.split(".");
    if (partes.length !== 3) return false;
    const n: number[] = [];
    for (const p of partes) {
        if (!OCTETO.test(p)) return false;
        const v = Number(p);
        if (!Number.isInteger(v) || v < 0 || v > 255) return false;
        n.push(v);
    }
    const [a, b] = n;
    return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

/** Cuántas direcciones se barren de una. Un /24 entero; más que eso es otro pedido. */
export const RANGO_MAX = 254;

/** La lista de direcciones a probar, acotada. Devuelve [] si el prefijo no sirve. */
export function direcciones(subred: string, desde = 1, hasta = 254): string[] {
    if (!esSubredPrivada(subred)) return [];
    const d = Math.max(1, Math.min(254, Math.trunc(Number(desde) || 1)));
    const h = Math.max(d, Math.min(254, Math.trunc(Number(hasta) || 254)));
    if (h - d + 1 > RANGO_MAX) return [];
    return Array.from({ length: h - d + 1 }, (_, i) => `${subred}.${d + i}`);
}

/** El prefijo /24 de una IP («172.26.20.226» → «172.26.20»), o null si no es una IPv4. */
export function prefijoDe(ip: string | null | undefined): string | null {
    if (!ip) return null;
    const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip.trim());
    if (!m) return null;
    const p = m.slice(1, 4).join(".");
    return esSubredPrivada(p) ? p : null;
}

/**
 * Las subredes que conviene ofrecer: las de los equipos que ya están dados de alta, de la que más
 * equipos tiene a la que menos. Es la respuesta correcta casi siempre y evita que haya que
 * acordarse del prefijo.
 */
export function subredesSugeridas(ips: (string | null | undefined)[], propias: string[] = []): string[] {
    const cuenta = new Map<string, number>();
    for (const ip of ips) { const p = prefijoDe(ip); if (p) cuenta.set(p, (cuenta.get(p) || 0) + 1); }
    for (const p of propias) { const q = prefijoDe(`${p}.1`); if (q && !cuenta.has(q)) cuenta.set(q, 0); }
    return [...cuenta.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([p]) => p);
}

export type Hallazgo = {
    ip: string;
    rtt: number | null;
    nombre: string | null;
    puertos: number[];
    /** Lo que dijo el servidor web del equipo, si contestó: encabezado `Server` y el reino del 401. */
    servidor: string | null;
    reino: string | null;
    /**
     * Qué protocolos de fabricante contestaron, sin credenciales.
     *
     * Medido en el lab el 17/11: las Hikvision de ahí **no mandan `Server` ni piden clave en `/`**
     * —contestan 200 con la página de login—, así que el encabezado solo no alcanzaba y el barrido
     * no deducía ninguna marca. Lo que sí las delata es `/ISAPI/System/deviceInfo`: 401 con
     * `realm="IP Camera(GB828)"`. La misma ruta en una Dahua no existe, y su `magicBox.cgi`
     * contesta 401 donde la Hikvision da 404. Eso es lo que se prueba.
     */
    habla: ("ISAPI" | "DAHUA")[];
};

export type Parecer = {
    /** Para la persona: «Cámara IP (Hikvision)», «Equipo de red», «No se sabe». */
    que: string;
    /** Con qué tipo de equipo darlo de alta, si se puede decir. */
    tipo: "LPR_CAMERA" | "CAMERA" | "NVR" | "ACCESS_CONTROL" | "DOOR_INTERCOM" | null;
    marca: "HIKVISION" | "DAHUA" | "AKUVOX" | "GRANDSTREAM" | "UNIFI" | null;
};

/** Marcas que se delatan solas en el `Server` o en el reino del 401. */
const POR_TEXTO: [RegExp, Parecer["marca"]][] = [
    [/hikvision|dvrdvs|app-?webs/i, "HIKVISION"],
    [/dahua|webs\b.*dahua/i, "DAHUA"],
    [/akuvox/i, "AKUVOX"],
    [/grandstream|gds\d/i, "GRANDSTREAM"],
    [/ubnt|unifi/i, "UNIFI"],
];

/**
 * Qué parece ser lo que contestó.
 *
 * Es una pista, no un diagnóstico: dice de dónde sale («554 abierto» = habla RTSP, así que es una
 * cámara o un grabador) y deja la decisión en quien lo da de alta. Preferir equivocarse diciendo
 * «no se sabe» antes que poner un tipo que después hay que corregir a mano.
 */
export function queParece(h: Pick<Hallazgo, "puertos" | "servidor" | "reino" | "nombre"> & { habla?: Hallazgo["habla"] }): Parecer {
    const texto = `${h.servidor || ""} ${h.reino || ""} ${h.nombre || ""}`;
    const habla = h.habla || [];
    const marca = POR_TEXTO.find(([re]) => re.test(texto))?.[1]
        || (habla.includes("ISAPI") ? "HIKVISION" : habla.includes("DAHUA") ? "DAHUA" : null);
    const tiene = (p: number) => h.puertos.includes(p);
    const nombre = (base: string) => (marca ? `${base} (${marca[0] + marca.slice(1).toLowerCase()})` : base);

    // El reino del 401 de Hikvision dice qué clase de equipo es: «IP Camera(GB828)» en una cámara,
    // «Embedded Net DVR» o el modelo en un grabador. Es lo único medido que separa cámara de
    // grabador sin entrar con clave, así que se usa y nada más se adivina.
    if (/ip camera/i.test(h.reino || "")) return { que: nombre("Cámara IP"), tipo: null, marca };
    if (/net dvr|net nvr|embedded net/i.test(h.reino || "")) return { que: nombre("Grabador"), tipo: "NVR", marca };

    // El 37777 es el puerto propio de Dahua; el 8000, el de Hikvision. Con RTSP al lado, es video.
    if (tiene(554)) {
        const porteroPorMarca = marca === "AKUVOX" || marca === "GRANDSTREAM";
        if (porteroPorMarca) return { que: nombre("Portero IP"), tipo: "DOOR_INTERCOM", marca };
        return { que: nombre("Cámara o grabador"), tipo: null, marca };
    }
    if (tiene(37777)) return { que: nombre("Grabador Dahua"), tipo: "NVR", marca: marca || "DAHUA" };
    if (tiene(8000) && marca === "HIKVISION") return { que: "Equipo Hikvision", tipo: null, marca };
    if (marca) return { que: nombre("Equipo"), tipo: null, marca };
    if (tiene(80) || tiene(443)) return { que: "Algo con página web", tipo: null, marca: null };
    if (tiene(22)) return { que: "Equipo con SSH", tipo: null, marca: null };
    return { que: "No se sabe", tipo: null, marca: null };
}

/**
 * Un solo campo para decir qué barrer, en vez de tres.
 *
 * Nico pidió poder escribir un CIDR (18/11). En vez de sumarle un cuarto casillero al encabezado
 * —subred, desde, hasta y ahora máscara, cuatro cosas para decir una—, el campo entiende las
 * cuatro formas en que alguien escribe una red cuando la tiene en la cabeza:
 *
 *   192.168.1          toda la /24 (1 a 254)
 *   192.168.1.0/24     lo mismo, en CIDR
 *   192.168.1.64/26    el bloque .64–.127, sin la red ni la difusión
 *   192.168.1.10-60    un tramo a mano
 *   192.168.1.64       una sola dirección
 *
 * Devuelve siempre prefijo + tramo porque es lo que el barrido sabe hacer: una /24 por vez. Un
 * bloque más grande que eso (/23 o menos) **no se recorta en silencio**: se avisa, porque quien
 * escribió /22 quería mil direcciones y merece que se le diga que acá no entran, en vez de
 * recibir sin aviso la cuarta parte de lo que pidió.
 */
export function leerRango(texto: string): { subred: string; desde: number; hasta: number; total: number; error?: undefined } | { error: string } {
    const t = String(texto || "").trim().replace(/\s+/g, "").replace(/\.x$/i, "").replace(/\.\*$/, "");
    if (!t) return { error: "Escribí una red: 192.168.1 o 192.168.1.0/24." };

    const arma = (subred: string, desde: number, hasta: number) => {
        if (!esSubredPrivada(subred)) return { error: "Sólo se pueden barrer redes privadas (10.x, 172.16–31.x, 192.168.x)." };
        const d = Math.max(1, Math.min(254, desde)), h = Math.max(d, Math.min(254, hasta));
        return { subred, desde: d, hasta: h, total: h - d + 1 };
    };

    const cidr = /^(\d{1,3}\.\d{1,3}\.\d{1,3})\.(\d{1,3})\/(\d{1,2})$/.exec(t);
    if (cidr) {
        const [, pref, ultimo, bits] = cidr;
        const n = Number(bits);
        if (n < 24) return { error: `Un /${n} son ${2 ** (32 - n)} direcciones. Acá se barre una /24 por vez: probá ${pref}.0/24.` };
        if (n > 32) return { error: "Esa máscara no existe." };
        const tam = 2 ** (32 - n);
        const base = Math.floor(Number(ultimo) / tam) * tam;
        // En un bloque de más de dos direcciones, la primera es la red y la última la difusión:
        // no contestan y pingearlas es tiempo tirado.
        return arma(pref, tam > 2 ? base + 1 : base, tam > 2 ? base + tam - 2 : base + tam - 1);
    }

    const tramo = /^(\d{1,3}\.\d{1,3}\.\d{1,3})\.(\d{1,3})-(\d{1,3})$/.exec(t);
    if (tramo) return arma(tramo[1], Number(tramo[2]), Number(tramo[3]));

    const una = /^(\d{1,3}\.\d{1,3}\.\d{1,3})\.(\d{1,3})$/.exec(t);
    if (una) return arma(una[1], Number(una[2]), Number(una[2]));

    const pref = /^(\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(t);
    if (pref) return arma(pref[1], 1, 254);

    return { error: "No se entiende. Probá 192.168.1, 192.168.1.0/24 o 192.168.1.10-60." };
}
