/**
 * El descubridor inteligente, las reglas (26/11). Nico: «que el descubridor sea más inteligente,
 * detecte si es una cámara, un switch, etc.; que identifique los OUI de fabricantes cuando estás en
 * la misma LAN; que pregunte antes las credenciales, incluso SNMP para poder leer. El objetivo es
 * capturar cámaras, porteros, NVR, controles de acceso y todo tipo de dispositivos para OmniAccess».
 *
 * Acá va todo lo que se puede probar sin red: de qué fabricante es una MAC, de qué fabricante es un
 * sysObjectID de SNMP, y —lo que importa— **qué es cada equipo juntando todas las pistas**. Cada
 * pista dice de dónde sale («la MAC es de Hikvision», «la ficha dice NVR»), porque una
 * clasificación sin el porqué no se puede corregir con criterio.
 *
 * El orden de confianza, de más a menos: lo que el equipo dice de sí mismo con credenciales (su
 * ficha: tipo y modelo), lo que dice por SNMP, el reino de su 401, la MAC, los puertos. Una pista
 * de abajo nunca pisa una de arriba.
 */
import { OUI_POR_MARCA } from "@/lib/oui-tabla";
import { CATEGORIAS, FABRICANTES, type Categoria, type Clasificacion } from "@/lib/descubrir-rotulos";

export { CATEGORIAS, FABRICANTES };
export type { Categoria, Clasificacion };

/* ───────────────────────── Fabricantes ───────────────────────── */

let porPrefijo: Map<string, string> | null = null;
/** La MAC normalizada (12 hexadecimales en mayúscula) o null. Acepta «aa:bb:cc…», «aa-bb-…» y «aabb.cc…». */
export function normalizarMac(mac: string | null | undefined): string | null {
    const h = String(mac || "").replace(/[^0-9a-f]/gi, "").toUpperCase();
    return h.length === 12 && h !== "000000000000" ? h : null;
}
/** El fabricante de una MAC por su prefijo (OUI), o null. Una MAC «administrada localmente» no es de nadie. */
export function fabricantePorMac(mac: string | null | undefined): string | null {
    const h = normalizarMac(mac);
    if (!h) return null;
    // El segundo bit del primer octeto prendido = MAC inventada (máquinas virtuales, celulares con MAC al azar).
    if (parseInt(h.slice(0, 2), 16) & 0b10) return null;
    if (!porPrefijo) {
        porPrefijo = new Map();
        for (const [marca, pegados] of Object.entries(OUI_POR_MARCA)) for (let i = 0; i + 6 <= pegados.length; i += 6) porPrefijo.set(pegados.slice(i, i + 6), marca);
    }
    return porPrefijo.get(h.slice(0, 6)) || null;
}

/** sysObjectID → fabricante, por el número de empresa de la IANA (1.3.6.1.4.1.<número>…). */
const EMPRESA_IANA: Record<number, string> = {
    9: "CISCO", 11: "HP", 171: "DLINK", 311: "MICROSOFT", 368: "AXIS", 890: "ZYXEL", 2011: "HUAWEI", 2636: "JUNIPER",
    4526: "NETGEAR", 4881: "RUIJIE", 6574: "SYNOLOGY", 8072: "LINUX", 11863: "TPLINK", 12356: "FORTINET", 14823: "ARUBA",
    14988: "MIKROTIK", 24681: "QNAP", 25053: "RUCKUS", 39165: "HIKVISION", 41112: "UBIQUITI", 1004849: "DAHUA",
};
export function fabricantePorObjectId(oid: string | null | undefined): string | null {
    const m = /^\.?1\.3\.6\.1\.4\.1\.(\d+)/.exec(String(oid || ""));
    return m ? EMPRESA_IANA[Number(m[1])] || null : null;
}

/* ───────────────────────── Qué es ───────────────────────── */

/** Las pistas que se juntaron de un equipo. Todo opcional: cada una llega si se pudo leer. */
export type Pistas = {
    puertos: number[];
    servidor?: string | null;
    reino?: string | null;
    habla?: string[];
    mac?: string | null;
    snmp?: { descr?: string | null; objectId?: string | null; nombre?: string | null } | null;
    /** Lo que el equipo dijo de sí mismo con credenciales (ISAPI deviceInfo o el CGI de Dahua). */
    ficha?: { protocolo: string | null; clase?: string | null; modelo?: string | null; grabador?: boolean } | null;
    /** Si la cámara dijo tener ANPR propio (lib/capacidades-camara). */
    anpr?: boolean | null;
};

const POR_TEXTO: [RegExp, string][] = [
    [/hikvision|dvrdvs|app-?webs/i, "HIKVISION"], [/dahua/i, "DAHUA"], [/akuvox/i, "AKUVOX"], [/grandstream|\bgds\d/i, "GRANDSTREAM"],
    [/routeros|mikrotik/i, "MIKROTIK"], [/ubnt|unifi|ubiquiti|edgeos|airos/i, "UBIQUITI"], [/zkteco/i, "ZKTECO"], [/axis/i, "AXIS"],
];

/**
 * La categoría por el MODELO o la clase que el equipo declara. Los prefijos de modelo son los de los
 * catálogos de cada marca: Hikvision DS-2CD (cámara), iDS-TCM, iDS-TCG y DS-TCG (tránsito/ANPR), DS-7x/9x (NVR),
 * DS-K1T (facial), DS-K2 (controladora), DS-KD/KV (frente de calle), DS-KH (monitor); Dahua IPC, ITC
 * (tránsito), NVR/XVR/HCVR, VTO (frente), VTH (monitor), ASI (facial), ASC (controladora).
 */
function porModelo(texto: string): Categoria | null {
    const t = texto.toUpperCase();
    if (/\bI?DS-TC[MGVP]|\bDHI-ITC|\bITC\d|\bANPR\b|\bLPR\b/.test(t)) return "camara-lpr";
    if (/\bDS-K1T|\bASI\d|\bFACE ?(TERMINAL|RECOGNITION)/.test(t)) return "terminal-facial";
    if (/\bDS-K2\d|\bASC\d|\bACCESS ?CONTROLLER|\bACS\b/.test(t)) return "control-acceso";
    if (/\bDS-K[DV]\d|\bVTO\d|\bDOOR ?STATION|\bVILLA\b|\bGDS\d|\bAKUVOX ?[ERX]\d/.test(t)) return "portero";
    if (/\bDS-KH\d|\bVTH\d|\bINDOOR ?(STATION|MONITOR)/.test(t)) return "monitor";
    if (/\b(NVR|DVR|XVR|HCVR|HYBRID|RECORDER)|\bDS-(7|9)\d{2,3}|\bIDS-(7|9)\d{2,3}/.test(t)) return "nvr";
    if (/\bIP ?(CAMERA|DOME|ZOOM)|\bIPC\b|\bIPC-|\bDS-2(CD|DE|DF|XS|TD)|\bPTZ\b/.test(t)) return "camara";
    return null;
}

/** La categoría por lo que dice SNMP (sysDescr) o el reino. */
function porDescripcion(texto: string): Categoria | null {
    if (/routeros|router\b|edgeos|edgerouter|fortigate|vyos|pfsense|opnsense/i.test(texto)) return "router";
    if (/switch|swos|edgeswitch|\busw\b|jetstream|catalyst|procurve|comware|\bsg\d{3}|\bt\d{4}|\bs\d{4}-|powerconnect/i.test(texto)) return "switch";
    if (/\buap\b|\bu6-|\bu7-|access ?point|airos|\bwap\d|ruckus|aironet/i.test(texto)) return "ap";
    if (/printer|jetdirect|laserjet|brother|epson|lexmark/i.test(texto)) return "impresora";
    if (/synology|qnap|diskstation|\bnas\b/i.test(texto)) return "almacenamiento";
    if (/windows|linux|ubuntu|debian|freebsd|darwin/i.test(texto)) return "computadora";
    return null;
}

export function clasificar(p: Pistas): Clasificacion {
    const por: string[] = [];
    const puertos = new Set(p.puertos || []);
    const habla = p.habla || [];

    // ── El fabricante: ficha > SNMP > texto (Server/reino/sysDescr) > MAC ──
    const deSnmp = fabricantePorObjectId(p.snmp?.objectId);
    const textoLibre = `${p.servidor || ""} ${p.reino || ""} ${p.snmp?.descr || ""}`;
    const deTexto = POR_TEXTO.find(([re]) => re.test(textoLibre))?.[1] || null;
    const deMac = fabricantePorMac(p.mac);
    const deFicha = p.ficha?.protocolo === "ISAPI" ? "HIKVISION" : p.ficha?.protocolo === "DAHUA" ? "DAHUA" : null;
    const deProtocolo = habla.includes("ISAPI") ? "HIKVISION" : habla.includes("DAHUA") ? "DAHUA" : null;
    const fabricante = deFicha || deSnmp || deTexto || deProtocolo || deMac;
    if (deFicha) por.push(`entró con la clave (${p.ficha!.protocolo})`);
    else if (deSnmp) por.push(`SNMP dice ${FABRICANTES[deSnmp]?.rotulo || deSnmp}`);
    else if (deTexto) por.push(`se presenta como ${FABRICANTES[deTexto]?.rotulo || deTexto}`);
    else if (deProtocolo) por.push(`habla ${habla[0]}`);
    if (deMac) por.push(`MAC de ${FABRICANTES[deMac]?.rotulo || deMac}`);
    const rubro = fabricante ? FABRICANTES[fabricante]?.rubro : null;

    // ── La categoría ──
    let categoria: Categoria | null = null;
    let confianza: Clasificacion["confianza"] = "baja";

    const declarado = `${p.ficha?.clase || ""} ${p.ficha?.modelo || ""}`.trim();
    if (declarado) {
        categoria = porModelo(declarado) || (p.ficha?.grabador ? "nvr" : null);
        if (categoria) { confianza = "alta"; por.unshift(`la ficha dice ${p.ficha?.modelo || p.ficha?.clase}`); }
    }
    if (!categoria && p.snmp?.descr) {
        categoria = porModelo(p.snmp.descr) || porDescripcion(p.snmp.descr);
        if (categoria) { confianza = "alta"; por.unshift("lo dice su descripción SNMP"); }
    }
    if (!categoria && p.reino) {
        // El reino del 401 de Hikvision dice qué clase de equipo es (medido 17/11): «IP Camera(GB828)», «Embedded Net DVR».
        if (/ip camera/i.test(p.reino)) { categoria = "camara"; confianza = "media"; por.unshift(`su login dice «${p.reino}»`); }
        else if (/net dvr|net nvr|embedded net/i.test(p.reino)) { categoria = "nvr"; confianza = "media"; por.unshift(`su login dice «${p.reino}»`); }
        else { const c = porModelo(p.reino); if (c) { categoria = c; confianza = "media"; por.unshift(`su login dice «${p.reino}»`); } }
    }
    if (!categoria) {
        // Por fabricante y puertos: pistas más flojas, se dicen como tales.
        if (fabricante === "MIKROTIK" || puertos.has(8291)) { categoria = "router"; confianza = fabricante === "MIKROTIK" ? "media" : "baja"; if (puertos.has(8291)) por.push("tiene Winbox (8291)"); }
        else if (fabricante === "AKUVOX") { categoria = "portero"; confianza = "media"; }
        else if (fabricante === "ZKTECO") { categoria = "control-acceso"; confianza = "media"; }
        else if (fabricante === "UBIQUITI") { categoria = "ap"; confianza = "baja"; por.push("Ubiquiti suele ser WiFi o switch"); }
        else if (fabricante && ["YEALINK", "FANVIL"].includes(fabricante)) { categoria = "telefono"; confianza = "media"; }
        else if (fabricante === "GRANDSTREAM") { categoria = puertos.has(554) ? "portero" : "telefono"; confianza = "baja"; }
        else if (puertos.has(37777)) { categoria = "nvr"; confianza = "baja"; por.push("puerto propio de Dahua (37777), típico de grabador"); }
        else if (puertos.has(554)) { categoria = "camara"; confianza = rubro === "seguridad" ? "media" : "baja"; por.push("transmite video (RTSP 554)"); }
        else if (fabricante && rubro === "seguridad") { categoria = "camara"; confianza = "baja"; por.push("es de una marca de seguridad"); }
        else if (puertos.has(9100)) { categoria = "impresora"; confianza = "media"; por.push("puerto de impresión (9100)"); }
        else if (puertos.has(3389)) { categoria = "computadora"; confianza = "media"; por.push("escritorio remoto (3389)"); }
        else if (fabricante && ["SYNOLOGY", "QNAP"].includes(fabricante)) { categoria = "almacenamiento"; confianza = "media"; }
        else if (fabricante && ["PROXMOX", "VMWARE"].includes(fabricante)) { categoria = "computadora"; confianza = "media"; por.push("es una máquina virtual"); }
        else if (fabricante && ["APPLE", "RASPBERRY", "MICROSOFT", "LINUX", "DELL", "LENOVO", "SUPERMICRO", "INTEL"].includes(fabricante)) { categoria = "computadora"; confianza = "baja"; }
        else if (fabricante && rubro === "red") { categoria = "switch"; confianza = "baja"; por.push("es de una marca de red"); }
    }
    categoria ||= "otro";

    // Una cámara que dijo tener ANPR es LPR, aunque su modelo no lo diga (medido 16/10: la iDS-2CD7A46 de .102).
    if (categoria === "camara" && p.anpr === true) { categoria = "camara-lpr"; por.unshift("la cámara dice tener ANPR"); confianza = "alta"; }

    const marca = fabricante ? FABRICANTES[fabricante]?.marca ?? null : null;
    return { categoria, fabricante, marca, tipo: CATEGORIAS[categoria].tipo, confianza, por: [...new Set(por)].slice(0, 4) };
}

/** Si vale la pena probar credenciales con un equipo: sólo los que hablan un protocolo que sabemos leer. */
export function convieneProbarClave(p: Pick<Pistas, "puertos" | "habla" | "mac">): boolean {
    if ((p.habla || []).length) return true;
    const f = fabricantePorMac(p.mac);
    return f === "HIKVISION" || f === "DAHUA";
}

/** El nombre que se le propone al darlo de alta: el que el equipo tiene puesto, o «Cámara 45». */
export function nombrePropuesto(c: Clasificacion, ip: string, nombreDelEquipo?: string | null): string {
    const propio = String(nombreDelEquipo || "").trim();
    // Los nombres de fábrica no dicen nada: «IP CAMERA», «Embedded Net DVR», «HIKVISION».
    if (propio && !/^(ip ?camera|ip ?dome|embedded net [dn]vr|network video recorder|hikvision|dahua|[dn]vr|camera\d*)$/i.test(propio)) return propio.slice(0, 80);
    return `${CATEGORIAS[c.categoria].rotulo.split(" (")[0].split(" /")[0]} ${ip.split(".")[3]}`;
}
