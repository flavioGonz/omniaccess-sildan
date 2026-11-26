import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import { getChannelMap } from "@/lib/nvr-resolve";

/**
 * El paquete de equipos para llevar a otra instancia de OmniAccess (26/11).
 *
 * Nico: «exportar los dispositivos junto con sus áreas y parámetros hacia otras instancias de
 * OmniAccess en el futuro». Es un JSON versionado (`formato: "omniaccess.equipos"`, `version: 1`)
 * con todo lo que hace falta para recrear cada equipo tal como está configurado acá:
 *
 *  · las áreas (el árbol) y en cuál está cada equipo;
 *  · cada equipo con sus parámetros (tipo, marca, IP, puertos, sentido, modos, la calibración de
 *    lectura, la geometría de carriles, la de intrusión, los avisos, los grupos de acceso);
 *  · su grabación (en qué NVR y canal), por referencia al NVR del mismo paquete.
 *
 * Lo secreto (usuario, clave y URL RTSP, que suele llevar usuario y clave adentro) NUNCA va en
 * claro: va cifrado con una frase que elige quien exporta (scrypt + AES-256-GCM). Sin frase, el
 * paquete sale sin secretos y en la otra instancia se cargan a mano. Así el archivo puede viajar
 * por correo o en un pendrive sin ser una llave de todo el barrio.
 *
 * Los ids de acá no sirven allá: cada equipo lleva una `ref` (su id de origen) para enlazar áreas,
 * grabaciones y secretos dentro del paquete; la otra instancia le da ids nuevos al importar.
 */

export const FORMATO = "omniaccess.equipos";
export const VERSION = 1;
const PARAMETROS = [
    "deviceType", "brand", "deviceModel", "ip", "mac", "port", "httpPort", "location", "direction", "authType", "avisos",
    "trackScene", "trackEnabled", "trackRoi", "trackTrigger", "trackLine", "lprGeometria", "trackMinConf", "trackFps",
    "trackAcceso", "lprVerifica", "lprAbre", "intrusionModo", "intrusionEnabled", "intrusionGeometry",
] as const;

export type Cifrado = { alg: "aes-256-gcm"; kdf: "scrypt"; N: number; r: number; p: number; sal: string; iv: string; etiqueta: string; datos: string };
export type Secretos = Record<string, { usuario: string | null; clave: string | null; rtsp: string | null }>;
export type Paquete = {
    formato: typeof FORMATO; version: number; generado: string;
    origen: { instancia: string; empresa: string | null };
    areas: { ref: string; nombre: string; padre: string | null; orden: number; color: string }[];
    equipos: { ref: string; nombre: string; area: string | null; grupos: string[]; grabacion: { nvr: string | null; canal: number } | null; parametros: Record<string, unknown> }[];
    secretos: Cifrado | null;
    notas: string[];
};

const SCRYPT = { N: 1 << 15, r: 8, p: 1 };

export function cifrar(texto: string, frase: string): Cifrado {
    const sal = crypto.randomBytes(16), iv = crypto.randomBytes(12);
    const clave = crypto.scryptSync(frase, sal, 32, { ...SCRYPT, maxmem: 128 * SCRYPT.N * SCRYPT.r * 2 });
    const c = crypto.createCipheriv("aes-256-gcm", clave, iv);
    const datos = Buffer.concat([c.update(texto, "utf8"), c.final()]);
    return { alg: "aes-256-gcm", kdf: "scrypt", ...SCRYPT, sal: sal.toString("base64"), iv: iv.toString("base64"), etiqueta: c.getAuthTag().toString("base64"), datos: datos.toString("base64") };
}

/** Para la importación (y para probar que el paquete se abre): tira error si la frase no es la correcta. */
export function descifrar(x: Cifrado, frase: string): string {
    const clave = crypto.scryptSync(frase, Buffer.from(x.sal, "base64"), 32, { N: x.N, r: x.r, p: x.p, maxmem: 128 * x.N * x.r * 2 });
    const d = crypto.createDecipheriv("aes-256-gcm", clave, Buffer.from(x.iv, "base64"));
    d.setAuthTag(Buffer.from(x.etiqueta, "base64"));
    return Buffer.concat([d.update(Buffer.from(x.datos, "base64")), d.final()]).toString("utf8");
}

/** Lo mínimo para que una frase no se adivine en un rato: 10 caracteres. */
export const FRASE_MIN = 10;

export async function armarPaquete(o: { frase?: string | null; instancia: string }): Promise<Paquete> {
    const devs = await prisma.device.findMany({
        orderBy: { name: "asc" },
        select: {
            id: true, name: true, username: true, password: true, rtspUrl: true, accessGroups: { select: { name: true } },
            deviceType: true, brand: true, deviceModel: true, ip: true, mac: true, port: true, httpPort: true, location: true, direction: true, authType: true, avisos: true,
            trackScene: true, trackEnabled: true, trackRoi: true, trackTrigger: true, trackLine: true, lprGeometria: true, trackMinConf: true, trackFps: true,
            trackAcceso: true, lprVerifica: true, lprAbre: true, intrusionModo: true, intrusionEnabled: true, intrusionGeometry: true,
        },
    });
    let estado: { areas?: { id: string; nombre: string; padre: string | null; orden?: number; color?: string }[]; equipos?: Record<string, string> } = {};
    try { estado = JSON.parse((await prisma.setting.findUnique({ where: { key: "DEVICE_AREAS" } }))?.value || "{}"); } catch { }
    const areas = (estado.areas || []).map((a) => ({ ref: a.id, nombre: a.nombre, padre: a.padre || null, orden: a.orden ?? 0, color: a.color || "#64748b" }));
    const hayArea = new Set(areas.map((a) => a.ref));
    const mapa = await getChannelMap();
    const empresa = (await prisma.setting.findUnique({ where: { key: "REPORT_COMPANY" } }).catch(() => null))?.value || null;

    const secretos: Secretos = {};
    const equipos = devs.map((d) => {
        const g = typeof d.ip === "string" ? mapa[d.ip] : undefined;
        if (d.username || d.password || d.rtspUrl) secretos[d.id] = { usuario: d.username || null, clave: d.password || null, rtsp: d.rtspUrl || null };
        const area = estado.equipos?.[d.id];
        return {
            ref: d.id, nombre: d.name, area: area && hayArea.has(area) ? area : null,
            grupos: (d.accessGroups || []).map((x) => x.name),
            grabacion: g ? { nvr: g.nvrId || null, canal: g.ch } : null,
            parametros: Object.fromEntries(PARAMETROS.map((k) => [k, (d as Record<string, unknown>)[k] ?? null])),
        };
    });
    const conFrase = !!o.frase && o.frase.length >= FRASE_MIN;
    const notas = [
        "Los ids de origen (ref) sólo enlazan dentro de este paquete: la instancia que lo importa crea ids nuevos.",
        conFrase ? "Usuarios, claves y URL RTSP van cifrados (AES-256-GCM, clave derivada con scrypt de la frase de quien exportó)." : "Sin secretos: no se eligió frase, así que usuarios, claves y URL RTSP no vienen. Se cargan a mano al importar.",
        "La geometría y las coordenadas de calibración son fracciones del cuadro: valen en otra instancia si la cámara mira lo mismo.",
    ];
    return {
        formato: FORMATO, version: VERSION, generado: new Date().toISOString(),
        origen: { instancia: o.instancia, empresa }, areas, equipos,
        secretos: conFrase ? cifrar(JSON.stringify(secretos), o.frase!) : null,
        notas,
    };
}
