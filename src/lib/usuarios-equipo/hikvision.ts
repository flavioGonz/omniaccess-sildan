/**
 * Las respuestas de usuarios y sesiones de Hikvision (ISAPI), leídas sin dependencias. Es código
 * puro para poder probarlo con las respuestas medidas el 28/10 (tests/usuarios-equipo.test.ts).
 *
 * Lo medido en el lab (14 equipos, sólo GET):
 *  · /ISAPI/Security/users: cámaras con una sola cuenta (admin) en `UserList version="2.0"`; un NVR
 *    con 4 cuentas en `version="1.0"`, cada una con `bondIpAddressList` y `bondMacAddressList` (que
 *    también traen `<id>`: por eso se sacan antes de buscar el id de la cuenta) y la admin marcada
 *    con `<attribute><inherent>true</inherent>`.
 *  · /ISAPI/Security/onlineUser: `<OnlineUser>` con id, name, type, loginTime y clientAddress/ipAddress.
 *  · /ISAPI/Security/users/1/capabilities: en el NVR, `<id min="1" max="32">` e isSupportWeakPassword.
 */

export type CuentaLeida = { idEquipo: string; nombre: string; nivel: string | null; deFabrica: boolean };
export type SesionLeida = { nombre: string; ip: string; desde: string | null };
export type CapacidadesLeidas = { maxCuentas: number | null; claveDebil: boolean | null };

/** Los niveles de Hikvision, en castellano. Lo que no está acá se muestra tal cual lo da el equipo. */
export const NIVEL_HIK: Record<string, string> = { Administrator: "Administrador", Operator: "Operador", Viewer: "Visualizador" };

const etiqueta = (xml: string, nombre: string): string | null => {
    const m = new RegExp(`<${nombre}\\b[^>]*>([\\s\\S]*?)</${nombre}>`).exec(xml);
    return m ? m[1].trim() : null;
};
const bloques = (xml: string, nombre: string): string[] => {
    const out: string[] = [];
    const re = new RegExp(`<${nombre}\\b[^>]*>([\\s\\S]*?)</${nombre}>`, "g");
    for (let m = re.exec(xml); m; m = re.exec(xml)) out.push(m[1]);
    return out;
};
const textoXml = (s: string | null) => (s == null ? null : s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&"));

export function parsearCuentasHik(xml: string): CuentaLeida[] {
    const out: CuentaLeida[] = [];
    for (const b0 of bloques(xml, "User")) {
        // Las listas de IP y MAC atadas también tienen <id>: fuera, para que el primer <id> sea el de la cuenta.
        const b = b0.replace(/<bond\w*List\b[^>]*>[\s\S]*?<\/bond\w*List>/g, "");
        const id = etiqueta(b, "id"), nombre = textoXml(etiqueta(b, "userName"));
        if (!id || !nombre) continue;
        const nivel = etiqueta(b, "userLevel");
        const inherent = /<inherent>\s*true\s*<\/inherent>/i.test(b);
        out.push({ idEquipo: id, nombre, nivel: nivel ? NIVEL_HIK[nivel] || nivel : null, deFabrica: inherent || id === "1" });
    }
    return out;
}

export function parsearSesionesHik(xml: string): SesionLeida[] {
    const out: SesionLeida[] = [];
    for (const b of bloques(xml, "OnlineUser")) {
        const nombre = textoXml(etiqueta(b, "name") ?? etiqueta(b, "userName"));
        const dir = etiqueta(b, "clientAddress") || b;
        const ip = etiqueta(dir, "ipAddress") || etiqueta(dir, "ipv6Address");
        if (!nombre || !ip) continue;
        out.push({ nombre, ip: normalizarIp(ip), desde: etiqueta(b, "loginTime") });
    }
    return out;
}

export function parsearCapacidadesHik(xml: string): CapacidadesLeidas {
    const max = /<id\b[^>]*\bmax="(\d+)"/.exec(xml);
    const debil = etiqueta(xml, "isSupportWeakPassword");
    return { maxCuentas: max ? Number(max[1]) : null, claveDebil: debil == null ? null : /true/i.test(debil) };
}

/** `::ffff:192.168.1.5` → `192.168.1.5`: algunos equipos informan la IPv4 mapeada. */
export function normalizarIp(ip: string): string {
    const s = String(ip || "").trim();
    return s.toLowerCase().startsWith("::ffff:") && s.includes(".") ? s.slice(7) : s;
}

/**
 * La regla de clave de Hikvision para cuentas nuevas (fase 3). La misma la usa el generador, así que
 * lo que se genera siempre se acepta: de 8 a 16 caracteres, al menos 2 de 4 tipos y sin el nombre.
 */
export const REGLAS_CLAVE = { HIKVISION: { min: 8, max: 16, tipos: 2, sinNombre: true } } as const;
